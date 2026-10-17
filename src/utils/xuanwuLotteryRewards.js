export const getNextUnclaimedLotteryCumulativeId = (
  lotteryInfo = {},
  maxRewardRounds = 20,
) => {
  const claimedMap = lotteryInfo?.cumulativeClaimedMap || {};
  for (let id = 1; id <= maxRewardRounds; id += 1) {
    if (claimedMap[id] !== true && claimedMap[String(id)] !== true) return id;
  }
  return null;
};
