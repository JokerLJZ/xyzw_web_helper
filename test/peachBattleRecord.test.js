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
import { formatPower, getMaxKills, getPercent } from '../src/utils/peachBattleRecord.js';
import fs from 'node:fs';
import { parse, compileScript } from '@vue/compiler-sfc';
test('战报战力和击杀条处理真实数值及空记录', () => {
  assert.equal(formatPower(12180000000), '121.8亿');
  assert.equal(formatPower(undefined), '0');
  assert.equal(getMaxKills({killRank:[{killCnt:5},{killCnt:20}]}), 20);
  assert.equal(getPercent(5,20),25);
  assert.equal(getPercent(0,getMaxKills(null)),0);
  assert.equal(getPercent(30,20),100);
});
test('三种战报模板使用的展示函数必须绑定到组件', () => {
  const source = fs.readFileSync(new URL('../src/components/Club/PeachBattleRecords.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const { bindings } = compileScript(descriptor, {id:'peach-record-regression'});
  for (const name of [...new Set([...descriptor.template.content.matchAll(/(?<![.\w])([A-Za-z_$][\w$]*)\(/g)].map(match => match[1]))]) {
    assert.ok(descriptor.template.content.includes(`${name}(`));
    assert.ok(bindings[name], `${name}缺失会导致成功加载数据后渲染空白`);
  }
});

import { getKillColor, getReviveColor } from '../src/utils/peachBattleRecord.js';
test('样式一双方成员的击杀与复活底色支持空值和有效计数', () => {
  for (const color of [getKillColor, getReviveColor]) {
    for (const value of [undefined, null, 0, -1, 'bad', Infinity]) assert.equal(color(value), 'transparent');
    assert.match(color(5), /^rgba\(/);
    assert.equal(color('5'), color(5));
  }
});
