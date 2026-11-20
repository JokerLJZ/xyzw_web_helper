export const DREAM_MIN_MAIN_LEVEL = 1000;
export const GENIE_MIN_MAIN_LEVEL = 3000;
export const DAILY_GENIE_SWEEP_TICKET_LIMIT = 3;

export const getMainLevel = (roleData) => {
  const level = Number(roleData?.levelId ?? 0);
  return Number.isFinite(level) ? Math.max(0, Math.trunc(level)) : 0;
};

export const isDreamMainLevelUnlocked = (roleData) =>
  getMainLevel(roleData) >= DREAM_MIN_MAIN_LEVEL;

export const isGenieMainLevelUnlocked = (roleData) =>
  getMainLevel(roleData) >= GENIE_MIN_MAIN_LEVEL;

export const getGenieProgress = (roleData, genieId) => {
  const raw = roleData?.genie?.[genieId] ?? roleData?.genie?.[String(genieId)];
  const progress = Number(raw);
  return Number.isInteger(progress) && progress >= 0 ? progress : null;
};

const isSameDay = (timestamp, now) => {
  if (!timestamp) return false;
  return new Date(Number(timestamp) * 1000).toDateString() === now.toDateString();
};

export const planDailyGenieRewards = (roleData, now = new Date()) => {
  if (!isGenieMainLevelUnlocked(roleData)) {
    return { unlocked: false, claimableGenieIds: [], remainingTicketClaims: 0 };
  }

  const statistics = roleData?.statistics || {};
  const statisticsTime = roleData?.statisticsTime || {};
  const claimableGenieIds = [];
  for (let genieId = 1; genieId <= 4; genieId++) {
    if (
      getGenieProgress(roleData, genieId) !== null
      && !isSameDay(statisticsTime[`genie:daily:free:${genieId}`], now)
    ) {
      claimableGenieIds.push(genieId);
    }
  }

  const boughtToday = isSameDay(statisticsTime["genie:sweep:buy"], now)
    ? Math.max(0, Number(statistics["genie:sweep:buy"] || 0))
    : 0;

  return {
    unlocked: true,
    claimableGenieIds,
    remainingTicketClaims: Math.max(
      0,
      DAILY_GENIE_SWEEP_TICKET_LIMIT - boughtToday,
    ),
  };
};
