export const TOWER_NOW = Date.parse("2026-10-16T13:00:00+08:00");
export const clone = value => structuredClone(value);
export function towerFixture({ initialUsed = 0, levels = 20, results = [], failEverySecond = true, direct = false } = {}) {
  const activity = { id: 2610163, actType: 19, actGroup: 0, start: TOWER_NOW / 1000 - 3600, end: TOWER_NOW / 1000 + 86400, parameters: [60, 10] };
  const config = {
    actConstantConf: { 1: { id: 20261016, name: "周年", start: activity.start, end: activity.end } },
    ActFestivalConf: { 1: activity, 2: { ...activity, id: 2610165, actType: 2 } },
    ConstantConf: { actMultiTowerDailyStartTime: 8, actMultiTowerDailyEndTime: 20 },
    ActMultiTowerScheduleConf: { 1: { actId: activity.id, actDay: [1, 7], openTowerType: [1] } },
    ActMultiTowerShowConf: { 1: { actId: activity.id, towerType: 1, maxRewardLevel: levels } },
  };
  const towers = { actId: activity.id, todayUseTickCnt: initialUsed, useTickCnt: Math.max(0, initialUsed - 1), towerData: { 1: { towerType: 1, actTowerLv: 1, fighting: false } }, levelRewardMap: {} };
  const role = { battleTeam: { 0: { heroId: 101 }, 2: { heroId: 105 } }, lordWeaponId: 12, pet: { petUId: "pet-a" } };
  let team, fights = 0, starts = 0;
  const calls = [];
  const send = async (cmd, params) => {
    calls.push([cmd, params]);
    if (cmd === "role_getroleinfo") return { role: clone(role) };
    if (cmd === "team_setteam") { team = clone(params); return {}; }
    if (cmd === "team_getallteam") return { roleTeam: { battleTeamInfo: { 6: clone(team.battleTeam) }, weapon: { 6: { weaponId: team.lordWeaponId } }, pet: { 6: { petUId: team.petUId } } } };
    if (cmd === "towers_getinfo") return direct ? clone(towers) : { towerData: clone(towers) };
    if (cmd === "towers_start") {
      starts++; if (towers.todayUseTickCnt > 0) towers.useTickCnt++; towers.todayUseTickCnt++;
      towers.towerData[1].fighting = true;
      return { towerData: clone(towers) };
    }
    if (cmd === "towers_fight") {
      fights++;
      const won = results.length ? results.shift() : failEverySecond ? fights % 2 === 1 : true;
      const tower = towers.towerData[1];
      if (won) { towers.levelRewardMap[1000 + tower.actTowerLv] = 1; tower.actTowerLv++; if (tower.actTowerLv > levels) tower.pass = true; }
      else tower.fighting = false;
      return { battleData: { result: { isWin: won, accept: { ext: { curHP: won ? 0 : 10 } } } }, todayUseTickCnt: towers.todayUseTickCnt, towerData: clone(tower), levelRewardMap: clone(towers.levelRewardMap) };
    }
    if (cmd === "activity_get") return { activity: { commonActivityInfo: {} } };
    throw new Error(cmd);
  };
  return { send, activity, config, towers, role, calls, now: () => TOWER_NOW, log: () => {}, reserveChallenges: 3, copyMainlineFormation: true, get fights() { return fights; }, get starts() { return starts; } };
}
