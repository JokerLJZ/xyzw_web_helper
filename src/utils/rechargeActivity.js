import { extractRolePatch } from "./roleSnapshot.js";
import { getSkinChallengeBudget, runSkinChallenge } from "./skinChallengeRunner.js";

export const activityBody = response => response?._raw?.body || response?.body || response?.data || response;
export const mapGet = (map, key) => map instanceof Map ? (map.get(key) ?? map.get(String(key))) : map?.[key];
export const mapEntries = map => map instanceof Map ? [...map.entries()] : Object.entries(map || {});
const values = map => mapEntries(map).map(([, value]) => value);
const configs = new Map();
const DAY = 86400000;
const dayStart = time => Math.floor((time + 8 * 3600000) / DAY) * DAY - 8 * 3600000;
const validNumber = (value, label) => {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`${label}数据不完整`);
  return Number(value);
};

export async function loadRechargeConfig(send, fetcher = globalThis.fetch) {
  const version = activityBody(await send("system_getdatabundlever", { isAudit: false }))?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) throw new Error("未取得活动配置版本");
  if (!configs.has(version)) {
    const loading = Promise.all(["config", "language"].map(async file => {
      const response = await fetcher(`https://xxz-xyzw-res.hortorgames.com/data/${version}/${file}.json`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("活动配置下载失败");
      return response.json();
    })).then(([config, language]) => ({ ...config, ...language, version }));
    configs.set(version, loading);
    loading.catch(() => configs.delete(version));
  }
  return configs.get(version);
}

/** 公共配置清单，不查询或连接任何账号。 */
export async function loadRechargeExchangeCatalog(fetcher = globalThis.fetch, now = Date.now()) {
  const response = await fetcher("https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=0.36.0-android", {
    method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8", Accept: "application/json,text/plain,*/*" },
    body: "", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("活动配置版本加载失败");
  const manifest = await response.json();
  const body = typeof manifest.body === "string" ? JSON.parse(manifest.body) : manifest.body;
  const config = await loadRechargeConfig(async () => ({ dataBundleVer: body?.dataBundleVer }), fetcher);
  const event = findRechargeActivity(config, now);
  const activity = event?.byType(2);
  if (!activity) throw new Error("当前没有可识别的充值兑换活动");
  return { eventName: event.name, activityId: activity.id, configVersion: config.version,
    itemName: rewardText(config, 3, activity.itemId),
    rows: values(config.ExchangeActConf).filter(row => row.actId === activity.id).sort((a, b) => a.rank - b.rank)
      .map(row => ({ ...row, name: rewardText(config, row.resourceType, row.rewardId) })),
  };
}

export function activityText(config, key) {
  for (const table of values(config.LanguageConf)) {
    const row = mapGet(table, key);
    if (row?.chinese) return row.chinese;
  }
  return key || "未知物品";
}
export function rewardText(config, type, id) {
  const table = Number(type) === 11 ? config.SkinConf : Number(type) === 4 ? config.HeroConf : config.ItemConf;
  return activityText(config, mapGet(table, id)?.name || `物品${id}（类型${type}）`);
}

/** 用当前配置中的活动组、开始时间和玩法类型匹配，不依赖年份或日期 ID 前缀。 */
export function findRechargeActivity(config, now = Date.now()) {
  const roots = values(config.actConstantConf).filter(row => Number(row.actGroup || 0) === 0 && row.start * 1000 <= now && now < row.end * 1000).sort((a, b) => b.start - a.start);
  for (const root of roots) {
    const activities = values(config.ActFestivalConf).filter(row => Number(row.actGroup || 0) === 0 && row.start === root.start && row.start * 1000 <= now && now < row.end * 1000);
    const byType = type => activities.find(row => Number(row.actType) === type);
    if (byType(2) && (byType(3) || byType(24) || byType(19))) return { root, activities, byType, code: root.id, name: activityText(config, root.name) };
  }
  return null;
}

function commonInfo(response) {
  const info = activityBody(response)?.activity?.commonActivityInfo;
  if (!info || typeof info !== "object") throw new Error("活动快照缺少领取记录，停止操作");
  return info;
}
const recordsFor = (info, id) => mapGet(info, id)?.record || {};

export function remainingBarbecue(config, activity, towers) {
  return getSkinChallengeBudget(activity, towers, 3);
}

/** Celebrate_GetCelebrateInfoResp 继承 CelebrateInfo；原始 BON 可能省略默认实例和空 Map。 */
export function normalizeCelebrationInfo(response) {
  let source = activityBody(response);
  if (source?.celebrateInfoResp !== undefined) source = source.celebrateInfoResp;
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("生日祝福响应格式异常");
  const allowed = ["signCelebrate", "fullServerSignCnt", "_originalCmd"];
  if (!Object.keys(source).every(key => allowed.includes(key))) throw new Error("生日祝福响应包含未知结构，停止操作");
  const sign = source.signCelebrate ?? {};
  if (typeof sign !== "object" || Array.isArray(sign) || source.signCelebrate === null) throw new Error("生日祝福记录格式异常");
  const normalizeMap = (map, name) => {
    if (map === undefined) return {};
    if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error(`生日祝福${name}格式异常`);
    return Object.fromEntries(mapEntries(map));
  };
  const personal = normalizeMap(sign.personalClaimMap, "个人任务");
  for (const [key, row] of Object.entries(personal)) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("生日任务状态格式异常");
    personal[key] = { claimCnt: 0, canClaimCnt: 0, signState: 0, shareTime: 0, shareClaimTime: 0, ...row };
  }
  return { fullServerSignCnt: validNumber(source.fullServerSignCnt ?? 0, "全服祝福次数"), signCelebrate: {
    personalSignMap: normalizeMap(sign.personalSignMap, "签到记录"),
    personalClaimMap: personal,
    fullServerClaimMap: normalizeMap(sign.fullServerClaimMap, "全服领奖记录"),
  } };
}

export async function queryRechargeExchange(send, config, now = Date.now()) {
  const event = findRechargeActivity(config, now);
  const activity = event?.byType(2);
  if (!activity) throw new Error("当前没有可识别的充值兑换活动");
  return queryActivityExchange(send, config, event, activity);
}

export async function queryActivityExchange(send, config, event, activity) {
  const info = commonInfo(await send("activity_get", {}));
  const roleResponse = await send("role_getroleinfo", {});
  const role = extractRolePatch(roleResponse) || activityBody(roleResponse)?.role;
  if (!role?.items) throw new Error("未取得该账号道具库存");
  const stock = validNumber(mapGet(role.items, activity.itemId)?.quantity ?? 0, "兑换库存");
  const record = recordsFor(info, activity.id);
  const goods = values(config.ExchangeActConf).filter(row => row.actId === activity.id).sort((a, b) => a.rank - b.rank);
  const spent = goods.reduce((sum, row) => sum + Number(mapGet(record, row.id) || 0) * row.consumeNum, 0);
  const rows = goods.map(row => {
    const used = validNumber(mapGet(record, row.id) ?? 0, "已兑换数量");
    const cost = validNumber(row.consumeNum, "兑换价格");
    const remaining = row.limitNum > 0 ? Math.max(0, row.limitNum - used) : Infinity;
    const locked = spent < Number(row.unlockNeed || 0);
    const skin = Number(row.resourceType) === 11 ? mapGet(config.SkinConf, row.rewardId) : null;
    const owned = !!skin && mapGet(mapGet(role.heroes, skin.heroId)?.skin, row.rewardId) !== undefined;
    return { ...row, name: rewardText(config, row.resourceType, row.rewardId), used, remaining, locked, owned, max: locked || owned || cost <= 0 ? 0 : Math.min(remaining, Math.floor(stock / cost)) };
  });
  return { eventCode: event.code, eventName: event.name, activityId: activity.id, end: activity.end, itemId: activity.itemId, itemName: rewardText(config, 3, activity.itemId), stock, spent, rows, configVersion: config.version };
}

/** 每项按用户选择顺序执行；每次重新查询库存和限购，不在写超时后重发。 */
export async function exchangeRechargeItems({ send, config, selection, expectedActivityId, now = Date.now, log = () => {}, query = queryRechargeExchange, skipUnavailable = false }) {
  for (const choice of selection) {
    if (!Number.isSafeInteger(choice.quantity) || choice.quantity <= 0) throw new Error("兑换数量必须为正整数");
    const snapshot = await query(send, config, now());
    if (snapshot.activityId !== expectedActivityId) throw new Error("活动已切期，请重新查询并选择商品");
    const row = snapshot.rows.find(row => row.id === choice.goodsId);
    if (!row || row.max < choice.quantity) {
      const reason = `${row?.name || choice.goodsId} 库存、解锁条件、已拥有或限购不足`;
      if (skipUnavailable) { log(`跳过 ${reason}`); continue; }
      throw new Error(`${reason}，停止该账号兑换`);
    }
    try {
      await send("activity_exchange", { activityId: snapshot.activityId, goodsId: row.id, quantity: choice.quantity });
    } catch (error) {
      if (error.stopped) throw error;
      await query(send, config, now()).catch(() => {});
      if (skipUnavailable && error.serverRejected) { log(`跳过 ${row.name}：${error.message}`); continue; }
      throw new Error(`兑换结果待核实，已停止且不自动重试：${error.message}`);
    }
    const after = await query(send, config, now());
    const updated = after.rows.find(item => item.id === row.id);
    if (after.activityId !== snapshot.activityId || updated?.used !== row.used + choice.quantity) throw new Error("兑换记录未确认，已停止且不自动重试");
    log(`已兑换 ${row.name} ×${row.rewardNum * choice.quantity}，消耗${choice.quantity * row.consumeNum}个${snapshot.itemName}`);
  }
}

export async function runRechargeStandard({ send, config, now = Date.now, log = () => {} }) {
  const transport = send;
  send = async (cmd, params) => {
    try { return await transport(cmd, params); }
    catch (error) {
      if (!error.stopped && !cmd.startsWith("towers_") && cmd !== "team_setteam" && !/get|role_getroleinfo/.test(cmd)) {
        const query = cmd.startsWith("celebrate_") ? ["celebrate_getcelebrateinfo", {}]
          : cmd.startsWith("towers_") ? ["towers_getinfo", { actId: params.actId }]
          : cmd === "activity_maydaylottery" ? ["role_getroleinfo", {}] : ["activity_get", {}];
        await transport(...query).catch(() => {});
      }
      throw error;
    }
  };
  const event = findRechargeActivity(config, now());
  if (!event) return { status: "skipped", reason: "当前没有可识别的充值庆典" };
  log(`开始${event.name}，活动编码${event.code}，配置${config.version}`);
  const errors = [];
  const active = activity => {
    if (now() >= activity.end * 1000 || now() < activity.start * 1000) throw new Error("活动已结束或未开始");
  };
  const stage = async (name, run) => {
    log(name);
    try { await run(); } catch (error) { if (error.stopped) throw error; errors.push(`${name}：${error.message}`); log(`${name}停止：${error.message}`); }
  };
  const celebration = event.byType(13);
  if (celebration) await stage("生日祝福与任务奖励（邀请最多2次）", async () => {
    active(celebration);
    const query = async () => {
      return normalizeCelebrationInfo(await send("celebrate_getcelebrateinfo", {}));
    };
    let info = await query();
    const signedToday = () => {
      const key = new Date(now() + 8 * 3600000).toISOString().slice(2, 10).replaceAll("-", "");
      return mapGet(info.signCelebrate.personalSignMap, key) !== undefined || values(info.signCelebrate.personalSignMap).some(time => dayStart(Number(time) < 1e12 ? Number(time) * 1000 : Number(time)) === dayStart(now()));
    };
    if (!signedToday()) {
      await send("celebrate_sign", {});
      info = await query();
      if (!signedToday()) throw new Error("生日祝福状态未确认");
    }
    const claimPersonal = async () => {
      for (const row of values(config.SingleSignConf)) {
        if (Number(mapGet(info.signCelebrate.personalClaimMap, row.id)?.signState) !== 1) continue;
        const previous = Number(mapGet(info.signCelebrate.personalClaimMap, row.id)?.claimCnt || 0);
        await send("celebrate_claimpersonal", { idList: [row.id] });
        info = await query();
        const state = mapGet(info.signCelebrate.personalClaimMap, row.id);
        if (Number(state?.signState) !== 2 || Number(state?.claimCnt) !== previous + 1) throw new Error("生日任务领取未确认");
      }
    };
    await claimPersonal();
    // 客户端任务页用具体任务 id 邀请；主界面 id=0 是不发请求的假分享。
    const sharedToday = values(info.signCelebrate.personalClaimMap).filter(state => {
      const time = Number(state.shareTime || state.shareClaimTime || 0);
      return time > 0 && dayStart(time < 1e12 ? time * 1000 : time) === dayStart(now());
    }).length;
    for (let count = sharedToday; count < 2; count++) {
      active(celebration);
      const row = values(config.SingleSignConf).find(row => {
        const state = mapGet(info.signCelebrate.personalClaimMap, row.id);
        return row.isShare && Number(state?.signState) === 2 && Number(state?.claimCnt || 0) < 2;
      });
      if (!row) break;
      await send("celebrate_share", { id: row.id });
      info = await query();
      await claimPersonal();
      if (Number(mapGet(info.signCelebrate.personalClaimMap, row.id)?.claimCnt || 0) < 2) throw new Error("邀请奖励未确认");
      log(`生日任务${row.id}邀请与领奖完成`);
    }
    for (const row of values(config.GlobalSignConf)) {
      if (Number(info.fullServerSignCnt) < row.globalNum || mapGet(info.signCelebrate.fullServerClaimMap, row.id) !== undefined) continue;
      await send("celebrate_claimfullserver", { idList: [row.id] });
      info = await query();
      if (mapGet(info.signCelebrate.fullServerClaimMap, row.id) === undefined) throw new Error("全服祝福奖励未确认");
    }
  });
  const barbecue = event.byType(19);
  if (barbecue) await stage("周年烧烤（保留当日3次）", async () => {
    active(barbecue);
    await runSkinChallenge({ send, config, activity: barbecue, now, log, reserveChallenges: 3, copyMainlineFormation: true });
  });
  const lottery = event.byType(24);
  if (lottery) await stage("周年狂欢（仅活动道具）", async () => {
    active(lottery);
    const itemId = Number(lottery.parameters?.[1]);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) throw new Error("抽奖活动道具配置不完整");
    const stock = async () => {
      const response = await send("role_getroleinfo", {});
      const role = extractRolePatch(response);
      if (!role?.items) throw new Error("未取得抽奖道具库存");
      return validNumber(mapGet(role.items, itemId)?.quantity ?? 0, "抽奖库存");
    };
    for (let count = 0; count < 1000; count++) {
      active(lottery);
      const before = await stock();
      const times = before >= 10 ? 10 : before >= 1 ? 1 : 0;
      if (!times) break;
      // 不调用 item 兑换或路路通消耗，也不自动选择进阶宝箱奖励。
      await send("activity_maydaylottery", { times });
      if (await stock() !== before - times) throw new Error("抽奖道具扣除未确认，停止抽奖");
      log(`活动道具抽奖${times}次`);
    }
  });
  await stage("领取周年福袋与累计充值免费奖励", async () => {
    let info = commonInfo(await send("activity_get", {}));
    const shop = event.byType(4);
    if (shop) for (const row of values(config.ActMerchandiseConf).filter(row => row.activityID === shop.id && Number(row.price) === 0)) {
      active(shop);
      if (Number(mapGet(recordsFor(info, shop.id), row.id) || 0) >= row.limit) continue;
      await send("activity_commonbuygoods", { goodsId: row.id });
      info = commonInfo(await send("activity_get", {}));
      if (!mapGet(recordsFor(info, shop.id), row.id)) throw new Error("免费福袋领取未确认");
    }
    const card = event.byType(1);
    if (card && mapGet(info, card.id)?.isBought) {
      const rows = values(config.FuKaActConf).filter(row => row.actId === card.id);
      const last = Math.max(0, ...rows.filter(row => mapGet(recordsFor(info, card.id), row.id)).map(row => row.dayNum));
      const day = Math.min(rows.length, Math.floor((dayStart(now()) - dayStart(card.start * 1000)) / DAY) + 1);
      if (last < day) {
        active(card);
        await send("common_claimcardreward", { activityId: card.id });
        info = commonInfo(await send("activity_get", {}));
        const updated = Math.max(0, ...rows.filter(row => mapGet(recordsFor(info, card.id), row.id)).map(row => row.dayNum));
        if (updated <= last) throw new Error("已购福卡权益领取未确认");
      }
    }
    const charge = event.byType(3);
    if (charge) for (const row of values(config.CumulativeChargeActConf).filter(row => row.actId === charge.id && Number(row.chargeAmount) === 0)) {
      active(charge);
      if (mapGet(recordsFor(info, charge.id), row.id)) continue;
      await send("common_claimtotalreward", { activityId: charge.id, configId: row.id });
      info = commonInfo(await send("activity_get", {}));
      if (!mapGet(recordsFor(info, charge.id), row.id)) throw new Error("累计充值免费档领取未确认");
    }
  });
  return { status: errors.length ? "failed" : "completed", reason: errors.join("；") };
}
