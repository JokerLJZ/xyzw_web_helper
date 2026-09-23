export const FISH_MAX_STAR = 5;

const FISH_MERGE_COSTS = {
  12: 1,
  13: 1,
  14: 2,
  15: 5,
  16: 20,
};

const FISH_ID_RANGES = {
  12: [1201, 1220],
  13: [1301, 1305],
  14: [1401, 1412],
  15: [1501, 1506],
  16: [1601, 1604],
};

const getRole = (roleInfo) =>
  roleInfo?.role || roleInfo?.data?.role || roleInfo?.body?.role || roleInfo || {};

export const getFishBaseId = (itemId) => Math.floor((Number(itemId) || 0) / 10);
export const getFishStar = (itemId) => (Number(itemId) || 0) % 10;

export function isKnownFishId(fishId) {
  const id = Number(fishId) || 0;
  const quality = Math.floor(id / 100);
  const range = FISH_ID_RANGES[quality];
  return Boolean(range && id >= range[0] && id <= range[1]);
}

export function getFishMergeCost(itemId) {
  const baseId = getFishBaseId(itemId);
  if (!isKnownFishId(baseId)) return 0;
  return FISH_MERGE_COSTS[Math.floor(baseId / 100)] || 0;
}

export function isUpgradeableFishItem(itemId) {
  const star = getFishStar(itemId);
  return getFishMergeCost(itemId) > 0 && star >= 1 && star < FISH_MAX_STAR;
}

/**
 * 根据一次角色查询生成“当前真实存在”的鱼灵升级计划。
 *
 * itemId 表示待升级鱼灵的当前星级；每次升级实际消耗的材料始终是
 * 同种鱼灵的 1 星道具（fishId * 10 + 1）。先升级已装备的鱼灵，再按
 * 星级从高到低处理未装备鱼灵，并在本地连续推算到材料不足或达到五星。
 */
export function planFishArtifactUpgrades(roleInfo) {
  const role = getRole(roleInfo);
  const inventory = new Map();
  const targets = [];

  for (const [itemKey, item] of Object.entries(role?.items || {})) {
    const itemId = Number(item?.itemId) || Number(itemKey) || 0;
    if (!isUpgradeableFishItem(itemId) && getFishStar(itemId) !== FISH_MAX_STAR) {
      continue;
    }
    const quantity = Math.max(0, Number(item?.quantity) || 0);
    if (quantity > 0) inventory.set(itemId, quantity);
  }

  for (const [heroKey, hero] of Object.entries(role?.heroes || {})) {
    const itemId = Number(hero?.artifactId) || 0;
    if (!isUpgradeableFishItem(itemId)) continue;
    targets.push({
      itemId,
      heroId: Number(hero?.heroId) || Number(heroKey) || 0,
      source: "equipped",
    });
  }

  for (const [itemId, quantity] of inventory) {
    if (!isUpgradeableFishItem(itemId) || getFishStar(itemId) === 1) continue;
    for (let index = 0; index < quantity; index += 1) {
      targets.push({ itemId, heroId: -1, source: "inventory" });
    }
  }

  const operations = [];
  while (true) {
    const candidates = targets
      .filter((target) => {
        const fishId = getFishBaseId(target.itemId);
        const materialItemId = fishId * 10 + 1;
        return (
          isUpgradeableFishItem(target.itemId) &&
          (inventory.get(materialItemId) || 0) >= getFishMergeCost(target.itemId)
        );
      })
      .sort((left, right) => {
        if (left.source !== right.source) {
          return left.source === "equipped" ? -1 : 1;
        }
        const starDiff = getFishStar(right.itemId) - getFishStar(left.itemId);
        return starDiff || left.itemId - right.itemId;
      });

    for (const [itemId, quantity] of inventory) {
      if (getFishStar(itemId) !== 1 || !isUpgradeableFishItem(itemId)) continue;
      const cost = getFishMergeCost(itemId);
      if (quantity >= cost + 1) {
        candidates.push({ itemId, heroId: -1, source: "new-inventory" });
      }
    }

    candidates.sort((left, right) => {
      const leftEquipped = left.source === "equipped";
      const rightEquipped = right.source === "equipped";
      if (leftEquipped !== rightEquipped) return leftEquipped ? -1 : 1;
      const starDiff = getFishStar(right.itemId) - getFishStar(left.itemId);
      return starDiff || left.itemId - right.itemId;
    });

    const target = candidates[0];
    if (!target) break;

    const fishId = getFishBaseId(target.itemId);
    const materialItemId = fishId * 10 + 1;
    const cost = getFishMergeCost(target.itemId);
    const currentStar = getFishStar(target.itemId);
    const isNewInventoryTarget = target.source === "new-inventory";

    inventory.set(
      materialItemId,
      (inventory.get(materialItemId) || 0) - cost - (isNewInventoryTarget ? 1 : 0),
    );
    if (isNewInventoryTarget) {
      target.source = "inventory";
      targets.push(target);
    }

    operations.push({
      fishId,
      itemId: target.itemId,
      nextItemId: target.itemId + 1,
      materialItemId,
      star: currentStar,
      heroId: target.heroId,
      cost,
    });
    target.itemId += 1;
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
      const upgradeCount = Math.max(0, actualStar - claimedStar);
      return {
        fishId,
        actualStar,
        claimedStar,
        upgradeCount,
      };
    })
    .filter(({ fishId, upgradeCount }) =>
      isKnownFishId(fishId) && upgradeCount > 0,
    );
}
