import assert from 'node:assert/strict';
export function officialConfigFetch(version, config, extra = {}) {
  return async (url) => {
    assert.ok(!url.includes('/data/'), 'configuration must come directly from manifest assets');
    const json = value => ({ ok: true, json: async () => value });
    if (url.endsWith('index.html')) return { ok: true, text: async () => '<script src="game-defines.current.js"></script>' };
    if (url.endsWith('.js')) return { ok: true, text: async () => "REMOTE_MANIFEST_VERSION='0.36.0-android'" };
    if (url.includes('manifest?')) return json({ body: { dataBundleVer: version, bundleVers: { config: 'current' } } });
    if (url.endsWith('config.current.json')) return json({
      paths: { 0: ['config', 0], 1: ['config_ap', 0] }, types: ['cc.JsonAsset'],
      uuids: ['26o/E4KtRL9qAK/uLSVEKB', '18WuPN/WlMS7LJskr2jYL0'], versions: { import: [0, 'main', 1, 'extra'] },
    });
    const name = url.endsWith('.main.json') ? 'config' : 'config_ap';
    return json([1, 0, 0, [['cc.JsonAsset']], [], [[0, name, name === 'config' ? { ...config, COMMIT_ID: version } : extra]]]);
  };
}
