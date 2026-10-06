import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";

// 隔离浏览器缓存和日志依赖，使用生产命令注册、队列和响应匹配实现。
const source = (await fs.readFile(new URL("../src/utils/xyzwWebSocket.js", import.meta.url), "utf8"))
  .replace(/^import .*;$/gm, "");
const prelude = `const $CacheManager = { getCache: () => ({}) };
const bonProtocol = {}, g_utils = {};
const wsLogger = new Proxy({}, {get: () => () => {}}), gameLogger = wsLogger;`;
const { CommandRegistry, registerDefaultCommands, XyzwWebSocketClient } = await import(
  `data:text/javascript;base64,${Buffer.from(prelude + source).toString("base64")}`
);

test("灯神战力计算按抓包编码，并按resp序号接收战力响应", async () => {
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: {} });
  client.connected = true;
  const params = { battleTeam: { 0: 101, 1: 102, 2: 109, 3: 113, 4: 202 }, lordWeaponId: 3 };
  const promise = client.sendWithPromise("hero_calcpowerbyteam", params, 1000);
  const task = client.sendQueue.shift();
  const packet = client.registry.build(task.cmd, 0, task.seq, task.params);
  assert.equal(packet.cmd, "hero_calcpowerbyteam");
  assert.deepEqual(packet.body, params);
  client._handlePromiseResponse({ resp: task.seq, cmd: "hero_calcpowerbyteamresp", body: { power: 3015364283 } });
  assert.deepEqual(await promise, { power: 3015364283 });
  assert.equal(Object.keys(client.promises).length, 0);
});

test("未注册命令立即报错，不入队也不留下等待请求", async () => {
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: {} });
  client.connected = true;
  await assert.rejects(client.sendWithPromise("unknown_command", {}, 15000), /未注册的游戏命令/);
  assert.equal(client.sendQueue.length, 0);
  assert.equal(Object.keys(client.promises).length, 0);
});

test("完整灯神阵容可通过真实命令注册器构造挑战报文", () => {
  const registry = registerDefaultCommands(new CommandRegistry());
  const body = { battleTeam: { 0: 107, 1: 108, 2: 116, 3: 112, 4: 120 }, genieId: 4, lordWeaponId: 3 };
  assert.deepEqual(registry.build("fight_startgenie", 0, 39, body).body, body);
});
