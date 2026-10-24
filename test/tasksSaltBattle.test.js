import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTasksSaltBattle } from '../src/utils/batch/tasksSaltBattle.js';
function fixture({ scheduled = false, reused = false, fail = false } = {}) {
  const calls = [], ref = value => ({ value }), now = Date.now();
  const deps = {
    selectedTokens: ref(['a', 'b']), tokens: ref([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]), tokenStatus: ref({}), isRunning: ref(scheduled), shouldStop: ref(false), currentRunningTokenId: ref(null), batchSettings: { saltBattle: { maxDiamondCost: 20, maxSpeedUps: 1, waitTimeoutSeconds: 60 } },
    isScheduled: () => scheduled, isScheduledSession: () => scheduled,
    ensureConnection: async (id, _tries, callback) => { calls.push(['connect', id]); callback(!reused); }, releaseConnectionSlot: () => calls.push(['release']),
    tokenStore: {
      getWebSocketClient: () => ({ getServerTime: () => now }),
      sendMessageWithPromise: async (id, cmd) => {
        calls.push([cmd, id]);
        if (cmd === 'legion_getbattlefield') return { info: { phase: 'phase1', battlefieldId: 'bf', canEnterWar: true, legionWarMapType: 1, readyTime: now / 1000 - 1, startTime: now / 1000 - 1, endTime: now / 1000 + 100 } };
        if (cmd === 'role_getroleinfo') return { role: { roleId: id === 'a' ? 100 : 200 } };
      }, closeWebSocketConnection: id => calls.push(['close', id]),
    }, addLog: () => {}, message: { info() {}, success() {}, warning() {} },
  };
  const overrides = {
    loadConfig: async () => ({ LegionWarMapTypeMappingConf: { 1: { legionWarMapType: 1, mapId: 1 } } }),
    openSession: async () => ({ enter: async id => calls.push(['enter', id]), close: () => calls.push(['sessionClose']) }),
    run: async context => { calls.push(['run', context.accountId, context.settings.maxDiamondCost]); if (fail && context.accountId === 'a') throw new Error('account A failed'); return { status: 'completed' }; },
    preview: async context => { calls.push(['preview', context.accountId]); return { battlefieldId: 'bf', targetId: '1_2' }; },
  };
  return { deps, calls, tasks: createTasksSaltBattle(deps, overrides) };
}
test('批量逐账号读取身份和会话；失败账号清理，后续账号仍执行', async () => {
  const f = fixture({ fail: true }); await f.tasks.batchSaltBattle();
  assert.deepEqual(f.calls.filter(c => c[0] === 'enter'), [['enter', 100], ['enter', 200]]);
  assert.equal(f.deps.tokenStatus.value.a, 'failed'); assert.equal(f.deps.tokenStatus.value.b, 'completed');
  assert.equal(f.calls.filter(c => c[0] === 'sessionClose').length, 2); assert.equal(f.calls.filter(c => c[0] === 'release').length, 2); assert.equal(f.deps.isRunning.value, false);
});
test('预览不调用执行器并保留各账号预览；复用连接不关闭', async () => {
  const f = fixture({ reused: true }); await f.tasks.previewSaltBattle();
  assert.equal(f.calls.some(c => c[0] === 'run'), false); assert.equal(f.calls.some(c => c[0] === 'close'), false);
  assert.deepEqual(f.tasks.saltBattlePreviews.value.map(r => r.tokenId), ['a', 'b']); assert.equal(f.tasks.saltBattlePreviewOpen.value, true);
});
test('定时入口使用独立预算，保留调度会话且不重置全局运行状态', async () => {
  const f = fixture({ scheduled: true }); await f.tasks.batchSaltBattle({ maxDiamondCost: 0 });
  assert.deepEqual(f.calls.filter(c => c[0] === 'run'), [['run', 'a', 0], ['run', 'b', 0]]);
  assert.equal(f.calls.some(c => c[0] === 'close'), false); assert.equal(f.deps.isRunning.value, true);
});
test('定时停止状态不被子任务清除', async () => {
  const f = fixture({ scheduled: true }); f.deps.shouldStop.value = true; await f.tasks.batchSaltBattle();
  assert.equal(f.calls.length, 0); assert.equal(f.deps.shouldStop.value, true);
});
