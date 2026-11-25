import { normalizeAltRefinePolicy, matchesAltRefinePolicy, hasAltRefineRequiredAttribute, ALT_REFINE_ATTRIBUTES, ALT_REFINE_COLORS } from "../altRefinePolicy.js";
import { loadSignupCheerConfig } from "./tasksSignupCheer.js";
import { DEFAULT_ALT_REFINE_LIMIT, hasAltRefineTarget, hasAltRefineDamageReduction, runAltAccountRefine } from "../altAccountRefine.js";
import { extractRolePatch } from "../roleSnapshot.js";
import { HERO_DICT } from "../HeroList.js";

const partNames = { 1: "武器", 2: "铠甲", 3: "头冠", 4: "坐骑" };

export function createTasksRefine(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
    currentRunningTokenId, ensureConnection, releaseConnectionSlot,
    tokenStore, addLog, message, batchSettings } = deps;

  const batchAltAccountRefine = async () => {
    const ids = [...selectedTokens.value];
    if (!ids.length) return;
    // 本轮使用配置快照，每个账号独立计数。
    const heroId = Number(batchSettings.altRefineHeroId ?? 107);
    const limit = batchSettings.altRefineLimit ?? DEFAULT_ALT_REFINE_LIMIT;
    if (!Number.isSafeInteger(heroId) || !HERO_DICT[heroId]) {
      message.warning("请在全局任务设置中选择洗练武将");
      return;
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      message.warning("白玉使用次数上限必须为正整数");
      return;
    }
    let policy;
    try { policy = normalizeAltRefinePolicy(batchSettings); }
    catch (error) { message.warning(error.message); return; }
    const targetMatches = policy ? equip => matchesAltRefinePolicy(equip, policy) : hasAltRefineTarget;
    isRunning.value = true;
    shouldStop.value = false;
    ids.forEach(id => { tokenStatus.value[id] = "waiting"; });
    let failures = 0;
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(t => t.id === id)?.name || id;
        const log = (text, type = "info") => addLog({
          time: new Date().toLocaleTimeString(), message: `${name} ${text}`, type,
        });
        let connected = false;
        let count = 0;
        try {
          currentRunningTokenId.value = id;
          tokenStatus.value[id] = "running";
          await ensureConnection(id);
          connected = true;
          if (shouldStop.value) { tokenStatus.value[id] = "stopped"; break; }
          const info = await tokenStore.sendGetRoleInfo(id);
          if (shouldStop.value) { tokenStatus.value[id] = "stopped"; break; }
          const role = extractRolePatch(info) ?? info;
          if (!role?.heroes?.[heroId]) throw new Error(`账号未拥有配置武将${HERO_DICT[heroId].name}`);
          const equipment = { ...role?.heroes?.[heroId]?.equipment };
          const config = await (deps.loadRefineConfig || loadSignupCheerConfig)((cmd, params) => tokenStore.sendMessageWithPromise(id, cmd, params, 15000));
          if (shouldStop.value) { tokenStatus.value[id] = "stopped"; break; }
          if (policy && policy.attrs.some(attr => !config?.QuenchAttrConf?.[attr])) throw new Error("官方配置不支持所选洗练属性，停止执行");
          if (policy) log(`目标：${policy.attrs.map(id => ALT_REFINE_ATTRIBUTES.find(a => a.value === id).label).join("、")}，最低${ALT_REFINE_COLORS.find(c => c.value === policy.color).label}色${policy.countEnabled ? `；至少${policy.count}件装备具有${ALT_REFINE_ATTRIBUTES.find(a => a.value === policy.attr).label}` : ""}；仅使用白玉、不锁孔`);
          const quenchCost = config?.ConstantConf?.quenchCostNum;
          if (config?.ConstantConf?.quenchCostId !== 1022) throw new Error("洗练消耗道具配置异常");
          const jadeQuantity = role.items?.[1022]?.quantity ?? (role.items && !Object.hasOwn(role.items, 1022) ? 0 : undefined);
          const plannedLimit = Math.min(limit, Math.floor(jadeQuantity / quenchCost));
          log(`白玉${jadeQuantity}，单次消耗${quenchCost}，计划最多洗练${plannedLimit}次`);
          log(`开始${HERO_DICT[heroId].name}小号自动洗练，本账号本次上限${limit}次`);
          for (const [part, equip] of Object.entries(equipment)) {
            if (targetMatches(equip)) log(`${partNames[part] || part}已有目标属性${policy ? "（基础条件已满足，数量要求另行检查）" : "，跳过"}`);
          }
          const result = await runAltAccountRefine({
            heroId, equipment, policy, jadeQuantity, quenchCost, limit, shouldStop: () => shouldStop.value,
            send: async (cmd, params) => {
              if (tokenStore.getWebSocketStatus(id) !== "connected") throw new Error("连接已断开");
              try {
                return await tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
              } catch (error) {
                const action = cmd === "equipment_confirm" ? "确认洗练" : "洗练";
                throw new Error(`${partNames[params.part]}${action}请求(${cmd})失败：${error.message}`);
              }
            },
            onUpdate: update => {
              count = update.count;
              if ((update.requiredAttributeStage ? equip => hasAltRefineRequiredAttribute(equip, policy) : update.damageReductionStage ? hasAltRefineDamageReduction : targetMatches)(update.equipment)) {
                log(`${partNames[update.part]}已命中目标属性，本次累计${count}次`, "success");
              } else if (count % 100 === 0) {
                log(`正在${update.requiredAttributeStage ? "补指定属性装备数，洗练" : update.damageReductionStage ? "补减伤，洗练" : "洗练"}${partNames[update.part]}，本次累计${count}/${limit}次`);
              }
            },
            wait: () => new Promise(resolve => setTimeout(resolve,
              Math.max(350, Number(batchSettings.commandDelay) || 0))),
          });
          if (result.reason === "stopped") {
            tokenStatus.value[id] = "stopped";
            log(`小号洗练已停止，本次${result.count}次`, "warning");
          } else if (result.reason === "jade") {
            tokenStatus.value[id] = "completed";
            log(`白玉不足或已达白玉预算，本次计划最多${plannedLimit}次；已确认洗练${result.count}次，未完成洗练目标`, "warning");
          } else if (result.reason === "limit") {
            tokenStatus.value[id] = "completed";
            log(`已达本次白玉洗练上限${limit}次，达标${result.completedParts.length}/4件，未完成的装备或附加属性要求未继续洗练`, "warning");
          } else {
            tokenStatus.value[id] = "completed";
            log(`四件装备均已达标${policy?.countEnabled ? `，指定属性装备${result.requiredEquipmentCount}/${policy.count}件` : ""}，本次累计${result.count}次`, "success");
          }
        } catch (error) {
          failures++;
          tokenStatus.value[id] = shouldStop.value ? "stopped" : "failed";
          log(`小号自动洗练停止：${error.message}，已确认洗练${count}次`, "error");
        } finally {
          if (connected) {
            try { tokenStore.closeWebSocketConnection(id); }
            finally { releaseConnectionSlot(); }
          }
        }
      }
    } finally {
      ids.forEach(id => { if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "stopped"; });
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    message.info(`批量小号洗练已结束${failures ? `，${failures}个账号未全部达标` : ""}，请查看账号日志`);
  };
  return { batchAltAccountRefine };
}
