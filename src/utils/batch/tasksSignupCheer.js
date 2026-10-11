import { extractRolePatch } from "../roleSnapshot.js";
const DAY = 86400000;
const configs = new Map();
const data = response => response?.data || response?._raw?.body || response?.body || response;
const values = map => map instanceof Map ? [...map.values()] : Object.values(map || {});
const field = (map, key) => map instanceof Map ? map.get(key) : map?.[key];
const dayTime = date => Date.parse(`${String(date).replaceAll("/", "-")}T00:00:00+08:00`);
const phase = time => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit"
}).format(new Date(time)).replaceAll("-", "");
const skipped = reason => ({
  status: "skipped",
  reason
});
export async function loadSignupCheerConfig(send, fetchConfig = globalThis.fetch) {
  const version = data(await send("system_getdatabundlever", {}))?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) throw new Error("未获取到有效游戏配置版本");
  if (!configs.has(version)) {
    const loading = (async () => {
      const response = await fetchConfig(`https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`, {
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error("游戏配置加载失败");
      return response.json();
    })();
    configs.set(version, loading);
    loading.catch(() => configs.delete(version));
  }
  return configs.get(version);
}
export function getGoldenCheerWindow(config, now = new Date()) {
  const time = +now;
  const session = values(config.SeasonLegionLeagueSessionConf).find(row => dayTime(row.startDate) < time && time < dayTime(row.endDate));
  if (!session) return null;
  // 当前 launcher LegionWarType：瑞士轮33～36，淘汰轮37～39。
  const rows = values(config.SeasonLegionScheduleConf).filter(row => Number(row.season) === Number(session.session) && [33, 34, 35, 36, 37, 38, 39].includes(Number(row.seasonLegionWarType))).sort((a, b) => Number(a.seasonLegionWarType) - Number(b.seasonLegionWarType));
  if (rows.length !== 7) return null;
  return {
    phase: phase(dayTime(rows[0].serverDate)),
    start: dayTime(rows[1].serverDate) + DAY,
    end: dayTime(rows[2].serverDate) + (20 * 60 - 5) * 60000
  };
}
export function getGoldenCheerLegions(response) {
  const list = data(response)?.legionList;
  if (!Array.isArray(list)) throw new Error("黄金天宫俱乐部列表不完整");
  return list.map((legion, index) => ({
    ...legion,
    index
  })).sort((a, b) => Number(b.sOWinCnt || 0) - Number(a.sOWinCnt || 0) || a.index - b.index).slice(0, 64).filter(row => Number(row.id) > 0);
}
function getWeek(now) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const today = dayTime(date);
  const weekday = new Date(today + 8 * 3600000).getUTCDay();
  return {
    today,
    weekday,
    monday: today - (weekday + 6) % 7 * DAY
  };
}
export async function runAutoCampSignup({
  send,
  config,
  now = () => new Date()
}) {
  const week = getWeek(now());
  if (![0, 5, 6].includes(week.weekday)) return skipped("营地报名仅周五至周日开放");
  if (!values(config.ClubWarScheduleConf).some(row => dayTime(row.startDate) <= +now() && +now() < dayTime(row.endDate) + DAY)) return skipped("当前没有营地赛季");
  const info = data(await send("club_getinfo", {}));
  if (!info?.club || typeof info.club.phase !== "string" || (info.club.phase && !/^\d{6}$/.test(info.club.phase))) throw new Error("营地报名状态不完整");
  if (info.club.phase && dayTime(`20${info.club.phase.slice(0, 2)}-${info.club.phase.slice(2, 4)}-${info.club.phase.slice(4, 6)}`) > week.monday) return skipped("本轮营地已报名");
  const role = extractRolePatch(await send("role_getroleinfo", {}));
  const legionInfo = data(await send("legion_getinfo", {}));
  const legion = legionInfo?.info;
  if (!legion || !role?.roleId) return skipped("没有可报名的俱乐部");
  const members = values(legion.members),
    self = members.find(member => String(member.roleId) === String(role.roleId));
  if (![1, 2].includes(Number(self?.job))) return skipped("仅会长或副会长可报名营地");
  const limit = config.ClubWarConstantConf;
  if (![limit?.peopleNum, limit?.powerNum, limit?.signUpNum].every(Number.isFinite)) throw new Error("营地报名配置不完整");
  const signin = Number(field(legion.statisticsTime, "week:sign:in")) * 1000 >= week.monday ? Number(field(legion.statistics, "week:sign:in") || 0) : 0;
  const power = members.reduce((sum, m) => sum + Number(m.power || 0), 0);
  if (!Number.isFinite(power) || !Number.isFinite(signin)) throw new Error("营地战力或签到数据异常");
  if (members.length < limit.peopleNum || power < limit.powerNum || signin < limit.signUpNum) return skipped("营地报名条件不足（成员数、总战力或本周签到）");
  if (getWeek(now()).monday !== week.monday || ![0, 5, 6].includes(getWeek(now()).weekday)) return skipped("营地报名窗口已变化");
  await send("club_signup", {});
  const fresh = data(await send("club_getinfo", {}));
  if (!fresh?.club?.phase || fresh.club.phase <= phase(week.monday)) throw new Error("营地报名结果未确认，请查看游戏状态");
  return {
    status: "completed",
    reason: "营地报名成功"
  };
}
function payloadBellLimit(config, firstMonthDate, time) {
  let season = 1;
  if (firstMonthDate) {
    const schedule = values(config.LegionScheduleConf).sort((a, b) => Number(a.id) - Number(b.id));
    const first = schedule.find(row => row.legionWarType === 2 && dayTime(row.serverDate) >= dayTime(firstMonthDate));
    const current = [...new Set(schedule.map(row => row.season))].find(num => time < Math.max(...schedule.filter(row => row.season === num).map(row => dayTime(row.serverDate))) + DAY);
    if (!first || !current) throw new Error("无法确认蟠桃报名赛季");
    season = current - first.season + 1;
  }
  return config.PayLoadConstant.lingdangLimit.find(row => row[0] === Math.min(season, 7))?.[1] ?? 100;
}
export async function runAutoPeachSignup({
  send,
  config,
  now = () => new Date()
}) {
  const time = +now(),
    week = getWeek(now());
  const match = values(config.PayLoadScheduleConf).find(row => dayTime(row.serverDate) === week.today);
  if (!match) return skipped("今日没有蟠桃报名场次");
  const constants = config.PayLoadConstant;
  if (![constants?.regTime, constants?.regLast, constants?.legionPeopleLimit].every(Number.isFinite)) throw new Error("蟠桃报名配置不完整");
  const start = week.today + constants.regTime * 3600000,
    end = start + constants.regLast * 1000;
  if (time < start || time >= end) return skipped("不在蟠桃报名时间内");
  const info = data(await send("legion_getpayloadlegioninfo", {}));
  if (!info?.legion) return skipped("没有可报名的俱乐部");
  if (String(field(info.legion.statistics, "payload:war:sign:up")) === phase(week.today)) return skipped("本期蟠桃已报名");
  const role = extractRolePatch(await send("role_getroleinfo", {}));
  const members = values(info.legion.members),
    self = members.find(m => String(m.roleId) === String(role?.roleId));
  if (![1, 2].includes(Number(self?.job))) return skipped("仅会长或副会长可报名蟠桃");
  if (Number(info.lockedLegionId) !== 0) return skipped("当前俱乐部已锁定，无法报名蟠桃");
  const legionInfo = data(await send("legion_getinfo", {}));
  if (legionInfo?.firstMonthDate === undefined) throw new Error("蟠桃赛季信息不完整");
  const bellNeed = payloadBellLimit(config, legionInfo.firstMonthDate, time);
  const bells = members.reduce((sum, m) => sum + Number(field(m.custom, "payload_item_cnt") || 0), 0);
  if (!Number.isFinite(bells) || !Number.isFinite(bellNeed)) throw new Error("蟠桃铃铛数据异常");
  if (members.length < constants.legionPeopleLimit || bells < bellNeed) return skipped(`蟠桃报名条件不足（人数${members.length}/${constants.legionPeopleLimit}，铃铛${bells}/${bellNeed}）`);
  if (+now() >= end || +now() < start) return skipped("蟠桃报名窗口已变化");
  await send("legion_payloadsignup", {});
  const fresh = data(await send("legion_getpayloadlegioninfo", {}));
  if (String(field(fresh?.legion?.statistics, "payload:war:sign:up")) !== phase(week.today)) throw new Error("蟠桃报名结果未确认，请查看游戏状态");
  return {
    status: "completed",
    reason: "蟠桃报名成功"
  };
}
export async function runGoldenCheer({
  send,
  config,
  legionId,
  expectedPhase,
  now = () => new Date()
}) {
  const window = getGoldenCheerWindow(config, now());
  if (!window || +now() < window.start || +now() >= window.end) return skipped("不在黄金天宫助威时间内");
  if (expectedPhase !== window.phase) return skipped("助威期次已变化，请重新选择俱乐部");
  const role = extractRolePatch(await send("role_getroleinfo", {}));
  if (!role?.statistics) throw new Error("无法确认当前账号助威状态");
  if (Number(role.statistics[`sr:out:cheer:${window.phase}`]) > 0) return skipped("本期已助威，不重复或更改目标");
  const list = getGoldenCheerLegions(await send("saltroad_getseasonoutrank", {}));
  if (!list.some(row => String(row.id) === String(legionId))) return skipped("所选俱乐部不在本期助威列表中");
  if (+now() >= window.end) return skipped("黄金天宫助威时间已结束");
  await send("saltroad_outcheer", {
    legionId: Number(legionId)
  });
  const fresh = extractRolePatch(await send("role_getroleinfo", {}));
  if (Number(fresh?.statistics?.[`sr:out:cheer:${window.phase}`]) !== Number(legionId)) throw new Error("助威结果未确认，请查看游戏状态");
  return {
    status: "completed",
    reason: "黄金天宫助威成功"
  };
}
export function createTasksSignupCheer(deps, {
  now = () => new Date(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  loadConfig = loadSignupCheerConfig
} = {}) {
  const {
    tokenStore,
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    currentRunningTokenId,
    ensureConnection,
    releaseConnectionSlot,
    addLog,
    message,
    batchSettings
  } = deps;
  const log = (text, type = "info") => addLog({
    time: new Date().toLocaleTimeString(),
    message: text,
    type
  });
  async function withAccount(id, execute) {
    const owned = tokenStore.getWebSocketStatus(id) !== "connected";
    let connected = false;
    try {
      await ensureConnection(id);
      connected = true;
      const send = async (cmd, params = {}) => {
        if (shouldStop.value) throw new Error("任务已停止");
        const result = await tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
        await sleep(Math.max(500, Number(batchSettings.commandDelay) || 500));
        if (shouldStop.value) throw new Error("任务已停止");
        return result;
      };
      return await execute(send);
    } finally {
      if (connected && owned) {
        try { tokenStore.closeWebSocketConnection(id); } finally { releaseConnectionSlot(); }
      }
    }
  }
  async function batch(label, runner, options = {}) {
    if (!selectedTokens.value.length) return;
    isRunning.value = true;
    shouldStop.value = false;
    const ids = [...selectedTokens.value];
    ids.forEach(id => tokenStatus.value[id] = "waiting");
    let failed = 0,
      success = 0,
      skips = 0;
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        currentRunningTokenId.value = id;
        tokenStatus.value[id] = "running";
        const name = tokens.value.find(t => t.id === id)?.name || id;
        try {
          const result = await withAccount(id, async send => runner({
            send,
            config: await loadConfig(send),
            now,
            ...options
          }));
          tokenStatus.value[id] = result.status;
          result.status === "skipped" ? skips++ : success++;
          log(`${name}：${result.reason}`, result.status === "completed" ? "success" : "info");
        } catch (error) {
          tokenStatus.value[id] = shouldStop.value ? "stopped" : "failed";
          if (!shouldStop.value) failed++;
          log(`${name}：${label}失败 - ${error.message}`, "error");
        }
      }
    } finally {
      ids.forEach(id => {
        if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "stopped";
      });
      isRunning.value = false;
      currentRunningTokenId.value = null;
      log(`${label}结束：成功${success}，跳过${skips}，失败${failed}`, failed ? "warning" : "info");
      if (!shouldStop.value) message[failed ? "warning" : "success"](`${label}结束，请查看日志`);
    }
  }
  return {
    batchCampSignup: () => batch("自动营地报名", runAutoCampSignup),
    batchPeachSignup: () => batch("自动蟠桃报名", runAutoPeachSignup),
    batchGoldenCheer: options => batch("黄金天宫助威", runGoldenCheer, options),
    async fetchGoldenCheerList(id) {
      return withAccount(id, async send => {
        const config = await loadConfig(send),
          window = getGoldenCheerWindow(config, now());
        if (!window || +now() < window.start || +now() >= window.end) throw new Error("当前不在黄金天宫助威时间内");
        return {
          window,
          list: getGoldenCheerLegions(await send("saltroad_getseasonoutrank", {}))
        };
      });
    }
  };
}
