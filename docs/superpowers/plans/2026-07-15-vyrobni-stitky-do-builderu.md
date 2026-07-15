# Výrobní štítky do vstupního builderu — Implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umožnit nastavení štítků OBÁLKA/VNITŘKY + Tiskové archy + Série přímo ve vstupním job builderu, aby nově založená ZAKAZKA rovnou nesla správné štítky.

**Architecture:** Vytáhnout dnešní inline řádek štítků z `BlockEdit` do sdílené prezentační komponenty `ProductionTagsRow` a použít ji v BlockEditu i v builderu. Štítky protéct builder stavem → `QueueItem` → POST body (přes existující `serializeProductionTags`). U série se řádek skryje a štítky se neposílají.

**Tech Stack:** Next.js 16 (React, automatic JSX runtime), TypeScript, existující `MultiSelectDropdown`, `src/lib/productionTags.ts` (serializace).

## Global Constraints

- **Žádná změna DB ani API** — pole `obalka`/`vnitrky`/`tiskoveArchy`/`serie` na modelu `Block` i POST `/api/blocks` write-path už existují (commity `83d0994a`, `a8f4b4db`). Číselníky `TISKOVY_ARCH`/`SERIE` existují v bootstrapu.
- **Serializace štítků:** archy/série se v UI drží jako `string[]`; do POST se posílají přes `serializeProductionTags(tags: string[]): string | null` z `src/lib/productionTags.ts`. OBÁLKA/VNITŘKY jsou plain `boolean`.
- **Série = prázdné:** řádek štítků se v builderu ukáže jen pro `type === "ZAKAZKA" && bRecurrenceType === "NONE"`; `handleScheduleSeries` štítky NEposílá.
- **Testovací realita:** projekt nemá React-komponentní test harness (žádné RTL); UI a plumbing se ověřují `npx tsc --noEmit` + `npm run build` + manuální dev-DB důkaz. Pure serializace je krytá existujícím `src/lib/productionTags.test.ts`. Nová pure logika v tomto plánu nevzniká, takže se nový unit test nepřidává — nejde o vynechání testu, ale o absenci nové testovatelné čisté funkce.
- **Práce jen na větvi Vojta.** Commit po každém tasku.
- **Best practices projektu:** nové UI komponenty do `src/components/` jako named export; žádné inline komponenty do velkých souborů.

---

## File Structure

| Soubor | Odpovědnost |
| --- | --- |
| `src/components/planner/ProductionTagsRow.tsx` | **Nový.** Sdílená prezentační komponenta (2 toggly + 2 dropdowny). Řízená propsy, bez fetch/stavu. |
| `src/components/BlockEdit.tsx` | Inline řádek 955-981 → `<ProductionTagsRow …/>`. |
| `src/hooks/useJobBuilder.ts` | Builder stav pro štítky + fetch číselníků; rozšíření `QueueItem`, `handleAddToQueue`, `reservationToQueueItem`, `resetBuilderForm`, return. |
| `src/components/planner/JobBuilderPanel.tsx` | Vykreslení `<ProductionTagsRow …/>` (ZAKAZKA & NONE) + poznámka u série. |
| `src/app/_components/PlannerPage.tsx` | `handleQueueDrop` — 4 pole do POST `baseBody`. |

---

## Task 1: Sdílená komponenta `ProductionTagsRow` + refaktor BlockEditu

**Files:**
- Create: `src/components/planner/ProductionTagsRow.tsx`
- Modify: `src/components/BlockEdit.tsx:955-981` (nahrazení inline řádku), import sekce

**Interfaces:**
- Produces: `ProductionTagsRow` (named export) + typ `ProductionTagsRowProps`:
  ```ts
  obalka: boolean; onObalkaChange: (v: boolean) => void;
  vnitrky: boolean; onVnitrkyChange: (v: boolean) => void;
  tiskoveArchy: string[]; onTiskoveArchyChange: (v: string[]) => void; tiskoveArchyOpts: string[];
  serie: string[]; onSerieChange: (v: string[]) => void; serieOpts: string[];
  disabled?: boolean;
  ```
- Consumes: `MultiSelectDropdown` z `@/components/MultiSelectDropdown` (props `options: string[]`, `selected: string[]`, `onChange: (next: string[]) => void`, `disabled?: boolean`).

- [ ] **Step 1: Vytvoř komponentu**

Create `src/components/planner/ProductionTagsRow.tsx`:

```tsx
import type { ReactNode } from "react";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";

export type ProductionTagsRowProps = {
  obalka: boolean;
  onObalkaChange: (v: boolean) => void;
  vnitrky: boolean;
  onVnitrkyChange: (v: boolean) => void;
  tiskoveArchy: string[];
  onTiskoveArchyChange: (v: string[]) => void;
  tiskoveArchyOpts: string[];
  serie: string[];
  onSerieChange: (v: string[]) => void;
  serieOpts: string[];
  disabled?: boolean;
};

function TagLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>{children}</div>;
}

export function ProductionTagsRow({
  obalka, onObalkaChange, vnitrky, onVnitrkyChange,
  tiskoveArchy, onTiskoveArchyChange, tiskoveArchyOpts,
  serie, onSerieChange, serieOpts, disabled = false,
}: ProductionTagsRowProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.15fr 1.15fr", gap: 6, marginTop: 10, alignItems: "end", opacity: disabled ? 0.45 : 1, pointerEvents: disabled ? "none" : "auto" }}>
      {/* OBÁLKA */}
      <button type="button" onClick={() => onObalkaChange(!obalka)} style={{ height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", border: obalka ? "1px solid #facc15" : "1px solid var(--border)", background: obalka ? "color-mix(in oklab, #facc15 16%, transparent)" : "var(--surface-2)", color: obalka ? "#eab308" : "var(--text-muted)", transition: "all 100ms" }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: obalka ? "#facc15" : "transparent", border: obalka ? "1.5px solid #facc15" : "1.5px solid var(--border)" }}>
          {obalka && <svg width="8" height="6" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#1a1206" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        OBÁLKA
      </button>
      {/* VNITŘKY */}
      <button type="button" onClick={() => onVnitrkyChange(!vnitrky)} style={{ height: 34, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", border: vnitrky ? "1px solid #22d3ee" : "1px solid var(--border)", background: vnitrky ? "color-mix(in oklab, #22d3ee 16%, transparent)" : "var(--surface-2)", color: vnitrky ? "#22d3ee" : "var(--text-muted)", transition: "all 100ms" }}>
        <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: vnitrky ? "#22d3ee" : "transparent", border: vnitrky ? "1.5px solid #22d3ee" : "1.5px solid var(--border)" }}>
          {vnitrky && <svg width="8" height="6" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#06222a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        VNITŘKY
      </button>
      {/* TISKOVÉ ARCHY */}
      <div>
        <TagLabel>Tiskové archy</TagLabel>
        <MultiSelectDropdown options={[...tiskoveArchyOpts, ...tiskoveArchy.filter((s) => !tiskoveArchyOpts.includes(s))]} selected={tiskoveArchy} onChange={onTiskoveArchyChange} disabled={disabled} />
      </div>
      {/* SÉRIE */}
      <div>
        <TagLabel>Série</TagLabel>
        <MultiSelectDropdown options={[...serieOpts, ...serie.filter((s) => !serieOpts.includes(s))]} selected={serie} onChange={onSerieChange} disabled={disabled} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Nahraď inline řádek v BlockEditu**

V `src/components/BlockEdit.tsx` nahraď celý blok od komentáře `{/* Řádek 3: Výrobní štítky … */}` (řádek 955) po jeho uzavírací `</div>` (řádek 981) tímto:

```tsx
{/* Řádek 3: Výrobní štítky — OBÁLKA | VNITŘKY | Tiskové archy | Série */}
<ProductionTagsRow
  obalka={obalka} onObalkaChange={setObalka}
  vnitrky={vnitrky} onVnitrkyChange={setVnitrky}
  tiskoveArchy={tiskoveArchy} onTiskoveArchyChange={setTiskoveArchy} tiskoveArchyOpts={tiskoveArchyOpts}
  serie={serie} onSerieChange={setSerie} serieOpts={serieOpts}
  disabled={!canEdit}
/>
```

- [ ] **Step 3: Uprav importy v BlockEditu**

Přidej import komponenty (vedle ostatních `@/components` importů, cca řádek 17):

```tsx
import { ProductionTagsRow } from "@/components/planner/ProductionTagsRow";
```

Odstraň import `MultiSelectDropdown` (řádek 17 `import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";`) — po náhradě už ho BlockEdit nikde jinde nepoužívá. (Ověř: `grep -n "MultiSelectDropdown" src/components/BlockEdit.tsx` musí vrátit 0 výskytů.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.

Run: `npm run build`
Expected: build projde (warningy OK, 0 errors).

- [ ] **Step 5: Manuální ověření BlockEditu**

Otevři existující ZAKAZKA blok v editaci → řádek „Výrobní štítky" (OBÁLKA/VNITŘKY + oba dropdowny) vypadá a funguje **identicky** jako dřív (toggly přepínají, dropdowny nabízejí TA/série, ukládání funguje).

- [ ] **Step 6: Commit**

```bash
git add src/components/planner/ProductionTagsRow.tsx src/components/BlockEdit.tsx
git commit -m "refactor(tags): sdílená ProductionTagsRow — extrakce z BlockEdit (bez změny chování)"
```

---

## Task 2: Builder stav + fetch číselníků v `useJobBuilder`

**Files:**
- Modify: `src/hooks/useJobBuilder.ts` (state ~172-188, fetch ~227-244, `resetBuilderForm` 307-327, return 570-618)

**Interfaces:**
- Produces (nové položky v návratovém objektu hooku): `bObalka, setBObalka`, `bVnitrky, setBVnitrky`, `bTiskoveArchy, setBTiskoveArchy`, `bSerie, setBSerie`, `bTiskoveArchyOpts`, `bSerieOpts`. Typy: `bObalka/bVnitrky: boolean`; `bTiskoveArchy/bSerie: string[]`; `*Opts: string[]`.

- [ ] **Step 1: Přidej stav štítků**

V `src/hooks/useJobBuilder.ts` za řádek `const [bSpecifikace, setBSpecifikace] = useState("");` (řádek 172) vlož:

```ts
  const [bObalka, setBObalka]             = useState(false);
  const [bVnitrky, setBVnitrky]           = useState(false);
  const [bTiskoveArchy, setBTiskoveArchy] = useState<string[]>([]);
  const [bSerie, setBSerie]               = useState<string[]>([]);
```

- [ ] **Step 2: Přidej stav číselníků**

Za řádek `const [bLakOpts, setBLakOpts] = useState<CodebookOption[]>([]);` (řádek 188) vlož:

```ts
  const [bTiskoveArchyOpts, setBTiskoveArchyOpts] = useState<string[]>([]);
  const [bSerieOpts, setBSerieOpts]               = useState<string[]>([]);
```

- [ ] **Step 3: Fetch číselníků TISKOVY_ARCH + SERIE**

Za uzavření existujícího `useEffect` s fetchem číselníků (řádek 244, `}, []); // eslint-disable-line react-hooks/exhaustive-deps`) vlož nový effect:

```ts
  useEffect(() => {
    Promise.all([
      fetch("/api/codebook?category=TISKOVY_ARCH").then((r) => r.json()),
      fetch("/api/codebook?category=SERIE").then((r) => r.json()),
    ]).then(([ta, se]) => {
      setBTiskoveArchyOpts((ta as Array<{ label: string }>).map((o) => o.label));
      setBSerieOpts((se as Array<{ label: string }>).map((o) => o.label));
    }).catch(() => { /* prázdný seznam = dropdown ukáže hint */ });
  }, []);
```

- [ ] **Step 4: Vyčisti štítky v `resetBuilderForm`**

Do funkce `resetBuilderForm` (řádek 307), za `setBSpecifikace("");` (řádek 320) vlož:

```ts
    setBObalka(false);
    setBVnitrky(false);
    setBTiskoveArchy([]);
    setBSerie([]);
```

- [ ] **Step 5: Exportuj v return objektu**

V `return { … }` hooku (řádek 570), za řádek `bSpecifikace, setBSpecifikace,` (588) vlož:

```ts
    bObalka, setBObalka,
    bVnitrky, setBVnitrky,
    bTiskoveArchy, setBTiskoveArchy,
    bSerie, setBSerie,
```

A do sekce „Číselníky" za `bLakOpts, setBLakOpts,` (602) vlož:

```ts
    bTiskoveArchyOpts,
    bSerieOpts,
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 chyb (nové stavy zatím nikdo nečte — to je OK, jen nesmí být typová chyba).

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useJobBuilder.ts
git commit -m "feat(builder): stav štítků + fetch číselníků TISKOVY_ARCH/SERIE v useJobBuilder"
```

---

## Task 3: Protažení štítků přes `QueueItem`

**Files:**
- Modify: `src/hooks/useJobBuilder.ts` — typ `QueueItem` (25-59), `handleAddToQueue` (329-367), `reservationToQueueItem` (91-…)

**Interfaces:**
- Consumes: builder stav z Tasku 2 (`bObalka`, `bVnitrky`, `bTiskoveArchy`, `bSerie`, `bRecurrenceType`).
- Produces: `QueueItem` nese pole `obalka: boolean`, `vnitrky: boolean`, `tiskoveArchy: string[]`, `serie: string[]` — čte je `handleQueueDrop` v Tasku 5.

- [ ] **Step 1: Rozšiř typ `QueueItem`**

V `src/hooks/useJobBuilder.ts` do typu `QueueItem` za řádek `recurrenceCount: number;` (53), před komentář `// Rezervace-specific` (54) vlož:

```ts
  obalka: boolean;
  vnitrky: boolean;
  tiskoveArchy: string[];
  serie: string[];
```

- [ ] **Step 2: Naplň štítky v `handleAddToQueue`**

Ve funkci `handleAddToQueue` do objektu vkládaného do fronty, za řádek `recurrenceCount: bRecurrenceType !== "NONE" ? bRecurrenceCount : 1,` (363) vlož (dvojitý guard — série drží prázdné dle specifikace):

```ts
        obalka: bRecurrenceType === "NONE" ? bObalka : false,
        vnitrky: bRecurrenceType === "NONE" ? bVnitrky : false,
        tiskoveArchy: bRecurrenceType === "NONE" ? bTiskoveArchy : [],
        serie: bRecurrenceType === "NONE" ? bSerie : [],
```

- [ ] **Step 3: Defaulty v `reservationToQueueItem`**

Ve funkci `reservationToQueueItem` (řádek 91) do vraceného objektu (kdekoliv mezi jeho poli, např. za `blockVariant: "STANDARD",`) vlož:

```ts
    obalka: false,
    vnitrky: false,
    tiskoveArchy: [],
    serie: [],
```

Ověř, že jde o jediné dva výrazy tvořící `QueueItem` (`handleAddToQueue` objekt + `reservationToQueueItem`) — `npx tsc --noEmit` v dalším kroku odhalí případné další místo, kde `QueueItem` vzniká bez nových polí.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 chyb. (Kdyby TS hlásil chybějící pole v jiném konstruktoru `QueueItem`, doplň tam stejné defaulty `false`/`[]`.)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useJobBuilder.ts
git commit -m "feat(builder): QueueItem nese štítky (obalka/vnitrky/archy/serie), série zůstává prázdná"
```

---

## Task 4: Vykreslení štítků v `JobBuilderPanel`

**Files:**
- Modify: `src/components/planner/JobBuilderPanel.tsx` — import, destrukturalizace `jb` (28-67), JSX po sekci Opakování (za `</div>` na řádku 442)

**Interfaces:**
- Consumes: `ProductionTagsRow` (Task 1); builder stav + settery z hooku (Task 2).

- [ ] **Step 1: Import komponenty**

V `src/components/planner/JobBuilderPanel.tsx` za řádek `import { machineBadgeStyle } from "@/components/planner/ShutdownManager";` (9) vlož:

```tsx
import { ProductionTagsRow } from "@/components/planner/ProductionTagsRow";
```

- [ ] **Step 2: Destrukturalizuj nový stav z `jb`**

V destrukturalizaci `} = jb;` (končí řádkem 67), za `bSpecifikace, setBSpecifikace,` (45) vlož:

```tsx
    bObalka, setBObalka,
    bVnitrky, setBVnitrky,
    bTiskoveArchy, setBTiskoveArchy,
    bSerie, setBSerie,
    bTiskoveArchyOpts,
    bSerieOpts,
```

- [ ] **Step 3: Vykresli řádek štítků (ZAKAZKA & NONE) + poznámku u série**

Za uzavírací `</div>` sekce Opakování (řádek 442) a před komentář `{/* ── Preview série ── */}` (444) vlož:

```tsx
                  {/* ── Výrobní štítky (jen ZAKAZKA, jednorázová zakázka) ── */}
                  {type === "ZAKAZKA" && bRecurrenceType === "NONE" && (
                    <div style={{ paddingTop: 12, paddingBottom: 14, borderBottom: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Výrobní štítky</div>
                      <ProductionTagsRow
                        obalka={bObalka} onObalkaChange={setBObalka}
                        vnitrky={bVnitrky} onVnitrkyChange={setBVnitrky}
                        tiskoveArchy={bTiskoveArchy} onTiskoveArchyChange={setBTiskoveArchy} tiskoveArchyOpts={bTiskoveArchyOpts}
                        serie={bSerie} onSerieChange={setBSerie} serieOpts={bSerieOpts}
                      />
                    </div>
                  )}
                  {type === "ZAKAZKA" && bRecurrenceType !== "NONE" && (
                    <div style={{ paddingTop: 12, paddingBottom: 14, borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                      Štítky (OBÁLKA/VNITŘKY, archy, série) nastavíš u série po založení — editací bloku.
                    </div>
                  )}
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.

Run: `npm run build`
Expected: build projde.

- [ ] **Step 5: Manuální ověření builderu**

V zadávání (Job Builder): pro `ZAKAZKA` bez opakování je vidět řádek „Výrobní štítky" (toggly + dropdowny). Po přepnutí Intervalu na opakování řádek zmizí a objeví se poznámka. U typu ÚDRŽBA/REZERVACE se řádek nezobrazuje.

- [ ] **Step 6: Commit**

```bash
git add src/components/planner/JobBuilderPanel.tsx
git commit -m "feat(builder): řádek výrobních štítků v Job Builderu (ZAKAZKA, jednorázová) + poznámka u série"
```

---

## Task 5: Uložení štítků při dropnutí z fronty (`PlannerPage`)

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` — import + `handleQueueDrop` `baseBody` (1464-1490)

**Interfaces:**
- Consumes: `QueueItem` pole `obalka`/`vnitrky`/`tiskoveArchy`/`serie` (Task 3); `serializeProductionTags` z `@/lib/productionTags`.

- [ ] **Step 1: Importuj serializaci**

V `src/app/_components/PlannerPage.tsx` přidej mezi ostatní `@/lib` importy:

```tsx
import { serializeProductionTags } from "@/lib/productionTags";
```

(Ověř, že import ještě neexistuje: `grep -n "productionTags" src/app/_components/PlannerPage.tsx`.)

- [ ] **Step 2: Přidej štítky do POST `baseBody`**

Ve funkci `handleQueueDrop`, do `baseBody` za řádek `recurrenceType: rType,` (1487) vlož:

```ts
      obalka: item.obalka ?? false,
      vnitrky: item.vnitrky ?? false,
      tiskoveArchy: serializeProductionTags(item.tiskoveArchy ?? []),
      serie: serializeProductionTags(item.serie ?? []),
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.

Run: `npm run build`
Expected: build projde.

- [ ] **Step 4: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(builder): štítky z fronty do POST body (handleQueueDrop) přes serializeProductionTags"
```

---

## Task 6: Integrační ověření + dokumentace

**Files:**
- Modify: `CLAUDE.md` (sekce stavu + klíčové soubory)

- [ ] **Step 1: Plná kontrola**

Run: `npx tsc --noEmit` → 0 chyb.
Run: `npm run build` → projde.
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` → všechny testy zelené (parita s CLAUDE.md; serializace `productionTags.test.ts` musí projít).

- [ ] **Step 2: Důkaz na dev DB**

V běžící appce (dev server) v Job Builderu založ testovací `ZAKAZKA` s OBÁLKA + 2 tiskovými archy → přetáhni z fronty na grid → ověř, že blok v plánu i v DTP kartě ukazuje štítky OBÁLKA + archy. Pak založ sérii (Interval ≠ bez opakování) → ověř, že vzniklé bloky mají štítky prázdné a v builderu byla místo řádku poznámka.

- [ ] **Step 3: Aktualizuj CLAUDE.md**

Do sekce „Ověřený stav" přidej řádek o dokončení featury (datum, odkaz na spec/plán) a do „Klíčové soubory → Planner — komponenty" přidej `src/components/planner/ProductionTagsRow.tsx` (sdílená komponenta výrobních štítků — BlockEdit i JobBuilderPanel).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: výrobní štítky do builderu — CLAUDE.md aktualizace"
```

---

## Self-Review (proti specu)

**Spec coverage:**
- Sdílená komponenta `ProductionTagsRow` → Task 1 ✓
- Builder stav + fetch číselníků → Task 2 ✓
- QueueItem plumbing → Task 3 ✓
- Vykreslení v builderu (ZAKAZKA & NONE) + poznámka série → Task 4 ✓
- POST plumbing (handleQueueDrop) → Task 5 ✓
- Série = prázdné → Task 3 guard + Task 4 skrytí + `handleScheduleSeries` beze změny ✓
- Bez DB/API změny → žádný task je nemění ✓
- Ověření build/typecheck + dev DB důkaz → Task 6 ✓

**Type consistency:** `ProductionTagsRowProps` (Task 1) sedí s propsy v BlockEditu (Task 1) i JobBuilderPanel (Task 4). `QueueItem` pole (`obalka: boolean`, `vnitrky: boolean`, `tiskoveArchy: string[]`, `serie: string[]`, Task 3) čtená v `handleQueueDrop` (Task 5) přes `serializeProductionTags(string[])`. Settery `setObalka`/`setBObalka` mají signaturu `(v: boolean) => void` kompatibilní s `onObalkaChange`. ✓

**Placeholder scan:** žádné TBD/TODO; každý code step nese úplný kód. ✓
