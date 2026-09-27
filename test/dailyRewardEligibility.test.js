import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DAILY_TASK_REWARD_IDS,
  DailyTaskRunner,
  getCollectionFreeRewardClaimState,
  getPermanentCardClaimState,
  getTaskRewardClaimState,
} from "../src/utils/dailyTaskRunner.js";

const createRunner = (
  sendMessageWithPromise,
  sendGetRoleInfo = async () => ({}),
) => {
  const logs = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "token-1", name: "测试账号" }],
      sendMessageWithPromise,
      sendGetRoleInfo,
    },
    { commandDelay: 0, taskDelay: 0 },
  );
  runner.callbacks = {
    onLog: (entry) => logs.push(entry),
  };
  return { runner, logs };
};

test("永久卡仅在持有且今日未领取时判定为可领取", () => {
  const now = new Date(2026, 8, 27, 12, 0, 0);
  const todaySeconds = Math.floor(now.getTime() / 1000);
  const yesterdaySeconds = todaySeconds - 24 * 60 * 60;

  assert.equal(
    getPermanentCardClaimState(
      {
        cardTime: {
          4003: {
            expireTime: todaySeconds + 365 * 24 * 60 * 60,
            lastClaimTime: yesterdaySeconds,
          },
        },
      },
      now,
    ),
    "claimable",
  );
  assert.equal(
    getPermanentCardClaimState(
      {
        cardTime: {
          4003: {
            expireTime: todaySeconds + 365 * 24 * 60 * 60,
            lastClaimTime: todaySeconds,
          },
        },
      },
      now,
    ),
    "claimed",
  );
  assert.equal(getPermanentCardClaimState({ cards: {} }, now), "unavailable");
});

test("珍宝阁按商品列表响应中的上次领取时间判断", () => {
  const now = new Date(2026, 8, 27, 12, 0, 0);
  const todaySeconds = Math.floor(now.getTime() / 1000);
  const yesterdaySeconds = todaySeconds - 24 * 60 * 60;

  assert.equal(
    getCollectionFreeRewardClaimState(
      { storeInfo: { freeRewardTime: yesterdaySeconds } },
      now,
    ),
    "claimable",
  );
  assert.equal(
    getCollectionFreeRewardClaimState(
      {
        _raw: {
          body: { storeInfo: { freeRewardTime: todaySeconds } },
        },
      },
      now,
    ),
    "claimed",
  );
  assert.equal(
    getCollectionFreeRewardClaimState(
      { body: { storeInfo: { freeRewardTime: 0 } } },
      now,
    ),
    "claimable",
  );
  assert.equal(getCollectionFreeRewardClaimState({ goodsList: [] }), "unknown");
});

test("永久卡不可领取时不发送领取指令", async () => {
  const commands = [];
  const { runner } = createRunner(async (_tokenId, cmd) => {
    commands.push(cmd);
    return {};
  });
  runner.roleSnapshots.set("token-1", { cards: {} });

  const result = await runner.claimPermanentCardRewardIfAvailable("token-1");

  assert.equal(result.skipped, true);
  assert.deepEqual(commands, []);
});

test("珍宝阁先查询，可领取时才发送领取指令", async () => {
  const commands = [];
  const { runner } = createRunner(async (_tokenId, cmd) => {
    commands.push(cmd);
    if (cmd === "collection_goodslist") {
      return { storeInfo: { freeRewardTime: 0 } };
    }
    return { reward: [] };
  });

  await runner.claimCollectionFreeRewardIfAvailable("token-1");

  assert.deepEqual(commands, [
    "collection_goodslist",
    "collection_claimfreereward",
  ]);
});

test("珍宝阁状态不可识别时只查询、不盲目领取", async () => {
  const commands = [];
  const { runner } = createRunner(async (_tokenId, cmd) => {
    commands.push(cmd);
    return { goodsList: [] };
  });

  const result = await runner.claimCollectionFreeRewardIfAvailable("token-1");

  assert.equal(result.skipped, true);
  assert.deepEqual(commands, ["collection_goodslist"]);
});

test("日常和周常奖励严格按API积分状态判断", () => {
  assert.equal(getTaskRewardClaimState({ dailyPoint: 99 }, "daily"), "unavailable");
  assert.equal(getTaskRewardClaimState({ dailyPoint: 100 }, "daily"), "claimable");
  assert.equal(getTaskRewardClaimState({ dailyPoint: 101 }, "daily"), "claimed");
  assert.equal(getTaskRewardClaimState({ weekPoint: 499 }, "weekly"), "unavailable");
  assert.equal(getTaskRewardClaimState({ weekPoint: 500 }, "weekly"), "claimable");
  assert.equal(getTaskRewardClaimState({ weekPoint: 501 }, "weekly"), "claimed");
  assert.equal(getTaskRewardClaimState({}, "daily"), "unknown");
});

test("单项任务奖励严格限制为1到10", () => {
  assert.deepEqual([...DAILY_TASK_REWARD_IDS], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("日常和周常奖励先查询API，只在明确可领取时发送指令", async () => {
  const commands = [];
  const roleStates = [
    { role: { dailyTask: { dailyPoint: 100, weekPoint: 400 } } },
    { role: { dailyTask: { dailyPoint: 101, weekPoint: 500 } } },
  ];
  const { runner } = createRunner(
    async (_tokenId, cmd) => {
      commands.push(cmd);
      return {};
    },
    async () => roleStates.shift(),
  );

  const dailyResult = await runner.claimDailyTaskReward("token-1");
  const weeklyResult = await runner.claimWeeklyTaskReward("token-1");

  assert.equal(dailyResult.skipped, undefined);
  assert.equal(weeklyResult.skipped, undefined);
  assert.deepEqual(commands, ["task_claimdailyreward", "task_claimweekreward"]);
});

test("状态不明确或积分未达标时不发送日常周常领奖指令", async () => {
  const commands = [];
  const roleStates = [
    { role: { dailyTask: {} } },
    { role: { dailyTask: { weekPoint: 499 } } },
  ];
  const { runner } = createRunner(
    async (_tokenId, cmd) => {
      commands.push(cmd);
      return {};
    },
    async () => roleStates.shift(),
  );

  const dailyResult = await runner.claimDailyTaskReward("token-1");
  const weeklyResult = await runner.claimWeeklyTaskReward("token-1");

  assert.deepEqual(dailyResult, { skipped: true, reason: "unknown" });
  assert.deepEqual(weeklyResult, { skipped: true, reason: "unavailable" });
  assert.deepEqual(commands, []);
});
