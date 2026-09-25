import test from "node:test";
import assert from "node:assert/strict";

import { selectBestFishArtifact } from "../src/utils/fishArtifactReplacement.js";

test("鱼灵替换优先赤羽，其次焰神，再到其他红鱼", () => {
  const selected = selectBestFishArtifact(
    {
      role: {
        items: {
          13011: { quantity: 1 },
          13025: { quantity: 1 },
          13041: { quantity: 1 },
        },
      },
    },
    107,
  );

  assert.equal(selected.itemId, 13041);
});

test("同种鱼灵选择最高星", () => {
  const selected = selectBestFishArtifact(
    { role: { items: { 13042: { quantity: 1 }, 13045: { quantity: 1 } } } },
    107,
  );

  assert.equal(selected.itemId, 13045);
});

test("没有红鱼时按橙紫蓝逐级选择最高星", () => {
  const selected = selectBestFishArtifact(
    {
      role: {
        items: {
          14011: { quantity: 1 },
          14025: { quantity: 1 },
          15015: { quantity: 1 },
          16015: { quantity: 1 },
        },
      },
    },
    107,
  );

  assert.equal(selected.itemId, 14025);
});

test("包含其他武将已装备的鱼灵并忽略金色专属鱼灵", () => {
  const selected = selectBestFishArtifact(
    {
      role: {
        items: { 12015: { quantity: 1 }, 14015: { quantity: 1 } },
        heroes: {
          106: { artifactId: 13024 },
          107: { artifactId: 15015 },
        },
      },
    },
    107,
  );

  assert.equal(selected.itemId, 13024);
  assert.equal(selected.holderHeroId, 106);
});

test("同一鱼灵同星时优先保留目标武将当前装备", () => {
  const selected = selectBestFishArtifact(
    {
      role: {
        items: { 13045: { quantity: 1 } },
        heroes: { 107: { artifactId: 13045 } },
      },
    },
    107,
  );

  assert.equal(selected.holderHeroId, 107);
});
