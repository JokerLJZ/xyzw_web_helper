import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHighestLevelPet, equipHighestLevelPet, activatePetBooks } from '../src/utils/petManagement.js';
const role=()=>({pet:{petUId:'old'},petData:{pets:{'-1':{uId:'old',petId:101,level:20},1:{uId:'best',petId:602,level:40}},books:{101:0,102:1,103:2,104:1},bookReward:{104:1}}});
test('品质优先于等级和技能属性，同品质破甲优先、其次格挡', () => {
 const pick = pets => selectHighestLevelPet({petData:{pets}})?.uId;
 assert.equal(pick({1:{uId:'gold',petId:703,level:1},2:{uId:'red',petId:602,level:200}}),'gold');
 assert.equal(pick({1:{uId:'armor',petId:602,level:1},2:{uId:'block',petId:601,level:200}}),'armor');
 assert.equal(pick({1:{uId:'block',petId:601,level:1},2:{uId:'other',petId:604,level:200}}),'block');
 assert.equal(pick({1:{uId:'blue',petId:301,level:1},2:{uId:'other',petId:303,level:40}}),'blue');
 assert.equal(pick({1:{uId:'purple',petId:403,level:1},2:{uId:'block',petId:401,level:50}}),'purple');
 assert.equal(pick({1:{uId:'orange',petId:503,level:1},2:{uId:'block',petId:502,level:50}}),'orange');
 assert.equal(pick({1:{uId:'gold',petId:702,level:1},2:{uId:'block',petId:701,level:50}}),'gold');
});
test('同品质同属性比较等级，再保留当前佩戴；忽略未知或无效宠物，不取精炼词条', () => {
 const r=role();r.petData.pets[-1].petId=602;
 assert.equal(selectHighestLevelPet(r).uId,'best');r.petData.pets[1].level=20;
 assert.equal(selectHighestLevelPet(r).uId,'old');
 assert.equal(selectHighestLevelPet({petData:{pets:{1:{uId:'x'},bad:{uId:'y',level:100},2:{uId:'unknown',petId:999,level:100}}}}),null);
 r.petData.pets[1]={uId:'quench',petId:604,level:100,quenches:{1:{attrs:[{attrId:5,value:100}],color:6}}};
 assert.equal(selectHighestLevelPet(r).uId,'old');
});
test('佩戴使用game中的pet_load槽位编号并查询确认，不重复装备已佩戴宠物',async()=>{
 let r=role();const calls=[];const result=await equipHighestLevelPet({getRole:async()=>r,send:async(cmd,p)=>{calls.push({cmd,p});r={...r,petData:{...r.petData,pets:{'-1':r.petData.pets[1]}}};}});
 assert.equal(result.changed,true);assert.deepEqual(calls,[{cmd:'pet_load',p:{slotUId:{slot:1,uId:'best'}}}]);
 const after=await equipHighestLevelPet({getRole:async()=>r,send:async()=>assert.fail()});assert.equal(after.changed,false);
});
test('图鉴按game状态激活并领奖，跳过未解锁和已领奖，保留增量之外状态',async()=>{
 let r=role();const calls=[];
 const result=await activatePetBooks({getRole:async()=>structuredClone(r),send:async(cmd,{petId})=>{calls.push([cmd,petId]);const key=cmd==='pet_activatebook'?'books':'bookReward';r.petData[key][petId]=1;return {_raw:{body:{role:{petData:{[key]:{[petId]:1}}}}}};}});
 assert.deepEqual(calls,[['pet_activatebook',101],['pet_claimbookreward',101],['pet_claimbookreward',102]]);assert.deepEqual(result,{activated:1,claimed:2});
});
test('接口未确认成功、限流、停止时不重试、不发送下一次操作',async()=>{
 const r=role();let count=0;await assert.rejects(activatePetBooks({getRole:async()=>r,send:async()=>{count++;return {};}}));assert.equal(count,1);
 count=0;await assert.rejects(equipHighestLevelPet({getRole:async()=>r,send:async()=>{count++;throw Error('200400');}}),/200400/);assert.equal(count,1);
 let stop=false;await equipHighestLevelPet({getRole:async()=>r,wait:async()=>{stop=true;},shouldStop:()=>stop,send:async()=>assert.fail()});
});
test('图鉴激活不修改宠物、物品或发送本体升星命令',async()=>{
 const r=role();const before=structuredClone(r.petData.pets);await activatePetBooks({getRole:async()=>r,send:async(cmd,{petId})=>{assert.ok(['pet_activatebook','pet_claimbookreward'].includes(cmd));const key=cmd==='pet_activatebook'?'books':'bookReward';r.petData[key][petId]=1;return {role:{petData:{[key]:{[petId]:1}}}};}});assert.deepEqual(r.petData.pets,before);
});
test('未升级紫宠等级为0或省略等级仍可佩戴，异常等级仍排除', async () => {
 for (const level of [0, undefined]) {
  let r = {petData:{pets:{0:{uId:'purple',petId:403,...(level === undefined ? {} : {level})}}}};
  const result = await equipHighestLevelPet({getRole:async()=>r,send:async(cmd,params)=>{
   assert.equal(cmd,'pet_load');assert.deepEqual(params,{slotUId:{slot:0,uId:'purple'}});
   r={petData:{pets:{'-1':r.petData.pets[0]}}};
  }});
  assert.equal(result.changed,true);assert.equal(result.target.level,0);
 }
 for (const level of [-1, '1', NaN, 1.5]) assert.equal(selectHighestLevelPet({petData:{pets:{0:{uId:'bad',petId:403,level}}}}),null);
});
test('佩戴后回收其他高等级宠物脆饼，再持续升级，保留锁定和1级宠物',async()=>{
 const {concentratePetExperience}=await import('../src/utils/petManagement.js');
 let r={petData:{pets:{'-1':{uId:'wear',level:0,exp:0},0:{uId:'reset',level:20},1:{uId:'keep',level:1},2:{uId:'lock',level:20,isLocked:true},3:{uId:'quenchlock',level:30,quenches:{1:{locked:true}}}}},items:{15001:{quantity:0}}};
 const calls=[];
 const result=await concentratePetExperience({getRole:async()=>structuredClone(r),send:async(cmd,p)=>{
  calls.push([cmd,p]);if(cmd==='pet_reset'){r.petData.pets[0].level=0;r.items[15001].quantity=10;}
  else {r.petData.pets[-1].level+=10;r.items[15001].quantity-=5;}
 }});
 assert.deepEqual(result,{reset:1,upgrades:2,stopped:false});assert.deepEqual(calls[0],['pet_reset',{slotUId:{slot:0,uId:'reset'}}]);
 assert.equal(r.petData.pets[-1].level,20);
});
test('回收未确认、库存缺失或停止不会继续消耗',async()=>{
 const {concentratePetExperience}=await import('../src/utils/petManagement.js');
 const r={petData:{pets:{'-1':{uId:'wear',level:0},0:{uId:'reset',level:2}}},items:{}};
 let count=0;await assert.rejects(concentratePetExperience({getRole:async()=>r,send:async()=>{count++;}}),/未确认/);assert.equal(count,1);
 await concentratePetExperience({getRole:async()=>r,shouldStop:()=>true,send:async()=>assert.fail()});
 await assert.rejects(concentratePetExperience({getRole:async()=>({...r,items:undefined}),send:async()=>assert.fail()}),/库存/);
});
