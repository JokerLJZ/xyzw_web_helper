import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { loadOfficialTaskConfig } from '../src/utils/officialTaskConfig.js';
import { officialConfigFetch } from './officialConfigFixture.js';
import { bon } from '../src/utils/bonProtocol.js';

test('binary configuration uses native index, shares concurrent reads and rejects mismatching content', async () => {
  let reads = 0;
  const fetcher = async (...args) => { reads++; return officialConfigFetch('binary-test', { HeroConf: { 1: { color: 1 } }, WeaponConf: { 2: {} } })(...args); };
  const [a,b] = await Promise.all([loadOfficialTaskConfig('binary-test', fetcher, {binary:true}),loadOfficialTaskConfig('binary-test',fetcher,{binary:true})]);
  assert.equal(a,b);
  assert.equal(a.HeroConf[1].color,1);
  assert.equal(reads,6);
  const invalid = async (url,...args) => url.endsWith('.binary.bin') ? {ok:true,arrayBuffer:async()=>bon.encode({COMMIT_ID:'old'}).buffer} : officialConfigFetch('binary-mismatch',{})(url,...args);
  await assert.rejects(loadOfficialTaskConfig('binary-mismatch', invalid, {binary:true}), /版本不一致/);
});

test('business configuration loaders must not introduce data direct links or pin manifest versions', async () => {
  async function scan(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const path=dir+'/'+entry.name;
      if(entry.isDirectory()) await scan(path);
      else if(/\.(js|ts)$/.test(path) && !path.endsWith('/officialTaskConfig.js')) {
        const source=await readFile(path,'utf8');
        assert.ok(!/https:\/\/xxz-xyzw[^`"'\s]*\/data\//.test(source),path+' contains old config direct link');
        assert.ok(!/manifest\?platform=hortor&version=0\./.test(source),path+' pins manifest client version');
      }
    }
  }
  await scan(new URL('../src/utils',import.meta.url).pathname);
});

test('concurrent JSON and language requests share one manifest but failures remain retryable', async () => {
  let manifests=0;
  let fail=true;
  const fixture=officialConfigFetch('shared-manifest',{});
  const fetcher=async(url,...args)=>{
    if(url.includes('manifest?')) { manifests++; if(fail) return {ok:false,status:503}; }
    return fixture(url,...args);
  };
  await assert.rejects(loadOfficialTaskConfig('shared-manifest',fetcher),/503/);
  fail=false;
  await Promise.all([loadOfficialTaskConfig('shared-manifest',fetcher),loadOfficialTaskConfig('shared-manifest',fetcher,{language:true})]);
  assert.equal(manifests,2);
});

test('gameTables JSON refuses level or language versions from another release', async () => {
  for (const name of ['level', 'language']) {
    const fetcher = officialConfigFetch('gameTables-check-'+name, {}, {}, name === 'language' ? {COMMIT_ID:'other'} : {}, false, name === 'level' ? {COMMIT_ID:'other'} : {});
    await assert.rejects(loadOfficialTaskConfig('gameTables-check-'+name, fetcher, {gameTables:true}), /版本不一致/);
  }
});
