import { extractRolePatch } from "./roleSnapshot.js";

const body = response => response?._raw?.body || response?.body || response?.data || response;
const entries = map => map instanceof Map ? [...map.entries()] : Object.entries(map || {});
const get = (map, key) => map instanceof Map ? (map.get(key) ?? map.get(String(key))) : map?.[key];
const values = map => entries(map).map(([, value]) => value);
const DAY = 86400000;
const dayStart = time => Math.floor((time + 8 * 3600000) / DAY) * DAY - 8 * 3600000;
export const SKIN_CHALLENGE_MAX_CONSECUTIVE_FAILURES = 5;
const count = value => {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0 || value === null || typeof value === "boolean" || value === "") throw new Error("闯关次数数据异常");
  return n;
};

/** getInfo/start 为完整 ActGDTowers，fight.towerData 则仅为单塔 GDTowers。 */
export function normalizeSkinTowerSnapshot(response, actId) {
  const data = body(response);
  const source = data?.actId ? data : data?.towerData;
  if (!source || Number(source.actId) !== Number(actId)) throw new Error("闯关活动状态不完整或活动已切期");
  const towerData = Object.fromEntries(entries(source.towerData).map(([key, row]) => [key, { ...row, towerType: Number(row.towerType ?? key) }]));
  return { ...source, actId: Number(source.actId), todayUseTickCnt: count(source.todayUseTickCnt), useTickCnt: count(source.useTickCnt), towerData, levelRewardMap: Object.fromEntries(entries(source.levelRewardMap)) };
}
export function getSkinChallengeBudget(activity, towers, reserve = 0) {
  if (!Array.isArray(activity.parameters) || activity.parameters.length < 2) throw new Error("闯关次数配置不完整");
  const daily = count(activity.parameters?.[1]) + 1;
  const total = count(activity.parameters?.[0]);
  const used = count(towers.todayUseTickCnt);
  return Math.max(0, Math.min(daily - used - reserve, total - count(towers.useTickCnt) + (used === 0 ? 1 : 0)));
}
export function buildMainlineTowerTeam(role) {
  const battleTeam = {};
  for (const [slot, hero] of entries(role?.battleTeam)) {
    const heroId = Number(typeof hero === "object" ? hero?.heroId : hero);
    if (!/^[0-4]$/.test(String(slot)) || !Number.isSafeInteger(heroId) || heroId <= 0) throw new Error("主线阵容包含无效武将或位置，停止布阵");
    battleTeam[slot] = heroId;
  }
  if (!Object.keys(battleTeam).length) throw new Error("未取得该账号主线出战阵容，停止挑战");
  return { teamType: 6, battleTeam, lordWeaponId: count(role.lordWeaponId), petUId: role.pet?.petUId || "", cCMonsterId: 0 };
}
export function isMainlineTowerTeamSaved(response, expected) {
  const saved = body(response)?.roleTeam;
  const team = get(saved?.battleTeamInfo, 6);
  if (!team) return false;
  const actual = Object.fromEntries(entries(team).map(([slot, hero]) => [slot, Number(typeof hero === "object" ? hero.heroId : hero)]));
  return entries(expected.battleTeam).length === entries(actual).length && entries(expected.battleTeam).every(([slot, id]) => actual[slot] === id)
    && Number(get(saved.weapon, 6)?.weaponId ?? 0) === expected.lordWeaponId
    && String(get(saved.pet, 6)?.petUId || "") === String(expected.petUId);
}

/** 与客户端及原换皮流程一致：胜利续战、失败重新开始；仅开始新轮时消耗次数。 */
export async function runSkinChallenge({ send, config, activity, now = Date.now, stopped = () => false, log = () => {}, reserveChallenges = 0, copyMainlineFormation = false }) {
  const startedDay = dayStart(now());
  const startHour = Number(config.ConstantConf?.actMultiTowerDailyStartTime);
  const endHour = Number(config.ConstantConf?.actMultiTowerDailyEndTime);
  if (![startHour, endHour].every(Number.isFinite) || startHour < 0 || endHour > 24 || startHour >= endHour) throw new Error("闯关开放时段配置不完整");
  const inTime = () => {
    const time = now(), hour = (time - dayStart(time)) / 3600000;
    return !stopped() && dayStart(time) === startedDay && activity.start * 1000 <= time && time < activity.end * 1000 && hour >= startHour && hour <= endHour;
  };
  if (!inTime()) { log("当前不在闯关挑战时段或任务已停止，跳过"); return { fights: 0, starts: 0 }; }
  let snapshot;
  const query = async () => {
    const result = normalizeSkinTowerSnapshot(await send("towers_getinfo", { actId: activity.id }), activity.id);
    if (snapshot) {
      // 本轮计数只增不减；避免写后查询短暂滞后时重新多花次数。
      result.todayUseTickCnt = Math.max(snapshot.todayUseTickCnt, result.todayUseTickCnt);
      result.useTickCnt = Math.max(snapshot.useTickCnt, result.useTickCnt);
    }
    snapshot = result;
    return snapshot;
  };
  const write = async (cmd, params) => {
    if (!inTime()) { const error = new Error("闯关已停止、跨日或超出时段"); error.stopped = true; throw error; }
    try { return body(await send(cmd, params)); }
    catch (error) {
      if (!error.stopped) await query().catch(() => {});
      throw error; // 写超时只查询，不重复开始或重复战斗。
    }
  };
  await query();
  const day = Math.floor((startedDay - dayStart(activity.start * 1000)) / DAY) + 1;
  const schedule = values(config.ActMultiTowerScheduleConf).find(row => row.actId === activity.id && row.actDay[0] <= day && day <= row.actDay[1]);
  const unlocked = schedule?.openTowerType?.map(Number) || [];
  const show = values(config.ActMultiTowerShowConf).filter(row => row.actId === activity.id);
  const cleared = type => {
    const max = show.find(row => row.towerType === type)?.maxRewardLevel;
    if (!Number.isSafeInteger(max) || max <= 0) throw new Error("闯关通关层数配置不完整");
    return Boolean(get(snapshot.towerData, type)?.pass || get(snapshot.levelRewardMap, type * 1000 + max));
  };
  const pending = unlocked.filter(type => !cleared(type));
  if (!pending.length) { log("今日开放的闯关已通关或没有可挑战目标"); return { fights: 0, starts: 0 }; }
  // 已开始的挑战可以免费续战，即使剩余次数已经达到保留值。
  const activeType = pending.find(type => get(snapshot.towerData, type)?.fighting);
  if (!activeType && getSkinChallengeBudget(activity, snapshot, reserveChallenges) <= 0) {
    log(`闯关剩余次数已达到保留${reserveChallenges}次的条件，结束`);
    return { fights: 0, starts: 0 };
  }
  if (copyMainlineFormation) {
    const role = extractRolePatch(await send("role_getroleinfo", {}));
    const team = buildMainlineTowerTeam(role);
    const result = await write("team_setteam", team);
    if (!isMainlineTowerTeamSaved(result, team)) {
      const saved = await send("team_getallteam", {});
      if (!isMainlineTowerTeamSaved(saved, team)) throw new Error("闯关布阵未确认，停止挑战");
    }
    log("闯关已布阵：使用当前主线武将位置、玩具和宠物");
  }
  const targets = activeType ? [activeType, ...pending.filter(type => type !== activeType)] : pending;
  let fights = 0, starts = 0;
  for (const type of targets) {
    let needStart = !get(snapshot.towerData, type)?.fighting;
    let failed = 0;
    let attemptUsed = snapshot.todayUseTickCnt;
    let startedHere = false;
    while (inTime() && !cleared(type)) {
      if (fights >= 200) throw new Error("闯关场数超出保护上限，停止并检查状态");
      if (needStart) {
        await query();
        if (getSkinChallengeBudget(activity, snapshot, reserveChallenges) <= 0) {
          log(`闯关保留${reserveChallenges}次挑战，停止开始新一轮`);
          return { fights, starts };
        }
        attemptUsed = snapshot.todayUseTickCnt;
        const started = await write("towers_start", { actId: activity.id, towerType: type });
        starts++;
        startedHere = true;
        const hasSnapshot = Number(started?.actId || started?.towerData?.actId) === activity.id;
        const next = hasSnapshot ? normalizeSkinTowerSnapshot(started, activity.id) : await query();
        next.todayUseTickCnt = Math.max(snapshot.todayUseTickCnt, next.todayUseTickCnt);
        next.useTickCnt = Math.max(snapshot.useTickCnt, next.useTickCnt);
        snapshot = next;
        needStart = false;
      }
      const previous = snapshot;
      const result = await write("towers_fight", { actId: activity.id, towerType: type });
      fights++;
      const battle = result?.battleData?.result;
      if (!battle || typeof battle !== "object") { await query(); throw new Error("闯关未返回战斗结果，停止且不重试"); }
      const hp = battle.accept?.ext?.curHP;
      const won = typeof battle.isWin === "boolean" ? battle.isWin : hp !== undefined ? Number(hp) === 0 : false;
      // 客户端 _dealFight 使用这个响应中的单塔和今日次数更新本地数据。
      const tower = result.towerData;
      await query();
      if (result.todayUseTickCnt !== undefined) snapshot.todayUseTickCnt = Math.max(snapshot.todayUseTickCnt, count(result.todayUseTickCnt));
      if (tower && Number(tower.towerType) === type) {
        const current = get(snapshot.towerData, type) || {};
        if (Number(tower.actTowerLv || 0) >= Number(current.actTowerLv || 0)) snapshot.towerData[type] = { ...current, ...tower };
      }
      if (result.levelRewardMap) Object.assign(snapshot.levelRewardMap, Object.fromEntries(entries(result.levelRewardMap)));
      if (won) {
        const progressed = cleared(type) || Number(get(snapshot.towerData, type)?.actTowerLv || 0) > Number(get(previous.towerData, type)?.actTowerLv || 0)
          || entries(snapshot.levelRewardMap).some(([key, value]) => value && !get(previous.levelRewardMap, key));
        if (!progressed) throw new Error("闯关胜利后的层数尚未确认，停止且不重复挑战");
        log(`闯关BOSS ${type} 挑战成功${cleared(type) ? "，已通关" : "，继续下一层"}`);
        failed = 0;
        needStart = false;
      } else {
        failed++;
        needStart = true;
        log(`闯关BOSS ${type} 挑战失败（连续${failed}次）`);
        if (startedHere && snapshot.todayUseTickCnt <= attemptUsed) throw new Error("失败轮次的消耗尚未确认，停止且不重复开始");
        if (failed >= SKIN_CHALLENGE_MAX_CONSECUTIVE_FAILURES) { log(`连续失败${failed}次，跳过BOSS ${type}`); break; }
      }
    }
  }
  return { fights, starts };
}
