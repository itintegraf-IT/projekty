# Tiskař Split Peek — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiskař uvidí na rozdělené zakázce status druhé části (čeká/hotovo) a může otevřít read-only peek druhého stroje vedle vlastního timeline.

**Architecture:** Frontend-only — žádné změny v Prisma schématu, žádné nové API endpointy. Detekce split partnera je pure funkce nad existujícím `Block` modelem (`splitGroupId`, `printCompletedAt`). Nové UI komponenty v `src/components/`, integrace přes props v `PlannerPage.tsx` a `TimelineGrid.tsx`.

**Tech Stack:** Next.js 16, React 18, TypeScript, Tailwind CSS v4, Node test runner (`node --test --import tsx`), inline styly pro iOS-look (glass blur, segmented control, bottom sheet).

**Související spec:** [`docs/superpowers/specs/2026-05-23-tiskar-split-peek-design.md`](../specs/2026-05-23-tiskar-split-peek-design.md)

**Stop-and-review:** Vojta preferuje zastavit po každé etapě (= jeden Task) a vyžádat si OK před pokračováním. Každý Task končí buildem nebo spuštěnými testy a commitem.

---

## File Structure

### Nové soubory
| Soubor | Odpovědnost |
|---|---|
| `src/lib/splitHelpers.ts` | `findSplitPartner()`, `getSplitChipState()` — pure funkce nad `Block` |
| `src/lib/splitHelpers.test.ts` | Unit testy (Node test runner) |
| `src/components/SplitChip.tsx` | Pasivní pill chip s šipkou + status + čas |
| `src/components/MachinePeekPanel.tsx` | Read-only timeline druhého stroje (30 % šířky) |
| `src/components/TiskarMachineToggle.tsx` | iOS segmented control v hlavičce |
| `src/components/OrderSearchSheet.tsx` | Modal bottom sheet s vyhledáváním |

### Upravené soubory
| Soubor | Změna |
|---|---|
| `src/app/_components/TimelineGrid.tsx` | `BlockCard` přijme `splitPartner` prop a renderuje `<SplitChip>`; přidat `splitPartnerByBlockId` mapu |
| `src/app/_components/PlannerPage.tsx` | Stav `peekMachine`, `searchSheetOpen`; layout split 70/30; zapojení toggle + search button v hlavičce TISKAR |
| `src/components/BlockDetail.tsx` | Nová sekce „Druhá část" pokud má blok partnera |

---

## Task 1: splitHelpers + testy (TDD)

**Files:**
- Create: `src/lib/splitHelpers.ts`
- Create: `src/lib/splitHelpers.test.ts`

- [ ] **Step 1.1: Napsat selhávající testy**

Create `src/lib/splitHelpers.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { findSplitPartner, getSplitChipState } from "./splitHelpers";
import type { Block } from "@/app/_components/TimelineGrid";

function mkBlock(overrides: Partial<Block> = {}): Block {
  return {
    id: 1,
    orderNumber: "25-0001",
    machine: "XL_105",
    startTime: "2026-05-23T08:00:00.000Z",
    endTime: "2026-05-23T10:00:00.000Z",
    type: "ZAKAZKA",
    blockVariant: "STANDARD",
    jobPresetId: null,
    jobPresetLabel: null,
    description: null,
    locked: false,
    deadlineExpedice: null,
    expediceNote: null,
    doprava: null,
    expeditionPublishedAt: null,
    expeditionSortOrder: null,
    dataStatusId: null,
    dataStatusLabel: null,
    dataRequiredDate: null,
    dataOk: false,
    materialStatusId: null,
    materialStatusLabel: null,
    materialRequiredDate: null,
    materialOk: false,
    materialInStock: false,
    materialIssued: false,
    pantoneRequiredDate: null,
    pantoneOk: false,
    pantoneRequired: false,
    barvyStatusId: null,
    barvyStatusLabel: null,
    lakStatusId: null,
    lakStatusLabel: null,
    specifikace: null,
    materialNote: null,
    materialNoteByUsername: null,
    recurrenceType: "NONE",
    recurrenceParentId: null,
    splitGroupId: null,
    printCompletedAt: null,
    printCompletedByUserId: null,
    printCompletedByUsername: null,
    reservationId: null,
    reservationConfirmedAt: null,
    createdAt: "2026-05-23T00:00:00.000Z",
    updatedAt: "2026-05-23T00:00:00.000Z",
    ...overrides,
  };
}

test("findSplitPartner returns null when splitGroupId is null", () => {
  const me = mkBlock({ id: 1, splitGroupId: null });
  assert.equal(findSplitPartner(me, [me], "XL_105"), null);
});

test("findSplitPartner returns null when block is not on my machine", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_106" });
  const other = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_105" });
  assert.equal(findSplitPartner(me, [me, other], "XL_105"), null);
});

test("findSplitPartner returns null when no partner exists on other machine", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_105" });
  const sibling = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_105" });
  assert.equal(findSplitPartner(me, [me, sibling], "XL_105"), null);
});

test("findSplitPartner returns partner on other machine", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_105" });
  const partner = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_106" });
  const result = findSplitPartner(me, [me, partner], "XL_105");
  assert.equal(result?.id, 2);
});

test("findSplitPartner returns earliest by startTime when multiple partners", () => {
  const me = mkBlock({ id: 1, splitGroupId: 1, machine: "XL_105" });
  const later = mkBlock({ id: 2, splitGroupId: 1, machine: "XL_106", startTime: "2026-05-23T15:00:00.000Z" });
  const earlier = mkBlock({ id: 3, splitGroupId: 1, machine: "XL_106", startTime: "2026-05-23T10:00:00.000Z" });
  const result = findSplitPartner(me, [me, later, earlier], "XL_105");
  assert.equal(result?.id, 3);
});

test("getSplitChipState returns waiting when printCompletedAt is null", () => {
  const partner = mkBlock({ id: 2, startTime: "2026-05-23T14:30:00.000Z", printCompletedAt: null });
  const result = getSplitChipState(partner);
  assert.equal(result.state, "waiting");
  assert.equal(result.time.toISOString(), "2026-05-23T14:30:00.000Z");
});

test("getSplitChipState returns done when printCompletedAt is set", () => {
  const partner = mkBlock({ id: 2, startTime: "2026-05-23T14:00:00.000Z", printCompletedAt: "2026-05-23T15:45:00.000Z" });
  const result = getSplitChipState(partner);
  assert.equal(result.state, "done");
  assert.equal(result.time.toISOString(), "2026-05-23T15:45:00.000Z");
});
```

- [ ] **Step 1.2: Ověřit, že testy selhávají (modul ještě neexistuje)**

Run:
```bash
node --test --import tsx src/lib/splitHelpers.test.ts
```
Expected: FAIL — `Cannot find module './splitHelpers'`.

- [ ] **Step 1.3: Implementovat splitHelpers.ts**

Create `src/lib/splitHelpers.ts`:

```typescript
import type { Block } from "@/app/_components/TimelineGrid";

/**
 * Najde sourozenecký blok ze stejné split skupiny na **jiném** stroji,
 * než je tiskařův (myMachine). Vrátí null, pokud:
 *  - blok není splitnutý
 *  - blok není na tiskařově stroji
 *  - žádný partner na druhém stroji neexistuje
 *
 * Při více kandidátech vrátí prvního podle startTime (ASC).
 */
export function findSplitPartner(
  block: Block,
  allBlocks: Block[],
  myMachine: string
): Block | null {
  if (block.splitGroupId == null) return null;
  if (block.machine !== myMachine) return null;
  const candidates = allBlocks.filter(
    (b) =>
      b.id !== block.id &&
      b.splitGroupId === block.splitGroupId &&
      b.machine !== myMachine
  );
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  return candidates[0];
}

/**
 * Odvodí stav chipu z partnerova printCompletedAt.
 * - waiting: tisk ještě nebyl potvrzen → čas = startTime (plánovaný)
 * - done:    tisk potvrzen → čas = printCompletedAt
 */
export function getSplitChipState(partner: Block): {
  state: "waiting" | "done";
  time: Date;
} {
  if (partner.printCompletedAt) {
    return { state: "done", time: new Date(partner.printCompletedAt) };
  }
  return { state: "waiting", time: new Date(partner.startTime) };
}
```

- [ ] **Step 1.4: Spustit testy a ověřit zelené**

Run:
```bash
node --test --import tsx src/lib/splitHelpers.test.ts
```
Expected: PASS — 7/7 tests passing.

- [ ] **Step 1.5: Spustit regresní suite**

Run:
```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```
Expected: 24/24 PASS (8 + 5 + 11).

- [ ] **Step 1.6: Build check**

Run:
```bash
npm run build
```
Expected: 0 errors.

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/splitHelpers.ts src/lib/splitHelpers.test.ts
git commit -m "tiskar split: pure helpery pro detekci partnera a stavu chipu"
```

**STOP — počkat na OK od Vojty před Task 2.**

---

## Task 2: SplitChip komponenta

**Files:**
- Create: `src/components/SplitChip.tsx`

- [ ] **Step 2.1: Vytvořit SplitChip.tsx**

Create `src/components/SplitChip.tsx`:

```typescript
"use client";

import { utcToPragueHour } from "@/lib/dateUtils";

type Props = {
  partnerMachine: string;
  state: "waiting" | "done";
  time: Date;
  onClick: () => void;
};

export function SplitChip({ partnerMachine, state, time, onClick }: Props) {
  const dotColor   = state === "done" ? "var(--success, #34c759)" : "var(--warning, #ff9500)";
  const haloColor  = state === "done" ? "rgba(52,199,89,0.18)"    : "rgba(255,149,0,0.18)";
  const statusLabel = state === "done" ? "hotovo" : "čeká";
  const { h, m } = utcToPragueHour(time);
  const timeStr = `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

  return (
    <button
      onClick={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
        padding: "3px 8px 3px 6px",
        background: "rgba(255,255,255,0.65)",
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        color: "#1c1c1e",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        cursor: "pointer",
        lineHeight: 1.1,
        whiteSpace: "nowrap",
      }}
      title={`Druhá část běží na ${partnerMachine} — ${statusLabel} ${timeStr}`}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: `0 0 0 3px ${haloColor}`,
          flexShrink: 0,
        }}
      />
      <span style={{ opacity: 0.6 }}>→</span>
      <span style={{ fontWeight: 700 }}>{partnerMachine}</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span>{statusLabel} {timeStr}</span>
    </button>
  );
}
```

**Pozn.:** `utcToPragueHour` musí existovat v `dateUtils.ts`. Pokud vrací jiný tvar než `{ h, m }`, použij existující helper z `dateUtils.ts` (např. format dle vzoru z `BlockCard`).

- [ ] **Step 2.2: Ověřit existenci utcToPragueHour**

Run:
```bash
grep -n "export function utcToPragueHour\|export const utcToPragueHour" src/lib/dateUtils.ts
```
Expected: nalezen export. Pokud signatura jiná, upravit volání v `SplitChip.tsx` na konzistentní helper (`utcToPragueDateStr` + manual time parse, nebo `formatPragueMaybeToday`).

- [ ] **Step 2.3: Build check**

Run:
```bash
npm run build
```
Expected: 0 errors.

- [ ] **Step 2.4: Commit**

```bash
git add src/components/SplitChip.tsx
git commit -m "tiskar split: SplitChip pill komponenta v iOS stylu"
```

**STOP — počkat na OK před Task 3.**

---

## Task 3: Zapojit SplitChip do BlockCard v TimelineGrid

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`

Cíl: BlockCard přijme nový prop `splitPartner: Block | null` a `onSplitChipClick: (partnerId: number) => void`. Pokud `splitPartner` není null a výška bloku ≥ 32 px, renderuje se chip.

- [ ] **Step 3.1: Import SplitChip a helper do TimelineGrid.tsx**

Na začátek souboru (k ostatním importům):

```typescript
import { SplitChip } from "@/components/SplitChip";
import { findSplitPartner, getSplitChipState } from "@/lib/splitHelpers";
```

- [ ] **Step 3.2: Rozšířit `BlockCard` props typ**

V definici `BlockCard` props (kolem řádku 829) přidat:

```typescript
splitPartner?: Block | null;
onSplitChipClick?: (partnerId: number) => void;
```

A v destruktuře (kolem řádku 820):

```typescript
splitPartner, onSplitChipClick,
```

- [ ] **Step 3.3: Renderovat SplitChip uvnitř BlockCard**

Najít místo, kde se uvnitř BlockCard renderuje obsah bloku — typicky uvnitř hlavního `<div>` s `block.orderNumber` / popisem. Najdi konec hlavního obsahu (před closing tagem hlavního bloku) a vlož:

```typescript
{splitPartner && clampedHeight >= 32 && (() => {
  const { state, time } = getSplitChipState(splitPartner);
  return (
    <SplitChip
      partnerMachine={splitPartner.machine}
      state={state}
      time={time}
      onClick={() => onSplitChipClick?.(splitPartner.id)}
    />
  );
})()}
```

**Pozn.:** Pokud má BlockCard více „modů" (MODE_FULL, MODE_COMPACT, MODE_TINY), vlož chip jen do MODE_FULL a MODE_COMPACT větve — v MODE_TINY se nezobrazí (výška < 32 px už chip vyloučí, ale pro jistotu omez i podle mode).

- [ ] **Step 3.4: Předat splitPartner z `machineBlocks.map` (kolem řádku 3134)**

Před `return (<BlockCard ...>)` přidat výpočet:

```typescript
const splitPartner = isTiskar
  ? findSplitPartner(block, blocks, assignedMachine ?? "")
  : null;
```

(Pozn.: `blocks` je full pole; `assignedMachine` už dnes existuje jako prop `TimelineGrid` — viz řádek 1944, `assignedMachine` se předává jako prop.)

Pak v JSX `<BlockCard>`:

```typescript
splitPartner={splitPartner}
onSplitChipClick={onSplitChipClick}
```

- [ ] **Step 3.5: Rozšířit `TimelineGrid` props o `onSplitChipClick`**

V definici props `TimelineGrid` přidat:

```typescript
onSplitChipClick?: (partnerId: number) => void;
```

A v destruktuře parameterů + v `callbacksRef.current` zachovat.

- [ ] **Step 3.6: Předat `onSplitChipClick` z PlannerPage (zatím no-op)**

V `PlannerPage.tsx` u volání `<TimelineGrid>`:

```typescript
onSplitChipClick={(partnerId) => {
  console.log("[tiskar split] chip clicked, partner:", partnerId);
}}
```

(Dočasný log — bude nahrazen v Task 5 reálným handlerem.)

- [ ] **Step 3.7: Build + lint**

Run:
```bash
npm run build
npm run lint
```
Expected: 0 build errors. Lint warningy ok (existující).

- [ ] **Step 3.8: Spustit dev a manuálně otestovat**

Run:
```bash
npm run dev
```

Manuální test:
1. Přihlásit se jako tiskař na XL_105.
2. V DB najít / vytvořit splitnutou zakázku 1/2 XL_105 + 2/2 XL_106.
3. Otevřít `/` — na bloku 1/2 by se měl objevit chip „→ XL_106 · čeká HH:MM" (oranžový).
4. Klik na chip → v konzoli `chip clicked, partner: <id>`.

Zastavit dev (Ctrl+C) po ověření.

- [ ] **Step 3.9: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "tiskar split: SplitChip zapojen do BlockCard pro roli TISKAR"
```

**STOP — počkat na OK před Task 4.**

---

## Task 4: MachinePeekPanel komponenta

**Files:**
- Create: `src/components/MachinePeekPanel.tsx`

Cíl: Read-only timeline druhého stroje. Sdílí render logiku s `TimelineGrid` přes props (žádný copy-paste rendering kódu — peek je zjednodušená kopie pro read-only).

- [ ] **Step 4.1: Vytvořit MachinePeekPanel.tsx**

Create `src/components/MachinePeekPanel.tsx`:

```typescript
"use client";

import { useEffect, useRef } from "react";
import type { Block } from "@/app/_components/TimelineGrid";
import { dateToY, utcToPragueDateStr } from "@/lib/dateUtils";

type Props = {
  machine: string;
  blocks: Block[];                  // PŘEDFILTROVANÉ na `machine`
  highlightBlockId: number | null;
  viewStart: Date;
  slotHeight: number;
  totalHeight: number;              // celková výška scrollovatelného obsahu (matchuje hlavní timeline)
  scrollTop: number;                // one-way sync z hlavního pohledu
  onClose: () => void;
};

const TYPE_COLORS: Record<string, string> = {
  ZAKAZKA: "#1a6bcc",
  REZERVACE: "#7c3aed",
  UDRZBA: "#22c55e",
};

export function MachinePeekPanel({
  machine,
  blocks,
  highlightBlockId,
  viewStart,
  slotHeight,
  totalHeight,
  scrollTop,
  onClose,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // One-way sync z hlavního scrollu
  useEffect(() => {
    if (scrollRef.current && scrollRef.current.scrollTop !== scrollTop) {
      scrollRef.current.scrollTop = scrollTop;
    }
  }, [scrollTop]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "30%",
        minWidth: 280,
        background: "linear-gradient(180deg, rgba(245,245,250,0.6), rgba(245,245,250,0.2))",
        borderLeft: "1px dashed rgba(0,0,0,0.12)",
        overflow: "hidden",
      }}
    >
      {/* Header peeku */}
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(250,250,252,0.85)",
          backdropFilter: "blur(20px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--text-muted)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, color: "var(--text)" }}>{machine}</span>
          <span
            style={{
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: "0.4px",
              padding: "1px 6px",
              borderRadius: 4,
              background: "rgba(0,0,0,0.05)",
            }}
          >
            READ-ONLY
          </span>
        </div>
        <button
          onClick={(e) => {
            if (e.button !== 0) return;
            onClose();
          }}
          aria-label="Zavřít peek"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--text-muted)",
            padding: "0 4px",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {/* Scrollovatelný timeline (one-way sync) */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "hidden",      // nedovolit samostatný scroll
          position: "relative",
        }}
      >
        <div style={{ position: "relative", height: totalHeight, paddingLeft: 40 }}>
          {/* Hodinové popisky a guideline */}
          <div
            style={{
              position: "absolute",
              left: 36,
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--border)",
            }}
          />
          {blocks.map((block) => {
            const top = dateToY(new Date(block.startTime), viewStart, slotHeight);
            const height = dateToY(new Date(block.endTime), viewStart, slotHeight) - top;
            const isHighlight = block.id === highlightBlockId;
            const color = TYPE_COLORS[block.type] ?? "#475569";
            return (
              <div
                key={block.id}
                style={{
                  position: "absolute",
                  top,
                  left: 50,
                  right: 10,
                  height: Math.max(height, 20),
                  background: `${color}22`,
                  border: isHighlight ? `2px solid var(--accent, #007aff)` : `1px solid ${color}44`,
                  borderRadius: 8,
                  padding: "4px 6px",
                  fontSize: 10,
                  color: "var(--text)",
                  opacity: isHighlight ? 1 : 0.55,
                  filter: isHighlight ? "none" : "saturate(0.6)",
                  animation: isHighlight ? "peek-pulse 2s ease-in-out infinite" : undefined,
                  overflow: "hidden",
                  pointerEvents: "none",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 11 }}>
                  {block.orderNumber}
                </div>
                {block.description && (
                  <div style={{ opacity: 0.8, fontSize: 10, marginTop: 1 }}>
                    {block.description}
                  </div>
                )}
                {block.printCompletedAt && (
                  <div
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      color: "var(--success, #34c759)",
                      marginTop: 2,
                    }}
                  >
                    ✓ vytištěno
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Animace pulzu */}
      <style>{`
        @keyframes peek-pulse {
          0%, 100% { box-shadow: 0 0 0 2px rgba(0,122,255,0.6); }
          50%      { box-shadow: 0 0 0 6px rgba(0,122,255,0.2); }
        }
      `}</style>
    </div>
  );
}
```

**Pozn.:** Funkce `dateToY` se používá v `TimelineGrid`. Pokud není exportovaná z `dateUtils.ts`, exportovat ji nebo si ji v peeku duplikovat (vzhledem k YAGNI: pokud už je `export`, použít; jinak inline copy v MachinePeekPanel).

- [ ] **Step 4.2: Ověřit export dateToY**

Run:
```bash
grep -n "export function dateToY\|export const dateToY" src/lib/dateUtils.ts
```
Expected: nalezeno. Pokud ne, najít, kde je definovaná (`grep -rn "function dateToY"` v `src/`) a buď exportovat z `dateUtils.ts`, nebo importovat z místa, kde existuje.

- [ ] **Step 4.3: Build**

Run:
```bash
npm run build
```
Expected: 0 errors.

- [ ] **Step 4.4: Commit**

```bash
git add src/components/MachinePeekPanel.tsx
git commit -m "tiskar split: MachinePeekPanel komponenta read-only timeline"
```

**STOP — počkat na OK před Task 5.**

---

## Task 5: Zapojit peek do PlannerPage

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

Cíl: Stav `peekMachine` a `peekHighlightBlockId`; layout split 70/30 pokud `peekMachine != null`; scroll sync z hlavního pohledu.

- [ ] **Step 5.1: Importy**

Na začátek souboru (k existujícím importům):

```typescript
import { MachinePeekPanel } from "@/components/MachinePeekPanel";
```

- [ ] **Step 5.2: Nový state**

Najít blok useState deklarací v `PlannerPage` (typicky kolem `setBlocks`, `setSelectedBlock` apod.) a přidat:

```typescript
const [peekMachine, setPeekMachine] = useState<string | null>(null);
const [peekHighlightBlockId, setPeekHighlightBlockId] = useState<number | null>(null);
const [peekScrollTop, setPeekScrollTop] = useState(0);
```

- [ ] **Step 5.3: Sledovat scrollTop hlavního pohledu**

Najít `scrollRef` a `onScroll` handler hlavního timeline. Přidat:

```typescript
function handleMainScroll(e: React.UIEvent<HTMLDivElement>) {
  // ... existující handler ...
  if (isTiskar && peekMachine) {
    setPeekScrollTop(e.currentTarget.scrollTop);
  }
}
```

Pokud `onScroll` zatím neexistuje, přidat na scroll wrapper `onScroll={handleMainScroll}`.

- [ ] **Step 5.4: Handler chipu — otevřít peek**

V `PlannerPage` nahradit dočasný no-op handler (z Task 3, step 3.6):

```typescript
const handleSplitChipClick = useCallback((partnerId: number) => {
  const partner = blocks.find(b => b.id === partnerId);
  if (!partner) return;
  setPeekMachine(partner.machine);
  setPeekHighlightBlockId(partner.id);
  // Scrollnout hlavní pohled na čas partnera, aby peek byl ve stejné pozici
  const target = new Date(partner.startTime).getTime();
  // pendingScrollMs.current je existující ref pro odložený scroll
  pendingScrollMs.current = target;
  // Pokud je partner mimo viewStart, rozšíř daysBack (stejný pattern jako handleJumpToOutOfRange)
  if (new Date(partner.startTime) < viewStart) {
    handleJumpToOutOfRange(partner);
  } else {
    const y = dateToY(new Date(partner.startTime), viewStart, slotHeight);
    scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
  }
}, [blocks, viewStart, slotHeight]);
```

Předat do `<TimelineGrid onSplitChipClick={handleSplitChipClick}>`.

- [ ] **Step 5.5: Layout split 70/30**

Najít hlavní wrapper, kde se renderuje `<TimelineGrid>`. Obalit do flex containeru:

```typescript
<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
  <div style={{ flex: peekMachine ? "0 0 70%" : "1 1 100%", minWidth: 0, transition: "flex-basis 200ms ease" }}>
    <TimelineGrid ... />
  </div>
  {isTiskar && peekMachine && (
    <MachinePeekPanel
      machine={peekMachine}
      blocks={blocks.filter(b => b.machine === peekMachine)}
      highlightBlockId={peekHighlightBlockId}
      viewStart={viewStart}
      slotHeight={slotHeight}
      totalHeight={/* spočítat ze (daysBack+daysAhead) * 24 * 2 * slotHeight nebo z existující konstanty */}
      scrollTop={peekScrollTop}
      onClose={() => { setPeekMachine(null); setPeekHighlightBlockId(null); }}
    />
  )}
</div>
```

**Pozn.:** `totalHeight` — musí matchovat výšku scrollovatelného obsahu v hlavním `TimelineGrid` na pixel přesně, jinak scroll sync „uteče". Run:

```bash
grep -n "height:.*slotHeight\|totalHeight\|innerHeight" src/app/_components/TimelineGrid.tsx | head -10
```

Najdi v `TimelineGrid` výpočet výšky vnitřního scroll containeru (typicky `(daysBack + daysAhead + 1) * 48 * slotHeight` — 48 půlhodinových slotů/den). Použij identický vzorec ve volání `<MachinePeekPanel totalHeight={...}>`. Pokud je tam jiná konstrukce (např. `dateToY(viewEnd, viewStart, slotHeight)`), použij ji stejnou.

- [ ] **Step 5.6: Build + lint**

Run:
```bash
npm run build
npm run lint
```
Expected: 0 errors.

- [ ] **Step 5.7: Dev test**

Run:
```bash
npm run dev
```

Manuálně:
1. Tiskař XL_105, splitnutá zakázka.
2. Klik na chip → layout se přepne na 70/30, peek XL_106 se zobrazí.
3. Druhá část v peeku má pulzující accent border.
4. Scroll hlavního pohledu → peek scrolluje synchronně.
5. Klik na × v peek headeru → peek zmizí, layout zpět na 100 %.

- [ ] **Step 5.8: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "tiskar split: peek panel 70/30 layout + scroll sync z chipu"
```

**STOP — počkat na OK před Task 6.**

---

## Task 6: TiskarMachineToggle (segmented control)

**Files:**
- Create: `src/components/TiskarMachineToggle.tsx`
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 6.1: Vytvořit TiskarMachineToggle.tsx**

Create `src/components/TiskarMachineToggle.tsx`:

```typescript
"use client";

type Props = {
  machines: readonly string[];      // typicky ["XL_105", "XL_106"]
  activeMachine: string;            // aktuálně zvýrazněný (vlastní nebo peek)
  ownMachine: string;
  onChange: (machine: string) => void;
};

export function TiskarMachineToggle({ machines, activeMachine, ownMachine, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Volba stroje"
      style={{
        display: "inline-flex",
        background: "rgba(118,118,128,0.12)",
        borderRadius: 9,
        padding: 2,
        gap: 2,
      }}
    >
      {machines.map((m) => {
        const isActive = m === activeMachine;
        return (
          <button
            key={m}
            role="tab"
            aria-selected={isActive}
            onClick={(e) => {
              if (e.button !== 0) return;
              onChange(m);
            }}
            style={{
              all: "unset",
              padding: "4px 14px",
              fontSize: 12,
              fontWeight: isActive ? 600 : 500,
              borderRadius: 7,
              background: isActive ? "white" : "transparent",
              boxShadow: isActive
                ? "0 2px 6px rgba(0,0,0,0.08), 0 1px 1px rgba(0,0,0,0.05)"
                : "none",
              color: "var(--text)",
              cursor: "pointer",
              transition: "all 150ms ease",
              whiteSpace: "nowrap",
            }}
            title={m === ownMachine ? `${m} (můj stroj)` : `${m} — peek`}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6.2: Zapojit do TISKAR hlavičky v PlannerPage**

V `PlannerPage.tsx` najít TISKAR header blok (kolem řádku 2825, `{isTiskar && <header ...>}`). Před `<Button ... Dnes>` přidat:

```typescript
import { TiskarMachineToggle } from "@/components/TiskarMachineToggle";

// ... uvnitř TISKAR headeru:
<TiskarMachineToggle
  machines={["XL_105", "XL_106"] as const}
  activeMachine={peekMachine ?? (currentUser.assignedMachine ?? "XL_105")}
  ownMachine={currentUser.assignedMachine ?? "XL_105"}
  onChange={(machine) => {
    if (machine === currentUser.assignedMachine) {
      // přepnutí zpět na vlastní stroj → zavře peek
      setPeekMachine(null);
      setPeekHighlightBlockId(null);
    } else {
      // otevře peek bez pulzu (ad-hoc, žádný highlight)
      setPeekMachine(machine);
      setPeekHighlightBlockId(null);
    }
  }}
/>
```

- [ ] **Step 6.3: Build + dev test**

Run:
```bash
npm run build && npm run dev
```

Manuálně:
1. Tiskař XL_105, header obsahuje segmented `XL_105 | XL_106`, `XL_105` active.
2. Klik na `XL_106` → peek se otevře bez pulzu (žádný highlight).
3. Klik zpět na `XL_105` → peek se zavře.

- [ ] **Step 6.4: Commit**

```bash
git add src/components/TiskarMachineToggle.tsx src/app/_components/PlannerPage.tsx
git commit -m "tiskar split: segmented control v hlavičce pro ad-hoc peek"
```

**STOP — počkat na OK před Task 7.**

---

## Task 7: OrderSearchSheet (modal vyhledávání)

**Files:**
- Create: `src/components/OrderSearchSheet.tsx`
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 7.1: Vytvořit OrderSearchSheet.tsx**

Create `src/components/OrderSearchSheet.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Block } from "@/app/_components/TimelineGrid";

type Props = {
  open: boolean;
  allBlocks: Block[];
  onSelect: (block: Block) => void;
  onClose: () => void;
};

export function OrderSearchSheet({ open, allBlocks, onSelect, onClose }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const q = query.trim().toLowerCase();
  const results = q
    ? allBlocks
        .filter((b) =>
          [b.orderNumber, b.description, b.specifikace, b.jobPresetLabel]
            .some((f) => f?.toLowerCase().includes(q))
        )
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .slice(0, 20)
    : [];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(2px)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "16px 16px 0 0",
          width: "min(480px, 100%)",
          maxHeight: "60vh",
          padding: "14px 16px 20px",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.15)",
          animation: "search-slide-up 250ms ease-out",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            width: 36,
            height: 4,
            background: "rgba(0,0,0,0.18)",
            borderRadius: 2,
            margin: "0 auto 12px",
          }}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Číslo zakázky…"
          style={{
            fontSize: 16,
            padding: 14,
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--surface-2, #f7f7f9)",
            color: "var(--text)",
            outline: "none",
          }}
        />
        <div style={{ flex: 1, overflowY: "auto", marginTop: 12 }}>
          {q && results.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Zakázka {query} nebyla nalezena.
            </div>
          )}
          {results.map((b) => (
            <button
              key={b.id}
              onClick={(e) => {
                if (e.button !== 0) return;
                onSelect(b);
              }}
              style={{
                all: "unset",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                borderRadius: 10,
                marginBottom: 4,
                cursor: "pointer",
                fontSize: 13,
                background: "transparent",
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 700 }}>{b.orderNumber}</span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {b.description ?? ""}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: 6,
                  background: "rgba(0,0,0,0.05)",
                }}
              >
                {b.machine}
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            all: "unset",
            textAlign: "center",
            padding: "10px 0 0",
            color: "var(--text-muted)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Zavřít
        </button>
      </div>
      <style>{`
        @keyframes search-slide-up {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>,
    document.body
  );
}
```

- [ ] **Step 7.2: Zapojit do TISKAR hlavičky**

V `PlannerPage.tsx`:

```typescript
import { OrderSearchSheet } from "@/components/OrderSearchSheet";

const [searchSheetOpen, setSearchSheetOpen] = useState(false);
```

V TISKAR headeru přidat tlačítko vedle „Dnes":

```typescript
<button
  onClick={(e) => { if (e.button !== 0) return; setSearchSheetOpen(true); }}
  title="Najít zakázku"
  style={{
    padding: "3px 10px",
    fontSize: 11,
    borderRadius: 6,
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 4,
  }}
>
  🔍 Najít
</button>
```

Po hlavičce (nebo na konci komponenty) renderovat sheet:

```typescript
<OrderSearchSheet
  open={searchSheetOpen}
  allBlocks={blocks}
  onSelect={(block) => {
    setSearchSheetOpen(false);
    // Pokud je blok na jiném než tiskařově stroji, otevři peek
    if (isTiskar && block.machine !== currentUser.assignedMachine) {
      setPeekMachine(block.machine);
      setPeekHighlightBlockId(block.id);
    }
    // Scrollnutí stejným patternem jako handleJumpToBlock
    if (new Date(block.startTime) < viewStart) {
      handleJumpToOutOfRange(block);
    } else {
      const y = dateToY(new Date(block.startTime), viewStart, slotHeight);
      scrollRef.current?.scrollTo({ top: Math.max(0, y - 200), behavior: "smooth" });
      setSelectedBlock(block);
    }
  }}
  onClose={() => setSearchSheetOpen(false)}
/>
```

- [ ] **Step 7.3: Build + dev test**

Run:
```bash
npm run build && npm run dev
```

Manuálně:
1. Tiskař, klik na „🔍 Najít" → sheet se vysune zdola.
2. Zadat číslo zakázky → výsledky pod inputem.
3. Klik na výsledek → sheet zmizí, scrollne se na blok. Pokud je na druhém stroji, peek se automaticky otevře s pulzem.
4. Zadat nesmysl → „Zakázka X nebyla nalezena".
5. Esc / klik backdrop / „Zavřít" → sheet se zavře.

- [ ] **Step 7.4: Commit**

```bash
git add src/components/OrderSearchSheet.tsx src/app/_components/PlannerPage.tsx
git commit -m "tiskar split: modal vyhledávání zakázek v hlavičce"
```

**STOP — počkat na OK před Task 8.**

---

## Task 8: BlockDetail „Druhá část" sekce

**Files:**
- Modify: `src/components/BlockDetail.tsx`

Cíl: Pokud má blok partnera (pro libovolnou roli, ne jen tiskař — info-only sekce), zobrazit ho v detailu.

- [ ] **Step 8.1: Importy v BlockDetail.tsx**

```typescript
import { findSplitPartner, getSplitChipState } from "@/lib/splitHelpers";
```

Komponenta už typicky přijímá `allBlocks` (nebo seznam pro split lookup). Pokud ne, přidat prop:

```typescript
allBlocks?: Block[];
```

A v `PlannerPage` kde se renderuje `<BlockDetail>` předat `allBlocks={blocks}`.

- [ ] **Step 8.2: Nová sekce v JSX**

Uvnitř `BlockDetail` renderu přidat (nejlépe pod základní info, nad audit log):

```typescript
{(() => {
  if (!allBlocks || block.splitGroupId == null) return null;
  // Najdi partnera bez ohledu na "mou" mašinu — chceme zobrazit i pro non-tiskar role
  const partner = allBlocks.find(
    (b) => b.id !== block.id
      && b.splitGroupId === block.splitGroupId
      && b.machine !== block.machine
  );
  if (!partner) return null;
  const { state, time } = getSplitChipState(partner);
  const timeStr = time.toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" });
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--text-muted)", marginBottom: 6 }}>
        Druhá část
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>Stroj</span>
        <span style={{ fontWeight: 600 }}>{partner.machine}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>Stav</span>
        <span style={{ fontWeight: 600, color: state === "done" ? "var(--success, #34c759)" : "var(--warning, #ff9500)" }}>
          {state === "done" ? "Hotovo" : "Čeká"}
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{state === "done" ? "Vytištěno" : "Plán"}</span>
        <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{timeStr}</span>
      </div>
      {state === "done" && partner.printCompletedByUsername && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span>Tiskl</span>
          <span style={{ fontWeight: 600 }}>{partner.printCompletedByUsername}</span>
        </div>
      )}
    </div>
  );
})()}
```

- [ ] **Step 8.3: Build**

Run:
```bash
npm run build
```
Expected: 0 errors.

- [ ] **Step 8.4: Dev test**

Run:
```bash
npm run dev
```

Manuálně:
1. Otevřít detail splitnutého bloku (libovolná role, ne jen tiskař).
2. Sekce „Druhá část" zobrazuje stroj, stav (Hotovo / Čeká barevně), čas, případně kdo tiskl.
3. Nesplitnutá zakázka → sekce se nezobrazí.

- [ ] **Step 8.5: Commit**

```bash
git add src/components/BlockDetail.tsx src/app/_components/PlannerPage.tsx
git commit -m "tiskar split: sekce Druhá část v BlockDetail pro všechny role"
```

**STOP — počkat na OK před Task 9.**

---

## Task 9: Finální QA + commit

**Files:** žádná změna kódu, jen ověření.

- [ ] **Step 9.1: Full test sweep**

Run:
```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
node --test --import tsx src/lib/splitHelpers.test.ts
```
Expected: **31/31** PASS (8 + 5 + 11 + 7).

- [ ] **Step 9.2: Build + lint**

Run:
```bash
npm run build
npm run lint
```
Expected: 0 build errors. Lint warningy stejné jako před zásahem (žádné nové).

- [ ] **Step 9.3: Manuální QA matrix**

Spustit dev (`npm run dev`) a projít všech 10 scénářů z spec dokumentu:

| # | Scénář | Očekávané |
|---|---|---|
| 1 | Tiskař XL_105, split 1/2 XL_105 + 2/2 XL_106, druhá nehotová | Chip „→ XL_106 · čeká HH:MM" oranžový |
| 2 | Totéž, ale 2/2 má `printCompletedAt` | Chip „→ XL_106 · hotovo HH:MM" zelený |
| 3 | Tap na chip | Split 70/30, peek XL_106, pulzující accent border na 2/2 |
| 4 | Tap X v peek header | Layout zpět na full XL_105 |
| 5 | Tap „XL_106" v segmented | Peek bez pulzu |
| 6 | Tap lupa → zadat existující číslo | Sheet ukáže výsledek, klik scrollne (a otevře peek pokud je na druhém stroji) |
| 7 | Tap lupa → zadat neexistující | „Zakázka X nebyla nalezena" |
| 8 | Split obě části na XL_105 | Chip se nezobrazí |
| 9 | Non-tiskar role (ADMIN/PLANOVAT/DTP/MTZ/OBCHODNIK/VIEWER) | Žádný chip, toggle, search button (zachováno původní chování). BlockDetail sekce „Druhá část" se zobrazí. |
| 10 | iPad landscape 1024×768 nebo desktop | Vše čitelné, žádný overflow |

Pokud cokoli selže, vrátit se k příslušnému Tasku a opravit.

- [ ] **Step 9.4: Cleanup dočasných artefaktů**

Pokud zůstal `console.log` ze Step 3.6, ověřit, že už není (mělo se přepsat v Step 5.4). Run:

```bash
grep -n "console.log.*tiskar split" src/app/_components/PlannerPage.tsx
```
Expected: žádný výsledek.

- [ ] **Step 9.5: Update CLAUDE.md (volitelně)**

Pokud chce Vojta, doplnit do `CLAUDE.md` v sekci „Co aplikace dnes umí" stručnou notu o tiskařském peeku a vyhledávání. (Skip pokud bude součástí PR description.)

- [ ] **Step 9.6: Push branch a otevřít PR (pokud workflow)**

```bash
git push origin Vojta
# Pak gh pr create podle interního zvyku
```

---

## Coding standards reminder

- ✅ Nové komponenty named export v `src/components/`, žádné inline v `PlannerPage`.
- ✅ Žádný `prisma format` / `prisma db pull`.
- ✅ Mouse handlery: `if (e.button !== 0) return`.
- ✅ Žádné API změny → `AppError` nedotčen.
- ✅ Žádné `console.*` v API routes (tato práce je frontend, `console.error` v existujícím client kódu nedotčen).
- ✅ Žádné `JWT_SECRET` nebo bezpečnostní ENV bez fallbacku — tato práce se autem nedotýká.

## Souhrn cílů

- **31/31 testů zelené**
- **0 build errors**
- **10/10 manuálních scénářů ok**
- **9 commitů** (1 per Task) pro snadný review/rollback
