// 把散落在 localStorage 的 token / 任务配置聚合成一份 BackupSnapshotV12，
// 并提供反向写回的 applySnapshot。
//
// 注意：这里只读写 localStorage，不直接 import tokenStore，避免 manager 在
// Pinia 实例化前被加载时出问题。tokenStore 的 useLocalStorage 会自动响应 LS 变化。

import { CURRENT_BACKUP_VERSION } from "./snapshotSchema";
import type {
  AnyBackupSnapshot,
  BackupSnapshotV12,
  BackupTokenGroupEntry,
  BackupTokenEntry,
  BackupTokenSettingEntry,
} from "./snapshotSchema";

const LS_KEYS = {
  tokens: "gameTokens",
  selectedTokenId: "selectedTokenId",
  tokenGroups: "tokenGroups",
  scheduledTasks: "scheduledTasks",
  batchSettings: "batchSettings",
  taskTemplates: "task-templates",
  tokenSortConfig: "tokenSortConfig",
  userPreferences: "userPreferences",
  theme: "theme",
} as const;

const APP_VERSION = "2.0.0";

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
    userPreferences: readJSON<unknown>(LS_KEYS.userPreferences, null),
    theme: readString(LS_KEYS.theme, "auto"),
    selectedTokenId: readString(LS_KEYS.selectedTokenId, "") || null,
  };
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
    if (snap.userPreferences != null)
      localStorage.setItem(
        LS_KEYS.userPreferences,
        JSON.stringify(snap.userPreferences),
      );
    if (snap.theme) localStorage.setItem(LS_KEYS.theme, snap.theme);
  }

  return result;
}

export const BACKUP_GIST_FILENAME = "xyzw-backup.json";
