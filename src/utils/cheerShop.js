/** Official 2.52.1 LegionStoreConf, config_ap cbb769dfb4 (2026-11-02). */
export const CHEER_SHOP_GOODS = [
  { id: 7, name: '随机红将碎片 ×100', price: 20, limit: 1 },
  { id: 8, name: '白玉 ×2000', price: 20, limit: 1 },
  { id: 9, name: '军团币 ×1000', price: 20, limit: 1 },
  { id: 10, name: '进阶石 ×1600', price: 20, limit: 20 },
  { id: 11, name: '精铁 ×4000', price: 20, limit: 20 },
  { id: 12, name: '四圣转星镜 ×1（3天有效）', price: 150, limit: 1 },
];
const bodyOf = r => {
  if (r?.code || r?.error) throw new Error(r.error || `服务器返回错误 ${r.code}`);
  const body = r?._raw?.body ?? r?.body ?? r;
  if (body?.code || body?.error) throw new Error(body.error || `服务器返回错误 ${body.code}`);
  return body;
};
const readCount = (response, id) => {
  const map = bodyOf(response)?.buyGoods;
  if (!map || typeof map !== 'object') throw new Error('未返回商店限购状态，停止采购');
  const value = (map instanceof Map ? map.get(id) ?? map.get(String(id)) : map[id]) ?? 0;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('商店限购状态无效');
  return value;
};
export async function runCheerShopPurchase({ send, purchases, shouldStop = () => false, wait = async () => {}, log = () => {} }) {
  const plan = CHEER_SHOP_GOODS.map(good => ({ ...good, target: Number(purchases?.[good.id] ?? 0) }));
  if (plan.some(g => !Number.isSafeInteger(g.target) || g.target < 0 || g.target > g.limit)) throw new Error('采购数量超出限购范围');
  for (const good of plan.filter(g => g.target > 0)) {
    if (shouldStop()) return;
    const count = readCount(await send('legion_storegoodslist', {}), good.id);
    const role = bodyOf(await send('role_getroleinfo', {}))?.role;
    if (!role?.items) throw new Error('未取得当前账号库存，停止采购');
    const balance = Number(role.items[2101]?.quantity ?? 0);
    if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('助威币库存无效');
    // Target is this period's total, so subsequent runs do not buy the same quota again.
    const num = Math.min(Math.max(0, good.target - count), Math.floor(balance / good.price));
    if (!num) { log(`${good.name}：已达到目标或助威币不足，跳过`); continue; }
    await wait(500);
    if (shouldStop()) return;
    try {
      bodyOf(await send('legion_storebuygoods', { id: good.id, num }));
    } catch (error) {
      // A timeout may already have consumed currency. Query once, never repeat the write.
      const after = readCount(await send('legion_storegoodslist', {}), good.id);
      if (after !== count + num) throw new Error(`购买未确认：${error.message}；已停止，不自动重试`);
    }
    const after = readCount(await send('legion_storegoodslist', {}), good.id);
    if (after !== count + num) throw new Error('购买额度未按预期更新，已停止，不自动重试');
    log(`${good.name}：购买 ${num} 份，消耗 ${num * good.price} 助威币`, 'success');
    await wait(500);
  }
}
