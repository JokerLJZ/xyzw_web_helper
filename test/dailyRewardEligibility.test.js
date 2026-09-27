import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DailyTaskRunner,
  getClaimableDailyTaskRewardIds,
  getCollectionFreeRewardClaimState,
  getPermanentCardClaimState,
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

test("周常奖励 200020 标记为状态未确认，不再冒充已领取", async () => {
  const { runner, logs } = createRunner(async () => {
    throw new Error("服务器错误: 200020 - 出了点小问题，请尝试重启游戏解决～");
  });

  const result = await runner.claimWeeklyTaskReward("token-1");

  assert.deepEqual(result, { skipped: true, reason: "unconfirmed" });
  assert.equal(logs.some((entry) => entry.type === "error"), false);
  assert.equal(
    logs.some((entry) => entry.message.includes("领取状态未确认")),
    true,
  );
});

test("只规划进度达标且尚未领取的每日任务奖励", () => {
  assert.deepEqual(
    getClaimableDailyTaskRewardIds({
      complete: {
        1: 1,
        2: 0,
        3: 3,
        4: -1,
        5: 4,
        12: 1,
        13: 0,
        14: 1,
      },
    }),
    [1, 3, 12, 14],
  );
});

test("领取任务奖励前刷新状态并只发送对应任务指令", async () => {
  const commands = [];
  const { runner } = createRunner(
    async (_tokenId, cmd, params) => {
      commands.push({ cmd, params });
      return { role: { dailyTask: { complete: { [params.taskId]: -1 } } } };
    },
    async () => ({
      role: {
        dailyTask: {
          complete: { 1: 1, 2: 0, 3: 3, 12: -1, 14: 1 },
        },
      },
    }),
  );

  const result = await runner.claimAvailableDailyTaskRewards("token-1");

  assert.deepEqual(result, { skipped: false, taskIds: [1, 3, 14] });
  assert.deepEqual(commands, [
    { cmd: "task_claimdailypoint", params: { taskId: 1 } },
    { cmd: "task_claimdailypoint", params: { taskId: 3 } },
    { cmd: "task_claimdailypoint", params: { taskId: 14 } },
  ]);
});

test("周常奖励的其他错误仍交给任务层统一记录", async () => {
  const expectedError = new Error("连接断开");
  const { runner, logs } = createRunner(async () => {
    throw expectedError;
  });

  await assert.rejects(
    () => runner.claimWeeklyTaskReward("token-1"),
    expectedError,
  );
  assert.equal(logs.some((entry) => entry.type === "error"), false);
});
