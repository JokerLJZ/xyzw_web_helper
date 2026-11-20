<template>
  <div class="island-panel">
    <div class="ip-toolbar">
      <n-space size="small" align="center">
        <n-tag v-if="islandLabel" size="small" type="warning" :bordered="false">
          当前所在：{{ islandLabel }}
        </n-tag>
        <span v-if="lastLoadAt" class="ip-dim">更新于 {{ lastLoadAt }}</span>
      </n-space>
      <n-space size="small">
        <n-switch v-model:value="autoRefresh" size="small">
          <template #checked>自动 60s</template>
          <template #unchecked>手动</template>
        </n-switch>
        <n-button size="small" secondary :loading="loading" @click="load">
          <template #icon><n-icon><Refresh /></n-icon></template>
          立即查询
        </n-button>
      </n-space>
    </div>

    <div v-if="loading && !groupSelf" class="ip-state">
      <n-spin size="small" />
      <span>正在查询盐场小组积分…</span>
    </div>
    <n-empty
      v-else-if="!groupSelf"
      description="暂无盐场小组积分"
      size="large"
      style="padding: 28px 0"
    >
      <template #extra><span class="ip-dim">{{ emptyHint }}</span></template>
    </n-empty>

    <template v-else>
      <div class="ip-island">
        <div class="ip-island-name">
          {{ islandLabel }}
          <n-tag v-if="mapLabel" size="tiny" type="warning" :bordered="false">
            {{ mapLabel }}
          </n-tag>
        </div>
        <n-grid x-gap="10" y-gap="10" cols="3" class="ip-stats">
          <n-gi>
            <div class="ip-stat">
              <span class="ip-stat-label">小组排名</span>
              <span class="ip-stat-value">
                {{ groupSelf.rank }}<span class="ip-dim"> / {{ fmtNum(groupTotal) }}</span>
              </span>
            </div>
          </n-gi>
          <n-gi>
            <div class="ip-stat">
              <span class="ip-stat-label">本岛总榜</span>
              <span class="ip-stat-value">
                {{ selfTotal?.rank ?? "-" }}<span class="ip-dim"> / {{ fmtNum(rankCnt) }}</span>
              </span>
            </div>
          </n-gi>
          <n-gi>
            <div class="ip-stat">
              <span class="ip-stat-label">盐场积分</span>
              <span class="ip-stat-value ip-hot">{{ fmtNum(groupSelf.score) }}</span>
            </div>
          </n-gi>
        </n-grid>
      </div>

      <div class="ip-section-title">所有岛屿</div>
      <div class="ip-ladder">
        <div
          v-for="island in islandLadder"
          :key="island.type"
          class="ip-ladder-row"
          :class="{
            'ip-ladder-now': island.type === islandType,
            'ip-ladder-dim': island.type > islandType,
          }"
        >
          <div class="ip-ladder-head">
            <span class="ip-ladder-name">{{ island.name }}</span>
            <n-tag
              v-if="island.type === islandType"
              size="tiny"
              type="warning"
              :bordered="false"
            >
              当前
            </n-tag>
            <span v-else class="ip-dim ip-ladder-tip">
              {{ island.type < islandType ? "已晋升" : "未解锁" }}
            </span>
          </div>
          <div class="ip-ladder-quota">{{ island.quota }}</div>
        </div>
      </div>

      <div class="ip-section-title">小组积分榜 · {{ boardRows.length }} 条</div>
      <n-empty
        v-if="!boardRows.length"
        description="该榜暂无数据"
        size="small"
        style="padding: 16px 0"
      />
      <div v-else class="ip-rank">
        <div
          v-for="item in boardRows"
          :key="item.rowKey"
          class="ip-row"
          :class="{ 'ip-row-me': isMe(item) }"
        >
          <span class="ip-rk" :class="rankClass(item.seq)">{{ item.seq }}</span>
          <span class="ip-nm">{{ item.name }}</span>
          <span class="ip-sc">{{ fmtNum(item.score) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NButton,
  NEmpty,
  NGi,
  NGrid,
  NIcon,
  NSpace,
  NSpin,
  NSwitch,
  NTag,
  useMessage,
} from "naive-ui";
import { Refresh } from "@vicons/ionicons5";
import { useTokenStore } from "@/stores/tokenStore";
import { getRankQueryDate } from "@/utils/clubBattleUtils";

const TOP_LIMIT = 1000;
const TOTAL_PROBE_RANGE = 3;

const islandLadder = [
  { type: 1, name: "灰盐岛", quota: "起始 2000 支 · 月晋级 1040" },
  { type: 2, name: "青铜岛", quota: "月晋级 344 · 保级 240 · 降级 616" },
  { type: 3, name: "秘蓝岛", quota: "晋级天宫 64 · 晋级月宫 160 · 保级 196 · 降级 120" },
  { type: 4, name: "紫青月宫", quota: "月降级 160" },
  { type: 5, name: "黄金天宫", quota: "淘汰赛：胜者赛 / 败者赛 / 决赛" },
];
const ISLAND_NAMES = Object.fromEntries(islandLadder.map((item) => [item.type, item.name]));
const MAP_NAMES = {
  13: "灰盐岛周赛",
  14: "灰盐岛进阶赛",
  15: "灰盐岛月赛",
  16: "青铜岛周赛",
  17: "青铜岛月赛",
  18: "秘蓝岛周赛",
  19: "秘蓝岛月赛",
  20: "月宫周赛",
  21: "月宫月赛",
  22: "天宫胜者赛",
  23: "天宫败者赛",
  24: "天宫决赛",
  25: "青龙试炼",
  26: "白虎试炼",
  27: "朱雀试炼",
  28: "玄武试炼",
};

const ymdToYymmdd = (value) => {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(String(value || "").trim());
  return match ? match[1].slice(2) + match[2] + match[3] : "";
};

const tokenStore = useTokenStore();
const message = useMessage();
const loading = ref(false);
const islandType = ref(-1);
const mapType = ref(0);
const weekDate = ref("");
const groupResp = ref(null);
const totalResp = ref(null);
const rows = ref([]);
const lastLoadAt = ref("");
const autoRefresh = ref(false);
let timer = null;

const islandLabel = computed(() =>
  islandType.value > 0
    ? ISLAND_NAMES[islandType.value] || `未知岛屿(${islandType.value})`
    : "",
);
const mapLabel = computed(() =>
  mapType.value ? MAP_NAMES[mapType.value] || `赛制 ${mapType.value}` : "",
);
const groupSelf = computed(() => groupResp.value?.selfRankInfo || null);
const selfTotal = computed(() => totalResp.value?.selfRankInfo || null);
const rankCnt = computed(() => Number(totalResp.value?.rankCnt || 0));
const groupTotal = computed(() =>
  Number(groupResp.value?.rankCnt || 0) || groupResp.value?.legionList?.length || 0,
);
const emptyHint = computed(() =>
  tokenStore.selectedToken ? "可能未报名盐场，或当前小组无数据" : "请先在左侧选择游戏角色",
);
const myLegionIds = computed(() => {
  const ids = new Set();
  if (groupSelf.value?.id != null) ids.add(Number(groupSelf.value.id));
  return ids;
});
const boardRows = computed(() => {
  const list = [...rows.value];
  const mine = groupSelf.value;
  if (mine && !list.some((row) => Number(row.id) === Number(mine.id))) list.push(mine);
  return list.map((row, index) => ({
    ...row,
    rowKey: String(row.id ?? row.rank ?? row.name ?? index),
    seq: index + 1,
  }));
});

const fmtNum = (value) => {
  if (value == null || value === "") return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number >= 1e8) return `${(number / 1e8).toFixed(2)}亿`;
  if (number >= 1e4) return `${(number / 1e4).toFixed(1)}万`;
  return String(Math.round(number * 10) / 10);
};
const rankClass = (rank) => {
  if (Number(rank) <= 3) return "ip-rk-top";
  if (Number(rank) <= 10) return "ip-rk-ten";
  return "";
};
const isMe = (item) => item.id != null && myLegionIds.value.has(Number(item.id));

const clearData = () => {
  groupResp.value = null;
  totalResp.value = null;
  rows.value = [];
};

async function load() {
  const token = tokenStore.selectedToken;
  if (!token) return;
  const status = tokenStore.getWebSocketStatus?.(token.id);
  if (status && status !== "connected") return;

  loading.value = true;
  try {
    const legion = await tokenStore.sendMessageWithPromise(
      token.id,
      "legion_getinfo",
      {},
      15000,
    );
    const nextIslandType = Number(legion?.islandType ?? -1);
    if (nextIslandType < 0) {
      islandType.value = -1;
      clearData();
      return;
    }

    islandType.value = nextIslandType;
    mapType.value = Number(legion?.emLegionWarMap || 0);
    const mapList = Array.isArray(legion?.mapList) ? legion.mapList : [];
    weekDate.value = ymdToYymmdd(mapList.at(-1)?.warDate);
    if (!weekDate.value) {
      clearData();
      return;
    }

    const [group, total] = await Promise.all([
      tokenStore.sendMessageWithPromise(
        token.id,
        "saltroad_getsaltroadwargrouprank",
        { date: weekDate.value, startRank: 1, endRank: TOP_LIMIT },
        20000,
      ),
      tokenStore.sendMessageWithPromise(
        token.id,
        "saltroad_getsaltroadwartotalrank",
        { date: getRankQueryDate(), startRank: 1, endRank: TOTAL_PROBE_RANGE },
        20000,
      ),
    ]);
    groupResp.value = group || null;
    totalResp.value = total || null;
    rows.value = group?.legionList || [];
    lastLoadAt.value = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  } catch (error) {
    console.error("盐场小组积分加载失败:", error);
    if (!groupSelf.value) message.error(`读取盐场小组积分失败: ${error?.message || error}`);
  } finally {
    loading.value = false;
  }
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

watch(autoRefresh, (enabled) => {
  stopTimer();
  if (enabled) timer = setInterval(load, 60000);
});
watch(() => tokenStore.selectedToken?.id, load);
onMounted(load);
onUnmounted(stopTimer);
</script>

<style scoped>
.island-panel {
  border: 1px solid var(--n-border-color, rgba(127, 127, 127, 0.18));
  border-radius: 12px;
  padding: 14px;
  background: var(--n-color-modal, rgba(127, 127, 127, 0.04));
}
.ip-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.ip-dim { font-size: 12px; opacity: 0.55; }
.ip-section-title { font-size: 13px; font-weight: 500; margin: 14px 0 8px; opacity: 0.85; }
.ip-state { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 24px 0; font-size: 13px; opacity: 0.7; }
.ip-island { border: 1px solid rgba(240, 160, 32, 0.35); border-radius: 10px; padding: 12px; background: rgba(240, 160, 32, 0.06); }
.ip-island-name { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 500; margin-bottom: 12px; }
.ip-stat { display: flex; flex-direction: column; gap: 2px; }
.ip-stat-label { font-size: 12px; opacity: 0.6; }
.ip-stat-value { font-size: 18px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1.3; }
.ip-hot, .ip-sc { color: #d03050; }
.ip-ladder, .ip-rank { display: flex; flex-direction: column; gap: 4px; }
.ip-ladder-row { display: flex; flex-direction: column; gap: 3px; padding: 7px 10px; border: 1px solid var(--n-border-color, rgba(127, 127, 127, 0.2)); border-radius: 8px; font-size: 13px; }
.ip-ladder-head { display: flex; align-items: center; gap: 6px; }
.ip-ladder-quota { font-size: 12px; opacity: 0.65; line-height: 1.45; }
.ip-ladder-now { border-color: #f0a020; background: rgba(240, 160, 32, 0.12); }
.ip-ladder-dim { opacity: 0.45; }
.ip-ladder-name { font-weight: 500; }
.ip-ladder-tip { font-size: 12px; }
.ip-rank { gap: 2px; }
.ip-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; font-size: 13px; }
.ip-row-me { background: rgba(240, 160, 32, 0.14); }
.ip-rk { width: 40px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; opacity: 0.75; flex-shrink: 0; }
.ip-rk-top { color: #d03050; font-weight: 500; }
.ip-rk-ten { color: #f0a020; font-weight: 500; }
.ip-nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ip-sc { width: 62px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
