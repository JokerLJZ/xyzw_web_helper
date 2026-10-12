import assert from "node:assert/strict";
import test from "node:test";
import { runApexDailyTask, buildApexDailyRules, getApexChinaDate, createApexDailySender } from "../src/utils/apexDailyTask.js";
import { defaultSettings, defaultTemplate } from "../src/utils/batch/constants.js";
import { DailyTaskRunner } from "../src/utils/dailyTaskRunner.js";

const stamp = text => Date.parse(text + "+08:00");
const MONDAY = stamp("2026-10-12T10:00:00");
function config() {
  return {
    ApexScheduleConf: {
      1: { id: 1, season: 1, round: 1, ApexStage: 3, serverDate: "2026/10/08", endDate: "", signStartTime: -86400, signEndTime: 43200, lockTime: 64800, fightTime: 68400, endTime: 71100, advanceNum: 0 },
      2: { id: 2, season: 1, round: 1, ApexStage: 4, serverDate: "2026/10/12", endDate: "", signStartTime: 0, signEndTime: 0, lockTime: 64800, fightTime: 68400, endTime: 71100, advanceNum: 2 },
      3: { id: 3, season: 1, round: 1, ApexStage: 10, serverDate: "2026/10/20", endDate: "2026/10/25", signStartTime: 0, signEndTime: 0, lockTime: 64800, fightTime: 68400, endTime: 71100, advanceNum: 1 },
    },
    ApexSeasonConf: { 1: {season:1,startDate:"2026/10/01",endDate:"2026/10/25"} },
    ApexStageConf: { 4: { ApexStage: 4, simpleName: "64强赛" }, 10: { ApexStage: 10, simpleName: "决赛" } },
    ApexTaskConf: { 7: { id: 7, ApexTaskType: 4, completeValue: 1 }, 1: {id:1,ApexTaskType:1,completeValue:1} },
  };
}
function fixture({ time = MONDAY, inventory = 3, voteList, groups, guessMap = {}, failure, storage: sharedStorage } = {}) {
  let current = time, stop = false;
  const c = config(), calls = [], logs = [];
  const memory = new Map();
  const storage = sharedStorage || { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
  let info = { roleId: 1, resetTime: {season:1, day:261012}, voteItemCnt: inventory, voteMap: {}, guessMap, taskClaimedMap: {}, taskProgress: { 1: 0, 4: 0 }, group: {} };
  const read = () => structuredClone(info);
  const send = async (cmd, params) => {
    calls.push({cmd, params});
    const reject = failure?.(cmd, params, calls);
    if (reject === "before") throw new Error("请求超时");
    if (cmd === "apex_getroleinfo") return { apexRoleInfo: read() };
    if (cmd === "apex_getvotelist") return { apexVoteList: voteList || [{teamId:"first",name:"第一队",isOut:false,cheerCnt:1}, {teamId:"second",cheerCnt:9999,isOut:false}], last: true };
    if (cmd === "apex_vote") {
      info.voteItemCnt -= params.voteCnt;
      info.voteMap[params.round] ||= {};
      const record = info.voteMap[params.round][params.teamId] ||= {cnt:0}; record.cnt += params.voteCnt;
      info.taskProgress[4] += params.voteCnt;
    } else if (cmd === "apex_taskclaim") info.taskClaimedMap[params.confId] = true;
    else if (cmd === "apex_getguesslist") return { apexGuessList: groups || [[{teamId:"low",cheerCnt:1},{teamId:"high",cheerCnt:12}], [{teamId:"tie-first",cheerCnt:2},{teamId:"tie-second",cheerCnt:2}]], last: true };
    else if (cmd === "apex_guess") { (info.guessMap[2] ||= []).push(params.teamId); }
    else throw new Error(`意外指令${cmd}`);
    if (reject === "after") throw new Error("请求超时");
    return { apexRoleInfo: read() };
  };
  const options = { accountId:"a", send, config:c, storage, now:()=>current, stopped:()=>stop, log:text=>logs.push(text) };
  return { options, calls, logs, storage, info, setInfo:x=>{info=x;}, setTime:t=>{current=t;}, stop:()=>{stop=true;}, run:()=>runApexDailyTask(options) };
}
const commands = (f, cmd) => f.calls.filter(call=>call.cmd===cmd);

test("日常和模板默认关闭，新旧账号设置均默认关闭", () => {
  assert.equal(defaultSettings.apexDailyEnable, false);
  assert.equal(defaultTemplate.apexDailyEnable, false);
  const original = globalThis.localStorage;
  globalThis.localStorage = {getItem:()=>JSON.stringify({claimEmail:true})};
  try { assert.equal(new DailyTaskRunner({}).loadSettings("a").apexDailyEnable, false); }
  finally { globalThis.localStorage = original; }
});
test("周一助威使用全部道具给列表第一队，先完成助威再领大厅奖励", async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(commands(f,"apex_vote").map(x=>x.params), [{round:1,teamId:"first",voteCnt:3}]);
  assert.equal(f.info.voteItemCnt,0);
  assert.deepEqual(commands(f,"apex_taskclaim").map(x=>x.params), [{confId:7}]);
  assert.equal(commands(f,"apex_getvotelist")[0].params.groupId,0);
  assert.ok(f.calls.findIndex(x=>x.cmd==="apex_taskclaim") > f.calls.findIndex(x=>x.cmd==="apex_vote"));
});
test("助威超过9999分批用完，每批读取服务器库存确认", async () => {
  const f=fixture({inventory:20001});await f.run();
  assert.deepEqual(commands(f,"apex_vote").map(x=>x.params.voteCnt),[9999,9999,3]);
  assert.equal(f.info.voteItemCnt,0);
});
test("周日只领已完成未领取的大厅任务，不发送助威", async () => {
  const f=fixture({time:stamp("2026-10-18T10:00:00")});f.info.taskProgress={1:1,4:1};f.info.taskClaimedMap={1:true};await f.run();
  assert.equal(commands(f,"apex_vote").length,0);
  assert.deepEqual(commands(f,"apex_taskclaim").map(x=>x.params),[{confId:7}]);
});
test("非周一周日不助威和领奖，只在开放时预测支持人数多的队伍，平票选第一队", async () => {
  const f=fixture({time:stamp("2026-10-20T10:00:00"),groups:[]});await f.run();
  assert.equal(commands(f,"apex_vote").length,0);assert.equal(commands(f,"apex_taskclaim").length,0);
  const g=fixture();await g.run();assert.deepEqual(commands(g,"apex_guess").map(x=>x.params.teamId),["high","tie-first"]);
});
test("已预测一方的对阵不反向再预测，同一天重跑不发送请求", async () => {
  const f=fixture({guessMap:{2:["low"]}});await f.run();
  assert.deepEqual(commands(f,"apex_guess").map(x=>x.params.teamId),["tie-first"]);
  const length=f.calls.length;const result=await f.run();assert.equal(result.status,"skipped");assert.equal(f.calls.length,length);
});
test("同周周一重跑不会再消耗新获得的助威道具", async () => {
  const f=fixture();await f.run();
  const key="apex-daily:v1:a",record=JSON.parse(f.storage.getItem(key));delete record.checkedDay;f.storage.setItem(key,JSON.stringify(record));
  f.info.voteItemCnt=5;await f.run();assert.equal(commands(f,"apex_vote").length,1);assert.equal(f.info.voteItemCnt,5);
});
test("助威超时但服务器已生效，复查后不会重复使用道具", async () => {
  const f=fixture({failure:cmd=>cmd==="apex_vote"?"after":null});await f.run();
  assert.equal(commands(f,"apex_vote").length,1);assert.equal(f.info.voteItemCnt,0);assert.equal(commands(f,"apex_taskclaim").length,1);
});
test("写请求未生效时停止，不盲目重试；重新执行先查状态再继续", async () => {
  let failed=false;
  const f=fixture({failure:cmd=>{if(cmd==="apex_vote"&&!failed){failed=true;return"before";}}});
  await assert.rejects(f.run(),/超时/);assert.equal(commands(f,"apex_vote").length,1);
  const boundary=f.calls.length;await f.run();assert.equal(f.calls[boundary].cmd,"apex_getroleinfo");assert.equal(f.info.voteItemCnt,0);
});
test("两个账号库存、每日检查记录互相隔离", async () => {
  const f=fixture({inventory:2}),g=fixture({inventory:7,storage:f.storage});g.options.accountId="b";await f.run();await g.run();
  assert.equal(commands(f,"apex_vote")[0].params.voteCnt,2);assert.equal(commands(g,"apex_vote")[0].params.voteCnt,7);
});
test("未开放竞猜阶段不拉取预测列表也不下注", async () => {
  const f=fixture({time:stamp("2026-10-11T10:00:00")});await f.run();assert.equal(commands(f,"apex_getguesslist").length,0);assert.equal(commands(f,"apex_guess").length,0);
});
test("读取到停止信号不继续发送命令", async () => {
  const f=fixture();f.stop();await assert.rejects(f.run(),error=>error.interrupted===true);assert.equal(f.calls.length,0);
});
test("预测分页完整读取后才写入；空页未结束时停止", async () => {
  const f=fixture({inventory:0});const original=f.options.send;
  f.options.send=async(cmd,params)=>cmd==="apex_getguesslist"?{apexGuessList:[],last:false}:original(cmd,params);
  await assert.rejects(f.run(),/分页未结束/);assert.equal(commands(f,"apex_guess").length,0);
});
test("淘汰队伍跳过，选择第一支仍可助威队伍", async () => {
  const f=fixture({voteList:[{teamId:"out",isOut:true},{teamId:"eligible",isOut:false}]});await f.run();assert.equal(commands(f,"apex_vote")[0].params.teamId,"eligible");
});
test("官方配置规则独立且固定北京时间，未来赛程无需写死哈希", () => {
  const c=config(),r=buildApexDailyRules(c);assert.equal(r.getDateZeroTime("2026/10/12"),stamp("2026-10-12T00:00:00"));
  const newer=config();newer.ApexScheduleConf[2].lockTime=32400;newer.ApexScheduleConf[2].fightTime=39600;const r2=buildApexDailyRules(newer);
  assert.equal(r.getScheduleStatus(2,MONDAY),1);assert.equal(r2.getScheduleStatus(2,MONDAY),2);
  assert.equal(getApexChinaDate(stamp("2026-10-12T00:00:00")).weekday,1);
});
test("请求限流器不会自动重复写请求，排队期间停止不发送", async () => {
  const calls=[];let stopped=false;
  const sender=createApexDailySender({send:async(...args)=>calls.push(args),stopped:()=>stopped,action:async(type,fn,opts)=>{assert.equal(opts.maxRetry,0);stopped=true;return fn();}});
  await assert.rejects(sender("apex_vote",{}),error=>error.interrupted);assert.equal(calls.length,0);
});

test("每天按新日期检查，未开放时不预测，非周一也会预测当天开放对阵", async () => {
  const f = fixture({time:stamp("2026-10-13T10:00:00")});
  f.options.config.ApexScheduleConf[2].serverDate="2026/10/13";
  await f.run();assert.equal(commands(f,"apex_vote").length,0);
  assert.deepEqual(commands(f,"apex_guess").map(x=>x.params.teamId),["high","tie-first"]);
  const before=commands(f,"apex_getroleinfo").length;
  f.setTime(stamp("2026-10-14T10:00:00"));await f.run();
  assert.ok(commands(f,"apex_getroleinfo").length>before);
});
test("同一赛程有多页时先读取到last，再按照清单预测", async () => {
  const f=fixture({inventory:0});const original=f.options.send, events=[];
  f.options.send=async(cmd,params)=>{
    events.push(cmd);
    if(cmd==="apex_getguesslist")return {apexGuessList:params.idx===0?[[{teamId:"a",cheerCnt:5},{teamId:"b",cheerCnt:2}]]:[[{teamId:"c",cheerCnt:2},{teamId:"d",cheerCnt:3}]],last:params.idx===1};
    return original(cmd,params);
  };
  await f.run();assert.deepEqual(events.filter(x=>["apex_getguesslist","apex_guess"].includes(x)),["apex_getguesslist","apex_getguesslist","apex_guess","apex_guess"]);
});
test("决赛一方已有胜利结果不再预测", async () => {
  const f=fixture({time:stamp("2026-10-20T10:00:00"),groups:[[{teamId:"a",cheerCnt:3,isWin:true},{teamId:"b",cheerCnt:4,isWin:false}]]});
  await f.run();assert.equal(commands(f,"apex_guess").length,0);
});
test("缺少完整账号状态不根据零库存或空记录继续操作", async () => {
  const f=fixture();delete f.info.voteMap;await assert.rejects(f.run(),/状态不完整/);assert.equal(commands(f,"apex_vote").length,0);
});
test("助威成功但复查失败时保留待确认记录，恢复后只使用剩余道具", async () => {
  const f=fixture({inventory:10002}),original=f.options.send;let reads=0,failed=false;
  f.options.send=async(cmd,params)=>{
    if(cmd==="apex_getroleinfo"&&++reads===2&&!failed){failed=true;throw new Error("复查失败");}
    return original(cmd,params);
  };
  await assert.rejects(f.run(),/复查失败/);
  assert.ok(JSON.parse(f.storage.getItem("apex-daily:v1:a")).pending);
  await f.run();assert.deepEqual(commands(f,"apex_vote").map(x=>x.params.voteCnt),[9999,3]);assert.equal(f.info.voteItemCnt,0);
});
test("正式赛段助威榜使用当前阶段账号分组，淘汰赛榜使用0组", async () => {
  const f=fixture({time:stamp("2026-10-05T14:00:00")});
  f.options.config.ApexScheduleConf[1].serverDate="2026/10/05";
  f.options.config.ApexScheduleConf[1].signStartTime=-86400;
  f.info.group={1:3};await f.run();assert.equal(commands(f,"apex_getvotelist")[0].params.groupId,3);
});

test("日常今天已检查时跳过，不发送请求或关闭现有连接", async () => {
  const original=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>JSON.stringify({checkedDay:getApexChinaDate(Date.now()).day}),setItem(){}};
  try {
    const runner=new DailyTaskRunner({sendMessageWithPromise:()=>assert.fail("不得发送请求"),closeWebSocketConnection:()=>assert.fail("不得关闭日常连接")});runner.roleSnapshots.set("a",{gold:100,heroes:{107:{level:900}}});
    const result=await runner.runApexTask("a");assert.equal(result.status,"skipped");assert.equal(runner.roleStateDirty,true);
    assert.equal(runner.roleSnapshots.get("a").gold,100);
  } finally {globalThis.localStorage=original;}
});
