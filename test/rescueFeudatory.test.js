import test from 'node:test';
import assert from 'node:assert/strict';
import {rescueSelectedFeudatory} from '../src/utils/rescueFeudatory.js';
const config={ConstantConf:{lordEnergyCount:10,lordCount:[1,100,300,500,1000]}};
function fixture(options={}) {
 const owner={roleId:1,bossId:options.selfBoss||0,levelId:6000,hallEnergy:options.energy??100,feudatory:{...options.members}};
 let boss=options.boss??8,fights=0; const calls=[],released=[];
 if(boss===1)owner.feudatory[2]={goldTotal:0};
 const rows=[{roleId:2,name:'小号',members:[],actions:[]}];
 const send=async(cmd,p={})=>{
  calls.push({cmd,p});
  if(cmd==='role_getroleinfo')return {role:structuredClone(owner)};
  if(cmd==='rank_getroleinfo')return {roleInfo:{roleId:p.roleId,bossId:p.roleId===2?boss:p.roleId===1?owner.bossId:0,name:`账号${p.roleId}`}};
  if(cmd==='fight_startconquer') {fights++;owner.hallEnergy-=10;if(options.timeout)throw Error('timeout');if(!options.lose){boss=1;owner.feudatory[2]={goldTotal:0};}return {battleData:{result:{isWin:!options.lose}}};}
  if(cmd==='feudatory_exiled'){if(!options.releaseFail){delete owner.feudatory[2];boss=0;}return {};}
  throw Error(cmd);
 };
 return {rows,calls,owner,fights:()=>fights,released,run:()=>rescueSelectedFeudatory({rows,send,config,battleVersion:7,onReleased:x=>released.push(x)})};
}
test('已有咸主先征服目标本人，确认归属后释放并核验无咸主',async()=>{
 const f=fixture();await f.run();assert.equal(f.rows[0].rescueResult,'解救成功');assert.equal(f.rows[0].boss,null);
 assert.deepEqual(f.calls.find(c=>c.cmd==='fight_startconquer').p,{targetId:2,battleVersion:7});assert.equal(f.released.length,1);
 const fight=f.calls.findIndex(c=>c.cmd==='fight_startconquer'),release=f.calls.findIndex(c=>c.cmd==='feudatory_exiled');assert.ok(release>fight+2);
});
test('无咸主跳过，已属于执行账号直接释放，即便名额满或无精力',async()=>{
 const free=fixture({boss:0});await free.run();assert.equal(free.fights(),0);assert.equal(free.calls.some(c=>c.cmd==='feudatory_exiled'),false);
 const own=fixture({boss:1,energy:0,members:{3:{},4:{},5:{},6:{}}});await own.run();assert.equal(own.fights(),0);assert.equal(own.rows[0].rescueResult,'解救成功');
});
test('战败3次换目标，精力不足或名额已满不发征服也不腾位',async()=>{
 const lose=fixture({lose:true});await lose.run();assert.equal(lose.fights(),3);assert.match(lose.rows[0].rescueResult,/战败3次/);
 for(const opts of [{energy:9},{members:{3:{},4:{},5:{},6:{},7:{}}}]){const f=fixture(opts);await f.run();assert.equal(f.fights(),0);assert.equal(f.calls.some(c=>c.cmd==='feudatory_exiled'),false);}
});
test('请求超时只查询不重发；释放后有咸主不能报成功',async()=>{
 const timeout=fixture({timeout:true});await timeout.run();assert.equal(timeout.fights(),1);assert.match(timeout.rows[0].rescueResult,/timeout/);
 const failed=fixture({releaseFail:true});await failed.run();assert.match(failed.rows[0].rescueResult,/未确认/);assert.equal(failed.released.length,0);
});
test('执行账号无法自救，不触发反抗或征服自己',async()=>{
 const f=fixture({selfBoss:8});f.rows[0].roleId=1;await f.run();assert.equal(f.fights(),0);

 assert.match(f.rows[0].rescueResult,/无法征服自己/);
});
test('停止后不发送征服，未知目标状态安全停止',async()=>{
 let writes=0;const rows=[{roleId:2}];
 await rescueSelectedFeudatory({rows,config,battleVersion:1,send:async(cmd)=>{if(cmd==='role_getroleinfo')return {role:{roleId:1,bossId:0,levelId:6000,hallEnergy:100,feudatory:{}}};if(cmd==='rank_getroleinfo')return {roleInfo:{roleId:2,bossId:null}};writes++;return {};}});
 assert.equal(writes,0);assert.match(rows[0].rescueResult,/状态未确认/);
});
test('收尾复用全局执行账号、解救后才推送，未解除标记待完成',async()=>{
 const {createTasksFeudatory}=await import('../src/utils/batch/tasksFeudatory.js');
 for(const energy of [100,0]){
  let boss=8,closed=0,released=0,pushed=false;
  const owner={roleId:1,bossId:0,levelId:6000,hallEnergy:energy,feudatory:{}};
  const rows=[{tokenId:'a',roleId:2,name:'小号',reason:'完成',members:[],actions:[]}],calls=[];
  const deps={tokens:{value:[{id:'helper',roleId:1}]},tokenStatus:{value:{a:'completed'}},currentRunningTokenId:{value:null},shouldStop:{value:false},batchSettings:{feudatoryRescueTokenId:'helper',wxpusherEnabled:true,wxpusherAppToken:'test',wxpusherUids:'test'},ensureConnection:async(id,n,cb)=>{assert.equal(id,'helper');cb(true);},releaseConnectionSlot(){released++;},tokenStore:{getWebSocketStatus:()=> 'connected',getBattleVersion:()=>7,closeWebSocketConnection(){closed++;},sendMessageWithPromise:async(id,cmd,p)=>{
   calls.push(cmd);assert.equal(id,'helper');
   if(cmd==='role_getroleinfo')return {role:structuredClone(owner)};
   if(cmd==='rank_getroleinfo')return {roleInfo:{roleId:p.roleId,bossId:p.roleId===2?boss:0,name:'名字'}};
   if(cmd==='fight_startconquer'){boss=1;owner.feudatory[2]={goldTotal:0};owner.hallEnergy-=10;return {battleData:{result:{isWin:true}}};}
   if(cmd==='feudatory_exiled'){boss=0;delete owner.feudatory[2];return {};}
   throw Error(cmd);
  }},loadFeudatoryConfig:async()=>config,storage:{getItem:()=>null,setItem(){}},sleep:async()=>{},addLog(){},sendWxPusherMessage:async(c,t,html)=>{pushed=true;assert.match(html,energy?/解救成功/:/精力不足/);assert.equal(boss,energy?0:8);}};
  await createTasksFeudatory(deps).finishFeudatoryBatch(rows);
  assert.equal(pushed,true);assert.equal(closed,1);assert.equal(released,1);assert.equal(deps.tokenStatus.value.a,energy?'completed':'pending');
 }
});
test('未设置执行账号只推送原有结果，不连接或解救',async()=>{
 const {createTasksFeudatory}=await import('../src/utils/batch/tasksFeudatory.js');let pushes=0;
 await createTasksFeudatory({batchSettings:{wxpusherEnabled:true,wxpusherAppToken:'t',wxpusherUids:'u'},tokenStatus:{value:{}},shouldStop:{value:false},addLog(){},sendWxPusherMessage:async()=>pushes++}).finishFeudatoryBatch([{tokenId:'a',members:[],actions:[]}]);
 assert.equal(pushes,1);
});
test('只使用现有账号选择设置，收尾嵌入原任务不新增任务项',async()=>{
 const fs=await import('node:fs');const view=fs.readFileSync(new URL('../src/views/BatchDailyTasks.vue',import.meta.url),'utf8');
 assert.match(view,/v-model:value="batchSettings.feudatoryRescueTokenId"/);assert.match(view,/finishFeudatoryBatch\(aggregatedFeudatoryResults\)/);
});

test('完整目标详情缺省bossId采用协议默认无咸主，不触发征服',async()=>{
 const rows=[{roleId:2}];let writes=0;
 await rescueSelectedFeudatory({rows,config,battleVersion:1,send:async cmd=>{
  if(cmd==='role_getroleinfo')return {role:{roleId:1,bossId:0,levelId:6000,hallEnergy:100,feudatory:{}}};
  if(cmd==='rank_getroleinfo')return {roleInfo:{roleId:2}};
  writes++;return {};
 }});assert.equal(writes,0);assert.equal(rows[0].rescueResult,'无需解救');
});
test('遵守客户端限制，不征服执行账号自己的咸主',async()=>{
 const f=fixture({selfBoss:2});await f.run();assert.equal(f.fights(),0);assert.match(f.rows[0].rescueResult,/目标是执行账号的咸主/);
});
