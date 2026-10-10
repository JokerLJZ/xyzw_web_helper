import test from "node:test";
import assert from "node:assert/strict";

import { getNextUnclaimedLotteryCumulativeId } from "../src/utils/xuanwuLotteryRewards.js";

test("玄武累抽奖励读取第一个未领取档位", () => {
  assert.equal(
    getNextUnclaimedLotteryCumulativeId({
      lotteryNum: 26,
      cumulativeClaimedMap: { 1: true, 2: true, 4: true },
    }),
    3,
  );
});

test("玄武累抽奖励没有领取记录时从第一档开始", () => {
  assert.equal(getNextUnclaimedLotteryCumulativeId({ lotteryNum: 0 }), 1);
});

test("玄武累抽奖励全部领取后不再尝试", () => {
  assert.equal(
    getNextUnclaimedLotteryCumulativeId({
      cumulativeClaimedMap: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [index + 1, true]),
      ),
    }),
    null,
  );
});

test("玄武累抽奖励兼容显式未领取状态", () => {
  assert.equal(
    getNextUnclaimedLotteryCumulativeId({
      cumulativeClaimedMap: { 1: true, 2: false },
    }),
    2,
  );
});
