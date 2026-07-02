import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findNextFreeSlot, MAX_AUTO_SHIFT_MS, type BlockedInterval } from "./scheduleSlotFinder";
import { findNextFreePrintSlot } from "./scheduleSlotFinder";
import { pragueToUTC } from "./dateUtils";
import type { CompanyDayInterval } from "./printTime";
import { xl106Week, mkDay, W1, W2 } from "./weekShiftsTestFixtures";
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

describe("findNextFreePrintSlot (tiskové hodiny)", () => {
  const SHIFTS_106 = [...xl106Week(W1), ...xl106Week(W2)];
  const NO_CD: CompanyDayInterval[] = [];
  const P = pragueToUTC;

  it("40h blok přes víkend: start zůstává, end z expanze (span > délka)", () => {
    // Pá 10:00 + 2400 min: Pá 10–22 = 12 h, víkendová pauza, Ne 22 – Út 02 = 28 h → end Út 02:00.
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 2400, [], SHIFTS_106, NO_CD);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-21", 10));
      assert.deepEqual(r.endTime, P("2026-08-25", 2));
      assert.equal(r.wasShifted, false);
    }
  });

  it("limit 7 dní platí pro POSUN STARTU — end smí být za limitem", () => {
    // maxShift 4 h; kolize [Pá 10, Pá 12) → start Pá 12 (posun 2 h, v limitu),
    // end z expanze až Út 04:00 — daleko za limitem, a to je SPRÁVNĚ.
    const blocked = [{ start: P("2026-08-21", 10), end: P("2026-08-21", 12) }];
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 2400, blocked, SHIFTS_106, NO_CD, 4 * 3600000);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-21", 12));
      assert.deepEqual(r.endTime, P("2026-08-25", 4));
      assert.equal(r.wasShifted, true);
    }
  });

  it("start nelze posunout v limitu → MAX_SHIFT_EXCEEDED", () => {
    const blocked = [{ start: P("2026-08-21", 10), end: P("2026-08-21", 16) }];
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 240, blocked, SHIFTS_106, NO_CD, 4 * 3600000);
    assert.deepEqual(r, { found: false, reason: "MAX_SHIFT_EXCEEDED" });
  });

  it("firemní odstávka NENÍ blocker — blok ji pauzne", () => {
    // Po 20:00 + 8 h tisku, odstávka celé úterý: Po 20–24 = 4 h, pauza Út, St 0–4 = 4 h → end St 04:00.
    const cd: CompanyDayInterval[] = [{ start: P("2026-08-25", 0), end: P("2026-08-26", 0) }];
    const r = findNextFreePrintSlot("XL_106", P("2026-08-24", 20), 480, [], SHIFTS_106, cd);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-24", 20));
      assert.deepEqual(r.endTime, P("2026-08-26", 4));
      assert.equal(r.wasShifted, false);
    }
  });

  it("v horizontu není dost pracovní doby → NO_CAPACITY", () => {
    // Jen pátek m+a (12 h/týden) → 40 h tisku se do 21denního horizontu expanze nevejde.
    // Horizont MAX_SPAN_DAYS=21 od Pá 21. 8. 10:00 sahá až do 11. 9. — to protíná 4 týdny
    // (17. 8., 24. 8., 31. 8., 7. 9.). W1+W2 pokrývají jen první dva; bez explicitních
    // W3/W4 by nepokryté týdny spadly na hardcoded fallback (aktivní 24/7 mimo neděli
    // odpoledne) a test by falešně prošel s found:true. Proto W3/W4 = celé týdny off.
    const W3 = "2026-08-31";
    const W4 = "2026-09-07";
    const sparse = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
      mkDay(W1, d, d === 5 ? { m: true, a: true } : { active: false }),
      mkDay(W2, d, d === 5 ? { m: true, a: true } : { active: false }),
      mkDay(W3, d, { active: false }),
      mkDay(W4, d, { active: false }),
    ]);
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 2400, [], sparse, NO_CD);
    assert.deepEqual(r, { found: false, reason: "NO_CAPACITY" });
  });
});
