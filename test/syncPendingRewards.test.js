import test from "node:test";
import assert from "node:assert/strict";
import { syncPendingRewards } from "../src/utils/syncPendingRewards.js";
const prefix = "async:claim:reward:v2:";
function fixture(initial = {}, types = ["evoTowerShop", "legionHorse"]) {
  const flags = { ...initial }, calls = [], logs = [];
  const options = {
    request: async (stage, cmd, params) => {
      calls.push({ cmd, params });
      if (cmd === "role_getroleinfo") return { role: { statistics: { ...flags } } };
      if (cmd === "system_getdatabundlever") return { dataBundleVer: "current-version" };
      if (cmd === "role_asyncclaimreward") delete flags["async:claim:reward"];
      if (cmd === "role_asyncclaimrewardv2") delete flags[prefix + params.type];
      return {};
    },
    loadConfig: async version => { assert.equal(version, "current-version"); return { LocalConf: { chargeRequest: types } }; },
    log: (text, type) => logs.push({ text, type }),
  };
  return { flags, calls, logs, options };
}
test("无待领标记只同步角色和通用补发，不下载配置、不请求异步领奖", async () => {
  const f = fixture(); await syncPendingRewards(f.options);
  assert.deepEqual(f.calls.map(c => c.cmd), ["role_getroleinfo", "role_backclaimreward", "role_getroleinfo"]);
});
test("怪异塔、其他类别与未来新增类别跟随当前官方配置，每类单次领取并查角色确认", async () => {
  const types = ["evoTowerShop", "legionHorse", "futureType"];
  const f = fixture(Object.fromEntries(types.map(type => [prefix + type, 1])), types);
  await syncPendingRewards(f.options);
  assert.deepEqual(f.calls.filter(c => c.cmd === "role_asyncclaimrewardv2").map(c => c.params), types.map(type => ({ type, isAll: true, rewardId: "" })));
  assert.equal(f.calls.filter(c => c.cmd === "role_getroleinfo").length, 5);
});
test("旧异步标记先领取并复查，不把直接奖励当成邮件", async () => {
  const f = fixture({ "async:claim:reward": 1 }); await syncPendingRewards(f.options);
  assert.equal(f.calls.filter(c => c.cmd === "role_asyncclaimreward").length, 1);
  assert.ok(f.logs.some(l => l.type === "success"));
});
test("不自动领取未在官方登录配置的类别或非1标记", async () => {
  const f = fixture({ [prefix + "unknown"]: 1, [prefix + "evoTowerShop"]: 2 });
  await syncPendingRewards(f.options);
  assert.ok(!f.calls.some(c => c.cmd === "role_asyncclaimrewardv2"));
  assert.ok(f.logs.some(l => l.type === "warning"));
});
test("领取超时后标记清除则确认，不重发；仍待领则失败停止后续类别", async () => {
  for (const cleared of [true, false]) {
    const f = fixture({ [prefix + "evoTowerShop"]: 1, [prefix + "legionHorse"]: 1 });
    const original = f.options.request;
    f.options.request = async (...args) => {
      if (args[1] === "role_asyncclaimrewardv2") {
        f.calls.push({ cmd: args[1] });
        if (cleared) delete f.flags[prefix + args[2].type];
        throw new Error("超时");
      }
      return original(...args);
    };
    if (cleared) await syncPendingRewards(f.options);
    else await assert.rejects(syncPendingRewards(f.options), /超时/);
    assert.equal(f.calls.filter(c => c.cmd === "role_asyncclaimrewardv2").length, cleared ? 2 : 1);
  }
});
test("不完整角色查询或配置加载失败都不盲目发送异步领奖", async () => {
  const f = fixture(); f.options.request = async () => ({});
  await assert.rejects(syncPendingRewards(f.options), /未确认/);
  const g = fixture({ [prefix + "evoTowerShop"]: 1 });
  g.options.loadConfig = async () => { throw new Error("版本不一致"); };
  await assert.rejects(syncPendingRewards(g.options), /版本不一致/);
  assert.ok(!g.calls.some(c => c.cmd === "role_asyncclaimrewardv2"));
});
test("不同账号的待领标记相互隔离", async () => {
  const a = fixture({ [prefix + "evoTowerShop"]: 1 }), b = fixture();
  await Promise.all([syncPendingRewards(a.options), syncPendingRewards(b.options)]);
  assert.equal(a.calls.filter(c => c.cmd === "role_asyncclaimrewardv2").length, 1);
  assert.equal(b.calls.filter(c => c.cmd === "role_asyncclaimrewardv2").length, 0);
});

test("null统计不是省略的默认空Map，拒绝当成没有奖励", async () => {
  const f = fixture(); f.options.request = async () => ({ role: { statistics: null } });
  await assert.rejects(syncPendingRewards(f.options), /标记格式异常/);
});
