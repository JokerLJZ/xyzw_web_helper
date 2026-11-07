import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PEARL_FISH_GOODS, highestOwnedFish, redFeatherPurchaseNeed, planPearlFishPurchases } from "../src/utils/pearlFishPlanner.js";
import { createTasksPearlFish } from "../src/utils/batch/tasksPearlFish.js";
import { createConfirmedPearlFishTasks } from "../src/utils/batch/confirmedPearlFishTasks.js";
import { availableTasks } from "../src/utils/batch/constants.js";

const role = (pearls=500) => ({items:{1013:{quantity:pearls}},heroes:{107:{heroId:107,artifactId:-1},104:{heroId:104,artifactId:-1}}});

test("商品编号和珍珠价格与官方配置及采集奖励一致",()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL("./fixtures/pearlFishGoods.json",import.meta.url)));
  for(const goods of Object.values(PEARL_FISH_GOODS)) {
    const conf=fixture.goods.find(x=>x.id===goods.goodsId);
    assert.equal(conf.costItemID,1013); assert.equal(conf.price,goods.price);
    assert.equal(conf.merchandise[0].itemId,goods.itemId);
  }
  const capture=JSON.parse(fs.readFileSync(new URL("./fixtures/pearlFishPurchase.json",import.meta.url)));
  assert.equal(capture.reward[0].itemId,13041); assert.equal(capture.role.items[1013].quantity,117);
});

test("赤羽补齐四星数量：无本体、一星库存、一星佩戴、三星、已四五星",()=>{
  const r=role(); assert.equal(redFeatherPurchaseNeed(r),4);
  r.items[13041]={quantity:1}; assert.equal(redFeatherPurchaseNeed(r),3);
  r.items[13041]={quantity:3}; assert.equal(redFeatherPurchaseNeed(r),1);
  r.heroes[107].artifactId=13041; assert.equal(redFeatherPurchaseNeed(r),0);
  delete r.items[13041]; r.heroes[107].artifactId=13043; assert.equal(redFeatherPurchaseNeed(r),1);
  r.items[13041]={quantity:1}; assert.equal(redFeatherPurchaseNeed(r),0);
  r.heroes[107].artifactId=13044; delete r.items[13041]; assert.equal(redFeatherPurchaseNeed(r),0);
  r.heroes[107].artifactId=13045; assert.equal(redFeatherPurchaseNeed(r),0);
});

test("最高星包含其他武将和库存，同星优先指定武将，材料不使用其他武将本体",()=>{
  const r=role(); r.items[13043]={quantity:1};r.heroes[104].artifactId=13044;
  assert.equal(redFeatherPurchaseNeed(r),0);assert.equal(highestOwnedFish(r,PEARL_FISH_GOODS.redFeather).holderHeroId,104);
  r.heroes[104].artifactId=13041;delete r.items[13043];r.heroes[107].artifactId=13041;
  assert.equal(redFeatherPurchaseNeed(r),3);assert.equal(highestOwnedFish(r,PEARL_FISH_GOODS.redFeather).holderHeroId,107);
});

test("珍珠只够部分赤羽时不分配八卦预算，恰好补齐后剩余买八卦",()=>{
  assert.deepEqual(planPearlFishPurchases(role(239)),{redNeed:4,redCount:3,baguaCount:0});
  assert.deepEqual(planPearlFishPurchases(role(315)),{redNeed:4,redCount:4,baguaCount:1});
  assert.deepEqual(planPearlFishPurchases(role(59)),{redNeed:4,redCount:0,baguaCount:0});
  assert.throws(()=>planPearlFishPurchases({items:{}}),/无法确认/);
});

function fixture(initial=role(),{failBuy=false,stopBuy=false,autoUpgrade=true,ids=["a"]}={}) {
  const server=Object.fromEntries(ids.map(id=>[id,structuredClone(initial)]));
  const calls=[],logs=[],closed=[];let released=0;
  const deps={selectedTokens:{value:ids},tokens:{value:ids.map(id=>({id,name:id}))},tokenStatus:{value:{}},
    isRunning:{value:false},shouldStop:{value:false},currentRunningTokenId:{value:null},
    batchSettings:{pearlFishAutoUpgrade:autoUpgrade,commandDelay:0},sleep:async()=>{},ensureConnection:async()=>{},
    releaseConnectionSlot:()=>released++,addLog:l=>logs.push(l),message:{info(){}},tokenStore:{
      getWebSocketStatus:()=>"connected",closeWebSocketConnection:id=>closed.push(id),
      sendGetRoleInfo:async id=>({role:structuredClone(server[id])}),
      async sendMessageWithPromise(id,cmd,p){
        calls.push({id,cmd,p});const r=server[id];
        if(cmd==="activity_buygoods") {
          if(failBuy)throw new Error("服务器错误");
          const g=Object.values(PEARL_FISH_GOODS).find(g=>g.goodsId===p.goodsId);
          r.items[1013].quantity-=g.price;r.items[g.itemId]={quantity:(r.items[g.itemId]?.quantity??0)+1};
          if(stopBuy)deps.shouldStop.value=true;
          return {_raw:{body:{role:{items:{1013:structuredClone(r.items[1013]),[g.itemId]:structuredClone(r.items[g.itemId])}},reward:[{type:3,itemId:g.itemId,value:1}]}}};
        }
        if(cmd==="artifact_upgradestar") {
          const material=Math.floor(p.itemId/10)*10+1;
          assert.ok(r.items[material]?.quantity>=1);
          r.items[material].quantity--;
          if(p.heroId>0){ assert.equal(r.heroes[p.heroId].artifactId,p.itemId);r.heroes[p.heroId].artifactId++; }
          else {
            assert.ok(r.items[p.itemId]?.quantity>=1); r.items[p.itemId].quantity--;
            r.items[p.itemId+1]={quantity:(r.items[p.itemId+1]?.quantity??0)+1};
          }
        }
        if(cmd==="artifact_unload") {
          const itemId=r.heroes[p.heroId].artifactId;r.items[itemId]={quantity:(r.items[itemId]?.quantity??0)+1};r.heroes[p.heroId].artifactId=-1;
        }
        if(cmd==="artifact_load") {
          assert.ok(r.items[p.itemId]?.quantity>0);r.items[p.itemId].quantity--;
          r.heroes[p.heroId].artifactId=p.itemId;
        }
        return {role:structuredClone(r)};
      },
    }};
  return {deps,server,calls,logs,closed,released:()=>released,tasks:createTasksPearlFish(deps)};
}

test("整套采购先赤羽补四星再八卦，用剩余珍珠，采购后分别升星和佩戴",async()=>{
  const f=fixture(role(315));await f.tasks.batchBuyPearlFish();
  assert.deepEqual(f.calls.filter(x=>x.cmd==="activity_buygoods").map(x=>x.p),[8304,8304,8304,8304,8206].map(goodsId=>({type:1,goodsId})));
  assert.equal(f.server.a.heroes[107].artifactId,13044);assert.equal(f.server.a.heroes[104].artifactId,12061);
  assert.equal(f.server.a.items[1013].quantity,0);
  assert.equal(f.calls.filter(x=>x.cmd==="artifact_upgradestar").length,3);
  assert.equal(f.deps.tokenStatus.value.a,"completed");assert.equal(f.released(),1);
});

test("已有三星赤羽只买一条，八卦用剩余珍珠尽量升至五星",async()=>{
  const r=role(435);r.heroes[107].artifactId=13043;
  const f=fixture(r);await f.tasks.batchBuyPearlFish();
  assert.equal(f.calls.filter(x=>x.cmd==="activity_buygoods"&&x.p.goodsId===8304).length,1);
  assert.equal(f.calls.filter(x=>x.cmd==="activity_buygoods"&&x.p.goodsId===8206).length,5);
  assert.equal(f.server.a.heroes[107].artifactId,13044);assert.equal(f.server.a.heroes[104].artifactId,12065);
  assert.equal(f.calls.some(x=>x.cmd==="artifact_upgradestar"&&x.p.itemId===13044),false);
});

test("没有实际采购时不升星、不卸载、不佩戴，即使材料足够",async()=>{
  const r=role(0);r.items[13043]={quantity:1};r.items[13041]={quantity:1};r.items[12065]={quantity:1};
  const f=fixture(r);await f.tasks.batchBuyPearlFish();assert.equal(f.calls.length,0);
});

test("独立八卦任务保留赤羽优先级，赤羽材料未补齐不购买八卦",async()=>{
  const f=fixture(role(500));await f.tasks.batchBuyBaguaWithPearls();assert.equal(f.calls.length,0);
});

test("八卦有采购时才佩戴最高星；赤羽无采购不调整；可迁移其他武将最高星八卦",async()=>{
  const r=role(75);r.heroes[107].artifactId=13044;r.heroes[106]={heroId:106,artifactId:12065};
  const f=fixture(r);await f.tasks.batchBuyPearlFish();
  assert.equal(f.server.a.heroes[104].artifactId,12065);
  assert.deepEqual(f.calls.filter(x=>x.cmd==="artifact_unload").map(x=>x.p),[{heroId:106}]);
  assert.equal(f.calls.some(x=>x.p.heroId===107),false);
});

test("采购失败不操作佩戴，停止不继续买其他鱼或后续账号，连接最终清理",async()=>{
  const f=fixture(role(500),{failBuy:true,ids:["a","b"]});await f.tasks.batchBuyPearlFish();
  assert.equal(f.calls.length,2);assert.ok(f.calls.every(x=>x.cmd==="activity_buygoods"));
  assert.deepEqual(f.deps.tokenStatus.value,{a:"failed",b:"failed"});assert.equal(f.released(),2);
  const g=fixture(role(500),{stopBuy:true,ids:["a","b"]});await g.tasks.batchBuyPearlFish();
  assert.equal(g.calls.length,1);assert.deepEqual(g.deps.tokenStatus.value,{a:"stopped",b:"stopped"});
  assert.equal(g.deps.isRunning.value,false);assert.equal(g.deps.currentRunningTokenId.value,null);
});

test("两个独立任务及整套采购均注册定时任务",()=>{
  for(const name of ["batchBuyRedFeatherWithPearls","batchBuyBaguaWithPearls","batchBuyPearlFish"])assert.ok(availableTasks.some(x=>x.value===name));
});

test("确认前零请求，重复点击不重复弹窗，取消不执行",async()=>{
  const f=fixture();let resolveConfirm;let prompts=0;
  const tasks=createConfirmedPearlFishTasks(f.deps,{confirm:()=>{prompts++;return new Promise(resolve=>resolveConfirm=resolve);}});
  let connections=0;f.deps.ensureConnection=async()=>{connections++;};
  const first=tasks.batchBuyPearlFish();const second=tasks.batchBuyPearlFish();
  assert.equal(prompts,1);assert.equal(first,second);assert.equal(f.calls.length,0);
  resolveConfirm(false);await first;assert.equal(connections,0);assert.equal(f.calls.length,0);
});

test("三个入口均须确认，确认时冻结账号及升星设置",async()=>{
  for(const name of ["batchBuyRedFeatherWithPearls","batchBuyBaguaWithPearls","batchBuyPearlFish"]){
    const f=fixture(role(315),{ids:["a","b"]});f.deps.selectedTokens.value=["a"];
    let approve;let data;
    const tasks=createConfirmedPearlFishTasks(f.deps,{confirm:d=>{data=d;return new Promise(resolve=>approve=resolve);}});
    const pending=tasks[name]();assert.deepEqual(data.names,["a"]);assert.equal(data.autoUpgrade,true);
    f.deps.selectedTokens.value=["b"];f.deps.batchSettings.pearlFishAutoUpgrade=false;
    approve(true);await pending;assert.ok(f.calls.every(x=>x.id==="a"));
    if(name!=="batchBuyBaguaWithPearls")assert.equal(f.server.a.heroes[107].artifactId,13044);
  }
});

test("预算不足只采购部分赤羽并升星，不买八卦，其他账号独立规划",async()=>{
  const f=fixture(role(120),{ids:["a","b"]});await f.tasks.batchBuyPearlFish();
  assert.equal(f.calls.filter(x=>x.cmd==="activity_buygoods").length,4);
  assert.ok(f.calls.filter(x=>x.cmd==="activity_buygoods").every(x=>x.p.goodsId===8304));
  assert.equal(f.server.a.heroes[107].artifactId,13042);assert.equal(f.server.b.heroes[107].artifactId,13042);
});

test("购买奖励错误则停止，不继续消耗或调整装备",async()=>{
  const f=fixture(role(500));
  f.deps.tokenStore.sendMessageWithPromise=async(id,cmd,p)=>{
    f.calls.push({id,cmd,p});return {role:{items:{1013:{quantity:440}}},reward:[{type:3,itemId:12061,value:1}]};
  };
  await f.tasks.batchBuyPearlFish();assert.equal(f.calls.length,1);assert.equal(f.deps.tokenStatus.value.a,"failed");
});

test("真实采集的珍珠与鱼灵增量合并后只补买一条赤羽",async()=>{
  const initial=role(177);initial.heroes[107].artifactId=13043;
  const f=fixture(initial,{autoUpgrade:false});
  const send=f.deps.tokenStore.sendMessageWithPromise;
  const captured=JSON.parse(fs.readFileSync(new URL("./fixtures/pearlFishPurchase.json",import.meta.url)));
  f.deps.tokenStore.sendMessageWithPromise=async(...args)=>{
    const result=await send(...args);
    return args[1]==="activity_buygoods" ? structuredClone(captured) : result;
  };
  await f.tasks.batchBuyRedFeatherWithPearls();
  assert.equal(f.calls.filter(x=>x.cmd==="activity_buygoods").length,1);
  assert.equal(f.calls.filter(x=>x.cmd==="artifact_upgradestar").length,0);
  assert.equal(f.deps.tokenStatus.value.a,"completed");
});
