import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCelebrationInfo, runRechargeStandard } from "../src/utils/rechargeActivity.js";
const NOW = Date.parse("2026-10-16T14:00:00+08:00");
function fixture() {
  const base = { start: NOW / 1000 - 7200, end: NOW / 1000 + 86400 };
  const config = { actConstantConf: { 1: { ...base, id: 20261016, name: "5周年" } }, ActFestivalConf: { 1: { ...base, id: 1, actType: 13 }, 2: { ...base, id: 2, actType: 2 }, 3: { ...base, id: 3, actType: 3 } }, SingleSignConf: {}, GlobalSignConf: {} };
  let info = {}; const calls = [];
  const send = async (cmd, params) => {
    calls.push([cmd, params]);
    if (cmd === "celebrate_getcelebrateinfo") return structuredClone(info);
    if (cmd === "celebrate_sign") { info = { signCelebrate: { personalSignMap: { 261016: NOW } } }; return structuredClone(info); }
    if (cmd === "activity_get") return { activity: { commonActivityInfo: {} } };
    throw new Error(cmd);
  };
  return { config, send, calls, now: () => NOW, setInfo: value => { info = value; } };
}
test("祝福查询继承模型缺省signCelebrate时补空实例，保留全服进度", () => {
  const info = normalizeCelebrationInfo({ fullServerSignCnt: 10 });
  assert.equal(info.fullServerSignCnt, 10);
  assert.deepEqual(info.signCelebrate, { personalSignMap: {}, personalClaimMap: {}, fullServerClaimMap: {} });
  assert.equal(normalizeCelebrationInfo({}).fullServerSignCnt, 0);
});
test("祝福兼容声明的领奖嵌套结构和Map，个人状态补回零默认值", () => {
  const info = normalizeCelebrationInfo({ _raw: { body: { celebrateInfoResp: { signCelebrate: { personalClaimMap: new Map([[1, {}]]) } } } } });
  assert.equal(info.signCelebrate.personalClaimMap[1].claimCnt, 0);
  assert.equal(info.signCelebrate.personalClaimMap[1].signState, 0);
});
test("首次查询空状态后执行祝福并刷新验证，不把空初始状态判成报错", async () => {
  const f = fixture();
  assert.equal((await runRechargeStandard(f)).status, "completed");
  assert.deepEqual(f.calls.slice(0, 3).map(([cmd]) => cmd), ["celebrate_getcelebrateinfo", "celebrate_sign", "celebrate_getcelebrateinfo"]);
});
test("已签到的日期键即便时间值为0也不重复祝福", async () => {
  const f = fixture(); f.setInfo({ signCelebrate: { personalSignMap: { 261016: 0 } } });
  assert.equal((await runRechargeStandard(f)).status, "completed");
  assert.equal(f.calls.some(([cmd]) => cmd === "celebrate_sign"), false);
});
test("空初始状态可兼容，但明确异常结构不触发签到或领奖", async () => {
  for (const data of [null, [], { signCelebrate: null }, { signCelebrate: { personalSignMap: [] } }, { unrelated: true }]) {
    assert.throws(() => normalizeCelebrationInfo(data), /异常|未知|格式/);
  }
  const f = fixture(); f.setInfo({ role: {} });
  assert.equal((await runRechargeStandard(f)).status, "failed");
  assert.equal(f.calls.some(([cmd]) => cmd === "celebrate_sign"), false);
});
test("签到写后仍为空时只报告未确认，不重试消耗或重复签到", async () => {
  const f = fixture(); const send = async (cmd, params) => { const result = await f.send(cmd, params); if (cmd === "celebrate_sign") f.setInfo({}); return result; };
  const result = await runRechargeStandard({ ...f, send });
  assert.match(result.reason, /生日祝福状态未确认/);
  assert.equal(f.calls.filter(([cmd]) => cmd === "celebrate_sign").length, 1);
});
