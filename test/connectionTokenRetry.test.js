import test from "node:test";
import assert from "node:assert/strict";
import { connectWithTokenRefresh } from "../src/utils/batch/connectWithTokenRefresh.js";
function fixture({ results = [false, true], method = "bin", refreshError = false } = {}) {
  const token = { id: "a", token: "old", importMethod: method };
  const calls = []; let stopped = false;
  const options = {
    tokenId: "a", getToken: () => token,
    tokenStore: {
      createWebSocketConnection: async (_id, value, _url, settings) => { calls.push(["create", value]); assert.equal(settings.autoRefreshOnFailure, false); },
      closeWebSocketConnectionAsync: async () => { calls.push(["close"]); },
      refreshTokenCredentials: async () => { calls.push(["refresh"]); if (refreshError) throw new Error("secret credential detail"); token.token = "new"; },
    },
    waitForConnection: async () => results.shift() ?? false,
    sleep: async () => { calls.push(["delay"]); },
    shouldStop: () => stopped,
    log: () => {}, maxRetries: 2,
  };
  return { options, calls, token, stop: () => { stopped = true; } };
}
test("超时后先等待旧连接关闭，再刷新Token并以新凭据建立连接", async () => {
  const f = fixture(); await connectWithTokenRefresh(f.options);
  assert.deepEqual(f.calls, [["create", "old"], ["close"], ["refresh"], ["delay"], ["create", "new"]]);
});
test("maxRetries=2真正执行两次重试，凭据仅重新获取一次", async () => {
  const f = fixture({ results: [false, false, true] }); await connectWithTokenRefresh(f.options);
  assert.deepEqual(f.calls.filter(row => row[0] === "create"), [["create", "old"], ["create", "new"], ["create", "new"]]);
  assert.equal(f.calls.filter(row => row[0] === "refresh").length, 1);
});
test("重试耗尽清理失败连接，并明确报告已刷新仍未成功", async () => {
  const f = fixture({ results: [] }); await assert.rejects(connectWithTokenRefresh(f.options), /已重新获取Token/);
  assert.equal(f.calls.filter(row => row[0] === "create").length, 3);
  assert.equal(f.calls.filter(row => row[0] === "close").length, 3);
});
test("刷新失败立即停止，不使用旧Token继续重试或泄漏来源错误正文", async () => {
  const f = fixture({ refreshError: true }); await assert.rejects(connectWithTokenRefresh(f.options), error => /自动重新获取Token失败/.test(error.message) && !error.message.includes("secret"));
  assert.equal(f.calls.filter(row => row[0] === "create").length, 1);
});
test("手动Token没有刷新来源时只做有界连接重试", async () => {
  const f = fixture({ method: "manual", results: [false, false, true] }); await connectWithTokenRefresh(f.options);
  assert.equal(f.calls.filter(row => row[0] === "refresh").length, 0);
});
test("初次成功和关闭重试均不触发不必要刷新", async () => {
  const first = fixture({ results: [true] }); await connectWithTokenRefresh(first.options);
  assert.deepEqual(first.calls, [["create", "old"]]);
  const noRetry = fixture(); noRetry.options.maxRetries = 0;
  await assert.rejects(connectWithTokenRefresh(noRetry.options));
  assert.deepEqual(noRetry.calls, [["create", "old"], ["close"]]);
});
test("刷新中收到停止请求，刷新结束后不建立新连接", async () => {
  const f = fixture(); f.options.tokenStore.refreshTokenCredentials = async () => { f.stop(); };
  await assert.rejects(connectWithTokenRefresh(f.options), error => error.interrupted === true);
  assert.equal(f.calls.filter(row => row[0] === "create").length, 1);
});
test("重连前重新读取账号，而非保留最初的Token对象", async () => {
  const f = fixture(); let token = f.token;
  f.options.getToken = () => token;
  f.options.tokenStore.refreshTokenCredentials = async () => { token = { ...token, token: "replaced-record" }; };
  await connectWithTokenRefresh(f.options);
  assert.deepEqual(f.calls.at(-1), ["create", "replaced-record"]);
});
