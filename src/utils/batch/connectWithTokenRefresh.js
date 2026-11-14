import { canRefreshTokenCredentials } from "../tokenCredentialRefresh.js";

/** 槽位由调用方持有：重试只替换连接，不重复取得/释放槽位。 */
export async function connectWithTokenRefresh({ tokenId, getToken, tokenStore, waitForConnection, maxRetries = 2, reconnectDelay = 1000, shouldStop = () => false, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {} }) {
  const checkStopped = () => {
    if (shouldStop()) { const error = new Error("批量任务已停止，取消连接重试"); error.interrupted = true; throw error; }
  };
  const close = () => tokenStore.closeWebSocketConnectionAsync
    ? tokenStore.closeWebSocketConnectionAsync(tokenId)
    : tokenStore.closeWebSocketConnection(tokenId);
  const retries = Math.max(0, Math.floor(Number(maxRetries) || 0));
  let refreshed = false;
  for (let attempt = 0; attempt <= retries; attempt++) {
    checkStopped();
    const token = getToken(tokenId);
    if (!token) throw new Error("账号已移除，取消连接");
    // 批量流程自行控制刷新和重试，避免握手回调自动刷新、切换账号并发重连。
    await tokenStore.createWebSocketConnection(tokenId, token.token, token.wsUrl, { autoRefreshOnFailure: false });
    const connected = await waitForConnection(tokenId);
    checkStopped();
    if (connected) return true;
    await close();
    checkStopped();
    if (attempt === retries) break;
    const latest = getToken(tokenId);
    if (!latest) throw new Error("账号已移除，取消重连");
    if (!refreshed && canRefreshTokenCredentials(latest)) {
      log("连接未成功，正在从保存的来源重新获取Token…", "warning");
      try { await tokenStore.refreshTokenCredentials(tokenId); }
      catch { throw new Error("自动重新获取Token失败，请到Token管理检查来源或重新导入；本次连接任务已停止"); }
      refreshed = true;
      checkStopped();
      log("Token已重新获取，准备使用新凭据重连", "info");
    } else if (!refreshed) {
      log("该账号没有自动刷新来源，将重连现有Token；失效时需在Token管理重新导入", "warning");
    }
    await sleep(Math.max(0, Number(reconnectDelay) || 0));
    checkStopped();
    log(`正在重连（${attempt + 1}/${retries}）…`, "info");
  }
  throw new Error(`连接失败（初次连接及${retries}次重试均未成功${refreshed ? "，已重新获取Token" : ""}），请检查网络或到Token管理重新获取`);
}
