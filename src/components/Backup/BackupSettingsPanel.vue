<template>
  <n-card title="自动备份（WebDAV）" size="small" class="backup-panel">
    <n-space vertical :size="16">
      <n-alert type="warning" :show-icon="true" title="敏感数据提醒">
        备份内容包含完整 token
        明文，仅会上传至你自己填写的 WebDAV 服务器。建议使用专属应用密码，并确保
        WebDAV 服务允许浏览器跨域访问（CORS）。
      </n-alert>

      <n-form
        label-placement="left"
        label-width="120"
        :model="config"
        size="small"
      >
        <n-form-item label="启用自动备份">
          <n-switch v-model:value="config.enabled" :disabled="!isConfigured" />
          <span v-if="!isConfigured" class="hint">
            需要先填写并测试 WebDAV 配置
          </span>
        </n-form-item>

        <n-form-item label="WebDAV URL">
          <n-input
            v-model:value="config.webdav.baseUrl"
            placeholder="https://dav.jianguoyun.com/dav/"
          />
        </n-form-item>
        <n-form-item label="用户名">
          <n-input
            v-model:value="config.webdav.username"
            placeholder="WebDAV 账号"
          />
        </n-form-item>
        <n-form-item label="密码 / 应用密码">
          <n-input
            v-model:value="config.webdav.password"
            type="password"
            show-password-on="click"
            placeholder="建议使用应用专属密码"
          />
        </n-form-item>
        <n-form-item label="备份目录">
          <n-input
            v-model:value="config.webdav.basePath"
            placeholder="/xyzw-backup/"
          />
        </n-form-item>

        <n-form-item label="备份间隔">
          <n-select
            v-model:value="config.intervalMinutes"
            :options="intervalOptions"
            style="width: 200px"
          />
        </n-form-item>
        <n-form-item label="保留份数">
          <n-select
            v-model:value="config.maxSnapshots"
            :options="keepOptions"
            style="width: 200px"
          />
        </n-form-item>
      </n-form>

      <n-space>
        <n-button @click="onTest" :loading="testing">测试连接</n-button>
        <n-button
          type="primary"
          @click="onRunNow"
          :loading="running"
          :disabled="!isConfigured"
        >
          立即备份
        </n-button>
        <n-button @click="onRefreshList" :disabled="!isConfigured">
          刷新备份列表
        </n-button>
        <n-button v-if="isPausedByFailure" type="warning" @click="onResume">
          重置失败状态并继续
        </n-button>
      </n-space>

      <n-alert
        v-if="config.lastResult === 'error'"
        type="error"
        :show-icon="true"
      >
        上次备份失败：{{ config.lastError || "未知错误" }}
        <span v-if="config.lastRunAt">
          （{{ formatTime(config.lastRunAt) }}）
        </span>
      </n-alert>
      <n-alert
        v-else-if="config.lastResult === 'ok' && config.lastRunAt"
        type="success"
        :show-icon="true"
      >
        上次备份成功：{{ formatTime(config.lastRunAt) }}
      </n-alert>

      <div>
        <h4 class="section-title">远程备份列表</h4>
        <n-spin :show="listing">
          <n-empty
            v-if="!isConfigured"
            description="先配置 WebDAV 才能查看远程列表"
          />
          <n-empty
            v-else-if="snapshots.length === 0 && listed"
            description="暂无备份"
          />
          <n-list v-else bordered>
            <n-list-item v-for="item in snapshots" :key="item.name">
              <n-thing :title="item.name">
                <template #description>
                  {{ formatBytes(item.size) }} · {{ formatTime(item.mtime) }}
                </template>
              </n-thing>
              <template #suffix>
                <n-space>
                  <n-button size="tiny" @click="onDownload(item.name)">
                    下载
                  </n-button>
                  <n-button
                    size="tiny"
                    type="primary"
                    @click="onRestore(item.name)"
                  >
                    恢复
                  </n-button>
                  <n-button
                    size="tiny"
                    type="error"
                    @click="onDelete(item.name)"
                  >
                    删除
                  </n-button>
                </n-space>
              </template>
            </n-list-item>
          </n-list>
        </n-spin>
      </div>
    </n-space>

    <n-modal
      v-model:show="restoreModalVisible"
      preset="dialog"
      title="恢复备份"
      :positive-text="'确认恢复'"
      :negative-text="'取消'"
      @positive-click="confirmRestore"
    >
      <p>
        将从 <strong>{{ pendingRestoreName }}</strong> 恢复配置。完成后页面将重新加载。
      </p>
      <n-form label-placement="left" label-width="100" size="small">
        <n-form-item label="Token 策略">
          <n-radio-group v-model:value="restoreOptions.tokenStrategy">
            <n-radio value="merge">合并（仅追加新 token）</n-radio>
            <n-radio value="overwrite">覆盖（替换全部）</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item label="包含项">
          <n-space vertical>
            <n-checkbox v-model:checked="restoreOptions.applyScheduledTasks">
              定时任务
            </n-checkbox>
            <n-checkbox v-model:checked="restoreOptions.applyBatchSettings">
              批量设置
            </n-checkbox>
            <n-checkbox v-model:checked="restoreOptions.applyTokenSettings">
              每 token 任务设置
            </n-checkbox>
            <n-checkbox v-model:checked="restoreOptions.applyMisc">
              分组 / 模板 / 主题
            </n-checkbox>
          </n-space>
        </n-form-item>
      </n-form>
    </n-modal>
  </n-card>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useMessage, useDialog } from "naive-ui";
import {
  backupConfig,
  isConfigured,
  isPausedByFailure,
  isRunning,
  listSnapshots,
  fetchSnapshot,
  deleteSnapshot,
  restoreFromSnapshot,
  runBackupNow,
  testWebDAV,
  downloadSnapshot,
  resetFailureState,
} from "@/utils/backup/backupManager";

const message = useMessage();
const dialog = useDialog();

const config = backupConfig;
const running = computed(() => isRunning.value);

const intervalOptions = [
  { label: "15 分钟", value: 15 },
  { label: "30 分钟", value: 30 },
  { label: "60 分钟", value: 60 },
  { label: "120 分钟", value: 120 },
];
const keepOptions = [
  { label: "5 份", value: 5 },
  { label: "10 份", value: 10 },
  { label: "20 份", value: 20 },
  { label: "50 份", value: 50 },
];

const testing = ref(false);
const listing = ref(false);
const listed = ref(false);
const snapshots = ref([]);

const restoreModalVisible = ref(false);
const pendingRestoreName = ref("");
const restoreOptions = ref({
  tokenStrategy: "merge",
  applyScheduledTasks: true,
  applyBatchSettings: true,
  applyTokenSettings: true,
  applyMisc: true,
});

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function refreshList() {
  if (!isConfigured.value) return;
  listing.value = true;
  try {
    snapshots.value = await listSnapshots();
    listed.value = true;
  } catch (err) {
    message.error(`列表获取失败：${err?.message || err}`);
  } finally {
    listing.value = false;
  }
}

async function onTest() {
  testing.value = true;
  try {
    const res = await testWebDAV();
    if (res.ok) {
      message.success("WebDAV 连接成功");
      await refreshList();
    } else {
      message.error(`连接失败：${res.error || "未知错误"}`);
    }
  } finally {
    testing.value = false;
  }
}

async function onRunNow() {
  const res = await runBackupNow("manual");
  if (res.ok) {
    message.success(`备份成功：${res.filename}`);
    await refreshList();
  } else {
    message.error(`备份失败：${res.error}`);
  }
}

async function onRefreshList() {
  await refreshList();
}

function onResume() {
  resetFailureState();
  message.info("已重置失败计数，自动备份继续运行");
}

async function onDownload(filename) {
  try {
    const snap = await fetchSnapshot(filename);
    downloadSnapshot(snap, filename);
  } catch (err) {
    message.error(`下载失败：${err?.message || err}`);
  }
}

function onRestore(filename) {
  pendingRestoreName.value = filename;
  restoreModalVisible.value = true;
}

async function confirmRestore() {
  const name = pendingRestoreName.value;
  if (!name) return;
  try {
    const res = await restoreFromSnapshot(name, { ...restoreOptions.value });
    message.success(
      `恢复成功：新增 token ${res.importedTokens}，定时任务 ${res.importedScheduledTasks}，token 设置 ${res.importedTokenSettings}`,
    );
    setTimeout(() => window.location.reload(), 800);
  } catch (err) {
    message.error(`恢复失败：${err?.message || err}`);
  }
}

function onDelete(filename) {
  dialog.warning({
    title: "删除备份",
    content: `确定删除 ${filename}？此操作不可撤销。`,
    positiveText: "删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      try {
        await deleteSnapshot(filename);
        message.success("已删除");
        await refreshList();
      } catch (err) {
        message.error(`删除失败：${err?.message || err}`);
      }
    },
  });
}

onMounted(() => {
  if (isConfigured.value) {
    void refreshList();
  }
});
</script>

<style scoped>
.backup-panel {
  margin-bottom: 16px;
}
.section-title {
  margin: 8px 0;
  font-size: 14px;
  font-weight: 600;
}
.hint {
  margin-left: 12px;
  color: var(--text-color-3, #999);
  font-size: 12px;
}
</style>
