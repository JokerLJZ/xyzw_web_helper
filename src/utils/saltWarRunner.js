import { entries, get, loadSaltMap, saltMapSpec, saltRoute } from "./saltWarMap.js";
import { saltBody } from "./saltWarSession.js";
export const DEFAULT_SALT_BATTLE_SETTINGS = Object.freeze({ maxDiamondCost: 20, maxSpeedUps: 1, waitTimeoutSeconds: 180 });
export function saltSettings(value = {}) {
  const integer = (key, max) => { const n = Number(value[key] ?? DEFAULT_SALT_BATTLE_SETTINGS[key]); if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error("盐场预算、次数或等待时间无效"); return n; };
  const result = { maxDiamondCost: integer("maxDiamondCost", 10000), maxSpeedUps: integer("maxSpeedUps", 1), waitTimeoutSeconds: integer("waitTimeoutSeconds", 900) };
  if (result.waitTimeoutSeconds < 10) throw new Error("盐场最长等待至少10秒");
  return result;
}
export function createSaltJournal(storage = globalThis.localStorage) {
  return {
    read(accountId, key) { if (!storage) throw new Error("无法保存盐场执行记录"); return JSON.parse(storage.getItem(`xyzw:salt-once:${accountId}`) || "{}")[key] || {}; },
    write(accountId, key, value) {
      if (!storage) throw new Error("无法保存盐场执行记录");
      const all = JSON.parse(storage.getItem(`xyzw:salt-once:${accountId}`) || "{}");
      all[key] = value;
      storage.setItem(`xyzw:salt-once:${accountId}`, JSON.stringify(all));
    },
  };
}
export function saltFormation(role) {
  const battleTeam = new Map(entries(role.battleTeam).map(([slot, hero]) => [Number(slot), Number(hero?.heroId)]));
  if (!battleTeam.size || [...battleTeam].some(([slot, id]) => !Number.isInteger(slot) || slot < 0 || slot > 4 || !Number.isSafeInteger(id) || id <= 0)) throw new Error("当前主线阵容为空或格式异常");
  const lordWeaponId = Number(role.lordWeaponId ?? 0), petUId = role.pet?.petUId ?? role.petData?.petUId ?? "";
  if (!Number.isSafeInteger(lordWeaponId) || lordWeaponId < 0 || typeof petUId !== "string") throw new Error("主线玩具或宠物数据异常");
  return { battleTeam, lordWeaponId, petUId };
}
export function saltInfo(entry, now) {
  const body = saltBody(entry), info = body?.info;
  if (!info?.battlefieldId || !info.phase) throw new Error("当前没有可参加的盐场");
  if (!info.canEnterWar) throw new Error("当前账号不具备盐场进入资格");
  const end = Number(info.endTime) * 1000, ready = Number(info.readyTime) * 1000;
  if (!Number.isFinite(end) || end <= now || !Number.isFinite(ready) || ready > now) throw new Error("当前不在盐场可进入时段");
  if (!Number.isFinite(Number(info.startTime)) || Number(info.startTime) <= 0) throw new Error("盐场开始时间不完整");
  return info;
}
export const saltPosition = (field, self) => Number(self?.position?.x) === -1 ? get(field.legions, self.legionID)?.position : self?.position;
export function saltConstant(session, config, key) {
  const value = Number(get(session.battlefield?.constant, key.replace(/^legionWar/, "")) ?? config.ConstantConf?.[key]);
  if (!Number.isFinite(value) || value < 0) throw new Error(`盐场参数缺失：${key}`);
  return value;
}
export function assertSaltSolo(session, now) {
  const self = session.self();
  if (!self || !Number.isSafeInteger(Number(self.legionID)) || Number(self.legionID) <= 0) throw new Error("盐场本人军团信息不完整");
  const team = entries(session.battlefield.teamMap).map(([, t]) => t).find(t => t.mCodeIds?.some(id => String(id) === String(session.selfCodeId)));
  if (team?.mCodeIds?.length > 1) throw new Error("当前是多人队伍，单人盐场任务已跳过");
  if (Number(self.teamLimitTime) * 1000 > now || Number(self.custom?.teaming) * 1000 > now) throw new Error("盐场出战正在组队或冷却，稍后重试");
  return self;
}
const buildingId = b => String(b.id ?? `${b.position?.x}_${b.position?.y}`);
function buildingType(map, b) {
  const p = b?.position;
  if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x >= map.width || p.y >= map.height) return null;
  return map.types[map.layers.building[p.y * map.width + p.x]];
}
export function saltTargetAllowed({ session, map, config, target, now, atTarget = false }) {
  const f = session.battlefield, self = session.self(), id = buildingId(target), type = buildingType(map, target);
  if (!type || type === 4 || type === 6 || Number(target.belongsLegionId) === Number(self.legionID) || !(Number(target.hP) > 0)) return false;
  const rules = entries(config.LegionWarBuildingConf).map(([, v]) => v).find(v => Number(v.legionWarType) === Number(f.type ?? session.info.type) && Number(v.legionWarMapType) === Number(session.info.legionWarMapType) && Number(v.buildingId) === Number(type));
  if (!rules) return false;
  const open = Number(f.openTime ?? session.info.startTime) * 1000;
  if (!Number.isFinite(open) || now <= open + Number(rules.protectTime || 0) * 1000 || (Number(rules.closeTime) > 0 && now >= open + Number(rules.closeTime) * 1000)) return false;
  // Conservative first version: no pending battles or other faction defenders/attackers.
  if (entries(target.battleQueue).length || entries(target.marches).some(([marchId]) => Number(get(f.marches, marchId)?.codeId) !== Number(session.selfCodeId))) return false;
  const members = entries(target.memberV2).map(([code]) => get(f.roles, code));
  if (members.some(v => !v || Number(v.legionID) !== Number(self.legionID))) return false;
  const position = saltPosition(f, self);
  if (atTarget && (!entries(target.memberV2).some(([code]) => String(code) === String(session.selfCodeId)) || self.state !== "idle" || !position || `${position.x}_${position.y}` !== id)) return false;
  return !!position && id !== "undefined_undefined";
}
export function nearestSaltTarget(session, map, config, now) {
  const self = session.self(), position = saltPosition(session.battlefield, self);
  if (!position || !Number.isInteger(position.x) || !Number.isInteger(position.y)) throw new Error("盐场角色位置不完整");
  return entries(session.battlefield.buildingData).map(([, target]) => {
    if (!target?.position || !saltTargetAllowed({ session, map, config, target, now })) return null;
    const route = saltRoute(map, session.battlefield.buildingData, self.legionID, position, target.position);
    return route.length ? { target, route, id: buildingId(target) } : null;
  }).filter(Boolean).sort((a, b) => a.route.length - b.route.length || a.id.localeCompare(b.id))[0] || null;
}
function ownMarch(session) { return entries(session.battlefield.marches).map(([, m]) => m).find(m => Number(m.codeId) === Number(session.selfCodeId)); }
function formationMatches(self, formation) {
  const actual = entries(self.battleTeam).map(([k, v]) => [Number(k), Number(typeof v === "object" ? v.heroId : v)]).sort((a, b) => a[0] - b[0]);
  const wanted = [...formation.battleTeam].sort((a, b) => a[0] - b[0]);
  return JSON.stringify(actual) === JSON.stringify(wanted) && Number(self.lordWeaponId ?? 0) === formation.lordWeaponId && (self.petUId ?? "") === formation.petUId;
}
export async function previewSaltBattle({ send, session, info, config, role, now, loadMap = loadSaltMap }) {
  saltMapSpec(info, config);
  const self = assertSaltSolo(session, now());
  const map = await loadMap(info, config);
  const target = nearestSaltTarget(session, map, config, now());
  const cost = saltConstant(session, config, "legionWarSpeedCost");
  saltFormation(role);
  return { battlefieldId: info.battlefieldId, phase: info.phase, state: session.battlefield.state, playerState: self.state, targetId: target?.id || "暂无合法地块", distance: target ? Math.max(0, target.route.length - 1) : null, speedCost: cost, mapVersion: map.version };
}
// Actions are journaled BEFORE send. Uncertain writes are queried once, never replayed.
export async function runSaltBattle({ accountId, session, info, config, role, send, now = Date.now, shouldStop = () => false, sleep = ms => new Promise(r => setTimeout(r, ms)), settings = {}, journal = createSaltJournal(), loadMap = loadSaltMap, log = () => {} }) {
  const options = saltSettings(settings), key = `${info.phase}:${info.battlefieldId}`;
  let record = journal.read(accountId, key);
  const save = patch => { record = { ...record, ...patch, updatedAt: now() }; journal.write(accountId, key, record); };
  if (record.status === "completed") return { status: "completed", reason: "本场盐场已完成一次攻击，跳过重复执行" };
  const deadline = now() + options.waitTimeoutSeconds * 1000;
  const check = () => {
    session.check();
    if (shouldStop()) throw new Error("盐场任务已停止");
    if (now() >= deadline) throw new Error("盐场等待超时，执行记录已保留，不自动重发动作");
    if (now() >= Number(info.endTime) * 1000 || session.battlefield.state === "ended") throw new Error("本场盐场已结束");
  };
  const refresh = async () => { check(); await session.refresh(); assertSaltSolo(session, now()); check(); };
  const waitFor = async predicate => {
    while (true) { check(); await session.pending; const value = predicate(); if (value) return value; await sleep(1000); await refresh(); }
  };
  const write = async (command, params, stage) => {
    check();
    save({ stage });
    try { return await session.send(command, params); }
    catch (error) { await session.refresh().catch(() => {}); throw new Error(`${error.message}；结果待核实，已停止且不自动重发`); }
  };
  await refresh();
  const self = assertSaltSolo(session, now());
  if (record.stage === "attack" || record.battleId) {
    const ended = session.ends.get(String(record.battleId));
    if (ended && String(ended.roleCodeId) === String(session.selfCodeId) && ended.buildingId === record.targetId && Number(ended.hP) >= 0) { save({ status: "completed" }); return { status: "completed", reason: "本场攻击结算已确认" }; }
    return { status: "pending", reason: "本场已有一次攻击请求，结果待核实，不追加攻击" };
  }
  if (["die", "resurrect", "over", "teaming", "observing"].includes(self.state)) return { status: "skipped", reason: "盐场角色当前不能参战，不自动复活或修改队伍" };
  while (session.battlefield.state !== "started") { check(); await sleep(1000); await refresh(); }
  const map = await loadMap(info, config);
  check();
  if (["saveFormation", "deploy"].includes(record.stage) && session.self().state === "idle") {
    if (!record.formation) return { status: "pending", reason: "上次出战阵容未保存，结果待核实" };
    const wanted = { ...record.formation, battleTeam: new Map(record.formation.team) };
    const current = await session.send("war_getteaminfo", { roleCodeId: session.selfCodeId });
    if (!formationMatches({ ...session.self(), battleTeam: current?.teamInfo }, wanted)) return { status: "pending", reason: "上次出战阵容未确认，不继续移动" };
    save({ stage: "deployed" });
  }
  if (session.self().state === "watching") {
    if (["saveFormation", "deploy"].includes(record.stage)) return { status: "pending", reason: "上次盐场布阵结果待核实，不重复提交" };
    const formation = saltFormation(role);
    save({ formation: { team: [...formation.battleTeam], lordWeaponId: formation.lordWeaponId, petUId: formation.petUId } });
    await write("war_teamsetbattleteam", formation, "saveFormation");
    await write("war_setbattleteam", formation, "deploy");
    await waitFor(() => session.self()?.state === "idle");
    const deployed = await session.send("war_getteaminfo", { roleCodeId: session.selfCodeId });
    if (!formationMatches({ ...session.self(), battleTeam: deployed?.teamInfo }, formation)) throw new Error("盐场阵容、玩具或宠物未确认，停止后续操作");
    save({ stage: "deployed" });
    log("已复制主线武将、玩具和宠物并确认盐场出战");
  } else if (session.self().state === "combat") return { status: "pending", reason: "当前已有战斗，跳过追加攻击" };
  const availableEnergy = Number(session.self().energy);
  if (!Number.isFinite(availableEnergy) || availableEnergy < saltConstant(session, config, "legionWarStrengthWall")) return { status: "skipped", reason: "盐场体力不足，不行军或消耗金砖" };
  let target;
  let march = ownMarch(session);
  if (record.stage === "march" && !march) return { status: "pending", reason: "上次行军结果待核实，不重复发起" };
  if (march) {
    const targetId = `${march.to.x}_${march.to.y}`;
    if (record.targetId !== targetId) return { status: "skipped", reason: "当前已有其他行军，保持原操作" };
    target = { id: targetId, target: get(session.battlefield.buildingData, targetId) };
  } else {
    if (session.self().state !== "idle") throw new Error("盐场出战状态未确认");
    target = nearestSaltTarget(session, map, config, now());
    if (!target) return { status: "skipped", reason: "没有可达且可直接攻城的非己方地块" };
    const pos = saltPosition(session.battlefield, session.self());
    save({ targetId: target.id });
    if (`${pos.x}_${pos.y}` !== target.id) {
      await write("war_startmarch", { target: target.target.position }, "march");
      march = await waitFor(() => {
        const active = ownMarch(session), p = saltPosition(session.battlefield, session.self());
        return active || (session.self().state === "idle" && p && `${p.x}_${p.y}` === target.id ? { arrived: true } : null);
      });
      if (march.arrived) { march = null; save({ stage: "arrived" }); }
      else save({ stage: "moving", marchId: march.id });
      log(`向最近合法地块 ${target.id} 行军，路径${target.route.length - 1}格`);
    }
  }
  if (march) {
    const id = march.id;
    const cost = saltConstant(session, config, "legionWarSpeedCost");
    const minRemaining = saltConstant(session, config, "legionWarMoveTimeLowerLimit") * 1000;
    const remaining = Number(march.endTime) * 1000 - now();
    if (!Number.isFinite(remaining)) throw new Error("行军结束时间缺失");
    if ((record.speedUps || 0) < options.maxSpeedUps && remaining >= minRemaining && (record.spent || 0) + cost <= options.maxDiamondCost) {
      const latest = saltBody(await send("role_getroleinfo", {}))?.role;
      if (!latest || !Number.isFinite(Number(latest.diamond))) throw new Error("未取得金砖库存，不执行加速");
      if (Number(latest.diamond) >= cost) {
        // Reserve budget even if the request times out; never spend it twice.
        save({ speedUps: (record.speedUps || 0) + 1, spent: (record.spent || 0) + cost });
        await write("war_speedup", { marchId: id }, "speed");
        await refresh();
        save({ stage: "moving" });
        log(`已执行一次行军加速，预留本场金砖支出${record.spent}/${options.maxDiamondCost}`);
      } else log("金砖不足，等待自然到达");
    } else log("加速次数、预算或剩余时间不满足，等待自然到达");
    await waitFor(() => {
      const self = session.self(), pos = saltPosition(session.battlefield, self);
      if (!ownMarch(session) && ["die", "over", "combat"].includes(self.state)) throw new Error("行军后角色状态变化，停止追加操作");
      return self.state === "idle" && pos && `${pos.x}_${pos.y}` === target.id && !ownMarch(session);
    });
    save({ stage: "arrived" });
  }
  await refresh();
  const currentTarget = get(session.battlefield.buildingData, target.id);
  if (!currentTarget || !saltTargetAllowed({ session, map, config, target: currentTarget, now: now(), atTarget: true })) return { status: "skipped", reason: "到达后地块归属、守军或争抢状态变化，未发起攻击" };
  const energy = Number(session.self().energy), wallCost = saltConstant(session, config, "legionWarStrengthWall");
  if (!Number.isFinite(energy) || energy < wallCost) return { status: "skipped", reason: "盐场体力不足，未发起攻击" };
  const result = await write("war_startattackbuilding", { buildingId: target.id }, "attack");
  const battleId = result?.battleInfo?.id;
  if (battleId === undefined || String(result.roleCodeId) !== String(session.selfCodeId) || result.buildingId !== target.id) throw new Error("攻击响应身份或战斗编号未确认，已停止且不自动重发");
  save({ battleId, targetId: target.id, status: "pending" });
  log(`地块 ${target.id} 已发起一次攻击，等待结算`);
  await waitFor(() => {
    const ended = session.ends.get(String(battleId));
    if (!ended || String(ended.roleCodeId) !== String(session.selfCodeId) || ended.buildingId !== target.id) return false;
    if (!(Number(ended.hP) >= 0)) throw new Error("本次地块攻击被取消，不追加攻击");
    return ended;
  });
  save({ status: "completed" });
  return { status: "completed", reason: `地块 ${target.id} 一次攻击已结算，本场累计预留加速支出${record.spent || 0}金砖` };
}
