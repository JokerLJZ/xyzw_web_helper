import test from 'node:test';
import assert from 'node:assert/strict';
import {getBlessingDrawTimes,getBlessingLotteryItemId} from '../src/utils/blessingLottery.js';
test('按本期配置读取道具ID，不使用旧玄武道具',()=>{
 assert.equal(getBlessingLotteryItemId({ActFestivalConf:{2611132:{actType:35,itemId:5295}}},2611132),5295);
 assert.throws(()=>getBlessingLotteryItemId({},2611132));
});
test('库存和剩余额度均足够才十连，余量单抽，无库存不发请求',()=>{
 const role=n=>({items:{5295:{quantity:n},5283:{quantity:999}}});
 for(const [stock,left,expected] of [[50,50,10],[10,50,10],[9,50,1],[10,9,1],[0,50,0],[100,0,0]])assert.equal(getBlessingDrawTimes(role(stock),5295,left),expected);
 assert.equal(getBlessingDrawTimes({items:{5283:{quantity:100}}},5295,50),0);
 assert.throws(()=>getBlessingDrawTimes({},5295,50));
});
test('50个只需5次十连，53个达到上限后剩3个；16个为十连加6次单抽',()=>{
 for(const initial of [16,50,53]){
 let stock=initial,count=0,calls=[];
 while(true){const times=getBlessingDrawTimes({items:{5295:{quantity:stock}}},5295,50-count);if(!times)break;calls.push(times);count+=times;stock-=times;}
 assert.equal(count,Math.min(initial,50));assert.equal(stock,Math.max(0,initial-50));
 assert.deepEqual(calls,initial===16?[10,1,1,1,1,1,1]:[10,10,10,10,10]);
 }
});
