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
