import { isDungeonOpen } from "./dreamConstants.js";

export const DREAM_HERO_ID = 107;
export const DREAM_PUSH_LIMIT = 195;

/** 与 Token 日常配置共用同一开关及存储键，旧配置保持默认启用。 */
export function isDreamEnabled(tokenId, storage = globalThis.localStorage) {
  const raw = storage?.getItem(`daily-settings:${tokenId}`);
  return !raw || JSON.parse(raw).dreamEnable !== false;
}

export function getDreamPeriod(now = new Date()) {
  const date = new Date(now.getTime() + 8 * 3600000);
  const day = date.getUTCDay();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (day >= 3 ? day - 3 : day));
  return (date.getTime() - 8 * 3600000) / 1000;
}

const errorCode = (error) => Number(String(error?.message || "").match(/(?:服务器错误:\s*)?(260\d{4})/)?.[1]);

export function getDreamHeroes(dungeon) {
  return Object.values(dungeon?.battleTeam || {})
    .filter((hero) => hero && Number(hero.heroId) === DREAM_HERO_ID && Number(hero.hp) > 0)
    .sort((a, b) => Number(b.attack || 0) - Number(a.attack || 0));
}

/** 自动推层：只使用吕布，超过195层停止，不消耗复活道具。 */
export async function runDreamAutoPush({
  send, enabled = true, stopped = () => false, log = () => {},
  now = () => new Date(),
  pause = () => new Promise((resolve) => setTimeout(resolve, 500)),
  maxBattles = 1000,
}) {
  if (!enabled) return { status: "skipped", reason: "该 Token 已关闭梦境功能" };
  if (!isDungeonOpen(now())) return { status: "skipped", reason: "不在梦境开放时间（周日/周一/周三/周四）" };
  const period = getDreamPeriod(now());
  const check = () => {
    if (stopped()) throw new Error("自动梦境已停止");
    if (!isDungeonOpen(now()) || getDreamPeriod(now()) !== period) {
      throw new Error("梦境开放周期已变化，停止本次推层");
    }
  };
  const request = async (cmd, params = {}) => {
    check();
    const data = await send(cmd, params);
    await pause();
    check();
    return data;
  };
  const fetchRole = async () => {
    const data = await request("role_getroleinfo");
    if (!data?.role?.dungeon) throw new Error("未获取到梦境状态，可能尚未解锁");
    return data.role;
  };
  let role = await fetchRole();
  let dungeon = role.dungeon;
  if (Number(dungeon.beginTime) === period && Number(dungeon.id) > DREAM_PUSH_LIMIT) {
    return { status: "stopped", reason: "已超过195层，跳过推层，继续采购", initialFloor: Number(dungeon.id), floor: Number(dungeon.id), battles: 0 };
  }
  if (Number(dungeon.beginTime) !== period || !Object.values(dungeon.battleTeam || {}).some((h) => h?.heroId)) {
    const battleTeam = { 0: DREAM_HERO_ID };
    try {
      await request("dungeon_selecthero", { battleTeam });
    } catch (error) {
      check();
      if (errorCode(error) !== 2600040) throw error;
      log("梦境阵容已选定，读取当前进度继续");
    }
    role = await fetchRole();
    dungeon = role.dungeon;
  }
  if (Number(dungeon.beginTime) !== period) throw new Error("服务端梦境期次尚未更新，停止推层");
  const initialFloor = Number(dungeon.id);
  if (!Number.isInteger(initialFloor) || initialFloor < 0) throw new Error("梦境层数无效");
  const failures = new Map();
  let battles = 0;
  const result = (reason) => ({ status: "stopped", reason, initialFloor, floor: Number(dungeon.id), battles });
  log(`开始自动梦境，当前第 ${initialFloor} 层`);
  while (battles < maxBattles) {
    check();
    if (Number(dungeon.id) > DREAM_PUSH_LIMIT) return result("已超过195层，结束推层，继续采购");
    const heroes = getDreamHeroes(dungeon).filter((h) => (failures.get(h.heroId) || 0) < 3);
    const hero = heroes.find((h) => h.heroId === dungeon.activeHeroId) || heroes[0];
    if (!hero) return result("吕布未在本期阵容中、已阵亡或连续3次未推进，结束推层");
    const before = { floor: Number(dungeon.id), monster: dungeon.currMonsterId };
    let fightError;
    let fightResult;
    try {
      battles++;
      fightResult = await request("fight_startdungeon", { heroId: Number(hero.heroId) });
    } catch (error) {
      check();
      fightError = error;
    }
    // 战斗响应是增量数据，不能用它覆盖带有 heroId/hp 的完整阵容。
    role = await fetchRole();
    dungeon = role.dungeon;
    if (Number(dungeon.beginTime) !== period) throw new Error("梦境期次发生变化，停止推层");
    const floor = Number(dungeon.id);
    if (!Number.isInteger(floor) || floor < before.floor) throw new Error("梦境层数异常，停止推层");
    const advanced = floor > before.floor || dungeon.currMonsterId !== before.monster;
    if (fightError && !advanced) {
      if ([2600080, 2600050].includes(errorCode(fightError))) {
        return result(`服务端已限制继续挑战（${errorCode(fightError)}）`);
      }
      throw new Error(`梦境战斗结果无法确认，停止重试：${fightError.message}`);
    }
    if (advanced) {
      failures.clear();
      log(`梦境推进至第 ${floor} 层（本次已战斗 ${battles} 次）`);
    } else {
      failures.set(hero.heroId, (failures.get(hero.heroId) || 0) + 1);
      log(`英雄 ${hero.heroId} ${fightResult?.isWin === false ? "战败" : "未推进"}，仍在第 ${floor} 层`);
    }
  }
  return result(`已达到单次 ${maxBattles} 场上限`);
}

/** 跳过战斗上限仍需采购；关闭功能、非开放日或主动停止则不采购。 */
export async function runAutomaticDream({ purchase, ...options }) {
  const result = await runDreamAutoPush(options);
  if (result.status !== "skipped" && !options.stopped?.()) {
    options.log?.(`推层阶段结束：${result.reason}；开始自动采购`);
    await purchase();
  }
  return result;
}
