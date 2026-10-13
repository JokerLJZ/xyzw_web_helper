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
  return { batchCheckSaltMasters, pushSaltMasterInfo };
}
