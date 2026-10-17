import { createApexDailySender, runApexGuessTask } from "../apexDailyTask.js";
/**
 * 逐鹿盐山竞猜任务
 * 包含: 一键批量竞猜（自动选助威最高队伍）
 *
 * 开放判定复用 utils/apexRules.js（1:1 移植客户端规则）：
 *   · 仅淘汰赛阶段（stage 4~10）且状态为 Unlocked / Locked 的场次可押；
 *   · 每阶段可押队伍数上限 = 该阶段 advanceNum（季军赛恒为 1）；
 *   · 分页 idx = 已加载条数，以响应 last 终止。
 */

import {
  ApexScheduleStatus,
  getCurrentRounds,
  getCurrentSeason,
  getGuessTabs,
} from "@/utils/apexRules";
/**
 * 解析当前赛季「竞猜开放中」的阶段页签。
 *
 * 逐期扫描所有「进行中」的期（历史期已全部结束，不含开放场次）：
 * 报名期与淘汰赛期在时间上是重叠的，只取默认一期会漏掉另一期已开押的阶段
 * （例：第 5 期报名中、第 4 期淘汰赛已开押）。期号与阶段全部由配置推导。
 *
 * @param {number} nowMs 服务端时间
 * @returns {Array<{season: number, round: number, tabs: Array}>} 所有存在开放场次的期次
 */
export const collectOpenGuessRounds = (season, rounds, nowMs, resolveTabs) => {
  const openRounds = [];
  for (const round of rounds) {
    const tabs = resolveTabs(round, season, nowMs).filter(
      (t) =>
        t.state === ApexScheduleStatus.Unlocked ||
        t.state === ApexScheduleStatus.Locked,
    );
    if (tabs.length) openRounds.push({ season, round, tabs });
  }
  return openRounds;
};

export const resolveOpenGuessRounds = (nowMs) => {
  const season = getCurrentSeason(nowMs);
  if (season <= 0) return [];
  return collectOpenGuessRounds(
    season,
    getCurrentRounds(season, nowMs),
    nowMs,
    getGuessTabs,
  );
};

/**
 * 创建逐鹿盐山竞猜任务执行器
 * @param {object} deps - 依赖项
 * @returns {object} 任务函数集合
 */
export function createTasksApex(deps) {
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

  /**
   * 一键批量逐鹿盐山竞猜
   * 自动选每组对阵中助威数最高的队伍
   */
  const batchApexGuess = async () => {
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
        await ensureConnection(tokenId);

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始逐鹿盐山竞猜: ${token.name} ===`,
          type: "info",
        });

        const result = await runApexGuessTask({
          accountId: tokenId,
          stopped: () => shouldStop.value,
          send: createApexDailySender({
            stopped: () => shouldStop.value,
            send: (command, params) => tokenStore.sendMessageWithPromise(tokenId, command, params, 15000),
            log: text => addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} ${text}`, type: "info" }),
          }),
          log: text => addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} ${text}`, type: "success" }),
          ...(deps.apexOptions || {}),
        });
        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
        addLog({ time: new Date().toLocaleTimeString(), message: `${token.name} ${result.reason}`, type: "info" });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 逐鹿盐山竞猜失败: ${error.message}`,
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
    message.success("批量逐鹿盐山竞猜结束");
  };

  return {
    batchApexGuess,
  };
}
