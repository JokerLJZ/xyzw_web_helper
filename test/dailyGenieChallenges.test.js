import assert from "node:assert/strict";
import { test } from "node:test";
import { runDailyGenieChallenges } from "../src/utils/dailyGenieChallenges.js";
import { defaultSettings, defaultTemplate } from "../src/utils/batch/constants.js";

test("自动灯神默认关闭", () => {
  assert.equal(defaultSettings.genieChallengeEnable, false);
  assert.equal(defaultTemplate.genieChallengeEnable, false);
});

test("日常灯神严格先魏蜀吴后群雄，子任务不能关闭连接", async () => {
  const order = [];
  let released = 0;
  await runDailyGenieChallenges({
    tokenId: "t", tokenStore: { gameTokens: [{ id: "t" }], getWebSocketStatus: () => "connected", closeWebSocketConnection: () => assert.fail("日常连接不得关闭") },
    stopped: () => false, log: () => {}, delaySettings: { commandDelay: 0 },
    createTasks: (deps) => ({
      batchChallengeThreeKingdomsGenie: async () => {
        await deps.ensureConnection("t"); order.push("three");
        deps.tokenStore.closeWebSocketConnection("t"); deps.releaseConnectionSlot();
      },
      batchChallengeGroupGenie: async () => { order.push("group"); },
    }),
  });
  assert.deepEqual(order, ["three", "group"]);
});

test("魏蜀吴阶段收到停止信号后不得进入群雄或清除停止状态", async () => {
  let stopped = false;
  await runDailyGenieChallenges({
    tokenId: "t", tokenStore: {}, stopped: () => stopped, log: () => {}, delaySettings: { commandDelay: 0 },
    createTasks: (deps) => ({
      batchChallengeThreeKingdomsGenie: async () => { stopped = true; deps.shouldStop.value = false; },
      batchChallengeGroupGenie: () => assert.fail("不得执行群雄"),
    }),
  });
});
