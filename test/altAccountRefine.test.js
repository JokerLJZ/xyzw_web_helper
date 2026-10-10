import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { hasAltRefineTarget, runAltAccountRefine } from "../src/utils/altAccountRefine.js";

const target = (attrId = 9, colorId = 5) => ({ quenches: { 1: { attrId, colorId, isLocked: false } } });
const equipment = () => Object.fromEntries([1, 2, 3, 4].map(p => [p, { level: 4000, quenches: {}, quenchTimes: 0 }]));
const response = (part, equip, items) => ({ role: { heroes: { 107: { equipment: { [part]: equip } } }, ...(items ? { items } : {}) } });

test("只匹配橙色减伤和红色攻击、减伤、技能伤害，任一孔位即可", () => {
  for (const [attr, color] of [[9,5],[1,6],[9,6],[14,6]]) assert.ok(hasAltRefineTarget(target(attr,color)));
  for (const [attr, color] of [[1,5],[14,5],[9,4],[2,6],[9,3]]) assert.equal(hasAltRefineTarget(target(attr,color)),false);
  assert.equal(hasAltRefineTarget({}), false);
  assert.ok(hasAltRefineTarget({ quenches: { 1: {attrId: 2, colorId: 6}, 2: {attrId: 14, colorId: 6} } }));
});

test("按装备顺序运行并跳过已有目标，每件命中即停止；请求与采集一致", async () => {
  const equip = equipment(); equip[2] = {...equip[2], ...target(1,6)};
  const calls = [];
  const r = await runAltAccountRefine({heroId:107, equipment:equip, send:async(cmd,params)=>{
    calls.push({cmd,params}); return response(params.part,target());
  }});
  assert.equal(r.reason,"completed"); assert.equal(r.count,3);
  assert.deepEqual(r.completedParts,[1,2,3,4]);
  assert.deepEqual(calls,[1,3,4].map(part=>({cmd:"equipment_quench",params:{heroId:107,part,quenchId:0,quenches:{},seed:0,skipOrange:false}})));
});

test("真实采集响应按增量合并，未达标持续洗练；次数上限跨装备累计", async () => {
  const capture = JSON.parse(fs.readFileSync(new URL("./fixtures/altAccountRefine-quench.json",import.meta.url)));
  const equip = equipment(); const calls=[];
  const r=await runAltAccountRefine({heroId:107,equipment:equip,limit:2,send:async(cmd,p)=>{
    calls.push(p.part); return calls.length===1 ? response(1,target()) : {...capture,_raw:{...capture._raw,body:response(2,capture._raw.body.role.heroes[107].equipment[1])}};
  }});
  assert.equal(r.reason,"limit"); assert.equal(r.count,2); assert.deepEqual(calls,[1,2]);
  assert.equal(equip[2].level,4000); assert.equal(equip[2].quenchTimes,4251);
  assert.equal(equip[3].quenchTimes,0);
});

test("默认总上限1000次，不多发送一次",async()=>{
  let count=0;
  const r=await runAltAccountRefine({heroId:107,equipment:equipment(),send:async()=>{count++;return response(1,{quenches:{}});}});
  assert.equal(count,1000); assert.equal(r.reason,"limit");
});

test("非目标橙红属性先确认，确认仅返回seed仍保留装备，再传seed洗练",async()=>{
  const equip=equipment(); equip[1]={...equip[1],...target(2,6)};
  const calls=[];
  const r=await runAltAccountRefine({heroId:107,equipment:equip,send:async(cmd,p)=>{
    calls.push({cmd,p});
    return cmd==="equipment_confirm" ? {_raw:{body:response(p.part,{seed:867222})}} : response(p.part,target());
  }});
  assert.equal(r.reason,"completed"); assert.equal(calls[0].cmd,"equipment_confirm");
  assert.deepEqual(calls[0].p,{heroId:107,part:1,quenchId:0,quenches:{}});
  assert.equal(calls[1].p.seed,867222); assert.equal(equip[1].level,4000);
});

test("停止在请求期间发生时更新该次结果，不再洗练下一件",async()=>{
  let stop=false, count=0;
  const r=await runAltAccountRefine({heroId:107,equipment:equipment(),shouldStop:()=>stop,send:async()=>{count++;stop=true;return response(1,target());}});
  assert.equal(r.reason,"stopped"); assert.equal(count,1); assert.equal(r.count,1);
});

test("达到最后一次上限时四件均达标仍报告完成",async()=>{
  const r=await runAltAccountRefine({heroId:107,equipment:equipment(),limit:4,send:async(cmd,p)=>response(p.part,target())});
  assert.equal(r.reason,"completed"); assert.equal(r.count,4);
});

test("无数据、锁定孔位、无seed和异常响应停止，避免继续消耗",async()=>{
  for (const kind of ["missing","locked","seed","response","server"]) {
    const equip=equipment(); let count=0;
    if(kind==="missing") delete equip[1];
    if(kind==="locked") equip[1].quenches={1:{isLocked:true}};
    if(kind==="seed") equip[1]={...equip[1],...target(2,6)};
    await assert.rejects(runAltAccountRefine({heroId:107,equipment:equip,send:async()=>{count++;if(kind==="server")throw new Error("白玉不足");return {};}}));
    assert.ok(count<=1);
  }
});

test("增量items中数量为0时仍传给界面",async()=>{
  let items;
  await runAltAccountRefine({heroId:107,equipment:equipment(),send:async(cmd,p)=>response(p.part,target(),{1022:{quantity:0}}),onUpdate:update=>items=update.items});
  assert.equal(items[1022].quantity,0);
});

test("停止发生在确认请求期间时不再发送消耗白玉的请求",async()=>{
  const equip=equipment(); equip[1]={...equip[1],...target(2,5)};
  let stop=false; const calls=[];
  const result=await runAltAccountRefine({heroId:107,equipment:equip,shouldStop:()=>stop,send:async(cmd,p)=>{
    calls.push(cmd); stop=true; return response(p.part,{seed:867222});
  }});
  assert.deepEqual(calls,["equipment_confirm"]); assert.equal(result.count,0);
  assert.equal(equip[1].level,4000);
});

test("无效上限或装备等级不足时不发送请求",async()=>{
  const send=async()=>assert.fail("不应发送请求");
  for(const limit of [null,0,-1,1.5,NaN]) await assert.rejects(runAltAccountRefine({heroId:107,equipment:equipment(),limit,send}));
  const equip=equipment(); equip[1].level=3999;
  await assert.rejects(runAltAccountRefine({heroId:107,equipment:equip,send}),/等级不足/);
});
