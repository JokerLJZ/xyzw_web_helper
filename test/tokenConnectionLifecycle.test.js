import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import vm from "node:vm";
import { ref, toRaw } from "vue";

const source = await readFile(new URL("../src/stores/tokenStore.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("store.ts", source, ts.ScriptTarget.Latest, true);
const names = new Set(["acquireConnectionLock", "releaseConnectionLock", "createWebSocketConnection", "closeWebSocketConnectionAsync"]);
const pieces = [];
function visit(node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(row => names.has(row.name.getText(ast)))) pieces.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const js = ts.transpileModule(pieces.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function fixture() {
  const clients = [], cross = [], refreshes = [];
  const wsConnections = ref({}), connectionLocks = ref({});
  const logger = new Proxy({}, { get: () => () => {} });
  const context = {
    ref, toRaw, wsConnections, connectionLocks, currentSessionId: "page",
    wsLogger: logger, gameLogger: logger, g_utils: {},
    checkCrossTabConnection: () => null,
    updateCrossTabConnectionState: (_id, state) => cross.push(state),
    parseBase64Token: token => ({ success: true, data: { actualToken: token } }),
    validateToken: () => true,
    attemptTokenRefresh: async id => { refreshes.push(id); },
    handleGameMessage: () => {},
    localStorage: { removeItem() {} },
    clearTimeout() {},
    setTimeout: callback => queueMicrotask(callback),
    XyzwWebSocketClient: class {
      constructor() { clients.push(this); this.connected = false; }
      init() {}
      disconnect() { this.connected = false; this.onDisconnect({ code: 1006 }); }
      send() {}
      setMessageListener(listener) { this.listener = listener; }
    },
  };
  vm.createContext(context);
  vm.runInContext(js + "\nglobalThis.api={createWebSocketConnection,closeWebSocketConnectionAsync};", context);
  return { ...context, clients, cross, refreshes };
}
test("关闭握手未完成连接释放连接锁，批量关闭不触发后台刷新", async () => {
  const f = fixture();
  await f.api.createWebSocketConnection("a", "old", null, { autoRefreshOnFailure: false });
  assert.ok(f.connectionLocks.value.a_connect);
  await f.api.closeWebSocketConnectionAsync("a");
  assert.equal(f.connectionLocks.value.a_connect, undefined);
  assert.equal(f.wsConnections.value.a, undefined);
  assert.equal(f.refreshes.length, 0);
  await f.api.createWebSocketConnection("a", "new", null, { autoRefreshOnFailure: false });
  assert.equal(f.clients.length, 2);
});
test("旧连接迟到的断开和错误不能覆盖新连接，也不能释放新连接锁", async () => {
  const f = fixture();
  const old = await f.api.createWebSocketConnection("a", "old", null, { autoRefreshOnFailure: false });
  await f.api.closeWebSocketConnectionAsync("a");
  const current = await f.api.createWebSocketConnection("a", "new", null, { autoRefreshOnFailure: false });
  const lock = f.connectionLocks.value.a_connect;
  await old.onDisconnect({ code: 1006 }); old.onError(new Error("late"));
  assert.equal(f.wsConnections.value.a.status, "connecting");
  assert.equal(f.connectionLocks.value.a_connect, lock);
  current.onConnect();
  await old.onDisconnect({ code: 1006 });
  assert.equal(f.wsConnections.value.a.status, "connected");
  assert.equal(f.cross.at(-1), "connected");
  assert.equal(f.refreshes.length, 0);
});
test("主动替换连接时旧连接关闭不能释放正在创建的新连接锁", async () => {
  const f = fixture();
  const old = await f.api.createWebSocketConnection("a", "old", null, { autoRefreshOnFailure: false });
  old.onConnect();
  await f.api.createWebSocketConnection("a", "new", null, { autoRefreshOnFailure: false });
  assert.ok(f.connectionLocks.value.a_connect);
  assert.equal(f.wsConnections.value.a.status, "connecting");
  assert.equal(f.cross.at(-1), "connecting");
  assert.equal(f.refreshes.length, 0);
});
test("普通页面握手失败仍可自动刷新，批量连接由重试流程统一控制", async () => {
  for (const autoRefreshOnFailure of [true, false]) {
    const f = fixture();
    const client = await f.api.createWebSocketConnection("a", "token", null, { autoRefreshOnFailure });
    await client.onDisconnect({ code: 1006 });
    assert.equal(f.refreshes.length, autoRefreshOnFailure ? 1 : 0);
  }
});
