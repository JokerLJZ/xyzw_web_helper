import assert from "node:assert/strict";
import { test } from "node:test";
import { createWeeklyRewardMap, normalizeWeeklyRewardChoice } from "../src/utils/weeklyReward.js";

test("大奖选择保留零号选项，并对非法配置回退默认", () => {
  assert.equal(normalizeWeeklyRewardChoice(0), 0);
  assert.equal(normalizeWeeklyRewardChoice("2"), 2);
  for (const value of [null, undefined, "", -1, 0.5, Infinity, "bad"]) {
    assert.equal(normalizeWeeklyRewardChoice(value), 1);
  }
});

test("三种周常按各自活动编号构建数字选择映射", () => {
  assert.deepEqual(createWeeklyRewardMap(1, 0), new Map([[1, 0]]));
  assert.deepEqual(createWeeklyRewardMap(2, 2), new Map([[0, 2]]));
  assert.deepEqual(createWeeklyRewardMap(12, 3), new Map([[0, 3]]));
});
