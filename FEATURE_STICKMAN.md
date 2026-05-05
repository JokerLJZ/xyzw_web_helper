# Stickman 自维护功能说明

> 本文件记录由 Stickman 维护的所有新增 / 增强功能。
> **维护约定：以后每新增或增强一个功能，必须在此文件追加对应章节，与代码改动同步提交。**

---

## 1. 推送通知（WxPusher / PushPlus）

**触发场景**：定时任务执行成功 / 失败、漏执行检测、批量手动任务完成。
**核心模块**：[src/utils/wxpusher.js](src/utils/wxpusher.js)
**入口函数**：[BatchDailyTasks.vue:6217 `sendNotifications(title, content)`](src/views/BatchDailyTasks.vue:6217)

### 1.1 WxPusher
- 启用开关：`batchSettings.wxpusherEnabled`
- 配置项：`wxpusherAppToken`（`AT_xxx`）、`wxpusherUids`（多个 UID 逗号分隔）
- 实现：`sendWxPusherMessage(config, title, content, contentType=3)` → POST `https://wxpusher.zjiecode.com/api/send/message`，默认富文本 HTML

### 1.2 PushPlus
- 启用开关：`batchSettings.pushplusEnabled`
- 配置项：`pushplusToken`
- 实现：`sendPushPlusMessage(token, title, content)` → POST `http://www.pushplus.plus/send`

### 1.3 通知模板（统一在 `wxpusher.js` 内）
| 函数 | 用途 |
|---|---|
| `formatScheduledTaskNotification(taskName, tokenResults, startTime)` | 定时任务执行完成 |
| `formatBatchTaskNotification(tokenResults, startTime)` | 手动批量任务完成 |
| `formatMissedExecutionNotification(task, expectedTime, detectedTime, willReExecute)` | 漏执行检测告警 |

`sendNotifications` 会同时按开关并行调用两个渠道，任一渠道失败不影响另一个。

### 1.4 UI
设置面板「WxPusher 推送通知」「PushPlus 推送通知」两个分组，[BatchDailyTasks.vue:2483 起](src/views/BatchDailyTasks.vue:2483)。

---

## 2. 定时任务漏执行检测与补执行

**目标**：浏览器关闭、刷新、长时间脱机等场景下，定时任务到点未触发时，自动检测并补执行。
**核心实现**：[BatchDailyTasks.vue `checkMissedExecutions`](src/views/BatchDailyTasks.vue) + [src/utils/batch/cronUtils.js `calculateLastExpectedExecutionTime`](src/utils/batch/cronUtils.js)
**触发频率**：在 `healthCheck` 中调用，周期 5 分钟。

### 2.1 关键状态（持久化在 localStorage）
- `taskExecutionHistory[taskId]`：
  - `lastSuccessfulExecution`：上次成功完成时间
  - `lastStartedAt`：上次开始执行时间（**v2.0 新增**，见第 4 节）
  - `executionCount`：累计成功次数
  - `missedCount`：累计漏执行次数
  - `isReExecuting`：当前是否正处于补执行
- `missed_<taskId>_<isoTimestamp>`：单次漏执行去重 key（48h 后清理）

### 2.2 判定流程
1. 计算"上次应执行时间" `lastExpectedTime`（daily/cron 都能算）
2. 若 `lastSuccessfulExecution >= lastExpectedTime` → 跳过（已完成）
3. 若 `lastStartedAt >= lastExpectedTime` 且 `now - lastStartedAt < 2h` → 跳过（运行中，**v2.0 新增**）
4. 距 `lastExpectedTime` 不足 15 分钟容忍窗口 → 跳过（避开调度抖动）
5. 已存在去重 key → 跳过
6. 距应执行时间 ≤ 2 小时：补执行 + 推送通知；> 2 小时：仅推送通知不补执行

### 2.3 关键常量
| 常量 | 值 | 含义 |
|---|---|---|
| `MISSED_EXECUTION_TOLERANCE_MS` | 15 min | 容忍窗口，避免调度抖动误报 |
| `MISSED_EXECUTION_MAX_STALE_MS` | 2 h | 超过该时长不再补执行，仅通知 |
| `MAX_TASK_DURATION_MS` | 2 h | **v2.0 新增**：单任务最长允许执行时长，超时视为崩溃 |

---

## 3. WxPusher 分支合并历史

当前所在分支 `main_wxpusher` 是从上游 `main` 合入并扩展了推送通知能力的分支。常规流程：
1. 上游 `main` 有更新时通过 `git pull` / merge 同步
2. 推送通知 / 漏执行 / 自动刷新等增强代码均在此分支独立维护

---

## 4. 修复：长任务被误判漏执行 + 自动刷新支持 Cron （2026-05-05，提交 `cff1b1d`）

### 4.1 问题与修复

#### 问题 1：批量任务 > 15 min 时被误判为漏执行 → 重复执行
**根因**：`recordTaskExecution` 仅在任务**完成后**写入 `lastSuccessfulExecution`。任务运行 35 min 期间，`healthCheck`(5min 周期) 触发的 `checkMissedExecutions` 会发现 `lastExpectedTime` 已过 15 min 容忍窗口而 `lastSuccessful` 仍为昨天 → 误判 → 再次调用 `executeScheduledTask`。

**修复**：
- `executeScheduledTask` 入口立即写入 `lastStartedAt`
- `checkMissedExecutions` 增加判定：`lastStartedAt >= lastExpectedTime` 且 `now - lastStartedAt < MAX_TASK_DURATION_MS` → 跳过
- 超过 `MAX_TASK_DURATION_MS` (2h) 仍未完成视为崩溃，由原 15 min 容忍窗口逻辑兜底补执行
- 容忍窗口保持 15 min 不变，仅承担"调度抖动"职责

**覆盖矩阵**：
| 场景 | 行为 |
|---|---|
| 任务正常运行（≤ 2h） | `lastStartedAt` 命中 → 跳过 ✅ |
| 任务正常完成 | `lastSuccessful` 命中 → 跳过 ✅ |
| 页面刷新 / 崩溃中断 (>2h) | 走容忍窗口 → 补执行 ✅ |
| 静默失败（异常被吞） | 走容忍窗口 (>2h) → 补执行 ✅ |

#### 问题 2：自动刷新只支持固定间隔
**修复**：新增 cron 模式，与既有 interval 模式并存。

### 4.2 自动刷新调度器（新模块）

**文件**：[src/utils/batch/refreshScheduler.js](src/utils/batch/refreshScheduler.js)
**对外**：`evaluateRefresh(settings, ctx) → { shouldRefresh, reason }` 纯函数
**接入点**：从 `healthCheck`（5 min 周期，对 cron 60s 窗口可能漏采）迁移到 10 s 任务 scheduler 末尾的 `evaluateAndApplyRefresh()`

#### 设计要点
| 关注点 | 处理 |
|---|---|
| 采样精度 | 10s 周期保证 cron 分钟级触发不漏 |
| 跨 reload 幂等 | localStorage 分钟级 dedup key (`refresh_cron_<YYYYMMDD_HHMM>`) |
| 表达式异常 | try/catch 静默忽略，不污染任务调度 |
| 任务运行冲突 | 默认跳过本次 + 写 dedup（防止本分钟内反复）+ 同分钟内日志节流 |
| 关注点分离 | 纯函数模块，无 Vue 依赖，可单测 |
| 存储泄漏 | `cleanupStaleRefreshKeys` 清理 48h 前 key |

### 4.3 配置项

`batchSettings` 新增字段（已加入 [defaultBatchSettings](src/utils/batch/constants.js)）：
| 字段 | 默认 | 说明 |
|---|---|---|
| `refreshType` | `'interval'` | `'interval'` \| `'cron'` |
| `refreshCronExpression` | `''` | cron 模式表达式 |
| `refreshMaxStaleHours` | `0` | 兜底：距上次刷新 ≥ N 小时强制刷一次；0 关闭 |

老用户配置零迁移：`Object.assign(batchSettings, parsed)` 自动补齐缺失字段。

### 4.4 UI

刷新设置面板（[BatchDailyTasks.vue:2414 起](src/views/BatchDailyTasks.vue:2414)）：
- 启用开关：`定时刷新页面`
- Radio 切换：`固定间隔` / `Cron 表达式`
- Cron 模式复用任务表单同款预览：实时校验 + 未来 5 次刷新时间

### 4.5 涉及文件
- [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue)
- [src/utils/batch/refreshScheduler.js](src/utils/batch/refreshScheduler.js)（新增）
- [src/utils/batch/constants.js](src/utils/batch/constants.js)
- [src/utils/batch/index.js](src/utils/batch/index.js)

---

## 维护索引（按时间倒序）

| 日期 | 提交 | 变更摘要 |
|---|---|---|
| 2026-05-05 | `cff1b1d` | 修复长任务误判漏执行 + 自动刷新支持 cron |
