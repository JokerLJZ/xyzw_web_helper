import test from "node:test";
import assert from "node:assert/strict";
import { runNightmareStarOnce, starWeekStart } from "../src/utils/nightmareStarChallenge.js";
const monday = Date.parse("2026-11-23T10:00:00+08:00");
function scenario() {
  const calls = [], logs = [], counts = {}, teams = {}, role = { statistics: { "nm:w:m:boss": 8 }, statisticsTime: { "nm:w:m:boss": monday / 1000 } };
  for (let i = 1; i <= 8; i++) teams[100 + i] = { teamInfo: { 0: { heroId: i + 100 } }, weapon: { weaponId: i }, petUId: String(i) };
  let info = { starResetTime: monday / 1000, starFightCntMap: counts };
  const options = { now: () => monday, loadConfig: async () => ({ NightMareStarConstant: { nightMareStarUnlockLevel: 8 }, NightMareStarConf: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, { bossId: i + 1, challengeTime: 5 }])) }),
    log: (text, type) => logs.push({ text, type }),
    send: async (cmd, params) => {
      calls.push({ cmd, params });
      if (cmd === "role_getroleinfo") return { role };
      if (cmd === "system_getdatabundlever") return { dataBundleVer: "v1" };
      if (cmd === "nmext_getinfo") return { roleNMExt: structuredClone(info) };
      if (cmd === "presetteam_typegetinfo") return { presetTeamMap: teams };
      if (cmd === "nmext_startboss") { counts[params.bossId] = (counts[params.bossId] || 0) + 1; return {}; }
    },
  };
  return { options, calls, logs, counts, teams, role, setInfo: v => { info = v; } };
}
test("八层各用对应保存阵容打一次，按次数增长确认，不改主阵容", async () => {
  const f = scenario(); assert.equal((await runNightmareStarOnce(f.options)).challenged, 8);
  const fights = f.calls.filter(c => c.cmd === "nmext_startboss"); assert.equal(fights.length, 8);
  assert.deepEqual(fights[0].params, { bossId: 1, battleTeam: { 0: 101 }, lordWeaponId: 1, petUId: "1", presetTeamType: 101 });
  assert.equal(f.calls.filter(c => c.cmd === "nmext_getinfo").length, 9);
});
test("周一限制按北京时间，非周一不发请求；手动执行不受此限制", async () => {
  const f = scenario(); f.options.mondayOnly = true; f.options.now = () => monday + 86400000;
  assert.equal((await runNightmareStarOnce(f.options)).skipped, true); assert.equal(f.calls.length, 0);
  assert.equal(starWeekStart(monday), Date.parse("2026-11-23T00:00:00+08:00"));
});
test("未达本周门槛或旧通关记录跳过，旧星级数据停止", async () => {
  for (const stale of [true, false]) {
    const f = scenario(); if (stale) f.role.statisticsTime["nm:w:m:boss"] -= 604800; else f.role.statistics["nm:w:m:boss"] = 7;
    assert.equal((await runNightmareStarOnce(f.options)).skipped, true);
    assert.ok(!f.calls.some(c => c.cmd === "nmext_startboss"));
  }
  const g = scenario(); g.setInfo({ starResetTime: (monday - 604800000) / 1000 });
  await assert.rejects(runNightmareStarOnce(g.options), /本周/);
});
test("无次数和未保存阵容层跳过，其他层仍各一次", async () => {
  const f = scenario(); f.counts[1] = 5; delete f.teams[102];
  assert.equal((await runNightmareStarOnce(f.options)).challenged, 6);
  assert.ok(!f.calls.some(c => c.cmd === "nmext_startboss" && c.params.bossId <= 2));
});
test("写超时后次数已增则不重发；未确认则停止后续层", async () => {
  for (const applied of [true, false]) {
    const f = scenario(), send = f.options.send;
    f.options.send = async (cmd, params) => {
      if (cmd === "nmext_startboss") { if (applied) await send(cmd, params); else f.calls.push({ cmd, params }); throw new Error("超时"); }
      return send(cmd, params);
    };
    if (applied) assert.equal((await runNightmareStarOnce(f.options)).challenged, 8);
    else await assert.rejects(runNightmareStarOnce(f.options), /超时/);
    assert.equal(f.calls.filter(c => c.cmd === "nmext_startboss").length, applied ? 8 : 1);
  }
});
test("停止、非法阵容不发送挑战；账号次数独立", async () => {
  const f = scenario(); f.options.stopped = () => true;
  await assert.rejects(runNightmareStarOnce(f.options), e => e.interrupted); assert.equal(f.calls.length, 0);
  const g = scenario(); g.teams[101].teamInfo = { 9: { heroId: 100 } };
  await assert.rejects(runNightmareStarOnce(g.options), /保存阵容无效/);
  const a = scenario(), b = scenario(); a.counts[1] = 5;
  assert.deepEqual((await Promise.all([runNightmareStarOnce(a.options), runNightmareStarOnce(b.options)])).map(r => r.challenged), [7, 8]);
});

test("星级特权增加次数并扣除已用特权次数，非累计特权取最大值", async () => {
  const f = scenario(); f.counts[1] = 5;
  f.role.privilege = { 701: 1, 702: 1 };
  const load = f.options.loadConfig;
  f.options.loadConfig = async () => ({ ...await load(), PrivilegeConf: {
    701: { canMulti: 0, expirationType: 5, benefit: [{ type: 14, value: 1 }] },
    702: { canMulti: 0, expirationType: 5, benefit: [{ type: 14, value: 2 }] },
  } });
  f.setInfo({ starResetTime: monday / 1000, starFightCntMap: f.counts, privilegeStarFightCntMap: { 1: 2 } });
  assert.equal((await runNightmareStarOnce(f.options)).challenged, 7);
});

test("保存阵容省略零值装备按协议默认无玩具无宠物，不借用主阵容", async () => {
  const f = scenario(); f.role.lordWeaponId = 999; f.role.petData = { petUId: "current" };
  delete f.teams[101].weapon; delete f.teams[101].petUId;
  await runNightmareStarOnce(f.options);
  const fight = f.calls.find(c => c.cmd === "nmext_startboss");
  assert.equal(fight.params.lordWeaponId, 0); assert.equal(fight.params.petUId, "");
});

import { defaultSettings, defaultTemplate } from "../src/utils/batch/constants.js";
test("账号日常和批量模板星级挑战默认关闭", () => {
  assert.equal(defaultSettings.mondayNightmareStarOnce, false);
  assert.equal(defaultTemplate.mondayNightmareStarOnce, false);
});
