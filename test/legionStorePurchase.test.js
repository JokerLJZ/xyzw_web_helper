import assert from "node:assert/strict";
import test from "node:test";

import { createTasksStore } from "../src/utils/batch/tasksStore.js";

const ref = (value) => ({ value });

const createBatchStore = (calls) =>
  createTasksStore({
    selectedTokens: ref(["token-1"]),
    tokens: ref([{ id: "token-1", name: "测试账号" }]),
    tokenStatus: ref({}),
    isRunning: ref(false),
    shouldStop: ref(false),
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 2 },
    tokenStore: {
      sendMessageWithPromise: async (tokenId, cmd, params) => {
        calls.push({ tokenId, cmd, params });
        return { ok: true };
      },
      closeWebSocketConnection: () => {},
    },
    addLog: () => {},
    message: {},
    currentRunningTokenId: ref(null),
    delayConfig: { action: 0 },
  });

test("批量购买白玉使用独立军团商店商品槽位", async () => {
  const calls = [];
  const tasks = createBatchStore(calls);

  await tasks.legionStoreBuyWhiteJade();
  assert.deepEqual(calls, [
    {
      tokenId: "token-1",
      cmd: "legion_storebuygoods",
      params: { id: 5 },
    },
  ]);

  calls.length = 0;
  await tasks.legion_storebuygoods();
  assert.deepEqual(calls, [
    {
      tokenId: "token-1",
      cmd: "legion_storebuygoods",
      params: { id: 6 },
    },
  ]);
});
