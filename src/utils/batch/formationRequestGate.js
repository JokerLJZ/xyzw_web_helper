/** 按账号串行发送，以响应结束时间计时；限速冷却也约束后续请求。 */
export function createFormationRequestGate({
  intervalMs = 1500,
  cooldownMs = 6000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isRateLimitError = (error) => /200400|操作太快|操作过快/.test(`${error?.code} ${error?.message}`),
} = {}) {
  const accounts = new Map();
  return async (tokenId, execute) => {
    let account = accounts.get(tokenId);
    if (!account) {
      account = { tail: Promise.resolve(), nextAt: 0 };
      accounts.set(tokenId, account);
    }
    const pending = account.tail.then(async () => {
      const delay = account.nextAt - now();
      if (delay > 0) await sleep(delay);
      try {
        return await execute();
      } catch (error) {
        if (isRateLimitError(error)) account.nextAt = now() + cooldownMs;
        throw error;
      } finally {
        account.nextAt = Math.max(account.nextAt, now() + intervalMs);
      }
    });
    account.tail = pending.catch(() => {});
    return pending;
  };
}
