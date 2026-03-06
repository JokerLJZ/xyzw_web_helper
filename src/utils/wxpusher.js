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

/**
 * 格式化定时任务完成通知 (Markdown)
 * @param {string} taskName - 定时任务名称
 * @param {Array<{name: string, status: 'completed'|'failed', error?: string}>} tokenResults
 * @param {Date} startTime - 任务开始时间
 * @returns {{title: string, content: string}}
 */
export function formatScheduledTaskNotification(taskName, tokenResults, startTime) {
  const total = tokenResults.length;
  const completed = tokenResults.filter((r) => r.status === "completed").length;
  const failed = tokenResults.filter((r) => r.status === "failed").length;

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
