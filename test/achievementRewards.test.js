import assert from "node:assert/strict";
import test from "node:test";

import { getClaimableAchievementIds } from "../src/utils/achievementRewards.js";

test("只规划已经完成且尚未领取的连续成就奖励", () => {
  assert.deepEqual(
    getClaimableAchievementIds({
      1: { completeValue: 5, lastClaimId: 2 },
      2: { completeValue: 49, lastClaimId: 0 },
    }),
    [3, 4, 5],
  );
});

test("已领取旧阶段后可以规划新增的成就阶段", () => {
  assert.deepEqual(
    getClaimableAchievementIds({
      1: { completeValue: 90, lastClaimId: 10 },
    }),
    [195, 196, 197],
  );
});

test("排名成就按名次越小越好判断并忽略未知领奖进度", () => {
  assert.deepEqual(
    getClaimableAchievementIds({
      14: { completeValue: 45, lastClaimId: 174 },
      7: { completeValue: 99999, lastClaimId: 999 },
    }),
    [175, 176],
  );
});
