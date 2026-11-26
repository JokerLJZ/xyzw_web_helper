import test from "node:test";
import assert from "node:assert/strict";
import { runLegacyFullGift } from "../src/utils/legacyFullGift.js";

function fixture() {
  const config = {
    LegacyConstant: { createLegacyConsume: { itemId: 37007 }, giftDustMaxAmountOnce: 60 },
    LegacyGiftTaskConf: {
      1: { Id: 1, legacyRefreshType: 3, legacyTaskType: 4, taskShow: 1, giftDreamDustReward: [100] },
      2: { Id: 2, legacyRefreshType: 3, legacyTaskType: 4, taskShow: 1, giftDreamDustReward: [80] },
      3: { Id: 3, legacyRefreshType: 3, legacyTaskType: 5, taskShow: 10, giftDreamDustReward: [500] },
    },
    LegacyGiftConf: { 1: { vipLevel: 0, giftDustMax: 20 } },
    LegacyScheduleConf: { 1: { id: 1, legacyStart: 100, legacyEnd: 200 } },
    LegacyChargeReward: { 1: { vipSpend: 0, giftIfUnlock: 0 }, 2: { vipSpend: 20, giftIfUnlock: 1 } },
  };
  const role = { roleId: 11, vip: 0, items: { 37007: { quantity: 220 } }, statisticsTime: {}, statistics: {} };
  const legacy = { scheduleId: 1, sendItemCnt: 15, giftTask: new Map([[1, 1], [2, 1], [3, 9]]), giftTaskClaim: new Map() };
  const writes = [];
  const options = { timeout: false };
  const send = async (cmd, params) => {
    if (cmd === "role_getroleinfo") return { role };
    if (cmd === "legacy_getinfo") return { roleLegacy: legacy };
    if (cmd === "rank_getroleinfo") return { roleInfo: { roleId: 22 } };
    writes.push([cmd, params]);
    if (cmd === "legacy_claimgifttask") legacy.giftTaskClaim.set(params.id, 1);
    if (cmd === "role_commitpassword") return { role: { statistics: { "que:wh:tm": 1 } } };
    if (cmd === "legacy_sendgift") {
      role.items[37007].quantity -= params.itemCnt;
      legacy.sendItemCnt += params.itemCnt;
      if (options.timeout) throw new Error("请求超时");
    }
    return {};
  };
  return { writes, legacy, role, options, run: () => runLegacyFullGift({ send, config, recipientId: 22, password: "test", now: () => 150000.25 }) };
}

test("先领取已达标赛季任务，复用配置并按剩余额度和单次上限分批赠送", async () => {
  const f = fixture();
  assert.equal((await f.run()).status, "completed");
  assert.deepEqual(f.writes.slice(0, 3), [
    ["legacy_claimgifttask", { id: 1 }],
    ["legacy_claimgifttask", { id: 2 }],
    ["role_commitpassword", { password: "test", passwordType: 1 }],
  ]);
  assert.deepEqual(f.writes.slice(3), [60, 60, 60, 5].map(itemCnt => [
    "legacy_sendgift", { itemCnt, legacyUIds: [], targetId: 22 },
  ]));
  assert.equal((await f.run()).status, "skipped");
  assert.equal(f.writes.length, 7);
});

test("赛季赠送特权按库存和单次上限赠送", async () => {
  const f = fixture();
  f.role.statisticsTime["legacy:charge"] = 120;
  f.role.statistics["legacy:charge"] = 20;
  assert.equal((await f.run()).status, "completed");
  assert.equal(f.role.items[37007].quantity, 0);
});

test("赠送超时停止本轮，跨季直接跳过", async () => {
  const f = fixture();
  f.options.timeout = true;
  await assert.rejects(f.run(), /请求超时/);
  assert.equal(f.writes.filter(([cmd]) => cmd === "legacy_sendgift").length, 1);
  const stale = fixture();
  stale.legacy.scheduleId = 0;
  assert.equal((await stale.run()).status, "skipped");
  assert.deepEqual(stale.writes, []);
});
