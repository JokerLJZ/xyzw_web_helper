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

test("三种周常按奖励零基下标映射到单轮领取份数", () => {
  assert.deepEqual(createWeeklyRewardMap(1, 6), new Map([[6, 1]]));
  assert.deepEqual(createWeeklyRewardMap(2, 2), new Map([[1, 1]]));
  assert.deepEqual(createWeeklyRewardMap(12, 3), new Map([[2, 1]]));
});


test("六项界面选择转换成奖励数组下标，领取份数始终为1", () => {
  assert.deepEqual(WEEKLY_REWARD_OPTIONS.map(({ label }) => label), ["150万能红碎片", "7500晶石", "20000精铁", "20000进阶石", "2000扳手", "1珍珠"]);
  for (const typ of [1, 2, 12]) {
    for (const { value } of WEEKLY_REWARD_OPTIONS) {
      assert.equal(createWeeklyRewardMap(typ, value).get(value - (typ === 1 ? 0 : 1)), 1);
    }
  }
});

for (const typ of [1, 2, 12]) {
  test(`活动${typ}珍珠领取一份，不能变成红碎领取六份`, () => {
    const reward = createWeeklyRewardMap(typ, 6);
    assert.deepEqual(reward, new Map([[typ === 1 ? 6 : 5, 1]]));
    assert.equal([...reward.values()].reduce((a, b) => a + b, 0), 1);
  });
}
