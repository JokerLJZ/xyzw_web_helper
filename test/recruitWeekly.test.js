import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

const createRecruitScenario = ({
  recruitItemCount,
  activityWeek,
  recruitCount = 100,
  roundCount = 1,
}) => {
  const tokenId = "token-1";
  const token = { id: tokenId, name: "测试账号" };
  let currentRecruitItemCount = recruitItemCount;
  const commands = [];
  const logs = [];

  const getRoleInfo = () => ({
    role: {
      items: {
        1001: { quantity: currentRecruitItemCount },
      },
    },
  });

  const tokenStore = {
    async sendGetRoleInfo() {
      return getRoleInfo();
    },
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });

      if (cmd === "hero_recruit") {
        assert.ok(
          currentRecruitItemCount >= params.recruitNumber,
          `招募道具不足：当前${currentRecruitItemCount}，需要${params.recruitNumber}`,
        );
        currentRecruitItemCount -= params.recruitNumber;
      }

      if (cmd === "mail_claimallattachment") {
        currentRecruitItemCount += 40;
      }

      return {};
    },
    async sendMessage(_tokenId, cmd) {
      commands.push({ cmd });
      return {};
    },
    closeWebSocketConnection() {},
  };

  const deps = {
    selectedTokens: { value: [tokenId] },
    tokens: { value: [token] },
    tokenStatus: { value: {} },
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { recruitCount, maxActive: 1 },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    helperSettings: { count: 100 },
    delayConfig: { action: 0 },
    activityWeek: { value: activityWeek },
  };

  return {
    run: () =>
      createTasksItem(deps).batchSmartRecruitWeekly({ roundCount }),
    commands,
    logs,
    tokenStatus: deps.tokenStatus,
    getRoleInfo,
  };
};

const getRecruitCommands = (commands) =>
  commands.filter((item) => item.cmd === "hero_recruit");

test("招募周按360次、领取邮件、再完成40次", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 360,
    activityWeek: "招募周",
    recruitCount: 100,
  });

  await scenario.run();

  const recruitCommands = getRecruitCommands(scenario.commands);
  assert.equal(
    recruitCommands.slice(0, 36).reduce(
      (total, command) => total + command.params.recruitNumber,
      0,
    ),
    360,
  );
  assert.equal(
    recruitCommands.slice(36).reduce(
      (total, command) => total + command.params.recruitNumber,
      0,
    ),
    40,
  );
  assert.equal(
    scenario.commands.filter((item) => item.cmd === "mail_claimallattachment")
      .length,
    1,
  );
  assert.equal(scenario.getRoleInfo().role.items[1001].quantity, 0);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("已完成360个，开始领取邮件附件")),
    true,
  );
});

test("招募周起始招募道具不足360个时跳过", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 359,
    activityWeek: "招募周",
  });

  await scenario.run();

  assert.equal(getRecruitCommands(scenario.commands).length, 0);
  assert.equal(
    scenario.commands.filter((item) => item.cmd === "mail_claimallattachment")
      .length,
    0,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "skipped");
});

test("非招募周跳过智能招募周任务", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 100,
    activityWeek: "宝箱周",
    recruitCount: 100,
  });

  await scenario.run();

  assert.equal(getRecruitCommands(scenario.commands).length, 0);
  assert.equal(
    scenario.commands.filter((item) => item.cmd === "mail_claimallattachment")
      .length,
    0,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "skipped");
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("跳过智能招募周任务")),
    true,
  );
});

test("按配置轮次重复执行360次、领取邮件和40次", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 720,
    activityWeek: "招募周",
    roundCount: 2,
  });

  await scenario.run();

  const totalRecruitCount = getRecruitCommands(scenario.commands).reduce(
    (total, command) => total + command.params.recruitNumber,
    0,
  );
  assert.equal(totalRecruitCount, 800);
  assert.equal(
    scenario.commands.filter((item) => item.cmd === "mail_claimallattachment")
      .length,
    2,
  );
  assert.equal(scenario.getRoleInfo().role.items[1001].quantity, 0);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("任务完成：2/2轮")),
    true,
  );
});
