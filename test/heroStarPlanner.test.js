import test from "node:test";
import assert from "node:assert/strict";

import { planHeroStarUpgrade } from "../src/utils/heroStarPlanner.js";

test("未拥有武将时先扣除8碎片用于合成，再规划升星", () => {
  assert.deepEqual(
    planHeroStarUpgrade({ heroId: 107, hero: null, fragmentQuantity: 24 }),
    { heroId: 107, currentStar: 0, needsSynthesis: true, upgradeCount: 2 },
  );
});

test("碎片仅够合成时只执行合成，不规划升星", () => {
  assert.deepEqual(
    planHeroStarUpgrade({ heroId: 204, hero: null, fragmentQuantity: 8 }),
    { heroId: 204, currentStar: 0, needsSynthesis: true, upgradeCount: 0 },
  );
});

test("未拥有且碎片不足时不合成也不升星", () => {
  assert.deepEqual(
    planHeroStarUpgrade({ heroId: 120, hero: null, fragmentQuantity: 7 }),
    { heroId: 120, currentStar: 0, needsSynthesis: false, upgradeCount: 0 },
  );
});

test("已拥有武将沿用当前星级直接规划升星", () => {
  assert.deepEqual(
    planHeroStarUpgrade({
      heroId: 107,
      hero: { heroId: 107, star: 5 },
      fragmentQuantity: 80,
    }),
    { heroId: 107, currentStar: 5, needsSynthesis: false, upgradeCount: 2 },
  );
});
