import {cleanupMondayMail} from "../mondayMailCleanup.js";
import {loadRechargeConfig} from '../rechargeActivity.js';
import {unlockStudySkins,deleteLordReports} from '../altAccountUtilities.js';
export function createTasksAltUtilities(deps) {
 const run=async(skins)=>{
  const {selectedTokens,tokens,tokenStatus,isRunning,shouldStop,currentRunningTokenId,ensureConnection,releaseConnectionSlot,tokenStore,addLog,message}=deps;
  const ids=[...selectedTokens.value];if(!ids.length)return;
  isRunning.value=true;shouldStop.value=false;
  const mail=skins==='mail';
  const label=mail?'领取并删除系统邮件与公告':skins?'解锁大冲关皮肤':'删除咸主战报';
  try {for(const id of ids) {
   if(shouldStop.value)break;
   let owned=tokenStore.getWebSocketStatus?.(id)!=='connected',connected=false;
   const name=tokens.value.find(t=>t.id===id)?.name||id;
   const log=(text,type='info')=>addLog({time:new Date().toLocaleTimeString(),message:`${name} ${text}`,type});
   try {
    currentRunningTokenId.value=id;tokenStatus.value[id]='running';
    await ensureConnection(id,2,value=>{if(typeof value==='boolean')owned=value;});connected=true;
    const send=async(cmd,params)=>{
     if(shouldStop.value)throw Object.assign(Error('任务已停止'),{interrupted:true});
     try{return await tokenStore.sendMessageWithPromise(id,cmd,params,15000);}
     finally{await (deps.wait||((ms)=>new Promise(r=>setTimeout(r,ms))))(Math.max(500,Number(deps.delayConfig?.command)||0));}
    };
    const options={send,stopped:()=>shouldStop.value,log};
    const result=mail?await cleanupMondayMail({...options,tuesdayOnly:false}):skins?await unlockStudySkins({...options,config:await (deps.loadConfig||loadRechargeConfig)(send)}):await deleteLordReports(options);
    tokenStatus.value[id]=shouldStop.value?'stopped':'completed';
    log(mail?`系统邮件与公告处理完成：领取${result.claimed}封，删除${result.deleted}封`:skins?`大冲关皮肤解锁完成：${result.unlocked}个`:`咸主战报处理完成：已删除${result.deleted}封，保留未领附件${result.protectedCount}封`,'success');
   }catch(error){tokenStatus.value[id]=error.interrupted?'stopped':'failed';log(`${label}：${error.message}`,'error');}
   finally{if(owned&&connected&&!deps.isScheduledSession?.(id)){tokenStore.closeWebSocketConnection(id);releaseConnectionSlot();}}
  }}finally{isRunning.value=false;currentRunningTokenId.value=null;}
  message.info(`${label}任务结束，请查看逐账号日志`);
 };
 return {batchCleanupSystemMail:()=>run('mail'),batchUnlockStudySkins:()=>run(true),batchDeleteLordReports:()=>run(false)};
}
