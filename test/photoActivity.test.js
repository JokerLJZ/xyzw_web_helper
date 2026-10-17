import test from "node:test";
import assert from "node:assert/strict";
import { findPhotoActivity, queryPhotoExchange, exchangePhotoItems } from "../src/utils/photoActivity.js";
const NOW = Date.parse("2026-10-17T12:00:00+08:00");
function config() {
  const act = (id, actType, itemId) => ({ id, actType, itemId, actGroup: 2, name: "photo", start: NOW / 1000 - 1, end: NOW / 1000 + 100 });
  return { version: "photo-v1", ActFestivalConf: { 1: act(80, 36, 1), 2: act(90, 37, 1), 3: act(100, 2, 2), 4: act(110, 2, 3), 5: { ...act(120, 2, 4), actGroup: 0 } }, ExchangeActConf: { 1: { id: 101, actId: 100, rank: 1, consumeNum: 2, resourceType: 3, rewardId: 10, rewardNum: 1, limitNum: 2 }, 2: { id: 111, actId: 110, rank: 1, consumeNum: 3, resourceType: 3, rewardId: 20, rewardNum: 5, limitNum: 10 } }, ItemConf: {} };
}
function server({ timeout = false, confirm = true, stock = 10 } = {}) {
  const calls = [], record = { 100: { record: {} }, 110: { record: {} } };
  const send = async (cmd, params) => {
    calls.push([cmd, params]);
    if (cmd === "activity_get") return { activity: { commonActivityInfo: structuredClone(record) } };
    if (cmd === "role_getroleinfo") return { role: { items: { 2: { quantity: stock }, 3: { quantity: stock } } } };
    if (cmd === "activity_exchange") {
      if (timeout) throw new Error("timeout");
      if (confirm) record[params.activityId].record[params.goodsId] = params.quantity;
      return {};
    }
    throw new Error(cmd);
  };
  return { send, calls };
}
test("photo detection binds same group, name and period, expires at end", () => {
  const c = config(), event = findPhotoActivity(c, NOW);
  assert.equal(event.missions.id, 90);
  assert.deepEqual(event.shops.map(row => row.id), [100, 110]);
  assert.equal(findPhotoActivity(c, (NOW / 1000 + 100) * 1000), null);
  c.ActFestivalConf[1].id = 20300101;
  assert.equal(findPhotoActivity(c, NOW).code, 20300101);
});
test("queries both currencies and account-specific stock and limits without writes", async () => {
  const account = server();
  const snapshot = await queryPhotoExchange(account.send, config(), NOW);
  assert.deepEqual(snapshot.shops.map(shop => [shop.itemId, shop.rows[0].max]), [[2, 2], [3, 3]]);
  assert.equal((await queryPhotoExchange(server({ stock: 0 }).send, config(), NOW)).rows[0].max, 0);
  assert.ok(account.calls.every(([cmd]) => cmd !== "activity_exchange"));
});
test("only selected shop and goods are exchanged and record is confirmed", async () => {
  const account = server(), c = config(), preview = await queryPhotoExchange(account.send, c, NOW);
  await exchangePhotoItems({ ...account, config: c, preview, now: () => NOW, selection: [{ activityId: 110, goodsId: 111, quantity: 2 }] });
  assert.deepEqual(account.calls.filter(([cmd]) => cmd === "activity_exchange"), [["activity_exchange", { activityId: 110, goodsId: 111, quantity: 2 }]]);
});
test("timeout and unconfirmed writes query once without retrying", async () => {
  for (const options of [{ timeout: true }, { confirm: false }]) {
    const account = server(options), c = config(), preview = await queryPhotoExchange(account.send, c, NOW);
    await assert.rejects(exchangePhotoItems({ ...account, config: c, preview, now: () => NOW, selection: [{ activityId: 100, goodsId: 101, quantity: 1 }] }), /不自动重试/);
    assert.equal(account.calls.filter(([cmd]) => cmd === "activity_exchange").length, 1);
  }
});
test("rejects mixed shops, wrong goods, expired event and insufficient stock", async () => {
  const account = server({ stock: 1 }), c = config(), preview = await queryPhotoExchange(account.send, c, NOW);
  const context = { ...account, config: c, preview, now: () => NOW };
  await assert.rejects(exchangePhotoItems({ ...context, selection: [{ activityId: 100, goodsId: 101, quantity: 1 }, { activityId: 110, goodsId: 111, quantity: 1 }] }), /同一商店/);
  await assert.rejects(exchangePhotoItems({ ...context, selection: [{ activityId: 100, goodsId: 111, quantity: 1 }] }), /不足/);
  await assert.rejects(exchangePhotoItems({ ...context, selection: [{ activityId: 100, goodsId: 101, quantity: 1 }] }), /不足/);
  await assert.rejects(exchangePhotoItems({ ...context, now: () => NOW + 1000000, selection: [{ activityId: 100, goodsId: 101, quantity: 1 }] }), /没有可识别/);
  assert.equal(account.calls.filter(([cmd]) => cmd === "activity_exchange").length, 0);
});
test("owned skin is not offered as exchangeable", async () => {
  const c = config(), account = server();
  c.SkinConf = { 10: { heroId: 7 } };
  c.ExchangeActConf[1].resourceType = 11;
  const send = (cmd, params) => cmd === "role_getroleinfo" ? { role: { items: { 2: { quantity: 10 } }, heroes: { 7: { skin: { 10: 0 } } } } } : account.send(cmd, params);
  const snapshot = await queryPhotoExchange(send, c, NOW, 100);
  assert.equal(snapshot.rows[0].owned, true);
  assert.equal(snapshot.rows[0].max, 0);
});
