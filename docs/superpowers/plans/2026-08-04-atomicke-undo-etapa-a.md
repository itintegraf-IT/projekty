# Atomické undo — etapa A, implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Celý krok historie (Ctrl+Z / Ctrl+Shift+Z) proběhne v jedné serverové transakci — buď celý, nebo se nezmění vůbec nic.

**Architecture:** Nový endpoint `POST /api/blocks/undo` přijme seznam operací (`upsert` / `remove`) a provede je v jedné Prisma transakci. Undo vrací stav, který v DB prokazatelně existoval, takže endpoint zapisuje hodnoty **doslova** a nespouští validaci harmonogramu — nevolá `expandPrintTime`, takže mřížkovou bránu nepotřebuje. Optimistic lock všech cílů se ověří najednou před prvním zápisem; `assertNoOverlapForBlocks` běží vždy na konci. Klientské buildery v `src/lib/undo/commands.ts` se překlápějí ze sekvence HTTP volání na jediné volání endpointu.

**Tech Stack:** Next.js 16 App Router · TypeScript · Prisma 5 · MySQL · node:test + tsx

**Spec:** `docs/superpowers/specs/2026-08-04-atomicke-undo-design.md`
**Výzkum:** `docs/audits/2026-08-04-undo-atomicita-vyzkum.md`

## Global Constraints

- Větev `Vojta`. Commit po každém Tasku. **Po Tasku 4 a po Tasku 8 zastavit a počkat na OK.**
- Chyby v API výhradně přes `AppError` (`src/lib/errors.ts`), status přes `errorStatus` — žádná lokální mapa kód→HTTP.
- Auth v nové route přes `requireRole([...])` **uvnitř try** (hází `UNAUTHORIZED`/`FORBIDDEN` do catch).
- Logování přes `logger` (`src/lib/logger.ts`), nikdy `console.*` v API route.
- Každá mutace v `$transaction` společně se zápisem do `AuditLog`.
- **Žádná změna DB schématu ani migrace v celé etapě A.**
- Nové komponenty/moduly jako named export, ne inline do velkých souborů.
- Testovací příkaz (celá suite, 560 testů):
  `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
- `npm run build` musí být zelený před každým commitem; `npm run lint` 0 chyb (warningy tolerované).

## File Structure

| Soubor | Odpovědnost |
| --- | --- |
| `src/lib/undo/restoreFields.ts` (nový) | Allowlist obnovitelných sloupců + `blockToRestoreFields` (Block → snapshot polí) |
| `src/lib/undo/restoreFields.test.ts` (nový) | Tripwire nad allowlistem |
| `src/lib/undoApply.server.ts` (nový) | `sanitizeUndoOps` (čistá validace) + `applyUndoOps` (tělo transakce) |
| `src/lib/undoApply.server.test.ts` (nový) | Testy obou funkcí nad fake `tx` |
| `src/app/api/blocks/undo/route.ts` (nový) | Tenká slupka: requireRole, parse, `$transaction`, SSE, catch |
| `src/lib/undo/types.ts` | Typy `UndoOp`/`UndoRequest`/`UndoResponse`, `UndoEffects.applyUndo` |
| `src/lib/undo/commands.ts` | Šest builderů překlopených na jediné volání `applyUndo` |
| `src/lib/undo/commands.test.ts` | Přepsané testy builderů |
| `src/app/_components/PlannerPage.tsx` | Implementace efektu `applyUndo` |
| `src/app/_components/useUndoManager.ts` | Hláška s příčinou ze serveru |
| `src/components/InfoPanel.tsx`, `src/components/BlockDetail.tsx` | Popisek akcí `UNDO`/`REDO` v historii |

---

## Task 1: Allowlist obnovitelných polí

**Files:**
- Create: `src/lib/undo/restoreFields.ts`
- Test: `src/lib/undo/restoreFields.test.ts`

**Interfaces:**
- Consumes: nic
- Produces: `UNDO_RESTORABLE_FIELDS: readonly string[]`, `isRestorableField(k: string): boolean`, `blockToRestoreFields(block: RestoreSource): Record<string, unknown>`

**Kontext:** `Block` má 51 skalárních sloupců. Osm z nich undo obnovovat **nesmí**: `id` (nese ho `op.id`), `createdAt`/`updatedAt` (spravuje Prisma), `printCompletedAt`/`printCompletedByUserId`/`printCompletedByUsername` (potvrzení tisku má vlastní endpoint), `reservationId` (business vazba na rezervaci) a `recurrenceParentId` (série — undo je na standalone bloky guardované). Zbylých 43 je povoleno.

Tohle **není** `blockToCreatePayload` — ten je tvarovaný pro POST route a spoléhá na její odvozeniny (`dataOk` si dopočítá z `dataStatusId`, `recurrenceType` posílá natvrdo `"NONE"`). Undo žádné odvozeniny spouštět nesmí.

- [ ] **Step 1: Napsat padající test**

```typescript
// src/lib/undo/restoreFields.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { UNDO_RESTORABLE_FIELDS, isRestorableField, blockToRestoreFields } from "./restoreFields";

const FORBIDDEN = [
  "id", "createdAt", "updatedAt", "reservationId", "recurrenceParentId",
  "printCompletedAt", "printCompletedByUserId", "printCompletedByUsername",
];

test("allowlist neobsahuje žádné zakázané pole", () => {
  for (const f of FORBIDDEN) {
    assert.equal(UNDO_RESTORABLE_FIELDS.includes(f as never), false, `${f} nesmí být obnovitelné`);
  }
});

test("allowlist má přesně 43 položek (tripwire — nové pole Blocku se přidává vědomě)", () => {
  assert.equal(UNDO_RESTORABLE_FIELDS.length, 43);
  assert.equal(new Set(UNDO_RESTORABLE_FIELDS).size, 43, "duplicita v allowlistu");
});

test("isRestorableField pouští povolená a blokuje zakázaná", () => {
  assert.equal(isRestorableField("startTime"), true);
  assert.equal(isRestorableField("scheduleBypassed"), true);
  assert.equal(isRestorableField("printCompletedAt"), false);
  assert.equal(isRestorableField("neexistujiciSloupec"), false);
});

test("blockToRestoreFields vrátí jen povolená pole a zahodí zbytek", () => {
  const fields = blockToRestoreFields({
    id: 7,
    orderNumber: "17300",
    machine: "XL_105",
    startTime: "2026-09-02T04:00:00.000Z",
    endTime: "2026-09-02T06:00:00.000Z",
    type: "ZAKAZKA",
    printMinutes: 120,
    scheduleBypassed: false,
    dataOk: true,
    specifikace: "Lak jen na obálce",
    printCompletedAt: "2026-09-01T10:00:00.000Z",
    reservationId: 18,
    updatedAt: "2026-09-01T10:00:00.000Z",
  } as never);
  assert.equal(fields.orderNumber, "17300");
  assert.equal(fields.dataOk, true, "dataOk se obnovuje přímo, ne odvozením");
  assert.equal("id" in fields, false);
  assert.equal("printCompletedAt" in fields, false);
  assert.equal("reservationId" in fields, false);
  assert.equal("updatedAt" in fields, false);
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

Run: `node --test --import tsx src/lib/undo/restoreFields.test.ts`
Expected: FAIL — `Cannot find module './restoreFields'`

- [ ] **Step 3: Implementovat**

```typescript
// src/lib/undo/restoreFields.ts
/**
 * Sloupce `Block`, které undo obnovuje DOSLOVA.
 *
 * NENÍ to `blockToCreatePayload` — ten je tvarovaný pro POST /api/blocks
 * a spoléhá na její odvozeniny (`dataOk` si server dopočítá z `dataStatusId`,
 * `recurrenceType` posílá natvrdo "NONE"). Undo vrací stav, který v DB
 * existoval, takže žádné odvozeniny spouštět nesmí a hodnoty jdou ze sloupců.
 *
 * Vědomě VYNECHANÉ (8 sloupců):
 *   id, createdAt, updatedAt      — spravuje Prisma / nese je op.id
 *   printCompleted{At,ByUserId,ByUsername} — potvrzení tisku má vlastní endpoint
 *   reservationId                 — business vazba, undo ji nesmí přepojit
 *   recurrenceParentId            — série; undo je guardované na standalone bloky
 *
 * Počet drží tripwire v restoreFields.test.ts — nový sloupec Blocku se sem
 * přidává vědomě (a nikdy nemizí tiše).
 */
export const UNDO_RESTORABLE_FIELDS = [
  // pozice a tiskové hodiny
  "machine", "startTime", "endTime", "printMinutes", "scheduleBypassed",
  // identita
  "orderNumber", "type", "blockVariant", "locked", "splitGroupId", "recurrenceType",
  // popis a preset
  "description", "jobPresetId", "jobPresetLabel", "specifikace",
  // DATA
  "dataStatusId", "dataStatusLabel", "dataRequiredDate", "dataOk",
  // MATERIÁL
  "materialStatusId", "materialStatusLabel", "materialRequiredDate", "materialOk",
  "materialNote", "materialNoteByUsername", "materialInStock", "materialIssued",
  // PANTONE
  "pantoneRequired", "pantoneOk", "pantoneRequiredDate",
  // barvy / lak
  "barvyStatusId", "barvyStatusLabel", "lakStatusId", "lakStatusLabel",
  // výrobní štítky
  "obalka", "vnitrky", "tiskoveArchy", "serie",
  // expedice
  "deadlineExpedice", "doprava", "expediceNote",
  "expeditionPublishedAt", "expeditionSortOrder",
] as const;

export type UndoRestorableField = (typeof UNDO_RESTORABLE_FIELDS)[number];

const ALLOWED = new Set<string>(UNDO_RESTORABLE_FIELDS);

export function isRestorableField(key: string): key is UndoRestorableField {
  return ALLOWED.has(key);
}

/** Cokoliv, co má sloupce Blocku — Prisma řádek i serializovaný klientský blok. */
export type RestoreSource = Record<string, unknown>;

/** Block → snapshot obnovitelných polí. Nepovolené klíče tiše zahodí. */
export function blockToRestoreFields(block: RestoreSource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of UNDO_RESTORABLE_FIELDS) {
    if (key in block) out[key] = block[key];
  }
  return out;
}
```

- [ ] **Step 4: Spustit test a ověřit, že prochází**

Run: `node --test --import tsx src/lib/undo/restoreFields.test.ts`
Expected: PASS (4 testy)

- [ ] **Step 5: Commit**

```bash
git add src/lib/undo/restoreFields.ts src/lib/undo/restoreFields.test.ts
git commit -m "feat(undo): allowlist obnovitelných polí bloku"
```

---

## Task 2: Validace operací (čistá funkce)

**Files:**
- Create: `src/lib/undoApply.server.ts`
- Test: `src/lib/undoApply.server.test.ts`

**Interfaces:**
- Consumes: `isRestorableField` (Task 1), `AppError` z `@/lib/errors`
- Produces:
  ```typescript
  export type UndoOp =
    | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
    | { kind: "remove"; id: number; expectedUpdatedAt?: string };
  export type UndoDirection = "undo" | "redo";
  export function sanitizeUndoOps(raw: unknown): UndoOp[];
  ```

**Kontext:** Endpoint nesmí být univerzální zápis do `Block`. `sanitizeUndoOps` je jediná brána mezi tělem requestu a transakcí — kontroluje tvar, allowlist polí a povinná pole pro vytvoření. Je čistá (žádné DB), takže se testuje bez mocků.

Povinná pole pro vytvoření chybějícího bloku (sloupce bez defaultu a bez `?`): `orderNumber`, `machine`, `startTime`, `endTime`. Kontrolují se až v `applyUndoOps`, kde je vidět, jestli řádek existuje — tady se jen ověří tvar.

- [ ] **Step 1: Napsat padající test**

```typescript
// src/lib/undoApply.server.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUndoOps } from "./undoApply.server";
import { isAppError } from "./errors";

function rejects(raw: unknown, fragment: string) {
  try {
    sanitizeUndoOps(raw);
    assert.fail("mělo hodit AppError");
  } catch (e) {
    assert.ok(isAppError(e), "musí být AppError");
    assert.equal(e.code, "VALIDATION_ERROR");
    assert.ok(e.message.includes(fragment), `hláška "${e.message}" neobsahuje "${fragment}"`);
  }
}

test("sanitizeUndoOps propustí platný upsert i remove", () => {
  const ops = sanitizeUndoOps([
    { kind: "upsert", id: 1, expectedUpdatedAt: "2026-08-01T10:00:00.000Z", fields: { startTime: "2026-09-02T04:00:00.000Z" } },
    { kind: "remove", id: 2 },
  ]);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].kind, "upsert");
  assert.equal(ops[1].kind, "remove");
});

test("sanitizeUndoOps odmítne pole mimo allowlist", () => {
  rejects([{ kind: "upsert", id: 1, fields: { printCompletedAt: "2026-08-01T00:00:00.000Z" } }], "printCompletedAt");
  rejects([{ kind: "upsert", id: 1, fields: { reservationId: 5 } }], "reservationId");
});

test("sanitizeUndoOps odmítne prázdný seznam a neznámý druh operace", () => {
  rejects([], "prázdn");
  rejects([{ kind: "smaz-vsechno", id: 1 }], "Neznámá operace");
});

test("sanitizeUndoOps odmítne neplatné id a duplicitní id", () => {
  rejects([{ kind: "remove", id: 0 }], "id");
  rejects([{ kind: "remove", id: -3 }], "id");
  rejects([{ kind: "remove", id: 1 }, { kind: "upsert", id: 1, fields: {} }], "vícekrát");
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

Run: `node --test --import tsx src/lib/undoApply.server.test.ts`
Expected: FAIL — `Cannot find module './undoApply.server'`

- [ ] **Step 3: Implementovat**

```typescript
// src/lib/undoApply.server.ts
import { AppError } from "@/lib/errors";
import { isRestorableField } from "@/lib/undo/restoreFields";

export type UndoOp =
  | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
  | { kind: "remove"; id: number; expectedUpdatedAt?: string };

export type UndoDirection = "undo" | "redo";

/** Sloupce bez defaultu a bez `?` — bez nich Prisma create neprojde. */
export const REQUIRED_ON_CREATE = ["orderNumber", "machine", "startTime", "endTime"] as const;

function bad(message: string): never {
  throw new AppError("VALIDATION_ERROR", message);
}

/**
 * Jediná brána mezi tělem requestu a transakcí. Endpoint NESMÍ být univerzální
 * zápis do Block — všechno, co projde sem, se zapíše doslova bez další validace.
 */
export function sanitizeUndoOps(raw: unknown): UndoOp[] {
  if (!Array.isArray(raw) || raw.length === 0) bad("Seznam operací je prázdný nebo není pole.");
  if (raw.length > 200) bad("Seznam operací je příliš dlouhý (max 200).");

  const seen = new Set<number>();
  const ops: UndoOp[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) bad("Operace není objekt.");
    const o = item as Record<string, unknown>;

    if (!Number.isInteger(o.id) || (o.id as number) <= 0) bad(`Neplatné id bloku: ${String(o.id)}`);
    const id = o.id as number;
    if (seen.has(id)) bad(`Blok ${id} je v dávce vícekrát — undo musí mít na blok jedinou operaci.`);
    seen.add(id);

    let expectedUpdatedAt: string | undefined;
    if (o.expectedUpdatedAt !== undefined) {
      if (typeof o.expectedUpdatedAt !== "string" || Number.isNaN(new Date(o.expectedUpdatedAt).getTime())) {
        bad(`Neplatné expectedUpdatedAt u bloku ${id}.`);
      }
      expectedUpdatedAt = o.expectedUpdatedAt;
    }

    if (o.kind === "remove") {
      ops.push({ kind: "remove", id, expectedUpdatedAt });
      continue;
    }
    if (o.kind !== "upsert") bad(`Neznámá operace: ${String(o.kind)}`);

    if (typeof o.fields !== "object" || o.fields === null || Array.isArray(o.fields)) {
      bad(`Chybí fields u bloku ${id}.`);
    }
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(o.fields as Record<string, unknown>)) {
      if (!isRestorableField(key)) bad(`Pole "${key}" undo obnovovat nesmí (blok ${id}).`);
      fields[key] = value;
    }
    ops.push({ kind: "upsert", id, expectedUpdatedAt, fields });
  }
  return ops;
}
```

- [ ] **Step 4: Spustit test a ověřit, že prochází**

Run: `node --test --import tsx src/lib/undoApply.server.test.ts`
Expected: PASS (4 testy)

- [ ] **Step 5: Commit**

```bash
git add src/lib/undoApply.server.ts src/lib/undoApply.server.test.ts
git commit -m "feat(undo): validace operací undo dávky"
```

---

## Task 3: Provedení dávky v transakci

**Files:**
- Modify: `src/lib/undoApply.server.ts`
- Test: `src/lib/undoApply.server.test.ts`

**Interfaces:**
- Consumes: `UndoOp`, `sanitizeUndoOps` (Task 2), `assertNoOverlapForBlocks` z `@/lib/overlapCheck`, `logger`
- Produces:
  ```typescript
  export type UndoActor = { id: number; username: string };
  export type UndoApplyResult = { updatedIds: number[]; createdIds: number[]; removedIds: number[] };
  export async function applyUndoOps(
    tx: PrismaTransactionClient,
    ops: UndoOp[],
    actor: UndoActor,
    label: string,
    direction: UndoDirection,
  ): Promise<UndoApplyResult>;
  ```

**Kontext — pořadí uvnitř transakce (na tomhle stojí celá etapa):**

1. Načíst existující řádky (`findMany`) — **jednou, uvnitř transakce**.
2. Ověřit **všechny** `expectedUpdatedAt` — neshoda → `AppError("CONFLICT")`, nic se nezapsalo.
3. Ověřit business pravidlo: `remove` bloku s `printCompletedAt` → `AppError("CONFLICT")`.
4. Ověřit povinná pole u upsertů, jejichž řádek neexistuje (= vytvoření).
5. Provést `remove` (uvolnit místo), pak `upsert`.
6. Audit `createMany`.
7. `assertNoOverlapForBlocks` pro každý **cílový** stroj upsertů.

Rané overlap kontroly se **nespouštějí vůbec** — mezistavy uvnitř transakce nikdo nevidí a finální pojistka zachytí výsledek. Tím zmizí celý problém pořadí kroků, na kterém dnešní undo stojí.

- [ ] **Step 1: Napsat padající testy**

```typescript
// přidat na konec src/lib/undoApply.server.test.ts
import { mock } from "node:test";
import { applyUndoOps } from "./undoApply.server";

type Row = {
  id: number; orderNumber: string | null; machine: string;
  startTime: Date; endTime: Date; updatedAt: Date; printCompletedAt: Date | null;
};

const T = (iso: string) => new Date(iso);
const actor = { id: 42, username: "planovac" };

function row(over: Partial<Row> = {}): Row {
  return {
    id: 1, orderNumber: "17300", machine: "XL_105",
    startTime: T("2026-09-02T14:00:00.000Z"), endTime: T("2026-09-02T16:00:00.000Z"),
    updatedAt: T("2026-08-01T10:00:00.000Z"), printCompletedAt: null, ...over,
  };
}

/** Fake tx podle vzoru reflow.server.test.ts — obyčejné objekty s mock.fn. */
function mkTx(rows: Row[], opts: { conflicts?: { id: number; orderNumber: string | null }[] } = {}) {
  const store = new Map(rows.map((r) => [r.id, r]));
  const updateMock = mock.fn(async (a: { where: { id: number }; data: Record<string, unknown> }) => {
    const cur = store.get(a.where.id)!;
    const next = { ...cur, ...a.data } as Row;
    store.set(a.where.id, next);
    return next;
  });
  const createMock = mock.fn(async (a: { data: Record<string, unknown> }) => {
    const next = { ...row(), ...a.data } as Row;
    store.set(next.id, next);
    return next;
  });
  const deleteMock = mock.fn(async (a: { where: { id: number } }) => {
    const cur = store.get(a.where.id);
    store.delete(a.where.id);
    return cur ?? null;
  });
  const auditMock = mock.fn(async (a: { data: unknown[] }) => ({ count: a.data.length }));
  const tx = {
    block: {
      findMany: mock.fn(async (a: { where: { id: { in: number[] } } }) =>
        a.where.id.in.map((i) => store.get(i)).filter(Boolean)),
      update: updateMock, create: createMock, delete: deleteMock,
    },
    auditLog: { createMany: auditMock },
    $queryRaw: mock.fn(async () => opts.conflicts ?? []),
  } as never;
  return { tx, store, updateMock, createMock, deleteMock, auditMock };
}

test("applyUndoOps: upsert zapíše off-grid start doslova (opravený incident 4. 8.)", async () => {
  const { tx, store, updateMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T14:45:00.000Z", endTime: "2026-09-02T16:45:00.000Z", machine: "XL_105" },
  }], actor, "Přesun bloku", "undo");
  assert.equal(updateMock.mock.callCount(), 1);
  assert.equal(store.get(1)!.startTime, "2026-09-02T14:45:00.000Z");
});

test("applyUndoOps: upsert zachová endTime přes noční pauzu (žádný přepočet)", async () => {
  const { tx, store } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { startTime: "2026-09-02T18:00:00.000Z", endTime: "2026-09-03T06:00:00.000Z", printMinutes: 240, machine: "XL_105" },
  }], actor, "Přesun bloku", "undo");
  assert.equal(store.get(1)!.endTime, "2026-09-03T06:00:00.000Z", "endTime se NEsmí dopočítat z printMinutes");
});

test("applyUndoOps: stale expectedUpdatedAt → CONFLICT a ŽÁDNÝ zápis", async () => {
  const { tx, updateMock, deleteMock, auditMock } = mkTx([row(), row({ id: 2 })]);
  await assert.rejects(
    () => applyUndoOps(tx, [
      { kind: "upsert", id: 1, expectedUpdatedAt: "2026-08-01T10:00:00.000Z", fields: { machine: "XL_106" } },
      { kind: "upsert", id: 2, expectedUpdatedAt: "1999-01-01T00:00:00.000Z", fields: { machine: "XL_106" } },
    ], actor, "Přesun bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "CONFLICT",
  );
  assert.equal(updateMock.mock.callCount(), 0, "zámek se kontroluje PŘED prvním zápisem");
  assert.equal(deleteMock.mock.callCount(), 0);
  assert.equal(auditMock.mock.callCount(), 0);
});

test("applyUndoOps: remove neexistujícího bloku je úspěch (idempotence)", async () => {
  const { tx, deleteMock } = mkTx([]);
  const res = await applyUndoOps(tx, [{ kind: "remove", id: 99 }], actor, "Vložení bloku", "undo");
  assert.deepEqual(res.removedIds, []);
  assert.equal(deleteMock.mock.callCount(), 0, "chybějící řádek se nemaže, jen se přeskočí");
});

test("applyUndoOps: remove bloku s potvrzeným tiskem → CONFLICT", async () => {
  const { tx, deleteMock } = mkTx([row({ printCompletedAt: T("2026-09-01T12:00:00.000Z") })]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "remove", id: 1 }], actor, "Vložení bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "CONFLICT",
  );
  assert.equal(deleteMock.mock.callCount(), 0);
});

test("applyUndoOps: upsert chybějícího bloku ho vytvoří s PŮVODNÍM id", async () => {
  const { tx, createMock, store } = mkTx([]);
  const res = await applyUndoOps(tx, [{
    kind: "upsert", id: 738,
    fields: { orderNumber: "17300", machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" },
  }], actor, "Smazání bloku", "undo");
  assert.deepEqual(res.createdIds, [738]);
  assert.equal((createMock.mock.calls[0].arguments[0] as { data: { id: number } }).data.id, 738);
  assert.ok(store.has(738));
});

test("applyUndoOps: vytvoření bez povinného pole → VALIDATION_ERROR", async () => {
  const { tx, createMock } = mkTx([]);
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 738, fields: { orderNumber: "17300" } }], actor, "Smazání bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "VALIDATION_ERROR",
  );
  assert.equal(createMock.mock.callCount(), 0);
});

test("applyUndoOps: výsledný překryv → OVERLAP (pojistka nemá únikovou cestu)", async () => {
  const { tx } = mkTx([row()], { conflicts: [{ id: 2, orderNumber: "17301" }] });
  await assert.rejects(
    () => applyUndoOps(tx, [{ kind: "upsert", id: 1, fields: { machine: "XL_105", startTime: "2026-09-02T14:00:00.000Z", endTime: "2026-09-02T16:00:00.000Z" } }],
      actor, "Přesun bloku", "undo"),
    (e: unknown) => isAppError(e) && e.code === "OVERLAP",
  );
});

test("applyUndoOps: zapíše audit s akcí UNDO a spanem start–end", async () => {
  const { tx, auditMock } = mkTx([row()]);
  await applyUndoOps(tx, [{
    kind: "upsert", id: 1,
    fields: { machine: "XL_105", startTime: "2026-09-02T10:00:00.000Z", endTime: "2026-09-02T12:00:00.000Z" },
  }], actor, "Přesun bloku", "undo");
  const rows = (auditMock.mock.calls[0].arguments[0] as { data: Record<string, unknown>[] }).data;
  assert.equal(rows[0].action, "UNDO");
  assert.equal(rows[0].userId, 42);
  assert.ok(String(rows[0].oldValue).includes("–"), "oldValue je span 'start–end'");
  assert.ok(String(rows[0].newValue).includes("2026-09-02T10:00:00.000Z"));
});
```

- [ ] **Step 2: Spustit testy a ověřit, že padají**

Run: `node --test --import tsx src/lib/undoApply.server.test.ts`
Expected: FAIL — `applyUndoOps is not a function`

- [ ] **Step 3: Implementovat**

```typescript
// přidat do src/lib/undoApply.server.ts
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
import { logger } from "@/lib/logger";
import { SLOT_MS } from "@/lib/timeSlots";

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

export type UndoActor = { id: number; username: string };
export type UndoApplyResult = { updatedIds: number[]; createdIds: number[]; removedIds: number[] };

const span = (start: unknown, end: unknown) =>
  `${new Date(start as string).toISOString()}–${new Date(end as string).toISOString()}`;

/**
 * Provede celou undo dávku. Volá se UVNITŘ `prisma.$transaction` — buď projde
 * celá, nebo se rollbackne a nezmění se nic.
 *
 * ZÁMĚRNĚ NEVOLÁ `validateAndComputeEnd`. Undo vrací stav, který v DB
 * prokazatelně existoval; měřit ho dnešními pravidly je kategorická chyba
 * (přesně to dnes rozbíjí návrat bloků mimo 30min mřížku). Endpoint nevolá
 * ani `expandPrintTime`, takže mřížkovou bránu nepotřebuje — ta je jen
 * předsazená pojistka před tvrdým throwem uvnitř expanze.
 *
 * Co běží VŽDY: optimistic lock, zákaz smazat vytištěný blok a finální
 * `assertNoOverlapForBlocks`. Rané overlap kontroly se nespouštějí vůbec —
 * mezistavy uvnitř transakce nikdo nevidí, takže na pořadí operací nezáleží.
 */
export async function applyUndoOps(
  tx: PrismaTransactionClient,
  ops: UndoOp[],
  actor: UndoActor,
  label: string,
  direction: UndoDirection,
): Promise<UndoApplyResult> {
  const ids = ops.map((o) => o.id);
  const existing = await tx.block.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderNumber: true, machine: true, startTime: true, endTime: true, updatedAt: true, printCompletedAt: true },
  });
  const byId = new Map(existing.map((b) => [b.id, b]));

  // ── 1. Optimistic lock — VŠECHNY najednou, PŘED prvním zápisem ───────────
  const stale: number[] = [];
  for (const op of ops) {
    if (!op.expectedUpdatedAt) continue;
    const row = byId.get(op.id);
    if (!row) continue; // chybějící řádek řeší větev create / idempotentní remove
    if (row.updatedAt.getTime() !== new Date(op.expectedUpdatedAt).getTime()) stale.push(op.id);
  }
  if (stale.length > 0) {
    throw new AppError("CONFLICT", `Bloky byly mezitím změněny jiným uživatelem: ${stale.join(", ")}`);
  }

  // ── 2. Business pravidlo: vytištěný blok se nemaže ───────────────────────
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    const row = byId.get(op.id);
    if (row?.printCompletedAt) {
      throw new AppError(
        "CONFLICT",
        `Tisk bloku #${row.orderNumber ?? row.id} mezitím potvrdil tiskař — vrácení zpět by smazalo hotovou práci.`,
      );
    }
  }

  // ── 3. Povinná pole u vytvoření ──────────────────────────────────────────
  for (const op of ops) {
    if (op.kind !== "upsert" || byId.has(op.id)) continue;
    const missing = REQUIRED_ON_CREATE.filter((f) => op.fields[f] === undefined || op.fields[f] === null);
    if (missing.length > 0) {
      throw new AppError("VALIDATION_ERROR", `Obnova bloku ${op.id} nemá povinná pole: ${missing.join(", ")}.`);
    }
  }

  const result: UndoApplyResult = { updatedIds: [], createdIds: [], removedIds: [] };
  const auditRows: Record<string, unknown>[] = [];
  const machinesToCheck = new Set<string>();

  // ── 4. Nejdřív mazání (uvolní místo), pak zápisy ─────────────────────────
  for (const op of ops) {
    if (op.kind !== "remove") continue;
    const row = byId.get(op.id);
    if (!row) continue; // idempotence: co neexistuje, je už smazané
    await tx.block.delete({ where: { id: op.id } });
    result.removedIds.push(op.id);
    auditRows.push({
      blockId: op.id, orderNumber: row.orderNumber, userId: actor.id, username: actor.username,
      action: direction === "undo" ? "UNDO" : "REDO",
      field: "delete", oldValue: span(row.startTime, row.endTime), newValue: null,
    });
  }

  for (const op of ops) {
    if (op.kind !== "upsert") continue;
    const row = byId.get(op.id);
    const data = toPrismaData(op.fields);

    if (row) {
      const saved = await tx.block.update({ where: { id: op.id }, data });
      result.updatedIds.push(op.id);
      machinesToCheck.add(saved.machine);
      auditRows.push({
        blockId: op.id, orderNumber: saved.orderNumber, userId: actor.id, username: actor.username,
        action: direction === "undo" ? "UNDO" : "REDO",
        field: "startTime/endTime/machine",
        oldValue: span(row.startTime, row.endTime),
        newValue: span(saved.startTime, saved.endTime),
      });
    } else {
      // Obnova s PŮVODNÍM id — historie v AuditLogu a notifikace zůstanou
      // navázané. MySQL AUTO_INCREMENT se explicitním vložením nižší hodnoty
      // nesnižuje, takže budoucí kolize nehrozí.
      const saved = await tx.block.create({ data: { ...data, id: op.id } });
      result.createdIds.push(op.id);
      machinesToCheck.add(saved.machine);
      auditRows.push({
        blockId: op.id, orderNumber: saved.orderNumber, userId: actor.id, username: actor.username,
        action: direction === "undo" ? "UNDO" : "REDO",
        field: "restore", oldValue: null, newValue: span(saved.startTime, saved.endTime),
      });
    }

    warnIfUnusual(op);
  }

  if (auditRows.length > 0) await tx.auditLog.createMany({ data: auditRows as never });

  // ── 5. Finální pojistka — běží VŽDY, bez únikové cesty ───────────────────
  // Stroje z CÍLOVÉHO stavu: funkce filtruje `machine = ?`, takže přesun na
  // jiný stroj musí kontrolovat ten nový. Stroje, ze kterých se jen odcházelo,
  // kontrolu nepotřebují — uvolněné místo překryv nevyrobí.
  const upsertedIds = [...result.updatedIds, ...result.createdIds];
  for (const machine of machinesToCheck) {
    await assertNoOverlapForBlocks(machine, upsertedIds, tx);
  }

  logger.info(`[undo] ${direction} "${label}" — ${result.updatedIds.length} upraveno, ${result.createdIds.length} obnoveno, ${result.removedIds.length} smazáno`);
  return result;
}

/** Datumové sloupce přicházejí jako ISO string; Prisma chce Date. */
const DATE_FIELDS = new Set([
  "startTime", "endTime", "deadlineExpedice", "dataRequiredDate",
  "materialRequiredDate", "pantoneRequiredDate", "expeditionPublishedAt",
]);

function toPrismaData(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = DATE_FIELDS.has(k) && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

/** Obnova mimo mřížku je legitimní (legacy bloky), ale produkce o ní má vědět. */
function warnIfUnusual(op: Extract<UndoOp, { kind: "upsert" }>): void {
  const start = op.fields.startTime;
  if (typeof start !== "string") return;
  const t = new Date(start).getTime();
  if (!Number.isNaN(t) && t % SLOT_MS !== 0) {
    logger.warn(`[undo] blok ${op.id} obnoven na start mimo 30min mřížku (${start}) — legacy blok před modelem tiskových hodin`);
  }
}
```

- [ ] **Step 4: Spustit testy a ověřit, že prochází**

Run: `node --test --import tsx src/lib/undoApply.server.test.ts`
Expected: PASS (13 testů celkem — 4 z Tasku 2 + 9 nových)

- [ ] **Step 5: Ověřit build**

Run: `npm run build`
Expected: zelený

- [ ] **Step 6: Commit**

```bash
git add src/lib/undoApply.server.ts src/lib/undoApply.server.test.ts
git commit -m "feat(undo): atomické provedení undo dávky v transakci"
```

---

## Task 4: API route `POST /api/blocks/undo`

**Files:**
- Create: `src/app/api/blocks/undo/route.ts`
- Modify: `src/components/InfoPanel.tsx:64`, `src/components/BlockDetail.tsx:582` (popisek akce)

**Interfaces:**
- Consumes: `sanitizeUndoOps`, `applyUndoOps` (Tasky 2–3), `requireRole`, `serializeBlock`, `emitSSE`, `errorStatus`
- Produces: HTTP kontrakt
  ```typescript
  // request
  { label: string; direction: "undo" | "redo"; ops: UndoOp[] }
  // response 200
  { updated: SerializedBlock[]; removed: number[] }
  ```

**Kontext:** Route je tenká slupka podle vzoru `src/app/api/blocks/batch/route.ts`, ale s `requireRole` **uvnitř try** (batch používá starší return-style gate — nekopírovat ho). SSE se mapuje na existující události, aby klientské handlery zůstaly beze změny: obnovený blok → `block:created`, upravený → `block:batch-updated`, smazaný → `block:deleted`.

- [ ] **Step 1: Implementovat route**

```typescript
// src/app/api/blocks/undo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isAppError, errorStatus, AppError } from "@/lib/errors";
import { serializeBlock } from "@/lib/blockSerialization";
import { emitSSE } from "@/lib/eventBus";
import { sanitizeUndoOps, applyUndoOps, type UndoDirection } from "@/lib/undoApply.server";

/**
 * Atomické undo/redo — celý krok historie v JEDNÉ transakci.
 *
 * Existuje proto, že undo se dřív provádělo jako sekvence nezávislých volání
 * (PUT, PUT, batch) bez transakce mezi nimi: cokoliv selhalo uprostřed, zůstalo
 * půl vrácené a další Ctrl+Z už nepomohl. Detaily → docs/superpowers/specs/2026-08-04-atomicke-undo-design.md
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireRole(["ADMIN", "PLANOVAT"]);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new AppError("VALIDATION_ERROR", "Neplatný JSON.");
    const { label, direction } = body as { label?: unknown; direction?: unknown };
    if (typeof label !== "string" || label.length === 0) throw new AppError("VALIDATION_ERROR", "Chybí label.");
    if (direction !== "undo" && direction !== "redo") throw new AppError("VALIDATION_ERROR", "direction musí být undo nebo redo.");

    const ops = sanitizeUndoOps((body as { ops?: unknown }).ops);

    const result = await prisma.$transaction(
      (tx) => applyUndoOps(tx, ops, { id: session.id, username: session.username }, label, direction as UndoDirection),
      { timeout: 15000, maxWait: 5000 },
    );

    const touched = [...result.updatedIds, ...result.createdIds];
    const rows = touched.length
      ? await prisma.block.findMany({
          where: { id: { in: touched } },
          include: { Reservation: { select: { confirmedAt: true } }, notes: { orderBy: { createdAt: "desc" as const } } },
        })
      : [];
    const serialized = rows.map(serializeBlock);

    // Mapování na EXISTUJÍCÍ události — klientské handlery zůstávají beze změny.
    const created = new Set(result.createdIds);
    const updatedSer = serialized.filter((b) => !created.has(b.id));
    if (updatedSer.length > 0) emitSSE("block:batch-updated", { blocks: updatedSer, sourceUserId: session.id });
    for (const b of serialized.filter((x) => created.has(x.id))) {
      emitSSE("block:created", { block: b, machine: b.machine, sourceUserId: session.id });
    }
    for (const id of result.removedIds) {
      emitSSE("block:deleted", { blockId: id, machine: null, sourceUserId: session.id });
    }

    return NextResponse.json({ updated: serialized, removed: result.removedIds });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message, code: err.code }, { status: errorStatus(err.code) });
    logger.error("[POST /api/blocks/undo] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Ověřit tvar `block:deleted` payloadu**

Run: `grep -rn "block:deleted" src/app/_components/ src/lib/`
Expected: zjistit, jestli klient `machine` u `block:deleted` používá. Pokud ano, doplnit stroj ze snímku před smazáním (rozšířit `UndoApplyResult` o `removed: Array<{ id: number; machine: string }>`). Pokud ne, `null` stačí.

- [ ] **Step 3: Doplnit popisek akce do historie**

V `src/components/InfoPanel.tsx` (za řádek s `AUTO_REFLOW`) a shodně v `src/components/BlockDetail.tsx`:

```tsx
{(log.action === "UNDO" || log.action === "REDO") && (
  <span style={{ color: "#64748b" }}>
    {" "}· {log.action === "UNDO" ? "↶ vráceno zpět" : "↷ znovu provedeno"}
    {log.oldValue && log.newValue && (
      <span style={{ color: "var(--text)" }}>: {fmtVal(log.oldValue, "startTime")} → {fmtVal(log.newValue, "startTime")}</span>
    )}
  </span>
)}
```

- [ ] **Step 4: Ověřit build a lint**

Run: `npm run build && npm run lint`
Expected: build zelený, lint 0 chyb

- [ ] **Step 5: Ruční smoke test endpointu**

Dev server běží. Přihlásit se jako ADMIN, pak v konzoli prohlížeče:

```javascript
await (await fetch("/api/blocks/undo", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ label: "smoke", direction: "undo", ops: [{ kind: "upsert", id: 1, fields: { printCompletedAt: "2026-01-01T00:00:00.000Z" } }] }),
})).json();
```
Expected: `{ error: 'Pole "printCompletedAt" undo obnovovat nesmí (blok 1).', code: "VALIDATION_ERROR" }` se statusem 400.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/blocks/undo/route.ts src/components/InfoPanel.tsx src/components/BlockDetail.tsx
git commit -m "feat(undo): endpoint POST /api/blocks/undo"
```

> **⏸ ZASTAVIT — server je hotový, klient se ještě nepřepojil. Počkat na OK Vojty.**

---

## Task 5: Efekt `applyUndo` na klientovi (aditivně)

**Files:**
- Modify: `src/lib/undo/types.ts`
- Modify: `src/app/_components/PlannerPage.tsx:160-197` (blok `undoEffects`)

**Interfaces:**
- Consumes: HTTP kontrakt z Tasku 4
- Produces:
  ```typescript
  export type UndoOpClient =
    | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
    | { kind: "remove"; id: number; expectedUpdatedAt?: string };
  export type UndoRequest = { label: string; direction: "undo" | "redo"; ops: UndoOpClient[] };
  export type UndoResponse = { updated: Block[]; removed: number[] };
  // v UndoEffects přibude:
  applyUndo(req: UndoRequest): Promise<UndoResponse>;
  ```

**Kontext:** Přidat **aditivně** — `putBlock`, `postBlock`, `deleteBlock`, `batchUpdate` zůstávají, aby build i testy zůstaly zelené a buildery se daly migrovat po jednom (Tasky 6–7). Odstraní se až v Tasku 8.

- [ ] **Step 1: Rozšířit typy**

```typescript
// src/lib/undo/types.ts — přidat nad UndoEffects
export type UndoOpClient =
  | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
  | { kind: "remove"; id: number; expectedUpdatedAt?: string };

export type UndoRequest = { label: string; direction: "undo" | "redo"; ops: UndoOpClient[] };
export type UndoResponse = { updated: Block[]; removed: number[] };
```

A do `interface UndoEffects` přidat:

```typescript
  /**
   * Atomické provedení celého kroku historie. Nahrazuje sekvenci
   * putBlock/batchUpdate/postBlock/deleteBlock — buď projde celá, nebo se
   * nezmění nic. Chybu ze serveru propaguje jako Error s její hláškou.
   */
  applyUndo(req: UndoRequest): Promise<UndoResponse>;
```

- [ ] **Step 2: Implementovat efekt v PlannerPage**

Do objektu `undoEffects` (vedle `batchUpdate`) přidat:

```typescript
    applyUndo: async (req) => {
      const r = await fetch("/api/blocks/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string; code?: string };
        const err = new Error(e.error ?? "Chyba serveru");
        // CONFLICT = někdo blok mezitím změnil → manager z toho udělá StaleUndoError
        (err as Error & { code?: string }).code = e.code;
        throw err;
      }
      return r.json();
    },
```

- [ ] **Step 3: Doplnit `applyUndo` do fake effects v testech**

V `src/lib/undo/commands.test.ts` do obou `makeEffects`/`makeEditEffects` přidat:

```typescript
    applyUndo: async () => { throw new Error("unused"); },
```

- [ ] **Step 4: Ověřit build a celou suite**

Run: `npm run build && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
Expected: build zelený, 573 testů (560 + 13 nových), 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/lib/undo/types.ts src/app/_components/PlannerPage.tsx src/lib/undo/commands.test.ts
git commit -m "feat(undo): klientský efekt applyUndo (aditivně, buildery zatím beze změny)"
```

---

## Task 6: Migrace pozičních builderů

**Files:**
- Modify: `src/lib/undo/commands.ts` (`buildMoveCommand`, `buildEditCommand`)
- Modify: `src/lib/undo/commands.test.ts`

**Interfaces:**
- Consumes: `UndoEffects.applyUndo` (Task 5)
- Produces: `buildMoveCommand` a `buildEditCommand` se stejnými signaturami, uvnitř jediné volání `applyUndo`. `buildMoveOrResizeCommand` je deleguje a **nemění se**.

**Kontext:** Sémantika zůstává. Mění se jen provedení: místo `batchUpdate` (a u editu `putBlock` + `batchUpdate`) jedno volání. `expectedUpdatedAt` se nově posílá **u každého cíle včetně sousedů** — endpoint kontroluje všechny najednou před prvním zápisem, takže se nemůžou navzájem shodit.

- [ ] **Step 1: Přepsat testy na nový tvar**

```typescript
// src/lib/undo/commands.test.ts — nahradit makeEffects
/** Fake effects: applyUndo aplikuje ops na živou mapu a bumpne updatedAt. */
function makeEffects(live: Map<number, Block>) {
  const calls = { undo: [] as UndoRequest[], added: [] as Block[][], removed: [] as number[][] };
  const effects: UndoEffects = {
    getLiveBlock: (id) => live.get(id),
    applyUndo: async (req) => {
      calls.undo.push(req);
      const updated: Block[] = [];
      const removed: number[] = [];
      for (const op of req.ops) {
        if (op.kind === "remove") { live.delete(op.id); removed.push(op.id); continue; }
        const cur = live.get(op.id);
        const next = { ...(cur ?? blk(op.id)), ...op.fields, id: op.id,
          updatedAt: (cur?.updatedAt ?? "v0") + "+" } as Block;
        live.set(op.id, next);
        updated.push(next);
      }
      return { updated, removed };
    },
    addToState: (blocks) => { calls.added.push(blocks); },
    removeFromState: (ids) => { calls.removed.push(ids); },
    putBlock: async () => { throw new Error("unused"); },
    postBlock: async () => { throw new Error("unused"); },
    deleteBlock: async () => { throw new Error("unused"); },
    batchUpdate: async () => { throw new Error("unused"); },
  };
  return { effects, calls };
}

test("buildMoveCommand: undo pošle JEDNO volání applyUndo se všemi pozicemi", async () => {
  const live = new Map([
    [1, blk(1, { startTime: "2026-07-10T10:00:00.000Z", updatedAt: "v2" })],
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const before = [
    { id: 1, startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z", machine: "XL_105", updatedAt: "v1" },
    { id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1" },
  ];
  const after = [
    { id: 1, startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z", machine: "XL_105", updatedAt: "v2" },
    { id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2" },
  ];
  await buildMoveCommand("Přesun", before, after).undo(effects);
  assert.equal(calls.undo.length, 1, "celý krok historie je JEDNO volání");
  assert.equal(calls.undo[0].direction, "undo");
  assert.equal(calls.undo[0].ops.length, 2);
  assert.equal((calls.undo[0].ops[0] as { expectedUpdatedAt?: string }).expectedUpdatedAt, "v2");
  assert.equal(live.get(1)!.startTime, "2026-07-10T08:00:00.000Z");
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z");
});

test("buildEditCommand: undo pošle primár i odsunuté sousedy v JEDNOM volání", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", updatedAt: "v2" })],
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildEditCommand(
    "Editace",
    { id: 1, updatedAt: "v1", fields: { description: "puvodni" } },
    { id: 1, updatedAt: "v2", fields: { description: "nove" } },
    [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1" }],
    [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2" }],
  );
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal(calls.undo[0].ops.length, 2, "primár + soused v jedné dávce");
  assert.equal(live.get(1)!.description, "puvodni");
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z");
});
```

Stávající testy `buildMoveCommand: guard hodí StaleUndoError…` a `…undo→redo funguje po osvěžení updatedAt` **ponechat beze změny** — ověřují klientský guard, který zůstává.

- [ ] **Step 2: Spustit testy a ověřit, že padají**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: FAIL — `effects.batchUpdate is not a function` / „unused"

- [ ] **Step 3: Přepsat buildery**

```typescript
// src/lib/undo/commands.ts — nahradit buildMoveCommand a buildEditCommand
import { StaleUndoError, type BlockSnapshot, type EditSnapshot, type HistoryEntry, type UndoEffects, type UndoOpClient } from "./types";

/** BlockSnapshot → operace obnovy pozice. */
function posOp(t: BlockSnapshot, expectedUpdatedAt?: string): UndoOpClient {
  return {
    kind: "upsert", id: t.id, expectedUpdatedAt,
    fields: { startTime: t.startTime, endTime: t.endTime, machine: t.machine },
  };
}

/** Odpověď serveru → osvěžení verzí ve snapshotech (aby další krok guardem prošel). */
function refresh(snapshots: Array<{ id: number; updatedAt: string }>, updated: Array<{ id: number; updatedAt: string }>) {
  const byId = new Map(updated.map((b) => [b.id, b.updatedAt]));
  for (const s of snapshots) { const u = byId.get(s.id); if (u) s.updatedAt = u; }
}

/**
 * Poziční přesun (drag / resize / lasso) + odsunutí sousedé — JEDNO atomické volání.
 * before/after jsou mutable: po každém apply se jejich updatedAt osvěží z odpovědi.
 */
export function buildMoveCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry {
  const apply = async (effects: UndoEffects, target: BlockSnapshot[], expected: BlockSnapshot[], direction: "undo" | "redo") => {
    guard(effects, expected);
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.applyUndo({
      label, direction,
      ops: target.map((t) => posOp(t, expMap.get(t.id))),
    });
    refresh(target, res.updated);
    effects.addToState(res.updated);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, "undo"),
    redo: (effects) => apply(effects, after, before, "redo"),
  };
}

/**
 * Editace polí primárního bloku + volitelná obnova odsunutých sousedů —
 * JEDNO atomické volání. Dřív to byl PUT následovaný batchem, mezi kterými
 * nebyla transakce: když selhal batch, editace zůstala provedená.
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
    target: EditSnapshot, expected: EditSnapshot,
    shiftedTarget: BlockSnapshot[], shiftedExpected: BlockSnapshot[],
    direction: "undo" | "redo",
  ) => {
    const live = effects.getLiveBlock(target.id);
    if (!live || live.updatedAt !== expected.updatedAt) throw new StaleUndoError();
    const expMap = new Map(shiftedExpected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.applyUndo({
      label, direction,
      ops: [
        { kind: "upsert", id: target.id, expectedUpdatedAt: expected.updatedAt, fields: target.fields },
        ...shiftedTarget.map((t) => posOp(t, expMap.get(t.id))),
      ],
    });
    refresh([target, ...shiftedTarget], res.updated);
    effects.addToState(res.updated);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, shiftedBefore, shiftedAfter, "undo"),
    redo: (effects) => apply(effects, after, before, shiftedAfter, shiftedBefore, "redo"),
  };
}
```

**Poznámka k `siblings`:** dřív se z odpovědi PUT dobíraly split sourozenci propagovaní serverem. Endpoint žádnou propagaci nespouští (zapisuje doslova), takže sourozenci musí být ve snapshotu jako samostatné cíle — to řeší Task 7 u `buildMultiEditCommand`. Tady je `buildEditCommand` používaný jen pro jednoblokové editace a resize, kde propagace nenastává.

- [ ] **Step 4: Spustit testy a ověřit, že prochází**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: PASS

- [ ] **Step 5: Ověřit build**

Run: `npm run build`
Expected: zelený

- [ ] **Step 6: Commit**

```bash
git add src/lib/undo/commands.ts src/lib/undo/commands.test.ts
git commit -m "refactor(undo): poziční buildery na atomický endpoint"
```

---

## Task 7: Migrace multi-edit, create a delete builderů

**Files:**
- Modify: `src/lib/undo/commands.ts` (`buildMultiEditCommand`, `buildCreateCommand`, `buildDeleteCommand`, smazat `restoreShifted`)
- Modify: `src/lib/undo/commands.test.ts`
- Modify: volající místa `buildDeleteCommand` (grep níž)

**Interfaces:**
- Consumes: `applyUndo`, `blockToRestoreFields` (Task 1)
- Produces:
  ```typescript
  export function buildMultiEditCommand(label, before: EditSnapshot[], after: EditSnapshot[], shiftedBefore?: BlockSnapshot[], shiftedAfter?: BlockSnapshot[]): HistoryEntry;
  export function buildCreateCommand(label, created: CreatedRef[], shiftedBefore?: BlockSnapshot[], shiftedAfter?: BlockSnapshot[]): HistoryEntry;
  // ZMĚNA SIGNATURY:
  type DeletedRef = { id: number; fields: Record<string, unknown> };
  export function buildDeleteCommand(label: string, deleted: DeletedRef[]): HistoryEntry;
  ```

**Kontext — tři zjednodušení, která atomicita umožňuje:**

1. **Pořadí přestává hrát roli.** `buildCreateCommand` dnes musí mazat před návratem sousedů a redo naopak, protože každý mezikrok narazil na finální pojistku batche. V jedné transakci mezistavy nikdo nevidí → obojí jde v jedné dávce.
2. **Odpadá `restoreShifted`** — sousedi jsou prostě další operace v téže dávce.
3. **`buildDeleteCommand` už neremapuje id** — blok se obnoví s původním, takže mizí pole `restoredId` a s ním celá třída duplicit z výzkumu (4.3).

`DeletedRef` mění tvar z `{ payload }` (POST payload) na `{ id, fields }` (přímý snapshot sloupců) — proto se musí upravit i volající místa.

- [ ] **Step 1: Najít volající místa `buildDeleteCommand`**

Run: `grep -rn "buildDeleteCommand" src --include="*.ts" --include="*.tsx"`
Expected: seznam míst, kde se skládá `payload` přes `blockToCreatePayload` — ta se přepíšou na `blockToRestoreFields`.

- [ ] **Step 2: Napsat padající testy**

```typescript
// src/lib/undo/commands.test.ts — přidat
test("buildCreateCommand: undo smaže vytvořený blok A vrátí sousedy v JEDNOM volání", async () => {
  const live = new Map([
    [10, blk(10, { updatedAt: "n1" })],                                        // vytvořený
    [2, blk(2, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "w2" })],   // odsunutý
  ]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildCreateCommand(
    "Vložení bloku",
    [{ id: 10, updatedAt: "n1", fields: { orderNumber: "X", machine: "XL_105", startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z" } }],
    [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1" }],
    [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2" }],
  );
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1, "smazání i návrat sousedů v jedné transakci");
  const kinds = calls.undo[0].ops.map((o) => o.kind).sort();
  assert.deepEqual(kinds, ["remove", "upsert"]);
  assert.equal(live.has(10), false);
  assert.equal(live.get(2)!.startTime, "2026-07-10T09:00:00.000Z");
});

test("buildCreateCommand: redo obnoví blok se STEJNÝM id (žádný remap)", async () => {
  const live = new Map([[2, blk(2, { startTime: "2026-07-10T09:00:00.000Z", updatedAt: "w1" })]]);
  const { effects } = makeEffects(live);
  const cmd = buildCreateCommand(
    "Vložení bloku",
    [{ id: 10, updatedAt: "n1", fields: { orderNumber: "X", machine: "XL_105", startTime: "2026-07-10T10:00:00.000Z", endTime: "2026-07-10T11:00:00.000Z" } }],
    [{ id: 2, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "w1" }],
    [{ id: 2, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "w2" }],
  );
  await cmd.redo(effects);
  assert.ok(live.has(10), "blok se vrátil pod původním id");
});

test("buildDeleteCommand: undo obnoví blok pod původním id, redo ho zase smaže", async () => {
  const live = new Map<number, Block>();
  const { effects, calls } = makeEffects(live);
  const cmd = buildDeleteCommand("Smazání bloku", [{
    id: 738,
    fields: { orderNumber: "17300", machine: "XL_105", startTime: "2026-07-10T08:00:00.000Z", endTime: "2026-07-10T09:00:00.000Z" },
  }]);
  await cmd.undo(effects);
  assert.ok(live.has(738));
  assert.equal(calls.undo[0].ops[0].kind, "upsert");
  await cmd.redo(effects);
  assert.equal(live.has(738), false);
  assert.equal(calls.undo[1].ops[0].kind, "remove");
});

test("buildMultiEditCommand: všechny cíle i sousedi v JEDNOM volání s expectedUpdatedAt", async () => {
  const live = new Map([
    [1, blk(1, { type: "ZAKAZKA", updatedAt: "a2" })],
    [2, blk(2, { type: "ZAKAZKA", updatedAt: "b2" })],
    [3, blk(3, { startTime: "2026-07-10T12:00:00.000Z", updatedAt: "c2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const cmd = buildMultiEditCommand(
    "Překlopení rezervace",
    [{ id: 1, updatedAt: "a1", fields: { type: "REZERVACE" } }, { id: 2, updatedAt: "b1", fields: { type: "REZERVACE" } }],
    [{ id: 1, updatedAt: "a2", fields: { type: "ZAKAZKA" } }, { id: 2, updatedAt: "b2", fields: { type: "ZAKAZKA" } }],
    [{ id: 3, startTime: "2026-07-10T09:00:00.000Z", endTime: "2026-07-10T10:00:00.000Z", machine: "XL_105", updatedAt: "c1" }],
    [{ id: 3, startTime: "2026-07-10T12:00:00.000Z", endTime: "2026-07-10T13:00:00.000Z", machine: "XL_105", updatedAt: "c2" }],
  );
  await cmd.undo(effects);
  assert.equal(calls.undo.length, 1);
  assert.equal(calls.undo[0].ops.length, 3);
  assert.equal((calls.undo[0].ops[0] as { expectedUpdatedAt?: string }).expectedUpdatedAt, "a2",
    "zámek jde nově i na multi-edit — endpoint kontroluje všechny najednou");
  assert.equal(live.get(1)!.type, "REZERVACE");
  assert.equal(live.get(3)!.startTime, "2026-07-10T09:00:00.000Z");
});
```

- [ ] **Step 3: Spustit testy a ověřit, že padají**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: FAIL

- [ ] **Step 4: Přepsat buildery**

```typescript
// src/lib/undo/commands.ts — nahradit tři buildery, SMAZAT restoreShifted

/**
 * Editace polí NĚKOLIKA bloků jako JEDEN krok historie (překlopení celé
 * rezervace, hromadné uložení) — JEDNO atomické volání.
 *
 * `expectedUpdatedAt` se nově posílá u KAŽDÉHO cíle. Dřív se vynechával,
 * protože sekvenční PUTy si navzájem bumpovaly verze přes serverovou propagaci
 * do split sourozenců. Endpoint čte stav jednou a zapisuje až po kontrole
 * všech zámků, takže si cíle nemůžou nic shodit.
 */
export function buildMultiEditCommand(
  label: string,
  before: EditSnapshot[],
  after: EditSnapshot[],
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry {
  const apply = async (
    effects: UndoEffects,
    targets: EditSnapshot[], expected: EditSnapshot[],
    shiftedTarget: BlockSnapshot[], shiftedExpected: BlockSnapshot[],
    direction: "undo" | "redo",
  ) => {
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    for (const t of targets) {
      const live = effects.getLiveBlock(t.id);
      const exp = expMap.get(t.id);
      if (!live || exp === undefined || live.updatedAt !== exp) throw new StaleUndoError();
    }
    const shiftMap = new Map(shiftedExpected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.applyUndo({
      label, direction,
      ops: [
        ...targets.map((t) => ({ kind: "upsert" as const, id: t.id, expectedUpdatedAt: expMap.get(t.id), fields: t.fields })),
        ...shiftedTarget.map((t) => posOp(t, shiftMap.get(t.id))),
      ],
    });
    refresh([...targets, ...shiftedTarget], res.updated);
    effects.addToState(res.updated);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, shiftedBefore, shiftedAfter, "undo"),
    redo: (effects) => apply(effects, after, before, shiftedAfter, shiftedBefore, "redo"),
  };
}

/** Snapshot vytvořeného bloku — `fields` slouží k obnově při redo. */
type CreatedRef = { id: number; updatedAt: string; fields: Record<string, unknown> };

/**
 * undo = smazat vytvořené bloky A vrátit odsunuté sousedy — v JEDNÉ transakci.
 * redo = obnovit bloky (pod PŮVODNÍM id) A znovu odsunout sousedy, taktéž
 * v jedné transakci.
 *
 * Dřív na pořadí záleželo (undo muselo mazat před návratem sousedů, redo
 * naopak), protože každý mezikrok narazil na finální pojistku batche. Uvnitř
 * transakce mezistavy nikdo nevidí, takže pořadí řeší server.
 */
export function buildCreateCommand(
  label: string,
  created: CreatedRef[],
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      for (const c of created) {
        const live = effects.getLiveBlock(c.id);
        if (!live || live.updatedAt !== c.updatedAt) throw new StaleUndoError();
      }
      guard(effects, shiftedAfter);
      const expMap = new Map(shiftedAfter.map((e) => [e.id, e.updatedAt]));
      const res = await effects.applyUndo({
        label, direction: "undo",
        ops: [
          ...created.map((c) => ({ kind: "remove" as const, id: c.id, expectedUpdatedAt: c.updatedAt })),
          ...shiftedBefore.map((t) => posOp(t, expMap.get(t.id))),
        ],
      });
      refresh(shiftedBefore, res.updated);
      effects.removeFromState(res.removed);
      effects.addToState(res.updated);
    },
    redo: async (effects) => {
      guard(effects, shiftedBefore);
      const expMap = new Map(shiftedBefore.map((e) => [e.id, e.updatedAt]));
      const res = await effects.applyUndo({
        label, direction: "redo",
        ops: [
          ...created.map((c) => ({ kind: "upsert" as const, id: c.id, fields: c.fields })),
          ...shiftedAfter.map((t) => posOp(t, expMap.get(t.id))),
        ],
      });
      refresh([...created, ...shiftedAfter], res.updated);
      effects.addToState(res.updated);
    },
  };
}

/** Snapshot smazaného bloku — `fields` z `blockToRestoreFields`. */
type DeletedRef = { id: number; fields: Record<string, unknown> };

/**
 * undo = obnovit smazané bloky pod PŮVODNÍM id; redo = smazat je znovu.
 *
 * Původní id znamená, že bloku zůstane navázaná historie v AuditLogu
 * i notifikace. Zároveň tím mizí remap (`restoredId`) a s ním třída duplicit,
 * kdy opakované Ctrl+Z vyrábělo další a další kopie.
 */
export function buildDeleteCommand(label: string, deleted: DeletedRef[]): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      const res = await effects.applyUndo({
        label, direction: "undo",
        ops: deleted.map((d) => ({ kind: "upsert" as const, id: d.id, fields: d.fields })),
      });
      effects.addToState(res.updated);
    },
    redo: async (effects) => {
      const res = await effects.applyUndo({
        label, direction: "redo",
        ops: deleted.map((d) => ({ kind: "remove" as const, id: d.id })),
      });
      effects.removeFromState(res.removed);
    },
  };
}
```

- [ ] **Step 5: Upravit volající místa**

Na místech nalezených ve Step 1 nahradit skládání payloadu:

```typescript
// PŘED
buildDeleteCommand("Smazání bloku", blocks.map((b) => ({ payload: blockToCreatePayload(b, { splitGroupId: b.splitGroupId }) })))
// PO
buildDeleteCommand("Smazání bloku", blocks.map((b) => ({ id: b.id, fields: blockToRestoreFields(b) })))
```

Totéž pro `buildCreateCommand` — `created` nese nově `{ id, updatedAt, fields: blockToRestoreFields(b) }` místo `{ id, updatedAt, payload }`.

- [ ] **Step 6: Spustit testy a ověřit, že prochází**

Run: `node --test --import tsx src/lib/undo/commands.test.ts`
Expected: PASS

- [ ] **Step 7: Ověřit build a celou suite**

Run: `npm run build && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
Expected: build zelený, 0 fail

- [ ] **Step 8: Commit**

```bash
git add src/lib/undo/commands.ts src/lib/undo/commands.test.ts src/app/_components/PlannerPage.tsx
git commit -m "refactor(undo): multi-edit, create a delete buildery na atomický endpoint"
```

---

## Task 8: Úklid rozhraní a hláška s příčinou

**Files:**
- Modify: `src/lib/undo/types.ts` (odstranit staré metody z `UndoEffects`)
- Modify: `src/app/_components/PlannerPage.tsx` (odstranit staré undo efekty)
- Modify: `src/app/_components/useUndoManager.ts:21-45`
- Modify: `src/app/_components/useUndoManager.test.ts`

**Interfaces:**
- Consumes: vše z Tasků 5–7
- Produces: `UndoEffects` obsahuje už jen `applyUndo`, `addToState`, `removeFromState`, `getLiveBlock`

**Kontext:** Po migraci všech šesti builderů jsou `putBlock`, `postBlock`, `deleteBlock` a `batchUpdate` v `UndoEffects` mrtvé. Odstranit je z rozhraní **i z implementace v PlannerPage** (pozor: `batchUpdate` a spol. mohou mít jiné volající mimo undo — ověřit grepem, mimo-undo použití nechat).

Druhá půlka Tasku: serverová hláška dnes končí v `console.error`. Undo je jediná vícekroková operace v aplikaci, která hlásí binárně a bez příčiny.

- [ ] **Step 1: Ověřit, že staré efekty nikdo jiný nepoužívá**

Run: `grep -rn "effects.putBlock\|effects.postBlock\|effects.deleteBlock\|effects.batchUpdate" src --include="*.ts" --include="*.tsx"`
Expected: prázdný výstup. Pokud ne, ta místa nejdřív domigrovat.

- [ ] **Step 2: Napsat padající test na hlášku**

```typescript
// src/app/_components/useUndoManager.test.ts — přidat
test("core: chyba ze serveru se propíše do toastu i s příčinou", async () => {
  const toasts: Array<{ msg: string; kind: string }> = [];
  const core = createUndoCore(
    () => ({} as never),
    (msg, kind) => { toasts.push({ msg, kind }); },
  );
  core.record({
    label: "Přesun bloku",
    undo: async () => { throw new Error("Blok koliduje s blokem #17301 na stroji XL 105."); },
    redo: async () => {},
  });
  await core.undo();
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].kind, "error");
  assert.ok(toasts[0].msg.includes("Blok koliduje s blokem #17301"),
    `toast "${toasts[0].msg}" neobsahuje serverovou příčinu`);
  assert.equal(core.state().canUndo, true, "po selhání se záznam vrací na zásobník");
});

test("core: CONFLICT ze serveru se chová jako StaleUndoError (záznam se zahodí)", async () => {
  const toasts: Array<{ msg: string; kind: string }> = [];
  const core = createUndoCore(() => ({} as never), (msg, kind) => { toasts.push({ msg, kind }); });
  core.record({
    label: "Přesun bloku",
    undo: async () => {
      const e = new Error("Bloky byly mezitím změněny jiným uživatelem: 12") as Error & { code?: string };
      e.code = "CONFLICT";
      throw e;
    },
    redo: async () => {},
  });
  await core.undo();
  assert.equal(core.state().canUndo, false, "stale záznam se zahazuje");
  assert.ok(toasts[0].msg.includes("mezitím změněn"));
});
```

- [ ] **Step 3: Spustit test a ověřit, že padá**

Run: `node --test --import tsx src/app/_components/useUndoManager.test.ts`
Expected: FAIL — toast obsahuje jen „Vrácení zpět selhalo."

- [ ] **Step 4: Upravit `useUndoManager`**

```typescript
// src/app/_components/useUndoManager.ts — nahradit catch v undo i redo
/** Server hlásí souběh kódem CONFLICT — na klientovi má stejný osud jako StaleUndoError. */
function isStale(err: unknown): boolean {
  return err instanceof StaleUndoError || (err as { code?: string })?.code === "CONFLICT";
}

/** Hláška serveru je jediná informace, ze které plánovač pozná, co má udělat. */
function reason(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  return msg.length > 0 ? `: ${msg}` : ".";
}
```

a v `undo`:

```typescript
    } catch (err) {
      if (isStale(err)) toast(`Nelze vrátit${reason(err)}`, "error");
      else { undoStack.push(entry); toast(`Vrácení zpět selhalo${reason(err)}`, "error"); }
    } finally { notify(); }
```

analogicky v `redo` (`Nelze provést` / `Znovu provedení selhalo`). Volání `console.error` **odstranit** — hláška je nově v toastu.

- [ ] **Step 5: Odstranit mrtvé efekty**

Z `interface UndoEffects` (`src/lib/undo/types.ts`) smazat `putBlock`, `postBlock`, `deleteBlock`, `batchUpdate`. Z `undoEffects` v PlannerPage smazat jejich implementace. Z fake effects v `commands.test.ts` smazat zbylé `throw new Error("unused")` řádky.

- [ ] **Step 6: Spustit celou suite a build**

Run: `npm run build && npm run lint && node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
Expected: build zelený, lint 0 chyb, 0 fail

- [ ] **Step 7: Commit**

```bash
git add src/lib/undo/types.ts src/lib/undo/commands.test.ts src/app/_components/PlannerPage.tsx src/app/_components/useUndoManager.ts src/app/_components/useUndoManager.test.ts
git commit -m "refactor(undo): úklid rozhraní efektů + hláška s příčinou v toastu"
```

> **⏸ ZASTAVIT — celá etapa je hotová. Počkat na OK Vojty před Taskem 9.**

---

## Task 9: Ruční ověření a review

**Files:** žádné změny kódu (kromě případných oprav z review)

- [ ] **Step 1: Přegenerovat fixture den**

Run: `node --import tsx scripts/seed-test-pripominky-dev.ts`
Expected: `✓ preflight prošel`, 17 bloků

- [ ] **Step 2: Scénář „chain push"**

Na 2. 9. 2026 vlož blok na XL 106 ve 14:00 (mezi `RETEZ-1` a `RETEZ-2`) → řetěz se odsune. Ctrl+Z.
Expected: vložený blok zmizí **a** všechny čtyři `RETEZ-*` se vrátí na 14:00/15:00/16:00/17:00. Ctrl+Shift+Z obojí zopakuje.

- [ ] **Step 3: Scénář „překlopení rezervace"**

Otevři `TEST-P8-REZ` na XL 105, přepni typ na ZAKÁZKA, zadej číslo, potvrď „Všechny". Ctrl+Z.
Expected: oba bloky zpátky jako REZERVACE s původním číslem, v historii řádek „↶ vráceno zpět".

- [ ] **Step 4: Scénář „smazání a obnova"**

Smaž `TEST-P8-2H`. Ctrl+Z. Otevři detail obnoveného bloku.
Expected: blok je zpátky **a v historii má i záznamy z doby před smazáním** (dřív byla historie prázdná, protože obnova dostala nové id).

- [ ] **Step 5: Scénář „konflikt"**

Otevři plán ve dvou oknech. V okně A přesuň blok. V okně B (které o tom neví) stiskni Ctrl+Z nad tímtéž blokem.
Expected: toast řekne konkrétní příčinu, v plánu se **nezmění nic**.

- [ ] **Step 6: Scénář „atomicita"**

Vyvolej selhání uprostřed dávky — např. v okně A přesuň sousední blok tak, aby undo v okně B skončilo překryvem.
Expected: hláška „Vrácení zpět selhalo: Blok koliduje…", a **žádný** z bloků dávky se nepohnul.

- [ ] **Step 7: Multi-agent review**

Tři nezávislé perspektivy nad diffem etapy:
1. **Korektnost a regrese** — zejména: má finální overlap pojistka nějakou únikovou cestu? Může se stát, že se část dávky zapíše a část ne?
2. **Konvence repa** — `AppError`/`errorStatus`/`logger`/`requireRole`, audit v transakci, žádné hex literály, z-index přes `zLayers`.
3. **Souběh a transakce** — pořadí zámků, `FOR UPDATE` v `assertNoOverlapForBlocks`, timeout transakce při velké dávce.

Nálezy opravit, pak znovu build + celá suite.

- [ ] **Step 8: Dokumentace**

Doplnit do `docs/vyvoj-historie.md` sekci o atomickém undo (odkaz na spec a výzkum). Do `CLAUDE.md` do sekce *Coding standards* přidat:

```markdown
**Undo → vždy `POST /api/blocks/undo`** (`src/lib/undoApply.server.ts`). Undo vrací
stav, který v DB existoval, takže endpoint zapisuje doslova a NEspouští validaci
harmonogramu — nevolá `expandPrintTime`, takže mřížkovou bránu nepotřebuje.
Optimistic lock a `assertNoOverlapForBlocks` naopak běží vždy. Nové undo cesty
nesmí obcházet `sanitizeUndoOps` (allowlist sloupců).
```

- [ ] **Step 9: Commit**

```bash
git add docs/vyvoj-historie.md CLAUDE.md
git commit -m "docs: atomické undo do historie vývoje a konvencí"
```

---

## Self-review (provedeno při psaní plánu)

**Pokrytí specu:**

| Požadavek specu | Task |
| --- | --- |
| Kontrakt endpointu (§4) | 2, 4 |
| Allowlist `UNDO_RESTORABLE_FIELDS` (§4) | 1 |
| `fields` ≠ `blockToCreatePayload` (§4) | 1, 7 |
| Doslovný zápis bez validace harmonogramu (§5) | 3 |
| `assertNoOverlapForBlocks` vždy, cílové stroje (§5) | 3 |
| Zákaz smazat vytištěný blok (§5) | 3 |
| Warn u off-grid obnovy (§5) | 3 |
| Zámky najednou před zápisem (§6) | 3 |
| Pořadí remove → upsert (§6) | 3 |
| Idempotence všech operací (§7) | 3 |
| Obnova s původním id (§7) | 3, 7 |
| Audit UNDO/REDO v transakci (§8) | 3, 4 |
| Mapování SSE (§8) | 4 |
| `UndoEffects.applyUndo` (§9) | 5 |
| Přepis šesti builderů (§9) | 6, 7 |
| Zánik `restoreShifted` a remapu id (§9) | 7 |
| Hláška s příčinou (§9) | 8 |
| Vady 4.1–4.3, 5 padnou (§10) | 3, 7 |
| Test glob (§10, vada 4.4) | **hotovo dřív** — commit `91e7c7bf` |
| Struktura `undoApply.server.ts` + route (§11) | 2, 3, 4 |
| Sada testů (§11) | 1, 2, 3, 6, 7, 8 |
| Ověření (§13) | 9 |
| Otevřená otázka business pravidel (§14) | 3 Step 1 (jen mazání), 9 Step 7 (review) |

**Bez pokrytí:** žádný požadavek specu nezůstal bez tasku.

**Typová konzistence:** `UndoOp` (server, Task 2) a `UndoOpClient` (klient, Task 5) mají shodný tvar — záměrně dva typy, protože klient nemá importovat `.server` modul. `blockToRestoreFields` (Task 1) produkuje přesně to, co `fields` v obou. `refresh`/`posOp`/`guard` jsou definované v Tasku 6 a používané v Tasku 7.

**Rizika k hlídání při provádění:**
- Task 4 Step 2 je otevřené ověření tvaru `block:deleted` — může vynutit rozšíření `UndoApplyResult`.
- Task 7 Step 1 je grep, jehož výsledek určí rozsah Stepu 5.
