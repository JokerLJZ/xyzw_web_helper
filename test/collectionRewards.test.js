import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionRewardActions, cardRewardActions, runCollectionRewards, loadCollectionRewardConfig } from '../src/utils/collectionRewards.js';
import { DailyTaskRunner } from '../src/utils/dailyTaskRunner.js';
const config = {
  CollectionStageConf: { 100: { id: 100, stage: 10 }, 200: { id: 200, stage: 20 } },
  CollectionSeriesConf: { 1: { id: 1, stage: [2, 4] } },
  CollectionHeroSuitsConf: { 2: { id: 2, stage: [2, 3] } },
  CardPackageConf: { 10: { id: 10, cards: [11, 12], colorfulCards: [21, 22], rewardsCardNum: [1, 2], rewardsCardNumColor: [1, 2] } },
  CardSeriesConf: { 1: { id: 1, cardPackage: [10] } },
};
const collection = () => ({ claimScore: 25, collectionLevel: 100, themeSeries: { 1: { colProcess: 4, claimProcess: 2 } }, suitSeries: { 2: { colProcess: 3, claimProcess: 2 } } });
const role = () => ({ linkCard: { 21: { quantity: 1 }, 22: { quantity: 1 } }, linkCardPackage: {}, linkCardSeries: {} });

test('藏品按已激活进度领取主题、套装和下一级总积分，参数匹配客户端', () => {
  assert.deepEqual(collectionRewardActions(collection(), config), [
    { cmd: 'collection_claimseries', params: { seriesId: 1, isAll: true, poolType: 3 }, progress: 2 },
    { cmd: 'collection_claimseries', params: { seriesId: 2, isAll: false, poolType: 4 }, progress: 2 },
    { cmd: 'collection_claimtotal', params: {}, progress: 100 },
  ]);
  const state = collection(); state.themeSeries[1].colProcess = 2; state.suitSeries[2].colProcess = 2; state.claimScore = 19;
  assert.deepEqual(collectionRewardActions(state, config), []);
});
test('初始藏品等级、最高等级与未知等级', () => {
  const state = { ...collection(), themeSeries: {}, suitSeries: {}, collectionLevel: 0 };
  assert.equal(collectionRewardActions(state, config)[0].cmd, 'collection_claimtotal');
  state.collectionLevel = 200;
  assert.deepEqual(collectionRewardActions(state, config), []);
  state.collectionLevel = 999;
  assert.throws(() => collectionRewardActions(state, config), /不匹配/);
});
test('彩卡同时计入普通收集，卡包与系列普通/彩色分开领奖', () => {
  const actions = cardRewardActions(role(), config);
  assert.equal(actions.length, 4);
  assert.deepEqual(actions.map(a => a.params.isColor), [false, true, false, true]);
  assert.equal(actions[0].progress, '1,2');
});
test('已领、未达标与其他账号不产生领奖动作', () => {
  const state = role();
  state.linkCardPackage[10] = { processClaimMap: { 1: 5, 2: 5 }, processColorClaimMap: { 1: 5, 2: 5 } };
  state.linkCardSeries[1] = { claimTime: 5, colorClaimTime: 5 };
  assert.deepEqual(cardRewardActions(state, config), []);
  assert.deepEqual(cardRewardActions({ ...role(), linkCard: {} }, config), []);
  assert.equal(cardRewardActions(role(), config).length, 4);
});
test('缺少完整状态拒绝发送，支持 Map', () => {
  assert.throws(() => cardRewardActions({}, config), /不完整/);
  assert.throws(() => collectionRewardActions({}, config), /不完整/);
  const state = role(); state.linkCard = new Map([[21, { quantity: 1 }]]);
  assert.equal(cardRewardActions(state, config).length, 2);
});
test('逐档查询服务端状态直到全部领取，不依赖领奖增量返回', async () => {
  const state = { claimScore: 25, collectionLevel: 0, themeSeries: {}, suitSeries: {} };
  const calls = [];
  const result = await runCollectionRewards({ config, send: async cmd => {
    calls.push(cmd);
    if (cmd === 'collection_getinfo') return { collection: structuredClone(state) };
    state.collectionLevel = state.collectionLevel === 0 ? 100 : 200;
    return { reward: [] };
  } });
  assert.equal(result.claimed, 2);
  assert.deepEqual(calls, ['collection_getinfo', 'collection_claimtotal', 'collection_getinfo', 'collection_claimtotal', 'collection_getinfo']);
});
test('无进度变化停止，不重复领取', async () => {
  let writes = 0;
  await assert.rejects(runCollectionRewards({ config, send: async cmd => {
    if (cmd === 'collection_getinfo') return { collection: collection() };
    writes++; return {};
  } }), /未确认/);
  assert.equal(writes, 1);
});
test('写入超时后查询且不重发', async () => {
  const calls = [];
  await assert.rejects(runCollectionRewards({ config, send: async cmd => {
    calls.push(cmd);
    if (cmd === 'collection_getinfo') return { collection: collection() };
    throw new Error('请求超时');
  } }), /超时/);
  assert.deepEqual(calls, ['collection_getinfo', 'collection_claimseries', 'collection_getinfo']);
});
test('用户停止后不再查询', async () => {
  const calls = [];
  await assert.rejects(runCollectionRewards({ config, send: async cmd => {
    calls.push(cmd);
    if (cmd === 'collection_getinfo') return { collection: collection() };
    throw Object.assign(new Error('停止'), { interrupted: true });
  } }), /停止/);
  assert.equal(calls.length, 2);
});
test('配置来自该账号返回版本，失败不缓存', async () => {
  let url;
  assert.deepEqual(await loadCollectionRewardConfig(async () => ({ dataBundleVer: 'current-123' }), async input => {
    url = input; return { ok: true, json: async () => config };
  }), config);
  assert.match(url, /data\/current-123\/config.json$/);
  await assert.rejects(loadCollectionRewardConfig(async () => ({})), /版本/);
});
test('日常执行器接入并在超时后允许复查，恢复原来的错误处理状态', async () => {
  const calls = [];
  const runner = new DailyTaskRunner({ sendMessageWithPromise: async (_id, cmd) => {
    calls.push(cmd);
    if (cmd === 'system_getdatabundlever') return { dataBundleVer: 'test' };
    if (cmd === 'collection_getinfo') return { collection: collection() };
    throw new Error('请求超时');
  } });
  runner.sleep = async () => {};
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => config });
  try {
    await assert.rejects(runner.claimCollectionProgressRewards('account-a'), /超时/);
    assert.equal(calls.at(-1), 'collection_getinfo');
    assert.equal(runner.rewardRecoveryActive, undefined);
  } finally { globalThis.fetch = previous; }
});
