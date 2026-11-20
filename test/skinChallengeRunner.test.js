import test from "node:test";
import assert from "node:assert/strict";
import { runSkinChallenge, normalizeSkinTowerSnapshot, buildMainlineTowerTeam } from "../src/utils/skinChallengeRunner.js";
import { runRechargeStandard } from "../src/utils/rechargeActivity.js";
import { towerFixture, TOWER_NOW, clone } from "./helpers/skinChallengeFixture.js";

test("周年烧烤与换皮共用胜利续战/失败重新开始，保留三次而非每场扣一次", async () => {
  const f = towerFixture(); const result = await runSkinChallenge(f);
  assert.equal(result.starts, 8); assert.equal(result.fights, 16);
  assert.equal(f.towers.todayUseTickCnt, 8);
  assert.equal(f.towers.useTickCnt, 7);
  assert.deepEqual(f.calls.filter(([cmd]) => cmd === "towers_start").map(([, params]) => params.towerType), Array(8).fill(1));
  const again = await runSkinChallenge(f); assert.equal(again.starts, 0); assert.equal(f.fights, 16);
});
test("胜利连续推层不新增开始请求，通关即结束", async () => {
  const f = towerFixture({ levels: 8, failEverySecond: false });
  const result = await runSkinChallenge(f);
  assert.equal(result.starts, 1); assert.equal(result.fights, 8); assert.equal(f.towers.todayUseTickCnt, 1);
});
test("剩余三次已有进行中挑战仍可续战，但失败后不另开新轮", async () => {
  const f = towerFixture({ initialUsed: 8, results: [true, false] });
  f.towers.towerData[1].fighting = true;
  const result = await runSkinChallenge(f);
  // 已进行中的轮次最初消耗发生于本轮执行之前，允许不重新扣次地结束。
  assert.equal(result.fights, 2); assert.equal(result.starts, 0);
});
test("普通换皮可用尽当日次数，烧烤的保留参数互不影响", async () => {
  const f = towerFixture();
  const result = await runSkinChallenge({ ...f, reserveChallenges: 0, copyMainlineFormation: false });
  assert.equal(result.starts, 11); assert.equal(result.fights, 22);
  assert.equal(f.calls.some(([cmd]) => cmd === "team_setteam"), false);
});
test("连续五败沿用原换皮策略，跳过当前BOSS", async () => {
  const f = towerFixture({ results: [false, false, false, false, false] });
  assert.equal((await runSkinChallenge(f)).starts, 5);
});
test("从当前账号读取主线阵容，包含位置、玩具和宠物且先核验后挑战", async () => {
  const f = towerFixture({ levels: 1, failEverySecond: false });
  await runSkinChallenge(f);
  const params = f.calls.find(([cmd]) => cmd === "team_setteam")[1];
  assert.deepEqual(params, { teamType: 6, battleTeam: { 0: 101, 2: 105 }, lordWeaponId: 12, petUId: "pet-a", cCMonsterId: 0 });
  const commands = f.calls.map(([cmd]) => cmd);
  assert.ok(commands.indexOf("role_getroleinfo") < commands.indexOf("team_setteam"));
  assert.ok(commands.indexOf("team_getallteam") < commands.indexOf("towers_start"));
  assert.deepEqual(f.role.battleTeam, { 0: { heroId: 101 }, 2: { heroId: 105 } });
});
test("布阵未确认不开始挑战，空阵容不发送布阵请求", async () => {
  for (const empty of [true, false]) {
    const f = towerFixture(); if (empty) f.role.battleTeam = {};
    const send = async (cmd, params) => cmd === "team_getallteam" ? { roleTeam: {} } : f.send(cmd, params);
    await assert.rejects(runSkinChallenge({ ...f, send }), /阵容|布阵/);
    assert.equal(f.starts, 0);
    if (empty) assert.equal(f.calls.some(([cmd]) => cmd === "team_setteam"), false);
  }
});
test("写超时后查询状态，不重发开始或战斗", async () => {
  for (const failed of ["towers_start", "towers_fight"]) {
    const f = towerFixture();
    const send = async (cmd, params) => { const result = await f.send(cmd, params); if (cmd === failed) throw new Error("timeout"); return result; };
    await assert.rejects(runSkinChallenge({ ...f, send }), /timeout/);
    assert.equal(f.calls.filter(([cmd]) => cmd === failed).length, 1);
    assert.equal(f.calls.at(-1)[0], "towers_getinfo");
  }
});
test("完整快照支持直接和嵌套形态，默认计数为零，负数和切期拒绝", () => {
  for (const response of [{ actId: 1 }, { body: { towerData: { actId: 1 } } }]) {
    const result = normalizeSkinTowerSnapshot(response, 1); assert.equal(result.todayUseTickCnt, 0); assert.deepEqual(result.towerData, {});
  }
  assert.throws(() => normalizeSkinTowerSnapshot({ actId: 1, todayUseTickCnt: -1 }, 1), /异常/);
  assert.throws(() => normalizeSkinTowerSnapshot({ actId: 2 }, 1), /切期/);
  assert.throws(() => buildMainlineTowerTeam({ battleTeam: { 0: { heroId: 0 } } }), /无效/);
});
test("保留值按活动总次数约束；不在时段不布阵、不挑战", async () => {
  const f = towerFixture(); f.towers.useTickCnt = 60; f.towers.todayUseTickCnt = 1;
  assert.equal((await runSkinChallenge(f)).starts, 0);
  const early = towerFixture(); await runSkinChallenge({ ...early, now: () => TOWER_NOW - 6 * 3600000 });
  assert.equal(early.calls.length, 0);
});
test("标准任务确实调用共享执行器并启用主线布阵", async () => {
  const f = towerFixture({ levels: 2, failEverySecond: false });
  const result = await runRechargeStandard(f);
  assert.equal(result.status, "completed"); assert.equal(f.fights, 2); assert.equal(f.starts, 1);
  assert.ok(f.calls.some(([cmd]) => cmd === "team_setteam"));

});
test("写后查询短暂滞后时优先保留战斗响应中的计数和层数，不重复新开轮次", async () => {
  const f = towerFixture({ levels: 3, failEverySecond: false });
  const stale = clone(f.towers);
  const send = async (cmd, params) => { const result = await f.send(cmd, params); return cmd === "towers_getinfo" ? { towerData: clone(stale) } : result; };
  const result = await runSkinChallenge({ ...f, send });
  assert.equal(result.starts, 1); assert.equal(result.fights, 3);
});
test("已通关时不布阵、不新开轮次；跨日后不继续发送挑战", async () => {
  const f = towerFixture(); f.towers.levelRewardMap[1020] = 1;
  assert.equal((await runSkinChallenge(f)).fights, 0);
  assert.equal(f.calls.some(([cmd]) => cmd === "team_setteam"), false);
  const crossed = towerFixture(); let time = TOWER_NOW;
  const send = async (cmd, params) => { const result = await crossed.send(cmd, params); if (cmd === "towers_fight") time += 86400000; return result; };
  const result = await runSkinChallenge({ ...crossed, send, now: () => time });
  assert.equal(result.fights, 1); assert.equal(result.starts, 1);
});
