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
