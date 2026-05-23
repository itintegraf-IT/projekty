# DTP — inline editace stavu zakázky v dashboardu — Implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umožnit DTP uživateli změnit DATA status zakázky jedním kliknutím přímo z karty v `DtpPanel`, bez nutnosti hledat blok v timeline a otevírat popover na chipu.

**Architecture:** Statický chip v `BlockCard` (komponenta `DtpPanel.tsx`) se nahradí native `<select>` stylizovaným jako stávající chip. Klik na select se propaguje přes `e.stopPropagation()`, takže klik na zbytek karty dál skroluje na blok v timeline. `onChange` selectu volá nový prop `onStatusChange`, který `PlannerPage` napojí na **již existující** handler `handleDtpPopoverSave` (přejmenován na `handleDtpDataStatusChange`, sdílen s popoverem na bloku v planneru). Server **beze změny** — API `PUT /api/blocks/[id]` už DTP roli a mutaci `dataStatusId/Label/Ok` umí + zapisuje audit log.

**Tech Stack:** React 18, TypeScript, Next.js 16, native `<select>` (vzor z `BlockEdit.tsx::StatusSelect`).

**Spec:** [docs/superpowers/specs/2026-05-23-dtp-inline-status-edit-design.md](../specs/2026-05-23-dtp-inline-status-edit-design.md)

---

## File Structure

| Soubor | Akce | Důvod |
|---|---|---|
| `src/app/_components/PlannerPage.tsx` | Modify (řádek 1735 + řádek 3236) | Rename handleru + propagace nového propu do `<DtpPanel>` |
| `src/components/DtpPanel.tsx` | Modify (interface `DtpPanelProps` + `BlockCard` + nová sub-komponenta) | Hlavní změna: prop `onStatusChange` + nahrazení statického chipu interaktivním selectem |

**Žádný nový soubor.** `StatusChipSelect` je sub-komponenta v `DtpPanel.tsx` (vzor stejný jako stávající `BlockCard`, `FilterChip`, `ResizeHandle` v tomtéž souboru).

**Server beze změny.** API `PUT /api/blocks/[id]` (řádky 80–85 a 142–187) už DTP roli a auto-derivaci `dataOk` zvládá.

**Testy:** Žádný nový automatizovaný test. V projektu se neexistuje React testovací setup; UI změny se verifikují manuálně (viz Task 4 níže). Existujících 24/24 testů zůstává zelené, protože server ani sdílené utility se nemění.

---

## Task 1: Rename handleru v PlannerPage (přípravná refaktorace bez change of behavior)

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:1735` (definice handleru) + `src/app/_components/PlannerPage.tsx:4165` (volání v `<DtpDataPopover onSave={...}>`)

**Důvod:** Nový panel bude sdílet handler s popoverem na bloku. Obecnější název = jasnější kód.

- [ ] **Step 1.1: Přejmenovat funkci**

V `src/app/_components/PlannerPage.tsx` najít:

```typescript
async function handleDtpPopoverSave(
  blockId: number,
  patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }
) {
```

Přejmenovat na:

```typescript
async function handleDtpDataStatusChange(
  blockId: number,
  patch: { dataStatusId?: number | null; dataStatusLabel?: string | null; dataOk?: boolean }
) {
```

(Vnitřek funkce nech beze změny — funguje správně: PUT → on success `handleBlockUpdate(updated)`, on error `showToast`.)

- [ ] **Step 1.2: Aktualizovat volání v `<DtpDataPopover>`**

V `src/app/_components/PlannerPage.tsx` najít (kolem řádku 4165):

```tsx
<DtpDataPopover
  blockId={dtpPopover.blockId}
  currentStatusId={dtpPopover.statusId}
  dataOpts={bDataOpts}
  anchorRect={dtpPopover.rect}
  onClose={() => setDtpPopover(null)}
  onSave={handleDtpPopoverSave}
/>
```

Změnit na:

```tsx
<DtpDataPopover
  blockId={dtpPopover.blockId}
  currentStatusId={dtpPopover.statusId}
  dataOpts={bDataOpts}
  anchorRect={dtpPopover.rect}
  onClose={() => setDtpPopover(null)}
  onSave={handleDtpDataStatusChange}
/>
```

- [ ] **Step 1.3: Ověřit, že nikde jinde v kódu není odkaz na starý název**

Spustit:

```bash
grep -rn "handleDtpPopoverSave" src/
```

Očekávaný výstup: **prázdný** (žádné nalezené odkazy). Pokud něco najde, přejmenovat.

- [ ] **Step 1.4: Spustit build**

```bash
npm run build
```

Očekávaný výstup: `✓ Compiled successfully` (TypeScript prošel, žádná chyba).

- [ ] **Step 1.5: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "refactor: rename handleDtpPopoverSave to handleDtpDataStatusChange

Příprava na sdílení handleru mezi popoverem na bloku v planneru
a chystaným inline editem v DtpPanel. Pouze rename, žádná změna chování."
```

---

## Task 2: Přidat prop `onStatusChange` do `DtpPanel` a propagovat do `BlockCard` (typy + napojení, bez UI změny)

**Files:**
- Modify: `src/components/DtpPanel.tsx` (interface `DtpPanelProps`, propagace do `BlockCard`)
- Modify: `src/app/_components/PlannerPage.tsx:3236` (předat handler jako prop)

**Důvod:** Předem připravit "trubku" pro data od selectu k handleru. UI se v tomto kroku nemění — pouze typy a propagace. Tento krok je samostatně buildovatelný a deploybatelný (žádný visible change).

- [ ] **Step 2.1: Rozšířit interface `DtpPanelProps`**

V `src/components/DtpPanel.tsx` najít (řádek 22–30):

```typescript
interface DtpPanelProps {
  blocks: Block[];
  dataOpts: CodebookOption[];
  onScrollToBlock: (block: Block) => void;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit?: (w: number) => void;
  onClose?: () => void;
}
```

Přidat nový povinný prop `onStatusChange`:

```typescript
interface DtpPanelProps {
  blocks: Block[];
  dataOpts: CodebookOption[];
  onScrollToBlock: (block: Block) => void;
  onStatusChange: (blockId: number, patch: { dataStatusId: number | null; dataStatusLabel: string | null; dataOk: boolean }) => Promise<void>;
  width: number;
  onWidthChange: (w: number) => void;
  onWidthCommit?: (w: number) => void;
  onClose?: () => void;
}
```

- [ ] **Step 2.2: Destruktovat prop a propagovat do `BlockCard`**

V signatuře `DtpPanel` (řádek 59–67) přidat `onStatusChange`:

```typescript
export function DtpPanel({
  blocks,
  dataOpts,
  onScrollToBlock,
  onStatusChange,
  width,
  onWidthChange,
  onWidthCommit,
  onClose,
}: DtpPanelProps) {
```

Najít render `BlockCard` (řádek 204–211):

```tsx
{filteredBlocks.map((block) => (
  <BlockCard
    key={block.id}
    block={block}
    dataOpts={dataOpts}
    onScrollTo={() => onScrollToBlock(block)}
  />
))}
```

Přidat prop `onStatusChange`:

```tsx
{filteredBlocks.map((block) => (
  <BlockCard
    key={block.id}
    block={block}
    dataOpts={dataOpts}
    onScrollTo={() => onScrollToBlock(block)}
    onStatusChange={onStatusChange}
  />
))}
```

- [ ] **Step 2.3: Rozšířit props v `BlockCard`**

Najít signaturu `BlockCard` (řádek 244–250):

```typescript
function BlockCard({
  block, dataOpts, onScrollTo,
}: {
  block: Block;
  dataOpts: CodebookOption[];
  onScrollTo: () => void;
}) {
```

Přidat `onStatusChange`:

```typescript
function BlockCard({
  block, dataOpts, onScrollTo, onStatusChange,
}: {
  block: Block;
  dataOpts: CodebookOption[];
  onScrollTo: () => void;
  onStatusChange: (blockId: number, patch: { dataStatusId: number | null; dataStatusLabel: string | null; dataOk: boolean }) => Promise<void>;
}) {
```

(`onStatusChange` se v tomto kroku ještě nepoužívá — to přijde v Tasku 3. Jen prop existuje v typech.)

- [ ] **Step 2.4: Předat handler z PlannerPage**

V `src/app/_components/PlannerPage.tsx` najít render `<DtpPanel>` (kolem řádku 3236):

```tsx
<DtpPanel
  blocks={blocks}
  dataOpts={bDataOpts}
  onScrollToBlock={handleDtpScrollToBlock}
  width={dtpPanelWidth}
  onWidthChange={setDtpPanelWidth}
  onWidthCommit={(w) => savePreference("dtp-panel-width", String(w))}
  onClose={currentUser.role !== "DTP" ? () => setShowDtpPanel(false) : undefined}
/>
```

Přidat `onStatusChange`:

```tsx
<DtpPanel
  blocks={blocks}
  dataOpts={bDataOpts}
  onScrollToBlock={handleDtpScrollToBlock}
  onStatusChange={handleDtpDataStatusChange}
  width={dtpPanelWidth}
  onWidthChange={setDtpPanelWidth}
  onWidthCommit={(w) => savePreference("dtp-panel-width", String(w))}
  onClose={currentUser.role !== "DTP" ? () => setShowDtpPanel(false) : undefined}
/>
```

- [ ] **Step 2.5: Spustit build a lint**

```bash
npm run build
```

Očekávaný výstup: `✓ Compiled successfully`. (Pokud TS hlásí "onStatusChange is unused" — to je v pořádku, použije se v Tasku 3. Build by neměl failnout, jen warning.)

```bash
npm run lint
```

Očekávaný výstup: žádná nová chyba (existující warningy jsou OK podle CLAUDE.md).

- [ ] **Step 2.6: Commit**

```bash
git add src/components/DtpPanel.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat: připravit prop onStatusChange v DtpPanel pro inline edit DATA statusu

Propagace handleru z PlannerPage přes DtpPanel až do BlockCard.
UI se zatím nemění — to přijde v navazujícím commitu (inline select chip)."
```

---

## Task 3: Nahradit statický chip komponentou `StatusChipSelect` (vlastní UI změna)

**Files:**
- Modify: `src/components/DtpPanel.tsx` (`BlockCard` render statusu + nová sub-komponenta `StatusChipSelect`)

**Důvod:** Vlastní vizuální + funkční změna featury — DTP může změnit status jedním klikem v dropdownu na kartě.

- [ ] **Step 3.1: Přidat sub-komponentu `StatusChipSelect` na konec souboru**

V `src/components/DtpPanel.tsx` (před uzavírací `}` nebo na konec souboru, vedle ostatních sub-komponent jako `FilterChip` / `ResizeHandle`) přidat:

```tsx
// ─── StatusChipSelect ────────────────────────────────────────────────────────
function StatusChipSelect({
  block, dataOpts, onChange,
}: {
  block: Block;
  dataOpts: CodebookOption[];
  onChange: (statusIdStr: string) => void;
}) {
  const chipAccent = useMemo(() => {
    if (!block.dataStatusId) return null;
    const opt = dataOpts.find((o) => o.id === block.dataStatusId);
    return badgeColorVar(opt?.badgeColor ?? null) ?? "var(--badge-blue)";
  }, [block.dataStatusId, dataOpts]);

  const hasStatus = !!block.dataStatusId;
  const accent = chipAccent ?? "var(--badge-blue)";

  // SVG šipka jako background-image (data URI). Native <select> jinak vykreslí OS šipku.
  const arrowSvg = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none' stroke='%23${
    hasStatus ? "9ca3af" : "6b7280"
  }' stroke-width='1.5'><path d='M1 1l4 4 4-4' stroke-linecap='round'/></svg>")`;

  return (
    <select
      value={block.dataStatusId?.toString() ?? ""}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      style={{
        appearance: "none",
        WebkitAppearance: "none",
        MozAppearance: "none",
        padding: "2px 18px 2px 7px",
        borderRadius: 10,
        fontSize: 9,
        fontWeight: hasStatus ? 700 : 500,
        fontStyle: hasStatus ? "normal" : "italic",
        color: hasStatus
          ? `color-mix(in oklab, ${accent} 70%, var(--text))`
          : "var(--text-muted)",
        background: hasStatus
          ? `color-mix(in oklab, ${accent} 30%, transparent)`
          : "transparent",
        border: hasStatus
          ? `1px solid ${accent}`
          : "1px dashed var(--border)",
        cursor: "pointer",
        outline: "none",
        backgroundImage: arrowSvg,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 5px center",
        backgroundSize: "8px 5px",
        lineHeight: 1.4,
        maxWidth: "100%",
      }}
    >
      <option value="">— bez statusu —</option>
      {dataOpts.filter((o) => o.isActive).map((opt) => (
        <option key={opt.id} value={opt.id.toString()}>
          {opt.isWarning ? "⚠ " : ""}{opt.label}
        </option>
      ))}
    </select>
  );
}
```

**Pozn. k SVG:** `%23` je URL-encoded `#`. Barva šipky je hardcoded šedá (`#9ca3af` / `#6b7280`) místo CSS proměnné, protože `currentColor` v data URI nefunguje. Pro tento drobný chip je to akceptovatelné.

- [ ] **Step 3.2: Nahradit statický chip v `BlockCard`**

V `src/components/DtpPanel.tsx` najít stávající blok (řádek 294–313 — celý `block.dataStatusLabel ? (...) : (...)`):

```tsx
{block.dataStatusLabel ? (
  <span style={{
    display: "inline-block", padding: "2px 7px", borderRadius: 10,
    fontSize: 9, fontWeight: 700,
    color: `color-mix(in oklab, ${chipAccent ?? "var(--badge-blue)"} 70%, var(--text))`,
    background: `color-mix(in oklab, ${chipAccent ?? "var(--badge-blue)"} 30%, transparent)`,
    border: `1px solid ${chipAccent ?? "var(--badge-blue)"}`,
  }}>
    {block.dataStatusLabel}
  </span>
) : (
  <span style={{
    display: "inline-block", padding: "2px 7px", borderRadius: 10,
    fontSize: 9, fontWeight: 500, fontStyle: "italic",
    background: "transparent", color: "var(--text-muted)",
    border: "1px dashed var(--border)",
  }}>
    bez statusu
  </span>
)}
```

Nahradit tímto:

```tsx
<StatusChipSelect
  block={block}
  dataOpts={dataOpts}
  onChange={(statusIdStr) => {
    const statusId = statusIdStr ? parseInt(statusIdStr, 10) : null;
    const selectedOpt = dataOpts.find((o) => o.id === statusId);
    return onStatusChange(block.id, {
      dataStatusId: statusId,
      dataStatusLabel: selectedOpt?.label ?? null,
      dataOk: statusId !== null,
    });
  }}
/>
```

- [ ] **Step 3.3: Odstranit nepoužitý `chipAccent` z `BlockCard`**

`StatusChipSelect` si `chipAccent` počítá sám, takže v `BlockCard` už není potřeba. Najít (řádek 257–261):

```typescript
const chipAccent = useMemo(() => {
  if (!block.dataStatusId) return null;
  const opt = dataOpts.find((o) => o.id === block.dataStatusId);
  return badgeColorVar(opt?.badgeColor ?? null) ?? "var(--badge-blue)";
}, [block.dataStatusId, dataOpts]);
```

**Smazat** těchto 5 řádků (a prázdný řádek nad/pod nimi).

Pokud po smazání zůstane `badgeColorVar` nepoužité v souboru, ESLint nebo TS to nahlásí — pak smazat i import:

```typescript
import { badgeColorVar } from "@/lib/badgeColors";
```

**Pozor:** `badgeColorVar` se ve `StatusChipSelect` používá, takže import musí zůstat. Ověřit:

```bash
grep -n "badgeColorVar" src/components/DtpPanel.tsx
```

Očekávaný výstup: minimálně 2 výskyty (import + použití v `StatusChipSelect`). Pokud ano, import nech.

- [ ] **Step 3.4: Spustit build**

```bash
npm run build
```

Očekávaný výstup: `✓ Compiled successfully`.

- [ ] **Step 3.5: Spustit lint**

```bash
npm run lint
```

Očekávaný výstup: žádná nová chyba ani warning v `DtpPanel.tsx`.

- [ ] **Step 3.6: Spustit existující test suite (sanity check)**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Očekávaný výstup: **24/24 testů zelené** (nic se nezměnilo na serveru ani v utilitách).

- [ ] **Step 3.7: Commit**

```bash
git add src/components/DtpPanel.tsx
git commit -m "feat: inline edit DATA statusu v DtpPanel kartě

Statický chip v BlockCard nahrazen native <select> stylizovaným
jako stávající chip. Auto-save přes onChange — sdílí handler
handleDtpDataStatusChange s existujícím popoverem na bloku.

Klik na select e.stopPropagation() — zbytek karty dál skroluje
na blok v timeline. Server beze změny (DTP role už dnes smí
mutovat dataStatusId/Label/Ok + audit log se zapisuje automaticky)."
```

---

## Task 4: Manuální akceptační test v devu

**Files:** žádné — pouze ověření v browseru.

**Důvod:** UI změna bez automatizovaných testů → potřeba ověřit v reálném prostředí, že vše funguje včetně rerenderu chipu na bloku v timeline, auditu, filtrace.

- [ ] **Step 4.1: Spustit dev server**

```bash
npm run dev
```

Otevřít http://localhost:3000.

- [ ] **Step 4.2: Přihlásit se jako DTP uživatel**

Pokud DTP účet v dev DB není, vytvořit ho přes `/admin` (jako ADMIN) nebo přímo SQL:

```sql
INSERT INTO User (username, passwordHash, role, isActive)
VALUES ('dtp-test', '<bcrypt hash>', 'DTP', 1);
```

Tip: pro rychlý hash spustit:

```bash
node -e "console.log(require('bcryptjs').hashSync('test123', 10))"
```

Pak se přihlásit jako `dtp-test` / `test123`.

- [ ] **Step 4.3: Ověřit, že DtpPanel je viditelný**

Po loginu se DTP automaticky dostává na `/` (planner). Pravý panel `DtpPanel` musí být otevřený (pro DTP roli má `onClose={undefined}` — nedá se zavřít).

- [ ] **Step 4.4: Ověřit, že karty mají interaktivní chip**

Najít kartu s nějakou zakázkou. Chip statusu vpravo dole má **šipku dolů** vpravo od labelu (oproti původnímu staticky vykreslenému chipu). Hover ukáže kurzor `pointer`.

- [ ] **Step 4.5: Změnit status**

1. Kliknout na chip → otevře se native dropdown se seznamem aktivních statusů z číselníku DATA + první option `— bez statusu —`.
2. Vybrat **jiný** status (např. z `rozpracováno` → `OK`).
3. Dropdown se zavře.
4. **Ověřit:** chip v kartě se okamžitě překreslí (jiná barva / label).
5. **Ověřit:** chip na bloku přímo v timeline (vlevo, v `TimelineGrid`) se taky překreslí — stejný `blocks` state, takže rerender je automatický.

- [ ] **Step 4.6: Ověřit perzistenci**

1. Hard reload (Cmd+Shift+R).
2. **Ověřit:** status zůstal změněný (uložilo se do DB).

- [ ] **Step 4.7: Ověřit audit log**

1. Odhlásit DTP, přihlásit jako ADMIN nebo PLANOVAT.
2. Otevřít blok v timeline (klik) → InfoPanel / detail bloku → historie.
3. **Ověřit:** je tam záznam změny `dataStatusLabel` s autorem `dtp-test` a časem akce.

Alternativně otevřít `/admin` → tab Audit → ověřit záznam tam.

- [ ] **Step 4.8: Ověřit klik na zbytek karty (skroll)**

1. Přihlásit znovu jako DTP.
2. V DtpPanel kliknout na **číslo zakázky / datum / stroj** (= mimo chip).
3. **Ověřit:** timeline se skroluje na blok (stejné chování jako dřív).
4. **Ověřit:** dropdown se NEotevře (klik na chip a klik na zbytek karty se nepletou).

- [ ] **Step 4.9: Ověřit filtr "live" chování**

1. V DtpPanel filtr-chips kliknout na nějaký status (např. `rozpracováno`) → zůstanou jen karty s tímto statusem.
2. Na jedné kartě změnit status na **jiný** (např. `OK`).
3. **Ověřit:** karta zmizí z view (filtr je live — správné chování).
4. **Ověřit:** toast / žádná chybová hláška se neobjeví (operace proběhla úspěšně, jen filtr karty schoval).

- [ ] **Step 4.10: Ověřit chování při network erroru (volitelné, ale dobré pojistit)**

1. Otevřít Chrome DevTools → Network → throttling: **Offline**.
2. Změnit status na kartě.
3. **Ověřit:** toast s `"Chyba při ukládání."` se zobrazí.
4. **Ověřit:** chip se vrátí na původní hodnotu (lokální state se nezměnil, protože `handleDtpDataStatusChange` updatuje state až po úspěšném PUT).

- [ ] **Step 4.11: Zastavit dev server**

```
Ctrl+C v terminálu, kde běží npm run dev
```

---

## Task 5: Aktualizovat `CLAUDE.md` (volitelné)

**Files:** Modify: `CLAUDE.md`

**Důvod:** Sekce "Klíčové soubory" obsahuje seznam DTP komponent. Stojí za zmínku, že `DtpPanel` nově umí inline edit DATA statusu (řádek o `src/components/DtpPanel.tsx` rozšířit).

- [ ] **Step 5.1: Najít sekci o `DtpPanel`**

V `CLAUDE.md` (jediná zmínka `DtpPanel` nemusí být — projekt CLAUDE.md ho výslovně nelistuje pod "Planner — komponenty"). Pokud ano, rozšířit popis. Pokud ne, **přeskočit tento task celý** — repozitorní CLAUDE.md popisuje hlavně role a moduly, nikoli detail jednotlivých komponent.

Spustit:

```bash
grep -n "DtpPanel\|DTP panel\|DTP přehled" CLAUDE.md
```

Pokud výstup je **prázdný** → tento task přeskočit (nic neaktualizovat).

Pokud najde řádky → doplnit krátkou zmínku, např.:

> DtpPanel (pravá lišta) — DTP může v něm inline měnit DATA status zakázky přes select na kartě.

- [ ] **Step 5.2: Commit (jen pokud byla změna)**

```bash
git add CLAUDE.md
git commit -m "docs: zmínit inline edit DATA statusu v DtpPanel"
```

---

## Self-review

**Spec coverage:**
- Inline edit DATA statusu z karet v DtpPanel → Task 3 ✓
- Auto-save přes onChange → Task 3.2 (return promise z `onChange` callbacku) ✓
- `e.stopPropagation` na selectu → Task 3.1 (`onMouseDown` + `onClick` na `<select>`) ✓
- Klik na zbytek karty = skroll → zachováno (`BlockCard` `handleClick` se nemění) ✓
- Reuse handleru `handleDtpPopoverSave` → Task 1 (rename) + Task 2 (předání jako prop) ✓
- Server beze změny → potvrzeno, žádný task na server ✓
- Audit log funguje automaticky → potvrzeno (Task 4.7 ověření) ✓
- Filtr live chování → Task 4.9 ověření ✓
- Error handling (toast) → existující kód v `handleDtpDataStatusChange` (Task 1 ho jen přejmenuje) ✓

**Placeholder scan:** Žádné TBD/TODO/"implement later". Všechny code bloky mají konkrétní obsah.

**Type consistency:**
- `onStatusChange` má v Task 2.1, 2.3 a 2.4 stejnou signaturu: `(blockId: number, patch: { dataStatusId: number | null; dataStatusLabel: string | null; dataOk: boolean }) => Promise<void>` ✓
- `handleDtpDataStatusChange` v PlannerPage má kompatibilní signaturu (patch fields jsou optional `?` v původní, ale `Partial`-kompatibilní s povinnými poli v `onStatusChange`) — TS to akceptuje, protože callsite vždy posílá všechna tři pole ✓
- `StatusChipSelect.onChange` přijímá `statusIdStr: string` (z `<select>` value), volá `onStatusChange` s parsed číslem ✓

Plán je hotový.
