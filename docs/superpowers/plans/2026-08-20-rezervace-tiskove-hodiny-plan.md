# Rezervace dostanou plné tiskové hodiny — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typ `REZERVACE` získá stejný geometrický engine jako `ZAKAZKA` (printMinutes + expanze přes pauzy směn na serveru i klientovi, drift, reflow), `UDRZBA` zůstává rigidní beze změny — a jako tvrdá prerekvizita se zavede synchronizace `Reservation.scheduled*` na všech zápisových cestách.

**Architecture:** Jediný zdroj pravdy o tom, kdo tiskové hodiny používá, je nová čistá funkce `usesTiskoveHodiny` (`src/lib/printTime.ts`) — ZAKAZKA vždy, REZERVACE jen s vyplněnými `printMinutes` (legacy rezervace, kterou backfill přeskočil, zůstává rigidní „jako dnes"), UDRZBA nikdy. Server i klient všech ~25 dnešních dichotomií `type === "ZAKAZKA"` konzumují tento helper (nebo jeho payloadovou variantu `typeUsesTiskoveHodiny` pro nové bloky). Chain push dostává pro REZERVACE tiskovou geometrii se 7denním stropem `maxPushMs` (rozhodnutí #1 — dluh P31 se nekopíruje na druhý typ). Implementace jde v 5 fázích, z nichž každá je samostatně commitovatelná a nasaditelná: fáze 0 (sync scheduled*) a 1 (backfill) nemění chování geometrie vůbec; fáze 2 je flip rozdělený na server (2a, sám o sobě koherentní) a klienta (2b); fáze 3 drift/reflow/undo; fáze 4 report.

**Tech Stack:** Next.js 16 · TypeScript · Prisma 5 · node:test + tsx (žádné DOM testy — `TimelineGrid.tsx`/`PlannerPage.tsx` drag logika se ověřuje manuálně, čistá logika v `src/lib/` testy).

**Spec:** `docs/superpowers/specs/2026-08-20-rezervace-tiskove-hodiny.md` — sekce 6 „ROZHODNUTO 20. 8. 2026" je závazná (všech 9 rozhodnutí). Řádková čísla ve specu jsou k 19.–20. 8.; tento plán je ověřil proti HEAD `624e5126` a kde se kód hnul (etapa 3 — `snapGroupPerBlock` už existuje a multi-move větev v `TimelineGrid` ho už volá), pracuje se skutečným stavem.

## Global Constraints

- **Spec je autorita.** Všech 9 rozhodnutí ze sekce 6 je závazných: (1) 7denní strop pro REZERVACE i na tiskové geometrii, (2) `scheduleBypassed` pro rezervace ANO, (3) drift stejný kanál jako ZAKAZKA, (4) undo MOVE/reflow rezervací zůstává, (5) NE do vytížení + NOVÝ ukazatel „rezervovaná kapacita", (6) žádné notifikace obchodníkovi, jen sync `scheduled*`, (7) split rezervace mimo rozsah, (8) backfill s dry-run reportem pro Vojtu, (9) tichý sebeposun v POST odstranit.
- **`UDRZBA` zůstává rigidní ÚPLNĚ VŠUDE** — žádná změna jejího chování v žádné vrstvě.
- **Legacy REZERVACE s `printMinutes = null` zůstává rigidní** („funguje jako dnes, dokud se ručně neopraví" — spec §3 krok 2). To je důvod, proč je `usesTiskoveHodiny` funkce bloku (typ + printMinutes), ne jen typu — a proč je nasazení fáze 2 bezpečné i PŘED spuštěním backfillu (existující rezervace se do backfillu chovají jako dnes).
- **Žádný `prisma migrate dev`, žádná nová migrace** — etapa nepřidává sloupce (`printMinutes`/`scheduleBypassed` na `Block` existují). Backfill je TS skript (`scripts/`), ne SQL migrace.
- **Každá mutace bloku přes `withRevision`** — uvnitř těl ŽÁDNÉ `prisma.*` ani pro čtení (hlídá `revisionWiring.test.ts`). Backfill skript je vědomá výjimka téže třídy jako DML v migracích (viz Task 3).
- **Počty strážných testů se OVĚŘUJÍ, ne odhadují** (poučení z etapy 3 — tabulkové řádky ≠ registrace testů): po každém tasku se spustí dotčený test soubor a v kroku je uvedený očekávaný výsledek; na konci fáze celá suite.
- **Produkční nasazení fáze 2 a dál až PO zapnutí `CASCADE_CONFIRM_ENFORCED`** (`src/lib/cascadeLimit.ts:20` — dnes `false`, režim měření). Spec §7 to jmenuje jako TVRDOU podmínku: bez vynuceného kaskádového potvrzení by první flip proběhl bez pojistky proti třídě havárie P31. Fáze 0 a 1 tuhle podmínku NEMAJÍ (nemění geometrii).
- **Notifikace `RESERVATION_RESCHEDULED` se NESTAVÍ** (rozhodnutí #6) — proto `syncReservationScheduleForBlocks` nebere `actor` parametr (spec §2 ho navrhoval jen kvůli notifikaci); vrací ale seznam skutečně změněných rezervací, aby budoucí notifikační etapa měla na co navázat.
- **Reportové vnější gaty `b.type === "ZAKAZKA"` před `blockReportSegments` zůstávají** (rozhodnutí #5) — s jedinou vyjmenovanou výjimkou v Tasku 17 (retro `segMap` kvůli ukazateli rezervované kapacity; vytížení samotné se NEMĚNÍ, filtry per typ zůstávají).
- Test suite (glob nejde do podsložek — každá složka zvlášť):
  `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
- `npm run build` a `npm run lint` čisté (0 chyb) na konci každé fáze.

---

# FÁZE 0 — Prerekvizita: synchronizace `Reservation.scheduled*` (Tasky 1–2)

**Co dělá:** jedno místo (`syncReservationScheduleForBlocks`), volané na konci každé transakce, která může posunout blok s `reservationId` — kotva i bloky odsunuté chain pushem. Opravuje EXISTUJÍCÍ dluh (`rezervace_chain_push_dluh.md`): už dnešní rigidní rezervace posunutá chain pushem nechává v `/rezervace` zastaralý termín.

**Když se nasadí JEN tahle fáze:** čistá oprava dnešního dluhu, žádná změna geometrie. Bezpečné nasadit kdykoli, nezávisle na etapě 6.

**Akceptace:** posun bloku s `reservationId` (drag, chain push sousedem, batch, undo) propíše `Reservation.scheduledMachine/StartTime/EndTime`; no-op posun rezervaci nesahá; strážný test hlídá 6 zapojených cest.

### Task 1: `syncReservationScheduleForBlocks` + unit testy

**Files:**
- Create: `src/lib/reservationSync.server.ts`
- Create: `src/lib/reservationSync.server.test.ts`

**Interfaces:**
- Consumes: `PrismaTransactionClient` (`src/lib/prismaTx.ts`).
- Produces: `export async function syncReservationScheduleForBlocks(tx: PrismaTransactionClient, blockIds: number[]): Promise<number[]>` — vrací id rezervací, které se SKUTEČNĚ změnily (pro budoucí notifikační etapu; dnes je konzumuje jen test).

- [ ] **Step 1: Failing testy**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncReservationScheduleForBlocks } from "./reservationSync.server";
import type { PrismaTransactionClient } from "./prismaTx";

type BlockRow = { id: number; reservationId: number | null; machine: string; startTime: Date; endTime: Date };
type ResRow = {
  id: number; scheduledBlockId: number | null; scheduledMachine: string | null;
  scheduledStartTime: Date | null; scheduledEndTime: Date | null;
};

const T = (h: number) => new Date(`2026-08-21T${String(h).padStart(2, "0")}:00:00.000Z`);

function mkTx(blocks: BlockRow[], reservations: ResRow[]) {
  const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
  const tx = {
    block: {
      // Fake promítá where (poučení P9): id in + reservationId not null.
      findMany: async (args: { where: { id: { in: number[] } } }) =>
        blocks.filter((b) => args.where.id.in.includes(b.id)),
    },
    reservation: {
      findMany: async (args: { where: { id: { in: number[] } } }) =>
        reservations.filter((r) => args.where.id.in.includes(r.id)),
      update: async (args: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
  } as unknown as PrismaTransactionClient;
  return { tx, updates };
}

test("sync: posunutý blok s reservationId propíše scheduled* a vrátí id rezervace", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 7, scheduledMachine: "XL_106", scheduledStartTime: T(8), scheduledEndTime: T(10) }],
  );
  const changed = await syncReservationScheduleForBlocks(tx, [7]);
  assert.deepEqual(changed, [3]);
  assert.deepEqual(updates, [{ id: 3, data: { scheduledMachine: "XL_106", scheduledStartTime: T(10), scheduledEndTime: T(12) } }]);
});

test("sync: shodné hodnoty → žádný update (no-op)", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 7, scheduledMachine: "XL_106", scheduledStartTime: T(10), scheduledEndTime: T(12) }],
  );
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, [7]), []);
  assert.equal(updates.length, 0);
});

test("sync: stale link (scheduledBlockId ukazuje jinam) → rezervace se nesynchronizuje", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 99, scheduledMachine: "XL_105", scheduledStartTime: T(1), scheduledEndTime: T(2) }],
  );
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, [7]), []);
  assert.equal(updates.length, 0);
});

test("sync: bloky bez reservationId se odfiltrují, prázdný vstup je no-op", async () => {
  const { tx, updates } = mkTx(
    [{ id: 8, reservationId: null, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [],
  );
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, [8]), []);
  assert.deepEqual(await syncReservationScheduleForBlocks(tx, []), []);
  assert.equal(updates.length, 0);
});

test("sync: duplikátní blockIds → jediný update", async () => {
  const { tx, updates } = mkTx(
    [{ id: 7, reservationId: 3, machine: "XL_106", startTime: T(10), endTime: T(12) }],
    [{ id: 3, scheduledBlockId: 7, scheduledMachine: "XL_106", scheduledStartTime: T(8), scheduledEndTime: T(10) }],
  );
  await syncReservationScheduleForBlocks(tx, [7, 7, 7]);
  assert.equal(updates.length, 1);
});
```

Run: `node --test --import tsx src/lib/reservationSync.server.test.ts`
Expected: FAIL — modul `reservationSync.server` neexistuje.

- [ ] **Step 2: Implementace**

```typescript
import type { PrismaTransactionClient } from "@/lib/prismaTx";

/**
 * Zrcadlo `Reservation.scheduledMachine/StartTime/EndTime` po posunu bloků —
 * prerekvizita etapy 9 (spec §2, dluh `rezervace_chain_push_dluh.md`).
 *
 * Volá se JEDNOU na konci každé transakce, která mohla posunout blok
 * s `reservationId` (kotva + bloky odsunuté chain pushem) — ne uvnitř
 * `resolveChainPushFromDb`, protože ten aktualizuje jen sousedy, ne kotvu.
 * Zapojených cest je 6 a hlídá je `reservationSyncWiring.test.ts`.
 *
 * Pravidla:
 * - synchronizuje se JEN rezervace, jejíž `scheduledBlockId` ukazuje na daný
 *   blok (stale link po ručním přepnutí typu apod. se nedotýká),
 * - no-op posun (hodnoty shodné) rezervaci NEZAPISUJE — `updatedAt` rezervace
 *   se nesmí zvedat při každém průchodu,
 * - vrací id skutečně změněných rezervací. Notifikace obchodníkovi se z nich
 *   ZATÍM neposílá (rozhodnutí #6 specu, 20. 8. 2026) — až notifikační etapa
 *   přibude, naváže tady, proto funkce nebere `actor`.
 *
 * Post-filtr `reservationId != null` za findMany je záměrně DVOJITÝ (where +
 * filter): fake databáze v testech where nepromítají celé (poučení P9) a bez
 * post-filtru by helper sáhl na `tx.reservation` i tam, kde žádná vazba není.
 */
export async function syncReservationScheduleForBlocks(
  tx: PrismaTransactionClient,
  blockIds: number[],
): Promise<number[]> {
  const unique = [...new Set(blockIds)];
  if (unique.length === 0) return [];
  const rows = (
    await tx.block.findMany({
      where: { id: { in: unique }, reservationId: { not: null } },
      select: { id: true, reservationId: true, machine: true, startTime: true, endTime: true },
    })
  ).filter((r) => r.reservationId != null);
  if (rows.length === 0) return [];

  const reservations = await tx.reservation.findMany({
    where: { id: { in: rows.map((r) => r.reservationId as number) } },
    select: {
      id: true, scheduledBlockId: true, scheduledMachine: true,
      scheduledStartTime: true, scheduledEndTime: true,
    },
  });
  const byId = new Map(reservations.map((r) => [r.id, r]));

  const changed: number[] = [];
  for (const b of rows) {
    const res = byId.get(b.reservationId as number);
    if (!res) continue;
    if (res.scheduledBlockId !== b.id) continue; // stale link — nesynchronizovat
    const same =
      res.scheduledMachine === b.machine &&
      res.scheduledStartTime?.getTime() === b.startTime.getTime() &&
      res.scheduledEndTime?.getTime() === b.endTime.getTime();
    if (same) continue;
    await tx.reservation.update({
      where: { id: res.id },
      data: { scheduledMachine: b.machine, scheduledStartTime: b.startTime, scheduledEndTime: b.endTime },
    });
    changed.push(res.id);
  }
  return changed;
}
```

- [ ] **Step 3: Testy PASS**

Run: `node --test --import tsx src/lib/reservationSync.server.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/reservationSync.server.ts src/lib/reservationSync.server.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): syncReservationScheduleForBlocks - zrcadlo scheduled* poli

Prerekvizita etapy 9 (spec 2026-08-20, sekce 2): jedno misto, ktere po
posunu bloku s reservationId propise Reservation.scheduledMachine/
StartTime/EndTime. Synchronizuje jen rezervace s platnym scheduledBlockId
linkem, no-op posuny nezapisuje, vraci id zmenenych rezervaci (budouci
notifikacni etapa na ne navaze - rozhodnuti #6: notifikace zatim ne).

Zapojeni na 6 zapisovych cest je nasledujici task.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Zapojení syncu na 6 cest + strážný test

**Files:**
- Modify: `src/app/api/blocks/route.ts` (POST — konec těla `withRevision`)
- Modify: `src/app/api/blocks/[id]/route.ts` (PUT — konec těla `withRevision`)
- Modify: `src/app/api/blocks/batch/route.ts` (konec těla `withRevision`)
- Modify: `src/app/api/blocks/[id]/split/route.ts` (konec těla `withRevision`)
- Modify: `src/lib/reflow.server.ts` (`reflowBlockInTx` — po `assertNoOverlapForBlocks`)
- Modify: `src/lib/undoApply.server.ts` (`applyUndoOps` — před `return result`)
- Create: `src/lib/reservationSyncWiring.test.ts`

**Interfaces:**
- Consumes: `syncReservationScheduleForBlocks` z Tasku 1.
- Produces: 6 volacích míst; DELETE `/api/blocks/[id]` se NEZAPOJUJE (mazání řeší rezervaci vlastní REJECTED větví, `[id]/route.ts:809-840`).

- [ ] **Step 1: POST `/api/blocks`**

Do importů přidej:

```typescript
import { syncReservationScheduleForBlocks } from "@/lib/reservationSync.server";
```

Najdi v těle `withRevision` (POST) závěr:

```typescript
      await assertNoOverlapForBlocks(body.machine, [newBlock.id, ...shiftedMoves.map((m) => m.id)], tx);

      return { newBlock, shiftedMoves };
```

a vlož mezi pojistku a return:

```typescript
      // Zrcadlo Reservation.scheduled* — kotva i bloky odsunuté chain pushem (etapa 9, fáze 0).
      // Pro čerstvě zaplánovanou rezervaci je to no-op (updateMany výše zapsal tytéž hodnoty).
      await syncReservationScheduleForBlocks(tx, [newBlock.id, ...shiftedMoves.map((m) => m.id)]);
```

- [ ] **Step 2: PUT `/api/blocks/[id]`**

Stejný import. Najdi v těle PUT `withRevision`:

```typescript
      return { block: updated, shifted: shiftedMoves, propagatedGroupId };
```

a před něj vlož:

```typescript
      // Zrcadlo Reservation.scheduled* — editovaný blok i bloky odsunuté chain pushem (etapa 9, fáze 0).
      await syncReservationScheduleForBlocks(tx, [updated.id, ...shiftedMoves.map((m) => m.id)]);
```

- [ ] **Step 3: batch**

Stejný import. Najdi:

```typescript
      return { updated, shiftedIds: shiftedMoves.map((m) => m.id) };
```

a před něj vlož:

```typescript
      // Zrcadlo Reservation.scheduled* — všechny přesunuté bloky dávky + odsunuté chain pushem (etapa 9, fáze 0).
      await syncReservationScheduleForBlocks(tx, [...updates.map((u) => u.id), ...shiftedMoves.map((m) => m.id)]);
```

- [ ] **Step 4: split**

Stejný import. Najdi:

```typescript
      await assertNoOverlapForBlocks(block.machine, [headUpdated.id, tailCreated.id, ...shiftedMoves.map((m) => m.id)], tx);

      return { head: headUpdated, tail: tailCreated, shifted: shiftedMoves, headBefore };
```

a mezi pojistku a return vlož:

```typescript
      // Zrcadlo Reservation.scheduled* — hlava (nese případný reservationId), ocas i odsunuté (etapa 9, fáze 0).
      // Split je ZAKAZKA-only, ale ZAKAZKA vzniklá překlopením rezervace si reservationId nese dál.
      await syncReservationScheduleForBlocks(tx, [headUpdated.id, tailCreated.id, ...shiftedMoves.map((m) => m.id)]);
```

- [ ] **Step 5: reflow**

Do importů `src/lib/reflow.server.ts` přidej:

```typescript
import { syncReservationScheduleForBlocks } from "@/lib/reservationSync.server";
```

Najdi v `reflowBlockInTx`:

```typescript
  await assertNoOverlapForBlocks(block.machine, [blockId, ...moves.map((m) => m.id)], tx);
```

a hned ZA něj vlož:

```typescript
  // Zrcadlo Reservation.scheduled* — přepočítaný blok i odsunuté navazující (etapa 9, fáze 0).
  // Pokrývá jednoblokové „Přepočítat" i hromadný reflowMachineInTx (volá tuto funkci per blok).
  await syncReservationScheduleForBlocks(tx, [blockId, ...moves.map((m) => m.id)]);
```

- [ ] **Step 6: undo**

Do importů `src/lib/undoApply.server.ts` přidej stejný import. Najdi konec `applyUndoOps`:

```typescript
  return result;
}
```

a před `return result;` vlož (za smyčku `assertNoOverlapForBlocks`, před komentář o logování):

```typescript
  // Zrcadlo Reservation.scheduled* — obnovené i vzkříšené bloky s vazbou na rezervaci
  // (etapa 9, fáze 0). Bez toho by Ctrl+Z vrátil Block.startTime/endTime, ale
  // Reservation.scheduled* by zůstalo na hodnotě PŘED undem (spec §4.11).
  await syncReservationScheduleForBlocks(tx, [...result.updatedIds, ...result.createdIds]);
```

- [ ] **Step 7: Strážný test zapojení**

`src/lib/reservationSyncWiring.test.ts` (jednodušší sourozenec `revisionWiring.test.ts` — stačí přítomnost importu a počet volání, těla transakcí hlídá revisionWiring):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * STRÁŽNÝ TEST ZAPOJENÍ syncReservationScheduleForBlocks (etapa 9, fáze 0).
 *
 * Chain push posouvá bloky s reservationId na ŠESTI cestách; zapomenutá cesta
 * = obchodník vidí v /rezervace zastaralý termín (třída dluhu
 * rezervace_chain_push_dluh.md). Vzor revisionWiring.test.ts — čte zdrojáky
 * jako text; nová mutační cesta bloku patří do tabulky níž.
 *
 * DELETE /api/blocks/[id] tu ZÁMĚRNĚ není: mazání překlápí rezervaci na
 * REJECTED a nuluje scheduled* vlastní větví.
 */
const WIRED: Array<{ file: string; calls: number }> = [
  { file: "src/app/api/blocks/route.ts", calls: 1 },
  { file: "src/app/api/blocks/[id]/route.ts", calls: 1 },
  { file: "src/app/api/blocks/batch/route.ts", calls: 1 },
  { file: "src/app/api/blocks/[id]/split/route.ts", calls: 1 },
  { file: "src/lib/reflow.server.ts", calls: 1 },
  { file: "src/lib/undoApply.server.ts", calls: 1 },
];

for (const w of WIRED) {
  test(`${w.file} volá syncReservationScheduleForBlocks (${w.calls}×)`, () => {
    const src = readFileSync(join(process.cwd(), w.file), "utf8");
    assert.match(
      src,
      /import \{ syncReservationScheduleForBlocks \} from "@\/lib\/reservationSync\.server";/,
      "cesta musí importovat sync helper",
    );
    const count = src.split("syncReservationScheduleForBlocks(").length - 1;
    assert.equal(
      count,
      w.calls,
      `očekává se ${w.calls} volání, nalezeno ${count} — cesta byla odpojena, nebo přibylo neevidované volání`,
    );
  });
}
```

- [ ] **Step 8: Testy + build**

Run: `node --test --import tsx src/lib/reservationSyncWiring.test.ts src/lib/reservationSync.server.test.ts src/lib/reflow.server.test.ts src/lib/undo/*.test.ts`
Expected: vše PASS. (Reflow/undo testy mají fake tx bez `reservation` delegátu — post-filtr v helperu zajistí, že se na `tx.reservation` vůbec nesáhne, protože fake řádky `reservationId` nemají. Pokud by některý fake spadl na `tx.reservation is undefined`, doplň do jeho `mkTx` řádek `reservation: { findMany: mock.fn(async () => []), update: mock.fn(async () => ({})) },` — a poznamenej to v commitu.)

Run: `npm run build`
Expected: 0 TS chyb.

- [ ] **Step 9: Ruční ověření na dev (port 3001)**

1. Naplánuj rezervaci z fronty (queue-drop) → v DB `Reservation.scheduled*` odpovídá bloku (to fungovalo i dřív).
2. Přetáhni blok rezervace jinam (drag) → `scheduledStartTime` v DB se změnil (dřív NE — to je oprava dluhu).
3. Polož zakázku s `resolveChain` PŘED rezervaci tak, aby ji chain push odsunul → `scheduled*` odpovídá nové pozici.
4. Ctrl+Z přesunu z bodu 2 → `scheduled*` zpátky na původních hodnotách.

- [ ] **Step 10: Commit**

```bash
git add src/app/api/blocks/route.ts "src/app/api/blocks/[id]/route.ts" src/app/api/blocks/batch/route.ts "src/app/api/blocks/[id]/split/route.ts" src/lib/reflow.server.ts src/lib/undoApply.server.ts src/lib/reservationSyncWiring.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): zapojit sync scheduled* na 6 zapisovych cest + strazny test

POST/PUT/batch/split (konec tela withRevision), reflowBlockInTx a
applyUndoOps volaji syncReservationScheduleForBlocks nad kotvou i bloky
odsunutymi chain pushem. Opravuje dluh rezervace_chain_push_dluh.md -
posunuta rezervace uz nenechava v /rezervace zastaraly termin.
reservationSyncWiring.test.ts hlida vsech 6 cest (vzor revisionWiring).
DELETE zapojeny neni - mazani resi rezervaci vlastni REJECTED vetvi.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

# FÁZE 1 — Data: backfill `printMinutes` s dry-run reportem (Task 3)

**Co dělá:** jednorázový skript spočítá pro existující `REZERVACE` bloky `printMinutes = computePrintMinutes(...)` (inverze dnešní expanze — blok po flipu okamžitě konformuje) a `scheduleBypassed` podle shody expanze s uloženým endem. Dry-run report jde Vojtovi ke schválení PŘED ostrým zápisem (rozhodnutí #8).

**Když se nasadí JEN tahle fáze (kód) / spustí backfill:** `printMinutes` na `REZERVACE` je k HEAD téhle fáze INERTNÍ — ověřený seznam konzumentů (`chainPushGeometry`, `validateAndComputeEnd`, `blockPrintMinutes`, `tryExpandForBlock`, batch filtr, `detectCalendarDrift`, reflow guard) ne-ZAKAZKA `printMinutes` ignoruje. Žádná změna chování, dokud se nenasadí fáze 2.

**Akceptace:** dry-run vypíše počty CONFORMS / MISMATCH / SKIP_UNALIGNED / SKIP_NO_MINUTES / SKIP_HAS_PM + řádkový výpis; `--apply` zapíše jen po Vojtově review; na produkci VŽDY po `mysqldump` záloze a po `SELECT COUNT(*) FROM Block WHERE type='REZERVACE'` (spec §7 — ověřit skutečný rozsah).

### Task 3: klasifikátor + skript

**Files:**
- Create: `src/lib/reservationBackfill.ts`
- Create: `src/lib/reservationBackfill.test.ts`
- Create: `scripts/backfill-reservation-print-minutes.ts`

**Interfaces:**
- Consumes: `computePrintMinutes`, `expandPrintTime`, `SLOT_MS`, `CompanyDayInterval` (`src/lib/printTime.ts`); `loadMachineCalendarRange` (`src/lib/printTime.server.ts`); fixtury `xl106Week`, `W1`, `W2` (`src/lib/weekShiftsTestFixtures.ts`).
- Produces:
  ```typescript
  export type BackfillRowInput = {
    id: number; machine: string; startTime: Date; endTime: Date; printMinutes: number | null;
  };
  export type BackfillClassification =
    | { kind: "SKIP_HAS_PM" }
    | { kind: "SKIP_UNALIGNED" }
    | { kind: "SKIP_NO_MINUTES" }
    | { kind: "CONFORMS"; printMinutes: number }
    | { kind: "MISMATCH"; printMinutes: number; expandedEnd: Date | null };
  export function classifyReservationRow(
    row: BackfillRowInput,
    weekShifts: MachineWeekShiftsRow[],
    companyDays: CompanyDayInterval[],
  ): BackfillClassification;
  ```

- [ ] **Step 1: Failing testy klasifikátoru**

`src/lib/reservationBackfill.test.ts` (fixtura `xl106Week`: směny 6–22 + noc, Pá noc off, So celá off, Ne jen noc od 22:00):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { classifyReservationRow } from "./reservationBackfill";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";

const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const row = (over: Partial<Parameters<typeof classifyReservationRow>[0]>) => ({
  id: 1, machine: "XL_106", startTime: pragueToUTC("2026-08-21", 10),
  endTime: pragueToUTC("2026-08-21", 12), printMinutes: null, ...over,
});

test("backfill: printMinutes už vyplněné → SKIP_HAS_PM (idempotence)", () => {
  assert.deepEqual(classifyReservationRow(row({ printMinutes: 120 }), SHIFTS, []), { kind: "SKIP_HAS_PM" });
});

test("backfill: nezarovnaný start → SKIP_UNALIGNED (zůstává legacy-rigidní)", () => {
  const r = row({ startTime: new Date(pragueToUTC("2026-08-21", 10).getTime() + 10 * 60000) });
  assert.deepEqual(classifyReservationRow(r, SHIFTS, []), { kind: "SKIP_UNALIGNED" });
});

test("backfill: nezarovnaný end → SKIP_UNALIGNED (computePrintMinutes vyžaduje OBĚ hranice)", () => {
  const r = row({ endTime: new Date(pragueToUTC("2026-08-21", 12).getTime() + 10 * 60000) });
  assert.deepEqual(classifyReservationRow(r, SHIFTS, []), { kind: "SKIP_UNALIGNED" });
});

test("backfill: rezervace celá v pracovní době → CONFORMS s pm = elapsed", () => {
  assert.deepEqual(classifyReservationRow(row({}), SHIFTS, []), { kind: "CONFORMS", printMinutes: 120 });
});

test("backfill: rezervace přesahující do odstávky → MISMATCH (scheduleBypassed=true)", () => {
  // Pá 20:00 – So 02:00; páteční provoz končí 22:00 → pm = 120, expanze z Pá 20:00
  // skončí Pá 22:00 ≠ uložený end So 02:00.
  const r = row({ startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 2) });
  const c = classifyReservationRow(r, SHIFTS, []);
  assert.equal(c.kind, "MISMATCH");
  if (c.kind !== "MISMATCH") return;
  assert.equal(c.printMinutes, 120);
  assert.deepEqual(c.expandedEnd, pragueToUTC("2026-08-21", 22));
});

test("backfill: rezervace celá mimo provoz → SKIP_NO_MINUTES (inverze dá 0)", () => {
  const r = row({ startTime: pragueToUTC("2026-08-22", 10), endTime: pragueToUTC("2026-08-22", 12) });
  assert.deepEqual(classifyReservationRow(r, SHIFTS, []), { kind: "SKIP_NO_MINUTES" });
});
```

Run: `node --test --import tsx src/lib/reservationBackfill.test.ts`
Expected: FAIL — modul neexistuje.

- [ ] **Step 2: Implementace klasifikátoru**

`src/lib/reservationBackfill.ts`:

```typescript
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { computePrintMinutes, expandPrintTime, SLOT_MS, type CompanyDayInterval } from "@/lib/printTime";

export type BackfillRowInput = {
  id: number;
  machine: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
};

export type BackfillClassification =
  | { kind: "SKIP_HAS_PM" }        // už vyplněno — nedotýkat se (idempotence)
  | { kind: "SKIP_UNALIGNED" }     // start/end mimo 30min mřížku — zůstává legacy-rigidní (spec §3 krok 2)
  | { kind: "SKIP_NO_MINUTES" }    // inverze dala 0 minut (blok celý mimo provoz) — zůstává legacy-rigidní
  | { kind: "CONFORMS"; printMinutes: number }                              // → scheduleBypassed = false
  | { kind: "MISMATCH"; printMinutes: number; expandedEnd: Date | null };   // → scheduleBypassed = true

/**
 * Klasifikace jednoho REZERVACE bloku pro backfill tiskových hodin (etapa 9, fáze 1).
 *
 * Metoda dle specu §3: pm = computePrintMinutes(...) — INVERZE dnešní expanze,
 * ne prostý elapsed. CONFORMS = zpětná expanze reprodukuje PŘESNĚ uložený end,
 * blok po flipu okamžitě konformuje (žádná drift vlna hned po backfillu).
 * MISMATCH = neshoda je reálná (kalendář se od založení změnil / blok leží
 * částečně mimo provoz) → scheduleBypassed = true, analogicky effectivelyBypassed.
 *
 * Čistá funkce — kalendář dodává volající (skript přes loadMachineCalendarRange).
 */
export function classifyReservationRow(
  row: BackfillRowInput,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
): BackfillClassification {
  if (row.printMinutes != null) return { kind: "SKIP_HAS_PM" };
  if (row.startTime.getTime() % SLOT_MS !== 0 || row.endTime.getTime() % SLOT_MS !== 0) {
    return { kind: "SKIP_UNALIGNED" };
  }
  const pm = computePrintMinutes(row.machine, row.startTime, row.endTime, weekShifts, companyDays);
  if (pm <= 0) return { kind: "SKIP_NO_MINUTES" };
  const exp = expandPrintTime(row.machine, row.startTime, pm, weekShifts, companyDays, false);
  if (exp.ok && exp.end.getTime() === row.endTime.getTime()) {
    return { kind: "CONFORMS", printMinutes: pm };
  }
  return { kind: "MISMATCH", printMinutes: pm, expandedEnd: exp.ok ? exp.end : null };
}
```

Run: `node --test --import tsx src/lib/reservationBackfill.test.ts`
Expected: 6/6 PASS.

- [ ] **Step 3: Skript**

`scripts/backfill-reservation-print-minutes.ts` (vzor `scripts/prune-revisions.ts` — jednorázový, ručně spouštěný, NE cron):

```typescript
/**
 * Jednorázový backfill printMinutes/scheduleBypassed pro existující REZERVACE
 * bloky (etapa 9, fáze 1 — spec §3). DRY-RUN je VÝCHOZÍ; zapisuje se jen
 * s `--apply`.
 *
 * PROVOZNÍ PROTOKOL (rozhodnutí #8 + „Zálohu první"):
 *  1. `npx tsx scripts/backfill-reservation-print-minutes.ts` (dry-run),
 *  2. report zkontroluje Vojta osobně (počty CONFORMS/MISMATCH/SKIP_*),
 *  3. na produkci PŘED `--apply`: mysqldump záloha + ověřit
 *     `SELECT COUNT(*) FROM Block WHERE type='REZERVACE'` (spec §7),
 *  4. `npx tsx scripts/backfill-reservation-print-minutes.ts --apply`.
 *
 * BEZPEČNOST: zapisuje VÝHRADNĚ Block.printMinutes a Block.scheduleBypassed
 * u řádků type='REZERVACE'. startTime/endTime/machine se NIKDY nemění.
 * Idempotentní — řádky s vyplněným printMinutes se přeskakují (SKIP_HAS_PM).
 *
 * Vědomá výjimka z withRevision: skript běží mimo API vrstvu, stejná třída
 * jako DML v migracích (CLAUDE.md: „Co pomocník uzavřít NEUMÍ: ... DML uvnitř
 * migrací"). Revize backfillu nevznikají — proto povinný dry-run + záloha.
 */
import { prisma } from "../src/lib/prisma";
import { classifyReservationRow } from "../src/lib/reservationBackfill";
import { loadMachineCalendarRange } from "../src/lib/printTime.server";
import { MAX_SPAN_DAYS } from "../src/lib/printTime";

const APPLY = process.argv.includes("--apply");
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  const rows = await prisma.block.findMany({
    where: { type: "REZERVACE" },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, printMinutes: true },
    orderBy: { startTime: "asc" },
  });
  console.log(`REZERVACE bloků celkem: ${rows.length} · režim: ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const counts: Record<string, number> = {};
  const writes: Array<{ id: number; printMinutes: number; scheduleBypassed: boolean }> = [];

  for (const r of rows) {
    // Kalendář pokrývá [start − interní 1d kotva helperu, end + MAX_SPAN_DAYS]
    // — expanze z pm může přesáhnout uložený end.
    const cal = await loadMachineCalendarRange(
      prisma, r.machine, r.startTime, new Date(r.endTime.getTime() + MAX_SPAN_DAYS * DAY_MS),
    );
    const c = classifyReservationRow(r, cal.weekShifts, cal.companyDays);
    counts[c.kind] = (counts[c.kind] ?? 0) + 1;
    const label = `#${r.id} ${r.orderNumber} ${r.machine} ${r.startTime.toISOString()} – ${r.endTime.toISOString()}`;

    if (c.kind === "CONFORMS") {
      writes.push({ id: r.id, printMinutes: c.printMinutes, scheduleBypassed: false });
      console.log(`  CONFORMS        ${label} → printMinutes=${c.printMinutes}`);
    } else if (c.kind === "MISMATCH") {
      writes.push({ id: r.id, printMinutes: c.printMinutes, scheduleBypassed: true });
      console.log(`  MISMATCH        ${label} → printMinutes=${c.printMinutes}, scheduleBypassed=true (expanze: ${c.expandedEnd?.toISOString() ?? "selhala"})`);
    } else {
      console.log(`  ${c.kind.padEnd(15)} ${label} — přeskočeno, zůstává rigidní`);
    }
  }

  console.log("\nSouhrn:", counts);

  if (!APPLY) {
    console.log("\nDRY-RUN — nic se nezapsalo. Ostrý zápis: --apply (na produkci až po mysqldump záloze a Vojtově review reportu).");
    return;
  }
  for (const w of writes) {
    await prisma.block.update({
      where: { id: w.id },
      data: { printMinutes: w.printMinutes, scheduleBypassed: w.scheduleBypassed },
    });
  }
  console.log(`\nZapsáno ${writes.length} řádků.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 4: Dry-run na dev DB**

Run: `npx tsx scripts/backfill-reservation-print-minutes.ts`
Expected: report se souhrnem (na dev DB podle seed dat, klidně 0 řádků); ŽÁDNÝ zápis. Ověř idempotenci úmyslu: druhé spuštění dá stejný výstup.

- [ ] **Step 5: Build + suite + commit**

Run: `npm run build && node --test --import tsx src/lib/reservationBackfill.test.ts`
Expected: 0 chyb, 6/6 PASS.

```bash
git add src/lib/reservationBackfill.ts src/lib/reservationBackfill.test.ts scripts/backfill-reservation-print-minutes.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): backfill printMinutes pro REZERVACE s dry-run reportem

Klasifikator classifyReservationRow (cista funkce, testovana): inverze
computePrintMinutes nad soucasnym kalendarem; CONFORMS -> bypassed=false,
MISMATCH -> bypassed=true, nezarovnane/nulove/vyplnene radky se preskakuji
a zustavaji legacy-rigidni (spec par. 3). Skript je dry-run by default,
--apply az po Vojtove review a mysqldump zaloze (rozhodnuti #8).

printMinutes na REZERVACE je k tomuto HEAD inertni (vsichni konzumenti
ne-ZAKAZKA pm ignoruji) - flip chovani prijde az ve fazi 2.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

# FÁZE 2a — Jádro, server (Tasky 4–9)

**Co dělá:** překlopí serverovou geometrii — validace, POST/PUT/batch, chain push (se 7denním stropem pro REZERVACE), odstranění tichého sebeposunu v POST.

**Když se nasadí JEN 2a (bez 2b):** koherentní stav. Starý klient posílá u rezervací duration-based payloady: drag-move pošle `startTime`+`endTime` → PUT vezme pm ze záznamu (pravidlo 3) a end přepočítá autoritativně; queue-drop bez `printMinutes` → POST si pm odvodí z elapsed. Legacy rezervace (pm null) jedou přesně jako dnes. Jediný viditelný rozdíl proti dnešku: backfillnutá rezervace se při přesunu re-expanduje přes pauzy (to je CÍL etapy) a REZERVACE bez `resolveChain` už sama neuhne (rozhodnutí #9 — kolize vrátí 409).

**Akceptace fáze:** celá suite zelená; manuální scénáře v Tasku 9 Step 5. **Na produkci až po `CASCADE_CONFIRM_ENFORCED = true`** (Global Constraints).

### Task 4: `usesTiskoveHodiny` + `typeUsesTiskoveHodiny` (jediný zdroj pravdy)

**Files:**
- Modify: `src/lib/printTime.ts` (za `export const MIN_PRINT_SEGMENT_MINUTES`, dnes ř. 144)
- Modify: `src/lib/printTime.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export function usesTiskoveHodiny(b: { type: string; printMinutes?: number | null }): boolean;
  export function typeUsesTiskoveHodiny(type: string): boolean;
  ```
  Tyto dvě funkce konzumují VŠECHNY následující tasky (5–17). Umístění v `printTime.ts` (ne v `printTimeClient.ts`, jak nezávazně navrhoval spec §4.7): helper potřebují i čistě serverové moduly (`scheduleValidationServer.ts`, `overlapResolver.server.ts`, `calendarDrift.server.ts`, `reflow.server.ts`) a `printTime.ts` je jejich společný, izomorfní základ — obě strany tak čtou týž zdroj a nemohou se rozejít.

- [ ] **Step 1: Failing tabulkový test (P17 — celý obor hodnot, ne dichotomie)**

Do `src/lib/printTime.test.ts` přidej k importu z `./printTime` `usesTiskoveHodiny, typeUsesTiskoveHodiny` a na konec souboru:

```typescript
test("usesTiskoveHodiny — celý obor hodnot typu × printMinutes (P17)", () => {
  const cases: Array<{ type: string; pm: number | null | undefined; expected: boolean; why: string }> = [
    { type: "ZAKAZKA", pm: 120, expected: true, why: "zakázka s pm" },
    { type: "ZAKAZKA", pm: null, expected: true, why: "legacy zakázka — fallbacky volajících, beze změny proti stavu před etapou 9" },
    { type: "ZAKAZKA", pm: undefined, expected: true, why: "zakázka bez pole (klientské tvary)" },
    { type: "REZERVACE", pm: 120, expected: true, why: "backfillnutá/nová rezervace — CÍL etapy 9" },
    { type: "REZERVACE", pm: null, expected: false, why: "legacy rezervace — zůstává rigidní (spec §3 krok 2)" },
    { type: "REZERVACE", pm: undefined, expected: false, why: "rezervace bez pole" },
    { type: "REZERVACE", pm: 0, expected: false, why: "korupce dat → radši rigidní" },
    { type: "REZERVACE", pm: -30, expected: false, why: "korupce dat → radši rigidní" },
    { type: "UDRZBA", pm: 120, expected: false, why: "údržba NIKDY — rigidní beze změny" },
    { type: "UDRZBA", pm: null, expected: false, why: "údržba NIKDY" },
  ];
  for (const c of cases) {
    assert.equal(usesTiskoveHodiny({ type: c.type, printMinutes: c.pm }), c.expected, `${c.type}/pm=${c.pm}: ${c.why}`);
  }
});

test("typeUsesTiskoveHodiny — varianta pro nové payloady (bez záznamu)", () => {
  assert.equal(typeUsesTiskoveHodiny("ZAKAZKA"), true);
  assert.equal(typeUsesTiskoveHodiny("REZERVACE"), true);
  assert.equal(typeUsesTiskoveHodiny("UDRZBA"), false);
});
```

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: FAIL — `usesTiskoveHodiny` neexportováno.

- [ ] **Step 2: Implementace**

```typescript
/**
 * Používá blok model tiskových hodin (printMinutes + expanze přes pauzy směn)?
 * JEDINÝ zdroj pravdy pro server (validace, chain push geometrie, drift, reflow)
 * i klienta (snapy, payloady, kreslení) — etapa 9, „Rezervace dostanou plné
 * tiskové hodiny".
 *
 * - ZAKAZKA: vždy. pm = null (legacy) řeší fallbacky volajících — beze změny
 *   proti stavu před etapou 9.
 * - REZERVACE: jen s platnými printMinutes. Legacy rezervace, kterou backfill
 *   přeskočil (nezarovnaný start/end), zůstává RIGIDNÍ — „funguje jako dnes,
 *   dokud se ručně neopraví" (spec §3 krok 2).
 * - UDRZBA: nikdy — zůstává rigidní beze změny (rozhodnutí Vojty 19. 8. 2026).
 *
 * Poučení P17: volající NESMÍ tuhle trojcestnou klasifikaci opisovat inline
 * dichotomií `type === "ZAKAZKA"` — projet celý obor hodnot umí jen jedno místo.
 */
export function usesTiskoveHodiny(b: { type: string; printMinutes?: number | null }): boolean {
  if (b.type === "ZAKAZKA") return true;
  if (b.type === "REZERVACE") return b.printMinutes != null && Number.isFinite(b.printMinutes) && b.printMinutes > 0;
  return false;
}

/**
 * Varianta pro NOVÉ payloady (builder, fronta, série), kde žádný uložený záznam
 * neexistuje: nový blok tiskového typu dostává printMinutes VŽDY, rozhoduje jen
 * typ. Pro EXISTUJÍCÍ bloky vždy `usesTiskoveHodiny` — legacy rezervace bez
 * printMinutes musí zůstat rigidní.
 */
export function typeUsesTiskoveHodiny(type: string): boolean {
  return type === "ZAKAZKA" || type === "REZERVACE";
}
```

- [ ] **Step 3: Testy PASS + commit**

Run: `node --test --import tsx src/lib/printTime.test.ts`
Expected: PASS (2 nové testy + všechny stávající).

```bash
git add src/lib/printTime.ts src/lib/printTime.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): usesTiskoveHodiny - jediny zdroj pravdy tri typu geometrie

ZAKAZKA vzdy, REZERVACE jen s printMinutes (legacy bez nich zustava
rigidni dle spec par. 3), UDRZBA nikdy. typeUsesTiskoveHodiny je varianta
pro nove payloady bez zaznamu. Tabulkovy test projizdi cely obor hodnot
(pouceni P17), zadny konzument zatim helper nevola - flip prijde v
nasledujicich taskach.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `validateAndComputeEnd` — REZERVACE do tiskové validace

**Files:**
- Modify: `src/lib/scheduleValidationServer.ts:100` + docblock ř. 70–90
- Modify: `src/lib/scheduleValidationServer.test.ts`

**Interfaces:**
- Consumes: `usesTiskoveHodiny` z Tasku 4.
- Produces: `validateAndComputeEnd` beze změny signatury; nová sémantika: REZERVACE s pm jde tiskovou větví (vč. bypass větve — rozhodnutí #2), REZERVACE s pm=null a UDRZBA vrací `{ ok: true, end: fallbackEnd, effectivelyBypassed: false }` jako dnes.

- [ ] **Step 1: Failing testy**

Do `src/lib/scheduleValidationServer.test.ts` na konec (fixtura `FULL_CAL` a `pragueToUTC` už v souboru jsou):

```typescript
test("REZERVACE s printMinutes: validní start → expanze přes pauzy jako u zakázky (etapa 9)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), 27 * 60,
    new Date(0), "REZERVACE", false);
  assert.deepEqual(r, { ok: true, end: pragueToUTC("2026-08-24", 13), effectivelyBypassed: false });
});

test("REZERVACE s printMinutes: start v odstávce → PLACEMENT chyba (dřív prošla bez validace)", async () => {
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-22", 12), 4 * 60,
    new Date(0), "REZERVACE", false);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.kind, "PLACEMENT");
});

test("REZERVACE s bypass: end = start + pm slitě, effectivelyBypassed = spočítaná pravda (rozhodnutí #2)", async () => {
  // Pá 20:00 + 4 h slitě = So 00:00 — přes noční pauzu, takže nekonformní → bypassed true.
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 20), 4 * 60,
    new Date(0), "REZERVACE", true);
  assert.deepEqual(r, { ok: true, end: pragueToUTC("2026-08-22", 0), effectivelyBypassed: true });
});

test("REZERVACE bez printMinutes (legacy): žádná validace, end = fallback (rigidní jako dnes)", async () => {
  const fallback = pragueToUTC("2026-08-21", 11, 45);
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-21", 10), null,
    fallback, "REZERVACE", false);
  assert.deepEqual(r, { ok: true, end: fallback, effectivelyBypassed: false });
});

test("UDRZBA: žádná validace, end = fallback — beze změny etapou 9", async () => {
  const fallback = pragueToUTC("2026-08-22", 14);
  const r = await validateAndComputeEnd(FULL_CAL, "XL_106", pragueToUTC("2026-08-22", 12), 120,
    fallback, "UDRZBA", false);
  assert.deepEqual(r, { ok: true, end: fallback, effectivelyBypassed: false });
});
```

Run: `node --test --import tsx src/lib/scheduleValidationServer.test.ts`
Expected: FAIL — první tři nové testy (REZERVACE dnes early-returnuje fallback).

- [ ] **Step 2: Implementace**

Do importů přidej `usesTiskoveHodiny` (z `@/lib/printTime` — už se odtud importuje `expandPrintTime` aj.). Nahraď ř. 100:

```typescript
  if (blockType !== "ZAKAZKA") return { ok: true, end: fallbackEnd, effectivelyBypassed: false };
```

za:

```typescript
  // UDRZBA je rigidní vždy; REZERVACE bez printMinutes je legacy-rigidní (backfill
  // ji přeskočil, spec etapy 9 §3) — obě jdou dosavadní ne-tiskovou cestou.
  // REZERVACE s printMinutes od etapy 9 prochází PLNOU tiskovou validací včetně
  // bypass větve (rozhodnutí #2: scheduleBypassed pro rezervace ANO).
  if (!usesTiskoveHodiny({ type: blockType, printMinutes })) {
    return { ok: true, end: fallbackEnd, effectivelyBypassed: false };
  }
```

V docblocku (ř. 70–90) nahraď řádky:

```
 * ZAKAZKA bez bypass: start musí ležet na aktivním slotu, end se POČÍTÁ
 * (expandPrintTime přes weekShifts + companyDays — odstávky se překlenou pauzou).
 * ZAKAZKA s bypass: end = start + printMinutes (bez pauz); CompanyDay zůstává
 * tvrdý zákaz (mimořádná směna nesmí kolidovat s celofiremní odstávkou).
 * Ne-ZAKAZKA: bez validace, end = fallbackEnd (dnešní chování).
```

za:

```
 * ZAKAZKA/REZERVACE (s printMinutes) bez bypass: start musí ležet na aktivním
 * slotu, end se POČÍTÁ (expandPrintTime přes weekShifts + companyDays — odstávky
 * se překlenou pauzou). S bypass: end = start + printMinutes (bez pauz);
 * CompanyDay zůstává tvrdý zákaz. Kdo tiskové hodiny používá, říká
 * `usesTiskoveHodiny` (printTime.ts) — REZERVACE s printMinutes = null je
 * legacy-rigidní a spolu s UDRZBA jde bez validace, end = fallbackEnd.
```

- [ ] **Step 3: Testy PASS + commit**

Run: `node --test --import tsx src/lib/scheduleValidationServer.test.ts`
Expected: vše PASS (5 nových + stávající).

```bash
git add src/lib/scheduleValidationServer.ts src/lib/scheduleValidationServer.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): validateAndComputeEnd validuje REZERVACE s printMinutes

Early-return prepnut z dichotomie type !== ZAKAZKA na !usesTiskoveHodiny:
rezervace s pm prochazi plnou tiskovou validaci vcetne bypass vetve
(rozhodnuti #2), legacy rezervace bez pm a UDRZBA zustavaji bez validace
s fallback endem. Zbytek funkce je typove agnosticky (spec 4.1).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Chain push — tisková geometrie REZERVACE se 7denním stropem

**Files:**
- Modify: `src/lib/overlapResolver.ts` (`BlockInterval`, `computeChainPushAttempt`, `placeAfter`)
- Modify: `src/lib/overlapResolver.server.ts` (`chainPushGeometry`, `nonConforming` smyčka)
- Modify: `src/lib/overlapResolver.test.ts`
- Modify: `src/lib/overlapResolver.server.test.ts`

**Interfaces:**
- Consumes: `usesTiskoveHodiny` (Task 4), `MAX_RIGID_PUSH_MS` (existující, `overlapResolver.ts:39`).
- Produces: `BlockInterval` získává volitelné pole `maxPushMs?: number`; `chainPushGeometry` vrací navíc `maxPushMs?: number` (u tiskové REZERVACE = `MAX_RIGID_PUSH_MS`); `placeAfter` dostává 9. parametr `maxPushMs?: number`. Sémantika stropu: měří se od `fromMs` (kurzor pushe) na SNAPNUTÝ START — tisková rezervace smí expanzí skončit i za horizontem, ale nesmí za něj být teleportován její začátek. Neumístitelnost v horizontu = degradace na zeď (`RIGID_UNPLACEABLE` retry smyčka — stejné chování, jaké má dnes rigidní rezervace).

- [ ] **Step 1: Failing testy — čisté jádro (`overlapResolver.test.ts`)**

Na konec souboru přidej (helpery `H`, `blk`, `NO_CD`, `SHIFTS`, `P`, `describe/it` už v souboru jsou):

```typescript
describe("computeChainPush — tisková REZERVACE (etapa 9)", () => {
  const tiskovaRez = (id: number, start: number, end: number): BlockInterval => ({
    ...blk(id, start, end),
    maxPushMs: 7 * 24 * 60 * 60 * 1000,
  });

  it("tisková rezervace se odsune a re-expanduje jako zakázka (souvislý provoz)", () => {
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [tiskovaRez(2, 11, 13)], [], NO_CD);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      assert.deepEqual(r.moves[0], { id: 2, startTime: H(12), endTime: H(14) });
    }
  });

  it("tisková rezervace expanduje přes víkendovou odstávku — délka v tiskových minutách se zachová", () => {
    // Anchor končí Pá 20:00, rezervace pm 240 začínala Pá 19:00 → nový start Pá 20:00,
    // pátek běží do 22:00 (2 h tisku), zbylé 2 h až od Ne 22:00 → end Ne/Po 00:00... 
    // přesně: segmenty Pá 20–22 + Ne 22–24 → end Po 00:00 Prahy.
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 18), endTime: P("2026-08-21", 20) },
      [{ ...blk(2, 0, 0), startTime: P("2026-08-21", 19), endTime: P("2026-08-21", 23), printMinutes: 240, maxPushMs: 7 * 24 * 60 * 60 * 1000 }],
      SHIFTS, NO_CD,
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      assert.deepEqual(r.moves[0]!.startTime, P("2026-08-21", 20));
      assert.deepEqual(r.moves[0]!.endTime, P("2026-08-24", 0), "2 h Pá večer + 2 h od Ne 22:00");
    }
  });

  it("tisková rezervace za horizontem 7 dní se degraduje na zeď — anchor přes ni vrátí LOCKED_CONFLICT/unplaceable (rozhodnutí #1)", () => {
    // Odstávka 10 dní hned za anchorem: start rezervace nelze umístit do 7 dnů od kurzoru.
    const cd = [{ start: H(12), end: new Date(H(12).getTime() + 10 * 24 * 3600000) }];
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [tiskovaRez(2, 11, 13)], [], cd);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.reason, "LOCKED_CONFLICT");
    if (r.reason !== "LOCKED_CONFLICT") return;
    assert.equal(r.lockedId, 2);
    assert.equal(r.unplaceable, true);
  });

  it("KONTRAST: zakázka (bez maxPushMs) se ve stejném scénáři posune ZA odstávku — dluh P31 zůstává jen u ní", () => {
    const cd = [{ start: H(12), end: new Date(H(12).getTime() + 10 * 24 * 3600000) }];
    const r = computeChainPush("XL_105", { id: 1, startTime: H(10), endTime: H(12) }, [blk(2, 11, 13)], [], cd);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      assert.ok(r.moves[0]!.startTime.getTime() >= cd[0]!.end.getTime(), "zakázka teleportuje za odstávku (P31, vědomě neměněno)");
    }
  });
});
```

Run: `node --test --import tsx src/lib/overlapResolver.test.ts`
Expected: FAIL — `maxPushMs` se ignoruje (3. test projde jako `ok: true` za odstávkou).

- [ ] **Step 2: Implementace jádra (`overlapResolver.ts`)**

Do `BlockInterval` přidej za `rigid?: boolean;`:

```typescript
  /**
   * Strop dopředného posunu (ms) pro TISKOVOU geometrii — REZERVACE si i po
   * překlopení na tiskové hodiny drží 7denní horizont (rozhodnutí #1 specu
   * etapy 9, 20. 8. 2026): bezhorizontový chain push je otevřený dluh P31
   * a nekopíruje se na druhý typ. Měří se od kurzoru pushe (`fromMs`) na
   * snapnutý START — expanze smí končit i za horizontem. Neumístitelný blok
   * se degraduje na zeď (RIGID_UNPLACEABLE), stejně jako rigidní blok.
   * undefined = bez stropu (ZAKAZKA). U `rigid: true` se ignoruje —
   * placeRigidAfter má vlastní MAX_RIGID_PUSH_MS.
   */
  maxPushMs?: number;
```

V `computeChainPushAttempt` nahraď blok umístění:

```typescript
    const pos = next.rigid
      ? placeRigidAfter(machine, pEnd, pm, locked, weekShifts, companyDays)
      : placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, MIN_PRINT_SEGMENT_MINUTES) ??
        placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, 0);
    if (!pos) {
      // Rigidní blok se v horizontu nikam nevejde → volající ho zafixuje jako zeď
      // a spustí průchod znovu. Zakázka horizont nemá, u ní je to skutečné selhání.
      if (next.rigid) return { ok: false, reason: "RIGID_UNPLACEABLE", blockId: next.id };
      return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };
    }
```

za:

```typescript
    const pos = next.rigid
      ? placeRigidAfter(machine, pEnd, pm, locked, weekShifts, companyDays)
      : placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, MIN_PRINT_SEGMENT_MINUTES, next.maxPushMs) ??
        placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, 0, next.maxPushMs);
    if (!pos) {
      // Rigidní blok NEBO tisková rezervace se stropem (maxPushMs), která se
      // v horizontu nikam nevejde → volající ji zafixuje jako zeď a spustí průchod
      // znovu. Zakázka horizont nemá, u ní je to skutečné selhání (dluh P31,
      // vědomě neřešeno v této vlně).
      if (next.rigid || next.maxPushMs != null) return { ok: false, reason: "RIGID_UNPLACEABLE", blockId: next.id };
      return { ok: false, reason: "PLACEMENT_FAILED", blockId: next.id };
    }
```

V `placeAfter` rozšiř signaturu a doplň horizont:

```typescript
function placeAfter(
  machine: string,
  fromMs: number,
  printMinutes: number,
  bypassed: boolean,
  locked: BlockInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  minSegmentMinutes: number,
  maxPushMs?: number
): { start: Date; end: Date } | null {
  // Horizont startu (rozhodnutí #1): tisková REZERVACE nesmí být teleportována
  // dál než maxPushMs od kurzoru. Kontroluje se START (kurzor i snap), ne end —
  // expanze přes pauzy smí přesáhnout.
  const horizonMs = maxPushMs != null ? fromMs + maxPushMs : Infinity;
  let cursorMs = Math.ceil(fromMs / SLOT_MS) * SLOT_MS;

  for (let g = 0; g < 100; g++) {
    if (cursorMs > horizonMs) return null;
    if (bypassed) {
```

…a ve větvi bez bypass hned za snap doplň kontrolu:

```typescript
    const snapped = snapStartToNextRunnableSlot(machine, new Date(cursorMs), weekShifts, companyDays);
    if (!snapped) return null;
    if (snapped.getTime() > horizonMs) return null;
```

(Zbytek `placeAfter` beze změny; `return null;` na konci smyčky zůstává.)

- [ ] **Step 3: Testy jádra PASS**

Run: `node --test --import tsx src/lib/overlapResolver.test.ts`
Expected: vše PASS (4 nové + všechny stávající — zejména stávající rigidní scénáře beze změny).

- [ ] **Step 4: Failing testy serveru (`overlapResolver.server.test.ts`)**

Na konec souboru (helpery `row`, `mkTx`, `H` v souboru jsou; `chainPushGeometry` je už importované):

```typescript
describe("chainPushGeometry — etapa 9 (REZERVACE s pm = tisková, legacy = rigidní)", () => {
  it("UDRZBA → rigidní vždy", () => {
    const g = chainPushGeometry({ type: "UDRZBA", startTime: H(10), endTime: H(12), printMinutes: 120, scheduleBypassed: false });
    assert.deepEqual(g, { printMinutes: 120, scheduleBypassed: false, rigid: true });
  });
  it("REZERVACE bez printMinutes → rigidní (legacy, spec §3)", () => {
    const g = chainPushGeometry({ type: "REZERVACE", startTime: H(10), endTime: H(12), printMinutes: null, scheduleBypassed: false });
    assert.deepEqual(g, { printMinutes: 120, scheduleBypassed: false, rigid: true });
  });
  it("REZERVACE s printMinutes → tisková geometrie se 7denním stropem (rozhodnutí #1)", () => {
    const g = chainPushGeometry({ type: "REZERVACE", startTime: H(10), endTime: H(12), printMinutes: 90, scheduleBypassed: true });
    assert.deepEqual(g, { printMinutes: 90, scheduleBypassed: true, rigid: false, maxPushMs: 7 * 24 * 60 * 60 * 1000 });
  });
  it("ZAKAZKA → tisková BEZ stropu (maxPushMs undefined — dluh P31 se nešíří, ale ani neřeší)", () => {
    const g = chainPushGeometry({ type: "ZAKAZKA", startTime: H(10), endTime: H(12), printMinutes: 120, scheduleBypassed: false });
    assert.equal(g.rigid, false);
    assert.equal(g.maxPushMs, undefined);
  });
});

describe("resolveChainPushFromDb — tisková REZERVACE (etapa 9)", () => {
  it("rezervace s pm v cestě anchoru se posune s re-expanzí (fallback 24/7: end = start + pm)", async () => {
    const { tx, updateMock } = mkTx([row(2, 11, 13, { type: "REZERVACE", printMinutes: 120 })]);
    const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(12) });
    assert.equal(moves.length, 1);
    assert.equal(updateMock.mock.callCount(), 1);
    const call = updateMock.mock.calls[0]!.arguments[0] as { where: { id: number }; data: { startTime: Date; endTime: Date } };
    assert.deepEqual(call.data, { startTime: H(12), endTime: H(14) });
  });
});
```

Run: `node --test --import tsx src/lib/overlapResolver.server.test.ts`
Expected: FAIL — `chainPushGeometry` dnes vrací pro REZERVACE `rigid: true`.

- [ ] **Step 5: Implementace serveru (`overlapResolver.server.ts`)**

Do importů přidej `MAX_RIGID_PUSH_MS` (rozšíření stávajícího importu z `@/lib/overlapResolver`) a `usesTiskoveHodiny` (rozšíření importu z `@/lib/printTime`). Nahraď `chainPushGeometry` (ř. 51–65):

```typescript
export function chainPushGeometry(r: GeometryRow): {
  printMinutes: number;
  scheduleBypassed: boolean;
  rigid: boolean;
  /** Strop posunu tiskové REZERVACE — viz BlockInterval.maxPushMs (rozhodnutí #1). */
  maxPushMs?: number;
} {
  const spanMinutes = (r.endTime.getTime() - r.startTime.getTime()) / 60000;
  // Rigidní zůstává UDRZBA vždy a legacy REZERVACE bez printMinutes (backfill ji
  // přeskočil — „funguje jako dnes, dokud se ručně neopraví", spec etapy 9 §3).
  if (!usesTiskoveHodiny(r)) {
    if (r.type !== "ZAKAZKA") {
      return { printMinutes: spanMinutes, scheduleBypassed: false, rigid: true };
    }
    // ZAKAZKA s pm = null: legacy fallback zarovnaný na 30min mřížku (beze změny).
    return {
      printMinutes: Math.max(30, Math.round(spanMinutes / 30) * 30),
      scheduleBypassed: r.scheduleBypassed,
      rigid: false,
    };
  }
  if (r.type === "REZERVACE") {
    // Tisková geometrie SE STROPEM — dluh P31 (bezhorizontový push zakázek)
    // se nekopíruje na druhý typ (rozhodnutí #1 specu, 20. 8. 2026).
    return {
      printMinutes: r.printMinutes as number,
      scheduleBypassed: r.scheduleBypassed,
      rigid: false,
      maxPushMs: MAX_RIGID_PUSH_MS,
    };
  }
  return {
    printMinutes: r.printMinutes as number,
    scheduleBypassed: r.scheduleBypassed,
    rigid: false,
  };
}
```

(Pozn.: `usesTiskoveHodiny` vrací `true` pro ZAKAZKA s pm = null, takže větev `!usesTiskoveHodiny && type === "ZAKAZKA"` je nedosažitelná — přesto tam legacy fallback MUSÍ zůstat čitelně; přepiš raději takto, ať je dispatch doslovný a bez mrtvé větve:)

```typescript
  const spanMinutes = (r.endTime.getTime() - r.startTime.getTime()) / 60000;
  if (r.type === "UDRZBA" || (r.type === "REZERVACE" && !usesTiskoveHodiny(r))) {
    // UDRZBA vždy; legacy REZERVACE bez printMinutes („funguje jako dnes", spec §3).
    return { printMinutes: spanMinutes, scheduleBypassed: false, rigid: true };
  }
  if (r.type === "REZERVACE") {
    // Tisková geometrie SE STROPEM — dluh P31 se nekopíruje (rozhodnutí #1).
    return {
      printMinutes: r.printMinutes as number,
      scheduleBypassed: r.scheduleBypassed,
      rigid: false,
      maxPushMs: MAX_RIGID_PUSH_MS,
    };
  }
  return {
    printMinutes: r.printMinutes ?? Math.max(30, Math.round(spanMinutes / 30) * 30),
    scheduleBypassed: r.scheduleBypassed,
    rigid: false,
  };
```

Dál v témže souboru uprav `nonConforming` smyčku (ř. 176–181): nahraď

```typescript
  for (const r of rows) {
    if (r.type === "ZAKAZKA") continue;
```

za

```typescript
  for (const r of rows) {
    // Kandidát na „zeď mimo kalendář" je jen blok s RIGIDNÍ geometrií (údržba,
    // legacy rezervace). Tisková rezervace se — stejně jako zakázka — zdí nestává:
    // posouvá se re-expanzí a nekonformitu řeší scheduleBypassed/drift (etapa 9).
    if (!chainPushGeometry(r).rigid) continue;
```

a docblock funkce `chainPushGeometry` (ř. 41–50) uprav: v odrážce `- REZERVACE / UDRZBA: rigidní interval…` nahraď text za:

```
 * - UDRZBA (a legacy REZERVACE s printMinutes = null): rigidní interval — PŘESNÁ
 *   délka bez zaokrouhlení, bez roztažení přes pauzy; celý se musí vejít do
 *   pracovní doby.
 * - REZERVACE s printMinutes: tiskové hodiny jako ZAKAZKA, ale se 7denním stropem
 *   posunu (`maxPushMs = MAX_RIGID_PUSH_MS`, rozhodnutí #1 etapy 9).
```

- [ ] **Step 6: Testy PASS + celé oba soubory**

Run: `node --test --import tsx src/lib/overlapResolver.test.ts src/lib/overlapResolver.server.test.ts`
Expected: vše PASS — nové testy i všechny stávající (nezávislá pojistka v `resolveChainPushFromDb` používá `chainPushGeometry`, takže se přepne konzistentně sama — tisková rezervace se ověřuje větví `expandPrintTime`, ne rigidní).

- [ ] **Step 7: Commit**

```bash
git add src/lib/overlapResolver.ts src/lib/overlapResolver.server.ts src/lib/overlapResolver.test.ts src/lib/overlapResolver.server.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): chain push preklopi REZERVACE s pm na tiskovou geometrii

chainPushGeometry: REZERVACE s printMinutes jde ZAKAZKA vetvi (re-expanze
pres pauzy) se 7dennim stropem maxPushMs = MAX_RIGID_PUSH_MS (rozhodnuti
#1 - dluh P31 se nekopiruje na druhy typ; neumistitelna rezervace se
degraduje na zed jako dnes). Legacy rezervace bez pm a UDRZBA zustavaji
rigidni. nonConforming "zed mimo kalendar" nove rozhoduje geometrie, ne
typ - tiskova rezervace zdi neni. Nezavisla pojistka se prepina sama
(sdili chainPushGeometry). MIN_PRINT_SEGMENT zacina platit i pro tiskove
rezervace (spec 4.6, pojmenovany novy jev).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `POST /api/blocks` — derivace pm, zápis, odstranění sebeposunu

**Files:**
- Modify: `src/app/api/blocks/route.ts`

**Interfaces:**
- Consumes: `typeUsesTiskoveHodiny` (Task 4), `validateAndComputeEnd` (Task 5 — už REZERVACE validuje).
- Produces: REZERVACE payload s/bez `printMinutes` → vždy uložené skutečné pm (derivace z elapsed jako fallback); tichý self-shift REZERVACE bez `resolveChain` ODSTRANĚN (rozhodnutí #9).

- [ ] **Step 1: Derivace `rawPrintMinutes` (ř. 97–102)**

Do importů přidej `typeUsesTiskoveHodiny` z `@/lib/printTime`. Nahraď:

```typescript
    const rawPrintMinutes: number | null =
      typeof body.printMinutes === "number"
        ? body.printMinutes
        : blockType === "ZAKAZKA"
          ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
          : null;
```

za:

```typescript
    // ZAKAZKA i REZERVACE (etapa 9): explicitně od klienta, jinak odvozeno z end−start.
    // Ne-30násobkový elapsed u REZERVACE spadne ve validaci na INVALID_INPUT 422 —
    // nový blok tiskového typu grid dodržet MUSÍ (klient posílá pm explicitně).
    const rawPrintMinutes: number | null =
      typeof body.printMinutes === "number"
        ? body.printMinutes
        : typeUsesTiskoveHodiny(blockType)
          ? Math.round((endTime.getTime() - startTime.getTime()) / 60000)
          : null;
```

- [ ] **Step 2: Odstranění self-shift větve (rozhodnutí #9, ř. 229–252)**

Smaž CELÝ blok:

```typescript
      // REZERVACE: auto-posun SEBE na nejbližší volný slot — nezávisle na resolveChain/
      // ... (celý komentář)
      if (finalType === "REZERVACE" && !bypassOverlapCheck && !resolveChain) {
        const conflict = await tx.block.findFirst({ ... });
        if (conflict) {
          const slot = await findNextFreeSlotFromDb(tx, body.machine, startTime, durationMs);
          ...
        }
      }
```

a nahraď ho jednořádkovým komentářem:

```typescript
      // REZERVACE self-shift větev ODSTRANĚNA (rozhodnutí #9 etapy 9): rezervace bez
      // resolveChain jde stejnou cestou jako zakázka — kolizi vrátí 409 z checkBlockOverlap
      // výše, žádný tichý sebeposun.
```

- [ ] **Step 3: Race-recovery slot finder (ř. 196–199)**

Nahraď:

```typescript
          const slot =
            blockType === "ZAKAZKA" && rawPrintMinutes != null
              ? await findNextFreePrintSlotFromDb(tx, body.machine, startTime, rawPrintMinutes)
              : await findNextFreeSlotFromDb(tx, body.machine, startTime, durationMs);
```

za:

```typescript
          const slot =
            typeUsesTiskoveHodiny(blockType) && rawPrintMinutes != null
              ? await findNextFreePrintSlotFromDb(tx, body.machine, startTime, rawPrintMinutes)
              : await findNextFreeSlotFromDb(tx, body.machine, startTime, durationMs);
```

- [ ] **Step 4: Zápis do `tx.block.create` (ř. 286–287)**

Nahraď:

```typescript
          printMinutes: finalType === "ZAKAZKA" ? rawPrintMinutes : null,
          scheduleBypassed: finalType === "ZAKAZKA" ? effectiveBypassed : false,
```

za:

```typescript
          printMinutes: typeUsesTiskoveHodiny(finalType) ? rawPrintMinutes : null,
          scheduleBypassed: typeUsesTiskoveHodiny(finalType) ? effectiveBypassed : false,
```

- [ ] **Step 5: Build + suite + commit**

Run: `npm run build && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: build 0 chyb; suite zelená (routa nemá unit testy, hlídá ji `revisionWiring` + `reservationSyncWiring`).

```bash
git add src/app/api/blocks/route.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): POST uklada printMinutes rezervaci a rusi tichy sebeposun

rawPrintMinutes derivace, race-recovery slot finder i zapis create
rozsireny z dichotomie ZAKAZKA na typeUsesTiskoveHodiny (spec 4.2).
Self-shift vetev REZERVACE bez resolveChain ODSTRANENA (rozhodnuti #9):
kolize nove vraci 409 z checkBlockOverlap, konzistentne se zakazkou -
zadny tichy sebeposun, o ktery uzivatel nepozadal.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `PUT /api/blocks/[id]` — tisková větev pro REZERVACE

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts` (ř. 210–267)

**Interfaces:**
- Consumes: `validateAndComputeEnd` (Task 5).
- Produces: REZERVACE s dostupnými pm (request nebo záznam) jde tiskovou větví; legacy REZERVACE a UDRZBA jdou rigidní větví jako dnes; přechod ZAKAZKA↔REZERVACE NEČISTÍ printMinutes (spec 4.3).

- [ ] **Step 1: Přepiš recompute větev**

Najdi v těle PUT `withRevision` blok začínající `if (checkType !== "ZAKAZKA") {` (ř. 210) a KONČÍCÍ přiřazením `computedBypassed = sched.effectivelyBypassed;` + zavírací `}` else větve (ř. 267). Nahraď ho:

```typescript
        // Tisková geometrie (etapa 9): ZAKAZKA vždy; REZERVACE jen když má odkud vzít
        // printMinutes — explicitně v requestu, nebo na záznamu (typicky po backfillu).
        // Legacy rezervace bez printMinutes zůstává rigidní („funguje jako dnes, dokud
        // se ručně neopraví", spec §3); UDRZBA rigidní vždy. Přechod ZAKAZKA↔REZERVACE
        // tudy neprojde clear větví — printMinutes se zachovají (spec 4.3).
        const printGeometry =
          checkType === "ZAKAZKA" ||
          (checkType === "REZERVACE" &&
            (typeof allowedPrintMinutes === "number" || oldBlock.printMinutes != null));

        if (!printGeometry) {
          // Rigidní větev (UDRZBA, legacy REZERVACE): printMinutes vyčistit, end = požadovaný.
          // Pojistka: rigidní větev neprochází validateAndComputeEnd, takže je to
          // jediné místo, kde lze zachytit end <= start. Takový blok by se navíc vyhnul
          // VŠEM kontrolám překryvu (interval s obráceným pořadím se s ničím neprotne).
          // Vzniká reálně: chain push posune blok pod otevřeným editorem a BlockEdit
          // pak počítá end ze zastaralého startu.
          if (requestedEnd.getTime() <= checkStart.getTime()) {
            throw new AppError("VALIDATION_ERROR", "Konec bloku musí být po jeho začátku. Zavři a znovu otevři detail bloku — mezitím se posunul.");
          }
          computedEnd = requestedEnd;
          computedPrintMinutes = null;
          computedBypassed = false;
        } else {
          // Detekce move vs. resize — dnešní drag-move klient posílá VŽDY start i end
          // (end = newStart + starý span). Nelze tedy rozeznat move od resize podle
          // "endTime se změnilo" — to je pravda i u move. Rozhoduje start/machine:
          const startOrMachineChanged =
            (allowed.startTime !== undefined && checkStart.getTime() !== oldBlock.startTime.getTime())
            || (allowed.machine !== undefined && checkMachine !== oldBlock.machine);
          const isResize = !startOrMachineChanged
            && allowed.endTime !== undefined
            && requestedEnd.getTime() !== oldBlock.endTime.getTime();
          // Bypass INPUT do validace: request flag rozhoduje JEN při skutečné změně pozice/délky
          // (move/resize). Pouhá přítomnost endTime v payloadu (BlockEdit posílá end vždy)
          // nesmí bypass blok tiše re-expandovat — jinak se flag ztratí uložením popisu.
          const bypass = (startOrMachineChanged || isResize) ? bypassScheduleValidation : oldBlock.scheduleBypassed;

          let pm: number | null;
          if (typeof allowedPrintMinutes === "number") {
            pm = allowedPrintMinutes;                            // 1) explicitní (z role-filtrovaného allowed)
          } else if (isResize) {
            // 2) resize — inverze z nového endu (start/machine beze změny)
            if (bypass) {
              pm = Math.round((requestedEnd.getTime() - checkStart.getTime()) / 60000);
            } else {
              const cal = await loadMachineCalendar(tx, checkMachine, checkStart);
              pm = computePrintMinutes(checkMachine, checkStart, requestedEnd, cal.weekShifts, cal.companyDays);
            }
          } else if (oldBlock.printMinutes != null && (oldBlock.type === "ZAKAZKA" || oldBlock.type === "REZERVACE")) {
            // 3) move (start/machine změna) nebo end beze změny — printMinutes ze záznamu.
            // Klientův poslaný endTime se zde záměrně ignoruje. Od etapy 9 i pro REZERVACE
            // (a pro přechody ZAKAZKA↔REZERVACE oběma směry).
            pm = oldBlock.printMinutes;
          } else {
            // fallback (legacy blok bez printMinutes / změna typu na ZAKAZKA): odvodit ze spanu
            pm = Math.round((oldBlock.endTime.getTime() - oldBlock.startTime.getTime()) / 60000);
          }

          const sched = await validateAndComputeEnd(tx, checkMachine, checkStart, pm, requestedEnd, checkType, bypass);
          if (!sched.ok) {
            throw new AppError("SCHEDULE_VIOLATION", sched.error);
          }
          computedEnd = sched.end;
          computedPrintMinutes = pm;
          // Uložit SPOČÍTANOU pravdu, ne echo bypass flagu — bypass request na místě,
          // které kalendáři sedí, blok trvale neoznačí (effectivelyBypassed = false).
          computedBypassed = sched.effectivelyBypassed;
        }
```

Klíčové rozdíly proti dnešku (jen 4, zbytek je doslovný opis): (a) podmínka větvení `printGeometry` místo `checkType !== "ZAKAZKA"`, (b) pravidlo 3 rozšířeno o `oldBlock.type === "REZERVACE"`, (c) `validateAndComputeEnd(..., checkType, ...)` místo literálu `"ZAKAZKA"`, (d) komentáře.

- [ ] **Step 2: Build + suite**

Run: `npm run build && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: 0 chyb, suite zelená.

- [ ] **Step 3: Ruční ověření na dev (server-only stav)**

1. Přesuň backfillnutou/nově vytvořenou rezervaci s pm drag-em přes hranici směny (starý klient pošle start+end) → server jí end RE-EXPANDUJE přes pauzu (v DB `endTime` ≠ start+span, `printMinutes` beze změny).
2. Legacy rezervaci (pm null v DB — vyrob ručně `UPDATE Block SET printMinutes = NULL WHERE id = ...` na dev) přesuň → chová se rigidně jako dřív.
3. Změň typ rezervace s pm na ZAKAZKA v editoru → `printMinutes` zůstávají (nezmizely clear větví).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/blocks/[id]/route.ts"
git commit -m "$(cat <<'EOF'
feat(rezervace): PUT vede REZERVACE s printMinutes tiskovou vetvi

Vetveni recompute bloku prepnuto z dichotomie checkType !== ZAKAZKA na
printGeometry (ZAKAZKA vzdy; REZERVACE s pm v requestu nebo na zaznamu).
Pravidlo 3 (pm ze zaznamu pri move) plati i pro REZERVACE a prechody
ZAKAZKA<->REZERVACE - clear vetev uz printMinutes u prechodu nenuluje
(spec 4.3). validateAndComputeEnd dostava skutecny checkType. Legacy
rezervace bez pm a UDRZBA zustavaji v rigidni vetvi beze zmeny.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: batch — server-authoritative end i pro REZERVACE

**Files:**
- Modify: `src/app/api/blocks/batch/route.ts` (ř. 104–130)

**Interfaces:**
- Consumes: `usesTiskoveHodiny` (Task 4).
- Produces: lasso přesun REZERVACE s pm dostává server-authoritative `endTime` (dřív syrový `u.endTime` z klienta — třída bugu P26/P27).

- [ ] **Step 1: Filtr + validace**

Do importů přidej `usesTiskoveHodiny` z `@/lib/printTime`. Nahraď (ř. 104–108):

```typescript
      // Validate schedule — only for ZAKAZKA blocks (mirrors single-block PUT behaviour)
      const zakazkaUpdates = updates.filter((u) => {
        const existing = existingBlocks.find((b) => b.id === u.id);
        return existing?.type === "ZAKAZKA";
      });
```

za:

```typescript
      // Server-authoritative end pro bloky s tiskovými hodinami (etapa 9): ZAKAZKA vždy,
      // REZERVACE s printMinutes. Legacy rezervace bez pm zůstává rigidní — end z klienta,
      // jako dnes (zrcadlí PUT).
      const tiskoveUpdates = updates.filter((u) => {
        const existing = existingBlocks.find((b) => b.id === u.id);
        return existing != null && usesTiskoveHodiny(existing);
      });
```

a ve smyčce pod tím (ř. 113–129) nahraď:

```typescript
      if (zakazkaUpdates.length > 0) {
        for (const u of zakazkaUpdates) {
```

za:

```typescript
      if (tiskoveUpdates.length > 0) {
        for (const u of tiskoveUpdates) {
```

a volání validace:

```typescript
          const sched = await validateAndComputeEnd(
            tx, u.machine, new Date(u.startTime), pm, new Date(u.endTime), "ZAKAZKA", bypass
          );
```

za:

```typescript
          const sched = await validateAndComputeEnd(
            tx, u.machine, new Date(u.startTime), pm, new Date(u.endTime), existing.type, bypass
          );
```

(Pozn.: `pm` fallback `existing.printMinutes ?? Math.round(span)` zůstává — pro REZERVACE ho filtr `usesTiskoveHodiny` činí nedosažitelným, uplatní se jen u legacy ZAKAZKA, jako dnes.)

- [ ] **Step 2: Build + suite + commit**

Run: `npm run build && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: 0 chyb, suite zelená.

- [ ] **Step 3: Ruční ověření fáze 2a (akceptace)**

Na dev (port 3001) projdi scénáře z Tasků 7–8 Step 3/5 znovu po sobě + navíc: lasso přesun {zakázka + rezervace s pm} přes hranici směny → oba bloky dostanou server-přepočítaný end; kaskádový dialog („Velký autoposun") se objeví, když rezervace odsune víc bloků než práh.

```bash
git add src/app/api/blocks/batch/route.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): batch pocita server-authoritative end i pro REZERVACE s pm

zakazkaUpdates -> tiskoveUpdates pres usesTiskoveHodiny: lasso presun
rezervace uz neposila syrovy klientsky endTime do DB (trida P26/P27).
validateAndComputeEnd dostava skutecny existing.type. Legacy rezervace
bez pm zustava na klientskem endu (rigidni) jako dnes.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

# FÁZE 2b — Jádro, klient (Tasky 10–12)

**Co dělá:** klientské snapy, ghost preview a payloady přestanou rezervaci s pm posílat duration-based a přepnou na start-only snap + `printMinutes` (server od 2a autoritativně expanduje).

**Když se nasadí JEN 2a+2b (bez fáze 3):** plná geometrie funguje; rezervace zatím NEKRESLÍ pauzu uvnitř bloku a NENÍ v driftu/reflow — vizuální stav dočasně: re-expandovaná rezervace vypadá jako souvislý blok přes pauzu. Přijatelné na dev/test, na produkci nasazovat 2a+2b+3 pohromadě (jedna vlna).

**Akceptace:** manuální QA checklist v Tasku 12; suite zelená; build+lint 0.

### Task 10: `printTimeClient.ts` — `blockPrintMinutes` + dispatch `snapGroupPerBlock`

**Files:**
- Modify: `src/lib/printTimeClient.ts`
- Modify: `src/lib/printTimeClient.test.ts`

**Interfaces:**
- Consumes: `usesTiskoveHodiny` (Task 4).
- Produces: `blockPrintMinutes` vrací pro tiskovou REZERVACE `printMinutes` (ne elapsed); `snapGroupPerBlock` dispatchuje tiskovou rezervaci do ZAKAZKA větve (start-only snap + expanze). Signatury beze změny.

- [ ] **Step 1: Failing testy**

Do `src/lib/printTimeClient.test.ts` (importy `xl106Week, W1, W2`, `pragueToUTC`, `snapGroupPerBlock`, `blockPrintMinutes` už v souboru jsou):

```typescript
test("blockPrintMinutes — REZERVACE s pm vrací pm; legacy REZERVACE a UDRZBA elapsed (etapa 9)", () => {
  const base = { startTime: "2026-08-21T08:00:00.000Z", endTime: "2026-08-21T10:00:00.000Z" };
  assert.equal(blockPrintMinutes({ type: "REZERVACE", printMinutes: 90, ...base }), 90);
  assert.equal(blockPrintMinutes({ type: "REZERVACE", printMinutes: null, ...base }), 120, "legacy → elapsed BEZE zaokrouhlení");
  assert.equal(blockPrintMinutes({ type: "UDRZBA", printMinutes: 90, ...base }), 120, "údržba vždy elapsed");
  assert.equal(blockPrintMinutes({ type: "ZAKAZKA", printMinutes: 90, ...base }), 90, "zakázka beze změny");
});

test("snapGroupPerBlock — tisková REZERVACE se snapuje start-only a expanduje přes pauzu (etapa 9)", () => {
  // Pá 20:00, pm 240: pátek běží do 22:00 → 2 h tisku Pá + 2 h od Ne 22:00.
  const blocks = [
    { id: 1, machine: "XL_106", type: "REZERVACE", originalStart: pragueToUTC("2026-08-21", 20), originalEnd: pragueToUTC("2026-08-22", 0), printMinutes: 240 },
  ];
  const r = snapGroupPerBlock(blocks, 0, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(r);
  assert.deepEqual(r!.results[0]!.start, pragueToUTC("2026-08-21", 20));
  assert.deepEqual(r!.results[0]!.end, pragueToUTC("2026-08-24", 0), "expanze přes víkendovou odstávku, ne rigidní span");
});

test("snapGroupPerBlock — legacy REZERVACE (pm null) zůstává rigidní se zachovanou délkou", () => {
  const blocks = [
    { id: 1, machine: "XL_106", type: "REZERVACE", originalStart: pragueToUTC("2026-08-21", 20), originalEnd: pragueToUTC("2026-08-21", 21) },
  ];
  const r = snapGroupPerBlock(blocks, 3600000, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(r);
  assert.equal(r!.results[0]!.end.getTime() - r!.results[0]!.start.getTime(), 3600000, "rigidní přesná délka");
});
```

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: FAIL — první dva nové testy (REZERVACE dnes elapsed/rigidní).
POZOR: stávající test `"snapGroupPerBlock — smíšený výběr: REZERVACE se snapuje rigidně…"` používá rezervaci BEZ `printMinutes` → po implementaci zůstane zelený (legacy větev). NEMAZAT — teď dokumentuje legacy chování; přejmenuj mu popisek na `"snapGroupPerBlock — smíšený výběr: LEGACY rezervace (bez pm) se snapuje rigidně (přesná délka)"`.

- [ ] **Step 2: Implementace**

Do importu z `@/lib/printTime` přidej `usesTiskoveHodiny`. V `blockPrintMinutes` nahraď:

```typescript
  if (b.type !== "ZAKAZKA") return elapsed;
  return b.printMinutes ?? Math.max(30, Math.round(elapsed / 30) * 30);
```

za:

```typescript
  // UDRZBA a legacy REZERVACE (bez pm) = elapsed; ZAKAZKA a tisková REZERVACE = printMinutes.
  // Zaokrouhlený fallback se týká jen legacy ZAKAZKA (usesTiskoveHodiny pro ni vrací true i s pm=null).
  if (!usesTiskoveHodiny(b)) return elapsed;
  return b.printMinutes ?? Math.max(30, Math.round(elapsed / 30) * 30);
```

a docblock ř. 21–24 uprav na: `Délka bloku v minutách pro payload: ZAKAZKA a REZERVACE s printMinutes = printMinutes (fallback elapsed zarovnaný na 30min grid jen u legacy ZAKAZKA), UDRZBA a legacy REZERVACE = elapsed.`

V `snapGroupPerBlock` nahraď:

```typescript
    const isZakazka = b.type === "ZAKAZKA";
    const snapOwn = (from: Date): Date | null =>
      isZakazka
        ? snapStartToNextRunnableSlot(b.machine, from, weekShifts, intervalsFor(b.machine))
        : snapToNextValidStartWithTemplates(b.machine, from, durationMs, weekShifts);
```

za:

```typescript
    // Etapa 9: tisková geometrie = ZAKAZKA + REZERVACE s printMinutes (usesTiskoveHodiny);
    // legacy REZERVACE bez pm a UDRZBA zůstávají rigidní.
    const tiskove = usesTiskoveHodiny({ type: b.type, printMinutes: b.printMinutes });
    const snapOwn = (from: Date): Date | null =>
      tiskove
        ? snapStartToNextRunnableSlot(b.machine, from, weekShifts, intervalsFor(b.machine))
        : snapToNextValidStartWithTemplates(b.machine, from, durationMs, weekShifts);
```

a níže `if (isZakazka) {` (výpočet endu) za `if (tiskove) {`. V docblocku funkce nahraď větu `Per-blok dispatch podle typu: ZAKAZKA = start-only snap + expandPrintTime (délka se rozloží přes kalendář); REZERVACE/UDRZBA = rigidní snap se ZACHOVANOU přesnou délkou (žádná expanze).` za `Per-blok dispatch podle GEOMETRIE (usesTiskoveHodiny): ZAKAZKA a REZERVACE s printMinutes = start-only snap + expandPrintTime; UDRZBA a legacy REZERVACE bez printMinutes = rigidní snap se ZACHOVANOU přesnou délkou.`

- [ ] **Step 3: Testy PASS + commit**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: vše PASS (3 nové + přejmenovaný legacy + všechny stávající).

```bash
git add src/lib/printTimeClient.ts src/lib/printTimeClient.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): blockPrintMinutes a snapGroupPerBlock respektuji tiskovou rezervaci

blockPrintMinutes vraci pro REZERVACE s printMinutes pm misto elapsed;
snapGroupPerBlock dispatchuje podle usesTiskoveHodiny - tiskova rezervace
jde start-only snap + expanzi, legacy (pm null) a UDRZBA zustavaji
rigidni. tryExpandForBlock (kresleni pauz, drift) se tu JESTE nemeni -
prijde ve fazi 3 spolu se serverovym driftem kvuli parite.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Payload gaty — `blockPayload`, `blockEditDuration`, `useJobBuilder`

**Files:**
- Modify: `src/lib/blockPayload.ts:165-167`
- Modify: `src/lib/blockPayload.test.ts`
- Modify: `src/lib/blockEditDuration.ts:44-59` (+ docblock tabulka)
- Modify: `src/lib/blockEditDuration.test.ts`
- Modify: `src/hooks/useJobBuilder.ts:463`

**Interfaces:**
- Consumes: `usesTiskoveHodiny`, `typeUsesTiskoveHodiny` (Task 4).
- Produces: paste/undo payload (`buildPasteBody`) nese `printMinutes` i pro tiskovou REZERVACE; `durationPayload` vrací pro REZERVACE `{ printMinutes }` (UDRZBA dál `{ endTime }`); builder série posílá pm i pro REZERVACE.

- [ ] **Step 1: Failing testy**

`src/lib/blockPayload.test.ts` — přidej:

```typescript
test("buildPasteBody: REZERVACE s printMinutes posílá printMinutes (etapa 9)", () => {
  const b = mkBlock({ type: "REZERVACE", printMinutes: 90 });
  const p = buildPasteBody(b, "XL_106", new Date("2026-08-21T08:00:00.000Z"), new Date("2026-08-21T09:30:00.000Z"), false);
  assert.equal(p.printMinutes, 90);
});

test("buildPasteBody: legacy REZERVACE (pm null) a UDRZBA printMinutes neposílají", () => {
  const legacy = mkBlock({ type: "REZERVACE", printMinutes: null });
  const udrzba = mkBlock({ type: "UDRZBA", printMinutes: null });
  const start = new Date("2026-08-21T08:00:00.000Z"); const end = new Date("2026-08-21T10:00:00.000Z");
  assert.equal("printMinutes" in buildPasteBody(legacy, "XL_106", start, end, false), false);
  assert.equal("printMinutes" in buildPasteBody(udrzba, "XL_106", start, end, false), false);
});
```

(Pokud se lokální helper pro blok v `blockPayload.test.ts` jmenuje jinak než `mkBlock`, použij tamní existující builder — ověř `grep -n "function mk\|const mk" src/lib/blockPayload.test.ts` a testy přizpůsob JEHO jménu a povinným polím.)

`src/lib/blockEditDuration.test.ts` — najdi stávající testy volající `durationPayload` s `type: "REZERVACE"` (Run: `grep -n 'REZERVACE' src/lib/blockEditDuration.test.ts`) a NAHRAĎ jejich očekávání + přidej:

```typescript
test("durationPayload: REZERVACE posílá printMinutes — tiskové hodiny (etapa 9)", () => {
  assert.deepEqual(
    durationPayload({ type: "REZERVACE", typeChanged: false, touched: true, durationHours: 2.5, startTime: "2026-08-21T08:00:00.000Z" }),
    { printMinutes: 150 },
  );
});

test("durationPayload: UDRZBA zůstává na endTime (rigidní)", () => {
  assert.deepEqual(
    durationPayload({ type: "UDRZBA", typeChanged: false, touched: true, durationHours: 2, startTime: "2026-08-21T08:00:00.000Z" }),
    { endTime: "2026-08-21T10:00:00.000Z" },
  );
});
```

Run: `node --test --import tsx src/lib/blockPayload.test.ts src/lib/blockEditDuration.test.ts`
Expected: FAIL (nové + upravené testy).

- [ ] **Step 2: Implementace**

`blockPayload.ts` (import `usesTiskoveHodiny` z `@/lib/printTime`):

```typescript
  if (usesTiskoveHodiny(block)) {
    payload.printMinutes = blockPrintMinutes(block);
  }
```

`blockEditDuration.ts` (import `typeUsesTiskoveHodiny` z `@/lib/printTime`): v `durationPayload` nahraď `if (type === "ZAKAZKA") {` za:

```typescript
  // Etapa 9: REZERVACE je tiskový typ — délka jde jako printMinutes, end počítá
  // server expanzí. Formulář nový typ VŽDY doprovodí délkou (touched/typeChanged),
  // takže i legacy rezervace dostane pm, jakmile na délku někdo sáhne — to je
  // zamýšlená cesta „ručně opravit" ze spec §3 (server nezarovnaný start odmítne
  // s čitelnou 422, ne s tichým přepisem).
  if (typeUsesTiskoveHodiny(type)) {
```

a v docblock tabulce (ř. 41–42) nahraď poslední dva řádky za:

```
 * | jinak a typ tiskový (ZAKAZKA / REZERVACE) | `{ printMinutes: Math.round(durationHours*60) }` |
 * | jinak (UDRZBA)                     | `{ endTime: <ISO string startTime + durationHours> }` |
```

`useJobBuilder.ts:463` (import `typeUsesTiskoveHodiny` z `@/lib/printTime`):

```typescript
      ...(typeUsesTiskoveHodiny(type) ? { printMinutes: Math.round(durationHours * 60) } : {}),
```

- [ ] **Step 3: Testy PASS + build + commit**

Run: `node --test --import tsx src/lib/blockPayload.test.ts src/lib/blockEditDuration.test.ts && npm run build`
Expected: vše PASS, build 0 chyb.

```bash
git add src/lib/blockPayload.ts src/lib/blockPayload.test.ts src/lib/blockEditDuration.ts src/lib/blockEditDuration.test.ts src/hooks/useJobBuilder.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): payload gaty posilaji printMinutes i pro rezervace

buildPasteBody (paste/undo-obnova) nese pm pro tiskovou rezervaci pres
usesTiskoveHodiny; durationPayload (BlockEdit picker) posila pro
REZERVACE printMinutes misto endTime (UDRZBA zustava na endTime);
useJobBuilder serie dtto pres typeUsesTiskoveHodiny (spec 4.7 + pozn.
k useJobBuilder.ts:463 - patri do skupiny A, ne B).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `PlannerPage.tsx` + `TimelineGrid.tsx` — 10 snap/preview míst

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (místa 1–5 dle specu 4.7; čísla řádků k HEAD: 2285/2370/2415, 2494/2531, 2598, 3437–3441, 3447–3448)
- Modify: `src/app/_components/TimelineGrid.tsx` (místa 6–10: 865, 938, 960, 1103, 2154 + prop `pasteSourceIsZakazka` ř. ~314)

**Interfaces:**
- Consumes: `usesTiskoveHodiny`, `typeUsesTiskoveHodiny` (import z `@/lib/printTime` — v obou souborech rozšířit stávající import odtud).
- Produces: prop `pasteSourceIsZakazka` PŘEJMENOVÁN na `pasteSourceUsesPrintTime` (jinak by jméno lhalo — P19); tvary payloadů beze změny (jen kdy se posílá `printMinutes` vs. `endTime`).
- Místo #9 specu (multi-move) je už pokryté Taskem 10 (`snapGroupPerBlock` dispatchuje uvnitř sebe) — v `TimelineGrid` se pro něj NIC nemění.
- **Výslovně NEDOTÝKAT:** `PlannerPage.tsx:3611–3616` (viditelnost v `isTiskar` režimu — komentář v kódu zakazuje zjednodušení).

- [ ] **Step 1: PlannerPage — handleQueueDrop (místo 1+2)**

Nahraď (ř. 2283–2286):

```typescript
    // ZAKAZKA → model tiskových hodin: start-only snap, server dopočítá autoritativní end z printMinutes.
    // REZERVACE / UDRZBA → starý duration-based snap (server tyto typy nevaliduje přes tiskové hodiny).
    const isZakazka = item.type === "ZAKAZKA";
```

za:

```typescript
    // ZAKAZKA a REZERVACE (etapa 9) → model tiskových hodin: start-only snap, server
    // dopočítá autoritativní end z printMinutes. UDRZBA → duration-based snap (rigidní).
    // Nový item z fronty záznam nemá → rozhoduje typ (typeUsesTiskoveHodiny).
    const isZakazka = typeUsesTiskoveHodiny(item.type);
```

(Lokální jméno `isZakazka` se v handleru používá na 3 místech — ponechává se, přejmenování by nafouklo diff; komentář nese pravdu. Výskyty `...(isZakazka ? { printMinutes: pm } : {})` na ř. 2370 a 2415 tím začnou posílat pm i pro rezervace — žádná další editace.)

- [ ] **Step 2: PlannerPage — handlePasteWithTarget (místo 3)**

Nahraď (ř. 2494): `const isZakazka = src.type === "ZAKAZKA";` za:

```typescript
    // Existující blok → rozhoduje záznam (usesTiskoveHodiny): tisková rezervace jde
    // start-only snap + printMinutes, legacy rezervace bez pm zůstává duration-based.
    const isZakazka = usesTiskoveHodiny(src);
```

(Cut-move větev ř. 2531 `moveBody.printMinutes = blockPrintMinutes(fresh)` pak pro tiskovou rezervaci pošle pm automaticky — `blockPrintMinutes` je z Tasku 10.)

- [ ] **Step 3: PlannerPage — handleGroupPasteWithTarget (místo 4)**

Nahraď (ř. 2598): `const allZakazka = group.every((b) => b.type === "ZAKAZKA");` za:

```typescript
    const allZakazka = group.every((b) => usesTiskoveHodiny(b));
```

- [ ] **Step 4: PlannerPage — clipboard preview + prop (místo 5 + rename)**

Nahraď (ř. 3437–3441):

```typescript
            pasteSourceIsZakazka={
              clipboardGroupRef.current.length > 0
                ? clipboardGroupRef.current.every((b) => b.type === "ZAKAZKA")
                : copiedBlock?.type === "ZAKAZKA"
            }
```

za:

```typescript
            pasteSourceUsesPrintTime={
              clipboardGroupRef.current.length > 0
                ? clipboardGroupRef.current.every((b) => usesTiskoveHodiny(b))
                : copiedBlock != null && usesTiskoveHodiny(copiedBlock)
            }
```

a v `durationMsFor` (ř. 3447–3448):

```typescript
              const durationMsFor = (b: Block) =>
                b.type === "ZAKAZKA" ? blockPrintMinutes(b) * 60000 : new Date(b.endTime).getTime() - new Date(b.startTime).getTime();
```

za:

```typescript
              const durationMsFor = (b: Block) =>
                usesTiskoveHodiny(b) ? blockPrintMinutes(b) * 60000 : new Date(b.endTime).getTime() - new Date(b.startTime).getTime();
```

- [ ] **Step 5: TimelineGrid — prop + 4 místa**

1. Definice props (ř. ~314): přejmenuj `pasteSourceIsZakazka` na `pasteSourceUsesPrintTime` (deklarace + destructuring + použití na ř. 2154). Run: `grep -n 'pasteSourceIsZakazka' src/app/_components/TimelineGrid.tsx` → po úpravě 0 výskytů.
2. Queue-drop preview (ř. 865): `if (workingTimeLockRef.current && qdItem.type === "ZAKAZKA") {` → `if (workingTimeLockRef.current && typeUsesTiskoveHodiny(qdItem.type)) {`
3. Drag-move ghost (ř. 938): `if (workingTimeLockRef.current && sourceBlock?.type === "ZAKAZKA") {` → `if (workingTimeLockRef.current && sourceBlock && usesTiskoveHodiny(sourceBlock)) {`
4. Resize preview (ř. 960): `if (workingTimeLockRef.current && sourceBlock?.type === "ZAKAZKA" && snappedEnd...` → `if (workingTimeLockRef.current && sourceBlock && usesTiskoveHodiny(sourceBlock) && snappedEnd...` (zbytek podmínky beze změny).
5. Drag-move commit (ř. 1103): `const isZakazka = sourceBlock?.type === "ZAKAZKA";` → `const isZakazka = sourceBlock != null && usesTiskoveHodiny(sourceBlock);`

- [ ] **Step 6: Build + lint + celá suite**

Run: `npm run build && npm run lint && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: 0 chyb; suite zelená.

- [ ] **Step 7: Manuální QA fáze 2 (dev, port 3001, zámek pracovní doby ZAPNUTÝ)**

1. **Queue-drop rezervace** k hranici směny → ghost preview má expandovanou výšku, po dropu server end sedí na preview.
2. **Drag** tiskové rezervace přes noc → ghost roste přes pauzu, po puštění blok skutečně končí za pauzou; Ctrl+Z vrátí.
3. **Resize** tiskové rezervace → náhled „X h tisku (Y h celkem)" jako u zakázky, server invertuje pm.
4. **Copy/paste** rezervace → marker start-only snap, vložený blok má pm; **cut/paste** zachová `reservationId` i pm.
5. **Lasso** {zakázka + tisková rezervace} přes hranici směny → per-blok snap, pořadí zachováno, žádný falešný 409.
6. **Legacy rezervace** (pm null) → všechna gesta rigidní jako dřív (duration-based snap, žádné printMinutes v payloadu — ověř v Network tabu).
7. **UDRZBA** — všechna gesta beze změny.
8. **BlockEdit**: změna délky rezervace picker-em → uloží se pm, end spočítá server (přes pauzu se natáhne).

- [ ] **Step 8: Commit**

```bash
git add src/app/_components/PlannerPage.tsx src/app/_components/TimelineGrid.tsx
git commit -m "$(cat <<'EOF'
feat(rezervace): klientske snapy a preview prepnuty na tiskovou geometrii

Vsech 10 mist ze spec 4.7: queue-drop (commit + payloady), paste/group
paste/cut, clipboard preview, ghost preview (queue/move/resize), drag-move
commit a paste marker rozhoduji pres usesTiskoveHodiny (zaznamy) resp.
typeUsesTiskoveHodiny (nove itemy). Prop pasteSourceIsZakazka prejmenovan
na pasteSourceUsesPrintTime (P19 - jmeno nesmi lhat). Multi-move uz resi
snapGroupPerBlock z predchoziho tasku. PlannerPage:3611 (isTiskar
viditelnost) vedome nedotceno dle spec 4.7.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

# FÁZE 3 — Drift, reflow, undo dotažení (Tasky 13–16)

**Co dělá:** rezervace s pm dostane pauzy uvnitř bloku, drift štítek, místo v serverovém driftu (notifikace, kaskádová kontrola směn, hromadné „Přepočítat") a jednoblokové „Přepočítat"; parity testy; dokumentace.

**Když se nasadí JEN po tuhle fázi (bez fáze 4):** plná funkčnost etapy bez reportového ukazatele — kompletní, konzistentní stav; reporty vytížení nedotčené.

**Akceptace:** parity test klient↔server s REZERVACE fixturami zelený; editace směn hlásí kaskádu i přes rezervace; „Přepočítat" (blok i stroj) rezervaci opraví a Ctrl+Z ji vrátí i se značkou.

### Task 13: `tryExpandForBlock` — pauzy uvnitř bloku + klientský drift

**Files:**
- Modify: `src/lib/printTimeClient.ts` (`tryExpandForBlock`, ř. 188–205 + docblock)
- Modify: `src/lib/printTimeClient.test.ts`

**Interfaces:**
- Consumes: `usesTiskoveHodiny` (importované od Tasku 10).
- Produces: `getBlockSegments` (pauza „⏸ PAUZA — mimo provoz"), `blockCalendarDrift` (štítek na kartě) a `blockReportSegments` fungují pro tiskovou REZERVACE. `printMidpoint` má VLASTNÍ gate (`b.type === "ZAKAZKA"`, ř. 355) — split zůstává ZAKAZKA-only (rozhodnutí #7), NEDOTÝKAT. Reportoví volající mají vnější gate (rozhodnutí #5) — NEDOTÝKAT (kromě Tasku 17). **Pojmenovaný vedlejší efekt:** denní report `report/daily/ReportView.tsx:180` volá `blockReportSegments` BEZ vnějšího type gate — používá ho ale jen na členství bloku ve směně (`blockPrintsInShift`), ne na vytížení; rezervace expandovaná přes pauzu se nově NEukáže ve směně, kde leží jen její pauza. To je korektní zpřesnění výpisu, ne změna metriky — rozhodnutí #5 (vytížení) se netýká.

- [ ] **Step 1: Failing testy**

```typescript
test("getBlockSegments — tisková REZERVACE přes odstávku dostane pauzu (etapa 9)", () => {
  const b = {
    type: "REZERVACE", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-24", 0),
    printMinutes: 240, scheduleBypassed: false,
  };
  const segs = getBlockSegments(b, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(segs, "segmenty musí existovat");
  assert.ok(segs!.some((s) => s.kind === "pause"), "obsahují pauzu přes víkend");
});

test("getBlockSegments — ODLOŽENÁ rezervace (bypass) → null, kreslí se slitě (P6 guard platí i pro ni)", () => {
  const b = {
    type: "REZERVACE", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0),
    printMinutes: 240, scheduleBypassed: true,
  };
  assert.equal(getBlockSegments(b, [...xl106Week(W1), ...xl106Week(W2)], []), null);
});

test("blockCalendarDrift — tisková REZERVACE s rozejitým endem → END_MISMATCH (etapa 9)", () => {
  const b = {
    type: "REZERVACE", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0),
    printMinutes: 240, scheduleBypassed: false, printCompletedAt: null,
  };
  const d = blockCalendarDrift(b, [...xl106Week(W1), ...xl106Week(W2)], [], pragueToUTC("2026-08-20", 12));
  assert.ok(d);
  assert.equal(d!.reason, "END_MISMATCH");
  assert.deepEqual(d!.expectedEnd, pragueToUTC("2026-08-24", 0));
});

test("blockCalendarDrift — legacy REZERVACE (pm null) a UDRZBA → null (nelze posoudit)", () => {
  const shifts = [...xl106Week(W1), ...xl106Week(W2)];
  const now = pragueToUTC("2026-08-20", 12);
  const base = { machine: "XL_106", startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0), printCompletedAt: null };
  assert.equal(blockCalendarDrift({ ...base, type: "REZERVACE", printMinutes: null }, shifts, [], now), null);
  assert.equal(blockCalendarDrift({ ...base, type: "UDRZBA", printMinutes: 240 }, shifts, [], now), null);
});

test("printMidpoint — REZERVACE dál vrací null (split zůstává ZAKAZKA-only, rozhodnutí #7)", () => {
  const b = {
    type: "REZERVACE", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-21", 12),
    printMinutes: 120,
  };
  assert.equal(printMidpoint(b, [...xl106Week(W1), ...xl106Week(W2)], []), null);
});
```

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: FAIL — testy 1 a 3 (`tryExpandForBlock` dnes ne-ZAKAZKA odmítá). (Test 5 projde už teď — je to regresní pojistka broadeningu.)

- [ ] **Step 2: Implementace**

V `tryExpandForBlock` nahraď `if (b.type !== "ZAKAZKA") return null;` za:

```typescript
  if (!usesTiskoveHodiny(b)) return null;
```

a v docblocku funkce nahraď `ověří ZAKAZKA/platné printMinutes/zarovnaný start` za `ověří tiskovou geometrii (usesTiskoveHodiny — ZAKAZKA, REZERVACE s printMinutes)/platné printMinutes/zarovnaný start`. Ve výčtu volajících doplň k `blockReportSegments` větu: `Vnější gate reportových rout na "ZAKAZKA" ZŮSTÁVÁ (rozhodnutí #5 etapy 9) — jediný negated volající je denní report (členství ve směně), viz plán etapy 9, Task 13.`

- [ ] **Step 3: Testy PASS + commit**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts src/lib/monitorDriftMark.test.ts src/lib/calendarDriftUi.test.ts`
Expected: vše PASS (Monitor rezervace nezobrazuje — `shouldMarkDrift` se rezervací nedotkne, test suite to potvrdí beze změn).

```bash
git add src/lib/printTimeClient.ts src/lib/printTimeClient.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): tryExpandForBlock pousti tiskove rezervace - pauzy + drift stitek

Sdileny guard prepnut na usesTiskoveHodiny: getBlockSegments kresli
rezervaci pauzu "mimo provoz", blockCalendarDrift ji posuzuje na karte
(PARKED/STALE_BYPASS vcetne - rozhodnuti #2/#3). printMidpoint ma vlastni
ZAKAZKA gate a zustava (split mimo rozsah, #7). Vnejsi reportove gaty
zustavaji (#5); denni report meni jen clenstvi bloku ve smene (pojmenovany
vedlejsi efekt, P17). Bypass guard P6 plati i pro rezervace - test.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `detectCalendarDrift` + parita + kaskáda směn

**Files:**
- Modify: `src/lib/calendarDrift.server.ts` (where filtr ř. 110–116 + strukturální typ ř. 13–20 + docblock)
- Modify: `src/lib/calendarDrift.server.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `detectCalendarDrift` vrací i REZERVACE (where `type: { in: ["ZAKAZKA", "REZERVACE"] }`); `PrismaClientLike.block.findMany` where typ se MĚNÍ na `type: { in: string[] }` (spec 4.9 tvrdil „nevyžaduje změnu signatury" — k HEAD to NEPLATÍ, literál `type: string` by nový tvar nepustil přes TS). Kaskádová kontrola směn (`PUT /api/machine-week-shifts` — `driftBefore`/`driftAfter` + `classifyCascade`) se tím pokryje AUTOMATICKY beze změny vlastního kódu; `reflowMachineInTx` (hromadné Přepočítat) taky. `notifyCalendarDrift` beze změny (rozhodnutí #3 — stejný kanál; `orderNumber` rezervace = `reservation.code`).

- [ ] **Step 1: Failing testy**

Do `calendarDrift.server.test.ts`:

1. Test where filtru (fake musí PROMÍTAT where — P9; fake v souboru vrací řádky bez filtru, proto se tvrdí na PŘEDANÝCH argumentech). Přidej test:

```typescript
test("detectCalendarDrift — where filtr žádá ZAKAZKA i REZERVACE (etapa 9), UDRZBA nikdy", async () => {
  let capturedWhere: { type: { in: string[] } } | null = null;
  const db = {
    machineWeekShifts: { findMany: async () => [] },
    companyDay: { findMany: async () => [] },
    block: {
      findMany: async (args: { where: { type: { in: string[] } } }) => {
        capturedWhere = args.where;
        return [];
      },
    },
  } as never;
  await detectCalendarDrift(db, ["XL_106"], pragueToUTC("2026-08-17", 0), pragueToUTC("2026-08-24", 0), pragueToUTC("2026-08-17", 0));
  assert.deepEqual(capturedWhere!.type, { in: ["ZAKAZKA", "REZERVACE"] });
});
```

2. Rozšíření parity tabulky (test `"parita klient ↔ server…"`, pole `cases`) o dva řádky PŘED `];` (id 42/43 — ověř kolize `grep -n "id: 4" src/lib/calendarDrift.server.test.ts`; ve druhé tabulce bypass testů id 41–43 už jsou, ale jde o JINÉ pole `cases` — v tomto poli je nejvyšší id 41):

```typescript
    {
      // Etapa 9: REZERVACE s printMinutes se posuzuje jako zakázka — rozejitý end
      // musí obě strany klasifikovat shodně END_MISMATCH.
      name: "REZERVACE s pm: end nesedí na kalendář → END_MISMATCH na obou stranách",
      row: mkBlock({ id: 42, type: "REZERVACE", startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 0), printMinutes: 240 }),
      expected: "END_MISMATCH",
    },
    {
      name: "REZERVACE s pm: konformní umístění → žádný drift na žádné straně",
      row: mkBlock({ id: 43, type: "REZERVACE", startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12), printMinutes: 240 }),
      expected: null,
    },
```

(Tvar `expected` přizpůsob tomu, jak parity tabulka očekávání zapisuje — ověř na stávajícím řádku id 34; pokud používá `expected: "END_MISMATCH"` vs objekt, drž JEJÍ formát. Fake DB parity testu musí řádek s `type: "REZERVACE"` PUSTIT — pokud fake filtruje `type === "ZAKAZKA"` natvrdo, rozšiř ho na `["ZAKAZKA","REZERVACE"].includes(...)`, aby promítal nový where.)

Run: `node --test --import tsx src/lib/calendarDrift.server.test.ts`
Expected: FAIL — where test (dnes `type: "ZAKAZKA"`), parity řádek 42 (server rezervaci nevrátí).

- [ ] **Step 2: Implementace**

Ve strukturálním typu `PrismaClientLike` nahraď `type: string;` za `type: { in: string[] };`. Ve `where` dotazu nahraď `type: "ZAKAZKA",` za:

```typescript
      // Etapa 9: drift posuzuje ZAKAZKA i REZERVACE (rozhodnutí #3 — stejný kanál).
      // Legacy rezervace bez printMinutes odfiltruje printMinutes: { gt: 0 } níž;
      // odložené (scheduleBypassed) vyřazuje filtr výš — parita s klientem drží
      // přes usesTiskoveHodiny, viz tabulkový test parity.
      type: { in: ["ZAKAZKA", "REZERVACE"] },
```

V docblocku `detectCalendarDrift` nahraď první větu `Detekuje ZAKAZKA bloky, jejichž…` za `Detekuje ZAKAZKA a REZERVACE bloky (etapa 9 — rezervace s tiskovými hodinami), jejichž…`.

- [ ] **Step 3: Testy PASS + kaskáda ověření**

Run: `node --test --import tsx src/lib/calendarDrift.server.test.ts src/lib/cascadeCheck.test.ts`
Expected: vše PASS (`classifyCascade` je nad `DriftedBlock[]` typově agnostický — beze změny kódu i testů).

Ruční ověření kaskády směn na dev: zkrať směnu tak, aby tisková rezervace nově přestala stíhat → PUT `/api/machine-week-shifts` vrátí 409 s kaskádovým hlášením (`newlyHomeless`/`newlyLonger` zahrnuje rezervaci pod jejím `orderNumber` = kódem rezervace).

- [ ] **Step 4: Commit**

```bash
git add src/lib/calendarDrift.server.ts src/lib/calendarDrift.server.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): detectCalendarDrift posuzuje i REZERVACE s printMinutes

where filtr type in [ZAKAZKA, REZERVACE] (strukturalni typ prepnut na
{ in: string[] } - spec 4.9 tvrdil beze zmeny, k HEAD neplatilo). Legacy
rezervace odfiltruje printMinutes gt 0, odlozene scheduleBypassed filtr.
Kaskadova kontrola smen (driftBefore/driftAfter + classifyCascade),
notifikace i hromadne Prepocitat pokryvaji rezervace automaticky.
Parity tabulka klient<->server rozsirena o REZERVACE fixtury.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Reflow — „Přepočítat" umí rezervaci

**Files:**
- Modify: `src/lib/reflow.server.ts` (`reflowBlockInTx` guard, ř. 110–112 + docblock)
- Modify: `src/lib/reflow.server.test.ts`

**Interfaces:**
- Consumes: `usesTiskoveHodiny` (Task 4).
- Produces: `reflowBlockInTx` přijímá tiskovou REZERVACE; error `code: "NOT_ZAKAZKA"` ZŮSTÁVÁ (spec 4.10 — nepřejmenovávat, klient na string mapuje hlášku), mění se jen text. `reflowMachineInTx` zahrnuje rezervace automaticky (drift z Tasku 14). Undo reflow rezervace funguje beze změny (`buildReflowCommand` je typu-prostý; sync `scheduled*` zapojen ve fázi 0).

- [ ] **Step 1: Failing testy**

Do `reflow.server.test.ts` (helpery `mkBlock`, `mkTx`, `H`, `actor` v souboru jsou):

```typescript
describe("reflowBlockInTx — REZERVACE (etapa 9)", () => {
  it("tisková rezervace s driftem se přepočítá (fallback 24/7: end = start + pm)", async () => {
    // Uložený end lže o hodinu — reflow ho srovná na expanzi (souvislý provoz).
    const block = mkBlock({ type: "REZERVACE", printMinutes: 120, startTime: H(10), endTime: H(13) });
    const { tx, updateMock } = mkTx(block);
    const r = await reflowBlockInTx(tx, 1, actor, { resolveChainPush: async () => [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.changed, true);
    assert.deepEqual(r.endTime, H(12));
    assert.equal(updateMock.mock.callCount(), 1);
  });

  it("legacy rezervace (pm null) → NOT_ZAKAZKA (nelze poctivě přepočítat)", async () => {
    const block = mkBlock({ type: "REZERVACE", printMinutes: null });
    const { tx } = mkTx(block);
    const r = await reflowBlockInTx(tx, 1, actor, { resolveChainPush: async () => [] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "NOT_ZAKAZKA");
  });

  it("UDRZBA → NOT_ZAKAZKA beze změny etapou 9", async () => {
    const block = mkBlock({ type: "UDRZBA", printMinutes: 120 });
    const { tx } = mkTx(block);
    const r = await reflowBlockInTx(tx, 1, actor, { resolveChainPush: async () => [] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.code, "NOT_ZAKAZKA");
  });
});
```

Run: `node --test --import tsx src/lib/reflow.server.test.ts`
Expected: FAIL — první test (guard dnes REZERVACE odmítá).

- [ ] **Step 2: Implementace**

Do importu z `@/lib/printTime` v `reflow.server.ts` přidej `usesTiskoveHodiny`. Nahraď:

```typescript
  if (block.type !== "ZAKAZKA") {
    return { ok: false, code: "NOT_ZAKAZKA", message: "Lze přepočítat jen blok typu zakázka." };
  }
```

za:

```typescript
  // Etapa 9: přepočítat lze každý blok s tiskovými hodinami — zakázku i rezervaci
  // s printMinutes. Kód "NOT_ZAKAZKA" se NEPŘEJMENOVÁVÁ (klient na string mapuje
  // hlášku, spec 4.10) — sémantika je nově „blok nemá tiskové hodiny".
  if (!usesTiskoveHodiny(block)) {
    return { ok: false, code: "NOT_ZAKAZKA", message: "Lze přepočítat jen blok s tiskovými hodinami (zakázka, rezervace)." };
  }
```

V docblocku `reflowBlockInTx` nahraď `Přepočítá jeden ZAKAZKA blok` za `Přepočítá jeden blok s tiskovými hodinami (ZAKAZKA, od etapy 9 i REZERVACE s printMinutes)`.

- [ ] **Step 3: Testy PASS + commit**

Run: `node --test --import tsx src/lib/reflow.server.test.ts src/lib/reflowToastText.test.ts`
Expected: vše PASS.

```bash
git add src/lib/reflow.server.ts src/lib/reflow.server.test.ts
git commit -m "$(cat <<'EOF'
feat(rezervace): Prepocitat funguje pro rezervace s tiskovymi hodinami

reflowBlockInTx guard prepnut na usesTiskoveHodiny - tiskova rezervace
se prepocita (start-only snap + expanze + chain push + sync scheduled*
z faze 0), legacy rezervace a UDRZBA dal vraci NOT_ZAKAZKA (kod string
zustava kvuli klientskemu mapovani, meni se jen text hlasky).
reflowMachineInTx zahrnuje rezervace automaticky pres rozsireny drift.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Dokumentace + e2e QA fáze 3

**Files:**
- Modify: `CLAUDE.md` (3 místa)
- Modify: `docs/vyvoj-historie.md` (append)
- Modify: `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` (označit Etapu 9)

**Interfaces:** — (dokumentační task; poučení P19 — komentáře/dokumenty nesmí popisovat předetapový stav).

- [ ] **Step 1: CLAUDE.md — chain push geometrie**

V sekci „Chain push…" nahraď odrážku:

```
- **REZERVACE/UDRZBA** → rigidní interval: PŘESNÁ délka (žádné zaokrouhlení na 30 min, žádné roztažení), start přes `snapToNextValidStartWithTemplates` (týž helper, jaký používá ruční drag na klientovi), horizont posunu `MAX_RIGID_PUSH_MS` = 7 dní.
```

za:

```
- **REZERVACE s `printMinutes`** (od etapy 9, 8/2026) → tiskové hodiny jako zakázka, ale s horizontem posunu `maxPushMs = MAX_RIGID_PUSH_MS` (7 dní) — dluh P31 se nekopíruje na druhý typ; neumístitelná rezervace se degraduje na zeď. Kdo tiskové hodiny používá, říká VÝHRADNĚ `usesTiskoveHodiny` (`src/lib/printTime.ts`) — žádné inline dichotomie `type === "ZAKAZKA"`.
- **UDRZBA a legacy REZERVACE bez `printMinutes`** → rigidní interval: PŘESNÁ délka (žádné zaokrouhlení na 30 min, žádné roztažení), start přes `snapToNextValidStartWithTemplates`, horizont posunu `MAX_RIGID_PUSH_MS` = 7 dní.
```

- [ ] **Step 2: CLAUDE.md — kontrola kaskády**

Nahraď odstavec `**Na rozdíl od overlap guardu a chain pushe výš, kontrola kaskády NEPLATÍ pro všechny typy.** ...` (celý, končí `...skončí 409 bez jakéhokoli varování napřed.`) za:

```
**Kontrola kaskády pokrývá ZAKAZKA a od etapy 9 i REZERVACE s tiskovými hodinami; ÚDRŽBA se dál tiše přeskakuje.** `detectCalendarDrift` měří `type: { in: ["ZAKAZKA","REZERVACE"] }` (`scheduleBypassed: false`, `printMinutes: { gt: 0 }`, `printCompletedAt: null`, zarovnaný start) — legacy rezervace bez `printMinutes` (backfill je přeskočil, jsou rigidní) a ÚDRŽBA kontrole unikají. U víkendové údržby nebo vypnuté sobotní směny se editace směn neozve — a podle pravidla „Zdí… zůstává" výš se rigidní údržba mimo kalendář stává zdí pro chain push, takže příští drop vedle ní skončí 409 bez varování napřed.
```

- [ ] **Step 3: CLAUDE.md — drift parity odstavec**

V sekci „Drift kalendáře počítají DVĚ nezávislé implementace…" ověř formulace: první odrážka mluví o „NEODLOŽENÝCH bloků" typově neutrálně — doplň na její konec větu:

```
Od etapy 9 obě strany posuzují i REZERVACE s `printMinutes` (klient přes `usesTiskoveHodiny` v `tryExpandForBlock`, server přes where filtr) — parity tabulka má REZERVACE fixtury.
```

- [ ] **Step 4: vyvoj-historie.md**

Připoj na konec souboru:

```markdown

## Rezervace dostaly plné tiskové hodiny — etapa 9 (8/2026)

Rozhodnutí Vojty 19.–20. 8. (spec `docs/superpowers/specs/2026-08-20-rezervace-tiskove-hodiny.md`,
sekce 6 — 9 závazných bodů): `REZERVACE` se láme přes noc „jako zakázka, se vším všudy";
`UDRZBA` zůstává rigidní.

**Jediný zdroj pravdy:** `usesTiskoveHodiny(b)` (`src/lib/printTime.ts`) — ZAKAZKA vždy,
REZERVACE jen s `printMinutes` (legacy bez nich zůstává rigidní, „funguje jako dnes"),
UDRZBA nikdy; `typeUsesTiskoveHodiny(type)` pro nové payloady bez záznamu.

**Fáze:** (0) `syncReservationScheduleForBlocks` — zrcadlo `Reservation.scheduled*` na
6 zápisových cestách (POST/PUT/batch/split/reflow/undo, strážný test
`reservationSyncWiring.test.ts`), oprava dluhu z 3. 8.; (1) backfill
`scripts/backfill-reservation-print-minutes.ts` — inverze `computePrintMinutes`, dry-run
report pro Vojtu, nezarovnané řádky přeskočeny; (2a) server — `validateAndComputeEnd`,
POST (vč. ODSTRANĚNÍ tichého self-shiftu rezervace bez `resolveChain`, rozhodnutí #9),
PUT, batch, chain push s `maxPushMs` = 7 dní pro rezervace (rozhodnutí #1 — dluh P31 se
nekopíruje); (2b) klient — 10 snap/preview/payload míst + `snapGroupPerBlock` dispatch;
(3) drift (`detectCalendarDrift` where `in [ZAKAZKA, REZERVACE]`, kaskáda směn a hromadné
Přepočítat automaticky), pauzy uvnitř bloku, reflow guard, parity testy; (4) reportový
ukazatel „Rezervovaná kapacita" (rozhodnutí #5 — NE do vytížení, vlastní karta).

**Vědomě mimo rozsah:** split rezervace (#7), notifikace obchodníkovi o posunu (#6 — jen
sync `scheduled*`), zahrnutí rezervací do vytížení (#5), Monitor, workflow pole
(potvrzení tisku, expedice, DTP), kosmetická parita délky v `BlockDetail`/`DtpPanel`/
řádku denního reportu (pm-aware label — drobnost k dotažení později).
```

- [ ] **Step 5: Označit Etapu 9 v plánu úprav**

V `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` najdi nadpis sekce Etapa 9 (Run: `grep -n "Etapa 9" docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md`) a doplň do něj ` · **IMPLEMENTACE: `2026-08-20-rezervace-tiskove-hodiny-plan.md` (fáze 0–3 hotové, fáze 4 = reporty následuje)**`.

- [ ] **Step 6: e2e QA fáze 3 (dev)**

1. Uprav směny tak, aby se tisková rezervace rozešla s kalendářem → štítek driftu na kartě rezervace + pruh/počítadlo nad strojem ji započítá + notifikace „N bloků nesedí na kalendář" jmenuje kód rezervace.
2. „Přepočítat" v detailu rezervace → blok se srovná, `Reservation.scheduled*` sedí (fáze 0), Ctrl+Z vrátí blok i značku `scheduleBypassed` a `scheduled*` couvne taky.
3. Hromadné „Přepočítat" nad strojem → rezervace se přepočítá spolu se zakázkami; kaskádový dialog při velkém dopadu.
4. Odložená rezervace (bypass) → kreslí se slitě, server drift ji NEhlásí, karta ukazuje PARKED text.
5. Rezervace expandovaná přes noc → uvnitř bloku pás „⏸ PAUZA — mimo provoz".

- [ ] **Step 7: Celá suite + build + lint + commit**

Run: `npm run build && npm run lint && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: 0 chyb, suite zelená — POČET testů zapiš do commit message (ověřený, ne odhadnutý).

```bash
git add CLAUDE.md docs/vyvoj-historie.md docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md
git commit -m "$(cat <<'EOF'
docs(rezervace): CLAUDE.md a vyvoj-historie po flipu tiskovych hodin

Chain push geometrie, rozsah kaskadove kontroly (nove ZAKAZKA+REZERVACE,
UDRZBA dal preskakovana) a drift parity odstavec prepsany na skutecny
stav po etape 9 (pouceni P19 - komentar nesmi popisovat predetapovy
stav). Zapis do vyvoj-historie vcetne vedome vynechanych casti.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

# FÁZE 4 — Reporty: ukazatel „Rezervovaná kapacita" (Task 17)

**Co dělá:** rozhodnutí #5 — rezervace se NEZAPOČÍTÁVAJÍ do vytížení; vedle vytížení vzniká NOVÝ, odlišený ukazatel „Rezervovaná kapacita" (hodiny + % dostupné kapacity, celkem i per stroj) v záložce Retro `/reporty`.

**Když se nasadí JEN po tuhle fázi:** kompletní etapa 9.

**Akceptace:** karta „Rezervovaná kapacita" v Retro; `utilization`/`productionHours`/`dailyUtilization` čísla NEZMĚNĚNÁ (rezervace do nich nevstupují); vnější `ZAKAZKA` gaty v attention route a outlook segMap nedotčené.

### Task 17: `computeReservedRatio` + dashboard route + RetroView

**Files:**
- Modify: `src/lib/reportMetrics.ts` (za `computeMaintenanceRatio`)
- Modify: `src/lib/reportMetrics.test.ts`
- Modify: `src/app/api/report/dashboard/route.ts` (retro sekce, ř. ~204–260 + response)
- Modify: `src/app/reporty/_components/reportShared.tsx` (`RetroMachineData`, `RetroData`)
- Modify: `src/app/reporty/_components/RetroView.tsx` (řada KPI karet)

**Interfaces:**
- Consumes: `usesTiskoveHodiny` (Task 4), `blockReportSegments`/`printOverlapMinutes` (broadené Taskem 13), `KpiCard` vzor, tokeny `reportTypeScale`/`reportRadius`/`reportSpace` (CLAUDE.md konvence — žádný holý fontSize, žádný hex literál; karta používá jen `--text`/`--text-muted`/`--surface`/`--border`, žádný nový barevný token → kontrastní měření není potřeba).
- Produces:
  ```typescript
  export function computeReservedRatio(reservedHours: number, availableHours: number): number | null;
  // RetroMachineData: + reservedHours: number; + reservedRatio: number | null;
  // RetroData: + reservedRatio: number | null;
  ```

- [ ] **Step 1: Failing test metriky**

Do `src/lib/reportMetrics.test.ts`:

```typescript
test("computeReservedRatio — % rezervované kapacity, null při nulové dostupnosti", () => {
  assert.equal(computeReservedRatio(20, 100), 20);
  assert.equal(computeReservedRatio(0, 100), 0);
  assert.equal(computeReservedRatio(10, 0), null);
  assert.equal(computeReservedRatio(150, 100), 150, "nad 100 % se nezastropuje — přebukování musí být vidět");
});
```

(Import `computeReservedRatio` přidej k stávajícímu importu z `./reportMetrics`.)

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — funkce neexistuje.

- [ ] **Step 2: Implementace metriky**

Do `reportMetrics.ts` za `computeMaintenanceRatio`:

```typescript
/**
 * Procento REZERVOVANÉ kapacity z dostupných hodin — VLASTNÍ ukazatel vedle
 * vytížení (rozhodnutí #5 etapy 9: rezervace se do vytížení NEmíchají — držená
 * kapacita není odvedená práce; tiché sečtení do jednoho čísla je třída P22).
 * `null` při nulové kapacitě, nad 100 % se nezastropuje — viz computeUtilization.
 */
export function computeReservedRatio(reservedHours: number, availableHours: number): number | null {
  if (availableHours <= 0) return null;
  return Math.round((reservedHours / availableHours) * 100);
}
```

Run: `node --test --import tsx src/lib/reportMetrics.test.ts` → PASS.

- [ ] **Step 3: Dashboard route**

Do importů route přidej `computeReservedRatio` (rozšíření importu z `@/lib/reportMetrics`) a `usesTiskoveHodiny` (z `@/lib/printTime`).

1. Retro `segMap` (ř. ~206) nahraď:

```typescript
    segMap.set(b, b.type === "ZAKAZKA" ? blockReportSegments(b, weekShifts, companyDays) : null);
```

za:

```typescript
    // ZAKAZKA (vytížení) + REZERVACE s pm (NOVÝ ukazatel rezervované kapacity, etapa 9
    // rozhodnutí #5). Sumy níž filtrují per typ, takže vytížení se tím NEMĚNÍ; legacy
    // rezervace (pm null) → null → konzervativní fallback celého spanu.
    segMap.set(b, usesTiskoveHodiny(b) ? blockReportSegments(b, weekShifts, companyDays) : null);
```

2. Typ `machines` (ř. ~212) rozšiř o `reservedHours: number; reservedRatio: number | null;`:

```typescript
  const machines: Record<string, { utilization: number | null; productionHours: number; maintenanceHours: number; availableHours: number; maintenanceRatio: number | null; reservedHours: number; reservedRatio: number | null; cascade: CalendarCascade }> = {};
```

3. Za `const maintenanceHours = sumClipped("UDRZBA");` přidej:

```typescript
    // Rezervovaná kapacita — VEDLE vytížení, nikdy uvnitř něj (rozhodnutí #5).
    const reservedHours = sumClipped("REZERVACE");
```

4. Do objektu `machines[machine] = { ... }` přidej za `maintenanceRatio: ...`:

```typescript
      reservedHours: round1(reservedHours),
      reservedRatio: computeReservedRatio(reservedHours, availableHours),
```

5. Za `totalMaintenance += maintenanceHours;` přidej `totalReserved += reservedHours;` a k deklaracím `let totalAvailable = 0; let totalMaintenance = 0;` přidej `let totalReserved = 0;`.

6. Najdi v response payloadu retro větve místo, kde se vrací `maintenanceRatio` (Run: `grep -n "maintenanceRatio: computeMaintenanceRatio" src/app/api/report/dashboard/route.ts`) a hned vedle přidej:

```typescript
    reservedRatio: computeReservedRatio(totalReserved, totalAvailable),
```

- [ ] **Step 4: Typy + UI**

`reportShared.tsx` — do `RetroMachineData` za `maintenanceRatio`:

```typescript
  /** Rezervovaná kapacita stroje v hodinách (ořez oknem jako produkce) — etapa 9, rozhodnutí #5. */
  reservedHours: number;
  /** % rezervované kapacity z dostupných hodin JEN tohoto stroje; null při nulové kapacitě. */
  reservedRatio: number | null;
```

a do `RetroData` za `maintenanceRatio: number | null;`:

```typescript
  /** Rezervovaná kapacita přes oba stroje — VLASTNÍ ukazatel vedle vytížení, ne jeho součást. */
  reservedRatio: number | null;
```

`RetroView.tsx` — do řady karet VÝROBA (za kartu „Údržba ratio", uvnitř téhož flex kontejneru) přidej čtvrtou kartu podle vzoru Údržba ratio (stejný vnitřek jako `KpiCard` — `md` svisle, `lg` vodorovně):

```tsx
        {/* Rezervovaná kapacita — VLASTNÍ ukazatel vedle vytížení (etapa 9, rozhodnutí #5):
            držená kapacita není odvedená práce, do utilization se NEZAPOČÍTÁVÁ. Neutrální
            barvy (--text) záměrně — pro rezervace neexistují dobrá/špatná pásma jako u vytížení. */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: `${reportSpace.md}px ${reportSpace.lg}px`, flex: "1 1 0" }}>
          <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 4 }}>Rezervovaná kapacita</div>
          <div style={{ fontSize: reportTypeScale.display, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
            {data.reservedRatio == null ? "—" : `${data.reservedRatio}%`}
          </div>
          <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2 }}>rezervace / dostupné hodiny (mimo vytížení)</div>
          <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
            {machineLabel("XL_105")}: {xl105?.reservedRatio == null ? "—" : `${xl105.reservedRatio}%`} ({cz(xl105?.reservedHours ?? 0)} h)
            {" · "}
            {machineLabel("XL_106")}: {xl106?.reservedRatio == null ? "—" : `${xl106.reservedRatio}%`} ({cz(xl106?.reservedHours ?? 0)} h)
          </div>
        </div>
```

- [ ] **Step 5: Ověřit nedotčené gaty (rozhodnutí #5)**

Run: `grep -rn 'b.type === "ZAKAZKA" ? blockReportSegments' src/app`
Expected: PŘESNĚ 2 výskyty — `src/app/api/report/attention/route.ts:103` a `src/app/api/report/dashboard/route.ts` (outlook větev, dnešní ř. 434). Retro větev už je přepnutá; JINÉ se nemění.

- [ ] **Step 6: Build + suite + QA + commit**

Run: `npm run build && npm run lint && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: 0 chyb, suite zelená.

QA na dev: `/reporty` záložka Retro — karta „Rezervovaná kapacita" ukazuje % + per-machine rozpad; s obdobím bez rezervací ukazuje 0 % / „—" při nulové kapacitě; hodnoty „Vytížení XL 105/106" se proti stavu před taskem NEZMĚNILY (ověř na stejném období vedle sebe — screenshot před/po). Zkontroluj light i dark mode.

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts src/app/api/report/dashboard/route.ts src/app/reporty/_components/reportShared.tsx src/app/reporty/_components/RetroView.tsx
git commit -m "$(cat <<'EOF'
feat(rezervace): reportovy ukazatel Rezervovana kapacita vedle vytizeni

Rozhodnuti #5 etapy 9: rezervace se do vytizeni NEZAPOCITAVAJI (drzena
kapacita neni odvedena prace, trida P22) - misto toho vlastni karta v
Retro: % + hodiny celkem i per stroj (computeReservedRatio, null pri
nulove kapacite, nezastropovano). Retro segMap pousti pres
usesTiskoveHodiny i rezervace (sumy filtruji per typ - utilization
nezmenene), attention a outlook gaty ZAKAZKA zustavaji (overeno grepem).
Neutralni barvy pres tokeny, zadny novy barevny token.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (provedeno při psaní plánu)

**1. Spec coverage — mapování sekce specu → task:**

| Sekce specu | Task(y) | Pozn. |
|---|---|---|
| §2 prerekvizita sync `scheduled*` (6 cest + strážný test) | Task 1, 2 | `actor` param vynechán — rozhodnutí #6 zrušilo notifikace; zdůvodněno v Global Constraints |
| §2 notifikace `RESERVATION_RESCHEDULED` | — | rozhodnutí #6: ZATÍM NE; helper vrací changed ids jako budoucí háček |
| §3 backfill (inverze, zarovnání, dry-run, Vojtovo review, mysqldump) | Task 3 | + doplněna kontrola zarovnání ENDU (spec jmenoval jen start; `computePrintMinutes` hází na obojí — printTime.ts:124–129) |
| §4.1 validace | Task 5 | |
| §4.2 POST (derivace, zápis, self-shift #9, race-recovery) | Task 7 | |
| §4.3 PUT (větvení, pravidlo 3, přechody typů) | Task 8 | |
| §4.4 batch (filtr + klientská strana) | Task 9 (server), 10+12 (klient) | |
| §4.5 split beze změny (ZAKAZKA-only) | — + Task 2 (sync i tak zapojen kvůli reservationId na překlopených blocích), Task 13 (printMidpoint regresní test) | rozhodnutí #7 |
| §4.6 chain push geometrie + strop (#1) + MIN_PRINT_SEGMENT jev | Task 6 | strop implementován přes `maxPushMs` dle doporučení specu |
| §4.7 deset klientských míst + `usesTiskoveHodiny` helper + blockEditDuration + kolize s etapou 3 | Task 4 (helper), 10 (místo #9 = snapGroupPerBlock, už existuje — etapa 3 HOTOVÁ, re-ověřeno nad finálním kódem), 11, 12 | helper umístěn v `printTime.ts` místo `printTimeClient.ts` — zdůvodněno v Tasku 4 (server ho potřebuje taky) |
| §4.8 kreslení pauz + reporty (P6/P17 past `blockReportSegments`) | Task 13 (guard + vnější gaty nedotčené), Task 17 Step 5 (grep pojistka) | + pojmenován negatovaný volající `report/daily/ReportView.tsx:180` (spec ho nejmenoval) |
| §4.9 drift + parita + CLAUDE.md + notifikace | Task 14, 16 | strukturální typ `PrismaClientLike` SE MĚNÍ (spec tvrdil opak — ověřeno proti HEAD, kde je literál `type: string`) |
| §4.10 reflow | Task 15 | `NOT_ZAKAZKA` string ponechán dle specu |
| §4.11 undo (mechanismus OK, sync chybí, CREATE/DELETE guard zůstává) | Task 2 (sync), Task 16 QA (e2e) | rozhodnutí #4 |
| §5 (A) inventura 13 řádků | Tasky 5–12 (1:1 — viz Files jednotlivých tasků) | `useJobBuilder.ts:463` zařazen do (A) dle pozn. specu → Task 11 |
| §5 (B) neměnit | žádný task se jich nedotýká; `BlockDetail`/`DtpPanel`/BlockRow label = kosmetika vědomě mimo (zapsáno ve vyvoj-historie, Task 16) | |
| §6 rozhodnutí 1–9 | 1→Task 6; 2→Task 5; 3→Task 14; 4→Task 16 QA; 5→Task 17; 6→Global Constraints+Task 1; 7→Task 13 (printMidpoint test); 8→Task 3; 9→Task 7 | |
| §7 rizika (etapa 6 podmínka, kolize s etapou 3, backfill retroaktivita, MIN_SEGMENT jev, COUNT na produkci, P17 strážný test oboru hodnot) | Global Constraints (CASCADE_CONFIRM_ENFORCED), etapa 3 hotová (re-ověřeno), Task 3 (dry-run+COUNT), Task 6 (commit message jmenuje jev), Task 4 (tabulkový test) | „řízená reflow vlna po nasazení" ze §7 = hromadné „Přepočítat" per stroj (Task 15/16 QA) — vědomě ponecháno jako ruční krok plánovače, ne automatika |
| §8 fázování | fáze 0→1→2a→2b→3→4 (jemnější než spec — 2 rozděleno na server/klient kvůli samostatné nasaditelnosti) | |

**2. Placeholder scan:** žádné TBD/TODO/„doplň později"; jediné podmíněné kroky jsou ověřovací grep-y s přesným očekáváním (jména helperů v cizích test souborech — `mkBlock` v `blockPayload.test.ts`, formát `expected` v parity tabulce), vždy s instrukcí „drž formát existujícího souboru", což je kontrola reality, ne placeholder.

**3. Typová konzistence:** `usesTiskoveHodiny(b: { type: string; printMinutes?: number | null })` a `typeUsesTiskoveHodiny(type: string)` definované v Tasku 4 a konzumované identickými signaturami v Tascích 5–17; `syncReservationScheduleForBlocks(tx, blockIds): Promise<number[]>` (Task 1) volaná v Tasku 2 vždy s `number[]`; `maxPushMs?: number` na `BlockInterval` = návratový tvar `chainPushGeometry` (spread `...chainPushGeometry(r)` v `others` mapování zůstává kompatibilní); `reservedHours: number`/`reservedRatio: number | null` shodně v route, `RetroMachineData` i `RetroView`. `computeReservedRatio` jméno konzistentní ve všech třech souborech Tasku 17.

**Známé nejasnosti k potvrzení Vojtou (neblokují start fáze 0–1):** viz závěr zprávy autora plánu (deviace: `actor` param syncu vynechán; helper v `printTime.ts`; MISMATCH řádky backfillu dostávají `scheduleBypassed = true` bez úpravy endu — end srovná až první „Přepočítat"/dotyk).
