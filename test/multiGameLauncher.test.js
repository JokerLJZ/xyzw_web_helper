import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMultiGameFrameSrc,
  clearMultiGameLaunch,
  prepareMultiGameLaunch,
  readActiveMultiGameLaunch,
} from "@/utils/gameLauncher";

class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.#values.has(String(key)) ? this.#values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
  }

  removeItem(key) {
    this.#values.delete(String(key));
  }
}

test("frame URL contains only account id and isolated scope", () => {
  const src = buildMultiGameFrameSrc("/helper", {
    scopeId: "mg-0123456789abcdef0123456789abcdef",
    tokenId: "account / 一号",
  });
  assert.equal(
    src,
    "/helper/game/multi-game.html?scope=mg-0123456789abcdef0123456789abcdef&bin_id=account%20%2F%20%E4%B8%80%E5%8F%B7",
  );
  assert.equal(src.includes("token"), false);
});

test("launch preparation isolates valid BINs and records missing BINs", async () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const uuids = [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "11111111-1111-1111-1111-111111111111",
  ];
  const result = await prepareMultiGameLaunch({
    tokens: [
      { id: "a", name: "账号 A" },
      { id: "missing", name: "缺失账号" },
    ],
    getArrayBuffer: async (id) =>
      id === "a" ? Uint8Array.from([112, 108, 1, 2, 3]).buffer : null,
    localStorage,
    sessionStorage,
    randomUUID: () => uuids.shift(),
    now: () => 123,
  });

  assert.equal(result.launch.sessions.length, 1);
  assert.equal(result.launch.sessions[0].scopeId, "mg-11111111111111111111111111111111");
  assert.deepEqual(result.failures, [
    { tokenId: "missing", name: "缺失账号", reason: "missing-bin" },
  ]);
  assert.equal(
    localStorage.getItem(
      "multi-game:mg-11111111111111111111111111111111:current_bin_id",
    ),
    "a",
  );
  assert.deepEqual(
    readActiveMultiGameLaunch(sessionStorage),
    result.launch,
  );
});

test("clearing a launch removes only its isolated storage", () => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  localStorage.setItem(
    "multi-game:mg-22222222222222222222222222222222:current_bin_id",
    "a",
  );
  localStorage.setItem("bin_data_single-game", "keep");
  sessionStorage.setItem(
    "multi-game_active_launch_v1",
    JSON.stringify({
      version: 1,
      id: "launch-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      createdAt: 123,
      sessions: [{
        tokenId: "a",
        name: "A",
        scopeId: "mg-22222222222222222222222222222222",
        order: 0,
      }],
      failures: [],
    }),
  );

  clearMultiGameLaunch({ localStorage, sessionStorage });

  assert.equal(
    localStorage.getItem(
      "multi-game:mg-22222222222222222222222222222222:current_bin_id",
    ),
    null,
  );
  assert.equal(localStorage.getItem("bin_data_single-game"), "keep");
  assert.equal(sessionStorage.getItem("multi-game_active_launch_v1"), null);
});
