# Rozšíření undo/redo — design

Datum: 2026-07-03
Autor: Vojta Ťokan (+ Claude)
Stav: návrh ke schválení

## Kontext a problém

Planner (`src/app/_components/PlannerPage.tsx`) má klientské undo/redo přes klávesy
Ctrl+Z / Ctrl+Y. Dnes pokrývá jen 4 akce a celá logika je **inline v ~3500řádkové
god-komponentě**, kde každá akce má vlastní ad-hoc snapshot/replay closure. Undo je
proto **netestovatelné** (closures čtou stav komponenty přes refs) — což je paradoxně
právě to, co podkopává požadovanou bezpečnost. Projekt jinak má silnou test kulturu
(179 testů, TDD).

Cíl: rozšířit undo na další akce (editace formulářem, DTP/MTZ pole, create/paste/
queue-drop) a přitom **nejdřív vytáhnout undo do samostatného testovatelného modulu**
a migrovat na něj existující akce. „Pořádně jednou", ale bezpečně přes strangler-fig,
ne rizikový rewrite.

### Dnešní stav (ověřeno)

- Zásobník `undoStack`/`redoStack` (`useRef<HistoryEntry[]>`), `HistoryEntry = { undo, redo }`,
  `MAX_HISTORY = 30`. `PlannerPage.tsx:556-564`.
- Spouštění jen klávesou Ctrl+Z / Ctrl+Y (`PlannerPage.tsx:2719-2738`). **Žádné viditelné
  tlačítko** — stavy `canUndo`/`canRedo` se nastavují, ale v JSX se nečtou.
- Přesně **4 record-sites**:
  1. `handleBlockUpdate` (drag/resize jednoho bloku) — `PlannerPage.tsx:1510`
  2. `handleMultiBlockUpdate` (lasso) — `PlannerPage.tsx:1572`
  3. `deleteSingleBlockWithUndo` — `PlannerPage.tsx:1694`
  4. `handleDeleteAll` (multi delete) — `PlannerPage.tsx:1800`
- Pokryté akce: drag, resize, lasso multi-move, mazání samostatných bloků.
- Nepokryté: editace formulářem, DTP/MTZ pole, create/paste/queue-drop, split, série,
  potvrzení tisku, reflow, mazání série/split/rezervací.

### Klíčová infrastruktura (ověřeno subagenty)

- `Block` má `updatedAt @updatedAt` (`prisma/schema.prisma:56`), serializuje se klientovi
  (`src/lib/blockSerialization.ts:47`), je v klientském typu `Block`
  (`TimelineGrid.tsx:78-150`). → použitelné jako verze pro souběh-guard.
- `/api/blocks/batch` už podporuje optimistický zámek přes `expectedUpdatedAt` per blok →
  409 CONFLICT při neshodě (`src/app/api/blocks/batch/route.ts:12-40, 72-86`).
- `BlockEdit` dělá PUT sám s `resolveChain:true`, odpověď je `Block` s možným `shifted[]`
  (`BlockEdit.tsx:610-623`); `onSave(updated)` volá `handleBlockUpdate` v rodiči
  (`PlannerPage.tsx:3394`).
- `blocksRef.current = blocks` synchronně v render body (`PlannerPage.tsx:660-661`) →
  spolehlivý `getLiveBlock(id)` pro guard.
- Vzor id-remapu po recreate: mutable `restoredId`/`restoredIds` v closure
  (`PlannerPage.tsx:1703, 1798-1818`).

## Cíle

- Undo/redo pro: **editaci formulářem (BlockEdit)**, **DTP/MTZ single-field změny**,
  **create / paste / group paste / queue-drop**.
- **Souběh-guard**: undo/redo se neprovede, pokud byl blok mezitím změněn jiným
  uživatelem; místo toho toast „blok byl mezitím změněn".
- **Viditelné tlačítko** zpět/vpřed v hlavičce planneru (+ zachovat klávesy).
- Undo vytáhnout do **testovatelného modulu** `src/lib/undo/` a **migrovat 4 existující
  akce** na něj s chováním 1:1.

## Non-goals (vědomý strop)

- Undo zůstává **klientské, session-lokální**: nepřežije reload stránky, zásobník je jen
  daného uživatele, souběh se řeší **detekcí + odmítnutím**, ne merge.
- **Split** se do undo NEPŘIDÁVÁ (relační vazby head/tail + `splitGroupId` = nejvyšší
  riziko; odloženo na samostatnou etapu).
- Série, mazání série/split/rezervací, potvrzení tisku, reflow — beze změny (zůstávají
  bez undo; potvrzení tisku má vlastní „Vrátit hotovo").
- Žádný serverový undo-log, žádná nová DB kolona, žádná migrace.

## Architektura

### Rozložení modulu

```
src/lib/undo/
  types.ts          — HistoryEntry, BlockSnapshot, UndoEffects, StaleUndoError
  commands.ts       — čisté command buildery (mutate/create/delete)
  commands.test.ts  — unit testy builderů (node --test --import tsx)
src/app/_components/useUndoManager.ts
                    — hook: undoStack/redoStack, canUndo/canRedo, record/undo/redo, MAX_HISTORY
src/components/UndoRedoButtons.tsx
                    — viditelné tlačítko zpět/vpřed
```

### Dělba odpovědnosti

- **Manager (`useUndoManager`)** je „hloupý": drží stacky + `canUndo`/`canRedo`, ořezává na
  `MAX_HISTORY`, spouští `entry.undo()/redo()`, chytá `StaleUndoError` → toast + zahození
  stale záznamu, jinak přesune záznam mezi stacky. Žádná per-akční logika.
- **Buildery (`commands.ts`)** jsou čisté funkce `(data, effects) → HistoryEntry`. Veškerá
  inverzní logika + souběh-guard žije tady. `effects` je injektované rozhraní → v testech
  se podstrčí fake a ověří se payloady/volání.

### Effects rozhraní (injektované)

```ts
interface UndoEffects {
  putBlock(id: number, body: object): Promise<Block & { shifted?: Block[] }>;
  postBlock(body: object): Promise<Block>;
  deleteBlock(id: number): Promise<void>;
  batchUpdate(updates: BlockSnapshot[], opts: { expectedUpdatedAt?: boolean }): Promise<Block[]>;
  applyToState(blocks: Block[]): void;   // merge do setBlocks
  removeFromState(ids: number[]): void;
  addToState(blocks: Block[]): void;
  getLiveBlock(id: number): Block | undefined;   // z blocksRef.current
}
```

Reálná implementace effects (fetch + setBlocks) žije v `PlannerPage` a předává se hooku;
buildery ji jen volají. Tím jsou buildery bez Reactu a bez DB → testovatelné.

### Typy

```ts
type BlockSnapshot = {
  id: number;
  startTime: string; endTime: string; machine: string;
  updatedAt: string;          // verze pro souběh-guard
  fields?: Partial<Block>;    // jen u mutate: editovaná pole (before/after)
};

type HistoryEntry = {
  label: string;              // pro toast / tooltip tlačítka
  undo(effects: UndoEffects): Promise<void>;
  redo(effects: UndoEffects): Promise<void>;
};

class StaleUndoError extends Error {}   // hodí builder, když guard selže
```

## Tři typy commandů

Všechny akce spadají do tří tvarů. To je jádro zjednodušení.

### 1. `mutate` — drag, resize, editace formulářem, DTP/MTZ pole

„PUT, který může kaskádovat." Move i edit jsou tentýž tvar: PUT na blok (`resolveChain`)
+ případné `shifted[]` odsunuté sousedy.

- **Vznik**: builder dostane `before` (blok před akcí z `blocksRef.current`, vč. `updatedAt`),
  `after` (výsledek), a `shiftedBefore`/`shiftedAfter` (pozice sousedů před/po — sebrané
  PŘED `setBlocks`, jak to dělá dnešní `handleBlockUpdate:1462-1466`).
- **undo**:
  1. Guard: `getLiveBlock(before.id).updatedAt === after.updatedAt`? Když ne → `StaleUndoError`.
  2. PUT `/api/blocks/[id]` s `before.fields` (editovaná pole ve staré hodnotě) +
     `resolveChain:true`, `bypassOverlapCheck` chování jako dnes.
  3. Pokud byli odsunutí sousedé: `batchUpdate(shiftedBefore, { expectedUpdatedAt:true })`
     (server-side 409 backstop).
- **redo**: zrcadlově s `after.fields` a `shiftedAfter`.
- **Pouze pozice** (drag/resize): `fields` je `{startTime,endTime,machine}` a jde přes batch
  jako dnes (žádný PUT jednotlivého bloku). Sjednoceno pod týmž builderem přes rozlišení
  „poziční vs. datová pole".

### 2. `create` — paste, group paste, queue-drop

- **Vznik**: builder dostane vytvořené bloky (z `handleBlockCreate`) + jejich POST payload
  (pro redo).
- **Guard reuse (stejné jako delete dnes)**: undo se **nezaeviduje** pro bloky s
  `reservationId` truthy nebo `recurrenceType !== "NONE" || recurrenceParentId !== null`
  (queue-drop umí vytvořit rezervační i sériové bloky) — `PlannerPage.tsx:1649,1656`.
- **undo**: guard (blok stále existuje a `updatedAt` nezměněn) → `deleteBlock(id)` →
  `removeFromState`.
- **redo**: re-POST payloadu → nové id → **remap** (mutable id v closure, vzor z `1703`) →
  `addToState`.

### 3. `delete` — mazání (single + multi)

Zobecnění dnešních `deleteSingleBlockWithUndo` + `handleDeleteAll`.

- **undo**: re-POST payloadu(ů) → nová id → remap → `addToState`.
- **redo**: `deleteBlock` nových id → `removeFromState`.
- **Guard**: recreate nemá co porovnávat → guard se přeskočí (`before` je pryč).

## Souběh-guard (detail)

- Zdroj pravdy = `Block.updatedAt` (ISO string). Snapshot si ho uloží při vzniku záznamu.
- Klientský check před přehráním: `getLiveBlock(id)?.updatedAt` proti snapshotu. Neshoda
  nebo blok zmizel → `StaleUndoError`.
- Serverový backstop pro poziční batch: `expectedUpdatedAt` → 409 CONFLICT.
- Manager na `StaleUndoError` / 409: toast „Nelze vrátit: blok byl mezitím změněn",
  **stale záznam zahodí** (retry nemá smysl), aktualizuje `canUndo`/`canRedo`.

## UI — tlačítko zpět/vpřed

- `src/components/UndoRedoButtons.tsx` (named export, do `src/components/` dle standardů).
- Dvě tlačítka (↶ Zpět / ↷ Vpřed) v hlavičce planneru; `disabled` dle `canUndo`/`canRedo`
  (stavy už existují, dnes nevyužité). Tooltip s `label` posledního záznamu.
- Klávesy Ctrl+Z / Ctrl+Y zůstávají a volají tytéž `undo()`/`redo()` z manageru.
- Viditelnost dle role: jen tam, kde uživatel může editovat (parita s dnešním chováním —
  undo mění data).

## Plán migrace (strangler, po etapách)

První krok je pojistka proti regresi; teprve pak nové akce. Po každé etapě `npm run build`
+ testy zelené, pak stop na OK (standard projektu).

1. **Modul + testy** — `types.ts`, `commands.ts` (mutate/create/delete), `commands.test.ts`
   s fake effects. Žádné zapojení do UI. Undo poprvé pokryté testy.
2. **Manager + migrace 4 akcí** — `useUndoManager`, nahradit inline `undoStack`/`redoStack`/
   `setCanUndo` voláními `record(buildXxx(...))`. Chování 1:1. **Diff nechat zreviewovat
   subagentem** (jediné reálné regresní riziko).
3. **Nové akce** — edit (BlockEdit `onSave` → `mutate`), DTP/MTZ single-field cesty,
   create/paste/group-paste/queue-drop (`create` s reuse guardů).
4. **Tlačítko** — `UndoRedoButtons` + zapojení do hlavičky.

## Testovací strategie

- Unit testy builderů (`commands.test.ts`) s fake `UndoEffects`: ověřit správné payloady
  PUT/POST/DELETE/batch, správné state operace, a že guard hodí `StaleUndoError` při
  neshodě `updatedAt`. Spouštění `node --test --import tsx src/lib/undo/commands.test.ts`.
- Manuální ověření per etapa + subagent review diffu migrace (etapa 2).
- Existující test suite (179) musí zůstat zelená.

## Rizika a mitigace

| Riziko | Mitigace |
|---|---|
| Migrace rozbije fungující undo přesunů/mazání | Testy builderů nejdřív; chování 1:1; subagent review diffu; stop na OK po etapě 2 |
| Edit-undo s změnou délky (kaskáda) | `mutate` sdílí cestu s move — zachytává `shifted` sousedy jako `handleBlockUpdate` dnes |
| Redo create → nové id | Mutable id remap v closure (ověřený vzor `1703`) |
| Souběh (SSE) tichý přepis | `updatedAt` guard klient + `expectedUpdatedAt` 409 server |
| Queue-drop vytvoří rezervaci/sérii | Reuse delete guardů (skip `reservationId` / `recurrence`) |
| PlannerPage roste | Undo se z něj naopak vytahuje ven |

## Otevřené otázky

Žádné blokující. (Ověřeno: `updatedAt` existuje a serializuje se; batch má optimistický
zámek; BlockEdit nese `shifted`; `blocksRef` je spolehlivý; 4 record-sites.)
