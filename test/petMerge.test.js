import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPetMergePair, runPetMerge } from '../src/utils/petMerge.js';
import { createConfirmedPetMergeTask } from '../src/utils/batch/confirmedPetMergeTask.js';
const pet = (uId,petId=101,level=1) => ({uId,petId,level,isLocked:false});
const role = () => ({pet:{petUId:'equipped'},petData:{pets:{1:pet('a'),2:pet('b',102)}}});
test('同品质不同种宠物可合成，低品质inheritSlot为0',()=>{
 assert.deepEqual(selectPetMergePair(role()),{fromSlotUId:{slot:2,uId:'b'},toSlotUId:{slot:1,uId:'a'},inheritSlot:0});
});
test('跳过佩戴、锁定、未知状态、无效槽位、重复编号、未知品质及金色',()=>{
 for(const change of [p=>p.uId='equipped',p=>p.isLocked=true,p=>delete p.isLocked,p=>p.petId=701,p=>p.petId=999,p=>p.uId='a']){
 const r=role();change(r.petData.pets[2]);assert.equal(selectPetMergePair(r,6),null);
 }
 const r=role();r.petData.pets[-1]=r.petData.pets[2];delete r.petData.pets[2];assert.equal(selectPetMergePair(r),null);
});
test('默认不合成橙红，紫色继承等级较高者，红色需显式开启',()=>{
 const r=role();r.petData.pets={1:pet('a',401,10),2:pet('b',402,20)};assert.equal(selectPetMergePair(r).inheritSlot,2);
 r.petData.pets={1:pet('a',601),2:pet('b',602)};assert.equal(selectPetMergePair(r),null);assert.equal(selectPetMergePair(r,6).inheritSlot,1);
});
test('成功和合成失败均刷新完整列表；剩余无配对时结束',async()=>{
 for(const isSuccess of [true,false]){
 let r=role(),calls=0;
 const result=await runPetMerge({getRole:async()=>r,send:async()=>{calls++;r={...r,petData:{pets:{2:pet('new',201)}}};return {isSuccess};}});
 assert.equal(calls,1);assert.equal(result.count,1);
 }
});
test('未知响应、状态未变化、超时均停止且不重试',async()=>{
 for(const kind of ['response','unchanged','timeout']){
 let calls=0;await assert.rejects(runPetMerge({getRole:async()=>role(),send:async()=>{calls++;if(kind==='timeout')throw Error('timeout');return kind==='response'?{}:{isSuccess:false};}}));assert.equal(calls,1);
 }
});
test('停止不发请求；请求期间停止仍核对结果且不再合成',async()=>{
 let stop=true,r=role(),calls=0;
 const send=async()=>{calls++;stop=true;r={petData:{pets:{}}};return {isSuccess:true};};
 await runPetMerge({getRole:async()=>r,send,shouldStop:()=>stop});assert.equal(calls,0);
 stop=false;await runPetMerge({getRole:async()=>r,send,shouldStop:()=>stop});assert.equal(calls,1);
});
test('确认取消不连接不消耗；确认期间重复点击只提示一次',async()=>{
 let resolve, confirmations=0,connected=0;
 const deps={selectedTokens:{value:['a']},tokens:{value:[]},message:{warning(){}},batchSettings:{petMergeMaxColor:4},ensureConnection:async()=>{connected++;}};
 const tasks=createConfirmedPetMergeTask(deps,{confirm:()=>{confirmations++;return new Promise(r=>resolve=r);}});
 const a=tasks.batchMergePets(),b=tasks.batchMergePets();assert.equal(a,b);resolve(false);await a;assert.equal(confirmations,1);assert.equal(connected,0);
});

test('超过8个蛋时多轮开蛋合成，库存耗尽仍合成剩余配对',async()=>{
 let r={petData:{unlockedSlot:8,pets:{}},items:{37011:{quantity:20},37012:{quantity:2},37013:{quantity:1}}},serial=0,merges=0,peak=0;
 const result=await runPetMerge({getRole:async()=>structuredClone(r),openEgg:async({itemId})=>{
  const slot=Array.from({length:8},(_,i)=>i+1).find(s=>!r.petData.pets[s]);assert.ok(slot);
  r.items[itemId].quantity--;r.petData.pets[slot]=pet(`egg-${++serial}`,101);peak=Math.max(peak,Object.keys(r.petData.pets).length);
 },send:async p=>{merges++;delete r.petData.pets[p.fromSlotUId.slot];r.petData.pets[p.toSlotUId.slot]=pet(`merged-${merges}`,201);return {isSuccess:true};}});
 assert.equal(result.eggsOpened,23);assert.ok(merges>8);assert.equal(peak,8);assert.equal(result.blockedByCapacity,false);
});
test('满槽无合法配对时保留剩余蛋，不开蛋、不解锁槽位',async()=>{
 const r={petData:{pets:Object.fromEntries(Array.from({length:8},(_,i)=>[i+1,{...pet(`p${i}`,701),isLocked:true}]))},items:{37011:{quantity:10}}};
 const result=await runPetMerge({getRole:async()=>r,send:async()=>assert.fail(),openEgg:async()=>assert.fail()});
 assert.equal(result.eggsOpened,0);assert.equal(result.blockedByCapacity,true);
});
test('使用已经开放的额外槽位；不使用非白绿蓝宠物蛋',async()=>{
 const r={petData:{unlockedSlot:9,pets:Object.fromEntries(Array.from({length:8},(_,i)=>[i+1,{...pet(`p${i}`,701),isLocked:true}]))},items:{37013:{quantity:1},99999:{quantity:5}}};let opened=0;
 const result=await runPetMerge({getRole:async()=>structuredClone(r),send:async()=>assert.fail(),openEgg:async p=>{assert.equal(p.itemId,37013);opened++;r.items[37013].quantity=0;r.petData.pets[9]={...pet('new',701),isLocked:true};}});
 assert.equal(opened,1);assert.equal(result.eggsOpened,1);assert.equal(r.items[99999].quantity,5);
});
test('开蛋状态未变化和超时停止，不重试',async()=>{
 for(const fail of [false,true]){
 const r={...role(),items:{37011:{quantity:1}}};let opened=0;
 await assert.rejects(runPetMerge({getRole:async()=>r,send:async()=>assert.fail(),openEgg:async()=>{opened++;if(fail)throw Error('timeout');}}));assert.equal(opened,1);
 }
});

test('确认后批量入口固定账号和品质，调用合成协议并释放连接',async()=>{
 let approve, r=role(),released=0;const calls=[];
 const deps={selectedTokens:{value:['a']},tokens:{value:[]},batchSettings:{petMergeMaxColor:4},tokenStatus:{value:{}},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},delayConfig:{command:0},message:{warning(){},info(){}},addLog(){},ensureConnection:async id=>calls.push(['connect',id]),releaseConnectionSlot:()=>released++,tokenStore:{sendGetRoleInfo:async()=>({role:structuredClone(r)}),closeWebSocketConnection:id=>calls.push(['close',id]),sendMessageWithPromise:async(id,cmd,p)=>{calls.push([id,cmd,p]);r={petData:{pets:{2:pet('new',201)}}};return {isSuccess:true};}}};
 const task=createConfirmedPetMergeTask(deps,{confirm:()=>new Promise(resolve=>approve=resolve)});
 const pending=task.batchMergePets();deps.selectedTokens.value=['b'];deps.batchSettings.petMergeMaxColor=6;approve(true);await pending;
 assert.equal(calls[0][1],'a');assert.equal(calls[1][1],'pet_merge');assert.equal(calls.at(-1)[1],'a');assert.equal(released,1);assert.equal(deps.tokenStatus.value.a,'completed');assert.equal(deps.isRunning.value,false);
});
