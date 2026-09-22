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
});

test("从最高星开始并允许同种鱼灵多次合成及连续升星", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      items: {
        16011: { quantity: 40 },
        14011: { quantity: 4 },
        14013: { quantity: 2 },
        11011: { quantity: 99 },
      },
    },
  });

  assert.equal(plan[0].itemId, 14013);
  assert.equal(plan.filter(({ itemId }) => itemId === 16011).length, 2);
  assert.equal(plan.filter(({ itemId }) => itemId === 14011).length, 2);
  assert.equal(plan.some(({ fishId }) => fishId === 1101), false);
});

test("装备中的鱼灵使用额外库存材料升级并保持绑定", () => {
  const plan = planFishArtifactUpgrades({
    role: {
      heroes: { 107: { heroId: 107, artifactId: 13044 } },
      items: { 13044: { quantity: 1 } },
    },
  });

  assert.deepEqual(plan.map(({ itemId, heroId }) => ({ itemId, heroId })), [
    { itemId: 13044, heroId: 107 },
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
    [{ fishId: 1304, actualStar: 5, claimedStar: 2, upgradeCount: 3 }],
  );
});
