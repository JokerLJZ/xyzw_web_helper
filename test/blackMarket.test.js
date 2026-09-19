import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLACK_MARKET_ITEMS,
  DEFAULT_BLACK_MARKET_DISCOUNTS,
  buildBlackMarketPurchaseRule,
  loadBlackMarketSettings,
  normalizeBlackMarketSettings,
  runBlackMarketPurchase,
} from "../src/utils/blackMarket.js";

test("黑市九种物品使用预设折扣阈值", () => {
  assert.deepEqual(
    BLACK_MARKET_ITEMS.map(({ itemId, name, defaultDiscount }) => ({
      itemId,
      name,
      defaultDiscount,
    })),
    [
      { itemId: 2002, name: "青铜宝箱", defaultDiscount: 5 },
      { itemId: 2003, name: "黄金宝箱", defaultDiscount: 6 },
      { itemId: 2004, name: "铂金宝箱", defaultDiscount: 8 },
      { itemId: 1001, name: "招募令", defaultDiscount: 8 },
      { itemId: 1011, name: "普通鱼竿", defaultDiscount: 7 },
      { itemId: 1012, name: "黄金鱼竿", defaultDiscount: 7 },
      { itemId: 1022, name: "白玉", defaultDiscount: 7 },
      { itemId: 1023, name: "彩玉", defaultDiscount: 7 },
      { itemId: 1026, name: "扳手", defaultDiscount: 7 },
    ],
  );
  assert.equal(DEFAULT_BLACK_MARKET_DISCOUNTS[2002], 5);
});

test("旧模式保留原有自动采购且不读取或覆盖清单", async () => {
  const calls = [];
  const result = await runBlackMarketPurchase({
    settings: { blackMarketPurchaseMode: "legacy" },
    send: async (cmd, params) => {
      calls.push({ cmd, params });
      return { ok: true };
    },
  });

  assert.equal(result.mode, "legacy");
  assert.deepEqual(calls, [{ cmd: "store_purchase", params: {} }]);
});

test("折扣模式保留账号采购次数并同步九种物品后采购", async () => {
  const calls = [];
  const settings = normalizeBlackMarketSettings({
    blackMarketPurchaseMode: "discount",
    blackMarketDiscounts: { 2002: 4, 1026: 6 },
  });
  const result = await runBlackMarketPurchase({
    settings,
    send: async (cmd, params) => {
      calls.push({ cmd, params });
      if (cmd === "store_getpurchase") {
        return {
          purchaseCnt: 1,
          purchaseItemList: [{ itemId: 2002, discount: 5 }],
        };
      }
      return { ok: true };
    },
  });

  assert.equal(result.mode, "discount");
  assert.equal(result.ruleUpdated, true);
  assert.deepEqual(
    calls.map(({ cmd }) => cmd),
    ["store_getpurchase", "store_setpurchase", "store_purchase"],
  );
  assert.equal(calls[1].params.purchaseCnt, 1);
  assert.equal(calls[1].params.purchaseItemList.length, 9);
  assert.deepEqual(
    calls[1].params.purchaseItemList.find((item) => item.itemId === 2002),
    { itemId: 2002, discount: 4 },
  );
  assert.deepEqual(
    calls[1].params.purchaseItemList.find((item) => item.itemId === 1026),
    { itemId: 1026, discount: 6 },
  );
});

test("折扣清单相同时不重复设置", async () => {
  const settings = normalizeBlackMarketSettings({
    blackMarketPurchaseMode: "discount",
  });
  const currentRule = buildBlackMarketPurchaseRule(settings, { purchaseCnt: 2 });
  currentRule.purchaseItemList.reverse();
  const calls = [];

  const result = await runBlackMarketPurchase({
    settings,
    send: async (cmd, params) => {
      calls.push({ cmd, params });
      return cmd === "store_getpurchase" ? currentRule : { ok: true };
    },
  });

  assert.equal(result.ruleUpdated, false);
  assert.deepEqual(
    calls.map(({ cmd }) => cmd),
    ["store_getpurchase", "store_purchase"],
  );
});

test("通用设置可持久化读取并修正越界阈值", () => {
  const storage = {
    getItem: () =>
      JSON.stringify({
        blackMarketPurchaseMode: "discount",
        blackMarketDiscounts: { 2002: 0, 2003: 11, 2004: "6" },
      }),
  };
  const settings = loadBlackMarketSettings(storage);

  assert.equal(settings.blackMarketPurchaseMode, "discount");
  assert.equal(settings.blackMarketDiscounts[2002], 1);
  assert.equal(settings.blackMarketDiscounts[2003], 10);
  assert.equal(settings.blackMarketDiscounts[2004], 6);
  assert.equal(settings.blackMarketDiscounts[1001], 8);
});
