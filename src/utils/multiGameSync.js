export const MULTI_GAME_INPUT_CHANNEL = "multi-game-input";
export const MULTI_GAME_INPUT_VERSION = 1;

const INPUT_ACTIONS = new Set(["pointerdown", "pointermove", "pointerup"]);

export function createMultiGameInputMessage({
  action,
  x,
  y,
  button = 0,
  buttons = 0,
  pointerId = 1,
  pointerType = "mouse",
}) {
  if (!INPUT_ACTIONS.has(action)) return null;
  if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    return null;
  }
  return {
    channel: MULTI_GAME_INPUT_CHANNEL,
    version: MULTI_GAME_INPUT_VERSION,
    type: "input",
    action,
    x,
    y,
    button: Number.isInteger(button) ? button : 0,
    buttons: Number.isInteger(buttons) ? buttons : 0,
    pointerId: Number.isInteger(pointerId) ? pointerId : 1,
    pointerType: typeof pointerType === "string" ? pointerType : "mouse",
  };
}

export function resolveMultiGameInputMessage({
  event,
  expectedOrigin,
  frames,
  frameElements,
  enabled,
  leaderScopeId,
}) {
  if (!enabled || event.origin !== expectedOrigin) return null;
  const payload = event.data;
  if (
    payload?.channel !== MULTI_GAME_INPUT_CHANNEL ||
    payload.version !== MULTI_GAME_INPUT_VERSION ||
    payload.type !== "input"
  ) {
    return null;
  }

  const frame = frames.find((item) => item.scopeId === leaderScopeId);
  const element = frame && frameElements.get(frame.scopeId);
  if (!frame || !element || event.source !== element.contentWindow) return null;

  const message = createMultiGameInputMessage(payload);
  return message ? { sourceScopeId: frame.scopeId, message } : null;
}

export function postMultiGameInputMessage(frameElement, message, targetOrigin) {
  if (!frameElement?.contentWindow || !message) return false;
  frameElement.contentWindow.postMessage(message, targetOrigin);
  return true;
}
