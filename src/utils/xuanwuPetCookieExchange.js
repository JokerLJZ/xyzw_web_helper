const XUANWU_EXCHANGE_ITEM_ID = 5285;
const XUANWU_COOKIE_UNIT_COST = 5;

const getRole = (result) =>
  result?.role || result?.data?.role || result?.body?.role || {};

export const getXuanwuPetCookieExchangeQuantity = (roleInfo) => {
  const items = getRole(roleInfo)?.items || {};
  const item =
    items[XUANWU_EXCHANGE_ITEM_ID] || items[String(XUANWU_EXCHANGE_ITEM_ID)];
  const itemQuantity = Math.max(
    0,
    Number(item?.quantity ?? item?.count ?? item ?? 0) || 0,
  );

  return {
    itemId: XUANWU_EXCHANGE_ITEM_ID,
    itemQuantity,
    unitCost: XUANWU_COOKIE_UNIT_COST,
    exchangeQuantity: Math.floor(itemQuantity / XUANWU_COOKIE_UNIT_COST),
  };
};

export const getXuanwuPetCookieExchangeIds = (activityBase) => ({
  activityId: Number(`${activityBase}3`),
  goodsId: Number(`${activityBase}302`),
});
