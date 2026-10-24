const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Only call for the fresh, complete role_getroleinfo snapshot, never a role patch. */
export function normalizeDailyRoleSnapshot(role) {
  if (!object(role) || !object(role.dailyTask) || !Number.isFinite(role.dailyTask.dailyTime) || role.dailyTask.dailyTime <= 0)
    throw new Error("服务器任务列表不完整，不能判断完成状态");
  const daily = { ...role.dailyTask };
  for (const key of ["complete", "dailyReward", "weekReward"]) {
    if (daily[key] === undefined) daily[key] = {};
    if (!object(daily[key])) throw new Error("服务器任务列表不完整，不能判断完成状态");
  }
  for (const key of ["dailyPoint", "weekPoint", "weekTime"]) {
    if (daily[key] === undefined) daily[key] = 0;
    if (!Number.isFinite(daily[key]) || daily[key] < 0) throw new Error("服务器积分奖励状态不完整");
  }
  return { ...role, dailyTask: daily };
}

export function chinaDayStart(now) {
  return Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
}

export function arenaAvailability(now, constants) {
  const start = Number(constants?.arenaStarTime), end = Number(constants?.arenaOverTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error("缺少有效竞技场开放时间配置");
  const seconds = (now - chinaDayStart(now)) / 1000;
  return seconds > start && seconds < end;
}

export function remainingFreeFishing(role, constants, now) {
  const limit = Number(constants?.DailyFreeFishing);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("缺少有效免费钓鱼次数配置");
  const stamp = role.statisticsTime?.["ar:normal:lo:cnt"] ?? 0;
  const raw = role.statistics?.["ar:normal:lo:cnt"] ?? 0;
  if (!Number.isFinite(stamp) || !Number.isSafeInteger(raw) || raw < 0) throw new Error("免费钓鱼次数状态异常");
  return Math.max(0, limit - (stamp * 1000 >= chinaDayStart(now) ? raw : 0));
}

export function rewardProgressText(daily, definitions, weekly = false) {
  const prefix = weekly ? "周活跃" : "日活跃";
  const points = daily[weekly ? "weekPoint" : "dailyPoint"];
  const claimed = daily[weekly ? "weekReward" : "dailyReward"];
  const next = [...definitions].sort((a, b) => a.limit - b.limit).find(row => row.limit > points);
  const eligible = definitions.filter(row => row.limit <= points && claimed[row.id] !== true);
  if (eligible.length) return `${prefix}${points}分，仍待领取档位${eligible.map(row => row.id).join("、")}`;
  if (next) return `${prefix}${points}/${next.limit}分，下一档尚差${next.limit - points}分，未达标档位正常跳过；已达标档位均已领取`;
  return `${prefix}${points}分，所有档位均已领取`;
}

export function dailyConditionEnabled(condition, settings, linkedRecruit = false) {
  const options = { 4: settings.payRecruit || linkedRecruit, 5: settings.claimHangUp, 7: settings.openBox || linkedRecruit,
    12: settings.blackMarketPurchase || settings.blackMarketDiscountPurchase, 13: settings.arenaEnable, 14: settings.claimBottle };
  return Object.hasOwn(options, condition) ? !!options[condition] : true;
}

/** A normal stop (no hero, no progress) is different from a caught push exception. */
export function classifyDailyStepResult(result) {
  if (result?.reason === "unknown") return { status: "pending", reason: "服务器未提供明确可领取状态" };
  if (result?.pushError || result?.status === "failed") return { status: "failed", reason: result.pushError || result.reason || "步骤执行失败" };
  if (result?.status === "pending" || result === false) return { status: "pending", reason: result?.reason || "步骤结果尚未确认" };
  if (result?.status === "skipped" || result?.skipped === true) return { status: "skipped", reason: result.reason || "当前条件不具备" };
  if (result?.status && !["completed", "stopped"].includes(result.status)) return { status: "pending", reason: result.reason || `未知步骤状态：${result.status}` };
  if (result?.status === "stopped" && !result.reason) return { status: "pending", reason: "步骤已停止但未说明原因" };
  return { status: "completed", reason: result?.reason };
}
