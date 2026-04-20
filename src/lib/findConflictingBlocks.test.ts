import { test } from "node:test";
import assert from "node:assert";
import { detectConflictsPure, type WeekRowInput } from "./findConflictingBlocks";

function allOffRow(dow: number): WeekRowInput {
  return {
    dayOfWeek: dow, morningOn: false, afternoonOn: false, nightOn: false, isActive: false,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
  };
}
function morningRow(dow: number, endMin?: number): WeekRowInput {
  return { ...allOffRow(dow), morningOn: true, isActive: true, morningEndMin: endMin ?? null };
}
function weekWithRow(row: WeekRowInput): WeekRowInput[] {
  const out: WeekRowInput[] = [];
  for (let d = 0; d < 7; d++) out.push(d === row.dayOfWeek ? row : allOffRow(d));
  return out;
}

test("detectConflictsPure — blok uvnitř MORNING → není konflikt", () => {
  const rows = weekWithRow(morningRow(1)); // pondělí MORNING 6-14
  const blocks = [{
    id: 1, orderNumber: "X", description: null,
    startTime: new Date("2026-04-20T08:00:00+02:00"), // Po 08:00 Prague
    endTime:   new Date("2026-04-20T10:00:00+02:00"), // Po 10:00 Prague
  }];
  const result = detectConflictsPure("XL_106", "2026-04-20", rows, blocks);
  assert.equal(result.length, 0);
});

test("detectConflictsPure — blok přes override end → konflikt", () => {
  // MORNING Po zkrácené na 13:00 (override end 780)
  const rows = weekWithRow(morningRow(1, 780));
  const blocks = [{
    id: 42, orderNumber: "Y", description: "foo",
    startTime: new Date("2026-04-20T12:00:00+02:00"), // Po 12:00
    endTime:   new Date("2026-04-20T14:00:00+02:00"), // Po 14:00 — překročí 13:00 end
  }];
  const result = detectConflictsPure("XL_106", "2026-04-20", rows, blocks);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 42);
});

test("detectConflictsPure — cross-midnight blok Ne NIGHT ✓ → Po 05:00 → není konflikt (forward)", () => {
  const rows: WeekRowInput[] = [];
  for (let d = 0; d < 7; d++) {
    if (d === 0) rows.push({ ...allOffRow(0), nightOn: true, isActive: true });
    else rows.push(allOffRow(d));
  }
  const blocks = [{
    id: 7, orderNumber: "N", description: null,
    startTime: new Date("2026-04-19T22:00:00+02:00"), // Ne 22:00
    endTime:   new Date("2026-04-20T05:00:00+02:00"), // Po 05:00
  }];
  const result = detectConflictsPure("XL_106", "2026-04-13", rows, blocks);
  assert.equal(result.length, 0, "forward semantic: Ne NIGHT pokrývá Po 0-6 jako tail");
});
