import { rescueSelectedFeudatory } from '../rescueFeudatory.js';
import { releaseAllFeudatory, runAutoFeudatory, feudatoryReport } from '../autoFeudatory.js';
import { loadSignupCheerConfig } from './tasksSignupCheer.js';
import { sendWxPusherMessage } from '../wxpusher.js';
import { extractRolePatch } from '../roleSnapshot.js';

/** Missing relation data is unknown, never evidence that an account is free. */
export function getSaltMasterState(response) {
  const role = extractRolePatch(response) || response;
  const bossId = role?.bossId;
  if (typeof bossId !== 'number' || !Number.isSafeInteger(bossId) || bossId < 0)
    throw new Error('服务器未返回有效的咸主状态 bossId');
  return { hasMaster: bossId > 0, bossId };
}

const cell = value => String(value ?? '-')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function formatSaltMasterNotification(results) {
  const unique = [...new Map(results.map(row => [row.tokenId, row])).values()];
  const hits = unique.filter(row => row.hasMaster === true && !row.error);
  const failed = unique.filter(row => row.error).length;
  return {
    hits,
    title: `有咸主的账号清单（${hits.length}个）`,
    content: [
      '## 有咸主的账号清单', '',
      `本次取得 ${unique.length} 个账号的查询结果，其中 ${hits.length} 个有咸主，${failed} 个查询失败。未执行账号不在本次结果中。`,
      '', '| 账号 | 区服 | 咸主角色ID |', '|---|---|---|',
      ...hits.map(row => `| ${cell(row.name)} | ${cell(row.server)} | ${cell(row.bossId)} |`),
    ].join('\n'),
  };
}

export function createTasksFeudatory(deps) {
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop,
    currentRunningTokenId, ensureConnection, releaseConnectionSlot,
    tokenStore, batchSettings, addLog, message } = deps;
  const wait = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const push = deps.sendWxPusherMessage || sendWxPusherMessage;
  const log = (text, type = 'info') => addLog({ time: new Date().toLocaleTimeString(), message: text, type });

  const pushSaltMasterInfo = async results => {
    const report = formatSaltMasterNotification(results);
    if (!report.hits.length) {
      log('本次未查询到有咸主的账号，不发送 WxPusher 通知');
      return;
    }
    if (!batchSettings.wxpusherEnabled || !batchSettings.wxpusherAppToken || !batchSettings.wxpusherUids) {
      log(`检测到 ${report.hits.length} 个账号有咸主，但 WxPusher 未启用或配置不完整，未发送清单`, 'warning');
      message.warning('请在批量任务设置中启用并配置 WxPusher');
      return;
    }
    await push({ appToken: batchSettings.wxpusherAppToken, uids: batchSettings.wxpusherUids }, report.title, report.content);
    log(`有咸主的账号清单已通过 WxPusher 发送（${report.hits.length}个）`, 'success');
  };

  const batchCheckSaltMasters = async (options = {}) => {
    const ids = [...selectedTokens.value];
    if (!ids.length) return [];
    const results = [];
    isRunning.value = true;
    shouldStop.value = false;
    ids.forEach(id => { tokenStatus.value[id] = 'waiting'; });
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const token = tokens.value.find(item => item.id === id);
        const identity = { tokenId: id, name: token?.name || id, server: token?.server || '-' };
        let ownsSlot = false;
        try {
          tokenStatus.value[id] = 'running';
          currentRunningTokenId.value = id;
          const initial = await ensureConnection(id, 2, acquired => { ownsSlot = acquired; }, { readOnly: true });
          if (shouldStop.value) { tokenStatus.value[id] = 'stopped'; break; }
          // Scheduled sessions may return another task's initialization result.
          let response = initial;
          const initialRole = extractRolePatch(initial) || initial;
          if (!initialRole || !Object.hasOwn(initialRole, 'bossId')) {
            await wait(Math.max(1000, Number(batchSettings.commandDelay) || 0));
            if (shouldStop.value) { tokenStatus.value[id] = 'stopped'; break; }
            response = await tokenStore.sendMessageWithPromise(id, 'role_getroleinfo', {}, 15000);
          }
          if (shouldStop.value) { tokenStatus.value[id] = 'stopped'; break; }
          const state = getSaltMasterState(response);
          results.push({ ...identity, ...state });
          tokenStatus.value[id] = 'completed';
          log(`${identity.name}：${state.hasMaster ? `有咸主（角色ID ${state.bossId}）` : '没有咸主'}`, state.hasMaster ? 'warning' : 'info');
        } catch (error) {
          results.push({ ...identity, error: error.message || '未知错误' });
          tokenStatus.value[id] = 'failed';
          log(`${identity.name} 查询咸主失败：${error.message}，未判定为没有咸主`, 'error');
        } finally {
          if (ownsSlot) {
            try { tokenStore.closeWebSocketConnection(id); }
            finally { releaseConnectionSlot(); }
          }
        }
      }
      if (!options.deferPush) {
        try { await pushSaltMasterInfo(results); }
        catch (error) {
          log(`咸主账号清单推送失败：${error.message}`, 'error');
          message.error(`咸主账号清单推送失败：${error.message}`);
        }
      }
    } finally {
      ids.forEach(id => { if (tokenStatus.value[id] === 'waiting') tokenStatus.value[id] = 'stopped'; });
      isRunning.value = false;
      currentRunningTokenId.value = null;
    }
    if (!options.deferPush) message.info('咸主查询结束，请查看账号日志');
    return results;
  };
  const batchReleaseFeudatory = async () => {
    const ids = [...selectedTokens.value];
    if (!ids.length) return;
    isRunning.value = true; shouldStop.value = false;
    ids.forEach(id => { tokenStatus.value[id] = 'waiting'; });
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(t => t.id === id)?.name || id;
        let ownsSlot = false, count = 0;
        currentRunningTokenId.value = id; tokenStatus.value[id] = 'running';
        try {
          await ensureConnection(id, 2, acquired => { ownsSlot = acquired; }, { readOnly: true });
          const result = await releaseAllFeudatory({
            send: (cmd, params) => {
              if (tokenStore.getWebSocketStatus(id) !== 'connected') throw new Error('连接已断开');
              return tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
            },
            shouldStop: () => shouldStop.value,
            wait: () => wait(Math.max(500, Number(batchSettings.commandDelay) || 0)),
            onReleased: update => {
              count = update.count;
              log(`${name} 已确认释放咸臣 ${update.targetId}，累计${count}人`);
              // 清理对应关系的观察时间，其他咸臣记录不受影响。
              try {
                const storage = deps.storage || globalThis.localStorage;
                const key = `xyzw-feudatory-history-v1:${update.roleId}`;
                const history = JSON.parse(storage.getItem(key) || '{}');
                delete history[update.targetId]; storage.setItem(key, JSON.stringify(history));
              } catch (error) { log(`${name} 观察记录清理失败：${error.message}`, 'warning'); }
            },
          });
          tokenStatus.value[id] = result.stopped ? 'stopped' : 'completed';
          log(`${name} 一键释放咸臣${result.stopped ? '已停止' : '完成'}，已确认释放${result.count}人`);
        } catch (error) {
          tokenStatus.value[id] = shouldStop.value ? 'stopped' : 'failed';
          log(`${name} 一键释放咸臣停止：${error.message}，已确认释放${count}人`, 'warning');
        } finally {
          if (ownsSlot) { try { tokenStore.closeWebSocketConnection(id); } finally { releaseConnectionSlot(); } }
        }
      }
    } finally {
      ids.forEach(id => { if (tokenStatus.value[id] === 'waiting') tokenStatus.value[id] = 'stopped'; });
      isRunning.value = false; currentRunningTokenId.value = null;
    }
  };
  const pushFeudatoryInfo = async results => {
    const unique = [...new Map(results.map(r => [r.tokenId, r])).values()];
    if (!unique.length) return;
    if (!batchSettings.wxpusherEnabled || !batchSettings.wxpusherAppToken || !batchSettings.wxpusherUids) {
      log('WxPusher未配置，咸臣报表未推送', 'warning'); return;
    }
    const chunks = [];
    let current = [];
    const fits = html => html.length <= 38000 && new TextEncoder().encode(html).length <= 60000;
    for (const row of unique) {
      if (!fits(feudatoryReport([row], unique))) throw new Error('单账号咸臣报表过长，未发送');
      const next = [...current, row];
      if (current.length && !fits(feudatoryReport(next, unique))) { chunks.push(feudatoryReport(current, unique)); current = [row]; }
      else current = next;
    }
    if (current.length) chunks.push(feudatoryReport(current, unique));
    for (let i = 0; i < chunks.length; i++) {
      if (i) await wait(600);
      await push({ appToken: batchSettings.wxpusherAppToken, uids: batchSettings.wxpusherUids }, `自动寻找咸臣结果${chunks.length > 1 ? `（${i + 1}/${chunks.length}）` : ''}`, chunks[i], 2);
    }
  };
  const finishFeudatoryBatch = async results => {
    const executorTokenId = batchSettings.feudatoryRescueTokenId;
    if (executorTokenId && results.length && !shouldStop.value) {
      let ownsSlot = false;
      try {
        if (!tokens.value.some(t => t.id === executorTokenId)) throw new Error('解救执行账号已不在账号清单中');
        currentRunningTokenId.value = executorTokenId;
        await ensureConnection(executorTokenId, 2, acquired => { ownsSlot = acquired; });
        const send = (cmd, params) => {
          if (tokenStore.getWebSocketStatus(executorTokenId) !== 'connected') throw new Error('解救执行账号连接已断开');
          return tokenStore.sendMessageWithPromise(executorTokenId, cmd, params, 15000);
        };
        const config = await (deps.loadFeudatoryConfig || loadSignupCheerConfig)(send);
        for (const row of results) row.roleId ??= tokens.value.find(t => t.id === row.tokenId)?.roleId;
        await rescueSelectedFeudatory({rows:results,send,config,battleVersion:tokenStore.getBattleVersion(),shouldStop:()=>shouldStop.value,
          wait:()=>wait(Math.max(500, Number(batchSettings.commandDelay) || 0)),log,
          onReleased: ({roleId,targetId}) => {
            try {
              const storage = deps.storage || globalThis.localStorage, key = `xyzw-feudatory-history-v1:${roleId}`;
              const history = JSON.parse(storage.getItem(key) || '{}'); delete history[targetId]; storage.setItem(key, JSON.stringify(history));
            } catch (error) { log(`解救观察记录清理失败：${error.message}`, 'warning'); }
          },
        });
      } catch (error) {
        log(`咸臣解救收尾停止：${error.message}`, 'warning');
        for (const row of results) row.rescueResult ||= `未解救：${error.message}`;
      } finally {
        if (ownsSlot) { try { tokenStore.closeWebSocketConnection(executorTokenId); } finally { releaseConnectionSlot(); } }
        currentRunningTokenId.value = null;
      }
    }
    for (const row of results) {
      if (row.rescueResult?.startsWith('未解救')) {
        log(`${row.name}：${row.rescueResult}`, 'warning');
        if (tokenStatus.value[row.tokenId] === 'completed') tokenStatus.value[row.tokenId] = 'pending';
      }
    }
    await pushFeudatoryInfo(results);
    return results;
  };
  const resolveOwnRoleIds = async selectedIds => {
    const own = new Set();
    // 仅保护本次勾选账号；未知身份先只读查询，不能漏掉后继续抓取。
    for (const selectedId of selectedIds) {
      const token = tokens.value.find(item => item.id === selectedId);
      if (!token) throw new Error(`所选账号${selectedId}已不在清单中`);
      if (shouldStop.value) throw new Error('用户已停止');
      let roleId = Number(token.roleId);
      if (!Number.isSafeInteger(roleId) || roleId <= 0) {
        let ownsSlot = false;
        try {
          log(`正在确认账号身份：${token.name || token.id}`);
          await ensureConnection(token.id, 2, acquired => { ownsSlot = acquired; }, { readOnly: true });
          if (shouldStop.value) throw new Error('用户已停止');
          const response = await tokenStore.sendMessageWithPromise(token.id, 'role_getroleinfo', {}, 15000);
          roleId = extractRolePatch(response)?.roleId;
          if (!Number.isSafeInteger(roleId) || roleId <= 0) throw new Error('角色ID不完整');
          tokenStore.updateToken?.(token.id, { roleId });
        } catch (error) { throw new Error(`无法确认所选账号${token.name || token.id}的身份：${error.message}`); }
        finally { if (ownsSlot) { try { tokenStore.closeWebSocketConnection(token.id); } finally { releaseConnectionSlot(); } } }
      }
      own.add(String(roleId));
    }
    return own;
  };
  const batchAutoFeudatory = async (options = {}) => {
    const ids = [...selectedTokens.value], results = [];
    if (!ids.length) return results;
    isRunning.value = true; shouldStop.value = false;
    ids.forEach(id => { tokenStatus.value[id] = 'waiting'; });
    try {
      let excludedRoleIds;
      try { excludedRoleIds = await resolveOwnRoleIds(options.protectedTokenIds || ids); }
      catch (error) {
        log(`自动寻找咸臣未开始：${error.message}`, 'error');
        ids.forEach(id => { tokenStatus.value[id] = shouldStop.value ? 'stopped' : 'failed'; });
        return results;
      }
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(t => t.id === id)?.name || id;
        let ownsSlot = false;
        currentRunningTokenId.value = id; tokenStatus.value[id] = 'running';
        try {
          await ensureConnection(id, 2, acquired => { ownsSlot = acquired; });
          const send = (cmd, params) => {
            if (shouldStop.value) throw new Error('用户已停止');
            if (tokenStore.getWebSocketStatus(id) !== 'connected') throw new Error('连接已断开');
            return tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
          };
          const config = await (deps.loadFeudatoryConfig || loadSignupCheerConfig)(send);
          // 持久化按角色ID隔离，token重导入也能保留观察记录；读取失败不进行释放。
          const response = await send('role_getroleinfo', {});
          const role = extractRolePatch(response);
          if (!Number.isSafeInteger(role?.roleId) || role.roleId <= 0) throw new Error('角色ID不完整');
          const storage = deps.storage || globalThis.localStorage;
          const key = `xyzw-feudatory-history-v1:${role.roleId}`;
          const history = JSON.parse(storage.getItem(key) || '{}');
          if (!history || typeof history !== 'object' || Array.isArray(history)) throw new Error('咸臣观察记录损坏');
          const result = await runAutoFeudatory({ send, config, excludedRoleIds, battleVersion: tokenStore.getBattleVersion(), history,
            saveHistory: value => storage.setItem(key, JSON.stringify(value)),
            shouldStop: () => shouldStop.value,
            wait: () => wait(Math.max(500, Number(batchSettings.commandDelay) || 0)),
            log: text => log(`${name}：${text}`),
          });
          results.push({ tokenId: id, name, ...result });
          tokenStatus.value[id] = shouldStop.value ? 'stopped' : result.error ? 'failed' : 'completed';
          log(`${name} 自动寻找咸臣结束：${result.reason}${result.error ? `，${result.error}` : ''}`, result.error ? 'warning' : 'info');
        } catch (error) {
          results.push({ tokenId: id, name, reason: shouldStop.value ? '已停止' : '异常停止', error: error.message, snapshotKnown: false, members: [], actions: [] });
          tokenStatus.value[id] = shouldStop.value ? 'stopped' : 'failed';
          log(`${name} 自动寻找咸臣停止：${error.message}`, 'error');
        } finally {
          if (ownsSlot) { try { tokenStore.closeWebSocketConnection(id); } finally { releaseConnectionSlot(); } }
        }
      }
      if (!options.deferPush) {
        try { await finishFeudatoryBatch(results); }
        catch (error) { log(`咸臣报表推送失败：${error.message}`, 'error'); }
      }
    } finally {
      ids.forEach(id => { if (tokenStatus.value[id] === 'waiting') tokenStatus.value[id] = 'stopped'; });
      isRunning.value = false; currentRunningTokenId.value = null;
    }
    return results;
  };
  return { finishFeudatoryBatch, batchReleaseFeudatory, pushFeudatoryInfo, batchAutoFeudatory, batchCheckSaltMasters, pushSaltMasterInfo };
}
