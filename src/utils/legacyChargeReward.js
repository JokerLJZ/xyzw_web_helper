const body = value => value?._raw?.body || value?.body || value?.data || value;
const get = (map,key) => map instanceof Map ? map.get(key) ?? map.get(String(key)) : map?.[key];

export function legacyChargeEligibility(config, role, legacy, now, id = 2) {
  if (!Number.isFinite(now) || now <= 0) throw new Error("未取得有效服务器时间");
  if (!role || !legacy || !Number.isInteger(legacy.scheduleId)) throw new Error("功法或角色查询数据不完整");
  const schedules = Object.values(config?.LegacyScheduleConf || {});
  const season = schedules.find(row => {
    const start = (role.isWhiteRole ? row.legacyWhiteListStart : row.legacyStart) * 1000;
    return start < now && now < row.legacyEnd * 1000;
  });
  if (!schedules.length) throw new Error("功法赛季配置缺失");
  if (!season || legacy.scheduleId < season.id) return {canClaim:false,reason:"当前不在可领取的功法赛季或正在跨季"};
  const definition = get(config.LegacyChargeReward,id);
  if (!definition || !Number.isFinite(definition.vipSpend) || definition.vipSpend < 0) throw new Error("特权功法档位配置无效");
  if (legacy.chargeClaimedMap != null && (typeof legacy.chargeClaimedMap !== "object" || Array.isArray(legacy.chargeClaimedMap))) throw new Error("特权功法领取记录格式无效");
  const claimed = get(legacy.chargeClaimedMap,id);
  if (claimed !== undefined && typeof claimed !== 'boolean') throw new Error("特权功法领取记录格式无效");
  if (claimed === true) return {canClaim:false,reason:"特权功法已领取"};
  if (!role.statistics || !role.statisticsTime) throw new Error("角色充值统计不完整");
  const amount = get(role.statistics,'legacy:charge') ?? 0;
  const stamp = get(role.statisticsTime,'legacy:charge') ?? 0;
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(stamp) || stamp < 0) throw new Error("角色充值统计无效");
  const start = (role.isWhiteRole ? season.legacyWhiteListStart : season.legacyStart) * 1000;
  const current = start <= stamp * 1000 && stamp * 1000 < season.legacyEnd * 1000 ? amount : 0;
  return current >= definition.vipSpend ? {canClaim:true} : {canClaim:false,reason:`本季充值进度未达到特权档位（${current}/${definition.vipSpend}）`};
}

export async function claimLegacyChargeReward({send,loadConfig,serverTime,stopped=()=>false,onTier=()=>{}}) {
  const config = await loadConfig(send);
  let legacy = body(await send('legacy_getinfo',{}))?.roleLegacy;
  const role = body(await send('role_getroleinfo',{}))?.role;
  // Official privilege UI skips the zero-spend base entry and exposes each reward tier.
  const tiers = Object.values(config?.LegacyChargeReward || {})
    .filter(row => row.privilegeReward || row.vipSpend > 0)
    .sort((a,b)=>a.id-b.id);
  if (!tiers.length || tiers.some(row=>!Number.isInteger(row.id) || row.id<=0) ||
      new Set(tiers.map(row=>row.id)).size!==tiers.length) throw new Error('特权功法档位配置无效');
  const claimedIds = [], responses = [], reasons = [];
  let confirmedAfterError = false;
  for (const tier of tiers) {
    if (stopped()) return {status:'stopped',claimedIds};
    const eligibility = legacyChargeEligibility(config,role,legacy,serverTime(),tier.id);
    if (!eligibility.canClaim) {
      reasons.push(`${tier.name || `档位${tier.id}`}：${eligibility.reason}`);
      onTier({id:tier.id,name:tier.name,status:'skipped',reason:eligibility.reason});
      continue;
    }
    let response, failure;
    try { response = await send('legacy_claimchargereward',{id:tier.id}); } catch(error) {failure=error;}
    const after = body(await send('legacy_getinfo',{}))?.roleLegacy;
    if (!after || after.scheduleId !== legacy.scheduleId) throw new Error(`档位${tier.id}领取后功法赛季状态无法确认`);
    if (get(after.chargeClaimedMap,tier.id) !== true) {
      if (failure) throw new Error(`档位${tier.id}领取未确认：${failure.message}`);
      throw new Error(`档位${tier.id}领取后记录未确认，请稍后查询`);
    }
    legacy = after;
    claimedIds.push(tier.id);
    if (response) responses.push(body(response));
    confirmedAfterError ||= !!failure;
    onTier({id:tier.id,name:tier.name,status:'completed'});
  }
  if (!claimedIds.length) return {status:'skipped',reason:reasons.join('；'),claimedIds};
  const reward = responses.flatMap(response=>Array.isArray(response?.reward)?response.reward:[]);
  return {status:'completed',claimedIds,confirmedAfterError,response:{reward,role:responses.at(-1)?.role}};
}
