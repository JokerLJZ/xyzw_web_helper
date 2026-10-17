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
    ["common_claimcardreward", "common_rewardresp"],
    ["common_claimtotalreward", "common_rewardresp"],
  ]) {
    const pending = client.sendWithPromise(command, {}, 1000);
    client._handlePromiseResponse({ cmd: response, code: 0, body: { checked: true } });
    assert.equal((await pending).checked, true, command);
  }
});
