import test from 'node:test';
import assert from 'node:assert/strict';
import { createTasksFeudatory, getSaltMasterState, formatSaltMasterNotification } from '../src/utils/batch/tasksFeudatory.js';

function fixture(responses = { a: { role: { bossId: 123 } }, b: { role: { bossId: 0 } } }) {
  const calls = [], pushes = [], logs = [], closes = [], releases = [];
  const deps = {
    selectedTokens: { value: Object.keys(responses) },
    tokens: { value: Object.keys(responses).map(id => ({ id, name: `账号${id}`, server: '区服1', token: 'secret-token' })) },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null },
    batchSettings: { wxpusherEnabled: true, wxpusherAppToken: 'AT_test', wxpusherUids: 'UID_test', commandDelay: 0 },
    addLog: log => logs.push(log), message: { info() {}, warning() {}, error() {} }, sleep: async () => {},
    ensureConnection: async (id, retries, acquired, options) => {
      assert.deepEqual(options, { readOnly: true });
      calls.push(id); acquired(true);
      if (responses[id] instanceof Error) { acquired(false); throw responses[id]; }
      return responses[id];
    },
    releaseConnectionSlot: () => releases.push(true),
    tokenStore: { closeWebSocketConnection: id => closes.push(id), sendMessageWithPromise: async () => { throw Error('unexpected extra query'); } },
    sendWxPusherMessage: async (...args) => pushes.push(args),
  };
  return { deps, calls, pushes, logs, closes, releases, ...createTasksFeudatory(deps) };
}

test('客户端咸主规则bossId大于0；支持当前角色响应封装', () => {
  for (const response of [{ bossId: 7 }, { role: { bossId: 7 } }, { body: { role: { bossId: 7 } } }, { data: { role: { bossId: 7 } } }, { _raw: { body: { role: { bossId: 7 } } } }])
    assert.deepEqual(getSaltMasterState(response), { hasMaster: true, bossId: 7 });
  assert.deepEqual(getSaltMasterState({ role: { bossId: 0 } }), { hasMaster: false, bossId: 0 });
  for (const bossId of [undefined, null, '1', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => getSaltMasterState({ role: { bossId } }), /bossId/);
});

test('逐账号查询并仅推送有咸主清单，不泄露token', async () => {
  const f = fixture();
  const result = await f.batchCheckSaltMasters();
  assert.deepEqual(f.calls, ['a', 'b']);
  assert.equal(result.length, 2);
  assert.equal(f.pushes.length, 1);
  assert.match(f.pushes[0][2], /账号a.*123/);
  assert.ok(!f.pushes[0][2].includes('账号b'));
  assert.ok(!JSON.stringify(f.pushes).includes('secret-token'));
  assert.deepEqual(f.closes, ['a', 'b']);
  assert.equal(f.releases.length, 2);
  assert.equal(f.deps.isRunning.value, false);
  assert.equal(f.deps.currentRunningTokenId.value, null);
});

test('没有咸主或全部查询失败时不推送，失败不当作自由账号', async () => {
  for (const response of [{ role: { bossId: 0 } }, { role: {} }, new Error('connection failed')]) {
    const f = fixture({ a: response });
    await f.batchCheckSaltMasters();
    assert.equal(f.pushes.length, 0);
    assert.equal(f.deps.tokenStatus.value.a, response.role?.bossId === 0 ? 'completed' : 'failed');
  }
});

test('部分失败不影响其他账号结果，报告注明查询失败数', async () => {
  const f = fixture({ a: { role: {} }, b: { role: { bossId: 999 } } });
  await f.batchCheckSaltMasters();
  assert.equal(f.pushes.length, 1);
  assert.match(f.pushes[0][2], /1 个查询失败/);
  assert.match(f.pushes[0][2], /账号b/);
  assert.equal(f.deps.tokenStatus.value.a, 'failed');
});

test('WxPusher未启用或缺少配置时保留查询日志且不发送', async () => {
  for (const key of ['wxpusherEnabled', 'wxpusherAppToken', 'wxpusherUids']) {
    const f = fixture(); f.deps.batchSettings[key] = '';
    await f.batchCheckSaltMasters();
    assert.equal(f.pushes.length, 0);
    assert.ok(f.logs.some(log => log.message.includes('配置不完整')));
  }
});

test('定时按账号收集后统一推送一次，汇总去重', async () => {
  const f = fixture();
  const results = [];
  for (const id of ['a', 'b']) {
    f.deps.selectedTokens.value = [id];
    results.push(...await f.batchCheckSaltMasters({ deferPush: true }));
  }
  assert.equal(f.pushes.length, 0);
  await f.pushSaltMasterInfo([...results, results[0]]);
  assert.equal(f.pushes.length, 1);
  assert.match(f.pushes[0][1], /1个/);
});

test('停止后不启动下一个账号并清理已有连接', async () => {
  const f = fixture();
  const connect = f.deps.ensureConnection;
  f.deps.ensureConnection = async (...args) => { const res = await connect(...args); f.deps.shouldStop.value = true; return res; };
  await createTasksFeudatory(f.deps).batchCheckSaltMasters();
  assert.deepEqual(f.calls, ['a']);
  assert.deepEqual(f.closes, ['a']);
  assert.equal(f.deps.tokenStatus.value.b, 'stopped');
  assert.equal(f.pushes.length, 0);
});

test('复用外部连接不关闭也不释放别人的槽位', async () => {
  const f = fixture();
  f.deps.ensureConnection = async id => ({ role: { bossId: id === 'a' ? 1 : 0 } });
  await createTasksFeudatory(f.deps).batchCheckSaltMasters();
  assert.equal(f.closes.length, 0);
  assert.equal(f.releases.length, 0);
});

test('定时初始化没有角色字段时补一次角色查询，不发送游戏写指令', async () => {
  const f = fixture({ a: true });
  const commands = [];
  f.deps.tokenStore.sendMessageWithPromise = async (id, cmd, params) => { commands.push(cmd); assert.deepEqual(params, {}); return { role: { bossId: 321 } }; };
  await f.batchCheckSaltMasters();
  assert.deepEqual(commands, ['role_getroleinfo']);
  assert.equal(f.pushes.length, 1);
});

test('推送失败明确日志且任务状态与连接正常清理', async () => {
  const f = fixture();
  f.deps.sendWxPusherMessage = async () => { throw Error('push failed'); };
  // Factory captures the sender, so rebuild after configuring failure.
  await createTasksFeudatory(f.deps).batchCheckSaltMasters();
  assert.ok(f.logs.some(log => log.message.includes('推送失败')));
  assert.equal(f.deps.isRunning.value, false);
  assert.equal(f.releases.length, 2);
});

test('清单转义表格与HTML，失败账号不进入命中清单', () => {
  const report = formatSaltMasterNotification([
    { tokenId: 'a', name: '<img>|\nname', server: '区|服', bossId: 1, hasMaster: true },
    { tokenId: 'b', name: '错误账号', hasMaster: true, error: 'timeout' },
  ]);
  assert.equal(report.hits.length, 1);
  assert.ok(!report.content.includes('<img>'));
  assert.ok(report.content.includes('&lt;img&gt;\\| name'));
  assert.ok(!report.content.includes('错误账号'));
});

test('页面只读连接初始化仅查询角色，失败不被初始化逻辑吞掉', async () => {
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../src/views/BatchDailyTasks.vue', import.meta.url), 'utf8');
  const start = source.indexOf('const ensureConnection = async');
  const end = source.indexOf('// 任务模块使用的会话感知依赖', start);
  for (const fail of [false, true]) {
    const commands = [];
    const role = { role: { bossId: 88 } };
    const connect = runInNewContext(`${source.slice(start, end)}\nensureConnection`, {
      tokens: { value: [{ id: 'a', token: 'secret' }] },
      isScheduledTokenSession: () => false,
      tokenStore: {
        getWebSocketStatus: () => 'connected',
        sendMessageWithPromise: async (id, cmd) => { commands.push(cmd); if (fail) throw Error('role query failed'); return role; },
      },
      addLog() {},
    });
    if (fail) await assert.rejects(connect('a', 2, null, { readOnly: true }), /role query failed/);
    else assert.equal(await connect('a', 2, null, { readOnly: true }), role);
    assert.deepEqual(commands, ['role_getroleinfo']);
  }
});
