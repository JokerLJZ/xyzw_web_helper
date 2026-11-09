import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_GROUPS, groupTaskCatalog } from '../src/utils/batch/taskCatalog.js';
import { availableTasks } from '../src/utils/batch/constants.js';

test('全部已批准任务及兼容任务各归一组，定时可选任务无遗漏', () => {
  const defined = TASK_GROUPS.flatMap(group => group.tasks);
  assert.equal(TASK_GROUPS.length, 12);
  assert.equal(defined.length, 97);
  assert.equal(new Set(defined).size, defined.length);
  const grouped = groupTaskCatalog(availableTasks);
  assert.ok(!grouped.some(group => group.name === 'other'));
  assert.deepEqual(grouped.flatMap(group => group.tasks.map(task => task.value)).sort(), availableTasks.map(task => task.value).sort());
});

test('小号28项只归小号组，藏品及卡牌领奖归武将与图鉴', () => {
  const small = TASK_GROUPS.find(group => group.name === 'small-account');
  assert.equal(small.tasks.length, 28);
  assert.ok(small.tasks.includes('batchAltGenieSweep'));
  assert.ok(small.tasks.includes('batchAutoFeudatory'));
  const grouped = groupTaskCatalog(availableTasks);
  for (const group of grouped.filter(group => group.name !== 'small-account')) {
    assert.ok(group.tasks.every(task => !small.tasks.includes(task.value)));
  }
  const growth = grouped.find(group => group.name === 'growth');
  assert.equal(growth.label, '武将与图鉴');
  assert.ok(['batchClaimCollectionRewards', 'batchClaimCardCollectionRewards'].every(id => growth.tasks.some(task => task.value === id)));
  assert.equal(grouped.find(group => group.name === 'resource').label, '资源管理');
});

test('分组搜索仍可找到已移动任务，且不会重复展示', () => {
  const small = groupTaskCatalog(availableTasks, '小号任务');
  assert.deepEqual(small.map(group => group.name), ['small-account']);
  assert.ok(small[0].tasks.some(task => task.value === 'batchPhotoWhiteJade'));
  assert.deepEqual(groupTaskCatalog(availableTasks, '卡牌图鉴').map(group => group.name), ['growth']);
});

test('未来新增未归类任务显示在其他，不能静默丢失', () => {
  const task = { value: 'futureBatchTask', label: '未来任务' };
  assert.deepEqual(groupTaskCatalog([...availableTasks, task]).find(group => group.name === 'other').tasks, [task]);
});
