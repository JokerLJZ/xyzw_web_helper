export const DEFAULT_WEIRD_TOWER_CLIMB_COUNT = 20;

export function normalizeWeirdTowerClimbCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0
    ? Math.min(1000, Math.max(1, Math.trunc(count)))
    : DEFAULT_WEIRD_TOWER_CLIMB_COUNT;
}

// 抓包：怪异塔/怪异塔爬塔Z.txt。towerId=130、rewardTowerId=12 时可领取第13章。
// claimreward 仅增量返回 evoTower.rewardTowerId，不能替换完整塔状态。
export async function claimPendingEvoTowerRewards({ send, tower, shouldStop = () => false, onClaim = () => {} }) {
  const completed = Math.floor(Number(tower?.towerId) / 10);
  let claimed = Number(tower?.rewardTowerId ?? 0);
  if (!Number.isSafeInteger(completed) || completed < 0 || !Number.isSafeInteger(claimed) || claimed < 0) {
    throw new Error("怪异塔章节数据不完整，请刷新后重试");
  }
  while (claimed < completed && !shouldStop()) {
    const result = await send("evotower_claimreward", {});
    const next = Number(result?.evoTower?.rewardTowerId);
    if (!Number.isSafeInteger(next) || next <= claimed || next > completed) {
      throw new Error("怪异塔章节奖励未确认领取，已停止爬塔");
    }
    claimed = next;
    tower.rewardTowerId = claimed;
    onClaim(claimed);
  }
  return claimed;
}
