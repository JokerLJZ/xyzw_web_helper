import { formatBatchTaskNotification } from "../src/utils/wxpusher.js";
import { getBatchRetryTokenIds, normalizeTaskResultStatus } from "../src/utils/scheduledTaskResult.js";
import { getDailyRunStatus } from "../src/utils/scheduledTaskResult.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { connectWithTokenRefresh } from "../src/utils/batch/connectWithTokenRefresh.js";

const component = await readFile(
  new URL("../src/views/BatchDailyTasks.vue", import.meta.url),
  "utf8",
);
const script = component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "BatchDailyTasks must contain a setup script");
const source = ts.createSourceFile(
  "BatchDailyTasks.js",
  script,
  ts.ScriptTarget.Latest,
  true,
);
const names = new Set([
  "waitForConnectionSlot",
  "releaseConnectionSlot",
  "ensureConnection",
  "startBatch",
]);
const declarations = source.statements
  .filter(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) =>
        names.has(declaration.name.getText(source)),
      ),
  )
  .map((statement) => statement.getText(source))
  .join("\n");

/** Run the component's actual batch orchestration with isolated transports and refs. */
function fixture({
  connected = true,
  connectionSucceeds = true,
  runError = null,
  incomplete = 0,
  dailyIncomplete,
  supplementalWarnings = [],
  reasons = [],
  planFailed,
  planIncomplete,
} = {}) {
  const logs = [];
  const state = { runs: 0, closed: 0, connected };
  const context = {
    connectWithTokenRefresh,
    getBatchRetryTokenIds, getDailyRunStatus, normalizeTaskResultStatus, formatBatchTaskNotification,
    sendNotifications: async (title, content) => { state.notification = { title, content }; },
    tokenTaskWarnings: { value: {} },
    tokenTaskReasons: { value: {} },
    selectedTokens: { value: ["account-a"] },
    scheduledTaskExecutionActive: false,
    isScheduledTokenSession: () => false,
    normalizeTokenIdsByBatchOrder: (ids) => [...ids],
    tokens: {
      value: [{ id: "account-a", name: "Test account", token: "fixture" }],
    },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    currentRunningTokenId: { value: null },
    connectionQueue: { active: 1 },
    batchSettings: {
      maxActive: 2,
      reconnectDelay: 0,
      commandDelay: 0,
      taskDelay: 0,
    },
    addLog: (log) => logs.push(log),
    message: { info() {}, warning() {}, success() {} },
    setTimeout: (callback) => {
      callback();
    },
    waitForConnection: async () => {
      state.connected = connectionSucceeds;
      return connectionSucceeds;
    },
    tokenStore: {
      getWebSocketStatus: () =>
        state.connected ? "connected" : "disconnected",
      createWebSocketConnection() {},
      closeWebSocketConnection() {
        state.closed++;
        state.connected = false;
      },
      sendMessageWithPromise: async () => ({}),
    },
    DailyTaskRunner: class {
      async run() {
        state.runs++;
        if (runError) throw runError;
        return { incomplete, dailyIncomplete, supplementalWarnings, reasons, planFailed, planIncomplete };
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${declarations}\nglobalThis.api = { startBatch, waitForConnectionSlot };`,
    context,
  );
  return { context, state, logs, ...context.api };
}

test("batch rate-limit failure executes once and preserves another caller's connection and slot", async () => {
  const f = fixture({ runError: new Error("200400 操作太快") });
  await f.startBatch();
  assert.equal(f.state.runs, 1);
  assert.equal(f.state.closed, 0);
  assert.equal(f.context.connectionQueue.active, 1);
  assert.equal(f.context.tokenStatus.value["account-a"], "failed");
  assert.equal(f.context.isRunning.value, false);
});

test("failed connection releases its slot once without releasing another account's slot", async () => {
  const f = fixture({ connected: false, connectionSucceeds: false });
  await f.startBatch();
  assert.equal(f.state.runs, 0);
  assert.equal(f.context.connectionQueue.active, 1);
  assert.equal(f.context.tokenStatus.value["account-a"], "failed");
  assert.equal(f.context.isRunning.value, false);
});

test("batch releases the new connection it owns and respects the runner's pending result", async () => {
  const f = fixture({ connected: false, incomplete: 2 });
  await f.startBatch();
  assert.equal(f.state.runs, 1);
  assert.equal(f.state.closed, 1);
  assert.equal(f.context.connectionQueue.active, 1);
  assert.equal(f.context.tokenStatus.value["account-a"], "pending");
});

test("stop while waiting for a connection slot does not acquire a slot", async () => {
  const f = fixture();
  f.context.connectionQueue.active = 2;
  f.context.shouldStop.value = true;
  await assert.rejects(
    f.waitForConnectionSlot(),
    (error) => error.interrupted === true,
  );
  assert.equal(f.context.connectionQueue.active, 2);
});

test("连接创建异常也只释放本轮取得的一个槽位", async () => {
  const f = fixture({ connected:false });
  f.context.tokenStore.createWebSocketConnection = () => { throw new Error("Connection creation failed"); };
  await f.startBatch();
  assert.equal(f.state.runs,0);
  assert.equal(f.context.connectionQueue.active,1);
  assert.equal(f.context.tokenStatus.value["account-a"],"failed");
});

test("定时任务保持账号会话的连接与槽位直到外层结束", async () => {
  const f = fixture({ connected:false });
  f.context.scheduledTaskExecutionActive = true;
  f.context.isScheduledTokenSession = () => true;
  f.context.scheduledTokenSession = {initialized:false};
  await f.startBatch();
  assert.equal(f.state.runs,1);
  assert.equal(f.state.closed,0);
  assert.equal(f.context.connectionQueue.active,2);
  assert.equal(f.context.scheduledTokenSession.slotAcquired,true);
  assert.equal(f.context.isRunning.value,true);
});


test("实际批量入口：日常完成但附加竞猜异常仍成功，并保留推送提示", async () => {
  const f = fixture({ incomplete: 1, dailyIncomplete: 0, supplementalWarnings: ["逐鹿盐山竞猜奖励未确认"] });
  await f.startBatch();
  assert.equal(f.context.tokenStatus.value["account-a"], "completed");
  assert.deepEqual(f.context.tokenTaskWarnings.value["account-a"], ["逐鹿盐山竞猜奖励未确认"]);
});

test("实际批量入口：日常奖励未领继续保持待继续", async () => {
  const f = fixture({ incomplete: 3, dailyIncomplete: 2, supplementalWarnings: ["附加任务未完成"] });
  await f.startBatch();
  assert.equal(f.context.tokenStatus.value["account-a"], "pending");
});


test("实际批量通知将日常失败和未领原因传递到推送正文", async () => {
  const f = fixture({ dailyIncomplete: 0, planFailed: 1, planIncomplete: 1, reasons: ["领取每日礼包：服务器错误200020"] });
  await f.startBatch();
  assert.equal(f.context.tokenStatus.value["account-a"], "failed");
  assert.match(f.state.notification.content, /领取每日礼包：服务器异常（200020）/);
});

test("实际批量入口发生超时，推送仍保留失败步骤而非只有账号名", async () => {
  const error = new Error("请求超时"); error.dailyReasons = ["同步日常状态：请求超时"];
  const f = fixture({ runError: error });
  await f.startBatch();
  assert.match(f.state.notification.content, /同步日常状态：请求超时/);
});

test("失败比例含30%时只补跑失败账号一次，推送使用补跑后结果", async () => {
  for (const failed of [0, 1, 3, 4]) {
    const f = fixture();
    const ids = Array.from({ length: 10 }, (_, i) => `a${i}`);
    f.context.selectedTokens.value = ids;
    f.context.tokens.value = ids.map(id => ({ id, name: id }));
    const runs = new Map();
    f.context.DailyTaskRunner = class {
      async run(id) {
        const attempt = (runs.get(id) || 0) + 1;
        runs.set(id, attempt);
        return { planFailed: ids.indexOf(id) < failed && attempt === 1 ? 1 : 0,
          planIncomplete: 0, reasons: attempt === 1 && ids.indexOf(id) < failed ? ["首次失败"] : [] };
      }
    };
    await f.startBatch();
    assert.equal([...runs.values()].reduce((a, b) => a + b, 0), 10 + (failed <= 3 ? failed : 0));
    if (failed <= 3) {
      assert.ok(ids.every(id => f.context.tokenStatus.value[id] === "completed"));
      assert.doesNotMatch(f.state.notification.content, /首次失败/);
    }
  }
});

test("补跑仍失败保留最终原因且不会开启第三轮", async () => {
  const f = fixture();
  f.context.selectedTokens.value = ["a", "b", "c", "d"];
  f.context.tokens.value = ["a", "b", "c", "d"].map(id => ({ id, name: id }));
  let attempts = 0;
  f.context.DailyTaskRunner = class {
    async run(id) {
      if (id === "a") { attempts++; throw new Error(`失败第${attempts}次`); }
      return { planFailed: 0, planIncomplete: 0 };
    }
  };
  await f.startBatch();
  assert.equal(attempts, 2);
  assert.match(f.state.notification.content, /失败第2次/);
  assert.doesNotMatch(f.state.notification.content, /失败第1次/);
});
