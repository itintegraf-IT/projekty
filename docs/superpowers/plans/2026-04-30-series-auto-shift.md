# Auto-shift při plánování série Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Když plánovač zadá sérii a některé sloty se trefí do obsazeného času nebo mimo pracovní dobu, systém automaticky najde nejbližší volný slot (max +7 dní), naplánuje tam blok, zapíše audit záznam `AUTO_SHIFT` a uživateli ukáže info-toast s původním a novým časem.

**Architecture:** Hybrid (varianta C). Sdílená pure funkce `findNextFreeSlot` v `src/lib/scheduleSlotFinder.ts` slouží jak klientskému previewu (state-based), tak serveru (DB-based wrapper). Server v `POST /api/blocks` přijímá nový opt-in flag `autoShiftIfBusy`. Pokud původní validace nebo overlap check selžou a flag je `true`, server slot najde znovu proti čerstvé DB (race-safe), blok vytvoří v transakci spolu s druhým auditním záznamem `action="AUTO_SHIFT"`, a v response přidá `autoShift: { originalStart }`.

**Tech Stack:** TypeScript, Next.js App Router API routes, Prisma 5 (MySQL), node:test (`--import tsx`, mock.module), existující helpery `snapToNextValidStartWithTemplates`, `validateBlockScheduleFromDb`, `checkBlockOverlap`.

---

## File Structure

**Create:**
- `src/lib/scheduleSlotFinder.ts` — pure `findNextFreeSlot` + server wrapper `findNextFreeSlotFromDb`. Sdílí logiku working-hours snap (přes existující `snapToNextValidStartWithTemplates`) a doplňuje skip přes `BlockedInterval[]`.
- `src/lib/scheduleSlotFinder.test.ts` — unit testy pure funkce. Žádné mocky DB potřeba.
- `src/lib/scheduleSlotFinder.server.test.ts` — integrační test wrapperu s `mock.module()` Prismy (vyžaduje `--experimental-test-module-mocks`).

**Modify:**
- `src/app/api/blocks/route.ts:50-233` — POST handler: zpracování `autoShiftIfBusy`, druhý audit záznam, rozšíření response.
- `src/app/_components/PlannerPage.tsx:2107` — `generateSeriesPreview`: použít pure helper, posun v previewu, přidat pole `wasShifted` + `originalHour` do preview prvků.
- `src/app/_components/PlannerPage.tsx:569` — typ `seriesPreview` rozšířit o `wasShifted`/`originalHour`.
- `src/app/_components/PlannerPage.tsx:3577-3700` — UI preview: vyznačit posunuté sloty (žluté pozadí + tooltip).
- `src/app/_components/PlannerPage.tsx:2027-2096` — `handleScheduleSeries`: posílat `autoShiftIfBusy: true`, číst `autoShift.originalStart` z response, ukázat info-toast pro každý posunutý blok.

**No DB schema changes** — `AuditLog` model už má pole `action`, `field`, `oldValue`, `newValue`.

---

## Task 1: Pure `findNextFreeSlot` + testy

**Files:**
- Create: `src/lib/scheduleSlotFinder.ts`
- Create: `src/lib/scheduleSlotFinder.test.ts`

- [ ] **Step 1.1: Vytvořit prázdný modul s typy a konstantami**

```typescript
// src/lib/scheduleSlotFinder.ts
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";

/** Maximální posun při auto-shiftu — 7 kalendářních dní v ms. */
export const MAX_AUTO_SHIFT_MS = 7 * 24 * 60 * 60 * 1000;

/** Obsazený interval (existující blok nebo firemní odstávka). */
export type BlockedInterval = { start: Date; end: Date };

export type SlotSearchResult =
  | { found: true; startTime: Date; endTime: Date; wasShifted: boolean }
  | { found: false; reason: "MAX_SHIFT_EXCEEDED" };

/**
 * Najde nejbližší volný slot na stroji, který:
 *  1) splňuje pracovní dobu (přes weekShifts grid)
 *  2) nekoliduje s žádným z `blockedIntervals`
 *  3) je do `maxShiftMs` od `proposedStart`
 *
 * Pure function — žádné DB volání. Klient ji volá s state.blocks,
 * server (přes wrapper findNextFreeSlotFromDb) s DB query.
 */
export function findNextFreeSlot(
  machine: string,
  proposedStart: Date,
  durationMs: number,
  blockedIntervals: BlockedInterval[],
  weekShifts: MachineWeekShiftsRow[],
  maxShiftMs: number = MAX_AUTO_SHIFT_MS
): SlotSearchResult {
  const limit = proposedStart.getTime() + maxShiftMs;
  let candidate = proposedStart;

  // Bezpečnostní strop iterací (snap+kolize střídání)
  for (let i = 0; i < 100; i++) {
    // 1) Snap na pracovní dobu
    const snapped = snapToNextValidStartWithTemplates(machine, candidate, durationMs, weekShifts);
    if (snapped.getTime() > limit) {
      return { found: false, reason: "MAX_SHIFT_EXCEEDED" };
    }
    const snappedEnd = new Date(snapped.getTime() + durationMs);

    // 2) Najdi první kolidující obsazený interval
    const conflict = blockedIntervals.find(
      (b) => b.start.getTime() < snappedEnd.getTime() && b.end.getTime() > snapped.getTime()
    );
    if (!conflict) {
      const wasShifted = snapped.getTime() !== proposedStart.getTime();
      return { found: true, startTime: snapped, endTime: snappedEnd, wasShifted };
    }

    // 3) Posuň kandidát na konec kolize a opakuj (snap může vrátit ještě dál kvůli pracovní době)
    candidate = conflict.end;
  }

  return { found: false, reason: "MAX_SHIFT_EXCEEDED" };
}
```

- [ ] **Step 1.2: Vytvořit testovací skeleton**

```typescript
// src/lib/scheduleSlotFinder.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findNextFreeSlot, MAX_AUTO_SHIFT_MS, type BlockedInterval } from "./scheduleSlotFinder";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

const MACHINE = "XL_105";
const HOUR_MS = 60 * 60 * 1000;

/** Helper: prázdný weekShifts → fallback na hardcoded working hours (XL_105: 24/7 mimo neděli odpoledne). */
const NO_SHIFTS: MachineWeekShiftsRow[] = [];
```

- [ ] **Step 1.3: Test — volný slot vrátí původní čas s `wasShifted: false`**

```typescript
describe("findNextFreeSlot", () => {
  it("vrátí původní čas když je slot volný a v pracovní době", () => {
    const start = new Date("2026-09-15T10:00:00.000Z"); // úterý ráno UTC = poledne Praha
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, [], NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.getTime(), start.getTime());
      assert.equal(result.wasShifted, false);
    }
  });
});
```

- [ ] **Step 1.4: Test — kolize s existujícím blokem posune za jeho konec**

```typescript
  it("posune slot za konec kolidujícího bloku", () => {
    const start = new Date("2026-09-15T12:00:00.000Z");
    const blocked: BlockedInterval[] = [
      // Kolize končí v 16:00Z = 18:00 Praha (CEST) — stále v pracovní době XL_105
      { start: new Date("2026-09-15T12:00:00.000Z"), end: new Date("2026-09-15T16:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.toISOString(), "2026-09-15T16:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });
```

**Pozn.:** `NO_SHIFTS = []` triggeruje hardcoded fallback v `workingTime.ts`, který pro XL_105 blokuje noci 22:00–06:00 Praha (= 20:00Z–04:00Z UTC v CEST). Proto kolize končí v 16:00Z (18:00 Praha) — stále v pracovní době.
```

- [ ] **Step 1.5: Test — více kolizí za sebou → posune dál**

```typescript
  it("přeskočí přes řadu kolidujících bloků", () => {
    const start = new Date("2026-09-15T12:00:00.000Z");
    const blocked: BlockedInterval[] = [
      { start: new Date("2026-09-15T12:00:00.000Z"), end: new Date("2026-09-15T16:00:00.000Z") },
      { start: new Date("2026-09-15T16:00:00.000Z"), end: new Date("2026-09-15T20:00:00.000Z") },
      { start: new Date("2026-09-15T20:00:00.000Z"), end: new Date("2026-09-16T04:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 2 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.toISOString(), "2026-09-16T04:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });
```

- [ ] **Step 1.6: Test — kolize nepřesahující slot vrací neposunutý čas**

```typescript
  it("nepoškozená kolize (blok končí před proposedStart) → žádný posun", () => {
    // proposedStart = 16:00Z = 18:00 Praha (CEST) — v pracovní době XL_105
    const start = new Date("2026-09-15T16:00:00.000Z");
    const blocked: BlockedInterval[] = [
      { start: new Date("2026-09-15T10:00:00.000Z"), end: new Date("2026-09-15T16:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.getTime(), start.getTime());
      assert.equal(result.wasShifted, false);
    }
  });
```

- [ ] **Step 1.7: Test — překročení 7 dní vrátí `found: false`**

```typescript
  it("vrátí MAX_SHIFT_EXCEEDED když je obsazené déle než 7 dní", () => {
    const start = new Date("2026-09-15T12:00:00.000Z");
    const blocked: BlockedInterval[] = [
      { start: new Date("2026-09-15T12:00:00.000Z"), end: new Date("2026-09-30T00:00:00.000Z") },
    ];
    const result = findNextFreeSlot(MACHINE, start, 4 * HOUR_MS, blocked, NO_SHIFTS);
    assert.equal(result.found, false);
    if (!result.found) {
      assert.equal(result.reason, "MAX_SHIFT_EXCEEDED");
    }
  });
```

- [ ] **Step 1.8: Test — `MAX_AUTO_SHIFT_MS` je 7 dní v ms**

```typescript
  it("MAX_AUTO_SHIFT_MS = 7 dní", () => {
    assert.equal(MAX_AUTO_SHIFT_MS, 7 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 1.9: Spustit testy**

Run: `node --test --import tsx src/lib/scheduleSlotFinder.test.ts`
Expected: `# pass 6` (všech 6 testů zelených)

- [ ] **Step 1.10: Commit**

```bash
git add src/lib/scheduleSlotFinder.ts src/lib/scheduleSlotFinder.test.ts
git commit -m "feat(scheduling): pure findNextFreeSlot helper + unit testy"
```

---

## Task 2: Server wrapper `findNextFreeSlotFromDb`

**Files:**
- Modify: `src/lib/scheduleSlotFinder.ts` (přidat wrapper)
- Create: `src/lib/scheduleSlotFinder.server.test.ts`

- [ ] **Step 2.1: Přidat wrapper do `scheduleSlotFinder.ts`**

```typescript
// na konec src/lib/scheduleSlotFinder.ts
import { prisma } from "@/lib/prisma";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { pragueOf } from "@/lib/dateUtils";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";

/**
 * DB wrapper kolem findNextFreeSlot.
 * Načte weekShifts pro relevantní okno (proposedStart + maxShiftMs + buffer)
 * a všechny existující bloky na stroji v témže okně + firemní odstávky.
 *
 * `excludeBlockId` se použije při PUT (úprava bloku — nesmí kolidovat sám se sebou).
 */
export async function findNextFreeSlotFromDb(
  machine: string,
  proposedStart: Date,
  durationMs: number,
  excludeBlockId: number | null = null,
  maxShiftMs: number = MAX_AUTO_SHIFT_MS
): Promise<SlotSearchResult> {
  const windowEnd = new Date(proposedStart.getTime() + maxShiftMs + durationMs);

  // Týdny, kterých se okno dotýká
  const weekStarts = new Set<string>();
  for (let t = proposedStart.getTime(); t <= windowEnd.getTime(); t += 24 * 60 * 60 * 1000) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  const weekStartDates = Array.from(weekStarts).map((s) => new Date(`${s}T00:00:00.000Z`));

  const [rawWeekShifts, blocks, companyDays] = await Promise.all([
    prisma.machineWeekShifts.findMany({
      where: { machine, weekStart: { in: weekStartDates } },
    }),
    prisma.block.findMany({
      where: {
        machine,
        ...(excludeBlockId != null ? { id: { not: excludeBlockId } } : {}),
        startTime: { lt: windowEnd },
        endTime: { gt: proposedStart },
      },
      select: { startTime: true, endTime: true },
    }),
    prisma.companyDay.findMany({
      where: {
        startDate: { lt: windowEnd },
        endDate: { gt: proposedStart },
        OR: [{ machine: null }, { machine }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const blockedIntervals: BlockedInterval[] = [
    ...blocks.map((b) => ({ start: b.startTime, end: b.endTime })),
    ...companyDays.map((c) => ({ start: c.startDate, end: c.endDate })),
  ];

  const weekShifts = serializeWeekShifts(rawWeekShifts);
  return findNextFreeSlot(machine, proposedStart, durationMs, blockedIntervals, weekShifts, maxShiftMs);
}
```

- [ ] **Step 2.2: Test skeleton s mock.module pro Prismu**

```typescript
// src/lib/scheduleSlotFinder.server.test.ts
import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";

// Mocky musí být před importem testované funkce
const mockBlocks: Array<{ startTime: Date; endTime: Date }> = [];
const mockCompanyDays: Array<{ startDate: Date; endDate: Date }> = [];
const mockWeekShifts: unknown[] = [];

await mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      machineWeekShifts: { findMany: mock.fn(async () => mockWeekShifts) },
      block: { findMany: mock.fn(async () => mockBlocks) },
      companyDay: { findMany: mock.fn(async () => mockCompanyDays) },
    },
  },
});

await mock.module("@/lib/scheduleValidation", {
  namedExports: { serializeWeekShifts: mock.fn(() => []) },
});

const { findNextFreeSlotFromDb } = await import("@/lib/scheduleSlotFinder");

const MACHINE = "XL_105";
const HOUR_MS = 60 * 60 * 1000;
```

- [ ] **Step 2.3: Test — prázdná DB → volný slot**

```typescript
describe("findNextFreeSlotFromDb", () => {
  beforeEach(() => {
    mockBlocks.length = 0;
    mockCompanyDays.length = 0;
  });

  it("prázdná DB → vrátí původní čas, wasShifted=false", async () => {
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.getTime(), start.getTime());
      assert.equal(result.wasShifted, false);
    }
  });
});
```

- [ ] **Step 2.4: Test — existující blok v DB → posune za něj**

```typescript
  it("kolize s existujícím blokem v DB → posune za jeho konec", async () => {
    mockBlocks.push({
      startTime: new Date("2026-09-15T10:00:00.000Z"),
      endTime: new Date("2026-09-15T18:00:00.000Z"),
    });
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.toISOString(), "2026-09-15T18:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });
```

- [ ] **Step 2.5: Test — companyDay (odstávka) brán jako překážka**

```typescript
  it("firemní odstávka brání slotu", async () => {
    mockCompanyDays.push({
      startDate: new Date("2026-09-15T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
    });
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.startTime.toISOString(), "2026-09-16T00:00:00.000Z");
      assert.equal(result.wasShifted, true);
    }
  });
```

- [ ] **Step 2.6: Test — > 7 dní obsazeno → MAX_SHIFT_EXCEEDED**

```typescript
  it("> 7 dní obsazeno → MAX_SHIFT_EXCEEDED", async () => {
    mockBlocks.push({
      startTime: new Date("2026-09-15T00:00:00.000Z"),
      endTime: new Date("2026-09-30T00:00:00.000Z"),
    });
    const start = new Date("2026-09-15T10:00:00.000Z");
    const result = await findNextFreeSlotFromDb(MACHINE, start, 4 * HOUR_MS);
    assert.equal(result.found, false);
    if (!result.found) {
      assert.equal(result.reason, "MAX_SHIFT_EXCEEDED");
    }
  });
```

- [ ] **Step 2.7: Spustit testy**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/scheduleSlotFinder.server.test.ts`
Expected: `# pass 4`

- [ ] **Step 2.8: Commit**

```bash
git add src/lib/scheduleSlotFinder.ts src/lib/scheduleSlotFinder.server.test.ts
git commit -m "feat(scheduling): findNextFreeSlotFromDb wrapper + integration testy"
```

---

## Task 3: Server `POST /api/blocks` — `autoShiftIfBusy` + AUTO_SHIFT audit

**Files:**
- Modify: `src/app/api/blocks/route.ts:50-233`

- [ ] **Step 3.1: Přidat import slot finderu**

V hlavičce souboru (po `import { checkBlockOverlap } from "@/lib/overlapCheck";`):

```typescript
import { findNextFreeSlotFromDb } from "@/lib/scheduleSlotFinder";
```

- [ ] **Step 3.2: Před voláním `validateBlockScheduleFromDb` připravit autoShift state**

Najít [route.ts:67-80](src/app/api/blocks/route.ts#L67-L80) a nahradit blok validace tímto:

```typescript
    // Server-side validace pracovní doby (jen pro ZAKAZKA)
    const blockType = body.type ?? "ZAKAZKA";
    const blockVariant = normalizeBlockVariant(body.blockVariant, blockType);
    const bypassScheduleValidation = body.bypassScheduleValidation === true;
    const bypassOverlapCheck = body.bypassOverlapCheck === true;
    const autoShiftIfBusy = body.autoShiftIfBusy === true;

    let startTime = new Date(body.startTime);
    let endTime = new Date(body.endTime);
    const originalStart = new Date(body.startTime);
    const durationMs = endTime.getTime() - startTime.getTime();
    let wasShifted = false;

    const scheduleError = await validateBlockScheduleFromDb(
      body.machine as string, startTime, endTime, blockType, bypassScheduleValidation
    );
    if (scheduleError) {
      if (!autoShiftIfBusy) {
        return NextResponse.json({ error: scheduleError.error }, { status: 422 });
      }
      // Auto-shift: najdi nejbližší volný slot
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
    }
```

- [ ] **Step 3.3: V transakci — pokud overlap selže a autoShift je aktivní, zkusit znovu**

Najít [route.ts:116-118](src/app/api/blocks/route.ts#L116-L118) (volání `checkBlockOverlap`) a obalit ho takto:

```typescript
      if (!bypassOverlapCheck) {
        try {
          await checkBlockOverlap(body.machine, startTime, endTime, null, tx);
        } catch (overlapErr) {
          if (!autoShiftIfBusy || !isAppError(overlapErr) || overlapErr.code !== "OVERLAP") {
            throw overlapErr;
          }
          // Race condition: slot byl mezi pre-check a transakcí obsazen.
          // Zkusit najít znovu — uvnitř transakce čteme přes prisma (ne tx),
          // protože helper potřebuje vlastní query a najít volné okno mimo
          // aktuálně rozdělanou transakci je dostatečné (race se opakuje max 1×).
          const slot = await findNextFreeSlotFromDb(body.machine, startTime, durationMs);
          if (!slot.found) {
            throw new AppError(
              "OVERLAP",
              `Auto-shift selhal: stroj ${body.machine} obsazen déle než 7 dní od ${originalStart.toISOString()}.`
            );
          }
          startTime = slot.startTime;
          endTime = slot.endTime;
          wasShifted = true;
          // Po posunu už musí overlap projít (kontrolujeme ještě jednou pro jistotu)
          await checkBlockOverlap(body.machine, startTime, endTime, null, tx);
        }
      }
```

Přidat import `AppError` na začátek souboru, pokud chybí:

```typescript
import { AppError, isAppError } from "@/lib/errors";
```

- [ ] **Step 3.4: V `tx.block.create` použít posunuté časy**

Najít [route.ts:120-167](src/app/api/blocks/route.ts#L120-L167) a změnit `startTime`/`endTime` v `data:` objektu:

```typescript
      const newBlock = await tx.block.create({
        data: {
          orderNumber: finalOrderNumber,
          machine: body.machine,
          startTime,
          endTime,
          // ... zbytek beze změny
```

(Stačí nahradit `startTime: new Date(body.startTime)` za `startTime,` a `endTime: new Date(body.endTime)` za `endTime,` — ostatní pole zůstávají.)

- [ ] **Step 3.5: Druhý audit záznam pro AUTO_SHIFT**

Hned za `tx.auditLog.create({ data: { ..., action: "CREATE" } })` (route.ts:169-177) přidat:

```typescript
      if (wasShifted) {
        await tx.auditLog.create({
          data: {
            blockId: newBlock.id,
            orderNumber: newBlock.orderNumber,
            userId: session.id,
            username: session.username,
            action: "AUTO_SHIFT",
            field: "startTime",
            oldValue: originalStart.toISOString(),
            newValue: startTime.toISOString(),
          },
        });
      }
```

- [ ] **Step 3.6: Rozšířit response o `autoShift`**

Najít [route.ts:215-216](src/app/api/blocks/route.ts#L215-L216) (návrat) a změnit na:

```typescript
    emitSSE("block:created", { block: serializeBlock(block), machine: block.machine, sourceUserId: session.id });
    const responseBody = wasShifted
      ? { ...serializeBlock(block), autoShift: { originalStart: originalStart.toISOString() } }
      : serializeBlock(block);
    return NextResponse.json(responseBody, { status: 201 });
```

(Pozn.: `wasShifted` je proměnná z outer scope — `tx` jí předává hodnotu mutací. V Prisma `$transaction(async (tx) => …)` se vrácená hodnota ze callbacku přiřadí do `block`, takže mutace `wasShifted` funguje.)

- [ ] **Step 3.7: Sanity check — type check**

Run: `npx tsc --noEmit`
Expected: žádné nové chyby v `src/app/api/blocks/route.ts`.

- [ ] **Step 3.8: Manual smoke test (curl) — happy path bez shiftu**

Spustit dev server: `npm run dev`. V dalším terminálu:

```bash
# Login & cookie cesta — zjisti session cookie z /api/auth/login (běžný workflow).
# Předpoklad: cookie uložená v /tmp/cookie.txt
curl -s -X POST http://localhost:3000/api/blocks \
  -H "Content-Type: application/json" \
  -b /tmp/cookie.txt \
  -d '{
    "orderNumber": "TEST-AUTO-1",
    "machine": "XL_105",
    "startTime": "2027-01-15T08:00:00.000Z",
    "endTime": "2027-01-15T12:00:00.000Z",
    "type": "ZAKAZKA",
    "autoShiftIfBusy": true
  }' | jq
```

Expected: status 201, response **bez** `autoShift` pole (slot byl volný).

- [ ] **Step 3.9: Manual smoke test — vynucená kolize → posun**

```bash
# Druhý request na stejné start time — měl by se posunout.
curl -s -X POST http://localhost:3000/api/blocks \
  -H "Content-Type: application/json" \
  -b /tmp/cookie.txt \
  -d '{
    "orderNumber": "TEST-AUTO-2",
    "machine": "XL_105",
    "startTime": "2027-01-15T08:00:00.000Z",
    "endTime": "2027-01-15T12:00:00.000Z",
    "type": "ZAKAZKA",
    "autoShiftIfBusy": true
  }' | jq
```

Expected: status 201, response obsahuje `"autoShift": { "originalStart": "2027-01-15T08:00:00.000Z" }`, `startTime` je posunut na `2027-01-15T12:00:00.000Z`.

Ověřit AuditLog v DB:
```bash
mysql -u root -pmysql igvyroba -e "SELECT id, blockId, action, field, oldValue, newValue FROM AuditLog WHERE action='AUTO_SHIFT' ORDER BY id DESC LIMIT 5;"
```
Expected: záznam s `action=AUTO_SHIFT`, `field=startTime`, `oldValue` a `newValue` ISO řetězce.

**Cleanup po testu:**
```bash
mysql -u root -pmysql igvyroba -e "DELETE FROM Block WHERE orderNumber LIKE 'TEST-AUTO-%';"
```

- [ ] **Step 3.10: Commit**

```bash
git add src/app/api/blocks/route.ts
git commit -m "feat(api): autoShiftIfBusy flag pro POST /api/blocks + AUTO_SHIFT audit"
```

---

## Task 4: Klient — preview snap v `generateSeriesPreview`

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:569` (rozšířit typ `seriesPreview`)
- Modify: `src/app/_components/PlannerPage.tsx:2107-2130` (`generateSeriesPreview` + `useEffect` regenerace)

**Pre-task kontext** (ověřeno čtením souboru):
- `state.machineWeekShifts: MachineWeekShiftsRow[]` **už existuje** (používá se v `handleQueueDrop` na řádku 2180).
- `state.blocks: Block[]` existuje (planner state).
- `bSeriesMachine: string` existuje (state pro výběr stroje série).
- `durationHours: number` existuje (state pro délku bloku).
- Stávající `generateSeriesPreview` je 10 řádků: vytvoří array UTC-noon dat, pro každý push `{ date: ISO.slice(0,10), hour: firstHour, ... }`, posune `cur` přes `addRecurrenceInterval`.

- [ ] **Step 4.1: Rozšířit typ `seriesPreview` state**

V [PlannerPage.tsx:569](src/app/_components/PlannerPage.tsx#L569) změnit:

```typescript
const [seriesPreview, setSeriesPreview] = useState<Array<{
  date: string;
  hour: number;
  dataRequiredDate: string;
  deadlineExpedice: string;
  wasShifted: boolean;
  originalDate: string;
  originalHour: number;
}>>([]);
```

- [ ] **Step 4.2: Doplnit importy**

Najít blok importů (~PlannerPage.tsx:1-50) a přidat:

```typescript
import { findNextFreeSlot } from "@/lib/scheduleSlotFinder";
```

Ověřit, že `pragueToUTC`, `utcToPragueDateStr`, `utcToPragueHour` jsou importované z `@/lib/dateUtils`. Pokud `utcToPragueDateStr`/`utcToPragueHour` nejsou v importech, doplnit:

```bash
grep -n "from \"@/lib/dateUtils\"" src/app/_components/PlannerPage.tsx
```

a podle existujícího importu jen doplnit chybějící named exports.

- [ ] **Step 4.3: Přepsat `generateSeriesPreview`**

V [PlannerPage.tsx:2107-2117](src/app/_components/PlannerPage.tsx#L2107-L2117) nahradit celou funkci:

```typescript
  function generateSeriesPreview(
    firstDate: string,
    firstHour: number,
    count: number,
    rType: string,
    defaultDataDate: string,
    defaultExpedice: string,
    machine: string,
    durationH: number,
    allBlocks: Block[],
    weekShifts: MachineWeekShiftsRow[]
  ): Array<{
    date: string; hour: number; dataRequiredDate: string; deadlineExpedice: string;
    wasShifted: boolean; originalDate: string; originalHour: number;
  }> {
    if (!firstDate || rType === "NONE" || count < 1) return [];
    const occurrences: Array<{
      date: string; hour: number; dataRequiredDate: string; deadlineExpedice: string;
      wasShifted: boolean; originalDate: string; originalHour: number;
    }> = [];

    const durationMs = durationH * 3600000;

    // Sbíráme obsazené intervaly: stávající bloky stroje + sloty,
    // které jsme v této sérii právě naplánovali (aby další iterace
    // brala "samu sebe" jako obsazenou).
    const blockedIntervals: Array<{ start: Date; end: Date }> = allBlocks
      .filter((b) => b.machine === machine)
      .map((b) => ({ start: new Date(b.startTime), end: new Date(b.endTime) }));

    // UTC noon — bezpečné pro aritmetiku celých dnů ve všech timezone (zachovat současné chování).
    let cur = new Date(firstDate + "T12:00:00.000Z");
    for (let i = 0; i < count; i++) {
      const originalDate = cur.toISOString().slice(0, 10);
      const originalHour = firstHour;
      const proposed = pragueToUTC(originalDate, originalHour);
      const slot = findNextFreeSlot(machine, proposed, durationMs, blockedIntervals, weekShifts);

      if (slot.found) {
        const finalDate = utcToPragueDateStr(slot.startTime);
        const finalHour = utcToPragueHour(slot.startTime);
        blockedIntervals.push({ start: slot.startTime, end: slot.endTime });
        occurrences.push({
          date: finalDate,
          hour: finalHour,
          dataRequiredDate: defaultDataDate,
          deadlineExpedice: defaultExpedice,
          wasShifted: slot.wasShifted,
          originalDate,
          originalHour,
        });
      } else {
        // Slot se nepodařilo najít do 7 dní — zařadit s původním časem.
        // Server odmítne 409, klient ukáže chybový toast v handleScheduleSeries.
        occurrences.push({
          date: originalDate,
          hour: originalHour,
          dataRequiredDate: defaultDataDate,
          deadlineExpedice: defaultExpedice,
          wasShifted: false,
          originalDate,
          originalHour,
        });
      }

      cur = addRecurrenceInterval(cur, rType);
    }
    return occurrences;
  }
```

- [ ] **Step 4.4: Aktualizovat `useEffect` regeneraci**

V [PlannerPage.tsx:2123-2130](src/app/_components/PlannerPage.tsx#L2123-L2130) změnit volání:

```typescript
  useEffect(() => {
    if (bRecurrenceType === "NONE" || !bSeriesFirstDate) {
      setSeriesPreview([]);
      return;
    }
    setSeriesPreview(generateSeriesPreview(
      bSeriesFirstDate, bSeriesFirstHour, bRecurrenceCount, bRecurrenceType,
      bDataRequiredDate, bDeadlineExpedice,
      bSeriesMachine, durationHours, blocks, machineWeekShifts
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bRecurrenceType, bRecurrenceCount, bSeriesFirstDate, bSeriesFirstHour, bSeriesMachine, durationHours]);
```

**Pozn.:** `blocks` a `machineWeekShifts` schválně NEJSOU v dep array — jsou snapshot v okamžiku změny parametrů série. Stejný princip jako u `bDataRequiredDate`/`bDeadlineExpedice`. SSE update existujícího bloku během rozdělané série tím nepřepisuje preview; server pak při POST udělá final check.

- [ ] **Step 4.5: Vyhledat další volání `generateSeriesPreview`**

```bash
grep -n "generateSeriesPreview" src/app/_components/PlannerPage.tsx
```

Pokud existují další volání mimo `useEffect` na řádku 2128, doplnit i tam shodně 10 parametrů. Standardně by mělo být jen jedno volání.

- [ ] **Step 4.6: Sanity check — type check + build**

Run:
```bash
npx tsc --noEmit
```
Expected: žádné nové TS chyby. Pokud chybí typ `MachineWeekShiftsRow`, importovat:

```typescript
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
```

- [ ] **Step 4.7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(planner): preview série posune sloty kvůli kapacitě/pracovní době"
```

---

## Task 5: UI — vizuální odlišení posunutých slotů v preview

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:3582-3641` (preview render — vnější `<div>` každé occurrence + řádek 1 s časem)

**Pre-task kontext:** stávající render preview prvku ([PlannerPage.tsx:3582](src/app/_components/PlannerPage.tsx#L3582)):

```tsx
<div key={i} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "6px 8px", borderRadius: 7, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
  {/* Řádek 1: badge + Tisk datum + hodina */}
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div style={{ ...badge styles..., color: "#93c5fd" }}>{i + 1}</div>
    ...
```

Cíl: posunutý slot dostane žluté podbarvení levým okrajem + nad řádkem 1 se objeví minimalistický indikátor `⚠ posunuto z {originalDate} {HH}:00`.

- [ ] **Step 5.1: Upravit vnější `<div>` mapování**

V [PlannerPage.tsx:3582](src/app/_components/PlannerPage.tsx#L3582) nahradit otevírací `<div>`:

```tsx
{seriesPreview.map((occ, i) => (
  <div
    key={i}
    title={
      occ.wasShifted
        ? `Posunuto kvůli kapacitě stroje — původně ${occ.originalDate} ${String(occ.originalHour).padStart(2, "0")}:00`
        : undefined
    }
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 3,
      padding: "6px 8px",
      borderRadius: 7,
      background: occ.wasShifted ? "rgba(255, 230, 0, 0.08)" : "rgba(255,255,255,0.03)",
      border: occ.wasShifted
        ? "1px solid rgba(255, 230, 0, 0.35)"
        : "1px solid rgba(255,255,255,0.06)",
      borderLeft: occ.wasShifted
        ? "3px solid #FFE600"
        : "1px solid rgba(255,255,255,0.06)",
    }}
  >
    {occ.wasShifted && (
      <div style={{
        fontSize: 9,
        fontWeight: 600,
        color: "#FFE600",
        letterSpacing: "0.04em",
        marginBottom: 2,
      }}>
        ⚠ Posunuto z {occ.originalDate} {String(occ.originalHour).padStart(2, "0")}:00 (kapacita)
      </div>
    )}
    {/* Řádek 1: badge + Tisk datum + hodina */}
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      ...
```

(Zbytek vnitřku — řádek 1 s badge/datepicker/hodina, řádek 2 s DATA/EXP — ponechat **beze změny**.)

- [ ] **Step 5.2: Reset `wasShifted` při ruční editaci data nebo hodiny**

Když plánovač ručně změní datum nebo hodinu posunutého slotu, indikátor "⚠ posunuto" by zmizel — uživatel rozhodl explicitně.

V [PlannerPage.tsx:3595](src/app/_components/PlannerPage.tsx#L3595) (DatePickerField onChange) změnit:

```tsx
onChange={(d) => setSeriesPreview((prev) => prev.map((o, j) =>
  j === i ? { ...o, date: d, wasShifted: false } : o
))}
```

V [PlannerPage.tsx:3602](src/app/_components/PlannerPage.tsx#L3602) (select hodiny onChange) změnit:

```tsx
onChange={(e) => setSeriesPreview((prev) => prev.map((o, j) =>
  j === i ? { ...o, hour: parseInt(e.target.value), wasShifted: false } : o
))}
```

(DATA a EXP datepickery v řádku 2 nemění čas slotu samotného → tam reset `wasShifted` není potřeba.)

- [ ] **Step 5.3: Vizuální smoke test**

1. `npm run dev`, otevřít planner v prohlížeči, login jako ADMIN nebo PLANOVAT.
2. Naplánovat manuálně blok TEST-1 na XL_105, 15. 9. 2027 14:00, 6 h.
3. V builderu nastavit sérii: stroj XL_105, první termín 15. 9. 2027 14:00, opakování 4× WEEKLY.
4. V Preview série ověřit:
   - První occurrence (15. 9.) má žluté podbarvení + levý okraj + řádek "⚠ Posunuto z 2027-09-15 14:00 (kapacita)" + tooltip při hoveru.
   - Hodina v selectu ukazuje 20 (nebo jinou validní volnou hodnotu).
   - Ostatní occurrences (22. 9., 29. 9., 6. 10.) jsou bez žlutého zvýraznění.
5. Ručně změnit hodinu posunutého slotu na jinou (např. 22) → žluté zvýraznění zmizí.
6. Cleanup: smazat TEST-1.

- [ ] **Step 5.4: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(planner): vizuální indikátor posunutých slotů v preview série"
```

---

## Task 6: Klient — `handleScheduleSeries` posílá flag, čte response, toasty

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:2027-2096`

- [ ] **Step 6.1: Přidat `autoShiftIfBusy: true` do `baseBody`**

Najít [PlannerPage.tsx:2031-2053](src/app/_components/PlannerPage.tsx#L2031-L2053) a do `baseBody` doplnit:

```typescript
    const baseBody = {
      orderNumber: orderNumber.trim(),
      machine: bSeriesMachine,
      type,
      // ... existující pole ...
      recurrenceType: bRecurrenceType,
      autoShiftIfBusy: true,
    };
```

- [ ] **Step 6.2: Číst `autoShift` z response a sbírat posuny**

Najít smyčku [PlannerPage.tsx:2057-2082](src/app/_components/PlannerPage.tsx#L2057-L2082) a přepsat:

```typescript
    setSeriesScheduling(true);
    let parentId: number | null = null;
    let created = 0;
    const shiftedToasts: Array<{ original: string; final: string }> = [];
    const failedSlots: Array<{ date: string; hour: number; reason: string }> = [];

    for (let i = 0; i < seriesPreview.length; i++) {
      const occ = seriesPreview[i];
      const startTime = pragueToUTC(occ.date, occ.hour);
      const endTime = new Date(startTime.getTime() + durationMs);
      const body: Record<string, unknown> = {
        ...baseBody,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        dataRequiredDate: occ.dataRequiredDate || null,
        deadlineExpedice: occ.deadlineExpedice || null,
      };
      if (parentId !== null) body.recurrenceParentId = parentId;
      try {
        const res = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const block: Block & { autoShift?: { originalStart: string } } = await res.json();
          if (i === 0) parentId = block.id;
          handleBlockCreate(block);
          created++;
          if (block.autoShift) {
            const orig = new Date(block.autoShift.originalStart);
            const final = new Date(block.startTime);
            const fmt = (d: Date) => d.toLocaleString("cs-CZ", {
              timeZone: "Europe/Prague",
              day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
            });
            shiftedToasts.push({ original: fmt(orig), final: fmt(final) });
          }
        } else {
          const err = await res.json().catch(() => ({ error: "neznámá chyba" }));
          failedSlots.push({ date: occ.date, hour: occ.hour, reason: err.error ?? "chyba serveru" });
        }
      } catch {
        failedSlots.push({ date: occ.date, hour: occ.hour, reason: "síťová chyba" });
      }
    }
    setSeriesScheduling(false);

    // Per-blok info-toasty pro auto-shift (max 5, aby se uživatel neutopil v toastech)
    shiftedToasts.slice(0, 5).forEach((s) => {
      showToast(`${s.original} → ${s.final} — přesunuto z kapacitních důvodů`, "info");
    });
    if (shiftedToasts.length > 5) {
      showToast(`+${shiftedToasts.length - 5} dalších bloků posunuto. Zkontroluj timeline.`, "info");
    }

    // Souhrn
    if (created === seriesPreview.length) {
      const shiftedCount = shiftedToasts.length;
      const msg = shiftedCount > 0
        ? `Série ${created} bloků naplánována (${shiftedCount} posunuto).`
        : `Série ${created} bloků naplánována.`;
      showToast(msg, "success");
    } else if (created > 0) {
      showToast(`Naplánováno ${created}/${seriesPreview.length}. ${failedSlots.length} bloků selhalo — zkontroluj timeline.`, "error");
    } else {
      showToast(`Naplánování série selhalo: ${failedSlots[0]?.reason ?? "neznámá chyba"}.`, "error");
    }

    if (created > 0) {
      resetBuilderForm();
      setBSeriesFirstDate(""); setBSeriesFirstHour(7);
      setSeriesPreview([]);
    }
  }
```

- [ ] **Step 6.3: Ověřit, že `showToast` podporuje variantu `"info"`**

```bash
grep -n "type ToastType\|'info'\|\"info\"" src/components/ToastContainer.tsx
```

Pokud `info` není mezi typy toastů, přidat ho:

V `src/components/ToastContainer.tsx` najít definici typu toastu (např. `type ToastType = "success" | "error" | "warning"`) a doplnit `"info"`. Přidat barvu např. `#3B82F6` (modrá) ve styling switchi.

(Pokud `info` už existuje, krok je no-op.)

- [ ] **Step 6.4: Sanity check — type check + build**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: build prochází, žádné nové errory.

- [ ] **Step 6.5: End-to-end manuální test**

1. `npm run dev`
2. Login jako ADMIN nebo PLANOVAT
3. Naplánovat zakázku na XL_105, 15. 9. 2027 14:00, 6 h (manuálně přes builder, NE série)
4. Naplánovat sérii na stejném stroji: první 15. 9. 2027 14:00, opakování 4× WEEKLY, 6 h
5. Ověřit:
   - Preview ukáže první slot žlutě s "⚠ posunuto z 14:00" a tooltip
   - Po kliku "Naplánovat sérii" se zobrazí 1× info-toast `15. 9. 14:00 → 15. 9. 20:00 — přesunuto z kapacitních důvodů`
   - Souhrn `Série 4 bloků naplánována (1 posunuto)`
   - V audit logu prvního bloku (klik na blok → InfoPanel) je vidět `AUTO_SHIFT` záznam s old/new timeStamp
6. Cleanup: smazat testovací zakázky.

- [ ] **Step 6.6: Spustit celou test suite**

Run:
```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
node --test --import tsx src/lib/scheduleSlotFinder.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleSlotFinder.server.test.ts
```
Expected: 24 původních + 6 + 4 = **34/34 zelené**.

- [ ] **Step 6.7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx src/components/ToastContainer.tsx
git commit -m "feat(planner): handleScheduleSeries posílá autoShiftIfBusy + per-blok info-toast"
```

---

## Závěr

Po dokončení všech 6 tasků:

- ✅ Plánovač zadá sérii, posunuté sloty se ukážou v previewu žlutě s tooltipem.
- ✅ POST `/api/blocks` s `autoShiftIfBusy: true` najde nejbližší volný slot, vytvoří blok, zaloguje `AUTO_SHIFT`.
- ✅ Race condition (kolize mezi pre-check a transakcí) je ošetřená druhým snapem v transakci.
- ✅ Maximální posun 7 dní; když nelze, vrátí se jasná `409` chyba.
- ✅ Toast ukáže `15. 9. 14:00 → 15. 9. 20:00 — přesunuto z kapacitních důvodů` per blok.
- ✅ Audit log u bloku obsahuje `AUTO_SHIFT` záznam pro pozdější dohledání.

**Manuální QA před produkcí (Vojta):**
1. Plánování série WEEKLY na jeden rok dopředu, kde 2-3 sloty kolidují s existujícími.
2. Plánování DAILY série s konfliktem v pracovní době (např. neděle pro stroj s neaktivní směnou).
3. Edge case: stroj plný 7+ dní → ověřit error toast a že se série nezasekne.
