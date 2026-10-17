import assert from "node:assert/strict";
import { test } from "node:test";
import { formatScheduledTaskNotification, formatBatchTaskNotification } from "../src/utils/wxpusher.js";

for (const [name, format] of [
  ["定时", (results) => formatScheduledTaskNotification("日常补差", results, new Date())],
  ["批量", (results) => formatBatchTaskNotification(results, new Date())],
]) {
  test(`${name}通知区分待继续和停止，不误报全部成功`, () => {
    const result = format([
      { name:"完成账号", status:"completed" },
      { name:"待补账号", status:"pending" },
      { name:"停止账号", status:"stopped" },
    ]);
    assert.match(result.title, /⚠️.*执行结束/);
    assert.match(result.content, /\| 待继续 \| 1 \|/);
    assert.match(result.content, /\| 已停止 \| 1 \|/);
    assert.match(result.content, /### 待继续账号\n- 待补账号/);
    assert.match(result.content, /### 已停止账号\n- 停止账号/);
    assert.match(format([{name:"完成账号",status:"completed"}]).title, /✅.*完成/);
  });
}

for (const [name, format] of [
  ["定时", results => formatScheduledTaskNotification("日常", results, new Date())],
  ["批量", results => formatBatchTaskNotification(results, new Date())],
]) {
  test(`${name}通知对缺失、等待和执行中状态保守标记待继续`, () => {
    const report = format([{ name: "无结果" }, { name: "未执行", status: "waiting" }, { name: "执行中", status: "running" }]);
    assert.match(report.title, /⚠️.*执行结束.*0\/3/);
    assert.match(report.content, /\| 待继续 \| 3 \|/);
    assert.doesNotMatch(report.content, /### ✅ 成功账号/);
  });
  test(`${name}含失败时标题不再声称完成`, () => {
    assert.match(format([{ name: "失败", status: "failed" }]).title, /⚠️.*执行结束/);
  });
}

test("日常领奖成功但附加任务异常，推送完成并展示具体提醒", () => {
  const report = formatScheduledTaskNotification("日常", [{ name: "日志账号", status: "completed", warnings: ["逐鹿盐山竞猜：200020，查询后未确认生效"] }], new Date());
  assert.match(report.title, /✅.*完成.*1\/1/);
  assert.match(report.content, /### 附加任务提示/);
  assert.match(report.content, /逐鹿盐山竞猜：200020，查询后未确认生效/);
  assert.match(report.content, /\| 失败 \| 0 \|/);
});

for (const [name, format] of [
  ["定时", results => formatScheduledTaskNotification("含日常的批量计划", results, new Date())],
  ["手动批量", results => formatBatchTaskNotification(results, new Date())],
]) {
  test(`${name}推送包含逐账号失败、待继续和停止的具体原因`, () => {
    const report = format([
      { name: "账号A", status: "failed", reasons: ["领取每日礼包：服务器错误200020", "梦境：推层查询超时"] },
      { name: "账号B", status: "pending", reasons: ["周活跃第1档已达标但未领取"] },
      { name: "账号C", status: "stopped", reasons: ["用户停止"] },
    ]);
    for (const text of ["领取每日礼包：服务器错误200020", "梦境：推层查询超时", "周活跃第1档已达标但未领取", "用户停止"])
      assert.ok(report.content.includes(text));
    assert.match(report.title, /⚠️.*执行结束/);
    assert.doesNotMatch(report.content, /未达标.*失败/);
  });
}
