import test from 'node:test';
import assert from 'node:assert/strict';
import { officialConfigFetch } from './officialConfigFixture.js';
import { loadWarehouseItemConfig } from '../src/utils/warehouseItemNames.js';
import { formatWarehouseItem } from '../src/utils/warehouseItemNames.js';

test('仓库从同一个配置包读取道具和语言，不再访问旧直链，并按版本缓存', async () => {
  const version = 'warehouse-manifest-test';
  const items = { ItemConf: { 3007: { name: 'red' }, 5294: { name: 'fish' }, 5296: { name: 'badge' }, 5297: { name: 'feather' } } };
  const language = { LanguageConf: { items: { red: { chinese: '随机红将碎片' }, fish: { chinese: '玄鱼令' }, badge: { chinese: '凤仪金徽' }, feather: { chinese: '灼华赤羽' } } } };
  let reads = 0;
  const fetcher = async (...args) => { reads++; return officialConfigFetch(version, items, {}, language)(...args); };
  const send = async () => ({ dataBundleVer: version });
  const config = await loadWarehouseItemConfig(send, fetcher);
  assert.equal(formatWarehouseItem(3007, config), '随机红将碎片（3007）');
  assert.equal(formatWarehouseItem(5294, config), '玄鱼令（5294）');
  assert.equal(formatWarehouseItem(5296, config), '凤仪金徽（5296）');
  assert.equal(formatWarehouseItem(5297, config), '灼华赤羽（5297）');
  assert.equal(await loadWarehouseItemConfig(send, fetcher), config);
  assert.equal(reads, 7);
});

test('语言配置缺失时加载失败允许重试，不缓存不完整配置', async () => {
  const version = 'warehouse-language-retry';
  const send = async () => ({ dataBundleVer: version });
  await assert.rejects(loadWarehouseItemConfig(send, officialConfigFetch(version, { ItemConf: {} })), /语言配置缺失/);
  const config = await loadWarehouseItemConfig(send, officialConfigFetch(version, { ItemConf: {} }, {}, { LanguageConf: {} }));
  assert.equal(config.version, version);
});
