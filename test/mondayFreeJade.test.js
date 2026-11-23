import test from 'node:test';
import assert from 'node:assert/strict';
import { runMondayFreeJade } from '../src/utils/mondayFreeJade.js';
const now=Date.parse('2026-11-23T12:00:00+08:00');
const pack={id:17,moduleType:10055,packSet:6,buyOrder:0,price:0,paymentType:0,limit:1,merchandise:[{type:3,itemId:1022,value:100}]};
const claimed={statistics:{'night:mare:buy:17':1},statisticsTime:{'night:mare:buy:17':now/1000}};
test('Monday claims free jade and confirms account statistics',async()=>{
 let reads=0,calls=0;const result=await runMondayFreeJade({now,packs:[pack],getRole:async()=>++reads===1?{}:claimed,claim:async id=>{assert.equal(id,17);calls++}});
 assert.equal(result.status,'completed');assert.equal(calls,1);
});
test('already claimed and non Monday never send',async()=>{
 for(const date of [now,now+86400000]) assert.equal((await runMondayFreeJade({now:date,packs:[pack],getRole:async()=>claimed,claim:()=>assert.fail()})).status,'skipped');
});
test('timeout queries status without retrying',async()=>{
 let calls=0; const result=await runMondayFreeJade({now,packs:[pack],getRole:async()=>({}),claim:async()=>{calls++;throw Error('timeout')}});
 assert.equal(result.status,'pending');assert.equal(calls,1);
});
test('paid or changed rewards fail closed',async()=>{
 await assert.rejects(runMondayFreeJade({now,packs:[{...pack,price:1}],claim:()=>assert.fail()}));
});
