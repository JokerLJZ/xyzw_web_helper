import { convertBinToLx } from "@/utils/gameBin";

export const MULTI_GAME_ACTIVE_LAUNCH_KEY = "multi-game_active_launch_v1";

const SCOPE_PATTERN = /^mg-[a-f0-9]{32}$/;
const FAILURE_REASONS = new Set([
  "missing-bin",
  "read-failed",
  "convert-failed",
]);

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "/").replace(/\/?$/, "/");
}

function uuidHex(randomUUID) {
  const value = randomUUID().replaceAll("-", "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(value)) throw new Error("invalid UUID source");
  return value;
}

function storageKeys(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

function isSession(value) {
  return Boolean(
    value &&
      typeof value.tokenId === "string" &&
      value.tokenId.length > 0 &&
      typeof value.name === "string" &&
      SCOPE_PATTERN.test(value.scopeId) &&
      Number.isInteger(value.order) &&
      value.order >= 0,
  );
}

function isFailure(value) {
  return Boolean(
    value &&
      typeof value.tokenId === "string" &&
      value.tokenId.length > 0 &&
      typeof value.name === "string" &&
      FAILURE_REASONS.has(value.reason),
  );
}

function hasValidSessionSequence(sessions) {
  const scopes = new Set(sessions.map((session) => session.scopeId));
  const tokenIds = new Set(sessions.map((session) => session.tokenId));
  return (
    sessions.every(isSession) &&
    scopes.size === sessions.length &&
    tokenIds.size === sessions.length &&
    sessions.every((session, index) => session.order === index)
  );
}

export function createCompatibleRandomUUID(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function") {
    return cryptoSource.randomUUID();
  }
  if (typeof cryptoSource?.getRandomValues !== "function") {
    throw new Error("安全随机UUID生成不可用");
  }

  const bytes = new Uint8Array(16);
  cryptoSource.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

export function buildMultiGameFrameSrc(baseUrl, session) {
  const scope = encodeURIComponent(session.scopeId);
  const tokenId = encodeURIComponent(session.tokenId);
  return `${normalizeBaseUrl(baseUrl)}game/multi-game.html?scope=${scope}&bin_id=${tokenId}`;
}

export function resolveMultiGameFrameMessage({
  event,
  expectedOrigin,
  frames,
  frameElements,
}) {
  if (event.origin !== expectedOrigin) return null;
  const payload = event.data;
  if (
    payload?.channel !== "multi-game" ||
    payload.version !== 1 ||
    !["ready", "fatal"].includes(payload.type)
  ) {
    return null;
  }
  const frame = frames.find((item) => item.scopeId === payload.scope);
  const element = frameElements.get(payload.scope);
  if (!frame || !element || event.source !== element.contentWindow) return null;
  return { scopeId: frame.scopeId, status: payload.type };
}

export function readActiveMultiGameLaunch(storage) {
  try {
    const parsed = JSON.parse(
      storage.getItem(MULTI_GAME_ACTIVE_LAUNCH_KEY) || "null",
    );
    if (
      parsed?.version !== 1 ||
      typeof parsed.id !== "string" ||
      typeof parsed.createdAt !== "number" ||
      !Array.isArray(parsed.sessions) ||
      !hasValidSessionSequence(parsed.sessions) ||
      !Array.isArray(parsed.failures) ||
      !parsed.failures.every(isFailure)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearMultiGameLaunch({ localStorage, sessionStorage }) {
  const previous = readActiveMultiGameLaunch(sessionStorage);
  if (previous) {
    for (const gameSession of previous.sessions) {
      const prefix = `multi-game:${gameSession.scopeId}:`;
      for (const key of storageKeys(localStorage)) {
        if (key.startsWith(prefix)) localStorage.removeItem(key);
      }
    }
  }
  sessionStorage.removeItem(MULTI_GAME_ACTIVE_LAUNCH_KEY);
}

export function closeMultiGameSession({
  scopeId,
  localStorage,
  sessionStorage,
}) {
  const launch = readActiveMultiGameLaunch(sessionStorage);
  if (!launch) return null;
  const target = launch.sessions.find((session) => session.scopeId === scopeId);
  if (!target) return launch;

  const updatedLaunch = {
    ...launch,
    sessions: launch.sessions
      .filter((session) => session.scopeId !== scopeId)
      .map((session, order) => ({ ...session, order })),
  };
  sessionStorage.setItem(
    MULTI_GAME_ACTIVE_LAUNCH_KEY,
    JSON.stringify(updatedLaunch),
  );

  const prefix = `multi-game:${target.scopeId}:`;
  for (const key of storageKeys(localStorage)) {
    if (key.startsWith(prefix)) {
      try {
        localStorage.removeItem(key);
      } catch {
        // The manifest remains authoritative if browser cleanup is blocked.
      }
    }
  }
  return updatedLaunch;
}

export function moveMultiGameSession({ scopeId, direction, sessionStorage }) {
  const launch = readActiveMultiGameLaunch(sessionStorage);
  if (!launch || ![-1, 1].includes(direction)) return null;
  const currentIndex = launch.sessions.findIndex(
    (session) => session.scopeId === scopeId,
  );
  const targetIndex = currentIndex + direction;
  if (
    currentIndex < 0 ||
    targetIndex < 0 ||
    targetIndex >= launch.sessions.length
  ) {
    return null;
  }

  const sessions = [...launch.sessions];
  [sessions[currentIndex], sessions[targetIndex]] = [
    sessions[targetIndex],
    sessions[currentIndex],
  ];
  const updatedLaunch = {
    ...launch,
    sessions: sessions.map((session, order) => ({ ...session, order })),
  };
  sessionStorage.setItem(
    MULTI_GAME_ACTIVE_LAUNCH_KEY,
    JSON.stringify(updatedLaunch),
  );
  return updatedLaunch;
}

export async function prepareMultiGameLaunch({
  tokens,
  getArrayBuffer,
  localStorage,
  sessionStorage,
  randomUUID = createCompatibleRandomUUID,
  now = () => Date.now(),
}) {
  clearMultiGameLaunch({ localStorage, sessionStorage });
  const launchId = `launch-${uuidHex(randomUUID)}`;
  const prepared = await Promise.all(
    tokens.map(async (token) => {
      let buffer;
      try {
        buffer = await getArrayBuffer(token.id);
      } catch {
        return {
          failure: {
            tokenId: token.id,
            name: token.name || "Token",
            reason: "read-failed",
          },
        };
      }
      if (!buffer) {
        return {
          failure: {
            tokenId: token.id,
            name: token.name || "Token",
            reason: "missing-bin",
          },
        };
      }
      try {
        return {
          token,
          originalSize: buffer.byteLength,
          bytes: convertBinToLx(buffer),
        };
      } catch {
        return {
          failure: {
            tokenId: token.id,
            name: token.name || "Token",
            reason: "convert-failed",
          },
        };
      }
    }),
  );

  const sessions = [];
  const failures = [];
  const localEntries = [];
  for (const result of prepared) {
    if (result.failure) {
      failures.push(result.failure);
      continue;
    }
    const scopeId = `mg-${uuidHex(randomUUID)}`;
    const name = result.token.name || "Token";
    const prefix = `multi-game:${scopeId}:`;
    const hex = Array.from(result.bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    localEntries.push(
      [`${prefix}bin_data_${result.token.id}`, hex],
      [`${prefix}current_bin_id`, result.token.id],
      [
        `${prefix}bin_file_list`,
        JSON.stringify([
          {
            id: result.token.id,
            name,
            byteLength: result.originalSize,
            size: `${(result.originalSize / 1024).toFixed(1)} KB`,
            order: 0,
          },
        ]),
      ],
    );
    sessions.push({ tokenId: result.token.id, name, scopeId, order: sessions.length });
  }

  const launch = { version: 1, id: launchId, createdAt: now(), sessions, failures };
  const attemptedKeys = [];
  try {
    for (const [key, value] of localEntries) {
      attemptedKeys.push(key);
      localStorage.setItem(key, value);
    }
    sessionStorage.setItem(
      MULTI_GAME_ACTIVE_LAUNCH_KEY,
      JSON.stringify(launch),
    );
  } catch (error) {
    for (const key of attemptedKeys.reverse()) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Best-effort rollback.
      }
    }
    try {
      sessionStorage.removeItem(MULTI_GAME_ACTIVE_LAUNCH_KEY);
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
  return { launch, failures };
}
