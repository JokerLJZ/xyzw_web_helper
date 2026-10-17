// 客户端 ActivityTimeRoundRewardDialog._onCommit: Map<奖励数组下标, 领取份数>。
// 界面选择值保留1～6；招募周奖励数组首项为额外奖励，六项通用奖励后移一位。
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
  new Map([[normalizeWeeklyRewardChoice(choice) - (typ === 1 ? 0 : 1), 1]]);
