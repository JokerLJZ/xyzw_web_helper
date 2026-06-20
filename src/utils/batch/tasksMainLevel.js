/**
 * 主线推图信息类任务
 * 包含: batchPushMainLevelInfo
 */

import { sendWxPusherMessage } from "../wxpusher.js";

const escapeMarkdownTableCell = (value) =>
  String(value ?? "-").replace(/\|/g, "\\|");

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
  const title = `主线关卡信息 (${completed}/${total})`;

  const lines = [
    `## 主线推图当前关卡信息`,
    ``,
    `| 项目 | 数值 |`,
    `|------|------|`,
    `| 总账号 | ${total} |`,
    `| 成功 | ${completed} |`,
    `| 失败 | ${failed} |`,
    `| 耗时 | ${duration}秒 |`,
    `| 推送时间 | ${new Date().toLocaleString()} |`,
    ``,
    `| 账号 | 区服 | 当前关卡 | 敌方等级 | 战斗版本 | 随机种子 | 状态 |`,
    `|------|------|----------|----------|----------|----------|------|`,
  ];

  results.forEach((item) => {
    const cells = [
      item.name,
      item.server,
      item.levelId,
      item.enemyLevel,
      item.battleVersion,
      item.randomSeed,
      item.error || "成功",
    ].map(escapeMarkdownTableCell);

    lines.push(
      `| ${cells[0]} | ${cells[1]} | ${cells[2]} | ${cells[3]} | ${cells[4]} | ${cells[5]} | ${cells[6]} |`,
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
        message: "WxPusher 未启用或配置不完整，已跳过主线关卡信息推送",
        type: "warning",
      });
      message.warning("WxPusher 未启用或配置不完整，已跳过推送");
      return;
    }

    const { title, content } = formatMainLevelNotification(results, startTime);
    await sendWxPusherMessage(
      {
        appToken: batchSettings.wxpusherAppToken,
        uids: batchSettings.wxpusherUids,
      },
      title,
      content,
    );

    addLog({
      time: new Date().toLocaleTimeString(),
      message: "主线关卡信息已推送到 WxPusher",
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
