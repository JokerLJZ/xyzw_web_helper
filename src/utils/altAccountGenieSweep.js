import { extractRolePatch } from "./roleSnapshot.js";
import { isGenieMainLevelUnlocked } from "./dailyFeatureEligibility.js";

// 当前客户端：genie 保存已通关关卡的零基索引，魔毯为1021，每批上限20。
const configCache = new Map();
export async function loadGenieSweepConfig(send, fetcher = globalThis.fetch) {
  const response = await send("system_getdatabundlever", { isAudit: false });
  const body = response?._raw?.body || response?.body || response?.data || response;
  const version = body?.dataBundleVer;
  if (typeof version !== "string" || !/^[\w-]+$/.test(version)) throw new Error("未取得灯神奖励配置版本");
  if (!configCache.has(version)) {
    const loading = (async () => {
      const response = await fetcher(`https://xxz-xyzw-res.hortorgames.com/data/${version}/config_ap.json`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("灯神奖励配置下载失败");
      const config = await response.json();
      if (!config.genieConf || !config.genieLevelConf) throw new Error("灯神奖励配置缺失");
      return config;
    })();
    configCache.set(version, loading);
    loading.catch(() => configCache.delete(version));
  }
  return configCache.get(version);
}

export function getAltGenieSweepTarget(role, config) {
  let best = null;
  for (let genieId = 1; genieId <= 4; genieId++) {
    const index = role?.genie?.[genieId];
    if (!Number.isInteger(index) || index < 10) continue;
    const levelId = config?.genieConf?.[genieId]?.genieLevel?.[index];
    const rewards = config?.genieLevelConf?.[levelId]?.stayFixedReward;
    const fragments = Array.isArray(rewards) ? rewards.filter(reward => reward.type === 3 && reward.itemId === 3201)
      .reduce((sum, reward) => sum + Number(reward.value || 0), 0) : 0;
    if (fragments !== 3) continue;
    if (!best || index + 1 > best.layer) best = { genieId, layer: index + 1 };
  }
  return best;
}

const ticketCount = (role) => {
  if (!role?.items || typeof role.items !== "object") throw new Error("未取得魔毯库存，停止扫荡");
  const count = Number(role.items[1021]?.quantity ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("魔毯库存异常，停止扫荡");
  return count;
};

export function hasFreeGenieSweep(role, genieId, now = Date.now()) {
  const key = `genie:daily:free:${genieId}`;
  const timestamp = Number(role.statisticsTime?.[key] || 0) * 1000;
  const day = (time) => Math.floor((time + 8 * 3600000) / 86400000);
  return day(timestamp) !== day(now) || Number(role.statistics?.[key] || 0) < 1;
}

export async function sweepAltAccountGenie({ queryRole, sendSweep, shouldStop, sleep, log, loadConfig }) {
  let role = await queryRole();
  if (!isGenieMainLevelUnlocked(role)) {
    log("未达到灯神开启条件，跳过");
    return;
  }
  const config = await loadConfig();
  let target = getAltGenieSweepTarget(role, config);
  if (!target) {
    log("未找到达到11层且单次扫荡奖励为3个万能红将碎片的灯神，保留魔毯");
    return;
  }
  let remaining = ticketCount(role);
  if (!remaining) log("没有扫荡魔毯，跳过");
  while (remaining > 0 && !shouldStop()) {
    const free = hasFreeGenieSweep(role, target.genieId);
    const sweepCnt = free ? 1 : Math.min(remaining, 20);
    log(`扫荡第${target.layer}层灯神（阵营${target.genieId}），${sweepCnt}次`);
    let failure;
    try {
      const response = await sendSweep({ genieId: target.genieId, sweepCnt });
      if (response?.error || response?.code) throw new Error(response.hint || "扫荡请求失败");
    } catch (error) {
      failure = error;
    }
    // 写请求无论成功或超时，都重新读本账号完整状态；绝不重发结果不明的消耗请求。
    role = await queryRole();
    const next = ticketCount(role);
    if (failure) throw failure;
    if (free ? next !== remaining || hasFreeGenieSweep(role, target.genieId) : next !== remaining - sweepCnt) {
      throw new Error("扫荡后魔毯消耗或免费次数未确认，停止扫荡");
    }
    log(`扫荡已确认，剩余魔毯${next}张`);
    remaining = next;
    target = getAltGenieSweepTarget(role, config);
    if (!target) throw new Error("灯神层数状态异常，停止扫荡");
    if (remaining && !shouldStop()) await sleep();
  }
}

export function readGenieRole(response) {
  const role = extractRolePatch(response);
  if (!role) throw new Error("未取得本账号角色信息");
  return role;
}
