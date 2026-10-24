import { createTasksSignupCheer, loadSignupCheerConfig } from "./tasksSignupCheer.js";
import { campField, getCampRules, campEligibility, campDifficulty, campTaskState,
  campBattleWon, campRecords, campRecordKey } from "./campChallengeState.js";
/** 营地挑战：据点连续三败后，宠物补齐共享的当日三次成功目标。 */
export const CAMP_TARGET_WINS = 3;
export const CAMP_MAX_CONSECUTIVE_FAILURES = 3;

export function getCampDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  return {
    key: `${values.year.slice(-2)}${values.month}${values.day}`,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
}

export function getCampProgress(info, dateKey) {
  if (!info?.club || !info?.siege || !info.siege.attackMap) {
    throw new Error("营地数据不完整，无法确认今日次数");
  }
  const record = campField(info.siege.attackMap, dateKey) ?? {};
  if (typeof record !== "object" || Array.isArray(record)) throw new Error("营地挑战次数异常");
  const attacks = Number(record.attackCnt ?? 0);
  const wins = Number(record.aSuccessCnt ?? 0);
  if ([record.attackCnt, record.aSuccessCnt].some(value => value === "" || typeof value === "boolean") || ![attacks, wins].every((n) => Number.isInteger(n) && n >= 0)) {
    throw new Error("营地挑战次数异常");
  }
  return { attacks, wins };
}

export function buildCampTeam(role) {
  const battleTeam = {};
  for (const [slot, hero] of Object.entries(role?.battleTeam || {})) {
    const heroId = Number(typeof hero === "object" ? hero?.heroId : hero);
    if (/^[0-4]$/.test(slot) && Number.isInteger(heroId) && heroId > 0) {
      battleTeam[slot] = heroId;
    }
  }
  if (!Object.keys(battleTeam).length) throw new Error("当前账号没有可用出战阵容");
  return {
    battleTeam,
    lordWeaponId: Number(role.lordWeaponId) || 0,
    petUId: role.pet?.petUId || "",
  };
}

/** 每场对账当日共享成功次数；超时仅在新战报唯一确认结果后继续。 */
export async function runCampChallenge({
  send, stopped = () => false, log = () => {},
  now = () => new Date(), pause = async () => {}, loadConfig = loadSignupCheerConfig,
}) {
  if (stopped()) throw new Error("任务已停止");
  let day;
  let rules;
  const check = (attack = false) => {
    if (stopped()) throw new Error("任务已停止");
    if (day && getCampDay(now()).key !== day.key) throw new Error("日期已变化，请下次重新执行");
    if (attack && rules && (+now() < rules.start || +now() >= rules.end)) throw new Error("已不在营地挑战时段，停止挑战");
  };
  const request = async (cmd, params = {}) => {
    check(cmd === "club_attack" || cmd === "club_attackmonster");
    const result = await send(cmd, params);
    await pause();
    check();
    return result;
  };
  const config = await loadConfig(request);
  day = getCampDay(now());
  if (![2, 3, 4].includes(day.weekday)) return { status: "skipped", reason: "仅周二、周三、周四开放" };
  const { role } = await request("role_getroleinfo");
  rules = getCampRules(config, role, now());
  if (!rules.inSeason) return { status: "skipped", reason: "当前不在营地赛季" };
  if (+now() < rules.start || +now() >= rules.end) return { status: "skipped", reason: "当前不在营地挑战开放时段" };
  let info;
  let progress;
  const refresh = async () => {
    const snapshot = await request("club_getinfo");
    if (!snapshot?.club || !snapshot?.siege) throw new Error("营地数据不完整，无法确认今日次数");
    // getInfo是完整查询；协议省略的默认Map归一化为空，不能沿用旧任务领奖标记。
    info = { ...snapshot, siege: { attackMap: {}, taskProgress: {}, taskClaimedMap: {}, ...snapshot.siege } };
    progress = getCampProgress(info, day.key);
    rules = getCampRules(config, role, now());
    return info;
  };
  await refresh();
  const eligibility = () => campEligibility(info, role, now());
  const reason = eligibility();
  if (reason) return { status: "skipped", reason };
  if (!campField(info.club.oppoMap, day.weekday)) return { status: "skipped", reason: "今日没有营地对阵" };
  const teamSetParams = progress.wins < rules.targetWins ? buildCampTeam(role) : null;
  let records = progress.wins < rules.targetWins
    ? campRecords(await request("club_getattackrecord"), now()) : [];
  let monsterWins = records.filter(record => Number(record.roleId) <= 0 && Number(record.monsterId) > 0 && record.isWin === true).length;
  log(`今日共享成功 ${progress.wins}/${rules.targetWins}，据点出手 ${progress.attacks}/${rules.attacks}，已返回战报中宠物胜利 ${monsterWins} 次`);
  const powers = new Map();
  const failedTargets = new Set();
  let consecutiveFailures = 0;
  let refreshRetries = 0;
  const keyFor = (slot, target) => {
    if (target.mirror !== undefined && typeof target.mirror !== "boolean") throw new Error("目标镜像标记异常");
    return `${slot}:${target.roleId}:${target.mirror === true}:${campDifficulty(target, config)}`;
  };

  const attack = async (cmd, params) => {
    check(true);
    const before = { ...progress };
    const priorKeys = new Set(records.map(campRecordKey).filter(Boolean));
    let response;
    let error;
    try { response = await request(cmd, { ...params, useItem: false, teamSetParams }); }
    catch (caught) { check(); error = caught; }
    await refresh();
    const afterRecords = campRecords(await request("club_getattackrecord"), now());
    const fresh = afterRecords.filter(record => campRecordKey(record) && !priorKeys.has(campRecordKey(record)));
    records = afterRecords;
    if (progress.wins < before.wins || progress.attacks < before.attacks) throw new Error("攻击后当日次数回退，停止挑战");
    const winDelta = progress.wins - before.wins;
    const attackDelta = progress.attacks - before.attacks;
    if (error && /(?:^|\D)13000070(?:\D|$)/.test(String(error.code || error.message)) && !winDelta && !attackDelta && !fresh.length) {
      // 官方明确目标版本冲突：查询状态和目标阵容后重新选人，不重复发送旧请求。
      if (++refreshRetries > 3) throw new Error("目标连续变化，停止自动重选");
      powers.clear();
      if (params.targetId) await request("club_gettargetteam", { targetId: params.targetId });
      log("目标状态已变化，刷新后重新选择据点");
      return null;
    }
    let won;
    if (error) {
      const matching = fresh.filter(record => cmd === "club_attackmonster"
        ? Number(record.roleId) <= 0 && Number(record.monsterId) > 0
        : Number(record.roleId) === Number(params.targetId) && Number(record.nodeId) === params.nodeId && (record.mirror ?? false) === params.targetIsMirror);
      if (fresh.length !== 1 || matching.length !== 1 || typeof matching[0].isWin !== "boolean" || (cmd === "club_attack" && attackDelta !== 1) || winDelta !== (matching[0].isWin ? 1 : 0)) {
        throw new Error(`攻击结果未确认，停止重试：${error.message}`);
      }
      won = matching[0].isWin;
      log("请求异常，已通过新增战报及当日次数确认结果");
    } else {
      won = campBattleWon(response);
      if (winDelta !== (won ? 1 : 0) || (cmd === "club_attack" && attackDelta !== 1)) throw new Error("战斗胜负与当日次数不一致，停止以避免重复挑战");
    }
    refreshRetries = 0;
    if (cmd === "club_attackmonster" && won) monsterWins++;
    log(`${cmd === "club_attackmonster" ? "宠物挑战" : "据点挑战"}${won ? "胜利" : "未获胜"}，今日共享成功 ${progress.wins}/${rules.targetWins}，出手 ${progress.attacks} 次`);
    return won;
  };
  while (progress.wins < rules.targetWins && progress.attacks < rules.attacks && consecutiveFailures < CAMP_MAX_CONSECUTIVE_FAILURES) {
    check(true);
    const reason = eligibility();
    if (reason) throw new Error(reason);
    const defenders = campField(info.club.oppoMap, day.weekday)?.defenders;
    if (!defenders) throw new Error("今日对阵已变化，停止挑战");
    const candidates = [];
    for (const [slot, target] of Object.entries(defenders)) {
      if (target.defeated || !target.roleId || !/^[1-9]\d*$/.test(slot)) continue;
      const key = keyFor(slot, target);
      if (!powers.has(key)) {
        const team = await request("club_gettargetteam", { targetId: target.roleId });
        const raw = team?.roleBattleTeam?.role?.power ?? team?.teamInfo?.power;
        const power = Number(raw);
        if (raw == null || !Number.isFinite(power) || power < 0) throw new Error("无法读取目标战力，停止自动选人");
        powers.set(key, power);
      }
      candidates.push({ ...target, key, nodeId: Number(slot), difficulty: campDifficulty(target, config), power: powers.get(key) });
    }
    candidates.sort((a, b) => a.power - b.power || a.difficulty - b.difficulty || a.nodeId - b.nodeId);
    if (!candidates.length) { log("无可挑战据点，转为宠物补齐共享成功次数"); break; }
    const target = candidates.find(item => !failedTargets.has(item.key)) || candidates[0];
    await refresh();
    if (eligibility()) throw new Error(eligibility());
    if (progress.wins >= rules.targetWins || progress.attacks >= rules.attacks) break;
    const fresh = campField(info.club.oppoMap, day.weekday)?.defenders?.[target.nodeId];
    if (!fresh || fresh.defeated || keyFor(target.nodeId, fresh) !== target.key) {
      if (++refreshRetries > 3) throw new Error("目标连续变化，停止自动重选");
      log("据点已变化，重新选择目标");
      continue;
    }
    log(`选择 #${target.nodeId} ${target.name || ""}，战力 ${target.power}，难度 ${target.difficulty}`);
    const won = await attack("club_attack", {
      nodeId: target.nodeId, targetId: target.roleId, targetIsMirror: fresh.mirror ?? false,
      challengeCnt: Number(fresh.challengeCnt ?? 0), failCnt: Number(fresh.failCnt ?? 0),
    });
    if (won == null) continue;
    if (won) consecutiveFailures = 0;
    else { consecutiveFailures++; failedTargets.add(target.key); }
  }
  if (consecutiveFailures >= CAMP_MAX_CONSECUTIVE_FAILURES) log("据点连续三次未获胜，转为宠物补齐共享成功次数");
  while (progress.wins < rules.targetWins) {
    check(true);
    if (eligibility()) throw new Error(eligibility());
    if (progress.wins >= rules.winLimit) break;
    const won = await attack("club_attackmonster", {});
    if (!won) throw new Error(`宠物挑战未获胜，今日共享成功 ${progress.wins}/${rules.targetWins}，奖励目标未完成`);
  }
  // 已达到成功目标也必须核对可领取任务，重跑只补领奖。
  await refresh();
  let rewardsClaimed = 0;
  const tried = new Set();
  while (true) {
    check();
    if (eligibility()) throw new Error(eligibility());
    const state = campTaskState(info, config, now());
    const task = state.ready.find(row => !tried.has(row.id));
    if (!task) break;
    tried.add(task.id);
    let error;
    try { await request("club_taskclaim", { confId: task.id }); }
    catch (caught) { check(); error = caught; }
    await refresh();
    if (!campTaskState(info, config, now()).claimed(task)) throw new Error(`营地任务${task.id}领奖未确认${error ? `：${error.message}` : ""}，停止且不重发`);
    rewardsClaimed++;
    log(`营地任务${task.id}奖励已确认领取`);
  }
  const finalTasks = campTaskState(info, config, now());
  log(`营地任务核对结束：本轮领取 ${rewardsClaimed} 项奖励，未达标任务 ${finalTasks.visible.filter(row => !finalTasks.claimed(row)).length} 项`);
  return { status: "completed", ...progress, monsterWins, rewardsClaimed,
    reason: `今日共享成功 ${progress.wins}/${rules.targetWins}，本轮确认领取 ${rewardsClaimed} 项任务奖励` };
}

export function createTasksCamp(deps, {
  now = () => new Date(),
  loadConfig = loadSignupCheerConfig,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const { batchCampSignup } = createTasksSignupCheer(deps, { now, sleep, loadConfig });

  const batchCampChallenge = async () => {
    const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
      ensureConnection, releaseConnectionSlot, tokenStore, addLog,
      currentRunningTokenId, batchSettings, message } = deps;
    if (!selectedTokens.value.length) return;
    isRunning.value = true;
    shouldStop.value = false;
    const ids = [...selectedTokens.value];
    ids.forEach((id) => { tokenStatus.value[id] = "waiting"; });
    const log = (text, type = "info") => addLog({ time: new Date().toLocaleTimeString(), message: text, type });
    let failed = 0;
    try {
      // 同公会共享据点状态，按账号顺序执行，避免互相覆盖计数。
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find((token) => token.id === id)?.name || id;
        currentRunningTokenId.value = id;
        tokenStatus.value[id] = "running";
        let connected = false;
        const ownedSlot = tokenStore.getWebSocketStatus(id) !== "connected";
        try {
          await ensureConnection(id);
          connected = true;
          const result = await runCampChallenge({
            now: () => new Date(tokenStore.getWebSocketClient?.(id)?.getServerTime?.() ?? +now()),
            loadConfig,
            send: (cmd, params) => tokenStore.sendMessageWithPromise(id, cmd, params, 10000),
            stopped: () => shouldStop.value,
            log: (text) => log(`${name}：${text}`),
            pause: () => sleep(Math.max(500, Number(batchSettings.commandDelay) || 500)),
          });
          tokenStatus.value[id] = "completed";
          log(`${name}：${result.reason || `营地挑战完成，今日 ${result.wins} 胜`}`, result.status === "completed" ? "success" : "info");
        } catch (error) {
          tokenStatus.value[id] = shouldStop.value ? "idle" : "failed";
          if (!shouldStop.value) failed++;
          log(`${name}：${error.message}`, shouldStop.value ? "warning" : "error");
        } finally {
          if (connected) {
            tokenStore.closeWebSocketConnection(id);
            if (ownedSlot) releaseConnectionSlot();
          }
        }
      }
    } finally {
      ids.forEach((id) => { if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "idle"; });
      const stopped = shouldStop.value;
      isRunning.value = false;
      currentRunningTokenId.value = null;
      log(stopped ? "营地批量任务已停止" : `营地批量任务结束，失败 ${failed} 个`, failed || stopped ? "warning" : "success");
      if (!stopped) message[failed ? "warning" : "success"]("营地批量任务已结束，请查看日志");
    }
  };
  return { batchCampSignup, batchCampChallenge };
}
