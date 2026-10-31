import { activityBody } from "./rechargeActivity.js";

const CATEGORIES = [0, 5]; // categorySystemMail, categoryPublicNoticeMail
export const isMailCleanupMonday = time => new Date(time + 8 * 3600000).getUTCDay() === 1;

/** Mail_GetListResp defaults omitted in raw BON: list=[], left=0. */
export function normalizeMailListResponse(response) {
  const code = response?._raw?.code ?? response?.code;
  if (code !== undefined && code !== 0) throw new Error(`系统邮件查询失败：服务器错误${code}`);
  const body = activityBody(response);
  if (!body || typeof body !== "object" || Array.isArray(body) || body instanceof Map)
    throw new Error("系统邮件列表未确认");
  const list = body.list === undefined ? [] : body.list;
  const left = body.left === undefined ? 0 : body.left;
  if (!Array.isArray(list) || !Number.isSafeInteger(left) || left < 0)
    throw new Error("系统邮件列表或剩余数量异常");
  return { ...body, list, left };
}

/** Claim before delete, scoped to system mail and announcements; never blindly retry writes. */
export async function cleanupMondayMail({ send, now = Date.now, stopped = () => false }) {
  if (!isMailCleanupMonday(now())) return { status: "skipped", reason: "非周一，跳过系统邮件与公告清理" };
  const guard = () => {
    if (stopped()) throw Object.assign(new Error("邮件清理已停止"), { interrupted: true });
    if (!isMailCleanupMonday(now())) throw new Error("邮件清理已跨出周一，停止继续操作");
  };
  const read = async () => {
    guard();
    const body = normalizeMailListResponse(await send("mail_getlist", { category: CATEGORIES, lastId: 0, size: 60 }));
    for (const mail of body.list) {
      if (!Number.isSafeInteger(mail.id) || mail.id <= 0 || !CATEGORIES.includes(mail.category ?? 0) ||
          (mail.state !== undefined && !Number.isInteger(mail.state)) ||
          (mail.haveAttachments !== undefined && typeof mail.haveAttachments !== "boolean"))
        throw new Error("邮件分类或状态异常，停止清理");
    }
    return body;
  };
  const transition = async (mail, command, params, expected) => {
    guard();
    let response, failure;
    try { response = activityBody(await send(command, params)); } catch (error) { failure = error; }
    if (response?.mail?.id === mail.id && response.mail.state >= expected) return response.mail;
    const latest = await read();
    const found = latest.list.find(row => row.id === mail.id);
    if (found && found.state >= expected) return found;
    if (expected === 9 && !found && latest.left === 0) return { ...mail, state: 9 };
    throw failure || new Error(`邮件${mail.id}${expected === 3 ? "附件领取" : "删除"}未确认`);
  };
  let claimed = 0, deleted = 0;
  const processed = new Set();
  for (let page = 0; page < 100; page++) {
    const body = await read();
    const mails = body.list.filter(mail => (mail.state ?? 0) < 9);
    if (!mails.length) {
      if (Number(body.left) > 0) throw new Error("邮件列表为空但仍有剩余邮件，清理未确认");
      return { status: "completed", reason: `系统邮件与游戏公告：领取${claimed}封，删除${deleted}封`, claimed, deleted };
    }
    for (let mail of mails) {
      if (processed.has(mail.id)) throw new Error(`邮件${mail.id}删除后仍在列表，停止重复处理`);
      if (mail.haveAttachments && (mail.state ?? 0) < 3) {
        mail = await transition(mail, "mail_claimattachment", { mailId: mail.id }, 3);
        claimed++;
      }
      await transition(mail, "mail_changestate", { mailId: mail.id, state: 9 }, 9);
      processed.add(mail.id);
      deleted++;
    }
  }
  throw new Error("邮件清理达到安全批次上限，剩余邮件待继续");
}
