import assert from "node:assert/strict";
import { test } from "node:test";

import { createTasksItem } from "../src/utils/batch/tasksItem.js";

test("战士科技使用角色背包中的军团币并发送升级指令", async () => {
  const commands = [];
  const logs = [];
  const tokenId = "token-1";
  const tokenStatus = { value: {} };

  const tokenStore = {
    async sendGetRoleInfo() {
      return {
        role: {
          roleId: 1,
          legionId: 2,
          gold: 5000,
          legionResearch: {},
          items: { 1014: { quantity: 12 } },
        },
      };
    },
    async sendMessageWithPromise(_tokenId, cmd, params) {
      commands.push({ cmd, params });
      return {};
    },
    closeWebSocketConnection() {},
  };

  const tasks = createTasksItem({
    selectedTokens: { value: [tokenId] },
    tokens: { value: [{ id: tokenId, name: "科技测试账号" }] },
    tokenStatus,
    isRunning: { value: false },
    shouldStop: { value: false },
    ensureConnection: async () => {},
    releaseConnectionSlot: () => {},
    connectionQueue: { active: 0 },
    batchSettings: {},
    tokenStore,
    addLog: (entry) => logs.push(entry),
    message: { success: () => {} },
    currentRunningTokenId: { value: null },
    helperSettings: {},
    delayConfig: { command: 0 },
    activityWeek: { value: null },
  });

  await tasks.batchMaxWarriorLegionTech();

  assert.deepEqual(commands[0], {
    cmd: "legion_research",
    params: { researchId: 101, isMax: true },
  });
  assert.equal(
    commands.some((command) => command.cmd === "legion_getinfo"),
    false,
  );
  assert.equal(
    logs.some((entry) => entry.message.includes("战士生命（101）已从0级升级至1级")),
    true,
  );
  assert.equal(tokenStatus.value[tokenId], "completed");
});
