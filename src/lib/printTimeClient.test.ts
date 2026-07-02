import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { blockPrintMinutes, companyDayIntervalsFor, snapGroupDeltaStartOnly } from "./printTimeClient";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";

const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];

test("blockPrintMinutes: ZAKAZKA s printMinutes → printMinutes", () => {
  assert.equal(
    blockPrintMinutes({ type: "ZAKAZKA", printMinutes: 240, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-20T08:00:00.000Z" }),
    240
  );
});

test("blockPrintMinutes: ZAKAZKA bez printMinutes → elapsed fallback", () => {
  assert.equal(
    blockPrintMinutes({ type: "ZAKAZKA", printMinutes: null, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T12:00:00.000Z" }),
    240
  );
});

test("blockPrintMinutes: UDRZBA ignoruje printMinutes → elapsed", () => {
  assert.equal(
    blockPrintMinutes({ type: "UDRZBA", printMinutes: 999, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T10:00:00.000Z" }),
    120
  );
});

test("companyDayIntervalsFor: filtruje stroj a převádí na Date intervaly", () => {
  const cds = [
    { machine: null, startDate: "2026-08-18T00:00:00.000Z", endDate: "2026-08-19T00:00:00.000Z" },
    { machine: "XL_105", startDate: "2026-08-20T00:00:00.000Z", endDate: "2026-08-21T00:00:00.000Z" },
    { machine: "XL_106", startDate: "2026-08-22T00:00:00.000Z", endDate: "2026-08-23T00:00:00.000Z" },
  ];
  const out = companyDayIntervalsFor("XL_106", cds);
  assert.equal(out.length, 2); // global + XL_106
  assert.deepEqual(out[0], { start: new Date("2026-08-18T00:00:00.000Z"), end: new Date("2026-08-19T00:00:00.000Z") });
});

test("snapGroupDeltaStartOnly: delta do pracovní doby se nemění", () => {
  const blocks = [{ machine: "XL_106", originalStart: pragueToUTC("2026-08-18", 8) }];
  const r = snapGroupDeltaStartOnly(blocks, 2 * 3600000, SHIFTS, []);
  assert.ok(r);
  assert.equal(r!.deltaMs, 2 * 3600000);
  assert.equal(r!.wasSnapped, false);
});

test("snapGroupDeltaStartOnly: start v odstávce → delta se zvedne na první runnable slot (start-only, délka nehraje roli)", () => {
  // Út 20:00 + delta 4 h = St 00:00? ne — Út má plný provoz; použij posun do soboty:
  // Pá 10:00 + delta 26 h = So 12:00 (odstávka) → snap na Ne 22:00 → delta se zvedne
  const blocks = [{ machine: "XL_106", originalStart: pragueToUTC("2026-08-21", 10) }];
  const r = snapGroupDeltaStartOnly(blocks, 26 * 3600000, SHIFTS, []);
  assert.ok(r);
  const snappedStart = new Date(pragueToUTC("2026-08-21", 10).getTime() + r!.deltaMs);
  assert.deepEqual(snappedStart, pragueToUTC("2026-08-23", 22));
  assert.equal(r!.wasSnapped, true);
});

test("blockPrintMinutes: nezarovnaný elapsed fallback se zarovná na 30min grid (min 30)", () => {
  // legacy blok bez printMinutes, span 4:25 → 265 min → zarovnáno na 270
  assert.equal(
    blockPrintMinutes({ type: "ZAKAZKA", printMinutes: null, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T12:25:00.000Z" }),
    270
  );
  // mini span 10 min → minimum 30
  assert.equal(
    blockPrintMinutes({ type: "ZAKAZKA", printMinutes: null, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T08:10:00.000Z" }),
    30
  );
  // ne-ZAKAZKA zůstává surový elapsed (server nevaliduje, endTime cesty ho čekají přesný)
  assert.equal(
    blockPrintMinutes({ type: "UDRZBA", printMinutes: null, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T12:25:00.000Z" }),
    265
  );
});
