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

// 重生还会清除精炼、天赋；锁定宠物保留，写入后仅查询确认，不重发。
export async function concentratePetExperience({ getRole, send, wait = async()=>{}, shouldStop = ()=>false, onResult = ()=>{} }) {
  let role = await getRole();
  const targetId = equippedId(role);
  if (!targetId) throw new Error('无法确认已佩戴宠物');
  const inventory = () => {
    if (!role?.petData?.pets || equippedId(role) !== targetId) throw new Error('宠物列表或佩戴状态发生变化，停止');
    return Object.entries(role.petData.pets).map(([slot, pet]) => ({...pet, slot:Number(slot)}));
  };
  const quantity = () => role?.items ? Number(role.items[15001]?.quantity ?? 0) : NaN;
  let reset = 0, upgrades = 0;
  for (const candidate of inventory()) {
    if (shouldStop()) break;
    const pet = inventory().find(p=>p.uId === candidate.uId);
    if (!pet || pet.uId === targetId || !(pet.level > 1)) continue;
    if (pet.isLocked || Object.values(pet.quenches ?? {}).some(q=>q?.locked)) {
      onResult({action:'locked', pet});continue;
    }
    if (!Number.isInteger(pet.slot) || pet.slot < 0 || typeof pet.uId !== 'string') throw new Error('重生宠物身份不完整');
    const before = quantity();
    if (!Number.isFinite(before)) throw new Error('无法确认脆饼库存');
    await wait(PET_MERGE_OPERATION_DELAY);
    if (shouldStop()) break;
    await send('pet_reset',{slotUId:{slot:pet.slot,uId:pet.uId}});
    await wait(PET_MERGE_QUERY_DELAY);
    role = await getRole();
    const after = inventory().find(p=>p.uId === pet.uId);
    if (!after || (after.level ?? 0) !== 0 || !Number.isFinite(quantity()) || quantity() < before) throw new Error('宠物重生或脆饼回收未确认，停止且不重试');
    reset++;onResult({action:'reset',pet,recovered:quantity()-before});
  }
  while (!shouldStop()) {
    const pet = inventory().find(p=>p.uId === targetId);
    const before = quantity();
    if (!pet || !Number.isFinite(before)) throw new Error('无法确认佩戴宠物或脆饼库存');
    if (before <= 0) break;
    await wait(PET_MERGE_OPERATION_DELAY);
    if (shouldStop()) break;
    await send('pet_useexpitem',{slotUId:{slot:pet.slot,uId:pet.uId},isOneClick:true});
    await wait(PET_MERGE_QUERY_DELAY);
    role = await getRole();
    const after = inventory().find(p=>p.uId === targetId);
    const remaining = quantity();
    if (!after || !Number.isFinite(remaining)) throw new Error('升级后状态无法确认');
    if (after.level === pet.level && after.exp === pet.exp && remaining === before) break;
    if (remaining >= before || (after.level ?? 0) < (pet.level ?? 0)) throw new Error('升级进度或消耗异常，停止且不重试');
    upgrades++;onResult({action:'upgrade',pet:after});
  }
  return {reset,upgrades,stopped:shouldStop()};
}
