import test from "node:test";
import assert from "node:assert/strict";
import { cleanupMondayMail } from "../src/utils/mondayMailCleanup.js";
import { defaultSettings, defaultTemplate } from "../src/utils/batch/constants.js";
import { DailyTaskRunner } from "../src/utils/dailyTaskRunner.js";
const monday = Date.parse("2026-10-19T00:00:00+08:00");
function fixture(rows, fail) {
  let mails = structuredClone(rows), stopped = false;
  const calls = [];
  const options = { now: () => monday, stopped: () => stopped,
    send: async (cmd, p) => {
      calls.push({ cmd, p });
      if (cmd === "mail_getlist") return { list: structuredClone(mails.slice(0,60)), left: Math.max(0,mails.length-60) };
      if (fail) return fail(cmd,p,mails);
      const mail = mails.find(row => row.id === p.mailId);
      if (cmd === "mail_claimattachment") mail.state = 3;
      else { mail.state = 9; mails = mails.filter(row => row.id !== p.mailId); }
      return { mail: structuredClone(mail) };
    } };
  return { options, calls, stop: () => { stopped = true; } };
}
test("新旧账号和批量模板默认关闭", () => {
  assert.equal(defaultSettings.mondayMailCleanup, false);
  assert.equal(defaultTemplate.mondayMailCleanup, false);
  const old = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ claimEmail: true }) };
  try { assert.equal(new DailyTaskRunner({}).loadSettings("a").mondayMailCleanup, false); }
  finally { globalThis.localStorage = old; }
});
test("北京时间仅周一执行：周日23:59不请求，周一0点开始", async () => {
  const f = fixture([]); f.options.now = () => monday - 1;
  assert.equal((await cleanupMondayMail(f.options)).status, "skipped");
  assert.equal(f.calls.length, 0);
  f.options.now = () => monday;
  assert.equal((await cleanupMondayMail(f.options)).status, "completed");
});
test("只查询系统邮件和公告，附件确认后删除，无附件和已领取邮件直接删除", async () => {
  const f = fixture([{ id:1, category:0, state:1, haveAttachments:true }, { id:2,category:5,state:1 }, {id:3,category:0,state:3,haveAttachments:true}]);
  const result = await cleanupMondayMail(f.options);
  assert.equal(result.claimed,1); assert.equal(result.deleted,3);
  assert.deepEqual(f.calls.filter(c => c.cmd !== "mail_getlist").map(c => [c.cmd,c.p.mailId]), [
    ["mail_claimattachment",1],["mail_changestate",1],["mail_changestate",2],["mail_changestate",3],
  ]);
  assert.ok(f.calls.filter(c=>c.cmd==='mail_getlist').every(c=>JSON.stringify(c.p.category)==='[0,5]'));
});
test("附件领取失败或未确认不能删除，异常分类不能处理", async () => {
  const f = fixture([{id:1,category:0,haveAttachments:true}], async()=>{throw new Error("服务器错误:200020");});
  await assert.rejects(cleanupMondayMail(f.options), /200020/);
  assert.ok(!f.calls.some(c => c.cmd === "mail_changestate"));
  const g = fixture([{id:1,category:4}]);
  await assert.rejects(cleanupMondayMail(g.options), /分类/);
  assert.equal(g.calls.length,1);
});
test("超时先查询，确认已领取后才删除，不重发附件请求", async () => {
  const f = fixture([{id:1,category:0,haveAttachments:true}], async(cmd,p,mails)=>{
    if(cmd === "mail_claimattachment") { mails[0].state=3; throw new Error("请求超时"); }
    mails[0].state=9; return { mail: structuredClone(mails[0]) };
  });
  assert.equal((await cleanupMondayMail(f.options)).claimed,1);
  assert.equal(f.calls.filter(c=>c.cmd==='mail_claimattachment').length,1);
});
test("超过60封逐批清理，用户停止不删除，重复执行空列表正常完成", async () => {
  const f = fixture(Array.from({length:61},(_,i)=>({id:i+1,category:0})));
  assert.equal((await cleanupMondayMail(f.options)).deleted,61);
  assert.equal((await cleanupMondayMail(f.options)).deleted,0);
  const g=fixture([{id:1,category:5}]);g.stop();
  await assert.rejects(cleanupMondayMail(g.options), /停止/);
  assert.equal(g.calls.length,0);
});

test("空邮件响应省略list与left按协议默认值完成，不发送领取删除", async () => {
  for (const response of [{}, {list:[]}, {left:0}, {_raw:{code:0,body:{}}}, {data:{}}]) {
    const calls = [];
    const result = await cleanupMondayMail({ now: () => monday, send: async cmd => { calls.push(cmd); return response; } });
    assert.equal(result.status,"completed");
    assert.equal(result.deleted,0);
    assert.deepEqual(calls,["mail_getlist"]);
  }
});
test("非法列表、非法剩余数量、空响应与明确失败仍报错", async () => {
  for (const response of [null, undefined, [], {list:null}, {list:{}}, {left:null}, {left:-1}, {left:"0"}, {code:200020}, {_raw:{code:200020,body:{}}}, {left:1}]) {
    await assert.rejects(cleanupMondayMail({now:()=>monday,send:async()=>response}));
  }
});
test("删除超时后空响应可确认已删除，left省略不误报失败", async () => {
  let reads=0, sends=0;
  const result = await cleanupMondayMail({now:()=>monday,send:async cmd=>{
    if(cmd==="mail_getlist")return ++reads===1 ? {list:[{id:1,category:5}]} : {};
    sends++;throw new Error("请求超时");
  }});
  assert.equal(result.deleted,1);assert.equal(sends,1);
});
