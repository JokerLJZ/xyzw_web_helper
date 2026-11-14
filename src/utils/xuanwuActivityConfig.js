// 只共享不可变配置；账号进度与领取记录不得放入此缓存。
const caches = new WeakMap();
export async function loadXuanwuActivityConfig(send, fetchConfig = globalThis.fetch) {
  const { dataBundleVer: version } = await send('system_getdatabundlever', { isAudit: false });
  if (typeof version !== 'string' || !/^[\w-]+$/.test(version)) throw new Error('缺少有效配置版本');
  let cache = caches.get(fetchConfig);
  if (!cache) caches.set(fetchConfig, cache = new Map());
  if (!cache.has(version)) {
    const loading = (async () => {
      const response = await fetchConfig(`https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`读取活动配置失败: ${response.status}`);
      const config = await response.json();
      return { cumulativeDrawConf: config.cumulativeDrawConf || config.CumulativeDrawConf,
        ActFestivalConf: config.ActFestivalConf,
        BattlePassMissionConf: config.BattlePassMissionConf };
    })();
    cache.set(version, loading);
    loading.catch(() => { if (cache.get(version) === loading) cache.delete(version); });
  }
  return cache.get(version);
}

export function getClaimableXuanwuMissions(config, actId, info) {
  const missions = Object.values(config?.BattlePassMissionConf || {}).filter(t => Number(t.actId) === Number(actId));
  if (!missions.length) throw new Error(`未找到活动${actId}的通行证任务配置`);
  return missions.filter(t => Number.isSafeInteger(t.id) && Number(t.completeValue) > 0
    && Number(info?.complete?.[t.id] || 0) >= Number(t.completeValue)
    && info?.taskClaimed?.[t.id] !== true);
}
