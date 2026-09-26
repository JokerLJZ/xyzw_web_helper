import assert from "node:assert/strict";
import test from "node:test";

import {
  getAffordableLevelCount,
  getHeroLevelCost,
  getHeroOrderCost,
  getLordLevelCost,
  getLordOrderCost,
  getTrumpTransformCost,
  getTrumpUpgradeCost,
  getWarriorResearchCost,
  isAttackTrump,
} from "../src/utils/upgradeResourcePlanner.js";

test("武将和主公升级按配置计算可负担等级数", () => {
  assert.equal(getHeroLevelCost(1), 17);
  assert.equal(getLordLevelCost(1), 5);

  const plan = getAffordableLevelCount({
    currentLevel: 1,
    maximumLevel: 100,
    maximumCount: 50,
    gold: 34,
    getCost: getHeroLevelCost,
  });
  assert.deepEqual(plan, { count: 2, goldCost: 34 });
});

test("主公和武将进阶读取当前阶对应的进阶石消耗", () => {
  assert.deepEqual(getHeroOrderCost(0), { requiredLevel: 100, stones: 50 });
  assert.deepEqual(getLordOrderCost(0), { requiredLevel: 100, stones: 20 });
  assert.equal(getLordOrderCost(19), null);
});

test("水晶升级包含金币、材料和锁定属性金砖消耗", () => {
  assert.deepEqual(getTrumpUpgradeCost(1, true), {
    gold: 3486,
    itemId: 1016,
    items: 28,
    diamonds: 2,
  });
  assert.deepEqual(getTrumpUpgradeCost(61, true), {
    gold: 3486,
    itemId: 1016,
    items: 28,
    diamonds: 2,
  });
  assert.equal(getTrumpUpgradeCost(60, true), null);
});

test("水晶按配置编号识别攻击类型并读取转换消耗", () => {
  assert.equal(isAttackTrump(1), true);
  assert.equal(isAttackTrump(60), true);
  assert.equal(isAttackTrump(61), false);
  assert.deepEqual(getTrumpTransformCost(61), {
    gold: 458,
    itemId: 1016,
    items: 5,
  });
});

test("战士科技按目标等级读取金币和科技点消耗", () => {
  assert.deepEqual(getWarriorResearchCost(101, 1), {
    gold: 5000,
    legionCoins: 12,
  });
  assert.equal(getWarriorResearchCost(101, 61), null);
});
