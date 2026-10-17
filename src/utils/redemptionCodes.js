export const REDEMPTION_CODE_MODES = Object.freeze({
  DEFAULT: "default",
  CUSTOM: "custom",
});

export const DEFAULT_REDEMPTION_CODES = Object.freeze([
  "HAPPY666",
  "SVIP666",
  "VIP888",
  "vip666",
  "XYZW666",
  "XYZW888",
  "XYZW520",
  "QQ888",
  "QQXY888",
  "taptap666",
  "DOUYIN666",
  "DOUYIN888",
  "dalao666",
  "dalao888",
  "xyzwgame666",
  "MISS666",
]);

export function normalizeRedemptionCodes(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[\s,，;；]+/);

  return [...new Set(entries.map((code) => String(code).trim()).filter(Boolean))];
}

export function normalizeRedemptionCodeSettings(settings = {}) {
  const redemptionCodeMode =
    settings.redemptionCodeMode === REDEMPTION_CODE_MODES.CUSTOM
      ? REDEMPTION_CODE_MODES.CUSTOM
      : REDEMPTION_CODE_MODES.DEFAULT;
  const customRedemptionCodes = Array.isArray(settings.customRedemptionCodes)
    ? normalizeRedemptionCodes(settings.customRedemptionCodes).join("\n")
    : String(settings.customRedemptionCodes ?? "");

  return { redemptionCodeMode, customRedemptionCodes };
}

export function resolveRedemptionCodes(settings = {}) {
  const normalized = normalizeRedemptionCodeSettings(settings);
  return normalized.redemptionCodeMode === REDEMPTION_CODE_MODES.CUSTOM
    ? normalizeRedemptionCodes(normalized.customRedemptionCodes)
    : [...DEFAULT_REDEMPTION_CODES];
}
