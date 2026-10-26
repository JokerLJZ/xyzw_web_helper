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
            isActive: true,
            awakeSkill: {},
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
    { heroId: 107, index: 0, star: 27, threshold: 25 },
    { heroId: 107, index: 1, star: 27, threshold: 27 },
    { heroId: 122, index: -1, star: 22, threshold: 22 },
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
    [-1, 0, 1],
  );
});

// 当前官方客户端：主动觉醒状态为 isActive，被动觉醒状态为 awakeSkill[0..2]。
test("22星吕布第一技能使用-1，已觉醒主动技能不重复规划", () => {
  const hero = { heroId: 107, star: 22, awakeSkill: null };
  assert.deepEqual(planHeroAwakenings({ _raw: { body: { role: { heroes: { 107: hero } } } } }, [107]),
    [{ heroId: 107, index: -1, star: 22, threshold: 22 }]);
  hero.isActive = true;
  assert.deepEqual(planHeroAwakenings({ role: { heroes: { 107: hero } } }, [107]), []);
});

test("被动技能0的采集增量只标记第二技能，四技能编号为-1到2", () => {
  const hero = { heroId: 107, star: 30, awakeSkill: { 0: true } };
  assert.equal(isHeroAwakeSlot(hero, -1), false);
  assert.equal(isHeroAwakeSlot(hero, 0), true);
  assert.deepEqual(planHeroAwakenings({ role: { heroes: { 107: hero } } }, [107]).map(x => x.index), [-1, 1, 2]);
});

test("主动状态独立于被动集合，不能以awakeSkill[-1]替代isActive", () => {
  assert.equal(isHeroAwakeSlot({ isActive: true }, -1), true);
  assert.equal(isHeroAwakeSlot({ isActive: false, awakeSkill: { "-1": true } }, -1), false);
  assert.deepEqual(planHeroAwakenings({ heroes: { 107: { star: 22, isActive: true } } }, [107]), []);
});
