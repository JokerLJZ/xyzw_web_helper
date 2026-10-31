import { PET_MERGE_CONFIG, PET_MERGE_OPERATION_DELAY, PET_MERGE_QUERY_DELAY } from './petMerge.js';
import { PET_EQUIP_CONFIG } from './petEquipConfig.js';
const bodyOf = result => result?._raw?.body ?? result?.body ?? result;
const equippedId = role => role?.petData?.pets?.[-1]?.uId ?? role?.pet?.petUId ?? role?.pet?.uId;
const attributePriority = pet => ({ armorBreak: 2, block: 1 }[PET_EQUIP_CONFIG[pet.petId]?.attribute] ?? 0);

// 保留旧函数名以兼容已有任务标识；实际按品质、技能属性、等级选择。
// PetEquipDialog._onClickUse: PetService.load({slotUId:{slot,uId}}).
export function selectHighestLevelPet(role) {
  const equipped = equippedId(role);
  return Object.entries(role?.petData?.pets ?? {}).flatMap(([key, pet]) => {
    const slot = Number(key);
    const level = pet?.level ?? 0;
    if (!pet || !PET_EQUIP_CONFIG[pet.petId] || !Number.isInteger(slot) || slot < -1 || typeof pet.uId !== 'string' || !pet.uId || !Number.isSafeInteger(level) || level < 0) return [];
    return [{ ...pet, level, slot }];
  }).sort((a, b) =>
    PET_EQUIP_CONFIG[b.petId].color - PET_EQUIP_CONFIG[a.petId].color ||
    attributePriority(b) - attributePriority(a) ||
    b.level - a.level ||
    Number(b.uId === equipped) - Number(a.uId === equipped) ||
    a.uId.localeCompare(b.uId)
  )[0] ?? null;
}

export async function equipHighestLevelPet({ getRole, send, wait = async()=>{}, shouldStop = ()=>false }) {
  const role = await getRole();
  if (!role?.petData?.pets) throw new Error('未获取到完整宠物列表');
  const target = selectHighestLevelPet(role);
  if (!target) return { changed:false, reason:'missing' };
  if (target.uId === equippedId(role)) return { changed:false, reason:'equipped', target };
  await wait(PET_MERGE_OPERATION_DELAY);
  if (shouldStop()) return { changed:false, reason:'stopped' };
  await send('pet_load', {slotUId:{slot:target.slot,uId:target.uId}});
  await wait(PET_MERGE_QUERY_DELAY);
  const after = await getRole();
  if (equippedId(after)!==target.uId) throw new Error('响应未确认优先宠物已佩戴，停止且不重试');
  return { changed:true, target };
}

// PetState.Unclaimed=0, Claimed=1, Locked=2；bookReward值1表示已领奖。
export async function activatePetBooks({ getRole, send, wait = async()=>{}, shouldStop = ()=>false, onResult=()=>{} }) {
  let role = await getRole(), activated=0, claimed=0;
  if (!role?.petData?.books || !role.petData.bookReward) throw new Error('未获取到完整宠物图鉴及领奖状态');
  const ids = Object.keys(role.petData.books).map(Number).filter(id=>PET_MERGE_CONFIG[id]).sort((a,b)=>a-b);
  for (const petId of ids) {
    if (shouldStop()) break;
    if (role.petData.books[petId] === 0) {
      await wait(PET_MERGE_OPERATION_DELAY);
      if (shouldStop()) break;
      const result=bodyOf(await send('pet_activatebook',{petId}));
      await wait(PET_MERGE_QUERY_DELAY);
      role=await getRole();
      if (role?.petData?.books?.[petId]!==1 || result?.role?.petData?.books?.[petId]!==1) throw new Error(`宠物${petId}图鉴激活未确认，停止且不重试`);
      activated++;onResult({petId,action:'activate'});
    }
    if (shouldStop()) break;
    if (role.petData.books[petId]===1 && role.petData.bookReward?.[petId]!==1) {
      await wait(PET_MERGE_OPERATION_DELAY);
      if (shouldStop()) break;
      const result=bodyOf(await send('pet_claimbookreward',{petId}));
      await wait(PET_MERGE_QUERY_DELAY);
      role=await getRole();
      if (role?.petData?.bookReward?.[petId]!==1 || result?.role?.petData?.bookReward?.[petId]!==1) throw new Error(`宠物${petId}图鉴领奖未确认，停止且不重试`);
      claimed++;onResult({petId,action:'claim'});
    }
  }
  return { activated, claimed };
}
