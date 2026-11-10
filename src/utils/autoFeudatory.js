import { extractRolePatch } from './roleSnapshot.js';
export const feudatoryBody = r => r?.data ?? r?._raw?.body ?? r?.body ?? r;
const entries = v => v instanceof Map ? [...v] : Object.entries(v || {});
const list = v => v instanceof Map ? [...v.values()] : Array.isArray(v) ? v : Object.values(v || {});
const integer = (v, label) => { if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${label}数据不完整`); return v; };
export function readFeudatoryRole(response) {
  const role = extractRolePatch(response) || feudatoryBody(response);
  integer(role?.roleId, '角色');
  if (!role.roleId) throw new Error('角色数据不完整');
  // role_getroleinfo完整快照应用协议默认值；null或畸形字段仍拒绝。
  const normalized = { ...role, bossId: role.bossId === undefined ? 0 : role.bossId, feudatory: role.feudatory === undefined ? {} : role.feudatory, hallEnergy: role.hallEnergy === undefined ? 0 : role.hallEnergy };
  integer(normalized.bossId, '咸主');
  if (!normalized.feudatory || typeof normalized.feudatory !== 'object' || Array.isArray(normalized.feudatory)) throw new Error('咸臣名单不完整');
  for (const [, member] of entries(normalized.feudatory)) {
    if (!member || typeof member !== 'object' || Array.isArray(member)) throw new Error('咸臣成员数据不完整');
  }
  return normalized;
}
export function syncFeudatoryHistory(role, history, now) {
  const active = new Set(entries(role.feudatory).map(([id]) => String(id)));
  for (const id of Object.keys(history)) if (!active.has(id)) delete history[id];
  for (const id of active) if (!history[id]) history[id] = { observedAt: now };
}
export async function runAutoFeudatory({ send, config, battleVersion, history, saveHistory, excludedRoleIds = [], now = Date.now, shouldStop = () => false, wait = async () => {}, log = () => {} }) {
  let role, energy, stopped = false;
  const actions = [];
  const released = new Set();
  const excluded = new Set([...excludedRoleIds].map(String));
  let ownerId;
  const request = async (cmd, params = {}) => {
    if (shouldStop()) { stopped = true; throw new Error('用户已停止'); }
    const r = await send(cmd, params);
    const b = feudatoryBody(r);
    if (r?.code || b?.code || r?.error) throw new Error(r?.error || `请求${cmd}失败`);
    await wait();
    return r;
  };
  const refresh = async () => {
    const freshRole = readFeudatoryRole(await request('role_getroleinfo'));
    if (ownerId !== undefined && freshRole.roleId !== ownerId) throw new Error('角色已变化，已停止');
    role = freshRole;
    ownerId = role.roleId;
    syncFeudatoryHistory(role, history, now()); saveHistory(history);
    return role;
  };
  const details = async id => feudatoryBody(await request('rank_getroleinfo', { roleId: Number(id), bottleType: 0, includeBottleTeam: false, isSearch: false }))?.roleInfo;
  const count = () => entries(role.feudatory).length;
  let reason = '候选已耗尽', error;
  try {
    await refresh();
    const rules = config?.ConstantConf;
    const cost = integer(rules?.lordEnergyCount, '精力消耗');
    if (!cost || !Array.isArray(rules?.lordCount)) throw new Error('咸臣名额配置不完整');
    integer(role.levelId, '自身推关');
    if (!(Number.isFinite(role.power) && role.power > 0)) throw new Error('自身战力数据不完整');
    const capacity = Math.min(5, rules.lordCount.filter(lv => Number.isFinite(lv) && role.levelId > lv).length);
    for (const [id, member] of entries(role.feudatory)) {
      const record = history[id], since = record?.capturedAt ?? record?.observedAt;
      const isOwnAccount = excluded.has(String(id));
      if (!isOwnAccount && (!Number.isFinite(since) || now() - since < 48 * 3600000 || (member?.goldTotal === undefined ? 0 : member.goldTotal) !== 0)) continue;
      await refresh();
      const fresh = entries(role.feudatory).find(([key]) => String(key) === String(id))?.[1];
      if (!fresh) continue;
      if (!isOwnAccount && ((fresh.goldTotal === undefined ? 0 : fresh.goldTotal) !== 0 || !history[id] || (history[id].capturedAt ?? history[id].observedAt) !== since)) continue;
      await request('feudatory_exiled', { targetId: Number(id), result: true });
      await refresh();
      if (entries(role.feudatory).some(([key]) => String(key) === String(id))) throw new Error('释放结果未确认，已停止');
      released.add(String(id));
      actions.push(`释放 ${id}`);
    }
    if (count() < capacity) {
      await request('hall_getinfo'); await refresh();
      energy = integer(role.hallEnergy, '精力');
      const seen = new Set([...excluded, ...released, String(role.roleId), String(role.bossId), ...entries(role.feudatory).map(([id]) => String(id))]);
      const capture = async ids => {
        for (const id of ids) {
          if (count() >= capacity || energy < cost) return;
          if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0 || seen.has(String(id))) continue;
          seen.add(String(id));
          for (let attempt = 0; attempt < 3; attempt++) {
            const target = await details(id);
            if (!target || Number(target.roleId) !== Number(id) || (target.bossId === undefined ? 0 : target.bossId) !== 0 || !(Number.isFinite(target.power) && target.power < role.power) || !(target.power >= 0) || !(Number.isSafeInteger(target.levelId) && target.levelId > 5500)) break;
            let result;
            try { result = feudatoryBody(await request('fight_startconquer', { targetId: Number(id), battleVersion: integer(battleVersion, '战斗版本') })); }
            catch (e) { await refresh(); throw e; }
            energy -= cost;
            await refresh();
            energy = Math.min(energy, integer(role.hallEnergy, '精力'));
            if (entries(role.feudatory).some(([key]) => String(key) === String(id))) {
              history[id] = { capturedAt: now(), observedAt: now() }; saveHistory(history);
              actions.push(`抓取 ${id}`); log(`已抓取咸臣 ${id}（${count()}/${capacity}）`); break;
            }
            if (!result?.battleData?.result || (result.battleData.result.isWin !== undefined && result.battleData.result.isWin !== false)) throw new Error('抓取结果未确认，已停止以避免重复消耗');
            if (energy < cost || count() >= capacity) break;
          }
        }
      };
      if (energy >= cost) {
        await request('arena_startarea');
        const ranks = feudatoryBody(await request('arena_getarearank', { rankType: 0, minRank: 0, maxRank: 0 }));
        if (!Array.isArray(ranks?.list)) throw new Error('竞技场名单不完整');
        // 当前官方 FullGetArenaRank 路径使用0/0；仅扫描服务器实际提供的本组榜单。
        const candidates = [...ranks.list];
        if (Number.isSafeInteger(ranks.total) && ranks.total > candidates.length) {
          if (ranks.total > 10000) throw new Error('竞技场榜单规模异常');
          for (let start = 1; start <= ranks.total; start += 100) {
            const page = feudatoryBody(await request('arena_getarearank', { rankType: 0, minRank: start, maxRank: Math.min(start + 99, ranks.total) }));
            if (!Array.isArray(page?.list)) throw new Error('竞技场分页数据不完整');
            candidates.push(...page.list);
          }
        }
        await capture(candidates.map(r => r.roleId));
        if (count() < capacity && energy >= cost) {
          const friends = feudatoryBody(await request('friend_list'));
          if (!friends?.friendList) throw new Error('好友名单不完整');
          await capture(list(friends.friendList).filter(f => Number.isFinite(f.lastLogin) && f.lastLogin > 0 && now() - f.lastLogin * 1000 >= 0 && now() - f.lastLogin * 1000 <= 86400000).map(f => f.roleId));
        }
      }
      reason = count() >= capacity ? '名额已满' : energy < cost ? '精力不足' : '候选已耗尽';
    } else reason = '名额已满';
  } catch (e) { error = e.message; reason = stopped || shouldStop() ? '已停止' : '异常停止'; }
  const members = [];
  for (const [id, member] of entries(role?.feudatory)) {
    let info;
    if (!shouldStop()) { try { info = await details(id); } catch { /* Report unknown instead of inventing identity. */ } }
    members.push({ id, name: info?.name, power: info?.power, levelId: info?.levelId, gold: member?.goldTotal === undefined ? 0 : member.goldTotal, ...history[id] });
  }
  let boss;
  if (role?.bossId > 0) { boss = { id: role.bossId }; if (!shouldStop()) try { Object.assign(boss, await details(role.bossId)); } catch { /* ID remains known. */ } }
  return { reason, error, snapshotKnown: Boolean(role), members, boss, actions };
}
const cell = v => String(v ?? '未知').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tableCell = 'border:1px solid #d9d9d9;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;';
const goldTotal = row => row.snapshotKnown !== false && Array.isArray(row.members) && row.members.every(m => Number.isSafeInteger(m.gold) && m.gold >= 0)
  ? row.members.reduce((sum, m) => sum + m.gold, 0) : null;
const numberText = value => value == null ? '未知' : value > 0 && value < 100 ? '<0.01万' : `${(value / 10000).toLocaleString('zh-CN', { useGrouping: false, maximumFractionDigits: 2 })}万`;
const actionCount = (rows, action) => rows.reduce((sum, row) => sum + (row.actions || []).filter(text => text.startsWith(`${action} `)).length, 0);
/** 一批一张五列总表；分段时重复完整批次汇总和表头。 */
export function feudatoryReport(results, summaryResults = results) {
  const totals = summaryResults.map(goldTotal);
  const total = totals.every(value => value !== null) ? totals.reduce((sum, value) => sum + value, 0) : null;
  const summary = `本批${summaryResults.length}个账号｜抓取${actionCount(summaryResults, '抓取')}人｜释放${actionCount(summaryResults, '释放')}人｜当前咸臣贡献合计${numberText(total)}金币`;
  const headers = ['账号', '执行结果', '咸臣清单（贡献金币）', '金币合计', '我的咸主'];
  const rows = results.map(row => {
    const actions = [`抓取${actionCount([row], '抓取')}`, `释放${actionCount([row], '释放')}`, row.reason || '未知'];
    if (row.error) actions.push(String(row.error).replace(/[\r\n]+/g, ' ').slice(0, 36));
    const members = row.snapshotKnown === false ? '未知' : row.members?.length
      ? row.members.map(m => `${cell(m.name)}：${cell(numberText(Number.isSafeInteger(m.gold) && m.gold >= 0 ? m.gold : null))}`).join('<br>') : '无';
    const boss = row.boss ? cell(row.boss.name) : row.snapshotKnown === false ? '未知' : '无';
    return `<tr><td style="${tableCell}font-weight:bold;">${cell(row.name)}</td><td style="${tableCell}">${cell(actions.join(' · '))}</td><td style="${tableCell}">${members}</td><td style="${tableCell}text-align:right;">${cell(numberText(goldTotal(row)))}</td><td style="${tableCell}">${boss}</td></tr>`;
  }).join('');
  return `<p>${cell(summary)}</p><table style="width:100%;border-collapse:collapse;font-size:13px;line-height:1.5;"><thead><tr>${headers.map(label => `<th style="${tableCell}background:#f2f5f8;">${cell(label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
}

/** 只释放开始时的名单，失败或超时后查状态，不重复发送写请求。 */
export async function releaseAllFeudatory({ send, shouldStop = () => false, wait = async () => {}, onReleased = () => {} }) {
  const request = async (cmd, params = {}) => {
    if (shouldStop()) throw new Error('用户已停止');
    const response = await send(cmd, params);
    const body = feudatoryBody(response);
    if (response?.code || body?.code || response?.error) throw new Error(response?.error || `请求${cmd}失败`);
    return response;
  };
  let role = readFeudatoryRole(await request('role_getroleinfo'));
  const ownerId = role.roleId;
  const ids = entries(role.feudatory).map(([id]) => Number(id));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0 || id === ownerId)) throw new Error('咸臣ID异常，未发送释放请求');
  let count = 0;
  for (const targetId of ids) {
    if (shouldStop()) return { count, stopped: true };
    role = readFeudatoryRole(await request('role_getroleinfo'));
    if (role.roleId !== ownerId) throw new Error('角色已变化，已停止释放');
    if (!entries(role.feudatory).some(([id]) => Number(id) === targetId)) continue;
    let writeError;
    try { await request('feudatory_exiled', { targetId, result: true }); }
    catch (error) { writeError = error; }
    // 已发送的写请求即使超时或用户停止，也只做一次只读核验。
    const response = await send('role_getroleinfo', {});
    if (response?.code || feudatoryBody(response)?.code || response?.error) throw new Error('释放结果查询失败，已停止');
    const fresh = readFeudatoryRole(response);
    if (fresh.roleId !== ownerId) throw new Error('角色已变化，释放结果未确认');
    if (entries(fresh.feudatory).some(([id]) => Number(id) === targetId)) throw new Error(`释放咸臣${targetId}未确认${writeError ? `：${writeError.message}` : ''}`);
    count++;
    onReleased({ roleId: ownerId, targetId, count });
    if (writeError) throw new Error(`咸臣${targetId}已确认释放，但请求异常，已停止：${writeError.message}`);
    if (shouldStop()) return { count, stopped: true };
    await wait();
  }
  return { count, stopped: shouldStop() };
}
