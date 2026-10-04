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

test("空阵容2600020对账确认未消耗后仅重试一次完整阵容", async () => {
  const { challengeGroupGenie } = await import("../src/utils/genieChallengePlanner.js");
  const role = { genie: { 4: 3 } };
  const params = { battleTeam: {}, genieId: 4, lordWeaponId: 0 };
  const calls = [];
  const response = await challengeGroupGenie({
    params, previousProgress: 3, remainingBefore: 10,
    queryRole: async () => { calls.push("query"); return role; },
    send: async (p) => {
      calls.push(structuredClone(p));
      if (calls.length === 1) throw new Error("服务器错误: 2600020 - 未知错误");
      return { role: { genie: { 4: 4 } } };
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[1], "query");
  assert.deepEqual(calls[2].battleTeam, { 0: 116, 1: 107, 2: 312, 3: 210, 4: 112 });
  assert.deepEqual(params.battleTeam, calls[2].battleTeam);
  assert.equal(response.role.genie[4], 4);
});

test("2600020后次数已消耗、进度变化或状态缺失时不重试", async () => {
  const { challengeGroupGenie } = await import("../src/utils/genieChallengePlanner.js");
  for (const role of [
    { genie: { 4: 3 }, statistics: { "genie:battle": 1 }, statisticsTime: { "genie:battle": Date.now() / 1000 } },
    { genie: { 4: 4 } }, {},
  ]) {
    let sends = 0;
    await assert.rejects(challengeGroupGenie({
      params: { battleTeam: {}, genieId: 4, lordWeaponId: 0 },
      previousProgress: 3, remainingBefore: 10,
      queryRole: async () => role,
      send: async () => { sends++; throw new Error("服务器错误: 2600020 - 未知错误"); },
    }), /2600020/);
    assert.equal(sends, 1);
  }
});

test("完整阵容或其他错误不触发空阵容补救", async () => {
  const { challengeGroupGenie } = await import("../src/utils/genieChallengePlanner.js");
  for (const [battleTeam, code] of [[{ 0: 116 }, 2600020], [{}, 200400]]) {
    await assert.rejects(challengeGroupGenie({
      params: { battleTeam },
      queryRole: () => assert.fail("不应查询重试"),
      send: async () => { throw new Error(`服务器错误: ${code} - 未知错误`); },
    }), new RegExp(String(code)));
  }
});
