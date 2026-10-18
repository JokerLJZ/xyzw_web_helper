import { mapGet, mapEntries } from "./rechargeActivity.js";

/** Follow ItemData.isInPackTime and the warehouse's non-choice pack button. */
export function classifyWarehouseActivityItem({ itemId, config, role = {}, now = Date.now() }) {
  const item = mapGet(config?.ItemConf, itemId);
  if (!item) return { status: "skipped", reason: "缺少当前道具配置，无法确认使用方式" };
  const activities = mapEntries(config.ActFestivalConf).map(([, value]) => value)
    .filter(activity => Number(activity.itemId) === Number(itemId));
  const seconds = now / 1000;
  if (!Number.isFinite(seconds)) return { status: "skipped", reason: "当前时间无法确认" };
  // Protect active and preview events, including multiple events sharing a currency.
  if (activities.some(activity => {
    const start = role.isWhiteRole && Number(activity.whiteListStart) > 0
      ? Number(activity.whiteListStart) : Number(activity.start);
    return Number.isFinite(start) && start <= seconds && Number(activity.end) > seconds;
  })) return { status: "skipped", reason: "当期活动道具，保留用于活动" };

  const lookBack = activities.some(activity => Number(activity.lookBackDay) > 0);
  if (lookBack) {
    const serverId = Number(role.serverViewId) || parseInt(role.serverName, 10);
    const servers = config.BigServerConf || config.bigServerConf;
    const server = mapGet(servers, serverId);
    // A server's replay schedule depends on role creation day and module state.
    // Do not apply the old global event dates to a potentially active replay.
    if (!server || (Number(server.isLookBack) > 0 && Number(server.endTime) >= seconds))
      return { status: "skipped", reason: "活动回顾期次尚未确认，保留道具" };
  }
  if (Number(item.type) === 2) {
    const convertAt = Number(item.changePackTime);
    if (!(convertAt > 0)) return { status: "skipped", reason: "客户端未配置过期转礼包时间" };
    if (!(seconds > convertAt)) return { status: "skipped", reason: "尚未到客户端配置的转礼包时间" };
  } else if (Number(item.type) !== 5) {
    return { status: "skipped", reason: "客户端未将此道具识别为可开礼包" };
  }
  const params = item.params;
  if (!Array.isArray(params) || ![0, 1, 3].includes(params[0]) || !mapGet(config.PackConf, params[1]))
    return { status: "skipped", reason: "没有直接开包配置或需要手动选择奖励" };
  return { status: "ready", command: "item_openpack", index: 0 };
}
