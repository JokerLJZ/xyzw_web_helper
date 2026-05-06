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

## 附录 A：项目存储架构参考

> 本节为只读参考，不随功能变更更新。整理本项目 token / 批量任务相关数据的存储位置，便于后续设计跨模块功能（如孤儿 token 清理、自动刷新等）时定位。

### A.1 存储介质分层

| 介质 | 用途 |
|---|---|
| **localStorage** | 主要持久化层，绝大多数配置和数据 |
| **IndexedDB** (`xyzw_token_db`) | token 二进制 / 大对象（[src/utils/tokenDb.js](src/utils/tokenDb.js)），含 `kv` 与 `gameTokens` 两个 store |
| **Pinia store** ([src/stores/tokenStore.ts](src/stores/tokenStore.ts)) | 运行时响应式状态，通过 VueUse 的 `useLocalStorage` 自动持久化到 localStorage |

### A.2 Token 相关 localStorage 键

| Key | 用途 | 维护者 |
|---|---|---|
| `gameTokens` | Token 列表（`TokenData[]`） | `tokenStore` |
| `selectedTokenId` | 当前选中的 token id | `tokenStore` |
| `selectedRoleInfo` | 选中 token 的角色信息缓存 | `tokenStore` |
| `activeConnections` | 跨 tab 协调，防止重复连接 | `tokenStore` |
| `tokenGroups` | Token 分组 | `tokenStore` |
| `userToken` | 旧版用户 token（IndexedDB 也冗余存了一份） | `tokenStore` / `tokenDb` |
| `ws_connection_<tokenId>` | 每个 token 的 WS 连接快照 | `tokenStore` |
| `xyzw_chat_msg_list` | 聊天消息缓存 | `tokenStore` |

#### TokenData 结构

```ts
interface TokenData {
  id: string;
  name: string;
  token: string;             // 原始 Base64
  wsUrl: string | null;
  server: string;
  remark?: string;
  importMethod?: 'manual' | 'bin' | 'url';
  sourceUrl?: string;        // url 导入时来源，refresh 用
  upgradedToPermanent?: boolean;
  upgradedAt?: string;
  updatedAt?: string;        // 关键：判断是否需要 token 刷新的依据
}
```

#### IndexedDB（`xyzw_token_db`）

- `kv` store：通用键值表（`userToken` 等）
- `gameTokens` store：按 `roleId` 索引的角色级数据（**与 localStorage 中 `gameTokens` 同名但语义不同**，是历史包袱）

### A.3 批量任务相关 localStorage 键

全部由 [BatchDailyTasks.vue](src/views/BatchDailyTasks.vue) 直接读写，**未走 Pinia**：

| Key | 用途 |
|---|---|
| `batchSettings` | 批量任务设置（含 wxpusher / pushplus / 刷新 / 阈值等所有开关） |
| `scheduledTasks` | 定时任务列表（数组） |
| `taskExecutionHistory` | 任务执行历史（`lastSuccessfulExecution` / `lastStartedAt` 等） |
| `lastTaskExecution_<taskId>` | 每个任务上次触发的分钟级 dedup key |
| `missed_<taskId>_<timestamp>` | 漏执行去重 key（48h 后清理） |
| `refresh_cron_<YYYYMMDD_HHMM>` / `refresh_stale_<...>` | 自动刷新 dedup key（48h 后清理） |
| `lastRefreshAt` | 上次自动刷新时间戳 |
| `tokenSortConfig` | Token 列表排序配置 |
| `task-templates` | 任务模板 |
| `daily-settings:<tokenId>` | 每个 token 的每日任务个性化配置 |

#### scheduledTasks 单项结构

```js
{
  id: "task_xxx",
  name: "凌晨2点签到",
  runType: "daily",                       // 'daily' | 'cron'
  runTime: "02:00",
  cronExpression: "",
  selectedTokens: ["t1", "t2", "t3"],     // ⚠ token 删除后会残留 id（孤儿引用源头）
  connectedTokens: ["t1", "t2", "t3"],    // 运行时缓存
  selectedTasks: ["batchOpenBox", "batcharenafight"],
  enabled: true,
}
```

### A.4 数据流拓扑

```
  UI (Vue 组件)  ◀──▶  Pinia tokenStore  ◀── useLocalStorage ──▶  localStorage
                                                                  ├─ gameTokens
                                                                  ├─ selectedTokenId
                                                                  └─ ws_connection_*

  BatchDailyTasks.vue  ──直接读写──▶  localStorage
                                     ├─ batchSettings
                                     ├─ scheduledTasks
                                     ├─ taskExecutionHistory
                                     └─ ...

  tokenDb.js (IndexedDB)  ◀── 角色级 / 二进制大对象
```

### A.5 跨模块设计要点

- **`tokenStore` 与 `BatchDailyTasks` 完全解耦**：两侧各自直接读写 localStorage，没有事件 / 引用关系。这是"删除 token 后定时任务残留 id"问题的根源，跨模块功能必须显式建立同步机制（事件订阅 / watch / 主动扫描）。
- **`updatedAt` 是 token 时效性的真相来源**：自动刷新等功能应基于该字段判断，不要再造时间戳。
- **批量任务模块的 dedup key 命名约定**：`<scope>_<taskId或expr>_<时间key>`，统一用 48h TTL 清理函数处理。

---

## 5. 集成 Gacha 分支：每日免费扭蛋（2026-05-06，cherry-pick `f0bc2da` + `0a15ab4`）

从 `GitHuber20th:Gacha` 分支 cherry-pick 两个提交，集成每日免费扭蛋自动化。原分支基于较老的上游 main，直接 merge 会反向丢失本仓库的差异化功能（wxpusher / refreshScheduler 等），故采用 cherry-pick 仅取这 20 行有效改动。

### 5.1 改动内容
- [src/utils/xyzwWebSocket.js](src/utils/xyzwWebSocket.js)：注册新命令 `gacha_drawreward`（默认参数 `{ num: 1, isGroup: false }`）
- [src/utils/dailyTaskRunner.js](src/utils/dailyTaskRunner.js)：
  - `DailyTaskRunner` 默认设置追加 `freeGachaEnable: true`
  - 每日任务流水线插入"免费扭蛋"任务，依赖 `statisticsTime["gacha:free"]` 通过 `isTodayAvailable` 判断当日是否已领取

### 5.2 行为约定
- **默认启用**：老用户的 `daily-settings:<tokenId>` 不显式包含该字段时，会通过对象解构 fallback 自动启用；如需关闭需显式设 `freeGachaEnable: false`
- **幂等保护**：`isTodayAvailable` 决定当日是否已领，避免重复执行
- **失败容忍**：执行失败不阻塞其他每日任务，沿用现有 `executeGameCommand` 的错误处理

### 5.3 来源信息
- 远端：`https://github.com/GitHuber20th/xyzw_web_helper.git` 分支 `Gacha`
- 原始提交：`d1d2839 增加免费扭蛋功能`、`fa9acf8 扭蛋注册`
- 本地 cherry-pick 后哈希：`f0bc2da`、`0a15ab4`

---

## 6. 修复日志自动滚动 + 移除右上角清除Token菜单（2026-05-06，提交 `373f2f6`）

### 6.1 问题：批量任务日志不再自动滚动到底部

**根因**：commit `8e9fa03`（2026-02-12 由 PR #238 合并入本仓库）在 `addLog` 中加入"最大日志条目数"截断逻辑时使用了 `logs.value = logs.value.slice(-max)` —— 这会**整体替换**响应式数组，触发 `v-for` 全量重渲染。在生产构建（含 Cloudflare Pages 部署）下，DOM 抖动让随后的 `scrollTop = scrollHeight` 失效；dev 模式因 HMR 等开销掩盖了问题。

**修复**：[BatchDailyTasks.vue:5808 `addLog`](src/views/BatchDailyTasks.vue:5808) 改用 `logs.value.splice(0, len - max)` **原地修改**，Vue 仅 patch 头部被移除的节点，尾部 DOM 节点稳定，`scrollTop` 行为可靠。同时回到最简单的单层 `nextTick` + 直接赋 `scrollHeight` 实现，去掉了之前为兜底而堆叠的同步 + nextTick + try/catch 噪声。

### 6.2 移除右上角下拉菜单"清除所有Token并退出"

**动机**：该菜单只有这一个危险项，误点会清空全部 token；并且当前流程下用户更习惯到 `/tokens` 页面进行管理。

**改动**：[DefaultLayout.vue](src/layout/DefaultLayout.vue) 保留头像与用户名展示，删除 `n-dropdown` 包裹与 `userMenuOptions` / `handleUserAction`，顺手清理因此不再使用的 `ChevronDown`、`useRouter`、`useMessage`、`useTokenStore`、`selectedTokenId` 等导入。

### 6.3 涉及文件
- [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue)
- [src/layout/DefaultLayout.vue](src/layout/DefaultLayout.vue)

### 6.4 后续：splice 实测仍不可靠 → 改用哨兵 + watch + flush:'post' + rAF

splice 在并发批量任务下实测仍滚不动。最终方案：

- **哨兵节点**：在日志列表末尾插入 `<div ref="logEndAnchor" class="log-end-anchor" />`，调用 `scrollIntoView({ block: 'end' })`，避免依赖 `scrollTop = scrollHeight` 这条对 layout 时序敏感的路径
- **`watch` + `flush: 'post'`**：监听 `filteredLogs.value.length`，由 Vue 自身保证回调发生在 DOM patch 之后
- **`requestAnimationFrame`**：再嵌一帧等浏览器完成 layout，确保哨兵已经到达最新位置
- **监听 `filteredLogs` 而非 `logs`**：让"只看错误"切换时也能正确跟随
- 把"滚动"从 `addLog` 中剥离，addLog 只负责数据，关注点更清晰
| 2026-05-06 | `f0bc2da` + `0a15ab4` | cherry-pick GitHuber20th:Gacha 集成每日免费扭蛋 |
| 2026-05-05 | `cff1b1d` | 修复长任务误判漏执行 + 自动刷新支持 cron |
