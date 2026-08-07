# Etapa B1 — Serverové revize bloků (černá skříňka)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server si při každé změně bloku sám uloží, jak dotčené řádky vypadaly předtím a potom, a historie bloku začne ukazovat přesuny a natažení, které dnes nezaznamenává nic.

**Architecture:** Pomocník `withRevision` otevírá transakci sám a předává tělu jediný klient — plný transakční klient s podstrčenými delegáty `block` a `auditLog` (Proxy). Zachycení „před" obrazu se řídí `where` samotného zápisu, takže volající nikde nevyjmenovává pole ani bloky. Rozdíl počítá server z řádků, které sám přečetl.

**Tech Stack:** Next.js 16 (App Router) · TypeScript (`strict`) · Prisma 5.22 · MySQL 8.0 · `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-08-07-undo-serverove-revize-design.md`

## Global Constraints

- Větev `Vojta`. Commit po každém tasku. **Nikdy `git add -A`** — nad větví běží paralelní session, přidávej soubory jmenovitě.
- **`prisma migrate dev` je v tomhle repu rozbité** (shadow-replay padá na historické migraci `20260326204352`, P3006). Migrace se píšou **ručně** do `prisma/migrations/<timestamp>_<name>/migration.sql` a aplikují `npx prisma migrate deploy`.
- **Nikdy nespouštět `prisma db pull` ani `prisma format`** — přejmenují relační pole a rozbijí kód.
- Chyby v API routes → `AppError` z `src/lib/errors.ts`. V `src/lib/` (mimo routes) je `throw new Error(...)` v pořádku. `AppErrorCode` **nemá** hodnotu `"INTERNAL"`.
- Logování → `logger` z `src/lib/logger.ts`, nikdy `console.*` v API routes.
- Prisma 5 nedovolí zapsat holé `null` do `Json?` sloupce. Prázdný stav = **vynechání klíče** nebo `Prisma.DbNull`.
- Datum vždy přes helpery z `src/lib/dateUtils.ts`. **Nikdy** `getFullYear`/`getMonth`/`getDate`.
- Barvy jen přes CSS tokeny z `src/app/globals.css`, nikdy hex literál v komponentě.
- Migrace mají `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` (konvence všech migrací projektu).
- Celá testovací suita se pouští takto (glob nejde do podsložek, proto se každá složka uvádí zvlášť):
  ```bash
  node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts
  ```
  Po Tasku 3 přibývá `src/lib/revision/*.test.ts` — přidávej ho do příkazu.
- `npm run build` musí být zelený před každým commitem.

## Mapa souborů

| Soubor | Odpovědnost | Task |
| --- | --- | --- |
| `src/lib/prismaTx.ts` | **nový** — sdílený typ `PrismaTransactionClient` (dnes 5× duplikovaný) | 1 |
| `prisma/schema.prisma` | model `BlockRevision`, `AuditLog.groupId` | 2 |
| `prisma/migrations/20260807120000_block_revision/migration.sql` | **nová** ruční migrace | 2 |
| `src/lib/revision/blockColumns.ts` | **nový** — seznamy sloupců `Block` podle typu | 3 |
| `src/lib/revision/rowNormalize.ts` | **nový** — raw řádek → typovaný objekt | 3 |
| `src/lib/revision/diff.ts` | **nový** — čistý výpočet rozdílu | 4 |
| `src/lib/revision.server.ts` | **nový** — `withRevision`, Proxy delegáty, zachycení | 5 |
| `src/app/api/blocks/[id]/route.ts` | zapojení PUT + DELETE | 6 |
| `src/app/api/blocks/route.ts`, `batch/route.ts`, `[id]/split/route.ts` | zapojení | 7 |
| `src/app/api/blocks/reflow/route.ts`, `[id]/reflow/route.ts`, `undo/route.ts` | zapojení | 8 |
| `src/app/api/blocks/[id]/complete/route.ts` | přepis transakce z polní na interaktivní + zapojení | 9 |
| `src/app/api/blocks/[id]/expedition/route.ts` | zapojení | 9 |
| `src/lib/auditCoverage.ts` | **nový** — mapa „audit → pokryté sloupce" | 10 |
| `src/lib/dateUtils.ts` | `formatPragueDateTimeWithWeekday` | 11 |
| `src/lib/revisionFormat.ts` | **nový** — české řádky historie z rozdílu | 11 |
| `src/lib/blockHistory.ts` | **nový** — typ `BlockHistoryEntry` + slučování | 12 |
| `src/app/api/blocks/[id]/audit/route.ts` | sloučená osa + predikát potlačení | 12 |
| `src/components/BlockDetail.tsx` | render revizní větve | 13 |
| `scripts/prune-revisions.ts` | **nový** — úklid po 90 dnech | 14 |
| `CLAUDE.md`, `docs/vyvoj-historie.md`, `docs/OPS_ZALOHY.md` | pravidla a provoz | 15 |

**Co se NEmění:** typ `AuditLogEntry`. Má **dvě nezávislé definice** — `src/components/InfoPanel.tsx:5-16` (konzumuje `/api/audit/today`) a `src/components/admin/AuditLogPanel.tsx:31` (konzumuje `/api/audit`). Sáhnutí na kteroukoliv tiše vyprázdní panel notifikací.

---

## Task 1: Sdílený typ transakčního klienta

Typ `PrismaTransactionClient` je dnes doslova zkopírovaný v pěti souborech. Task 5 na něm staví, takže sjednocení musí být první.

**Files:**
- Create: `src/lib/prismaTx.ts`
- Modify: `src/lib/overlapCheck.ts:3`, `src/lib/overlapResolver.server.ts:10`, `src/lib/reflow.server.ts:13`, `src/lib/undoApply.server.ts:98`

**Interfaces:**
- Produces: `export type PrismaTransactionClient` — použije ho Task 5 i všechna zapojení.

- [ ] **Step 1: Vytvořit sdílený modul**

`src/lib/prismaTx.ts`:
```typescript
/**
 * Interaktivní transakční klient Prismy. Odvozeno z prvního parametru callbacku
 * `prisma.$transaction`, aby typ nemohl utéct od skutečné verze klienta.
 *
 * Do 8/2026 žila tahle deklarace jako doslovná kopie v pěti souborech
 * (overlapCheck, overlapResolver.server, reflow.server, undoApply.server).
 * Sjednoceno kvůli `withRevision` (src/lib/revision.server.ts), který podstrkuje
 * klient se stejným typem — pět nezávislých kopií by se rozešlo.
 */
export type PrismaTransactionClient = Parameters<
  Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]
>[0];
```

- [ ] **Step 2: Nahradit lokální deklarace importem**

V `src/lib/overlapCheck.ts` smazat řádek 3 a přidat na začátek importů:
```typescript
import type { PrismaTransactionClient } from "@/lib/prismaTx";
```

Totéž v `src/lib/overlapResolver.server.ts` (řádek 10) a `src/lib/undoApply.server.ts` (řádek 98).

V `src/lib/reflow.server.ts` smazat řádek 13 a ponechat re-export, na kterém závisí volající:
```typescript
import type { PrismaTransactionClient } from "@/lib/prismaTx";
export type TxLike = PrismaTransactionClient;
```

- [ ] **Step 3: Ověřit build a testy**

```bash
npm run build
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts
```
Expected: build zelený, všechny testy prochází. Typ je strukturálně identický, takže žádný test se měnit nemá.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prismaTx.ts src/lib/overlapCheck.ts src/lib/overlapResolver.server.ts src/lib/reflow.server.ts src/lib/undoApply.server.ts
git commit -m "refactor: sjednotit PrismaTransactionClient do src/lib/prismaTx.ts"
```

---

## Task 2: Migrace a model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260807120000_block_revision/migration.sql`

**Interfaces:**
- Produces: model `BlockRevision` a sloupec `AuditLog.groupId` — používají Tasky 5, 12, 14.

- [ ] **Step 1: Doplnit model do schématu**

Do `prisma/schema.prisma` přidat za model `AuditLog`:
```prisma
model BlockRevision {
  id          Int      @id @default(autoincrement())
  /// Jedna serverová transakce = jeden groupId napříč všemi dotčenými bloky.
  groupId     String   @db.VarChar(32)
  /// ZÁMĚRNĚ BEZ cizího klíče — revize musí přežít smazání bloku.
  /// Navíc: produkční Block.id je INT UNSIGNED, FK z INT by selhal na errno 150.
  blockId     Int
  /// Denormalizováno, aby řádek dával smysl i po smazání bloku.
  machine     String   @db.VarChar(191)
  orderNumber String?  @db.VarChar(191)
  /// Operace uživatele: CREATE|UPDATE|DELETE|BATCH|SPLIT|REFLOW|UNDO|PRINT_COMPLETE|EXPEDITION
  action      String   @db.VarChar(32)
  /// Typ změny TOHOTO řádku. NIKDY se neodvozuje z přítomnosti before/after.
  kind        String   @db.VarChar(8)
  label       String   @db.VarChar(191)
  userId      Int
  username    String   @db.VarChar(191)
  /// Stav před změnou. U kind=CREATE chybí. BEZ updatedAt.
  before      Json?
  /// Stav po změně. U kind=DELETE chybí. BEZ updatedAt.
  after       Json?
  /// Block.updatedAt po zápisu — verze pro kontrolu souběhu v etapě B2.
  rowVersion  DateTime?
  /// Forenzní příznak: zachycení „před" nebylo úplné. NIKDY nesmí vyrobit undo operaci.
  partial     Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([groupId])
  @@index([blockId, createdAt])
  @@index([machine, createdAt])
  @@index([createdAt])
}
```

Do modelu `AuditLog` přidat pole a index:
```prisma
  /// Korelace s BlockRevision. Nullable — historické řádky ho nemají.
  groupId     String?  @db.VarChar(32)

  @@index([groupId, blockId])
```

- [ ] **Step 2: Napsat migraci ručně**

`prisma/migrations/20260807120000_block_revision/migration.sql`:
```sql
-- CreateTable: serverové revize bloků (etapa B1).
-- Bez FK na Block: revize musí přežít smazání bloku, a produkční Block.id
-- je INT UNSIGNED, takže FK z INT sloupce by selhal na errno 150.
-- Charset dle konvence všech migrací projektu (utf8mb4_unicode_ci).
CREATE TABLE `BlockRevision` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` VARCHAR(32) NOT NULL,
    `blockId` INTEGER NOT NULL,
    `machine` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NULL,
    `action` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `rowVersion` DATETIME(3) NULL,
    `partial` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BlockRevision_groupId_idx`(`groupId`),
    INDEX `BlockRevision_blockId_createdAt_idx`(`blockId`, `createdAt`),
    INDEX `BlockRevision_machine_createdAt_idx`(`machine`, `createdAt`),
    INDEX `BlockRevision_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: korelace auditu a revize. Na MySQL 8.0 je ADD COLUMN NULL INSTANT.
ALTER TABLE `AuditLog` ADD COLUMN `groupId` VARCHAR(32) NULL;

-- CreateIndex: složený, protože predikát potlačení v historii bloku se ptá
-- na (groupId, blockId) zároveň. POZOR: CREATE INDEX NENÍ instantní operace —
-- jede ALGORITHM=INPLACE a na začátku i konci bere exkluzivní metadata lock.
CREATE INDEX `AuditLog_groupId_blockId_idx` ON `AuditLog`(`groupId`, `blockId`);
```

- [ ] **Step 3: Aplikovat na dev databázi**

```bash
npx prisma migrate deploy
npx prisma generate
```
Expected: `1 migration found` … `applied`. **Nepouštět `migrate dev`** — v tomhle repu padá na P3006.

- [ ] **Step 4: Ověřit skutečný tvar tabulky**

```bash
node --import tsx -e "
import { prisma } from './src/lib/prisma';
const cols = await prisma.\$queryRawUnsafe('SHOW COLUMNS FROM BlockRevision');
console.log(cols.map(c => c.Field + ':' + c.Type).join('\n'));
const ai = await prisma.\$queryRawUnsafe(\"SHOW COLUMNS FROM AuditLog LIKE 'groupId'\");
console.log('AuditLog.groupId =', JSON.stringify(ai));
await prisma.\$disconnect();
"
```
Expected: 15 sloupců `BlockRevision`, `before`/`after` typu `json`, `partial` typu `tinyint(1)`; `AuditLog.groupId` typu `varchar(32)` a `Null: YES`.

- [ ] **Step 5: Ověřit build**

```bash
npm run build
```
Expected: zelený (klient je přegenerovaný, `prisma.blockRevision` existuje).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260807120000_block_revision
git commit -m "feat(db): tabulka BlockRevision + AuditLog.groupId"
```

---

## Task 3: Normalizátor raw řádku

Zachycení „před" obrazu musí být **current read** — jedno raw `SELECT … FOR UPDATE`. Nezamykající `findMany` by pod MySQL REPEATABLE READ vrátil data z read view transakce, takže by přepočet stroje připsal cizí změnu, kterou mezitím commitl jiný plánovač. Cenou je ruční normalizace: raw `SELECT` vrací `BOOLEAN` jako 0/1.

**Files:**
- Create: `src/lib/revision/blockColumns.ts`
- Create: `src/lib/revision/rowNormalize.ts`
- Test: `src/lib/revision/rowNormalize.test.ts`

**Interfaces:**
- Produces: `BLOCK_BOOLEAN_COLUMNS`, `BLOCK_DATE_COLUMNS`, `normalizeBlockRow(raw: Record<string, unknown>): Record<string, unknown>` — používá Task 5.

- [ ] **Step 1: Napsat seznamy sloupců**

`src/lib/revision/blockColumns.ts`:
```typescript
/**
 * Sloupce Block, které raw `SELECT` vrací v jiném tvaru, než dává Prisma klient.
 * MySQL BOOLEAN je TINYINT(1) → raw čtení vrátí 0/1 místo false/true
 * (ověřeno proti dev DB, viz komentář v src/lib/undoApply.server.ts:147-155).
 *
 * Zdroj pravdy je prisma/schema.prisma, model Block. Když do něj přibude
 * Boolean nebo DateTime sloupec, MUSÍ přibýt i sem — jinak ho revize uloží
 * jako 0/1, resp. jako řetězec, a rozdíl bude hlásit změnu i tam, kde žádná není.
 */
export const BLOCK_BOOLEAN_COLUMNS = [
  "locked", "dataOk", "materialOk", "obalka", "vnitrky",
  "materialInStock", "materialIssued", "pantoneRequired", "pantoneOk",
  "scheduleBypassed",
] as const;

export const BLOCK_DATE_COLUMNS = [
  "startTime", "endTime", "deadlineExpedice", "dataRequiredDate",
  "materialRequiredDate", "pantoneRequiredDate", "expeditionPublishedAt",
  "printCompletedAt", "createdAt", "updatedAt",
] as const;
```

- [ ] **Step 2: Napsat padající test**

`src/lib/revision/rowNormalize.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBlockRow } from "./rowNormalize";

test("BOOLEAN sloupce z 0/1 na false/true", () => {
  const out = normalizeBlockRow({ locked: 1, dataOk: 0, scheduleBypassed: 1 });
  assert.equal(out.locked, true);
  assert.equal(out.dataOk, false);
  assert.equal(out.scheduleBypassed, true);
});

test("NULL v BOOLEAN sloupci zůstane null, ne false", () => {
  const out = normalizeBlockRow({ locked: null });
  assert.equal(out.locked, null);
});

test("DATETIME řetězec na Date", () => {
  const out = normalizeBlockRow({ startTime: "2026-09-03 06:00:00.000" });
  assert.ok(out.startTime instanceof Date);
  assert.equal((out.startTime as Date).toISOString(), "2026-09-03T06:00:00.000Z");
});

test("DATETIME, které už je Date, projde beze změny", () => {
  const d = new Date("2026-09-03T06:00:00.000Z");
  const out = normalizeBlockRow({ endTime: d });
  assert.equal((out.endTime as Date).getTime(), d.getTime());
});

test("NULL v DATETIME sloupci zůstane null", () => {
  const out = normalizeBlockRow({ printCompletedAt: null });
  assert.equal(out.printCompletedAt, null);
});

test("ostatní sloupce projdou beze změny", () => {
  const out = normalizeBlockRow({ orderNumber: "5000", printMinutes: 480, machine: "XL_105" });
  assert.equal(out.orderNumber, "5000");
  assert.equal(out.printMinutes, 480);
  assert.equal(out.machine, "XL_105");
});
```

- [ ] **Step 3: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/revision/rowNormalize.test.ts
```
Expected: FAIL — `Cannot find module './rowNormalize'`.

- [ ] **Step 4: Implementovat**

`src/lib/revision/rowNormalize.ts`:
```typescript
import { BLOCK_BOOLEAN_COLUMNS, BLOCK_DATE_COLUMNS } from "./blockColumns";

const BOOL = new Set<string>(BLOCK_BOOLEAN_COLUMNS);
const DATE = new Set<string>(BLOCK_DATE_COLUMNS);

/**
 * Raw řádek z `SELECT * FROM Block … FOR UPDATE` na tvar, jaký vrací Prisma klient.
 * `null` zůstává `null` u obou skupin — rozlišení „není vyplněno" vs. „false"
 * je u nullable sloupců (např. deadlineExpedice) nosné.
 */
export function normalizeBlockRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (BOOL.has(key)) {
      out[key] = value === 1 || value === true || value === "1";
    } else if (DATE.has(key)) {
      out[key] = value instanceof Date ? value : new Date(String(value).replace(" ", "T") + "Z");
    } else {
      out[key] = value;
    }
  }
  return out;
}
```

- [ ] **Step 5: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/revision/rowNormalize.test.ts
```
Expected: 6 pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/revision/blockColumns.ts src/lib/revision/rowNormalize.ts src/lib/revision/rowNormalize.test.ts
git commit -m "feat(revize): normalizátor raw řádku Block (BOOLEAN 0/1, DATETIME)"
```

---

## Task 4: Výpočet rozdílu

Dvě pravidla, na kterých stojí celá kvalita historie:

1. **Rozdíl se počítá bez `updatedAt`.** Prisma ho mění při každém zápisu, takže by „prázdný rozdíl zahodíme" nikdy nenastalo. Split propagace běží při každém uložení z BlockEditu i s totožnými hodnotami (`[id]/route.ts:492`) — každý sourozenec by dostal revizi s jediným změněným sloupcem `updatedAt`, tedy prázdný řádek v panelu. Auditní vrstva tenhle šum filtruje už dnes (`splitPropagateAudit.ts:81`).
2. **Prázdný rozdíl → žádná revize.**

**Files:**
- Create: `src/lib/revision/diff.ts`
- Test: `src/lib/revision/diff.test.ts`

**Interfaces:**
- Consumes: nic.
- Produces: `type RevisionDiff = { before: Record<string, unknown>; after: Record<string, unknown> } | null` a `computeRevisionDiff(before, after): RevisionDiff` — používá Task 5.

- [ ] **Step 1: Napsat padající test**

`src/lib/revision/diff.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRevisionDiff } from "./diff";

test("žádná věcná změna → null", () => {
  const row = { id: 1, machine: "XL_105", locked: false, updatedAt: new Date("2026-09-01T10:00:00Z") };
  const after = { ...row, updatedAt: new Date("2026-09-01T11:00:00Z") };
  assert.equal(computeRevisionDiff(row, after), null);
});

test("updatedAt sám o sobě rozdíl netvoří", () => {
  const before = { updatedAt: new Date("2026-09-01T10:00:00Z") };
  const after = { updatedAt: new Date("2026-09-01T11:00:00Z") };
  assert.equal(computeRevisionDiff(before, after), null);
});

test("změna tří sloupců → právě tři sloupce v obou půlkách", () => {
  const before = { machine: "XL_105", startTime: new Date("2026-09-03T06:00:00Z"), printMinutes: 480, locked: false, updatedAt: new Date("2026-09-01T10:00:00Z") };
  const after = { machine: "XL_106", startTime: new Date("2026-09-04T06:00:00Z"), printMinutes: 600, locked: false, updatedAt: new Date("2026-09-01T11:00:00Z") };
  const d = computeRevisionDiff(before, after);
  assert.ok(d);
  assert.deepEqual(Object.keys(d.before).sort(), ["machine", "printMinutes", "startTime"]);
  assert.deepEqual(Object.keys(d.after).sort(), ["machine", "printMinutes", "startTime"]);
  assert.equal(d.before.machine, "XL_105");
  assert.equal(d.after.machine, "XL_106");
});

test("Date se porovnává podle času, ne podle reference", () => {
  const before = { startTime: new Date("2026-09-03T06:00:00Z") };
  const after = { startTime: new Date("2026-09-03T06:00:00Z") };
  assert.equal(computeRevisionDiff(before, after), null);
});

test("null → hodnota se počítá jako změna", () => {
  const d = computeRevisionDiff({ deadlineExpedice: null }, { deadlineExpedice: new Date("2026-09-10T00:00:00Z") });
  assert.ok(d);
  assert.equal(d.before.deadlineExpedice, null);
});

test("hodnota → null se počítá jako změna", () => {
  const d = computeRevisionDiff({ materialNote: "čeká" }, { materialNote: null });
  assert.ok(d);
  assert.equal(d.after.materialNote, null);
});

test("pole (tiskoveArchy) se porovnává podle obsahu", () => {
  assert.equal(computeRevisionDiff({ tiskoveArchy: "[\"A\",\"B\"]" }, { tiskoveArchy: "[\"A\",\"B\"]" }), null);
  assert.ok(computeRevisionDiff({ tiskoveArchy: "[\"A\"]" }, { tiskoveArchy: "[\"A\",\"B\"]" }));
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/revision/diff.test.ts
```
Expected: FAIL — `Cannot find module './diff'`.

- [ ] **Step 3: Implementovat**

`src/lib/revision/diff.ts`:
```typescript
/** Sloupce, které se do rozdílu NIKDY nepočítají. */
const IGNORED = new Set(["updatedAt"]);

export type RevisionDiff = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null) return a === b;
  return a === b;
}

/**
 * Rozdíl dvou řádků Block. Vrací `null`, když se věcně nic nezměnilo.
 *
 * `updatedAt` je vyloučeno záměrně: Prisma ho mění při KAŽDÉM zápisu, takže
 * s ním by se prázdný rozdíl nikdy nekonal a split propagace by u každého
 * sourozence vyrobila prázdný řádek historie při každém uložení z BlockEditu.
 * Verze se ukládá zvlášť do `BlockRevision.rowVersion`.
 */
export function computeRevisionDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RevisionDiff | null {
  const outBefore: Record<string, unknown> = {};
  const outAfter: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of keys) {
    if (IGNORED.has(key)) continue;
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (sameValue(a, b)) continue;
    outBefore[key] = a;
    outAfter[key] = b;
  }

  return Object.keys(outAfter).length === 0 ? null : { before: outBefore, after: outAfter };
}
```

- [ ] **Step 4: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/revision/diff.test.ts
```
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/revision/diff.ts src/lib/revision/diff.test.ts
git commit -m "feat(revize): výpočet rozdílu bez updatedAt, prázdný rozdíl = žádná revize"
```

---

## Task 5: Pomocník `withRevision`

Jádro etapy. **Pomocník otevírá transakci sám** a tělu předá jediný klient — Proxy nad transakčním klientem s podstrčenými delegáty `block` a `auditLog`. Tím:

- `AuditLog.groupId` má kdo naplnit (`groupId` vzniká před spuštěním těla);
- signatury `resolveChainPushFromDb`, `reflowBlockInTx`, `reflowMachineInTx`, `applyUndoOps` se **nemění** (Proxy je strukturálně `PrismaTransactionClient`);
- syrový `tx` se do uzávěru těla vůbec nedostane.

**Files:**
- Create: `src/lib/revision.server.ts`
- Test: `src/lib/revision.server.test.ts`

**Interfaces:**
- Consumes: `PrismaTransactionClient` (Task 1), `normalizeBlockRow` (Task 3), `computeRevisionDiff` (Task 4).
- Produces:
  ```typescript
  export type RevisionAction =
    | "CREATE" | "UPDATE" | "DELETE" | "BATCH"
    | "SPLIT" | "REFLOW" | "UNDO" | "PRINT_COMPLETE" | "EXPEDITION";
  export async function withRevision<T>(
    meta: {
      action: RevisionAction;
      label: string;
      user: { id: number; username: string };
      txOptions?: { timeout?: number; maxWait?: number };
    },
    body: (rtx: PrismaTransactionClient) => Promise<T>,
  ): Promise<{ result: T; groupId: string }>;
  ```
  Používají Tasky 6–9.

- [ ] **Step 1: Napsat padající test**

`src/lib/revision.server.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { withRevision } from "./revision.server";

const USER = { id: 1, username: "test" };

/** Založí blok mimo withRevision, aby se dal změnit a revize se dala zkoumat. */
async function seedBlock(machine = "XL_105") {
  return prisma.block.create({
    data: {
      orderNumber: "REV-TEST",
      machine,
      startTime: new Date("2026-12-01T06:00:00.000Z"),
      endTime: new Date("2026-12-01T14:00:00.000Z"),
      type: "ZAKAZKA",
      printMinutes: 480,
    },
  });
}

test("úprava bloku vyrobí revizi se správným rozdílem", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Přesun bloku", user: USER },
    async (rtx) => rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } }),
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 1);
  assert.equal(revs[0].kind, "UPDATE");
  assert.equal(revs[0].blockId, block.id);
  assert.equal(revs[0].machine, "XL_105", "machine je stav PŘED změnou");
  assert.deepEqual((revs[0].before as Record<string, unknown>).machine, "XL_105");
  assert.deepEqual((revs[0].after as Record<string, unknown>).machine, "XL_106");
  assert.equal(revs[0].partial, false);
  assert.ok(revs[0].rowVersion instanceof Date);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("zápis bez věcné změny nevyrobí žádnou revizi", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Uložení beze změny", user: USER },
    async (rtx) => rtx.block.update({ where: { id: block.id }, data: { machine: "XL_105" } }),
  );
  const count = await prisma.blockRevision.count({ where: { groupId } });
  assert.equal(count, 0, "updatedAt se změnil, ale věcně se nezměnilo nic");
  await prisma.block.delete({ where: { id: block.id } });
});

test("updateMany zachytí i řádek na jiném stroji (split sourozenec)", async () => {
  const a = await seedBlock("XL_105");
  const b = await seedBlock("XL_106");
  const group = await prisma.splitGroup.create({ data: {} });
  await prisma.block.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { splitGroupId: group.id } });

  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Propagace sdíleného pole", user: USER },
    async (rtx) => rtx.block.updateMany({
      where: { splitGroupId: group.id },
      data: { deadlineExpedice: new Date("2026-12-20T00:00:00.000Z") },
    }),
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId }, orderBy: { blockId: "asc" } });
  assert.equal(revs.length, 2, "oba sourozenci, přestože jsou na různých strojích");
  assert.deepEqual(revs.map((r) => r.machine).sort(), ["XL_105", "XL_106"]);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  await prisma.splitGroup.delete({ where: { id: group.id } });
});

test("vznik bloku má kind CREATE a chybějící before", async () => {
  const { result, groupId } = await withRevision(
    { action: "CREATE", label: "Nová zakázka", user: USER },
    async (rtx) => rtx.block.create({
      data: {
        orderNumber: "REV-NEW", machine: "XL_105",
        startTime: new Date("2026-12-02T06:00:00.000Z"),
        endTime: new Date("2026-12-02T14:00:00.000Z"),
        type: "ZAKAZKA", printMinutes: 480,
      },
    }),
  );
  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.equal(rev.kind, "CREATE");
  assert.equal(rev.before, null);
  assert.ok(rev.after);

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: result.id } });
});

test("smazání bloku má kind DELETE a celý řádek v before", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "DELETE", label: "Smazání bloku", user: USER },
    async (rtx) => rtx.block.delete({ where: { id: block.id } }),
  );
  const rev = await prisma.blockRevision.findFirstOrThrow({ where: { groupId } });
  assert.equal(rev.kind, "DELETE");
  assert.equal(rev.after, null);
  assert.equal((rev.before as Record<string, unknown>).orderNumber, "REV-TEST");
  await prisma.blockRevision.deleteMany({ where: { groupId } });
});

test("auditní řádky dostanou groupId automaticky", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Editace", user: USER },
    async (rtx) => {
      await rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
      await rtx.auditLog.create({
        data: { blockId: block.id, userId: USER.id, username: USER.username, action: "UPDATE", field: "machine" },
      });
    },
  );
  const logs = await prisma.auditLog.findMany({ where: { groupId } });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].field, "machine");

  await prisma.auditLog.deleteMany({ where: { groupId } });
  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.delete({ where: { id: block.id } });
});

test("rollback těla nezanechá revizi ani auditní řádek", async () => {
  const block = await seedBlock();
  const before = await prisma.blockRevision.count();
  await assert.rejects(
    withRevision({ action: "UPDATE", label: "Spadne", user: USER }, async (rtx) => {
      await rtx.block.update({ where: { id: block.id }, data: { machine: "XL_106" } });
      throw new Error("záměrný pád");
    }),
    /záměrný pád/,
  );
  assert.equal(await prisma.blockRevision.count(), before);
  const fresh = await prisma.block.findUniqueOrThrow({ where: { id: block.id } });
  assert.equal(fresh.machine, "XL_105", "mutace se taky vrátila");
  await prisma.block.delete({ where: { id: block.id } });
});

test("block.createMany uvnitř withRevision je zakázané", async () => {
  await assert.rejects(
    withRevision({ action: "CREATE", label: "Dávka", user: USER }, async (rtx) =>
      rtx.block.createMany({ data: [] }),
    ),
    /createMany/,
  );
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/revision.server.test.ts
```
Expected: FAIL — `Cannot find module './revision.server'`.

- [ ] **Step 3: Implementovat pomocníka**

`src/lib/revision.server.ts`:
```typescript
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { PrismaTransactionClient } from "@/lib/prismaTx";
import { logger } from "@/lib/logger";
import { normalizeBlockRow } from "@/lib/revision/rowNormalize";
import { computeRevisionDiff } from "@/lib/revision/diff";

export type RevisionAction =
  | "CREATE" | "UPDATE" | "DELETE" | "BATCH"
  | "SPLIT" | "REFLOW" | "UNDO" | "PRINT_COMPLETE" | "EXPEDITION";

type Row = Record<string, unknown>;
type Kind = "CREATE" | "UPDATE" | "DELETE";

/**
 * Neúplné zachycení: mezi snapshotem a zápisem se objevil fantom.
 * Ve vývoji a testech se hází, na produkci se degraduje na `partial: true` —
 * spadnout uživateli uprostřed plánování je horší než neúplná revize.
 */
function onCountMismatch(groupId: string, captured: number, affected: number, cap: Capture, op: string): void {
  cap.partial = true;
  const msg = `[revize] ${op} zasáhl ${affected} řádků, ale zachytilo se ${captured} (groupId ${groupId})`;
  if (process.env.NODE_ENV !== "production") throw new Error(msg);
  logger.error(msg);
}

/** Sběrač stavu jedné transakce. */
class Capture {
  readonly before = new Map<number, Row>();
  readonly kinds = new Map<number, Kind>();
  partial = false;

  markKind(id: number, kind: Kind) {
    // CREATE i DELETE přebíjí UPDATE: řádek, který v téže transakci vznikl
    // a pak se změnil, je pořád CREATE.
    const current = this.kinds.get(id);
    if (current === "CREATE" && kind === "UPDATE") return;
    this.kinds.set(id, kind);
  }
}

/** Zamykající current-read dotčených řádků. Neopakuje už zachycené. */
async function captureBefore(tx: PrismaTransactionClient, cap: Capture, ids: number[]) {
  const missing = ids.filter((id) => !cap.before.has(id));
  if (missing.length === 0) return;
  const rows = await tx.$queryRaw<Row[]>`
    SELECT * FROM Block WHERE id IN (${Prisma.join(missing)}) FOR UPDATE
  `;
  for (const raw of rows) {
    const row = normalizeBlockRow(raw);
    cap.before.set(Number(row.id), row);
  }
}

/** Id, kterých se `where` týká. Pro update/delete stačí `id`, jinak dohledat. */
async function resolveIds(
  tx: PrismaTransactionClient,
  where: unknown,
  many: boolean,
): Promise<number[]> {
  const w = where as { id?: unknown } | undefined;
  if (!many && typeof w?.id === "number") return [w.id];
  const rows = await tx.block.findMany({
    where: where as Prisma.BlockWhereInput,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function makeClient(tx: PrismaTransactionClient, cap: Capture, groupId: string): PrismaTransactionClient {
  const blockDelegate = new Proxy(tx.block, {
    get(target, prop, receiver) {
      switch (prop) {
        case "update":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, false);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "UPDATE"));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target as any).update(args);
          };
        case "updateMany":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, true);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "UPDATE"));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res = await (target as any).updateMany(args);
            if (res.count !== ids.length) onCountMismatch(groupId, ids.length, res.count, cap, "updateMany");
            return res;
          };
        case "delete":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, false);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "DELETE"));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target as any).delete(args);
          };
        case "deleteMany":
          return async (args: { where: unknown }) => {
            const ids = await resolveIds(tx, args.where, true);
            await captureBefore(tx, cap, ids);
            ids.forEach((id) => cap.markKind(id, "DELETE"));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const res = await (target as any).deleteMany(args);
            if (res.count !== ids.length) onCountMismatch(groupId, ids.length, res.count, cap, "deleteMany");
            return res;
          };
        case "create":
          return async (args: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const created = await (target as any).create(args);
            cap.markKind(created.id, "CREATE");
            return created;
          };
        case "createMany":
          // MySQL nevrací id z createMany, takže revizi k nim nejde přiřadit.
          return () => {
            throw new Error(
              "block.createMany není uvnitř withRevision podporované — MySQL nevrací id, " +
              "takže revizi nelze zapsat. Použij create ve smyčce.",
            );
          };
        default:
          return Reflect.get(target, prop, receiver);
      }
    },
  });

  const auditDelegate = new Proxy(tx.auditLog, {
    get(target, prop, receiver) {
      if (prop === "create") {
        return (args: { data: Record<string, unknown> }) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (target as any).create({ ...args, data: { ...args.data, groupId } });
      }
      if (prop === "createMany") {
        return (args: { data: Record<string, unknown>[] }) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (target as any).createMany({
            ...args,
            data: args.data.map((row) => ({ ...row, groupId })),
          });
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return new Proxy(tx, {
    get(target, prop, receiver) {
      if (prop === "block") return blockDelegate;
      if (prop === "auditLog") return auditDelegate;
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaTransactionClient;
}

/**
 * Obalí celou mutaci: otevře transakci, podstrčí tělu klient s nahrazenými
 * delegáty `block` a `auditLog`, a na konci zapíše revize.
 *
 * Tělo NIKDY nedostane syrový `tx` — proto se do revize nedá „zapomenout"
 * zapsat: jinudy zapsat nejde.
 */
export async function withRevision<T>(
  meta: {
    action: RevisionAction;
    label: string;
    user: { id: number; username: string };
    txOptions?: { timeout?: number; maxWait?: number };
  },
  body: (rtx: PrismaTransactionClient) => Promise<T>,
): Promise<{ result: T; groupId: string }> {
  const groupId = randomBytes(16).toString("base64url");

  const result = await prisma.$transaction(async (tx) => {
    const cap = new Capture();
    const rtx = makeClient(tx, cap, groupId);
    const bodyResult = await body(rtx);

    const ids = [...cap.kinds.keys()];
    if (ids.length > 0) {
      const afterRows = new Map<number, Row>();
      const raw = await tx.$queryRaw<Row[]>`
        SELECT * FROM Block WHERE id IN (${Prisma.join(ids)})
      `;
      for (const r of raw) {
        const row = normalizeBlockRow(r);
        afterRows.set(Number(row.id), row);
      }

      const rows: Prisma.BlockRevisionCreateManyInput[] = [];
      for (const id of ids) {
        const kind = cap.kinds.get(id)!;
        const before = cap.before.get(id) ?? null;
        const after = afterRows.get(id) ?? null;
        // Identita řádku se bere z toho stavu, který existuje — u DELETE z „před".
        const identity = (before ?? after) as Row | null;
        if (!identity) continue;

        let beforeJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
        let afterJson: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;

        if (kind === "CREATE" && after) {
          afterJson = after as Prisma.InputJsonValue;
        } else if (kind === "DELETE" && before) {
          beforeJson = before as Prisma.InputJsonValue;
        } else if (kind === "UPDATE" && before && after) {
          const diff = computeRevisionDiff(before, after);
          // Prázdný rozdíl = žádná revize. Výjimka: partial řádky se zapisují vždy.
          if (!diff && !cap.partial) continue;
          if (diff) {
            beforeJson = diff.before as Prisma.InputJsonValue;
            afterJson = diff.after as Prisma.InputJsonValue;
          }
        } else {
          continue;
        }

        rows.push({
          groupId,
          blockId: id,
          machine: String(identity.machine),
          orderNumber: identity.orderNumber == null ? null : String(identity.orderNumber),
          action: meta.action,
          kind,
          label: meta.label,
          userId: meta.user.id,
          username: meta.user.username,
          before: beforeJson,
          after: afterJson,
          rowVersion: (after?.updatedAt as Date | undefined) ?? null,
          partial: cap.partial,
        });
      }

      if (rows.length > 0) await tx.blockRevision.createMany({ data: rows });
    }

    return bodyResult;
  }, meta.txOptions ?? { timeout: 15000, maxWait: 5000 });

  return { result, groupId };
}
```

- [ ] **Step 4: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/revision.server.test.ts
```
Expected: 8 pass. Test píše do dev databáze a po sobě uklízí — **nespouštět proti produkci**.

- [ ] **Step 5: Mutační test — ověřit, že testy opravdu hlídají**

Dočasně v `src/lib/revision/diff.ts` zakomentovat řádek `if (IGNORED.has(key)) continue;` a spustit testy.
Expected: padne `zápis bez věcné změny nevyrobí žádnou revizi`. Vrátit zpět.

Totéž s `makeClient`: dočasně u `updateMany` vrátit `Reflect.get(target, prop, receiver)` místo obalu.
Expected: padne `updateMany zachytí i řádek na jiném stroji`. Vrátit zpět.

> **Poznámka k pokrytí:** větev `onCountMismatch` **nemá vlastní unit test**. Fantom mezi
> snapshotem a zápisem vyžaduje souběžnou transakci, takže by šla vynutit jen zmocknutím
> vnitřku pomocníka — a test, který měří mock místo chování, dává falešnou jistotu.
> Ověřuje se mutačně: dočasně změnit podmínku na `if (true)` a ověřit, že testy Tasku 5
> spadnou s hláškou o neúplném zachycení. Pak vrátit zpět.

- [ ] **Step 6: Ověřit build a commit**

```bash
npm run build
git add src/lib/revision.server.ts src/lib/revision.server.test.ts
git commit -m "feat(revize): withRevision — transakce s podstrčenými delegáty block a auditLog"
```

---

## Task 6: Zapojení PUT a DELETE

Nejbohatší cesta: chain push, propagace do split skupiny i mazání. Zapojuje se první, protože pokrývá nejvíc situací.

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts:152` (PUT), `:678` (DELETE)
- Test: `src/lib/revision.server.test.ts` (rozšíření)

**Interfaces:**
- Consumes: `withRevision` (Task 5).

- [ ] **Step 1: Přepsat transakci v PUT**

V `src/app/api/blocks/[id]/route.ts` nahradit řádek 152:
```typescript
    const { block, shifted, propagatedGroupId } = await prisma.$transaction(async (tx) => {
```
za:
```typescript
    const { result: { block, shifted, propagatedGroupId } } = await withRevision(
      { action: "UPDATE", label: "Editace bloku", user: { id: session.id, username: session.username } },
      async (tx) => {
```
a na konci transakce (kde dnes stojí `}, { timeout: 15000, maxWait: 5000 });`) nahradit za:
```typescript
      },
    );
```

Import na začátek souboru:
```typescript
import { withRevision } from "@/lib/revision.server";
```

**Uvnitř těla se nemění nic.** Proměnná se dál jmenuje `tx` — je to teď obalený klient, ale typ i chování jsou shodné.

- [ ] **Step 2: Přepsat transakci v DELETE**

Stejně na řádku 678, s jiným popiskem:
```typescript
    await withRevision(
      { action: "DELETE", label: "Smazání bloku", user: { id: session.id, username: session.username } },
      async (tx) => {
```

- [ ] **Step 3: Doplnit test na propagaci přes celou skupinu**

Do `src/lib/revision.server.test.ts` přidat:
```typescript
test("PUT propagace sdíleného pole vyrobí revizi kořeni i sourozenci", async () => {
  const group = await prisma.splitGroup.create({ data: {} });
  const head = await seedBlock("XL_105");
  const tail = await seedBlock("XL_106");
  await prisma.block.updateMany({
    where: { id: { in: [head.id, tail.id] } },
    data: { splitGroupId: group.id },
  });

  const { groupId } = await withRevision(
    { action: "UPDATE", label: "Editace bloku", user: USER },
    async (rtx) => {
      await rtx.block.update({ where: { id: head.id }, data: { deadlineExpedice: new Date("2026-12-20T00:00:00.000Z") } });
      await rtx.block.updateMany({
        where: { splitGroupId: group.id, id: { not: head.id } },
        data: { deadlineExpedice: new Date("2026-12-20T00:00:00.000Z") },
      });
    },
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId } });
  assert.equal(revs.length, 2, "kořen i sourozenec na druhém stroji");

  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { id: { in: [head.id, tail.id] } } });
  await prisma.splitGroup.delete({ where: { id: group.id } });
});
```

- [ ] **Step 4: Spustit testy a build**

```bash
node --test --import tsx src/lib/revision.server.test.ts
npm run build
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Expected: vše zelené.

- [ ] **Step 5: Ruční ověření v prohlížeči**

Spustit dev server, přetáhnout blok na jiný stroj a ověřit dotazem:
```bash
node --import tsx -e "
import { prisma } from './src/lib/prisma';
const r = await prisma.blockRevision.findMany({ orderBy: { id: 'desc' }, take: 3 });
console.log(JSON.stringify(r, null, 2));
await prisma.\$disconnect();
"
```
Expected: revize s `kind: "UPDATE"`, v `before`/`after` sloupce `machine`, `startTime`, `endTime`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/blocks/[id]/route.ts" src/lib/revision.server.test.ts
git commit -m "feat(revize): zapojit PUT a DELETE bloku"
```

---

## Task 7: Zapojení POST, batch a split

**Files:**
- Modify: `src/app/api/blocks/route.ts:168`, `src/app/api/blocks/batch/route.ts:57`, `src/app/api/blocks/[id]/split/route.ts:47`

**Interfaces:**
- Consumes: `withRevision` (Task 5).

- [ ] **Step 1: POST `/api/blocks`**

V `src/app/api/blocks/route.ts` nahradit řádek 168 a přidat import `withRevision`:
```typescript
    const { result: { newBlock: block, shiftedMoves } } = await withRevision(
      { action: "CREATE", label: "Nová zakázka", user: { id: session.id, username: session.username } },
      async (tx) => {
```
Konec transakce uzavřít `}, );` ve tvaru z Tasku 6.

- [ ] **Step 2: Batch**

V `src/app/api/blocks/batch/route.ts` nahradit řádek 57:
```typescript
    const { result: { updated: results, shiftedIds } } = await withRevision(
      { action: "BATCH", label: "Hromadný přesun", user: { id: session.id, username: session.username } },
      async (tx) => {
```

- [ ] **Step 3: Split**

V `src/app/api/blocks/[id]/split/route.ts` nahradit řádek 47:
```typescript
    const { result: { head, tail, shifted } } = await withRevision(
      { action: "SPLIT", label: "Rozdělení bloku", user: { id: session.id, username: session.username } },
      async (tx) => {
```

- [ ] **Step 4: Doplnit test na rozdělení**

Do `src/lib/revision.server.test.ts`:
```typescript
test("rozdělení: kořen dostane UPDATE, nová část CREATE", async () => {
  const block = await seedBlock();
  const { groupId } = await withRevision(
    { action: "SPLIT", label: "Rozdělení bloku", user: USER },
    async (rtx) => {
      await rtx.block.update({
        where: { id: block.id },
        data: { endTime: new Date("2026-12-01T10:00:00.000Z"), printMinutes: 240 },
      });
      return rtx.block.create({
        data: {
          orderNumber: "REV-TEST", machine: "XL_105",
          startTime: new Date("2026-12-01T10:00:00.000Z"),
          endTime: new Date("2026-12-01T14:00:00.000Z"),
          type: "ZAKAZKA", printMinutes: 240,
        },
      });
    },
  );

  const revs = await prisma.blockRevision.findMany({ where: { groupId }, orderBy: { blockId: "asc" } });
  assert.equal(revs.length, 2);
  assert.deepEqual(revs.map((r) => r.kind).sort(), ["CREATE", "UPDATE"]);

  const ids = revs.map((r) => r.blockId);
  await prisma.blockRevision.deleteMany({ where: { groupId } });
  await prisma.block.deleteMany({ where: { id: { in: ids } } });
});
```

- [ ] **Step 5: Testy a build**

```bash
node --test --import tsx src/lib/revision.server.test.ts
npm run build
```
Expected: zelené.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/blocks/route.ts src/app/api/blocks/batch/route.ts "src/app/api/blocks/[id]/split/route.ts" src/lib/revision.server.test.ts
git commit -m "feat(revize): zapojit POST, batch a split"
```

---

## Task 8: Zapojení reflow a undo

Reflow je nejdelší transakce v repu (`timeout: 30000`), takže se `txOptions` musí předat.

**Files:**
- Modify: `src/app/api/blocks/reflow/route.ts:51`, `src/app/api/blocks/[id]/reflow/route.ts:28`, `src/app/api/blocks/undo/route.ts:40`

**Interfaces:**
- Consumes: `withRevision` (Task 5).

- [ ] **Step 1: Celostrojový reflow**

V `src/app/api/blocks/reflow/route.ts` nahradit řádky 51–54:
```typescript
    const { result } = await withRevision(
      {
        action: "REFLOW",
        label: "Přepočet stroje",
        user: { id: session.id, username: session.username },
        txOptions: { timeout: 30000, maxWait: 5000 },
      },
      (tx) => reflowMachineInTx(tx, machine, { id: session.id, username: session.username }, new Date()),
    );
```

- [ ] **Step 2: Per-blok reflow**

V `src/app/api/blocks/[id]/reflow/route.ts` nahradit řádek 28 stejným vzorem s `label: "Přepočet bloku"` a výchozím `txOptions`.

- [ ] **Step 3: Undo endpoint**

V `src/app/api/blocks/undo/route.ts` nahradit řádek 40:
```typescript
    const { result } = await withRevision(
      { action: "UNDO", label: body.label, user: { id: session.id, username: session.username } },
      (tx) => applyUndoOps(tx, ops, { ...session, direction: body.direction, label: body.label }),
    );
```
Přesné argumenty `applyUndoOps` opsat z dnešního volání — mění se jen obal, ne parametry.

> **Pozor:** `applyUndoOps` si bere `SELECT … FOR UPDATE` jako první dotaz transakce (`undoApply.server.ts:154`). To zůstává — `withRevision` před tělem žádný dotaz nepouští, zachycení se spouští až při prvním zápisu.

- [ ] **Step 4: Testy a build**

```bash
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
npm run build
```
Expected: zelené. `reflow.server.test.ts` a `undoApply.server.test.ts` používají vlastní mocky transakce, které se nemění — Proxy je strukturálně `PrismaTransactionClient`.

- [ ] **Step 5: Ruční ověření Ctrl+Z**

V prohlížeči přesunout blok, dát Ctrl+Z a ověřit, že vznikly **dvě** skupiny revizí (původní s `action: "UPDATE"`, undo s `action: "UNDO"`).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/blocks/reflow/route.ts "src/app/api/blocks/[id]/reflow/route.ts" src/app/api/blocks/undo/route.ts
git commit -m "feat(revize): zapojit reflow (obě routy) a undo endpoint"
```

---

## Task 9: Zapojení complete a expedition

`complete` používá **polní** `$transaction([...])`, do které pomocníka napojit nejde. Musí se přepsat na interaktivní.

**Files:**
- Modify: `src/app/api/blocks/[id]/complete/route.ts:48`, `src/app/api/blocks/[id]/expedition/route.ts:79` a `:123`

- [ ] **Step 1: Přepsat `complete` na interaktivní transakci**

V `src/app/api/blocks/[id]/complete/route.ts` nahradit blok od řádku 48 (`const [updatedBlock] = await prisma.$transaction([`) až po jeho uzavření za:
```typescript
    const { result: updatedBlock } = await withRevision(
      {
        action: "PRINT_COMPLETE",
        label: completed ? "Potvrzení tisku" : "Vrácení tisku",
        user: { id: userId, username },
      },
      async (tx) => {
        const updated = await tx.block.update({
          where: { id: blockId },
          data: completed
            ? {
                printCompletedAt: new Date(),
                printCompletedByUserId: userId,
                printCompletedByUsername: username,
              }
            : {
                printCompletedAt: null,
                printCompletedByUserId: null,
                printCompletedByUsername: null,
              },
        });
        await tx.auditLog.create({
          data: {
            blockId,
            orderNumber: block.orderNumber,
            userId,
            username,
            action: auditAction,
          },
        });
        return updated;
      },
    );
```
Původní pole mělo **přesně dvě položky** (`prisma.block.update` a `prisma.auditLog.create`) — obě jsou v těle výš, ve stejném pořadí. Nic dalšího se nepřesouvá.

Kód pod transakcí (refetch s `include: { Reservation: … }`, `emitSSE`, `return NextResponse.json(...)`) zůstává **beze změny** — běží mimo transakci a `updatedBlock` má stejný tvar jako dřív.

- [ ] **Step 2: Expedition — obě transakce**

V `src/app/api/blocks/[id]/expedition/route.ts` obalit obě transakce (řádky 79 a 123):
```typescript
      const { result: siblingGroupId } = await withRevision(
        { action: "EXPEDITION", label: "Zařazení do expedice", user: { id: session.id, username: session.username } },
        async (tx) => {
```
U druhé transakce použít `label: "Vyřazení z expedice"`.

- [ ] **Step 3: Testy a build**

```bash
npm run build
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Expected: zelené.

- [ ] **Step 4: Ruční ověření**

V režimu tiskaře potvrdit tisk bloku → vznikne revize s `action: "PRINT_COMPLETE"` a rozdílem obsahujícím `printCompletedAt`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/blocks/[id]/complete/route.ts" "src/app/api/blocks/[id]/expedition/route.ts"
git commit -m "feat(revize): zapojit complete (přepis na interaktivní transakci) a expedition"
```

---

## Task 10: Mapa pokrytí auditu

Potlačení v historii běží **po sloupcích**, ne po řádcích. `BlockEdit.buildPayload()` posílá v jednom PUT zároveň obchodní pole i `printMinutes`, takže potlačení po řádcích by zahodilo právě tu poziční informaci, kvůli které B1 vzniká.

**Files:**
- Create: `src/lib/auditCoverage.ts`
- Test: `src/lib/auditCoverage.test.ts`

**Interfaces:**
- Produces: `coveredColumns(action: string, field: string | null): string[] | "ALL"` — používá Task 12.

- [ ] **Step 1: Napsat padající test**

`src/lib/auditCoverage.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { coveredColumns } from "./auditCoverage";

test("UPDATE s názvem sloupce pokrývá právě ten sloupec", () => {
  assert.deepEqual(coveredColumns("UPDATE", "deadlineExpedice"), ["deadlineExpedice"]);
});

test("AUTO_SHIFT pokrývá startTime i endTime", () => {
  assert.deepEqual(coveredColumns("AUTO_SHIFT", "startTime/endTime").sort(), ["endTime", "startTime"]);
});

test("složené pole se strojem pokrývá všechny tři", () => {
  assert.deepEqual(coveredColumns("UPDATE", "startTime/endTime/machine").sort(), ["endTime", "machine", "startTime"]);
});

test("CREATE a DELETE pokrývají celý řádek", () => {
  assert.equal(coveredColumns("CREATE", null), "ALL");
  assert.equal(coveredColumns("DELETE", null), "ALL");
});

test("EXPEDITION_PUBLISH pokrývá jen expediční sloupce", () => {
  assert.deepEqual(coveredColumns("EXPEDITION_PUBLISH", null).sort(), ["expeditionPublishedAt", "expeditionSortOrder"]);
});

test("PRINT_COMPLETE pokrývá trojici printCompleted*", () => {
  assert.deepEqual(coveredColumns("PRINT_COMPLETE", null).sort(),
    ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"]);
});

test("AUTO_REFLOW pokrývá pozici i tiskové minuty", () => {
  assert.deepEqual(coveredColumns("AUTO_REFLOW", null).sort(), ["endTime", "printMinutes", "startTime"]);
});

test("neznámá kombinace nepokrývá nic", () => {
  assert.deepEqual(coveredColumns("RESERVATION_NOTIFY", null), []);
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/auditCoverage.test.ts
```
Expected: FAIL — `Cannot find module './auditCoverage'`.

- [ ] **Step 3: Implementovat**

`src/lib/auditCoverage.ts`:
```typescript
/**
 * Které sloupce Block už pokrývá auditní řádek — tedy pro které NEMÁ panel
 * historie vykreslovat revizní řádek navíc.
 *
 * Potlačuje se po SLOUPCÍCH, ne po řádcích: jeden PUT z BlockEditu nese zároveň
 * obchodní pole (auditovaná) i změnu délky (neauditovanou). Potlačení po řádcích
 * by tu poziční změnu zahodilo — přesně tu, kvůli které se revize zavádějí.
 *
 * Žije vedle AUDITED_FIELDS (src/lib/auditedFields.ts) jako jediný zdroj pravdy.
 * Když přibude nová hodnota AuditLog.action nebo .field, MUSÍ přibýt i sem.
 */
const COMPOSITE_FIELDS: Record<string, string[]> = {
  "startTime/endTime": ["startTime", "endTime"],
  "startTime/endTime/machine": ["startTime", "endTime", "machine"],
};

const BY_ACTION: Record<string, string[] | "ALL"> = {
  CREATE: "ALL",
  DELETE: "ALL",
  EXPEDITION_PUBLISH: ["expeditionPublishedAt", "expeditionSortOrder"],
  EXPEDITION_UNPUBLISH: ["expeditionPublishedAt", "expeditionSortOrder"],
  PRINT_COMPLETE: ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"],
  PRINT_UNDO: ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"],
  PRINT_RESET: ["printCompletedAt", "printCompletedByUserId", "printCompletedByUsername"],
  AUTO_REFLOW: ["startTime", "endTime", "printMinutes"],
};

export function coveredColumns(action: string, field: string | null): string[] | "ALL" {
  if (field) {
    if (COMPOSITE_FIELDS[field]) return COMPOSITE_FIELDS[field];
    return [field];
  }
  return BY_ACTION[action] ?? [];
}
```

- [ ] **Step 4: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/auditCoverage.test.ts
```
Expected: 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auditCoverage.ts src/lib/auditCoverage.test.ts
git commit -m "feat(historie): mapa pokrytí auditních řádků po sloupcích"
```

---

## Task 11: Formátování řádků historie

**Files:**
- Modify: `src/lib/dateUtils.ts`
- Create: `src/lib/revisionFormat.ts`
- Test: `src/lib/revisionFormat.test.ts`

**Interfaces:**
- Produces: `formatPragueDateTimeWithWeekday(d: Date): string`, `formatRevisionLines(before, after): string[]` — používá Task 13.

- [ ] **Step 1: Přidat formátovač data**

`formatPragueDateTime` (`dateUtils.ts:217-219`) vypisuje „08.08.2026 14:00", ne „pá 8. 8. 14:00". Do `src/lib/dateUtils.ts` přidat vedle stávajících formátovačů:
```typescript
const PRAGUE_WEEKDAY_FMT = new Intl.DateTimeFormat("cs-CZ", {
  weekday: "short",
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
});

/**
 * „pá 8. 8. 14:00" — tvar pro panel historie bloku. Stávající
 * `formatPragueDateTime` dává „08.08.2026 14:00" a den v týdnu neumí.
 */
export function formatPragueDateTimeWithWeekday(d: Date): string {
  return PRAGUE_WEEKDAY_FMT.format(d);
}
```

- [ ] **Step 2: Napsat padající test**

`src/lib/revisionFormat.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRevisionLines } from "./revisionFormat";

const T = (iso: string) => new Date(iso);

test("změna stroje i času → jeden řádek s oběma stroji", () => {
  const lines = formatRevisionLines(
    { machine: "XL_105", startTime: T("2026-08-08T12:00:00Z") },
    { machine: "XL_106", startTime: T("2026-08-11T04:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Přesunuto z XL_105 .* na XL_106 /);
});

test("změna jen času → „Přesunuto na“", () => {
  const lines = formatRevisionLines(
    { startTime: T("2026-08-08T12:00:00Z") },
    { startTime: T("2026-08-11T04:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Přesunuto na /);
});

test("prodloužení konce → „Prodlouženo“", () => {
  const lines = formatRevisionLines(
    { endTime: T("2026-08-08T14:00:00Z") },
    { endTime: T("2026-08-08T16:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Prodlouženo do /);
});

test("zkrácení konce → „Zkráceno“", () => {
  const lines = formatRevisionLines(
    { endTime: T("2026-08-08T16:00:00Z") },
    { endTime: T("2026-08-08T13:00:00Z") },
  );
  assert.match(lines[0], /^Zkráceno do /);
});

test("printMinutes se slučuje do řádku o délce, nevytváří vlastní", () => {
  const lines = formatRevisionLines(
    { endTime: T("2026-08-08T14:00:00Z"), printMinutes: 480 },
    { endTime: T("2026-08-08T16:00:00Z"), printMinutes: 600 },
  );
  assert.equal(lines.length, 1);
});

test("zámek", () => {
  assert.deepEqual(formatRevisionLines({ locked: false }, { locked: true }), ["Zamčeno"]);
  assert.deepEqual(formatRevisionLines({ locked: true }, { locked: false }), ["Odemčeno"]);
});

test("sloupec bez popisku se tiše přeskočí", () => {
  assert.deepEqual(formatRevisionLines({ splitGroupId: null }, { splitGroupId: 7 }), []);
});

test("přechod letního času — konec října", () => {
  const lines = formatRevisionLines(
    { startTime: T("2026-10-24T06:00:00Z") },
    { startTime: T("2026-10-26T06:00:00Z") },
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /7:00/, "26. 10. je po přechodu, UTC 06:00 je 7:00 pražského času");
});
```

- [ ] **Step 3: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/revisionFormat.test.ts
```
Expected: FAIL — `Cannot find module './revisionFormat'`.

- [ ] **Step 4: Implementovat**

`src/lib/revisionFormat.ts`:
```typescript
import { formatPragueDateTimeWithWeekday } from "./dateUtils";

type Row = Record<string, unknown>;

const asDate = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === "string" ? new Date(v) : null);

/**
 * Rozdíl revize → řádky pro panel historie bloku.
 * Sloupec bez popisku se tiše přeskočí — interní příznaky (splitGroupId,
 * scheduleBypassed) v historii nemají co dělat.
 */
export function formatRevisionLines(before: Row, after: Row): string[] {
  const lines: string[] = [];

  const machineChanged = "machine" in after;
  const startChanged = "startTime" in after;
  const endChanged = "endTime" in after;

  if (machineChanged || startChanged) {
    const newStart = asDate(after.startTime) ?? asDate(before.startTime);
    const when = newStart ? formatPragueDateTimeWithWeekday(newStart) : "";
    if (machineChanged) {
      const oldStart = asDate(before.startTime);
      const from = oldStart ? ` ${formatPragueDateTimeWithWeekday(oldStart)}` : "";
      lines.push(`Přesunuto z ${String(before.machine)}${from} na ${String(after.machine)} ${when}`);
    } else {
      lines.push(`Přesunuto na ${when}`);
    }
  } else if (endChanged) {
    // Změna konce bez změny začátku = natažení nebo zkrácení.
    // printMinutes se do vlastního řádku nepromítá — je to táž událost.
    const oldEnd = asDate(before.endTime);
    const newEnd = asDate(after.endTime);
    if (oldEnd && newEnd) {
      const verb = newEnd.getTime() > oldEnd.getTime() ? "Prodlouženo" : "Zkráceno";
      lines.push(
        `${verb} do ${formatPragueDateTimeWithWeekday(newEnd)} (z ${formatPragueDateTimeWithWeekday(oldEnd)})`,
      );
    }
  }

  if ("locked" in after) lines.push(after.locked === true ? "Zamčeno" : "Odemčeno");

  return lines;
}
```

- [ ] **Step 5: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/revisionFormat.test.ts
```
Expected: 8 pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dateUtils.ts src/lib/revisionFormat.ts src/lib/revisionFormat.test.ts
git commit -m "feat(historie): české řádky z revizního rozdílu + formátovač s dnem v týdnu"
```

---

## Task 12: Sloučená osa v endpointu historie

Predikát potlačení **nejde vyhodnotit z okna `take: 10`** — jedno uložení z BlockEditu běžně vyrobí přes deset auditních řádků, takže starší skupina by z okna vypadla a její revize by se zobrazila, přestože potlačena být má. Řeší to samostatný dotaz.

**Files:**
- Create: `src/lib/blockHistory.ts`
- Test: `src/lib/blockHistory.test.ts`
- Modify: `src/app/api/blocks/[id]/audit/route.ts`

**Interfaces:**
- Consumes: `coveredColumns` (Task 10), `formatRevisionLines` (Task 11).
- Produces: `type BlockHistoryEntry`, `suppressCoveredColumns(diffBefore, diffAfter, auditRows): { before: Row; after: Row } | null` — používá Task 13.

- [ ] **Step 1: Napsat padající test**

`src/lib/blockHistory.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { suppressCoveredColumns } from "./blockHistory";

test("sloupec pokrytý auditem se z revize odečte", () => {
  const out = suppressCoveredColumns(
    { deadlineExpedice: null, endTime: new Date("2026-08-08T14:00:00Z") },
    { deadlineExpedice: new Date("2026-08-12T00:00:00Z"), endTime: new Date("2026-08-08T18:00:00Z") },
    [{ action: "UPDATE", field: "deadlineExpedice" }],
  );
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["endTime"], "poziční změna zůstává viditelná");
});

test("když audit pokryje všechno, revize zmizí", () => {
  const out = suppressCoveredColumns(
    { deadlineExpedice: null },
    { deadlineExpedice: new Date("2026-08-12T00:00:00Z") },
    [{ action: "UPDATE", field: "deadlineExpedice" }],
  );
  assert.equal(out, null);
});

test("CREATE pokrývá celý řádek", () => {
  const out = suppressCoveredColumns({ machine: "XL_105" }, { machine: "XL_106" }, [{ action: "CREATE", field: null }]);
  assert.equal(out, null);
});

test("bez auditních řádků zůstane revize celá", () => {
  const out = suppressCoveredColumns({ machine: "XL_105" }, { machine: "XL_106" }, []);
  assert.ok(out);
  assert.deepEqual(Object.keys(out.after), ["machine"]);
});

test("AUTO_SHIFT potlačí obě poloviny posunu", () => {
  const out = suppressCoveredColumns(
    { startTime: new Date("2026-08-08T06:00:00Z"), endTime: new Date("2026-08-08T14:00:00Z") },
    { startTime: new Date("2026-08-09T06:00:00Z"), endTime: new Date("2026-08-09T14:00:00Z") },
    [{ action: "AUTO_SHIFT", field: "startTime/endTime" }],
  );
  assert.equal(out, null);
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/blockHistory.test.ts
```
Expected: FAIL — `Cannot find module './blockHistory'`.

- [ ] **Step 3: Implementovat**

`src/lib/blockHistory.ts`:
```typescript
import { coveredColumns } from "./auditCoverage";

type Row = Record<string, unknown>;

/**
 * Položka sloučené osy historie bloku. ZÁMĚRNĚ samostatný typ, ne rozšíření
 * `AuditLogEntry` — ten má v repu DVĚ nezávislé definice
 * (src/components/InfoPanel.tsx a src/components/admin/AuditLogPanel.tsx),
 * obsluhuje jiné endpointy a jeho úprava by tiše vyprázdnila panel notifikací.
 */
export type BlockHistoryEntry =
  | {
      source: "audit";
      id: number;
      createdAt: string;
      username: string;
      action: string;
      field: string | null;
      oldValue: string | null;
      newValue: string | null;
      orderNumber: string | null;
    }
  | {
      source: "revision";
      id: number;
      createdAt: string;
      username: string;
      action: string;
      label: string;
      lines: string[];
    };

/**
 * Z revizního rozdílu odečte sloupce, které v téže transakci pokrývá auditní
 * řádek. Vrací `null`, když po odečtení nezbude nic.
 *
 * Odečítá se po SLOUPCÍCH, ne po celém řádku: jeden PUT z BlockEditu nese
 * zároveň obchodní pole i změnu délky, takže potlačení po řádcích by pozici
 * zahodilo.
 */
export function suppressCoveredColumns(
  diffBefore: Row,
  diffAfter: Row,
  auditRows: { action: string; field: string | null }[],
): { before: Row; after: Row } | null {
  const covered = new Set<string>();
  for (const row of auditRows) {
    const cols = coveredColumns(row.action, row.field);
    if (cols === "ALL") return null;
    cols.forEach((c) => covered.add(c));
  }

  const before: Row = {};
  const after: Row = {};
  for (const key of Object.keys(diffAfter)) {
    if (covered.has(key)) continue;
    before[key] = diffBefore[key] ?? null;
    after[key] = diffAfter[key];
  }

  return Object.keys(after).length === 0 ? null : { before, after };
}
```

- [ ] **Step 4: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/blockHistory.test.ts
```
Expected: 5 pass.

- [ ] **Step 5: Přepsat endpoint**

`src/app/api/blocks/[id]/audit/route.ts` — nahradit tělo GET handleru (dnešní `findMany` s `take: 10`):
```typescript
    const [auditRows, revisionRows] = await Promise.all([
      prisma.auditLog.findMany({
        where: { blockId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.blockRevision.findMany({
        where: { blockId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    // Predikát potlačení NEJDE vyhodnotit z desetiřádkového okna auditu —
    // jedno uložení z BlockEditu vyrobí přes deset auditních řádků, takže by
    // starší skupina z okna vypadla. Ptáme se proto cíleně na dotčené groupId.
    const groupIds = revisionRows.map((r) => r.groupId);
    const coveringRows = groupIds.length
      ? await prisma.auditLog.findMany({
          where: { blockId: id, groupId: { in: groupIds } },
          select: { groupId: true, action: true, field: true },
        })
      : [];

    const byGroup = new Map<string, { action: string; field: string | null }[]>();
    for (const row of coveringRows) {
      if (!row.groupId) continue;
      const list = byGroup.get(row.groupId) ?? [];
      list.push({ action: row.action, field: row.field });
      byGroup.set(row.groupId, list);
    }

    const entries: BlockHistoryEntry[] = auditRows.map((log) => ({
      source: "audit" as const,
      id: log.id,
      createdAt: log.createdAt.toISOString(),
      username: log.username,
      action: log.action,
      field: log.field,
      oldValue: log.oldValue,
      newValue: log.newValue,
      orderNumber: log.orderNumber,
    }));

    for (const rev of revisionRows) {
      if (rev.kind !== "UPDATE") continue; // vznik a smazání pokrývá AuditLog
      const kept = suppressCoveredColumns(
        (rev.before as Record<string, unknown>) ?? {},
        (rev.after as Record<string, unknown>) ?? {},
        byGroup.get(rev.groupId) ?? [],
      );
      if (!kept) continue;
      const lines = formatRevisionLines(kept.before, kept.after);
      if (lines.length === 0) continue;
      entries.push({
        source: "revision",
        id: rev.id,
        createdAt: rev.createdAt.toISOString(),
        username: rev.username,
        action: rev.action,
        label: rev.label,
        lines,
      });
    }

    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json(entries.slice(0, 10));
```
Doplnit importy:
```typescript
import { suppressCoveredColumns, type BlockHistoryEntry } from "@/lib/blockHistory";
import { formatRevisionLines } from "@/lib/revisionFormat";
```

- [ ] **Step 6: Build a testy**

```bash
npm run build
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Expected: build spadne v `BlockDetail.tsx` (konzumuje starý tvar) — to řeší Task 13. Testy zelené.

- [ ] **Step 7: Commit**

```bash
git add src/lib/blockHistory.ts src/lib/blockHistory.test.ts "src/app/api/blocks/[id]/audit/route.ts"
git commit -m "feat(historie): sloučená osa AuditLog + BlockRevision s potlačením po sloupcích"
```

---

## Task 13: Render v panelu historie

**Files:**
- Modify: `src/components/BlockDetail.tsx` — stav historie (kolem `:105`), fetch (`:126-131`), render (`:568`)

**Interfaces:**
- Consumes: `BlockHistoryEntry` (Task 12).

- [ ] **Step 1: Přepnout typ stavu**

V `src/components/BlockDetail.tsx` přidat import:
```typescript
import type { BlockHistoryEntry } from "@/lib/blockHistory";
```
a u stavu `blockHistory` (dnes `useState<AuditLogEntry[]>([])`) změnit typový parametr:
```typescript
const [blockHistory, setBlockHistory] = useState<BlockHistoryEntry[]>([]);
```
Import `AuditLogEntry` z `InfoPanel.tsx` z tohohle souboru odstranit, pokud už není potřeba jinde. **Samotný `AuditLogEntry` v `InfoPanel.tsx` neměnit** — obsluhuje `/api/audit/today` a jeho úprava by vyprázdnila panel notifikací.

- [ ] **Step 2: Přidat revizní větev na začátek mapy**

V `src/components/BlockDetail.tsx:568` je `{blockHistory.map((log, i) => {`. Hned za tuhle řádku vložit early-return větev — **stávající kód od `const undoRedo = …` (dnešní `:572`) dál zůstává beze změny**:

```tsx
{blockHistory.map((log, i) => {
  if (log.source === "revision") {
    return (
      <div key={`r${log.id}`} style={{ padding: "5px 10px", borderTop: i > 0 ? "1px solid var(--border)" : undefined, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap", paddingTop: 1, minWidth: 70 }}>
          {formatPragueDateShort(new Date(log.createdAt))} {formatPragueTime(new Date(log.createdAt))}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", flex: 1 }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{log.username}</span>
          {log.lines.map((line, j) => (
            <span key={j} style={{ color: "var(--text)" }}> · {line}</span>
          ))}
        </div>
      </div>
    );
  }
  // … dnešní kód beze změny, začíná na `const undoRedo = log.action === "UNDO" …`
```

Rozvržení (odsazení, `borderTop`, velikosti písma) je **schválně totožné** s auditním řádkem — jde o jednu časovou osu, ne dva různé seznamy. Barvy **výhradně přes CSS tokeny** (`--text`, `--text-muted`, `--border`); hex literál by rozbil světlý motiv.

TypeScript narrowing přes `log.source` funguje, protože `BlockHistoryEntry` je diskriminovaná unie — ve větvi pod `if` je `log` zúžený na auditní variantu a přístup na `log.field`/`log.oldValue` se přeloží.

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: zelený.

- [ ] **Step 4: Ruční ověření na dev databázi**

Spustit dev server a fixturu:
```bash
npx tsx scripts/seed-test-pripominky-dev.ts
```
Pak v prohlížeči ověřit **tři scénáře ze specu**:
1. Přetáhnout blok na jiný stroj → v historii řádek s oběma stroji a časy, **právě jednou**.
2. V BlockEditu změnit **zároveň** délku a termín expedice → historie ukáže **obojí** (řádek o termínu z auditu, řádek „Prodlouženo" z revize).
3. Uložit popis u hlavy rozdělené zakázky → u sourozenců **nepřibude prázdný řádek**.

Vše ve světlém i tmavém motivu.

- [ ] **Step 5: Commit**

```bash
git add src/components/BlockDetail.tsx
git commit -m "feat(historie): vykreslit revizní řádky v panelu historie bloku"
```

---

## Task 14: Úklid po 90 dnech

**Files:**
- Create: `scripts/prune-revisions.ts`
- Modify: `docs/OPS_ZALOHY.md`

- [ ] **Step 1: Napsat skript**

`scripts/prune-revisions.ts`:
```typescript
/**
 * Denní úklid revizí starších než REVISION_RETENTION_DAYS.
 * Pouští se cronem vedle denní zálohy (docs/OPS_ZALOHY.md).
 *
 * Maže po dávkách — jednorázový deleteMany nad desetitisíci řádky by držel
 * dlouhý zámek a mohl by zablokovat plánovače uprostřed práce.
 *
 * Maže po CELÝCH groupId: půlka dávky v tabulce je horší než žádná.
 */
import { prisma } from "../src/lib/prisma";

const REVISION_RETENTION_DAYS = 90;
const BATCH = 1000;

async function main() {
  const cutoff = new Date(Date.now() - REVISION_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Celé skupiny, jejichž NEJNOVĚJŠÍ řádek je za hranicí retence.
  const stale = await prisma.$queryRaw<{ groupId: string }[]>`
    SELECT groupId FROM BlockRevision
    GROUP BY groupId
    HAVING MAX(createdAt) < ${cutoff}
    LIMIT ${BATCH}
  `;

  let total = 0;
  let groups = stale;
  while (groups.length > 0) {
    const ids = groups.map((g) => g.groupId);
    const res = await prisma.blockRevision.deleteMany({ where: { groupId: { in: ids } } });
    total += res.count;
    groups = await prisma.$queryRaw<{ groupId: string }[]>`
      SELECT groupId FROM BlockRevision
      GROUP BY groupId
      HAVING MAX(createdAt) < ${cutoff}
      LIMIT ${BATCH}
    `;
  }

  const [size] = await prisma.$queryRaw<{ mb: number }[]>`
    SELECT ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 1) AS mb
    FROM information_schema.TABLES
    WHERE TABLE_NAME = 'BlockRevision' AND TABLE_SCHEMA = DATABASE()
  `;

  console.log(`[prune-revisions] smazáno ${total} řádků, tabulka má ${size?.mb ?? "?"} MB`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[prune-revisions] selhalo:", err);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 2: Ověřit na dev databázi**

```bash
npx tsx scripts/prune-revisions.ts
```
Expected: `smazáno 0 řádků, tabulka má … MB` (dev data jsou čerstvá, nic se nesmaže).

- [ ] **Step 3: Ověřit, že opravdu maže**

```bash
node --import tsx -e "
import { prisma } from './src/lib/prisma';
await prisma.blockRevision.create({ data: {
  groupId: 'PRUNE-TEST', blockId: 999999, machine: 'XL_105', action: 'UPDATE',
  kind: 'UPDATE', label: 'test', userId: 1, username: 'test',
  createdAt: new Date('2020-01-01T00:00:00Z'),
}});
await prisma.\$disconnect();
"
npx tsx scripts/prune-revisions.ts
```
Expected: `smazáno 1 řádků`.

- [ ] **Step 4: Doplnit do provozní dokumentace**

Do `docs/OPS_ZALOHY.md` přidat sekci s cronem vedle stávající denní zálohy:
```
# Denní úklid revizí (retence 90 dní) — po záloze
30 3 * * * cd /cesta/k/aplikaci && npx tsx scripts/prune-revisions.ts >> /var/log/prune-revisions.log 2>&1
```

- [ ] **Step 5: Commit**

```bash
git add scripts/prune-revisions.ts docs/OPS_ZALOHY.md
git commit -m "feat(ops): denní úklid revizí po 90 dnech"
```

---

## Task 15: Dokumentace a pravidla

**Files:**
- Modify: `CLAUDE.md`, `docs/vyvoj-historie.md`

- [ ] **Step 1: Doplnit pravidlo do CLAUDE.md**

Do sekce „Coding standards (POVINNÉ pro nový kód)" přidat:
```markdown
**Každá mutace bloku běží uvnitř `withRevision`** (`src/lib/revision.server.ts`) — pomocník otevírá transakci sám a tělu předá klient s podstrčenými delegáty `block` a `auditLog`. Zachycení „před" stavu se řídí `where` samotného zápisu, takže volající nikde nevyjmenovává pole ani bloky.

- **Nová mutační cesta MUSÍ `withRevision` použít.** Pomocník tohle uhlídat nemůže — je to jediná obrana v code review.
- **Uvnitř těla nikdy nesahat na `prisma.*` přímo** — zápis by revizi minul.
- **Vnořené zápisy do `Block` přes jiný model** (`reservation.update` s `data.blocks.update`) jsou zakázané. Dnes v repu nejsou; obal je nevidí.
- **`block.createMany` uvnitř `withRevision` hází** — MySQL nevrací id, takže revizi k němu nejde přiřadit. Použij `create` ve smyčce.
- **Změny přes referenční integritu revize nezachytí.** Známé a vědomé: `Block.recurrenceParentId` má `ON DELETE SET NULL`, a DML uvnitř migrací.
- Nový `Boolean` nebo `DateTime` sloupec na `Block` MUSÍ přibýt i do `src/lib/revision/blockColumns.ts` — jinak ho raw zachycení uloží jako 0/1, resp. jako řetězec.
- Nová hodnota `AuditLog.action`/`field` MUSÍ přibýt do `src/lib/auditCoverage.ts`, jinak se řádek historie zdvojí.
```

Do sekce „Klíčové soubory" přidat `revision.server.ts` · `revision/diff.ts` · `revision/rowNormalize.ts` · `auditCoverage.ts` · `blockHistory.ts` · `revisionFormat.ts`.

Do „Data & DB" doplnit model `BlockRevision` do výčtu modelů.

- [ ] **Step 2: Doplnit historii vývoje**

Do `docs/vyvoj-historie.md` přidat oddíl „Etapa B1 — serverové revize" se shrnutím: co se zavedlo, proč padl původní návrh regionu, a odkaz na spec.

- [ ] **Step 3: Celá suita + build**

```bash
npm run build
npm run lint
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Expected: build zelený, lint 0 chyb (warningy tolerované), všechny testy prochází.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/vyvoj-historie.md
git commit -m "docs: pravidla a historie etapy B1 (serverové revize)"
```

---

## Ověření před nasazením na produkci

Tohle **není task** — je to kontrolní seznam pro deploy, který se dělá s Michalem.

1. **Měření souběhu.** Dva prohlížeče, dva uživatelé, tentýž stroj: jeden spustí „Přepočítat celý stroj", druhý ve stejnou chvíli přetahuje blok a zakládá nový. Kontrolní otázka: chová se to jako dnes? Pomocník nemá zámky rozšířit — zamyká jen to, do čeho se stejně zapisuje.
2. **Měření počtu dotazů** na celostrojovém přepočtu před a po. Očekávaný nárůst jednotky procent; kdyby vyšel řádově víc, zachycení se nedávkuje správně.
3. **Předměření produkční `AuditLog`** — `CREATE INDEX` **není** instantní operace:
   ```sql
   SELECT COUNT(*) FROM AuditLog;
   SELECT DATA_LENGTH, INDEX_LENGTH, ROW_FORMAT FROM information_schema.TABLES WHERE TABLE_NAME = 'AuditLog';
   ```
   `ROW_FORMAT` musí být `DYNAMIC` — na starším `COMPACT` z doby ručních zásahů se `INSTANT ADD COLUMN` tiše přepne na `INPLACE` s rebuildem celé tabulky. Podle výsledku rozhodnout, jestli index vytvořit při zastavené aplikaci.
4. **`mysqldump` záloha před migrací** — bez výjimky.
5. Po týdnu provozu porovnat skutečnou velikost `BlockRevision` s odhadem (pod 25 MB / 90 dní) a **teprve pak psát spec etapy B2**.
