import assert from "node:assert/strict";
import test from "node:test";
import { runApexGuessTask, runApexDailyTask, buildApexDailyRules, getApexChinaDate, createApexDailySender, getApexClaimableRounds } from "../src/utils/apexDailyTask.js";
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
  let info = { roleId: 1, resetTime: {season:1, day:261012}, voteItemCnt: inventory, voteMap: {}, guessClaimMap: {}, guessMap, taskClaimedMap: {}, taskProgress: { 1: 0, 4: 0 }, group: {} };
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
    else if (cmd === "apex_guessclaim") { (info.guessClaimMap[params.scheduleId] ||= {})[params.teamId] = true; }
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
  const length=f.calls.length;const result=await f.run();assert.equal(result.status,"completed");assert.ok(f.calls.length > length);assert.equal(commands(f,"apex_guess").length,1);
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


test("正常短请求间隔静默，较长等待十秒内合并提示", async () => {
  let time = 0;
  const logs = [];
  const waits = [200, 800, 2999, 3200, 5000, 5000];
  const sender = createApexDailySender({
    send: async () => ({}), log: text => logs.push(text), now: () => time, pause: async () => {},
    action: async (type, fn, options) => { options.onWait(waits.shift(), {reason:"interval"}); return fn(); },
  });
  for (let i=0;i<5;i++) await sender("apex_getroleinfo");
  assert.equal(logs.length,1);
  assert.match(logs[0],/等待请求间隔/);
  time=10000;await sender("apex_getroleinfo");assert.equal(logs.length,2);
});

test("真实服务器限速重试提示不会被正常等待过滤", async () => {
  const logs=[];
  const sender=createApexDailySender({
    send:async()=>({}),log:text=>logs.push(text),now:()=>0,pause:async()=>{},
    action:async(type,fn,options)=>{options.onWait(800,{reason:"rate-limit"});return fn();},
  });
  await sender("apex_getroleinfo");await sender("apex_getroleinfo");
  assert.equal(logs.length,2);assert.ok(logs.every(text=>text.includes("服务器限速")));
});


test("历史竞猜赢家领奖，已领、输家和未出结果不领取；当天检查记录不挡领奖", async () => {
  const f=fixture({inventory:0,groups:[[{teamId:"winner",cheerCnt:8,isWin:true,isOut:false},{teamId:"loser",cheerCnt:2,isWin:false,isOut:true}]]});
  f.info.guessMap={3:["winner","loser"]};f.info.guessClaimMap={3:{winner:false,loser:false}};
  f.storage.setItem("apex-daily:v1:a",JSON.stringify({checkedDay:getApexChinaDate(MONDAY).day}));
  await f.run();assert.deepEqual(commands(f,"apex_guessclaim").map(x=>x.params),[{scheduleId:3,teamId:"winner"}]);
  await f.run();assert.equal(commands(f,"apex_guessclaim").length,1);
});
test("批量竞猜共用多数选择、已有选择不反押，领奖超时已生效不重发", async () => {
  const f=fixture({guessMap:{2:["low"],3:["winner"]},failure:cmd=>cmd==="apex_guessclaim"?"after":null});
  f.info.guessClaimMap={3:{winner:false}};
  const original=f.options.send;
  f.options.send=(cmd,params)=>cmd==="apex_getguesslist"&&params.scheduleId===3?Promise.resolve({apexGuessList:[[{teamId:"winner",isWin:true,isOut:false},{teamId:"loser",isWin:false,isOut:true}]],last:true}):original(cmd,params);
  await runApexGuessTask(f.options);
  assert.equal(commands(f,"apex_vote").length,0);assert.equal(commands(f,"apex_taskclaim").length,0);
  assert.deepEqual(commands(f,"apex_guess").map(x=>x.params.teamId),["tie-first"]);
  assert.equal(f.info.guessClaimMap[3].winner,true);
});

test("决赛结束但游戏期次尚未关闭，仍可领取历史竞猜奖励", async () => {
  const f=fixture({time:stamp("2026-10-24T23:00:00"),groups:[[{teamId:"winner",isWin:true,isOut:false},{teamId:"loser",isWin:false,isOut:true}]]});
  f.info.guessMap={3:["winner"]};f.info.guessClaimMap={3:{winner:false}};
  await runApexGuessTask(f.options);
  assert.equal(commands(f,"apex_guess").length,0);assert.equal(commands(f,"apex_guessclaim").length,1);
});

test("批量入口执行统一竞猜领奖流程，结束后释放连接", async () => {
  const { createTasksApex } = await import("../src/utils/batch/tasksApex.js");
  const f=fixture({guessMap:{3:["winner"]}});f.info.guessClaimMap={3:{winner:false}};
  const original=f.options.send;
  f.options.send=(cmd,params)=>cmd==="apex_getguesslist"&&params.scheduleId===3?Promise.resolve({apexGuessList:[[{teamId:"winner",isWin:true,isOut:false},{teamId:"loser",isWin:false,isOut:true}]],last:true}):original(cmd,params);
  let closed=0,released=0;const status={value:{}};
  await createTasksApex({selectedTokens:{value:["a"]},tokens:{value:[{id:"a",name:"测试"}]},tokenStatus:status,isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},connectionQueue:{active:1},batchSettings:{maxActive:1},ensureConnection:async()=>{},releaseConnectionSlot:()=>released++,tokenStore:{closeWebSocketConnection:()=>closed++},addLog(){},message:{success(){}},apexOptions:f.options}).batchApexGuess();
  assert.equal(status.value.a,"completed");assert.equal(closed,1);assert.equal(released,1);
  assert.deepEqual(commands(f,"apex_guess").map(x=>x.params.teamId),["high","tie-first"]);
  assert.equal(commands(f,"apex_guessclaim").length,1);assert.equal(commands(f,"apex_vote").length,0);
});


test("缺失竞猜领取标记不当作可领取，不发送猜测的领奖请求", async () => {
  const f=fixture({time:stamp("2026-10-24T23:00:00"),groups:[[{teamId:"winner",isWin:true,isOut:false},{teamId:"loser",isWin:false,isOut:true}]]});
  f.info.guessMap={3:["winner"]};f.info.guessClaimMap={3:{}};
  await runApexGuessTask(f.options);assert.equal(commands(f,"apex_guessclaim").length,0);
});
test("只读200020冷却后有限重试，最终错误包含赛程和查询步骤", async () => {
  let time=10000,requests=0;const waits=[],logs=[];
  const sender=createApexDailySender({
    now:()=>time,pause:async ms=>{waits.push(ms);time+=ms;},log:text=>logs.push(text),
    action:async(type,fn)=>fn(),send:async()=>{requests++;throw new Error("服务器错误: 200020");},
  });
  await assert.rejects(sender("apex_getguesslist",{scheduleId:124}),/查询赛程124对阵列表失败.*200020/);
  assert.equal(requests,2);assert.ok(waits.includes(6000));assert.equal(logs.length,1);
});
test("写操作200020不自动重发，响应完成后查询也至少间隔1.5秒", async () => {
  let time=10000;const calls=[],waits=[];
  const sender=createApexDailySender({
    now:()=>time,pause:async ms=>{waits.push(ms);time+=ms;},action:async(type,fn)=>fn(),
    send:async cmd=>{calls.push(cmd);if(cmd==="apex_guess")throw new Error("服务器错误: 200020");return {};},
  });
  await assert.rejects(sender("apex_guess",{teamId:"target"}),/预测队伍target失败/);
  await sender("apex_getroleinfo");assert.deepEqual(calls,["apex_guess","apex_getroleinfo"]);assert.deepEqual(waits,[1500]);
});

test("竞猜领奖200020后一次核对未确认，保留记录且不重发或声称必然未生效", async () => {
  const f = fixture({ time: stamp("2026-10-24T23:00:00"), groups: [[{teamId:"winner",isWin:true,isOut:false}]] });
  f.info.guessMap = {3:["winner"]}; f.info.guessClaimMap = {3:{winner:false}};
  const send = f.options.send, writes = [], waits = [];
  f.options.pause = async ms => waits.push(ms);
  f.options.send = async (cmd, params) => {
    if (cmd === "apex_guessclaim") {
      writes.push(params);
      throw Object.assign(new Error("服务器错误: 200020 - 出了点小问题"), {code:200020});
    }
    return send(cmd, params);
  };
  await assert.rejects(runApexGuessTask(f.options), error => /领取未确认/.test(error.message) && error.code === 200020 && !/结果未生效/.test(error.message));
  assert.equal(writes.length, 1);
  assert.equal(commands(f, "apex_getroleinfo").length, 2);
  assert.deepEqual(waits, [6000]);
  assert.deepEqual(JSON.parse(f.storage.getItem("apex-daily:v1:a")).pendingClaims, [{scheduleId:3,teamId:"winner"}]);
});

test("竞猜领奖遵循客户端期次截止零点，保留决赛结束后的领奖窗口", () => {
  const rules = buildApexDailyRules(config());
  assert.deepEqual([...getApexClaimableRounds(rules, 1, stamp("2026-10-24T23:59:59"))], [1]);
  assert.deepEqual([...getApexClaimableRounds(rules, 1, stamp("2026-10-25T00:00:00"))], [1]);
  assert.deepEqual([...getApexClaimableRounds(rules, 1, stamp("2026-10-25T00:00:01"))], []);
});

test("游戏期次关闭后的false历史记录不再查询或领取", async () => {
  const f = fixture({ time: stamp("2026-11-20T10:00:00") });
  f.info.guessMap = {3:["winner"]}; f.info.guessClaimMap = {3:{winner:false}};
  await runApexGuessTask(f.options);
  assert.equal(commands(f,"apex_getguesslist").length, 0);
  assert.equal(commands(f,"apex_guessclaim").length, 0);
});

test("日志中的已关闭赛程74不会挡住当前竞猜奖励，兼容旧待确认记录", async () => {
  const f = fixture({ time: stamp("2026-10-18T08:00:00"), inventory:0, groups:[[{teamId:"current",isWin:true,isOut:false}]] });
  f.options.config.ApexScheduleConf[74] = {...f.options.config.ApexScheduleConf[2], id:74, round:0, serverDate:"2026/09/01"};
  f.options.config.ApexScheduleConf[78] = {...f.options.config.ApexScheduleConf[3], id:78, round:0, serverDate:"2026/09/08", endDate:"2026/09/27"};
  f.info.guessMap = {74:["A10000037"], 2:["current"]};
  f.info.guessClaimMap = {74:{A10000037:false}, 2:{current:false}};
  f.storage.setItem("apex-daily:v1:a", JSON.stringify({pending:{command:"apex_guessclaim",params:{scheduleId:74,teamId:"A10000037"},season:1}}));
  await f.run();
  assert.deepEqual(commands(f,"apex_guessclaim").map(item=>item.params), [{scheduleId:2,teamId:"current"}]);
  assert.deepEqual(commands(f,"apex_getguesslist").map(item=>item.params.scheduleId), [2]);
  assert.deepEqual(JSON.parse(f.storage.getItem("apex-daily:v1:a")).pendingClaims, []);
});

test("赢家省略默认isOut=false仍领奖，明确淘汰、未获胜和缺少标记仍跳过", async () => {
  const f = fixture({ time: stamp("2026-10-18T08:00:00"), inventory:0,
    groups:[[{teamId:"winner",isWin:true},{teamId:"out",isWin:true,isOut:true}], [{teamId:"unknown"},{teamId:"missing",isWin:true}]] });
  f.info.guessMap = {2:["winner","out","unknown","missing"]};
  f.info.guessClaimMap = {2:{winner:false,out:false,unknown:false}};
  await f.run();
  assert.deepEqual(commands(f,"apex_guessclaim").map(item=>item.params.teamId), ["winner"]);
});

test("一笔200020未领取不阻挡其余奖励，合并核对一次并保留失败记录", async () => {
  const f = fixture({ time: stamp("2026-10-18T08:00:00"), inventory:0,
    groups:[[{teamId:"bad",isWin:true},{teamId:"good",isWin:true}]] });
  f.info.guessMap = {2:["bad","good"]}; f.info.guessClaimMap = {2:{bad:false,good:false}};
  const send = f.options.send, writes = [];
  f.options.pause = async () => {};
  let reject = true;
  f.options.send = async (cmd, params) => {
    if (cmd === "apex_guessclaim") {
      writes.push(params.teamId);
      if (params.teamId === "bad" && reject) throw Object.assign(new Error("服务器错误: 200020"),{code:200020});
    }
    return send(cmd, params);
  };
  await assert.rejects(f.run(), error => error.claimedRewards === 1 && error.apexClaimFailures.length === 1);
  assert.deepEqual(writes, ["bad","good"]);
  assert.equal(f.info.guessClaimMap[2].good, true);
  assert.equal(commands(f,"apex_getroleinfo").length, 2);
  assert.deepEqual(JSON.parse(f.storage.getItem("apex-daily:v1:a")).pendingClaims, [{scheduleId:2,teamId:"bad"}]);
  reject = false;
  await f.run();
  assert.deepEqual(writes, ["bad","good","bad"]);
  assert.deepEqual(JSON.parse(f.storage.getItem("apex-daily:v1:a")).pendingClaims, []);
});

test("多笔正响应无标记或响应丢失，全部集中一次角色查询核对", async () => {
  const f = fixture({ time: stamp("2026-10-18T08:00:00"), inventory:0,
    groups:[[{teamId:"a",isWin:true},{teamId:"b",isWin:true}]] });
  f.info.guessMap = {2:["a","b"]}; f.info.guessClaimMap = {2:{a:false,b:false}};
  const send = f.options.send;
  f.options.send = async (cmd, params) => {
    const response = await send(cmd,params);
    if (cmd === "apex_guessclaim") {
      if (params.teamId === "b") throw new Error("请求超时");
      return {apexRoleInfo:{voteItemCnt:0}};
    }
    return response;
  };
  const result = await f.run();
  assert.equal(result.rewards, 2);
  assert.equal(commands(f,"apex_getroleinfo").length, 2);
  assert.equal(commands(f,"apex_guessclaim").length, 2);
});

test("原生Map数字赛程键的正响应标记可直接确认，不逐笔重复查询", async () => {
  const f = fixture({ time: stamp("2026-10-18T08:00:00"), inventory:0,
    groups:[[{teamId:"winner",isWin:true}]] });
  f.info.guessMap = new Map([[2,["winner"]]]);
  f.info.guessClaimMap = new Map([[2,new Map([["winner",false]])]]);
  const send = f.options.send;
  let writes = 0;
  f.options.send = async (cmd, params) => {
    if (cmd === "apex_guessclaim") {
      writes++;
      f.info.guessClaimMap.get(2).set("winner",true);
      return {apexRoleInfo:{guessClaimMap:new Map([[2,new Map([["winner",true]])]])}};
    }
    return send(cmd, params);
  };
  assert.equal((await f.run()).rewards, 1);
  assert.equal(writes, 1);
  assert.equal(commands(f,"apex_getroleinfo").length, 1);
});

test("竞猜待确认复查失败保留全部记录，重跑已领取项不重发", async () => {
  const f = fixture({ time: stamp("2026-10-18T08:00:00"), inventory:0, groups:[[{teamId:"winner",isWin:true}]] });
  f.info.guessMap = {2:["winner"]}; f.info.guessClaimMap = {2:{winner:false}};
  const send = f.options.send;
  let reads=0, failed=false;
  f.options.send = async (cmd,params) => {
    if (cmd === "apex_getroleinfo" && ++reads === 2 && !failed) {failed=true;throw new Error("核对查询失败");}
    const response = await send(cmd,params);
    return cmd === "apex_guessclaim" ? {} : response;
  };
  await assert.rejects(f.run(), /核对查询失败/);
  assert.equal(JSON.parse(f.storage.getItem("apex-daily:v1:a")).pendingClaims.length, 1);
  await f.run();
  assert.equal(commands(f,"apex_guessclaim").length, 1);
  assert.deepEqual(JSON.parse(f.storage.getItem("apex-daily:v1:a")).pendingClaims, []);
});

test("同一轮预测与领奖复用已完整分页的对阵清单", async () => {
  const f = fixture({ inventory:0, guessMap:{2:["low"]}, groups:[
    [{teamId:"low",cheerCnt:1,isWin:true},{teamId:"high",cheerCnt:4,isOut:true}],
    [{teamId:"next",cheerCnt:5},{teamId:"other",cheerCnt:1}],
  ] });
  f.info.guessClaimMap = {2:{low:false}};
  const result = await f.run();
  assert.equal(result.rewards, 1);
  assert.equal(commands(f,"apex_getguesslist").filter(item=>item.params.scheduleId===2).length, 1);
});

test("某赛程列表异常仍继续其他赛程领奖，停止信号则立即保留待确认退出", async () => {
  const f = fixture({time:stamp("2026-10-18T08:00:00"),inventory:0,groups:[[{teamId:"winner",isWin:true}]]});
  f.info.guessMap={2:["bad"],3:["winner"]}; f.info.guessClaimMap={2:{bad:false},3:{winner:false}};
  const send=f.options.send;
  f.options.send=async(cmd,params)=>{
    if(cmd==="apex_getguesslist"&&params.scheduleId===2) throw new Error("对阵查询失败");
    return send(cmd,params);
  };
  await assert.rejects(f.run(),error=>error.claimedRewards===1&&/对阵查询失败/.test(error.message));
  assert.equal(f.info.guessClaimMap[3].winner,true);

  const g=fixture({time:stamp("2026-10-18T08:00:00"),inventory:0,groups:[[{teamId:"a",isWin:true},{teamId:"b",isWin:true}]]});
  g.info.guessMap={2:["a","b"]};g.info.guessClaimMap={2:{a:false,b:false}};
  const original=g.options.send;
  g.options.send=async(cmd,params)=>{
    if(cmd==="apex_guessclaim") {g.stop();throw Object.assign(new Error("停止"),{interrupted:true});}
    return original(cmd,params);
  };
  await assert.rejects(g.run(),error=>error.interrupted===true);
  assert.deepEqual(JSON.parse(g.storage.getItem("apex-daily:v1:a")).pendingClaims,[{scheduleId:2,teamId:"a"}]);
});

test("主线未通关6000关按当前模块配置跳过，不查询APEX", async () => {
  const f = fixture();
  f.options.initialRole = { levelId: 6000 };
  f.options.config.ModuleConf = { 10149: { condition: [{ type: 1, value: 6001 }] } };
  assert.equal((await f.run()).status, "skipped");
  assert.equal(f.calls.length, 0);
  f.options.initialRole.levelId = 6001;
  assert.equal((await f.run()).status, "completed");
});

test("初次角色查询200160正常跳过；其他错误不能隐藏", async () => {
  for (const code of [200160, 200020, 200400]) {
    const f = fixture();
    f.options.send = async () => { throw new Error(`查询逐鹿盐山账号状态失败：服务器错误: ${code}`); };
    if (code === 200160) assert.equal((await f.run()).status, "skipped");
    else await assert.rejects(f.run(), new RegExp(String(code)));
  }
});
