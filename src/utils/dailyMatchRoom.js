// Official RFHonorData / RoomFight hall flow, client 2.54.2.
// Protocol model defaults must be applied to raw responses (the official
// client constructs PKRoom_GetFightRoomInfoResp / GDPKRoom before setValue).
export function normalizeMatchRoomInfo(info) {
  if (!info || typeof info.roomId !== "string") throw new Error("比赛房间响应不完整");
  const type = info.type === undefined ? 0 : info.type;
  if (!Number.isInteger(type)) throw new Error("比赛房间类型无效");
  return { firstMatchTime: 0, ...info, type };
}

export function matchRoomAction(info, detail, role, now) {
  info = normalizeMatchRoomInfo(info);
  if (!info.roomId) return { reason: "当前没有比赛房间" };
  if (info.type !== 0) return { reason: `当前为非正式比赛（类型${info.type}），无预约关注入口` };
  const id = Number(info.roomId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("比赛房间ID无效");
  const booked = Number(role?.statistics?.["pk:appoint:room:id"] ?? 0);
  if (!Number.isFinite(booked)) throw new Error("比赛关注状态无效");
  if (!(info.firstMatchTime > 0 && now > info.firstMatchTime * 1000)) {
    return Math.abs(booked) === id ? { reason: "本场比赛已关注，等待开赛" } : { command: "pkroom_appoint", id };
  }
  const state = detail?.state === undefined ? 0 : detail.state;
  if (!detail || !Number.isInteger(state)) throw new Error("比赛详情缺少房间状态");
  if (state === 5) return { reason: "比赛房间已关闭" };
  if (booked === -id) return { reason: "本场关注奖励已领取" };
  return booked === id ? { command: "pkroom_appointreward", id } : { reason: "比赛已开始，本账号未提前关注" };
}

export async function runDailyMatchRoom({ send, now }) {
  const read = async () => {
    const info = normalizeMatchRoomInfo(await send("pkroom_getfightroominfo", {}));
    if (!info.roomId || info.type !== 0) return { ...matchRoomAction(info), roomId: info.roomId };
    const detail = info?.roomId && info.type === 0
      ? (await send("pkroom_getfightroomdetail", { roomId: info.roomId }))?.roomInfo : null;
    const response = await send("role_getroleinfo", {});
    const role = response?.role;
    if (!role || !role.statistics) throw new Error("角色关注状态读取失败");
    return { ...matchRoomAction(info, detail, role, now()), roomId: info.roomId, booked: Number(role.statistics["pk:appoint:room:id"] ?? 0) };
  };
  const action = await read();
  if (!action.command) return { status: "skipped", reason: action.reason };
  let writeError;
  try { await send(action.command, {}); } catch (error) { writeError = error; }
  // A write is never retried: refresh this account to confirm even after timeout.
  const confirmed = await read();
  const expected = action.command === "pkroom_appoint" ? action.id : -action.id;
  if (confirmed.roomId !== String(action.id) || confirmed.booked !== expected) {
    throw writeError || new Error("比赛关注或奖励状态尚未确认，未重发请求");
  }
  return { status: "success", reason: action.command === "pkroom_appoint" ? "比赛房间关注已确认" : "关注奖励领取已确认" };
}
