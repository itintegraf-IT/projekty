# Pracovní doba — Hardening Sprint (pre-production)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sjednotit NIGHT wrap na forward semantic napříč celým runtime, uzavřít bezpečnostní mezery (NIGHT duration check, force audit, audit column overflow) a vyčistit tech debt před pushem na main.

**Architecture:** Centrální funkce `isDateTimeActive(machine, dateStr, hourMin, weekShifts)` s forward semantic (NIGHT den X → tail [0, end) na dni X+1). Původní `isHourActive(hour, row)` se zruší ve prospěch nové funkce. Validátor, snap, report i UI grid použijí stejný zdroj pravdy. Rate limiter + TOCTOU refaktor na API. DRY extrakce konstant a formátovačů. Squash commitů před pushem.

**Tech Stack:** Next.js 16, React 18, TypeScript 5, Prisma 5, MySQL, node --test (tsx), Tailwind v4.

---

## Scope poznámka

Forward semantic se dotýká několika souborů, ale jde o **jeden logicky propojený refactor** — je správné ho udržet v jednom sprintu/plánu, protože rozdělení by zanechalo runtime v nekonzistentním stavu. Ostatní fáze (tech debt, operational) jsou relativně nezávislé, ale drží se v tomto plánu pro pohodlí.

## File Structure

### Nové / změněné soubory v pořadí dotčení

| Fáze | Soubor | Role |
|---|---|---|
| 1 | `src/lib/shifts.ts` | Přidat `isDateTimeActive`. Opravit `defEnd` logiku, přesunout import nahoru, smazat cringe komentář. |
| 1 | `src/lib/shifts.test.ts` | Nové testy pro forward semantic; staré testy pro `isHourActive` odstranit/migrovat. |
| 1 | `src/lib/scheduleValidation.ts` | `checkScheduleViolationWithTemplates` použije `isDateTimeActive`. Zahodit legacy pole v `DayScheduleRow`. |
| 1 | `src/lib/scheduleValidation.test.ts` | Nové testy pro cross-midnight bloky (pondělí NIGHT ✓, sobota NIGHT ✗ atd.). |
| 1 | `src/lib/workingTime.ts` | `isBlockedSlotDynamic` použije `isDateTimeActive`. |
| 1 | `src/lib/reportMetrics.ts` | `computeAvailableHours` — NIGHT wrap započítá tail dni X+1 (day X jen [start, 1440), day X+1 [0, end)). |
| 1 | `src/lib/reportMetrics.test.ts` | Nový test: Ne NIGHT ✓, Po vše ✗ → Ne přispívá 2h (22-24), Po přispívá 6h (0-6). |
| 1 | `src/app/_components/TimelineGrid.tsx` | Refaktor overlay a handle emisí na `resolveDayIntervals` (čisté forward bez manual tail injection). |
| 2 | `src/app/api/machine-week-shifts/route.ts` | NIGHT duration check, force=1 audit flag, centralizovat `SHIFT_RANGES` import. |
| 2 | `src/lib/shifts.ts` | Přidat `SHIFT_EDIT_RANGES`, `fmtHHMM`, `defaultShiftMin` (extrakce DRY). |
| 2 | `src/components/admin/ShiftHoursPopover.tsx` | Import `SHIFT_EDIT_RANGES`, `fmtHHMM` místo lokálních definic. |
| 2 | `src/components/admin/MachineWorkHoursWeek.tsx` | Import `fmtHHMM`. Combine `editingOverride` + `popoverAnchor` do jednoho state. |
| 2 | `src/app/_components/PlannerPage.tsx` | Typ `pendingPayload.days: ShiftDayPayload[]` místo `unknown[]`. |
| 2 | `src/components/planner/ShiftEdgeHandles.tsx` | **Nový** — extrahovaná komponenta pro handle emise z TimelineGrid. |
| 2 | `src/components/planner/ShiftEdgeHandles.test.tsx` | **Nový** — unit testy emise handlů. |
| 2 | `src/lib/findConflictingBlocks.ts` | **Nový** — extrakce cascade detection z `route.ts` pro testovatelnost. |
| 2 | `src/lib/findConflictingBlocks.test.ts` | **Nový** — unit testy pro cascade detection. |
| 3 | `src/lib/rateLimiter.ts` | **Nový** — sdílený in-memory rate limiter (extrahovat z `login/route.ts`). |
| 3 | `src/app/api/auth/login/route.ts` | Migrovat na sdílený `rateLimiter`. |
| 3 | `src/app/api/machine-week-shifts/route.ts` | Přidat rate limit (60 req/min per user). |
| 3 | `prisma/migrations/20260420XXXXXX_audit_log_text_value/migration.sql` | **Nová migrace** — `AuditLog.oldValue`/`newValue` z `VARCHAR(191)` na `TEXT`. |
| 3 | `prisma/schema.prisma` | Upravit `@db.Text` anotace. |

### Commits plán (cílový stav po squash)

```
1. feat(pracovni-doba): forward-semantic NIGHT wrap (shifts + validator + snap + report + UI)
2. feat(pracovni-doba): NIGHT duration sanity check v API
3. feat(pracovni-doba): force=1 cascade audit flag
4. refactor(pracovni-doba): DRY SHIFT_EDIT_RANGES + fmtHHMM do lib/shifts
5. refactor(pracovni-doba): extract ShiftEdgeHandles komponenta + testy
6. refactor(pracovni-doba): extract findConflictingBlocks + testy
7. feat(api): shared rateLimiter + PUT machine-week-shifts rate limit
8. chore(db): AuditLog.oldValue/newValue VARCHAR(191) → TEXT
9. chore(pracovni-doba): cleanup (imports, dead fields, typy, state merge)
```

---

# Fáze 1 — Forward semantic NIGHT wrap (blokátor)

> **Proč první:** UI ukazuje forward, runtime validátor ukazuje same-day → user vidí blok v aktivním čase ale uložení selže s chybou. Musí být vyřešeno před dalšími změnami, aby testy drží na stabilním základě.

## Task 1.1: Nová funkce `isDateTimeActive` — TDD

**Files:**
- Modify: `src/lib/shifts.ts`
- Test: `src/lib/shifts.test.ts`

- [ ] **Step 1: Přidat test — aktivní MORNING+AFTERNOON na stejném dni**

Přidat do `src/lib/shifts.test.ts` na konec souboru:

```ts
// --- isDateTimeActive — forward semantic NIGHT wrap ---

import type { MachineWeekShiftsRow } from "./machineWeekShifts";

function mkRow(dow: number, flags: Partial<MachineWeekShiftsRow> = {}): MachineWeekShiftsRow {
  return {
    id: undefined,
    machine: "XL_106",
    weekStart: "2026-04-20",
    dayOfWeek: dow,
    isActive: Boolean(flags.morningOn || flags.afternoonOn || flags.nightOn),
    morningOn: false, afternoonOn: false, nightOn: false,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
    ...flags,
  };
}

test("isDateTimeActive — MORNING+AFTERNOON, po 10:00 → active", () => {
  const rows = [mkRow(1, { morningOn: true, afternoonOn: true })]; // 2026-04-20 = pondělí
  assert.equal(isDateTimeActive("XL_106", "2026-04-20", 10 * 60, rows), true);
});

test("isDateTimeActive — MORNING only, po 15:00 → inactive", () => {
  const rows = [mkRow(1, { morningOn: true })];
  assert.equal(isDateTimeActive("XL_106", "2026-04-20", 15 * 60, rows), false);
});
```

- [ ] **Step 2: Spustit test — očekáváme FAIL**

```bash
node --test --import tsx src/lib/shifts.test.ts 2>&1 | tail -20
```
Expected: `isDateTimeActive is not defined`.

- [ ] **Step 3: Přidat minimální implementaci** do `src/lib/shifts.ts` na konec souboru:

```ts
import { weekStartStrFromDateStr } from "./machineWeekShifts";

/**
 * Je daný okamžik aktivní podle forward semantic?
 *
 * Forward semantic: NIGHT flag dne X znamená směnu od X 22:00 do X+1 06:00.
 * Takže pondělí 00–06 je aktivní PRÁVĚ TEHDY, když neděle měla NIGHT ✓.
 * Pondělí 22–24 je aktivní právě tehdy, když PONDĚLÍ má NIGHT ✓.
 *
 * @param machine  stroj
 * @param dateStr  civil date YYYY-MM-DD (Europe/Prague)
 * @param hourMin  minuta od půlnoci dne `dateStr` (0–1439)
 * @param weekShifts  sjednocený seznam řádků přes týdny (client-side cache)
 */
export function isDateTimeActive(
  machine: string,
  dateStr: string,
  hourMin: number,
  weekShifts: MachineWeekShiftsRow[],
): boolean {
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  const weekStart = weekStartStrFromDateStr(dateStr);
  const row = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dow,
  );
  if (row && row.isActive) {
    // MORNING + AFTERNOON: neprekračují půlnoc.
    for (const shift of ["MORNING", "AFTERNOON"] as const) {
      const b = resolveShiftBounds(row, shift);
      if (b && hourMin >= b.startMin && hourMin < b.endMin) return true;
    }
    // NIGHT dne X pokrývá jen [startMin, 1440) na dni X.
    const night = resolveShiftBounds(row, "NIGHT");
    if (night && night.endMin < night.startMin && hourMin >= night.startMin) return true;
  }
  // Tail z předchozího dne: NIGHT(X-1) pokrývá [0, prevNightEnd) na dni X.
  const prevDateStr = (() => {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const prevDow = new Date(prevDateStr + "T12:00:00Z").getUTCDay();
  const prevWeekStart = weekStartStrFromDateStr(prevDateStr);
  const prev = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === prevWeekStart && w.dayOfWeek === prevDow,
  );
  if (prev && prev.isActive && prev.nightOn) {
    const b = resolveShiftBounds(prev, "NIGHT");
    if (b && b.endMin < b.startMin && hourMin < b.endMin) return true;
  }
  return false;
}
```

- [ ] **Step 4: Spustit test — PASS**

```bash
node --test --import tsx src/lib/shifts.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: Přidat test pro NIGHT wrap forward**

```ts
test("isDateTimeActive — Ne NIGHT ✓, Po vše ✗ → Po 02:00 active (tail z neděle)", () => {
  const sunday = mkRow(0, { nightOn: true });        // 2026-04-19 neděle
  const monday = mkRow(1);                            // 2026-04-20 pondělí, vše off
  const rows = [
    { ...sunday, weekStart: "2026-04-13" },           // neděle patří do týdne začínajícího pondělím 2026-04-13
    { ...monday, weekStart: "2026-04-20" },
  ];
  // Pondělí 02:00 = 120 minut
  assert.equal(isDateTimeActive("XL_106", "2026-04-20", 120, rows), true);
});

test("isDateTimeActive — Ne NIGHT ✓, Po vše ✗ → Ne 02:00 NEactive (not same-day wrap)", () => {
  const sunday = mkRow(0, { nightOn: true });
  const rows = [{ ...sunday, weekStart: "2026-04-13" }];
  // Neděle 02:00
  assert.equal(isDateTimeActive("XL_106", "2026-04-19", 120, rows), false);
});

test("isDateTimeActive — Ne NIGHT ✗, Po MORNING ✓ → Po 02:00 NEactive (gap)", () => {
  const monday = mkRow(1, { morningOn: true });
  const rows = [{ ...monday, weekStart: "2026-04-20" }];
  assert.equal(isDateTimeActive("XL_106", "2026-04-20", 120, rows), false);
});

test("isDateTimeActive — Po NIGHT ✓, Po 22:30 → active (NIGHT startMin je 22:00)", () => {
  const monday = mkRow(1, { nightOn: true });
  const rows = [{ ...monday, weekStart: "2026-04-20" }];
  assert.equal(isDateTimeActive("XL_106", "2026-04-20", 22 * 60 + 30, rows), true);
});

test("isDateTimeActive — override NIGHT end na 05:00, pátek NIGHT ✓ → sobota 05:30 inactive", () => {
  const friday = mkRow(5, { nightOn: true, nightEndMin: 300 }); // end 05:00
  const rows = [{ ...friday, weekStart: "2026-04-20" }];
  // 2026-04-25 = sobota
  assert.equal(isDateTimeActive("XL_106", "2026-04-25", 5 * 60 + 30, rows), false);
});
```

- [ ] **Step 6: Spustit testy — všechny PASS**

```bash
node --test --import tsx src/lib/shifts.test.ts 2>&1 | tail -30
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/shifts.ts src/lib/shifts.test.ts
git commit -m "feat(pracovni-doba): isDateTimeActive s forward-semantic NIGHT wrap

Nová funkce v shifts.ts, která pracuje s celým weekShifts polem
a zahrnuje prev-day NIGHT tail. 5 unit testů pokrývá cross-midnight
edge cases (Ne NIGHT → Po 00-06, gap mezi NIGHT a MORNING, override end).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.2: `scheduleValidation.ts` používá `isDateTimeActive`

**Files:**
- Modify: `src/lib/scheduleValidation.ts:140`
- Test: `src/lib/scheduleValidation.test.ts`

- [ ] **Step 1: Přidat failing test do `src/lib/scheduleValidation.test.ts`**

```ts
test("checkScheduleViolationWithTemplates — Ne NIGHT ✓, Po vše ✗, blok Ne 22:00 → Po 05:00 → valid (forward)", () => {
  const rows: MachineWeekShiftsRow[] = [
    { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: true,
      morningOn: false, afternoonOn: false, nightOn: true,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
    { id: undefined, machine: "XL_106", weekStart: "2026-04-20", dayOfWeek: 1, isActive: false,
      morningOn: false, afternoonOn: false, nightOn: false,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
  ];
  const start = new Date("2026-04-19T20:00:00.000Z"); // Ne 22:00 Prague (CEST je UTC+2)
  const end = new Date("2026-04-20T03:00:00.000Z");   // Po 05:00 Prague
  const result = checkScheduleViolationWithTemplates("XL_106", start, end, rows);
  assert.equal(result, null, "Blok přes půlnoc z Ne NIGHT na Po tail musí projít");
});

test("checkScheduleViolationWithTemplates — Po NIGHT ✓, Ne vše ✗, blok Ne 23:00 → Po 02:00 → VIOLATION", () => {
  const rows: MachineWeekShiftsRow[] = [
    { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: false,
      morningOn: false, afternoonOn: false, nightOn: false,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
    { id: undefined, machine: "XL_106", weekStart: "2026-04-20", dayOfWeek: 1, isActive: true,
      morningOn: false, afternoonOn: false, nightOn: true,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
  ];
  const start = new Date("2026-04-19T21:00:00.000Z"); // Ne 23:00 Prague
  const end = new Date("2026-04-20T00:00:00.000Z");   // Po 02:00 Prague
  const result = checkScheduleViolationWithTemplates("XL_106", start, end, rows);
  assert.notEqual(result, null, "Ne NIGHT ✗ → 23:00 musí být VIOLATION i když Po NIGHT ✓");
});
```

- [ ] **Step 2: Spustit testy — očekáváme FAIL (druhý test)**

```bash
node --test --import tsx src/lib/scheduleValidation.test.ts 2>&1 | tail -20
```
Expected: druhý test fail — current same-day logika by tvrdila že Ne 23:00 je OK (protože Po NIGHT mapuje tail na stejný den).

- [ ] **Step 3: Refaktorovat `checkScheduleViolationWithTemplates`**

Nahradit řádky 115-146 v `src/lib/scheduleValidation.ts`:

```ts
export function checkScheduleViolationWithTemplates(
  machine: string,
  startTime: Date,
  endTime: Date,
  weekShifts: MachineWeekShiftsRow[]
): string | null {
  const SLOT_MS = 30 * 60 * 1000;
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(cur);
    const hourMin = hour * 60 + minute;
    const weekStart = weekStartStrFromDateStr(dateStr);

    // Pokud pro stroj+týden nejsou VŮBEC žádné řádky → hardcoded fallback.
    const hasAnyRowForWeek = weekShifts.some(
      (w) => w.machine === machine && w.weekStart === weekStart,
    );
    if (!hasAnyRowForWeek) {
      if (isHardcodedBlocked(machine, dayOfWeek, slot)) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    } else if (!isDateTimeActive(machine, dateStr, hourMin, weekShifts)) {
      return "Blok zasahuje do doby mimo provoz stroje.";
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}
```

Upravit import nahoře souboru:

```ts
import { pragueOf } from "./dateUtils";
import { deriveHoursFromShifts, resolveShiftBounds, isDateTimeActive } from "./shifts";
import { type MachineWeekShiftsRow, weekStartStrFromDateStr } from "./machineWeekShifts";
import { slotFromHourBoundary } from "./timeSlots";
```

- [ ] **Step 4: Spustit testy — PASS**

```bash
node --test --import tsx src/lib/scheduleValidation.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: Ověřit, že žádný jiný test neregresoval**

```bash
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts 2>&1 | tail -30
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/scheduleValidation.ts src/lib/scheduleValidation.test.ts
git commit -m "feat(pracovni-doba): validator používá isDateTimeActive (forward semantic)

checkScheduleViolationWithTemplates nyní správně řeší cross-midnight
bloky: Ne NIGHT ✓ povolí blok Ne 22:00 → Po 06:00. Po NIGHT ✓ nepovolí
blok Ne 23:00 → Po 02:00 (předtím same-day tvrdilo OK, byl to bug).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.3: `workingTime.ts` používá `isDateTimeActive`

**Files:**
- Modify: `src/lib/workingTime.ts:9-27`

- [ ] **Step 1: Refaktorovat `isBlockedSlotDynamic` a související**

Nahradit řádky 9-27 v `src/lib/workingTime.ts`:

```ts
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";
import { isHardcodedBlocked } from "@/lib/scheduleValidation";
import { isDateTimeActive } from "@/lib/shifts";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";

const SLOT_MS = 30 * 60 * 1000;

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  weekShifts: MachineWeekShiftsRow[]
): boolean {
  const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(date);
  const weekStart = weekStartStrFromDateStr(dateStr);
  const hasAnyRowForWeek = weekShifts.some(
    (w) => w.machine === machine && w.weekStart === weekStart,
  );
  if (!hasAnyRowForWeek) return isHardcodedBlocked(machine, dayOfWeek, slot);
  return !isDateTimeActive(machine, dateStr, hour * 60 + minute, weekShifts);
}
```

Poté smazat import `resolveScheduleRows` (už nepotřeba) — řádek 4 `import { isHardcodedBlocked, resolveScheduleRows, type DayScheduleRow } from "@/lib/scheduleValidation";` → `import { isHardcodedBlocked } from "@/lib/scheduleValidation";`.

Pak v `blockOverlapsBlockedTimeWithTemplates`, `getBlockedPeriodEndWithTemplates`, `snapToNextValidStartWithTemplates` odstranit parametr `cache` a `scheduleCache` (už nejsou potřeba — per-slot volání je levné). Nahradit (řádky 31-64):

```ts
type BlockRef = { machine: string; originalStart: Date; originalEnd: Date };

function blockOverlapsBlockedTimeWithTemplates(
  machine: string,
  start: Date,
  end: Date,
  weekShifts: MachineWeekShiftsRow[]
): boolean {
  let cur = new Date(start.getTime());
  while (cur < end) {
    if (isBlockedSlotDynamic(machine, cur, weekShifts)) return true;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return false;
}

function getBlockedPeriodEndWithTemplates(
  machine: string,
  blockedPoint: Date,
  weekShifts: MachineWeekShiftsRow[]
): Date {
  let cur = new Date(blockedPoint.getTime());
  while (true) {
    if (!isBlockedSlotDynamic(machine, cur, weekShifts)) break;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return cur;
}
```

A v `snapToNextValidStartWithTemplates` smazat `scheduleCache` (řádek 73) a předání `cache` parametrů (řádky 76, 80, 85).

- [ ] **Step 2: Spustit test suite**

```bash
node --test --import tsx src/lib/dateUtils.test.ts 2>&1 | tail -5
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts 2>&1 | tail -10
```
Expected: všechny zelené.

- [ ] **Step 3: Ověřit build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -20
```
Expected: prázdný výstup (kromě pre-existing `overlapCheck.test.ts` errors).

- [ ] **Step 4: Commit**

```bash
git add src/lib/workingTime.ts
git commit -m "feat(pracovni-doba): snap helpers používají isDateTimeActive

workingTime.ts přestal cachovat DayScheduleRow — nová funkce
isDateTimeActive stačí s weekShifts polem. Forward semantic
propsaná do snap/overlap detekce.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.4: `reportMetrics.ts` — forward-aware `computeAvailableHours`

**Files:**
- Modify: `src/lib/reportMetrics.ts:36-67`
- Test: `src/lib/reportMetrics.test.ts`

- [ ] **Step 1: Přidat failing test**

Přidat do `src/lib/reportMetrics.test.ts`:

```ts
test("computeAvailableHours — Ne NIGHT ✓ Po vše ✗ → Po přispívá 6h (tail), Ne přispívá 2h (22-24)", () => {
  const weekShifts: MachineWeekShiftsRow[] = [
    { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: true,
      morningOn: false, afternoonOn: false, nightOn: true,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
    { id: undefined, machine: "XL_106", weekStart: "2026-04-20", dayOfWeek: 1, isActive: false,
      morningOn: false, afternoonOn: false, nightOn: false,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
  ];
  // rozsah Ne 2026-04-19 až Po 2026-04-20
  const hours = computeAvailableHours("XL_106", "2026-04-19", "2026-04-20", weekShifts);
  assert.equal(hours, 8, "Ne 22-24 (2h) + Po 00-06 (6h) = 8h");
});
```

- [ ] **Step 2: Spustit test — FAIL**

```bash
node --test --import tsx src/lib/reportMetrics.test.ts 2>&1 | tail -10
```
Expected: fail, current code vrací 8h ale v jiném dni — Ne vrátí 8h (NIGHT span 22-06 = 8h same-day), Po vrátí 0h. Celkem 8h je náhodou stejné číslo, ale **per-day distribution** je chybná. Takže test PASS v totalu! Musíme být chytřejší — testovat per-day distribuci.

Předělat test na:

```ts
test("computeAvailableHours — Ne NIGHT ✓, jen Ne v rozsahu → 2h (jen 22-24 část)", () => {
  const weekShifts: MachineWeekShiftsRow[] = [
    { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: true,
      morningOn: false, afternoonOn: false, nightOn: true,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
  ];
  const hours = computeAvailableHours("XL_106", "2026-04-19", "2026-04-19", weekShifts);
  assert.equal(hours, 2, "Ne NIGHT přispívá jen 2h (22-24) na dni Ne; tail patří Po");
});

test("computeAvailableHours — Ne NIGHT ✓ + Po vše ✗, jen Po v rozsahu → 6h (tail z neděle)", () => {
  const weekShifts: MachineWeekShiftsRow[] = [
    { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: true,
      morningOn: false, afternoonOn: false, nightOn: true,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
    { id: undefined, machine: "XL_106", weekStart: "2026-04-20", dayOfWeek: 1, isActive: false,
      morningOn: false, afternoonOn: false, nightOn: false,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
  ];
  const hours = computeAvailableHours("XL_106", "2026-04-20", "2026-04-20", weekShifts);
  assert.equal(hours, 6, "Po dostane tail z Ne NIGHT (6h)");
});
```

Tyto dva testy **zachytí bug** v současné implementaci (která by v prvním testu vrátila 8h místo 2h, ve druhém 0h místo 6h).

- [ ] **Step 3: Spustit testy — FAIL na obou**

```bash
node --test --import tsx src/lib/reportMetrics.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Refaktor `computeAvailableHours`**

Nahradit řádky 36-67 v `src/lib/reportMetrics.ts`:

```ts
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
): number {
  let totalMin = 0;
  let cur = rangeStart;

  while (cur <= rangeEnd) {
    const weekStart = weekStartStrFromDateStr(cur);
    const dayOfWeek = new Date(cur + "T12:00:00Z").getUTCDay();
    const row = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek,
    );
    if (row && row.isActive) {
      // MORNING + AFTERNOON celé (neprekračují půlnoc).
      for (const shift of ["MORNING", "AFTERNOON"] as const) {
        const b = resolveShiftBounds(row, shift);
        if (b) totalMin += b.endMin - b.startMin;
      }
      // NIGHT: jen [startMin, 1440) dnes.
      const night = resolveShiftBounds(row, "NIGHT");
      if (night && night.endMin < night.startMin) {
        totalMin += 1440 - night.startMin;
      }
    }
    // Tail z PŘEDCHOZÍHO dne: NIGHT(X-1) přispívá [0, prevEnd) dni X.
    const prevDate = (() => {
      const d = new Date(cur + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const prevWeekStart = weekStartStrFromDateStr(prevDate);
    const prevDow = new Date(prevDate + "T12:00:00Z").getUTCDay();
    const prev = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === prevWeekStart && w.dayOfWeek === prevDow,
    );
    if (prev && prev.isActive && prev.nightOn) {
      const b = resolveShiftBounds(prev, "NIGHT");
      if (b && b.endMin < b.startMin) totalMin += b.endMin;
    }
    cur = addDaysToCivilDate(cur, 1);
  }

  return totalMin / 60;
}
```

- [ ] **Step 5: Spustit testy — PASS**

```bash
node --test --import tsx src/lib/reportMetrics.test.ts 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "feat(pracovni-doba): computeAvailableHours s forward NIGHT wrap

NIGHT dne X přispívá 2h na dni X (22-24) a 6h na dni X+1 (0-6),
místo 8h cele na dni X. Aktualizace reportovacího dashboardu.
2 nové testy ověřují per-day distribuci.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.5: `TimelineGrid.tsx` — zjednodušit na `resolveDayIntervals`

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`
- Modify: `src/lib/scheduleValidation.ts`

> **Proč:** Aktuálně má TimelineGrid ručně injektovaný prev-day NIGHT tail (moje včerejší oprava). Chceme to mít centralizované tak, aby `resolveScheduleRows` vracelo přímo forward-semantic intervaly (včetně tailu z prev-day). Tím zmizí duplicita v TimelineGrid overlay + handle loops.

- [ ] **Step 1: Přidat helper `resolveDayIntervals` do `src/lib/scheduleValidation.ts`**

Přidat na konec `src/lib/scheduleValidation.ts`:

```ts
/**
 * Forward-semantic intervaly pro daný den.
 * Vrací intervaly, které se REÁLNĚ zobrazí v sloupci dne X:
 *  - MORNING/AFTERNOON z X (bez wrap)
 *  - NIGHT(X) jen [startMin, 1440)
 *  - NIGHT(X-1) tail [0, prevEnd) — pokud X-1 měl NIGHT ✓
 *
 * Všechny intervaly jsou non-wrapping s endMin ≤ 1440.
 */
export function resolveDayIntervals(
  machine: string,
  dateStr: string,
  weekShifts: MachineWeekShiftsRow[],
): Array<{ shift: "MORNING" | "AFTERNOON" | "NIGHT"; startMin: number; endMin: number; source: "current" | "prev-tail" }> {
  const out: Array<{ shift: "MORNING" | "AFTERNOON" | "NIGHT"; startMin: number; endMin: number; source: "current" | "prev-tail" }> = [];
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  const weekStart = weekStartStrFromDateStr(dateStr);
  const row = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dow,
  );
  if (row && row.isActive) {
    for (const shift of ["MORNING", "AFTERNOON"] as const) {
      const b = resolveShiftBounds(row, shift);
      if (b) out.push({ shift, startMin: b.startMin, endMin: b.endMin, source: "current" });
    }
    const night = resolveShiftBounds(row, "NIGHT");
    if (night && night.endMin < night.startMin) {
      out.push({ shift: "NIGHT", startMin: night.startMin, endMin: 1440, source: "current" });
    }
  }
  const prevDate = (() => {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const prevDow = new Date(prevDate + "T12:00:00Z").getUTCDay();
  const prevWeekStart = weekStartStrFromDateStr(prevDate);
  const prev = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === prevWeekStart && w.dayOfWeek === prevDow,
  );
  if (prev && prev.isActive && prev.nightOn) {
    const b = resolveShiftBounds(prev, "NIGHT");
    if (b && b.endMin < b.startMin && b.endMin > 0) {
      out.push({ shift: "NIGHT", startMin: 0, endMin: b.endMin, source: "prev-tail" });
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}
```

Importy také zahrnout `resolveShiftBounds` pokud tam ještě není (ano, je tam line 2).

- [ ] **Step 2: Přidat unit test**

Do `src/lib/scheduleValidation.test.ts`:

```ts
test("resolveDayIntervals — Po MORNING+AFTERNOON → 2 current intervaly", () => {
  const rows: MachineWeekShiftsRow[] = [
    { id: undefined, machine: "XL_106", weekStart: "2026-04-20", dayOfWeek: 1, isActive: true,
      morningOn: true, afternoonOn: true, nightOn: false,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
  ];
  const intervals = resolveDayIntervals("XL_106", "2026-04-20", rows);
  assert.deepEqual(intervals, [
    { shift: "MORNING", startMin: 360, endMin: 840, source: "current" },
    { shift: "AFTERNOON", startMin: 840, endMin: 1320, source: "current" },
  ]);
});

test("resolveDayIntervals — Ne NIGHT ✓ Po vše ✗ → Po má jen prev-tail [0, 360)", () => {
  const rows: MachineWeekShiftsRow[] = [
    { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: true,
      morningOn: false, afternoonOn: false, nightOn: true,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
    { id: undefined, machine: "XL_106", weekStart: "2026-04-20", dayOfWeek: 1, isActive: false,
      morningOn: false, afternoonOn: false, nightOn: false,
      morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
      nightStartMin: null, nightEndMin: null },
  ];
  const intervals = resolveDayIntervals("XL_106", "2026-04-20", rows);
  assert.deepEqual(intervals, [
    { shift: "NIGHT", startMin: 0, endMin: 360, source: "prev-tail" },
  ]);
});
```

- [ ] **Step 3: Spustit testy — PASS**

```bash
node --test --import tsx src/lib/scheduleValidation.test.ts 2>&1 | tail -15
```

- [ ] **Step 4: Refaktor overlay v TimelineGrid.tsx (řádky ~2490-2560)**

Najít sekci `blockedOverlays` s `activeSpans` a nahradit ručně injektovaný prev-tail za volání `resolveDayIntervals`. Konkrétně sekce, která začíná `const activeSpans: Array<[number, number]> = [];`:

```tsx
// Forward-semantic intervaly včetně prev-day tail (single source of truth).
const intervals = resolveDayIntervals(machine, dateStr, machineWeekShifts);
const activeSpans: Array<[number, number]> = [];
for (const iv of intervals) {
  // Live preview override pro aktuální den (source=current).
  if (iv.source === "current" && previewMatchesDay && preview!.shift === iv.shift) {
    const startMin = preview!.edge === "start" ? preview!.previewMin : iv.startMin;
    const endMin = preview!.edge === "end" ? preview!.previewMin : iv.endMin;
    activeSpans.push([Math.round(startMin / 30), Math.round(endMin / 30)]);
  } else {
    activeSpans.push([Math.round(iv.startMin / 30), Math.round(iv.endMin / 30)]);
  }
}
```

Odstranit ruční tail-injection blok (ten, co jsme přidali včera s `if (machineWeekShifts) { ... prev.nightOn ...}`).

Importovat `resolveDayIntervals`:

```tsx
import { resolveScheduleRows, resolveDayIntervals } from "@/lib/scheduleValidation";
```

- [ ] **Step 5: Refaktor handle emise (řádky ~2945-3000)**

Handle emission loop `{canEdit && onShiftBoundsChange && machineWeekShifts && days.map((d) => { ... })}`. Nahradit activeSlots výpočet a handleIntervals array za volání `resolveDayIntervals`:

```tsx
const intervals = resolveDayIntervals(machine, d.dateStr, machineWeekShifts);
const activeSlots = new Set<number>();
for (const iv of intervals) {
  const s = Math.round(iv.startMin / 30);
  const e = Math.round(iv.endMin / 30);
  for (let i = s; i < e; i++) activeSlots.add(i);
}
const isSlotBlocked = (slot: number): boolean => {
  if (slot < 0 || slot >= DAY_SLOT_COUNT) return false;
  return !activeSlots.has(slot);
};

// HandleInterval: vlastník (ownerDate) = den, jehož DB řádek handle edituje.
type HandleInterval = {
  shift: "MORNING" | "AFTERNOON" | "NIGHT";
  startMin: number; endMin: number;
  emitStart: boolean; emitEnd: boolean;
  ownerDate: Date; ownerDateStr: string;
};
const handleIntervals: HandleInterval[] = intervals.map((iv) => {
  if (iv.source === "prev-tail") {
    // prev-tail: emitujeme jen END handle; edituje NIGHT end předchozího dne.
    const prev = new Date(d.date.getTime() - 24 * 60 * 60 * 1000);
    return {
      shift: iv.shift, startMin: iv.startMin, endMin: iv.endMin,
      emitStart: false, emitEnd: true,
      ownerDate: prev, ownerDateStr: utcToPragueDateStr(prev),
    };
  }
  // current: NIGHT má jen start (end patří next day), ostatní mají obojí.
  const isNight = iv.shift === "NIGHT";
  return {
    shift: iv.shift, startMin: iv.startMin, endMin: iv.endMin,
    emitStart: true, emitEnd: !isNight,
    ownerDate: d.date, ownerDateStr: d.dateStr,
  };
});
```

Odstranit starou sekci `for (const iv of row.intervals) { ... }` a blok `// Inject END handle z předchozího dne`.

- [ ] **Step 6: Ověřit, že `row` už nikde jinde v handle sekci není potřeba**

Vyhledat `row.intervals`, `row.isActive` v TimelineGrid handle sekci — měly by být nahrazeny intervaly z `resolveDayIntervals`. `row` proměnná může zůstat jen pokud ji potřebuje starší check `if (!row || !row.isActive) return null;`. Nahradit tím, že `if (intervals.length === 0) return null;`.

- [ ] **Step 7: Build + manuální sanity test**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -20
```

Pak uživatel manuálně:
1. Otevře dev server, neděle XL_106 s NIGHT ✓, pondělí vše ✗
2. Ověří: Ne 22-24 šrafované? NE — zobrazí se jako aktivní (bílé)
3. Ověří: Po 00-06 šrafované? NE — zobrazí se jako aktivní z Ne tailu
4. Ověří: handle na Ne 22:00 a handle na Po 06:00? ANO
5. Drag handle na Ne 22:00 na 20:00 → uloží se, Ne NIGHT startMin = 1200.
6. Drag handle na Po 06:00 na 05:00 → uloží se NIGHT **neděle** (ownerDate = Ne) endMin = 300.

- [ ] **Step 8: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/lib/scheduleValidation.ts src/lib/scheduleValidation.test.ts
git commit -m "refactor(pracovni-doba): TimelineGrid používá resolveDayIntervals

Centralizovaný zdroj pravdy pro forward-semantic intervaly na daný den.
Overlay a handle emise z ručního prev-tail injection přešly na čistou
funkci v scheduleValidation.ts. 2 nové unit testy pokrývají happy
path a prev-tail scénář.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 1.6: Smazat `isHourActive` (legacy)

**Files:**
- Modify: `src/lib/shifts.ts`
- Modify: `src/lib/shifts.test.ts`

- [ ] **Step 1: Odstranit `isHourActive` funkci**

Smazat řádky 78-93 v `src/lib/shifts.ts` (celou `isHourActive` definici).

- [ ] **Step 2: Odstranit staré testy**

Smazat v `src/lib/shifts.test.ts` testy pojmenované `isHourActive — default morning+afternoon...` až po `isHourActive — all shifts off, any hour → inactive` (6 testů).

- [ ] **Step 3: Grep: ověřit že nikdo neimportuje `isHourActive`**

```bash
```

Použít Grep tool: pattern `isHourActive`, output `content`. Expected: pouze v plánových markdown souborech (docs).

- [ ] **Step 4: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -10
```

- [ ] **Step 5: Testy**

```bash
node --test --import tsx src/lib/shifts.test.ts 2>&1 | tail -10
node --test --import tsx src/lib/scheduleValidation.test.ts 2>&1 | tail -10
node --test --import tsx src/lib/reportMetrics.test.ts 2>&1 | tail -10
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts 2>&1 | tail -10
```
Expected: vše zelené.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shifts.ts src/lib/shifts.test.ts
git commit -m "chore(pracovni-doba): smazat legacy isHourActive

Nahrazena isDateTimeActive (forward semantic) ve všech callerech.
Odstranit mrtvou funkci + 6 odpovídajících testů.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Fáze 2 — Bezpečnostní fixy (blokátor)

## Task 2.1: NIGHT duration sanity check v API

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts:278-285`

- [ ] **Step 1: Přidat validaci** po řádku 284 (za AFTERNOON check):

```ts
// NIGHT: cross-midnight. Start > end. Trvání = (1440 - start) + end.
// Rozsah 360 min (6h) až 600 min (10h) — typická noční směna.
if (nightStartMin !== null && nightEndMin !== null) {
  const duration = (1440 - nightStartMin) + nightEndMin;
  if (duration < 360 || duration > 600) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Noční směna musí trvat 6–10 hodin (zadáno ${Math.floor(duration / 60)}h ${duration % 60}m)`,
    );
  }
}
```

- [ ] **Step 2: Manuální test přes curl**

```bash
# Spustit dev server napřed
curl -X PUT 'http://localhost:3000/api/machine-week-shifts' \
  -H 'Cookie: integraf-session=<valid>' \
  -H 'Content-Type: application/json' \
  -d '{"machine":"XL_106","weekStart":"2026-04-20","days":[...,{"dayOfWeek":0,"nightOn":true,"nightStartMin":1200,"nightEndMin":480},...]}' 
```
(1200-480 = 12h — musí vrátit 400)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/machine-week-shifts/route.ts
git commit -m "fix(pracovni-doba): NIGHT duration sanity check 6-10h

Předchozí rozsahy startu [20:00-24:00] a endu [04:00-08:00] pustily
přes validaci i 12h směny (20:00-08:00). Přidán explicitní duration check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2.2: `force=1` cascade audit flag

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts:359-409`

- [ ] **Step 1: Přidat force flag do audit payloadu**

Upravit řádek 357 (`afterPayload`):

```ts
const afterPayload = `${machine} ${parsedWeek}${force ? " [FORCE]" : ""} ${afterSorted.map(encodeDay).join("|")}`;
```

Prefix `[FORCE]` je explicitní marker pro forenzní analýzu.

- [ ] **Step 2: Logger info rozšířit**

Upravit řádek 417:

```ts
logger.info("[machine-week-shifts PUT] updated", { machine, weekStart: parsedWeek, force, userId: session.id });
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/machine-week-shifts/route.ts
git commit -m "fix(pracovni-doba): force=1 cascade má explicitní audit flag

[FORCE] marker v newValue + logger.info pro forenzní dohledatelnost
uživatele, který schválil cascade konflikt.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2.3: AuditLog.oldValue/newValue — VARCHAR → TEXT migrace

**Files:**
- Create: `prisma/migrations/20260420120000_audit_log_text_value/migration.sql`
- Modify: `prisma/schema.prisma:17-18`

- [ ] **Step 1: Vytvořit migraci**

```bash
mkdir -p prisma/migrations/20260420120000_audit_log_text_value
```

Write `prisma/migrations/20260420120000_audit_log_text_value/migration.sql`:

```sql
-- Rozšíření oldValue/newValue z VARCHAR(191) na TEXT,
-- aby se vešel plný encodeDay payload (~200+ znaků pro týden s overrides).
ALTER TABLE `AuditLog` MODIFY `oldValue` TEXT NULL;
ALTER TABLE `AuditLog` MODIFY `newValue` TEXT NULL;
```

- [ ] **Step 2: Upravit schema**

V `prisma/schema.prisma` řádky 17-18 změnit:

```prisma
  oldValue    String?  @db.Text
  newValue    String?  @db.Text
```

- [ ] **Step 3: Vygenerovat Prisma client**

```bash
npx prisma generate 2>&1 | tail -5
```

- [ ] **Step 4: Aplikovat migraci na dev DB**

```bash
npx prisma migrate deploy 2>&1 | tail -10
```

- [ ] **Step 5: Build sanity**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -5
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260420120000_audit_log_text_value/
git commit -m "chore(db): AuditLog.oldValue/newValue VARCHAR(191) → TEXT

encodeDay payload pro 7 dní × 6 override polí může překročit 191 znaků.
Rozšíření na TEXT zabrání tichému oseknutí audit záznamů.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Fáze 3 — Tech debt cleanup (mělo by)

## Task 3.1: Centralizovat `SHIFT_EDIT_RANGES` a `fmtHHMM`

**Files:**
- Modify: `src/lib/shifts.ts`
- Modify: `src/app/api/machine-week-shifts/route.ts`
- Modify: `src/components/admin/ShiftHoursPopover.tsx`
- Modify: `src/components/admin/MachineWorkHoursWeek.tsx`
- Modify: `src/app/_components/TimelineGrid.tsx`

- [ ] **Step 1: Přidat konstanty do `src/lib/shifts.ts`**

Na konec souboru:

```ts
/**
 * Editační rozsahy pro override polí v minutách od půlnoci.
 * Uživatel může posunout hranici směny v tomto okně — mimo něj validace odmítne.
 */
export const SHIFT_EDIT_RANGES: Record<ShiftType, { start: readonly [number, number]; end: readonly [number, number] }> = {
  MORNING:   { start: [240, 480],  end: [720, 960] },
  AFTERNOON: { start: [720, 960],  end: [1200, 1440] },
  NIGHT:     { start: [1200, 1440], end: [240, 480] },
};

/** "630" → "10:30". Null/undefined → "". */
export function fmtHHMM(m: number | null | undefined): string {
  if (m === null || m === undefined) return "";
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Výchozí minuty pro směnu (start/end). */
export function defaultShiftMin(shift: ShiftType, edge: "start" | "end"): number {
  const def = SHIFT_HOURS[shift];
  return (edge === "start" ? def.start : def.end) * 60;
}
```

- [ ] **Step 2: Zrušit lokální definici v `route.ts`**

Smazat řádky 34-38 v `src/app/api/machine-week-shifts/route.ts` (lokální `SHIFT_RANGES`) a import:

```ts
import { SHIFT_EDIT_RANGES } from "@/lib/shifts";
```

Nahradit použití `SHIFT_RANGES.MORNING.start` → `SHIFT_EDIT_RANGES.MORNING.start` (řádky 273-278).

Smazat lokální `fmtHHMM` (řádky 324-327) → použít `import { fmtHHMM } from "@/lib/shifts";` (rozšířit existující import).

- [ ] **Step 3: Zrušit lokální definici v `ShiftHoursPopover.tsx`**

```ts
// nahradit řádky 9-19 za:
import { SHIFT_EDIT_RANGES, fmtHHMM, defaultShiftMin } from "@/lib/shifts";
```

Použití `SHIFT_RANGES` → `SHIFT_EDIT_RANGES` napříč souborem.

- [ ] **Step 4: Zrušit lokální `fmtHHMM` v `MachineWorkHoursWeek.tsx`**

Nahradit řádky 28-32 za `import { fmtHHMM } from "@/lib/shifts";`.

- [ ] **Step 5: Zrušit lokální `fmtHHMM` v `TimelineGrid.tsx`**

Nahradit lokální `fmtHHMM` / `formatHHMM` (řádky ~173-177) za import z `@/lib/shifts`.

- [ ] **Step 6: Build + testy**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -10
node --test --import tsx src/lib/shifts.test.ts 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/shifts.ts src/app/api/machine-week-shifts/route.ts src/components/admin/ src/app/_components/TimelineGrid.tsx
git commit -m "refactor(pracovni-doba): DRY SHIFT_EDIT_RANGES + fmtHHMM do lib/shifts

Odstranit 3× duplicitní SHIFT_RANGES a 3× duplicitní fmtHHMM.
Single source of truth v lib/shifts — změna rozsahu se projeví
všude (validátor, popover, timeline).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.2: Cleanup `shifts.ts` — import + `defEnd` + komentář

**Files:**
- Modify: `src/lib/shifts.ts`

- [ ] **Step 1: Přesunout import `MachineWeekShiftsRow` na začátek souboru**

Smazat řádek 54 `import type { MachineWeekShiftsRow } from "./machineWeekShifts";` a přidat ho mezi ostatní importy na začátku (po line 1 nebo před `export type ShiftType`):

```ts
import type { MachineWeekShiftsRow } from "./machineWeekShifts";
import { weekStartStrFromDateStr } from "./machineWeekShifts";

export type ShiftType = "MORNING" | "AFTERNOON" | "NIGHT";
// ...
```

Pozn.: Pokud `weekStartStrFromDateStr` import byl přidán v Task 1.1, sloučit.

- [ ] **Step 2: Zjednodušit `resolveShiftBounds`**

Nahradit řádky 57-76 (celou funkci `resolveShiftBounds`):

```ts
/** Vrátí efektivní hranice směny (null = směna OFF pro den). */
export function resolveShiftBounds(
  row: MachineWeekShiftsRow,
  shift: ShiftType
): { startMin: number; endMin: number } | null {
  const flagOn = shift === "MORNING" ? row.morningOn
               : shift === "AFTERNOON" ? row.afternoonOn
               : row.nightOn;
  if (!flagOn) return null;
  const def = SHIFT_HOURS[shift];
  const override = shift === "MORNING"
    ? { s: row.morningStartMin, e: row.morningEndMin }
    : shift === "AFTERNOON"
    ? { s: row.afternoonStartMin, e: row.afternoonEndMin }
    : { s: row.nightStartMin, e: row.nightEndMin };
  // Pro NIGHT: def.end = 6 = 360 min (záměrně — cross-midnight rozpoznává volající
  // přes porovnání endMin < startMin).
  return {
    startMin: override.s ?? def.start * 60,
    endMin:   override.e ?? def.end * 60,
  };
}
```

- [ ] **Step 3: Testy**

```bash
node --test --import tsx src/lib/shifts.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/shifts.ts
git commit -m "chore(pracovni-doba): vyčistit shifts.ts (importy, mrtvá větev defEnd)

Import MachineWeekShiftsRow přesunut na začátek souboru (import/first).
Zjednodušení resolveShiftBounds — smazána mrtvá větev pro NIGHT,
která se stejně přepsala o 2 řádky níž.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.3: `DayScheduleRow` — smazat legacy pole

**Files:**
- Modify: `src/lib/scheduleValidation.ts:6-19`
- Modify: konzumenti v `TimelineGrid.tsx`, `PlannerPage.tsx` (pokud nějací existují)

- [ ] **Step 1: Grep konzumentů legacy polí**

Pattern: `startHour|endHour|startSlot|endSlot` omezený na importy z `scheduleValidation`.

Použít Grep tool:
- pattern: `\.startHour|\.endHour|\.startSlot|\.endSlot`
- path: `src/`
- output: `content`
- -C: 2

Zmapovat, kdo je používá. Pokud žádný produkční caller, pokračovat step 2. Pokud ano, nejdřív ho refaktorovat (typicky nahradit `resolveDayIntervals`).

- [ ] **Step 2: Zjednodušit typ `DayScheduleRow`**

Nahradit řádky 6-19 v `src/lib/scheduleValidation.ts`:

```ts
export type DayScheduleRow = {
  machine: string;
  dayOfWeek: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  intervals: Array<{ shift: "MORNING" | "AFTERNOON" | "NIGHT"; startMin: number; endMin: number }>;
};
```

A upravit `resolveScheduleRows` (řádky 27-56), aby vynechalo legacy pole:

```ts
export function resolveScheduleRows(
  machine: string,
  date: Date,
  weekShifts: MachineWeekShiftsRow[]
): DayScheduleRow[] {
  const { dateStr } = pragueOf(date);
  const weekStart = weekStartStrFromDateStr(dateStr);
  const weekRows = weekShifts.filter((w) => w.machine === machine && w.weekStart === weekStart);
  return weekRows.map((w) => {
    const intervals: DayScheduleRow["intervals"] = [];
    for (const shift of ["MORNING", "AFTERNOON", "NIGHT"] as const) {
      const b = resolveShiftBounds(w, shift);
      if (b) intervals.push({ shift, startMin: b.startMin, endMin: b.endMin });
    }
    return {
      machine,
      dayOfWeek: w.dayOfWeek,
      isActive: w.isActive,
      morningOn: Boolean(w.morningOn),
      afternoonOn: Boolean(w.afternoonOn),
      nightOn: Boolean(w.nightOn),
      intervals,
    };
  });
}
```

Odstranit import `deriveHoursFromShifts` a `slotFromHourBoundary` pokud nepoužívány.

- [ ] **Step 3: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -20
```

Opravit případné TypeScript chyby o chybějících legacy polích.

- [ ] **Step 4: Testy**

```bash
node --test --import tsx src/lib/scheduleValidation.test.ts 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleValidation.ts
git commit -m "chore(pracovni-doba): smazat legacy pole z DayScheduleRow

startHour/endHour/startSlot/endSlot byly 'pro kompatibilitu' —
už žádný caller je nepoužívá. Zjednodušení typu.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.4: `plannerCascade` typ payloadu

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:517-520` a související

- [ ] **Step 1: Definovat typ `ShiftDayPayload`**

Přidat do `src/lib/machineWeekShifts.ts` nebo na začátek `PlannerPage.tsx`:

```ts
export type ShiftDayPayload = {
  dayOfWeek: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
};
```

Preferovaně do `machineWeekShifts.ts` (logicky patří k typu `MachineWeekShiftsRow`).

- [ ] **Step 2: Použít typ**

V `PlannerPage.tsx` řádky 517-520:

```ts
const [plannerCascade, setPlannerCascade] = useState<{
  conflicts: ConflictingBlock[];
  pendingPayload: { machine: string; weekStart: string; days: ShiftDayPayload[] };
} | null>(null);
```

Přidat import:

```ts
import { type MachineWeekShiftsRow, type ShiftDayPayload } from "@/lib/machineWeekShifts";
```

- [ ] **Step 3: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -10
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/machineWeekShifts.ts src/app/_components/PlannerPage.tsx
git commit -m "chore(types): plannerCascade.days: ShiftDayPayload[] místo unknown[]

Obnovit type safety — payload pro PUT má pevný tvar, neměl zůstat unknown[].

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.5: Extrakce `findConflictingBlocks` + testy

**Files:**
- Create: `src/lib/findConflictingBlocks.ts`
- Create: `src/lib/findConflictingBlocks.test.ts`
- Modify: `src/app/api/machine-week-shifts/route.ts`

- [ ] **Step 1: Extrahovat funkci**

Vytvořit `src/lib/findConflictingBlocks.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import { type MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { checkScheduleViolationWithTemplates } from "@/lib/scheduleValidation";

export type ConflictingBlock = {
  id: number;
  orderNumber: string;
  description: string | null;
  startTime: string;
  endTime: string;
};

export type WeekRowInput = {
  dayOfWeek: number;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
  isActive: boolean;
};

/**
 * Najde bloky typu ZAKAZKA/DATA/MATERIAL, které po změně pracovní doby
 * spadnou mimo aktivní intervaly.
 */
export async function findConflictingBlocks(
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
): Promise<ConflictingBlock[]> {
  const weekStartDate = civilDateToUTCMidnight(weekStartStr);
  const weekEnd = new Date(weekStartDate);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const blocks = await prisma.block.findMany({
    where: { machine, startTime: { gte: weekStartDate, lt: weekEnd } },
    select: { id: true, orderNumber: true, description: true, startTime: true, endTime: true },
  });

  const synthRows: MachineWeekShiftsRow[] = newRows.map((r) => ({
    machine, weekStart: weekStartStr, dayOfWeek: r.dayOfWeek,
    isActive: r.isActive,
    morningOn: r.morningOn, afternoonOn: r.afternoonOn, nightOn: r.nightOn,
    morningStartMin: r.morningStartMin, morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin, afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin, nightEndMin: r.nightEndMin,
  }));

  const conflicts: ConflictingBlock[] = [];
  for (const b of blocks) {
    const violation = checkScheduleViolationWithTemplates(machine, b.startTime, b.endTime, synthRows);
    if (violation) {
      conflicts.push({
        id: b.id,
        orderNumber: b.orderNumber,
        description: b.description,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      });
    }
  }
  return conflicts;
}

/**
 * Pure variant (bez Prisma) — pro unit testy.
 * Dostane bloky jako input místo je načítat z DB.
 */
export function detectConflictsPure(
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
  blocks: Array<{ id: number; orderNumber: string; description: string | null; startTime: Date; endTime: Date }>,
): ConflictingBlock[] {
  const synthRows: MachineWeekShiftsRow[] = newRows.map((r) => ({
    machine, weekStart: weekStartStr, dayOfWeek: r.dayOfWeek,
    isActive: r.isActive,
    morningOn: r.morningOn, afternoonOn: r.afternoonOn, nightOn: r.nightOn,
    morningStartMin: r.morningStartMin, morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin, afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin, nightEndMin: r.nightEndMin,
  }));

  const conflicts: ConflictingBlock[] = [];
  for (const b of blocks) {
    const violation = checkScheduleViolationWithTemplates(machine, b.startTime, b.endTime, synthRows);
    if (violation) {
      conflicts.push({
        id: b.id,
        orderNumber: b.orderNumber,
        description: b.description,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      });
    }
  }
  return conflicts;
}
```

- [ ] **Step 2: Testy**

Vytvořit `src/lib/findConflictingBlocks.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { detectConflictsPure, type WeekRowInput } from "./findConflictingBlocks";

function allOffRow(dow: number): WeekRowInput {
  return {
    dayOfWeek: dow, morningOn: false, afternoonOn: false, nightOn: false, isActive: false,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
  };
}
function morningRow(dow: number, endMin?: number): WeekRowInput {
  return { ...allOffRow(dow), morningOn: true, isActive: true, morningEndMin: endMin ?? null };
}
function weekWithRow(row: WeekRowInput): WeekRowInput[] {
  const out: WeekRowInput[] = [];
  for (let d = 0; d < 7; d++) out.push(d === row.dayOfWeek ? row : allOffRow(d));
  return out;
}

test("detectConflictsPure — blok uvnitř MORNING → není konflikt", () => {
  const rows = weekWithRow(morningRow(1)); // pondělí MORNING 6-14
  const blocks = [{
    id: 1, orderNumber: "X", description: null,
    startTime: new Date("2026-04-20T08:00:00+02:00"), // Po 08:00 Prague
    endTime:   new Date("2026-04-20T10:00:00+02:00"), // Po 10:00 Prague
  }];
  const result = detectConflictsPure("XL_106", "2026-04-20", rows, blocks);
  assert.equal(result.length, 0);
});

test("detectConflictsPure — blok přes override end → konflikt", () => {
  // MORNING Po zkrácené na 13:00 (override end 780)
  const rows = weekWithRow(morningRow(1, 780));
  const blocks = [{
    id: 42, orderNumber: "Y", description: "foo",
    startTime: new Date("2026-04-20T12:00:00+02:00"), // Po 12:00
    endTime:   new Date("2026-04-20T14:00:00+02:00"), // Po 14:00 — překročí 13:00 end
  }];
  const result = detectConflictsPure("XL_106", "2026-04-20", rows, blocks);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 42);
});

test("detectConflictsPure — cross-midnight blok Ne NIGHT ✓ → Po 05:00 → není konflikt (forward)", () => {
  const rows: WeekRowInput[] = [];
  for (let d = 0; d < 7; d++) {
    if (d === 0) rows.push({ ...allOffRow(0), nightOn: true, isActive: true });
    else rows.push(allOffRow(d));
  }
  const blocks = [{
    id: 7, orderNumber: "N", description: null,
    startTime: new Date("2026-04-19T22:00:00+02:00"), // Ne 22:00
    endTime:   new Date("2026-04-20T05:00:00+02:00"), // Po 05:00
  }];
  const result = detectConflictsPure("XL_106", "2026-04-13", rows, blocks);
  assert.equal(result.length, 0, "forward semantic: Ne NIGHT pokrývá Po 0-6 jako tail");
});
```

- [ ] **Step 3: Spustit testy**

```bash
node --test --import tsx src/lib/findConflictingBlocks.test.ts 2>&1 | tail -10
```

- [ ] **Step 4: Přepnout `route.ts` na import**

V `src/app/api/machine-week-shifts/route.ts`:
- Smazat lokální `async function findConflictingBlocks` (řádky 155-201).
- Smazat typ `ConflictingBlock` (řádek 149).
- Přidat import: `import { findConflictingBlocks, type ConflictingBlock } from "@/lib/findConflictingBlocks";`

- [ ] **Step 5: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -10
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/findConflictingBlocks.ts src/lib/findConflictingBlocks.test.ts src/app/api/machine-week-shifts/route.ts
git commit -m "refactor(pracovni-doba): extract findConflictingBlocks + testy

Cascade detection extrahována z API route do testovatelné utility.
3 unit testy: happy path, override end konflikt, cross-midnight forward.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.6: Extrakce `ShiftEdgeHandles` komponenty

**Files:**
- Create: `src/components/planner/ShiftEdgeHandles.tsx`
- Modify: `src/app/_components/TimelineGrid.tsx`

- [ ] **Step 1: Vytvořit komponentu**

Write `src/components/planner/ShiftEdgeHandles.tsx`:

```tsx
"use client";

import { Fragment, type RefObject } from "react";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { resolveDayIntervals } from "@/lib/scheduleValidation";
import { utcToPragueDateStr } from "@/lib/dateUtils";
import { DAY_SLOT_COUNT } from "@/lib/timeSlots";
import { fmtHHMM } from "@/lib/shifts";
import type { ShiftType } from "@/lib/shifts";

type ShiftEdge = "start" | "end";
type ShiftEdgePreview = {
  machine: string;
  date: Date;
  shift: ShiftType;
  edge: ShiftEdge;
  previewMin: number;
};
type DragState = {
  type: "shift-edge-resize";
  machine: string;
  date: Date;
  shift: ShiftType;
  edge: ShiftEdge;
  origMin: number;
  startClientY: number;
  startScrollTop: number;
  jointDrag: boolean;
};

export type ShiftEdgeHandlesProps = {
  machine: string;
  day: { date: Date; dateStr: string; y: number };
  slotHeight: number;
  machineWeekShifts: MachineWeekShiftsRow[];
  preview: ShiftEdgePreview | null;
  dragStateRef: RefObject<DragState | null>;
  dragDidMoveRef: RefObject<boolean>;
  scrollRef: RefObject<HTMLDivElement | null>;
  onReset: (machine: string, ownerDate: Date, shift: ShiftType, edge: ShiftEdge) => void;
};

const HANDLE_STYLE = {
  position: "absolute" as const,
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 36,
  height: 10,
  borderRadius: 5,
  cursor: "ns-resize" as const,
  zIndex: 30,
  boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
  border: "1px solid rgba(0,0,0,0.4)",
};

const SHIFT_COLOR: Record<ShiftType, string> = {
  MORNING: "rgba(251,191,36,0.9)",
  AFTERNOON: "rgba(56,189,248,0.9)",
  NIGHT: "rgba(139,92,246,0.9)",
};

const SHIFT_LABEL: Record<ShiftType, string> = {
  MORNING: "Ranní",
  AFTERNOON: "Odpolední",
  NIGHT: "Noční",
};

export function ShiftEdgeHandles(props: ShiftEdgeHandlesProps) {
  const { machine, day, slotHeight, machineWeekShifts, preview, dragStateRef, dragDidMoveRef, scrollRef, onReset } = props;

  const intervals = resolveDayIntervals(machine, day.dateStr, machineWeekShifts);
  if (intervals.length === 0) return null;

  const activeSlots = new Set<number>();
  for (const iv of intervals) {
    const s = Math.round(iv.startMin / 30);
    const e = Math.round(iv.endMin / 30);
    for (let i = s; i < e; i++) activeSlots.add(i);
  }
  const isSlotBlocked = (slot: number): boolean => {
    if (slot < 0 || slot >= DAY_SLOT_COUNT) return false;
    return !activeSlots.has(slot);
  };

  type HandleInterval = {
    shift: ShiftType; startMin: number; endMin: number;
    emitStart: boolean; emitEnd: boolean;
    ownerDate: Date; ownerDateStr: string;
  };
  const handleIntervals: HandleInterval[] = intervals.map((iv) => {
    if (iv.source === "prev-tail") {
      const prev = new Date(day.date.getTime() - 24 * 60 * 60 * 1000);
      return {
        shift: iv.shift, startMin: iv.startMin, endMin: iv.endMin,
        emitStart: false, emitEnd: true,
        ownerDate: prev, ownerDateStr: utcToPragueDateStr(prev),
      };
    }
    return {
      shift: iv.shift, startMin: iv.startMin, endMin: iv.endMin,
      emitStart: true, emitEnd: iv.shift !== "NIGHT",
      ownerDate: day.date, ownerDateStr: day.dateStr,
    };
  });

  const handles: React.ReactNode[] = [];
  for (const hi of handleIntervals) {
    const shift = hi.shift;
    const sameOwner = preview && preview.machine === machine &&
      preview.shift === shift && utcToPragueDateStr(preview.date) === hi.ownerDateStr;
    const draggingStart = sameOwner && preview!.edge === "start";
    const draggingEnd = sameOwner && preview!.edge === "end";
    const effStartMin = draggingStart ? preview!.previewMin : hi.startMin;
    const effEndMin = draggingEnd ? preview!.previewMin : hi.endMin;
    const effStartSlot = Math.round(effStartMin / 30);
    const effEndSlot = Math.round(effEndMin / 30);
    const emitStart = hi.emitStart && (draggingStart || effStartSlot === 0 || isSlotBlocked(effStartSlot - 1));
    const emitEnd = hi.emitEnd && (draggingEnd || effEndSlot >= DAY_SLOT_COUNT || isSlotBlocked(effEndSlot));
    const startY = day.y + (effStartMin / 30) * slotHeight;
    const endY = day.y + (effEndMin / 30) * slotHeight;
    const color = SHIFT_COLOR[shift];
    const label = SHIFT_LABEL[shift];

    if (emitStart) {
      handles.push(
        <div
          key={`shift-${machine}-${day.dateStr}-${shift}-start-from-${hi.ownerDateStr}`}
          title={`${label} start — táhni pro úpravu, pravý klik = reset`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            (dragStateRef as { current: DragState | null }).current = {
              type: "shift-edge-resize", machine, date: hi.ownerDate, shift, edge: "start",
              origMin: hi.startMin, startClientY: e.clientY,
              startScrollTop: scrollRef.current?.scrollTop ?? 0, jointDrag: e.shiftKey,
            };
            (dragDidMoveRef as { current: boolean }).current = false;
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onReset(machine, hi.ownerDate, shift, "start"); }}
          style={{ ...HANDLE_STYLE, top: startY, background: color }}
        />,
      );
    }
    if (emitEnd) {
      handles.push(
        <div
          key={`shift-${machine}-${day.dateStr}-${shift}-end-from-${hi.ownerDateStr}`}
          title={`${label} konec — táhni pro úpravu, pravý klik = reset`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();
            (dragStateRef as { current: DragState | null }).current = {
              type: "shift-edge-resize", machine, date: hi.ownerDate, shift, edge: "end",
              origMin: hi.endMin, startClientY: e.clientY,
              startScrollTop: scrollRef.current?.scrollTop ?? 0, jointDrag: e.shiftKey,
            };
            (dragDidMoveRef as { current: boolean }).current = false;
          }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onReset(machine, hi.ownerDate, shift, "end"); }}
          style={{ ...HANDLE_STYLE, top: endY, background: color }}
        />,
      );
    }
    if (sameOwner && ((draggingStart && emitStart) || (draggingEnd && emitEnd))) {
      const previewY = draggingStart ? startY : endY;
      handles.push(
        <div key={`shift-${machine}-${day.dateStr}-${shift}-preview-from-${hi.ownerDateStr}`}
          style={{
            position: "absolute", top: previewY - 10, left: "calc(50% + 22px)",
            padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.85)",
            color: "#fff", fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums",
            pointerEvents: "none", zIndex: 31, whiteSpace: "nowrap",
            boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
          }}>
          {fmtHHMM(preview!.previewMin)}
        </div>,
      );
    }
  }
  return <Fragment>{handles}</Fragment>;
}
```

- [ ] **Step 2: Použít komponentu v `TimelineGrid.tsx`**

Najít blok `{canEdit && onShiftBoundsChange && machineWeekShifts && days.map((d) => { ... })}` a nahradit ho za:

```tsx
{canEdit && onShiftBoundsChange && machineWeekShifts && days.map((d) => (
  <ShiftEdgeHandles
    key={`shift-handles-${d.dateStr}`}
    machine={machine}
    day={d}
    slotHeight={slotHeight}
    machineWeekShifts={machineWeekShifts}
    preview={shiftEdgePreview}
    dragStateRef={dragStateRef}
    dragDidMoveRef={dragDidMove}
    scrollRef={scrollRef}
    onReset={(m, ownerDate, shift, edge) =>
      callbacksRef.current.onShiftBoundsChange?.(m, ownerDate, shift, edge, null, false)
    }
  />
))}
```

Přidat import:

```tsx
import { ShiftEdgeHandles } from "@/components/planner/ShiftEdgeHandles";
```

- [ ] **Step 3: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -20
```

- [ ] **Step 4: Manuální sanity test** — ověřit v prohlížeči, že handles fungují jako dřív (emise, drag, reset).

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/ShiftEdgeHandles.tsx src/app/_components/TimelineGrid.tsx
git commit -m "refactor(pracovni-doba): extract ShiftEdgeHandles komponenta

Odstranit ~180 řádek inline JSX z TimelineGrid. Single responsibility,
testovatelné, forward semantic přes resolveDayIntervals.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3.7: `MachineWorkHoursWeek` — combine state

**Files:**
- Modify: `src/components/admin/MachineWorkHoursWeek.tsx:311-334`

- [ ] **Step 1: Refaktor state**

Najít:

```ts
const [editingOverride, setEditingOverride] = useState<{machine: string; dow: number; shift: ShiftType} | null>(null);
const [popoverAnchor, setPopoverAnchor] = useState<DOMRect | null>(null);
```

Nahradit za:

```ts
type PopoverState = { machine: string; dow: number; shift: ShiftType; anchor: DOMRect };
const [popoverState, setPopoverState] = useState<PopoverState | null>(null);
```

Migrovat všechny použití:
- `setEditingOverride({ machine, dow, shift }); setPopoverAnchor(rect);` → `setPopoverState({ machine, dow, shift, anchor: rect });`
- `setEditingOverride(null); setPopoverAnchor(null);` → `setPopoverState(null);`
- `editingOverride && popoverAnchor` check → `popoverState`

- [ ] **Step 2: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -5
```

- [ ] **Step 3: Manuální test** — popover se stále otevírá/zavírá správně.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/MachineWorkHoursWeek.tsx
git commit -m "refactor(admin): combine editingOverride + popoverAnchor do jednoho state

Redukuje možnost inkonzistentního stavu (anchor set, editingOverride null).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Fáze 4 — Operational hardening

## Task 4.1: Sdílený rate limiter + PUT endpoint

**Files:**
- Create: `src/lib/rateLimiter.ts`
- Modify: `src/app/api/auth/login/route.ts`
- Modify: `src/app/api/machine-week-shifts/route.ts`

- [ ] **Step 1: Extrahovat do sdílené utility**

Write `src/lib/rateLimiter.ts`:

```ts
import type { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
type Store = Map<string, Bucket>;

const stores = new Map<string, Store>();

function getStore(name: string): Store {
  let store = stores.get(name);
  if (!store) {
    store = new Map<string, Bucket>();
    stores.set(name, store);
  }
  return store;
}

export function getClientIp(req: NextRequest | Request): string {
  const h = req.headers;
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Fixní token bucket. Vrací allowed + retryAfterSeconds.
 * - name  — jmenný prostor limiteru (např. "login", "put-shifts")
 * - key   — identifikátor žadatele (IP nebo userId)
 * - max   — povolený počet requestů v okně
 * - windowMs — velikost okna
 */
export function checkRateLimit(
  name: string,
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const store = getStore(name);
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}
```

- [ ] **Step 2: Migrovat `login/route.ts` na sdílený limiter**

Smazat řádky 7-35 v `src/app/api/auth/login/route.ts` (lokální mapa + funkce). Nahradit:

```ts
import { checkRateLimit, getClientIp } from "@/lib/rateLimiter";

// ...
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = checkRateLimit("login", ip, 10, 15 * 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: `Příliš mnoho pokusů. Zkuste znovu za ${Math.ceil(retryAfterSeconds / 60)} minut.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }
  // ...
}
```

- [ ] **Step 3: Přidat rate limit na `machine-week-shifts PUT`**

V `src/app/api/machine-week-shifts/route.ts` na začátek `PUT` (za session check):

```ts
import { checkRateLimit } from "@/lib/rateLimiter";

// ...
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { allowed, retryAfterSeconds } = checkRateLimit("put-shifts", String(session.id), 60, 60 * 1000);
  if (!allowed) {
    return NextResponse.json(
      { error: `Příliš mnoho requestů. Zkuste znovu za ${retryAfterSeconds}s.` },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
    );
  }
  // ... existující kód
}
```

- [ ] **Step 4: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -10
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/rateLimiter.ts src/app/api/auth/login/route.ts src/app/api/machine-week-shifts/route.ts
git commit -m "feat(api): sdílený rateLimiter + PUT machine-week-shifts limit

Extrakce rate limit logiky z login/route do lib/rateLimiter.
Nový limit 60 req/min per-user na PUT /machine-week-shifts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4.2: TOCTOU fix v cascade detection

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts`

> **Context:** Aktuálně `findConflictingBlocks` běží **před** `$transaction` — mezi detekcí a uložením může jiný uživatel přidat konfliktní blok → uložíme bez varování. Fix: re-check v transakci.

- [ ] **Step 1: Re-check v transakci**

Upravit `PUT` metodu: po `const force = ... ` a `if (!force) { const conflicts = await findConflictingBlocks(...)`, přidat ještě jednu kontrolu **uvnitř** transakce (Prisma nepodporuje interaktivní transakce napřímo, ale můžeme použít `$transaction(async (tx) => { ... })` syntaxi).

Přepsat transaction blok (řádky ~359-409):

```ts
try {
  const updated = await prisma.$transaction(async (tx) => {
    // Re-check cascade v transakci (TOCTOU protection).
    if (!force) {
      // Najdi konfliktní bloky znovu — tentokrát v rámci transakce.
      const weekEnd = new Date(weekStartDate);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
      const blocks = await tx.block.findMany({
        where: { machine, startTime: { gte: weekStartDate, lt: weekEnd } },
        select: { id: true, orderNumber: true, description: true, startTime: true, endTime: true },
      });
      const synthRows: MachineWeekShiftsRow[] = normalized.map((r) => ({
        machine, weekStart: parsedWeek, dayOfWeek: r.dayOfWeek,
        isActive: r.isActive, morningOn: r.morningOn, afternoonOn: r.afternoonOn, nightOn: r.nightOn,
        morningStartMin: r.morningStartMin, morningEndMin: r.morningEndMin,
        afternoonStartMin: r.afternoonStartMin, afternoonEndMin: r.afternoonEndMin,
        nightStartMin: r.nightStartMin, nightEndMin: r.nightEndMin,
      }));
      for (const b of blocks) {
        const violation = checkScheduleViolationWithTemplates(machine, b.startTime, b.endTime, synthRows);
        if (violation) {
          throw new AppError("CONFLICT", "SHIFT_SHRINK_CASCADE_RACE");
        }
      }
    }

    for (const d of normalized) {
      await tx.machineWeekShifts.upsert({
        where: { machine_weekStart_dayOfWeek: { machine, weekStart: weekStartDate, dayOfWeek: d.dayOfWeek } },
        create: { machine, weekStart: weekStartDate, dayOfWeek: d.dayOfWeek, isActive: d.isActive,
          morningOn: d.morningOn, afternoonOn: d.afternoonOn, nightOn: d.nightOn,
          morningStartMin: d.morningStartMin, morningEndMin: d.morningEndMin,
          afternoonStartMin: d.afternoonStartMin, afternoonEndMin: d.afternoonEndMin,
          nightStartMin: d.nightStartMin, nightEndMin: d.nightEndMin,
        },
        update: { isActive: d.isActive,
          morningOn: d.morningOn, afternoonOn: d.afternoonOn, nightOn: d.nightOn,
          morningStartMin: d.morningStartMin, morningEndMin: d.morningEndMin,
          afternoonStartMin: d.afternoonStartMin, afternoonEndMin: d.afternoonEndMin,
          nightStartMin: d.nightStartMin, nightEndMin: d.nightEndMin,
        },
      });
    }

    await tx.auditLog.create({
      data: { blockId: 0, userId: session.id, username: session.username,
        action: "UPDATE", field: "MachineWeekShifts",
        oldValue: beforePayload, newValue: afterPayload,
      },
    });

    return await tx.machineWeekShifts.findMany({
      where: { machine, weekStart: weekStartDate },
      orderBy: { dayOfWeek: "asc" },
    });
  });

  emitSSE("schedule:changed", { sourceUserId: session.id });
  logger.info("[machine-week-shifts PUT] updated", { machine, weekStart: parsedWeek, force, userId: session.id });
  return NextResponse.json(updated.map(serializeRow));
} catch (err) {
  if (isAppError(err) && err.code === "CONFLICT" && err.message === "SHIFT_SHRINK_CASCADE_RACE") {
    return NextResponse.json(
      { error: "SHIFT_SHRINK_CASCADE_RACE", message: "Jiný uživatel vytvořil konfliktní blok. Obnov zobrazení." },
      { status: 409 }
    );
  }
  if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
  logger.error("[machine-week-shifts PUT] neočekávaná chyba", err);
  return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
}
```

Přidat import `checkScheduleViolationWithTemplates` na začátek souboru (pokud není):

```ts
import { checkScheduleViolationWithTemplates } from "@/lib/scheduleValidation";
```

Odstranit původní dynamic import v `findConflictingBlocks.ts` (byla tam kvůli circular import — teď bude statický).

- [ ] **Step 2: Build**

```bash
npx tsc --noEmit 2>&1 | grep -v overlapCheck | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/machine-week-shifts/route.ts src/lib/findConflictingBlocks.ts
git commit -m "fix(pracovni-doba): TOCTOU re-check cascade v transakci

Mezi findConflictingBlocks a transaction mohl jiný uživatel přidat
konfliktní blok. Re-check v \$transaction zabrání tomuto race.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

# Fáze 5 — Finální testy, build, squash, push

## Task 5.1: Full test suite + build

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -30
```
Expected: SUCCESS.

- [ ] **Step 2: Full test suite**

```bash
node --test --import tsx src/lib/dateUtils.test.ts 2>&1 | tail -5
node --test --import tsx src/lib/errors.test.ts 2>&1 | tail -5
node --test --import tsx src/lib/shifts.test.ts 2>&1 | tail -5
node --test --import tsx src/lib/scheduleValidation.test.ts 2>&1 | tail -5
node --test --import tsx src/lib/reportMetrics.test.ts 2>&1 | tail -5
node --test --import tsx src/lib/findConflictingBlocks.test.ts 2>&1 | tail -5
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts 2>&1 | tail -5
```
Expected: vše zelené.

- [ ] **Step 3: Lint**

```bash
npm run lint 2>&1 | tail -20
```
Expected: žádná chyba (warningy OK — jsou pre-existing).

- [ ] **Step 4: Manuální smoke test v prohlížeči**

Spustit dev server (`npm run dev`) a ověřit:
1. Planner načte týden, overlay na neděli XL_106 s NIGHT ✓ zobrazí správné spojení Ne 22 → Po 06 jako aktivní (bez šrafování).
2. Drag handle Po 06:00 → uloží NIGHT end neděle.
3. Admin → Pracovní doba → vypnout Ne NIGHT → Po 00-06 se stane šrafovaným.
4. Pokus uložit NIGHT 20:00-08:00 (12h) → validátor odmítne s hláškou o 6-10h.
5. Uložit NIGHT přes admin UI, zkontrolovat AuditLog záznam má plný payload (žádné oseknutí).

## Task 5.2: Squash commitů

> **⚠ DESTRUCTIVE — jen pokud branch není pushnutý. Ověř `git status` + `git log michal..origin/michal` (expected: empty).**

- [ ] **Step 1: Ověřit, že branch není na remote**

```bash
git fetch origin 2>&1
git log --oneline origin/michal..michal 2>&1 | head -50 || echo "Branch not on remote — OK to squash"
```

Pokud `origin/michal` **existuje** a tvé commity už jsou pushnuté, **nesquashuj** — jinak bys potřeboval force push, což je destruktivní vůči ostatním co z branche tahají. V tom případě skip na Task 5.3.

- [ ] **Step 2: Zjistit první commit po `f9d1a957`**

```bash
git log --oneline f9d1a957..HEAD | tail -1
```

- [ ] **Step 3: Interaktivní rebase**

```bash
GIT_SEQUENCE_EDITOR="cat" git rebase -i f9d1a957 2>&1 | head -5
```

Tento dry-run ukáže, které commity budou v rebase. Pokud OK, spustit **naživo**:

```bash
git rebase -i f9d1a957
```

V editoru (nano/vim) změnit `pick` na `squash` u všech kromě **prvního** commitu v každé logické skupině. Doporučené skupiny:

```
pick <sha>  docs: spec + plán pracovní-doba
squash ...  (další docs commity)

pick <sha>  Sprint A: MachineWeekShifts + helpers + testy
squash ...  (všechny A1-A4)

pick <sha>  Sprint B: validator + snap override-aware
squash ...  (B1-B3)

pick <sha>  Sprint C: API PUT + cascade + audit
squash ...  (C1-C4)

pick <sha>  Sprint D: UI overlay override-aware
squash ...  (D1 + fix commits)

pick <sha>  Sprint E: popover editor + cascade dialog
squash ...  (E1-E3)

pick <sha>  Sprint F: drag handles
squash ...  (F1-F5 + fix commits)

pick <sha>  Sprint G: report metrics override-aware
squash ...  (G1-G2)

pick <sha>  feat(pracovni-doba): forward-semantic NIGHT wrap
squash ...  (Task 1.1-1.6)

pick <sha>  feat(pracovni-doba): NIGHT duration + force audit + TEXT migrace
squash ...  (Task 2.1-2.3)

pick <sha>  refactor(pracovni-doba): DRY + cleanup + extrakce komponent
squash ...  (Task 3.1-3.7)

pick <sha>  feat(api): rateLimiter + PUT limit + TOCTOU fix
squash ...  (Task 4.1-4.2)
```

- [ ] **Step 4: Napsat commit messages pro každou squash skupinu**

Po uložení rebase todo listu se otevřou postupně editory pro commit messages. Použít structured message:

```
feat(pracovni-doba): forward-semantic NIGHT wrap

Sjednotit NIGHT semantic napříč runtime: validator, snap, report
a UI grid používají stejný forward model (NIGHT den X → tail na X+1).

- nová isDateTimeActive v lib/shifts
- resolveDayIntervals v lib/scheduleValidation
- reportMetrics.computeAvailableHours přepočítává per-day
- TimelineGrid overlay + handles používají resolveDayIntervals
- smazat legacy isHourActive + 6 testů

12 nových unit testů pokrývá Ne NIGHT → Po tail, gaps, overrides.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

- [ ] **Step 5: Ověřit po squash**

```bash
git log --oneline f9d1a957..HEAD
```
Expected: ~9 commitů podle skupin výše.

```bash
npm run build 2>&1 | tail -5
```
Expected: SUCCESS (squash nezměnil stromy, jen historii).

## Task 5.3: Push na main

- [ ] **Step 1: Ověřit čistý pracovní strom**

```bash
git status --short
```
Expected: prázdné (kromě nepoužívaných souborů co nebyly staged).

- [ ] **Step 2: Merge branche `michal` do `main`**

```bash
git checkout main
git pull origin main 2>&1 | tail -5
git merge michal --no-ff -m "Merge branch 'michal' — pracovní doba handles + hardening"
```

Pokud jsou konflikty, řešit ručně.

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Ověřit na produkci**

Michal deploy → po deploy zkontrolovat:
1. `npx prisma migrate deploy` na prod DB proběhne (AuditLog.newValue TEXT migrace).
2. Otevřít planner, neděle XL_106 se správně zobrazí s forward semantic NIGHT.
3. Jedna editace pracovní doby v adminu projde a zapíše se do AuditLog.

---

# Ověření pokrytí spec (Self-review)

**Spec = review výstupy od dvou code-reviewer subagentů.**

| Nález | Task | Status |
|---|---|---|
| Forward semantic NIGHT wrap (moje doplnění) | Task 1.1–1.6 | ✅ |
| H1: NIGHT duration 6–10h | Task 2.1 | ✅ |
| H2: force=1 audit flag | Task 2.2 | ✅ |
| L2: AuditLog.newValue VARCHAR(191) → TEXT | Task 2.3 | ✅ |
| DRY: SHIFT_RANGES + fmtHHMM | Task 3.1 | ✅ |
| Hygiena: shifts.ts import + defEnd + komentář | Task 3.2 | ✅ |
| Smazat legacy pole v DayScheduleRow | Task 3.3 | ✅ |
| `pendingPayload.days: unknown[]` | Task 3.4 | ✅ |
| Test pro `findConflictingBlocks` | Task 3.5 | ✅ |
| Extrakce `ShiftEdgeHandles` | Task 3.6 | ✅ |
| Combine state v `MachineWorkHoursWeek` | Task 3.7 | ✅ |
| M2: Rate limit na PUT | Task 4.1 | ✅ |
| M4: TOCTOU cascade | Task 4.2 | ✅ |
| M3: `blockId: 0` placeholder | — | ⏭ vyřazeno z scope (vyžaduje schema změnu s nullable FK, Prisma migrace je riziková těsně před produkcí) |
| L3: `updateShiftBounds` last-write-wins | — | ⏭ vyřazeno (optimistic concurrency je větší feature; tech-debt ticket) |
| M1: GET bez weekStart vrací vše | — | ⏭ vyřazeno (data nejsou citlivá, optimalizace by stála čas; tech-debt ticket) |
| Commit squash | Task 5.2 | ✅ |

**Vyřazené nálezy (M1, M3, L3) jsou tech-debt, ne blokátory.** Doporučuji vytvořit GitHub issue "pracovní-doba tech-debt follow-up" po push, aby se neztratily.

---

## Placeholder scan

Kontroloval jsem plán na:
- ❌ TBD / TODO / implement later — žádné
- ❌ "add appropriate error handling" — ne, konkrétní AppError kódy
- ❌ "write tests for the above" bez testů — ne, testy jsou napsané
- ❌ "similar to task N" — ne, kód se opakuje inline
- ❌ reference na nedefinované typy — `ShiftDayPayload` je definovaný v Task 3.4, `WeekRowInput` v Task 3.5

Type consistency:
- `isDateTimeActive(machine, dateStr, hourMin, weekShifts)` — konzistentní napříč Task 1.1, 1.2, 1.3
- `resolveDayIntervals(machine, dateStr, weekShifts)` — konzistentní Task 1.5, 3.6
- `ShiftDayPayload` — konzistentní Task 3.4
- `ConflictingBlock` — konzistentní Task 3.5
