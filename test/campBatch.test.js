import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCampTeam, getCampDay, runCampChallenge, createTasksCamp } from "../src/utils/batch/tasksCamp.js";
import { GameCommands } from "../src/utils/gameCommands.js";
import { g_utils } from "../src/utils/bonProtocol.js";

const tuesday = () => new Date("2026-09-22T10:00:00+08:00");
const role = { battleTeam: { 0: { heroId: 116 }, 1: { heroId: 107 } }, lordWeaponId: 3, pet: { petUId: "own-pet" } };

function fixture({ wins = 0, attacks = 0, winNormal = () => false, winMonster = true, timeout = false } = {}) {
  const info = {
    club: { oppoMap: { 2: { defenders: {
      1: { roleId: 101, challengeCnt: 0, failCnt: 0 },
      2: { roleId: 102, challengeCnt: 2, failCnt: 1 },
    } } } },
    siege: { attackMap: { 260922: { attackCnt: attacks, aSuccessCnt: wins } } },
  };
  const calls = [];
  const send = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === "club_getinfo") return structuredClone(info);
    if (cmd === "role_getroleinfo") return { role };
    if (cmd === "club_gettargetteam") return { roleBattleTeam: { role: { power: params.targetId === 101 ? 1000 : 100 } } };
    const progress = info.siege.attackMap[260922];
    progress.attackCnt++;
    const won = cmd === "club_attackmonster" ? winMonster : winNormal(progress.attackCnt);
    if (won) progress.aSuccessCnt++;
    if (cmd === "club_attack") {
      const target = info.club.oppoMap[2].defenders[params.nodeId];
      assert.equal(params.challengeCnt, target.challengeCnt);
      assert.equal(params.failCnt, target.failCnt);
      target.challengeCnt++;
      if (!won) target.failCnt++;
    }
    assert.equal(params.useItem, false);
    assert.equal(params.teamSetParams.petUId, "own-pet");
    if (timeout) throw new Error("timeout");
    return { siege: { attackMap: {} }, addScore: 6 };
  };
  return { info, calls, send, now: tuesday };
}

test("营地仅在北京时间周二至周四执行", async () => {
  for (let date = 21; date <= 27; date++) {
    const now = () => new Date(`2026-09-${date}T10:00:00+08:00`);
    const day = getCampDay(now());
    assert.equal(day.weekday, date === 27 ? 0 : date - 20);
    if (![2, 3, 4].includes(day.weekday)) {
      const result = await runCampChallenge({ now, send: () => assert.fail("不应发请求") });
      assert.equal(result.status, "skipped");
    }
  }
  assert.deepEqual(getCampDay(new Date("2026-09-21T16:00:00Z")), { key: "260922", weekday: 2 });
});

test("优先最低战力，实时据点计数，3胜立即停止", async () => {
  const f = fixture({ winNormal: () => true });
  const result = await runCampChallenge(f);
  const attacks = f.calls.filter((c) => c.cmd === "club_attack");
  assert.equal(result.wins, 3);
  assert.equal(attacks.length, 3);
  assert.deepEqual(attacks.map((c) => c.params.nodeId), [2, 2, 2]);
  assert.deepEqual(attacks.map((c) => c.params.challengeCnt), [2, 3, 4]);
  assert.equal(f.calls.some((c) => c.cmd === "club_attackmonster"), false);
});

test("普通挑战12次不足3胜，转宠物目标补齐", async () => {
  const f = fixture();
  const result = await runCampChallenge(f);
  assert.equal(f.calls.filter((c) => c.cmd === "club_attack").length, 12);
  assert.equal(f.calls.filter((c) => c.cmd === "club_attackmonster").length, 3);
  assert.equal(result.wins, 3);
  assert.deepEqual(f.calls.filter((c) => c.cmd === "club_attack").slice(0, 2).map((c) => c.params.nodeId), [2, 1]);
});

test("既有成功次数及出手计入当日目标，重复运行不重复攻击", async () => {
  const f = fixture({ wins: 2, attacks: 11 });
  const result = await runCampChallenge(f);
  assert.equal(result.wins, 3);
  assert.equal(f.calls.filter((c) => c.cmd === "club_attack").length, 1);
  assert.equal(f.calls.filter((c) => c.cmd === "club_attackmonster").length, 1);
  f.calls.length = 0;
  await runCampChallenge(f);
  assert.deepEqual(f.calls.map((c) => c.cmd), ["club_getinfo"]);
});

test("已出手12次直接宠物补齐；宠物失败停止", async () => {
  const f = fixture({ attacks: 12, wins: 1, winMonster: false });
  await assert.rejects(runCampChallenge(f), /宠物目标未获胜/);
  assert.equal(f.calls.filter((c) => c.cmd === "club_attackmonster").length, 1);
  assert.equal(f.calls.some((c) => c.cmd === "club_attack"), false);
});

test("超时但服务端已成功时对账后继续，最终只出手3次", async () => {
  const f = fixture({ timeout: true, winNormal: () => true });
  assert.equal((await runCampChallenge(f)).wins, 3);
  assert.equal(f.calls.filter((c) => c.cmd === "club_attack").length, 3);
});

test("超时且次数未变化时不重发，积分不能当作胜利", async () => {
  const f = fixture();
  let attacks = 0;
  const send = async (cmd, params) => {
    if (cmd === "club_attack") { attacks++; throw new Error("timeout"); }
    return f.send(cmd, params);
  };
  await assert.rejects(runCampChallenge({ ...f, send }), /攻击结果未确认/);
  assert.equal(attacks, 1);
});

test("未知战力、缺失进度、跨日和用户停止均不会继续攻击", async () => {
  const f = fixture();
  await assert.rejects(runCampChallenge({ ...f, send: (cmd, p) => cmd === "club_gettargetteam" ? {} : f.send(cmd, p) }), /目标战力/);
  await assert.rejects(runCampChallenge({ ...f, send: async () => ({ club: {}, siege: {} }) }), /数据不完整/);
  await assert.rejects(runCampChallenge({ ...f, stopped: () => true }), /已停止/);
  let clockCalls = 0;
  await assert.rejects(runCampChallenge({ ...f, now: () => ++clockCalls === 1 ? tuesday() : new Date("2026-09-23T10:00:00+08:00") }), /日期已变化/);
  assert.equal(f.calls.some((c) => c.cmd === "club_attack"), false);
});

test("攻击使用本账号阵容，协议编码保留宠物及据点参数", () => {
  const teamSetParams = buildCampTeam(role);
  assert.deepEqual(teamSetParams.battleTeam, { 0: 116, 1: 107 });
  assert.throws(() => buildCampTeam({ battleTeam: {} }), /没有可用/);
  const commands = new GameCommands();
  for (const cmd of ["club_attack", "club_attackmonster"]) {
    const packet = commands[cmd](4, 5, { teamSetParams });
    assert.equal(packet.cmd, cmd);
    assert.deepEqual(g_utils.bon.decode(packet.body), { useItem: false, teamSetParams });
  }
});

test("无可挑战据点时以宠物补齐，无今日对阵时跳过", async () => {
  const f = fixture({ wins: 2, attacks: 2 });
  f.info.club.oppoMap[2].defenders = {};
  assert.equal((await runCampChallenge(f)).wins, 3);
  const g = fixture();
  g.info.club.oppoMap = {};
  assert.equal((await runCampChallenge(g)).status, "skipped");
  assert.equal(g.calls.length, 1);
});

test("多账号串行执行并释放自建连接；失败后继续下一个账号", async () => {
  const events = [];
  const deps = {
    selectedTokens: { value: ["a", "b"] }, tokens: { value: [] },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, batchSettings: {},
    addLog: () => {}, message: { success: () => {}, warning: () => {} },
    ensureConnection: async (id) => { events.push(`connect:${id}`); },
    releaseConnectionSlot: () => events.push("release"),
    tokenStore: {
      getWebSocketStatus: () => "disconnected",
      closeWebSocketConnection: (id) => events.push(`close:${id}`),
      sendMessageWithPromise: async (id) => {
        events.push(`query:${id}`);
        if (id === "a") throw new Error("网络断开");
        return fixture({ wins: 3, attacks: 3 }).info;
      },
    },
  };
  const { batchCampChallenge } = createTasksCamp(deps, { now: tuesday, sleep: async () => {} });
  await batchCampChallenge();
  assert.deepEqual(events, ["connect:a", "query:a", "close:a", "release", "connect:b", "query:b", "close:b", "release"]);
  assert.deepEqual(deps.tokenStatus.value, { a: "failed", b: "completed" });
  assert.equal(deps.isRunning.value, false);
  assert.equal(deps.currentRunningTokenId.value, null);
});

test("攻击期间点击停止，不会继续攻击或宠物补齐", async () => {
  const f = fixture();
  let stopped = false;
  const send = async (cmd, params) => {
    const result = await f.send(cmd, params);
    if (cmd === "club_attack") stopped = true;
    return result;
  };
  await assert.rejects(runCampChallenge({ ...f, send, stopped: () => stopped }), /已停止/);
  assert.equal(f.calls.filter((c) => c.cmd === "club_attack").length, 1);
  assert.equal(f.calls.some((c) => c.cmd === "club_attackmonster"), false);
});
