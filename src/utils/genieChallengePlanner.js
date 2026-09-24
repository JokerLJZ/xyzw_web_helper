export const GENIE_FACTION_GROUP = 4;
export const GENIE_DAILY_CHALLENGE_LIMIT = 10;
export const GENIE_SHOE_TOY_ID = 2;

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

export const getSavedGroupGenieFormation = (role) => ({
  battleTeam:
    role?.genieBattleTeam?.[GENIE_FACTION_GROUP]
      ?? role?.genieBattleTeam?.[String(GENIE_FACTION_GROUP)]
      ?? {},
  lordWeaponId: Number(
    role?.genieLordWeapon?.[GENIE_FACTION_GROUP]
      ?? role?.genieLordWeapon?.[String(GENIE_FACTION_GROUP)]
      ?? 0,
  ) || 0,
  petUId:
    role?.geniePet?.[GENIE_FACTION_GROUP]
      ?? role?.geniePet?.[String(GENIE_FACTION_GROUP)]
      ?? "",
});

export const isSavedGroupGenieFormationMatched = (role) => {
  const targetTeam = buildTargetBattleTeam();
  const saved = getSavedGroupGenieFormation(role);
  const hasShoeToy = Boolean(
    role?.lordWeapon?.[GENIE_SHOE_TOY_ID]
      ?? role?.lordWeapon?.[String(GENIE_SHOE_TOY_ID)],
  );
  const targetPetUId = selectHighestLevelPet(role)?.petUId ?? "";
  return Object.entries(targetTeam).every(
    ([slot, heroId]) => Number(saved.battleTeam?.[slot]) === heroId,
  )
    && Object.keys(saved.battleTeam || {}).length === GROUP_GENIE_LINEUP.length
    && saved.lordWeaponId === (hasShoeToy ? GENIE_SHOE_TOY_ID : 0)
    && String(saved.petUId || "") === String(targetPetUId || "");
};

export const buildGroupGenieBattleParams = (role, reuseSaved = true) => {
  const battleTeam = Object.fromEntries(
    GROUP_GENIE_LINEUP.map(({ slot, heroId }) => [slot, heroId]),
  );
  const hasShoeToy = Boolean(
    role?.lordWeapon?.[GENIE_SHOE_TOY_ID]
      ?? role?.lordWeapon?.[String(GENIE_SHOE_TOY_ID)],
  );
  const pet = selectHighestLevelPet(role);
  return {
    battleTeam:
      reuseSaved && isSavedGroupGenieFormationMatched(role)
        ? {}
        : battleTeam,
    genieId: GENIE_FACTION_GROUP,
    lordWeaponId: hasShoeToy ? GENIE_SHOE_TOY_ID : 0,
    ...(pet ? { petUId: pet.petUId } : {}),
  };
};

export const getRemainingGenieChallenges = (role, now = new Date()) => {
  const used = isSameDay(role?.statisticsTime?.["genie:battle"], now)
    ? Math.max(0, Number(role?.statistics?.["genie:battle"] || 0))
    : 0;
  return Math.max(0, GENIE_DAILY_CHALLENGE_LIMIT - used);
};

export const didGroupGenieProgress = (response, previousProgress) => {
  const current = Number(
    response?.role?.genie?.[GENIE_FACTION_GROUP]
      ?? response?.data?.role?.genie?.[GENIE_FACTION_GROUP],
  );
  return Number.isInteger(current) && current > Number(previousProgress);
};
