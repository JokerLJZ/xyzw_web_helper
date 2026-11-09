import test from 'node:test';
import assert from 'node:assert/strict';
import { runAutoFeudatory, feudatoryReport } from '../src/utils/autoFeudatory.js';
import { createTasksFeudatory } from '../src/utils/batch/tasksFeudatory.js';
const time = Date.parse('2026-11-09T12:00:00+08:00');
function scenario(options = {}) {
  const role = { roleId: 1, bossId: 0, power: 1000, levelId: 6000, hallEnergy: 100, feudatory: {}, ...options.role };
  const history = options.history || {};
  const calls = []; let fights = 0;
  const target = id => ({ roleId: id, bossId: 0, power: 500, levelId: 5501, name: `目标${id}`, ...options.targets?.[id] });
  const send = async (cmd, p) => {
    calls.push({cmd,p});
    if(cmd==='role_getroleinfo') return {role:structuredClone(role)};
    if(cmd==='hall_getinfo' || cmd==='arena_startarea') return {};
    if(cmd==='arena_getarearank') return {list:(options.arena || [2,3,4,5,6]).map(roleId=>({roleId}))};
    if(cmd==='friend_list')return {friendList:options.friends || []};
    if(cmd==='rank_getroleinfo')return {roleInfo:target(p.roleId)};
    if(cmd==='feudatory_exiled') {delete role.feudatory[p.targetId];return {};}
    if(cmd==='fight_startconquer') {
      fights++; role.hallEnergy-=10;
      if(options.timeout)throw new Error('timeout');
      const win=!(options.lose || []).includes(p.targetId);
      if(win)role.feudatory[p.targetId]={goldTotal:0};
      return {battleData:{result:{isWin:win}}};
    }
    throw new Error(cmd);
  };
  const run = () => runAutoFeudatory({send,config:{ConstantConf:{lordEnergyCount:10,lordCount:[1,100,300,500,1000]}},battleVersion:240522,history,excludedRoleIds:options.excludedRoleIds || [],saveHistory(){},now:()=>time,shouldStop:options.shouldStop});
  return {run,role,history,calls,fights:()=>fights};
}
test('竞技场先抓满5人，准确传参并持久化抓取时间，不读取好友',async()=>{
  const f=scenario(),r=await f.run();
  assert.equal(r.reason,'名额已满'); assert.equal(f.fights(),5);
  assert.equal(f.calls.some(c=>c.cmd==='friend_list'),false);
  assert.deepEqual(f.calls.find(c=>c.cmd==='fight_startconquer').p,{targetId:2,battleVersion:240522});
  assert.equal(f.history[2].capturedAt,time);
});
test('无咸主、严格低战力、5500关以上筛选，重复目标不再挑战',async()=>{
  const f=scenario({arena:[2,2,3,4,5],targets:{2:{bossId:8},3:{power:1000},4:{levelId:5500},5:{bossId:null}}});
  const r=await f.run(); assert.equal(f.fights(),0); assert.equal(r.reason,'候选已耗尽');
});
test('同目标三次实际战败后换人，竞技场用尽才回退24小时登录好友',async()=>{
  const f=scenario({arena:[2],lose:[2],friends:[{roleId:3,lastLogin:time/1000-86400},{roleId:4,lastLogin:time/1000-86401},{roleId:5,lastOnline:time/1000}]});
  const r=await f.run(); assert.equal(r.members.length,1);
  assert.deepEqual(f.calls.filter(c=>c.cmd==='fight_startconquer').map(c=>c.p.targetId),[2,2,2,3]);
});
test('不足单次精力不寻找目标，不购买；失败次数受精力限制',async()=>{
  const zero=scenario({role:{hallEnergy:9}});assert.equal((await zero.run()).reason,'精力不足');assert.equal(zero.fights(),0);
  const f=scenario({role:{hallEnergy:20},lose:[2]}); assert.equal((await f.run()).reason,'精力不足');assert.equal(f.fights(),2);
});
test('超时先刷新关系并停止，不将超时视为战败重发',async()=>{
  const f=scenario({timeout:true}); const r=await f.run();assert.equal(f.fights(),1);assert.match(r.error,/timeout/);
  const i=f.calls.findIndex(c=>c.cmd==='fight_startconquer');assert.equal(f.calls[i+1].cmd,'role_getroleinfo');
});
test('历史咸臣观察满48小时零贡献才释放，贡献非零、时间未知首次观察保留',async()=>{
  const f=scenario({role:{hallEnergy:0,feudatory:{2:{goldTotal:0},3:{goldTotal:1},4:{goldTotal:0},5:{goldTotal:0}}},history:{2:{observedAt:time-48*3600000},3:{capturedAt:time-60*3600000},5:{capturedAt:time-48*3600000+1}}});
  await f.run();assert.deepEqual(f.calls.filter(c=>c.cmd==='feudatory_exiled').map(c=>c.p),[{targetId:2,result:true}]);
  assert.equal(f.history[4].observedAt,time);assert.equal(f.history[2],undefined);
});
test('账号开放名额不足5时遵守门槛，不越过配置名额',async()=>{
  const f=scenario({role:{levelId:300}});const r=await f.run();assert.equal(r.members.length,2);assert.equal(f.fights(),2);
});
test('用户停止或成员状态缺失不发送消耗请求',async()=>{
  const f=scenario({shouldStop:()=>true});assert.equal((await f.run()).reason,'已停止');assert.equal(f.fights(),0);
  const bad=scenario({role:{feudatory:null}});assert.match((await bad.run()).error,/名单/);assert.equal(bad.fights(),0);
});
test('总表包含批次累计合计、咸主，不将未知金币算0并转义名称',()=>{
  const report=feudatoryReport([{name:'<x>',reason:'名额已满',members:[{id:2,name:'a|b',gold:50,observedAt:time},{id:3,gold:70,capturedAt:time}],boss:{id:8,name:'boss'},actions:[]}]);
  assert.match(report,/120金币/);assert.match(report,/boss/);assert.match(report,/&lt;x&gt;/);assert.equal(report.includes('观察开始'),false);assert.equal(report.includes('抓取时间'),false);
  assert.match(feudatoryReport([{members:[{id:2}],actions:[]}]),/未知金币/);
});
test('批量任务按角色隔离保存、正常释放连接，推送失败不重跑',async()=>{
  const f=scenario({role:{hallEnergy:0}}),saved=new Map(),logs=[];let closed=0,released=0,pushes=0;
  const deps={selectedTokens:{value:['a']},tokens:{value:[{id:'a',name:'账号',roleId:1}]},tokenStatus:{value:{}},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},batchSettings:{wxpusherEnabled:true,wxpusherAppToken:'test',wxpusherUids:'test'},ensureConnection:async(id,n,cb)=>cb(true),releaseConnectionSlot(){released++;},tokenStore:{getWebSocketStatus:()=> 'connected',getBattleVersion:()=>240522,sendMessageWithPromise:(id,cmd,p)=>{
    if(cmd==='role_getroleinfo')return {role:structuredClone(f.role)};
    return f.calls.push({cmd,p}),cmd==='hall_getinfo'?{}:{};
  },closeWebSocketConnection(){closed++;}},loadFeudatoryConfig:async()=>({ConstantConf:{lordEnergyCount:10,lordCount:[1,100,300,500,1000]}}),storage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},sleep:async()=>{},sendWxPusherMessage:async(config,title,content,type)=>{assert.equal(type,2);assert.match(content,/<table/);pushes++;throw Error('offline');},addLog:x=>logs.push(x),message:{}};
  await createTasksFeudatory(deps).batchAutoFeudatory();assert.equal(closed,1);assert.equal(released,1);assert.equal(pushes,1);assert.ok(saved.has('xyzw-feudatory-history-v1:1'));assert.equal(deps.isRunning.value,false);assert.equal(deps.tokenStatus.value.a,'completed');assert.ok(logs.some(l=>l.message.includes('推送失败')));
});

test('释放后本轮不立即抓回同一个零贡献成员',async()=>{
  const f=scenario({role:{feudatory:{2:{goldTotal:0}}},history:{2:{capturedAt:time-49*3600000}},arena:[2]});
  const r=await f.run();assert.equal(f.fights(),0);assert.ok(r.actions.includes('释放 2'));
});
test('释放前复查出现贡献则保留；未确认释放不开始抓取',async()=>{
  const role={roleId:1,bossId:0,power:100,levelId:6000,hallEnergy:100,feudatory:{2:{goldTotal:0}}};
  for(const changed of [true,false]){
    let queries=0,exiled=0;
    const r=await runAutoFeudatory({config:{ConstantConf:{lordEnergyCount:10,lordCount:[1]}},history:{2:{observedAt:time-50*3600000}},saveHistory(){},now:()=>time,battleVersion:1,send:async cmd=>{
      if(cmd==='role_getroleinfo'){queries++;return {role:{...role,feudatory:{2:{goldTotal:changed&&queries>1?1:0}}}};}
      if(cmd==='feudatory_exiled'){exiled++;return {};}
      if(cmd==='rank_getroleinfo')return {roleInfo:{name:'保留'}};
      throw Error('不应抓取');
    }});
    assert.equal(exiled,changed?0:1);
    if(!changed)assert.match(r.error,/释放结果未确认/);
  }
});
test('全组榜单不全时按范围补齐候选，胜负未知不自动重试',async()=>{
  const role={roleId:1,bossId:0,power:100,levelId:6000,hallEnergy:100,feudatory:{}};
  const pages=[];let fights=0;
  const r=await runAutoFeudatory({config:{ConstantConf:{lordEnergyCount:10,lordCount:[1]}},history:{},saveHistory(){},now:()=>time,battleVersion:1,send:async(cmd,p)=>{
    if(cmd==='role_getroleinfo')return {role};
    if(cmd==='hall_getinfo'||cmd==='arena_startarea')return {};
    if(cmd==='arena_getarearank'){pages.push(p);return p.minRank?{list:[{roleId:2},{roleId:3}]}:{list:[{roleId:2}],total:2};}
    if(cmd==='rank_getroleinfo')return {roleInfo:{roleId:p.roleId,bossId:0,power:50,levelId:6000}};
    if(cmd==='fight_startconquer'){fights++;return {battleData:{}};}
    throw Error(cmd);
  }});
  assert.equal(pages.length,2);assert.equal(fights,1);assert.match(r.error,/结果未确认/);
});

test('完整角色查询中的空名单、无咸主及零金币应用协议默认值',async()=>{
  const f=scenario({role:{bossId:undefined,feudatory:undefined,hallEnergy:0}});
  const r=await f.run();assert.equal(r.reason,'精力不足');assert.equal(r.members.length,0);
  const known=scenario({role:{hallEnergy:0,feudatory:{2:{}}},history:{2:{observedAt:time-49*3600000}}});
  await known.run();assert.equal(known.calls.filter(c=>c.cmd==='feudatory_exiled').length,1);
});
test('注册小号与定时入口，定时合并报表且禁止自动补跑抓取',async()=>{
  const fs=await import('node:fs');
  const view=fs.readFileSync(new URL('../src/views/BatchDailyTasks.vue',import.meta.url),'utf8');
  assert.match(view,/@click="batchAutoFeudatory"/);
  assert.match(view,/aggregatedFeudatoryResults.push/);
  assert.match(view,/protectedTokenIds: availableTokens/);
  assert.match(view,/pushFeudatoryInfo\(aggregatedFeudatoryResults\)/);
  assert.match(view,/"batchCampfireLottery", "batchAutoFeudatory", "batchReleaseFeudatory"\]\.includes\(name\)/);
});

test('保护账号从竞技场与好友排除，已有受保护咸臣无视48小时及贡献释放',async()=>{
  const f=scenario({excludedRoleIds:['2',3],role:{feudatory:{2:{goldTotal:999}}},arena:[2,3],friends:[{roleId:3,lastLogin:time/1000},{roleId:4,lastLogin:time/1000}]});
  const r=await f.run();
  assert.deepEqual(f.calls.filter(c=>c.cmd==='feudatory_exiled').map(c=>c.p.targetId),[2]);
  assert.deepEqual(f.calls.filter(c=>c.cmd==='fight_startconquer').map(c=>c.p.targetId),[4]);
  assert.equal(f.history[2],undefined);assert.ok(r.actions.includes('释放 2'));
});

test('批量只解析本次选中的账号身份，未选中账号不受保护',async()=>{
  const { createTasksFeudatory }=await import('../src/utils/batch/tasksFeudatory.js');
  const calls=[],connected=[];let released=0;
  const role={roleId:1,bossId:0,levelId:6000,power:1000,hallEnergy:10,feudatory:{2:{goldTotal:100},3:{goldTotal:100}}};
  const deps={selectedTokens:{value:['a','b']},tokens:{value:[{id:'a',roleId:1},{id:'b'},{id:'c',roleId:3}]},tokenStatus:{value:{}},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},batchSettings:{},ensureConnection:async(id,n,cb)=>{connected.push(id);cb(true);},releaseConnectionSlot(){released++;},tokenStore:{getWebSocketStatus:()=> 'connected',getBattleVersion:()=>1,updateToken(){},closeWebSocketConnection(){},sendMessageWithPromise:async(id,cmd,p)=>{
    calls.push({id,cmd,p});
    if(id==='b')return {role:{roleId:2,bossId:0,levelId:6000,power:1000,hallEnergy:0,feudatory:{}}};
    if(cmd==='role_getroleinfo')return {role:structuredClone(role)};
    if(cmd==='feudatory_exiled'){delete role.feudatory[p.targetId];return {};}
    if(cmd==='hall_getinfo'||cmd==='arena_startarea')return {};
    if(cmd==='arena_getarearank')return {list:[]};
    if(cmd==='friend_list')return {friendList:[]};
    if(cmd==='rank_getroleinfo')return {roleInfo:{roleId:p.roleId}};
    throw Error(cmd);
  }},storage:{getItem:()=>null,setItem(){}},loadFeudatoryConfig:async()=>({ConstantConf:{lordEnergyCount:10,lordCount:[1,100,300,500,1000]}}),sleep:async()=>{},addLog(){},message:{}};
  await createTasksFeudatory(deps).batchAutoFeudatory();
  assert.equal(connected.includes('c'),false);
  assert.deepEqual(calls.filter(c=>c.cmd==='feudatory_exiled').map(c=>c.p.targetId),[2]);
  assert.ok(role.feudatory[3]); assert.equal(released,3);
});
test('所选账号身份无法确认时整轮不抓取也不释放',async()=>{
  const {createTasksFeudatory}=await import('../src/utils/batch/tasksFeudatory.js');let writes=0;
  const deps={selectedTokens:{value:['a']},tokens:{value:[{id:'a'}]},tokenStatus:{value:{}},isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},batchSettings:{},ensureConnection:async()=>{},releaseConnectionSlot(){},tokenStore:{sendMessageWithPromise:async()=>{writes++;throw Error('查询失败');}},sleep:async()=>{},addLog(){},message:{}};
  await createTasksFeudatory(deps).batchAutoFeudatory();assert.equal(writes,1);assert.equal(deps.tokenStatus.value.a,'failed');
});

test('咸臣总表五列且每账号一行，转义内容并省略明细',()=>{
  const html=feudatoryReport([{name:'<script>x</script>',reason:'完成',members:[{id:2,name:'A|B',gold:0}],actions:['<img src=x>']}]);
  assert.match(html,/<table/);assert.equal((html.match(/<th style=/g)||[]).length,5);assert.equal((html.match(/<tbody><tr>/g)||[]).length,1);assert.match(html,/A\|B/);
  assert.equal(html.includes('<script>'),false);assert.equal(html.includes('<img'),false);
  assert.equal(html.includes('Invalid Date'),false);assert.equal(html.includes('观察开始'),false);assert.equal(html.includes('战力'),false);
});
test('多账号HTML报表按UTF-8字节分段，保持HTML类型与完整账号表格',async()=>{
  const sent=[],delays=[];
  const deps={batchSettings:{wxpusherEnabled:true,wxpusherAppToken:'test',wxpusherUids:'test'},addLog(){},sendWxPusherMessage:async(c,title,content,type)=>sent.push({title,content,type}),sleep:async ms=>delays.push(ms)};
  const rows=Array.from({length:50},(_,i)=>({tokenId:String(i),name:`账号${i}`,reason:'完成',members:Array.from({length:5},(_,j)=>({id:i*10+j,name:'中文名称'.repeat(5),gold:100,observedAt:1})),actions:[]}));
  await createTasksFeudatory(deps).pushFeudatoryInfo(rows);
  assert.ok(sent.length>1);assert.equal(delays.length,sent.length-1);
  for(const part of sent){assert.equal(part.type,2);assert.ok(new TextEncoder().encode(part.content).length<=60000);assert.ok(part.content.length<=38000);assert.equal((part.content.match(/<table /g)||[]).length,(part.content.match(/<\/table>/g)||[]).length);}
  assert.equal(sent.reduce((n,p)=>n+(p.content.match(/font-weight:bold;/g)||[]).length,0),50);
});

test('小批次一张完整总表，金额千位分隔，批次汇总与账号行一致',async()=>{
 const rows=[{tokenId:'a',name:'小号1',reason:'满员',members:[{name:'张三',gold:12000},{name:'李四',gold:8000}],actions:['抓取 2','抓取 3','释放 4'],boss:null},{tokenId:'b',name:'小号2',reason:'精力不足',members:[{name:'赵六',gold:6000}],actions:[],boss:{name:'咸主'}}];
 const sent=[];await createTasksFeudatory({batchSettings:{wxpusherEnabled:true,wxpusherAppToken:'t',wxpusherUids:'u'},addLog(){},sendWxPusherMessage:async(c,t,html)=>sent.push(html)}).pushFeudatoryInfo(rows);
 assert.equal(sent.length,1);const html=sent[0];assert.equal((html.match(/<table /g)||[]).length,1);assert.equal((html.match(/font-weight:bold;/g)||[]).length,2);
 assert.match(html,/本批2个账号｜抓取2人｜释放1人/);assert.match(html,/26,000金币/);assert.match(html,/张三：12,000<br>李四：8,000/);assert.equal(html.includes('推关'),false);
});
