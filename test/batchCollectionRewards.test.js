import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTasksCollectionRewards } from '../src/utils/batch/tasksCollectionRewards.js';
const config = {
  CollectionStageConf: { 1: { id: 1, stage: 10 } },
  CollectionSeriesConf: { 1: { id: 1, stage: [2] } },
  CollectionHeroSuitsConf: { 1: { id: 1, stage: [2] } },
  CardPackageConf: { 1: { id: 1, cards: [1], colorfulCards: [2], rewardsCardNum: [1] } },
  CardSeriesConf: { 1: { id: 1, cardPackage: [1] } },
};
function fixture() {
  const calls = [], released = [];
  const states = { a: 0, b: 0 };
  const deps = {
    selectedTokens: { value: ['a', 'b'] }, tokens: { value: [] }, tokenStatus: { value: {} },
    isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null },
    ensureConnection: async id => calls.push(['connect', id]), releaseConnectionSlot: () => released.push(true),
    addLog() {}, message: { info() {} }, wait: async () => {},
    tokenStore: {
      closeWebSocketConnection: id => calls.push(['close', id]),
      sendMessageWithPromise: async (id, cmd) => {
        calls.push([cmd, id]);
        if (cmd === 'system_getdatabundlever') return { dataBundleVer: 'test' };
        if (cmd === 'collection_getinfo') return { collection: { collectionLevel: states[id], claimScore: 10, themeSeries: {}, suitSeries: {} } };
        if (cmd === 'collection_claimtotal') { states[id] = 1; return {}; }
        if (cmd === 'role_getroleinfo') return { role: { linkCard: {}, linkCardPackage: {}, linkCardSeries: {} } };
        assert.fail(cmd);
      },
    },
  };
  return { deps, calls, released, tasks: createTasksCollectionRewards(deps) };
}
async function withConfig(fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => config });
  try { await fn(); } finally { globalThis.fetch = previous; }
}
test('资源批量逐账号领取和复查，完成后释放连接', () => withConfig(async () => {
  const f = fixture(); await f.tasks.batchClaimCollectionRewards();
  assert.deepEqual(f.calls.filter(([cmd]) => cmd === 'collection_claimtotal'), [['collection_claimtotal', 'a'], ['collection_claimtotal', 'b']]);
  assert.deepEqual(f.deps.tokenStatus.value, { a: 'completed', b: 'completed' });
  assert.equal(f.released.length, 2); assert.equal(f.deps.isRunning.value, false);
  assert.equal(f.deps.currentRunningTokenId.value, null);
}));
test('卡牌任务走独立入口，空图鉴不发送藏品请求', () => withConfig(async () => {
  const f = fixture(); await f.tasks.batchClaimCardCollectionRewards();
  assert.equal(f.calls.filter(([cmd]) => cmd === 'role_getroleinfo').length, 2);
  assert.equal(f.calls.some(([cmd]) => cmd.startsWith('collection_')), false);
}));
test('账号超时先复查不重发，后续账号继续', () => withConfig(async () => {
  const f = fixture(), original = f.deps.tokenStore.sendMessageWithPromise;
  f.deps.tokenStore.sendMessageWithPromise = async (id, cmd) => {
    if (id === 'a' && cmd === 'collection_claimtotal') { f.calls.push([cmd, id]); throw Error('请求超时'); }
    return original(id, cmd);
  };
  await f.tasks.batchClaimCollectionRewards();
  assert.equal(f.calls.filter(([cmd,id]) => cmd === 'collection_claimtotal' && id === 'a').length, 1);
  assert.equal(f.calls.filter(([cmd,id]) => cmd === 'collection_getinfo' && id === 'a').length, 2);
  assert.deepEqual(f.deps.tokenStatus.value, { a: 'failed', b: 'completed' });
  assert.equal(f.released.length, 2);
}));
test('停止后不发领奖请求，剩余账号标记停止并释放已连接账号', () => withConfig(async () => {
  const f = fixture(); f.deps.ensureConnection = async () => { f.deps.shouldStop.value = true; };
  // 工厂创建时读取依赖，重建以应用停止钩子。
  await createTasksCollectionRewards(f.deps).batchClaimCollectionRewards();
  assert.deepEqual(f.deps.tokenStatus.value, { a: 'stopped', b: 'stopped' });
  assert.equal(f.released.length, 1);
  assert.equal(f.calls.some(([cmd]) => cmd.startsWith('collection_')), false);
}));
test('只有资源面板和批量任务注册提供入口，旧日常设置不再触发', async () => {
  const view = await readFile(new URL('../src/views/BatchDailyTasks.vue', import.meta.url), 'utf8');
  const resource = view.slice(view.indexOf('<n-tab-pane name="resource"'), view.indexOf('</n-tab-pane>', view.indexOf('<n-tab-pane name="resource"')));
  for (const name of ['batchClaimCollectionRewards', 'batchClaimCardCollectionRewards']) {
    assert.ok(resource.includes(`@click="${name}"`));
    assert.ok(view.includes(`"${name}"`));
  }
  for (const path of ['../src/utils/dailyTaskRunner.js', '../src/components/Daily/DailyTaskStatus.vue']) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /collectionProgressRewards|cardCollectionRewards|claimCollectionProgressRewards/);
  }
});
