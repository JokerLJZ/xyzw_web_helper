import assert from "node:assert/strict";
import { test } from "node:test";
import { isDungeonOpen } from "../src/utils/dreamConstants.js";
import { getDreamPeriod, isDreamEnabled, runDreamAutoPush } from "../src/utils/dreamTaskRunner.js";
import { createTasksDungeon } from "../src/utils/batch/tasksDungeon.js";

const now = () => new Date("2026-09-23T10:00:00+08:00");
function fixture({ fresh = false, win = true, kill = false, fail = null } = {}) {
  const role = {
    battleTeam: { 0: { heroId: 107 }, 1: { heroId: 106 } },
    dungeon: {
      beginTime: getDreamPeriod(now()), id: 41, currMonsterId: 2010,
      activeHeroId: 107,
      battleTeam: { 0: { heroId: 107, hp: 100, attack: 200 }, 1: { heroId: 106, hp: 100, attack: 100 } },
    },
  };
  if (fresh) { role.dungeon.beginTime -= 7 * 86400; role.dungeon.battleTeam = {}; }
  const calls = [];
  const send = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === "role_getroleinfo") return { role: structuredClone(role) };
    if (cmd === "dungeon_selecthero") {
      role.dungeon.beginTime = getDreamPeriod(now());
      role.dungeon.battleTeam = { 0: { heroId: 107, hp: 100, attack: 200 } };
      return { role: { dungeon: { id: 41 } } };
    }
    assert.equal(cmd, "fight_startdungeon");
    if (fail) throw new Error(fail);
    if (win) role.dungeon.id++;
    if (kill) {
      const hero = Object.values(role.dungeon.battleTeam).find((h) => h.heroId === params.heroId);
      hero.hp = 0;
    }
    // 实际抓包为增量响应：battleTeam 只有 energy，不含 heroId/hp。
    return { isWin: win, role: { dungeon: { id: role.dungeon.id, battleTeam: { 0: { energy: 100 } } } } };
  };
  return { role, calls, send, now, pause: async () => {} };
}

test("梦境开关按Token独立读取，关闭时完全不请求接口", async () => {
  const storage = { getItem: (key) => key === "daily-settings:off" ? '{"dreamEnable":false}' : null };
  assert.equal(isDreamEnabled("off", storage), false);
  assert.equal(isDreamEnabled("on", storage), true);
  const result = await runDreamAutoPush({ enabled: false, send: () => assert.fail("关闭时不能发请求") });
  assert.equal(result.status, "skipped");
});

test("梦境使用北京时间日/一/三/四及正确的本期开始时间", async () => {
  for (let day = 20; day <= 26; day++) {
    const date = new Date(`2026-09-${day}T10:00:00+08:00`);
    assert.equal(isDungeonOpen(date), [20, 21, 23, 24].includes(day));
  }
  const midnight = new Date("2026-09-22T16:00:00Z");
  assert.equal(isDungeonOpen(midnight), true);
  assert.equal(getDreamPeriod(midnight), midnight.getTime() / 1000);
  assert.equal(getDreamPeriod(new Date("2026-09-24T13:00:00+08:00")), getDreamPeriod(now()));
  const result = await runDreamAutoPush({ now: () => new Date("2026-09-25T10:00:00+08:00"), send: () => assert.fail("关闭日不能发请求") });
  assert.equal(result.status, "skipped");
});

test("新期梦境使用当前完整阵容初始化并逐层推进", async () => {
  const f = fixture({ fresh: true });
  const result = await runDreamAutoPush({ ...f, maxBattles: 3 });
  assert.equal(result.initialFloor, 41);
  assert.equal(result.floor, 44);
  assert.equal(result.battles, 3);
  assert.deepEqual(f.calls.find((c) => c.cmd === "dungeon_selecthero").params, { battleTeam: { 0: 107, 1: 106 } });
  assert.deepEqual(f.calls.filter((c) => c.cmd === "fight_startdungeon").map((c) => c.params.heroId), [107, 107, 107]);
});

test("本期已选阵容不会被覆盖，增量战报不丢失英雄身份", async () => {
  const f = fixture();
  const result = await runDreamAutoPush({ ...f, maxBattles: 2 });
  assert.equal(result.floor, 43);
  assert.equal(f.calls.some((c) => c.cmd === "dungeon_selecthero"), false);
});

test("英雄阵亡后切换存活英雄，全员阵亡停止", async () => {
  const f = fixture({ win: false, kill: true });
  const result = await runDreamAutoPush(f);
  assert.equal(result.battles, 2);
  assert.deepEqual(f.calls.filter((c) => c.cmd === "fight_startdungeon").map((c) => c.params.heroId), [107, 106]);
});

test("同一英雄连续3次未推进后换人，不无限重试", async () => {
  const f = fixture({ win: false });
  const result = await runDreamAutoPush(f);
  assert.equal(result.battles, 6);
  assert.equal(result.floor, 41);
});

test("服务器终止码作为停止原因而不是假报通关", async () => {
  for (const code of [2600080, 2600050]) {
    const f = fixture({ fail: `服务器错误: ${code} - 不可挑战` });
    const result = await runDreamAutoPush(f);
    assert.equal(result.battles, 1);
    assert.equal(result.status, "stopped");
    assert.match(result.reason, new RegExp(String(code)));
  }
});

test("超时未确认结果不重复战斗；已推进时可对账继续", async () => {
  const f = fixture({ fail: "timeout" });
  await assert.rejects(runDreamAutoPush(f), /无法确认/);
  assert.equal(f.calls.filter((c) => c.cmd === "fight_startdungeon").length, 1);
  const g = fixture();
  const send = async (cmd, params) => {
    const result = await g.send(cmd, params);
    if (cmd === "fight_startdungeon") throw new Error("timeout");
    return result;
  };
  assert.equal((await runDreamAutoPush({ ...g, send, maxBattles: 2 })).floor, 43);
});

test("停止和开放周期变化会终止后续请求", async () => {
  const f = fixture();
  await assert.rejects(runDreamAutoPush({ ...f, stopped: () => true }), /已停止/);
  assert.equal(f.calls.length, 0);
  let stopped = false;
  const send = async (cmd, params) => {
    const result = await f.send(cmd, params);
    if (cmd === "fight_startdungeon") stopped = true;
    return result;
  };
  await assert.rejects(runDreamAutoPush({ ...f, send, stopped: () => stopped }), /已停止/);
  assert.equal(f.calls.filter((c) => c.cmd === "fight_startdungeon").length, 1);
});

test("未解锁、期次未更新和未知错误不继续发送战斗", async () => {
  await assert.rejects(runDreamAutoPush({ now, pause: async () => {}, send: async () => ({ role: {} }) }), /未获取到/);
  const f = fixture({ fresh: true });
  const send = async (cmd, params) => {
    if (cmd === "dungeon_selecthero") throw new Error("服务器错误: 2600040 - 已选定");
    return f.send(cmd, params);
  };
  await assert.rejects(runDreamAutoPush({ ...f, send }), /期次尚未更新/);
  assert.equal(f.calls.some((c) => c.cmd === "fight_startdungeon"), false);
});

test("批量梦境和独立购买遵守Token开关，不连接、不购买、不误释放连接槽", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: now() });
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => '{"dreamEnable":false}' },
  });
  t.after(() => {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else delete globalThis.localStorage;
  });
  const fail = () => assert.fail("已关闭梦境时不得发送请求或操作连接");
  const deps = {
    selectedTokens: { value: ["off"] }, tokens: { value: [{ id: "off", name: "关闭账号" }] },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null },
    batchSettings: { dreamPurchaseList: ["1-5"] },
    tokenStore: { getWebSocketStatus: () => "connected", sendMessageWithPromise: fail, closeWebSocketConnection: fail },
    ensureConnection: fail, releaseConnectionSlot: fail,
    addLog: () => {}, message: { success: () => {}, info: () => {}, warning: () => {} },
  };
  const tasks = createTasksDungeon(deps);
  await tasks.batchmengjing();
  await tasks.batchBuyDreamItems();
  assert.equal(deps.tokenStatus.value.off, "completed");
  assert.equal(deps.isRunning.value, false);
});
