import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSplitPrintMinutes } from "./splitCompute";
import { pragueToUTC } from "./dateUtils";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";
import type { CompanyDayInterval } from "./printTime";

const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const NO_CD: CompanyDayInterval[] = [];

// Společný pátek 2026-08-21 10:00 (XL_106 běží Po–Čt nonstop, Pá do 22:00, So off, Ne od 22:00).
const friStart = pragueToUTC("2026-08-21", 10);

test("ne-ZAKAZKA → headPm/tailPm null (dělí se časem, ne tiskem)", () => {
  const r = computeSplitPrintMinutes({
    type: "UDRZBA", scheduleBypassed: false, machine: "XL_106",
    startTime: friStart, splitAt: pragueToUTC("2026-08-21", 16),
    totalPrintMinutes: null, weekShifts: SHIFTS, companyDayIntervals: NO_CD,
  });
  assert.deepEqual(r, { ok: true, headPm: null, tailPm: null });
});

test("non-bypass runnable split → head/tail z computePrintMinutes", () => {
  const r = computeSplitPrintMinutes({
    type: "ZAKAZKA", scheduleBypassed: false, machine: "XL_106",
    startTime: friStart, splitAt: pragueToUTC("2026-08-21", 16), // 6h runnable
    totalPrintMinutes: 720, weekShifts: SHIFTS, companyDayIntervals: NO_CD,
  });
  assert.deepEqual(r, { ok: true, headPm: 360, tailPm: 360 });
});

test("bypass → elapsed-based head (nepočítá kalendář)", () => {
  const r = computeSplitPrintMinutes({
    type: "ZAKAZKA", scheduleBypassed: true, machine: "XL_106",
    startTime: friStart, splitAt: pragueToUTC("2026-08-21", 16), // 6h elapsed
    totalPrintMinutes: 720, weekShifts: SHIFTS, companyDayIntervals: NO_CD,
  });
  assert.deepEqual(r, { ok: true, headPm: 360, tailPm: 360 });
});

test("splitAt v pauze (sobota) → IN_PAUSE", () => {
  const r = computeSplitPrintMinutes({
    type: "ZAKAZKA", scheduleBypassed: false, machine: "XL_106",
    startTime: friStart, splitAt: pragueToUTC("2026-08-22", 12), // sobota = odstávka
    totalPrintMinutes: 1620, weekShifts: SHIFTS, companyDayIntervals: NO_CD,
  });
  assert.deepEqual(r, { ok: false, reason: "IN_PAUSE" });
});

test("nezarovnaný splitAt (10:15) → NOT_ALIGNED (před computePrintMinutes, které by hodilo)", () => {
  const r = computeSplitPrintMinutes({
    type: "ZAKAZKA", scheduleBypassed: false, machine: "XL_106",
    startTime: friStart, splitAt: new Date(friStart.getTime() + 15 * 60000), // 10:15
    totalPrintMinutes: 720, weekShifts: SHIFTS, companyDayIntervals: NO_CD,
  });
  assert.deepEqual(r, { ok: false, reason: "NOT_ALIGNED" });
});

test("degenerovaný split (tailPm = 0) → DEGENERATE", () => {
  const r = computeSplitPrintMinutes({
    type: "ZAKAZKA", scheduleBypassed: false, machine: "XL_106",
    startTime: friStart, splitAt: pragueToUTC("2026-08-21", 16), // headPm 360
    totalPrintMinutes: 360, weekShifts: SHIFTS, companyDayIntervals: NO_CD, // tailPm 0
  });
  assert.deepEqual(r, { ok: false, reason: "DEGENERATE" });
});

test("bypass s nenásobkem 30 (45 min head) → NOT_ALIGNED (validateAndComputeEnd by ho odmítl 422)", () => {
  const r = computeSplitPrintMinutes({
    type: "ZAKAZKA", scheduleBypassed: true, machine: "XL_106",
    startTime: friStart, splitAt: new Date(friStart.getTime() + 45 * 60000), // 45 min
    totalPrintMinutes: 90, weekShifts: SHIFTS, companyDayIntervals: NO_CD,
  });
  assert.deepEqual(r, { ok: false, reason: "NOT_ALIGNED" });
});
