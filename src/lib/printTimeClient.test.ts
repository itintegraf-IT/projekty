import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import {
  blockPrintMinutes,
  companyDayIntervalsFor,
  snapGroupDeltaStartOnly,
  getBlockSegments,
  printMidpoint,
  blockCalendarDrift,
  blockReportSegments,
  printOverlapMinutes,
  splitGroupTotalPrintMinutes,
  formatPrintHoursShort,
} from "./printTimeClient";
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

test("getBlockSegments: pauznutý blok vrací print/pause segmenty sedící na end", () => {
  // Pá 10:00 + 27 h (Gardena): print Pá 10–22, pause víkend, print Ne 22 – Po 13
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-24", 13),
    printMinutes: 27 * 60, scheduleBypassed: false,
  };
  const segs = getBlockSegments(b, SHIFTS, []);
  assert.ok(segs);
  assert.deepEqual(segs!.map((s) => s.kind), ["print", "pause", "print"]);
  assert.deepEqual(segs![1]!.start, pragueToUTC("2026-08-21", 22));
  assert.deepEqual(segs![1]!.end, pragueToUTC("2026-08-23", 22));
});

test("getBlockSegments: souvislý blok (bez pauzy) → null (overlay není potřeba)", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    printMinutes: 240, scheduleBypassed: false,
  };
  assert.equal(getBlockSegments(b, SHIFTS, []), null);
});

test("getBlockSegments: drift kalendáře (end nesedí na expand) → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0), // špatný end
    printMinutes: 27 * 60, scheduleBypassed: false,
  };
  assert.equal(getBlockSegments(b, SHIFTS, []), null);
});

test("getBlockSegments: bypass blok → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-22", 12), endTime: pragueToUTC("2026-08-22", 16),
    printMinutes: 240, scheduleBypassed: true,
  };
  assert.equal(getBlockSegments(b, SHIFTS, []), null);
});

test("printMidpoint: Gardena 27 h → polovina (13,5 h) odpracována Ne 23:30", () => {
  // Pá 10–22 = 12 h; zbytek 1,5 h od Ne 22:00 → 23:30
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-24", 13),
    printMinutes: 27 * 60, scheduleBypassed: false,
  };
  assert.deepEqual(printMidpoint(b, SHIFTS, []), pragueToUTC("2026-08-23", 23, 30));
});

test("printMidpoint: bez segmentů (souvislý blok) → midpoint z printMinutes/2 od startu", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    printMinutes: 240, scheduleBypassed: false,
  };
  assert.deepEqual(printMidpoint(b, SHIFTS, []), pragueToUTC("2026-08-18", 10));
});

const NOW = pragueToUTC("2026-08-01", 0); // dávno před všemi fixturami níže → "endTime > now" splněno všude, pokud netestujeme opak

test("blockCalendarDrift: sedící blok (end == expanze) → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    printMinutes: 240, scheduleBypassed: false, printCompletedAt: null,
  };
  assert.equal(blockCalendarDrift(b, SHIFTS, [], NOW), null);
});

test("blockCalendarDrift: end nesedí na expanzi → END_MISMATCH + expectedEnd", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0), // špatný end (stejná fixtura jako getBlockSegments drift test)
    printMinutes: 27 * 60, scheduleBypassed: false, printCompletedAt: null,
  };
  const drift = blockCalendarDrift(b, SHIFTS, [], NOW);
  assert.ok(drift);
  assert.equal(drift!.reason, "END_MISMATCH");
  assert.deepEqual(drift!.expectedEnd, pragueToUTC("2026-08-24", 13));
});

test("blockCalendarDrift: start mimo provoz (odstávka) → START_NOT_RUNNABLE", () => {
  const b = {
    // sobota je v xl106Week celá off (víkendová odstávka Pá 22 – Ne 22)
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-22", 10), endTime: pragueToUTC("2026-08-22", 14),
    printMinutes: 240, scheduleBypassed: false, printCompletedAt: null,
  };
  const drift = blockCalendarDrift(b, SHIFTS, [], NOW);
  assert.ok(drift);
  assert.equal(drift!.reason, "START_NOT_RUNNABLE");
  assert.equal(drift!.expectedEnd, null);
});

test("blockCalendarDrift: bypass blok → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0), // stejný "špatný" end jako drift test výše
    printMinutes: 27 * 60, scheduleBypassed: true, printCompletedAt: null,
  };
  assert.equal(blockCalendarDrift(b, SHIFTS, [], NOW), null);
});

test("blockCalendarDrift: vytištěný blok (printCompletedAt nastaven) → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0), // stejný "špatný" end
    printMinutes: 27 * 60, scheduleBypassed: false, printCompletedAt: "2026-08-24T13:00:00.000Z",
  };
  assert.equal(blockCalendarDrift(b, SHIFTS, [], NOW), null);
});

test("blockCalendarDrift: blok v minulosti (endTime <= now) → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0), // stejný "špatný" end — i tak null, protože už skončil
    printMinutes: 27 * 60, scheduleBypassed: false, printCompletedAt: null,
  };
  const pastNow = pragueToUTC("2026-08-25", 0); // now === endTime → endTime <= now
  assert.equal(blockCalendarDrift(b, SHIFTS, [], pastNow), null);
});

test("blockCalendarDrift: nezarovnaný start (mimo 30min grid) → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: new Date(pragueToUTC("2026-08-18", 8).getTime() + 5 * 60000), // +5 min mimo slot grid
    endTime: pragueToUTC("2026-08-18", 12),
    printMinutes: 240, scheduleBypassed: false, printCompletedAt: null,
  };
  assert.equal(blockCalendarDrift(b, SHIFTS, [], NOW), null);
});

test("blockCalendarDrift: printMinutes null → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    printMinutes: null, scheduleBypassed: false, printCompletedAt: null,
  };
  assert.equal(blockCalendarDrift(b, SHIFTS, [], NOW), null);
});

test("blockCalendarDrift: ne-ZAKAZKA blok → null (i s driftovým endem)", () => {
  const b = {
    type: "UDRZBA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0),
    printMinutes: 27 * 60, scheduleBypassed: false, printCompletedAt: null,
  };
  assert.equal(blockCalendarDrift(b, SHIFTS, [], NOW), null);
});

// ── blockReportSegments + printOverlapMinutes (etapa 7 — reporty) ───────────

// Souvislý blok: Út 18. 8. Praha 8:00–12:00 (06:00Z–10:00Z), pm=240, žádná pauza.
const CONT = {
  type: "ZAKAZKA", machine: "XL_106", printMinutes: 240,
  startTime: "2026-08-18T06:00:00.000Z", endTime: "2026-08-18T10:00:00.000Z",
};
// Blok přes víkendovou odstávku XL_106 (Pá 22:00 – Ne 22:00 Praha):
// start Pá 21. 8. Praha 20:00 (18:00Z), pm=240 → 2 h print, pauza víkend, 2 h print,
// end Po 00:00 Praha = 2026-08-23T22:00:00.000Z.
const PAUSED = {
  type: "ZAKAZKA", machine: "XL_106", printMinutes: 240,
  startTime: "2026-08-21T18:00:00.000Z", endTime: "2026-08-23T22:00:00.000Z",
};

test("blockReportSegments: souvislý blok bez pauzy → segmenty (rozdíl od getBlockSegments)", () => {
  const segs = blockReportSegments(CONT, SHIFTS, []);
  assert.ok(segs);
  assert.equal(segs!.length, 1);
  assert.equal(segs![0].kind, "print");
  assert.equal(segs![0].start.toISOString(), "2026-08-18T06:00:00.000Z");
  assert.equal(segs![0].end.toISOString(), "2026-08-18T10:00:00.000Z");
  // kontrast: getBlockSegments pro tentýž blok vrací null (overlay netřeba)
  assert.equal(getBlockSegments(CONT, SHIFTS, []), null);
});

test("blockReportSegments: blok přes odstávku → print/pause/print", () => {
  const segs = blockReportSegments(PAUSED, SHIFTS, []);
  assert.ok(segs);
  assert.deepEqual(segs!.map((s) => s.kind), ["print", "pause", "print"]);
  assert.equal(segs![0].end.toISOString(), "2026-08-21T20:00:00.000Z");
  assert.equal(segs![2].start.toISOString(), "2026-08-23T20:00:00.000Z");
});

test("blockReportSegments: drift endu → null", () => {
  const segs = blockReportSegments({ ...CONT, endTime: "2026-08-18T11:00:00.000Z" }, SHIFTS, []);
  assert.equal(segs, null);
});

test("blockReportSegments: bypass → null", () => {
  assert.equal(blockReportSegments({ ...CONT, scheduleBypassed: true }, SHIFTS, []), null);
});

test("blockReportSegments: printMinutes null (legacy) → null", () => {
  assert.equal(blockReportSegments({ ...CONT, printMinutes: null }, SHIFTS, []), null);
});

test("printOverlapMinutes: blok přes půlnoc se přes dva dny nedvojí (spec regrese)", () => {
  // Po 24. 8. (W2) Praha 22:00 → Út 06:00, pm=480, souvislá noční směna.
  const night = {
    type: "ZAKAZKA", machine: "XL_106", printMinutes: 480,
    startTime: "2026-08-24T20:00:00.000Z", endTime: "2026-08-25T04:00:00.000Z",
  };
  const segs = blockReportSegments(night, SHIFTS, []);
  assert.ok(segs);
  const day1 = printOverlapMinutes(segs, night, pragueToUTC("2026-08-24", 0, 0), pragueToUTC("2026-08-25", 0, 0));
  const day2 = printOverlapMinutes(segs, night, pragueToUTC("2026-08-25", 0, 0), pragueToUTC("2026-08-26", 0, 0));
  assert.equal(day1, 120);
  assert.equal(day2, 360);
  assert.equal(day1 + day2, 480); // = pm, žádné dvojité započtení
});

test("printOverlapMinutes: pauznutý blok má 0 minut v okně, kdy stroj stojí (spec regrese)", () => {
  const segs = blockReportSegments(PAUSED, SHIFTS, []);
  assert.ok(segs);
  // Sobota (celý civilní den Praha) — blok stojí v pauze:
  assert.equal(printOverlapMinutes(segs, PAUSED, pragueToUTC("2026-08-22", 0, 0), pragueToUTC("2026-08-23", 0, 0)), 0);
  // Páteční odpolední směna 14–22 Praha — tiskne se 20:00–22:00:
  assert.equal(printOverlapMinutes(segs, PAUSED, pragueToUTC("2026-08-21", 14, 0), pragueToUTC("2026-08-21", 22, 0)), 120);
  // Nedělní noční směna 22–06 Praha — tiskne se 22:00–24:00:
  assert.equal(printOverlapMinutes(segs, PAUSED, pragueToUTC("2026-08-23", 22, 0), pragueToUTC("2026-08-24", 6, 0)), 120);
});

test("printOverlapMinutes: segments=null → elapsed průnik (fallback pro ne-ZAKAZKA/legacy/drift)", () => {
  const udrzba = { startTime: "2026-08-18T06:00:00.000Z", endTime: "2026-08-18T10:00:00.000Z" };
  assert.equal(printOverlapMinutes(null, udrzba, new Date("2026-08-18T08:00:00.000Z"), new Date("2026-08-18T12:00:00.000Z")), 120);
});

test("printOverlapMinutes: okno mimo blok → 0; degenerované okno → 0", () => {
  const segs = blockReportSegments(CONT, SHIFTS, []);
  assert.equal(printOverlapMinutes(segs, CONT, new Date("2026-08-19T00:00:00.000Z"), new Date("2026-08-20T00:00:00.000Z")), 0);
  assert.equal(printOverlapMinutes(segs, CONT, new Date("2026-08-18T08:00:00.000Z"), new Date("2026-08-18T08:00:00.000Z")), 0);
});

test("printOverlapMinutes: nezarovnané okno klipuje po minutách (intervalová matematika)", () => {
  const segs = blockReportSegments(CONT, SHIFTS, []);
  assert.equal(printOverlapMinutes(segs, CONT, new Date("2026-08-18T06:15:00.000Z"), new Date("2026-08-18T06:45:00.000Z")), 30);
});

test("splitGroupTotalPrintMinutes: sčítá printMinutes ZAKAZKA členů", () => {
  const mk = (pm: number | null, start: string, end: string) => ({
    type: "ZAKAZKA", printMinutes: pm, startTime: start, endTime: end,
  });
  // 3 části: 10h + 10h + 7h tisku = 1620 min (printMinutes má přednost před elapsed)
  assert.equal(
    splitGroupTotalPrintMinutes([
      mk(600, "2026-08-18T06:00:00.000Z", "2026-08-18T16:00:00.000Z"),
      mk(600, "2026-08-18T16:00:00.000Z", "2026-08-19T02:00:00.000Z"),
      mk(420, "2026-08-19T02:00:00.000Z", "2026-08-19T09:00:00.000Z"),
    ]),
    1620
  );
});

test("splitGroupTotalPrintMinutes: fallback na elapsed u legacy členů (pm=null)", () => {
  assert.equal(
    splitGroupTotalPrintMinutes([
      { type: "ZAKAZKA", printMinutes: null, startTime: "2026-08-18T06:00:00.000Z", endTime: "2026-08-18T08:00:00.000Z" },
    ]),
    120
  );
});

test("splitGroupTotalPrintMinutes: prázdné pole → 0", () => {
  assert.equal(splitGroupTotalPrintMinutes([]), 0);
});

test("formatPrintHoursShort: celé hodiny bez desetin, jinak čárka a 1 desetinné", () => {
  assert.equal(formatPrintHoursShort(1620), "27h");
  assert.equal(formatPrintHoursShort(1650), "27,5h");
  assert.equal(formatPrintHoursShort(90), "1,5h");
  assert.equal(formatPrintHoursShort(30), "0,5h");
});
