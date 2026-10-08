import { createTasksItem } from "./batch/tasksItem.js";

/** 复用批量灯神流程，但连接由日常任务持有，不在两个阶段之间断开。 */
export async function runDailyGenieChallenges({ tokenId, tokenStore, stopped, log, delaySettings, createTasks = createTasksItem }) {
  let localStopped = false;
  let roleInfo = null;
  const shouldStop = {
    get value() { return localStopped || stopped(); },
    set value(value) { if (value) localStopped = true; },
  };
  const status = { value: {} };
  const store = Object.create(tokenStore);
  store.closeWebSocketConnection = () => {};
  const tasks = createTasks({
    selectedTokens: { value: [tokenId] }, tokens: { value: tokenStore.gameTokens || [] },
    tokenStatus: status, isRunning: { value: true }, shouldStop,
    currentRunningTokenId: { value: tokenId },
    getGenieRoleInfo: async () => {
      if (!roleInfo) roleInfo = await tokenStore.sendGetRoleInfo(tokenId, {}, 2);
      return roleInfo;
    },
    onGenieRoleInfo: (_id, updated) => { roleInfo = updated; },
    ensureConnection: async () => {
      if (shouldStop.value) throw new Error("日常灯神挑战已停止");
      if (tokenStore.getWebSocketStatus(tokenId) !== "connected") throw new Error("日常灯神连接已断开");
    },
    releaseConnectionSlot: () => {}, tokenStore: store,
    connectionQueue: { active: 1 }, batchSettings: { maxActive: 1 }, helperSettings: {},
    delayConfig: { command: delaySettings.commandDelay, action: delaySettings.commandDelay },
    addLog: (entry) => log(entry.message, entry.type),
    message: { success: (text) => log(text), info: (text) => log(text), warning: (text) => log(text, "warning") },
  });
  const failures = [];
  for (const [name, run] of [
    ["魏蜀吴", tasks.batchChallengeThreeKingdomsGenie],
    ["群雄", tasks.batchChallengeGroupGenie],
  ]) {
    if (shouldStop.value) break;
    log(`日常自动灯神：开始${name}阶段`);
    await run();
    if (status.value[tokenId] === "failed") {
      failures.push(name);
      break;
    }
  }
  if (failures.length) throw new Error(`${failures.join("、")}灯神挑战失败，请查看日志`);
}
