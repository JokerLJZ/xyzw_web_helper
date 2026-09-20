import { HERO_DICT } from "@/utils/HeroList";
import { PEACH_TASKS } from "@/utils/PeachTaskIds";
import {
  HELPER_COMMAND_TIMEOUT_MS,
  getErrorMessage,
  getItemQuantity,
  runInventoryVerifiedGameCommand,
} from "@/utils/helperTaskRunner";

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

  const smartBoxPointUnit = 10;

  const getSmartBoxCandidates = (inventory, selectedTypes) =>
    smartBoxDefinitions
      .filter((box) => selectedTypes.includes(box.id))
      .map((box) => ({
        ...box,
        availableBatches: Math.floor(
          Math.max(0, (inventory[box.id] || 0) - (box.reserve || 0)) /
            box.batchSize,
        ),
        batchPoints: box.points * box.batchSize,
      }))
      .filter((box) => box.availableBatches > 0)
      .sort((left, right) => right.points - left.points);

  const buildSmartBoxStates = (candidates, maxUnits) => {
    let states = Array(maxUnits + 1).fill(null);
    states[0] = [];

    for (const candidate of candidates) {
      const nextStates = states.slice();
      const batchUnits = candidate.batchPoints / smartBoxPointUnit;
      const maxBatches = Math.min(
        candidate.availableBatches,
        Math.floor(maxUnits / batchUnits),
      );

      for (let currentUnits = 0; currentUnits <= maxUnits; currentUnits += 1) {
        if (!states[currentUnits]) continue;

        for (let count = 1; count <= maxBatches; count += 1) {
          const nextUnits = currentUnits + count * batchUnits;
          if (nextUnits > maxUnits) break;
          if (!nextStates[nextUnits]) {
            nextStates[nextUnits] = [
              ...states[currentUnits],
              { ...candidate, batches: count },
            ];
          }
        }
      }

      states = nextStates;
    }

    return states;
  };

  // Build the largest available opening plan up to the requested limit. The
  // task accumulates these partial plans until one group reaches 8000 points.
  const buildSmartBoxRefillPlan = (
    inventory,
    selectedTypes,
    maxPoints = 7500,
  ) => {
    const candidates = getSmartBoxCandidates(inventory, selectedTypes);
    if (candidates.length === 0) return null;

    const maxUnits = Math.floor(maxPoints / smartBoxPointUnit);
    const states = buildSmartBoxStates(candidates, maxUnits);
    const planUnits = states.reduce(
      (best, state, units) => (state && units > best ? units : best),
      0,
    );

    if (planUnits <= 0) return null;

    return {
      boxes: states[planUnits],
      points: planUnits * smartBoxPointUnit,
    };
  };

  const heroIds = Object.keys(HERO_DICT).map(Number);
  const starFragmentCosts = [
    8, 8, 8, 8, 8,
    40, 40, 40, 40, 40,
    80, 80, 80, 80, 80,
    200, 200, 200, 200, 200,
    400, 400, 400, 400, 400,
    400, 400, 400, 400, 400,
  ];
  const HERO_STAR_ACTION_DELAY_MS = 3000;
  const HERO_STAR_RATE_LIMIT_DELAY_MS = 6000;
  const HERO_STAR_MAX_RATE_LIMIT_RETRIES = 4;
  const lastHeroStarActionAt = new Map();
  const lastBookActionAt = new Map();
  const waitForHeroStarInterval = async (tokenId) => {
    const lastActionAt = lastHeroStarActionAt.get(tokenId) || 0;
    const waitMs = Math.max(
      0,
      HERO_STAR_ACTION_DELAY_MS - (Date.now() - lastActionAt),
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastHeroStarActionAt.set(tokenId, Date.now());
  };
  const waitForBookActionInterval = async (tokenId) => {
    const lastActionAt = lastBookActionAt.get(tokenId) || 0;
    const waitMs = Math.max(
      0,
      HERO_STAR_ACTION_DELAY_MS - (Date.now() - lastActionAt),
    );
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastBookActionAt.set(tokenId, Date.now());
  };

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

  const getLatestHero = async (tokenId, heroId, response) => {
    const responseHero = getHeroFromRoleInfo(response, heroId);
    if (responseHero) return responseHero;

    const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
    return getHeroFromRoleInfo(roleInfo, heroId);
  };

  /**
   * 批量英雄升星
   */
  const batchHeroUpgrade = async () => {
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
          message: `=== 开始英雄升星: ${token.name} ===`,
          type: "info",
        });

        await ensureConnection(tokenId);
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const upgradeableHeroIds = getUpgradeableHeroIds(roleInfo);
        addLog({
          time: new Date().toLocaleTimeString(),
          message:
            upgradeableHeroIds.length > 0
              ? `${token.name} 检测到${upgradeableHeroIds.length}名可升星武将：${upgradeableHeroIds.map((heroId) => HERO_DICT[heroId]?.name || heroId).join("、")}`
              : `${token.name} 当前没有可升星武将`,
          type: "info",
        });

        for (const heroId of upgradeableHeroIds) {
          if (shouldStop.value) break;
          const heroName = HERO_DICT[heroId]?.name || `英雄ID:${heroId}`;
          const initialStar = Number(getHeroFromRoleInfo(roleInfo, heroId)?.star) || 0;
          let currentStar = initialStar;

          while (!shouldStop.value && currentStar < 30) {
            const fragmentCost = Number(starFragmentCosts[currentStar]) || 0;
            const fragmentCount = getItemQuantity(roleInfo, heroId);
            if (fragmentCost <= 0 || fragmentCount < fragmentCost) break;

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
            roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
            const latestStar =
              Number(getHeroFromRoleInfo(roleInfo, heroId)?.star) || 0;
            if (latestStar <= currentStar) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} ${heroName}升星后星级未变化，停止该武将`,
                type: "warning",
              });
              break;
            }
            currentStar = latestStar;
          }

          if (currentStar > initialStar) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${heroName}：${initialStar}星 → ${currentStar}星`,
              type: "success",
            });
          }
        }

        tokenStatus.value[tokenId] = "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} === 英雄升星完成 ===`,
          type: "success",
        });
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `英雄升星失败: ${error.message}`,
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
    message.success("批量英雄升星结束");
  };

  /**
   * 将单个武将升级并自动进阶到目标等级。
   */
  const upgradeSingleHero = async (tokenId, tokenName, heroId, targetLevel) => {
    const heroName = HERO_DICT[heroId]?.name || `英雄ID:${heroId}`;
    const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
    let hero = getHeroFromRoleInfo(roleInfo, heroId);

    if (!hero) {
      throw new Error(`账号中未找到${heroName}`);
    }

    let currentLevel = Number(hero.level) || 0;
    let currentOrder = Number(hero.order) || 0;

    if (currentLevel >= targetLevel) {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${heroName}当前${currentLevel}级，已达到目标，跳过操作`,
        type: "info",
      });
      return;
    }

    while (!shouldStop.value) {
      const nextOrder = heroLevelOrderThresholds.find(
        (item) => item.order > currentOrder,
      );

      if (nextOrder && currentLevel >= nextOrder.level) {
        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_heroupgradeorder",
          { heroId },
          5000,
        );

        if (!isSuccessfulHeroCommand(result)) {
          throw new Error(`进阶失败（当前${currentLevel}级）`);
        }

        hero = await getLatestHero(tokenId, heroId, result);
        const updatedOrder = Number(hero?.order);
        if (!hero || !Number.isFinite(updatedOrder) || updatedOrder <= currentOrder) {
          throw new Error("进阶后未获取到最新武将阶数");
        }

        currentOrder = updatedOrder;
        currentLevel = Number(hero.level) || currentLevel;
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
      const upgradeNum = Math.min(50, levelBoundary - currentLevel);

      if (upgradeNum <= 0) {
        throw new Error(`无法继续升级（当前${currentLevel}级，${currentOrder}阶）`);
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

      hero = await getLatestHero(tokenId, heroId, result);
      const updatedLevel = Number(hero?.level);
      if (!hero || !Number.isFinite(updatedLevel) || updatedLevel <= currentLevel) {
        throw new Error("升级后未获取到最新武将等级");
      }

      currentLevel = updatedLevel;
      currentOrder = Number(hero.order) || currentOrder;
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${tokenName} ${heroName}升级至${currentLevel}级`,
        type: "success",
      });
      await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: shouldStop.value
        ? `${tokenName} ${heroName}升级任务已停止，当前${currentLevel}级`
        : `${tokenName} ${heroName}已完成至${currentLevel}级`,
      type: shouldStop.value ? "warning" : "success",
    });
  };

  const upgradeLordToLevel = async (tokenId, tokenName, targetLevel) => {
    let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
    let lord = roleInfo?.role?.lord;
    if (!lord) throw new Error("未获取到主公信息");

    let currentLevel = Number(lord.level) || 0;
    let currentOrder = Number(lord.order) || 0;
    while (!shouldStop.value && currentLevel < targetLevel) {
      const nextOrder = heroLevelOrderThresholds.find(
        (item) => item.order > currentOrder,
      );

      if (nextOrder && currentLevel >= nextOrder.level) {
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_lordupgradeorder",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        );
      } else {
        const levelBoundary = Math.min(
          targetLevel,
          nextOrder?.level || targetLevel,
        );
        const upgradeNum = Math.min(50, levelBoundary - currentLevel);
        if (upgradeNum <= 0) {
          throw new Error(`主公无法继续升级（当前${currentLevel}级，${currentOrder}阶）`);
        }
        await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_lordupgradelevel",
          { upgradeNum },
          HELPER_COMMAND_TIMEOUT_MS,
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, HERO_STAR_ACTION_DELAY_MS),
      );
      roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
      lord = roleInfo?.role?.lord;
      const updatedLevel = Number(lord?.level);
      const updatedOrder = Number(lord?.order);
      if (
        !lord ||
        !Number.isFinite(updatedLevel) ||
        !Number.isFinite(updatedOrder) ||
        (updatedLevel <= currentLevel && updatedOrder <= currentOrder)
      ) {
        throw new Error("主公升级后等级和阶数均未变化");
      }
      currentLevel = updatedLevel;
      currentOrder = updatedOrder;
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 主公已升级至${currentLevel}级（${currentOrder}阶）`,
      type: "success",
    });
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

      if (lordOrder > luBuOrder || luBuLevel < lordLevel) {
        if (luBuLevel >= lordLevel && luBuOrder < lordOrder) {
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
        await upgradeSingleHero(tokenId, tokenName, LU_BU_ID, lordLevel);
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
      await upgradeLordToLevel(tokenId, tokenName, nextLordLevel);
    }
  };

  /** 小号任务：将所选账号的主公直接升级至6000级。 */
  const batchUpgradeLordTo6000 = async () => {
    if (selectedTokens.value.length === 0) return;

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((tokenId) => {
      tokenStatus.value[tokenId] = "waiting";
    });

    const taskPromises = selectedTokens.value.map(async (tokenId) => {
      if (shouldStop.value) return;
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
        await upgradeLordToLevel(tokenId, tokenName, 6000);
        tokenStatus.value[tokenId] = shouldStop.value
          ? "stopped"
          : "completed";
        addLog({
          time: new Date().toLocaleTimeString(),
          message: shouldStop.value
            ? `${tokenName} 主公升级任务已停止`
            : `${tokenName} 主公升级至6000级任务完成`,
          type: shouldStop.value ? "warning" : "success",
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
    });

    await Promise.all(taskPromises);
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

  const getPresetTeamHeroes = (presetTeamResult) => {
    const teamInfo = presetTeamResult?.presetTeamInfo;
    const teams = teamInfo?.presetTeamInfo || teamInfo?.teams || {};
    const activeTeamId = teamInfo?.useTeamId;
    const activeTeam =
      teams?.[activeTeamId] || teams?.[String(activeTeamId)] || teams;

    return Object.entries(activeTeam || {})
      .map(([key, hero]) => ({
        heroId: Number(hero?.heroId ?? hero?.id),
        slot: Number(hero?.battleTeamSlot ?? hero?.position ?? key),
      }))
      .filter(
        (hero) => Number.isFinite(hero.heroId) && Number.isFinite(hero.slot),
      );
  };

  const adjustMainLevelFormation = async (tokenId, tokenName) => {
    const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
    const ownedHeroIds = new Set(
      Object.values(roleInfo?.role?.heroes || {}).map((hero) =>
        Number(hero?.heroId ?? hero?.id),
      ),
    );
    const targetHeroes = [
      { heroId: 107, slot: 0 }, // 吕布
      { heroId: 110, slot: 1 }, // 黄月英
      { heroId: 104, slot: 2 }, // 诸葛亮
      { heroId: 106, slot: 3 }, // 太史慈
      {
        heroId: ownedHeroIds.has(223) ? 223 : 204, // 蔡文姬，否则张飞
        slot: 4,
      },
    ].filter((target) => ownedHeroIds.has(target.heroId));

    const currentTeamResult = await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_getinfo",
      {},
      5000,
    );
    const currentHeroes = getPresetTeamHeroes(currentTeamResult);

    for (const hero of currentHeroes) {
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "hero_gobackbattle",
        { slot: hero.slot },
        5000,
      );
      await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
    }

    for (const target of targetHeroes) {
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "hero_gointobattle",
        { heroId: target.heroId, slot: target.slot },
        5000,
      );
      await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      message: `${tokenName} 推图默认阵容已调整：${targetHeroes
        .map((hero) => `${hero.slot + 1}号位${HERO_DICT[hero.heroId]?.name}`)
        .join("、")}`,
      type: "success",
    });
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
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const ownedHeroIds = new Set(
          Object.values(roleInfo?.role?.heroes || {}).map((hero) =>
            Number(hero?.heroId ?? hero?.id),
          ),
        );

        for (const group of upgradeGroups) {
          for (const heroId of group.heroIds) {
            if (shouldStop.value) break;
            if (!ownedHeroIds.has(heroId)) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${tokenName} 未拥有${HERO_DICT[heroId].name}，跳过升级`,
                type: "info",
              });
              continue;
            }

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

        if (!shouldStop.value && ownedHeroIds.has(107)) {
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

        const latestRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const remainingPlan = getBookUpgradePlan(latestRoleInfo);
        if (remainingPlan.length > 0 && !shouldStop.value) {
          throw new Error(
            `仍有${remainingPlan.reduce((sum, item) => sum + item.upgradeCount, 0)}次图鉴升星未完成`,
          );
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
  const batchUseWarehouseItems = async (taskConfig = {}) => {
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
    const EXCLUDED_ACTIVITY_ITEM_IDS = new Set([5054, 6001]);
    const LVBU_ID = 107;
    const TAISHICI_ID = 106;
    const DIAOCHAN_ID = 210;
    const useUniversalRed = taskConfig.useUniversalRed !== false;
    const useUniversalOrange = taskConfig.useUniversalOrange !== false;
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
    const useInBatches = async ({
      tokenId,
      itemId,
      quantity,
      index = 0,
      tokenName,
      command = "item_openpack",
    }) => {
      let remaining = Math.max(0, Math.trunc(quantity));
      let used = 0;
      while (remaining > 0 && !shouldStop.value) {
        const amount = Math.min(MAX_USE_PER_REQUEST, remaining);
        const beforeInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const beforeQuantity = getQuantity(getItems(beforeInfo), itemId);
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
              await sleep(RATE_LIMIT_RETRY_DELAY_MS);
              continue;
            }
            // 请求超时或异常时先对账，防止服务器已成功却重复使用。
            const afterInfo = await tokenStore.sendGetRoleInfo(tokenId);
            const afterQuantity = getQuantity(getItems(afterInfo), itemId);
            consumedAmount = Math.max(0, beforeQuantity - afterQuantity);
            if (consumedAmount > 0) break;
            throw error;
          }
        }

        used += consumedAmount;
        remaining -= consumedAmount;
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
    const upgradeHeroStars = async (tokenId, heroId, tokenName) => {
      const heroName = HERO_DICT[heroId]?.name || `武将${heroId}`;
      let upgraded = 0;

      while (!shouldStop.value) {
        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const currentStar = getHeroStar(getHeroes(roleInfo), heroId);
        const fragmentCost = Number(starFragmentCosts[currentStar]) || 0;
        const fragmentCount = getQuantity(getItems(roleInfo), heroId);
        if (currentStar >= 30 || fragmentCost <= 0 || fragmentCount < fragmentCost) {
          break;
        }

        for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
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
            if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
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

        const latestRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const latestStar = getHeroStar(getHeroes(latestRoleInfo), heroId);
        if (latestStar <= currentStar) {
          throw new Error(`${heroName}升星后星级未变化`);
        }

        upgraded += latestStar - currentStar;
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} ${heroName}已升至${latestStar}星`,
          type: "success",
        });
      }

      return upgraded;
    };
    const executeBookCommand = async (tokenId, command, params) => {
      for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
        try {
          await waitForBookActionInterval(tokenId);
          const result = await tokenStore.sendMessageWithPromise(
            tokenId,
            command,
            params,
            HELPER_COMMAND_TIMEOUT_MS,
          );
          if (!isSuccessfulBookCommand(result)) {
            throw new Error(`${command}执行失败`);
          }
          return result;
        } catch (error) {
          if (!isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
            throw error;
          }
          await sleep(RATE_LIMIT_RETRY_DELAY_MS);
        }
      }
      return null;
    };
    const upgradeHeroBooks = async (tokenId) => {
      const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
      const upgradePlan = getBookUpgradePlan(roleInfo);
      let upgraded = 0;
      for (const { heroId, upgradeCount } of upgradePlan) {
        for (
          let index = 0;
          index < upgradeCount && !shouldStop.value;
          index += 1
        ) {
          await executeBookCommand(tokenId, "book_upgrade", { heroId });
          upgraded += 1;
        }
      }

      const latestRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
      const remainingPlan = getBookUpgradePlan(latestRoleInfo);
      if (remainingPlan.length > 0 && !shouldStop.value) {
        throw new Error(
          `图鉴升星校验失败，仍有${remainingPlan.reduce(
            (sum, item) => sum + item.upgradeCount,
            0,
          )}次未完成`,
        );
      }
      return {
        upgraded,
        heroCount: upgradePlan.length,
        planned: upgradePlan.reduce(
          (sum, item) => sum + item.upgradeCount,
          0,
        ),
      };
    };
    const claimBookRewards = async (tokenId) => {
      let claimed = 0;
      // 每次成功后继续领取，直到服务器提示当前已无可领取奖励。
      for (let attempt = 0; attempt < 10 && !shouldStop.value; attempt += 1) {
        try {
          await executeBookCommand(tokenId, "book_claimpointreward", {});
          claimed += 1;
        } catch (error) {
          break;
        }
      }
      return claimed;
    };
    const useUniversalFragments = async ({
      tokenId,
      universalItemId,
      resolveTargetHeroId,
      tokenName,
    }) => {
      while (!shouldStop.value) {
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        let targetHeroId = resolveTargetHeroId(roleInfo);

        // 先把已有的目标武将碎片用掉，再计算还需要转换多少万能碎片。
        await upgradeHeroStars(tokenId, targetHeroId, tokenName);
        roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        targetHeroId = resolveTargetHeroId(roleInfo);
        if (getHeroStar(getHeroes(roleInfo), targetHeroId) >= 30) break;

        const universalQuantity = getQuantity(
          getItems(roleInfo),
          universalItemId,
        );
        if (universalQuantity <= 0) break;
        const amount = getUniversalAmountForImmediateUpgrades(
          roleInfo,
          targetHeroId,
          universalQuantity,
        );
        if (amount <= 0) {
          const heroName = HERO_DICT[targetHeroId]?.name || targetHeroId;
          const currentStar = getHeroStar(getHeroes(roleInfo), targetHeroId);
          const fragmentCount = getQuantity(getItems(roleInfo), targetHeroId);
          const nextCost = Number(starFragmentCosts[currentStar]) || 0;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} ${heroName}升星还需${Math.max(0, nextCost - fragmentCount)}个碎片，当前万能碎片${universalQuantity}个，不转换以避免碎片闲置`,
            type: "info",
          });
          break;
        }
        const index =
          universalItemId === UNIVERSAL_RED_ITEM_ID
            ? targetHeroId - 101
            : targetHeroId - 201;
        await useInBatches({
          tokenId,
          itemId: universalItemId,
          quantity: amount,
          index,
          tokenName,
        });
        const upgraded = await upgradeHeroStars(
          tokenId,
          targetHeroId,
          tokenName,
        );
        if (upgraded <= 0) {
          throw new Error(
            `${HERO_DICT[targetHeroId]?.name || targetHeroId}使用万能碎片后未能升星`,
          );
        }
      }
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
        let roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const mainLevel = getMainLevel(roleInfo);
        const items = getItems(roleInfo);
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 当前主线关卡${mainLevel}，开始使用仓库物品`,
          type: "info",
        });

        const redQuantity = getQuantity(items, UNIVERSAL_RED_ITEM_ID);
        if (useUniversalRed && redQuantity > 0) {
          await useUniversalFragments({
            tokenId,
            universalItemId: UNIVERSAL_RED_ITEM_ID,
            resolveTargetHeroId: (latestRoleInfo) =>
              getHeroStar(getHeroes(latestRoleInfo), LVBU_ID) < 30
                ? LVBU_ID
                : TAISHICI_ID,
            tokenName,
          });
        } else if (!useUniversalRed && redQuantity > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 已关闭自动使用万能红碎，跳过${redQuantity}个`,
            type: "info",
          });
        }

        const orangeQuantity = getQuantity(items, UNIVERSAL_ORANGE_ITEM_ID);
        if (useUniversalOrange && orangeQuantity > 0) {
          await useUniversalFragments({
            tokenId,
            universalItemId: UNIVERSAL_ORANGE_ITEM_ID,
            resolveTargetHeroId: () => DIAOCHAN_ID,
            tokenName,
          });
        } else if (!useUniversalOrange && orangeQuantity > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 已关闭自动使用万能橙碎，跳过${orangeQuantity}个`,
            type: "info",
          });
        }

        if (mainLevel >= 7200) {
          const coinBagQuantity = getQuantity(items, COIN_BAG_ITEM_ID);
          if (coinBagQuantity > 0) {
            await useInBatches({
              tokenId,
              itemId: COIN_BAG_ITEM_ID,
              quantity: coinBagQuantity,
              tokenName,
            });
          }
        } else if (getQuantity(items, COIN_BAG_ITEM_ID) > 0) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 主线未达到7200，跳过金币袋使用`,
            type: "warning",
          });
        }

        for (const itemId of OPEN_PACK_ITEM_IDS) {
          if (itemId === COIN_BAG_ITEM_ID || shouldStop.value) continue;
          const quantity = getQuantity(items, itemId);
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

        roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
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

        roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const upgradeableHeroIds = getUpgradeableHeroIds(roleInfo);
        addLog({
          time: new Date().toLocaleTimeString(),
          message:
            upgradeableHeroIds.length > 0
              ? `${tokenName} 仓库物品处理完成，检测到${upgradeableHeroIds.length}名可升星武将：${upgradeableHeroIds.map((heroId) => HERO_DICT[heroId]?.name || heroId).join("、")}`
              : `${tokenName} 仓库物品处理完成，当前没有可升星武将`,
          type: "info",
        });
        let upgradedHeroCount = 0;
        let upgradedStarCount = 0;
        for (const heroId of upgradeableHeroIds) {
          if (shouldStop.value) break;
          try {
            const upgraded = await upgradeHeroStars(
              tokenId,
              heroId,
              tokenName,
            );
            if (upgraded > 0) {
              upgradedHeroCount += 1;
              upgradedStarCount += upgraded;
            }
          } catch (error) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${tokenName} ${HERO_DICT[heroId]?.name || heroId}升星失败，继续下一武将：${getErrorMessage(error)}`,
              type: "warning",
            });
          }
        }
        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${tokenName} 全武将升星完成：${upgradedHeroCount}名武将，共提升${upgradedStarCount}星`,
          type: "success",
        });

        if (!shouldStop.value) {
          // 与最后一次武将升星至少间隔3秒，再开始图鉴相关操作。
          await sleep(HERO_STAR_ACTION_DELAY_MS);
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 开始执行图鉴升星`,
            type: "info",
          });
          const bookUpgradeResult = await upgradeHeroBooks(tokenId);
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 图鉴升星完成：检测${bookUpgradeResult.heroCount}名武将，计划${bookUpgradeResult.planned}次，成功${bookUpgradeResult.upgraded}次；开始领取图鉴奖励`,
            type: "success",
          });
          const claimedBookRewardCount = await claimBookRewards(tokenId);
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${tokenName} 图鉴奖励领取完成：成功${claimedBookRewardCount}次`,
            type: "success",
          });
        }

        roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
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
    isRunning.value = false;
    currentRunningTokenId.value = null;
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

    const getBoxWeekState = (activityResult) => {
      const activity =
        activityResult?.activity ||
        activityResult?.data?.activity ||
        activityResult?.body?.activity;
      const info = activity?.myTotalInfo?.["2"];
      if (!info) return { completedRounds: 0, currentProgress: 0 };

      const complete = info.complete || {};
      const boxActivity = activity.activity?.find(
        (item) => Number(item?.id) === 2,
      );
      const rewardCount = boxActivity?.data?.rewards?.length || 5;
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
        currentProgress: Math.min(8000, Math.max(0, Number(info.num) || 0)),
      };
    };

    isRunning.value = true;
    shouldStop.value = false;
    selectedTokens.value.forEach((id) => {
      tokenStatus.value[id] = "waiting";
    });

    const fetchRoleInfo = (tokenId) =>
      tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
        HELPER_COMMAND_TIMEOUT_MS,
      );

    const openSmartBoxes = async (tokenId, token, boxes, phase) => {
      let openedPoints = 0;

      for (const box of boxes) {
        if (shouldStop.value) break;

        const count = box.batches
          ? box.batches * box.batchSize
          : Math.floor((box.count || 0) / box.batchSize) * box.batchSize;
        if (count <= 0) continue;

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `${token.name} ${phase}：${box.name} ${count}个（${count * box.points}分）`,
          type: "info",
        });

        await runInventoryVerifiedGameCommand({
          tokenStore,
          tokenId,
          cmd: "item_openbox",
          itemId: box.id,
          total: count,
          batchSize: box.batchSize,
          timeout: HELPER_COMMAND_TIMEOUT_MS,
          delayMs: delayConfig.action,
          createParams: (amount) => ({ itemId: box.id, number: amount }),
          queryInventory: () => fetchRoleInfo(tokenId),
          onProgress: (progress) => {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} ${box.name}进度：${progress.completed}/${count}`,
              type: "info",
            });
          },
        });
        openedPoints += count * box.points;
      }

      return openedPoints;
    };

    const claimPointsAndMail = async (tokenId, token) => {
      addLog({
        time: new Date().toLocaleTimeString(),
        message: `${token.name} 本轮开箱完成，开始领取宝箱积分和邮件附件`,
        type: "info",
      });
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "item_batchclaimboxpointreward",
        {},
        HELPER_COMMAND_TIMEOUT_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, delayConfig.action));
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "mail_claimallattachment",
        { category: 0 },
        HELPER_COMMAND_TIMEOUT_MS,
      );
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

        let activityResult = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_get",
          {},
          HELPER_COMMAND_TIMEOUT_MS,
        );
        let boxWeekState = getBoxWeekState(activityResult);
        const completedRounds = boxWeekState.completedRounds;
        const remainingRounds = Math.max(0, 4 - completedRounds);
        const groupCount = Math.min(requestedGroupCount, remainingRounds);

        if (groupCount === 0) {
          tokenStatus.value[tokenId] = "completed";
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 宝箱周已完成4/4轮，无需继续执行`,
            type: "success",
          });
          return;
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始智能宝箱周任务：${token.name}，本周已完成${completedRounds}/4轮，本次执行${groupCount}轮 ===`,
          type: "info",
        });

        let completedGroups = 0;

        for (let groupIndex = 1; groupIndex <= groupCount; groupIndex += 1) {
          if (shouldStop.value) return;

          if (groupIndex > 1) {
            activityResult = await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_get",
              {},
              HELPER_COMMAND_TIMEOUT_MS,
            );
            boxWeekState = getBoxWeekState(activityResult);
          }

          let currentProgress = boxWeekState.currentProgress;
          let cyclesForCurrentGroup = 0;

          if (currentProgress >= 8000) {
            await claimPointsAndMail(tokenId, token);
          }

          while (
            currentProgress < 8000 &&
            cyclesForCurrentGroup < maxCyclesPerGroup &&
            !shouldStop.value
          ) {
            cyclesForCurrentGroup += 1;
            const roleInfo = await fetchRoleInfo(tokenId);
            const inventory = getSmartBoxInventory(roleInfo);
            const selectedPoints = getSmartBoxPoints(inventory, selectedTypes);
            const requiredStartPoints = Math.max(0, 4000 - currentProgress);

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
                message: `${token.name} 第${groupIndex}轮补到4000进度需要${requiredStartPoints}分，当前选中宝箱仅${selectedPoints}分，跳过后续任务`,
                type: "warning",
              });
              break;
            }

            const remainingPoints = 8000 - currentProgress;
            const plan = buildSmartBoxRefillPlan(
              inventory,
              selectedTypes,
              Math.min(remainingPoints, 7500),
            );

            if (!plan) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 没有满足批次要求的可开宝箱，停止任务`,
                type: "warning",
              });
              break;
            }

            const beforeInventory = JSON.stringify(
              selectedTypes.map((id) => inventory[id] || 0),
            );
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${groupIndex}/${groupCount}轮本次开箱${plan.points}分，预计进度${Math.min(8000, currentProgress + plan.points)}/8000`,
              type: "info",
            });
            const openedPoints = await openSmartBoxes(
              tokenId,
              token,
              plan.boxes,
              "累计开箱",
            );
            if (openedPoints <= 0) break;

            await claimPointsAndMail(tokenId, token);

            activityResult = await tokenStore.sendMessageWithPromise(
              tokenId,
              "activity_get",
              {},
              HELPER_COMMAND_TIMEOUT_MS,
            );
            boxWeekState = getBoxWeekState(activityResult);
            const refreshedProgress = boxWeekState.currentProgress;
            const refreshedInventory = getSmartBoxInventory(
              await fetchRoleInfo(tokenId),
            );
            const afterInventory = JSON.stringify(
              selectedTypes.map((id) => refreshedInventory[id] || 0),
            );

            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${groupIndex}/${groupCount}轮服务器进度${refreshedProgress}/8000`,
              type: "info",
            });
            currentProgress = refreshedProgress;

            if (currentProgress >= 8000) break;

            if (beforeInventory === afterInventory) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 领取积分和邮件后库存没有增加，停止任务避免重复执行`,
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

          await tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_claimweekactreward",
            {
              selectRewardsMap: { 0: 1 },
              typ: 2,
            },
            HELPER_COMMAND_TIMEOUT_MS,
          );
          completedGroups += 1;
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 宝箱周第${groupIndex}/${groupCount}轮万能红自选奖励领取成功`,
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
            message: `${token.name} 宝箱周第${groupIndex}/${groupCount}轮完成后邮件附件领取成功`,
            type: "success",
          });
          boxWeekState = {
            completedRounds: Math.min(4, completedRounds + groupIndex),
            currentProgress: 0,
          };
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
      { id: 2001, name: "木质宝箱", points: 1, reserve: 200 },
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
          message: `${token.name} 箱子库存: 木质=${boxInventory[2001]}, 青铜=${boxInventory[2002]}, 黄金=${boxInventory[2003]}, 铂金=${boxInventory[2004]}`,
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

        const woodenAvailable = boxInventory[2001] - 200;
        if (woodenAvailable >= 10) {
          const woodenPoints = woodenAvailable * 1;
          const pointsNeeded = Math.min(woodenPoints, remainingPoints);
          let woodenToOpen = Math.min(pointsNeeded, woodenAvailable);
          woodenToOpen = Math.floor(woodenToOpen / 10) * 10;
          if (woodenToOpen === 0 && woodenAvailable >= 10 && pointsNeeded > 0) {
            woodenToOpen = 10;
          }
          
          if (woodenToOpen >= 10) {
            boxToOpen[2001] = woodenToOpen;
            remainingPoints -= woodenToOpen * 1;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 计划开 木质宝箱: ${woodenToOpen} 个 (积分: ${woodenToOpen})`,
              type: "info",
            });
          }
        }

        if (remainingPoints > 0) {
          const bronzeAvailable = Math.floor(boxInventory[2002] / 10) * 10;
          const goldAvailable = Math.floor(boxInventory[2003] / 10) * 10;
          const platinumAvailable = Math.floor(boxInventory[2004] / 10) * 10;
          const woodenTotal = Math.floor(boxInventory[2001] / 10) * 10;

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
                
                const afterPlatinum = afterBronzeGold - platinumPoints;
                
                let wooden = 0;
                if (afterPlatinum > 0) {
                  wooden = Math.ceil(afterPlatinum / 10) * 10;
                  if (wooden > woodenTotal || wooden > 100) continue;
                }
                
                const totalPoints = bronzePoints + goldPoints + platinumPoints + wooden;
                const waste = totalPoints - targetPoints;
                
                if (waste >= 0 && waste < minWaste) {
                  minWaste = waste;
                  bestResult = { bronze, gold, platinum, wooden, totalPoints };
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
            if (bestResult.wooden > 0) {
              boxToOpen[2001] = (boxToOpen[2001] || 0) + bestResult.wooden;
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 计划开 木质宝箱: ${bestResult.wooden} 个 (积分: ${bestResult.wooden})`,
                type: "info",
              });
            }
            remainingPoints = 0;
          }
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
    batchOpenBox,
    batchOpenBoxByPoints,
    batchClaimBoxPointReward,
    batchSmartBoxWeekly,
    batchSmartRecruitWeekly,
    batchSmartBlackMarketWeekly,
    batchUseWarehouseItems,
    batchFish,
    batchRecruit,
    batchHeroUpgrade,
    batchHeroLevelUpgrade,
    batchUpgradeLordTo6000,
    batchAdjustMainLevelFormation,
    batchBookUpgrade,
    batchClaimStarRewards,
    batchClaimPeachTasks,
    batchGenieSweep,
  };
}
