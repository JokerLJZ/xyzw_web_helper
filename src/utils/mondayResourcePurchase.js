/** game: CollectionService.exchange({goodsId,goodsNum}), LegionService.storeBuyGoods({id,num}). */
export const MONDAY_PURCHASES = [
  { name:'珍宝阁万能红将碎片', list:'collection_goodslist', buy:'collection_exchange', id:6001, costId:70001, price:5, limit:10, itemId:3201, amount:10 },
  { name:'盐晶兑换成长脆饼', list:'legion_storegoodslist', buy:'legion_storebuygoods', id:203, costId:1038, price:10, limit:60, itemId:15001, amount:1000 },
];
export const isChinaMonday = (date = new Date()) => new Date(date.getTime()+8*3600000).getUTCDay()===1;
const bodyOf = r => r?._raw?.body ?? r?.body ?? r;
function purchased(body, spec) {
  const map = spec.id===6001 ? body?.storeInfo?.exchangeStoreMap : body?.buyGoods;
  if (!map || typeof map!=='object') throw new Error(`${spec.name}未返回购买额度，停止`);
  const value = spec.id===6001 ? map[spec.id]?.buyNum ?? 0 : map[spec.id] ?? 0;
  if (!Number.isSafeInteger(value) || value<0) throw new Error(`${spec.name}购买额度无效`);
  return value;
}
export async function runMondayResourcePurchase({send, wait=async()=>{}, now=()=>new Date(), log=()=>{}}) {
  if (!isChinaMonday(now())) { log('万能红碎片及成长脆饼采购跳过：仅北京时间周一执行');return; }
  for(const spec of MONDAY_PURCHASES) {
    if (!isChinaMonday(now())) break;
    const role=bodyOf(await send('role_getroleinfo',{}))?.role;
    if (!role?.items) throw new Error('未获取到完整资源库存，停止周一采购');
    const balance=Number(role.items[spec.costId]?.quantity??0);
    if(!Number.isSafeInteger(balance)||balance<0)throw new Error('兑换资源数量无法确认');
    if(balance<spec.price){log(`${spec.name}余额不足，跳过`);continue;}
    await wait(1500);
    const count=purchased(bodyOf(await send(spec.list,{})),spec);
    const num=Math.min(Math.max(0,spec.limit-count),Math.floor(balance/spec.price));
    if(!num){log(`${spec.name}已达限购额度，跳过`);continue;}
    await wait(2500);
    if(!isChinaMonday(now()))break;
    await send(spec.buy,spec.id===6001?{goodsId:spec.id,goodsNum:num}:{id:spec.id,num});
    await wait(1500);
    const after=purchased(bodyOf(await send(spec.list,{})),spec);
    if(after!==count+num)throw new Error(`${spec.name}采购结果未确认，停止且不重试`);
    log(`${spec.name}成功兑换${num}份，共${num*spec.amount}个，消耗${num*spec.price}资源`,'success');
    await wait(2500);
  }
}
