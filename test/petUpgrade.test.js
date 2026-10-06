import assert from "node:assert/strict";
import { test } from "node:test";
import { createPetTasks, getPetUpgradeTargets, getEquippedPetUpgradeTarget } from "../src/utils/batch/tasksPet.js";

function fixture({ quantity = 10, fail = false, stop = false } = {}) {
  const role = { pet: { petUId: "143-U9U" }, items: { 15001: { quantity } }, petData: { pets: {
    "-1": { uId: "143-U9U", level: 39 },
    0: { uId: "pet-b", level: 1 },
  } } };
  const calls = [];
  let released = 0;
  const deps = {
    selectedTokens: { value: ["t"] }, tokens: { value: [] }, tokenStatus: { value: {} },
    isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null },
    ensureConnection: async () => {}, releaseConnectionSlot: () => { released++; },
    addLog: () => {}, message: { info: () => {} }, delayConfig: { command: 0 },
    tokenStore: {
      sendGetRoleInfo: async () => ({ role: structuredClone(role) }),
      closeWebSocketConnection: () => {},
      sendMessageWithPromise: async (_id, cmd, params) => {
        calls.push({ cmd, params });
        if (fail) throw new Error("timeout");
        role.items[15001].quantity -= 5;
        role.petData.pets[params.slotUId.slot].level++;
        if (stop) deps.shouldStop.value = true;
        // 抓包响应不含uId，不得覆盖完整宠物列表。
        return { role: { petData: { pets: { [params.slotUId.slot]: { level: 40, exp: 0 } } } } };
      },
    },
  };
  return { deps, calls, run: () => createPetTasks(deps).batchUpgradeAllPets(), released: () => released };
}

test("仅升级当前佩戴宠物并使用抓包中的一键升级协议", async () => {
  const f = fixture({ quantity: 5 }); await f.run();
  assert.deepEqual(f.calls, [
    { cmd: "pet_useexpitem", params: { slotUId: { slot: -1, uId: "143-U9U" }, isOneClick: true } },
  ]);
  assert.equal(f.deps.tokenStatus.value.t, "completed");
  assert.equal(f.released(), 1);
});

test("道具耗尽、停止和请求失败均不继续消耗或重试", async () => {
  for (const options of [{ quantity: 0 }, { quantity: 5 }, { fail: true }, { stop: true }]) {
    const f = fixture(options); await f.run();
    assert.equal(f.calls.length, options.quantity === 0 ? 0 : 1);
    assert.equal(f.deps.isRunning.value, false);
    assert.equal(f.released(), 1);
    if (options.fail) assert.equal(f.deps.tokenStatus.value.t, "failed");
  }
});

test("缺少唯一编号或合法槽位的增量数据不能作为升级目标", () => {
  assert.deepEqual(getPetUpgradeTargets({ petData: { pets: { "-1": { level: 40 }, bad: { uId: "a" } } } }), []);
});


test("仓库宠物等级再高也不升级，未佩戴时不选目标", () => {
  const role = { pet: { petUId: "equipped" }, petData: { pets: {
    0: { uId: "equipped", level: 10 }, 1: { uId: "storage", level: 100 },
  } } };
  assert.deepEqual(getEquippedPetUpgradeTarget(role), [{ slot: 0, uId: "equipped", level: 10 }]);
  delete role.pet;
  assert.deepEqual(getEquippedPetUpgradeTarget(role), []);
});

test("扭蛋领奖跳过已领阶段，按增量确认其余奖励且不抽奖", async () => {
  const f = fixture();
  const calls = [];
  f.deps.tokenStore.sendMessageWithPromise = async (_id, cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === "gacha_getinfo") return { roleGacha: { stageGachaCnt: 46, claimedStageIdMap: { 2: true } } };
    assert.equal(cmd, "gacha_claimstagereward");
    return { roleGacha: { claimedStageIdMap: { [params.stageId]: true } } };
  };
  await createPetTasks(f.deps).batchClaimGachaRewards();
  assert.deepEqual(calls, [
    { cmd: "gacha_getinfo", params: {} },
    { cmd: "gacha_claimstagereward", params: { stageId: 1 } },
    { cmd: "gacha_claimstagereward", params: { stageId: 4 } },
  ]);
  assert.equal(f.deps.tokenStatus.value.t, "completed");
  assert.equal(f.released(), 1);
});


test("当前佩戴宠物连续升级至经验道具耗尽", async () => {
  const f = fixture({ quantity: 15 });
  await f.run();
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every((c) => c.params.slotUId.uId === "143-U9U"));
  assert.equal(f.deps.tokenStatus.value.t, "completed");
});

test("满级或无法升级导致状态完全未变化时只请求一次", async () => {
  const f = fixture();
  f.deps.tokenStore.sendMessageWithPromise = async (_id, cmd, params) => {
    f.calls.push({ cmd, params }); return {};
  };
  await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.released(), 1);
});

test("经验增加但未升一级时仍继续升级，切换佩戴宠物后停止", async () => {
  const f = fixture();
  const role = { pet: { petUId: "143-U9U" }, items: { 15001: { quantity: 10 } }, petData: { pets: { "-1": { uId: "143-U9U", level: 39, exp: 0 } } } };
  f.deps.tokenStore.sendGetRoleInfo = async () => ({ role: structuredClone(role) });
  f.deps.tokenStore.sendMessageWithPromise = async (_id, cmd, params) => {
    f.calls.push({ cmd, params });
    role.items[15001].quantity--;
    role.petData.pets["-1"].exp++;
    if (f.calls.length === 2) role.pet.petUId = "changed";
    return {};
  };
  await f.run();
  assert.equal(f.calls.length, 2);
});
