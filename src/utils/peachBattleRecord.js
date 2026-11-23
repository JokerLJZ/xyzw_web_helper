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

export function formatPower(value) {
  const power = Number(value);
  if (!Number.isFinite(power) || power <= 0) return '0';
  if (power >= 1e8) return `${(power / 1e8).toFixed(1)}亿`;
  if (power >= 1e4) return `${(power / 1e4).toFixed(1)}万`;
  return String(power);
}
export function getMaxKills(club) {
  return Math.max(0, ...(club?.killRank || []).map(player => Number(player.killCnt) || 0));
}
export function getPercent(value, maximum) {
  const number = Number(value), max = Number(maximum);
  if (!Number.isFinite(number) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, number / max * 100));
}
