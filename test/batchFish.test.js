import test from "node:test";
import assert from "node:assert/strict";
import { createTasksItem } from "../src/utils/batch/tasksItem.js";

// 免费钓鱼抓包: api采集/定时任务/免费钓鱼.txt (2026-08-30)
// 客户端 ArtifactLotteryDialog._onBtnOne / ArtifactModule.sendLottery:
// 剩余免费次数先逐次发送，newFree 始终 true，付费每次最多 10。
function fixture({ roles, count = 100, type = 1, fail = false, stop = false, missingPatch = false } = {}) {
  const stamp = Math.floor(Date.now() / 1000);
  roles ??= { a: { items: { 1011: { quantity: 473 } }, statistics: { "ar:normal:lo:cnt": 0 }, statisticsTime: { "ar:normal:lo:cnt": stamp } } };
  roles = structuredClone(roles);
  const calls = [], logs = [], closed = [], queries = [];
  let released = 0;
  const deps = {
    selectedTokens: { value: Object.keys(roles) }, tokens: { value: Object.keys(roles).map(id => ({ id, name: id })) },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null },
    helperSettings: { fishType: type, count }, batchSettings: { defaultFishType: type, fishCount: count, maxActive: 2 },
    delayConfig: { action: 0 }, connectionQueue: { active: 0 }, ensureConnection: async () => {},
    releaseConnectionSlot() { released++; }, addLog: log => logs.push(log), message: { success() {} },
    tokenStore: {
      gameData: { roleInfo: { role: { items: { 1011: { quantity: 99999 } } } } },
      closeWebSocketConnection(id) { closed.push(id); },
      async sendGetRoleInfo(id) { queries.push(id); return { role: structuredClone(roles[id]) }; },
      async sendMessageWithPromise(id, cmd, params) {
        if (cmd === "role_getroleinfo") return { role: structuredClone(roles[id]) };
        assert.equal(cmd, "artifact_lottery");
        calls.push({ id, ...params });
        if (fail) throw new Error("服务器错误: 200020");
        const role = roles[id], key = "ar:normal:lo:cnt";
        const free = type === 1 && role.statistics[key] < 3;
        if (free) {
          assert.equal(params.lotteryNumber, 1, "免费次数未用完不能批量");
          role.statistics[key]++;
        } else {
          const rod = role.items[type === 1 ? 1011 : 1012];
          assert.ok(rod.quantity >= params.lotteryNumber);
          rod.quantity -= params.lotteryNumber;
        }
        if (stop) deps.shouldStop.value = true;
        // syncrewardresp 提供 role 增量，并不一定包含鱼竿库存。
        return { _raw: { cmd: "syncrewardresp", body: { role: missingPatch || free ? { statistics: structuredClone(role.statistics) } : { items: structuredClone(role.items) } } } };
      },
    },
  };
  return { deps, roles, calls, logs, closed, queries, released: () => released, run: scheduled => createTasksItem(deps).batchFish(scheduled) };
}

test("普通钓鱼先免费三次，再十次批量和余数，总计100次", async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.calls.map(x => x.lotteryNumber), [1, 1, 1, ...Array(9).fill(10), 7]);
  assert.ok(f.calls.every(x => x.newFree === true && x.type === 1));
  assert.equal(f.deps.tokenStatus.value.a, "completed");
  assert.deepEqual(f.closed, ["a"]); assert.equal(f.released(), 1);
});

test("并发账号分别获取库存，部分免费次数和零库存仍可免费钓鱼", async () => {
  const stamp = Math.floor(Date.now() / 1000);
  const role = (rods, freeUsed) => ({ items: { 1011: { quantity: rods } }, statistics: { "ar:normal:lo:cnt": freeUsed }, statisticsTime: { "ar:normal:lo:cnt": stamp } });
  const f = fixture({ roles: { a: role(11, 2), b: role(0, 0) }, count: 100 }); await f.run(true);
  assert.deepEqual(f.calls.filter(x => x.id === "a").map(x => x.lotteryNumber), [1, 10, 1]);
  assert.deepEqual(f.calls.filter(x => x.id === "b").map(x => x.lotteryNumber), [1, 1, 1]);
  assert.ok(f.queries.includes("a") && f.queries.includes("b"));
  assert.equal(f.released(), 2);
});

test("黄金鱼竿不走免费请求，增量缺少库存时仍限制消耗", async () => {
  const f = fixture({ type: 2, roles: { a: { items: { 1012: { quantity: 23 } }, statistics: {} } }, missingPatch: true });
  await f.run(); assert.deepEqual(f.calls.map(x => x.lotteryNumber), [10, 10, 3]);
});

test("请求失败不重试消耗，停止后不再发送或领取奖励", async () => {
  for (const options of [{ fail: true }, { stop: true }]) {
    const f = fixture(options); await f.run();
    assert.equal(f.calls.length, 1);
    assert.equal(f.deps.tokenStatus.value.a, options.fail ? "failed" : "stopped");
    assert.equal(f.released(), 1); assert.equal(f.deps.isRunning.value, false);
  }
});

test("跨日免费次数重置，按 statisticsTime 而非上次钓鱼时间判断", async () => {
  const oldStamp = Math.floor(Date.now() / 1000) - 86400;
  const f = fixture({ count: 2, roles: { a: { items: {}, statistics: { "ar:normal:lo:cnt": 3 }, statisticsTime: { "ar:normal:lo:cnt": oldStamp } } } });
  f.deps.tokenStore.sendMessageWithPromise = async (id, cmd, params) => {
    if (cmd === "role_getroleinfo") return { role: { statistics: {} } };
    f.calls.push({ id, ...params });
    return { _raw: { cmd: "syncrewardresp", body: { role: { statistics: { "ar:normal:lo:cnt": f.calls.length } } } } };
  };
  await f.run(); assert.deepEqual(f.calls.map(x => x.lotteryNumber), [1, 1]);
});

test("中途库存不足时重新计算尾批，不发送已规划的多余次数", async () => {
  const stamp = Math.floor(Date.now() / 1000);
  const f = fixture({ roles: { a: { items: { 1011: { quantity: 100 } }, statistics: { "ar:normal:lo:cnt": 3 }, statisticsTime: { "ar:normal:lo:cnt": stamp } } } });
  let queries = 0;
  const query = f.deps.tokenStore.sendGetRoleInfo;
  f.deps.tokenStore.sendGetRoleInfo = async id => {
    if (++queries === 3) f.roles[id].items[1011].quantity = 2;
    return query(id);
  };
  await f.run();
  assert.deepEqual(f.calls.map(x => x.lotteryNumber), [10, 10, 10, 10, 10, 2]);
  assert.ok(f.logs.some(x => x.message.includes("实际完成 52/100")));
});
