// One classification shared by the immediate list and scheduled task picker.
export const TASK_GROUPS = [
  { name: 'daily', label: '日常与领取', match: /日常|挂机|加钟|罐子|签到|珍宝阁|成就|邮件|兑换码|藏品奖励|卡牌图鉴/ },
  { name: 'monthly', label: '月度任务', match: /补齐|助威商店/ },
  { name: 'weekly', label: '周常与限时活动', match: /周任务|周活动|充值活动|闲来入镜|玄武|消耗活动/ },
  { name: 'club', label: '俱乐部与赛事', match: /报名|盐场|营地|蟠桃|天宫|俱乐部|咸主/ },
  { name: 'shop', label: '商店采购', match: /购买|采购|黑市|珍珠买/ },
  { name: 'dungeon', label: '副本与挑战', match: /爬塔|怪异塔|梦境|闯关|竞技场|灯神/ },
  { name: 'resource', label: '资源管理', match: /开箱|宝箱积分|钓鱼|招募|仓库/ },
  { name: 'pet', label: '宠物养成', match: /宠物|扭蛋/ },
  { name: 'legacy', label: '功法', match: /功法/ },
  { name: 'growth', label: '养成与阵容', match: /.*/ },
];
// Explicit assignments take priority over name-based classification.
const TASK_GROUP_OVERRIDES = {
  batchCheckSaltMasters: 'growth',
  batchJoinLegion: 'growth',
  batchBuyRedFeatherWithPearls: 'growth',
  batchBuyBaguaWithPearls: 'growth',
  batchBuyPearlFish: 'growth',
  skinChallenge: 'weekly',
};
export function groupTaskCatalog(tasks, query = '') {
  const keyword = query.trim().toLowerCase();
  return TASK_GROUPS.map(group => ({ ...group, tasks: tasks.filter(task =>
    (TASK_GROUP_OVERRIDES[task.value] || TASK_GROUPS.find(g => g.match.test(task.label)).name) === group.name &&
    (!keyword || `${task.label} ${group.label}`.toLowerCase().includes(keyword)),
  ) })).filter(group => group.tasks.length);
}
