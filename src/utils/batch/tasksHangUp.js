/**
 * 挂机、答题、签到类任务
 * 包含: claimHangUpRewards, batchUpgradeHangUpAndClaimOrderRewards, claimHangUpRewardsFiveTimes, batchAddHangUpTime, batchStudy, batchclubsign
 */

import {
  claimAvailableHangUpOrderRewards,
  formatHangUpOrderRewards,
} from "@/utils/hangUpOrderRewards";

/**
 * 创建挂机、答题、签到类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksHangUp(deps) {
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
  } = deps;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const HANG_UP_UPGRADE_ITEM_ID = 1024;

  const getItemQuantity = (roleInfo, itemId) => {
    const items =
      roleInfo?.role?.items || roleInfo?.body?.role?.items || roleInfo?.items;
    if (Array.isArray(items)) {
      const item = items.find(
        (entry) => Number(entry?.id ?? entry?.itemId) === Number(itemId),
      );
      return Number(item?.quantity ?? item?.num ?? item?.count ?? 0) || 0;
    }
    const item = items?.[itemId] ?? items?.[String(itemId)];
    return Number(item?.quantity ?? item?.num ?? item?.count ?? item ?? 0) || 0;
  };

  const isRateLimitError = (error) => {
    const text = String(error?.message || error || "");
    return text.includes("200400") || text.includes("操作太快");
  };

  const upgradeHangUpBeforeClaim = async (tokenId, tokenName) => {
    const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
    let remaining = getItemQuantity(roleInfo, HANG_UP_UPGRADE_ITEM_ID);
    if (remaining <= 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 当前没有可用知识币，跳过挂机升级`,
        type: "info",
      });
      return 0;
    }

    const initialQuantity = remaining;
    let used = 0;
    while (remaining > 0 && !shouldStop.value) {
      const upgradeNum = remaining >= 50 ? 50 : remaining >= 10 ? 10 : 1;
      let succeeded = false;
      for (let attempt = 0; attempt <= 4; attempt += 1) {
        try {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "system_hangupupgrade",
            { upgradeNum },
            5000,
          );
          succeeded = true;
          break;
        } catch (error) {
          if (!isRateLimitError(error) || attempt >= 4) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 当前无法继续挂机升级，已使用${used}/${initialQuantity}个知识币：${error.message || error}`,
              type: "warning",
            });
            return used;
          }
          await sleep(6000);
        }
      }
      if (!succeeded) break;
      remaining -= upgradeNum;
      used += upgradeNum;
      await sleep(1200);
    }

    if (used > 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 挂机升级完成，共使用${used}个知识币`,
        type: "success",
      });
    }
    return used;
  };

  const addHangUpTimeForToken = async (tokenId, tokenName, actionText) => {
    for (let i = 0; i < 4; i++) {
      if (shouldStop.value) break;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${actionText} ${i + 1}/4`,
        type: "info",
      });
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "system_mysharecallback",
        { isSkipShareCard: true, type: 2 },
        5000,
      );
      await sleep(500);
    }
  };

  const claimHangUpOrderRewards = async (tokenId, tokenName) => {
    try {
      const result = await claimAvailableHangUpOrderRewards(tokenStore, tokenId);
      if (!result.claimed) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 当前没有可领取的整数关卡挂机奖励（已领取至第${result.before.lastClaimedOrder}档）`,
          type: "info",
        });
        return result;
      }

      const rewardText = formatHangUpOrderRewards(result.rewards);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 整数关卡挂机奖励领取完成：第${result.before.lastClaimedOrder + 1}-${result.before.activeOrder}档${rewardText ? `，${rewardText}` : ""}`,
        type: "success",
      });
      return result;
    } catch (error) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 整数关卡挂机奖励检查或领取失败：${error.message || error}`,
        type: "warning",
      });
      return null;
    }
  };

  /**
   * 小号任务：使用知识币升级挂机收益，并检查、领取整数关卡挂机奖励。
   */
  const batchUpgradeHangUpAndClaimOrderRewards = async () => {
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

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始挂机升级及整数关卡奖励任务: ${tokenName} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        await upgradeHangUpBeforeClaim(tokenId, tokenName);
        if (!shouldStop.value) {
          await claimHangUpOrderRewards(tokenId, tokenName);
        }
        tokenStatus.value[tokenId] = shouldStop.value
          ? "stopped"
          : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 挂机升级及整数关卡奖励任务完成 ===`,
          type: "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 挂机升级及整数关卡奖励任务失败: ${error.message || error}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("挂机升级及整数关卡奖励任务结束");
  };

  /**
   * 领取挂机奖励
   */
  const claimHangUpRewards = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取挂机: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 1. Claim reward
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取挂机奖励`,
          type: "info",
        });
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "system_claimhangupreward",
          {},
          5000,
        );
        await sleep(500);

        // 2. Add time 4 times
        await addHangUpTimeForToken(tokenId, token.name, "挂机加钟");

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取挂机奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取挂机奖励失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取挂机结束");
  };

  /**
   * 连续领取五次挂机奖励后加钟
   */
  const claimHangUpRewardsFiveTimes = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);
      const tokenName = token?.name || tokenId;

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始五次领取挂机: ${tokenName} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (let i = 0; i < 5; i++) {
          if (shouldStop.value) break;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 领取挂机奖励 ${i + 1}/5`,
            type: "info",
          });
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "system_claimhangupreward",
            {},
            5000,
          );

          if (i < 4 && !shouldStop.value) {
            await sleep(6000);
          }
        }

        if (!shouldStop.value) {
          await addHangUpTimeForToken(tokenId, tokenName, "挂机加钟");
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 五次领取挂机完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 五次领取挂机失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量五次领取挂机结束");
  };

  /**
   * 一键加钟
   */
  const batchAddHangUpTime = async () => {
    if (selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键加钟: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        await addHangUpTimeForToken(tokenId, token.name, "执行加钟");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 加钟完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 加钟失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量加钟结束");
  };

  /**
   * 一键答题
   */
  const batchStudy = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    // Preload questions
    const { preloadQuestions } = await import("@/utils/studyQuestionsFromJSON.js");
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `正在加载题库...`,
      type: "info",
    });
    await preloadQuestions();

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始答题: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // Reset local study status
        tokenStore.gameData.studyStatus = {
          isAnswering: false,
          questionCount: 0,
          answeredCount: 0,
          status: "",
          timestamp: null,
        };

        // Send start command
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "study_startgame",
          {},
          5000,
        );

        // Wait for completion
        let maxWait = 90;
        let completed = false;
        let lastStatus = "";

        while (maxWait > 0 && !shouldStop.value) {
          const status = tokenStore.gameData.studyStatus;

          if (status.status !== lastStatus) {
            lastStatus = status.status;
            if (status.status === "answering") {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 开始答题...`,
                type: "info",
              });
            } else if (status.status === "claiming_rewards") {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 领取奖励...`,
                type: "info",
              });
            }
          }

          if (status.status === "completed") {
            completed = true;
            break;
          }

          await new Promise((r) => setTimeout(r, 1000));
          maxWait--;
        }

        if (completed) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 答题完成 ===`,
            type: "success",
          });
        } else {
          if (shouldStop.value) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 已停止`,
              type: "warning",
            });
          } else {
            tokenStatus.value[tokenId] = "failed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 答题超时或未开始`,
              type: "error",
            });
          }
        }
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `答题失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量答题结束");
  };

  /**
   * 一键俱乐部签到
   */
  const batchclubsign = async () => {
    if (selectedTokens.value.length === 0) return;
    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始一键俱乐部签到: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        if (shouldStop.value) return;
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_signin",
          {},
          5000,
        );
        await new Promise((r) => setTimeout(r, 500));
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 俱乐部签到已完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 俱乐部签到失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量俱乐部签到结束");
  };

  /**
   * 月赛助威
   * @param {number} legionId - 俱乐部ID
   * @param {number} guessCoin - 竞猜币数量
   */
  const batchWarGuessCheer = async (legionId, guessCoin) => {
    if (selectedTokens.value.length === 0) {
      message.warning("请先选择账号");
      return;
    }
    if (!legionId) {
      message.warning("请选择要助威的俱乐部");
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
      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始助威: ${token.name} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        
        // 尝试领取拍手器
        try {
          const rewardRes = await tokenStore.sendMessageWithPromise(
            tokenId,
            "warguess_getguesscoinreward",
            {},
            3000 // 短超时，因为这不是关键步骤
          );
          if (rewardRes && rewardRes.reward) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `=== ${token.name} 领取拍手器成功 ===`,
              type: "success",
            });
          }
        } catch (e) {
          // 忽略领取失败
          // console.warn("领取拍手器失败", e);
        }

        // 获取助威数据以判断次数
        const rankRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "warguess_getrank",
          { bfId: '' },
          5000,
        );

        let totalGuessNum = 0;
        if (rankRes && rankRes.list) {
          let list = [];
          if (Array.isArray(rankRes.list)) {
            list = rankRes.list;
          } else {
            list = Object.values(rankRes.list);
          }
          totalGuessNum = list.reduce((sum, item) => sum + (item.guessNum || 0), 0);
        }

        if (totalGuessNum === 20) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 助威次数已满 (${totalGuessNum}/20)，跳过 ===`,
                type: "warning",
              });
             tokenStatus.value[tokenId] = "completed";
             return;
        }

        let coinToUse = Number(guessCoin);
        const remaining = 20 - totalGuessNum;
        
        if (coinToUse > remaining) {
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 剩余助威次数不足，调整为 ${remaining} 次 (原计划: ${coinToUse}) ===`,
                type: "info",
            });
            coinToUse = remaining;
        }

        if (coinToUse <= 0) {
             tokenStatus.value[tokenId] = "completed";
             return;
        }

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "warguess_startguess",
          { guessCoin: coinToUse, legionId: legionId },
          5000,
        );

        if (result && result.guessLegion) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 助威成功 (当前次数: ${result.guessLegion.guessNum}/20) ===`,
                type: "success",
              });
             tokenStatus.value[tokenId] = "completed";
        } else {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `=== ${token.name} 助威失败 ===`,
                type: "error",
              });
             tokenStatus.value[tokenId] = "failed";
        }
      } catch (error) {
        console.error(error);
        
        // Handle specific error: 400000 - Item does not exist (feature locked)
        if (error.code === 400000 || (error.message && error.message.includes("400000"))) {
          tokenStatus.value[tokenId] = "completed"; // Mark as completed (skipped)
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${token.name} 助威失败: 未解锁该功能===`,
            type: "warning",
          });
        } else {
          tokenStatus.value[tokenId] = "failed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 助威失败: ${error.message || "未知错误"}`,
            type: "error",
          });
        }
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量助威结束");
  };

  return {
    claimHangUpRewards,
    batchUpgradeHangUpAndClaimOrderRewards,
    claimHangUpRewardsFiveTimes,
    batchAddHangUpTime,
    batchStudy,
    batchclubsign,
    batchWarGuessCheer,
  };
}
