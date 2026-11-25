import { mapGet, mapEntries, activityText } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";

const roleOf = value => extractRolePatch(value) || value;
const claimed = (role, id) => mapGet(role?.skinBook, id) === true;

export function planSkinBookRewards(role, config) {
  if (!role?.heroes || !config?.SkinConf) throw new Error("皮肤图鉴角色或配置数据不完整");
  return mapEntries(config.SkinConf).map(([, skin]) => skin).filter(skin => {
    if (!skin.isBook || !(skin.bookPoint > 0) || claimed(role, skin.id)) return false;
    const hero = mapGet(role.heroes, skin.heroId);
    return Number(mapGet(hero?.skin, skin.id)?.expiration) === -1;
  }).map(skin => ({ skinId: skin.id, name: activityText(config, skin.skinName), points: skin.bookPoint }));
}

/** Confirm each claim from an explicit incremental marker or one fresh role query. */
export async function claimSkinBookRewards({ config, getRole, send, wait = async () => {}, stopped = () => false, log = () => {} }) {
  let role = roleOf(await getRole());
  const plan = planSkinBookRewards(role, config);
  let count = 0;
  for (const skin of plan) {
    if (stopped()) break;
    await wait();
    if (stopped()) break;
    let response, failure;
    try { response = await send("book_claimskinpoint", { skinId: skin.skinId }); }
    catch (error) { failure = error; }
    const patch = extractRolePatch(response);
    if (claimed(patch, skin.skinId)) {
      role.skinBook ||= {};
      if (role.skinBook instanceof Map) role.skinBook.set(skin.skinId, true);
      else role.skinBook[skin.skinId] = true;
    } else {
      role = roleOf(await getRole());
      if (!claimed(role, skin.skinId)) throw failure || new Error(`${skin.name}（${skin.skinId}）皮肤图鉴领取未确认`);
    }
    count++;
    log(`领取${skin.name}（${skin.skinId}）皮肤图鉴积分${skin.points}`);
  }
  return { claimed: count, role };
}
