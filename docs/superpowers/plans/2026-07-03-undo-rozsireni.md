# Rozšíření undo/redo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vytáhnout klientské undo/redo z `PlannerPage.tsx` do testovatelného modulu, migrovat 4 existující akce beze změny chování a přidat undo pro editaci formulářem, DTP/MTZ pole a create/paste/queue-drop — se souběh-guardem přes `updatedAt` a viditelným tlačítkem.

**Architecture:** Nový modul `src/lib/undo/` s čistými command buildery (`buildMoveCommand`, `buildEditCommand`, `buildCreateCommand`, `buildDeleteCommand`) volanými přes injektované `UndoEffects` rozhraní → testovatelné bez Reactu a DB. Tenký hook `useUndoManager` drží stacky + `canUndo`/`canRedo` a spouští entry. `PlannerPage` dodá reálné effects (fetch + setBlocks) a nahradí inline record-sites voláním `record(buildXxx(...))`. Strangler migrace: nejdřív modul + testy, pak migrace stávajících akcí za zelených testů, teprve pak nové akce a tlačítko.

**Tech Stack:** Next.js 16, React, TypeScript, `node --test --import tsx` (test runner projektu).

## Global Constraints

- Odpovídat/komentovat kód lze česky; odborné termíny anglicky. Kód drží styl okolí.
- Chybové stavy v API cestách: `AppError` + `isAppError` (`src/lib/errors.ts`). Tento plán ale **nepřidává žádnou API cestu** — pracuje jen s existujícími `/api/blocks`, `/api/blocks/[id]`, `/api/blocks/batch`.
- Logování na serveru: `logger`, ne `console`. (Klientský kód smí `console.error` jako dnes.)
- Nové UI komponenty patří do `src/components/` jako named export, ne inline do `PlannerPage`.
- Mouse handlery: `if (e.button !== 0) return;` — netýká se tohoto plánu (žádné nové mouse handlery).
- Klientský typ `Block`: `import type { Block } from "@/app/_components/TimelineGrid"` (export na `TimelineGrid.tsx:78`).
- Path alias: `@/*` → `./src/*`.
- Žádná DB migrace, žádný nový sloupec, žádný serverový undo-log (viz spec non-goals).
- Split, série, mazání série/split/rezervací, potvrzení tisku, reflow — **mimo rozsah**.
- Testy spouštět: `node --test --import tsx src/lib/undo/commands.test.ts` a `... useUndoManager.test.ts`. Celá suite musí zůstat zelená.
- Commity časté, jeden per task. Pracovat jen na větvi `Vojta`.

---

## Přehled souborů

- Create: `src/lib/undo/types.ts` — `Block` re-export, `BlockSnapshot`, `EditSnapshot`, `UndoEffects`, `HistoryEntry`, `StaleUndoError`.
- Create: `src/lib/undo/commands.ts` — 4 buildery.
- Create: `src/lib/undo/commands.test.ts` — unit testy builderů.
- Create: `src/app/_components/useUndoManager.ts` — hook.
- Create: `src/app/_components/useUndoManager.test.ts` — testy manageru (přes fake entry).
- Create: `src/components/UndoRedoButtons.tsx` — tlačítka.
- Modify: `src/app/_components/PlannerPage.tsx` — effects, nahrazení record-sites, keyboard, render tlačítka.

---

## ETAPA 1 — Modul + testy (bez zapojení do UI)

### Task 1: Typy a `StaleUndoError`

**Files:**
- Create: `src/lib/undo/types.ts`
- Test: (žádný — jen typy a triviální třída; pokryto v Tasku 2)

**Interfaces:**
- Produces: `BlockSnapshot`, `EditSnapshot`, `UndoEffects`, `HistoryEntry`, `StaleUndoError`.

- [ ] **Step 1: Vytvořit `src/lib/undo/types.ts`**

```ts
import type { Block } from "@/app/_components/TimelineGrid";

export type { Block };

/** Poziční snapshot bloku pro move/undo. `updatedAt` slouží jako verze pro souběh-guard. */
export type BlockSnapshot = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  updatedAt: string;
};

/** Snapshot editovaných polí bloku pro edit/undo (before i after). */
export type EditSnapshot = {
  id: number;
  updatedAt: string;
  /** Pole, která undo/redo pošle na PUT (klíč → hodnota). Jen editovaná pole. */
  fields: Record<string, unknown>;
};

/** Injektované vedlejší efekty. Reálná implementace žije v PlannerPage; v testech se podstrčí fake. */
export interface UndoEffects {
  putBlock(id: number, body: Record<string, unknown>): Promise<Block & { shifted?: Block[] }>;
  postBlock(body: Record<string, unknown>): Promise<Block>;
  deleteBlock(id: number): Promise<void>;
  batchUpdate(
    updates: Array<{ id: number; startTime: string; endTime: string; machine: string; expectedUpdatedAt?: string }>,
  ): Promise<Block[]>;
  /** Upsert bloků do stavu (merge podle id). */
  addToState(blocks: Block[]): void;
  /** Odebrat bloky ze stavu. */
  removeFromState(ids: number[]): void;
  /** Živý blok ze stavu (blocksRef.current) — pro souběh-guard. */
  getLiveBlock(id: number): Block | undefined;
}

export interface HistoryEntry {
  /** Krátký popis pro toast / tooltip tlačítka. */
  label: string;
  undo(effects: UndoEffects): Promise<void>;
  redo(effects: UndoEffects): Promise<void>;
}

/** Hodí builder, když živý blok neodpovídá snapshotu (někdo ho mezitím změnil). */
export class StaleUndoError extends Error {
  constructor(message = "Blok byl mezitím změněn") {
    super(message);
    this.name = "StaleUndoError";
  }
}
```

- [ ] **Step 2: Ověřit typovou správnost**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "src/lib/undo/types.ts" || echo "OK types"`
Expected: `OK types` (žádná chyba v novém souboru)

- [ ] **Step 3: Commit**

```bash
git add src/lib/undo/types.ts
git commit -m "feat(undo): typy pro modul undo (BlockSnapshot, UndoEffects, HistoryEntry)"
```

---

### Task 2: `buildMoveCommand` (drag / resize / lasso)

Poziční přesun jednoho i více bloků + odsunutí sousedé. Undo/redo přes `batchUpdate`
(stejná cesta jako dnešní inline undo — `bypassOverlapCheck` je zajištěné v reálné effects
implementaci). Souběh-guard: `updatedAt` každého dotčeného bloku. Snapshoty jsou **mutable** —
po každém apply se `updatedAt` osvěží z odpovědi serveru, aby další guard seděl.

**Files:**
- Create: `src/lib/undo/commands.ts`
- Test: `src/lib/undo/commands.test.ts`

**Interfaces:**
- Consumes: `BlockSnapshot`, `UndoEffects`, `HistoryEntry`, `StaleUndoError` z `./types`.
- Produces: `buildMoveCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry`.

- [ ] **Step 1: Napsat padající test — `src/lib/undo/commands.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMoveCommand } from "./commands.ts";
import { StaleUndoError, type Block, type UndoEffects } from "./types.ts";

function blk(id: number, over: Partial<Block> = {}): Block {
  return {
    id, orderNumber: "X", machine: "XL_105", startTime: "2026-07-10T08:00:00.000Z",
    endTime: "2026-07-10T09:00:00.000Z", type: "ZAKAZKA", jobPresetId: null, jobPresetLabel: null,
    description: null, locked: false, deadlineExpedice: null, expediceNote: null, doprava: null,
    expeditionPublishedAt: null, expeditionSortOrder: null, dataStatusId: null, dataStatusLabel: null,
    dataRequiredDate: null, dataOk: false, materialStatusId: null, materialStatusLabel: null,
    materialRequiredDate: null, materialOk: false, materialInStock: false, materialIssued: false,
    pantoneRequiredDate: null, pantoneOk: false, pantoneRequired: false, barvyStatusId: null,
    barvyStatusLabel: null, lakStatusId: null, lakStatusLabel: null, specifikace: null,
    materialNote: null, materialNoteByUsername: null, recurrenceType: "NONE", recurrenceParentId: null,
    splitGroupId: null, printCompletedAt: null, printCompletedByUserId: null,
    printCompletedByUsername: null, reservationId: null, reservationConfirmedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "v1", ...over,
  } as Block;
}

/** Fake effects: drží živé bloky v mapě, batchUpdate posune a bumpne updatedAt. */
function makeEffects(live: Map<number, Block>) {
  const calls = { batch: [] as unknown[][], added: [] as Block[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    batchUpdate: async (updates) => {
      calls.batch.push(updates);
      const res = updates.map((u) => {
        const cur = live.get(u.id)!;
        const next = { ...cur, startTime: u.startTime, endTime: u.endTime, machine: u.machine, updatedAt: cur.updatedAt + "+" };
        live.set(u.id, next);
        return next;
      });
      return res;
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: () => {},
    putBlock: async () => { throw new Error("unused"); },
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildMoveCommand: undo přesune blok zpět na 'before' pozici", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })]]);
  const { effects, calls } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await cmd.undo(effects);
  assert.equal(calls.batch.length, 1);
  assert.equal((calls.batch[0][0] as { startTime: string }).startTime, "2026-07-10T08:00:00.000Z");
  assert.equal(live.get(1)!.startTime, "2026-07-10T08:00:00.000Z");
});

test("buildMoveCommand: guard hodí StaleUndoError, když updatedAt neodpovídá", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "CIZI" })]]);
  const { effects } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildMoveCommand: undo→redo funguje po osvěžení updatedAt (guard nepadne)", async () => {
  const live = new Map([[1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })]]);
  const { effects } = makeEffects(live);
  const before = [{ id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" }];
  const after  = [{ id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" }];
  const cmd = buildMoveCommand("Přesun", before, after);
  await cmd.undo(effects);            // live.updatedAt -> "v2+"
  await cmd.redo(effects);            // guard porovná před redo 'before' proti live -> osvěžené sedí
  assert.equal(live.get(1)!.startTime, "2026-07-10T10:00:00.000Z");
});
```

- [ ] **Step 2: Spustit test — musí padnout (soubor `commands.ts` neexistuje)**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: FAIL — `Cannot find module './commands.ts'`

- [ ] **Step 3: Implementovat `buildMoveCommand` v `src/lib/undo/commands.ts`**

```ts
import { StaleUndoError, type BlockSnapshot, type HistoryEntry, type UndoEffects } from "./types";

function guard(effects: UndoEffects, expected: BlockSnapshot[]): void {
  for (const s of expected) {
    const live = effects.getLiveBlock(s.id);
    if (!live || live.updatedAt !== s.updatedAt) throw new StaleUndoError();
  }
}

/**
 * Poziční přesun (drag / resize / lasso) + odsunutí sousedé. undo/redo přes batchUpdate.
 * before/after jsou mutable: po každém apply se jejich updatedAt osvěží z odpovědi serveru,
 * aby další guard/expectedUpdatedAt seděl.
 */
export function buildMoveCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry {
  const apply = async (effects: UndoEffects, target: BlockSnapshot[], expected: BlockSnapshot[]) => {
    guard(effects, expected);
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.batchUpdate(
      target.map((t) => ({
        id: t.id, startTime: t.startTime, endTime: t.endTime, machine: t.machine,
        expectedUpdatedAt: expMap.get(t.id),
      })),
    );
    const resMap = new Map(res.map((b) => [b.id, b.updatedAt]));
    for (const t of target) { const u = resMap.get(t.id); if (u) t.updatedAt = u; }
    effects.addToState(res);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after),
    redo: (effects) => apply(effects, after, before),
  };
}
```

- [ ] **Step 4: Spustit test — musí projít**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: PASS (3 testy)

- [ ] **Step 5: Commit**

```bash
git add src/lib/undo/commands.ts src/lib/undo/commands.test.ts
git commit -m "feat(undo): buildMoveCommand + testy (poziční undo přes batch)"
```

---

### Task 3: `buildEditCommand` (editace polí + odsunutí sousedé)

Editace bloku formulářem nebo single-field DTP/MTZ. undo/redo přes PUT `/api/blocks/[id]`
(datová pole), plus obnova odsunutých sousedů přes `batchUpdate`. Souběh-guard přes `updatedAt`
primárního bloku (osvěžuje se z PUT odpovědi).

**Files:**
- Modify: `src/lib/undo/commands.ts`
- Test: `src/lib/undo/commands.test.ts`

**Interfaces:**
- Consumes: `EditSnapshot`, `BlockSnapshot`, `UndoEffects`, `HistoryEntry` z `./types`.
- Produces: `buildEditCommand(label: string, before: EditSnapshot, after: EditSnapshot, shiftedBefore?: BlockSnapshot[], shiftedAfter?: BlockSnapshot[]): HistoryEntry`.

- [ ] **Step 1: Přidat padající testy do `commands.test.ts`**

```ts
import { buildEditCommand } from "./commands.ts";
import type { EditSnapshot } from "./types.ts";

/** Rozšíření fake effects o putBlock (osvěží updatedAt a vrátí volitelně shifted). */
function makeEditEffects(live: Map<number, Block>) {
  const calls = { put: [] as Array<{ id: number; body: Record<string, unknown> }>, batch: [] as unknown[][], added: [] as Block[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    putBlock: async (id, body) => {
      calls.put.push({ id, body });
      const cur = live.get(id)!;
      const next = { ...cur, ...body, updatedAt: cur.updatedAt + "+" } as Block;
      live.set(id, next);
      return next;
    },
    batchUpdate: async (updates) => {
      calls.batch.push(updates);
      return updates.map((u) => {
        const cur = live.get(u.id)!;
        const n = { ...cur, startTime: u.startTime, endTime: u.endTime, machine: u.machine, updatedAt: cur.updatedAt + "+" };
        live.set(u.id, n); return n;
      });
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: () => {},
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildEditCommand: undo pošle PUT se starými hodnotami polí", async () => {
  const live = new Map([[1, blk(1, { description: "NEW", updatedAt: "v2" })]]);
  const { effects, calls } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await cmd.undo(effects);
  assert.equal(calls.put.length, 1);
  assert.equal(calls.put[0].body.description, "OLD");
  assert.equal(live.get(1)!.description, "OLD");
});

test("buildEditCommand: guard hodí StaleUndoError při neshodě updatedAt", async () => {
  const live = new Map([[1, blk(1, { updatedAt: "CIZI" })]]);
  const { effects } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const cmd = buildEditCommand("Editace", before, after);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildEditCommand: obnoví i odsunuté sousedy přes batch", async () => {
  const live = new Map([
    [1, blk(1, { description: "NEW", updatedAt: "v2" })],
    [2, blk(2, { startTime: "2026-07-10T11:00:00.000Z", updatedAt: "s2" })],
  ]);
  const { effects, calls } = makeEditEffects(live);
  const before: EditSnapshot = { id: 1, updatedAt: "v1", fields: { description: "OLD" } };
  const after:  EditSnapshot = { id: 1, updatedAt: "v2", fields: { description: "NEW" } };
  const shiftedBefore = [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "s2" }];
  const shiftedAfter  = [{ id: 2, startTime: "2026-07-10T11:00:00.000Z", endTime: "2026-07-10T12:00:00.000Z", machine: "XL_105", updatedAt: "s2" }];
  const cmd = buildEditCommand("Editace", before, after, shiftedBefore, shiftedAfter);
  await cmd.undo(effects);
  assert.equal(calls.batch.length, 1);
  assert.equal((calls.batch[0][0] as { startTime: string }).startTime, "2026-07-10T09:00:00.000Z");
});
```

- [ ] **Step 2: Spustit — nové testy padají (`buildEditCommand` neexistuje)**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: FAIL — `buildEditCommand is not a function` / import error

- [ ] **Step 3: Přidat `buildEditCommand` do `commands.ts`**

```ts
import { StaleUndoError, type BlockSnapshot, type EditSnapshot, type HistoryEntry, type UndoEffects } from "./types";

/**
 * Editace polí primárního bloku (PUT) + volitelná obnova odsunutých sousedů (batch).
 * before/after nesou editovaná pole; shiftedBefore/After pozice sousedů. Mutable updatedAt.
 */
export function buildEditCommand(
  label: string,
  before: EditSnapshot,
  after: EditSnapshot,
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry {
  const apply = async (
    effects: UndoEffects,
    target: EditSnapshot,
    expected: EditSnapshot,
    shiftedTarget: BlockSnapshot[],
    shiftedExpected: BlockSnapshot[],
  ) => {
    const live = effects.getLiveBlock(target.id);
    if (!live || live.updatedAt !== expected.updatedAt) throw new StaleUndoError();
    const updated = await effects.putBlock(target.id, { ...target.fields, resolveChain: true });
    target.updatedAt = updated.updatedAt;
    effects.addToState([{ ...updated }]);
    if (shiftedTarget.length > 0) {
      const expMap = new Map(shiftedExpected.map((e) => [e.id, e.updatedAt]));
      const res = await effects.batchUpdate(
        shiftedTarget.map((t) => ({
          id: t.id, startTime: t.startTime, endTime: t.endTime, machine: t.machine,
          expectedUpdatedAt: expMap.get(t.id),
        })),
      );
      const resMap = new Map(res.map((b) => [b.id, b.updatedAt]));
      for (const t of shiftedTarget) { const u = resMap.get(t.id); if (u) t.updatedAt = u; }
      effects.addToState(res);
    }
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, shiftedBefore, shiftedAfter),
    redo: (effects) => apply(effects, after, before, shiftedAfter, shiftedBefore),
  };
}
```

> Pozn.: `putBlock` odpověď může nést `shifted` z re-expanze při undo (změna délky). Osvěžení
> pozic re-odsunutých sousedů necháváme na SSE / stávajícím `handleBlockUpdate`; `shiftedBefore`/
> `After` slouží k obnově sousedů, které odsunul PŮVODNÍ edit. To odpovídá dnešnímu vzoru move-undo.

- [ ] **Step 4: Spustit — vše zelené**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: PASS (6 testů celkem)

- [ ] **Step 5: Commit**

```bash
git add src/lib/undo/commands.ts src/lib/undo/commands.test.ts
git commit -m "feat(undo): buildEditCommand + testy (edit polí přes PUT + shifted batch)"
```

---

### Task 4: `buildCreateCommand` (paste / group paste / queue-drop)

undo = smazat vytvořené bloky; redo = re-POST payloadů → nová id → **remap** pro další cyklus.
Souběh-guard u undo: blok stále existuje a `updatedAt` nezměněn.

**Files:**
- Modify: `src/lib/undo/commands.ts`
- Test: `src/lib/undo/commands.test.ts`

**Interfaces:**
- Produces: `buildCreateCommand(label: string, created: Array<{ id: number; updatedAt: string; payload: Record<string, unknown> }>): HistoryEntry`.

- [ ] **Step 1: Přidat padající testy**

```ts
import { buildCreateCommand } from "./commands.ts";

function makeCreateEffects(live: Map<number, Block>, nextId = { v: 100 }) {
  const calls = { deleted: [] as number[], posted: [] as Record<string, unknown>[], added: [] as Block[][], removed: [] as number[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    deleteBlock: async (id) => { calls.deleted.push(id); live.delete(id); },
    postBlock: async (body) => {
      calls.posted.push(body);
      const id = nextId.v++;
      const b = blk(id, { updatedAt: "n1" });
      live.set(id, b); return b;
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: (ids) => { calls.removed.push(ids); },
    batchUpdate: async () => { throw new Error("unused"); },
    putBlock: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildCreateCommand: undo smaže vytvořený blok", async () => {
  const live = new Map([[100, blk(100, { updatedAt: "n1" })]]);
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildCreateCommand("Vložení", [{ id: 100, updatedAt: "n1", payload: { orderNumber: "X" } }]);
  await cmd.undo(effects);
  assert.deepEqual(calls.deleted, [100]);
  assert.deepEqual(calls.removed, [[100]]);
});

test("buildCreateCommand: undo hodí StaleUndoError, když byl blok mezitím změněn", async () => {
  const live = new Map([[100, blk(100, { updatedAt: "CIZI" })]]);
  const { effects } = makeCreateEffects(live);
  const cmd = buildCreateCommand("Vložení", [{ id: 100, updatedAt: "n1", payload: { orderNumber: "X" } }]);
  await assert.rejects(() => cmd.undo(effects), StaleUndoError);
});

test("buildCreateCommand: redo re-POSTne a remapne id pro další undo", async () => {
  const live = new Map([[100, blk(100, { updatedAt: "n1" })]]);
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildCreateCommand("Vložení", [{ id: 100, updatedAt: "n1", payload: { orderNumber: "X" } }]);
  await cmd.undo(effects);            // smaže 100
  await cmd.redo(effects);            // re-POST -> nové id 100? (nextId=100)
  // po redo musí jít znovu undo bez chyby (id byl remapnut na nově vytvořený)
  await cmd.undo(effects);
  assert.equal(calls.posted.length, 1);
  assert.equal(calls.deleted.length, 2);
});
```

- [ ] **Step 2: Spustit — padá**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: FAIL — `buildCreateCommand is not a function`

- [ ] **Step 3: Přidat `buildCreateCommand`**

```ts
type CreatedRef = { id: number; updatedAt: string; payload: Record<string, unknown> };

/** undo = DELETE vytvořených bloků; redo = re-POST (nová id → remap). */
export function buildCreateCommand(label: string, created: CreatedRef[]): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      for (const c of created) {
        const live = effects.getLiveBlock(c.id);
        if (!live || live.updatedAt !== c.updatedAt) throw new StaleUndoError();
      }
      for (const c of created) await effects.deleteBlock(c.id);
      effects.removeFromState(created.map((c) => c.id));
    },
    redo: async (effects) => {
      const recreated: import("./types").Block[] = [];
      for (const c of created) {
        const b = await effects.postBlock(c.payload);
        c.id = b.id;            // remap pro další undo
        c.updatedAt = b.updatedAt;
        recreated.push(b);
      }
      effects.addToState(recreated);
    },
  };
}
```

- [ ] **Step 4: Spustit — zelené**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: PASS (9 testů)

- [ ] **Step 5: Commit**

```bash
git add src/lib/undo/commands.ts src/lib/undo/commands.test.ts
git commit -m "feat(undo): buildCreateCommand + testy (undo=delete, redo=repost+remap)"
```

---

### Task 5: `buildDeleteCommand` (mazání single + multi)

undo = re-POST payloadů → nová id → remap; redo = DELETE. Zrcadlo `buildCreateCommand`.
Bez souběh-guardu (recreate nemá co porovnávat).

**Files:**
- Modify: `src/lib/undo/commands.ts`
- Test: `src/lib/undo/commands.test.ts`

**Interfaces:**
- Produces: `buildDeleteCommand(label: string, deleted: Array<{ payload: Record<string, unknown> }>): HistoryEntry`.

- [ ] **Step 1: Přidat padající testy**

```ts
import { buildDeleteCommand } from "./commands.ts";

test("buildDeleteCommand: undo re-POSTne smazané bloky", async () => {
  const live = new Map<number, Block>();
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildDeleteCommand("Smazání", [{ payload: { orderNumber: "A" } }, { payload: { orderNumber: "B" } }]);
  await cmd.undo(effects);
  assert.equal(calls.posted.length, 2);
  assert.equal(calls.added.length, 1);
  assert.equal(calls.added[0].length, 2);
});

test("buildDeleteCommand: redo znovu smaže obnovené bloky", async () => {
  const live = new Map<number, Block>();
  const { effects, calls } = makeCreateEffects(live);
  const cmd = buildDeleteCommand("Smazání", [{ payload: { orderNumber: "A" } }]);
  await cmd.undo(effects);            // re-POST -> id 100
  await cmd.redo(effects);            // DELETE 100
  assert.deepEqual(calls.deleted, [100]);
});
```

- [ ] **Step 2: Spustit — padá**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: FAIL — `buildDeleteCommand is not a function`

- [ ] **Step 3: Přidat `buildDeleteCommand`**

```ts
type DeletedRef = { payload: Record<string, unknown>; restoredId?: number };

/** undo = re-POST smazaných (nová id → remap); redo = DELETE obnovených. */
export function buildDeleteCommand(label: string, deleted: DeletedRef[]): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      const recreated: import("./types").Block[] = [];
      for (const d of deleted) {
        const b = await effects.postBlock(d.payload);
        d.restoredId = b.id;
        recreated.push(b);
      }
      effects.addToState(recreated);
    },
    redo: async (effects) => {
      const ids = deleted.map((d) => d.restoredId).filter((id): id is number => typeof id === "number");
      for (const id of ids) await effects.deleteBlock(id);
      effects.removeFromState(ids);
      for (const d of deleted) d.restoredId = undefined;
    },
  };
}
```

- [ ] **Step 4: Spustit — zelené**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: PASS (11 testů)

- [ ] **Step 5: Commit**

```bash
git add src/lib/undo/commands.ts src/lib/undo/commands.test.ts
git commit -m "feat(undo): buildDeleteCommand + testy (undo=repost, redo=delete)"
```

---

## ETAPA 2 — Manager + migrace 4 existujících akcí

### Task 6: `useUndoManager` hook

**Files:**
- Create: `src/app/_components/useUndoManager.ts`
- Test: `src/app/_components/useUndoManager.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `UndoEffects`, `StaleUndoError` z `@/lib/undo/types`.
- Produces: `useUndoManager(effectsRef, showToast) → { record, undo, redo, canUndo, canRedo }`.
  Ve zbytku plánu se volá `record(entry)`, `undo()`, `redo()`.
- **Testovatelné jádro** je vyňato do čisté funkce `createUndoCore` (bez Reactu), kterou hook obalí.

- [ ] **Step 1: Napsat padající test — `useUndoManager.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createUndoCore } from "./useUndoManager.ts";
import { StaleUndoError, type HistoryEntry, type UndoEffects } from "@/lib/undo/types";

const noEffects = {} as UndoEffects;
function entry(log: string[], id: string, opts: { stale?: boolean } = {}): HistoryEntry {
  return {
    label: id,
    undo: async () => { if (opts.stale) throw new StaleUndoError(); log.push(`undo:${id}`); },
    redo: async () => { log.push(`redo:${id}`); },
  };
}

test("core: record → undo → redo přesouvá mezi stacky a hlásí can*", async () => {
  const log: string[] = []; const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(entry(log, "A"));
  assert.equal(core.state().canUndo, true);
  await core.undo();
  assert.deepEqual(log, ["undo:A"]);
  assert.equal(core.state().canRedo, true);
  await core.redo();
  assert.deepEqual(log, ["undo:A", "redo:A"]);
});

test("core: StaleUndoError zahodí záznam a ukáže toast", async () => {
  const log: string[] = []; const toasts: string[] = [];
  const core = createUndoCore(() => noEffects, (m) => toasts.push(m));
  core.record(entry(log, "A", { stale: true }));
  await core.undo();
  assert.match(toasts.join("|"), /mezitím změněn/);
  assert.equal(core.state().canUndo, false);   // zahozeno, ne vráceno zpět
});

test("core: MAX_HISTORY ořízne nejstarší", async () => {
  const log: string[] = [];
  const core = createUndoCore(() => noEffects, () => {});
  for (let i = 0; i < 35; i++) core.record(entry(log, `E${i}`));
  assert.equal(core.state().depth, 30);
});
```

- [ ] **Step 2: Spustit — padá**

Run: `node --test --import tsx src/app/_components/useUndoManager.test.ts`
Expected: FAIL — `Cannot find module './useUndoManager.ts'` nebo `createUndoCore is not a function`

- [ ] **Step 3: Implementovat hook + jádro**

```ts
import { useCallback, useRef, useState } from "react";
import { StaleUndoError, type HistoryEntry, type UndoEffects } from "@/lib/undo/types";

const MAX_HISTORY = 30;
type Toast = (msg: string, kind: "info" | "error") => void;

/** Čisté jádro bez Reactu — testovatelné. */
export function createUndoCore(getEffects: () => UndoEffects, toast: Toast) {
  const undoStack: HistoryEntry[] = [];
  const redoStack: HistoryEntry[] = [];
  let onChange: (() => void) | null = null;
  const notify = () => onChange?.();

  const record = (entry: HistoryEntry) => {
    undoStack.push(entry);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack.length = 0;
    notify();
  };
  const undo = async () => {
    const entry = undoStack.pop();
    if (!entry) return;
    try {
      await entry.undo(getEffects());
      redoStack.push(entry);
      toast("Vráceno zpět", "info");
    } catch (err) {
      if (err instanceof StaleUndoError) toast("Nelze vrátit: blok byl mezitím změněn", "error");
      else { undoStack.push(entry); toast("Vrácení zpět selhalo.", "error"); if (typeof console !== "undefined") console.error("Undo failed", err); }
    } finally { notify(); }
  };
  const redo = async () => {
    const entry = redoStack.pop();
    if (!entry) return;
    try {
      await entry.redo(getEffects());
      undoStack.push(entry);
      toast("Znovu provedeno", "info");
    } catch (err) {
      if (err instanceof StaleUndoError) toast("Nelze provést: blok byl mezitím změněn", "error");
      else { redoStack.push(entry); toast("Znovu provedení selhalo.", "error"); if (typeof console !== "undefined") console.error("Redo failed", err); }
    } finally { notify(); }
  };
  return {
    record, undo, redo,
    setOnChange: (fn: () => void) => { onChange = fn; },
    state: () => ({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, depth: undoStack.length }),
  };
}

/** React hook nad jádrem. `effectsRef` je ref, aby jádro četlo vždy aktuální effects. */
export function useUndoManager(effectsRef: React.MutableRefObject<UndoEffects>, showToast: Toast) {
  const [, force] = useState(0);
  const coreRef = useRef<ReturnType<typeof createUndoCore> | null>(null);
  if (coreRef.current === null) {
    coreRef.current = createUndoCore(() => effectsRef.current, showToast);
    coreRef.current.setOnChange(() => force((n) => n + 1));
  }
  const core = coreRef.current;
  const record = useCallback((e: HistoryEntry) => core.record(e), [core]);
  const undo = useCallback(() => core.undo(), [core]);
  const redo = useCallback(() => core.redo(), [core]);
  const { canUndo, canRedo } = core.state();
  return { record, undo, redo, canUndo, canRedo };
}
```

- [ ] **Step 4: Spustit — zelené**

Run: `node --test --import tsx src/app/_components/useUndoManager.test.ts`
Expected: PASS (3 testy)

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/useUndoManager.ts src/app/_components/useUndoManager.test.ts
git commit -m "feat(undo): useUndoManager hook + testovatelné jádro createUndoCore"
```

---

### Task 7: Effects v `PlannerPage` + zapojení manageru + migrace klávesnice

Zavést reálné `UndoEffects`, `useUndoManager`, a nahradit inline keyboard handler voláními
`undo()`/`redo()`. Staré `undoStack`/`redoStack`/`canUndo`/`canRedo`/`MAX_HISTORY` zůstávají
zatím jen pro dosud nemigrované record-sites (odstraní se v Tasku 8).

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (556-564, 660-661, 2718-2738)

**Interfaces:**
- Consumes: `useUndoManager` z `./useUndoManager`, buildery z `@/lib/undo/commands`.
- Produces: proměnné `undoEffectsRef`, a z hooku `record`, `undoMgr` (undo), `redoMgr` (redo),
  `canUndoMgr`, `canRedoMgr`.

- [ ] **Step 1: Přidat import a effects blok za `blocksRef` (poblíž `PlannerPage.tsx:661`)**

Vložit hned za `blocksRef.current = blocks;`:

```ts
  // ── Undo effects (reálná implementace injektovaná do command builderů) ──
  const undoEffectsRef = useRef<UndoEffects>(null as unknown as UndoEffects);
  undoEffectsRef.current = {
    putBlock: async (id, body) => {
      const r = await fetch(`/api/blocks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Chyba serveru"); }
      return r.json();
    },
    postBlock: async (body) => {
      const r = await fetch("/api/blocks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Chyba serveru"); }
      return r.json();
    },
    deleteBlock: async (id) => {
      const r = await fetch(`/api/blocks/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Chyba serveru");
    },
    batchUpdate: async (updates) => {
      const r = await fetch("/api/blocks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates, bypassScheduleValidation: false, bypassOverlapCheck: true }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? "Chyba serveru"); }
      return r.json();
    },
    addToState: (list) => setBlocks((prev) => {
      const byId = new Map(list.map((b) => [b.id, b]));
      const merged = prev.map((b) => byId.get(b.id) ?? b);
      for (const b of list) if (!prev.some((p) => p.id === b.id)) merged.push(b);
      return merged.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }),
    removeFromState: (ids) => setBlocks((prev) => prev.filter((b) => !ids.includes(b.id))),
    getLiveBlock: (id) => blocksRef.current.find((b) => b.id === id),
  };
  const { record: recordUndo, undo: undoMgr, redo: redoMgr, canUndo: canUndoMgr, canRedo: canRedoMgr } = useUndoManager(undoEffectsRef, showToast);
```

Přidat na začátek souboru k importům:

```ts
import { useUndoManager } from "./useUndoManager";
import type { UndoEffects } from "@/lib/undo/types";
import { buildMoveCommand, buildEditCommand, buildCreateCommand, buildDeleteCommand } from "@/lib/undo/commands";
```

- [ ] **Step 2: Nahradit keyboard undo/redo větve (`PlannerPage.tsx:2719-2738`)**

Nahradit celý blok obou `if` (Ctrl+Z a Ctrl+Y) tímto:

```ts
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        void undoMgr();
        return;
      }
      if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
        e.preventDefault();
        void redoMgr();
        return;
      }
```

> Pozn.: keydown handler je bindovaný jednou na mount a čte hodnoty přes refs. `undoMgr`/`redoMgr`
> jsou stabilní (useCallback), takže je bezpečné je volat přímo. Pokud lint hlásí exhaustive-deps
> na tomto useEffectu, ponechat stávající `// eslint-disable-next-line` (parita s dneškem).

- [ ] **Step 3: Build + celá suite**

Run: `npm run build && node --test --import tsx src/lib/undo/commands.test.ts src/app/_components/useUndoManager.test.ts`
Expected: build OK; testy PASS. (Klávesy Ctrl+Z zatím obsluhují prázdný nový stack — staré record-sites se migrují v Tasku 8, takže dočasně Ctrl+Z nevrací staré akce. To je očekávaný mezistav v rámci jedné etapy.)

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(undo): zapojit useUndoManager + effects, migrovat klávesy Ctrl+Z/Y"
```

---

### Task 8: Migrace 4 record-sites na buildery + odstranění staré infrastruktury

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (556-559, 564, 1490-1518, 1566-1580, 1693-1719, 1799-1824)

**Interfaces:**
- Consumes: `recordUndo`, buildery, `undoEffectsRef` z Tasku 7.

- [ ] **Step 1: `handleBlockUpdate` — nahradit inline push (`PlannerPage.tsx:1510-1517`) voláním builderu**

Blok `undoStack.current.push({ undo: ..., redo: ... }); if (undoStack.current.length > MAX_HISTORY) ...; redoStack.current = []; setCanUndo(true); setCanRedo(false);` nahradit:

```ts
        const liveBefore = blocksRef.current.find((b) => b.id === prev.id);
        const liveAfter = { ...cleanUpdated };
        recordUndo(buildMoveCommand(
          "Přesun bloku",
          beforeSnaps.map((s) => ({ ...s, updatedAt: (liveAfter as Block).updatedAt })),
          afterSnaps.map((s) => ({ ...s, updatedAt: (liveAfter as Block).updatedAt })),
        ));
```

> Přesnost `updatedAt`: `before` snapshot potřebuje `updatedAt` STAVU PŘED naší akcí (z `liveBefore`),
> `after` snapshot `updatedAt` po akci (z `cleanUpdated`). Doplnit per-blok mapou z `blocksRef.current`
> (primární) a z `shiftedOld`/`shifted` (sousedé). Konkrétně:

```ts
        const beforeUpd = new Map<number, string>([[prev.id, (liveBefore as Block).updatedAt], ...shiftedOld.map((o) => [o.id, o.updatedAt] as const)]);
        const afterUpd = new Map<number, string>([[cleanUpdated.id, cleanUpdated.updatedAt], ...shifted.map((s) => [s.id, s.updatedAt] as const)]);
        recordUndo(buildMoveCommand(
          "Přesun bloku",
          beforeSnaps.map((s) => ({ ...s, updatedAt: beforeUpd.get(s.id) ?? "" })),
          afterSnaps.map((s) => ({ ...s, updatedAt: afterUpd.get(s.id) ?? "" })),
        ));
```

- [ ] **Step 2: `handleMultiBlockUpdate` — nahradit inline push (`PlannerPage.tsx:1566-1580`)**

Analogicky: sestavit `prevSnaps`/`nextSnaps` (už existují) s doplněným `updatedAt` a volat
`recordUndo(buildMoveCommand("Hromadný přesun", prevSnapsWithUpd, nextSnapsWithUpd));` — `updatedAt`
pro `prev` z `originals`/`shiftedOld`, pro `next` z `results`.

```ts
      if (prevSnaps.length > 0) {
        const beforeUpd = new Map<number, string>([
          ...updates.map((u) => [u.id, originals.get(u.id)!.updatedAt] as const),
          ...shiftedOld.map((o) => [o.id, o.updatedAt] as const),
        ]);
        const afterUpd = new Map<number, string>(results.map((r) => [r.id, r.updatedAt] as const));
        recordUndo(buildMoveCommand(
          "Hromadný přesun",
          prevSnaps.map((s) => ({ ...s, updatedAt: beforeUpd.get(s.id) ?? "" })),
          nextSnaps.map((s) => ({ ...s, updatedAt: afterUpd.get(s.id) ?? "" })),
        ));
      }
```

- [ ] **Step 3: `deleteSingleBlockWithUndo` — nahradit inline push (`PlannerPage.tsx:1693-1719`)**

Za sestavením `payload` (řádky 1660-1691 zůstávají) nahradit `undoStack.current...push({...})` blok:

```ts
    recordUndo(buildDeleteCommand("Smazání bloku", [{ payload }]));
```

- [ ] **Step 4: `handleDeleteAll` multi — nahradit inline push (`PlannerPage.tsx:1799-1824`)**

Za sestavením `payloads` (řádky 1781-1797 zůstávají) nahradit `undoStack.current...push({...})` blok:

```ts
    recordUndo(buildDeleteCommand("Smazání bloků", payloads.map((payload) => ({ payload }))));
```

- [ ] **Step 5: Odstranit starou infrastrukturu (`PlannerPage.tsx:556-559, 564`)**

Smazat řádky:

```ts
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  ...
  const MAX_HISTORY = 30;
```

a typ `type HistoryEntry = ...` (řádek 114), pokud už není nikde použit. Nahradit případné
zbývající reference `canUndo`/`canRedo` → `canUndoMgr`/`canRedoMgr`.

- [ ] **Step 6: Build + testy + grep kontrola**

Run: `npm run build && grep -n "undoStack\.current\|setCanUndo\|setCanRedo" src/app/_components/PlannerPage.tsx || echo "OK zadna stara reference"`
Expected: build OK; grep vrací `OK zadna stara reference`.

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "refactor(undo): migrovat 4 record-sites na buildery, odstranit inline stack"
```

- [ ] **Step 8: STOP — subagent review diffu migrace**

Před další etapou vyžádat review (viz sekci „Kontrola po etapě 2" níže). Ověřit ručně:
drag, resize, lasso, single delete, multi delete → Ctrl+Z je vrátí; Ctrl+Y znovu provede.

---

## ETAPA 3 — Nové akce

### Task 9: Undo pro editaci formulářem (BlockEdit) + DTP/MTZ single-field

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (onSave wiring ~3394, `handleBlockUpdate` signatura)

**Interfaces:**
- Consumes: `buildEditCommand`, `recordUndo`.

- [ ] **Step 1: Rozšířit `handleBlockUpdate` o zachycení edit-snapshotu**

V `handleBlockUpdate(updated, addToHistory=false)` doplnit druhou větev: když se změnila **datová
pole** (ne jen čas/stroj), zaznamenat `buildEditCommand`. Sledovaná pole = ta, co edituje
`BlockEdit.buildPayload` (viz spec): `orderNumber, type, blockVariant, jobPresetId, description,
locked, deadlineExpedice, dataStatusId, dataStatusLabel, dataRequiredDate, dataOk,
materialStatusId, materialStatusLabel, materialRequiredDate, materialOk, materialNote,
materialInStock, materialIssued, pantoneRequired, pantoneRequiredDate, pantoneOk, barvyStatusId,
barvyStatusLabel, lakStatusId, lakStatusLabel, specifikace, obalka, vnitrky, tiskoveArchy, serie`.

```ts
  const EDIT_TRACKED_FIELDS = [
    "orderNumber","type","blockVariant","jobPresetId","description","locked","deadlineExpedice",
    "dataStatusId","dataStatusLabel","dataRequiredDate","dataOk","materialStatusId","materialStatusLabel",
    "materialRequiredDate","materialOk","materialNote","materialInStock","materialIssued","pantoneRequired",
    "pantoneRequiredDate","pantoneOk","barvyStatusId","barvyStatusLabel","lakStatusId","lakStatusLabel",
    "specifikace","obalka","vnitrky","tiskoveArchy","serie",
  ] as const;
```

Uvnitř `if (prev && addToHistory) { ... }` PO větvi `timeOrMachineChanged` přidat:

```ts
      const changedFields = EDIT_TRACKED_FIELDS.filter(
        (f) => JSON.stringify((prev as Record<string, unknown>)[f]) !== JSON.stringify((cleanUpdated as Record<string, unknown>)[f]),
      );
      if (changedFields.length > 0) {
        const beforeFields: Record<string, unknown> = {};
        const afterFields: Record<string, unknown> = {};
        for (const f of changedFields) {
          beforeFields[f] = (prev as Record<string, unknown>)[f];
          afterFields[f] = (cleanUpdated as Record<string, unknown>)[f];
        }
        const shiftedBefore = shiftedOld.map((o) => ({ id: o.id, startTime: o.startTime as string, endTime: o.endTime as string, machine: o.machine, updatedAt: o.updatedAt }));
        const shiftedAfter = shifted.map((s) => ({ id: s.id, startTime: s.startTime as string, endTime: s.endTime as string, machine: s.machine, updatedAt: s.updatedAt }));
        recordUndo(buildEditCommand(
          "Úprava bloku",
          { id: prev.id, updatedAt: (prev as Block).updatedAt, fields: beforeFields },
          { id: cleanUpdated.id, updatedAt: cleanUpdated.updatedAt, fields: afterFields },
          shiftedBefore, shiftedAfter,
        ));
      }
```

> Pozn.: `timeOrMachineChanged` a `changedFields` se nevylučují — edit délky přes formulář může
> spustit obě. To je v pořádku: vzniknou dva samostatné history záznamy (pozice + pole), oba
> undovatelné. Pokud chceme jeden krok, lze v pozdější iteraci sloučit; pro teď YAGNI.

- [ ] **Step 2: Zapnout historii u editačních cest — onSave (`PlannerPage.tsx:3394`)**

Změnit:

```ts
              onSave={(updated) => { handleBlockUpdate(updated); setEditingBlock(null); }}
```

na:

```ts
              onSave={(updated) => { handleBlockUpdate(updated, true); setEditingBlock(null); }}
```

Stejně u dalších single-field cest v `PlannerPage` — `handleDtpDataStatusChange`
(`1628`), `handleBlockVariantChange` (`2239`): za `handleBlockUpdate(updated)` doplnit `, true`.

**DTP/MTZ inline chipy v `TimelineGrid`** (spec je zahrnuje): tyto cesty volají
`onBlockUpdate(updated)` bez druhého argumentu. Předat `true` u single-field PUT cest, které
mají dostat undo — konkrétně v `TimelineGrid.tsx`:
- `toggleField` (dataOk/materialOk/pantoneOk) — `1083`: `onBlockUpdate(await res.json(), true)`
- `materialNote` save — `1106`: `onBlockUpdate(await res.json(), true)`
- `clearNote` — `1126`: `onBlockUpdate(await res.json(), true)`
- inline date picker (dataRequiredDate/materialRequiredDate/pantoneRequiredDate) — `4030`: `callbacksRef.current.onBlockUpdate(updated, true)`
- materialInStock — `4050`: `callbacksRef.current.onBlockUpdate(updated, true)`
- materialIssued — `4068`: `callbacksRef.current.onBlockUpdate(updated, true)`

Split-truncate cesty (`2932`, `2944`) NEupravovat — split je mimo scope; ponechat bez `true`.
Tyto inline změny nesou single-field PUT bez `shifted`, takže `changedFields` je zachytí a
`buildEditCommand` je zaznamená bez sousedů (parita s formulářem).

- [ ] **Step 3: Build + testy**

Run: `npm run build && node --test --import tsx src/lib/undo/commands.test.ts`
Expected: build OK; testy PASS.

- [ ] **Step 4: Ruční ověření**

Otevřít blok → editovat popis/deadline/status přes formulář → uložit → Ctrl+Z vrátí staré
hodnoty; Ctrl+Y znovu nastaví nové. Ověřit souběh: nechat druhého uživatele (nebo simulovat
změnou `updatedAt`) → Ctrl+Z ukáže toast „blok byl mezitím změněn".

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(undo): undo/redo pro editaci bloku formulářem (+ status/varianta)"
```

---

### Task 10: Undo pro create / paste / group paste / queue-drop

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (`handlePasteWithTarget` ~2461, `handleGroupPasteWithTarget` ~2552, `handleQueueDrop` ~2318)

**Interfaces:**
- Consumes: `buildCreateCommand`, `recordUndo`.
- Guard reuse: undo se zaeviduje jen pro bloky s `reservationId == null` a `recurrenceType === "NONE" && recurrenceParentId == null`.

- [ ] **Step 1: Helper pro rozhodnutí „lze undovat create"**

Přidat čistou funkci poblíž ostatních helperů v `PlannerPage`:

```ts
  const canUndoCreated = (b: Block) =>
    b.reservationId == null && b.recurrenceType === "NONE" && b.recurrenceParentId == null;
```

- [ ] **Step 2: `handlePasteWithTarget` — po `handleBlockCreate(newBlock)` (~2526)**

Za `handleBlockCreate(newBlock);` doplnit (payload je objekt už poslaný na POST — sestavit stejný
`body`, nebo ho zachytit do proměnné před fetch a znovu použít):

```ts
      if (canUndoCreated(newBlock)) {
        recordUndo(buildCreateCommand("Vložení bloku", [
          { id: newBlock.id, updatedAt: newBlock.updatedAt, payload: pasteBody },
        ]));
      }
```

kde `pasteBody` je proměnná, do které se před `fetch` uloží tělo POST požadavku (dnes inline
v `JSON.stringify({...})` na ~2485-2520 — vytáhnout do `const pasteBody = { ... };`).

- [ ] **Step 3: `handleGroupPasteWithTarget` — akumulovat vytvořené (~2645)**

Sesbírat `{ id, updatedAt, payload }` per vytvořený blok do pole a po smyčce jednou zaznamenat:

```ts
      const createdRefs = created
        .filter(canUndoCreated)
        .map((b, i) => ({ id: b.id, updatedAt: b.updatedAt, payload: groupBodies[i] }));
      if (createdRefs.length > 0) recordUndo(buildCreateCommand("Vložení skupiny", createdRefs));
```

kde `groupBodies` je pole POST těl v témže pořadí jako `created` (vytáhnout inline body do pole).

> Pozn.: undo skupiny je „vše nebo nic" v rámci jednoho záznamu; pokud část bloků byla
> rezervační/sériová, ty se do `createdRefs` nezahrnou (guard) a undovat půjdou jen samostatné.

- [ ] **Step 4: `handleQueueDrop` — po `handleBlockCreate(parentBlock)` (~2415)**

Queue-drop může vytvořit rezervační nebo sériový parent → guard `canUndoCreated` to vyřeší
(nezaznamená). Pro samostatný parent bez recurrence:

```ts
      if (canUndoCreated(parentBlock)) {
        recordUndo(buildCreateCommand("Umístění z fronty", [
          { id: parentBlock.id, updatedAt: parentBlock.updatedAt, payload: queueParentBody },
        ]));
      }
```

kde `queueParentBody` je tělo parent POST (vytáhnout inline). Sériové děti (recurrence) se
neevidují — parity s tím, že série nemají undo.

- [ ] **Step 5: Build + testy**

Run: `npm run build && node --test --import tsx src/lib/undo/commands.test.ts`
Expected: build OK; testy PASS.

- [ ] **Step 6: Ruční ověření**

Ctrl+V vloží blok → Ctrl+Z ho smaže → Ctrl+Y znovu vytvoří (a další Ctrl+Z ho zase smaže —
ověřuje remap id). Totéž group paste a queue-drop samostatného bloku. Ověřit, že queue-drop
rezervace/série undo NEnabízí (žádná chyba, jen se nic nevrátí).

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(undo): undo/redo pro paste, group paste a queue-drop samostatných bloků"
```

---

## ETAPA 4 — Viditelné tlačítko

### Task 11: `UndoRedoButtons` komponenta + zapojení do hlavičky

**Files:**
- Create: `src/components/UndoRedoButtons.tsx`
- Test: `src/components/UndoRedoButtons.test.tsx` (volitelně — render test; jinak vynechat, komponenta je triviální)
- Modify: `src/app/_components/PlannerPage.tsx` (render v hlavičce, poblíž ovládání zámku ~561 render sekce)

**Interfaces:**
- Consumes: `canUndoMgr`, `canRedoMgr`, `undoMgr`, `redoMgr` z Tasku 7.
- Produces: `UndoRedoButtons({ canUndo, canRedo, onUndo, onRedo, canEdit })`.

- [ ] **Step 1: Vytvořit `src/components/UndoRedoButtons.tsx`**

```tsx
"use client";

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Skrýt pro role bez edit práv (parita s undo = mění data). */
  canEdit: boolean;
};

export function UndoRedoButtons({ canUndo, canRedo, onUndo, onRedo, canEdit }: Props) {
  if (!canEdit) return null;
  const base = "h-8 px-2 rounded text-sm border border-slate-700 bg-slate-800 text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition";
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Historie změn">
      <button type="button" className={base} onClick={onUndo} disabled={!canUndo} title="Zpět (Ctrl+Z)" aria-label="Zpět">↶</button>
      <button type="button" className={base} onClick={onRedo} disabled={!canRedo} title="Vpřed (Ctrl+Y)" aria-label="Vpřed">↷</button>
    </div>
  );
}
```

- [ ] **Step 2: Zapojit do hlavičky `PlannerPage`**

Import na začátek:

```ts
import { UndoRedoButtons } from "@/components/UndoRedoButtons";
```

V render hlavičky (poblíž přepínače zámku pracovní doby / navigačních tlačítek) vložit:

```tsx
            <UndoRedoButtons
              canUndo={canUndoMgr}
              canRedo={canRedoMgr}
              onUndo={() => void undoMgr()}
              onRedo={() => void redoMgr()}
              canEdit={canEdit}
            />
```

> `canEdit` je existující proměnná v `PlannerPage` (role-gate pro editaci). Pokud se jmenuje
> jinak, použít odpovídající boolean (např. z role uživatele: ADMIN/PLANOVAT/DTP/MTZ mají edit).

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint 2>&1 | grep -i "UndoRedoButtons" || echo "OK bez chyb"`
Expected: build OK; `OK bez chyb`.

- [ ] **Step 4: Ruční ověření**

Tlačítka ↶/↷ v hlavičce: disabled dokud není co vracet; po přesunu/editaci/vložení se ↶ aktivuje;
klik = totéž co Ctrl+Z. Read-only role (VIEWER/OBCHODNIK/TISKAR) tlačítka nevidí.

- [ ] **Step 5: Commit**

```bash
git add src/components/UndoRedoButtons.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(undo): viditelné tlačítko zpět/vpřed v hlavičce planneru"
```

---

## Kontrola po etapě 2 (subagent review) — POVINNÉ

Po Tasku 8 (před etapou 3) dispatchnout subagenta na review diffu migrace:

> „Zkontroluj diff `git diff <hash před Task7>..HEAD -- src/app/_components/PlannerPage.tsx`.
> Ověř, že migrace 4 undo record-sites (drag, lasso, single delete, multi delete) na nové
> buildery zachovala chování 1:1: (a) stejné payloady na `/api/blocks/batch` a `/api/blocks`,
> (b) `updatedAt` v snapshotech je správně před/po akci, (c) žádná stará reference `undoStack.current`
> / `setCanUndo` nezůstala, (d) redo po undo funguje. Vypiš konkrétní odchylky s file:line."

Opravit nalezené odchylky, pak pokračovat etapou 3.

## Finální verifikace (po Tasku 11)

- [ ] `npm run build` — OK
- [ ] `npm run lint` — 0 chyb (warningy jako dnes)
- [ ] Celá test suite zelená + nové soubory:
  ```bash
  node --test --import tsx src/lib/undo/commands.test.ts
  node --test --import tsx src/app/_components/useUndoManager.test.ts
  ```
- [ ] Ruční regrese: drag, resize, lasso, delete (single/multi), edit formulářem, paste, group
  paste, queue-drop → undo i redo; souběh toast; tlačítko i klávesy.
- [ ] Aktualizovat `CLAUDE.md` sekci o undo (nová, krátká) + `MEMORY.md` pointer.

---

## Poznámky k rizikům (z designu)

- **Migrace (Task 8)** = jediné reálné regresní riziko → subagent review + ruční regrese před etapou 3.
- **`updatedAt` v snapshotech**: musí odpovídat stavu před/po akci; nejčastější chyba je vzít
  `updatedAt` z nesprávné strany. Testy builderů to hlídají na úrovni logiky; migrace to musí
  správně naplnit z `blocksRef.current` (před) a serverové odpovědi (po).
- **Redo create → nové id**: ošetřeno remapem v builderu; ruční test „Ctrl+Z, Ctrl+Y, Ctrl+Z".
- **Mimo scope**: split, série, inline chip toggly (TimelineGrid), potvrzení tisku, reflow.
