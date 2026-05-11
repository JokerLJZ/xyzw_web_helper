// 备份快照 schema 定义。v1.2 在原 BatchDailyTasks.vue 的 v1.1 基础上扩展。

export interface BackupTokenEntry {
  id: string;
  name?: string;
  token: string;
  server?: string;
  wsUrl?: string | null;
  remark?: string;
  importMethod?: string;
  sourceUrl?: string | null;
  avatar?: string;
  upgradedToPermanent?: boolean;
  upgradedAt?: string | null;
  updatedAt?: string;
  createdAt?: string;
  lastUsed?: string;
}

export interface BackupTokenSettingEntry {
  tokenId: string;
  settings: unknown;
}

export interface BackupTokenBinaryEntry {
  tokenId: string;
  base64: string;
  byteLength: number;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface BackupTokenGroupEntry {
  id: string;
  name: string;
  color: string;
  tokenIds: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface BackupSnapshotV12 {
  version: "1.2" | "1.3";
  exportTime: string;
  source: "auto" | "manual";
  client: { ua: string; appVersion: string };

  tokens: BackupTokenEntry[];
  tokenBinaryData?: BackupTokenBinaryEntry[];
  scheduledTasks: unknown[];
  batchSettings: Record<string, unknown>;
  tokenSettings: BackupTokenSettingEntry[];

  tokenGroups: BackupTokenGroupEntry[];
  taskTemplates: unknown[];
  tokenSortConfig: unknown;
  userPreferences: unknown;
  theme: string;
  selectedTokenId: string | null;
}

// v1.1 旧文件结构（手动 exportConfig 产生），用于兼容导入
export interface BackupSnapshotV11 {
  version: "1.1" | string;
  exportTime?: string;
  tokens?: BackupTokenEntry[];
  tokenBinaryData?: BackupTokenBinaryEntry[];
  scheduledTasks?: unknown[];
  batchSettings?: Record<string, unknown>;
  tokenSettings?: BackupTokenSettingEntry[];
}

export type AnyBackupSnapshot = BackupSnapshotV12 | BackupSnapshotV11;

export const CURRENT_BACKUP_VERSION = "1.3" as const;
