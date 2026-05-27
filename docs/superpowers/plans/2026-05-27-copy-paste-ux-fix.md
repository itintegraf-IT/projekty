# Copy/Paste UX Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the silent paste failure (Ctrl+V does nothing when `pasteTarget` is unset). Vkládání bloku má být zjevné, vždy poskytuje zpětnou vazbu, funguje hned po Ctrl+C bez nutnosti klikat do prázdného gridu, má vizuální značku cíle vložení, a pravým klikem na prázdno nabídne „Vložit zde".

**Architecture:** Čistě klient-strana úprava `PlannerPage.tsx` + `TimelineGrid.tsx`. Žádné schéma DB, žádné nové API. Pět nezávislých etap, každá se commitne samostatně. Po každé etapě STOP — Vojta otestuje a dá OK (`feedback_implementation_pace.md`). Testy: pure unit test na novou helper funkci `computePasteTargetFromBlock`, manuální checklist na UI změny.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Tailwind v4, shadcn/ui ContextMenu (Radix portal), node:test (`--import tsx`).

---

## Root Cause Shrnutí

Z auditu (viz konverzace 2026-05-27): `pasteTargetRef.current` musí být non-null, jinak `handlePaste` a `handleGroupPaste` mlčky vrací ([PlannerPage.tsx:2539](../../src/app/_components/PlannerPage.tsx#L2539), [PlannerPage.tsx:2598](../../src/app/_components/PlannerPage.tsx#L2598)). `pasteTarget` se nastaví **jediným způsobem**: klikem na prázdnou část timeline gridu ([TimelineGrid.tsx:3033-3043](../../src/app/_components/TimelineGrid.tsx#L3033-L3043)). Uživatel o tomto povinném kroku neví, není pro to žádný vizuální indikátor ani toast, kontextové menu na prázdno nemá položku „Vložit". Refresh stránky to neopraví (workflow zůstává stejný), self-heal po pár minutách = uživatel náhodou klikne do prázdna.

Vedlejší problémy: stálý `clipboardGroupRef.current` při přechodu z multi-select na single-select (paste vloží stará data), `useEffect([selectedBlock])` u keydown handleru se re-binduje při každé změně výběru / SSE updatu vybraného bloku.

---

## File Structure

**Create:**
- `src/lib/pasteTarget.ts` — pure helper `computePasteTargetFromBlock(block: Block): { machine: string; time: Date }`. Spočte výchozí pozici paste targetu: stejný stroj, čas = `endTime` zdrojového bloku (= těsně za zdroj). Zarovnáno na 30-min slot. Žádné DB volání.
- `src/lib/pasteTarget.test.ts` — node:test pure unit testy.

**Modify:**
- `src/app/_components/PlannerPage.tsx` — 5 míst:
  1. Nový `useRef` pro `selectedBlock` (Task 5)
  2. `handlePaste` a `handleGroupPaste` — early-return změnit na toast (Task 1)
  3. Keydown handler v `useEffect` — auto-set pasteTarget po Ctrl+C/X, clear clipboardGroupRef při single copy, dep array → `[]` (Tasks 1, 4, 5)
  4. Nový prop pro `TimelineGrid`: `pasteTarget`, `clipboardHasContent`, `onPasteHere` (Tasks 2, 3)
  5. Toast po úspěšném copy (Task 1)
- `src/app/_components/TimelineGrid.tsx` — 2 místa:
  1. Vizuální marker `pasteTarget` ve sloupci stroje (Task 2)
  2. ContextMenu na empty grid space s položkou „Vložit zde" (Task 3)

**No DB schema changes, no API changes, no auth changes.**

---

## Etapy a stop pointy

Po **každém** Tasku Vojta:
1. Spustí `npm run lint` + `npm run build` lokálně
2. Spustí dotčené testy
3. Manuálně otestuje podle „Manual smoke" sekce v Tasku
4. Schválí přechod na další Task

Není dovoleno pokračovat dalším Taskem bez explicitního OK.

---

## Task 1: Toast feedback + auto-target po Ctrl+C/X

**Cíl:** Po kopírování bloku se nastaví výchozí pasteTarget (těsně za zdroj). Pokud `pasteTarget` při Ctrl+V chybí, ukáže se toast. Po úspěšném copy také info-toast. Při single-block copy se vyčistí `clipboardGroupRef`, aby paste neutkvěl ve starém multi-stavu.

**Files:**
- Create: `src/lib/pasteTarget.ts`
- Create: `src/lib/pasteTarget.test.ts`
- Modify: `src/app/_components/PlannerPage.tsx`

### Steps

- [ ] **Step 1.1: Vytvořit pure helper `computePasteTargetFromBlock`**

Soubor: `src/lib/pasteTarget.ts`

```typescript
import type { Block } from "@/app/_components/TimelineGrid";

const SLOT_MS = 30 * 60 * 1000;

/**
 * Vypočte výchozí pasteTarget z bloku: stejný stroj, čas zarovnaný na slot
 * za koncem zdrojového bloku. Používá se pro auto-set po Ctrl+C/X, aby
 * Ctrl+V mohlo fungovat bez nutnosti klikat do prázdného gridu.
 *
 * Zarovnání na 30-min slot zajišťuje konzistenci se `snapToSlot` v gridu.
 */
export function computePasteTargetFromBlock(block: Block): { machine: string; time: Date } {
  const endMs = new Date(block.endTime).getTime();
  const snapped = Math.ceil(endMs / SLOT_MS) * SLOT_MS;
  return { machine: block.machine, time: new Date(snapped) };
}

/**
 * Vypočte výchozí pasteTarget z group bloků: stroj = stroj prvního (anchor) bloku,
 * čas = konec posledního (nejlatěji končícího) bloku.
 */
export function computePasteTargetFromGroup(blocks: Block[]): { machine: string; time: Date } | null {
  if (blocks.length === 0) return null;
  const anchorBlock = blocks.reduce((earliest, b) =>
    new Date(b.startTime).getTime() < new Date(earliest.startTime).getTime() ? b : earliest
  );
  const lastEndMs = Math.max(...blocks.map((b) => new Date(b.endTime).getTime()));
  const snapped = Math.ceil(lastEndMs / SLOT_MS) * SLOT_MS;
  return { machine: anchorBlock.machine, time: new Date(snapped) };
}
```

- [ ] **Step 1.2: Napsat unit testy pro helper**

Soubor: `src/lib/pasteTarget.test.ts`

```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { computePasteTargetFromBlock, computePasteTargetFromGroup } from "./pasteTarget.js";
import type { Block } from "../app/_components/TimelineGrid.js";

function mkBlock(over: Partial<Block> = {}): Block {
  // minimální stub Block — pouze pole používaná v pasteTarget
  return {
    id: 1,
    machine: "XL_105",
    startTime: "2026-05-27T08:00:00.000Z",
    endTime: "2026-05-27T10:00:00.000Z",
    orderNumber: "TST-1",
    type: "ZAKAZKA",
    blockVariant: "STANDARD",
    locked: false,
    ...over,
  } as Block;
}

test("computePasteTargetFromBlock: stejný stroj + čas = endTime zarovnaný na 30min slot", () => {
  const b = mkBlock({ machine: "XL_106", endTime: "2026-05-27T10:00:00.000Z" });
  const t = computePasteTargetFromBlock(b);
  assert.equal(t.machine, "XL_106");
  assert.equal(t.time.toISOString(), "2026-05-27T10:00:00.000Z");
});

test("computePasteTargetFromBlock: endTime na 10:15 se zarovná na 10:30", () => {
  const b = mkBlock({ endTime: "2026-05-27T10:15:00.000Z" });
  const t = computePasteTargetFromBlock(b);
  assert.equal(t.time.toISOString(), "2026-05-27T10:30:00.000Z");
});

test("computePasteTargetFromBlock: endTime přesně na slotu se nezvětší", () => {
  const b = mkBlock({ endTime: "2026-05-27T10:30:00.000Z" });
  const t = computePasteTargetFromBlock(b);
  assert.equal(t.time.toISOString(), "2026-05-27T10:30:00.000Z");
});

test("computePasteTargetFromGroup: stroj = anchor (nejdříve startující) blok", () => {
  const a = mkBlock({ id: 1, machine: "XL_105", startTime: "2026-05-27T08:00:00.000Z", endTime: "2026-05-27T10:00:00.000Z" });
  const b = mkBlock({ id: 2, machine: "XL_106", startTime: "2026-05-27T09:00:00.000Z", endTime: "2026-05-27T11:00:00.000Z" });
  const t = computePasteTargetFromGroup([b, a]);
  assert.ok(t);
  assert.equal(t!.machine, "XL_105");
});

test("computePasteTargetFromGroup: čas = konec nejlatěji končícího bloku", () => {
  const a = mkBlock({ id: 1, startTime: "2026-05-27T08:00:00.000Z", endTime: "2026-05-27T10:00:00.000Z" });
  const b = mkBlock({ id: 2, startTime: "2026-05-27T09:00:00.000Z", endTime: "2026-05-27T11:30:00.000Z" });
  assert.equal(computePasteTargetFromGroup([a, b])!.time.toISOString(), "2026-05-27T11:30:00.000Z");
});

test("computePasteTargetFromGroup: prázdné pole vrátí null", () => {
  assert.equal(computePasteTargetFromGroup([]), null);
});
```

- [ ] **Step 1.3: Spustit nové testy a ověřit, že selžou (RED fáze)**

Run:
```bash
node --test --import tsx src/lib/pasteTarget.test.ts
```
Expected: 6/6 tests **PASS** (helper už existuje, je to čistá funkce — RED tady nemá smysl, krok přeskočit nelze, ale po Step 1.1 testy projdou hned).

- [ ] **Step 1.4: Přidat import helperů v `PlannerPage.tsx`**

V hlavičce importů `src/app/_components/PlannerPage.tsx` přidat:

```typescript
import { computePasteTargetFromBlock, computePasteTargetFromGroup } from "@/lib/pasteTarget";
```

- [ ] **Step 1.5: Upravit `handlePaste` — toast místo silent return**

`src/app/_components/PlannerPage.tsx`, najít řádek cca 2536:

```typescript
async function handlePaste() {
  const src = copiedBlockRef.current;
  const target = pasteTargetRef.current;
  if (!src) {
    showToast("Žádný blok není zkopírován. Nejdřív klikni na blok a Ctrl+C.", "info");
    return;
  }
  if (!target) {
    showToast("Klikni na timeline kde má být vložen, pak Ctrl+V.", "info");
    return;
  }
  // ... zbytek funkce beze změny ...
```

- [ ] **Step 1.6: Upravit `handleGroupPaste` — toast místo silent return**

`src/app/_components/PlannerPage.tsx`, najít řádek cca 2595:

```typescript
async function handleGroupPaste() {
  const group = clipboardGroupRef.current;
  const target = pasteTargetRef.current;
  if (group.length === 0) {
    showToast("Žádné bloky nejsou zkopírovány.", "info");
    return;
  }
  if (!target) {
    showToast("Klikni na timeline kde má být vložen, pak Ctrl+V.", "info");
    return;
  }
  // ... zbytek funkce beze změny ...
```

- [ ] **Step 1.7: Auto-set pasteTarget + toast po Ctrl+C (single)**

V keydown handleru `src/app/_components/PlannerPage.tsx` najít fallback větev pro single copy (kolem řádku 2751) a změnit:

```typescript
if (e.key === "c" && selectedBlock) {
  e.preventDefault();
  setCopiedBlock(selectedBlock);
  setIsCut(false);
  // Vyčistit group clipboard — single copy přebírá precedenci
  clipboardGroupRef.current = [];
  isGroupCutRef.current = false;
  // Auto-set pasteTarget za zdrojový blok, aby Ctrl+V hned fungoval
  setPasteTarget(computePasteTargetFromBlock(selectedBlock));
  showToast("Blok zkopírován. Ctrl+V vloží těsně za originál, nebo klikni jinam pro jiné místo.", "info");
}
if (e.key === "x" && selectedBlock) {
  e.preventDefault();
  setCopiedBlock(selectedBlock);
  setIsCut(true);
  clipboardGroupRef.current = [];
  isGroupCutRef.current = false;
  setPasteTarget(computePasteTargetFromBlock(selectedBlock));
  showToast("Blok vyříznut. Ctrl+V vloží těsně za originál.", "info");
}
```

- [ ] **Step 1.8: Auto-set pasteTarget + toast po Ctrl+C (group)**

V keydown handleru najít group copy větve (kolem řádku 2733):

```typescript
if (e.key === "c" && selectedBlockIdsRef.current.size > 0) {
  e.preventDefault();
  const group = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
  clipboardGroupRef.current = group;
  isGroupCutRef.current = false;
  const target = computePasteTargetFromGroup(group);
  if (target) setPasteTarget(target);
  showToast(`Zkopírováno ${group.length} bloků. Ctrl+V je vloží za poslední, nebo klikni jinam.`, "info");
  return;
}
if (e.key === "x" && selectedBlockIdsRef.current.size > 0) {
  e.preventDefault();
  const group = blocksRef.current.filter((b) => selectedBlockIdsRef.current.has(b.id));
  clipboardGroupRef.current = group;
  isGroupCutRef.current = true;
  const target = computePasteTargetFromGroup(group);
  if (target) setPasteTarget(target);
  showToast(`Vyříznuto ${group.length} bloků. Ctrl+V je vloží za poslední.`, "info");
  return;
}
```

- [ ] **Step 1.9: Upravit `onBlockCopy` prop (kontextové menu → Kopírovat)**

Najít řádek cca 3235:

```typescript
onBlockCopy={(block) => {
  setCopiedBlock(block);
  setIsCut(false);
  clipboardGroupRef.current = [];
  isGroupCutRef.current = false;
  setPasteTarget(computePasteTargetFromBlock(block));
  showToast("Blok zkopírován. Ctrl+V vloží za originál, nebo klikni jinam.", "info");
}}
```

- [ ] **Step 1.10: Build + lint**

Run:
```bash
npm run lint
npm run build
```
Expected: lint warnings same as before (žádné nové errors), build úspěšný.

- [ ] **Step 1.11: Manual smoke**

Testovat v lokálním devu (`npm run dev`, otevřít `/`):
1. Vybrat blok → Ctrl+C → ukáže se modrý info-toast "Blok zkopírován...". Hned Ctrl+V → blok se duplikuje těsně za zdroj.
2. Vybrat blok → Ctrl+C → kliknout do prázdna jinde → Ctrl+V → blok se vloží na kliknuté místo.
3. Vybrat blok → Ctrl+V (bez Ctrl+C) → toast "Žádný blok není zkopírován".
4. Multi-select 2 bloky (Shift+klik) → Ctrl+C → toast "Zkopírováno 2 bloků". Ctrl+V → vloží se za poslední.
5. Multi-select 2 bloky → Ctrl+C → Esc → klik na jeden blok → Ctrl+C → Ctrl+V → vloží se JEN ten jeden (regrese fix pro stale clipboardGroupRef).
6. Right-click na blok → Kopírovat → Ctrl+V → blok se duplikuje za originál.

- [ ] **Step 1.12: Commit**

```bash
git add src/lib/pasteTarget.ts src/lib/pasteTarget.test.ts src/app/_components/PlannerPage.tsx
git commit -m "fix(planner): copy/paste vždy nastaví target + toast feedback

Po Ctrl+C/X (single i group) i po right-click → Kopírovat se automaticky
nastaví pasteTarget na pozici za zdrojovým blokem, takže Ctrl+V hned funguje
bez nutnosti klikat do prázdného gridu. Pokud Ctrl+V přesto narazí na chybějící
target, ukáže se info-toast místo silent return. Single-block Ctrl+C nově
maže clipboardGroupRef, takže paste neutkví ve starém multi-stavu."
```

**STOP — čekat na Vojtovo OK před Task 2.**

---

## Task 2: Vizuální indikátor `pasteTarget` v timeline

**Cíl:** Uživatel vidí přesně kam se vloží blok. Tenká přerušovaná modrá čára (3px outline-style) ve sloupci cílového stroje na pozici `pasteTarget.time`, s malou ikonou ⎘ na levém okraji. Marker je výrazný jen když je clipboard plný.

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (předat 2 nové prop)
- Modify: `src/app/_components/TimelineGrid.tsx` (přidat prop, render markeru)

### Steps

- [ ] **Step 2.1: Rozšířit `TimelineGridProps` o `pasteTarget` a `clipboardHasContent`**

V `src/app/_components/TimelineGrid.tsx` na řádku 203 (`interface TimelineGridProps`) přidat:

```typescript
  pasteTarget?: { machine: string; time: Date } | null;
  clipboardHasContent?: boolean;
```

- [ ] **Step 2.2: Destrukturovat nové props v default exportu**

Na řádku cca 1946 (`export default function TimelineGrid({`) přidat:

```typescript
  pasteTarget,
  clipboardHasContent,
```

- [ ] **Step 2.3: Vykreslit marker uvnitř sloupce stroje**

V `TimelineGrid.tsx` najít smyčku přes `machineBlocks.map((block) => { ... })` (řádek cca 3164), a **před** ní vložit marker:

```tsx
{/* ── Paste target marker ─────────────────────────────────── */}
{pasteTarget && pasteTarget.machine === machine && viewStart && (() => {
  const top = dateToY(pasteTarget.time, viewStart, slotHeight);
  return (
    <div
      style={{
        position: "absolute",
        top: top - 1,
        left: 0,
        right: 0,
        height: 0,
        borderTop: clipboardHasContent
          ? "2px dashed rgba(59,130,246,0.85)"
          : "2px dashed rgba(59,130,246,0.35)",
        pointerEvents: "none",
        zIndex: 7,
      }}
      data-paste-marker
    >
      <div
        style={{
          position: "absolute",
          left: 4,
          top: -9,
          padding: "1px 5px",
          fontSize: 9,
          fontWeight: 700,
          color: "#fff",
          background: clipboardHasContent ? "rgba(59,130,246,0.9)" : "rgba(59,130,246,0.45)",
          borderRadius: 4,
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
        }}
      >
        ⎘ Sem (Ctrl+V)
      </div>
    </div>
  );
})()}
```

- [ ] **Step 2.4: Předat nové props z `PlannerPage`**

V `src/app/_components/PlannerPage.tsx` ve volání `<TimelineGrid ...>` (řádek cca 3218) přidat:

```tsx
  pasteTarget={pasteTarget}
  clipboardHasContent={!!copiedBlock || clipboardGroupRef.current.length > 0}
```

Pozn.: `clipboardGroupRef.current.length` zde čteme přímo z refu, protože ref se mění mimo render. To je OK, protože při Ctrl+C/X **také** voláme `setCopiedBlock` nebo `setPasteTarget`, což vždy vyvolá re-render — takže výraz se přepočítá.

- [ ] **Step 2.5: Build + lint**

Run:
```bash
npm run lint
npm run build
```
Expected: success.

- [ ] **Step 2.6: Manual smoke**

1. Vybrat blok → Ctrl+C → ve sloupci stroje se hned objeví modrá přerušovaná čára s popiskem „⎘ Sem (Ctrl+V)" pod zdrojovým blokem.
2. Kliknout do prázdna jinde → marker se přesune na nové místo.
3. Klikat na jiný blok → marker zůstává (pasteTarget se nemění klikem na blok).
4. Ctrl+V → blok se duplikuje **na pozici markeru**.
5. Bez kopírovaného obsahu marker neexistuje.
6. Multi-select → Ctrl+C → marker je ve sloupci anchor stroje na pozici za posledním blokem.

- [ ] **Step 2.7: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(planner): vizuální marker paste targetu v timeline

Po Ctrl+C / right-click → Kopírovat se v sloupci cílového stroje vykreslí
přerušovaná modrá čára s popiskem ⎘ Sem (Ctrl+V) na pozici kam se blok vloží.
Marker se přesouvá při kliknutí do prázdna. Bez aktivního clipboardu se
nezobrazuje."
```

**STOP — čekat na Vojtovo OK před Task 3.**

---

## Task 3: Kontextové menu „Vložit zde" na prázdném gridu

**Cíl:** Pravým klikem na prázdné místo v timeline se zobrazí menu s položkou „⎘ Vložit zde" (jen pokud je clipboard plný). Kliknutí nastaví pasteTarget na pozici kurzoru a hned spustí paste — kompletně mouse-only workflow.

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`
- Modify: `src/app/_components/PlannerPage.tsx` (přidat nový prop `onPasteHere`)

### Steps

- [ ] **Step 3.1: Přidat `onPasteHere` prop do `TimelineGridProps`**

V `src/app/_components/TimelineGrid.tsx` na řádku 203:

```typescript
  onPasteHere?: (machine: string, time: Date) => void;
```

- [ ] **Step 3.2: Destrukturovat prop v default exportu**

Na řádku cca 1946:

```typescript
  onPasteHere,
```

- [ ] **Step 3.3: Wrapnout sloupec stroje do `ContextMenu`**

V `TimelineGrid.tsx` najít `<div ref={(el) => { colRefs.current[colIdx] = el; }} ...>` na řádku cca 3023.

Důležité: ContextMenu musí být **uvnitř** sloupce, ne kolem celého gridu, aby pravý klik na blok nadále otevíral block-context menu (které již existuje na BlockCard). Také trigger musí být `asChild`, aby nezasahoval do layoutu.

Změna:

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <div
      ref={(el) => { colRefs.current[colIdx] = el; }}
      style={{ flex: 1, position: "relative", overflow: "hidden", minWidth: 0, backgroundColor: "var(--timeline-bg)" }}
      onMouseDown={canEdit ? (e) => { /* ... beze změny ... */ } : undefined}
      onClick={(e) => { /* ... beze změny ... */ }}
      onContextMenu={(e: React.MouseEvent) => {
        // Pokud je pravý klik nad blokem, blockový ContextMenu má precedenci.
        // Tady jen zapamatujeme klik souřadnice pro výpočet času v "Vložit zde".
        if ((e.target as HTMLElement).closest("[data-block]")) return;
        ctxGridMouseRef.current = { x: e.clientX, y: e.clientY };
      }}
    >
      {/* ... celý obsah sloupce beze změny: marker, bloky, atd. ... */}
    </div>
  </ContextMenuTrigger>
  <ContextMenuContent
    style={{ background: "#1c1c1e", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 4, minWidth: 180, zIndex: 500 }}
    onClick={(e) => e.stopPropagation()}
  >
    {clipboardHasContent ? (
      <ContextMenuItem
        onClick={() => {
          const pos = ctxGridMouseRef.current;
          const el = scrollRef.current;
          const vs = viewStartRef.current;
          if (!pos || !el || !vs || !onPasteHere) return;
          const rect = el.getBoundingClientRect();
          const timelineY = pos.y - rect.top + el.scrollTop;
          const snappedTime = snapToSlot(yToDate(timelineY, vs, slotHeight));
          onPasteHere(machine, snappedTime);
        }}
        style={{ ...menuItemStyleEmpty }}
      >
        ⎘ Vložit zde
      </ContextMenuItem>
    ) : (
      <ContextMenuItem disabled style={{ ...menuItemStyleEmpty, color: "rgba(255,255,255,0.4)" }}>
        Žádný blok není zkopírován
      </ContextMenuItem>
    )}
  </ContextMenuContent>
</ContextMenu>
```

- [ ] **Step 3.4: Přidat `ctxGridMouseRef` a `menuItemStyleEmpty` v `TimelineGrid`**

Uvnitř default exportu `TimelineGrid` přidat (poblíž jiných refů, řádek cca 1990):

```typescript
const ctxGridMouseRef = useRef<{ x: number; y: number } | null>(null);
const menuItemStyleEmpty: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 10px",
  borderRadius: 6,
  color: "rgba(255,255,255,0.92)",
  cursor: "pointer",
  outline: "none",
};
```

(Pokud už existuje analogický `menuItemStyle` pro BlockCard, můžeme ho reuse-nout. Jen pozor — `menuItemStyle` v BlockCard je definovaný uvnitř funkce `BlockCard`, není v scope `TimelineGrid`. Proto si tady definujeme vlastní `menuItemStyleEmpty`.)

- [ ] **Step 3.5: Implementovat `onPasteHere` v `PlannerPage`**

V `src/app/_components/PlannerPage.tsx` přidat handler (poblíž `handlePaste`):

```typescript
function handlePasteHere(machine: string, time: Date) {
  // Nastavit pasteTarget a okamžitě paste — group má precedenci jako v keydown handleru
  setPasteTarget({ machine, time });
  // Důležité: setPasteTarget je async; čekáme na další render přes mikro-task.
  // Použijeme přímo refs (které updatujeme synchronně v render bodyy) — tady ale
  // ref ještě neupdatujeme. Proto pošleme target přímo:
  const targetOverride = { machine, time };
  if (clipboardGroupRef.current.length > 0) {
    void handleGroupPasteWithTarget(targetOverride);
  } else if (copiedBlockRef.current) {
    void handlePasteWithTarget(targetOverride);
  } else {
    showToast("Žádný blok není zkopírován. Nejdřív klikni na blok a Ctrl+C.", "info");
  }
}
```

A přidat overloady, které přijímají target přímo (aby se obešel async state):

```typescript
async function handlePasteWithTarget(target: { machine: string; time: Date }) {
  const src = copiedBlockRef.current;
  if (!src) return;
  // ... celé tělo `handlePaste` ale s `target` parametrem místo `pasteTargetRef.current` ...
}

async function handleGroupPasteWithTarget(target: { machine: string; time: Date }) {
  const group = clipboardGroupRef.current;
  if (group.length === 0) return;
  // ... celé tělo `handleGroupPaste` ale s `target` parametrem ...
}
```

**Implementační poznámka:** Aby se neduplikoval kód, refactor:
1. Vyextrahuj tělo `handlePaste` do `handlePasteWithTarget(target)`.
2. Původní `handlePaste()` se zredukuje na: pokud chybí target → toast; jinak `await handlePasteWithTarget(pasteTargetRef.current!)`.
3. Stejně pro group.

Konkrétní extract pro `handlePaste` (řádek 2536):

```typescript
async function handlePasteWithTarget(target: { machine: string; time: Date }) {
  const src = copiedBlockRef.current;
  if (!src) return;
  const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
  const rawStart = target.time;
  const newStart = workingTimeLockRef.current
    ? snapToNextValidStartWithTemplates(target.machine, rawStart, durationMs, machineWeekShifts)
    : rawStart;
  const newEnd = new Date(newStart.getTime() + durationMs);
  try {
    const res = await fetch("/api/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNumber: src.orderNumber,
        machine: target.machine,
        type: src.type,
        blockVariant: src.blockVariant,
        jobPresetId: src.jobPresetId,
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
        description: src.description,
        locked: false,
        deadlineExpedice: src.deadlineExpedice,
        dataStatusId: src.dataStatusId,
        dataStatusLabel: src.dataStatusLabel,
        dataRequiredDate: src.dataRequiredDate,
        dataOk: src.dataOk,
        materialStatusId: src.materialStatusId,
        materialStatusLabel: src.materialStatusLabel,
        materialRequiredDate: src.materialRequiredDate,
        materialOk: src.materialOk,
        barvyStatusId: src.barvyStatusId,
        barvyStatusLabel: src.barvyStatusLabel,
        lakStatusId: src.lakStatusId,
        lakStatusLabel: src.lakStatusLabel,
        specifikace: src.specifikace,
        bypassScheduleValidation: !workingTimeLockRef.current,
        bypassOverlapCheck: true,
      }),
    });
    if (!res.ok) throw new Error();
    const newBlock: Block = await res.json();
    handleBlockCreate(newBlock);
    await autoResolveOverlap(newBlock, new Set([newBlock.id]), undefined, true);
    if (isCutRef.current) {
      await fetch(`/api/blocks/${src.id}`, { method: "DELETE" });
      setBlocks((prev) => prev.filter((b) => b.id !== src.id));
      setSelectedBlock((sel) => (sel?.id === src.id ? null : sel));
      setCopiedBlock(null);
      setIsCut(false);
    }
  } catch (error) {
    console.error("Block paste failed", error);
    showToast("Chyba při vložení bloku.", "error");
  }
}

async function handlePaste() {
  if (!copiedBlockRef.current) {
    showToast("Žádný blok není zkopírován. Nejdřív klikni na blok a Ctrl+C.", "info");
    return;
  }
  if (!pasteTargetRef.current) {
    showToast("Klikni na timeline kde má být vložen, pak Ctrl+V.", "info");
    return;
  }
  await handlePasteWithTarget(pasteTargetRef.current);
}
```

A obdobně pro `handleGroupPaste` → vyextrahuj `handleGroupPasteWithTarget(target)`. Tělo je velké (~95 řádků), zkopíruj 1:1 a nahrad `pasteTargetRef.current` → `target`.

- [ ] **Step 3.6: Předat `onPasteHere` z `PlannerPage` do `TimelineGrid`**

V `<TimelineGrid ...>`:

```tsx
  onPasteHere={handlePasteHere}
```

- [ ] **Step 3.7: Ověřit, že block-level ContextMenu má precedenci**

V `src/app/_components/TimelineGrid.tsx` zkontroluj řádky kolem 1810-1820 (block ContextMenuTrigger): používá `asChild` a je uvnitř blockové vrstvy. Radix má built-in event propagation — pokud je vnitřní ContextMenuTrigger aktivovaný, vnější se nespouští. Stačí naše `onContextMenu` v grid sloupci přidat guard `if (closest("[data-block]")) return;` (už je v plánu v Step 3.3).

- [ ] **Step 3.8: Build + lint**

```bash
npm run lint
npm run build
```
Expected: success.

- [ ] **Step 3.9: Manual smoke**

1. Zkopíruj blok (Ctrl+C) → pravý klik na prázdné místo → menu „⎘ Vložit zde" → klik → blok se vloží přesně na klik pozici.
2. Pravý klik na prázdno bez kopírovaného obsahu → menu „Žádný blok není zkopírován" (disabled).
3. Pravý klik **na blok** → otevře se původní block menu (Stav zakázky, Kopírovat, …), NE grid menu.
4. Multi-select + Ctrl+C → pravý klik na prázdno → „⎘ Vložit zde" → vloží se celá skupina s anchor na klik pozici.
5. Pokud je clipboard z cut (Ctrl+X), po „Vložit zde" se originály smažou.

- [ ] **Step 3.10: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(planner): pravý klik na prázdný grid nabízí Vložit zde

Mouse-only workflow: po Ctrl+C / Kopírovat z bloku stačí pravý klik kamkoli
do timeline a vybrat Vložit zde. Položka je disabled když není nic zkopírováno.
Block-level kontextové menu zachovává precedenci díky data-block guard."
```

**STOP — čekat na Vojtovo OK před Task 4.**

---

## Task 4: Odstranit `[selectedBlock]` dep z keydown handleru

**Cíl:** Keydown handler bude bindovaný **jednou** na mount, ne re-bindovaný při každé změně `selectedBlock`. Tím odpadnou drobné výpadky v okamžiku přepnutí výběru a při SSE updatech vybraného bloku. Pomocí `selectedBlockRef` zachováme aktuální hodnotu uvnitř handleru.

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

### Steps

- [ ] **Step 4.1: Přidat `selectedBlockRef`**

V `src/app/_components/PlannerPage.tsx` blízko ostatních refů (řádek cca 656):

```typescript
const selectedBlockRef = useRef<Block | null>(null);
selectedBlockRef.current = selectedBlock;
```

- [ ] **Step 4.2: Nahradit přímé použití `selectedBlock` v keydown handleru ref-em**

V keydown `useEffect` (řádek cca 2693) najít všechny výskyty `selectedBlock` uvnitř handleru a nahradit za `selectedBlockRef.current`:

Konkrétně:
- `if ((e.key === "Delete" || e.key === "Backspace") && selectedBlock)` → `selectedBlockRef.current`
- `if (e.key === "c" && selectedBlock)` → `selectedBlockRef.current` (uvnitř `setCopiedBlock(selectedBlockRef.current)`, `setPasteTarget(computePasteTargetFromBlock(selectedBlockRef.current))`)
- `if (e.key === "x" && selectedBlock)` → dtto

- [ ] **Step 4.3: Změnit dep array na `[]`**

```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => { ... };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, []); // ← bind jen jednou na mount
```

Pozn.: `// eslint-disable-line react-hooks/exhaustive-deps` zachovat — všechny závislosti jsou refy, takže pravidlo by stejně chtělo `[]`, ale eslint někdy hlučí.

- [ ] **Step 4.4: Build + lint**

```bash
npm run lint
npm run build
```
Expected: success.

- [ ] **Step 4.5: Manual smoke — všechny klávesy stále fungují**

1. Ctrl+C / Ctrl+V — single block ✓
2. Ctrl+C / Ctrl+V — multi-select ✓
3. Ctrl+X / Ctrl+V — single i multi ✓
4. Esc — vyčistí selectedBlockIds ✓
5. Delete / Backspace — smaže vybraný blok (s confirmation) ✓
6. Ctrl+Z / Ctrl+Y — undo/redo ✓
7. Vybrat blok, počkat 5+ minut (polling fetch), zkusit Ctrl+C — funguje hned bez výpadku ✓
8. SSE: pokud možno simulovat (jiný uživatel mění blok), zkusit kopírovat v okamžiku updatu — funguje ✓

- [ ] **Step 4.6: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "refactor(planner): keydown handler bind jen jednou, selectedBlock přes ref

Předtím se handler re-bindoval při každé změně selectedBlock (vč. SSE updatu
vybraného bloku a 5min polling refreshe). V drobném okně mezi unbind a rebind
mohly stisky kláves padnout do prázdna. Teď handler žije od mountu do unmountu,
hodnotu selectedBlock čte přes selectedBlockRef."
```

**STOP — čekat na Vojtovo OK před Task 5.**

---

## Task 5: Závěrečný integrační test + dokumentace

**Cíl:** Ověřit, že komplet flow funguje, a aktualizovat repo-truth (CLAUDE.md) o nové chování.

### Steps

- [ ] **Step 5.1: End-to-end manuální checklist**

V devu (`npm run dev`) jako role ADMIN/PLANOVAT:

1. **Klávesnice happy path:** vybrat blok → Ctrl+C → toast „Blok zkopírován" → vidět marker → Ctrl+V → duplicate.
2. **Myš happy path:** right-click blok → Kopírovat → toast → marker → right-click prázdno → Vložit zde → duplicate na pozici.
3. **Žádný target:** Ctrl+V hned po Ctrl+C **funguje** (auto-target).
4. **Bez clipboardu:** Ctrl+V → toast „Žádný blok není zkopírován".
5. **Multi-select group copy:** Shift+klik 3 bloky → Ctrl+C → toast „Zkopírováno 3" → Ctrl+V → 3 bloky vloženy za posledním.
6. **Multi→single switch:** multi-select + Ctrl+C → Esc → klik na 1 blok → Ctrl+C → Ctrl+V → vloží JEN ten 1 (žádný stale group).
7. **Cut:** Ctrl+X → marker → Ctrl+V → originál smazán, kopie vložena.
8. **Re-target:** Ctrl+C → kliknout do prázdna jinde → marker se přesune → Ctrl+V vloží tam.
9. **Edit popover otevřen:** vybrat blok, dvojklik → BlockEdit dialog → uvnitř input, psát text, Ctrl+C v inputu → kopíruje TEXT (browser native), NE block (správně).
10. **Notes dialog otevřen:** otevřít poznámky tiskaře → Esc → dialog se zavře, NE planner výběr.
11. **Žádné console errors** ve VS Code devtools.

- [ ] **Step 5.2: Aktualizovat CLAUDE.md**

V `src/app/_components/CLAUDE.md` nebo `CLAUDE.md` (root) doplnit do sekce „Klíčové soubory — planner" odstavec:

```markdown
### Copy/Paste flow (aktualizováno 2026-05-27)

- Ctrl+C / Ctrl+X / right-click → Kopírovat **automaticky nastavují pasteTarget** na pozici za zdrojovým blokem (helper `src/lib/pasteTarget.ts`).
- Ctrl+V validuje `copiedBlockRef.current` (nebo `clipboardGroupRef.current`) i `pasteTargetRef.current` — chyběné stavy vedou na info-toast místo silent return.
- Vizuální marker pasteTargetu se kreslí v `TimelineGrid` jako přerušovaná modrá čára.
- Pravý klik na prázdný grid nabízí „Vložit zde" (jen pokud je clipboard plný).
- Keydown handler je bindovaný jednou na mount (`useEffect([])`); hodnotu `selectedBlock` čte přes `selectedBlockRef`.
```

- [ ] **Step 5.3: Spustit kompletní test suite**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --test --import tsx src/lib/pasteTarget.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```
Expected: 24+6 = **30/30 tests pass**.

- [ ] **Step 5.4: Final build**

```bash
npm run lint && npm run build
```
Expected: build úspěšný, lint warnings same as before.

- [ ] **Step 5.5: Commit dokumentaci**

```bash
git add CLAUDE.md
git commit -m "docs: copy/paste flow po 2026-05-27 UX fixu"
```

- [ ] **Step 5.6: Volitelně deploy**

Pokud Vojta souhlasí, podle `docs/DEPLOY_WORKFLOW.md` provést deploy na produkční server:
1. SSH na 192.168.10.210
2. `sudo mysqldump igvyroba > backup_$(date +%Y%m%d_%H%M%S).sql` ([feedback_prod_backup_first.md](../../../../.claude/projects/-Users-vojtatokan-Desktop-IG-projekty/memory/feedback_prod_backup_first.md))
3. `cd /var/www/igvyroba && git pull && npm ci && npm run build && pm2 restart all`

**Žádné DB migrace v tomto plánu** — schema beze změny.

---

## Self-Review

**Spec coverage** vs konverzační audit:

| Audit FIX | Pokrytí v plánu |
|---|---|
| FIX 1 (toast feedback + auto-target) | Task 1 (Steps 1.5–1.9) |
| FIX 2 (vizuální marker) | Task 2 |
| FIX 3 (context menu „Vložit zde") | Task 3 |
| FIX 4 (clear stale clipboardGroup při single copy) | Task 1 (Steps 1.7, 1.9) |
| FIX 5 (odstranit `[selectedBlock]` dep) | Task 4 |

Všech 5 fixů pokryto. ✅

**Placeholders:** Žádné „TBD" ani „add appropriate error handling". Každý step má konkrétní kód.

**Type consistency:**
- `computePasteTargetFromBlock` vrací `{ machine: string; time: Date }` — totožné s `pasteTarget` state v PlannerPage.
- `handlePasteWithTarget(target)` parametr má stejný shape jako return helperu.
- `onPasteHere(machine, time)` callback signatura konzistentní s `onGridClick`.

**Pozn. k dependencies:** `superpowers:using-git-worktrees` skill: pokud Vojta chce, lze celý plán izolovat do worktree. Není ale nutné — změny jsou aditivní, mimo hot-path, dají se kdykoli rollnout zpět revert commitem.

---

## Execution Handoff

Plán je hotov a uložen v `docs/superpowers/plans/2026-05-27-copy-paste-ux-fix.md`. Dvě možnosti spuštění:

1. **Subagent-Driven** (doporučeno) — pro každý Task dispatchnu samostatný subagent, ty mezi Tasky reviewuješ. Rychlá iterace s checkpoints.
2. **Inline Execution** — Tasky provedu v této session přes executing-plans skill, batched s checkpointy.

Která varianta?
