export const HERO_AWAKENING_STAR_THRESHOLDS = [22, 25, 27, 30];

const getRole = (roleInfo) =>
  roleInfo?.role || roleInfo?.data?.role || roleInfo?.body?.role || roleInfo || {};

export const getHeroFromAwakeningRole = (roleInfo, heroId) => {
  const heroes = getRole(roleInfo)?.heroes;
  if (!heroes) return null;
  if (Array.isArray(heroes)) {
    return heroes.find((hero) => Number(hero?.heroId) === Number(heroId)) || null;
  }
  return heroes[heroId] || heroes[String(heroId)] || null;
};

const getSlotValue = (collection, index) => {
  if (!collection) return undefined;
  if (collection instanceof Map) {
    return collection.get(index) ?? collection.get(String(index));
  }
  return collection[index] ?? collection[String(index)];
};

export const isHeroAwakeSlot = (hero, index) =>
  getSlotValue(hero?.awakeSkill, index) === true;

/**
 * 根据一次角色查询生成技能觉醒计划。所有红将均开放觉醒，只有已拥有、
 * 星级达标且尚未觉醒的槽位才会进入计划，执行阶段无需再反复查询状态。
 */
export function planHeroAwakenings(roleInfo, selectedHeroIds) {
  const uniqueHeroIds = [...new Set((selectedHeroIds || []).map(Number))].filter(
    (heroId) => Number.isSafeInteger(heroId) && heroId >= 101 && heroId < 200,
  );

  return uniqueHeroIds.flatMap((heroId) => {
    const hero = getHeroFromAwakeningRole(roleInfo, heroId);
    if (!hero) return [];
    const star = Math.max(0, Number(hero.star) || 0);

    return HERO_AWAKENING_STAR_THRESHOLDS.flatMap((threshold, index) => {
      if (star < threshold) return [];
      if (isHeroAwakeSlot(hero, index)) return [];
      return [{ heroId, index, star, threshold }];
    });
  });
}
