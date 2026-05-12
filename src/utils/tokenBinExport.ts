type TokenLike = {
  id: string;
  name?: string;
  token?: string;
  server?: string;
  roleId?: string | number;
  roleIndex?: number;
  importMethod?: string;
};

type GetArrayBuffer = (key: string) => Promise<ArrayBuffer | null>;

export type TokenBinExportResult = {
  token: TokenLike;
  success: boolean;
  fileName?: string;
  reason?: string;
};

const BIN_IMPORT_METHODS = new Set(["bin", "wxQrcode"]);

export const isBinExportableToken = (token: TokenLike) =>
  BIN_IMPORT_METHODS.has(token.importMethod || "");

const sanitizeFilePart = (value: unknown, fallback = "unknown") => {
  const text = String(value || "").trim() || fallback;
  return text.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
};

const parseTokenPayload = (token: TokenLike) => {
  if (!token.token) return null;
  try {
    return JSON.parse(token.token);
  } catch {
    return null;
  }
};

const getRoleId = (token: TokenLike) => {
  const payload = parseTokenPayload(token);
  return (
    token.roleId ||
    payload?.role?.roleId ||
    payload?.roleInfo?.roleId ||
    payload?.roleId ||
    token.id?.slice(0, 8)
  );
};

const getServerName = (token: TokenLike) => {
  const server = token.server || "";
  const match = server.match(/(\d+)/);
  return match ? `${match[1]}服` : sanitizeFilePart(server, "未知区服");
};

export const buildTokenBinFileName = (token: TokenLike) => {
  const server = getServerName(token);
  const roleIndex =
    token.roleIndex === undefined || token.roleIndex === null
      ? "0"
      : String(token.roleIndex);
  const roleId = sanitizeFilePart(getRoleId(token), "unknown");
  const name = sanitizeFilePart(token.name, "未命名角色");
  return `bin-${server}-${roleIndex}-${roleId}-${name}.bin`;
};

export const downloadArrayBuffer = (fileName: string, buffer: ArrayBuffer) => {
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const getStoredTokenBin = async (
  token: TokenLike,
  getArrayBuffer: GetArrayBuffer,
) => {
  let buffer = await getArrayBuffer(token.id);
  if (!buffer && token.name) {
    buffer = await getArrayBuffer(token.name);
  }
  return buffer;
};

export const exportTokenBinFile = async (
  token: TokenLike,
  getArrayBuffer: GetArrayBuffer,
): Promise<TokenBinExportResult> => {
  if (!isBinExportableToken(token)) {
    return { token, success: false, reason: "该Token不是BIN或微信扫码导入" };
  }

  const buffer = await getStoredTokenBin(token, getArrayBuffer);
  if (!buffer) {
    return { token, success: false, reason: "未找到原始BIN数据" };
  }

  const fileName = buildTokenBinFileName(token);
  downloadArrayBuffer(fileName, buffer);
  return { token, success: true, fileName };
};

export const exportTokenBinFiles = async (
  tokens: TokenLike[],
  getArrayBuffer: GetArrayBuffer,
) => {
  const results: TokenBinExportResult[] = [];

  for (const token of tokens) {
    const result = await exportTokenBinFile(token, getArrayBuffer);
    results.push(result);

    if (result.success) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  return results;
};
