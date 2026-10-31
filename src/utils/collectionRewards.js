import { extractRolePatch } from './roleSnapshot.js';

const rows = value => Object.values(value || {});
const get = (map, key) => map instanceof Map ? map.get(key) : map?.[key];
const entries = map => map instanceof Map ? [...map] : Object.entries(map || {});
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export async function loadCollectionRewardConfig(send, fetchConfig = globalThis.fetch) {
  const { dataBundleVer: version } = await send('system_getdatabundlever', {});
  if (typeof version !== 'string' || !/^[\w-]+$/.test(version)) throw new Error('缺少有效的藏品配置版本');
  const response = await fetchConfig(`https://xxz-xyzw-res.hortorgames.com/data/${version}/config.json`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('藏品与卡牌配置读取失败');
  const config = await response.json();
  for (const name of ['CollectionStageConf', 'CollectionSeriesConf', 'CollectionHeroSuitsConf', 'CardPackageConf', 'CardSeriesConf']) {
    if (!rows(config[name]).length) throw new Error(`奖励配置缺失：${name}`);
  }
  return config;
}

// 客户端 advancing = (canActivateNum - activateNum) * activateScore。
// activateNum 的协议默认值为 0；必须明确返回可激活次数和正积分才发送。
export function collectionActivationActions(collection) {
  const actions = [];
  for (const [field, poolType] of [['heroSeries', 2], ['collectMap', 1], ['themeSeries', 3]]) {
    for (const [seriesKey, series] of entries(collection?.[field])) {
      const seriesId = Number(seriesKey);
      if (!Number.isInteger(seriesId) || seriesId <= 0) continue;
      for (const [itemKey, item] of entries(series?.collectMap)) {
        const id = Number(poolType === 3 ? item?.id : itemKey);
        const activated = item?.activateNum ?? 0;
        if (!Number.isInteger(id) || id <= 0 ||
            !Number.isInteger(activated) || activated < 0 ||
            !Number.isInteger(item?.canActivateNum) || item.canActivateNum <= activated ||
            !Number.isFinite(item.activateScore) || item.activateScore <= 0) continue;
        // 主题页的点击激活只处理英雄皮肤；普通装扮按客户端已知类型操作。
        if (poolType === 3 && item.type !== 1) continue;
        if (poolType === 1 && (seriesId < 2 || seriesId > 9)) continue;
        actions.push({ cmd: 'collection_activate', params: { poolType, id, isAll: false, seriesId }, progress: activated });
      }
    }
  }
  return actions;
}

export function collectionRewardActions(collection, config) {
  if (!object(collection) || !Number.isFinite(collection.claimScore) || !Number.isFinite(collection.collectionLevel)) throw new Error('藏品状态不完整');
  const actions = collectionActivationActions(collection);
  for (const [field, table, poolType] of [['themeSeries', 'CollectionSeriesConf', 3], ['suitSeries', 'CollectionHeroSuitsConf', 4]]) {
    if (!object(collection[field])) throw new Error('藏品系列状态不完整');
    for (const [id, state] of entries(collection[field])) {
      const conf = get(config[table], id) || rows(config[table]).find(row => row.id === Number(id));
      if (!conf || !Array.isArray(conf.stage) || !Number.isFinite(state?.colProcess) || !Number.isFinite(state?.claimProcess)) continue;
      if (conf.stage.some(stage => stage <= state.colProcess && stage > state.claimProcess)) {
        actions.push({ cmd: 'collection_claimseries', params: { seriesId: Number(id), isAll: poolType === 3, poolType }, progress: state.claimProcess });
      }
    }
  }
  const stages = rows(config.CollectionStageConf);
  const index = collection.collectionLevel === 0 ? -1 : stages.findIndex(row => row.id === collection.collectionLevel);
  if (collection.collectionLevel !== 0 && index < 0) throw new Error('藏品等级与配置不匹配');
  const next = stages[index + 1];
  if (next && collection.claimScore >= next.stage) actions.push({ cmd: 'collection_claimtotal', params: {}, progress: collection.collectionLevel });
  return actions;
}

export function cardRewardActions(role, config) {
  if (!object(role?.linkCard) || !object(role.linkCardPackage) || !object(role.linkCardSeries)) throw new Error('卡牌图鉴状态不完整');
  const owned = id => Number(get(role.linkCard, id)?.quantity) > 0;
  const actions = [];
  const packages = new Map();
  for (const conf of rows(config.CardPackageConf)) {
    if (!Array.isArray(conf.cards) || !conf.cards.length || !Array.isArray(conf.colorfulCards)) continue;
    const normal = conf.cards.filter((id, i) => owned(id) || owned(conf.colorfulCards[i])).length;
    const color = conf.colorfulCards.filter(owned).length;
    packages.set(conf.id, { normal: normal === conf.cards.length, color: conf.colorfulCards.length === conf.cards.length && color === conf.cards.length });
    for (const isColor of [false, true]) {
      const thresholds = isColor ? conf.rewardsCardNumColor : conf.rewardsCardNum;
      const count = isColor ? color : normal;
      const claims = get(role.linkCardPackage, conf.id)?.[isColor ? 'processColorClaimMap' : 'processClaimMap'];
      const pending = (thresholds || []).filter(n => n <= count && !(Number(get(claims, n)) > 0));
      if (pending.length) actions.push({ cmd: 'linkcard_claimpackprocessreward', params: { packId: conf.id, isColor }, progress: pending.join(',') });
    }
  }
  for (const conf of rows(config.CardSeriesConf)) {
    if (!Array.isArray(conf.cardPackage) || !conf.cardPackage.length) continue;
    for (const isColor of [false, true]) {
      const claimed = get(role.linkCardSeries, conf.id)?.[isColor ? 'colorClaimTime' : 'claimTime'];
      if (!(Number(claimed) > 0) && conf.cardPackage.every(id => packages.get(id)?.[isColor ? 'color' : 'normal'])) {
        actions.push({ cmd: 'linkcard_claimseriesreward', params: { seriesId: conf.id, isColor }, progress: 0 });
      }
    }
  }
  return actions;
}

// 每次写入后重新查询完整状态；不依赖奖励返回体是否包含角色增量。
export async function runCollectionRewards({ send, config, cards = false, log = () => {} }) {
  const read = async () => {
    const response = await send(cards ? 'role_getroleinfo' : 'collection_getinfo', {});
    return cards ? extractRolePatch(response) : response?.collection;
  };
  const plan = state => cards ? cardRewardActions(state, config) : collectionRewardActions(state, config);
  let state = await read();
  let count = 0;
  const observed = new Set();
  for (;;) {
    const action = plan(state)[0];
    if (!action) return { claimed: count, skipped: count === 0 };
    const key = JSON.stringify(action);
    if (observed.has(key)) throw new Error('领奖后服务器进度未变化，停止重复领取');
    observed.add(key);
    try {
      await send(action.cmd, action.params);
    } catch (error) {
      if (!error.interrupted) {
        try { await read(); log('领奖失败或超时，已重新查询状态；本轮不重发'); } catch { /* 保留原始请求错误 */ }
      }
      throw error;
    }
    state = await read();
    if (plan(state).some(next => JSON.stringify(next) === key)) throw new Error('领奖后服务器未确认进度变化');
    count++;
    log(`已确认领取${cards ? '卡牌图鉴' : '藏品'}奖励 ${count} 次`);
  }
}
