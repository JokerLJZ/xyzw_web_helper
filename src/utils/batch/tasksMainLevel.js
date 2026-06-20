/**
 * 主线推图信息类任务
 * 包含: batchPushMainLevelInfo
 */

import { sendWxPusherMessage } from "../wxpusher.js";

const MAIN_LEVEL_HISTORY_KEY = "mainLevelInfoHistory";

const escapeMarkdownTableCell = (value) =>
  String(value ?? "-").replace(/\|/g, "\\|");

const toFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const loadMainLevelHistory = () => {
  try {
    const saved = localStorage.getItem(MAIN_LEVEL_HISTORY_KEY);
    if (!saved) return {};

    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Failed to load main level history:", error);
    return {};
  }
};

const saveMainLevelHistory = (history) => {
  try {
    localStorage.setItem(MAIN_LEVEL_HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn("Failed to save main level history:", error);
  }
};

const toNumberList = (value) =>
  Object.values(value || {})
    .map((item) => Number(item?.level))
    .filter((level) => Number.isFinite(level));

const getEnemyLevelText = (battleData) => {
  const levels = toNumberList(battleData?.rightTeam?.team);
  if (levels.length === 0) return "-";

  const min = Math.min(...levels);
  const max = Math.max(...levels);
  return min === max ? String(max) : `${min}-${max}`;
};

const extractMainLevelInfo = (token, result) => {
  const battleData =
    result?.battleData ||
    result?._raw?.body?.battleData ||
    result?.body?.battleData ||
    null;
  const options = battleData?.options || {};

  return {
    tokenId: token?.id || "",
    name: token?.name || token?.id || "未知账号",
    server: token?.server || "-",
    levelId: options.levelId ?? result?.levelId ?? "-",
    battleVersion: battleData?.version ?? "-",
    randomSeed: battleData?.randomSeed ?? "-",
    enemyLevel: getEnemyLevelText(battleData),
    error: "",
  };
};

const getLevelDeltaText = (previousLevelId, levelDelta) => {
  if (previousLevelId === null) return "首次记录";
  if (levelDelta === null) return "-";
  return levelDelta > 0 ? `+${levelDelta}` : String(levelDelta);
};

const attachMainLevelComparison = (results, history) =>
  results.map((item) => {
    const currentLevelId = toFiniteNumber(item.levelId);
    const previousLevelId = toFiniteNumber(history[item.tokenId]?.levelId);
    const levelDelta =
      currentLevelId !== null && previousLevelId !== null
        ? currentLevelId - previousLevelId
        : null;

    return {
      ...item,
      previousLevelId: previousLevelId ?? "-",
      levelDelta,
      levelDeltaText: item.error
        ? "-"
        : getLevelDeltaText(previousLevelId, levelDelta),
    };
  });

const updateMainLevelHistory = (history, results) => {
  const nextHistory = { ...history };

  results.forEach((item) => {
    if (item.error) return;

    const levelId = toFiniteNumber(item.levelId);
    if (levelId === null) return;

    nextHistory[item.tokenId] = {
      levelId,
      name: item.name,
      server: item.server,
      pushedAt: new Date().toISOString(),
    };
  });

  saveMainLevelHistory(nextHistory);
};

const hasMainLevelInfo = (result) =>
  Boolean(
    result?.battleData ||
      result?._raw?.body?.battleData ||
      result?.body?.battleData,
  );

const formatMainLevelNotification = (results, startTime) => {
  const total = results.length;
  const completed = results.filter((item) => !item.error).length;
  const failed = total - completed;
  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const progressed = results.filter((item) => item.levelDelta > 0).length;
  const title = `主线关卡信息获取 (${completed}/${total})`;

  const lines = [
    `## 主线关卡信息获取`,
    ``,
    `| 项目 | 数值 |`,
    `|------|------|`,
    `| 总账号 | ${total} |`,
    `| 成功 | ${completed} |`,
    `| 失败 | ${failed} |`,
    `| 推关增加账号 | ${progressed} |`,
    `| 耗时 | ${duration}秒 |`,
    `| 推送时间 | ${new Date().toLocaleString()} |`,
    ``,
    `| 账号 | 区服 | 当前关卡 | 上次关卡 | 增加数量 | 状态 |`,
    `|------|------|----------|----------|----------|------|`,
  ];

  results.forEach((item) => {
    const cells = [
      item.name,
      item.server,
      item.levelId,
      item.previousLevelId,
      item.levelDeltaText,
      item.error || "成功",
    ].map(escapeMarkdownTableCell);

    lines.push(
      `| ${cells[0]} | ${cells[1]} | ${cells[2]} | ${cells[3]} | ${cells[4]} | ${cells[5]} |`,
    );
  });

  return { title, content: lines.join("\n") };
};

export function createTasksMainLevel(deps) {
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

  const pushMainLevelInfo = async (results, startTime) => {
    if (
      !batchSettings.wxpusherEnabled ||
      !batchSettings.wxpusherAppToken ||
      !batchSettings.wxpusherUids
    ) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: "WxPusher 未启用或配置不完整，已跳过主线关卡信息获取推送",
        type: "warning",
      });
      message.warning("WxPusher 未启用或配置不完整，已跳过推送");
      return;
    }

    const history = loadMainLevelHistory();
    const comparedResults = attachMainLevelComparison(results, history);
    const { title, content } = formatMainLevelNotification(
      comparedResults,
      startTime,
    );

    await sendWxPusherMessage(
      {
        appToken: batchSettings.wxpusherAppToken,
        uids: batchSettings.wxpusherUids,
      },
      title,
      content,
    );
    updateMainLevelHistory(history, comparedResults);

    addLog({
      time: new Date().toLocaleTimeString(),
      message: "主线关卡信息获取已推送到 WxPusher",
      type: "success",
    });
  };

  const batchPushMainLevelInfo = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    const startTime = new Date();
    const results = [];

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
          message: `=== 开始获取主线关卡信息: ${tokenName} ===`,
          type: "info",
        });

        const initResult = await ensureConnection(tokenId);
        if (shouldStop.value) return;

        const result = hasMainLevelInfo(initResult)
          ? initResult
          : await tokenStore.sendMessageWithPromise(
              tokenId,
              "fight_startlevel",
              {},
              8000,
            );
        const info = extractMainLevelInfo(token, result);
        results.push(info);

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 当前主线关卡: ${info.levelId}`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        results.push({
          tokenId,
          name: tokenName,
          server: token?.server || "-",
          levelId: "-",
          battleVersion: "-",
          randomSeed: "-",
          enemyLevel: "-",
          error: error.message || "未知错误",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 获取主线关卡信息失败: ${error.message || "未知错误"}`,
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

    results.sort((a, b) => {
      const aIndex = selectedTokens.value.indexOf(a.tokenId);
      const bIndex = selectedTokens.value.indexOf(b.tokenId);
      return aIndex - bIndex;
    });

    try {
      await pushMainLevelInfo(results, startTime);
    } catch (error) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `主线关卡信息推送失败: ${error.message || "未知错误"}`,
        type: "error",
      });
      message.error(`主线关卡信息推送失败: ${error.message || "未知错误"}`);
    }

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量获取主线关卡信息结束");
  };

  return {
    batchPushMainLevelInfo,
  };
}
