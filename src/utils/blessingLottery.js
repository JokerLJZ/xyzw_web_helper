import { mapGet } from './rechargeActivity.js';
export function getBlessingLotteryItemId(config, actId) {
  const activity = mapGet(config.ActFestivalConf, actId);
  if (!activity || Number(activity.actType) !== 35 || !Number.isSafeInteger(activity.itemId) || activity.itemId <= 0) throw new Error('未取得当前赐福抽奖道具配置');
  return activity.itemId;
}
export function getBlessingDrawTimes(role, itemId, remaining) {
  if (!role?.items) throw new Error('未取得当前账号道具库存');
  const item = mapGet(role.items, itemId);
  const stock = Number(item?.quantity ?? item?.count ?? item ?? 0);
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('活动道具库存异常');
  if (remaining <= 0 || stock === 0) return 0;
  return stock >= 10 && remaining >= 10 ? 10 : 1;
}
