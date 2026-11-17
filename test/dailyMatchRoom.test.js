import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRoomAction, runDailyMatchRoom } from '../src/utils/dailyMatchRoom.js';
const info = { roomId: '123', type: 0, firstMatchTime: 10 };
const role = value => ({ statistics: { 'pk:appoint:room:id': value } });
test('official match phase and signed booking status', () => {
  assert.equal(matchRoomAction(info, {}, role(0), 9000).command, 'pkroom_appoint');
  assert.equal(matchRoomAction(info, {}, role(123), 9000).command, undefined);
  assert.equal(matchRoomAction(info, {state:1}, role(123), 11000).command, 'pkroom_appointreward');
  for (const value of [0, -123, 122]) assert.equal(matchRoomAction(info, {state:1}, role(value), 11000).command, undefined);
  assert.equal(matchRoomAction(info, {state:5}, role(123), 11000).command, undefined);
  assert.equal(matchRoomAction({...info,type:1}, {}, role(0), 0).command, undefined);
  assert.throws(() => matchRoomAction(info, {}, role(123), 11000));
});
test('account state confirms timeout without retry and repeat execution skips', async () => {
  let booked = 0, writes = 0;
  const send = async cmd => {
    if (cmd === 'pkroom_getfightroominfo') return info;
    if (cmd === 'pkroom_getfightroomdetail') return {roomInfo:{state:0}};
    if (cmd === 'role_getroleinfo') return {role:role(booked)};
    writes++; booked = 123; throw new Error('timeout');
  };
  assert.equal((await runDailyMatchRoom({send,now:()=>9000})).status,'success');
  assert.equal((await runDailyMatchRoom({send,now:()=>9000})).status,'skipped');
  assert.equal(writes,1);
});
test('unconfirmed write fails once, other account does not inherit booking', async () => {
  let writes=0;
  const send=async cmd => {
    if(cmd==='pkroom_getfightroominfo')return info;
    if(cmd==='pkroom_getfightroomdetail')return {roomInfo:{state:1}};
    if(cmd==='role_getroleinfo')return {role:role(0)};
    writes++; throw new Error('timeout');
  };
  await assert.rejects(runDailyMatchRoom({send,now:()=>9000}),/timeout/);
  assert.equal(writes,1);
  assert.equal((await runDailyMatchRoom({send,now:()=>11000})).status,'skipped');
});
test('reward requires server-confirmed negative booking statistic', async () => {
  let booked=123, writes=0;
  const send=async (cmd,params) => {
    if(cmd==='pkroom_getfightroominfo') return info;
    if(cmd==='pkroom_getfightroomdetail') {assert.deepEqual(params,{roomId:'123'});return {roomInfo:{state:1}};}
    if(cmd==='role_getroleinfo')return {role:role(booked)};
    assert.equal(cmd,'pkroom_appointreward');assert.deepEqual(params,{});
    writes++;booked=-123;return {role:role(booked),reward:[]};
  };
  assert.equal((await runDailyMatchRoom({send,now:()=>11000})).status,'success');
  assert.equal((await runDailyMatchRoom({send,now:()=>11000})).status,'skipped');
  assert.equal(writes,1);
});
