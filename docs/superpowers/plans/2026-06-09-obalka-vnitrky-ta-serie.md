# OBÁLKA / VNITŘKY + Tiskové archy + Série — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat na blok dvě označení (OBÁLKA, VNITŘKY) zobrazená jako barevné štítky v plánu i DTP, plus dva multi-select metadata (Tiskové archy, Série) spravované v admin číselnících.

**Architecture:** Čtyři additivní skalární pole na modelu `Block` (2 boolean + 2 JSON-string). Multi-selecty se ukládají jako JSON pole labelů přes helper `productionTags.ts`. Nová UI komponenta `MultiSelectDropdown`. Štítky OBÁLKA/VNITŘKY se kreslí ve 3 velikostních režimech bloku v `TimelineGrid` + na DTP kartě. TA/Série jen ve formuláři a read-only detailu. Žádný foreign key (produkční `Block.id` je `INT UNSIGNED`).

**Tech Stack:** Next.js 16, React, TypeScript, Prisma 5, MySQL, `node --test` (tsx) pro unit testy.

**Spec:** `docs/superpowers/specs/2026-06-09-obalka-vnitrky-ta-serie-design.md`
**Vizuál:** `docs/superpowers/mockups/scene-timeline.html`, `scene-form-dtp.html`

**Pravidla projektu (KRITICKÉ):**
- Pracovat jen na větvi `Vojta`. NEpřepínat větve.
- NIKDY nespouštět `prisma db pull` ani `prisma format` (přejmenuje relace, rozbije kód). Schema editovat ručně.
- Po každé etapě: `npm run build` musí projít. Pak STOP a čekat na OK od Vojty.
- API: `AppError`/`isAppError`, `logger` (ne `console`), mutace v `$transaction` s auditem.

---

## File Structure

**Nové soubory:**
- `src/lib/productionTags.ts` — parse/serialize/format JSON pole labelů (+ test)
- `src/lib/productionTags.test.ts` — unit testy helperu
- `src/components/MultiSelectDropdown.tsx` — multi-select popover (checkbox seznam)
- `prisma/migrations/<timestamp>_add_obalka_vnitrky_ta_serie/migration.sql` — generuje `prisma migrate dev`

**Upravené soubory:**
- `prisma/schema.prisma` — 4 pole na `Block`
- `src/app/_components/TimelineGrid.tsx` — typ `Block` (+4 optional pole) + štítky ve 3 režimech
- `src/app/api/blocks/route.ts` — POST create data (+4 pole)
- `src/app/api/blocks/[id]/route.ts` — PUT update data + AUDITED_FIELDS (+4 pole)
- `src/lib/auditFormatters.ts` — `FIELD_LABELS` + `fmtAuditVal` (+4 pole)
- `src/lib/seriesPropagation.ts` — `SERIES_EXCLUDED_FIELDS` (+4 pole)
- `src/app/_components/PlannerPage.tsx` — paste payload + delete-undo restore payload (+4 pole)
- `src/components/BlockEdit.tsx` — stav, `buildPayload`, nový řádek formuláře
- `src/components/DtpPanel.tsx` — štítky na `BlockCard`
- `src/components/BlockDetail.tsx` — řádky Typ tisku / Tiskové archy / Série
- `src/app/admin/_components/AdminDashboard.tsx` — kategorie `TISKOVY_ARCH`, `SERIE`
- `prisma/bootstrap-prod.ts` — idempotentní seed 1.–20. pro nové kategorie

**Mimo rozsah (záměrně se nemění):**
- `src/app/api/blocks/batch/route.ts` — mění jen čas/stroj, nová pole se ho netýkají
- `src/lib/blockSerialization.ts` — `serializeBlock` spreaduje `...rest`, nová pole projdou automaticky
- `SPLIT_SHARED_FIELDS` (PlannerPage i `[id]/route.ts`) — nová pole NEsdílet (rozhodnutí: per-blok)
- Queue-place `baseBody` (`PlannerPage.tsx:~2265`) — queue items nemají tato pole; planovač je nastaví na umístěném bloku

---

## Etapa 1 — Helper `productionTags.ts` + testy (TDD)

**Files:**
- Create: `src/lib/productionTags.ts`
- Test: `src/lib/productionTags.test.ts`

- [ ] **Step 1: Napsat failující test**

`src/lib/productionTags.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductionTags, serializeProductionTags, formatProductionTags } from "./productionTags";

test("parseProductionTags: validní JSON pole vrátí pole stringů", () => {
  assert.deepEqual(parseProductionTags('["1. TA","5. TA"]'), ["1. TA", "5. TA"]);
});

test("parseProductionTags: null/prázdný vstup vrátí []", () => {
  assert.deepEqual(parseProductionTags(null), []);
  assert.deepEqual(parseProductionTags(undefined), []);
  assert.deepEqual(parseProductionTags(""), []);
});

test("parseProductionTags: nevalidní JSON vrátí [] (defenzivní)", () => {
  assert.deepEqual(parseProductionTags("{ rozbity"), []);
  assert.deepEqual(parseProductionTags('"jen string"'), []);
  assert.deepEqual(parseProductionTags("42"), []);
});

test("parseProductionTags: odfiltruje ne-string prvky", () => {
  assert.deepEqual(parseProductionTags('["1. TA",5,null,"3. TA"]'), ["1. TA", "3. TA"]);
});

test("serializeProductionTags: pole → JSON string", () => {
  assert.equal(serializeProductionTags(["1. TA", "5. TA"]), '["1. TA","5. TA"]');
});

test("serializeProductionTags: prázdné pole → null", () => {
  assert.equal(serializeProductionTags([]), null);
  assert.equal(serializeProductionTags(["", "   "]), null);
});

test("serialize→parse round-trip", () => {
  const input = ["1. série", "3. série"];
  assert.deepEqual(parseProductionTags(serializeProductionTags(input)), input);
});

test("formatProductionTags: join čárkou", () => {
  assert.equal(formatProductionTags('["1. TA","5. TA","6. TA"]'), "1. TA, 5. TA, 6. TA");
  assert.equal(formatProductionTags(null), "");
});
```

- [ ] **Step 2: Spustit test — ověřit, že selže**

Run: `node --test --import tsx src/lib/productionTags.test.ts`
Expected: FAIL — `Cannot find module './productionTags'`

- [ ] **Step 3: Implementovat helper**

`src/lib/productionTags.ts`:

```typescript
/**
 * Multi-select metadata bloku (Tiskové archy, Série) se ukládají jako JSON pole
 * vybraných labelů, např. '["1. TA","5. TA"]'. Helper je jediný zdroj pravdy pro
 * parse/serialize/zobrazení. Vše defenzivní — nevalidní vstup nikdy nehodí výjimku.
 */

export function parseProductionTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function serializeProductionTags(tags: string[]): string | null {
  const clean = tags.filter((t) => typeof t === "string" && t.trim().length > 0);
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

export function formatProductionTags(value: string | null | undefined): string {
  return parseProductionTags(value).join(", ");
}
```

- [ ] **Step 4: Spustit test — ověřit, že projde**

Run: `node --test --import tsx src/lib/productionTags.test.ts`
Expected: PASS (8 testů)

- [ ] **Step 5: Commit**

```bash
git add src/lib/productionTags.ts src/lib/productionTags.test.ts
git commit -m "feat(tags): productionTags helper pro multi-select metadata (TA/série)"
```

---

## Etapa 2 — DB: Prisma schema + migrace

**Files:**
- Modify: `prisma/schema.prisma` (model `Block`)
- Create: `prisma/migrations/<timestamp>_add_obalka_vnitrky_ta_serie/migration.sql` (generuje CLI)

- [ ] **Step 1: Přidat 4 pole do modelu `Block`**

V `prisma/schema.prisma`, v modelu `Block`, za řádek `specifikace                                 String?` přidat:

```prisma
  obalka                                      Boolean      @default(false)
  vnitrky                                     Boolean      @default(false)
  tiskoveArchy                                String?
  serie                                       String?
```

(Pozor: NEspouštět `prisma format`. Pole přidat ručně, zarovnání není kritické.)

- [ ] **Step 2: Vygenerovat migraci**

Run: `npx prisma migrate dev --name add_obalka_vnitrky_ta_serie`
Expected: vytvoří se migrace s `ALTER TABLE \`Block\` ADD COLUMN ...` (4 sloupce, žádný FK), Prisma client se přegeneruje.

- [ ] **Step 3: Ověřit migrační SQL**

Run: `cat prisma/migrations/*add_obalka_vnitrky_ta_serie/migration.sql`
Expected: 4× `ADD COLUMN`, `obalka`/`vnitrky` jako `BOOLEAN NOT NULL DEFAULT false`, `tiskoveArchy`/`serie` jako `VARCHAR(191) NULL`. ŽÁDNÝ `FOREIGN KEY`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS (TypeScript zná nová pole na Prisma typu).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): pole obalka/vnitrky/tiskoveArchy/serie na Block"
```

---

## Etapa 3 — Typ `Block` + clone payloady (paste, undo-restore)

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:115` (typ `Block`)
- Modify: `src/app/_components/PlannerPage.tsx:2406` (paste payload)
- Modify: `src/app/_components/PlannerPage.tsx:1675` (delete-undo restore payload)

- [ ] **Step 1: Přidat 4 optional pole do typu `Block`**

V `src/app/_components/TimelineGrid.tsx`, v `export type Block`, za řádek `specifikace: string | null;` (řádek 115) přidat:

```typescript
  // Výrobní štítky — OBÁLKA / VNITŘKY + multi-select metadata
  obalka?: boolean;
  vnitrky?: boolean;
  tiskoveArchy?: string | null;
  serie?: string | null;
```

(Optional `?` záměrně — nezpůsobí kaskádu chyb v ~10 souborech, kde se Block konstruuje.)

- [ ] **Step 2: Doplnit pole do paste payloadu**

V `src/app/_components/PlannerPage.tsx`, ve `handlePasteWithTarget`, do `JSON.stringify({...})` (za řádek `specifikace: src.specifikace,` ~2406) přidat:

```typescript
          obalka: src.obalka ?? false,
          vnitrky: src.vnitrky ?? false,
          tiskoveArchy: src.tiskoveArchy ?? null,
          serie: src.serie ?? null,
```

- [ ] **Step 3: Doplnit pole do delete-undo restore payloadu**

V `src/app/_components/PlannerPage.tsx`, v `payload` objektu (za `materialNote: block.materialNote,` ~1676, před `recurrenceType: "NONE",`) přidat:

```typescript
      obalka: block.obalka ?? false,
      vnitrky: block.vnitrky ?? false,
      tiskoveArchy: block.tiskoveArchy ?? null,
      serie: block.serie ?? null,
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(tags): typ Block + clone payloady (paste, undo) nesou nová pole"
```

---

## Etapa 4 — API write path (POST, PUT, audit) + série exclusion

**Files:**
- Modify: `src/app/api/blocks/route.ts:193` (POST create data)
- Modify: `src/app/api/blocks/[id]/route.ts` (PUT update data + AUDITED_FIELDS)
- Modify: `src/lib/auditFormatters.ts` (FIELD_LABELS + fmtAuditVal)
- Modify: `src/lib/seriesPropagation.ts` (SERIES_EXCLUDED_FIELDS)

> **Poznámka:** Role filtr v PUT NEměnit. ADMIN/PLANOVAT mají `allowed = body` → nová pole projdou automaticky. DTP/MTZ mají explicitní allow-list (nová pole vyloučena) → nemohou editovat. To je správně.

- [ ] **Step 1: POST — doplnit do `tx.block.create({ data: {...} })`**

V `src/app/api/blocks/route.ts`, za řádek `specifikace: body.specifikace ?? null,` (~193) přidat:

```typescript
          // VÝROBNÍ ŠTÍTKY
          obalka: body.obalka ?? false,
          vnitrky: body.vnitrky ?? false,
          tiskoveArchy: body.tiskoveArchy ?? null,
          serie: body.serie ?? null,
```

- [ ] **Step 2: PUT — doplnit do `tx.block.update({ data: {...} })`**

V `src/app/api/blocks/[id]/route.ts`, za řádek `...(allowed.specifikace !== undefined && { specifikace: allowed.specifikace as string }),` (~353) přidat:

```typescript
          // VÝROBNÍ ŠTÍTKY
          ...(allowed.obalka !== undefined && { obalka: allowed.obalka as boolean }),
          ...(allowed.vnitrky !== undefined && { vnitrky: allowed.vnitrky as boolean }),
          ...(allowed.tiskoveArchy !== undefined && { tiskoveArchy: allowed.tiskoveArchy as string | null }),
          ...(allowed.serie !== undefined && { serie: allowed.serie as string | null }),
```

- [ ] **Step 3: PUT — doplnit do `AUDITED_FIELDS`**

V `src/app/api/blocks/[id]/route.ts`, do pole `AUDITED_FIELDS` (~149), za `"blockVariant",` přidat:

```typescript
      "obalka", "vnitrky", "tiskoveArchy", "serie",
```

- [ ] **Step 4: Audit labely + formátování**

V `src/lib/auditFormatters.ts`, do `FIELD_LABELS` (za `blockVariant: "Stav zakázky",`) přidat:

```typescript
  obalka: "Obálka",
  vnitrky: "Vnitřky",
  tiskoveArchy: "Tiskové archy",
  serie: "Série",
```

Ve funkci `fmtAuditVal`, hned za řádek `if (!val || val === "null") return "—";` přidat:

```typescript
  if (field === "obalka" || field === "vnitrky") return val === "true" ? "✓ Ano" : "✗ Ne";
  if (field === "tiskoveArchy" || field === "serie") {
    try {
      const arr = JSON.parse(val);
      if (Array.isArray(arr)) return arr.length ? arr.join(", ") : "—";
    } catch { /* fallthrough */ }
    return val;
  }
```

- [ ] **Step 5: Série exclusion — nová pole jsou per-výskyt**

V `src/lib/seriesPropagation.ts`, do pole `SERIES_EXCLUDED_FIELDS` (za `"pantoneRequired",`) přidat:

```typescript
  "obalka",
  "vnitrky",
  "tiskoveArchy",
  "serie",
```

- [ ] **Step 6: Build + existující testy**

Run: `npm run build`
Expected: PASS

Run: `node --test --import tsx src/lib/productionTags.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/api/blocks/route.ts src/app/api/blocks/[id]/route.ts src/lib/auditFormatters.ts src/lib/seriesPropagation.ts
git commit -m "feat(tags): API write path (POST/PUT) + audit + série exclusion"
```

---

## Etapa 5 — Komponenta `MultiSelectDropdown`

**Files:**
- Create: `src/components/MultiSelectDropdown.tsx`

- [ ] **Step 1: Vytvořit komponentu**

`src/components/MultiSelectDropdown.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Multi-select popover s checkbox seznamem. iOS-like, ladí s appkou (CSS tokeny).
 * Hodnoty = labely (string). Click-outside zavře. Trigger ukazuje souhrn vybraných.
 */
export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = "— vyber —",
  disabled = false,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(opt: string) {
    if (selected.includes(opt)) onChange(selected.filter((s) => s !== opt));
    else onChange([...options].filter((o) => selected.includes(o) || o === opt));
  }

  const summary = selected.length > 0 ? selected.join(", ") : placeholder;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", height: 34, borderRadius: 8,
          background: "var(--surface-2)", border: `1px solid ${open ? "var(--ring)" : "var(--border)"}`,
          color: selected.length > 0 ? "var(--text)" : "var(--text-muted)",
          fontSize: 11, fontWeight: 600, padding: "0 26px 0 10px", cursor: disabled ? "default" : "pointer",
          outline: "none", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          position: "relative",
        }}
      >
        {summary}
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" color="var(--text-muted)"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, pointerEvents: "none" }}>
          <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute", zIndex: 50, top: 38, left: 0, minWidth: "100%",
          background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
          padding: 5, boxShadow: "0 18px 40px rgba(0,0,0,0.45)", maxHeight: 240, overflowY: "auto",
        }}>
          {options.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 10px" }}>Žádné položky (přidej v adminu).</div>
          ) : (
            options.map((opt) => {
              const isSel = selected.includes(opt);
              return (
                <div key={opt} onClick={() => toggle(opt)} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", borderRadius: 7,
                  fontSize: 12, fontWeight: 600, color: "var(--text)", cursor: "pointer",
                  background: isSel ? "color-mix(in oklab, var(--accent-blue, #3b82f6) 22%, transparent)" : "transparent",
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: isSel ? "#3b82f6" : "transparent", border: isSel ? "1.5px solid #3b82f6" : "1.5px solid var(--border)",
                  }}>
                    {isSel && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </span>
                  {opt}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
```

> **Pozn.:** `toggle` rekonstruuje výběr v pořadí `options`, aby vybrané labely zůstaly seřazené dle číselníku (ne dle pořadí klikání).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS (komponenta zatím nepoužitá — jen se zkompiluje)

- [ ] **Step 3: Commit**

```bash
git add src/components/MultiSelectDropdown.tsx
git commit -m "feat(ui): MultiSelectDropdown — popover s checkbox seznamem"
```

---

## Etapa 6 — Formulář BlockEdit (nový řádek)

**Files:**
- Modify: `src/components/BlockEdit.tsx`

- [ ] **Step 1: Importy**

V `src/components/BlockEdit.tsx`, za import `stripSeriesPropagatedFields` (~18) přidat:

```typescript
import { parseProductionTags, serializeProductionTags } from "@/lib/productionTags";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
```

- [ ] **Step 2: Stav + načtení číselníků TA/série**

V `BlockEdit`, za stav `const [specifikace, setSpecifikace] = useState(...)` (~157) přidat:

```typescript
  // VÝROBNÍ ŠTÍTKY
  const [obalka, setObalka]   = useState(block.obalka ?? false);
  const [vnitrky, setVnitrky] = useState(block.vnitrky ?? false);
  const [tiskoveArchy, setTiskoveArchy] = useState<string[]>(parseProductionTags(block.tiskoveArchy));
  const [serie, setSerie]               = useState<string[]>(parseProductionTags(block.serie));
  const [tiskoveArchyOpts, setTiskoveArchyOpts] = useState<string[]>([]);
  const [serieOpts, setSerieOpts]               = useState<string[]>([]);
```

Za existující `useEffect` který fetchuje DATA/MATERIAL/BARVY/LAK (~428, končí `}, [dataOptsProp]);`) přidat nový effect:

```typescript
  // Číselníky pro multi-selecty (TA/série) — fetch labelů v pořadí sortOrder
  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=TISKOVY_ARCH").then((r) => r.json()),
      fetch("/api/codebook?category=SERIE").then((r) => r.json()),
    ]).then(([ta, se]) => {
      setTiskoveArchyOpts((ta as Array<{ label: string }>).map((o) => o.label));
      setSerieOpts((se as Array<{ label: string }>).map((o) => o.label));
    }).catch(() => { /* prázdný seznam = dropdown ukáže hint */ });
  }, []);
```

- [ ] **Step 3: `buildPayload` — doplnit 4 pole**

V `buildPayload` (~533), za řádek `specifikace: specifikace.trim() || null,` přidat:

```typescript
      obalka,
      vnitrky,
      tiskoveArchy: serializeProductionTags(tiskoveArchy),
      serie: serializeProductionTags(serie),
```

- [ ] **Step 4: Nový řádek v JSX**

V sekci „Výrobní sloupečky", za uzavírací `</div>` mřížky „Řádek 2: Stavy" (těsně před `{/* SPECIFIKACE */}`, ~965) vložit:

```tsx
            {/* Řádek 3: Výrobní štítky — OBÁLKA | VNITŘKY | Tiskové archy | Série */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.15fr 1.15fr", gap: 6, marginTop: 10, alignItems: "end", opacity: !canEdit ? 0.45 : 1, pointerEvents: !canEdit ? "none" : "auto" }}>
              {/* OBÁLKA */}
              <button type="button" onClick={() => setObalka((v) => !v)} style={{ height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", border: obalka ? "1px solid #facc15" : "1px solid var(--border)", background: obalka ? "color-mix(in oklab, #facc15 16%, transparent)" : "var(--surface-2)", color: obalka ? "#eab308" : "var(--text-muted)", transition: "all 100ms" }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: obalka ? "#facc15" : "transparent", border: obalka ? "1.5px solid #facc15" : "1.5px solid var(--border)" }}>
                  {obalka && <svg width="8" height="6" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#1a1206" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                OBÁLKA
              </button>
              {/* VNITŘKY */}
              <button type="button" onClick={() => setVnitrky((v) => !v)} style={{ height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", border: vnitrky ? "1px solid #22d3ee" : "1px solid var(--border)", background: vnitrky ? "color-mix(in oklab, #22d3ee 16%, transparent)" : "var(--surface-2)", color: vnitrky ? "#22d3ee" : "var(--text-muted)", transition: "all 100ms" }}>
                <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: vnitrky ? "#22d3ee" : "transparent", border: vnitrky ? "1.5px solid #22d3ee" : "1.5px solid var(--border)" }}>
                  {vnitrky && <svg width="8" height="6" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#06222a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                VNITŘKY
              </button>
              {/* TISKOVÉ ARCHY */}
              <div>
                <ColLabel>Tiskové archy</ColLabel>
                <MultiSelectDropdown options={tiskoveArchyOpts} selected={tiskoveArchy} onChange={setTiskoveArchy} disabled={!canEdit} />
              </div>
              {/* SÉRIE */}
              <div>
                <ColLabel>Série</ColLabel>
                <MultiSelectDropdown options={serieOpts} selected={serie} onChange={setSerie} disabled={!canEdit} />
              </div>
            </div>
```

- [ ] **Step 5: Build + lint**

Run: `npm run build`
Expected: PASS

Run: `npm run lint`
Expected: 0 chyb (warningy OK)

- [ ] **Step 6: Manuální ověření v appce**

Run: `npm run dev`, přihlásit jako ADMIN, otevřít editaci ZAKAZKA bloku.
Expected: pod Stavy je nový řádek; OBÁLKA/VNITŘKY se přepínají (žlutá/tyrkysová); dropdowny se otevřou (nebo ukáží „Žádné položky" dokud nejsou číselníky — to doplní Etapa 9). Uložit → znovu otevřít → hodnoty drží.

- [ ] **Step 7: Commit**

```bash
git add src/components/BlockEdit.tsx
git commit -m "feat(form): nový řádek OBÁLKA/VNITŘKY + Tiskové archy/Série v BlockEdit"
```

---

## Etapa 7 — Štítky OBÁLKA/VNITŘKY v plánu (TimelineGrid)

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`

- [ ] **Step 1: Přidat komponentu `OvBadges`**

V `src/app/_components/TimelineGrid.tsx`, za komponentu `MiniChip` (~755, hned za jejím `}`) přidat:

```typescript
// ─── OvBadges — štítky OBÁLKA / VNITŘKY ───────────────────────────────────────
function OvBadges({ obalka, vnitrky, abbreviated }: { obalka?: boolean; vnitrky?: boolean; abbreviated?: boolean }) {
  if (!obalka && !vnitrky) return null;
  const pill = (bg: string, fg: string, text: string) => (
    <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.05em", padding: "3px 7px", borderRadius: 6, background: bg, color: fg, lineHeight: 1, whiteSpace: "nowrap" }}>{text}</span>
  );
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {obalka && pill("#facc15", "#1a1206", abbreviated ? "OB." : "OBÁLKA")}
      {vnitrky && pill("#22d3ee", "#06222a", abbreviated ? "VN." : "VNITŘKY")}
    </div>
  );
}
```

- [ ] **Step 2: Přečíst render bloku — najít 3 vkládací body**

Run: `sed -n '1080,1280p' src/app/_components/TimelineGrid.tsx`
Cíl: identifikovat (a) kontejner celého bloku v MODE_FULL (pro absolutní pozici vpravo dole), (b) pravý cluster status chipů v MODE_COMPACT (~1204–1210), (c) pravý cluster v MODE_TINY (~1238+).

- [ ] **Step 3: MODE_FULL — štítky vpravo dole**

Do hlavního kontejneru bloku (ten s `position: "relative"`, render MODE_FULL ≥60px) přidat jako poslední child, absolutně poziční:

```tsx
        {(block.obalka || block.vnitrky) && (
          <div style={{ position: "absolute", right: 8, bottom: 7 }}>
            <OvBadges obalka={block.obalka} vnitrky={block.vnitrky} />
          </div>
        )}
```

- [ ] **Step 4: MODE_COMPACT + MODE_TINY — štítky v pravém clusteru**

V MODE_COMPACT pravém clusteru (za `MiniChip` řádky ~1209) a v MODE_TINY pravém clusteru přidat:

```tsx
            <OvBadges obalka={block.obalka} vnitrky={block.vnitrky} abbreviated />
```

(U TINY je málo místa → `abbreviated` zkrátí na OB./VN.)

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Manuální ověření**

Run: `npm run dev`. Označit blok jako OBÁLKA i VNITŘKY, různé výšky.
Expected: vysoký blok → štítky vpravo dole; krátký → OB./VN. v pravém clusteru; nepřekrývají číslo/popis.

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat(plan): štítky OBÁLKA/VNITŘKY na bloku ve 3 režimech"
```

---

## Etapa 8 — DTP karta + read-only detail bloku

**Files:**
- Modify: `src/components/DtpPanel.tsx`
- Modify: `src/components/BlockDetail.tsx`

- [ ] **Step 1: DTP karta — štítky**

V `src/components/DtpPanel.tsx`, v `BlockCard`, za `<StatusChipSelect .../>` blok (~298–310, před uzavíracím `</div>` karty) přidat:

```tsx
      {(block.obalka || block.vnitrky) && (
        <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
          {block.obalka && <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.05em", padding: "3px 7px", borderRadius: 6, background: "#facc15", color: "#1a1206", lineHeight: 1 }}>OBÁLKA</span>}
          {block.vnitrky && <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.05em", padding: "3px 7px", borderRadius: 6, background: "#22d3ee", color: "#06222a", lineHeight: 1 }}>VNITŘKY</span>}
        </div>
      )}
```

- [ ] **Step 2: Detail — import helperu**

V `src/components/BlockDetail.tsx`, k existujícím importům přidat:

```typescript
import { formatProductionTags } from "@/lib/productionTags";
```

- [ ] **Step 3: Detail — řádky Typ tisku / Tiskové archy / Série**

V `src/components/BlockDetail.tsx`, rozšířit podmínku bloku „Výrobní sloupečky" (~207) o nová pole:

```tsx
        {(block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace || block.materialInStock || block.materialIssued || block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
```

Uvnitř toho bloku, za `{block.specifikace && <Row label="Spec" value={block.specifikace} />}` (~228) přidat:

```tsx
              {(block.obalka || block.vnitrky) && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Typ tisku</span>
                  <span className="flex gap-1.5">
                    {block.obalka && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: "#facc15", color: "#1a1206" }}>OBÁLKA</span>}
                    {block.vnitrky && <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{ background: "#22d3ee", color: "#06222a" }}>VNITŘKY</span>}
                  </span>
                </div>
              )}
              {block.tiskoveArchy && <Row label="Tiskové archy" value={formatProductionTags(block.tiskoveArchy)} />}
              {block.serie && <Row label="Série" value={formatProductionTags(block.serie)} />}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Manuální ověření**

Run: `npm run dev`. DTP role: karta ukazuje štítek. Read-only detail (klik na blok bez edit práv): řádky Typ tisku / Tiskové archy / Série.

- [ ] **Step 6: Commit**

```bash
git add src/components/DtpPanel.tsx src/components/BlockDetail.tsx
git commit -m "feat(dtp+detail): štítky OBÁLKA/VNITŘKY + výpis TA/série"
```

---

## Etapa 9 — Admin číselníky + bootstrap seed

**Files:**
- Modify: `src/app/admin/_components/AdminDashboard.tsx:73-84`
- Modify: `prisma/bootstrap-prod.ts`

- [ ] **Step 1: Přidat kategorie do admin tabu**

V `src/app/admin/_components/AdminDashboard.tsx`:

Změnit `CATEGORIES` (~73):

```typescript
const CATEGORIES = ["DATA", "MATERIAL", "BARVY", "LAK", "TISKOVY_ARCH", "SERIE"] as const;
```

Změnit `CATEGORY_LABELS` (~75) — přidat:

```typescript
  TISKOVY_ARCH: "TISKOVÝ ARCH",
  SERIE: "SÉRIE",
```

(`PILL_KEYS` a `PILL_LABELS` se odvozují z `CATEGORIES`/`CATEGORY_LABELS` — ověřit ~81–85, doplnit jen pokud jsou labely vyjmenované zvlášť.)

- [ ] **Step 2: Idempotentní seed v bootstrapu**

V `prisma/bootstrap-prod.ts`, za blok „1. Číselníky" (za jeho uzavírací `}` ~81) přidat:

```typescript
  // 1b. Nové číselníky TA/série — per-kategorie seed (funguje i na existující DB)
  for (const { category, prefix } of [
    { category: "TISKOVY_ARCH", prefix: "TA" },
    { category: "SERIE", prefix: "série" },
  ]) {
    const count = await prisma.codebookOption.count({ where: { category } });
    if (count === 0) {
      await prisma.codebookOption.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          category,
          label: `${i + 1}. ${prefix}`,
          sortOrder: i,
          isWarning: false,
        })),
      });
      console.log(`✅ Číselník ${category}: 20 položek vytvořeno.`);
    } else {
      console.log(`ℹ️  Číselník ${category}: ${count} položek již existuje — přeskočeno.`);
    }
  }
```

- [ ] **Step 3: Spustit bootstrap (dev DB)**

Run: `npm run prisma:bootstrap`
Expected: `✅ Číselník TISKOVY_ARCH: 20 položek vytvořeno.` + `✅ Číselník SERIE: 20 položek vytvořeno.`

- [ ] **Step 4: Build + manuální ověření**

Run: `npm run build`
Expected: PASS

Run: `npm run dev`. Admin → Číselníky: nové záložky „TISKOVÝ ARCH" a „SÉRIE" s 1.–20.; lze přidat/řadit/deaktivovat. V editaci bloku dropdowny TA/série nabízejí tyto položky.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/_components/AdminDashboard.tsx prisma/bootstrap-prod.ts
git commit -m "feat(admin): číselníky TISKOVY_ARCH/SERIE + bootstrap seed 1-20"
```

---

## Závěrečné ověření (po všech etapách)

- [ ] `npm run build` — PASS
- [ ] `npm run lint` — 0 chyb
- [ ] Celá test suite zelená:
  ```bash
  node --test --import tsx src/lib/dateUtils.test.ts
  node --test --import tsx src/lib/errors.test.ts
  node --test --import tsx src/lib/pasteTarget.test.ts
  node --test --import tsx src/lib/clipboardCopy.test.ts
  node --test --import tsx src/lib/productionTags.test.ts
  node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
  ```
- [ ] Manuální end-to-end: označit OBÁLKA+VNITŘKY+TA+série → uložit → štítky v plánu, DTP, detail; copy/paste přenese; série výskyt needituje sourozence; split části nesdílí.
- [ ] **Deploy na produkci řeší Vojta** (merge do main + `migrate deploy` + povinná PRE/POST `mysqldump` záloha + `npm run prisma:bootstrap` pro seed číselníků).

---

## Self-review (provedeno při psaní plánu)

- **Spec coverage:** OBÁLKA/VNITŘKY (E6 form, E7 plán, E8 DTP/detail) ✓ · TA/série multi-select (E5 komponenta, E6 form, E8 detail) ✓ · admin správa (E9) ✓ · datový model (E2) ✓ · audit (E4) ✓ · série/split chování (E4 + mimo rozsah pozn.) ✓ · touch-points (E3 paste/undo, E4 API) ✓.
- **Placeholdery:** žádné TBD/TODO; veškerý kód konkrétní.
- **Typová konzistence:** `parseProductionTags`/`serializeProductionTags`/`formatProductionTags` použity konzistentně; `MultiSelectDropdown` props (`options/selected/onChange/disabled`) shodné v E5 i E6; pole `obalka/vnitrky/tiskoveArchy/serie` stejně pojmenovaná v DB, typu, API, formuláři.
- **Pozn. k řádkům:** čísla řádků jsou orientační (soubory se během etap posouvají) — vždy kotvit podle uvedeného sousedního kódu, ne podle čísla.
