import { bon } from '../src/utils/bonProtocol.js';
import assert from 'node:assert/strict';
export function officialConfigFetch(version, config, extra = {}, language = {}, binary = false, level = {}) {
  return async (url) => {
    assert.ok(!url.includes('/data/'), 'configuration must come directly from manifest assets');
    const json = value => ({ ok: true, json: async () => value });
    if (url.endsWith('index.html')) return { ok: true, text: async () => '<script src="game-defines.current.js"></script>' };
    if (url.endsWith('.js')) return { ok: true, text: async () => "REMOTE_MANIFEST_VERSION='0.36.0-android'" };
    if (url.includes('manifest?')) return json({ body: { dataBundleVer: version, bundleVers: { config: 'current' } } });
    if ((url.endsWith('config.current.json') || url.endsWith(`config.${version}.json`))) return json({
      paths: { 0: ['config', 0], 1: ['config_ap', 0], 2: ['language', 0], 3: ['configc', 1], 4: ['config_apc', 1], 5: ['level', 0] }, types: ['cc.JsonAsset', 'cc.BufferAsset'],
      uuids: ['26o/E4KtRL9qAK/uLSVEKB', '18WuPN/WlMS7LJskr2jYL0', '3fs0Hd5JVMdrtOfSTNMwjr', '26o/E4KtRL9qAK/uLSVEKB', '18WuPN/WlMS7LJskr2jYL0', '26o/E4KtRL9qAK/uLSVEKB'], versions: { import: [0, 'main', 1, 'extra', 2, 'language', 5, 'level'], native: [3, 'binary', 4, 'extra-binary'] },
    });
    if (url.endsWith('.bin')) return { ok: true, arrayBuffer: async () => bon.encode(url.endsWith('.binary.bin') ? { ...config, COMMIT_ID: version } : extra).buffer };
    const name = url.endsWith('.level.json') ? 'level' : url.endsWith('.main.json') ? 'config' : url.endsWith('.language.json') ? 'language' : 'config_ap';
    return json([1, 0, 0, [['cc.JsonAsset']], [], [[0, name, name === 'config' ? { ...config, COMMIT_ID: version } : name === 'language' ? language : name === 'level' ? level : extra]]]);
  };
}
