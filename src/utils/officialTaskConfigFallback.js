const CDN = "https://xxz-xyzw-res.hortorgames.com";
const safeVersion = (value) => typeof value === "string" && /^[\w-]+$/.test(value);

/** Resolve the current launcher resources without pinning a remote bundle hash. */
export async function loadOfficialTaskConfigFallback(version, fetchConfig) {
  const request = async (url, options = {}) => {
    const response = await fetchConfig(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`配置资源读取失败（HTTP ${response.status}）`);
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
  if (manifest?.body?.dataBundleVer !== version)
    throw new Error("官方资源清单与账号配置版本不一致");
  const raw = manifest.body.bundleVers;
  const bundles = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!safeVersion(bundles?.config)) throw new Error("官方配置包版本无效");
  const bundle = await (await request(`${CDN}/remote/config/config.${bundles.config}.json`)).json();
  const readAsset = async (name) => {
    const entry = Object.entries(bundle.paths || {}).find(([, path]) =>
      path?.[0] === name && bundle.types?.[path[1]] === "cc.JsonAsset");
    const index = entry?.[0];
    const compressed = bundle.uuids?.[index];
    const versions = bundle.versions?.import || [];
    let hash;
    for (let i = 0; i < versions.length; i += 2)
      if (String(versions[i]) === index) hash = versions[i + 1];
    if (typeof compressed !== "string" || !/^[0-9a-f]{2}[A-Za-z0-9+/]{20}$/.test(compressed) || !safeVersion(hash))
      throw new Error(`官方配置资源索引无效：${name}`);
    const hex = compressed.slice(0, 2) + Array.from(atob(compressed.slice(2)),
      (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const asset = await (await request(`${CDN}/remote/config/import/${hex.slice(0, 2)}/${uuid}.${hash}.json`)).json();
    // Cocos serialized cc.JsonAsset: validate its type and named payload before use.
    if (asset?.[3]?.[0]?.[0] !== "cc.JsonAsset" || asset?.[5]?.[0]?.[1] !== name ||
        !asset[5][0][2] || typeof asset[5][0][2] !== "object")
      throw new Error(`官方配置资源格式无效：${name}`);
    return asset[5][0][2];
  };
  const config = await readAsset("config");
  if (config.COMMIT_ID !== version) throw new Error("官方配置内容与账号配置版本不一致");
  const extra = await readAsset("config_ap");
  if (extra.COMMIT_ID !== undefined && extra.COMMIT_ID !== version)
    throw new Error("官方补充配置版本不一致");
  return { ...extra, ...config };
}
