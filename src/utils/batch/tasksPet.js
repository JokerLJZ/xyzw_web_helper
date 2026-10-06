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
          for (const target of targets) {
            if (shouldStop.value) break;
            const current = getPetUpgradeTargets(role).find((p) => p.uId === target.uId);
            if (!current) { log(`宠物${target.uId}已不在有效槽位，跳过`, "warning"); continue; }
            const quantity = Number(role?.items?.[15001]?.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              log("宠物经验道具不足或数量无法确认，结束升级", "warning");
              break;
            }
            await tokenStore.sendMessageWithPromise(id, "pet_useexpitem", {
              slotUId: { slot: current.slot, uId: current.uId }, isOneClick: true,
            }, 15000);
            // 响应只有pets[slot]的等级/经验增量，重新查询以保留身份和核对资源。
            role = (await tokenStore.sendGetRoleInfo(id))?.role;
            const after = getPetUpgradeTargets(role).find((p) => p.uId === current.uId);
            log(`宠物${current.uId}一键升级请求成功：${current.level}级 → ${after ? `${after.level}级` : "等级待确认"}`);
            await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(delayConfig?.command) || 0)));
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
