import { bon } from "./bonProtocol.js";
import { extractRolePatch } from "./roleSnapshot.js";

export const SHOE_ID = 2;
export const TOY_REWARD_RECORD = "lord:weapon:claim:open:reward";
const get = (map, key) => map instanceof Map ? (map.get(key) ?? map.get(String(key))) : map?.[key];
const entries = map => map instanceof Map ? [...map] : Object.entries(map || {});
const values = map => entries(map).map(([, value]) => value);
const cache = new Map();
const number = (value, label) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label}数据异常`);
  return n;
};
const toy = role => get(role.lordWeapon, SHOE_ID);
const level = skill => number(skill?.level ?? 1, "技能等级");
const stock = (role, id) => number(get(role.items, id)?.quantity ?? 0, "道具库存");

/** 当前官方加载器用 BON configc.bin；JSON config.json 不包含玩具表。 */
export async function loadShoeToyConfig(send, fetcher = globalThis.fetch) {
  const response = await send("system_getdatabundlever", { isAudit: false });
  const body = response?._raw?.body || response?.body || response?.data || response;
  const version = body?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) throw new Error("未取得玩具配置版本");
  if (!cache.has(version)) {
    const loading = (async () => {
      const response = await fetcher(`https://xxz-xyzw-res.hortorgames.com/data/${version}/configc.bin`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("玩具配置下载失败");
      return validateShoeToyConfig({ ...bon.decode(new Uint8Array(await response.arrayBuffer())), version });
    })();
    cache.set(version, loading);
    loading.catch(() => cache.delete(version));
  }
  return cache.get(version);
}

export function validateShoeToyConfig(config) {
  const weapon = get(config.WeaponConf, SHOE_ID);
  if (!weapon || weapon.passiveSkill?.length !== 4 || weapon.passiveSkillUnlock?.length !== 4) throw new Error("皮鞋被动配置不完整");
  number(weapon.maxLevel, "玩具上限");
  number(weapon.passiveLimit, "被动前置等级");
  for (const [index, id] of weapon.passiveSkill.entries()) {
    number(weapon.passiveSkillUnlock[index], "被动星级门槛");
    const row = get(config.WeaponPassiveConf, id);
    if (row?.weaponId !== SHOE_ID || !Array.isArray(row.costItemNum) || !Array.isArray(row.coinCost)) throw new Error("皮鞋被动费用配置不完整");
    number(row.passiveMaxLevel, "被动上限");
  }
  if (!values(config.WeaponActiveConf).some(row => row.weaponId === SHOE_ID)) throw new Error("皮鞋主动配置不完整");
  return config;
}

/** 仅统计实际 battleTeam；候选按现有星级降序，同星优先保留在阵武将。 */
export function planShoePassiveFormation(role, config) {
  const weapon = get(config.WeaponConf, SHOE_ID);
  const current = entries(role.battleTeam).map(([slot, member]) => ({
    slot: number(slot, "阵容位置"), heroId: Number(member?.heroId ?? member),
  }));
  if (current.length > 5 || current.some(member => member.slot > 4 || !get(role.heroes, member.heroId))) throw new Error("主线阵容数据异常");
  const currentIds = new Set(current.map(member => member.heroId));
  const candidates = entries(role.heroes).map(([id, hero]) => ({
    heroId: number(hero.heroId ?? hero.id ?? id, "武将编号"), star: number(hero.star ?? 0, "武将星级"),
  })).sort((a, b) => b.star - a.star || Number(currentIds.has(b.heroId)) - Number(currentIds.has(a.heroId)) || a.heroId - b.heroId).slice(0, 5);
  const currentStars = current.reduce((sum, hero) => sum + number(get(role.heroes, hero.heroId)?.star ?? 0, "武将星级"), 0);
  const maxStars = candidates.reduce((sum, hero) => sum + hero.star, 0);
  const missing = weapon.passiveSkill.map((skillId, index) => ({ skillId, required: weapon.passiveSkillUnlock[index] }))
    .filter(row => !get(toy(role)?.passiveSkill, row.skillId));
  const reachable = missing.filter(row => row.required <= maxStars);
  const needsChange = reachable.some(row => row.required > currentStars);
  const selected = new Set(candidates.map(hero => hero.heroId));
  const target = current.filter(hero => selected.has(hero.heroId));
  const used = new Set(target.map(hero => hero.slot));
  for (const hero of candidates) {
    if (target.some(member => member.heroId === hero.heroId)) continue;
    const slot = [0, 1, 2, 3, 4].find(slot => !used.has(slot));
    target.push({ heroId: hero.heroId, slot });
    used.add(slot);
  }
  return { currentStars, maxStars, reachable, unreachable: missing.filter(row => row.required > maxStars), needsChange, targetHeroes: target };
}

/** 每个账号独立快照；每次写操作后查询确认，未知结果不重发。 */
export async function runShoeToyUpgrade({ send, queryRole, config, applyFormation, restoreFormation, shouldStop = () => false, log = () => {} }) {
  validateShoeToyConfig(config);
  let role;
  let restoreNeeded = false;
  let failure;
  let result;
  let activeUpgraded = 0;
  let passiveUpgraded = 0;
  const stopped = () => {
    if (shouldStop()) throw Object.assign(new Error("任务已停止"), { stopped: true });
  };
  const refresh = async () => {
    const response = await queryRole();
    role = extractRolePatch(response);
    if (!role?.heroes || !role?.items || !role?.lord || !role?.statistics || !role?.battleTeam) throw new Error("未取得该账号完整角色状态");
    return role;
  };
  const write = async (command, params, applied, label) => {
    stopped();
    let error;
    try { await send(command, params); } catch (caught) {
      if (caught.stopped) throw caught;
      error = caught;
    }
    await refresh();
    if (!applied(role)) throw new Error(`${label}未确认${error ? `：${error.message || error}` : ""}，停止且不重发`);
    if (error) log(`${label}请求异常，查询确认已生效`);
  };
  const weapon = get(config.WeaponConf, SHOE_ID);
  try {
    stopped();
    await refresh();
    const conditions = weapon.condition || [];
    const requiredLevel = conditions.find(row => row.type === 2)?.value;
    if (!requiredLevel) throw new Error("未识别皮鞋开放条件");
    if (number(role.lord.level, "主公等级") < requiredLevel) {
      log(`主公未达到${requiredLevel}级，跳过皮鞋玩具`);
      return { skipped: true };
    }
    stopped();
    await send("lordweapon_get", {});
    await refresh();
    if (number(get(role.statistics, TOY_REWARD_RECORD) ?? 0, "礼包领取记录") <= 0) {
      await write("lordweapon_claimopenreward", {}, state => Number(get(state.statistics, TOY_REWARD_RECORD)) > 0, "阿咸的玩具礼包领取");
      log(`已确认领取玩具界面礼包，当前扳手${stock(role, 1026)}个`);
    } else log("阿咸的玩具礼包已领取，跳过");
    if (!toy(role)) {
      const cost = weapon.unlockCost;
      if (cost?.type !== 3 || cost.itemId !== 1026) throw new Error("未识别皮鞋激活费用");
      if (stock(role, cost.itemId) < number(cost.value, "激活费用")) {
        log(`扳手不足${cost.value}个，跳过皮鞋激活`);
        return { skipped: true };
      }
      await write("lordweapon_unlock", { weaponId: SHOE_ID }, state => !!toy(state), "皮鞋激活");
    }
    restoreNeeded = true;
    // 官方说明：解锁后需装配该玩具才生效；界面升级也使用当前lordWeaponId。
    if (Number(role.lordWeaponId) !== SHOE_ID) {
      await write("lordweapon_changedefaultweapon", { weaponId: SHOE_ID }, state => Number(state.lordWeaponId) === SHOE_ID, "皮鞋装配");
    }
    log(`皮鞋当前${level(toy(role))}级，扳手${stock(role, 1026)}个，按配置升级主动技能`);
    while (level(toy(role)) < weapon.maxLevel) {
      stopped();
      const before = level(toy(role));
      const row = values(config.WeaponActiveConf).find(row => row.weaponId === SHOE_ID && row.weaponLevel === before);
      if (!row?.activeCost?.length) throw new Error("未取得当前主动升级费用");
      if (!row.activeCost.every(cost => cost.type === 3 && stock(role, cost.itemId) >= number(cost.value, "主动费用"))) break;
      await write("lordweapon_upgradeactiveskilllevel", { weaponId: SHOE_ID }, state => level(toy(state)) === before + 1, "皮鞋主动升级");
      activeUpgraded++;
      if (activeUpgraded % 10 === 0) log(`皮鞋主动已升级${activeUpgraded}次，当前${level(toy(role))}级`);
    }
    stopped();
    const plan = planShoePassiveFormation(role, config);
    log(`当前上阵总星级${plan.currentStars}，最高可达${plan.maxStars}；可新增开放${plan.reachable.length}个被动`);
    for (const row of plan.unreachable) log(`被动${row.skillId}需${row.required}星，尚差${row.required - plan.maxStars}星，跳过激活`);
    if (plan.needsChange) {
      stopped();
      await applyFormation(plan.targetHeroes);
      stopped();
      await refresh();
      const actual = planShoePassiveFormation(role, config).currentStars;
      if (actual < Math.max(...plan.reachable.map(row => row.required))) throw new Error("换阵后上阵星级未达目标");
      log(`高星阵容已确认，上阵总星级${actual}`);
    }
    if (plan.reachable.length) {
      stopped();
      // 模拟进入玩具界面的get；没有独立的“解锁被动”协议或激活按钮。
      await send("lordweapon_get", {});
      await refresh();
      const missing = plan.reachable.filter(row => !get(toy(role)?.passiveSkill, row.skillId));
      if (missing.length) throw new Error(`星级达标但被动${missing.map(row => row.skillId).join("、")}尚未返回开放状态，触发条件待核实`);
      log(`已确认新增开放${plan.reachable.length}个被动`);
    }
    for (const [index, skillId] of weapon.passiveSkill.entries()) {
      const row = get(config.WeaponPassiveConf, skillId);
      while (get(toy(role)?.passiveSkill, skillId)) {
        stopped();
        const skills = toy(role).passiveSkill;
        const before = level(get(skills, skillId));
        if (before >= row.passiveMaxLevel) break;
        if (index > 0 && (!get(skills, weapon.passiveSkill[index - 1]) || level(get(skills, weapon.passiveSkill[index - 1])) < weapon.passiveLimit)) {
          log(`被动${skillId}的前一被动未达${weapon.passiveLimit}级，跳过升级`);
          break;
        }
        const iron = number(row.costItemNum[before], "被动精铁费用");
        const gold = number(row.coinCost[before], "被动金币费用");
        if (stock(role, row.costItemId) < iron || (gold > 0 && number(role.gold ?? 0, "金币") < gold)) break;
        await write("lordweapon_upgradepassiveskilllevel", { weaponId: SHOE_ID, skillId }, state => level(get(toy(state)?.passiveSkill, skillId)) === before + 1, `被动${skillId}升级`);
        passiveUpgraded++;
      }
    }
    result = { activeUpgraded, passiveUpgraded, finalLevel: level(toy(role)), openedPassiveCount: entries(toy(role)?.passiveSkill).length };
  } catch (error) {
    failure = error;
  } finally {
    if (restoreNeeded) {
      try {
        log("正在恢复推图默认阵容");
        await restoreFormation(); // 停止只中断升级，恢复阶段不受停止标记影响。
        log("推图默认阵容已恢复并校验");
      } catch (error) {
        failure = new Error(`${failure ? `${failure.message}；` : ""}恢复推图默认阵容失败：${error.message || error}`);
      }
    }
  }
  if (failure) throw failure;
  return result;
}
