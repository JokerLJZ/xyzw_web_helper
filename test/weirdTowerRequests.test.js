import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWeirdTowerRequester, createWeirdTowerStartGate, serverErrorCode } from '../src/utils/weirdTowerRequests.js';

function timer() {
  let time = 0;
  const waits = [];
  return { now: () => time, advance: ms => { time += ms; }, waits,
    pause: async ms => { waits.push(ms); time += ms; } };
}

test('请求串行并按上次响应完成补足800ms，包含初始化与配置请求', async () => {
  const t = timer(), sent = [];
  const request = createWeirdTowerRequester({ ...t, send: async cmd => { sent.push([cmd, t.now()]); t.advance(200); return {}; } });
  await Promise.all(['role_getroleinfo', 'system_getdatabundlever', 'evotower_getinfo'].map(cmd => request(cmd)));
  assert.deepEqual(sent, [['role_getroleinfo', 0], ['system_getdatabundlever', 1000], ['evotower_getinfo', 2000]]);
});

test('500ms战后等待不再叠加请求间隔', async () => {
  const t = timer(), sent = [];
  const request = createWeirdTowerRequester({ ...t, send: async cmd => { sent.push([cmd, t.now()]); return {}; } });
  await request('evotower_fight');
  await t.pause(500);
  await request('evotower_getinfo');
  assert.deepEqual(sent, [['evotower_fight', 0], ['evotower_getinfo', 500]]);
  assert.equal(t.waits.length, 1);
});

test('错误包含阶段命令错误码间隔和账号数，不输出请求参数且不自动重试或冷却', async () => {
  for (const code of [400340, 200400]) {
    const t = timer(), sent = [];
    const request = createWeirdTowerRequester({ ...t, activeCount: () => 2,
      send: async cmd => { sent.push([cmd, t.now()]); if (cmd === 'mergebox_openbox') throw Object.assign(new Error(`服务器错误: ${code}`), { code }); return {}; } });
    await request('evotower_getinfo');
    await assert.rejects(request('mergebox_openbox', { token: 'SECRET', url: 'wss://secret' }, 5000, { phase: '使用钥匙' }), error => {
      assert.equal(error.code, code); assert.equal(error.cmd, 'mergebox_openbox'); assert.equal(error.phase, '使用钥匙');
      assert.match(error.message, /请求间隔=800ms，活跃账号=2/); assert.doesNotMatch(error.message, /SECRET|wss:/); return true;
    });
    await request('mergebox_getinfo');
    assert.deepEqual(sent, [['evotower_getinfo', 0], ['mergebox_openbox', 800], ['mergebox_getinfo', 1600]]);
  }
});

test('错误码兼容数字字符串与旧错误文本且不匹配相似码', () => {
  assert.equal(serverErrorCode({ code: '400340' }), 400340);
  assert.equal(serverErrorCode(new Error('服务器错误: 400340 - 操作过快')), 400340);
  assert.equal(serverErrorCode(new Error('400340')), 400340);
  assert.equal(serverErrorCode(new Error('服务器错误: 1400340')), 1400340);
  assert.equal(serverErrorCode(new Error('查询400340条失败')), undefined);
});

test('停止中断节流等待，阵容恢复仍补足间隔且只发送一次', async () => {
  const t = timer(), sent = []; let stopped = false;
  const request = createWeirdTowerRequester({ ...t, stopped: () => stopped,
    pause: async ms => { await t.pause(ms); stopped = true; }, send: async cmd => { sent.push([cmd, t.now()]); return {}; } });
  await request('evotower_readyfight');
  await assert.rejects(request('evotower_fight'), error => error.stopped === true);
  assert.deepEqual(sent, [['evotower_readyfight', 0]]);
  await request('presetteam_saveteam', {}, 5000, { phase: '恢复阵容', allowStopped: true });
  assert.deepEqual(sent, [['evotower_readyfight', 0], ['presetteam_saveteam', 800]]);
});

test('三个账号启动依次错开1秒，耗时足够时不额外等待', async () => {
  const t = timer(), starts = [], gate = createWeirdTowerStartGate(t);
  await Promise.all([1, 2, 3].map(async id => { await gate(); starts.push([id, t.now()]); }));
  assert.deepEqual(starts, [[1, 0], [2, 1000], [3, 2000]]);
  t.advance(1500); const before = t.waits.length;
  await gate(); assert.equal(t.waits.length, before);
});

test('账号错峰等待可停止，排队账号不再启动', async () => {
  const t = timer(); let stopped = false;
  const gate = createWeirdTowerStartGate({ ...t, stopped: () => stopped, pause: async ms => { await t.pause(ms); stopped = true; } });
  await gate();
  await assert.rejects(gate(), error => error.stopped);
  await assert.rejects(gate(), error => error.stopped);
  assert.equal(t.now(), 100);
});

test('爬塔三步间隔500ms，独立查询仍等待800ms', async () => {
  const t = timer(), sent = [];
  const request = createWeirdTowerRequester({ ...t, send: async cmd => { sent.push([cmd, t.now()]); t.advance(200); return {}; } });
  await request('evotower_readyfight');
  await request('evotower_fight');
  await t.pause(500);
  await request('evotower_getinfo');
  await request('evotower_readyfight');
  await request('evotower_getinfo');
  assert.deepEqual(sent, [['evotower_readyfight', 0], ['evotower_fight', 700], ['evotower_getinfo', 1400], ['evotower_readyfight', 2100], ['evotower_getinfo', 3100]]);
});
