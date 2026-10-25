import assert from "node:assert/strict";
import { test } from "node:test";
import { runWeirdTowerAccount, weirdTowerDate } from "../src/utils/weirdTowerRunner.js";
import { createTasksTower } from "../src/utils/batch/tasksTower.js";

const NOW = Date.parse("2026-10-21T10:00:00+08:00");
const date = weirdTowerDate(NOW);
const task = (Id, type, para) => ({ Id, evoTowerTaskType: type, taskPara: para });
const config = {
  EvoTowerTaskConf: { 1: task(1, 1, 3), 2: task(2, 1, 6), 3: task(3, 1, 10), 4: task(4, 2, 5) },
  EvoTowerShareTasks: { 5: { Id: 5, evoTowerShareTaskGroup: 2, taskPara: 1 } },
  ActMergeBoardConf: { 888: { actId: 888, actMergeFestivalType: 1, column: 7, row: 9, quickMergeCondition: 777,
    costItem: [{ type: 55, itemId: 37001, value: 1 }] } },
  ActMergeItemCostProgressConf: { 91: { actId: 888, id: 91, costNum: 2, reward: [{ type: 55, itemId: 37001, value: 1 }] } },
  ActMergeProgressConf: { 777: { actId: 888, id: 777 } },
  ActMergeItemConf: { 1: { mergeItemId: 1, nextLevelMergeItemId: 2 }, 2: { mergeItemId: 2, nextLevelMergeItemId: 0 } },
  ActMergeBoxConf: { 9: { boxId: 9, useTimes: 500 } },
};
const snapshot = value => structuredClone(value);
function fixture() {
  const state = {
    tower: { towerId: 0, rewardTowerId: 0, energy: 0, lotteryLeftCnt: 0, taskMap: { [date]: {} }, taskClaimMap: { [date]: {} }, legionTaskMap: {}, legionTaskClaimMap: {}, orderPassReward: {} },
    box: { actType: 1, actId: 888, freeEnergy: 0, costTotalCnt: 0, costClaimCnt: 0, taskMap: {}, taskClaimMap: {},
      gridMap: { 4: { 5: { gridType: 1, gridItemId: 9, isLock: false, openCnt: 0 } } } },
    role: { legionId: 0, statistics: {}, items: {} }, activity: { warOrderActivityInfo: {} }, share: { shareTaskMap: {} }, team: 1,
  };
  const calls = [], pauses = [];
  let itemX = 1;
  const send = async (cmd, params) => {
    calls.push({ cmd, params });
    if (cmd === "evotower_getinfo") return { evoTower: snapshot(state.tower) };
    if (cmd === "mergebox_getinfo") return { mergeBox: snapshot(state.box) };
    if (cmd === "role_getroleinfo") return { role: snapshot(state.role) };
    if (cmd === "activity_get") return { activity: snapshot(state.activity) };
    if (cmd === "evotower_getshareinfo") return { shareTask: snapshot(state.share) };
    if (cmd === "presetteam_getinfo") return { presetTeamInfo: { useTeamId: state.team } };
    if (cmd === "presetteam_saveteam") { state.team = params.teamId; return {}; }
    if (cmd === "evotower_readyfight") return {};
    if (cmd === "evotower_fight") {
      state.tower.towerId++; state.tower.energy--;
      for (const id of [1, 2, 3]) state.tower.taskMap[date][id] = (state.tower.taskMap[date][id] || 0) + 1;
      return { evoTower: { towerId: state.tower.towerId } };
    }
    if (cmd === "evotower_claimreward") {
      state.tower.rewardTowerId++; state.tower.lotteryLeftCnt++;
      return { evoTower: { rewardTowerId: state.tower.rewardTowerId } };
    }
    if (cmd === "evotower_claimtask") { state.tower.taskClaimMap[date][params.taskId] = 1; return { evoTower: { taskClaimMap: { [date]: { [params.taskId]: 1 } } } }; }
    if (cmd === "evotower_claimlegiontask") { state.tower.legionTaskClaimMap[params.taskId] = 1; state.tower.lotteryLeftCnt++; return { evoTower: { legionTaskClaimMap: { [params.taskId]: 1 } } }; }
    if (cmd === "evotower_claimsharetaskreward") { state.share.shareTaskMap[2].claimedProgress = 1; state.tower.lotteryLeftCnt++; return { shareTask: snapshot(state.share) }; }
    if (cmd === "mergebox_claimfreeenergy") { state.tower.lotteryLeftCnt += state.box.freeEnergy; state.box.freeEnergy = 0; return { mergeBox: { freeEnergy: 0 } }; }
    if (cmd === "mergebox_claimcostprogress") { state.box.costClaimCnt = 2; state.tower.lotteryLeftCnt++; return { mergeBox: { costClaimCnt: 2 } }; }
    if (cmd === "mergebox_claimmergeprogress") { state.box.taskClaimMap[params.taskId] = 1; return { mergeBox: { taskClaimMap: { [params.taskId]: 1 } } }; }
    if (cmd === "mergebox_openbox") {
      assert.ok(state.tower.lotteryLeftCnt > 0);
      state.tower.lotteryLeftCnt--; state.box.costTotalCnt++;
      state.box.gridMap[4][5].openCnt++;
      state.box.gridMap[itemX] ||= {};
      state.box.gridMap[itemX][1] = { gridType: 2, gridConfId: 0, gridItemId: 1 };
      itemX++;
      return { mergeBox: snapshot(state.box) };
    }
    if (cmd === "mergebox_mergeitem" || cmd === "mergebox_automergeitem") {
      let source, target;
      if (cmd === "mergebox_mergeitem") {
        source = params.sourcePos; target = params.targetPos;
      } else {
        const pairs = Object.entries(state.box.gridMap).filter(([, column]) => column[1]?.gridType === 2 && column[1]?.gridItemId === 1);
        [source, target] = pairs.slice(0, 2).map(([x]) => ({ gridX: x, gridY: 1 }));
      }
      assert.ok(source && target);
      delete state.box.gridMap[source.gridX][source.gridY];
      state.box.gridMap[target.gridX][target.gridY].gridItemId = 2;
      state.box.taskMap[777] = 1;
      return { mergeBox: { taskMap: { 777: 1 }, gridMap: { [target.gridX]: { [target.gridY]: { gridType: 2, gridItemId: 2 } } } }, delPosList: [source] };
    }
    assert.fail(`未预期的请求${cmd}`);
  };
  const run = options => runWeirdTowerAccount({ send, config, requestIntervalMs: 0, now: () => NOW, pause: async ms => pauses.push(ms), ...options });
  return { state, calls, send, run, pauses };
}

test("长程爬塔每层仅一次战后查询，任务只在3/6/10次达标时领取", async () => {
  const f = fixture(); f.state.tower.energy = 12;
  const result = await f.run({ mode: "climb", maxClimbs: 12 });
  assert.equal(result.climbed, 12);
  assert.equal(f.calls.filter(c => c.cmd === "evotower_getinfo").length, 13);
  assert.deepEqual(f.calls.filter(c => c.cmd === "evotower_claimtask").map(c => c.params.taskId), [1, 2, 3]);
  assert.deepEqual(f.pauses, Array(12).fill(500));
  assert.equal(f.calls.filter(c => c.cmd === "evotower_readyfight").length, 12);
});

test("所有已达标钥匙先领，使用返还钥匙后继续使用与合成并补领末轮奖励", async () => {
  const f = fixture();
  f.state.tower.towerId = 10;
  f.state.tower.legionTaskMap[4] = 5; f.state.role.legionId = 1;
  f.state.box.freeEnergy = 1;
  f.state.share.shareTaskMap[2] = { progress: 1, claimedProgress: 0 };
  const result = await f.run();
  assert.equal(result.used, 5); // 章节1+俱乐部1+邀请1+免费1+累计返还1
  assert.ok(result.merged > 0);
  assert.equal(f.state.tower.lotteryLeftCnt, 0);
  assert.equal(f.state.box.taskClaimMap[777], 1);
  const firstUse = f.calls.findIndex(c => c.cmd === "mergebox_openbox");
  for (const cmd of ["evotower_claimreward", "evotower_claimlegiontask", "evotower_claimsharetaskreward", "mergebox_claimfreeenergy"]) {
    assert.ok(f.calls.findIndex(c => c.cmd === cmd) < firstUse, cmd);
    assert.equal(f.calls.filter(c => c.cmd === cmd).length, 1);
  }
  assert.equal(f.calls.filter(c => c.cmd === "mergebox_claimcostprogress").length, 1);
  assert.equal(f.calls.filter(c => /buy|acceptshare|invite/i.test(c.cmd)).length, 0);
});

test("未达标、已领取、无俱乐部、未购通行证不盲领", async () => {
  const f = fixture();
  f.state.tower.taskMap[date] = { 1: 2, 2: 6 };
  f.state.tower.taskClaimMap[date][2] = 1;
  f.state.tower.legionTaskMap[4] = 5;
  f.state.share.shareTaskMap[2] = { progress: 0, claimedProgress: 0 };
  await f.run({ mode: "claim" });
  assert.equal(f.calls.some(c => /claim/.test(c.cmd)), false);
});

test("战斗超时已推进只核对不重发，未推进报失败", async () => {
  for (const advanced of [true, false]) {
    const f = fixture(); f.state.tower.energy = 1;
    const send = async (cmd, params) => {
      if (cmd === "evotower_fight") {
        if (advanced) await f.send(cmd, params); else f.calls.push({ cmd, params });
        throw new Error("timeout");
      }
      return f.send(cmd, params);
    };
    if (advanced) assert.equal((await f.run({ mode: "climb", send })).climbed, 1);
    else await assert.rejects(f.run({ mode: "climb", send }), /进度未确认/);
    assert.equal(f.calls.filter(c => c.cmd === "evotower_fight").length, 1);
  }
});

test("钥匙消费超时核对成功才继续，未确认不重发", async () => {
  for (const consumed of [true, false]) {
    const f = fixture(); f.state.tower.lotteryLeftCnt = 1;
    const send = async (cmd, params) => {
      if (cmd === "mergebox_openbox") {
        if (consumed) await f.send(cmd, params); else f.calls.push({ cmd, params });
        throw new Error("timeout");
      }
      return f.send(cmd, params);
    };
    if (consumed) assert.equal((await f.run({ mode: "use", send })).used, 1);
    else await assert.rejects(f.run({ mode: "use", send }), /结果未确认/);
    assert.equal(f.calls.filter(c => c.cmd === "mergebox_openbox").length, 1);
  }
});

test("200400不新增退避或立即重发，异常后恢复阵容", async () => {
  const f = fixture(); f.state.tower.energy = 10;
  const send = async (cmd, params) => {
    if (cmd === "evotower_fight") { f.calls.push({ cmd, params }); throw new Error("服务器错误: 200400"); }
    return f.send(cmd, params);
  };
  await assert.rejects(f.run({ mode: "climb", send, formation: 2 }), /200400/);
  assert.deepEqual(f.calls.filter(c => c.cmd === "presetteam_saveteam").map(c => c.params.teamId), [2, 1]);
  assert.equal(f.calls.filter(c => c.cmd === "evotower_fight").length, 1);
  assert.deepEqual(f.pauses, []);
});

test("智能合成读取当前棋盘quickMergeCondition，未解锁时手动合成", async () => {
  for (const unlocked of [true, false]) {
    const f = fixture();
    f.state.box.gridMap[1] = { 1: { gridType: 2, gridItemId: 1 } };
    f.state.box.gridMap[2] = { 1: { gridType: 2, gridItemId: 1 } };
    if (unlocked) f.state.box.taskMap[777] = 1;
    await f.run({ mode: "merge" });
    assert.equal(f.calls.some(c => c.cmd === "mergebox_automergeitem"), unlocked);
    assert.equal(f.calls.some(c => c.cmd === "mergebox_mergeitem"), !unlocked);
  }
});

test("跨日或主动停止不再消费，停止后仍恢复阵容", async () => {
  const f = fixture(); f.state.tower.energy = 1;
  let stop = false;
  const result = await f.run({ mode: "climb", formation: 2, stopped: () => stop,
    pause: async () => { stop = true; } });
  assert.equal(result.status, "stopped");
  assert.equal(f.state.team, 1);
  assert.equal(f.calls.filter(c => c.cmd === "evotower_getinfo").length, 1);
  let time = NOW;
  const g = fixture(); g.state.box.freeEnergy = 1;
  const send = async (cmd, params) => {
    const data = await g.send(cmd, params);
    if (cmd === "mergebox_claimfreeenergy") time += 86400000;
    return data;
  };
  await assert.rejects(g.run({ send, now: () => time }), /周期已变化/);
  assert.equal(g.calls.some(c => c.cmd === "mergebox_openbox"), false);
});

function batchDeps(accounts) {
  const statuses = {}, connections = [], releases = [], logs = [];
  return { selectedTokens: { value: Object.keys(accounts) }, tokens: { value: Object.keys(accounts).map(id => ({ id, name: id })) },
    tokenStatus: { value: statuses }, isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null },
    batchSettings: { weirdTowerClimbCount: 1, maxActive: 2 }, currentSettings: { towerFormation: 1 },
    weirdTowerRequestOptions: { intervalMs: 0 }, weirdTowerStartOptions: { intervalMs: 0 },
    loadWeirdTowerConfig: async () => config, ensureConnection: async id => connections.push(id), releaseConnectionSlot: () => releases.push(1),
    tokenStore: { sendMessageWithPromise: (id, ...args) => accounts[id].send(...args), getWebSocketClient: () => ({ getServerTime: () => NOW }), closeWebSocketConnection: () => {} },
    message: { success() {} }, addLog: value => logs.push(value), connections, releases, statuses, logs };
}
test("真实批量入口多账号状态隔离且每账号只连接一次", async () => {
  const a = fixture(), b = fixture(); a.state.box.freeEnergy = 1;
  const deps = batchDeps({ a, b });
  await createTasksTower(deps).batchWeirdTower();
  assert.deepEqual(deps.statuses, { a: "completed", b: "completed" });
  assert.equal(a.calls.filter(c => c.cmd === "mergebox_openbox").length, 1);
  assert.equal(b.calls.filter(c => c.cmd === "mergebox_openbox").length, 0);
  assert.deepEqual(deps.connections.sort(), ["a", "b"]);
  assert.equal(deps.releases.length, 2);
});

test("真实批量入口未确认的领奖或战斗标记失败而不显示完成", async () => {
  const f = fixture();
  f.state.box.freeEnergy = 1;
  const deps = batchDeps({ a: { send: (cmd, params) => {
    if (cmd === "mergebox_claimfreeenergy") throw new Error("200400");
    return f.send(cmd, params);
  } } });
  await createTasksTower(deps).batchWeirdTower();
  assert.equal(deps.statuses.a, "failed");
  assert.equal(deps.logs.some(item => /怪异塔完成/.test(item.message)), false);
  assert.equal(f.calls.some(c => c.cmd === "mergebox_openbox"), false);
});

test("免费/付费通行证等级、每日钥匙与已购待发奖励均先检查资格再领取", async () => {
  for (const purchased of [true, false]) {
    const f = fixture();
    const cfg = snapshot(config);
    cfg.EvoTowerScheduleConf = { 1: { evoTowerStart: (NOW - 2 * 86400000) / 1000, evoGachaStart: (NOW - 2 * 86400000) / 1000, evoGachaEnd: (NOW + 86400000) / 1000 } };
    cfg.BattlePassBaseConf = { 1003: { id: 1003, itemId: 37002 } };
    cfg.BattlePassConf = { 1001: { id: 1001, actId: 1003, exp: 40, freeReward: [{ type: 55 }], payReward: [{ type: 55 }] }, 1002: { id: 1002, actId: 1003, exp: 80, freeReward: [{}], payReward: [{}] } };
    f.state.role.items[37002] = { quantity: 40 };
    f.state.activity.warOrderActivityInfo[1003] = { purchased, rewardClaimed: {} };
    f.state.role.statistics["async:claim:reward:v2:evoTowerShop"] = 1;
    const send = async (cmd, params) => {
      if (cmd === "activity_battlepassrewardclaim") {
        f.calls.push({ cmd, params });
        f.state.activity.warOrderActivityInfo[1003].rewardClaimed[1001] = purchased ? 2 : 1;
        return { activity: snapshot(f.state.activity) };
      }
      if (cmd === "evotower_claimorderpassdailyreward") {
        f.calls.push({ cmd, params });
        for (let i = 0; i <= 2; i++) f.state.tower.orderPassReward[weirdTowerDate(NOW - i * 86400000)] = 1;
        return { evoTower: { orderPassReward: snapshot(f.state.tower.orderPassReward) } };
      }
      if (cmd === "role_asyncclaimrewardv2") {
        f.calls.push({ cmd, params });
        delete f.state.role.statistics["async:claim:reward:v2:evoTowerShop"];
        return {}; // 增量中缺字段不能视为清零，必须再次查询角色核对。
      }
      return f.send(cmd, params);
    };
    await f.run({ config: cfg, mode: "claim", send });
    assert.equal(f.calls.filter(c => c.cmd === "activity_battlepassrewardclaim").length, 1);
    assert.equal(f.calls.filter(c => c.cmd === "evotower_claimorderpassdailyreward").length, purchased ? 1 : 0);
    assert.deepEqual(f.calls.find(c => c.cmd === "role_asyncclaimrewardv2").params, { type: "evoTowerShop", isAll: true, rewardId: "" });
    assert.equal(f.calls.filter(c => c.cmd === "role_getroleinfo").length, 2);
  }
});

test("返钥匙累计奖励有多档时逐档补领，已领取档位不会重复", async () => {
  const f = fixture(); f.state.box.costTotalCnt = 4; f.state.box.costClaimCnt = 1;
  const cfg = snapshot(config);
  cfg.ActMergeItemCostProgressConf = Object.fromEntries([1, 2, 3, 5].map(costNum => [costNum, { actId: 888, costNum }]));
  const send = async (cmd, params) => {
    if (cmd === "mergebox_claimcostprogress") {
      f.calls.push({ cmd, params }); f.state.box.costClaimCnt++;
      return { mergeBox: { costClaimCnt: f.state.box.costClaimCnt } };
    }
    return f.send(cmd, params);
  };
  await f.run({ mode: "claim", config: cfg, send });
  assert.equal(f.calls.filter(c => c.cmd === "mergebox_claimcostprogress").length, 2);
});

test("棋盘切期停止，不向新活动消费；安全上限不能报告完成", async () => {
  const f = fixture(); f.state.tower.lotteryLeftCnt = 1;
  const send = async (cmd, params) => {
    if (cmd === "mergebox_openbox") { f.state.box.actId = 999; throw new Error("timeout"); }
    return f.send(cmd, params);
  };
  await assert.rejects(f.run({ mode: "use", send }), /切期/);
  await assert.rejects(f.run({ maxActions: 1 }), /安全操作上限/);
});

test("一键流程爬塔失败后继续领取使用钥匙，最终仍保留失败", async () => {
  const f = fixture(); f.state.tower.energy = 1; f.state.box.freeEnergy = 1;
  const send = async (cmd, params) => {
    if (cmd === "evotower_readyfight") throw new Error("200400");
    return f.send(cmd, params);
  };
  await assert.rejects(f.run({ send }), /爬塔.*200400/);
  assert.equal(f.calls.filter(c => c.cmd === "mergebox_openbox").length, 1);
});

test("阵容恢复失败保留原始爬塔错误，不能伪报完成", async () => {
  const f = fixture(); f.state.tower.energy = 1;
  const send = async (cmd, params) => {
    if (cmd === "presetteam_saveteam" && params.teamId === 1) throw new Error("restore timeout");
    if (cmd === "evotower_readyfight") throw new Error("200400");
    return f.send(cmd, params);
  };
  await assert.rejects(f.run({ mode: "climb", formation: 2, send }), /200400.*恢复阵容失败/);
});

test("完整查询省略空默认实例时按官方模型恢复，错误结构仍停止", async () => {
  const f = fixture();
  const send = async (cmd, params) => {
    if (["evotower_getinfo", "evotower_getshareinfo", "activity_get"].includes(cmd)) return {};
    return f.send(cmd, params);
  };
  assert.equal((await f.run({ mode: "claim", send })).status, "completed");
  await assert.rejects(f.run({ mode: "claim", send: async () => ({ unexpected: true }) }), /未取得怪异塔状态/);
});

test("手动合成按组批量配对，每轮仅刷新一次棋盘", async () => {
  const f = fixture();
  for (let x = 1; x <= 4; x++) f.state.box.gridMap[x] = { 1: { gridType: 2, gridItemId: 1 } };
  const result = await f.run({ mode: "merge" });
  assert.equal(result.merged, 2);
  assert.equal(result.mergeRounds, 1);
  assert.equal(f.calls.filter(c => c.cmd === "mergebox_getinfo").length, 2);
  assert.deepEqual(f.pauses, [300, 300, 500]);
  assert.equal(f.state.box.taskClaimMap[777], 1);
});

test("智能合成每轮一次，20轮后仍有物品时停止并保留未完成原因", async () => {
  const f = fixture();
  f.state.box.taskMap[777] = 1;
  f.state.box.taskClaimMap[777] = 1;
  for (let x = 1; x <= 42; x++) f.state.box.gridMap[x] = { 1: { gridType: 2, gridItemId: 1 } };
  await assert.rejects(f.run({ mode: "merge" }), /20轮上限.*仍有可合成/);
  assert.equal(f.calls.filter(c => c.cmd === "mergebox_automergeitem").length, 20);
  assert.equal(f.calls.filter(c => c.cmd === "mergebox_getinfo").length, 21);
  assert.deepEqual(f.pauses, Array.from({ length: 20 }, () => [1500, 500]).flat());
});


test("无钥匙或无可用宝箱正常完成，批量入口不记录失败", async () => {
  for (const mode of ["use", "all"]) {
    for (const scenario of ["noKeys", "missing", "locked", "exhausted"]) {
      const f = fixture();
      f.state.tower.lotteryLeftCnt = scenario === "noKeys" ? 0 : 1;
      if (scenario === "missing") f.state.box.gridMap = {};
      if (scenario === "locked") f.state.box.gridMap[4][5].isLock = true;
      if (scenario === "exhausted") f.state.box.gridMap[4][5].openCnt = 500;
      const logs = [];
      const result = await f.run({ mode, log: (message, type = "info") => logs.push({ message, type }) });
      assert.equal(result.status, "completed");
      assert.equal(result.used, 0);
      assert.equal(f.calls.some(c => c.cmd === "mergebox_openbox"), false);
      assert.equal(logs.some(item => item.type === "error"), false);
      if (scenario !== "noKeys") assert.ok(logs.some(item => /跳过使用钥匙/.test(item.message)));
    }
  }
  const f = fixture();
  f.state.tower.lotteryLeftCnt = 1;
  f.state.box.gridMap = {};
  const deps = batchDeps({ a: f });
  await createTasksTower(deps).batchWeirdTower();
  assert.equal(deps.statuses.a, "completed");
  assert.equal(deps.logs.some(item => item.type === "error"), false);
});


test("官方怪异木箱型号及省略默认字段仍按实际坐标使用钥匙", async () => {
  // 2026-10-23 配置58b91ed6c8：木箱boxId及useTimes，不按名称或固定位置猜测。
  for (const [boxId, useTimes] of [[1, 50], [4, 75], [7, 100], [10001, 2]]) {
    const f = fixture();
    f.state.tower.lotteryLeftCnt = 1;
    f.state.box.gridMap = { 7: { 3: { gridItemId: boxId } } };
    const cfg = snapshot(config);
    cfg.ActMergeBoxConf = { [boxId]: { boxId, name: "怪异木箱", useTimes } };
    const send = async (cmd, params) => {
      if (cmd === "mergebox_openbox") {
        f.calls.push({ cmd, params });
        assert.deepEqual(params, { actType: 1, pos: { gridX: 7, gridY: 3 } });
        f.state.tower.lotteryLeftCnt = 0;
        f.state.box.costTotalCnt++;
        return { mergeBox: { costTotalCnt: f.state.box.costTotalCnt } };
      }
      return f.send(cmd, params);
    };
    const result = await f.run({ mode: "use", config: cfg, send });
    assert.equal(result.used, 1);
    assert.equal(result.status, "completed");
    assert.equal(f.calls.filter(c => c.cmd === "mergebox_openbox").length, 1);
  }
});

test("未知格子类型按官方配置恢复箱子，物品配置优先防止同ID误开", async () => {
  for (const itemExists of [true, false]) {
    const f = fixture(); f.state.tower.lotteryLeftCnt = 1;
    f.state.box.gridMap[4][5].gridType = 0;
    const cfg = snapshot(config);
    if (itemExists) cfg.ActMergeItemConf[9] = { mergeItemId: 9, nextLevelMergeItemId: 0 };
    const result = await f.run({ mode: "use", config: cfg });
    assert.equal(result.used, itemExists ? 0 : 1);
  }
});

test("未找到箱子只读核对一次，使用刷新后的真实坐标", async () => {
  const f = fixture(); f.state.tower.lotteryLeftCnt = 1;
  let reads = 0;
  const send = async (cmd, params) => {
    if (cmd === "mergebox_getinfo" && ++reads === 1) {
      f.calls.push({ cmd, params });
      return { mergeBox: { ...snapshot(f.state.box), gridMap: {} } };
    }
    return f.send(cmd, params);
  };
  assert.equal((await f.run({ mode: "use", send })).used, 1);
  assert.equal(reads, 2);
  assert.deepEqual(f.calls.find(c => c.cmd === "mergebox_openbox").params.pos, { gridX: 4, gridY: 5 });
});

test("箱子消失后按返回棋盘使用替换木箱，不沿用旧坐标", async () => {
  const f = fixture(); f.state.tower.lotteryLeftCnt = 2;
  const positions = [];
  const send = async (cmd, params) => {
    if (cmd === "mergebox_openbox") {
      positions.push(params.pos);
      f.state.tower.lotteryLeftCnt--;
      f.state.box.costTotalCnt++;
      return { mergeBox: { costTotalCnt: f.state.box.costTotalCnt,
        gridMap: positions.length === 1 ? { 6: { 3: { gridItemId: 9 } } } : {} },
        delPosList: [params.pos] };
    }
    // 本用例只检查替换，不产生累计奖励返还。
    return f.send(cmd, params);
  };
  const cfg = snapshot(config); cfg.ActMergeItemCostProgressConf = {};
  assert.equal((await f.run({ mode: "use", send, config: cfg })).used, 2);
  assert.deepEqual(positions, [{ gridX: 4, gridY: 5 }, { gridX: 6, gridY: 3 }]);
});

test("不可用箱子日志包含具体木箱、坐标和排除原因，刷新有界", async () => {
  const f = fixture(); f.state.tower.lotteryLeftCnt = 1;
  f.state.box.gridMap[4][5].isLock = true;
  const cfg = snapshot(config); cfg.ActMergeBoxConf[9].name = "怪异木箱";
  const logs = [];
  const result = await f.run({ mode: "use", config: cfg, log: text => logs.push(text) });
  assert.equal(result.status, "completed");
  assert.equal(f.calls.filter(c => c.cmd === "mergebox_getinfo").length, 2);
  assert.ok(logs.some(text => /怪异木箱.*坐标4,5.*未解锁/.test(text)));
});

test("开箱结果核对已读取库存时不再紧接重复查询，同样使用真实库存", async () => {
  for (const timeout of [false, true]) {
    const f = fixture(); f.state.tower.lotteryLeftCnt = 1;
    const result = await f.run({ mode: 'use', send: async (cmd, params) => {
      const result = await f.send(cmd, params);
      if (cmd === 'mergebox_openbox') {
        if (timeout) throw new Error('timeout');
        return {}; // sparse write response requires a single state refresh
      }
      return result;
    } });
    assert.equal(result.used, 1);
    assert.equal(f.calls.filter(c => c.cmd === 'mergebox_openbox').length, 1);
    assert.equal(f.calls.filter(c => c.cmd === 'evotower_getinfo').length, 2); // initial + confirmation
  }
});

test("无能量一键流程复用已确认状态，不重复全量读取奖励来源", async () => {
  const f = fixture();
  await f.run();
  for (const cmd of ['evotower_getinfo', 'mergebox_getinfo', 'role_getroleinfo', 'evotower_getshareinfo', 'activity_get']) {
    assert.equal(f.calls.filter(c => c.cmd === cmd).length, 1, cmd);
  }
});

test("初始化角色可复用，领奖使库存可能变化时仍重新核对", async () => {
  const f = fixture();
  await f.run({ mode: 'claim', initialRole: snapshot(f.state.role) });
  assert.equal(f.calls.filter(c => c.cmd === 'role_getroleinfo').length, 0);
  const g = fixture(); g.state.tower.towerId = 10;
  await g.run({ mode: 'claim', initialRole: snapshot(g.state.role) });
  assert.equal(g.calls.filter(c => c.cmd === 'role_getroleinfo').length, 1);
});

test("整个执行器的战斗间隔500ms、战后等待500ms，领奖仍为800ms", async () => {
  const f = fixture(); f.state.tower.energy = 3;
  let time = 0; const sent = [];
  const result = await f.run({ mode: 'climb', maxClimbs: 3, requestIntervalMs: 800,
    requestNow: () => time, pause: async ms => { time += ms; },
    send: async (cmd, params) => { sent.push({ cmd, time }); return f.send(cmd, params); } });
  assert.equal(result.climbed, 3);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].time - sent[i - 1].time >= (['evotower_fight', 'evotower_readyfight'].includes(sent[i].cmd) || (sent[i].cmd === 'evotower_getinfo' && sent[i - 1].cmd === 'evotower_fight') ? 500 : 800), sent[i].cmd);
  for (let i = 0; i < sent.length - 1; i++) if (sent[i].cmd === 'evotower_fight') assert.equal(sent[i + 1].time - sent[i].time, 500);
  assert.equal(sent.filter(c => c.cmd === 'evotower_claimtask').length, 1);
});

test("批量初始化与配置共用节流入口，并要求只读初始化及启动错峰", async () => {
  const f = fixture(), deps = batchDeps({ a: f });
  let time = 0; const sent = [];
  deps.weirdTowerRequestOptions = { now: () => time, pause: async ms => { time += ms; } };
  deps.tokenStore.sendMessageWithPromise = async (_id, cmd, params) => { sent.push([cmd, time]); return f.send(cmd, params); };
  deps.ensureConnection = async (_id, _retries, _slot, options) => {
    assert.equal(options.readOnly, true);
    await options.beforeConnect();
    return options.request('role_getroleinfo', {}, 5000);
  };
  deps.loadWeirdTowerConfig = async send => { await send('evotower_getinfo'); return config; };
  await createTasksTower(deps).batchWeirdTower();
  assert.equal(deps.statuses.a, 'completed');
  assert.equal(sent.filter(([cmd]) => cmd === 'role_getroleinfo').length, 1);
  assert.equal(sent.some(([cmd]) => cmd === 'fight_startlevel'), false);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i][1] - sent[i - 1][1] >= 800);
});

test("业务400340不重新连接或刷新Token，失败汇总使用警告", async () => {
  const f = fixture(), deps = batchDeps({ a: f });
  const notices = [];
  deps.message = { success: text => notices.push(['success', text]), warning: text => notices.push(['warning', text]) };
  deps.tokenStore.refreshTokenCredentials = () => assert.fail('业务限频不刷新Token');
  deps.tokenStore.sendMessageWithPromise = async (_id, cmd, params) => {
    if (cmd === 'evotower_getinfo') throw Object.assign(new Error('服务器错误: 400340 - 操作过快'), { code: 400340 });
    return f.send(cmd, params);
  };
  await createTasksTower(deps).batchWeirdTower();
  assert.deepEqual(deps.connections, ['a']); assert.equal(deps.releases.length, 1);
  assert.equal(deps.statuses.a, 'failed');
  assert.match(deps.logs.at(-1).message, /a 怪异塔失败.*阶段=读取状态.*指令=evotower_getinfo.*400340/);
  assert.equal(notices[0][0], 'warning'); assert.match(notices[0][1], /失败1/);
});

test("节流等待跨日期后不发送原日期的写请求", async () => {
  const f = fixture(); f.state.tower.energy = 1;
  let time = NOW, requestTime = 0;
  const send = async (cmd, params) => {
    const result = await f.send(cmd, params);
    if (cmd === 'evotower_readyfight') time = Date.parse('2026-10-22T00:00:00+08:00') - 50;
    return result;
  };
  await assert.rejects(f.run({ mode: 'climb', requestIntervalMs: 800, now: () => time,
    requestNow: () => requestTime,
    pause: async ms => { requestTime += ms; time += ms; }, send }), /周期已变化/);
  assert.equal(f.calls.some(c => c.cmd === 'evotower_fight'), false);
});
