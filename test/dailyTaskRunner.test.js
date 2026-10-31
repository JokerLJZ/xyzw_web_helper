import { getDailyRunStatus, summarizeScheduledAccount } from "../src/utils/scheduledTaskResult.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DailyTaskRunner } from "../src/utils/dailyTaskRunner.js";
const definitions = [
  [1, 1, 1],
  [2, 2, 1],
  [3, 3, 3],
  [4, 4, 2],
  [5, 5, 5],
  [6, 6, 3],
  [7, 7, 3],
  [8, 13, 1],
  [9, 12, 1],
  [10, 14, 1],
].map(([id, completeCondition, completeValue]) => ({
  id,
  completeCondition,
  completeValue,
}));
const config = {
  legionStore: { 5: { coin: 4, itemID: 1019, price: 100 }, 6: { coin: 4, itemID: 1019, price: 40 } },
  tasks: definitions,
  constants: { arenaStarTime: 21600, arenaOverTime: 79200, DailyFreeFishing: 3 },
  bossLoop: Object.fromEntries([1,2,3,4,5,6,7].map(day => [day, { monsters: [9905] }])),
  bossRewards: { 1: { bossId: 9905, damage: 1000 } },
  dailyRewards: [
    { id: 1, limit: 20 },
    { id: 2, limit: 40 },
  ],
  weeklyRewards: [
    { id: 1, limit: 100 },
    { id: 2, limit: 200 },
  ],
};
const settings = {
  arenaFormation: 1,
  bossFormation: 1,
  payRecruit: true,
  claimHangUp: false,
  openBox: true,
  arenaEnable: false,
  claimBottle: false,
  claimEmail: false,
  blackMarketPurchase: true,
  bossTimes: 0,
  freeGachaEnable: false,
  studyEnable: false,
  dreamEnable: false,
  monthlyFishTopUpEnable: false,
  monthlyArenaTopUpEnable: false,
};
function fixture(progress = {}) {
  const calls = [];
  let connected = true;
  let readFailure = false;
  const role = {
    items: { 1019: { quantity: 100 } },
    dailyTask: {
      dailyTime: 1700000000,
      complete: {
        ...Object.fromEntries(
          definitions.map((d) => [d.completeCondition, -1]),
        ),
        ...progress,
      },
      dailyPoint: 0,
      dailyReward: {},
      weekPoint: 0,
      weekReward: {},
    },
    statistics: {
      "artifact:normal:lottery:time": 1700000010,
      "ar:normal:lo:cnt": 3,
      "genie:sweep:buy": 3,
    },
    statisticsTime: {
      "ar:normal:lo:cnt": Math.floor(Date.now() / 1000),
      "genie:sweep:buy": 1700000010,
      "legion:sign:in": 1700000010,
      ...Object.fromEntries(
        [1, 2, 3, 4, 5].map((id) => [`genie:daily:free:${id}`, 1700000010]),
      ),
    },
  };
  const store = {
    gameTokens: [{ id: "account-a", name: "Test account" }],
    getWebSocketStatus: () => (connected ? "connected" : "disconnected"),
    async sendGetRoleInfo() {
      calls.push({ cmd: "role_getroleinfo" });
      if (readFailure) throw new Error("Cannot read server state");
      return { role: structuredClone(role) };
    },
    async sendMessageWithPromise(id, cmd, params) {
      calls.push({ cmd, params });
      if (cmd === "discount_getdiscountinfo") return { discountList: [{ discountId: 1, discountState: 2 }] };
      if (cmd === "collection_goodslist") return { freeRewardTime: Math.floor(Date.now() / 1000) };
      if (cmd === "boss_getstate") return { hurt: 0 };
      if (cmd === "presetteam_getinfo")
        return { presetTeamInfo: { useTeamId: 1 } };
      if (cmd === "system_buygold") role.dailyTask.complete[6]++;
      if (cmd === "item_openbox") role.dailyTask.complete[7] += params.number;
      if (cmd === "hero_recruit")
        role.dailyTask.complete[4] += params.recruitNumber;
      if (cmd === "task_claimdailypoint") {
        const definition = definitions.find((d) => d.id === params.taskId);
        role.dailyTask.complete[definition.completeCondition] = -1;
        role.dailyTask.dailyPoint += 5;
      }
      if (cmd === "task_claimdailyreward")
        role.dailyTask.dailyReward[params.rewardId] = true;
      if (cmd === "task_claimweekreward")
        role.dailyTask.weekReward[params.rewardId] = true;
      return {};
    },
  };
  const runner = (options = {}) =>
    new DailyTaskRunner(
      store,
      { commandDelay: 0, taskDelay: 0 },
      {
        loadConfig: async () => config,
        sleep: async () => {},
        ...options,
      },
    );
  return {
    role,
    calls,
    store,
    runner,
    disconnect: () => {
      connected = false;
    },
    reconnect: () => {
      connected = true;
    },
    failReads: () => {
      readFailure = true;
    },
  };
}

test("completed-but-unclaimed tasks only claim their configured task IDs", async () => {
  const f = fixture({ 6: 3, 7: 20, 12: 1 });
  await f.runner().run("account-a", {}, settings);
  assert.equal(
    f.calls.filter((c) =>
      ["system_buygold", "item_openbox", "store_purchase"].includes(c.cmd),
    ).length,
    0,
  );
  assert.deepEqual(
    f.calls
      .filter((c) => c.cmd === "task_claimdailypoint")
      .map((c) => c.params.taskId),
    [6, 7, 9],
  );
});

test("partial progress skips completed actions and preserves the original box batch", async () => {
  const f = fixture({ 6: 2, 7: 2 });
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(f.calls.filter((c) => c.cmd === "system_buygold").length, 1);
  assert.equal(f.calls.find((c) => c.cmd === "item_openbox").params.number, 10);
  assert.equal(result.deferred, 0);
});

test("a new runner skips claimed actions using new server data, without local progress", async () => {
  const f = fixture({ 6: 2 });
  await f.runner().run("account-a", {}, settings);
  f.calls.length = 0;
  await f.runner().run("account-a", {}, settings);
  assert.equal(
    f.calls.filter(
      (c) => c.cmd === "system_buygold" || c.cmd === "task_claimdailypoint",
    ).length,
    0,
  );
  assert.ok(f.calls.some((c) => c.cmd === "role_getroleinfo"));
});

test("a successful write followed by disconnect does not cause replay on reconnect", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  let interrupted = false;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "system_buygold" && !interrupted) {
      interrupted = true;
      f.disconnect();
    }
    return result;
  };
  await assert.rejects(
    f.runner().run("account-a", {}, settings),
    /WebSocket 已断开/,
  );
  f.reconnect();
  await f.runner().run("account-a", {}, settings);
  assert.equal(f.calls.filter((c) => c.cmd === "system_buygold").length, 1);
  assert.equal(
    f.calls.filter((c) => c.cmd === "task_claimdailypoint").length,
    1,
  );
});

test("a transport failure before execution leaves the server deficit available on retry", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  let failed = false;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "system_buygold" && !failed) {
      failed = true;
      throw new Error("Network timeout");
    }
    return send(...args);
  };
  await assert.rejects(
    f.runner().run("account-a", {}, settings),
    /Network timeout/,
  );
  await f.runner().run("account-a", {}, settings);
  assert.equal(f.calls.filter((c) => c.cmd === "system_buygold").length, 1);
});

test("failed phase verification prevents all reward claims", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "system_buygold") f.failReads();
    return result;
  };
  await assert.rejects(
    f.runner().run("account-a", {}, settings),
    /Cannot read server state/,
  );
  assert.equal(f.calls.filter((c) => c.cmd === "system_buygold").length, 1);
  assert.equal(
    f.calls.filter((c) => c.cmd === "task_claimdailypoint").length,
    0,
  );
});

test("server day rollover stops the old run instead of assuming its tasks are complete", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "system_buygold") f.role.dailyTask.dailyTime++;
    return result;
  };
  await assert.rejects(
    f.runner().run("account-a", {}, settings),
    /服务器每日任务已重置/,
  );
  assert.equal(
    f.calls.filter((c) => c.cmd === "task_claimdailypoint").length,
    0,
  );
});

test("point rewards only include server-confirmed eligible unclaimed IDs", async () => {
  const f = fixture();
  f.role.dailyTask.dailyPoint = 40;
  f.role.dailyTask.dailyReward[1] = true;
  f.role.dailyTask.weekPoint = 150;
  await f.runner().run("account-a", {}, settings);
  assert.deepEqual(
    f.calls
      .filter((c) => c.cmd === "task_claimdailyreward")
      .map((c) => c.params.rewardId),
    [2],
  );
  assert.deepEqual(
    f.calls
      .filter((c) => c.cmd === "task_claimweekreward")
      .map((c) => c.params.rewardId),
    [1],
  );
});

test("stopping and missing server task data produce no game writes", async () => {
  const f = fixture();
  await assert.rejects(
    f.runner().run("account-a", { shouldStop: () => true }, settings),
    /任务已停止/,
  );
  assert.equal(f.calls.length, 0);
  f.role.dailyTask.complete = null;
  await assert.rejects(f.runner().run("account-a", {}, settings), /列表不完整/);
  assert.equal(f.calls.filter((c) => !["role_getroleinfo", "task_checkdailytask"].includes(c.cmd)).length, 0);
});

test("a command acknowledgement without changed server progress is not completion", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "system_buygold") f.role.dailyTask.complete[6] = 2;
    return result;
  };
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(result.deferred, 1);
  assert.equal(
    f.calls.filter((c) => c.cmd === "task_claimdailypoint").length,
    0,
  );
});

test("lost acknowledgement after server execution is resolved by a fresh list on retry", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  let failed = false;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "system_buygold" && !failed) {
      failed = true;
      throw new Error("Acknowledgement lost");
    }
    return result;
  };
  await assert.rejects(
    f.runner().run("account-a", {}, settings),
    /Acknowledgement lost/,
  );
  await f.runner().run("account-a", {}, settings);
  assert.equal(f.calls.filter((c) => c.cmd === "system_buygold").length, 1);
});

test("a role response arriving after disconnect is discarded before game operations", async () => {
  const f = fixture({ 6: 2 });
  const read = f.store.sendGetRoleInfo;
  f.store.sendGetRoleInfo = async () => {
    const response = await read();
    f.disconnect();
    return response;
  };
  await assert.rejects(
    f.runner().run("account-a", {}, settings),
    /WebSocket 已断开/,
  );
  assert.equal(f.calls.filter((c) => !["role_getroleinfo", "task_checkdailytask"].includes(c.cmd)).length, 0);
});

test("different accounts are judged by their own server response", async () => {
  const a = fixture();
  const b = fixture({ 6: 2 });
  await Promise.all([
    a.runner().run("account-a", {}, settings),
    b.runner().run("account-b", {}, settings),
  ]);
  assert.equal(a.calls.filter((c) => c.cmd === "system_buygold").length, 0);
  assert.equal(b.calls.filter((c) => c.cmd === "system_buygold").length, 1);
});

test("two entry points cannot execute the same account concurrently", async () => {
  const f = fixture();
  const original = f.store.sendGetRoleInfo;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  let entered;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  f.store.sendGetRoleInfo = async () => {
    entered();
    await blocked;
    return original();
  };
  const first = f.runner().run("account-a", {}, settings);
  await reading;
  await assert.rejects(f.runner().run("account-a", {}, settings), /正在执行中/);
  release();
  await first;
});

test("used free recruitment is not repeated when only one server recruitment remains", async () => {
  const f = fixture({ 4: 1 });
  f.role.statistics["recruit:one:free"] = f.role.dailyTask.dailyTime + 10;
  await f.runner().run("account-a", {}, settings);
  const recruitment = f.calls.filter((call) => call.cmd === "hero_recruit");
  assert.equal(recruitment.length, 1);
  assert.equal(recruitment[0].params.recruitType, 1);
  assert.equal(recruitment[0].params.recruitNumber, 1);
});

test("disabled actions remain visibly unfinished according to the server", async () => {
  const f = fixture({ 5: 2 });
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(result.remainingTasks, 1);
  assert.equal(result.unclaimedTasks, 0);
  assert.equal(
    f.calls.filter((call) => call.cmd === "system_claimhangupreward").length,
    0,
  );
});

test("claimed tasks do not cause one role query per skipped reward", async () => {
  const f = fixture();
  await f.runner().run("account-a", {}, settings);
  assert.equal(f.calls.filter((c) => c.cmd === "role_getroleinfo").length, 3);
});

test("server-claimed sign-in, cards and free gacha are not requested again", async () => {
  const f = fixture();
  const stamp = f.role.dailyTask.dailyTime + 10;
  f.role.signInReward = { 1: stamp };
  f.role.cardTime = {
    1: { lastClaimTime: stamp },
    4003: { lastClaimTime: stamp },
  };
  f.role.statistics["gacha:free"] = stamp;
  await f.runner().run("account-a", {}, { ...settings, freeGachaEnable: true });
  for (const cmd of [
    "system_signinreward",
    "card_claimreward",
    "gacha_drawreward",
  ])
    assert.equal(f.calls.filter((c) => c.cmd === cmd).length, 0);
  assert.equal(
    f.calls.filter((c) => c.cmd === "collection_claimfreereward").length,
    0,
  );
});

test("a failed formation query never triggers a forced switch", async () => {
  const f = fixture();
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "presetteam_getinfo") throw new Error("Network timeout");
    return send(...args);
  };
  await assert.rejects(
    f.runner().switchToFormationIfNeeded("account-a", 2, "Test"),
    /Network timeout/,
  );
  assert.equal(
    f.calls.filter((c) => c.cmd === "presetteam_saveteam").length,
    0,
  );
});

test("unchanged formations are not queried again just to restore them", async () => {
  const f = fixture();
  await f.runner().run("account-a", {}, settings);
  assert.equal(f.calls.filter((c) => c.cmd === "presetteam_getinfo").length, 1);
  assert.equal(
    f.calls.filter((c) => c.cmd === "presetteam_saveteam").length,
    0,
  );
});

test("hang-up resumes from the server deficit and never substitutes share commands", async () => {
  const f = fixture({ 5: 3 });
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "system_claimhangupreward") f.role.dailyTask.complete[5]++;
    return result;
  };
  const progress = [];
  await f
    .runner()
    .run(
      "account-a",
      { onProgress: (value) => progress.push(value) },
      { ...settings, claimHangUp: true },
    );
  assert.equal(
    f.calls.filter((c) => c.cmd === "system_claimhangupreward").length,
    2,
  );
  assert.equal(
    f.calls.filter((c) => c.cmd === "system_mysharecallback" && c.params.type === 2).length,
    0,
  );
  assert.equal(f.role.dailyTask.complete[5], -1);
  assert.deepEqual(progress, [90, 100]);
  f.calls.length = 0;
  await f.runner().run("account-a", {}, { ...settings, claimHangUp: true });
  assert.equal(
    f.calls.filter((c) => c.cmd === "system_claimhangupreward").length,
    0,
  );
});

test("three unfinished gold operations do not query role info between actions", async () => {
  const f = fixture({ 6: 0 });
  await f.runner().run("account-a", {}, settings);
  const gold = f.calls
    .map((c, i) => (c.cmd === "system_buygold" ? i : -1))
    .filter((i) => i >= 0);
  assert.equal(gold.length, 3);
  assert.equal(
    f.calls
      .slice(gold[0] + 1, gold[2])
      .filter((c) => c.cmd === "role_getroleinfo").length,
    0,
  );
  assert.equal(f.calls.filter((c) => c.cmd === "role_getroleinfo").length, 4);
});

test("rate limits stop once without retries, polling or subsequent writes", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  let attempts = 0;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "system_buygold") {
      attempts++;
      throw new Error("200400 操作太快");
    }
    return send(...args);
  };
  await assert.rejects(f.runner().run("account-a", {}, settings), /200400/);
  assert.equal(attempts, 1);
  assert.equal(f.calls.filter((c) => c.cmd === "role_getroleinfo").length, 1);
  assert.equal(
    f.calls.filter((c) => c.cmd === "task_claimdailypoint").length,
    0,
  );
});

test("a failed initial query is not retried and does not start game operations", async () => {
  const f = fixture();
  let reads = 0;
  f.store.sendGetRoleInfo = async (id, params, retryCount) => {
    assert.equal(retryCount, 2);
    reads++;
    throw new Error("200400 操作太快");
  };
  await assert.rejects(f.runner().run("account-a", {}, settings), /200400/);
  assert.equal(reads, 1);
  assert.deepEqual(f.calls.map(call => call.cmd), ["task_checkdailytask"]);
});

test("free and paid recruitment together never exceed the initial server deficit", async () => {
  const f = fixture({ 4: 0 });
  await f.runner().run("account-a", {}, settings);
  const calls = f.calls.filter((c) => c.cmd === "hero_recruit");
  assert.equal(calls.length, 2);
  assert.equal(
    calls.reduce((total, c) => total + c.params.recruitNumber, 0),
    2,
  );
});

test("an explicit unavailable-card response does not interrupt remaining daily tasks", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "card_claimreward")
      throw new Error("服务器错误: 1400010 - 没有购买月卡");
    return send(...args);
  };
  await f.runner().run("account-a", {}, settings);
  assert.equal(f.role.dailyTask.complete[6], -1);
});

test("box business error 400122 fails only that task and leaves it pending on the server", async () => {
  const f = fixture({ 7: 0 });
  const send = f.store.sendMessageWithPromise;
  let boxRequests = 0;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "item_openbox") {
      boxRequests++;
      assert.equal(args[2].itemId, 2001);
      assert.equal(args[2].number, 10);
      throw new Error("服务器错误: 400122 - 未知错误");
    }
    return send(...args);
  };
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(boxRequests, 1);
  assert.ok(f.calls.some((c) => c.cmd === "presetteam_getinfo"));
  assert.equal(f.role.dailyTask.complete[7], 0);
  assert.equal(result.failed, 1);
  assert.equal(result.remainingTasks, 1);
  assert.equal(result.incomplete, 1);
  assert.equal(
    f.calls.filter(
      (c) => c.cmd === "task_claimdailypoint" && c.params.taskId === 7,
    ).length,
    0,
  );
});

test("logs update execution immediately and only confirm completion from server checkpoints", async () => {
  const f = fixture({ 6: 2 });
  const logs = [];
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "system_buygold") {
      assert.ok(logs.some((log) => log.includes("执行中: 免费点金")));
      assert.ok(!logs.some((log) => log.includes("点金: 3/3")));
    }
    return send(...args);
  };
  await f
    .runner({ verboseLogs: true })
    .run("account-a", { onLog: (log) => logs.push(log.message) }, settings);
  const initial = logs.findIndex((log) => log.includes("点金: 2/3 · 未完成"));
  const claimable = logs.findIndex((log) =>
    log.includes("点金: 3/3 · 已完成，待领奖"),
  );
  const claimed = logs.findIndex((log) =>
    log.includes("点金: 3/3 · 已完成并领奖"),
  );
  assert.ok(initial >= 0 && claimable > initial && claimed > claimable);
  assert.ok(logs.some((log) => log.includes("请求成功，待服务器确认任务状态")));
  assert.ok(logs.some((log) => log.includes("本轮步骤处理进度:")));
  assert.equal(f.calls.filter((c) => c.cmd === "role_getroleinfo").length, 4);
});

test("already completed actions omitted from the plan still appear as skipped in logs", async () => {
  const f = fixture();
  const logs = [];
  await f
    .runner({ verboseLogs: true })
    .run("account-a", { onLog: (log) => logs.push(log.message) }, settings);
  assert.equal(
    logs.filter((log) => log === "点金: 3/3 · 已完成并领奖，跳过").length,
    1,
  );
  assert.ok(!logs.some((log) => log.includes("执行中: 免费点金")));
  assert.equal(f.calls.filter((c) => c.cmd === "role_getroleinfo").length, 3);
});

test("a reward acknowledgement without a server claim remains pending in the final result", async () => {
  const f = fixture();
  f.role.dailyTask.dailyPoint = 40;
  f.role.dailyTask.weekPoint = 100;
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (["task_claimdailyreward", "task_claimweekreward"].includes(args[1]))
      return {};
    return send(...args);
  };
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(result.remainingRewards, 3);
  assert.equal(result.incomplete, 3);
  assert.equal(summarizeScheduledAccount([result.incomplete ? "pending" : "completed", "completed"]), "pending");
});

test("pending counts include distinct supplemental failures without counting a failed daily goal twice", async () => {
  const f = fixture({ 6: 2 });
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "system_buygold")
      throw new Error("服务器错误: 400010 - 物品不足");
    if (args[1] === "discount_claimreward")
      throw new Error("服务器错误: 1000020 - 今天已经领取过奖励了");
    return send(...args);
  };
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(result.failed, 2);
  assert.equal(result.remainingTasks, 1);
  assert.equal(result.incomplete, 2);
});

test("钻石宝箱联动只补一次招募且不重复开启木箱", async () => {
  const f = fixture({ 4: 1, 7: 0 });
  f.role.items = { 2005: { quantity: 10 } };
  await f.runner().run("account-a", {}, { ...settings, autoDiamondBoxPaidRecruit: true });
  const recruits = f.calls.filter(c => c.cmd === "hero_recruit");
  assert.equal(recruits.length, 1);
  assert.deepEqual(recruits[0].params, { recruitType: 1, recruitNumber: 1 });
  assert.deepEqual(f.calls.filter(c => c.cmd === "item_openbox").map(c => c.params), [{ itemId: 2005, number: 10 }]);
});

test("钻石宝箱与免费招募合计不超过服务器缺少的两次", async () => {
  const f = fixture({ 4: 0, 7: 0 });
  f.role.items = { 2005: { quantity: 10 } };
  await f.runner().run("account-a", {}, { ...settings, autoDiamondBoxPaidRecruit: true });
  const recruits = f.calls.filter(c => c.cmd === "hero_recruit");
  assert.equal(recruits.reduce((n,c) => n + c.params.recruitNumber, 0), 2);
  assert.deepEqual(recruits.map(c => c.params.recruitType), [1,3]);
});

test("任务返回的角色增量继续合并供本地扩展功能使用", async () => {
  const f = fixture({ 6: 2 });
  f.role.items = { 2005: { quantity: 20 }, 1021: { quantity: 8 } };
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "system_buygold") return { role: { items: { 2005: { quantity: 15 } } } };
    return result;
  };
  const runner = f.runner();
  const original = runner.claimCollectionFreeRewardIfAvailable.bind(runner);
  runner.claimCollectionFreeRewardIfAvailable = async (id) => {
    const role = await runner.getLatestRole(id);
    assert.equal(role.items[2005].quantity, 15);
    assert.equal(role.items[1021].quantity, 8);
    return original(id);
  };
  await runner.run("account-a", {}, settings);
});

test("扩展任务即使捕获限流错误也不能继续发送后续请求", async () => {
  const f = fixture(); f.role.levelId = 1000;
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "fixture_dream") throw new Error("服务器错误: 200400 - 操作太快");
    return send(...args);
  };
  const runner = f.runner();
  runner.runDreamTask = async id => {
    try { await runner.executeGameCommand(id,"fixture_dream"); } catch { /* Existing feature may handle an error locally. */ }
    await runner.executeGameCommand(id,"fixture_after_failure");
  };
  await assert.rejects(runner.run("account-a", {}, { ...settings,dreamEnable:true }), /200400/);
  assert.equal(f.calls.filter(c => c.cmd === "fixture_after_failure").length,0);
});

test("梦境扩展切换阵容后请求超时仍恢复原阵容", async () => {
  const f = fixture(); f.role.levelId = 1000;
  let teamId = 1;
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "presetteam_getinfo") return { presetTeamInfo: { useTeamId:teamId } };
    if (args[1] === "presetteam_saveteam") teamId = args[2].teamId;
    if (args[1] === "fixture_dream") throw new Error("Network timeout");
    return send(...args);
  };
  const runner = f.runner();
  runner.runDreamTask = async id => {
    await runner.switchToFormationIfNeeded(id,2,"梦境");
    await runner.executeGameCommand(id,"fixture_dream");
  };
  await assert.rejects(runner.run("account-a", {}, { ...settings,dreamEnable:true }), /Network timeout/);
  assert.deepEqual(f.calls.filter(c=>c.cmd === "presetteam_saveteam").map(c=>c.params.teamId),[2,1]);
  assert.equal(teamId,1);
});

test("逐鹿盐山日常缺省关闭，只有显式启用才加入日常步骤", async () => {
  for (const enabled of [undefined, false, true]) {
    const f = fixture();
    const runner = f.runner();
    let calls = 0;
    runner.runApexTask = async () => { calls++; return { status: "completed" }; };
    await runner.run("account-a", {}, { ...settings, apexDailyEnable: enabled });
    assert.equal(calls, enabled === true ? 1 : 0);
  }
});

test("竞技场日常只缺1次时仍固定打3场，完成后重跑不再触发", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026,9,12,10).getTime() });
  const f=fixture({13:0}),original=f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise=async(id,cmd,params)=>{
    if(cmd==="arena_getareatarget")return {roleList:[{roleId:123}]};
    if(cmd==="fight_startareaarena") { f.calls.push({cmd,params});f.role.dailyTask.complete[13]++;return {}; }
    return original(id,cmd,params);
  };
  await f.runner().run("account-a",{}, {...settings,arenaEnable:true});
  assert.equal(f.calls.filter(x=>x.cmd==="fight_startareaarena").length,3);
  await f.runner().run("account-a",{}, {...settings,arenaEnable:true});
  assert.equal(f.calls.filter(x=>x.cmd==="fight_startareaarena").length,3);
});

function pacedRewardFixture(progress = {}) {
  const f = fixture(progress);
  f.role.dailyTask.dailyPoint = 40;
  f.role.dailyTask.weekPoint = 200;
  let time = 0;
  const waits = [];
  const timestamps = [];
  const send = f.store.sendMessageWithPromise;
  const read = f.store.sendGetRoleInfo;
  f.store.sendMessageWithPromise = async (...args) => {
    timestamps.push({ cmd: args[1], time });
    return send(...args);
  };
  f.store.sendGetRoleInfo = async (...args) => {
    timestamps.push({ cmd: "role_getroleinfo", time });
    return read(...args);
  };
  const runner = new DailyTaskRunner(f.store, { commandDelay: 0, taskDelay: 0 }, {
    loadConfig: async () => config,
    now: () => time,
    sleep: async ms => { waits.push(ms); time += ms; },
  });
  return { ...f, runner, waits, timestamps };
}

test("领奖低延迟仍保证1秒间隔，日周共用查询且最终确认", async () => {
  const f = pacedRewardFixture({ 6: 3 });
  const result = await f.runner.run("account-a", {}, settings);
  const firstClaim = f.timestamps.findIndex(c => c.cmd === "task_claimdailypoint");
  for (let i = firstClaim; i < f.timestamps.length; i++)
    assert.ok(f.timestamps[i].time - f.timestamps[i - 1].time >= 1000);
  assert.equal(f.calls.filter(c => c.cmd === "role_getroleinfo").length, 4);
  assert.equal(result.remainingRewards, 0);
});

test("领奖遵守用户设置的更长延迟", async () => {
  const f = pacedRewardFixture();
  f.runner.delaySettings.commandDelay = 2200;
  await f.runner.run("account-a", {}, settings);
  const rewards = f.timestamps.filter(c => /task_claim.*reward/.test(c.cmd));
  for (let i = 1; i < rewards.length; i++)
    assert.ok(rewards[i].time - rewards[i - 1].time >= 2200);
});

for (const cmd of ["task_claimdailypoint", "task_claimdailyreward", "task_claimweekreward"]) {
  test(`${cmd}首次限流冷却1.5秒，查询后仅重试一次`, async () => {
    const f = pacedRewardFixture({ 6: 3 });
    const send = f.store.sendMessageWithPromise;
    let attempts = 0;
    f.store.sendMessageWithPromise = async (...args) => {
      if (args[1] === cmd && ++attempts === 1)
        throw Object.assign(new Error("服务器错误: 200400 - 操作太快"), { code: 200400 });
      return send(...args);
    };
    const result = await f.runner.run("account-a", {}, settings);
    assert.equal(attempts, cmd === "task_claimdailypoint" ? 2 : 3);
    assert.ok(f.waits.includes(1500));
    assert.equal(f.calls.filter(c => c.cmd === "role_getroleinfo").length, 5);
    assert.equal(result.incomplete, 0);
  });
}

for (const message of ["服务器错误: 200400 - 操作太快", "请求超时: task_claimdailyreward"]) {
  test(`${message}但查询确认已领，不重复发送`, async () => {
    const f = pacedRewardFixture();
    const send = f.store.sendMessageWithPromise;
    let firstAttempts = 0;
    f.store.sendMessageWithPromise = async (...args) => {
      if (args[1] === "task_claimdailyreward" && args[2].rewardId === 1) {
        firstAttempts++;
        await send(...args);
        throw new Error(message);
      }
      return send(...args);
    };
    const result = await f.runner.run("account-a", {}, settings);
    assert.equal(firstAttempts, 1);
    assert.equal(result.remainingRewards, 0);
  });
}

test("再次限流停止本轮，后续日周档位不发送", async () => {
  const f = pacedRewardFixture();
  const send = f.store.sendMessageWithPromise;
  let attempts = 0;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "task_claimdailyreward") {
      attempts++;
      throw new Error("服务器错误: 200400 - 操作太快");
    }
    return send(...args);
  };
  await assert.rejects(f.runner.run("account-a", {}, settings), /200400/);
  assert.equal(attempts, 2);
  assert.equal(f.calls.filter(c => c.cmd === "task_claimweekreward").length, 0);
});

test("领奖超时且查询仍未领取，不盲目重试", async () => {
  const f = pacedRewardFixture();
  const send = f.store.sendMessageWithPromise;
  let attempts = 0;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "task_claimdailyreward") {
      attempts++;
      throw new Error("请求超时: task_claimdailyreward");
    }
    return send(...args);
  };
  await assert.rejects(f.runner.run("account-a", {}, settings), /请求超时/);
  assert.equal(attempts, 1);
});

for (const changed of ["disconnect", "dailyTime", "weekTime", "readFailure"]) {
  test(`领奖限流后${changed}阻止重发`, async () => {
    const f = pacedRewardFixture();
    f.role.dailyTask.weekTime = 1699833600;
    const send = f.store.sendMessageWithPromise;
    let attempts = 0;
    f.store.sendMessageWithPromise = async (...args) => {
      if (args[1] === "task_claimdailyreward") {
        attempts++;
        if (changed === "disconnect") f.disconnect();
        else if (changed === "readFailure") f.failReads();
        else f.role.dailyTask[changed]++;
        throw new Error("服务器错误: 200400 - 操作太快");
      }
      return send(...args);
    };
    await assert.rejects(f.runner.run("account-a", {}, settings));
    assert.equal(attempts, 1);
  });
}

for (const cmd of ["task_claimdailyreward", "task_claimweekreward"]) {
  test(`${cmd}返回200020但服务器确认已领取，继续后续档位且不重发`, async () => {
    const f = pacedRewardFixture();
    const send = f.store.sendMessageWithPromise;
    let attempts = 0;
    f.store.sendMessageWithPromise = async (...args) => {
      if (args[1] === cmd && args[2].rewardId === 1) {
        attempts++;
        await send(...args);
        throw new Error("服务器错误: 200020 - 出了点小问题");
      }
      return send(...args);
    };
    const result = await f.runner.run("account-a", {}, settings);
    assert.equal(attempts, 1);
    assert.equal(result.remainingRewards, 0);
    assert.equal(f.calls.filter(c => c.cmd === "role_getroleinfo").length, 4);
  });
}

test("200020核对未领取，不重发且待核对日志使用最新状态", async () => {
  const f = pacedRewardFixture();
  f.runner.verboseLogs = true;
  const send = f.store.sendMessageWithPromise;
  const logs = [];
  const callbacks = { onLog: entry => logs.push(entry.message) };
  let attempts = 0;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "task_claimdailyreward" && args[2].rewardId === 2) {
      attempts++;
      throw new Error("服务器错误: 200020 - 出了点小问题");
    }
    return send(...args);
  };
  const result = await f.runner.run("account-a", callbacks, settings);
  assert.equal(attempts, 1);
  assert.equal(result.remainingRewards, 1);
  assert.ok(logs.includes("日活跃奖励待核对档位（最近快照）：2"));
  assert.ok(logs.some(x => x.includes("领取日常积分奖励1 - 请求成功，待服务器确认任务状态")));
});

for (const changed of ["disconnect", "dailyTime", "weekTime", "readFailure"]) {
  test(`200020核对时${changed}停止且不重发`, async () => {
    const f = pacedRewardFixture();
    f.role.dailyTask.weekTime = 1699833600;
    const send = f.store.sendMessageWithPromise;
    let attempts = 0;
    f.store.sendMessageWithPromise = async (...args) => {
      if (args[1] === "task_claimdailyreward") {
        attempts++;
        if (changed === "disconnect") f.disconnect();
        else if (changed === "readFailure") f.failReads();
        else f.role.dailyTask[changed]++;
        throw new Error("服务器错误: 200020 - 出了点小问题");
      }
      return send(...args);
    };
    await assert.rejects(f.runner.run("account-a", {}, settings));
    assert.equal(attempts, 1);
  });
}

test("领奖角色增量同步到执行状态，保留未返回的其他字段", async () => {
  const f = pacedRewardFixture();
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    const result = await send(...args);
    if (args[1] === "task_claimdailyreward" && args[2].rewardId === 1) {
      // Simulate an authoritative update that also marks the next tier claimed.
      f.role.dailyTask.dailyReward[2] = true;
      return { role: { dailyTask: { dailyReward: { 1: true, 2: true } } } };
    }
    return result;
  };
  const result = await f.runner.run("account-a", {}, settings);
  assert.deepEqual(f.calls.filter(c => c.cmd === "task_claimdailyreward").map(c => c.params.rewardId), [1]);
  assert.equal(result.remainingRewards, 0);
  assert.equal(f.runner.roleData.dailyTask.dailyPoint, 40);
  assert.equal(f.calls.filter(c => c.cmd === "role_getroleinfo").length, 3);
});

test("精简日志减少一半以上输出，并保留相同请求、进度回调及核对结果", async () => {
  const execute = async verboseLogs => {
    const f = fixture({ 6: 2 });
    const logs = [], progress = [];
    const result = await f.runner({ verboseLogs }).run("account-a", {
      onLog: entry => logs.push(entry), onProgress: value => progress.push(value),
    }, settings);
    return { logs, progress, result, calls: f.calls };
  };
  const concise = await execute(false), verbose = await execute(true);
  assert.deepEqual(concise.calls, verbose.calls);
  assert.deepEqual(concise.result, verbose.result);
  assert.deepEqual(concise.progress, verbose.progress);
  assert.ok(concise.logs.length < verbose.logs.length / 2, `${concise.logs.length}/${verbose.logs.length}`);
  assert.ok(concise.logs.some(entry => /免费点金.*已执行/.test(entry.message)));
  assert.ok(concise.logs.some(entry => entry.message.includes("日常已完成：")));
  assert.ok(!concise.logs.some(entry => /领奖阶段请求|本轮步骤处理进度|请求成功，待服务器确认/.test(entry.message)));
});

test("精简模式保留错误、未完成原因与奖励核对，不把请求成功误报任务完成", async () => {
  const f = fixture({ 6: 2 });
  const originalSend = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "system_buygold") throw new Error("服务器错误: 400010 - 物品不足");
    return originalSend(...args);
  };
  const logs = [];
  const result = await f.runner().run("account-a", { onLog: entry => logs.push(entry) }, settings);
  assert.ok(result.incomplete > 0);
  assert.ok(logs.some(entry => entry.type === "error" && entry.message.includes("物品不足")));
  assert.ok(logs.some(entry => entry.type === "warning" && entry.message.includes("未确认完成")));
  assert.ok(logs.some(entry => entry.message.includes("活跃奖励服务器核对")));
});


test("日志场景：竞技场未开放和通行证无奖励正常跳过，附加竞猜错误不改日常领奖成功", async () => {
  const f = fixture({ 13: 0 });
  f.role.dailyTask.dailyPoint = 40;
  f.role.dailyTask.weekPoint = 100;
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "activity_recyclewarorderrewardclaim")
      throw new Error("服务器错误: 3500020 - 没有可领取的奖励");
    return send(...args);
  };
  const midnight = new Date(); midnight.setHours(0, 10, 0, 0);
  const runner = f.runner({ now: () => midnight.getTime() });
  runner.runApexTask = async () => { throw new Error("竞猜奖励未生效：服务器错误: 200020 - 出了点小问题"); };
  const logs = [];
  const result = await runner.run("account-a", { onLog: entry => logs.push(entry) }, { ...settings, arenaEnable: true, apexDailyEnable: true });
  assert.equal(result.normalSkippedTasks, 1);
  assert.equal(result.dailyIncomplete, 0);
  assert.equal(result.remainingRewards, 0);
  assert.equal(result.failed, 1); // Only the unconfirmed supplemental guess reward.
  assert.equal(result.supplementalWarnings.length, 1);
  assert.match(result.supplementalWarnings[0], /竞猜奖励未生效/);
  assert.equal(getDailyRunStatus(result), "completed");
  assert.equal(summarizeScheduledAccount([getDailyRunStatus(result), "completed"]), "completed");
  assert.ok(!f.calls.some(call => call.cmd === "arena_startarea"));
  assert.ok(logs.some(entry => /竞技场战斗：正常跳过/.test(entry.message)));
  assert.ok(logs.some(entry => /通行证.*正常跳过/.test(entry.message)));
  assert.ok(!logs.some(entry => entry.type === "error" && /通行证/.test(entry.message)));
  assert.ok(logs.some(entry => /日常已完成.*附加任务1项需注意/.test(entry.message)));
});

test("通行证无可领奖励仅处理对应命令和3500020，其他错误不吞掉", async () => {
  for (const [cmd, code] of [["activity_recyclewarorderrewardclaim", 200020], ["task_claimdailyreward", 3500020]]) {
    const f = fixture();
    f.store.sendMessageWithPromise = async () => { throw new Error(`服务器错误: ${code} - 错误`); };
    await assert.rejects(f.runner().executeGameCommand("account-a", cmd), /服务器错误/);
  }
});

test("条件跳过或附加任务成功不能掩盖仍可领取的日常奖励", async () => {
  const f = fixture({ 13: 0 });
  f.role.dailyTask.dailyPoint = 40;
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => args[1] === "task_claimdailyreward" ? {} : send(...args);
  const midnight = new Date(); midnight.setHours(0, 10, 0, 0);
  const result = await f.runner({ now: () => midnight.getTime() }).run("account-a", {}, { ...settings, arenaEnable: true });
  assert.equal(result.normalSkippedTasks, 1);
  assert.equal(result.remainingRewards, 2);
  assert.equal(result.dailyIncomplete, 2);
  assert.equal(getDailyRunStatus(result), "pending");
});

test("周活跃分数未到首档正常跳过，已达标未领才待继续", async () => {
  for (const weekPoint of [0, 99, 100]) {
    const f = fixture();
    f.role.dailyTask.weekPoint = weekPoint;
    const result = await f.runner().run("account-a", {}, settings);
    const claims = f.calls.filter(call => call.cmd === "task_claimweekreward");
    assert.equal(claims.length, weekPoint === 100 ? 1 : 0);
    assert.equal(result.dailyIncomplete, 0);
    assert.equal(getDailyRunStatus(result), "completed");
  }
});

test("关闭的任务不阻塞本轮计划，已完成但未领的积分仍需领取", async () => {
  const f = fixture({ 5: 0, 7: 0, 13: 0, 14: 0, 12: 1 });
  const result = await f.runner().run("account-a", {}, { ...settings, openBox: false, blackMarketPurchase: false });
  assert.equal(result.remainingTasks, 4);
  assert.equal(result.dailyIncomplete, 0);
  assert.ok(f.calls.some(call => call.cmd === "task_claimdailypoint" && call.params.taskId === 9));
  assert.ok(!f.calls.some(call => call.cmd === "item_openbox"));
});

test("礼包与每日BOSS先读状态；已领及最高伤害达标不重复发送写请求", async () => {
  const f = fixture();
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "discount_getdiscountinfo") { f.calls.push({ cmd: args[1] }); return { discountList: [{ discountId: 1, discountState: 3 }] }; }
    if (args[1] === "boss_getstate") { f.calls.push({ cmd: args[1] }); return { hurt: 1000 }; }
    return send(...args);
  };
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(getDailyRunStatus(result), "completed");
  assert.ok(!f.calls.some(call => ["discount_claimreward", "fight_startboss"].includes(call.cmd)));
  assert.equal(f.calls.filter(call => call.cmd === "boss_getstate").length, 1);
});

test("配置任务真实失败不能仅降级附加提醒，保留精确原因", async () => {
  const f = fixture();
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "discount_claimreward") throw new Error("服务器错误: 200020 - 礼包领取失败");
    return send(...args);
  };
  const result = await f.runner().run("account-a", {}, settings);
  assert.equal(result.dailyIncomplete, 0);
  assert.equal(getDailyRunStatus(result), "failed");
  assert.ok(result.reasons.some(reason => /领取每日礼包.*200020.*礼包领取失败/.test(reason)));
});

test("捕获的梦境异常不能算完成，正常停止不算失败", async () => {
  for (const pushError of [undefined, "推层查询错误200020"]) {
    const f = fixture(); f.role.levelId = 1000;
    const runner = f.runner();
    runner.runDreamTask = async () => ({ status: "stopped", reason: "吕布无法继续", pushError });
    const result = await runner.run("account-a", {}, { ...settings, dreamEnable: true });
    assert.equal(getDailyRunStatus(result), pushError ? "failed" : "completed");
    if (pushError) assert.ok(result.reasons.some(reason => reason.includes(pushError)));
  }
});

test("免费钓鱼补剩余2次，共用快照且月度阶段不因增量缺字段重复免费预算", async () => {
  const f = fixture();
  f.role.statistics["ar:normal:lo:cnt"] = 1;
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "artifact_lottery") f.role.statistics["ar:normal:lo:cnt"]++;
    return send(...args); // Deliberately no statistics patch.
  };
  const runner = f.runner();
  runner.runMonthlyFishTopUp = async id => runner.runFreeFishingTask(id, await runner.getLatestRole(id), 5);
  const result = await runner.run("account-a", {}, { ...settings, monthlyFishTopUpEnable: true });
  assert.equal(f.calls.filter(call => call.cmd === "artifact_lottery").length, 2);
  assert.equal(getDailyRunStatus(result), "completed");
  assert.ok(f.calls.filter(call => call.cmd === "role_getroleinfo").length <= 4);
});

test("任务同步一次，正常领奖集中查询，不因档位数量逐档查询角色", async () => {
  const f = fixture({ 6: 3, 7: 20, 12: 1 });
  f.role.dailyTask.weekPoint = 200;
  await f.runner().run("account-a", {}, settings);
  assert.equal(f.calls.filter(call => call.cmd === "task_checkdailytask").length, 1);
  assert.ok(f.calls.findIndex(call => call.cmd === "task_checkdailytask") < f.calls.findIndex(call => call.cmd === "role_getroleinfo"));
  const roleQueries = f.calls.filter(call => call.cmd === "role_getroleinfo");
  assert.ok(roleQueries.length <= 4);
  const claims = f.calls.filter(call => call.cmd.startsWith("task_claim"));
  assert.ok(claims.length > roleQueries.length);
  assert.equal(f.calls.filter(call => call.cmd === "discount_getdiscountinfo").length, 1);
});

test("执行中断在抛出错误上保留步骤与原因供批量通知", async () => {
  const f = fixture();
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    if (args[1] === "discount_getdiscountinfo") throw new Error("请求超时: discount_getdiscountinfo");
    return send(...args);
  };
  await assert.rejects(f.runner().run("account-a", {}, settings), error => error.dailyReasons.some(reason => /领取每日礼包.*请求超时/.test(reason)));
});

test("业务错误后也保持查询/操作间隔，阵容恢复仍可执行", async () => {
  const f = fixture(); let clock = Date.parse("2026-10-18T12:00:00+08:00");
  const sent = [];
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (...args) => {
    sent.push({ cmd: args[1], time: clock });
    if (args[1] === "discount_claimreward") throw new Error("服务器错误: 200020 - 临时错误");
    return send(...args);
  };
  const read = f.store.sendGetRoleInfo;
  f.store.sendGetRoleInfo = async (...args) => { sent.push({ cmd: "role_getroleinfo", time: clock }); return read(...args); };
  await f.runner({ now: () => clock, sleep: async ms => { clock += ms; } }).run("account-a", {}, settings);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].time - sent[i-1].time >= 500, `${sent[i-1].cmd} → ${sent[i].cmd}`);
});

for (const [cmd, params, code] of [
  ['fight_startlegionboss', {}, 2300070],
  ['legion_signin', {}, 2300070],
  ['legion_storebuygoods', { id: 5 }, 400000],
  ['legion_storebuygoods', { id: 6 }, 400000],
  ['legion_storebuygoods', { id: 6 }, 400010],
  ['legion_storebuygoods', { id: 5 }, 400010],
  ['legion_storebuygoods', { id: 6 }, 2300370],
  ['store_purchase', {}, 1300050],
  ['store_purchase', {}, 200020],
]) {
  test(`${cmd}/${code} returns normal skip without failure logging`, async () => {
    const f = fixture();
    f.store.sendMessageWithPromise = async () => { throw new Error(`服务器错误: ${code}`); };
    const runner = f.runner();
    const logs = [];
    runner.log = (message, type) => logs.push({ message, type });
    const result = cmd === 'legion_storebuygoods'
      ? await (params.id === 6 ? runner.runHolyBeastFragmentPurchase('account-a') : runner.runWhiteJadePurchase('account-a'))
      : cmd === 'store_purchase' ? await runner.runBlackMarketTask('account-a')
      : await runner.executeGameCommand('account-a', cmd, params, '测试步骤');
    assert.equal(result.status, 'skipped');
    assert.ok(logs.every(log => log.type !== 'error' && !log.message.includes('购买成功')));
  });
}

test('unrelated purchase errors and missing club on other commands remain failures', async () => {
  for (const [cmd, params, code] of [
    ['store_purchase', {}, 400000], ['legion_storebuygoods', { id: 1 }, 400000],
    ['store_buy', {}, 200020], ['store_buy', {}, 1300050],
    ['legion_storebuygoods', { id: 1 }, 400010], ['role_getroleinfo', {}, 2300070],
  ]) {
    const f = fixture();
    f.store.sendMessageWithPromise = async () => { throw Object.assign(new Error('business rejection'), { code }); };
    await assert.rejects(f.runner().executeGameCommand('account-a', cmd, params), /business rejection/);
  }
});

test('empty black market procurement excludes pending progress from incomplete results', async () => {
  const f = fixture({ 12: 0 });
  const send = f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise = async (id, cmd, params) => {
    if (cmd === 'store_purchase') throw Object.assign(new Error('服务器错误: 1300050'), { code: 1300050 });
    return send(id, cmd, params);
  };
  const result = await f.runner().run('account-a', {}, settings);
  assert.equal(result.dailyIncomplete, 0);
  assert.ok(!result.reasons.some(reason => /黑市/.test(reason)));
  assert.ok(!result.planIssues?.some(issue => /黑市/.test(issue.task)));
});

for (const quantity of [undefined, 0, 99]) {
  test(`白玉采购盐锭库存${quantity}正常跳过且不发送购买`, async () => {
    const f = fixture();
    f.store.sendGetRoleInfo = async () => ({ role: { items: quantity === undefined ? {} : { 1019: { quantity } } } });
    const result = await f.runner().runWhiteJadePurchase('account-a');
    assert.equal(result.status, 'skipped');
    assert.match(result.reason, /盐锭不足/);
    assert.ok(!f.calls.some(call => call.cmd === 'legion_storebuygoods'));
  });
}
test('盐锭充足时白玉采购400000也正常跳过', async () => {
  const f = fixture();
  f.store.sendMessageWithPromise = async () => { throw Object.assign(new Error('物品不存在'), { code: 400000 }); };
  const result = await f.runner().runWhiteJadePurchase('account-a');
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /400000/);
});
test('缺少完整库存时不将未知状态当作盐锭不足', async () => {
  const f = fixture();
  f.store.sendGetRoleInfo = async () => ({ role: {} });
  await assert.rejects(f.runner().runWhiteJadePurchase('account-a'), /库存不完整/);
});

for (const code of [undefined, 200020]) {
  test(`黑市进度0/1及采购${code ?? '成功'}不计入日常异常`, async () => {
    const f = fixture({ 12: 0 });
    const send = f.store.sendMessageWithPromise;
    f.store.sendMessageWithPromise = async (...args) => {
      if (args[1] === 'store_purchase' && code) throw Object.assign(new Error('服务器异常（200020）'), { code });
      return send(...args);
    };
    const result = await f.runner().run('account-a', {}, settings);
    assert.equal(result.dailyIncomplete, 0);
    assert.ok(!result.reasons.some(reason => /黑市/.test(reason)));
    assert.ok(!result.planIssues?.some(issue => /黑市/.test(issue.task)));
    assert.equal(result.normalSkippedTasks, 1);
  });
}

test('断线中断与用户主动停止保留不同原因', () => {
  const f = fixture();
  const runner = f.runner();
  f.disconnect();
  assert.throws(() => runner.throwIfInterrupted('account-a'), error => error.interrupted === true && error.connectionLost === true);
  runner.callbacks = { shouldStop: () => true };
  assert.throws(() => runner.throwIfInterrupted('account-a'), error => error.interrupted === true && error.connectionLost === false);
});
