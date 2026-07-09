# Plánovač — 4 body z auditu: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementovat 4 schválené body z auditu e-mailu plánovače: pásy směn na pozadí, MICRO text režim bloků, celkový čas split skupiny, cut+paste jako přesun.

**Architecture:** Čistě klientské změny (TimelineGrid, PlannerPage, BlockEdit, BlockDetail) + jeden nový čistý helper v `printTimeClient.ts` s unit testy. Žádná změna DB schématu ani API routes — cut=přesun jen přepíná klienta z POST+DELETE na existující PUT/batch cestu (stejnou jako drag/lasso).

**Tech Stack:** Next.js + React + TypeScript, node:test + tsx pro unit testy.

**Spec:** `docs/superpowers/specs/2026-07-09-planovac-4-body-design.md`

## Global Constraints

- Větev `Vojta`, commit po každém tasku (vzor `feat:`/`fix:` + česká zpráva jako dosud).
- Po každém tasku `npm run build` zelený (lint warningy OK, 0 chyb).
- ZAKAZKA mutace: klient posílá `printMinutes` (`blockPrintMinutes`), nikdy naivní `endTime` jako zdroj pravdy; end počítá server (`validateAndComputeEnd`). Ne-ZAKAZKA: duration-based.
- Žádné nové inline komponenty v PlannerPage/TimelineGrid — jen úpravy stávajících render bloků; nový sdílený kód do `src/lib/`.
- Hranice směn výhradně z `SHIFT_HOURS` (`src/lib/shifts.ts`) — žádná magická čísla 6/14/22.
- Komentáře česky, styl souladný s okolím.

---

### Task 1: Pásy směn na pozadí (bod 19)

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:3667-3687` (dayshade smyčka)
- Modify: importy TimelineGrid (přidat `SHIFT_HOURS` z `@/lib/shifts`)

**Interfaces:**
- Consumes: `SHIFT_HOURS: Record<ShiftType, { start: number; end: number }>` (`src/lib/shifts.ts:8-12`; MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6), CSS třídy `.tl-night`/`.tl-afternoon` (`src/app/globals.css:262-269`, už existují vč. dark variant)
- Produces: nic pro další tasky (čistě vizuální vrstva)

- [ ] **Step 1: Prohlédnout dayshade smyčku a ověřit mrtvý výpočet**

Ve smyčce `days.map` (řádky ~3668–3687) se počítají `allResolvedRows`, `activeMachines`, `nightEnd`, `nightStart`, `midpoint` (ř. 3672–3679), ale Fragment vykresluje jen `tl-day-alt`. Ověř grepem, že tyto proměnné nejsou použité nikde jinde uvnitř Fragmentu:

```bash
sed -n '3668,3690p' src/app/_components/TimelineGrid.tsx
```

Expected: jediné použití je deklarace — mrtvý kód z doby před week-shifts modelem.

- [ ] **Step 2: Implementovat pásy + odstranit mrtvý výpočet**

Nahradit obsah Fragmentu (zachovat stávající `tl-day-alt` div beze změny, smazat mrtvé výpočty ř. 3672–3679, přidat pásy):

```tsx
{/* ── Denní cykly + střídání dnů (základní vrstva) ─────────── */}
{days.map((d, di) => {
  const isEven = di % 2 === 0;
  const hpx = slotHeight * 2; // px na hodinu
  return (
    <Fragment key={`dayshade-${d.y}`}>
      {/* Základní tón každého druhého dne — jen pro pracovní dny bez červeného šrafování */}
      {!isEven && !d.isWeekend && !d.isCompanyDay && <div className="tl-day-alt" style={{ position: "absolute", top: d.y, height: dayHeight, left: 0, right: 0, pointerEvents: "none" }} />}
      {/* Směnové pásy — fixní časy směn (SHIFT_HOURS): noc 0–6 a 22–24 nejtmavší,
          odpolední 14–22 tmavší, ranní 6–14 je v CSS transparent → nekreslí se.
          Alfa pozadí se vrství s tl-day-alt (alt-den zůstává o odstín tmavší). */}
      {!d.isWeekend && !d.isCompanyDay && (
        <>
          <div className="tl-night"     style={{ position: "absolute", top: d.y,                                          height: SHIFT_HOURS.MORNING.start * hpx,                                        left: 0, right: 0, pointerEvents: "none" }} />
          <div className="tl-afternoon" style={{ position: "absolute", top: d.y + SHIFT_HOURS.AFTERNOON.start * hpx,      height: (SHIFT_HOURS.AFTERNOON.end - SHIFT_HOURS.AFTERNOON.start) * hpx,        left: 0, right: 0, pointerEvents: "none" }} />
          <div className="tl-night"     style={{ position: "absolute", top: d.y + SHIFT_HOURS.AFTERNOON.end * hpx,        height: (24 - SHIFT_HOURS.AFTERNOON.end) * hpx,                                  left: 0, right: 0, pointerEvents: "none" }} />
        </>
      )}
    </Fragment>
  );
})}
```

Import doplnit k existujícím importům: `import { SHIFT_HOURS } from "@/lib/shifts";` — pokud už TimelineGrid něco z `@/lib/shifts` importuje, jen rozšířit. Po smazání mrtvého výpočtu zkontrolovat, zda `resolveScheduleRows`/`WORK_START_H`/`WORK_END_H` nejsou v souboru jinde — pokud ano, importy nechat; pokud byly jen tady, smazat i nepoužité importy (lint by je ohlásil).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: úspěch, 0 TS chyb.

- [ ] **Step 4: Vizuální ověření na dev serveru**

Spustit dev server (pokud neběží — pozor, Vojtův server může běžet na portu 3000, nezabíjet procesy!), otevřít planner a screenshot: pracovní den má tři tóny (0–6 tmavý, 6–14 světlý, 14–22 mírně tmavší, 22–24 tmavý), víkend/odstávka bez pásů, střídání dnů dál funguje, dark i light mode.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: pásy směn na pozadí timeline (ranní/odpolední/noční, fixní 6-14-22)"
```

---

### Task 2: MODE_MICRO_TEXT — číslo · popis od 14 px (bod 15)

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:1064-1066` (definice módů) a ~1546 (za konec MODE_TINY render bloku)

**Interfaces:**
- Consumes: `layoutHeight`, `block.orderNumber`, `block.description`, styl `s.textPrimary`/`s.textSub` (vše lokální v BlockCard)
- Produces: nic pro další tasky

- [ ] **Step 1: Ověřit, co se dnes kreslí pod 24 px**

```bash
grep -n "MODE_TINY &&" src/app/_components/TimelineGrid.tsx
```

Prohlédnout konec MODE_TINY IIFE (~ř. 1546) a potvrdit, že pod 24 px se nekreslí žádný obsah (jen barevný blok) — nový mód nesmí kolidovat s existujícím renderem.

- [ ] **Step 2: Přidat definici módu**

Za řádek 1066 (`const MODE_TINY = ...`):

```tsx
const MODE_MICRO_TEXT = !MODE_FULL && !MODE_COMPACT && !MODE_TINY && layoutHeight >= 14; // 14–23 px: jediný řádek číslo · popis
```

- [ ] **Step 3: Přidat render blok**

Hned za uzavření MODE_TINY render bloku (`})()}` ~ř. 1547) vložit:

```tsx
{/* ── MODE_MICRO_TEXT: 14–23 px — jediný řádek „číslo · popis" (bez chipů a badge) ── */}
{MODE_MICRO_TEXT && (
  <div style={{ display: "flex", alignItems: "center", gap: 3, paddingLeft: (block.locked || isUnconfirmedReservation) ? 28 : 6, paddingRight: 6, flex: 1, overflow: "hidden", minHeight: 0 }}>
    <span style={{ fontSize: 8, fontWeight: 700, color: s.textPrimary, whiteSpace: "nowrap", flexShrink: 0, lineHeight: 1 }}>
      {block.orderNumber}
    </span>
    {block.description && (
      <span style={{ fontSize: 8, fontWeight: 400, color: s.textSub, opacity: 0.75, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1, minWidth: 0 }}>
        · {block.description}
      </span>
    )}
  </div>
)}
```

Deadline/drift badge podmínky (ř. ~1210, ~1238) NEROZŠIŘOVAT — pod TINY zůstávají skryté (schválený scope).

- [ ] **Step 4: Build + vizuální ověření**

Run: `npm run build` → 0 chyb. Na dev serveru odzoomovat tak, aby bloky měly 14–23 px, a ověřit: číslo + popis čitelné, ellipsis funguje, pod 14 px beze změny, zamčený blok nemá text pod ikonou zámku.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: MICRO text režim bloků 14-23 px (číslo · popis při odzoomu)"
```

---

### Task 3: Helpery `splitGroupTotalPrintMinutes` + `formatPrintHoursShort` (bod 18a, TDD)

**Files:**
- Modify: `src/lib/printTimeClient.ts` (přidat 2 exporty)
- Test: `src/lib/printTimeClient.test.ts` (přidat testy k existujícím 32)

**Interfaces:**
- Consumes: `blockPrintMinutes(block)` (existující export `printTimeClient.ts` — ZAKAZKA `printMinutes` s fallbackem na elapsed zarovnaný na 30min grid, jinak elapsed)
- Produces (pro Task 4):
  - `splitGroupTotalPrintMinutes(siblings: { type: string; printMinutes?: number | null; startTime: string | Date; endTime: string | Date }[]): number` — Σ `blockPrintMinutes` přes členy skupiny; `[]` → 0 (stejný inline vstupní typ jako `blockPrintMinutes`, printTimeClient.ts:24-29).
  - `formatPrintHoursShort(minutes: number): string` — „27h" pro celé hodiny, jinak 1 desetinné místo s čárkou „27,5h".

- [ ] **Step 1: Napsat failing testy**

Do `src/lib/printTimeClient.test.ts` (naimportovat nové funkce, fixture vzor převzít z existujících testů `blockPrintMinutes` v témže souboru — použít stejný tvar mock bloku):

```ts
test("splitGroupTotalPrintMinutes: sčítá printMinutes ZAKAZKA členů", () => {
  const mk = (pm: number | null, startH: number, endH: number) => ({
    type: "ZAKAZKA",
    printMinutes: pm,
    startTime: new Date(Date.UTC(2026, 6, 9, startH)).toISOString(),
    endTime: new Date(Date.UTC(2026, 6, 9, endH)).toISOString(),
  });
  // 3 části: 10h + 10h + 7h tisku = 1620 min (printMinutes má přednost před elapsed)
  assert.equal(
    splitGroupTotalPrintMinutes([mk(600, 6, 16), mk(600, 16, 22), mk(420, 2, 9)]),
    1620,
  );
});

test("splitGroupTotalPrintMinutes: fallback na elapsed u legacy členů (pm=null)", () => {
  const legacy = {
    type: "ZAKAZKA", printMinutes: null,
    startTime: new Date(Date.UTC(2026, 6, 9, 6)).toISOString(),
    endTime: new Date(Date.UTC(2026, 6, 9, 8)).toISOString(),
  };
  assert.equal(splitGroupTotalPrintMinutes([legacy]), 120);
});

test("splitGroupTotalPrintMinutes: prázdné pole → 0", () => {
  assert.equal(splitGroupTotalPrintMinutes([]), 0);
});

test("formatPrintHoursShort: celé hodiny bez desetin, jinak čárka a 1 desetinné", () => {
  assert.equal(formatPrintHoursShort(1620), "27h");
  assert.equal(formatPrintHoursShort(1650), "27,5h");
  assert.equal(formatPrintHoursShort(90), "1,5h");
  assert.equal(formatPrintHoursShort(30), "0,5h");
});
```

Pozn.: přesný tvar mock bloku přizpůsobit tomu, co `blockPrintMinutes` v souboru skutečně vyžaduje (podívej se na existující testy `blockPrintMinutes` a použij shodný fixture vzor; hodnoty výše uprav, pokud fallback zaokrouhluje jinak).

- [ ] **Step 2: Spustit — musí selhat**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: FAIL — `splitGroupTotalPrintMinutes is not a function` (import error).

- [ ] **Step 3: Implementovat**

Do `src/lib/printTimeClient.ts` (za `blockPrintMinutes`, převzít jeho vstupní typ):

```ts
/**
 * Součet tiskových minut všech členů split skupiny (bod 18 auditu plánovače).
 * siblings = všechny bloky skupiny včetně bloku samotného. Deleguje na
 * blockPrintMinutes — ZAKAZKA bere printMinutes (fallback elapsed), jinak elapsed.
 */
export function splitGroupTotalPrintMinutes(
  siblings: { type: string; printMinutes?: number | null; startTime: string | Date; endTime: string | Date }[]
): number {
  return siblings.reduce((sum, b) => sum + blockPrintMinutes(b), 0);
}

/** „27h" / „27,5h" — krátký formát hodin pro chip a detail split skupiny. */
export function formatPrintHoursShort(minutes: number): string {
  const h = minutes / 60;
  return h % 1 === 0 ? `${h}h` : `${h.toFixed(1).replace(".", ",")}h`;
}
```

- [ ] **Step 4: Testy zelené**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: PASS (32 původních + 4 nové).

- [ ] **Step 5: Commit**

```bash
git add src/lib/printTimeClient.ts src/lib/printTimeClient.test.ts
git commit -m "feat: splitGroupTotalPrintMinutes + formatPrintHoursShort (Σ čas split skupiny)"
```

---

### Task 4: Σ čas skupiny v chipu, tooltipu, BlockEdit a BlockDetail (bod 18b)

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` — props BlockCard (~936), chipy (~1533, ~1587), tooltip (~1917), výpočet u `splitSiblings` (~3865) a předání propu (~3891)
- Modify: `src/components/BlockEdit.tsx:719` (hlavička ✂ Část)
- Modify: `src/components/BlockDetail.tsx` (sekce split, má prop `allBlocks`)

**Interfaces:**
- Consumes: `splitGroupTotalPrintMinutes`, `formatPrintHoursShort` z `@/lib/printTimeClient` (Task 3)
- Produces: prop `splitTotalMinutes?: number` na BlockCard

- [ ] **Step 1: TimelineGrid — výpočet a prop**

U výpočtu `splitTotal`/`splitPart` (~ř. 3865):

```tsx
const splitTotal = splitSiblings.length > 1 ? splitSiblings.length : 0;
const splitPart  = splitTotal > 0 ? splitSiblings.findIndex(b => b.id === block.id) + 1 : 0;
const splitTotalMinutes = splitTotal > 0 ? splitGroupTotalPrintMinutes(splitSiblings) : 0;
```

Předat `splitTotalMinutes={splitTotalMinutes}` vedle `splitPart`/`splitTotal` (~ř. 3891). Do props BlockCard (~ř. 936) přidat `splitTotalMinutes?: number;` a do destructuringu (~ř. 921). Import rozšířit o obě funkce z `@/lib/printTimeClient` (soubor už `blockPrintMinutes` importuje).

- [ ] **Step 2: Chipy — oba výskyty (COMPACT ~1533, FULL ~1587)**

```tsx
{(splitTotal ?? 0) > 1 && (
  <span style={{ fontSize: 8, opacity: 0.55, color: s.textSub, flexShrink: 0, lineHeight: 1 }}>
    ✂{splitPart}/{splitTotal}{(splitTotalMinutes ?? 0) > 0 ? ` · ${formatPrintHoursShort(splitTotalMinutes!)}` : ""}
  </span>
)}
```

- [ ] **Step 3: Tooltip (~1917)**

Za `durationLabel` doplnit:

```tsx
const groupLabel = (splitTotal ?? 0) > 1 && (splitTotalMinutes ?? 0) > 0
  ? `Skupina: Σ ${fmtHoursTip(splitTotalMinutes!)} (${splitTotal} částí)`
  : null;
```

a v JSX tooltipu vykreslit řádek pod délkou (stejný styl jako řádek s `durationLabel`):

```tsx
{groupLabel && <div style={{ /* stejný styl jako durationLabel řádek */ }}>{groupLabel}</div>}
```

(Přesný styl okopírovat z existujícího řádku délky v tooltipu.)

- [ ] **Step 4: BlockEdit hlavička (ř. 719)**

```tsx
✂ Část {splitIndex + 1} / {splitGroup!.length} · celkem {formatPrintHoursShort(splitGroupTotalPrintMinutes(splitGroup!))} tisku
```

Import obou funkcí z `@/lib/printTimeClient` doplnit k existujícím importům BlockEdit.

- [ ] **Step 5: BlockDetail — řádek skupiny**

V BlockDetail (má `allBlocks` a `block`): v sekci, kde se řeší split (~ř. 327), doplnit řádek zobrazený pro `block.splitGroupId != null && allBlocks`:

```tsx
{block.splitGroupId != null && allBlocks && (() => {
  const siblings = allBlocks.filter(
    (b) => b.splitGroupId === block.splitGroupId || b.id === block.splitGroupId
  );
  if (siblings.length < 2) return null;
  return (
    <div /* styl řádku převzít z okolních info řádků BlockDetail */>
      Celkem skupina: {formatPrintHoursShort(splitGroupTotalPrintMinutes(siblings))} tisku ({siblings.length} částí)
    </div>
  );
})()}
```

Umístit k řádku Délka (pokud existuje) nebo do split sekce; vizuální styl převzít z okolí.

- [ ] **Step 6: Build + vizuální ověření**

Run: `npm run build` → 0 chyb. Dev server: split blok ukazuje `✂2/5 · 27h`, tooltip řádek „Skupina: Σ 27 h (5 částí)", BlockEdit hlavičku s celkem, BlockDetail řádek. Nesplitnutý blok beze změny.

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/components/BlockEdit.tsx src/components/BlockDetail.tsx
git commit -m "feat: celkový tiskový čas split skupiny v chipu, tooltipu a detailech"
```

---

### Task 5: Jednoblokový cut = PUT přesun + guard na Ctrl+X (bod 17a)

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` — Ctrl+X handler (~2830), `handlePasteWithTarget` (~2492-2585)

**Interfaces:**
- Consumes: `handleBlockUpdate(updated, true)` (PlannerPage:1495 — aplikuje blok + `shifted` sousedy + zapisuje move-undo přes `buildMoveOrResizeCommand`), `blockPrintMinutes` (už importováno), PUT `/api/blocks/[id]` (stejné body jako drag: TimelineGrid:2715-2727)
- Produces: nic pro další tasky

- [ ] **Step 1: Guard na Ctrl+X (~ř. 2830)**

```tsx
if (e.key === "x" && selectedBlockRef.current) {
  e.preventDefault();
  const sel = selectedBlockRef.current;
  if (sel.locked || sel.printCompletedAt) {
    showToast(sel.locked ? "Zamčený blok nelze vyjmout." : "Vytištěný blok nelze vyjmout.", "info");
    return;
  }
  setCopiedBlock(sel);
  setIsCut(true);
  clipboardGroupRef.current = [];
  isGroupCutRef.current = false;
  setPasteTarget(computePasteTargetFromBlock(sel));
  showToast("Blok vyříznut. Ctrl+V ho přesune těsně za originál.", "info");
  return;
}
```

- [ ] **Step 2: Cut větev v `handlePasteWithTarget`**

Za výpočet `newStart`/`newEnd` (ř. ~2524, před sestavením `pasteBody`) vložit:

```tsx
if (isCutRef.current) {
  // CUT = PŘESUN existujícího bloku (PUT, stejná cesta jako drag) — zachová
  // splitGroupId, historii auditu, vazbu na rezervaci i zámky. Bod 17 auditu:
  // dřívější POST kopie + DELETE originálu rozbíjel split skupiny.
  const moveBody: Record<string, unknown> = {
    startTime: newStart.toISOString(),
    machine: target.machine,
    bypassScheduleValidation: !workingTimeLockRef.current,
    resolveChain: true,
  };
  if (isZakazka) {
    moveBody.printMinutes = blockPrintMinutes(src);
  } else {
    moveBody.endTime = newEnd.toISOString();
  }
  try {
    const res = await fetch(`/api/blocks/${src.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(moveBody),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? "Chyba serveru");
    }
    const updated: Block = await res.json();
    handleBlockUpdate(updated, true); // stav + shifted sousedé + move-undo
    setCopiedBlock(null);
    setIsCut(false);
  } catch (error) {
    console.error("Block cut-move failed", error);
    showToast(error instanceof Error ? error.message : "Chyba při přesunu bloku.", "error");
  }
  return;
}
```

Stávající POST cesta (kopie) zůstává pod tím beze změny — jen z ní odstranit dnešní `if (isCutRef.current) { DELETE ... }` blok (ř. ~2574-2580), který se stane mrtvým.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 chyb.

- [ ] **Step 4: Funkční ověření na dev DB (Lukášův scénář)**

Na dev serveru: vytvořit ZAKAZKA blok, rozdělit (✂), vybrat část, Ctrl+X → Ctrl+V jinam. Ověřit:
1. Blok se přesunul (stejné id — v BlockDetail historie pokračuje, audit řádek UPDATE, žádný CREATE+DELETE).
2. ✂ chip zůstal, změna stavu (např. dataOk) se propíše přes všechny části.
3. `splitGroupId` v DB: `mysql -u root -pmysql IGvyroba -e "SELECT id, splitGroupId, machine, startTime FROM Block WHERE splitGroupId IS NOT NULL ORDER BY id DESC LIMIT 5;"`
4. Ctrl+Z vrátí blok na původní místo.
5. Regrese: Ctrl+C (kopie) split bloku vytvoří NEZÁVISLÝ blok bez `splitGroupId`; cut obyčejného bloku funguje; cut zamčeného bloku → toast.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "fix: Ctrl+X/V přesouvá blok (PUT) místo mazání a vytváření — split skupina a historie zachovány"
```

---

### Task 6: Skupinový cut = batch přesun (bod 17b)

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` — `handleGroupPasteWithTarget` (~2599-2730)

**Interfaces:**
- Consumes: `handleMultiBlockUpdate(updates: { id, startTime: Date, endTime: Date, machine }[])` (PlannerPage:1559 — batch PUT `/api/blocks/batch` s `resolveChain`, zapisuje undo „Hromadný přesun"; server u ZAKAZKA přepočítá end z uloženého `printMinutes`)
- Produces: nic

- [ ] **Step 1: Cut větev v `handleGroupPasteWithTarget`**

Za výpočet `pasteMs` (ř. ~2627), před POST smyčku:

```tsx
if (isGroupCutRef.current) {
  // Skupinový CUT = hromadný PŘESUN (batch PUT, stejná cesta jako lasso drag) —
  // žádné POST kopie + DELETE originálů. Sémantika cíle zachována: všechny bloky
  // na target.machine s offsetem vůči anchoru. Případné 422 (nevalidní start
  // některého členu při zámku pracovní doby) vrací batch jako celek — parita
  // s dřívějším chováním POST cesty.
  const updates = group.map((src) => {
    const offsetMs = new Date(src.startTime).getTime() - anchorMs;
    const durationMs = new Date(src.endTime).getTime() - new Date(src.startTime).getTime();
    const newStart = new Date(pasteMs + offsetMs);
    return { id: src.id, startTime: newStart, endTime: new Date(newStart.getTime() + durationMs), machine: target.machine };
  });
  await handleMultiBlockUpdate(updates);
  clipboardGroupRef.current = [];
  isGroupCutRef.current = false;
  setSelectedBlockIds(new Set());
  return;
}
```

Stávající POST smyčka (kopie skupiny) zůstává; z jejího konce odstranit dnešní `if (isGroupCutRef.current) { DELETE originálů }` blok (ř. ~2709-2724), který se stane mrtvým.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: 0 chyb.

- [ ] **Step 3: Funkční ověření**

Dev server: lasso výběr 2–3 bloků → Ctrl+X → Ctrl+V jinam. Ověřit: bloky se PŘESUNULY (stejná id, audit UPDATE), undo „Hromadný přesun" funguje, skupinová KOPIE (Ctrl+C) dál vytváří nové bloky. Cut skupiny obsahující split část: vazba zachována.

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "fix: skupinový Ctrl+X/V = batch přesun místo kopie+smazání"
```

---

### Task 7: Finální verifikace + multi-agent review + dokumentace

**Files:**
- Modify: `CLAUDE.md` (nová sekce / doplnění „Ověřený stav")
- Žádné nové zdrojové soubory

- [ ] **Step 1: Celá test suite**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: 370/370 zelené (366 + 4 nové z Tasku 3).

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`
Expected: build OK, lint 0 chyb (warningy tolerované dle repa).

- [ ] **Step 3: Multi-agent review (dle Vojtova goal)**

Spustit nezávislé review subagenty nad diffem větve (min. 3 lens: korektnost/regrese, UI/UX konzistence, soulad s best practices repa — printMinutes konvence, undo, žádný console.log v API). Každý Important nález opravit (fix wave) a nechat nezávisle ověřit.

- [ ] **Step 4: Vizuální regresní kolečko**

Dev server: projít planner (pásy, micro text, split chip), rezervace, denní report — nic rozbitého; dark i light mode.

- [ ] **Step 5: Aktualizace CLAUDE.md + commit**

Doplnit do CLAUDE.md sekci o 4 bodech (pásy směn, MICRO text, Σ split, cut=přesun) po vzoru etapových zápisů. Commit:

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — 4 body z auditu plánovače hotové"
```
