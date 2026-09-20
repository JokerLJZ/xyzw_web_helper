/**
 * 逐鹿盐山（APEX）请求限流。
 *
 * 服务器对 apex_* 命令有频控，超限返回业务码 200400「操作太快，请稍后再试」。
 * 固定 sleep 治标不治本（写快了照样被打回、写慢了白白浪费时间），因此沿用仓库
 * 既有的 AIMD 自适应冷却思路（与其它高频操作模块的冷却实现同源）：
 *   · 被 200400 打回 → 间隔估计值「乘性放大」est *= EST_GROW
 *   · 连续成功 N 次  → 估计值「加性下调」est -= EST_SHRINK（有下限）
 * 估计值会收敛到服务器真实冷却：既不更快（避免 200400），也不更慢（不浪费时间）。
 *
 * 在此之上再加一层「全局串行 + 最小间隔」：所有 apex 命令排队发送。分页拉取、
 * 30s 轮询与批量任务同时发起时最容易触发 200400，串行化可彻底消除这类突发。
 */

/** 限流动作类型：查询类（只读拉取）/ 竞猜（apex_guess）/ 助威（apex_vote） */
export const ApexAction = {
  READ: "read",
  GUESS: "guess",
  VOTE: "vote",
};

/** 各动作间隔估计值下限（ms）：低于此值基本必被服务器打回 */
const EST_FLOOR = { read: 300, guess: 1200, vote: 1200 };

/** 间隔估计值上限（ms）：超过 30s 多为全局异常，不再无脑拉长 */
const EST_CEIL = 30000;

/** 间隔估计初始值（ms）：偏保守，收敛后会自动下调 */
const EST_DEFAULT = { read: 600, guess: 2500, vote: 2500 };

/** 排期余量（ms）：避免贴边触发 200400 */
const EST_MARGIN = 200;

/** 200400 后的乘性放大系数 */
const EST_GROW = 1.6;

/** 连续成功后每次下调的步长（ms） */
const EST_SHRINK = 150;

/** 连续成功多少次才下调一次（避免在边界上反复抖动） */
const OK_BEFORE_SHRINK = 3;

/** 任意两条 apex 命令之间的最小间隔（ms），用于打散突发请求 */
const MIN_CMD_GAP_MS = 200;

/** 单条命令遇到 200400 后的最大自动重试次数 */
const MAX_RETRY = 3;

/** 估计值持久化键（跨会话沿用学习结果） */
const STORE_KEY = "apex:estCooldown";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 将间隔估计值限制在 [下限, 上限] 区间内。
 * @param {string} key 动作类型（ApexAction）
 * @param {number} val 待收敛的估计值（ms）
 * @returns {number} 收敛后的估计值（ms）
 */
const clampEst = (key, val) =>
  Math.min(EST_CEIL, Math.max(EST_FLOOR[key] ?? 300, Math.round(val)));

/**
 * 读取持久化的间隔估计值；不可用时退回初始值。
 * @returns {Record<string, number>} 各动作的间隔估计值（ms）
 */
const loadEst = () => {
  const est = { ...EST_DEFAULT };
  try {
    if (typeof localStorage === "undefined") {
      return est;
    }
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    for (const key of Object.keys(est)) {
      if (Number.isFinite(saved[key])) {
        est[key] = clampEst(key, saved[key]);
      }
    }
  } catch {
    /* localStorage 不可用时退回初始值 */
  }
  return est;
};

const persistEst = () => {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...est }));
    }
  } catch {
    /* ignore */
  }
};

const est = loadEst();
/** 各动作下一次允许发送的时刻（时间戳，ms） */
const nextAllowedAt = { read: 0, guess: 0, vote: 0 };
/** 各动作连续成功次数 */
const okStreak = { read: 0, guess: 0, vote: 0 };
/** 最近一条 apex 命令的发出时刻（全局最小间隔基准） */
let lastSentAt = 0;

/**
 * 判断错误是否为服务器限流（200400）。
 * @param {unknown} e 捕获到的异常
 * @returns {boolean} 是 200400「操作太快」时为 true
 */
export const isApexRateLimited = (e) =>
  /200400|操作太快/.test(e && e.message ? e.message : String(e));

/**
 * 距离该动作下一次可发送还需等待的毫秒数。
 * @param {string} key 动作类型（ApexAction）
 * @returns {number} 等待毫秒数，0 表示可立即发送
 */
export const apexCooldownLeft = (key) => {
  const now = Date.now();
  return Math.max(0, nextAllowedAt[key] - now, lastSentAt + MIN_CMD_GAP_MS - now);
};

/**
 * 当前学习到的发送间隔（ms）。
 * @param {string} key 动作类型（ApexAction）
 * @returns {number} 间隔估计值（ms）
 */
export const apexEstMs = (key) => est[key] ?? 0;

/** 自适应限流概览文案（证明间隔是学习出来的，而非写死的常量） */
export const apexEstText = () =>
  `自适应限流：查询 ${(est.read / 1000).toFixed(1)}s · 竞猜 ${(est.guess / 1000).toFixed(1)}s · 助威 ${(est.vote / 1000).toFixed(1)}s`;

/**
 * 按当前估计值排定下一次可发送时刻。
 * @param {string} key 动作类型（ApexAction）
 */
const scheduleNext = (key) => {
  nextAllowedAt[key] = Date.now() + est[key] + EST_MARGIN;
};

/**
 * 发送成功：连续成功达阈值则下调估计值，向服务器真实冷却收敛。
 * @param {string} key 动作类型（ApexAction）
 */
const onSuccess = (key) => {
  okStreak[key] += 1;
  if (okStreak[key] >= OK_BEFORE_SHRINK) {
    est[key] = clampEst(key, est[key] - EST_SHRINK);
    okStreak[key] = 0;
    persistEst();
  }
};

/**
 * 被限流（200400）：乘性放大估计值——针对真实限流的关键一步。
 * @param {string} key 动作类型（ApexAction）
 */
const onRateLimited = (key) => {
  okStreak[key] = 0;
  est[key] = clampEst(key, est[key] * EST_GROW);
  persistEst();
};

/** 全局串行队列：同一时刻只允许一条 apex 命令在途，杜绝并发突发 */
let chain = Promise.resolve();
const serialize = (task) => {
  const run = chain.then(task, task);
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
};

/**
 * 发送一条 apex 命令：自动等待冷却，被 200400 打回时放大间隔并退避重试。
 *
 * @param {string} key 动作类型（ApexAction）
 * @param {Function} task 实际发送函数，返回 Promise
 * @param {object} [opt] 选项
 * @param {number} [opt.maxRetry] 200400 最大自动重试次数
 * @param {Function} [opt.onWait] 等待冷却时的回调，参数为等待毫秒数（用于 UI 倒计时 / 日志）
 * @returns {Promise<*>} task 的返回值
 * @throws {Error} 重试耗尽或遇到非限流错误时抛出原始异常
 */
export const runApexAction = async (key, task, { maxRetry = MAX_RETRY, onWait } = {}) =>
  serialize(async () => {
    for (let attempt = 0; ; attempt += 1) {
      const wait = apexCooldownLeft(key);
      if (wait > 0) {
        onWait?.(wait);
        await sleep(wait);
      }
      lastSentAt = Date.now();
      try {
        const res = await task();
        onSuccess(key);
        scheduleNext(key);
        return res;
      } catch (e) {
        if (!isApexRateLimited(e)) {
          okStreak[key] = 0;
          scheduleNext(key);
          throw e;
        }
        // 服务器冷却自「上次放行」起算，本次被打回后从当前时刻重新排期
        onRateLimited(key);
        scheduleNext(key);
        if (attempt >= maxRetry) {
          throw e;
        }
      }
    }
  });
