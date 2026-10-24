import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { getBatchRetryTokenIds, normalizeTaskResultStatus, summarizeScheduledAccount } from "../src/utils/scheduledTaskResult.js";
import { formatScheduledTaskNotification } from "../src/utils/wxpusher.js";
const component = await readFile(new URL("../src/views/BatchDailyTasks.vue", import.meta.url), "utf8");
const source = ts.createSourceFile("batch.js", component.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1], ts.ScriptTarget.Latest, true);
const declaration = source.statements.find(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(source) === "executeScheduledTask")).getText(source);
function fixture({ beforeFailure = false, dailyFailure = true, connectionFailure = false } = {}) {
  const reports = [];
  const ref = value => ({ value });
  const context = {
    console: { error() {} }, scheduledTaskExecutionActive: false, isRunning: ref(false),
    taskExecutionHistory: ref({}), saveTaskExecutionHistory() {}, addLog() {},
    verifyTaskDependencies: async () => true, normalizeTokenIdsByBatchOrder: ids => [...ids],
    tokens: ref([{ id: "a", name: "测试账号" }]), selectedTokens: ref(["a"]),
    integratedDailyTaskNames: [], tokenStatus: ref({}), tokenTaskReasons: ref({}), tokenTaskWarnings: ref({}),
    isLegacyTaskName: () => false, availableTasks: [], shouldStop: ref(false), currentRunningTokenId: ref(null),
    beginScheduledTokenSession() {}, endScheduledTokenSession() {}, scheduledTokenSession: { active: false },
    ensureConnection: async () => { if (connectionFailure) throw new Error("连接超时"); },
    getBatchRetryTokenIds, normalizeTaskResultStatus, summarizeScheduledAccount, formatScheduledTaskNotification,
    getUpcomingScheduledTaskRuns: () => [], recordTaskExecution() {},
    sendNotifications: async (title, content, options) => reports.push({ title, content, options }),
    getScheduledTaskFunction: name => async () => {
      if (name === "before" && beforeFailure) throw new Error("前置任务失败：200020");
      if (name === "startBatch") {
        // The real daily entry resets its per-task account details.
        context.tokenTaskReasons.value.a = dailyFailure ? ["领取每日礼包：200020"] : [];
        context.tokenStatus.value.a = dailyFailure ? "failed" : "completed";
      } else context.tokenStatus.value.a = "completed";
      return [];
    },
  };
  vm.createContext(context);
  vm.runInContext(`${declaration}\nglobalThis.execute = executeScheduledTask`, context);
  return { context, reports, run: () => context.execute({ id: "task", name: "含日常计划", selectedTokens: ["a"], selectedTasks: ["before", "startBatch", "batchPushMainLevelInfo"], legacyExcludedTokens: [] }) };
}

test("实际定时调度：日常失败不被后续成功覆盖，包含专项推送任务也发WxPusher失败原因", async () => {
  const f = fixture(); await f.run();
  assert.equal(f.reports.length, 1);
  assert.match(f.reports[0].content, /领取每日礼包：服务器异常（200020）/);
  assert.match(f.reports[0].title, /⚠️/);
  assert.equal(f.reports[0].options.skipWxPusher, false);
});

test("实际定时调度：日常重置临时状态也不会丢失之前任务的失败原因", async () => {
  const f = fixture({ beforeFailure: true, dailyFailure: false }); await f.run();
  assert.match(f.reports[0].content, /before：服务器异常（200020）/);
  assert.match(f.reports[0].title, /⚠️/);
});

test("实际定时调度：连接失败也推送账号与连接原因", async () => {
  const f = fixture({ connectionFailure: true }); await f.run();
  assert.match(f.reports[0].content, /测试账号/);
  assert.match(f.reports[0].content, /账号连接异常/);
});

test("定时账号失败不超过30%时整套任务补跑一次，恢复成功后只推送最终成功", async () => {
  const f = fixture({ dailyFailure: false });
  const ids = ["a", "b", "c", "d"];
  f.context.tokens.value = ids.map(id => ({ id, name: id }));
  const attempts = {};
  f.context.getScheduledTaskFunction = name => async () => {
    const id = f.context.selectedTokens.value[0];
    if (name === "startBatch") {
      attempts[id] = (attempts[id] || 0) + 1;
      f.context.tokenStatus.value[id] = id === "a" && attempts[id] === 1 ? "failed" : "completed";
      f.context.tokenTaskReasons.value[id] = id === "a" && attempts[id] === 1 ? ["领取每日礼包：200020"] : [];
    } else f.context.tokenStatus.value[id] = "completed";
    return [];
  };
  await f.context.execute({ id: "retry", name: "恢复计划", selectedTokens: ids, selectedTasks: ["startBatch"], legacyExcludedTokens: [] });
  assert.deepEqual(attempts, { a: 2, b: 1, c: 1, d: 1 });
  assert.equal(f.reports.length, 1);
  assert.doesNotMatch(f.reports[0].content, /200020/);
  assert.ok(ids.every(id => f.context.tokenStatus.value[id] === "completed"));
});

test("用户停止或待继续不触发失败账号重跑", () => {
  assert.deepEqual(getBatchRetryTokenIds(["a", "b", "c", "d"], { a: "failed", b: "completed", c: "completed", d: "completed" }, true), []);
  assert.deepEqual(getBatchRetryTokenIds(["a", "b", "c", "d"], { a: "pending", b: "stopped", c: "completed", d: "completed" }), []);
});

for (const connectionLost of [true, false]) {
  test(`定时子任务抛出中断：${connectionLost ? '断线补跑' : '主动停止不补跑'}`, async () => {
    const f = fixture();
    const ids = ['a', 'b', 'c', 'd'];
    f.context.tokens.value = ids.map(id => ({ id, name: id }));
    const attempts = {};
    f.context.getScheduledTaskFunction = () => async () => {
      const id = f.context.selectedTokens.value[0];
      attempts[id] = (attempts[id] || 0) + 1;
      if (id === 'a' && attempts[id] === 1)
        throw Object.assign(new Error(connectionLost ? 'WebSocket 已断开' : '用户停止'), { interrupted: true, connectionLost });
      f.context.tokenStatus.value[id] = 'completed';
    };
    await f.context.execute({ id: 'disconnect', name: '断线计划', selectedTokens: ids, selectedTasks: ['startBatch'], legacyExcludedTokens: [] });
    assert.deepEqual(attempts, { a: connectionLost ? 2 : 1, b: 1, c: 1, d: 1 });
    assert.equal(f.context.tokenStatus.value.a, connectionLost ? 'completed' : 'stopped');
  });
}
