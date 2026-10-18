const terminalStatuses = new Set(["completed", "failed", "pending", "stopped", "skipped"]);

/** Missing or in-progress results never prove completion. */
export function normalizeTaskResultStatus(status) {
  return terminalStatuses.has(status) ? status : "pending";
}

/** Keep every subtask's outcome even when later tasks update the account row. */
export function summarizeScheduledAccount(statuses, stopped = false) {
  const results = statuses.map(normalizeTaskResultStatus);
  if (results.includes("failed")) return "failed";
  if (stopped || results.includes("stopped")) return "stopped";
  if (!results.length || results.includes("pending")) return "pending";
  return results.every(status => status === "skipped") ? "skipped" : "completed";
}

/** Supplemental activities cannot turn verified daily rewards into a daily failure. */
export function getDailyRunStatus(result) {
  if (result?.planFailed > 0) return "failed";
  const remaining = result?.planIncomplete ?? result?.dailyIncomplete ?? result?.incomplete;
  return Number.isFinite(remaining) && remaining === 0 ? "completed" : "pending";
}

/** One retry round, only when no more than 30% of the original accounts failed. */
export function getBatchRetryTokenIds(tokenIds, statuses, stopped = false) {
  if (stopped || !tokenIds.length) return [];
  const failed = tokenIds.filter(id => statuses[id] === "failed");
  return failed.length > 0 && failed.length * 10 <= tokenIds.length * 3 ? failed : [];
}
