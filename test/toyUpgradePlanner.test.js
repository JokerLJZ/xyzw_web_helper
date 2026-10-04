import test from "node:test";
import assert from "node:assert/strict";
import {
  getToyActiveUpgradeCost,
  getToyPassiveUpgradeCost,
  planToyActiveUpgrades,
  planToyPassiveUpgrades,
} from "@/utils/toyUpgradePlanner";

test("玩具主动升级费用覆盖普通等级和突破等级", () => {
  assert.equal(getToyActiveUpgradeCost(10), 20);
  assert.equal(getToyActiveUpgradeCost(11), 50);
  assert.equal(getToyActiveUpgradeCost(31), 400);
  assert.equal(getToyActiveUpgradeCost(61), 1200);
  assert.equal(getToyActiveUpgradeCost(91), 3000);
  assert.equal(getToyActiveUpgradeCost(121), 8000);
  assert.equal(getToyActiveUpgradeCost(150), 5000);
});

test("玩具主动升级只规划扳手足够的次数", () => {
  assert.deepEqual(planToyActiveUpgrades(9, 89), {
    upgradeCount: 2,
    spent: 70,
    remaining: 19,
    finalLevel: 11,
  });
});

test("玩具被动升级费用随技能位置递增", () => {
  assert.equal(getToyPassiveUpgradeCost(1, 2), 160);
  assert.equal(getToyPassiveUpgradeCost(2, 2), 320);
  assert.equal(getToyPassiveUpgradeCost(3, 3), 1066);
  assert.equal(getToyPassiveUpgradeCost(4, 3), 2133);
});

test("只规划已开放被动技能并共享精铁库存", () => {
  const result = planToyPassiveUpgrades(
    { 5: { level: 1 }, 7: { level: 1 } },
    1000,
  );
  assert.deepEqual(result.plans, [
    { skillId: 5, currentLevel: 1, finalLevel: 4, upgradeCount: 3, spent: 799 },
    { skillId: 7, currentLevel: 1, finalLevel: 1, upgradeCount: 0, spent: 0 },
  ]);
  assert.equal(result.remaining, 201);
});
