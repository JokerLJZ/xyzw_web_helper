import { activityBody } from "./rechargeActivity.js";
import { extractRolePatch } from "./roleSnapshot.js";
import { loadSignupCheerConfig } from "./batch/tasksSignupCheer.js";
const DAY = 86400000;
const get = (map,key) => map instanceof Map ? map.get(key) : map?.[key];
function day(date) {
  if (typeof date !== "string" || !/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(date)) throw new Error("大事件赛程日期无效");
  const [y,m,d] = date.split(/[/-]/).map(Number), time = Date.UTC(y,m-1,d)-8*3600000;
  if (format(time) !== `${y}/${String(m).padStart(2,"0")}/${String(d).padStart(2,"0")}`) throw new Error("大事件赛程日期无效");
  return time;
}
function format(time) { return new Date(time+8*3600000).toISOString().slice(0,10).replaceAll("-","/"); }
export function clubRewardDates(config, firstMonthDate, now) {
  if (firstMonthDate === "") return [];
  const first = day(firstMonthDate);
  if (!config.LegionScheduleConf || !config.SeasonLegionScheduleConf) throw new Error("缺少大事件赛程配置");
  const monthly = Object.values(config.LegionScheduleConf).filter(r=>r.legionWarType===2 && day(r.serverDate)>=first);
  const seasons = new Map(monthly.map((r,i)=>[r.serverDate.slice(0,7).replaceAll("-","/"),i+1]));
  const finals = Object.values(config.SeasonLegionScheduleConf).filter(r=>[32,39].includes(r.seasonLegionWarType) && (seasons.get(r.serverDate.slice(0,7).replaceAll("-","/")) || 0)>=7);
  const finalMonths = new Set(finals.map(r=>r.serverDate.slice(0,7).replaceAll("-","/")));
  const rows = [...monthly.filter(r=>!finalMonths.has(r.serverDate.slice(0,7).replaceAll("-","/"))).map(r=>({...r,type:2})),...finals.map(r=>({...r,type:r.seasonLegionWarType}))];
  const dates = rows.filter(r=>{
    const start=day(r.serverDate);
    if(now>start+DAY)return true;
    const constants=Object.values(config.LegionWarConstantConf || {}).filter(c=>Number(c.type)===r.type);
    // Use the longest configured duration when multiple season variants exist.
    const duration=constants.length?Math.max(...constants.map(c=>c.time)):4*3600;
    if(!Number.isFinite(duration)||duration<0)throw new Error("大事件结束时间配置无效");
    return now>start+20*3600000+duration*1000;
  }).map(r=>format(day(r.serverDate)));
  return [...new Set(dates)].sort().reverse();
}
export async function claimClubEventRewards({send,now=Date.now,stopped=()=>false,log=()=>{},loadConfig=loadSignupCheerConfig,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const request=async(cmd,params={})=>{
    const query=cmd!=="legion_claimwarrankreward";
    for(let attempt=0;attempt<3;attempt++){
      await sleep(attempt?3000:800);
      if(stopped())throw Object.assign(new Error("大事件领奖已停止"),{interrupted:true});
      try {
        const response=await send(cmd,params),code=response?._raw?.code??response?.code;
        if(code!==undefined&&code!==0)throw Object.assign(new Error(`服务器错误${code}`),{code});
        return activityBody(response);
      } catch(error) {
        const limited=/(?:^|\D)200400(?:\D|$)/.test(`${error.code || ""} ${error.message}`);
        if(query&&limited&&!error.interrupted&&attempt<2){
          log(`${cmd}${params.date?`（${params.date}）`:""}查询被限速，等待3秒后重查`,"warning");
          continue;
        }
        const failure=new Error(`${cmd}${params.date?`（${params.date}）`:""}：${error.message || error}`);
        failure.code=error.code;failure.interrupted=error.interrupted;failure.cause=error;
        throw failure;
      }
    }
  };
  const readRole=async()=>{
    const role=extractRolePatch(await request("role_getroleinfo"));
    if(!role||typeof role!=="object"||Array.isArray(role)||role instanceof Map)throw new Error("大事件领奖账号状态未确认");
    if(role.statistics !== undefined && (!role.statistics || typeof role.statistics !== "object" || Array.isArray(role.statistics))) throw new Error("大事件领取统计无效");
    return role;
  };
  let role=await readRole();
  const first=await request("role_getfirstmonthdate");
  const firstMonthDate=first.firstMonthDate===undefined?"":first.firstMonthDate;
  if(typeof firstMonthDate!=="string")throw new Error("首次月赛日期无效");
  if(!firstMonthDate){log("尚无大事件赛程，跳过");return {claimed:0};}
  const config=await loadConfig((cmd,params)=>request(cmd,params));
  const dates=clubRewardDates(config,firstMonthDate,now());
  let claimed=0;
  for(const date of dates){
    const key=`war:rank:reward:${date}`;
    if(get(role.statistics,key)){log(`${date}大事件奖励已领取，跳过`);continue;}
    const result=await request("legionwar_getmajoreventslist",{date});
    const list=result.legionRankList===undefined?[]:result.legionRankList;
    if(!Array.isArray(list))throw new Error(`${date}大事件榜单结构无效`);
    if(!list.length){log(`${date}大事件无榜单，跳过`);continue;}
    let failure,response;
    try{response=await request("legion_claimwarrankreward",{date});}catch(error){failure=error;}
    if(failure?.interrupted)throw failure;
    // A matching explicit statistics patch already confirms the claim; avoid
    // querying the entire role once more for every date in that case.
    const confirmed=get(extractRolePatch(response)?.statistics,key);
    if(confirmed){
      role.statistics=role.statistics instanceof Map?new Map(role.statistics):{...role.statistics};
      if(role.statistics instanceof Map)role.statistics.set(key,confirmed);else role.statistics[key]=confirmed;
    }else role=await readRole();
    if(!get(role.statistics,key))throw failure||new Error(`${date}大事件领奖未确认，停止且不重发`);
    claimed++;log(`${date}大事件奖励已确认领取`,'success');
  }
  log(`俱乐部大事件奖励领取完成：本次${claimed}场`);
  return {claimed};
}
