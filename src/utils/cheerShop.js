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
    while (!shouldStop()) {
      const count = readCount(await send('legion_storegoodslist', {}), good.id);
      if (count >= good.target) { log(`${good.name}：已达到本期目标 ${good.target} 份，跳过`); break; }
      if (shouldStop()) return;
      const role = bodyOf(await send('role_getroleinfo', {}))?.role;
      if (!role?.items) throw new Error('未取得当前账号库存，停止采购');
      const balance = Number(role.items[2101]?.quantity ?? 0);
      if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('助威币库存无效');
      if (balance < good.price) { log(`${good.name}：助威币不足（现有 ${balance}，每份需 ${good.price}），跳过`); break; }
      await wait(500);
      if (shouldStop()) return;
      log(`${good.name}（商品 ${good.id}）：准备购买 1 份，本期已购 ${count}/${good.target}，助威币 ${balance}，单价 ${good.price}`);
      let failure;
      try {
        // LegionShopDialog uses the default num=0 for non-salt-crystal stores.
        // Only the salt-crystal quantity dialog passes a positive quantity.
        bodyOf(await send('legion_storebuygoods', { id: good.id, num: 0 }));
      } catch (error) {
        failure = error;
      }
      await wait(500);
      // Even a timeout may have consumed currency. Confirm once, never resend it.
      const after = readCount(await send('legion_storegoodslist', {}), good.id);
      if (after !== count + 1) {
        throw new Error(`${good.name}（商品 ${good.id}）购买未确认：${failure?.message || '已购额度未按预期增加1份'}；已购 ${count}→${after}，助威币 ${balance}，单价 ${good.price}；已停止，不自动重试`);
      }
      log(`${good.name}：购买 1 份，消耗 ${good.price} 助威币，本期已购 ${after}/${good.target}`, 'success');
      await wait(500);
    }
  }
}
