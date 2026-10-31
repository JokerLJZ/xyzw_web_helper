import { activityBody, activityText, mapGet, mapEntries, queryActivityExchange, exchangeRechargeItems, loadPublicActivityConfig, rewardText } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";

/** 玩法配置关联同组、同期商店；不固定本期日期编码。 */
export function findPhotoActivity(config, now = Date.now()) {
  const rows = mapEntries(config.ActFestivalConf).map(([, row]) => row);
  const photo = rows.filter(row => Number(row.actType) === 36 && row.start * 1000 <= now && now < row.end * 1000)
    .sort((a, b) => b.start - a.start)[0];
  if (!photo) return null;
  const related = rows.filter(row => row.actGroup === photo.actGroup && row.start === photo.start && row.end === photo.end && row.name === photo.name);
  return { code: photo.id, name: activityText(config, photo.name), photo, missions: related.find(row => Number(row.actType) === 37), shops: related.filter(row => Number(row.actType) === 2).sort((a, b) => a.id - b.id) };
}

/** 公共商品清单：打开弹窗不连接账号、不查询库存。 */
export async function loadPhotoExchangeCatalog(fetcher = globalThis.fetch, now = Date.now()) {
  const config = await loadPublicActivityConfig(fetcher);
  const event = findPhotoActivity(config, now);
  if (!event?.shops.length) throw new Error("当前没有可识别的闲来入镜商店");
  const shops = event.shops.map(shop => ({
    eventName: event.name, activityId: shop.id, configVersion: config.version,
    itemName: rewardText(config, 3, shop.itemId),
    rows: mapEntries(config.ExchangeActConf).map(([, row]) => row)
      .filter(row => row.actId === shop.id).sort((a, b) => a.rank - b.rank)
      .map(row => ({ ...row, name: rewardText(config, row.resourceType, row.rewardId) })),
  }));
  return { ...shops[0], shops };
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

const DAY = 86400000;
const dayStart = time => Math.floor((time + 8 * 3600000) / DAY) * DAY - 8 * 3600000;
const number = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name}格式异常`);
  return value;
};
const object = (value, name) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}格式异常`);
  return value;
};
const defaultObject = (value, name) => object(value === undefined ? {} : value, name);

/** 仅对 activity_get 的完整查询补协议默认值，不将写响应当作完整快照。 */
export function photoState(response, event, pieces) {
  const activity = object(activityBody(response)?.activity, "活动快照");
  const photos = defaultObject(activity.photoActivityInfo, "照片记录");
  const entry = defaultObject(mapGet(photos, event.photo.id), "照片进度");
  const pieceId = entry.pieceId === undefined ? 0 : entry.pieceId;
  if (!Number.isSafeInteger(pieceId) || pieceId < -1) throw new Error("照片片段格式异常");
  const piece = pieceId === -1 ? null : pieceId === 0 ? pieces[0] : pieces.find(row => row.id === pieceId);
  if (pieceId !== -1 && !piece) throw new Error("照片片段与当前配置不匹配");
  const progress = number(entry.num === undefined ? 0 : entry.num, "照片进度");
  const warOrders = defaultObject(activity.warOrderActivityInfo, "胶卷任务记录");
  const tasks = defaultObject(mapGet(warOrders, event.missions?.id), "胶卷任务状态");
  return { piece, progress, tasks, finished: pieceId === -1 };
}

function taskIsCurrent(tasks, period, now) {
  if (period === 1) return dayStart(now) <= number(tasks.dailyTime ?? 0, "每日任务时间") * 1000;
  // 当前客户端名称为SEVEN_DAYS，但实际以sevenTime+4天判断跨周期。
  if (period === 11) return now < number(tasks.sevenTime ?? 0, "周期任务时间") * 1000 + 4 * DAY;
  return false;
}

export async function runPhotoStandard({ send, config, now = Date.now, log = () => {} }) {
  const event = findPhotoActivity(config, now());
  if (!event) return { status: "skipped", reason: "当前没有开放的闲来入镜活动" };
  const photos = mapEntries(config.PhotoConf).map(([, row]) => row).filter(row => row.actId === event.photo.id).sort((a, b) => a.rank - b.rank);
  const pieces = photos.flatMap(photo => mapEntries(config.PhotoPieceConf).map(([, row]) => row).filter(row => row.actId === event.photo.id && row.PhotoId === photo.id).sort((a, b) => a.pieceIndex - b.pieceIndex));
  if (!pieces.length || pieces.some(row => !Number.isSafeInteger(row.progressNeed) || row.progressNeed <= 0)) throw new Error("照片配置不完整");
  const active = () => { if (now() < event.photo.start * 1000 || now() >= event.photo.end * 1000) throw new Error("闲来入镜活动已切期"); };
  const query = async () => photoState(await send("activity_get", {}), event, pieces);
  const write = async (cmd, params) => {
    active();
    try { await send(cmd, params); }
    catch (error) {
      if (error.stopped) throw error;
      await query().catch(() => {});
      throw new Error(`操作结果待核实，已停止且不自动重试：${error.message}`);
    }
  };
  let claimedTasks = 0, usedFilm = 0, claimedRewards = 0;
  log(`闲来入镜，活动编码${event.code}`);
  if (event.missions) {
    await send("activity_warorderget", { actId: event.missions.id });
    const missions = mapEntries(config.BattlePassMissionConf).map(([, row]) => row).filter(row => row.actId === event.missions.id && [1, 11].includes(row.periodType)).sort((a, b) => a.rank - b.rank || a.completeValue - b.completeValue);
    let state = await query();
    for (const mission of missions) {
      active();
      if (!taskIsCurrent(state.tasks, mission.periodType, now())) continue;
      const complete = object(state.tasks.complete ?? {}, "任务进度"), claimed = object(state.tasks.taskClaimed ?? {}, "任务领取记录");
      if (mapGet(claimed, mission.id) || number(mapGet(complete, mission.id) ?? 0, "任务进度") < mission.completeValue) continue;
      await write("activity_warordertaskclaim", { actId: event.missions.id, missionId: mission.id });
      state = await query();
      if (!taskIsCurrent(state.tasks, mission.periodType, now()) || !mapGet(state.tasks.taskClaimed, mission.id)) throw new Error("胶卷任务领取未确认，停止操作");
      claimedTasks++;
    }
  }
  let state = await query();
  // 每个片段最多一次投入、一次领奖；配置规模给出硬上限，防止异常快照造成循环消耗。
  for (let step = 0; step <= pieces.length * 2; step++) {
    active();
    if (state.finished) break;
    const piece = state.piece;
    if (state.progress >= piece.progressNeed) {
      await write("activity_claimphotoreward", { activityId: event.photo.id, pieceId: piece.id });
      const after = await query();
      const next = pieces[pieces.findIndex(row => row.id === piece.id) + 1];
      if (next ? after.piece?.id !== next.id : !after.finished) throw new Error("照片奖励领取未确认，停止操作");
      claimedRewards++;
      state = after;
      continue;
    }
    const response = await send("role_getroleinfo", {});
    const role = extractRolePatch(response);
    object(role?.items, "胶卷库存");
    const stock = number(mapGet(role.items, event.photo.itemId)?.quantity ?? 0, "胶卷库存");
    const num = Math.min(stock, piece.progressNeed - state.progress);
    if (num <= 0) break;
    await write("activity_photo", { activityId: event.photo.id, num, pieceId: piece.id });
    const after = await query();
    if (after.piece?.id !== piece.id || after.progress !== state.progress + num) throw new Error("放入胶卷进度未确认，停止操作");
    usedFilm += num;
    state = after;
  }
  log(`领取${claimedTasks}项胶卷任务，放入${usedFilm}个胶卷，领取${claimedRewards}份照片奖励${state.finished ? "，照片已全部完成" : ""}`);
  return { status: "completed", claimedTasks, usedFilm, claimedRewards };
}
