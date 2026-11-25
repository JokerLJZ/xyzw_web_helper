import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
const source = (await fs.readFile(new URL("../src/utils/xyzwWebSocket.js", import.meta.url), "utf8")).replace(/^import .*;$/gm, "");
const prelude = `const WebSocket = { OPEN: 1 };
const $CacheManager = { getCache: () => ({}) };
const bonProtocol = {}, g_utils = {};
const wsLogger = new Proxy({}, {get: () => () => {}}), gameLogger = wsLogger;`;
const { XyzwWebSocketClient } = await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString("base64")}`);

test("庆典各协议注册并匹配客户端声明的响应", async () => {
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: {} });
  client.connected = true; client.socket = { readyState: 1, close() {} };
  for (const [command, response] of [
    ["book_claimskinpoint", "syncresp"],
    ["mail_getlist", "mail_getlistresp"],
    ["mail_claimattachment", "mail_claimattachmentresp"],
    ["mail_changestate", "mail_changestateresp"],
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
  client.connected = true; client.socket = { readyState: 1, close() {} };
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

test("日常同步和BOSS状态按当前协议注册并匹配响应", async () => {
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: {} });
  client.connected = true; client.socket = { readyState: 1, close() {} };
  for (const [command, response] of [["task_checkdailytask", "syncresp"], ["boss_getstate", "boss_getstateresp"], ["discount_getdiscountinfo", "discount_getdiscountinforesp"]]) {
    const pending = client.sendWithPromise(command, {}, 1000);
    client._handlePromiseResponse({ cmd: response, code: 0, body: { checked: true } });
    assert.equal((await pending).checked, true);
  }
});

test("盐场保存和出战的实际BON报文携带非空数字阵容及玩具宠物", async () => {
  const { bon } = await import("../src/utils/bonProtocol.js");
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: { bon } });
  for (const command of ["war_teamsetbattleteam", "war_setbattleteam"]) {
    const packet = client.registry.build(command, 0, 1, { battlefieldId: "battlefield-1", battleTeam: new Map([[0, 107], [1, 106]]), lordWeaponId: 2, petUId: "pet-1" });
    const body = bon.decode(packet.body);
    assert.deepEqual(body.battleTeam, { 0: 107, 1: 106 });
    assert.equal(body.lordWeaponId, 2); assert.equal(body.petUId, "pet-1");
    assert.equal(packet.hint, "battlefield-1");
  }
});

test("竞猜领奖实际BON报文保留数字赛程和完整字符串队伍ID", async () => {
  const { bon } = await import("../src/utils/bonProtocol.js");
  const client = new XyzwWebSocketClient({ url: "wss://test", utils: { bon } });
  const packet = client.registry.build("apex_guessclaim", 0, 1, {scheduleId:124,teamId:"A10000037"});
  assert.deepEqual(bon.decode(packet.body), {scheduleId:124,teamId:"A10000037"});
  assert.equal(packet.hint, undefined);
});

test('服务器错误在编号匹配与命令匹配路径均保留code和原始cmd', async () => {
  for (const numbered of [true, false]) {
    const client = new XyzwWebSocketClient({ url: 'wss://test', utils: {} });
    client.connected = true; client.socket = { readyState: 1, close() {} };
    const pending = client.sendWithPromise('evotower_readyfight', {}, 1000);
    const packet = { cmd: 'evotower_readyfightresp', code: 400340, body: {} };
    if (numbered) packet.resp = Number(Object.keys(client.promises)[0]);
    client._handlePromiseResponse(packet);
    await assert.rejects(pending, error => error.code === 400340 && error.cmd === 'evotower_readyfight' && /操作过快/.test(error.message));
    client.disconnect();
  }
});
