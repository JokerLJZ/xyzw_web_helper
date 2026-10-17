# 自动备份使用指南（GitHub Gist）

把所有 token、定时任务、批量设置等配置自动备份到你 GitHub 账号下的一个 **secret gist**，每 30 分钟一次，永久保留所有历史版本，免费跨设备恢复。

> 入口：登录后打开「**个人资料**」页 → 「**数据备份**」卡片。

---

## 一、为什么用 GitHub Gist 而不是其他方案

| 方案 | 配置成本 | 跨设备 | CORS 问题 | 说明 |
|---|---|---|---|---|
| GitHub Gist | ⭐ 1 分钟（生成 PAT） | ✅ | ❌ 无 | 本项目使用 |
| WebDAV / 群晖 | ⭐⭐⭐ 反代 + CORS 头 | ✅ | ❌ 必须配 | 太麻烦放弃 |
| 浏览器本地 IndexedDB | ⭐ 0 | ❌ | — | 清浏览器数据就没了 |
| 手动导出 JSON | ⭐ 0 | 半自动 | — | 容易忘 |

GitHub API 原生允许浏览器跨域调用，且每个 secret gist 自带无限 commit 历史，等于免费的"滚动版本快照"。

---

## 二、第一次使用：创建 GitHub PAT

### 1. 登录 GitHub

访问 https://github.com/login，没账号先注册一个（免费）。

> ⚠️ 强烈建议先在 [Settings → Password and authentication](https://github.com/settings/security) 开启 **两步验证（2FA）**。token 是敏感数据，账号一旦被盗等于全部 token 泄漏。

### 2. 生成 Personal Access Token（PAT）

推荐使用 **fine-grained PAT**（更安全，权限最小化）：

1. 打开 https://github.com/settings/personal-access-tokens/new
2. 填写：
   - **Token name**：`xyzw-web-helper-backup`（任意名称）
   - **Expiration**：90 天（建议；到期后重新生成即可）
   - **Repository access**：选 **Public Repositories (read-only)**（Gist 不属于 repo，这里随便选）
   - **Permissions** → 找到 **Account permissions** → **Gists** → 选 **Read and write**
3. 点击底部 **Generate token**
4. **立即复制** 生成的 token（形如 `github_pat_xxx...`）。**关闭页面后无法再次查看**。

> 也可以用经典 PAT：https://github.com/settings/tokens/new
> 只需勾选 `gist` 这一个 scope。fine-grained 更推荐。

### 3. 在 web-helper 中绑定

打开 web-helper → **个人资料 → 数据备份**：

1. **GitHub Token**：粘贴刚才复制的 token
2. 点 **「验证 Token」**
   - 成功会显示你的 GitHub 用户名
   - 失败常见原因：token 拼错、过期、scope 不对
3. 点 **「创建新 Gist」**
   - 会自动在你账号下创建一个 secret gist，名为 `xyzw-backup.json`
   - 创建完成后下方"Gist 链接"会出现一个跳转链接，可以点进去看内容
4. 选择"备份间隔"（推荐 30 分钟）
5. 打开 **「启用自动备份」** 开关

完成。从这一刻起，浏览器每打开页面 + 每 30 分钟会自动同步一次。

---

## 三、日常使用

### 立即备份一次

点 **「立即备份」** 按钮 → 看到「备份成功」提示。

### 查看历史版本

点 **「刷新版本」**，下方会列出所有 commit。每条记录显示：

- 提交时间
- commit sha（前 8 位）
- 变更行数
- 「下载」按钮：把该版本的 JSON 下载到本地
- 「恢复」按钮：从该版本恢复配置（见下文）

### 在 GitHub 网页查看

点击表单里的 **Gist 链接**，浏览器跳到 `https://gist.github.com/<你>/xxxx`，可以看到当前版本和完整 commit history（GitHub 自带的 diff 视图）。

---

## 四、恢复（换设备 / 重装系统 / 误删 token 时）

### 场景 A：在新浏览器 / 新设备上恢复

1. 打开 web-helper（一个全新、空的 web-helper 实例）
2. 进 **个人资料 → 数据备份**
3. 填入同一个 **GitHub Token**
4. 点 **「验证 Token」**
5. 因为 Gist 已经存在，需要手动告诉它绑定哪一个：
   - 打开 https://gist.github.com/ 找到 `xyzw-backup.json` 那个 secret gist
   - 复制 URL 末尾那串 hash（比如 `https://gist.github.com/yourname/abc123def456` → `abc123def456`）
   - 粘贴到 **Gist ID** 输入框
6. 点 **「刷新版本」** → 应该能看到所有历史版本
7. 点最新一条版本的 **「恢复」**
8. 弹窗里选：
   - **Token 策略**：
     - **合并**：保留本地已有 token，只追加备份里的新 token
     - **覆盖**：完全用备份替换本地（推荐用于全新设备）
   - **包含项**：默认全勾即可
9. 点 **「确认恢复」**
10. 完成后页面自动刷新，所有 token 和设置都回来了

### 场景 B：回滚到几小时前的版本

误操作删了 token？想回滚到昨天的状态？

1. **「刷新版本」** 看历史
2. 找到对应时间点的 commit
3. 点该行 **「恢复」** → **「合并」** 策略 → 确认

注意：恢复"合并"模式不会删除你之后新增的 token，只会把那个版本的内容**追加**回来。如果想严格回到那一刻，选"覆盖"策略。

---

## 五、安全模型与建议

### 数据流

```
浏览器 localStorage（明文）
        │
        │  HTTPS PATCH
        ▼
GitHub API（HTTPS 加密传输）
        │
        ▼
你的 secret gist（GitHub 服务器，明文存储）
```

### Secret Gist 是什么

- **不出现**在你的公开 profile
- **不被搜索引擎索引**
- 但**任何拿到 URL 的人**都可以读（不需要登录 GitHub）
- 所以 URL 本身就是密码 —— 不要分享 URL 给任何人

### PAT 是什么

- 写 Gist 必须有 PAT
- PAT 明文存在浏览器 localStorage
- 任何能读你 localStorage 的脚本/人 = 拿到 PAT = 能列出并读取你所有 gist
- **缓解**：
  - 用 fine-grained PAT，只给 Gist 权限，不给 repo 权限
  - 设过期时间 90 天，到期重新生成
  - 不要在公共电脑上登录 web-helper

### 如果 PAT 泄漏了怎么办

立即去 https://github.com/settings/tokens 撤销那个 PAT。
然后：
- 在 web-helper 里点「清空本地配置」
- 重新生成新 PAT，重新绑定 Gist

### 如果想停止使用

1. 在 web-helper：「数据备份」面板下的"高级 / 危险操作" → 点「清空本地 Token / Gist 配置」
2. 在 GitHub：
   - https://gist.github.com/ 找到 `xyzw-backup.json` 那个 gist → Delete gist
   - https://github.com/settings/tokens 撤销 PAT

---

## 六、故障排查

| 现象 | 排查 |
|---|---|
| **"验证失败 (401)"** | Token 错或过期。重新生成一个 |
| **"验证失败 (403)"** | Token 没有 gist 权限。fine-grained PAT 重新生成时勾上 `Gists: Read and write` |
| **"创建失败 (422)"** | 内容格式问题；通常不会发生。看浏览器 DevTools Network 里的具体响应 |
| **连续 3 次自动备份失败** | 系统会自动暂停定时器，UI 上出现"重置失败状态"按钮，点一下继续 |
| **"该版本过大被 GitHub 截断"** | 单个 gist 文件超过 1 MB（极罕见，token 数量需要数千以上）。需要清理无用 token |
| **页面刷新后开关变回关闭** | 检查浏览器是否禁用了 localStorage（无痕模式部分浏览器会限制） |
| **GitHub API 速率限制** | 5000 req/小时，正常使用绝无可能触发 |

---

## 七、备份内容明细

每次备份的 JSON 包含以下内容（schema v1.2）：

| 字段 | 含义 |
|---|---|
| `tokens` | 所有游戏 token（**含完整 base64**） |
| `scheduledTasks` | 定时任务列表 |
| `batchSettings` | 批量执行的延迟、阈值等设置 |
| `tokenSettings` | 每个 token 单独的任务配置 |
| `tokenGroups` | token 分组 |
| `taskTemplates` | 保存的任务模板 |
| `tokenSortConfig` | token 列表排序 |
| `userPreferences` | 主题、语言等 |
| `theme` | 当前主题 |
| `selectedTokenId` | 当前选中的 token |

**不包含**：
- 任务执行历史日志（无意义且体积大）
- IndexedDB 中的二进制 token（bin / 微信扫码原始文件，可从 token 字段重建）
- 跨标签页连接状态等运行时缓存

---

## 八、常见疑问

**Q：每 30 分钟备份一次，会不会用完 GitHub 免费配额？**
A：不会。GitHub 对免费账号的 API 限额是 5000 次/小时，每次备份只用 1 个请求。每天就算备份 48 次，一个月 1440 次，远远低于配额。

**Q：会不会因为备份太频繁被 GitHub 限流？**
A：不会。如果间隔短于 5 分钟可能触发滥用检测，所以本工具最低间隔限制为 15 分钟。

**Q：可以多台设备共用一个 Gist 吗？**
A：可以。所有设备填同一个 Token + 同一个 Gist ID 即可。注意：每台设备会按自己的本地配置去覆写 gist，最后一次写的覆盖前面的。建议只让一台主设备开自动备份，其它设备只用来"恢复"。

**Q：可以手动编辑 gist 里的 JSON 吗？**
A：可以。GitHub 网页上直接 edit → 保存。下次"恢复"会读到你编辑后的版本。

**Q：Gist 里的 token 会不会被 GitHub 看到？**
A：技术上 GitHub 服务端能访问。如果你不信任 GitHub 持有这些数据，请不要使用此功能。安全模型与「token 明文存在浏览器」是同等级别。

**Q：能加密上传吗？**
A：当前版本不支持。如有需要，导出后用 7z / age 等工具自己加密再粘到 gist。
