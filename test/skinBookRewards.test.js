import test from "node:test";
import assert from "node:assert/strict";
import { planSkinBookRewards, claimSkinBookRewards } from "../src/utils/skinBookRewards.js";
const config = { SkinConf: Object.fromEntries([1,2,3,4,5].map(id => [id, { id, heroId: 107, isBook: id === 4 ? 0 : 1, bookPoint: id === 5 ? 0 : 10, skinName: `皮肤${id}` }])) };
const makeRole = () => ({ heroes: { 107: { skin: { 1: { expiration: -1 }, 2: { expiration: 999999 }, 3: { expiration: -1 }, 4: { expiration: -1 }, 5: { expiration: -1 } } } }, skinBook: { 3: true } });
test("仅永久拥有、正积分、未领取皮肤，不把临时或未拥有皮肤当可领", () => {
  assert.deepEqual(planSkinBookRewards(makeRole(), config).map(row => row.skinId), [1]);
  const role = makeRole(); role.heroes[107].skin = {};
  assert.deepEqual(planSkinBookRewards(role, config), []);
});
test("明确增量领取标记直接确认，不清空其他已领；重复运行不重复请求", async () => {
  const role = makeRole(), calls = [];
  const options = { config, getRole: async () => role, send: async (cmd, p) => { calls.push([cmd,p]); return { role: { skinBook: { 1: true } } }; } };
  assert.equal((await claimSkinBookRewards(options)).claimed, 1);
  assert.equal(role.skinBook[3], true);
  assert.equal((await claimSkinBookRewards(options)).claimed, 0);
  assert.deepEqual(calls, [["book_claimskinpoint", { skinId: 1 }]]);
});
test("超时先查询确认，不重发；查无领取标记保留失败", async () => {
  for (const accepted of [true, false]) {
    let reads = 0, sends = 0;
    const options = { config, getRole: async () => { const role = makeRole(); if (++reads > 1 && accepted) role.skinBook[1] = true; return role; },
      send: async () => { sends++; throw new Error("请求超时"); } };
    if (accepted) assert.equal((await claimSkinBookRewards(options)).claimed, 1);
    else await assert.rejects(claimSkinBookRewards(options), /请求超时/);
    assert.equal(sends, 1); assert.equal(reads, 2);
  }
});
test("只有成功码不足以确认，停止后不发请求，各账号独立", async () => {
  await assert.rejects(claimSkinBookRewards({ config, getRole: async () => makeRole(), send: async () => ({ code: 0 }) }), /未确认/);
  let stop = false;
  assert.equal((await claimSkinBookRewards({ config, getRole: async () => makeRole(), wait: async () => { stop = true; }, stopped: () => stop, send: async () => assert.fail() })).claimed, 0);
  assert.equal(planSkinBookRewards(makeRole(), config).length, 1);
});
