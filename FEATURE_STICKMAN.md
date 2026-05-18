# Stickman 自维护功能说明

> 本文件记录由 Stickman 维护的所有新增 / 增强功能。
> **强制维护规则：本项目所有功能变更（新增、增强、行为调整、回滚、从其他分支/会话/开发者带来的功能改动）都必须同步更新本文件，并与对应代码改动一起提交。**
> **无论功能变更是否由当前会话发起，都必须补写 `FEATURE_STICKMAN.md` 后再提交/推送。**

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

## 6. 修复日志自动滚动 + 移除右上角清除Token菜单（2026-05-06 起，提交 `373f2f6` / `b10e2ee` / `0c31d4e` / `9c39831` / `eea4be1` / `4312e98`）

### 6.1 批量任务日志滚动

围绕 [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue) 的批量任务日志面板，连续修复生产构建下日志不自动滚动、滚动区域溢出、面板高度不稳定等问题：

- `addLog` 截断历史日志时使用原地更新，减少响应式数组整体替换导致的 DOM 抖动。
- 日志容器改为受控滚动区域，避免日志把整页撑高。
- 使用 Naive UI 滚动组件后继续收敛滚动目标，确保新增日志后稳定贴到底部。
- 恢复响应式高度约束，让不同窗口高度下批量任务面板仍可用。

### 6.2 移除危险入口

[src/layout/DefaultLayout.vue](src/layout/DefaultLayout.vue) 移除右上角用户下拉菜单里的"清除所有Token并退出"入口，仅保留头像和用户信息展示。清理 Token 改由专门的 Token 管理页承担，降低误触清空全部账号的风险。

---

## 7. GitHub Gist 数据备份体系（2026-05-08 至 2026-05-11，提交 `2a9c913` / `125dc8f` / `685a549` / `9baa4f5` / `77890f6` / `30581f5` / `40061fe` / `8467bfe`）

### 7.1 方案演进

先尝试 WebDAV 自动备份（`2a9c913`），随后因浏览器侧 CORS / 配置成本过高回滚（`125dc8f`），最终落地 GitHub Gist 自动备份（`685a549`）。使用 secret gist 保存 `xyzw-backup.json`，通过 Gist revision history 提供历史版本、下载和恢复能力。

### 7.2 核心模块

- [src/utils/backup/gistClient.ts](src/utils/backup/gistClient.ts)：封装 GitHub Gist API，负责验证 Token、创建 secret gist、更新文件、读取历史版本。
- [src/utils/backup/backupManager.ts](src/utils/backup/backupManager.ts)：自动备份管理器，支持手动备份、定时备份、恢复指定 revision、连续失败自动暂停。
- [src/utils/backup/snapshotBuilder.ts](src/utils/backup/snapshotBuilder.ts)：统一构建 / 应用备份快照，后续扩展 token 分组与 IndexedDB 二进制数据。
- [src/utils/backup/snapshotSchema.ts](src/utils/backup/snapshotSchema.ts)：维护快照 schema，当前 `CURRENT_BACKUP_VERSION = "1.3"`。
- [src/components/Backup/BackupSettingsPanel.vue](src/components/Backup/BackupSettingsPanel.vue)：备份设置、版本列表、下载和恢复 UI。
- [src/views/DataBackup.vue](src/views/DataBackup.vue)：独立数据备份页面。
- [BACKUP.md](BACKUP.md)：GitHub Gist 自动备份使用指南。

### 7.3 功能点

- 入口加入顶部 / 侧边导航：`/admin/data-backup`。
- 无 Token 场景也允许进入备份页，便于新设备先恢复数据。
- 自动备份支持固定间隔与 Cron 表达式；Cron 模式复用批量任务 cron 工具。
- 备份内容包含 tokens、定时任务、批量设置、token 个性化设置、任务模板、排序配置、主题偏好等。
- `30581f5` 将 `tokenGroups` 纳入快照，恢复时同步分组结构。
- `8467bfe` 将 BIN / 微信扫码原始二进制 token 数据纳入快照，避免只恢复文本 token 后无法再导出原始 BIN。
- `40061fe` 优化备份历史展示，同时给漏执行补做增加显式开关。

### 7.4 配置与存储

- 配置持久化 key：`backupConfig`
- Gist 文件名：`xyzw-backup.json`
- Cron 去重 key：`lastBackupCronExecutionKey`
- 连续自动备份失败阈值：3 次，达到后暂停定时器，需在 UI 手动重置失败状态。

---

## 8. 批量任务维护增强（2026-05-10 至 2026-05-11，提交 `b294b81` / `ab89664` / `bd1219f`）

### 8.1 功法批量任务

[src/utils/batch/tasksLegacy.js](src/utils/batch/tasksLegacy.js) 新增功法类任务能力，并在 [src/utils/batch/constants.js](src/utils/batch/constants.js) 与 [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue) 注册入口：

- `batchLegacyBeginHangUp`：批量开始探索功法，识别"已在探索中"类响应并按跳过处理。
- `batchLegacyClaimChargeReward`：批量领取特权功法，识别"已领取"类响应并按跳过处理。
- [src/utils/xyzwWebSocket.js](src/utils/xyzwWebSocket.js) 注册 `legacy_getinfo`、`legacy_claimhangup`、`legacy_beginhangup`、`legacy_claimchargereward` 等命令。

### 8.2 金鱼杆月度补齐

[src/utils/batch/tasksArena.js](src/utils/batch/tasksArena.js) 新增金鱼杆月度补齐任务：

- 通过 `activity_get` 读取月度活动进度。
- 按当月日期进度计算当前应达到的目标，避免月初一次性打满。
- 优先消耗免费次数，再按剩余目标使用黄金鱼竿补齐。
- 使用 `GOLD_FISH_TARGET` 常量控制月度目标。

### 8.3 清理无效账号引用

[src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue) 新增"清理无效账号"能力：

- 扫描 `scheduledTasks.selectedTokens` / `connectedTokens` 中已删除的 token id。
- 清理对应 `daily-settings:<tokenId>` 个性化配置。
- 若定时任务清理后没有可用账号，自动禁用该任务。
- 执行结果写入批量日志并通过消息提示清理数量。

---

## 9. Token BIN 导入导出增强（2026-05-12，提交 `a4fa45a` / `1e61644`）

### 9.1 BIN 导出

新增 [src/utils/tokenBinExport.ts](src/utils/tokenBinExport.ts)，支持从 IndexedDB 读取 BIN / 微信扫码导入时保存的原始二进制数据并下载：

- 单个 Token 行菜单新增"导出BIN文件"。
- Token 管理页批量菜单新增"导出微信扫码BIN"。
- 文件名统一为 `bin-{server}-{roleIndex}-{roleId}-{name}.bin`，并对非法文件名字符做转义。
- 仅 `importMethod` 为 `bin` 或 `wxQrcode` 的 Token 可导出；找不到原始二进制数据时给出失败原因。

### 9.2 单角色 BIN 批量导入

[src/views/TokenImport/singlebin.vue](src/views/TokenImport/singlebin.vue) 支持一次选择多个单角色 BIN / DMP 文件：

- 逐个解析文件名中的区服、角色序号、角色 ID、角色名。
- 通过 `transformToken` 转换 token，并用 `getTokenId` 去重。
- 原始 ArrayBuffer 写入 IndexedDB，便于后续备份和导出。
- 支持角色命名模板：`{name}`、`{id}`、`{index}`、`{server}`。
- 已存在角色会更新 Token，不存在则新增。

---

## 10. 特权功法奖励 ID 修正与回滚（2026-05-12，提交 `5068776` / `3c7804a`）

`5068776` 曾将 `legacy_claimchargereward` 默认参数和批量领取参数从 `{ id: 2 }` 调整为 `{ id: 3 }`。随后 `3c7804a` 回滚为旧版特权奖励 ID：

- [src/utils/xyzwWebSocket.js](src/utils/xyzwWebSocket.js)：`legacy_claimchargereward` 默认参数恢复为 `{ id: 2 }`。
- [src/utils/batch/tasksLegacy.js](src/utils/batch/tasksLegacy.js)：批量领取特权功法发送参数恢复为 `{ id: 2 }`。

当前有效行为以 `3c7804a` 为准。

---

## 11. 五次领取挂机批量任务（2026-05-14，本次提交）

### 11.1 功能目标

新增"五次领取挂机"批量任务，适用于需要连续领取挂机奖励的场景。执行流程参考原有"领取挂机"任务，但领取阶段改为连续 5 次，并严格控制两次领取之间间隔 6 秒。

### 11.2 执行流程

对每个选中的 Token：

1. 建立 WebSocket 连接。
2. 连续发送 5 次 `system_claimhangupreward`。
3. 前 4 次领取完成后等待 6 秒，再执行下一次领取。
4. 5 次领取完成后，执行原有挂机加钟流程：发送 4 次 `system_mysharecallback`，参数 `{ isSkipShareCard: true, type: 2 }`。
5. 关闭连接并释放批量任务连接槽位。

### 11.3 涉及文件

- [src/utils/batch/tasksHangUp.js](src/utils/batch/tasksHangUp.js)：新增 `claimHangUpRewardsFiveTimes`，并抽出 `addHangUpTimeForToken` 复用加钟逻辑。
- [src/utils/batch/constants.js](src/utils/batch/constants.js)：`availableTasks` 新增"五次领取挂机"。
- [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue)：日常批量功能区新增按钮，定时任务"日常"分组新增该任务。

---

## 12. 梦境购买整合与日常答题默认执行（2026-05-18，提交 `3671248`）

### 12.1 一键梦境整合梦境商品购买

将"一键购买梦境商品"整合进"一键梦境"执行链，保证同一账号连接内先执行梦境指令，再执行购买指令：

1. `batchmengjing` 建立连接后先发送 `dungeon_selecthero`，使用梦境阵容 `{ 0: 107 }`。
2. 梦境指令成功后调用复用的 `runDreamPurchaseForToken`。
3. 购买逻辑读取 `batchSettings.dreamPurchaseList`，通过 `role_getroleinfo` 获取商店数据，再按商人和位置顺序发送 `dungeon_buymerchant`。
4. 如果未配置购买清单，"一键梦境"仅记录跳过购买，不中断梦境流程。
5. 独立的"一键购买梦境商品"入口保留，用于手动补买。
6. 定时任务若同时选择 `batchmengjing` 和 `batchBuyDreamItems`，执行前自动过滤单独购买项，避免重复购买。

**涉及文件**：
- [src/utils/batch/tasksDungeon.js](src/utils/batch/tasksDungeon.js)
- [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue)

### 12.2 一键答题纳入日常任务默认执行

将"一键答题"纳入 `DailyTaskRunner.run()` 的日常任务流水线，默认启用：

1. 新增 `studyEnable: true` 默认配置，旧账号缺失该字段时也按启用处理。
2. 日常任务执行过程中加载题库，发送 `study_startgame`，等待答题插件提交答案并领取奖励。
3. 若本周已达到 `maxCorrectNum >= 10` 且 `beginTime` 在本周内，则跳过答题。
4. 批量日常设置与单账号日常设置均新增"一键答题"开关，可显式关闭。

**涉及文件**：
- [src/utils/dailyTaskRunner.js](src/utils/dailyTaskRunner.js)
- [src/utils/batch/constants.js](src/utils/batch/constants.js)
- [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue)
- [src/components/Daily/DailyTaskStatus.vue](src/components/Daily/DailyTaskStatus.vue)

---

## 13. 隐藏独立批量答题与梦境入口（2026-05-18，本次提交）

### 13.1 背景

`batchStudy` 已纳入日常任务默认执行，`batchmengjing` 已承载梦境指令与梦境购买的整合流程。为避免用户在批量任务页误以为需要额外单独执行，隐藏两个独立批量任务入口。

### 13.2 行为变化

- 批量日常页顶部功能按钮不再展示"一键答题"。
- 批量日常页副本功能按钮不再展示"一键梦境"。
- 定时任务可选任务列表不再展示 `batchStudy` 与 `batchmengjing`。
- 底层函数仍保留，避免已有本地旧配置引用这些任务时直接报函数不存在。

### 13.3 涉及文件

- [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue)
- [src/utils/batch/constants.js](src/utils/batch/constants.js)

---

## 14. 日常任务可选执行一键灯神扫荡（2026-05-18，本次提交）

### 14.1 功能目标

将现有"一键灯神扫荡"能力接入日常任务，但默认保持关闭，避免日常流程自动消耗扫荡券。用户可在日常任务配置中按账号或模板启用。

### 14.2 执行位置

`DailyTaskRunner.run()` 中的一键灯神扫荡会追加在任务列表最后，位于日常积分、周常、通行证等奖励领取动作之后执行，确保它是日常任务执行动作的最后一项。

### 14.3 执行逻辑

- 执行前重新发送 `role_getroleinfo` 获取最新角色数据与扫荡券数量。
- 读取道具 `1021` 作为灯神扫荡券数量。
- 在魏 / 蜀 / 吴 / 群四个灯神中选择已通过层数最高的灯神。
- 使用 `genie_sweep` 按每批最多 20 次消耗扫荡券，直到扫荡券耗尽或命令失败。
- 若无扫荡券或无可扫荡关卡，仅记录跳过，不影响日常任务整体完成。

### 14.4 配置项

`daily-settings:<tokenId>` / 任务模板新增：

| 字段 | 默认 | 说明 |
|---|---|---|
| `genieSweepEnable` | `false` | 是否在日常任务最后执行一键灯神扫荡 |

### 14.5 涉及文件

- [src/utils/dailyTaskRunner.js](src/utils/dailyTaskRunner.js)
- [src/utils/batch/constants.js](src/utils/batch/constants.js)
- [src/views/BatchDailyTasks.vue](src/views/BatchDailyTasks.vue)
- [src/components/Daily/DailyTaskStatus.vue](src/components/Daily/DailyTaskStatus.vue)

---

## 维护索引（按时间倒序）

| 日期 | 提交 | 变更摘要 |
|---|---|---|
| 2026-05-18 | 本次提交 | 日常任务新增默认关闭的一键灯神扫荡配置，并在日常动作最后执行 |
| 2026-05-18 | 本次提交 | 隐藏独立的一键答题和一键梦境批量任务入口，仅保留整合后的日常/梦境流程 |
| 2026-05-18 | `3671248` | 一键梦境整合梦境商品购买；日常任务默认执行一键答题并增加开关 |
| 2026-05-14 | 本次提交 | 新增五次领取挂机批量任务：连续领取 5 次，每次间隔 6 秒，完成后自动加钟 |
| 2026-05-12 | `3c7804a` | 回滚特权功法奖励 ID，恢复 `legacy_claimchargereward` 参数 `{ id: 2 }` |
| 2026-05-12 | `5068776` | 曾尝试调整特权功法奖励 ID 为 `{ id: 3 }`，后续已回滚 |
| 2026-05-12 | `1e61644` | 新增单角色 BIN 批量导入 |
| 2026-05-12 | `a4fa45a` | 新增 Token BIN / 微信扫码 BIN 导出 |
| 2026-05-11 | `8467bfe` | 修复备份缺失 token 原始二进制数据 |
| 2026-05-11 | `bd1219f` | 批量任务新增清理已删除 Token 引用 |
| 2026-05-11 | `ab89664` | 新增金鱼杆月度补齐批量任务 |
| 2026-05-10 | `b294b81` | 新增功法探索与特权功法批量任务 |
| 2026-05-10 | `40061fe` | 优化备份历史展示，增加漏执行自动补做开关 |
| 2026-05-10 | `30581f5` | 备份快照纳入 Token 分组 |
| 2026-05-10 | `77890f6` | 自动备份支持调度配置，数据备份页支持无 Token 进入 |
| 2026-05-10 | `9baa4f5` | 顶部导航新增数据备份入口 |
| 2026-05-09 | `685a549` | 新增 GitHub Gist 自动备份体系 |
| 2026-05-08 | `125dc8f` | 回滚 WebDAV 自动备份方案 |
| 2026-05-08 | `2a9c913` | 曾尝试新增 WebDAV 自动备份方案 |
| 2026-05-08 | `4312e98` | 移除右上角清除全部 Token 菜单入口 |
| 2026-05-06 至 2026-05-08 | `b10e2ee` 等 | 连续修复批量任务日志滚动与滚动区域稳定性 |
| 2026-05-06 | `373f2f6` / `5ba017a` | 修复批量任务日志自动滚动并记录文档 |
| 2026-05-06 | `f0bc2da` + `0a15ab4` | cherry-pick GitHuber20th:Gacha 集成每日免费扭蛋 |
| 2026-05-05 | `cff1b1d` | 修复长任务误判漏执行 + 自动刷新支持 cron |
