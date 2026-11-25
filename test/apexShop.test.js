import test from 'node:test';
import assert from 'node:assert/strict';
import { apexExchangeCount, runApexShop } from '../src/utils/apexShop.js';
const good = { id: 1, order: 1, limitNum: 25, buyPrice: [{ type: 3, itemId: 16002, value: 20 }] };
test('按余额、限购余量及单次上限计算兑换数量', () => {
  assert.equal(apexExchangeCount(good, 55, 0), 2);
  assert.equal(apexExchangeCount(good, 1000, 24), 1);
  assert.equal(apexExchangeCount(good, 19, 0), 0);
  assert.equal(apexExchangeCount({ ...good, limitNum: 0 }, 999999, 0), 9999);
});
test('超时后仅确认状态，不重复消耗', async () => {
  const writes = [];
  await assert.rejects(runApexShop({ selected: [1], loadConfig: async () => ({ ApexShopConf: [good] }), send: async (cmd, p) => {
    if (cmd === 'apex_getroleinfo') return { apexRoleInfo: { buyRecord: {} } };
    if (cmd === 'role_getroleinfo') return { role: { items: { 16002: { quantity: 100 } } } };
    writes.push(p); throw new Error('timeout');
  } }), /未确认/);
  assert.deepEqual(writes, [{ shopId: 1, buyCnt: 5 }]);
});
test('已确认兑换后重新查询库存并在余额不足时结束', async () => {
  let bought = 0;
  await runApexShop({ selected: [1], loadConfig: async () => ({ ApexShopConf: [good] }), send: async (cmd, p) => {
    if (cmd === 'apex_getroleinfo') return { apexRoleInfo: { buyRecord: { 1: bought } } };
    if (cmd === 'role_getroleinfo') return { role: { items: { 16002: { quantity: 100 - bought * 20 } } } };
    bought += p.buyCnt; return {};
  } });
  assert.equal(bought, 5);
});
