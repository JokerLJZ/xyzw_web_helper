/** 营地挑战：低战力据点优先，普通挑战最多 12 次，宠物目标补齐当日 3 胜。 */
export const CAMP_TARGET_WINS = 3;
export const CAMP_MAX_ATTACKS = 12;

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
  const record = info.siege.attackMap[dateKey] || {};
  const attacks = Number(record.attackCnt ?? 0);
  const wins = Number(record.aSuccessCnt ?? 0);
  if (![attacks, wins].every((n) => Number.isInteger(n) && n >= 0) || wins > attacks) {
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

/** 仅用服务端个人次数确认结果；增量攻击响应不能替代完整状态。 */
export async function runCampChallenge({
  send, stopped = () => false, log = () => {},
  now = () => new Date(), pause = async () => {},
}) {
  const day = getCampDay(now());
  if (![2, 3, 4].includes(day.weekday)) return { status: "skipped", reason: "仅周二、周三、周四开放" };
  const check = () => {
    if (stopped()) throw new Error("任务已停止");
    if (getCampDay(now()).key !== day.key) throw new Error("日期已变化，请下次重新执行");
  };
  const request = async (cmd, params = {}) => {
    check();
    const result = await send(cmd, params);
    await pause();
    check();
    return result;
  };
  let info = await request("club_getinfo");
  let progress = getCampProgress(info, day.key);
  if (progress.wins >= CAMP_TARGET_WINS) return { status: "completed", ...progress };
  if (!info.club.oppoMap?.[day.weekday]) {
    return { status: "skipped", reason: "今日没有营地对阵" };
  }
  const { role } = await request("role_getroleinfo");
  const teamSetParams = buildCampTeam(role);
  const powers = new Map();
  const failedTargets = new Set();
  let normalAttempts = 0;

  const attack = async (cmd, params) => {
    const before = progress;
    let attackError;
    try {
      await request(cmd, { ...params, useItem: false, teamSetParams });
    } catch (error) {
      check();
      attackError = error;
    }
    // 包括请求超时：先核对服务端状态，禁止直接重复发送攻击。
    info = await request("club_getinfo");
    progress = getCampProgress(info, day.key);
    if (progress.attacks <= before.attacks || progress.wins < before.wins) {
      throw new Error(attackError
        ? `攻击结果未确认，停止重试：${attackError.message}`
        : "攻击后次数未增加，停止以避免重复挑战");
    }
    const won = progress.wins > before.wins;
    log(`${cmd === "club_attackmonster" ? "宠物目标" : "据点挑战"}${won ? "成功" : "未获胜"}，今日 ${progress.wins}/3 胜，出手 ${progress.attacks} 次`);
    return won;
  };

  while (progress.wins < CAMP_TARGET_WINS && progress.attacks < CAMP_MAX_ATTACKS && normalAttempts < CAMP_MAX_ATTACKS) {
    check();
    const defenders = info.club.oppoMap?.[day.weekday]?.defenders;
    if (!defenders) throw new Error("今日对阵已变化，停止挑战");
    const candidates = [];
    for (const [slot, target] of Object.entries(defenders)) {
      if (target.defeated || !target.roleId || !/^[1-9]\d*$/.test(slot)) continue;
      const key = `${slot}:${target.roleId}`;
      if (!powers.has(key)) {
        const team = await request("club_gettargetteam", { targetId: target.roleId });
        const power = Number(team?.roleBattleTeam?.role?.power ?? team?.teamInfo?.power);
        // 不把未知战力视作 0 战力目标。
        if (!Number.isFinite(power) || power < 0) throw new Error("无法读取目标战力，停止自动选人");
        powers.set(key, power);
      }
      candidates.push({ key, nodeId: Number(slot), ...target, power: powers.get(key) });
    }
    candidates.sort((a, b) => a.power - b.power || a.nodeId - b.nodeId);
    if (!candidates.length) {
      log("无可挑战据点，转为宠物目标补齐");
      break;
    }
    let target = candidates.find((item) => !failedTargets.has(item.key));
    if (!target) { failedTargets.clear(); target = candidates[0]; }
    // 排序期间其他账号可能已出手，攻击前重新读取目标计数。
    info = await request("club_getinfo");
    progress = getCampProgress(info, day.key);
    if (progress.wins >= CAMP_TARGET_WINS || progress.attacks >= CAMP_MAX_ATTACKS) break;
    const fresh = info.club.oppoMap?.[day.weekday]?.defenders?.[target.nodeId];
    if (!fresh || fresh.defeated || fresh.roleId !== target.roleId) {
      throw new Error("目标据点已变化，请重新执行");
    }
    const challengeCnt = Number(fresh.challengeCnt);
    const failCnt = Number(fresh.failCnt);
    if (![challengeCnt, failCnt].every((n) => Number.isInteger(n) && n >= 0)) {
      throw new Error("目标据点次数不完整");
    }
    log(`选择 #${target.nodeId} ${target.name || ""}，战力 ${target.power}`);
    normalAttempts++;
    const won = await attack("club_attack", {
      nodeId: target.nodeId, targetId: target.roleId, challengeCnt, failCnt,
    });
    if (!won) failedTargets.add(target.key);
  }
  // 每次补充都要求成功次数增长，失败即停止，避免无界消耗。
  while (progress.wins < CAMP_TARGET_WINS) {
    if (!await attack("club_attackmonster", {})) {
      throw new Error("宠物目标未获胜，已停止补充挑战");
    }
  }
  return { status: "completed", ...progress };
}

export function createTasksCamp(deps, {
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
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
          if (![2, 3, 4].includes(getCampDay(now()).weekday)) {
            log(`${name}：营地挑战仅周二至周四执行，已跳过`);
            tokenStatus.value[id] = "completed";
            continue;
          }
          await ensureConnection(id);
          connected = true;
          const result = await runCampChallenge({
            now,
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
  return { batchCampChallenge };
}
