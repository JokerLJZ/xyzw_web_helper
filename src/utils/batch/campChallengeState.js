const values = map => map instanceof Map ? [...map.values()] : Object.values(map || {});
export const campField = (map, key) => map instanceof Map ? map.get(key) : map?.[key];
export const campHas = (map, key) => map instanceof Map ? map.has(key) : Object.hasOwn(map || {}, key);
const dateTime = value => Date.parse(`${String(value).replaceAll("/", "-")}T00:00:00+08:00`);
export function campMidnight(now) {
  return dateTime(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now));
}
function integer(value, label, minimum = 0) {
  if (value == null || value === "" || !Number.isInteger(Number(value)) || Number(value) < minimum) throw new Error(`${label}配置或数据异常`);
  return Number(value);
}
export function getCampRules(config, role, now) {
  const constant = config?.ClubWarConstantConf;
  if (!constant) throw new Error("营地配置不完整");
  const window = constant.matchDayBattleTime;
  if (!Array.isArray(window) || window.length !== 2) throw new Error("营地开放时间配置异常");
  const start = integer(window[0], "开放时间");
  const end = integer(window[1], "结束时间");
  if (end <= start || end > 86400) throw new Error("营地开放时间配置异常");
  const expiry = campField(role?.statisticsTime, "paid:car:s");
  if (expiry != null && (!Number.isFinite(Number(expiry)) || Number(expiry) < 0)) throw new Error("营地特权有效期异常");
  const active = Number(expiry || 0) * 1000 > +now;
  const attacks = integer(constant.challengeNum, "挑战次数", 1) + (active ? integer(constant.extraChallengeNum, "额外挑战次数") : 0);
  const winLimit = integer(constant.SuccessfulChallengeNum, "成功次数", 1) + (active ? integer(constant.extraSuccessfulChallengeNum, "额外成功次数") : 0);
  const seasons = values(config.ClubWarScheduleConf);
  if (!seasons.length || seasons.some(row => !Number.isFinite(dateTime(row.startDate)) || !Number.isFinite(dateTime(row.endDate)))) throw new Error("营地赛季配置异常");
  const inSeason = seasons.some(row => dateTime(row.startDate) <= +now && +now < dateTime(row.endDate) + 86400000);
  return { attacks, winLimit, targetWins: Math.min(3, winLimit), start: campMidnight(now) + start * 1000, end: campMidnight(now) + end * 1000, inSeason };
}
export function campEligibility(info, role, now) {
  const weekday = new Date(campMidnight(now) + 8 * 3600000).getUTCDay();
  const monday = campMidnight(now) - (weekday + 6) % 7 * 86400000;
  const phase = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "2-digit", month: "2-digit", day: "2-digit" }).format(new Date(monday)).replaceAll("-", "");
  if (String(info.club.phase) !== phase) return "本周俱乐部未报名";
  if (!Number.isSafeInteger(Number(role?.roleId)) || Number(role.roleId) <= 0) throw new Error("当前角色ID不完整");
  if (!info.club.members || !values(info.club.members).some(member => Number(member.roleId) === Number(role.roleId))) return "当前账号不在营地参战名单";
  return null;
}
export function campDifficulty(target, config) {
  const challengeCnt = integer(target.challengeCnt ?? 0, "据点挑战次数");
  const failCnt = integer(target.failCnt ?? 0, "据点失败次数");
  if (failCnt > challengeCnt) throw new Error("目标据点次数异常");
  const rows = values(config.ClubWarDifficultConf).sort((a, b) => a.id - b.id);
  if (!rows.length) throw new Error("营地难度配置不完整");
  let total = 0;
  for (const row of rows) {
    total += integer(row.hp, "难度次数", 1);
    if (challengeCnt - failCnt < total) return integer(row.Difficult, "难度", 1);
  }
  return integer(rows.at(-1).Difficult, "难度", 1);
}
export function campTaskState(info, config, now) {
  const siege = info.siege;
  const reset = Number(siege.taskResetTime ?? 0);
  if (!Number.isFinite(reset) || reset < 0) throw new Error("营地任务重置时间异常");
  const current = reset > 0 && campMidnight(new Date(reset * 1000)) === campMidnight(now);
  const rows = values(config.ClubWarTaskConf);
  if (!rows.length) throw new Error("营地任务配置不完整");
  const claimed = row => current && campHas(siege.taskClaimedMap, row.id);
  const previous = new Map();
  const visible = rows.filter(row => {
    if (row.ifAbandon === 1) return false;
    const last = previous.get(row.taskTeam);
    if (last && !claimed(last)) return false;
    previous.set(row.taskTeam, row);
    return true;
  });
  const ready = visible.filter(row => {
    const count = current ? Number(campField(siege.taskProgress, row.ClubWarTaskType) ?? 0) : 0;
    if (!Number.isFinite(count) || count < 0) throw new Error("营地任务进度异常");
    return !claimed(row) && count >= integer(row.completeValue, "任务目标", 1);
  });
  return { current, ready, claimed, visible };
}
export function campBattleWon(response) {
  const result = response?.battleData?.result;
  if (!result || typeof result !== "object" || Array.isArray(result) || !Object.keys(result).length) throw new Error("挑战战斗结果无法确认");
  // 官方BattleResult默认isWin=false；有效结果省略字段按协议默认值处理。
  if (result.isWin !== undefined && typeof result.isWin !== "boolean") throw new Error("挑战胜负字段异常");
  return result.isWin ?? false;
}
export function campRecords(response, now) {
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("营地战报数据不完整");
  const records = response.records ?? [];
  if (!Array.isArray(records)) throw new Error("营地战报数据不完整");
  const start = campMidnight(now) / 1000;
  return records.filter(record => Number(record?.created) >= start && Number(record.created) < start + 86400).map(record => ({
    ...record, roleId: record.roleId ?? 0, monsterId: record.monsterId ?? 0,
    isWin: record.isWin ?? false, mirror: record.mirror ?? false,
  }));
}
export function campRecordKey(record) {
  return typeof record.recordName === "string" && record.recordName ? record.recordName : null;
}
