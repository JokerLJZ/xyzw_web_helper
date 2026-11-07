import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { runAutoCampSignup, runAutoPeachSignup, runGoldenCheer, getGoldenCheerWindow, getGoldenCheerLegions, createTasksSignupCheer } from "../src/utils/batch/tasksSignupCheer.js";
import { GameCommands } from "../src/utils/gameCommands.js";
import { g_utils } from "../src/utils/bonProtocol.js";
const config = JSON.parse(fs.readFileSync(new URL("./fixtures/signupCheerConfig.json", import.meta.url)));
const now = () => new Date("2026-10-11T09:00:00+08:00");
function fixture(kind, options = {}) {
  const members = Object.fromEntries(Array.from({
    length: 20
  }, (_, i) => [i + 1, {
    roleId: i + 1,
    job: i === 0 ? options.job ?? 1 : 999,
    power: 10000000,
    custom: {
      payload_item_cnt: 5
    }
  }]));
  const role = {
    roleId: 1,
    statistics: options.statistics || {}
  };
  const legion = {
    members,
    statistics: {
      "week:sign:in": 50,
      "payload:war:sign:up": options.signed ? 261011 : 0
    },
    statisticsTime: {
      "week:sign:in": 1791216000
    }
  };
  const club = {
    phase: options.signed ? "261012" : "261005"
  };
  const calls = [];
  const send = async (cmd, params) => {
    calls.push({
      cmd,
      params
    });
    if (cmd === "role_getroleinfo") return {
      role: structuredClone(role)
    };
    if (cmd === "legion_getinfo") return {
      info: structuredClone(legion),
      firstMonthDate: ""
    };
    if (cmd === "legion_getpayloadlegioninfo") return {
      legion: structuredClone(legion),
      lockedLegionId: 0
    };
    if (cmd === "club_getinfo") return {
      club: structuredClone(club)
    };
    if (cmd === "saltroad_getseasonoutrank") return {
      legionList: [{
        id: 321,
        name: "目标",
        sOWinCnt: 2
      }]
    };
    if (options.fail) throw new Error("timeout");
    if (cmd === "club_signup") club.phase = "261012";else if (cmd === "legion_payloadsignup") legion.statistics["payload:war:sign:up"] = 261011;else if (cmd === "saltroad_outcheer") role.statistics["sr:out:cheer:261003"] = params.legionId;else throw new Error(cmd);
    return {};
  };
  return {
    send,
    calls,
    role,
    legion,
    club,
    run: () => ({
      camp: runAutoCampSignup,
      peach: runAutoPeachSignup,
      golden: runGoldenCheer
    })[kind]({
      send,
      config,
      now,
      legionId: 321,
      expectedPhase: "261003"
    })
  };
}
test("当前客户端营地报名使用club_signup，报名后查询phase确认", async () => {
  const f = fixture("camp");
  assert.equal((await f.run()).status, "completed");
  assert.equal(f.calls.filter(c => c.cmd === "club_signup").length, 1);
  assert.ok(!f.calls.some(c => c.cmd.includes("legionmatch")));
  assert.equal((await f.run()).status, "skipped");
});
test("营地报名检查权限、窗口、本周签到，条件不足不写入", async () => {
  for (const job of [2, 999]) {
    const f = fixture("camp", {
      job
    });
    assert.equal((await f.run()).status, job === 2 ? "completed" : "skipped");
  }
  const f = fixture("camp");
  f.legion.statisticsTime["week:sign:in"] = 1;
  assert.equal((await f.run()).status, "skipped");
  const result = await runAutoCampSignup({
    send: () => {
      throw Error("不应请求");
    },
    config,
    now: () => new Date("2026-10-13T09:00:00+08:00")
  });
  assert.equal(result.status, "skipped");
});
test("蟠桃报名周日08-18点，人数和铃铛达标才发送并复查", async () => {
  const f = fixture("peach");
  assert.equal((await f.run()).status, "completed");
  assert.equal((await f.run()).status, "skipped");
  assert.equal(f.calls.filter(c => c.cmd === "legion_payloadsignup").length, 1);
  for (const hour of [7, 18]) {
    assert.equal((await runAutoPeachSignup({
      send: () => {
        throw Error("不应请求");
      },
      config,
      now: () => new Date(`2026-10-11T${String(hour).padStart(2, "0")}:00:00+08:00`)
    })).status, "skipped");
  }
  const low = fixture("peach");
  delete low.legion.members[20];
  assert.equal((await low.run()).status, "skipped");
  const bells = fixture("peach");
  bells.legion.members[1].custom.payload_item_cnt = 0;
  assert.equal((await bells.run()).status, "skipped");
});
test("黄金天宫窗口由当前赛季配置推导，跨期及已助威安全跳过", async () => {
  const w = getGoldenCheerWindow(config, now());
  assert.deepEqual(w, {
    phase: "261003",
    start: +new Date("2026-10-11T00:00:00+08:00"),
    end: +new Date("2026-10-16T19:55:00+08:00")
  });
  const f = fixture("golden");
  assert.equal((await f.run()).status, "completed");
  assert.equal((await f.run()).status, "skipped");
  assert.deepEqual(f.calls.filter(c => c.cmd === "saltroad_outcheer"), [{
    cmd: "saltroad_outcheer",
    params: {
      legionId: 321
    }
  }]);
  assert.equal((await runGoldenCheer({
    send: f.send,
    config,
    now,
    legionId: 321,
    expectedPhase: "260704"
  })).status, "skipped");
  const ended = () => new Date("2026-10-16T19:55:00+08:00");
  assert.equal((await runGoldenCheer({
    send: () => {
      throw Error("不应请求");
    },
    config,
    now: ended,
    legionId: 321,
    expectedPhase: "261003"
  })).status, "skipped");
});
test("助威候选按胜场排序仅取前64，不允许非候选目标", async () => {
  const list = getGoldenCheerLegions({
    legionList: Array.from({
      length: 70
    }, (_, i) => ({
      id: i + 1,
      sOWinCnt: i
    }))
  });
  assert.equal(list.length, 64);
  assert.equal(list[0].id, 70);
  const f = fixture("golden");
  assert.equal((await runGoldenCheer({
    send: f.send,
    config,
    now,
    legionId: 999,
    expectedPhase: "261003"
  })).status, "skipped");
});
test("报名与助威超时不自动重复写入", async () => {
  for (const kind of ["camp", "peach", "golden"]) {
    const f = fixture(kind, {
      fail: true
    });
    await assert.rejects(f.run(), /timeout/);
    assert.equal(f.calls.filter(c => ["club_signup", "legion_payloadsignup", "saltroad_outcheer"].includes(c.cmd)).length, 1);
  }
});
test("新增协议编码保留参数、序号和应答号", () => {
  const commands = new GameCommands();
  for (const cmd of ["club_signup", "legion_getpayloadlegioninfo", "legion_payloadsignup", "saltroad_getseasonoutrank", "saltroad_outcheer"]) {
    const params = cmd === "saltroad_outcheer" ? {
      legionId: 321
    } : {};
    const packet = commands[cmd](4, 5, params);
    assert.equal(packet.cmd, cmd);
    assert.equal(packet.ack, 4);
    assert.equal(packet.seq, 5);
    assert.deepEqual(g_utils.bon.decode(packet.body), params);
  }
});
test("批量任务逐账号运行，复用现有连接且失败释放自建连接", async () => {
  const close = [],
    release = [],
    statuses = {};
  const deps = {
    selectedTokens: {
      value: ["a", "b"]
    },
    tokens: {
      value: []
    },
    tokenStatus: {
      value: statuses
    },
    isRunning: {
      value: false
    },
    shouldStop: {
      value: false
    },
    currentRunningTokenId: {
      value: null
    },
    batchSettings: {},
    addLog() {},
    message: {
      success() {},
      warning() {}
    },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => release.push(1),
    tokenStore: {
      getWebSocketStatus: id => id === "a" ? "connected" : "disconnected",
      closeWebSocketConnection: id => close.push(id),
      sendMessageWithPromise: async (id, cmd, p) => {
        if (id === "b") throw Error("timeout");
        return f.send(cmd, p);
      }
    }
  };
  const f = fixture("camp");
  await createTasksSignupCheer(deps, {
    now,
    sleep: async () => {},
    loadConfig: async () => config
  }).batchCampSignup();
  assert.deepEqual(statuses, {
    a: "completed",
    b: "failed"
  });
  assert.deepEqual(close, ["b"]);
  assert.equal(release.length, 1);
  assert.equal(deps.isRunning.value, false);
});

test("确认查询缺少报名状态时失败，不能把空响应当成功", async () => {
  for (const kind of ["camp", "peach", "golden"]) {
    const f = fixture(kind);
    let written = false;
    const send = async (cmd, params) => {
      if (written) return {};
      const response = await f.send(cmd, params);
      if (["club_signup", "legion_payloadsignup", "saltroad_outcheer"].includes(cmd)) written = true;
      return response;
    };
    await assert.rejects(({ camp: runAutoCampSignup, peach: runAutoPeachSignup, golden: runGoldenCheer }[kind])({ send, config, now, legionId: 321, expectedPhase: "261003" }), /结果未确认/);
  }
});

test("用户停止后不再启动下一账号，不发送报名并释放连接", async () => {
  const connected = [], closed = [], status = {};
  const f = fixture("camp");
  const deps = { selectedTokens: { value: ["a", "b"] }, tokens: { value: [] }, tokenStatus: { value: status }, isRunning: { value: false }, shouldStop: { value: false }, currentRunningTokenId: { value: null }, batchSettings: {}, addLog() {}, message: { success() {}, warning() {} }, ensureConnection: async id => connected.push(id), releaseConnectionSlot() {}, tokenStore: { getWebSocketStatus: () => "disconnected", closeWebSocketConnection: id => closed.push(id), sendMessageWithPromise: async (id, cmd, params) => { const response = await f.send(cmd, params); deps.shouldStop.value = true; return response; } } };
  await createTasksSignupCheer(deps, { now, sleep: async () => {}, loadConfig: async () => config }).batchCampSignup();
  assert.deepEqual(connected, ["a"]); assert.deepEqual(closed, ["a"]);
  assert.deepEqual(status, { a: "stopped", b: "stopped" });
  assert.ok(!f.calls.some(call => call.cmd === "club_signup"));
});
