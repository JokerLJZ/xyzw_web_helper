import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPhotoWhiteJade } from '../src/utils/photoActivity.js';
import { groupTaskCatalog } from '../src/utils/batch/taskCatalog.js';
const NOW = Date.parse('2026-11-03T12:00:00+08:00');
function account(options = {}) {
  const act = (id, actType, itemId) => ({ id, actType, itemId, name: 'photo', actGroup: 2, start: NOW / 1000 - 1, end: NOW / 1000 + 100 });
  const goods = (id, actId, rewardId, consumeNum, rewardNum, limitNum) => ({ id, actId, rewardId, consumeNum, rewardNum, limitNum, unlockNeed: 0, resourceType: 3 });
  const config = { version: 'test', ActFestivalConf: [act(80, 36, 5290), act(100, 2, 5291), act(110, 2, 5293)],
    ExchangeActConf: [goods(101, 100, 5293, 1, 10, 7), goods(111, 110, 1022, 10, 1000, 50)] };
  const items = { 5291: { quantity: options.flower ?? 5 }, 5293: { quantity: options.star ?? 23 } };
  const info = { 100: { record: { 101: options.usedFlower ?? 0 } }, 110: { record: { 111: options.usedStar ?? 0 } } };
  const calls = [];
  const send = async (cmd, params) => {
    calls.push([cmd, params]);
    if (cmd === 'activity_get') return { activity: { commonActivityInfo: structuredClone(info) } };
    if (cmd === 'role_getroleinfo') return { role: { items: structuredClone(items) } };
    if (cmd === 'activity_exchange') {
      if (options.timeout) throw new Error('timeout');
      const row = config.ExchangeActConf.find(row => row.id === params.goodsId);
      if (!options.unconfirmed) info[params.activityId].record[params.goodsId] += params.quantity;
      items[params.activityId === 100 ? 5291 : 5293].quantity -= params.quantity * row.consumeNum;
      items[row.rewardId] ??= { quantity: 0 };
      items[row.rewardId].quantity += params.quantity * row.rewardNum;
      return { role: { gold: 1 } }; // 写响应没有库存，不用它推算第二步。
    }
    throw new Error(cmd);
  };
  return { send, config, now: () => NOW, calls, items, writes: () => calls.filter(([cmd]) => cmd === 'activity_exchange').map(([, params]) => params) };
}
test('先兑换勿忘我，重新读取到账满天星并与原有库存合并兑换白玉，保留零头，重跑不消耗', async () => {
  const a = account();
  assert.equal((await runPhotoWhiteJade(a)).status, 'completed');
  assert.deepEqual(a.writes(), [{ activityId: 100, goodsId: 101, quantity: 5 }, { activityId: 110, goodsId: 111, quantity: 7 }]);
  assert.equal(a.items[5293].quantity, 3);
  assert.equal(a.items[1022].quantity, 7000);
  assert.equal((await runPhotoWhiteJade(a)).status, 'skipped');
  assert.equal(a.writes().length, 2);
});
test('尊重两步的剩余限购，并隔离每个账号库存', async () => {
  const a = account({ flower: 20, star: 48, usedFlower: 5, usedStar: 49 });
  await runPhotoWhiteJade(a);
  assert.deepEqual(a.writes().map(row => row.quantity), [2, 1]);
  const b = account({ flower: 0, star: 9 });
  assert.equal((await runPhotoWhiteJade(b)).status, 'skipped');
  assert.deepEqual(b.writes(), []);
});
test('勿忘我无库存或已限购仍兑换原有满天星', async () => {
  for (const options of [{ flower: 0 }, { usedFlower: 7 }]) {
    const a = account(options);
    await runPhotoWhiteJade(a);
    assert.deepEqual(a.writes(), [{ activityId: 110, goodsId: 111, quantity: 2 }]);
  }
});
test('写超时或记录未确认停止后续兑换且不重发', async () => {
  for (const options of [{ timeout: true }, { unconfirmed: true }]) {
    const a = account(options);
    await assert.rejects(runPhotoWhiteJade(a), /不自动重试/);
    assert.equal(a.writes().length, 1);
    assert.ok(a.calls.slice(a.calls.findIndex(([cmd]) => cmd === 'activity_exchange') + 1).some(([cmd]) => cmd === 'role_getroleinfo'));
  }
});
test('配置异常、库存异常、跨期与停止均不继续写入', async () => {
  const a = account(); a.config.ExchangeActConf.pop();
  await assert.rejects(runPhotoWhiteJade(a), /配置/);
  assert.deepEqual(a.calls, []);
  const b = account(); b.items[5291].quantity = null;
  await assert.rejects(runPhotoWhiteJade(b), /库存/);
  assert.deepEqual(b.writes(), []);
  const c = account(); let n = 0;
  await assert.rejects(runPhotoWhiteJade({ ...c, now: () => ++n > 2 ? NOW + 1000000 : NOW }), /切期/);
  assert.deepEqual(c.writes(), []);
  const d = account();
  await assert.rejects(runPhotoWhiteJade({ ...d, send: async () => { const error = new Error('任务已停止'); error.stopped = true; throw error; } }), /停止/);
});
test('副本和小号任务共用已注册的白玉兑换入口', () => {
  const view = readFileSync(new URL('../src/views/BatchDailyTasks.vue', import.meta.url), 'utf8');
  assert.match(view.slice(view.indexOf('tab="小号任务"')), /@click="batchPhotoWhiteJade"/);
  assert.equal((view.match(/@click="batchPhotoWhiteJade"/g) || []).length, 2);
  assert.match(view, /batchPhotoWhiteJade,/);
  assert.equal(groupTaskCatalog([{ value: 'batchPhotoWhiteJade', label: '闲来入镜兑换白玉' }])[0].name, 'weekly');
});
