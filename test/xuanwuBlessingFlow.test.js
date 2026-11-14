import test from 'node:test';
import assert from 'node:assert/strict';
import {createTasksXuanwuBlessing} from '../src/utils/batch/tasksXuanwuBlessing.js';
import {getXuanwuActBase} from '../src/utils/towerActId.js';
test('整轮只领取达标任务，抽奖超时后账号标记未完成且不误报耗尽',async()=>{
 const base=getXuanwuActBase(),actId=Number(base+'1'),calls=[],logs=[],status={};
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({ActFestivalConf:{[Number(base+"2")]:{actType:35,itemId:5295}},BattlePassMissionConf:[{id:1,actId,completeValue:10},{id:2,actId,completeValue:5}],cumulativeDrawConf:[{id:68,actId:Number(base+'2'),cumulativeNum:5}]})});
 let taskClaimed=false;
 try {
 const runner=createTasksXuanwuBlessing({selectedTokens:{value:['a']},tokens:{value:[{id:'a',name:'测试'}]},tokenStatus:{value:status},isRunning:{value:false},shouldStop:{value:false},ensureConnection:async()=>{},releaseConnectionSlot:()=>{},addLog:l=>logs.push(l),message:{success:()=>{}},currentRunningTokenId:{value:null},delayConfig:{command:1},tokenStore:{sendGetRoleInfo:async()=>({role:{items:{5295:{quantity:10}}}}),closeWebSocketConnection:()=>{},sendMessageWithPromise:async(id,cmd,p)=>{
 calls.push([cmd,p]);
 if(cmd==='system_getdatabundlever')return {dataBundleVer:'flow-test'};
 if(cmd==='activity_warorderget')return {activity:{warOrderActivityInfo:{[actId]:{complete:{1:9,2:5},taskClaimed:taskClaimed?{2:true}:{}}}}};
 if(cmd==='activity_warordertaskclaim'){taskClaimed=true;return {reward:[{type:2,value:1}]};}
 if(cmd==='activity_getlotteryinfo')return {lotteryInfo:{lotteryNum:0}};
 if(cmd==='activity_lottery')throw Error('请求超时');
 return {};
 }}});
 await runner.batchXuanwuBlessing();
 assert.deepEqual(calls.filter(x=>x[0]==='activity_warordertaskclaim').map(x=>x[1].missionId),[2]);
 assert.equal(status.a,'failed');assert.ok(logs.some(x=>x.message.includes('部分完成')));
 assert.ok(!logs.some(x=>x.message.includes('灵契已抽完')));
 }finally{globalThis.fetch=original;}
});

test('整轮50额度按5次十连发送，按实际抽奖次数累计且保留剩余库存',async()=>{
 const base=getXuanwuActBase(),actId=Number(base+'1'),calls=[],logs=[],status={};
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({ActFestivalConf:{[Number(base+"2")]:{actType:35,itemId:5295}},BattlePassMissionConf:[{id:1,actId,completeValue:10},{id:2,actId,completeValue:5}],cumulativeDrawConf:[{id:68,actId:Number(base+'2'),cumulativeNum:5}]})});
 let taskClaimed=false, stock=53;
 try {
 const runner=createTasksXuanwuBlessing({selectedTokens:{value:['a']},tokens:{value:[{id:'a',name:'测试'}]},tokenStatus:{value:status},isRunning:{value:false},shouldStop:{value:false},ensureConnection:async()=>{},releaseConnectionSlot:()=>{},addLog:l=>logs.push(l),message:{success:()=>{}},currentRunningTokenId:{value:null},delayConfig:{command:1},tokenStore:{sendGetRoleInfo:async()=>({role:{items:{5295:{quantity:stock}}}}),closeWebSocketConnection:()=>{},sendMessageWithPromise:async(id,cmd,p)=>{
 calls.push([cmd,p]);
 if(cmd==='system_getdatabundlever')return {dataBundleVer:'flow-test'};
 if(cmd==='activity_warorderget')return {activity:{warOrderActivityInfo:{[actId]:{complete:{1:9,2:5},taskClaimed:taskClaimed?{2:true}:{}}}}};
 if(cmd==='activity_warordertaskclaim'){taskClaimed=true;return {reward:[{type:2,value:1}]};}
 if(cmd==='activity_getlotteryinfo')return {lotteryInfo:{lotteryNum:0}};
 if(cmd==='activity_lottery'){stock-=p.times;return {reward:[]};}
 return {};
 }}});
 await runner.batchXuanwuBlessing();
 assert.deepEqual(calls.filter(x=>x[0]==='activity_warordertaskclaim').map(x=>x[1].missionId),[2]);
 assert.deepEqual(calls.filter(x=>x[0]==='activity_lottery').map(x=>x[1].times),[10,10,10,10,10]);
 assert.equal(stock,3);assert.ok(logs.some(x=>x.message.includes('抽奖50')));
 assert.ok(!logs.some(x=>x.message.includes('灵契已抽完')));
 }finally{globalThis.fetch=original;}
});
