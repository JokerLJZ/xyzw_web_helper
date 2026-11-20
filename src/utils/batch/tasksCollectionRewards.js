import { loadCollectionRewardConfig, runCollectionRewards } from '../collectionRewards.js';

export function createTasksCollectionRewards(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop, currentRunningTokenId,
    ensureConnection, releaseConnectionSlot, tokenStore, addLog, message, delayConfig } = deps;
  const run = async (cards) => {
    const ids = [...selectedTokens.value];
    if (!ids.length) return;
    isRunning.value = true;
    shouldStop.value = false;
    ids.forEach(id => { tokenStatus.value[id] = 'waiting'; });
    const label = cards ? '卡牌图鉴奖励' : '藏品奖励';
    const checkStop = () => {
      if (shouldStop.value) throw Object.assign(new Error('任务已停止'), { interrupted: true });
    };
    const wait = deps.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(token => token.id === id)?.name || id;
        const log = (text, type = 'info') => addLog({ time: new Date().toLocaleTimeString(), message: `${name} ${text}`, type });
        let connected = false;
        try {
          currentRunningTokenId.value = id;
          tokenStatus.value[id] = 'running';
          await ensureConnection(id);
          connected = true;
          const send = async (cmd, params) => {
            checkStop();
            try { return await tokenStore.sendMessageWithPromise(id, cmd, params, 15000); }
            finally { await wait(Math.max(500, Number(delayConfig?.command) || 0)); }
          };
          const config = await loadCollectionRewardConfig(send);
          checkStop();
          const result = await runCollectionRewards({ send, config, cards, log });
          checkStop();
          tokenStatus.value[id] = 'completed';
          log(`${label}领取完成，共${result.claimed}次${result.skipped ? '，当前没有可领取奖励' : ''}`, 'success');
        } catch (error) {
          tokenStatus.value[id] = error.interrupted || shouldStop.value ? 'stopped' : 'failed';
          log(`${label}：${error.message}`, error.interrupted ? 'info' : 'error');
        } finally {
          if (connected) {
            try { tokenStore.closeWebSocketConnection(id); }
            finally { releaseConnectionSlot(); }
          }
        }
      }
    } finally {
      ids.forEach(id => { if (tokenStatus.value[id] === 'waiting') tokenStatus.value[id] = 'stopped'; });
      currentRunningTokenId.value = null;
      isRunning.value = false;
    }
    message.info(`${label}批量任务结束，请查看账号日志`);
  };
  return {
    batchClaimCollectionRewards: () => run(false),
    batchClaimCardCollectionRewards: () => run(true),
  };
}
