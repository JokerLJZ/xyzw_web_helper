import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTokenClubInfo, getClubOptions, getClubTokenIds } from '../src/utils/tokenClubInfo.js';
test('按当前角色俱乐部ID核对详情，避免保存其他账号或过期信息', async () => {
  const calls = [];
  const result = await fetchTokenClubInfo(async cmd => {
    calls.push(cmd);
    return cmd === 'role_getroleinfo' ? { role: { legionId: 123 } } : { info: { id: 123, name: '测试俱乐部' } };
  });
  assert.equal(result.id, '123');
  assert.equal(result.name, '测试俱乐部');
  assert.deepEqual(calls, ['role_getroleinfo', 'legion_getinfo']);
  await assert.rejects(fetchTokenClubInfo(async cmd => cmd === 'role_getroleinfo' ? { role: { legionId: 123 } } : { info: { id: 456, name: '其他俱乐部' } }), /已变化/);
});
test('明确未入会时清空，缺字段或错误不产生可保存结果', async () => {
  let calls = 0;
  const result = await fetchTokenClubInfo(async () => { calls++; return { role: { legionId: 0 } }; });
  assert.equal(result.id, null);
  assert.equal(calls, 1);
  await assert.rejects(fetchTokenClubInfo(async () => ({ role: {} })), /未取得/);
  await assert.rejects(fetchTokenClubInfo(async () => ({ code: 123 })), /123/);
});
test('同名不同ID不合并，未获取与明确未入会分开', () => {
  const tokens = [ { id:'a', clubInfo:{ id:'1', name:'同名' } }, { id:'b', clubInfo:{ id:'2', name:'同名' } }, { id:'c', clubInfo:{ id:null, name:'' } }, { id:'d' } ];
  assert.equal(getClubOptions(tokens).length, 3);
  assert.deepEqual(getClubTokenIds(tokens, '1'), ['a']);
  assert.deepEqual(getClubTokenIds(tokens, 'none'), ['c']);
});
