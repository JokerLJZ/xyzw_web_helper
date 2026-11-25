const body = response => {
  if (response?.code || response?.error) throw new Error(String(response.error || response.code));
  const value = response?.data ?? response?._raw?.body ?? response?.body ?? response;
  if (value?.code || value?.error) throw new Error(String(value.error || value.code));
  return value;
};
/** Only full, validated account queries replace the persisted club snapshot. */
export async function fetchTokenClubInfo(send) {
  const role = body(await send('role_getroleinfo', {}))?.role;
  const rawId = role?.legionId;
  if (!['number', 'string'].includes(typeof rawId) || String(rawId).trim() === '' || !Number.isSafeInteger(Number(rawId))) throw new Error('未取得当前账号俱乐部状态');
  const id = Number(rawId);
  if (id <= 0) return { id: null, name: '', updatedAt: new Date().toISOString() };
  const info = body(await send('legion_getinfo', {}))?.info;
  if (String(info?.id) !== String(id) || typeof info?.name !== 'string' || !info.name.trim()) throw new Error('俱乐部信息不完整或已变化，请重新获取');
  return { id: String(id), name: info.name, updatedAt: new Date().toISOString() };
}
export function getClubOptions(tokens) {
  const clubs = new Map();
  for (const token of tokens) {
    const club = token.clubInfo;
    if (!club) continue;
    const key = club.id ?? 'none';
    const entry = clubs.get(key) || { value: key, name: club.id ? `${club.name}（${club.id}）` : '未加入俱乐部', count: 0 };
    entry.count++;
    clubs.set(key, entry);
  }
  return [...clubs.values()].map(c => ({ value: c.value, label: `${c.name} · ${c.count}个账号` }));
}
export function getClubTokenIds(tokens, clubId) {
  return tokens.filter(t => t.clubInfo && (t.clubInfo.id ?? 'none') === clubId).map(t => t.id);
}
