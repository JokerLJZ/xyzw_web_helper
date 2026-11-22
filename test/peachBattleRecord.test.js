import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePeachLegionId } from '../src/utils/peachBattleRecord.js';
test('俱乐部详情遵循官方绝对值ID规则', () => {
  assert.equal(normalizePeachLegionId(-123), 123);
  assert.equal(normalizePeachLegionId('456'), 456);
});
test('无俱乐部或无效ID不发送详情查询', () => {
  for (const value of [0, undefined, null, 'bad', 1.2]) assert.throws(() => normalizePeachLegionId(value));
});
