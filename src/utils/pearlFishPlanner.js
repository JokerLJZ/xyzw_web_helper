import { getFishBaseId, getFishStar } from "./fishArtifactPlanner.js";

export const PEARL_FISH_GOODS = {
  redFeather: { name: "赤羽", fishId: 1304, goodsId: 8304, itemId: 13041, price: 60, heroId: 107, heroName: "吕布", maxStar: 4 },
  bagua: { name: "八卦鱼", fishId: 1206, goodsId: 8206, itemId: 12061, price: 75, heroId: 104, heroName: "诸葛亮", maxStar: 5 },
};

export function highestOwnedFish(role, goods) {
  const candidates = [];
  for (const [key, item] of Object.entries(role?.items ?? {})) {
    const itemId = Number(item?.itemId ?? key);
    if (getFishBaseId(itemId) === goods.fishId && item?.quantity > 0) {
      candidates.push({ itemId, star: getFishStar(itemId), holderHeroId: -1 });
    }
  }
  for (const [key, hero] of Object.entries(role?.heroes ?? {})) {
    const itemId = Number(hero?.artifactId);
    if (getFishBaseId(itemId) === goods.fishId) {
      candidates.push({ itemId, star: getFishStar(itemId), holderHeroId: Number(hero.heroId ?? key) });
    }
  }
  return candidates.filter(f => f.star >= 1 && f.star <= 5).sort((a, b) =>
    b.star - a.star ||
    (a.holderHeroId === goods.heroId ? 0 : a.holderHeroId === -1 ? 1 : 2) -
    (b.holderHeroId === goods.heroId ? 0 : b.holderHeroId === -1 ? 1 : 2),
  )[0] ?? null;
}

/** 赤羽每升一星消耗一条一星赤羽；库存一星本体不能同时作为材料。 */
export function redFeatherPurchaseNeed(role) {
  const goods = PEARL_FISH_GOODS.redFeather;
  const highest = highestOwnedFish(role, goods);
  if (highest?.star >= 4) return 0;
  const stock = Math.max(0, Number(role?.items?.[goods.itemId]?.quantity) || 0);
  if (!highest) return 4;
  const material = stock - (highest.star === 1 && highest.holderHeroId === -1 ? 1 : 0);
  return Math.max(0, 4 - highest.star - material);
}

export function planPearlFishPurchases(role) {
  const pearls = Number(role?.items?.[1013]?.quantity);
  if (!Number.isSafeInteger(pearls) || pearls < 0) throw new Error("无法确认珍珠余额");
  const redNeed = redFeatherPurchaseNeed(role);
  const redCount = Math.min(redNeed, Math.floor(pearls / 60));
  const baguaCount = redCount === redNeed ? Math.floor((pearls - redCount * 60) / 75) : 0;
  return { redNeed, redCount, baguaCount };
}
