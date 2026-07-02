# Tiskové hodiny — Plán 1/N: Migrace + jádro `expandPrintTime`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Položit datový a výpočetní základ modelu „tiskových hodin": sloupce `Block.printMinutes` + `Block.scheduleBypassed` s backfillem a pure funkce `expandPrintTime`/`computePrintMinutes` s plnými testy. Chování aplikace se v tomto plánu NEMĚNÍ.

**Architecture:** Nový modul `src/lib/printTime.ts` obsahuje jednotný predikát pracovního času (`isMachineRunnableAt` = směny z MachineWeekShifts + CompanyDay odstávky) a expanzi tiskových minut na kalendář (start + printMinutes → end + segmenty print/pause). Vše pure, bez DB — server i klient budou v dalších plánech volat totéž. Spec: `docs/superpowers/specs/2026-07-02-tiskove-hodiny-design.md`.

**Tech Stack:** Next.js 16, Prisma 5, MySQL, node:test + tsx (`node --test --import tsx <file>`).

## Global Constraints

- Větev `Vojta`, žádné přepínání (feedback_work_only_on_vojta_branch).
- NIKDY `prisma db pull` ani `prisma format` (přejmenuje relační pole).
- Migrace: `npx prisma migrate dev` (dev DB `IGvyroba` přes AMPPS). Produkce v tomto plánu NENÍ.
- Sloupce: `printMinutes INT NULL` (minuty, ne Float hodiny; NULL pro ne-ZAKAZKA), `scheduleBypassed BOOLEAN NOT NULL DEFAULT false`. Žádné FK (UNSIGNED gotcha se netýká).
- Konstanty: `MAX_PRINT_MINUTES = 2400` (40 h), `MAX_SPAN_DAYS = 21`, slot 30 min. printMinutes = **reálné minuty běhu stroje** (elapsed, DST-safe), násobky 30.
- Nikdy `while(true)` bez stropu.
- Datum na serveru: nikdy `getFullYear()/getMonth()/getDate()` — jen helpery z `src/lib/dateUtils.ts`.

---

### Task 1: Migrace — `printMinutes` + `scheduleBypassed` + backfill

**Files:**
- Modify: `prisma/schema.prisma` (model Block, za řádek 75 `expeditionSortOrder Int?`)
- Create: `prisma/migrations/<timestamp>_add_print_minutes_and_bypass/migration.sql` (generuje Prisma, ručně doplnit backfill)

**Interfaces:**
- Produces: DB sloupce `Block.printMinutes: Int?`, `Block.scheduleBypassed: Boolean @default(false)`; Prisma klient je zná. `serializeBlock` je propouští automaticky (spread `...rest` v `src/lib/blockSerialization.ts:36` — skalární pole nevyžadují úpravu).

- [ ] **Step 1: Přidat pole do schema.prisma**

Do `model Block`, hned za `expeditionSortOrder Int?`:

```prisma
  printMinutes                                Int?
  scheduleBypassed                            Boolean      @default(false)
```

- [ ] **Step 2: Vygenerovat migraci bez aplikace**

Run: `npx prisma migrate dev --create-only --name add_print_minutes_and_bypass`
Expected: nová složka `prisma/migrations/*_add_print_minutes_and_bypass/` s `ALTER TABLE`.

- [ ] **Step 3: Doplnit backfill do migration.sql**

Na konec vygenerovaného `migration.sql` přidat:

```sql
-- Backfill: dnešní invariant end-start = tiskový čas (platí i pro bypass bloky ve smyslu záměru plánovače)
UPDATE `Block` SET `printMinutes` = TIMESTAMPDIFF(MINUTE, `startTime`, `endTime`) WHERE `type` = 'ZAKAZKA';
```

- [ ] **Step 4: Aplikovat migraci**

Run: `npx prisma migrate dev`
Expected: `Your database is now in sync with your schema.` bez resetu dat.

- [ ] **Step 5: Ověřit backfill v dev DB**

Run: `npx prisma db execute --stdin <<< "SELECT COUNT(*) AS bad FROM Block WHERE type='ZAKAZKA' AND (printMinutes IS NULL OR printMinutes <> TIMESTAMPDIFF(MINUTE, startTime, endTime));"` — pokud `db execute` nevrací result set, použít `mysql -u root -pmysql IGvyroba -e "<týž SELECT>"`.
Expected: `bad = 0`. Zároveň ověřit, že ne-ZAKAZKA mají NULL: `SELECT COUNT(*) FROM Block WHERE type<>'ZAKAZKA' AND printMinutes IS NOT NULL;` → 0.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: úspěch, 0 chyb (nová pole nikdo nekonzumuje — jen ověření, že klient Prisma je v pořádku).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): Block.printMinutes + scheduleBypassed s backfillem (tiskové hodiny, etapa 1)"
```

---

### Task 2: `printTime.ts` — `isMachineRunnableAt` + `expandPrintTime` (TDD)

**Files:**
- Modify: `src/lib/workingTime.ts:9` (export interního `isBlockedSlotDynamic`)
- Create: `src/lib/printTime.ts`
- Test: `src/lib/printTime.test.ts`

**Interfaces:**
- Consumes: `isBlockedSlotDynamic(machine, date, weekShifts)` z `workingTime.ts` (nově exportovaná); `MachineWeekShiftsRow` z `@/lib/machineWeekShifts`; `pragueToUTC(dateStr, hour, minute?)` z `@/lib/dateUtils` (jen v testech).
- Produces (spoléhají na ně všechny další plány):

```typescript
export const SLOT_MS = 30 * 60 * 1000;
export const MAX_PRINT_MINUTES = 2400; // 40 h
export const MAX_SPAN_DAYS = 21;
export type CompanyDayInterval = { start: Date; end: Date };
export type PrintSegment = { start: Date; end: Date; kind: "print" | "pause" };
export type ExpandResult =
  | { ok: true; end: Date; segments: PrintSegment[] }
  | { ok: false; reason: "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED" };
export function isMachineRunnableAt(machine: string, slotStart: Date, weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayInterval[]): boolean;
export function expandPrintTime(machine: string, start: Date, printMinutes: number, weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayInterval[], bypass?: boolean): ExpandResult;
```

Sémantika: `bypass=true` → žádné pauzy, `end = start + printMinutes`, jeden print segment. Bez bypass: start musí ležet na runnable slotu (jinak `START_NOT_RUNNABLE` — snap řeší volající), end = konec posledního tiskového slotu (nikdy uvnitř pauzy), segmenty se stejným druhem se slévají, první i poslední segment je vždy `print`.

- [ ] **Step 1: Export `isBlockedSlotDynamic`**

V `src/lib/workingTime.ts:9` změnit `function isBlockedSlotDynamic(` na `export function isBlockedSlotDynamic(`. Nic jiného neměnit.

- [ ] **Step 2: Napsat failing testy**

Create `src/lib/printTime.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";
import { expandPrintTime, isMachineRunnableAt, type CompanyDayInterval } from "./printTime";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Směny: MORNING 6–14 (360–840), AFTERNOON 14–22 (840–1320), NIGHT 22–6 (1320–360 wrap)
function mkDay(
  weekStart: string,
  dayOfWeek: number,
  opts: { m?: boolean; a?: boolean; n?: boolean; active?: boolean } = {}
): MachineWeekShiftsRow {
  return {
    machine: "XL_106",
    weekStart,
    dayOfWeek,
    isActive: opts.active ?? true,
    morningOn: opts.m ?? false,
    afternoonOn: opts.a ?? false,
    nightOn: opts.n ?? false,
    morningStartMin: 360, morningEndMin: 840,
    afternoonStartMin: 840, afternoonEndMin: 1320,
    nightStartMin: 1320, nightEndMin: 360,
  };
}

// Reálný režim XL_106: Po–Čt nonstop, Pá do 22:00, So off, Ne od 22:00 (noc)
// = víkendová odstávka Pá 22:00 – Ne 22:00
function xl106Week(weekStart: string): MachineWeekShiftsRow[] {
  return [
    mkDay(weekStart, 1, { m: true, a: true, n: true }),
    mkDay(weekStart, 2, { m: true, a: true, n: true }),
    mkDay(weekStart, 3, { m: true, a: true, n: true }),
    mkDay(weekStart, 4, { m: true, a: true, n: true }),
    mkDay(weekStart, 5, { m: true, a: true }),   // pátek bez noci
    mkDay(weekStart, 6, { active: false }),       // sobota off
    mkDay(weekStart, 0, { n: true }),             // neděle jen noc od 22:00
  ];
}

function offWeek(weekStart: string): MachineWeekShiftsRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(weekStart, d, { active: false }));
}

const W1 = "2026-08-17"; // pondělí
const W2 = "2026-08-24";
const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const NO_CD: CompanyDayInterval[] = [];

// ── expandPrintTime ──────────────────────────────────────────────────────────

test("Gardena 27h přes víkend: 12h print + 48h pauza + 15h print", () => {
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00
  const r = expandPrintTime("XL_106", start, 27 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-24", 13).getTime()); // pondělí 13:00
  assert.equal(r.segments.length, 3);
  assert.deepEqual(r.segments.map((s) => s.kind), ["print", "pause", "print"]);
  assert.equal(r.segments[0].end.getTime(), pragueToUTC("2026-08-21", 22).getTime());
  assert.equal(r.segments[1].end.getTime(), pragueToUTC("2026-08-23", 22).getTime());
  assert.equal(r.segments[2].start.getTime(), pragueToUTC("2026-08-23", 22).getTime());
});

test("blok, který se vejde před odstávku: 1 segment, žádná pauza", () => {
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00, 12h → končí přesně 22:00
  const r = expandPrintTime("XL_106", start, 12 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-21", 22).getTime());
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].kind, "print");
});

test("bypass: žádné pauzy, end = start + printMinutes", () => {
  const start = pragueToUTC("2026-08-21", 10);
  const r = expandPrintTime("XL_106", start, 27 * 60, SHIFTS, NO_CD, true);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), start.getTime() + 27 * 3600000);
  assert.equal(r.segments.length, 1);
});

test("start v odstávce → START_NOT_RUNNABLE", () => {
  const start = pragueToUTC("2026-08-22", 12); // sobota
  const r = expandPrintTime("XL_106", start, 4 * 60, SHIFTS, NO_CD);
  assert.deepEqual(r, { ok: false, reason: "START_NOT_RUNNABLE" });
});

test("CompanyDay uprostřed bloku vloží pauzu", () => {
  // odstávka celá středa 19. 8. (Praha)
  const cd: CompanyDayInterval[] = [
    { start: pragueToUTC("2026-08-19", 0), end: pragueToUTC("2026-08-20", 0) },
  ];
  const start = pragueToUTC("2026-08-18", 18); // úterý 18:00, 12h tisku
  const r = expandPrintTime("XL_106", start, 12 * 60, SHIFTS, cd);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // 6h út 18–24, pauza středa, 6h čt 00–06 (noční tail středy)
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-20", 6).getTime());
  assert.deepEqual(r.segments.map((s) => s.kind), ["print", "pause", "print"]);
});

// ── isMachineRunnableAt ──────────────────────────────────────────────────────

test("isMachineRunnableAt: směna aktivní + bez CD → true; CD → false", () => {
  const t = pragueToUTC("2026-08-18", 10); // úterý 10:00
  assert.equal(isMachineRunnableAt("XL_106", t, SHIFTS, NO_CD), true);
  const cd = [{ start: pragueToUTC("2026-08-18", 0), end: pragueToUTC("2026-08-19", 0) }];
  assert.equal(isMachineRunnableAt("XL_106", t, SHIFTS, cd), false);
});
```

- [ ] **Step 3: Ověřit, že testy padají**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: FAIL — `Cannot find module './printTime'`.

- [ ] **Step 4: Implementace `src/lib/printTime.ts`**

```typescript
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { isBlockedSlotDynamic } from "@/lib/workingTime";

export const SLOT_MS = 30 * 60 * 1000;
/** Max tiskové minuty jednoho bloku (40 h) — vynucuje se od etapy 3 serverově. */
export const MAX_PRINT_MINUTES = 2400;
/** Tvrdý strop kalendářního rozsahu expanze — ochrana před nekonečnou smyčkou. */
export const MAX_SPAN_DAYS = 21;

export type CompanyDayInterval = { start: Date; end: Date };
export type PrintSegment = { start: Date; end: Date; kind: "print" | "pause" };
export type ExpandResult =
  | { ok: true; end: Date; segments: PrintSegment[] }
  | { ok: false; reason: "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED" };

/**
 * Jednotný predikát pracovního času: stroj v daném 30min slotu reálně jede
 * = aktivní směna (MachineWeekShifts / hardcoded fallback) a žádná firemní odstávka.
 * Jediné místo, které smí kombinovat weekShifts + companyDays.
 */
export function isMachineRunnableAt(
  machine: string,
  slotStart: Date,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): boolean {
  const t = slotStart.getTime();
  for (const cd of companyDays) {
    if (cd.start.getTime() <= t && t < cd.end.getTime()) return false;
  }
  return !isBlockedSlotDynamic(machine, slotStart, weekShifts);
}

/**
 * Rozloží tiskové minuty od `start` přes pracovní kalendář stroje.
 * Vrací kalendářní konec + segmenty (print/pause) pro vykreslení.
 *
 * Invarianty: první i poslední segment je "print" (start musí ležet na runnable
 * slotu — jinak START_NOT_RUNNABLE; end je konec posledního tiskového slotu).
 * `bypass=true` = blok vědomě mimo kalendář → žádné pauzy, end = start + printMinutes.
 * printMinutes = reálné (elapsed) minuty — DST-safe díky 30min UTC krokům.
 */
export function expandPrintTime(
  machine: string,
  start: Date,
  printMinutes: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  bypass = false
): ExpandResult {
  if (!Number.isFinite(printMinutes) || printMinutes <= 0) {
    throw new Error("[printTime] printMinutes musí být kladné číslo");
  }
  if (bypass) {
    const end = new Date(start.getTime() + printMinutes * 60000);
    return { ok: true, end, segments: [{ start, end, kind: "print" }] };
  }
  if (!isMachineRunnableAt(machine, start, weekShifts, companyDays)) {
    return { ok: false, reason: "START_NOT_RUNNABLE" };
  }

  const limitMs = start.getTime() + MAX_SPAN_DAYS * 24 * 60 * 60 * 1000;
  const segments: PrintSegment[] = [];
  let remainingMin = printMinutes;
  let cur = start;
  let segStart = start;
  let segKind: "print" | "pause" = "print";
  let end: Date | null = null;

  while (remainingMin > 0) {
    if (cur.getTime() >= limitMs) return { ok: false, reason: "HORIZON_EXCEEDED" };
    const runnable = isMachineRunnableAt(machine, cur, weekShifts, companyDays);
    const kind: "print" | "pause" = runnable ? "print" : "pause";
    if (kind !== segKind) {
      segments.push({ start: segStart, end: cur, kind: segKind });
      segStart = cur;
      segKind = kind;
    }
    if (runnable) {
      const consumed = Math.min(30, remainingMin);
      remainingMin -= consumed;
      if (remainingMin === 0) {
        end = new Date(cur.getTime() + consumed * 60000);
        break;
      }
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }

  // break nastal na runnable slotu → poslední segment je vždy "print"
  segments.push({ start: segStart, end: end as Date, kind: "print" });
  return { ok: true, end: end as Date, segments };
}
```

- [ ] **Step 5: Testy zelené**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: PASS 6/6.

- [ ] **Step 6: Regrese — stávající suite**

Run: `node --test --import tsx src/lib/dateUtils.test.ts && node --test --import tsx src/lib/scheduleValidation.test.ts 2>/dev/null; npm run build`
Expected: build OK; export `isBlockedSlotDynamic` nic nerozbil.

- [ ] **Step 7: Commit**

```bash
git add src/lib/printTime.ts src/lib/printTime.test.ts src/lib/workingTime.ts
git commit -m "feat(core): expandPrintTime + isMachineRunnableAt — jádro tiskových hodin (etapa 2)"
```

---

### Task 3: `computePrintMinutes` — inverze pro resize (TDD)

**Files:**
- Modify: `src/lib/printTime.ts` (přidat funkci na konec)
- Test: `src/lib/printTime.test.ts` (přidat testy)

**Interfaces:**
- Produces: `computePrintMinutes(machine: string, start: Date, end: Date, weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayInterval[]): number` — počet tiskových minut v `[start, end)`. End uvnitř pauzy vrací totéž jako end na začátku pauzy (nejednoznačnost normalizuje volající — resize snap v etapě 4).

- [ ] **Step 1: Failing testy**

Přidat do `src/lib/printTime.test.ts`:

```typescript
import { computePrintMinutes } from "./printTime";

test("computePrintMinutes je inverze expandPrintTime (Gardena 27h)", () => {
  const start = pragueToUTC("2026-08-21", 10);
  const r = expandPrintTime("XL_106", start, 27 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(computePrintMinutes("XL_106", start, r.end, SHIFTS, NO_CD), 27 * 60);
});

test("computePrintMinutes: end uvnitř pauzy = hodnota na začátku pauzy", () => {
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00
  const inPause = pragueToUTC("2026-08-22", 12); // sobota 12:00 (odstávka)
  const atPauseStart = pragueToUTC("2026-08-21", 22);
  assert.equal(
    computePrintMinutes("XL_106", start, inPause, SHIFTS, NO_CD),
    computePrintMinutes("XL_106", start, atPauseStart, SHIFTS, NO_CD)
  );
  assert.equal(computePrintMinutes("XL_106", start, atPauseStart, SHIFTS, NO_CD), 12 * 60);
});
```

- [ ] **Step 2: Ověřit fail**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: FAIL — `computePrintMinutes` není export.

- [ ] **Step 3: Implementace**

Přidat na konec `src/lib/printTime.ts`:

```typescript
/**
 * Inverze expandPrintTime: kolik tiskových minut leží v [start, end).
 * End uvnitř pauzy je nejednoznačný (celá pauza mapuje na stejnou hodnotu) —
 * normalizaci endu na hranu segmentu řeší volající (resize snap).
 */
export function computePrintMinutes(
  machine: string,
  start: Date,
  end: Date,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): number {
  let minutes = 0;
  let cur = start;
  while (cur.getTime() < end.getTime()) {
    if (isMachineRunnableAt(machine, cur, weekShifts, companyDays)) {
      const slotEndMs = Math.min(cur.getTime() + SLOT_MS, end.getTime());
      minutes += Math.round((slotEndMs - cur.getTime()) / 60000);
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return minutes;
}
```

- [ ] **Step 4: Testy zelené**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: PASS 8/8.

- [ ] **Step 5: Commit**

```bash
git add src/lib/printTime.ts src/lib/printTime.test.ts
git commit -m "feat(core): computePrintMinutes — inverze expanze pro resize"
```

---

### Task 4: Edge-case testy (horizont, hranice, DST) + finální ověření

**Files:**
- Test: `src/lib/printTime.test.ts` (přidat testy)
- Modify: `CLAUDE.md` (sekce Spuštění testů — přidat řádek)

**Interfaces:**
- Consumes: vše z Tasků 2–3. Žádné nové exporty.

- [ ] **Step 1: Přidat edge-case testy**

```typescript
import { utcToPragueHour } from "./dateUtils";

test("HORIZON_EXCEEDED: kapacita nestačí do 21 dní, žádná nekonečná smyčka", () => {
  const shifts = [
    ...xl106Week(W1),
    ...offWeek(W2), ...offWeek("2026-08-31"), ...offWeek("2026-09-07"), ...offWeek("2026-09-14"),
  ];
  const start = pragueToUTC("2026-08-21", 10); // pátek 10:00, k dispozici jen 12h
  const r = expandPrintTime("XL_106", start, 40 * 60, shifts, NO_CD);
  assert.deepEqual(r, { ok: false, reason: "HORIZON_EXCEEDED" });
});

test("hranice: end přesně na začátku odstávky nevkládá pauzu", () => {
  const start = pragueToUTC("2026-08-21", 21, 30); // pátek 21:30, poslední slot před 22:00
  const r = expandPrintTime("XL_106", start, 30, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime(), pragueToUTC("2026-08-21", 22).getTime());
  assert.equal(r.segments.length, 1);
});

test("DST fall-back: printMinutes = reálné minuty (24/7 stroj, noc s 25 hodinami)", () => {
  // 25. 10. 2026 = konec letního času (03:00 → 02:00)
  const wk = "2026-10-19";
  const shifts247 = [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(wk, d, { m: true, a: true, n: true }));
  const start = pragueToUTC("2026-10-24", 20); // sobota 20:00
  const r = expandPrintTime("XL_106", start, 12 * 60, shifts247, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.end.getTime() - start.getTime(), 12 * 3600000); // reálných 12 h
  assert.equal(utcToPragueHour(r.end), 7); // civilně 07:00 (kvůli hodině navíc)
});

test("start přesně na konci odstávky (Ne 22:00) je runnable", () => {
  const start = pragueToUTC("2026-08-23", 22); // neděle 22:00
  const r = expandPrintTime("XL_106", start, 4 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.segments.length, 1);
});
```

- [ ] **Step 2: Testy zelené**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: PASS 12/12.

- [ ] **Step 3: Celá suite + build**

Run:
```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --test --import tsx src/lib/pasteTarget.test.ts
node --test --import tsx src/lib/clipboardCopy.test.ts
node --test --import tsx src/lib/printTime.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
npm run build
```
Expected: vše zelené (37 stávajících + 12 nových), build 0 chyb.

- [ ] **Step 4: Zapsat test do CLAUDE.md**

V sekci „Spuštění testů" přidat řádek:

```bash
node --test --import tsx src/lib/printTime.test.ts              # 12 testů
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/printTime.test.ts CLAUDE.md
git commit -m "test(core): edge-cases expandPrintTime — horizont, hranice odstávky, DST"
```

---

## Po dokončení plánu

Checkpoint pro Vojtu (feedback_implementation_pace): shrnout výsledek, ukázat testy, počkat na OK. Teprve pak vzniká Plán 2 (Etapa 3 — server: validace, POST/PUT/batch, snap start-only, chain push s re-expanzí, limit 40 h).
