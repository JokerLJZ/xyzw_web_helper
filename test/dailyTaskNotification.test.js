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
