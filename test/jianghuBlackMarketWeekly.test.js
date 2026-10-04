import assert from "node:assert/strict";
import { test } from "node:test";

import { JIANGHU_BLACK_MARKET_GOODS, DEFAULT_JIANGHU_BLACK_MARKET_PURCHASES } from "../src/utils/jianghuBlackMarketWeekly.js";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

const createScenario = ({ progress = 0, activityWeek = "黑市周", purchases, taskConfig, failIndex } = {}) => {
  const tokenId = "token-1";
  const token = { id: tokenId, name: "测试账号" };
  const commands = [];
  const logs = [];
  const tokenStatus = { value: {} };

  const tokenStore = {
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });
      if (cmd === "activity_get") {
        return {
          activity: {
            myTotalInfo: { 11: { num: progress, complete: {} } },
          },
        };
      }
      if (cmd === "activity_buystoregoods") {
        if (params.goodsIndex === failIndex) throw new Error("商品已售罄");
        return { role: { diamond: 337487, items: { 1016: { quantity: 12295 } } }, reward: [{ type: 3, itemId: 1016, value: 2000 }] };
      }
      return {};
    },
    closeWebSocketConnection() {},
  };

  const deps = {
    selectedTokens: { value: [tokenId] },
    tokens: { value: [token] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1, jianghuBlackMarketPurchases: purchases },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    helperSettings: {},
    delayConfig: { action: 0 },
    activityWeek: { value: activityWeek },
  };

  return {
    run: () => createTasksItem(deps).batchSmartBlackMarketWeekly(taskConfig),
    commands,
    logs,
    tokenStatus,
  };
};

const getPurchases = (commands) =>
  commands.filter((command) => command.cmd === "activity_buystoregoods");

test("江湖黑市默认选择显示序号0、1、2、5、6、7、8且各采购一次", async () => {
  const scenario = createScenario({ progress: 100000 });

  await scenario.run();

  const purchases = getPurchases(scenario.commands);
  assert.deepEqual(
    purchases.map((command) => command.params.goodsIndex),
    [0, 1, 2, 4, 5, 6, 7],
  );
  assert.deepEqual(
    scenario.commands.find(
      (command) => command.cmd === "activity_claimweekactreward",
    )?.params,
    { selectRewardsMap: new Map([[0, 1]]), typ: 12 },
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("金砖达标未满十万时不领取自选奖励", async () => {
  const scenario = createScenario({ progress: 99999 });

  await scenario.run();

  assert.equal(
    scenario.commands.some(
      (command) => command.cmd === "activity_claimweekactreward",
    ),
    false,
  );
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("非黑市周跳过江湖黑市任务", async () => {
  const scenario = createScenario({ activityWeek: "招募周" });

  await scenario.run();

  assert.equal(getPurchases(scenario.commands).length, 0);
  assert.equal(scenario.tokenStatus.value["token-1"], "skipped");
});


test("自定义采购包含原先跳过的商品，沿用采集请求参数", async () => {
  const scenario = createScenario({ purchases: { 3: 1, 4: 1, 6: 1, 8: 2, 9: 0 } });
  await scenario.run();
  assert.deepEqual(getPurchases(scenario.commands).map(({ params }) => params),
    [3, 4, 6, 8, 8].map(goodsIndex => ({ activityId: 9, goodsIndex, buyNum: 1 })));
});

test("定时任务独立清单覆盖全局清单", async () => {
  const scenario = createScenario({ purchases: { 4: 1 }, taskConfig: { purchases: { 6: 2 } } });
  await scenario.run();
  assert.deepEqual(getPurchases(scenario.commands).map(({ params }) => params.goodsIndex), [6, 6]);
});

test("空清单不采购，但仍检查达标奖励", async () => {
  const scenario = createScenario({ purchases: {}, progress: 100000 });
  await scenario.run();
  assert.equal(getPurchases(scenario.commands).length, 0);
  assert.ok(scenario.commands.some(({ cmd }) => cmd === "activity_claimweekactreward"));
});

test("采购失败继续后续商品", async () => {
  const scenario = createScenario({ purchases: { 4: 1, 6: 1 }, failIndex: 4 });
  await scenario.run();
  assert.deepEqual(getPurchases(scenario.commands).map(({ params }) => params.goodsIndex), [4, 6]);
  assert.equal(scenario.tokenStatus.value["token-1"], "completed");
});

test("忽略非法商品序号，次数归一化且限制最多四次", async () => {
  const scenario = createScenario({ purchases: { 0: -1, 1: "2", 2: "bad", 3: 1.9, 8: 99, 10: 1 } });
  await scenario.run();
  assert.deepEqual(getPurchases(scenario.commands).map(({ params }) => params.goodsIndex), [1, 1, 3, 8, 8, 8, 8]);
});


test("黑市周按独立大奖配置领取", async () => {
  const scenario = createScenario({ progress: 100000, taskConfig: { purchases: {}, rewardChoice: 2 } });
  await scenario.run();
  assert.deepEqual(scenario.commands.find(({ cmd }) => cmd === "activity_claimweekactreward").params, { typ: 12, selectRewardsMap: new Map([[0, 2]]) });
});


test("显示序号与API商品索引分别维护，默认清单对应用户指定序号", () => {
  assert.deepEqual(JIANGHU_BLACK_MARKET_GOODS.map(({ displayIndex }) => displayIndex), [0, 1, 2, 3, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(JIANGHU_BLACK_MARKET_GOODS.filter(({ goodsIndex }) => DEFAULT_JIANGHU_BLACK_MARKET_PURCHASES[goodsIndex] > 0).map(({ displayIndex }) => displayIndex), [0, 1, 2, 5, 6, 7, 8]);
  assert.equal(JIANGHU_BLACK_MARKET_GOODS.find(({ displayIndex }) => displayIndex === 5).goodsIndex, 4);
  assert.equal(JIANGHU_BLACK_MARKET_GOODS.find(({ displayIndex }) => displayIndex === 9).goodsIndex, 8);
});
