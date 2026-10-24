import { activityBody, mapEntries, mapGet } from "./rechargeActivity.js";
import { claimPendingEvoTowerRewards, normalizeWeirdTowerClimbCount } from "./evoTowerRewards.js";

const rows = table => mapEntries(table).map(([, row]) => row);
const record = value => value instanceof Map ? Object.fromEntries(value) : value;
function merge(target, patch) {
  for (const [key, value] of mapEntries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = merge(record(target[key]) || {}, value);
    } else target[key] = value;
  }
  return target;
}
const number = (value, label) => {
  if (value == null || value === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error(`${label}数据异常`);
  return Number(value);
};
export const weirdTowerDate = time => new Date(time + 8 * 3600000).toISOString().slice(2, 10).replaceAll("-", "");
// 已确认的完整查询响应模型包含默认实例，BON可省略空实例；增量写响应不补默认值。
function fullField(data, key, label) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`未取得${label}`);
  if (data[key] && typeof data[key] === "object" && !Array.isArray(data[key])) return data[key];
  if (data[key] === undefined && Object.keys(data).every(name => name === "_originalCmd")) return {};
  throw new Error(`未取得${label}`);
}
// 与客户端MPTileData一致：默认类型为箱子；未知类型先按物品配置，再按箱子配置恢复。
function normalizeTile(value, config) {
  const tile = { gridConfId: 0, gridItemId: 0, gridType: 1, openCnt: 0, isLock: false, ...record(value) };
  tile.gridType = Number(tile.gridType);
  if (tile.gridType !== 1 && tile.gridType !== 2) {
    if (mapGet(config.ActMergeItemConf, tile.gridItemId)) tile.gridType = 2;
    else if (mapGet(config.ActMergeBoxConf, tile.gridItemId)) tile.gridType = 1;
  }
  return tile;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timedOut = error => /timeout|timed out|超时/i.test(error?.message || "");

/** 一次调用只处理一个账号；完整查询补默认值，写响应仅合并增量。 */
export async function runWeirdTowerAccount({
  send, config, mode = "all", maxClimbs, formation,
  now = Date.now, stopped = () => false, log = () => {}, pause = sleep,
  maxActions = 10000,
}) {
  let tower, box, role, activity, share;
  let actId, actions = 0, climbed = 0, used = 0, merged = 0, mergeRounds = 0;
  const failures = [];
  const date = weirdTowerDate(now());
  const schedule = rows(config.EvoTowerScheduleConf).find(row => row.evoGachaStart * 1000 <= now() && now() <= row.evoGachaEnd * 1000);
  const check = () => {
    if (stopped()) { const error = new Error("怪异塔已停止"); error.stopped = true; throw error; }
    if (weirdTowerDate(now()) !== date || (schedule && now() > schedule.evoGachaEnd * 1000)) throw new Error("怪异塔日期或活动周期已变化，请重新执行");
  };
  const apply = response => {
    const data = activityBody(response);
    if (data?.evoTower) tower = merge(tower || {}, data.evoTower);
    if (data?.mergeBox) {
      const patch = record(data.mergeBox);
      if (patch.actId && actId && Number(patch.actId) !== actId) throw new Error("怪异塔合成活动已切期");
      const grid = box?.gridMap || {};
      for (const pos of data.delPosList || []) {
        if (grid[pos.gridX]) delete grid[pos.gridX][pos.gridY];
      }
      for (const [x, column] of mapEntries(patch.gridMap)) {
        grid[x] ||= {};
        for (const [y, tile] of mapEntries(column)) grid[x][y] = normalizeTile(tile, config);
      }
      box = merge(box || {}, { ...patch, gridMap: undefined });
      box.gridMap = grid;
    }
    if (data?.role) role = merge(role || {}, data.role);
    if (data?.activity) activity = merge(activity || {}, data.activity);
    if (data?.shareTask) share = merge(share || {}, data.shareTask);
    return data;
  };
  const request = async (cmd, params = {}, timeout = 5000) => {
    check();
    if (++actions > maxActions) throw new Error("怪异塔达到安全操作上限，尚未完成");
    const response = activityBody(await send(cmd, params, timeout));
    if (response?.code) throw new Error(`${cmd} 服务器错误: ${response.code}`);
    check();
    return response;
  };
  const getTower = async () => {
    const data = await request("evotower_getinfo");
    const snapshot = fullField(data, "evoTower", "怪异塔状态");
    tower = merge({ towerId: 0, rewardTowerId: 0, energy: 0, lotteryLeftCnt: 0,
      taskMap: {}, taskClaimMap: {}, legionTaskMap: {}, legionTaskClaimMap: {}, orderPassReward: {} }, snapshot);
    for (const key of ["towerId", "rewardTowerId", "energy", "lotteryLeftCnt"]) tower[key] = number(tower[key], `怪异塔${key}`);
    return tower;
  };
  const getBox = async () => {
    const data = await request("mergebox_getinfo", { actType: 1 });
    if (!data?.mergeBox) throw new Error("未取得怪异塔合成状态");
    const next = merge({ costTotalCnt: 0, costClaimCnt: 0, freeEnergy: 0, gridMap: {}, taskMap: {}, taskClaimMap: {} }, data.mergeBox);
    if (Number(next.actType) !== 1 || !Number(next.actId) || (actId && Number(next.actId) !== actId)) throw new Error("怪异塔合成活动未开放或已切期");
    actId = Number(next.actId);
    box = next;
    return box;
  };
  const getRole = async () => {
    const data = await request("role_getroleinfo");
    if (!data?.role) throw new Error("未取得怪异塔角色状态");
    role = data.role;
  };
  const getActivity = async () => {
    const data = await request("activity_get");
    activity = fullField(data, "activity", "怪异塔通行证状态");
  };
  const getShare = async () => {
    const data = await request("evotower_getshareinfo");
    share = merge({ shareTaskMap: {} }, fullField(data, "shareTask", "邀请奖励状态"));
  };
  // 写超时仅核对一次，不能证明成功就停止；不盲目重发写请求。
  const write = async (cmd, params, confirmed, refresh, timeout = 5000) => {
    let error;
    try { apply(await request(cmd, params, timeout)); }
    catch (caught) {
      if (!timedOut(caught) || caught.stopped) throw caught;
      error = caught;
    }
    if (error || !confirmed()) await refresh();
    if (!confirmed()) throw new Error(`${cmd}结果未确认${error ? `：${error.message}` : ""}`);
  };
  const claimTower = async () => {
    await claimPendingEvoTowerRewards({
      tower, shouldStop: stopped,
      send: async (cmd, params) => {
        const before = number(tower.rewardTowerId, "章节奖励");
        await write(cmd, params, () => Number(tower.rewardTowerId) > before, getTower);
        return { evoTower: { rewardTowerId: tower.rewardTowerId } };
      },
      onClaim: chapter => log(`领取第${chapter}章奖励`),
    });
    const today = mapGet(tower.taskMap, date) || {};
    const claimed = mapGet(tower.taskClaimMap, date) || {};
    for (const task of rows(config.EvoTowerTaskConf)) {
      if (Number(task.evoTowerTaskType) !== 1 || Number(mapGet(today, task.Id) || 0) < Number(task.taskPara) || mapGet(claimed, task.Id)) continue;
      await write("evotower_claimtask", { taskId: task.Id }, () => !!mapGet(mapGet(tower.taskClaimMap, date), task.Id), getTower);
      log(`领取每日任务${task.Id}`);
    }
  };
  const claimMergeRewards = async () => {
    let claimed = false;
    for (const task of rows(config.ActMergeProgressConf).filter(row => Number(row.actId) === actId)) {
      if (Number(mapGet(box.taskMap, task.id) || 0) <= 0 || mapGet(box.taskClaimMap, task.id)) continue;
      await write("mergebox_claimmergeprogress", { actType: 1, taskId: task.id }, () => !!mapGet(box.taskClaimMap, task.id), getBox);
      claimed = true;
      log(`领取合成达标奖励${task.id}`);
    }
    // costClaimCnt 是已领取的 costNum，不是领取档数。
    const tiers = rows(config.ActMergeItemCostProgressConf).filter(row => Number(row.actId) === actId).sort((a, b) => a.costNum - b.costNum);
    for (const tier of tiers) {
      if (Number(box.costTotalCnt) < Number(tier.costNum) || Number(box.costClaimCnt) >= Number(tier.costNum)) continue;
      await write("mergebox_claimcostprogress", { actType: 1 }, () => Number(box.costClaimCnt) >= Number(tier.costNum), getBox);
      claimed = true;
      log(`领取累计使用${tier.costNum}次奖励`);
    }
    if (claimed) await getTower();
  };
  const passInfo = () => mapGet(activity?.warOrderActivityInfo, 1003);
  const claimPass = async () => {
    const info = passInfo();
    const base = mapGet(config.BattlePassBaseConf, 1003);
    if (info && base) {
      const exp = Number(mapGet(role?.items, base.itemId)?.quantity || 0);
      const eligible = rows(config.BattlePassConf).filter(row => Number(row.actId) === 1003 && Number(row.exp) <= exp);
      const ready = eligible.filter(row => {
        const state = Number(mapGet(info.rewardClaimed, row.id) || 0);
        return (state === 0 && row.freeReward?.length) || (state < 2 && info.purchased && row.payReward?.length);
      });
      if (ready.length) {
        await write("activity_battlepassrewardclaim", { battlePassId: 1003 }, () => ready.every(row => {
          const state = Number(mapGet(passInfo()?.rewardClaimed, row.id) || 0);
          return state >= (info.purchased && row.payReward?.length ? 2 : 1);
        }), getActivity);
        log("领取怪异塔通行证等级奖励");
      }
      if (info.purchased && schedule) {
        const dayMs = Math.floor((schedule.evoTowerStart * 1000 + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
        const due = Array.from({ length: 7 }, (_, i) => dayMs + i * 86400000).filter(time => time <= now()).map(weirdTowerDate);
        if (due.some(day => !mapGet(tower.orderPassReward, day))) {
          // 无日期参数；服务器一次请求的实际领取范围由返回状态确认。
          for (let i = 0; i < due.length && due.some(day => !mapGet(tower.orderPassReward, day)); i++) {
            const before = due.filter(day => mapGet(tower.orderPassReward, day)).length;
            await write("evotower_claimorderpassdailyreward", {}, () => due.filter(day => mapGet(tower.orderPassReward, day)).length > before, getTower);
          }
          log("领取已购通行证每日钥匙");
        }
      }
    }
    const key = "async:claim:reward:v2:evoTowerShop";
    if (Number(mapGet(role?.statistics, key)) === 1) {
      await write("role_asyncclaimrewardv2", { type: "evoTowerShop", isAll: true, rewardId: "" },
        () => Number(mapGet(role?.statistics, key) || 0) !== 1, getRole);
      log("领取已购怪异塔待发奖励");
    }
  };
  const collect = async ({ external = false } = {}) => {
    await claimTower();
    if (external) {
      await getRole();
      if (Number(role.legionId || 0) > 0) {
        for (const task of rows(config.EvoTowerTaskConf)) {
          if (Number(task.evoTowerTaskType) !== 2 || Number(mapGet(tower.legionTaskMap, task.Id) || 0) < Number(task.taskPara) || mapGet(tower.legionTaskClaimMap, task.Id)) continue;
          await write("evotower_claimlegiontask", { taskId: task.Id }, () => !!mapGet(tower.legionTaskClaimMap, task.Id), getTower);
          log(`领取俱乐部任务${task.Id}`);
        }
      }
      await getShare();
      for (const task of rows(config.EvoTowerShareTasks).sort((a, b) => a.taskPara - b.taskPara)) {
        const progress = mapGet(share.shareTaskMap, task.evoTowerShareTaskGroup);
        if (!progress || Number(progress.progress) < Number(task.taskPara) || Number(progress.claimedProgress || 0) >= Number(task.taskPara)) continue;
        await write("evotower_claimsharetaskreward", { taskId: task.Id },
          () => Number(mapGet(share.shareTaskMap, task.evoTowerShareTaskGroup)?.claimedProgress || 0) >= Number(task.taskPara), getShare);
        log(`领取邀请达标奖励${task.Id}`);
      }
      await getActivity();
      await claimPass();
    }
    if (Number(box.freeEnergy) > 0) {
      const before = Number(box.freeEnergy);
      await write("mergebox_claimfreeenergy", { actType: 1 }, () => Number(box.freeEnergy) < before, getBox);
      log("领取免费钥匙");
    }
    await claimMergeRewards();
  };
  const climb = async () => {
    await claimTower();
    if (schedule && now() >= schedule.evoTowerEnd * 1000) {
      log("爬塔阶段已结束，继续处理可领取奖励和钥匙");
      return;
    }
    let previousFormation, switched = false, climbError;
    try {
      if (Number(tower.energy) > 0 && formation != null) {
        const data = await request("presetteam_getinfo");
        previousFormation = data?.presetTeamInfo?.useTeamId;
        if (previousFormation == null) throw new Error("阵容信息不完整，停止切换");
        if (Number(previousFormation) !== Number(formation)) {
          switched = true;
          await request("presetteam_saveteam", { teamId: formation });
        }
      }
      while (Number(tower.energy) > 0 && climbed < normalizeWeirdTowerClimbCount(maxClimbs)) {
        check();
        const before = { towerId: Number(tower.towerId), energy: Number(tower.energy) };
        await request("evotower_readyfight");
        let fightError;
        try { apply(await request("evotower_fight", { battleNum: 1, winNum: 1 }, 10000)); }
        catch (error) { if (!timedOut(error) || error.stopped) throw error; fightError = error; }
        // 保持现有战后1500ms等待，不增加间隔、退避或并发限制。
        await pause(1500);
        await getTower();
        if (Number(tower.towerId) <= before.towerId && Number(tower.energy) >= before.energy) {
          throw new Error(`怪异塔战斗进度未确认${fightError ? `：${fightError.message}` : ""}`);
        }
        climbed++;
        log(`爬怪异塔第${climbed}次`);
        await claimTower();
      }
    } catch (error) {
      climbError = error;
      throw error;
    } finally {
      if (switched) {
        // 即便主动停止也尝试恢复阵容。
        try {
          const restored = activityBody(await send("presetteam_saveteam", { teamId: previousFormation }, 5000));
          if (restored?.code) throw new Error(`服务器错误: ${restored.code}`);
        } catch (error) {
          throw new Error(`${climbError ? `${climbError.message}；` : ""}恢复阵容失败：${error.message}`);
        }
      }
    }
  };
  const board = () => {
    const conf = mapGet(config.ActMergeBoardConf, actId);
    if (!conf || Number(conf.actMergeFestivalType) !== 1) throw new Error("当前怪异塔棋盘配置不完整");
    return conf;
  };
  const tiles = () => mapEntries(box.gridMap).flatMap(([x, column]) => mapEntries(column).filter(([, item]) => item).map(([y, item]) => ({ x: Number(x), y: Number(y), ...normalizeTile(item, config) })));
  const mergePair = () => {
    const seen = new Map();
    for (const tile of tiles()) {
      const item = mapGet(config.ActMergeItemConf, tile.gridItemId);
      if (Number(tile.gridType ?? 1) !== 2 || Number(tile.gridConfId || 0) !== 0 || tile.isLock || !item || Number(item.nextLevelMergeItemId || 0) <= 0) continue;
      if (seen.has(tile.gridItemId)) return [seen.get(tile.gridItemId), tile];
      seen.set(tile.gridItemId, tile);
    }
    return null;
  };
  // 沿用旧策略：每轮按物品ID分组并两两配对，轮次内不处理新生成的物品。
  const mergeOnce = async () => {
    if (!mergePair()) return false;
    if (mergeRounds >= 20) throw new Error("合成已达到20轮上限，仍有可合成物品，请再次执行");
    mergeRounds++;
    await claimMergeRewards();
    const conf = board();
    const auto = Number(conf.quickMergeCondition) === 0 || Number(mapGet(box.taskMap, conf.quickMergeCondition) || 0) > 0;
    const position = tile => ({ gridX: tile.x, gridY: tile.y });
    const combine = async pair => {
      check();
      const before = JSON.stringify(box.gridMap);
      await write(auto ? "mergebox_automergeitem" : "mergebox_mergeitem", auto ? { actType: 1 } : {
        actType: 1, sourcePos: position(pair[0]), targetPos: position(pair[1]),
      }, () => JSON.stringify(box.gridMap) !== before, getBox, auto ? 10000 : 1000);
      merged++;
      await pause(auto ? 1500 : 300);
    };
    if (auto) await combine(mergePair());
    else {
      const groups = new Map();
      for (const tile of tiles()) {
        const item = mapGet(config.ActMergeItemConf, tile.gridItemId);
        if (Number(tile.gridType ?? 1) !== 2 || Number(tile.gridConfId || 0) !== 0 || tile.isLock || !item || Number(item.nextLevelMergeItemId || 0) <= 0) continue;
        const group = groups.get(tile.gridItemId) || [];
        group.push(tile);
        groups.set(tile.gridItemId, group);
      }
      for (const group of groups.values()) {
        while (group.length >= 2) await combine([group.shift(), group.shift()]);
      }
    }
    // 维持旧版每轮刷新一次棋盘，确认结果后再开始下一轮。
    await getBox();
    await claimMergeRewards();
    await pause(500);
    return true;
  };
  const useOne = async () => {
    const conf = board();
    const costs = conf.costItem || [];
    if (costs.length !== 1 || Number(costs[0].type) !== 55 || Number(costs[0].itemId) !== 37001) throw new Error("当前钥匙消耗配置已变化");
    const cost = number(costs[0].value, "钥匙消耗");
    if (cost <= 0) throw new Error("钥匙消耗配置异常");
    if (number(tower.lotteryLeftCnt, "钥匙库存") < cost) return false;
    const findLaunch = () => tiles().find(tile => !tile.isLock && tile.gridType === 1 &&
      Number(tile.openCnt) < Number(mapGet(config.ActMergeBoxConf, tile.gridItemId)?.useTimes || 0));
    let launch = findLaunch();
    if (!launch) {
      // 通知可能滞后：只读刷新一次，再决定跳过，不重发消费请求。
      await getBox();
      await getTower();
      if (number(tower.lotteryLeftCnt, "钥匙库存") < cost) return false;
      launch = findLaunch();
    }
    if (!launch) {
      const boxes = tiles().filter(tile => tile.gridType === 1);
      const detail = boxes.map(tile => {
        const conf = mapGet(config.ActMergeBoxConf, tile.gridItemId);
        const reason = !conf ? "配置缺失" : tile.isLock ? "未解锁" : "次数已耗尽";
        return `${conf?.name || "箱子"}(ID=${tile.gridItemId}，坐标${tile.x},${tile.y}，已用${tile.openCnt}/${conf?.useTimes ?? "未知"}，${reason})`;
      }).join("；");
      log(`棋盘暂无可用宝箱，跳过使用钥匙，继续后续任务；剩余钥匙${tower.lotteryLeftCnt}；${detail || "未识别到箱子"}`);
      return false;
    }
    const before = number(box.costTotalCnt, "累计使用");
    await write("mergebox_openbox", { actType: 1, pos: { gridX: launch.x, gridY: launch.y } },
      () => Number(box.costTotalCnt) > before, async () => { await getBox(); await getTower(); });
    // 钥匙可能仅在全局通知中更新；查询该账号服务器库存，不自行减库存推算返还。
    await getTower();
    used++;
    await pause(500);
    await claimMergeRewards();
    return true;
  };

  try {
    await getTower();
    if (mode === "climb") await climb();
    else {
      await getBox();
      await collect({ external: true });
      if (mode === "all") {
        try { await climb(); }
        catch (error) {
          if (error.stopped) throw error;
          failures.push(`爬塔：${error.message}`);
          log(`爬塔未完成：${error.message}；核对状态后继续领取和使用钥匙`, "warning");
        }
        await getTower();
        await getBox();
        await collect({ external: true });
      }
      if (mode === "use" || mode === "all") {
        await getTower();
        // 每次返还后重新读取库存；单次点击不循环重查俱乐部/邀请/通行证。
        while (true) {
          check();
          if (Number(tower.lotteryLeftCnt) <= 0) {
            if (mode === "all" && await mergeOnce()) continue;
            break;
          }
          if (mode === "all" && tiles().length >= Number(board().column) * Number(board().row)) {
            if (await mergeOnce()) continue;
            throw new Error("棋盘已满且没有可合成项，钥匙尚未用完");
          }
          if (!await useOne()) break;
        }
      } else if (mode === "merge") {
        while (await mergeOnce()) check();
      }
      await claimMergeRewards();
    }
    if (failures.length) throw new Error(failures.join("；"));
    return { status: "completed", climbed, used, merged, mergeRounds };
  } catch (error) {
    if (error.stopped) return { status: "stopped", climbed, used, merged, mergeRounds };
    throw error;
  }
}
