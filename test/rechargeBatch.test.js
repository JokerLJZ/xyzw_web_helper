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
