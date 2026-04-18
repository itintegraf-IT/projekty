# Block Lock — Skip & Visual Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zamknuté bloky se vizuálně odliší (amber pruh na bloku + overlay v TIME sloupci) a push chain je přeskočí místo revertu celé operace. Undo vrátí celou operaci atomicky.

**Architecture:** Změny jsou čistě na klientu — 3 soubory (PlannerPage.tsx, TimelineGrid.tsx, BlockEdit.tsx). Žádné DB migrace ani API změny. Pole `locked` na Block modelu už existuje. Logika `autoResolveOverlap` se přepíše z "revert on locked" na "skip locked", a undo se rozšíří na celý chain.

**Tech Stack:** React, TypeScript, Lucide icons, Next.js

**DŮLEŽITÉ:** Nevytvářet worktree, nepushovat na git, necommitovat automaticky.

---

## File Map

| Soubor | Změna |
|--------|-------|
| `src/app/_components/PlannerPage.tsx` | Přepsat `autoResolveOverlap` (skip locked), přidat undo akumulátor do `handleBlockUpdate` |
| `src/app/_components/TimelineGrid.tsx` | Amber pruh na bloku (BlockCard), amber overlay v TIME sloupci |
| `src/components/BlockEdit.tsx` | Skrýt lock switch pokud `!canEdit` |

---

### Task 1: Vizuální indikace na bloku — amber levý pruh

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:998-999` (levý accentBar)

Tato změna nahradí 3px accentBar širším amber pruhem s ikonou zámku na zamknutých blocích. Platí pro všechny 3 renderovací módy.

- [ ] **Step 1: Najít levý accentBar (řádek 998) a nahradit podmíněným renderem**

V souboru `src/app/_components/TimelineGrid.tsx`, řádek 998–999, nahradit:

```tsx
{/* Levý barevný pruh — iOS Calendar style */}
<div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />
```

za:

```tsx
{/* Levý barevný pruh — iOS Calendar style / amber lock strip */}
{block.locked ? (
  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 22, background: "rgba(251,191,36,0.25)", borderRadius: "7px 0 0 7px", borderRight: "1px solid rgba(251,191,36,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
    <Lock size={11} strokeWidth={2} color="rgba(251,191,36,0.9)" />
  </div>
) : (
  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />
)}
```

- [ ] **Step 2: Upravit border a box-shadow zamknutého bloku**

V souboru `src/app/_components/TimelineGrid.tsx`, ve stylu wrapper divu bloku (kolem řádku 975–996 — `<div data-block ...>`), přidat podmíněný border a box-shadow. Najít property `border` v inline stylu bloku a rozšířit:

Aktuální border je na řádku ~985:
```tsx
border: `1px solid ${s.border}`,
```

Nahradit za:
```tsx
border: block.locked ? "1px solid rgba(251,191,36,0.4)" : `1px solid ${s.border}`,
boxShadow: block.locked
  ? `${isSelected ? `0 0 0 2px ${s.glow}` : "none"}, 0 0 0 1px rgba(251,191,36,0.2)`
  : isSelected ? `0 0 0 2px ${s.glow}` : "none",
```

- [ ] **Step 3: Přidat left padding pro obsah zamknutých bloků**

Obsah bloku (datum chipy, orderNumber atd.) potřebuje extra left padding, aby se nepřekrýval se širokým amber pruhem. Najít padding wrapper divů pro MODE_COMPACT (řádek ~1005), MODE_TINY (řádek ~1125) a MODE_FULL (řádek ~1211).

V každém z nich přidat podmíněný `paddingLeft`:

Pro MODE_COMPACT div (řádek ~1023, první datum řádek):
```tsx
padding: `2px ${block.locked ? "9px 2px 28px" : "9px 2px 9px"}`,
```

Pro MODE_TINY div (řádek ~1125):
```tsx
padding: `0 8px 0 ${block.locked ? "28px" : "8px"}`,
```

Pro MODE_FULL první div (řádek ~1211, padding "5px 9px 3px"):
```tsx
padding: `5px 9px 3px ${block.locked ? "28px" : "9px"}`,
```

- [ ] **Step 4: Ověřit vizuálně v prohlížeči**

Run: `npm run dev`

Otevřít planner, najít/vytvořit zamknutý blok (v BlockEdit zapnout switch "Zamčený blok"). Ověřit:
- Amber pruh ~22px na levé straně s ikonou zámku
- Amber border kolem celého bloku
- Text se nepřekrývá s pruhem
- Funguje ve všech 3 módech (FULL, COMPACT, TINY — závisí na výšce bloku/zoomu)

---

### Task 2: Amber overlay v TIME sloupci

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:2466-2524` (levý TIME sloupec) a `2532-2562` (mezistrojový TIME sloupec)

Pro každý zamknutý blok na daném stroji se v příslušném TIME sloupci vykreslí amber overlay.

- [ ] **Step 1: Vytvořit helper pro filtrování zamknutých bloků per machine**

V souboru `src/app/_components/TimelineGrid.tsx`, před `return` statement (kolem řádku 2404), přidat:

```tsx
// Zamknuté bloky per machine pro TIME sloupec overlay
const lockedBlocksByMachine = new Map<string, Block[]>();
for (const machine of visibleMachines) {
  lockedBlocksByMachine.set(machine, blocks.filter(b => b.locked && b.machine === machine));
}
```

- [ ] **Step 2: Přidat amber overlay do levého TIME sloupce (colIdx === 0)**

V souboru `src/app/_components/TimelineGrid.tsx`, v levém TIME sloupci (řádek 2467–2524), za `companyDays` overlay a před `halfHourMarkers`, přidat:

```tsx
{/* Lock overlay — amber indikátor zamknutých bloků */}
{viewStart && (lockedBlocksByMachine.get(visibleMachines[0]) ?? []).map((lb) => {
  const totalH = totalDays * dayHeight;
  const top = dateToY(new Date(lb.startTime), viewStart, slotHeight);
  const bottom = dateToY(new Date(lb.endTime), viewStart, slotHeight);
  const clampedTop = Math.max(0, Math.min(top, totalH));
  const clampedBottom = Math.max(0, Math.min(bottom, totalH));
  const h = clampedBottom - clampedTop;
  if (h <= 0) return null;
  const startD = new Date(lb.startTime);
  const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
  return (
    <div key={`lock-t0-${lb.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(251,191,36,0.08)", borderTop: "1px solid rgba(251,191,36,0.25)", borderBottom: "1px solid rgba(251,191,36,0.25)", pointerEvents: "none", overflow: "hidden" }}>
      {h >= 16 && (
        <div style={{ position: "absolute", top: 3, left: 6, display: "flex", alignItems: "center", gap: 2 }}>
          <Lock size={8} strokeWidth={2.5} color="rgba(251,191,36,0.9)" />
          <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(251,191,36,0.9)", letterSpacing: "0.03em" }}>{timeStr}</span>
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 3: Přidat amber overlay do mezistrojového TIME sloupce (colIdx > 0)**

V souboru `src/app/_components/TimelineGrid.tsx`, v mezistrojovém TIME sloupci (řádek ~2532–2562, uvnitř `colIdx > 0` bloku), za `halfHourMarkers` a před zavírací `</div>`, přidat:

```tsx
{/* Lock overlay — amber indikátor zamknutých bloků (druhý stroj) */}
{viewStart && (lockedBlocksByMachine.get(visibleMachines[colIdx]) ?? []).map((lb) => {
  const totalH = totalDays * dayHeight;
  const top = dateToY(new Date(lb.startTime), viewStart, slotHeight);
  const bottom = dateToY(new Date(lb.endTime), viewStart, slotHeight);
  const clampedTop = Math.max(0, Math.min(top, totalH));
  const clampedBottom = Math.max(0, Math.min(bottom, totalH));
  const h = clampedBottom - clampedTop;
  if (h <= 0) return null;
  const startD = new Date(lb.startTime);
  const timeStr = startD.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
  return (
    <div key={`lock-t${colIdx}-${lb.id}`} style={{ position: "absolute", top: clampedTop, height: h, left: 0, right: 0, background: "rgba(251,191,36,0.08)", borderTop: "1px solid rgba(251,191,36,0.25)", borderBottom: "1px solid rgba(251,191,36,0.25)", pointerEvents: "none", overflow: "hidden" }}>
      {h >= 16 && (
        <div style={{ position: "absolute", top: 3, left: 0, right: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <Lock size={8} strokeWidth={2.5} color="rgba(251,191,36,0.9)" />
          <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(251,191,36,0.9)", letterSpacing: "0.03em" }}>{timeStr}</span>
        </div>
      )}
    </div>
  );
})}
```

- [ ] **Step 4: Ověřit vizuálně v prohlížeči**

Otevřít planner s zamknutým blokem. Ověřit:
- Amber overlay v TIME sloupci na správné vertikální pozici
- Ikona zámku + čas startu viditelný
- Overlay se zobrazuje ve správném TIME sloupci (levý = XL_105, pravý = XL_106)
- Overlay neblokuje lasso selection (pointerEvents: none)
- Při scrollu se overlay správně pohybuje s timeline

---

### Task 3: Push chain — přeskakování zamknutých bloků

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:1198-1321` (funkce `autoResolveOverlap`, krok 2)

Toto je klíčová logická změna. Celý krok 2 (forward overlap → auto-push) se přepíše tak, aby zamknuté bloky přeskakoval místo revertu.

- [ ] **Step 1: Přepsat krok 2 v `autoResolveOverlap`**

V souboru `src/app/_components/PlannerPage.tsx`, nahradit celý blok od řádku 1198 ("Krok 2: Překryv dopředu") až po řádek 1321 (konec try/catch):

```tsx
    // ── Krok 2: Překryv dopředu → auto-push (skip locked) ────────────────────
    const curEnd   = new Date(current.endTime).getTime();
    const curStart = new Date(current.startTime).getTime();

    // Najít všechny bloky na stejném stroji, seřazené podle startTime
    const candidates = sameMachine
      .filter(b => new Date(b.startTime).getTime() >= curStart)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    if (candidates.length === 0) return "resolved";

    // Stavíme chain bloků k posunu — zamknuté přeskakujeme
    const chain: Block[] = [];
    const chainPositions: { id: number; newStart: number; newEnd: number }[] = [];
    let pEnd = curEnd; // "kurzor" — konec posledního umístěného bloku

    for (let i = 0; i < 200; i++) {
      // Najít blok, jehož aktuální startTime < pEnd (koliduje)
      const next = candidates.find(b =>
        !chain.find(c => c.id === b.id) &&
        !excludeIds.has(b.id) &&
        new Date(b.startTime).getTime() < pEnd &&
        new Date(b.endTime).getTime() > curStart
      );
      if (!next) break;

      if (next.locked) {
        // Přeskočit zamknutý blok — posunout kurzor za jeho konec
        const lockedEnd = new Date(next.endTime).getTime();
        if (lockedEnd > pEnd) pEnd = lockedEnd;
        continue;
      }

      // Nezamknutý blok — přidat do chainu
      chain.push(next);
      const dur = new Date(next.endTime).getTime() - new Date(next.startTime).getTime();
      let ns = new Date(pEnd);
      if (workingTimeLockRef.current) {
        ns = snapToNextValidStartWithTemplates(next.machine, ns, dur, machineWorkHoursTemplates, machineExceptions);
      }
      // Ověřit, že nová pozice nekoliduje s locked blokem
      let nsMs = ns.getTime();
      let nsEnd = nsMs + dur;
      const lockedOnMachine = sameMachine.filter(b => b.locked);
      let safetyCounter = 0;
      while (safetyCounter < 50) {
        const lockedHit = lockedOnMachine.find(l =>
          new Date(l.startTime).getTime() < nsEnd && new Date(l.endTime).getTime() > nsMs
        );
        if (!lockedHit) break;
        // Přeskočit locked blok
        const afterLocked = new Date(lockedHit.endTime).getTime();
        let snapped = new Date(afterLocked);
        if (workingTimeLockRef.current) {
          snapped = snapToNextValidStartWithTemplates(next.machine, snapped, dur, machineWorkHoursTemplates, machineExceptions);
        }
        nsMs = snapped.getTime();
        nsEnd = nsMs + dur;
        safetyCounter++;
      }

      chainPositions.push({ id: next.id, newStart: nsMs, newEnd: nsEnd });
      pEnd = nsEnd;
    }

    if (chain.length === 0) return "resolved";

    // Uložit chain přes batch API
    try {
      const batchUpdates = chain.map((b, idx) => ({
        id: b.id,
        startTime: new Date(chainPositions[idx].newStart).toISOString(),
        endTime: new Date(chainPositions[idx].newEnd).toISOString(),
        machine: b.machine,
      }));

      const batchRes = await fetch("/api/blocks/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          updates: batchUpdates,
          bypassScheduleValidation: !workingTimeLockRef.current,
          bypassOverlapCheck: true,
        }),
      });

      if (!batchRes.ok) {
        const err = await batchRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Chain push batch HTTP ${batchRes.status}`);
      }

      const results: Block[] = await batchRes.json();
      setBlocks(prev => prev.map(b => results.find(r => r.id === b.id) ?? b));

      // Rekurzivně vyřešit překryv posledního bloku chainu
      const allExcluded = new Set([...Array.from(excludeIds), ...chain.map(b => b.id)]);
      const lastResult = results[results.length - 1];
      if (lastResult) await autoResolveOverlap(lastResult, allExcluded);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Nepodařilo se automaticky posunout navazující bloky.";
      showToast(msg, "error");
      await revertMovedBlock();
      return "failed";
    }
```

- [ ] **Step 2: Odstranit `pushSuggestion` pro locked bloky**

V souboru `src/app/_components/PlannerPage.tsx`, v nové verzi `autoResolveOverlap` se `setPushSuggestion` s `blockedByLock: true` už nevolá (locked bloky se přeskakují). Ověřit, že se `pushSuggestion` UI neobjevuje pro locked bloky — nezamknuté bloky nadále nemají pushSuggestion (to neexistovalo ani předtím).

Poznámka: `PushSuggestion` typ a `pushSuggestion` state mohou zůstat — mohly by se v budoucnu použít pro jiné účely. Jen se přestanou nastavovat pro locked bloky.

- [ ] **Step 3: Opravit `firstFollowing.locked` check na začátku kroku 2**

V novém kódu (step 1) se `firstFollowing` hledání a jeho locked check odstranil — je nahrazený generickým loop přes candidates. Ověřit, že řádky 1201–1213 (staré) jsou kompletně nahrazené novým kódem.

- [ ] **Step 4: Ověřit chování v prohlížeči**

Testovací scénáře:
1. Přesunout blok A tak, aby zatlačil blok B do zamknutého bloku C → B se přeskočí za C
2. Přesunout blok tak, aby chain musel přeskočit 2 zamknuté bloky za sebou
3. Přesunout blok, kde chain přeskočí locked přes noc/weekend
4. Lasso selection + batch move kolem zamknutého bloku

---

### Task 4: Undo/Redo — atomická operace pro celý chain

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:1114` (signatura `autoResolveOverlap`)
- Modify: `src/app/_components/PlannerPage.tsx:1338-1383` (`handleBlockUpdate`)

Undo musí vrátit přesunutý blok + všechny bloky posunuté chainem jedním Ctrl+Z.

- [ ] **Step 1: Přidat `movedSnapshots` parametr do `autoResolveOverlap`**

V souboru `src/app/_components/PlannerPage.tsx`, změnit signaturu funkce (řádek 1114):

Stará:
```tsx
async function autoResolveOverlap(movedBlock: Block, excludeIds: Set<number> = new Set([movedBlock.id]), prevBlock?: Block, deleteBlockOnConflict = false): Promise<OverlapResult> {
```

Nová:
```tsx
async function autoResolveOverlap(movedBlock: Block, excludeIds: Set<number> = new Set([movedBlock.id]), prevBlock?: Block, deleteBlockOnConflict = false, movedSnapshots?: Map<number, { startTime: string; endTime: string; machine: string }>): Promise<OverlapResult> {
```

- [ ] **Step 2: Ukládat snapshoty chain bloků před posunem**

V novém kódu `autoResolveOverlap` (task 3, step 1), těsně před batch fetch, přidat ukládání snapshotů:

```tsx
    // Uložit snapshoty chain bloků pro undo
    if (movedSnapshots) {
      for (const b of chain) {
        if (!movedSnapshots.has(b.id)) {
          movedSnapshots.set(b.id, { startTime: b.startTime as string, endTime: b.endTime as string, machine: b.machine });
        }
      }
    }
```

A v rekurzivním volání předat `movedSnapshots`:

Stará:
```tsx
if (lastResult) await autoResolveOverlap(lastResult, allExcluded);
```

Nová:
```tsx
if (lastResult) await autoResolveOverlap(lastResult, allExcluded, undefined, false, movedSnapshots);
```

- [ ] **Step 3: Přepsat undo logiku v `handleBlockUpdate`**

V souboru `src/app/_components/PlannerPage.tsx`, v `handleBlockUpdate` (řádky 1364–1383), nahradit celý blok `if (timeOrMachineChanged)`:

Staré:
```tsx
      if (timeOrMachineChanged) {
        void autoResolveOverlap(updated, new Set([updated.id]), prev);
        if (addToHistory) {
          const bypassAtTime = !workingTimeLockRef.current;
          const prevSnap = { startTime: prev.startTime, endTime: prev.endTime, machine: prev.machine, bypassScheduleValidation: bypassAtTime, bypassOverlapCheck: true };
          const nextSnap = { startTime: updated.startTime, endTime: updated.endTime, machine: updated.machine, bypassScheduleValidation: bypassAtTime, bypassOverlapCheck: true };
          undoStack.current.push({
            undo: async () => {
              const res = await fetch(`/api/blocks/${updated.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prevSnap) });
              if (res.ok) { const b: Block = await res.json(); setBlocks(arr => arr.map(x => x.id === b.id ? b : x)); setSelectedBlock(sel => sel?.id === b.id ? b : sel); }
            },
            redo: async () => {
              const res = await fetch(`/api/blocks/${updated.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nextSnap) });
              if (res.ok) { const b: Block = await res.json(); setBlocks(arr => arr.map(x => x.id === b.id ? b : x)); setSelectedBlock(sel => sel?.id === b.id ? b : sel); }
            },
          });
          if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
          redoStack.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
      }
```

Nové:
```tsx
      if (timeOrMachineChanged) {
        const movedSnapshots = new Map<number, { startTime: string; endTime: string; machine: string }>();
        // Snapshot přesunutého bloku
        movedSnapshots.set(updated.id, { startTime: prev.startTime as string, endTime: prev.endTime as string, machine: prev.machine });

        // autoResolveOverlap naplní movedSnapshots chain bloky
        await autoResolveOverlap(updated, new Set([updated.id]), prev, false, movedSnapshots);

        if (addToHistory && movedSnapshots.size > 0) {
          const bypassAtTime = !workingTimeLockRef.current;
          // Snapshot "po" — aktuální stav všech posunutých bloků
          const afterSnapshots = new Map<number, { startTime: string; endTime: string; machine: string }>();
          for (const [id] of movedSnapshots) {
            const current = blocksRef.current.find(b => b.id === id);
            if (current) afterSnapshots.set(id, { startTime: current.startTime as string, endTime: current.endTime as string, machine: current.machine });
          }

          undoStack.current.push({
            undo: async () => {
              const updates = Array.from(movedSnapshots.entries()).map(([id, snap]) => ({
                id, startTime: snap.startTime, endTime: snap.endTime, machine: snap.machine,
              }));
              const r = await fetch("/api/blocks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates, bypassScheduleValidation: true, bypassOverlapCheck: true }) });
              if (r.ok) { const res: Block[] = await r.json(); setBlocks(prev => prev.map(b => res.find(x => x.id === b.id) ?? b)); }
            },
            redo: async () => {
              const updates = Array.from(afterSnapshots.entries()).map(([id, snap]) => ({
                id, startTime: snap.startTime, endTime: snap.endTime, machine: snap.machine,
              }));
              const r = await fetch("/api/blocks/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates, bypassScheduleValidation: true, bypassOverlapCheck: true }) });
              if (r.ok) { const res: Block[] = await r.json(); setBlocks(prev => prev.map(b => res.find(x => x.id === b.id) ?? b)); }
            },
          });
          if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
          redoStack.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
      }
```

- [ ] **Step 4: Změnit `handleBlockUpdate` na `async` a `void` na `await`**

Důležité: ve starém kódu je `handleBlockUpdate` synchronní funkce a volá `void autoResolveOverlap(...)` (fire and forget). Nový kód potřebuje `await`, protože musíme počkat na naplnění `movedSnapshots` před vytvořením undo záznamu.

V souboru `src/app/_components/PlannerPage.tsx`, řádek 1337, změnit:

```tsx
  function handleBlockUpdate(updated: Block, addToHistory = false) {
```

na:

```tsx
  async function handleBlockUpdate(updated: Block, addToHistory = false) {
```

Tato změna je bezpečná — callery (onSave v BlockEdit, onBlockUpdate v TimelineGrid) neočekávají návratovou hodnotu, takže async wrapper nic nerozbije.

- [ ] **Step 5: Ověřit undo v prohlížeči**

Testovací scénáře:
1. Přesunout blok → chain push 2 bloky → Ctrl+Z → všechny 3 bloky se vrátí na původní pozice
2. Přesunout blok → chain přeskočí locked → Ctrl+Z → blok i chain bloky zpět
3. Ctrl+Z → Ctrl+Shift+Z (redo) → bloky se opět posunou
4. Ověřit, že multi-block/lasso undo stále funguje (neregrese)

---

### Task 5: Skrýt lock switch v BlockEdit pro neoprávněné role

**Files:**
- Modify: `src/components/BlockEdit.tsx:829-835`

- [ ] **Step 1: Obalit lock switch podmínkou `canEdit`**

V souboru `src/components/BlockEdit.tsx`, řádky 829–835, nahradit:

```tsx
        {/* Zamčeno */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <Switch checked={locked} onCheckedChange={setLocked} />
          <Label style={{ fontSize: 11, color: locked ? "var(--brand)" : "var(--text-muted)", cursor: "pointer" }}>
            <Lock size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />Zamčený blok
          </Label>
        </div>
```

za:

```tsx
        {/* Zamčeno — jen pro ADMIN a PLANOVAT (canEdit) */}
        {canEdit && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
            <Switch checked={locked} onCheckedChange={setLocked} />
            <Label style={{ fontSize: 11, color: locked ? "var(--brand)" : "var(--text-muted)", cursor: "pointer" }}>
              <Lock size={11} strokeWidth={1.5} style={{ display: "inline-block", verticalAlign: "middle", marginRight: 4 }} />Zamčený blok
            </Label>
          </div>
        )}
```

- [ ] **Step 2: Ověřit v prohlížeči**

1. Přihlásit se jako ADMIN → switch viditelný
2. Přihlásit se jako DTP → switch skrytý
3. Přihlásit se jako MTZ → switch skrytý

---

### Task 6: Finální integrační test

**Files:** žádné změny — jen testování

- [ ] **Step 1: Ověřit kompletní flow**

1. Zamknout blok (ADMIN/PLANOVAT v BlockEdit)
2. Ověřit vizuální indikaci: amber pruh na bloku + amber overlay v TIME sloupci
3. Přesunout jiný blok tak, aby chain přeskočil zamknutý → ověřit skip
4. Ctrl+Z → ověřit atomický undo celého chainu
5. Ctrl+Shift+Z → ověřit redo
6. Lasso selection → ověřit, že zamknutý blok není vybrán
7. Pokusit se drag zamknutý blok → ověřit, že nejde (stávající chování)
8. Editovat metadata zamknutého bloku (D/M/E datumy) → ověřit, že funguje

- [ ] **Step 2: Ověřit build**

Run: `npm run build`

Expected: build projde bez chyb

- [ ] **Step 3: Spustit existující testy**

Run:
```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: 24/24 zelené (žádná regrese)
