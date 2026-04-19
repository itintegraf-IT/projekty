import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHIFTS,
  SHIFT_HOURS,
  shiftFromHour,
  isSlotInShift,
  activeShiftsForDay,
  resolveShiftBounds,
  isHourActive,
  type ShiftType,
  type ShiftFlags,
} from "./shifts";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

function makeRow(overrides: Partial<MachineWeekShiftsRow> = {}): MachineWeekShiftsRow {
  return {
    machine: "XL_105", weekStart: "2026-04-13", dayOfWeek: 1,
    isActive: true, morningOn: true, afternoonOn: true, nightOn: true,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
    ...overrides,
  };
}

test("SHIFTS konstanty obsahují 3 směny", () => {
  assert.deepEqual(SHIFTS, ["MORNING", "AFTERNOON", "NIGHT"]);
});

test("SHIFT_HOURS — ranní je 06-14", () => {
  assert.deepEqual(SHIFT_HOURS.MORNING, { start: 6, end: 14 });
});

test("SHIFT_HOURS — odpolední je 14-22", () => {
  assert.deepEqual(SHIFT_HOURS.AFTERNOON, { start: 14, end: 22 });
});

test("SHIFT_HOURS — noční je 22-06 (přes půlnoc)", () => {
  assert.deepEqual(SHIFT_HOURS.NIGHT, { start: 22, end: 6 });
});

test("shiftFromHour — 7:00 patří do ranní", () => {
  assert.equal(shiftFromHour(7), "MORNING");
});

test("shiftFromHour — 13:59 patří do ranní (end exclusive)", () => {
  assert.equal(shiftFromHour(13.9), "MORNING");
});

test("shiftFromHour — 14:00 patří do odpolední", () => {
  assert.equal(shiftFromHour(14), "AFTERNOON");
});

test("shiftFromHour — 22:00 patří do noční", () => {
  assert.equal(shiftFromHour(22), "NIGHT");
});

test("shiftFromHour — 3:00 patří do noční (přes půlnoc)", () => {
  assert.equal(shiftFromHour(3), "NIGHT");
});

test("shiftFromHour — 5:59 patří do noční", () => {
  assert.equal(shiftFromHour(5.9), "NIGHT");
});

test("isSlotInShift — slot 12 (06:00) patří do ranní (true)", () => {
  assert.equal(isSlotInShift(12, "MORNING"), true);
});

test("isSlotInShift — slot 0 (00:00) patří do noční (true)", () => {
  assert.equal(isSlotInShift(0, "NIGHT"), true);
});

test("activeShiftsForDay — všechny zapnuté → vrátí všechny 3", () => {
  const flags: ShiftFlags = { morningOn: true, afternoonOn: true, nightOn: true };
  assert.deepEqual(activeShiftsForDay(flags), ["MORNING", "AFTERNOON", "NIGHT"]);
});

test("activeShiftsForDay — jen ranní a noční", () => {
  const flags: ShiftFlags = { morningOn: true, afternoonOn: false, nightOn: true };
  assert.deepEqual(activeShiftsForDay(flags), ["MORNING", "NIGHT"]);
});

test("activeShiftsForDay — všechny vypnuté → prázdné pole", () => {
  const flags: ShiftFlags = { morningOn: false, afternoonOn: false, nightOn: false };
  assert.deepEqual(activeShiftsForDay(flags), []);
});

// resolveShiftBounds tests
test("resolveShiftBounds — default MORNING (no override)", () => {
  const row = makeRow();
  assert.deepEqual(resolveShiftBounds(row, "MORNING"), { startMin: 360, endMin: 840 });
});

test("resolveShiftBounds — default AFTERNOON", () => {
  const row = makeRow();
  assert.deepEqual(resolveShiftBounds(row, "AFTERNOON"), { startMin: 840, endMin: 1320 });
});

test("resolveShiftBounds — default NIGHT (cross midnight)", () => {
  const row = makeRow();
  assert.deepEqual(resolveShiftBounds(row, "NIGHT"), { startMin: 1320, endMin: 360 });
});

test("resolveShiftBounds — override MORNING end only", () => {
  const row = makeRow({ morningEndMin: 810 }); // 13:30
  assert.deepEqual(resolveShiftBounds(row, "MORNING"), { startMin: 360, endMin: 810 });
});

test("resolveShiftBounds — override MORNING start and end", () => {
  const row = makeRow({ morningStartMin: 420, morningEndMin: 810 }); // 7:00–13:30
  assert.deepEqual(resolveShiftBounds(row, "MORNING"), { startMin: 420, endMin: 810 });
});

test("resolveShiftBounds — shift OFF → null (ignore override)", () => {
  const row = makeRow({ morningOn: false, morningEndMin: 810 });
  assert.equal(resolveShiftBounds(row, "MORNING"), null);
});

test("resolveShiftBounds — NIGHT override (cross midnight, 20:00–7:00)", () => {
  const row = makeRow({ nightStartMin: 1200, nightEndMin: 420 });
  assert.deepEqual(resolveShiftBounds(row, "NIGHT"), { startMin: 1200, endMin: 420 });
});
