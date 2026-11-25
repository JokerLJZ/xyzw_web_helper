import { isChinaMonday } from "./mondayResourcePurchase.js";
import { chinaDayStart } from "./dailyTaskPolicy.js";

export async function runMondayFreeJade({ now, packs, getRole, claim }) {
  if (!isChinaMonday(new Date(now))) return { status: "skipped", reason: "仅周一领取" };
  const pack = Object.values(packs || {}).find(p => p.moduleType === 10055 && p.packSet === 6 &&
    p.buyOrder === 0 && p.price === 0 && p.paymentType === 0 && p.limit === 1 &&
    p.merchandise?.length === 1 && p.merchandise[0].type === 3 &&
    p.merchandise[0].itemId === 1022 && p.merchandise[0].value === 100);
  if (!pack) throw new Error("官方配置未找到十殿免费100白玉礼包");
  const key = `night:mare:buy:${pack.id}`;
  const claimed = role => Number(role.statistics?.[key]) >= pack.limit &&
    Number(role.statisticsTime?.[key]) * 1000 >= chinaDayStart(now);
  if (claimed(await getRole())) return { status: "skipped", reason: "本周已领取" };
  let error;
  try { await claim(pack.id); } catch (e) { error = e; }
  if (claimed(await getRole())) return { status: "completed" };
  return { status: "pending", reason: error?.message || "服务器尚未确认领取，未重试" };
}
