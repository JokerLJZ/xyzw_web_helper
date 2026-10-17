export const BLACK_MARKET_MODES = Object.freeze({
  LEGACY: "legacy",
  DISCOUNT: "discount",
});

export const BLACK_MARKET_ITEMS = Object.freeze([
  { goodsId: 1, itemId: 2002, name: "青铜宝箱", defaultDiscount: 5 },
  { goodsId: 2, itemId: 2003, name: "黄金宝箱", defaultDiscount: 6 },
  { goodsId: 3, itemId: 2004, name: "铂金宝箱", defaultDiscount: 8 },
  { goodsId: 6, itemId: 1001, name: "招募令", defaultDiscount: 8 },
  { goodsId: 11, itemId: 1011, name: "普通鱼竿", defaultDiscount: 7 },
  { goodsId: 12, itemId: 1012, name: "黄金鱼竿", defaultDiscount: 7 },
  { goodsId: 14, itemId: 1022, name: "白玉", defaultDiscount: 7 },
  { goodsId: 15, itemId: 1023, name: "彩玉", defaultDiscount: 7 },
  { goodsId: 16, itemId: 1026, name: "扳手", defaultDiscount: 7 },
]);

export const DEFAULT_BLACK_MARKET_DISCOUNTS = Object.freeze(
  Object.fromEntries(
    BLACK_MARKET_ITEMS.map(({ itemId, defaultDiscount }) => [
      itemId,
      defaultDiscount,
    ]),
  ),
);

export const DEFAULT_BLACK_MARKET_REFRESH_COUNT = 1;

const normalizeDiscount = (value, fallback) => {
  const discount = Number(value);
  if (!Number.isFinite(discount)) return fallback;
  return Math.min(10, Math.max(1, Math.trunc(discount)));
};

const normalizeRefreshCount = (value) => {
  const count = Number(value);
  if (!Number.isFinite(count)) return DEFAULT_BLACK_MARKET_REFRESH_COUNT;
  return Math.min(10, Math.max(0, Math.trunc(count)));
};

export const normalizeBlackMarketSettings = (settings = {}) => ({
  blackMarketPurchaseMode:
    settings.blackMarketPurchaseMode === BLACK_MARKET_MODES.DISCOUNT
      ? BLACK_MARKET_MODES.DISCOUNT
      : BLACK_MARKET_MODES.LEGACY,
  blackMarketDiscounts: Object.fromEntries(
    BLACK_MARKET_ITEMS.map(({ itemId, defaultDiscount }) => [
      itemId,
      normalizeDiscount(
        settings.blackMarketDiscounts?.[itemId] ??
          settings.blackMarketDiscounts?.[String(itemId)],
        defaultDiscount,
      ),
    ]),
  ),
  blackMarketRefreshCount: normalizeRefreshCount(
    settings.blackMarketRefreshCount,
  ),
});

export const loadBlackMarketSettings = (storage = globalThis.localStorage) => {
  if (!storage?.getItem) return normalizeBlackMarketSettings();

  try {
    const raw = storage.getItem("batchSettings");
    return normalizeBlackMarketSettings(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeBlackMarketSettings();
  }
};

const normalizeActualDiscount = (value) => {
  const discount = Number(value);
  if (!Number.isFinite(discount)) return null;
  return discount <= 1 ? Math.round(discount * 10) : Math.round(discount);
};

export const selectDiscountPurchases = (goodsList, settings) => {
  const normalized = normalizeBlackMarketSettings(settings);
  const currentGoods = goodsList?.goodsList || goodsList || {};

  return BLACK_MARKET_ITEMS.flatMap((item) => {
    const goods = currentGoods[item.goodsId] || currentGoods[String(item.goodsId)];
    if (!goods || Number(goods.buy_quantity ?? goods.buyQuantity ?? 0) > 0) {
      return [];
    }

    const actualDiscount = normalizeActualDiscount(goods.discount);
    const threshold = normalized.blackMarketDiscounts[item.itemId];
    if (actualDiscount === null || actualDiscount > threshold) return [];

    return [{ ...item, actualDiscount, threshold }];
  });
};

/**
 * 执行黑市采购。旧模式只调用原有自动采购；折扣模式读取当前商品后逐个直购，
 * 不读取或修改游戏内采购清单。阈值包含边界：实际折扣小于或等于阈值时购买。
 */
export const runBlackMarketPurchase = async ({ send, settings }) => {
  if (typeof send !== "function") throw new Error("缺少黑市请求函数");

  const normalized = normalizeBlackMarketSettings(settings);
  if (normalized.blackMarketPurchaseMode === BLACK_MARKET_MODES.LEGACY) {
    const result = await send("store_purchase", {});
    return { mode: BLACK_MARKET_MODES.LEGACY, purchases: [], result };
  }

  const purchases = [];
  const purchaseResults = [];
  let lastResult = {};

  const purchaseCurrentRound = async () => {
    const goodsListResult =
      (await send("store_goodslist", { storeId: 1 })) || {};
    lastResult = goodsListResult;
    const roundPurchases = selectDiscountPurchases(goodsListResult, normalized);
    purchases.push(...roundPurchases);
    for (const item of roundPurchases) {
      lastResult = await send("store_buy", { goodsId: item.goodsId });
      purchaseResults.push(lastResult);
    }
  };

  await purchaseCurrentRound();
  for (let index = 0; index < normalized.blackMarketRefreshCount; index++) {
    lastResult = await send("store_refresh", { storeId: 1 });
    await purchaseCurrentRound();
  }

  return {
    mode: BLACK_MARKET_MODES.DISCOUNT,
    purchases,
    refreshCount: normalized.blackMarketRefreshCount,
    result: purchaseResults.at(-1) || lastResult,
  };
};
