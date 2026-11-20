import { bon } from "./bonProtocol.js";

const CDN = "https://xxz-xyzw-res.hortorgames.com";
const safeVersion = (value) => typeof value === "string" && /^[\w-]+$/.test(value);

/** Resolve the current launcher resources without pinning a remote bundle hash. */
async function readOfficialTaskConfig(version, fetchConfig, { language = false, binary = false, snapshot } = {}) {
  const request = async (url, options = {}) => {
    const response = await fetchConfig(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`配置资源读取失败（HTTP ${response.status}）`);
    return response;
  };
  const manifest = snapshot || await loadOfficialManifest(fetchConfig);
  if (manifest?.body?.dataBundleVer !== version)
    throw new Error("官方资源清单与账号配置版本不一致");
  const raw = manifest.body.bundleVers;
  const bundles = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!safeVersion(bundles?.config)) throw new Error("官方配置包版本无效");
  const bundle = await (await request(`${CDN}/remote/config/config.${bundles.config}.json`)).json();
  const readAsset = async (name) => {
    const entry = Object.entries(bundle.paths || {}).find(([, path]) =>
      path?.[0] === name && bundle.types?.[path[1]] === (name.endsWith("c") ? "cc.BufferAsset" : "cc.JsonAsset"));
    const index = entry?.[0];
    const compressed = bundle.uuids?.[index];
    const binaryAsset = name.endsWith("c");
    const versions = bundle.versions?.[binaryAsset ? "native" : "import"] || [];
    let hash;
    for (let i = 0; i < versions.length; i += 2)
      if (String(versions[i]) === index) hash = versions[i + 1];
    if (typeof compressed !== "string" || !/^[0-9a-f]{2}[A-Za-z0-9+/]{20}$/.test(compressed) || !safeVersion(hash))
      throw new Error(`官方配置资源索引无效：${name}`);
    const hex = compressed.slice(0, 2) + Array.from(atob(compressed.slice(2)),
      (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    if (binaryAsset) {
      const response = await request(`${CDN}/remote/config/native/${hex.slice(0, 2)}/${uuid}.${hash}.bin`);
      return bon.decode(new Uint8Array(await response.arrayBuffer()));
    }
    const asset = await (await request(`${CDN}/remote/config/import/${hex.slice(0, 2)}/${uuid}.${hash}.json`)).json();
    // Cocos serialized cc.JsonAsset: validate its type and named payload before use.
    if (asset?.[3]?.[0]?.[0] !== "cc.JsonAsset" || asset?.[5]?.[0]?.[1] !== name ||
        !asset[5][0][2] || typeof asset[5][0][2] !== "object")
      throw new Error(`官方配置资源格式无效：${name}`);
    return asset[5][0][2];
  };
  const config = await readAsset(binary ? "configc" : "config");
  if (config.COMMIT_ID !== version) throw new Error(`官方配置内容与账号配置版本不一致（账号 ${version}，配置 ${config.COMMIT_ID ?? "缺失"}）`);
  const extra = await readAsset(binary ? "config_apc" : "config_ap");
  if (extra.COMMIT_ID !== undefined && extra.COMMIT_ID !== version)
    throw new Error("官方补充配置版本不一致");
  const translations = language ? await readAsset("language") : {};
  if (translations.COMMIT_ID !== undefined && translations.COMMIT_ID !== version)
    throw new Error("官方语言配置版本不一致");
  const result = { ...extra, ...config, ...translations, version };
  Object.defineProperty(result, OFFICIAL_SNAPSHOT, { value: manifest });
  return result;
}

export const OFFICIAL_SNAPSHOT = Symbol("officialResourceSnapshot");
export function getOfficialSnapshot(config) { return config?.[OFFICIAL_SNAPSHOT]; }
async function readOfficialManifest(fetchConfig = globalThis.fetch) {
  const request = async (url, options = {}) => {
    const response = await fetchConfig(url, { ...options, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`官方清单资源读取失败（HTTP ${response.status}）`);
    return response;
  };
  const base = import.meta.env?.BASE_URL || "/";
  const html = await (await request(`${base}game/index.html`, { cache: "no-store" })).text();
  const defines = html.match(/src=["'](game-defines\.[\w-]+\.js)["']/)?.[1];
  if (!defines) throw new Error("未找到官方启动配置入口");
  const source = await (await request(`${base}game/${defines}`, { cache: "no-store" })).text();
  const clientVersion = source.match(/REMOTE_MANIFEST_VERSION\s*=\s*['"]([\w.-]+)['"]/)?.[1];
  if (!clientVersion) throw new Error("未找到官方清单客户端版本");
  const manifest = await (await request(
    `https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=${encodeURIComponent(clientVersion)}`,
    { method: "POST", cache: "no-store" },
  )).json();
  if (typeof manifest.body === "string") manifest.body = JSON.parse(manifest.body);
  if (!safeVersion(manifest.body?.dataBundleVer)) throw new Error("官方清单配置版本无效");
  return manifest;
}

const sharedConfigs = new WeakMap();
export function loadOfficialTaskConfig(version, fetchConfig = globalThis.fetch, options = {}) {
  if (!safeVersion(version)) return Promise.reject(new Error("官方配置版本无效"));
  let cache = sharedConfigs.get(fetchConfig);
  if (!cache) sharedConfigs.set(fetchConfig, cache = new Map());
  const key = `${version}/${!!options.language}/${!!options.binary}`;
  if (!cache.has(key)) {
    const loading = readOfficialTaskConfig(version, fetchConfig, options);
    cache.set(key, loading);
    loading.catch(() => { if (cache.get(key) === loading) cache.delete(key); });
    while (cache.size > 6) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

const manifestRequests = new WeakMap();
export function loadOfficialManifest(fetchConfig = globalThis.fetch) {
  if (!manifestRequests.has(fetchConfig)) {
    const loading = readOfficialManifest(fetchConfig);
    manifestRequests.set(fetchConfig, loading);
    const clear = () => { if (manifestRequests.get(fetchConfig) === loading) manifestRequests.delete(fetchConfig); };
    loading.then(clear, clear);
  }
  return manifestRequests.get(fetchConfig);
}
