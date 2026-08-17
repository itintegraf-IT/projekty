import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { validateAndComputeEnd, shouldRecomputeSchedule, type ScheduleRelevantBlock } from "./scheduleValidationServer";
import type { PrismaClientLike } from "./printTime.server";

function dbRow(weekStart: string, dayOfWeek: number, over: Record<string, unknown> = {}) {
  return {
    machine: "XL_106", weekStart: new Date(`${weekStart}T00:00:00.000Z`), dayOfWeek,
    isActive: true, morningOn: true, afternoonOn: true, nightOn: true,
    morningStartMin: 360, morningEndMin: 840,
    afternoonStartMin: 840, afternoonEndMin: 1320,
    nightStartMin: 1320, nightEndMin: 360,
    ...over,
  };
}
function xl106DbWeek(weekStart: string) {
  return [
    dbRow(weekStart, 1), dbRow(weekStart, 2), dbRow(weekStart, 3), dbRow(weekStart, 4),
    dbRow(weekStart, 5, { nightOn: false }),
    dbRow(weekStart, 6, { isActive: false, morningOn: false, afternoonOn: false, nightOn: false }),
    dbRow(weekStart, 0, { morningOn: false, afternoonOn: false }),
  ];
}
function fakeDb(weekShiftRows: unknown[], companyDayRows: { startDate: Date; endDate: Date }[] = []) {
  return {
    machineWeekShifts: { findMany: async () => weekShiftRows },
    companyDay: { findMany: async () => companyDayRows },
  } as PrismaClientLike;
}
const FULL_CAL = fakeDb([...xl106DbWeek("2026-08-17"), ...xl106DbWeek("2026-08-24"),
  ...xl106DbWeek("2026-08-31"), ...xl106DbWeek("2026-09-07")]);

test("ZAKAZKA: validní start + 27h → ok s pauznutým endem (Po 13:00)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), 27 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.deepEqual(r, { ok: true, end: pragueToUTC("2026-08-24", 13), effectivelyBypassed: false });
});

test("ZAKAZKA: start v odstávce → chyba (kind PLACEMENT)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-22", 12), 4 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /mimo provoz/);
  assert.equal(r.kind, "PLACEMENT");
});

test("ZAKAZKA: printMinutes chybí (null) → chyba (kind INVALID_INPUT)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), null,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "INVALID_INPUT");
});

test("ZAKAZKA: printMinutes > 2400 → chyba (limit 40 h, kind INVALID_INPUT)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), 2430,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /40/);
  assert.equal(r.kind, "INVALID_INPUT");
});

test("ZAKAZKA: printMinutes není násobek 30 → chyba (kind INVALID_INPUT)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), 45,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "INVALID_INPUT");
});

test("ZAKAZKA: nezarovnaný start → chyba (ne crash, kind INVALID_INPUT)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10, 15), 60,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "INVALID_INPUT");
});

test("bypass: end = start + printMinutes, mimo kalendář → effectivelyBypassed true", async () => {
  const start = pragueToUTC("2026-08-22", 12); // sobota
  const r = await validateAndComputeEnd(fakeDb([]), "XL_106", start, 120, new Date(0), "ZAKAZKA", true);
  assert.deepEqual(r, { ok: true, end: new Date(start.getTime() + 120 * 60000), effectivelyBypassed: true });
});

test("bypass request na konformním místě → effectivelyBypassed false (spočítaná pravda)", async () => {
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00 — plný provoz
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", start, 120, new Date(0), "ZAKAZKA", true);
  assert.deepEqual(r, { ok: true, end: new Date(start.getTime() + 120 * 60000), effectivelyBypassed: false });
});

test("bypass: CompanyDay zůstává tvrdý zákaz (kind PLACEMENT)", async () => {
  const start = pragueToUTC("2026-08-19", 10);
  const db = fakeDb([], [{ startDate: pragueToUTC("2026-08-19", 0), endDate: pragueToUTC("2026-08-20", 0) }]);
  const r = await validateAndComputeEnd(db, "XL_106", start, 120, new Date(0), "ZAKAZKA", true);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /odstávky/);
  assert.equal(r.kind, "PLACEMENT");
});

test("non-bypass: CompanyDay uvnitř pauzy NEvadí (blok ji překlene)", async () => {
  // odstávka celá středa; blok út 18:00 + 12h → pauza přes středu, end čt 06:00
  const db = fakeDb(
    [...xl106DbWeek("2026-08-17"), ...xl106DbWeek("2026-08-24"), ...xl106DbWeek("2026-08-31"), ...xl106DbWeek("2026-09-07")],
    [{ startDate: pragueToUTC("2026-08-19", 0), endDate: pragueToUTC("2026-08-20", 0) }]
  );
  const r = await validateAndComputeEnd(db, "XL_106", pragueToUTC("2026-08-18", 18), 12 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.deepEqual(r, { ok: true, end: pragueToUTC("2026-08-20", 6), effectivelyBypassed: false });
});

test("HORIZON_EXCEEDED → srozumitelná chyba (kind PLACEMENT)", async () => {
  const off = (wk: string) => [0, 1, 2, 3, 4, 5, 6].map((d) =>
    dbRow(wk, d, { isActive: false, morningOn: false, afternoonOn: false, nightOn: false }));
  const db = fakeDb([...xl106DbWeek("2026-08-17"), ...off("2026-08-24"), ...off("2026-08-31"), ...off("2026-09-07"), ...off("2026-09-14")]);
  const r = await validateAndComputeEnd(db, "XL_106", pragueToUTC("2026-08-21", 10), 40 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /dost pracovní doby/);
  assert.equal(r.kind, "PLACEMENT");
});

test("UDRZBA: bez validace, end = fallbackEnd", async () => {
  const fb = pragueToUTC("2026-08-23", 15); // neděle — pro údržbu OK
  const r = await validateAndComputeEnd(fakeDb([]), "XL_106", pragueToUTC("2026-08-23", 12), null, fb, "UDRZBA", false);
  assert.deepEqual(r, { ok: true, end: fb, effectivelyBypassed: false });
});

// ── shouldRecomputeSchedule ────────────────────────────────────────────────
// Rozhoduje, jestli PUT vůbec sáhne na harmonogram. Jádro etapy 3 oprav po
// incidentu 18827: uložení, které se harmonogramu netýká, s ním nesmí hnout.

const OLD_START = pragueToUTC("2026-08-19", 6);
const OLD_END = pragueToUTC("2026-08-19", 12);
function oldBlock(over: Partial<ScheduleRelevantBlock> = {}): ScheduleRelevantBlock {
  return {
    type: "ZAKAZKA",
    machine: "XL_106",
    startTime: OLD_START,
    endTime: OLD_END,
    printMinutes: 360,
    ...over,
  };
}

const RECOMPUTE_CASES: { name: string; request: Record<string, unknown>; expected: boolean; old?: Partial<ScheduleRelevantBlock> }[] = [
  {
    // JÁDRO ETAPY: přesně to uložení, které 14. 8. 2026 odsunulo 75 zakázek —
    // textová pole + `type` shodný s uloženým, délka v payloadu VŮBEC není.
    name: "incident 18827: čistě textová editace (popis/specifikace/archy) → nepřepočítávat",
    request: {
      description: "nový popis",
      specifikace: "4/4 CMYK",
      tiskoveArchy: "A|B",
      type: "ZAKAZKA",
    },
    expected: false,
  },
  { name: "type v requestu, shodný s uloženým → false", request: { type: "ZAKAZKA" }, expected: false },
  { name: "type se mění REZERVACE → ZAKAZKA → true", request: { type: "ZAKAZKA" }, old: { type: "REZERVACE" }, expected: true },
  { name: "type se mění ZAKAZKA → UDRZBA → true", request: { type: "UDRZBA" }, expected: true },
  { name: "jiný stroj → true", request: { machine: "XL_105" }, expected: true },
  { name: "stejný stroj v requestu → false", request: { machine: "XL_106" }, expected: false },
  { name: "jiný startTime → true", request: { startTime: pragueToUTC("2026-08-19", 8).toISOString() }, expected: true },
  { name: "týž startTime jako ISO string téhož okamžiku → false", request: { startTime: OLD_START.toISOString() }, expected: false },
  { name: "jiný endTime → true", request: { endTime: pragueToUTC("2026-08-19", 14).toISOString() }, expected: true },
  { name: "týž endTime → false", request: { endTime: OLD_END.toISOString() }, expected: false },
  { name: "printMinutes shodné s uloženým → false", request: { printMinutes: 360 }, expected: false },
  { name: "printMinutes jiné → true", request: { printMinutes: 120 }, expected: true },
  { name: "legacy blok bez printMinutes + číslo v requestu → true", request: { printMinutes: 120 }, old: { printMinutes: null }, expected: true },
  { name: "nečitelný startTime („nesmysl\") → true, ať vadný vstup doteče do validace", request: { startTime: "nesmysl" }, expected: true },
  { name: "prázdný request → false", request: {}, expected: false },
];

for (const c of RECOMPUTE_CASES) {
  test(`shouldRecomputeSchedule: ${c.name}`, () => {
    assert.equal(shouldRecomputeSchedule(oldBlock(c.old), c.request), c.expected);
  });
}
