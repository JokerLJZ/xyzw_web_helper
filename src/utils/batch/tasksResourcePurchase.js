import { runMondayResourcePurchase } from '../mondayResourcePurchase.js';

export function createTasksResourcePurchase(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop, currentRunningTokenId,
    ensureConnection, releaseConnectionSlot, tokenStore, addLog, message, delayConfig } = deps;
  const batchBuyRedFragmentsAndPetCookies = async () => {
    const ids = [...selectedTokens.value];
    if (!ids.length) return;
    isRunning.value = true;
    shouldStop.value = false;
    ids.forEach(id => { tokenStatus.value[id] = 'waiting'; });
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(t => t.id === id)?.name || id;
        const log = (text,type='info') => addLog({time:new Date().toLocaleTimeString(),message:`${name} ${text}`,type});
        let connected = false;
        try {
          tokenStatus.value[id] = 'running';
          currentRunningTokenId.value = id;
          await ensureConnection(id);
          connected = true;
          await runMondayResourcePurchase({
            onlyMonday:false, shouldStop:()=>shouldStop.value,
            send:(cmd,params)=>tokenStore.sendMessageWithPromise(id,cmd,params,15000),
            wait:ms=>new Promise(resolve=>setTimeout(resolve,Math.max(ms,Number(delayConfig?.command)||0))),
            log,
          });
          tokenStatus.value[id] = shouldStop.value ? 'stopped' : 'completed';
        } catch(error) {
          tokenStatus.value[id] = 'failed';
          log(`万能红碎片及成长脆饼采购失败：${error.message}，未自动重试`,'error');
        } finally {
          if (connected) {
            try { tokenStore.closeWebSocketConnection(id); }
            finally { releaseConnectionSlot(); }
          }
        }
      }
    } finally {
      ids.forEach(id=>{if(tokenStatus.value[id]==='waiting')tokenStatus.value[id]='stopped';});
      isRunning.value=false;
      currentRunningTokenId.value=null;
    }
    message.info('万能红碎片及成长脆饼批量采购结束，请查看账号日志');
  };
  return { batchBuyRedFragmentsAndPetCookies };
}
