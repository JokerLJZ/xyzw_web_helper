import { bon } from "./bonProtocol.js";
import { entries, get } from "./saltWarMap.js";
export const saltBody = response => response?.rawData ?? response?.decodedBody ?? response?._raw?.decodedBody ?? response?._raw?.body ?? response?.body ?? response;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Uint8Array);
const fieldCollections = ["roles", "buildingData", "legions", "marches", "teamMap", "constant", "bIntent"];
const clone = value => {
  if (value instanceof Map) return Object.fromEntries(entries(value).map(([k, v]) => [k, clone(v)]));
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
};
// GDBattlefieldRole initializes state to watching. Fill defaults only when a
// role first appears; a later sparse delta must never reset an active army.
function newSaltRole(id, patch) {
  return { codeIdV2: Number(id), state: "watching", legionID: 0,
    position: { x: 0, y: 0 }, energy: 0, lordWeaponId: 0, petUId: "", custom: {}, ...clone(patch) };
}
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
  constructor({ client, info, mainSend, now = Date.now, shouldStop = () => false, owned = false, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.sleep = sleep; this.lastResponseAt = null;
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
    let body;
    try { body = await inflateSaltEntry(raw); }
    catch { throw new Error("盐场进场/更新数据解压或BON解码失败，停止操作"); }
    if (!isRecord(body)) throw new Error("盐场响应不是有效对象，停止操作");
    this.seen.add(raw);
    if (body.battlefieldId !== undefined && String(body.battlefieldId) !== String(this.info.battlefieldId)) return;
    if (body.battlefield?.id !== undefined && String(body.battlefield.id) !== String(this.info.battlefieldId)) return;
    if (body.battlefield) {
      if (!isRecord(body.battlefield)) throw new Error("盐场战场对象格式无效，停止操作");
      // Restore collection defaults once, as GDBattlefield does. Never apply
      // snapshot defaults to subsequent sparse notifications.
      if (!this.battlefield) this.battlefield = Object.fromEntries(fieldCollections.map(key => [key, {}]));
      const patch = { ...body.battlefield };
      if (patch.roles) {
        const ownId = get(body.roleMap, this.mainRoleId)?.cId ?? this.selfCodeId;
        const ownEntry = entries(patch.roles).find(([id]) => ownId && String(id) === String(ownId));
        if (ownEntry) {
          this.watchingSelf = null;
          this.selfRemoved = ownEntry[1] === null;
        }
        patch.roles = Object.fromEntries(entries(patch.roles).map(([id, role]) => [id,
          role && !get(this.battlefield.roles, id) ? newSaltRole(id, role) : role]));
      }
      mergeSaltPatch(this.battlefield, patch);
    }
    if (body.roleMap) mergeSaltPatch(this.roleMap, body.roleMap);
    const mappedId = this.mainRoleId !== undefined ? get(this.roleMap, this.mainRoleId)?.cId : null;
    if (this.selfCodeId && Number(mappedId) > 0 && String(mappedId) !== String(this.selfCodeId)) throw new Error("盐场本人映射冲突，停止操作");
    this.selfCodeId = Number(mappedId) > 0 ? mappedId : null;
    if (body.role) mergeSaltPatch(this.role, body.role);
    if (body.battleList) mergeSaltPatch(this.battles, body.battleList);
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
    if (this.lastResponseAt !== null) {
      const remaining = 500 - (this.now() - this.lastResponseAt);
      if (remaining > 0) await this.sleep(remaining);
      this.check();
    }
    let result;
    try { result = await this.client.sendWithPromise(cmd, { battlefieldId: this.info.battlefieldId, ...params }, 15000); }
    finally { this.lastResponseAt = this.now(); }
    await this.pending;
    await this.absorb(saltBody(result), cmd);
    this.check();
    return saltBody(result);
  }
  initializeSelf(mainRole) {
    if (!this.selfRemoved && !this.self() && String(this.selfCodeId) === String(this.mainRoleId) && mainRole && Number(mainRole.legionId) > 0 && get(this.battlefield?.legions, mainRole.legionId)) {
      this.watchingSelf = newSaltRole(this.mainRoleId, { legionID: Number(mainRole.legionId) });
    }
  }
  entryProblem() {
    if (!this.battlefield) return "未取得战场对象";
    if (!this.selfCodeId) return "本人映射缺失";
    if (!isRecord(this.battlefield.roles)) return "角色集合无效或缺失";
    if (!this.self()) return "本人条目缺失，无法确认匿名角色";
    if (!isRecord(this.battlefield.buildingData) || !entries(this.battlefield.buildingData).length) return "建筑数据为空或缺失";
    return null;
  }
  entryDiagnostic(retried) {
    const count = key => isRecord(this.battlefield?.[key]) ? entries(this.battlefield[key]).length : "缺失";
    return `${this.entryShape || ""}，阶段=进场，补查=${retried ? "已执行" : "未执行"}，角色数=${count("roles")}，建筑数=${count("buildingData")}，军团数=${count("legions")}，本人映射=${this.selfCodeId ? "命中" : "未命中"}`;
  }
  async enter(roleId, mainRole) {
    this.mainRoleId = roleId;
    const response = await this.send("war_enterbattlefield", { useGzip: false });
    const body = await inflateSaltEntry(response);
    this.entryShape = `压缩=${response?.data ? "是" : "否"}，原始角色集合=${body?.battlefield?.roles === undefined ? "省略" : "已提供"}，原始建筑集合=${body?.battlefield?.buildingData === undefined ? "省略" : "已提供"}`;
    if ((body?.battlefieldId !== undefined && String(body.battlefieldId) !== String(this.info.battlefieldId)) ||
        (body?.battlefield?.id !== undefined && String(body.battlefield.id) !== String(this.info.battlefieldId))) {
      throw new Error("盐场进场响应战场ID不一致，停止操作");
    }
    // Only the matched request response can provide this consistency check.
    // A broadcast for another player must never establish our identity.
    const checkIdentity = () => {
      if (Number(body?.roleCodeId) > 0 && this.selfCodeId && String(body.roleCodeId) !== String(this.selfCodeId)) {
        throw new Error("盐场进场响应与本人映射冲突，停止操作");
      }
    };
    checkIdentity();
    this.initializeSelf(mainRole);
    if (this.entryProblem()) {
      try { await this.refresh(); }
      catch (error) { throw new Error(`盐场进场补查失败：${error.message}（${this.entryDiagnostic(true)}）`); }
      checkIdentity();
      this.initializeSelf(mainRole);
      const problem = this.entryProblem();
      if (problem) throw new Error(`盐场${problem}，停止操作（${this.entryDiagnostic(true)}）`);
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
  self() { return get(this.battlefield?.roles, this.selfCodeId) || (String(this.watchingSelf?.codeIdV2) === String(this.selfCodeId) ? this.watchingSelf : undefined); }
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
