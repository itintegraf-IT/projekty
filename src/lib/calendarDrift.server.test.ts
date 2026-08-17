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
  description: string | null;
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
    description: null,
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
  const block = mkBlock({ id: 3, startTime: start, endTime: storedEnd, printMinutes: 240, description: "Katalog jaro" });
  // Nová odstávka 30 min uvnitř bloku (9:00–9:30) — přidaná PO uložení bloku.
  const cd: CompanyDayRow = { startDate: pragueToUTC("2026-08-17", 9), endDate: pragueToUTC("2026-08-17", 9, 30) };
  const db = fakeCalendarDriftDb([block], weekShifts, [cd]);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 3);
  assert.equal(result[0].reason, "END_MISMATCH");
  assert.equal(result[0].expectedEnd?.getTime(), pragueToUTC("2026-08-17", 12, 30).getTime());
  assert.equal(result[0].description, "Katalog jaro", "description se propíše ze selectu do DriftedBlock");
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

test("detectCalendarDrift: odložené bloky jsou z detekce vyřazené, i když by geometricky driftovaly", async () => {
  // ZÁMĚR, ne opomenutí (rozhodnuto 9. 8. 2026). Příznak `scheduleBypassed` nastavuje
  // server právě tehdy, když geometrie kalendáři nevyhovuje — odložená zakázka je tedy
  // z definice nekonformní. Bez tohohle filtru by každé vědomé odložení trvale svítilo
  // jako „nesedí na kalendář": notifikace z každé úpravy směn, nikdy nenulový provozní
  // report a hromadné „Přepočítat" by ji nevratně vystěhovalo do pracovní doby.
  // Plánovači ji ukazuje štítek na kartě (klientský blockCalendarDrift) — viz test parity.
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const parkedOverWeekend = mkBlock({
    id: 5,
    startTime: pragueToUTC("2026-08-21", 20), // pátek 20:00, tisk 4 h uložený slitě do So 0:00
    endTime: pragueToUTC("2026-08-22", 0),
    printMinutes: 240,
    scheduleBypassed: true,
  });
  const parkedInShutdown = mkBlock({
    id: 6,
    startTime: pragueToUTC("2026-08-22", 10), // sobota = celá odstávka
    endTime: pragueToUTC("2026-08-22", 14),
    printMinutes: 240,
    scheduleBypassed: true,
  });
  const staleFlag = mkBlock({
    id: 7,
    startTime: pragueToUTC("2026-08-17", 8), // Po nonstop — geometrie kalendáři odpovídá (případ 18447)
    endTime: pragueToUTC("2026-08-17", 10),
    printMinutes: 120,
    scheduleBypassed: true,
  });
  const db = fakeCalendarDriftDb([parkedOverWeekend, parkedInShutdown, staleFlag], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.deepEqual(result, []);
});

test("detectCalendarDrift: nezarovnaný start se vyřadí PŘED expanzí, ostatní bloky se posoudí", async () => {
  // POZOR na to, co tenhle test hlídá: pre-filtr zarovnání (ř. `% SLOT_MS === 0`),
  // NE `try/catch` kolem expanze. Blok s nezarovnaným startem se k `expandPrintTime`
  // vůbec nedostane, takže by test prošel i bez té pojistky — ověřeno mutací.
  // `try/catch` je obrana do budoucna (kdyby některý guard povolil), ne oprava
  // dosažitelné chyby; kdo ho bude chtít otestovat, musí `expandPrintTime` podstrčit.
  //
  // Legacy bloky s nezarovnaným startem v datech existují (undo zapisuje doslova
  // ze snapshotu, bez mřížkové validace).
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const unaligned = mkBlock({
    id: 8,
    startTime: pragueToUTC("2026-08-17", 8, 10), // 8:10 — mimo 30min mřížku
    endTime: pragueToUTC("2026-08-17", 12),
    printMinutes: 240,
  });
  const healthyDrift = mkBlock({
    id: 9,
    startTime: pragueToUTC("2026-08-21", 20),
    endTime: pragueToUTC("2026-08-22", 0), // uložený konec bez víkendové odstávky → drift
    printMinutes: 240,
  });
  const db = fakeCalendarDriftDb([unaligned, healthyDrift], weekShifts, []);
  const result = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
  assert.deepEqual(result.map((r) => r.id), [9], "vadný blok se přeskočí, ostatní se posoudí");
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

test("parita klient ↔ server: u NEODLOŽENÝCH bloků musí obě strany klasifikovat stejně", async () => {
  // Server plní notifikace, provozní report a pruh „Přepočítat"; klient kreslí štítek
  // na kartě. U běžné zakázky se rozejít nesmí — jinak štítek tvrdí něco jiného než
  // pruh nad strojem. Tabulka schválně obsahuje i vstupy, které si KAŽDÁ STRANA POČÍTÁ
  // SAMA (odstávky, zarovnání startu) — na sdíleném `expandPrintTime` by se parita
  // ověřovala sama sebou.
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const cdInsideBlock: CompanyDayRow = {
    startDate: pragueToUTC("2026-08-18", 9),
    endDate: pragueToUTC("2026-08-18", 9, 30),
  };
  const cases: Array<{
    name: string;
    row: FakeBlockRow;
    companyDays?: CompanyDayRow[];
    expected: DriftedBlock["reason"] | null;
  }> = [
    {
      name: "geometrie sedí",
      row: mkBlock({ id: 34, startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12), printMinutes: 240 }),
      expected: null,
    },
    {
      name: "konec nesedí (víkendová odstávka v rozvrhu)",
      row: mkBlock({ id: 35, startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0), printMinutes: 240 }),
      expected: "END_MISMATCH",
    },
    {
      name: "start mimo provoz stroje",
      row: mkBlock({ id: 36, startTime: pragueToUTC("2026-08-22", 10), endTime: pragueToUTC("2026-08-22", 14), printMinutes: 240 }),
      expected: "START_NOT_RUNNABLE",
    },
    {
      // Firemní odstávku si obě strany načítají vlastní cestou (server SQL, klient
      // `companyDayIntervalsFor`), takže se na ní můžou rozejít — a bez tohohle řádku
      // by parita běžela jen přes sdílené jádro `expandPrintTime`, tedy ověřovala
      // sama sebe. Pokrývá GLOBÁLNÍ odstávku; strojově zacílená (`machine`) tady
      // otestovaná NENÍ, protože ji fake `companyDay.findMany` nemodeluje.
      name: "firemní odstávka uvnitř bloku",
      row: mkBlock({ id: 37, startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12), printMinutes: 240 }),
      companyDays: [cdInsideBlock],
      expected: "END_MISMATCH",
    },
    {
      // Zarovnání startu hlídá server post-query filtrem, klient guardem v tryExpandForBlock —
      // dvě různá místa, tentýž závěr „nelze posoudit".
      name: "nezarovnaný start (legacy blok)",
      row: mkBlock({ id: 38, startTime: pragueToUTC("2026-08-18", 8, 10), endTime: pragueToUTC("2026-08-18", 12), printMinutes: 240 }),
      expected: null,
    },
    {
      name: "vytištěný blok na rozbitém místě",
      row: mkBlock({
        id: 39,
        startTime: pragueToUTC("2026-08-22", 10),
        endTime: pragueToUTC("2026-08-22", 14),
        printMinutes: 240,
        printCompletedAt: pragueToUTC("2026-08-22", 14),
      }),
      expected: null,
    },
  ];

  for (const c of cases) {
    const db = fakeCalendarDriftDb([c.row], weekShifts, c.companyDays ?? []);
    const server = (await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now))[0]?.reason ?? null;
    const clientCompanyDays = (c.companyDays ?? []).map((cd) => ({ startDate: cd.startDate, endDate: cd.endDate }));
    const client = blockCalendarDrift(c.row, weekShifts, clientCompanyDays, now)?.reason ?? null;
    assert.equal(server, c.expected, `server: ${c.name}`);
    assert.equal(client, c.expected, `klient: ${c.name}`);
  }
});

test("rozsah se u ODLOŽENÝCH bloků liší ZÁMĚRNĚ: server mlčí, klient dá štítek", async () => {
  // Vědomé odložení není porucha, takže nepatří do souhrnných kanálů (notifikace,
  // provozní report, hromadné „Přepočítat") — ty pohání server. Patří na kartu té jedné
  // zakázky, a tu kreslí klient. Důvody jsou proto oddělené: PARKED a STALE_BYPASS
  // na serveru NIKDY nevzniknou. Kdyby tenhle test padl, znamená to, že se jedna
  // ze stran vydala do rozsahu té druhé.
  const weekShifts = [...xl106Week(W1), ...xl106Week(W2)];
  const cases: Array<{ name: string; row: FakeBlockRow; clientReason: string }> = [
    {
      name: "odložený přes víkendovou odstávku",
      row: mkBlock({ id: 41, startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0), printMinutes: 240, scheduleBypassed: true }),
      clientReason: "PARKED",
    },
    {
      name: "odložený se startem v odstávce",
      row: mkBlock({ id: 42, startTime: pragueToUTC("2026-08-22", 10), endTime: pragueToUTC("2026-08-22", 14), printMinutes: 240, scheduleBypassed: true }),
      clientReason: "PARKED",
    },
    {
      name: "zbytková značka (případ 18447)",
      row: mkBlock({ id: 43, startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12), printMinutes: 240, scheduleBypassed: true }),
      clientReason: "STALE_BYPASS",
    },
  ];

  for (const c of cases) {
    const db = fakeCalendarDriftDb([c.row], weekShifts, []);
    const server = await detectCalendarDrift(db, ["XL_106"], windowStart, windowEnd, now);
    assert.deepEqual(server, [], `server: ${c.name}`);
    assert.equal(blockCalendarDrift(c.row, weekShifts, [], now)?.reason, c.clientReason, `klient: ${c.name}`);
  }
});

// ── notifyCalendarDrift ──────────────────────────────────────────────────────

function mkDrifted(overrides: Partial<DriftedBlock> & Pick<DriftedBlock, "id" | "reason">): DriftedBlock {
  return {
    orderNumber: `Z-${overrides.id}`,
    description: null,
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

test("notifyCalendarDrift: jedna hláška pro obě role, se skloňováním a výčtem zakázek", async () => {
  const { created, db } = fakeNotifyDb();
  await notifyCalendarDrift(
    db,
    [mkDrifted({ id: 1, reason: "END_MISMATCH" }), mkDrifted({ id: 2, reason: "START_NOT_RUNNABLE" })],
    notifyActor,
    "Změna směn"
  );
  assert.equal(created.length, 2, "dvě role, jedna hláška");
  assert.deepEqual(created.map((c) => c.targetRole), ["PLANOVAT", "ADMIN"]);
  assert.equal(created[0].message, "Změna směn: 2 bloky nesedí na kalendář (Z-1, Z-2)");
});

test("notifyCalendarDrift: prázdný seznam → žádná notifikace", async () => {
  const { created, db } = fakeNotifyDb();
  await notifyCalendarDrift(db, [], notifyActor, "Změna směn");
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
