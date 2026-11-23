import { activityBody } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";
import { loadOfficialTaskConfig } from "./officialTaskConfig.js";
const get = (map, key) => map instanceof Map ? map.get(key) : map?.[key];
const entries = map => map instanceof Map ? [...map] : Object.entries(map || {});
export const starWeekStart = now => {
  const local = new Date(now + 8 * 3600000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000 - ((local.getUTCDay() + 6) % 7) * 86400000;
};
export const isStarMonday = now => new Date(now + 8 * 3600000).getUTCDay() === 1;
const integer = (v, label) => { if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${label}无效`); return v; };
function extraAttempts(role, config, now) {
  let result;
  for (const [id, value] of entries(role.privilege)) {
    const conf = config.PrivilegeConf?.[id];
    if (!conf || (value > 0 && value * 1000 < now && conf.expirationType === 0) ||
      (conf.expirationType === 1 && now > conf.expirationTime * 1000) ||
      (conf.expirationType === 3 && value * 1000 < now)) continue;
    for (const benefit of conf.benefit || []) if (benefit.type === 14) {
      const n = integer(benefit.value, "星级特权次数");
      result = conf.canMulti === 1 ? (result || 0) + n * value : Math.max(result || 0, n);
    }
  }
  return integer(result || 0, "星级特权次数");
}
export async function runNightmareStarOnce({ send, now = Date.now, mondayOnly = false, stopped = () => false, log = () => {}, loadConfig = loadOfficialTaskConfig, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const guard = () => {
    if (stopped()) throw Object.assign(new Error("星级挑战已停止"), { interrupted: true });
    if (mondayOnly && !isStarMonday(now())) throw new Error("已跨出周一，停止星级挑战");
  };
  if (mondayOnly && !isStarMonday(now())) { log("星级挑战跳过：仅周一执行"); return { challenged: 0, skipped: true }; }
  let lastRequestAt = -Infinity, lastFightAt = -Infinity;
  const request = async (cmd, params = {}) => {
    const fight = cmd === "nmext_startboss";
    // Conservative local pacing; the server has not published its cooldown.
    const delay = Math.max(0, lastRequestAt + 1000 - now(), fight ? lastFightAt + 5000 - now() : 0);
    if (delay) await sleep(delay);
    guard();
    lastRequestAt = now();
    if (fight) lastFightAt = now();
    try {
      const result = await send(cmd, params);
      const code = result?._raw?.code ?? result?.code;
      if (code !== undefined && code !== 0) throw Object.assign(new Error(`服务器错误${code}`), { code });
      return activityBody(result);
    } catch (error) {
      const failure = new Error(`${cmd}${params.bossId ? `（第${params.bossId}层）` : ""}：${error.message || error}`);
      failure.code = error.code; failure.interrupted = error.interrupted; failure.cause = error;
      throw failure;
    }
  };
  const role = extractRolePatch(await request("role_getroleinfo"));
  if (!role) throw new Error("角色状态未确认");
  const { dataBundleVer } = await request("system_getdatabundlever");
  if (typeof dataBundleVer !== "string") throw new Error("缺少官方配置版本");
  const config = await loadConfig(dataBundleVer);
  const threshold = integer(config.NightMareStarConstant?.nightMareStarUnlockLevel, "星级开放门槛");
  const key = "nm:w:m:boss", week = starWeekStart(now());
  if (!(get(role.statisticsTime, key) * 1000 >= week) || !(get(role.statistics, key) >= threshold)) {
    log(`星级挑战跳过：本周十殿通关尚未达到${threshold}层`); return { challenged: 0, skipped: true };
  }
  const bosses = Object.values(config.NightMareStarConf || {}).sort((a, b) => a.bossId - b.bossId);
  if (!bosses.length || bosses.some(b => !Number.isInteger(b.bossId) || b.bossId < 1 || b.bossId > 8)) throw new Error("星级层数配置无效");
  const bonus = extraAttempts(role, config, now());
  const readInfo = async () => {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { response = await request("nmext_getinfo"); break; }
      catch (error) {
        if (error.interrupted || !/(?:^|\D)400312(?:\D|$)/.test(`${error.code || ""} ${error.message}`) || attempt === 2) throw error;
        log("星级状态查询被限速，等待5秒后仅重查状态，不重复挑战", "warning");
        await sleep(5000);
      }
    }
    const data = response.roleNMExt;
    if (!data || !Number.isFinite(data.starResetTime) || data.starResetTime * 1000 < starWeekStart(now())) throw new Error("星级数据尚未刷新至本周，停止挑战");
    return data;
  };
  let info = await readInfo();
  const presets = (await request("presetteam_typegetinfo", { types: bosses.map(b => 100 + b.bossId) })).presetTeamMap;
  let challenged = 0;
  for (const boss of bosses) {
    guard();
    if (starWeekStart(now()) !== week) throw new Error("星级挑战已跨周，停止执行");
    const id = boss.bossId;
    const used = integer(get(info.starFightCntMap, id) ?? 0, "已挑战次数") + integer(get(info.privilegeStarFightCntMap, id) ?? 0, "已用特权次数");
    if (used >= integer(boss.challengeTime, "挑战次数上限") + bonus) { log(`星级第${id}层跳过：无剩余次数`); continue; }
    const team = get(presets, 100 + id);
    if (!team) { log(`星级第${id}层跳过：未保存该层阵容`, "warning"); continue; }
    const slots = entries(team.teamInfo);
    if (!slots.length || slots.some(([slot, hero]) => !/^[0-4]$/.test(String(slot)) || !Number.isSafeInteger(hero?.heroId) || hero.heroId <= 0)) throw new Error(`星级第${id}层保存阵容无效`);
    const params = { bossId: id, battleTeam: Object.fromEntries(slots.map(([slot, hero]) => [slot, hero.heroId])),
      lordWeaponId: team.weapon?.weaponId ?? 0, petUId: team.petUId ?? "", presetTeamType: 100 + id };
    if (!Number.isSafeInteger(params.lordWeaponId) || params.lordWeaponId < 0 || typeof params.petUId !== "string") throw new Error(`星级第${id}层玩具或宠物状态缺失`);
    let failure;
    try { await request("nmext_startboss", params); } catch (error) { failure = error; }
    info = await readInfo();
    const after = integer(get(info.starFightCntMap, id) ?? 0, "挑战后次数") + integer(get(info.privilegeStarFightCntMap, id) ?? 0, "挑战后特权次数");
    if (after <= used) throw failure || new Error(`星级第${id}层挑战消耗未确认，停止且不重发`);
    if (failure?.interrupted) throw failure;
    challenged++; log(`星级第${id}层已确认挑战一次${failure ? "（响应异常后查询确认，未重发）" : ""}`, "success");
  }
  log(`星级挑战结束：本次确认${challenged}层，每层最多一次`);
  return { challenged };
}
