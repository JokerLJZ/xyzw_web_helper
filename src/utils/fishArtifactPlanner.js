export const FISH_MAX_STAR = 5;

const FISH_MERGE_COSTS = {
  12: 1, // 红色专属鱼灵
  13: 1, // 红色鱼灵
  14: 2, // 橙色鱼灵
  15: 5, // 紫色鱼灵
  16: 20, // 蓝色鱼灵
};

const getRole = (roleInfo) =>
  roleInfo?.role || roleInfo?.data?.role || roleInfo?.body?.role || roleInfo || {};

export const getFishBaseId = (itemId) => Math.floor((Number(itemId) || 0) / 10);
export const getFishStar = (itemId) => (Number(itemId) || 0) % 10;

export function getFishMergeCost(itemId) {
  const baseId = getFishBaseId(itemId);
  return FISH_MERGE_COSTS[Math.floor(baseId / 100)] || 0;
}

export function isUpgradeableFishItem(itemId) {
  const star = getFishStar(itemId);
  return getFishMergeCost(itemId) > 0 && star >= 1 && star < FISH_MAX_STAR;
}

/**
 * 一次角色查询后生成完整鱼灵合成计划。
 * 每轮始终选择当前可合成的最高星级。
 * 已装备鱼灵仅作为升级目标，不抵扣升级所需的库存材料。
 */
export function planFishArtifactUpgrades(roleInfo) {
  const role = getRole(roleInfo);
  const inventory = new Map();
  const equipped = new Map();

  const addInventory = (itemId, quantity = 1) => {
    const id = Number(itemId) || 0;
    if (!isUpgradeableFishItem(id) && getFishStar(id) !== FISH_MAX_STAR) return;
    inventory.set(id, (inventory.get(id) || 0) + Math.max(0, Number(quantity) || 0));
  };

  for (const [itemId, item] of Object.entries(role?.items || {})) {
    addInventory(itemId, item?.quantity);
  }

  for (const [heroKey, hero] of Object.entries(role?.heroes || {})) {
    const itemId = Number(hero?.artifactId) || 0;
    if (!itemId || getFishMergeCost(itemId) <= 0) continue;
    const heroId = Number(hero?.heroId) || Number(heroKey) || 0;
    if (!equipped.has(itemId)) equipped.set(itemId, []);
    equipped.get(itemId).push(heroId);
  }

  const operations = [];
  while (true) {
    const itemIds = new Set([...inventory.keys(), ...equipped.keys()]);
    const candidate = [...itemIds]
      .filter((itemId) => {
        const cost = getFishMergeCost(itemId);
        const inventoryCount = inventory.get(itemId) || 0;
        return isUpgradeableFishItem(itemId) && cost > 0 && inventoryCount >= cost;
      })
      .sort((left, right) => {
        const starDiff = getFishStar(right) - getFishStar(left);
        return starDiff || left - right;
      })[0];

    if (!candidate) break;
    const itemId = candidate;
    const cost = getFishMergeCost(itemId);
    const nextItemId = itemId + 1;
    const equippedHeroes = equipped.get(itemId) || [];
    const inventoryCount = inventory.get(itemId) || 0;
    const canUpgradeEquipped = equippedHeroes.length > 0;
    const heroId = canUpgradeEquipped ? equippedHeroes.shift() : -1;

    inventory.set(itemId, inventoryCount - cost);
    if (heroId > 0) {
      if (!equipped.has(nextItemId)) equipped.set(nextItemId, []);
      equipped.get(nextItemId).push(heroId);
    } else {
      inventory.set(nextItemId, (inventory.get(nextItemId) || 0) + 1);
    }

    operations.push({
      fishId: getFishBaseId(itemId),
      itemId,
      nextItemId,
      star: getFishStar(itemId),
      heroId,
      cost,
    });
  }

  return operations;
}

export function planFishBookUpgrades(roleInfo) {
  const role = getRole(roleInfo);
  return Object.entries(role?.artifactBooks || {})
    .map(([fishKey, book]) => {
      const fishId = Number(fishKey) || getFishBaseId(book?.artifactId);
      const artifactId = Number(book?.artifactId) || 0;
      const actualStar = getFishStar(artifactId);
      const claimedStar = Math.max(0, Number(book?.claimedStar) || 0);
      return {
        fishId,
        actualStar,
        claimedStar,
        upgradeCount: Math.max(0, actualStar - claimedStar),
      };
    })
    .filter(({ fishId, upgradeCount }) =>
      Math.floor(fishId / 100) !== 11 && upgradeCount > 0,
    );
}
