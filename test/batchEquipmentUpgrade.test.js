import test from "node:test";
import assert from "node:assert/strict";
import { createTasksItem } from "../src/utils/batch/tasksItem.js";

function fixture({ levels = [100, 100, 100, 100], lordLevel = 100, iron = 10000, error } = {}) {
  const calls = [], logs = [], closed = [];
  let released = 0;
  const deps = {
    selectedTokens: { value: ["a", "b"] }, tokens: { value: [] },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, batchSettings: { equipmentUpgradeHeroId: 107 },
    ensureConnection: async () => {}, releaseConnectionSlot: () => released++,
    addLog: log => logs.push(log), message: { success() {}, warning() {} },
    tokenStore: {
      sendGetRoleInfo: async id => ({ role: {
        lord: { level: id === "b" ? 5000 : lordLevel },
        heroes: { 107: { equipment: Object.fromEntries(levels.map((level, i) => [i + 1, { level }])) } },
        items: { 1006: { quantity: iron } },
      } }),
      sendMessageWithPromise: async (id, cmd, params) => {
        calls.push({ id, cmd, params });
        if (error && id === "a") throw error;
        return {};
      },
      closeWebSocketConnection: id => closed.push(id),
    },
  };
  return { deps, calls, logs, closed, released: () => released, run: () => createTasksItem(deps).batchUpgradeEquipment() };
}

test("装备达到或超过主公等级正常跳过，各账号独立判断并释放连接", async () => {
  for (const lordLevel of [100, 90]) {
    const f = fixture({ lordLevel }); await f.run();
    assert.deepEqual(f.calls, [{ id: "b", cmd: "equipment_batchupgradelevel", params: { heroId: 107 } }]);
    assert.deepEqual(f.deps.tokenStatus.value, { a: "completed", b: "completed" });
    assert.ok(f.logs.some(log => log.type === "info" && log.message.includes("当前没有可升级的装备")));
    assert.deepEqual(f.closed, ["a", "b"]); assert.equal(f.released(), 2);
    assert.equal(f.deps.isRunning.value, false);
  }
});

test("只要最低装备未达到主公等级仍升级，阶段边界不误跳过", async () => {
  for (const levels of [[99, 100, 100, 100], [200, 200, 200, 200], [1000, 1000, 1000, 1000]]) {
    const f = fixture({ levels, lordLevel: Math.min(...levels) + 1 }); await f.run();
    assert.equal(f.calls.length, 2); assert.equal(f.deps.tokenStatus.value.a, "completed");
  }
});

test("精铁不足或最终满级不发送请求", async () => {
  for (const options of [{ iron: 0, lordLevel: 101 }, { levels: [4000, 4000, 4000, 4000], lordLevel: 5000 }]) {
    const f = fixture(options); await f.run(); assert.equal(f.calls.length, 0);
    assert.equal(f.deps.tokenStatus.value.a, "completed");
  }
});

test("无效主公或装备等级保留失败，不猜测升级资格", async () => {
  for (const options of [{ lordLevel: undefined }, { lordLevel: null }, { lordLevel: "bad" }, { levels: [null, 100, 100, 100] }]) {
    const f = fixture(options);
    if (options.lordLevel === undefined) {
      const get = f.deps.tokenStore.sendGetRoleInfo;
      f.deps.tokenStore.sendGetRoleInfo = async id => { const result = await get(id); delete result.role.lord; return result; };
    }
    await f.run(); assert.equal(f.deps.tokenStatus.value.a, "failed");
    assert.ok(!f.calls.some(call => call.id === "a"));
  }
});

test("500060及其他服务端错误仍失败且不重试，其他账号继续", async () => {
  for (const text of ["服务器错误: 500060 - 没有可升级的装备", "timeout"]) {
    const f = fixture({ lordLevel: 101, error: new Error(text) }); await f.run();
    assert.deepEqual(f.deps.tokenStatus.value, { a: "failed", b: "completed" });
    assert.equal(f.calls.filter(call => call.id === "a").length, 1);
    assert.equal(f.released(), 2);
    assert.ok(f.logs.some(log => log.type === "error" && log.message.includes(text)));
  }
});
