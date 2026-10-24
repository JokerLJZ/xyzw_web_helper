import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

async function runWeeklyBenefit(weekName, activity, claimResult = {}) {
  const tokenId = "token-1";
  const commands = [];
  const tokenStatus = { value: {} };
  const logs = [];

  const tokenStore = {
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });
      if (cmd === "activity_get") {
        return { activity };
      }
      if (claimResult instanceof Error) throw claimResult;
      return claimResult;
    },
    closeWebSocketConnection() {},
  };

  const tasks = createTasksItem({
    selectedTokens: { value: [tokenId] },
    tokens: { value: [{ id: tokenId, name: "测试账号" }] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: { maxActive: 1 },
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    helperSettings: {},
    delayConfig: { action: 0 },
    activityWeek: { value: weekName },
  });

  await tasks.batchClaimWeeklyActivityBenefit();

  return { commands, logs, status: tokenStatus.value[tokenId] };
}

test("宝箱周福利使用抓包确认的活动商店参数", async () => {
  const { commands, status } = await runWeeklyBenefit("宝箱周", {
    myTotalInfo: { 2: { num: 0, complete: {} } },
  });
  const purchase = commands.find(
    (command) => command.cmd === "activity_buystoregoods",
  );
  assert.deepEqual(purchase?.params, {
    activityId: 7,
    goodsIndex: 0,
    buyNum: 1,
  });
  assert.equal(status, "completed");
});


test("招募周限时商店领取商品0的5个招募令，活动ID为6", async () => {
  // api采集/黑市周/招募周.txt: activity_getresp 中限时商店 id=6，
  // goodsList[0] 为 price=0、limit=1、itemId=1001、value=5 的招募福利。
  const { commands, logs, status } = await runWeeklyBenefit("招募周", {
    myTotalInfo: { 1: { num: 20, rounds: 1, complete: {}, openTime: 0 } },
    myStoreInfo: { 6: { complete: {} } },
    activity: [{
      id: 6, type: 4, name: "限时商店",
      data: { buyType: 1, itemId: 0, goodsList: [{
        title: "招募福利", limit: 1, price: 0,
        rewardList: [{ type: 3, itemId: 1001, value: 5, ext: 0 }],
      }] },
    }],
  }, { body: { reward: [{ type: 3, itemId: 1001, value: 5, ext: 0 }] } });
  assert.deepEqual(commands, [
    { cmd: "activity_get", params: {} },
    { cmd: "activity_buystoregoods", params: { activityId: 6, goodsIndex: 0, buyNum: 1 } },
  ]);
  assert.equal(status, "completed");
  assert.ok(logs.some((log) => log.type === "success" && log.message.includes("道具1001x5")));
});

test("招募周未开放时不发送商店领取请求", async () => {
  const { commands, status } = await runWeeklyBenefit("招募周", {
    myTotalInfo: { 2: { num: 0, complete: {} } },
  });
  assert.deepEqual(commands, [{ cmd: "activity_get", params: {} }]);
  assert.equal(status, "completed");
});


test("黑市周从开放商店领取500金砖，不依赖达标进度字段", async () => {
  const { commands, status } = await runWeeklyBenefit("黑市周", {
    myTotalInfo: {},
    activity: [{ id: 9, type: 4, name: "金砖商店", data: { goodsList: [
      { price: 0, rewardList: [{ type: 2, itemId: 2, value: 500, ext: 0 }] },
      { price: 600, rewardList: [{ type: 3, itemId: 1001, value: 5 }] },
    ] } }],
  });
  assert.deepEqual(commands[1], {
    cmd: "activity_buystoregoods", params: { activityId: 9, goodsIndex: 0, buyNum: 1 },
  });
  assert.equal(status, "completed");
});

test("黑市周没有免费商品时不购买付费商品", async () => {
  const { commands } = await runWeeklyBenefit("黑市周", {
    myTotalInfo: { 11: {} },
    activity: [{ id: 9, type: 4, name: "金砖商店", data: { goodsList: [
      { price: 600, rewardList: [{ type: 2, itemId: 2, value: 500 }] },
    ] } }],
  });
  assert.equal(commands.length, 1);
});

test("未知服务器错误标记失败，不伪装为已领取", async () => {
  const { status, logs } = await runWeeklyBenefit("黑市周", {
    myTotalInfo: { 11: {} },
  }, new Error("服务器错误: -10006 - 未知错误"));
  assert.equal(status, "failed");
  assert.ok(logs.some((entry) => entry.type === "error"));
});
