import test from 'node:test';
import assert from 'node:assert/strict';
import { isChinaMonday, runMondayResourcePurchase } from '../src/utils/mondayResourcePurchase.js';
const monday=()=>new Date('2026-10-11T16:00:00Z');
function fixture({red=50,salt=600,redCount=0,saltCount=0,fail=false}={}){
 const calls=[];const counts={6001:redCount,203:saltCount};const send=async(cmd,p)=>{calls.push({cmd,p});if(cmd==='role_getroleinfo')return {role:{items:{70001:{quantity:red},1038:{quantity:salt}}}};if(cmd==='collection_goodslist')return {storeInfo:{exchangeStoreMap:{6001:{buyNum:counts[6001]}}}};if(cmd==='legion_storegoodslist')return {buyGoods:{203:counts[203]}};if(fail)throw Error('200400');const id=p.goodsId??p.id;counts[id]+=p.goodsNum??p.num;return {};};return {calls,send,run:()=>runMondayResourcePurchase({send,now:monday})};
}
test('北京时间周一边界正确，其他日期不发送任何查询或购买',async()=>{
 assert.equal(isChinaMonday(new Date('2026-10-11T15:59:59Z')),false);assert.equal(isChinaMonday(monday()),true);assert.equal(isChinaMonday(new Date('2026-10-12T15:59:59Z')),true);assert.equal(isChinaMonday(new Date('2026-10-12T16:00:00Z')),false);
 await runMondayResourcePurchase({now:()=>new Date('2026-10-10T00:00:00Z'),send:async()=>assert.fail()});
});
test('按官方商品额度和余额兑换，参数分别使用goodsNum和num',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.calls.filter(c=>['collection_exchange','legion_storebuygoods'].includes(c.cmd)),[{cmd:'collection_exchange',p:{goodsId:6001,goodsNum:10}},{cmd:'legion_storebuygoods',p:{id:203,num:60}}]);
});
test('部分额度和不足整份资源不超买；已购满及无资源跳过',async()=>{
 const f=fixture({red:11,salt:100,redCount:9,saltCount:58});await f.run();assert.deepEqual(f.calls.filter(c=>c.p.goodsNum||c.p.num).map(c=>c.p),[{goodsId:6001,goodsNum:1},{id:203,num:2}]);
 for(const options of [{red:0,salt:0},{redCount:10,saltCount:60}]){const f=fixture(options);await f.run();assert.equal(f.calls.filter(c=>c.cmd.endsWith('exchange')||c.cmd==='legion_storebuygoods').length,0);}
});
test('操作前跨到周二停止购买；限流不重试',async()=>{
 const f=fixture();let date=monday();await runMondayResourcePurchase({send:f.send,now:()=>date,wait:async ms=>{if(ms===2500)date=new Date('2026-10-12T16:00:00Z');}});assert.equal(f.calls.some(c=>c.cmd==='collection_exchange'),false);
 const failing=fixture({fail:true});await assert.rejects(failing.run(),/200400/);assert.equal(failing.calls.filter(c=>c.cmd==='collection_exchange').length,1);
});
test('未知额度或购买未确认停止，避免重复消耗',async()=>{
 for(const unknown of [true,false]){
 let reads=0;await assert.rejects(runMondayResourcePurchase({now:monday,send:async cmd=>{if(cmd==='role_getroleinfo')return {role:{items:{70001:{quantity:50}}}};if(cmd==='collection_goodslist'){reads++;return unknown?{}:{storeInfo:{exchangeStoreMap:{6001:{buyNum:0}}}};}return {};}}));assert.equal(reads,unknown?1:2);
 }
});
