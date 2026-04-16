# Design Spec: SSE Live Sync + Optimistic Locking

**Datum:** 2026-04-16
**Autor:** Claude Code
**Stav:** Reviewed — 5 subagentů challengovalo, kritické problémy opraveny

---

## 1. Problém

Aplikace nemá real-time synchronizaci mezi uživateli. Při 10+ současných uživatelích:

- **Stale data**: Polling (30s) merguje pouze `printCompleted*` pole. Ostatní změny (pozice bloků, materiál, data status) se ignorují — každý uživatel vidí jiný stav plánu.
- **Silent overwrites**: Žádný endpoint neporovnává `updatedAt`. Dva uživatelé editující stejný blok → last-write-wins bez varování.
- **Multi-step races**: Split operace, batch validation→execute, reservation state transitions — žádná transakční ochrana na client-initiated multi-step flows.

### Zmapované scénáře (13 identifikovaných)

| # | Scénář | Pravděpodobnost | Závažnost |
|---|--------|----------------|-----------|
| A | Dva plánovači přesunou stejný blok | Střední | Silent overwrite |
| B | Plánovač přesouvá + DTP edituje data | Střední-vysoká | Data loss |
| C | Smazání bloku během editace jiným uživatelem | Nízká-střední | Inconsistency |
| D | Překrývající se batch (lasso) operace | Vysoká | Silent overwrite |
| E | Split group propagace race | Střední | Data corruption |
| F | Reservation state transition race | Nízká | UI error |
| G | Template změna během plánování | Nízká-střední | UI desync |
| H | Print confirm + přesun bloku | Střední | Stale view |
| I | Batch validation→execute gap | Střední | Batch failure |
| J | Expedition publishing race | Nízká | Sort inconsistency |
| K | Split sibling edit race | Střední | Unexpected overwrites |
| L | Codebook delete orphan | Nízká | Data corruption |
| M | Admin role change mid-session | Nízká | UI error |

---

## 2. Rozhodnutí: SSE + Optimistic Locking

### Proč SSE a ne WebSocket

- **Jednosměrnost stačí**: Server potřebuje notifikovat klienty o změnách. Klienti posílají mutace přes existující REST API — nepotřebují obousměrný kanál.
- **Nativní podpora**: `EventSource` API v prohlížeči, auto-reconnect, žádná knihovna.
- **HTTP kompatibilita**: Funguje přes proxy, firewall, žádný protocol upgrade.
- **Next.js kompatibilita**: Route handler s `ReadableStream` — žádný custom server.
- **Firemní server**: Jeden server, 10-20 klientů — in-memory event bus stačí, nepotřebujeme Redis.

### Proč Optimistic Locking a ne Pessimistic Locking

- **Pessimistic** (zámky) vyžaduje lock manager, timeout handling, deadlock detection — overkill.
- **Optimistic** (version check) je jednoduchý: přidej `WHERE updatedAt = ?` do UPDATE. Pokud se blok mezitím změnil, UPDATE vrátí 0 affected rows → 409 Conflict → UI dialog.

---

## 3. Architektura

### 3.0 Prisma migrace — `@updatedAt` na Block a Reservation

**KRITICKÉ (nalezeno review):** Aktuální schéma má `updatedAt DateTime @default(now())` bez `@updatedAt` anotace. Prisma toto pole **neaktualizuje automaticky** při UPDATE — zůstává na hodnotě z momentu vytvoření. Celý optimistic locking by bez opravy byl nefunkční.

**Oprava:** Změnit `@default(now())` na `@updatedAt` v modelech Block a Reservation. Jednoduchá migrace, žádná ztráta dat — Prisma začne pole aktualizovat automaticky při každém `update()` / `updateMany()`.

```prisma
// Před:
updatedAt DateTime @default(now())

// Po:
updatedAt DateTime @updatedAt
```

Backfill není nutný — stávající hodnoty jsou validní timestamps. Od momentu migrace se budou aktualizovat správně.

### 3.1 Event Bus (server-side)

Jednoduchý in-memory `EventEmitter` singleton sdílený mezi všemi API route handlers.

```
src/lib/eventBus.ts
```

**Typy událostí:**

| Event | Payload | Kdy se emituje |
|-------|---------|----------------|
| `block:created` | `{ block: SerializedBlock, sourceUserId: number }` | POST /api/blocks |
| `block:updated` | `{ block: SerializedBlock, sourceUserId: number }` | PUT /api/blocks/[id] |
| `block:deleted` | `{ blockId: number, machine: string, sourceUserId: number }` | DELETE /api/blocks/[id] |
| `block:batch-updated` | `{ blocks: SerializedBlock[], sourceUserId: number }` | POST /api/blocks/batch |
| `block:print-completed` | `{ block: SerializedBlock, sourceUserId: number }` | POST /api/blocks/[id]/complete |
| `block:expedition-changed` | `{ block: SerializedBlock, sourceUserId: number }` | POST /api/blocks/[id]/expedition |
| `reservation:updated` | `{ reservation: SerializedReservation, sourceUserId: number }` | PATCH /api/reservations/[id] |
| `schedule:changed` | `{ machine: string, sourceUserId: number }` | PUT/POST/DELETE /api/machine-shifts, /api/machine-exceptions |

**Implementace:**
```typescript
// src/lib/eventBus.ts
import { EventEmitter } from "events";
import { logger } from "@/lib/logger";

const MAX_LISTENERS = 50;
const globalForEventBus = globalThis as unknown as { eventBus: EventEmitter | undefined };
export const eventBus = globalForEventBus.eventBus ?? new EventEmitter();
eventBus.setMaxListeners(MAX_LISTENERS);
if (process.env.NODE_ENV !== "production") globalForEventBus.eventBus = eventBus;

// Helper pro emitování z API routes — zajistí konzistentní payload
export function emitBlockEvent(
  action: "created" | "updated" | "deleted" | "batch-updated" | "print-completed" | "expedition-changed",
  payload: Record<string, unknown>,
  sourceUserId: number
) {
  eventBus.emit(`block:${action}`, { ...payload, sourceUserId });
  logger.info(`[sse] block:${action}`, { sourceUserId });
}
```

Stejný singleton pattern jako `src/lib/prisma.ts` — přežije hot reload v dev.

**Důležité:** `eventBus.emit()` se MUSÍ volat PO úspěšném `$transaction()`, nikdy uvnitř. Pokud by se volal uvnitř a transakce rollbackla, klienti by dostali phantom update.

### 3.2 SSE Endpoint

```
GET /api/events
```

Next.js route handler vracející `ReadableStream` s `text/event-stream` content type.

**Chování:**
1. Ověří session (401 pokud nepřihlášen)
2. Zkontroluje connection limit (max 5 per user, max 100 total) — 429 pokud překročen
3. Otevře `ReadableStream`
4. Naslouchá na `eventBus` — při každém eventu zapíše SSE message do streamu
5. Role-based filtering (server-side):
   - TISKAR: jen eventy pro `session.assignedMachine`
   - OBCHODNIK: jen `reservation:updated` eventy
   - ADMIN/PLANOVAT: všechny eventy
   - DTP/MTZ: block eventy (pro svá pole) + schedule eventy
6. Source filtering: přeskočit eventy kde `sourceUserId === session.id` (autor už má data z response)
7. Heartbeat každých **15s** (`: heartbeat\n\n`) — 30s je příliš blízko proxy timeout hranici
8. Session re-verify na každém heartbeatu (JWT + DB role check) — pokud session neplatná nebo role změněna, zavřít SSE spojení s `event: session-expired`
9. Cleanup listener při disconnectu klienta

**SSE message formát:**
```
event: block:updated
data: {"block":{"id":42,"startTime":"...","endTime":"...","updatedAt":"..."}}\n\n
```

**Response headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
Connection: keep-alive
```

**Connection tracking:**
```typescript
// In-memory map pro connection limits
const connections = new Map<number, Set<ReadableStreamController>>();
const MAX_PER_USER = 5;
const MAX_TOTAL = 100;
```

### 3.3 Klientský Hook

```
src/hooks/useSSE.ts
```

Custom React hook wrapping `EventSource`:

```typescript
function useSSE(onEvent: (event: SSEEvent) => void) {
  const lastHeartbeat = useRef(Date.now());

  useEffect(() => {
    const es = new EventSource("/api/events");

    es.addEventListener("block:updated", (e) => {
      lastHeartbeat.current = Date.now();
      onEvent({ type: "block:updated", payload: JSON.parse(e.data) });
    });
    // ... ostatní event typy

    // Heartbeat tracking
    es.addEventListener("heartbeat", () => {
      lastHeartbeat.current = Date.now();
    });

    // Session expired → redirect na login
    es.addEventListener("session-expired", () => {
      es.close();
      window.location.href = "/login";
    });

    es.onerror = () => {
      // EventSource auto-reconnect je built-in
      // Po reconnectu: jednorázový full fetch pro sync
    };

    return () => es.close();
  }, []);

  return { lastHeartbeat };
}
```

**Reconnect strategie:**
- `EventSource` má nativní auto-reconnect (browser standard)
- Po reconnectu (`es.onopen`) hook provede jednorázový `fetch("/api/blocks")` pro full sync — eliminuje ztracené eventy během výpadku
- Klient trackuje `lastHeartbeat` — pokud >60s bez dat, zobrazí banner "Spojení přerušeno, data nemusí být aktuální"

### 3.4 Merge logika v PlannerPage

Rozšíření stávající `mergePrintCompleted` funkce na full merge:

**Pravidla merge:**
1. Blok v `editingBlockIds` (otevřený BlockEdit modal NEBO dirty formulář) → merge jen read-only pole (printCompleted, expedition), zobrazit toast "Blok {orderNumber} byl mezitím změněn"
2. Blok, který uživatel **právě přetahuje** (drag in progress) → ignorovat server update, po drop se sync
3. Všechny ostatní bloky → nahradit celý blok serverovou verzí (včetně pozice, typů, statusů, `updatedAt`)

**`editingBlockIds: Set<number>`** — nový stav v PlannerPage, naplňovaný při otevření BlockEdit a vyprázdněný při zavření/uložení. Chrání i rozpracované formuláře, ne jen aktivní drag.

### 3.5 Optimistic Locking

**Pattern pro PUT /api/blocks/[id]:**

Klient posílá `expectedUpdatedAt` v request body (hodnotu `updatedAt`, kterou měl při načtení bloku).

Server v transakci:
1. `findUnique` — načte aktuální blok
2. Porovná `body.expectedUpdatedAt` s `oldBlock.updatedAt.toISOString()`
3. Pokud se liší → `409 Conflict` s response `{ error: "Blok byl mezitím změněn.", code: "CONFLICT", currentUpdatedAt: oldBlock.updatedAt.toISOString() }`
4. Pokud se shoduje → provede update normálně

**409 response nevrací celý blok** (security review) — vrací jen `currentUpdatedAt`. Klient refetchne blok přes GET endpoint, který má role-based access control.

**Validace `expectedUpdatedAt`:** parse přes `new Date()`, pokud `isNaN` → 400 Bad Request.

**Které endpointy dostanou optimistic locking:**
- `PUT /api/blocks/[id]` — hlavní editace bloků
- `POST /api/blocks/batch` — batch přesuny (check per-block, 409 vrací seznam stale block IDs)
- `POST /api/blocks/[id]/complete` — print confirmation
- `PATCH /api/reservations/[id]` — status transitions

**Batch specifika:** Pokud je v batchi N bloků a M z nich je stale, 409 vrací `{ error: "...", code: "CONFLICT", staleBlockIds: [1, 5, 8] }`. Klient refreshne data a může retry.

**Split group specifika:** Při propagaci sdílených polí (řádky 318-347 v blocks/[id]/route.ts) zkontrolovat `updatedAt` všech siblings v transakci. Pokud jakýkoliv sibling má novější `updatedAt` než očekávanou, 409 s informací o konfliktu.

**Které endpointy NEDOSTANOU optimistic locking (nepotřebují):**
- `POST /api/blocks` — create, žádný conflict
- `DELETE /api/blocks/[id]` — idempotentní (404 pokud smazán)
- Admin CRUD (codebook, presets, users) — nízká frekvence, single admin
- `POST /api/machine-shifts` — overlap check v transakci už existuje

### 3.6 Batch endpoint — oprava TOCTOU

**Nalezeno review:** Aktuální batch endpoint fetchuje bloky MIMO transakci (řádek 46), pak validuje, pak teprve updatuje v transakci. Mezi fetchem a transakcí může jiný uživatel blok smazat nebo přesunout.

**Oprava:** Přesunout fetch existujících bloků DOVNITŘ interaktivní transakce:
```typescript
const results = await prisma.$transaction(async (tx) => {
  // Fetch + validate + update vše v jedné transakci
  const existingBlocks = await tx.block.findMany({
    where: { id: { in: updates.map(u => u.id) } },
  });
  // ... optimistic locking check per block
  // ... schedule validation
  // ... updates
});
```

### 3.7 Conflict Resolution UI

Když server vrátí 409 Conflict:

1. Toast notification: "Blok {orderNumber} byl mezitím změněn jiným uživatelem."
2. Klient refetchne blok přes `GET /api/blocks/{id}` (role-filtered)
3. Lokální stav se aktualizuje na serverovou verzi
4. Uživatel vidí aktuální stav a může znovu editovat

**Žádný merge dialog** — pro plánovací app je "refresh + retry" jednodušší a bezpečnější než tří-cestný merge.

**Offline/disconnect banner:** Pokud `lastHeartbeat` > 60s, zobrazit žlutý banner nahoře: "Spojení se serverem přerušeno. Data nemusí být aktuální." Banner zmizí po obnovení spojení.

---

## 4. Změny v existujícím kódu

### 4.0 Migrace

| Soubor | Změna |
|--------|-------|
| `prisma/schema.prisma` | Block: `updatedAt DateTime @updatedAt`, Reservation: `updatedAt DateTime @updatedAt` |
| Nová migrace | `npx prisma migrate dev --name add-updatedAt-auto` |

### 4.1 Nové soubory

| Soubor | Účel | Řádky (odhad) |
|--------|------|----------------|
| `src/lib/eventBus.ts` | In-memory event emitter singleton + helper `emitBlockEvent` | ~40 |
| `src/app/api/events/route.ts` | SSE endpoint s auth, role filtering, heartbeat, connection tracking | ~120 |
| `src/hooks/useSSE.ts` | Klientský hook pro EventSource + heartbeat tracking + reconnect | ~80 |

### 4.2 Modifikované soubory

| Soubor | Změna | Řádky (odhad) |
|--------|-------|----------------|
| `src/app/api/blocks/route.ts` (POST) | `emitBlockEvent("created", ...)` po `$transaction` | +5 |
| `src/app/api/blocks/[id]/route.ts` (PUT) | Optimistic locking + `emitBlockEvent("updated", ...)` + split group locking | +30 |
| `src/app/api/blocks/[id]/route.ts` (DELETE) | `emitBlockEvent("deleted", ...)` | +5 |
| `src/app/api/blocks/batch/route.ts` | Přesunout fetch do transakce + optimistic locking per-block + emit | +40 |
| `src/app/api/blocks/[id]/complete/route.ts` | Optimistic locking + emit | +15 |
| `src/app/api/blocks/[id]/expedition/route.ts` | Emit `block:expedition-changed` | +5 |
| `src/app/api/reservations/[id]/route.ts` | Optimistic locking na PATCH + emit | +20 |
| `src/app/api/machine-shifts/route.ts` | Emit `schedule:changed` (POST, PUT, DELETE) | +10 |
| `src/app/api/machine-exceptions/route.ts` | Emit `schedule:changed` (POST, DELETE) | +8 |
| `src/app/_components/PlannerPage.tsx` | useSSE hook + rozšířená merge logika + `editingBlockIds` + conflict toast + offline banner + polling interval 5 min (fallback) | ~80 |
| `src/app/expedice/_components/ExpedicePage.tsx` | useSSE hook pro expedition eventy | ~25 |
| `src/app/tiskar/_components/TiskarMonitor.tsx` | useSSE hook + polling jako fallback | ~20 |
| `src/app/rezervace/_components/RezervacePage.tsx` | useSSE hook pro reservation eventy | ~20 |

**Celkový odhad: ~550-650 řádků** nového/změněného kódu.

### 4.3 Co se NEMĚNÍ

- `src/lib/auth.ts` — beze změny
- `src/middleware.ts` — beze změny
- `src/components/*` — UI komponenty beze změny
- `src/lib/errors.ts` — `CONFLICT` kód už existuje
- Admin dashboard — beze změny (nízká frekvence, polling stačí)

---

## 5. Etapy implementace (OPRAVENÉ POŘADÍ)

### Etapa 0: Spike — SSE na Next.js 16 (30 minut)
- Vytvořit minimální SSE endpoint, připojit se z prohlížeče
- Ověřit, že spojení přežije 5+ minut na firemním serveru
- Pokud Next.js timeout zabije stream → hledat `maxDuration` config nebo alternativu
- **Gate:** Pokud SSE nefunguje, celý plán se musí přehodnotit

### Etapa 1: Prisma migrace + Optimistic Locking (SAFETY FIRST)
- Migrace: `updatedAt @updatedAt` na Block a Reservation
- Optimistic locking v PUT Block, Batch, Complete, PATCH Reservation
- Batch endpoint: přesunout fetch do transakce (TOCTOU fix)
- Split group: zkontrolovat siblings `updatedAt` při propagaci
- `expectedUpdatedAt` validace (400 na invalid)
- 409 response: `{ error, code: "CONFLICT", currentUpdatedAt }` (ne celý blok)
- Klient: posílat `updatedAt` v PUT requestech
- **Testovatelné**: 2 prohlížeče editují stejný blok → druhý dostane 409
- **Benefit: okamžitý, i bez SSE — zabrání tichým přepisům**

### Etapa 2: Event Bus + SSE Endpoint
- Vytvořit `eventBus.ts` singleton + helper `emitBlockEvent`
- Vytvořit `GET /api/events` SSE route handler
- Auth, role filtering, heartbeat 15s, session re-verify na heartbeatu
- Connection tracking + limits (5/user, 100 total)
- Response headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`
- **Testovatelné**: curl na `/api/events` drží spojení, heartbeat viditelný

### Etapa 3: Emitování událostí z mutačních endpointů
- Přidat `emitBlockEvent()` do všech Block mutací (POST, PUT, DELETE, batch, complete, expedition)
- Přidat emitování do reservation PATCH a machine-shifts/exceptions
- Vždy PO úspěšném `$transaction`, nikdy uvnitř
- `sourceUserId` vždy z `session.id` (server-side), nikdy z request body
- **Testovatelné**: otevřít 2 prohlížeče, v jednom přidat blok → druhý vidí SSE event v DevTools

### Etapa 4: Klientský useSSE hook + merge logika
- Implementovat `useSSE.ts` hook
- Napojit na PlannerPage — rozšířit merge na všechna pole
- `editingBlockIds: Set<number>` — ochrana dirty formulářů a dragovaných bloků
- Toast při merge chráněného bloku: "Blok XY byl mezitím změněn"
- Reconnect → full fetch pro sync
- Heartbeat tracking + offline banner (>60s bez dat)
- **Testovatelné**: 2 prohlížeče, přesun bloku v jednom → druhý vidí okamžitou změnu

### Etapa 5: Cleanup + rozšíření na další moduly
- Conflict toast v PlannerPage (409 handling)
- **Polling NEODSTRANIT** — prodloužit interval na 5 minut jako fallback záchranná síť
- Napojit useSSE na ExpedicePage, TiskarMonitor, RezervacePage
- End-to-end validace se 3+ prohlížeči, různé role, paralelní editace

---

## 6. Co toto řešení NEŘEŠÍ (a proč to nevadí)

| Věc | Proč ne |
|-----|---------|
| Presence (kdo edituje který blok) | Overkill — 10 lidí, 2 stroje, vizuálně vidí kdo kde je |
| CRDT/merge konfliktních editací | Plánovací app — "refresh + retry" je bezpečnější |
| Multi-server scaling | 1 firemní server, nepotřebujeme Redis pub/sub |
| Offline support | Interní app, vždy online |
| SSE pro admin dashboard | Nízká frekvence editací, polling stačí |
| Audit log a notification SSE | 60s polling je dostatečný, audit/notif nejsou time-critical |
| `Last-Event-Id` server-side replay | Nice-to-have pro budoucnost, full fetch po reconnectu stačí pro MVP |

## 7. Známé limitace (dokumentované)

| Limitace | Dopad | Workaround |
|----------|-------|------------|
| TISKAR `assignedMachine` z JWT (stale po admin změně) | SSE filtruje na starý stroj | Uživatel se musí odhlásit a znovu přihlásit |
| Single-process only (in-memory EventEmitter) | Nefunguje s více Node.js workery | Pro 10 uživatelů nepotřeba; budoucí škálování → Redis pub/sub |
| Mobile/tablet background tab | Safari/iOS může suspendovat SSE | Auto-reconnect + full fetch po návratu |

---

## 8. Metriky úspěchu

| Metrika | Před | Po |
|---------|------|-----|
| Latence změn mezi uživateli | 30s (nebo nikdy pro non-printCompleted) | < 1s |
| DB polling queries/min (10 users) | ~40 | ~2 (fallback polling 5min) |
| Silent overwrites | Možné (žádná ochrana) | 0 (409 Conflict) |
| Nové závislosti | — | 0 |
| Nové DB migrace | — | 1 (updatedAt @updatedAt) |
| Finanční náklady | — | 0 Kč |

---

## 9. Změny oproti původnímu draftu (post-review)

| Změna | Důvod | Nalezl agent |
|-------|-------|--------------|
| Přidána Prisma migrace `@updatedAt` | Bez ní optimistic locking nefunguje | Všech 5 |
| Etapy přeuspořádány: opt. locking jako fáze 1 | Safety net musí být první | Fresh, Feasibility |
| Heartbeat 15s místo 30s | 30s příliš blízko proxy timeout | Feasibility |
| 409 nevrací celý blok, jen `currentUpdatedAt` | Security — role-based access bypass | Security |
| Connection limit per user (5) a total (100) | DoS ochrana | Security |
| Session re-verify na heartbeatu | Role změna mid-session | Security |
| `sourceUserId` vždy ze server session | Prevence client-side spoofingu | Security |
| `emitBlockEvent` helper funkce | Konzistence + redukce duplicity | Fresh |
| `editingBlockIds: Set` místo jen `editingBlock` | Dirty form ochrana | Fresh |
| Polling jako fallback (5 min), ne smazán | Transition safety + záchranná síť | Fresh |
| Batch endpoint: fetch přesunut do transakce | TOCTOU gap | Feasibility |
| Split group: siblings updatedAt check | Propagace race condition | Feasibility |
| Offline banner (>60s bez heartbeatu) | UX — uživatel musí vědět o přerušení | Fresh |
| Odhad kódu 550-650 řádků (ne 300) | Realističtější po spočtení endpointů | Fresh |
| Spike test (etapa 0) | Eliminace největšího unknown | Feasibility |
| `X-Accel-Buffering: no` header | Proxy buffering prevence | Security |
