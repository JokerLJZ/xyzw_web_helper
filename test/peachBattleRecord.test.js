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
import { peachLineupRow, peachRecordStyle } from '../src/utils/peachBattleRecord.js';
test('前两站位与后三站位分行且异常站位不丢失', () => {
  assert.deepEqual([0,1,2,3,4].map(peachLineupRow), ['front','front','back','back','back']);
  assert.equal(peachLineupRow(undefined), 'back');
});
test('旧版或无效样式恢复可显示的默认战报', () => {
  for (const value of [null, '', 'old']) assert.equal(peachRecordStyle(value), 'default');
  assert.equal(peachRecordStyle('style2'), 'style2');
});
