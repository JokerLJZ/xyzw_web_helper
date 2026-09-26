import { isDungeonOpen, merchantConfig } from "@/utils/dreamConstants";
import {
  DREAM_PUSH_INTERVAL_MS,
  isDreamEnabled,
  runAutomaticDream,
} from "@/utils/dreamTaskRunner.js";

// 消耗活动每类任务固定为 20 档，missionId 按任务类型连续分组：
// 招募 1-20、宝箱 21-40、捕获 41-60、盐罐 61-80、金砖 81-100。
export const CONSUMPTION_MISSION_THRESHOLDS = {
  1: [
    80, 160, 240, 320, 400, 560, 720, 880, 1040, 1200,
    1440, 1680, 1920, 2160, 2400, 2720, 3040, 3360, 3680, 4000,
  ],
  2: [
    2000, 4000, 6000, 8000, 10000, 14000, 18000, 22000, 26000, 30000,
    36000, 42000, 48000, 54000, 60000, 68000, 76000, 84000, 92000, 100000,
  ],
  3: [
    25, 50, 75, 125, 175, 225, 300, 375, 450, 525,
    625, 725, 825, 925, 1050, 1175, 1300, 1450, 1600, 1750,
  ],
  4: [
    3, 6, 9, 12, 15, 18, 21, 24, 27, 30,
    33, 36, 39, 42, 45, 48, 51, 54, 57, 60,
  ],
  5: [
    10000, 20000, 30000, 40000, 50000, 70000, 90000, 110000, 130000,
    150000, 180000, 210000, 240000, 270000, 300000, 340000, 380000,
    420000, 460000, 500000,
  ],
};

const CONSUMPTION_TASK_NAMES = {
  1: "招募",
  2: "宝箱",
  3: "捕获",
  4: "盐罐",
  5: "金砖",
};

/** 从 activity_get 响应中定位本期消耗活动，避免硬编码日期活动 ID。 */
export function findConsumptionActivity(response) {
  const body = response?._raw?.body || response;
  const activities =
    body?.activity?.commonActivityInfo || body?.commonActivityInfo || {};

  const candidates = Object.entries(activities).filter(([, info]) => {
    const taskIds = Object.keys(info?.task || {}).map(Number);
    return taskIds.some((taskId) => taskId >= 1 && taskId <= 5);
  });

  if (candidates.length === 0) return null;

  // 通常只会有一期；若切期时短暂并存，优先选择任务数据更多、ID 更新的一期。
  candidates.sort(([idA, infoA], [idB, infoB]) => {
    const taskCountDiff =
      Object.keys(infoB?.task || {}).length -
      Object.keys(infoA?.task || {}).length;
    return taskCountDiff || Number(idB) - Number(idA);
  });

  const [activityId, info] = candidates[0];
  return { activityId: Number(activityId), info };
}

/** 根据实际进度和领取记录，生成本次应领取的档位。 */
export function getClaimableConsumptionMissions(info) {
  const tasks = info?.task || {};
  const claimed = info?.record || {};
  const missions = [];

  for (const [taskIdText, thresholds] of Object.entries(
    CONSUMPTION_MISSION_THRESHOLDS,
  )) {
    const taskId = Number(taskIdText);
    const progress = Number(tasks[taskId] ?? tasks[taskIdText] ?? 0);

    thresholds.forEach((threshold, index) => {
      const missionId = (taskId - 1) * 20 + index + 1;
      if (
        progress >= threshold &&
        !Object.prototype.hasOwnProperty.call(claimed, missionId)
      ) {
        missions.push({
          missionId,
          taskId,
          taskName: CONSUMPTION_TASK_NAMES[taskId],
          threshold,
        });
      }
    });
  }

  return missions;
}

/** 合并多档响应中的奖励，保留同次领取返回的两种或更多道具。 */
export function summarizeConsumptionRewards(rewards) {
  const summary = new Map();
  for (const reward of rewards.flat()) {
    if (!reward) continue;
    const key = `${reward.type}:${reward.itemId}:${reward.ext || 0}`;
    const current = summary.get(key) || { ...reward, value: 0 };
    current.value += Number(reward.value) || 0;
    summary.set(key, current);
  }

  return [...summary.values()];
}

export function formatConsumptionRewards(rewards) {
  return rewards
    .map((reward) => {
      if (reward.type === 2) return `金砖x${reward.value}`;
      if (reward.type === 3) return `道具${reward.itemId}x${reward.value}`;
      return `类型${reward.type}道具${reward.itemId}x${reward.value}`;
    })
    .join("、");
}

/**
 * 副本类任务
 * 包含: batchmengjing, batchBuyDreamItems, batchClaimConsumptionRewards
 */

/**
 * 创建梦境类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksDungeon(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    delayConfig,
  } = deps;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const commandDelay = delayConfig?.command ?? delayConfig?.action ?? 300;

  const getDreamPurchaseList = () => batchSettings.dreamPurchaseList || [];

  /** 查询本期消耗活动后，只领取已经达标且尚未领取的任务奖励。 */
  const batchClaimConsumptionRewards = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      const ownsSlot = tokenStore.getWebSocketStatus(tokenId) !== "connected";
      let connected = false;

      try {
        await ensureConnection(tokenId);
        connected = true;
        if (shouldStop.value) return;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取消耗活动任务奖励: ${tokenName} ===`,
          type: "info",
        });

        // 抓包流程要求先查询，活动 ID、进度和已领取记录均以服务端结果为准。
        const activityResponse = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_get",
          {},
          10000,
        );
        const activity = findConsumptionActivity(activityResponse);

        if (!activity) {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前没有可识别的消耗活动，已跳过`,
            type: "warning",
          });
          return;
        }

        const missions = getClaimableConsumptionMissions(activity.info);
        if (missions.length === 0) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 消耗活动暂无可领取档位（活动ID: ${activity.activityId}）`,
            type: "info",
          });
          return;
        }

        const receivedRewards = [];
        let claimedCount = 0;
        let failedCount = 0;

        for (const mission of missions) {
          if (shouldStop.value) break;
          try {
            const result = await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_claimtaskreward",
              {
                activityId: activity.activityId,
                missionId: mission.missionId,
              },
              10000,
            );
            receivedRewards.push(result?.reward || []);
            claimedCount++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 已领取${mission.taskName}第${
                mission.missionId - (mission.taskId - 1) * 20
              }档`,
              type: "success",
            });
          } catch (error) {
            failedCount++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${mission.taskName}档位${
                mission.missionId
              }领取失败: ${error.message || "未知错误"}`,
              type: "warning",
            });
          }
          if (commandDelay > 0) await sleep(commandDelay);
        }

        if (claimedCount > 0) {
          // 再查一次，让页面中的进度和已领取记录与服务端保持一致。
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_get",
            {},
            10000,
          );
        }

        const rewardSummary = summarizeConsumptionRewards(receivedRewards);
        tokenStatus.value[tokenId] = failedCount > 0 ? "failed" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 消耗活动领取完成：成功${claimedCount}档${
            failedCount ? `，失败${failedCount}档` : ""
          }${rewardSummary.length ? `；获得 ${formatConsumptionRewards(rewardSummary)}` : ""}`,
          type: failedCount > 0 ? "warning" : "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 消耗活动奖励领取失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        if (connected) {
          tokenStore.closeWebSocketConnection(tokenId);
          if (ownsSlot) releaseConnectionSlot();
        }
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("消耗活动任务奖励领取结束");
  };

  const runDreamPurchaseForToken = async (tokenId, token, purchaseList) => {
    if (purchaseList.length === 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 未配置梦境购买清单，跳过购买`,
        type: "warning",
      });
      return { successCount: 0, failCount: 0, skipped: true };
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 开始梦境购买: ${token.name} ===`,
      type: "info",
    });

    const roleInfo = await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
      15000,
    );

    if (
      !roleInfo ||
      !roleInfo.role ||
      !roleInfo.role.dungeon ||
      !roleInfo.role.dungeon.merchant
    ) {
      throw new Error("无法获取梦境商店数据");
    }

    const merchantData = roleInfo.role.dungeon.merchant;

    let successCount = 0;
    let failCount = 0;
    const operations = [];

    for (const itemKey of purchaseList) {
      const [targetMerchantId, targetItemIndex] = itemKey
        .split("-")
        .map(Number);
      const merchantItems = merchantData[targetMerchantId];

      if (merchantItems) {
        for (let pos = 0; pos < merchantItems.length; pos++) {
          if (merchantItems[pos] === targetItemIndex) {
            operations.push({
              merchantId: targetMerchantId,
              index: targetItemIndex,
              pos,
            });
          }
        }
      }
    }

    operations.sort((a, b) => {
      if (a.merchantId !== b.merchantId) return a.merchantId - b.merchantId;
      return b.pos - a.pos;
    });

    for (const op of operations) {
      if (shouldStop.value) break;

      try {
        const response = await tokenStore.sendMessageWithPromise(
          tokenId,
          "dungeon_buymerchant",
          {
            id: op.merchantId,
            index: op.index,
            pos: op.pos,
          },
          5000,
        );

        if (response && response.reward) {
          successCount++;
          const merchantName =
            merchantConfig[op.merchantId]?.name || `商人${op.merchantId}`;
          const itemName =
            merchantConfig[op.merchantId]?.items?.[op.index] ||
            `商品${op.index}`;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 购买成功: ${merchantName} - ${itemName}`,
            type: "success",
          });
        } else {
          failCount++;
        }
      } catch (err) {
        failCount++;
      }

      await sleep(500);
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== ${token.name} 梦境购买完成: 成功${successCount}, 失败${failCount} ===`,
      type: "success",
    });

    return { successCount, failCount, skipped: false };
  };

  /**
   * 一键梦境
   */
  const batchmengjing = async () => {
    if (selectedTokens.value.length === 0) return;

    if (!isDungeonOpen()) {
      message.warning("当前不是梦境开放时间（周三/周四/周日/周一）");
      return;
    }

    const purchaseList = getDreamPurchaseList();

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      let connected = false;
      const ownsSlot = tokenStore.getWebSocketStatus(tokenId) !== "connected";
      try {
        if (!isDreamEnabled(tokenId)) {
          tokenStatus.value[tokenId] = "completed";
          addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} 已关闭梦境功能，跳过`, type: "info" });
          return;
        }
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始咸王梦境: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        connected = true;
        if (shouldStop.value) return;
        const result = await runAutomaticDream({
          purchase: () => runDreamPurchaseForToken(tokenId, token, purchaseList),
          send: (cmd, params) => tokenStore.sendMessageWithPromise(tokenId, cmd, params, 15000),
          stopped: () => shouldStop.value,
          pause: () => sleep(DREAM_PUSH_INTERVAL_MS),
          log: (text) => addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} ${text}`, type: "info" }),
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 自动梦境：${result.reason}，当前层数 ${result.floor ?? "未知"}`,
          type: "info",
        });
        if (shouldStop.value || result.status === "skipped") return;

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 咸王梦境已完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 咸王梦境失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        if (connected) {
          tokenStore.closeWebSocketConnection(tokenId);
          if (ownsSlot) releaseConnectionSlot();
        }
        if (connected) addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    if (shouldStop.value) message.warning("自动梦境已停止");
    else message.info("批量梦境结束，请查看各账号推层结果");
  };

  /**
   * 一键购买梦境商品
   */
  const batchBuyDreamItems = async () => {
    if (selectedTokens.value.length === 0) return;

    if (!isDungeonOpen()) {
      message.warning("当前不是梦境开放时间（周三/周四/周日/周一）");
      return;
    }

    const purchaseList = getDreamPurchaseList();
    if (purchaseList.length === 0) {
      message.warning("请先在设置中配置购买清单");
      return;
    }

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      let connected = false;
      const ownsSlot = tokenStore.getWebSocketStatus(tokenId) !== "connected";
      try {
        if (!isDreamEnabled(tokenId)) {
          tokenStatus.value[tokenId] = "completed";
          addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} 已关闭梦境功能，跳过购买`, type: "info" });
          return;
        }
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始梦境购买: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        connected = true;
        if (shouldStop.value) return;

        await runDreamPurchaseForToken(tokenId, token, purchaseList);

        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 梦境购买失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        if (connected) {
          tokenStore.closeWebSocketConnection(tokenId);
          if (ownsSlot) releaseConnectionSlot();
        }
        if (connected) addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量梦境购买结束");
  };

  return {
    batchmengjing,
    batchBuyDreamItems,
    batchClaimConsumptionRewards,
  };
}
