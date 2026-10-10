import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GACHA_REWARD_STAGES, getClaimableGachaStages, gachaBody } from '../src/utils/gachaRewards.js';
import { createPetTasks } from '../src/utils/batch/tasksPet.js';

test('官方配置包含10个阶段，分别要求10至100次，按门槛跳过未达标和已领',()=>{
 assert.deepEqual(GACHA_REWARD_STAGES.map(s=>s.num),[10,20,30,40,50,60,70,80,90,100]);
 for(const count of [0,9,10,29,30,49,50,99,100,105]){
  assert.deepEqual(getClaimableGachaStages({stageGachaCnt:count,claimedStageIdMap:{2:true}}).map(s=>s.id),GACHA_REWARD_STAGES.filter(s=>count>=s.num&&s.id!==2).map(s=>s.id));
 }
});
test('缺少次数或领取状态时不猜测资格',()=>{
 for(const state of [undefined,{}, {stageGachaCnt:50},{stageGachaCnt:-1,claimedStageIdMap:{}},{stageGachaCnt:'50',claimedStageIdMap:{}}])assert.throws(()=>getClaimableGachaStages(state));
});
test('实际阶段4抓包只有增量领取标记，可正确解析并保留之前状态',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/gacha-claim-stage4.json',import.meta.url)));
 const response=gachaBody({_raw:{body:fixture.response}});
 assert.deepEqual(response.roleGacha.claimedStageIdMap,{'4':true});
 assert.ok(response.reward.some(r=>r.itemId===37013));
 const state={stageGachaCnt:40,claimedStageIdMap:{1:true,2:true,...response.roleGacha.claimedStageIdMap}};
 assert.deepEqual(getClaimableGachaStages(state).map(s=>s.id),[3]);
});
function deps(info,claim){
 const calls=[];let released=0;
 const d={selectedTokens:{value:['a']},tokens:{value:[]},tokenStatus:{value:{}},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},ensureConnection:async()=>{},releaseConnectionSlot:()=>released++,addLog(){},message:{info(){}},tokenStore:{closeWebSocketConnection(){},sendMessageWithPromise:async(id,cmd,p)=>{calls.push({cmd,p});return cmd==='gacha_getinfo'?info:claim(p,d);}}};
 return {d,calls,run:()=>createPetTasks(d).batchClaimGachaRewards(),released:()=>released};
}
test('没有可领取奖励只查询一次，不抽奖',async()=>{
 const f=deps({roleGacha:{stageGachaCnt:9,claimedStageIdMap:{}}},()=>assert.fail());await f.run();assert.equal(f.calls.length,1);assert.equal(f.d.tokenStatus.value.a,'completed');assert.equal(f.released(),1);
});
test('新增阶段5及以上可领取；手动停止后不领取下一阶段',async()=>{
 const f=deps({_raw:{body:{roleGacha:{stageGachaCnt:100,claimedStageIdMap:{1:true,2:true,3:true,4:true}}}}},(p,d)=>{d.shouldStop.value=true;return {roleGacha:{claimedStageIdMap:{[p.stageId]:true}}};});
 await f.run();assert.equal(f.calls.length,2);assert.equal(f.calls[1].p.stageId,5);assert.equal(f.d.tokenStatus.value.a,'stopped');
});
test('请求失败不重复领取该阶段，未确认成功标记为失败',async()=>{
 const f=deps({roleGacha:{stageGachaCnt:10,claimedStageIdMap:{}}},()=>{throw Error('timeout');});await f.run();assert.equal(f.calls.length,2);assert.equal(f.d.tokenStatus.value.a,'failed');
});
