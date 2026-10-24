// Evidence: SourceMap.navPath / TMAStar2 / current Cocos bundle TiledMapAsset.
export const SALT_HEX_DIR = [
  [[-1, -1], [0, -1], [1, -1], [1, 0], [0, 1], [-1, 0]],
  [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1]],
];
export const entries = value => value instanceof Map ? [...value.entries()] : Object.entries(value || {});
export const get = (value, key) => value instanceof Map ? (value.get(key) ?? value.get(String(key)) ?? value.get(Number(key))) : value?.[key];
const attrs = text => Object.fromEntries([...text.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const resources = new Map();
const CDN = "https://xxz-xyzw-res.hortorgames.com/remote";
const bundleNames = { 1: "demoMap", 3: "IntroMap_03", 4: "IntroMap_01", 5: "IntroMap_06", 6: "IntroMap_04", 7: "IntroMap_05", 8: "IntroMap_02" };
export function saltMapSpec(info, config) {
  const row = entries(config.LegionWarMapTypeMappingConf).map(([, v]) => v).find(v => Number(v.legionWarMapType) === Number(info.legionWarMapType));
  const mapId = Number(row?.mapId);
  if (!bundleNames[mapId]) throw new Error("该盐场地图尚未适配，仅支持普通盐场地图");
  return { mapId, bundle: bundleNames[mapId], asset: mapId === 1 ? "legionWarMap" : Number(info.legionWarMapType) === 14 ? "map02" : Number(info.legionWarMapType) === 15 ? "map03" : "map01", center: { x: 20, y: 17 } };
}
export function decodeCocosUuid(uuid) {
  if (uuid.length !== 22) {
    if (/^[\da-f-]{36}$/i.test(uuid)) return uuid;
    throw new Error("地图资源UUID格式已变化");
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", hex = "0123456789abcdef";
  let value = uuid.slice(0, 2);
  for (let i = 2; i < 22; i += 2) {
    const a = chars.indexOf(uuid[i]), b = chars.indexOf(uuid[i + 1]);
    if (a < 0 || b < 0) throw new Error("地图UUID无效");
    value += hex[a >> 2] + hex[((a & 3) << 2) | (b >> 4)] + hex[b & 15];
  }
  return value.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}
export function parseSaltTmx(xml) {
  const map = attrs(xml.match(/<map\s([^>]+)>/)?.[1] || "");
  const width = Number(map.width), height = Number(map.height);
  if (map.orientation !== "hexagonal" || map.staggeraxis !== "x" || map.staggerindex !== "odd" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 100000) throw new Error("盐场地图方向或尺寸不支持");
  const layers = {};
  for (const m of xml.matchAll(/<layer\s([^>]+)>([\s\S]*?)<\/layer>/g)) {
    const layer = attrs(m[1]), data = m[2].match(/<data([^>]*)>([\s\S]*?)<\/data>/);
    if (!["data", "building"].includes(layer.name)) continue;
    if (!data || attrs(data[1]).encoding !== "csv") throw new Error("盐场地图编码已变化");
    const values = data[2].trim().split(/\s*,\s*/).map(Number);
    if (values.length !== width * height || values.some(v => !Number.isInteger(v) || v < 0)) throw new Error("盐场地图图层不完整");
    layers[layer.name] = values.map(v => (v >>> 0) & 0x1fffffff);
  }
  if (!layers.data || !layers.building) throw new Error("盐场地图缺少通行或建筑图层");
  const types = {};
  for (const m of xml.matchAll(/<tileset\s([^>]+)>([\s\S]*?)<\/tileset>/g)) {
    const base = Number(attrs(m[1]).firstgid);
    for (const t of m[2].matchAll(/<tile\s([^>]+)>([\s\S]*?)<\/tile>/g)) {
      for (const p of t[2].matchAll(/<property\s([^>]+)\/?\s*>/g)) {
        const a = attrs(p[1]);
        if (a.name === "type") types[base + Number(attrs(t[1]).id)] = Number(a.value);
      }
    }
  }
  return { width, height, layers, types };
}
const findXml = value => {
  if (typeof value === "string" && value.includes("<map ")) return value;
  if (Array.isArray(value)) for (const child of value) { const xml = findXml(child); if (xml) return xml; }
  return null;
};
export async function loadSaltMap(info, config, fetcher = globalThis.fetch) {
  const spec = saltMapSpec(info, config);
  const json = async url => { const r = await fetcher(url, { signal: AbortSignal.timeout(30000), cache: "no-cache" }); if (!r.ok) throw new Error(`盐场地图下载失败(${r.status})`); return r.json(); };
  const response = await fetcher("https://xxz-xyzw.hortorgames.com/login/manifest?platform=hortor&version=0.36.0-android", { method: "POST", headers: { "Content-Type": "application/json;charset=UTF-8" }, body: "", signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error("盐场资源清单下载失败");
  let body = (await response.json()).body;
  if (typeof body === "string") body = JSON.parse(body);
  const versions = typeof body?.bundleVers === "string" ? JSON.parse(body.bundleVers) : body?.bundleVers;
  const hash = versions?.[spec.bundle];
  if (typeof hash !== "string" || !/^[\w-]+$/.test(hash)) throw new Error("盐场地图版本缺失");
  const key = `${spec.bundle}/${hash}/${spec.asset}`;
  if (!resources.has(key)) {
    const loading = (async () => {
      const bundle = await json(`${CDN}/${spec.bundle}/config.${hash}.json`);
      const assetId = Object.keys(bundle.paths || {}).find(id => bundle.paths[id][0] === spec.asset && bundle.types[bundle.paths[id][1]] === "cc.TiledMapAsset");
      if (assetId === undefined) throw new Error("当前盐场地图资源未找到");
      const id = decodeCocosUuid(bundle.uuids[Number(assetId)]), versions = bundle.versions?.import || [];
      const index = versions.findIndex((v, i) => i % 2 === 0 && String(v) === assetId), version = versions[index + 1];
      if (index < 0 || !/^[\w-]+$/.test(version)) throw new Error("地图导入版本缺失");
      const xml = findXml(await json(`${CDN}/${spec.bundle}/import/${id.slice(0, 2)}/${id}.${version}.json`));
      if (!xml) throw new Error("当前盐场地图数据无法解析");
      return { ...parseSaltTmx(xml), ...spec, version: key };
    })();
    resources.set(key, loading);
    loading.catch(() => resources.delete(key));
  }
  return resources.get(key);
}
// BFS yields the shortest legal hex route. Interior buildings must be owned;
// target may be hostile, matching TMAStar2's special destination handling.
export function saltRoute(map, buildings, legionId, start, target) {
  const inside = p => p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
  if (!inside(start) || !inside(target)) return [];
  const key = p => `${p.x}_${p.y}`, at = p => p.y * map.width + p.x;
  if (key(start) === key(target)) return [start];
  const saltType = 6; // types-tiled BuildingType.SaltPan, checked by map property below.
  const type = p => map.types[map.layers.building[at(p)]] || 0;
  const saltCenter = p => type(p) === saltType && p.y > 0 && p.y < map.height - 1 && type({ x: p.x, y: p.y - 1 }) === saltType && type({ x: p.x, y: p.y + 1 }) === saltType;
  const thorough = p => inside(p) && map.layers.data[at(p)] !== 0 && !(type(p) === saltType && !saltCenter(p)) && (!get(buildings, key(p)) || Number(get(buildings, key(p)).belongsLegionId) === Number(legionId));
  const center = map.center || { x: 20, y: 17 }, forced = new Set();
  if ((key(start) === key(center) || key(target) === key(center) || thorough(center)) && inside(center)) for (const [dx, dy] of SALT_HEX_DIR[center.x & 1]) forced.add(`${center.x + dx}_${center.y + dy}`);
  const queue = [start], previous = new Map([[key(start), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of SALT_HEX_DIR[p.x & 1]) {
      const q = { x: p.x + dx, y: p.y + dy }, k = key(q);
      if (!inside(q) || previous.has(k)) continue;
      // TMAStar2's seventh argument is a forced-pass list, NOT a blacklist.
      // SourceMap then rejects hostile salt-pan skirts and excess hostile buildings.
      const centerOwner = Number(get(buildings, key(center))?.belongsLegionId);
      const foreignSkirt = type(q) === saltType && !saltCenter(q) && centerOwner !== Number(legionId) && !saltCenter(start) && !saltCenter(target);
      if (foreignSkirt) continue;
      if (k !== key(target) && !thorough(q) && !forced.has(k)) continue;
      if (k !== key(target) && get(buildings, k) && Number(get(buildings, k).belongsLegionId) !== Number(legionId)) continue;
      previous.set(k, p);
      if (k === key(target)) { const route = [q]; let parent = p; while (parent) { route.unshift(parent); parent = previous.get(key(parent)); } return route; }
      queue.push(q);
    }
  }
  return [];
}
