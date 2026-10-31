import test from "node:test";
import assert from "node:assert/strict";
import { ref } from "vue";
import { createTasksRecharge } from "../src/utils/batch/tasksRecharge.js";

test("定时标准任务允许已有运行状态并保留调度器会话", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ actConstantConf: {} }) });
  const isRunning = ref(true), shouldStop = ref(false), status = ref({});
  let released = 0;
  const calls = [];
  const tasks = createTasksRecharge({
    selectedTokens: ref(["a"]), tokens: ref([{ id: "a", name: "A" }]), tokenStatus: status,
    isRunning, shouldStop, currentRunningTokenId: ref(null),
    tokenStore: { getWebSocketStatus: () => "connected", sendMessageWithPromise: async (_id, cmd) => { calls.push(cmd); return { dataBundleVer: "batch-test-1" }; }, closeWebSocketConnection: () => { throw new Error("不应关闭定时会话"); } },
    ensureConnection: async (_id, _retry, onOwn) => onOwn(false), releaseConnectionSlot: () => { released++; },
    addLog: () => {}, message: {}, isScheduled: () => true, isScheduledSession: () => true,
  });
  try {
    await tasks.batchRechargeStandard();
    assert.deepEqual(calls, ["system_getdatabundlever"]);
    assert.equal(status.value.a, "skipped");
    assert.equal(isRunning.value, true);
    assert.equal(released, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("打开预设清单不连接、不查询账号，选择变化后执行当前账号", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  const selected = ref(["a", "b"]), writes = [], calls = [], statuses = ref({});
  const tasks = createTasksRecharge({
    selectedTokens: selected, tokens: ref([]), tokenStatus: statuses, isRunning: ref(false), shouldStop: ref(false), currentRunningTokenId: ref(null),
    tokenStore: { getWebSocketStatus: () => "connected", sendMessageWithPromise: async (id, cmd) => { calls.push([id, cmd]); return { dataBundleVer: "preset-batch-v1" }; } },
    ensureConnection: async () => {}, releaseConnectionSlot: () => {}, addLog: () => {},
    message: { success: () => {}, warning: text => { throw new Error(text); }, info: () => {} },
  }, { loadCatalog: async () => ({ activityId: 11, configVersion: "preset-batch-v1", rows: [{ id: 101 }] }),
    exchangeItems: async context => writes.push({ id: context.id, skip: context.skipUnavailable, activity: context.expectedActivityId }) });
  try {
    await tasks.queryRechargeExchangeItems();
    assert.equal(tasks.rechargeExchangeOpen.value, true);
    assert.deepEqual(calls, []);
    selected.value = ["b", "c"];
    await tasks.batchRechargeExchange([{ goodsId: 101, quantity: 1 }]);
    assert.deepEqual(writes, [{ id: "b", skip: true, activity: 11 }, { id: "c", skip: true, activity: 11 }]);
    assert.deepEqual(calls, [["b", "system_getdatabundlever"], ["c", "system_getdatabundlever"]]);
  } finally { globalThis.fetch = originalFetch; }
});

test("批量兑换识别WebSocket明确拒绝，网络超时不标记为可跳过拒绝", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
  const tasks = createTasksRecharge({
    selectedTokens: ref(["a"]), tokens: ref([]), tokenStatus: ref({}), isRunning: ref(false), shouldStop: ref(false), currentRunningTokenId: ref(null),
    tokenStore: { getWebSocketStatus: () => "connected", sendMessageWithPromise: async (_id, cmd) => {
      if (cmd === "system_getdatabundlever") return { dataBundleVer: "rejection-batch-v1" };
      throw new Error(cmd === "activity_exchange" ? "服务器错误: 200020 - 拒绝" : "请求超时");
    } }, ensureConnection: async () => {}, releaseConnectionSlot: () => {}, addLog: () => {}, message: { success: () => {}, warning: () => {} },
  }, { loadCatalog: async () => ({ activityId: 11, configVersion: "rejection-batch-v1" }), exchangeItems: async ({ send }) => {
    await assert.rejects(send("activity_exchange"), error => error.serverRejected === true);
    await assert.rejects(send("activity_get"), error => !error.serverRejected);
  } });
  try { await tasks.queryRechargeExchangeItems(); await tasks.batchRechargeExchange([{ goodsId: 101, quantity: 1 }]); }
  finally { globalThis.fetch = originalFetch; }
});
