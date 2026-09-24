export const GENIE_FACTION_GROUP = 4;
export const GENIE_DAILY_CHALLENGE_LIMIT = 10;
export const GENIE_SHOE_TOY_ID = 2;

export const GENIE_FACTION_LINEUPS = {
  1: [101, 202, 102, 113, 109],
  2: [110, 104, 118, 103, 206],
  3: [105, 106, 121, 119, 111],
};

export const GENIE_FACTION_NAMES = {
  1: "魏国",
  2: "蜀国",
  3: "吴国",
  4: "群雄",
};

export const GROUP_GENIE_LINEUP = [
  { slot: 0, heroId: 116, minLevel: 750 },
  { slot: 1, heroId: 107, minLevel: 1 },
  { slot: 2, heroId: 312, minLevel: 750 },
  { slot: 3, heroId: 210, minLevel: 250 },
  { slot: 4, heroId: 112, minLevel: 750 },
];

const isSameDay = (timestamp, now) => {
  if (!timestamp) return false;
  return new Date(Number(timestamp) * 1000).toDateString() === now.toDateString();
};

const normalizePetCandidates = (role) => {
  const sources = [
    role?.petData?.pets,
    role?.pets,
    role?.petList,
    role?.petStorage,
    role?.pet,
  ];
  const candidates = [];
  for (const source of sources) {
    if (!source) continue;
    const values = Array.isArray(source)
      ? source
      : source.petUId || source.uid
        ? [source]
        : Object.values(source);
    for (const pet of values) {
      if (!pet || typeof pet !== "object") continue;
      const petUId = pet.petUId ?? pet.uId ?? pet.uid ?? pet.petUid;
      if (petUId === undefined || petUId === null || petUId === "") continue;
      candidates.push({
        petUId,
        level: Math.max(0, Number(pet.level ?? pet.lv ?? pet.petLevel ?? 0) || 0),
      });
    }
  }
  return candidates;
};

export const selectHighestLevelPet = (role) =>
  normalizePetCandidates(role).sort((a, b) => b.level - a.level)[0] || null;

const buildTargetBattleTeam = () => Object.fromEntries(
  GROUP_GENIE_LINEUP.map(({ slot, heroId }) => [slot, heroId]),
);

export const buildFactionBattleTeam = (genieId) => Object.fromEntries(
  (GENIE_FACTION_LINEUPS[genieId] || []).map((heroId, slot) => [slot, heroId]),
);

export const getSavedGenieFormation = (role, genieId) => ({
  battleTeam:
    role?.genieBattleTeam?.[genieId]
      ?? role?.genieBattleTeam?.[String(genieId)]
      ?? {},
  lordWeaponId: Number(
    role?.genieLordWeapon?.[genieId]
      ?? role?.genieLordWeapon?.[String(genieId)]
      ?? 0,
  ) || 0,
  petUId:
    role?.geniePet?.[genieId]
      ?? role?.geniePet?.[String(genieId)]
      ?? "",
});

export const getSavedGroupGenieFormation = (role) =>
  getSavedGenieFormation(role, GENIE_FACTION_GROUP);

export const isSavedGenieFormationMatched = (role, genieId, targetTeam) => {
  const saved = getSavedGenieFormation(role, genieId);
  const hasShoeToy = Boolean(
    role?.lordWeapon?.[GENIE_SHOE_TOY_ID]
      ?? role?.lordWeapon?.[String(GENIE_SHOE_TOY_ID)],
  );
  const targetPetUId = selectHighestLevelPet(role)?.petUId ?? "";
  return Object.entries(targetTeam).every(
    ([slot, heroId]) => Number(saved.battleTeam?.[slot]) === heroId,
  )
    && Object.keys(saved.battleTeam || {}).length === Object.keys(targetTeam).length
    && saved.lordWeaponId === (hasShoeToy ? GENIE_SHOE_TOY_ID : 0)
    && String(saved.petUId || "") === String(targetPetUId || "");
};

export const isSavedGroupGenieFormationMatched = (role) => {
  const targetTeam = buildTargetBattleTeam();
  return isSavedGenieFormationMatched(role, GENIE_FACTION_GROUP, targetTeam);
};

export const buildGenieBattleParams = (
  role,
  genieId,
  battleTeam,
  reuseSaved = true,
) => {
  const hasShoeToy = Boolean(
    role?.lordWeapon?.[GENIE_SHOE_TOY_ID]
      ?? role?.lordWeapon?.[String(GENIE_SHOE_TOY_ID)],
  );
  const pet = selectHighestLevelPet(role);
  return {
    battleTeam:
      reuseSaved && isSavedGenieFormationMatched(role, genieId, battleTeam)
        ? {}
        : battleTeam,
    genieId,
    lordWeaponId: hasShoeToy ? GENIE_SHOE_TOY_ID : 0,
    ...(pet ? { petUId: pet.petUId } : {}),
  };
};

export const buildGroupGenieBattleParams = (role, reuseSaved = true) => {
  return buildGenieBattleParams(
    role,
    GENIE_FACTION_GROUP,
    buildTargetBattleTeam(),
    reuseSaved,
  );
};

export const getRemainingGenieChallenges = (role, now = new Date()) => {
  const used = isSameDay(role?.statisticsTime?.["genie:battle"], now)
    ? Math.max(0, Number(role?.statistics?.["genie:battle"] || 0))
    : 0;
  return Math.max(0, GENIE_DAILY_CHALLENGE_LIMIT - used);
};

export const didGroupGenieProgress = (response, previousProgress) => {
  return didGenieProgress(response, GENIE_FACTION_GROUP, previousProgress);
};

export const didGenieProgress = (response, genieId, previousProgress) => {
  const current = Number(
    response?.role?.genie?.[genieId]
      ?? response?.data?.role?.genie?.[genieId],
  );
  return Number.isInteger(current) && current > Number(previousProgress);
};
