import test from "node:test";
import assert from "node:assert/strict";
import { summarizeScheduledAccount } from "../src/utils/scheduledTaskResult.js";
import { formatScheduledTaskNotification } from "../src/utils/wxpusher.js";

test("账号日常未领奖后即使后续任务成功，推送仍为待继续", () => {
  for (const statuses of [["pending", "completed"], ["completed", "pending"], ["pending", "skipped", "completed"]]) {
    const status = summarizeScheduledAccount(statuses);
    assert.equal(status, "pending");
    const report = formatScheduledTaskNotification("批量日常", [{ name: "未领奖账号", status }, { name: "已完成账号", status: "completed" }], new Date());
    assert.match(report.title, /⚠️.*执行结束.*1\/2/);
    assert.match(report.content, /### 待继续账号\n- 未领奖账号/);
    assert.doesNotMatch(report.content, /### ✅ 成功账号\n- 未领奖账号/);
  }
});
test("停止、失败及无结果不能被后续成功覆盖", () => {
  assert.equal(summarizeScheduledAccount(["failed", "completed"]), "failed");
  assert.equal(summarizeScheduledAccount(["stopped", "completed"]), "stopped");
  assert.equal(summarizeScheduledAccount(["completed"], true), "stopped");
  assert.equal(summarizeScheduledAccount([]), "pending");
  assert.equal(summarizeScheduledAccount([undefined, "completed"]), "pending");
});
test("账号正常完成和全部跳过分别保留结果", () => {
  assert.equal(summarizeScheduledAccount(["completed", "completed"]), "completed");
  assert.equal(summarizeScheduledAccount(["skipped", "completed"]), "completed");
  assert.equal(summarizeScheduledAccount(["skipped", "skipped"]), "skipped");
});
