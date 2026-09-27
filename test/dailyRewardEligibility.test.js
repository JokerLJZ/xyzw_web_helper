import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DailyTaskRunner,
  getCollectionFreeRewardClaimState,
  getPermanentCardClaimState,
} from "../src/utils/dailyTaskRunner.js";

const createRunner = (sendMessageWithPromise) => {
  const logs = [];
  const runner = new DailyTaskRunner(
    {
      gameTokens: [{ id: "token-1", name: "测试账号" }],
      sendMessageWithPromise,
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

  assert.equal(
    getPermanentCardClaimState({ cards: { 4003: { canClaim: true } } }, now),
    "claimable",
  );
  assert.equal(
    getPermanentCardClaimState(
      {
        cards: { 4003: {} },
        statisticsTime: { "card:reward:4003": todaySeconds },
      },
      now,
    ),
    "claimed",
  );
  assert.equal(getPermanentCardClaimState({ cards: {} }, now), "unavailable");
});

test("珍宝阁领取状态兼容直接和嵌套响应", () => {
  assert.equal(
    getCollectionFreeRewardClaimState({ freeRewardAvailable: true }),
    "claimable",
  );
  assert.equal(
    getCollectionFreeRewardClaimState({ data: { freeRewardClaimed: true } }),
    "claimed",
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
      return { data: { canClaimFreeReward: true } };
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

test("周常奖励 200020 按已处理记录，不再抛出失败", async () => {
  const { runner, logs } = createRunner(async () => {
    throw new Error("服务器错误: 200020 - 出了点小问题，请尝试重启游戏解决～");
  });

  const result = await runner.claimWeeklyTaskReward("token-1");

  assert.deepEqual(result, { skipped: true, reason: "already-processed" });
  assert.equal(logs.some((entry) => entry.type === "error"), false);
  assert.equal(
    logs.some((entry) => entry.message.includes("已领取或服务器已处理")),
    true,
  );
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
