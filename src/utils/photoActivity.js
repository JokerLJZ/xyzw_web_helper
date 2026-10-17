import { activityText, mapEntries, queryActivityExchange, exchangeRechargeItems } from "./rechargeActivity.js";

/** 玩法配置关联同组、同期商店；不固定本期日期编码。 */
export function findPhotoActivity(config, now = Date.now()) {
  const rows = mapEntries(config.ActFestivalConf).map(([, row]) => row);
  const photo = rows.filter(row => Number(row.actType) === 36 && row.start * 1000 <= now && now < row.end * 1000)
    .sort((a, b) => b.start - a.start)[0];
  if (!photo) return null;
  const related = rows.filter(row => row.actGroup === photo.actGroup && row.start === photo.start && row.end === photo.end && row.name === photo.name);
  return { code: photo.id, name: activityText(config, photo.name), photo, missions: related.find(row => Number(row.actType) === 37), shops: related.filter(row => Number(row.actType) === 2).sort((a, b) => a.id - b.id) };
}

export async function queryPhotoExchange(send, config, now = Date.now(), shopId) {
  const event = findPhotoActivity(config, now);
  if (!event?.shops.length) throw new Error("当前没有可识别的闲来入镜商店");
  if (shopId !== undefined) {
    const shop = event.shops.find(row => row.id === shopId);
    if (!shop) throw new Error("闲来入镜商店已切期，请重新查询");
    return queryActivityExchange(send, config, event, shop);
  }
  const shops = [];
  for (const shop of event.shops) shops.push(await queryActivityExchange(send, config, event, shop));
  return { ...shops[0], shops };
}

export async function exchangePhotoItems(context) {
  const activityId = context.selection[0]?.activityId;
  if (!Number.isSafeInteger(activityId) || context.selection.some(row => row.activityId !== activityId)) throw new Error("请选择同一商店的商品");
  if (!context.preview.shops.some(shop => shop.activityId === activityId)) throw new Error("商店未查询，请重新选择");
  return exchangeRechargeItems({ ...context, expectedActivityId: activityId, query: (send, config, now) => queryPhotoExchange(send, config, now, activityId) });
}
