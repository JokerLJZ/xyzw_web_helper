import {
  getFishBaseId,
  getFishStar,
  isKnownFishId,
} from "./fishArtifactPlanner.js";

const REPLACEABLE_FISH_QUALITIES = [13, 14, 15, 16];
const RED_FISH_PRIORITY = new Map([
  [1304, 3],
  [1302, 2],
]);

const getRole = (roleInfo) =>
  roleInfo?.role || roleInfo?.data?.role || roleInfo?.body?.role || roleInfo || {};

const getHolderPriority = (holderHeroId, targetHeroId) => {
  if (holderHeroId === targetHeroId) return 0;
  if (holderHeroId === -1) return 1;
  return 2;
};

/**
 * 选择目标武将应装备的最优普通鱼灵。
 * 红鱼按赤羽、焰神、其他红鱼排序；没有红鱼时依次降到橙、紫、蓝。
 */
export function selectBestFishArtifact(roleInfo, targetHeroId) {
  const role = getRole(roleInfo);
  const candidates = [];

  for (const [itemKey, item] of Object.entries(role?.items || {})) {
    const itemId = Number(item?.itemId) || Number(itemKey) || 0;
    const fishId = getFishBaseId(itemId);
    const quality = Math.floor(fishId / 100);
    const quantity = Math.max(0, Number(item?.quantity ?? item?.count ?? item) || 0);
    if (
      quantity > 0 &&
      isKnownFishId(fishId) &&
      REPLACEABLE_FISH_QUALITIES.includes(quality) &&
      getFishStar(itemId) >= 1
    ) {
      candidates.push({ itemId, fishId, quality, star: getFishStar(itemId), holderHeroId: -1 });
    }
  }

  for (const [heroKey, hero] of Object.entries(role?.heroes || {})) {
    const itemId = Number(hero?.artifactId) || 0;
    const fishId = getFishBaseId(itemId);
    const quality = Math.floor(fishId / 100);
    if (
      isKnownFishId(fishId) &&
      REPLACEABLE_FISH_QUALITIES.includes(quality) &&
      getFishStar(itemId) >= 1
    ) {
      candidates.push({
        itemId,
        fishId,
        quality,
        star: getFishStar(itemId),
        holderHeroId: Number(hero?.heroId) || Number(heroKey) || 0,
      });
    }
  }

  candidates.sort((left, right) => {
    const qualityDiff =
      REPLACEABLE_FISH_QUALITIES.indexOf(left.quality) -
      REPLACEABLE_FISH_QUALITIES.indexOf(right.quality);
    if (qualityDiff !== 0) return qualityDiff;

    if (left.quality === 13) {
      const leftPriority = RED_FISH_PRIORITY.get(left.fishId) || 1;
      const rightPriority = RED_FISH_PRIORITY.get(right.fishId) || 1;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    }

    if (left.star !== right.star) return right.star - left.star;
    const holderDiff =
      getHolderPriority(left.holderHeroId, targetHeroId) -
      getHolderPriority(right.holderHeroId, targetHeroId);
    if (holderDiff !== 0) return holderDiff;
    return left.itemId - right.itemId;
  });

  return candidates[0] || null;
}
