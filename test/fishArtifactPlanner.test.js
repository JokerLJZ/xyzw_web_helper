import test from "node:test";
import assert from "node:assert/strict";

import {
  getFishMergeCost,
  planFishArtifactUpgrades,
  planFishBookUpgrades,
} from "../src/utils/fishArtifactPlanner.js";

test("鱼灵品质使用20、5、2、1条合成且忽略金色", () => {
  assert.equal(getFishMergeCost(16011), 20);
  assert.equal(getFishMergeCost(15011), 5);
  assert.equal(getFishMergeCost(14011), 2);
  assert.equal(getFishMergeCost(13011), 1);
  assert.equal(getFishMergeCost(12011), 1);
  assert.equal(getFishMergeCost(11011), 0);
  assert.equal(getFishMergeCost(15002), 0);
  assert.equal(getFishMergeCost(16002), 0);
});

test("未装备鱼灵从最高星开始并一次规划到材料不足", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      items: {
        16011: { quantity: 40 },
        14011: { quantity: 6 },
        14013: { quantity: 1 },
        11011: { quantity: 99 },
      },
    },
  });

  assert.equal(plan[0].itemId, 14013);
  assert.deepEqual(
    plan.filter(({ fishId }) => fishId === 1401).map(({ itemId }) => itemId),
    [14013, 14014],
  );
  assert.deepEqual(
    plan.filter(({ fishId }) => fishId === 1601).map(({ itemId }) => itemId),
    [16011],
  );
  assert.equal(plan.some(({ fishId }) => fishId === 1101), false);
});

test("装备中的鱼灵使用额外库存材料升级并保持绑定", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      heroes: { 107: { heroId: 107, artifactId: 13044 } },
      items: { 13041: { quantity: 1 } },
    },
  });

  assert.deepEqual(plan.map(({ itemId, heroId }) => ({ itemId, heroId })), [
    { itemId: 13044, heroId: 107 },
  ]);
});

test("橙色三星鱼灵使用两条一星材料升级到四星", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      items: {
        14011: { quantity: 2 },
        14013: { quantity: 1 },
      },
    },
  });
  assert.deepEqual(plan.map(({ itemId, cost }) => ({ itemId, cost })), [
    { itemId: 14013, cost: 2 },
  ]);
});

test("不会把其他武将已装备的鱼灵当作合成材料", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      heroes: {
        107: { heroId: 107, artifactId: 16011 },
        108: { heroId: 108, artifactId: 16011 },
      },
      items: { 16011: { quantity: 18 } },
    },
  });
  assert.equal(plan.length, 0);
});

test("已装备鱼灵本体不抵扣升级材料", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      heroes: { 107: { heroId: 107, artifactId: 13041 } },
    },
  });
  assert.equal(plan.length, 0);
});

test("已装备鱼灵优先于更高星的未装备鱼灵", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      heroes: { 107: { heroId: 107, artifactId: 14011 } },
      items: {
        14011: { quantity: 4 },
        14014: { quantity: 1 },
      },
    },
  });
  assert.deepEqual(
    plan.map(({ itemId, heroId }) => ({ itemId, heroId })),
    [
      { itemId: 14011, heroId: 107 },
      { itemId: 14012, heroId: 107 },
    ],
  );
});

test("五条一星红鱼可将其中一条连续升级到五星", () => {
  const plan = planFishArtifactUpgrades({
    role: { items: { 13041: { quantity: 5 } } },
  });
  assert.deepEqual(plan.map(({ itemId }) => itemId), [
    13041,
    13042,
    13043,
    13044,
  ]);
});

test("普通道具ID不会被误识别为鱼灵", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      items: {
        15002: { quantity: 999 },
        16002: { quantity: 999 },
      },
    },
  });
  assert.equal(plan.length, 0);
});

test("鱼灵图鉴按实际最高星与已领取星级之差规划", () => {
  assert.deepEqual(
    planFishBookUpgrades({
      role: {
        artifactBooks: {
          1101: { artifactId: 11015, claimedStar: 1 },
          1304: { artifactId: 13045, claimedStar: 2 },
          1502: { artifactId: 15023, claimedStar: 3 },
        },
      },
    }),
    [
      {
        fishId: 1304,
        actualStar: 5,
        claimedStar: 2,
        upgradeArtifactIds: [13043, 13044, 13045],
        upgradeCount: 3,
      },
    ],
  );
});
