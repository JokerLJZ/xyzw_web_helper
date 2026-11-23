import { normalizeMailListResponse } from "./mondayMailCleanup.js";

/** Follow login settlement before claiming existing system-mail attachments. Never retry writes. */
export async function claimMailRewards({ send, stopped = () => false, log = () => {}, wait = () => Promise.resolve() }) {
  const request = async (stage, command, params = {}) => {
    if (stopped()) throw Object.assign(new Error("邮件领取已停止"), { interrupted: true });
    try {
      const result = await send(command, params);
      const code = result?._raw?.code ?? result?.code;
      if (code !== undefined && code !== 0) throw new Error(`服务器错误${code}`);
      await wait();
      return result;
    } catch (error) {
      const failure = new Error(`${stage}失败：${error.message || error}`);
      failure.mailStage = stage;
      failure.interrupted = error.interrupted;
      failure.cause = error;
      throw failure;
    }
  };
  // The official client only queries NMExt when Nightmare is unlocked. A failed
  // optional query must not block unrelated mail on accounts without the feature.
  log("查询十殿星级状态");
  try {
    await request("十殿状态查询", "nmext_getinfo");
  } catch (error) {
    if (error.interrupted) throw error;
    log(`${error.message}；继续补发普通奖励，十殿奖励尚未确认`, "warning");
  }
  log("请求登录奖励补发");
  await request("奖励补发", "role_backclaimreward");
  const read = async () => normalizeMailListResponse(await request("邮箱刷新", "mail_getlist", {
    category: [0, 4, 5], lastId: 0, size: 60,
  }));
  await read();
  log("领取系统邮件附件");
  let result, claimError;
  try {
    result = await request("附件领取", "mail_claimallattachment", { category: 0 });
  } catch (error) {
    claimError = error;
  }
  // A timeout is uncertain: query once for diagnosis, never submit another claim.
  try {
    const latest = await read();
    const pending = latest.list.filter(mail => (mail.category ?? 0) === 0 &&
      mail.haveAttachments === true && (mail.state ?? 0) < 3).length;
    if (pending || latest.left > 0) log(`邮箱复查：当前页仍有${pending}封系统邮件附件未领，剩余邮件${latest.left}封`, "warning");
    else log("邮箱复查完成：当前页无未领系统附件；不代表所有活动奖励均已补发");
  } catch (error) {
    if (!claimError) throw error;
    log(error.message, "warning");
  }
  if (claimError) throw claimError;
  return result;
}
