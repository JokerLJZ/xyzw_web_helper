import { activityBody, mapEntries, mapGet } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";

const integer = (value, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`篝火${label}数据异常`);
  return value;
};

/** ClubWarLotteryDialog3 → ClubWarModule.sendGetLotteryData → ClubService.draw({}). */
export async function runCampfireLottery({ id, send, config, log = () => {}, storage = globalThis.localStorage }) {
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
    return { roleId: role.roleId, stock, boxId: siege.boxId, cost: chests[index].drawCost.value, nextBoxId: chests[(index + 1) % chests.length].id };
  };
  let state = await snapshot();
  const key = `xyzw:campfire-draw:${state.roleId}`;
  if (!storage) throw new Error("无法保存篝火抽奖记录，停止操作");
  const save = value => value ? storage.setItem(key, JSON.stringify(value)) : storage.removeItem(key);
  const pending = JSON.parse(storage.getItem(key) || "null");
  const confirmed = (before, after) => before.roleId === after.roleId && after.stock === before.stock - before.cost && after.boxId === before.nextBoxId;
  if (pending) {
    if (!confirmed(pending, state)) throw new Error("上次篝火抽奖结果待核实，停止且不重复抽奖");
    save(null);
    log("已通过库存与篝火等级确认上次抽奖，继续剩余道具");
  }
  // Bound this run by the initial inventory; never consume newly acquired stock forever.
  const limit = Math.floor(state.stock / Math.min(...chests.map(row => row.drawCost.value)));
  let draws = 0, spent = 0;
  while (state.stock >= state.cost && draws < limit) {
    const before = state;
    save({ ...before, accountId: id });
    try { await send("club_draw", {}); }
    catch (error) {
      if (error.serverRejected) save(null);
      if (error.stopped) throw error;
      // Query only. An uncertain paid request must never be sent again.
      await snapshot().catch(() => {});
      throw new Error(`篝火抽奖结果待核实，停止且不自动重试：${error.message}`);
    }
    state = await snapshot();
    if (!confirmed(before, state)) throw new Error("篝火道具扣除或等级变化未确认，停止且不重复抽奖");
    save(null);
    draws++; spent += before.cost;
    log(`篝火第${draws}次抽奖已确认，累计消耗${spent}个种火石，剩余${state.stock}个`);
  }
  return { status: draws ? "completed" : "skipped", draws, spent, remaining: state.stock,
    reason: draws ? `篝火抽奖${draws}次，消耗${spent}个种火石，剩余${state.stock}个` : "种火石不足一次抽奖，已跳过" };
}
