import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const defines = await fs.readFile(new URL("../public/game/game-defines.a175e.js", import.meta.url), "utf8");
const source = (await fs.readFile(new URL("../public/game/main.2a00e.js", import.meta.url), "utf8")).split("window.installRemoteAssetLoader =")[0];
function loader(fetch) {
  const window = { _CCSettings: { bundleVers: { internal: "local-internal" } } };
  const context = vm.createContext({ window, globalThis: window, TextDecoder, TextEncoder, fetch, console: { log() {}, error() {} } });
  vm.runInContext(defines, context);
  vm.runInContext(source, context);
  return window;
}
const versions = { launcher: "new-launcher", game: "new-game", TEST_REMOTE_MODULE: "new-protocol", codeVersion: "new-code", COMMIT_ID: "new-commit" };
test("uses APK manifest version and fresh server bundle list while preserving browser platform", async () => {
  let request;
  const window = loader(async (url, options) => {
    request = { url, options };
    return { ok: true, text: async () => JSON.stringify({ body: { bundleVers: JSON.stringify(versions) } }) };
  });
  await window.loadRemoteBundleVers();
  assert.equal(window.PLATFORM, "h5web");
  assert.match(request.url, /version=0\.36\.0-android$/);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.body, "");
  assert.equal(window._CCSettings.bundleVers.game, "new-game");
  assert.equal(window._CCSettings.bundleVers.internal, "local-internal");
  assert.equal(window.remoteGameResourceInfo.codeVersion, "new-code");
});
test("accepts string or object manifest envelopes and rejects incomplete resources", () => {
  const window = loader();
  assert.equal(window.parseRemoteBundleVers({ body: JSON.stringify({ bundleVers: versions }) }).game, "new-game");
  for (const missing of ["launcher", "game", "TEST_REMOTE_MODULE"]) {
    const incomplete = { ...versions }; delete incomplete[missing];
    assert.throws(() => window.parseRemoteBundleVers({ body: { bundleVers: incomplete } }), /missing or invalid/);
  }
});
test("converts encrypted scripts once and preserves ordinary scripts and local engine assets", () => {
  const window = loader();
  assert.equal(window.convertAssets("assets/game/index.abc.js"), "https://xxz-xyzw-res.hortorgames.com/remote/game/index.abc.jsc");
  assert.equal(window.convertAssets("assets/game/index.abc.jsc"), "https://xxz-xyzw-res.hortorgames.com/remote/game/index.abc.jsc");
  assert.equal(window.convertAssets("assets/miniGameScripts/index.abc.js"), "https://xxz-xyzw-res.hortorgames.com/remote/miniGameScripts/index.abc.js");
  assert.equal(window.convertAssets("assets/internal/index.js"), "assets/internal/index.js");
});
test("failed manifest fetch stops before overwriting current bundle versions", async () => {
  const window = loader(async () => ({ ok: false, status: 503 }));
  await assert.rejects(window.loadRemoteBundleVers(), /manifest failed: 503/);
  assert.equal(window._CCSettings.bundleVers.game, undefined);
});
