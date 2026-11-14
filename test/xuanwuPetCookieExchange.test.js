import test from "node:test";
import assert from "node:assert/strict";

import {
  getXuanwuPetCookieExchangeIds,
  getXuanwuPetCookieExchangeQuantity,
} from "../src/utils/xuanwuPetCookieExchange.js";

test("玄武活动宠物饼干按每份5个道具5285计算兑换数量", () => {
  assert.deepEqual(
    getXuanwuPetCookieExchangeQuantity({
      role: { items: { 5285: { quantity: 21 } } },
    }),
    {
      itemId: 5285,
      itemQuantity: 21,
      unitCost: 5,
      exchangeQuantity: 4,
    },
  );
});

test("玄武活动道具不足5个时不兑换", () => {
  assert.equal(
    getXuanwuPetCookieExchangeQuantity({
      role: { items: { 5285: { quantity: 4 } } },
    }).exchangeQuantity,
    0,
  );
});

test("玄武活动兑换ID使用活动日期前缀", () => {
  assert.deepEqual(getXuanwuPetCookieExchangeIds("260919"), {
    activityId: 2609193,
    goodsId: 260919302,
  });
});
