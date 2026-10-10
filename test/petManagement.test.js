import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHighestLevelPet, equipHighestLevelPet, activatePetBooks } from '../src/utils/petManagement.js';
const role=()=>({pet:{petUId:'old'},petData:{pets:{'-1':{uId:'old',petId:601,level:20},1:{uId:'best',petId:101,level:40}},books:{101:0,102:1,103:2,104:1},bookReward:{104:1}}});
test('佩戴以等级优先，同等级优先保留当前佩戴，非最高品质优先',()=>{
 assert.equal(selectHighestLevelPet(role()).uId,'best');const r=role();r.petData.pets[1].level=20;assert.equal(selectHighestLevelPet(r).uId,'old');
 assert.equal(selectHighestLevelPet({petData:{pets:{1:{uId:'x'},bad:{uId:'y',level:100}}}}),null);
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
