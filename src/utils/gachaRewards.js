// 官方 GachaAccumRewardConf；ResidentGachaRewardDialog._canClaimStageReward。
export const GACHA_REWARD_STAGES = [
  {
    "id": 1,
    "num": 10
  },
  {
    "id": 2,
    "num": 20
  },
  {
    "id": 3,
    "num": 30
  },
  {
    "id": 4,
    "num": 40
  },
  {
    "id": 5,
    "num": 50
  },
  {
    "id": 6,
    "num": 60
  },
  {
    "id": 7,
    "num": 70
  },
  {
    "id": 8,
    "num": 80
  },
  {
    "id": 9,
    "num": 90
  },
  {
    "id": 10,
    "num": 100
  }
];

export const gachaBody = result => result?._raw?.body ?? result?.body ?? result;

export function getClaimableGachaStages(state) {
  const count = state?.stageGachaCnt;
  if (!Number.isSafeInteger(count) || count < 0 || !state?.claimedStageIdMap || typeof state.claimedStageIdMap !== "object") {
    throw new Error("未获取到完整扭蛋次数和领取状态");
  }
  return GACHA_REWARD_STAGES.filter(stage => count >= stage.num && !state.claimedStageIdMap[stage.id]);
}
