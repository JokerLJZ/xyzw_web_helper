import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

const createScenario = ({ progress = 0, activityWeek = "黑市周" } = {}) => {
  const tokenId = "token-1";
  const token = { id: tokenId, name: "测试账号" };
  const commands = [];
  const logs = [];
  const tokenStatus = { value: {} };

  const tokenStore = {
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });
      if (cmd === "activity_get") {
        return {
          activity: {
            myTotalInfo: { 11: { num: progress, complete: {} } },
          },
        };
      }
      return {};
    },
    closeWebSocketConnection() {},
  };

  const deps = {
    selectedTokens: { value: [tokenId] },
    tokens: { value: [token] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1 },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    helperSettings: {},
    delayConfig: { action: 0 },
    activityWeek: { value: activityWeek },
  };

  return {
    run: () => createTasksItem(deps).batchSmartBlackMarketWeekly(),
    commands,
    logs,
    tokenStatus,
  };
};

const getPurchases = (commands) =>
  commands.filter((command) => command.cmd === "activity_buystoregoods");

test("江湖黑市按默认清单采购，跳过3和8且购买9四次", async () => {
  const scenario = createScenario({ progress: 100000 });

  await scenario.run();

  const purchases = getPurchases(scenario.commands);
  assert.deepEqual(
    purchases.map((command) => command.params.goodsIndex),
    [0, 1, 2, 4, 5, 6, 7, 9, 9, 9, 9],
  );
  assert.deepEqual(
    scenario.commands.find(
      (command) => command.cmd === "activity_claimweekactreward",
    )?.params,
    { selectRewardsMap: { 0: 1 }, typ: 12 },
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("金砖达标未满十万时不领取自选奖励", async () => {
  const scenario = createScenario({ progress: 99999 });

  await scenario.run();

  assert.equal(
    scenario.commands.some(
      (command) => command.cmd === "activity_claimweekactreward",
    ),
    false,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("非黑市周跳过江湖黑市任务", async () => {
  const scenario = createScenario({ activityWeek: "招募周" });

  await scenario.run();

  assert.equal(getPurchases(scenario.commands).length, 0);
  assert.equal(scenario.tokenStatus.value["token-1"], "skipped");
});
