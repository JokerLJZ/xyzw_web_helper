import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksHangUp } from "../src/utils/batch/tasksHangUp.js";

const createHangUpScenario = ({ knowledgeCoins = 0, pendingOrders = 0 } = {}) => {
  const tokenId = "token-1";
  const commands = [];
  const logs = [];
  const shouldStop = { value: false };
  let roleInfoQueries = 0;

  const tokenStore = {
    async sendGetRoleInfo() {
      roleInfoQueries += 1;
      return {
        role: {
          items: { 1024: { quantity: knowledgeCoins } },
          hangUp: {
            activeOrder: pendingOrders,
            lastClaimedOrder: 0,
          },
        },
      };
    },
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });
      if (cmd === "system_claimhangupreward") {
        shouldStop.value = true;
      }
      if (cmd === "system_claimhanguporder") {
        return {
          role: {
            hangUp: {
              activeOrder: pendingOrders,
              lastClaimedOrder: pendingOrders,
            },
          },
          reward: [],
        };
      }
      return {};
    },
    closeWebSocketConnection() {},
  };

  const deps = {
    selectedTokens: { value: [tokenId] },
    tokens: { value: [{ id: tokenId, name: "测试账号" }] },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop,
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1 },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
  };

  return {
    tasks: createTasksHangUp(deps),
    commands,
    logs,
    getRoleInfoQueries: () => roleInfoQueries,
  };
};

test("领取挂机不再自动升级或检查整数关卡奖励", async () => {
  const scenario = createHangUpScenario({
    knowledgeCoins: 10,
    pendingOrders: 2,
  });

  await scenario.tasks.claimHangUpRewards();

  assert.equal(scenario.getRoleInfoQueries(), 0);
  assert.deepEqual(
    scenario.commands.map((item) => item.cmd),
    ["system_claimhangupreward"],
  );
});

test("独立小号任务执行挂机升级并领取整数关卡奖励", async () => {
  const scenario = createHangUpScenario({
    knowledgeCoins: 1,
    pendingOrders: 2,
  });

  await scenario.tasks.batchUpgradeHangUpAndClaimOrderRewards();

  assert.deepEqual(
    scenario.commands.map((item) => item.cmd),
    ["system_hangupupgrade", "system_claimhanguporder"],
  );
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("整数关卡挂机奖励领取完成"),
    ),
    true,
  );
});
