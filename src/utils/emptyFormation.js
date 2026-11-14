import { bon } from './bonProtocol.js';
import { activityBody, mapEntries, mapGet } from './rechargeActivity.js';
const configs = new Map();
export async function loadEmptyFormationConfig(send, fetcher = globalThis.fetch) {
  const version = activityBody(await send('system_getdatabundlever', {isAudit:false}))?.dataBundleVer;
  if (typeof version !== 'string' || !/^[\w-]+$/.test(version)) throw new Error('未取得武将配置版本');
  if (!configs.has(version)) {
    const loading = (async()=>{
      const res = await fetcher(`https://xxz-xyzw-res.hortorgames.com/data/${version}/configc.bin`, {signal:AbortSignal.timeout(30000)});
      if (!res.ok) throw new Error('武将配置读取失败');
      const config = bon.decode(new Uint8Array(await res.arrayBuffer()));
      if (!config.HeroConf) throw new Error('缺少武将品质配置');
      return config;
    })();
    configs.set(version,loading);loading.catch(()=>configs.delete(version));
  }
  return configs.get(version);
}
export function planEmptyFormation(role, config) {
  if (!role?.heroes || !role.petData?.pets) throw new Error('武将或宠物状态不完整');
  const candidates = mapEntries(role.heroes).map(([id,h])=>({...h,heroId:Number(h.heroId??h.id??id)}))
    .filter(h=>Number(mapGet(config.HeroConf,h.heroId)?.color)===1);
  if (!candidates.length) throw new Error('没有已拥有的紫将，未调整阵容');
  if (candidates.some(h=>!Number.isFinite(Number(h.star)) || !Number.isFinite(Number(h.level)))) throw new Error('紫将星级或等级状态不完整');
  candidates.sort((a,b)=>Number(a.star)-Number(b.star)||Number(a.level)-Number(b.level)||a.heroId-b.heroId);
  const pet = mapGet(role.petData.pets,-1);
  let emptySlot;
  if (pet?.uId) {
    const capacity = Number(role.petData.unlockedSlot ?? 8);
    if (!Number.isInteger(capacity)||capacity<8||capacity>16) throw new Error('宠物槽位数据异常');
    emptySlot = Array.from({length:capacity},(_,i)=>i+1).find(slot=>!mapGet(role.petData.pets,slot)?.uId);
    if (!emptySlot) throw new Error('宠物栏已满，无法卸下宠物，未调整阵容');
  }
  return {hero:candidates[0],emptySlot,petUid:pet?.uId};
}
export async function runEmptyFormation({getRole,send,config,applyFormation,stopped=()=>false}) {
  const check=()=>{if(stopped())throw new Error('无将阵容调整已停止');};
  check();let role=await getRole();const plan=planEmptyFormation(role,config);
  // 全部条件预检通过才开始写；不培养、重生、合成或消耗武将资源。
  await applyFormation(plan.hero.heroId);
  check();role=await getRole();
  if (Number(role.lordWeaponId||0)!==0) {
    await send('lordweapon_changedefaultweapon',{weaponId:0});
    check();role=await getRole();
    if(Number(role.lordWeaponId||0)!==0)throw new Error('玩具卸下未确认');
  }
  const current=planEmptyFormation(role,config);
  if(current.petUid){
    check();await send('pet_load',{slotUId:{slot:current.emptySlot,uId:''}});
    check();role=await getRole();
    if(mapGet(role.petData?.pets,-1)?.uId || mapGet(role.petData?.pets,current.emptySlot)?.uId!==current.petUid)throw new Error('宠物卸下未确认');
  }
  check();
  const team=mapEntries(role.heroes).map(([id,h])=>({...h,heroId:Number(h.heroId??h.id??id)})).filter(h=>Number(h.battleTeamSlot)>=0);
  if(team.length!==1||team[0].heroId!==plan.hero.heroId||Number(team[0].battleTeamSlot)!==0||Number(role.lordWeaponId||0)!==0||mapGet(role.petData?.pets,-1)?.uId)throw new Error('无将阵容最终状态未确认');
  return plan.hero;
}
