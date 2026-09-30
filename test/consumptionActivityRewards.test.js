import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildConsumptionItemUseBatches,
  createTasksDungeon,
  findConsumptionActivity,
  findMostReturnedConsumptionItem,
  getClaimableConsumptionMissions,
  summarizeConsumptionRewards,
} from "../src/utils/batch/tasksDungeon.js";

const capturedActivity = {
  activity: {
    dropReward: {
      1: [{ type: 3, itemId: 5278, value: 1, ext: 0 }],
      3: [{ type: 3, itemId: 5278, value: 1, ext: 0 }],
      7: [{ type: 3, itemId: 5278, value: 1, ext: 0 }],
      9: [{ type: 3, itemId: 5279, value: 1, ext: 0 }],
    },
    commonActivityInfo: {
      2606191: {
        record: {
          1: 1781851816,
          21: 1781851556,
          22: 1781851871,
          61: 1781851832,
        },
        task: { 1: 80, 2: 6000, 3: 20, 4: 4, 5: 8000 },
        isBought: false,
      },
    },
  },
};

test("自动选择本期累计返回数量最多的普通活动道具", () => {
  assert.deepEqual(findMostReturnedConsumptionItem(capturedActivity), {
    itemId: 5278,
    total: 3,
  });
});

test("消耗活动道具每次最多使用3000个", () => {
  assert.deepEqual(buildConsumptionItemUseBatches(0), []);
  assert.deepEqual(buildConsumptionItemUseBatches(3000), [3000]);
  assert.deepEqual(buildConsumptionItemUseBatches(7501), [3000]);
});

test("消耗活动查询结果可自动识别活动ID和未领取档位", () => {
  const activity = findConsumptionActivity(capturedActivity);

  assert.equal(activity.activityId, 2606191);
  assert.deepEqual(
    getClaimableConsumptionMissions(activity.info).map((item) => item.missionId),
    [23],
  );
});

test("消耗活动奖励汇总不会丢失同档返回的两种道具", () => {
  assert.deepEqual(
    summarizeConsumptionRewards([
      [
        { type: 3, itemId: 5279, value: 4, ext: 0 },
        { type: 3, itemId: 5278, value: 8, ext: 0 },
      ],
      [{ type: 3, itemId: 5278, value: 2, ext: 0 }],
    ]),
    [
      { type: 3, itemId: 5279, value: 4, ext: 0 },
      { type: 3, itemId: 5278, value: 10, ext: 0 },
    ],
  );
});

test("批量领取严格先查询，再按动态活动ID领取并刷新", async () => {
  const tokenId = "token-1";
  const commands = [];
  const logs = [];
  const tokenStatus = { value: {} };

  const tokenStore = {
    getWebSocketStatus: () => "disconnected",
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });
      if (cmd === "activity_get") return capturedActivity;
      if (cmd === "activity_claimtaskreward") {
        return {
          reward: [
            { type: 3, itemId: 5279, value: 4, ext: 0 },
            { type: 3, itemId: 5278, value: 8, ext: 0 },
          ],
        };
      }
      return {};
    },
    closeWebSocketConnection() {},
  };

  const tasks = createTasksDungeon({
    selectedTokens: { value: [tokenId] },
    tokens: { value: [{ id: tokenId, name: "测试账号" }] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1, dreamPurchaseList: [] },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    delayConfig: { command: 0 },
  });

  await tasks.batchClaimConsumptionRewards();

  assert.deepEqual(commands, [
    { cmd: "activity_get", params: {} },
    {
      cmd: "activity_claimtaskreward",
      params: { activityId: 2606191, missionId: 23 },
    },
    { cmd: "activity_get", params: {} },
  ]);
  assert.equal(tokenStatus.value[tokenId], "completed");
  assert.ok(
    logs.some(
      (entry) =>
        entry.message.includes("道具5279x4") &&
        entry.message.includes("道具5278x8"),
    ),
  );
});

test("批量使用高级奖励道具每个账号只执行一次且最多3000个", async () => {
  const tokenId = "token-use";
  const commands = [];
  const tokenStatus = { value: {} };
  const tasks = createTasksDungeon({
    selectedTokens: { value: [tokenId] },
    tokens: { value: [{ id: tokenId, name: "使用账号" }] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1, dreamPurchaseList: [] },
    tokenStore: {
      getWebSocketStatus: () => "disconnected",
      async sendMessageWithPromise(_tokenId, cmd, params) {
        commands.push({ cmd, params });
        if (cmd === "activity_get") return capturedActivity;
        if (cmd === "role_getroleinfo") {
          return { role: { items: { 5279: { quantity: 7501 } } } };
        }
        if (cmd === "item_openbox") return { reward: [] };
        return {};
      },
      closeWebSocketConnection() {},
    },
    addLog: () => {},
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    delayConfig: { command: 0 },
  });

  await tasks.batchUseConsumptionActivityItems();

  assert.deepEqual(
    commands.filter(({ cmd }) => cmd === "item_openbox"),
    [3000].map((number) => ({
      cmd: "item_openbox",
      params: { itemId: 5279, number, index: 0 },
    })),
  );
  assert.equal(tokenStatus.value[tokenId], "completed");
});
