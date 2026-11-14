const XUANWU_EXCHANGE_ITEM_ID = 5285;
const XUANWU_COOKIE_UNIT_COST = 5;
const XUANWU_COOKIE_GOODS_SUFFIX = "302";

const getRole = (result) =>
  result?.role || result?.data?.role || result?.body?.role || {};

const getXuanwuExchangeItemQuantity = (roleInfo) => {
  const items = getRole(roleInfo)?.items || {};
  const item =
    items[XUANWU_EXCHANGE_ITEM_ID] || items[String(XUANWU_EXCHANGE_ITEM_ID)];
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

export const getXuanwuPetCookieExchangeIds = (activityBase) => ({
  activityId: Number(`${activityBase}3`),
  goodsId: Number(`${activityBase}${XUANWU_COOKIE_GOODS_SUFFIX}`),
});
