import test from "node:test";
import assert from "node:assert/strict";
import { isSignupDay } from "../src/utils/batch/signupSchedule.js";
import { createTasksSalt } from "../src/utils/batch/tasksSalt.js";
import { runAutoCampSignup, runAutoPeachSignup } from "../src/utils/batch/tasksSignupCheer.js";

test("北京时间周六周日边界，不依赖系统时区", () => {
  assert.equal(isSignupDay(new Date("2026-10-09T16:00:00Z"), 6), true);
  assert.equal(isSignupDay(new Date("2026-10-10T15:59:59Z"), 6), true);
  assert.equal(isSignupDay(new Date("2026-10-10T16:00:00Z"), 6), false);
  assert.equal(isSignupDay(new Date("2026-10-10T16:00:00Z"), 0), true);
  assert.equal(isSignupDay(new Date("2026-10-11T16:00:00Z"), 0), false);
});

test("营地和蟠桃非周日直接跳过，不读取配置或发送请求", async () => {
  for (const runner of [runAutoCampSignup, runAutoPeachSignup]) {
    for (let day = 5; day <= 10; day++) {
      const result = await runner({ config: null, now: () => new Date(`2026-10-${String(day).padStart(2, "0")}T09:00:00+08:00`), send: () => assert.fail("不应发送请求") });
      assert.equal(result.status, "skipped");
      assert.match(result.reason, /仅周日/);
    }
  }
});

test("盐场非周六跳过，不建立连接", async () => {
  const logs = [];
  const deps = { selectedTokens: { value: ["a"] }, addLog: log => logs.push(log), ensureConnection: () => assert.fail("不应连接") };
  await createTasksSalt(deps, { now: () => new Date("2026-10-11T09:00:00+08:00") }).batchSaltSignup();
  assert.match(logs[0].message, /仅周六/);
});
