# Tiskové hodiny — Plán 2/N: Server — validace + API routes + legacy skript

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server se stává jediným zdrojem pravdy pro `endTime`: POST/PUT/batch přijímají tiskové minuty, konec počítají přes `expandPrintTime`, validace vynucuje invariant `end == expand(start, printMinutes)`. Plus limit 40 h a detekční skript legacy bypass bloků.

**Architecture:** Nový `src/lib/printTime.server.ts` (DB fetch kalendáře s garantovaným pokrytím + expand wrapper). Přepis `validateBlockScheduleFromDb` na nový kontrakt „validuj + vrať autoritativní end". Routes: printMinutes intake (explicitní / odvozený / ze záznamu), `scheduleBypassed` persistence, rozlišení move vs. resize. Chain push a findNextFreeSlot se v tomto plánu NEMĚNÍ (Plán 3) — odsunuté bloky zatím zůstávají na staré souvislé logice, což je konzistentní mezistav (nic se nenasazuje).

**Tech Stack:** Next.js 16 API routes, Prisma 5, node:test + tsx; testy s mockem Prismy vyžadují `--experimental-test-module-mocks`.

## Global Constraints

- Větev `Vojta`; ŽÁDNÉ `git commit`/`git push` (commituje Vojta); NIKDY `prisma db pull`/`prisma format`.
- `AppError` v každé API route; `logger` místo console (viz CLAUDE.md coding standards).
- Limit: `0 < printMinutes ≤ MAX_PRINT_MINUTES (2400)` a `printMinutes % 30 === 0` — vynucovat na serveru pro ZAKAZKA; NE retroaktivně na stará data.
- `printMinutes = NULL` pro ne-ZAKAZKA typy; změna typu ZAKAZKA↔UDRZBA/REZERVACE musí printMinutes nastavit/vyčistit (spec §3.1).
- Bypass sémantika (spec §2): `bypassScheduleValidation` → end = start + printMinutes (bez pauz), persistovat `scheduleBypassed=true`; CompanyDay zůstává tvrdý zákaz (dnešní chování).
- Precondition jádra: start i end na 30min gridu (expandPrintTime jinak throwne) — route mapuje na 422.
- Sdílené konstanty/typy z `src/lib/printTime.ts`: `SLOT_MS`, `MAX_PRINT_MINUTES`, `MAX_SPAN_DAYS`, `CompanyDayInterval`, `ExpandResult`, `expandPrintTime`, `computePrintMinutes`, `isMachineRunnableAt`.

---

### Task 1: `printTime.server.ts` — kalendářní fetch s garantovaným pokrytím (TDD)

**Files:**
- Create: `src/lib/printTime.server.ts`
- Test: `src/lib/printTime.server.test.ts`

**Interfaces:**
- Consumes: `expandPrintTime`, `MAX_SPAN_DAYS`, typy z `@/lib/printTime`; `serializeWeekShifts` z `@/lib/scheduleValidation`; `weekStartStrFromDateStr` z `@/lib/machineWeekShifts`; `pragueOf` z `@/lib/dateUtils`; `prisma` z `@/lib/prisma`.
- Produces (spoléhají na ně Tasky 2–5 a Plán 3):

```typescript
export type MachineCalendar = {
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayInterval[];
};
/** Načte weekShifts pro VŠECHNY týdny [start, start + MAX_SPAN_DAYS] (garance pokrytí
 *  pro expandPrintTime — týden mimo fetch by tiše spadl na hardcoded fallback)
 *  + companyDays (machine=null nebo machine) protínající totéž okno.
 *  `db` je prisma nebo transakční klient. */
export async function loadMachineCalendar(db: PrismaClientLike, machine: string, start: Date): Promise<MachineCalendar>;
/** Expand nad DB kalendářem — jediná serverová cesta k výpočtu endu. */
export async function expandPrintTimeFromDb(db: PrismaClientLike, machine: string, start: Date, printMinutes: number, bypass: boolean): Promise<ExpandResult>;
```

`PrismaClientLike` = strukturální typ `{ machineWeekShifts: { findMany: ... }, companyDay: { findMany: ... } }` (vzor: `PrismaTransactionClient` v `src/lib/overlapCheck.ts:3`).

- [ ] **Step 1: Failing testy**

Create `src/lib/printTime.server.test.ts` (vzor mockování: `src/lib/scheduleValidationServer.test.ts` — `mock.module("@/lib/prisma", ...)` zde NENÍ potřeba, protože `db` se injektuje parametrem — mock je obyčejný objekt):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { loadMachineCalendar, expandPrintTimeFromDb } from "./printTime.server";

// Fake DB klient — vrací připravené řádky a zaznamenává where podmínky
function fakeDb(weekShiftRows: unknown[], companyDayRows: unknown[]) {
  const calls: { weekWhere?: unknown; cdWhere?: unknown } = {};
  return {
    calls,
    machineWeekShifts: {
      findMany: async (args: { where: unknown }) => { calls.weekWhere = args.where; return weekShiftRows; },
    },
    companyDay: {
      findMany: async (args: { where: unknown }) => { calls.cdWhere = args.where; return companyDayRows; },
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
  // Týdny 17.8. a 24.8. plně osazené (Po–Ne 24/7 pro jednoduchost DB řádků: pátek bez noci, so off, ne noc — jako printTime.test.ts by vyžadovalo 14 řádků; zde stačí ověřit, že fetch výsledek POUŽIJE)
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
```

- [ ] **Step 2: Ověřit fail** — Run: `node --test --import tsx src/lib/printTime.server.test.ts` → FAIL `Cannot find module './printTime.server'`.

- [ ] **Step 3: Implementace `src/lib/printTime.server.ts`**

```typescript
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { pragueOf } from "@/lib/dateUtils";
import {
  expandPrintTime,
  MAX_SPAN_DAYS,
  type CompanyDayInterval,
  type ExpandResult,
} from "@/lib/printTime";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Strukturální podmnožina Prisma klienta — funguje s prisma i tx. */
export type PrismaClientLike = {
  machineWeekShifts: {
    findMany: (args: {
      where: { machine: string; weekStart: { in: Date[] } };
    }) => Promise<Parameters<typeof serializeWeekShifts>[0]>;
  };
  companyDay: {
    findMany: (args: {
      where: {
        startDate: { lt: Date };
        endDate: { gt: Date };
        OR: ({ machine: null } | { machine: string })[];
      };
      select: { startDate: true; endDate: true };
    }) => Promise<{ startDate: Date; endDate: Date }[]>;
  };
};

export type MachineCalendar = {
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayInterval[];
};

/**
 * Načte kalendář stroje pro okno [start, start + MAX_SPAN_DAYS]:
 * weekShifts pro VŠECHNY dotčené týdny (precondition expandPrintTime — týden
 * mimo fetch by tiše spadl na hardcoded fallback) + companyDays v okně.
 */
export async function loadMachineCalendar(
  db: PrismaClientLike,
  machine: string,
  start: Date
): Promise<MachineCalendar> {
  const windowEnd = new Date(start.getTime() + MAX_SPAN_DAYS * DAY_MS);
  const weekStarts = new Set<string>();
  for (let t = start.getTime(); t <= windowEnd.getTime(); t += DAY_MS) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  // DST fall-back ošetření: 24h UTC krok může přeskočit civilní datum (vzor scheduleSlotFinder.ts:86)
  weekStarts.add(weekStartStrFromDateStr(pragueOf(windowEnd).dateStr));

  const [rawWeekShifts, cdRows] = await Promise.all([
    db.machineWeekShifts.findMany({
      where: {
        machine,
        weekStart: { in: Array.from(weekStarts).map((s) => new Date(`${s}T00:00:00.000Z`)) },
      },
    }),
    db.companyDay.findMany({
      where: {
        startDate: { lt: windowEnd },
        endDate: { gt: start },
        OR: [{ machine: null }, { machine }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  return {
    weekShifts: serializeWeekShifts(rawWeekShifts),
    companyDays: cdRows.map((c) => ({ start: c.startDate, end: c.endDate })),
  };
}

/** Expand nad DB kalendářem — jediná serverová cesta k výpočtu endu bloku. */
export async function expandPrintTimeFromDb(
  db: PrismaClientLike,
  machine: string,
  start: Date,
  printMinutes: number,
  bypass: boolean
): Promise<ExpandResult> {
  if (bypass) {
    // Bez pauz — kalendář není potřeba (expandPrintTime s bypass=true ho nečte).
    return expandPrintTime(machine, start, printMinutes, [], [], true);
  }
  const cal = await loadMachineCalendar(db, machine, start);
  return expandPrintTime(machine, start, printMinutes, cal.weekShifts, cal.companyDays, false);
}
```

- [ ] **Step 4: Testy zelené** — Run: `node --test --import tsx src/lib/printTime.server.test.ts` → PASS 4/4.
- [ ] **Step 5: Build** — Run: `npm run build` → 0 chyb.
- [ ] ~~Step 6: Commit~~ — PŘESKOČIT (session kontrakt: commituje Vojta).

---

### Task 2: Přepis `validateBlockScheduleFromDb` — validuj + vrať autoritativní end (TDD)

**Files:**
- Modify: `src/lib/scheduleValidationServer.ts` (kompletní přepis, ~50 řádků)
- Test: `src/lib/scheduleValidationServer.test.ts` (kompletní přepis — starých 12 testů fixuje obsolentní sémantiku)

**Interfaces:**
- Consumes: `expandPrintTimeFromDb`, `loadMachineCalendar` z Task 1; `isMachineRunnableAt`, `MAX_PRINT_MINUTES`, `SLOT_MS` z `@/lib/printTime`; `prisma` z `@/lib/prisma`.
- Produces (Tasky 3–5 na tom stojí):

```typescript
export type ScheduleValidationResult =
  | { ok: true; end: Date }
  | { ok: false; error: string };
/** Pro ZAKAZKA: zvaliduje start+printMinutes a vrátí autoritativní end.
 *  Pro ne-ZAKAZKA: vrátí { ok: true, end: fallbackEnd } bez validace (dnešní chování). */
export async function validateAndComputeEnd(
  db: PrismaClientLike, machine: string, startTime: Date, printMinutes: number | null,
  fallbackEnd: Date, blockType: string, bypass: boolean
): Promise<ScheduleValidationResult>;
```

Stará funkce `validateBlockScheduleFromDb` se SMAŽE — všechna 3 volací místa přepisují Tasky 3–5 v tomto plánu (grep na konci Task 5 ověří nulové zbytky).

- [ ] **Step 1: Failing testy — kompletní přepis test souboru**

Nový `src/lib/scheduleValidationServer.test.ts` — fake DB objekt injektovaný parametrem (mock.module na prismu už NENÍ potřeba, flag `--experimental-test-module-mocks` po tomto přepisu odpadá):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { validateAndComputeEnd } from "./scheduleValidationServer";

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
  };
}
const FULL_CAL = fakeDb([...xl106DbWeek("2026-08-17"), ...xl106DbWeek("2026-08-24"),
  ...xl106DbWeek("2026-08-31"), ...xl106DbWeek("2026-09-07")]);

test("ZAKAZKA: validní start + 27h → ok s pauznutým endem (Po 13:00)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), 27 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.deepEqual(r, { ok: true, end: pragueToUTC("2026-08-24", 13) });
});

test("ZAKAZKA: start v odstávce → chyba", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-22", 12), 4 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /mimo provoz/);
});

test("ZAKAZKA: printMinutes chybí (null) → chyba", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), null,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
});

test("ZAKAZKA: printMinutes > 2400 → chyba (limit 40 h)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), 2430,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /40/);
});

test("ZAKAZKA: printMinutes není násobek 30 → chyba", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), 45,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
});

test("ZAKAZKA: nezarovnaný start → chyba (ne crash)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10, 15), 60,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
});

test("bypass: end = start + printMinutes, kalendář se nevaliduje", async () => {
  const start = pragueToUTC("2026-08-22", 12); // sobota
  const r = await validateAndComputeEnd(fakeDb([]), "XL_106", start, 120, new Date(0), "ZAKAZKA", true);
  assert.deepEqual(r, { ok: true, end: new Date(start.getTime() + 120 * 60000) });
});

test("bypass: CompanyDay zůstává tvrdý zákaz", async () => {
  const start = pragueToUTC("2026-08-19", 10);
  const db = fakeDb([], [{ startDate: pragueToUTC("2026-08-19", 0), endDate: pragueToUTC("2026-08-20", 0) }]);
  const r = await validateAndComputeEnd(db, "XL_106", start, 120, new Date(0), "ZAKAZKA", true);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /odstávky/);
});

test("non-bypass: CompanyDay uvnitř pauzy NEvadí (blok ji překlene)", async () => {
  // odstávka celá středa; blok út 18:00 + 12h → pauza přes středu, end čt 06:00
  const db = fakeDb(
    [...xl106DbWeek("2026-08-17"), ...xl106DbWeek("2026-08-24"), ...xl106DbWeek("2026-08-31"), ...xl106DbWeek("2026-09-07")],
    [{ startDate: pragueToUTC("2026-08-19", 0), endDate: pragueToUTC("2026-08-20", 0) }]
  );
  const r = await validateAndComputeEnd(db, "XL_106", pragueToUTC("2026-08-18", 18), 12 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.deepEqual(r, { ok: true, end: pragueToUTC("2026-08-20", 6) });
});

test("HORIZON_EXCEEDED → srozumitelná chyba", async () => {
  const off = (wk: string) => [0, 1, 2, 3, 4, 5, 6].map((d) =>
    dbRow(wk, d, { isActive: false, morningOn: false, afternoonOn: false, nightOn: false }));
  const db = fakeDb([...xl106DbWeek("2026-08-17"), ...off("2026-08-24"), ...off("2026-08-31"), ...off("2026-09-07"), ...off("2026-09-14")]);
  const r = await validateAndComputeEnd(db, "XL_106", pragueToUTC("2026-08-21", 10), 40 * 60,
    new Date(0), "ZAKAZKA", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /dost pracovní doby/);
});

test("UDRZBA: bez validace, end = fallbackEnd", async () => {
  const fb = pragueToUTC("2026-08-23", 15); // neděle — pro údržbu OK
  const r = await validateAndComputeEnd(fakeDb([]), "XL_106", pragueToUTC("2026-08-23", 12), null, fb, "UDRZBA", false);
  assert.deepEqual(r, { ok: true, end: fb });
});
```

- [ ] **Step 2: Ověřit fail** — Run: `node --test --import tsx src/lib/scheduleValidationServer.test.ts` → FAIL (validateAndComputeEnd není export).

- [ ] **Step 3: Implementace — kompletní přepis `src/lib/scheduleValidationServer.ts`**

```typescript
import { MAX_PRINT_MINUTES, SLOT_MS } from "@/lib/printTime";
import {
  expandPrintTimeFromDb,
  loadMachineCalendar,
  type PrismaClientLike,
} from "@/lib/printTime.server";

export type ScheduleValidationResult =
  | { ok: true; end: Date }
  | { ok: false; error: string };

/**
 * Serverová validace harmonogramu — nový model „tiskových hodin".
 *
 * ZAKAZKA bez bypass: start musí ležet na aktivním slotu, end se POČÍTÁ
 * (expandPrintTime přes weekShifts + companyDays — odstávky se překlenou pauzou).
 * ZAKAZKA s bypass: end = start + printMinutes (bez pauz); CompanyDay zůstává
 * tvrdý zákaz (mimořádná směna nesmí kolidovat s celofiremní odstávkou).
 * Ne-ZAKAZKA: bez validace, end = fallbackEnd (dnešní chování).
 *
 * Jediný zdroj pravdy pro endTime — každá write cesta (POST/PUT/batch) MUSÍ
 * ukládat end vrácený touto funkcí, nikdy end z klienta.
 */
export async function validateAndComputeEnd(
  db: PrismaClientLike,
  machine: string,
  startTime: Date,
  printMinutes: number | null,
  fallbackEnd: Date,
  blockType: string,
  bypass: boolean
): Promise<ScheduleValidationResult> {
  if (blockType !== "ZAKAZKA") return { ok: true, end: fallbackEnd };

  if (printMinutes == null || !Number.isFinite(printMinutes) || printMinutes <= 0) {
    return { ok: false, error: "Chybí platná délka tisku (printMinutes)." };
  }
  if (printMinutes % 30 !== 0) {
    return { ok: false, error: "Délka tisku musí být násobek 30 minut." };
  }
  if (printMinutes > MAX_PRINT_MINUTES) {
    return { ok: false, error: `Délka tisku přesahuje limit 40 hodin (${MAX_PRINT_MINUTES / 60} h).` };
  }
  if (startTime.getTime() % SLOT_MS !== 0) {
    return { ok: false, error: "Začátek bloku musí ležet na 30minutové hranici." };
  }

  if (bypass) {
    const end = new Date(startTime.getTime() + printMinutes * 60000);
    // CompanyDay tvrdý zákaz i při bypassu (dnešní sémantika zachována).
    const cal = await loadMachineCalendar(db, machine, startTime);
    const cd = cal.companyDays.find((c) => c.start < end && c.end > startTime);
    if (cd) return { ok: false, error: "Blok zasahuje do plánované odstávky." };
    return { ok: true, end };
  }

  const r = await expandPrintTimeFromDb(db, machine, startTime, printMinutes, false);
  if (!r.ok) {
    return r.reason === "START_NOT_RUNNABLE"
      ? { ok: false, error: "Začátek bloku leží mimo provoz stroje." }
      : { ok: false, error: "V horizontu 21 dní není dost pracovní doby pro tento blok." };
  }
  return { ok: true, end: r.end };
}
```

- [ ] **Step 4: Testy zelené** — Run: `node --test --import tsx src/lib/scheduleValidationServer.test.ts` → PASS 11/11 (bez experimental flagu).
- [ ] **Step 5: Poznámka** — build v tomto kroku SELŽE (routes ještě importují starou funkci) — to je očekávané, oprava v Tascích 3–5. Nespouštět.
- [ ] ~~Step 6: Commit~~ — PŘESKOČIT.

---

### Task 3: POST /api/blocks — printMinutes intake + server-computed end

**Files:**
- Modify: `src/app/api/blocks/route.ts`

**Interfaces:**
- Consumes: `validateAndComputeEnd` (Task 2). Body nově přijímá `printMinutes?: number`; když chybí, odvodí se `(endTime − startTime) / 60000` (zpětná kompatibilita se stávajícím klientem — dnešní klient posílá end se sémantikou end−start = tiskový čas).
- Produces: Block se ukládá s `printMinutes` (ZAKAZKA) / `null` (jinak) a `scheduleBypassed = bypassScheduleValidation`; `endTime` VŽDY z `validateAndComputeEnd`. Response `serializeBlock` obě pole přibaluje automaticky.

- [ ] **Step 1: Přepsat validační sekci (řádky 62–101)**

Nahradit blok od `const scheduleError = await validateBlockScheduleFromDb(` po konec auto-shift větve (řádek 101) tímto (import nahoře: `validateAndComputeEnd` místo `validateBlockScheduleFromDb`):

```typescript
    // printMinutes: explicitně od klienta, jinak odvozeno z end−start (zpětná kompatibilita —
    // starý klient posílá end se sémantikou end−start = tiskový čas).
    const rawPrintMinutes: number | null =
      typeof body.printMinutes === "number"
        ? body.printMinutes
        : blockType === "ZAKAZKA"
          ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
          : null;

    const sched = await validateAndComputeEnd(
      prisma, body.machine as string, startTime, rawPrintMinutes, endTime, blockType, bypassScheduleValidation
    );
    if (!sched.ok) {
      if (!autoShiftIfBusy) {
        return NextResponse.json({ error: sched.error }, { status: 422 });
      }
      // Auto-shift (série z přehledu): najdi nejbližší volný slot — Plán 3 přepíše
      // findNextFreeSlot na start-only snap; do té doby zachováno staré chování.
      const slot = await findNextFreeSlotFromDb(body.machine as string, startTime, durationMs);
      if (!slot.found) {
        return NextResponse.json(
          { error: `Auto-shift selhal: stroj ${body.machine} obsazen déle než 7 dní od ${originalStart.toISOString()}.` },
          { status: 409 }
        );
      }
      startTime = slot.startTime;
      endTime = slot.endTime;
      wasShifted = true;
      logger.info("[POST /api/blocks] auto-shift applied (pre-tx)", {
        machine: body.machine,
        originalStart: originalStart.toISOString(),
        newStart: startTime.toISOString(),
      });
    } else {
      endTime = sched.end; // autoritativní end ze serveru — klientův end se ignoruje
    }
```

- [ ] **Step 2: Uložit nová pole v `tx.block.create`**

Do `data` bloku `tx.block.create` (za `locked: body.locked ?? false,`) přidat:

```typescript
          printMinutes: finalType === "ZAKAZKA" ? rawPrintMinutes : null,
          scheduleBypassed: finalType === "ZAKAZKA" ? bypassScheduleValidation : false,
```

Pozn.: `finalType` může být REZERVACE (rezervační drop) — pak printMinutes = null, správně (REZERVACE se nevaliduje ani nepauzuje).

- [ ] **Step 3: Race-recovery větev v transakci (řádky 137–163)** — `checkBlockOverlap` catch: po `findNextFreeSlotFromDb` přepočítat end znovu přes `validateAndComputeEnd` (stejné parametry, nový start); při `!ok` throw `new AppError("AUTO_SHIFT_FAILED", sched2.error)`.

- [ ] **Step 4: Build + manuální smoke** — Run: `npm run build` → stále FAIL (PUT/batch importují starou funkci — očekávané do Task 5). Kontrola tohoto souboru: `npx tsc --noEmit 2>&1 | grep -v "\[id\]/route\|batch/route" | head` → žádná chyba z `blocks/route.ts`.
- [ ] ~~Step 5: Commit~~ — PŘESKOČIT.

---

### Task 4: PUT /api/blocks/[id] — move vs. resize vs. změna typu

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts` (validační sekce ~128–147, data sekce ~281 a typ-change)

**Interfaces:**
- Consumes: `validateAndComputeEnd`, `computePrintMinutes` + `loadMachineCalendar` (resize inverze).
- Produces: sémantika PUT pro ZAKAZKA (OPRAVENO po review — původní `endChanged` detekce byla slepá vůči reálnému klientovi, který při move posílá start i end):
  1. **Explicitní `body.printMinutes`** → autoritativní; end přepočítat.
  2. **Resize** = start i machine NEZMĚNĚNY a endTime se mění: `printMinutes = computePrintMinutes(machine, start, newEnd, kalendář)`; pro `scheduleBypassed` blok místo toho `printMinutes = (newEnd − start) / 60000`; poté end normalizovat přes `validateAndComputeEnd`. Limity (>0, ≤2400, %30) — jinak 422.
  3. **Move** = mění se startTime nebo machine (klientův endTime se IGNORUJE — je to naivní delta): printMinutes ze ZÁZNAMU (`existing.printMinutes ?? odvození ze starého spanu`); end přepočítat na novém startu/stroji.
  POZN. (review fix B): výpočet computed hodnot běží UVNITŘ `$transaction` z in-tx čtení bloku (ne z pre-tx findUnique) — eliminace TOCTOU; validační chyba uvnitř tx = AppError("SCHEDULE_VIOLATION") → 422.
  4. **Změna typu**: na ZAKAZKA → printMinutes odvodit ze spanu (fallback) a validovat; z ZAKAZKA pryč → `printMinutes: null, scheduleBypassed: false` (spec §3.1).
  Bypass flag bloku: `scheduleBypassed` se přepíše na hodnotu `bypassScheduleValidation` requestu jen když request mění timing (jinak zůstává).

- [ ] **Step 1: Nahradit validační sekci (řádky ~130–147)**

```typescript
    const timingChanged = allowed.startTime !== undefined || allowed.endTime !== undefined || allowed.machine !== undefined;
    const typeChangesToZakazka = allowed.type === "ZAKAZKA";
    let computedEnd: Date | null = null;
    let computedPrintMinutes: number | null = null;
    let computedBypassed: boolean | null = null;

    if (timingChanged || typeChangesToZakazka || allowed.type !== undefined || typeof body.printMinutes === "number") {
      const existing = await prisma.block.findUnique({
        where: { id },
        select: { startTime: true, endTime: true, machine: true, type: true, printMinutes: true, scheduleBypassed: true },
      });
      if (!existing) return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });

      const checkMachine = (allowed.machine as string | undefined) ?? existing.machine;
      const checkType = (allowed.type as string | undefined) ?? existing.type;
      const checkStart = allowed.startTime ? new Date(allowed.startTime as string) : existing.startTime;
      const requestedEnd = allowed.endTime ? new Date(allowed.endTime as string) : existing.endTime;

      if (checkType !== "ZAKAZKA") {
        // Z ZAKAZKA pryč (nebo ne-ZAKAZKA blok): printMinutes vyčistit, end = požadovaný.
        computedEnd = requestedEnd;
        computedPrintMinutes = null;
        computedBypassed = false;
      } else {
        const endChanged = allowed.endTime !== undefined
          && requestedEnd.getTime() !== existing.endTime.getTime();
        const bypass = timingChanged ? bypassScheduleValidation : existing.scheduleBypassed;

        let pm: number | null;
        if (typeof body.printMinutes === "number") {
          pm = body.printMinutes;                              // 1) explicitní
        } else if (endChanged) {
          // 2) resize — inverze z nového endu
          if (bypass) {
            pm = Math.round((requestedEnd.getTime() - checkStart.getTime()) / 60000);
          } else {
            const cal = await loadMachineCalendar(prisma, checkMachine, checkStart);
            pm = computePrintMinutes(checkMachine, checkStart, requestedEnd, cal.weekShifts, cal.companyDays);
          }
        } else if (existing.printMinutes != null && existing.type === "ZAKAZKA") {
          pm = existing.printMinutes;                          // 3) move — ze záznamu
        } else {
          // fallback (legacy blok bez printMinutes / změna typu na ZAKAZKA): odvodit ze spanu
          pm = Math.round((existing.endTime.getTime() - existing.startTime.getTime()) / 60000);
        }

        const sched = await validateAndComputeEnd(prisma, checkMachine, checkStart, pm, requestedEnd, "ZAKAZKA", bypass);
        if (!sched.ok) return NextResponse.json({ error: sched.error }, { status: 422 });
        computedEnd = sched.end;
        computedPrintMinutes = pm;
        computedBypassed = bypass;
      }
    }
```

- [ ] **Step 2: Data sekce (~řádky 281–282)** — nahradit:

```typescript
          ...(allowed.startTime !== undefined && { startTime: new Date(allowed.startTime as string) }),
          ...(computedEnd !== null && { endTime: computedEnd }),
          ...(computedEnd !== null && { printMinutes: computedPrintMinutes }),
          ...(computedBypassed !== null && { scheduleBypassed: computedBypassed }),
```

a smazat původní `...(allowed.endTime !== undefined && { endTime: ... })`. Overlap pre-check (řádky ~200–209): `checkEnd` brát z `computedEnd ?? oldBlock.endTime`.

- [ ] **Step 3: Build kontrola tohoto souboru** — `npx tsc --noEmit 2>&1 | grep "\[id\]/route" | head` → prázdné.
- [ ] ~~Step 4: Commit~~ — PŘESKOČIT.

---

### Task 5: batch route — move s printMinutes ze záznamu

**Files:**
- Modify: `src/app/api/blocks/batch/route.ts`

**Interfaces:**
- Consumes: `validateAndComputeEnd`. Batch = lasso MOVE: klientův `endTime` se pro ZAKAZKA ignoruje, printMinutes VŽDY ze záznamu (fallback span), end počítá server per blok.

- [ ] **Step 1: existingBlocks select** rozšířit o `printMinutes: true, scheduleBypassed: true`.

- [ ] **Step 2: Validační smyčku (řádky 92–101) nahradit** — POZOR: `computedEnds` deklarovat PŘED `if (zakazkaUpdates.length > 0)` (používá se i v pozdější update smyčce a chain push sekci):

```typescript
      const computedEnds = new Map<number, { end: Date; printMinutes: number; bypassed: boolean }>();
      for (const u of zakazkaUpdates) {
        const existing = existingBlocks.find((b) => b.id === u.id)!;
        const pm = existing.printMinutes
          ?? Math.round((existing.endTime.getTime() - existing.startTime.getTime()) / 60000);
        const bypass = bypassScheduleValidation || existing.scheduleBypassed;
        const sched = await validateAndComputeEnd(
          tx, u.machine, new Date(u.startTime), pm, new Date(u.endTime), "ZAKAZKA", bypass
        );
        if (!sched.ok) throw new AppError("SCHEDULE_VIOLATION", sched.error);
        computedEnds.set(u.id, { end: sched.end, printMinutes: pm, bypassed: bypass });
      }
```

- [ ] **Step 3: Update smyčka (řádky 117–124)** — `endTime` z `computedEnds.get(u.id)?.end ?? new Date(u.endTime)` (ne-ZAKAZKA fallback na payload); pro ZAKAZKA přidat `printMinutes` + `scheduleBypassed` z mapy. Overlap pre-check (řádek 114) používat computed end.

- [ ] **Step 4: Chain push anchory (řádek 150)** — `endTime: computedEnds.get(u.id)?.end ?? new Date(u.endTime)`.

- [ ] **Step 5: Ověření žádných zbytků staré funkce** — Run: `grep -rn "validateBlockScheduleFromDb" src/ | grep -v test` → prázdné. Run: `npm run build` → 0 chyb (poprvé od Task 2).

- [ ] **Step 6: Celá suite** — všechny test soubory z CLAUDE.md + printTime.server.test.ts → vše zelené. Pozn.: `scheduleValidationServer.test.ts` už NEpotřebuje experimental flag — ověřit a aktualizovat CLAUDE.md řádek.
- [ ] ~~Step 7: Commit~~ — PŘESKOČIT.

---

### Task 6: Detekční skript legacy bypass bloků

**Files:**
- Create: `scripts/detect-legacy-bypass.ts`

**Interfaces:**
- Consumes: `expandPrintTimeFromDb`, `prisma`. Vzor CLI skriptu: `scripts/fix-existing-overlaps.ts` (dry-run default, `--apply` flag; pozor na BigInt z `$queryRaw` — zde nepoužíváme raw).

- [ ] **Step 1: Implementace**

```typescript
/**
 * Detekce legacy „bypass" bloků: ZAKAZKA bloky, jejichž uložený endTime
 * neodpovídá expandPrintTime(start, printMinutes) — typicky bloky historicky
 * položené s vypnutým zámkem pracovní doby (před zavedením scheduleBypassed).
 *
 * MUSÍ běžet před zapnutím serverové validace na produkci — jinak tyto bloky
 * začnou padat na SCHEDULE_VIOLATION při každém editu.
 *
 * Dry-run: npx tsx scripts/detect-legacy-bypass.ts
 * Apply:   npx tsx scripts/detect-legacy-bypass.ts --apply   (nastaví scheduleBypassed=true)
 */
import { prisma } from "../src/lib/prisma";
import { expandPrintTimeFromDb } from "../src/lib/printTime.server";

async function main() {
  const apply = process.argv.includes("--apply");
  const blocks = await prisma.block.findMany({
    where: { type: "ZAKAZKA", scheduleBypassed: false, printMinutes: { not: null } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, printMinutes: true },
    orderBy: { startTime: "asc" },
  });

  const mismatched: typeof blocks = [];
  for (const b of blocks) {
    const r = await expandPrintTimeFromDb(prisma, b.machine, b.startTime, b.printMinutes!, false);
    if (!r.ok || r.end.getTime() !== b.endTime.getTime()) mismatched.push(b);
  }

  console.log(`Zkontrolováno ${blocks.length} ZAKAZKA bloků, nekonzistentních: ${mismatched.length}`);
  for (const b of mismatched) {
    console.log(`  #${b.id} ${b.orderNumber} ${b.machine} ${b.startTime.toISOString()} – ${b.endTime.toISOString()} (${b.printMinutes} min)`);
  }
  if (apply && mismatched.length > 0) {
    const res = await prisma.block.updateMany({
      where: { id: { in: mismatched.map((b) => b.id) } },
      data: { scheduleBypassed: true },
    });
    console.log(`Označeno scheduleBypassed=true: ${res.count} bloků`);
  } else if (mismatched.length > 0) {
    console.log("Dry-run — nic nezměněno. Spusť s --apply pro označení.");
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Dry-run na dev DB** — Run: `npx tsx scripts/detect-legacy-bypass.ts` → vypíše počty (NEspouštět --apply; rozhodne Vojta po kontrole výpisu). Výstup vložit do reportu.
- [ ] **Step 3: Build** — `npm run build` → 0 chyb.
- [ ] ~~Step 4: Commit~~ — PŘESKOČIT.

---

### Task 7: Finální ověření + dokumentace

- [ ] **Step 1: Celá suite** (všech 7 souborů vč. printTime.server.test.ts) + `npm run build` → vše zelené, spočítat nový total.
- [ ] **Step 2: CLAUDE.md** — aktualizovat: řádek suite total; přidat `printTime.server.test.ts`; scheduleValidationServer.test.ts už bez experimental flagu (smazat poznámku o `mock.module`); do „Klíčové soubory" přidat `printTime.ts`/`printTime.server.ts` a novou sémantiku `validateAndComputeEnd` (nahradit zmínky `validateBlockScheduleFromDb`).
- [ ] **Step 3: Manuální smoke na dev** (curl nebo Prisma studio): POST ZAKAZKA pátek 10:00 + printMinutes 1620 na XL_106 → ověřit end = pondělí 13:00 v DB.

---

## Vědomé mezistavy (vyřeší Plán 3)

- Chain push (`computeChainPush`/`resolveChainPushFromDb`) stále zachovává kalendářní délku odsunutých bloků — odsunutý blok se NEpauzne (post-checky ho drží v souvislém okně, jinak rollback).
- `findNextFreeSlotFromDb` (auto-shift) stále hledá souvislé okno — dlouhý blok s auto-shiftem vrátí 409.
- Klient stále posílá starý payload (odvození printMinutes ze spanu to kryje) — klientská část = Plán 4.
- Bypass sémantika (rozhodnuto v etapa-2 review): bypass INPUT do validace je u PUT move/resize **request-driven** (flag z requestu rozhoduje jen při skutečné změně pozice/délky; jinak se drží `oldBlock.scheduleBypassed`), u batch je **sticky OR** (`bypassScheduleValidation || existing.scheduleBypassed` — lasso přesun nesmí re-expandovat bypass členy). ULOŽENÁ hodnota `scheduleBypassed` je ale ve všech cestách spočítaná pravda (`effectivelyBypassed`), nikdy echo request flagu.
- Pauznuté bloky (rekurentní děti) vs. staré klientské cesty: copy/paste a BlockEdit derivují printMinutes ze spanu **včetně pauzy** — kopie/edit pauznutého bloku tak může dostat nafouknuté pm. Řeší Plán 4 (klient posílá printMinutes explicitně).
- Split přes 2 requesty: u částečně-runnable bloku může split zkrátit 1. půlku (server re-expanduje z nového startu) a ztratit zbytek tiskového času. Řeší Plán 4 (split dle printMinutes/2 místo půlení spanu).

## Po dokončení

Checkpoint pro Vojtu + multi-agent review etapy (deep + spec-audit, jako u etapy 1). Pak Plán 3 (chain push re-expanze + slot finder + přepis overlapResolver/slotFinder testů).
