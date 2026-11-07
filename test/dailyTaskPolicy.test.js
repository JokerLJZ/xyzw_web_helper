import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDailyRoleSnapshot, arenaAvailability, remainingFreeFishing, dailyConditionEnabled, rewardProgressText, classifyDailyStepResult } from "../src/utils/dailyTaskPolicy.js";
import { mergeRoleSnapshot } from "../src/utils/roleSnapshot.js";
import { getClaimablePointRewards } from "../src/utils/dailyTaskState.js";
const now = Date.parse("2026-10-18T12:00:00+08:00");
const constants = { arenaStarTime: 21600, arenaOverTime: 79200, DailyFreeFishing: 3 };

test("完整快照按模型补零和空Map，null/异常结构不补齐", () => {
  const role = normalizeDailyRoleSnapshot({ dailyTask: { dailyTime: now / 1000 } });
  assert.equal(role.dailyTask.weekPoint, 0);
  assert.deepEqual(getClaimablePointRewards(role.dailyTask, [{ id: 1, limit: 100 }], true), []);
  for (const dailyTask of [null, {}, { dailyTime: now/1000, weekReward: null }, { dailyTime: now/1000, complete: [] }, { dailyTime: now/1000, weekPoint: -1 }])
    assert.throws(() => normalizeDailyRoleSnapshot({ dailyTask }));
});

test("增量合并不补零、不清除已领取记录", () => {
  const role = { dailyTask: { weekPoint: 300, weekReward: { 1: true } } };
  mergeRoleSnapshot(role, { dailyTask: { dailyPoint: 20 } });
  assert.equal(role.dailyTask.weekPoint, 300);
  assert.deepEqual(role.dailyTask.weekReward, { 1: true });
});

test("竞技场使用服务器北京时间和精确边界", () => {
  for (const [time, open] of [["05:59:59", false], ["06:00:00", false], ["06:00:01", true], ["21:59:59", true], ["22:00:00", false], ["22:59:59", false]])
    assert.equal(arenaAvailability(Date.parse(`2026-10-18T${time}+08:00`), constants), open, time);
  assert.throws(() => arenaAvailability(now, {}), /配置/);
});

test("免费钓鱼由当日计数计算剩余，跨日恢复，不用最后抽奖时间代替次数", () => {
  const role = { statistics: { "ar:normal:lo:cnt": 1, "artifact:normal:lottery:time": now/1000 }, statisticsTime: { "ar:normal:lo:cnt": now/1000 } };
  assert.equal(remainingFreeFishing(role, constants, now), 2);
  role.statistics["ar:normal:lo:cnt"] = 3;
  assert.equal(remainingFreeFishing(role, constants, now), 0);
  assert.equal(remainingFreeFishing(role, constants, now + 86400000), 3);
  assert.throws(() => remainingFreeFishing(role, {}, now));
});

test("用户关闭只排除操作目标，仍能按服务器状态领取已有积分奖励", () => {
  for (const id of [4,5,7,12,13,14]) assert.equal(dailyConditionEnabled(id, {}), false);
  assert.equal(dailyConditionEnabled(7, {}, true), true);
  assert.equal(dailyConditionEnabled(1, {}), true);
});

test("周活跃零分和差一分正常未达标，明确展示当前积分及缺分", () => {
  const definitions = [100,200,300,400,500].map((limit, index) => ({ id: index+1, limit }));
  for (const weekPoint of [0,99]) {
    const daily = { weekPoint, weekReward: {} };
    assert.deepEqual(getClaimablePointRewards(daily, definitions, true), []);
    assert.match(rewardProgressText(daily, definitions, true), /未达标档位正常跳过/);
  }
  assert.deepEqual(getClaimablePointRewards({ weekPoint: 100, weekReward: {} }, definitions, true), [1]);
  assert.match(rewardProgressText({ weekPoint: 150, weekReward: { 1: true } }, definitions, true), /150\/200.*尚差50/);
});

test("梦境正常结束、异常及未知状态各自判定", () => {
  assert.equal(classifyDailyStepResult({ status: "stopped", reason: "吕布无法推进" }).status, "completed");
  assert.equal(classifyDailyStepResult({ status: "stopped", pushError: "200020", reason: "推层异常" }).status, "failed");
  assert.equal(classifyDailyStepResult({ skipped: true, reason: "unknown" }).status, "pending");
  assert.equal(classifyDailyStepResult({ skipped: true, reason: "claimed" }).status, "skipped");
});

test("未识别的步骤状态不能默认为完成", () => {
  assert.equal(classifyDailyStepResult({ status: "unknown" }).status, "pending");
  assert.equal(classifyDailyStepResult({ status: "stopped" }).status, "pending");
});
