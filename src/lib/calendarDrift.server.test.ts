import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { mkDay, xl106Week, W1, W2 } from "./weekShiftsTestFixtures";
import { detectCalendarDrift, type DriftedBlock } from "./calendarDrift.server";
import type { PrismaClientLike } from "./printTime.server";
import type { serializeWeekShifts } from "./scheduleValidation";

type WeekShiftRow = Parameters<typeof serializeWeekShifts>[0][number];
type CompanyDayRow = { startDate: Date; endDate: Date };

// Testovací blok — jen pole, které detectCalendarDrift potřebuje ze selectu.
type FakeBlockRow = {
  id: number;
  orderNumber: string;
  machine: string;
  startTime: Date;
  endTime: Date;
  type: string;
  scheduleBypassed: boolean;
  printMinutes: number | null;
  printCompletedAt: Date | null;
};

/**
 * Filtrující fake DB — simuluje reálný Prisma where na block.findMany (machine IN,
 * type, scheduleBypassed, printMinutes gt, printCompletedAt null, span overlap),
 * aby testy pinovaly SKUTEČNÝ where předaný implementací, ne jen holý výstup.
 */
function fakeCalendarDriftDb(
  blockRows: FakeBlockRow[],
  weekShiftRows: WeekShiftRow[],
  companyDayRows: CompanyDayRow[]
): PrismaClientLike & { block: { findMany: (args: unknown) => Promise<FakeBlockRow[]> } } {
  return {
    block: {
      findMany: async (args) => {
        const where = (args as {
          where: {
            machine: { in: string[] };
            type: string;
            scheduleBypassed: boolean;
            printMinutes: { gt: number };
            printCompletedAt: null;
            startTime: { lt: Date };
            endTime: { gt: Date };
          };
        }).where;
        return blockRows.filter(
          (b) =>
            where.machine.in.includes(b.machine) &&
            b.type === where.type &&
            b.scheduleBypassed === where.scheduleBypassed &&
            b.printMinutes !== null &&
            b.printMinutes > where.printMinutes.gt &&
            b.printCompletedAt === where.printCompletedAt &&
            b.startTime.getTime() < where.startTime.lt.getTime() &&
            b.endTime.getTime() > where.endTime.gt.getTime()
        );
      },
    },
    machineWeekShifts: {
      findMany: async (args) => {
        const where = args.where as { machine: string; weekStart: { in: Date[] } };
        const wanted = new Set(
          where.weekStart.in.map((d) => d.toISOString().slice(0, 10))
        );
        return weekShiftRows.filter(
          (r) => r.machine === where.machine && wanted.has(new Date(r.weekStart).toISOString().slice(0, 10))
        );
      },
    },
    companyDay: {
      findMany: async (args) => {
        const where = args.where as { startDate: { lt: Date }; endDate: { gt: Date } };
        return companyDayRows.filter(
          (c) => c.startDate.getTime() < where.startDate.lt.getTime() && c.endDate.getTime() > where.endDate.gt.getTime()
        );
      },
    },
  };
}

function mkBlock(overrides: Partial<FakeBlockRow> & Pick<FakeBlockRow, "id" | "startTime" | "endTime">): FakeBlockRow {
  return {
    orderNumber: `Z-${overrides.id}`,
    machine: "XL_106",
    type: "ZAKAZKA",
    scheduleBypassed: false,
    printMinutes: 120,
    printCompletedAt: null,
    ...overrides,
  };
}

// Společné okno pro všechny testy: windowStart PŘED testovacími bloky (17.8.),
// now UVNITŘ okna PO windowStart. Test 6 ověřuje skutečně "now" větev filtru přes
// vlastní lokální `now` (viz níže) — nemůže sdílet tuto konstantu, protože jeho blok
// leží na jediném dostupném rozbitém místě (17.8.), které je PO tomto sdíleném now.
const windowStart = pragueToUTC("2026-08-10", 0);
const windowEnd = pragueToUTC("2026-08-31", 0);
const now = pragueToUTC("2026-08-15", 0);

test("detectCalendarDrift: blok sedící na kalendář → []", async () => {
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const start = pragueToUTC("2026-08-17", 8); // Po, nonstop
  const block = mkBlock({ id: 1, startTime: start, endTime: pragueToUTC("2026-08-17", 10), printMinutes: 120 });
  const db = fakeCalendarDriftDb([block], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.deepEqual(result, []);
});

test("detectCalendarDrift: pondělí bez rána v novém rozvrhu → START_NOT_RUNNABLE", async () => {
  function noMorningMondayWeek(weekStart: string) {
    return [
      mkDay(weekStart, 1, { m: false, a: true, n: true }), // po BEZ rána (dřív bylo m:true)
      mkDay(weekStart, 2, { m: true, a: true, n: true }),
      mkDay(weekStart, 3, { m: true, a: true, n: true }),
      mkDay(weekStart, 4, { m: true, a: true, n: true }),
      mkDay(weekStart, 5, { m: true, a: true }),
      mkDay(weekStart, 6, { active: false }),
      mkDay(weekStart, 0, { n: true }),
    ];
  }
  const weekShifts = [...noMorningMondayWeek(W1), ...noMorningMondayWeek(W2)];
  const start = pragueToUTC("2026-08-17", 6); // Po 6:00 — uložený blok počítal se starým rozvrhem (ráno bývalo ON)
  const block = mkBlock({ id: 2, startTime: start, endTime: pragueToUTC("2026-08-17", 10), printMinutes: 240 });
  const db = fakeCalendarDriftDb([block], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 2);
  assert.equal(result[0].reason, "START_NOT_RUNNABLE");
  assert.equal(result[0].expectedEnd, null);
});

test("detectCalendarDrift: end spočítaný bez odstávky + nová companyDay uvnitř → END_MISMATCH s posunutým expectedEnd", async () => {
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const start = pragueToUTC("2026-08-17", 8); // Po 8:00, pm=240 → naivní (uložený) end 12:00
  const storedEnd = pragueToUTC("2026-08-17", 12);
  const block = mkBlock({ id: 3, startTime: start, endTime: storedEnd, printMinutes: 240 });
  // Nová odstávka 30 min uvnitř bloku (9:00–9:30) — přidaná PO uložení bloku.
  const cd: CompanyDayRow = { startDate: pragueToUTC("2026-08-17", 9), endDate: pragueToUTC("2026-08-17", 9, 30) };
  const db = fakeCalendarDriftDb([block], weekShifts, [cd]);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 3);
  assert.equal(result[0].reason, "END_MISMATCH");
  assert.equal(result[0].expectedEnd?.getTime(), pragueToUTC("2026-08-17", 12, 30).getTime());
});

function noMorningMondayWeek(weekStart: string) {
  return [
    mkDay(weekStart, 1, { m: false, a: true, n: true }), // po BEZ rána (dřív bylo m:true)
    mkDay(weekStart, 2, { m: true, a: true, n: true }),
    mkDay(weekStart, 3, { m: true, a: true, n: true }),
    mkDay(weekStart, 4, { m: true, a: true, n: true }),
    mkDay(weekStart, 5, { m: true, a: true }),
    mkDay(weekStart, 6, { active: false }),
    mkDay(weekStart, 0, { n: true }),
  ];
}

test("detectCalendarDrift: vytištěný blok (printCompletedAt set) na rozbitém místě → [] (where filtr)", async () => {
  // Stejné rozbité místo jako START_NOT_RUNNABLE test (noMorningMondayWeek, Po 6:00) —
  // bez WHERE filtru printCompletedAt: null by expanze spadla na START_NOT_RUNNABLE a
  // test by NEBYL vacuous vůči []. Filtr musí blok vyřadit dřív, než se vůbec expanduje.
  const weekShifts = [...noMorningMondayWeek(W1), ...noMorningMondayWeek(W2)];
  const start = pragueToUTC("2026-08-17", 6);
  const block = mkBlock({
    id: 4,
    startTime: start,
    endTime: pragueToUTC("2026-08-17", 10),
    printMinutes: 240,
    printCompletedAt: pragueToUTC("2026-08-17", 10, 5),
  });
  const db = fakeCalendarDriftDb([block], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.deepEqual(result, []);
});

test("detectCalendarDrift: bypass blok → [] (where filtr)", async () => {
  // Stejné rozbité místo (noMorningMondayWeek, Po 6:00), bypass = mimo kalendář vědomě —
  // bez WHERE filtru scheduleBypassed: false by expanze spadla na START_NOT_RUNNABLE.
  const weekShifts = [...noMorningMondayWeek(W1), ...noMorningMondayWeek(W2)];
  const start = pragueToUTC("2026-08-17", 6);
  const block = mkBlock({
    id: 5,
    startTime: start,
    endTime: pragueToUTC("2026-08-17", 10),
    printMinutes: 240,
    scheduleBypassed: true,
  });
  const db = fakeCalendarDriftDb([block], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.deepEqual(result, []);
});

test("detectCalendarDrift: blok s endTime < now → [] (where filtr aktuálnosti)", async () => {
  // Rozbité místo (noMorningMondayWeek, Po 6:00) — bez WHERE filtru endTime.gt(now) by
  // expanze spadla na START_NOT_RUNNABLE. Lokální `now` (18.8.) je schválně PO endTime
  // bloku (17.8. 10:00), aby filtr aktuálnosti měl co vyřadit; windowStart/windowEnd
  // zůstávají sdílené — filtr musí použít max(windowStart, now) = now, protože now > windowStart.
  const weekShifts = [...noMorningMondayWeek(W1), ...noMorningMondayWeek(W2)];
  const start = pragueToUTC("2026-08-17", 6);
  const block = mkBlock({ id: 6, startTime: start, endTime: pragueToUTC("2026-08-17", 10), printMinutes: 240 });
  const db = fakeCalendarDriftDb([block], weekShifts, []);
  const localNow = pragueToUTC("2026-08-18", 0);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, localNow);
  assert.deepEqual(result, []);
});

test("detectCalendarDrift: žádné bloky → [] bez fetche kalendáře", async () => {
  let weekShiftsFetched = false;
  const db: PrismaClientLike & { block: { findMany: (args: unknown) => Promise<FakeBlockRow[]> } } = {
    block: { findMany: async () => [] },
    machineWeekShifts: {
      findMany: async () => {
        weekShiftsFetched = true;
        return [];
      },
    },
    companyDay: { findMany: async () => [] },
  };
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.deepEqual(result, []);
  assert.equal(weekShiftsFetched, false, "kalendář se nesmí fetchovat, když nejsou žádné bloky");
});

test("detectCalendarDrift: výsledek je seřazen podle startTime vzestupně", async () => {
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  function noMorningMondayWeek(weekStart: string) {
    return [
      mkDay(weekStart, 1, { m: false, a: true, n: true }),
      mkDay(weekStart, 2, { m: false, a: true, n: true }),
      mkDay(weekStart, 3, { m: true, a: true, n: true }),
      mkDay(weekStart, 4, { m: true, a: true, n: true }),
      mkDay(weekStart, 5, { m: true, a: true }),
      mkDay(weekStart, 6, { active: false }),
      mkDay(weekStart, 0, { n: true }),
    ];
  }
  const brokenWeekShifts = [...noMorningMondayWeek(W1), ...noMorningMondayWeek(W2)];
  // Dva rozbité bloky (START_NOT_RUNNABLE), druhý dřív než první ve vstupním poli.
  const later = mkBlock({ id: 10, startTime: pragueToUTC("2026-08-18", 6), endTime: pragueToUTC("2026-08-18", 10), printMinutes: 240 });
  const earlier = mkBlock({ id: 11, startTime: pragueToUTC("2026-08-17", 6), endTime: pragueToUTC("2026-08-17", 10), printMinutes: 240 });
  const db = fakeCalendarDriftDb([later, earlier], brokenWeekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r: DriftedBlock) => r.id), [11, 10]);
});
