/** 抓包：PetService.useEXPItem，消耗15001；响应pets仅含槽位增量。 */
export function getPetUpgradeTargets(role) {
  return Object.entries(role?.petData?.pets || {}).flatMap(([key, pet]) => {
    const slot = Number(pet?.slot ?? key);
    const uId = pet?.uId;
    if (!Number.isInteger(slot) || slot < -1 || typeof uId !== "string" || !uId) return [];
    return [{ slot, uId, level: Number(pet.level) || 0 }];
  }).sort((a, b) => a.slot - b.slot || a.uId.localeCompare(b.uId));
}

export function getEquippedPetUpgradeTarget(role) {
  const equippedId = role?.pet?.petUId ?? role?.pet?.uId;
  if (!equippedId) return [];
  return getPetUpgradeTargets(role)
    .filter((pet) => pet.uId === equippedId)
    .sort((a, b) => b.level - a.level || a.slot - b.slot)
    .slice(0, 1);
}

// 当前抓包明确出现的阶段ID；不猜测未提供的奖励阶段和领取门槛。
export const CAPTURED_GACHA_REWARD_STAGES = [1, 2, 4];

export function createPetTasks(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
    currentRunningTokenId, ensureConnection, releaseConnectionSlot,
    tokenStore, addLog, message, delayConfig } = deps;
  const runPetTask = async (claimRewards = false) => {
    if (!selectedTokens.value.length) return;
    isRunning.value = true;
    shouldStop.value = false;
    const ids = [...selectedTokens.value];
    ids.forEach((id) => { tokenStatus.value[id] = "waiting"; });
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find((t) => t.id === id)?.name || id;
        const log = (text, type = "info") => addLog({ time: new Date().toLocaleTimeString(), message: `${name} ${text}`, type });
        let connected = false;
        try {
          tokenStatus.value[id] = "running";
          currentRunningTokenId.value = id;
          await ensureConnection(id);
          connected = true;
          if (claimRewards) {
            const info = await tokenStore.sendMessageWithPromise(id, "gacha_getinfo", {}, 15000);
            if (!info?.roleGacha) throw new Error("未获取到扭蛋奖励状态");
            const claimed = { ...info.roleGacha.claimedStageIdMap };
            let failures = 0;
            for (const stageId of CAPTURED_GACHA_REWARD_STAGES) {
              if (shouldStop.value) break;
              if (claimed[stageId]) continue;
              try {
                const response = await tokenStore.sendMessageWithPromise(id, "gacha_claimstagereward", { stageId }, 15000);
                Object.assign(claimed, response?.roleGacha?.claimedStageIdMap);
                if (!claimed[stageId]) throw new Error("响应未确认领取成功");
                log(`扭蛋阶段${stageId}奖励领取成功`, "success");
              } catch (error) {
                failures++;
                log(`扭蛋阶段${stageId}未领取：${error.message}`, "warning");
              }
              await new Promise((resolve) => setTimeout(resolve, Math.max(500, Number(delayConfig?.command) || 0)));
            }
            tokenStatus.value[id] = shouldStop.value ? "stopped" : failures ? "failed" : "completed";
            continue;
          }
          let role = (await tokenStore.sendGetRoleInfo(id))?.role;
          const targets = getEquippedPetUpgradeTarget(role);
          if (!targets.length) log("没有可确认的当前佩戴宠物，或槽位/唯一编号不完整，跳过", "warning");
          const target = targets[0];
          while (target && !shouldStop.value) {
            const current = getEquippedPetUpgradeTarget(role).find((p) => p.uId === target.uId);
            if (!current) { log(`宠物${target.uId}已不再佩戴或身份无法确认，停止升级`, "warning"); break; }
            const quantity = Number(role?.items?.[15001]?.quantity);
            const exp = Number(role?.petData?.pets?.[current.slot]?.exp ?? 0);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              log("宠物经验道具不足或数量无法确认，结束升级", "warning");
              break;
            }
            await tokenStore.sendMessageWithPromise(id, "pet_useexpitem", {
              slotUId: { slot: current.slot, uId: current.uId }, isOneClick: true,
            }, 15000);
            // 抓包响应是槽位增量，查询完整状态确认升级并核对剩余道具。
            role = (await tokenStore.sendGetRoleInfo(id))?.role;
            const after = getPetUpgradeTargets(role).find((p) => p.uId === current.uId);
            if (!after) throw new Error("升级后无法确认宠物状态，停止继续消耗");
            const afterQuantity = Number(role?.items?.[15001]?.quantity);
            const afterExp = Number(role?.petData?.pets?.[after.slot]?.exp ?? 0);
            log(`宠物${current.uId}一键升级：${current.level}级 → ${after.level}级，剩余经验道具${Number.isFinite(afterQuantity) ? afterQuantity : "未知"}`);
            if (after.level === current.level && afterExp === exp && afterQuantity === quantity) {
              log("宠物等级、经验和道具均未变化，已无法继续升级，结束任务");
              break;
            }
            if (after.level < current.level || !Number.isFinite(afterQuantity) || afterQuantity >= quantity) {
              log("升级后资源或进度无法确认，停止继续消耗", "warning");
              break;
            }
            if (afterQuantity <= 0 || shouldStop.value) break;
            await new Promise((resolve) => setTimeout(resolve, Math.max(500, Number(delayConfig?.command) || 0)));
          }
          tokenStatus.value[id] = shouldStop.value ? "stopped" : "completed";
        } catch (error) {
          tokenStatus.value[id] = "failed";
          log(`${claimRewards ? "扭蛋领奖" : "宠物升级"}失败：${error.message}，未自动重试`, "error");
        } finally {
          if (connected) {
            try { tokenStore.closeWebSocketConnection(id); }
            finally { releaseConnectionSlot(); }
          }
        }
      }
    } finally {
      ids.forEach((id) => { if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "stopped"; });
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    message.info(`${claimRewards ? "扭蛋领奖" : "宠物升级"}任务结束，请查看各账号日志`);
  };
  return { batchUpgradeAllPets: () => runPetTask(false), batchClaimGachaRewards: () => runPetTask(true) };
}
