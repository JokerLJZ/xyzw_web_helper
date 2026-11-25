import test from "node:test";
import assert from "node:assert/strict";
import { createTasksLegacy, getLegacyClaimEligibility } from "../src/utils/batch/tasksLegacy.js";

const config = { LegacyDreamDustConf: { 1: { levelId: 1, produceSpeed: 257142, produceTimeMax: 21600 } }, LegacyConstant: { minDreamDustCollect: 60 } };
const serverTime = 1792814000000;
function fixture(response, states = {}) {
  const logs = [], calls = [], closed = [];
  let released = 0;
  const deps = {
    selectedTokens: { value: ["a", "b"] }, tokens: { value: [] },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, connectionQueue: { active: 1 }, batchSettings: { maxActive: 1 },
    ensureConnection: async () => {}, releaseConnectionSlot: () => released++,
    addLog: log => logs.push(log), message: { success() {} },
    tokenStore: {
      getWebSocketClient: () => ({ getServerTime: () => serverTime }),
      sendMessageWithPromise: async (id, cmd, params) => {
        calls.push({ id, cmd, params });
        if (cmd === "legacy_getinfo") return { roleLegacy: states[id] || { hangUpBeginTime: serverTime - 300000, produceLevelId: 1, produceItemCnt: 9999 } };
        if (id === "b") return { reward: [{ itemId: 37007, value: 5 }] };
        if (response instanceof Error) throw response;
        return response;
      },
      closeWebSocketConnection: id => closed.push(id),
    },
  };
  return { deps, logs, calls, closed, released: () => released, run: () => createTasksLegacy(deps, { loadConfig: async () => config }).batchLegacyClaim() };
}

test("空奖励或零残卷正常完成，不读取不存在的库存，其他账号继续领取", async () => {
  for (const response of [{ reward: [] }, { reward: [{ itemId: 37007, value: 0 }] }]) {
    const f = fixture(response); await f.run();
    assert.deepEqual(f.deps.tokenStatus.value, { a: "completed", b: "completed" });
    assert.ok(f.logs.some(log => log.type === "info" && log.message.includes("可领取功法残卷为0")));
    assert.ok(!f.logs.some(log => log.type === "error"));
    assert.equal(f.calls.filter(call => call.cmd === "legacy_claimhangup").length, 2); assert.deepEqual(f.closed, ["a", "b"]); assert.equal(f.released(), 2);
    assert.equal(f.deps.isRunning.value, false); assert.equal(f.deps.currentRunningTokenId.value, null);
  }
});

test("按残卷物品ID统计奖励，不依赖第一项，库存缺失也不误报失败", async () => {
  for (const role of [undefined, { items: { 37007: { quantity: 100 } } }]) {
    const f = fixture({ reward: [{ itemId: 1001, value: 20 }, { itemId: 37007, value: 3 }, { itemId: 37007, value: 4 }], role });
    await f.run(); assert.equal(f.deps.tokenStatus.value.a, "completed");
    assert.ok(f.logs.some(log => log.type === "success" && log.message.includes("a 成功领取功法残卷7") && (role ? log.message.includes("共有100个") : !log.message.includes("共有"))));
  }
});

test("缺失奖励列表、无效数量及真实请求错误仍失败，不重试且释放连接", async () => {
  for (const response of [{}, { reward: [{ itemId: 37007, value: "bad" }] }, new Error("服务器错误"), new Error("timeout")]) {
    const f = fixture(response); await f.run();
    assert.deepEqual(f.deps.tokenStatus.value, { a: "failed", b: "completed" });
    assert.equal(f.calls.filter(call => call.id === "a" && call.cmd === "legacy_claimhangup").length, 1);
    assert.equal(f.released(), 2); assert.ok(f.logs.some(log => log.type === "error"));
  }
});


test("领取前按账号状态判断0，不发送领取指令且其他账号继续", async () => {
  for (const beginTime of [0, serverTime - 257141, serverTime + 1000]) {
    const f = fixture({}, { a: { hangUpBeginTime: beginTime, produceLevelId: 1, produceItemCnt: 9999 } });
    await f.run();
    assert.ok(!f.calls.some(call => call.id === "a" && call.cmd === "legacy_claimhangup"));
    assert.ok(f.calls.some(call => call.id === "b" && call.cmd === "legacy_claimhangup"));
    assert.deepEqual(f.deps.tokenStatus.value, { a: "completed", b: "completed" });
    assert.ok(f.logs.some(log => log.message.includes("为0，跳过领取")));
    assert.equal(f.released(), 2);
  }
});

test("一份产出的时间边界与官方最短领取时间，累计产量不作可领数量", () => {
  const state = { hangUpBeginTime: serverTime - 257142, produceLevelId: 1, produceItemCnt: 0 };
  assert.equal(getLegacyClaimEligibility(state, config, serverTime).canClaim, true);
  assert.equal(getLegacyClaimEligibility({ ...state, hangUpBeginTime: serverTime - 257141 }, config, serverTime).canClaim, false);
  const fast = { ...config, LegacyDreamDustConf: { 1: { levelId: 1, produceSpeed: 1000, produceTimeMax: 21600 } } };
  assert.equal(getLegacyClaimEligibility({ ...state, hangUpBeginTime: serverTime - 59000 }, fast, serverTime).canClaim, false);
  assert.equal(getLegacyClaimEligibility({ ...state, hangUpBeginTime: serverTime - 60000 }, fast, serverTime).canClaim, true);
  assert.throws(() => getLegacyClaimEligibility({}, config, serverTime), /开始时间/);
  assert.throws(() => getLegacyClaimEligibility(state, {}, serverTime), /配置/);
  assert.throws(() => getLegacyClaimEligibility(state, config, null), /服务器时间/);
});

test("查询失败或无效状态不领取，查询期间停止也不领取", async () => {
  for (const mode of ["query", "invalid", "stop"]) {
    const f = fixture({ reward: [] });
    const send = f.deps.tokenStore.sendMessageWithPromise;
    f.deps.tokenStore.sendMessageWithPromise = async (...args) => {
      if (args[1] === "legacy_getinfo" && args[0] === "a") {
        if (mode === "query") throw new Error("查询失败");
        if (mode === "invalid") return {};
        f.deps.shouldStop.value = true;
      }
      return send(...args);
    };
    await f.run();
    assert.ok(!f.calls.some(call => call.id === "a" && call.cmd === "legacy_claimhangup"));
    assert.equal(f.deps.tokenStatus.value.a, mode === "stop" ? "stopped" : "failed");
  }
});
