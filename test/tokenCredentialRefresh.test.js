import test from "node:test";
import assert from "node:assert/strict";
import { createTokenCredentialRefresher } from "../src/utils/tokenCredentialRefresh.js";
function fixture(overrides = {}) {
  const tokens = [{ id: "a", name: "A", token: "old", importMethod: "bin", remark: "备注" }, { id: "b", name: "B", token: "other", importMethod: "bin" }];
  const calls = [], buffer = new ArrayBuffer(4);
  const deps = {
    getToken: id => tokens.find(row => row.id === id),
    updateToken: (id, patch) => { const row = tokens.find(row => row.id === id); Object.assign(row, patch); calls.push(["update", id]); },
    getArrayBuffer: async key => { calls.push(["read", key]); return key === "a" ? buffer : null; },
    storeArrayBuffer: async key => { calls.push(["store", key]); return true; },
    deleteArrayBuffer: async key => { calls.push(["delete", key]); },
    transformToken: async value => { assert.equal(value, buffer); calls.push(["auth"]); return "new"; },
    scheduleRequest: async fn => { calls.push(["limited"]); return fn(); },
    fetchToken: async (url, options) => { calls.push(["fetch", url, options.cache]); return { ok: true, json: async () => ({ token: "url-new", server: "new-server" }) }; },
    ...overrides,
  };
  return { tokens, calls, buffer, deps, refresh: createTokenCredentialRefresher(deps) };
}
test("BIN刷新从账号ID读取，只更新凭据且不影响其他账号", async () => {
  const f = fixture(); assert.equal(await f.refresh("a"), "new");
  assert.equal(f.tokens[0].remark, "备注"); assert.equal(f.tokens[1].token, "other");
  assert.deepEqual(f.calls.map(row => row[0]), ["read", "auth", "update"]);
});
test("同账号并发刷新复用同一请求，不同账号独立处理", async () => {
  let resolve;
  const f = fixture({ transformToken: () => new Promise(r => { resolve = r; }) });
  const a = f.refresh("a"), b = f.refresh("a"); assert.equal(a, b);
  await Promise.resolve(); resolve("new"); await a;
  assert.equal(f.calls.filter(row => row[0] === "update").length, 1);
  await assert.rejects(f.refresh("b"), /未找到/);
});
test("旧名称BIN读取后迁移到账号ID，保存失败不删除原数据", async () => {
  for (const saved of [true, false]) {
    const f = fixture();
    f.deps.getArrayBuffer = async key => key === "A" ? f.buffer : null;
    f.deps.storeArrayBuffer = async () => saved;
    const refresh = createTokenCredentialRefresher(f.deps);
    await refresh("a");
    assert.equal(f.calls.some(row => row[0] === "delete"), saved);
  }
});
test("URL刷新使用限流、禁用缓存并保留来源配置", async () => {
  const f = fixture(); Object.assign(f.tokens[0], { importMethod: "url", sourceUrl: "https://source.example/token" });
  await f.refresh("a");
  assert.deepEqual(f.calls.slice(0, 2), [["limited"], ["fetch", "https://source.example/token", "no-store"]]);
  assert.equal(f.tokens[0].token, "url-new"); assert.equal(f.tokens[0].server, "new-server");
  assert.equal(f.tokens[0].sourceUrl, "https://source.example/token");
});
test("无来源、缺BIN和空返回均明确失败且不覆盖已有Token", async () => {
  for (const method of ["manual", "bin", "url"]) {
    const f = fixture({ getArrayBuffer: async () => null, fetchToken: async () => ({ ok: true, json: async () => ({}) }) });
    Object.assign(f.tokens[0], { importMethod: method, sourceUrl: method === "url" ? "https://source.example" : undefined });
    await assert.rejects(f.refresh("a")); assert.equal(f.tokens[0].token, "old");
  }
});
test("刷新期间删除或人工更新账号，不将过期结果写回", async () => {
  for (const deleted of [true, false]) {
    let resolve;
    const f = fixture({ transformToken: () => new Promise(r => { resolve = r; }) });
    const pending = f.refresh("a"); await Promise.resolve();
    if (deleted) f.tokens.splice(0, 1); else f.tokens[0].token = "manual-new";
    resolve("obsolete");
    if (deleted) await assert.rejects(pending, /移除/); else assert.equal(await pending, "manual-new");
    assert.equal(f.calls.filter(row => row[0] === "update").length, 0);
  }
});
test("刷新失败后清除进行中标记，允许后续重新获取", async () => {
  let count = 0;
  const f = fixture({ transformToken: async () => { if (++count === 1) throw new Error("network"); return "new"; } });
  await assert.rejects(f.refresh("a")); assert.equal(await f.refresh("a"), "new"); assert.equal(count, 2);
});
