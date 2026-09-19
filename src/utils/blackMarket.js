export const BLACK_MARKET_MODES = Object.freeze({
  LEGACY: "legacy",
  DISCOUNT: "discount",
});

export const BLACK_MARKET_ITEMS = Object.freeze([
  { itemId: 2002, name: "青铜宝箱", defaultDiscount: 5 },
  { itemId: 2003, name: "黄金宝箱", defaultDiscount: 6 },
  { itemId: 2004, name: "铂金宝箱", defaultDiscount: 8 },
  { itemId: 1001, name: "招募令", defaultDiscount: 8 },
  { itemId: 1011, name: "普通鱼竿", defaultDiscount: 7 },
  { itemId: 1012, name: "黄金鱼竿", defaultDiscount: 7 },
  { itemId: 1022, name: "白玉", defaultDiscount: 7 },
  { itemId: 1023, name: "彩玉", defaultDiscount: 7 },
  { itemId: 1026, name: "扳手", defaultDiscount: 7 },
]);

export const DEFAULT_BLACK_MARKET_DISCOUNTS = Object.freeze(
  Object.fromEntries(
    BLACK_MARKET_ITEMS.map(({ itemId, defaultDiscount }) => [
      itemId,
      defaultDiscount,
    ]),
  ),
);

const normalizeDiscount = (value, fallback) => {
  const discount = Number(value);
  if (!Number.isFinite(discount)) return fallback;
  return Math.min(10, Math.max(1, Math.trunc(discount)));
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

export const buildBlackMarketPurchaseRule = (settings, currentRule = {}) => {
  const normalized = normalizeBlackMarketSettings(settings);
  const currentPurchaseCount = Number(currentRule?.purchaseCnt);

  return {
    // purchaseCnt 的含义及可选范围由游戏端维护；只更新折扣清单时保留账号原值。
    purchaseCnt: Number.isFinite(currentPurchaseCount)
      ? currentPurchaseCount
      : 2,
    purchaseItemList: BLACK_MARKET_ITEMS.map(({ itemId }) => ({
      itemId,
      discount: normalized.blackMarketDiscounts[itemId],
    })),
  };
};

const normalizeRuleItems = (items = []) =>
  [...items]
    .map((item) => ({
      itemId: Number(item?.itemId),
      discount: Number(item?.discount),
    }))
    .filter(
      (item) => Number.isFinite(item.itemId) && Number.isFinite(item.discount),
    )
    .sort((a, b) => a.itemId - b.itemId);

export const isSameBlackMarketRule = (currentRule, expectedRule) =>
  Number(currentRule?.purchaseCnt) === Number(expectedRule?.purchaseCnt) &&
  JSON.stringify(normalizeRuleItems(currentRule?.purchaseItemList)) ===
    JSON.stringify(normalizeRuleItems(expectedRule?.purchaseItemList));

/**
 * 执行黑市采购。折扣模式由游戏服务端按 itemId + discount 判断当前商品，
 * 因此阈值包含边界：实际折扣小于或等于阈值时购买。
 */
export const runBlackMarketPurchase = async ({ send, settings }) => {
  if (typeof send !== "function") throw new Error("缺少黑市请求函数");

  const normalized = normalizeBlackMarketSettings(settings);
  if (normalized.blackMarketPurchaseMode === BLACK_MARKET_MODES.LEGACY) {
    const result = await send("store_purchase", {});
    return { mode: BLACK_MARKET_MODES.LEGACY, ruleUpdated: false, result };
  }

  const currentRule = (await send("store_getpurchase", {})) || {};
  const expectedRule = buildBlackMarketPurchaseRule(normalized, currentRule);
  const ruleUpdated = !isSameBlackMarketRule(currentRule, expectedRule);

  if (ruleUpdated) {
    await send("store_setpurchase", expectedRule);
  }

  const result = await send("store_purchase", {});
  return {
    mode: BLACK_MARKET_MODES.DISCOUNT,
    ruleUpdated,
    rule: expectedRule,
    result,
  };
};
