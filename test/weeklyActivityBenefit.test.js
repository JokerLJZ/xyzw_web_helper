import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

test("宝箱周福利使用抓包确认的活动商店参数", async () => {
  const tokenId = "token-1";
  const commands = [];
  const tokenStatus = { value: {} };

  const tokenStore = {
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });
      if (cmd === "activity_get") {
        return {
          activity: {
            myTotalInfo: { 2: { num: 0, complete: {} } },
          },
        };
      }
      return {};
    },
    closeWebSocketConnection() {},
  };

  const tasks = createTasksItem({
    selectedTokens: { value: [tokenId] },
    tokens: { value: [{ id: tokenId, name: "测试账号" }] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1 },
    tokenStore,
    addLog: () => {},
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    helperSettings: {},
    delayConfig: { action: 0 },
    activityWeek: { value: "宝箱周" },
  });

  await tasks.batchClaimWeeklyActivityBenefit();

  const purchase = commands.find(
    (command) => command.cmd === "activity_buystoregoods",
  );
  assert.deepEqual(purchase?.params, {
    activityId: 7,
    goodsIndex: 0,
    buyNum: 1,
  });
  assert.equal(tokenStatus.value[tokenId], "completed");
});
