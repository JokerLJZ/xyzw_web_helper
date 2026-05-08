// 自动备份管理器（GitHub Gist 版）：单例，由 main.js 启动；
// 定时 PATCH 同一个 secret gist 的 xyzw-backup.json，利用 gist 自带 history 做版本。

import { ref, computed, watch } from "vue";
import { useLocalStorage } from "@vueuse/core";

import {
  buildSnapshot,
  applySnapshot,
  BACKUP_GIST_FILENAME,
} from "./snapshotBuilder";
import type {
  ApplySnapshotOptions,
  ApplySnapshotResult,
} from "./snapshotBuilder";
import { GistClient } from "./gistClient";
import type { GistDetail, GistRevision } from "./gistClient";
import type { AnyBackupSnapshot } from "./snapshotSchema";

export interface BackupConfig {
  enabled: boolean;
  intervalMinutes: number;
  token: string;
  gistId: string;
  gistHtmlUrl: string;
  ownerLogin: string;
  lastRunAt: string | null;
  lastResult: "ok" | "error" | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: false,
  intervalMinutes: 30,
  token: "",
  gistId: "",
  gistHtmlUrl: "",
  ownerLogin: "",
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  consecutiveFailures: 0,
};

const FAILURE_PAUSE_THRESHOLD = 3;

export const backupConfig = useLocalStorage<BackupConfig>(
  "backupConfig",
  DEFAULT_CONFIG,
  { mergeDefaults: true },
);

export const isRunning = ref(false);
export const isPausedByFailure = ref(false);

export const isConfigured = computed(() => {
  return Boolean(backupConfig.value.token && backupConfig.value.gistId);
});

let timer: number | null = null;

function buildClient(): GistClient {
  return new GistClient({
    token: backupConfig.value.token,
    gistId: backupConfig.value.gistId,
    filename: BACKUP_GIST_FILENAME,
  });
}

// 用 token 试探账号信息；同时把 login 缓存进 config。
export async function verifyToken(): Promise<{
  login: string;
  scopes: string[];
}> {
  const c = new GistClient({
    token: backupConfig.value.token,
    filename: BACKUP_GIST_FILENAME,
  });
  const info = await c.verifyToken();
  backupConfig.value.ownerLogin = info.login;
  return info;
}

// 首次设置：用当前快照创建一个新的 secret gist 并把 id 存下来。
export async function createInitialGist(): Promise<{
  gistId: string;
  htmlUrl: string;
}> {
  if (!backupConfig.value.token) throw new Error("请先填写 GitHub Token");
  const c = new GistClient({
    token: backupConfig.value.token,
    filename: BACKUP_GIST_FILENAME,
  });
  const snap = buildSnapshot("manual");
  const body = JSON.stringify(snap, null, 2);
  const result = await c.createGist(
    body,
    `xyzw-web-helper backup · created ${new Date().toISOString()}`,
  );
  backupConfig.value.gistId = result.id;
  backupConfig.value.gistHtmlUrl = result.html_url;
  backupConfig.value.lastRunAt = new Date().toISOString();
  backupConfig.value.lastResult = "ok";
  backupConfig.value.lastError = null;
  backupConfig.value.consecutiveFailures = 0;
  return { gistId: result.id, htmlUrl: result.html_url };
}

export async function runBackupNow(
  source: "auto" | "manual" = "manual",
): Promise<{ ok: boolean; error?: string }> {
  if (!isConfigured.value) {
    return { ok: false, error: "GitHub Token / Gist 未配置" };
  }
  if (isRunning.value) {
    return { ok: false, error: "上一次备份还在进行中" };
  }
  isRunning.value = true;
  try {
    const client = buildClient();
    const snap = buildSnapshot(source);
    const body = JSON.stringify(snap, null, 2);
    const desc = `xyzw-web-helper backup · ${snap.exportTime} · ${snap.tokens.length} tokens`;
    await client.updateGist(body, desc);

    backupConfig.value.lastRunAt = new Date().toISOString();
    backupConfig.value.lastResult = "ok";
    backupConfig.value.lastError = null;
    backupConfig.value.consecutiveFailures = 0;
    isPausedByFailure.value = false;
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    backupConfig.value.lastRunAt = new Date().toISOString();
    backupConfig.value.lastResult = "error";
    backupConfig.value.lastError = msg;
    backupConfig.value.consecutiveFailures =
      (backupConfig.value.consecutiveFailures || 0) + 1;
    if (
      backupConfig.value.consecutiveFailures >= FAILURE_PAUSE_THRESHOLD &&
      source === "auto"
    ) {
      isPausedByFailure.value = true;
      stopTimer();
    }
    return { ok: false, error: msg };
  } finally {
    isRunning.value = false;
  }
}

export async function listRevisions(): Promise<GistRevision[]> {
  if (!isConfigured.value) return [];
  const detail = await buildClient().getGist();
  return detail.history || [];
}

export async function fetchRevisionSnapshot(
  sha: string,
): Promise<AnyBackupSnapshot> {
  const detail: GistDetail = await buildClient().getRevision(sha);
  const file = detail.files[BACKUP_GIST_FILENAME];
  if (!file?.content) throw new Error("该版本不包含备份文件");
  if (file.truncated) {
    throw new Error("该版本过大被 GitHub 截断，请通过浏览器手动下载该版本");
  }
  return JSON.parse(file.content) as AnyBackupSnapshot;
}

export async function fetchLatestSnapshot(): Promise<AnyBackupSnapshot> {
  const detail: GistDetail = await buildClient().getGist();
  const file = detail.files[BACKUP_GIST_FILENAME];
  if (!file?.content) throw new Error("Gist 中没有备份文件");
  return JSON.parse(file.content) as AnyBackupSnapshot;
}

export async function restoreFromRevision(
  sha: string,
  options: ApplySnapshotOptions = {},
): Promise<ApplySnapshotResult> {
  const snap = await fetchRevisionSnapshot(sha);
  return applySnapshot(snap, options);
}

export function downloadSnapshotJson(snap: AnyBackupSnapshot, filename: string) {
  const blob = new Blob([JSON.stringify(snap, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- timer ----

function startTimer(): void {
  stopTimer();
  const ms = Math.max(5, backupConfig.value.intervalMinutes) * 60 * 1000;
  timer = window.setInterval(() => {
    if (!backupConfig.value.enabled) return;
    if (isPausedByFailure.value) return;
    void runBackupNow("auto");
  }, ms);
}

function stopTimer(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

function maybeCatchUp(): void {
  if (!backupConfig.value.enabled || !isConfigured.value) return;
  if (isPausedByFailure.value) return;
  const last = backupConfig.value.lastRunAt
    ? Date.parse(backupConfig.value.lastRunAt)
    : 0;
  const intervalMs = backupConfig.value.intervalMinutes * 60 * 1000;
  if (!last || Date.now() - last > intervalMs) {
    void runBackupNow("auto");
  }
}

let bootstrapped = false;

export function bootstrap(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  setTimeout(() => maybeCatchUp(), 3000);

  if (backupConfig.value.enabled && isConfigured.value) {
    startTimer();
  }

  watch(
    () => [
      backupConfig.value.enabled,
      backupConfig.value.intervalMinutes,
      backupConfig.value.token,
      backupConfig.value.gistId,
    ],
    () => {
      isPausedByFailure.value = false;
      backupConfig.value.consecutiveFailures = 0;
      stopTimer();
      if (backupConfig.value.enabled && isConfigured.value) {
        startTimer();
      }
    },
  );
}

export function resetFailureState(): void {
  backupConfig.value.consecutiveFailures = 0;
  backupConfig.value.lastError = null;
  isPausedByFailure.value = false;
  if (backupConfig.value.enabled && isConfigured.value) startTimer();
}

export function clearGistConfig(): void {
  backupConfig.value.gistId = "";
  backupConfig.value.gistHtmlUrl = "";
  backupConfig.value.enabled = false;
}
