import { FishMap, HERO_DICT, LEGION_TECH_NAME } from "@/utils/HeroList";
import { PEACH_TASKS } from "@/utils/PeachTaskIds";
import {
  HELPER_COMMAND_TIMEOUT_MS,
  getErrorMessage,
  getItemQuantity,
  runInventoryVerifiedGameCommand,
} from "@/utils/helperTaskRunner";
import {
  getAffordableLevelCount,
  getHeroLevelCost,
  getHeroOrderCost,
  getLordLevelCost,
  getLordOrderCost,
  getTrumpTransformCost,
  getTrumpUpgradeCost,
  getWarriorResearchCost,
  isAttackTrump,
} from "@/utils/upgradeResourcePlanner";
import { getClaimableAchievementIds } from "@/utils/achievementRewards";
import {
  HERO_STAR_FRAGMENT_COSTS,
  getHeroSynthesisFragmentCost,
  planHeroStarUpgrade,
} from "@/utils/heroStarPlanner";
import {
  planFishArtifactUpgrades,
  planFishBookUpgrades,
} from "@/utils/fishArtifactPlanner";
import { selectBestFishArtifact } from "@/utils/fishArtifactReplacement";
import {
  getHeroFromAwakeningRole,
  isHeroAwakeSlot,
  planHeroAwakenings,
} from "@/utils/heroAwakeningPlanner";
import {
  IRON_ITEM_ID,
  SHOE_TOY_ID,
  SHOE_TOY_UNLOCK_COST,
  TOY_WRENCH_ITEM_ID,
  planToyActiveUpgrades,
  planToyPassiveUpgrades,
} from "@/utils/toyUpgradePlanner";
import {
  GENIE_FACTION_GROUP,
  GENIE_FACTION_LINEUPS,
  GENIE_FACTION_NAMES,
  GROUP_GENIE_LINEUP,
  buildFactionBattleTeam,
  buildGenieBattleParams,
  buildGroupGenieBattleParams,
  didGenieProgress,
  didGroupGenieProgress,
  getRemainingGenieChallenges,
  isSavedGroupGenieFormationMatched,
  selectHighestLevelPet,
} from "@/utils/genieChallengePlanner";
import {
  GENIE_MIN_MAIN_LEVEL,
  isGenieMainLevelUnlocked,
} from "@/utils/dailyFeatureEligibility";

// EquipmentLvConf.lvSpend，区间表示装备从当前等级继续升级所需的精铁。
const EQUIPMENT_IRON_COST_RANGES = [
  [1, 199, 1], [200, 200, 200], [201, 999, 1], [1000, 1000, 1000],
  [1001, 1841, 4], [1842, 1947, 5], [1948, 1999, 6], [2000, 2000, 2700],
  [2001, 2037, 6], [2038, 2117, 7], [2118, 2189, 8], [2190, 2254, 9],
  [2255, 2314, 10], [2315, 2370, 11], [2371, 2422, 12], [2423, 2471, 13],
  [2472, 2517, 14], [2518, 2560, 15], [2561, 2602, 16], [2603, 2642, 17],
  [2643, 2680, 18], [2681, 2716, 19], [2717, 2751, 20], [2752, 2785, 21],
  [2786, 2817, 22], [2818, 2849, 23], [2850, 2879, 24], [2880, 2908, 25],
  [2909, 2937, 26], [2938, 2965, 27], [2966, 2992, 28], [2993, 2999, 29],
  [3000, 3000, 8000], [3001, 3018, 29], [3019, 3044, 30], [3045, 3069, 31],
  [3070, 3093, 32], [3094, 3117, 33], [3118, 3140, 34], [3141, 3163, 35],
  [3164, 3186, 36], [3187, 3207, 37], [3208, 3229, 38], [3230, 3250, 39],
  [3251, 3270, 40], [3271, 3291, 41], [3292, 3311, 42], [3312, 3330, 43],
  [3331, 3349, 44], [3350, 3368, 45], [3369, 3387, 46], [3388, 3405, 47],
  [3406, 3423, 48], [3424, 3440, 49], [3441, 3458, 50], [3459, 3475, 51],
  [3476, 3492, 52], [3493, 3508, 53], [3509, 3525, 54], [3526, 3541, 55],
  [3542, 3557, 56], [3558, 3573, 57], [3574, 3588, 58], [3589, 3604, 59],
  [3605, 3619, 60], [3620, 3634, 61], [3635, 3649, 62], [3650, 3663, 63],
  [3664, 3678, 64], [3679, 3692, 65], [3693, 3706, 66], [3707, 3720, 67],
  [3721, 3734, 68], [3735, 3747, 69], [3748, 3761, 70], [3762, 3774, 71],
  [3775, 3787, 72], [3788, 3800, 73], [3801, 3813, 74], [3814, 3826, 75],
  [3827, 3839, 76], [3840, 3851, 77], [3852, 3864, 78], [3865, 3876, 79],
  [3877, 3888, 80], [3889, 3900, 81], [3901, 3912, 82], [3913, 3924, 83],
  [3925, 3936, 84], [3937, 3948, 85], [3949, 3959, 86], [3960, 3971, 87],
  [3972, 3982, 88], [3983, 3993, 89], [3994, 3999, 90], [4000, 4000, 100],
];

const getEquipmentIronCost = (level) => {
  const currentLevel = Math.max(1, Number(level) || 1);
  if (currentLevel >= 4000) return null;
  return EQUIPMENT_IRON_COST_RANGES.find(
    ([start, end]) => currentLevel >= start && currentLevel <= end,
  )?.[2] ?? null;
};

const FORMATION_UNIVERSAL_FRAGMENT_EXCLUDED_HERO_IDS = new Set([223]);

/** 返回阵容准备可使用的万能碎片；蔡文姬只能消耗专属碎片。 */
export function getFormationUniversalFragment(heroId) {
  const normalizedHeroId = Number(heroId);
  if (FORMATION_UNIVERSAL_FRAGMENT_EXCLUDED_HERO_IDS.has(normalizedHeroId)) {
    return null;
  }
  if (normalizedHeroId >= 101 && normalizedHeroId < 200) {
    return {
      itemId: 3201,
      index: normalizedHeroId - 101,
      name: "万能红碎",
    };
  }
  if (normalizedHeroId >= 201 && normalizedHeroId < 300) {
    return {
      itemId: 3302,
      index: normalizedHeroId - 201,
      name: "万能橙碎",
    };
  }
  return null;
}

/**
 * 开箱、钓鱼、招募类任务
 * 包含: batchOpenBox, batchSmartBoxWeekly, batchClaimBoxPointReward, batchFish, batchRecruit
 */

/**
 * 创建物品类任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksItem(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    connectionQueue,
    batchSettings,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    helperSettings,
    delayConfig,
    activityWeek,
  } = deps;

  const boxNames = {
    2001: "木质宝箱",
    2002: "青铜宝箱",
    2003: "黄金宝箱",
    2004: "铂金宝箱",
  };

  const fishNames = { 1: "普通鱼竿", 2: "黄金鱼竿" };
  const isNoClaimableMailError = (error) => {
    const errorMessage = getErrorMessage(error);
    return (
      errorMessage.includes("3500020") ||
      errorMessage.includes("没有可领取") ||
      errorMessage.includes("无可领取") ||
      errorMessage.includes("无附件")
    );
  };

  /** 收取所有系统邮件附件。 */
  const batchClaimMailAttachments = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;

      try {
        tokenStatus.value[tokenId] = "running";
        await ensureConnection(tokenId);

        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "mail_claimallattachment",
          { category: 0 },
          HELPER_COMMAND_TIMEOUT_MS,
        );
        const rewardCount = Array.isArray(result?.reward)
          ? result.reward.length
          : 0;
        const mailCount = Array.isArray(result?.list)
          ? result.list.filter((mail) => mail?.haveAttachments).length
          : 0;

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message:
            rewardCount > 0 || mailCount > 0
              ? `${tokenName} 邮件附件领取完成：处理${mailCount || "若干"}封邮件，获得${rewardCount}项奖励`
              : `${tokenName} 当前没有可领取的邮件附件`,
          type: rewardCount > 0 || mailCount > 0 ? "success" : "info",
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const noReward = isNoClaimableMailError(error);
        tokenStatus.value[tokenId] = noReward ? "completed" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: noReward
            ? `${tokenName} 当前没有可领取的邮件附件`
            : `${tokenName} 收取邮件失败：${errorMessage}`,
          type: noReward ? "info" : "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
    message.success("收取邮件任务结束");
  };

  /**
   * 领取当前周活动商店的免费福利。
   * 招募周使用“限时商店”(activityId=5)，宝箱周使用活动商店(activityId=7)；
   * 黑市周使用“金砖商店”(activityId=9)，免费商品均为 goodsIndex=0。
   */
  const batchClaimWeeklyActivityBenefit = async () => {
    if (selectedTokens.value.length === 0) return;

    const WEEK_ACTIVITY_INFO_IDS = {
      招募周: 1,
      宝箱周: 2,
      黑市周: 11,
    };
    const WEEK_ACTIVITY_FREE_SHOPS = {
      招募周: { activityId: 5, goodsIndex: 0, shopName: "限时商店" },
      宝箱周: { activityId: 7, goodsIndex: 0, shopName: "活动商店" },
      黑市周: { activityId: 9, goodsIndex: 0, shopName: "金砖商店" },
    };
    const RATE_LIMIT_RETRY_DELAY_MS = 6000;
    const MAX_RATE_LIMIT_RETRIES = 3;
    const wait = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs));
    const isRateLimitError = (error) =>
      /200400|操作太快|操作过快/.test(getErrorMessage(error));
    const isConnectionError = (error) =>
      /timeout|超时|连接|disconnected|websocket/i.test(
        getErrorMessage(error),
      );
    const getActivity = (result) =>
      result?.activity ||
      result?.data?.activity ||
      result?.body?.activity ||
      result?.data?.body?.activity ||
      null;
    const getRewards = (result) =>
      result?.reward ||
      result?.body?.reward ||
      result?.data?.reward ||
      result?.data?.body?.reward ||
      [];

    const runWithRateLimitRetry = async (
      tokenName,
      operationName,
      operation,
    ) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await operation();
        } catch (error) {
          if (
            !isRateLimitError(error) ||
            attempt >= MAX_RATE_LIMIT_RETRIES
          ) {
            throw error;
          }
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${operationName}触发200400，等待6秒后进行第${attempt + 1}次重试`,
            type: "warning",
          });
          await wait(RATE_LIMIT_RETRY_DELAY_MS);
        }
      }
    };

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      const weekName = activityWeek?.value;
      const weeklyInfoId = WEEK_ACTIVITY_INFO_IDS[weekName];
      const freeShop = WEEK_ACTIVITY_FREE_SHOPS[weekName];

      try {
        tokenStatus.value[tokenId] = "running";
        await ensureConnection(tokenId);

        const activityResult = await runWithRateLimitRetry(
          tokenName,
          "查询周活动状态",
          () =>
            tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_get",
              {},
              HELPER_COMMAND_TIMEOUT_MS,
            ),
        );
        const activity = getActivity(activityResult);
        const weeklyInfo =
          weeklyInfoId == null
            ? null
            : activity?.myTotalInfo?.[weeklyInfoId] ??
              activity?.myTotalInfo?.[String(weeklyInfoId)];

        if (!weekName || !weeklyInfo || !freeShop) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前未检测到开放中的周活动福利，跳过领取`,
            type: "info",
          });
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${tokenName} 开始领取${weekName}${freeShop.shopName}免费福利（活动${freeShop.activityId}/商品${freeShop.goodsIndex}） ===`,
          type: "info",
        });

        try {
          const claimResult = await runWithRateLimitRetry(
            tokenName,
            `领取${weekName}活动福利`,
            () =>
              tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_buystoregoods",
                {
                  activityId: freeShop.activityId,
                  goodsIndex: freeShop.goodsIndex,
                  buyNum: 1,
                },
                HELPER_COMMAND_TIMEOUT_MS,
              ),
          );
          const rewards = getRewards(claimResult);
          const rewardText = Array.isArray(rewards)
            ? rewards
                .map(
                  (reward) =>
                    `道具${reward?.itemId ?? reward?.type ?? "未知"}x${reward?.value ?? reward?.quantity ?? 0}`,
                )
                .join("、")
            : "";

          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${weekName}${freeShop.shopName}福利领取成功${rewardText ? `：${rewardText}` : ""}`,
            type: "success",
          });
        } catch (claimError) {
          if (isRateLimitError(claimError) || isConnectionError(claimError)) {
            throw claimError;
          }
          // 免费商品只能领取一次。已领取、商店未开放或商品不可购买均按正常跳过处理。
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${weekName}${freeShop.shopName}福利已领取或当前不可领取，跳过：${getErrorMessage(claimError)}`,
            type: "info",
          });
        }
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 领取周活动福利失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
    message.success("领取周活动福利任务结束");
  };

  /** 达到4001级后，自动领取免费扳手并升级皮鞋玩具及已开放被动技能。 */
  const batchUpgradeShoeToy = async () => {
    if (selectedTokens.value.length === 0) return;

    const getRole = (result) =>
      result?.role ||
      result?.data?.role ||
      result?.body?.role ||
      result?.data?.body?.role ||
      {};
    const getShoeToy = (role) =>
      role?.lordWeapon?.[SHOE_TOY_ID] ??
      role?.lordWeapon?.[String(SHOE_TOY_ID)] ??
      null;
    const operationDelay = Math.max(800, Number(delayConfig.command) || 0);
    const waitForNextOperation = () =>
      new Promise((resolve) => setTimeout(resolve, operationDelay));

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      let activeUpgraded = 0;
      let passiveUpgraded = 0;

      try {
        tokenStatus.value[tokenId] = "running";
        await ensureConnection(tokenId);

        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        let role = getRole(roleInfo);
        const lordLevel = Number(role?.lord?.level) || 0;
        if (lordLevel < 4001) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前主公${lordLevel}级，未达到皮鞋玩具开放所需的4001级，跳过`,
            type: "warning",
          });
          return;
        }

        // 首次进入玩具模块会发放500扳手；随后统一查询最新库存和玩具状态。
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "lordweapon_get",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        );
        await waitForNextOperation();
        roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        role = getRole(roleInfo);
        let shoeToy = getShoeToy(role);
        let wrenchQuantity = getItemQuantity(roleInfo, TOY_WRENCH_ITEM_ID);

        if (!shoeToy) {
          if (wrenchQuantity < SHOE_TOY_UNLOCK_COST) {
            tokenStatus.value[tokenId] = "completed";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 尚未激活皮鞋玩具，当前扳手${wrenchQuantity}/${SHOE_TOY_UNLOCK_COST}，跳过升级`,
              type: "warning",
            });
            return;
          }
          await waitForNextOperation();
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "lordweapon_unlock",
            { weaponId: SHOE_TOY_ID },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 已使用${SHOE_TOY_UNLOCK_COST}个扳手激活皮鞋玩具`,
            type: "success",
          });
          await waitForNextOperation();
          roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          role = getRole(roleInfo);
          shoeToy = getShoeToy(role);
          wrenchQuantity = getItemQuantity(roleInfo, TOY_WRENCH_ITEM_ID);
          if (!shoeToy) throw new Error("激活后未查询到皮鞋玩具信息");
        }

        const activePlan = planToyActiveUpgrades(
          shoeToy.level,
          wrenchQuantity,
        );
        if (activePlan.upgradeCount > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 皮鞋玩具${shoeToy.level || 1}级，当前扳手${wrenchQuantity}个，计划升级${activePlan.upgradeCount}次至${activePlan.finalLevel}级`,
            type: "info",
          });
        }
        for (let index = 0; index < activePlan.upgradeCount; index += 1) {
          if (shouldStop.value) break;
          await waitForNextOperation();
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "lordweapon_upgradeactiveskilllevel",
            { weaponId: SHOE_TOY_ID },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          activeUpgraded += 1;
        }

        const passivePlan = planToyPassiveUpgrades(
          shoeToy.passiveSkill,
          getItemQuantity(roleInfo, IRON_ITEM_ID),
        );
        for (const plan of passivePlan.plans) {
          if (plan.upgradeCount > 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 皮鞋被动技能${plan.skillId}计划升级${plan.upgradeCount}次至${plan.finalLevel}级，预计消耗精铁${plan.spent}个`,
              type: "info",
            });
          }
          for (let index = 0; index < plan.upgradeCount; index += 1) {
            if (shouldStop.value) break;
            await waitForNextOperation();
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "lordweapon_upgradepassiveskilllevel",
              { weaponId: SHOE_TOY_ID, skillId: plan.skillId },
              HELPER_COMMAND_TIMEOUT_MS,
            );
            passiveUpgraded += 1;
          }
          if (shouldStop.value) break;
        }

        await waitForNextOperation();
        const finalRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const finalToy = getShoeToy(getRole(finalRoleInfo));
        const openedPassiveCount = Object.keys(finalToy?.passiveSkill || {}).length;
        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 皮鞋玩具升级完成：主动升级${activeUpgraded}次，当前${finalToy?.level || activePlan.finalLevel}级；${openedPassiveCount}个被动已开放，共升级${passiveUpgraded}次`,
          type: "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 自动升级皮鞋玩具失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
    message.success("自动升级皮鞋玩具任务结束");
  };

  /** 查询角色成就进度，并领取所有当前已经达成的奖励。 */
  const batchClaimAchievementRewards = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      let claimed = 0;

      try {
        tokenStatus.value[tokenId] = "running";
        await ensureConnection(tokenId);
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const role =
          roleInfo?.role ||
          roleInfo?.data?.role ||
          roleInfo?.body?.role ||
          roleInfo?.data?.body?.role ||
          {};
        const claimableIds = getClaimableAchievementIds(
          role.achievement || {},
        );

        if (claimableIds.length === 0) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前没有可领取的成就奖励`,
            type: "info",
          });
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 检测到${claimableIds.length}个可领取的成就奖励`,
          type: "info",
        });

        for (const achievementId of claimableIds) {
          if (shouldStop.value) break;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 正在领取成就类别${achievementId}的当前阶段奖励`,
            type: "info",
          });
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "task_claimachievement",
            { achievementId },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          claimed += 1;
          await new Promise((resolve) =>
            setTimeout(resolve, delayConfig.command),
          );
        }

        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 成就奖励领取完成，共领取${claimed}个`,
          type: claimed > 0 ? "success" : "warning",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 成就奖励领取失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
    message.success("成就奖励领取任务结束");
  };

  /** 使用精铁一键升级指定武将的全部装备。 */
  const batchUpgradeEquipment = async () => {
    if (selectedTokens.value.length === 0) return;

    const heroId = Number(batchSettings.equipmentUpgradeHeroId || 107);
    if (!Number.isSafeInteger(heroId) || !HERO_DICT[heroId]) {
      message.warning("请先在全局任务设置中选择装备升级武将");
      return;
    }

    const heroName = HERO_DICT[heroId].name;
    const ironItemId = 1006;
    const getRole = (result) =>
      result?.role ||
      result?.data?.role ||
      result?.body?.role ||
      result?.data?.body?.role ||
      {};
    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";

      try {
        await ensureConnection(tokenId);
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const ironQuantity = getItemQuantity(roleInfo, ironItemId);
        const role = getRole(roleInfo);
        const heroes = role.heroes || {};
        const hero = heroes[heroId] ?? heroes[String(heroId)];

        if (!hero) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 尚未拥有${heroName}，跳过装备升级`,
            type: "warning",
          });
          return;
        }

        const equipment = hero?.equipment || {};
        const parts = [1, 2, 3, 4]
          .map((position) => equipment[position] ?? equipment[String(position)])
          .filter(Boolean);

        if (parts.length !== 4) {
          throw new Error(`未获取到${heroName}的完整四件装备信息`);
        }

        const upgradeCosts = parts
          .map((part) => getEquipmentIronCost(part.level))
          .filter((cost) => Number.isFinite(cost));
        if (upgradeCosts.length === 0) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${heroName}的四件装备均已满级，跳过升级`,
            type: "warning",
          });
          return;
        }

        const minimumIronCost = Math.min(...upgradeCosts);
        if (ironQuantity < minimumIronCost) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前精铁${ironQuantity}个，四件装备中最低升级需要${minimumIronCost}个，跳过${heroName}装备升级`,
            type: "warning",
          });
          return;
        }

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "equipment_batchupgradelevel",
          { heroId },
          HELPER_COMMAND_TIMEOUT_MS,
        );
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 当前精铁${ironQuantity}个，最低升级消耗${minimumIronCost}个，已一键升级${heroName}装备`,
          type: "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 精铁一键升级${heroName}装备失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("精铁一键升级装备任务结束");
  };

  /** 小号任务：为指定武将换上当前账号拥有的最优普通鱼灵。 */
  const batchReplaceBestFishArtifact = async () => {
    if (selectedTokens.value.length === 0) return;

    const targetHeroId = Number(batchSettings.fishReplacementHeroId || 107);
    if (!Number.isSafeInteger(targetHeroId) || !HERO_DICT[targetHeroId]) {
      message.warning("请先在任务设置中选择鱼灵替换武将");
      return;
    }

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      const heroName = HERO_DICT[targetHeroId]?.name || targetHeroId;

      try {
        await ensureConnection(tokenId);
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const role =
          roleInfo?.role ||
          roleInfo?.data?.role ||
          roleInfo?.body?.role ||
          {};
        const targetHero =
          role?.heroes?.[targetHeroId] ||
          role?.heroes?.[String(targetHeroId)];
        if (!targetHero) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 未拥有${heroName}，跳过鱼灵替换`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        const selectedFish = selectBestFishArtifact(roleInfo, targetHeroId);
        if (!selectedFish) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 没有可替换的红、橙、紫或蓝色鱼灵`,
            type: "info",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        const fishName =
          FishMap[selectedFish.fishId]?.name || `鱼灵${selectedFish.fishId}`;
        if (Number(targetHero.artifactId) === selectedFish.itemId) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${heroName}已装备最优鱼灵${fishName}${selectedFish.star}星，无需替换`,
            type: "success",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        if (
          selectedFish.holderHeroId > 0 &&
          selectedFish.holderHeroId !== targetHeroId
        ) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "artifact_unload",
            { heroId: selectedFish.holderHeroId },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, delayConfig.action),
          );
        }

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "artifact_load",
          {
            heroId: targetHeroId,
            itemId: selectedFish.itemId,
            targetHeroId: -1,
            pearlId: Number(targetHero.pearlId) || 0,
          },
          HELPER_COMMAND_TIMEOUT_MS,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 已为${heroName}替换${fishName}${selectedFish.star}星`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 为${heroName}替换鱼灵失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键替换鱼灵任务结束");
  };

  /** 升级指定武将的梦魇水晶，直到资源不足或服务器拒绝继续升级。 */
  const batchUpgradeCrystal = async () => {
    if (selectedTokens.value.length === 0) return;

    const heroId = Number(batchSettings.crystalHeroId);
    if (!Number.isSafeInteger(heroId) || !HERO_DICT[heroId]) {
      message.warning("请先在任务设置中选择水晶所属武将");
      return;
    }

    const heroName = HERO_DICT[heroId].name;
    const isLocked = batchSettings.crystalLockAttribute !== false;
    const maxUpgradeAttempts = 10000;
    const crystalActionDelay = 3000;
    const crystalRateLimitDelay = 6000;
    const maxCrystalRateLimitRetries = 3;

    const isCrystalRateLimitError = (error) => {
      const errorText = [
        getErrorMessage(error),
        error?.code,
        error?.body?.code,
        error?.data?.code,
        error?.response?.code,
      ].join(" ");
      return errorText.includes("200400") || errorText.includes("操作太快");
    };

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      let upgraded = 0;
      let stopReason = "";

      const executeCrystalOperation = async (operationName, operation) => {
        for (
          let attempt = 0;
          attempt <= maxCrystalRateLimitRetries;
          attempt += 1
        ) {
          try {
            return await operation();
          } catch (error) {
            if (
              !isCrystalRateLimitError(error) ||
              attempt >= maxCrystalRateLimitRetries
            ) {
              throw error;
            }
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${operationName}触发200400，等待6秒后进行第${attempt + 1}次重试`,
              type: "warning",
            });
            await new Promise((resolve) =>
              setTimeout(resolve, crystalRateLimitDelay),
            );
          }
        }
        return null;
      };

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${tokenName} 开始升级${heroName}水晶（${isLocked ? "锁定当前属性" : "不锁定属性"}） ===`,
          type: "info",
        });
        await ensureConnection(tokenId);

        let roleInfo = await executeCrystalOperation(
          "查询水晶状态",
          () => tokenStore.sendGetRoleInfo(tokenId),
        );
        let role = roleInfo?.role || {};
        let hero = getHeroFromRoleInfo(roleInfo, heroId);
        if (!hero) {
          stopReason = `尚未拥有${heroName}`;
        }
        const heroLevel = Number(hero?.level) || 0;
        if (!stopReason && heroLevel < 701) {
          stopReason = `${heroName}当前${heroLevel}级，未达到水晶升级所需的701级`;
        }
        let trumpId = Number(hero?.trumpId) || 0;
        let gold = Math.max(0, Number(role.gold) || 0);
        let diamonds = Math.max(0, Number(role.diamond) || 0);
        let crystalItems = getItemQuantity(roleInfo, 1016);
        if (!stopReason && trumpId <= 0) {
          stopReason = `${heroName}尚未解锁水晶`;
        }

        let transformed = 0;
        const maxTransformAttempts = 100;
        if (!stopReason && !isAttackTrump(trumpId)) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${heroName}当前水晶ID为${trumpId}，不是攻击水晶，开始转换`,
            type: "info",
          });
        }
        while (
          !stopReason &&
          !shouldStop.value &&
          !isAttackTrump(trumpId) &&
          transformed < maxTransformAttempts
        ) {
          const transformCost = getTrumpTransformCost(trumpId);
          if (
            !transformCost ||
            gold < transformCost.gold ||
            crystalItems < transformCost.items
          ) {
            stopReason = `转换攻击水晶资源不足（金币${gold}/${transformCost?.gold ?? "未知"}，水晶材料${crystalItems}/${transformCost?.items ?? "未知"}）`;
            break;
          }

          const transformResult = await executeCrystalOperation(
            "转换攻击水晶",
            () => tokenStore.sendMessageWithPromise(
              tokenId,
              "trump_upgrade",
              { heroId, isLocked: false, isTrans: true },
              10000,
            ),
          );
          transformed += 1;
          await new Promise((resolve) =>
            setTimeout(resolve, crystalActionDelay),
          );

          roleInfo = transformResult?.role
            ? transformResult
            : await executeCrystalOperation(
              "查询转换后的水晶状态",
              () => tokenStore.sendGetRoleInfo(tokenId),
            );
          role = roleInfo?.role || {};
          hero = getHeroFromRoleInfo(roleInfo, heroId);
          if (!hero) {
            stopReason = `转换后未获取到${heroName}信息`;
            break;
          }
          trumpId = Number(hero.trumpId) || 0;
          gold = Math.max(0, Number(role.gold) || 0);
          diamonds = Math.max(0, Number(role.diamond) || 0);
          crystalItems = getItemQuantity(roleInfo, 1016);
        }

        if (
          !stopReason &&
          !isAttackTrump(trumpId) &&
          transformed >= maxTransformAttempts
        ) {
          stopReason = `转换攻击水晶达到安全上限${maxTransformAttempts}次`;
        }
        if (!stopReason && transformed > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${heroName}已转换为攻击水晶，共转换${transformed}次，开始锁定升级`,
            type: "success",
          });
        }
        const lockUpgrade = isLocked || transformed > 0;

        while (
          !stopReason &&
          !shouldStop.value &&
          upgraded < maxUpgradeAttempts
        ) {
          const cost = getTrumpUpgradeCost(trumpId, lockUpgrade);
          if (!cost) {
            stopReason = "水晶已达到最高等级";
            break;
          }
          if (
            gold < cost.gold ||
            crystalItems < cost.items ||
            diamonds < cost.diamonds
          ) {
            stopReason = `资源不足（金币${gold}/${cost.gold}，水晶材料${crystalItems}/${cost.items}${lockUpgrade ? `，金砖${diamonds}/${cost.diamonds}` : ""}）`;
            break;
          }

          try {
            const result = await executeCrystalOperation(
              "升级水晶",
              () => tokenStore.sendMessageWithPromise(
                tokenId,
                "trump_upgrade",
                { heroId, isLocked: lockUpgrade, isTrans: false },
                10000,
              ),
            );
            const resultMessage = result?.msg || result?.message || result?.error || "";
            if (result?.error || (result?.code !== undefined && result.code !== 0)) {
              throw new Error(resultMessage || `服务器返回错误码 ${result.code}`);
            }
            upgraded += 1;
            const updatedRole = result?.role;
            const updatedHero = getHeroFromRoleInfo(result, heroId);
            trumpId = Number(updatedHero?.trumpId) || trumpId + 1;
            gold = Number.isFinite(Number(updatedRole?.gold))
              ? Math.max(0, Number(updatedRole.gold))
              : gold - cost.gold;
            crystalItems = updatedRole?.items
              ? getItemQuantity(result, 1016)
              : crystalItems - cost.items;
            diamonds = Number.isFinite(Number(updatedRole?.diamond))
              ? Math.max(0, Number(updatedRole.diamond))
              : diamonds - cost.diamonds;

            if (upgraded % 10 === 0) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} ${heroName}水晶已连续升级 ${upgraded} 次`,
                type: "info",
              });
            }

            await new Promise((resolve) =>
              setTimeout(resolve, crystalActionDelay),
            );
          } catch (error) {
            stopReason = getErrorMessage(error) || "升级接口执行失败";
            break;
          }
        }

        if (shouldStop.value) stopReason = "用户停止任务";
        if (upgraded >= maxUpgradeAttempts) {
          stopReason = `达到安全上限 ${maxUpgradeAttempts} 次`;
        }

        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${heroName}水晶升级结束：成功${upgraded}次，停止原因：${stopReason || "无法继续升级"}`,
          type: upgraded > 0 ? "success" : "warning",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${heroName}水晶升级失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
    message.success("批量水晶升级任务结束");
  };

  /** 按编号顺序将战士俱乐部科技逐项提升到资源允许的最高等级。 */
  const batchMaxWarriorLegionTech = async () => {
    if (selectedTokens.value.length === 0) return;

    const researchIds = Array.from({ length: 14 }, (_, index) => 101 + index);
    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      let completed = 0;
      let stopReason = "";

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${tokenName} 开始按顺序升级战士俱乐部科技 ===`,
          type: "info",
        });
        await ensureConnection(tokenId);

        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const role = roleInfo?.role || {};
        if (!role.legionId) {
          stopReason = "尚未加入俱乐部";
        }
        let gold = Math.max(0, Number(role.gold) || 0);
        const currentResearch = role.legionResearch || {};
        let legionCoins = 0;
        if (!stopReason) {
          const legionResult = await tokenStore.sendMessageWithPromise(
            tokenId,
            "legion_getinfo",
            {},
            HELPER_COMMAND_TIMEOUT_MS,
          );
          const legionInfo =
            legionResult?.info ||
            legionResult?.body?.info ||
            legionResult?.data?.info ||
            legionResult?.data?.body?.info ||
            {};
          const member =
            legionInfo.members?.[role.roleId] ??
            legionInfo.members?.[String(role.roleId)];
          legionCoins = Math.max(
            0,
            Number(member?.custom?.legion_coin_cnt) || 0,
          );
        }

        for (const researchId of researchIds) {
          if (stopReason || shouldStop.value) {
            if (shouldStop.value) stopReason = "用户停止任务";
            break;
          }

          const techName = LEGION_TECH_NAME[researchId] || `科技${researchId}`;
          const currentLevel =
            Number(
              currentResearch[researchId] ??
                currentResearch[String(researchId)] ??
                0,
            ) || 0;
          let plannedLevel = currentLevel;
          let plannedGold = 0;
          let plannedLegionCoins = 0;
          for (let level = currentLevel + 1; ; level += 1) {
            const cost = getWarriorResearchCost(researchId, level);
            if (!cost) break;
            if (
              plannedGold + cost.gold > gold ||
              plannedLegionCoins + cost.legionCoins > legionCoins
            ) {
              break;
            }
            plannedGold += cost.gold;
            plannedLegionCoins += cost.legionCoins;
            plannedLevel = level;
          }

          const nextCost = getWarriorResearchCost(
            researchId,
            currentLevel + 1,
          );
          if (!nextCost) {
            completed += 1;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${techName}（${researchId}）已经满级，继续下一项`,
              type: "info",
            });
            continue;
          }
          if (plannedLevel === currentLevel) {
            stopReason = `${techName}（${researchId}）资源不足：金币${gold}/${nextCost.gold}，科技点${legionCoins}/${nextCost.legionCoins}`;
            break;
          }

          try {
            const result = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legion_research",
              { researchId, isMax: true },
              10000,
            );
            const resultMessage = result?.msg || result?.message || result?.error || "";
            if (result?.error || (result?.code !== undefined && result.code !== 0)) {
              throw new Error(resultMessage || `服务器返回错误码 ${result.code}`);
            }

            completed += 1;
            gold -= plannedGold;
            legionCoins -= plannedLegionCoins;
            currentResearch[researchId] = plannedLevel;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${techName}（${researchId}）已从${currentLevel}级升级至${plannedLevel}级，消耗金币${plannedGold}、科技点${plannedLegionCoins}`,
              type: "success",
            });
          } catch (error) {
            const errorMessage = getErrorMessage(error);
            if (errorMessage.includes("满级") || errorMessage.includes("最高等级")) {
              completed += 1;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} ${techName}（${researchId}）已经满级，继续下一项`,
                type: "info",
              });
            } else {
              stopReason = `${techName}（${researchId}）：${errorMessage}`;
              break;
            }
          }

          await new Promise((resolve) =>
            setTimeout(resolve, delayConfig.command),
          );
        }

        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message:
            completed === researchIds.length
              ? `${tokenName} 战士俱乐部科技已全部处理完成`
              : `${tokenName} 战士科技升级停止：已处理${completed}/${researchIds.length}项，${stopReason || "资源不足或无法继续升级"}`,
          type: completed === researchIds.length ? "success" : "warning",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 战士科技升级失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    currentRunningTokenId.value = null;
    isRunning.value = false;
    shouldStop.value = false;
    message.success("批量战士科技升级任务结束");
  };

  const smartBoxDefinitions = [
    { id: 2001, name: "木质宝箱", points: 1, batchSize: 10, reserve: 200 },
    { id: 2002, name: "青铜宝箱", points: 10, batchSize: 10 },
    { id: 2003, name: "黄金宝箱", points: 20, batchSize: 10 },
    { id: 2004, name: "铂金宝箱", points: 50, batchSize: 10 },
  ];

  const getSmartBoxInventory = (roleInfo) => {
    const items =
      roleInfo?.role?.items ||
      roleInfo?.data?.role?.items ||
      roleInfo?.items ||
      roleInfo?.data?.items ||
      {};

    return Object.fromEntries(
      smartBoxDefinitions.map((box) => {
        const item = items[box.id] ?? items[String(box.id)] ?? 0;
        const quantity =
          item && typeof item === "object"
            ? (item.quantity ?? item.count ?? 0)
            : item;
        return [box.id, Number(quantity) || 0];
      }),
    );
  };

  const getSmartBoxPoints = (inventory, selectedTypes) =>
    smartBoxDefinitions
      .filter((box) => selectedTypes.includes(box.id))
      .reduce(
        (total, box) =>
          total +
          Math.max(0, (inventory[box.id] || 0) - (box.reserve || 0)) *
            box.points,
        0,
      );

  const getSmartBoxCandidates = (inventory, selectedTypes) =>
    smartBoxDefinitions
      .filter((box) => selectedTypes.includes(box.id))
      .map((box) => ({
        ...box,
        availableCount: Math.max(
          0,
          Math.trunc(inventory[box.id] || 0) - (box.reserve || 0),
        ),
      }))
      .filter((box) => box.availableCount > 0)
      .sort((left, right) => right.points - left.points);

  // 库存够时只开到目标分数；库存不够时开完当前全部可用宝箱。
  // 开箱接口支持最后一批少于10个，因此规划按单个宝箱计算。
  const buildSmartBoxRefillPlan = (
    inventory,
    selectedTypes,
    targetPoints,
  ) => {
    const candidates = getSmartBoxCandidates(inventory, selectedTypes);
    if (candidates.length === 0) return null;

    const safeTarget = Math.max(0, Math.trunc(Number(targetPoints) || 0));
    const availablePoints = candidates.reduce(
      (total, box) => total + box.availableCount * box.points,
      0,
    );
    const boxes = [];

    if (availablePoints <= safeTarget) {
      candidates.forEach((box) => {
        boxes.push({ ...box, count: box.availableCount });
      });
    } else {
      let remainingPoints = safeTarget;

      candidates.forEach((box) => {
        if (remainingPoints <= 0) return;
        const count = Math.min(
          box.availableCount,
          Math.floor(remainingPoints / box.points),
        );
        if (count <= 0) return;
        boxes.push({ ...box, count });
        remainingPoints -= count * box.points;
      });

      if (remainingPoints > 0) {
        const usedCounts = new Map(boxes.map((box) => [box.id, box.count]));
        const tailBox = [...candidates]
          .reverse()
          .find((box) => (usedCounts.get(box.id) || 0) < box.availableCount);
        if (tailBox) {
          const existing = boxes.find((box) => box.id === tailBox.id);
          if (existing) existing.count += 1;
          else boxes.push({ ...tailBox, count: 1 });
        }
      }
    }

    const points = boxes.reduce(
      (total, box) => total + box.count * box.points,
      0,
    );
    if (points <= 0) return null;

    return {
      boxes,
      points,
    };
  };

  const heroIds = Object.keys(HERO_DICT).map(Number);
  const starFragmentCosts = HERO_STAR_FRAGMENT_COSTS;
  const HERO_STAR_ACTION_DELAY_MS = 1500;
  const HERO_STAR_RATE_LIMIT_DELAY_MS = 6000;
  const HERO_STAR_MAX_RATE_LIMIT_RETRIES = 4;
  const lastStarBookActionAt = new Map();
  const waitForStarBookActionInterval = async (tokenId) => {
    const lastActionAt = lastStarBookActionAt.get(tokenId) || 0;
    const waitMs = Math.max(
      0,
      HERO_STAR_ACTION_DELAY_MS - (Date.now() - lastActionAt),
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastStarBookActionAt.set(tokenId, Date.now());
  };
  const waitForHeroStarInterval = waitForStarBookActionInterval;
  const waitForBookActionInterval = waitForStarBookActionInterval;

  const heroLevelOrderThresholds = [
    { level: 100, order: 1 },
    { level: 200, order: 2 },
    { level: 300, order: 3 },
    { level: 500, order: 4 },
    { level: 700, order: 5 },
    { level: 900, order: 6 },
    { level: 1100, order: 7 },
    { level: 1300, order: 8 },
    { level: 1500, order: 9 },
    { level: 1800, order: 10 },
    { level: 2100, order: 11 },
    { level: 2400, order: 12 },
    { level: 2800, order: 13 },
    { level: 3200, order: 14 },
    { level: 3600, order: 15 },
    { level: 4000, order: 16 },
    { level: 4500, order: 17 },
    { level: 5000, order: 18 },
    { level: 5500, order: 19 },
    { level: 6000, order: 20 },
  ];

  const getHeroFromRoleInfo = (roleInfo, heroId) => {
    const heroes = roleInfo?.role?.heroes;
    if (!heroes) return null;

    if (Array.isArray(heroes)) {
      return heroes.find((hero) => Number(hero?.heroId) === Number(heroId));
    }

    return heroes[heroId] || heroes[String(heroId)] || null;
  };

  const getUpgradeableHeroIds = (roleInfo) =>
    heroIds.filter((heroId) => {
      const currentStar =
        Number(getHeroFromRoleInfo(roleInfo, heroId)?.star) || 0;
      const fragmentCost = Number(starFragmentCosts[currentStar]) || 0;
      return (
        currentStar < 30 &&
        fragmentCost > 0 &&
        getItemQuantity(roleInfo, heroId) >= fragmentCost
      );
    });

  const getHeroStarUpgradeCount = (roleInfo, heroId) => {
    const hero = getHeroFromRoleInfo(roleInfo, heroId);
    return planHeroStarUpgrade({
      heroId,
      hero,
      fragmentQuantity: getItemQuantity(roleInfo, heroId),
    });
  };

  const getBookUpgradePlan = (roleInfo) =>
    heroIds
      .map((heroId) => {
        const hero = getHeroFromRoleInfo(roleInfo, heroId);
        const star = Number(hero?.star) || 0;
        const bookStar = Number(hero?.bookStar) || 0;
        return { heroId, star, bookStar, upgradeCount: star - bookStar };
      })
      .filter(({ upgradeCount }) => upgradeCount > 0);

  const isSuccessfulBookCommand = (result) =>
    Boolean(
      result &&
        (result.role?.heroes ||
          result.role?.book ||
          result.role?.artifactBooks ||
          result.code === 0 ||
          result.success === true ||
          result.result === 0),
    );

  const isSuccessfulHeroCommand = (result) =>
    Boolean(
      result &&
        (result.role?.heroes ||
          result.code === 0 ||
          result.success === true ||
          result.result === 0),
    );

  const isHeroStarRateLimitError = (error) => {
    const text = [
      getErrorMessage(error),
      error?.code,
      error?.body?.code,
      error?.data?.code,
      error?.response?.code,
    ].join(" ");
    return text.includes("200400") || text.includes("操作太快");
  };

  const isHeroSynthesisRetryableError = (error) => {
    const text = [
      getErrorMessage(error),
      error?.code,
      error?.body?.code,
      error?.data?.code,
      error?.response?.code,
    ].join(" ");
    return (
      isHeroStarRateLimitError(error) ||
      text.includes("200020") ||
      text.includes("200050") ||
      text.includes("-10006") ||
      text.includes("超时") ||
      text.toLowerCase().includes("timeout")
    );
  };

  const getRoleInfoWithStarRateLimitRetry = async (
    tokenId,
    tokenName,
    operationName,
  ) => {
    for (
      let attempt = 0;
      attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
      attempt += 1
    ) {
      try {
        await waitForStarBookActionInterval(tokenId);
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        // 查询响应后重新计时，避免下一条升星或图鉴指令紧接着发出。
        lastStarBookActionAt.set(tokenId, Date.now());
        return roleInfo;
      } catch (error) {
        if (
          !isHeroStarRateLimitError(error) ||
          attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
        ) {
          throw error;
        }
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${operationName}触发200400，等待6秒后进行第${attempt + 1}次重试`,
          type: "warning",
        });
        await new Promise((resolve) =>
          setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
        );
      }
    }
    return null;
  };

  /** 武将升星完成后，继续同步图鉴星级并领取全部可领取奖励。 */
  const batchAutoStarBook = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始自动升星图鉴: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        let roleInfo = await getRoleInfoWithStarRateLimitRetry(
          tokenId,
          token.name,
          "开始任务前查询状态",
        );
        const starUpgradePlan = heroIds
          .map((heroId) => getHeroStarUpgradeCount(roleInfo, heroId))
          .filter(({ upgradeCount, needsSynthesis }) =>
            needsSynthesis || upgradeCount > 0,
          );
        const synthesisCount = starUpgradePlan.filter(
          ({ needsSynthesis }) => needsSynthesis,
        ).length;
        addLog({
          time: new Date().toLocaleTimeString(),
          message:
            starUpgradePlan.length > 0
              ? `${token.name} 检测到${starUpgradePlan.length}名可处理武将${synthesisCount > 0 ? `，其中${synthesisCount}名需要先合成` : ""}，共计划升星${starUpgradePlan.reduce((sum, item) => sum + item.upgradeCount, 0)}次：${starUpgradePlan.map(({ heroId, upgradeCount, needsSynthesis }) => `${HERO_DICT[heroId]?.name || heroId}${needsSynthesis ? "合成后" : ""}${upgradeCount}次`).join("、")}`
              : `${token.name} 当前没有可升星武将`,
          type: "info",
        });

        for (const { heroId, upgradeCount, needsSynthesis } of starUpgradePlan) {
          if (shouldStop.value) break;
          const heroName = HERO_DICT[heroId]?.name || `英雄ID:${heroId}`;
          if (needsSynthesis) {
            let synthesized = false;
            for (
              let attempt = 0;
              attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
              attempt += 1
            ) {
              try {
                await waitForHeroStarInterval(tokenId);
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "hero_synthetic",
                  { itemId: heroId },
                  HELPER_COMMAND_TIMEOUT_MS,
                );
                synthesized = true;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} ${heroName}合成成功`,
                  type: "success",
                });
                break;
              } catch (error) {
                if (
                  !isHeroSynthesisRetryableError(error) ||
                  attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
                ) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} ${heroName}合成失败，已跳过升星：${getErrorMessage(error)}`,
                    type: "warning",
                  });
                  break;
                }
                await new Promise((resolve) =>
                  setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
                );
              }
            }
            if (!synthesized) continue;
          }
          for (let index = 0; index < upgradeCount && !shouldStop.value; index += 1) {
            let commandCompleted = false;
            for (
              let attempt = 0;
              attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
              attempt += 1
            ) {
              try {
                await waitForHeroStarInterval(tokenId);
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "hero_heroupgradestar",
                  { heroId },
                  HELPER_COMMAND_TIMEOUT_MS,
                );
                commandCompleted = true;
                break;
              } catch (error) {
                const errorMessage = getErrorMessage(error);
                const isRateLimited = isHeroStarRateLimitError(error);
                if (
                  !isRateLimited ||
                  attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
                ) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} ${heroName}升星失败，已跳过：${errorMessage}`,
                    type: "warning",
                  });
                  break;
                }
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} ${heroName}升星触发200400，等待6秒后进行第${attempt + 1}次重试`,
                  type: "warning",
                });
                await new Promise((resolve) =>
                  setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
                );
              }
            }

            if (!commandCompleted) break;
          }
        }

        if (starUpgradePlan.length > 0 && !shouldStop.value) {
          await new Promise((resolve) =>
            setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
          );
          roleInfo = await getRoleInfoWithStarRateLimitRetry(
            tokenId,
            token.name,
            "武将升星完成后查询状态",
          );

          let synthesisReconciled = false;
          for (const { heroId, needsSynthesis } of starUpgradePlan) {
            if (!needsSynthesis || shouldStop.value) continue;
            if (getHeroFromRoleInfo(roleInfo, heroId)) continue;
            const latestPlan = getHeroStarUpgradeCount(roleInfo, heroId);
            if (!latestPlan.needsSynthesis) continue;

            const heroName = HERO_DICT[heroId]?.name || `英雄ID:${heroId}`;
            try {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} ${heroName}首次合成未生效，等待6秒后补发合成`,
                type: "warning",
              });
              await new Promise((resolve) =>
                setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
              );
              await waitForHeroStarInterval(tokenId);
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_synthetic",
                { itemId: heroId },
                HELPER_COMMAND_TIMEOUT_MS,
              );
              synthesisReconciled = true;
            } catch (error) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} ${heroName}补发合成仍失败：${getErrorMessage(error)}`,
                type: "warning",
              });
            }
          }

          if (synthesisReconciled && !shouldStop.value) {
            await new Promise((resolve) =>
              setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
            );
            roleInfo = await getRoleInfoWithStarRateLimitRetry(
              tokenId,
              token.name,
              "补发合成后查询状态",
            );
          }

          for (const { heroId, currentStar, upgradeCount, needsSynthesis } of starUpgradePlan) {
            const latestHero = getHeroFromRoleInfo(roleInfo, heroId);
            const latestStar = Number(latestHero?.star) || 0;
            addLog({
              time: new Date().toLocaleTimeString(),
              message:
                latestHero && latestStar >= currentStar + upgradeCount
                  ? `${token.name} ${HERO_DICT[heroId]?.name || heroId}：${currentStar}星 → ${latestStar}星`
                  : `${token.name} ${HERO_DICT[heroId]?.name || heroId}${needsSynthesis ? "计划先合成并" : "计划"}升星${upgradeCount}次，实际${latestHero ? `${currentStar}星 → ${latestStar}星` : "未合成"}`,
              type:
                latestHero && latestStar >= currentStar + upgradeCount
                  ? "success"
                  : "warning",
            });
          }
        }

        if (!shouldStop.value) {
          const fishUpgradePlan = planFishArtifactUpgrades(roleInfo);
          addLog({
            time: new Date().toLocaleTimeString(),
            message:
              fishUpgradePlan.length > 0
                ? `${token.name} 开始自动合成鱼灵：共计划${fishUpgradePlan.length}次（优先处理高星鱼灵）`
                : `${token.name} 当前没有可合成的鱼灵`,
            type: "info",
          });

          let fishUpgraded = 0;
          const failedFishIds = new Set();
          for (const operation of fishUpgradePlan) {
            if (shouldStop.value) break;
            if (failedFishIds.has(operation.fishId)) continue;
            const fishName = FishMap[operation.fishId]?.name || `鱼灵${operation.fishId}`;
            let completed = false;
            for (
              let attempt = 0;
              attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
              attempt += 1
            ) {
              try {
                await waitForHeroStarInterval(tokenId);
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "artifact_upgradestar",
                  { heroId: operation.heroId, itemId: operation.itemId },
                  HELPER_COMMAND_TIMEOUT_MS,
                );
                completed = true;
                fishUpgraded += 1;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} ${fishName}：${operation.star}星 → ${operation.star + 1}星`,
                  type: "success",
                });
                break;
              } catch (error) {
                if (
                  !isHeroStarRateLimitError(error) ||
                  attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
                ) {
                  addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} ${fishName}${operation.star}星合成失败，已跳过：${getErrorMessage(error)}`,
                    type: "warning",
                  });
                  break;
                }
                await new Promise((resolve) =>
                  setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
                );
              }
            }
            if (!completed) {
              failedFishIds.add(operation.fishId);
            }
          }

          if (fishUpgradePlan.length > 0 && !shouldStop.value) {
            await new Promise((resolve) =>
              setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
            );
            roleInfo = await getRoleInfoWithStarRateLimitRetry(
              tokenId,
              token.name,
              "鱼灵升星完成后查询状态",
            );
          }

          const fishBookPlan = planFishBookUpgrades(roleInfo);
          let fishBookUpgraded = 0;
          if (fishBookPlan.length > 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 开始鱼灵图鉴升星：${fishBookPlan.length}种鱼灵，共${fishBookPlan.reduce((sum, item) => sum + item.upgradeCount, 0)}次`,
              type: "info",
            });
          }
          for (const { fishId, upgradeCount } of fishBookPlan) {
            if (shouldStop.value) break;
            for (
              let upgradeIndex = 0;
              upgradeIndex < upgradeCount;
              upgradeIndex += 1
            ) {
              if (shouldStop.value) break;
              let completed = false;
              for (
                let attempt = 0;
                attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
                attempt += 1
              ) {
                try {
                  await waitForBookActionInterval(tokenId);
                  const result = await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "book_upgradeartifact",
                    { artifactId: fishId },
                    HELPER_COMMAND_TIMEOUT_MS,
                  );
                  if (!isSuccessfulBookCommand(result)) {
                    throw new Error(`鱼灵${fishId}图鉴升星响应未确认成功`);
                  }
                  completed = true;
                  fishBookUpgraded += 1;
                  break;
                } catch (error) {
                  if (
                    !isHeroStarRateLimitError(error) ||
                    attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
                  ) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} ${FishMap[fishId]?.name || `鱼灵${fishId}`}图鉴升星失败，已跳过：${getErrorMessage(error)}`,
                      type: "warning",
                    });
                    break;
                  }
                  await new Promise((resolve) =>
                    setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
                  );
                }
              }
              if (!completed) break;
            }
          }

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 鱼灵合成${fishUpgraded}次，鱼灵图鉴升星${fishBookUpgraded}次`,
            type: "success",
          });
        }

        if (!shouldStop.value) {
          await new Promise((resolve) =>
            setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
          );
          roleInfo = await getRoleInfoWithStarRateLimitRetry(
            tokenId,
            token.name,
            "武将图鉴开始前查询状态",
          );
          const bookUpgradePlan = getBookUpgradePlan(roleInfo);
          addLog({
            time: new Date().toLocaleTimeString(),
            message:
              bookUpgradePlan.length > 0
                ? `${token.name} 开始图鉴升星：${bookUpgradePlan.length}名武将，共${bookUpgradePlan.reduce((sum, item) => sum + item.upgradeCount, 0)}次`
                : `${token.name} 当前没有需要图鉴升星的武将`,
            type: "info",
          });

          let bookUpgraded = 0;
          for (const { heroId, upgradeCount } of bookUpgradePlan) {
            if (shouldStop.value) break;
            for (
              let index = 0;
              index < upgradeCount && !shouldStop.value;
              index += 1
            ) {
              for (
                let attempt = 0;
                attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
                attempt += 1
              ) {
                try {
                  await waitForBookActionInterval(tokenId);
                  const result = await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "book_upgrade",
                    { heroId },
                    HELPER_COMMAND_TIMEOUT_MS,
                  );
                  if (!isSuccessfulBookCommand(result)) {
                    throw new Error("图鉴升星响应未确认成功");
                  }
                  bookUpgraded += 1;
                  break;
                } catch (error) {
                  if (
                    !isHeroStarRateLimitError(error) ||
                    attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
                  ) {
                    throw error;
                  }
                  await new Promise((resolve) =>
                    setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
                  );
                }
              }
            }
          }

          if (bookUpgradePlan.length > 0 && !shouldStop.value) {
            await new Promise((resolve) =>
              setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
            );
            roleInfo = await getRoleInfoWithStarRateLimitRetry(
              tokenId,
              token.name,
              "武将图鉴完成后校验状态",
            );
            const remainingBookPlan = getBookUpgradePlan(roleInfo);
            if (remainingBookPlan.length > 0) {
              throw new Error(
                `图鉴升星校验失败，仍有${remainingBookPlan.reduce((sum, item) => sum + item.upgradeCount, 0)}次未完成`,
              );
            }
          }

          let claimedRewards = 0;
          for (
            let attempt = 0;
            attempt < 10 && !shouldStop.value;
            attempt += 1
          ) {
            try {
              await waitForBookActionInterval(tokenId);
              const result = await tokenStore.sendMessageWithPromise(
                tokenId,
                "book_claimpointreward",
                {},
                HELPER_COMMAND_TIMEOUT_MS,
              );
              if (!isSuccessfulBookCommand(result)) break;
              claimedRewards += 1;
            } catch (_error) {
              // 没有更多可领取奖励时，服务端以失败响应结束领取循环。
              break;
            }
          }
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 图鉴升星${bookUpgraded}次，领取图鉴奖励${claimedRewards}次`,
            type: "success",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 自动升星图鉴完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `自动升星图鉴失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("自动升星图鉴任务结束");
  };

  /** 小号任务：按全局配置为已满足条件的红将觉醒技能。 */
  const batchAwakenHeroSkills = async () => {
    if (selectedTokens.value.length === 0) return;

    const selectedHeroIds = [
      ...new Set((batchSettings.awakeningHeroIds || []).map(Number)),
    ].filter(
      (heroId) =>
        Number.isSafeInteger(heroId) &&
        heroId >= 101 &&
        heroId < 200 &&
        HERO_DICT[heroId],
    );
    if (selectedHeroIds.length === 0) {
      message.warning("请先在全局任务设置中选择需要觉醒的红色武将");
      return;
    }

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";
      const completedPlan = [];

      try {
        await ensureConnection(tokenId);
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const awakeningPlan = planHeroAwakenings(roleInfo, selectedHeroIds);

        if (awakeningPlan.length === 0) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 所选红将当前没有满足条件的可觉醒技能`,
            type: "info",
          });
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 已确认${awakeningPlan.length}个可觉醒技能：${awakeningPlan.map(({ heroId, index }) => `${HERO_DICT[heroId]?.name || heroId}第${index + 1}技能`).join("、")}`,
          type: "info",
        });

        for (const operation of awakeningPlan) {
          if (shouldStop.value) break;
          const heroName = HERO_DICT[operation.heroId]?.name || operation.heroId;
          let completed = false;
          for (
            let attempt = 0;
            attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
            attempt += 1
          ) {
            try {
              await waitForHeroStarInterval(tokenId);
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_skillawake",
                { heroId: operation.heroId, index: operation.index },
                HELPER_COMMAND_TIMEOUT_MS,
              );
              completed = true;
              completedPlan.push(operation);
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} ${heroName}第${operation.index + 1}技能觉醒指令执行成功`,
                type: "success",
              });
              break;
            } catch (error) {
              if (
                !isHeroStarRateLimitError(error) ||
                attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
              ) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${tokenName} ${heroName}第${operation.index + 1}技能觉醒失败，已跳过：${getErrorMessage(error)}`,
                  type: "warning",
                });
                break;
              }
              await new Promise((resolve) =>
                setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
              );
            }
          }
          if (!completed) continue;
        }

        if (completedPlan.length > 0 && !shouldStop.value) {
          await new Promise((resolve) =>
            setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
          );
          roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        }

        const verifiedCount = completedPlan.filter(({ heroId, index }) =>
          isHeroAwakeSlot(getHeroFromAwakeningRole(roleInfo, heroId), index),
        ).length;
        tokenStatus.value[tokenId] =
          verifiedCount === completedPlan.length ? "completed" : "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 技能觉醒完成：计划${awakeningPlan.length}个，指令成功${completedPlan.length}个，复查确认${verifiedCount}个`,
          type:
            verifiedCount === completedPlan.length ? "success" : "warning",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 自动技能觉醒失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    currentRunningTokenId.value = null;
    isRunning.value = false;
    message.success("自动技能觉醒任务结束");
  };

  /**
   * 将单个武将升级并自动进阶到目标等级。
   */
  const upgradeSingleHero = async (
    tokenId,
    tokenName,
    heroId,
    targetLevel,
    initialRoleInfo = null,
  ) => {
    const heroName = HERO_DICT[heroId]?.name || `英雄ID:${heroId}`;
    const roleInfo =
      initialRoleInfo || (await tokenStore.sendGetRoleInfo(tokenId));
    let hero = getHeroFromRoleInfo(roleInfo, heroId);

    if (!hero) {
      throw new Error(`账号中未找到${heroName}`);
    }

    let currentLevel = Number(hero.level) || 0;
    let currentOrder = Number(hero.order) || 0;
    let remainingGold = Math.max(0, Number(roleInfo?.role?.gold) || 0);
    let remainingStones = getItemQuantity(roleInfo, 1003);
    let performedActions = 0;
    let stopReason = "";

    if (currentLevel >= targetLevel) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${heroName}当前${currentLevel}级，已达到目标，跳过操作`,
        type: "info",
      });
      return {
        reachedTarget: true,
        currentLevel,
        currentOrder,
        stopReason: "",
      };
    }

    while (!shouldStop.value) {
      const nextOrder = heroLevelOrderThresholds.find(
        (item) => item.order > currentOrder,
      );

      if (nextOrder && currentLevel >= nextOrder.level) {
        const orderCost = getHeroOrderCost(currentOrder);
        if (!orderCost || remainingStones < orderCost.stones) {
          stopReason = `进阶石不足：当前${remainingStones}个，进阶需要${orderCost?.stones ?? "未知"}个`;
          break;
        }
        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_heroupgradeorder",
          { heroId },
          5000,
        );

        if (!isSuccessfulHeroCommand(result)) {
          throw new Error(`进阶失败（当前${currentLevel}级）`);
        }

        remainingStones -= orderCost.stones;
        currentOrder += 1;
        performedActions += 1;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${heroName}已自动进阶至${currentOrder}阶（${currentLevel}级）`,
          type: "success",
        });
        await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
        continue;
      }

      if (currentLevel >= targetLevel) {
        break;
      }

      const levelBoundary = Math.min(
        targetLevel,
        nextOrder?.level || targetLevel,
      );
      const affordable = getAffordableLevelCount({
        currentLevel,
        maximumLevel: levelBoundary,
        maximumCount: 50,
        gold: remainingGold,
        getCost: getHeroLevelCost,
      });
      const upgradeNum = affordable.count;

      if (upgradeNum <= 0) {
        const nextCost = getHeroLevelCost(currentLevel);
        stopReason = `金币不足：当前${remainingGold}，升至下一级需要${nextCost ?? "未知"}`;
        break;
      }

      const result = await tokenStore.sendMessageWithPromise(
        tokenId,
        "hero_heroupgradelevel",
        {
          heroId,
          upgradeNum,
        },
        5000,
      );

      if (!isSuccessfulHeroCommand(result)) {
        throw new Error(`升级${upgradeNum}级失败（当前${currentLevel}级）`);
      }

      remainingGold -= affordable.goldCost;
      currentLevel += upgradeNum;
      performedActions += 1;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${heroName}升级至${currentLevel}级`,
        type: "success",
      });
      await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
    }

    if (performedActions > 0 && !shouldStop.value) {
      const latestRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
      const latestHero = getHeroFromRoleInfo(latestRoleInfo, heroId);
      if (latestHero) {
        currentLevel = Number(latestHero.level) || currentLevel;
        currentOrder = Number(latestHero.order) || currentOrder;
      }
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: shouldStop.value
        ? `${tokenName} ${heroName}升级任务已停止，当前${currentLevel}级`
        : stopReason
          ? `${tokenName} ${heroName}升级停止：${stopReason}，当前${currentLevel}级/${currentOrder}阶`
          : `${tokenName} ${heroName}已完成至${currentLevel}级`,
      type: shouldStop.value || stopReason ? "warning" : "success",
    });
    return {
      reachedTarget: currentLevel >= targetLevel,
      currentLevel,
      currentOrder,
      stopReason,
    };
  };

  const upgradeLordToLevel = async (
    tokenId,
    tokenName,
    targetLevel,
    initialRoleInfo = null,
  ) => {
    const roleInfo =
      initialRoleInfo || (await tokenStore.sendGetRoleInfo(tokenId));
    let lord = roleInfo?.role?.lord;
    if (!lord) throw new Error("未获取到主公信息");

    let currentLevel = Number(lord.level) || 0;
    let currentOrder = Number(lord.order) || 0;
    let remainingGold = Math.max(0, Number(roleInfo?.role?.gold) || 0);
    let remainingStones = getItemQuantity(roleInfo, 1003);
    let performedActions = 0;
    let stopReason = "";
    while (!shouldStop.value && currentLevel < targetLevel) {
      const nextOrder = heroLevelOrderThresholds.find(
        (item) => item.order > currentOrder,
      );

      if (nextOrder && currentLevel >= nextOrder.level) {
        const orderCost = getLordOrderCost(currentOrder);
        if (!orderCost || remainingStones < orderCost.stones) {
          stopReason = `进阶石不足：当前${remainingStones}个，主公进阶需要${orderCost?.stones ?? "未知"}个`;
          break;
        }
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_lordupgradeorder",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        );
        remainingStones -= orderCost.stones;
        currentOrder += 1;
        performedActions += 1;
      } else {
        const levelBoundary = Math.min(
          targetLevel,
          nextOrder?.level || targetLevel,
        );
        const affordable = getAffordableLevelCount({
          currentLevel,
          maximumLevel: levelBoundary,
          maximumCount: 50,
          gold: remainingGold,
          getCost: getLordLevelCost,
        });
        const upgradeNum = affordable.count;
        if (upgradeNum <= 0) {
          const nextCost = getLordLevelCost(currentLevel);
          stopReason = `金币不足：当前${remainingGold}，主公升至下一级需要${nextCost ?? "未知"}`;
          break;
        }
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_lordupgradelevel",
          { upgradeNum },
          HELPER_COMMAND_TIMEOUT_MS,
        );
        remainingGold -= affordable.goldCost;
        currentLevel += upgradeNum;
        performedActions += 1;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
      );
    }

    if (performedActions > 0 && !shouldStop.value) {
      const latestRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
      lord = latestRoleInfo?.role?.lord;
      currentLevel = Number(lord?.level) || currentLevel;
      currentOrder = Number(lord?.order) || currentOrder;
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: stopReason
        ? `${tokenName} 主公升级停止：${stopReason}，当前${currentLevel}级（${currentOrder}阶）`
        : `${tokenName} 主公已升级至${currentLevel}级（${currentOrder}阶）`,
      type: stopReason ? "warning" : "success",
    });
    return {
      reachedTarget: currentLevel >= targetLevel,
      currentLevel,
      currentOrder,
      stopReason,
    };
  };

  const upgradeLordAndLuBu = async (tokenId, tokenName) => {
    const LU_BU_ID = 107;
    const MAX_BALANCE_ROUNDS = 100;

    for (let round = 0; round < MAX_BALANCE_ROUNDS; round += 1) {
      if (shouldStop.value) break;
      const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
      const lord = roleInfo?.role?.lord;
      const luBu = getHeroFromRoleInfo(roleInfo, LU_BU_ID);
      if (!lord || !luBu) throw new Error("未获取到主公或吕布信息");

      const lordLevel = Number(lord.level) || 0;
      const lordOrder = Number(lord.order) || 0;
      const luBuLevel = Number(luBu.level) || 0;
      const luBuOrder = Number(luBu.order) || 0;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 当前主公${lordLevel}级/${lordOrder}阶，吕布${luBuLevel}级/${luBuOrder}阶`,
        type: "info",
      });

      // 同阶时升级主公；主公领先一阶后升级吕布，二者按阶数交替培养。
      if (lordOrder > luBuOrder) {
        if (luBuLevel >= lordLevel && luBuOrder < lordOrder) {
          const orderCost = getHeroOrderCost(luBuOrder);
          const stones = getItemQuantity(roleInfo, 1003);
          if (!orderCost || stones < orderCost.stones) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 吕布进阶石不足：当前${stones}个，需要${orderCost?.stones ?? "未知"}个，停止主公和吕布升级`,
              type: "warning",
            });
            break;
          }
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "hero_heroupgradeorder",
            { heroId: LU_BU_ID },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          await new Promise((resolve) =>
            setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
          );
          continue;
        }
        const upgradeResult = await upgradeSingleHero(
          tokenId,
          tokenName,
          LU_BU_ID,
          lordLevel,
          roleInfo,
        );
        if (upgradeResult.stopReason) break;
        continue;
      }

      const nextLordLevel = heroLevelOrderThresholds.find(
        (item) => item.level > lordLevel,
      )?.level;
      if (!nextLordLevel) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 主公已达到当前自动升级上限，主公和吕布升级结束`,
          type: "info",
        });
        break;
      }
      const upgradeResult = await upgradeLordToLevel(
        tokenId,
        tokenName,
        nextLordLevel,
        roleInfo,
      );
      if (upgradeResult.stopReason) break;
    }
  };

  const sendFormationPreparationCommand = async (
    tokenId,
    tokenName,
    command,
    params,
    operationName,
  ) => {
    for (
      let attempt = 0;
      attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
      attempt += 1
    ) {
      try {
        await waitForHeroStarInterval(tokenId);
        return await tokenStore.sendMessageWithPromise(
          tokenId,
          command,
          params,
          HELPER_COMMAND_TIMEOUT_MS,
        );
      } catch (error) {
        if (
          !isHeroStarRateLimitError(error) ||
          attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
        ) {
          throw error;
        }
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${operationName}触发200400，等待6秒后进行第${attempt + 1}次重试`,
          type: "warning",
        });
        await new Promise((resolve) =>
          setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
        );
      }
    }
    return null;
  };

  /** 培养阵容前先确认武将；碎片不足时仅在万能碎片足够补齐时转换并合成。 */
  const ensureFormationHeroOwned = async (
    tokenId,
    tokenName,
    heroId,
    initialRoleInfo = null,
  ) => {
    let roleInfo =
      initialRoleInfo || (await tokenStore.sendGetRoleInfo(tokenId));
    if (getHeroFromRoleInfo(roleInfo, heroId)) {
      return { owned: true, roleInfo };
    }

    const heroName = HERO_DICT[heroId]?.name || `英雄ID:${heroId}`;
    const synthesisCost = getHeroSynthesisFragmentCost(heroId);
    const fragmentQuantity = getItemQuantity(roleInfo, heroId);
    const missingQuantity = Math.max(0, synthesisCost - fragmentQuantity);
    const universal = getFormationUniversalFragment(heroId);
    const universalQuantity = universal
      ? getItemQuantity(roleInfo, universal.itemId)
      : 0;

    if (
      fragmentQuantity + universalQuantity < synthesisCost ||
      (missingQuantity > 0 && !universal)
    ) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 未拥有${heroName}，合成需要${synthesisCost}个碎片；当前专属${fragmentQuantity}个${universal ? `、${universal.name}${universalQuantity}个` : ""}，资源不足，跳过`,
        type: "info",
      });
      return { owned: false, roleInfo };
    }

    if (missingQuantity > 0) {
      await sendFormationPreparationCommand(
        tokenId,
        tokenName,
        "item_openpack",
        {
          itemId: universal.itemId,
          number: missingQuantity,
          index: universal.index,
        },
        `转换${heroName}碎片`,
      );
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} 使用${missingQuantity}个${universal.name}补足${heroName}合成碎片`,
        type: "success",
      });
    }

    await sendFormationPreparationCommand(
      tokenId,
      tokenName,
      "hero_synthetic",
      { itemId: heroId },
      `合成${heroName}`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
    );
    roleInfo = await getRoleInfoWithStarRateLimitRetry(
      tokenId,
      tokenName,
      `确认${heroName}合成结果`,
    );
    const owned = Boolean(getHeroFromRoleInfo(roleInfo, heroId));
    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} ${heroName}${owned ? "合成成功" : "合成后未在武将列表中确认"}`,
      type: owned ? "success" : "warning",
    });
    return { owned, roleInfo };
  };

  /** 小号任务：将所选账号的主公直接升级至6000级。 */
  const batchUpgradeLordTo6000 = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((tokenId) => {
      tokenStatus.value[tokenId] = "waiting";
    });

    // 主公升级请求较密集，多账号串行处理，避免同一时间连续触发服务器限频。
    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始主公升级至6000级: ${tokenName} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        const upgradeResult = await upgradeLordToLevel(
          tokenId,
          tokenName,
          6000,
        );
        tokenStatus.value[tokenId] = shouldStop.value
          ? "stopped"
          : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: shouldStop.value
            ? `${tokenName} 主公升级任务已停止`
            : upgradeResult.reachedTarget
              ? `${tokenName} 主公升级至6000级任务完成`
              : `${tokenName} 主公升级已跳过后续操作：${upgradeResult.stopReason || `当前${upgradeResult.currentLevel}级，资源不足`}`,
          type:
            shouldStop.value || !upgradeResult.reachedTarget
              ? "warning"
              : "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 主公升级至6000级失败：${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    }
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("所选小号的主公升级任务已结束");
  };

  /**
   * 批量将多个指定武将升级并自动进阶到目标等级。
   * 目标等级必须由页面限制为50的整数倍；每次升级最多发送50级，避免跨过进阶阈值。
   */
  const batchHeroLevelUpgrade = async (heroIdsToUpgrade, targetLevel) => {
    if (selectedTokens.value.length === 0) return;

    const normalizedHeroIds = [
      ...new Set(
        (Array.isArray(heroIdsToUpgrade)
          ? heroIdsToUpgrade
          : [heroIdsToUpgrade]
        ).map(Number),
      ),
    ];
    const normalizedTargetLevel = Number(targetLevel);

    if (
      normalizedHeroIds.length === 0 ||
      normalizedHeroIds.some((heroId) => !HERO_DICT[heroId]) ||
      !Number.isInteger(normalizedTargetLevel) ||
      normalizedTargetLevel < 50 ||
      normalizedTargetLevel > 6000 ||
      normalizedTargetLevel % 50 !== 0
    ) {
      message.warning("请选择有效武将，目标等级必须是50的整数倍（50-6000）");
      return;
    }

    const heroNames = normalizedHeroIds.map((heroId) => HERO_DICT[heroId].name);

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始批量升级武将至${normalizedTargetLevel}级: ${tokenName} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        let hasError = false;
        for (const heroId of normalizedHeroIds) {
          if (shouldStop.value) break;

          try {
            await upgradeSingleHero(
              tokenId,
              tokenName,
              heroId,
              normalizedTargetLevel,
            );
          } catch (error) {
            hasError = true;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${HERO_DICT[heroId].name}升级失败: ${error.message}，继续处理其他武将`,
              type: "error",
            });
          }
        }

        tokenStatus.value[tokenId] = hasError ? "failed" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: shouldStop.value
            ? `${tokenName} 批量武将升级任务已停止`
            : `${tokenName} 批量武将升级完成（目标：${normalizedTargetLevel}级）`,
          type: hasError ? "warning" : shouldStop.value ? "warning" : "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 批量武将升级失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success(`批量升级${heroNames.join("、")}结束`);
  };

  const getRoleTeamHeroes = (roleInfoResult) => {
    const role =
      roleInfoResult?.role ||
      roleInfoResult?.data?.role ||
      roleInfoResult?.body?.role ||
      {};
    return Object.entries(role.heroes || {})
      .map(([key, hero]) => ({
        heroId: Number(hero?.heroId ?? hero?.id ?? key),
        slot: Number(hero?.battleTeamSlot),
        level: Number(hero?.level) || 1,
        order: Number(hero?.order) || 0,
      }))
      .filter(
        (hero) =>
          Number.isFinite(hero.heroId) &&
          Number.isFinite(hero.slot) &&
          hero.slot >= 0,
      );
  };

  const runFormationCommand = async (
    tokenId,
    tokenName,
    command,
    params,
    actionName,
  ) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await tokenStore.sendMessageWithPromise(
          tokenId,
          command,
          params,
          HELPER_COMMAND_TIMEOUT_MS,
        );
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const transientError =
          /200020|200050|200400|操作太快|未知错误|重启游戏/.test(
            errorMessage,
          );
        if (!transientError || attempt >= 3) throw error;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${actionName}触发临时错误，等待6秒后进行第${attempt + 1}次重试：${errorMessage}`,
          type: "warning",
        });
        await new Promise((resolve) => setTimeout(resolve, 6000));
      }
    }
  };

  const applyTargetFormation = async ({
    tokenId,
    tokenName,
    targetHeroes,
    formationName,
    recycleSlots = new Set(),
  }) => {
    const currentRoleInfo = await runFormationCommand(
      tokenId,
      tokenName,
      "role_getroleinfo",
      {},
      "查询当前战斗阵容",
    );
    const currentHeroes = getRoleTeamHeroes(currentRoleInfo);

    for (const target of targetHeroes) {
      const targetCurrent = currentHeroes.find(
        (hero) => hero.heroId === target.heroId,
      );
      if (targetCurrent?.slot === target.slot) continue;

      if (targetCurrent) {
        await runFormationCommand(
          tokenId,
          tokenName,
          "hero_gobackbattle",
          { slot: targetCurrent.slot },
          `${HERO_DICT[target.heroId]?.name || target.heroId}从${targetCurrent.slot + 1}号位下阵`,
        );
        currentHeroes.splice(currentHeroes.indexOf(targetCurrent), 1);
        await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
      }

      const currentAtTargetSlot = currentHeroes.find(
        (hero) => hero.slot === target.slot,
      );
      if (currentAtTargetSlot) {
        await runFormationCommand(
          tokenId,
          tokenName,
          "hero_exchange",
          {
            heroId: currentAtTargetSlot.heroId,
            targetHeroId: target.heroId,
          },
          `${HERO_DICT[currentAtTargetSlot.heroId]?.name || currentAtTargetSlot.heroId}更换为${HERO_DICT[target.heroId]?.name || target.heroId}`,
        );
        currentAtTargetSlot.heroId = target.heroId;
      } else {
        await runFormationCommand(
          tokenId,
          tokenName,
          "hero_gointobattle",
          { heroId: target.heroId, slot: target.slot },
          `${HERO_DICT[target.heroId]?.name || target.heroId}上阵`,
        );
        currentHeroes.push({ heroId: target.heroId, slot: target.slot });
      }
      await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
    }

    const targetHeroIds = new Set(targetHeroes.map((hero) => hero.heroId));
    for (const hero of [...currentHeroes]) {
      if (targetHeroIds.has(hero.heroId)) continue;
      await runFormationCommand(
        tokenId,
        tokenName,
        "hero_gobackbattle",
        { slot: hero.slot },
        `${hero.slot + 1}号位多余武将下阵`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
      if (
        recycleSlots.has(hero.slot) &&
        (hero.level > 1 || hero.order > 0)
      ) {
        await runFormationCommand(
          tokenId,
          tokenName,
          "hero_rebirth",
          { heroId: hero.heroId },
          `${HERO_DICT[hero.heroId]?.name || hero.heroId}资源回收`,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 已回收${hero.slot + 1}号位${HERO_DICT[hero.heroId]?.name || hero.heroId}的培养资源`,
          type: "success",
        });
        await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
    const verifiedRoleInfo = await runFormationCommand(
      tokenId,
      tokenName,
      "role_getroleinfo",
      {},
      `校验${formationName}`,
    );
    const verifiedHeroes = getRoleTeamHeroes(verifiedRoleInfo);
    const invalidTarget = targetHeroes.find(
      (target) =>
        !verifiedHeroes.some(
          (hero) =>
            hero.heroId === target.heroId && hero.slot === target.slot,
        ),
    );
    if (invalidTarget) {
      throw new Error(
        `${HERO_DICT[invalidTarget.heroId]?.name || invalidTarget.heroId}未处于${invalidTarget.slot + 1}号位`,
      );
    }
    const extraHero = verifiedHeroes.find(
      (hero) => !targetHeroIds.has(hero.heroId),
    );
    if (extraHero) {
      throw new Error(
        `${extraHero.slot + 1}号位仍有多余武将${HERO_DICT[extraHero.heroId]?.name || extraHero.heroId}`,
      );
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} ${formationName}已调整：${targetHeroes
        .map((hero) => `${hero.slot + 1}号位${HERO_DICT[hero.heroId]?.name}`)
        .join("、")}`,
      type: "success",
    });
  };

  const adjustMainLevelFormation = async (tokenId, tokenName) => {
    const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
    const ownedHeroIds = new Set(
      Object.values(roleInfo?.role?.heroes || {}).map((hero) =>
        Number(hero?.heroId ?? hero?.id),
      ),
    );
    const targetHeroes = [
      { heroId: 107, slot: 0 },
      { heroId: 110, slot: 1 },
      { heroId: 104, slot: 2 },
      { heroId: 106, slot: 3 },
      { heroId: ownedHeroIds.has(223) ? 223 : 204, slot: 4 },
    ].filter((target) => ownedHeroIds.has(target.heroId));
    await applyTargetFormation({
      tokenId,
      tokenName,
      targetHeroes,
      formationName: "推图默认阵容",
    });
  };

  const adjustEarlyMainLevelFormation = async (
    tokenId,
    tokenName,
    ownedHeroIds,
  ) => {
    const supportHeroId = ownedHeroIds.has(223) ? 223 : 204;
    const targetHeroes = [
      { heroId: 107, slot: 0 },
      { heroId: supportHeroId, slot: 2 },
      { heroId: 106, slot: 3 },
    ].filter((target) => ownedHeroIds.has(target.heroId));
    await applyTargetFormation({
      tokenId,
      tokenName,
      targetHeroes,
      formationName: "前期推图阵容",
      recycleSlots: new Set([1, 4]),
    });
  };

  /** 小号前期推图：吕布必需，优先培养蔡文姬，否则培养张飞，并搭配太史慈。 */
  const batchAdjustEarlyMainLevelFormation = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始前期推图阵容调整: ${tokenName} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const luBuResult = await ensureFormationHeroOwned(
          tokenId,
          tokenName,
          107,
          roleInfo,
        );
        roleInfo = luBuResult.roleInfo;
        if (!luBuResult.owned) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 吕布无法合成，前期推图培养及阵容均不调整`,
            type: "info",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        const caiWenJiResult = await ensureFormationHeroOwned(
          tokenId,
          tokenName,
          223,
          roleInfo,
        );
        roleInfo = caiWenJiResult.roleInfo;
        let supportHeroId = 223;
        if (!caiWenJiResult.owned) {
          const zhangFeiResult = await ensureFormationHeroOwned(
            tokenId,
            tokenName,
            204,
            roleInfo,
          );
          roleInfo = zhangFeiResult.roleInfo;
          supportHeroId = zhangFeiResult.owned ? 204 : null;
        }
        const taiShiCiResult = await ensureFormationHeroOwned(
          tokenId,
          tokenName,
          106,
          roleInfo,
        );
        roleInfo = taiShiCiResult.roleInfo;
        const ownedHeroIds = new Set(
          Object.values(roleInfo?.role?.heroes || {}).map((hero) =>
            Number(hero?.heroId ?? hero?.id),
          ),
        );

        for (const heroId of [supportHeroId, 106]) {
          if (shouldStop.value) break;
          if (!heroId || !ownedHeroIds.has(heroId)) continue;
          try {
            await upgradeSingleHero(tokenId, tokenName, heroId, 750);
          } catch (error) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${HERO_DICT[heroId].name}升级至750级停止：${error.message}`,
              type: "warning",
            });
            // 培养失败后服务器可能仍处于短暂忙碌状态，冷却后再调整阵容。
            await new Promise((resolve) => setTimeout(resolve, 6000));
          }
        }

        if (!shouldStop.value) {
          try {
            await upgradeLordAndLuBu(tokenId, tokenName);
          } catch (error) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 主公和吕布升级停止：${error.message || "资源不足或未知错误"}`,
              type: "warning",
            });
            // 进阶材料不足等失败后先等待服务器状态稳定，再切换阵容。
            await new Promise((resolve) => setTimeout(resolve, 6000));
          }
        }

        if (!shouldStop.value) {
          // 即使资源预判后没有发送升级指令，也与后续阵容查询保持间隔。
          await new Promise((resolve) =>
            setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
          );
          await adjustEarlyMainLevelFormation(
            tokenId,
            tokenName,
            ownedHeroIds,
          );
        }
        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 前期推图阵容调整失败：${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("小号前期推图阵容调整完成");
  };

  /** 小号推图准备：按拥有情况升级武将并设置默认推图阵容。 */
  const batchAdjustMainLevelFormation = async () => {
    if (selectedTokens.value.length === 0) return;

    const upgradeGroups = [
      {
        targetLevel: 900,
        heroIds: [223, 202, 204, 110, 104, 106, 116, 112, 312],
      },
      { targetLevel: 250, heroIds: [210, 217] },
    ];

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始小号推图准备: ${tokenName} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);

        for (const group of upgradeGroups) {
          for (const heroId of group.heroIds) {
            if (shouldStop.value) break;
            const ownershipResult = await ensureFormationHeroOwned(
              tokenId,
              tokenName,
              heroId,
              roleInfo,
            );
            roleInfo = ownershipResult.roleInfo;
            if (!ownershipResult.owned) continue;

            try {
              await upgradeSingleHero(
                tokenId,
                tokenName,
                heroId,
                group.targetLevel,
              );
            } catch (error) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} ${HERO_DICT[heroId].name}升级失败: ${error.message}`,
                type: "warning",
              });
            }
          }
        }

        const luBuResult = await ensureFormationHeroOwned(
          tokenId,
          tokenName,
          107,
          roleInfo,
        );
        roleInfo = luBuResult.roleInfo;
        if (!shouldStop.value && luBuResult.owned) {
          try {
            await upgradeLordAndLuBu(tokenId, tokenName);
          } catch (error) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 主公和吕布升级停止：${error.message || "资源不足或未知错误"}`,
              type: "warning",
            });
          }
        }

        if (!shouldStop.value) {
          // 主公/吕布资源不足时升级会直接结束；等待后再查询并调整阵容。
          await new Promise((resolve) =>
            setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
          );
          await adjustMainLevelFormation(tokenId, tokenName);
        }
        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 小号推图准备失败: ${error.message || "未知错误"}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("小号推图默认阵容调整完成");
  };

  /**
   * 批量图鉴升星
   */
  const batchBookUpgrade = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始图鉴升星: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const upgradePlan = getBookUpgradePlan(roleInfo);
        addLog({
          time: new Date().toLocaleTimeString(),
          message:
            upgradePlan.length > 0
              ? `${token.name} 检测到${upgradePlan.length}名武将需要图鉴升星，共${upgradePlan.reduce((sum, item) => sum + item.upgradeCount, 0)}次`
              : `${token.name} 当前没有需要图鉴升星的武将`,
          type: "info",
        });

        for (const { heroId, upgradeCount } of upgradePlan) {
          const heroName = HERO_DICT[heroId]?.name || `英雄ID:${heroId}`;
          let completed = 0;
          for (let i = 0; i < upgradeCount && !shouldStop.value; i += 1) {
            for (
              let attempt = 0;
              attempt <= HERO_STAR_MAX_RATE_LIMIT_RETRIES;
              attempt += 1
            ) {
              try {
                await waitForBookActionInterval(tokenId);
                const result = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "book_upgrade",
                  { heroId },
                  HELPER_COMMAND_TIMEOUT_MS,
                );
                if (!isSuccessfulBookCommand(result)) {
                  throw new Error("图鉴升星响应未确认成功");
                }
                completed += 1;
                break;
              } catch (error) {
                const errorMessage = getErrorMessage(error);
                const rateLimited =
                  errorMessage.includes("200400") ||
                  errorMessage.includes("操作太快");
                if (
                  !rateLimited ||
                  attempt >= HERO_STAR_MAX_RATE_LIMIT_RETRIES
                ) {
                  throw error;
                }
                await new Promise((resolve) =>
                  setTimeout(resolve, HERO_STAR_RATE_LIMIT_DELAY_MS),
                );
              }
            }
          }
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} ${heroName}图鉴升星完成：${completed}次`,
            type: "success",
          });
        }

        if (upgradePlan.length > 0 && !shouldStop.value) {
          // 完整计划执行期间不查询，最后一次操作后留出间隔再统一校验。
          await new Promise((resolve) =>
            setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
          );
          const latestRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          const remainingPlan = getBookUpgradePlan(latestRoleInfo);
          if (remainingPlan.length > 0) {
            throw new Error(
              `仍有${remainingPlan.reduce((sum, item) => sum + item.upgradeCount, 0)}次图鉴升星未完成`,
            );
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 图鉴升星完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `图鉴升星失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量图鉴升星结束");
  };

  /**
   * 批量领取图鉴奖励
   */
  const batchClaimStarRewards = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取图鉴奖励: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        for (let i = 1; i <= 10; i++) {
          if (shouldStop.value) break;
          try {
            const res = await tokenStore.sendMessageWithPromise(
              tokenId,
              "book_claimpointreward",
              {},
              5000,
            );
            const ok =
              res && (res.code === 0 || res.success === true || res.result === 0);

            if (ok) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 领取图鉴奖励成功`,
                type: "success",
              });
            } else {
              // 如果领取失败（比如没有奖励可领了），停止尝试
              throw new Error("领取奖励失败");
            }
          } catch (err) {
            // 失败则停止尝试
            break;
          }
          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取图鉴奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `领取图鉴奖励失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取图鉴奖励结束");
  };

  /**
   * 领取宝箱积分
   */
  const batchClaimBoxPointReward = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取宝箱积分: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_batchclaimboxpointreward",
          {},
          5000,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝箱积分领取成功`,
          type: "success",
        });

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `领取失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取宝箱积分结束");
  };

  /**
   * 批量领取蟠桃园任务
   */
  const batchClaimPeachTasks = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始领取蟠桃园任务奖励: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "legion_getpayloadtask",
          {},
          5000
        );

        const payloadTask = res?.payloadTask || res?.data?.payloadTask;

        if (payloadTask && payloadTask.taskMap) {
          const taskMap = payloadTask.taskMap;
          const tasks = [];
          Object.values(taskMap).forEach((item) => {
            const availableTasks = PEACH_TASKS.filter(
              (t) =>
                t.type === item.typ &&
                item.progress >= t.target &&
                item.claimedProgress < t.target,
            );
            tasks.push(...availableTasks);
          });

          let claimedCount = 0;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 获取到 ${tasks.length} 个任务奖励`,
            type: "info",
          });

          for (const task of tasks) {
            if (shouldStop.value) break;
            // status not reliable or not present, try claim all
            try {
              const claimRes = await tokenStore.sendMessageWithPromise(
                tokenId,
                "legion_claimpayloadtask",
                { taskId: task.id },
                5000
              );
              const ok = claimRes && claimRes.payloadTask;
              if (ok) {
                claimedCount++;
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 领取${task.desc}任务奖励成功`,
                  type: "success",
                });
              }

            } catch (err) {
              // ignore
            }
            await new Promise((r) => setTimeout(r, delayConfig.action));
          }

          // Check and claim point rewards (Moved out of loop to ensure execution)
          try {
            const progressMapres = await tokenStore.sendMessageWithPromise(
              tokenId,
              "legion_getpayloadtask",
              {},
              5000
            );
            
            if (progressMapres && progressMapres.payloadTask) {
                const legionPoint = progressMapres.payloadTask.legionPoint || 0;
                const selfPoint = progressMapres.payloadTask.selfPoint || 0;
                // progressMap key might be string or number, handle both safely
                const progressMap = progressMapres.payloadTask.progressMap || {};
                const taskGroupprogressMap = progressMap[1] || progressMap["1"] || 0;
                const selfPointprogressMap = progressMap[2] || progressMap["2"] || 0;

                // Club Rewards - Claim all if progress is greater than claimed progress
                if (legionPoint > taskGroupprogressMap && taskGroupprogressMap < 25) {
                  try {
                    await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "legion_claimpayloadtaskprogress",
                      { taskGroup: 1 },
                      5000
                    );
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取俱乐部任务奖励 (当前积分: ${legionPoint})`,
                      type: "success",
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                  } catch (e) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取俱乐部任务奖励失败: ${e.message}`,
                      type: "error",
                    });
                  }
                }

                // Personal Rewards - Claim all if progress is greater than claimed progress
                if (selfPoint > selfPointprogressMap && selfPointprogressMap < 25) {
                  try {
                    await tokenStore.sendMessageWithPromise(
                      tokenId,
                      "legion_claimpayloadtaskprogress",
                      { taskGroup: 2 },
                      5000
                    );
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取个人任务奖励 (当前积分: ${selfPoint})`,
                      type: "success",
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                  } catch (e) {
                    addLog({
                      time: new Date().toLocaleTimeString(),
                      message: `${token.name} 领取个人任务奖励失败: ${e.message}`,
                      type: "error",
                    });
                  }
                }
            }
          } catch (err) {
             console.error("领取蟠桃园积分奖励异常:", err);
             addLog({
               time: new Date().toLocaleTimeString(),
               message: `${token.name} 领取积分奖励异常: ${err.message}`,
               type: "error",
             });
          }

          if (claimedCount === 0) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 没有可领取的任务奖励`,
              type: "info",
            });
          }

        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 未获取到任务奖励列表`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 领取蟠桃园任务奖励完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 领取蟠桃园任务奖励失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量领取蟠桃园任务奖励结束");
  };

  /** 使用固定群雄阵容连续挑战灯神，失败或今日次数耗尽时停止。 */
  const batchChallengeGroupGenie = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始自动挑战群雄灯神: ${tokenName} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        let role = roleInfo?.role || {};

        if (!isGenieMainLevelUnlocked(role)) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前主线关卡${Number(role.levelId) || 0}，未达到灯神开启条件${GENIE_MIN_MAIN_LEVEL}关，跳过`,
            type: "info",
          });
          tokenStatus.value[tokenId] = "completed";
          continue;
        }

        let allHeroesOwned = true;
        for (const target of GROUP_GENIE_LINEUP) {
          const ownership = await ensureFormationHeroOwned(
            tokenId,
            tokenName,
            target.heroId,
            roleInfo,
          );
          roleInfo = ownership.roleInfo;
          if (!ownership.owned) {
            allHeroesOwned = false;
            break;
          }
        }
        if (!allHeroesOwned) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 群雄灯神阵容不完整且无法合成，停止挑战`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          continue;
        }

        for (const target of GROUP_GENIE_LINEUP) {
          if (shouldStop.value || target.minLevel <= 1) continue;
          const result = await upgradeSingleHero(
            tokenId,
            tokenName,
            target.heroId,
            target.minLevel,
            roleInfo,
          );
          if (!result.reachedTarget) break;
          roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        }
        if (shouldStop.value) break;

        roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        role = roleInfo?.role || {};
        const underLevelHero = GROUP_GENIE_LINEUP.find((target) =>
          Number(getHeroFromRoleInfo(roleInfo, target.heroId)?.level || 0)
            < target.minLevel,
        );
        if (underLevelHero) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${HERO_DICT[underLevelHero.heroId].name}未达到${underLevelHero.minLevel}级，停止群雄灯神挑战`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          continue;
        }

        const savedFormationMatched = isSavedGroupGenieFormationMatched(role);
        const params = buildGroupGenieBattleParams(role);
        const pet = selectHighestLevelPet(role);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 群雄灯神独立阵容${savedFormationMatched ? "已匹配，直接复用" : "不匹配，将在首次挑战时调整"}：1号公孙瓒、2号吕布、3号邢道荣、4号貂蝉、5号贾诩；玩具${params.lordWeaponId ? "皮鞋" : "空"}；宠物${pet ? `等级${pet.level}` : "空"}`,
          type: "info",
        });

        let previousProgress = Number(role.genie?.[GENIE_FACTION_GROUP] ?? -1);
        const remainingChallenges = getRemainingGenieChallenges(role);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 查询到今日剩余灯神挑战次数${remainingChallenges}次，将全部使用`,
          type: "info",
        });
        let wins = 0;
        for (let attempt = 0; attempt < remainingChallenges; attempt++) {
          if (shouldStop.value) break;
          const response = await tokenStore.sendMessageWithPromise(
            tokenId,
            "fight_startgenie",
            params,
            15000,
          );
          if (!didGroupGenieProgress(response, previousProgress)) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 群雄灯神第${attempt + 1}/${remainingChallenges}次挑战未通关，继续使用剩余次数`,
              type: "info",
            });
          } else {
            previousProgress += 1;
            wins += 1;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 群雄灯神挑战成功，当前已通过第${previousProgress + 1}层`,
              type: "success",
            });
          }
          params.battleTeam = {};
          if (attempt + 1 < remainingChallenges) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayConfig.action),
            );
          }
        }
        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 群雄灯神自动挑战结束，本次通关${wins}层`,
          type: shouldStop.value ? "warning" : "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 群雄灯神自动挑战失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    }

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("自动挑战群雄灯神任务结束");
  };

  /** 使用各阵营独立阵容，按魏、蜀、吴顺序各挑战一次，不升级武将。 */
  const batchChallengeThreeKingdomsGenie = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    for (const tokenId of selectedTokens.value) {
      if (shouldStop.value) break;
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始魏蜀吴灯神各挑战一次: ${tokenName} ===`,
          type: "info",
        });
        await ensureConnection(tokenId);
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        let role = roleInfo?.role || {};
        if (!isGenieMainLevelUnlocked(role)) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 当前主线关卡${Number(role.levelId) || 0}，未达到灯神开启条件${GENIE_MIN_MAIN_LEVEL}关，跳过`,
            type: "info",
          });
          tokenStatus.value[tokenId] = "completed";
          continue;
        }

        let completed = 0;
        const availableChallenges = getRemainingGenieChallenges(role);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 查询到今日剩余灯神挑战次数${availableChallenges}次，本任务最多使用3次`,
          type: "info",
        });
        for (const genieId of [1, 2, 3]) {
          if (shouldStop.value) break;
          if (completed >= availableChallenges) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 今日灯神挑战次数已用完，停止后续阵营`,
              type: "info",
            });
            break;
          }
          const name = GENIE_FACTION_NAMES[genieId];
          let allHeroesOwned = true;
          for (const heroId of GENIE_FACTION_LINEUPS[genieId]) {
            const ownership = await ensureFormationHeroOwned(
              tokenId,
              tokenName,
              heroId,
              roleInfo,
            );
            roleInfo = ownership.roleInfo;
            if (!ownership.owned) {
              allHeroesOwned = false;
              break;
            }
          }
          if (!allHeroesOwned) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${name}灯神阵容不完整且无法合成，跳过该阵营`,
              type: "warning",
            });
            continue;
          }

          role = roleInfo?.role || {};
          const team = buildFactionBattleTeam(genieId);
          const params = buildGenieBattleParams(role, genieId, team);
          const previousProgress = Number(role.genie?.[genieId] ?? -1);
          const response = await tokenStore.sendMessageWithPromise(
            tokenId,
            "fight_startgenie",
            params,
            15000,
          );
          const won = didGenieProgress(response, genieId, previousProgress);
          completed += 1;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${name}灯神已挑战一次${won ? "并通关" : "，本次未通关"}`,
            type: won ? "success" : "info",
          });
          if (genieId < 3) {
            await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
          }
        }

        tokenStatus.value[tokenId] = shouldStop.value ? "stopped" : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 魏蜀吴灯神挑战结束，共执行${completed}次`,
          type: shouldStop.value ? "warning" : "success",
        });
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 魏蜀吴灯神挑战失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    }

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("魏蜀吴灯神挑战任务结束");
  };

  /**
   * 一键灯神扫荡
   */
  const batchGenieSweep = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始灯神扫荡: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);

        // 获取最新角色信息
        const roleInfoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          5000
        );
        
        // 解析灯神进度和扫荡券
        const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
        const genieData = role.genie || {};
        // 扫荡券 ID 1021
        const sweepTicketCount = role.items?.[1021]?.quantity || 0;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 当前扫荡券数量: ${sweepTicketCount}`,
          type: "info",
        });

        if (sweepTicketCount <= 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 扫荡券不足，停止扫荡`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        // 计算最高层数
        // 1-4: 魏蜀吴群 (0-16 -> 1-17层)
        // 5: 深海 (0-9 -> 1-10层)
        let maxLayer = -1;
        let bestGenieId = -1;

        // 检查魏蜀吴群 (1-4)
        for (let i = 1; i <= 4; i++) {
          if (genieData[i] !== undefined) {
            // 数据值 0 代表 1 层? 用户说 0-16 代表 1-17 层
            // 假设 genieData[i] 是已通过的层数索引
            const currentLayer = genieData[i] + 1;
            if (currentLayer > maxLayer) {
              maxLayer = currentLayer;
              bestGenieId = i;
            }
          }
        }

        if (bestGenieId === -1) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 未找到可扫荡的灯神关卡`,
            type: "warning",
          });
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        const genieNames = { 1: "魏国", 2: "蜀国", 3: "吴国", 4: "群雄", 5: "深海" };
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 扫荡: ${genieNames[bestGenieId]}灯神 (第${maxLayer}层)`,
          type: "info",
        });

        // 开始扫荡
        let remainingTickets = sweepTicketCount;
        
        while (remainingTickets > 0 && !shouldStop.value) {
          const sweepCnt = Math.min(remainingTickets, 20);
          
          try {
            const res = await tokenStore.sendMessageWithPromise(
              tokenId,
              "genie_sweep",
              { 
                genieId: bestGenieId,
                sweepCnt: sweepCnt 
              },
              5000
            );

            const ok = res && (res.role || res.role.items);
            
            if (ok) {
               addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 扫荡成功 ${sweepCnt} 次`,
                type: "success",
              });
              remainingTickets = res.role.items?.[1021]?.quantity || 0;
            } else {
               addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 扫荡失败: ${res.hint || "未知错误"}`,
                type: "error",
              });
              break; // 失败则停止
            }
          } catch (err) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 扫荡请求异常: ${err.message}`,
              type: "error",
            });
            break;
          }

          if (remainingTickets > 0) {
             await new Promise((r) => setTimeout(r, delayConfig.action));
          }
        }

        // 刷新信息
        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 灯神扫荡完成 ===`,
          type: "success",
        });

      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `灯神扫荡失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("一键灯神扫荡结束");
  };

  const batchOpenBox = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const boxType = isScheduledTask
      ? batchSettings.defaultBoxType
      : helperSettings.boxType;
    const totalCount = isScheduledTask
      ? batchSettings.boxCount
      : helperSettings.count;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始批量开箱: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝箱类型: ${boxNames[boxType]}, 数量: ${totalCount}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        await runInventoryVerifiedGameCommand({
          tokenStore,
          tokenId,
          cmd: "item_openbox",
          itemId: boxType,
          total: totalCount,
          timeout: HELPER_COMMAND_TIMEOUT_MS,
          delayMs: delayConfig.action,
          createParams: (amount) => ({ itemId: boxType, number: amount }),
          queryInventory: () => tokenStore.sendGetRoleInfo(tokenId),
          onProgress: (progress) => {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 开箱进度: ${progress.completed}/${totalCount}`,
              type: "info",
            });
          },
        });

        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_batchclaimboxpointreward",
        );
        await new Promise((r) => setTimeout(r, delayConfig.action));
        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 开箱完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `开箱失败: ${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量开箱结束");
  };

  /**
   * 批量钓鱼
   */
  const batchFish = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const fishType = isScheduledTask
      ? batchSettings.defaultFishType
      : helperSettings.fishType;
    const totalCount = isScheduledTask
      ? batchSettings.fishCount
      : helperSettings.count;
    const batches = Math.floor(totalCount / 10);
    const remainder = totalCount % 10;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始批量钓鱼: ${token.name} ===`,
          type: "info",
        });
        
        await ensureConnection(tokenId);

        // 检查鱼竿数量
        let role = tokenStore.gameData?.roleInfo?.role;
        if (!role) {
           try {
             const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
             role = roleInfo?.role;
           } catch {}
        }
        // 普通鱼竿: 1011, 黄金鱼竿: 1012
        const rodId = fishType === 1 ? 1011 : 1012;
        const rodCount = role?.items?.[rodId]?.quantity || 0;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 鱼竿类型: ${fishNames[fishType]}, 目标数量: ${totalCount}, 当前库存: ${rodCount}`,
          type: "info",
        });

        let availableCount = totalCount;
        if (rodCount < totalCount) {
             addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 库存不足 (${rodCount} < ${totalCount})，将仅消耗现有库存`,
                type: "warning",
             });
             availableCount = rodCount;
        }

        if (availableCount <= 0) {
            addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 没有可用的鱼竿，停止任务`,
                type: "warning",
            });
            tokenStatus.value[tokenId] = "completed";
            return;
        }

        const batches = Math.floor(availableCount / 10);
        const remainder = availableCount % 10;

        for (let i = 0; i < batches && !shouldStop.value; i++) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "artifact_lottery",
            { type: fishType, lotteryNumber: 10, newFree: true },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼进度: ${(i + 1) * 10}/${availableCount}`,
            type: "info",
          });

          // 每5轮（50次）后，重新校验鱼竿数量
          if ((i + 1) % 5 === 0 && i < batches - 1) {
             try {
                const roleRes = await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "role_getroleinfo",
                  {},
                  5000,
                );
                const currentRole = roleRes?.role || roleRes?.data?.role;
                if (currentRole) {
                    const currentRodCount = currentRole.items?.[rodId]?.quantity || 0;
                    
                    // 剩余需要的次数 (不包括当前这轮，因为i已经执行完了，所以剩余次数是 (batches - 1 - i) * 10 + remainder)
                    // 但实际上我们只需要知道下一轮是否有足够的鱼竿
                    // 如果当前库存少于10，说明下一轮可能不够，或者整个任务不够
                    // 重新计算 availableCount 可能会比较复杂，因为循环是基于 batches
                    
                    if (currentRodCount < 10) {
                        addLog({
                            time: new Date().toLocaleTimeString(),
                            message: `${token.name} 同步后发现鱼竿不足 (${currentRodCount} < 10)，停止后续批量任务`,
                            type: "warning",
                        });
                        // 强制停止
                        break; 
                    }
                }
             } catch (e) {
                 // ignore
             }
          }

          await new Promise((r) => setTimeout(r, delayConfig.action));
        }

        if (remainder > 0 && !shouldStop.value) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "artifact_lottery",
            { type: fishType, lotteryNumber: remainder, newFree: true },
            5000,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 钓鱼进度: ${availableCount}/${availableCount}`,
            type: "info",
          });
        }
        // 自动领取鱼竿累计奖励
        try {
           const roleRes = await tokenStore.sendMessageWithPromise(
             tokenId,
             "role_getroleinfo",
             {},
             5000,
           );
           const currentRole = roleRes?.role || roleRes?.data?.role;
           if (currentRole) {
              const points = currentRole.statistics?.["artifact:point"] || 0;
              const exchangeCount = Math.floor(points / 20);
              
              if (exchangeCount > 0) {
                 addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 检测到鱼竿累计使用 ${points}，开始领取 ${exchangeCount} 次累计奖励`,
                    type: "info",
                 });
                 
                 for (let k = 0; k < exchangeCount && !shouldStop.value; k++) {
                    try {
                       await tokenStore.sendMessageWithPromise(
                         tokenId,
                         "artifact_exchange",
                         {},
                         3000
                       );
                       // 稍微延迟，避免请求过快
                       await new Promise((r) => setTimeout(r, 500)); 
                    } catch (err) {
                       addLog({
                          time: new Date().toLocaleTimeString(),
                          message: `${token.name} 领取累计奖励失败 (第${k+1}次): ${err.message}`,
                          type: "warning",
                       });
                       break; // 如果出错可能是不满足条件，停止领取
                    }
                 }
                 addLog({
                    time: new Date().toLocaleTimeString(),
                    message: `${token.name} 累计奖励领取结束`,
                    type: "success",
                 });
              }
           }
        } catch (e) {
           addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 检查累计奖励失败: ${e.message}`,
              type: "warning",
           });
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 钓鱼完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `钓鱼失败: ${error.message}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量钓鱼结束");
  };

  /**
   * 批量招募
   */
  const batchRecruit = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const totalCount = isScheduledTask
      ? batchSettings.recruitCount
      : helperSettings.count;

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";

      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始批量招募: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 招募数量: ${totalCount}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        await runInventoryVerifiedGameCommand({
          tokenStore,
          tokenId,
          cmd: "hero_recruit",
          itemId: 1001,
          total: totalCount,
          timeout: HELPER_COMMAND_TIMEOUT_MS,
          delayMs: delayConfig.action,
          createParams: (amount) => ({ recruitType: 1, recruitNumber: amount }),
          queryInventory: () => tokenStore.sendGetRoleInfo(tokenId),
          onProgress: (progress) => {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 招募进度: ${progress.completed}/${totalCount}`,
              type: "info",
            });
          },
        });

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 招募完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `招募失败: ${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量招募结束");
  };

  /**
   * 智能招募周任务：活动累计最多四轮；每轮招募400次后领取万能红自选奖励。
   */
  const batchSmartRecruitWeekly = async (taskConfig = {}) => {
    if (selectedTokens.value.length === 0) return;

    const startCount = Math.max(
      1,
      Math.trunc(Number(taskConfig.startCount) || 360),
    );
    const totalCount = Math.max(
      startCount,
      Math.trunc(Number(taskConfig.totalCount) || 400),
    );
    const requestedRoundCount = Math.min(
      4,
      Math.max(1, Math.trunc(Number(taskConfig.roundCount) || 1)),
    );

    const getRecruitWeekState = (activityResult) => {
      const activity =
        activityResult?.activity ||
        activityResult?.data?.activity ||
        activityResult?.body?.activity;
      const info = activity?.myTotalInfo?.["1"];
      if (!info) return { completedRounds: 0, currentProgress: 0 };

      const complete = info.complete || {};
      const recruitActivity = activity.activity?.find(
        (item) => Number(item?.id) === 1,
      );
      const rewardCount = recruitActivity?.data?.rewards?.length || 5;
      const finalRewardIndex = rewardCount - 1;
      const completedByFinalReward =
        Number(complete[String(finalRewardIndex)]) || 0;
      const completedByCurrentRound = Math.max(
        0,
        (Number(info.rounds) || 1) - 1,
      );

      return {
        completedRounds: Math.min(
          4,
          Math.max(completedByFinalReward, completedByCurrentRound),
        ),
        currentProgress: Math.min(
          totalCount,
          Math.max(0, Number(info.num) || 0),
        ),
      };
    };

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const runRecruitBatch = async (
      tokenId,
      token,
      count,
      progressOffset,
      roundIndex,
      roundCount,
    ) => {
      const runRecruitPart = async (partCount, partOffset, batchSize) => {
        if (partCount <= 0) return;

        await runInventoryVerifiedGameCommand({
          tokenStore,
          tokenId,
          cmd: "hero_recruit",
          itemId: 1001,
          total: partCount,
          batchSize,
          timeout: HELPER_COMMAND_TIMEOUT_MS,
          delayMs: delayConfig.action,
          createParams: (amount) => ({
            recruitType: 1,
            recruitNumber: amount,
          }),
          queryInventory: () => tokenStore.sendGetRoleInfo(tokenId),
          onProgress: (progress) => {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 招募周第${roundIndex}/${roundCount}轮进度：${progressOffset + partOffset + progress.completed}/${totalCount}`,
              type: "info",
            });
          },
        });
      };

      // 服务端批量招募只稳定支持10次；免费招募会让周进度偏移1，
      // 因此余数不能一次发送9次，需要拆成多个单次招募请求。
      const fullBatchCount = Math.floor(count / 10) * 10;
      const remainder = count - fullBatchCount;
      await runRecruitPart(fullBatchCount, 0, 10);
      await runRecruitPart(remainder, fullBatchCount, 1);
    };

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      const token = tokens.value.find((item) => item.id === tokenId);
      tokenStatus.value[tokenId] = "running";

      try {
        if (activityWeek?.value && activityWeek.value !== "招募周") {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前为${activityWeek.value}，跳过智能招募周任务`,
            type: "warning",
          });
          return;
        }

        await ensureConnection(tokenId);

        let activityResult = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_get",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        );
        let recruitWeekState = getRecruitWeekState(activityResult);
        const completedRounds = recruitWeekState.completedRounds;
        const remainingRounds = Math.max(0, 4 - completedRounds);
        const roundCount = Math.min(requestedRoundCount, remainingRounds);

        if (roundCount === 0) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周已完成4/4轮，无需继续执行`,
            type: "success",
          });
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始智能招募周任务：${token.name}，本周已完成${completedRounds}/4轮，本次执行${roundCount}轮，每轮${totalCount}次 ===`,
          type: "info",
        });

        for (let roundIndex = 1; roundIndex <= roundCount; roundIndex += 1) {
          if (shouldStop.value) return;

          if (roundIndex > 1) {
            activityResult = await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_get",
              {},
              HELPER_COMMAND_TIMEOUT_MS,
            );
            recruitWeekState = getRecruitWeekState(activityResult);
          }

          const currentProgress = recruitWeekState.currentProgress;
          const beforeMailCount = Math.max(0, startCount - currentProgress);
          const progressAfterFirstStage = currentProgress + beforeMailCount;
          const afterMailCount = Math.max(
            0,
            totalCount - progressAfterFirstStage,
          );
          const actualRecruitCount = beforeMailCount + afterMailCount;

          const initialRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          const initialRecruitCount = getItemQuantity(initialRoleInfo, 1001);
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周第${roundIndex}/${roundCount}轮当前进度${currentProgress}/${totalCount}，还需招募${actualRecruitCount}次，现有招募道具${initialRecruitCount}个`,
            type: "info",
          });

          if (initialRecruitCount < beforeMailCount) {
            tokenStatus.value[tokenId] = "skipped";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 招募周第${roundIndex}轮招募道具不足，补到${startCount}进度需要${beforeMailCount}个，当前仅${initialRecruitCount}个，跳过后续任务`,
              type: "warning",
            });
            return;
          }

          if (beforeMailCount > 0) {
            await runRecruitBatch(
              tokenId,
              token,
              beforeMailCount,
              currentProgress,
              roundIndex,
              roundCount,
            );
          }

          if (currentProgress < totalCount) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 招募周第${roundIndex}轮已达到${progressAfterFirstStage}进度，开始领取邮件附件`,
              type: "info",
            });
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "mail_claimallattachment",
              { category: 0 },
              HELPER_COMMAND_TIMEOUT_MS,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, delayConfig.action),
            );
          }

          if (afterMailCount > 0) {
            await runRecruitBatch(
              tokenId,
              token,
              afterMailCount,
              progressAfterFirstStage,
              roundIndex,
              roundCount,
            );
          }

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周第${roundIndex}/${roundCount}轮完成：${totalCount}/${totalCount}次`,
            type: "success",
          });

          await tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_claimweekactreward",
            {
              selectRewardsMap: { 1: 1 },
              typ: 1,
            },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周第${roundIndex}/${roundCount}轮万能红自选奖励领取成功`,
            type: "success",
          });
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "mail_claimallattachment",
            { category: 0 },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周第${roundIndex}/${roundCount}轮完成后邮件附件领取成功`,
            type: "success",
          });
          recruitWeekState = {
            completedRounds: Math.min(4, completedRounds + roundIndex),
            currentProgress: 0,
          };
        }

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 智能招募周任务完成：${roundCount}/${roundCount}轮 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 智能招募周任务失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("智能招募周任务结束");
  };

  /**
   * 小号黑市周任务：购买江湖黑市指定礼包，并在金砖达标完成后领取万能红。
   * 江湖黑市使用 activityId=9；goodsIndex=3、8按需求跳过，9购买四次。
   */
  const batchSmartBlackMarketWeekly = async () => {
    if (selectedTokens.value.length === 0) return;

    const goodsIndices = [0, 1, 2, 4, 5, 6, 7, 9, 9, 9, 9];
    const getGoldWeekProgress = (activityResult) => {
      const activity =
        activityResult?.activity ||
        activityResult?.data?.activity ||
        activityResult?.body?.activity;
      const info = activity?.myTotalInfo?.["11"];
      return Math.max(0, Number(info?.num) || 0);
    };

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      const token = tokens.value.find((item) => item.id === tokenId);
      tokenStatus.value[tokenId] = "running";

      try {
        if (activityWeek?.value && activityWeek.value !== "黑市周") {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前为${activityWeek.value}，跳过江湖黑市周任务`,
            type: "warning",
          });
          return;
        }

        await ensureConnection(tokenId);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始江湖黑市周任务：${token.name} ===`,
          type: "info",
        });

        for (const goodsIndex of goodsIndices) {
          if (shouldStop.value) return;

          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_buystoregoods",
              { activityId: 9, goodsIndex, buyNum: 1 },
              HELPER_COMMAND_TIMEOUT_MS,
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 江湖黑市商品${goodsIndex}购买成功`,
              type: "success",
            });
          } catch (error) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 江湖黑市商品${goodsIndex}购买失败，继续后续采购：${getErrorMessage(error)}`,
              type: "warning",
            });
          }

          if (delayConfig.action > 0) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayConfig.action),
            );
          }
        }

        const activityResult = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_get",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        );
        const progress = getGoldWeekProgress(activityResult);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 金砖达标当前进度：${progress}/100000`,
          type: "info",
        });

        if (progress >= 100000) {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_claimweekactreward",
            { selectRewardsMap: { 0: 1 }, typ: 12 },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 金砖达标完成，万能红自选奖励领取成功`,
            type: "success",
          });
        } else {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 金砖达标尚未完成，暂不领取自选奖励`,
            type: "warning",
          });
        }

        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 江湖黑市周任务失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("江湖黑市周任务结束");
  };

  /** 小号任务：按规则消耗仓库内可使用物品。 */
  const batchUseWarehouseItems = async () => {
    if (selectedTokens.value.length === 0) return;

    const MAX_USE_PER_REQUEST = 999;
    const MIN_ACTION_DELAY_MS = 2000;
    const ITEM_COOLDOWN_MS = 5000;
    const RATE_LIMIT_RETRY_DELAY_MS = 6000;
    const MAX_RATE_LIMIT_RETRIES = 4;
    const COIN_BAG_ITEM_ID = 3001;
    const UNIVERSAL_RED_ITEM_ID = 3201;
    const UNIVERSAL_ORANGE_ITEM_ID = 3302;
    const OPEN_PACK_ITEM_IDS = [
      3001, 3002, 3005, 3006, 3007, 3008, 3009, 3010, 3011, 3012, 35011,
    ];
    const EXCLUDED_ACTIVITY_ITEM_IDS = new Set([
      5054,
      5095,
      5128,
      5282,
      5283,
      5284,
      5285,
      5286,
      5288,
      6001,
    ]);
    const useUniversalRed = batchSettings.useUniversalRed !== false;
    const useUniversalOrange = batchSettings.useUniversalOrange !== false;
    const redPrimaryHeroId = Number(
      batchSettings.universalRedPrimaryHeroId || 107,
    );
    const redSecondaryHeroId = Number(
      batchSettings.universalRedSecondaryHeroId || 106,
    );
    const orangeHeroId = Number(batchSettings.universalOrangeHeroId || 210);
    const actionDelayMs = Math.max(
      MIN_ACTION_DELAY_MS,
      Number(delayConfig.action) || 0,
    );
    const getRole = (result) =>
      result?.role || result?.data?.role || result?.body?.role || result?.data?.body?.role || {};
    const getItems = (result) => getRole(result).items || {};
    const getHeroes = (result) => getRole(result).heroes || {};
    const getQuantity = (items, itemId) => {
      const item = items[itemId] ?? items[String(itemId)];
      return Math.max(0, Number(item?.quantity ?? item?.count ?? item ?? 0) || 0);
    };
    const setQuantity = (roleInfo, itemId, quantity) => {
      const items = getItems(roleInfo);
      const key = Object.hasOwn(items, itemId) ? itemId : String(itemId);
      const current = items[key];
      const nextQuantity = Math.max(0, Number(quantity) || 0);

      if (current && typeof current === "object") {
        current.quantity = nextQuantity;
      } else {
        items[key] = { quantity: nextQuantity };
      }
    };
    const getActivityPackItemIds = (items) =>
      Object.entries(items)
        .map(([key, item]) => ({ itemId: Number(key), item }))
        .filter(({ itemId, item }) => {
          if (!Number.isFinite(itemId) || getQuantity(items, itemId) <= 0) {
            return false;
          }
          const hasActivityExpiry = Boolean(
            item?.ext?.expireTime || item?.ext?.claimTime,
          );
          return (itemId >= 5000 && itemId < 10000) || hasActivityExpiry;
        })
        .map(({ itemId }) => itemId)
        .filter((itemId) => !OPEN_PACK_ITEM_IDS.includes(itemId))
        .filter((itemId) => !EXCLUDED_ACTIVITY_ITEM_IDS.has(itemId))
        .sort((left, right) => left - right);
    const getMainLevel = (result) =>
      Number(getRole(result).levelId ?? result?.levelId ?? 0) || 0;
    const getHeroStar = (heroes, heroId) => {
      const hero = heroes[heroId] ?? heroes[String(heroId)];
      return Number(hero?.star ?? 0) || 0;
    };
    const sleep = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs));
    const isRateLimitError = (error) =>
      isHeroStarRateLimitError(error);
    const getRoleInfoWithRetry = async (tokenId, tokenName) => {
      for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
        try {
          return await tokenStore.sendGetRoleInfo(tokenId);
        } catch (error) {
          if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
            throw error;
          }
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 查询仓库/武将状态触发200400，等待6秒后进行第${attempt + 1}次重试`,
            type: "warning",
          });
          await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        }
      }
      throw new Error("查询角色状态重试次数已用尽");
    };
    const useInBatches = async ({
      tokenId,
      itemId,
      quantity,
      index = 0,
      tokenName,
      command = "item_openpack",
      knownBeforeQuantity = null,
    }) => {
      let remaining = Math.max(0, Math.trunc(quantity));
      let used = 0;
      let trackedQuantity = Number.isFinite(Number(knownBeforeQuantity))
        ? Math.max(0, Number(knownBeforeQuantity))
        : null;
      while (remaining > 0 && !shouldStop.value) {
        const amount = Math.min(MAX_USE_PER_REQUEST, remaining);
        let beforeQuantity = trackedQuantity;
        if (beforeQuantity === null) {
          const beforeInfo = await getRoleInfoWithRetry(tokenId, tokenName);
          beforeQuantity = getQuantity(getItems(beforeInfo), itemId);
        }
        let consumedAmount = 0;

        for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              command,
              command === "item_consume"
                ? { itemId, quantity: amount }
                : { itemId, number: amount, index },
              HELPER_COMMAND_TIMEOUT_MS,
            );
            consumedAmount = amount;
            break;
          } catch (error) {
            if (isRateLimitError(error)) {
              if (attempt >= MAX_RATE_LIMIT_RETRIES) throw error;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} 使用物品${itemId}触发200400，等待6秒后进行第${attempt + 1}次重试`,
                type: "warning",
              });
              await sleep(RATE_LIMIT_RETRY_DELAY_MS);
              continue;
            }
            // 请求超时或异常时先对账，防止服务器已成功却重复使用。
            const afterInfo = await getRoleInfoWithRetry(tokenId, tokenName);
            const afterQuantity = getQuantity(getItems(afterInfo), itemId);
            consumedAmount = Math.max(0, beforeQuantity - afterQuantity);
            trackedQuantity = afterQuantity;
            if (consumedAmount > 0) break;
            throw error;
          }
        }

        used += consumedAmount;
        remaining -= consumedAmount;
        if (trackedQuantity !== null && consumedAmount > 0) {
          trackedQuantity = Math.max(0, beforeQuantity - consumedAmount);
        }
        await sleep(actionDelayMs);
      }
      if (used > 0) {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 使用物品${itemId}：${used}个${command === "item_openpack" ? `，目标序号${index}` : ""}`,
          type: "success",
        });
      }
      return used;
    };
    const getUniversalAmountForImmediateUpgrades = (
      roleInfo,
      heroId,
      universalQuantity,
    ) => {
      const heroes = getHeroes(roleInfo);
      const items = getItems(roleInfo);
      const currentStar = getHeroStar(heroes, heroId);
      let fragments = getQuantity(items, heroId);
      let amount = 0;
      const limit = Math.min(MAX_USE_PER_REQUEST, universalQuantity);

      for (let star = currentStar; star < 30; star += 1) {
        const cost = Number(starFragmentCosts[star]) || 0;
        if (cost <= 0) break;
        const missing = Math.max(0, cost - fragments);
        if (amount + missing > limit) break;
        amount += missing;
        fragments = fragments + missing - cost;
      }

      return amount;
    };
    const executeHeroStarPlan = async (tokenId, tokenName, plan) => {
      for (const { heroId, upgradeCount, needsSynthesis } of plan) {
        const heroName = HERO_DICT[heroId]?.name || `武将${heroId}`;
        if (needsSynthesis) {
          let synthesized = false;
          for (
            let attempt = 0;
            attempt <= MAX_RATE_LIMIT_RETRIES;
            attempt += 1
          ) {
            try {
              await waitForHeroStarInterval(tokenId);
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_synthetic",
                { itemId: heroId },
                HELPER_COMMAND_TIMEOUT_MS,
              );
              synthesized = true;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} ${heroName}碎片已合成为武将`,
                type: "success",
              });
              break;
            } catch (error) {
              if (
                !isRateLimitError(error) ||
                attempt >= MAX_RATE_LIMIT_RETRIES
              ) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${tokenName} ${heroName}合成失败，跳过该武将升星：${getErrorMessage(error)}`,
                  type: "warning",
                });
                break;
              }
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} ${heroName}合成触发200400，等待6秒后进行第${attempt + 1}次重试`,
                type: "warning",
              });
              await sleep(RATE_LIMIT_RETRY_DELAY_MS);
            }
          }
          if (!synthesized) continue;
        }
        for (
          let index = 0;
          index < upgradeCount && !shouldStop.value;
          index += 1
        ) {
          for (
            let attempt = 0;
            attempt <= MAX_RATE_LIMIT_RETRIES;
            attempt += 1
          ) {
            try {
              await waitForHeroStarInterval(tokenId);
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_heroupgradestar",
                { heroId },
                HELPER_COMMAND_TIMEOUT_MS,
              );
              break;
            } catch (error) {
              if (
                !isRateLimitError(error) ||
                attempt >= MAX_RATE_LIMIT_RETRIES
              ) {
                throw error;
              }
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} ${heroName}升星触发200400，等待6秒后进行第${attempt + 1}次重试`,
                type: "warning",
              });
              await sleep(RATE_LIMIT_RETRY_DELAY_MS);
            }
          }
        }
      }
    };
    const upgradeHeroStars = async (
      tokenId,
      heroId,
      tokenName,
      roleInfo,
    ) => {
      const planItem = getHeroStarUpgradeCount(roleInfo, heroId);
      if (!planItem.needsSynthesis && planItem.upgradeCount <= 0) {
        return { upgraded: 0, roleInfo };
      }

      await executeHeroStarPlan(tokenId, tokenName, [planItem]);
      await sleep(HERO_STAR_ACTION_DELAY_MS);
      const latestRoleInfo = await getRoleInfoWithRetry(tokenId, tokenName);
      const latestStar = getHeroStar(getHeroes(latestRoleInfo), heroId);
      const upgraded = Math.max(0, latestStar - planItem.currentStar);
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${HERO_DICT[heroId]?.name || heroId}计划升星${planItem.upgradeCount}次，实际${planItem.currentStar}星 → ${latestStar}星`,
        type: upgraded >= planItem.upgradeCount ? "success" : "warning",
      });
      return { upgraded, roleInfo: latestRoleInfo };
    };
    const useUniversalFragments = async ({
      tokenId,
      universalItemId,
      resolveTargetHeroId,
      tokenName,
      initialRoleInfo,
    }) => {
      let roleInfo = initialRoleInfo;
      while (!shouldStop.value) {
        const targetHeroId = resolveTargetHeroId(roleInfo);
        if (getHeroStar(getHeroes(roleInfo), targetHeroId) >= 30) break;

        const universalQuantity = getQuantity(
          getItems(roleInfo),
          universalItemId,
        );
        const amount = getUniversalAmountForImmediateUpgrades(
          roleInfo,
          targetHeroId,
          universalQuantity,
        );
        let usedAmount = 0;
        if (amount > 0) {
          const index =
            universalItemId === UNIVERSAL_RED_ITEM_ID
              ? targetHeroId - 101
              : targetHeroId - 201;
          usedAmount = await useInBatches({
            tokenId,
            itemId: universalItemId,
            quantity: amount,
            index,
            tokenName,
            knownBeforeQuantity: universalQuantity,
          });
          if (usedAmount <= 0 || shouldStop.value) break;
          setQuantity(
            roleInfo,
            universalItemId,
            universalQuantity - usedAmount,
          );
          setQuantity(
            roleInfo,
            targetHeroId,
            getQuantity(getItems(roleInfo), targetHeroId) + usedAmount,
          );
        }

        // 已有专属碎片与本轮转换所得碎片合并规划，一次升完后再查询确认。
        const fragmentUpgrade = await upgradeHeroStars(
          tokenId,
          targetHeroId,
          tokenName,
          roleInfo,
        );
        roleInfo = fragmentUpgrade.roleInfo;
        if (usedAmount > 0 && fragmentUpgrade.upgraded <= 0) {
          throw new Error(
            `${HERO_DICT[targetHeroId]?.name || targetHeroId}使用万能碎片后未能升星`,
          );
        }
        if (fragmentUpgrade.upgraded > 0) continue;

        if (universalQuantity > 0) {
          const heroName = HERO_DICT[targetHeroId]?.name || targetHeroId;
          const currentStar = getHeroStar(getHeroes(roleInfo), targetHeroId);
          const fragmentCount = getQuantity(getItems(roleInfo), targetHeroId);
          const nextCost = Number(starFragmentCosts[currentStar]) || 0;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${heroName}升星还需${Math.max(0, nextCost - fragmentCount)}个碎片，当前万能碎片${universalQuantity}个，不转换以避免碎片闲置`,
            type: "info",
          });
        }
        break;
      }
      return roleInfo;
    };

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => (tokenStatus.value[id] = "waiting"));

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      const token = tokens.value.find((item) => item.id === tokenId);
      const tokenName = token?.name || tokenId;
      tokenStatus.value[tokenId] = "running";
      try {
        await ensureConnection(tokenId);
        let roleInfo = await getRoleInfoWithRetry(tokenId, tokenName);
        const mainLevel = getMainLevel(roleInfo);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 当前主线关卡${mainLevel}，开始使用仓库物品`,
          type: "info",
        });

        const redQuantity = getQuantity(getItems(roleInfo), UNIVERSAL_RED_ITEM_ID);
        if (useUniversalRed && redQuantity > 0) {
          roleInfo = await useUniversalFragments({
            tokenId,
            universalItemId: UNIVERSAL_RED_ITEM_ID,
            resolveTargetHeroId: (latestRoleInfo) =>
              getHeroStar(getHeroes(latestRoleInfo), redPrimaryHeroId) < 30
                ? redPrimaryHeroId
                : redSecondaryHeroId,
            tokenName,
            initialRoleInfo: roleInfo,
          });
        } else if (!useUniversalRed && redQuantity > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 已关闭自动使用万能红碎，跳过${redQuantity}个`,
            type: "info",
          });
        }

        const orangeQuantity = getQuantity(
          getItems(roleInfo),
          UNIVERSAL_ORANGE_ITEM_ID,
        );
        if (useUniversalOrange && orangeQuantity > 0) {
          roleInfo = await useUniversalFragments({
            tokenId,
            universalItemId: UNIVERSAL_ORANGE_ITEM_ID,
            resolveTargetHeroId: () => orangeHeroId,
            tokenName,
            initialRoleInfo: roleInfo,
          });
        } else if (!useUniversalOrange && orangeQuantity > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 已关闭自动使用万能橙碎，跳过${orangeQuantity}个`,
            type: "info",
          });
        }

        if (mainLevel >= 7200) {
          const coinBagQuantity = getQuantity(
            getItems(roleInfo),
            COIN_BAG_ITEM_ID,
          );
          if (coinBagQuantity > 0) {
            await useInBatches({
              tokenId,
              itemId: COIN_BAG_ITEM_ID,
              quantity: coinBagQuantity,
              tokenName,
            });
          }
        } else if (getQuantity(getItems(roleInfo), COIN_BAG_ITEM_ID) > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 主线未达到7200，跳过金币袋使用`,
            type: "warning",
          });
        }

        for (const itemId of OPEN_PACK_ITEM_IDS) {
          if (itemId === COIN_BAG_ITEM_ID || shouldStop.value) continue;
          const quantity = getQuantity(getItems(roleInfo), itemId);
          if (quantity <= 0) continue;
          try {
            await useInBatches({ tokenId, itemId, quantity, tokenName });
          } catch (error) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 物品${itemId}无法直接使用，已跳过：${getErrorMessage(error)}`,
              type: "warning",
            });
          }
          await sleep(ITEM_COOLDOWN_MS);
        }

        roleInfo = await getRoleInfoWithRetry(tokenId, tokenName);
        const latestItems = getItems(roleInfo);
        const activityItemIds = getActivityPackItemIds(latestItems);
        if (activityItemIds.length > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 检测到活动道具：${activityItemIds.join(", ")}`,
            type: "info",
          });
        }
        for (const itemId of activityItemIds) {
          if (shouldStop.value) break;
          const quantity = getQuantity(latestItems, itemId);
          try {
            await useInBatches({ tokenId, itemId, quantity, tokenName });
          } catch (error) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} 活动道具${itemId}不支持直接开启或使用失败，已跳过：${getErrorMessage(error)}`,
              type: "warning",
            });
          }
          await sleep(ITEM_COOLDOWN_MS);
        }

        roleInfo = await getRoleInfoWithRetry(tokenId, tokenName);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 仓库物品使用任务完成，剩余物品已重新查询`,
          type: "success",
        });
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 使用仓库物品失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
      }
    });

    await Promise.all(taskPromises);
    const shouldRunAutoStarBook = !shouldStop.value;
    isRunning.value = false;
    currentRunningTokenId.value = null;
    if (shouldRunAutoStarBook) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: "仓库物品处理完成，开始调用统一的自动升星图鉴任务",
        type: "info",
      });
      await batchAutoStarBook();
    }
    message.success("仓库物品使用任务结束");
  };

  const batchSmartBoxWeekly = async (taskConfig = {}) => {
    if (selectedTokens.value.length === 0) return;

    const selectedTypes = Array.from(
      new Set(
        (Array.isArray(taskConfig.smartBoxTypes)
          ? taskConfig.smartBoxTypes
          : [2002, 2003, 2004]
        )
          .map(Number)
          .filter((id) => smartBoxDefinitions.some((box) => box.id === id)),
      ),
    );
    const requestedGroupCount = Math.min(
      4,
      Math.max(1, Math.trunc(Number(taskConfig.smartBoxGroupCount) || 1)),
    );
    // 奖励领取后可能只补回少量宝箱，需要多轮补开才能凑出8000分。
    // 同时设置上限，避免奖励接口异常时任务无限循环。
    const maxCyclesPerGroup = 20;
    const configuredSmartBoxDelay = Number(taskConfig.smartBoxActionDelayMs);
    const smartBoxActionDelayMs = Number.isFinite(configuredSmartBoxDelay)
      ? Math.max(0, configuredSmartBoxDelay)
      : Math.max(2000, Number(delayConfig.action) || 0);
    const smartBoxRateLimitDelayMs = 6000;
    const smartBoxMaxRateLimitRetries = 3;
    const waitForSmartBoxAction = () =>
      new Promise((resolve) => setTimeout(resolve, smartBoxActionDelayMs));
    const isSmartBoxRateLimitError = (error) =>
      /200400|操作太快|操作过快/.test(getErrorMessage(error));

    const runSmartBoxOperation = async (
      tokenName,
      operationName,
      operation,
    ) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await operation();
        } catch (error) {
          if (
            !isSmartBoxRateLimitError(error) ||
            attempt >= smartBoxMaxRateLimitRetries
          ) {
            throw error;
          }
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${operationName}触发200400，等待6秒后进行第${attempt + 1}次重试`,
            type: "warning",
          });
          await new Promise((resolve) =>
            setTimeout(resolve, smartBoxRateLimitDelayMs),
          );
        }
      }
    };

    const getBoxWeekState = (activityResult) => {
      const activity =
        activityResult?.activity ||
        activityResult?.data?.activity ||
        activityResult?.body?.activity;
      const info = activity?.myTotalInfo?.["2"];
      if (!info) {
        return {
          completedRounds: 0,
          currentProgress: 0,
          pendingGrandRewardCount: 0,
          hasCurrentGrandReward: false,
          totalRounds: 4,
        };
      }

      const complete = info.complete || {};
      const boxActivity = activity.activity?.find(
        (item) => Number(item?.id) === 2,
      );
      const rewardCount = boxActivity?.data?.rewards?.length || 5;
      const finalRewardIndex = rewardCount - 1;
      const finalRewardTarget =
        Number(boxActivity?.data?.rewards?.[finalRewardIndex]?.num) || 8000;
      const completedByFinalReward =
        Number(complete[String(finalRewardIndex)]) || 0;
      const currentRound = Math.max(1, Number(info.rounds) || 1);
      const totalRounds = Math.max(
        1,
        Number(boxActivity?.data?.rounds) || 4,
      );
      const currentProgress = Math.min(
        finalRewardTarget,
        Math.max(0, Number(info.num) || 0),
      );
      const previousRoundCount = Math.min(
        totalRounds,
        Math.max(0, currentRound - 1),
      );
      const pendingPreviousRewardCount = Math.max(
        0,
        previousRoundCount - completedByFinalReward,
      );
      const hasCurrentGrandReward =
        currentRound <= totalRounds &&
        currentProgress >= finalRewardTarget &&
        completedByFinalReward < currentRound;
      const pendingThroughCurrentRound = hasCurrentGrandReward
        ? Math.max(
            0,
            Math.min(totalRounds, currentRound) - completedByFinalReward,
          )
        : 0;

      return {
        completedRounds: Math.min(totalRounds, completedByFinalReward),
        currentProgress,
        pendingGrandRewardCount: Math.max(
          pendingPreviousRewardCount,
          pendingThroughCurrentRound,
        ),
        hasCurrentGrandReward,
        totalRounds,
      };
    };

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const fetchRoleInfo = async (tokenId, tokenName, waitBefore = false) => {
      if (waitBefore) await waitForSmartBoxAction();
      return runSmartBoxOperation(tokenName, "查询宝箱库存", () =>
        tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        ),
      );
    };

    const fetchBoxActivity = async (
      tokenId,
      tokenName,
      waitBefore = false,
    ) => {
      if (waitBefore) await waitForSmartBoxAction();
      return runSmartBoxOperation(tokenName, "查询宝箱周进度", () =>
        tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_get",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        ),
      );
    };

    const openSmartBoxes = async (
      tokenId,
      token,
      boxes,
      phase,
      initialRoleInfo,
    ) => {
      let openedPoints = 0;
      let latestRoleInfo = initialRoleInfo;

      for (const box of boxes) {
        if (shouldStop.value) break;

        const count = Math.max(0, Math.trunc(Number(box.count) || 0));
        if (count <= 0) continue;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} ${phase}：${box.name} ${count}个（${count * box.points}分）`,
          type: "info",
        });

        await waitForSmartBoxAction();
        const openResult = await runInventoryVerifiedGameCommand({
          tokenStore,
          tokenId,
          cmd: "item_openbox",
          itemId: box.id,
          total: count,
          batchSize: box.batchSize,
          timeout: HELPER_COMMAND_TIMEOUT_MS,
          delayMs: smartBoxActionDelayMs,
          retryDelayMs: smartBoxRateLimitDelayMs,
          maxRetries: smartBoxMaxRateLimitRetries,
          createParams: (amount) => ({ itemId: box.id, number: amount }),
          queryInventory: () => fetchRoleInfo(tokenId, token.name, true),
          initialRoleInfo: latestRoleInfo,
          onProgress: (progress) => {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${box.name}进度：${progress.completed}/${count}`,
              type: "info",
            });
          },
        });
        latestRoleInfo = openResult.lastRoleInfo;
        openedPoints += count * box.points;
      }

      return { openedPoints, lastRoleInfo: latestRoleInfo };
    };

    const claimPointsAndMail = async (tokenId, token) => {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 本轮开箱完成，开始领取宝箱积分和邮件附件`,
        type: "info",
      });
      await runSmartBoxOperation(
        token.name,
        "领取宝箱积分",
        () =>
          tokenStore.sendMessageWithPromise(
            tokenId,
            "item_batchclaimboxpointreward",
            {},
            HELPER_COMMAND_TIMEOUT_MS,
          ),
      );
      await waitForSmartBoxAction();
      try {
        await runSmartBoxOperation(token.name, "领取邮件附件", () =>
          tokenStore.sendMessageWithPromise(
            tokenId,
            "mail_claimallattachment",
            { category: 0 },
            HELPER_COMMAND_TIMEOUT_MS,
          ),
        );
      } catch (mailError) {
        if (!isNoClaimableMailError(mailError)) throw mailError;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 当前没有可领取的邮件附件，继续核对宝箱周进度`,
          type: "info",
        });
      }
      await waitForSmartBoxAction();
    };

    const claimBoxGrandReward = async (tokenId, token, description) => {
      await waitForSmartBoxAction();
      await runSmartBoxOperation(
        token.name,
        "领取宝箱周自选大奖",
        () =>
          tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_claimweekactreward",
            {
              // 原游戏接口使用 Map<number, number>；普通对象会把0编码为字符串键。
              selectRewardsMap: new Map([[0, 1]]),
              typ: 2,
            },
            HELPER_COMMAND_TIMEOUT_MS,
          ),
      );
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} ${description}万能红自选奖励领取成功`,
        type: "success",
      });
      await waitForSmartBoxAction();
      try {
        await runSmartBoxOperation(
          token.name,
          "领取宝箱周完成邮件",
          () =>
            tokenStore.sendMessageWithPromise(
              tokenId,
              "mail_claimallattachment",
              { category: 0 },
              HELPER_COMMAND_TIMEOUT_MS,
            ),
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} ${description}完成邮件附件领取成功`,
          type: "success",
        });
      } catch (mailError) {
        if (!isNoClaimableMailError(mailError)) throw mailError;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} ${description}完成后没有可领取的邮件附件`,
          type: "info",
        });
      }
    };

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      const token = tokens.value.find((item) => item.id === tokenId);
      tokenStatus.value[tokenId] = "running";

      try {
        if (activityWeek?.value && activityWeek.value !== "宝箱周") {
          tokenStatus.value[tokenId] = "skipped";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前为${activityWeek.value}，跳过智能宝箱周任务`,
            type: "warning",
          });
          return;
        }

        if (selectedTypes.length === 0) {
          throw new Error("至少选择一种宝箱类型");
        }

        await ensureConnection(tokenId);

        let activityResult = await fetchBoxActivity(tokenId, token.name);
        let boxWeekState = getBoxWeekState(activityResult);
        let recoveredRewardCount = 0;

        while (
          boxWeekState.pendingGrandRewardCount > 0 &&
          recoveredRewardCount < boxWeekState.totalRounds &&
          !shouldStop.value
        ) {
          const claimedBefore = boxWeekState.completedRounds;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 检测到${boxWeekState.pendingGrandRewardCount}轮自选大奖尚未领取，开始补领`,
            type: "info",
          });
          if (boxWeekState.hasCurrentGrandReward) {
            await claimPointsAndMail(tokenId, token);
          }
          await claimBoxGrandReward(
            tokenId,
            token,
            `历史漏领第${recoveredRewardCount + 1}轮`,
          );
          recoveredRewardCount += 1;
          activityResult = await fetchBoxActivity(tokenId, token.name, true);
          boxWeekState = getBoxWeekState(activityResult);
          if (boxWeekState.completedRounds <= claimedBefore) {
            throw new Error("补领自选大奖后，服务器已领取轮数未增加");
          }
        }

        const completedRounds = boxWeekState.completedRounds;
        const remainingRounds = Math.max(
          0,
          boxWeekState.totalRounds - completedRounds,
        );
        const groupCount = Math.min(
          Math.max(0, requestedGroupCount - recoveredRewardCount),
          remainingRounds,
        );

        if (groupCount === 0) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message:
              recoveredRewardCount > 0
                ? `${token.name} 已补领${recoveredRewardCount}轮自选大奖，无需继续开箱`
                : `${token.name} 宝箱周已完成${boxWeekState.totalRounds}/${boxWeekState.totalRounds}轮，无需继续执行`,
            type: "success",
          });
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始智能宝箱周任务：${token.name}，本周已领取${completedRounds}/${boxWeekState.totalRounds}轮大奖，本次继续执行${groupCount}轮 ===`,
          type: "info",
        });

        let completedGroups = 0;

        for (let groupIndex = 1; groupIndex <= groupCount; groupIndex += 1) {
          if (shouldStop.value) return;

          if (groupIndex > 1) {
            activityResult = await fetchBoxActivity(
              tokenId,
              token.name,
              true,
            );
            boxWeekState = getBoxWeekState(activityResult);
          }

          let currentProgress = boxWeekState.currentProgress;
          let cyclesForCurrentGroup = 0;
          let cachedRoleInfo = null;

          while (
            currentProgress < 8000 &&
            cyclesForCurrentGroup < maxCyclesPerGroup &&
            !shouldStop.value
          ) {
            cyclesForCurrentGroup += 1;
            const roleInfo =
              cachedRoleInfo ||
              (await fetchRoleInfo(tokenId, token.name, true));
            cachedRoleInfo = null;
            const inventory = getSmartBoxInventory(roleInfo);
            const selectedPoints = getSmartBoxPoints(inventory, selectedTypes);
            const remainingPoints = 8000 - currentProgress;
            const requiredStartPoints = Math.ceil(remainingPoints / 2);

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${groupIndex}/${groupCount}轮当前进度${currentProgress}/8000，选中宝箱积分${selectedPoints}`,
              type: "info",
            });

            if (
              cyclesForCurrentGroup === 1 &&
              selectedPoints < requiredStartPoints
            ) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 第${groupIndex}轮距离8000分还差${remainingPoints}分，启动门槛为${requiredStartPoints}分，当前可用宝箱积分仅${selectedPoints}分，跳过后续任务`,
                type: "warning",
              });
              break;
            }

            const plan = buildSmartBoxRefillPlan(
              inventory,
              selectedTypes,
              remainingPoints,
            );

            if (!plan) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 当前没有可用宝箱，停止任务`,
                type: "warning",
              });
              break;
            }

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${groupIndex}/${groupCount}轮本次开箱${plan.points}分，预计进度${Math.min(8000, currentProgress + plan.points)}/8000`,
              type: "info",
            });
            const openResult = await openSmartBoxes(
              tokenId,
              token,
              plan.boxes,
              "累计开箱",
              roleInfo,
            );
            if (openResult.openedPoints <= 0) break;

            activityResult = await fetchBoxActivity(
              tokenId,
              token.name,
              true,
            );
            boxWeekState = getBoxWeekState(activityResult);
            currentProgress = boxWeekState.currentProgress;

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${groupIndex}/${groupCount}轮服务器进度${currentProgress}/8000`,
              type: "info",
            });

            if (currentProgress >= 8000) break;

            const inventoryAfterOpening = getSmartBoxInventory(
              openResult.lastRoleInfo,
            );
            const pointsAfterOpening = getSmartBoxPoints(
              inventoryAfterOpening,
              selectedTypes,
            );
            const progressBeforeClaim = currentProgress;

            await claimPointsAndMail(tokenId, token);

            activityResult = await fetchBoxActivity(tokenId, token.name);
            boxWeekState = getBoxWeekState(activityResult);
            const refreshedProgress = boxWeekState.currentProgress;
            const refreshedRoleInfo = await fetchRoleInfo(
              tokenId,
              token.name,
              true,
            );
            const refreshedInventory =
              getSmartBoxInventory(refreshedRoleInfo);
            const refreshedPoints = getSmartBoxPoints(
              refreshedInventory,
              selectedTypes,
            );
            cachedRoleInfo = refreshedRoleInfo;

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${groupIndex}/${groupCount}轮服务器进度${refreshedProgress}/8000`,
              type: "info",
            });
            currentProgress = refreshedProgress;

            if (currentProgress >= 8000) break;

            if (
              refreshedPoints <= pointsAfterOpening &&
              currentProgress <= progressBeforeClaim
            ) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 领取积分和邮件后宝箱库存及活动进度均未增加，停止任务避免重复执行`,
                type: "warning",
              });
              break;
            }
          }

          if (currentProgress < 8000) {
            if (cyclesForCurrentGroup >= maxCyclesPerGroup) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 累计开箱达到${maxCyclesPerGroup}轮仍未凑够8000分，停止任务`,
                type: "warning",
              });
            }
            break;
          }

          await claimBoxGrandReward(
            tokenId,
            token,
            `宝箱周第${groupIndex}/${groupCount}轮`,
          );
          await waitForSmartBoxAction();
          activityResult = await fetchBoxActivity(tokenId, token.name);
          const claimedWeekState = getBoxWeekState(activityResult);
          if (
            claimedWeekState.completedRounds <= boxWeekState.completedRounds
          ) {
            throw new Error("宝箱周自选大奖请求已返回，但服务端轮次未更新");
          }
          boxWeekState = claimedWeekState;
          completedGroups += 1;
        }

        tokenStatus.value[tokenId] =
          completedGroups > 0 ? "completed" : "skipped";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 智能宝箱周任务结束：完成${completedGroups}/${groupCount}组 ===`,
          type: completedGroups === groupCount ? "success" : "warning",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 智能宝箱周任务失败：${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("智能宝箱周任务结束");
  };

  const batchOpenBoxByPoints = async (isScheduledTask = false) => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;

    const targetPoints = isScheduledTask
      ? batchSettings.targetBoxPoints
      : helperSettings.targetPoints;

    const boxPriority = [
      { id: 2002, name: "青铜宝箱", points: 10, reserve: 0 },
      { id: 2003, name: "黄金宝箱", points: 20, reserve: 0 },
      { id: 2004, name: "铂金宝箱", points: 50, reserve: 0 },
    ];

    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;

      tokenStatus.value[tokenId] = "running";
      const token = tokens.value.find((t) => t.id === tokenId);

      try {
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始按积分开箱: ${token.name} ===`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 目标积分: ${targetPoints}`,
          type: "info",
        });

        await ensureConnection(tokenId);

        const roleInfoRes = await tokenStore.sendMessageWithPromise(
          tokenId,
          "role_getroleinfo",
          {},
          5000,
        );
        const role = roleInfoRes?.role || roleInfoRes?.data?.role || {};
        const items = role.items || {};

        const boxInventory = {};
        let totalAvailablePoints = 0;

        for (const box of boxPriority) {
          const count = items[box.id]?.quantity || 0;
          boxInventory[box.id] = count;
          totalAvailablePoints += count * box.points;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 可用于积分开箱的库存: 青铜=${boxInventory[2002]}, 黄金=${boxInventory[2003]}, 铂金=${boxInventory[2004]}（木质宝箱不使用）`,
          type: "info",
        });
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 可获得总积分: ${totalAvailablePoints}`,
          type: "info",
        });

        if (totalAvailablePoints < targetPoints) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 积分不足! 需要 ${targetPoints}, 可获得 ${totalAvailablePoints}`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
          return;
        }

        const boxToOpen = {};
        let remainingPoints = targetPoints;

        if (remainingPoints > 0) {
          const bronzeAvailable = Math.floor(boxInventory[2002] / 10) * 10;
          const goldAvailable = Math.floor(boxInventory[2003] / 10) * 10;
          const platinumAvailable = Math.floor(boxInventory[2004] / 10) * 10;

          let bestResult = null;
          let minWaste = Infinity;

          for (let bronze = 0; bronze <= bronzeAvailable; bronze += 10) {
            const bronzePoints = bronze * 10;
            if (bronzePoints > remainingPoints) break;
            
            for (let gold = 0; gold <= goldAvailable; gold += 10) {
              const goldPoints = gold * 20;
              if (bronzePoints + goldPoints > remainingPoints) break;
              
              const afterBronzeGold = remainingPoints - bronzePoints - goldPoints;
              
              for (let platinum = 0; platinum <= platinumAvailable; platinum += 10) {
                const platinumPoints = platinum * 50;
                if (platinumPoints > afterBronzeGold) break;

                const totalPoints = bronzePoints + goldPoints + platinumPoints;
                const waste = totalPoints - targetPoints;

                if (waste >= 0 && waste < minWaste) {
                  minWaste = waste;
                  bestResult = { bronze, gold, platinum, totalPoints };
                  if (waste === 0) break;
                }
              }
              if (minWaste === 0) break;
            }
            if (minWaste === 0) break;
          }

          if (bestResult) {
            if (bestResult.bronze > 0) {
              boxToOpen[2002] = bestResult.bronze;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 青铜宝箱: ${bestResult.bronze} 个 (积分: ${bestResult.bronze * 10})`,
                type: "info",
              });
            }
            if (bestResult.gold > 0) {
              boxToOpen[2003] = bestResult.gold;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 黄金宝箱: ${bestResult.gold} 个 (积分: ${bestResult.gold * 20})`,
                type: "info",
              });
            }
            if (bestResult.platinum > 0) {
              boxToOpen[2004] = bestResult.platinum;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 铂金宝箱: ${bestResult.platinum} 个 (积分: ${bestResult.platinum * 50})`,
                type: "info",
              });
            }
            remainingPoints = 0;
          }
        }

        if (remainingPoints > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 无法在不使用木质宝箱的前提下凑够 ${targetPoints} 积分，已停止`,
            type: "error",
          });
          tokenStatus.value[tokenId] = "failed";
          return;
        }

        for (const box of boxPriority) {
          if (shouldStop.value) break;

          const count = boxToOpen[box.id] || 0;
          if (count <= 0) continue;

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 开始开 ${box.name}: ${count} 个`,
            type: "info",
          });

          await runInventoryVerifiedGameCommand({
            tokenStore,
            tokenId,
            cmd: "item_openbox",
            itemId: box.id,
            total: count,
            timeout: HELPER_COMMAND_TIMEOUT_MS,
            delayMs: delayConfig.action,
            createParams: (amount) => ({ itemId: box.id, number: amount }),
            queryInventory: () => tokenStore.sendGetRoleInfo(tokenId),
            onProgress: (progress) => {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} ${box.name} 开箱进度: ${progress.completed}/${count}`,
                type: "info",
              });
            },
          });
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 按积分开箱完成，开始领取宝箱积分和邮件附件`,
          type: "info",
        });
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "item_batchclaimboxpointreward",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        );
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 宝箱积分领取成功`,
          type: "success",
        });
        await new Promise((resolve) =>
          setTimeout(resolve, delayConfig.action),
        );
        try {
          await tokenStore.sendMessageWithPromise(
            tokenId,
            "mail_claimallattachment",
            { category: 0 },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 邮件附件领取成功`,
            type: "success",
          });
        } catch (mailError) {
          if (!isNoClaimableMailError(mailError)) throw mailError;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 当前没有可领取的邮件附件`,
            type: "info",
          });
        }

        await tokenStore.sendMessage(tokenId, "role_getroleinfo");
        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== ${token.name} 按积分开箱完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `按积分开箱失败: ${getErrorMessage(error)}`,
          type: "error",
        });
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} 连接已关闭  (队列: ${connectionQueue.active}/${batchSettings.maxActive})`,
          type: "info",
        });
      }
    });

    await Promise.all(taskPromises);

    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("按积分开箱结束");
  };

  return {
    batchClaimMailAttachments,
    batchClaimWeeklyActivityBenefit,
    batchUpgradeShoeToy,
    batchClaimAchievementRewards,
    batchMaxWarriorLegionTech,
    batchUpgradeCrystal,
    batchUpgradeEquipment,
    batchReplaceBestFishArtifact,
    batchOpenBox,
    batchOpenBoxByPoints,
    batchClaimBoxPointReward,
    batchSmartBoxWeekly,
    batchSmartRecruitWeekly,
    batchSmartBlackMarketWeekly,
    batchUseWarehouseItems,
    batchFish,
    batchRecruit,
    batchAutoStarBook,
    batchAwakenHeroSkills,
    batchHeroLevelUpgrade,
    batchUpgradeLordTo6000,
    batchAdjustEarlyMainLevelFormation,
    batchAdjustMainLevelFormation,
    batchBookUpgrade,
    batchClaimStarRewards,
    batchClaimPeachTasks,
    batchChallengeGroupGenie,
    batchChallengeThreeKingdomsGenie,
    batchGenieSweep,
  };
}
