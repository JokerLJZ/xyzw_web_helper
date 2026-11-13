import test from 'node:test';
import assert from 'node:assert/strict';
import {findBlessingShops,queryBlessingShop,exchangeBlessingItems,loadBlessingShopCatalog} from '../src/utils/blessingShop.js';
const NOW=Date.parse('2026-11-13T12:00:00+08:00');
const config=()=>({version:'blessing-v1',ActFestivalConf:{
  1:{id:2611132,actType:35,actGroup:1,start:1794542400,end:1795103999},
  2:{id:2611133,actType:2,actGroup:1,itemId:5297,start:1794542400,end:1795121400},
  3:{id:2611136,actType:34,actGroup:1,itemId:5296,start:1794542400,end:1795121400},
  4:{id:99,actType:2,actGroup:0,start:1794542400,end:1795121400}},
 ExchangeActConf:{1:{id:261113301,actId:2611133,rank:1,consumeNum:5,resourceType:3,rewardId:1022,rewardNum:5000,limitNum:10,unlockNeed:0},
 2:{id:261113304,actId:2611133,rank:4,consumeNum:5,resourceType:3,rewardId:1023,rewardNum:8,limitNum:10,unlockNeed:50},
 3:{id:261113601,actId:2611136,rank:1,consumeNum:20,resourceType:3,rewardId:37021,rewardNum:10,limitNum:5,unlockNeed:0}}});
function server({stock=100,used=0,timeout=false,confirm=true}={}){
 const calls=[],record={2611133:{record:{261113301:used}},2611136:{record:{}}};
 return {calls,send:async(cmd,p)=>{
 calls.push([cmd,p]);
 if(cmd==='activity_get')return {activity:{commonActivityInfo:structuredClone(record)}};
 if(cmd==='role_getroleinfo')return {role:{items:{5297:{quantity:stock},5296:{quantity:stock}}}};
 if(cmd==='activity_exchange'){if(timeout)throw Error('timeout');if(confirm){record[p.activityId].record[p.goodsId]=(record[p.activityId].record[p.goodsId]||0)+p.quantity;stock-=p.quantity*(p.activityId===2611136?20:5);}return {};}
 throw Error(cmd);
 }};
}
const preview={shops:[{activityId:2611133},{activityId:2611136}]};
test('按本期分组识别商店，第二商店仅抽奖结束后开放，截止时间后不可兑换',()=>{
 assert.deepEqual(findBlessingShops(config(),NOW).shops.map(s=>s.id),[2611133]);
 assert.deepEqual(findBlessingShops(config(),1795103999000).shops.map(s=>s.id),[2611133,2611136]);
 assert.equal(findBlessingShops(config(),1795121400000),null);
});
test('公共清单无需连接账号，保留真实商品ID与价格',async()=>{
 const c=config(),urls=[];
 const f=async(url)=>{urls.push(url);return {ok:true,json:async()=>url.includes('manifest')?{body:{dataBundleVer:'blessing-catalog-test'}}:url.endsWith('language.json')?{}:c};};
 const catalog=await loadBlessingShopCatalog(f,NOW);
 assert.equal(catalog.shops.length,1);assert.equal(catalog.rows[0].id,261113301);assert.equal(catalog.rows[0].consumeNum,5);
 assert.ok(urls.every(url=>!url.includes('role_')));
});
test('每账号库存、限购与累计消耗解锁独立计算',async()=>{
 const c=config();const poor=await queryBlessingShop(server({stock:4}).send,c,NOW,2611133);
 assert.equal(poor.rows[0].max,0);assert.equal(poor.rows[1].locked,true);
 const spent=await queryBlessingShop(server({used:10}).send,c,NOW,2611133);
 assert.equal(spent.rows[0].max,0);assert.equal(spent.rows[1].locked,false);
});
test('只兑换所选份数且确认记录，未选商品不发送',async()=>{
 const s=server();await exchangeBlessingItems({...s,config:config(),preview,now:()=>NOW,selection:[{activityId:2611133,goodsId:261113301,quantity:2}]});
 assert.deepEqual(s.calls.filter(x=>x[0]==='activity_exchange'),[['activity_exchange',{activityId:2611133,goodsId:261113301,quantity:2}]]);
});
test('库存不足或未解锁跳过，不消耗道具',async()=>{
 const s=server({stock:4});await exchangeBlessingItems({...s,config:config(),preview,skipUnavailable:true,now:()=>NOW,selection:[{activityId:2611133,goodsId:261113301,quantity:1},{activityId:2611133,goodsId:261113304,quantity:1}]});
 assert.equal(s.calls.filter(x=>x[0]==='activity_exchange').length,0);
});
for(const options of [{timeout:true},{confirm:false}])test(`结果不确定时查询并停止，不重发 ${JSON.stringify(options)}`,async()=>{
 const s=server(options);await assert.rejects(exchangeBlessingItems({...s,config:config(),preview,now:()=>NOW,selection:[{activityId:2611133,goodsId:261113301,quantity:1}]}),/不自动重试/);
 assert.equal(s.calls.filter(x=>x[0]==='activity_exchange').length,1);
});
test('拒绝混合商店、错误商品、非整数份数、未开放商店和过期清单',async()=>{
 const s=server(),ctx={...s,config:config(),preview,now:()=>NOW};
 for(const selection of [[{activityId:2611133,goodsId:261113301,quantity:1},{activityId:2611136,goodsId:261113601,quantity:1}],
 [{activityId:2611133,goodsId:99,quantity:1}],[{activityId:2611133,goodsId:261113301,quantity:1.5}],
 [{activityId:2611136,goodsId:261113601,quantity:1}]])await assert.rejects(exchangeBlessingItems({...ctx,selection}));
 await assert.rejects(exchangeBlessingItems({...ctx,now:()=>1795121400000,selection:[{activityId:2611133,goodsId:261113301,quantity:1}]}));
 assert.equal(s.calls.filter(x=>x[0]==='activity_exchange').length,0);
});
