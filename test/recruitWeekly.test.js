import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

const createRecruitScenario = ({
  recruitItemCount,
  activityWeek,
  recruitCount = 100,
  roundCount = 1,
  completedRounds = 0,
  activityProgress = 0,
}) => {
  const tokenId = "token-1";
  const token = { id: tokenId, name: "测试账号" };
  let currentRecruitItemCount = recruitItemCount;
  let currentCompletedRounds = completedRounds;
  let currentActivityProgress = activityProgress;
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

      if (cmd === "activity_get") {
        return {
          activity: {
            myTotalInfo: {
              1: {
                num: currentActivityProgress,
                rounds: Math.min(4, currentCompletedRounds + 1),
                complete:
                  currentCompletedRounds > 0
                    ? Object.fromEntries(
                        Array.from({ length: 5 }, (_, index) => [
                          index,
                          currentCompletedRounds,
                        ]),
                      )
                    : {},
              },
            },
          },
        };
      }

      if (cmd === "hero_recruit") {
        assert.ok(
          currentRecruitItemCount >= params.recruitNumber,
          `招募道具不足：当前${currentRecruitItemCount}，需要${params.recruitNumber}`,
        );
        currentRecruitItemCount -= params.recruitNumber;
        currentActivityProgress += params.recruitNumber;
      }

      if (cmd === "mail_claimallattachment") {
        currentRecruitItemCount += 40;
      }

      if (cmd === "activity_claimweekactreward") {
        currentCompletedRounds += 1;
        currentActivityProgress = 0;
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
    2,
  );
  assert.deepEqual(
    scenario.commands.find(
      (item) => item.cmd === "activity_claimweekactreward",
    )?.params,
    { selectRewardsMap: { 1: 1 }, typ: 1 },
  );
  assert.equal(scenario.getRoleInfo().role.items[1001].quantity, 40);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("已达到360进度，开始领取邮件附件")),
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
    4,
  );
  assert.equal(
    scenario.commands.filter(
      (item) => item.cmd === "activity_claimweekactreward",
    ).length,
    2,
  );
  assert.equal(scenario.getRoleInfo().role.items[1001].quantity, 80);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("任务完成：2/2轮")),
    true,
  );
});

test("招募周累计最多执行四轮并逐轮领取万能红", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 1440,
    activityWeek: "招募周",
    roundCount: 9,
  });

  await scenario.run();

  const claimCommands = scenario.commands.filter(
    (item) => item.cmd === "activity_claimweekactreward",
  );
  let recruitedCount = 0;
  const recruitedCountsAtClaim = [];
  scenario.commands.forEach((command) => {
    if (command.cmd === "hero_recruit") {
      recruitedCount += command.params.recruitNumber;
    }
    if (command.cmd === "activity_claimweekactreward") {
      recruitedCountsAtClaim.push(recruitedCount);
    }
  });
  assert.equal(
    getRecruitCommands(scenario.commands).reduce(
      (total, command) => total + command.params.recruitNumber,
      0,
    ),
    1600,
  );
  assert.equal(claimCommands.length, 4);
  assert.deepEqual(recruitedCountsAtClaim, [400, 800, 1200, 1600]);
  assert.equal(
    claimCommands.every(
      ({ params }) =>
        params.typ === 1 && params.selectRewardsMap?.[1] === 1,
    ),
    true,
  );
});

test("已完成三轮时最多再执行一轮", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 360,
    activityWeek: "招募周",
    roundCount: 4,
    completedRounds: 3,
  });

  await scenario.run();

  assert.equal(
    getRecruitCommands(scenario.commands).reduce(
      (total, command) => total + command.params.recruitNumber,
      0,
    ),
    400,
  );
  assert.equal(
    scenario.commands.filter(
      (item) => item.cmd === "activity_claimweekactreward",
    ).length,
    1,
  );
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("本周已完成3/4轮，本次执行1轮"),
    ),
    true,
  );
});

test("当前轮已有进度时只招募剩余数量", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 260,
    activityWeek: "招募周",
    activityProgress: 100,
  });

  await scenario.run();

  const recruitCommands = getRecruitCommands(scenario.commands);
  assert.equal(
    recruitCommands.reduce(
      (total, command) => total + command.params.recruitNumber,
      0,
    ),
    300,
  );
  const mailIndex = scenario.commands.findIndex(
    (command) => command.cmd === "mail_claimallattachment",
  );
  const recruitedBeforeMail = scenario.commands
    .slice(0, mailIndex)
    .filter((command) => command.cmd === "hero_recruit")
    .reduce((total, command) => total + command.params.recruitNumber, 0);
  assert.equal(recruitedBeforeMail, 260);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("当前轮超过360进度时领取邮件后只补到400", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 0,
    activityWeek: "招募周",
    activityProgress: 370,
  });

  await scenario.run();

  const recruitCommands = getRecruitCommands(scenario.commands);
  assert.equal(
    recruitCommands.reduce(
      (total, command) => total + command.params.recruitNumber,
      0,
    ),
    30,
  );
  assert.ok(
    scenario.commands.findIndex(
      (command) => command.cmd === "mail_claimallattachment",
    ) < scenario.commands.findIndex((command) => command.cmd === "hero_recruit"),
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("免费招募导致进度为1时，剩余招募拆成单次请求", async () => {
  const scenario = createRecruitScenario({
    recruitItemCount: 399,
    activityWeek: "招募周",
    activityProgress: 1,
  });

  await scenario.run();

  const recruitCommands = getRecruitCommands(scenario.commands);
  assert.equal(
    recruitCommands.reduce(
      (total, command) => total + command.params.recruitNumber,
      0,
    ),
    399,
  );
  assert.equal(
    recruitCommands.some((command) => command.params.recruitNumber === 9),
    false,
  );
  assert.equal(
    recruitCommands.filter((command) => command.params.recruitNumber === 1)
      .length,
    9,
  );
  assert.equal(
    scenario.commands.some(
      (command) =>
        command.cmd === "activity_claimweekactreward" &&
        command.params.typ === 1,
    ),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});
