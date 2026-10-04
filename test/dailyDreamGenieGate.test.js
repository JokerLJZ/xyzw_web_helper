import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DREAM_MIN_MAIN_LEVEL,
  GENIE_MIN_MAIN_LEVEL,
  isDreamMainLevelUnlocked,
  isGenieMainLevelUnlocked,
  planDailyGenieRewards,
} from "../src/utils/dailyFeatureEligibility.js";

test("梦境和灯神按主线关卡判断是否解锁", () => {
  assert.equal(isDreamMainLevelUnlocked({ levelId: DREAM_MIN_MAIN_LEVEL - 1 }), false);
  assert.equal(isDreamMainLevelUnlocked({ levelId: DREAM_MIN_MAIN_LEVEL }), true);
  assert.equal(isGenieMainLevelUnlocked({ levelId: GENIE_MIN_MAIN_LEVEL - 1 }), false);
  assert.equal(isGenieMainLevelUnlocked({ levelId: GENIE_MIN_MAIN_LEVEL }), true);
});

test("未解锁灯神时不规划任何领取操作", () => {
  assert.deepEqual(
    planDailyGenieRewards({ levelId: GENIE_MIN_MAIN_LEVEL - 1 }),
    { unlocked: false, claimableGenieIds: [], remainingTicketClaims: 0 },
  );
});

test("灯神仅规划存在进度且今日未领取的四阵营奖励", () => {
  const current = new Date(2026, 8, 24, 12, 0, 0);
  const nowSeconds = Math.floor(current.getTime() / 1000);
  const role = {
    levelId: GENIE_MIN_MAIN_LEVEL,
    genie: { 1: 0, 2: 5, 4: 16 },
    statistics: { "genie:sweep:buy": 2 },
    statisticsTime: {
      "genie:daily:free:2": nowSeconds,
      "genie:daily:free:4": nowSeconds,
      "genie:sweep:buy": nowSeconds,
    },
  };
  assert.deepEqual(planDailyGenieRewards(role, current), {
    unlocked: true,
    claimableGenieIds: [1],
    remainingTicketClaims: 1,
  });
});
