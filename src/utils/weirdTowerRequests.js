const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clock = () => performance.now();

export function serverErrorCode(error) {
  if (error?.code != null && /^\d+$/.test(String(error.code))) return Number(error.code);
  const match = String(error?.message || "").match(/(?:服务器错误:\s*|^)(\d+)(?!\d)/);
  return match ? Number(match[1]) : undefined;
}

async function wait(ms, pause, stopped, allowStopped = false) {
  const check = () => {
    if (!allowStopped && stopped()) {
      const error = new Error("怪异塔已停止"); error.stopped = true; throw error;
    }
  };
  check();
  // Keep waits interruptible without changing the game's existing action delays.
  while (ms > 0) {
    const step = Math.min(ms, 100);
    await pause(step); ms -= step; check();
  }
}

/** Account-local pacing shared by initialization, config, runner and cleanup.
 * Never retries a request or introduces rate-limit cooldowns.
 */
export function createWeirdTowerRequester({ send, intervalMs = 800, now = clock, pause = sleep, stopped = () => false, activeCount = () => 1 }) {
  let lastCompleted = null, lastStarted = null, lastCommand = null, pending = Promise.resolve();
  return (cmd, params = {}, timeout = 5000, { phase = "初始化", allowStopped = false, beforeSend } = {}) => {
    const run = async () => {
      // 爬塔三步使用500ms间隔，独立查询和领奖保持原间隔。
      const requestInterval = (cmd === "evotower_fight" || cmd === "evotower_readyfight" ||
        (cmd === "evotower_getinfo" && lastCommand === "evotower_fight")) ? Math.min(intervalMs, 500) : intervalMs;
      await wait(lastCompleted === null ? 0 : Math.max(0, requestInterval - (now() - lastCompleted)), pause, stopped, allowStopped);
      beforeSend?.();
      const started = now();
      const gap = lastStarted === null ? null : Math.max(0, Math.round(started - lastStarted));
      lastStarted = started;
      try {
        const result = await send(cmd, params, timeout);
        if (result?.code) throw Object.assign(new Error(`服务器错误: ${result.code}`), { code: result.code });
        return result;
      } catch (cause) {
        const code = serverErrorCode(cause);
        const error = new Error(`${cause?.message || "请求失败"}（阶段=${phase}，指令=${cmd}，错误码=${code ?? "无"}，请求间隔=${gap === null ? "首次" : `${gap}ms`}，活跃账号=${activeCount()}）`);
        Object.assign(error, { code, cmd, phase, requestGapMs: gap, stopped: cause?.stopped, interrupted: cause?.interrupted });
        throw error;
      } finally { lastCompleted = now(); lastCommand = cmd; }
    };
    const result = pending.then(run);
    pending = result.catch(() => {});
    return result;
  };
}

/** Called after a connection slot is acquired, so queued accounts cannot bunch
 * up when slots become available. This is startup spacing, not error backoff.
 */
export function createWeirdTowerStartGate({ now = clock, pause = sleep, stopped = () => false, intervalMs = 1000 } = {}) {
  let last = null, pending = Promise.resolve();
  return () => {
    const result = pending.then(async () => {
      await wait(last === null ? 0 : Math.max(0, intervalMs - (now() - last)), pause, stopped);
      last = now();
    });
    pending = result.catch(() => {});
    return result;
  };
}
