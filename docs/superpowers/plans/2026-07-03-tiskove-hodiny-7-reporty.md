# Tiskové hodiny — Etapa 7: Reporty (spec 3.10) + triage backlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reportové metriky (dashboard + denní report) počítají ZAKAZKA bloky přes tiskové minuty a průnik tiskových segmentů s oknem dne/směny — vytížení už nenadhodnocuje odstávka ani dvojité započtení přes půlnoc. K tomu vyřešit triage backlog etapy 6.

**Architecture:** Nové čisté helpery `blockReportSegments` + `printOverlapMinutes` v `printTimeClient.ts` (sdílejí guardy `tryExpandForBlock` — jediný zdroj pravdy pro „lze blok spolehlivě expandovat"). `reportMetrics.computeBlockHours` přechází na `printMinutes`. Dashboard route (4 místa) a denní report (API + klient) konzumují helpery. Žádná DB migrace, žádná mutace dat — reporty jen čtou.

**Tech Stack:** Next.js App Router, Prisma 5, node:test + tsx, čisté funkce bez DB v `src/lib`.

## Global Constraints

- **Žádné commity** — implementeri NEcommitují (Vojta commituje celek jako „stage 7"). Snapshot pro review: `git add -N .` + `git diff HEAD`.
- Server je jediná autorita pro `endTime` ZAKAZKA bloků; reporty NIKDY nemutují data (žádný write do Block/AuditLog).
- API routes: chyby přes `AppError`/`isAppError` (`src/lib/errors.ts`), logování přes `logger` (`src/lib/logger.ts`), nikdy `console.*`.
- `src/lib/printTime.ts` a `src/lib/printTimeClient.ts` zůstávají čisté (žádný DB/prisma import).
- Guardy „lze expandovat" (ZAKAZKA, ne bypass, `printMinutes > 0`, start zarovnaný na 30min slot) jsou definované JEDNOU v `tryExpandForBlock` (`printTimeClient.ts`) — nové helpery je MUSÍ sdílet, ne replikovat.
- Fixní směny: MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6 Praha (`src/lib/shifts.ts`); NIGHT má forward semantiku (řádek dne X řídí X 22:00 → X+1 06:00). `MAX_SPAN_DAYS = 21`, `SLOT_MS = 30 min`.
- Testy: `node --test --import tsx <soubor>`; jen `scheduleSlotFinder.server.test.ts` potřebuje `--experimental-test-module-mocks`. Po každém tasku navíc `npx tsc --noEmit`.
- UI texty česky.
- Baseline před etapou: suita 352/352 (28 souborů), tsc 0. HEAD = `7201da8b` (dtp). Pozn.: notifikace jsou od commitu `dtp` v `useNotifications`/`NotificationBell`/`NotificationsPanel`; `InboxPanel` exportuje `InboxList`, `InfoPanel` exportuje `AuditList`.

## Kontext — co dnes lže (spec 3.10)

1. `computeBlockHours` (`reportMetrics.ts:178`) sčítá `endTime − startTime` (elapsed). ZAKAZKA pauznutá přes odstávku má elapsed > tiskový čas → vytížení > 100 %.
2. `dailyUtilization` (retro, `dashboard/route.ts:120–135`) a `dailyCapacity` (outlook, `:224–241`) přičítají KAŽDÉMU dni, který blok protne, jeho CELOU délku → blok přes půlnoc se počítá 2×.
3. `blockOverlapsShift` (`ReportView.tsx:92`) je prostý span-overlap → pauznutý blok se ukáže i ve směně, kdy stroj stojí.
4. Retro handler fetchuje `_companyDays`, ale nepoužívá je; outlook je nefetchuje vůbec.

---

### Task 1: `blockReportSegments` + `printOverlapMinutes` (printTimeClient) + testy

**Files:**
- Modify: `src/lib/printTimeClient.ts` (přidat 2 exporty za `getBlockSegments`)
- Test: `src/lib/printTimeClient.test.ts` (přidat na konec souboru)

**Interfaces:**
- Consumes: `tryExpandForBlock` (private helper v témže souboru), `PrintSegment` z `@/lib/printTime`.
- Produces: `blockReportSegments(b, weekShifts, companyDays): PrintSegment[] | null` a `printOverlapMinutes(segments, b, winStart, winEnd): number` — Tasky 3 a 4 je importují přesně s těmito signaturami.

- [ ] **Step 1: Napsat failing testy** — přidat na konec `src/lib/printTimeClient.test.ts`:

```ts
// ── blockReportSegments + printOverlapMinutes (etapa 7 — reporty) ───────────

import { blockReportSegments, printOverlapMinutes } from "./printTimeClient";

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
```

- [ ] **Step 2: Spustit — musí selhat** (`blockReportSegments is not exported`):
`node --test --import tsx src/lib/printTimeClient.test.ts` → FAIL.

- [ ] **Step 3: Implementace** — do `src/lib/printTimeClient.ts` za `getBlockSegments` vložit:

```ts
/**
 * Segmenty bloku pro reportové metriky. Na rozdíl od getBlockSegments vrací
 * segmenty i pro souvislý blok bez pauzy (reporty potřebují průnik tiskového
 * času s oknem dne/směny vždy, ne jen kvůli overlay) a nevyžaduje přítomnost
 * pauzy. Null = nelze spolehlivě expandovat (guardy tryExpandForBlock, expanze
 * selže, nebo drift endu) — volající počítá konzervativní fallback z celého
 * spanu přes printOverlapMinutes(null, …).
 */
export function blockReportSegments(
  b: { type: string; machine: string; startTime: string | Date; endTime: string | Date; printMinutes?: number | null; scheduleBypassed?: boolean | null },
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[]
): PrintSegment[] | null {
  const exp = tryExpandForBlock(b, weekShifts, companyDays);
  if (!exp || !exp.ok) return null;
  if (exp.end.getTime() !== new Date(b.endTime).getTime()) return null;
  return exp.segments;
}

/**
 * Tiskové minuty bloku uvnitř okna [winStart, winEnd). Se segmenty sčítá průnik
 * print segmentů s oknem; bez nich (null) konzervativně průnik celého spanu
 * start–end (ne-ZAKAZKA, bypass, legacy pm=null, drift). Čistá intervalová
 * matematika — okno nemusí být zarovnané na sloty.
 */
export function printOverlapMinutes(
  segments: PrintSegment[] | null,
  b: { startTime: string | Date; endTime: string | Date },
  winStart: Date,
  winEnd: Date
): number {
  if (winEnd.getTime() <= winStart.getTime()) return 0;
  const clip = (s: number, e: number) =>
    Math.max(0, Math.min(e, winEnd.getTime()) - Math.max(s, winStart.getTime()));
  if (!segments) {
    return clip(new Date(b.startTime).getTime(), new Date(b.endTime).getTime()) / 60000;
  }
  let ms = 0;
  for (const seg of segments) {
    if (seg.kind !== "print") continue;
    ms += clip(seg.start.getTime(), seg.end.getTime());
  }
  return ms / 60000;
}
```

- [ ] **Step 4: Testy zelené**: `node --test --import tsx src/lib/printTimeClient.test.ts` → PASS (22 původních + 10 nových). Pak `npx tsc --noEmit` → 0 chyb.

---

### Task 2: `computeBlockHours` přes printMinutes + přepis testů

**Files:**
- Modify: `src/lib/reportMetrics.ts` (typ `BlockInput`, sekce 7)
- Test: `src/lib/reportMetrics.test.ts` (přepis describe `computeBlockHours` + doplnění pole do fixtures)

**Interfaces:**
- Produces: `BlockInput` nově s povinným `printMinutes: number | null`; export `blockDurationHours(b: BlockInput): number`; `computeBlockHours` beze změny signatury. Task 3 obojí importuje.

- [ ] **Step 1: Failing testy** — v `reportMetrics.test.ts` přepsat describe `computeBlockHours` (a do všech fixture objektů typu BlockInput v souboru doplnit `printMinutes: null`, ať typ sedí):

```ts
describe("computeBlockHours", () => {
  const mk = (over: Partial<Parameters<typeof computeBlockHours>[0][number]>) => ({
    type: "ZAKAZKA", machine: "XL_106",
    startTime: new Date("2026-08-21T18:00:00.000Z"),
    endTime: new Date("2026-08-23T22:00:00.000Z"), // elapsed 52 h
    printMinutes: 240 as number | null,
    printCompletedAt: null, createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...over,
  });

  it("ZAKAZKA s printMinutes → tiskové hodiny, ne elapsed (pauznutý blok)", () => {
    assert.equal(computeBlockHours([mk({})], "XL_106", "ZAKAZKA"), 4);
  });
  it("ZAKAZKA s printMinutes=null (legacy) → elapsed fallback", () => {
    assert.equal(
      computeBlockHours([mk({ printMinutes: null, endTime: new Date("2026-08-21T22:00:00.000Z") })], "XL_106", "ZAKAZKA"),
      4,
    );
  });
  it("UDRZBA ignoruje printMinutes → elapsed", () => {
    assert.equal(
      computeBlockHours([mk({ type: "UDRZBA", printMinutes: 999, endTime: new Date("2026-08-21T20:00:00.000Z") })], "XL_106", "UDRZBA"),
      2,
    );
  });
  it("filtruje stroj a typ", () => {
    assert.equal(computeBlockHours([mk({ machine: "XL_105" })], "XL_106", "ZAKAZKA"), 0);
    assert.equal(computeBlockHours([mk({})], "XL_106", "UDRZBA"), 0);
  });
});
```

- [ ] **Step 2: Spustit — FAIL** (typ i hodnoty): `node --test --import tsx src/lib/reportMetrics.test.ts`.

- [ ] **Step 3: Implementace** — v `reportMetrics.ts`: do `BlockInput` přidat `printMinutes: number | null;` a sekci 7 nahradit:

```ts
/**
 * Hodiny jednoho bloku pro metriky: ZAKAZKA = printMinutes (tiskový čas — elapsed
 * by u bloku pauznutého přes odstávku nadhodnocoval), fallback elapsed pro legacy
 * bloky s printMinutes=null. Ostatní typy = elapsed. Bypass ZAKAZKA má pm == elapsed.
 */
export function blockDurationHours(b: BlockInput): number {
  const elapsedH = (b.endTime.getTime() - b.startTime.getTime()) / 3_600_000;
  if (b.type !== "ZAKAZKA") return elapsedH;
  return b.printMinutes != null && Number.isFinite(b.printMinutes) && b.printMinutes > 0
    ? b.printMinutes / 60
    : elapsedH;
}

/** Součet hodin bloků pro daný stroj a typ (ZAKAZKA přes tiskové minuty). */
export function computeBlockHours(blocks: BlockInput[], machine: string, type: string): number {
  return blocks
    .filter((b) => b.machine === machine && b.type === type)
    .reduce((sum, b) => sum + blockDurationHours(b), 0);
}
```

Pozn.: záměrně NEsdílet s `blockPrintMinutes` z printTimeClient — ten fallback zaokrouhluje na 30min grid (payload sémantika), report musí být poctivý bez zaokrouhlení.

- [ ] **Step 4: Zelené + tsc**: `node --test --import tsx src/lib/reportMetrics.test.ts` → PASS; `npx tsc --noEmit` → **ČEKANÉ CHYBY v `dashboard/route.ts`** (blockInputs nemají printMinutes) — to opraví Task 3; pokud tsc hlásí JEN dashboard route, Task 2 je hotový (zapsat do reportu).

---

### Task 3: Dashboard route — 4 metriky přes tiskové hodiny

**Files:**
- Modify: `src/app/api/report/dashboard/route.ts`

**Interfaces:**
- Consumes: `blockReportSegments`/`printOverlapMinutes` (Task 1), `blockDurationHours` (Task 2), `PrintSegment` z `@/lib/printTime`.
- Produces: response tvary BEZE ZMĚNY (stejná pole, jen správná čísla) — `ReportDashboard.tsx` se nemění.

- [ ] **Step 1: Selecty + okno weekShifts.** V obou handlerech do `prisma.block.findMany` select přidat `printMinutes: true, scheduleBypassed: true` a do `blockInputs` map přidat `printMinutes: b.printMinutes, scheduleBypassed: b.scheduleBypassed`. WeekShifts where v OBOU handlerech nahradit:

```ts
prisma.machineWeekShifts.findMany({
  // 28 d zpět: blok protínající rozsah může začínat až MAX_SPAN_DAYS (21 d) před
  // rangeStart a expanze potřebuje i týden před startem bloku (noční prev-tail).
  // Starší legacy bloky degradují bezpečně na elapsed fallback (segments=null).
  where: { weekStart: { gte: new Date(startUtc.getTime() - 28 * 86_400_000), lt: endUtc } },
}),
```

- [ ] **Step 2: companyDays.** V retro přejmenovat `_companyDays` → `companyDays`; v outlooku PŘIDAT stejný fetch do `Promise.all`:

```ts
prisma.companyDay.findMany({
  where: { startDate: { lt: endUtc }, endDate: { gt: startUtc } },
}),
```

- [ ] **Step 3: Mapa segmentů (1× per blok, ne per den).** V obou handlerech po sestavení `blockInputs`:

```ts
// Segmenty 1× per blok — denní smyčka by expanzi opakovala až 30×.
const segMap = new Map<(typeof blockInputs)[number], PrintSegment[] | null>();
for (const b of blockInputs) {
  segMap.set(b, b.type === "ZAKAZKA" ? blockReportSegments(b, weekShifts, companyDays) : null);
}
```

- [ ] **Step 4: Retro `dailyUtilization`** — tělo denní smyčky pro stroj nahradit:

```ts
const avail = computeAvailableHours(machine, cur, cur, weekShifts);
const prodMin = dayBlocks
  .filter((b) => b.machine === machine && b.type === "ZAKAZKA")
  .reduce((sum, b) => sum + printOverlapMinutes(segMap.get(b) ?? null, b, dayStart, dayEnd), 0);
entry[machine] = computeUtilization(prodMin / 60, avail);
```

(Retro machines totals se nemění — `computeBlockHours` už je pm-based z Tasku 2 = spec bullet 1.)

- [ ] **Step 5: Outlook totals + `dailyCapacity`.** `plannedHours` nahradit `blockInputs.filter((b) => b.machine === machine).reduce((sum, b) => sum + blockDurationHours(b), 0)`. V denní smyčce dailyCapacity:

```ts
const planned = dayBlocks
  .filter((b) => b.machine === machine)
  .reduce((sum, b) => sum + printOverlapMinutes(segMap.get(b) ?? null, b, dayStart, dayEnd), 0) / 60;
entry[machine] = computeUtilization(planned, avail);
```

- [ ] **Step 6: Verifikace**: `npx tsc --noEmit` → 0 (opraví i čekané chyby z Tasku 2); celá suita `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` → 0 fail; `npm run build` → OK.

---

### Task 4: Denní report — API vrací kalendář, směny přes segmenty

**Files:**
- Modify: `src/app/api/report/daily/route.ts`
- Modify: `src/app/report/daily/ReportView.tsx`

**Interfaces:**
- Consumes: `blockReportSegments`/`printOverlapMinutes` (Task 1), `serializeWeekShifts` z `@/lib/scheduleValidation`, typ `MachineWeekShiftsRow` z `@/lib/machineWeekShifts`.
- Produces: response `/api/report/daily` mění tvar z `Block[]` na `{ blocks, weekShifts, companyDays }`. Jediný konzument je ReportView (ověřeno grepem 3. 7.) — breaking change je bezpečná.

- [ ] **Step 1: API route** — tělo try nahradit:

```ts
const dayStart = pragueToUTC(dateParam, 6, 0);
const dayEnd = pragueToUTC(addDaysToCivilDate(dateParam, 1), 6, 0);
// ±28 d: bloky protínající den mohou začínat/končit až MAX_SPAN_DAYS (21 d) mimo
// den a expanze segmentů potřebuje kalendář celého spanu (+ prev-week tail).
const calFrom = new Date(dayStart.getTime() - 28 * 86_400_000);
const calTo = new Date(dayEnd.getTime() + 28 * 86_400_000);
const machineFilter = session.role === "TISKAR" ? { machine: session.assignedMachine ?? undefined } : {};
const [blocks, rawWeekShifts, companyDays] = await Promise.all([
  prisma.block.findMany({
    where: { startTime: { lt: dayEnd }, endTime: { gt: dayStart }, ...machineFilter },
    orderBy: { startTime: "asc" },
  }),
  prisma.machineWeekShifts.findMany({ where: { weekStart: { gte: calFrom, lt: calTo } } }),
  prisma.companyDay.findMany({ where: { startDate: { lt: calTo }, endDate: { gt: calFrom } } }),
]);

return NextResponse.json({
  blocks: blocks.map(serializeBlock),
  weekShifts: serializeWeekShifts(rawWeekShifts),
  companyDays,
});
```

(import `serializeWeekShifts` z `@/lib/scheduleValidation`; `serializeBlock` propouští `printMinutes`/`scheduleBypassed` přes spread — nic dalšího netřeba.)

- [ ] **Step 2: ReportView — data.** Do lokálního interface `Block` přidat `printMinutes?: number | null; scheduleBypassed?: boolean;`. Přidat state `weekShifts`/`companyDays` (typy `MachineWeekShiftsRow[]` a `{ machine?: string | null; startDate: string; endDate: string }[]`), fetch handler přepnout na nový tvar:

```ts
.then((data: { blocks: Block[]; weekShifts: MachineWeekShiftsRow[]; companyDays: CompanyDayRow[] }) => {
  setBlocks(data.blocks);
  setWeekShifts(data.weekShifts);
  setCompanyDays(data.companyDays);
  setLoading(false);
})
```

- [ ] **Step 3: ReportView — směny přes segmenty.** `blockOverlapsShift` nahradit (a upravit jediné volání na ř. ~272):

```ts
// Průnik TISKOVÝCH segmentů se směnou — pauznutý blok se nesmí objevit ve
// směně, kdy stroj stojí. Fallback (null) = span overlap jako dřív
// (ne-ZAKAZKA, bypass, legacy, drift).
function blockPrintsInShift(
  block: Block,
  segments: PrintSegment[] | null,
  shiftStart: Date,
  shiftEnd: Date,
): boolean {
  return printOverlapMinutes(segments, block, shiftStart, shiftEnd) > 0;
}
```

a v render fázi (po `xl105`/`xl106` filtrech) předpočítat mapu + použít:

```ts
const segMap = new Map<Block, PrintSegment[] | null>();
for (const b of blocks) segMap.set(b, blockReportSegments(b, weekShifts, companyDays));
// … ve směnové sekci:
const shiftBlocks = blocks.filter((b) => blockPrintsInShift(b, segMap.get(b) ?? null, shiftStart, shiftEnd));
```

- [ ] **Step 4: Verifikace**: `npx tsc --noEmit` → 0; `npm run build` → OK; suita beze změny. Ruční kontrola: `grep -rn "report/daily" src/ | grep -v "app/report/daily\|app/api/report/daily"` → prázdné (žádný jiný konzument).

---

### Task 5: Triage drobné — MACHINES konstanta, start≤end odstávek, P2028 hláška, pin 365d okna

**Files:**
- Create: `src/lib/machines.ts`
- Modify: `src/app/api/report/dashboard/route.ts`, `src/app/api/blocks/reflow/route.ts` + další místa dle grepu `\["XL_105", "XL_106"\]` v `src/app/api/**` a `src/lib/**` (M1: 4 místa; klientské komponenty NEměnit — mají vlastní layout seznamy, mimo scope)
- Modify: `src/app/api/company-days/route.ts` (POST), `src/app/api/company-days/[id]/route.ts` (PUT)
- Modify: `src/app/api/blocks/reflow/route.ts` + `src/app/api/blocks/[id]/reflow/route.ts` (P2028)
- Test: `src/lib/reflow.server.test.ts` (pin okna)

- [ ] **Step 1: `src/lib/machines.ts`:**

```ts
/** Jediný zdroj pravdy pro seznam tiskových strojů (M1 z triage etapy 6). */
export const MACHINES = ["XL_105", "XL_106"] as const;
export type MachineId = (typeof MACHINES)[number];
```

Grepem najít pole `["XL_105", "XL_106"]` v `src/app/api/**` a `src/lib/**` (serverová místa; dle triage 4 výskyty) a nahradit importem `MACHINES` (kde kód pole mutuje/spready, použít `[...MACHINES]`).

- [ ] **Step 2: Validace odstávek.** V company-days POST i PUT hned za parsování `parsedStart`/`parsedEnd` (POST `route.ts:~35`, PUT `[id]/route.ts:~38`):

```ts
if (parsedEnd.getTime() <= parsedStart.getTime()) {
  return NextResponse.json({ error: "Konec odstávky musí být po jejím začátku." }, { status: 400 });
}
```

- [ ] **Step 3: P2028 hláška.** V catch obou reflow routes PŘED obecný 500 fallback:

```ts
import { Prisma } from "@prisma/client";
// …
if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
  return NextResponse.json(
    { error: "Přepočet trval příliš dlouho — zkuste to znovu, případně po menších částech." },
    { status: 503 },
  );
}
```

- [ ] **Step 4: Pin test okna 365 d.** Do `reflow.server.test.ts` test, který přes mkTx fixture zachytí `findMany` where z `reflowMachineInTx` a assertne, že okno je `now → now + 365 d` (`MACHINE_REFLOW_WINDOW_DAYS`): pokud fixture umožňuje injektovat `now` přes deps, assert přesných hodnot; jinak assert `(lt − gte) === 365 * 86_400_000` a `gte` v toleranci ±5 s od `Date.now()`.

- [ ] **Step 5: Verifikace**: suita + tsc + build. U kroku 2 ruční sanity: POST s `endDate < startDate` přes kód nelze bez DB — postačí unit-level kontrola logiky čtením + tsc (routes nemají test harness, konzistentní s repem).

---

### Task 6: Triage refactory — preloadedCalendar, TOCTOU DRY, BlockDetail nadpis dle reason

**Files:**
- Modify: `src/lib/reflow.server.ts` + `src/lib/reflow.server.test.ts`
- Modify: `src/app/api/machine-week-shifts/route.ts`, `src/app/api/company-days/route.ts`, `src/app/api/company-days/[id]/route.ts`, `src/lib/findConflictingBlocks.ts` (TOCTOU DRY — přesný tvar helperu rozhodnout PO přečtení obou routes; musí být behavior-preserving: stejné dotazy, stejné chybové texty)
- Modify: `src/components/BlockDetail.tsx` (drift sekce, ~ř. 557+)

- [ ] **Step 1: preloadedCalendar.** Do deps `reflowBlockInTx` přidat volitelný `preloadedCalendar?: MachineCalendar` (import typu z `printTime.server`). Když je předaný, použít místo per-blok `loadMachineCalendarRange`; docstring: „Volající RUČÍ za pokrytí [start−1d, start+MAX_SPAN_DAYS+7d] — nedostatečný kalendář tiše spadne na hardcoded fallback." `reflowMachineInTx` načte kalendář JEDNOU pro okno `[now − 1d, now + (365 + 21 + 1) d]` a předá ho všem blokům. Test: mock počítadlo — machine reflow se 3 bloky volá loader právě 1×.

- [ ] **Step 2: TOCTOU DRY.** Přečíst re-check bloky v machine-week-shifts PUT a company-days POST/PUT/DELETE; společné jádro (fetch bloků přes `conflictWindowWhere` + `detectConflictsPure` + AppError při konfliktu) extrahovat do `findConflictingBlocks.ts` jako sdílenou funkci; routes ji volají. Chybové texty a status kódy MUSÍ zůstat bitově stejné. Suita + tsc.

- [ ] **Step 3: BlockDetail nadpis dle reason.** V drift sekci nahradit fixní nadpis mapou:

```ts
const DRIFT_TITLES: Record<CalendarDriftInfo["reason"], string> = {
  END_MISMATCH: "Blok nesedí na kalendář",
  START_NOT_RUNNABLE: "Start bloku je mimo provoz stroje",
  HORIZON_EXCEEDED: "Blok nejde podle kalendáře dopočítat",
};
```

(import typu `CalendarDriftInfo` z `@/lib/printTimeClient`; tělo sekce a tlačítko Přepočítat beze změny).

- [ ] **Step 4: Verifikace**: `node --test --import tsx src/lib/reflow.server.test.ts` + celá suita + tsc + build.

---

### Task 7: Dokumentace — CLAUDE.md + DOKUMENTACE.md

**Files:**
- Modify: `CLAUDE.md`, `DOKUMENTACE.md`

- [ ] **Step 1:** CLAUDE.md „Ověřený stav" + nová sekce „Reporty přes tiskové hodiny (etapa 7, 3. 7. 2026)": computeBlockHours pm-based, dailyUtilization/dailyCapacity/blockOverlapsShift přes průnik print segmentů (`blockReportSegments`/`printOverlapMinutes` v printTimeClient), daily API tvar `{ blocks, weekShifts, companyDays }`, triage položky (MACHINES konstanta, start≤end validace, P2028 503, preloadedCalendar, TOCTOU helper, DRIFT_TITLES).
- [ ] **Step 2:** CLAUDE.md sekce „Spuštění testů" PŘEPSAT podle reality: vyjmenovat všech ~28 souborů s počty (zjistit spuštěním suity), celkový součet, flag poznámka. Doplnit zmínku o notifikačním refaktoru (commit `dtp`): `src/hooks/useNotifications.ts`, `src/components/NotificationBell.tsx`, `src/components/NotificationsPanel.tsx`, `InboxPanel` → export `InboxList`, `InfoPanel` → export `AuditList` — do sekce Klíčové soubory.
- [ ] **Step 3:** DOKUMENTACE.md: 1 odstavec uživatelsky (vytížení v reportech počítá tiskový čas — blok čekající přes odstávku nenafukuje vytížení ani se nepočítá dvakrát přes půlnoc; v denním reportu se zakázka ukazuje jen ve směnách, kdy se skutečně tiskne).
- [ ] **Step 4:** Verifikace: finální běh CELÉ suity + tsc + build; počty v CLAUDE.md musí odpovídat výstupu.

---

## Vědomě odloženo (mimo scope etapy 7 — rozhodnutí, ne opomenutí)

- **Stale klientský pm** (systémové riziko drag/resize/paste s neaktuálním printMinutes) — vyžaduje vlastní návrh, zaznamenáno v ledgeru etapy 6.
- **Rate limit reflow endpointů** — konzistentní s ostatními block mutacemi (žádný nemají).
- **Banner driftu vs. viditelné okno** — kosmetika, self-heal přes poll.
- **M-A seed atribuce** — detail nálezu se nedochoval v ledgeru; prověřit při finále featury (etapa 8).
- **Fixní směnové sekce denního reportu** (SHIFTS_105 bez noční, SHIFTS_106 s noční vždy) — pre-existující vzhled reportu, spec 3.10 ho nemění; segmentový filtr zajistí, že v prázdné/stojící směně blok nebude.
- **Retro/outlook TOTALS neklipují k rozsahu** (blok přesahující rozsah se počítá celý) — pre-existující sémantika, spec mění jen zdroj délky (pm místo elapsed); klip řeší denní řady.
