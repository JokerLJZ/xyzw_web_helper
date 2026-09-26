<template>
  <div class="multi-game-page">
    <header class="multi-game-toolbar">
      <button class="toolbar-button" type="button" @click="goToTokens">
        ← 返回 Token 管理
      </button>
      <strong>批量游戏</strong>
      <span class="toolbar-count">{{ frames.length }} 个窗口</span>
      <label class="sync-leader-label">
        主窗口
        <select v-model="syncLeaderScope" :disabled="syncEnabled">
          <option v-for="frame in frames" :key="frame.scopeId" :value="frame.scopeId">
            {{ frame.name }}
          </option>
        </select>
      </label>
      <button
        type="button"
        class="sync-toggle"
        :class="{ active: syncEnabled }"
        :disabled="frames.length < 2"
        @click="toggleSync"
      >
        {{ syncEnabled ? "停止同步" : "同步操作" }}
      </button>
      <span v-if="skippedSummary" class="toolbar-skipped" :title="skippedDetails">
        {{ skippedSummary }}
      </span>
      <span class="toolbar-warning">窗口可横向滚动；按住 Ctrl + 滚轮可缩放页面</span>
    </header>

    <main v-if="frames.length" ref="gameStrip" class="game-strip" @wheel="handleStripWheel">
      <article
        v-for="frame in frames"
        :key="frame.scopeId"
        class="game-panel"
        :style="{ order: frame.order }"
      >
        <header class="game-panel-header">
          <span class="account-name" :title="frame.name">{{ frame.name }}</span>
          <span class="frame-status" :class="`is-${frameStates[frame.scopeId]?.status || 'loading'}`">
            {{ statusLabel(frame.scopeId) }}
          </span>
          <button type="button" :disabled="!canMoveFrame(frame.scopeId, -1)" @click="moveFrame(frame.scopeId, -1)">←</button>
          <button type="button" :disabled="!canMoveFrame(frame.scopeId, 1)" @click="moveFrame(frame.scopeId, 1)">→</button>
          <button type="button" @click="reloadFrame(frame.scopeId)">重载</button>
          <button type="button" @click="closeFrame(frame)">关闭</button>
        </header>
        <div class="game-frame-shell">
          <iframe
            :key="`${frame.scopeId}:${frameStates[frame.scopeId].revision}`"
            :ref="(element) => setFrameElement(frame.scopeId, element)"
            :src="frame.src"
            :title="`${frame.name} 的游戏窗口`"
            class="game-frame"
            allow="fullscreen; autoplay"
            @error="markFrameFatal(frame.scopeId)"
          />
          <div v-if="frameStates[frame.scopeId]?.status === 'fatal'" class="frame-error">
            <strong>该账号加载失败</strong>
            <span>其他窗口不受影响</span>
            <button type="button" @click="reloadFrame(frame.scopeId)">重试</button>
          </div>
        </div>
      </article>
    </main>
    <main v-else class="empty-state">
      <div class="empty-card">
        <h1>还没有待打开的游戏账号</h1>
        <p>请先到 Token 管理页面勾选账号，再使用“批量进入游戏”。</p>
        <button type="button" @click="goToTokens">前往 Token 管理</button>
      </div>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeMount, onMounted, onUnmounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import {
  buildMultiGameFrameSrc,
  closeMultiGameSession,
  moveMultiGameSession,
  readActiveMultiGameLaunch,
  resolveMultiGameFrameMessage,
} from "@/utils/gameLauncher";
import {
  postMultiGameInputMessage,
  resolveMultiGameInputMessage,
} from "@/utils/multiGameSync";

const router = useRouter();
const FRAME_LOAD_TIMEOUT_MS = 45_000;
const gameStrip = ref(null);
const launch = ref(readLaunchSafely());
const frameDomOrder = (launch.value?.sessions || []).map((session) => session.scopeId);
const syncLeaderScope = ref(frameDomOrder[0] || "");
const syncEnabled = ref(false);
const frames = computed(() => {
  const sessions = new Map((launch.value?.sessions || []).map((session) => [session.scopeId, session]));
  return frameDomOrder
    .map((scopeId) => sessions.get(scopeId))
    .filter(Boolean)
    .map((session) => ({ ...session, src: buildMultiGameFrameSrc(import.meta.env.BASE_URL, session) }));
});
const frameElements = new Map();
const frameTimeouts = new Map();
const frameStates = reactive(Object.fromEntries(
  frames.value.map((frame) => [frame.scopeId, { status: "loading", revision: 0 }]),
));
let scrollTarget = 0;
let scrollAnimation = 0;

const skippedDetails = computed(() => (launch.value?.failures || [])
  .map((failure) => `${failure.name}（${failureReason(failure.reason)}）`).join("、"));
const skippedSummary = computed(() => {
  const failures = launch.value?.failures || [];
  if (!failures.length) return "";
  const names = failures.slice(0, 2).map((failure) => failure.name).join("、");
  return `已跳过 ${failures.length} 个账号：${names}${failures.length > 2 ? "…" : ""}`;
});

function readLaunchSafely() {
  try {
    return readActiveMultiGameLaunch(window.sessionStorage);
  } catch {
    return null;
  }
}

function failureReason(reason) {
  return { "missing-bin": "缺少 BIN 数据", "read-failed": "读取 BIN 失败", "convert-failed": "转换 BIN 失败" }[reason] || "准备失败";
}

function statusLabel(scopeId) {
  return { loading: "加载中", ready: "已启动", fatal: "加载失败" }[frameStates[scopeId]?.status || "loading"];
}

function setFrameElement(scopeId, element) {
  if (element) frameElements.set(scopeId, element);
  else frameElements.delete(scopeId);
}

function clearFrameTimeout(scopeId) {
  const timeout = frameTimeouts.get(scopeId);
  if (timeout !== undefined) window.clearTimeout(timeout);
  frameTimeouts.delete(scopeId);
}

function armFrameTimeout(scopeId) {
  clearFrameTimeout(scopeId);
  const state = frameStates[scopeId];
  if (!state || state.status !== "loading") return;
  const revision = state.revision;
  frameTimeouts.set(scopeId, window.setTimeout(() => {
    if (frameStates[scopeId]?.status === "loading" && frameStates[scopeId]?.revision === revision) {
      frameStates[scopeId].status = "fatal";
    }
    frameTimeouts.delete(scopeId);
  }, FRAME_LOAD_TIMEOUT_MS));
}

function markFrameFatal(scopeId) {
  clearFrameTimeout(scopeId);
  if (frameStates[scopeId]) frameStates[scopeId].status = "fatal";
}

function reloadFrame(scopeId) {
  const state = frameStates[scopeId];
  if (!state) return;
  frameElements.delete(scopeId);
  state.status = "loading";
  state.revision += 1;
  armFrameTimeout(scopeId);
}

function canMoveFrame(scopeId, direction) {
  const sessions = launch.value?.sessions || [];
  const index = sessions.findIndex((session) => session.scopeId === scopeId);
  return index >= 0 && index + direction >= 0 && index + direction < sessions.length;
}

async function moveFrame(scopeId, direction) {
  const strip = gameStrip.value;
  const before = strip?.scrollLeft || 0;
  try {
    const updated = moveMultiGameSession({ scopeId, direction, sessionStorage: window.sessionStorage });
    if (!updated) return;
    launch.value = updated;
    await nextTick();
    if (strip) strip.scrollLeft = before;
  } catch {
    window.alert("移动游戏窗口失败，请重试");
  }
}

function closeFrame(frame) {
  try {
    launch.value = closeMultiGameSession({
      scopeId: frame.scopeId,
      localStorage: window.localStorage,
      sessionStorage: window.sessionStorage,
    });
    clearFrameTimeout(frame.scopeId);
    frameElements.delete(frame.scopeId);
    delete frameStates[frame.scopeId];
    if (syncLeaderScope.value === frame.scopeId) {
      syncLeaderScope.value = frames.value[0]?.scopeId || "";
    }
    if (frames.value.length < 2) syncEnabled.value = false;
  } catch {
    window.alert("关闭游戏窗口失败，请重试");
  }
}

function toggleSync() {
  if (syncEnabled.value) {
    syncEnabled.value = false;
    return;
  }
  if (frames.value.length < 2 || !syncLeaderScope.value) return;
  syncEnabled.value = true;
}

function handleMessage(event) {
  const input = resolveMultiGameInputMessage({
    event,
    expectedOrigin: window.location.origin,
    frames: frames.value,
    frameElements,
    enabled: syncEnabled.value,
    leaderScopeId: syncLeaderScope.value,
  });
  if (input) {
    for (const frame of frames.value) {
      if (frame.scopeId === input.sourceScopeId) continue;
      postMultiGameInputMessage(
        frameElements.get(frame.scopeId),
        input.message,
        window.location.origin,
      );
    }
    return;
  }

  const result = resolveMultiGameFrameMessage({
    event,
    expectedOrigin: window.location.origin,
    frames: frames.value,
    frameElements,
  });
  if (result && frameStates[result.scopeId]) {
    clearFrameTimeout(result.scopeId);
    frameStates[result.scopeId].status = result.status;
  }
}

function handleStripWheel(event) {
  const strip = gameStrip.value;
  if (!strip || event.ctrlKey || event.metaKey || !event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
  const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
  scrollTarget = Math.min(max, Math.max(0, (scrollAnimation ? scrollTarget : strip.scrollLeft) + event.deltaY));
  event.preventDefault();
  if (!scrollAnimation) {
    const animate = () => {
      const distance = scrollTarget - strip.scrollLeft;
      if (Math.abs(distance) <= 0.5) { strip.scrollLeft = scrollTarget; scrollAnimation = 0; return; }
      strip.scrollLeft += distance * 0.24;
      scrollAnimation = window.requestAnimationFrame(animate);
    };
    scrollAnimation = window.requestAnimationFrame(animate);
  }
}

function goToTokens() {
  router.push("/tokens");
}

onBeforeMount(() => window.addEventListener("message", handleMessage));
onMounted(() => frames.value.forEach((frame) => armFrameTimeout(frame.scopeId)));
onUnmounted(() => {
  window.removeEventListener("message", handleMessage);
  if (scrollAnimation) window.cancelAnimationFrame(scrollAnimation);
  for (const scopeId of frameTimeouts.keys()) clearFrameTimeout(scopeId);
});
</script>

<style scoped>
.multi-game-page { position: fixed; inset: 0; z-index: 1000; color: #e5e7eb; background: #080b12; }
.multi-game-toolbar { box-sizing: border-box; display: flex; align-items: center; gap: 12px; height: 52px; padding: 8px 12px; overflow-x: auto; white-space: nowrap; border-bottom: 1px solid #273244; background: #111827; }
.toolbar-button, .game-panel-header button, .empty-card button, .frame-error button { border: 1px solid #475569; border-radius: 6px; color: #f8fafc; background: #1e293b; cursor: pointer; }
.toolbar-button, .empty-card button, .frame-error button { padding: 7px 11px; }
.toolbar-count { color: #93c5fd; }
.sync-leader-label { display: inline-flex; align-items: center; gap: 5px; color: #cbd5e1; font-size: 12px; }.sync-leader-label select { max-width: 130px; padding: 3px 5px; color: #f8fafc; border: 1px solid #475569; border-radius: 5px; background: #1e293b; }.sync-toggle { padding: 5px 8px; border: 1px solid #64748b; border-radius: 6px; color: #e2e8f0; background: #1e293b; cursor: pointer; }.sync-toggle.active { color: #052e16; border-color: #4ade80; background: #86efac; }.sync-toggle:disabled { cursor: not-allowed; opacity: .45; }
.toolbar-skipped { color: #fbbf24; }
.toolbar-warning { margin-left: auto; color: #94a3b8; font-size: 12px; }
.game-strip { box-sizing: border-box; display: flex; align-items: flex-start; flex-flow: row nowrap; gap: 12px; height: calc(100dvh - 52px); padding: 12px; overflow-x: auto; overflow-y: hidden; }
.game-panel { box-sizing: border-box; flex: 0 0 min(clamp(360px, 32vw, 480px), calc((100dvh - 112px) * 9 / 16)); min-width: 0; height: auto; overflow: hidden; border: 1px solid #334155; border-radius: 8px; background: #000; box-shadow: 0 10px 28px rgb(0 0 0 / 35%); }
.game-panel-header { box-sizing: border-box; display: flex; align-items: center; gap: 6px; height: 36px; padding: 4px 8px; background: #172033; }
.account-name { min-width: 0; overflow: hidden; color: #f8fafc; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.frame-status { flex: none; margin-left: auto; font-size: 12px; }.is-loading { color: #fbbf24; }.is-ready { color: #4ade80; }.is-fatal { color: #f87171; }
.game-panel-header button { padding: 3px 6px; font-size: 12px; }.game-panel-header button:disabled { cursor: not-allowed; opacity: .45; }
.game-frame-shell { position: relative; width: 100%; aspect-ratio: 9 / 16; background: #000; }.game-frame { display: block; width: 100%; height: 100%; border: 0; }.frame-error { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 10px; flex-direction: column; color: #fecaca; background: rgb(15 23 42 / 95%); }.empty-state { display: grid; place-items: center; height: calc(100dvh - 52px); }.empty-card { padding: 28px; text-align: center; border: 1px solid #334155; border-radius: 10px; background: #111827; }.empty-card p { color: #94a3b8; }
</style>
