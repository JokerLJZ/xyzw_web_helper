import test from "node:test";
import assert from "node:assert/strict";
import { collectOpenGuessRounds } from "@/utils/batch/tasksApex";
import { ApexScheduleStatus } from "@/utils/apexRules";

test("逐鹿盐山批量竞猜保留所有重叠开放的期次", () => {
  const tabsByRound = {
    4: [{ state: ApexScheduleStatus.Unlocked, scheduleId: 401 }],
    5: [{ state: ApexScheduleStatus.Locked, scheduleId: 501 }],
    6: [{ state: ApexScheduleStatus.Completed, scheduleId: 601 }],
  };
  const result = collectOpenGuessRounds(
    2,
    [4, 5, 6],
    Date.now(),
    (round) => tabsByRound[round],
  );
  assert.deepEqual(
    result.map(({ round }) => round),
    [4, 5],
  );
});
