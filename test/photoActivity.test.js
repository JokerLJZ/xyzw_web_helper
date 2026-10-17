import test from "node:test";
import assert from "node:assert/strict";
import { findPhotoActivity, queryPhotoExchange, exchangePhotoItems, photoState, runPhotoStandard } from "../src/utils/photoActivity.js";
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

function photoServer(options = {}) {
  const c = config();
  c.PhotoConf = { 1: { id: 800, actId: 80, rank: 1 } };
  c.PhotoPieceConf = { 1: { id: 11, actId: 80, PhotoId: 800, pieceIndex: 1, progressNeed: 2, reward: [1] }, 2: { id: 12, actId: 80, PhotoId: 800, pieceIndex: 2, progressNeed: 2, reward: [1] } };
  c.BattlePassMissionConf = { 1: { id: 901, actId: 90, rank: 1, periodType: 1, completeValue: 1 }, 2: { id: 902, actId: 90, rank: 2, periodType: 11, completeValue: 3 } };
  const activity = { photoActivityInfo: { 80: {} }, warOrderActivityInfo: { 90: { dailyTime: NOW / 1000, sevenTime: NOW / 1000, complete: { 901: 1, 902: 3 }, taskClaimed: {} } } };
  let stock = options.stock ?? 0;
  const calls = [];
  const send = async (cmd, params) => {
    calls.push([cmd, params]);
    if (cmd === "activity_get") return { activity: structuredClone(activity) };
    if (cmd === "activity_warorderget") return {};
    if (cmd === "role_getroleinfo") return { role: { items: { 1: { quantity: stock } } } };
    if (options.fail === cmd) throw new Error("timeout");
    if (cmd === "activity_warordertaskclaim") {
      activity.warOrderActivityInfo[90].taskClaimed[params.missionId] = true;
      stock += params.missionId === 901 ? 1 : 3;
    } else if (cmd === "activity_photo") {
      stock -= params.num;
      if (!options.noProgress) activity.photoActivityInfo[80] = { pieceId: params.pieceId, num: (activity.photoActivityInfo[80].num || 0) + params.num };
    } else if (cmd === "activity_claimphotoreward") {
      activity.photoActivityInfo[80] = { pieceId: params.pieceId === 11 ? 12 : -1 };
    } else throw new Error(cmd);
    return {};
  };
  return { config: c, activity, send, calls, now: () => NOW };
}
test("claims daily and periodic film, fills only current piece then claims all rewards", async () => {
  const account = photoServer();
  const result = await runPhotoStandard(account);
  assert.deepEqual(result, { status: "completed", claimedTasks: 2, usedFilm: 4, claimedRewards: 2 });
  assert.deepEqual(account.calls.filter(([cmd]) => ["activity_photo", "activity_claimphotoreward"].includes(cmd)), [
    ["activity_photo", { activityId: 80, num: 2, pieceId: 11 }],
    ["activity_claimphotoreward", { activityId: 80, pieceId: 11 }],
    ["activity_photo", { activityId: 80, num: 2, pieceId: 12 }],
    ["activity_claimphotoreward", { activityId: 80, pieceId: 12 }],
  ]);
  account.calls.length = 0;
  assert.equal((await runPhotoStandard(account)).usedFilm, 0);
  assert.ok(account.calls.every(([cmd]) => !["activity_photo", "activity_claimphotoreward", "activity_warordertaskclaim"].includes(cmd)));
});
test("partial film stops at stock, while existing completed piece is claimed before consuming", async () => {
  const account = photoServer({ stock: 1 });
  account.activity.warOrderActivityInfo[90].complete = {};
  account.activity.photoActivityInfo[80] = { pieceId: 11, num: 2 };
  const result = await runPhotoStandard(account);
  assert.equal(result.claimedRewards, 1);
  assert.equal(result.usedFilm, 1);
  const writes = account.calls.filter(([cmd]) => ["activity_photo", "activity_claimphotoreward"].includes(cmd));
  assert.equal(writes[0][0], "activity_claimphotoreward");
  assert.equal(writes[1][1].pieceId, 12);
});
test("expired daily and four-day periodic records do not trigger claims", async () => {
  const account = photoServer();
  account.activity.warOrderActivityInfo[90].dailyTime -= 86400;
  account.activity.warOrderActivityInfo[90].sevenTime -= 4 * 86400;
  assert.equal((await runPhotoStandard(account)).claimedTasks, 0);
  assert.ok(account.calls.every(([cmd]) => cmd !== "activity_warordertaskclaim"));
});
test("write timeouts query state but never retry or continue consuming", async () => {
  for (const fail of ["activity_warordertaskclaim", "activity_photo", "activity_claimphotoreward"]) {
    const account = photoServer({ stock: 2, fail });
    if (fail !== "activity_warordertaskclaim") account.activity.warOrderActivityInfo[90].complete = {};
    if (fail === "activity_claimphotoreward") account.activity.photoActivityInfo[80] = { pieceId: 11, num: 2 };
    await assert.rejects(runPhotoStandard(account), /不自动重试/);
    assert.equal(account.calls.filter(([cmd]) => cmd === fail).length, 1);
    assert.equal(account.calls.at(-1)[0], "activity_get");
  }
});
test("unconfirmed film progress prevents another consumption", async () => {
  const account = photoServer({ stock: 10, noProgress: true });
  account.activity.warOrderActivityInfo[90].complete = {};
  await assert.rejects(runPhotoStandard(account), /进度未确认/);
  assert.equal(account.calls.filter(([cmd]) => cmd === "activity_photo").length, 1);
});
test("protocol defaults initialize first piece, explicit invalid structures are rejected", () => {
  const account = photoServer(), event = findPhotoActivity(account.config, NOW), pieces = Object.values(account.config.PhotoPieceConf);
  assert.equal(photoState({ activity: {} }, event, pieces).piece.id, 11);
  assert.equal(photoState({ activity: { photoActivityInfo: { 80: { pieceId: -1 } } } }, event, pieces).finished, true);
  assert.throws(() => photoState({}, event, pieces), /快照/);
  assert.throws(() => photoState({ activity: { photoActivityInfo: null } }, event, pieces), /格式异常/);
  assert.throws(() => photoState({ activity: { photoActivityInfo: { 80: { num: null } } } }, event, pieces), /格式异常/);
  assert.throws(() => photoState({ activity: { photoActivityInfo: { 80: { pieceId: 999 } } } }, event, pieces), /不匹配/);
});
