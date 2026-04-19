# Unconfirmed Reservation Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vizuálně zvýraznit bloky na timeline, které pochází z rezervace dosud nepotvrzené obchodníkovi — čárkovaným borderem + ikonou přesýpacích hodin v levém pruhu (analogicky k zámečku u zamčených bloků) + overlay na časové ose.

**Architecture:** GET `/api/blocks` bude pro bloky s `reservationId` joinovat `Reservation.confirmedAt`. Typ `Block` v TimelineGrid se rozšíří o `reservationConfirmedAt`. Render bloku dostane třetí variantu levého pruhu (locked → hourglass → standard). Overlay na časové ose zobrazí fialový pruh analogický k amber lock overlay.

**Tech Stack:** Next.js API routes, Prisma include, React inline styles, lucide-react `Hourglass` ikona.

---

### Task 1: Rozšířit GET `/api/blocks` o `reservationConfirmedAt`

**Files:**
- Modify: `src/app/api/blocks/route.ts:36-40` — přidat Prisma include + mapování
- Modify: `src/lib/blockSerialization.ts:11-25,27-42` — rozšířit typ + serializaci

- [ ] **Step 1: Upravit `serializeBlock` v `blockSerialization.ts`**

Rozšířit `SerializableBlock` o volitelné pole a serializovat ho:

```typescript
// V typu SerializableBlock přidat:
Reservation?: { confirmedAt: Date | null } | null;

// V serializeBlock přidat do return:
reservationConfirmedAt: block.Reservation?.confirmedAt?.toISOString() ?? null,
```

Po přidání smazat `Reservation` z výstupu aby se nepropagoval celý objekt — přidat destructuring:

```typescript
export function serializeBlock<T extends SerializableBlock>(block: T) {
  const { Reservation, ...rest } = block;
  return {
    ...rest,
    reservationConfirmedAt: Reservation?.confirmedAt?.toISOString() ?? null,
    blockVariant: normalizeBlockVariant(block.blockVariant as string | null | undefined, block.type),
    // ... zbytek beze změny
  };
}
```

- [ ] **Step 2: Upravit GET v `blocks/route.ts`**

Přidat `include` do `prisma.block.findMany`:

```typescript
const blocks = await prisma.block.findMany({
  where: machineFilter ? { machine: machineFilter } : undefined,
  orderBy: { startTime: "asc" },
  include: {
    Reservation: { select: { confirmedAt: true } },
  },
});
```

**Pozor:** Relace v schema.prisma se jmenuje `Reservation` (řádek 73). Ověřit, že jméno odpovídá.

- [ ] **Step 3: Ověřit build**

```bash
npm run build
```

Expected: Build projde bez chyb. Nové pole `reservationConfirmedAt` se bude vracet jako `string | null` pro každý blok.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/blocks/route.ts src/lib/blockSerialization.ts
git commit -m "feat: include reservationConfirmedAt in GET /api/blocks response"
```

---

### Task 2: Rozšířit typ `Block` v TimelineGrid

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:71-124` — přidat pole do typu Block

- [ ] **Step 1: Přidat pole do typu Block**

Na řádku 121 (za `reservationId: number | null;`) přidat:

```typescript
reservationConfirmedAt: string | null;
```

- [ ] **Step 2: Ověřit build**

```bash
npm run build
```

Expected: Build projde — nové pole je `string | null`, API ho vrací, existující kód ho nepoužívá takže žádné breaking changes.

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: add reservationConfirmedAt to Block type in TimelineGrid"
```

---

### Task 3: Vizuální indikátor na bloku — Hourglass pruh + dashed border

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:24` — přidat import `Hourglass`
- Modify: `src/app/_components/TimelineGrid.tsx:985-1012` — render logika bloku

- [ ] **Step 1: Import ikony Hourglass**

Na řádku 24 rozšířit import:

```typescript
import { Lock, Clock, Hourglass } from "lucide-react";
```

- [ ] **Step 2: Přidat helper proměnnou v renderBlock**

V komponentě `RenderBlock` (cca řádek 940+), kde se počítají `isPrintDone`, `printPending` atd., přidat:

```typescript
const isUnconfirmedReservation = block.type === "REZERVACE" && block.reservationId != null && !block.reservationConfirmedAt;
```

- [ ] **Step 3: Upravit border bloku**

Na řádku 989 je definice borderu:

```typescript
// Stávající:
border: isCopied ? "1.5px dashed #3b82f6" : multiSelected ? "2.5px solid #FFE600" : block.locked ? "1.5px solid rgba(251,191,36,0.7)" : `1px solid ${selected ? "#FFE600" : s.border}`,
```

Přidat podmínku pro `isUnconfirmedReservation` — dashed fialový border:

```typescript
border: isCopied ? "1.5px dashed #3b82f6"
  : multiSelected ? "2.5px solid #FFE600"
  : block.locked ? "1.5px solid rgba(251,191,36,0.7)"
  : isUnconfirmedReservation ? `1.5px dashed rgba(168,85,247,0.7)`
  : `1px solid ${selected ? "#FFE600" : s.border}`,
```

- [ ] **Step 4: Upravit levý pruh — třetí varianta (hourglass)**

Na řádcích 1005-1012 je podmínka `block.locked ? (amber pruh) : (3px accent bar)`. Rozšířit na trojitou podmínku:

```typescript
{/* Levý barevný pruh — iOS Calendar style / amber lock strip / hourglass unconfirmed */}
{block.locked ? (
  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: "rgba(251,191,36,0.4)", borderRadius: "7px 0 0 7px", borderRight: "1px solid rgba(251,191,36,0.35)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <Lock size={11} strokeWidth={2} color="rgba(251,191,36,1)" />
  </div>
) : isUnconfirmedReservation ? (
  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: "rgba(168,85,247,0.35)", borderRadius: "7px 0 0 7px", borderRight: "1px solid rgba(168,85,247,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <Hourglass size={11} strokeWidth={2} color="rgba(168,85,247,1)" />
  </div>
) : (
  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />
)}
```

- [ ] **Step 5: Upravit paddingLeft obsahu**

Na řádcích kde je `paddingLeft: block.locked ? 28 : 8` (řádky 1039, 1141, 1230), rozšířit podmínku:

```typescript
paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 8
```

Pozor: `isUnconfirmedReservation` je lokální proměnná v `RenderBlock`, takže je dostupná ve všech těchto místech.

- [ ] **Step 6: Přidat hourglass ikonu za orderNumber (jako zámeček)**

Na řádcích 1079, 1184, 1241 je `block.locked && <span>...<Lock />...</span>`. Za každý z nich přidat analogický span pro hourglass:

```typescript
{isUnconfirmedReservation && !block.locked && <span style={{ display: "inline-flex", alignItems: "center", marginLeft: 2, opacity: 0.85 }}><Hourglass size={9} strokeWidth={2} /></span>}
```

- [ ] **Step 7: Ověřit build**

```bash
npm run build
```

Expected: Build projde.

- [ ] **Step 8: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: hourglass icon + dashed border for unconfirmed reservation blocks"
```

---

### Task 4: Overlay na časové ose — fialový pruh pro nepotvrzené rezervace

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:2487-2489` — sbírání nepotvrzených bloků
- Modify: `src/app/_components/TimelineGrid.tsx:2597-2618` — overlay pro první stroj
- Modify: `src/app/_components/TimelineGrid.tsx:2677-2698` — overlay pro druhý stroj

- [ ] **Step 1: Vytvořit mapu nepotvrzených rezervací (analogicky k `lockedBlocksByMachine`)**

Na řádku 2487-2489 je:

```typescript
const lockedBlocksByMachine = new Map<string, Block[]>();
for (const machine of visibleMachines)
  lockedBlocksByMachine.set(machine, blocks.filter(b => b.locked && b.machine === machine));
```

Hned pod to přidat:

```typescript
const unconfirmedResByMachine = new Map<string, Block[]>();
for (const machine of visibleMachines)
  unconfirmedResByMachine.set(machine, blocks.filter(b => b.type === "REZERVACE" && b.reservationId != null && !b.reservationConfirmedAt && b.machine === machine));
```

- [ ] **Step 2: Přidat overlay pro první stroj**

Hned za lock overlay blok (řádek ~2618), přidat analogický blok pro nepotvrzené rezervace:

```typescript
{/* Hourglass overlay — fialový indikátor nepotvrzených rezervací */}
{viewStart && (unconfirmedResByMachine.get(visibleMachines[0]) ?? []).map((ub) => {
  const totalH = totalDays * dayHeight;
  const top = dateToY(new Date(ub.startTime), viewStart, slotHeight);
  const bottom = dateToY(new Date(ub.endTime), viewStart, slotHeight);
  const clampedTop = Math.max(0, Math.min(top, totalH));
  const clampedBottom = Math.max(0, Math.min(bottom, totalH));
  const h = clampedBottom - clampedTop;
  if (h <= 0) return null;
  const startD = new Date(ub.startTime);
  const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
  return (
    <div key={`hg-t0-${ub.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(168,85,247,0.12)", borderTop: "1.5px solid rgba(168,85,247,0.4)", borderBottom: "1.5px solid rgba(168,85,247,0.4)", pointerEvents: "none", overflow: "hidden" }}>
      {h >= 14 && (
        <div style={{ position: "absolute", top: 2, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <Hourglass size={9} strokeWidth={2.5} color="rgba(168,85,247,0.9)" />
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(168,85,247,0.9)", letterSpacing: "0.03em" }}>{timeStr}</span>
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 3: Přidat overlay pro druhý stroj**

Hned za lock overlay pro druhý stroj (řádek ~2698), přidat identický blok s `visibleMachines[colIdx]` a klíčem `hg-t${colIdx}-${ub.id}`:

```typescript
{/* Hourglass overlay — fialový indikátor nepotvrzených rezervací (druhý stroj) */}
{viewStart && (unconfirmedResByMachine.get(visibleMachines[colIdx]) ?? []).map((ub) => {
  const totalH = totalDays * dayHeight;
  const top = dateToY(new Date(ub.startTime), viewStart, slotHeight);
  const bottom = dateToY(new Date(ub.endTime), viewStart, slotHeight);
  const clampedTop = Math.max(0, Math.min(top, totalH));
  const clampedBottom = Math.max(0, Math.min(bottom, totalH));
  const h = clampedBottom - clampedTop;
  if (h <= 0) return null;
  const startD = new Date(ub.startTime);
  const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
  return (
    <div key={`hg-t${colIdx}-${ub.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(168,85,247,0.12)", borderTop: "1.5px solid rgba(168,85,247,0.4)", borderBottom: "1.5px solid rgba(168,85,247,0.4)", pointerEvents: "none", overflow: "hidden" }}>
      {h >= 14 && (
        <div style={{ position: "absolute", top: 2, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
          <Hourglass size={9} strokeWidth={2.5} color="rgba(168,85,247,0.9)" />
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(168,85,247,0.9)", letterSpacing: "0.03em" }}>{timeStr}</span>
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 4: Ověřit build**

```bash
npm run build
```

Expected: Build projde bez chyb.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: hourglass overlay on timeline axis for unconfirmed reservations"
```

---

### Task 5: Aktualizovat stav po potvrzení rezervace (real-time update)

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` — po potvrzení/counter-propose aktualizovat `reservationConfirmedAt` v lokálním stavu

- [ ] **Step 1: Najít handler potvrzení rezervace v PlannerPage**

Ověřit, kde PlannerPage aktualizuje bloky po confirm/counter-propose akci na rezervaci. Pokud po těchto akcích volá `GET /api/blocks` (refetch), stačí — nové pole přijde z API automaticky.

Pokud lokálně patchuje blok (optimistic update), je třeba přidat `reservationConfirmedAt: new Date().toISOString()` do patche.

Prověřit `setBlocks` volání spojená s rezervacemi.

- [ ] **Step 2: Ověřit end-to-end v prohlížeči**

1. Spustit dev server: `npm run dev`
2. Vytvořit rezervaci → přijmout → QUEUE_READY → přetáhnout na timeline
3. Ověřit, že blok má dashed border + hourglass ikonu + fialový overlay na ose
4. Potvrdit rezervaci (confirm)
5. Ověřit, že po potvrzení zmizí dashed border, hourglass ikona i overlay

- [ ] **Step 3: Commit (pokud byly změny)**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat: update reservationConfirmedAt on reservation confirm action"
```

---

### Task 6: Testy

**Files:**
- No new test files — toto je čistě vizuální feature bez nové business logiky

Serializace `reservationConfirmedAt` je přímočará (ISO string nebo null). Validace harmonogramu se nemění. Stávající test suite (24 testů) musí projít beze změny:

- [ ] **Step 1: Spustit existující testy**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: 24/24 zelené.

- [ ] **Step 2: Ověřit build**

```bash
npm run build
```

Expected: Build projde.

- [ ] **Step 3: Finální commit pokud potřeba**

```bash
git add -A
git commit -m "chore: verify all tests pass with unconfirmed reservation indicator"
```
