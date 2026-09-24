import { isDungeonOpen } from "./dreamConstants.js";

export const DREAM_HERO_ID = 107;
export const DREAM_PUSH_INTERVAL_MS = 3000;
export const DREAM_RATE_LIMIT_COOLDOWN_MS = 6000;
export const DREAM_FINAL_FLOOR = 200;

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

const errorCode = (error) => Number(
  String(error?.message || "").match(/(?:服务器错误:\s*)?(200400|260\d{4})/)?.[1],
);

export function getDreamHeroes(dungeon) {
  return Object.values(dungeon?.battleTeam || {})
    .filter((hero) => hero && Number(hero.heroId) === DREAM_HERO_ID && Number(hero.hp) > 0)
    .sort((a, b) => Number(b.attack || 0) - Number(a.attack || 0));
}

/** 通关后服务端会清空层数，但仍保留本期梦境商店。 */
export function isDreamCompleted(dungeon, period) {
  if (!dungeon || Number(dungeon.beginTime) !== Number(period)) return false;
  if (!dungeon.merchant) return false;

  const rawFloor = dungeon.id;
  const floor = Number(rawFloor);
  return (
    rawFloor === undefined ||
    rawFloor === null ||
    rawFloor === "" ||
    !Number.isInteger(floor) ||
    floor < 0
  );
}

/** 自动推层：只使用吕布，不消耗复活道具。 */
export async function runDreamAutoPush({
  send, enabled = true, stopped = () => false, log = () => {},
  initialRole = null,
  now = () => new Date(),
  pause = () =>
    new Promise((resolve) => setTimeout(resolve, DREAM_PUSH_INTERVAL_MS)),
  rateLimitPause = () =>
    new Promise((resolve) => setTimeout(resolve, DREAM_RATE_LIMIT_COOLDOWN_MS)),
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
  const fetchRoleAfterRateLimit = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await fetchRole();
      } catch (error) {
        if (errorCode(error) !== 200400) throw error;
        log(`梦境状态查询仍受限，等待 ${DREAM_RATE_LIMIT_COOLDOWN_MS / 1000} 秒后${attempt === 0 ? "重试查询" : "转入采购"}`);
        await rateLimitPause();
        check();
      }
    }
    return null;
  };
  const request = async (cmd, params = {}) => {
    check();
    const data = await send(cmd, params);
    check();
    return data;
  };
  const fetchRole = async () => {
    const data = await request("role_getroleinfo");
    if (!data?.role?.dungeon) throw new Error("未获取到梦境状态，可能尚未解锁");
    return data.role;
  };
  let role = initialRole?.dungeon ? initialRole : await fetchRole();
  let dungeon = role.dungeon;
  if (isDreamCompleted(dungeon, period)) {
    return {
      status: "stopped",
      reason: "梦境已通关，跳过推层，继续采购",
      initialFloor: DREAM_FINAL_FLOOR,
      floor: DREAM_FINAL_FLOOR,
      battles: 0,
    };
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
  const result = (reason, floor = Number(dungeon.id)) => ({
    status: "stopped",
    reason,
    initialFloor,
    floor,
    battles,
  });
  log(`开始自动梦境，当前第 ${initialFloor} 层`);
  while (battles < maxBattles) {
    check();
    const heroes = getDreamHeroes(dungeon).filter((h) => (failures.get(h.heroId) || 0) < 3);
    const hero = heroes.find((h) => h.heroId === dungeon.activeHeroId) || heroes[0];
    if (!hero) return result("吕布未在本期阵容中、已阵亡或连续3次未推进，结束推层");
    const before = { floor: Number(dungeon.id), monster: dungeon.currMonsterId };
    let rateLimitRetries = 0;
    while (true) {
      let fightError;
      let fightResult;
      try {
        battles++;
        fightResult = await request("fight_startdungeon", { heroId: Number(hero.heroId) });
      } catch (error) {
        check();
        fightError = error;
      }

      const limited = errorCode(fightError) === 200400;
      if (limited) {
        log(`梦境操作过快（200400），等待 ${DREAM_RATE_LIMIT_COOLDOWN_MS / 1000} 秒后核对进度`);
        await rateLimitPause();
        check();
      }

      // 战斗响应是增量数据，不能用它覆盖带有 heroId/hp 的完整阵容。
      role = await fetchRoleAfterRateLimit();
      if (!role) {
        return result("服务器持续限频，无法核对战斗结果，停止推层并继续采购");
      }
      dungeon = role.dungeon;
      if (isDreamCompleted(dungeon, period)) {
        return result(
          "梦境已通关，结束推层，继续采购",
          DREAM_FINAL_FLOOR,
        );
      }
      if (Number(dungeon.beginTime) !== period) throw new Error("梦境期次发生变化，停止推层");
      const floor = Number(dungeon.id);
      if (!Number.isInteger(floor) || floor < before.floor) throw new Error("梦境层数异常，停止推层");
      const advanced = floor > before.floor || dungeon.currMonsterId !== before.monster;
      if (fightError && !advanced) {
        const code = errorCode(fightError);
        if ([2600080, 2600050].includes(code)) {
          return result(`服务端已限制继续挑战（${code}）`);
        }
        if (code === 200400) {
          if (rateLimitRetries === 0 && battles < maxBattles) {
            rateLimitRetries++;
            log(`限频后层数未变化，等待 ${DREAM_PUSH_INTERVAL_MS / 1000} 秒后重试当前层`);
            await pause();
            check();
            continue;
          }
          await rateLimitPause();
          check();
          return result("重试后仍触发服务器限频，停止推层并继续采购");
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
      break;
    }
    if (battles < maxBattles) {
      await pause();
      check();
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
