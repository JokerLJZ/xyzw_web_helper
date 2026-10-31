const getRole = (payload) =>
  payload?.role ||
  payload?.body?.role ||
  payload?.rawData?.role ||
  payload?._raw?.body?.role ||
  payload?.data?.role ||
  payload?.data?.body?.role ||
  payload?.data?.rawData?.role ||
  payload ||
  {};

const getRewards = (payload) => {
  const rewards =
    payload?.reward ||
    payload?.body?.reward ||
    payload?.rawData?.reward ||
    payload?._raw?.body?.reward ||
    payload?.data?.reward ||
    payload?.data?.body?.reward ||
    payload?.data?.rawData?.reward;
  return Array.isArray(rewards) ? rewards : [];
};

const getHangUpFields = (payload) => {
  const hangUp = getRole(payload)?.hangUp;
  return {
    activeOrder: Number.isFinite(Number(hangUp?.activeOrder))
      ? Number(hangUp.activeOrder)
      : null,
    lastClaimedOrder: Number.isFinite(Number(hangUp?.lastClaimedOrder))
      ? Number(hangUp.lastClaimedOrder)
      : null,
  };
};

/**
 * 读取主线整数关卡挂机奖励状态。
 * activeOrder 表示当前已解锁档位，lastClaimedOrder 表示已领取档位。
 */
export const getHangUpOrderRewardState = (payload) => {
  const fields = getHangUpFields(payload);
  const activeOrder = fields.activeOrder ?? 0;
  const lastClaimedOrder = fields.lastClaimedOrder ?? 0;

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
  claimDelay = 500,
) => {
  const currentRoleInfo = roleInfo || (await tokenStore.sendGetRoleInfo(tokenId));
  const before = getHangUpOrderRewardState(currentRoleInfo);

  if (before.pendingOrders <= 0) {
    return { claimed: false, before, after: before, rewards: [] };
  }

  let after = before;
  const rewards = [];
  const responses = [];

  // 服务端可能一次领取全部待领档位，也可能只推进一档；始终以
  // lastClaimedOrder 的真实推进为准，避免只领一档却误报全部完成。
  for (let attempt = 0; attempt < before.pendingOrders; attempt += 1) {
    const response = await tokenStore.sendMessageWithPromise(
      tokenId,
      "system_claimhanguporder",
      {},
      timeout,
    );
    responses.push(response);
    rewards.push(...getRewards(response));

    const responseFields = getHangUpFields(response);
    let nextLastClaimedOrder =
      responseFields.lastClaimedOrder ?? after.lastClaimedOrder;

    if (nextLastClaimedOrder <= after.lastClaimedOrder) {
      const refreshedRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
      nextLastClaimedOrder = getHangUpOrderRewardState(
        refreshedRoleInfo,
      ).lastClaimedOrder;
    }

    if (nextLastClaimedOrder <= after.lastClaimedOrder) {
      throw new Error("整数关卡挂机奖励请求已返回，但领取档位没有推进");
    }

    after = {
      activeOrder: before.activeOrder,
      lastClaimedOrder: nextLastClaimedOrder,
      pendingOrders: Math.max(0, before.activeOrder - nextLastClaimedOrder),
    };
    if (after.pendingOrders <= 0) break;
    if (claimDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, claimDelay));
    }
  }

  return {
    claimed: true,
    before,
    after,
    rewards,
    response: responses.at(-1),
    responses,
  };
};
