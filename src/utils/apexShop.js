import { loadApexDailyConfig } from './apexDailyTask.js';
export const APEX_SHOP_OPTIONS = [
  { label: '成长脆饼 ×1000', value: 1 },
  { label: '幻彩灵果 ×20', value: 2 },
  { label: '四圣转星镜 ×1（30天）', value: 3 },
];
const body = r => {
  if (r?.code || r?.error) throw new Error(String(r.error || r.code));
  const b = r?.data ?? r?._raw?.body ?? r?.body ?? r;
  if (b?.code || b?.error) throw new Error(String(b.error || b.code));
  return b;
};
const get = (map, key) => map instanceof Map ? map.get(key) ?? map.get(String(key)) : map?.[key];
const count = n => { if (!Number.isSafeInteger(n) || n < 0) throw new Error('商店数量数据无效'); return n; };
export function apexExchangeCount(good, balance, bought) {
  if (!Number.isSafeInteger(good.limitNum) || good.limitNum < 0 || !Number.isSafeInteger(good.buyPrice?.[0]?.value) || good.buyPrice[0].value <= 0) throw new Error('商店配置无效');
  return Math.min(9999, Math.floor(count(balance) / good.buyPrice[0].value), good.limitNum ? Math.max(0, good.limitNum - count(bought)) : 9999);
}
export async function runApexShop({ send, selected, shouldStop = () => false, wait = async () => {}, log = () => {}, loadConfig = loadApexDailyConfig }) {
  if (!selected?.length) throw new Error('请先选择竞技大厅商店商品');
  const config = await loadConfig(send);
  const goods = Object.values(config.ApexShopConf || {}).filter(g => selected.includes(g.id)).sort((a,b) => a.order-b.order);
  if (goods.length !== new Set(selected).size) throw new Error('所选商品配置已变化，请重新选择');
  for (const good of goods) {
    while (!shouldStop()) {
      const info = body(await send('apex_getroleinfo', {}));
      const record = info?.apexRoleInfo?.buyRecord ?? info?.buyRecord;
      if (!record || typeof record !== 'object') throw new Error('未返回商店限购记录，停止兑换');
      const bought = count(get(record, good.id) ?? 0);
      const role = body(await send('role_getroleinfo', {}))?.role;
      const price = good.buyPrice?.[0];
      if (!role?.items || good.buyPrice.length !== 1 || price.type !== 3) throw new Error('库存或商品价格格式不支持');
      const balance = count(Number(get(role.items, price.itemId)?.quantity ?? 0));
      const num = apexExchangeCount(good, balance, bought);
      if (!num) { log(`商品${good.id}：余额不足或已达限购，跳过`); break; }
      await wait(500);
      if (shouldStop()) return;
      let failure;
      try { body(await send('apex_buy', { shopId: good.id, buyCnt: num })); } catch (e) { failure = e; }
      await wait(500);
      const after = body(await send('apex_getroleinfo', {}));
      const updated = after?.apexRoleInfo?.buyRecord ?? after?.buyRecord;
      if (!updated || count(get(updated, good.id) ?? 0) !== bought + num) throw new Error(`商品${good.id}兑换未确认：${failure?.message || '限购记录未更新'}，停止且不重试`);
      log(`商品${good.id}兑换${num}份成功`, 'success');
    }
  }
}
