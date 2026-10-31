import assert from "node:assert/strict";
import test from "node:test";
import { createTasksItem } from "../src/utils/batch/tasksItem.js";

async function immediateTimers(run) {
  const originalTimer = globalThis.setTimeout, originalNow = Date.now;
  let time = 10000;
  globalThis.setTimeout = (fn, ms) => { time += ms; queueMicrotask(fn); return 0; };
  Date.now = () => time;
  try { await run(); } finally { globalThis.setTimeout = originalTimer; Date.now = originalNow; }
}
function fixture(early, failQueries = 0, upgrade = false, failAfterApplied = false, poor = false) {
  const ids = [223,202,204,110,104,106,116,112,312,210,217,107];
  const role = { gold: 0, items: {}, lord: { level: 6000, order: 20 }, heroes: Object.fromEntries(ids.map(id => [id, { heroId: id, level: 900, order: 6, battleTeamSlot: -1 }])) };
  role.heroes[107].level = 6000; role.heroes[107].order = 20;
  const lineup = early ? [107, null, 223, 106] : [107,110,104,106,223];
  lineup.forEach((id, slot) => { if (id) role.heroes[id].battleTeamSlot = slot; });
  if (upgrade) { role.heroes[223].level = early ? 749 : 899; role.heroes[223].order = 5; role.gold = 1e12; role.items[1003] = { quantity: 1e6 }; }
  if (poor) { role.heroes[223].level = 1; role.heroes[223].order = 0; }
  const queries = [], commands = [], logs = [];
  const deps = {
    selectedTokens: { value: ["a"] }, tokens: { value: [{id:"a", name:"测试"}] },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null },
    helperSettings: {}, batchSettings: {}, connectionQueue: {}, delayConfig: { action: 0 },
    ensureConnection: async () => {}, releaseConnectionSlot() {}, addLog: log => logs.push(log), message: { info() {}, success() {} },
    tokenStore: {
      closeWebSocketConnection() {},
      async sendGetRoleInfo(id, params, retryCount) {
        queries.push({ time: Date.now(), retryCount });
        if (failQueries-- > 0) throw new Error("200400 操作太快");
        return { role: structuredClone(role) };
      },
      async sendMessageWithPromise(id, cmd, params) {
        commands.push({ cmd, params });
        if (cmd === "hero_heroupgradelevel") role.heroes[params.heroId].level += params.upgradeNum;
        else if (cmd === "hero_heroupgradeorder") role.heroes[params.heroId].order++;
        else if (cmd === "hero_gobackbattle") {
          Object.values(role.heroes).find(hero => hero.battleTeamSlot === params.slot).battleTeamSlot = -1;
        } else if (cmd === "hero_gointobattle") role.heroes[params.heroId].battleTeamSlot = params.slot;
        else if (cmd === "hero_exchange") {
          const slot = role.heroes[params.heroId].battleTeamSlot;
          role.heroes[params.heroId].battleTeamSlot = -1;
          role.heroes[params.targetHeroId].battleTeamSlot = slot;
        } else throw new Error(`意外指令 ${cmd}`);
        if (failAfterApplied && commands.length === 1) throw new Error("请求超时");
        return { role: { heroes: structuredClone(role.heroes) } };
      },
    },
  };
  const tasks = createTasksItem(deps);
  return { role, queries, commands, logs, deps, run: () => early ? tasks.batchAdjustEarlyMainLevelFormation() : tasks.batchAdjustMainLevelFormation() };
}
for (const early of [true, false]) {
  const title = early ? "前期阵容" : "默认阵容";
  test(`${title}连续达标武将复用状态，仅初始与最终校验查询`, async () => immediateTimers(async () => {
    const f = fixture(early); await f.run();
    assert.equal(f.queries.length, 2);
    assert.equal(f.commands.length, 0);
    assert.equal(f.deps.tokenStatus.value.a, "completed");
  }));
  test(`${title}查询200400冷却6秒，关闭store的一秒重试`, async () => immediateTimers(async () => {
    const f = fixture(early, 1); await f.run();
    assert.equal(f.queries[1].time - f.queries[0].time, 6000);
    assert.ok(f.queries.every(q => q.retryCount === 2));
    assert.equal(f.deps.tokenStatus.value.a, "completed");
  }));
  test(`${title}培养后的状态传至下一个武将与布阵`, async () => immediateTimers(async () => {
    const f = fixture(early, 0, true); await f.run();
    assert.equal(f.queries.length, 3);
    assert.equal(f.commands.filter(c => c.cmd === "hero_heroupgradelevel").length, 1);
    assert.equal(f.deps.tokenStatus.value.a, "completed");
  }));
  test(`${title}写操作超时但已生效，不重复升级`, async () => immediateTimers(async () => {
    const f = fixture(early, 0, true, true); await f.run();
    assert.equal(f.commands.filter(c => c.cmd === "hero_heroupgradelevel").length, 1);
    assert.equal(f.deps.tokenStatus.value.a, "completed");
  }));
  test(`${title}资源不足仍调整阵容并报告部分完成`, async () => immediateTimers(async () => {
    const f = fixture(early, 0, false, false, true); await f.run();
    assert.equal(f.deps.tokenStatus.value.a, "failed");
    assert.ok(f.logs.some(log => log.message.includes("部分完成")));
    assert.ok(f.logs.some(log => log.message.includes("阵容已调整")));
  }));
  test(`${title}布阵超时但已下阵，复查后不重复下阵`, async () => immediateTimers(async () => {
    const f = fixture(early, 0, false, true);
    f.role.heroes[107].battleTeamSlot = 4;
    if (!early) f.role.heroes[223].battleTeamSlot = -1;
    await f.run();
    assert.equal(f.commands.filter(c => c.cmd === "hero_gobackbattle").length, 1);
    assert.equal(f.role.heroes[107].battleTeamSlot, 0);
    assert.equal(f.deps.tokenStatus.value.a, "completed");
  }));
  test(`${title}查询限速持续失败有限退出`, async () => immediateTimers(async () => {
    const f = fixture(early, 9); await f.run();
    assert.equal(f.queries.length, 4);
    assert.equal(f.commands.length, 0);
    assert.equal(f.deps.tokenStatus.value.a, "failed");
    assert.ok(f.logs.some(log => log.message.includes("状态查询失败")));
  }));
}
