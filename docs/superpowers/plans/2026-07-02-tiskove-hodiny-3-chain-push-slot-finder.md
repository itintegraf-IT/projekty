# Tiskové hodiny — Plán 3: Chain push re-expanze + slot finder start-only

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Pravidlo projektu (Vojta):** ŽÁDNÉ `git commit` ani `git push` — změny zůstávají ve working tree, commituje Vojta. Kroky „Commit" v tomto plánu neexistují záměrně.

**Goal:** Server přestane „teleportovat" odsouvané bloky — chain push i auto-shift umísťují bloky přes start-only snap + `expandPrintTime`, takže odsunutý blok smí pauznout přes odstávku a nikdy se neuloží s koncem, který nesedí na kalendář.

**Architecture:** `computeChainPush` a `findNextFreeSlot` dnes předpokládají „blok = souvislé okno" (duration-based snap `snapToNextValidStartWithTemplates`). Plán 3 je přepíná na model tiskových hodin: nová pure funkce `snapStartToNextRunnableSlot` (start na první aktivní slot), re-expanze délky per blok podle jeho `printMinutes` + `scheduleBypassed`. Klientské cesty (TimelineGrid, PlannerPage, BlockEdit) zůstávají na staré logice do Plánu 4 — server je autoritativní, klient posílá jen návrhy.

**Tech Stack:** Next.js 16 API routes, Prisma 5 (MySQL), node:test + tsx, pure funkce v `src/lib`.

**Spec:** `docs/superpowers/specs/2026-07-02-tiskove-hodiny-design.md` sekce 3.5, 3.6, 3.8 + přenosy z ledgeru etapy 2.

## Global Constraints

Zkopírováno ze specu / pravidel projektu — platí pro KAŽDÝ task:

- **Zamčený blok:** „Zamčený blok → drop se odmítne s hláškou, žádné tiché přeskládání." Kolize anchoru se zamčeným blokem = odmítnutí transakce s hláškou jmenující zamčený blok.
- **endTime = materializovaná cache:** server nikdy nezapíše ZAKAZKA blok, jehož `endTime != expandPrintTime(start, printMinutes, …, scheduleBypassed).end`.
- **MAX_AUTO_SHIFT_MS (7 dní) se vztahuje na POSUN STARTU, ne endu** — 40h blok s pauzami má span přes 7 dní a nesmí dostat falešný MAX_SHIFT_EXCEEDED.
- **Fetch okno dimenzovat na worst-case span** (`MAX_SPAN_DAYS` = 21 dní za posledním možným startem), ne `+durationMs`.
- **Overlap beze změny:** jednotka exkluzivity = celý kalendářní rozsah včetně pauz. `checkBlockOverlap`/`assertNoOverlapForBlocks` se nemění.
- **Hraniční konvence:** všude half-open `[start, end)`.
- **Chybové stavy:** `AppError` z `@/lib/errors`, logování přes `logger` — nikdy `console` v serverovém kódu.
- **Verifikace každého tasku:** `npx tsc --noEmit` (0 chyb) + příslušné `node --test --import tsx <soubor>` testy. LESSON z etapy 2: `next build` nevidí neimportované test soubory, tsc je povinný.
- **Žádné commity** — viz poznámka v hlavičce.
- **Klientský kód (`src/app/_components/*`, `src/components/*`) se v tomto plánu NEMĚNÍ** — mutační cesty klienta jsou Plán 4.

## Vědomé mezistavy (co po Plánu 3 zůstává „napůl")

1. **Klient** dál používá `snapToNextValidStartWithTemplates` a pure `findNextFreeSlot` pro preview (paste marker, BlockEdit kolize, drag snap) — preview může lhát u bloků přes odstávku; server výsledek autoritativně přepočítá. Řeší Plán 4 (vč. `snapGroupDeltaWithTemplates` → snap startů).
2. **Ne-ZAKAZKA auto-shift** (UDRZBA/REZERVACE série) zůstává na staré duration-based `findNextFreeSlotFromDb` — tyto typy nemají `printMinutes` a nepauzují se; pravděpodobně trvalý stav, ne dluh.
3. **Chain push sourozenců v lasso dávce** (excludeIds) se neposouvají — intra-group překryv po re-expanzi je neřešitelný a dostane konkrétní hlášku (Task 6). „Řízené přeskládání sourozenců" (ledger P2T5 option 2) je mimo scope — YAGNI, dokud to reálné použití nevyžádá.
4. **AppError pattern v POST 422** (přímé `NextResponse.json` místo throw) — zděděné z etapy 2, beze změny.
5. **Legacy bloky před `detect-legacy-bypass --apply`:** blok fakticky mimo kalendář, ale ještě neoznačený `scheduleBypassed=true`, se při odsunu chain pushem re-expanduje (může „narůst" o pauzy). Stejný známý mezistav jako u PUT/batch z etapy 2 — na produkci MUSÍ před nasazením běžet detect skript (dry-run → kontrola → --apply). Dev baseline 165/14/1 ověřena 2. 7. před startem Plánu 3.

## File Structure

| Soubor | Akce | Zodpovědnost |
| --- | --- | --- |
| `src/lib/clipboardCopy.test.ts` | Modify | jen typy — oprava tsc dluhu |
| `src/lib/overlapCheck.test.ts` | Modify | jen typy + nové testy `findIntraBatchOverlap` |
| `src/lib/printTime.ts` | Modify | + `snapStartToNextRunnableSlot` |
| `src/lib/printTime.test.ts` | Modify | + testy snapu |
| `src/lib/weekShiftsTestFixtures.ts` | Create | sdílené test fixtury (mkDay/xl106Week/offWeek) |
| `src/lib/overlapResolver.ts` | Rewrite | `computeChainPush` s re-expanzí, `ChainPushResult` |
| `src/lib/overlapResolver.test.ts` | Rewrite | testy nového kontraktu vč. kaskády přes víkend |
| `src/lib/overlapResolver.server.ts` | Rewrite | kalendář vždy, verifikace end==expand, hlášky |
| `src/lib/overlapResolver.server.test.ts` | Rewrite | mocky s printMinutes/scheduleBypassed |
| `src/app/api/blocks/route.ts` | Modify | call sites: chain push signatura + print slot finder |
| `src/app/api/blocks/[id]/route.ts` | Modify | call site: chain push signatura |
| `src/app/api/blocks/batch/route.ts` | Modify | call site + intra-group pre-check |
| `src/lib/scheduleSlotFinder.ts` | Modify | + `findNextFreePrintSlot`(+FromDb); staré funkce zůstávají |
| `src/lib/scheduleSlotFinder.test.ts` | Modify | + testy nové funkce |
| `src/lib/scheduleSlotFinder.server.test.ts` | Modify | + testy nové FromDb |
| `src/lib/overlapCheck.ts` | Modify | + pure `findIntraBatchOverlap` |
| `CLAUDE.md` | Modify | počty testů, popis chain pushe |

---

### Task 1: Oprava tsc dluhu v clipboardCopy.test.ts a overlapCheck.test.ts

Pre-existující typové chyby (24 celkem) blokují čistou verifikační bránu `npx tsc --noEmit`. Runtime chování testů se NESMÍ změnit — jen typy/casty.

**Files:**
- Modify: `src/lib/clipboardCopy.test.ts`
- Modify: `src/lib/overlapCheck.test.ts`

**Interfaces:** žádné — testy nic neexportují.

- [ ] **Step 1: Ověř výchozí stav**

Run: `npx tsc --noEmit 2>&1 | grep -cE "clipboardCopy.test|overlapCheck.test"`
Expected: `24`

- [ ] **Step 2: clipboardCopy.test.ts — odpoj `Win` od `typeof globalThis`**

Příčina: `type Win = typeof globalThis & {...}` merguje s DOM typy (`Navigator`, `Document` z Next.js lib), takže `delete` padá na non-optional property a přiřazení parciálních mocků na nekompatibilní typ. Oprava: `Win` jako samostatný typ + dvojitý cast.

```typescript
// PŘED (řádky 8–21):
type Win = typeof globalThis & {
  navigator?: { clipboard?: { writeText?: (s: string) => Promise<void> } };
  ...
};
function cleanupGlobals() {
  const w = globalThis as Win;
  ...
}

// PO:
type Win = {
  navigator?: { clipboard?: { writeText?: (s: string) => Promise<void> } };
  document?: {
    createElement: (tag: string) => Record<string, unknown> & { value?: string; style: Record<string, string>; setAttribute: (k: string, v: string) => void; select: () => void };
    body: { appendChild: (el: unknown) => void; removeChild: (el: unknown) => void };
    execCommand: (cmd: string) => boolean;
  };
};

function cleanupGlobals() {
  const w = globalThis as unknown as Win;
  delete w.navigator;
  delete w.document;
}
```

A všech 5 dalších výskytů `const w = globalThis as Win;` v testech nahradit `const w = globalThis as unknown as Win;`. Nic jiného neměnit.

- [ ] **Step 3: overlapCheck.test.ts — otypuj přístup k mock arguments**

Příčina: `mock.fn(async () => null)` nemá deklarované parametry → `mock.calls[0].arguments` je typované jako `[]`. Oprava castem — stejný vzor jako `overlapResolver.server.test.ts:64`. Dva výskyty (řádky ~47 a ~57):

```typescript
// PŘED (test "excludeBlockId=null funguje pro nové bloky"):
const whereArg = findFirstMock.mock.calls[0].arguments[0].where;

// PO:
const whereArg = (findFirstMock.mock.calls as unknown as { arguments: [{ where: Record<string, unknown> }] }[])[0]!.arguments[0].where;
```

```typescript
// PŘED (test "sousední bloky (dotýkají se) nepovažuje za overlap"):
const whereArg = findFirstMock.mock.calls[0].arguments[0].where;

// PO (stejný cast):
const whereArg = (findFirstMock.mock.calls as unknown as { arguments: [{ where: Record<string, unknown> }] }[])[0]!.arguments[0].where;
```

Asserty pod tím (`whereArg.id`, `whereArg.endTime`) fungují s `Record<string, unknown>` beze změny (`assert.equal(whereArg.id, undefined, …)`, `assert.deepEqual(whereArg.endTime, {...})`).

- [ ] **Step 4: Ověř**

Run: `npx tsc --noEmit`
Expected: 0 chyb (celý projekt).
Run: `node --test --import tsx src/lib/clipboardCopy.test.ts && node --test --import tsx src/lib/overlapCheck.test.ts`
Expected: 6/6 a 8/8 pass — stejné počty jako před změnou.

---

### Task 2: `snapStartToNextRunnableSlot` v printTime.ts

Start-only snap: najdi nejbližší runnable 30min slot (weekShifts + companyDays sjednoceně přes `isMachineRunnableAt`). Nahrazuje na serveru duration-based `snapToNextValidStartWithTemplates` — tím mizí mechanismus teleportu (hledání souvislého okna pro celou délku).

**Files:**
- Modify: `src/lib/printTime.ts`
- Test: `src/lib/printTime.test.ts`

**Interfaces:**
- Consumes: `isMachineRunnableAt`, `SLOT_MS`, `MAX_SPAN_DAYS` (tamtéž).
- Produces: `snapStartToNextRunnableSlot(machine: string, proposed: Date, weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayInterval[], limitMs?: number): Date | null` — Tasky 3 a 5 na ní staví.

- [ ] **Step 1: Napiš failing testy** (do `src/lib/printTime.test.ts`, na konec souboru; fixtury `SHIFTS`, `NO_CD`, `pragueToUTC` už tam jsou):

```typescript
// ── snapStartToNextRunnableSlot ──────────────────────────────────────────────

test("snap: runnable start se nemění", () => {
  const t = pragueToUTC("2026-08-18", 10); // úterý 10:00 — plný provoz
  assert.deepEqual(snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD), t);
});

test("snap: sobota (odstávka) → neděle 22:00 (začátek noční)", () => {
  const t = pragueToUTC("2026-08-22", 12); // sobota 12:00
  assert.deepEqual(
    snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD),
    pragueToUTC("2026-08-23", 22)
  );
});

test("snap: CompanyDay přeskočí i uvnitř aktivní směny", () => {
  const cd: CompanyDayInterval[] = [
    { start: pragueToUTC("2026-08-18", 0), end: pragueToUTC("2026-08-19", 0) }, // celé úterý
  ];
  const t = pragueToUTC("2026-08-18", 10);
  assert.deepEqual(
    snapStartToNextRunnableSlot("XL_106", t, SHIFTS, cd),
    pragueToUTC("2026-08-19", 0) // středa 00:00 — první runnable slot po odstávce
  );
});

test("snap: nezarovnaný čas se zarovná NAHORU na slot grid", () => {
  const t = new Date(pragueToUTC("2026-08-18", 10).getTime() + 7 * 60 * 1000); // 10:07
  assert.deepEqual(
    snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD),
    pragueToUTC("2026-08-18", 10, 30)
  );
});

test("snap: žádný runnable slot do limitu → null", () => {
  const t = pragueToUTC("2026-08-22", 12); // sobota 12:00, provoz až Ne 22:00
  const limit = pragueToUTC("2026-08-23", 12).getTime(); // limit = neděle poledne
  assert.equal(snapStartToNextRunnableSlot("XL_106", t, SHIFTS, NO_CD, limit), null);
});
```

Do importu na řádku 5 přidej `snapStartToNextRunnableSlot`. Pozn.: `pragueToUTC(dateStr, hour, minute?)` — ověř signaturu v `src/lib/dateUtils.ts`; pokud minuty nebere, použij `new Date(pragueToUTC("2026-08-18", 10).getTime() + 30 * 60 * 1000)`.

- [ ] **Step 2: Run testy — musí failnout**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: FAIL — `snapStartToNextRunnableSlot` neexistuje.

- [ ] **Step 3: Implementace** (do `src/lib/printTime.ts`, za `isMachineRunnableAt`):

```typescript
/**
 * Posune start na nejbližší runnable 30min slot (weekShifts + companyDays přes
 * isMachineRunnableAt). Start-only náhrada duration-based snapu
 * (snapToNextValidStartWithTemplates): blok se položí na první aktivní slot
 * a délka se rozloží expanzí — blok delší než souvislé okno se už neteleportuje.
 *
 * Nezarovnaný `proposed` se zarovná NAHORU na slot grid. Vrací null, když
 * v [proposed, limitMs] žádný runnable slot není (default limit = MAX_SPAN_DAYS).
 *
 * Precondition (jako expandPrintTime): weekShifts musí pokrývat všechny týdny
 * prohledávaného okna — volající odpovídá za kompletní fetch.
 */
export function snapStartToNextRunnableSlot(
  machine: string,
  proposed: Date,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  limitMs: number = proposed.getTime() + MAX_SPAN_DAYS * 24 * 60 * 60 * 1000
): Date | null {
  let t = Math.ceil(proposed.getTime() / SLOT_MS) * SLOT_MS;
  while (t <= limitMs) {
    const slot = new Date(t);
    if (isMachineRunnableAt(machine, slot, weekShifts, companyDays)) return slot;
    t += SLOT_MS;
  }
  return null;
}
```

- [ ] **Step 4: Ověř**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: 19/19 pass (14 stávajících + 5 nových).
Run: `npx tsc --noEmit`
Expected: 0 chyb.

---

### Task 3: `computeChainPush` — re-expanze odsunutých bloků

Přepis pure funkce: odsunutý blok se umísťuje přes snap startu + `expandPrintTime` podle VLASTNÍHO `printMinutes` a `scheduleBypassed` (ne `ns + dur`). Parametr `respectWorkingHours` mizí — režim expanze určuje per-blok `scheduleBypassed` (request-level bypass se týká jen anchoru a ten už je vyřešen ve `validateAndComputeEnd` před chain pushem). Kolize anchoru se zamčeným blokem → explicitní odmítnutí.

**Files:**
- Create: `src/lib/weekShiftsTestFixtures.ts`
- Rewrite: `src/lib/overlapResolver.ts`
- Rewrite: `src/lib/overlapResolver.test.ts`

**Interfaces:**
- Consumes: `expandPrintTime`, `snapStartToNextRunnableSlot`, `SLOT_MS`, `CompanyDayInterval` z `@/lib/printTime` (Task 2).
- Produces (Task 4 na tom staví):
  - `BlockInterval = { id: number; startTime: Date; endTime: Date; locked: boolean; printMinutes: number | null; scheduleBypassed: boolean }`
  - `ChainMove = { id: number; startTime: Date; endTime: Date }` (beze změny)
  - `ChainPushResult = { ok: true; moves: ChainMove[] } | { ok: false; reason: "LOCKED_CONFLICT"; lockedId: number } | { ok: false; reason: "PLACEMENT_FAILED"; blockId: number }`
  - `computeChainPush(machine, anchor, others, weekShifts, companyDays): ChainPushResult`

- [ ] **Step 1: Vytvoř sdílené fixtury** `src/lib/weekShiftsTestFixtures.ts` (extrakce vzoru z `printTime.test.ts:9-48`; printTime.test.ts NEREFAKTORUJ — zbytečný churn):

```typescript
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";

// ── Test-only fixtury pracovní doby (sdílené mezi *.test.ts) ────────────────
// Směny: MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6 (Praha).

export function mkDay(
  weekStart: string,
  dayOfWeek: number,
  opts: { m?: boolean; a?: boolean; n?: boolean; active?: boolean } = {},
  machine = "XL_106"
): MachineWeekShiftsRow {
  return {
    machine,
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

/** Reálný režim XL_106: Po–Čt nonstop, Pá do 22:00, So off, Ne od 22:00.
 *  = víkendová odstávka Pá 22:00 – Ne 22:00. */
export function xl106Week(weekStart: string): MachineWeekShiftsRow[] {
  return [
    mkDay(weekStart, 1, { m: true, a: true, n: true }),
    mkDay(weekStart, 2, { m: true, a: true, n: true }),
    mkDay(weekStart, 3, { m: true, a: true, n: true }),
    mkDay(weekStart, 4, { m: true, a: true, n: true }),
    mkDay(weekStart, 5, { m: true, a: true }),
    mkDay(weekStart, 6, { active: false }),
    mkDay(weekStart, 0, { n: true }),
  ];
}

export function offWeek(weekStart: string): MachineWeekShiftsRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(weekStart, d, { active: false }));
}

/** Pondělky srpna 2026 (CEST) pro dvoutýdenní scénáře. */
export const W1 = "2026-08-17";
export const W2 = "2026-08-24";
```

- [ ] **Step 2: Přepiš `src/lib/overlapResolver.test.ts`** — nový kontrakt. Kompletní obsah:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeChainPush, type BlockInterval } from "./overlapResolver";
import { pragueToUTC } from "./dateUtils";
import type { CompanyDayInterval } from "./printTime";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";

// ── Jednoduché scénáře: úterý 16. 6. 2026, prázdné weekShifts → hardcoded
// fallback XL_105 (24/7 mimo neděli odpoledne) = souvislý provoz. ────────────
const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);
const blk = (
  id: number,
  start: number,
  end: number,
  opts: { locked?: boolean; pm?: number; bypassed?: boolean } = {}
): BlockInterval => ({
  id,
  startTime: H(start),
  endTime: H(end),
  locked: opts.locked ?? false,
  printMinutes: opts.pm ?? (end - start) * 60,
  scheduleBypassed: opts.bypassed ?? false,
});
const NO_CD: CompanyDayInterval[] = [];

// ── Víkendové scénáře: XL_106 s odstávkou Pá 22:00 – Ne 22:00 (Praha). ──────
const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const P = pragueToUTC; // P("2026-08-21", 18) = pátek 18:00 Praha

describe("computeChainPush — souvislý provoz (fallback 24/7)", () => {
  it("žádný překryv → ok, žádné posuny", () => {
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [blk(2, 14, 16)], [], NO_CD);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.moves.length, 0);
  });

  it("jeden navazující koliduje → posune se těsně za anchor", () => {
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [blk(2, 11, 13)], [], NO_CD);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      assert.deepEqual(r.moves[0], { id: 2, startTime: H(12), endTime: H(14) });
    }
  });

  it("řetěz tří bloků se kaskádovitě odsune", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13), blk(3, 13, 15)],
      [],
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 2);
      assert.deepEqual(r.moves.find((m) => m.id === 2), { id: 2, startTime: H(12), endTime: H(14) });
      assert.deepEqual(r.moves.find((m) => m.id === 3), { id: 3, startTime: H(14), endTime: H(16) });
    }
  });

  it("zamčený blok se nepřesune a navazující ho přeskočí", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13), blk(3, 13, 15, { locked: true })],
      [],
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.find((m) => m.id === 3), undefined);
      assert.deepEqual(r.moves.find((m) => m.id === 2), { id: 2, startTime: H(15), endTime: H(17) });
    }
  });

  it("anchor se sám nikdy neobjeví v posunech", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(1, 10, 12), blk(2, 11, 13)],
      [],
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.moves.find((m) => m.id === 1), undefined);
  });

  it("anchor koliduje se zamčeným blokem → LOCKED_CONFLICT s id viníka", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(18) },
      [blk(9, 16, 20, { locked: true })],
      [],
      NO_CD
    );
    assert.deepEqual(r, { ok: false, reason: "LOCKED_CONFLICT", lockedId: 9 });
  });

  it("korumpovaný blok (printMinutes <= 0) → PLACEMENT_FAILED, žádný raw throw", () => {
    const r = computeChainPush(
      "XL_105",
      { id: 1, startTime: H(10), endTime: H(12) },
      [blk(2, 11, 13, { pm: -1380 })],
      [],
      NO_CD
    );
    assert.deepEqual(r, { ok: false, reason: "PLACEMENT_FAILED", blockId: 2 });
  });
});

describe("computeChainPush — re-expanze přes víkendovou odstávku (XL_106)", () => {
  it("odsunutý blok pauzne přes víkend — end se prodlouží expanzí", () => {
    // Anchor Pá 10–18; blok B (6 h tisku, původně Pá 12–18) se odsune na Pá 18:00.
    // Expanze: Pá 18–22 = 4 h tisk, pauza Pá 22 – Ne 22, Ne 22–24 = 2 h → end Po 00:00.
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 18) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 18), locked: false, printMinutes: 360, scheduleBypassed: false }],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-21", 18), endTime: P("2026-08-24", 0) });
    }
  });

  it("přeskok za zamčený blok se počítá z re-expandovaného spanu", () => {
    // Zamčený C Pá 18–20. B (6 h) od Pá 18 by expandoval do Po 00:00 → koliduje s C
    // → kurzor za C (Pá 20). Expanze: Pá 20–22 = 2 h, pauza, Ne 22–24 = 2 h, Po 0–2 = 2 h → Po 02:00.
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 18) },
      [
        { id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 18), locked: false, printMinutes: 360, scheduleBypassed: false },
        { id: 3, startTime: P("2026-08-21", 18), endTime: P("2026-08-21", 20), locked: true, printMinutes: 120, scheduleBypassed: false },
      ],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.find((m) => m.id === 3), undefined);
      assert.deepEqual(r.moves.find((m) => m.id === 2), {
        id: 2,
        startTime: P("2026-08-21", 20),
        endTime: P("2026-08-24", 2),
      });
    }
  });

  it("scheduleBypassed blok se posouvá souvisle (bez pauz) i přes odstávku směn", () => {
    // Anchor Pá 10–22. Bypass blok B (4 h) → položí se na Pá 22:00 souvisle do So 02:00,
    // přestože směny nejedou (bypass = vědomě mimo kalendář, mimořádná směna).
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 22) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 16), locked: false, printMinutes: 240, scheduleBypassed: true }],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-21", 22), endTime: P("2026-08-22", 2) });
    }
  });

  it("bypass blok NIKDY nepřistane na firemní odstávce — přeskočí za ni", () => {
    const cd: CompanyDayInterval[] = [{ start: P("2026-08-21", 22), end: P("2026-08-22", 6) }];
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: P("2026-08-21", 22) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 16), locked: false, printMinutes: 240, scheduleBypassed: true }],
      SHIFTS,
      cd
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-22", 6), endTime: P("2026-08-22", 10) });
    }
  });
});
```

- [ ] **Step 3: Run testy — musí failnout** (starý kontrakt vrací pole, ne `{ok, moves}`)

Run: `node --test --import tsx src/lib/overlapResolver.test.ts`
Expected: FAIL (kompilace/asserty).

- [ ] **Step 4: Přepiš `src/lib/overlapResolver.ts`.** Kompletní obsah:

```typescript
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import {
  expandPrintTime,
  snapStartToNextRunnableSlot,
  SLOT_MS,
  type CompanyDayInterval,
} from "@/lib/printTime";

/** Interval existujícího bloku na JEDNOM stroji (volající filtruje podle stroje). */
export type BlockInterval = {
  id: number;
  startTime: Date;
  endTime: Date;
  locked: boolean;
  /** Tiskové minuty; null → fallback elapsed end−start (defenzivní — backfill je vyplnil). */
  printMinutes: number | null;
  /** Blok vědomě mimo kalendář → při posunu se NEre-expanduje (end = start + pm souvisle). */
  scheduleBypassed: boolean;
};

/** Navržený posun jednoho bloku. */
export type ChainMove = { id: number; startTime: Date; endTime: Date };

export type ChainPushResult =
  | { ok: true; moves: ChainMove[] }
  | { ok: false; reason: "LOCKED_CONFLICT"; lockedId: number }
  | { ok: false; reason: "PLACEMENT_FAILED"; blockId: number };

/**
 * Chain push: anchor blok je fixní na své pozici, navazující kolidující bloky se
 * odsunou dopředu. Odsunutý blok se umísťuje přes start-only snap + expandPrintTime
 * podle VLASTNÍHO printMinutes a scheduleBypassed — blok smí pauznout přes odstávku
 * a jeho nový end vždy sedí na kalendář (žádný teleport za souvislým oknem).
 *
 * - `others` jsou ZAKAZKA bloky TÉHOŽ stroje (volající zajistí filtr).
 * - Zamčené bloky se NIKDY neposouvají; kandidátní pozice je přeskakují.
 * - Anchor kolidující se zamčeným blokem nelze vyřešit → LOCKED_CONFLICT
 *   (spec: „zamčený blok → drop se odmítne s hláškou, žádné tiché přeskládání").
 * - printMinutes <= 0 (korupce dat) → PLACEMENT_FAILED, nikdy raw throw.
 *
 * Pure funkce — žádné DB volání. Posuny jsou monotónně dopředné → konverguje.
 */
export function computeChainPush(
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  others: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): ChainPushResult {
  const sorted = others
    .filter((b) => b.id !== anchor.id)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const locked = sorted.filter((b) => b.locked);
  const anchorStart = anchor.startTime.getTime();

  const anchorHit = locked.find(
    (l) => l.startTime.getTime() < anchor.endTime.getTime() && l.endTime.getTime() > anchorStart
  );
  if (anchorHit) return { ok: false, reason: "LOCKED_CONFLICT", lockedId: anchorHit.id };

  const moves: ChainMove[] = [];
  const placed = new Set<number>();
  let pEnd = anchor.endTime.getTime();

  for (let i = 0; i < 500; i++) {
    const next = sorted.find(
      (b) => !placed.has(b.id) && b.startTime.getTime() < pEnd && b.endTime.getTime() > anchorStart
    );
    if (!next) break;
    placed.add(next.id);

    if (next.locked) {
      // Zamčený blok nelze posunout — posuň kurzor za jeho konec.
      pEnd = Math.max(pEnd, next.endTime.getTime());
      continue;
    }

    const pm =
      next.printMinutes ?? Math.round((next.endTime.getTime() - next.startTime.getTime()) / 60000);
    if (!Number.isFinite(pm) || pm <= 0) {
      return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };
    }

    const pos = placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays);
    if (!pos) return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };

    moves.push({ id: next.id, startTime: pos.start, endTime: pos.end });
    pEnd = pos.end.getTime();
  }

  return { ok: true, moves };
}

/**
 * Najde první pozici od `fromMs`, kde re-expandovaný blok nekoliduje se zamčenými
 * bloky (a u bypass bloků ani s firemní odstávkou — tvrdý zákaz z validace).
 */
function placeAfter(
  machine: string,
  fromMs: number,
  printMinutes: number,
  bypassed: boolean,
  locked: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[]
): { start: Date; end: Date } | null {
  let cursorMs = Math.ceil(fromMs / SLOT_MS) * SLOT_MS;

  for (let g = 0; g < 100; g++) {
    if (bypassed) {
      const start = new Date(cursorMs);
      const endMs = cursorMs + printMinutes * 60000;
      const cdHit = companyDays.find((cd) => cd.start.getTime() < endMs && cd.end.getTime() > cursorMs);
      if (cdHit) {
        cursorMs = Math.ceil(cdHit.end.getTime() / SLOT_MS) * SLOT_MS;
        continue;
      }
      const lockHit = locked.find((l) => l.startTime.getTime() < endMs && l.endTime.getTime() > cursorMs);
      if (lockHit) {
        cursorMs = Math.ceil(lockHit.endTime.getTime() / SLOT_MS) * SLOT_MS;
        continue;
      }
      return { start, end: new Date(endMs) };
    }

    const snapped = snapStartToNextRunnableSlot(machine, new Date(cursorMs), weekShifts, companyDays);
    if (!snapped) return null;
    const exp = expandPrintTime(machine, snapped, printMinutes, weekShifts, companyDays, false);
    if (!exp.ok) return null;
    const lockHit = locked.find(
      (l) => l.startTime.getTime() < exp.end.getTime() && l.endTime.getTime() > snapped.getTime()
    );
    if (!lockHit) return { start: snapped, end: exp.end };
    cursorMs = Math.ceil(lockHit.endTime.getTime() / SLOT_MS) * SLOT_MS;
  }
  return null;
}
```

- [ ] **Step 5: Ověř**

Run: `node --test --import tsx src/lib/overlapResolver.test.ts`
Expected: 11/11 pass.
Run: `npx tsc --noEmit`
Expected: chyby JEN v `overlapResolver.server.ts` (starý call `computeChainPush` — opraví Task 4); v nové/testové vrstvě 0. Pokud tsc hlásí chyby jinde, oprav je v tomto tasku.

---

### Task 4: `resolveChainPushFromDb` — kalendář vždy, verifikace end==expand, hlášky

Serverová vrstva: fetch přidá `printMinutes` + `scheduleBypassed`, kalendář (weekShifts + companyDays) se načítá VŽDY (expanze ho potřebuje bez ohledu na request flag), `respectWorkingHours` parametr mizí, `ok:false` výsledky se mapují na `AppError` s konkrétní hláškou, post-check nahrazen verifikací `end == expandPrintTime(...)`. Zároveň mechanická úprava 3 call sites (odstranění 4. argumentu).

**Files:**
- Rewrite: `src/lib/overlapResolver.server.ts`
- Rewrite: `src/lib/overlapResolver.server.test.ts`
- Modify: `src/app/api/blocks/route.ts` (řádky ~311–316), `src/app/api/blocks/[id]/route.ts` (~507–513), `src/app/api/blocks/batch/route.ts` (~166–172)

**Interfaces:**
- Consumes: `computeChainPush`, `BlockInterval`, `ChainMove` (Task 3); `expandPrintTime`, `MAX_SPAN_DAYS`, `CompanyDayInterval` z printTime.
- Produces: `resolveChainPushFromDb(tx, machine, anchor: {id, startTime, endTime}, excludeIds?: ReadonlySet<number>): Promise<AppliedMove[]>` — parametr `respectWorkingHours` ODSTRANĚN. `AppliedMove` beze změny.
- Chybové kontrakty: LOCKED_CONFLICT → `AppError("OVERLAP", "Nelze uvolnit místo — koliduje se zamčeným blokem #<orderNumber>. Vyber jiné místo.")`; PLACEMENT_FAILED → `AppError("SCHEDULE_VIOLATION", "Auto-posun bloku #<orderNumber> nenašel místo v kalendáři — uvolni místo ručně.")`.

- [ ] **Step 1: Přepiš `src/lib/overlapResolver.server.test.ts`.** Kompletní obsah:

```typescript
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { resolveChainPushFromDb } from "./overlapResolver.server";

// Úterý 16. 6. 2026, prázdné weekShifts → hardcoded fallback XL_105 (souvislý provoz).
const H = (h: number) => new Date(`2026-06-16T${String(h).padStart(2, "0")}:00:00.000Z`);

type Row = {
  id: number;
  orderNumber: string | null;
  startTime: Date;
  endTime: Date;
  locked: boolean;
  printCompletedAt: Date | null;
  printMinutes: number | null;
  scheduleBypassed: boolean;
};

const row = (id: number, start: number, end: number, opts: Partial<Row> = {}): Row => ({
  id,
  orderNumber: opts.orderNumber ?? String(17000 + id),
  startTime: H(start),
  endTime: H(end),
  locked: opts.locked ?? false,
  printCompletedAt: opts.printCompletedAt ?? null,
  printMinutes: opts.printMinutes ?? (end - start) * 60,
  scheduleBypassed: opts.scheduleBypassed ?? false,
});

function mkTx(rows: Row[], companyDays: { startDate: Date; endDate: Date }[] = []) {
  const updateMock = mock.fn(async () => ({}));
  const findManyMock = mock.fn(async () => rows);
  const tx = {
    block: { findMany: findManyMock, update: updateMock },
    machineWeekShifts: { findMany: mock.fn(async () => []) },
    companyDay: { findMany: mock.fn(async () => companyDays) },
  } as never;
  return { tx, updateMock, findManyMock };
}

describe("resolveChainPushFromDb", () => {
  it("posune navazující blok, zapíše ho a vrátí orderNumber + staré časy", async () => {
    const { tx, updateMock } = mkTx([row(2, 11, 13, { orderNumber: "17219" })]);

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    assert.equal(moves[0]!.id, 2);
    assert.equal(moves[0]!.orderNumber, "17219");
    assert.deepEqual(moves[0]!.startTime, H(12));
    assert.deepEqual(moves[0]!.endTime, H(14));
    assert.deepEqual(moves[0]!.oldStartTime, H(11));
    assert.deepEqual(moves[0]!.oldEndTime, H(13));
    assert.equal(updateMock.mock.calls.length, 1);
  });

  it("žádná kolize → žádný update, prázdné moves", async () => {
    const { tx, updateMock } = mkTx([row(2, 14, 16)]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });
    assert.equal(moves.length, 0);
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("excludeIds přidá bloky do notIn filtru (lasso: sourozenci se neposouvají)", async () => {
    const { tx, findManyMock } = mkTx([]);
    await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }, new Set([5, 7]));
    const where = (findManyMock.mock.calls as unknown as { arguments: [{ where: { id: { notIn: number[] } } }] }[])[0]!.arguments[0].where;
    assert.deepEqual(where.id.notIn, [1, 5, 7]);
  });

  it("SEMANTIKA TISKOVÝCH HODIN: odstávka v cílovém místě NEshazuje transakci — start se snapne za ni", async () => {
    // Dřív: posun do odstávky → SCHEDULE_VIOLATION. Teď: start není runnable na odstávce,
    // snap ho posune na její konec (14:00) a end vyjde z expanze (16:00).
    const { tx, updateMock } = mkTx(
      [row(2, 11, 13, { orderNumber: "17219" })],
      [{ startDate: H(12), endDate: H(14) }]
    );

    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });

    assert.equal(moves.length, 1);
    assert.deepEqual(moves[0]!.startTime, H(14));
    assert.deepEqual(moves[0]!.endTime, H(16));
    assert.equal(updateMock.mock.calls.length, 1);
  });

  it("anchor přes zamčený blok → AppError OVERLAP s orderNumber zamčeného bloku", async () => {
    const { tx, updateMock } = mkTx([row(9, 11, 13, { orderNumber: "R4735", locked: true })]);

    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("R4735"), "hláška má jmenovat zamčený blok");
        return true;
      }
    );
    assert.equal(updateMock.mock.calls.length, 0);
  });

  it("vytištěný blok (printCompletedAt) se chová jako zamčený", async () => {
    await assert.rejects(
      () =>
        resolveChainPushFromDb(
          mkTx([row(9, 11, 13, { orderNumber: "DONE1", printCompletedAt: H(13) })]).tx,
          "XL_105",
          { id: 1, startTime: H(10), endTime: H(12) }
        ),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("DONE1"));
        return true;
      }
    );
  });

  it("korumpovaný blok (printMinutes <= 0) → AppError SCHEDULE_VIOLATION, ne 500", async () => {
    const { tx } = mkTx([row(2, 11, 13, { orderNumber: "BAD1", printMinutes: -1380 })]);
    await assert.rejects(
      () => resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) }),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "SCHEDULE_VIOLATION");
        assert.ok(err.message.includes("BAD1"));
        return true;
      }
    );
  });
});
```

- [ ] **Step 2: Run testy — musí failnout**

Run: `node --test --import tsx src/lib/overlapResolver.server.test.ts`
Expected: FAIL (stará signatura / staré chování).

- [ ] **Step 3: Přepiš `src/lib/overlapResolver.server.ts`.** Kompletní obsah:

```typescript
import { computeChainPush, type ChainMove, type BlockInterval } from "@/lib/overlapResolver";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";
import { expandPrintTime, MAX_SPAN_DAYS, type CompanyDayInterval } from "@/lib/printTime";
import { AppError } from "@/lib/errors";

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Provedený posun bloku — `ChainMove` + původní časy a číslo zakázky (pro audit). */
export type AppliedMove = ChainMove & {
  orderNumber: string | null;
  oldStartTime: Date;
  oldEndTime: Date;
};

/**
 * Serverový chain push proti živé DB. Anchor blok je už zapsán na své cílové pozici;
 * tato funkce načte ostatní ZAKAZKA bloky stroje v okolním okně, spočítá posuny přes
 * `computeChainPush` (re-expanze per blok podle printMinutes + scheduleBypassed)
 * a zapíše je v rámci PŘEDANÉ transakce `tx`.
 *
 * Kalendář (weekShifts + companyDays) se načítá VŽDY — expanze odsunutých bloků na něm
 * stojí bez ohledu na bypass flag requestu (ten se týká jen anchoru a je vyřešen
 * ve validateAndComputeEnd před chain pushem).
 *
 * Chybové stavy (rollback transakce):
 * - anchor přes zamčený/vytištěný blok → AppError("OVERLAP") se jménem viníka,
 * - odsouvaný blok nejde umístit (horizont / korupce printMinutes) → AppError("SCHEDULE_VIOLATION").
 *
 * Volat UVNITŘ `$transaction`, po zápisu anchoru a PŘED finální pojistkou
 * `assertNoOverlapForBlocks`. Vrací provedené posuny (pro audit + odpověď klientovi).
 */
export async function resolveChainPushFromDb(
  tx: PrismaTransactionClient,
  machine: string,
  anchor: { id: number; startTime: Date; endTime: Date },
  excludeIds: ReadonlySet<number> = new Set()
): Promise<AppliedMove[]> {
  // Okno bloků: den před anchorem až 90 dní za jeho koncem (chain push posouvá jen dopředu).
  const windowStart = new Date(anchor.startTime.getTime() - DAY_MS);
  const windowEnd = new Date(anchor.endTime.getTime() + 90 * DAY_MS);
  // Okno kalendáře: + MAX_SPAN_DAYS rezerva — blok umístěný u konce okna bloků může
  // expandovat až 21 dní za něj (precondition expandPrintTime: kompletní weekShifts fetch).
  const calendarEnd = new Date(windowEnd.getTime() + MAX_SPAN_DAYS * DAY_MS);

  const weekStarts = new Set<string>();
  for (let t = windowStart.getTime(); t <= calendarEnd.getTime(); t += DAY_MS) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  weekStarts.add(weekStartStrFromDateStr(pragueOf(calendarEnd).dateStr));

  const [rows, rawWeekShifts, cdRows] = await Promise.all([
    tx.block.findMany({
      where: {
        machine,
        // anchor + sourozenci ve stejné dávce (lasso) se neposouvají
        id: { notIn: [anchor.id, ...excludeIds] },
        type: "ZAKAZKA",
        startTime: { lt: windowEnd },
        endTime: { gt: windowStart },
      },
      select: {
        id: true,
        orderNumber: true,
        startTime: true,
        endTime: true,
        locked: true,
        printCompletedAt: true,
        printMinutes: true,
        scheduleBypassed: true,
      },
    }),
    tx.machineWeekShifts.findMany({
      where: {
        machine,
        weekStart: { in: Array.from(weekStarts).map((s) => new Date(`${s}T00:00:00.000Z`)) },
      },
    }),
    tx.companyDay.findMany({
      where: {
        startDate: { lt: calendarEnd },
        endDate: { gt: windowStart },
        OR: [{ machine: null }, { machine }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const weekShifts: MachineWeekShiftsRow[] = serializeWeekShifts(rawWeekShifts);
  const companyDays: CompanyDayInterval[] = cdRows.map((c) => ({ start: c.startDate, end: c.endDate }));

  const others: BlockInterval[] = rows.map((r) => ({
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    // Vytištěné bloky (printCompletedAt) se chovají jako zamčené — tisk fyzicky proběhl,
    // nesmí se přeplánovat chain pushem (locked se při potvrzení tisku nenastavuje).
    locked: r.locked || r.printCompletedAt != null,
    printMinutes: r.printMinutes,
    scheduleBypassed: r.scheduleBypassed,
  }));

  const rowById = new Map(rows.map((r) => [r.id, r]));

  const result = computeChainPush(machine, anchor, others, weekShifts, companyDays);
  if (!result.ok) {
    if (result.reason === "LOCKED_CONFLICT") {
      const l = rowById.get(result.lockedId);
      throw new AppError(
        "OVERLAP",
        `Nelze uvolnit místo — koliduje se zamčeným blokem #${l?.orderNumber ?? result.lockedId}. Vyber jiné místo.`
      );
    }
    const b = rowById.get(result.blockId);
    throw new AppError(
      "SCHEDULE_VIOLATION",
      `Auto-posun bloku #${b?.orderNumber ?? result.blockId} nenašel místo v kalendáři — uvolni místo ručně.`
    );
  }
  if (result.moves.length === 0) return [];

  // Nezávislá pojistka (spec 3.6): každý posunutý blok musí mít end == expandPrintTime(...).
  // computeChainPush to garantuje konstrukcí; tohle chytá případný drift obou implementací.
  for (const m of result.moves) {
    const r = rowById.get(m.id)!;
    const pm = r.printMinutes ?? Math.round((r.endTime.getTime() - r.startTime.getTime()) / 60000);
    const exp = expandPrintTime(machine, m.startTime, pm, weekShifts, companyDays, r.scheduleBypassed);
    const cdHit = r.scheduleBypassed
      ? companyDays.find((cd) => cd.start < m.endTime && cd.end > m.startTime)
      : undefined;
    if (!exp.ok || exp.end.getTime() !== m.endTime.getTime() || cdHit) {
      throw new AppError(
        "SCHEDULE_VIOLATION",
        `Auto-posun bloku #${r.orderNumber ?? m.id} nesedí na kalendář — uvolni místo ručně.`
      );
    }
  }

  const applied: AppliedMove[] = [];
  for (const m of result.moves) {
    await tx.block.update({
      where: { id: m.id },
      data: { startTime: m.startTime, endTime: m.endTime },
    });
    const r = rowById.get(m.id)!;
    applied.push({
      ...m,
      orderNumber: r.orderNumber,
      oldStartTime: r.startTime,
      oldEndTime: r.endTime,
    });
  }
  return applied;
}
```

- [ ] **Step 4: Uprav 3 call sites** (odstranění argumentu `!bypassScheduleValidation`):

`src/app/api/blocks/route.ts` (~řádek 312):
```typescript
        shiftedMoves = await resolveChainPushFromDb(
          tx,
          body.machine,
          { id: newBlock.id, startTime: newBlock.startTime, endTime: newBlock.endTime }
        );
```

`src/app/api/blocks/[id]/route.ts` (~řádek 508):
```typescript
          shiftedMoves = await resolveChainPushFromDb(
            tx,
            updated.machine,
            { id: updated.id, startTime: updated.startTime, endTime: updated.endTime }
          );
```

`src/app/api/blocks/batch/route.ts` (~řádek 166):
```typescript
          const moves = await resolveChainPushFromDb(
            tx,
            u.machine,
            { id: u.id, startTime: new Date(u.startTime), endTime: computedEnds.get(u.id)?.end ?? new Date(u.endTime) },
            movedIds
          );
```

- [ ] **Step 5: Ověř**

Run: `node --test --import tsx src/lib/overlapResolver.server.test.ts && node --test --import tsx src/lib/overlapResolver.test.ts`
Expected: 7/7 a 11/11 pass.
Run: `npx tsc --noEmit`
Expected: 0 chyb.
Run: `npm run build`
Expected: build projde (routes se změnily).

---

### Task 5: `findNextFreePrintSlot` + napojení POST auto-shiftu

Auto-shift pro ZAKAZKA na model tiskových hodin: start-only snap + expanze; 7denní limit na POSUN STARTU; firemní odstávka už není blocker (blok ji pauzne) — blocker jsou jen existující bloky. Stará `findNextFreeSlot`/`findNextFreeSlotFromDb` ZŮSTÁVAJÍ (klientské preview + ne-ZAKAZKA) — nemazat, jen doplnit TODO(Plán 4) komentář.

**Files:**
- Modify: `src/lib/scheduleSlotFinder.ts`
- Modify: `src/lib/scheduleSlotFinder.test.ts` (přidat describe blok)
- Modify: `src/lib/scheduleSlotFinder.server.test.ts` (přidat describe blok)
- Modify: `src/app/api/blocks/route.ts` (2 call sites auto-shiftu)

**Interfaces:**
- Consumes: `snapStartToNextRunnableSlot`, `expandPrintTime`, `MAX_SPAN_DAYS`, `CompanyDayInterval` (Task 2 / printTime); `rawPrintMinutes` proměnná v POST route (etapa 2).
- Produces:
  - `PrintSlotSearchResult = { found: true; startTime: Date; endTime: Date; wasShifted: boolean } | { found: false; reason: "MAX_SHIFT_EXCEEDED" | "NO_CAPACITY" }`
  - `findNextFreePrintSlot(machine, proposedStart, printMinutes, blockedIntervals, weekShifts, companyDays, maxShiftMs?): PrintSlotSearchResult`
  - `findNextFreePrintSlotFromDb(machine, proposedStart, printMinutes, excludeBlockId?: number | null, maxShiftMs?): Promise<PrintSlotSearchResult>`

- [ ] **Step 1: Failing testy — pure funkce.** Do `src/lib/scheduleSlotFinder.test.ts` přidej importy a describe blok:

```typescript
import { findNextFreePrintSlot } from "./scheduleSlotFinder";
import { pragueToUTC } from "./dateUtils";
import type { CompanyDayInterval } from "./printTime";
import { xl106Week, mkDay, W1, W2 } from "./weekShiftsTestFixtures";
```

```typescript
describe("findNextFreePrintSlot (tiskové hodiny)", () => {
  const SHIFTS_106 = [...xl106Week(W1), ...xl106Week(W2)];
  const NO_CD: CompanyDayInterval[] = [];
  const P = pragueToUTC;

  it("40h blok přes víkend: start zůstává, end z expanze (span > délka)", () => {
    // Pá 10:00 + 2400 min: Pá 10–22 = 12 h, víkendová pauza, Ne 22 – Út 02 = 28 h → end Út 02:00.
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 2400, [], SHIFTS_106, NO_CD);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-21", 10));
      assert.deepEqual(r.endTime, P("2026-08-25", 2));
      assert.equal(r.wasShifted, false);
    }
  });

  it("limit 7 dní platí pro POSUN STARTU — end smí být za limitem", () => {
    // maxShift 4 h; kolize [Pá 10, Pá 12) → start Pá 12 (posun 2 h, v limitu),
    // end z expanze až Út 04:00 — daleko za limitem, a to je SPRÁVNĚ.
    const blocked = [{ start: P("2026-08-21", 10), end: P("2026-08-21", 12) }];
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 2400, blocked, SHIFTS_106, NO_CD, 4 * 3600000);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-21", 12));
      assert.deepEqual(r.endTime, P("2026-08-25", 4));
      assert.equal(r.wasShifted, true);
    }
  });

  it("start nelze posunout v limitu → MAX_SHIFT_EXCEEDED", () => {
    const blocked = [{ start: P("2026-08-21", 10), end: P("2026-08-21", 16) }];
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 240, blocked, SHIFTS_106, NO_CD, 4 * 3600000);
    assert.deepEqual(r, { found: false, reason: "MAX_SHIFT_EXCEEDED" });
  });

  it("firemní odstávka NENÍ blocker — blok ji pauzne", () => {
    // Po 20:00 + 8 h tisku, odstávka celé úterý: Po 20–24 = 4 h, pauza Út, St 0–4 = 4 h → end St 04:00.
    const cd: CompanyDayInterval[] = [{ start: P("2026-08-25", 0), end: P("2026-08-26", 0) }];
    const r = findNextFreePrintSlot("XL_106", P("2026-08-24", 20), 480, [], SHIFTS_106, cd);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-24", 20));
      assert.deepEqual(r.endTime, P("2026-08-26", 4));
      assert.equal(r.wasShifted, false);
    }
  });

  it("v horizontu není dost pracovní doby → NO_CAPACITY", () => {
    // Jen pátek m+a (12 h/týden) → 40 h tisku se do 21denního horizontu expanze nevejde.
    const sparse = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
      mkDay(W1, d, d === 5 ? { m: true, a: true } : { active: false }),
      mkDay(W2, d, d === 5 ? { m: true, a: true } : { active: false }),
    ]);
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 10), 2400, [], sparse, NO_CD);
    assert.deepEqual(r, { found: false, reason: "NO_CAPACITY" });
  });
});
```

Pozn.: `sparse` fixture pokrývá jen W1+W2 — třetí týden horizontu spadne na hardcoded fallback, který je AKTIVNÍ. Pokud test kvůli tomu neprojde s NO_CAPACITY, přidej třetí off týden: `mkDay("2026-08-31", d, …)` stejně jako W1/W2. Ověř reálným během a fixture uprav, expectation NO_CAPACITY je závazná.

- [ ] **Step 2: Run — musí failnout**

Run: `node --test --import tsx src/lib/scheduleSlotFinder.test.ts`
Expected: FAIL — funkce neexistuje.

- [ ] **Step 3: Implementace do `src/lib/scheduleSlotFinder.ts`.** Přidej importy a funkce (staré funkce nech beze změny, jen nad `findNextFreeSlot` doplň komentář `// TODO(Plán 4): duration-based finder zůstává pro klientské preview a ne-ZAKAZKA bloky.`):

```typescript
import {
  expandPrintTime,
  snapStartToNextRunnableSlot,
  MAX_SPAN_DAYS,
  type CompanyDayInterval,
} from "@/lib/printTime";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PrintSlotSearchResult =
  | { found: true; startTime: Date; endTime: Date; wasShifted: boolean }
  | { found: false; reason: "MAX_SHIFT_EXCEEDED" | "NO_CAPACITY" };

/**
 * Auto-shift pro ZAKAZKA v modelu tiskových hodin: start-only snap + expanze.
 *  1) start se snapne na nejbližší runnable slot (weekShifts + companyDays),
 *  2) end vyjde z expandPrintTime — blok smí pauznout přes odstávku,
 *  3) kolizní test na CELÉM expandovaném spanu proti `blockedIntervals` (JEN bloky —
 *     odstávky nejsou blocker, jsou součást kalendáře),
 *  4) `maxShiftMs` limituje POSUN STARTU, nikdy end (40h blok má span > 7 dní).
 *
 * Pure funkce — žádné DB volání.
 */
export function findNextFreePrintSlot(
  machine: string,
  proposedStart: Date,
  printMinutes: number,
  blockedIntervals: BlockedInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  maxShiftMs: number = MAX_AUTO_SHIFT_MS
): PrintSlotSearchResult {
  const limit = proposedStart.getTime() + maxShiftMs;
  let candidate = proposedStart;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const snapped = snapStartToNextRunnableSlot(machine, candidate, weekShifts, companyDays, limit);
    if (!snapped) return { found: false, reason: "MAX_SHIFT_EXCEEDED" };
    const exp = expandPrintTime(machine, snapped, printMinutes, weekShifts, companyDays, false);
    if (!exp.ok) return { found: false, reason: "NO_CAPACITY" };

    const conflict = blockedIntervals.find(
      (b) => b.start.getTime() < exp.end.getTime() && b.end.getTime() > snapped.getTime()
    );
    if (!conflict) {
      return {
        found: true,
        startTime: snapped,
        endTime: exp.end,
        wasShifted: snapped.getTime() !== proposedStart.getTime(),
      };
    }
    candidate = conflict.end;
  }
  return { found: false, reason: "MAX_SHIFT_EXCEEDED" };
}

/**
 * DB wrapper kolem findNextFreePrintSlot. Okno = maxShift (posun startu)
 * + MAX_SPAN_DAYS (worst-case span expanze) — NE +durationMs.
 * CompanyDays jdou do kalendáře (pauzy), NE mezi blocked intervaly.
 */
export async function findNextFreePrintSlotFromDb(
  machine: string,
  proposedStart: Date,
  printMinutes: number,
  excludeBlockId: number | null = null,
  maxShiftMs: number = MAX_AUTO_SHIFT_MS
): Promise<PrintSlotSearchResult> {
  const windowEnd = new Date(proposedStart.getTime() + maxShiftMs + MAX_SPAN_DAYS * DAY_MS);

  const weekStarts = new Set<string>();
  for (let t = proposedStart.getTime(); t <= windowEnd.getTime(); t += DAY_MS) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  // DST fall-back ošetření: 24h UTC krok může přeskočit civilní datum.
  weekStarts.add(weekStartStrFromDateStr(pragueOf(windowEnd).dateStr));
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

  return findNextFreePrintSlot(
    machine,
    proposedStart,
    printMinutes,
    blocks.map((b) => ({ start: b.startTime, end: b.endTime })),
    serializeWeekShifts(rawWeekShifts),
    companyDays.map((c) => ({ start: c.startDate, end: c.endDate })),
    maxShiftMs
  );
}
```

- [ ] **Step 4: FromDb testy.** Do `src/lib/scheduleSlotFinder.server.test.ts` přidej describe blok (mock modul `@/lib/prisma` už tam je; import rozšiř o novou funkci: `const { findNextFreeSlotFromDb, findNextFreePrintSlotFromDb } = await import("@/lib/scheduleSlotFinder");`):

```typescript
describe("findNextFreePrintSlotFromDb (tiskové hodiny)", () => {
  beforeEach(() => {
    mockBlocks.length = 0;
    mockCompanyDays.length = 0;
    mockWeekShifts.length = 0;
  });

  it("kolize s blokem → start za jeho koncem, end z expanze", async () => {
    mockBlocks.push({
      startTime: new Date("2026-09-15T10:00:00.000Z"),
      endTime: new Date("2026-09-15T16:00:00.000Z"),
    });
    const r = await findNextFreePrintSlotFromDb("XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
    assert.equal(r.found, true);
    if (r.found) {
      assert.equal(r.startTime.toISOString(), "2026-09-15T16:00:00.000Z");
      assert.equal(r.endTime.toISOString(), "2026-09-15T20:00:00.000Z");
      assert.equal(r.wasShifted, true);
    }
  });

  it("firemní odstávka NENÍ blocker — start se snapne za ni a blok nepauzne zbytečně", async () => {
    // Odstávka celý den 15. 9.: start 10:00Z není runnable → snap na konec odstávky
    // (00:00Z 16. 9. = 02:00 Praha, XL_105 fallback je 24/7 mimo Ne odpoledne → runnable).
    mockCompanyDays.push({
      startDate: new Date("2026-09-15T00:00:00.000Z"),
      endDate: new Date("2026-09-16T00:00:00.000Z"),
    });
    const r = await findNextFreePrintSlotFromDb("XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
    assert.equal(r.found, true);
    if (r.found) {
      assert.equal(r.startTime.toISOString(), "2026-09-16T00:00:00.000Z");
      assert.equal(r.endTime.toISOString(), "2026-09-16T04:00:00.000Z");
    }
  });

  it("> 7 dní obsazeno → MAX_SHIFT_EXCEEDED", async () => {
    mockBlocks.push({
      startTime: new Date("2026-09-15T00:00:00.000Z"),
      endTime: new Date("2026-09-30T00:00:00.000Z"),
    });
    const r = await findNextFreePrintSlotFromDb("XL_105", new Date("2026-09-15T10:00:00.000Z"), 240);
    assert.deepEqual(r, { found: false, reason: "MAX_SHIFT_EXCEEDED" });
  });
});
```

- [ ] **Step 5: Napoj POST route.** V `src/app/api/blocks/route.ts`:

Import (řádek ~12): `import { findNextFreeSlotFromDb, findNextFreePrintSlotFromDb } from "@/lib/scheduleSlotFinder";`

Pre-tx auto-shift větev (~řádky 101–115) — nahraď volání i chybovou větev:

```typescript
      // Auto-shift (série z přehledu): start-only snap + expanze — start se snapne na
      // nejbližší aktivní slot a délka se rozloží přes pauzy, žádný teleport za souvislým oknem.
      if (rawPrintMinutes == null) {
        return NextResponse.json({ error: sched.error }, { status: 422 });
      }
      const slot = await findNextFreePrintSlotFromDb(body.machine as string, startTime, rawPrintMinutes);
      if (!slot.found) {
        const msg =
          slot.reason === "NO_CAPACITY"
            ? `Auto-shift selhal: v kalendáři stroje ${body.machine} není dost pracovní doby pro ${rawPrintMinutes} min tisku.`
            : `Auto-shift selhal: stroj ${body.machine} obsazen déle než 7 dní od ${originalStart.toISOString()}.`;
        return NextResponse.json({ error: msg }, { status: 409 });
      }
```

(zbytek větve — `startTime = slot.startTime; endTime = slot.endTime; wasShifted = true; effectiveBypassed = false;` + logger — beze změny).

In-tx race recovery (~řádek 166) — ZAKAZKA jde přes print finder, ostatní typy zůstávají na duration-based:

```typescript
          // Race condition: slot byl mezi pre-check a transakcí obsazen.
          const slot =
            blockType === "ZAKAZKA" && rawPrintMinutes != null
              ? await findNextFreePrintSlotFromDb(body.machine, startTime, rawPrintMinutes)
              : await findNextFreeSlotFromDb(body.machine, startTime, durationMs);
          if (!slot.found) {
            throw new AppError(
              "AUTO_SHIFT_FAILED",
              `Auto-shift selhal: stroj ${body.machine} obsazen déle než 7 dní od ${originalStart.toISOString()}.`
            );
          }
```

(navazující `sched2 = validateAndComputeEnd(...)` re-validace beze změny — zůstává jediným zdrojem pravdy pro end.)

- [ ] **Step 6: Ověř**

Run: `node --test --import tsx src/lib/scheduleSlotFinder.test.ts && node --test --import tsx src/lib/scheduleSlotFinder.server.test.ts`
Expected: 11/11 a 7/7 pass (6+5 / 4+3).
Run: `npx tsc --noEmit && npm run build`
Expected: 0 chyb, build projde.

---

### Task 6: Intra-group hláška pro lasso batch

Přenos z ledgeru P2T5: per-blok re-expanze může sourozencům v lasso dávce změnit délky → překryv UVNITŘ dávky. Chain push sourozence záměrně neposouvá (excludeIds), takže stav je neřešitelný a dnes končí generickou 409 z finální pojistky. Pure pre-check dá konkrétní hlášku.

**Files:**
- Modify: `src/lib/overlapCheck.ts` (+ pure `findIntraBatchOverlap`)
- Modify: `src/lib/overlapCheck.test.ts` (+ testy)
- Modify: `src/app/api/blocks/batch/route.ts` (pre-check po `computedEnds` smyčce)

**Interfaces:**
- Consumes: `computedEnds` mapa v batch route (etapa 2).
- Produces: `BatchSpan = { id: number; orderNumber: string | null; machine: string; start: Date; end: Date }`; `findIntraBatchOverlap(spans: BatchSpan[]): [BatchSpan, BatchSpan] | null`.

- [ ] **Step 1: Failing testy** — do `src/lib/overlapCheck.test.ts` přidej:

```typescript
import { findIntraBatchOverlap, type BatchSpan } from "@/lib/overlapCheck";

describe("findIntraBatchOverlap", () => {
  const span = (id: number, machine: string, startH: number, endH: number): BatchSpan => ({
    id,
    orderNumber: `B${id}`,
    machine,
    start: new Date(`2026-06-16T${String(startH).padStart(2, "0")}:00:00Z`),
    end: new Date(`2026-06-16T${String(endH).padStart(2, "0")}:00:00Z`),
  });

  it("bez překryvu → null", () => {
    assert.equal(findIntraBatchOverlap([span(1, "XL_105", 10, 12), span(2, "XL_105", 12, 14)]), null);
  });

  it("překryv na stejném stroji → vrátí pár", () => {
    const pair = findIntraBatchOverlap([span(1, "XL_105", 10, 13), span(2, "XL_105", 12, 14)]);
    assert.ok(pair);
    assert.deepEqual([pair![0].id, pair![1].id], [1, 2]);
  });

  it("stejné časy na RŮZNÝCH strojích → null", () => {
    assert.equal(findIntraBatchOverlap([span(1, "XL_105", 10, 13), span(2, "XL_106", 12, 14)]), null);
  });

  it("obalený interval (ne-sousední po sortu) se chytí přes running max end", () => {
    // A 10–20 obaluje C 14–15; mezi nimi B 11–12 (uvnitř A) — running max end = A.end.
    const pair = findIntraBatchOverlap([span(1, "XL_105", 10, 20), span(2, "XL_105", 11, 12), span(3, "XL_105", 14, 15)]);
    assert.ok(pair);
    assert.equal(pair![0].id, 1);
  });

  it("dotýkající se bloky (half-open) → null", () => {
    assert.equal(findIntraBatchOverlap([span(1, "XL_105", 10, 12), span(2, "XL_105", 12, 14), span(3, "XL_105", 14, 16)]), null);
  });
});
```

- [ ] **Step 2: Run — FAIL** (funkce neexistuje): `node --test --import tsx src/lib/overlapCheck.test.ts`

- [ ] **Step 3: Implementace** — do `src/lib/overlapCheck.ts` přidej:

```typescript
/** Span bloku v batch dávce po serverovém přepočtu endů. */
export type BatchSpan = {
  id: number;
  orderNumber: string | null;
  machine: string;
  start: Date;
  end: Date;
};

/**
 * Pure pre-check překryvu UVNITŘ jedné batch dávky (per stroj, half-open [start, end)).
 * Re-expanze (tiskové hodiny) může sourozencům v lasso přesunu změnit délky — vzniklý
 * intra-group překryv chain push neřeší (sourozenci jsou v excludeIds), takže si zaslouží
 * konkrétní hlášku místo generické 409 z finální pojistky. Vrací první kolidující pár.
 */
export function findIntraBatchOverlap(spans: BatchSpan[]): [BatchSpan, BatchSpan] | null {
  const byMachine = new Map<string, BatchSpan[]>();
  for (const s of spans) {
    const arr = byMachine.get(s.machine) ?? [];
    arr.push(s);
    byMachine.set(s.machine, arr);
  }
  for (const arr of byMachine.values()) {
    const sorted = [...arr].sort((a, b) => a.start.getTime() - b.start.getTime());
    let maxEndSpan = sorted[0]!;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start.getTime() < maxEndSpan.end.getTime()) return [maxEndSpan, sorted[i]!];
      if (sorted[i]!.end.getTime() > maxEndSpan.end.getTime()) maxEndSpan = sorted[i]!;
    }
  }
  return null;
}
```

- [ ] **Step 4: Napoj batch route.** V `src/app/api/blocks/batch/route.ts` import rozšiř: `import { checkBlockOverlap, assertNoOverlapForBlocks, findIntraBatchOverlap } from "@/lib/overlapCheck";` a HNED ZA `for`-smyčku plnící `computedEnds` (uvnitř `if (zakazkaUpdates.length > 0)`) vlož:

```typescript
        // Intra-group pre-check: re-expanze mohla sourozencům změnit délky → překryv
        // UVNITŘ dávky je neřešitelný (chain push sourozence neposouvá) → konkrétní
        // hláška místo generické 409 z finální pojistky.
        const pair = findIntraBatchOverlap(
          zakazkaUpdates.map((u) => ({
            id: u.id,
            orderNumber: existingBlocks.find((b) => b.id === u.id)?.orderNumber ?? null,
            machine: u.machine,
            start: new Date(u.startTime),
            end: computedEnds.get(u.id)!.end,
          }))
        );
        if (pair) {
          throw new AppError(
            "OVERLAP",
            `Bloky #${pair[0].orderNumber ?? pair[0].id} a #${pair[1].orderNumber ?? pair[1].id} se po přepočtu délek překrývají mezi sebou — přesuň je jednotlivě nebo zvol jiné místo.`
          );
        }
```

- [ ] **Step 5: Ověř**

Run: `node --test --import tsx src/lib/overlapCheck.test.ts`
Expected: 13/13 pass (8 + 5 nových).
Run: `npx tsc --noEmit && npm run build`
Expected: 0 chyb, build projde.

---

### Task 7: Dokumentace + finální verifikace etapy

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Spusť celou suite a spočítej reálné počty**

```bash
for f in src/lib/dateUtils.test.ts src/lib/errors.test.ts src/lib/pasteTarget.test.ts \
  src/lib/clipboardCopy.test.ts src/lib/printTime.test.ts src/lib/printTime.server.test.ts \
  src/lib/scheduleValidationServer.test.ts src/lib/overlapCheck.test.ts \
  src/lib/overlapResolver.test.ts src/lib/overlapResolver.server.test.ts \
  src/lib/scheduleSlotFinder.test.ts src/lib/scheduleSlotFinder.server.test.ts; do
  node --test --import tsx "$f" 2>&1 | tail -n 12 | grep -E "^# (pass|fail)" | xargs echo "$f:";
done
```
Expected: fail 0 všude. Očekávané přírůstky: printTime 19, overlapResolver 11, overlapResolver.server 7, scheduleSlotFinder 11, scheduleSlotFinder.server 7, overlapCheck 13 — REÁLNÉ počty ověř během.

- [ ] **Step 2: Aktualizuj CLAUDE.md**

1. Sekce „Spuštění testů": přidej řádky pro `overlapCheck.test.ts`, `overlapResolver.test.ts`, `overlapResolver.server.test.ts`, `scheduleSlotFinder.test.ts`, `scheduleSlotFinder.server.test.ts` s reálnými počty; aktualizuj počty u `printTime.test.ts`; přepočítej celkový součet v „Ověřený stav".
2. Sekce „Validace harmonogramu": doplň odstavec (za popis `validateAndComputeEnd`):

```markdown
Chain push (`resolveChainPushFromDb`) a auto-shift (`findNextFreePrintSlotFromDb`) od etapy 3
umísťují bloky přes start-only snap (`snapStartToNextRunnableSlot`) + `expandPrintTime` podle
per-blok `printMinutes` a `scheduleBypassed` — odsunutý blok smí pauznout přes odstávku a jeho
end vždy sedí na kalendář. Kolize se zamčeným/vytištěným blokem = odmítnutí transakce s hláškou
(žádné tiché přeskládání). Limit auto-shiftu (7 dní) platí pro posun STARTU, ne endu.
Stará duration-based `findNextFreeSlot`/`findNextFreeSlotFromDb` zůstává jen pro klientské
preview a ne-ZAKAZKA bloky (TODO Plán 4).
```

3. „Klíčové soubory → Sdílené utility": přidej řádek pro `src/lib/weekShiftsTestFixtures.ts` (test-only fixtury pracovní doby).

- [ ] **Step 3: Finální verifikace**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: tsc 0 chyb; lint jen známé warningy (0 errors); build projde.
Run: `npx tsx scripts/detect-legacy-bypass.ts 2>&1 | tail -2`
Expected: stále `165 ... 14 ... 1` (Plán 3 nemění data).

---

## Self-review (provedeno při psaní plánu)

- **Spec coverage:** 3.5 → Task 2 (server); 3.6 → Tasky 3+4 vč. hlášky zamčeného bloku a verifikačního post-checku; 3.8 → Task 5 (start-only, limit na start, worst-case fetch okno); „přepis dotčených testů" → v každém tasku; riziko „kaskáda přes víkend" → integrační testy v Tasku 3; ledger přenosy → Task 1 (tsc dluh), Task 6 (intra-group hláška), baseline detect skriptu ověřena před startem. Limit 40 h byl hotový v etapě 2 (validateAndComputeEnd). Klientská část 3.5 (snapGroupDelta) je explicitně Plán 4.
- **Typová konzistence:** `BlockInterval`/`ChainPushResult` (Task 3) ↔ použití v Task 4; `snapStartToNextRunnableSlot` (Task 2) ↔ Task 3 a 5; `PrintSlotSearchResult` ↔ POST route; `BatchSpan` ↔ batch route.
- **Známá nejistota:** přesné end-časy víkendových expanzí (Po 00:00 / Út 02:00 …) jsou spočítané ručně ze směn fixtur — pokud reálný běh ukáže odchylku o slot, ověř výpočet proti `expandPrintTime` (ten je zdroj pravdy, testy expanze má z etapy 1) a KOREKTNĚ uprav expectation, ne implementaci; div se jen, kdyby nesedělo o víc než slot.
