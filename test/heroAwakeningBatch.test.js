import test from "node:test";
import assert from "node:assert/strict";
import { createTasksItem } from "../src/utils/batch/tasksItem.js";

function fixture(fail = false) {
  const hero = { heroId: 107, star: 22, awakeSkill: null };
  const calls = [], logs = [];
  let queries = 0;
  const deps = {
    selectedTokens: { value: ["t"] }, tokens: { value: [{ id: "t", name: "测试" }] },
    tokenStatus: { value: {} }, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null }, batchSettings: { awakeningHeroIds: [107] },
    helperSettings: {}, delayConfig: {}, connectionQueue: {},
    ensureConnection: async () => {}, releaseConnectionSlot() {},
    addLog: x => logs.push(x), message: { success() {}, warning() {} },
    tokenStore: {
      closeWebSocketConnection() {},
      async sendGetRoleInfo() { queries++; return { role: { heroes: { 107: structuredClone(hero) } } }; },
      async sendMessageWithPromise(id, cmd, params) {
        calls.push({ cmd, params });
        if (fail) throw new Error("服务器错误: 400210 - 未知错误");
        hero.awakeSkill = { "-1": true };
        return { _raw: { cmd: "syncresp", body: { role: { heroes: { 107: { awakeSkill: hero.awakeSkill } } } } } };
      },
    },
  };
  return { deps, calls, logs, queries: () => queries, tasks: createTasksItem(deps) };
}

test("批量吕布第一技能发送-1，复查确认后才完成", async () => {
  const f = fixture();
  await f.tasks.batchAwakenHeroSkills();
  assert.deepEqual(f.calls, [{ cmd: "hero_skillawake", params: { heroId: 107, index: -1 } }]);
  assert.equal(f.queries(), 2);
  assert.equal(f.deps.tokenStatus.value.t, "completed");
  assert.ok(f.logs.some(x => x.message.includes("吕布第1技能")));
  assert.ok(f.logs.some(x => x.message.includes("复查确认1个") && x.type === "success"));
});

test("觉醒全部失败时标记失败，零成功不会显示成功完成", async () => {
  const f = fixture(true);
  await f.tasks.batchAwakenHeroSkills();
  assert.equal(f.calls.length, 1);
  assert.equal(f.queries(), 1);
  assert.equal(f.deps.tokenStatus.value.t, "failed");
  assert.equal(f.logs.at(-1).type, "warning");
  assert.ok(f.logs.at(-1).message.includes("指令成功0个"));
});
