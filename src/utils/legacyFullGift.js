import { activityBody, mapEntries, mapGet } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";

const rows = table => mapEntries(table).map(([, row]) => row);
const integer = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`功法${label}无效`);
  return value;
};
const record = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`未取得功法${label}`);
  return value;
};

export async function runLegacyFullGift({ send, config, now, recipientId, password, log = () => {} }) {
  integer(recipientId, "接收者ID", 1);
  if (!password) throw new Error("请在全局配置填写安全密码");
  const itemId = integer(config.LegacyConstant?.createLegacyConsume?.itemId, "残卷道具配置", 1);
  const batchLimit = integer(config.LegacyConstant?.giftDustMaxAmountOnce, "单次赠送上限", 1);
  const tasks = rows(config.LegacyGiftTaskConf).filter(row => row.legacyRefreshType === 3);
  const seasons = rows(config.LegacyScheduleConf);
  const privileges = rows(config.LegacyChargeReward);
  if (!tasks.length || !seasons.length || !privileges.length) throw new Error("功法赠送配置缺失");

  const readRole = async () => extractRolePatch(await send("role_getroleinfo", {}));
  const readLegacy = async () => activityBody(await send("legacy_getinfo", {}))?.roleLegacy;
  const role = await readRole();
  const roleId = integer(role?.roleId, "角色ID", 1);
  if (roleId === recipientId) return { status: "skipped", reason: "接收者是当前账号，已跳过" };
  const vip = integer(role.vip, "VIP等级");
  const vipConfig = rows(config.LegacyGiftConf).find(row => row.vipLevel === vip);
  const baseLimit = integer(vipConfig?.giftDustMax, "VIP赠送上限");

  let legacy = await readLegacy();
  const scheduleId = integer(legacy?.scheduleId, "赛季ID");
  const time = now();
  if (!Number.isFinite(time) || time <= 0) throw new Error("未取得有效服务器时间");
  const seasonStart = row => (role.isWhiteRole ? row.legacyWhiteListStart : row.legacyStart) * 1000;
  const season = seasons.find(row => seasonStart(row) < time && time < row.legacyEnd * 1000);
  if (!season || scheduleId !== season.id) {
    return { status: "skipped", reason: "当前功法赛季未开放或正在跨季，已跳过" };
  }
  const refreshLegacy = async () => {
    const state = await readLegacy();
    if (state?.scheduleId !== scheduleId || now() >= season.legacyEnd * 1000) {
      throw new Error("功法赛季已变更，结束本轮");
    }
    return state;
  };
  const chargeTime = integer(mapGet(record(role.statisticsTime, "充值统计时间"), "legacy:charge") ?? 0, "充值时间") * 1000;
  const charge = chargeTime >= seasonStart(season) && chargeTime < season.legacyEnd * 1000
    ? integer(mapGet(record(role.statistics, "充值统计"), "legacy:charge") ?? 0, "赛季充值额")
    : 0;
  const tier = privileges.filter(row => row.vipSpend <= charge).sort((a, b) => b.vipSpend - a.vipSpend)[0];
  const unlimited = integer(tier?.giftIfUnlock, "赠送特权配置") === 1;
  const claims = () => record(legacy.giftTaskClaim, "赠送任务领取记录");
  const claimed = id => integer(mapGet(claims(), id) ?? 0, "赠送任务领取次数") > 0;
  const seenTaskTypes = new Set();
  for (const task of tasks) {
    const id = integer(task.Id, "赠送任务ID", 1);
    if (claimed(id)) continue;
    const type = integer(task.legacyTaskType, "赠送任务类型");
    if (seenTaskTypes.has(type)) continue;
    seenTaskTypes.add(type);
    const progress = integer(mapGet(record(legacy.giftTask, "赠送任务进度"), id) ?? 0, "任务进度");
    if (progress < integer(task.taskShow, "赠送任务目标", 1)) continue;
    if (!integer(mapGet(task.giftDreamDustReward, vip), "任务赠送额度")) continue;
    await send("legacy_claimgifttask", { id });
    legacy = await refreshLegacy();
    if (!claimed(id)) throw new Error(`任务 ${id} 的赠送额度领取未确认`);
    seenTaskTypes.delete(type);
    log(`已领取赛季赠送任务 ${id} 的额度`);
  }

  const stockOf = snapshot => {
    if (snapshot?.roleId !== roleId) throw new Error("赠送前后角色身份不一致");
    const item = mapGet(record(snapshot.items, "残卷库存"), itemId);
    return integer(item === undefined ? 0 : item?.quantity, "残卷库存");
  };
  const remainingLimit = () => {
    if (unlimited) return Number.MAX_SAFE_INTEGER;
    const bonus = tasks.reduce((total, task) => total + (claimed(task.Id)
      ? integer(mapGet(task.giftDreamDustReward, vip), "任务赠送额度")
      : 0), 0);
    return Math.max(0, baseLimit + bonus - integer(legacy.sendItemCnt, "本赛季已赠数量"));
  };

  let stock = stockOf(await readRole());
  const budget = Math.min(stock, remainingLimit());
  if (!budget) return { status: "skipped", reason: "残卷库存或剩余赠送额度为零，已跳过" };

  const target = activityBody(await send("rank_getroleinfo", {
    bottleType: 0, includeBottleTeam: false, isSearch: false, roleId: recipientId,
  }))?.roleInfo;
  if (target?.roleId !== recipientId) throw new Error("无法确认全局配置的接收者ID");
  const passwordRole = extractRolePatch(await send("role_commitpassword", { password, passwordType: 1 }));
  if (!mapGet(passwordRole?.statistics, "que:wh:tm")) throw new Error("安全密码验证未确认");

  let sent = 0;
  while (sent < budget) {
    const quantity = Math.min(stock, remainingLimit(), budget - sent, batchLimit);
    if (!quantity) break;
    if (now() >= season.legacyEnd * 1000) throw new Error("功法赛季已结束");
    try {
      await send("legacy_sendgift", { targetId: recipientId, itemCnt: quantity, legacyUIds: [] });
    } catch (error) {
      if (error.stopped || error.serverRejected) throw error;
      const after = await readRole().then(stockOf).catch(() => null);
      const detail = after === null ? "库存补查未完成" : `补查后库存 ${after} 个`;
      throw new Error(`赠送请求异常，${detail}，本轮已停止：${error.message}`);
    }
    const after = stockOf(await readRole());
    if (after !== stock - quantity) throw new Error("赠送后残卷扣除数量未确认，结束本轮");
    stock = after;
    sent += quantity;
    log(`已向 ID ${recipientId} 赠送 ${sent} 个功法残卷，剩余 ${stock} 个`);
    if (sent < budget && stock > 0) legacy = await refreshLegacy();
  }
  return { status: "completed", reason: `已向 ID ${recipientId} 赠送 ${sent} 个功法残卷` };
}
