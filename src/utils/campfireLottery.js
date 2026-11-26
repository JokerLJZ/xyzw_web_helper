import { activityBody, mapEntries, mapGet } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";

const integer = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`篝火${label}数据异常`);
  return value;
};

/** ClubWarLotteryDialog3 → ClubWarModule.sendGetLotteryData → ClubService.draw({}). */
export async function runCampfireLottery({ send, config, log = () => {} }) {
  const itemId = integer(config.ClubWarConstantConf?.chestItemId, "种火石配置", 1);
  const chests = mapEntries(config.ClubWarChestConf).map(([, row]) => row).sort((a, b) => a.id - b.id);
  if (!chests.length || new Set(chests.map(row => row.id)).size !== chests.length) throw new Error("篝火奖池配置缺失或重复");
  for (const row of chests) {
    integer(row.id, "等级配置", 1);
    if (row.drawCost?.type !== 3 || row.drawCost.itemId !== itemId) throw new Error("篝火抽奖消耗不是种火石，停止操作");
    integer(row.drawCost.value, "单次消耗", 1);
  }
  const snapshot = async () => {
    const roleResponse = await send("role_getroleinfo", {});
    const role = extractRolePatch(roleResponse);
    integer(role?.roleId, "角色身份", 1);
    if (!role.items || typeof role.items !== "object" || Array.isArray(role.items)) throw new Error("未取得该账号种火石库存");
    const item = mapGet(role.items, itemId);
    const stock = integer(item === undefined ? 0 : item?.quantity, "种火石库存");
    const siege = activityBody(await send("club_getinfo", {}))?.siege;
    if (!siege || typeof siege !== "object" || Array.isArray(siege)) throw new Error("篝火快照缺少本人数据");
    if (siege.roleId !== undefined && siege.roleId !== 0 && siege.roleId !== role.roleId) throw new Error("篝火快照身份不一致");
    const index = chests.findIndex(row => row.id === siege.boxId);
    if (index < 0) throw new Error("篝火等级缺失或与当前配置不匹配");
    return { roleId: role.roleId, stock, cost: chests[index].drawCost.value };
  };
  let state = await snapshot();
  // Bound this run by the initial inventory; never consume newly acquired stock forever.
  const limit = Math.floor(state.stock / Math.min(...chests.map(row => row.drawCost.value)));
  let draws = 0, spent = 0;
  while (state.stock >= state.cost && draws < limit) {
    const before = state;
    await send("club_draw", {});
    state = await snapshot();
    if (state.roleId !== before.roleId) throw new Error("抽奖后角色身份不一致，停止操作");
    if (state.stock >= before.stock) throw new Error("抽奖后种火石库存未减少，停止本轮");
    draws++;
    spent += before.cost;
    log(`篝火第${draws}次抽奖，累计消耗${spent}个种火石，剩余${state.stock}个`);
  }
  return { status: draws ? "completed" : "skipped", draws, spent, remaining: state.stock,
    reason: draws ? `篝火抽奖${draws}次，消耗${spent}个种火石，剩余${state.stock}个` : "种火石不足一次抽奖，已跳过" };
}
