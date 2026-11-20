import { officialConfigFetch } from "./officialConfigFixture.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getClaimablePointRewards,
  getDailyTaskStates,
  loadDailyTaskConfig,
  validateDailyTaskConfig,
} from "../src/utils/dailyTaskState.js";

function officialConfig() {
  return {
    DailyTaskConf: {
      1: { id: 1, completeCondition: 6, completeValue: 3 },
      8: { id: 8, completeCondition: 13, completeValue: 1 },
      9: { id: 9, completeCondition: 12, completeValue: 1 },
    },
    DayLimitConf: { 1: { id: 1, limit: 20 }, 2: { id: 2, limit: 40 } },
    WeekLimitConf: { 1: { id: 1, limit: 100 }, 2: { id: 2, limit: 200 } },
  };
}
function role(complete = {}) {
  return { dailyTask: { dailyTime: 1700000000, complete } };
}

test("server counters distinguish unfinished, completed-unclaimed and claimed", () => {
  const config = validateDailyTaskConfig(officialConfig());
  const states = getDailyTaskStates(role({ 6: 2, 13: 1, 12: -1 }), config);
  assert.equal(states[0].status, "pending");
  assert.equal(states[0].remaining, 1);
  assert.equal(states[1].status, "claimable");
  assert.equal(states[1].id, 8);
  assert.equal(states[2].status, "claimed");
  assert.equal(states[2].id, 9);
});

test("progress above target requires claiming, not repeating the action", () => {
  const states = getDailyTaskStates(
    role({ 6: 20 }),
    validateDailyTaskConfig(officialConfig()),
  );
  assert.equal(states[0].status, "claimable");
  assert.equal(states[0].remaining, 0);
});

test("an absent counter in a valid server map means zero; null does not", () => {
  const config = validateDailyTaskConfig(officialConfig());
  assert.equal(getDailyTaskStates(role(), config)[0].remaining, 3);
  assert.throws(
    () => getDailyTaskStates(role({ 6: null }), config),
    /进度无效/,
  );
});

test("missing or malformed server task data cannot be treated as completed", () => {
  const config = validateDailyTaskConfig(officialConfig());
  for (const input of [
    {},
    { dailyTask: {} },
    { dailyTask: { dailyTime: 1, complete: [] } },
  ]) {
    assert.throws(() => getDailyTaskStates(input, config), /列表不完整/);
  }
  for (const count of [-2, "3", 1.5])
    assert.throws(
      () => getDailyTaskStates(role({ 6: count }), config),
      /进度无效/,
    );
});

test("official targets are used instead of client hardcoded thresholds", () => {
  const raw = officialConfig();
  raw.DailyTaskConf[1].completeValue = 5;
  assert.equal(
    getDailyTaskStates(role({ 6: 3 }), validateDailyTaskConfig(raw))[0]
      .remaining,
    2,
  );
});

test("invalid or duplicate configuration stops execution", () => {
  const raw = officialConfig();
  raw.DailyTaskConf[8].completeCondition = 6;
  assert.throws(() => validateDailyTaskConfig(raw), /配置无效/);
  assert.throws(() => validateDailyTaskConfig({}), /配置无效/);
});

test("point reward selection uses server points and claimed map for daily and weekly rewards", () => {
  const config = validateDailyTaskConfig(officialConfig());
  const daily = {
    dailyPoint: 40,
    dailyReward: { 1: true },
    weekPoint: 150,
    weekReward: {},
  };
  assert.deepEqual(getClaimablePointRewards(daily, config.dailyRewards), [2]);
  assert.deepEqual(
    getClaimablePointRewards(daily, config.weeklyRewards, true),
    [1],
  );
  assert.throws(
    () => getClaimablePointRewards({ dailyPoint: 40 }, config.dailyRewards),
    /不完整/,
  );
  assert.throws(
    () =>
      getClaimablePointRewards(
        { dailyPoint: 40, dailyReward: { 1: "true" } },
        config.dailyRewards,
      ),
    /不完整/,
  );
});

test("config version is verified each run while immutable configuration requests are merged", async () => {
  let reads = 0;
  let versions = 0;
  const store = {
    async sendMessageWithPromise() {
      versions++;
      return { dataBundleVer: "test-config-merge" };
    },
  };
  const fetchConfig = async (...args) => {
    reads++;
    return officialConfigFetch("test-config-merge", officialConfig())(...args);
  };
  const [a, b] = await Promise.all([
    loadDailyTaskConfig(store, "a", fetchConfig),
    loadDailyTaskConfig(store, "b", fetchConfig),
  ]);
  assert.equal(a, b);
  assert.equal(reads, 6);
  assert.equal(versions, 2);
});

test("failed config reads can be retried and unsafe versions are rejected", async () => {
  let attempt = 0;
  const store = {
    async sendMessageWithPromise() {
      return { dataBundleVer: "test-config-retry" };
    },
  };
  const fetchConfig = async (...args) => {
    if (++attempt === 1) return { ok: false, status: 503 };
    return officialConfigFetch("test-config-retry", officialConfig())(...args);
  };
  await assert.rejects(
    loadDailyTaskConfig(store, "a", fetchConfig),
    /读取失败/,
  );
  await loadDailyTaskConfig(store, "a", fetchConfig);
  assert.equal(attempt, 7);
  await assert.rejects(
    loadDailyTaskConfig(
      {
        async sendMessageWithPromise() {
          return { dataBundleVer: "../invalid" };
        },
      },
      "a",
      fetchConfig,
    ),
    /有效/,
  );
});

test("duplicate point-reward IDs are rejected before duplicate claims can be scheduled", () => {
  for (const name of ["DayLimitConf", "WeekLimitConf"]) {
    const config = officialConfig();
    config[name][2].id = config[name][1].id;
    assert.throws(() => validateDailyTaskConfig(config), /无效/);
  }
});

test("directly loads current manifest assets and caches only validated matching versions", async () => {
  const calls = [];
  const version = "fallback-current";
  const fetchConfig = async (url) => {
    calls.push(url);
    const result = (value) => ({ ok: true, json: async () => value });
    assert.ok(!url.includes("/data/"));
    if (url.endsWith("index.html")) return { ok: true, text: async () => '<script src="game-defines.current.js"></script>' };
    if (url.endsWith(".js")) return { ok: true, text: async () => "gt.REMOTE_MANIFEST_VERSION = '0.36.0-android'" };
    if (url.includes("/manifest?")) return result({ body: { dataBundleVer: version, bundleVers: JSON.stringify({ config: "current" }) } });
    if (url.endsWith("config.current.json")) return result({
      paths: { 0: ["config", 0], 1: ["config_ap", 0] }, types: ["cc.JsonAsset"],
      uuids: ["26o/E4KtRL9qAK/uLSVEKB", "18WuPN/WlMS7LJskr2jYL0"],
      versions: { import: [0, "main", 1, "extra"] },
    });
    const name = url.includes(".main.json") ? "config" : "config_ap";
    return result([1, 0, 0, [["cc.JsonAsset"]], [], [[0, name,
      name === "config" ? { ...officialConfig(), COMMIT_ID: version } : { BossLoopConfig: { 1: { id: 1 } } }]]]);
  };
  const store = { sendMessageWithPromise: async () => ({ dataBundleVer: version }) };
  const config = await loadDailyTaskConfig(store, "a", fetchConfig);
  assert.equal(config.tasks.length, 3);
  assert.equal(config.bossLoop[1].id, 1);
  assert.ok(calls.some((url) => url.includes("26a3f138-2ad4-4bf6-a00a-fee2d2544281.main.json")));
  const count = calls.length;
  await loadDailyTaskConfig(store, "b", fetchConfig);
  assert.equal(calls.length, count);
});

for (const mismatch of ["manifest", "content", "extra", "shape"]) {
  test(`manifest loader rejects ${mismatch} mismatch before accepting configuration`, async () => {
    const { loadOfficialTaskConfig } = await import("../src/utils/officialTaskConfig.js");
    let assets = 0;
    const fetchConfig = async (url) => {
      const result = (value) => ({ ok: true, json: async () => value });
      if (url.endsWith("index.html")) return { ok: true, text: async () => '<script src="game-defines.current.js"></script>' };
      if (url.endsWith(".js")) return { ok: true, text: async () => "REMOTE_MANIFEST_VERSION='0.36.0-android'" };
      if (url.includes("/manifest?")) return result({ body: { dataBundleVer: mismatch === "manifest" ? "old" : "expected", bundleVers: { config: "current" } } });
      if (url.endsWith("config.current.json")) return result({
        paths: { 0: ["config", 0], 1: ["config_ap", 0] }, types: ["cc.JsonAsset"],
        uuids: ["26o/E4KtRL9qAK/uLSVEKB", "18WuPN/WlMS7LJskr2jYL0"], versions: { import: [0, "main", 1, "extra"] },
      });
      assets++;
      const name = assets === 1 ? "config" : "config_ap";
      return result([1, 0, 0, [[mismatch === "shape" ? "unknown" : "cc.JsonAsset"]], [], [[0, name, {
        COMMIT_ID: (mismatch === "content" && assets === 1) || (mismatch === "extra" && assets === 2) ? "old" : "expected",
      }]]]);
    };
    await assert.rejects(loadOfficialTaskConfig("expected", fetchConfig), /不一致|格式无效/);
    if (mismatch === "manifest") assert.equal(assets, 0);
  });
}

test("configuration version changes reload definitions instead of reusing previous account version", async () => {
  let version = "manifest-version-a";
  const store = { sendMessageWithPromise: async () => ({ dataBundleVer: version }) };
  let reads = 0;
  const fetchConfig = async (...args) => {
    reads++;
    const config = officialConfig();
    config.DailyTaskConf[1].completeValue = version.endsWith("a") ? 3 : 7;
    return officialConfigFetch(version, config)(...args);
  };
  assert.equal((await loadDailyTaskConfig(store, "a", fetchConfig)).tasks[0].completeValue, 3);
  version = "manifest-version-b";
  assert.equal((await loadDailyTaskConfig(store, "b", fetchConfig)).tasks[0].completeValue, 7);
  assert.equal(reads, 12);
});
