// API captures: api采集/黑市周/免费.txt、黑市周灵贝.txt。
// 活动商店按 goodsIndex 采购，每次请求 buyNum=1；响应为 syncrewardresp。
export const JIANGHU_BLACK_MARKET_GOODS = Array.from({ length: 10 }, (_, goodsIndex) => ({
  goodsIndex,
  label: ({ 0: "免费金砖", 4: "宝箱", 6: "金竿", 8: "灵贝" })[goodsIndex] || `商品 ${goodsIndex}（对应游戏商店顺序）`,
}));

export const DEFAULT_JIANGHU_BLACK_MARKET_PURCHASES = {
  0: 1, 1: 1, 2: 1, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 4,
};

export const normalizeJianghuBlackMarketPurchases = (purchases) => {
  const source = purchases && typeof purchases === "object" && !Array.isArray(purchases)
    ? purchases : DEFAULT_JIANGHU_BLACK_MARKET_PURCHASES;
  return Object.fromEntries(JIANGHU_BLACK_MARKET_GOODS.map(({ goodsIndex }) => {
    const count = Number(source[goodsIndex]);
    return [goodsIndex, Number.isFinite(count) ? Math.min(4, Math.max(0, Math.trunc(count))) : 0];
  }));
};

export const getJianghuBlackMarketPurchasePlan = (purchases) =>
  Object.entries(normalizeJianghuBlackMarketPurchases(purchases)).flatMap(([index, count]) =>
    Array(count).fill(Number(index)),
  );
