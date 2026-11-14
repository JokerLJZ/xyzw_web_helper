import { ref } from "vue";
import { loadRechargeConfig } from "../rechargeActivity.js";
import { openSaltWarSession, saltBody } from "../saltWarSession.js";
import { saltInfo, saltSettings, previewSaltBattle, runSaltBattle } from "../saltWarRunner.js";
import { saltMapSpec } from "../saltWarMap.js";
const activeAccounts = new Set();
let dedicatedConnections = 0;
export function createTasksSaltBattle(deps, overrides = {}) {
  const previews = ref([]), showPreview = ref(false);
  const { selectedTokens, tokens, tokenStatus, isRunning, shouldStop, currentRunningTokenId, tokenStore, ensureConnection, releaseConnectionSlot, addLog, message, batchSettings } = deps;
  const log = (name, text, type = "info") => addLog({ time: new Date().toLocaleTimeString(), message: `${name}：${text}`, type });
  const withLock = async (id, callback) => {
    if (activeAccounts.has(id)) throw new Error("该账号已有盐场任务正在执行");
    activeAccounts.add(id);
    try {
      if (globalThis.navigator?.locks?.request) return await navigator.locks.request(`xyzw:salt:${id}`, { ifAvailable: true }, lock => { if (!lock) throw new Error("该账号在其他页面执行盐场任务"); return callback(); });
      return await callback();
    } finally { activeAccounts.delete(id); }
  };
  async function batch(preview, supplied = {}) {
    const scheduled = deps.isScheduled?.() || false;
    if ((isRunning.value && !scheduled) || !selectedTokens.value.length) return;
    let settings;
    try { settings = saltSettings({ ...batchSettings.saltBattle, ...supplied }); }
    catch (error) { if (scheduled) throw error; message.warning(error.message); return; }
    const ids = [...selectedTokens.value];
    if (preview) { previews.value = []; showPreview.value = false; }
    isRunning.value = true;
    if (!scheduled) shouldStop.value = false;
    ids.forEach(id => tokenStatus.value[id] = "waiting");
    let failed = 0;
    try {
      for (const id of ids) {
        if (shouldStop.value) break;
        const name = tokens.value.find(t => t.id === id)?.name || id;
        let session, owned = false, connected = false, reservedDedicated = false;
        currentRunningTokenId.value = id; tokenStatus.value[id] = "running";
        try {
          await withLock(id, async () => {
            await ensureConnection(id, 2, ownsSlot => { owned = ownsSlot; });
            connected = true;
            const primaryClient = tokenStore.getWebSocketClient(id);
            const now = () => primaryClient?.getServerTime?.() ?? Date.now();
            const send = async (cmd, params = {}) => {
              if (shouldStop.value) throw new Error("盐场任务已停止");
              return tokenStore.sendMessageWithPromise(id, cmd, params, 15000);
            };
            const info = saltInfo(await send("legion_getbattlefield"), now());
            const config = await (overrides.loadConfig || loadRechargeConfig)(send);
            saltMapSpec(info, config); // Reject unsupported modes before connecting or writing.
            const role = saltBody(await send("role_getroleinfo"))?.role;
            if (!role?.roleId) throw new Error("角色身份未取得");
            if (info.sid) {
              const primaryCount = Object.values(tokenStore.wsConnections || {}).filter(c => ["connected", "connecting"].includes(c.status)).length;
              if (primaryCount + dedicatedConnections >= 10 || dedicatedConnections >= 1) throw new Error("盐场专服连接槽位不足，请稍后重试");
              dedicatedConnections++; reservedDedicated = true;
            }
            session = await (overrides.openSession || openSaltWarSession)({ primaryClient, info, mainSend: send, shouldStop: () => shouldStop.value, now });
            try {
              await session.enter(role.roleId, role);
              const context = { accountId: id, session, info, config, role, send, now, settings, shouldStop: () => shouldStop.value, log: text => log(name, text), ...overrides.runnerOptions };
              if (preview) {
                previews.value.push({ tokenId: id, name, ...await (overrides.preview || previewSaltBattle)(context) });
                tokenStatus.value[id] = "completed";
                log(name, "盐场预览完成，未布阵、加速或攻击");
              } else {
                const result = await (overrides.run || runSaltBattle)(context);
                tokenStatus.value[id] = result.status;
                if (result.reason) log(name, result.reason, result.status === "pending" ? "warning" : "info");
              }
            } finally { session.close(); session = null; }
          });
        } catch (error) {
          failed++; tokenStatus.value[id] = shouldStop.value ? "skipped" : "failed";
          log(name, error.message, shouldStop.value ? "warning" : "error");
          if (preview) previews.value.push({ tokenId: id, name, reason: error.message });
        } finally {
          session?.close();
          if (reservedDedicated) dedicatedConnections--;
          if (owned && connected && !deps.isScheduledSession?.(id)) { try { tokenStore.closeWebSocketConnection(id); } finally { releaseConnectionSlot(); } }
        }
      }
    } finally {
      for (const id of ids) if (tokenStatus.value[id] === "waiting") tokenStatus.value[id] = "skipped";
      if (!scheduled) { isRunning.value = false; currentRunningTokenId.value = null; }
    }
    if (preview && !shouldStop.value) showPreview.value = true;
    if (!scheduled) {
      if (shouldStop.value) message.info("盐场任务已停止");
      else if (failed) message.warning(`盐场处理结束，${failed}个账号未完成，请查看日志`);
      else message.success(preview ? "盐场预览完成" : "盐场处理结束");
    }
  }
  return { saltBattlePreviews: previews, saltBattlePreviewOpen: showPreview, previewSaltBattle: () => batch(true), batchSaltBattle: options => batch(false, options) };
}
