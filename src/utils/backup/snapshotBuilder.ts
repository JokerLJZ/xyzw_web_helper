// 把散落在 localStorage 的 token / 任务配置聚合成一份 BackupSnapshotV12，
// 并提供反向写回的 applySnapshot。
//
// 注意：这里只读写 localStorage，不直接 import tokenStore，避免 manager 在
// Pinia 实例化前被加载时出问题。tokenStore 的 useLocalStorage 会自动响应 LS 变化。

import { CURRENT_BACKUP_VERSION } from "./snapshotSchema";
import type {
  AnyBackupSnapshot,
  BackupSnapshotV12,
  BackupTokenBinaryEntry,
  BackupTokenGroupEntry,
  BackupTokenEntry,
  BackupTokenSettingEntry,
} from "./snapshotSchema";
import { openDB, type DBSchema } from "idb";

const LS_KEYS = {
  tokens: "gameTokens",
  selectedTokenId: "selectedTokenId",
  tokenGroups: "tokenGroups",
  scheduledTasks: "scheduledTasks",
  batchSettings: "batchSettings",
  taskTemplates: "task-templates",
  tokenSortConfig: "tokenSortConfig",
  batchTokenOrder: "batchTokenOrder",
  userPreferences: "userPreferences",
  theme: "theme",
} as const;

const APP_VERSION = "2.0.0";
const IDB_NAME = "xyzw";
const IDB_VERSION = 1;
const IDB_TOKEN_STORE = "tokens";

interface TokenBinaryDB extends DBSchema {
  tokens: {
    key: string;
    value: {
      id: string;
      data: ArrayBuffer;
      createdAt?: Date | string;
      updatedAt?: Date | string;
      metadata?: Record<string, unknown>;
    };
    indexes: { "by-created": Date };
  };
}

function readJSON<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readString(key: string, fallback = ""): string {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  // useLocalStorage 对字符串会带引号；裸值也兼容
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
  } catch {
    /* 裸字符串 */
  }
  return raw;
}

function dateLikeToISOString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function openTokenBinaryDB() {
  return openDB<TokenBinaryDB>(IDB_NAME, IDB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(IDB_TOKEN_STORE)) {
        const store = db.createObjectStore(IDB_TOKEN_STORE, { keyPath: "id" });
        store.createIndex("by-created", "createdAt");
      }
    },
  });
}

async function collectTokenBinaryData(
  tokens: BackupTokenEntry[],
): Promise<BackupTokenBinaryEntry[]> {
  const backupTokenIds = new Set(
    tokens
      .filter(
        (token) =>
          token.importMethod === "bin" || token.importMethod === "wxQrcode",
      )
      .map((token) => token.id)
      .filter(Boolean),
  );
  if (backupTokenIds.size === 0) return [];

  try {
    const db = await openTokenBinaryDB();
    const entries: BackupTokenBinaryEntry[] = [];
    for (const tokenId of backupTokenIds) {
      const item = await db.get(IDB_TOKEN_STORE, tokenId);
      if (!item?.data) continue;
      entries.push({
        tokenId,
        base64: arrayBufferToBase64(item.data),
        byteLength: item.data.byteLength,
        metadata: item.metadata,
        createdAt: dateLikeToISOString(item.createdAt),
        updatedAt: dateLikeToISOString(item.updatedAt),
      });
    }
    db.close();
    return entries;
  } catch (error) {
    console.warn("[backup] collect token binary data failed", error);
    return [];
  }
}

async function restoreTokenBinaryData(
  entries: BackupTokenBinaryEntry[] | undefined,
): Promise<number> {
  if (!Array.isArray(entries) || entries.length === 0) return 0;

  const db = await openTokenBinaryDB();
  let restoredCount = 0;
  for (const entry of entries) {
    if (!entry?.tokenId || !entry.base64) continue;
    try {
      const data = base64ToArrayBuffer(entry.base64);
      await db.put(IDB_TOKEN_STORE, {
        id: entry.tokenId,
        data,
        metadata: entry.metadata,
        createdAt: entry.createdAt ? new Date(entry.createdAt) : new Date(),
        updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : new Date(),
      });
      restoredCount++;
    } catch (error) {
      console.warn(
        "[backup] restore token binary data failed",
        entry.tokenId,
        error,
      );
    }
  }
  db.close();
  return restoredCount;
}

function collectTokenSettings(
  tokens: BackupTokenEntry[],
): BackupTokenSettingEntry[] {
  const out: BackupTokenSettingEntry[] = [];
  for (const t of tokens) {
    if (!t?.id) continue;
    const raw = localStorage.getItem(`daily-settings:${t.id}`);
    if (!raw) continue;
    try {
      out.push({ tokenId: t.id, settings: JSON.parse(raw) });
    } catch {
      /* skip corrupt entry */
    }
  }
  return out;
}

export function sanitizeScheduledTaskForSnapshot<T>(task: T): T {
  if (!task || typeof task !== "object" || Array.isArray(task)) {
    return task;
  }

  const sanitized = { ...(task as Record<string, unknown>) };
  delete sanitized.connectedTokens;
  return sanitized as T;
}

function sanitizeScheduledTasksForSnapshot<T>(tasks: T[]): T[] {
  return tasks.map((task) => sanitizeScheduledTaskForSnapshot(task));
}

function sanitizeTokenGroupsForSnapshot(
  groups: unknown[],
  tokens: BackupTokenEntry[],
): BackupTokenGroupEntry[] {
  const validTokenIds = new Set(tokens.map((token) => token.id).filter(Boolean));

  return groups
    .filter((group): group is Record<string, unknown> => {
      return Boolean(group && typeof group === "object" && !Array.isArray(group));
    })
    .map((group) => {
      const tokenIds = Array.isArray(group.tokenIds)
        ? group.tokenIds
            .filter((tokenId): tokenId is string => typeof tokenId === "string")
            .filter((tokenId) => validTokenIds.has(tokenId))
        : [];

      return {
        id: typeof group.id === "string" ? group.id : "",
        name: typeof group.name === "string" ? group.name : "未命名分组",
        color: typeof group.color === "string" ? group.color : "#1677ff",
        tokenIds,
        createdAt:
          typeof group.createdAt === "string" ? group.createdAt : undefined,
        updatedAt:
          typeof group.updatedAt === "string" ? group.updatedAt : undefined,
      };
    })
    .filter((group) => group.id);
}

function normalizeBatchTokenOrderForTokens(
  order: unknown,
  tokens: BackupTokenEntry[],
  appendMissingTokens = true,
): string[] {
  const validTokenIds = new Set(
    tokens
      .map((token) => token?.id)
      .filter((tokenId): tokenId is string => Boolean(tokenId)),
  );
  const normalized: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(order)) {
    for (const tokenId of order) {
      if (
        typeof tokenId === "string" &&
        validTokenIds.has(tokenId) &&
        !seen.has(tokenId)
      ) {
        normalized.push(tokenId);
        seen.add(tokenId);
      }
    }
  }

  if (appendMissingTokens) {
    for (const token of tokens) {
      if (token?.id && !seen.has(token.id)) {
        normalized.push(token.id);
        seen.add(token.id);
      }
    }
  }

  return normalized;
}

function mergeBatchTokenOrder(
  currentOrder: unknown,
  snapshotOrder: unknown,
  tokens: BackupTokenEntry[],
): string[] {
  const normalizedCurrent = normalizeBatchTokenOrderForTokens(
    currentOrder,
    tokens,
    false,
  );
  const normalizedSnapshot = normalizeBatchTokenOrderForTokens(
    snapshotOrder,
    tokens,
    false,
  );
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const tokenId of normalizedSnapshot) {
    if (!seen.has(tokenId)) {
      merged.push(tokenId);
      seen.add(tokenId);
    }
  }

  for (const tokenId of normalizedCurrent) {
    if (!seen.has(tokenId)) {
      merged.push(tokenId);
      seen.add(tokenId);
    }
  }

  for (const token of tokens) {
    if (token?.id && !seen.has(token.id)) {
      merged.push(token.id);
      seen.add(token.id);
    }
  }

  return merged;
}

export function buildSnapshot(source: "auto" | "manual"): BackupSnapshotV12 {
  const tokens = readJSON<BackupTokenEntry[]>(LS_KEYS.tokens, []);

  return {
    version: CURRENT_BACKUP_VERSION,
    exportTime: new Date().toISOString(),
    source,
    client: {
      ua: typeof navigator !== "undefined" ? navigator.userAgent || "" : "",
      appVersion: APP_VERSION,
    },
    tokens,
    tokenBinaryData: [],
    scheduledTasks: sanitizeScheduledTasksForSnapshot(
      readJSON<unknown[]>(LS_KEYS.scheduledTasks, []),
    ),
    batchSettings: readJSON<Record<string, unknown>>(LS_KEYS.batchSettings, {}),
    tokenSettings: collectTokenSettings(tokens),
    tokenGroups: sanitizeTokenGroupsForSnapshot(
      readJSON<unknown[]>(LS_KEYS.tokenGroups, []),
      tokens,
    ),
    taskTemplates: readJSON<unknown[]>(LS_KEYS.taskTemplates, []),
    tokenSortConfig: readJSON<unknown>(LS_KEYS.tokenSortConfig, null),
    batchTokenOrder: normalizeBatchTokenOrderForTokens(
      readJSON<unknown[]>(LS_KEYS.batchTokenOrder, []),
      tokens,
    ),
    userPreferences: readJSON<unknown>(LS_KEYS.userPreferences, null),
    theme: readString(LS_KEYS.theme, "auto"),
    selectedTokenId: readString(LS_KEYS.selectedTokenId, "") || null,
  };
}

export async function buildSnapshotWithIndexedDB(
  source: "auto" | "manual",
): Promise<BackupSnapshotV12> {
  const snap = buildSnapshot(source);
  snap.tokenBinaryData = await collectTokenBinaryData(snap.tokens);
  return snap;
}

export interface ApplySnapshotOptions {
  // overwrite: 完全替换；merge: 同 id/token 跳过，仅追加新的
  tokenStrategy?: "merge" | "overwrite";
  applyBatchSettings?: boolean;
  applyScheduledTasks?: boolean;
  applyTokenSettings?: boolean;
  applyMisc?: boolean; // 分组/模板/排序/偏好/主题
}

export interface ApplySnapshotResult {
  importedTokens: number;
  importedTokenBinaryData?: number;
  importedScheduledTasks: number;
  importedTokenSettings: number;
  appliedBatchSettings: boolean;
}

function normalizeSnapshot(snap: AnyBackupSnapshot): BackupSnapshotV12 {
  const tokens = Array.isArray((snap as any).tokens) ? (snap as any).tokens : [];

  // 任何旧版本都补齐缺失字段
  const v12: BackupSnapshotV12 = {
    version: CURRENT_BACKUP_VERSION,
    exportTime: (snap as any).exportTime || new Date().toISOString(),
    source: (snap as any).source || "manual",
    client: (snap as any).client || { ua: "", appVersion: "" },
    tokens,
    tokenBinaryData: Array.isArray((snap as any).tokenBinaryData)
      ? (snap as any).tokenBinaryData
      : [],
    scheduledTasks: Array.isArray((snap as any).scheduledTasks)
      ? sanitizeScheduledTasksForSnapshot((snap as any).scheduledTasks)
      : [],
    batchSettings:
      (snap as any).batchSettings &&
      typeof (snap as any).batchSettings === "object"
        ? (snap as any).batchSettings
        : {},
    tokenSettings: Array.isArray((snap as any).tokenSettings)
      ? (snap as any).tokenSettings
      : [],
    tokenGroups: Array.isArray((snap as any).tokenGroups)
      ? sanitizeTokenGroupsForSnapshot((snap as any).tokenGroups, tokens)
      : [],
    taskTemplates: Array.isArray((snap as any).taskTemplates)
      ? (snap as any).taskTemplates
      : [],
    tokenSortConfig: (snap as any).tokenSortConfig ?? null,
    batchTokenOrder: normalizeBatchTokenOrderForTokens(
      (snap as any).batchTokenOrder,
      tokens,
      Array.isArray((snap as any).batchTokenOrder),
    ),
    userPreferences: (snap as any).userPreferences ?? null,
    theme: (snap as any).theme || "",
    selectedTokenId: (snap as any).selectedTokenId ?? null,
  };
  return v12;
}

export function applySnapshot(
  raw: AnyBackupSnapshot,
  options: ApplySnapshotOptions = {},
): ApplySnapshotResult {
  const {
    tokenStrategy = "merge",
    applyBatchSettings = true,
    applyScheduledTasks = true,
    applyTokenSettings = true,
    applyMisc = true,
  } = options;

  const shouldRestoreBatchTokenOrder = Array.isArray(
    (raw as any).batchTokenOrder,
  );
  const snap = normalizeSnapshot(raw);
  const result: ApplySnapshotResult = {
    importedTokens: 0,
    importedScheduledTasks: 0,
    importedTokenSettings: 0,
    appliedBatchSettings: false,
  };

  // ---- tokens ----
  const existing = readJSON<BackupTokenEntry[]>(LS_KEYS.tokens, []);
  let merged: BackupTokenEntry[];
  if (tokenStrategy === "overwrite") {
    merged = snap.tokens.slice();
    result.importedTokens = snap.tokens.length;
  } else {
    merged = existing.slice();
    const seenIds = new Set(merged.map((t) => t.id));
    const seenTokens = new Set(merged.map((t) => t.token));
    for (const incoming of snap.tokens) {
      if (!incoming?.token) continue;
      if (seenIds.has(incoming.id) || seenTokens.has(incoming.token)) continue;
      merged.push({
        ...incoming,
        upgradedToPermanent: incoming.upgradedToPermanent ?? true,
        updatedAt: incoming.updatedAt || new Date().toISOString(),
      });
      seenIds.add(incoming.id);
      seenTokens.add(incoming.token);
      result.importedTokens++;
    }
  }
  localStorage.setItem(LS_KEYS.tokens, JSON.stringify(merged));

  // ---- scheduledTasks ----
  if (applyScheduledTasks) {
    const existingTasks = sanitizeScheduledTasksForSnapshot(
      readJSON<any[]>(LS_KEYS.scheduledTasks, []),
    );
    const seenTaskIds = new Set(existingTasks.map((t) => t?.id));
    const incoming = sanitizeScheduledTasksForSnapshot(
      snap.scheduledTasks as any[],
    );
    const finalTasks =
      tokenStrategy === "overwrite"
        ? incoming
        : (() => {
            const out = existingTasks.slice();
            for (const t of incoming) {
              if (!t?.id || seenTaskIds.has(t.id)) continue;
              out.push(t);
              seenTaskIds.add(t.id);
              result.importedScheduledTasks++;
            }
            return out;
          })();
    if (tokenStrategy === "overwrite") {
      result.importedScheduledTasks = incoming.length;
    }
    localStorage.setItem(LS_KEYS.scheduledTasks, JSON.stringify(finalTasks));
  }

  // ---- batchSettings ----
  if (applyBatchSettings && snap.batchSettings) {
    const cur = readJSON<Record<string, unknown>>(LS_KEYS.batchSettings, {});
    const next =
      tokenStrategy === "overwrite"
        ? snap.batchSettings
        : { ...cur, ...snap.batchSettings };
    localStorage.setItem(LS_KEYS.batchSettings, JSON.stringify(next));
    result.appliedBatchSettings = true;
  }

  // ---- per-token settings ----
  if (applyTokenSettings) {
    for (const item of snap.tokenSettings) {
      if (!item?.tokenId) continue;
      localStorage.setItem(
        `daily-settings:${item.tokenId}`,
        JSON.stringify(item.settings ?? {}),
      );
      result.importedTokenSettings++;
    }
  }

  // ---- misc ----
  if (applyMisc) {
    if (Array.isArray(snap.tokenGroups))
      localStorage.setItem(
        LS_KEYS.tokenGroups,
        JSON.stringify(snap.tokenGroups),
      );
    if (Array.isArray(snap.taskTemplates))
      localStorage.setItem(
        LS_KEYS.taskTemplates,
        JSON.stringify(snap.taskTemplates),
      );
    if (snap.tokenSortConfig != null)
      localStorage.setItem(
        LS_KEYS.tokenSortConfig,
        JSON.stringify(snap.tokenSortConfig),
      );
    if (shouldRestoreBatchTokenOrder) {
      const nextOrder =
        tokenStrategy === "overwrite"
          ? normalizeBatchTokenOrderForTokens(snap.batchTokenOrder, merged)
          : mergeBatchTokenOrder(
              readJSON<unknown[]>(LS_KEYS.batchTokenOrder, []),
              snap.batchTokenOrder,
              merged,
            );
      localStorage.setItem(LS_KEYS.batchTokenOrder, JSON.stringify(nextOrder));
    }
    if (snap.userPreferences != null)
      localStorage.setItem(
        LS_KEYS.userPreferences,
        JSON.stringify(snap.userPreferences),
      );
    if (snap.theme) localStorage.setItem(LS_KEYS.theme, snap.theme);
  }

  return result;
}

export async function applySnapshotWithIndexedDB(
  raw: AnyBackupSnapshot,
  options: ApplySnapshotOptions = {},
): Promise<ApplySnapshotResult> {
  const snap = normalizeSnapshot(raw);
  const result = applySnapshot(raw, options);
  result.importedTokenBinaryData = await restoreTokenBinaryData(
    snap.tokenBinaryData,
  );
  return result;
}

export const BACKUP_GIST_FILENAME = "xyzw-backup.json";
