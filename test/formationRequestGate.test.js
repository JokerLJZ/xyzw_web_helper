import assert from "node:assert/strict";
import test from "node:test";
import { createFormationRequestGate } from "../src/utils/batch/formationRequestGate.js";

function clock() {
  let time = 10000;
  const waits = [];
  return { waits, now: () => time, advance: ms => { time += ms; }, sleep: async ms => { waits.push(ms); time += ms; } };
}

test("查询与写操作从响应结束计时，同账号并发串行", async () => {
  const c = clock(), gate = createFormationRequestGate(c), events = [];
  await Promise.all([
    gate("a", async () => { events.push(c.now()); c.advance(2000); }),
    gate("a", async () => { events.push(c.now()); }),
    gate("a", async () => { events.push(c.now()); }),
  ]);
  assert.deepEqual(events, [10000, 13500, 15000]);
  assert.deepEqual(c.waits, [1500, 1500]);
});

test("200400失败冷却约束后续查询及写操作，失败不阻塞队列", async () => {
  const c = clock(), gate = createFormationRequestGate(c);
  await assert.rejects(gate("a", async () => { throw new Error("200400 操作太快"); }));
  await gate("a", async () => {});
  await gate("a", async () => {});
  assert.deepEqual(c.waits, [6000, 1500]);
});

test("账号间不共用库存或限速时间", async () => {
  const c = clock(), gate = createFormationRequestGate(c);
  await assert.rejects(gate("a", async () => { throw new Error("200400"); }));
  await gate("b", async () => {});
  assert.deepEqual(c.waits, []);
});
