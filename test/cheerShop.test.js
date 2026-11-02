import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheerShopPurchase } from '../src/utils/cheerShop.js';
import { groupTaskCatalog } from '../src/utils/batch/taskCatalog.js';
import { availableTasks } from '../src/utils/batch/constants.js';
function account({ balance = 100, bought = {}, timeout = false, confirm = true } = {}) {
  const calls = [];
  const send = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === 'legion_storegoodslist') return { buyGoods: { ...bought } };
    if (cmd === 'role_getroleinfo') return { role: { items: { 2101: { quantity: balance } } } };
    if (confirm) { bought[params.id] = (bought[params.id] || 0) + params.num; balance -= params.num * 20; }
    if (timeout) throw new Error('timeout');
    // Reward responses may omit role/items. Confirmation must use a fresh query.
    return { reward: [] };
  };
  return { send, calls };
}
const writes = a => a.calls.filter(c => c.cmd === 'legion_storebuygoods');
test('uses current account stock, configured cumulative target and official wire fields', async () => {
  const a = account({ balance: 60, bought: { 10: 2 } });
  await runCheerShopPurchase({ send: a.send, purchases: { 10: 6 } });
  assert.deepEqual(writes(a), [{ cmd: 'legion_storebuygoods', params: { id: 10, num: 3 } }]);
});
test('repeated run skips already reached target; accounts have independent balances', async () => {
  const a = account({ balance: 100 });
  await runCheerShopPurchase({ send: a.send, purchases: { 7: 1 } });
  await runCheerShopPurchase({ send: a.send, purchases: { 7: 1 } });
  const b = account({ balance: 0 });
  await runCheerShopPurchase({ send: b.send, purchases: { 7: 1 } });
  assert.equal(writes(a).length, 1);
  assert.equal(writes(b).length, 0);
});
test('timeout checks status and does not repeat the purchase', async () => {
  const a = account({ timeout: true });
  await runCheerShopPurchase({ send: a.send, purchases: { 7: 1 } });
  assert.equal(writes(a).length, 1);
  const b = account({ timeout: true, confirm: false });
  await assert.rejects(runCheerShopPurchase({ send: b.send, purchases: { 7: 1, 8: 1 } }), /不自动重试/);
  assert.equal(writes(b).length, 1);
});
test('missing quota, missing inventory, invalid targets and unconfirmed results stop writes', async () => {
  await assert.rejects(runCheerShopPurchase({ send: async () => ({}), purchases: { 7: 1 } }), /限购状态/);
  await assert.rejects(runCheerShopPurchase({ send: async () => ({ buyGoods: {} }), purchases: { 7: 1 } }), /库存/);
  const a = account();
  await assert.rejects(runCheerShopPurchase({ send: a.send, purchases: { 7: 2 } }), /限购范围/);
  assert.equal(a.calls.length, 0);
  const b = account({ confirm: false });
  await assert.rejects(runCheerShopPurchase({ send: b.send, purchases: { 7: 1, 8: 1 } }), /未按预期/);
  assert.equal(writes(b).length, 1);
});
test('stop before purchase never sends a write', async () => {
  const a = account(); let stopped = false;
  await runCheerShopPurchase({ send: a.send, purchases: { 7: 1 }, wait: async () => { stopped = true; }, shouldStop: () => stopped });
  assert.equal(writes(a).length, 0);
});
test('catalog puts every task in one group and searches labels and groups', () => {
  const groups = groupTaskCatalog(availableTasks);
  const ids = groups.flatMap(g => g.tasks.map(t => t.value));
  assert.equal(ids.length, availableTasks.length);
  assert.equal(new Set(ids).size, availableTasks.length);
  assert.ok(groups.find(g => g.name === 'monthly').tasks.some(t => t.value === 'batchCheerShopPurchase'));
  assert.ok(groupTaskCatalog(availableTasks, '月度').every(g => g.name === 'monthly'));
  assert.ok(groupTaskCatalog(availableTasks, '白玉').flatMap(g => g.tasks).some(t => t.value === 'legionStoreBuyWhiteJade'));
});

test('confirmed task assignments override keyword classification', () => {
  const groups = groupTaskCatalog(availableTasks);
  const groupOf = id => groups.find(group => group.tasks.some(task => task.value === id))?.name;
  assert.equal(groupOf('batchCheckSaltMasters'), 'growth');
  assert.equal(groupOf('batchJoinLegion'), 'growth');
  assert.equal(groupOf('skinChallenge'), 'weekly');
  assert.equal(groups.find(group => group.name === 'resource').label, '资源管理');
});

test('pearl purchases belong to growth and standalone combined purchase is removed', () => {
  const groups = groupTaskCatalog(availableTasks);
  const growth = groups.find(group => group.name === 'growth').tasks.map(task => task.value);
  for (const id of ['batchBuyRedFeatherWithPearls', 'batchBuyBaguaWithPearls', 'batchBuyPearlFish']) assert.ok(growth.includes(id));
  assert.ok(!availableTasks.some(task => task.value === 'batchBuyRedFragmentsAndPetCookies'));
  assert.equal(availableTasks.find(task => task.value === 'legionStoreBuyWhiteJade').label, '盐锭购买白玉');
});
