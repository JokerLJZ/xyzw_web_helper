// 自动刷新调度器
// 纯函数式：根据 batchSettings + 当前上下文返回 { shouldRefresh, reason }
// 跨 reload 幂等：通过 localStorage 分钟级 dedup key 保证同一 cron 触发分钟只刷一次
import { matchesCronExpression } from "./cronUtils";

const STALE_KEY_TTL_MS = 48 * 60 * 60 * 1000;
const LAST_REFRESH_KEY = "lastRefreshAt";

const minuteKey = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;

const readLastRefresh = () => {
  const v = localStorage.getItem(LAST_REFRESH_KEY);
  if (!v) return null;
  const t = Number(v);
  return Number.isFinite(t) ? t : null;
};

const recordRefresh = (now) => {
  localStorage.setItem(LAST_REFRESH_KEY, String(now.getTime()));
};

// 清理超过 48h 的 refresh_ dedup key
const cleanupStaleRefreshKeys = () => {
  const cutoff = Date.now() - STALE_KEY_TTL_MS;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("refresh_")) continue;
    // key 后缀为 minuteKey: YYYYMMDD_HHMM；解析出对应时间戳判断
    const m = key.match(/_(\d{8})_(\d{4})$/);
    if (!m) continue;
    const [_, ymd, hm] = m;
    const ts = new Date(
      Number(ymd.slice(0, 4)),
      Number(ymd.slice(4, 6)) - 1,
      Number(ymd.slice(6, 8)),
      Number(hm.slice(0, 2)),
      Number(hm.slice(2, 4)),
    ).getTime();
    if (Number.isFinite(ts) && ts < cutoff) {
      localStorage.removeItem(key);
    }
  }
};

// 判定刷新触发器是否命中。返回 { matched, reason, dedupKey }
// dedupKey 为 null 表示该模式不需要去重（如 interval）
const matchTrigger = (settings, now, pageLoadTime) => {
  // 兜底：超过 maxStaleHours 强制刷新
  if (settings.refreshMaxStaleHours && settings.refreshMaxStaleHours > 0) {
    const last = readLastRefresh();
    const baseline = last || pageLoadTime;
    const staleHours = (now.getTime() - baseline) / 3600000;
    if (staleHours >= settings.refreshMaxStaleHours) {
      return {
        matched: true,
        reason: "stale-fallback",
        dedupKey: `refresh_stale_${minuteKey(now)}`,
      };
    }
  }

  if (settings.refreshType === "cron") {
    if (!settings.refreshCronExpression) return { matched: false };
    let hit = false;
    try {
      hit = matchesCronExpression(settings.refreshCronExpression, now);
    } catch {
      // 表达式异常静默忽略，不影响任务调度
      return { matched: false };
    }
    if (!hit) return { matched: false };
    return {
      matched: true,
      reason: "cron",
      dedupKey: `refresh_cron_${minuteKey(now)}`,
    };
  }

  // interval 模式：保持原语义（基于 pageLoadTime 累计时间）
  if (!settings.refreshInterval || settings.refreshInterval <= 0) {
    return { matched: false };
  }
  const elapsedMin = (now.getTime() - pageLoadTime) / 60000;
  if (elapsedMin >= settings.refreshInterval) {
    return { matched: true, reason: "interval", dedupKey: null };
  }
  return { matched: false };
};

/**
 * 评估是否应触发刷新。
 * @param {object} settings batchSettings 引用（需含 enableRefresh / refreshType 等字段）
 * @param {{ now: Date, pageLoadTime: number, isTaskRunning: boolean }} ctx
 * @returns {{ shouldRefresh: boolean, reason?: string }}
 */
export const evaluateRefresh = (settings, ctx) => {
  if (!settings || !settings.enableRefresh) return { shouldRefresh: false };
  const { now, pageLoadTime, isTaskRunning } = ctx;

  const trigger = matchTrigger(settings, now, pageLoadTime);
  if (!trigger.matched) return { shouldRefresh: false };

  // 幂等去重（cron / stale-fallback 需要；interval 不需要）
  if (trigger.dedupKey && localStorage.getItem(trigger.dedupKey)) {
    return { shouldRefresh: false, reason: "already-fired" };
  }

  // 安全闸门：任务运行中跳过本次。仍写 dedup 避免本分钟内反复进入
  if (isTaskRunning) {
    if (trigger.dedupKey) localStorage.setItem(trigger.dedupKey, "1");
    return { shouldRefresh: false, reason: "task-running" };
  }

  // 提交触发：先写 dedup 再 reload，保证 reload 后新页面不会再次命中
  if (trigger.dedupKey) localStorage.setItem(trigger.dedupKey, "1");
  recordRefresh(now);
  cleanupStaleRefreshKeys();

  return { shouldRefresh: true, reason: trigger.reason };
};
