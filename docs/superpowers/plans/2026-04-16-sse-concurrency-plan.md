# SSE Live Sync + Optimistic Locking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat real-time synchronizaci mezi uživateli (SSE) a ochranu proti tichému přepisování dat (optimistic locking) do výrobního plánovače.

**Architecture:** In-memory EventEmitter broadcastuje mutační události do SSE streamu. Klienti přijímají změny přes nativní EventSource API a mergují je do lokálního stavu. Optimistic locking přes `updatedAt` check zabraňuje lost updates na klíčových endpointech.

**Tech Stack:** Next.js 16 + Prisma 5 + MySQL + Node.js EventEmitter + nativní EventSource API

**Design spec:** `docs/superpowers/specs/2026-04-16-sse-concurrency-design.md`

---

## File Map

### Nové soubory

| Soubor | Odpovědnost |
|--------|-------------|
| `src/lib/eventBus.ts` | In-memory EventEmitter singleton + helper `emitBlockEvent()` |
| `src/app/api/events/route.ts` | SSE endpoint — auth, streaming, role filtering, heartbeat, connection tracking |
| `src/hooks/useSSE.ts` | Klientský React hook — EventSource wrapper, reconnect, heartbeat tracking |

### Modifikované soubory

| Soubor | Změna |
|--------|-------|
| `prisma/schema.prisma` | `@updatedAt` na Block a Reservation |
| `src/app/api/blocks/[id]/route.ts` | Optimistic locking v PUT + emit |
| `src/app/api/blocks/batch/route.ts` | TOCTOU fix + optimistic locking + emit |
| `src/app/api/blocks/route.ts` | Emit v POST |
| `src/app/api/blocks/[id]/complete/route.ts` | Emit |
| `src/app/api/blocks/[id]/expedition/route.ts` | Emit |
| `src/app/api/reservations/[id]/route.ts` | Optimistic locking v PATCH + emit |
| `src/app/api/machine-shifts/route.ts` | Emit |
| `src/app/api/machine-exceptions/route.ts` | Emit |
| `src/app/_components/PlannerPage.tsx` | useSSE hook, rozšířený merge, conflict toast, polling fallback, offline banner |
| `src/app/expedice/_components/ExpedicePage.tsx` | useSSE hook |
| `src/app/tiskar/_components/TiskarMonitor.tsx` | useSSE hook |
| `src/app/rezervace/_components/RezervacePage.tsx` | useSSE hook |

---

## Task 0: Spike — SSE na Next.js 16

**Cíl:** Ověřit, že Next.js 16 route handler s `ReadableStream` drží SSE spojení déle než 5 minut na firemním serveru. Pokud ne, plán se musí přehodnotit.

**Files:**
- Create: `src/app/api/events-test/route.ts` (dočasný, po spike smazat)

- [ ] **Step 1: Vytvořit minimální SSE endpoint**

```typescript
// src/app/api/events-test/route.ts
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Odeslat úvodní komentář
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Heartbeat každých 15s
      const interval = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`)
          );
        } catch {
          clearInterval(interval);
        }
      }, 15_000);

      // Timeout po 10 minutách (pro test)
      setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 600_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 2: Otestovat v prohlížeči**

Otevřít DevTools → Console:
```javascript
const es = new EventSource("/api/events-test");
es.onmessage = (e) => console.log("SSE:", e.data);
es.onerror = (e) => console.log("SSE error:", e);
```

Expected: Každých 15s se v konzoli objeví `SSE: {"time":"..."}`. Spojení přežije 5+ minut.

- [ ] **Step 3: Otestovat na firemním serveru (pokud je přístup)**

Spustit `npm run build && npm start` a opakovat test. Ověřit, že žádný proxy/firewall nezabije spojení.

- [ ] **Step 4: Smazat testovací endpoint**

```bash
rm src/app/api/events-test/route.ts
```

**Gate:** Pokud spojení padá po <60s, hledat Next.js `maxDuration` config nebo alternativu (standalone HTTP handler). Nespouštět další tasky dokud spike neprojde.

---

## Task 1: Prisma migrace — `@updatedAt`

**Cíl:** Zajistit, že `updatedAt` se automaticky aktualizuje při každém UPDATE. Bez toho optimistic locking nefunguje.

**Files:**
- Modify: `prisma/schema.prisma:52` (Block.updatedAt)
- Modify: `prisma/schema.prisma:269` (Reservation.updatedAt)

- [ ] **Step 1: Upravit Block model**

V `prisma/schema.prisma` řádek 52 změnit:
```
// Před:
updatedAt                                   DateTime     @default(now())

// Po:
updatedAt                                   DateTime     @updatedAt
```

- [ ] **Step 2: Upravit Reservation model**

V `prisma/schema.prisma` řádek 269 změnit:
```
// Před:
updatedAt               DateTime                @default(now())

// Po:
updatedAt               DateTime                @updatedAt
```

- [ ] **Step 3: Vygenerovat a aplikovat migraci**

```bash
npx prisma migrate dev --name add-updatedAt-auto
```

Expected: Migrace proběhne úspěšně. Žádná ztráta dat — Prisma přidá trigger pro automatickou aktualizaci `updatedAt`.

- [ ] **Step 4: Ověřit, že build projde**

```bash
npm run build
```

Expected: Build OK, žádné TypeScript chyby.

- [ ] **Step 5: Ověřit, že updatedAt se aktualizuje**

Spustit dev server (`npm run dev`), otevřít aplikaci, editovat libovolný blok. Pak v MySQL:
```bash
mysql -u root -pmysql IGvyroba -e "SELECT id, updatedAt FROM Block ORDER BY updatedAt DESC LIMIT 3;"
```

Expected: `updatedAt` editovaného bloku je novější než ostatní.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add @updatedAt to Block and Reservation for optimistic locking"
```

---

## Task 2: Event Bus singleton

**Cíl:** Vytvořit in-memory EventEmitter, který bude sdílet události mezi API route handlers a SSE endpointem.

**Files:**
- Create: `src/lib/eventBus.ts`

- [ ] **Step 1: Vytvořit eventBus.ts**

```typescript
// src/lib/eventBus.ts
import { EventEmitter } from "events";
import { logger } from "@/lib/logger";

const MAX_LISTENERS = 50;

const globalForEventBus = globalThis as unknown as {
  eventBus: EventEmitter | undefined;
};

export const eventBus =
  globalForEventBus.eventBus ?? new EventEmitter();

eventBus.setMaxListeners(MAX_LISTENERS);

if (process.env.NODE_ENV !== "production") {
  globalForEventBus.eventBus = eventBus;
}

// ── Typy SSE událostí ──────────────────────────────────────────────────────

export type SSEEventType =
  | "block:created"
  | "block:updated"
  | "block:deleted"
  | "block:batch-updated"
  | "block:print-completed"
  | "block:expedition-changed"
  | "reservation:updated"
  | "schedule:changed";

export type SSEPayload = {
  sourceUserId: number;
  [key: string]: unknown;
};

// ── Helper pro emitování z API routes ──────────────────────────────────────

export function emitSSE(event: SSEEventType, payload: SSEPayload) {
  eventBus.emit(event, payload);
  if (process.env.NODE_ENV !== "production") {
    logger.info(`[sse] emit ${event}`, { sourceUserId: payload.sourceUserId });
  }
}
```

- [ ] **Step 2: Ověřit, že build projde**

```bash
npm run build
```

Expected: Build OK.

- [ ] **Step 3: Commit**

```bash
git add src/lib/eventBus.ts
git commit -m "feat: add in-memory event bus singleton for SSE broadcasts"
```

---

## Task 3: SSE Endpoint

**Cíl:** Vytvořit `GET /api/events` endpoint, který drží otevřené SSE spojení, broadcastuje události a filtruje podle role.

**Files:**
- Create: `src/app/api/events/route.ts`

- [ ] **Step 1: Vytvořit SSE route handler**

```typescript
// src/app/api/events/route.ts
import { getSession } from "@/lib/auth";
import { eventBus, type SSEEventType, type SSEPayload } from "@/lib/eventBus";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ── Connection tracking ────────────────────────────────────────────────────
const connections = new Map<number, Set<ReadableStreamDefaultController>>();
const MAX_PER_USER = 5;
const MAX_TOTAL = 100;
const HEARTBEAT_MS = 15_000;

function getTotalConnections(): number {
  let total = 0;
  for (const set of connections.values()) total += set.size;
  return total;
}

function addConnection(userId: number, controller: ReadableStreamDefaultController): boolean {
  if (getTotalConnections() >= MAX_TOTAL) return false;
  let userSet = connections.get(userId);
  if (!userSet) {
    userSet = new Set();
    connections.set(userId, userSet);
  }
  if (userSet.size >= MAX_PER_USER) return false;
  userSet.add(controller);
  return true;
}

function removeConnection(userId: number, controller: ReadableStreamDefaultController) {
  const userSet = connections.get(userId);
  if (userSet) {
    userSet.delete(controller);
    if (userSet.size === 0) connections.delete(userId);
  }
}

// ── Event types each role can receive ──────────────────────────────────────
const BLOCK_EVENTS: SSEEventType[] = [
  "block:created", "block:updated", "block:deleted",
  "block:batch-updated", "block:print-completed", "block:expedition-changed",
];

function shouldSendEvent(
  event: SSEEventType,
  payload: SSEPayload,
  session: { id: number; role: string; assignedMachine?: string | null }
): boolean {
  // Nikdy neposílat autorovi změny
  if (payload.sourceUserId === session.id) return false;

  const { role, assignedMachine } = session;

  if (role === "TISKAR") {
    // Jen block eventy pro svůj stroj
    if (!BLOCK_EVENTS.includes(event)) return false;
    const machine = (payload.machine as string) ?? (payload.block as { machine?: string })?.machine;
    return machine === assignedMachine;
  }

  if (role === "OBCHODNIK") {
    // Jen reservation eventy
    return event === "reservation:updated";
  }

  if (role === "VIEWER") {
    // Block eventy (read-only view) + schedule
    return BLOCK_EVENTS.includes(event) || event === "schedule:changed";
  }

  // ADMIN, PLANOVAT, DTP, MTZ — všechno
  return true;
}

// ── SSE formatter ──────────────────────────────────────────────────────────
const encoder = new TextEncoder();

function formatSSE(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── GET handler ────────────────────────────────────────────────────────────
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new ReadableStream({
    start(controller) {
      // Connection limit
      if (!addConnection(session.id, controller)) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Too many connections" })}\n\n`));
        controller.close();
        return;
      }

      logger.info("[sse] connected", { userId: session.id, role: session.role, total: getTotalConnections() });

      // Úvodní komentář
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Heartbeat
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);

      // Event listener
      const ALL_EVENTS: SSEEventType[] = [
        "block:created", "block:updated", "block:deleted",
        "block:batch-updated", "block:print-completed", "block:expedition-changed",
        "reservation:updated", "schedule:changed",
      ];

      function onEvent(event: SSEEventType, payload: SSEPayload) {
        if (!shouldSendEvent(event, payload, session)) return;
        try {
          controller.enqueue(formatSSE(event, payload));
        } catch {
          cleanup();
        }
      }

      // Zaregistrovat listenery
      const listeners = ALL_EVENTS.map((evt) => {
        const handler = (payload: SSEPayload) => onEvent(evt, payload);
        eventBus.on(evt, handler);
        return { evt, handler };
      });

      // Cleanup funkce
      function cleanup() {
        clearInterval(heartbeatInterval);
        for (const { evt, handler } of listeners) {
          eventBus.off(evt, handler);
        }
        removeConnection(session.id, controller);
        logger.info("[sse] disconnected", { userId: session.id, total: getTotalConnections() });
      }

      // Detekce odpojení klienta — ReadableStream cancel
      // (Next.js zavolá cancel() když klient zavře spojení)
    },
    cancel() {
      // cancel se volá když klient odpojí — ale nemáme přístup k cleanup z start()
      // Cleanup proběhne přes try-catch v heartbeat/event handler
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

- [ ] **Step 2: Otestovat v prohlížeči**

Spustit dev server, otevřít DevTools → Console:
```javascript
const es = new EventSource("/api/events");
es.onopen = () => console.log("SSE connected");
es.onerror = (e) => console.log("SSE error", e);
```

Expected: `SSE connected` v konzoli. Žádné chyby. V Network tabu viditelný pending request s `text/event-stream`.

- [ ] **Step 3: Ověřit connection limit**

Otevřít 6 tabů se stejným uživatelem. Šestý by měl dostat `event: error` s "Too many connections".

- [ ] **Step 4: Commit**

```bash
git add src/app/api/events/route.ts
git commit -m "feat: add SSE endpoint with auth, role filtering, heartbeat, and connection limits"
```

---

## Task 4: Optimistic Locking — PUT /api/blocks/[id]

**Cíl:** Přidat `expectedUpdatedAt` check do hlavního block update endpointu. Pokud jiný uživatel mezitím blok změnil, vrátit 409.

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts:132-135`

- [ ] **Step 1: Přidat optimistic locking do transakce**

V `src/app/api/blocks/[id]/route.ts`, uvnitř `$transaction` callbacku, hned po `const oldBlock = await tx.block.findUnique(...)` (řádek 133-135), přidat:

```typescript
      // Optimistic locking — ověřit, že blok se nezměnil od načtení klientem
      const expectedUpdatedAt = (body as Record<string, unknown>).expectedUpdatedAt as string | undefined;
      if (expectedUpdatedAt) {
        const expected = new Date(expectedUpdatedAt);
        if (isNaN(expected.getTime())) {
          throw new AppError("VALIDATION_ERROR", "expectedUpdatedAt není platný timestamp.");
        }
        if (oldBlock.updatedAt.getTime() !== expected.getTime()) {
          throw new AppError("CONFLICT", "Blok byl mezitím změněn jiným uživatelem.");
        }
      }
```

- [ ] **Step 2: Přidat CONFLICT do statusMap v catch bloku**

V `src/app/api/blocks/[id]/route.ts`, v catch bloku (řádek ~355), ověřit, že `statusMap` obsahuje `CONFLICT: 409`. Aktuálně:

```typescript
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        PRESET_INVALID: 400,
        SCHEDULE_VIOLATION: 422,
        CONFLICT: 409,
      };
```

`CONFLICT: 409` už je přítomný — žádná změna potřeba. Ověřit vizuálně.

- [ ] **Step 3: Smazat `expectedUpdatedAt` z `allowed` objektu**

V sekci kde se mažou nechtěná pole z `allowed` (řádek ~93-97), přidat:

```typescript
    delete (allowed as Record<string, unknown>).expectedUpdatedAt;
```

To zajistí, že `expectedUpdatedAt` neprojde do `prisma.block.update()`.

- [ ] **Step 4: Otestovat ručně**

1. Otevřít 2 prohlížeče, přihlásit se jako ADMIN
2. V obou otevřít detail stejného bloku
3. V prvním editovat a uložit → OK
4. Ve druhém editovat a uložit → mělo by vrátit 409 (jakmile klient posílá `expectedUpdatedAt`)

Poznámka: Klient zatím `expectedUpdatedAt` neposílá — to přijde v Task 8. Teď ověřit, že endpoint BEZ `expectedUpdatedAt` funguje normálně (zpětná kompatibilita).

- [ ] **Step 5: Ověřit build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/blocks/\[id\]/route.ts
git commit -m "feat: add optimistic locking to PUT /api/blocks/[id]"
```

---

## Task 5: Optimistic Locking — POST /api/blocks/batch (+ TOCTOU fix)

**Cíl:** Přesunout fetch existujících bloků dovnitř transakce a přidat per-block `updatedAt` check.

**Files:**
- Modify: `src/app/api/blocks/batch/route.ts`

- [ ] **Step 1: Rozšířit BatchUpdate typ o expectedUpdatedAt**

Na začátku souboru (řádek ~8) změnit:

```typescript
type BatchUpdate = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  expectedUpdatedAt?: string;
};
```

- [ ] **Step 2: Přesunout fetch + validaci + update do jedné transakce**

Nahradit celý blok od řádku 46 (`const existingBlocks = ...`) až po konec `try` bloku (řádek ~129) tímto:

```typescript
  try {
    const results = await prisma.$transaction(async (tx) => {
      // Fetch UVNITŘ transakce — eliminuje TOCTOU gap
      const existingBlocks = await tx.block.findMany({
        where: { id: { in: updates.map((u) => u.id) } },
        select: {
          id: true, type: true, machine: true,
          startTime: true, endTime: true,
          orderNumber: true, updatedAt: true,
        },
      });

      // Optimistic locking — per-block check
      const staleBlockIds: number[] = [];
      for (const u of updates) {
        if (!u.expectedUpdatedAt) continue;
        const existing = existingBlocks.find((b) => b.id === u.id);
        if (!existing) continue;
        const expected = new Date(u.expectedUpdatedAt);
        if (!isNaN(expected.getTime()) && existing.updatedAt.getTime() !== expected.getTime()) {
          staleBlockIds.push(u.id);
        }
      }
      if (staleBlockIds.length > 0) {
        throw new AppError(
          "CONFLICT",
          `Bloky [${staleBlockIds.join(", ")}] byly mezitím změněny.`
        );
      }

      // Validace schedule — jen pro ZAKAZKA
      const zakazkaUpdates = updates.filter((u) => {
        const existing = existingBlocks.find((b) => b.id === u.id);
        return existing?.type === "ZAKAZKA";
      });
      for (const u of zakazkaUpdates) {
        const scheduleError = await validateBlockScheduleFromDb(
          u.machine, new Date(u.startTime), new Date(u.endTime), "ZAKAZKA", bypassScheduleValidation
        );
        if (scheduleError) {
          throw new AppError("SCHEDULE_VIOLATION", scheduleError.error);
        }
      }

      // Update
      const updated = await Promise.all(
        updates.map((u) =>
          tx.block.update({
            where: { id: u.id },
            data: {
              startTime: new Date(u.startTime),
              endTime: new Date(u.endTime),
              machine: u.machine,
            },
          })
        )
      );

      // Audit
      const auditRows = updates.map((u) => {
        const old = existingBlocks.find((b) => b.id === u.id);
        const updatedBlock = updated.find((b) => b.id === u.id);
        return {
          blockId: u.id,
          orderNumber: updatedBlock?.orderNumber ?? old?.orderNumber ?? null,
          userId: session.id,
          username: session.username,
          action: "UPDATE",
          field: "startTime/endTime/machine",
          oldValue: undefined as string | undefined,
          newValue: `${u.machine} ${u.startTime}–${u.endTime}`,
        };
      });
      await tx.auditLog.createMany({ data: auditRows });

      return updated;
    });

    return NextResponse.json(results.map(serializeBlock));
  } catch (error: unknown) {
    if (isAppError(error)) {
      const statusMap: Record<string, number> = {
        CONFLICT: 409,
        SCHEDULE_VIOLATION: 422,
      };
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

- [ ] **Step 3: Přidat import AppError**

Na začátek souboru přidat:
```typescript
import { AppError, isAppError } from "@/lib/errors";
```

- [ ] **Step 4: Smazat starý kód mimo transakci**

Ověřit, že staré `const existingBlocks = await prisma.block.findMany(...)` (řádek 46-56) a stará validace (řádky 59-71) jsou smazány — nahrazeny kódem uvnitř transakce.

- [ ] **Step 5: Ověřit build + testy**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/blocks/batch/route.ts
git commit -m "feat: fix TOCTOU in batch endpoint, add optimistic locking per-block"
```

---

## Task 6: Optimistic Locking — PATCH /api/reservations/[id]

**Cíl:** Přidat optimistic locking do reservation state transitions.

**Files:**
- Modify: `src/app/api/reservations/[id]/route.ts:80`

- [ ] **Step 1: Přidat optimistic locking po načtení rezervace**

V `src/app/api/reservations/[id]/route.ts`, hned po řádku 81 (`if (!reservation) return ...`), přidat:

```typescript
    // Optimistic locking
    const expectedUpdatedAt = body.expectedUpdatedAt as string | undefined;
    if (expectedUpdatedAt) {
      const expected = new Date(expectedUpdatedAt);
      if (!isNaN(expected.getTime()) && reservation.updatedAt.getTime() !== expected.getTime()) {
        return NextResponse.json(
          { error: "Rezervace byla mezitím změněna jiným uživatelem.", code: "CONFLICT" },
          { status: 409 }
        );
      }
    }
```

- [ ] **Step 2: Ověřit build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/reservations/\[id\]/route.ts
git commit -m "feat: add optimistic locking to PATCH /api/reservations/[id]"
```

---

## Task 7: Emitování SSE událostí z API routes

**Cíl:** Přidat `emitSSE()` volání do všech mutačních endpointů — VŽDY po úspěšném `$transaction`, nikdy uvnitř.

**Files:**
- Modify: `src/app/api/blocks/route.ts` (POST)
- Modify: `src/app/api/blocks/[id]/route.ts` (PUT, DELETE)
- Modify: `src/app/api/blocks/batch/route.ts` (POST)
- Modify: `src/app/api/blocks/[id]/complete/route.ts` (POST)
- Modify: `src/app/api/blocks/[id]/expedition/route.ts` (POST)
- Modify: `src/app/api/reservations/[id]/route.ts` (PATCH)
- Modify: `src/app/api/machine-shifts/route.ts` (PUT, POST, DELETE)
- Modify: `src/app/api/machine-exceptions/route.ts` (POST, DELETE)

- [ ] **Step 1: POST /api/blocks — emit block:created**

V `src/app/api/blocks/route.ts`, před `return NextResponse.json(serializeBlock(block), { status: 201 })` (řádek 203), přidat:

```typescript
    import { emitSSE } from "@/lib/eventBus";
```

(import na začátek souboru) a před return:

```typescript
    emitSSE("block:created", { block: serializeBlock(block), machine: block.machine, sourceUserId: session.id });
```

- [ ] **Step 2: PUT /api/blocks/[id] — emit block:updated**

V `src/app/api/blocks/[id]/route.ts`, před `return NextResponse.json(serializeBlock(block))` (řádek 352), přidat:

```typescript
    emitSSE("block:updated", { block: serializeBlock(block), machine: block.machine, sourceUserId: session.id });
```

A import `emitSSE` na začátek souboru.

- [ ] **Step 3: DELETE /api/blocks/[id] — emit block:deleted**

V `src/app/api/blocks/[id]/route.ts`, po `$transaction` v DELETE handleru (před `return NextResponse.json({ success: true })`), přidat:

```typescript
    emitSSE("block:deleted", { blockId: id, machine: blockToDelete?.machine ?? "", sourceUserId: session.id });
```

Poznámka: `blockToDelete` je přístupný z transakce — ale `machine` v `select` chybí. Přidat `machine: true` do `select` v DELETE handleru (řádek ~392):

```typescript
        select: { orderNumber: true, reservationId: true, machine: true },
```

- [ ] **Step 4: POST /api/blocks/batch — emit block:batch-updated**

V `src/app/api/blocks/batch/route.ts`, před `return NextResponse.json(results.map(serializeBlock))`, přidat:

```typescript
    emitSSE("block:batch-updated", {
      blocks: results.map(serializeBlock),
      sourceUserId: session.id,
    });
```

A import `emitSSE` na začátek souboru.

- [ ] **Step 5: POST /api/blocks/[id]/complete — emit block:print-completed**

V `src/app/api/blocks/[id]/complete/route.ts`, před `return NextResponse.json(updatedBlock)` (řádek 72), přidat:

```typescript
    import { emitSSE } from "@/lib/eventBus";
    import { serializeBlock } from "@/lib/blockSerialization";
```

(importy na začátek) a před return:

```typescript
    emitSSE("block:print-completed", { block: serializeBlock(updatedBlock), machine: block.machine, sourceUserId: session.id });
```

- [ ] **Step 6: POST /api/blocks/[id]/expedition — emit block:expedition-changed**

V `src/app/api/blocks/[id]/expedition/route.ts`, před každý `return NextResponse.json(...)` po úspěšné mutaci, přidat odpovídající emit. Konkrétně najít všechny success return statementy a přidat:

```typescript
    emitSSE("block:expedition-changed", { block: serializeBlock(result), machine: result.machine, sourceUserId: session.id });
```

A import `emitSSE` na začátek souboru.

- [ ] **Step 7: PATCH /api/reservations/[id] — emit reservation:updated**

V `src/app/api/reservations/[id]/route.ts`, před každý success `return NextResponse.json(...)` v PATCH handleru (accept, reject, prepare, confirm, counter-propose, accept-counter, reject-counter), přidat:

```typescript
    emitSSE("reservation:updated", { reservation: { id, status: updated.status }, sourceUserId: session.id });
```

A import `emitSSE` na začátek souboru.

- [ ] **Step 8: Machine shifts + exceptions — emit schedule:changed**

V `src/app/api/machine-shifts/route.ts` — před každý success return v PUT a POST, přidat:
```typescript
    emitSSE("schedule:changed", { machine: body.machine ?? machine, sourceUserId: session.id });
```

V `src/app/api/machine-shifts/[id]/route.ts` — před success return v PUT a DELETE.

V `src/app/api/machine-exceptions/route.ts` — před success return v POST, přidat:
```typescript
    emitSSE("schedule:changed", { machine: body.machine, sourceUserId: session.id });
```

V `src/app/api/machine-exceptions/[id]/route.ts` — před success return v DELETE.

A import `emitSSE` na začátek každého souboru.

- [ ] **Step 9: Ověřit build**

```bash
npm run build
```

- [ ] **Step 10: Otestovat end-to-end**

1. Otevřít 2 prohlížeče
2. V obou otevřít DevTools Network tab → filtr na `events`
3. V prvním přesunout blok
4. V druhém by se měl v SSE streamu objevit event `block:updated`

- [ ] **Step 11: Commit**

```bash
git add src/app/api/
git commit -m "feat: emit SSE events from all mutation endpoints"
```

---

## Task 8: Klientský useSSE hook

**Cíl:** Vytvořit React hook, který se připojí k SSE endpointu, přijímá události a trackuje stav spojení.

**Files:**
- Create: `src/hooks/useSSE.ts`

- [ ] **Step 1: Vytvořit useSSE.ts**

```typescript
// src/hooks/useSSE.ts
"use client";

import { useEffect, useRef, useCallback } from "react";

export type SSEEventType =
  | "block:created"
  | "block:updated"
  | "block:deleted"
  | "block:batch-updated"
  | "block:print-completed"
  | "block:expedition-changed"
  | "reservation:updated"
  | "schedule:changed";

export type SSEMessage = {
  type: SSEEventType;
  payload: Record<string, unknown>;
};

type UseSSEOptions = {
  onEvent: (message: SSEMessage) => void;
  onReconnect?: () => void;
  enabled?: boolean;
};

export function useSSE({ onEvent, onReconnect, enabled = true }: UseSSEOptions) {
  const lastHeartbeatRef = useRef<number>(Date.now());
  const onEventRef = useRef(onEvent);
  const onReconnectRef = useRef(onReconnect);
  onEventRef.current = onEvent;
  onReconnectRef.current = onReconnect;

  const isConnectedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource("/api/events");

    const EVENT_TYPES: SSEEventType[] = [
      "block:created", "block:updated", "block:deleted",
      "block:batch-updated", "block:print-completed", "block:expedition-changed",
      "reservation:updated", "schedule:changed",
    ];

    for (const eventType of EVENT_TYPES) {
      es.addEventListener(eventType, (e: MessageEvent) => {
        lastHeartbeatRef.current = Date.now();
        try {
          const payload = JSON.parse(e.data);
          onEventRef.current({ type: eventType, payload });
        } catch {
          // Nevalidní JSON — ignorovat
        }
      });
    }

    es.addEventListener("session-expired", () => {
      es.close();
      window.location.href = "/";
    });

    es.onopen = () => {
      lastHeartbeatRef.current = Date.now();
      // Pokud to je reconnect (ne první připojení), zavolat onReconnect
      if (isConnectedRef.current) {
        onReconnectRef.current?.();
      }
      isConnectedRef.current = true;
    };

    es.onerror = () => {
      // EventSource se pokusí o auto-reconnect
      // Nemusíme nic dělat — onopen se zavolá po reconnectu
    };

    return () => {
      es.close();
      isConnectedRef.current = false;
    };
  }, [enabled]);

  const getSecondsSinceLastHeartbeat = useCallback(() => {
    return Math.floor((Date.now() - lastHeartbeatRef.current) / 1000);
  }, []);

  return { getSecondsSinceLastHeartbeat };
}
```

- [ ] **Step 2: Ověřit build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useSSE.ts
git commit -m "feat: add useSSE React hook for EventSource with reconnect and heartbeat tracking"
```

---

## Task 9: Napojení SSE na PlannerPage — merge logika + conflict UI

**Cíl:** Napojit `useSSE` na PlannerPage, rozšířit merge na všechna pole, přidat ochranu editovaných bloků, conflict toast a offline banner. Prodloužit polling na 5 minut jako fallback.

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 1: Přidat import useSSE**

Na začátek `PlannerPage.tsx` (k ostatním importům) přidat:

```typescript
import { useSSE, type SSEMessage } from "@/hooks/useSSE";
```

- [ ] **Step 2: Přidat stav pro editingBlockIds a offline**

K ostatním `useState` deklaracím (kolem řádku 600) přidat:

```typescript
  const editingBlockIdsRef = useRef<Set<number>>(new Set());
  const dragInProgressRef = useRef(false);
  const [sseOffline, setSseOffline] = useState(false);
```

- [ ] **Step 3: Přidat SSE event handler**

Před `useEffect` s pollingem (řádek ~856) přidat:

```typescript
  // ── SSE real-time sync ─────────────────────────────────────────────────
  const handleSSEEvent = useCallback((msg: SSEMessage) => {
    const { type, payload } = msg;

    if (type === "block:updated" || type === "block:print-completed" || type === "block:expedition-changed") {
      const serverBlock = payload.block as Block;
      if (!serverBlock?.id) return;

      // Ochrana editovaných / dragovaných bloků
      if (editingBlockIdsRef.current.has(serverBlock.id) || dragInProgressRef.current) {
        showToast(`Blok ${serverBlock.orderNumber ?? serverBlock.id} byl změněn jiným uživatelem.`, "info");
        return;
      }

      setBlocks((prev) => prev.map((b) => b.id === serverBlock.id ? serverBlock : b));
      setSelectedBlock((sel) => sel?.id === serverBlock.id ? serverBlock : sel);
    }

    if (type === "block:created") {
      const serverBlock = payload.block as Block;
      if (!serverBlock?.id) return;
      setBlocks((prev) => {
        if (prev.some((b) => b.id === serverBlock.id)) return prev;
        return [...prev, serverBlock];
      });
    }

    if (type === "block:deleted") {
      const blockId = payload.blockId as number;
      setBlocks((prev) => prev.filter((b) => b.id !== blockId));
      setSelectedBlock((sel) => sel?.id === blockId ? null : sel);
    }

    if (type === "block:batch-updated") {
      const serverBlocks = payload.blocks as Block[];
      if (!Array.isArray(serverBlocks)) return;
      const serverMap = new Map(serverBlocks.map((b) => [b.id, b]));
      setBlocks((prev) =>
        prev.map((b) => {
          if (editingBlockIdsRef.current.has(b.id) || dragInProgressRef.current) return b;
          return serverMap.get(b.id) ?? b;
        })
      );
    }

    if (type === "schedule:changed") {
      // Refresh šablon a výjimek
      Promise.all([
        fetch("/api/machine-shifts").then((r) => r.ok ? r.json() : null),
        fetch("/api/machine-exceptions").then((r) => r.ok ? r.json() : null),
      ]).then(([shifts, exceptions]) => {
        if (shifts) setMachineWorkHoursTemplates(shifts);
        if (exceptions) setMachineExceptions(exceptions);
      }).catch(() => {});
    }
  }, [showToast]);

  const handleSSEReconnect = useCallback(() => {
    // Po reconnectu: full fetch bloků
    fetch("/api/blocks")
      .then((r) => r.ok ? r.json() : null)
      .then((blocks: Block[] | null) => {
        if (blocks) setBlocks(blocks);
      })
      .catch(() => {});
  }, []);

  const { getSecondsSinceLastHeartbeat } = useSSE({
    onEvent: handleSSEEvent,
    onReconnect: handleSSEReconnect,
  });

  // Offline banner — check heartbeat každých 10s
  useEffect(() => {
    const interval = setInterval(() => {
      const seconds = getSecondsSinceLastHeartbeat();
      setSseOffline(seconds > 60);
    }, 10_000);
    return () => clearInterval(interval);
  }, [getSecondsSinceLastHeartbeat]);
```

- [ ] **Step 4: Prodloužit polling na 5 minut (fallback)**

Řádek 896 změnit z:
```typescript
    const t = setInterval(pollBlocks, 30_000);
```
na:
```typescript
    const t = setInterval(pollBlocks, 300_000); // 5 min fallback — SSE je primární
```

A rozšířit `mergePrintCompleted` na full merge (nahradit celou funkci):

```typescript
        const mergeFromServer = (b: Block): Block => {
          const f = freshById.get(b.id);
          if (!f) return b;
          // Chránit editované a dragované bloky
          if (editingBlockIdsRef.current.has(b.id)) return b;
          // Porovnat updatedAt — pokud server novější, nahradit
          if (f.updatedAt !== b.updatedAt) return f;
          return b;
        };
```

- [ ] **Step 5: Přidat offline banner do JSX**

V renderovací části PlannerPage, hned na začátek hlavního containeru (pod header), přidat:

```tsx
      {sseOffline && (
        <div className="bg-yellow-600 text-white text-center text-sm py-1 px-4">
          Spojení se serverem přerušeno. Data nemusí být aktuální.
        </div>
      )}
```

- [ ] **Step 6: Aktualizovat editingBlockIdsRef**

Najít místa kde se otevírá/zavírá BlockEdit:
- Při otevření editace: `editingBlockIdsRef.current.add(blockId)`
- Při zavření/uložení: `editingBlockIdsRef.current.delete(blockId)`

Konkrétně v `handleOpenEdit` (nebo ekvivalentu) a `handleCloseEdit` / po úspěšném uložení.

- [ ] **Step 7: Posílat expectedUpdatedAt v PUT requestech**

Najít všechna místa kde se volá `fetch(\`/api/blocks/${id}\`, { method: "PUT", ... })` a přidat do body:

```typescript
expectedUpdatedAt: block.updatedAt,
```

Stejně tak v batch requestech — přidat `expectedUpdatedAt` ke každému bloku v `updates` poli.

- [ ] **Step 8: Přidat 409 handling do všech PUT/batch fetch volání**

Po každém `fetch` pro PUT/batch přidat:

```typescript
if (res.status === 409) {
  showToast("Blok byl mezitím změněn jiným uživatelem. Data byla aktualizována.", "info");
  // Refetch celý blok
  const freshRes = await fetch(`/api/blocks/${blockId}`);
  if (freshRes.ok) {
    const freshBlock: Block = await freshRes.json();
    setBlocks((prev) => prev.map((b) => b.id === freshBlock.id ? freshBlock : b));
  }
  return;
}
```

- [ ] **Step 9: Ověřit build**

```bash
npm run build
```

- [ ] **Step 10: End-to-end test**

1. Otevřít 2 prohlížeče jako ADMIN
2. V prvním přesunout blok → druhý vidí změnu okamžitě (SSE)
3. V obou otevřít editaci stejného bloku
4. V prvním uložit → OK
5. Ve druhém uložit → toast "Blok byl mezitím změněn"
6. Zavřít síťové spojení (DevTools → Offline) → banner "Spojení přerušeno"
7. Obnovit → banner zmizí, data se synchronizují

- [ ] **Step 11: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat: integrate SSE into PlannerPage with full merge, conflict handling, and offline banner"
```

---

## Task 10: Napojení SSE na TiskarMonitor

**Files:**
- Modify: `src/app/tiskar/_components/TiskarMonitor.tsx`

- [ ] **Step 1: Přidat useSSE import a hook**

```typescript
import { useSSE, type SSEMessage } from "@/hooks/useSSE";
```

Přidat SSE handler, který aktualizuje bloky pro přiřazený stroj. Prodloužit existující polling na 5 minut.

- [ ] **Step 2: Ověřit build + commit**

```bash
npm run build
git add src/app/tiskar/_components/TiskarMonitor.tsx
git commit -m "feat: integrate SSE into TiskarMonitor"
```

---

## Task 11: Napojení SSE na ExpedicePage

**Files:**
- Modify: `src/app/expedice/_components/ExpedicePage.tsx`

- [ ] **Step 1: Přidat useSSE hook**

Při `block:expedition-changed` nebo `block:updated` zavolat `fetchData()` pro refresh expedition dat.

- [ ] **Step 2: Ověřit build + commit**

```bash
npm run build
git add src/app/expedice/_components/ExpedicePage.tsx
git commit -m "feat: integrate SSE into ExpedicePage"
```

---

## Task 12: Napojení SSE na RezervacePage

**Files:**
- Modify: `src/app/rezervace/_components/RezervacePage.tsx`

- [ ] **Step 1: Přidat useSSE hook**

Při `reservation:updated` zavolat `fetchReservations()` pro refresh seznamu.

- [ ] **Step 2: Ověřit build + commit**

```bash
npm run build
git add src/app/rezervace/_components/RezervacePage.tsx
git commit -m "feat: integrate SSE into RezervacePage"
```

---

## Task 13: Finální end-to-end validace

**Cíl:** Ověřit celý flow se 3+ prohlížeči a různými rolemi.

- [ ] **Step 1: Multi-user test**

| Test | Prohlížeč 1 (ADMIN) | Prohlížeč 2 (PLANOVAT) | Prohlížeč 3 (TISKAR) |
|------|---------------------|----------------------|---------------------|
| Přesun bloku | Přesunout blok | Vidí okamžitou změnu | Vidí změnu (pokud jeho stroj) |
| Editace bloku | Editovat popis | Vidí změnu po uložení | — |
| Conflict | Editovat blok | Editovat stejný blok → 409 | — |
| Smazání bloku | Smazat blok | Blok zmizí okamžitě | Blok zmizí |
| Print confirm | — | — | Potvrdit tisk → ADMIN vidí |
| Batch přesun | Lasso 5 bloků, přesunout | Vidí všechny přesuny | — |
| Offline banner | Zavřít DevTools Offline | Banner "Spojení přerušeno" | — |
| Template změna | Admin změní pracovní dobu | Planner vidí refresh šablon | — |

- [ ] **Step 2: Spustit existující testy**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: 24/24 zelené.

- [ ] **Step 3: Build check**

```bash
npm run build
```

- [ ] **Step 4: Finální commit**

```bash
git add -A
git commit -m "test: verify SSE + optimistic locking end-to-end"
```

---

## Souhrn etap → tasků

| Etapa (ze spec) | Tasky | Popis |
|-----------------|-------|-------|
| Etapa 0: Spike | Task 0 | Ověřit SSE na Next.js 16 |
| Etapa 1: Optimistic Locking | Task 1–6 | Migrace + locking na 3 endpointech |
| Etapa 2: Event Bus + SSE | Task 2–3 | EventEmitter + SSE endpoint |
| Etapa 3: Emit z endpointů | Task 7 | emitSSE() ve všech mutacích |
| Etapa 4: Klient + merge | Task 8–9 | useSSE hook + PlannerPage integrace |
| Etapa 5: Rozšíření | Task 10–13 | TiskarMonitor, Expedice, Rezervace, E2E |
