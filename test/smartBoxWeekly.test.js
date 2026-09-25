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
  currentRound = completedRounds + 1,
  finalRewardClaimCount = completedRounds,
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
  let boxWeekCompletedRounds = completedRounds;
  let boxWeekCurrentRound = currentRound;
  let boxWeekFinalRewardClaimCount = finalRewardClaimCount;

  const getRoleInfo = () => ({
    role: {
      items: Object.fromEntries(
        Array.from(items, ([itemId, quantity]) => [itemId, { quantity }]),
      ),
    },
  });

  const tokenStore = {
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });

      if (cmd === "role_getroleinfo") {
        return getRoleInfo();
      }

      if (cmd === "activity_get") {
        return {
          activity: {
            myTotalInfo: {
              2: {
                num: boxWeekProgress,
                rounds: boxWeekCurrentRound,
                complete: { 4: boxWeekFinalRewardClaimCount },
              },
            },
            activity: [{ id: 2, data: { rewards: Array(5).fill({}) } }],
          },
        };
      }

      if (cmd === "item_openbox") {
        const currentQuantity = items.get(params.itemId) || 0;
        assert.ok(
          currentQuantity >= params.number,
          `开箱库存不足：${params.itemId} 当前${currentQuantity}，需要${params.number}`,
        );
        items.set(params.itemId, currentQuantity - params.number);
        const points = { 2001: 1, 2002: 10, 2003: 20, 2004: 50 }[
          params.itemId
        ];
        boxWeekProgress = Math.min(
          8000,
          boxWeekProgress + params.number * points,
        );
      }

      if (cmd === "item_batchclaimboxpointreward") {
        const reward = claimRewards[rewardIndex++] || 0;
        items.set(2003, (items.get(2003) || 0) + reward);
      }

      if (cmd === "activity_claimweekactreward") {
        const hasPreviousUnclaimedReward =
          boxWeekFinalRewardClaimCount < boxWeekCurrentRound - 1;
        if (!hasPreviousUnclaimedReward) {
          assert.equal(boxWeekProgress, 8000);
          boxWeekProgress = 0;
        }
        boxWeekCompletedRounds += 1;
        boxWeekFinalRewardClaimCount += 1;
        boxWeekCurrentRound = Math.max(
          boxWeekCurrentRound,
          boxWeekFinalRewardClaimCount + 1,
        );
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
      }),
    commands,
    logs,
    getRoleInfo,
    tokenStatus: deps.tokenStatus,
  };
};

const countCommands = (commands, command) =>
  commands.filter((item) => item.cmd === command).length;

test("起始达到4000分后，按累计开箱分数完成8000分", async () => {
  const scenario = createSmartBoxScenario({ inventory: { 2004: 160 } });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 2);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("服务器进度7500/8000")),
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

test("领取奖励后积分低于4000时，继续补开直到凑够8000分", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 225 },
    // 每轮领取后分别得到144、255、396个黄金宝箱：
    // 4500 -> 2980 -> 5280 -> 8000。
    claimRewards: [144, 255, 396],
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 3);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("选中宝箱积分2980")),
    true,
  );
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("选中宝箱积分不超过4000")),
    false,
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
    claimRewards: [220],
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 1);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("库存没有增加")),
    true,
  );
  assert.equal(scenario.logs.some((entry) => entry.message.includes("完成0/1组")), true);
});

test("起始积分不足4000分时，不开始开箱和领取奖励", async () => {
  const scenario = createSmartBoxScenario({
    inventory: { 2003: 199 },
  });

  await scenario.run();

  assert.equal(countCommands(scenario.commands, "item_openbox"), 0);
  assert.equal(countCommands(scenario.commands, "item_batchclaimboxpointreward"), 0);
  assert.equal(
    scenario.logs.some((entry) => entry.message.includes("需要4000分，当前选中宝箱仅3980分")),
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

test("当前进度8000时不再开箱并直接领取本轮万能红", async () => {
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
    selectRewardsMap: { 0: 1 },
    typ: 2,
  });
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
