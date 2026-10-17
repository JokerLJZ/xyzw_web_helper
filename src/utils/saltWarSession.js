import { bon } from "./bonProtocol.js";
import { entries, get } from "./saltWarMap.js";
export const saltBody = response => response?.rawData ?? response?.decodedBody ?? response?._raw?.decodedBody ?? response?._raw?.body ?? response?.body ?? response;
const clone = value => {
  if (value instanceof Map) return Object.fromEntries(entries(value).map(([k, v]) => [k, clone(v)]));
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
};
// Same incremental contract as GDBattlefield.setValue: missing fields survive;
// explicit null map entries are tombstones, not empty snapshots.
export function mergeSaltPatch(target, patch) {
  for (const [key, value] of entries(patch)) {
    if (value === null) delete target[key];
    else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      mergeSaltPatch(target[key], value);
    } else target[key] = clone(value);
  }
  return target;
}
export function saltWarUrl(primaryUrl, info) {
  const original = new URL(primaryUrl);
  if (original.protocol !== "wss:") throw new Error("盐场连接必须使用WSS");
  const url = info.domainName ? new URL(info.domainName) : new URL(primaryUrl);
  if (url.protocol !== "wss:" || url.username || url.password) throw new Error("盐场服务器地址无效");
  if (info.domainName) for (const [key, value] of original.searchParams) url.searchParams.set(key, value);
  url.searchParams.set("sid2", String(info.sid));
  return url.toString();
}
export async function inflateSaltEntry(body) {
  if (!body?.data) return body;
  const bytes = body.data instanceof Uint8Array ? body.data : new Uint8Array(body.data);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return bon.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}
export class SaltWarSession {
  constructor({ client, info, mainSend, now = Date.now, shouldStop = () => false, owned = false }) {
    this.client = client; this.info = info; this.mainSend = mainSend; this.now = now; this.shouldStop = shouldStop; this.owned = owned;
    this.battlefield = null; this.battles = {}; this.ends = new Map(); this.role = {}; this.roleMap = {}; this.selfCodeId = null;
    this.seen = new WeakSet(); this.pending = Promise.resolve(); this.closed = false;
    this.unsubscribe = client.subscribePackets(packet => {
      if (!String(packet.cmd || "").toLowerCase().startsWith("war_") || packet.code) return;
      this.enqueue(saltBody(packet), packet.cmd);
    });
  }
  enqueue(body, cmd = "") {
    this.pending = this.pending.then(() => this.absorb(body, cmd)).catch(error => { this.failure = error; });
    return this.pending;
  }
  async absorb(raw, cmd = "") {
    if (!raw || typeof raw !== "object" || this.seen.has(raw)) return;
    const body = await inflateSaltEntry(raw);
    this.seen.add(raw);
    if (body.battlefieldId !== undefined && String(body.battlefieldId) !== String(this.info.battlefieldId)) return;
    if (body.battlefield?.id !== undefined && String(body.battlefield.id) !== String(this.info.battlefieldId)) return;
    if (body.battlefield) {
      if (!this.battlefield) this.battlefield = {};
      mergeSaltPatch(this.battlefield, body.battlefield);
    }
    if (body.roleMap) mergeSaltPatch(this.roleMap, body.roleMap);
    if (body.role) mergeSaltPatch(this.role, body.role);
    if (body.battleList) mergeSaltPatch(this.battles, body.battleList);
    if (body.roleCodeId && !this.selfCodeId && String(cmd).toLowerCase().includes("enterbattlefield")) this.selfCodeId = body.roleCodeId;
    if (body.battleInfo?.id !== undefined) this.battles[body.battleInfo.id] = clone(body.battleInfo);
    if (String(cmd).toLowerCase() === "war_endattackbuildingnotify") {
      this.ends.set(String(body.battleId), clone(body));
      delete this.battles[body.battleId];
    }
    if (String(cmd).toLowerCase() === "war_endmarchnotify" && this.battlefield?.marches) delete this.battlefield.marches[body.marchId];
  }
  check() {
    if (this.shouldStop()) throw new Error("盐场任务已停止");
    if (this.closed || !this.client.connected) throw new Error("盐场连接中断，请重查状态后继续");
    if (this.failure) throw this.failure;
  }
  async send(cmd, params = {}) {
    this.check();
    const result = await this.client.sendWithPromise(cmd, { battlefieldId: this.info.battlefieldId, ...params }, 15000);
    await this.pending;
    await this.absorb(saltBody(result), cmd);
    this.check();
    return saltBody(result);
  }
  async enter(roleId, mainRole) {
    await this.send("war_enterbattlefield", { useGzip: false });
    this.selfCodeId = get(this.roleMap, roleId)?.cId ?? this.selfCodeId;
    if (!this.battlefield?.roles || !this.battlefield?.buildingData || !this.selfCodeId) throw new Error("盐场快照缺少本人或地图信息，停止操作");
    // BattleField.setServerData creates a watching role from ROLE only when
    // the declared identity still equals the main role ID. Never guess an anonymous code.
    if (!this.self() && String(this.selfCodeId) === String(roleId) && mainRole && Number(mainRole.legionId) > 0 && get(this.battlefield.legions, mainRole.legionId)) {
      this.watchingSelf = { codeIdV2: roleId, legionID: Number(mainRole.legionId), state: "watching", position: { x: 0, y: 0 }, energy: 0, lordWeaponId: 0, petUId: "" };
    }
    this.startPing();
    return this;
  }
  startPing() {
    const seconds = Math.max(1, Number(this.battlefield?.rTimeoutTime) || 5);
    this.pingTimer = setInterval(() => {
      if (this.closed || this.shouldStop() || !this.client.connected || ["watching", "over"].includes(this.self()?.state)) return;
      try { this.client.send("war_ping", { battlefieldId: this.info.battlefieldId }); } catch (error) { this.failure = error; }
    }, seconds * 1000);
  }
  self() { return get(this.battlefield?.roles, this.selfCodeId) || this.watchingSelf; }
  async refresh() { await this.send("war_getbattlefieldinfo"); return this.battlefield; }
  close() {
    this.closed = true; clearInterval(this.pingTimer); this.unsubscribe?.();
    if (this.owned) this.client.disconnect();
  }
}
export async function openSaltWarSession({ primaryClient, info, mainSend, shouldStop, createClient, now }) {
  let client = primaryClient, owned = false;
  if (info.sid) {
    const Factory = createClient || (options => import("./xyzwWebSocket.js").then(({ XyzwWebSocketClient }) => new XyzwWebSocketClient(options)));
    client = await Factory({ url: saltWarUrl(primaryClient.url, info), utils: primaryClient.utils, heartbeatMs: 5000 });
    owned = true;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("盐场连接超时")), 15000);
        client.onConnect = () => { clearTimeout(timer); resolve(); };
        client.onError = () => { clearTimeout(timer); reject(new Error("盐场连接失败")); };
        client.onDisconnect = () => { clearTimeout(timer); reject(new Error("盐场连接已关闭")); };
        client.init();
      });
    } catch (error) { client.disconnect(); throw error; }
  }
  return new SaltWarSession({ client, info, mainSend, shouldStop, owned, now });
}
