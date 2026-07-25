import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveClaimActivityIds } from "../src/utils/batch/tasksTower.js";

test("换皮领奖活动未返回列表时，从闯关活动ID推导领奖ID", () => {
  const result = resolveClaimActivityIds({
    response: { actId: 2607241, levelRewardMap: {} },
    towerData: { actId: 2607241, levelRewardMap: {} },
    challengeActId: 2607241,
  });

  assert.deepEqual(result.claimActIds, [2607242]);
  assert.equal(result.usedFallback, true);
});

test("换皮领奖优先使用接口返回的活动ID列表并去重", () => {
  const result = resolveClaimActivityIds({
    response: {
      actIdList: [{ actId: "2607241" }, { actId: 2607242 }, 2607241],
    },
    towerData: {},
    challengeActId: 2607241,
  });

  assert.deepEqual(result.claimActIds, [2607242]);
  assert.equal(result.usedFallback, false);
});

test("换皮领奖支持嵌套响应和对象形式的活动列表", () => {
  const result = resolveClaimActivityIds({
    response: {
      data: {
        towerData: {
          actIdList: {
            first: { activityId: "2607241" },
            second: { id: 2607243 },
          },
        },
      },
    },
    towerData: {},
    challengeActId: 2607241,
  });

  assert.deepEqual(result.claimActIds, [2607242, 2607243]);
  assert.equal(result.usedFallback, false);
});

test("没有有效闯关活动ID时不生成领奖ID", () => {
  const result = resolveClaimActivityIds({
    response: {},
    towerData: {},
    challengeActId: null,
  });

  assert.deepEqual(result.claimActIds, []);
  assert.equal(result.usedFallback, false);
});
