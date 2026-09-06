import { useTokenStore } from "@/stores/tokenStore";
import { ARENA_TARGET, FISH_TARGET } from "@/utils/batch/constants.js";
import { goldItemsConfig, merchantConfig } from "@/utils/dreamConstants";

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

const isTodayAvailable = (statisticsTime) => {
  if (!statisticsTime) return true;

  // 如果有时间戳，检查是否为今天
  const today = new Date().toDateString();
  //系统返回得时间戳是秒，要转换成毫秒
  const recordDate = new Date(statisticsTime * 1000).toDateString();

  return today !== recordDate;
};

const getTodayBossId = () => {
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905]; // 周日~周六
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
};

const isFreeGachaOpenDay = () => {
  const dayOfWeek = new Date().getDay();
  return dayOfWeek === 2 || dayOfWeek === 4 || dayOfWeek === 6;
};

const isMonday = () => {
  return new Date().getDay() === 1;
};

const isDailyDreamOpenDay = () => {
  const dayOfWeek = new Date().getDay();
  return dayOfWeek === 0 || dayOfWeek === 3;
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

const getServerErrorCode = (error) => {
  const messageText = error?.message || "";
  const match = messageText.match(/服务器错误:\s*(\d+)/);
  return match ? Number(match[1]) : null;
};

const DREAM_SELECT_CONTINUE_ERROR_CODES = new Set([2600040]);

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
  constructor(tokenStore, delaySettings = null) {
    this.tokenStore = tokenStore;
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

  async executeGameCommand(
    tokenId,
    cmd,
    params = {},
    description = "",
    timeout = 8000,
  ) {
    try {
      if (description) this.log(`执行: ${description}`);
      const result = await this.tokenStore.sendMessageWithPromise(
        tokenId,
        cmd,
        params,
        timeout,
      );
      await new Promise((resolve) => setTimeout(resolve, this.delaySettings.commandDelay));
      if (description) this.log(`${description} - 成功`, "success");
      return result;
    } catch (error) {
      if (description) {
        const token = this.tokenStore.gameTokens.find((t) => t.id === tokenId);
        const tokenName = token?.name || tokenId;
        this.log(`[${tokenName}] ${description} - 失败: ${error.message}`, "error");
      }
      throw error;
    }
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
      // 尝试从本地缓存获取当前阵容信息
      // 注意：这里直接读取 store 中的 gameData 可能不是最新的，如果是批量跑，建议每次都获取最新的
      // 或者我们假设 tokenStore.gameData 会随着 sendMessage 更新（如果 store 有处理逻辑）
      // 安全起见，这里先从服务器获取

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
      await this.executeGameCommand(
        tokenId,
        "presetteam_saveteam",
        { teamId: targetFormation },
        `切换到${formationName}${targetFormation}`,
      );

      this.log(`成功切换到${formationName}${targetFormation}`, "success");
      return true;
    } catch (error) {
      this.log(`阵容检查失败，尝试强制切换: ${error.message}`, "warning");
      try {
        await this.executeGameCommand(
          tokenId,
          "presetteam_saveteam",
          { teamId: targetFormation },
          `强制切换到${formationName}${targetFormation}`,
        );
        return true;
      } catch (fallbackError) {
        this.log(`强制切换也失败: ${fallbackError.message}`, "error");
        throw fallbackError;
      }
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
    const roleInfoRes = await this.executeGameCommand(
      tokenId,
      "role_getroleinfo",
      {},
      "获取灯神扫荡信息",
      5000,
    );

    const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
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

  async getLatestRole(tokenId, description = "获取最新角色信息") {
    const roleInfoRes = await this.executeGameCommand(
      tokenId,
      "role_getroleinfo",
      {},
      description,
      8000,
    );

    return roleInfoRes?.role || roleInfoRes?.data?.role || {};
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
      role?.statisticsTime?.["artifact:normal:lottery:time"] || 0,
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

      try {
        role = await this.getLatestRole(tokenId, "同步咸神门票库存");
        const latestTickets = role?.items?.[1007]?.quantity || 0;
        if (latestTickets !== ticketsLeft) {
          this.log(`同步最新门票数量: ${latestTickets}`);
          ticketsLeft = latestTickets;
        }
      } catch (error) {
        this.log(`同步咸神门票失败: ${error.message}`, "warning");
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

  async runDreamPurchaseForToken(tokenId, purchaseList) {
    if (purchaseList.length === 0) {
      this.log("未配置梦境购买清单，跳过购买", "warning");
      return;
    }

    const roleInfo = await this.executeGameCommand(
      tokenId,
      "role_getroleinfo",
      {},
      "获取梦境商店数据",
      15000,
    );

    if (!roleInfo?.role?.dungeon?.merchant) {
      throw new Error("无法获取梦境商店数据");
    }

    const merchantData = roleInfo.role.dungeon.merchant;
    const levelId = roleInfo.role.levelId || 0;

    if (levelId < 4000) {
      this.log("关卡数小于4000，跳过梦境购买", "warning");
      return;
    }

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

  async runDreamTask(tokenId) {
    if (!isDailyDreamOpenDay()) {
      this.log("咸王梦境跳过：仅周日、周三开放", "info");
      return;
    }

    const battleTeam = { 0: 107 };
    try {
      await this.executeGameCommand(
        tokenId,
        "dungeon_selecthero",
        { battleTeam },
        "咸王梦境",
        5000,
      );
    } catch (error) {
      const errorCode = getServerErrorCode(error);
      if (!DREAM_SELECT_CONTINUE_ERROR_CODES.has(errorCode)) {
        throw error;
      }
      this.log(`咸王梦境指令返回 ${errorCode}，继续执行梦境购买`, "warning");
    }

    await this.runDreamPurchaseForToken(tokenId, this.loadDreamPurchaseList());
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
        holyBeastFragmentPurchase: false,
        freeGachaEnable: true,
        studyEnable: true,
        dreamEnable: true,
        genieSweepEnable: false,
        monthlyFishTopUpEnable: true,
        monthlyArenaTopUpEnable: true,
      };
      return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
    } catch (error) {
      console.error("Failed to load settings:", error);
      return null;
    }
  }

  async run(tokenId, callbacks = {}, customSettings = null) {
    this.callbacks = callbacks;
    const settings = customSettings || this.loadSettings(tokenId); // 优先使用传入的设置

    // 获取角色信息以确认 roleId 和 任务状态
    this.log("正在获取角色信息...");
    let roleInfoResp;
    try {
      roleInfoResp = await this.tokenStore.sendGetRoleInfo(tokenId);
      this.log("角色信息获取成功", "success");
    } catch (error) {
      this.log(`获取角色信息失败: ${error.message}`, "error");
      throw error;
    }

    const roleData = roleInfoResp?.role;
    if (!roleData) {
      throw new Error("角色数据不存在");
    }

    // 重新加载设置，使用正确的 roleId (虽然通常 tokenId 就是 roleId 或者一一对应，但为了保险)
    // 在这个项目中，tokenId 似乎就是 roleId 或者用于标识
    // DailyTaskStatus.vue 中: const role = getCurrentRole() -> roleId: tokenStore.selectedToken.id
    // 所以 tokenId 就是 key

    this.log("开始执行每日任务补差");

    // 读取并保存当前阵容信息
    let originalFormation = null;
    try {
      this.log("读取当前阵容信息...");
      const teamInfo = await this.executeGameCommand(
        tokenId,
        "presetteam_getinfo",
        {},
        "获取当前阵容信息",
      );
      originalFormation = teamInfo?.presetTeamInfo?.useTeamId;
      this.log(`当前阵容: ${originalFormation}`);
    } catch (error) {
      this.log(`读取当前阵容失败: ${error.message}`, "warning");
    }

    const completedTasks = roleData.dailyTask?.complete ?? {};
    const isTaskCompleted = (taskId) => completedTasks[taskId] === -1;
    const statistics = roleData.statistics ?? {};
    const statisticsTime = roleData.statisticsTime ?? {};
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
    if (!isTaskCompleted(2)) {
      taskList.push({
        name: "分享一次游戏",
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
        execute: () =>
          this.executeGameCommand(tokenId, "friend_batch", {}, "赠送好友金币"),
      });
    }

    if (!isTaskCompleted(4)) {
      taskList.push({
        name: "免费招募",
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "hero_recruit",
            { recruitType: 3, recruitNumber: 1 },
            "免费招募",
          ),
      });

      if (settings.payRecruit && !canRunDiamondBoxPaidRecruit) {
        taskList.push({
          name: "付费招募",
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "hero_recruit",
              { recruitType: 1, recruitNumber: 1 },
              "付费招募",
            ),
        });
      }
    }

    if (!isTaskCompleted(6) && isTodayAvailable(statisticsTime["buy:gold"])) {
      for (let i = 0; i < 3; i++) {
        taskList.push({
          name: `免费点金 ${i + 1}/3`,
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
      taskList.push({
        name: "领取5次挂机奖励",
        execute: () => this.claimHangUpRewardsFiveTimes(tokenId),
      });
      for (let i = 0; i < 4; i++) {
        taskList.push({
          name: `挂机加钟 ${i + 1}/4`,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "system_mysharecallback",
              { isSkipShareCard: true, type: 2 },
              `挂机加钟 ${i + 1}`,
            ),
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
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "item_openbox",
            { itemId: 2001, number: 10 },
            "开启木质宝箱10个",
          ),
      });
    }

    taskList.push({
      name: "停止盐罐计时",
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
      execute: () =>
        this.executeGameCommand(
          tokenId,
          "bottlehelper_start",
          {},
          "开始盐罐计时",
        ),
    });

    if (!isTaskCompleted(14) && settings.claimBottle) {
      taskList.push({
        name: "领取盐罐奖励",
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
        execute: async () => {
          this.log("开始竞技场战斗流程");
          const hour = new Date().getHours();
          if (hour < 6) {
            this.log("当前时间未到6点，跳过竞技场战斗", "warning");
            return;
          }
          if (hour > 22) {
            this.log("当前时间已过22点，跳过竞技场战斗", "warning");
            return;
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

          for (let i = 1; i <= 3; i++) {
            this.log(`竞技场战斗 ${i}/3`);
            let targets;
            try {
              targets = await this.executeGameCommand(
                tokenId,
                "arena_getareatarget",
                {},
                `获取竞技场目标${i}`,
              );
            } catch (err) {
              this.log(
                `竞技场战斗${i} - 获取对手失败: ${err.message}`,
                "error",
              );
              break;
            }

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
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
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

    const todayBossId = getTodayBossId();
    taskList.push({
      name: "每日BOSS阵容检查",
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
      { name: "福利签到", cmd: "system_signinreward" },
      { name: "俱乐部", cmd: "legion_signin" },
      { name: "领取每日礼包", cmd: "discount_claimreward" },
      { name: "领取免费礼包", cmd: "card_claimreward" },
      {
        name: "领取永久卡礼包",
        cmd: "card_claimreward",
        params: { cardId: 4003 },
      },
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

    taskList.push({
      name: "开始领取珍宝阁礼包",
      execute: () =>
        this.executeGameCommand(
          tokenId,
          "collection_goodslist",
          {},
          "开始领取珍宝阁礼包",
        ),
    });
    taskList.push({
      name: "领取珍宝阁免费礼包",
      execute: () =>
        this.executeGameCommand(
          tokenId,
          "collection_claimfreereward",
          {},
          "领取珍宝阁免费礼包",
        ),
    });

    if (
      settings.freeGachaEnable !== false
      && isFreeGachaOpenDay()
      && isTodayAvailable(statisticsTime["gacha:free"])
    ) {
      taskList.push({
        name: "免费扭蛋",
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "gacha_drawreward",
            { num: 1, isGroup: false },
            "免费扭蛋",
          ),
      });
    } else if (
      settings.freeGachaEnable !== false
      && !isFreeGachaOpenDay()
      && isTodayAvailable(statisticsTime["gacha:free"])
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

    const kingdoms = ["魏国", "蜀国", "吴国", "群雄"];
    for (let gid = 1; gid <= 4; gid++) {
      if (isTodayAvailable(statisticsTime[`genie:daily:free:${gid}`])) {
        taskList.push({
          name: `${kingdoms[gid - 1]}灯神免费扫荡`,
          execute: () =>
            this.executeGameCommand(
              tokenId,
              "genie_sweep",
              { genieId: gid },
              `${kingdoms[gid - 1]}灯神免费扫荡`,
            ),
        });
      }
    }

    for (let i = 0; i < 3; i++) {
      taskList.push({
        name: `领取免费扫荡卷 ${i + 1}/3`,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "genie_buysweep",
            {},
            `领取免费扫荡卷 ${i + 1}`,
          ),
      });
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
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "store_purchase",
            { goodsId: 1 },
            "黑市购买1次物品",
          ),
      });
    }

    // 咸王梦境
    if (settings.dreamEnable !== false) {
      taskList.push({
        name: "咸王梦境",
        execute: () => this.runDreamTask(tokenId),
      });
    }

    // 深海灯神
    const dayOfWeek = new Date().getDay();
    if (
      dayOfWeek === 1 &&
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

    // 阵容还原
    if (originalFormation) {
      taskList.push({
        name: "阵容还原",
        execute: () =>
          this.switchToFormationIfNeeded(
            tokenId,
            originalFormation,
            "初始阵容",
          ),
      });
    }

    // 7. 任务奖励
    for (let taskId = 1; taskId <= 10; taskId++) {
      taskList.push({
        name: `领取任务奖励${taskId}`,
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "task_claimdailypoint",
            { taskId },
            `领取任务奖励${taskId}`,
            5000,
          ),
      });
    }

    taskList.push(
      {
        name: "领取日常任务奖励",
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "task_claimdailyreward",
            {},
            "领取日常任务奖励",
          ),
      },
      {
        name: "领取周常任务奖励",
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "task_claimweekreward",
            {},
            "领取周常任务奖励",
          ),
      },
      {
        name: "领取通行证奖励",
        execute: () =>
          this.executeGameCommand(
            tokenId,
            "activity_recyclewarorderrewardclaim",
            { actId: 1 },
            "领取通行证奖励",
          ),
      },
    );

    if (settings.genieSweepEnable === true) {
      taskList.push({
        name: "一键灯神扫荡",
        execute: () => this.runGenieSweepTask(tokenId),
      });
    }

    // 执行
    const totalTasks = taskList.length;
    this.log(`共有 ${totalTasks} 个任务待执行`);

    for (let i = 0; i < taskList.length; i++) {
      const task = taskList[i];
      try {
        await task.execute();
        const progress = Math.floor(((i + 1) / totalTasks) * 100);
        if (this.callbacks?.onProgress) this.callbacks.onProgress(progress);
        await new Promise((resolve) => setTimeout(resolve, this.delaySettings.taskDelay));
      } catch (error) {
        this.log(`任务执行失败: ${task.name} - ${error.message}`, "error");
      }
    }

    if (this.callbacks?.onProgress) this.callbacks.onProgress(100);
    this.log("所有任务执行完成", "success");
  }
}
