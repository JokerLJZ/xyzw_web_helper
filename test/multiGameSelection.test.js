import assert from "node:assert/strict";
import test from "node:test";

import {
  pruneTokenSelection,
  selectAllTokenIds,
  toggleTokenSelection,
} from "@/utils/gameSelection";

test("token selection helpers do not mutate the original set", () => {
  const current = new Set(["a"]);
  const selected = toggleTokenSelection(current, "b", true);
  const removed = toggleTokenSelection(selected, "a", false);

  assert.deepEqual([...current], ["a"]);
  assert.deepEqual([...selected], ["a", "b"]);
  assert.deepEqual([...removed], ["b"]);
});

test("selection helpers preserve token order and prune deleted tokens", () => {
  const tokens = [{ id: "b" }, { id: "a" }];
  assert.deepEqual([...selectAllTokenIds(tokens)], ["b", "a"]);
  assert.deepEqual(
    [...pruneTokenSelection(new Set(["a", "missing"]), tokens)],
    ["a"],
  );
});
