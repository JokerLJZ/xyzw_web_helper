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

  const result = await claimAvailableHangUpOrderRewards(tokenStore, "token-1");

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
