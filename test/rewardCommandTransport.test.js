import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";

// 隔离浏览器缓存和日志依赖，使用生产命令注册、队列和响应匹配实现。
const source = (await fs.readFile(new URL("../src/utils/xyzwWebSocket.js", import.meta.url), "utf8"))
  .replace(/^import .*;$/gm, "");
const prelude = `const WebSocket = { OPEN: 1 };
const $CacheManager = { getCache: () => ({}) };
const bonProtocol = {}, g_utils = {};
const wsLogger = new Proxy({}, {get: () => () => {}}), gameLogger = wsLogger;`;
const { CommandRegistry, registerDefaultCommands, XyzwWebSocketClient } = await import(
  `data:text/javascript;base64,${Buffer.from(prelude + source).toString("base64")}`
);

test("通用异步领奖使用注册命令及当前协议对应响应完成Promise", async () => {
  for (const [cmd, response, params] of [
    ["role_asyncclaimreward", "syncresp", {}],
    ["role_asyncclaimrewardv2", "role_asyncclaimrewardv2resp", { type: "evoTowerShop", isAll: true, rewardId: "" }],
  ]) {
    const registry = registerDefaultCommands(new CommandRegistry());
    assert.deepEqual(registry.build(cmd, 0, 1, params).body, params);
    const client = new XyzwWebSocketClient({ url: "wss://test", utils: {} });
    client.connected = true; client.socket = { readyState: 1, close() {} };
    try {
      const result = client.sendWithPromise(cmd, params, 1000);
      client.sendQueue.shift();
      client._handlePromiseResponse({ cmd: response, code: 0, body: { role: { statistics: {} } } });
      await result;
      assert.equal(Object.keys(client.promises).length, 0);
    } finally { client._clearTimers(); }
  }
});
