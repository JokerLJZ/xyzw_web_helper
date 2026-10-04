// API captures: api采集/黑市周/免费.txt、黑市周灵贝.txt。
// 活动商店按 goodsIndex 采购，每次请求 buyNum=1；响应为 syncrewardresp。
// 显示序号采用用户提供的清单；商品5起与API索引相差1，采购仍使用API索引。
export const JIANGHU_BLACK_MARKET_GOODS = [
  { goodsIndex: 0, displayIndex: 0, label: "免费金砖" },
  { goodsIndex: 1, displayIndex: 1, label: "5招募、1000精铁" },
  { goodsIndex: 2, displayIndex: 2, label: "10招募、2000进阶石" },
  { goodsIndex: 3, displayIndex: 3, label: "6000进阶石" },
  { goodsIndex: 4, displayIndex: 5, label: "宝箱" },
  { goodsIndex: 5, displayIndex: 6, label: "50招募" },
  { goodsIndex: 6, displayIndex: 7, label: "30金鱼竿" },
  { goodsIndex: 7, displayIndex: 8, label: "2000白玉" },
  { goodsIndex: 8, displayIndex: 9, label: "10灵贝" },
  { goodsIndex: 9, displayIndex: 10, label: "2000扳手晶石" },
];

// 默认显示序号：0、1、2、5、6、7、8，每项采购一次。
export const DEFAULT_JIANGHU_BLACK_MARKET_PURCHASES = {
  0: 1, 1: 1, 2: 1, 3: 0, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 0,
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
