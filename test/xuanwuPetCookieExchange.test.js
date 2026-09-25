import test from "node:test";
import assert from "node:assert/strict";

import {
  getXuanwuCookieAndJadeExchangeIds,
  getXuanwuCookieAndJadeExchangePlan,
  getXuanwuExchangeItemQuantity,
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

test("玄武活动依次使用302兑换饼干、303兑换白玉", () => {
  assert.deepEqual(getXuanwuCookieAndJadeExchangeIds("260919"), {
    activityId: 2609193,
    cookieGoodsId: 260919302,
    whiteJadeGoodsId: 260919303,
  });
});

test("玄武活动兑换响应可以直接读取剩余活动道具", () => {
  assert.equal(
    getXuanwuExchangeItemQuantity({
      role: { items: { 5285: { quantity: 13 } } },
    }),
    13,
  );
});

test("饼干和白玉按相同数量一次性规划", () => {
  assert.deepEqual(
    getXuanwuCookieAndJadeExchangePlan({
      role: { items: { 5285: { quantity: 21 } } },
    }),
    {
      itemId: 5285,
      itemQuantity: 21,
      cookieUnitCost: 5,
      whiteJadeUnitCost: 5,
      pairUnitCost: 10,
      exchangeQuantity: 2,
      remainingItemQuantity: 1,
    },
  );
});

test("不足一组饼干白玉时不执行兑换", () => {
  assert.equal(
    getXuanwuCookieAndJadeExchangePlan({
      role: { items: { 5285: { quantity: 9 } } },
    }).exchangeQuantity,
    0,
  );
});
