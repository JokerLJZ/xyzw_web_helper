import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveClaimActivityIds,
  SKIN_CHALLENGE_MAX_CONSECUTIVE_FAILURES,
} from "../src/utils/batch/tasksTower.js";

test("换皮连续失败5次后才跳过", () => {
  assert.equal(SKIN_CHALLENGE_MAX_CONSECUTIVE_FAILURES, 5);
});

test("换皮领奖从以1结尾的闯关活动ID推导领奖ID", () => {
  assert.deepEqual(deriveClaimActivityIds(2607241), [2607242]);
});

test("换皮领奖从其他结尾的闯关活动ID直接使用原ID", () => {
  assert.deepEqual(deriveClaimActivityIds("2607242"), [2607242]);
});

test("没有有效闯关活动ID时不生成领奖ID", () => {
  assert.deepEqual(deriveClaimActivityIds(null), []);
  assert.deepEqual(deriveClaimActivityIds("invalid"), []);
  assert.deepEqual(deriveClaimActivityIds(0), []);
});
