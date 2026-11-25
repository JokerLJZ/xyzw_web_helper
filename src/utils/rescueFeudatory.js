import { feudatoryBody, readFeudatoryRole } from './autoFeudatory.js';
const hasMember = (role, id) => role.feudatory instanceof Map ? role.feudatory.has(id) || role.feudatory.has(String(id)) : Object.hasOwn(role.feudatory, id);
const memberCount = role => role.feudatory instanceof Map ? role.feudatory.size : Object.keys(role.feudatory).length;
/** 在整批结束后，用一个执行账号征服并释放选中账号；关系查询为最终判据。 */
export async function rescueSelectedFeudatory({ rows, send, config, battleVersion, shouldStop = () => false, wait = async () => {}, onReleased = () => {}, log = () => {} }) {
  const request = async (cmd, params = {}) => {
    if (shouldStop()) throw new Error('用户已停止');
    const result = await send(cmd, params), body = feudatoryBody(result);
    if (result?.code || result?.error || body?.code) throw new Error(result?.error || `${cmd}请求失败`);
    await wait(); return body;
  };
  let executor = readFeudatoryRole(await request('role_getroleinfo'));
  const executorId = executor.roleId;
  let energyBudget = executor.hallEnergy;
  const refresh = async () => {
    const role = readFeudatoryRole(await request('role_getroleinfo'));
    if (role.roleId !== executorId) throw new Error('解救执行账号已变化');
    executor = role;
    energyBudget = Math.min(energyBudget, role.hallEnergy);
  };
  const details = async id => {
    const info = (await request('rank_getroleinfo', {roleId:id,bottleType:0,includeBottleTeam:false,isSearch:false}))?.roleInfo;
    if (info?.roleId !== id) throw new Error('目标角色状态未确认');
    return info;
  };
  const targetInfo = async id => {
    const info = await details(id);
    // 完整rank_getroleinfo详情中的bossId按协议默认0补齐，null/畸形值仍拒绝。
    const bossId = info.bossId === undefined ? 0 : info.bossId;
    if (!Number.isSafeInteger(bossId) || bossId < 0) throw new Error('目标咸主状态未确认');
    return {...info,bossId};
  };
  const cost = config?.ConstantConf?.lordEnergyCount, limits = config?.ConstantConf?.lordCount;
  if (!Number.isSafeInteger(cost) || cost <= 0 || !Array.isArray(limits) || !Number.isSafeInteger(battleVersion) || battleVersion <= 0) throw new Error('解救配置或战斗版本无效');
  let stopReason;
  for (const row of rows) {
    if (stopReason || shouldStop()) { row.rescueResult = `未解救：${stopReason || '用户已停止'}`; continue; }
    const id = Number(row.roleId);
    if (!Number.isSafeInteger(id) || id <= 0) { row.rescueResult = '未解救：角色ID未知'; continue; }
    try {
      let target = await targetInfo(id);
      row.boss = target.bossId ? {id:target.bossId,name:'未知'} : null;
      if (!target.bossId) { row.rescueResult = '无需解救'; continue; }
      if (id === executorId) { row.rescueResult = '未解救：执行账号无法征服自己'; continue; }
      for (let attempt = 0; attempt < 3; attempt++) {
        await refresh();
        target = await targetInfo(id);
        if (!target.bossId) { row.boss = null; row.rescueResult = '已无咸主'; break; }
        if (target.bossId !== executorId) {
          if (executor.bossId === id) { row.rescueResult = '未解救：目标是执行账号的咸主'; break; }
          const capacity = Math.min(5, limits.filter(lv => Number.isFinite(lv) && executor.levelId > lv).length);
          if (memberCount(executor) >= capacity) { stopReason = '执行账号名额已满'; break; }
          if (!Number.isSafeInteger(energyBudget) || energyBudget < cost) { stopReason = '执行账号精力不足'; break; }
          // 官方客户端会先读取原咸主资料，但征服请求的targetId仍为被解救账号。
          await details(target.bossId);
          const result = await request('fight_startconquer', {targetId:id,battleVersion});
          energyBudget -= cost;
          await refresh(); target = await targetInfo(id);
          row.boss = target.bossId ? {id:target.bossId,name:'未知'} : null;
          if (!target.bossId) { row.rescueResult = '已无咸主'; break; }
          if (target.bossId !== executorId || !hasMember(executor,id)) {
            if (!result?.battleData?.result || ![undefined,false].includes(result.battleData.result.isWin)) throw new Error('征服归属未确认');
            if (attempt === 2) row.rescueResult = '未解救：连续战败3次';
            continue;
          }
        }
        if (!hasMember(executor,id)) throw new Error('目标未在执行账号咸臣名单中，未释放');
        await request('feudatory_exiled', {targetId:id,result:true});
        await refresh(); target = await targetInfo(id);
        row.boss = target.bossId ? {id:target.bossId,name:'未知'} : null;
        if (hasMember(executor,id) || target.bossId !== 0) throw new Error('释放后仍未确认目标无咸主');
        row.rescueResult = '解救成功';
        onReleased({roleId:executorId,targetId:id});
        log(`${row.name} 解救成功，已确认无咸主`);
        break;
      }
      if (stopReason) row.rescueResult = `未解救：${stopReason}`;
    } catch (error) {
      stopReason = error.message;
      row.rescueResult = `未解救：${stopReason}`;
      // 异常或超时后仅核验关系，不补发征服或释放；无法核验则展示未知。
      row.boss = {name:'未知',id:'未知'};
      if (!shouldStop()) try { const target = await targetInfo(id); row.boss = target.bossId ? {id:target.bossId,name:'未知'} : null; } catch { /* 保留未知 */ }
    }
    if (row.boss?.id > 0 && !shouldStop()) try { row.boss.name = (await details(row.boss.id)).name; } catch { /* 名称未知 */ }
  }
  // 执行账号可能也在本轮报表中，解救中临时收取/释放关系后刷新它的贡献名单。
  const executorRow = rows.find(row => Number(row.roleId) === executorId);
  if (executorRow) {
    try {
      await refresh();
      const entries = executor.feudatory instanceof Map ? [...executor.feudatory] : Object.entries(executor.feudatory);
      const previous = new Map((executorRow.members || []).map(m => [String(m.id),m]));
      executorRow.members = entries.map(([id,m]) => ({...previous.get(String(id)),id,gold:m.goldTotal ?? 0}));
    } catch { executorRow.snapshotKnown = false; }
  }
  return rows;
}
