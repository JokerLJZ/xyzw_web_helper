import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";
import { claimPendingEvoTowerRewards } from "../src/utils/evoTowerRewards.js";
import { syncBlackMarketPurchaseConfig } from "../src/utils/batch/blackMarketConfig.js";
import { createTasksTower } from "../src/utils/batch/tasksTower.js";
import { createTasksStore } from "../src/utils/batch/tasksStore.js";
import { availableTasks } from "../src/utils/batch/constants.js";

const cacheSource = ts.transpileModule(await fs.readFile(new URL("../src/stores/cache.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { Cache } = await import(`data:text/javascript;base64,${Buffer.from(cacheSource).toString("base64")}`);

test("缓存并发失败时所有调用者收到原错误，下一次可以重试", async () => {
  const cache = new Cache("test", {});
  let reject;
  const failure = new Error("server failure");
  const first = cache.get("role", () => new Promise((_, r) => { reject = r; }));
  const second = cache.get("role", () => assert.fail("必须合并请求"));
  const result = Promise.allSettled([first, second]);
  reject(failure);
  for (const item of await result) assert.equal(item.reason, failure);
  assert.equal(cache.content.role, undefined);
  assert.deepEqual(await cache.get("role", Promise.resolve({ id: 1 })), { id: 1 });
  assert.deepEqual(await cache.get("role", () => assert.fail("应命中缓存")), { id: 1 });
});

test("怪异塔按增量响应补领多章，已领取和未过章时不重复领取", async () => {
  let chapter = 11;
  const tower = { towerId: 130, rewardTowerId: chapter, energy: 5 };
  const calls = [];
  const send = async (cmd, params) => { calls.push({ cmd, params }); return { evoTower: { rewardTowerId: ++chapter } }; };
  await claimPendingEvoTowerRewards({ send, tower });
  assert.equal(calls.length, 2);
  assert.equal(tower.rewardTowerId, 13);
  assert.equal(tower.energy, 5);
  assert.deepEqual(calls[0], { cmd: "evotower_claimreward", params: {} });
  await claimPendingEvoTowerRewards({ send, tower });
  await claimPendingEvoTowerRewards({ send, tower: { towerId: 129, rewardTowerId: 12 } });
  assert.equal(calls.length, 2);
});


const list = [{ itemId: 2002, discount: 5 }, { itemId: 1012, discount: 8 }];
test("黑市读取-写入-核验，保留采购次数且只发送协议字段", async () => {
  const calls = [];
  let current = { purchaseCnt: 2, purchaseItemList: [] };
  const send = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === "store_setpurchase") current = params;
    return current;
  };
  assert.equal(await syncBlackMarketPurchaseConfig({ send, list: list.map(item => ({ ...item, note: "备注" })) }), "updated");
  assert.deepEqual(calls.map(item => item.cmd), ["store_getpurchase", "store_setpurchase", "store_getpurchase"]);
  assert.equal(current.purchaseCnt, 2);
  assert.equal(current.purchaseItemList.some(item => "note" in item), false);
  calls.length = 0;
  assert.equal(await syncBlackMarketPurchaseConfig({ send, list }), "unchanged");
  assert.equal(calls.length, 1);
});

test("黑市写后不一致会报错，停止后不写入", async () => {
  const calls = [];
  const send = async cmd => { calls.push(cmd); return { purchaseCnt: 1, purchaseItemList: [] }; };
  await assert.rejects(syncBlackMarketPurchaseConfig({ send, list }), /校验失败/);
  calls.length = 0;
  assert.equal(await syncBlackMarketPurchaseConfig({ send, list, shouldStop: () => true }), "stopped");
  assert.deepEqual(calls, ["store_getpurchase"]);
});

function storeScenario({ currentLegionId = 0, target = { id: 123, name: "目标" } } = {}) {
  const calls = [], statuses = {};
  const deps = {
    selectedTokens: { value: ["a"] }, tokens: { value: [{ id: "a", name: "测试" }] },
    tokenStatus: { value: statuses }, isRunning: { value: false }, shouldStop: { value: false },
    ensureConnection: async () => {}, releaseConnectionSlot() {}, connectionQueue: { active: 0 },
    batchSettings: { legionId: 123, maxActive: 1 }, addLog() {}, message: { warning() {} },
    currentRunningTokenId: { value: null }, delayConfig: {},
    tokenStore: {
      closeWebSocketConnection() {},
      async sendMessageWithPromise(_id, cmd, params) {
        calls.push({ cmd, params });
        if (cmd === "legion_getinfobyid") return { legionData: target };
        if (cmd === "role_getroleinfo") return { role: { legionId: currentLegionId } };
        return {};
      },
    },
  };
  return { tasks: createTasksStore(deps), calls, statuses, deps };
}
test("俱乐部只为无归属账号发申请，已入会或目标无效时跳过", async () => {
  for (const currentLegionId of [0, 123, 456]) {
    const s = storeScenario({ currentLegionId });
    await s.tasks.batchJoinLegion();
    assert.equal(s.calls.some(item => item.cmd === "legion_applyjoin"), currentLegionId === 0);
    assert.equal(s.statuses.a, "completed");
  }
  const s = storeScenario({ target: null });
  await s.tasks.batchJoinLegion();
  assert.equal(s.statuses.a, "failed");
  assert.equal(s.calls.length, 1);
});

test("显式注册表覆盖所有定时任务，拒绝代码文本和原型属性", async () => {
  const source = await fs.readFile(new URL("../src/views/BatchDailyTasks.vue", import.meta.url), "utf8");
  const definition = source.match(/const getScheduledTaskFunction = \(name\) => \{[\s\S]*?\n\};/)[0];
  const names = [...definition.matchAll(/^    (\w+),$/gm)].map(match => match[1]);
  const context = Object.fromEntries(names.map(name => [name, () => name]));
  const lookup = vm.runInNewContext(`${definition}; getScheduledTaskFunction`, context);
  for (const item of availableTasks) assert.equal(typeof lookup(item.value), "function", item.value);
  for (const name of ["constructor", "__proto__", "startBatch()", "globalThis.pwned = true"]) assert.equal(lookup(name), undefined);
  assert.equal(/\beval\(/.test(source), false);
});

test("主题监听重复初始化只注册一次，卸载时用原回调移除（兼容旧浏览器）", async () => {
  const source = (await fs.readFile(new URL("../src/composables/useTheme.js", import.meta.url), "utf8"))
    .replace(/^import .*;$/m, "").replace("export function useTheme", "function useTheme");
  for (const modern of [true, false]) {
    const listeners = new Set();
    let unmount, registrations = 0;
    const add = (...args) => { registrations++; listeners.add(args.at(-1)); };
    const remove = (...args) => { listeners.delete(args.at(-1)); };
    const media = modern ? { addEventListener: add, removeEventListener: remove } : { addListener: add, removeListener: remove };
    const context = { ref: value => ({ value }), onMounted() {}, onUnmounted: callback => { unmount = callback; }, window: { matchMedia: () => media } };
    const theme = vm.runInNewContext(`${source}; useTheme()`, context);
    theme.setupSystemThemeListener();
    theme.setupSystemThemeListener();
    assert.equal(registrations, 1);
    assert.equal(listeners.size, 1);
    unmount();
    assert.equal(listeners.size, 0);
  }
});


test("批量怪异塔在零能量时也补领奖，领奖失败时不会发战斗请求", async () => {
  for (const failure of [false, true]) {
    const { deps, calls, statuses } = storeScenario();
    deps.currentSettings = { towerFormation: 1 };
    deps.message.success = () => {};
    deps.tokenStore.sendMessageWithPromise = async (_id, cmd, params) => {
      calls.push({ cmd, params });
      if (cmd === "presetteam_getinfo") return { presetTeamInfo: { useTeamId: 1 } };
      if (cmd === "evotower_getinfo") return { evoTower: { towerId: 130, rewardTowerId: 12, energy: failure ? 5 : 0 } };
      if (cmd === "evotower_claimreward") return { evoTower: { rewardTowerId: failure ? 12 : 13 } };
      assert.fail(`不应该执行 ${cmd}`);
    };
    await createTasksTower(deps).climbWeirdTower();
    assert.deepEqual(calls.map(item => item.cmd), ["presetteam_getinfo", "evotower_getinfo", "evotower_claimreward"]);
    assert.equal(statuses.a, failure ? "failed" : "completed");
  }
});

test("自动怪异塔使用公用爬塔次数，达到配置后即使仍有体力也停止", async () => {
  const { deps, calls } = storeScenario();
  deps.batchSettings.weirdTowerClimbCount = 2;
  deps.currentSettings = { towerFormation: 1 };
  deps.message.success = () => {};
  deps.tokenStore.sendMessageWithPromise = async (_id, cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === "presetteam_getinfo") return { presetTeamInfo: { useTeamId: 1 } };
    if (cmd === "evotower_getinfo") return { evoTower: { towerId: 1, rewardTowerId: 0, energy: 100 } };
    return {};
  };
  await createTasksTower(deps).climbWeirdTower();
  assert.equal(calls.filter(item => item.cmd === "evotower_readyfight").length, 2);
  assert.equal(calls.filter(item => item.cmd === "evotower_fight").length, 2);
});
