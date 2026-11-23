import test from "node:test";
import assert from "node:assert/strict";
import {clubRewardDates,claimClubEventRewards} from "../src/utils/clubEventRewards.js";
const config={LegionScheduleConf:{1:{legionWarType:2,serverDate:"2026/10/01"},2:{legionWarType:2,serverDate:"2026/11/01"}},SeasonLegionScheduleConf:{},LegionWarConstantConf:{1:{type:2,time:3600}}};
const now=()=>Date.parse("2026-11-23T12:00:00+08:00");
function fixture(){
 const flags={},calls=[];
 const options={now,loadConfig:async()=>config,send:async(cmd,p)=>{
  calls.push({cmd,p});
  if(cmd==='role_getroleinfo')return {role:{statistics:{...flags}}};
  if(cmd==='role_getfirstmonthdate')return {firstMonthDate:'2026/10/01'};
  if(cmd==='legionwar_getmajoreventslist')return {legionRankList:[{id:1}]};
  if(cmd==='legion_claimwarrankreward'){flags['war:rank:reward:'+p.date]=1;return {};}
 }};return {options,flags,calls};
}
test("按赛事日期倒序生成已结束月份，不查询首次月赛之前或未结束日期",()=>{
 assert.deepEqual(clubRewardDates(config,'2026/10/01',now()),['2026/11/01','2026/10/01']);
 assert.deepEqual(clubRewardDates(config,'2026/11/01',Date.parse('2026-11-01T20:30:00+08:00')),[]);
 assert.deepEqual(clubRewardDates(config,'2026/11/01',Date.parse('2026-11-01T21:01:00+08:00')),['2026/11/01']);
});
test("第七期起赛季决赛替代同月旧月赛并去重",()=>{
 const c={...config,LegionScheduleConf:Object.fromEntries(Array.from({length:7},(_,i)=>[i+1,{legionWarType:2,serverDate:`2026/0${i+1}/01`}])),SeasonLegionScheduleConf:{1:{seasonLegionWarType:39,serverDate:'2026/07/15'}}};
 const dates=clubRewardDates(c,'2026/01/01',now());assert.ok(dates.includes('2026/07/15'));assert.ok(!dates.includes('2026/07/01'));
});
test("逐日期领取后查询统计确认，重复执行不再写请求",async()=>{
 const f=fixture();assert.equal((await claimClubEventRewards(f.options)).claimed,2);
 assert.deepEqual(f.calls.filter(c=>c.cmd==='legion_claimwarrankreward').map(c=>c.p.date),['2026/11/01','2026/10/01']);
 f.calls.length=0;assert.equal((await claimClubEventRewards(f.options)).claimed,0);
 assert.ok(!f.calls.some(c=>c.cmd==='legion_claimwarrankreward'));
});
test("榜单空列表及省略默认列表不领奖，非法结构停止",async()=>{
 for(const list of [[],undefined,null]){
 const f=fixture(),send=f.options.send;f.options.send=async(cmd,p)=>cmd==='legionwar_getmajoreventslist'?{legionRankList:list}:send(cmd,p);
 if(list===null)await assert.rejects(claimClubEventRewards(f.options),/结构无效/);
 else assert.equal((await claimClubEventRewards(f.options)).claimed,0);
 assert.ok(!f.calls.some(c=>c.cmd==='legion_claimwarrankreward'));
 }
});
test("写超时先查，已领统计确认后不重发，未确认停止后续日期",async()=>{
 for(const applied of [true,false]){
 const f=fixture(),send=f.options.send;let attempts=0;
 f.options.send=async(cmd,p)=>{if(cmd==='legion_claimwarrankreward'){attempts++;if(applied)await send(cmd,p);throw new Error('超时');}return send(cmd,p);};
 if(applied)assert.equal((await claimClubEventRewards(f.options)).claimed,2);
 else await assert.rejects(claimClubEventRewards(f.options),/超时/);
 assert.equal(attempts,applied?2:1);
 }
});
test("无首次月赛跳过；账号统计独立；用户停止不发请求",async()=>{
 const a=fixture(),b=fixture();a.flags['war:rank:reward:2026/11/01']=1;
 assert.deepEqual((await Promise.all([claimClubEventRewards(a.options),claimClubEventRewards(b.options)])).map(r=>r.claimed),[1,2]);
 const f=fixture();f.options.stopped=()=>true;await assert.rejects(claimClubEventRewards(f.options),e=>e.interrupted);assert.equal(f.calls.length,0);
 const g=fixture();g.options.send=async(cmd)=>cmd==='role_getroleinfo'?{role:{}}:{};assert.equal((await claimClubEventRewards(g.options)).claimed,0);
});
