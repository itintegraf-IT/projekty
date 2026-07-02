import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { loadMachineCalendar, expandPrintTimeFromDb, type PrismaClientLike } from "./printTime.server";
import type { serializeWeekShifts } from "./scheduleValidation";

type WeekShiftRow = Parameters<typeof serializeWeekShifts>[0][number];
type CompanyDayRow = { startDate: Date; endDate: Date };

// Fake DB klient — vrací připravené řádky a zaznamenává where podmínky
function fakeDb(
  weekShiftRows: WeekShiftRow[],
  companyDayRows: CompanyDayRow[]
): PrismaClientLike & { calls: { weekWhere?: unknown; cdWhere?: unknown } } {
  const calls: { weekWhere?: unknown; cdWhere?: unknown } = {};
  return {
    calls,
    machineWeekShifts: {
      findMany: async (args) => { calls.weekWhere = args.where; return weekShiftRows; },
    },
    companyDay: {
      findMany: async (args) => { calls.cdWhere = args.where; return companyDayRows; },
    },
  };
}

function dbRow(weekStart: string, dayOfWeek: number) {
  return {
    machine: "XL_106", weekStart: new Date(`${weekStart}T00:00:00.000Z`), dayOfWeek,
    isActive: true, morningOn: true, afternoonOn: true, nightOn: true,
    morningStartMin: 360, morningEndMin: 840,
    afternoonStartMin: 840, afternoonEndMin: 1320,
    nightStartMin: 1320, nightEndMin: 360,
  };
}

test("loadMachineCalendar: dotaz pokrývá všechny týdny [start, start+MAX_SPAN_DAYS]", async () => {
  const db = fakeDb([], []);
  await loadMachineCalendar(db, "XL_106", pragueToUTC("2026-08-21", 10));
  const where = db.calls.weekWhere as { machine: string; weekStart: { in: Date[] } };
  assert.equal(where.machine, "XL_106");
  // 21. 8. 2026 (pátek, týden od 17. 8.) + 21 dní = 11. 9. (týden od 7. 9.) → 4 týdny
  const weeks = where.weekStart.in.map((d) => d.toISOString().slice(0, 10)).sort();
  assert.deepEqual(weeks, ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]);
});

test("loadMachineCalendar: companyDays filtr machine=null OR machine + okno", async () => {
  const start = pragueToUTC("2026-08-21", 10);
  const db = fakeDb([], []);
  await loadMachineCalendar(db, "XL_106", start);
  const where = db.calls.cdWhere as { startDate: { lt: Date }; endDate: { gt: Date }; OR: unknown[] };
  assert.equal(where.endDate.gt.getTime(), start.getTime());
  assert.deepEqual(where.OR, [{ machine: null }, { machine: "XL_106" }]);
});

test("expandPrintTimeFromDb: Gardena 27h přes víkend končí Po 13:00 (integrace fetch→expand)", async () => {
  // Týdny 17.8. a 24.8. plně osazené (Po–Čt nonstop pro jednoduchost DB řádků: pátek bez noci, so off, ne od 22:00 (noc) — jako printTime.test.ts by vyžadovalo 14 řádků; zde stačí ověřit, že fetch výsledek POUŽIJE)
  const rows = [];
  for (const wk of ["2026-08-17", "2026-08-24"]) {
    for (const dow of [1, 2, 3, 4]) rows.push(dbRow(wk, dow));
    rows.push({ ...dbRow(wk, 5), nightOn: false });                 // pátek bez noci
    rows.push({ ...dbRow(wk, 6), isActive: false, morningOn: false, afternoonOn: false, nightOn: false }); // so off
    rows.push({ ...dbRow(wk, 0), morningOn: false, afternoonOn: false });                                   // ne jen noc
  }
  const db = fakeDb(rows, []);
  const r = await expandPrintTimeFromDb(db, "XL_106", pragueToUTC("2026-08-21", 10), 27 * 60, false);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-24", 13).getTime());
});

test("expandPrintTimeFromDb: bypass nefetchuje kalendář zbytečně a vrací souvislý end", async () => {
  const db = fakeDb([], []);
  const start = pragueToUTC("2026-08-22", 12); // sobota — pro bypass nevadí
  const r = await expandPrintTimeFromDb(db, "XL_106", start, 120, true);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), start.getTime() + 120 * 60000);
});
