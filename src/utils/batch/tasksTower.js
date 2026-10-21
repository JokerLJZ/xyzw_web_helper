import { runWeirdTowerAccount } from "../weirdTowerRunner.js";
/**
 * 爬塔类任务
 * 包含: climbTower, batchWeirdTower, climbWeirdTower, batchClaimFreeEnergy
 */
import { loadRechargeConfig } from "../rechargeActivity.js";
import { runSkinChallenge, SKIN_CHALLENGE_MAX_CONSECUTIVE_FAILURES } from "../skinChallengeRunner.js";
export { SKIN_CHALLENGE_MAX_CONSECUTIVE_FAILURES };


const parseActivityId = (value) => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  return null;
};

export const deriveClaimActivityIds = (challengeActId) => {
  const id = parseActivityId(challengeActId);
  if (id === null) return [];

  return [id % 10 === 1 ? id + 1 : id];
};

/**
 * 创建爬塔类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksTower(deps) {
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
    currentSettings,
    loadSettings,
  } = deps;

  /**
   * 爬塔
   */
  const climbTower = async () => {
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
      // 加载该Token的独立配置，如果未找到则回退到currentSettings
      const tokenSettings = loadSettings ? (loadSettings(tokenId) || currentSettings) : currentSettings;

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始爬塔: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const teamInfo = await tokenStore.sendMessageWithPromise(
          tokenId,
          "presetteam_getinfo",
          {},
          5000,
        );
        if (!teamInfo || !teamInfo.presetTeamInfo) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `阵容信息异常: ${JSON.stringify(teamInfo)}`,
            type: "warning",
          });
        }

        const currentFormation = teamInfo?.presetTeamInfo?.useTeamId;
        let Isswitching = false;
        if (currentFormation === tokenSettings.towerFormation) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `当前已是阵容${tokenSettings.towerFormation}，无需切换`,
            type: "info",
          });
        } else {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_saveteam",
            { teamId: tokenSettings.towerFormation },
            5000,
          );
          Isswitching = true;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `成功切换到阵容${tokenSettings.towerFormation}`,
            type: "info",
          });
        }

        // Initial check
        await tokenStore
          .sendMessageWithPromise(tokenId, "tower_getinfo", {}, 5000)
          .catch(() => {});
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        let energy = roleInfo?.role?.tower?.energy || 0;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 初始体力: ${energy}`,
          type: "info",
        });

        let count = 0;
        const MAX_CLIMB = 100;
        let consecutiveFailures = 0;

        while (energy > 0 && count < MAX_CLIMB && !shouldStop.value) {
          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "fight_starttower",
              {},
              5000,
            );
            count++;
            consecutiveFailures = 0;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 爬塔第 ${count} 次`,
              type: "info",
            });

            await new Promise((r) => setTimeout(r, 1000));

            // Refresh energy
            // 默认每5次刷新一次，或体力不足时刷新
            if (count % 5 === 0) {
               try {
                  roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
                  energy = roleInfo?.role?.tower?.energy || 0;
               } catch (e) {
                 // 忽略刷新失败
               }
            } else {
               // 尝试从本地缓存获取最新的体力信息（如果其他地方更新了）
               const storeRoleInfo = tokenStore.gameData?.roleInfo;
               const storeEnergy = storeRoleInfo?.role?.tower?.energy;
               
               // 如果store中的体力大于当前预计剩余体力，说明可能有额外恢复/奖励，使用store的值
               if (storeEnergy !== undefined && storeEnergy > (energy - 1)) {
                   energy = storeEnergy;
               } else {
                   // 本地扣除体力
                   energy--;
               }
            }
          } catch (err) {
            if (err.message && err.message.includes("200400")) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 操作过快 (200400)，等待5秒后重试...`,
                type: "warning",
              });
              await new Promise((r) => setTimeout(r, 5000));
              continue;
            }

            // 处理"上座塔奖励未领取"错误 (1500040)
            if (err.message && err.message.includes("1500040")) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 上座塔奖励未领取，尝试自动领取并等待...`,
                type: "warning",
              });
              
              // 尝试获取当前塔层数
              try {
                // 如果本地没有roleInfo，尝试获取一次
                if (!roleInfo) {
                   roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
                }
                const towerId = roleInfo?.role?.tower?.id;
                
                if (towerId !== undefined) {
                   const rewardFloor = Math.floor(towerId / 10);
                   if (rewardFloor > 0) {
                      addLog({
                        time: new Date().toLocaleTimeString(),
                        message: `${token.name} 尝试领取第 ${rewardFloor} 层奖励`,
                        type: "info",
                      });
                      // 发送领取请求，不等待响应，因为可能通过事件处理了
                      tokenStore.sendMessage(tokenId, "tower_claimreward", { rewardId: rewardFloor });
                   }
                }
              } catch (e) {
                 // 忽略获取信息失败
              }

              // 等待较长时间让领取生效
              await new Promise((r) => setTimeout(r, 3000));
              
              // 刷新角色信息以更新状态
              try {
                 roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
                 energy = roleInfo?.role?.tower?.energy || 0;
              } catch (e) {}

              // 重置连续失败计数，因为这是一个可恢复的错误
              consecutiveFailures = 0;
              continue;
            }

            consecutiveFailures++;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `战斗出错: ${err.message} (重试 ${consecutiveFailures}/3)`,
              type: "warning",
            });

            if (consecutiveFailures >= 3) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 连续失败次数过多，停止爬塔`,
                type: "error",
              });
              break;
            }

            await new Promise((r) => setTimeout(r, 2000));

            try {
              roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
              energy = roleInfo?.role?.tower?.energy || 0;
            } catch (e) {
              // 忽略刷新失败
            }
          }
        }
        if (Isswitching) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_saveteam",
            { teamId: currentFormation },
            5000,
          );
        }
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 爬塔结束，共 ${count} 次 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 爬塔失败: ${error.message}`,
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
    message.success("批量爬塔结束");
  };

  /** 怪异塔各入口共用账号状态与结果判定；一键流程不再拆成四次查询。 */
  const runWeirdTowerBatch = async (mode, options = {}) => {
    const { tokenIds = selectedTokens.value, manageState = true, manageConnection = true,
      showMessage = true, throwOnError = false } = options;
    if (!tokenIds.length) return;
    if (manageState) {
      isRunning.value = true;
      shouldStop.value = false;
      tokenIds.forEach(id => { tokenStatus.value[id] = "waiting"; });
    }
    try {
      await Promise.all(tokenIds.map(async tokenId => {
        if (shouldStop.value) return;
        const token = tokens.value.find(item => item.id === tokenId);
        const name = token?.name || tokenId;
        let connected = false;
        if (manageState) tokenStatus.value[tokenId] = "running";
        const log = (text, type = "info") => addLog({ time: new Date().toLocaleTimeString(), message: `${name} ${text}`, type });
        try {
          if (manageConnection) { await ensureConnection(tokenId); connected = true; }
          if (shouldStop.value) { if (manageState) tokenStatus.value[tokenId] = "stopped"; return; }
          const send = (cmd, params = {}, timeout = 5000) => tokenStore.sendMessageWithPromise(tokenId, cmd, params, timeout);
          // 配置按版本共用缓存，账号库存、任务和棋盘始终保存在各自的调用内。
          const config = await (deps.loadWeirdTowerConfig || loadRechargeConfig)(send);
          const settings = loadSettings?.(tokenId) || currentSettings;
          const result = await runWeirdTowerAccount({ send, config, mode,
            maxClimbs: batchSettings.weirdTowerClimbCount, formation: settings?.towerFormation,
            now: () => tokenStore.getWebSocketClient?.(tokenId)?.getServerTime?.() ?? Date.now(),
            stopped: () => shouldStop.value, log,
          });
          if (manageState) tokenStatus.value[tokenId] = result.status;
          log(result.status === "stopped" ? "怪异塔已停止" : `怪异塔完成：爬塔${result.climbed}次，使用钥匙${result.used}次，合成${result.merged}次`, result.status === "stopped" ? "warning" : "success");
          return result;
        } catch (error) {
          if (manageState) tokenStatus.value[tokenId] = "failed";
          log(`怪异塔失败：${error.message}`, "error");
          if (throwOnError) throw error;
        } finally {
          if (connected) { tokenStore.closeWebSocketConnection(tokenId); releaseConnectionSlot(); }
        }
      }));
    } finally {
      if (manageState) { isRunning.value = false; currentRunningTokenId.value = null; }
    }
    if (showMessage) message.success("怪异塔批量处理结束");
  };
  const climbWeirdTower = options => runWeirdTowerBatch("climb", options);
  const batchClaimFreeEnergy = options => runWeirdTowerBatch("claim", options);

  /**
   * 换皮闯关
   */
  const skinChallenge = async () => {
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
          message: `=== 开始换皮闯关: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const send = async (cmd, params = {}) => {
          if (shouldStop.value) { const error = new Error("任务已停止"); error.stopped = true; throw error; }
          const result = await tokenStore.sendMessageWithPromise(tokenId, cmd, params, 10000);
          await new Promise(resolve => setTimeout(resolve, 500));
          return result;
        };
        const now = () => tokenStore.getWebSocketClient?.(tokenId)?.getServerTime?.() ?? Date.now();
        const config = await loadRechargeConfig(send);
        const activity = Object.values(config.ActFestivalConf || {}).filter(row => row.actType === 19 && Number(row.actGroup || 0) === 0 && row.start * 1000 <= now() && now() < row.end * 1000).sort((a, b) => b.start - a.start)[0];
        if (!activity) {
          addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} 当前没有开放的换皮闯关活动`, type: "info" });
          tokenStatus.value[tokenId] = "skipped";
          return;
        }
        const challengeActId = activity.id;
        await runSkinChallenge({ send, config, activity, now, stopped: () => shouldStop.value,
          log: text => addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} ${text}`, type: "info" }),
        });

        // 闯关结束后循环领取奖励
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 闯关结束，开始领取奖励`,
          type: "info",
        });
        let claimCount = 0;
        const claimActIds = deriveClaimActivityIds(challengeActId);
        if (claimActIds.length === 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 无法根据闯关活动ID生成领奖活动ID，跳过自动领奖`,
            type: "warning",
          });
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 使用闯关活动ID推导领奖ID：${claimActIds.join(",")}`,
            type: "info",
          });
        }

        for (const claimActId of claimActIds) {
          let activityClaimCount = 0;
          try {
            while (!shouldStop.value) {
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_startactegame",
                { actId: claimActId },
                5000,
              );
              claimCount++;
              activityClaimCount++;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 活动 ${claimActId} 领取奖励第 ${activityClaimCount} 次`,
                type: "success",
              });
              await new Promise((r) => setTimeout(r, 300));
            }
          } catch (e) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 活动 ${claimActId} 领取结束（共 ${activityClaimCount} 次）`,
              type: activityClaimCount > 0 ? "success" : "info",
            });
          }
        }
        if (claimCount > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 领取奖励 ${claimCount} 次`,
            type: "success",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 换皮闯关结束 ===`,
          type: "success",
        });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";

        let errorMessage = error.message;
        if (errorMessage && errorMessage.includes("200330")) {
           errorMessage = "存在未完成的挑战，需要手动处理";
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 换皮闯关失败: ${errorMessage}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 断开连接`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
  };

  const batchUseItems = options => runWeirdTowerBatch("use", options);
  const batchMergeItems = options => runWeirdTowerBatch("merge", options);
  const batchWeirdTower = () => runWeirdTowerBatch("all");

  return {
    climbTower,
    climbWeirdTower,
    batchWeirdTower,
    batchClaimFreeEnergy,
    skinChallenge,
    batchUseItems,
    batchMergeItems,
  };
}

/**
 * 批量使用道具
 * @param {Object} deps
 */
function batchUseItems(deps) {
  // logic to be implemented inside createTasksTower or moved here if refactored
  // But based on the file structure, I should add it inside createTasksTower
}
