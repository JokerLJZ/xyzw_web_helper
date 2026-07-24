import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

const createSmartBoxScenario = ({
  inventory,
  claimRewards = [],
  groupCount = 1,
  selectedTypes = [2002, 2003, 2004],
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

      if (cmd === "item_openbox") {
        const currentQuantity = items.get(params.itemId) || 0;
        assert.ok(
          currentQuantity >= params.number,
          `开箱库存不足：${params.itemId} 当前${currentQuantity}，需要${params.number}`,
        );
        items.set(params.itemId, currentQuantity - params.number);
      }

      if (cmd === "item_batchclaimboxpointreward") {
        const reward = claimRewards[rewardIndex++] || 0;
        items.set(2003, (items.get(2003) || 0) + reward);
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
    run: createTasksItem(deps).batchSmartBoxWeekly,
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
    scenario.logs.some((entry) => entry.message.includes("累计7500/8000分")),
    true,
  );
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
    scenario.logs.some((entry) => entry.message.includes("起始宝箱积分3980不足4000")),
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
});
