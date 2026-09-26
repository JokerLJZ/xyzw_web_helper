import assert from "node:assert/strict";
import { test } from "node:test";

import { runUpgradeCommandWithReconciliation } from "../src/utils/batch/tasksItem.js";

test("进阶返回临时错误但服务器已生效时不重复发送", async () => {
  let executeCount = 0;
  let queryCount = 0;
  const waits = [];

  const result = await runUpgradeCommandWithReconciliation({
    execute: async () => {
      executeCount += 1;
      throw new Error("服务器错误: 200020 - 出了点小问题");
    },
    queryState: async () => {
      queryCount += 1;
      return { order: 13 };
    },
    hasApplied: (state) => state.order > 12,
    isTransientError: (error) => error.message.includes("200020"),
    sleep: async (delayMs) => waits.push(delayMs),
  });

  assert.equal(executeCount, 1);
  assert.equal(queryCount, 1);
  assert.deepEqual(waits, [1500, 6000]);
  assert.equal(result.reconciled, true);
  assert.deepEqual(result.reconciledState, { order: 13 });
});

test("进阶返回临时错误且服务器未生效时才重试", async () => {
  let executeCount = 0;
  let queryCount = 0;
  const waits = [];

  const result = await runUpgradeCommandWithReconciliation({
    execute: async () => {
      executeCount += 1;
      if (executeCount === 1) {
        throw new Error("服务器错误: 200020 - 出了点小问题");
      }
      return { success: true };
    },
    queryState: async () => {
      queryCount += 1;
      return { order: 12 };
    },
    hasApplied: (state) => state.order > 12,
    isTransientError: (error) => error.message.includes("200020"),
    sleep: async (delayMs) => waits.push(delayMs),
  });

  assert.equal(executeCount, 2);
  assert.equal(queryCount, 1);
  assert.deepEqual(waits, [1500, 6000, 1500]);
  assert.equal(result.reconciled, false);
  assert.deepEqual(result.result, { success: true });
});

test("非临时升级错误直接抛出且不查询状态", async () => {
  let queryCount = 0;

  await assert.rejects(
    runUpgradeCommandWithReconciliation({
      execute: async () => {
        throw new Error("进阶条件不足");
      },
      queryState: async () => {
        queryCount += 1;
        return {};
      },
      hasApplied: () => false,
      isTransientError: () => false,
      sleep: async () => {},
    }),
    /进阶条件不足/,
  );

  assert.equal(queryCount, 0);
});

test("最后一次请求报临时错误时仍会核对是否已经生效", async () => {
  const result = await runUpgradeCommandWithReconciliation({
    execute: async () => {
      throw new Error("服务器错误: 200020 - 出了点小问题");
    },
    queryState: async () => ({ level: 2850 }),
    hasApplied: (state) => state.level > 2800,
    isTransientError: (error) => error.message.includes("200020"),
    maxRetries: 0,
    sleep: async () => {},
  });

  assert.equal(result.reconciled, true);
  assert.deepEqual(result.reconciledState, { level: 2850 });
});
