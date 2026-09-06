/**
 * WxPusher / PushPlus 推送工具
 * WxPusher 文档: https://wxpusher.zjiecode.com/docs
 * PushPlus 文档: https://www.pushplus.plus/doc/
 */

const WXPUSHER_API = "https://wxpusher.zjiecode.com/api/send/message";
const PUSHPLUS_API = "https://www.pushplus.plus/send";

/**
 * 发送 WxPusher 消息
 * @param {Object} config - WxPusher 配置
 * @param {string} config.appToken - 应用 Token (AT_xxx)
 * @param {string|string[]} config.uids - 接收者 UID 或 UID 数组 (逗号分隔字符串)
 * @param {string} title - 消息标题 (摘要，显示在通知栏)
 * @param {string} content - 消息内容
 * @param {number} [contentType=3] - 内容类型: 1=文本, 2=HTML, 3=Markdown
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function sendWxPusherMessage(config, title, content, contentType = 3) {
  const { appToken, uids } = config;

  if (!appToken) throw new Error("缺少 WxPusher AppToken");
  if (!uids) throw new Error("缺少接收者 UID");

  const uidList = Array.isArray(uids)
    ? uids.map((u) => u.trim()).filter(Boolean)
    : String(uids).split(",").map((u) => u.trim()).filter(Boolean);

  if (uidList.length === 0) throw new Error("UID 列表为空");

  const payload = {
    appToken,
    content,
    summary: title,
    contentType,
    uids: uidList,
  };

  const response = await fetch(WXPUSHER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`WxPusher 请求失败: HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.code !== 1000) {
    throw new Error(`WxPusher 返回错误: ${result.msg || "未知错误"}`);
  }

  return { success: true, message: result.msg || "发送成功" };
}

/**
 * 发送 PushPlus 消息
 * @param {string} token - PushPlus Token
 * @param {string} title - 消息标题
 * @param {string} content - 消息内容（Markdown 格式）
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function sendPushPlusMessage(token, title, content) {
  if (!token) throw new Error("缺少 PushPlus Token");

  const payload = { token, title, content, template: "markdown" };

  const response = await fetch(PUSHPLUS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`PushPlus 请求失败: HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.code !== 200) {
    throw new Error(`PushPlus 返回错误: ${result.msg || "未知错误"}`);
  }

  return { success: true, message: result.msg || "发送成功" };
}

function formatNotificationTime(time) {
  const date = time instanceof Date ? time : new Date(time);
  if (isNaN(date.getTime())) return "未知";

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function escapeMarkdownTableCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

// 赤羽在游戏奖励数据中的道具 ID。指定 magic 分支的
// api采集/养号/吕布赤羽.txt 记录中，13041 是赤羽道具，1304 则是鱼灵类型 ID。
export const RED_FEATHER_ITEM_ID = 13041;

/**
 * 从 artifact_lottery 返回值中提取本次新获得的赤羽数量。
 *
 * 角色同步数据中的 role.items[13041].quantity 可能是库存总量，不能直接用来
 * 统计本次奖励，因此这里只扫描 reward/rewards/rewardList 等奖励字段。
 */
export function getRedFeatherCountFromLotteryResult(result) {
  let count = 0;
  const visited = new Set();
  const rewardKeyPattern = /reward/i;

  const getRewardQuantity = (reward) => {
    for (const key of ["value", "quantity", "count", "num"]) {
      if (Object.prototype.hasOwnProperty.call(reward, key)) {
        const value = Number(reward[key]);
        return Number.isFinite(value) ? Math.max(0, value) : 0;
      }
    }
    return 1;
  };

  const visit = (value, inRewardContext = false) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, inRewardContext));
      return;
    }

    const itemId = Number(value.itemId ?? value.itemID);
    if (inRewardContext && itemId === RED_FEATHER_ITEM_ID) {
      count += getRewardQuantity(value);
    }

    Object.entries(value).forEach(([key, child]) => {
      visit(child, inRewardContext || rewardKeyPattern.test(key));
    });
  };

  visit(result);
  return count;
}

/**
 * 格式化金鱼杆补齐中的赤羽钓获通知（Markdown 表格）。
 * @param {Array<{name: string, count: number, lotteryCount?: number, caughtAt?: Date|string}>} results
 * @returns {{title: string, content: string}}
 */
export function formatRedFeatherCatchNotification(results) {
  const validResults = (Array.isArray(results) ? results : []).filter(
    (item) => Number(item?.count) > 0,
  );
  const total = validResults.reduce((sum, item) => sum + Number(item.count), 0);
  const title = `🎣 金鱼杆钓到赤羽 (${total})`;

  const lines = [
    `## 🎣 金鱼杆补齐发现赤羽`,
    ``,
    `共 ${validResults.length} 个账号钓到赤羽，合计 **${total}** 个。`,
    ``,
    `| 账号 | 赤羽数量 | 本次钓鱼次数 | 钓到时间 |`,
    `|------|---------:|-------------:|----------|`,
  ];

  validResults.forEach((item) => {
    lines.push(
      `| ${escapeMarkdownTableCell(item.name)} | ${Number(item.count)} | ${
        Number(item.lotteryCount) || "-"
      } | ${formatNotificationTime(item.caughtAt)} |`,
    );
  });

  return { title, content: lines.join("\n") };
}

/**
 * 格式化定时任务完成通知 (Markdown)
 * @param {string} taskName - 定时任务名称
 * @param {Array<{name: string, status: 'completed'|'failed'|'skipped', error?: string}>} tokenResults
 * @param {Date} startTime - 任务开始时间
 * @param {Array<{name: string, startTime: Date|string}>} [upcomingTasks] - 后续批量任务
 * @returns {{title: string, content: string}}
 */
export function formatScheduledTaskNotification(taskName, tokenResults, startTime, upcomingTasks = null) {
  const total = tokenResults.length;
  const completed = tokenResults.filter((r) => r.status === "completed").length;
  const failed = tokenResults.filter((r) => r.status === "failed").length;
  const skipped = tokenResults.filter((r) => r.status === "skipped").length;

  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const durationStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
  const endTime = new Date().toLocaleTimeString();

  const statusIcon = failed === 0 ? "✅" : "⚠️";
  const title = `${statusIcon} 定时任务完成: ${taskName} (${completed}/${total})`;

  const lines = [
    `## ${statusIcon} 定时任务执行完毕`,
    ``,
    `**任务名称**: ${taskName}`,
    ``,
    `| 项目 | 数值 |`,
    `|------|------|`,
    `| 总账号 | ${total} |`,
    `| 成功 | ${completed} |`,
    `| 失败 | ${failed} |`,
    ...(skipped > 0 ? [`| 跳过 | ${skipped} |`] : []),
    `| 耗时 | ${durationStr} |`,
    `| 完成时间 | ${endTime} |`,
  ];

  if (failed > 0) {
    lines.push(``, `### ❌ 失败账号`);
    tokenResults
      .filter((r) => r.status === "failed")
      .forEach((r) => {
        lines.push(`- **${r.name}**${r.error ? `：${r.error}` : ""}`);
      });
  }

  if (skipped > 0) {
    lines.push(``, `### 跳过账号`);
    tokenResults
      .filter((r) => r.status === "skipped")
      .forEach((r) => {
        lines.push(`- ${r.name}`);
      });
  }

  if (completed > 0) {
    lines.push(``, `### ✅ 成功账号`);
    tokenResults
      .filter((r) => r.status === "completed")
      .forEach((r) => {
        lines.push(`- ${r.name}`);
      });
  }

  if (Array.isArray(upcomingTasks)) {
    lines.push(``, `### 后续批量任务`);
    if (upcomingTasks.length === 0) {
      lines.push(`暂无已启用的后续批量任务`);
    } else {
      lines.push(``, `| 序号 | 任务名称 | 启动时间 |`, `|------|----------|----------|`);
      upcomingTasks.forEach((task, index) => {
        lines.push(
          `| ${index + 1} | ${escapeMarkdownTableCell(task.name)} | ${formatNotificationTime(task.startTime)} |`,
        );
      });
    }
  }

  return { title, content: lines.join("\n") };
}

/**
 * 格式化批量日常任务完成通知 (Markdown)
 * @param {Array<{name: string, status: 'completed'|'failed', error?: string}>} tokenResults
 * @param {Date} startTime - 任务开始时间
 * @returns {{title: string, content: string}}
 */
export function formatBatchTaskNotification(tokenResults, startTime) {
  const total = tokenResults.length;
  const completed = tokenResults.filter((r) => r.status === "completed").length;
  const failed = tokenResults.filter((r) => r.status === "failed").length;

  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const durationStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
  const endTime = new Date().toLocaleTimeString();

  const statusIcon = failed === 0 ? "✅" : "⚠️";
  const title = `${statusIcon} 批量日常任务完成 (${completed}/${total})`;

  const lines = [
    `## ${statusIcon} 批量日常任务执行完毕`,
    ``,
    `| 项目 | 数值 |`,
    `|------|------|`,
    `| 总账号 | ${total} |`,
    `| 成功 | ${completed} |`,
    `| 失败 | ${failed} |`,
    `| 耗时 | ${durationStr} |`,
    `| 完成时间 | ${endTime} |`,
  ];

  if (failed > 0) {
    lines.push(``, `### ❌ 失败账号`);
    tokenResults
      .filter((r) => r.status === "failed")
      .forEach((r) => {
        lines.push(`- **${r.name}**${r.error ? `：${r.error}` : ""}`);
      });
  }

  if (completed > 0) {
    lines.push(``, `### ✅ 成功账号`);
    tokenResults
      .filter((r) => r.status === "completed")
      .forEach((r) => {
        lines.push(`- ${r.name}`);
      });
  }

  return { title, content: lines.join("\n") };
}

/**
 * 格式化漏执行通知 (Markdown)
 * @param {object} task - 任务对象
 * @param {Date} expectedTime - 预期执行时间
 * @param {Date} detectedTime - 检测到漏执行的时间
 * @param {boolean} willReExecute - 是否将补执行
 * @returns {{title: string, content: string}}
 */
export function formatMissedExecutionNotification(task, expectedTime, detectedTime, willReExecute = true) {
  const delayMinutes = Math.round((detectedTime.getTime() - expectedTime.getTime()) / 60000);
  const title = `⚠️ 定时任务漏执行: ${task.name} (延迟${delayMinutes}分钟)`;

  const lines = [
    `## ⚠️ 定时任务漏执行`,
    ``,
    `**任务名称**: ${task.name}`,
    ``,
    `| 项目 | 数值 |`,
    `|------|------|`,
    `| 预期执行时间 | ${expectedTime.toLocaleTimeString()} |`,
    `| 检测时间 | ${detectedTime.toLocaleTimeString()} |`,
    `| 延迟 | ${delayMinutes}分钟 |`,
    `| 状态 | ${willReExecute ? "正在补执行" : "仅通知(超时过久)"} |`,
  ];

  return { title, content: lines.join("\n") };
}
