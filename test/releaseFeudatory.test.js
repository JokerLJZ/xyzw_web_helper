import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { releaseAllFeudatory } from '../src/utils/autoFeudatory.js';
function fixture({ empty=false, fail=false, timeoutSuccess=false, stopAfterFirst=false, wrongRole=false }={}) {
  let stop=false, writes=0, reads=0;const updates=[],calls=[];
  const role={roleId:1,bossId:99,feudatory:empty?{}:{2:{goldTotal:100},3:{goldTotal:0}}};
  const send=async(cmd,p)=>{
    calls.push({cmd,p});
    if(cmd==='role_getroleinfo'){reads++;return {role:{...structuredClone(role),roleId:wrongRole&&reads>1?8:1}};}
    assert.equal(cmd,'feudatory_exiled');writes++;
    if(!fail)delete role.feudatory[p.targetId];
    if(stopAfterFirst)stop=true;
    if(fail||timeoutSuccess)throw Error('timeout');
    return {};
  };
  return {role,calls,updates,writes:()=>writes,run:()=>releaseAllFeudatory({send,shouldStop:()=>stop,onReleased:x=>updates.push(x)})};
}
test('释放全部当前咸臣，不受金币或48小时影响，逐个确认且不触碰咸主',async()=>{
  const f=fixture();const r=await f.run();assert.equal(r.count,2);assert.equal(f.role.bossId,99);
  assert.deepEqual(f.calls.filter(c=>c.cmd==='feudatory_exiled').map(c=>c.p),[{targetId:2,result:true},{targetId:3,result:true}]);
  assert.equal(f.updates.length,2);
});
test('空名单不发送释放请求',async()=>{const f=fixture({empty:true});assert.equal((await f.run()).count,0);assert.equal(f.writes(),0);});
test('失败或超时不重发，先查结果再停止，正确记录超时已生效的释放',async()=>{
  for(const timeoutSuccess of [false,true]){
    const f=fixture({fail:!timeoutSuccess,timeoutSuccess});await assert.rejects(f.run(),/timeout/);
    assert.equal(f.writes(),1);assert.equal(f.updates.length,timeoutSuccess?1:0);
    assert.equal(f.calls.at(-1).cmd,'role_getroleinfo');
  }
});
test('释放期间停止仍确认已发请求，停止后不释放下一个',async()=>{
  const f=fixture({stopAfterFirst:true});assert.deepEqual(await f.run(),{count:1,stopped:true});assert.equal(f.writes(),1);
});
test('角色变化、畸形名单和ID阻止释放',async()=>{
  const f=fixture({wrongRole:true});await assert.rejects(f.run(),/角色已变化/);assert.equal(f.writes(),0);
  for(const feudatory of [null,[],{'bad':{}},{1:{}}]){
    let writes=0;
    await assert.rejects(releaseAllFeudatory({send:async cmd=>{if(cmd!=='role_getroleinfo')writes++;return {role:{roleId:1,bossId:0,feudatory}};}}));
    assert.equal(writes,0);
  }
});
test('小号及定时入口注册，禁止释放任务自动补跑',()=>{
  const view=fs.readFileSync(new URL('../src/views/BatchDailyTasks.vue',import.meta.url),'utf8');
  assert.match(view,/@click="batchReleaseFeudatory"/);
  assert.match(view,/    batchReleaseFeudatory,/);
  assert.match(view,/"batchAutoFeudatory", "batchReleaseFeudatory"\]\.includes\(name\)/);
});
test('批量入口清理对应观察记录并释放自建连接，保留其他记录',async()=>{
  const {createTasksFeudatory}=await import('../src/utils/batch/tasksFeudatory.js');
  const f=fixture(),storage=new Map([['xyzw-feudatory-history-v1:1',JSON.stringify({2:{capturedAt:1},3:{observedAt:2},7:{observedAt:3}})]]);
  let closed=0,released=0;const status={};
  const deps={selectedTokens:{value:['a']},tokens:{value:[]},tokenStatus:{value:status},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},batchSettings:{},ensureConnection:async(id,n,cb,options)=>{assert.equal(options.readOnly,true);cb(true);},releaseConnectionSlot(){released++;},tokenStore:{getWebSocketStatus:()=> 'connected',sendMessageWithPromise:(id,cmd,p)=>f.calls.push({cmd,p})&&null,closeWebSocketConnection(){closed++;}},storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sleep:async()=>{},addLog(){},message:{}};
  const role={roleId:1,bossId:0,feudatory:{2:{goldTotal:1},3:{goldTotal:0}}};
  deps.tokenStore.sendMessageWithPromise=async(id,cmd,p)=>{if(cmd==='feudatory_exiled'){delete role.feudatory[p.targetId];return {};}return {role:structuredClone(role)};};
  await createTasksFeudatory(deps).batchReleaseFeudatory();
  assert.equal(status.a,'completed');assert.equal(closed,1);assert.equal(released,1);
  assert.deepEqual(JSON.parse(storage.get('xyzw-feudatory-history-v1:1')),{7:{observedAt:3}});
  assert.equal(deps.isRunning.value,false);
});
