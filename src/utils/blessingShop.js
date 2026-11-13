import { activityText, mapEntries, loadPublicActivityConfig, rewardText, queryActivityExchange, exchangeRechargeItems } from './rechargeActivity.js';

/** GACHA_2同组同期的兑换商店；Exchange_2仅抽奖结束后开放。 */
export function findBlessingShops(config, now = Date.now()) {
  const rows = mapEntries(config.ActFestivalConf).map(([, row]) => row);
  const roots = rows.filter(row => Number(row.actType) === 35 && row.start * 1000 <= now).sort((a,b) => b.start-a.start);
  for (const root of roots) {
    const shops = rows.filter(row => row.actGroup === root.actGroup && row.start === root.start
      && [2,34].includes(Number(row.actType)) && row.start * 1000 <= now && now < row.end * 1000
      && (Number(row.actType) !== 34 || now >= root.end * 1000)).sort((a,b) => a.id-b.id);
    if (shops.length) return { code: root.id, name: activityText(config, root.name), shops };
  }
  return null;
}

export async function loadBlessingShopCatalog(fetcher = globalThis.fetch, now = Date.now()) {
  const config = await loadPublicActivityConfig(fetcher);
  const event = findBlessingShops(config, now);
  if (!event) throw new Error('当前没有开放的赐福活动商店');
  const shops = event.shops.map(shop => ({ eventName: event.name, activityId: shop.id, configVersion: config.version,
    itemName: rewardText(config, 3, shop.itemId),
    rows: mapEntries(config.ExchangeActConf).map(([,row])=>row).filter(row=>row.actId===shop.id)
      .sort((a,b)=>a.rank-b.rank).map(row=>({...row,name:rewardText(config,row.resourceType,row.rewardId)})),
  }));
  return {...shops[0],shops};
}

export async function queryBlessingShop(send, config, now, activityId) {
  const event = findBlessingShops(config, now);
  const shop = event?.shops.find(row => row.id === activityId);
  if (!shop) throw new Error('赐福商店已结束、尚未开放或已切期，请重新打开商品清单');
  return queryActivityExchange(send, config, event, shop);
}

export async function exchangeBlessingItems(context) {
  const activityId = context.selection[0]?.activityId;
  if (!Number.isSafeInteger(activityId) || context.selection.some(row=>row.activityId!==activityId)) throw new Error('请选择同一商店的商品');
  if (!context.preview?.shops?.some(shop=>shop.activityId===activityId)) throw new Error('商店清单已变化，请重新打开');
  return exchangeRechargeItems({...context,expectedActivityId:activityId,
    query:(send,config,now)=>queryBlessingShop(send,config,now,activityId)});
}
