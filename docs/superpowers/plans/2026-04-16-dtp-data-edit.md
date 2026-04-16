# DTP Data Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zúžit oprávnění DTP (odebrat editaci datumu dat) a přidat popover pro rychlou editaci DATA statusu a dataOk přímo z DATA chipu na timeline.

**Architecture:** Rozdělení `canEditData` na dvě příznaky (`canEditData` = status+ok, `canEditDataDate` = datum). Nová komponenta `DtpDataPopover` se otevírá dvojklikem na DATA chip. Auto-save při zavření přes existující PUT endpoint.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Tailwind CSS v4, Prisma 5, MySQL

---

## Soubory

| Soubor | Akce |
|--------|------|
| `src/app/api/blocks/[id]/route.ts` | Modify: odebrat `dataRequiredDate` z DTP `allowed` |
| `src/app/_components/PlannerPage.tsx` | Modify: přidat `canEditDataDate`, stav poporveru, callback |
| `src/app/_components/TimelineGrid.tsx` | Modify: přidat `canEditDataDate` prop, upravit `dataCanOpenCalendar`, přidat `onDataChipDoubleClick` |
| `src/components/BlockEdit.tsx` | Modify: přidat `canEditDataDate` prop, uzamknout datum |
| `src/components/DtpDataPopover.tsx` | Create: nová komponenta poporveru |

---

## Task 1: Serverová pojistka — odebrat dataRequiredDate z DTP allowed

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts:70-76`

- [ ] **Step 1: Upravit DTP allowed blok v PUT handleru**

V souboru `src/app/api/blocks/[id]/route.ts` najdi blok (kolem řádku 70):
```typescript
} else if (session.role === "DTP") {
  allowed = {
    dataStatusId: body.dataStatusId,
    dataStatusLabel: body.dataStatusLabel,
    dataRequiredDate: body.dataRequiredDate,
    dataOk: body.dataOk,
  };
}
```
Změň na:
```typescript
} else if (session.role === "DTP") {
  allowed = {
    dataStatusId: body.dataStatusId,
    dataStatusLabel: body.dataStatusLabel,
    dataOk: body.dataOk,
  };
}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully` (nebo jen existující warningy, žádné nové chyby).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/blocks/[id]/route.ts
git commit -m "fix: odebrat dataRequiredDate z DTP allowed v PUT /api/blocks/[id]"
```

---

## Task 2: Nová komponenta DtpDataPopover

**Files:**
- Create: `src/components/DtpDataPopover.tsx`

- [ ] **Step 1: Vytvořit soubor komponenty**

Vytvoř `src/components/DtpDataPopover.tsx` s tímto obsahem:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { CodebookOption } from "@/lib/plannerTypes";

interface Props {
  blockId: number;
  currentStatusId: number | null;
  currentOk: boolean;
  dataOpts: CodebookOption[];
  anchorRect: DOMRect;
  onClose: () => void;
  onSave: (blockId: number, patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }) => Promise<void>;
}

export function DtpDataPopover({ blockId, currentStatusId, currentOk, dataOpts, anchorRect, onClose, onSave }: Props) {
  const [statusId, setStatusId] = useState<string>(currentStatusId?.toString() ?? "");
  const [ok, setOk] = useState(currentOk);
  const ref = useRef<HTMLDivElement>(null);
  const isDirtyRef = useRef(false);

  // Sleduj změny
  useEffect(() => {
    const changed = statusId !== (currentStatusId?.toString() ?? "") || ok !== currentOk;
    isDirtyRef.current = changed;
  }, [statusId, ok, currentStatusId, currentOk]);

  // Zavření klikem mimo
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handleClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    if (isDirtyRef.current) {
      const selectedOpt = dataOpts.find((o) => o.id.toString() === statusId);
      onSave(blockId, {
        dataStatusId: statusId ? parseInt(statusId) : null,
        dataStatusLabel: selectedOpt?.label ?? null,
        dataOk: ok,
      });
    }
    onClose();
  }

  // Pozice: pod anchorRect, zarovnáno vlevo
  const top = anchorRect.bottom + window.scrollY + 4;
  const left = Math.min(anchorRect.left + window.scrollX, window.innerWidth - 210);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 600,
        background: "#1c1c1e",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 12,
        padding: "12px 14px",
        width: 196,
        boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
      }}
    >
      {/* DATA status */}
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 5, fontWeight: 600, letterSpacing: "0.04em" }}>
        Status
      </div>
      <select
        value={statusId}
        onChange={(e) => setStatusId(e.target.value)}
        style={{
          width: "100%",
          background: "#2c2c2e",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 7,
          padding: "6px 10px",
          color: "#e2e8f0",
          fontSize: 13,
          marginBottom: 10,
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">— bez statusu —</option>
        {dataOpts.filter((o) => o.isActive).map((o) => (
          <option key={o.id} value={o.id.toString()}>{o.label}</option>
        ))}
      </select>

      {/* Oddělovač */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.08)", marginBottom: 10 }} />

      {/* dataOk toggle */}
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <div
          onClick={() => setOk((v) => !v)}
          style={{
            width: 36,
            height: 20,
            background: ok ? "#22c55e" : "#3a3a3c",
            borderRadius: 10,
            position: "relative",
            flexShrink: 0,
            transition: "background 150ms ease-out",
            cursor: "pointer",
          }}
        >
          <div style={{
            width: 16,
            height: 16,
            background: "white",
            borderRadius: "50%",
            position: "absolute",
            top: 2,
            left: ok ? 18 : 2,
            transition: "left 150ms ease-out",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }} />
        </div>
        <span style={{ fontSize: 13, color: ok ? "#4ade80" : "rgba(255,255,255,0.6)", fontWeight: 500, transition: "color 150ms" }}>
          data.ok
        </span>
      </label>

      {/* Hint */}
      <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.2)", textAlign: "center" }}>
        ukládá se automaticky při zavření
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add src/components/DtpDataPopover.tsx
git commit -m "feat: nová komponenta DtpDataPopover"
```

---

## Task 3: BlockEdit — uzamknout datum pro DTP

**Files:**
- Modify: `src/components/BlockEdit.tsx:66-68` (props), `:710` (DATA datum sekce)

- [ ] **Step 1: Přidat canEditDataDate prop**

V `src/components/BlockEdit.tsx` najdi props destrukturaci (kolem řádku 66):
```typescript
  canEdit = true,
  canEditData = true,
  canEditMat = true,
```
Změň na:
```typescript
  canEdit = true,
  canEditData = true,
  canEditDataDate = true,
  canEditMat = true,
```

A v interface (kolem řádku 83):
```typescript
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
```
Změň na:
```typescript
  canEdit?: boolean;
  canEditData?: boolean;
  canEditDataDate?: boolean;
  canEditMat?: boolean;
```

- [ ] **Step 2: Uzamknout DatePickerField pro datum DATA**

V sekci `{/* DATA */}` (kolem řádku 710) najdi:
```typescript
              <div style={{ opacity: !canEditData ? 0.45 : 1, pointerEvents: !canEditData ? "none" : "auto" }}>
                <ColLabel>DATA</ColLabel>
                <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum" />
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5,
```
Změň na:
```typescript
              <div style={{ opacity: !canEditData ? 0.45 : 1, pointerEvents: !canEditData ? "none" : "auto" }}>
                <ColLabel>DATA</ColLabel>
                <div style={{ pointerEvents: !canEditDataDate ? "none" : "auto", opacity: !canEditDataDate ? 0.45 : 1 }}>
                  <DatePickerField value={dataRequiredDate} onChange={setDataRequiredDate} placeholder="Datum" />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5,
```

Poznámka: uzavírací `</div>` sekce DATA je až za checkboxem OK — nevkládej žádný nový `</div>`, pouze obal DatePickerField.

- [ ] **Step 3: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully`

- [ ] **Step 4: Commit**

```bash
git add src/components/BlockEdit.tsx
git commit -m "feat: BlockEdit uzamknout datum DATA pro DTP (canEditDataDate prop)"
```

---

## Task 4: TimelineGrid — přidat canEditDataDate a onDataChipDoubleClick

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` (BlockCard props interface, dataCanOpenCalendar, dvojklik handler)

- [ ] **Step 1: Přidat canEditDataDate a onDataChipDoubleClick do TimelineGrid props interface**

Najdi v `TimelineGrid.tsx` (kolem řádku 203) — props interface celého TimelineGrid:
```typescript
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
```
Změň na:
```typescript
  canEdit?: boolean;
  canEditData?: boolean;
  canEditDataDate?: boolean;
  canEditMat?: boolean;
  onDataChipDoubleClick?: (blockId: number, rect: DOMRect) => void;
```

Stejnou změnu udělej v destructuraci parametrů samotné `TimelineGrid` funkce — přidej `canEditDataDate` a `onDataChipDoubleClick` vedle ostatních.

A v `BlockCard` props interface (kolem řádku 797):
```typescript
  canEdit?: boolean;
  canEditData?: boolean;
  canEditMat?: boolean;
```
Změň na:
```typescript
  canEdit?: boolean;
  canEditData?: boolean;
  canEditDataDate?: boolean;
  canEditMat?: boolean;
```

- [ ] **Step 2: Přidat onDataChipDoubleClick do BlockCard props**

V BlockCard props interface za `canEditDataDate` přidej:
```typescript
  onDataChipDoubleClick?: (blockId: number, rect: DOMRect) => void;
```

A v destrukturaci parametrů BlockCard (kolem řádku 775) přidej `canEditDataDate` a `onDataChipDoubleClick`:
```typescript
  canEdit, canEditData, canEditDataDate, canEditMat, onInlineDatePick, badgeColorMap,
  onBlockCopy, onBlockSplit, getSplitAt, isTiskar, onPrintComplete, onNotify, onBlockVariantChange,
  onExpeditionPublish, onExpeditionUnpublish,
  onDataChipDoubleClick,
  splitPart, splitTotal,
```

- [ ] **Step 3: Upravit dataCanOpenCalendar a přidat dataCanOpenDtpPopover**

Najdi (kolem řádku 836):
```typescript
  const dataCanOpenCalendar = !block.dataOk && canEditData && !!onInlineDatePick;
```
Změň na:
```typescript
  const dataCanOpenCalendar    = !block.dataOk && !!canEditDataDate && !!onInlineDatePick;
  const dataCanOpenDtpPopover  = !!canEditData && !canEditDataDate && !!onDataChipDoubleClick;
```

- [ ] **Step 4: Přidat onDoubleClick handler na DATA chip v compact view**

Najdi DATA chip v compact view (kolem řádku 1022):
```typescript
                  onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar) { ... } else { toggleField("dataOk", block.dataOk); } } : undefined}
                  onDoubleClick={dataCanOpenCalendar ? (e) => { e.stopPropagation(); if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; } onInlineDatePick(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
```
Změň `onDoubleClick` na:
```typescript
                  onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                    e.stopPropagation();
                    if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                    if (dataCanOpenCalendar) {
                      onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                    } else if (dataCanOpenDtpPopover) {
                      onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                    }
                  } : undefined}>
```

- [ ] **Step 5: Přidat onDoubleClick handler na DATA chip v full view**

Najdi DATA chip ve full view (kolem řádku 1113):
```typescript
                  onDoubleClick={dataCanOpenCalendar ? (e) => { e.stopPropagation(); if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; } onInlineDatePick(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
```
Změň na:
```typescript
                  onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                    e.stopPropagation();
                    if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                    if (dataCanOpenCalendar) {
                      onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                    } else if (dataCanOpenDtpPopover) {
                      onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                    }
                  } : undefined}>
```

- [ ] **Step 6: Předat canEditDataDate a onDataChipDoubleClick při renderu BlockCard v TimelineGrid**

Najdi renderování BlockCard (kolem řádku 2784):
```typescript
                      canEdit={canEdit}
                      canEditData={canEditData}
                      canEditMat={canEditMat}
```
Změň na:
```typescript
                      canEdit={canEdit}
                      canEditData={canEditData}
                      canEditDataDate={canEditDataDate}
                      canEditMat={canEditMat}
```
A za `onInlineDatePick` prop přidej:
```typescript
                      onDataChipDoubleClick={onDataChipDoubleClick}
```

- [ ] **Step 7: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully`

- [ ] **Step 8: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: TimelineGrid canEditDataDate + onDataChipDoubleClick callback"
```

---

## Task 5: PlannerPage — zapojit vše dohromady

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 1: Přidat canEditDataDate a importovat DtpDataPopover**

Najdi v `PlannerPage.tsx` import sekci a přidej:
```typescript
import { DtpDataPopover } from "@/components/DtpDataPopover";
```

Najdi permissions blok (kolem řádku 499):
```typescript
  const canEdit     = ["ADMIN", "PLANOVAT"].includes(currentUser.role);
  const canEditData = canEdit || currentUser.role === "DTP";
  const canEditMat  = canEdit || currentUser.role === "MTZ";
```
Změň na:
```typescript
  const canEdit         = ["ADMIN", "PLANOVAT"].includes(currentUser.role);
  const canEditData     = canEdit || currentUser.role === "DTP";
  const canEditDataDate = canEdit;
  const canEditMat      = canEdit || currentUser.role === "MTZ";
```

- [ ] **Step 2: Přidat state pro DtpDataPopover**

Najdi skupinu useState hooků a přidej (klidně za existující inline datepicker state):
```typescript
  const [dtpPopover, setDtpPopover] = useState<{
    blockId: number;
    statusId: number | null;
    ok: boolean;
    rect: DOMRect;
  } | null>(null);
```

- [ ] **Step 3: Přidat handler pro otevření poporveru**

Přidej novou funkci (klidně vedle ostatních block handlerů):
```typescript
  function handleDataChipDoubleClick(blockId: number, rect: DOMRect) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    setDtpPopover({
      blockId,
      statusId: block.dataStatusId ?? null,
      ok: block.dataOk,
      rect,
    });
  }
```

- [ ] **Step 4: Přidat handler pro uložení z poporveru**

```typescript
  async function handleDtpPopoverSave(
    blockId: number,
    patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }
  ) {
    try {
      const res = await fetch(`/api/blocks/${blockId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error ?? "Chyba při ukládání.", "error");
        return;
      }
      const updated: Block = await res.json();
      setBlocks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch {
      showToast("Chyba při ukládání.", "error");
    }
  }
```

- [ ] **Step 5: Předat canEditDataDate a onDataChipDoubleClick do TimelineGrid**

Najdi `<TimelineGrid` v JSX a přidej prop za `canEditData`:
```typescript
            canEditData={canEditData}
            canEditDataDate={canEditDataDate}
            canEditMat={canEditMat}
```
A za `onInlineDatePick` přidej:
```typescript
            onDataChipDoubleClick={canEditData && !canEditDataDate ? handleDataChipDoubleClick : undefined}
```

- [ ] **Step 6: Předat canEditDataDate do BlockEdit**

Najdi `<BlockEdit` v JSX a přidej prop:
```typescript
              canEdit={canEdit}
              canEditData={canEditData}
              canEditDataDate={canEditDataDate}
              canEditMat={canEditMat}
```

- [ ] **Step 7: Renderovat DtpDataPopover**

Najdi konec JSX returnu v PlannerPage (před posledním `</div>` nebo za ToastContainer) a přidej:
```tsx
      {dtpPopover && (
        <DtpDataPopover
          blockId={dtpPopover.blockId}
          currentStatusId={dtpPopover.statusId}
          currentOk={dtpPopover.ok}
          dataOpts={bDataOpts}
          anchorRect={dtpPopover.rect}
          onClose={() => setDtpPopover(null)}
          onSave={handleDtpPopoverSave}
        />
      )}
```

- [ ] **Step 8: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully`

- [ ] **Step 9: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat: DTP popover zapojení do PlannerPage, canEditDataDate"
```

---

## Task 6: Manuální ověření

- [ ] **Step 1: Spustit dev server**

```bash
npm run dev
```

- [ ] **Step 2: Přihlásit se jako DTP a ověřit**

1. Přihlásit se jako `dtp` / `dtp`
2. Kliknout na DATA chip → toggle dataOk funguje (klik = přepnutí)
3. Dvojkliknout na DATA chip → otevře se `DtpDataPopover`
4. Změnit status v dropdownu → kliknout mimo → popover se zavře
5. Obnovit stránku → nový status je uložen v DB
6. Ověřit, že `BlockEdit` panel DATA datum je uzamčen (šedivý, nelze kliknout)

- [ ] **Step 3: Přihlásit se jako PLANOVAT a ověřit, že se nic nerozbilo**

1. Dvojklik na DATA chip → otevírá se inline datepicker (beze změny)
2. `BlockEdit` panel DATA datum → editovatelné (beze změny)

- [ ] **Step 4: Spustit testy**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```
Očekávaný výstup: `24/24 testů zelené`
