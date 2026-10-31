import { ref } from "vue";
import { loadRechargeConfig, loadRechargeExchangeCatalog, exchangeRechargeItems, runRechargeStandard } from "../rechargeActivity.js";

export function createTasksRecharge(deps, options = {}) {
  const label = options.label || "充值活动";
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop, currentRunningTokenId, tokenStore, ensureConnection, releaseConnectionSlot, addLog, message } = deps;
  const rechargeExchangeOpen = ref(false);
  const rechargeExchangePreviews = ref([]);
  const log = (text, type = "info") => addLog({ time: new Date().toLocaleTimeString(), message: text, type });
  async function batch(run) {
    const scheduled = deps.isScheduled?.() || false;
    if ((isRunning.value && !scheduled) || !selectedTokens.value.length) return;
    isRunning.value = true;
    if (!scheduled) shouldStop.value = false;
    const ids = [...selectedTokens.value];
    let failed = 0;
    ids.forEach(id => tokenStatus.value[id] = "waiting");
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        let owned = tokenStore.getWebSocketStatus(id) !== "connected";
        let connected = false;
        const name = tokens.value.find(token => token.id === id)?.name || id;
        tokenStatus.value[id] = "running";
        currentRunningTokenId.value = id;
        try {
          await ensureConnection(id, 2, ownsSlot => { owned = ownsSlot; });
          connected = true;
          let serverOffset = 0;
          const send = async (cmd, params = {}) => {
            if (shouldStop.value) { const error = new Error("任务已停止"); error.stopped = true; throw error; }
            let result;
            try { result = await tokenStore.sendMessageWithPromise(id, cmd, params, 15000); }
            catch (error) {
              // WebSocket 客户端将带明确错误码的响应转为此格式的拒绝。
              if (/^服务器错误: \d+ - /.test(error.message)) error.serverRejected = true;
              throw error;
            }
            const timestamp = Number(result?._raw?.time);
            if (timestamp > 1e12) serverOffset = timestamp - Date.now();
            const code = result?._raw?.code ?? result?.code;
            if (code) { const error = new Error(`服务器返回错误${code}`); error.serverRejected = true; throw error; }
            await new Promise(resolve => setTimeout(resolve, 500));
            return result;
          };
          const config = await loadRechargeConfig(send);
          const result = await run({ id, name, send, config, now: () => tokenStore.getWebSocketClient?.(id)?.getServerTime?.() ?? (Date.now() + serverOffset), log: text => log(`${name}：${text}`) });
          tokenStatus.value[id] = result?.status || "completed";
          if (result?.status === "failed") failed++;
          if (result?.reason) log(`${name}：${result.reason}`, result.status === "failed" ? "error" : "info");
        } catch (error) {
          failed++;
          tokenStatus.value[id] = shouldStop.value ? "skipped" : "failed";
          log(`${name}：${error.message}`, "error");
        } finally {
          if (owned && connected && !deps.isScheduledSession?.(id)) {
            try { tokenStore.closeWebSocketConnection(id); } finally { releaseConnectionSlot(); }
          }
        }
      }
      for (const id of ids) if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "skipped";
    } finally {
      if (!scheduled) {
        isRunning.value = false;
        currentRunningTokenId.value = null;
      }
    }
    if (scheduled) return;
    if (shouldStop.value) message.info(`${label}任务已停止`);
    else if (failed) message.warning(`${label}处理结束，${failed}个账号未全部完成，请查看日志`);
    else message.success(`${label}处理结束`);
  }
  const batchRechargeStandard = () => batch(context => (options.runStandard || runRechargeStandard)(context));
  const queryRechargeExchangeItems = async () => {
    if (isRunning.value) return;
    rechargeExchangePreviews.value = [];
    if (options.queryExchange) {
      await batch(async context => {
        const snapshot = await options.queryExchange(context.send, context.config, context.now());
        rechargeExchangePreviews.value.push({ ...snapshot, tokenId: context.id, tokenName: context.name });
      });
      if (rechargeExchangePreviews.value.length && !shouldStop.value) rechargeExchangeOpen.value = true;
      return;
    }
    isRunning.value = true;
    try {
      const catalog = await (options.loadCatalog || loadRechargeExchangeCatalog)();
      rechargeExchangePreviews.value = [catalog];
      rechargeExchangeOpen.value = true;
    } catch (error) {
      message.warning(`兑换物品清单加载失败：${error.message}`);
    } finally { isRunning.value = false; }
  };
  const batchRechargeExchange = async selection => {
    if (!selection.length || isRunning.value) return;
    const previews = rechargeExchangePreviews.value;
    const catalog = previews[0];
    if (!catalog) return;
    if (options.queryExchange && selectedTokens.value.some(id => !previews.some(row => row.tokenId === id))) {
      message.warning("账号选择已变化或查询失败，请重新查询兑换物品"); return;
    }
    rechargeExchangeOpen.value = false;
    await batch(async context => {
      const preview = options.queryExchange ? previews.find(row => row.tokenId === context.id) : catalog;
      if (context.config.version !== preview.configVersion) throw new Error("活动配置已更新，请重新打开物品清单");
      await (options.exchangeItems || exchangeRechargeItems)({ ...context, selection, preview, skipUnavailable: !options.queryExchange, expectedActivityId: preview.activityId });
    });
    rechargeExchangePreviews.value = [];
  };
  return { batchRechargeStandard, queryRechargeExchangeItems, batchRechargeExchange, rechargeExchangeOpen, rechargeExchangePreviews };
}
