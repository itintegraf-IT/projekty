# ČÁSTEČNĚ VYDÁNO — implementační plán (etapa 1 vlny z vlákna s plánovačem)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Třetí stav materiálu „částečně vydáno" jako Boolean `Block.materialPartiallyIssued`, ovládaný mini tlačítkem „½" vedle VYDÁNO v BlockEdit (varianta A, rozhodnuto 19. 8. po interaktivním mockupu), zobrazený amber stavem v panelu, na kartě (chip „M ČÁST."), v detailu a na Monitoru.

**Architecture:** Kopíruje zavedený vzor `materialIssued`/`pantoneIssued` — Boolean na `Block`, propagace přes `SPLIT_SHARED_FIELDS`, audit + revize + undo přes existující allowlisty (strážné testy si doplnění vynutí samy). Jediná nová sémantika: vzájemné vyloučení s `materialIssued` (klient přepíná, server vynucuje v PUT; při rozporném body vyhrává plné VYDÁNO).

**Tech Stack:** Next.js 16 · Prisma 5 (ruční migrace — `migrate dev` je rozbité, P3006 shadow replay) · node:test + tsx.

**Spec:** `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` (etapa 1) + mockup https://claude.ai/code/artifact/1f20123d-0870-42e5-981a-95e729ede028 (varianta A) + inventura míst v tomto plánu (sekce „Reference" níže).

## Global Constraints

- **NEZAČÍNAT, dokud vedlejší session nedokončí kaskádovou vlnu** — `BlockEdit.tsx`/`PlannerPage.tsx` mají 19. 8. necommitnuté cizí změny. Před Task 1: `git status` musí být čistý a poslední commit nesmí být rozpracovaná kaskáda. Čísla řádků v tomto plánu jsou orientační (psaná nad stavem `f3ad8609` + cizí rozpracovaná kaskáda) — vždy hledej podle citovaného kódu, ne podle čísla.
- Nikdy `prisma migrate dev` / `db push` / `db pull` / `prisma format` (CLAUDE.md). Migrace ručně + `npx prisma migrate deploy` + `npx prisma generate`.
- Chyby API → `AppError`; logování → `logger`; mutace bloku uvnitř `withRevision` (všechny dotčené routy už obalené jsou — nová cesta nevzniká).
- Barvy: `BlockEdit.tsx`/`BlockDateChip.tsx` používají pro stavové barvy literály (`#10b981`, `#3b82f6`) z doby před tokenovou konvencí — amber přidej stejným stylem (`#f59e0b`, rgba odvozeniny), ať soubor zůstane konzistentní. Nový token se nezavádí.
- Sémantická rozhodnutí (schválená s variantou A): „½" se chová jako VYDÁNO — nahradí datepicker stavovým boxem, PUT nuluje `materialRequiredDate`, počítá se jako „materiál vyřešen" (potlačí warning, Monitor tone „ok"). Inline datepicker v plánu tlačítko „½" NEDOSTANE (minimální rozsah) — jen musí nový flag nulovat při výběru termínu. Do builderu, rezervací a presetů se pole NEPŘIDÁVÁ (z fronty vzniká nový blok — „vydáno" tam nikdy není true; stejná logika platí pro „½").

---

### Task 1: Sloupec v DB + revize (schéma → strážný test → migrace)

**Files:**
- Modify: `prisma/schema.prisma` (model Block, vedle `materialIssued`)
- Modify: `src/lib/revision/blockColumns.ts`
- Create: `prisma/migrations/20260819120000_add_material_partially_issued/migration.sql`

**Interfaces:**
- Produces: sloupec `Block.materialPartiallyIssued Boolean @default(false)` + položka v `BLOCK_BOOLEAN_COLUMNS` — všechno ostatní na tom staví.

- [ ] **Step 1: Schéma** — do modelu `Block` hned pod `materialIssued`:
```prisma
  materialInStock                             Boolean      @default(false)
  materialIssued                              Boolean      @default(false)
  materialPartiallyIssued                     Boolean      @default(false)
```
- [ ] **Step 2: Spusť strážný test — musí SPADNOUT** (parsuje schema regexem a porovnává množinově s konstantou):
Run: `node --test --import tsx src/lib/revision/rowNormalize.test.ts`
Expected: FAIL — `materialPartiallyIssued` chybí v `BLOCK_BOOLEAN_COLUMNS`.
- [ ] **Step 3: Doplň konstantu** v `src/lib/revision/blockColumns.ts`:
```typescript
  "materialInStock", "materialIssued", "materialPartiallyIssued", "pantoneRequired", "pantoneOk",
```
- [ ] **Step 4: Test znovu — musí PROJÍT.**
- [ ] **Step 5: Migrace** — vzor `20260811120000_add_pantone_in_stock_issued/migration.sql`:
```sql
-- AlterTable
ALTER TABLE `Block` ADD COLUMN `materialPartiallyIssued` BOOLEAN NOT NULL DEFAULT false;
```
- [ ] **Step 6: Aplikuj a přegeneruj klienta:**
Run: `npx prisma migrate deploy && npx prisma generate`
Expected: migrace aplikována na dev DB `IGvyroba`, klient zná nové pole.
- [ ] **Step 7: Commit** — `feat(material): sloupec materialPartiallyIssued + revizni pokryti`

### Task 2: Sdílené allowlisty (split · audit · série · undo · payload)

**Files:**
- Modify: `src/lib/splitSharedFields.ts` + `splitSharedFields.test.ts`
- Modify: `src/lib/auditedFields.ts` · `src/lib/auditFormatters.ts` + `auditFormatters.test.ts` · `splitPropagateAudit.test.ts`
- Modify: `src/lib/seriesPropagation.ts` + `seriesPropagation.test.ts`
- Modify: `src/lib/undo/restoreFields.ts` + `restoreFields.test.ts`
- Modify: `src/lib/blockPayload.ts` + `blockPayload.test.ts`

**Interfaces:**
- Produces: `"materialPartiallyIssued"` ∈ `SPLIT_SHARED_FIELDS`, `AUDITED_FIELDS`, `SERIES_EXCLUDED_FIELDS`, `UNDO_RESTORABLE_FIELDS`, `EXPECTED_PAYLOAD_KEYS`; český label „Materiál částečně vydán". Zápis do `SPLIT_SHARED_FIELDS` automaticky zapojí PUT propagaci na sourozence, `splitPropagateAudit` i health-check `computeSplitDivergence` (generický konzument).

- [ ] **Step 1:** `splitSharedFields.ts` — do materiálové řádky seznamu: `..., "materialOk", "materialInStock", "materialIssued", "materialPartiallyIssued",`. V `splitSharedFields.test.ts` přepiš tvrzený počet `31` → `32`.
- [ ] **Step 2:** `auditedFields.ts` — na řádek s flagy: `"pantoneRequiredDate", "pantoneOk", "pantoneRequired", "materialInStock", "materialIssued", "materialPartiallyIssued",`
- [ ] **Step 3:** `auditFormatters.ts` — label pod `materialIssued`:
```typescript
  materialIssued: "Materiál vydán",
  materialPartiallyIssued: "Materiál částečně vydán",
```
a rozšiř podmínku ✓/✗ ve `fmtAuditVal`:
```typescript
  if (field === "materialInStock" || field === "materialIssued" || field === "materialPartiallyIssued"
   || field === "pantoneInStock" || field === "pantoneIssued") return val === "true" ? "✓ Ano" : "✗ Ne";
```
V `auditFormatters.test.ts` doplň `"materialPartiallyIssued"` do `knownBooleanSplitFields` (test je jednosměrný — bez doplnění by nová položka unikla kontrole).
- [ ] **Step 4:** `seriesPropagation.ts` — do `SERIES_EXCLUDED_FIELDS` za `materialInStock` přidej `"materialPartiallyIssued",` (per-tisk stav, na sérii se nepropaguje). V `seriesPropagation.test.ts` doplň pole do deepEqual seznamu (16 → 17 položek).
- [ ] **Step 5:** `undo/restoreFields.ts` — do sekce MATERIÁL: `..., "materialInStock", "materialIssued", "materialPartiallyIssued",`. V `restoreFields.test.ts`: `assert.equal(UNDO_RESTORABLE_FIELDS.length, 45)` → `46` a do fixture `FULL_BLOCK` přidej `materialPartiallyIssued: false,` vedle `materialIssued`.
- [ ] **Step 6:** `blockPayload.ts` — tři místa:
```typescript
  materialIssued?: boolean | null;
  materialPartiallyIssued?: boolean | null;
```
```typescript
  "materialIssued",
  "materialPartiallyIssued",
```
```typescript
    materialIssued: block.materialIssued ?? false,
    materialPartiallyIssued: block.materialPartiallyIssued ?? false,
```
V `blockPayload.test.ts` doplň `materialPartiallyIssued` do fixture `FULL_BLOCK` (hodnota `true`, ať se pozná od defaultu) i do očekávaného payloadu.
- [ ] **Step 7:** Spusť dotčené testy + kontrola průniku:
Run: `node --test --import tsx src/lib/splitSharedFields.test.ts src/lib/auditFormatters.test.ts src/lib/splitPropagateAudit.test.ts src/lib/seriesPropagation.test.ts src/lib/undo/restoreFields.test.ts src/lib/blockPayload.test.ts src/lib/healthChecks.server.test.ts`
Expected: `splitPropagateAudit.test.ts` spadne na deepEqual průniku `SPLIT_SHARED_FIELDS ∩ AUDITED_FIELDS` → doplň `"materialPartiallyIssued"` do očekávaného seznamu a spusť znovu; pak vše PASS. (Ve fixture `srow` v `healthChecks.server.test.ts` ověř, že tvar objektu snese nové pole — divergence se generuje ze `SPLIT_SHARED_FIELDS`.)
- [ ] **Step 8:** Commit — `feat(material): materialPartiallyIssued ve sdilenych allowlistech (split/audit/serie/undo/payload)`

### Task 3: Server — POST, PUT (vzájemné vyloučení), split kopie

**Files:**
- Modify: `src/app/api/blocks/route.ts` (POST create)
- Modify: `src/app/api/blocks/[id]/route.ts` (MTZ allowlist + podmíněné zápisy)
- Modify: `src/app/api/blocks/[id]/split/route.ts` (kopie do druhé části)

**Interfaces:**
- Consumes: sloupec z Task 1.
- Produces: invariant „`materialPartiallyIssued` a `materialIssued` nejsou nikdy oba true po PUT; nastavení kteréhokoli nuluje `materialRequiredDate`; při rozporném body vyhrává plné VYDÁNO".

- [ ] **Step 1:** POST `api/blocks/route.ts` — v `tx.block.create` pod `materialIssued`:
```typescript
          materialIssued: body.materialIssued ?? false,
          materialPartiallyIssued: body.materialIssued ? false : (body.materialPartiallyIssued ?? false),
```
- [ ] **Step 2:** PUT `api/blocks/[id]/route.ts` — MTZ allowlist (dnes `materialInStock: body.materialInStock, materialIssued: body.materialIssued,`) doplň o `materialPartiallyIssued: body.materialPartiallyIssued,`.
- [ ] **Step 3:** PUT — podmíněné zápisy. Za dnešní dvojici MATERIAL ISSUED vlož (pořadí spreadů je nosné — pozdější klíč přepíše dřívější, takže při rozporném body vyhraje plné VYDÁNO; zdokumentuj komentářem po vzoru pantone bloku):
```typescript
          // MATERIAL PARTIALLY ISSUED („½") — nuluje termín a vylučuje se s plným VYDÁNO.
          // Pořadí spreadů: partial je PŘED issued, takže rozporné body (obě true) vyřeší
          // poslední zápis ve prospěch plného VYDÁNO — silnější stav vyhrává (vzor: pantone).
          ...(allowed.materialPartiallyIssued !== undefined && { materialPartiallyIssued: allowed.materialPartiallyIssued as boolean }),
          ...(allowed.materialPartiallyIssued === true && { materialRequiredDate: null, materialIssued: false }),
          ...(allowed.materialIssued !== undefined && { materialIssued: allowed.materialIssued as boolean }),
          ...(allowed.materialIssued === true && { materialRequiredDate: null, materialPartiallyIssued: false }),
```
(Dnešní dva řádky `materialIssued` tím nahrazuješ — nesmí zůstat zdvojené.)
- [ ] **Step 4:** Split `api/blocks/[id]/split/route.ts` — v sekci kopírovaných polí pod `materialIssued: block.materialIssued,` přidej `materialPartiallyIssued: block.materialPartiallyIssued,`.
- [ ] **Step 5:** Ověření:
Run: `npm run build`
Expected: 0 TS chyb (typová pojistka `SPLIT_SELECT` v `healthChecks.server.ts` projde díky `prisma generate` z Task 1).
- [ ] **Step 6:** Commit — `feat(material): server prijima materialPartiallyIssued, vynucuje vylouceni s VYDANO`

### Task 4: BlockEdit — tlačítko „½" + amber stav + undo tracking

**Files:**
- Modify: `src/components/BlockEdit.tsx`
- Modify: `src/app/_components/PlannerPage.tsx` (`EDIT_TRACKED_FIELDS`)

**Interfaces:**
- Consumes: PUT chování z Task 3.
- Produces: UI stav `materialPartiallyIssued` posílaný v `buildPayload()`.

- [ ] **Step 1:** State vedle `materialIssued`:
```typescript
  const [materialPartiallyIssued, setMaterialPartiallyIssued] = useState(block.materialPartiallyIssued);
```
- [ ] **Step 2:** `buildPayload` — pod `materialIssued,` přidej `materialPartiallyIssued,` a rozšiř nulování termínu: `materialRequiredDate: materialInStock || materialPartiallyIssued ? null : materialRequiredDate || null,` (u `materialIssued` už to dělá server; klientská větev drží dnešní logiku pro inStock — jen ji rozšiř o partial).
- [ ] **Step 3:** Stavový box — dnešní ternár `materialIssued ? (Vydáno ➜) : materialInStock ? (Skladem ✓) : (DatePickerField)` rozšiř o prostřední větev:
```tsx
) : materialPartiallyIssued ? (
  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.4)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#d97706" }}>Část. vydáno ➜</div>
```
(pořadí větví: issued → partiallyIssued → inStock → datepicker).
- [ ] **Step 4:** OK checkbox — guard `{!materialInStock && !materialIssued && (` rozšiř na `{!materialInStock && !materialIssued && !materialPartiallyIssued && (`.
- [ ] **Step 5:** Tlačítka — VYDÁNO dostane vypnutí „½" a za něj přijde mini tlačítko „½":
```tsx
  <button type="button" onClick={() => { setMaterialIssued(!materialIssued); if (!materialIssued) { setMaterialPartiallyIssued(false); } }} style={{ /* beze změny stylů VYDÁNO */ }}>
    VYDÁNO
  </button>
  <button type="button" title="Částečně vydáno" onClick={() => { setMaterialPartiallyIssued(!materialPartiallyIssued); if (!materialPartiallyIssued) { setMaterialIssued(false); } }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: materialPartiallyIssued ? "1px solid rgba(245,158,11,0.55)" : "1px solid var(--border)", background: materialPartiallyIssued ? "rgba(245,158,11,0.16)" : "transparent", color: materialPartiallyIssued ? "#d97706" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
    ½
  </button>
```
- [ ] **Step 6:** `PlannerPage.tsx` — do `EDIT_TRACKED_FIELDS` přidej `"materialPartiallyIssued"` (vedle `"materialIssued"`) — bez toho Ctrl+Z editaci „½" nevrátí.
- [ ] **Step 7:** Ruční ověření na dev (port 3001): otevři zakázku → klik „½" → amber „Část. vydáno ➜", datum zmizí; klik VYDÁNO → modrý stav, „½" zhasne; ulož, znovu otevři — stav drží; Ctrl+Z vrátí.
- [ ] **Step 8:** Commit — `feat(material): tlacitko "1/2" v BlockEdit + amber stav + undo tracking`

### Task 5: Karta bloku + inline picker — chip „M ČÁST."

**Files:**
- Modify: `src/components/planner/BlockDateChip.tsx` (typ + barvy)
- Modify: `src/components/planner/BlockCard.tsx` (3× mStateKey, 3× text, 3× klikatelnost, materialHandled)
- Modify: `src/app/_components/TimelineGrid.tsx` (typ Block + nulování v inline pickeru)

**Interfaces:**
- Consumes: pole na typu bloku.
- Produces: `DateChipState` rozšířený o `"partial"` (Record typy si vynutí barvy).

- [ ] **Step 1:** `BlockDateChip.tsx` — do union `DateChipState` přidej `| "partial"`; do `DEADLINE_BG`: `partial: "color-mix(in oklab, #f59e0b 85%, black 15%)",`; do `DEADLINE_BORDER` totéž se 70/60 % podle sousedních položek. (TS spadne, dokud oba Recordy nemají nový klíč — to je záměr.)
- [ ] **Step 2:** `BlockCard.tsx` — `materialHandled` rozšiř: `const materialHandled = block.materialInStock || block.materialIssued || block.materialPartiallyIssued;`
- [ ] **Step 3:** `BlockCard.tsx` — VŠECHNY TŘI kopie `mStateKey` (compact/tiny/full) shodně:
```typescript
const mStateKey = block.materialIssued ? "issued" : block.materialPartiallyIssued ? "partial" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
```
- [ ] **Step 4:** VŠECHNY TŘI kopie textu chipu:
```typescript
text={`M ${block.materialIssued ? "VYD." : block.materialPartiallyIssued ? "ČÁST." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}`}
```
- [ ] **Step 5:** VŠECHNY TŘI kopie klikatelnosti — guard `!block.materialInStock && !block.materialIssued` rozšiř o `&& !block.materialPartiallyIssued` (v `onClick` i v `clickable` argumentu `chipStyle`).
- [ ] **Step 6:** `TimelineGrid.tsx` — do lokálního typu `Block` přidej `materialPartiallyIssued: boolean;` a v handleru inline pickeru, kde se při výběru data nulují flagy (`body[inlinePickerFlagFields.inStock] = false; body[...issued] = false;`), přidej pro materiálovou větev i `body.materialPartiallyIssued = false;` (pantone partial nemá — podmíněně jen pro `field === "material"`).
- [ ] **Step 7:** Ruční ověření na dev: zakázka s „½" ukazuje amber chip „M ČÁST." ve všech třech hustotách karty (přepni M/L/XL a výšky); klik na chip nic nedělá (stav je vyřešený); výběr termínu v inline pickeru „½" zruší.
- [ ] **Step 8:** Commit — `feat(material): chip "M CAST." na karte + nulovani v inline pickeru`

### Task 6: BlockDetail + Monitor chips (TDD na monitorChips)

**Files:**
- Modify: `src/lib/monitorChips.ts` + Test: `src/lib/monitorChips.test.ts`
- Modify: `src/components/BlockDetail.tsx`

- [ ] **Step 1: Failing test** — do `monitorChips.test.ts` (fixture `mk()` doplň `materialPartiallyIssued: false`):
```typescript
test("částečně vydaný materiál je ready (tone ok)", () => {
  const chips = monitorChips(mk({ materialStatusLabel: "55m", materialInStock: false, materialIssued: false, materialOk: false, materialPartiallyIssued: true }));
  const mat = chips.find((c) => c.label === "55m");
  assert.equal(mat?.tone, "ok");
});
```
Run: `node --test --import tsx src/lib/monitorChips.test.ts` → Expected: FAIL (tone „wait").
- [ ] **Step 2:** `monitorChips.ts` — `const materialReady = block.materialInStock || block.materialIssued || block.materialPartiallyIssued || block.materialOk;` (+ pole do typu vstupu, pokud je lokální). Pozn.: parita s BlockCard (nález I5) je zajištěna Task 5 Step 2 — obě strany teď počítají shodně.
- [ ] **Step 3:** Test znovu → PASS.
- [ ] **Step 4:** `BlockDetail.tsx` — gate podmínku rozšiř o `|| block.materialPartiallyIssued` a ternár:
```tsx
{(block.materialInStock || block.materialIssued || block.materialPartiallyIssued) && (
  ...
    <span className={block.materialIssued ? "text-blue-400 font-semibold" : block.materialPartiallyIssued ? "text-amber-400 font-semibold" : "text-green-400 font-semibold"}>
      {block.materialIssued ? "Vydáno ➜" : block.materialPartiallyIssued ? "Část. vydáno ½" : "Skladem ✓"}
    </span>
```
- [ ] **Step 5:** Commit — `feat(material): "1/2" v detailu bloku a na Monitoru`

### Task 7: Celá suite, build, dokumenty

- [ ] **Step 1:** Celá test suite (glob nejde do podsložek — každá složka zvlášť, viz CLAUDE.md):
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: vše zelené (výchozí stav byl 1314; přibyl ≥1 test).
- [ ] **Step 2:** `npm run build` → 0 chyb; `npm run lint` → 0 chyb.
- [ ] **Step 3:** Dokumenty: v `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` označ etapu 1 jako hotovou; řádek do `docs/vyvoj-historie.md`.
- [ ] **Step 4:** Commit — `docs(material): etapa 1 hotova` a ohlásit Vojtovi (tempo: zastavit, čekat na OK; nasazení řeší deploy runbook — migrace jde na server PŘED restartem aplikace, jinak health-check hlásí P2022).

---

## Reference — klíčová fakta z inventury (19. 8. 2026)

- `JobPreset` nese jen `materialInStock` (nullable) — „vydáno" ani „½" do presetů nepatří, **žádná změna** (`jobPresets.ts`, `JobPresetEditor.tsx`).
- Builder/rezervace: `handleAddToQueue` posílá `materialIssued: false` natvrdo, rezervační `PlanningForm` `materialIssued` neposílá vůbec → „½" se tam nepřidává, server default `false` stačí.
- `splitSiblingFields.ts`, `reservationSiblings.ts`, `classifyUndoRedoField`, `auditCoverage.test.ts` — generické přes allowlisty, **žádná úprava**.
- Seed skripty (`seed-monitor.ts`, `seed-planner-demo.ts`) — dev-only, default false, **žádná úprava**.
- SKLAD a VYDÁNO se dnes vzájemně NEvylučují (lze oba true; zobrazení má prioritu issued) — „½" zavádí vyloučení jen vůči VYDÁNO, vůči SKLADU se chová jako VYDÁNO (nezávislý flag, priorita zobrazení issued → partial → inStock).
- Deploy pozor: kód s polem v `SPLIT_SHARED_FIELDS` nesmí běžet proti DB bez migrace — `SPLIT_SELECT` v health-checku by četl neexistující sloupec (P2022; `attempt()` to izoluje, ale hlásilo by to).
