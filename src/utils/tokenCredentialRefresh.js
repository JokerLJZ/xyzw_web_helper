/** 重新获取登录凭据，不创建连接、不切换页面当前账号。 */
export const canRefreshTokenCredentials = token => Boolean(token && (
  (token.importMethod === "url" && token.sourceUrl) ||
  token.importMethod === "bin" || token.importMethod === "wxQrcode"
));

export function createTokenCredentialRefresher({
  getToken, updateToken, getArrayBuffer, storeArrayBuffer, deleteArrayBuffer,
  transformToken, scheduleRequest, fetchToken = globalThis.fetch,
}) {
  const pending = new Map();
  return function refreshTokenCredentials(tokenId) {
    if (pending.has(tokenId)) return pending.get(tokenId);
    const job = (async () => {
      const original = getToken(tokenId);
      if (!original) throw new Error("账号已移除，无法重新获取Token");
      if (!canRefreshTokenCredentials(original)) throw new Error("该账号没有自动刷新来源，请到Token管理重新导入");
      // 保存初始值，避免用户在刷新期间编辑或删除账号时覆盖新数据。
      const snapshot = { ...original };
      let token, server, legacyBuffer;
      if (snapshot.importMethod === "url") {
        const data = await scheduleRequest(async () => {
          const response = await fetchToken(snapshot.sourceUrl, { cache: "no-store", signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error("来源地址请求失败，请检查Token来源服务");
          return response.json();
        });
        token = data?.token;
        server = data?.server;
      } else {
        let buffer = await getArrayBuffer(tokenId);
        if (!buffer) { buffer = await getArrayBuffer(snapshot.name); legacyBuffer = buffer; }
        if (!buffer) throw new Error("未找到该账号保存的BIN/扫码数据，请到Token管理重新导入");
        // transformToken 本身使用全局 authuser 限流器，不能在外层重复排队。
        token = await transformToken(buffer);
      }
      if (typeof token !== "string" || !token.trim()) throw new Error("刷新来源未返回有效Token");
      const current = getToken(tokenId);
      if (!current) throw new Error("账号已移除，已取消保存刷新结果");
      if (current.token !== snapshot.token || current.sourceUrl !== snapshot.sourceUrl || current.importMethod !== snapshot.importMethod) return current.token;
      updateToken(tokenId, { token, ...(server ? { server } : {}), lastRefreshed: Date.now() });
      if (legacyBuffer) {
        const saved = await storeArrayBuffer(tokenId, legacyBuffer);
        if (saved) await deleteArrayBuffer(snapshot.name);
      }
      return token;
    })();
    pending.set(tokenId, job);
    job.finally(() => { if (pending.get(tokenId) === job) pending.delete(tokenId); }).catch(() => {});
    return job;
  };
}
