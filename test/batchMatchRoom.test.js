import test from 'node:test';
import assert from 'node:assert/strict';
import { createTasksMatchRoom } from '../src/utils/batch/tasksMatchRoom.js';
test('independent task runs in an active scheduled session and releases each account', async () => {
  const status={value:{}};const running={value:true};const current={value:null};
  const calls=[];let released=0;
  const deps={selectedTokens:{value:['a','b']},tokens:{value:[]},tokenStatus:status,
    isRunning:running,shouldStop:{value:false},currentRunningTokenId:current,
    ensureConnection:async id=>calls.push(['connect',id]),releaseConnectionSlot:()=>released++,
    tokenStore:{sendMessageWithPromise:async id=>{calls.push(['send',id]);return {roomId:''};},
      closeWebSocketConnection:id=>calls.push(['close',id])},addLog(){},message:{success(){}}};
  await createTasksMatchRoom(deps).batchMatchRoom();
  assert.deepEqual(status.value,{a:'completed',b:'completed'});
  assert.equal(released,2);assert.equal(current.value,null);assert.equal(running.value,false);
  assert.deepEqual(calls,[['connect','a'],['send','a'],['close','a'],['connect','b'],['send','b'],['close','b']]);
});
test('failed connection marks account failed without releasing an unowned slot', async () => {
  let released=0;const status={value:{}};
  await createTasksMatchRoom({selectedTokens:{value:['a']},tokens:{value:[]},tokenStatus:status,
    isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},
    ensureConnection:async()=>{throw new Error('connection failed');},releaseConnectionSlot:()=>released++,
    tokenStore:{},addLog(){},message:{success(){}}}).batchMatchRoom();
  assert.equal(status.value.a,'failed');assert.equal(released,0);
});
