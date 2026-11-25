import assert from "node:assert/strict";
import { test } from "node:test";

import { getFormationUniversalFragment } from "../src/utils/batch/tasksItem.js";

test("阵容调整不为蔡文姬分配万能碎片", () => {
  assert.equal(getFormationUniversalFragment(223), null);
});

test("阵容调整仍可为其他红将和橙将分配对应万能碎片", () => {
  assert.deepEqual(getFormationUniversalFragment(107), {
    itemId: 3201,
    index: 6,
    name: "万能红碎",
  });
  assert.deepEqual(getFormationUniversalFragment(204), {
    itemId: 3302,
    index: 3,
    name: "万能橙碎",
  });
});
