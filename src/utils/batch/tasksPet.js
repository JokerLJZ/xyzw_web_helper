/** 抓包：PetService.useEXPItem，消耗15001；响应pets仅含槽位增量。 */
export function getPetUpgradeTargets(role) {
  return Object.entries(role?.petData?.pets || {}).flatMap(([key, pet]) => {
    const slot = Number(pet?.slot ?? key);
    const uId = pet?.uId;
    if (!Number.isInteger(slot) || slot < -1 || typeof uId !== "string" || !uId) return [];
    return [{ slot, uId, level: Number(pet.level) || 0 }];
  }).sort((a, b) => a.slot - b.slot || a.uId.localeCompare(b.uId));
}

export function createPetTasks(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
    currentRunningTokenId, ensureConnection, releaseConnectionSlot,
    tokenStore, addLog, message, delayConfig } = deps;
  const batchUpgradeAllPets = async () => {
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
          let role = (await tokenStore.sendGetRoleInfo(id))?.role;
          const targets = getPetUpgradeTargets(role);
          if (!targets.length) log("没有可升级宠物，或宠物槽位/唯一编号不完整，跳过", "warning");
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
          log(`宠物升级失败：${error.message}，未自动重试`, "error");
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
    message.info("宠物升级任务结束，请查看各账号日志");
  };
  return { batchUpgradeAllPets };
}
