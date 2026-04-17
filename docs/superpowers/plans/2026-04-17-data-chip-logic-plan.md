# DATA chip — logika jednoho stavu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Data na bloku mají vždy jeden vizuální stav — buď datum (kalendář), nebo chip (status label). `dataOk` se auto-derivuje, single-klik toggle se odstraní.

**Architecture:** `dataStatusId !== null` řídí vizuál místo `dataOk`. Server auto-derivuje `dataOk` a auto-clearuje chip při změně data. UI odstraňuje `dataOk` checkbox a single-klik toggle.

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Tailwind CSS v4, Prisma 5, MySQL

---

## Soubory

| Soubor | Akce |
|--------|------|
| `src/app/api/blocks/[id]/route.ts` | Modify: auto-derivace `dataOk`, auto-clear chipu při změně data |
| `src/app/api/blocks/route.ts` | Modify: auto-derivace `dataOk` při POST |
| `src/components/DtpDataPopover.tsx` | Modify: odstranit `dataOk` toggle, auto-derivovat v save |
| `src/components/BlockEdit.tsx` | Modify: odstranit `dataOk` checkbox, auto-clear chipu při změně data, auto-derivovat v payloadu |
| `src/app/_components/TimelineGrid.tsx` | Modify: vizuální pravidlo `dataStatusId` místo `dataOk`, odstranit single-klik toggle pro DATA |
| `src/app/_components/PlannerPage.tsx` | Modify: odstranit `dataOk` z DTP popover stavu, upravit handlery |

---

## Task 1: API — serverová pojistka v PUT `/api/blocks/[id]`

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts:257-263`

- [ ] **Step 1: Přidat auto-derivaci za `Object.keys(allowed)` cleanup (řádek 102)**

V `src/app/api/blocks/[id]/route.ts`, najdi řádek 102:
```typescript
    Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);
```

Bezprostředně **za** tento řádek přidej:

```typescript
    // ── DATA chip auto-derivace ──
    // Pravidlo 1: Změna data → vymazat chip + dataOk=false
    if (allowed.dataRequiredDate !== undefined) {
      allowed.dataStatusId = null;
      allowed.dataStatusLabel = null;
      allowed.dataOk = false;
    }
    // Pravidlo 2: Změna chipu → auto-derivovat dataOk
    if (allowed.dataStatusId !== undefined && allowed.dataRequiredDate === undefined) {
      allowed.dataOk = allowed.dataStatusId !== null;
    }
```

Poznámka: Pravidlo 1 má přednost — pokud přijde současně `dataRequiredDate` i `dataStatusId` (nemělo by nastat z UI, ale serverová pojistka), datum vyhrává a chip se maže.

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/blocks/[id]/route.ts
git commit -m "feat: DATA chip auto-derivace v PUT /api/blocks/[id] — datum maže chip, chip derivuje dataOk"
```

---

## Task 2: API — auto-derivace v POST `/api/blocks`

**Files:**
- Modify: `src/app/api/blocks/route.ts:128-131`

- [ ] **Step 1: Upravit DATA sekci v `tx.block.create`**

V `src/app/api/blocks/route.ts`, najdi řádky 127-131:
```typescript
          // DATA
          dataStatusId: body.dataStatusId ?? null,
          dataStatusLabel: body.dataStatusLabel ?? null,
          dataRequiredDate: parseNullableCivilDateForDb(body.dataRequiredDate),
          dataOk: body.dataOk ?? false,
```

Změň na:
```typescript
          // DATA — auto-derivace: dataOk = true pokud chip nastaven
          dataStatusId: body.dataStatusId ?? null,
          dataStatusLabel: body.dataStatusLabel ?? null,
          dataRequiredDate: parseNullableCivilDateForDb(body.dataRequiredDate),
          dataOk: body.dataStatusId ? true : false,
```

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/blocks/route.ts
git commit -m "feat: DATA auto-derivace dataOk v POST /api/blocks"
```

---

## Task 3: DtpDataPopover — odstranit `dataOk` toggle

**Files:**
- Modify: `src/components/DtpDataPopover.tsx`

- [ ] **Step 1: Odstranit `currentOk` z props a `ok` stav**

Celý obsah `src/components/DtpDataPopover.tsx` nahradit:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import type { CodebookOption } from "@/lib/plannerTypes";

interface Props {
  blockId: number;
  currentStatusId: number | null;
  dataOpts: CodebookOption[];
  anchorRect: DOMRect;
  onClose: () => void;
  onSave: (blockId: number, patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }) => Promise<void>;
}

export function DtpDataPopover({ blockId, currentStatusId, dataOpts, anchorRect, onClose, onSave }: Props) {
  const [statusId, setStatusId] = useState<string>(currentStatusId?.toString() ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const isDirtyRef = useRef(false);
  const statusIdRef = useRef(statusId);

  // Sleduj změny
  useEffect(() => {
    const changed = statusId !== (currentStatusId?.toString() ?? "");
    isDirtyRef.current = changed;
  }, [statusId, currentStatusId]);

  // Udržuj ref aktuální pro handleClose
  useEffect(() => {
    statusIdRef.current = statusId;
  }, [statusId]);

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
      const currentStatusId = statusIdRef.current;
      const selectedOpt = dataOpts.find((o) => o.id.toString() === currentStatusId);
      onSave(blockId, {
        dataStatusId: currentStatusId ? parseInt(currentStatusId, 10) : null,
        dataStatusLabel: selectedOpt?.label ?? null,
        dataOk: !!currentStatusId,
      });
    }
    onClose();
  }

  // Pozice: pod anchorRect, zarovnáno vlevo (position: fixed je relativní k viewportu, ne k dokumentu)
  const top = anchorRect.bottom + 4;
  const left = Math.max(4, Math.min(anchorRect.left, window.innerWidth - 210));

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
          cursor: "pointer",
          outline: "none",
        }}
      >
        <option value="">— bez statusu —</option>
        {dataOpts.filter((o) => o.isActive).map((o) => (
          <option key={o.id} value={o.id.toString()}>{o.label}</option>
        ))}
      </select>

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
Očekávaný výstup: Build SELŽE — PlannerPage předává `currentOk` prop, který už neexistuje. To opravíme v Task 6.

- [ ] **Step 3: Commit (WIP)**

```bash
git add src/components/DtpDataPopover.tsx
git commit -m "feat: DtpDataPopover — odstranit dataOk toggle, auto-derivovat z statusId"
```

---

## Task 4: BlockEdit — odstranit `dataOk` checkbox, přidat auto-clear

**Files:**
- Modify: `src/components/BlockEdit.tsx`

- [ ] **Step 1: Odstranit `dataOk` stav a přidat auto-clear**

V `src/components/BlockEdit.tsx` řádek 119, najdi:
```typescript
  const [dataOk, setDataOk] = useState(block.dataOk);
```

Smaž tento řádek.

- [ ] **Step 2: Upravit `setDataRequiredDate` aby clearoval chip**

Najdi řádek 116-118:
```typescript
  const [dataRequiredDate, setDataRequiredDate] = useState(
    block.dataRequiredDate ? utcToPragueDateStr(new Date(block.dataRequiredDate)) : ""
  );
```

Nahraď:
```typescript
  const [dataRequiredDate, setDataRequiredDate_raw] = useState(
    block.dataRequiredDate ? utcToPragueDateStr(new Date(block.dataRequiredDate)) : ""
  );
  // Změna data → auto-clear chipu
  function setDataRequiredDate(val: string) {
    setDataRequiredDate_raw(val);
    if (val !== dataRequiredDate) {
      setDataStatusId("");
    }
  }
```

Poznámka: `setDataRequiredDate` se volá z `DatePickerField` onChange — wrapper zajistí auto-clear.

- [ ] **Step 3: Auto-derivovat `dataOk` v buildPayload**

V `src/components/BlockEdit.tsx` řádek 384-387, najdi:
```typescript
      dataStatusId: dataStatusId ? parseInt(dataStatusId) : null,
      dataStatusLabel: dataStatusId ? resolveLabel(dataOpts, dataStatusId) : null,
      dataRequiredDate: dataRequiredDate || null,
      dataOk,
```

Změň poslední řádek:
```typescript
      dataStatusId: dataStatusId ? parseInt(dataStatusId) : null,
      dataStatusLabel: dataStatusId ? resolveLabel(dataOpts, dataStatusId) : null,
      dataRequiredDate: dataRequiredDate || null,
      dataOk: !!dataStatusId,
```

- [ ] **Step 4: Odstranit `dataOk` checkbox z UI**

V `src/components/BlockEdit.tsx` řádky 725-731, najdi celý blok `dataOk` checkboxu:
```typescript
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: dataOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                  <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: dataOk ? "var(--success)" : "transparent", border: dataOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                    {dataOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={dataOk} onChange={(e) => setDataOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                  OK
                </label>
```

Smaž celý tento `<label>` blok (řádky 725-731).

- [ ] **Step 5: Upravit reset funkce pro sérii**

V `src/components/BlockEdit.tsx` najdi funkci kde se nastavuje `setDataStatusId` při resetu série (kolem řádků 321, 345, 362). Zkontroluj, že `setDataOk` se nikde nevolá — pokud ano, smaž tyto volání.

Hledej:
```
setDataOk
```

Pokud najdeš jakékoli `setDataOk(...)` volání, smaž je — `dataOk` se už nenastavuje z UI.

- [ ] **Step 6: Build check**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add src/components/BlockEdit.tsx
git commit -m "feat: BlockEdit — odstranit dataOk checkbox, auto-clear chipu při změně data, auto-derivovat dataOk"
```

---

## Task 5: TimelineGrid — nové vizuální pravidlo + odstranit single-klik toggle

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`

- [ ] **Step 1: Změnit vizuální pravidlo — `dataDisplayLabel`**

V `src/app/_components/TimelineGrid.tsx` řádek 839, najdi:
```typescript
  const dataDisplayLabel = block.dataStatusLabel?.trim() || "OK";
```

Změň na:
```typescript
  const dataDisplayLabel = block.dataStatusLabel?.trim() || "";
```

Poznámka: Fallback "OK" už nepotřebujeme — pokud nemá chip, zobrazíme datum.

- [ ] **Step 2: Změnit `dataCanToggle`**

Řádek 840, najdi:
```typescript
  const dataCanToggle = block.dataOk || !!block.dataRequiredDate;
```

Změň na:
```typescript
  const dataCanToggle = false;
```

Single-klik na DATA chip nic nedělá pro žádnou roli.

- [ ] **Step 3: Změnit `dStateKey` v MODE_COMPACT (řádek 1006)**

Najdi řádek 1006:
```typescript
        const dStateKey = block.dataOk ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
```

Změň na:
```typescript
        const dStateKey = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
```

- [ ] **Step 4: Změnit zobrazení chipu v MODE_COMPACT (řádek 1040)**

Najdi řádek 1040:
```typescript
                  {block.dataOk ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
```

Změň na:
```typescript
                  {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
```

- [ ] **Step 5: Změnit `dStateKey` v MODE_TINY (řádek 1107)**

Najdi řádek 1107:
```typescript
        const dStateKey = block.dataOk ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
```

Změň na:
```typescript
        const dStateKey = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
```

- [ ] **Step 6: Změnit zobrazení chipu v MODE_TINY (řádek 1140)**

Najdi řádek 1140:
```typescript
                  {block.dataOk ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
```

Změň na:
```typescript
                  {block.dataStatusId ? dataDisplayLabel : `D\u00a0${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
```

- [ ] **Step 7: Zkontrolovat full view chip (hledej třetí výskyt `block.dataOk ? dataDisplayLabel`)**

Pokud existuje třetí MODE (full view) s podobným řádkem, udělej stejnou změnu: `block.dataOk` → `block.dataStatusId`.

Hledej pattern: `block.dataOk ? dataDisplayLabel`

- [ ] **Step 8: Najít a upravit `hasProductionContent` check**

Hledej v TimelineGrid:
```
block.dataStatusLabel ||
```

Toto je v podmínce `hasProductionContent` (kolem řádku 874). Tato podmínka zůstává beze změny — chip label se stále zobrazuje pokud existuje.

- [ ] **Step 9: Build check**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 10: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: TimelineGrid — dataStatusId řídí vizuál, single-klik toggle odstraněn"
```

---

## Task 6: PlannerPage — propojit vše dohromady

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 1: Odstranit `ok` z dtpPopover stavu**

V `src/app/_components/PlannerPage.tsx` řádky 769-774, najdi:
```typescript
  const [dtpPopover, setDtpPopover] = useState<{
    blockId: number;
    statusId: number | null;
    ok: boolean;
    rect: DOMRect;
  } | null>(null);
```

Změň na:
```typescript
  const [dtpPopover, setDtpPopover] = useState<{
    blockId: number;
    statusId: number | null;
    rect: DOMRect;
  } | null>(null);
```

- [ ] **Step 2: Upravit `handleDataChipDoubleClick`**

Řádky 1451-1460, najdi:
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

Změň na:
```typescript
  function handleDataChipDoubleClick(blockId: number, rect: DOMRect) {
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    setDtpPopover({
      blockId,
      statusId: block.dataStatusId ?? null,
      rect,
    });
  }
```

- [ ] **Step 3: Odstranit `currentOk` prop z DtpDataPopover renderu**

Řádky 3734-3744, najdi:
```typescript
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

Změň na:
```typescript
      {dtpPopover && (
        <DtpDataPopover
          blockId={dtpPopover.blockId}
          currentStatusId={dtpPopover.statusId}
          dataOpts={bDataOpts}
          anchorRect={dtpPopover.rect}
          onClose={() => setDtpPopover(null)}
          onSave={handleDtpPopoverSave}
        />
      )}
```

- [ ] **Step 4: Build check**

```bash
npm run build 2>&1 | tail -20
```
Očekávaný výstup: `✓ Compiled successfully`

- [ ] **Step 5: Spustit existující testy**

```bash
node --test --import tsx src/lib/dateUtils.test.ts && node --test --import tsx src/lib/errors.test.ts && node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```
Očekávaný výstup: 24/24 testů zelené (žádný z existujících testů netestuje DATA chip logiku)

- [ ] **Step 6: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat: PlannerPage — propojení nové DATA chip logiky, odstranění dataOk z popover stavu"
```

---

## Task 7: Manuální ověření

- [ ] **Step 1: Spustit dev server**

```bash
npm run dev
```

- [ ] **Step 2: Ověření jako PLANOVAT / ADMIN**

1. Přihlásit se jako `admin` / `admin`
2. Otevřít blok dvojklikem → BlockEdit panel
3. Ověřit, že **neexistuje `dataOk` checkbox** v sekci DATA
4. Nastavit datum dodání dat (např. 20.4.) → uložit → na timeline se zobrazí `D 20.4.`
5. Znovu otevřít blok, vybrat status chip (např. "Připraveno") → uložit → na timeline se zobrazí chip "Připraveno" místo data
6. Znovu otevřít blok, změnit datum na 25.4. → ověřit, že status dropdown se automaticky vymazal
7. Uložit → na timeline se zobrazí `D 25.4.` (chip zmizí)
8. Double-klik na DATA chip na timeline → otevře se datepicker (beze změny)
9. Single-klik na DATA chip → nic se nestane (bez toggle)

- [ ] **Step 3: Ověření jako DTP**

1. Přihlásit se jako `dtp` / `dtp`
2. Double-klik na DATA chip → otevře se popover jen se status dropdownem (žádný dataOk toggle)
3. Vybrat status → kliknout mimo → popover se zavře, chip se aktualizuje
4. Obnovit stránku → stav je uložen
5. Single-klik na DATA chip → nic se nestane

- [ ] **Step 4: Ověření edge case — blok s existujícím chipem + datem**

1. Jako ADMIN nastavit bloku datum 20.4. a status "K DTP"
2. Na timeline se zobrazí chip "K DTP" (ne datum)
3. Jako ADMIN změnit datum na 25.4. → chip zmizí, zobrazí se `D 25.4.`
