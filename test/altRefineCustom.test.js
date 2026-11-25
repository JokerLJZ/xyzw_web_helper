import test from "node:test";
import assert from "node:assert/strict";
import { runAltAccountRefine } from "../src/utils/altAccountRefine.js";
import { normalizeAltRefinePolicy } from "../src/utils/altRefinePolicy.js";
const item = (...attrs) => ({level:4000,quenches:Object.fromEntries(attrs.map((attrId,i)=>[i+1,{attrId,colorId:6}]))});
const policy = n => normalizeAltRefinePolicy({altRefineCustom:true,altRefineAttrs:[1,9],altRefineMinColor:5,altRefineCountEnabled:true,altRefineCount:n,altRefineCountAttr:9});
const response = (p,e) => ({role:{heroes:{107:{equipment:{[p]:e}}}}});
function options(equipment,n=2) {
 const calls=[];
 return {calls, args:{equipment,heroId:107,policy:policy(n),jadeQuantity:100000,quenchCost:100,limit:10,
 send:async(cmd,p)=>{calls.push({cmd,p});return cmd==='equipment_confirm'?response(p.part,{seed:123}):response(p.part,item(9));}}};
}
test("一件多条减伤只算一件，补足至少两件装备且不改已有减伤装备",async()=>{
 const f=options({1:item(9,9),2:item(1),3:item(1),4:item(1)});
 const r=await runAltAccountRefine(f.args);
 assert.equal(r.reason,'completed');assert.equal(r.count,1);assert.equal(r.requiredEquipmentCount,2);
 assert.deepEqual(f.calls.filter(c=>c.cmd==='equipment_quench').map(c=>c.p.part),[2]);
 assert.ok(f.calls.every(c=>!c.cmd.includes('lock')));
});
test("自定义关闭数量要求时四件基础达标即停，不再强制补减伤",async()=>{
 const f=options({1:item(1),2:item(1),3:item(1),4:item(1)});f.args.policy.countEnabled=false;
 assert.equal((await runAltAccountRefine(f.args)).count,0);assert.equal(f.calls.length,0);
});
test("数量要求四件均减伤，逐件独立追指定属性，达到后停止",async()=>{
 const f=options({1:item(9),2:item(1),3:item(1),4:item(1)},4);
 const r=await runAltAccountRefine(f.args);assert.equal(r.count,3);assert.equal(r.requiredEquipmentCount,4);
});
test("预算耗尽不宣称数量达标，锁孔不消耗彩玉",async()=>{
 const f=options({1:item(1),2:item(1),3:item(1),4:item(1)},4);f.args.limit=1;
 const r=await runAltAccountRefine(f.args);assert.equal(r.reason,'limit');assert.equal(r.requiredEquipmentCount,1);
 const g=options({1:item(1),2:item(1),3:item(1),4:item(1)});g.args.equipment[1].quenches[1].isLocked=true;
 await assert.rejects(runAltAccountRefine(g.args),/锁定/);assert.equal(g.calls.length,0);
});
