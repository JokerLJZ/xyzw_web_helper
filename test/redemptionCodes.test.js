import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REDEMPTION_CODES,
  normalizeRedemptionCodes,
  resolveRedemptionCodes,
} from "../src/utils/redemptionCodes.js";
import { createTasksStore } from "../src/utils/batch/tasksStore.js";

const ref = (value) => ({ value });

test("默认兑换码清单保持用户给定顺序和大小写", () => {
  assert.deepEqual(DEFAULT_REDEMPTION_CODES, [
    "HAPPY666", "SVIP666", "VIP888", "vip666", "XYZW666", "XYZW888",
    "XYZW520", "QQ888", "QQXY888", "taptap666", "DOUYIN666", "DOUYIN888",
    "dalao666", "dalao888", "xyzwgame666", "MISS666",
  ]);
});

test("自定义兑换码支持多种分隔符并去重", () => {
  assert.deepEqual(normalizeRedemptionCodes(" A\nB, A；C  "), ["A", "B", "C"]);
  assert.deepEqual(resolveRedemptionCodes({ redemptionCodeMode: "custom", customRedemptionCodes: "X\nY\nX" }), ["X", "Y"]);
});

test("兑换码失败只记录日志并继续后续兑换", async () => {
  const calls = [];
  const logs = [];
  const tasks = createTasksStore({
    selectedTokens: ref(["token-1"]),
    tokens: ref([{ id: "token-1", name: "测试账号" }]),
    tokenStatus: ref({}),
    isRunning: ref(false),
    shouldStop: ref(false),
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 2, redemptionCodeMode: "custom", customRedemptionCodes: "A\nB\nC" },
    tokenStore: {
      sendMessageWithPromise: async (tokenId, cmd, params) => {
        calls.push({ tokenId, cmd, params });
        if (params.key === "B") throw new Error("已兑换");
        return { ok: true };
      },
      closeWebSocketConnection: () => {},
    },
    addLog: (entry) => logs.push(entry),
    currentRunningTokenId: ref(null),
    delayConfig: { action: 0 },
  });

  await tasks.batchRedeemCodes();

  assert.deepEqual(calls.map((call) => call.params.key), ["A", "B", "C"]);
  assert.equal(logs.some((entry) => entry.message.includes("兑换码 B 兑换失败: 已兑换")), true);
  assert.equal(logs.some((entry) => entry.message.includes("成功2个，失败1个")), true);
});
