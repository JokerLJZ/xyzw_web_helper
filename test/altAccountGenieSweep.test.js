import test from 'node:test';
import fs from 'node:fs';
const config = JSON.parse(fs.readFileSync(new URL('./fixtures/genieSweepConfig.json', import.meta.url)));
const target = role => getAltGenieSweepTarget(role, config);
import assert from 'node:assert/strict';
import { getAltGenieSweepTarget, sweepAltAccountGenie, readGenieRole, hasFreeGenieSweep, loadGenieSweepConfig } from '../src/utils/altAccountGenieSweep.js';
const role = (index, quantity) => ({ levelId: 3000, genie: { 4: index }, items: { 1021: { quantity } }, statistics: { 'genie:daily:free:4': 1 }, statisticsTime: { 'genie:daily:free:4': Date.now() / 1000 } });
const run = (states, options = {}) => {
  const calls = [];
  const result = sweepAltAccountGenie({ loadConfig: async () => config, queryRole: async () => states.shift(), sendSweep: async p => { calls.push(p); return { role: { gold: 1 } }; }, shouldStop: () => false, sleep: async () => {}, log: () => {}, ...options });
  return { result, calls };
};
test('11层边界、最高阵营、排除深海与非法数据', () => {
  assert.equal(target(role(9, 10)), null);
  assert.deepEqual(target(role(10, 10)), { genieId: 4, layer: 11 });
  assert.deepEqual(target({ genie: { 1: 10, 2: 12, 3: null, 4: '15', 5: 20 } }), { genieId: 2, layer: 13 });
});
test('未开放、未达11层、无魔毯均不消耗', async () => {
  for (const data of [{ ...role(10, 1), levelId: 2999 }, role(9, 1), role(10, 0)]) {
    const { result, calls } = run([data]); await result; assert.equal(calls.length, 0);
  }
});
test('分批20次并重查库存，忽略增量响应缺少items', async () => {
  const { result, calls } = run([role(10, 43), role(10, 23), role(10, 3), role(10, 0)]);
  await result; assert.deepEqual(calls.map(p => p.sweepCnt), [20, 20, 3]);
});
test('先领取免费单次并核实统计，再使用魔毯', async () => {
  const free = role(10, 2); free.statistics = {}; free.statisticsTime = {};
  const { result, calls } = run([free, role(10, 2), role(10, 0)]);
  await result; assert.deepEqual(calls.map(p => p.sweepCnt), [1, 2]);
});
test('免费次数按GMT8跨日重置', () => {
  const data = role(10, 2); data.statisticsTime['genie:daily:free:4'] = Date.parse('2026-11-06T15:59:59Z') / 1000;
  assert.equal(hasFreeGenieSweep(data, 4, Date.parse('2026-11-06T16:00:00Z')), true);
});
test('库存不变或缺失时停止，不能当成耗尽', async () => {
  for (const next of [role(10, 5), { levelId: 3000, genie: { 4: 10 } }]) {
    const { result, calls } = run([role(10, 5), next]); await assert.rejects(result); assert.equal(calls.length, 1);
  }
});
test('写请求超时后查询，但不重发', async () => {
  let queries = 0, writes = 0;
  const { result } = run([], { queryRole: async () => { queries++; return role(10, queries === 1 ? 5 : 0); }, sendSweep: async () => { writes++; throw new Error('timeout'); } });
  await assert.rejects(result, /timeout/); assert.equal(queries, 2); assert.equal(writes, 1);
});
test('停止后不发请求，不复用其他账号库存', async () => {
  const stopped = run([role(10, 5)], { shouldStop: () => true }); await stopped.result; assert.equal(stopped.calls.length, 0);
  const empty = run([role(10, 0)]); await empty.result; assert.equal(empty.calls.length, 0);
  assert.throws(() => readGenieRole({}), /未取得/);
  const data = role(10, 0); assert.equal(readGenieRole({ data: { role: data } }), data);
});

test('层数达标但奖励不足、奖励类型不符或配置缺失均不可扫荡', () => {
  const copy = structuredClone(config);
  copy.genieLevelConf[4011].stayFixedReward[1].value = 2;
  assert.equal(getAltGenieSweepTarget(role(10, 1), copy), null);
  copy.genieLevelConf[4011].stayFixedReward[1] = { type: 3, itemId: 1023, value: 3 };
  assert.equal(getAltGenieSweepTarget(role(10, 1), copy), null);
  assert.equal(getAltGenieSweepTarget(role(10, 1), {}), null);
});

test('按账号返回的配置版本加载奖励，下载失败不缓存', async () => {
  let requests = 0;
  const send = async (cmd, params) => {
    assert.equal(cmd, 'system_getdatabundlever'); assert.deepEqual(params, { isAudit: false });
    return { body: { dataBundleVer: 'genie-test-version' } };
  };
  await assert.rejects(loadGenieSweepConfig(send, async () => ({ ok: false })), /下载失败/);
  const loaded = await loadGenieSweepConfig(send, async url => {
    requests++; assert.match(url, /genie-test-version\/config_ap.json$/);
    return { ok: true, json: async () => config };
  });
  assert.equal(loaded, config); assert.equal(requests, 1);
  await assert.rejects(loadGenieSweepConfig(async () => ({})), /配置版本/);
});
