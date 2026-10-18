import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { normalizeTaskResultStatus, summarizeScheduledAccount } from "../src/utils/scheduledTaskResult.js";
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
    normalizeTaskResultStatus, summarizeScheduledAccount, formatScheduledTaskNotification,
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
