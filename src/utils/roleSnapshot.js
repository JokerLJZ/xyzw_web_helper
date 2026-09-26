export const extractRolePatch = (payload) =>
  payload?.role ||
  payload?.data?.role ||
  payload?.body?.role ||
  payload?.rawData?.role ||
  null;

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** 将服务器返回的 role 增量递归合并到本轮日常任务快照。 */
export const mergeRoleSnapshot = (snapshot, patch) => {
  if (!isPlainObject(snapshot) || !isPlainObject(patch)) return snapshot;

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value)) {
      if (!isPlainObject(snapshot[key])) snapshot[key] = {};
      mergeRoleSnapshot(snapshot[key], value);
    } else {
      snapshot[key] = value;
    }
  }

  return snapshot;
};
