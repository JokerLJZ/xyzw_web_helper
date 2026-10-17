import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
const source = (await fs.readFile(new URL("../src/utils/xyzwWebSocket.js", import.meta.url), "utf8")).replace(/^import .*;$/gm, "");
const prelude = `const $CacheManager = { getCache: () => ({}) };
const bonProtocol = {}, g_utils = {};
const wsLogger = new Proxy({}, {get: () => () => {}}), gameLogger = wsLogger;`;
const { XyzwWebSocketClient } = await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString("base64")}`);

test("庆典各协议注册并匹配客户端声明的响应", async () => {
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: {} });
  client.connected = true;
  for (const [command, response] of [
    ["team_getallteam", "syncteamresp"],
    ["team_setteam", "syncteamresp"],
    ["celebrate_getcelebrateinfo", "celebrate_getcelebrateinforesp"],
    ["celebrate_sign", "celebrate_getcelebrateinforesp"],
    ["celebrate_share", "celebrate_claimresp"],
    ["celebrate_claimpersonal", "celebrate_claimresp"],
    ["celebrate_claimfullserver", "celebrate_claimresp"],
    ["activity_maydaylottery", "activity_maydaylotteryresp"],
    ["activity_exchange", "activity_rewardresp"],
    ["activity_photo", "activity_photoresp"],
    ["activity_claimphotoreward", "activity_rewardresp"],
    ["activity_warordertaskclaim", "activity_warorderclaimresp"],
    ["common_claimcardreward", "common_rewardresp"],
    ["common_claimtotalreward", "common_rewardresp"],
  ]) {
    const pending = client.sendWithPromise(command, {}, 1000);
    client._handlePromiseResponse({ cmd: response, code: 0, body: { checked: true } });
    assert.equal((await pending).checked, true, command);
  }
});

test("盐场命令携带战场hint并匹配独立响应，订阅不覆盖原监听", async () => {
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: {} });
  client.connected = true;
  for (const cmd of ["enterbattlefield", "getbattlefieldinfo", "getteaminfo", "teamsetbattleteam", "setbattleteam", "startmarch", "speedup", "startattackbuilding", "ping"]) {
    const command = `war_${cmd}`;
    assert.equal(client.registry.build(command, 0, 1, { battlefieldId: "battlefield-1" }).hint, "battlefield-1");
    const pending = client.sendWithPromise(command, { battlefieldId: "battlefield-1" }, 1000);
    client._handlePromiseResponse({ cmd: `${command}resp`, code: 0, body: { battlefieldId: "battlefield-1" } });
    assert.equal((await pending).battlefieldId, "battlefield-1");
  }
  let calls = 0;
  const storeListener = () => {};
  client.setMessageListener(storeListener);
  const unsubscribe = client.subscribePackets(() => calls++);
  client._notifyPacketSubscribers({ cmd: "war_endmarchnotify" });
  unsubscribe();
  client._notifyPacketSubscribers({ cmd: "war_endmarchnotify" });
  assert.equal(calls, 1); assert.equal(client.messageListener, storeListener);
  assert.equal(client.registry.build("role_getroleinfo", 0, 1, {}).hint, undefined);
});
