import { createApexRules, ApexStageType } from "./apexRules.js";
import { ApexAction, runApexAction } from "./apexRateLimit.js";

const DAY = 86400000;
const CONFIGS = new Map();
const ACTIVE = new Map();
const data = response => response?.data || response?._raw?.body || response?.body || response;
const field = (map, key) => map instanceof Map ? map.get(key) : map?.[key];
const list = map => map instanceof Map ? [...map.values()] : Object.values(map || {});
const count = (value, label) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label}数据不完整`);
  return number;
};
const guessIds = (info, id) => {
  const ids = field(info.guessMap, id) ?? [];
  if (!Array.isArray(ids)) throw new Error("竞猜记录格式异常");
  return ids.map(String);
};
const voteCount = (info, round, teamId) => count(field(field(info.voteMap, round), teamId)?.cnt ?? 0, "个人助威次数");

export function getApexChinaDate(time) {
  const d = new Date(Number(time) + 8 * 3600000);
  const zero = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600000;
  return { day: String(zero), week: String(zero - (d.getUTCDay() + 6) % 7 * DAY), weekday: d.getUTCDay() };
}

export function buildApexDailyRules(config) {
  const schedules = list(config?.ApexScheduleConf), seasons = list(config?.ApexSeasonConf), tasks = list(config?.ApexTaskConf);
  if (!schedules.length || !seasons.length || !tasks.length ||
      schedules.some(row => !Number.isInteger(row.id) || !Number.isInteger(row.ApexStage) || !Number.isInteger(row.round) || !Number.isInteger(row.season) || !/^\d{4}\/\d{2}\/\d{2}$/.test(row.serverDate) || ![row.lockTime, row.fightTime, row.endTime, row.advanceNum].every(Number.isFinite)) ||
      tasks.some(row => !Number.isInteger(row.id) || !Number.isInteger(row.ApexTaskType) || !(row.completeValue > 0))) {
    throw new Error("逐鹿盐山官方配置不完整，停止自动操作");
  }
  return createApexRules({
    apexScheduleMap: Object.fromEntries(schedules.map(row => [row.id, { ...row, date: row.serverDate, stage: row.ApexStage }])),
    apexSeasonConf: Object.fromEntries(seasons.map(row => [row.season, row])),
    apexStageNames: Object.fromEntries(list(config.ApexStageConf).map(row => [row.ApexStage, row])),
    apexSupportLevels: list(config.ApexSupportLevelConf),
  }, { chinaTime: true });
}

export async function loadApexDailyConfig(send, fetchConfig = globalThis.fetch) {
  const version = data(await send("system_getdatabundlever", {}))?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) throw new Error("未取得逐鹿盐山配置版本");
  if (!CONFIGS.has(version)) {
    const loading = (async () => {
      const response = await fetchConfig(`https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("逐鹿盐山配置读取失败");
      const config = await response.json();
      buildApexDailyRules(config);
      return config;
    })();
    CONFIGS.set(version, loading);
    loading.catch(() => CONFIGS.delete(version));
  }
  return CONFIGS.get(version);
}

const operationLabel = (command, params) => ({
  apex_getroleinfo: "查询逐鹿盐山账号状态",
  apex_getguesslist: `查询赛程${params.scheduleId}对阵列表`,
  apex_getvotelist: `查询第${params.round}期助威列表`,
  apex_guess: `预测队伍${params.teamId}`,
  apex_guessclaim: `领取赛程${params.scheduleId}队伍${params.teamId}竞猜奖励`,
  apex_vote: `助威队伍${params.teamId}`,
  apex_taskclaim: `领取大厅任务${params.confId}奖励`,
  system_getdatabundlever: "读取当前游戏配置版本",
})[command] || command;

/** 写请求不在限流器中盲目重发，失败后由账号状态确认是否实际生效。 */
export function createApexDailySender({ send, stopped = () => false, log = () => {}, action = runApexAction, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let lastResponseAt = -Infinity;
  let lastWaitLogAt = -Infinity;
  const reportWait = (ms, context = {}) => {
    const rateLimited = context.reason === "rate-limit";
    if (!rateLimited && (ms < 3000 || now() - lastWaitLogAt < 10000)) return;
    lastWaitLogAt = now();
    log(rateLimited
      ? `逐鹿盐山触发服务器限速，等待${Math.ceil(ms / 1000)}秒后重试`
      : `逐鹿盐山正在等待请求间隔，约${Math.ceil(ms / 1000)}秒`);
  };
  return (command, params = {}) => action(
    command === "apex_vote" ? ApexAction.VOTE : command === "apex_guess" ? ApexAction.GUESS : ApexAction.READ,
    async () => {
      const writes = ["apex_vote", "apex_guess", "apex_taskclaim", "apex_guessclaim"];
      for (let attempt = 0; ; attempt++) {
        const wait = Math.max(0, lastResponseAt + 1500 - now());
        if (wait > 0) await pause(wait);
        if (stopped()) throw Object.assign(new Error("逐鹿盐山任务已停止"), { interrupted: true });
        let responseEndedAt;
        try {
          return await send(command, params);
        } catch (error) {
          responseEndedAt = now();
          if (!writes.includes(command) && /200020/.test(`${error?.code} ${error?.message}`) && attempt === 0) {
            log(`${operationLabel(command, params)}返回临时错误，等待6秒后重试一次`);
            lastResponseAt = now();
            await pause(6000);
            continue;
          }
          if (!error.interrupted) error.message = `${operationLabel(command, params)}失败：${error.message}`;
          throw error;
        } finally {
          lastResponseAt = responseEndedAt ?? now();
        }
      }
    },
    { maxRetry: ["apex_vote", "apex_guess", "apex_taskclaim", "apex_guessclaim"].includes(command) ? 0 : 1,
      onWait: reportWait },
  );
}

/** 每个账号独立执行；记录仅在确认服务器结果后写入，异常允许重新复查。 */
export async function runApexDailyTask(options) {
  const { accountId } = options;
  if (!accountId) throw new Error("逐鹿盐山任务缺少账号标识");
  if (ACTIVE.has(accountId)) return { status: "skipped", reason: "该账号逐鹿盐山任务正在执行" };
  const pending = runAccount(options);
  ACTIVE.set(accountId, pending);
  try { return await pending; } finally { ACTIVE.delete(accountId); }
}

export const runApexGuessTask = options => runApexDailyTask({ ...options, guessOnly: true });

async function runAccount({ guessOnly = false, accountId, send, config, loadConfig = loadApexDailyConfig, now = Date.now, stopped = () => false, log = () => {}, storage = globalThis.localStorage, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!storage?.getItem || !storage?.setItem) throw new Error("无法保存逐鹿盐山执行记录，停止自动操作");
  const key = `apex-daily:v1:${accountId}`;
  const record = JSON.parse(storage.getItem(key) || "{}");
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("逐鹿盐山本地执行记录异常");
  const today = getApexChinaDate(now());
  const checkedToday = !guessOnly && record.checkedDay === today.day && !record.pending;
  const save = () => storage.setItem(key, JSON.stringify(record));
  const guard = () => {
    if (stopped()) throw Object.assign(new Error("逐鹿盐山任务已停止"), { interrupted: true });
    if (getApexChinaDate(now()).day !== today.day) throw new Error("逐鹿盐山执行期间已跨日，请重新执行");
  };
  const readRole = async () => {
    guard();
    const info = data(await send("apex_getroleinfo", {}))?.apexRoleInfo;
    if (!info || !info.guessMap || !info.guessClaimMap || !info.voteMap || !info.taskProgress || !info.taskClaimedMap || !info.resetTime) throw new Error("逐鹿盐山账号状态不完整");
    guard();
    return info;
  };
  let info = await readRole();
  config ||= await loadConfig(send);
  const rules = buildApexDailyRules(config);
  const season = rules.getCurrentSeason(now());
  if (season > 0 && Number(info.resetTime.season) !== season) throw new Error("逐鹿盐山账号赛季与当前配置不一致，请刷新游戏状态");
  // 中断后重新查询，确认历史写操作；跨赛季/周无法可靠复查时不自动重发。
  if (record.pending) {
    const pending = record.pending;
    if ((["apex_vote", "apex_taskclaim"].includes(pending.command) && pending.week !== today.week) || pending.season !== season) throw new Error("上次逐鹿盐山操作结果待确认，期次已变化，请先检查游戏状态");
    if (pending.command === "apex_vote") {
      const actual = voteCount(info, pending.params.round, pending.params.teamId);
      if (actual < pending.before || (actual > pending.before && actual < pending.before + pending.params.voteCnt)) throw new Error("上次助威数量未完全确认，请检查游戏状态");
    }
    delete record.pending; save();
  }
  const writeVerified = async (command, params, applied, before = 0) => {
    guard();
    record.pending = { command, params, before, season, week: today.week };
    save();
    let failure;
    try { await send(command, params); } catch (error) { if (error.interrupted) throw error; failure = error; }
    if (failure && /200020|200400/.test(`${failure.code} ${failure.message}`)) {
      log(`${operationLabel(command, params)}返回临时错误，等待6秒后确认服务器结果`);
      await pause(6000);
    }
    info = await readRole();
    if (!applied(info)) {
      const error = new Error(`${operationLabel(command, params)}结果未确认：${failure?.message || "服务器状态未确认"}，已停止，重新执行会先查询状态`, { cause: failure });
      if (failure?.code !== undefined) error.code = failure.code;
      throw error;
    }
    delete record.pending; save();
  };
  const claimTasks = async () => {
    for (const task of list(config.ApexTaskConf).sort((a, b) => a.id - b.id)) {
      guard();
      if (field(info.taskClaimedMap, task.id)) continue;
      const progress = count(field(info.taskProgress, task.ApexTaskType) ?? 0, "大厅任务进度");
      if (progress < task.completeValue) continue;
      await writeVerified("apex_taskclaim", { confId: task.id }, latest => Boolean(field(latest.taskClaimedMap, task.id)));
      log(`竞技大厅任务${task.id}奖励已领取`);
    }
  };

  if (!guessOnly && !checkedToday && today.weekday === 1 && record.supportWeek !== today.week) {
    const round = rules.getCurrentRounds(season, now()).find(round => rules.checkSupportInTime(round, season, now()));
    const initialCount = count(info.voteItemCnt, "助威道具数量");
    if (!round) log("周一助威跳过：当前不在可助威窗口");
    else if (!initialCount) log("周一助威跳过：没有助威道具");
    else {
      const stageInfo = rules.getStageInfoByRound(round, season, now());
      const stage = stageInfo[ApexStageType.TaoTai].isEnable ? ApexStageType.TaoTai : ApexStageType.ZhengShi;
      const scheduleId = rules.getScheduleIdByStage(stage, round, season);
      const groupId = stage === ApexStageType.TaoTai ? 0 : rules.getSupportGroupId(info.group instanceof Map ? Object.fromEntries(info.group) : info.group, scheduleId);
      // 游戏列表按服务端顺序展示；遇到淘汰队伍继续分页寻找第一支可助威队伍。
      let target, idx = 0, voteListEnded = false;
      for (let page = 0; page < 50; page++) {
        guard();
        const response = data(await send("apex_getvotelist", { round, groupId, idx }));
        if (!Array.isArray(response?.apexVoteList)) throw new Error("助威队伍列表不完整");
        target = response.apexVoteList.find(team => team?.teamId && team.isOut !== true);
        voteListEnded = response.last === true;
        if (target || voteListEnded) break;
        if (!response.apexVoteList.length) throw new Error("助威列表分页未结束且没有数据");
        idx += response.apexVoteList.length;
      }
      if (!target && !voteListEnded) throw new Error("助威清单未完整读取，停止自动助威");
      if (!target) log("周一助威跳过：没有可助威队伍");
      else {
        let remaining = initialCount;
        while (remaining > 0) {
          guard();
          if (!rules.checkSupportInTime(round, season, now())) throw new Error("助威窗口已关闭，剩余道具未使用");
          const inventory = count(info.voteItemCnt, "助威道具数量");
          const voteCnt = Math.min(9999, remaining, inventory);
          if (!voteCnt) throw new Error("助威道具库存发生变化，停止自动操作");
          const before = voteCount(info, round, target.teamId);
          await writeVerified("apex_vote", { round, teamId: target.teamId, voteCnt }, latest => voteCount(latest, round, target.teamId) >= before + voteCnt && count(latest.voteItemCnt, "助威道具数量") <= inventory - voteCnt, before);
          remaining -= voteCnt;
          log(`助威${target.name || target.teamId}成功，使用${voteCnt}个道具，本次剩余${remaining}个`);
        }
        record.supportWeek = today.week; save();
      }
    }
    // 同周助威已完成而领奖中断时，重新运行仍应补领大厅奖励。
    await claimTasks();
  } else if (!guessOnly && !checkedToday && (today.weekday === 1 || today.weekday === 0)) {
    await claimTasks();
  }

  // 每个开放赛程先完整分页，再逐组选择支持人数较多的一方；已预测的对阵保持原选择。
  let guesses = 0;
  for (const round of checkedToday ? [] : rules.getCurrentRounds(season, now())) {
    for (const tab of rules.getGuessTabs(round, season, now())) {
      guard();
      if (!rules.canGuessNow(tab.state)) continue;
      const maximum = rules.getAdvanceNum(round, season, tab.stage);
      if (maximum <= 0 || guessIds(info, tab.scheduleId).length >= maximum) continue;
      const groups = []; let last = false;
      for (let page = 0; page < 50 && !last; page++) {
        guard();
        const response = data(await send("apex_getguesslist", { scheduleId: tab.scheduleId, idx: groups.length }));
        if (!Array.isArray(response?.apexGuessList)) throw new Error("可预测清单不完整");
        if (!response.apexGuessList.length && response.last !== true) throw new Error("可预测清单分页未结束且没有数据");
        groups.push(...response.apexGuessList); last = response.last === true;
      }
      if (!last) throw new Error("可预测清单未完整读取，停止预测");
      for (const group of groups) {
        guard();
        if (!rules.canGuessNow(rules.getScheduleStatus(tab.scheduleId, now()))) break;
        const ids = guessIds(info, tab.scheduleId);
        if (ids.length >= maximum) break;
        if (!Array.isArray(group) || group.length !== 2 || group.some(team => !team?.teamId)) throw new Error("预测对阵格式异常");
        if (group.some(team => ids.includes(String(team.teamId)))) continue;
        if (tab.stage === 10 && group.some(team => team.isWin === true)) continue;
        const [left, right] = group;
        const leftCount = count(left.cheerCnt, "左队支持人数"), rightCount = count(right.cheerCnt, "右队支持人数");
        const pick = leftCount >= rightCount ? left : right;
        await writeVerified("apex_guess", { teamId: pick.teamId }, latest => guessIds(latest, tab.scheduleId).includes(String(pick.teamId)));
        guesses++;
        log(`${tab.title}预测支持${pick.name || pick.teamId}（支持人数${Math.max(leftCount, rightCount)}）`);
      }
    }
  }
  let rewards = 0;
  for (const [scheduleKey, predicted] of info.guessMap instanceof Map ? info.guessMap.entries() : Object.entries(info.guessMap)) {
    guard();
    const scheduleId = Number(scheduleKey);
    const claimMap = field(info.guessClaimMap, scheduleKey);
    if (!claimMap || !rules.getScheduleConf(scheduleId) || !Array.isArray(predicted)) continue;
    const pendingIds = predicted.filter(id => field(claimMap, id) === false).map(String);
    if (!pendingIds.length) continue;
    const groups = []; let last = false;
    for (let page = 0; page < 50 && !last; page++) {
      guard();
      const response = data(await send("apex_getguesslist", { scheduleId, idx: groups.length }));
      if (!Array.isArray(response?.apexGuessList) || (!response.apexGuessList.length && response.last !== true)) throw new Error("竞猜奖励对阵清单不完整");
      groups.push(...response.apexGuessList); last = response.last === true;
    }
    if (!last) throw new Error("竞猜奖励对阵清单未完整读取");
    for (const group of groups) {
      if (!Array.isArray(group)) throw new Error("竞猜奖励对阵格式异常");
      for (const team of group) {
        if (!pendingIds.includes(String(team?.teamId)) || team.isWin !== true || team.isOut !== false || field(field(info.guessClaimMap, scheduleKey), team.teamId) !== false) continue;
        await writeVerified("apex_guessclaim", { scheduleId, teamId: team.teamId }, latest => field(field(latest.guessClaimMap, scheduleKey), team.teamId) === true);
        rewards++;
        log(`竞猜奖励已领取：赛程${scheduleId}，${team.name || team.teamId}`);
      }
    }
  }
  guard(); if (!guessOnly) record.checkedDay = today.day; save();
  return { status: "completed", reason: `逐鹿盐山检查完成，新增${guesses}次预测，领取${rewards}份竞猜奖励${checkedToday ? "（今天已检查，跳过重复预测）" : ""}`, guesses, rewards };
}
