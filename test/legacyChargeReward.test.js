import test from 'node:test';
import assert from 'node:assert/strict';
import {claimLegacyChargeReward,legacyChargeEligibility} from '../src/utils/legacyChargeReward.js';
const now=150000;
const config={LegacyScheduleConf:{1:{id:1,legacyStart:100,legacyWhiteListStart:80,legacyEnd:200}},LegacyChargeReward:{2:{id:2,vipSpend:3000}}};
const role=()=>({statistics:{'legacy:charge':3000},statisticsTime:{'legacy:charge':120}});
function fixture({claimed=false,amount=3000,fail=false,confirmed=true}={}) {
  let queries=0;const calls=[];
  const send=async(cmd,p)=>{
    calls.push([cmd,p]);
    if(cmd==='role_getroleinfo')return {role:{...role(),statistics:{'legacy:charge':amount}}};
    if(cmd==='legacy_getinfo')return {roleLegacy:{scheduleId:1,chargeClaimedMap:{2:++queries===1?claimed:confirmed}}};
    if(cmd==='legacy_claimchargereward'){if(fail)throw Error('服务器错误: 200020');return {reward:[]};}
    throw Error(cmd);
  };
  return {calls,run:()=>claimLegacyChargeReward({send,loadConfig:async()=>config,serverTime:()=>now})};
}
test('已领取及充值不足只查询不发送领取，账号状态隔离',async()=>{
  for(const options of [{claimed:true},{amount:2999}]) {
    const f=fixture(options);assert.equal((await f.run()).status,'skipped');
    assert.deepEqual(f.calls.map(x=>x[0]),['legacy_getinfo','role_getroleinfo']);
  }
  const f=fixture();assert.equal((await f.run()).status,'completed');
  assert.equal(f.calls.filter(x=>x[0]==='legacy_claimchargereward').length,1);
  assert.deepEqual(f.calls[2][1],{id:2});
});
test('200020或超时只查询确认，不盲目重试或推断已领取',async()=>{
  const f=fixture({fail:true});assert.equal((await f.run()).confirmedAfterError,true);
  const g=fixture({fail:true,confirmed:false});await assert.rejects(g.run(),/200020/);
  assert.equal(g.calls.filter(x=>x[0]==='legacy_claimchargereward').length,1);
  await assert.rejects(fixture({confirmed:false}).run(),/记录未确认/);
});
test('赛季时间、白名单与本季统计边界跟随客户端，陈旧充值不能领取',()=>{
  const legacy={scheduleId:1,chargeClaimedMap:new Map([[2,false]])};
  assert.equal(legacyChargeEligibility(config,role(),legacy,now).canClaim,true);
  for(const time of [100000,200000])assert.equal(legacyChargeEligibility(config,role(),legacy,time).canClaim,false);
  const old=role();old.statisticsTime['legacy:charge']=99;
  assert.equal(legacyChargeEligibility(config,old,legacy,now).canClaim,false);
  old.isWhiteRole=true;assert.equal(legacyChargeEligibility(config,old,legacy,now).canClaim,true);
  assert.equal(legacyChargeEligibility(config,role(),{...legacy,scheduleId:0},now).canClaim,false);
  assert.throws(()=>legacyChargeEligibility(config,{},legacy,now),/统计不完整/);
  assert.throws(()=>legacyChargeEligibility(config,role(),legacy,NaN),/服务器时间/);
  assert.throws(()=>legacyChargeEligibility(config,role(),{...legacy,chargeClaimedMap:{2:'true'}},now),/格式/);
});

test('批量入口统计跳过并释放连接，保持定时传入账号范围',async()=>{
  const {createTasksLegacy}=await import('../src/utils/batch/tasksLegacy.js');
  const calls=[],logs=[],closed=[];let released=0;
  const deps={selectedTokens:{value:['other']},tokens:{value:[{id:'a',name:'A'}]},tokenStatus:{value:{}},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},connectionQueue:{active:0},batchSettings:{maxActive:3},ensureConnection:async()=>{},releaseConnectionSlot:()=>released++,addLog:log=>logs.push(log),message:{success:()=>{}},tokenStore:{
    sendMessageWithPromise:async(id,cmd)=>{calls.push([id,cmd]);return cmd==='legacy_getinfo'?{roleLegacy:{scheduleId:1,chargeClaimedMap:{2:true}}}:{role:role()};},
    getWebSocketClient:()=>({getServerTime:()=>now}),closeWebSocketConnection:id=>closed.push(id),
  }};
  await createTasksLegacy(deps,{loadConfig:async()=>config}).batchLegacyClaimChargeReward({tokenIds:['a']});
  assert.ok(calls.every(([id])=>id==='a'));
  assert.ok(!calls.some(([,cmd])=>cmd==='legacy_claimchargereward'));
  assert.equal(released,1);assert.deepEqual(closed,['a']);
  assert.ok(logs.some(log=>log.message.includes('跳过 1 个')));
});
