import assert from "node:assert/strict";
import { test } from "node:test";
import { syncBlackMarketPurchaseConfig } from "../src/utils/batch/blackMarketConfig.js";

const list = [{ itemId: 1012, discount: 7 }];
for (const initial of [{}, { purchaseCnt: 0 }, { purchaseItemList: [] }, { purchaseCnt: 3 }, { _originalCmd: "store_getpurchase" }]) {
  test(`官方默认字段省略仍可同步清单：${JSON.stringify(initial)}`, async () => {
    let current = initial;
    const calls = [];
    const send = async (cmd, params) => {
      calls.push({ cmd, params });
      if (cmd === "store_setpurchase") current = { purchaseItemList: params.purchaseItemList, ...(params.purchaseCnt ? { purchaseCnt: params.purchaseCnt } : {}) };
      return current;
    };
    assert.equal(await syncBlackMarketPurchaseConfig({ send, list }), "updated");
    assert.deepEqual(calls.map(c => c.cmd), ["store_getpurchase", "store_setpurchase", "store_getpurchase"]);
    assert.deepEqual(calls[1].params, { purchaseCnt: initial.purchaseCnt ?? 0, purchaseItemList: list });
  });
}

test("已存在相同清单且省略零次数时不修改", async () => {
  const calls = [];
  const send = async cmd => { calls.push(cmd); return { purchaseItemList: list }; };
  assert.equal(await syncBlackMarketPurchaseConfig({ send, list }), "unchanged");
  assert.deepEqual(calls, ["store_getpurchase"]);
});

for (const invalid of [null, [], { purchaseCnt: null }, { purchaseCnt: -1 }, { purchaseCnt: 1.5 }, { purchaseItemList: null }, { purchaseItemList: {} }, { code: 200020 }, { body: {} }, { purchaseItemList: [{ itemId: 1012, discount: 99 }] }]) {
  test(`显式无效响应不得作为默认配置写入：${JSON.stringify(invalid)}`, async () => {
    const calls = [];
    await assert.rejects(syncBlackMarketPurchaseConfig({ list, send: async cmd => { calls.push(cmd); return invalid; } }), /游戏返回/);
    assert.deepEqual(calls, ["store_getpurchase"]);
  });
}

test("写后返回默认空配置时校验失败，不重复写入", async () => {
  const calls = [];
  await assert.rejects(syncBlackMarketPurchaseConfig({ list, send: async cmd => { calls.push(cmd); return {}; } }), /校验失败/);
  assert.equal(calls.filter(c => c === "store_setpurchase").length, 1);
});
