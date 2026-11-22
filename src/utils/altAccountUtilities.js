const body = r => r?._raw?.body || r?.body || r?.data || r;
const get = (map,key) => map instanceof Map ? map.get(key) ?? map.get(String(key)) : map?.[key];
const has = (map,key) => map instanceof Map ? map.has(key)||map.has(String(key)) : Object.hasOwn(map||{},key);
export function eligibleStudySkins(config,role) {
 const study=role?.study;
 if(!study) throw Error('角色答题状态缺失');
 const rows=Object.values(config?.StudyClothesConf||{});
 if(!rows.length)throw Error('大冲关皮肤配置缺失');
 return rows.filter(row=>{
  if(row.open!==1||row.id===10000)return false;
  if(row.id===10150)return get(role.custom,'quizSkin')===2;
  if(has(study.unlockedSkin,row.id))return false;
  const progress=row.studyClothesType===1?study.totRightNum??0:row.studyClothesType===2?study.totCplTaskNum??0:row.studyClothesType===3?get(study.actTotCplTaskMap,row.studyActId)??0:null;
  return Number.isFinite(progress)&&Number.isFinite(row.totRightNum)&&progress>=row.totRightNum&&progress!==null;
 });
}
export async function unlockStudySkins({send,config,stopped=()=>false,log=()=>{}}) {
 let role=body(await send('role_getroleinfo',{}))?.role;
 const candidates=eligibleStudySkins(config,role);let unlocked=0;
 for(const row of candidates) {
  if(stopped())break;
  if(!eligibleStudySkins(config,role).some(item=>item.id===row.id))continue;
  let failure;
  try {await send(row.id===10150?'system_custom':'study_unlockskin',row.id===10150?{key:'quizSkin',value:3}:{id:row.id});}catch(error){failure=error;}
  role=body(await send('role_getroleinfo',{}))?.role;
  if(!role?.study)throw Error('解锁后角色状态缺失');
  const confirmed=row.id===10150?get(role.custom,'quizSkin')===3:has(role.study.unlockedSkin,row.id);
  if(!confirmed)throw failure||Error(`皮肤${row.id}解锁后未确认`);
  unlocked++;log(`大冲关皮肤${row.id}解锁已确认`);
 }
 return {unlocked};
}
/** Mail_GetListResp initializes list=[] and left=0; BON can omit these defaults. */
export function normalizeLordReportList(response) {
 const value=body(response);
 if(!value || typeof value!=="object" || Array.isArray(value) || value instanceof Uint8Array)
  throw Error('咸主战报列表格式无效');
 if(value.code)throw Error(`战报查询失败：服务器错误 ${value.code}`);
 if(value._originalCmd && value._originalCmd!=="mail_getbattlefieldreportlist")
  throw Error('战报查询响应指令不匹配');
 if(value.list!==undefined && !Array.isArray(value.list))throw Error('咸主战报列表格式无效');
 if(value.list===undefined && Object.keys(value).some(key=>!["left","_originalCmd"].includes(key)))
  throw Error('战报响应缺少列表且包含未知字段');
 if(value.left!==undefined && (!Number.isInteger(value.left)||value.left<0))throw Error('战报剩余数量无效');
 if(value.list===undefined && value.left>0)throw Error("战报响应仍有剩余数量但缺少列表");
 return {...value,list:value.list??[],left:value.left??0};
}
export async function deleteLordReports({send,stopped=()=>false,log=()=>{}}) {
 let deleted=0,protectedCount=0,lastId=0;
 const seen=new Set();
 for(let page=0;page<100;page++) {
  if(stopped())return {deleted,protectedCount};
  const snapshot=normalizeLordReportList(await send('mail_getbattlefieldreportlist',{category:1,lastId,size:60}));
  if(!snapshot.list.length)return {deleted,protectedCount};
  for(const mail of snapshot.list) {
   if(stopped())return {deleted,protectedCount};
   if(mail.category!==1||mail.id==null||seen.has(String(mail.id)))throw Error('咸主战报分类或分页异常');
   seen.add(String(mail.id));
   if(mail.state===9)continue;
   if((mail.attachments?.length||mail.haveAttachments)&&Number(mail.state??0)<3) {protectedCount++;continue;}
   let failure, result;
   try {result=body(await send('mail_changestate',{mailId:mail.id,state:9}));}catch(error){failure=error;}
   const check=normalizeLordReportList(await send('mail_getbattlefieldreportlist',{category:1,lastId,size:60}));
   // Confirm from the deleted-mail response, or absence in an untruncated queried segment.
   const remaining=check.list.find(item=>String(item.id)===String(mail.id));
   if(!(String(result?.mail?.id)===String(mail.id)&&result?.mail?.state===9) && ((remaining&&remaining.state!==9)||(!remaining&&check.list.length>=60)))throw failure||Error(`战报${mail.id}删除未确认`);
   deleted++;log(`咸主战报${mail.id}删除已确认`);
  }
  if(snapshot.list.length<60)return {deleted,protectedCount};
  lastId=snapshot.list.at(-1).id;
 }
 throw Error('战报数量超过单轮上限，请再次执行');
}
