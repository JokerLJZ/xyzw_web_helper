import { PET_MERGE_CONFIG, PET_MERGE_OPERATION_DELAY, PET_MERGE_QUERY_DELAY } from './petMerge.js';
const bodyOf = result => result?._raw?.body ?? result?.body ?? result;
const equippedId = role => role?.petData?.pets?.[-1]?.uId ?? role?.pet?.petUId ?? role?.pet?.uId;
const redCount = pet => Object.values(pet.quenches ?? {}).filter(q => q.color === 6 || q.colorId === 6).length;

// PetEquipDialog._onClickUse: PetService.load({slotUId:{slot,uId}}).
export function selectHighestLevelPet(role) {
  const equipped = equippedId(role);
  return Object.entries(role?.petData?.pets ?? {}).flatMap(([key, pet]) => {
    const slot = Number(key);
    if (!pet || !Number.isInteger(slot) || slot < -1 || typeof pet.uId !== 'string' || !pet.uId || !Number.isSafeInteger(pet.level) || pet.level < 1) return [];
    return [{ ...pet, slot }];
  }).sort((a,b) => b.level-a.level || Number(b.uId===equipped)-Number(a.uId===equipped) || (PET_MERGE_CONFIG[b.petId]?.color??0)-(PET_MERGE_CONFIG[a.petId]?.color??0) || redCount(b)-redCount(a) || a.uId.localeCompare(b.uId))[0] ?? null;
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
  if (equippedId(after)!==target.uId) throw new Error('响应未确认最高等级宠物已佩戴，停止且不重试');
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
