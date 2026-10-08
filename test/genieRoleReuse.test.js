import assert from "node:assert/strict";
import { test } from "node:test";
import { createTasksItem } from "../src/utils/batch/tasksItem.js";
import { runDailyGenieChallenges } from "../src/utils/dailyGenieChallenges.js";
import { GENIE_FACTION_LINEUPS, GROUP_GENIE_LINEUP } from "../src/utils/genieChallengePlanner.js";

function fixture({ used = 7, failPower = false } = {}) {
  const role = {
    levelId: 3000,
    heroes: Object.fromEntries([...new Set([...Object.values(GENIE_FACTION_LINEUPS).flat(), ...GROUP_GENIE_LINEUP.map(h=>h.heroId)])].map(id=>[id,{heroId:id,level:750,order:3}])),
    statistics: { "genie:battle": used },
    statisticsTime: { "genie:battle": Math.floor(Date.now()/1000) },
    genie: { 1:0, 2:0, 3:0, 4:0 },
  };
  const calls = []; const waits = []; const logs = [];
  const store = {
    gameTokens: [{id:"t",name:"测试"}], getWebSocketStatus:()=>"connected", closeWebSocketConnection(){},
    async sendGetRoleInfo(){calls.push("role_getroleinfo");return {role:structuredClone(role)};},
    async sendMessageWithPromise(id,cmd,params){
      calls.push(cmd);
      if(cmd === "hero_calcpowerbyteam" && failPower) throw new Error("服务器错误: 200400 - 操作太快");
      if(cmd === "fight_startgenie") {
        role.statistics["genie:battle"]++;
        // Captured losing battle: only statistics/time are returned, no full role.
        return {_raw:{body:{role:{statistics:structuredClone(role.statistics),statisticsTime:structuredClone(role.statisticsTime)}}}};
      }
      return {};
    },
  };
  const deps = {
    selectedTokens:{value:["t"]}, tokens:{value:store.gameTokens}, tokenStatus:{value:{}},
    isRunning:{value:false}, shouldStop:{value:false}, currentRunningTokenId:{value:null},
    tokenStore:store,ensureConnection:async()=>{},releaseConnectionSlot:()=>{},connectionQueue:{active:1},
    batchSettings:{maxActive:1},helperSettings:{},delayConfig:{command:0,action:0},
    genieSleep:async ms=>waits.push(ms),addLog:entry=>logs.push(entry),message:{success(){},warning(){},info(){}},
  };
  return {role,store,deps,calls,waits,logs,tasks:createTasksItem(deps)};
}

for (const method of ["batchChallengeThreeKingdomsGenie","batchChallengeGroupGenie"]) {
  test(`${method} 阵容达标时只查询一次，三轮失败复用服务器次数增量`, async () => {
    const f=fixture(); await f.tasks[method]();
    assert.equal(f.calls.filter(cmd=>cmd === "role_getroleinfo").length,1);
    assert.equal(f.calls.filter(cmd=>cmd === "fight_startgenie").length,3);
    assert.equal(f.calls.filter(cmd=>cmd === "hero_calcpowerbyteam").length,3);
    assert.deepEqual(f.waits,[1000,1500,1000,1500,1000]);
    assert.equal(f.deps.tokenStatus.value.t,"completed");
  });
}

test("日常魏蜀吴与群雄共用一次查询，次数耗尽不重复升级或挑战", async () => {
  const f=fixture();
  await runDailyGenieChallenges({tokenId:"t",tokenStore:f.store,stopped:()=>false,log:()=>{},delaySettings:{commandDelay:0},
    createTasks:deps=>createTasksItem({...deps,genieSleep:async()=>{}})});
  assert.equal(f.calls.filter(cmd=>cmd === "role_getroleinfo").length,1);
  assert.equal(f.calls.filter(cmd=>cmd === "fight_startgenie").length,3);
});

test("魏蜀吴限流后结束日常灯神，不继续进入群雄发请求", async () => {
  const f=fixture({failPower:true});
  await assert.rejects(runDailyGenieChallenges({tokenId:"t",tokenStore:f.store,stopped:()=>false,log:()=>{},delaySettings:{commandDelay:0},
    createTasks:deps=>createTasksItem({...deps,genieSleep:async()=>{}})}), /魏蜀吴灯神挑战失败/);
  assert.deepEqual(f.calls,["role_getroleinfo","hero_calcpowerbyteam"]);
});

test("战斗响应显示次数耗尽时立即停止，不继续消耗初始快照的剩余次数", async () => {
  const f=fixture();
  const send=f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise=async(id,cmd,params)=>{
    if(cmd === "fight_startgenie") return {role:{statistics:{"genie:battle":10},statisticsTime:{"genie:battle":Math.floor(Date.now()/1000)}}};
    return send(id,cmd,params);
  };
  await f.tasks.batchChallengeThreeKingdomsGenie();
  assert.equal(f.calls.filter(cmd=>cmd === "role_getroleinfo").length,1);
  assert.equal(f.calls.filter(cmd=>cmd === "hero_calcpowerbyteam").length,1);
});

test("确实升级后复用升级流程核对的快照，不额外查询每个武将", async () => {
  const f=fixture({used:9});
  f.role.heroes[101].level=749;
  f.role.heroes[101].order=10;
  f.role.gold=1e12;
  const send=f.store.sendMessageWithPromise;
  f.store.sendMessageWithPromise=async(id,cmd,params)=>{
    if(cmd === "hero_heroupgradelevel") {
      f.calls.push(cmd);
      f.role.heroes[params.heroId].level+=params.upgradeNum;
      return {role:{heroes:{[params.heroId]:structuredClone(f.role.heroes[params.heroId])}}};
    }
    return send(id,cmd,params);
  };
  await f.tasks.batchChallengeThreeKingdomsGenie();
  assert.equal(f.deps.tokenStatus.value.t,"completed");
  assert.equal(f.calls.filter(cmd=>cmd === "hero_heroupgradelevel").length,1);
  assert.equal(f.calls.filter(cmd=>cmd === "role_getroleinfo").length,2);
  assert.equal(f.calls.filter(cmd=>cmd === "fight_startgenie").length,1);
});
