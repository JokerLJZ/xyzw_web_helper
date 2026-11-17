import { runDailyMatchRoom } from "../dailyMatchRoom.js";

export function createTasksMatchRoom(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
    ensureConnection, releaseConnectionSlot, tokenStore, addLog,
    currentRunningTokenId, message } = deps;
  const batchMatchRoom = async () => {
    if (!selectedTokens.value.length) return;
    const ids = [...selectedTokens.value];
    isRunning.value = true;
    shouldStop.value = false;
    for (const id of ids) tokenStatus.value[id] = "waiting";
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(token => token.id === id)?.name || id;
        const log = (text, type = "info") => addLog({time:new Date().toLocaleTimeString(),message:`${name}: ${text}`,type});
        currentRunningTokenId.value = id;
        tokenStatus.value[id] = "running";
        let connected = false;
        try {
          await ensureConnection(id);
          connected = true;
          const result = await runDailyMatchRoom({
            send: async (cmd, params) => {
              if (shouldStop.value) throw new Error("任务已停止");
              await new Promise(resolve => setTimeout(resolve, Math.max(500, Number(deps.delayConfig?.command) || 0)));
              if (shouldStop.value) throw new Error("任务已停止");
              return tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
            },
            now: () => tokenStore.getWebSocketClient?.(id)?.getServerTime?.() ?? Date.now(),
          });
          tokenStatus.value[id] = "completed";
          log(`比赛房间关注及奖励：${result.reason}`, result.status === "success" ? "success" : "info");
        } catch (error) {
          tokenStatus.value[id] = shouldStop.value ? "stopped" : "failed";
          log(`比赛房间关注及奖励：${error.message}`, shouldStop.value ? "info" : "error");
        } finally {
          if (connected) {
            try { tokenStore.closeWebSocketConnection(id); }
            finally { releaseConnectionSlot(); }
          }
        }
      }
    } finally {
      for (const id of ids) if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "stopped";
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    message.success("比赛房间关注及奖励任务结束");
  };
  return { batchMatchRoom };
}
