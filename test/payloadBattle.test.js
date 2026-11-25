import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.js";

test("XyzwWebSocketClient registers official payload battle commands and builds packets", async () => {
  const logger = {
    info() {},
    verbose() {},
    wsMessage() {},
    warn() {},
    error() {},
  };
  const utils = {
    bon: {
      encode(val) {
        return val;
      },
    },
    getEnc() {
      return null;
    },
  };
  const dependencies = {
    "@/stores/cache": {
      $CacheManager: {
        getCache() {
          return {
            get() {
              return null;
            },
            set() {},
          };
        },
      },
    },
    "./bonProtocol.js": { g_utils: utils },
    "./logger.js": { gameLogger: logger, wsLogger: logger },
    "./helperTaskRunner.js": { sleep: async () => {} },
  };
  const globals = {
    WebSocket: { OPEN: 1 },
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  };

  const exports = await loadModule(
    new URL("../src/utils/xyzwWebSocket.js", import.meta.url),
    dependencies,
    globals,
  );

  const client = new exports.XyzwWebSocketClient({
    url: "wss://test.hortorgames.com",
    utils,
  });

  // 1. 验证战场命令注册完整性
  const expectedPayloadCmds = [
    "payload_enterbf",
    "payload_ping",
    "payload_startbattle",
    "payload_startmarch",
    "payload_cancelmarch",
    "payload_startchangecarpath",
    "payload_startpickitem",
    "payload_updateflag",
    "payload_useitem",
    "payload_useskill",
    "payload_setbattleteam",
    "payload_getteaminfo",
  ];

  for (const cmd of expectedPayloadCmds) {
    assert.equal(
      client.registry.commands.has(cmd),
      true,
      `Command ${cmd} should be registered in main client`,
    );
  }

  // 2. 验证 payload_enterbf 报文
  const enterPacket = client.registry.build("payload_enterbf", 1, 2, {
    bfId: "bf_peach_001",
  });
  assert.equal(enterPacket.cmd, "payload_enterbf");
  assert.equal(enterPacket.seq, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(enterPacket.body)), {
    bfId: "bf_peach_001",
  });

  // 3. 验证 payload_startbattle 报文
  const battlePacket = client.registry.build("payload_startbattle", 2, 3, {
    bfId: "bf_peach_001",
    targetId: 3001,
  });
  assert.equal(battlePacket.cmd, "payload_startbattle");
  assert.deepEqual(JSON.parse(JSON.stringify(battlePacket.body)), {
    bfId: "bf_peach_001",
    targetId: 3001,
  });

  // 4. 验证 payload_startmarch 报文
  const marchPacket = client.registry.build("payload_startmarch", 3, 4, {
    bfId: "bf_peach_001",
    carId: 10,
    path: [{ x: 100, y: 200 }, { x: 150, y: 250 }],
  });
  assert.equal(marchPacket.cmd, "payload_startmarch");
  assert.deepEqual(JSON.parse(JSON.stringify(marchPacket.body)), {
    bfId: "bf_peach_001",
    carId: 10,
    path: [{ x: 100, y: 200 }, { x: 150, y: 250 }],
  });

  // 5. 验证 payload_setbattleteam 报文
  const teamPacket = client.registry.build("payload_setbattleteam", 4, 5, {
    bfId: "bf_peach_001",
    battleTeam: [{ heroId: 101, pos: 1 }],
    lordWeaponId: 2,
    petUId: "pet_999",
  });
  assert.equal(teamPacket.cmd, "payload_setbattleteam");
  assert.deepEqual(JSON.parse(JSON.stringify(teamPacket.body)), {
    bfId: "bf_peach_001",
    battleTeam: [{ heroId: 101, pos: 1 }],
    lordWeaponId: 2,
    petUId: "pet_999",
  });
});

test("PayloadBattleClient preserves disconnect callback after entering and cleans failed enter", async () => {
  let intervalCount = 0, disconnected = 0, fail = false;
  class Client {
    constructor() { this.closed = false; }
    init() { this.onConnect(); }
    setMessageListener() {}
    async sendWithPromise() { if (fail) throw new Error('进场失败'); return {ok:true}; }
    disconnect() { this.closed=true; this.onDisconnect?.(); }
    send() {}
  }
  const {PayloadBattleClient} = await loadModule(new URL('../src/utils/payloadBattleClient.js',import.meta.url),{
    '@/utils/xyzwWebSocket.js':{XyzwWebSocketClient:Client},
  },{setInterval:()=>{intervalCount++;return 1;},clearInterval:()=>{intervalCount--;}});
  const client=new PayloadBattleClient({mainWsUrl:'wss://main/?p=token',bfInfo:{domainName:'wss://battle/',sid:'sid',bfId:'battle'},onDisconnect:()=>disconnected++});
  await client.connect();
  client.client.onDisconnect();
  assert.equal(disconnected,1);assert.equal(intervalCount,0);
  client.close();
  fail=true;
  const invalid=new PayloadBattleClient({mainWsUrl:'wss://main/',bfInfo:{domainName:'wss://battle/',sid:'sid',bfId:'battle'}});
  await assert.rejects(invalid.connect(),/进场失败/);
  assert.equal(invalid.closed,true);assert.equal(invalid.client,null);
});

test("Payload runner releases owned temporary main connection when battlefield query fails",async()=>{
 const {startPayloadBattleFlow}=await loadModule(new URL('../src/utils/payloadBattleRunner.js',import.meta.url),{'./payloadBattleClient.js':{PayloadBattleClient:class{}}});
 let connected=false,closed=0;
 const store={gameTokens:[{id:'a',token:'token'}],getWebSocketStatus:()=>connected?'connected':'disconnected',createWebSocketConnection:()=>{connected=true;},closeWebSocketConnection:()=>{closed++;connected=false;},sendMessageWithPromise:async()=>{throw Error('查询失败');}};
 await assert.rejects(startPayloadBattleFlow(store,'a'),/查询失败/);
 assert.equal(closed,1);
});
