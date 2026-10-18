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
    assert.match(result.content, /待补账号：日常.*未取得明确完成结果/);
    assert.match(result.content, /停止账号：日常.*任务已停止/);
    assert.doesNotMatch(result.content, /完成账号/);
    assert.match(result.content, /未完成任务/);
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
    assert.match(report.content, /成功 0\/3 个账号/);
    assert.doesNotMatch(report.content, /### ✅ 成功账号/);
  });
  test(`${name}含失败时标题不再声称完成`, () => {
    assert.match(format([{ name: "失败", status: "failed" }]).title, /⚠️.*执行结束/);
  });
}

test("日常领奖成功但附加任务异常，推送完成并展示具体提醒", () => {
  const report = formatScheduledTaskNotification("日常", [{ name: "日志账号", status: "completed", warnings: ["逐鹿盐山竞猜：200020，查询后未确认生效"] }], new Date());
  assert.match(report.title, /✅.*完成.*1\/1/);
  assert.match(report.content, /未完成任务/);
  assert.match(report.content, /逐鹿盐山竞猜：服务器异常（200020），执行结果未确认/);
  assert.match(report.content, /成功 1\/1 个账号/);
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
    for (const text of ["领取每日礼包：服务器异常（200020）", "梦境：请求超时", "周活跃第1档已达标但未领取", "用户停止"])
      assert.ok(report.content.includes(text));
    assert.match(report.title, /⚠️.*执行结束/);
    assert.doesNotMatch(report.content, /未达标.*失败/);
  });
  test(`${name}只展示未完成任务和短原因，不携带日志、堆栈或成功清单`, () => {
    const reason = "逐鹿盐山助威与竞猜：领取赛程74队伍A10000037竞猜奖励结果未确认：领取赛程74队伍A10000037竞猜奖励失败：服务器错误: 200020 - 出了点小问题，请尝试重启游戏解决～，已停止，重新执行会先查询状态\n08:01:02 开始自动梦境\n at runAccount (apex.js:172)";
    const report = format([
      { name: "火柴-服务员", status: "completed", warnings: [reason, reason] },
      { name: "正常账号", status: "completed" },
      { name: "其他账号", status: "failed", reasons: ["梦境：请求超时\n后续日志"] },
    ]);
    assert.match(report.content, /火柴-服务员：逐鹿盐山助威与竞猜：服务器异常（200020），执行结果未确认/);
    assert.match(report.content, /其他账号：梦境：请求超时，执行结果未确认/);
    assert.equal(report.content.match(/火柴-服务员/g).length, 1);
    assert.doesNotMatch(report.content, /正常账号|赛程74|A10000037|重启|6秒|08:01|runAccount|后续日志|开始自动梦境/);
  });
  test(`${name}未知长原因限制长度，保留所有未完成任务`, () => {
    const report = format([{ name: "账号", status: "failed", reasons: ["任务甲：" + "原因".repeat(100), "任务乙：未达到执行条件"] }]);
    assert.match(report.content, /任务甲：原因.*…/);
    assert.match(report.content, /任务乙：未达到执行条件/);
    assert.ok(report.content.length < 180);
  });
}

test("全成功通知仅保留数量，不列出成功账号或调度信息", () => {
  const report = formatScheduledTaskNotification("日常", [{ name: "完成账号", status: "completed" }], new Date(), [{ name: "后续计划", startTime: new Date() }]);
  assert.equal(report.content, "成功 1/1 个账号。");
});
