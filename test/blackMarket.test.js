import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLACK_MARKET_ITEMS,
  DEFAULT_BLACK_MARKET_DISCOUNTS,
  DEFAULT_BLACK_MARKET_REFRESH_COUNT,
  loadBlackMarketSettings,
  normalizeBlackMarketSettings,
  runBlackMarketPurchase,
  selectDiscountPurchases,
} from "../src/utils/blackMarket.js";
import { createTasksStore } from "../src/utils/batch/tasksStore.js";

test("黑市九种物品使用固定商品槽位及预设折扣阈值", () => {
  assert.deepEqual(
    BLACK_MARKET_ITEMS.map(({ goodsId, itemId, name, defaultDiscount }) => ({
      goodsId,
      itemId,
      name,
      defaultDiscount,
    })),
    [
      { goodsId: 1, itemId: 2002, name: "青铜宝箱", defaultDiscount: 5 },
      { goodsId: 2, itemId: 2003, name: "黄金宝箱", defaultDiscount: 6 },
      { goodsId: 3, itemId: 2004, name: "铂金宝箱", defaultDiscount: 8 },
      { goodsId: 6, itemId: 1001, name: "招募令", defaultDiscount: 8 },
      { goodsId: 11, itemId: 1011, name: "普通鱼竿", defaultDiscount: 7 },
      { goodsId: 12, itemId: 1012, name: "黄金鱼竿", defaultDiscount: 7 },
      { goodsId: 14, itemId: 1022, name: "白玉", defaultDiscount: 7 },
      { goodsId: 15, itemId: 1023, name: "彩玉", defaultDiscount: 7 },
      { goodsId: 16, itemId: 1026, name: "扳手", defaultDiscount: 7 },
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

test("折扣模式只查询实时商品并直接购买符合阈值的槽位", async () => {
  const calls = [];
  const settings = normalizeBlackMarketSettings({
    blackMarketPurchaseMode: "discount",
    blackMarketRefreshCount: 0,
    blackMarketDiscounts: { 2002: 5, 2003: 6, 2004: 8, 1026: 7 },
  });
  const result = await runBlackMarketPurchase({
    settings,
    send: async (cmd, params) => {
      calls.push({ cmd, params });
      if (cmd === "store_goodslist") {
        return {
          goodsList: {
            1: { buy_quantity: 0, discount: 0.5 },
            2: { buy_quantity: 0, discount: 0.699999988079071 },
            3: { buy_quantity: 0, discount: 0.800000011920929 },
            6: { buy_quantity: 1, discount: 0.1 },
            16: { buy_quantity: 0, discount: 1 },
          },
        };
      }
      return { ok: true };
    },
  });

  assert.equal(result.mode, "discount");
  assert.deepEqual(
    calls.map(({ cmd }) => cmd),
    ["store_goodslist", "store_buy", "store_buy"],
  );
  assert.deepEqual(calls.slice(1).map(({ params }) => params), [
    { goodsId: 1 },
    { goodsId: 3 },
  ]);
  assert.deepEqual(result.purchases.map(({ itemId }) => itemId), [2002, 2004]);
});

test("折扣模式没有符合商品时不购买且绝不调用采购清单接口", async () => {
  const calls = [];
  const result = await runBlackMarketPurchase({
    settings: {
      blackMarketPurchaseMode: "discount",
      blackMarketRefreshCount: 0,
    },
    send: async (cmd, params) => {
      calls.push({ cmd, params });
      assert.notEqual(cmd, "store_getpurchase");
      assert.notEqual(cmd, "store_setpurchase");
      assert.notEqual(cmd, "store_purchase");
      return { goodsList: { 1: { buy_quantity: 0, discount: 0.6 } } };
    },
  });

  assert.deepEqual(result.purchases, []);
  assert.deepEqual(calls, [
    { cmd: "store_goodslist", params: { storeId: 1 } },
  ]);
});

test("实时折扣按折数取整并跳过已经购买的商品", () => {
  const selected = selectDiscountPurchases(
    {
      1: { buy_quantity: 0, discount: 0.50000001 },
      2: { buy_quantity: 1, discount: 0.1 },
      3: { buy_quantity: 0, discount: 0.89999998 },
      12: { buy_quantity: 0, discount: 7 },
    },
    { blackMarketPurchaseMode: "discount" },
  );

  assert.deepEqual(
    selected.map(({ goodsId, actualDiscount }) => ({ goodsId, actualDiscount })),
    [
      { goodsId: 1, actualDiscount: 5 },
      { goodsId: 12, actualDiscount: 7 },
    ],
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
  assert.equal(
    settings.blackMarketRefreshCount,
    DEFAULT_BLACK_MARKET_REFRESH_COUNT,
  );
});

test("折扣直购默认刷新一次并继续购买刷新后的商品", async () => {
  const calls = [];
  let goodsListCount = 0;
  const result = await runBlackMarketPurchase({
    settings: { blackMarketPurchaseMode: "discount" },
    send: async (cmd, params) => {
      calls.push({ cmd, params });
      if (cmd === "store_goodslist") {
        goodsListCount++;
        return goodsListCount === 1
          ? { goodsList: { 1: { buy_quantity: 0, discount: 0.6 } } }
          : { goodsList: { 2: { buy_quantity: 0, discount: 0.6 } } };
      }
      return { ok: true };
    },
  });

  assert.equal(result.refreshCount, 1);
  assert.deepEqual(calls, [
    { cmd: "store_goodslist", params: { storeId: 1 } },
    { cmd: "store_refresh", params: { storeId: 1 } },
    { cmd: "store_goodslist", params: { storeId: 1 } },
    { cmd: "store_buy", params: { goodsId: 2 } },
  ]);
  assert.deepEqual(result.purchases.map(({ goodsId }) => goodsId), [2]);
});

test("批量旧采购与折扣直购是两个互不切换的任务", async () => {
  const calls = [];
  const ref = (value) => ({ value });
  const tasks = createTasksStore({
    selectedTokens: ref(["token-1"]),
    tokens: ref([{ id: "token-1", name: "测试账号" }]),
    tokenStatus: ref({}),
    isRunning: ref(false),
    shouldStop: ref(false),
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: {
      maxActive: 2,
      blackMarketPurchaseMode: "discount",
      blackMarketRefreshCount: 0,
      blackMarketDiscounts: { 2002: 5 },
    },
    tokenStore: {
      sendMessageWithPromise: async (_tokenId, cmd, params) => {
        calls.push({ cmd, params });
        if (cmd === "store_goodslist") {
          return { goodsList: { 1: { buy_quantity: 0, discount: 0.5 } } };
        }
        return { ok: true };
      },
      closeWebSocketConnection: () => {},
    },
    addLog: () => {},
    message: {},
    currentRunningTokenId: ref(null),
    delayConfig: { action: 0 },
  });

  await tasks.store_purchase();
  assert.deepEqual(calls, [{ cmd: "store_purchase", params: {} }]);

  calls.length = 0;
  await tasks.store_discount_purchase();
  assert.deepEqual(calls, [
    { cmd: "store_goodslist", params: { storeId: 1 } },
    { cmd: "store_buy", params: { goodsId: 1 } },
  ]);
});
