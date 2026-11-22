import test from 'node:test';import assert from 'node:assert/strict';
import {eligibleStudySkins,unlockStudySkins,deleteLordReports} from '../src/utils/altAccountUtilities.js';
const config={StudyClothesConf:[{id:10000,open:1,studyClothesType:0},{id:10150,open:1,studyClothesType:0},{id:10250,open:1,studyClothesType:1,totRightNum:10},{id:10950,open:1,studyClothesType:2,totRightNum:30},{id:13000,open:1,studyClothesType:3,studyActId:2,totRightNum:5}]};
const role=()=>({custom:{quizSkin:2},study:{totRightNum:20,totCplTaskNum:30,actTotCplTaskMap:{2:5},unlockedSkin:{10250:true}}});
test('皮肤按正确数、任务数、活动数和已解锁状态判断，基础皮肤不请求',()=>{
 assert.deepEqual(eligibleStudySkins(config,role()).map(x=>x.id),[10150,10950,13000]);
 assert.throws(()=>eligibleStudySkins(config,{}),/缺失/);
});
test('逐个解锁后查询确认，不切换皮肤，超时后确认成功不重发',async()=>{
 const r=role(),writes=[];
 const send=async(cmd,p)=>{
  if(cmd==='role_getroleinfo')return {role:structuredClone(r)};
  writes.push([cmd,p]);
  if(cmd==='system_custom')r.custom.quizSkin=p.value;else r.study.unlockedSkin[p.id]=true;
  if(p.id===10950)throw Error('timeout');return {};
 };
 assert.equal((await unlockStudySkins({send,config})).unlocked,3);
 assert.equal(writes.length,3);assert.ok(!writes.some(x=>x[0]==='study_setskin'));
 assert.equal((await unlockStudySkins({send,config})).unlocked,0);
});
test('解锁失败且查询未确认时停止，不请求后续皮肤',async()=>{
 const calls=[];
 await assert.rejects(unlockStudySkins({config,send:async(cmd,p)=>{calls.push(cmd);if(cmd==='role_getroleinfo')return {role:role()};throw Error('server');}}),/server/);
 assert.equal(calls.filter(x=>x!=='role_getroleinfo').length,1);
});
test('仅查询并删除咸主分类，保护未领附件并查询确认',async()=>{
 let list=[{id:1,category:1,state:1},{id:2,category:1,state:2,attachments:[{id:1}]}];const calls=[];
 const send=async(cmd,p)=>{calls.push([cmd,p]);if(cmd==='mail_getbattlefieldreportlist'){assert.equal(p.category,1);return {list:structuredClone(list)};}assert.equal(p.state,9);list=list.filter(x=>x.id!==p.mailId);return {mail:{id:p.mailId,state:9}};};
 assert.deepEqual(await deleteLordReports({send}),{deleted:1,protectedCount:1});
 assert.deepEqual(calls.filter(x=>x[0]==='mail_changestate').map(x=>x[1].mailId),[1]);
});
test('列表返回错误分类或删除后仍存在不误报成功',async()=>{
 await assert.rejects(deleteLordReports({send:async()=>({list:[{id:1,category:2}]})}),/分类/);
 await assert.rejects(deleteLordReports({send:async(cmd)=>cmd==='mail_changestate'?{}:{list:[{id:1,category:1,state:1}]}}),/未确认/);
});

test('批量逐账号隔离错误，释放自建连接并保留已有连接',async()=>{
 const {createTasksAltUtilities}=await import('../src/utils/batch/tasksAltUtilities.js');
 const calls=[],closed=[],status={};let released=0;
 const deps={selectedTokens:{value:['a','b']},tokens:{value:[]},tokenStatus:{value:status},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},ensureConnection:async()=>{},releaseConnectionSlot:()=>released++,wait:async()=>{},addLog:()=>{},message:{info:()=>{}},tokenStore:{getWebSocketStatus:id=>id==='a'?'disconnected':'connected',closeWebSocketConnection:id=>closed.push(id),sendMessageWithPromise:async(id,cmd)=>{calls.push([id,cmd]);if(id==='a')throw Error('查询失败');return {list:[]};}}};
 await createTasksAltUtilities(deps).batchDeleteLordReports();
 assert.deepEqual(status,{a:'failed',b:'completed'});assert.deepEqual(closed,['a']);assert.equal(released,1);
 assert.equal(deps.isRunning.value,false);assert.equal(deps.currentRunningTokenId.value,null);
});

test('BON省略空列表时空战报正常结束，删除最后一封后空响应可确认',async()=>{
 for(const response of [{},{left:0},{_originalCmd:'mail_getbattlefieldreportlist'},{body:{}},{_raw:{body:{}}}]) {
  assert.deepEqual(await deleteLordReports({send:async()=>response}),{deleted:0,protectedCount:0});
 }
 let deleted=false;
 const result=await deleteLordReports({send:async(cmd)=>{
  if(cmd==='mail_changestate'){deleted=true;return {};}
  return deleted?{}:{list:[{id:12,category:1,state:1}]};
 }});
 assert.equal(result.deleted,1);
});

test('缺失列表仅接受协议默认空结构，错误或未知响应不能当作清空成功',async()=>{
 for(const response of [undefined,null,{list:null},{list:{}},{left:-1},{left:2},{role:{}},{code:200020},{_originalCmd:'role_getroleinfo'}])
  await assert.rejects(deleteLordReports({send:async()=>response}));
});
