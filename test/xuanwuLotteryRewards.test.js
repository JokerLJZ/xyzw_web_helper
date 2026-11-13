import test from 'node:test';
import assert from 'node:assert/strict';
import { getLotteryCumulativeTiers, getNextUnclaimedLotteryCumulativeId, createLotteryCumulativeClaimer } from '../src/utils/xuanwuLotteryRewards.js';
const rows = [{ id: 1, actId: 2609192, cumulativeNum: 5 }, ...[68,69,70,71].map((id,i) => ({ id, actId:2611132, cumulativeNum:(i+1)*5 }))];
const tiers = getLotteryCumulativeTiers({ cumulativeDrawConf: rows }, 2611132);
test('按当期配置和次数选择真实ID，缺领取记录不绕过门槛', () => {
  assert.equal(getNextUnclaimedLotteryCumulativeId({lotteryNum:0},tiers),null);
  assert.equal(getNextUnclaimedLotteryCumulativeId({lotteryNum:16},tiers),68);
  assert.equal(getNextUnclaimedLotteryCumulativeId({lotteryNum:16,cumulativeClaimedMap:{68:true,69:true}},tiers),70);
});
const setup = (mode) => {
  const calls=[], errors=[], map={};
  const claim = createLotteryCumulativeClaimer({actId:2611132,shouldStop:()=>false,onClaim:()=>{},onError:e=>errors.push(e),
    fetchConfig:async()=>({ok:true,json:async()=>({cumulativeDrawConf:rows})}),
    send:async(cmd,p)=>{
      calls.push([cmd,p]);
      if(cmd==='system_getdatabundlever')return {dataBundleVer:'current'};
      if(cmd==='activity_getlotteryinfo')return {lotteryInfo:{lotteryNum:16,cumulativeClaimedMap:{...map}}};
      if(mode==='error')throw Error('配置错误');
      if(mode!=='unconfirmed')map[p.id]=true;
      return {reward:[{type:3,itemId:5283,value:1}]};
    }});
  return {claim,calls,errors};
};
test('16抽只领68至70，查询确认后计数，后续轮次不重复',async()=>{
  const s=setup(); assert.equal(await s.claim(),3);assert.equal(await s.claim(),0);
  assert.deepEqual(s.calls.filter(x=>x[0]==='activity_claimlotterycumulative').map(x=>x[1].id),[68,69,70]);
  assert.equal(s.errors.length,0);
});
for(const mode of ['error','unconfirmed'])test(`${mode}后同一次任务不重试且不虚报成功`,async()=>{
 const s=setup(mode);assert.equal(await s.claim(),0);assert.equal(await s.claim(),0);
 assert.equal(s.calls.filter(x=>x[0]==='activity_claimlotterycumulative').length,1);assert.equal(s.errors.length,1);
});
test('停止时不发请求',async()=>{
 const claim=createLotteryCumulativeClaimer({shouldStop:()=>true,send:()=>assert.fail()});assert.equal(await claim(),0);
});

test('领取增量有lotteryInfo但缺少标记时重新查询确认',async()=>{
 let queries=0, received=false;
 const claim=createLotteryCumulativeClaimer({actId:1,config:{cumulativeDrawConf:[{id:8,actId:1,cumulativeNum:5}]},
 shouldStop:()=>false,onClaim:()=>{},onError:()=>assert.fail('应查询确认'),send:async(cmd)=>{
 if(cmd==='activity_getlotteryinfo'){queries++;return {lotteryInfo:{lotteryNum:5,cumulativeClaimedMap:received?{8:true}:{}}};}
 received=true;return {lotteryInfo:{fragProgress:5},reward:[]};
 }});
 assert.equal(await claim(),1);assert.equal(queries,2);
});
