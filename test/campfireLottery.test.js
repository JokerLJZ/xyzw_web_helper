import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCampfireLottery } from '../src/utils/campfireLottery.js';
import { availableTasks } from '../src/utils/batch/constants.js';
import { groupTaskCatalog } from '../src/utils/batch/taskCatalog.js';

function fixture(options = {}) {
  const chests = [1, 2, 3].map(id => ({ id, drawCost: { type: 3, itemId: 41004, value: options.costs?.[id - 1] ?? 10 } }));
  const config = { ClubWarConstantConf: { chestItemId: 41004 }, ClubWarChestConf: chests };
  let stock = Object.hasOwn(options, "stock") ? options.stock : 35, boxId = options.boxId ?? 1;
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  const calls = [], logs = [];
  const send = async (cmd, params) => {
    calls.push([cmd, params]);
    if (options.stop && calls.filter(([cmd]) => cmd === 'club_draw').length) { const error = new Error('任务已停止'); error.stopped = true; throw error; }
    if (cmd === 'role_getroleinfo') return { role: { roleId: 123, items: options.map ? new Map([[41004, { quantity: stock }]]) : { 41004: { quantity: stock } } } };
    if (cmd === 'club_getinfo') return { siege: { roleId: options.wrongRole ? 456 : 123, boxId } };
    if (cmd === 'club_draw') {
      assert.deepEqual(params, {});
      if (options.reject) { const error = new Error('服务器明确拒绝'); error.serverRejected = true; throw error; }
      if (!options.noEffect) {
        stock -= config.ClubWarChestConf.find(row => row.id === boxId).drawCost.value;
        boxId = boxId === 3 ? 1 : boxId + 1;
      }
      if (options.timeout) throw new Error('请求超时');
      return { role: { gold: 1 }, siege: { boxId } }; // Sparse write response must not replace full inventory.
    }
    throw new Error(cmd);
  };
  const context = { id: 'account1', send, config, storage, log: text => logs.push(text) };
  return { ...context, calls, store, logs, options, state: () => ({ stock, boxId }), draws: () => calls.filter(([cmd]) => cmd === 'club_draw'), run: () => runCampfireLottery(context) };
}

test('用现有道具逐次抽完，支持满级回到1级，保留不足一次的余量', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { status: 'completed', draws: 3, spent: 30, remaining: 5, reason: '篝火抽奖3次，消耗30个种火石，剩余5个' });
  assert.equal(f.draws().length, 3);
  assert.deepEqual(f.state(), { stock: 5, boxId: 1 });
  assert.equal(f.store.size, 0);
  assert.equal((await f.run()).status, 'skipped');
  assert.equal(f.draws().length, 3);
});

test('使用当前等级配置消耗而非固定10颗，Map库存也可确认', async () => {
  const f = fixture({ stock: 31, costs: [5, 15, 10], map: true });
  const result = await f.run();
  assert.equal(result.draws, 3);
  assert.equal(result.remaining, 1);
});

test('无道具或不足一次不发送抽奖，各账号库存独立', async () => {
  for (const stock of [0, 9]) { const f = fixture({ stock }); assert.equal((await f.run()).status, 'skipped'); assert.equal(f.draws().length, 0); }
  const f = fixture({ stock: 20 }); assert.equal((await f.run()).draws, 2);
});

test('缺失等级、身份冲突和异常数量均阻止消耗', async () => {
  for (const options of [{ boxId: 0 }, { wrongRole: true }, { stock: null }, { stock: -1 }]) {
    const f = fixture(options);
    await assert.rejects(f.run(), /异常|等级|身份/);
    assert.equal(f.draws().length, 0);
  }
});

test('不是种火石的支付配置或重复等级时，不请求游戏', async () => {
  for (const duplicate of [true, false]) {
    const f = fixture();
    if (duplicate) f.config.ClubWarChestConf.push(f.config.ClubWarChestConf[0]);
    else f.config.ClubWarChestConf[0].drawCost.type = 1;
    await assert.rejects(f.run(), /重复|不是种火石/);
    assert.deepEqual(f.calls, []);
  }
});

test('加奖或库存不变不能被误认成功，保留记录并阻止重跑再消耗', async () => {
  const f = fixture({ noEffect: true });
  await assert.rejects(f.run(), /未确认/);
  assert.equal(f.draws().length, 1);
  assert.equal(f.store.size, 1);
  await assert.rejects(f.run(), /上次.*待核实/);
  assert.equal(f.draws().length, 1);
});

test('请求超时只补查不重发，下次执行先确认上次扣除与等级再继续', async () => {
  const f = fixture({ timeout: true });
  await assert.rejects(f.run(), /不自动重试/);
  assert.equal(f.draws().length, 1);
  assert.equal(f.store.size, 1);
  assert.deepEqual(f.state(), { stock: 25, boxId: 2 });
  f.options.timeout = false;
  assert.equal((await f.run()).draws, 2);
  assert.equal(f.draws().length, 3);
  assert.equal(f.store.size, 0);
});

test('明确拒绝不自动重试，清除未发生成本的标记以便后续手动重查', async () => {
  const f = fixture({ reject: true });
  await assert.rejects(f.run(), /不自动重试/);
  assert.equal(f.draws().length, 1);
  assert.equal(f.store.size, 0);
});

test('用户停止后不发下一次抽奖，保留待确认记录', async () => {
  const f = fixture({ stop: true });
  await assert.rejects(f.run(), /停止/);
  assert.equal(f.draws().length, 1);
  assert.equal(f.store.size, 1);
});

test('记录保存失败在抽奖前停止', async () => {
  const f = fixture();
  f.storage.setItem = () => { throw new Error('storage full'); };
  await assert.rejects(f.run(), /storage full/);
  assert.equal(f.draws().length, 0);
});

test('读取不到完整库存或本人快照时停止，不能使用写响应猜库存', async () => {
  for (const invalid of ['role_getroleinfo', 'club_getinfo']) {
    const f = fixture();
    await assert.rejects(runCampfireLottery({ ...f, send: (cmd, p) => cmd === invalid ? Promise.resolve({}) : f.send(cmd, p) }));
    assert.equal(f.draws().length, 0);
  }
});

test('注册批量和定时入口，含抽奖的定时任务不做失败自动补跑', () => {
  assert.ok(availableTasks.some(row => row.value === 'batchCampfireLottery'));
  assert.ok(groupTaskCatalog(availableTasks).find(row => row.name === 'club').tasks.some(row => row.value === 'batchCampfireLottery'));
  const view = readFileSync(new URL('../src/views/BatchDailyTasks.vue', import.meta.url), 'utf8');
  assert.match(view, /@click="batchCampfireLottery"/);
  assert.match(view.slice(view.indexOf('const getScheduledTaskFunction')), /batchCampfireLottery,/);
  assert.match(view, /\["batchCheerShopPurchase", "batchCampfireLottery", "batchAutoFeudatory"\]\.includes\(name\)/);
});
