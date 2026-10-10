import { DEFAULT_ALT_REFINE_LIMIT, hasAltRefineTarget, runAltAccountRefine } from "../altAccountRefine.js";
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
          log(`开始${HERO_DICT[heroId].name}小号自动洗练，本账号本次上限${limit}次`);
          for (const [part, equip] of Object.entries(equipment)) {
            if (hasAltRefineTarget(equip)) log(`${partNames[part] || part}已有目标属性，跳过`);
          }
          const result = await runAltAccountRefine({
            heroId, equipment, limit, shouldStop: () => shouldStop.value,
            send: async (cmd, params) => {
              if (tokenStore.getWebSocketStatus(id) !== "connected") throw new Error("连接已断开");
              return tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
            },
            onUpdate: update => {
              count = update.count;
              if (hasAltRefineTarget(update.equipment)) {
                log(`${partNames[update.part]}已命中目标属性，本次累计${count}次`, "success");
              } else if (count % 100 === 0) {
                log(`正在洗练${partNames[update.part]}，本次累计${count}/${limit}次`);
              }
            },
            wait: () => new Promise(resolve => setTimeout(resolve,
              Math.max(350, Number(batchSettings.commandDelay) || 0))),
          });
          if (result.reason === "stopped") {
            tokenStatus.value[id] = "stopped";
            log(`小号洗练已停止，本次${result.count}次`, "warning");
          } else if (result.reason === "limit") {
            failures++;
            tokenStatus.value[id] = "failed";
            log(`已达本次白玉洗练上限${limit}次，达标${result.completedParts.length}/4件，剩余装备未继续洗练`, "warning");
          } else {
            tokenStatus.value[id] = "completed";
            log(`四件装备均已达标，本次累计${result.count}次`, "success");
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
