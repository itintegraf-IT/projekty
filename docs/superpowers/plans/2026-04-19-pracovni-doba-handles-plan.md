# Pracovní doba — flexibilní handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat per-shift hour overrides (6 nullable sloupců na `MachineWeekShifts`) a vrátit drag handles do planneru, aniž by se rozbil flag-only model.

**Architecture:** Tenká overlay vrstva nad existujícími flagy. `null` override = default z `SHIFT_HOURS`, jinak konkrétní minuty. Jediný helper `resolveShiftBounds(row, shift)` čte efektivní hranice. Validátor a snap logika přechází na multi-interval model (jeden den může mít mezery mezi směnami).

**Tech Stack:** Next.js 16, React, TypeScript, Prisma 5, MySQL, Tailwind v4, Node test runner (`node --test --import tsx`).

**Reference:** [docs/superpowers/specs/2026-04-19-pracovni-doba-handles-design.md](../specs/2026-04-19-pracovni-doba-handles-design.md)

---

## Sprint rozdělení

- **Sprint A** — Datový model, typy, core helpers (invisible ale funkční)
- **Sprint B** — Update core logiky (multi-interval validátor + workingTime)
- **Sprint C** — API podpora overrides + cascade detection
- **Sprint D** — Red overlay v TimelineGrid zobrazuje overrides (read-only check)
- **Sprint E** — Admin inline editor pro nastavení overrides
- **Sprint F** — Planner handles (morning + afternoon) + cascade dialog
- **Sprint G** — Polish (reportMetrics, smoke testing)

Každý sprint končí v plně funkčním stavu. Po každém sprintu stop & review.

---

## Sprint A — Datový model + core helpers

### Task A1: Prisma schema — 6 override sloupců

**Files:**
- Modify: `prisma/schema.prisma:173-188`

- [ ] **Step 1: Rozšířit model MachineWeekShifts**

Nahradit blok modelu (řádky 173–188) tímto:

```prisma
model MachineWeekShifts {
  id          Int      @id @default(autoincrement())
  machine     String   @db.VarChar(20)
  weekStart   DateTime @db.Date
  dayOfWeek   Int
  isActive    Boolean  @default(true)
  morningOn   Boolean  @default(false)
  afternoonOn Boolean  @default(false)
  nightOn     Boolean  @default(false)
  // Override hodin per směna (null = default z SHIFT_HOURS). Minuty od půlnoci, snap 30.
  morningStartMin   Int?
  morningEndMin     Int?
  afternoonStartMin Int?
  afternoonEndMin   Int?
  nightStartMin     Int?
  nightEndMin       Int?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([machine, weekStart, dayOfWeek])
  @@index([machine, weekStart])
  @@index([weekStart])
}
```

- [ ] **Step 2: Vygenerovat migraci**

Run: `npx prisma migrate dev --name add_shift_hour_overrides --create-only`
Expected: vytvoří adresář `prisma/migrations/<timestamp>_add_shift_hour_overrides/migration.sql`

- [ ] **Step 3: Ověřit obsah migrace**

Run: `cat prisma/migrations/*add_shift_hour_overrides*/migration.sql`
Expected: 6× `ALTER TABLE MachineWeekShifts ADD COLUMN <col> INTEGER NULL`

- [ ] **Step 4: Aplikovat migraci na dev DB**

Run: `npx prisma migrate deploy`
Expected: migrace aplikována, žádná chyba. Dev DB má nové sloupce.

- [ ] **Step 5: Prisma client regen + build check**

Run: `npx prisma generate && npm run build`
Expected: build projde bez chyb.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(pracovni-doba): Sprint A1 — 6 override sloupců na MachineWeekShifts"
```

---

### Task A2: Rozšířit typ `MachineWeekShiftsRow`

**Files:**
- Modify: `src/lib/machineWeekShifts.ts:8-17`

- [ ] **Step 1: Přidat override pole do typu**

Nahradit typ `MachineWeekShiftsRow` (řádky 8–17):

```ts
export type MachineWeekShiftsRow = {
  id?: number;
  machine: string;
  weekStart: string; // YYYY-MM-DD (pondělí)
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

- [ ] **Step 2: Build a ověřit TypeScript chyby**

Run: `npm run build 2>&1 | head -50`
Expected: chyby v místech, kde se `MachineWeekShiftsRow` konstruuje bez override polí (očekávané, opraveno v dalších krocích).

- [ ] **Step 3: Opravit `serializeWeekShifts` v scheduleValidation.ts**

V souboru `src/lib/scheduleValidation.ts` upravit funkci `serializeWeekShifts` (řádek ~54) — rozšířit signaturu i výstup:

```ts
export function serializeWeekShifts(
  raw: {
    machine: string; weekStart: Date | string; dayOfWeek: number;
    isActive: boolean; morningOn: boolean; afternoonOn: boolean; nightOn: boolean;
    morningStartMin?: number | null; morningEndMin?: number | null;
    afternoonStartMin?: number | null; afternoonEndMin?: number | null;
    nightStartMin?: number | null; nightEndMin?: number | null;
    id?: number;
  }[]
): MachineWeekShiftsRow[] {
  return raw.map((w) => ({
    id: w.id,
    machine: w.machine,
    weekStart: typeof w.weekStart === "string" ? w.weekStart.slice(0, 10) : w.weekStart.toISOString().slice(0, 10),
    dayOfWeek: w.dayOfWeek,
    isActive: w.isActive,
    morningOn: Boolean(w.morningOn),
    afternoonOn: Boolean(w.afternoonOn),
    nightOn: Boolean(w.nightOn),
    morningStartMin: w.morningStartMin ?? null,
    morningEndMin: w.morningEndMin ?? null,
    afternoonStartMin: w.afternoonStartMin ?? null,
    afternoonEndMin: w.afternoonEndMin ?? null,
    nightStartMin: w.nightStartMin ?? null,
    nightEndMin: w.nightEndMin ?? null,
  }));
}
```

- [ ] **Step 4: Opravit `serializeRow` v API route**

V `src/app/api/machine-week-shifts/route.ts` upravit typ `DbRow` (řádek ~28) a funkci `serializeRow` (řádek ~39):

```ts
type DbRow = {
  id: number;
  machine: string;
  weekStart: Date;
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

function serializeRow(r: DbRow): MachineWeekShiftsRow {
  return {
    id: r.id,
    machine: r.machine,
    weekStart: normalizeCivilDateInput(r.weekStart)!,
    dayOfWeek: r.dayOfWeek,
    isActive: r.isActive,
    morningOn: r.morningOn,
    afternoonOn: r.afternoonOn,
    nightOn: r.nightOn,
    morningStartMin: r.morningStartMin,
    morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin,
    afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin,
    nightEndMin: r.nightEndMin,
  };
}
```

- [ ] **Step 5: Opravit ostatní místa kde chybí override pole**

Run: `npm run build 2>&1 | grep "MachineWeekShiftsRow" | head -20`
Expected: Pokud build hlásí missing pole v mockech / testech, přidat `morningStartMin: null` atd. všude kde se konstruuje `MachineWeekShiftsRow`. Pokud žádné další, přejít dál.

Typicky: `src/lib/scheduleValidation.test.ts`, `src/lib/reportMetrics.ts` + testy. Pro každý výskyt přidat 6 × null polí.

- [ ] **Step 6: Build pass**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat(pracovni-doba): Sprint A2 — MachineWeekShiftsRow s override poli"
```

---

### Task A3: Helper `resolveShiftBounds` — TDD

**Files:**
- Create: `src/lib/shifts.test.ts`
- Modify: `src/lib/shifts.ts`

- [ ] **Step 1: Napsat failing test**

Vytvořit `src/lib/shifts.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShiftBounds } from "./shifts";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

function makeRow(overrides: Partial<MachineWeekShiftsRow> = {}): MachineWeekShiftsRow {
  return {
    machine: "XL_105", weekStart: "2026-04-13", dayOfWeek: 1,
    isActive: true, morningOn: true, afternoonOn: true, nightOn: true,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
    ...overrides,
  };
}

test("resolveShiftBounds — default MORNING (no override)", () => {
  const row = makeRow();
  assert.deepEqual(resolveShiftBounds(row, "MORNING"), { startMin: 360, endMin: 840 });
});

test("resolveShiftBounds — default AFTERNOON", () => {
  const row = makeRow();
  assert.deepEqual(resolveShiftBounds(row, "AFTERNOON"), { startMin: 840, endMin: 1320 });
});

test("resolveShiftBounds — default NIGHT (cross midnight)", () => {
  const row = makeRow();
  assert.deepEqual(resolveShiftBounds(row, "NIGHT"), { startMin: 1320, endMin: 360 });
});

test("resolveShiftBounds — override MORNING end only", () => {
  const row = makeRow({ morningEndMin: 810 }); // 13:30
  assert.deepEqual(resolveShiftBounds(row, "MORNING"), { startMin: 360, endMin: 810 });
});

test("resolveShiftBounds — override MORNING start and end", () => {
  const row = makeRow({ morningStartMin: 420, morningEndMin: 810 }); // 7:00–13:30
  assert.deepEqual(resolveShiftBounds(row, "MORNING"), { startMin: 420, endMin: 810 });
});

test("resolveShiftBounds — shift OFF → null (ignore override)", () => {
  const row = makeRow({ morningOn: false, morningEndMin: 810 });
  assert.equal(resolveShiftBounds(row, "MORNING"), null);
});

test("resolveShiftBounds — NIGHT override (cross midnight, 20:00–7:00)", () => {
  const row = makeRow({ nightStartMin: 1200, nightEndMin: 420 });
  assert.deepEqual(resolveShiftBounds(row, "NIGHT"), { startMin: 1200, endMin: 420 });
});
```

- [ ] **Step 2: Run test — ověřit fail**

Run: `node --test --import tsx src/lib/shifts.test.ts`
Expected: FAIL — `resolveShiftBounds is not a function`.

- [ ] **Step 3: Implementovat helper**

Přidat na konec `src/lib/shifts.ts`:

```ts
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

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
  const defStart = def.start * 60;
  const defEnd = (def.end < def.start ? def.end + 24 : def.end) * 60; // NIGHT: 6 → 30
  const override = shift === "MORNING"
    ? { s: row.morningStartMin, e: row.morningEndMin }
    : shift === "AFTERNOON"
    ? { s: row.afternoonStartMin, e: row.afternoonEndMin }
    : { s: row.nightStartMin, e: row.nightEndMin };
  const startMin = override.s ?? defStart;
  const endMin = override.e ?? (shift === "NIGHT" ? def.end * 60 : defEnd);
  return { startMin, endMin };
}
```

Pozn. pro NIGHT: `SHIFT_HOURS.NIGHT = { start: 22, end: 6 }`. `startMin = 1320`, `endMin = 360` (6:00 příštího dne, reprezentováno jako minuty kalendářního dne kdy končí). Konzumenti detekují cross-midnight přes `endMin < startMin`.

- [ ] **Step 4: Run test — ověřit pass**

Run: `node --test --import tsx src/lib/shifts.test.ts`
Expected: 7/7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shifts.ts src/lib/shifts.test.ts
git commit -m "feat(pracovni-doba): Sprint A3 — resolveShiftBounds helper + testy"
```

---

### Task A4: Helper `isHourActive` — TDD

**Files:**
- Modify: `src/lib/shifts.ts`
- Modify: `src/lib/shifts.test.ts`

- [ ] **Step 1: Napsat failing test**

Přidat do `src/lib/shifts.test.ts`:

```ts
import { isHourActive } from "./shifts";

test("isHourActive — default morning+afternoon, hour 10 → active", () => {
  const row = makeRow({ nightOn: false });
  assert.equal(isHourActive(10, row), true);
});

test("isHourActive — morning only, hour 15 → inactive", () => {
  const row = makeRow({ afternoonOn: false, nightOn: false });
  assert.equal(isHourActive(15, row), false);
});

test("isHourActive — override morning end 13:00, hour 13.5 → inactive (in gap)", () => {
  const row = makeRow({ nightOn: false, morningEndMin: 780 }); // 13:00
  assert.equal(isHourActive(13.5, row), false);
});

test("isHourActive — night active, hour 0.5 → active (cross midnight)", () => {
  const row = makeRow({ morningOn: false, afternoonOn: false });
  assert.equal(isHourActive(0.5, row), true);
});

test("isHourActive — night active, hour 7 → inactive (after night end)", () => {
  const row = makeRow({ morningOn: false, afternoonOn: false });
  assert.equal(isHourActive(7, row), false);
});

test("isHourActive — all shifts off, any hour → inactive", () => {
  const row = makeRow({ morningOn: false, afternoonOn: false, nightOn: false });
  assert.equal(isHourActive(10, row), false);
});
```

- [ ] **Step 2: Run — ověřit fail**

Run: `node --test --import tsx src/lib/shifts.test.ts`
Expected: 6 new tests fail (`isHourActive is not a function`).

- [ ] **Step 3: Implementovat**

Přidat do `src/lib/shifts.ts`:

```ts
/** Je hodina (0–24) v některém aktivním intervalu? */
export function isHourActive(hour: number, row: MachineWeekShiftsRow): boolean {
  const h = ((hour % 24) + 24) % 24;
  const hMin = h * 60;
  for (const shift of SHIFTS) {
    const b = resolveShiftBounds(row, shift);
    if (!b) continue;
    if (b.endMin < b.startMin) {
      // cross midnight (NIGHT): [startMin..1440) ∪ [0..endMin)
      if (hMin >= b.startMin || hMin < b.endMin) return true;
    } else {
      if (hMin >= b.startMin && hMin < b.endMin) return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run — ověřit pass**

Run: `node --test --import tsx src/lib/shifts.test.ts`
Expected: 13/13 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shifts.ts src/lib/shifts.test.ts
git commit -m "feat(pracovni-doba): Sprint A4 — isHourActive helper + testy"
```

---

## Sprint B — Update core logiky

### Task B1: Rozšířit `resolveScheduleRows` o intervals

**Files:**
- Modify: `src/lib/scheduleValidation.ts:6-48`

- [ ] **Step 1: Rozšířit typ `DayScheduleRow`**

Na řádku 6 nahradit typ:

```ts
export type DayScheduleRow = {
  machine: string;
  dayOfWeek: number;
  startHour: number;    // legacy union (earliest start .. latest end)
  endHour: number;
  startSlot: number;
  endSlot: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  // NEW — multi-interval (v minutách od půlnoci, cross-midnight pro NIGHT povolené)
  intervals: Array<{ shift: "MORNING" | "AFTERNOON" | "NIGHT"; startMin: number; endMin: number }>;
};
```

- [ ] **Step 2: Naplnit intervals v `resolveScheduleRows`**

Nahradit tělo map callbacku (řádek ~33):

```ts
return weekRows.map((w) => {
  const { startHour, endHour } = deriveHoursFromShifts(w);
  const intervals: DayScheduleRow["intervals"] = [];
  for (const shift of ["MORNING", "AFTERNOON", "NIGHT"] as const) {
    const b = resolveShiftBounds(w, shift);
    if (b) intervals.push({ shift, startMin: b.startMin, endMin: b.endMin });
  }
  return {
    machine,
    dayOfWeek: w.dayOfWeek,
    startHour,
    endHour,
    startSlot: slotFromHourBoundary(startHour),
    endSlot: slotFromHourBoundary(endHour),
    isActive: w.isActive,
    morningOn: w.morningOn,
    afternoonOn: w.afternoonOn,
    nightOn: w.nightOn,
    intervals,
  };
});
```

- [ ] **Step 3: Import `resolveShiftBounds`**

Na začátku souboru přidat import:

```ts
import { deriveHoursFromShifts, shiftFromHour, resolveShiftBounds } from "./shifts";
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: 0 errors. `DayScheduleRow` konzumenti bez změny (`intervals` je pouze přidané pole).

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleValidation.ts
git commit -m "feat(pracovni-doba): Sprint B1 — resolveScheduleRows s intervals"
```

---

### Task B2: Upravit `checkScheduleViolationWithTemplates` na override-aware — TDD

**Files:**
- Modify: `src/lib/scheduleValidation.test.ts`
- Modify: `src/lib/scheduleValidation.ts:88-122`

- [ ] **Step 1: Napsat failing test na multi-interval**

Přidat do `src/lib/scheduleValidation.test.ts` nové testy:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScheduleViolationWithTemplates } from "./scheduleValidation";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

function rowFor(dayOfWeek: number, overrides: Partial<MachineWeekShiftsRow> = {}): MachineWeekShiftsRow {
  return {
    machine: "XL_105", weekStart: "2026-04-13", dayOfWeek,
    isActive: true, morningOn: true, afternoonOn: true, nightOn: false,
    morningStartMin: null, morningEndMin: null,
    afternoonStartMin: null, afternoonEndMin: null,
    nightStartMin: null, nightEndMin: null,
    ...overrides,
  };
}

test("checkSchedule — override morningEnd=13:00, blok 13:15–13:45 → VIOLATION (mezera)", () => {
  // Pondělí 2026-04-13, Europe/Prague
  const rows = [rowFor(1, { morningEndMin: 780 })]; // morning 6–13, afternoon 14–22, mezera 13–14
  const start = new Date("2026-04-13T11:15:00.000Z"); // 13:15 Prague (letní čas = UTC+2)
  const end = new Date("2026-04-13T11:45:00.000Z");   // 13:45 Prague
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkSchedule — override afternoonStart=13:00, blok 13:15–13:45 → OK (sladěno)", () => {
  const rows = [rowFor(1, { morningEndMin: 780, afternoonStartMin: 780 })]; // sladěno na 13:00
  const start = new Date("2026-04-13T11:15:00.000Z");
  const end = new Date("2026-04-13T11:45:00.000Z");
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, null);
});

test("checkSchedule — override afternoonEnd=20:00, blok 20:30–21:00 → VIOLATION", () => {
  const rows = [rowFor(1, { afternoonEndMin: 1200 })]; // afternoon ends 20:00
  const start = new Date("2026-04-13T18:30:00.000Z"); // 20:30 Prague
  const end = new Date("2026-04-13T19:00:00.000Z");   // 21:00 Prague
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});

test("checkSchedule — override morningStart=7:00, blok 6:15–6:45 → VIOLATION", () => {
  const rows = [rowFor(1, { morningStartMin: 420 })]; // morning starts 7:00
  const start = new Date("2026-04-13T04:15:00.000Z"); // 6:15 Prague
  const end = new Date("2026-04-13T04:45:00.000Z");   // 6:45 Prague
  const result = checkScheduleViolationWithTemplates("XL_105", start, end, rows);
  assert.equal(result, "Blok zasahuje do doby mimo provoz stroje.");
});
```

Pozn.: Prague = UTC+2 v dubnu (letní čas). Testovaná data 2026-04-13 (pondělí) spadají do letního času.

- [ ] **Step 2: Run — ověřit fail**

Run: `node --test --import tsx src/lib/scheduleValidation.test.ts 2>&1 | head -40`
Expected: nové testy selžou (současná implementace používá jen flagy, ignoruje overrides).

- [ ] **Step 3: Přepsat `checkScheduleViolationWithTemplates`**

Nahradit funkci (řádek 88–122) v `src/lib/scheduleValidation.ts`:

```ts
import { isHourActive } from "./shifts";

export function checkScheduleViolationWithTemplates(
  machine: string,
  startTime: Date,
  endTime: Date,
  weekShifts: MachineWeekShiftsRow[]
): string | null {
  const SLOT_MS = 30 * 60 * 1000;
  const rowCache = new Map<string, MachineWeekShiftsRow | null>();
  const scheduleCache = new Map<string, DayScheduleRow[]>();
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { dayOfWeek, dateStr, hour, minute } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) {
      scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, weekShifts));
    }
    const schedule = scheduleCache.get(dateStr)!;
    const cacheKey = `${machine}|${dateStr}`;
    if (!rowCache.has(cacheKey)) {
      const { weekStart } = (() => {
        const ws = weekStartStrFromDateStr(dateStr);
        return { weekStart: ws };
      })();
      const row = weekShifts.find((w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek) ?? null;
      rowCache.set(cacheKey, row);
    }
    const weekRow = rowCache.get(cacheKey);
    if (!weekRow) {
      // Hardcoded fallback (stejné jako dosud).
      if (schedule.length > 0 || isHardcodedBlocked(machine, dayOfWeek, Math.floor((hour + minute / 60) * 2))) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    } else {
      if (!weekRow.isActive) return "Blok zasahuje do doby mimo provoz stroje.";
      if (!isHourActive(hour + minute / 60, weekRow)) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}
```

- [ ] **Step 4: Run — ověřit pass**

Run: `node --test --import tsx src/lib/scheduleValidation.test.ts`
Expected: všechny testy (původní + 4 nové) passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleValidation.ts src/lib/scheduleValidation.test.ts
git commit -m "feat(pracovni-doba): Sprint B2 — validátor používá isHourActive (override-aware)"
```

---

### Task B3: Upravit `workingTime.ts` na override-aware snap

**Files:**
- Modify: `src/lib/workingTime.ts:8-26`

- [ ] **Step 1: Přepsat `isBlockedSlotDynamic` na override-aware**

Nahradit funkci:

```ts
import { isHourActive } from "@/lib/shifts";

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  schedule: DayScheduleRow[],
  weekShifts: MachineWeekShiftsRow[]
): boolean {
  const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(date);
  const row = schedule.find((r) => r.machine === machine && r.dayOfWeek === dayOfWeek);
  if (!row) {
    if (schedule.some((r) => r.machine === machine)) return true;
    return isHardcodedBlocked(machine, dayOfWeek, slot);
  }
  if (!row.isActive) return true;
  // Najít původní MachineWeekShiftsRow pro isHourActive (kvůli override polím).
  const weekStart = dateStr.slice(0, 10); // placeholder — přepočet níže
  const ws = weekShifts.find((w) => w.machine === machine && w.dayOfWeek === dayOfWeek);
  if (!ws) return true;
  return !isHourActive(hour + minute / 60, ws);
}
```

Pozor: `weekShifts.find` nestačí — může být více týdnů. Správná varianta:

```ts
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  schedule: DayScheduleRow[],
  weekShifts: MachineWeekShiftsRow[]
): boolean {
  const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(date);
  const row = schedule.find((r) => r.machine === machine && r.dayOfWeek === dayOfWeek);
  if (!row) {
    if (schedule.some((r) => r.machine === machine)) return true;
    return isHardcodedBlocked(machine, dayOfWeek, slot);
  }
  if (!row.isActive) return true;
  const weekStart = weekStartStrFromDateStr(dateStr);
  const ws = weekShifts.find((w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek);
  if (!ws) return true;
  return !isHourActive(hour + minute / 60, ws);
}
```

- [ ] **Step 2: Aktualizovat callery `isBlockedSlotDynamic`**

V `blockOverlapsBlockedTimeWithTemplates` a `getBlockedPeriodEndWithTemplates` předávat `weekShifts` parametr:

```ts
if (isBlockedSlotDynamic(machine, cur, scheduleCache.get(dateStr)!, weekShifts)) return true;
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 4: Manual test běhu snap logiky**

Run: `node --test --import tsx src/lib/scheduleValidation.test.ts`
Expected: stále pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workingTime.ts
git commit -m "feat(pracovni-doba): Sprint B3 — workingTime snap používá isHourActive"
```

---

## Sprint C — API podpora overrides + cascade

### Task C1: GET vrací override pole

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts` (type `DbRow` a `serializeRow` už rozšířeny v A2)

- [ ] **Step 1: Ověřit, že GET vrací override pole**

Run dev server: `npm run dev &`
Curl: `curl -s -b "integraf-session=<token>" "http://localhost:3000/api/machine-week-shifts?weekStart=2026-04-13" | head -200`
Expected: JSON obsahuje `morningStartMin`, `morningEndMin`, atd. (všechny `null` pro existující data).

- [ ] **Step 2: Commit (no-op — už implementováno v A2)**

Přeskočit commit, pokud diff prázdný.

---

### Task C2: PUT akceptuje override pole — TDD

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts:20-26,148-183`

- [ ] **Step 1: Rozšířit typ `DayInput`**

Na řádku 20–26 nahradit:

```ts
type DayInput = {
  dayOfWeek: number;
  isActive?: boolean;
  morningOn?: boolean;
  afternoonOn?: boolean;
  nightOn?: boolean;
  morningStartMin?: number | null;
  morningEndMin?: number | null;
  afternoonStartMin?: number | null;
  afternoonEndMin?: number | null;
  nightStartMin?: number | null;
  nightEndMin?: number | null;
};
```

- [ ] **Step 2: Přidat validační pásma a helper**

Nad `export async function GET` přidat:

```ts
const SHIFT_RANGES = {
  MORNING:   { start: [240, 480] as const, end: [720, 960] as const },
  AFTERNOON: { start: [720, 960] as const, end: [1200, 1440] as const },
  NIGHT:     { start: [1200, 1440] as const, end: [240, 480] as const },
};

function validateOverrideMin(value: number | null | undefined, range: readonly [number, number], label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) throw new AppError("VALIDATION_ERROR", `${label} musí být celé číslo minut`);
  if (value % 30 !== 0) throw new AppError("VALIDATION_ERROR", `${label} musí být zarovnán na 30 min`);
  if (value < range[0] || value > range[1]) {
    const hh = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
    throw new AppError("VALIDATION_ERROR", `${label} musí být v rozsahu ${hh(range[0])}–${hh(range[1])}`);
  }
  return value;
}
```

- [ ] **Step 3: Rozšířit `normalized` mapping v PUT**

V bloku `const normalized = body.days.map((d) => {` (řádek ~168) nahradit:

```ts
const normalized = body.days.map((d) => {
  if (!Number.isInteger(d.dayOfWeek) || d.dayOfWeek < 0 || d.dayOfWeek > 6)
    throw new AppError("VALIDATION_ERROR", "dayOfWeek musí být 0–6");
  if (seenDow.has(d.dayOfWeek)) throw new AppError("VALIDATION_ERROR", "Duplicitní dayOfWeek");
  seenDow.add(d.dayOfWeek);
  const morningOn = Boolean(d.morningOn);
  const afternoonOn = Boolean(d.afternoonOn);
  const nightOn = Boolean(d.nightOn);

  const morningStartMin   = validateOverrideMin(d.morningStartMin, SHIFT_RANGES.MORNING.start, "Ranní start");
  const morningEndMin     = validateOverrideMin(d.morningEndMin, SHIFT_RANGES.MORNING.end, "Ranní konec");
  const afternoonStartMin = validateOverrideMin(d.afternoonStartMin, SHIFT_RANGES.AFTERNOON.start, "Odpolední start");
  const afternoonEndMin   = validateOverrideMin(d.afternoonEndMin, SHIFT_RANGES.AFTERNOON.end, "Odpolední konec");
  const nightStartMin     = validateOverrideMin(d.nightStartMin, SHIFT_RANGES.NIGHT.start, "Noční start");
  const nightEndMin       = validateOverrideMin(d.nightEndMin, SHIFT_RANGES.NIGHT.end, "Noční konec");

  // Sanity: MORNING/AFTERNOON start < end
  if (morningStartMin !== null && morningEndMin !== null && morningStartMin >= morningEndMin)
    throw new AppError("VALIDATION_ERROR", `Ranní start (${morningStartMin}) musí být před koncem (${morningEndMin})`);
  if (afternoonStartMin !== null && afternoonEndMin !== null && afternoonStartMin >= afternoonEndMin)
    throw new AppError("VALIDATION_ERROR", `Odpolední start musí být před koncem`);
  // NIGHT: startMin > endMin (cross midnight) — neověřujeme, validace rozsahy to garantuje

  return {
    dayOfWeek: d.dayOfWeek,
    isActive: morningOn || afternoonOn || nightOn,
    morningOn, afternoonOn, nightOn,
    morningStartMin, morningEndMin,
    afternoonStartMin, afternoonEndMin,
    nightStartMin, nightEndMin,
  };
});
```

- [ ] **Step 4: Rozšířit upsert create/update o override pole**

V `prisma.$transaction([...])` upravit `prisma.machineWeekShifts.upsert({...})` — do `create` i `update` přidat všech 6 override polí:

```ts
create: {
  machine, weekStart: weekStartDate, dayOfWeek: d.dayOfWeek,
  isActive: d.isActive,
  morningOn: d.morningOn, afternoonOn: d.afternoonOn, nightOn: d.nightOn,
  morningStartMin: d.morningStartMin, morningEndMin: d.morningEndMin,
  afternoonStartMin: d.afternoonStartMin, afternoonEndMin: d.afternoonEndMin,
  nightStartMin: d.nightStartMin, nightEndMin: d.nightEndMin,
},
update: {
  isActive: d.isActive,
  morningOn: d.morningOn, afternoonOn: d.afternoonOn, nightOn: d.nightOn,
  morningStartMin: d.morningStartMin, morningEndMin: d.morningEndMin,
  afternoonStartMin: d.afternoonStartMin, afternoonEndMin: d.afternoonEndMin,
  nightStartMin: d.nightStartMin, nightEndMin: d.nightEndMin,
},
```

- [ ] **Step 5: Build + test**

Run: `npm run build`
Expected: 0 errors.

Manual smoke:
```bash
curl -X PUT -H "Content-Type: application/json" -b "integraf-session=<token>" \
  -d '{"machine":"XL_105","weekStart":"2026-04-13","days":[{"dayOfWeek":1,"morningOn":true,"morningEndMin":780,"afternoonOn":true,"nightOn":false},...7 dní]}' \
  http://localhost:3000/api/machine-week-shifts
```
Expected: 200 OK, response obsahuje `morningEndMin: 780`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/machine-week-shifts/route.ts
git commit -m "feat(pracovni-doba): Sprint C2 — PUT akceptuje override pole s validací"
```

---

### Task C3: Cascade detection při shrinku směny

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts:141-263`

- [ ] **Step 1: Přidat helper `findConflictingBlocks`**

Nad `export async function GET` přidat:

```ts
type ConflictingBlock = { id: number; jobName: string | null; startTime: string; endTime: string };

/**
 * Najde bloky typu ZAKAZKA/DATA/MATERIAL, které po změně pracovní doby
 * spadnou mimo aktivní intervaly. Používá isHourActive per slot.
 */
async function findConflictingBlocks(
  machine: string,
  weekStartStr: string,
  newRows: Array<{ dayOfWeek: number; morningOn: boolean; afternoonOn: boolean; nightOn: boolean;
    morningStartMin: number | null; morningEndMin: number | null;
    afternoonStartMin: number | null; afternoonEndMin: number | null;
    nightStartMin: number | null; nightEndMin: number | null; isActive: boolean; }>
): Promise<ConflictingBlock[]> {
  const weekStartDate = civilDateToUTCMidnight(weekStartStr);
  const weekEnd = new Date(weekStartDate);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  // Fetch bloky v rozsahu týdne.
  const blocks = await prisma.block.findMany({
    where: {
      machine,
      startTime: { gte: weekStartDate, lt: weekEnd },
    },
    select: { id: true, jobName: true, startTime: true, endTime: true },
  });

  // Emulovat weekShifts rows pro isHourActive.
  const synthRows: MachineWeekShiftsRow[] = newRows.map((r) => ({
    machine, weekStart: weekStartStr, dayOfWeek: r.dayOfWeek,
    isActive: r.isActive,
    morningOn: r.morningOn, afternoonOn: r.afternoonOn, nightOn: r.nightOn,
    morningStartMin: r.morningStartMin, morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin, afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin, nightEndMin: r.nightEndMin,
  }));

  const { checkScheduleViolationWithTemplates } = await import("@/lib/scheduleValidation");
  const conflicts: ConflictingBlock[] = [];
  for (const b of blocks) {
    const violation = checkScheduleViolationWithTemplates(machine, b.startTime, b.endTime, synthRows);
    if (violation) {
      conflicts.push({
        id: b.id,
        jobName: b.jobName,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      });
    }
  }
  return conflicts;
}
```

- [ ] **Step 2: Volat `findConflictingBlocks` před transakcí, respektovat `force` flag**

V PUT handleru, po `normalized` (před `$transaction`), přidat:

```ts
const force = new URL(req.url).searchParams.get("force") === "1";
if (!force) {
  const conflicts = await findConflictingBlocks(machine, parsedWeek, normalized);
  if (conflicts.length > 0) {
    return NextResponse.json(
      { error: "SHIFT_SHRINK_CASCADE", conflictingBlocks: conflicts },
      { status: 409 }
    );
  }
}
```

Klient při cascade response zobrazí dialog; pokud uživatel potvrdí „přesto uložit", znovu volá PUT s `?force=1`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 4: Smoke test**

Vytvořit v dev DB blok v 13:30 pondělí 2026-04-13 pro XL_105. Poslat PUT s `morningEndMin: 780` (zkrátit ranní).
Expected: 409 s `conflictingBlocks: [{id, jobName, ...}]`.

Opakovat s `?force=1`.
Expected: 200, blok zůstane na místě, ale bude v červené zóně.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/machine-week-shifts/route.ts
git commit -m "feat(pracovni-doba): Sprint C3 — cascade detection při shrinku směny"
```

---

### Task C4: Audit log rozšířit o override pole

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts` funkce `encodeDay`

- [ ] **Step 1: Rozšířit `encodeDay`**

Nahradit helper `encodeDay` (řádek ~196):

```ts
const DAY_CODES = ["ne", "po", "út", "st", "čt", "pá", "so"];
const fmtHHMM = (m: number | null | undefined): string => {
  if (m === null || m === undefined) return "";
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};
const encodeDay = (r: {
  dayOfWeek: number; isActive: boolean; morningOn: boolean; afternoonOn: boolean; nightOn: boolean;
  morningStartMin?: number | null; morningEndMin?: number | null;
  afternoonStartMin?: number | null; afternoonEndMin?: number | null;
  nightStartMin?: number | null; nightEndMin?: number | null;
}) => {
  const shifts = (r.morningOn ? "M" : "-") + (r.afternoonOn ? "A" : "-") + (r.nightOn ? "N" : "-");
  const overrides = [
    r.morningStartMin !== null && r.morningStartMin !== undefined ? `Ms${fmtHHMM(r.morningStartMin)}` : "",
    r.morningEndMin !== null && r.morningEndMin !== undefined ? `Me${fmtHHMM(r.morningEndMin)}` : "",
    r.afternoonStartMin !== null && r.afternoonStartMin !== undefined ? `As${fmtHHMM(r.afternoonStartMin)}` : "",
    r.afternoonEndMin !== null && r.afternoonEndMin !== undefined ? `Ae${fmtHHMM(r.afternoonEndMin)}` : "",
    r.nightStartMin !== null && r.nightStartMin !== undefined ? `Ns${fmtHHMM(r.nightStartMin)}` : "",
    r.nightEndMin !== null && r.nightEndMin !== undefined ? `Ne${fmtHHMM(r.nightEndMin)}` : "",
  ].filter(Boolean).join(",");
  const base = r.isActive ? shifts : "xxx";
  return `${DAY_CODES[r.dayOfWeek]}:${base}${overrides ? `(${overrides})` : ""}`;
};
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/machine-week-shifts/route.ts
git commit -m "feat(pracovni-doba): Sprint C4 — audit log zahrnuje override hodnoty"
```

---

## Sprint D — Red overlay v TimelineGrid reflektuje overrides

Cílem je ověřit, že po API změně se overrides automaticky promítají do šrafování.

### Task D1: Red overlay používá intervals z DayScheduleRow

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` (funkce kolem řádku 2389 — `blocked overlays`)

- [ ] **Step 1: Najít místo renderu red overlayů**

Run: `grep -n "Blocked overlays" src/app/_components/TimelineGrid.tsx`
Expected: jeden výskyt kolem řádku 2389.

- [ ] **Step 2: Přepracovat generování `blockedOverlays` na interval-based**

Najít funkci / blok kódu, který generuje `BlockedOverlay[]` per machine (od řádku ~2389 do ~2440). Místo výpočtu přes `startHour`/`endHour` (jeden interval) vygenerovat overlay pro každý **gap mezi intervaly** a okraje dne.

Pseudokód:

```ts
// Pro každý aktivní den stroje:
const row = schedule.find(...);
if (!row) continue;
const dayStartSlot = 0;
const dayEndSlot = DAY_SLOT_COUNT; // 48 = 24h
const activeSpans: Array<[number, number]> = []; // slot ranges
for (const iv of row.intervals) {
  const s = Math.round(iv.startMin / 30);
  let e = Math.round(iv.endMin / 30);
  if (iv.endMin < iv.startMin) {
    // cross-midnight NIGHT: split na [s, 48) a [0, e) příštího dne
    activeSpans.push([s, dayEndSlot]);
    // část [0, e) patří následujícímu dni → render handled tam
  } else {
    activeSpans.push([s, e]);
  }
}
// Union + sort active spans, pak komplement = blocked spans.
const sorted = activeSpans.sort((a, b) => a[0] - b[0]);
const merged: Array<[number, number]> = [];
for (const [s, e] of sorted) {
  if (merged.length && merged[merged.length - 1][1] >= s) {
    merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
  } else {
    merged.push([s, e]);
  }
}
// Také přidat span příchozí noční z předchozího dne (0..nightEndMinOfPrev).
// ... (detailní implementace při editaci)
const blockedSpans: Array<[number, number]> = [];
let cursor = 0;
for (const [s, e] of merged) {
  if (s > cursor) blockedSpans.push([cursor, s]);
  cursor = Math.max(cursor, e);
}
if (cursor < dayEndSlot) blockedSpans.push([cursor, dayEndSlot]);
// Každý blockedSpan → jeden BlockedOverlay záznam (top, height, atd.).
```

Konkrétní změnu soubor-specific piš inline podle skutečného kódu v `TimelineGrid.tsx` okolo řádků 2389–2440. Zachovat existující typy `BlockedOverlay`, jen upravit jak se plní.

Pozn.: typ `BlockedOverlay` má pole `overlayType: "full-block" | "start-block" | "end-block"` z historických důvodů — v novém modelu může být typů víc (gap mezi směnami). Pro MVP: všechny gap → `overlayType: "middle-block"` (nové), render logika nepotřebuje rozlišovat, protože všechny jsou read-only a vizuálně stejné.

- [ ] **Step 3: Build + visual check**

Run: `npm run dev`
V adminu nastav morningEnd = 13:00 pro pondělí XL_105.
V planneru u pondělí ověř: šrafování od 22:00 (nebo 0:00 pokud night off) do 6:00 (noční), od 13:00 do 14:00 (nová mezera), od 22:00 (end afternoon) do konce dne.
Expected: šrafování reflektuje override, bez handles (zatím read-only).

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat(pracovni-doba): Sprint D1 — red overlay reflektuje overrides"
```

---

## Sprint E — Admin inline editor

### Task E1: Čtení override polí v komponentě `MachineWorkHoursWeek`

**Files:**
- Modify: `src/components/admin/MachineWorkHoursWeek.tsx`

- [ ] **Step 1: Přečíst soubor a najít stav `rows`**

Run: `cat src/components/admin/MachineWorkHoursWeek.tsx | head -100`
Identifikovat useState pro týdenní data (pravděpodobně `rows: MachineWeekShiftsRow[]`).

- [ ] **Step 2: Render hodinového labelu pod checkboxem**

Najít JSX každého checkboxu (morning/afternoon/night). Pod `<input type="checkbox" />` přidat:

```tsx
{row.morningOn && (
  <ShiftHoursLabel
    shift="MORNING"
    startMin={row.morningStartMin}
    endMin={row.morningEndMin}
    onEdit={() => openEditor(row, "MORNING")}
    onReset={() => resetOverride(row, "MORNING")}
  />
)}
```

Podobně pro `AFTERNOON`, `NIGHT`.

- [ ] **Step 3: Implementovat komponentu `ShiftHoursLabel`**

Přidat do souboru (nebo extrahovat do `src/components/admin/ShiftHoursLabel.tsx`):

```tsx
import { SHIFT_HOURS, type ShiftType } from "@/lib/shifts";

function ShiftHoursLabel({ shift, startMin, endMin, onEdit, onReset }: {
  shift: ShiftType;
  startMin: number | null;
  endMin: number | null;
  onEdit: () => void;
  onReset: () => void;
}) {
  const def = SHIFT_HOURS[shift];
  const effStart = startMin ?? def.start * 60;
  const effEnd = endMin ?? (def.end < def.start ? def.end : def.end) * 60;
  const isOverride = startMin !== null || endMin !== null;
  const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return (
    <div className="flex items-center gap-1 text-xs mt-0.5">
      <button
        onClick={onEdit}
        className={isOverride ? "text-amber-400 font-medium hover:text-amber-300" : "text-slate-400 hover:text-slate-200"}
      >
        {fmt(effStart)}–{fmt(effEnd)}
      </button>
      {isOverride && (
        <button onClick={onReset} title="Reset na default" className="text-slate-500 hover:text-slate-300">↺</button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: 0 errors, UI ukazuje hodinové labely (zatím read-only, editor až v E2).

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/MachineWorkHoursWeek.tsx
git commit -m "feat(pracovni-doba): Sprint E1 — hodinový label pod checkboxem"
```

---

### Task E2: Popover editor pro override

**Files:**
- Create: `src/components/admin/ShiftHoursPopover.tsx`
- Modify: `src/components/admin/MachineWorkHoursWeek.tsx`

- [ ] **Step 1: Vytvořit komponentu ShiftHoursPopover**

```tsx
"use client";
import { useState } from "react";
import { SHIFT_HOURS, type ShiftType } from "@/lib/shifts";

const RANGES = {
  MORNING:   { start: [240, 480], end: [720, 960] },
  AFTERNOON: { start: [720, 960], end: [1200, 1440] },
  NIGHT:     { start: [1200, 1440], end: [240, 480] },
};

export function ShiftHoursPopover({
  shift, startMin, endMin, onSave, onCancel
}: {
  shift: ShiftType;
  startMin: number | null;
  endMin: number | null;
  onSave: (startMin: number | null, endMin: number | null) => void;
  onCancel: () => void;
}) {
  const def = SHIFT_HOURS[shift];
  const [s, setS] = useState<number>(startMin ?? def.start * 60);
  const [e, setE] = useState<number>(endMin ?? def.end * 60);
  const range = RANGES[shift];
  const stepOptions = (rng: [number, number]) => {
    const out: number[] = [];
    for (let m = rng[0]; m <= rng[1]; m += 30) out.push(m);
    return out;
  };
  const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return (
    <div className="bg-slate-900 border border-slate-700 rounded p-3 shadow-lg w-64">
      <div className="text-sm font-medium mb-2">Upravit hodiny ({shift})</div>
      <div className="flex gap-2 mb-2">
        <label className="flex-1">
          <div className="text-xs text-slate-400">Start</div>
          <select value={s} onChange={(ev) => setS(Number(ev.target.value))}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm">
            {stepOptions(range.start as [number, number]).map((m) => <option key={m} value={m}>{fmt(m)}</option>)}
          </select>
        </label>
        <label className="flex-1">
          <div className="text-xs text-slate-400">Konec</div>
          <select value={e} onChange={(ev) => setE(Number(ev.target.value))}
                  className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm">
            {stepOptions(range.end as [number, number]).map((m) => <option key={m} value={m}>{fmt(m)}</option>)}
          </select>
        </label>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-2 py-1 text-xs text-slate-400 hover:text-slate-200">Zrušit</button>
        <button
          onClick={() => {
            // uložit jen pokud se liší od defaultu
            const isDefaultStart = s === def.start * 60;
            const isDefaultEnd = e === def.end * 60;
            onSave(isDefaultStart ? null : s, isDefaultEnd ? null : e);
          }}
          className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-500 rounded"
        >Uložit</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrace do MachineWorkHoursWeek**

V `MachineWorkHoursWeek.tsx` přidat state `editingOverride: { rowIdx: number; shift: ShiftType } | null` a handlery:

```ts
const [editingOverride, setEditingOverride] = useState<{ rowIdx: number; shift: ShiftType } | null>(null);

function openEditor(rowIdx: number, shift: ShiftType) {
  setEditingOverride({ rowIdx, shift });
}

function saveOverride(rowIdx: number, shift: ShiftType, startMin: number | null, endMin: number | null) {
  const updated = [...rows];
  const r = { ...updated[rowIdx] };
  const prefix = shift === "MORNING" ? "morning" : shift === "AFTERNOON" ? "afternoon" : "night";
  (r as any)[`${prefix}StartMin`] = startMin;
  (r as any)[`${prefix}EndMin`] = endMin;
  updated[rowIdx] = r;
  setRows(updated);
  setDirty(true);
  setEditingOverride(null);
}

function resetOverride(rowIdx: number, shift: ShiftType) {
  saveOverride(rowIdx, shift, null, null);
}
```

A v renderu za kontejner buňky:

```tsx
{editingOverride?.rowIdx === i && editingOverride.shift === "MORNING" && (
  <ShiftHoursPopover shift="MORNING"
    startMin={row.morningStartMin} endMin={row.morningEndMin}
    onSave={(s, e) => saveOverride(i, "MORNING", s, e)}
    onCancel={() => setEditingOverride(null)} />
)}
// + pro AFTERNOON, NIGHT
```

- [ ] **Step 3: Save button posílá overrides v payloadu**

Najít funkci `handleSave` (nebo podobnou) v `MachineWorkHoursWeek.tsx`. Upravit payload tak, aby `days` obsahovaly `morningStartMin`, `morningEndMin`, atd. (dnes pouze flagy).

```ts
const days = rows.map((r) => ({
  dayOfWeek: r.dayOfWeek,
  morningOn: r.morningOn, afternoonOn: r.afternoonOn, nightOn: r.nightOn,
  morningStartMin: r.morningStartMin, morningEndMin: r.morningEndMin,
  afternoonStartMin: r.afternoonStartMin, afternoonEndMin: r.afternoonEndMin,
  nightStartMin: r.nightStartMin, nightEndMin: r.nightEndMin,
}));
```

- [ ] **Step 4: Build + manual test**

Run: `npm run build && npm run dev`
V adminu klik na hodinový label → otevře popover → uložit 13:00 pro morning end → submit → reload → ověř persistenci.
Expected: override se uloží, label zezelenoná (amber), planner ukáže novou mezeru.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/
git commit -m "feat(pracovni-doba): Sprint E2 — popover editor pro override hodin"
```

---

### Task E3: Cascade dialog v adminu

**Files:**
- Create: `src/components/admin/ShiftCascadeDialog.tsx`
- Modify: `src/components/admin/MachineWorkHoursWeek.tsx`

- [ ] **Step 1: Vytvořit cascade dialog**

```tsx
"use client";
type ConflictingBlock = { id: number; jobName: string | null; startTime: string; endTime: string };

export function ShiftCascadeDialog({ conflicts, onConfirm, onCancel }: {
  conflicts: ConflictingBlock[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fmtDate = (iso: string) => new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
  return (
    <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center">
      <div className="bg-slate-900 border border-slate-700 rounded p-4 max-w-lg w-full">
        <div className="text-lg font-medium text-red-400 mb-2">Konflikt s naplánovanými bloky</div>
        <div className="text-sm text-slate-300 mb-3">
          Tyto bloky spadnou mimo pracovní dobu, pokud uložíš změnu:
        </div>
        <ul className="max-h-64 overflow-y-auto text-xs mb-3 border border-slate-700 rounded p-2">
          {conflicts.map((c) => (
            <li key={c.id} className="py-1 border-b border-slate-800 last:border-0">
              <div className="text-slate-200">{c.jobName ?? `Blok #${c.id}`}</div>
              <div className="text-slate-500">{fmtDate(c.startTime)} – {fmtDate(c.endTime)}</div>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">Zrušit změnu</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded">Uložit i přesto</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire v MachineWorkHoursWeek**

Přidat state `cascadeConflicts: ConflictingBlock[] | null` a upravit save flow:

```ts
async function submitSave(force: boolean) {
  const url = `/api/machine-week-shifts${force ? "?force=1" : ""}`;
  const res = await fetch(url, { method: "PUT", body: JSON.stringify({ machine, weekStart, days }) });
  if (res.status === 409) {
    const data = await res.json();
    if (data.error === "SHIFT_SHRINK_CASCADE") {
      setCascadeConflicts(data.conflictingBlocks);
      return;
    }
  }
  // ... ostatní handling
}
```

A v JSX:

```tsx
{cascadeConflicts && (
  <ShiftCascadeDialog
    conflicts={cascadeConflicts}
    onConfirm={() => { setCascadeConflicts(null); submitSave(true); }}
    onCancel={() => setCascadeConflicts(null)}
  />
)}
```

- [ ] **Step 3: Manual test**

Vytvoř blok v 13:30 pondělí. V adminu zkrať morning na 13:00. Submit → dialog ukáže konflikt.
Expected: „Uložit i přesto" → override uloží, blok zůstane mimo provoz (zvýrazněn v planneru).

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/
git commit -m "feat(pracovni-doba): Sprint E3 — cascade dialog při shrinku směny"
```

---

## Sprint F — Planner handles

### Task F1: Drag state `shift-edge-resize`

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:136-170` (typ `DragInternalState`)

- [ ] **Step 1: Rozšířit `DragInternalState`**

Přidat variantu:

```ts
| {
    type: "shift-edge-resize";
    machine: string;
    date: Date;                    // den, kterého se override týká
    shift: "MORNING" | "AFTERNOON";
    edge: "start" | "end";
    origMin: number;               // původní hodnota (min od půlnoci)
    startClientY: number;
    startScrollTop: number;
  };
```

Night exclude pro MVP.

- [ ] **Step 2: State pro live preview**

```ts
const [shiftEdgePreview, setShiftEdgePreview] = useState<{
  machine: string; date: Date; shift: "MORNING" | "AFTERNOON"; edge: "start" | "end";
  previewMin: number;
} | null>(null);
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 errors (zatím nic nekonzumuje).

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat(pracovni-doba): Sprint F1 — DragState pro shift-edge-resize"
```

---

### Task F2: Render handles na aktivních směnách

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` (v místě per-day render, ~2790)

- [ ] **Step 1: Přidat callback prop**

V `interface TimelineGridProps` (kolem řádku 198) přidat:

```ts
onShiftBoundsChange?: (
  machine: string,
  date: Date,
  shift: "MORNING" | "AFTERNOON",
  edge: "start" | "end",
  newMin: number | null  // null = reset na default
) => Promise<void>;
```

V komponentě destructure: `onShiftBoundsChange`.

- [ ] **Step 2: Render handles per den**

V místě, kde se rendrují bloky nebo overlays per den (najdi podle grep — kolem řádku 2790), přidat blok: pro každý aktivní interval z `row.intervals` vytvořit dva handles (start + end).

Konkrétní styl:
- Start handle: `position: absolute; top: {intervalStartY + 2}px; left/right: podle staggered pravidel; width: 28; height: 8; background: rgba(56,189,248,0.85); cursor: ns-resize; border-radius: 4; z-index: 20`.
- End handle: `top: {intervalEndY - 10}px`.

Staggered: pokud je edge sdílený se sousední aktivní směnou (např. morning-end na 14:00 = afternoon-start na 14:00), pak:
- Morning-end: `left: 20%` (transform: translateX(-50%))
- Afternoon-start: `right: 20%` (transform: translateX(50%))

Pseudokód (exact code píše engineer při úpravě):

```tsx
{canEdit && row && row.intervals.map((iv) => {
  if (iv.shift === "NIGHT") return null; // MVP: night bez handles
  const startY = /* převod iv.startMin → pixel Y v kontextu dne */;
  const endY   = /* totéž pro iv.endMin */;
  const sharedStart = row.intervals.some((other) => other.shift !== iv.shift && other.endMin === iv.startMin);
  const sharedEnd   = row.intervals.some((other) => other.shift !== iv.shift && other.startMin === iv.endMin);
  return (
    <>
      {/* Start handle */}
      <div
        style={{
          position: "absolute", top: startY + 2,
          ...(sharedStart
            ? { left: iv.shift === "MORNING" ? "20%" : "auto", right: iv.shift === "AFTERNOON" ? "20%" : "auto", transform: "translateX(-50%)" }
            : { left: "50%", transform: "translateX(-50%)" }),
          width: 28, height: 8, borderRadius: 4,
          background: iv.shift === "MORNING" ? "rgba(251,191,36,0.85)" : "rgba(56,189,248,0.85)",
          cursor: "ns-resize", zIndex: 20, pointerEvents: "auto",
        }}
        title={`${iv.shift === "MORNING" ? "Ranní" : "Odpolední"} start — táhni pro úpravu`}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); e.stopPropagation();
          dragStateRef.current = {
            type: "shift-edge-resize",
            machine, date: d.date, shift: iv.shift, edge: "start",
            origMin: iv.startMin,
            startClientY: e.clientY,
            startScrollTop: scrollRef.current?.scrollTop ?? 0,
          };
          dragDidMove.current = false;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onShiftBoundsChange?.(machine, d.date, iv.shift, "start", null); // reset
        }}
      />
      {/* End handle — obdobně */}
    </>
  );
})}
```

- [ ] **Step 3: Build + visual**

Run: `npm run dev`
V planneru v pondělí (morning + afternoon ON) → vidět 2 modré handles u 6:00, dva u 14:00 (staggered), dva u 22:00.
Expected: handles se objeví, zatím bez drag logiky (mousedown nedělá nic kromě setu dragStateRef).

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat(pracovni-doba): Sprint F2 — render shift-edge handles"
```

---

### Task F3: Drag handling + live preview

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` (handlery v onMouseMove / onMouseUp)

- [ ] **Step 1: MouseMove — update preview**

V existujícím `onMouseMove` handleru (globální listener, ~řádek 2000) přidat větev:

```ts
} else if (ds.type === "shift-edge-resize") {
  const sh = slotHeightRef.current;
  const deltaY = e.clientY - ds.startClientY + ((scrollRef.current?.scrollTop ?? 0) - ds.startScrollTop);
  const deltaMin = Math.round(deltaY / sh) * 30; // slot = 30 min
  const newMinRaw = ds.origMin + deltaMin;
  // Clamp podle rozsahu
  const range = rangeFor(ds.shift, ds.edge);
  const newMin = Math.max(range[0], Math.min(range[1], newMinRaw));
  setShiftEdgePreview({ machine: ds.machine, date: ds.date, shift: ds.shift, edge: ds.edge, previewMin: newMin });
}
```

Kde `rangeFor`:

```ts
function rangeFor(shift: "MORNING" | "AFTERNOON", edge: "start" | "end"): [number, number] {
  if (shift === "MORNING") return edge === "start" ? [240, 480] : [720, 960];
  return edge === "start" ? [720, 960] : [1200, 1440];
}
```

- [ ] **Step 2: MouseUp — commit změny**

V `onMouseUp` (~řádek 2100) přidat větev:

```ts
} else if (ds.type === "shift-edge-resize") {
  const preview = shiftEdgePreview;
  if (preview && preview.previewMin !== ds.origMin) {
    // Pokud nová hodnota = default → pošli null (reset).
    const def = SHIFT_HOURS[ds.shift];
    const defaultMin = ds.edge === "start" ? def.start * 60 : def.end * 60;
    const valueToSend = preview.previewMin === defaultMin ? null : preview.previewMin;
    await callbacksRef.current.onShiftBoundsChange?.(
      ds.machine, ds.date, ds.shift, ds.edge, valueToSend
    );
  }
  setShiftEdgePreview(null);
}
```

- [ ] **Step 3: Živý preview v renderu**

V místě, kde se generují `blockedOverlays` per stroj / den, aplikovat `shiftEdgePreview`: pokud preview odpovídá (machine, date, shift, edge), dočasně nahradit hodnotu v DayScheduleRow před výpočtem overlayů. Přesný patch závisí na tom, jak je vygeneration strukturován — typicky přes `useMemo` který už `shiftEdgePreview` má v deps.

- [ ] **Step 4: Prop drill z PlannerPage**

V `src/app/_components/PlannerPage.tsx` najít kde se renderuje `<TimelineGrid .../>` a přidat prop:

```tsx
onShiftBoundsChange={async (machine, date, shift, edge, newMin) => {
  // 1. Najít row pro (machine, date) v weekShifts state.
  // 2. Poslat PUT /api/machine-week-shifts s upraveným field.
  // 3. Respektovat 409 cascade response (show dialog).
  const field = `${shift.toLowerCase()}${edge === "start" ? "StartMin" : "EndMin"}`;
  // ... helper updateShiftBounds ve PlannerPage
}}
```

Helper `updateShiftBounds` v PlannerPage:

```ts
async function updateShiftBounds(machine: string, date: Date, shift: string, edge: string, newMin: number | null) {
  const dateStr = /* format Prague dateStr */;
  const weekStart = weekStartStrFromDateStr(dateStr);
  const dayOfWeek = /* 0..6 */;
  // Fetch current week rows, patch target row, send PUT.
  const current = weekShiftsRows.filter((w) => w.machine === machine && w.weekStart === weekStart);
  const days = /* 7 dní, target day s updated field */;
  const res = await fetch("/api/machine-week-shifts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ machine, weekStart, days }),
  });
  if (res.status === 409) {
    const data = await res.json();
    if (data.error === "SHIFT_SHRINK_CASCADE") {
      // Cascade handling napojeno v F5 — zatím jen uložit state pro zobrazení dialogu.
      setPlannerCascade({ conflicts: data.conflictingBlocks, pendingPayload: { machine, weekStart, days } });
      return;
    }
  }
  // reload weekShifts (refetch GET pro aktuální týden)
}
```

- [ ] **Step 5: Build + e2e manual**

Run: `npm run build && npm run dev`
V planneru: táhni horní handle u morning z 6:00 na 7:00 → ověř preview se mění → upuštění → PUT → reload → šrafování zobrazuje 6–7 jako blocked.
Expected: funguje + persistentní.

- [ ] **Step 6: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(pracovni-doba): Sprint F3 — drag handling shift-edge s live preview"
```

---

### Task F4: Shift-modifier pro joint drag

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`

- [ ] **Step 1: Zaznamenat `shiftKey` při mousedown**

V dragState přidat `jointDrag: boolean`:

```ts
| {
    type: "shift-edge-resize";
    ...
    jointDrag: boolean;  // true když uživatel držel Shift při mousedown
  }
```

V mousedown handler nastavit `jointDrag: e.shiftKey`.

- [ ] **Step 2: Při mouseUp pokud jointDrag → update dvě pole**

Pokud `ds.jointDrag === true` a edge je sdílený s jinou aktivní směnou, poslat DVA update:
- Např. morning-end drag z 14 na 13 s Shift → update `morningEndMin = 780` AND `afternoonStartMin = 780`.

Nejčistší: v `onShiftBoundsChange` v PlannerPage při `jointDrag` poslat payload se 2 fieldy upravenými najednou. Rozšířit signaturu callbacku:

```ts
onShiftBoundsChange?: (
  machine: string, date: Date, shift: ..., edge: ..., newMin: number | null,
  joint?: boolean
) => Promise<void>;
```

- [ ] **Step 3: Manual test**

V planneru držet Shift + táhnout morning-end → ověřit, že afternoon-start se posune taky.
Expected: obě hranice sladěné.

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/
git commit -m "feat(pracovni-doba): Sprint F4 — Shift modifier pro joint drag"
```

---

### Task F5: Cascade dialog v planneru

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 1: Reuse `ShiftCascadeDialog` ze Sprintu E3**

Přidat state + render v PlannerPage:

```tsx
const [plannerCascade, setPlannerCascade] = useState<{
  conflicts: ConflictingBlock[];
  pendingPayload: any; // payload pro force retry
} | null>(null);

// při 409 v updateShiftBounds:
setPlannerCascade({ conflicts: data.conflictingBlocks, pendingPayload: { machine, weekStart, days } });

// v JSX:
{plannerCascade && (
  <ShiftCascadeDialog
    conflicts={plannerCascade.conflicts}
    onConfirm={async () => {
      await fetch("/api/machine-week-shifts?force=1", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plannerCascade.pendingPayload),
      });
      setPlannerCascade(null);
      await refetchWeekShifts();
    }}
    onCancel={() => setPlannerCascade(null)}
  />
)}
```

- [ ] **Step 2: Manual test**

Vytvořit blok v 13:30. Táhnout morning end na 13:00 v planneru. Dialog ukáže blok → potvrdit → update projde s `force=1`, blok zůstane v mezeře.

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(pracovni-doba): Sprint F5 — cascade dialog v planneru"
```

---

## Sprint G — Polish

### Task G1: Update reportMetrics.ts

**Files:**
- Modify: `src/lib/reportMetrics.ts`

- [ ] **Step 1: Najít kalkulaci pracovní kapacity**

Run: `grep -n "startHour\|endHour" src/lib/reportMetrics.ts`
Identifikovat místo, kde se z `DayScheduleRow` počítá denní kapacita.

- [ ] **Step 2: Použít `intervals` pole**

Nahradit:

```ts
const dayMinutes = (row.endHour - row.startHour) * 60;
```

Za:

```ts
const dayMinutes = row.intervals.reduce((sum, iv) => {
  const span = iv.endMin < iv.startMin
    ? (1440 - iv.startMin) + iv.endMin
    : iv.endMin - iv.startMin;
  return sum + span;
}, 0);
```

- [ ] **Step 3: Update test**

V `src/lib/reportMetrics.test.ts` rozšířit mock data o `intervals: []` (pro neaktivní dny) nebo s jedním intervalem (pro defaultní dny).

- [ ] **Step 4: Run testy**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "feat(pracovni-doba): Sprint G1 — reportMetrics počítá intervaly"
```

---

### Task G2: Server-side validace testy

**Files:**
- Modify: `src/lib/scheduleValidationServer.test.ts`

- [ ] **Step 1: Přidat test s mocknutou Prismou, která vrací override**

```ts
test("validateBlockScheduleFromDb — override morningEnd=13, blok 13:15–13:45 → violation", async (t) => {
  t.mock.module("@/lib/prisma", {
    namedExports: {
      prisma: {
        machineWeekShifts: {
          findMany: async () => [/* row s morningEndMin: 780, ... */]
        },
        // ... ostatní mock metody
      }
    }
  });
  const { validateBlockScheduleFromDb } = await import("./scheduleValidationServer");
  const result = await validateBlockScheduleFromDb(
    "XL_105",
    new Date("2026-04-13T11:15:00.000Z"),
    new Date("2026-04-13T11:45:00.000Z"),
    "ZAKAZKA",
    false
  );
  assert.notEqual(result, null);
  assert.equal(result?.error.includes("mimo provoz"), true);
});
```

- [ ] **Step 2: Run**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduleValidationServer.test.ts
git commit -m "test(pracovni-doba): Sprint G2 — validateBlockScheduleFromDb test s overrides"
```

---

### Task G3: Smoke test checklist

**Files:**
- Nevytvářet nic. Manuální průchod.

- [ ] **Krok 1: Admin editor ukládá override**
  V adminu nastav morningEnd=13:00 pro pondělí XL_105, ulož.
  Expected: JSON v síťové záložce obsahuje `morningEndMin: 780`. Reload stránky → label zobrazuje 6:00–13:00 amber.

- [ ] **Krok 2: Planner zobrazí mezeru**
  V planneru přejdi na pondělí.
  Expected: šrafování 13:00–14:00 viditelné (gap mezi ranní a odpolední).

- [ ] **Krok 3: Drag handle v planneru**
  Táhni handle u morning-end z 13:00 zpět na 14:00.
  Expected: mezera zmizí, label v adminu zezelená na default.

- [ ] **Krok 4: Cascade — admin**
  Vytvoř blok 13:30 pondělí. Zkrať morning na 13:00 → dialog → potvrdit.
  Expected: blok vizuálně v červené zóně, ale neodstraněn.

- [ ] **Krok 5: Cascade — planner**
  Stejný scénář ale tažením v planneru.
  Expected: dialog → potvrdit → stejný výsledek.

- [ ] **Krok 6: Shift modifier**
  V planneru Shift+drag morning-end.
  Expected: afternoon-start se posune spolu.

- [ ] **Krok 7: Right-click reset**
  Pravý klik na handle s overridem.
  Expected: override se resetuje na default.

- [ ] **Krok 8: Validace rozsahů**
  Pokusit se přes API PUT poslat `morningStartMin: 60` (1:00, mimo rozsah 4–8).
  Expected: 400 s `"Ranní start musí být 4:00–8:00"`.

- [ ] **Krok 9: Noční směna v adminu**
  Nastav `nightEndMin: 420` (7:00) přes admin popover pro pondělí.
  Expected: v planneru v úterý ráno vidět šrafování od 7:00 do (default) 6:00... pozor — pondělní noční končí úterý ráno. Ověř že šrafování úterý 6:00–7:00 se chová správně.

- [ ] **Krok 10: Commit finálních úprav**

Pokud smoke odhalí bug, opravit, commitnout, znovu proběhnout checklist.

---

## Completion Criteria

- [ ] Všechny testy zelené: `node --test --import tsx src/lib/shifts.test.ts src/lib/scheduleValidation.test.ts` + `node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts`
- [ ] `npm run build` bez chyb
- [ ] `npm run lint` bez nových warningů
- [ ] Smoke checklist G3 projde
- [ ] Admin i planner mohou měnit overrides bez `prisma.machineScheduleException` (tabulka neexistuje — verifikace, že nic ji nepoužívá)
- [ ] Audit log zaznamenává overrides v `MachineWeekShifts UPDATE` záznamech

---

## Out of scope (ponecháno na později)

- Handles pro noční směnu v planneru (nutno cross-day rendering).
- Bulk operation „nastav hranice pro celý týden najednou".
- Konfigurovatelné default hodiny per stroj.
- Přenesení overrides při manuální copy-week operaci (pokud copy-week v adminu existuje — ověřit; aktuálně v `MachineWorkHoursWeek.tsx` copy-week funkce není).
