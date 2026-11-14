import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCampTeam, getCampDay, runCampChallenge, createTasksCamp } from "../src/utils/batch/tasksCamp.js";
import { campTaskState, getCampRules, campBattleWon } from "../src/utils/batch/campChallengeState.js";
import { GameCommands } from "../src/utils/gameCommands.js";
import { g_utils } from "../src/utils/bonProtocol.js";

const tuesday = () => new Date("2026-09-22T10:00:00+08:00");
const role = { roleId: 77, battleTeam: { 0: { heroId: 116 }, 1: { heroId: 107 } }, lordWeaponId: 3, pet: { petUId: "own-pet" }, statisticsTime: {} };
const config = {
  ClubWarConstantConf: { challengeNum: 10, SuccessfulChallengeNum: 3, extraChallengeNum: 5, extraSuccessfulChallengeNum: 2, matchDayBattleTime: [36000, 79200] },
  ClubWarScheduleConf: { 1: { startDate: "2026/09/01", endDate: "2026/10/22" } },
  ClubWarDifficultConf: { 1: { id: 1, Difficult: 1, hp: 3 }, 2: { id: 2, Difficult: 2, hp: 1 }, 3: { id: 3, Difficult: 3, hp: 1 } },
  ClubWarTaskConf: {
    1: { id: 1, taskTeam: 1, ClubWarTaskType: 4, completeValue: 3, ifAbandon: 0 },
    2: { id: 2, taskTeam: 2, ClubWarTaskType: 1, completeValue: 1, ifAbandon: 1 },
    5: { id: 5, taskTeam: 3, ClubWarTaskType: 5, completeValue: 1, ifAbandon: 0 },
    6: { id: 6, taskTeam: 3, ClubWarTaskType: 6, completeValue: 1, ifAbandon: 0 },
  },
};
function fixture({ wins = 0, attacks = 0, winNormal = () => false, winMonster = true, timeout = false, petConsumesAttack = false } = {}) {
  const info = {
    club: { phase: "260921", members: { 1: { roleId: 77 } }, oppoMap: { 2: { defenders: {
      1: { roleId: 101, challengeCnt: 0, failCnt: 0 },
      2: { roleId: 102, challengeCnt: 2, failCnt: 1 },
    } } } },
    siege: { attackMap: { 260922: { attackCnt: attacks, aSuccessCnt: wins } }, taskResetTime: +tuesday() / 1000, taskProgress: {}, taskClaimedMap: {} },
  };
  const calls = [], records = [];
  const f = { info, calls, records, role: structuredClone(role), config: structuredClone(config), now: tuesday };
  let normal = 0, monster = 0;
  f.loadConfig = async () => f.config;
  f.send = async (cmd, params = {}) => {
    calls.push({ cmd, params });
    if (cmd === "club_getinfo") return structuredClone(info);
    if (cmd === "role_getroleinfo") return { role: structuredClone(f.role) };
    if (cmd === "club_getattackrecord") return { records: structuredClone(records) };
    if (cmd === "club_gettargetteam") return { roleBattleTeam: { role: { power: params.targetId === 101 ? 1000 : 100 } } };
    if (cmd === "club_taskclaim") { info.siege.taskClaimedMap[params.confId] = 1; return { siege: { taskClaimedMap: { [params.confId]: 1 } } }; }
    assert.ok(["club_attack", "club_attackmonster"].includes(cmd), cmd);
    assert.equal(params.useItem, false);
    assert.equal(params.teamSetParams.petUId, "own-pet");
    const isMonster = cmd === "club_attackmonster";
    const won = isMonster ? (typeof winMonster === "function" ? winMonster(++monster) : winMonster) : winNormal(++normal);
    const progress = info.siege.attackMap[260922];
    if (!isMonster || petConsumesAttack) progress.attackCnt++;
    if (won) progress.aSuccessCnt++;
    if (!isMonster) {
      const target = info.club.oppoMap[2].defenders[params.nodeId];
      assert.equal(params.challengeCnt, target.challengeCnt ?? 0);
      assert.equal(params.failCnt, target.failCnt ?? 0);
      assert.equal(params.targetIsMirror, target.mirror ?? false);
      target.challengeCnt = (target.challengeCnt ?? 0) + 1;
      target.failCnt = (target.failCnt ?? 0) + (won ? 0 : 1);
    }
    records.push({ recordName: `record-${records.length + 1}`, created: +tuesday() / 1000,
      roleId: isMonster ? 0 : params.targetId, monsterId: isMonster ? 1 : 0,
      nodeId: params.nodeId ?? 0, mirror: params.targetIsMirror ?? false, isWin: won });
    if (timeout) throw new Error("timeout");
    return { battleData: { result: { isWin: won, accept: { ext: { curHP: won ? 0 : 100 } } } }, reward: won ? [{ itemId: 1 }] : [] };
  };
  return f;
}
const count = (f, cmd) => f.calls.filter(c => c.cmd === cmd).length;

test("周二至周四开放时间为10点含至22点不含，赛季外跳过", async () => {
  for (const date of [21, 25, 26, 27]) {
    const f = fixture(); f.now = () => new Date(`2026-09-${date}T10:00:00+08:00`);
    assert.equal((await runCampChallenge(f)).status, "skipped");
    assert.equal(f.calls.length, 0);
  }
  for (const hour of ["09:59:59", "22:00:00"]) {
    const f = fixture(); f.now = () => new Date(`2026-09-22T${hour}+08:00`);
    assert.equal((await runCampChallenge(f)).status, "skipped");
    assert.equal(count(f, "club_attack"), 0);
  }
  const f = fixture(); f.config.ClubWarScheduleConf[1].endDate = "2026/09/21";
  assert.match((await runCampChallenge(f)).reason, /赛季/);
  assert.deepEqual(getCampDay(new Date("2026-09-21T16:00:00Z")), { key: "260922", weekday: 2 });
});

test("最低战力优先，难度变化重查阵容，共享3胜立即停", async () => {
  const f = fixture({ winNormal: () => true });
  const result = await runCampChallenge(f);
  assert.equal(result.wins, 3);
  assert.deepEqual(f.calls.filter(c => c.cmd === "club_attack").map(c => c.params.nodeId), [2, 2, 2]);
  assert.deepEqual(f.calls.filter(c => c.cmd === "club_attack").map(c => c.params.challengeCnt), [2, 3, 4]);
  assert.ok(count(f, "club_gettargetteam") >= 3);
  assert.equal(count(f, "club_attackmonster"), 0);
});

test("连续三败转宠物，宠物胜利计入共享成功次数且每场查询", async () => {
  const f = fixture(); const result = await runCampChallenge(f);
  assert.equal(count(f, "club_attack"), 3);
  assert.equal(count(f, "club_attackmonster"), 3);
  assert.equal(result.wins, 3); assert.equal(result.monsterWins, 3);
  const petIndex = f.calls.findIndex(c => c.cmd === "club_attackmonster");
  assert.equal(f.calls[petIndex + 1].cmd, "club_getinfo");
});

test("普通胜利重置失败次数，已有1胜只补两次宠物胜利", async () => {
  const f = fixture({ winNormal: attempt => attempt === 3 }); const result = await runCampChallenge(f);
  assert.equal(count(f, "club_attack"), 6); assert.equal(count(f, "club_attackmonster"), 2);
  assert.equal(result.wins, 3); assert.equal(result.monsterWins, 2);
});

test("重复执行已达标只查询和领奖，不追加据点或宠物挑战", async () => {
  const f = fixture({ wins: 2, attacks: 9, winNormal: () => true });
  assert.equal((await runCampChallenge(f)).wins, 3);
  assert.equal(count(f, "club_attack"), 1);
  f.calls.length = 0; await runCampChallenge(f);
  assert.equal(count(f, "club_attack"), 0); assert.equal(count(f, "club_attackmonster"), 0);
});

test("普通10次、特权15次出手上限，目标保持共享3胜", async () => {
  for (const paid of [false, true]) {
    const f = fixture({ attacks: 10, wins: 2, winNormal: () => true });
    if (paid) f.role.statisticsTime["paid:car:s"] = +tuesday() / 1000 + 100;
    const rules = getCampRules(f.config, f.role, f.now());
    assert.equal(rules.attacks, paid ? 15 : 10); assert.equal(rules.winLimit, paid ? 5 : 3);
    await runCampChallenge(f);
    assert.equal(count(f, "club_attack"), paid ? 1 : 0); assert.equal(count(f, "club_attackmonster"), paid ? 0 : 1);
  }
});

test("宠物可不增加attackCnt，共享胜利大于出手次数仍可对账", async () => {
  const f = fixture({ attacks: 0, wins: 2 }); f.info.club.oppoMap[2].defenders = {};
  assert.equal((await runCampChallenge(f)).wins, 3); assert.equal(count(f, "club_attackmonster"), 1);
});

test("有效特权过期后按普通次数，异常配置拒绝攻击", async () => {
  const f = fixture(); f.role.statisticsTime["paid:car:s"] = +tuesday() / 1000;
  assert.equal(getCampRules(f.config, f.role, f.now()).attacks, 10);
  f.config.ClubWarConstantConf.challengeNum = 0;
  await assert.rejects(runCampChallenge(f), /配置或数据异常/);
  assert.equal(count(f, "club_attack"), 0);
});

test("报名phase与参战名单检查，角色缺失拒绝执行", async () => {
  for (const mutate of [f => { f.info.club.phase = "260914"; }, f => { f.info.club.members = {}; }]) {
    const f = fixture(); mutate(f); assert.equal((await runCampChallenge(f)).status, "skipped"); assert.equal(count(f, "club_attack"), 0);
  }
  const f = fixture(); delete f.role.roleId; await assert.rejects(runCampChallenge(f), /角色ID/);
});

test("镜像标记及默认零计数随当前目标发送", async () => {
  const f = fixture({ wins: 2, winNormal: () => true });
  const target = f.info.club.oppoMap[2].defenders[2]; target.mirror = true; delete target.challengeCnt; delete target.failCnt;
  await runCampChallenge(f);
  const params = f.calls.find(c => c.cmd === "club_attack").params;
  assert.equal(params.targetIsMirror, true); assert.equal(params.challengeCnt, 0);
});

test("isWin而非血量判断，空响应或异常胜负字段停止", async () => {
  assert.equal(campBattleWon({ battleData: { result: { isWin: false, accept: { ext: { curHP: 0 } } } } }), false);
  assert.equal(campBattleWon({ battleData: { result: { isWin: true, accept: { ext: { curHP: 100 } } } } }), true);
  assert.equal(campBattleWon({ battleData: { result: { id: 1 } } }), false);
  for (const result of [{}, { isWin: "true" }]) assert.throws(() => campBattleWon({ battleData: { result } }), /无法确认|异常/);
  const f = fixture({ attacks: 10 }); const send = async (cmd, params) => cmd === "club_attackmonster" ? {} : f.send(cmd, params);
  await assert.rejects(runCampChallenge({ ...f, send }), /结果无法确认/);
});

test("正常响应与共享计数不一致时停止，不追加宠物", async () => {
  const f = fixture({ attacks: 10 });
  await assert.rejects(runCampChallenge({ ...f, send: (cmd, params) => cmd === "club_attackmonster"
    ? { battleData: { result: { isWin: true } } } : f.send(cmd, params) }), /次数不一致/);
});

test("据点及宠物超时有唯一新战报并对账才继续", async () => {
  for (const pet of [false, true]) {
    const f = fixture({ attacks: pet ? 10 : 0, timeout: true, winNormal: () => true });
    assert.equal((await runCampChallenge(f)).wins, 3);
    assert.equal(count(f, pet ? "club_attackmonster" : "club_attack"), 3);
  }
});

test("超时未变化或战报缺失不能重发", async () => {
  for (const mutated of [false, true]) {
    const f = fixture({ attacks: 10 }); let attempts = 0;
    await assert.rejects(runCampChallenge({ ...f, send: async (cmd, params) => {
      if (cmd === "club_attackmonster") { attempts++; if (mutated) await f.send(cmd, params); f.records.length = 0; throw new Error("timeout"); }
      return f.send(cmd, params);
    } }), /攻击结果未确认/);
    assert.equal(attempts, 1);
  }
});

test("宠物失败或第二场失败不标记完成", async () => {
  const f = fixture({ attacks: 10, winMonster: attempt => attempt === 1 });
  await assert.rejects(runCampChallenge(f), /未获胜.*1\/3/);
  assert.equal(count(f, "club_attackmonster"), 2);
});

test("重跑从共享计数补缺，已有宠物战报只作记录统计", async () => {
  const f = fixture({ attacks: 10, wins: 2 });
  f.records.push({ recordName: "previous", created: +tuesday() / 1000, roleId: 0, monsterId: 1, isWin: true });
  const result = await runCampChallenge(f);
  assert.equal(count(f, "club_attackmonster"), 1); assert.equal(result.monsterWins, 2);
});

test("达标任务逐档领奖，跳过废弃项并确认领取标记", async () => {
  const f = fixture({ wins: 3 }); f.info.siege.taskProgress = { 4: 3, 1: 1, 5: 1, 6: 1 };
  const result = await runCampChallenge(f);
  assert.deepEqual(f.calls.filter(c => c.cmd === "club_taskclaim").map(c => c.params.confId), [1, 5, 6]);
  assert.equal(result.rewardsClaimed, 3); assert.equal(count(f, "club_attack"), 0);
  f.calls.length = 0; await runCampChallenge(f); assert.equal(count(f, "club_taskclaim"), 0);
});

test("旧日任务数据不领奖，已领标记按Map存在判定", () => {
  const f = fixture(); f.info.siege.taskProgress = { 4: 3 }; f.info.siege.taskResetTime -= 86400;
  assert.deepEqual(campTaskState(f.info, f.config, tuesday()).ready, []);
  f.info.siege.taskResetTime = +tuesday() / 1000; f.info.siege.taskClaimedMap = { 1: 0 };
  assert.equal(campTaskState(f.info, f.config, tuesday()).claimed({ id: 1 }), true);
});

test("领奖超时已标记可继续，未标记不能重复发送", async () => {
  for (const confirmed of [true, false]) {
    const f = fixture({ wins: 3 }); f.info.siege.taskProgress = { 4: 3 };
    const options = { ...f, send: async (cmd, params) => {
      if (cmd === "club_taskclaim") { if (confirmed) await f.send(cmd, params); else f.calls.push({ cmd, params }); throw new Error("timeout"); }
      return f.send(cmd, params);
    } };
    if (confirmed) assert.equal((await runCampChallenge(options)).rewardsClaimed, 1);
    else await assert.rejects(runCampChallenge(options), /领奖未确认/);
    assert.equal(count(f, "club_taskclaim"), 1);
  }
});

test("停止、跨日、跨22点不会继续攻击或领奖", async () => {
  for (const mode of ["stop", "day", "end"]) {
    const f = fixture({ attacks: 10 }); let changed = false;
    await assert.rejects(runCampChallenge({ ...f, stopped: () => mode === "stop" && changed,
      now: () => changed && mode !== "stop" ? new Date(mode === "day" ? "2026-09-23T10:00:00+08:00" : "2026-09-22T22:00:00+08:00") : tuesday(),
      send: async (cmd, params) => { const result = await f.send(cmd, params); if (cmd === "club_attackmonster") changed = true; return result; },
    }), /已停止|日期已变化|时段/);
    assert.equal(count(f, "club_attackmonster"), 1); assert.equal(count(f, "club_taskclaim"), 0);
  }
});

test("据点被其他成员击败后重选，13000070查询后更新阵容", async () => {
  for (const conflict of [false, true]) {
    const f = fixture({ wins: 2, winNormal: () => true }); let changed = false, queries = 0;
    await runCampChallenge({ ...f, send: async (cmd, params) => {
      if (!changed && ((!conflict && cmd === "club_getinfo" && ++queries === 2) || (conflict && cmd === "club_attack"))) {
        changed = true; f.info.club.oppoMap[2].defenders[2].defeated = true;
        if (conflict) throw new Error("服务器错误: 13000070 - 目标变化");
      }
      return f.send(cmd, params);
    } });
    assert.equal(f.calls.find(c => c.cmd === "club_attack").params.nodeId, 1);
  }
});

test("未知战力、缺失营地快照、用户初始停止拒绝攻击", async () => {
  const f = fixture();
  await assert.rejects(runCampChallenge({ ...f, send: (cmd, p) => cmd === "club_gettargetteam" ? {} : f.send(cmd, p) }), /目标战力/);
  await assert.rejects(runCampChallenge({ ...f, send: (cmd, p) => cmd === "club_getinfo" ? {} : f.send(cmd, p) }), /数据不完整/);
  await assert.rejects(runCampChallenge({ ...f, stopped: () => true }), /已停止/);
});

test("阵容来自当前账号，协议编码包含领奖参数及镜像", () => {
  const team = buildCampTeam(role); assert.deepEqual(team.battleTeam, { 0: 116, 1: 107 });
  assert.throws(() => buildCampTeam({ battleTeam: {} }), /没有可用/);
  const commands = new GameCommands();
  for (const cmd of ["club_attack", "club_attackmonster", "club_taskclaim"]) {
    const params = cmd === "club_taskclaim" ? { confId: 6 } : { useItem: false, teamSetParams: team, targetIsMirror: true };
    const packet = commands[cmd](4, 5, params); assert.equal(packet.cmd, cmd);
    assert.deepEqual(g_utils.bon.decode(packet.body), params);
  }
});

test("多账号串行清理连接，失败后继续下一个且账号状态独立", async () => {
  const events = [], fixtures = { a: fixture(), b: fixture({ wins: 3 }) };
  fixtures.b.info.siege.taskProgress = { 4: 3 };
  const deps = {
    selectedTokens: { value: ["a", "b"] }, tokens: { value: [] }, tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, batchSettings: {}, addLog: () => {}, message: { success: () => {}, warning: () => {} },
    ensureConnection: async id => events.push(`connect:${id}`), releaseConnectionSlot: () => events.push("release"),
    tokenStore: { getWebSocketStatus: () => "disconnected", closeWebSocketConnection: id => events.push(`close:${id}`),
      sendMessageWithPromise: async (id, cmd, params) => { if (id === "a") throw new Error("网络断开"); return fixtures[id].send(cmd, params); } },
  };
  await createTasksCamp(deps, { now: tuesday, loadConfig: async () => config, sleep: async () => {} }).batchCampChallenge();
  assert.deepEqual(events, ["connect:a", "close:a", "release", "connect:b", "close:b", "release"]);
  assert.deepEqual(deps.tokenStatus.value, { a: "failed", b: "completed" }); assert.equal(count(fixtures.b, "club_taskclaim"), 1);
});

test("13000070后计数或战报已变化不能盲目重新挑战", async () => {
  const f = fixture({ wins: 2, winNormal: () => true });
  const result = await runCampChallenge({ ...f, send: async (cmd, params) => {
    const response = await f.send(cmd, params);
    if (cmd === "club_attack") throw new Error("服务器错误: 13000070");
    return response;
  } });
  assert.equal(result.wins, 3); assert.equal(count(f, "club_attack"), 1);
});

test("共享计数达标时，即使战报未覆盖当日全部宠物胜利也不追加挑战", async () => {
  const f = fixture({ wins: 3 }); f.records.length = 0;
  await runCampChallenge(f);
  assert.equal(count(f, "club_attackmonster"), 0);
});

test("服务器日期覆盖本地星期判断，批量入口使用连接服务端时间", async () => {
  const f = fixture({ wins: 3 });
  const deps = {
    selectedTokens: { value: ["a"] }, tokens: { value: [] }, tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, batchSettings: {}, addLog: () => {}, message: { success: () => {}, warning: () => {} },
    ensureConnection: async () => {}, releaseConnectionSlot: () => {}, tokenStore: {
      getWebSocketStatus: () => "disconnected", getWebSocketClient: () => ({ getServerTime: () => +tuesday() }), closeWebSocketConnection: () => {},
      sendMessageWithPromise: (id, cmd, params) => f.send(cmd, params),
    },
  };
  await createTasksCamp(deps, { now: () => new Date("2026-09-21T10:00:00+08:00"), loadConfig: async () => config, sleep: async () => {} }).batchCampChallenge();
  assert.equal(deps.tokenStatus.value.a, "completed"); assert.ok(count(f, "club_getinfo") > 0);
});

test("官方战报默认空records可省略，空记录不会冒充确认结果", async () => {
  const f = fixture({ attacks: 10, wins: 2 }); let first = true;
  const result = await runCampChallenge({ ...f, send: (cmd, params) => {
    if (cmd === "club_getattackrecord" && first) { first = false; return {}; }
    return f.send(cmd, params);
  } });
  assert.equal(result.wins, 3); assert.equal(count(f, "club_attackmonster"), 1);
});

test("特权中途到期重新应用10次据点上限，转宠物补齐", async () => {
  const f = fixture({ attacks: 9, wins: 1, winNormal: () => true });
  f.role.statisticsTime["paid:car:s"] = +tuesday() / 1000 + 1;
  let expired = false;
  const result = await runCampChallenge({ ...f, now: () => new Date(+tuesday() + (expired ? 2000 : 0)), send: async (cmd, params) => {
    const response = await f.send(cmd, params);
    if (cmd === "club_attack") expired = true;
    return response;
  } });
  assert.equal(result.wins, 3); assert.equal(count(f, "club_attack"), 1); assert.equal(count(f, "club_attackmonster"), 1);
});

test("超时出现多份新战报无法唯一确认，不继续发送", async () => {
  const f = fixture({ attacks: 10, wins: 2 }); let sent = 0;
  await assert.rejects(runCampChallenge({ ...f, send: async (cmd, params) => {
    const response = await f.send(cmd, params);
    if (cmd === "club_attackmonster") {
      sent++;
      f.records.push({ recordName: "other", created: +tuesday() / 1000, roleId: 999, nodeId: 1, isWin: false });
      throw new Error("timeout");
    }
    return response;
  } }), /攻击结果未确认/);
  assert.equal(sent, 1);
});
