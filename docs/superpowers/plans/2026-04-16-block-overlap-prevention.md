# Block Overlap Prevention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zabránit překrývání bloků na stejném stroji — server-side guard + oprava klientských root causes.

**Architecture:** Nový helper `checkBlockOverlap` v `src/lib/overlapCheck.ts` provádí Prisma dotaz na kolizi bloků na stejném stroji. Integruje se do PUT, POST a batch API routes uvnitř existujících transakcí. Na klientu se opraví stale `editingBlock`, `handleSaveAll` per-block endTime, a `autoResolveOverlap` chain push přechází na batch endpoint.

**Tech Stack:** Prisma 5, Next.js API routes, React state management

---

## File Structure

| Soubor | Akce | Zodpovědnost |
|--------|------|--------------|
| `src/lib/overlapCheck.ts` | CREATE | `checkBlockOverlap` helper — Prisma dotaz na kolizi |
| `src/lib/overlapCheck.test.ts` | CREATE | Unit testy pro overlap check |
| `src/lib/errors.ts` | MODIFY | Přidat `OVERLAP` do `AppErrorCode` |
| `src/app/api/blocks/[id]/route.ts` | MODIFY | Integrace overlap check do PUT transakce |
| `src/app/api/blocks/batch/route.ts` | MODIFY | Sekvenční zpracování + overlap check |
| `src/app/api/blocks/route.ts` | MODIFY | Overlap check v POST (nový blok) |
| `src/app/_components/PlannerPage.tsx` | MODIFY | Sync editingBlock, oprava handleSaveAll, batch push v autoResolveOverlap |
| `src/components/BlockEdit.tsx` | MODIFY | Handling 409 v doSave |

---

### Task 1: `checkBlockOverlap` helper + `OVERLAP` error code

**Files:**
- Create: `src/lib/overlapCheck.ts`
- Modify: `src/lib/errors.ts:1-7`

- [ ] **Step 1: Přidat `OVERLAP` do `AppErrorCode`**

V `src/lib/errors.ts` přidat `"OVERLAP"` do union type:

```typescript
export type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "PRESET_INVALID"
  | "SCHEDULE_VIOLATION"
  | "CONFLICT"
  | "OVERLAP"
  | "VALIDATION_ERROR";
```

- [ ] **Step 2: Vytvořit `src/lib/overlapCheck.ts`**

```typescript
import { AppError } from "@/lib/errors";

type PrismaTransactionClient = Parameters<Parameters<typeof import("@/lib/prisma").prisma.$transaction>[0]>[0];

/**
 * Zkontroluje, zda na daném stroji v daném časovém rozsahu existuje jiný blok.
 * Pokud ano, vyhodí AppError("OVERLAP", ...).
 * Volat uvnitř $transaction PŘED tx.block.update/create.
 */
export async function checkBlockOverlap(
  machine: string,
  startTime: Date,
  endTime: Date,
  excludeBlockId: number | null,
  tx: PrismaTransactionClient
): Promise<void> {
  const conflict = await tx.block.findFirst({
    where: {
      machine,
      ...(excludeBlockId != null && { id: { not: excludeBlockId } }),
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    select: { id: true, orderNumber: true },
  });
  if (conflict) {
    throw new AppError(
      "OVERLAP",
      `Blok koliduje s blokem #${conflict.orderNumber ?? conflict.id} na stroji ${machine}.`
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/errors.ts src/lib/overlapCheck.ts
git commit -m "feat: add checkBlockOverlap helper and OVERLAP error code"
```

---

### Task 2: Unit testy pro `checkBlockOverlap`

**Files:**
- Create: `src/lib/overlapCheck.test.ts`

- [ ] **Step 1: Vytvořit test soubor**

```typescript
import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Mock prisma module — checkBlockOverlap přijímá tx jako argument,
// takže testujeme přímo s mock tx objektem.

describe("checkBlockOverlap", () => {
  // Dynamický import po mock setup
  let checkBlockOverlap: typeof import("@/lib/overlapCheck").checkBlockOverlap;

  beforeEach(async () => {
    const mod = await import("@/lib/overlapCheck");
    checkBlockOverlap = mod.checkBlockOverlap;
  });

  it("projde pokud žádný blok nekoliduje", async () => {
    const tx = {
      block: {
        findFirst: mock.fn(async () => null),
      },
    } as never;

    await assert.doesNotReject(() =>
      checkBlockOverlap("XL_105", new Date("2026-04-16T10:00:00Z"), new Date("2026-04-16T12:00:00Z"), 1, tx)
    );
  });

  it("vyhodí OVERLAP pokud blok koliduje", async () => {
    const tx = {
      block: {
        findFirst: mock.fn(async () => ({ id: 42, orderNumber: "17221" })),
      },
    } as never;

    await assert.rejects(
      () => checkBlockOverlap("XL_105", new Date("2026-04-16T10:00:00Z"), new Date("2026-04-16T12:00:00Z"), 1, tx),
      (err: Error & { code?: string }) => {
        assert.equal(err.code, "OVERLAP");
        assert.ok(err.message.includes("17221"));
        return true;
      }
    );
  });

  it("excludeBlockId=null funguje pro nové bloky", async () => {
    const findFirstMock = mock.fn(async () => null);
    const tx = { block: { findFirst: findFirstMock } } as never;

    await checkBlockOverlap("XL_105", new Date("2026-04-16T10:00:00Z"), new Date("2026-04-16T12:00:00Z"), null, tx);

    const whereArg = findFirstMock.mock.calls[0].arguments[0].where;
    assert.equal(whereArg.id, undefined, "excludeBlockId=null nesmí přidat id filter");
  });

  it("sousední bloky (dotýkají se) nepovažuje za overlap", async () => {
    // Blok A: 10:00-12:00, nový blok B: 12:00-14:00
    // Podmínka: A.startTime(10:00) < B.endTime(14:00) AND A.endTime(12:00) > B.startTime(12:00)
    // 12:00 > 12:00 je FALSE → nepřekrývají se
    const findFirstMock = mock.fn(async () => null);
    const tx = { block: { findFirst: findFirstMock } } as never;

    await checkBlockOverlap("XL_105", new Date("2026-04-16T12:00:00Z"), new Date("2026-04-16T14:00:00Z"), null, tx);

    const whereArg = findFirstMock.mock.calls[0].arguments[0].where;
    // endTime: { gt: startTime } → endTime > 12:00 (strict gt = touching blocks pass)
    assert.deepEqual(whereArg.endTime, { gt: new Date("2026-04-16T12:00:00Z") });
  });
});
```

- [ ] **Step 2: Spustit testy**

Spustit: `node --test --import tsx src/lib/overlapCheck.test.ts`
Očekávaný výstup: 4 testy PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/overlapCheck.test.ts
git commit -m "test: unit tests for checkBlockOverlap"
```

---

### Task 3: Integrace overlap check do PUT `/api/blocks/[id]`

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts:1-10` (import), `~132` (uvnitř transakce), `~355` (statusMap)

- [ ] **Step 1: Přidat import**

Na začátek `src/app/api/blocks/[id]/route.ts` přidat:

```typescript
import { checkBlockOverlap } from "@/lib/overlapCheck";
```

- [ ] **Step 2: Přidat `OVERLAP` do statusMap**

V catch bloku (~řádek 355), přidat `OVERLAP: 409`:

```typescript
const statusMap: Record<string, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  PRESET_INVALID: 400,
  SCHEDULE_VIOLATION: 422,
  CONFLICT: 409,
  OVERLAP: 409,
};
```

- [ ] **Step 3: Přidat overlap check uvnitř transakce**

Uvnitř `prisma.$transaction` callbacku, PO načtení `oldBlock` a PŘED `tx.block.update` (mezi řádky ~200 a ~201), přidat:

```typescript
      // Overlap check — pokud se mění čas nebo stroj, ověřit že nepřekrýváme jiný blok
      const checkMachine = (allowed.machine as string | undefined) ?? oldBlock.machine;
      const checkStart = allowed.startTime ? new Date(allowed.startTime as string) : oldBlock.startTime;
      const checkEnd = allowed.endTime ? new Date(allowed.endTime as string) : oldBlock.endTime;
      if (
        checkStart.getTime() !== oldBlock.startTime.getTime() ||
        checkEnd.getTime() !== oldBlock.endTime.getTime() ||
        checkMachine !== oldBlock.machine
      ) {
        await checkBlockOverlap(checkMachine, checkStart, checkEnd, id, tx);
      }
```

- [ ] **Step 4: Ověřit build**

Spustit: `npm run build`
Očekávaný výstup: build projde bez chyb

- [ ] **Step 5: Commit**

```bash
git add src/app/api/blocks/[id]/route.ts
git commit -m "feat: server-side block overlap check in PUT endpoint"
```

---

### Task 4: Overlap check v batch endpointu — sekvenční zpracování

**Files:**
- Modify: `src/app/api/blocks/batch/route.ts:1-6` (import), `~74-120` (transakce)

- [ ] **Step 1: Přidat import**

```typescript
import { checkBlockOverlap } from "@/lib/overlapCheck";
```

- [ ] **Step 2: Přepsat transakci na sekvenční zpracování s overlap check**

Nahradit celý blok transakce (řádky 74-120) za:

```typescript
  try {
    const results = await prisma.$transaction(async (tx) => {
      const updated: Awaited<ReturnType<typeof tx.block.update>>[] = [];

      for (const u of updates) {
        // Overlap check — ověřit vůči existujícím blokům + již aktualizovaným v této transakci
        await checkBlockOverlap(u.machine, new Date(u.startTime), new Date(u.endTime), u.id, tx);

        const result = await tx.block.update({
          where: { id: u.id },
          data: {
            startTime: new Date(u.startTime),
            endTime: new Date(u.endTime),
            machine: u.machine,
          },
        });
        updated.push(result);
      }

      const auditRows: {
        blockId: number;
        orderNumber: string | null;
        userId: number;
        username: string;
        action: string;
        field?: string;
        oldValue?: string;
        newValue?: string;
      }[] = [];

      for (const u of updates) {
        const old = existingBlocks.find((b) => b.id === u.id);
        const updatedBlock = updated.find((b) => b.id === u.id);
        const orderNumber = updatedBlock?.orderNumber ?? old?.orderNumber ?? null;

        auditRows.push({
          blockId: u.id,
          orderNumber,
          userId: session.id,
          username: session.username,
          action: "UPDATE",
          field: "startTime/endTime/machine",
          oldValue: undefined,
          newValue: `${u.machine} ${u.startTime}–${u.endTime}`,
        });
      }

      await tx.auditLog.createMany({ data: auditRows });

      return updated;
    });

    return NextResponse.json(results.map(serializeBlock));
  } catch (error: unknown) {
    if (isAppError(error)) {
      const statusMap: Record<string, number> = { OVERLAP: 409 };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] ?? 400 }
      );
    }
    if (isPrismaNotFound(error)) {
      return NextResponse.json({ error: "Jeden nebo více bloků nenalezeno" }, { status: 404 });
    }
    logger.error("[POST /api/blocks/batch]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
```

- [ ] **Step 3: Přidat import `isAppError`**

V importech na začátku souboru přidat:

```typescript
import { isAppError } from "@/lib/errors";
```

(Typ `AppError` není potřeba — `isAppError` stačí pro catch blok.)

- [ ] **Step 4: Ověřit build**

Spustit: `npm run build`
Očekávaný výstup: build projde bez chyb

- [ ] **Step 5: Commit**

```bash
git add src/app/api/blocks/batch/route.ts
git commit -m "feat: sequential batch processing with overlap check"
```

---

### Task 5: Overlap check v POST `/api/blocks` (nový blok)

**Files:**
- Modify: `src/app/api/blocks/route.ts:1-8` (import), `~103` (uvnitř transakce)

- [ ] **Step 1: Přidat import**

```typescript
import { checkBlockOverlap } from "@/lib/overlapCheck";
```

- [ ] **Step 2: Přidat overlap check uvnitř transakce, před `tx.block.create`**

Na řádku ~109 (před `const newBlock = await tx.block.create`), přidat:

```typescript
      await checkBlockOverlap(body.machine, new Date(body.startTime), new Date(body.endTime), null, tx);
```

- [ ] **Step 3: Přidat AppError handling do catch bloku**

V catch bloku POST funkce (najít `catch (error`) přidat handling jako v PUT route:

```typescript
    if (isAppError(error)) {
      const statusMap: Record<string, number> = {
        OVERLAP: 409,
        PRESET_INVALID: 400,
      };
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: statusMap[error.code] ?? 400 }
      );
    }
```

Přidat import `isAppError` pokud chybí:
```typescript
import { isAppError } from "@/lib/errors";
```

- [ ] **Step 4: Ověřit build**

Spustit: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/blocks/route.ts
git commit -m "feat: overlap check for new block creation"
```

---

### Task 6: Sync `editingBlock` v `handleBlockUpdate`

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:1324`

- [ ] **Step 1: Přidat setEditingBlock do handleBlockUpdate**

V `PlannerPage.tsx`, funkce `handleBlockUpdate`, hned za řádek 1324 (`setSelectedBlock(...)`) přidat:

```typescript
    setEditingBlock((eb) => eb?.id === updated.id ? updated : eb);
```

Výsledek (řádky 1323-1326):
```typescript
    setBlocks((arr) => arr.map((b) => (b.id === updated.id ? updated : b)));
    setSelectedBlock((sel) => (sel?.id === updated.id ? updated : sel));
    setEditingBlock((eb) => eb?.id === updated.id ? updated : eb);
    // Lokální propagace sdílených polí do split sourozenců
```

- [ ] **Step 2: Ověřit build**

Spustit: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "fix: sync editingBlock when block is pushed by autoResolveOverlap"
```

---

### Task 7: Oprava `handleSaveAll` — per-block endTime

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:1660-1685`

- [ ] **Step 1: Přepsat `handleSaveAll`**

Nahradit celou funkci `handleSaveAll` (řádky 1660-1685):

```typescript
  async function handleSaveAll(ids: number[], payload: Record<string, unknown>) {
    try {
      // Pokud payload obsahuje endTime, spočítat durationMs a aplikovat per-block
      const hasEndTime = payload.endTime !== undefined;
      let durationMs = 0;
      if (hasEndTime && editingBlock) {
        durationMs = new Date(payload.endTime as string).getTime() - new Date(editingBlock.startTime).getTime();
      }

      const results: Block[] = [];
      for (const id of ids) {
        let blockPayload = payload;
        if (hasEndTime) {
          const currentBlock = blocksRef.current.find(b => b.id === id);
          if (currentBlock) {
            const blockEndTime = new Date(new Date(currentBlock.startTime).getTime() + durationMs).toISOString();
            blockPayload = { ...payload, endTime: blockEndTime };
          }
        }
        const res = await fetch(`/api/blocks/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(blockPayload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(err.error ?? `Chyba při ukládání bloku ${id}`);
        }
        const updated: Block = await res.json();
        results.push(updated);
        // Trigger autoResolveOverlap pokud se čas změnil
        handleBlockUpdate(updated);
      }

      // Aktualizovat editingBlock pokud je v sérii
      if (editingBlock && ids.includes(editingBlock.id)) {
        const updatedEditing = results.find((r) => r.id === editingBlock.id);
        if (updatedEditing) setEditingBlock(updatedEditing);
      }
    } catch (error) {
      console.error("Series save failed", error);
      showToast(error instanceof Error ? error.message : "Chyba při ukládání série.", "error");
    }
  }
```

- [ ] **Step 2: Ověřit build**

Spustit: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "fix: handleSaveAll calculates per-block endTime and triggers overlap resolution"
```

---

### Task 8: `autoResolveOverlap` — chain push přes batch endpoint

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:1274-1305` (chain push blok)

- [ ] **Step 1: Přepsat chain push na batch endpoint**

Nahradit blok řádků 1274-1305 (try/catch chain push) za:

```typescript
    try {
      const batchUpdates = chain.map(b => ({
        id: b.id,
        startTime: new Date(new Date(b.startTime).getTime() + effectiveShiftMs).toISOString(),
        endTime: new Date(new Date(b.endTime).getTime() + effectiveShiftMs).toISOString(),
        machine: b.machine,
      }));

      const batchRes = await fetch("/api/blocks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: batchUpdates,
          bypassScheduleValidation: !workingTimeLockRef.current,
        }),
      });

      if (!batchRes.ok) {
        const err = await batchRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Chain push batch HTTP ${batchRes.status}`);
      }

      const results: Block[] = await batchRes.json();
      setBlocks(prev => prev.map(b => results.find(r => r.id === b.id) ?? b));

      // Pokud snap přeskočil víkend/noc a zvětšil posun, chain mohl přistát na bloku,
      // který nebyl v původním chainu — rekurzivně vyřešit překryv posledního bloku chainu
      if (effectiveShiftMs > shiftMs) {
        const allExcluded = new Set([...Array.from(excludeIds), ...chain.map(b => b.id)]);
        const lastResult = results[results.length - 1];
        if (lastResult) void autoResolveOverlap(lastResult, allExcluded);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Nepodařilo se automaticky posunout navazující bloky.";
      showToast(msg, "error");
      await revertMovedBlock();
      return "failed";
    }
```

- [ ] **Step 2: Ověřit build**

Spustit: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "refactor: autoResolveOverlap uses batch endpoint for chain push"
```

---

### Task 9: Klientský handling 409 — drag & drop + resize

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:2022-2033` (move handler), `~2041-2052` (resize handler)

- [ ] **Step 1: Upravit move handler pro 409**

V `TimelineGrid.tsx`, move handler (~řádek 2022-2033), nahradit:

```typescript
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string };
            callbacksRef.current.onError?.(err.error ?? "Blok se nepodařilo přesunout.");
            return;
          }
```

za:

```typescript
          if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: string; code?: string };
            if (err.code === "OVERLAP") {
              // Server odmítl kvůli overlap — zavolat onBlockUpdate s intended pozicí,
              // handleBlockUpdate → autoResolveOverlap vyřeší chain a pošle batch
              const intended: Block = {
                ...((await (await fetch(`/api/blocks/${ds.blockId}`)).json()) as Block),
                startTime: newStart.toISOString(),
                endTime: newEnd.toISOString(),
                machine: newMachine,
              };
              // Nejdřív posunout chain (autoResolveOverlap přes batch), pak uložit hlavní blok
              callbacksRef.current.onOverlapRetry?.(ds.blockId, newStart.toISOString(), newEnd.toISOString(), newMachine);
            } else {
              callbacksRef.current.onError?.(err.error ?? "Blok se nepodařilo přesunout.");
            }
            return;
          }
```

**Pozn.:** Toto je složitější přístup. Jednodušší a spolehlivější alternativa — přidat do `onBlockUpdate` callback logiku, která při 409:

Vlastně nejjednodušší řešení: **v move handleru při 409 prostě zobrazit toast a neukládat**. autoResolveOverlap stejně běží po každém úspěšném uložení. Pokud PUT vrátí 409, znamená to, že klient se pokusil uložit blok na obsazené místo BEZ předchozího resolve. To by se nemělo stávat, protože drag & drop flow vždy uloží blok první (a ten by neměl 409, protože se přesunul na JINOU pozici). Overlap nastane až zpětně.

**Reálně**: 409 z PUT při drag & drop nastane jen pokud blok přetáhneme přímo NA jiný blok. V tom případě `autoResolveOverlap` by ho normálně posunul. S novým server-side guardem ale PUT selže dřív.

**Řešení:** Pro drag & drop přidat `bypassOverlapCheck` flag, který se pošle jen z drag/resize flowu. Server ho respektuje jen když přichází z trusted kontextu (nelze jednoduše ověřit na serveru, ale klientský intent je jasný).

**JEDNODUŠŠÍ ŘEŠENÍ:** Drag & drop a resize budou posílat celý move+chain jako batch. TimelineGrid lokálně detekuje overlap a sestaví chain PŘED odesláním.

**NEJJEDNODUŠŠÍ ŘEŠENÍ (zvoleno):** Zachovat stávající 409 toast. Díky opravě editingBlock (Task 6) a autoResolveOverlap chain push přes batch (Task 8) by se 409 při drag & drop neměl nikdy vyskytnout — autoResolveOverlap po uložení zajistí, že pushed bloky jdou přes batch (který validuje finální stav). Pokud přece jen nastane, toast je dostatečný fallback.

Takže: **žádná změna v TimelineGrid move/resize handleru**. Stávající error handling (`onError`) je dostatečný. 409 je edge case, který by neměl nastat díky autoResolveOverlap.

- [ ] **Step 1 (revidovaný): Přidat 409 handling do BlockEdit.doSave**

V `src/components/BlockEdit.tsx`, funkce `doSave` (~řádek 414), nahradit:

```typescript
      if (!res.ok) throw new Error("Chyba serveru");
```

za:

```typescript
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; code?: string };
        if (err.code === "OVERLAP") {
          throw new Error(err.error ?? "Blok koliduje s jiným blokem na stejném stroji.");
        }
        throw new Error(err.error ?? "Chyba serveru");
      }
```

- [ ] **Step 2: Ověřit build**

Spustit: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/BlockEdit.tsx
git commit -m "feat: show specific error message on 409 overlap in BlockEdit"
```

---

### Task 10: Spustit všechny testy + finální build

**Files:** žádné nové změny

- [ ] **Step 1: Spustit unit testy**

```bash
node --test --import tsx src/lib/overlapCheck.test.ts
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Očekávaný výstup: všechny testy PASS (4 nové + 24 existujících)

- [ ] **Step 2: Finální build**

```bash
npm run build
```

Očekávaný výstup: build projde bez chyb

- [ ] **Step 3: Spustit lint**

```bash
npm run lint
```

Očekávaný výstup: žádné nové chyby (warningy OK)

- [ ] **Step 4: Commit pokud jsou nezcommitnuté změny**

```bash
git status
```
