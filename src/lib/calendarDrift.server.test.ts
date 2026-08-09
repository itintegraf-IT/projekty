import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { mkDay, xl106Week, W1, W2 } from "./weekShiftsTestFixtures";
import { detectCalendarDrift, notifyCalendarDrift, type DriftedBlock } from "./calendarDrift.server";
import { blockCalendarDrift } from "./printTimeClient";
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
 * type, printMinutes gt, printCompletedAt null, span overlap), aby testy pinovaly
 * SKUTEČNÝ where předaný implementací, ne jen holý výstup.
 *
 * Dvě věci, na kterých testy stojí a které nesmí zmizet:
 * 1. `scheduleBypassed` se filtruje JEN když ho where obsahuje — kdyby ho implementace
 *    vrátila zpátky, odložené bloky by fake vyřadil a testy STALE_BYPASS by padly.
 * 2. Výsledek se PROMÍTÁ podle `select` — kdyby implementace zapomněla `scheduleBypassed`
 *    do selectu přidat, byla by na produkci `undefined` (falsy) a klasifikace by tiše
 *    nikdy nefungovala; bez projekce by test tuhle vadu neodhalil.
 */
function fakeCalendarDriftDb(
  blockRows: FakeBlockRow[],
  weekShiftRows: WeekShiftRow[],
  companyDayRows: CompanyDayRow[]
): PrismaClientLike & { block: { findMany: (args: unknown) => Promise<FakeBlockRow[]> } } {
  return {
    block: {
      findMany: async (args) => {
        const { where, select } = args as {
          where: {
            machine: { in: string[] };
            type: string;
            scheduleBypassed?: boolean;
            printMinutes: { gt: number };
            printCompletedAt: null;
            startTime: { lt: Date };
            endTime: { gt: Date };
          };
          select: Record<string, boolean>;
        };
        const matched = blockRows.filter(
          (b) =>
            where.machine.in.includes(b.machine) &&
            b.type === where.type &&
            (where.scheduleBypassed === undefined || b.scheduleBypassed === where.scheduleBypassed) &&
            b.printMinutes !== null &&
            b.printMinutes > where.printMinutes.gt &&
            b.printCompletedAt === where.printCompletedAt &&
            b.startTime.getTime() < where.startTime.lt.getTime() &&
            b.endTime.getTime() > where.endTime.gt.getTime()
        );
        // Projekce podle selectu — vrací jen vyžádané sloupce, jako skutečná Prisma.
        return matched.map(
          (b) =>
            Object.fromEntries(
              Object.keys(select).map((k) => [k, (b as unknown as Record<string, unknown>)[k]])
            ) as FakeBlockRow
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

test("detectCalendarDrift: odložený blok na nespustitelném startu → START_NOT_RUNNABLE", async () => {
  // Do 8/2026 byl takový blok z kontroly vyřazen WHERE filtrem `scheduleBypassed: false`
  // a plánovač o něm nevěděl. Nově se posuzuje jako každý jiný.
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
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 5);
  assert.equal(result[0].reason, "START_NOT_RUNNABLE");
});

test("detectCalendarDrift: odložený blok přes víkendovou odstávku → END_MISMATCH", async () => {
  // Přesně to, co dělá zámek: zakázka položená na pátek 20:00 s tiskem 4 h se uloží
  // slitě do soboty 0:00, přestože stroj v 22:00 stojí až do neděle 22:00.
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const block = mkBlock({
    id: 7,
    startTime: pragueToUTC("2026-08-21", 20), // pátek
    endTime: pragueToUTC("2026-08-22", 0), // uložený konec: slitě, bez odstávky
    printMinutes: 240,
    scheduleBypassed: true,
  });
  const db = fakeCalendarDriftDb([block], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].reason, "END_MISMATCH");
  // Pá 20–22 = 2 h, pak odstávka do Ne 22:00, zbylé 2 h → Po 0:00.
  assert.equal(result[0].expectedEnd?.getTime(), pragueToUTC("2026-08-24", 0).getTime());
});

test("detectCalendarDrift: odložený blok, jehož rozpětí kalendáři ODPOVÍDÁ → STALE_BYPASS", async () => {
  // Případ zakázky 18447: značka zbyla po havárii, geometrie je v pořádku.
  // Není co posouvat — jen zrušit značku, proto expectedEnd null.
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const block = mkBlock({
    id: 8,
    startTime: pragueToUTC("2026-08-17", 8), // Po, nonstop
    endTime: pragueToUTC("2026-08-17", 10),
    printMinutes: 120,
    scheduleBypassed: true,
  });
  const db = fakeCalendarDriftDb([block], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 8);
  assert.equal(result[0].reason, "STALE_BYPASS");
  assert.equal(result[0].expectedEnd, null);
});

test("detectCalendarDrift: STALE_BYPASS je vázaný na značku, ne na geometrii", async () => {
  // MUTAČNÍ POJISTKA: kdyby se STALE_BYPASS hlásil podle shody konců bez ohledu na
  // `scheduleBypassed`, naskočil by u KAŽDÉHO zdravého bloku v plánu. Dva bloky se
  // shodnou geometrií, liší se jen značkou — projít smí právě jeden.
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const parked = mkBlock({
    id: 20,
    startTime: pragueToUTC("2026-08-17", 8),
    endTime: pragueToUTC("2026-08-17", 10),
    printMinutes: 120,
    scheduleBypassed: true,
  });
  const healthy = mkBlock({
    id: 21,
    startTime: pragueToUTC("2026-08-18", 8),
    endTime: pragueToUTC("2026-08-18", 10),
    printMinutes: 120,
    scheduleBypassed: false,
  });
  const db = fakeCalendarDriftDb([parked, healthy], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(result.length, 1, "zdravý blok se stejnou geometrií se hlásit nesmí");
  assert.equal(result[0].id, 20);
  assert.equal(result[0].reason, "STALE_BYPASS");
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

test("parita klient ↔ server: tytéž vstupy, tatáž klasifikace", async () => {
  // Server notifikuje a plní pruh „Přepočítat", klient kreslí štítek na kartě.
  // Kdyby se klasifikace rozešly, štítek na zakázce by tvrdil něco jiného než
  // pruh nad strojem. Proto jedna tabulka vstupů proháněná OBĚMA implementacemi.
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const cases: Array<{ name: string; row: FakeBlockRow; expected: DriftedBlock["reason"] | null }> = [
    {
      name: "odložený přes víkendovou odstávku",
      row: mkBlock({ id: 31, startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0), printMinutes: 240, scheduleBypassed: true }),
      expected: "END_MISMATCH",
    },
    {
      name: "odložený se startem v odstávce",
      row: mkBlock({ id: 32, startTime: pragueToUTC("2026-08-22", 10), endTime: pragueToUTC("2026-08-22", 14), printMinutes: 240, scheduleBypassed: true }),
      expected: "START_NOT_RUNNABLE",
    },
    {
      name: "odložený, geometrie sedí",
      row: mkBlock({ id: 33, startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12), printMinutes: 240, scheduleBypassed: true }),
      expected: "STALE_BYPASS",
    },
    {
      name: "neoznačený, geometrie sedí",
      row: mkBlock({ id: 34, startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12), printMinutes: 240 }),
      expected: null,
    },
    {
      name: "neoznačený driftující",
      row: mkBlock({ id: 35, startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0), printMinutes: 240 }),
      expected: "END_MISMATCH",
    },
  ];

  for (const c of cases) {
    const db = fakeCalendarDriftDb([c.row], weekShifts, []);
    const server = (await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now))[0]?.reason ?? null;
    const client = blockCalendarDrift(c.row, weekShifts, [], now)?.reason ?? null;
    assert.equal(server, c.expected, `server: ${c.name}`);
    assert.equal(client, c.expected, `klient: ${c.name}`);
  }
});

// ── notifyCalendarDrift ──────────────────────────────────────────────────────

function mkDrifted(overrides: Partial<DriftedBlock> & Pick<DriftedBlock, "id" | "reason">): DriftedBlock {
  return {
    orderNumber: `Z-${overrides.id}`,
    machine: "XL_106",
    startTime: pragueToUTC("2026-08-17", 8),
    endTime: pragueToUTC("2026-08-17", 10),
    expectedEnd: null,
    ...overrides,
  };
}

function fakeNotifyDb() {
  const created: Array<{ type: string; targetRole: string; message: string }> = [];
  return {
    created,
    db: {
      notification: {
        createMany: async (args: { data: Array<{ type: string; targetRole: string; message: string; createdByUserId: number; createdByUsername: string }> }) => {
          created.push(...args.data);
          return {};
        },
      },
    },
  };
}

const notifyActor = { id: 1, username: "planovac" };

test("notifyCalendarDrift: zbytkové značky se do hlášky nepočítají", async () => {
  // Notifikace tvrdí „nesedí na kalendář" — u STALE_BYPASS by to byla lež: geometrie
  // sedí, zbyla jen značka. Plánovač ji vidí jako štítek na kartě, ne jako poplach
  // z každé úpravy směn.
  const { created, db } = fakeNotifyDb();
  await notifyCalendarDrift(
    db,
    [mkDrifted({ id: 1, reason: "END_MISMATCH" }), mkDrifted({ id: 2, reason: "STALE_BYPASS" })],
    notifyActor,
    "Změna směn"
  );
  assert.equal(created.length, 2, "dvě role, jedna hláška");
  assert.match(created[0].message, /1 blok nesedí na kalendář \(Z-1\)/);
});

test("notifyCalendarDrift: samé zbytkové značky → žádná notifikace", async () => {
  const { created, db } = fakeNotifyDb();
  await notifyCalendarDrift(db, [mkDrifted({ id: 2, reason: "STALE_BYPASS" })], notifyActor, "Změna směn");
  assert.deepEqual(created, []);
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
