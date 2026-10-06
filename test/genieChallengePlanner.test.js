import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GROUP_GENIE_LINEUP,
  GENIE_FACTION_LINEUPS,
  buildFactionBattleTeam,
  buildGenieBattleParams,
  buildGroupGenieBattleParams,
  didGroupGenieProgress,
  getRemainingGenieChallenges,
  isSavedGroupGenieFormationMatched,
  selectHighestLevelPet,
} from "../src/utils/genieChallengePlanner.js";

test("群雄灯神使用固定五人站位、皮鞋和最高等级宠物", () => {
  const role = {
    lordWeapon: { 2: { weaponId: 2 } },
    petData: {
      pets: {
        a: { uId: "low", level: 20 },
        b: { uId: "high", level: 80 },
      },
    },
  };

  assert.deepEqual(GROUP_GENIE_LINEUP, [
    { slot: 0, heroId: 116, minLevel: 750 },
    { slot: 1, heroId: 107, minLevel: 1 },
    { slot: 2, heroId: 312, minLevel: 750 },
    { slot: 3, heroId: 210, minLevel: 250 },
    { slot: 4, heroId: 112, minLevel: 750 },
  ]);
  assert.deepEqual(selectHighestLevelPet(role), { petUId: "high", level: 80 });
  assert.deepEqual(buildGroupGenieBattleParams(role), {
    battleTeam: { 0: 116, 1: 107, 2: 312, 3: 210, 4: 112 },
    genieId: 4,
    lordWeaponId: 2,
    petUId: "high",
  });
});

test("魏蜀吴灯神使用指定五人阵容", () => {
  assert.deepEqual(GENIE_FACTION_LINEUPS, {
    1: [101, 202, 102, 113, 109],
    2: [110, 104, 118, 103, 206],
    3: [105, 106, 121, 119, 111],
  });
  assert.deepEqual(buildFactionBattleTeam(1), {
    0: 101, 1: 202, 2: 102, 3: 113, 4: 109,
  });
});

test("魏国灯神保存阵容匹配时直接复用独立阵容", () => {
  const role = {
    genieBattleTeam: { 1: { 0: 101, 1: 202, 2: 102, 3: 113, 4: 109 } },
    genieLordWeapon: { 1: 0 },
    geniePet: { 1: "" },
  };
  assert.deepEqual(
    buildGenieBattleParams(role, 1, buildFactionBattleTeam(1)),
    { battleTeam: {}, genieId: 1, lordWeaponId: 0 },
  );
});

test("群雄灯神保存阵容完全匹配时以空阵容复用", () => {
  const role = {
    lordWeapon: { 2: { weaponId: 2 } },
    petData: { pets: { a: { uId: "pet-1", level: 9 } } },
    genieBattleTeam: {
      4: { 0: 116, 1: 107, 2: 312, 3: 210, 4: 112 },
    },
    genieLordWeapon: { 4: 2 },
    geniePet: { 4: "pet-1" },
  };

  assert.equal(isSavedGroupGenieFormationMatched(role), true);
  assert.deepEqual(buildGroupGenieBattleParams(role), {
    battleTeam: {},
    genieId: 4,
    lordWeaponId: 2,
    petUId: "pet-1",
  });
});

test("没有皮鞋和宠物时以空配置挑战", () => {
  const params = buildGroupGenieBattleParams({ lordWeapon: {} });
  assert.equal(params.lordWeaponId, 0);
  assert.equal("petUId" in params, false);
});

test("灯神按今日已挑战次数补差，并仅以群雄进度增长判胜", () => {
  const current = new Date(2026, 8, 24, 12, 0, 0);
  const timestamp = Math.floor(current.getTime() / 1000);
  const role = {
    statistics: { "genie:battle": 7 },
    statisticsTime: { "genie:battle": timestamp },
  };
  assert.equal(getRemainingGenieChallenges(role, current), 3);
  assert.equal(didGroupGenieProgress({ role: { genie: { 4: 6 } } }, 5), true);
  assert.equal(didGroupGenieProgress({ role: { genie: { 4: 5 } } }, 5), false);
  assert.equal(didGroupGenieProgress({ role: {} }, 5), false);
});


test("群雄灯神已保存阵容且已通关第一层时仍可明确发送完整阵容", () => {
  const role = {
    genie: { 4: 1 },
    genieBattleTeam: { 4: { 0: 116, 1: 107, 2: 312, 3: 210, 4: 112 } },
    genieLordWeapon: { 4: 0 },
    geniePet: { 4: "" },
  };
  assert.equal(isSavedGroupGenieFormationMatched(role), true);
  assert.deepEqual(buildGroupGenieBattleParams(role, false), {
    battleTeam: { 0: 116, 1: 107, 2: 312, 3: 210, 4: 112 },
    genieId: 4,
    lordWeaponId: 0,
  });
});

test("已通关第一层后的连续挑战每次先计算战力再发送完整阵容", async () => {
  const { createTasksItem } = await import("../src/utils/batch/tasksItem.js");
  const role = {
    levelId: 8000,
    heroes: Object.fromEntries(GROUP_GENIE_LINEUP.map(({ heroId, minLevel }) => [heroId, { heroId, level: minLevel }])),
    genie: { 4: 1 },
    genieBattleTeam: { 4: { 0: 116, 1: 107, 2: 312, 3: 210, 4: 112 } },
    statistics: { "genie:battle": 8 },
    statisticsTime: { "genie:battle": Math.floor(Date.now() / 1000) },
  };
  const calls = [];
  const status = { value: {} };
  await createTasksItem({
    selectedTokens: { value: ["t"] }, tokens: { value: [{ id: "t", name: "test" }] },
    tokenStatus: status, isRunning: { value: false }, shouldStop: { value: false },
    currentRunningTokenId: { value: null },
    ensureConnection: async () => {}, releaseConnectionSlot: () => {},
    connectionQueue: { active: 1 }, batchSettings: { maxActive: 1 },
    delayConfig: { action: 0 }, addLog: () => {}, message: { success: () => {} },
    tokenStore: {
      sendGetRoleInfo: async () => ({ role: structuredClone(role) }),
      closeWebSocketConnection: () => {},
      sendMessageWithPromise: async (_id, cmd, params) => {
        calls.push({ cmd, params: structuredClone(params) });
        if (cmd === "hero_calcpowerbyteam") return { power: 100 };
        assert.equal(cmd, "fight_startgenie");
        role.genie[4]++;
        return { role: { genie: { 4: role.genie[4] } } };
      },
    },
  }).batchChallengeGroupGenie();
  assert.equal(status.value.t, "completed");
  assert.deepEqual(calls.map(({ cmd }) => cmd), [
    "hero_calcpowerbyteam", "fight_startgenie", "hero_calcpowerbyteam", "fight_startgenie",
  ]);
  for (const { cmd, params } of calls) {
    assert.deepEqual(params.battleTeam, { 0: 116, 1: 107, 2: 312, 3: 210, 4: 112 });
    assert.equal(params.lordWeaponId, 0);
    assert.equal(params.genieId, cmd === "fight_startgenie" ? 4 : undefined);
  }
});
