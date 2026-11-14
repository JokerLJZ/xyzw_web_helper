import test from 'node:test';
import assert from 'node:assert/strict';
import { runPetMerge, selectPetMergePair } from '../src/utils/petMerge.js';
import { createPetTasks } from '../src/utils/batch/tasksPet.js';
const pet = (uId, petId = 101) => ({ uId, petId, level: 1, isLocked: false });
const fixture = () => ({ levelId: 6500, pet: { petUId: 'worn' }, items: {}, petData: {
  pets: { '-1': pet('worn'), 1: pet('partner', 102) }, books: { 201: 0 }, bookReward: {},
} });

test('小号卸下有同色配对的佩戴宠物，确认完整列表后才合成', async () => {
  let role = fixture(); const calls = [];
  const result = await runPetMerge({ includeEquipped: true, getRole: async () => structuredClone(role),
    load: async params => {
      calls.push(['load', params]); role.petData.pets[2] = role.petData.pets[-1];
      delete role.petData.pets[-1]; role.pet = {};
    },
    send: async params => {
      calls.push(['merge', params]); role.petData.pets = { 1: pet('merged', 201) };
      return { isSuccess: true };
    },
  });
  assert.deepEqual(calls[0], ['load', { slotUId: { slot: 2, uId: '' } }]);
  assert.equal(calls[1][0], 'merge');
  assert.equal(calls[1][1].fromSlotUId.uId, 'worn');
  assert.equal(result.count, 1);
});

test('普通合成及锁定、无配对、超品质范围的小号宠物不卸下', async () => {
  for (const mode of ['normal', 'locked', 'unknownLock', 'noPartner', 'outOfRange']) {
    const role = fixture();
    if (mode === 'locked') role.petData.pets[-1].isLocked = true;
    if (mode === 'unknownLock') delete role.petData.pets[-1].isLocked;
    if (mode === 'noPartner') role.petData.pets[1].petId = 201;
    if (mode === 'outOfRange') { role.petData.pets[-1].petId = 501; role.petData.pets[1].petId = 502; }
    await runPetMerge({ includeEquipped: mode !== 'normal', getRole: async () => role,
      load: async () => assert.fail('不应卸下'), send: async () => assert.fail('不应合成') });
  }
  const role = fixture(); role.petData.pets[2] = pet('worn'); delete role.pet;
  assert.equal(selectPetMergePair(role), null, '装备槽编号优先保护普通合成');
});

test('卸下超时或状态不符均停止且不继续合成；等待中停止不卸下', async () => {
  for (const fail of ['timeout', 'unchanged']) {
    let calls = 0;
    await assert.rejects(runPetMerge({ includeEquipped: true, getRole: async () => fixture(),
      load: async () => { calls++; if (fail === 'timeout') throw Error('timeout'); },
      send: async () => assert.fail('不能继续合成') }));
    assert.equal(calls, 1);
  }
  let stop = false;
  await runPetMerge({ includeEquipped: true, getRole: async () => fixture(), shouldStop: () => stop,
    wait: async () => { stop = true; }, load: async () => assert.fail(), send: async () => assert.fail() });
});

test('满槽先合成腾位，之后卸下佩戴宠物；不能腾位时不购买槽位', async () => {
  let role = fixture();
  for (let i = 2; i <= 8; i++) role.petData.pets[i] = pet(`p${i}`, 201);
  const events = [];
  await runPetMerge({ includeEquipped: true, getRole: async () => structuredClone(role),
    send: async p => { events.push('merge'); delete role.petData.pets[p.fromSlotUId.slot]; return { isSuccess: false }; },
    load: async p => { events.push('load'); role.petData.pets[p.slotUId.slot] = role.petData.pets[-1]; delete role.petData.pets[-1]; role.pet = {}; },
  });
  assert.deepEqual(events.slice(0, 2), ['merge', 'load']);
  role = fixture();
  for (let i = 2; i <= 8; i++) role.petData.pets[i] = { ...pet(`p${i}`), isLocked: true };
  await runPetMerge({ includeEquipped: true, getRole: async () => role,
    send: async () => assert.fail(), load: async () => assert.fail() });
});

test('小号完整任务按合成、图鉴激活领奖、佩戴顺序执行，不重生或升级；失败不进入后续步骤', async t => {
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  for (const fail of [false, true]) {
    const role = fixture(), calls = []; let released = 0;
    const deps = {
      selectedTokens: { value: ['a'] }, tokens: { value: [] }, tokenStatus: { value: {} },
      isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null },
      ensureConnection: async () => {}, releaseConnectionSlot: () => { released++; },
      addLog() {}, message: { info() {} },
      tokenStore: {
        sendGetRoleInfo: async () => ({ role: structuredClone(role) }), closeWebSocketConnection() {},
        sendMessageWithPromise: async (_id, cmd, p) => {
          calls.push(cmd);
          if (fail) throw Error('timeout');
          if (cmd === 'pet_load') {
            if (!p.slotUId.uId) { role.petData.pets[p.slotUId.slot] = role.petData.pets[-1]; delete role.petData.pets[-1]; role.pet = {}; }
            else { role.petData.pets[-1] = role.petData.pets[p.slotUId.slot]; delete role.petData.pets[p.slotUId.slot]; role.pet.petUId = p.slotUId.uId; }
          } else if (cmd === 'pet_merge') {
            role.petData.pets = { 1: pet('merged', 201) }; return { isSuccess: true };
          } else if (cmd === 'pet_activatebook') { role.petData.books[201] = 1; return { role: { petData: { books: { 201: 1 } } } }; }
          else if (cmd === 'pet_claimbookreward') { role.petData.bookReward[201] = 1; return { role: { petData: { bookReward: { 201: 1 } } } }; }
          else assert.fail(cmd);
          return {};
        },
      },
    };
    await createPetTasks(deps).batchAltMergeAndEquipPets();
    assert.deepEqual(calls, fail ? ['pet_load'] : ['pet_load', 'pet_merge', 'pet_activatebook', 'pet_claimbookreward', 'pet_load']);
    assert.equal(deps.tokenStatus.value.a, fail ? 'failed' : 'completed');
    assert.equal(released, 1); assert.equal(deps.isRunning.value, false);
  }
});
