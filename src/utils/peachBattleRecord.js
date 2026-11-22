// 官方战报按 ROLE.legionId 区分双方；详情查询使用绝对值 ID。
export function normalizePeachLegionId(value) {
  const id = Math.abs(Number(value));
  if (!Number.isSafeInteger(id) || id === 0) throw new Error("未获取到有效俱乐部ID");
  return id;
}

export function peachLineupRow(slot) {
  const position = Number(slot);
  return Number.isInteger(position) && position >= 0 && position < 2 ? 'front' : 'back';
}
export function peachRecordStyle(value) {
  return ['default', 'style1', 'style2'].includes(value) ? value : 'default';
}
