import test from "node:test";
import assert from "node:assert/strict";

import {
  isHeroAwakeSlot,
  planHeroAwakenings,
} from "../src/utils/heroAwakeningPlanner.js";

test("所有红将按已拥有、星级达标且未觉醒规划槽位", () => {
  const plan = planHeroAwakenings(
    {
      role: {
        heroes: {
          107: {
            heroId: 107,
            star: 27,
            skill: [
              { active: true },
              { active: true },
              { active: false },
              { active: true },
            ],
            awakeSkill: { 0: true },
          },
          122: {
            heroId: 122,
            star: 22,
            skill: [{ active: true }],
            awakeSkill: {},
          },
        },
      },
    },
    [107, 122, 101, 210, 107],
  );

  assert.deepEqual(plan, [
    { heroId: 107, index: 1, star: 27, threshold: 25 },
    { heroId: 107, index: 2, star: 27, threshold: 27 },
    { heroId: 122, index: 0, star: 22, threshold: 22 },
  ]);
});

test("兼容数组武将和Map觉醒状态", () => {
  const hero = {
    heroId: 101,
    star: 30,
    skill: new Map([
      [0, { active: true }],
      [1, { active: true }],
      [2, { active: true }],
      [3, { active: true }],
    ]),
    awakeSkill: new Map([[2, true]]),
  };

  assert.equal(isHeroAwakeSlot(hero, 2), true);
  assert.deepEqual(
    planHeroAwakenings({ role: { heroes: [hero] } }, [101]).map(
      ({ index }) => index,
    ),
    [0, 1, 3],
  );
});
