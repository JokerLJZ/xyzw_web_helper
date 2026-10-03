import assert from "node:assert/strict";
import { test } from "node:test";
import { createWeeklyRewardMap, normalizeWeeklyRewardChoice, WEEKLY_REWARD_OPTIONS } from "../src/utils/weeklyReward.js";

test("大奖选择按六项奖励编号校验，非法配置回退万能红", () => {
  assert.equal(normalizeWeeklyRewardChoice(6), 6);
  assert.equal(normalizeWeeklyRewardChoice("2"), 2);
  for (const value of [null, undefined, "", 0, -1, 7, 0.5, Infinity, "bad"]) {
    assert.equal(normalizeWeeklyRewardChoice(value), 1);
  }
});

test("三种周常按各自活动编号构建数字选择映射", () => {
  assert.deepEqual(createWeeklyRewardMap(1, 6), new Map([[1, 6]]));
  assert.deepEqual(createWeeklyRewardMap(2, 2), new Map([[0, 2]]));
  assert.deepEqual(createWeeklyRewardMap(12, 3), new Map([[0, 3]]));
});


test("六项大奖按用户提供顺序对应接口编号1至6", () => {
  assert.deepEqual(WEEKLY_REWARD_OPTIONS.map(({ label }) => label), ["150万能红碎片", "7500晶石", "20000精铁", "20000进阶石", "2000扳手", "1珍珠"]);
  for (const typ of [1, 2, 12]) {
    for (const { value } of WEEKLY_REWARD_OPTIONS) {
      assert.equal(createWeeklyRewardMap(typ, value).get(typ === 1 ? 1 : 0), value);
    }
  }
});
