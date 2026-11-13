import test from 'node:test';
import assert from 'node:assert/strict';
import {loadXuanwuActivityConfig,getClaimableXuanwuMissions} from '../src/utils/xuanwuActivityConfig.js';
test('任务必须达到配置门槛，排除其他活动与已领任务',()=>{
 const config={BattlePassMissionConf:[{id:1,actId:9,completeValue:10},{id:2,actId:9,completeValue:5},{id:3,actId:8,completeValue:1}]};
 assert.deepEqual(getClaimableXuanwuMissions(config,9,{complete:{1:9,2:5,3:5}}).map(t=>t.id),[2]);
 assert.deepEqual(getClaimableXuanwuMissions(config,9,{complete:{1:10,2:5},taskClaimed:{2:true}}).map(t=>t.id),[1]);
 assert.throws(()=>getClaimableXuanwuMissions(config,7,{}),/未找到/);
});
test('同版本并发只下载一次，版本变化重新获取',async()=>{
 let downloads=0;const fetcher=async()=>{downloads++;return {ok:true,json:async()=>({BattlePassMissionConf:{}})};};
 const send=async()=>({dataBundleVer:'a'});
 await Promise.all([loadXuanwuActivityConfig(send,fetcher),loadXuanwuActivityConfig(send,fetcher)]);
 assert.equal(downloads,1);
 await loadXuanwuActivityConfig(async()=>({dataBundleVer:'b'}),fetcher);assert.equal(downloads,2);
});
test('配置下载失败不污染缓存',async()=>{
 let n=0;const f=async()=>{if(++n===1)throw Error('network');return {ok:true,json:async()=>({})};};
 const send=async()=>({dataBundleVer:'a'});
 await assert.rejects(loadXuanwuActivityConfig(send,f));await loadXuanwuActivityConfig(send,f);assert.equal(n,2);
});
