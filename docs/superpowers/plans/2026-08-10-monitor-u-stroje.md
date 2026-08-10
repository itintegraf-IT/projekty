# Monitor u stroje — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dát tiskaři domovskou obrazovku, kde je právě běžící zakázka velká a odklepnutí je jedna akce, a plán nechat dostupný o klik dál.

**Architecture:** Rozhodovací pravidla (která zakázka je „hlavní", fronta dneška, postup běhu) jdou do čisté funkce v `src/lib/monitorView.ts` pokryté unit testy. Obrazovka je samostatná komponenta `src/components/monitor/MonitorView.tsx` (+ `MonitorQueue.tsx`), která **nenačítá vlastní data** — dostane všechno propsy z `PlannerPage`, jež už bloky drží a udržuje aktuální přes SSE. `PlannerPage` jen přidá stav `tiskarView` a přepne, co pro roli TISKAR vykreslí.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Tailwind CSS v4 (inline style pro dynamické hodnoty) · testy `node:test` + `tsx`.

**Specifikace:** `docs/superpowers/specs/2026-08-10-monitor-u-stroje-design.md`

## Global Constraints

- **Barvy vždy přes CSS tokeny** z `src/app/globals.css`, nikdy hex/rgba literál v komponentě — jinak se rozbije světlý režim (CLAUDE.md).
- **Nové standalone komponenty** jako named export do `src/components/`, ne inline do velkých souborů. `PlannerPage.tsx` má 3273 řádků a hlásí ESLint `max-lines` — do něj smí přibýt jen stav a přepnutí větve.
- **Z-index výhradně přes `src/lib/zLayers.ts`**, nikdy magické číslo.
- **Mouse handlery** začínají `if (e.button !== 0) return;`.
- Změny se smí projevit **pouze pro roli `TISKAR`**. Ostatní role vidí přesně to co dnes.
- **Žádná změna serverové logiky** — `POST /api/blocks/[id]/complete` beze změny. Žádná migrace, žádný zásah do Prisma schématu.
- **Datum vždy přes pražské helpery** z `src/lib/dateUtils.ts` (`utcToPragueDateStr`, `formatPragueTime`), nikdy `getFullYear/getMonth/getDate`.
- V `src/lib/` se `Block` importuje jako `import type { Block } from "@/app/_components/TimelineGrid";` (vzor: `src/lib/splitHelpers.ts`). **V testech** se ale importuje relativně s příponou `.js`: `import type { Block } from "../app/_components/TimelineGrid.js";` (vzor: `src/lib/pasteTarget.test.ts`).
- Build před commitem: `npm run build` musí projít.
- Celá test suite: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`

---

### Task 1: Pravidla Monitoru (čistá logika + testy)

**Files:**
- Create: `src/lib/monitorView.ts`
- Test: `src/lib/monitorView.test.ts`

**Interfaces:**
- Consumes: `utcToPragueDateStr` z `src/lib/dateUtils`; typ `Block` z `@/app/_components/TimelineGrid`.
- Produces:
  - `type HeroReason = "running" | "overdue" | "upcoming"`
  - `type HeroPick = { block: Block; reason: HeroReason } | null`
  - `pickHeroBlock(blocks: Block[], machine: string, now: Date): HeroPick`
  - `pickNextBlock(blocks: Block[], machine: string, now: Date): Block | null`
  - `todayQueue(blocks: Block[], machine: string, now: Date): Block[]`
  - `runProgress(block: Block, now: Date): { percent: number; remainingMinutes: number }`

- [ ] **Step 1: Napiš padající test**

Vytvoř `src/lib/monitorView.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { pickHeroBlock, pickNextBlock, todayQueue, runProgress } from "./monitorView.js";
import type { Block } from "../app/_components/TimelineGrid.js";

// Pozn.: časy jsou v UTC. Praha je v srpnu UTC+2, takže 2026-08-10T06:00Z = 8:00 ráno.
function mk(over: Partial<Block> = {}): Block {
  return {
    id: 1,
    machine: "XL_106",
    orderNumber: "25-2418",
    type: "ZAKAZKA",
    startTime: "2026-08-10T06:00:00.000Z",
    endTime: "2026-08-10T09:00:00.000Z",
    printCompletedAt: null,
    blockVariant: "STANDARD",
    locked: false,
    ...over,
  } as Block;
}

test("pickHeroBlock: zakázka uvnitř svého času = running", () => {
  const b = mk({ id: 1 });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T07:00:00.000Z"));
  assert.equal(hero?.reason, "running");
  assert.equal(hero?.block.id, 1);
});

test("pickHeroBlock: odklepnutá zakázka se nikdy nevybere jako running", () => {
  const b = mk({ printCompletedAt: "2026-08-10T07:30:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T08:00:00.000Z"));
  assert.equal(hero, null);
});

test("pickHeroBlock: nic neběží, ale dnešní zakázce vypršel čas = overdue", () => {
  const b = mk({ id: 7, endTime: "2026-08-10T09:00:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(hero?.reason, "overdue");
  assert.equal(hero?.block.id, 7);
});

test("pickHeroBlock: u více přetahujících vyhraje ta s nejpozdějším koncem", () => {
  const a = mk({ id: 1, startTime: "2026-08-10T04:00:00.000Z", endTime: "2026-08-10T06:00:00.000Z" });
  const b = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T08:00:00.000Z" });
  const hero = pickHeroBlock([a, b], "XL_106", new Date("2026-08-10T09:00:00.000Z"));
  assert.equal(hero?.reason, "overdue");
  assert.equal(hero?.block.id, 2);
});

test("pickHeroBlock: běžící má přednost před přetahující", () => {
  const late = mk({ id: 1, startTime: "2026-08-10T04:00:00.000Z", endTime: "2026-08-10T06:00:00.000Z" });
  const running = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T10:00:00.000Z" });
  const hero = pickHeroBlock([late, running], "XL_106", new Date("2026-08-10T07:00:00.000Z"));
  assert.equal(hero?.reason, "running");
  assert.equal(hero?.block.id, 2);
});

test("pickHeroBlock: nic neběží ani nepřetahuje = upcoming", () => {
  const b = mk({ id: 3, startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T14:00:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(hero?.reason, "upcoming");
  assert.equal(hero?.block.id, 3);
});

test("pickHeroBlock: včerejší neodklepnutá zakázka se jako overdue nebere", () => {
  const b = mk({ startTime: "2026-08-09T06:00:00.000Z", endTime: "2026-08-09T09:00:00.000Z" });
  const hero = pickHeroBlock([b], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(hero, null);
});

test("pickHeroBlock: cizí stroj a jiné typy bloků se ignorují", () => {
  const other = mk({ id: 1, machine: "XL_105" });
  const maint = mk({ id: 2, type: "UDRZBA" });
  const hero = pickHeroBlock([other, maint], "XL_106", new Date("2026-08-10T07:00:00.000Z"));
  assert.equal(hero, null);
});

test("pickNextBlock: vrátí nejbližší budoucí, i když je zítřejší", () => {
  const far  = mk({ id: 1, startTime: "2026-08-12T06:00:00.000Z", endTime: "2026-08-12T09:00:00.000Z" });
  const near = mk({ id: 2, startTime: "2026-08-11T06:00:00.000Z", endTime: "2026-08-11T09:00:00.000Z" });
  const next = pickNextBlock([far, near], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(next?.id, 2);
});

test("pickNextBlock: bez budoucí zakázky vrátí null", () => {
  const past = mk({ startTime: "2026-08-09T06:00:00.000Z", endTime: "2026-08-09T09:00:00.000Z" });
  assert.equal(pickNextBlock([past], "XL_106", new Date("2026-08-10T10:00:00.000Z")), null);
});

test("todayQueue: jen dnešek, jen daný stroj, seřazeno podle startu", () => {
  const a = mk({ id: 1, startTime: "2026-08-10T10:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  const b = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T09:00:00.000Z" });
  const other = mk({ id: 3, machine: "XL_105" });
  const tomorrow = mk({ id: 4, startTime: "2026-08-11T06:00:00.000Z", endTime: "2026-08-11T09:00:00.000Z" });
  const q = todayQueue([a, b, other, tomorrow], "XL_106", new Date("2026-08-10T08:00:00.000Z"));
  assert.deepEqual(q.map((x) => x.id), [2, 1]);
});

test("todayQueue: odklepnuté zakázky ve frontě zůstávají (zobrazí se ztlumené)", () => {
  const done = mk({ id: 5, printCompletedAt: "2026-08-10T08:00:00.000Z" });
  const q = todayQueue([done], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(q.length, 1);
});

test("runProgress: v polovině běhu = 50 % a zbývá polovina", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T10:00:00.000Z" });
  const p = runProgress(b, new Date("2026-08-10T08:00:00.000Z"));
  assert.equal(p.percent, 50);
  assert.equal(p.remainingMinutes, 120);
});

test("runProgress: po konci je 100 % a zbývající minuty jsou záporné", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T08:00:00.000Z" });
  const p = runProgress(b, new Date("2026-08-10T08:30:00.000Z"));
  assert.equal(p.percent, 100);
  assert.equal(p.remainingMinutes, -30);
});

test("runProgress: před startem je 0 %", () => {
  const b = mk({ startTime: "2026-08-10T10:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  assert.equal(runProgress(b, new Date("2026-08-10T09:00:00.000Z")).percent, 0);
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: FAIL — `Cannot find module './monitorView.js'`

- [ ] **Step 3: Napiš implementaci**

Vytvoř `src/lib/monitorView.ts`:

```ts
import type { Block } from "@/app/_components/TimelineGrid";
import { utcToPragueDateStr } from "@/lib/dateUtils";

/**
 * Pravidla pro tiskařský Monitor — která zakázka patří na velkou kartu,
 * co je ve frontě dneška a jak daleko je běh.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy; MonitorView
 * na ní jen staví a sám nic nepočítá.
 */

export type HeroReason = "running" | "overdue" | "upcoming";
export type HeroPick = { block: Block; reason: HeroReason } | null;

/** Otevřená zakázka na daném stroji = ZAKAZKA + správný stroj + neodklepnutá. */
function isOpenOrder(b: Block, machine: string): boolean {
  return b.type === "ZAKAZKA" && b.machine === machine && b.printCompletedAt == null;
}

function byStartAsc(a: Block, b: Block): number {
  return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
}

/**
 * Zakázka na velkou kartu Monitoru, s důvodem výběru. Priorita:
 *  1. `running`  — je uvnitř svého času,
 *  2. `overdue`  — nic neběží, ale dnešní zakázce už vypršel čas a nikdo ji
 *                  neodklepl (bez tohohle by z Monitoru zmizela a tiskař by ji
 *                  musel hledat v plánu),
 *  3. `upcoming` — jinak nejbližší budoucí.
 */
export function pickHeroBlock(blocks: Block[], machine: string, now: Date): HeroPick {
  const t = now.getTime();
  const open = blocks.filter((b) => isOpenOrder(b, machine));

  const running = open
    .filter((b) => new Date(b.startTime).getTime() <= t && t < new Date(b.endTime).getTime())
    .sort(byStartAsc);
  if (running.length > 0) return { block: running[0], reason: "running" };

  const today = utcToPragueDateStr(now);
  const overdue = open
    .filter(
      (b) =>
        new Date(b.endTime).getTime() <= t &&
        utcToPragueDateStr(new Date(b.startTime)) === today
    )
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  if (overdue.length > 0) return { block: overdue[0], reason: "overdue" };

  const next = pickNextBlock(blocks, machine, now);
  return next ? { block: next, reason: "upcoming" } : null;
}

/** Nejbližší budoucí neodklepnutá zakázka na stroji (klidně i zítřejší). */
export function pickNextBlock(blocks: Block[], machine: string, now: Date): Block | null {
  const t = now.getTime();
  const upcoming = blocks
    .filter((b) => isOpenOrder(b, machine) && new Date(b.startTime).getTime() > t)
    .sort(byStartAsc);
  return upcoming[0] ?? null;
}

/**
 * Zakázky na stroji, jejichž start padá do civilního pražského dne `now`.
 * Odklepnuté zůstávají — fronta je ukazuje ztlumené, aby byl vidět postup směny.
 */
export function todayQueue(blocks: Block[], machine: string, now: Date): Block[] {
  const today = utcToPragueDateStr(now);
  return blocks
    .filter(
      (b) =>
        b.type === "ZAKAZKA" &&
        b.machine === machine &&
        utcToPragueDateStr(new Date(b.startTime)) === today
    )
    .sort(byStartAsc);
}

/**
 * Postup běhu. `percent` je ořezaný na 0–100; `remainingMinutes` může být
 * záporné, pokud blok přetahuje — UI to zobrazí jako „přetahuje o X min".
 */
export function runProgress(block: Block, now: Date): { percent: number; remainingMinutes: number } {
  const start = new Date(block.startTime).getTime();
  const end = new Date(block.endTime).getTime();
  const t = now.getTime();
  const span = end - start;
  const percent = span <= 0 ? 100 : Math.max(0, Math.min(100, ((t - start) / span) * 100));
  return { percent, remainingMinutes: Math.ceil((end - t) / 60000) };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: PASS — 15 testů zelených

- [ ] **Step 5: Ověř, že nic jiného nespadlo**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 792 původních + 15 nových = 807

- [ ] **Step 6: Commit**

```bash
git add src/lib/monitorView.ts src/lib/monitorView.test.ts
git commit -m "feat(monitor): pravidla tiskařského Monitoru — hlavní zakázka, fronta dneška, postup běhu"
```

---

### Task 2: Velikost `hero` pro tlačítko Hotovo

**Files:**
- Modify: `src/lib/tiskarBlockView.ts` (typ `PrintDoneSize`)
- Modify: `src/lib/tiskarBlockView.test.ts` (jeden nový test)
- Modify: `src/components/planner/PrintDoneButton.tsx`

**Interfaces:**
- Consumes: nic z Tasku 1.
- Produces: `PrintDoneSize` rozšířený o `{ variant: "hero"; height: number; fontSize: number }`. `PrintDoneButton` tuhle variantu vykreslí na plnou šířku. Task 3 ji použije jako `{ variant: "hero", height: 96, fontSize: 30 }`.

- [ ] **Step 1: Napiš padající test**

Do `src/lib/tiskarBlockView.test.ts` přidej na konec:

```ts
test("printDoneSize: nikdy nevrátí variantu hero (ta patří jen Monitoru)", () => {
  for (const h of [200, 140, 139, 96, 95, 48, 47, 14, 13, 0]) {
    const size = printDoneSize(h);
    assert.notEqual(size?.variant, "hero");
  }
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/tiskarBlockView.test.ts`
Expected: FAIL — TypeScript hlásí, že `"hero"` není porovnatelné s typem `"bar" | "square"`

- [ ] **Step 3: Rozšiř typ**

V `src/lib/tiskarBlockView.ts` nahraď definici typu `PrintDoneSize` tímto:

```ts
/**
 * Podoba tlačítka Hotovo.
 * `bar` a `square` vrací printDoneSize() podle výšky bloku v plánu;
 * `hero` si sestavuje Monitor sám — v kartě bloku se nikdy nepoužije.
 */
export type PrintDoneSize =
  | { variant: "bar";    height: 40 | 32 | 24; fontSize: number }
  | { variant: "square"; height: 26;           fontSize: number }
  | { variant: "hero";   height: number;       fontSize: number };
```

Funkci `printDoneSize` neměň — `hero` záměrně nevrací.

- [ ] **Step 4: Uprav PrintDoneButton na plnou šířku i pro `hero`**

V `src/components/planner/PrintDoneButton.tsx` nahraď řádek

```tsx
  const isBar = size.variant === "bar";
```

tímto (jméno `isBar` se používá níž, proto zůstává, jen se mění, co znamená):

```tsx
  // `hero` (Monitor) i `bar` (karta bloku) jsou širokou variantou s popiskem;
  // `square` je jen háček. Držíme jedno jméno, ať se níž nemění nic dalšího.
  const isBar = size.variant === "bar" || size.variant === "hero";
```

A rozšiř `borderRadius`, aby velké tlačítko nemělo roh 5 px:

```tsx
        border: "none", borderRadius: size.variant === "hero" ? 12 : 5,
```

Zbytek komponenty (hover, `isDone`, `pending`, popisky) zůstává beze změny.

- [ ] **Step 5: Spusť testy a build**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 808 testů

Run: `npm run build`
Expected: build projde, 0 TypeScript chyb

- [ ] **Step 6: Commit**

```bash
git add src/lib/tiskarBlockView.ts src/lib/tiskarBlockView.test.ts src/components/planner/PrintDoneButton.tsx
git commit -m "feat(monitor): velikost hero pro tlačítko Hotovo"
```

---

### Task 3: Komponenty Monitoru

**Files:**
- Create: `src/components/monitor/MonitorQueue.tsx`
- Create: `src/components/monitor/MonitorView.tsx`

**Interfaces:**
- Consumes: `pickHeroBlock`, `todayQueue`, `runProgress`, typy `HeroPick`/`HeroReason` z `src/lib/monitorView` (Task 1); `PrintDoneButton` a typ `PrintDoneSize` s variantou `hero` (Task 2); `findSplitPartner` + `getSplitChipState` z `src/lib/splitHelpers`; `TiskarMachineToggle` z `src/components/TiskarMachineToggle`; `machineLabel` a `MACHINES` z `src/lib/machines`; `formatPragueTime` z `src/lib/dateUtils`. (Monitor nepoužívá žádný z-index — nic se nepřekrývá, takže `zLayers` netřeba.)
- Produces: `MonitorView` — named export, props přesně dle Step 3 níž. Task 4 ji vykreslí z `PlannerPage`.

- [ ] **Step 1: Vytvoř frontu dneška**

Vytvoř `src/components/monitor/MonitorQueue.tsx`:

```tsx
"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { formatPragueTime } from "@/lib/dateUtils";

type Props = {
  blocks: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
};

/**
 * Pravý sloupec Monitoru — dnešní zakázky na stroji.
 * Odklepnuté jsou ztlumené se zeleným háčkem, hlavní zakázka je zvýrazněná.
 * Kliknutí otevře detail bloku; odklepnout jde jen z velké karty vlevo.
 */
export function MonitorQueue({ blocks, heroId, onSelect }: Props) {
  if (blocks.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "12px 4px" }}>
        Dnes na tomhle stroji nic naplánováno.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
      {blocks.map((b) => {
        const isDone = b.printCompletedAt != null;
        const isHero = b.id === heroId;
        return (
          <button
            key={b.id}
            onClick={(e) => { if (e.button !== 0) return; onSelect(b); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "11px 12px",
              borderRadius: 10,
              textAlign: "left",
              font: "inherit",
              cursor: "pointer",
              background: isHero ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--surface)",
              border: `1px solid ${isHero ? "var(--success)" : "var(--border)"}`,
              color: "var(--text)",
              opacity: isDone ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: "var(--font-mono, ui-monospace), monospace",
              fontWeight: 700, fontVariantNumeric: "tabular-nums",
              fontSize: 14, flexShrink: 0,
              color: isDone ? "var(--success)" : "var(--text)",
            }}>
              {isDone ? "✓ " : ""}{b.orderNumber}
            </span>
            <span style={{
              color: "var(--text-muted)", fontSize: 13,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {b.description ?? ""}
            </span>
            <span style={{
              marginLeft: "auto", flexShrink: 0,
              color: "var(--text-muted)", fontSize: 13,
              fontVariantNumeric: "tabular-nums",
            }}>
              {formatPragueTime(new Date(b.startTime))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Ověř, že se fronta zkompiluje**

Run: `npx tsc --noEmit`
Expected: 0 chyb

- [ ] **Step 3: Vytvoř hlavní obrazovku**

Vytvoř `src/components/monitor/MonitorView.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Block } from "@/app/_components/TimelineGrid";
import { pickHeroBlock, todayQueue, runProgress } from "@/lib/monitorView";
import { findSplitPartner, getSplitChipState } from "@/lib/splitHelpers";
import { PrintDoneButton } from "@/components/planner/PrintDoneButton";
import { TiskarMachineToggle } from "@/components/TiskarMachineToggle";
import { MonitorQueue } from "@/components/monitor/MonitorQueue";
import { machineLabel, MACHINES } from "@/lib/machines";
import { formatPragueTime } from "@/lib/dateUtils";

type Props = {
  blocks: Block[];
  viewMachine: string;
  ownMachine: string | null;
  now: Date;
  onPrintComplete?: (blockId: number, completed: boolean) => Promise<void>;
  onOpenPlan: () => void;
  onOpenSearch: () => void;
  onMachineChange: (machine: string) => void;
  onSelectBlock: (block: Block) => void;
  onLogout: () => void;
};

const HEADER_BTN: CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  borderRadius: 8,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  cursor: "pointer",
  font: "inherit",
  flexShrink: 0,
};

/**
 * Domovská obrazovka tiskaře u stroje. Vlevo velká karta zakázky, kterou má
 * právě na starosti, vpravo fronta dneška. Plán je o klik dál („Celý plán →").
 *
 * Komponenta nic nenačítá ani netiká — bloky i `now` dostává z PlannerPage,
 * která je už drží a udržuje aktuální přes SSE.
 */
export function MonitorView({
  blocks, viewMachine, ownMachine, now,
  onPrintComplete, onOpenPlan, onOpenSearch, onMachineChange, onSelectBlock, onLogout,
}: Props) {
  const [pending, setPending] = useState(false);

  // Hodiny v hlavičce si Monitor vede sám — je to čistě zobrazovací věc
  // a PlannerPage žádný takový stav nemá, nemá smysl mu ho přidávat.
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  const hero = pickHeroBlock(blocks, viewMachine, now);
  const queue = todayQueue(blocks, viewMachine, now);
  const partner = hero ? findSplitPartner(hero.block, blocks, viewMachine) : null;

  const kicker =
    hero?.reason === "running" ? "TEĎ BĚŽÍ"
    : hero?.reason === "overdue" ? "PŘETAHUJE"
    : hero ? "ZAČÍNÁ" : "";

  const kickerColor =
    hero?.reason === "overdue" ? "var(--warning)"
    : hero?.reason === "running" ? "var(--success)"
    : "var(--text-muted)";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      {/* ── Hlavička ── */}
      <header style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: 14,
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}>
        <img src="/logo.png" alt="Integraf" style={{ height: 24, width: "auto", objectFit: "contain", flexShrink: 0 }} />
        <span style={{ fontSize: 17, fontWeight: 660, color: "var(--text)", flexShrink: 0 }}>
          {machineLabel(viewMachine)}
        </span>
        <TiskarMachineToggle
          machines={MACHINES}
          activeMachine={viewMachine}
          ownMachine={ownMachine ?? MACHINES[0]}
          onChange={onMachineChange}
        />
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: 18, color: "var(--text)",
          fontVariantNumeric: "tabular-nums", flexShrink: 0,
        }}>
          {clock}
        </span>
        <button style={HEADER_BTN} onClick={(e) => { if (e.button !== 0) return; onOpenSearch(); }}>
          🔍 Najít
        </button>
        <button
          style={{ ...HEADER_BTN, background: "var(--surface-3)", color: "var(--text)" }}
          onClick={(e) => { if (e.button !== 0) return; onOpenPlan(); }}
        >
          Celý plán →
        </button>
        <button style={HEADER_BTN} onClick={(e) => { if (e.button !== 0) return; onLogout(); }}>
          Odhlásit
        </button>
      </header>

      {/* ── Tělo ── */}
      <div style={{
        flex: 1, minHeight: 0,
        display: "grid", gridTemplateColumns: "1.45fr 1fr",
        gap: 18, padding: 18,
      }}>
        {/* Levý sloupec — velká karta */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          {hero ? (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase",
                color: kickerColor, fontWeight: 700, flexShrink: 0,
              }}>
                {kicker}
              </div>

              <div style={{
                flex: 1, minHeight: 0,
                display: "flex", flexDirection: "column", gap: 14,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 22,
              }}>
                <div style={{
                  fontSize: 46, fontWeight: 700, letterSpacing: "-0.02em",
                  fontVariantNumeric: "tabular-nums", lineHeight: 1, color: "var(--text)",
                }}>
                  {hero.block.orderNumber}
                </div>

                <div style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", lineHeight: 1.2 }}>
                  {hero.block.description ?? ""}
                </div>

                {hero.block.specifikace && (
                  <div style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.4 }}>
                    {hero.block.specifikace}
                  </div>
                )}

                <HeroChips block={hero.block} />

                <HeroTiming block={hero.block} reason={hero.reason} now={now} />

                {partner && (() => {
                  const { state, time } = getSplitChipState(partner);
                  return (
                    <div style={{
                      fontSize: 13, color: "var(--text-muted)",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                      <span style={{ fontWeight: 700, color: "var(--text)" }}>
                        {machineLabel(partner.machine)}
                      </span>
                      {state === "done"
                        ? `· hotovo ${formatPragueTime(time)}`
                        : `· čeká od ${formatPragueTime(time)}`}
                    </div>
                  );
                })()}

                <div style={{ marginTop: "auto" }}>
                  {onPrintComplete ? (
                    <PrintDoneButton
                      size={{ variant: "hero", height: 96, fontSize: 30 }}
                      isDone={hero.block.printCompletedAt != null}
                      completedAt={hero.block.printCompletedAt}
                      pending={pending}
                      onToggle={() => {
                        setPending(true);
                        onPrintComplete(hero.block.id, hero.block.printCompletedAt == null)
                          .finally(() => setPending(false));
                      }}
                    />
                  ) : (
                    <div style={{
                      height: 96, borderRadius: 12,
                      display: "grid", placeItems: "center",
                      background: "var(--surface-2)", color: "var(--text-muted)",
                      fontSize: 14, textAlign: "center", padding: 12,
                    }}>
                      Odklepnout jde jen na vlastním stroji.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div style={{
              flex: 1, display: "grid", placeItems: "center",
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 14, color: "var(--text-muted)", fontSize: 16, textAlign: "center", padding: 24,
            }}>
              Na tomhle stroji nic naplánováno.
            </div>
          )}
        </div>

        {/* Pravý sloupec — fronta */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
          <div style={{
            fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase",
            color: "var(--text-muted)", fontWeight: 700, flexShrink: 0,
          }}>
            Dnes na {machineLabel(viewMachine)}
          </div>
          <MonitorQueue blocks={queue} heroId={hero?.block.id ?? null} onSelect={onSelectBlock} />
        </div>
      </div>
    </div>
  );
}

/** Výrobní a stavové štítky velké karty. */
function HeroChips({ block }: { block: Block }) {
  const chips: { label: string; tone: "brand" | "ok" | "wait" | "plain" }[] = [];
  if (block.obalka) chips.push({ label: "OBÁLKA", tone: "brand" });
  if (block.vnitrky) chips.push({ label: "VNITŘKY", tone: "brand" });
  if (block.tiskoveArchy) chips.push({ label: block.tiskoveArchy, tone: "plain" });
  if (block.serie) chips.push({ label: block.serie, tone: "plain" });
  if (block.dataStatusLabel) chips.push({ label: block.dataStatusLabel, tone: block.dataOk ? "ok" : "wait" });
  if (block.materialStatusLabel) chips.push({ label: block.materialStatusLabel, tone: block.materialOk ? "ok" : "wait" });
  if (block.pantoneRequired) chips.push({ label: "PANTONE", tone: block.pantoneOk ? "ok" : "wait" });

  if (chips.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {chips.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          style={{
            fontSize: 12, fontWeight: 600, letterSpacing: "0.02em",
            borderRadius: 6, padding: "5px 10px", whiteSpace: "nowrap",
            background:
              c.tone === "ok"    ? "color-mix(in oklab, var(--success) 22%, transparent)"
              : c.tone === "wait"  ? "color-mix(in oklab, var(--warning) 22%, transparent)"
              : c.tone === "brand" ? "color-mix(in oklab, var(--brand) 22%, transparent)"
              : "var(--surface-3)",
            color:
              c.tone === "ok"    ? "var(--success)"
              : c.tone === "wait"  ? "var(--warning)"
              : c.tone === "brand" ? "var(--brand)"
              : "var(--text)",
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

/** Časová osa běhu, nebo odpočet do startu u budoucí zakázky. */
function HeroTiming({ block, reason, now }: { block: Block; reason: "running" | "overdue" | "upcoming"; now: Date }) {
  const { percent, remainingMinutes } = runProgress(block, now);

  if (reason === "upcoming") {
    const minutesToStart = Math.ceil((new Date(block.startTime).getTime() - now.getTime()) / 60000);
    return (
      <div style={{ fontSize: 17, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        Začíná v {formatPragueTime(new Date(block.startTime))}
        <span style={{ color: "var(--text-muted)" }}> · za {formatMinutes(minutesToStart)}</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 16, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums",
      }}>
        <span>{formatPragueTime(new Date(block.startTime))}</span>
        <span style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
          <span style={{
            display: "block", height: "100%", width: `${percent}%`,
            background: reason === "overdue" ? "var(--warning)" : "var(--success)",
          }} />
        </span>
        <span>{formatPragueTime(new Date(block.endTime))}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
        {remainingMinutes >= 0
          ? `Zbývá ${formatMinutes(remainingMinutes)}`
          : `Přetahuje o ${formatMinutes(-remainingMinutes)}`}
      </div>
    </div>
  );
}

/** 95 → „1 h 35 min", 40 → „40 min". */
function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
```

- [ ] **Step 4: Ověř build**

Run: `npm run build`
Expected: build projde, 0 TypeScript chyb

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 808 testů

- [ ] **Step 5: Commit**

```bash
git add src/components/monitor/MonitorView.tsx src/components/monitor/MonitorQueue.tsx
git commit -m "feat(monitor): obrazovka Monitoru — velká karta zakázky a fronta dneška"
```

---

### Task 4: Zapojení do PlannerPage

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` — stav u řádku 129, větev pro `isTiskar` u řádku 2681, tlačítko zpět v tiskařské hlavičce

**Interfaces:**
- Consumes: `MonitorView` z `src/components/monitor/MonitorView` (Task 3).
- Produces: nic pro další tasky — poslední task plánu.

> ⚠️ **Čísla řádků platí před tvými změnami** a po prvním vložení se posunou.
> Místa hledej podle obsahu: `const [searchSheetOpen`, komentář
> `{/* ── Header (TISKAR — minimální pruh) ── */}`, a `handleLogout`.

- [ ] **Step 1: Přidej stav a import**

V `src/app/_components/PlannerPage.tsx` přidej k ostatním importům:

```tsx
import { MonitorView } from "@/components/monitor/MonitorView";
```

Hned za řádek `const [searchSheetOpen, setSearchSheetOpen] = useState(false);` vlož:

```tsx
  // TISKAR: Monitor je domovská obrazovka, plán je za tlačítkem „Celý plán →".
  // Záměrně asymetrické — nejde o dvojici rovnocenných záložek.
  const [tiskarView, setTiskarView] = useState<"monitor" | "plan">("monitor");
```

- [ ] **Step 2: Vlož větev s Monitorem**

Najdi v souboru komentář `{/* ── Header (TISKAR — minimální pruh) ── */}` a **hned nad něj** vlož:

```tsx
      {/* ── TISKAR: Monitor jako domovská obrazovka ── */}
      {isTiskar && tiskarView === "monitor" && (
        <MonitorView
          blocks={blocks}
          viewMachine={viewMachine}
          ownMachine={currentUser.assignedMachine ?? null}
          now={new Date()}
          onPrintComplete={
            viewMachine === currentUser.assignedMachine ? handlePrintComplete : undefined
          }
          onOpenPlan={() => setTiskarView("plan")}
          onOpenSearch={() => setSearchSheetOpen(true)}
          onMachineChange={(machine) => setViewMachine(machine)}
          onSelectBlock={(block) => setSelectedBlock(block)}
          onLogout={handleLogout}
        />
      )}
```

- [ ] **Step 3: Skryj plánovací obrazovku, když je aktivní Monitor**

Uprav podmínku tiskařské hlavičky — najdi řádek

```tsx
      {isTiskar && (
        <header className="flex-shrink-0 px-4 py-2 flex items-center gap-3" style={{
```

a nahraď první řádek podmínkou, která hlavičku ukáže jen v režimu plánu:

```tsx
      {isTiskar && tiskarView === "plan" && (
        <header className="flex-shrink-0 px-4 py-2 flex items-center gap-3" style={{
```

Timeline je ve `<section>`, kterou sdílejí **všechny role** (uvozená komentářem `{/* ── Tělo ── */}`, hned za koncem plánovací hlavičky `</header>}`). Doplň jí podmínku, aby se pro tiskaře v režimu Monitor nevykreslovala. Najdi:

```tsx
      {/* ── Tělo ── */}
      <section style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
```

a nahraď tímto:

```tsx
      {/* ── Tělo ── (TISKAR ho vidí jen v režimu plánu; v Monitoru je nahrazené MonitorView) */}
      {(!isTiskar || tiskarView === "plan") && (
      <section style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
```

Na **konec** téže sekce (uzavírací `</section>`) přidej uzavření podmínky:

```tsx
      </section>
      )}
```

- [ ] **Step 4: Přidej tlačítko zpět do tiskařské hlavičky**

V tiskařské hlavičce, hned za `<img src="/logo.png" …/>` a oddělovač, vlož tlačítko zpět:

```tsx
          <button
            onClick={(e) => { if (e.button !== 0) return; setTiskarView("monitor"); }}
            title="Zpět na Monitor"
            style={{
              padding: "3px 10px", fontSize: 11, borderRadius: 6,
              background: "var(--surface-2)", border: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer", flexShrink: 0,
            }}
          >
            ← Monitor
          </button>
```

- [ ] **Step 5: Ověř build a testy**

Run: `npm run build`
Expected: build projde, 0 TypeScript chyb

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 808 testů

Run: `npm run lint`
Expected: 0 chyb (warningy jsou v pořádku, ale **nesmí přibýt nový `max-lines`** na PlannerPage nad dnešní stav)

- [ ] **Step 6: Ruční ověření v prohlížeči**

`npm run dev`, přihlásit se účtem s rolí `TISKAR`, na `http://localhost:3000`:

- po přihlášení naskočí **Monitor**, ne timeline
- běžící zakázka je velká, tlačítko Hotovo funguje; po odklepnutí Monitor přeskočí na další
- zakázka po termínu a neodklepnutá zůstane velká se štítkem **PŘETAHUJE**
- když nic neběží, ukáže se další zakázka se stavem **ZAČÍNÁ** a odpočtem, tlačítko jde zmáčknout
- fronta vpravo ukazuje jen dnešek a jen daný stroj, hotové ztlumené s háčkem
- **Celý plán →** otevře timeline, **← Monitor** vrátí zpět
- přepnutí na druhý stroj: data se změní a místo tlačítka se ukáže hláška o vlastním stroji
- split zakázka ukáže řádek se stavem druhé půlky
- světlý i tmavý režim
- přihlášení rolí `PLANOVAT`: planner vypadá přesně jako dřív, žádný Monitor

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(monitor): Monitor jako domovská obrazovka tiskaře, plán za tlačítkem"
```

---

## Hotovo, když

- [ ] `npm run build` projde
- [ ] Celá test suite zelená (808 testů)
- [ ] Ruční průchod z Tasku 4 kroku 7 sedí celý
- [ ] `PlannerPage.tsx` nenarostl o víc než ~35 řádků (kontrola: `wc -l src/app/_components/PlannerPage.tsx` — před začátkem 3273)
- [ ] Role mimo `TISKAR` vidí přesně to co dřív
