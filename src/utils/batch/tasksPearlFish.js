import { extractRolePatch, mergeRoleSnapshot } from "../roleSnapshot.js";
import { PEARL_FISH_GOODS, highestOwnedFish, redFeatherPurchaseNeed, planPearlFishPurchases } from "../pearlFishPlanner.js";

// 购买请求、奖励、珍珠增量：api采集/养号/吕布赤羽.txt。
// 商品配置来自采集HTTP缓存引用的官方MerchandiseConf(a7495acce5)。
// 佩戴/卸载：api采集/武将/加载鱼灵和卸载鱼灵.txt。
export function createTasksPearlFish(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
    currentRunningTokenId, ensureConnection, releaseConnectionSlot,
    tokenStore, addLog, message, batchSettings } = deps;

  const run = async (mode) => {
    const ids = [...selectedTokens.value];
    if (!ids.length) return;
    const autoUpgrade = batchSettings.pearlFishAutoUpgrade === true;
    isRunning.value = true;
    shouldStop.value = false;
    ids.forEach(id => { tokenStatus.value[id] = "waiting"; });
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(t => t.id === id)?.name || id;
        const log = (text, type = "info") => addLog({ time: new Date().toLocaleTimeString(), message: `${name} ${text}`, type });
        let connected = false;
        const purchases = { redFeather: 0, bagua: 0 };
        try {
          tokenStatus.value[id] = "running";
          currentRunningTokenId.value = id;
          await ensureConnection(id);
          connected = true;
          if (shouldStop.value) { tokenStatus.value[id] = "stopped"; break; }
          const query = async () => {
            const info = await tokenStore.sendGetRoleInfo(id);
            const role = extractRolePatch(info) ?? info;
            if (!role?.items || !role?.heroes) throw new Error("未获取到完整鱼灵与武将数据");
            return role;
          };
          let role = await query();
          const send = async (cmd, params) => {
            if (shouldStop.value) { const e = new Error("任务已停止"); e.interrupted = true; throw e; }
            if (tokenStore.getWebSocketStatus(id) !== "connected") throw new Error("连接已断开");
            return tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
          };
          const pause = () => deps.sleep
            ? deps.sleep(Math.max(500, Number(batchSettings.commandDelay) || 0))
            : new Promise(resolve => setTimeout(resolve, Math.max(500, Number(batchSettings.commandDelay) || 0)));
          const equipPurchased = async (goods) => {
            // 只有该鱼灵实际购买成功，才允许升星与调整佩戴。
            if (autoUpgrade) {
              while (!shouldStop.value) {
                const fish = highestOwnedFish(role, goods);
                const stock = Number(role.items[goods.itemId]?.quantity ?? 0);
                const needed = 1 + (fish?.star === 1 && fish.holderHeroId === -1 ? 1 : 0);
                if (!fish || fish.star >= goods.maxStar || stock < needed) break;
                await pause();
                await send("artifact_upgradestar", { heroId: fish.holderHeroId, itemId: fish.itemId });
                role = await query();
                if ((highestOwnedFish(role, goods)?.star ?? 0) <= fish.star) throw new Error(`${goods.name}升星结果未确认，停止`);
                log(`${goods.name}已升至${fish.star + 1}星`, "success");
              }
            }
            if (shouldStop.value) return;
            const fish = highestOwnedFish(role, goods);
            const hero = role.heroes[goods.heroId];
            if (!fish || !hero) throw new Error(`无法确认${goods.heroName}或最高星${goods.name}`);
            if (Number(hero.artifactId) === fish.itemId) {
              log(`${goods.heroName}已佩戴最高星${goods.name}${fish.star}星`, "success"); return;
            }
            if (fish.holderHeroId > 0 && fish.holderHeroId !== goods.heroId) {
              await pause();
              await send("artifact_unload", { heroId: fish.holderHeroId });
              role = await query();
              if (Number(role.heroes[fish.holderHeroId]?.artifactId) === fish.itemId) throw new Error("鱼灵卸载结果未确认");
            }
            await pause();
            await send("artifact_load", { heroId: goods.heroId, itemId: fish.itemId,
              targetHeroId: -1, pearlId: Number(role.heroes[goods.heroId]?.pearlId) || 0 });
            role = await query();
            if (Number(role.heroes[goods.heroId]?.artifactId) !== fish.itemId) throw new Error("鱼灵佩戴结果未确认");
            log(`已为${goods.heroName}佩戴最高星${goods.name}${fish.star}星`, "success");
          };
          const plan = planPearlFishPurchases(role);
          log(`赤羽升至4星还缺${plan.redNeed}条，当前可买${plan.redCount}条，补齐后可买八卦鱼${plan.baguaCount}条`);
          for (const key of (mode === "all" ? ["redFeather", "bagua"] : [mode])) {
            if (shouldStop.value) break;
            const goods = PEARL_FISH_GOODS[key];
            if (!role.heroes[goods.heroId]) {
              log(`未拥有${goods.heroName}，跳过${goods.name}采购和佩戴`, "warning"); continue;
            }
            if (key === "bagua" && redFeatherPurchaseNeed(role) > 0) {
              log("赤羽升4星材料尚未补齐，保留珍珠，跳过八卦鱼采购", "warning"); continue;
            }
            const currentPlan = planPearlFishPurchases(role);
            const quantity = key === "redFeather" ? currentPlan.redCount : currentPlan.baguaCount;
            if (!quantity) { log(`${goods.name}无需购买或珍珠不足，不调整佩戴`); continue; }
            for (let i = 0; i < quantity && !shouldStop.value; i++) {
              await pause();
              const pearls = Number(role.items[1013]?.quantity);
              if (pearls < goods.price) break;
              const beforeItem = Number(role.items[goods.itemId]?.quantity ?? 0);
              const response = await send("activity_buygoods", { type: 1, goodsId: goods.goodsId });
              const body = response?._raw?.body ?? response?.body ?? response;
              const patch = extractRolePatch(body);
              mergeRoleSnapshot(role, patch);
              if (patch?.items?.[1013]?.quantity == null) role = await query();
              const hasReward = body?.reward?.some(r => r.type === 3 && r.itemId === goods.itemId && r.value === 1);
              const itemIncreased = Number(role.items[goods.itemId]?.quantity ?? 0) === beforeItem + 1;
              if (Number(role.items[1013]?.quantity) !== pearls - goods.price || (!hasReward && !itemIncreased)) {
                throw new Error(`${goods.name}购买奖励或珍珠消耗未确认，停止且不重试`);
              }
              purchases[key]++;
              log(`已买${goods.name}${purchases[key]}/${quantity}条，剩余珍珠${role.items[1013].quantity}`, "success");
            }
            if (purchases[key] > 0 && !shouldStop.value) {
              role = await query();
              await equipPurchased(goods);
            }
          }
          tokenStatus.value[id] = shouldStop.value ? "stopped" : "completed";
          log(`珍珠采购结束：赤羽${purchases.redFeather}条，八卦鱼${purchases.bagua}条`);
        } catch (error) {
          tokenStatus.value[id] = shouldStop.value ? "stopped" : "failed";
          log(`珍珠采购停止：${error.message}，已确认赤羽${purchases.redFeather}条、八卦鱼${purchases.bagua}条，未自动重试`, "error");
        } finally {
          if (connected) {
            try { tokenStore.closeWebSocketConnection(id); }
            finally { releaseConnectionSlot(); }
          }
        }
      }
    } finally {
      ids.forEach(id => { if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "stopped"; });
      currentRunningTokenId.value = null;
      isRunning.value = false;
    }
    message.info("珍珠采购任务已结束，请查看各账号日志");
  };
  return {
    batchBuyRedFeatherWithPearls: () => run("redFeather"),
    batchBuyBaguaWithPearls: () => run("bagua"),
    batchBuyPearlFish: () => run("all"),
  };
}
