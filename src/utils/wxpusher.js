import { normalizeTaskResultStatus } from "./scheduledTaskResult.js";
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

/** 推送只保留任务和简要原因，完整诊断留在任务日志中。 */
function briefTaskReason(value, fallbackTask) {
  const text = String(value ?? "").split(/\r?\n/).map(line => line.trim()).find(Boolean)?.replace(/^\d{2}:\d{2}:\d{2}\s*/, "") || "未取得完成结果";
  const separator = text.search(/[：:]/);
  const task = (separator > 0 ? text.slice(0, separator) : fallbackTask)
    .replace(/领取赛程\d+队伍.*竞猜奖励/g, "逐鹿盐山竞猜领奖")
    .replace(/(?:结果未生效|结果未确认|失败)$/, "");
  const detail = separator > 0 ? text.slice(separator + 1) : text;
  const code = detail.match(/服务器错误[：:\s]*(\d+)|\b(200020|200400)\b/);
  let reason;
  if (code) {
    reason = `服务器异常（${code[1] || code[2]}）`;
    if (/未确认|结果未生效|状态未确认/.test(text)) reason += "，执行结果未确认";
  } else if (/断开|未连接|连接失败|连接异常|连接超时/.test(detail)) reason = "账号连接异常";
  else if (/超时|timeout/i.test(detail)) reason = "请求超时，执行结果未确认";
  else {
    reason = detail.replace(/[,，;；]?(?:已停止[,，]?重新执行会先查询状态|等待\d+秒后.*|请尝试重启游戏解决.*|请查看.*日志.*).*$/, "").trim();
    if (!reason || /[{}]|at \S+\s*\(/.test(reason)) reason = "执行异常，请在应用内查看详情";
  }
  const compact = value => [...value].length > 60 ? [...value].slice(0, 59).join("") + "…" : value;
  return `${compact(task || fallbackTask)}：${compact(reason)}`;
}

function formatTaskReport(taskName, tokenResults, scheduled, startTime, upcomingTasks) {
  const results = tokenResults.map(result => ({ ...result, status: normalizeTaskResultStatus(result.status) }));
  const completed = results.filter(result => result.status === "completed").length;
  const allCompleted = results.length > 0 && completed === results.length;
  const title = `${allCompleted ? "✅" : "⚠️"} ${scheduled ? "定时任务" : "批量日常任务"}${allCompleted ? "完成" : "执行结束"}${scheduled ? `: ${taskName}` : ""} (${completed}/${results.length})`;
  const finishedAt = new Date();
  const startedAt = new Date(startTime);
  const elapsed = Number.isFinite(startedAt.getTime())
    ? Math.max(0, Math.floor((finishedAt - startedAt) / 1000)) : null;
  const countStatus = status => results.filter(result => result.status === status).length;
  const lines = [
    `成功 ${completed}/${results.length} 个账号。`,
    "",
    "| 项目 | 数值 |",
    "|------|------|",
    `| 总账号 | ${results.length} |`,
    `| 成功 | ${completed} |`,
    `| 失败 | ${countStatus("failed")} |`,
    `| 耗时 | ${elapsed === null ? "未知" : `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`} |`,
    `| 完成时间 | ${formatNotificationTime(finishedAt)} |`,
  ];
  let hasReasons = false;
  for (const result of results) {
    const reasons = [...(result.reasons || []), ...(result.warnings || [])];
    if (!["completed", "skipped"].includes(result.status) && !reasons.length) {
      reasons.push(result.error || (result.status === "stopped" ? "任务已停止" : "未取得明确完成结果"));
    }
    if (!reasons.length) continue;
    const concise = [...new Set(reasons.map(reason => briefTaskReason(reason, taskName)))];
    if (!hasReasons) lines.push("", "未完成任务：");
    hasReasons = true;
    concise.forEach(reason => lines.push(`- ${String(result.name ?? "未知账号").replace(/[\r\n]+/g, " ")}：${reason}`));
  }
  if (scheduled && Array.isArray(upcomingTasks) && upcomingTasks.length) {
    lines.push("", "## 后续批量任务", "", "| 序号 | 任务名称 | 启动时间 |", "|------|----------|----------|");
    upcomingTasks.forEach((task, index) => lines.push(
      `| ${index + 1} | ${escapeMarkdownTableCell(String(task.name ?? "未知任务").replace(/[\r\n]+/g, " "))} | ${formatNotificationTime(task.startTime)} |`,
    ));
  }
  if (results.length) {
    lines.push("", "本次执行账号清单：");
    results.forEach(result => lines.push(`- ${String(result.name ?? "未知账号").replace(/[\r\n]+/g, " ")}`));
  }
  return { title, content: lines.join("\n") };
}

/** 定时结果汇总执行统计、本次账号、简要原因和后续启动时间。 */
export function formatScheduledTaskNotification(taskName, tokenResults, startTime, upcomingTasks = null) {
  return formatTaskReport(taskName, tokenResults, true, startTime, upcomingTasks);
}

/** 手动批量与定时计划使用相同的简洁结果格式。 */
export function formatBatchTaskNotification(tokenResults, startTime) {
  return formatTaskReport("日常任务", tokenResults, false, startTime);
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
