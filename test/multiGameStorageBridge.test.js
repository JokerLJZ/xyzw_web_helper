import assert from "node:assert/strict";
import test from "node:test";

await import("../public/game/multi-game-storage-bridge.js");
const bridge = globalThis.MultiGameStorageBridge;

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

test("scoped adapter keeps accounts and ordinary storage keys separate", () => {
  const backing = new MemoryStorage([["outside", "keep"]]);
  const a = bridge.createScopedStorageAdapter(
    backing,
    "mg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const b = bridge.createScopedStorageAdapter(
    backing,
    "mg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );

  a.setItem("current_bin_id", "account-a");
  b.setItem("current_bin_id", "account-b");
  assert.equal(a.getItem("current_bin_id"), "account-a");
  assert.equal(b.getItem("current_bin_id"), "account-b");
  assert.equal(backing.getItem("outside"), "keep");
  a.clear();
  assert.equal(a.length, 0);
  assert.equal(b.length, 1);
  assert.throws(() => a.setItem("multi-game:other:key", "bad"), /Nested/);
});

test("install virtualizes localStorage while leaving sessionStorage shared", () => {
  const localStorage = new MemoryStorage([
    ["multi-game:mg-cccccccccccccccccccccccccccccccc:current_bin_id", "c"],
  ]);
  const sessionStorage = new MemoryStorage([["shared", "yes"]]);
  const win = { Storage: MemoryStorage, localStorage, sessionStorage };
  const rawGetItem = MemoryStorage.prototype.getItem;

  bridge.install(win, "mg-cccccccccccccccccccccccccccccccc");
  win.localStorage.setItem("setting", "isolated");

  assert.equal(win.localStorage.getItem("current_bin_id"), "c");
  assert.equal(win.localStorage.getItem("setting"), "isolated");
  assert.equal(
    rawGetItem.call(
      localStorage,
      "multi-game:mg-cccccccccccccccccccccccccccccccc:setting",
    ),
    "isolated",
  );
  assert.equal(win.sessionStorage.getItem("shared"), "yes");
  assert.equal(win.sessionStorage.length, 1);
});
