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
      .reduce((total, box) => total + (inventory[box.id] || 0) * box.points, 0);

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
  ];

  const getHeroFromRoleInfo = (roleInfo, heroId) => {
    const heroes = roleInfo?.role?.heroes;
    if (!heroes) return null;

    if (Array.isArray(heroes)) {
      return heroes.find((hero) => Number(hero?.heroId) === Number(heroId));
    }

    return heroes[heroId] || heroes[String(heroId)] || null;
  };

  const isSuccessfulHeroCommand = (result) =>
    Boolean(
      result &&
        (result.role?.heroes ||
          result.code === 0 ||
          result.success === true ||
          result.result === 0),
    );

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

        for (const heroId of heroIds) {
          if (shouldStop.value) break;

          // 每个英雄尝试最多10次升星（只要成功就继续，失败则跳过该英雄）
          for (let i = 1; i <= 10; i++) {
            if (shouldStop.value) break;

            try {
              const res = await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_heroupgradestar",
                { heroId },
                5000,
              );
              const ok =
                res &&
                (res.code === 0 || res.success === true || res.result === 0);

              if (ok) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 英雄ID:${heroId} 升星成功 (第${i}次)`,
                  type: "success",
                });
                // 成功了继续尝试下一级，直到失败或达到10次
              } else {
                // 失败说明无法继续升星（碎片不足或满星），跳出循环处理下一个英雄
                throw new Error("升星失败");
              }
            } catch (err) {
              // 失败则停止当前英雄的升星尝试
              break;
            }
            await new Promise((r) => setTimeout(r, delayConfig.action));
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

        for (const heroId of heroIds) {
          if (shouldStop.value) break;

          // 每个英雄尝试最多10次图鉴升星（只要成功就继续，失败则跳过该英雄）
          for (let i = 1; i <= 10; i++) {
            if (shouldStop.value) break;

            try {
              const res = await tokenStore.sendMessageWithPromise(
                tokenId,
                "book_upgrade",
                { heroId },
                5000,
              );
              const ok =
                res &&
                (res.code === 0 || res.success === true || res.result === 0);

              if (ok) {
                addLog({
                  time: new Date().toLocaleTimeString(),
                  message: `${token.name} 英雄ID:${heroId} 图鉴升星成功 (第${i}次)`,
                  type: "success",
                });
                // 成功了继续尝试下一级，直到失败或达到10次
              } else {
                // 失败说明无法继续图鉴升星（碎片不足或满星），跳出循环处理下一个英雄
                throw new Error("图鉴升星失败");
              }
            } catch (err) {
              // 失败则停止当前英雄的图鉴升星尝试
              break;
            }
            await new Promise((r) => setTimeout(r, delayConfig.action));
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
   * 智能招募周任务：起始招募道具达到360个后，招募360次、领取邮件，再完成40次。
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
    const remainingCount = totalCount - startCount;
    const roundCount = Math.min(
      4,
      Math.max(1, Math.trunc(Number(taskConfig.roundCount) || 1)),
    );

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
    ) => {
      await runInventoryVerifiedGameCommand({
        tokenStore,
        tokenId,
        cmd: "hero_recruit",
        itemId: 1001,
        total: count,
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
            message: `${token.name} 招募周第${roundIndex}/${roundCount}轮进度：${progressOffset + progress.completed}/${totalCount}`,
            type: "info",
          });
        },
      });
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

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始智能招募周任务：${token.name}，目标${roundCount}轮，每轮${totalCount}次 ===`,
          type: "info",
        });
        await ensureConnection(tokenId);

        for (let roundIndex = 1; roundIndex <= roundCount; roundIndex += 1) {
          if (shouldStop.value) return;

          const initialRoleInfo = await tokenStore.sendGetRoleInfo(tokenId);
          const initialRecruitCount = getItemQuantity(initialRoleInfo, 1001);
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周第${roundIndex}/${roundCount}轮起始招募道具${initialRecruitCount}个，启动要求${startCount}个`,
            type: "info",
          });

          if (initialRecruitCount < startCount) {
            tokenStatus.value[tokenId] = "skipped";
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 招募周第${roundIndex}轮起始数量不足${startCount}个，跳过后续任务`,
              type: "warning",
            });
            return;
          }

          await runRecruitBatch(tokenId, token, startCount, 0, roundIndex);
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周第${roundIndex}轮已完成${startCount}个，开始领取邮件附件`,
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
          await runRecruitBatch(
            tokenId,
            token,
            remainingCount,
            startCount,
            roundIndex,
          );

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 招募周第${roundIndex}/${roundCount}轮完成：${totalCount}/${totalCount}次`,
            type: "success",
          });
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
    const groupCount = Math.min(
      4,
      Math.max(1, Math.trunc(Number(taskConfig.smartBoxGroupCount) || 1)),
    );
    // 奖励领取后可能只补回少量宝箱，需要多轮补开才能凑出8000分。
    // 同时设置上限，避免奖励接口异常时任务无限循环。
    const maxCyclesPerGroup = 20;

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

        addLog({
          time: new Date().toLocaleTimeString(),
          message: `=== 开始智能宝箱周任务：${token.name}，目标${groupCount}组 ===`,
          type: "info",
        });
        await ensureConnection(tokenId);

        let completedGroups = 0;
        let cycle = 0;
        let cyclesForCurrentGroup = 0;
        let currentGroupStarted = false;
        let accumulatedPoints = 0;

        while (
          completedGroups < groupCount &&
          cyclesForCurrentGroup < maxCyclesPerGroup &&
          !shouldStop.value
        ) {
          cycle += 1;
          cyclesForCurrentGroup += 1;
          const roleInfo = await fetchRoleInfo(tokenId);
          const inventory = getSmartBoxInventory(roleInfo);
          const selectedPoints = getSmartBoxPoints(inventory, selectedTypes);

          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 第${completedGroups + 1}组第${cycle}轮：选中宝箱积分${selectedPoints}`,
            type: "info",
          });

          if (!currentGroupStarted) {
            if (selectedPoints < 4000) {
              addLog({
                time: new Date().toLocaleTimeString(),
                message: `${token.name} 第${completedGroups + 1}组起始宝箱积分${selectedPoints}不足4000，跳过本组任务`,
                type: "warning",
              });
              break;
            }

            currentGroupStarted = true;
            accumulatedPoints = 0;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${completedGroups + 1}组起始积分${selectedPoints}，开始累计开箱至8000分`,
              type: "info",
            });
          }

          const remainingPoints = 8000 - accumulatedPoints;
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
            message: `${token.name} 第${completedGroups + 1}组本轮开箱${plan.points}分，累计${accumulatedPoints + plan.points}/8000分`,
            type: "info",
          });
          const openedPoints = await openSmartBoxes(
            tokenId,
            token,
            plan.boxes,
            "累计开箱",
          );
          if (openedPoints <= 0) break;

          accumulatedPoints += openedPoints;
          await claimPointsAndMail(tokenId, token);

          const refreshedInventory = getSmartBoxInventory(
            await fetchRoleInfo(tokenId),
          );
          const afterInventory = JSON.stringify(
            selectedTypes.map((id) => refreshedInventory[id] || 0),
          );

          if (accumulatedPoints >= 8000) {
            completedGroups += 1;
            currentGroupStarted = false;
            cyclesForCurrentGroup = 0;
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 第${completedGroups}组完成，累计开箱${accumulatedPoints}分`,
              type: "success",
            });
            continue;
          }

          if (beforeInventory === afterInventory) {
            addLog({
              time: new Date().toLocaleTimeString(),
              message: `${token.name} 领取积分和邮件后库存没有增加，停止任务避免重复执行`,
              type: "warning",
            });
            break;
          }
        }

        if (
          completedGroups < groupCount &&
          cyclesForCurrentGroup >= maxCyclesPerGroup
        ) {
          addLog({
            time: new Date().toLocaleTimeString(),
            message: `${token.name} 累计开箱达到${maxCyclesPerGroup}轮仍未凑够8000分，停止任务`,
            type: "warning",
          });
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
    batchFish,
    batchRecruit,
    batchHeroUpgrade,
    batchHeroLevelUpgrade,
    batchBookUpgrade,
    batchClaimStarRewards,
    batchClaimPeachTasks,
    batchGenieSweep,
  };
}
