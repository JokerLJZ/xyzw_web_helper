import assert from "node:assert/strict";
import test from "node:test";

import {
  createMultiGameInputMessage,
  postMultiGameInputMessage,
  resolveMultiGameInputMessage,
} from "@/utils/multiGameSync";

const scopeA = "mg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const scopeB = "mg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

test("input messages are normalized and reject invalid coordinates", () => {
  assert.deepEqual(
    createMultiGameInputMessage({ action: "pointerdown", x: 0.25, y: 0.75 }),
    {
      channel: "multi-game-input",
      version: 1,
      type: "input",
      action: "pointerdown",
      x: 0.25,
      y: 0.75,
      button: 0,
      buttons: 0,
      pointerId: 1,
      pointerType: "mouse",
    },
  );
  assert.equal(
    createMultiGameInputMessage({ action: "click", x: 0.25, y: 0.75 }),
    null,
  );
  assert.equal(
    createMultiGameInputMessage({ action: "pointerdown", x: 1.1, y: 0.5 }),
    null,
  );
});

test("only the selected leader iframe can control followers", () => {
  const leaderWindow = {};
  const otherWindow = {};
  const frames = [{ scopeId: scopeA }, { scopeId: scopeB }];
  const frameElements = new Map([
    [scopeA, { contentWindow: leaderWindow }],
    [scopeB, { contentWindow: otherWindow }],
  ]);
  const event = {
    origin: "https://helper.example",
    source: leaderWindow,
    data: createMultiGameInputMessage({
      action: "pointerup",
      x: 0.4,
      y: 0.6,
    }),
  };

  assert.equal(
    resolveMultiGameInputMessage({
      event,
      expectedOrigin: "https://helper.example",
      frames,
      frameElements,
      enabled: true,
      leaderScopeId: scopeA,
    }).sourceScopeId,
    scopeA,
  );
  assert.equal(
    resolveMultiGameInputMessage({
      event: { ...event, source: otherWindow },
      expectedOrigin: "https://helper.example",
      frames,
      frameElements,
      enabled: true,
      leaderScopeId: scopeA,
    }),
    null,
  );
});

test("posting an input message targets the child window", () => {
  const posted = [];
  const element = { contentWindow: { postMessage: (...args) => posted.push(args) } };
  const message = createMultiGameInputMessage({
    action: "pointerdown",
    x: 0.1,
    y: 0.2,
  });
  assert.equal(postMultiGameInputMessage(element, message, "https://helper.example"), true);
  assert.deepEqual(posted, [[message, "https://helper.example"]]);
});
