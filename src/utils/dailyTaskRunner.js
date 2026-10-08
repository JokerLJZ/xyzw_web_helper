import { runDailyGenieChallenges } from "./dailyGenieChallenges.js";
import { ARENA_TARGET, FISH_TARGET } from "@/utils/batch/constants.js";
import {
  DREAM_PUSH_INTERVAL_MS,
  isDreamEnabled,
  runAutomaticDream,
} from "@/utils/dreamTaskRunner.js";
import { goldItemsConfig, merchantConfig } from "@/utils/dreamConstants";
import {
  BLACK_MARKET_MODES,
  loadBlackMarketSettings,
  runBlackMarketPurchase,
} from "@/utils/blackMarket.js";
import {
  DREAM_MIN_MAIN_LEVEL,
  GENIE_MIN_MAIN_LEVEL,
  getGenieProgress,
  getMainLevel,
  isDreamMainLevelUnlocked,
  isGenieMainLevelUnlocked,
  planDailyGenieRewards,
} from "@/utils/dailyFeatureEligibility.js";
import {
  extractRolePatch,
  mergeRoleSnapshot,
} from "@/utils/roleSnapshot.js";

import {
  getClaimablePointRewards,
  getDailyTaskStates,
  loadDailyTaskConfig,
} from "@/utils/dailyTaskState";

const activeTokenRuns = new Set();
const taskLabels = {
  1: "登录游戏",
  2: "分享游戏",
  3: "赠送好友金币",
  4: "招募",
  5: "领取挂机奖励",
  6: "点金",
  7: "开启宝箱",
  12: "黑市购买",
  13: "竞技场战斗",
  14: "收获盐罐",
};
// 辅助函数
const pickArenaTargetId = (targets) => {
  if (!targets) return null;

  // Handle if targets is an array directly
  if (Array.isArray(targets)) {
    const candidate = targets[0];
    return candidate?.roleId || candidate?.id || candidate?.targetId;
  }

  const candidate =
    targets?.rankList?.[0] ||
    targets?.roleList?.[0] ||
    targets?.targets?.[0] ||
    targets?.targetList?.[0] ||
    targets?.list?.[0];

  if (candidate) {
    if (candidate.roleId) return candidate.roleId;
    if (candidate.id) return candidate.id;
    if (candidate.targetId) return candidate.targetId;
  }

  return targets?.roleId || targets?.id || targets?.targetId;
};

const PERMANENT_CARD_ID = 4003;
const PERMANENT_CARD_BENEFIT = 4;
export const DAILY_TASK_REWARD_IDS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => index + 1),
);
const normalizeStateKey = (key) =>
  String(key ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();

const toTimestampMs = (value) => {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp < 1e12 ? timestamp * 1000 : timestamp;
};

const isTimestampToday = (value, now = new Date()) => {
  const timestamp = toTimestampMs(value);
  if (!timestamp) return false;
  return new Date(timestamp).toDateString() === now.toDateString();
};

const findContainerEntry = (container, ids) => {
  if (!container) return null;
  if (Array.isArray(container)) {
    return (
      container.find((item) => {
        if (ids.includes(Number(item))) return true;
        const itemId = Number(
          item?.cardId ?? item?.benefitId ?? item?.type ?? item?.id,
        );
        return ids.includes(itemId);
      }) ?? null
    );
  }
  if (typeof container !== "object") return null;
  for (const id of ids) {
    if (Object.prototype.hasOwnProperty.call(container, id)) {
      return container[id];
    }
    if (Object.prototype.hasOwnProperty.call(container, String(id))) {
      return container[String(id)];
    }
  }
  return null;
};

const readExplicitClaimState = (value) => {
  if (!value || typeof value !== "object") return null;

  const claimableKeys = new Set([
    "canclaim",
    "canclaimreward",
    "canclaimfreereward",
    "canreceive",
    "canget",
    "claimable",
    "available",
    "isavailable",
    "freereward",
    "freerewardavailable",
    "hasfreereward",
  ]);
  const claimedKeys = new Set([
    "claimed",
    "isclaimed",
    "hasclaimed",
    "received",
    "isreceived",
    "hasreceived",
    "freerewardclaimed",
    "hasclaimedfreereward",
    "isfreerewardclaimed",
  ]);

  for (const [key, fieldValue] of Object.entries(value)) {
    const normalizedKey = normalizeStateKey(key);
    if (claimableKeys.has(normalizedKey) && typeof fieldValue === "boolean") {
      return fieldValue ? "claimable" : "claimed";
    }
    if (claimedKeys.has(normalizedKey) && typeof fieldValue === "boolean") {
      return fieldValue ? "claimed" : "claimable";
    }
  }
  return null;
};

const findCollectionClaimState = (
  value,
  now = new Date(),
  depth = 0,
  visited = new Set(),
) => {
  if (!value || typeof value !== "object" || depth > 5 || visited.has(value)) {
    return null;
  }
  visited.add(value);

  for (const [key, fieldValue] of Object.entries(value)) {
    if (normalizeStateKey(key) !== "freerewardtime") continue;
    return isTimestampToday(fieldValue, now) ? "claimed" : "claimable";
  }

  const directState = readExplicitClaimState(value);
  if (directState) return directState;

  const wrapperKeys = new Set([
    "body",
    "data",
    "raw",
    "rawdata",
    "result",
    "collection",
    "collectioninfo",
    "rewardinfo",
    "storeinfo",
  ]);
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = normalizeStateKey(key);
    if (
      !wrapperKeys.has(normalizedKey)
      && !normalizedKey.includes("freereward")
    ) {
      continue;
    }
    if (
      normalizedKey.includes("freereward")
      && typeof nestedValue === "boolean"
    ) {
      return nestedValue ? "claimable" : "claimed";
    }
    const nestedState = findCollectionClaimState(
      nestedValue,
      now,
      depth + 1,
      visited,
    );
    if (nestedState) return nestedState;
  }
  return null;
};

export const getPermanentCardClaimState = (roleData, now = new Date()) => {
  if (!roleData || typeof roleData !== "object") return "unavailable";

  const statisticsTime = roleData.statisticsTime ?? {};
  const claimedToday = Object.entries(statisticsTime).some(([key, value]) => {
    const normalizedKey = normalizeStateKey(key);
    const isPermanentCardKey =
      normalizedKey.includes("card")
      && (normalizedKey.includes(String(PERMANENT_CARD_ID))
        || normalizedKey.includes("forever")
        || normalizedKey.includes("permanent"));
    return isPermanentCardKey && isTimestampToday(value, now);
  });
  if (claimedToday) return "claimed";

  const cardContainers = [
    roleData.cardTime,
    roleData.card,
    roleData.cards,
    roleData.cardInfo,
    roleData.cardMap,
    roleData.cardList,
  ];
  let cardEntry = null;
  for (const container of cardContainers) {
    cardEntry = findContainerEntry(container, [PERMANENT_CARD_ID]);
    if (cardEntry !== null && cardEntry !== undefined) break;
  }

  if (cardEntry === null || cardEntry === undefined) {
    cardEntry = findContainerEntry(
      roleData.benefit ?? roleData.benefits,
      [PERMANENT_CARD_BENEFIT],
    );
  }
  if (cardEntry === null || cardEntry === undefined || cardEntry === false) {
    return "unavailable";
  }

  if (typeof cardEntry === "object") {
    const explicitState = readExplicitClaimState(cardEntry);
    if (explicitState) return explicitState;

    const lastClaimTime =
      cardEntry.lastClaimTime
      ?? cardEntry.claimTime
      ?? cardEntry.lastRewardTime
      ?? cardEntry.dailyRewardTime
      ?? cardEntry.receiveTime;
    if (isTimestampToday(lastClaimTime, now)) return "claimed";

    const expireTime =
      cardEntry.expireTime ?? cardEntry.expiredAt ?? cardEntry.endTime;
    const expireTimeMs = toTimestampMs(expireTime);
    if (expireTimeMs && expireTimeMs <= now.getTime()) return "unavailable";
  }

  return "claimable";
};

export const getCollectionFreeRewardClaimState = (
  response,
  now = new Date(),
) => {
  if (!response || typeof response !== "object") return "unknown";
  return findCollectionClaimState(response, now) ?? "unknown";
};

const getServerErrorCode = (error) => {
  const directCode = Number(error?.code ?? error?.errorCode);
  if (Number.isFinite(directCode) && directCode > 0) return directCode;
  const match = String(error?.message ?? error).match(/服务器错误:\s*(\d+)/);
  return match ? Number(match[1]) : null;
};

const isTodayAvailable = (timestamp) => !isTimestampToday(timestamp, new Date());

const getTodayBossId = (dailyTime) => {
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905]; // 周日~周六
  const dayOfWeek = new Date((dailyTime + 8 * 60 * 60) * 1000).getUTCDay();
  return DAY_BOSS_MAP[dayOfWeek];
};

const isFreeGachaOpenDay = () => {
  const dayOfWeek = new Date().getDay();
  return dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6;
};

const isMonday = () => {
  return new Date().getDay() === 1;
};

const DIAMOND_BOX_ITEM_ID = 2005;
const AUTO_DAILY_DIAMOND_BOX_COUNT = 10;

const getRoleItemQuantity = (roleData, itemId) => {
  const item = roleData?.items?.[itemId] || roleData?.items?.[String(itemId)];
  const quantity = Number(item?.quantity ?? item?.count ?? item?.num ?? 0);
  return Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0;
};

const getDefaultDreamPurchaseList = () => {
  const list = [];
  for (const merchantId in goldItemsConfig) {
    goldItemsConfig[merchantId].forEach((index) => {
      list.push(`${merchantId}-${index}`);
    });
  }
  return list;
};

const calculateMonthShouldBe = (target) => {
  const now = new Date();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const dayOfMonth = now.getDate();
  const remainingDays = Math.max(0, daysInMonth - dayOfMonth);

  if (remainingDays === 0) return target;
  return Math.min(target, Math.ceil((dayOfMonth / daysInMonth) * target));
};

const isTimestampInCurrentWeek = (timestamp) => {
  if (!timestamp) return false;

  const date = new Date(timestamp);
  const now = new Date();
  const day = now.getDay() || 7;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - day + 1);

  const nextWeekStart = new Date(weekStart);
  nextWeekStart.setDate(weekStart.getDate() + 7);

  return date >= weekStart && date < nextWeekStart;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class DailyTaskRunner {
  constructor(tokenStore, delaySettings = null, options = {}) {
    this.loadConfig = options.loadConfig || loadDailyTaskConfig;
    this.sleep =
      options.sleep ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.tokenStore = tokenStore;
    this.roleSnapshots = new Map();
    this.delaySettings = delaySettings || {
      commandDelay: 500,
      taskDelay: 500
    };
  }

  log(message, type = "info") {
    if (this.callbacks?.onLog) {
      this.callbacks.onLog({
        time: new Date().toLocaleTimeString(),
        message,
        type,
      });
    }
  }

  /**
   * Send once; uncertain results stop this run and require a fresh server snapshot.
   * @param {string} tokenId Account identity.
   * @param {Function} request Transport call without automatic retries.
   * @returns {Promise<*>} Server response.
   */
  async sendRequest(tokenId, request) {
    if (!this.restoringFormation) this.throwIfInterrupted(tokenId);
    const response = await request();
    if (!this.restoringFormation) this.throwIfInterrupted(tokenId);
    return response;
  }

  async executeGameCommand(
    tokenId,
    cmd,
    params = {},
    description = "",
    timeout = 8000,
  ) {
    try {
      if (description) this.log(`执行: ${description}`);
      this.roleStateDirty = true;
      const result = await this.sendRequest(tokenId, () =>
        this.tokenStore.sendMessageWithPromise(tokenId, cmd, params, timeout),
      );
      const rolePatch = extractRolePatch(result);
      const snapshot = this.roleSnapshots.get(tokenId);
      if (snapshot && rolePatch) mergeRoleSnapshot(snapshot, rolePatch);
      await this.sleep(this.delaySettings.commandDelay);
      if (description)
        this.log(
          `${description} - ${this.activeCondition !== undefined ? "请求成功，待服务器确认任务状态" : "成功"}`,
          this.activeCondition !== undefined ? "info" : "success",
        );
      return result;
    } catch (error) {
      if (this.isRunActive && !this.restoringFormation &&
        (error.interrupted || !getServerErrorCode(error) ||
          [200400, 12400000].includes(getServerErrorCode(error)))) {
        this.transportFailure = error;
      }
      if (description) {
        const token = this.tokenStore.gameTokens.find((t) => t.id === tokenId);
        const tokenName = token?.name || tokenId;
        this.log(`[${tokenName}] ${description} - 失败: ${error.message}`, "error");
      }
      throw error;
    }
  }

  async runBlackMarketTask(tokenId, mode = BLACK_MARKET_MODES.LEGACY) {
    const blackMarketSettings = {
      ...loadBlackMarketSettings(),
      blackMarketPurchaseMode: mode,
    };
    return runBlackMarketPurchase({
      settings: blackMarketSettings,
      send: (cmd, params) =>
        this.executeGameCommand(
          tokenId,
          cmd,
          params,
          cmd === "store_goodslist"
            ? "读取黑市当前商品与折扣"
            : cmd === "store_buy"
              ? "购买符合折扣阈值的黑市商品"
              : cmd === "store_refresh"
                ? "刷新黑市商品"
              : "执行原有黑市自动采购",
        ),
    });
  }

  async claimHangUpRewardsFiveTimes(tokenId) {
    for (let i = 0; i < 5; i++) {
      await this.executeGameCommand(
        tokenId,
        "system_claimhangupreward",
        {},
        `领取挂机奖励 ${i + 1}/5`,
        5000,
      );

      if (i < 4) {
        await sleep(6000);
      }
    }
  }

  async switchToFormationIfNeeded(tokenId, targetFormation, formationName) {
    try {
      if (!Number.isInteger(targetFormation) || targetFormation <= 0)
        throw new Error("目标阵容无效，停止切换");
      this.log(`检查${formationName}配置...`);
      const teamInfo = await this.executeGameCommand(
        tokenId,
        "presetteam_getinfo",
        {},
        "获取阵容信息",
      );

      if (!teamInfo || !teamInfo.presetTeamInfo) {
        this.log(`阵容信息异常: ${JSON.stringify(teamInfo)}`, "warning");
      }

      const currentFormation = teamInfo?.presetTeamInfo?.useTeamId;
      if (!Number.isInteger(currentFormation))
        throw new Error("服务器未提供有效阵容，停止切换");
      if (this.originalFormation === undefined)
        this.originalFormation = currentFormation;
      this.log(`当前阵容: ${currentFormation}`);

      if (currentFormation === targetFormation) {
        this.log(
          `当前已是${formationName}${targetFormation}，无需切换`,
          "success",
        );
        return false;
      }

      this.log(
        `当前阵容: ${currentFormation}, 目标阵容: ${targetFormation}，开始切换...`,
      );
      // A lost acknowledgement can still follow a server-side switch.
      this.formationChanged = true;
      await this.executeGameCommand(
        tokenId,
        "presetteam_saveteam",
        { teamId: targetFormation },
        `切换到${formationName}${targetFormation}`,
      );

      this.log(`成功切换到${formationName}${targetFormation}`, "success");
      return true;
    } catch (error) {
      this.log(`阵容检查或切换失败: ${error.message}`, "error");
      throw error;
    }
  }

  async runStudyTask(tokenId, roleData) {
    const study = roleData.study;
    const isCompleted =
      study?.maxCorrectNum >= 10 &&
      isTimestampInCurrentWeek((study.beginTime || 0) * 1000);

    if (isCompleted) {
      this.log("本周答题已完成，跳过", "success");
      return;
    }

    const { preloadQuestions } = await import("@/utils/studyQuestionsFromJSON.js");
    this.log("正在加载题库...");
    await preloadQuestions();

    this.tokenStore.gameData.studyStatus = {
      isAnswering: false,
      questionCount: 0,
      answeredCount: 0,
      status: "",
      timestamp: null,
    };

    await this.executeGameCommand(
      tokenId,
      "study_startgame",
      {},
      "一键答题",
      5000,
    );

    let maxWait = 90;
    let lastStatus = "";

    while (maxWait > 0) {
      const status = this.tokenStore.gameData.studyStatus;

      if (status.status !== lastStatus) {
        lastStatus = status.status;
        if (status.status === "answering") {
          this.log("开始答题...");
        } else if (status.status === "claiming_rewards") {
          this.log("领取答题奖励...");
        }
      }

      if (status.status === "completed") {
        this.log("答题完成", "success");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      maxWait--;
    }

    throw new Error("答题超时或未开始");
  }

  async runGenieSweepTask(tokenId) {
    const role = await this.getLatestRole(tokenId, "读取灯神扫荡信息");
    const mainLevel = getMainLevel(role);
    if (!isGenieMainLevelUnlocked(role)) {
      this.log(
        `当前主线关卡${mainLevel}，未达到灯神开启条件${GENIE_MIN_MAIN_LEVEL}关，跳过一键灯神扫荡`,
        "info",
      );
      return;
    }
    const genieData = role.genie || {};
    const sweepTicketCount = role.items?.[1021]?.quantity || 0;

    this.log(`当前扫荡券数量: ${sweepTicketCount}`);

    if (sweepTicketCount <= 0) {
      this.log("扫荡券不足，跳过一键灯神扫荡", "warning");
      return;
    }

    let maxLayer = -1;
    let bestGenieId = -1;

    for (let genieId = 1; genieId <= 4; genieId++) {
      if (genieData[genieId] !== undefined) {
        const currentLayer = genieData[genieId] + 1;
        if (currentLayer > maxLayer) {
          maxLayer = currentLayer;
          bestGenieId = genieId;
        }
      }
    }

    if (bestGenieId === -1) {
      this.log("未找到可扫荡的灯神关卡", "warning");
      return;
    }

    const genieNames = { 1: "魏国", 2: "蜀国", 3: "吴国", 4: "群雄" };
    this.log(
      `开始扫荡: ${genieNames[bestGenieId]}灯神 (第${maxLayer}层)`,
    );

    let remainingTickets = sweepTicketCount;

    while (remainingTickets > 0) {
      const sweepCnt = Math.min(remainingTickets, 20);
      const res = await this.executeGameCommand(
        tokenId,
        "genie_sweep",
        { genieId: bestGenieId, sweepCnt },
        `灯神扫荡 ${sweepCnt} 次`,
        5000,
      );

      const nextTicketCount = res?.role?.items?.[1021]?.quantity;
      if (
        typeof nextTicketCount === "number" &&
        nextTicketCount < remainingTickets
      ) {
        remainingTickets = nextTicketCount;
      } else {
        remainingTickets -= sweepCnt;
      }
    }

    this.log("一键灯神扫荡完成", "success");
  }

  async runDailyGenieRewards(tokenId) {
    const role = await this.getLatestRole(tokenId, "读取灯神每日奖励");
    const mainLevel = getMainLevel(role);
    if (!isGenieMainLevelUnlocked(role)) {
      this.log(
        `当前主线关卡${mainLevel}，未达到灯神开启条件${GENIE_MIN_MAIN_LEVEL}关，跳过灯神每日奖励`,
        "info",
      );
      return;
    }

    const genieNames = { 1: "魏国", 2: "蜀国", 3: "吴国", 4: "群雄" };
    const { claimableGenieIds, remainingTicketClaims } =
      planDailyGenieRewards(role);

    if (claimableGenieIds.length === 0) {
      this.log("四个阵营当前没有可领取的灯神免费扫荡奖励", "info");
    } else {
      this.log(
        `检测到可领取灯神免费扫荡奖励：${claimableGenieIds.map((id) => genieNames[id]).join("、")}`,
      );
      for (const genieId of claimableGenieIds) {
        await this.executeGameCommand(
          tokenId,
          "genie_sweep",
          { genieId },
          `${genieNames[genieId]}灯神免费扫荡`,
        );
      }
    }

    if (remainingTicketClaims === 0) {
      this.log("今日免费扫荡券已全部领取", "info");
      return;
    }

    for (let i = 0; i < remainingTicketClaims; i++) {
      await this.executeGameCommand(
        tokenId,
        "genie_buysweep",
        {},
        `领取免费扫荡券 ${i + 1}/${remainingTicketClaims}`,
      );
    }
  }

  async runHolyBeastFragmentPurchase(tokenId) {
    this.log("开始购买四圣碎片");

    const result = await this.executeGameCommand(
      tokenId,
      "legion_storebuygoods",
      { id: 6 },
      "购买四圣碎片",
      5000,
    );

    if (result?.error) {
      if (result.error.includes("俱乐部商品购买数量超出上限")) {
        this.log("本周已购买过四圣碎片，跳过", "info");
        return;
      }

      if (result.error.includes("物品不存在")) {
        this.log("盐锭不足或未加入军团，购买四圣碎片失败", "warning");
        return;
      }

      throw new Error(result.error);
    }

    this.log("四圣碎片购买成功", "success");
  }

  async runWhiteJadePurchase(tokenId) {
    this.log("开始购买白玉");

    const result = await this.executeGameCommand(
      tokenId,
      "legion_storebuygoods",
      { id: 5 },
      "购买白玉",
      5000,
    );

    if (result?.error) {
      if (result.error.includes("俱乐部商品购买数量超出上限")) {
        this.log("本周已购买过白玉，跳过", "info");
        return;
      }

      if (result.error.includes("物品不存在")) {
        this.log("盐锭不足或未加入军团，购买白玉失败", "warning");
        return;
      }

      throw new Error(result.error);
    }

    this.log("白玉购买成功", "success");
  }

  async getLatestRole(tokenId, description = "获取最新角色信息") {
    const snapshot = this.roleSnapshots.get(tokenId);
    if (snapshot) return snapshot;

    // 独立调用某个子功能时没有日常任务初始快照，允许在入口补查一次。
    const roleInfoRes = await this.sendRequest(tokenId, () =>
      this.tokenStore.sendGetRoleInfo(tokenId, {}, 2),
    );
    const role = extractRolePatch(roleInfoRes) || {};
    this.roleSnapshots.set(tokenId, role);
    this.log(`${description}：已建立角色快照`);
    return role;
  }

  async claimPermanentCardRewardIfAvailable(tokenId) {
    const role = await this.getLatestRole(tokenId, "检查永久卡礼包状态");
    const lastClaimTime = role.cardTime?.[PERMANENT_CARD_ID]?.lastClaimTime;
    const claimState = Number.isFinite(role.dailyTask?.dailyTime) &&
      Number.isFinite(lastClaimTime) && lastClaimTime >= role.dailyTask.dailyTime
      ? "claimed" : getPermanentCardClaimState(role);

    if (claimState === "claimed") {
      this.log("领取永久卡礼包 - 今日已领取，跳过", "info");
      return { skipped: true, reason: "claimed" };
    }
    if (claimState !== "claimable") {
      this.log("领取永久卡礼包 - 未持有或当前不可领取，跳过", "info");
      return { skipped: true, reason: "unavailable" };
    }

    return this.executeGameCommand(
      tokenId,
      "card_claimreward",
      { cardId: PERMANENT_CARD_ID },
      "领取永久卡礼包",
    );
  }

  async claimCollectionFreeRewardIfAvailable(tokenId) {
    const goodsList = await this.executeGameCommand(
      tokenId,
      "collection_goodslist",
      {},
      "检查珍宝阁免费礼包状态",
    );
    const claimState = getCollectionFreeRewardClaimState(goodsList);

    if (claimState === "claimed") {
      this.log("领取珍宝阁免费礼包 - 今日已领取，跳过", "info");
      return { skipped: true, reason: "claimed" };
    }
    if (claimState !== "claimable") {
      this.log("领取珍宝阁免费礼包 - 未返回明确的可领取状态，跳过", "info");
      return { skipped: true, reason: "unknown" };
    }

    return this.executeGameCommand(
      tokenId,
      "collection_claimfreereward",
      {},
      "领取珍宝阁免费礼包",
    );
  }

  claimDailyTaskReward(tokenId) {
    return this.executeGameCommand(
      tokenId,
      "task_claimdailyreward",
      {},
      "领取日常任务奖励",
    );
  }

  claimWeeklyTaskReward(tokenId) {
    return this.executeGameCommand(
      tokenId,
      "task_claimweekreward",
      {},
      "领取周常任务奖励",
    );
  }

  async getActivityInfo(tokenId, description = "获取月度任务进度") {
    const result = await this.executeGameCommand(
      tokenId,
      "activity_get",
      {},
      description,
      10000,
    );

    return result?.activity || result?.body?.activity || result;
  }

  async runMonthlyFishTopUp(tokenId) {
    this.log("开始月度钓鱼补齐");

    const act = await this.getActivityInfo(tokenId);
    if (!act) {
      this.log("获取月度任务进度失败，跳过钓鱼补齐", "error");
      return;
    }

    const fishNum = Number(act.myMonthInfo?.["2"]?.num || 0);
    const shouldBe = calculateMonthShouldBe(FISH_TARGET);
    let need = Math.max(0, shouldBe - fishNum);
    this.log(`钓鱼月度进度: ${fishNum}/${FISH_TARGET}，今日应达: ${shouldBe}，需补齐: ${need}`);

    if (need <= 0) {
      this.log("钓鱼月度进度已达标，跳过", "success");
      return;
    }

    let role = await this.getLatestRole(tokenId, "获取钓鱼库存信息");
    const lastFreeTime = Number(
      role?.statistics?.["artifact:normal:lottery:time"] || 0,
    );

    if (isTodayAvailable(lastFreeTime)) {
      this.log("检测到今日免费钓鱼次数，开始消耗 3 次");
      let freeUsed = 0;
      for (let i = 0; i < 3 && freeUsed < need; i++) {
        try {
          await this.executeGameCommand(
            tokenId,
            "artifact_lottery",
            { lotteryNumber: 1, newFree: true, type: 1 },
            `免费钓鱼 ${i + 1}/3`,
            8000,
          );
          freeUsed++;
        } catch (error) {
          this.log(`免费钓鱼失败: ${error.message}`, "warning");
          break;
        }
      }
    }

    const updatedAct = await this.getActivityInfo(
      tokenId,
      "刷新钓鱼月度进度",
    );
    const updatedFishNum = Number(updatedAct?.myMonthInfo?.["2"]?.num || 0);
    let remaining = Math.max(0, shouldBe - updatedFishNum);
    this.log(`免费次数后钓鱼进度: ${updatedFishNum}/${FISH_TARGET}，还需: ${remaining}`);

    if (remaining <= 0) {
      this.log("钓鱼补齐完成", "success");
      return;
    }

    role = await this.getLatestRole(tokenId, "刷新普通鱼竿库存");
    const rodCount = role?.items?.[1011]?.quantity || 0;
    this.log(`当前普通鱼竿: ${rodCount}`);

    if (rodCount < remaining) {
      this.log(`普通鱼竿不足 (${rodCount} < ${remaining})，将仅使用现有鱼竿`, "warning");
      remaining = rodCount;
    }

    while (remaining > 0) {
      const batch = Math.min(10, remaining);
      await this.executeGameCommand(
        tokenId,
        "artifact_lottery",
        { lotteryNumber: batch, newFree: true, type: 1 },
        `付费钓鱼 ${batch} 次`,
        12000,
      );
      remaining -= batch;
    }

    const finalAct = await this.getActivityInfo(
      tokenId,
      "确认钓鱼月度进度",
    );
    const finalFishNum = Number(finalAct?.myMonthInfo?.["2"]?.num || 0);
    if (finalFishNum >= shouldBe || finalFishNum >= FISH_TARGET) {
      this.log(`钓鱼补齐完成，最终进度: ${finalFishNum}/${FISH_TARGET}`, "success");
    } else {
      this.log(`钓鱼补齐已停止，最终进度: ${finalFishNum}/${FISH_TARGET}`, "warning");
    }

    try {
      const currentRole = await this.getLatestRole(tokenId, "检查鱼竿累计奖励");
      const points = currentRole?.statistics?.["artifact:point"] || 0;
      const exchangeCount = Math.floor(points / 20);

      if (exchangeCount > 0) {
        this.log(`检测到鱼竿累计使用 ${points}，开始领取 ${exchangeCount} 次累计奖励`);
        for (let i = 0; i < exchangeCount; i++) {
          await this.executeGameCommand(
            tokenId,
            "artifact_exchange",
            {},
            `领取鱼竿累计奖励 ${i + 1}/${exchangeCount}`,
            3000,
          );
        }
        this.log("鱼竿累计奖励领取结束", "success");
      }
    } catch (error) {
      this.log(`检查鱼竿累计奖励失败: ${error.message}`, "warning");
    }
  }

  async runMonthlyArenaTopUp(tokenId, settings) {
    const hour = new Date().getHours();
    if (hour < 6 || hour >= 22) {
      this.log("当前不在竞技场开放时间 (6:00-22:00)，跳过月度竞技场补齐", "warning");
      return;
    }

    this.log("开始月度竞技场补齐");
    await this.switchToFormationIfNeeded(
      tokenId,
      settings.arenaFormation,
      "竞技场阵容",
    );

    const act = await this.getActivityInfo(tokenId);
    if (!act) {
      this.log("获取月度任务进度失败，跳过竞技场补齐", "error");
      return;
    }

    const arenaNum = Number(act.myArenaInfo?.num || 0);
    const shouldBe = calculateMonthShouldBe(ARENA_TARGET);
    const need = Math.max(0, shouldBe - arenaNum);
    this.log(`竞技场月度进度: ${arenaNum}/${ARENA_TARGET}，今日应达: ${shouldBe}，需补齐: ${need}`);

    if (need <= 0) {
      this.log("竞技场月度进度已达标，跳过", "success");
      return;
    }

    let role = await this.getLatestRole(tokenId, "获取咸神门票库存");
    let ticketsLeft = role?.items?.[1007]?.quantity || 0;
    this.log(`当前咸神门票: ${ticketsLeft}`);

    if (ticketsLeft <= 0) {
      this.log("咸神门票不足，跳过竞技场补齐", "warning");
      return;
    }

    if (ticketsLeft < need) {
      this.log(`咸神门票不足 (${ticketsLeft} < ${need})，将仅使用现有门票`, "warning");
    }

    await this.executeGameCommand(
      tokenId,
      "arena_startarea",
      {},
      "开始竞技场",
      6000,
    );

    let remaining = Math.min(need, ticketsLeft);
    let safetyCounter = 0;
    const safetyMaxFights = 100;
    let round = 1;

    while (remaining > 0 && ticketsLeft > 0 && safetyCounter < safetyMaxFights) {
      const planFights = Math.min(Math.ceil(remaining / 2), ticketsLeft);
      this.log(`竞技场补齐第${round}轮：计划战斗 ${planFights} 场，剩余门票 ${ticketsLeft}`);

      for (let i = 0; i < planFights && safetyCounter < safetyMaxFights; i++) {
        let targets;
        try {
          targets = await this.executeGameCommand(
            tokenId,
            "arena_getareatarget",
            {},
            `获取竞技场目标 ${i + 1}/${planFights}`,
            8000,
          );
        } catch (error) {
          this.log(`获取竞技场目标失败: ${error.message}`, "error");
          break;
        }

        const targetId = pickArenaTargetId(targets);
        if (!targetId) {
          this.log(`未找到可用的竞技场目标: ${JSON.stringify(targets)}`, "warning");
          break;
        }

        try {
          await this.executeGameCommand(
            tokenId,
            "fight_startareaarena",
            { targetId },
            `竞技场补齐战斗 ${i + 1}/${planFights}`,
            15000,
          );
          ticketsLeft--;
        } catch (error) {
          this.log(`竞技场对决失败: ${error.message}`, "error");
        }

        safetyCounter++;
      }

      const updatedAct = await this.getActivityInfo(
        tokenId,
        "刷新竞技场月度进度",
      );
      const updatedArenaNum = Number(updatedAct?.myArenaInfo?.num || 0);

      role = await this.getLatestRole(tokenId, "读取咸神门票快照");
      const latestTickets = role?.items?.[1007]?.quantity;
      if (
        typeof latestTickets === "number" &&
        latestTickets >= 0 &&
        latestTickets < ticketsLeft
      ) {
        this.log(`按服务器响应同步门票数量: ${latestTickets}`);
        ticketsLeft = latestTickets;
      }

      remaining = Math.min(Math.max(0, shouldBe - updatedArenaNum), ticketsLeft);
      this.log(`第${round}轮后竞技场进度: ${updatedArenaNum}/${ARENA_TARGET}，还需: ${remaining}`);
      round++;
    }

    const finalAct = await this.getActivityInfo(
      tokenId,
      "确认竞技场月度进度",
    );
    const finalArenaNum = Number(finalAct?.myArenaInfo?.num || 0);
    if (finalArenaNum >= shouldBe || finalArenaNum >= ARENA_TARGET) {
      this.log(`竞技场补齐完成，最终进度: ${finalArenaNum}/${ARENA_TARGET}`, "success");
    } else if (safetyCounter >= safetyMaxFights) {
      this.log(`达到安全上限，竞技场补齐已停止，最终进度: ${finalArenaNum}/${ARENA_TARGET}`, "warning");
    } else {
      this.log(`竞技场补齐已停止，最终进度: ${finalArenaNum}/${ARENA_TARGET}`, "warning");
    }
  }

  loadDreamPurchaseList() {
    try {
      const raw = localStorage.getItem("batchSettings");
      const saved = raw ? JSON.parse(raw) : null;
      return saved?.dreamPurchaseList || getDefaultDreamPurchaseList();
    } catch (error) {
      console.error("Failed to load dream purchase list:", error);
      return getDefaultDreamPurchaseList();
    }
  }

  async runDreamPurchaseForToken(tokenId, purchaseList, canPurchase = () => true) {
    if (purchaseList.length === 0) {
      this.log("未配置梦境购买清单，跳过购买", "warning");
      return;
    }

    if (this.callbacks?.shouldStop?.() || !canPurchase()) return;
    const roleInfo = await this.executeGameCommand(
      tokenId, "role_getroleinfo", {}, "刷新梦境商店数据", 15000,
    );
    if (this.callbacks?.shouldStop?.() || !canPurchase()) return;
    const merchantData = extractRolePatch(roleInfo)?.dungeon?.merchant || null;
    if (!merchantData) throw new Error("无法获取梦境商店数据");

    let successCount = 0;
    let failCount = 0;
    const operations = [];

    for (const itemKey of purchaseList) {
      const [targetMerchantId, targetItemIndex] = itemKey
        .split("-")
        .map(Number);
      const merchantItems = merchantData[targetMerchantId];

      if (merchantItems) {
        for (let pos = 0; pos < merchantItems.length; pos++) {
          if (merchantItems[pos] === targetItemIndex) {
            operations.push({
              merchantId: targetMerchantId,
              index: targetItemIndex,
              pos,
            });
          }
        }
      }
    }

    operations.sort((a, b) => {
      if (a.merchantId !== b.merchantId) return a.merchantId - b.merchantId;
      return b.pos - a.pos;
    });

    for (const op of operations) {
      if (this.callbacks?.shouldStop?.() || !canPurchase()) return;
      try {
        const response = await this.executeGameCommand(
          tokenId,
          "dungeon_buymerchant",
          {
            id: op.merchantId,
            index: op.index,
            pos: op.pos,
          },
          "购买梦境商品",
          5000,
        );

        if (response?.reward) {
          successCount++;
          const merchantName =
            merchantConfig[op.merchantId]?.name || `商人${op.merchantId}`;
          const itemName =
            merchantConfig[op.merchantId]?.items?.[op.index] ||
            `商品${op.index}`;
          this.log(`梦境购买成功: ${merchantName} - ${itemName}`, "success");
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
    }

    this.log(`梦境购买完成: 成功${successCount}, 失败${failCount}`, "success");
  }

  async runAutomaticGenieChallenges(tokenId) {
    try {
      await runDailyGenieChallenges({
        tokenId, tokenStore: this.tokenStore,
        stopped: () => this.callbacks?.shouldStop?.() === true,
        log: (text, type) => this.log(text, type), delaySettings: this.delaySettings,
      });
    } finally {
      // 灯神升级/战斗会修改角色数据，丢弃日常任务入口的旧快照。
      this.roleSnapshots.delete(tokenId);
    }
  }

  async runDreamTask(tokenId) {
    const result = await runAutomaticDream({
      purchase: ({ canPurchase }) => this.runDreamPurchaseForToken(
        tokenId,
        this.loadDreamPurchaseList(),
        canPurchase,
      ),
      enabled: isDreamEnabled(tokenId),
      initialRole: this.roleSnapshots.get(tokenId) || null,
      send: async (cmd, params) => {
        const response = await this.tokenStore.sendMessageWithPromise(
          tokenId,
          cmd,
          params,
          15000,
        );
        const rolePatch = extractRolePatch(response);
        const snapshot = this.roleSnapshots.get(tokenId);
        if (snapshot && rolePatch) mergeRoleSnapshot(snapshot, rolePatch);
        return response;
      },
      stopped: () => this.callbacks?.shouldStop?.() === true,
      pause: () => sleep(DREAM_PUSH_INTERVAL_MS),
      log: (text) => this.log(text),
    });
    this.log(`自动梦境：${result.reason}，当前层数 ${result.floor ?? "未知"}`);
    return result;
  }

  loadSettings(roleId) {
    try {
      const raw = localStorage.getItem(`daily-settings:${roleId}`);
      const defaultSettings = {
        arenaFormation: 1,
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
        freeGachaEnable: true,
        studyEnable: true,
        dreamEnable: true,
        genieSweepEnable: false,
        genieChallengeEnable: false,
        monthlyFishTopUpEnable: true,
        monthlyArenaTopUpEnable: true,
      };
      return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
    } catch (error) {
      console.error("Failed to load settings:", error);
      return null;
    }
  }

  /** Check cancellation and live connection before starting another operation. */
  throwIfInterrupted(tokenId) {
    if (this.transportFailure) throw this.transportFailure;
    const stopped = this.callbacks?.shouldStop?.();
    const status = this.tokenStore.getWebSocketStatus?.(tokenId);
    if (stopped || (status && status !== "connected")) {
      const error = new Error(
        stopped
          ? "任务已停止，再次执行将根据服务器任务列表补差"
          : "WebSocket 已断开，停止执行并等待重新查询服务器状态",
      );
      error.interrupted = true;
      throw error;
    }
  }

  /**
   * Read uncached server progress; a response after disconnect is not accepted.
   * @param {string} tokenId Account to query.
   * @returns {Promise<object>} Validated current role snapshot.
   * @throws {Error} On missing task data, a changed task day or disconnected transport.
   */
  async refreshServerRole(tokenId) {
    try {
      this.throwIfInterrupted(tokenId);
      const response = await this.sendRequest(tokenId, () =>
        this.tokenStore.sendGetRoleInfo(tokenId, {}, 2),
      );
      await this.sleep(this.delaySettings.commandDelay);
      this.throwIfInterrupted(tokenId);
      const role = extractRolePatch(response);
      const states = getDailyTaskStates(role, this.taskConfig);
      if (
        this.taskDay !== undefined &&
        role.dailyTask.dailyTime !== this.taskDay
      ) {
        const error = new Error(
          "服务器每日任务已重置，请重新开始获取当日任务列表",
        );
        error.interrupted = true;
        throw error;
      }
      this.roleSnapshots.set(tokenId, structuredClone(role));
      this.roleData = role;
      this.roleStateDirty = false;
      for (const state of states) {
        const signature = `${state.status}:${state.progress}/${state.required}`;
        if (this.loggedTaskStates?.get(state.condition) === signature) continue;
        this.loggedTaskStates?.set(state.condition, signature);
        const label = taskLabels[state.condition] || `任务${state.id}`;
        const status =
          state.status === "claimed"
            ? "已完成并领奖，跳过"
            : state.status === "claimable"
              ? "已完成，待领奖，跳过重复操作"
              : `未完成，剩余 ${state.remaining}`;
        this.log(
          `${label}: ${state.progress}/${state.required} · ${status}`,
          state.status === "pending" ? "info" : "success",
        );
      }
      const progress = Math.floor(
        (states.filter((state) => state.status === "claimed").length /
          states.length) *
          100,
      );
      if (progress !== this.reportedProgress) {
        this.reportedProgress = progress;
        this.callbacks?.onProgress?.(progress);
      }
      return role;
    } catch (error) {
      if (error.interrupted) throw error;
      const failure = new Error(error.message || "读取服务器任务列表失败");
      failure.serverStateUnavailable = true;
      throw failure;
    }
  }

  getTaskState(condition) {
    const task = getDailyTaskStates(this.roleData, this.taskConfig).find(
      (task) => task.condition === condition,
    );
    if (!task) throw new Error(`官方任务配置中未找到完成条件 ${condition}`);
    return task;
  }

  /**
   * Fill remaining server task counters and claim only eligible unclaimed rewards.
   * @param {string} tokenId Account identity.
   * @param {object} callbacks Log, progress and cancellation hooks.
   * @param {object|null} customSettings Optional task settings.
   * @returns {Promise<object>} Execution counts without any local completion record.
   */
  async run(tokenId, callbacks = {}, customSettings = null) {
    if (activeTokenRuns.has(tokenId))
      throw new Error("该账号的每日任务正在执行中");
    activeTokenRuns.add(tokenId);
    this.isRunActive = true;
    this.transportFailure = null;
    try {
      return await this.runTasks(tokenId, callbacks, customSettings);
    } finally {
      activeTokenRuns.delete(tokenId);
      this.isRunActive = false;
      this.transportFailure = null;
    }
  }

  async runTasks(tokenId, callbacks = {}, customSettings = null) {
    this.callbacks = callbacks;
    this.taskDay = undefined;
    this.activeCondition = undefined;
    this.originalFormation = undefined;
    this.formationChanged = false;
    this.roleStateDirty = true;
    this.reportedProgress = undefined;
    this.loggedTaskStates = new Map();
    this.throwIfInterrupted(tokenId);
    const settings = customSettings || this.loadSettings(tokenId);
    if (!settings) throw new Error("每日任务设置无法读取");
    this.log("读取服务器任务配置与当前任务列表...");
    this.taskConfig = await this.loadConfig(
      {
        sendMessageWithPromise: (id, cmd, params, timeout) =>
          this.sendRequest(id, () =>
            this.tokenStore.sendMessageWithPromise(id, cmd, params, timeout),
          ),
      },
      tokenId,
    );
    const roleData = await this.refreshServerRole(tokenId);
    this.taskDay = roleData.dailyTask.dailyTime;

    this.log("开始执行每日任务补差");

    // A reached target is completed even when its points are not yet claimed.
    const isTaskCompleted = (condition) =>
      this.getTaskState(condition).remaining === 0;
    const statistics = roleData.statistics ?? {};
    const statisticsTime = roleData.statisticsTime ?? {};
    // Server dailyTime defines the reset boundary; browser dates are not completion evidence.
    const isTodayAvailable = (stamp) =>
      !Number.isFinite(stamp) || stamp < roleData.dailyTask.dailyTime;
    const diamondBoxCount = getRoleItemQuantity(roleData, DIAMOND_BOX_ITEM_ID);
    const isRecruitTaskCompleted = isTaskCompleted(4);
    const isOpenBoxTaskCompleted = isTaskCompleted(7);
    const shouldRunDiamondBoxPaidRecruit =
      settings.autoDiamondBoxPaidRecruit === true;
    const canRunDiamondBoxPaidRecruit =
      shouldRunDiamondBoxPaidRecruit &&
      !isRecruitTaskCompleted &&
      !isOpenBoxTaskCompleted &&
      diamondBoxCount >= AUTO_DAILY_DIAMOND_BOX_COUNT;

    const taskList = [];

    if (canRunDiamondBoxPaidRecruit) {
      this.log(
        `自动钻石宝箱与付费招募已触发：钻石宝箱 ${diamondBoxCount} 个`,
        "info",
      );
      taskList.push(
        {
          name: "开启钻石宝箱",
          condition: 7,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "item_openbox",
              {
                itemId: DIAMOND_BOX_ITEM_ID,
                number: AUTO_DAILY_DIAMOND_BOX_COUNT,
              },
              `开启钻石宝箱${AUTO_DAILY_DIAMOND_BOX_COUNT}个`,
            ),
        },
        {
          name: "付费招募",
          condition: 4,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "hero_recruit",
              { recruitType: 1, recruitNumber: 1 },
              "付费招募",
            ),
        },
      );
    } else if (shouldRunDiamondBoxPaidRecruit) {
      const skipReasons = [];
      if (isOpenBoxTaskCompleted) skipReasons.push("开宝箱日常已完成");
      if (isRecruitTaskCompleted) skipReasons.push("招募日常已完成");
      if (diamondBoxCount < AUTO_DAILY_DIAMOND_BOX_COUNT) {
        skipReasons.push(
          `钻石宝箱不足${AUTO_DAILY_DIAMOND_BOX_COUNT}个（当前${diamondBoxCount}个）`,
        );
      }
      this.log(
        `自动钻石宝箱与付费招募跳过：${skipReasons.join("，")}`,
        "info",
      );
    }

    // 1. 基础任务
    taskList.push({
      name: "分享火把",
      execute: () =>
        this.executeGameCommand(
          tokenId,
          "system_mysharecallback",
          { isSkipShareCard: false, type: 1 },
          "分享火把",
        ),
    });

    if (!isTaskCompleted(2)) {
      taskList.push({
        name: "分享一次游戏",
        condition: 2,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "system_mysharecallback",
            { isSkipShareCard: true, type: 2 },
            "分享游戏",
          ),
      });
    }

    if (!isTaskCompleted(3)) {
      taskList.push({
        name: "赠送好友金币",
        condition: 3,
        execute: () =>
          this.executeGameCommand(tokenId, "friend_batch", {}, "赠送好友金币"),
      });
    }

    if (!isTaskCompleted(4)) {
      const freeRecruit = isTodayAvailable(statistics["recruit:one:free"]) &&
        this.getTaskState(4).remaining > (canRunDiamondBoxPaidRecruit ? 1 : 0);
      const paidRecruit =
        this.getTaskState(4).remaining - (freeRecruit ? 1 : 0);
      if (freeRecruit)
        taskList.push({
          name: "免费招募",
          condition: 4,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "hero_recruit",
              { recruitType: 3, recruitNumber: 1 },
              "免费招募",
            ),
        });

      if (settings.payRecruit && !canRunDiamondBoxPaidRecruit && paidRecruit > 0) {
        taskList.push({
          name: "付费招募",
          condition: 4,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "hero_recruit",
              { recruitType: 1, recruitNumber: paidRecruit },
              "付费招募补足服务器任务进度",
            ),
        });
      }
    }

    if (!isTaskCompleted(6)) {
      const remaining = this.getTaskState(6).remaining;
      for (let i = 0; i < remaining; i++) {
        taskList.push({
          name: `免费点金 ${i + 1}/${remaining}`,
          condition: 6,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "system_buygold",
              { buyNum: 1 },
              `免费点金 ${i + 1}`,
            ),
        });
      }
    }

    if (!isTaskCompleted(5) && settings.claimHangUp) {
      const remaining = this.getTaskState(5).remaining;
      for (let i = 0; i < remaining; i++) {
        taskList.push({
          name: `领取挂机奖励 ${i + 1}/${remaining}`,
          condition: 5,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "system_claimhangupreward",
              {},
              `领取挂机奖励 ${i + 1}/${remaining}`,
            ).then(async (result) => {
              if (i < remaining - 1) await this.sleep(6000);
              return result;
            }),
        });
      }
    }

    if (
      !isTaskCompleted(7) &&
      settings.openBox &&
      !canRunDiamondBoxPaidRecruit
    ) {
      taskList.push({
        name: "开启木质宝箱",
        condition: 7,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "item_openbox",
            { itemId: 2001, number: 10 },
            "开启木质宝箱10个",
          ),
      });
    }

    if (!isTaskCompleted(14) && settings.claimBottle) {
      taskList.push({
        name: "停止盐罐计时",
        condition: 14,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "bottlehelper_stop",
            {},
            "停止盐罐计时",
          ),
      });
      taskList.push({
        name: "开始盐罐计时",
        condition: 14,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "bottlehelper_start",
            {},
            "开始盐罐计时",
          ),
      });

      taskList.push({
        name: "领取盐罐奖励",
        condition: 14,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "bottlehelper_claim",
            {},
            "领取盐罐奖励",
          ),
      });
    }

    // 2. 竞技场
    if (!isTaskCompleted(13) && settings.arenaEnable) {
      taskList.push({
        name: "竞技场战斗",
        condition: 13,
        execute: async () => {
          this.log("开始竞技场战斗流程");
          const hour = new Date().getHours();
          if (hour < 6) {
            this.log("当前时间未到6点，跳过竞技场战斗", "warning");
            return false;
          }
          if (hour > 22) {
            this.log("当前时间已过22点，跳过竞技场战斗", "warning");
            return false;
          }

          await this.switchToFormationIfNeeded(
            tokenId,
            settings.arenaFormation,
            "竞技场阵容",
          );
          await this.executeGameCommand(
            tokenId,
            "arena_startarea",
            {},
            "开始竞技场",
          );

          const arenaAttempts = Math.min(3, this.getTaskState(13).remaining);
          for (let i = 1; i <= arenaAttempts; i++) {
            this.log(`竞技场战斗 ${i}/${arenaAttempts}`);
            const targets = await this.executeGameCommand(
              tokenId,
              "arena_getareatarget",
              {},
              `获取竞技场目标${i}`,
            );

            const targetId = pickArenaTargetId(targets);
            if (targetId) {
              await this.executeGameCommand(
                tokenId,
                "fight_startareaarena",
                { targetId },
                `竞技场战斗${i}`,
                10000,
              );
            } else {
              this.log(
                `竞技场战斗${i} - 未找到目标: ${JSON.stringify(targets)}`,
                "warning",
              );
              return false;
            }
            await this.sleep(1000);
          }
        },
      });
    }

    // 3. BOSS
    if (settings.bossTimes > 0) {
      let alreadyLegionBoss = statistics["legion:boss"] ?? 0;
      if (isTodayAvailable(statisticsTime["legion:boss"])) {
        alreadyLegionBoss = 0;
      }
      const remainingLegionBoss = Math.max(
        settings.bossTimes - alreadyLegionBoss,
        0,
      );

      if (remainingLegionBoss > 0) {
        taskList.push({
          name: "军团BOSS阵容检查",
          checkOnly: true,
          execute: () =>
            this.switchToFormationIfNeeded(
              tokenId,
              settings.bossFormation,
              "BOSS阵容",
            ),
        });
        for (let i = 0; i < remainingLegionBoss; i++) {
          taskList.push({
            name: `军团BOSS ${i + 1}/${remainingLegionBoss}`,
            execute: () =>
              this.executeGameCommand(
                tokenId,
                "fight_startlegionboss",
                {},
                `军团BOSS ${i + 1}`,
                12000,
              ),
          });
        }
      }
    }

    const todayBossId = getTodayBossId(roleData.dailyTask.dailyTime);
    taskList.push({
      name: "每日BOSS阵容检查",
      checkOnly: true,
      execute: () =>
        this.switchToFormationIfNeeded(
          tokenId,
          settings.bossFormation,
          "BOSS阵容",
        ),
    });
    for (let i = 0; i < 3; i++) {
      taskList.push({
        name: `每日BOSS ${i + 1}/3`,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "fight_startboss",
            { bossId: todayBossId },
            `每日BOSS ${i + 1}`,
            12000,
          ),
      });
    }

    // 4. 固定奖励
    const fixedRewards = [
      ...(Object.values(roleData.signInReward ?? {}).some(
        (stamp) => !isTodayAvailable(stamp),
      )
        ? []
        : [{ name: "福利签到", cmd: "system_signinreward" }]),
      ...(isTodayAvailable(statisticsTime["legion:sign:in"])
        ? [{ name: "俱乐部", cmd: "legion_signin" }]
        : []),
      { name: "领取每日礼包", cmd: "discount_claimreward" },
      ...(isTodayAvailable(roleData.cardTime?.[1]?.lastClaimTime)
        ? [{ name: "领取免费礼包", cmd: "card_claimreward" }]
        : []),
    ];

    if (settings.claimEmail) {
      fixedRewards.push({
        name: "领取邮件奖励",
        cmd: "mail_claimallattachment",
      });
    }

    fixedRewards.forEach((reward) => {
      taskList.push({
        name: reward.name,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            reward.cmd,
            reward.params || {},
            reward.name,
          ),
      });
    });

    taskList.push({
      name: "领取永久卡礼包",
      execute: () => this.claimPermanentCardRewardIfAvailable(tokenId),
    });

    if (settings.holyBeastFragmentPurchase === true) {
      if (isMonday()) {
        taskList.push({
          name: "购买四圣碎片",
          execute: () => this.runHolyBeastFragmentPurchase(tokenId),
        });
      } else {
        this.log("四圣碎片购买跳过：仅周一执行", "info");
      }
    }

    if (settings.whiteJadePurchase === true) {
      if (isMonday()) {
        taskList.push({
          name: "购买白玉",
          execute: () => this.runWhiteJadePurchase(tokenId),
        });
      } else {
        this.log("白玉购买跳过：仅周一执行", "info");
      }
    }

    taskList.push({
      name: "领取珍宝阁免费礼包",
      execute: () => this.claimCollectionFreeRewardIfAvailable(tokenId),
    });

    if (
      settings.freeGachaEnable !== false
      && isFreeGachaOpenDay()
      && isTodayAvailable(statistics["gacha:free"])
    ) {
      taskList.push({
        name: "免费扭蛋",
        execute: async () => {
          await this.executeGameCommand(
            tokenId,
            "gacha_getinfo",
            {},
            "初始化扭蛋信息",
          );
          return this.executeGameCommand(
            tokenId,
            "gacha_drawreward",
            { num: 1, isGroup: false },
            "免费扭蛋",
          );
        },
      });
    } else if (
      settings.freeGachaEnable !== false
      && !isFreeGachaOpenDay()
      && isTodayAvailable(statistics["gacha:free"])
    ) {
      this.log("免费扭蛋跳过：仅周二、周四、周六执行", "info");
    }

    // 5. 免费活动
    if (isTodayAvailable(statistics["artifact:normal:lottery:time"])) {
      for (let i = 0; i < 3; i++) {
        taskList.push({
          name: `免费钓鱼 ${i + 1}/3`,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "artifact_lottery",
              { lotteryNumber: 1, newFree: true, type: 1 },
              `免费钓鱼 ${i + 1}`,
            ),
        });
      }
    }

    if (isGenieMainLevelUnlocked(roleData)) {
      taskList.push({
        name: "灯神每日奖励检查",
        execute: () => this.runDailyGenieRewards(tokenId),
      });
    } else {
      this.log(
        `当前主线关卡${getMainLevel(roleData)}，未达到灯神开启条件${GENIE_MIN_MAIN_LEVEL}关，跳过灯神任务`,
        "info",
      );
    }

    if (settings.studyEnable !== false) {
      taskList.push({
        name: "一键答题",
        execute: () => this.runStudyTask(tokenId, roleData),
      });
    }

    // 6. 黑市
    if (!isTaskCompleted(12) && settings.blackMarketPurchase) {
      taskList.push({
        name: "黑市购买1次物品",
        condition: 12,
        execute: () =>
          this.runBlackMarketTask(tokenId, BLACK_MARKET_MODES.LEGACY),
      });
    }

    if (settings.blackMarketDiscountPurchase === true) {
      taskList.push({
        name: "黑市按折扣直购",
        execute: () =>
          this.runBlackMarketTask(tokenId, BLACK_MARKET_MODES.DISCOUNT),
      });
    }

    // 咸王梦境
    if (
      settings.dreamEnable !== false
      && isDreamMainLevelUnlocked(roleData)
    ) {
      taskList.push({
        name: "咸王梦境",
        execute: () => this.runDreamTask(tokenId),
      });
    } else if (
      settings.dreamEnable !== false
      && !isDreamMainLevelUnlocked(roleData)
    ) {
      this.log(
        `当前主线关卡${getMainLevel(roleData)}，未达到梦境开启条件${DREAM_MIN_MAIN_LEVEL}关，跳过咸王梦境`,
        "info",
      );
    }

    if (settings.genieChallengeEnable === true && isGenieMainLevelUnlocked(roleData)) {
      taskList.push({
        name: "自动灯神挑战（魏蜀吴 → 群雄）",
        execute: () => this.runAutomaticGenieChallenges(tokenId),
      });
    }

    // 深海灯神
    const dayOfWeek = new Date().getDay();
    if (
      dayOfWeek === 1 &&
      isGenieMainLevelUnlocked(roleData) &&
      getGenieProgress(roleData, 5) !== null &&
      isTodayAvailable(statisticsTime[`genie:daily:free:5`])
    ) {
      taskList.push({
        name: "深海灯神",
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "genie_sweep",
            { genieId: 5, sweepCnt: 1 },
            "深海灯神",
          ),
      });
    }

    if (settings.monthlyFishTopUpEnable !== false) {
      taskList.push({
        name: "月度钓鱼补齐",
        execute: () => this.runMonthlyFishTopUp(tokenId),
      });
    }

    if (settings.monthlyArenaTopUpEnable !== false) {
      taskList.push({
        name: "月度竞技场补齐",
        execute: () => this.runMonthlyArenaTopUp(tokenId, settings),
      });
    }

    // Task IDs are mapped by the official config, not by completion-condition IDs.
    for (const definition of this.taskConfig.tasks) {
      taskList.push({
        name: `领取任务积分${definition.id}`,
        claimCondition: definition.completeCondition,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "task_claimdailypoint",
            { taskId: definition.id },
            `领取任务积分${definition.id}`,
            5000,
          ),
      });
    }

    if (
      settings.genieSweepEnable === true
      && isGenieMainLevelUnlocked(roleData)
    ) {
      taskList.push({
        name: "一键灯神扫荡",
        execute: () => this.runGenieSweepTask(tokenId),
      });
    }

    let pointRewardsStarted = false;
    for (const weekly of [false, true]) {
      taskList.push({
        name: weekly ? "领取周常任务奖励" : "领取日常任务奖励",
        execute: async () => {
          if (!pointRewardsStarted && this.roleStateDirty)
            await this.refreshServerRole(tokenId);
          pointRewardsStarted = true;
          const definitions = weekly
            ? this.taskConfig.weeklyRewards
            : this.taskConfig.dailyRewards;
          const ids = getClaimablePointRewards(
            this.roleData.dailyTask,
            definitions,
            weekly,
          );
          for (const rewardId of ids) {
            this.throwIfInterrupted(tokenId);
            await this.executeGameCommand(
              tokenId,
              weekly ? "task_claimweekreward" : "task_claimdailyreward",
              { rewardId },
              `领取${weekly ? "周常" : "日常"}积分奖励${rewardId}`,
            );
          }
        },
      });
    }
    taskList.push({
      name: "领取通行证奖励",
      execute: () =>
        this.executeGameCommand(
          tokenId,
          "activity_recyclewarorderrewardclaim",
          { actId: 1 },
          "领取通行证奖励",
        ),
    });

    const summary = { completed: 0, skipped: 0, failed: 0, deferred: 0 };
    let supplementalIncomplete = 0;
    const attemptedConditions = new Set();
    const attemptedClaims = new Set();
    const totalTasks = taskList.length;
    this.log(`共有 ${totalTasks} 个步骤；每日任务按本轮服务器详情补差`);
    let claimsStarted = false;
    try {
      for (let i = 0; i < taskList.length; i++) {
        this.throwIfInterrupted(tokenId);
        const task = taskList[i];
        this.activeCondition = task.condition ?? task.claimCondition;
        try {
          if (task.claimCondition !== undefined && !claimsStarted) {
            if (this.roleStateDirty) await this.refreshServerRole(tokenId);
            claimsStarted = true;
          }
          if (this.activeCondition !== undefined) {
            const previous = this.getTaskState(this.activeCondition);
            if (
              task.claimCondition !== undefined
                ? previous.status !== "claimable"
                : previous.status !== "pending"
            ) {
              this.log(`跳过 ${task.name}: 服务器任务列表确认无需执行`);
              summary.skipped++;
              continue;
            }
          }
          if (task.condition !== undefined)
            attemptedConditions.add(task.condition);
          if (task.claimCondition !== undefined)
            attemptedClaims.add(task.claimCondition);
          this.log(`执行中: ${task.name}`);
          const result = await task.execute();
          if (
            result === false &&
            this.activeCondition === undefined &&
            !task.checkOnly
          ) {
            summary.deferred++;
            supplementalIncomplete++;
          } else summary.completed++;
          this.log(
            `${task.name}: ${result === false && !task.checkOnly ? "待继续" : task.condition !== undefined || task.claimCondition !== undefined ? "已执行，等待集中核对服务器状态" : "已处理"}`,
            "info",
          );
          await this.sleep(this.delaySettings.taskDelay);
        } catch (error) {
          if (error.interrupted) throw error;
          summary.failed++;
          if (this.activeCondition === undefined) supplementalIncomplete++;
          this.log(`任务执行失败: ${task.name} - ${error.message}`, "error");
          // Match the original runner: a business rejection fails this step only.
          if (
            !error.serverStateUnavailable &&
            /服务器错误:\s*\d+/.test(error.message || "") &&
            !/\b(?:200400|12400000)\b/.test(error.message || "")
          ) {
            this.throwIfInterrupted(tokenId);
            continue;
          }
          throw error;
        } finally {
          this.activeCondition = undefined;
          this.log(
            `本轮步骤处理进度: ${i + 1}/${totalTasks}（${Math.floor(((i + 1) / totalTasks) * 100)}%），跳过 ${summary.skipped} 项，失败 ${summary.failed} 项`,
          );
        }
      }
    } finally {
      if (
        this.formationChanged &&
        this.originalFormation !== undefined &&
        (!this.tokenStore.getWebSocketStatus ||
          this.tokenStore.getWebSocketStatus(tokenId) === "connected")
      ) {
        this.restoringFormation = true;
        try {
          await this.switchToFormationIfNeeded(
            tokenId,
            this.originalFormation,
            "初始阵容",
          );
        } catch (error) {
          this.log(`阵容还原失败: ${error.message}`, "warning");
        } finally {
          this.restoringFormation = false;
        }
      }
    }
    await this.refreshServerRole(tokenId);
    const serverTasks = getDailyTaskStates(this.roleData, this.taskConfig);
    for (const state of serverTasks) {
      if (
        (attemptedConditions.has(state.condition) &&
          state.status === "pending") ||
        (attemptedClaims.has(state.condition) && state.status !== "claimed")
      )
        summary.deferred++;
    }
    summary.remainingTasks = serverTasks.filter(
      (task) => task.status === "pending",
    ).length;
    summary.unclaimedTasks = serverTasks.filter(
      (task) => task.status === "claimable",
    ).length;
    summary.remainingRewards = [false, true].reduce(
      (count, weekly) =>
        count +
        getClaimablePointRewards(
          this.roleData.dailyTask,
          weekly ? this.taskConfig.weeklyRewards : this.taskConfig.dailyRewards,
          weekly,
        ).length,
      0,
    );
    summary.incomplete =
      summary.remainingTasks +
      summary.unclaimedTasks +
      summary.remainingRewards +
      supplementalIncomplete;
    this.log(
      summary.incomplete
        ? `本轮结束，${summary.incomplete} 个步骤未确认完成；下次重新读取服务器任务列表`
        : "本轮服务器任务补差结束",
      summary.incomplete ? "warning" : "success",
    );
    return summary;
  }
}
