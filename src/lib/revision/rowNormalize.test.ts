import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBlockRow } from "./rowNormalize";

test("BOOLEAN sloupce z 0/1 na false/true", () => {
  const out = normalizeBlockRow({ locked: 1, dataOk: 0, scheduleBypassed: 1 });
  assert.equal(out.locked, true);
  assert.equal(out.dataOk, false);
  assert.equal(out.scheduleBypassed, true);
});

test("NULL v BOOLEAN sloupci zůstane null, ne false", () => {
  const out = normalizeBlockRow({ locked: null });
  assert.equal(out.locked, null);
});

test("DATETIME řetězec na Date", () => {
  const out = normalizeBlockRow({ startTime: "2026-09-03 06:00:00.000" });
  assert.ok(out.startTime instanceof Date);
  assert.equal((out.startTime as Date).toISOString(), "2026-09-03T06:00:00.000Z");
});

test("DATETIME, které už je Date, projde beze změny", () => {
  const d = new Date("2026-09-03T06:00:00.000Z");
  const out = normalizeBlockRow({ endTime: d });
  assert.equal((out.endTime as Date).getTime(), d.getTime());
});

test("NULL v DATETIME sloupci zůstane null", () => {
  const out = normalizeBlockRow({ printCompletedAt: null });
  assert.equal(out.printCompletedAt, null);
});

test("ostatní sloupce projdou beze změny", () => {
  const out = normalizeBlockRow({ orderNumber: "5000", printMinutes: 480, machine: "XL_105" });
  assert.equal(out.orderNumber, "5000");
  assert.equal(out.printMinutes, 480);
  assert.equal(out.machine, "XL_105");
});
