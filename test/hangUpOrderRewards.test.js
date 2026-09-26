import test from "node:test";
import assert from "node:assert/strict";

import {
  claimAvailableHangUpOrderRewards,
  formatHangUpOrderRewards,
  getHangUpOrderRewardState,
} from "../src/utils/hangUpOrderRewards.js";

test("读取整数关卡挂机奖励的待领取档位", () => {
  assert.deepEqual(
    getHangUpOrderRewardState({
      role: { hangUp: { activeOrder: 10, lastClaimedOrder: 6 } },
    }),
    { activeOrder: 10, lastClaimedOrder: 6, pendingOrders: 4 },
  );
});

test("没有待领取档位时不发送领取指令", async () => {
  let sendCount = 0;
  const tokenStore = {
    sendGetRoleInfo: async () => ({
      role: { hangUp: { activeOrder: 10, lastClaimedOrder: 10 } },
    }),
    sendMessageWithPromise: async () => {
      sendCount += 1;
    },
  };

  const result = await claimAvailableHangUpOrderRewards(
    tokenStore,
    "token-1",
    8000,
    null,
    0,
  );

  assert.equal(result.claimed, false);
  assert.equal(sendCount, 0);
});

test("有待领取档位时只领取一次并返回实际奖励", async () => {
  const sent = [];
  const tokenStore = {
    sendGetRoleInfo: async () => ({
      role: { hangUp: { activeOrder: 6, lastClaimedOrder: 2 } },
    }),
    sendMessageWithPromise: async (...args) => {
      sent.push(args);
      return {
        role: { hangUp: { lastClaimedOrder: 6 } },
        reward: [
          { type: 3, itemId: 2004, value: 10 },
          { type: 3, itemId: 2005, value: 10 },
        ],
      };
    },
  };

  const result = await claimAvailableHangUpOrderRewards(tokenStore, "token-1");

  assert.equal(result.claimed, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].slice(0, 3), ["token-1", "system_claimhanguporder", {}]);
  assert.equal(result.after.lastClaimedOrder, 6);
  assert.equal(
    formatHangUpOrderRewards(result.rewards),
    "铂金宝箱x10、钻石宝箱x10",
  );
});

test("服务器每次只推进一档时持续领取到当前解锁档位", async () => {
  let lastClaimedOrder = 2;
  const sent = [];
  const tokenStore = {
    sendGetRoleInfo: async () => ({
      data: {
        role: { hangUp: { activeOrder: 5, lastClaimedOrder } },
      },
    }),
    sendMessageWithPromise: async (...args) => {
      sent.push(args);
      lastClaimedOrder += 1;
      return {
        body: {
          role: { hangUp: { lastClaimedOrder } },
          reward: [{ type: 3, itemId: 2004, value: 1 }],
        },
      };
    },
  };

  const result = await claimAvailableHangUpOrderRewards(
    tokenStore,
    "token-1",
    8000,
    null,
    0,
  );

  assert.equal(sent.length, 3);
  assert.deepEqual(result.after, {
    activeOrder: 5,
    lastClaimedOrder: 5,
    pendingOrders: 0,
  });
  assert.equal(result.rewards.length, 3);
});

test("领取响应未带档位时刷新角色信息核对实际进度", async () => {
  let lastClaimedOrder = 1;
  const tokenStore = {
    sendGetRoleInfo: async () => ({
      role: { hangUp: { activeOrder: 2, lastClaimedOrder } },
    }),
    sendMessageWithPromise: async () => {
      lastClaimedOrder = 2;
      return {
        data: {
          reward: [{ type: 3, itemId: 2005, value: 10 }],
        },
      };
    },
  };

  const result = await claimAvailableHangUpOrderRewards(tokenStore, "token-1");

  assert.equal(result.after.lastClaimedOrder, 2);
  assert.equal(formatHangUpOrderRewards(result.rewards), "钻石宝箱x10");
});

test("领取响应和刷新状态均未推进时停止，避免重复领取", async () => {
  let sendCount = 0;
  const tokenStore = {
    sendGetRoleInfo: async () => ({
      role: { hangUp: { activeOrder: 3, lastClaimedOrder: 1 } },
    }),
    sendMessageWithPromise: async () => {
      sendCount += 1;
      return {};
    },
  };

  await assert.rejects(
    claimAvailableHangUpOrderRewards(tokenStore, "token-1"),
    /领取档位没有推进/,
  );
  assert.equal(sendCount, 1);
});
