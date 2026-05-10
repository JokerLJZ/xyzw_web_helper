<template>
  <n-card title="自动备份（GitHub Gist）" size="small" class="backup-panel">
    <n-space vertical :size="16">
      <n-alert type="warning" :show-icon="true" title="敏感数据提醒">
        备份内容包含完整 token 明文，将上传至你 GitHub 账号下的
        <strong>secret gist</strong>。请妥善保管 GitHub 账号 +
        Personal Access Token，开启两步验证。具体配置步骤见项目根目录的
        <code>BACKUP.md</code>。
      </n-alert>

      <n-form
        label-placement="left"
        label-width="120"
        :model="config"
        size="small"
      >
        <n-form-item label="GitHub Token">
          <n-input
            v-model:value="config.token"
            type="password"
            show-password-on="click"
            placeholder="ghp_xxx 或 github_pat_xxx"
          />
        </n-form-item>
        <n-form-item label="账号">
          <n-text v-if="config.ownerLogin" depth="1">
            {{ config.ownerLogin }}
          </n-text>
          <n-text v-else depth="3">未验证</n-text>
        </n-form-item>
        <n-form-item label="Gist ID">
          <n-input
            v-model:value="config.gistId"
            placeholder="自动创建 / 或手动粘贴已有 gist id"
          />
        </n-form-item>
        <n-form-item v-if="config.gistHtmlUrl" label="Gist 链接">
          <n-a :href="config.gistHtmlUrl" target="_blank">
            {{ config.gistHtmlUrl }}
          </n-a>
        </n-form-item>
        <n-form-item label="启用自动备份">
          <n-switch v-model:value="config.enabled" :disabled="!isConfigured" />
          <span v-if="!isConfigured" class="hint">
            需要先验证 Token 并创建/绑定 Gist
          </span>
        </n-form-item>
        <n-form-item label="备份方式">
          <n-radio-group
            v-model:value="config.scheduleType"
            size="small"
            @update:value="onScheduleTypeChange"
          >
            <n-radio value="interval">固定间隔</n-radio>
            <n-radio value="cron">自定义时间</n-radio>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="config.scheduleType !== 'cron'" label="备份间隔">
          <n-select
            v-model:value="config.intervalMinutes"
            :options="intervalOptions"
            style="width: 200px"
          />
        </n-form-item>
        <n-form-item v-else label="Cron 表达式">
          <div class="cron-field">
            <n-input
              v-model:value="config.cronExpression"
              placeholder="例如 30 3 * * * 表示每天 03:30"
            />
            <div v-if="config.cronExpression" class="cron-parser">
              <n-text
                v-if="backupCronValidation.valid"
                type="success"
                class="cron-validation"
              >
                {{ backupCronValidation.message }}
              </n-text>
              <n-text v-else type="error" class="cron-validation">
                {{ backupCronValidation.message }}
              </n-text>
              <div
                v-if="backupCronValidation.valid && backupCronNextRuns.length > 0"
                class="cron-next-runs"
              >
                <div class="cron-next-title">未来5次备份时间</div>
                <div v-for="(run, index) in backupCronNextRuns" :key="index">
                  {{ run }}
                </div>
              </div>
            </div>
          </div>
        </n-form-item>
      </n-form>

      <n-space>
        <n-button @click="onVerify" :loading="verifying">验证 Token</n-button>
        <n-button
          type="primary"
          @click="onCreateGist"
          :loading="creating"
          :disabled="!config.token || Boolean(config.gistId)"
        >
          创建新 Gist
        </n-button>
        <n-button
          @click="onRunNow"
          :loading="running"
          :disabled="!isConfigured"
        >
          立即备份
        </n-button>
        <n-button
          @click="onRefreshList"
          :disabled="!isConfigured"
          :loading="listing"
        >
          刷新版本
        </n-button>
        <n-button v-if="isPausedByFailure" type="warning" @click="onResume">
          重置失败状态
        </n-button>
      </n-space>

      <n-alert
        v-if="config.lastResult === 'error'"
        type="error"
        :show-icon="true"
      >
        上次备份失败：{{ config.lastError || "未知错误" }}
        <span v-if="config.lastRunAt">（{{ formatTime(config.lastRunAt) }}）</span>
      </n-alert>
      <n-alert
        v-else-if="config.lastResult === 'ok' && config.lastRunAt"
        type="success"
        :show-icon="true"
      >
        上次备份成功：{{ formatTime(config.lastRunAt) }}
      </n-alert>

      <div>
        <h4 class="section-title">历史版本（Gist commit）</h4>
        <n-empty
          v-if="!isConfigured"
          description="先配置 Token 并创建 Gist"
        />
        <n-empty
          v-else-if="revisions.length === 0 && listed"
          description="暂无版本"
        />
        <n-list v-else bordered>
          <n-list-item v-for="(rev, idx) in revisions" :key="rev.version">
            <n-thing>
              <template #header>
                <span>{{ formatTime(rev.committed_at) }}</span>
                <n-tag
                  v-if="idx === 0"
                  type="success"
                  size="tiny"
                  style="margin-left: 8px"
                >
                  最新
                </n-tag>
              </template>
              <template #description>
                <span class="rev-sha">sha: {{ rev.version.slice(0, 8) }}</span>
                <span
                  v-if="rev.change_status?.total != null"
                  class="rev-diff"
                >
                  · 变更 {{ rev.change_status.total }} 行
                </span>
              </template>
            </n-thing>
            <template #suffix>
              <n-space>
                <n-button size="tiny" @click="onDownload(rev.version)">
                  下载
                </n-button>
                <n-button
                  size="tiny"
                  type="primary"
                  @click="onRestore(rev.version)"
                >
                  恢复
                </n-button>
              </n-space>
            </template>
          </n-list-item>
        </n-list>
      </div>

      <n-collapse>
        <n-collapse-item title="高级 / 危险操作" name="danger">
          <n-space vertical>
            <n-button size="small" @click="onUnbind">
              解绑当前 Gist（不删除远程）
            </n-button>
            <n-button size="small" type="error" @click="onClearAll">
              清空本地 Token / Gist 配置
            </n-button>
          </n-space>
        </n-collapse-item>
      </n-collapse>
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
        将从 sha
        <code>{{ pendingRestoreSha.slice(0, 8) }}</code>
        恢复配置。完成后页面将重新加载。
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
  calculateNextRuns,
  validateCronExpression,
} from "@/utils/batch";
import {
  backupConfig,
  isConfigured,
  isPausedByFailure,
  isRunning,
  verifyToken,
  createInitialGist,
  runBackupNow,
  listRevisions,
  fetchRevisionSnapshot,
  restoreFromRevision,
  downloadSnapshotJson,
  resetFailureState,
  clearGistConfig,
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

const defaultBackupCronExpression = "30 3 * * *";
const backupCronValidation = computed(() => {
  if (config.value.scheduleType !== "cron") {
    return { valid: true, message: "" };
  }
  if (!config.value.cronExpression) {
    return { valid: false, message: "请输入 Cron 表达式" };
  }
  return validateCronExpression(config.value.cronExpression);
});

const backupCronNextRuns = computed(() => {
  if (!backupCronValidation.value.valid || !config.value.cronExpression) {
    return [];
  }
  const cronParts = config.value.cronExpression.split(" ").filter(Boolean);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = cronParts;
  return calculateNextRuns(minute, hour, dayOfMonth, month, dayOfWeek, 5);
});

function onScheduleTypeChange(value) {
  if (value === "cron" && !config.value.cronExpression) {
    config.value.cronExpression = defaultBackupCronExpression;
  }
}

const verifying = ref(false);
const creating = ref(false);
const listing = ref(false);
const listed = ref(false);
const revisions = ref([]);

const restoreModalVisible = ref(false);
const pendingRestoreSha = ref("");
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
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function onVerify() {
  if (!config.value.token) {
    message.warning("请先填写 Token");
    return;
  }
  verifying.value = true;
  try {
    const info = await verifyToken();
    const hasGist = info.scopes.includes("gist") || info.scopes.length === 0;
    // fine-grained PAT 不在 x-oauth-scopes 头里出现，length === 0 视为可能是 fine-grained
    if (info.scopes.length > 0 && !hasGist) {
      message.warning(
        `Token 已识别为 ${info.login}，但缺少 gist 权限（当前 scopes: ${info.scopes.join(", ")}）`,
      );
    } else {
      message.success(`Token 验证成功：${info.login}`);
    }
  } catch (err) {
    message.error(`验证失败：${err?.message || err}`);
  } finally {
    verifying.value = false;
  }
}

async function onCreateGist() {
  creating.value = true;
  try {
    const res = await createInitialGist();
    message.success(`Gist 已创建：${res.gistId.slice(0, 8)}…`);
    await refreshList();
  } catch (err) {
    message.error(`创建失败：${err?.message || err}`);
  } finally {
    creating.value = false;
  }
}

async function onRunNow() {
  const res = await runBackupNow("manual");
  if (res.ok) {
    message.success("备份成功");
    await refreshList();
  } else {
    message.error(`备份失败：${res.error}`);
  }
}

async function refreshList() {
  if (!isConfigured.value) return;
  listing.value = true;
  try {
    revisions.value = await listRevisions();
    listed.value = true;
  } catch (err) {
    message.error(`版本拉取失败：${err?.message || err}`);
  } finally {
    listing.value = false;
  }
}

async function onRefreshList() {
  await refreshList();
}

function onResume() {
  resetFailureState();
  message.info("已重置失败计数");
}

async function onDownload(sha) {
  try {
    const snap = await fetchRevisionSnapshot(sha);
    downloadSnapshotJson(snap, `xyzw-backup-${sha.slice(0, 8)}.json`);
  } catch (err) {
    message.error(`下载失败：${err?.message || err}`);
  }
}

function onRestore(sha) {
  pendingRestoreSha.value = sha;
  restoreModalVisible.value = true;
}

async function confirmRestore() {
  const sha = pendingRestoreSha.value;
  if (!sha) return;
  try {
    const res = await restoreFromRevision(sha, { ...restoreOptions.value });
    message.success(
      `恢复成功：新增 token ${res.importedTokens}，定时任务 ${res.importedScheduledTasks}`,
    );
    setTimeout(() => window.location.reload(), 800);
  } catch (err) {
    message.error(`恢复失败：${err?.message || err}`);
  }
}

function onUnbind() {
  dialog.warning({
    title: "解绑 Gist",
    content:
      "仅清除本地保存的 Gist ID，远程 Gist 保留。下次可粘贴 Gist ID 重新绑定。",
    positiveText: "确定",
    negativeText: "取消",
    onPositiveClick: () => {
      clearGistConfig();
      revisions.value = [];
      listed.value = false;
      message.info("已解绑");
    },
  });
}

function onClearAll() {
  dialog.warning({
    title: "清空本地配置",
    content:
      "将清除本地 Token、Gist ID、最后状态。远程 Gist 不会被删。确定吗？",
    positiveText: "清空",
    negativeText: "取消",
    onPositiveClick: () => {
      config.value.token = "";
      config.value.gistId = "";
      config.value.gistHtmlUrl = "";
      config.value.ownerLogin = "";
      config.value.enabled = false;
      config.value.scheduleType = "interval";
      config.value.cronExpression = "";
      config.value.lastResult = null;
      config.value.lastError = null;
      config.value.lastRunAt = null;
      revisions.value = [];
      listed.value = false;
      message.info("已清空");
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
.cron-field {
  width: min(420px, 100%);
}
.cron-parser {
  margin-top: 8px;
  font-size: 12px;
}
.cron-validation {
  display: block;
  margin-bottom: 6px;
}
.cron-next-runs {
  color: var(--text-color-3, #999);
  line-height: 1.7;
}
.cron-next-title {
  color: var(--text-color-2, #666);
  font-weight: 600;
}
.rev-sha {
  font-family: var(--font-family-mono, monospace);
  font-size: 12px;
  color: var(--text-color-3, #999);
}
.rev-diff {
  margin-left: 4px;
  color: var(--text-color-3, #999);
  font-size: 12px;
}
</style>
