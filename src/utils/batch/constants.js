/**
 * 批量日常任务常量配置
 */

import {
  DEFAULT_BLACK_MARKET_DISCOUNTS,
  DEFAULT_BLACK_MARKET_REFRESH_COUNT,
} from "@/utils/blackMarket.js";
import { REDEMPTION_CODE_MODES } from "@/utils/redemptionCodes.js";

// 宝箱类型选项
export const boxTypeOptions = [
  { label: "木质宝箱", value: 2001 },
  { label: "青铜宝箱", value: 2002 },
  { label: "黄金宝箱", value: 2003 },
  { label: "铂金宝箱", value: 2004 },
];

// 鱼竿类型选项
export const fishTypeOptions = [
  { label: "普通鱼竿", value: 1 },
  { label: "黄金鱼竿", value: 2 },
];

// 阵容选项
export const formationOptions = [1, 2, 3, 4, 5, 6].map((v) => ({
  label: `阵容${v}`,
  value: v,
}));

// BOSS次数选项
export const bossTimesOptions = [0, 1, 2, 3, 4].map((v) => ({
  label: `${v}次`,
  value: v,
}));

// 可用的定时任务列表
export const availableTasks = [
  { label: "日常任务", value: "startBatch" },
  { label: "领取挂机", value: "claimHangUpRewards" },
  { label: "一键加钟", value: "batchAddHangUpTime" },
  { label: "重置罐子", value: "resetBottles" },
  { label: "一键领取罐子", value: "batchlingguanzi" },
  { label: "一键爬塔", value: "climbTower" },
  { label: "一键怪异塔", value: "batchWeirdTower" },
  { label: "批量开箱", value: "batchOpenBox" },
  { label: "按积分开箱", value: "batchOpenBoxByPoints" },
  { label: "领取宝箱积分", value: "batchClaimBoxPointReward" },
  { label: "智能宝箱周任务", value: "batchSmartBoxWeekly" },
  { label: "智能招募周任务", value: "batchSmartRecruitWeekly" },
  { label: "江湖黑市周任务", value: "batchSmartBlackMarketWeekly" },
  { label: "使用仓库物品", value: "batchUseWarehouseItems" },
  { label: "精铁一键升级装备", value: "batchUpgradeEquipment" },
  { label: "自动兑换码", value: "batchRedeemCodes" },
  { label: "批量钓鱼", value: "batchFish" },
  { label: "批量招募", value: "batchRecruit" },
  { label: "自动梦境", value: "batchmengjing" },
  { label: "一键俱乐部签到", value: "batchclubsign" },
  { label: "一键盐场报名", value: "batchSaltSignup" },
  { label: "自动营地挑战（周二至周四）", value: "batchCampChallenge" },
  { label: "一键竞技场战斗3次", value: "batcharenafight" },
  { label: "一键钓鱼补齐", value: "batchTopUpFish" },
  { label: "一键金鱼杆补齐", value: "batchTopUpGoldFish" },
  { label: "批量加入俱乐部", value: "batchJoinLegion" },
  { label: "水晶升级至资源不足", value: "batchUpgradeCrystal" },
  { label: "战士科技依次升满", value: "batchMaxWarriorLegionTech" },
  { label: "领取成就奖励", value: "batchClaimAchievementRewards" },
  { label: "自动技能觉醒", value: "batchAwakenHeroSkills" },
  { label: "一键竞技场补齐", value: "batchTopUpArena" },
  { label: "一键换皮闯关", value: "skinChallenge" },
  { label: "一键购买四圣碎片", value: "legion_storebuygoods" },
  { label: "一键购买白玉", value: "legionStoreBuyWhiteJade" },
  { label: "一键黑市采购", value: "store_purchase" },
  { label: "黑市按折扣直购", value: "store_discount_purchase" },
  { label: "免费领取珍宝阁", value: "collection_claimfreereward" },
  { label: "批量领取功法残卷", value: "batchLegacyClaim" },
  { label: "批量开始探索功法", value: "batchLegacyBeginHangUp" },
  { label: "批量领取特权功法", value: "batchLegacyClaimChargeReward" },
  { label: "批量赠送功法残卷", value: "batchLegacyGiftSendEnhanced" },
  { label: "一键领取蟠桃园任务", value: "batchClaimPeachTasks" },
  { label: "一键扫荡灯神", value: "batchGenieSweep" },
  { label: "自动挑战群雄灯神", value: "batchChallengeGroupGenie" },
  { label: "魏蜀吴灯神各挑战一次", value: "batchChallengeThreeKingdomsGenie" },
  { label: "主线关卡信息获取", value: "batchPushMainLevelInfo" },
  { label: "小号前期推图阵容", value: "batchAdjustEarlyMainLevelFormation" },
  { label: "小号推图默认阵容调整", value: "batchAdjustMainLevelFormation" },
  { label: "一键玄武赐福", value: "batchXuanwuBlessing" },
  {
    label: "玄武活动兑换宠物饼干",
    value: "batchExchangeXuanwuPetCookies",
  },
];

// 月度任务目标
export const FISH_TARGET = 320;
export const GOLD_FISH_TARGET = 160;
export const ARENA_TARGET = 240;

// 任务表列配置
export const taskColumns = [
  { title: "任务名称", key: "name", width: 150 },
  { title: "运行类型", key: "runType", width: 100 },
  {
    title: "运行时间",
    key: "runTime",
    width: 150,
    render: (row) => {
      return row.runType === "daily" ? row.runTime : row.cronExpression;
    },
  },
  {
    title: "选中账号",
    key: "selectedTokens",
    width: 150,
    render: (row) => `${row.selectedTokens.length} 个`,
  },
  {
    title: "选中任务",
    key: "selectedTasks",
    width: 150,
    render: (row) => `${row.selectedTasks.length} 个`,
  },
  {
    title: "状态",
    key: "enabled",
    width: 80,
    render: (row) => (row.enabled ? "启用" : "禁用"),
  },
  { title: "操作", key: "actions", width: 150 },
];

// 默认设置
export const defaultSettings = {
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: false,
  openBox: false,
  autoDiamondBoxPaidRecruit: false,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
  blackMarketDiscountPurchase: false,
  holyBeastFragmentPurchase: false,
  whiteJadePurchase: false,
  studyEnable: true,
  dreamEnable: true,
  genieSweepEnable: false,
  monthlyFishTopUpEnable: true,
  monthlyArenaTopUpEnable: true,
};

// 默认批量设置
export const defaultBatchSettings = {
  legionId: null,
  crystalHeroId: 107,
  crystalLockAttribute: true,
  redemptionCodeMode: REDEMPTION_CODE_MODES.DEFAULT,
  customRedemptionCodes: "",
  boxCount: 100,
  fishCount: 100,
  recruitCount: 100,
  defaultBoxType: 2001,
  defaultFishType: 1,
  receiverId: "",
  password: "",
  blackMarketDiscounts: { ...DEFAULT_BLACK_MARKET_DISCOUNTS },
  blackMarketRefreshCount: DEFAULT_BLACK_MARKET_REFRESH_COUNT,
  tokenListColumns: 2,
  commandDelay: 500,
  taskDelay: 500,
  maxActive: 2,
  connectionTimeout: 10000,
  reconnectDelay: 1000,
  maxLogEntries: 1000,
  // 页面刷新配置
  enableRefresh: false,
  refreshType: "interval", // 'interval' | 'cron'
  refreshInterval: 360,
  refreshCronExpression: "",
  refreshMaxStaleHours: 0,
  enableMissedTaskReExecution: false,
  // 推送通知配置
  wxpusherEnabled: false,
  wxpusherAppToken: "",
  wxpusherUids: "",
  pushplusEnabled: false,
  pushplusToken: "",
};

// 默认模板
export const defaultTemplate = {
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: false,
  openBox: false,
  autoDiamondBoxPaidRecruit: false,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
  blackMarketDiscountPurchase: false,
  holyBeastFragmentPurchase: false,
  whiteJadePurchase: false,
  studyEnable: true,
  dreamEnable: true,
  genieSweepEnable: false,
  monthlyFishTopUpEnable: true,
  monthlyArenaTopUpEnable: true,
};

// 默认任务表单
export const defaultTaskForm = {
  name: "",
  runType: "daily",
  runTime: undefined,
  cronExpression: "",
  selectedTokens: [],
  selectedTasks: [],
  enabled: true,
};

// 默认助手设置
export const defaultHelperSettings = {
  boxType: 2001,
  fishType: 1,
  count: 100,
};
