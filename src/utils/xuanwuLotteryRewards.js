import { loadXuanwuActivityConfig } from "./xuanwuActivityConfig.js";
const claimed = (info, id) => info?.cumulativeClaimedMap instanceof Map
  ? (info.cumulativeClaimedMap.get(id) ?? info.cumulativeClaimedMap.get(String(id))) === true
  : info?.cumulativeClaimedMap?.[id] === true;

export const getLotteryCumulativeTiers = (config, actId) =>
  Object.values(config?.cumulativeDrawConf || config?.CumulativeDrawConf || {})
    .filter(t => Number(t.actId) === Number(actId)
      && Number.isSafeInteger(t.id) && t.id > 0
      && Number.isFinite(t.cumulativeNum) && t.cumulativeNum > 0)
    .sort((a, b) => a.cumulativeNum - b.cumulativeNum);

export const getNextUnclaimedLotteryCumulativeId = (info = {}, tiers = []) =>
  tiers.find(t => Number(info.lotteryNum) >= t.cumulativeNum && !claimed(info, t.id))?.id ?? null;

/** 每次账号任务独立创建；失败后本轮不重试，避免超时重复领取。 */
export const createLotteryCumulativeClaimer = ({ send, actId, shouldStop, onClaim, onError, wait = async () => {}, fetchConfig = globalThis.fetch, config }) => {
  let tiers;
  let blocked = false;
  const confirmed = new Set();
  return async () => {
    if (blocked || shouldStop()) return 0;
    let count = 0;
    try {
      if (!tiers) {
        const currentConfig = config || await loadXuanwuActivityConfig(send, fetchConfig);
        tiers = getLotteryCumulativeTiers(currentConfig, actId);
        if (!tiers.length) throw new Error(`未找到活动${actId}的累抽奖励配置`);
      }
      let info = (await send('activity_getlotteryinfo', {}))?.lotteryInfo;
      if (!info) throw new Error('缺少累计抽奖状态');
      while (!shouldStop()) {
        const id = getNextUnclaimedLotteryCumulativeId(info, tiers.filter(t => !confirmed.has(t.id)));
        if (id === null) break;
        const res = await send('activity_claimlotterycumulative', { id });
        let updated = res?.lotteryInfo;
        if (!claimed(updated, id)) {
          await wait();
          updated = (await send('activity_getlotteryinfo', {}))?.lotteryInfo;
        }
        if (!claimed(updated, id)) throw new Error(`奖励${id}未确认领取状态，停止本轮领取`);
        confirmed.add(id);
        count++;
        onClaim(id, res?.reward || []);
        info = { ...info, ...updated, lotteryNum: updated.lotteryNum ?? info.lotteryNum };
        await wait();
      }
    } catch (error) {
      blocked = true;
      onError(error);
    }
    return count;
  };
};
