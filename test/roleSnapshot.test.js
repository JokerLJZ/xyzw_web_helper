import test from "node:test";
import assert from "node:assert/strict";

import {
  extractRolePatch,
  mergeRoleSnapshot,
} from "../src/utils/roleSnapshot.js";

test("角色增量响应合并到初始快照且保留未变化字段", () => {
  const snapshot = {
    levelId: 4001,
    items: {
      1011: { itemId: 1011, quantity: 20 },
      2005: { itemId: 2005, quantity: 10 },
    },
    hangUp: { activeOrder: 8, lastClaimedOrder: 6 },
  };

  mergeRoleSnapshot(snapshot, {
    items: { 1011: { quantity: 10 } },
    hangUp: { lastClaimedOrder: 8 },
  });

  assert.equal(snapshot.levelId, 4001);
  assert.equal(snapshot.items[1011].itemId, 1011);
  assert.equal(snapshot.items[1011].quantity, 10);
  assert.equal(snapshot.items[2005].quantity, 10);
  assert.deepEqual(snapshot.hangUp, { activeOrder: 8, lastClaimedOrder: 8 });
});

test("角色增量提取兼容常见响应结构", () => {
  const role = { roleId: 1 };
  assert.equal(extractRolePatch({ role }), role);
  assert.equal(extractRolePatch({ data: { role } }), role);
  assert.equal(extractRolePatch({ body: { role } }), role);
  assert.equal(extractRolePatch({ rawData: { role } }), role);
  assert.equal(extractRolePatch({ reward: [] }), null);
});

test("连续任务响应可在同一角色快照上累积更新", () => {
  const snapshot = {
    items: { 1011: { itemId: 1011, quantity: 20 } },
    statistics: { "artifact:point": 0 },
  };

  for (const response of [
    {
      role: {
        items: { 1011: { quantity: 10 } },
        statistics: { "artifact:point": 10 },
      },
    },
    {
      role: {
        items: { 1011: { quantity: 0 } },
        statistics: { "artifact:point": 20 },
      },
    },
  ]) {
    mergeRoleSnapshot(snapshot, extractRolePatch(response));
  }

  assert.equal(snapshot.items[1011].quantity, 0);
  assert.equal(snapshot.items[1011].itemId, 1011);
  assert.equal(snapshot.statistics["artifact:point"], 20);
});
