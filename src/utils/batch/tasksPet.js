import { runPetMerge } from "../petMerge.js";
import { getClaimableGachaStages, gachaBody } from "../gachaRewards.js";
import { activatePetBooks, equipHighestLevelPet } from "../petManagement.js";
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

export function createPetTasks(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
    currentRunningTokenId, ensureConnection, releaseConnectionSlot,
    tokenStore, addLog, message, delayConfig } = deps;
  const runPetTask = async (claimRewards = false, mergePets = false, management = "") => {
    const taskLabel = management === "book" ? "宠物图鉴激活领奖" : management === "equip" ? "佩戴最高等级宠物" : mergePets ? "宠物合成" : claimRewards ? "扭蛋领奖" : "宠物升级";
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
          if (management) {
            const options = {
              getRole: async () => (await tokenStore.sendGetRoleInfo(id))?.role,
              send: (cmd, params) => tokenStore.sendMessageWithPromise(id, cmd, params, 15000),
              shouldStop: () => shouldStop.value,
              wait: ms => new Promise(resolve => setTimeout(resolve, Math.max(ms, Number(delayConfig?.command) || 0))),
            };
            if (management === "book") {
              const result = await activatePetBooks({ ...options, onResult: ({ petId, action }) => log(`宠物${petId}图鉴${action === "activate" ? "激活" : "领奖"}成功`, "success") });
              log(`宠物图鉴任务结束：激活${result.activated}项、领取${result.claimed}项奖励`);
            } else {
              const result = await equipHighestLevelPet(options);
              log(result.changed ? `已佩戴最高等级宠物${result.target.uId}（${result.target.level}级）` : result.reason === "equipped" ? "最高等级宠物已经佩戴，跳过" : "没有可佩戴宠物或任务已停止，跳过", result.changed ? "success" : "info");
            }
            tokenStatus.value[id] = shouldStop.value ? "stopped" : "completed";
            continue;
          }
          if (claimRewards) {
            const info = gachaBody(await tokenStore.sendMessageWithPromise(id, "gacha_getinfo", {}, 15000));
            const stages = getClaimableGachaStages(info?.roleGacha);
            const state = { ...info.roleGacha, claimedStageIdMap: { ...info.roleGacha.claimedStageIdMap } };
            if (!stages.length) log(`本轮扭蛋${state.stageGachaCnt}次，没有可领取的累计奖励`);
            let failures = 0;
            for (const { id: stageId, num } of stages) {
              if (shouldStop.value) break;
              if (!getClaimableGachaStages(state).some(s => s.id === stageId)) continue;
              try {
                const response = gachaBody(await tokenStore.sendMessageWithPromise(id, "gacha_claimstagereward", { stageId }, 15000));
                if (response?.roleGacha?.claimedStageIdMap?.[stageId] !== true) throw new Error("响应未确认领取成功");
                Object.assign(state, response.roleGacha, { claimedStageIdMap: { ...state.claimedStageIdMap, ...response.roleGacha.claimedStageIdMap } });
                log(`扭蛋阶段${stageId}（${num}次）奖励领取成功`, "success");
              } catch (error) {
                failures++;
                log(`扭蛋阶段${stageId}未领取：${error.message}`, "warning");
              }
              await new Promise((resolve) => setTimeout(resolve, Math.max(500, Number(delayConfig?.command) || 0)));
            }
            tokenStatus.value[id] = shouldStop.value ? "stopped" : failures ? "failed" : "completed";
            continue;
          }
          if (mergePets) {
            const result = await runPetMerge({
              maxColor: deps.batchSettings?.petMergeMaxColor ?? 4,
              shouldStop: () => shouldStop.value,
              getRole: async () => (await tokenStore.sendGetRoleInfo(id))?.role,
              send: params => tokenStore.sendMessageWithPromise(id, "pet_merge", params, 15000),
              openEgg: params => tokenStore.sendMessageWithPromise(id, "pet_openegg", params, 15000),
              wait: ms => new Promise(resolve => setTimeout(resolve, Math.max(ms, Number(delayConfig?.command) || 0))),
              onResult: ({ count, isSuccess, openedEgg, eggsOpened }) => openedEgg
                ? log(`已使用${eggsOpened}个白、绿、蓝宠物蛋，已刷新宠物列表`)
                : log(`第${count}次宠物合成${isSuccess ? "成功" : "失败"}，已刷新宠物列表`, isSuccess ? "success" : "warning"),
            });
            log(`宠物合成结束，本次开蛋${result.eggsOpened}个、合成${result.count}次；跳过佩戴、锁定和范围外宠物`);
            if (result.blockedByCapacity && !result.stopped) log("仍有宠物蛋，但无可继续合成的宠物或空槽，已停止；不会购买槽位", "warning");
            tokenStatus.value[id] = shouldStop.value ? "stopped" : "completed";
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
          log(`${taskLabel}失败：${error.message}，未自动重试`, "error");
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
    message.info(`${taskLabel}任务结束，请查看各账号日志`);
  };
  return { batchUpgradeAllPets: () => runPetTask(false), batchClaimGachaRewards: () => runPetTask(true), batchMergePets: () => runPetTask(false, true), batchActivatePetBooks: () => runPetTask(false, false, "book"), batchEquipHighestLevelPet: () => runPetTask(false, false, "equip") };
}
