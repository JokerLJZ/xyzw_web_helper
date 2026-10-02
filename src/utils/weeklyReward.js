// API采集/养号/活动周奖励.txt、黑市周万能.txt：选择映射与 typ 分开传递。
export const normalizeWeeklyRewardChoice = (value) => {
  if (value === null || value === undefined || value === "") return 1;
  const choice = Number(value);
  return Number.isSafeInteger(choice) && choice >= 0 ? choice : 1;
};
export const createWeeklyRewardMap = (typ, choice) =>
  new Map([[typ === 1 ? 1 : 0, normalizeWeeklyRewardChoice(choice)]]);
