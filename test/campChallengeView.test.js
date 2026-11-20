import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCampMap,getAttendanceMembers,getAttendanceDate} from '../src/utils/campChallengeView.js';

test('沙盘固定三区各10位置，空位不挤占相邻位置',()=>{
 const raw={1:{roleId:101},11:{roleId:102},30:{roleId:103}};
 const map=buildCampMap([{id:101,slot:1},{id:102,slot:11},{id:103,slot:30}],raw);
 assert.equal(map.positionsConfirmed,true);assert.deepEqual(map.regions.map(r=>r.slots.length),[10,10,10]);
 assert.equal(map.regions[0].slots[1].member,null);assert.equal(map.regions[1].slots[0].member.id,102);assert.equal(map.regions[2].slots[9].member.id,103);
 assert.deepEqual(map.regions.map(r=>r.emptyCount),[9,9,9]);
});
test('区域缺刀基于成功攻击次数计算，已击破和空位不计',()=>{
 const members=[{id:101,slot:1,challengeCnt:5,failCnt:2},{id:102,slot:2,challengeCnt:4,failCnt:0},{id:103,slot:3,defeated:true}];
 const map=buildCampMap(members,{1:{roleId:101},2:{roleId:102},3:{roleId:103}});
 assert.deepEqual(map.regions[0].remainingAttacks,{hard:0,inferno:1,defeat:3});assert.equal(map.regions[0].defeatedCount,1);
});
test('角色ID键沿既有顺序定位，显式nodeId优先，重复或无效位置不伪装成空位',()=>{
 const sequential=buildCampMap([{id:101,slot:101},{id:102,slot:102}],{101:{roleId:101},102:{roleId:102}});
 assert.equal(sequential.positionsConfirmed,true);assert.equal(sequential.regions[0].slots[0].member.id,101);
 const explicit=buildCampMap([{id:101,slot:101}],{101:{roleId:101,nodeId:22}});assert.equal(explicit.regions[2].slots[1].member.id,101);
 const invalid=buildCampMap([{id:101,slot:0},{id:102,slot:31}]);assert.equal(invalid.positionsConfirmed,false);
 const duplicate=buildCampMap([{id:101,slot:1},{id:102,slot:1}]);assert.equal(duplicate.positionsConfirmed,false);assert.equal(duplicate.regions[0].slots[0].member,null);
});
test('督战排除镜像并按角色去重，营地和PVP战力保持分离，缺失PVP不填0',()=>{
 const result=getAttendanceMembers([{id:1,power:100,realAttackCnt:0},{id:1,power:200},{id:2,mirror:true},{id:3,power:300}],{},{1:{roleId:1,power:900}});
 assert.equal(result.length,2);assert.equal(result[0].power,100);assert.equal(result[0].clubPower,900);assert.equal(result[0].realAttackCnt,0);assert.equal(result[1].clubPower,null);
});
test('比赛日期按北京时间及phase周一计算，历史日不误标今日',()=>{
 const now=Date.parse('2026-11-10T16:30:00Z');
 assert.equal(getAttendanceDate('261109',3,now).isToday,true);assert.match(getAttendanceDate('261109',2,now).label,/2026-11-10/);
 assert.equal(getAttendanceDate('261109',2,now).isToday,false);assert.match(getAttendanceDate('bad',3,now).label,/日期未确定/);assert.match(getAttendanceDate('261110',3,now).label,/日期未确定/);
});
