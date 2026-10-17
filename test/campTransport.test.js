import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
const source = (await fs.readFile(new URL("../src/utils/xyzwWebSocket.js", import.meta.url), "utf8")).replace(/^import .*;$/gm, "");
const prelude = `const $CacheManager = { getCache: () => ({}) };
const bonProtocol = {}, g_utils = {};
const wsLogger = new Proxy({}, {get: () => () => {}}), gameLogger = wsLogger;`;
const { XyzwWebSocketClient } = await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString("base64")}`);

test("营地领奖注册发送并按专用响应匹配，服务器时间按连接隔离", async () => {
  const a = new XyzwWebSocketClient({ url: "wss://test-a", utils: {} });
  const b = new XyzwWebSocketClient({ url: "wss://test-b", utils: {} });
  a.connected = true;
  const pending = a.sendWithPromise("club_taskclaim", { confId: 5 }, 1000);
  assert.equal(a.sendQueue[0].cmd, "club_taskclaim");
  assert.deepEqual(a.sendQueue[0].params, { confId: 5 });
  a._handlePromiseResponse({ cmd: "club_taskclaimresp", code: 0, time: 1791960000000, body: { siege: { taskClaimedMap: { 5: 1 } } } });
  assert.deepEqual((await pending).siege, { taskClaimedMap: { 5: 1 } });
  assert.ok(a.getServerTime() >= 1791960000000);
  assert.equal(b.getServerTime(), null);
  a._handlePromiseResponse({ time: "invalid" });
  assert.ok(Number.isFinite(a.getServerTime()));
  b._handlePromiseResponse({ _raw: { time: 1791960001000 } });
  assert.ok(b.getServerTime() >= 1791960001000);
});
