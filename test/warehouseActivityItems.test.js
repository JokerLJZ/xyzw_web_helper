import test from "node:test";
import assert from "node:assert/strict";
import { classifyWarehouseActivityItem } from "../src/utils/warehouseActivityItems.js";

function fixture() {
  const config = { ItemConf: { 5292: { type: 2, params: [1, 58], changePackTime: 200 } },
    ActFestivalConf: { 1: { itemId: 5292, start: 100, end: 200 } }, PackConf: { 58: { id: 58 } } };
  return { itemId: 5292, config, now: 201000, role: { serverName: "62服" } };
}
test("当期、转礼包精确边界与过期：只在客户端转换时间之后使用openpack", () => {
  const f = fixture();
  f.now = 150000;
  assert.match(classifyWarehouseActivityItem(f).reason, /当期/);
  f.now = 200000;
  assert.match(classifyWarehouseActivityItem(f).reason, /尚未/);
  f.now++;
  assert.deepEqual(classifyWarehouseActivityItem(f), { status: "ready", command: "item_openpack", index: 0 });
});
test("延期转换、共享货币与白名单提前开放都保留道具", () => {
  const f = fixture();
  f.config.ItemConf[5292].changePackTime = 300;
  assert.equal(classifyWarehouseActivityItem(f).status, "skipped");
  f.config.ItemConf[5292].changePackTime = 100;
  f.config.ActFestivalConf[2] = { itemId: 5292, start: 200, end: 400 };
  assert.match(classifyWarehouseActivityItem(f).reason, /当期/);
  f.config.ActFestivalConf = { 1: { itemId: 5292, start: 300, whiteListStart: 200, end: 400 } };
  f.role.isWhiteRole = true;
  assert.match(classifyWarehouseActivityItem(f).reason, /当期/);
});
test("历史排除中的无转换、非礼包、选择奖励、缺配置不再试错发送", () => {
  for (const patch of [{ changePackTime: 0 }, { type: 8 }, { params: [] }, { params: [2, 58] }, { params: [1, 999] }]) {
    const f = fixture(); Object.assign(f.config.ItemConf[5292], patch);
    assert.equal(classifyWarehouseActivityItem(f).status, "skipped");
  }
  assert.equal(classifyWarehouseActivityItem({ itemId: 1 }).status, "skipped");
});
test("潜在新服活动回顾不套用旧活动日期；普通服和已结束大服按转换配置", () => {
  const f = fixture(); f.config.ActFestivalConf[1].lookBackDay = 64;
  assert.match(classifyWarehouseActivityItem(f).reason, /回顾/);
  f.config.bigServerConf = { 62: { isLookBack: 1, endTime: 300 } };
  assert.equal(classifyWarehouseActivityItem(f).status, "skipped");
  f.config.bigServerConf[62].endTime = 200;
  assert.equal(classifyWarehouseActivityItem(f).status, "ready");
  f.config.bigServerConf[62] = { isLookBack: 0 };
  assert.equal(classifyWarehouseActivityItem(f).status, "ready");
});

test("仓库实际入口：当期货币不发送请求，历史排除的过期道具恢复openpack", async () => {
  const { createTasksItem } = await import("../src/utils/batch/tasksItem.js");
  const config = {
    ItemConf: {
      5283: { type: 2, params: [1, 40], changePackTime: 100 },
      5292: { type: 2, params: [1, 58], changePackTime: 300 },
      5293: { type: 2, params: [1, 40], changePackTime: 400 },
    },
    PackConf: { 40: {}, 58: {} },
    ActFestivalConf: { 1: { itemId: 5292, start: 100, end: 300 }, 2: { itemId: 5293, start: 100, end: 400 } },
  };
  const ref = value => ({ value });
  const shouldStop = ref(false), logs = [], calls = [];
  const items = { 5283: { quantity: 2 }, 5292: { quantity: 5 }, 5293: { quantity: 6 } };
  let reads = 0;
  const tasks = createTasksItem({
    selectedTokens: ref(["a"]), tokens: ref([{ id: "a", name: "账号" }]), tokenStatus: ref({}),
    isRunning: ref(false), shouldStop, currentRunningTokenId: ref(null), batchSettings: {},
    delayConfig: { action: 0 }, helperSettings: {}, connectionQueue: { active: 1 },
    ensureConnection: async () => {}, releaseConnectionSlot() {}, addLog: log => logs.push(log), message: { success() {} },
    warehousePause: async () => {}, warehouseNow: () => 201000,
    loadWarehouseItemConfig: async () => config,
    tokenStore: {
      sendGetRoleInfo: async () => {
        reads++;
        if (reads === 4) shouldStop.value = true; // stop the unrelated follow-up star-book task
        return { role: { levelId: 7001, items: structuredClone(items), heroes: {} } };
      },
      sendMessageWithPromise: async (_id, cmd, params) => { calls.push({ cmd, params }); items[params.itemId].quantity -= params.number; return {}; },
      closeWebSocketConnection() {},
    },
  });
  await tasks.batchUseWarehouseItems();
  assert.deepEqual(calls, [{ cmd: "item_openpack", params: { itemId: 5283, number: 2, index: 0 } }]);
  assert.ok(logs.some(log => /金吉他.*当期/.test(log.message)));
  assert.ok(logs.some(log => /满天星.*当期/.test(log.message)));
});
