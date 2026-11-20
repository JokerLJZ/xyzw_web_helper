export const SHOE_TOY_ID = 2;
export const SHOE_PASSIVE_SKILL_IDS = [5, 6, 7, 8];
export const TOY_WRENCH_ITEM_ID = 1026;
export const IRON_ITEM_ID = 1006;
export const SHOE_TOY_UNLOCK_COST = 500;
export const TOY_MAX_ACTIVE_LEVEL = 150;
export const TOY_MAX_PASSIVE_LEVEL = 50;

/** 返回玩具主动技能升到目标等级所需的扳手数量。 */
export function getToyActiveUpgradeCost(targetLevel) {
  const level = Number(targetLevel);
  if (!Number.isInteger(level) || level < 2 || level > TOY_MAX_ACTIVE_LEVEL) {
    return null;
  }
  if (level <= 10) return 20;
  if (level <= 20) return 50;
  if (level <= 30) return 100;
  if (level === 31) return 400;
  if (level <= 40) return 60;
  if (level <= 50) return 150;
  if (level <= 60) return 300;
  if (level === 61) return 1200;
  if (level <= 70) return 150;
  if (level <= 80) return 375;
  if (level <= 90) return 750;
  if (level === 91) return 3000;
  if (level <= 100) return 400;
  if (level <= 110) return 1000;
  if (level <= 120) return 2000;
  if (level === 121) return 8000;
  if (level <= 130) return 2000;
  if (level <= 140) return 4000;
  return 5000;
}

/** 根据现有扳手精确计算可执行的主动技能升级次数。 */
export function planToyActiveUpgrades(currentLevel, wrenchQuantity) {
  const startLevel = Math.max(
    1,
    Math.min(TOY_MAX_ACTIVE_LEVEL, Number(currentLevel) || 1),
  );
  let finalLevel = startLevel;
  let remaining = Math.max(0, Number(wrenchQuantity) || 0);
  let spent = 0;

  while (finalLevel < TOY_MAX_ACTIVE_LEVEL) {
    const cost = getToyActiveUpgradeCost(finalLevel + 1);
    if (cost === null || remaining < cost) break;
    remaining -= cost;
    spent += cost;
    finalLevel += 1;
  }

  return {
    upgradeCount: finalLevel - startLevel,
    spent,
    remaining,
    finalLevel,
  };
}

/** 返回第几个被动技能升到目标等级所需的精铁数量。 */
export function getToyPassiveUpgradeCost(skillIndex, targetLevel) {
  const index = Number(skillIndex);
  const level = Number(targetLevel);
  if (
    !Number.isInteger(index) ||
    index < 1 ||
    index > 4 ||
    !Number.isInteger(level) ||
    level < 2 ||
    level > TOY_MAX_PASSIVE_LEVEL
  ) {
    return null;
  }
  return Math.floor((level - 0.5) * (320 / 3) * 2 ** (index - 1));
}

/**
 * 只规划服务端已返回（即已经开放）的皮鞋被动技能，四个技能共用同一份精铁库存。
 */
export function planToyPassiveUpgrades(passiveSkills, ironQuantity) {
  const skills = passiveSkills || {};
  let remaining = Math.max(0, Number(ironQuantity) || 0);
  const plans = [];

  SHOE_PASSIVE_SKILL_IDS.forEach((skillId, position) => {
    const skill = skills[skillId] ?? skills[String(skillId)];
    if (!skill) return;

    const currentLevel = Math.max(
      1,
      Math.min(TOY_MAX_PASSIVE_LEVEL, Number(skill.level) || 1),
    );
    let finalLevel = currentLevel;
    let spent = 0;
    while (finalLevel < TOY_MAX_PASSIVE_LEVEL) {
      const cost = getToyPassiveUpgradeCost(position + 1, finalLevel + 1);
      if (cost === null || remaining < cost) break;
      remaining -= cost;
      spent += cost;
      finalLevel += 1;
    }
    plans.push({
      skillId,
      currentLevel,
      finalLevel,
      upgradeCount: finalLevel - currentLevel,
      spent,
    });
  });

  return {
    plans,
    remaining,
    spent: Math.max(0, Number(ironQuantity) || 0) - remaining,
  };
}
