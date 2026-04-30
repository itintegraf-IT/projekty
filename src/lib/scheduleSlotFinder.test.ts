import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findNextFreeSlot, MAX_AUTO_SHIFT_MS, type BlockedInterval } from "./scheduleSlotFinder";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

const MACHINE = "XL_105";
const HOUR_MS = 60 * 60 * 1000;

/** Helper: prázdný weekShifts → fallback na hardcoded working hours (XL_105: 24/7 mimo neděli odpoledne). */
const NO_SHIFTS: MachineWeekShiftsRow[] = [];

describe("findNextFreeSlot", () => {
  it("vrátí původní čas když je slot volný a v pracovní době", () => {
    const start = new Date("2026-09-15T10:00:00.000Z"); // úterý ráno UTC = poledne Praha
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, [], NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.getTime(), start.getTime());
      assert.equal(result.wasShifted, false);
    }
  });

  it("posune slot za konec kolidujícího bloku", () => {
    const start = new Date("2026-09-15T12:00:00.000Z");
    const blocked: BlockedInterval[] = [
      // Kolize končí v 16:00Z = 18:00 Praha (CEST) — stále v pracovní době XL_105
      { start: new Date("2026-09-15T12:00:00.000Z"), end: new Date("2026-09-15T16:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.toISOString(), "2026-09-15T16:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });

  it("přeskočí přes řadu kolidujících bloků", () => {
    const start = new Date("2026-09-15T12:00:00.000Z");
    const blocked: BlockedInterval[] = [
      { start: new Date("2026-09-15T12:00:00.000Z"), end: new Date("2026-09-15T16:00:00.000Z") },
      { start: new Date("2026-09-15T16:00:00.000Z"), end: new Date("2026-09-15T20:00:00.000Z") },
      { start: new Date("2026-09-15T20:00:00.000Z"), end: new Date("2026-09-16T04:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 2 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.toISOString(), "2026-09-16T04:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });

  it("nepoškozená kolize (blok končí před proposedStart) → žádný posun", () => {
    // proposedStart = 16:00Z = 18:00 Praha (CEST) — v pracovní době XL_105
    // kolize končí přesně na proposedStart → nepřekrývá se, žádný posun
    const start = new Date("2026-09-15T16:00:00.000Z");
    const blocked: BlockedInterval[] = [
      { start: new Date("2026-09-15T10:00:00.000Z"), end: new Date("2026-09-15T16:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.getTime(), start.getTime());
      assert.equal(result.wasShifted, false);
    }
  });

  it("vrátí MAX_SHIFT_EXCEEDED když je obsazené déle než 7 dní", () => {
    const start = new Date("2026-09-15T12:00:00.000Z");
    const blocked: BlockedInterval[] = [
      { start: new Date("2026-09-15T12:00:00.000Z"), end: new Date("2026-09-30T00:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, false);
    if (!result.found) {
      assert.equal(result.reason, "MAX_SHIFT_EXCEEDED");
    }
  });

  it("MAX_AUTO_SHIFT_MS = 7 dní", () => {
    assert.equal(MAX_AUTO_SHIFT_MS, 7 * 24 * 60 * 60 * 1000);
  });
});
