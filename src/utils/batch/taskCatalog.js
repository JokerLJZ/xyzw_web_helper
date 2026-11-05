// Explicit approved groups shared by the classic page and scheduled task picker.
export const TASK_GROUPS = [
  {
    "name": "daily",
    "label": "日常与领取",
    "tasks": [
      "startBatch",
      "claimHangUpRewards",
      "batchAddHangUpTime",
      "resetBottles",
      "batchlingguanzi",
      "collection_claimfreereward",
      "batchStudy"
    ]
  },
  {
    "name": "dungeon",
    "label": "副本与挑战",
    "tasks": [
      "climbTower",
      "batchWeirdTower",
      "batchmengjing",
      "batcharenafight",
      "batchGenieSweep",
      "climbWeirdTower",
      "batchUseItems",
      "batchMergeItems",
      "batchClaimFreeEnergy"
    ]
  },
  {
    "name": "club",
    "label": "俱乐部与赛事",
    "tasks": [
      "batchclubsign",
      "batchSaltSignup",
      "batchSaltBattle",
      "batchCampSignup",
      "batchCampChallenge",
      "batchCampfireLottery",
      "batchPeachSignup",
      "batchClaimPeachTasks",
      "batchGoldenCheer",
      "batchWarGuessCheer",
      "batchFootballBet",
      "batchApexGuess"
    ]
  },
  {
    "name": "shop",
    "label": "商店与采购",
    "tasks": [
      "store_syncpurchaseconfig",
      "store_purchase",
      "legion_storebuygoods",
      "legionStoreBuyWhiteJade",
      "legionStoreBuySkinCoins",
      "batchCheerShopPurchase",
      "batchBuyDreamItems"
    ]
  },
  {
    "name": "monthly",
    "label": "月度补齐",
    "tasks": [
      "batchTopUpFish",
      "batchTopUpArena"
    ]
  },
  {
    "name": "weekly",
    "label": "周常与限时活动",
    "tasks": [
      "batchClaimWeeklyActivityBenefit",
      "batchSmartBoxWeekly",
      "batchSmartRecruitWeekly",
      "batchSmartBlackMarketWeekly",
      "batchRechargeStandard",
      "batchRechargeExchange",
      "batchPhotoStandard",
      "batchPhotoExchange",
      "batchXuanwuBlessing",
      "batchClaimConsumptionRewards",
      "batchUseConsumptionActivityItems",
      "skinChallenge"
    ]
  },
  {
    "name": "resource",
    "label": "资源管理",
    "tasks": [
      "batchOpenBox",
      "batchOpenBoxByPoints",
      "batchClaimBoxPointReward",
      "batchFish",
      "batchRecruit"
    ]
  },
  {
    "name": "growth",
    "label": "武将与图鉴",
    "tasks": [
      "batchHeroLevelUpgrade",
      "batchAutoStarBook",
      "batchClaimCollectionRewards",
      "batchClaimCardCollectionRewards"
    ]
  },
  {
    "name": "formation",
    "label": "阵容管理",
    "tasks": [
      "batchAdjustEarlyMainLevelFormation",
      "batchAdjustMainLevelFormation"
    ]
  },
  {
    "name": "pet",
    "label": "宠物",
    "tasks": [
      "batchClaimGachaRewards",
      "batchActivatePetBooks",
      "batchMergePets",
      "batchEquipHighestLevelPet",
      "batchUpgradeAllPets"
    ]
  },
  {
    "name": "legacy",
    "label": "功法",
    "tasks": [
      "batchLegacyClaim",
      "batchLegacyBeginHangUp",
      "batchLegacyClaimChargeReward",
      "batchLegacyGiftSendEnhanced"
    ]
  },
  {
    "name": "small-account",
    "label": "小号任务",
    "tasks": [
      "batchAltMergeAndEquipPets",
      "batchPhotoWhiteJade",
      "batchUpgradeHangUpAndClaimOrderRewards",
      "batchJoinLegion",
      "batchUpgradeCrystal",
      "batchUpgradeEquipment",
      "batchAltAccountRefine",
      "batchBuyRedFeatherWithPearls",
      "batchBuyBaguaWithPearls",
      "batchBuyPearlFish",
      "batchReplaceBestFishArtifact",
      "batchUpgradeShoeToy",
      "batchChallengeGroupGenie",
      "batchChallengeThreeKingdomsGenie",
      "batchMaxWarriorLegionTech",
      "batchClaimAchievementRewards",
      "batchClaimMailAttachments",
      "batchAwakenHeroSkills",
      "batchTopUpGoldFish",
      "batchCheckSaltMasters",
      "batchPushMainLevelInfo",
      "batchUpgradeLordTo6000",
      "batchUseWarehouseItems",
      "batchExchangeXuanwuPetCookies",
      "batchRedeemCodes",
      "store_discount_purchase"
    ]
  }
];

export function groupTaskCatalog(tasks, query = '') {
  const keyword = query.trim().toLowerCase();
  const byId = new Map(tasks.map(task => [task.value, task]));
  const assigned = new Set(TASK_GROUPS.flatMap(group => group.tasks));
  const groups = TASK_GROUPS.map(group => ({ ...group, tasks: group.tasks.map(id => byId.get(id)).filter(Boolean) }));
  const other = tasks.filter(task => !assigned.has(task.value));
  if (other.length) groups.push({ name: 'other', label: '其他', tasks: other });
  return groups.map(group => ({ ...group, tasks: group.tasks.filter(task =>
    !keyword || `${task.label} ${group.label}`.toLowerCase().includes(keyword),
  ) })).filter(group => group.tasks.length);
}
