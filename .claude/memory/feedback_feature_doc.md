---
name: 功能变更必须维护到 FEATURE_STICKMAN.md
description: 在 xyzw_web_helper 项目中，任何新增/增强功能完成后必须在 FEATURE_STICKMAN.md 追加章节，与代码改动同步提交
type: feedback
originSessionId: f99519de-1921-4722-8766-b7d7505e3627
---
在 `xyzw_web_helper` 项目中，每次新增或增强功能完成后，必须在仓库根目录 `FEATURE_STICKMAN.md` 中追加一节说明该功能，并更新文末的「维护索引」表格（按时间倒序，列出日期、提交 hash、摘要）。文档与代码改动需一并提交。

**Why:** 用户 Stickman 在 2026-05-05 显式要求建立这个自维护文档，把 wxpusher / pushplus / 漏执行检测 / 自动刷新等他维护的差异化功能集中收录，避免被上游 main 合并时丢失上下文。

**How to apply:**
- 凡是修改 `BatchDailyTasks.vue`、`src/utils/batch/*`、`wxpusher.js` 等 Stickman 分支特有逻辑，或新增类似定制功能时，都要在该文件追加章节
- 章节需含：问题/目标、设计要点、关键文件链接、配置项变更、UI 变化（如有）
- 提交 commit 后回填章节末尾的提交 hash 和维护索引表
- 纯 bug 修复或重构如果不引入用户可见变化，可在已有相关章节追加小节而非新建
- 若上游 main 自身有变化（非 Stickman 维护），不必记录到此文档

**记忆文件双位置约定（2026-05-05 用户要求）：**
- 主位置（auto-memory 系统自动加载）：`~/.claude/projects/-Users-liujianzhe-Documents-GitHub-xyzw-web-helper/memory/`
- 镜像位置（已提交进 repo，便于跨机器/查阅）：项目根 `.claude/memory/`
- 每次更新或新增记忆文件时，**两处必须同步**，并把项目内的副本一起 commit
