import test from "node:test";
import assert from "node:assert/strict";
import { claimMailRewards } from "../src/utils/claimMailRewards.js";

function fixture(handler = () => ({})) {
  const calls = [], logs = [];
  return { calls, logs, options: {
    send: async (cmd, params) => { calls.push({ cmd, params }); return cmd === "role_getroleinfo" ? { role: { statistics: {} } } : handler(cmd, params, calls); },
    log: (text, type) => logs.push({ text, type }),
  } };
}
test("邮件领取按角色查询、通用补发、刷新、领取、复查执行，保留系统邮件范围", async () => {
  const f = fixture(cmd => cmd === "mail_claimallattachment" ? { reward: [{ value: 1 }] } : {});
  assert.equal((await claimMailRewards(f.options)).reward.length, 1);
  assert.deepEqual(f.calls.map(c => c.cmd), ["role_getroleinfo", "role_backclaimreward", "role_getroleinfo", "mail_getlist", "mail_claimallattachment", "mail_getlist"]);
  assert.deepEqual(f.calls[3].params, { category: [0, 4, 5], lastId: 0, size: 60 });
  assert.deepEqual(f.calls[4].params, { category: 0 });
});
test("补发失败停止，不领取、不重发；不把错误当成空邮箱", async () => {
  const f = fixture(cmd => { if (cmd === "role_backclaimreward") throw new Error("超时"); return {}; });
  await assert.rejects(claimMailRewards(f.options), e => e.mailStage === "奖励补发");
  assert.deepEqual(f.calls.map(c => c.cmd), ["role_getroleinfo", "role_backclaimreward", "role_getroleinfo"]);
});
test("领取超时后只查邮箱，不重复领取且保留未确认错误", async () => {
  const f = fixture(cmd => { if (cmd === "mail_claimallattachment") throw new Error("超时"); return {}; });
  await assert.rejects(claimMailRewards(f.options), e => e.mailStage === "附件领取");
  assert.equal(f.calls.filter(c => c.cmd === "mail_claimallattachment").length, 1);
  assert.equal(f.calls.at(-1).cmd, "mail_getlist");
});
test("异常邮箱响应阻止领取；未领附件复查输出警告", async () => {
  const f = fixture(cmd => cmd === "mail_getlist" ? { list: null } : {});
  await assert.rejects(claimMailRewards(f.options), /异常/);
  assert.equal(f.calls.length, 4);
  const g = fixture(cmd => cmd === "mail_getlist" ? { list: [{ category: 0, haveAttachments: true, state: 1 }] } : {});
  await claimMailRewards(g.options);
  assert.ok(g.logs.some(l => /仍有1封/.test(l.text)));
});
test("账号之间无共享补发状态，每次独立查询；停止后不发送", async () => {
  const a = fixture(), b = fixture();
  await Promise.all([claimMailRewards(a.options), claimMailRewards(b.options)]);
  assert.equal(a.calls.length, 6); assert.equal(b.calls.length, 6);
  const c = fixture(); c.options.stopped = () => true;
  await assert.rejects(claimMailRewards(c.options), e => e.interrupted === true);
  assert.equal(c.calls.length, 0);
});
