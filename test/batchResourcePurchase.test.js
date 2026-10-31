import test from 'node:test';
import assert from 'node:assert/strict';
import {createTasksResourcePurchase} from '../src/utils/batch/tasksResourcePurchase.js';
function fixture(fail=false){
 const calls=[];let closed=0,released=0;
 const deps={selectedTokens:{value:['a','b']},tokens:{value:[]},tokenStatus:{value:{}},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},message:{info(){}},addLog(){},ensureConnection:async id=>calls.push(id),releaseConnectionSlot:()=>released++,tokenStore:{closeWebSocketConnection:()=>closed++,sendMessageWithPromise:async(id,cmd)=>{if(fail)throw Error('timeout');assert.equal(cmd,'role_getroleinfo');return {role:{items:{}}};}}};
 return {deps,calls,run:()=>createTasksResourcePurchase(deps).batchBuyRedFragmentsAndPetCookies(),closed:()=>closed,released:()=>released};
}
test('逐账号采购，余额不足也正常结束并释放连接，错误不重试',async()=>{
 for(const fail of [false,true]){const f=fixture(fail);await f.run();assert.deepEqual(f.calls,['a','b']);assert.equal(f.closed(),2);assert.equal(f.released(),2);assert.equal(f.deps.isRunning.value,false);assert.equal(f.deps.currentRunningTokenId.value,null);assert.equal(f.deps.tokenStatus.value.a,fail?'failed':'completed');}
});
test('停止后不启动下一账号，待执行账号标记停止',async()=>{
 const f=fixture();f.deps.tokenStore.sendMessageWithPromise=async()=>{f.deps.shouldStop.value=true;return {role:{items:{}}};};await f.run();assert.deepEqual(f.calls,['a']);assert.equal(f.deps.tokenStatus.value.b,'stopped');
});
