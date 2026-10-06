import assert from "node:assert/strict";
import { test } from "node:test";
import { createPetTasks, getPetUpgradeTargets } from "../src/utils/batch/tasksPet.js";

function fixture({ quantity = 10, fail = false, stop = false } = {}) {
  const role = { items: { 15001: { quantity } }, petData: { pets: {
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

test("所有宠物按槽位依次使用抓包中的一键升级协议，并保留完整身份", async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.calls, [
    { cmd: "pet_useexpitem", params: { slotUId: { slot: -1, uId: "143-U9U" }, isOneClick: true } },
    { cmd: "pet_useexpitem", params: { slotUId: { slot: 0, uId: "pet-b" }, isOneClick: true } },
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
