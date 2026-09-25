const XUANWU_EXCHANGE_ITEM_ID = 5285;
const XUANWU_COOKIE_UNIT_COST = 5;
const XUANWU_WHITE_JADE_UNIT_COST = 5;
const XUANWU_COOKIE_GOODS_SUFFIX = "302";
const XUANWU_WHITE_JADE_GOODS_SUFFIX = "303";

const getRole = (result) =>
  result?.role || result?.data?.role || result?.body?.role || {};

export const getXuanwuExchangeItemQuantity = (roleInfo, fallback = 0) => {
  const items = getRole(roleInfo)?.items || {};
  const item =
    items[XUANWU_EXCHANGE_ITEM_ID] || items[String(XUANWU_EXCHANGE_ITEM_ID)];
  if (item == null) return Math.max(0, Number(fallback) || 0);
  return Math.max(
    0,
    Number(item?.quantity ?? item?.count ?? item ?? 0) || 0,
  );
};

export const getXuanwuPetCookieExchangeQuantity = (roleInfo) => {
  const itemQuantity = getXuanwuExchangeItemQuantity(roleInfo);

  return {
    itemId: XUANWU_EXCHANGE_ITEM_ID,
    itemQuantity,
    unitCost: XUANWU_COOKIE_UNIT_COST,
    exchangeQuantity: Math.floor(itemQuantity / XUANWU_COOKIE_UNIT_COST),
  };
};

export const getXuanwuCookieAndJadeExchangePlan = (roleInfo) => {
  const itemQuantity = getXuanwuExchangeItemQuantity(roleInfo);
  const pairUnitCost =
    XUANWU_COOKIE_UNIT_COST + XUANWU_WHITE_JADE_UNIT_COST;
  const pairExchangeQuantity = Math.floor(itemQuantity / pairUnitCost);
  const remainderAfterPairs = itemQuantity % pairUnitCost;
  const extraCookieQuantity =
    remainderAfterPairs >= XUANWU_COOKIE_UNIT_COST ? 1 : 0;
  const cookieExchangeQuantity =
    pairExchangeQuantity + extraCookieQuantity;
  const whiteJadeExchangeQuantity = pairExchangeQuantity;

  return {
    itemId: XUANWU_EXCHANGE_ITEM_ID,
    itemQuantity,
    cookieUnitCost: XUANWU_COOKIE_UNIT_COST,
    whiteJadeUnitCost: XUANWU_WHITE_JADE_UNIT_COST,
    pairUnitCost,
    pairExchangeQuantity,
    extraCookieQuantity,
    cookieExchangeQuantity,
    whiteJadeExchangeQuantity,
    remainingItemQuantity:
      itemQuantity -
      pairExchangeQuantity * pairUnitCost -
      extraCookieQuantity * XUANWU_COOKIE_UNIT_COST,
  };
};

export const getXuanwuPetCookieExchangeIds = (activityBase) => ({
  activityId: Number(`${activityBase}3`),
  goodsId: Number(`${activityBase}${XUANWU_COOKIE_GOODS_SUFFIX}`),
});

export const getXuanwuCookieAndJadeExchangeIds = (activityBase) => ({
  activityId: Number(`${activityBase}3`),
  cookieGoodsId: Number(`${activityBase}${XUANWU_COOKIE_GOODS_SUFFIX}`),
  whiteJadeGoodsId: Number(
    `${activityBase}${XUANWU_WHITE_JADE_GOODS_SUFFIX}`,
  ),
});

export const XUANWU_EXCHANGE_CONFIG = Object.freeze({
  itemId: XUANWU_EXCHANGE_ITEM_ID,
  cookieUnitCost: XUANWU_COOKIE_UNIT_COST,
  whiteJadeUnitCost: XUANWU_WHITE_JADE_UNIT_COST,
});
