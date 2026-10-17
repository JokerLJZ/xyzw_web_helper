// API采集/养号/活动周奖励.txt、黑市周万能.txt：选择映射与 typ 分开传递。
// 按游戏自选大奖顺序排列，接口选项编号从1开始。
export const WEEKLY_REWARD_OPTIONS = [
  { value: 1, label: "150万能红碎片" },
  { value: 2, label: "7500晶石" },
  { value: 3, label: "20000精铁" },
  { value: 4, label: "20000进阶石" },
  { value: 5, label: "2000扳手" },
  { value: 6, label: "1珍珠" },
];

export const normalizeWeeklyRewardChoice = (value) => {
  if (value === null || value === undefined || value === "") return 1;
  const choice = Number(value);
  return WEEKLY_REWARD_OPTIONS.some((option) => option.value === choice) ? choice : 1;
};
export const createWeeklyRewardMap = (typ, choice) =>
  new Map([[typ === 1 ? 1 : 0, normalizeWeeklyRewardChoice(choice)]]);
