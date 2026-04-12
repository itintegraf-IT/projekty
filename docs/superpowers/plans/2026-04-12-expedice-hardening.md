# Expediční plán — Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opravit kritické bugy a chybějící UX prvky expediční stránky nalezené při code review ze dne 2026-04-12.

**Architecture:** Pět nezávislých etap seřazených od kritického po minor. Každá etapa je deployovatelná samostatně. Žádné nové dependencies — všechny opravy jsou v existujících souborech v `src/app/expedice/_components/` a `src/app/expedice/_components/` adjacent.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, inline CSS (pattern celé aplikace), existující `DatePickerField` z `PlannerPage.tsx`.

---

## Soubory dotčené v celém plánu

| Soubor | Etapy | Zodpovědnost |
|--------|-------|--------------|
| `src/app/expedice/_components/ExpedicePage.tsx` | A, B, C, E | Stavový stroj, handlery, layout |
| `src/app/expedice/_components/ExpediceAside.tsx` | A | Props pro onUnpublish |
| `src/app/expedice/_components/ExpediceDetailPanel.tsx` | A, C | Confirm pro unpublish, title fallback |
| `src/app/expedice/_components/ExpediceTimeline.tsx` | B, C | scrollToToday ref, read-only kursor |
| `src/app/expedice/_components/ExpediceCard.tsx` | C, D | title atribut, kursor dle role |
| `src/app/expedice/_components/ExpediceAside.tsx` | D | CandidateCard rozšíření |
| `src/app/expedice/_components/ExpediceBuilderPanel.tsx` | D | Focus ring |
| `src/app/expedice/_components/ExpediceEditorPanel.tsx` | D | Focus ring |
| `src/app/expedice/_components/ExpediceQueuePanel.tsx` | D | Drop target zóna |

---

## Etapa A — Kritické bugfixy

### Task A1: Opravit mrtvou větev v `computeInsertSortOrder`

**Soubory:**
- Modify: `src/app/expedice/_components/ExpedicePage.tsx:305-310`

**Bug:** Obě větve ternárního operátoru jsou identické — `isSameDayReorder ? targetDayItems : targetDayItems`. Výsledek je vždy stejný, bez ohledu na to, zda jde o reorder v rámci dne nebo cross-day přesun. Správně: pro cross-day přesun se nemá vylučovat žádná položka (dragged item v cílovém dni není), takže `excludeKey` má být `""`.

- [ ] **Krok 1: Opravit podmínku**

Najdi blok v `ExpedicePage.tsx` (kolem řádku 304):
```typescript
// PŘED:
const newSortOrder = computeInsertSortOrder(
  isSameDayReorder ? targetDayItems : targetDayItems,
  isSameDayReorder ? dragKey : "",
  beforeItemKey
);

// PO:
const newSortOrder = computeInsertSortOrder(
  targetDayItems,
  isSameDayReorder ? dragKey : "",
  beforeItemKey
);
```

- [ ] **Krok 2: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

Očekávej 0 nových chyb.

- [ ] **Krok 3: Commitnout**

```bash
git add src/app/expedice/_components/ExpedicePage.tsx
git commit -m "fix: opravit mrtvou větev computeInsertSortOrder v expedičním drag & drop"
```

---

### Task A2: Opravit nefunkční „Odebrat z expedice" v DetailPanelu

**Bug:** `ExpediceAside.tsx:201` předává `onUnpublish={() => {}}` — prázdná lambda. Tlačítko v `ExpediceDetailPanel` je vizuálně přítomno, ale nedělá nic.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpedicePage.tsx`
- Modify: `src/app/expedice/_components/ExpediceAside.tsx`
- Modify: `src/app/expedice/_components/ExpediceDetailPanel.tsx`

- [ ] **Krok 1: Přidat confirm stav do `ExpediceDetailPanel`**

V `ExpediceDetailPanel.tsx`, přidej na začátek komponenty:
```typescript
// Za: const isBlock  = item.sourceType === "block";
const [confirmUnpublish, setConfirmUnpublish] = React.useState(false);
const [unpublishing, setUnpublishing] = React.useState(false);
const [unpublishError, setUnpublishError] = React.useState<string | null>(null);

async function handleConfirmUnpublish() {
  setUnpublishing(true);
  setUnpublishError(null);
  try {
    await onUnpublish();
    setConfirmUnpublish(false);
  } catch (e: unknown) {
    setUnpublishError(e instanceof Error ? e.message : "Chyba");
  } finally {
    setUnpublishing(false);
  }
}
```

- [ ] **Krok 2: Přidat confirm overlay do renderu `ExpediceDetailPanel`**

Do `ExpediceDetailPanel.tsx`, před sticky footer (před komentář `{/* Sticky footer */}`), vlož:
```typescript
{/* Confirm unpublish overlay */}
{confirmUnpublish && (
  <div style={{
    flexShrink: 0, padding: "12px 16px",
    background: "rgba(239,68,68,0.08)",
    borderBottom: "1px solid rgba(239,68,68,0.2)",
    display: "flex", flexDirection: "column", gap: 10,
  }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
      Odebrat zakázku z expedice?
    </div>
    <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
      Zakázka zůstane v tiskovém plánu, ale zmizí z expedice.
    </div>
    {unpublishError && (
      <div style={{ fontSize: 11, color: "#ef4444" }}>{unpublishError}</div>
    )}
    <div style={{ display: "flex", gap: 6 }}>
      <button
        onClick={() => setConfirmUnpublish(false)}
        style={{
          flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11,
          fontWeight: 600, cursor: "pointer",
          background: "var(--surface-2)", border: "1px solid var(--border)",
          color: "var(--text)", transition: "all 120ms ease-out",
        }}
      >
        Zpět
      </button>
      <button
        onClick={handleConfirmUnpublish}
        disabled={unpublishing}
        style={{
          flex: 1, padding: "6px 0", borderRadius: 7, fontSize: 11,
          fontWeight: 600, cursor: unpublishing ? "default" : "pointer",
          background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.35)",
          color: unpublishing ? "rgba(239,68,68,0.5)" : "#ef4444",
          transition: "all 120ms ease-out",
        }}
      >
        {unpublishing ? "Odebírám..." : "Odebrat"}
      </button>
    </div>
  </div>
)}
```

- [ ] **Krok 3: Napojit tlačítko „Odebrat z expedice" na confirm**

V sticky footeru `ExpediceDetailPanel.tsx`, button `Odebrat z expedice` změň:
```typescript
// PŘED:
<button
  onClick={onUnpublish}
  disabled={unpublishing}
  ...
>
  {unpublishing ? "Odebírám..." : "Odebrat z expedice"}
</button>

// PO:
<button
  onClick={() => setConfirmUnpublish(true)}
  disabled={confirmUnpublish}
  style={{
    width: "100%", padding: "7px 16px", borderRadius: 8,
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.2)",
    color: "#ef4444",
    fontSize: 12, fontWeight: 500, cursor: confirmUnpublish ? "default" : "pointer",
    transition: "all 120ms ease-out",
  }}
>
  Odebrat z expedice
</button>
```

- [ ] **Krok 4: Zjednodušit props `ExpediceDetailPanel` — odeber `unpublishing` prop**

Interface komponenty — odeber `unpublishing: boolean` prop (teď je stav interní). Zachovej `onUnpublish: () => void`:
```typescript
// PŘED:
interface ExpediceDetailPanelProps {
  item: ExpediceItem;
  onEdit: () => void;
  onUnpublish: () => void;
  unpublishing: boolean;
}

// PO:
interface ExpediceDetailPanelProps {
  item: ExpediceItem;
  onEdit: () => void;
  onUnpublish: () => void;
}
```

Odeber destrukturování `unpublishing` ze signatury funkce.

- [ ] **Krok 5: Aktualizovat `ExpediceAside.tsx` — přidat `onUnpublish` prop a předat reálný handler**

Do `ExpediceAsideProps` přidej:
```typescript
onUnpublish: (blockId: number) => Promise<void>;
```

Destrukturuj v parametrech funkce:
```typescript
export function ExpediceAside({
  // ... existující props ...
  onUnpublish,
}: ExpediceAsideProps) {
```

Nahraď prázdnou lambdu v renderu (kolem řádku 200):
```typescript
// PŘED:
<ExpediceDetailPanel
  item={selectedItem}
  onEdit={onSwitchToEdit}
  onUnpublish={() => {}}
  unpublishing={false}
/>

// PO:
<ExpediceDetailPanel
  item={selectedItem}
  onEdit={onSwitchToEdit}
  onUnpublish={async () => {
    if (selectedItem.sourceType !== "block") return;
    await onUnpublish(selectedItem.id);
  }}
/>
```

- [ ] **Krok 6: Přidat `handleUnpublishFromDetail` do `ExpedicePage.tsx`**

Za existující `handlePublish` funkci přidej:
```typescript
async function handleUnpublishFromDetail(blockId: number) {
  const res = await fetch(`/api/blocks/${blockId}/expedition`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "unpublish" }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? "Chyba při odebrání z expedice");
  }
  setSelectedItem(null);
  setPanelMode("builder");
  setIsDirty(false);
  await fetchData();
}
```

Do `<ExpediceAside ...>` přidej prop:
```typescript
onUnpublish={handleUnpublishFromDetail}
```

- [ ] **Krok 7: Ověřit TypeScript a ESLint**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
npx eslint src/app/expedice/_components/ExpediceDetailPanel.tsx src/app/expedice/_components/ExpediceAside.tsx src/app/expedice/_components/ExpedicePage.tsx 2>&1
```

Očekávej 0 chyb, max stávající warningy.

- [ ] **Krok 8: Manuálně otestovat**

1. Spusť `npm run dev`
2. Otevři `/expedice` jako ADMIN
3. Klikni na publishnutý blok → zobrazí se detail vpravo
4. Klikni „Odebrat z expedice" → zobrazí se confirm overlay
5. Klikni „Odebrat" → blok zmizí z timeline a panel se přepne na builder
6. Klikni „Zpět" v overlayi → overlay zmizí, detail zůstane

- [ ] **Krok 9: Commitnout**

```bash
git add src/app/expedice/_components/ExpediceDetailPanel.tsx \
        src/app/expedice/_components/ExpediceAside.tsx \
        src/app/expedice/_components/ExpedicePage.tsx
git commit -m "fix: opravit nefunkční tlačítko Odebrat z expedice v DetailPanelu"
```

---

## Etapa B — Toolbar navigace

### Task B1: Tlačítko „Dnes" se scrollem na aktuální den

**Soubory:**
- Modify: `src/app/expedice/_components/ExpediceTimeline.tsx`
- Modify: `src/app/expedice/_components/ExpedicePage.tsx`

- [ ] **Krok 1: Exportovat `scrollToToday` z `ExpediceTimeline` přes ref**

V `ExpediceTimeline.tsx`, přidej import `forwardRef` a `useImperativeHandle`:
```typescript
import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
```

Přidej typ pro ref handle:
```typescript
export interface ExpediceTimelineHandle {
  scrollToToday: () => void;
}
```

Změň signaturu z klasické funkce na `forwardRef`:
```typescript
// PŘED:
export function ExpediceTimeline({
  days, selectedItemKey, ...
}: ExpediceTimelineProps) {

// PO:
export const ExpediceTimeline = forwardRef<ExpediceTimelineHandle, ExpediceTimelineProps>(function ExpediceTimeline({
  days, selectedItemKey, ...
}: ExpediceTimelineProps, ref) {
```

Uzavírací závorka komponenty z `}` na `});`.

Přidej `useImperativeHandle` hned za deklaraci `todayRef`:
```typescript
useImperativeHandle(ref, () => ({
  scrollToToday: () => {
    todayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
}));
```

- [ ] **Krok 2: Použít ref v `ExpedicePage.tsx`**

Do importů přidej `useRef`:
```typescript
import React, { useState, useEffect, useCallback, useRef } from "react";
```

Import `ExpediceTimelineHandle` z timeline:
```typescript
import { ExpediceTimeline, type ExpediceTimelineHandle } from "./ExpediceTimeline";
```

Na začátku komponenty `ExpedicePage` přidej ref:
```typescript
const timelineRef = useRef<ExpediceTimelineHandle>(null);
```

Předej ref do `<ExpediceTimeline>`:
```typescript
<ExpediceTimeline
  ref={timelineRef}
  days={filteredDays}
  // ... ostatní props beze změny ...
/>
```

- [ ] **Krok 3: Přidat tlačítko „Dnes" do toolbaru**

V toolbaru `ExpedicePage.tsx`, za span „Expediční plán" a `<div style={{ flex: 1 }} />`, přidej před filtry:
```typescript
{/* Dnes */}
<button
  onClick={() => timelineRef.current?.scrollToToday()}
  style={navBtnStyle(false)}
>
  Dnes
</button>

<div style={divider} />
```

- [ ] **Krok 4: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 5: Manuálně otestovat**

1. Otevři `/expedice` a scrollni dolů od dnešního dne
2. Klikni „Dnes" → timeline se scrollne zpět na aktuální den

- [ ] **Krok 6: Commitnout**

```bash
git add src/app/expedice/_components/ExpediceTimeline.tsx \
        src/app/expedice/_components/ExpedicePage.tsx
git commit -m "feat: přidat tlačítko Dnes do toolbaru expediční timeline"
```

---

### Task B2: „Přejít na datum" — date picker v toolbaru

**Soubory:**
- Modify: `src/app/expedice/_components/ExpedicePage.tsx`
- Modify: `src/app/expedice/_components/ExpediceTimeline.tsx`

**Pozn.:** Místo portování celého `DatePickerField` z PlannerPage použijeme jednoduchý `<input type="date">` stylovaný inline — konzistentní s toolbarem (jsou tam jen tlačítka, ne formuláře). `DatePickerField` je závislý na stavu PlannerPage a není exportovaný jako sdílená komponenta.

- [ ] **Krok 1: Přidat `scrollToDate` do `ExpediceTimelineHandle`**

V `ExpediceTimeline.tsx`, rozšiř handle type:
```typescript
export interface ExpediceTimelineHandle {
  scrollToToday: () => void;
  scrollToDate: (dateKey: string) => void;
}
```

Přidej `dateRefs` map — ref pro každý den:
```typescript
const dateRefs = useRef<Record<string, HTMLDivElement | null>>({});
```

Na každém day divu přidej `ref` callback:
```typescript
<div
  key={day.date}
  ref={(el) => { dateRefs.current[day.date] = el; }}
  // ... existující ref={isToday ? todayRef : undefined} zrus a nahrad výše
  style={{ ... }}
  ...
>
```

Uprav `todayRef` — odeber z jednotlivého divu a místo toho scrolluj přes `dateRefs`:

Aktualizuj `useImperativeHandle`:
```typescript
useImperativeHandle(ref, () => ({
  scrollToToday: () => {
    const el = dateRefs.current[today];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  },
  scrollToDate: (dateKey: string) => {
    const el = dateRefs.current[dateKey];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  },
}));
```

Odeber stávající `todayRef` a `useEffect` který scrolluje na mount — `scrollToDate(today)` při mountu zařídí ref:
```typescript
// Nahraď původní useEffect scrollToToday:
useEffect(() => {
  const el = dateRefs.current[today];
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}, []); // prázdné deps — jen při mountu
```

- [ ] **Krok 2: Přidat jump-to-date state do `ExpedicePage`**

Do state sekce přidej:
```typescript
const [showDateJump, setShowDateJump] = useState(false);
```

- [ ] **Krok 3: Přidat „Přejít na datum" tlačítko a input do toolbaru**

Za tlačítko „Dnes", před `<div style={divider} />` (před filtry), přidej:
```typescript
{/* Přejít na datum */}
<div style={{ position: "relative" }}>
  <button
    onClick={() => setShowDateJump((v) => !v)}
    style={navBtnStyle(showDateJump)}
  >
    Přejít na...
  </button>
  {showDateJump && (
    <div style={{
      position: "absolute", top: "calc(100% + 6px)", left: 0,
      background: "var(--surface-2)", border: "1px solid var(--border)",
      borderRadius: 8, padding: "8px 10px", zIndex: 100,
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    }}>
      <input
        type="date"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Escape") setShowDateJump(false); }}
        onChange={(e) => {
          if (!e.target.value) return;
          timelineRef.current?.scrollToDate(e.target.value);
          setShowDateJump(false);
        }}
        style={{
          background: "var(--surface)", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 6, color: "var(--text)", fontSize: 12, padding: "5px 8px",
          outline: "none", colorScheme: "dark",
        }}
      />
    </div>
  )}
</div>
```

Přidej `onClick` na root div stránky pro zavření date jumpu při kliknutí mimo — nebo přidej `onBlur` s `setTimeout`:
Jednodušší alternativa: přidej `onKeyDown` na `window` v `useEffect` pro Escape:
```typescript
useEffect(() => {
  if (!showDateJump) return;
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") setShowDateJump(false);
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [showDateJump]);
```

- [ ] **Krok 4: Ověřit TypeScript + ESLint**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
npx eslint src/app/expedice/_components/ExpediceTimeline.tsx src/app/expedice/_components/ExpedicePage.tsx 2>&1
```

- [ ] **Krok 5: Manuálně otestovat**

1. Klikni „Přejít na..." → otevře se datový picker
2. Vyber datum → timeline scrollne na daný den, picker se zavře
3. Stiskni Escape → picker se zavře bez akce

- [ ] **Krok 6: Commitnout**

```bash
git add src/app/expedice/_components/ExpediceTimeline.tsx \
        src/app/expedice/_components/ExpedicePage.tsx
git commit -m "feat: přidat Přejít na datum do toolbaru expediční timeline"
```

---

## Etapa C — Read-only role

### Task C1: Karty neklikatelné pro read-only role

**Bug:** `handleSelectItem` se zavolá i pro ne-editory, nastaví `panelMode` a `selectedItem`, ale panel se nevyrenderuje. Karty vypadají klikatelné (cursor pointer), i když klik nic neudělá.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpedicePage.tsx`
- Modify: `src/app/expedice/_components/ExpediceCard.tsx`
- Modify: `src/app/expedice/_components/ExpediceTimeline.tsx`

- [ ] **Krok 1: Neposílat `onSelectItem` pro read-only role v `ExpedicePage`**

V renderu `<ExpediceTimeline>`, změň:
```typescript
// PŘED:
<ExpediceTimeline
  ...
  onSelectItem={handleSelectItem}
  onDoubleClickItem={isEditor ? handleDoubleClickItem : undefined}
  ...
/>

// PO:
<ExpediceTimeline
  ...
  onSelectItem={isEditor ? handleSelectItem : undefined}
  onDoubleClickItem={isEditor ? handleDoubleClickItem : undefined}
  ...
/>
```

- [ ] **Krok 2: Aktualizovat `ExpediceTimelineProps` a předání do `ExpediceCard`**

V `ExpediceTimeline.tsx`, `onSelectItem` udělej volitelné:
```typescript
interface ExpediceTimelineProps {
  // ...
  onSelectItem?: (item: ExpediceItem) => void;  // bylo: onSelectItem: ...
  // ...
}
```

V `ExpediceCard` renderu v timeline, předej `onClick` jen pokud existuje:
```typescript
// PŘED:
onClick={() => onSelectItem(item)}

// PO:
onClick={onSelectItem ? () => onSelectItem(item) : undefined}
```

- [ ] **Krok 3: Opravit `cursor` v `ExpediceCard` pro neklikatelný stav**

V `ExpediceCard.tsx`, styl divu:
```typescript
// PŘED:
cursor: isDraggable ? (isDragging ? "grabbing" : "grab") : "pointer",

// PO:
cursor: isDraggable
  ? (isDragging ? "grabbing" : "grab")
  : onClick ? "pointer" : "default",
```

- [ ] **Krok 4: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 5: Manuálně otestovat**

1. Přihlas se jako VIEWER nebo TISKAR
2. Otevři `/expedice` — timeline se zobrazí na celou šířku
3. Hover nad kartou → cursor je default (ne pointer)
4. Klikni na kartu → nic se nestane

- [ ] **Krok 6: Commitnout**

```bash
git add src/app/expedice/_components/ExpedicePage.tsx \
        src/app/expedice/_components/ExpediceTimeline.tsx \
        src/app/expedice/_components/ExpediceCard.tsx
git commit -m "fix: read-only role nesmí mít klikatelné karty v expediční timeline"
```

---

### Task C2: `title` fallback pro truncované texty

**Spec:** *„minimální fallback je nativní `title`"* pro role bez pravého panelu.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpediceCard.tsx`

- [ ] **Krok 1: Sestavit plný text a přidat jako `title` na kartu**

V `ExpediceCard.tsx`, před returnem sestavíme `titleText`:
```typescript
const titleParts = [
  item.orderNumber,
  item.description,
  item.expediceNote,
  item.doprava,
].filter(Boolean);
const titleText = titleParts.join(" · ");
```

Přidej `title={titleText}` na hlavní div karty:
```typescript
<div
  title={titleText || undefined}
  draggable={isDraggable}
  // ... ostatní props ...
>
```

- [ ] **Krok 2: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 3: Manuálně otestovat**

1. Otevři `/expedice` a nechej hover nad kartou s dlouhým názvem
2. Zobrazí se nativní tooltip s plným textem

- [ ] **Krok 4: Commitnout**

```bash
git add src/app/expedice/_components/ExpediceCard.tsx
git commit -m "feat: přidat title tooltip na expediční karty jako fallback pro zkrácený text"
```

---

## Etapa D — UX detaily a drobné opravy

### Task D1: Kandidátní karta — doplnit `expediceNote` a `doprava`

**Spec:** *„základní data: číslo zakázky, popis, datum expedice, expediceNote, doprava, stroj"* — `expediceNote` a `doprava` chybí.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpediceAside.tsx`

- [ ] **Krok 1: Přidat `expediceNote` a `doprava` do renderu `CandidateCard`**

V `CandidateCard` komponentě (dolní část `ExpediceAside.tsx`), za blok s `description`, přidej:
```typescript
{(candidate.expediceNote || candidate.doprava) && (
  <div style={{
    fontSize: 10, color: "rgba(255,255,255,0.38)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  }}>
    {[candidate.expediceNote, candidate.doprava].filter(Boolean).join(" · ")}
  </div>
)}
```

- [ ] **Krok 2: Ověřit, že `ExpediceCandidate` typ tato pole obsahuje**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
grep -n "ExpediceCandidate" src/lib/expediceTypes.ts 2>/dev/null || grep -rn "ExpediceCandidate" src/
```

Pokud typ pole neobsahuje, přidej `expediceNote?: string | null` a `doprava?: string | null` do interface.

- [ ] **Krok 3: Ověřit, že `GET /api/expedice` tato pole vrací pro kandidáty**

```bash
grep -n "candidates" src/app/api/expedice/route.ts | head -20
grep -A5 "expediceNote" src/app/api/expedice/route.ts | head -20
```

Pokud chybí v select, doplň:
```typescript
// V sekci kde se vybírají kandidáti (block select), přidej:
select: {
  // ... existující pole ...
  expediceNote: true,
  doprava: true,
}
```

- [ ] **Krok 4: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 5: Commitnout**

```bash
git add src/app/expedice/_components/ExpediceAside.tsx
git commit -m "feat: zobrazit expediceNote a doprava na kandidátní kartě v expedici"
```

---

### Task D2: Focus ring na formulářových prvcích

**Bug:** Všechny `<input>` a `<textarea>` mají `outline: "none"` bez náhrady — porušení accessibility a iOS design guidelines.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpediceBuilderPanel.tsx`
- Modify: `src/app/expedice/_components/ExpediceEditorPanel.tsx`

- [ ] **Krok 1: Přidat focus ring do `inputStyle` v `ExpediceBuilderPanel`**

```typescript
// PŘED:
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 7,
  background: "var(--surface-2)", border: "1px solid rgba(255,255,255,0.1)",
  color: "var(--text)", fontSize: 12, outline: "none",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  boxSizing: "border-box",
  transition: "border-color 120ms ease-out",
};

// PO: outline: "none" → outline zůstane jako "none" ale přidáme focus handling přes className nebo onFocus/onBlur state
```

Nejjednodušší přístup bez CSS modules: přidej `onFocus`/`onBlur` na každý `<input>` a `<textarea>`. Alternativa: přidej `<style>` tag do komponenty.

Použij `<style>` tag (jednoduchý, bez nových deps):
```typescript
// Na začátek returnu formuláře, PŘED <form> přidej:
<>
  <style>{`
    .expedice-input:focus {
      border-color: rgba(59,130,246,0.6) !important;
      box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
    }
  `}</style>
  <form ...>
```

Na každý `<input>` a `<textarea>` přidej `className="expedice-input"` a z `inputStyle` odeber `outline: "none"` (nebo ponech — browsery respektují outline:none ale box-shadow zůstane).

Konkrétní změna `inputStyle`:
```typescript
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 7,
  background: "var(--surface-2)", border: "1px solid rgba(255,255,255,0.1)",
  color: "var(--text)", fontSize: 12, outline: "none",
  fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  boxSizing: "border-box",
  transition: "border-color 120ms ease-out, box-shadow 120ms ease-out",
};
```

- [ ] **Krok 2: Stejný postup v `ExpediceEditorPanel`**

Stejné změny: přidej `<style>` tag, přidej `className="expedice-input"` na inputy/textarea.

- [ ] **Krok 3: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 4: Manuálně otestovat**

1. Klikni na pole „Číslo zakázky" v builderu → zobrazí se modrý focus ring (border + box-shadow)

- [ ] **Krok 5: Commitnout**

```bash
git add src/app/expedice/_components/ExpediceBuilderPanel.tsx \
        src/app/expedice/_components/ExpediceEditorPanel.tsx
git commit -m "fix: přidat focus ring na formulářové prvky v expedičním builderu a editoru"
```

---

### Task D3: Větší drag drop target zóna pro frontu

**Bug:** Fronta má jako drop target oblast příliš malou — `minHeight` se nastaví na 48px jen při `isDragOver`, ale uživatel musí nejprve trefit tuto malou zónu.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpediceQueuePanel.tsx`

- [ ] **Krok 1: Přidat permanentní min-height a vizuální cue pro drag stav**

V `ExpediceQueuePanel.tsx`, styl hlavního divu:
```typescript
// PŘED:
style={{
  borderRadius: 8,
  outline: isDragOver ? "2px dashed rgba(59,130,246,0.5)" : undefined,
  background: isDragOver ? "rgba(59,130,246,0.05)" : undefined,
  transition: "all 80ms ease-out",
  minHeight: isDragOver ? 48 : undefined,
}}

// PO:
style={{
  borderRadius: 8,
  outline: isDragOver ? "2px dashed rgba(59,130,246,0.5)" : canReceiveDrop ? "2px dashed rgba(255,255,255,0.1)" : undefined,
  background: isDragOver ? "rgba(59,130,246,0.05)" : undefined,
  transition: "all 80ms ease-out",
  minHeight: canReceiveDrop ? 64 : undefined,
  padding: canReceiveDrop ? "4px" : undefined,
}}
```

Pro prázdnou frontu při aktivním dragu, vyměň text:
```typescript
{items.length === 0 ? (
  <div style={{
    fontSize: 12, color: isDragOver ? "#3b82f6" : "var(--text-muted)",
    padding: "12px 4px", lineHeight: 1.5,
    textAlign: "center",
    minHeight: canReceiveDrop ? 40 : undefined,
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    {isDragOver
      ? "Pustit pro vrácení do fronty"
      : canReceiveDrop
        ? "↓ Sem vrátit do fronty"
        : "Fronta je prázdná — přidej ruční položku přes builder výše."}
  </div>
) : ...}
```

- [ ] **Krok 2: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 3: Manuálně otestovat**

1. Naplánuj ruční položku na den v timeline
2. Přetáhni ji — sekce fronty vpravo zobrazí dashed outline a "↓ Sem vrátit do fronty"
3. Pusť na sekci fronty → položka se vrátí do fronty

- [ ] **Krok 4: Commitnout**

```bash
git add src/app/expedice/_components/ExpediceQueuePanel.tsx
git commit -m "feat: zvětšit a lépe signalizovat drag drop zónu pro frontu v expedici"
```

---

### Task D4: Toolbar — vizuální grupování

**Bug:** Toolbar má 3 skupiny přepínačů bez kontextu. Dividers jsou sotva viditelné.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpedicePage.tsx`

- [ ] **Krok 1: Přidat micro-labely skupin a zvýraznit divider**

Styl `divider` v `ExpedicePage.tsx`, změň opacity:
```typescript
// PŘED:
const divider: React.CSSProperties = {
  width: 1, height: 16, background: "var(--border)", flexShrink: 0,
};

// PO:
const divider: React.CSSProperties = {
  width: 1, height: 16, background: "rgba(255,255,255,0.12)", flexShrink: 0,
};
```

Skupiny filtrů, rozsahu a hustoty obal do `<div>` s `title` atributem (nebo přidej micro-label nad skupinu):

Jednodušší přístup — přidej `title` tooltip na divider divy pro kontext, nebo přidej malý label nad skupinu. Nejméně invazivní: přidej tiny label jako součást skupiny:

```typescript
{/* Filtry */}
<div style={{ display: "flex", alignItems: "center", gap: 2 }}>
  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginRight: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>Typ</span>
  {(["all", "block", "manual", "internal"] as Filter[]).map((f) => { ... })}
</div>

{/* Rozsah */}
<div style={{ display: "flex", alignItems: "center", gap: 2 }}>
  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginRight: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>Rozsah</span>
  {([7, 14, 30] as DaysRange[]).map((d) => ( ... ))}
</div>

{/* Hustota */}
<div style={{ display: "flex", alignItems: "center", gap: 2 }}>
  <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginRight: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>Hustota</span>
  {([ ... ]).map(( ... ))}
</div>
```

- [ ] **Krok 2: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 3: Manuálně ověřit vizuál**

Otevři `/expedice` a zkontroluj, že toolbar má čitelnou strukturu — 3 skupiny s micro-labely Typ / Rozsah / Hustota.

- [ ] **Krok 4: Commitnout**

```bash
git add src/app/expedice/_components/ExpedicePage.tsx
git commit -m "feat: přidat micro-labely skupin do toolbaru expediční stránky"
```

---

## Etapa E — Resizable Aside

### Task E1: Resizable aside se zachováním šířky do localStorage

**Spec:** *„šířka aside do localStorage"*, resizable pattern jako v hlavním planneru.

**Soubory:**
- Modify: `src/app/expedice/_components/ExpedicePage.tsx`
- Modify: `src/app/expedice/_components/ExpediceAside.tsx`

- [ ] **Krok 1: Přidat resize state do `ExpedicePage`**

```typescript
const ASIDE_WIDTH_LS_KEY = "expedice_aside_width";
const ASIDE_MIN = 260;
const ASIDE_MAX = 500;
const ASIDE_DEFAULT = 320;
```

Ve state sekci:
```typescript
const [asideWidth, setAsideWidth] = useState<number>(ASIDE_DEFAULT);
```

Načtení z localStorage — přidej do existujícího `useEffect` pro density, nebo vytvoř nový:
```typescript
useEffect(() => {
  const stored = localStorage.getItem(ASIDE_WIDTH_LS_KEY);
  if (stored) {
    const n = Number(stored);
    if (Number.isFinite(n) && n >= ASIDE_MIN && n <= ASIDE_MAX) {
      setAsideWidth(n);
    }
  }
}, []);
```

- [ ] **Krok 2: Přidat resize handle mezi timeline a aside**

Celé tělo stránky (flex row) získá `ResizeHandle`. Přidej resize logic:
```typescript
const isResizingRef = useRef(false);
const startXRef = useRef(0);
const startWidthRef = useRef(ASIDE_DEFAULT);

function onResizeMouseDown(e: React.MouseEvent) {
  e.preventDefault();
  isResizingRef.current = true;
  startXRef.current = e.clientX;
  startWidthRef.current = asideWidth;

  function onMove(ev: MouseEvent) {
    if (!isResizingRef.current) return;
    const delta = startXRef.current - ev.clientX; // táhnout doleva = rozšíření aside
    const newWidth = Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, startWidthRef.current + delta));
    setAsideWidth(newWidth);
  }
  function onUp() {
    isResizingRef.current = false;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    // Uložit do localStorage
    setAsideWidth((w) => {
      localStorage.setItem(ASIDE_WIDTH_LS_KEY, String(w));
      return w;
    });
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
```

- [ ] **Krok 3: Vložit resize handle do renderu**

Mezi `<ExpediceTimeline ... />` a `<ExpediceAside ... />` vlož:
```typescript
{isEditor && data && (
  <div
    onMouseDown={onResizeMouseDown}
    style={{
      width: 4, flexShrink: 0, cursor: "col-resize",
      background: "transparent",
      borderLeft: "1px solid var(--border)",
      transition: "background 80ms ease-out",
    }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(59,130,246,0.25)"; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
  />
)}
```

Předej `width={asideWidth}` do `<ExpediceAside>`.

- [ ] **Krok 4: Ověřit TypeScript**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Krok 5: Manuálně otestovat**

1. Otevři `/expedice` jako ADMIN
2. Přetáhni levý okraj aside doleva/doprava → aside se rozšiřuje/zužuje
3. Refresh stránky → šířka zůstala

- [ ] **Krok 6: Commitnout**

```bash
git add src/app/expedice/_components/ExpedicePage.tsx \
        src/app/expedice/_components/ExpediceAside.tsx
git commit -m "feat: resizable aside s persistencí šířky v expedičním plánu"
```

---

## Souhrnný pořadník etap a závislosti

```
Etapa A (bugfixy) → žádná závislost, implementuj jako první
Etapa B (navigace) → závisí na Etapě A (aby byl stav aplikace čistý při testování)
Etapa C (read-only) → nezávislá, může paralelně s B
Etapa D (UX detaily) → nezávislá, může kdykoliv
Etapa E (resize) → nezávislá, může kdykoliv po A
```

## Ověření po dokončení všech etap

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npx tsc --noEmit
npx eslint src/app/expedice/
npm run build 2>&1 | tail -20
```

Očekáváno: 0 chyb TypeScript, 0 ESLint chyb, build prošel.
