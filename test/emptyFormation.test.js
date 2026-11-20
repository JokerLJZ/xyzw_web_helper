import test from 'node:test';
import assert from 'node:assert/strict';
import {planEmptyFormation,runEmptyFormation} from '../src/utils/emptyFormation.js';
const config={HeroConf:{301:{color:1},302:{color:1},303:{color:1},107:{color:3}}};
const make=()=>({heroes:{301:{heroId:301,star:2,level:1,battleTeamSlot:-1},302:{heroId:302,star:1,level:10,battleTeamSlot:2},303:{heroId:303,star:1,level:5,battleTeamSlot:-1},107:{heroId:107,star:0,level:1,battleTeamSlot:0}},lordWeaponId:2,petData:{unlockedSlot:8,pets:{'-1':{uId:'pet-a'},1:{uId:'pet-b'}}}});
test('先比较紫将星级，再比较等级，排除低星红将',()=>{assert.equal(planEmptyFormation(make(),config).hero.heroId,303);});
test('同星同级按ID稳定选择',()=>{const r=make();r.heroes[302].level=5;assert.equal(planEmptyFormation(r,config).hero.heroId,302);});
test('无紫将或宠物栏满时预检失败不写请求',async()=>{
 for(const kind of ['none','full']){const r=make();if(kind==='none')r.heroes={107:r.heroes[107]};else for(let i=1;i<=8;i++)r.petData.pets[i]={uId:'p'+i};
 await assert.rejects(runEmptyFormation({getRole:async()=>r,config,send:()=>assert.fail(),applyFormation:()=>assert.fail()}));}
});
function server({confirm=true}={}){const role=make(),calls=[];return {role,calls,getRole:async()=>structuredClone(role),applyFormation:async id=>{for(const h of Object.values(role.heroes))h.battleTeamSlot=h.heroId===id?0:-1;},send:async(cmd,p)=>{
 calls.push([cmd,p]);if(!confirm)return {};
 if(cmd==='lordweapon_changedefaultweapon')role.lordWeaponId=p.weaponId;
 if(cmd==='pet_load'){role.petData.pets[p.slotUId.slot]=role.petData.pets[-1];delete role.petData.pets[-1];}return {};
 }};}
test('保留一名紫将、清空其他位置，卸下玩具并将宠物移到空槽',async()=>{
 const s=server();const hero=await runEmptyFormation({...s,config});assert.equal(hero.heroId,303);
 assert.deepEqual(s.calls,[['lordweapon_changedefaultweapon',{weaponId:0}],['pet_load',{slotUId:{slot:2,uId:''}}]]);
 assert.equal(Object.values(s.role.heroes).filter(h=>h.battleTeamSlot>=0).length,1);
});
test('玩具卸下未确认立即停止，不继续卸宠物',async()=>{
 const s=server({confirm:false});await assert.rejects(runEmptyFormation({...s,config}),/玩具卸下未确认/);assert.equal(s.calls.length,1);
});
test('无玩具宠物时不发送多余写请求',async()=>{const s=server();s.role.lordWeaponId=0;delete s.role.petData.pets[-1];await runEmptyFormation({...s,config});assert.equal(s.calls.length,0);});
test('停止时不改阵容，写超时不自动重发',async()=>{
 const s=server();await assert.rejects(runEmptyFormation({...s,config,stopped:()=>true}),/停止/);assert.equal(s.calls.length,0);
 let n=0;await assert.rejects(runEmptyFormation({...s,config,send:async()=>{n++;throw Error('timeout');}}),/timeout/);assert.equal(n,1);
});
