const getRole = (payload) =>
  payload?.role || payload?.body?.role || payload?.rawData?.role || payload || {};

/**
 * 读取主线整数关卡挂机奖励状态。
 * activeOrder 表示当前已解锁档位，lastClaimedOrder 表示已领取档位。
 */
export const getHangUpOrderRewardState = (payload) => {
  const role = getRole(payload);
  const hangUp = role?.hangUp || {};
  const activeOrder = Number(hangUp.activeOrder) || 0;
  const lastClaimedOrder = Number(hangUp.lastClaimedOrder) || 0;

  return {
    activeOrder,
    lastClaimedOrder,
    pendingOrders: Math.max(0, activeOrder - lastClaimedOrder),
  };
};

export const formatHangUpOrderRewards = (rewards = []) => {
  if (!Array.isArray(rewards)) return "";
  const itemNames = {
    1001: "招募令",
    2002: "青铜宝箱",
    2003: "黄金宝箱",
    2004: "铂金宝箱",
    2005: "钻石宝箱",
  };
  return rewards
    .filter((reward) => Number(reward?.value) > 0)
    .map((reward) => {
      if (Number(reward?.type) === 1) return `金币x${reward.value}`;
      if (Number(reward?.type) === 2) return `金砖x${reward.value}`;
      if (Number(reward?.type) === 3) {
        const itemName = itemNames[Number(reward.itemId)] || `物品${reward.itemId}`;
        return `${itemName}x${reward.value}`;
      }
      return `类型${reward?.type}x${reward?.value}`;
    })
    .join("、");
};

/**
 * 查询并领取主线整数关卡挂机奖励。
 * 该奖励与 system_claimhangupreward 的按时间挂机收益相互独立。
 */
export const claimAvailableHangUpOrderRewards = async (
  tokenStore,
  tokenId,
  timeout = 8000,
  roleInfo = null,
) => {
  const currentRoleInfo = roleInfo || (await tokenStore.sendGetRoleInfo(tokenId));
  const before = getHangUpOrderRewardState(currentRoleInfo);

  if (before.pendingOrders <= 0) {
    return { claimed: false, before, after: before, rewards: [] };
  }

  const response = await tokenStore.sendMessageWithPromise(
    tokenId,
    "system_claimhanguporder",
    {},
    timeout,
  );
  const after = getHangUpOrderRewardState(response);

  return {
    claimed: true,
    before,
    after,
    rewards: Array.isArray(response?.reward) ? response.reward : [],
    response,
  };
};
