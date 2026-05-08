// 自动备份管理器：单例，由 main.js 启动；负责定时调用 buildSnapshot + WebDAV PUT。

import { ref, computed, watch } from "vue";
import { useLocalStorage } from "@vueuse/core";

import {
  buildSnapshot,
  applySnapshot,
  snapshotFilename,
  LATEST_SNAPSHOT_FILENAME,
} from "./snapshotBuilder";
import type {
  ApplySnapshotOptions,
  ApplySnapshotResult,
} from "./snapshotBuilder";
import { WebDAVClient } from "./webdavClient";
import type { WebDAVFileEntry } from "./webdavClient";
import type {
  AnyBackupSnapshot,
  BackupSnapshotV12,
} from "./snapshotSchema";

export interface BackupConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxSnapshots: number;
  webdav: {
    baseUrl: string;
    username: string;
    password: string;
    basePath: string;
  };
  lastRunAt: string | null;
  lastResult: "ok" | "error" | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: false,
  intervalMinutes: 30,
  maxSnapshots: 10,
  webdav: { baseUrl: "", username: "", password: "", basePath: "/xyzw-backup/" },
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
  const w = backupConfig.value.webdav;
  return Boolean(w?.baseUrl && w?.username && w?.password);
});

let timer: number | null = null;

function buildClient(): WebDAVClient {
  const w = backupConfig.value.webdav;
  return new WebDAVClient({
    baseUrl: w.baseUrl,
    username: w.username,
    password: w.password,
    basePath: w.basePath || "/xyzw-backup/",
  });
}

export async function runBackupNow(
  source: "auto" | "manual" = "manual",
): Promise<{ ok: boolean; filename?: string; error?: string }> {
  if (!isConfigured.value) {
    return { ok: false, error: "WebDAV 未配置" };
  }
  if (isRunning.value) {
    return { ok: false, error: "上一次备份还在进行中" };
  }
  isRunning.value = true;
  try {
    const client = buildClient();
    await client.ensureDir();

    const snap = buildSnapshot(source);
    const body = JSON.stringify(snap, null, 2);
    const name = snapshotFilename();
    await client.put(name, body);
    // latest pointer
    try {
      await client.put(LATEST_SNAPSHOT_FILENAME, body);
    } catch {
      /* latest 失败不阻塞主备份 */
    }

    // 滚动清理
    try {
      await rotateSnapshots(client, backupConfig.value.maxSnapshots);
    } catch (err) {
      console.warn("[backup] 清理旧快照失败", err);
    }

    backupConfig.value.lastRunAt = new Date().toISOString();
    backupConfig.value.lastResult = "ok";
    backupConfig.value.lastError = null;
    backupConfig.value.consecutiveFailures = 0;
    isPausedByFailure.value = false;
    return { ok: true, filename: name };
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

async function rotateSnapshots(
  client: WebDAVClient,
  keep: number,
): Promise<void> {
  if (keep <= 0) return;
  const all = await client.list();
  const dated = all
    .filter(
      (f) =>
        f.name !== LATEST_SNAPSHOT_FILENAME &&
        /^xyzw-backup-\d{8}-\d{6}\.json$/.test(f.name),
    )
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1)); // 新→旧
  const toDelete = dated.slice(keep);
  for (const f of toDelete) {
    try {
      await client.delete(f.name);
    } catch (err) {
      console.warn("[backup] 删除旧快照失败", f.name, err);
    }
  }
}

export async function listSnapshots(): Promise<WebDAVFileEntry[]> {
  if (!isConfigured.value) return [];
  const client = buildClient();
  const list = await client.list();
  return list
    .filter((f) => f.name.endsWith(".json"))
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

export async function fetchSnapshot(filename: string): Promise<AnyBackupSnapshot> {
  const client = buildClient();
  const raw = await client.get(filename);
  return JSON.parse(raw) as AnyBackupSnapshot;
}

export async function deleteSnapshot(filename: string): Promise<void> {
  const client = buildClient();
  await client.delete(filename);
}

export async function restoreFromSnapshot(
  filename: string,
  options: ApplySnapshotOptions = {},
): Promise<ApplySnapshotResult> {
  const snap = await fetchSnapshot(filename);
  return applySnapshot(snap, options);
}

export async function testWebDAV(): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = buildClient();
    return await client.testConnection();
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
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

  // 启动追赶
  setTimeout(() => maybeCatchUp(), 3000);

  if (backupConfig.value.enabled && isConfigured.value) {
    startTimer();
  }

  // 配置变化（开关 / 间隔 / WebDAV 凭据）→ 重置 timer 与失败暂停
  watch(
    () => [
      backupConfig.value.enabled,
      backupConfig.value.intervalMinutes,
      backupConfig.value.webdav.baseUrl,
      backupConfig.value.webdav.username,
      backupConfig.value.webdav.password,
      backupConfig.value.webdav.basePath,
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

export function downloadSnapshot(snap: BackupSnapshotV12 | AnyBackupSnapshot, filename?: string) {
  const blob = new Blob([JSON.stringify(snap, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || snapshotFilename();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
