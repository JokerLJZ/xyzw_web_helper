export const HERO_STAR_FRAGMENT_COSTS = [
  8, 8, 8, 8, 8,
  40, 40, 40, 40, 40,
  80, 80, 80, 80, 80,
  200, 200, 200, 200, 200,
  400, 400, 400, 400, 400,
  400, 400, 400, 400, 400,
];

/**
 * 根据初始武将及碎片状态制定“合成后升星”计划。
 * 未拥有武将时，第一笔0星碎片消耗用于合成，不计作升星。
 */
export function planHeroStarUpgrade({ heroId, hero, fragmentQuantity }) {
  const currentStar = Number(hero?.star) || 0;
  let fragments = Math.max(0, Number(fragmentQuantity) || 0);
  let needsSynthesis = false;

  if (!hero) {
    const synthesisCost = Number(HERO_STAR_FRAGMENT_COSTS[0]) || 0;
    if (synthesisCost <= 0 || fragments < synthesisCost) {
      return { heroId, currentStar, upgradeCount: 0, needsSynthesis };
    }
    fragments -= synthesisCost;
    needsSynthesis = true;
  }

  let upgradeCount = 0;
  for (let star = currentStar; star < 30; star += 1) {
    const cost = Number(HERO_STAR_FRAGMENT_COSTS[star]) || 0;
    if (cost <= 0 || fragments < cost) break;
    fragments -= cost;
    upgradeCount += 1;
  }

  return { heroId, currentStar, upgradeCount, needsSynthesis };
}
