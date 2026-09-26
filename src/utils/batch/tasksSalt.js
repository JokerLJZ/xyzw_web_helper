/**
 * 盐场类任务
 * 包含: batchSaltSignup
 */

const formatUnixTime = (timestamp) => {
  if (!timestamp) return "未知";
  return new Date(timestamp * 1000).toLocaleString();
};

const isAlreadySignedError = (error) => {
  const messageText = String(error?.message || error || "").toLowerCase();
  return ["已报名", "已经报名", "already signed", "signed up"].some((keyword) =>
    messageText.includes(keyword.toLowerCase()),
  );
};

/**
 * 创建盐场类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksSalt(deps) {
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

  /**
   * 批量盐场报名
   */
  const batchSaltSignup = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);
      const tokenName = token?.name || tokenId;

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始盐场报名: ${tokenName} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        if (shouldStop.value) return;

        const battlefieldResp = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_getbattlefield",
          {},
          8000,
        );
        const battlefieldInfo = battlefieldResp?.info;

        if (!battlefieldInfo?.phase) {
          skippedCount++;
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 暂无可报名盐场，跳过`,
            type: "warning",
          });
          return;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const startTime = battlefieldInfo.signupStartTime || 0;
        const endTime = battlefieldInfo.signupEndTime || 0;

        if (startTime && nowSec < startTime) {
          skippedCount++;
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 盐场报名尚未开始 (${formatUnixTime(startTime)})，跳过`,
            type: "warning",
          });
          return;
        }

        if (endTime && nowSec > endTime) {
          skippedCount++;
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 盐场报名已结束 (${formatUnixTime(endTime)})，跳过`,
            type: "warning",
          });
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 当前盐场期次 ${battlefieldInfo.phase}，报名窗口 ${formatUnixTime(startTime)} - ${formatUnixTime(endTime)}`,
          type: "info",
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_signup",
          {},
          8000,
        );
        await new Promise((r) =>
          setTimeout(
            r,
            delayConfig?.action || batchSettings.commandDelay || 500,
          ),
        );

        successCount++;
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${tokenName} 盐场报名已完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);

        if (isAlreadySignedError(error)) {
          skippedCount++;
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `=== ${tokenName} 已报名盐场，跳过 ===`,
            type: "warning",
          });
          return;
        }

        failedCount++;
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 盐场报名失败: ${error.message || "未知错误"}`,
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
    shouldStop.value = false;
    currentRunningTokenId.value = null;
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `=== 批量盐场报名完成: 成功 ${successCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个 ===`,
      type: failedCount > 0 ? "warning" : "success",
    });
    message.success(
      `批量盐场报名结束，成功 ${successCount} 个，跳过 ${skippedCount} 个，失败 ${failedCount} 个`,
    );
  };

  return {
    batchSaltSignup,
  };
}
