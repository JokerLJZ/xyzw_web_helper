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
export const createLotteryCumulativeClaimer = ({ send, actId, shouldStop, onClaim, onError, wait = async () => {}, fetchConfig = fetch }) => {
  let tiers;
  let blocked = false;
  const confirmed = new Set();
  return async () => {
    if (blocked || shouldStop()) return 0;
    let count = 0;
    try {
      if (!tiers) {
        const { dataBundleVer } = await send('system_getdatabundlever', { isAudit: false });
        if (!/^[a-zA-Z0-9_-]+$/.test(dataBundleVer || '')) throw new Error('缺少有效配置版本');
        const response = await fetchConfig(`https://xxz-xyzw-res.hortorgames.com/data/${dataBundleVer}/config.json`, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`读取活动配置失败: ${response.status}`);
        tiers = getLotteryCumulativeTiers(await response.json(), actId);
        if (!tiers.length) throw new Error(`未找到活动${actId}的累抽奖励配置`);
      }
      let info = (await send('activity_getlotteryinfo', {}))?.lotteryInfo;
      if (!info) throw new Error('缺少累计抽奖状态');
      while (!shouldStop()) {
        const id = getNextUnclaimedLotteryCumulativeId(info, tiers.filter(t => !confirmed.has(t.id)));
        if (id === null) break;
        const res = await send('activity_claimlotterycumulative', { id });
        const updated = res?.lotteryInfo || (await send('activity_getlotteryinfo', {}))?.lotteryInfo;
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
