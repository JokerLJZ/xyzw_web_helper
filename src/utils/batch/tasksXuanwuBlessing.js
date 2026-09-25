/**
 * 玄武赐福（通行证活动）批量任务
 * 顺序执行：任务领取 -> 通行证奖励 -> 免费珍宝 -> 点卯 -> 抽奖 -> 累抽奖励 -> 抽奖后二次领取
 * 抽奖会推进任务进度（如"抽奖X次"类任务），故抽奖后需重新拉取并再领一轮
 */

import { getXuanwuActBase } from "@/utils/towerActId";
import { getNextUnclaimedLotteryCumulativeId } from "@/utils/xuanwuLotteryRewards";
import {
  getXuanwuPetCookieExchangeIds,
  getXuanwuPetCookieExchangeQuantity,
} from "@/utils/xuanwuPetCookieExchange";

// 活动ID后缀（前缀为当天日期 YYMMDD）
const WAR_ORDER_SUFFIX = "1";
const SIGN_SUFFIX = "5";
const GOODS_SUFFIX = "41";

// 防止异常响应导致无限抽奖；正常情况会在玄武灵契耗尽时由服务器终止。
const MAX_DRAW_TIMES = 20;
const MAX_RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_RETRY_DELAY_MS = 6000;

// 通行证奖励领取最大轮数
const MAX_REWARD_ROUNDS = 10;

// 寻宝累抽奖励档位通常少于此数；循环到服务器提示无奖励即停止。
const MAX_LOTTERY_REWARD_ROUNDS = 20;

// 点卯补领天数（patchDay 0-6）
const SIGN_MAX_DAY = 6;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatReward = (reward = []) =>
  reward
    .map((r) => {
      if (r.type === 2) return `金砖x${r.value}`;
      if (r.type === 3) return `道具${r.itemId}x${r.value}`;
      return `类型${r.type}x${r.value}`;
    })
    .join(", ");

/**
 * 创建玄武赐福批量任务执行器
 * @param {Object} deps - 依赖项
 * @returns {Object} 任务函数集合
 */
export function createTasksXuanwuBlessing(deps) {
  const {
    selectedTokens,
    tokens,
    tokenStatus,
    isRunning,
    shouldStop,
    ensureConnection,
    releaseConnectionSlot,
    tokenStore,
    addLog,
    message,
    currentRunningTokenId,
    delayConfig,
  } = deps;

  const commandDelay = delayConfig?.command || delayConfig?.action || 300;

  const log = (msg, type = "info") =>
    addLog({ time: new Date().toLocaleTimeString(), message: msg, type });

  /** 拉取通行证活动信息 */
  const fetchWarOrder = async (tokenId, actId) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_warorderget",
        { actId },
        8000,
      );
      return res?.activity?.warOrderActivityInfo?.[actId] || null;
    } catch {
      return null;
    }
  };

  /** 解析当前活动ID：先用日期推导，取不到再逐天回退探测 */
  const resolveWarOrder = async (tokenId) => {
    const candidates = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      candidates.push(Number(getXuanwuActBase(date) + WAR_ORDER_SUFFIX));
    }

    for (const actId of candidates) {
      const info = await fetchWarOrder(tokenId, actId);
      if (info) return { actId, info };
    }

    return null;
  };

  /** 领取通行证任务（每日/每周/本期），返回领取/跳过数 */
  const claimTasks = async (tokenId, actId, info, tokenName) => {
    const complete = info?.complete || {};
    const claimedMap = info?.taskClaimed || {};
    let claimed = 0;
    let skipped = 0;

    for (const [missionIdStr, progress] of Object.entries(complete)) {
      if (shouldStop.value) break;
      if (claimedMap[missionIdStr] === true) continue;
      if (!(progress > 0)) continue;

      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_warordertaskclaim",
          { actId, missionId: Number(missionIdStr) },
          8000,
        );
        const latest = res?.activity?.warOrderActivityInfo?.[actId]?.taskClaimed;
        if (latest) Object.assign(claimedMap, latest);

        if (res?.reward?.length) {
          log(`${tokenName} 任务${missionIdStr}领取: ${formatReward(res.reward)}`, "success");
          claimed++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
      await delay(commandDelay);
    }

    if (claimed > 0 || skipped > 0) {
      log(
        `${tokenName} 通行证任务: 领取 ${claimed}, 跳过 ${skipped}`,
        claimed > 0 ? "success" : "info",
      );
    }
    return { claimed, skipped };
  };

  /** 通行证奖励领取（可能产出抽奖券），返回领取轮数 */
  const claimPassRewards = async (tokenId, actId, tokenName) => {
    let rounds = 0;
    for (let round = 0; round < MAX_REWARD_ROUNDS; round++) {
      if (shouldStop.value) break;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_warorderrewardclaim",
          { actId },
          8000,
        );
        if (!res?.reward?.length) break;
        log(`${tokenName} 通行证奖励领取: ${formatReward(res.reward)}`, "success");
        rounds++;
      } catch {
        // 已无可领取奖励
        break;
      }
      await delay(commandDelay);
    }
    if (rounds > 0) {
      log(`${tokenName} 通行证奖励: 领取 ${rounds} 次`, "success");
    }
    return rounds;
  };

  /** 免费珍宝购买（产出抽奖券） */
  const buyFreeGoods = async (tokenId, goodsId, tokenName) => {
    try {
      const res = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_commonbuygoods",
        { goodsId },
        8000,
      );
      log(
        `${tokenName} 免费珍宝购买成功${res?.reward?.length ? `: ${formatReward(res.reward)}` : ""}`,
        "success",
      );
      return true;
    } catch {
      log(`${tokenName} 免费珍宝今日已购买或不可购买`);
      return false;
    }
  };

  /** 抽奖（会推进抽奖类任务进度） */
  const doLottery = async (
    tokenId,
    tokenName,
    maxDrawTimes = MAX_DRAW_TIMES,
  ) => {
    try {
      const lotteryInfo = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_getlotteryinfo",
        {},
        8000,
      );
      log(`${tokenName} 抽奖信息: ${JSON.stringify(lotteryInfo?.lotteryInfo || {})}`);
    } catch {
      // 抽奖信息获取失败不影响抽奖
    }

    let count = 0;
    for (let i = 0; i < maxDrawTimes; i++) {
      if (shouldStop.value) break;
      let drawn = false;
      for (
        let attempt = 0;
        attempt <= MAX_RATE_LIMIT_RETRIES;
        attempt += 1
      ) {
        try {
          const res = await tokenStore.sendMessageWithPromise(
            tokenId,
            "activity_lottery",
            { times: 1 },
            8000,
          );
          log(
            `${tokenName} 抽奖第${count + 1}次: ${formatReward(res?.reward || []) || "无奖励"}`,
            "success",
          );
          count++;
          drawn = true;
          break;
        } catch (error) {
          const errorMessage = error?.message || "未知错误";
          const rateLimited =
            errorMessage.includes("200400") ||
            errorMessage.includes("操作太快");
          if (rateLimited && attempt < MAX_RATE_LIMIT_RETRIES) {
            log(
              `${tokenName} 玄武抽奖触发200400，等待6秒后进行第${attempt + 1}次重试`,
              "warning",
            );
            await delay(RATE_LIMIT_RETRY_DELAY_MS);
            continue;
          }
          log(
            count > 0
              ? `${tokenName} 玄武灵契已抽完，本轮共抽奖${count}次`
              : `${tokenName} 当前没有可用玄武灵契`,
            "info",
          );
          return count;
        }
      }
      if (!drawn) break;
      await delay(commandDelay);
    }
    if (count >= maxDrawTimes) {
      log(`${tokenName} 抽奖达到本次剩余安全额度${maxDrawTimes}次`, "warning");
    }
    return count;
  };

  /** 查询累计抽奖状态后，一次性领完已达成且尚未领取的奖励档位。 */
  const claimLotteryRewards = async (tokenId, tokenName) => {
    let lotteryInfo;
    try {
      const infoRes = await tokenStore.sendMessageWithPromise(
        tokenId,
        "activity_getlotteryinfo",
        {},
        8000,
      );
      lotteryInfo = infoRes?.lotteryInfo || {};
    } catch (error) {
      log(
        `${tokenName} 查询寻宝累抽奖励失败: ${error?.message || "未知错误"}`,
        "warning",
      );
      return 0;
    }

    const claimedMap = { ...(lotteryInfo?.cumulativeClaimedMap || {}) };
    let nextId = getNextUnclaimedLotteryCumulativeId(
      { cumulativeClaimedMap: claimedMap },
      MAX_LOTTERY_REWARD_ROUNDS,
    );
    if (nextId === null) {
      log(`${tokenName} 当前没有可领取的寻宝累抽奖励`);
      return 0;
    }

    log(
      `${tokenName} 累计抽奖${Number(lotteryInfo.lotteryNum) || 0}次，下一个未领取档位：${nextId}`,
    );

    let claimed = 0;
    while (nextId !== null && claimed < MAX_LOTTERY_REWARD_ROUNDS) {
      if (shouldStop.value) break;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_claimlotterycumulative",
          { id: nextId },
          8000,
        );
        if (!res?.reward?.length) {
          log(`${tokenName} 寻宝累抽奖励档位${nextId}未返回奖励，已停止`, "warning");
          break;
        }
        claimed++;
        log(
          `${tokenName} 寻宝累抽奖励档位${nextId}: ${formatReward(res.reward)}`,
          "success",
        );
        Object.assign(
          claimedMap,
          res?.lotteryInfo?.cumulativeClaimedMap || { [nextId]: true },
        );
        nextId = getNextUnclaimedLotteryCumulativeId(
          { cumulativeClaimedMap: claimedMap },
          MAX_LOTTERY_REWARD_ROUNDS,
        );
      } catch (error) {
        log(
          `${tokenName} 寻宝累抽奖励档位${nextId}尚未达到领取条件或领取失败，已停止: ${error?.message || "未知错误"}`,
          "info",
        );
        break;
      }
      await delay(commandDelay);
    }
    if (claimed > 0) {
      log(`${tokenName} 寻宝累抽奖励已一次性领取${claimed}档`, "success");
    }
    return claimed;
  };

  /** 玄武点卯（patchDay 0-6 补领） */
  const claimSign = async (tokenId, signActivityId, tokenName) => {
    let claimed = 0;
    let skipped = 0;
    for (let patchDay = 0; patchDay <= SIGN_MAX_DAY; patchDay++) {
      if (shouldStop.value) break;
      try {
        const res = await tokenStore.sendMessageWithPromise(
          tokenId,
          "activity_claimsignreward",
          { activityId: signActivityId, patchDay },
          8000,
        );
        if (res?.reward?.length) {
          log(
            `${tokenName} 点卯第${patchDay + 1}天领取: ${formatReward(res.reward)}`,
            "success",
          );
          claimed++;
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
      await delay(commandDelay);
    }
    log(
      `${tokenName} 玄武点卯: 领取 ${claimed} 天, 跳过 ${skipped} 天`,
      claimed > 0 ? "success" : "info",
    );
    return claimed;
  };

  /** 批量执行玄武赐福 */
  const batchXuanwuBlessing = async () => {
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
        log(`=== 开始玄武赐福: ${token.name} ===`);
        await ensureConnection(tokenId);
        if (shouldStop.value) return;

        const resolved = await resolveWarOrder(tokenId);
        if (!resolved) {
          throw new Error("未找到玄武赐福活动，请确认活动是否开启");
        }
        const { actId, info } = resolved;
        const base = String(actId).slice(0, 6);
        const signActivityId = Number(base + SIGN_SUFFIX);
        const goodsId = Number(base + GOODS_SUFFIX);

        // 1. 先领一轮任务 + 通行证奖励，同时攒抽奖券
        const first = await claimTasks(tokenId, actId, info, token.name);
        let passRewards = await claimPassRewards(tokenId, actId, token.name);

        // 2. 免费珍宝购买（产出抽奖券）
        await buyFreeGoods(tokenId, goodsId, token.name);
        await delay(commandDelay);

        // 3. 点卯补领（同样可能推进任务进度）
        const signCnt = await claimSign(tokenId, signActivityId, token.name);

        // 4. 抽完全部玄武灵契；领奖若再次产出灵契，则继续抽取并再次领奖。
        let lotteryCnt = 0;
        let lotteryRewards = 0;
        let secondClaimed = 0;
        for (let round = 0; round < MAX_REWARD_ROUNDS; round++) {
          const remainingDrawTimes = MAX_DRAW_TIMES - lotteryCnt;
          if (remainingDrawTimes <= 0) {
            log(
              `${token.name} 本次抽奖已达到安全上限${MAX_DRAW_TIMES}次，停止继续抽奖`,
              "warning",
            );
            break;
          }
          const drawn = await doLottery(
            tokenId,
            token.name,
            remainingDrawTimes,
          );
          lotteryCnt += drawn;
          const claimedLotteryRewards = await claimLotteryRewards(
            tokenId,
            token.name,
          );
          lotteryRewards += claimedLotteryRewards;
          const latestInfo = await fetchWarOrder(tokenId, actId);
          if (!latestInfo) break;
          const second = await claimTasks(tokenId, actId, latestInfo, token.name);
          secondClaimed += second.claimed;
          const newPassRewards =
            second.claimed > 0
              ? await claimPassRewards(tokenId, actId, token.name)
              : 0;
          passRewards += newPassRewards;
          if (
            drawn === 0
            && claimedLotteryRewards === 0
            && second.claimed === 0
            && newPassRewards === 0
          ) break;
        }

        // 即使本轮没有抽奖，也补领此前已达到但遗漏的累抽奖励。
        lotteryRewards += await claimLotteryRewards(
          tokenId,
          token.name,
        );

        log(
          `${token.name} 玄武赐福完成: 任务${first.claimed + secondClaimed}, 通行证奖励${passRewards}, 点卯${signCnt}, 抽奖${lotteryCnt}, 累抽奖励${lotteryRewards}档`,
          "success",
        );

        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        console.error(error);
        tokenStatus.value[tokenId] = "failed";
        log(`${token.name} 玄武赐福失败: ${error.message || "未知错误"}`, "error");
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        log(`${token.name} 连接已关闭`);
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("批量玄武赐福结束");
  };

  /** 小号任务：只查询一次库存，用全部可兑换道具换取宠物饼干。 */
  const batchExchangeXuanwuPetCookies = async () => {
    if (selectedTokens.value.length === 0) return;
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
        log(`=== 开始玄武活动兑换宠物饼干: ${tokenName} ===`);
        await ensureConnection(tokenId);
        if (shouldStop.value) return;

        const resolved = await resolveWarOrder(tokenId);
        if (!resolved) {
          throw new Error("未找到玄武赐福活动，请确认活动是否开启");
        }

        const roleInfo = await tokenStore.sendGetRoleInfo(tokenId);
        const exchange = getXuanwuPetCookieExchangeQuantity(roleInfo);
        if (exchange.exchangeQuantity <= 0) {
          log(
            `${tokenName} 玄武活动道具${exchange.itemId}现有${exchange.itemQuantity}个，不足${exchange.unitCost}个，跳过兑换`,
          );
          tokenStatus.value[tokenId] = "completed";
          return;
        }

        const activityBase = String(resolved.actId).slice(0, 6);
        const { activityId, goodsId } =
          getXuanwuPetCookieExchangeIds(activityBase);

        const exchangeWithRateLimitRetry = async (goodsId, quantity, name) => {
          for (let attempt = 0; ; attempt++) {
            try {
              return await tokenStore.sendMessageWithPromise(
                tokenId,
                "activity_exchange",
                { activityId, goodsId, quantity },
                8000,
              );
            } catch (error) {
              const errorMessage = String(error?.message || error || "");
              const rateLimited =
                errorMessage.includes("200400") ||
                errorMessage.includes("操作太快");
              if (!rateLimited || attempt >= MAX_RATE_LIMIT_RETRIES) {
                throw error;
              }
              log(
                `${tokenName} 兑换${name}触发200400，等待6秒后进行第${attempt + 1}次重试`,
                "warning",
              );
              await delay(RATE_LIMIT_RETRY_DELAY_MS);
            }
          }
        };

        log(
          `${tokenName} 玄武活动道具${exchange.itemId}现有${exchange.itemQuantity}个，计划兑换宠物饼干${exchange.exchangeQuantity}份，预计剩余${exchange.itemQuantity - exchange.exchangeQuantity * exchange.unitCost}个`,
        );
        const cookieResult = await exchangeWithRateLimitRetry(
          goodsId,
          exchange.exchangeQuantity,
          "宠物饼干",
        );
        log(
          `${tokenName} 宠物饼干兑换${exchange.exchangeQuantity}份成功${cookieResult?.reward?.length ? `：${formatReward(cookieResult.reward)}` : ""}`,
          "success",
        );
        tokenStatus.value[tokenId] = "completed";
      } catch (error) {
        tokenStatus.value[tokenId] = "failed";
        log(
          `${tokenName} 玄武活动兑换宠物饼干失败: ${error?.message || "未知错误"}`,
          "error",
        );
      } finally {
        tokenStore.closeWebSocketConnection(tokenId);
        releaseConnectionSlot();
        log(`${tokenName} 连接已关闭`);
      }
    });

    await Promise.all(taskPromises);
    isRunning.value = false;
    currentRunningTokenId.value = null;
    message.success("玄武活动兑换宠物饼干任务结束");
  };

  return {
    batchXuanwuBlessing,
    batchExchangeXuanwuPetCookies,
  };
}
