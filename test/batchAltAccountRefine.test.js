import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTasksRefine } from "../src/utils/batch/tasksRefine.js";
import { availableTasks, defaultBatchSettings } from "../src/utils/batch/constants.js";

const target = { colorId: 5, attrId: 9, isLocked: false };
function fixture({ limit = 1, ids = ["a", "b"], allDone = false, fail = null } = {}) {
  const calls = [], logs = [], closed = [], connected = [];
  let released = 0;
  const deps = {
    selectedTokens: { value: ids }, tokens: { value: ids.map(id => ({ id, name: id })) },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, batchSettings: { altRefineHeroId: 107, altRefineLimit: limit, commandDelay: 0 },
    ensureConnection: async id => { connected.push(id); if (fail === "connect" && id === "a") throw new Error("连接失败"); },
    releaseConnectionSlot: () => released++, addLog: log => logs.push(log),
    message: { info() {}, warning(text) { logs.push({ message: text }); } },
    tokenStore: {
      getWebSocketStatus: () => "connected",
      closeWebSocketConnection: id => closed.push(id),
      async sendGetRoleInfo(id) {
        const equipment = Object.fromEntries([1,2,3,4].map(p => [p, { level:4000, quenches: allDone ? {1:target} : {} }]));
        if (fail === "locked" && id === "a") equipment[1].quenches = {1:{isLocked:true}};
        return {role:{heroes:{107:{equipment}}}};
      },
      async sendMessageWithPromise(id, cmd, params) {
        calls.push({id,cmd,params});
        if(fail === "server" && id === "a") throw new Error("白玉不足");
        return {_raw:{body:{role:{heroes:{[params.heroId]:{equipment:{[params.part]:{quenches:{1:{colorId:2,attrId:12}}}}}}}}}};
      },
    },
  };
  return { deps, calls, logs, closed, connected, released: () => released, run: () => createTasksRefine(deps).batchAltAccountRefine() };
}

test("各账号独立按上限洗练，达上限不误报达标，全部释放连接", async () => {
  const f=fixture(); await f.run();
  assert.deepEqual(f.calls.map(x=>x.id),["a","b"]);
  assert.deepEqual(f.calls[0].params,{heroId:107,part:1,quenchId:0,quenches:{},seed:0,skipOrange:false});
  assert.deepEqual(f.deps.tokenStatus.value,{a:"failed",b:"failed"});
  assert.deepEqual(f.closed,["a","b"]); assert.equal(f.released(),2);
  assert.equal(f.deps.isRunning.value,false); assert.equal(f.deps.currentRunningTokenId.value,null);
  assert.equal(f.logs.filter(x=>x.message.includes("已达本次白玉洗练上限1次")).length,2);
});

test("装备已经全部达标时完成任务，不发送洗练请求", async () => {
  const f=fixture({allDone:true}); await f.run();
  assert.equal(f.calls.length,0); assert.deepEqual(f.deps.tokenStatus.value,{a:"completed",b:"completed"});
  assert.equal(f.logs.filter(x=>x.message.includes("已有目标属性")).length,8);
});

test("白玉不足、锁定装备或连接失败仅终止该账号，继续下一个", async () => {
  for(const fail of ["server","locked","connect"]) {
    const f=fixture({fail}); await f.run();
    assert.equal(f.deps.tokenStatus.value.a,"failed"); assert.equal(f.calls.filter(x=>x.id==="b").length,1);
    assert.equal(f.released(),fail === "connect" ? 1 : 2);
  }
});

test("停止后不再洗下一件和后续账号，运行状态等待当前请求结束再清理", async () => {
  const f=fixture({limit:10});
  const send=f.deps.tokenStore.sendMessageWithPromise;
  f.deps.tokenStore.sendMessageWithPromise=async(...args)=>{
    assert.equal(f.deps.isRunning.value,true);
    f.deps.shouldStop.value=true;
    return send(...args);
  };
  await f.run(); assert.equal(f.calls.length,1);
  assert.deepEqual(f.connected,["a"]); assert.deepEqual(f.deps.tokenStatus.value,{a:"stopped",b:"stopped"});
  assert.equal(f.released(),1); assert.equal(f.deps.isRunning.value,false);
});

test("连接完成期间请求停止，不读取装备或开始消耗", async () => {
  const f=fixture();
  f.deps.ensureConnection=async()=>{f.deps.shouldStop.value=true;};
  f.deps.tokenStore.sendGetRoleInfo=async()=>assert.fail("不应继续查询");
  await f.run(); assert.equal(f.calls.length,0); assert.equal(f.released(),1);
  assert.deepEqual(f.deps.tokenStatus.value,{a:"stopped",b:"stopped"});
});

test("非法上限不建立连接，不发送任何游戏请求",async()=>{
  const f=fixture({limit:0}); await f.run();
  assert.equal(f.connected.length,0); assert.equal(f.calls.length,0);
  assert.ok(f.logs[0].message.includes("正整数"));
});

test("注册到批量入口、小号分组和定时任务，默认每账号1000次、吕布",()=>{
  assert.ok(availableTasks.some(x=>x.value === "batchAltAccountRefine"));
  assert.equal(defaultBatchSettings.altRefineLimit,1000); assert.equal(defaultBatchSettings.altRefineHeroId,107);
  const source=fs.readFileSync(new URL("../src/views/BatchDailyTasks.vue",import.meta.url),"utf8");
  assert.ok(source.includes('@click="batchAltAccountRefine"'));
  assert.ok(source.includes('"batchAltAccountRefine",'));
  assert.ok(source.includes('v-model:value="batchSettings.altRefineLimit"'));
  assert.ok(source.includes('v-model:value="batchSettings.altRefineHeroId"'));
  assert.ok(source.slice(source.indexOf("const getScheduledTaskFunction")).includes("    batchAltAccountRefine,"));
});

test("明确使用配置武将，缺少该武将的账号停止而不改洗其他武将",async()=>{
  const f=fixture(); f.deps.batchSettings.altRefineHeroId=106;
  await f.run(); assert.equal(f.calls.length,0);
  assert.deepEqual(f.deps.tokenStatus.value,{a:"failed",b:"failed"});
  assert.ok(f.logs.some(x=>x.message.includes("账号未拥有配置武将")));
  const g=fixture({ids:["a"]}); g.deps.batchSettings.altRefineHeroId=106;
  const get=g.deps.tokenStore.sendGetRoleInfo;
  g.deps.tokenStore.sendGetRoleInfo=async(id)=>{
    const info=await get(id); info.role.heroes[106]=info.role.heroes[107]; delete info.role.heroes[107]; return info;
  };
  await g.run(); assert.equal(g.calls.length,1); assert.equal(g.calls[0].params.heroId,106);
});

test("铠甲已达标不影响武器请求，版本错误注明武器并停止该账号不重试",async()=>{
  const f=fixture({ids:["a"],limit:1000});
  const get=f.deps.tokenStore.sendGetRoleInfo;
  f.deps.tokenStore.sendGetRoleInfo=async id=>{
    const info=await get(id); info.role.heroes[107].equipment[2].quenches={1:target}; return info;
  };
  f.deps.tokenStore.sendMessageWithPromise=async(id,cmd,params)=>{
    f.calls.push({id,cmd,params}); throw new Error("服务器错误: 200040 - 版本过低，请升级");
  };
  await f.run(); assert.equal(f.calls.length,1); assert.equal(f.calls[0].params.part,1);
  assert.ok(f.logs.some(x=>x.message.includes("铠甲已有目标属性")));
  assert.ok(f.logs.some(x=>x.message.includes("武器洗练请求(equipment_quench)失败") && x.message.includes("版本过低，请升级")));
  assert.equal(f.deps.tokenStatus.value.a,"failed");
});
