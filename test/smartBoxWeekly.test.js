import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

const createSmartBoxScenario = ({
  inventory,
  claimRewards = [],
  groupCount = 1,
  selectedTypes = [2002, 2003, 2004],
  currentProgress = 0,
  completedRounds = 0,
  earnedRounds = completedRounds,
  currentRound = completedRounds + 1,
  finalRewardClaimCount = completedRounds,
  claimStatisticsTime = Math.floor(Date.now() / 1000),
  claimAdvancesRound = true,
  autoAdvanceRoundAt8000 = false,
  rejectSmallOpenWhenStockAtLeast10 = false,
  claimStateDelayQueries = 0,
}) => {
  const tokenId = "token-1";
  const token = { id: tokenId, name: "测试账号" };
  const items = new Map(
    Object.entries(inventory).map(([itemId, quantity]) => [
      Number(itemId),
      quantity,
    ]),
  );
  const commands = [];
  const logs = [];
  let rewardIndex = 0;
  let boxWeekProgress = currentProgress;
  let boxWeekCurrentRound = currentRound;
  let boxWeekEarnedRoundCount = Math.max(
    earnedRounds,
    currentRound - 1,
    currentProgress >= 8000 ? currentRound : 0,
  );
  let boxWeekFinalRewardClaimCount = finalRewardClaimCount;
  let boxWeekClaimStatisticsTime = claimStatisticsTime;
  let pendingClaimQueries = 0;
  let pendingClaimResetsProgress = false;
  const getCurrentCycleClaimCount = () =>
    boxWeekClaimStatisticsTime < Math.floor(Date.now() / 1000) - 7 * 86400
      ? 0
      : boxWeekFinalRewardClaimCount;

  const applyClaimAdvance = () => {
    if (pendingClaimResetsProgress) boxWeekProgress = 0;
    const currentCycleClaimCount = getCurrentCycleClaimCount();
    boxWeekFinalRewardClaimCount = currentCycleClaimCount + 1;
    boxWeekClaimStatisticsTime = Math.floor(Date.now() / 1000);
    boxWeekCurrentRound = Math.max(
      boxWeekCurrentRound,
      boxWeekFinalRewardClaimCount + 1,
    );
    pendingClaimQueries = 0;
    pendingClaimResetsProgress = false;
  };

  const getRoleInfo = () => ({
    role: {
      items: Object.fromEntries(
        Array.from(items, ([itemId, quantity]) => [itemId, { quantity }]),
      ),
      statistics: {
        "week:act:cr:cnt:2": boxWeekFinalRewardClaimCount,
      },
      statisticsTime: {
        "week:act:cr:cnt:2": boxWeekClaimStatisticsTime,
      },
    },
  });

  const tokenStore = {
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });

      if (cmd === "role_getroleinfo") {
        return getRoleInfo();
      }

      if (cmd === "activity_get") {
        if (pendingClaimQueries > 0) {
          pendingClaimQueries -= 1;
          if (pendingClaimQueries === 0) applyClaimAdvance();
        }
        return {
          activity: {
            myTotalInfo: {
              2: {
                num: boxWeekProgress,
                rounds: boxWeekCurrentRound,
                complete: { 4: boxWeekEarnedRoundCount },
              },
            },
            activity: [{ id: 2, data: { rewards: Array(5).fill({}) } }],
          },
        };
      }

      if (cmd === "item_openbox") {
        const currentQuantity = items.get(params.itemId) || 0;
        if (
          rejectSmallOpenWhenStockAtLeast10 &&
          currentQuantity >= 10 &&
          params.number < 10
        ) {
          throw new Error("服务器错误: 400122 - 未知错误");
        }
        assert.ok(
          currentQuantity >= params.number,
          `开箱库存不足：${params.itemId} 当前${currentQuantity}，需要${params.number}`,
        );
        items.set(params.itemId, currentQuantity - params.number);
        const points = { 2001: 1, 2002: 10, 2003: 20, 2004: 50 }[
          params.itemId
        ];
        const nextProgress = Math.min(
          8000,
          boxWeekProgress + params.number * points,
        );
        if (nextProgress >= 8000) {
          boxWeekEarnedRoundCount = Math.max(
            boxWeekEarnedRoundCount,
            boxWeekCurrentRound,
          );
        }
        if (autoAdvanceRoundAt8000 && nextProgress >= 8000) {
          boxWeekProgress = 0;
          boxWeekCurrentRound += 1;
        } else {
          boxWeekProgress = nextProgress;
        }
      }

      if (cmd === "item_batchclaimboxpointreward") {
        const reward = claimRewards[rewardIndex++] || 0;
        items.set(2003, (items.get(2003) || 0) + reward);
      }

      if (cmd === "activity_claimweekactreward") {
        const hasUnclaimedReward =
          getCurrentCycleClaimCount() < boxWeekEarnedRoundCount;
        assert.equal(hasUnclaimedReward, true);
        if (claimAdvancesRound) {
          pendingClaimResetsProgress = boxWeekProgress >= 8000;
          if (claimStateDelayQueries > 0) {
            pendingClaimQueries = claimStateDelayQueries;
          } else {
            applyClaimAdvance();
          }
        }
        return getRoleInfo();
      }

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
    batchSettings: {
      smartBoxTypes: selectedTypes,
      smartBoxGroupCount: groupCount,
      maxActive: 1,
    },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    helperSettings: {},
    delayConfig: { action: 0 },
    activityWeek: { value: "宝箱周" },
  };

  return {
    run: () =>
      createTasksItem(deps).batchSmartBoxWeekly({
        smartBoxTypes: selectedTypes,
        smartBoxGroupCount: groupCount,
        smartBoxActionDelayMs: 0,
      }),
    commands,
    logs,
    getRoleInfo,
    tokenStatus: deps.tokenStatus,
  };
};

const countCommands = (commands, command) =>
  commands.filter((item) => item.cmd === command).length;

test("起始达到剩余分数一半的门槛后，直接开到8000分", async () => {
  const scenario = createSmartBoxScenario({ inventory: { 2004: 160 } });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 0);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("服务器进度8000/8000")),
    true,
  );
  assert.equal(countCommands(scenario.commands, "activity_get"), 3);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("完成1/1组")),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
  assert.equal(scenario.getRoleInfo().role.items[2004].quantity, 0);
});

test("库存不足时先开完，再领取积分和邮件继续开到8000分", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 225 },
    claimRewards: [144, 255],
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 2);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("选中宝箱积分2880")),
    true,
  );
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("完成1/1组")),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("领取后库存没有增加时，停止任务避免重复领取", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 225 },
    claimRewards: [],
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 1);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("库存及活动进度均未增加")),
    true,
  );
  assert.equal(scenario.logs.some((entry) => entry.message.includes("完成0/1组")), true);
});

test("大奖接口返回但轮次未更新时判定失败", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2004: 160 },
    claimAdvancesRound: false,
  });

  await scenario.run();

  assert.equal(scenario.tokenStatus.value["token-1"], "failed");
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("轮次状态持续未更新")),
    true,
  );
});

test("起始积分不足剩余分数一半时，不开始开箱和领取奖励", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 199 },
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 0);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("启动门槛为4000分，当前可用宝箱积分仅3980分")),
    true,
  );
  assert.equal(scenario.logs.some((entry) => entry.message.includes("完成0/1组")), true);
});

test("木质宝箱按每批10个开箱", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2001: 8200 },
    selectedTypes: [2001],
  });

  await scenario.run();

  const openingCommands = scenario.commands.filter(
    (item) => item.cmd === "item_openbox",
  );
  assert.equal(openingCommands.length, 800);
  assert.equal(openingCommands.every((item) => item.params.number === 10), true);
  assert.equal(scenario.logs.some((entry) => entry.message.includes("完成1/1组")), true);
  assert.equal(scenario.getRoleInfo().role.items[2001].quantity, 200);
});

test("配置两组时，完成两组8000分开箱", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 800 },
    groupCount: 2,
  });

  await scenario.run();

  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("完成2/2组")),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 2);
});

test("根据服务器当前进度只开启补足8000分所需的宝箱", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 250 },
    currentProgress: 3000,
  });

  await scenario.run();

  const openedCount = scenario.commands
    .filter((item) => item.cmd === "item_openbox")
    .reduce((total, item) => total + item.params.number, 0);
  assert.equal(openedCount, 250);
  assert.equal(scenario.getRoleInfo().role.items[2003].quantity, 0);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
});

test("当前进度7500时只补开500分", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2004: 10 },
    currentProgress: 7500,
  });

  await scenario.run();

  const openedCount = scenario.commands
    .filter((item) => item.cmd === "item_openbox")
    .reduce((total, item) => total + item.params.number, 0);
  assert.equal(openedCount, 10);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("补足8000后服务端自动进入下一轮时立即领奖且不继续开箱", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2004: 610 },
    currentProgress: 5000,
    completedRounds: 2,
    currentRound: 3,
    finalRewardClaimCount: 2,
    autoAdvanceRoundAt8000: true,
  });

  await scenario.run();

  const openedCount = scenario.commands
    .filter((item) => item.cmd === "item_openbox")
    .reduce((total, item) => total + item.params.number, 0);
  assert.equal(openedCount, 60);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 0);
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("立即领取并结束本轮"),
    ),
    true,
  );
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("完成1/1组")),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
  assert.equal(scenario.getRoleInfo().role.items[2004].quantity, 550);
});

test("大奖已领取但服务器轮次延迟更新时只重查状态不重复领奖", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2002: 10 },
    currentProgress: 7900,
    completedRounds: 3,
    currentRound: 4,
    finalRewardClaimCount: 3,
    claimStateDelayQueries: 2,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("服务器轮次状态尚未同步"),
    ),
    true,
  );
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("完成1/1组")),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("当前进度8000时不再开箱并领取当前轮奖励", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 0 },
    currentProgress: 8000,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 1);
  const rewardCommand = scenario.commands.find(
    (item) => item.cmd === "activity_claimweekactreward",
  );
  assert.deepEqual(rewardCommand.params, {
    selectRewardsMap: new Map([[0, 1]]),
    typ: 2,
  });
});

test("不足10个宝箱时按现存数量开启", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2002: 7 },
    currentProgress: 7930,
  });

  await scenario.run();

  const openingCommands = scenario.commands.filter(
    (item) => item.cmd === "item_openbox",
  );
  assert.deepEqual(openingCommands.map((item) => item.params.number), [7]);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
});

test("库存大于10个时按10个整批开箱并允许超出目标300分以内", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 35 },
    currentProgress: 7500,
    rejectSmallOpenWhenStockAtLeast10: true,
  });

  await scenario.run();

  const openingCommands = scenario.commands.filter(
    (item) => item.cmd === "item_openbox",
  );
  assert.deepEqual(openingCommands.map((item) => item.params.number), [10, 10, 10]);
  assert.equal(scenario.getRoleInfo().role.items[2003].quantity, 5);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("开完整批后库存不足10个时再按剩余数量开箱", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 25 },
    currentProgress: 7500,
    rejectSmallOpenWhenStockAtLeast10: true,
  });

  await scenario.run();

  const openingCommands = scenario.commands.filter(
    (item) => item.cmd === "item_openbox",
  );
  assert.deepEqual(openingCommands.map((item) => item.params.number), [10, 10, 5]);
  assert.equal(scenario.getRoleInfo().role.items[2003].quantity, 0);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("整批开箱会超过目标300分以上时不执行开箱", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2004: 20 },
    currentProgress: 7900,
    rejectSmallOpenWhenStockAtLeast10: true,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 0);
  assert.equal(scenario.tokenStatus.value["token-1"], "skipped");
});

test("当前进度3000时启动门槛为2500分", async () => {
  const belowThreshold = createSmartBoxScenario({
    inventory: { 2003: 124 },
    currentProgress: 3000,
  });
  await belowThreshold.run();
  assert.equal(countCommands(belowThreshold.commands, "item_openbox"), 0);

  const reachesThreshold = createSmartBoxScenario({
    inventory: { 2003: 125 },
    currentProgress: 3000,
    claimRewards: [250],
  });
  await reachesThreshold.run();
  assert.equal(countCommands(reachesThreshold.commands, "item_openbox") > 0, true);
});

test("本周已完成三轮时即使配置四轮也只执行最后一轮", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 400 },
    groupCount: 4,
    completedRounds: 3,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("本周已领取3/4轮大奖，本次继续执行1轮"),
    ),
    true,
  );
});

test("本周已完成四轮时不再开箱", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 400 },
    groupCount: 4,
    completedRounds: 4,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 0);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("上期四轮领奖统计不会让本期误判为已完成四轮", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2004: 160 },
    groupCount: 1,
    completedRounds: 0,
    earnedRounds: 0,
    currentRound: 1,
    finalRewardClaimCount: 4,
    claimStatisticsTime: Math.floor(Date.now() / 1000) - 8 * 86400,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_openbox") > 0, true);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("检测到上期宝箱周领奖统计4轮，本期按0轮重新计算"),
    ),
    true,
  );
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("本周已领取0/4轮大奖，本次继续执行1轮"),
    ),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("服务器显示四轮完成但仍有8000进度时直接领取待领自选大奖", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 0 },
    currentProgress: 8000,
    completedRounds: 3,
    currentRound: 4,
    finalRewardClaimCount: 3,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("检测到1轮自选大奖尚未领取"),
    ),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("已进入第二轮但第一轮大奖漏领时先直接补领", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 400 },
    currentProgress: 1200,
    completedRounds: 0,
    currentRound: 2,
    finalRewardClaimCount: 0,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 1);
  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(
    scenario.logs.some((entry) =>
      entry.message.includes("检测到1轮自选大奖尚未领取"),
    ),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("存在多轮历史漏领时不受本次执行轮数限制并全部补领", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 400 },
    currentProgress: 500,
    groupCount: 1,
    completedRounds: 0,
    currentRound: 3,
    finalRewardClaimCount: 0,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 2);
  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("已补领2轮自选大奖")),
    true,
  );
});

test("已完成四轮但只领取一轮时补领剩余三轮大奖", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 0 },
    groupCount: 1,
    currentProgress: 0,
    completedRounds: 1,
    earnedRounds: 4,
    currentRound: 4,
    finalRewardClaimCount: 1,
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "activity_claimweekactreward"), 3);
  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("已补领3轮自选大奖")),
    true,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});
