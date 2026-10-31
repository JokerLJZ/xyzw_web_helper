import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sources = await Promise.all(["xyzwWebSocket", "xyzwLegionWarWebSocket"].map(async file =>
  (await readFile(new URL(`../src/utils/${file}.js`, import.meta.url), "utf8"))
    .replace(/^\s*import .*$/gm, "").replace(/export default .*;?/g, "").replace(/export /g, "")));
function fixture(index = 0) {
  let id = 0;
  const timers = new Map(), sockets = [];
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(value) { if (this.fail) throw new Error("发送失败"); this.sent.push(value); }
    close() { this.readyState = 3; }
  }
  const logger = new Proxy({}, { get: () => () => {} });
  const context = {
    WebSocket: Socket, Blob, TextDecoder, TextEncoder, performance, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, ms, repeat: false }); return id; },
    setInterval: (fn, ms) => { timers.set(++id, { fn, ms, repeat: true }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    $CacheManager: { getCache: () => ({}), delCache() {} },
    bonProtocol: {}, g_utils: {}, wsLogger: logger, gameLogger: logger,
  };
  vm.createContext(context);
  const cls = index ? "XyzwLegionWarWebSocketClient" : "XyzwWebSocketClient";
  vm.runInContext(sources[index] + `\nglobalThis.Client = ${cls};`, context);
  const client = new context.Client({ url: "wss://test", utils: { parse: value => value }, hint: "battle" });
  client.registry.build = (cmd, ack, seq, params) => ({ cmd, ack, seq, body: params });
  client.registry.encodePacket = raw => raw;
  client.init(); sockets[0].onopen();
  const tick = async ms => {
    for (const [key, timer] of [...timers]) if (timer.ms === ms && timers.has(key)) {
      if (!timer.repeat) timers.delete(key);
      await timer.fn();
    }
  };
  return { client, sockets, timers, tick };
}
for (const index of [0,1]) {
  const label = index ? "盐场" : "主连接";
  test(`${label}：超时未发送请求移出队列，之后发送编号无空洞`, async () => {
    const f = fixture(index), { client } = f;
    const cmd = index ? "war_getbattlefieldinfo" : "role_getroleinfo";
    const first = client.sendWithPromise(cmd, {}, 7);
    const rejected = assert.rejects(first, /超时/);
    await f.tick(7); await rejected;
    assert.equal(client.sendQueue.length, 0);
    const next = client.sendWithPromise(cmd, {}, 99);
    await f.tick(50);
    assert.equal(f.sockets[0].sent[0].seq, 1);
    client._handlePromiseResponse({ resp: 1, code: 0, body: { ok: true } });
    assert.equal((await next).ok, true);
    client.disconnect(); assert.equal(f.timers.size, 0);
  });
  test(`${label}：旧编号和resp=0不走命令名兜底，兼容无编号响应`, async () => {
    const f = fixture(index), { client } = f;
    const cmd = index ? "war_getbattlefieldinfo" : "role_getroleinfo";
    const old = client.sendWithPromise(cmd, {}, 7), rejection = assert.rejects(old);
    await f.tick(50); await f.tick(7); await rejection;
    const next = client.sendWithPromise(cmd, {}, 99); await f.tick(50);
    client._handlePromiseResponse({ resp: 1, cmd: `${cmd}resp`, time: 123, body: { old: true } });
    client._handlePromiseResponse({ resp: 0, cmd: `${cmd}resp`, body: { old: true } });
    assert.equal(Object.keys(client.promises).length, 1);
    if (!index) assert.equal(client.getServerTime(), null);
    client._handlePromiseResponse({ cmd: index ? cmd : `${cmd}resp`, body: { fresh: true } });
    assert.equal((await next).fresh, true); client.disconnect();
  });
  test(`${label}：发送异常即时释放，重连后旧事件和Blob不能影响新连接`, async () => {
    const f = fixture(index), { client } = f;
    const cmd = index ? "war_getbattlefieldinfo" : "role_getroleinfo";
    f.sockets[0].fail = true;
    const pending = client.sendWithPromise(cmd, {}, 99), rejection = assert.rejects(pending, /发送失败/);
    await f.tick(50); await rejection;
    assert.equal(client.wireSeq, 0); assert.equal(Object.keys(client.promises).length,0);
    const old = f.sockets[0]; let decode;
    const blob = new Blob(["old"]); blob.arrayBuffer = () => new Promise(resolve => { decode = resolve; });
    old.onmessage({ data: blob });
    client.init(); f.sockets[1].onopen();
    const timers = f.timers.size;
    old.onclose({ code:1006, reason:"old" }); old.onerror(new Error("old")); old.onopen();
    decode({cmd:"old",seq:999}); await Promise.resolve();
    assert.equal(client.socket, f.sockets[1]); assert.equal(client.connected,true);
    assert.equal(client.ack,0); assert.equal(f.timers.size,timers);
    client.disconnect(); assert.equal(f.timers.size,0);
  });
}

const backendSource = (await readFile(new URL("../render-backend/lib/gameClient.js", import.meta.url), "utf8"))
  .replace(/^import .*$/gm, "").replace(/export \{ GameClient \};/, "");
function backendFixture() {
  let id=0;
  const timers=new Map(), sockets=[];
  class Socket {
    static OPEN=1;
    constructor(){this.readyState=1;this.events={};this.sent=[];sockets.push(this);}
    on(name,fn){this.events[name]=fn;}
    send(raw){if(this.fail)throw Error("发送失败");this.sent.push(raw);}
    close(){this.readyState=3;}
  }
  const context={WebSocket:Socket,console:{log(){}},encode:raw=>raw,getEnc:()=>{},parse:raw=>raw,bon:{encode:raw=>raw},
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:key=>timers.delete(key),
    setInterval:(fn,ms)=>{timers.set(++id,{fn,ms,repeat:true});return id;},clearInterval:key=>timers.delete(key)};
  vm.createContext(context);vm.runInContext(backendSource+'\nglobalThis.Client=GameClient;',context);
  const client=new context.Client({name:'test'},'wss://test');
  return {client,sockets,timers};
}
test("后端：同步发送失败立即释放等待项，不占用服务器编号",async()=>{
  const f=backendFixture(),connecting=f.client.connect();f.sockets[0].events.open();await connecting;
  f.sockets[0].fail=true;
  await assert.rejects(f.client.sendWithPromise('role_getroleinfo'),/发送失败/);
  assert.equal(f.client.seq,0);assert.equal(Object.keys(f.client.promises).length,0);
  f.sockets[0].fail=false;
  const pending=f.client.sendWithPromise('role_getroleinfo');
  assert.equal(f.sockets[0].sent[0].seq,1);
  f.client._handleMessage({_raw:{resp:1,code:0},rawData:{ok:true}});
  assert.equal((await pending).ok,true);f.client.disconnect();assert.equal(f.timers.size,0);
});
test("后端：迟到数字响应不兜底匹配，新连接不受旧连接关闭影响",async()=>{
  const f=backendFixture(),connecting=f.client.connect();f.sockets[0].events.open();await connecting;
  const old=f.sockets[0];
  const reconnecting=f.client.connect();f.sockets[1].events.open();await reconnecting;
  old.events.close(1006,'old');old.events.error(Error('old'));
  assert.equal(f.client.connected,true);
  const pending=f.client.sendWithPromise('role_getroleinfo');
  f.client._handleMessage({_raw:{resp:99,cmd:'role_getroleinforesp',code:0},rawData:{old:true}});
  assert.equal(Object.keys(f.client.promises).length,1);
  f.client._handleMessage({_raw:{cmd:'role_getroleinforesp',code:0},rawData:{fresh:true}});
  assert.equal((await pending).fresh,true);f.client.disconnect();assert.equal(f.timers.size,0);
});

test('藏品与卡牌领奖注册命令并匹配客户端声明的共享响应', async () => {
  const mappings = [
    ['collection_getinfo', 'collectioninforesp'],
    ['collection_activate', 'collectioninforesp'],
    ['collection_claimseries', 'collection_claimresp'],
    ['collection_claimtotal', 'collection_claimresp'],
    ['linkcard_claimpackprocessreward', 'syncrewardresp'],
    ['linkcard_claimseriesreward', 'syncrewardresp'],
  ];
  for (const [cmd, response] of mappings) {
    const f = fixture();
    assert.equal(f.client.registry.commands.has(cmd), true);
    const pending = f.client.sendWithPromise(cmd, {}, 99);
    await f.tick(50);
    f.client._handlePromiseResponse({ cmd: response, code: 0, body: { verified: cmd } });
    assert.equal((await pending).verified, cmd);
    f.client.disconnect();
  }
});
