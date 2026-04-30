# Preset Preserve Existing Values — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplikace job presetu (klik na preset v BlockEdit nebo JobBuilderu) přepíše hodnoty pouze tam, kde je pole prázdné. `jobPresetId` a `jobPresetLabel` se přepisují vždy. Coupled clearing (`materialInStock=true → clear date`, `pantoneRequired=false → clear date`) se neprovede, pokud má uživatel datum vyplněné.

**Architecture:** Změna izolovaná v jedné čisté funkci `applyJobPresetToDraft` v [src/lib/jobPresets.ts](src/lib/jobPresets.ts). Funkce nemá vedlejší efekty, oba call-sity ji volají stejně, takže UI změny nejsou nutné. TDD: nejdřív kompletní test suite, pak implementace.

**Tech Stack:** TypeScript, Node.js native test runner (`node --test --import tsx`).

**Spec:** [docs/superpowers/specs/2026-04-30-preset-preserve-existing-values-design.md](docs/superpowers/specs/2026-04-30-preset-preserve-existing-values-design.md)

---

## File Structure

- **Create:** `src/lib/jobPresets.test.ts` — kompletní unit test suite pro `applyJobPresetToDraft`
- **Modify:** `src/lib/jobPresets.ts` — pravidlo "preserve existing values" v `applyJobPresetToDraft`

Žádné jiné soubory se nemění. Call-sity (`src/components/BlockEdit.tsx:345`, `src/app/_components/PlannerPage.tsx:1926`) zůstávají beze změny — kontrakt funkce zůstává stejný (`{ next, overwrittenFields }`), jen sémantika se zpřísňuje.

---

## Task 1: Setup test scaffold

**Files:**
- Create: `src/lib/jobPresets.test.ts`

- [ ] **Step 1: Vytvořit test soubor s jedním smoke testem**

Cesta: `src/lib/jobPresets.test.ts`

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { applyJobPresetToDraft, type JobPreset, type JobPresetDraftValues } from "./jobPresets";

function emptyDraft(): JobPresetDraftValues {
  return {
    blockVariant: "STANDARD",
    specifikace: "",
    dataStatusId: "",
    dataRequiredDate: "",
    materialStatusId: "",
    materialRequiredDate: "",
    materialInStock: false,
    pantoneRequired: false,
    pantoneRequiredDate: "",
    barvyStatusId: "",
    lakStatusId: "",
    deadlineExpedice: "",
    jobPresetId: null,
    jobPresetLabel: "",
  };
}

function presetSkeleton(overrides: Partial<JobPreset> = {}): JobPreset {
  return {
    id: 1,
    name: "Test Preset",
    isSystemPreset: false,
    isActive: true,
    sortOrder: 0,
    appliesToZakazka: true,
    appliesToRezervace: false,
    machineConstraint: null,
    blockVariant: null,
    specifikace: null,
    dataStatusId: null,
    dataRequiredDateOffsetDays: null,
    materialStatusId: null,
    materialRequiredDateOffsetDays: null,
    materialInStock: null,
    pantoneRequired: null,
    pantoneRequiredDateOffsetDays: null,
    barvyStatusId: null,
    lakStatusId: null,
    deadlineExpediceOffsetDays: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("smoke: applyJobPresetToDraft is callable", () => {
  const result = applyJobPresetToDraft(emptyDraft(), presetSkeleton(), "ZAKAZKA");
  assert.equal(result.next.jobPresetId, 1);
  assert.equal(result.next.jobPresetLabel, "Test Preset");
});
```

- [ ] **Step 2: Spustit smoke test, ověřit infrastruktura funguje**

Příkaz:
```bash
cd /Users/vojtatokan/Desktop/IG/projekty
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: 1 test passed, 0 failed.

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobPresets.test.ts
git commit -m "test(jobPresets): scaffold pro applyJobPresetToDraft"
```

---

## Task 2: Failing test — empty draft fills from preset (kontrola happy path)

**Files:**
- Modify: `src/lib/jobPresets.test.ts`

- [ ] **Step 1: Přidat test happy path — prázdný blok, preset s offsety**

Přidat do `src/lib/jobPresets.test.ts` (za smoke test):

```typescript
test("empty draft: preset offsets fill all empty date fields", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({
      dataRequiredDateOffsetDays: 11,
      materialRequiredDateOffsetDays: 5,
      pantoneRequiredDateOffsetDays: 3,
      deadlineExpediceOffsetDays: 14,
    }),
    "ZAKAZKA"
  );
  assert.notEqual(result.next.dataRequiredDate, "", "dataRequiredDate should be filled");
  assert.notEqual(result.next.materialRequiredDate, "", "materialRequiredDate should be filled");
  assert.notEqual(result.next.pantoneRequiredDate, "", "pantoneRequiredDate should be filled");
  assert.notEqual(result.next.deadlineExpedice, "", "deadlineExpedice should be filled");
  assert.deepEqual(result.overwrittenFields, [], "no overwrites — all fields were empty");
});
```

- [ ] **Step 2: Spustit, ověřit že prochází (současný kód happy path už zvládá)**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: 2 tests passed.

---

## Task 3: Failing test — filled date fields preserved (jádro Varianty A)

**Files:**
- Modify: `src/lib/jobPresets.test.ts`

- [ ] **Step 1: Přidat test — vyplněné DATA datum se nepřepisuje**

Přidat do `src/lib/jobPresets.test.ts`:

```typescript
test("filled dataRequiredDate is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.dataRequiredDate = "2026-05-11";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ dataRequiredDateOffsetDays: -1 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.dataRequiredDate, "2026-05-11", "preserved user value");
  assert.ok(
    !result.overwrittenFields.includes("dataRequiredDate"),
    "dataRequiredDate must NOT appear in overwrittenFields"
  );
});

test("filled materialRequiredDate is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.materialRequiredDate = "2026-05-15";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ materialRequiredDateOffsetDays: 7 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.materialRequiredDate, "2026-05-15");
  assert.ok(!result.overwrittenFields.includes("materialRequiredDate"));
});

test("filled pantoneRequiredDate is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.pantoneRequiredDate = "2026-05-20";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ pantoneRequiredDateOffsetDays: 3 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.pantoneRequiredDate, "2026-05-20");
  assert.ok(!result.overwrittenFields.includes("pantoneRequiredDate"));
});

test("filled deadlineExpedice is preserved when preset has offset", () => {
  const draft = emptyDraft();
  draft.deadlineExpedice = "2026-05-30";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ deadlineExpediceOffsetDays: 14 }),
    "ZAKAZKA"
  );
  assert.equal(result.next.deadlineExpedice, "2026-05-30");
  assert.ok(!result.overwrittenFields.includes("deadlineExpedice"));
});
```

- [ ] **Step 2: Spustit, ověřit že 4 nové testy SELŽOU**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: 4 testy fail (současná logika přepisuje datumy bez ohledu na current value).

---

## Task 4: Failing test — filled status IDs preserved

**Files:**
- Modify: `src/lib/jobPresets.test.ts`

- [ ] **Step 1: Přidat test pro codebook status ID polí**

Přidat do `src/lib/jobPresets.test.ts`:

```typescript
test("filled status IDs are preserved when preset provides values", () => {
  const draft = emptyDraft();
  draft.dataStatusId = "10";
  draft.materialStatusId = "20";
  draft.barvyStatusId = "30";
  draft.lakStatusId = "40";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({
      dataStatusId: 99,
      materialStatusId: 99,
      barvyStatusId: 99,
      lakStatusId: 99,
    }),
    "ZAKAZKA"
  );
  assert.equal(result.next.dataStatusId, "10");
  assert.equal(result.next.materialStatusId, "20");
  assert.equal(result.next.barvyStatusId, "30");
  assert.equal(result.next.lakStatusId, "40");
  assert.ok(!result.overwrittenFields.includes("dataStatusId"));
  assert.ok(!result.overwrittenFields.includes("materialStatusId"));
  assert.ok(!result.overwrittenFields.includes("barvyStatusId"));
  assert.ok(!result.overwrittenFields.includes("lakStatusId"));
});

test("empty status IDs are filled from preset", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({
      dataStatusId: 5,
      materialStatusId: 6,
      barvyStatusId: 7,
      lakStatusId: 8,
    }),
    "ZAKAZKA"
  );
  assert.equal(result.next.dataStatusId, "5");
  assert.equal(result.next.materialStatusId, "6");
  assert.equal(result.next.barvyStatusId, "7");
  assert.equal(result.next.lakStatusId, "8");
});
```

- [ ] **Step 2: Spustit, ověřit, že "filled status IDs" test selhává**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: 1+ test fail (současný kód přepisuje status IDs i když jsou vyplněné a liší se).

---

## Task 5: Failing test — coupled clearing nesmaže vyplněné datum

**Files:**
- Modify: `src/lib/jobPresets.test.ts`

- [ ] **Step 1: Přidat test pro materialInStock + materialRequiredDate coupling**

Přidat do `src/lib/jobPresets.test.ts`:

```typescript
test("preset materialInStock=true does NOT clear filled materialRequiredDate", () => {
  const draft = emptyDraft();
  draft.materialRequiredDate = "2026-05-15";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ materialInStock: true }),
    "ZAKAZKA"
  );
  assert.equal(result.next.materialInStock, true, "materialInStock toggled to true");
  assert.equal(
    result.next.materialRequiredDate,
    "2026-05-15",
    "materialRequiredDate preserved (NOT cleared)"
  );
  assert.ok(
    !result.overwrittenFields.includes("materialRequiredDate"),
    "materialRequiredDate not in overwrites"
  );
});

test("preset materialInStock=true DOES clear empty materialRequiredDate (no-op)", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({ materialInStock: true }),
    "ZAKAZKA"
  );
  assert.equal(result.next.materialInStock, true);
  assert.equal(result.next.materialRequiredDate, "");
});

test("preset pantoneRequired=false does NOT clear filled pantoneRequiredDate", () => {
  const draft = emptyDraft();
  draft.pantoneRequiredDate = "2026-05-20";
  draft.pantoneRequired = true;
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ pantoneRequired: false }),
    "ZAKAZKA"
  );
  assert.equal(result.next.pantoneRequired, false, "pantoneRequired toggled to false");
  assert.equal(
    result.next.pantoneRequiredDate,
    "2026-05-20",
    "pantoneRequiredDate preserved (NOT cleared)"
  );
  assert.ok(!result.overwrittenFields.includes("pantoneRequiredDate"));
});
```

- [ ] **Step 2: Spustit, ověřit selhání coupled-clearing testů**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: 2 testy fail (současný kód maže datum kdykoliv flag = true/false).

---

## Task 6: Failing test — specifikace a blockVariant chování

**Files:**
- Modify: `src/lib/jobPresets.test.ts`

- [ ] **Step 1: Přidat testy pro specifikace a blockVariant**

Přidat do `src/lib/jobPresets.test.ts`:

```typescript
test("filled specifikace is preserved when preset provides one", () => {
  const draft = emptyDraft();
  draft.specifikace = "Moje specifická poznámka";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ specifikace: "Default z presetu" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.specifikace, "Moje specifická poznámka");
  assert.ok(!result.overwrittenFields.includes("specifikace"));
});

test("empty specifikace is filled from preset", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({ specifikace: "Default z presetu" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.specifikace, "Default z presetu");
});

test("blockVariant != STANDARD is preserved", () => {
  const draft = emptyDraft();
  draft.blockVariant = "BEZ_TECHNOLOGIE";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ blockVariant: "BEZ_SACKU" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.blockVariant, "BEZ_TECHNOLOGIE");
  assert.deepEqual(result.overwrittenFields, []);
});

test("blockVariant = STANDARD gets overridden by preset", () => {
  const result = applyJobPresetToDraft(
    emptyDraft(),
    presetSkeleton({ blockVariant: "BEZ_SACKU" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.blockVariant, "BEZ_SACKU");
});
```

- [ ] **Step 2: Spustit, ověřit selhání**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: 2 testy fail (`filled specifikace` — existující kód přepisuje, `blockVariant != STANDARD is preserved` — existující kód také přepisuje bez ohledu na current). `empty specifikace` a `blockVariant = STANDARD` testy projdou.

---

## Task 7: Failing test — jobPresetId/Label vždy přepsány

**Files:**
- Modify: `src/lib/jobPresets.test.ts`

- [ ] **Step 1: Přidat testy pro identitu presetu**

Přidat do `src/lib/jobPresets.test.ts`:

```typescript
test("jobPresetId is always overwritten", () => {
  const draft = emptyDraft();
  draft.jobPresetId = 99;
  draft.jobPresetLabel = "Old preset";
  const result = applyJobPresetToDraft(
    draft,
    presetSkeleton({ id: 42, name: "New preset" }),
    "ZAKAZKA"
  );
  assert.equal(result.next.jobPresetId, 42);
  assert.equal(result.next.jobPresetLabel, "New preset");
});

test("planner workflow: paste + change preset preserves all dates", () => {
  // Scénář 2 ze specu: blok zkopírovaný s vyplněnými daty, change presetu zachová data
  const draft = emptyDraft();
  draft.dataRequiredDate = "2026-05-11";
  draft.materialRequiredDate = "2026-05-09";
  draft.pantoneRequiredDate = "2026-05-08";
  draft.deadlineExpedice = "2026-05-25";
  draft.dataStatusId = "1";
  draft.materialStatusId = "2";
  draft.jobPresetId = 1;
  draft.jobPresetLabel = "XL 106 LED";

  const newPreset = presetSkeleton({
    id: 2,
    name: "XL 105",
    dataRequiredDateOffsetDays: -1,
    materialRequiredDateOffsetDays: 0,
    pantoneRequiredDateOffsetDays: -2,
    deadlineExpediceOffsetDays: 7,
    dataStatusId: 5,
    materialStatusId: 6,
  });

  const result = applyJobPresetToDraft(draft, newPreset, "ZAKAZKA");

  // Všechny "uživatelské" hodnoty zůstávají
  assert.equal(result.next.dataRequiredDate, "2026-05-11");
  assert.equal(result.next.materialRequiredDate, "2026-05-09");
  assert.equal(result.next.pantoneRequiredDate, "2026-05-08");
  assert.equal(result.next.deadlineExpedice, "2026-05-25");
  assert.equal(result.next.dataStatusId, "1");
  assert.equal(result.next.materialStatusId, "2");

  // Identita presetu se aktualizuje
  assert.equal(result.next.jobPresetId, 2);
  assert.equal(result.next.jobPresetLabel, "XL 105");

  // overwrittenFields by mělo být prázdné — žádné uživatelské pole jsme nepřepsali
  assert.deepEqual(result.overwrittenFields, []);
});
```

- [ ] **Step 2: Spustit kompletní test suite, dokumentovat všechna selhání**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: ~6-8 testů selhává s preserve-existing logikou. Smoke test, empty-draft test a blockVariant testy procházejí.

---

## Task 8: Implementace preserve-existing-values v applyJobPresetToDraft

**Files:**
- Modify: `src/lib/jobPresets.ts:100-191`

- [ ] **Step 1: Nahradit tělo `applyJobPresetToDraft` novou logikou**

V souboru `src/lib/jobPresets.ts` najít funkci `applyJobPresetToDraft` (začíná na řádku 100) a nahradit její celé tělo (řádky 100-191) tímto:

```typescript
export function applyJobPresetToDraft(
  current: JobPresetDraftValues,
  preset: JobPreset,
  type: string
): { next: JobPresetDraftValues; overwrittenFields: string[] } {
  const next: JobPresetDraftValues = { ...current };
  const overwrittenFields: string[] = [];

  // blockVariant: jen když je STANDARD (default)
  if (type === "ZAKAZKA" && preset.blockVariant && current.blockVariant === "STANDARD") {
    next.blockVariant = normalizeBlockVariant(preset.blockVariant, type);
  }

  // specifikace: jen když prázdné
  if (preset.specifikace !== null && current.specifikace.trim() === "") {
    next.specifikace = preset.specifikace;
  }

  // dataStatusId: jen když prázdné
  if (preset.dataStatusId !== null && current.dataStatusId === "") {
    next.dataStatusId = String(preset.dataStatusId);
  }

  // dataRequiredDate: jen když prázdné
  if (preset.dataRequiredDateOffsetDays !== null && current.dataRequiredDate === "") {
    const value = resolvePresetDateOffset(preset.dataRequiredDateOffsetDays) ?? "";
    next.dataRequiredDate = value;
  }

  // materialStatusId: jen když prázdné
  if (preset.materialStatusId !== null && current.materialStatusId === "") {
    next.materialStatusId = String(preset.materialStatusId);
  }

  // materialInStock + coupled clearing materialRequiredDate
  if (preset.materialInStock !== null) {
    if (current.materialInStock !== preset.materialInStock) {
      next.materialInStock = preset.materialInStock;
      // Coupled clearing: jen když current materialRequiredDate je prázdné
      if (preset.materialInStock && current.materialRequiredDate === "") {
        next.materialRequiredDate = "";
      }
    }
  }

  // materialRequiredDate fill: jen když prázdné a preset nehlásí materialInStock
  if (
    !next.materialInStock &&
    preset.materialRequiredDateOffsetDays !== null &&
    current.materialRequiredDate === ""
  ) {
    const value = resolvePresetDateOffset(preset.materialRequiredDateOffsetDays) ?? "";
    next.materialRequiredDate = value;
  }

  // pantoneRequired + coupled clearing pantoneRequiredDate
  if (preset.pantoneRequired !== null) {
    if (current.pantoneRequired !== preset.pantoneRequired) {
      next.pantoneRequired = preset.pantoneRequired;
      // Coupled clearing: jen když current pantoneRequiredDate je prázdné
      if (!preset.pantoneRequired && current.pantoneRequiredDate === "") {
        next.pantoneRequiredDate = "";
      }
    }
  }

  // pantoneRequiredDate fill: jen když prázdné
  if (preset.pantoneRequiredDateOffsetDays !== null && current.pantoneRequiredDate === "") {
    const value = resolvePresetDateOffset(preset.pantoneRequiredDateOffsetDays) ?? "";
    next.pantoneRequiredDate = value;
    // Setting a date implies pantone is required (existing behavior)
    if (value) next.pantoneRequired = true;
  }

  // barvyStatusId: jen když prázdné
  if (preset.barvyStatusId !== null && current.barvyStatusId === "") {
    next.barvyStatusId = String(preset.barvyStatusId);
  }

  // lakStatusId: jen když prázdné
  if (preset.lakStatusId !== null && current.lakStatusId === "") {
    next.lakStatusId = String(preset.lakStatusId);
  }

  // deadlineExpedice: jen když prázdné
  if (preset.deadlineExpediceOffsetDays !== null && current.deadlineExpedice === "") {
    const value = resolvePresetDateOffset(preset.deadlineExpediceOffsetDays) ?? "";
    next.deadlineExpedice = value;
  }

  // Identita presetu — vždy aktualizovat
  next.jobPresetId = preset.id;
  next.jobPresetLabel = preset.name;

  return { next, overwrittenFields };
}
```

**Klíčové změny oproti původnímu kódu:**
1. Každé pole má guard `current.X === ""` (nebo ekvivalent pro daný typ) — apply jen na prázdné
2. Coupled clearing (`materialInStock=true → clear materialRequiredDate`, `pantoneRequired=false → clear pantoneRequiredDate`) má dodatečný guard na prázdnost dotčeného datumu
3. `overwrittenFields` zůstává jako návratová hodnota pro zpětnou kompatibilitu, ale v praxi bude vždy prázdný (Varianta A nikdy nepřepisuje, takže nic není "overwritten"). Confirm dialog v BlockEdit se proto téměř nikdy nezobrazí — žádoucí.
4. `jobPresetId`/`jobPresetLabel` zůstávají bezpodmínečné (identita)
5. `blockVariant` se přepíše pouze když je `STANDARD` (default) — neplatí už původní bezpodmínečné přepsání

**Pomocnou funkci `pushOverwrite` (řádky 96-98) odstranit** — po této změně se nikde nepoužívá a lint by hlásil unused warning. Smazat ji během kroku 1, společně s úpravou těla `applyJobPresetToDraft`.

- [ ] **Step 2: Spustit testy, ověřit, že všechny procházejí**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

Očekávané: všechny testy passed (cca 15+).

Pokud nějaký selhává, oprav implementaci a spusť znovu. Nepokračuj dál, dokud není zelené.

- [ ] **Step 3: Spustit i celou existující test suite, ověřit, že nic jiného se nerozbilo**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Očekávané: 8/8, 5/5, 11/11 — všechny zelené.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobPresets.ts src/lib/jobPresets.test.ts
git commit -m "feat(job-presets): preset zachovává vyplněné hodnoty

Klik na preset přepisuje pole jen pokud je current hodnota prázdná.
jobPresetId a jobPresetLabel se přepisují vždy. Coupled clearing
(materialInStock=true, pantoneRequired=false) se neprovede pokud
má uživatel datum vyplněné.

Řeší stížnost plánovače: zkopírovaný blok + změna presetu už
nepřepisuje DATA datum. Spec:
docs/superpowers/specs/2026-04-30-preset-preserve-existing-values-design.md"
```

---

## Task 9: Verify call-sites — žádná změna není nutná

**Files:**
- Read-only: `src/components/BlockEdit.tsx:325-366`
- Read-only: `src/app/_components/PlannerPage.tsx:1900-1950` (oblast `applyPresetToBuilder`)

- [ ] **Step 1: Přečíst `applyPreset` v BlockEdit a ověřit kontrakt**

Otevři `src/components/BlockEdit.tsx` a najdi funkci `applyPreset` (kolem řádku 344). Ověř že:
- Volá `applyJobPresetToDraft(buildPresetDraft(), preset, type)` — kontrakt funkce je stejný
- Po volání rozkládá `next.*` do React state (setDataRequiredDate, setJobPresetId, atd.)
- Confirm dialog `window.confirm(...)` se ukáže jen když `overwrittenFields.length > 0`

Po našich změnách: `overwrittenFields` bude téměř vždy prázdné → dialog se nezobrazí → klik na preset proběhne tiše. **To je žádoucí chování** (méně friction pro plánovače, který nedělá force-overwrite).

Nemodifikuj nic. Tento krok je pouze verifikační čtení.

- [ ] **Step 2: Přečíst `applyPresetToBuilder` v PlannerPage a ověřit kontrakt**

Otevři `src/app/_components/PlannerPage.tsx`, najdi `applyPresetToBuilder` (kolem řádku 1926). Ověř že volá `applyJobPresetToDraft` se stejným tvarem argumentů a používá `next` + `overwrittenFields` stejným způsobem.

Po změnách: nový blok z fronty má všechna pole prázdná → preset je zaplní (happy path) → žádný regres.

Nemodifikuj nic.

- [ ] **Step 3: Žádný commit (jen verifikace)**

---

## Task 10: Build + lint check

**Files:**
- Read-only verification

- [ ] **Step 1: Spustit `npm run build`**

```bash
cd /Users/vojtatokan/Desktop/IG/projekty
npm run build
```

Očekávané: build prochází (zelený).

Pokud TypeScript hlásí chybu v `jobPresets.ts` nebo souvisejících souborech, oprav a spusť znovu.

- [ ] **Step 2: Spustit `npm run lint`**

```bash
npm run lint
```

Očekávané: 0 errors. Warningy jsou OK (ESLint warningy v existujícím kódu nejsou součástí této change).

Pokud lint hlásí chybu specificky v `jobPresets.ts` nebo `jobPresets.test.ts`, oprav.

- [ ] **Step 3: Žádný commit (build/lint by se měl udržet zelený před manuálním testem)**

---

## Task 11: Manuální verifikace v lokální aplikaci

**Files:**
- N/A (UI test)

- [ ] **Step 1: Spustit dev server**

```bash
npm run dev
```

Otevřít prohlížeč na lokální URL (typicky http://localhost:3000), přihlásit se jako ADMIN nebo PLANOVAT.

- [ ] **Step 2: Scénář 1 (happy path) — nový blok**

1. Vytvořit nový blok typu ZAKAZKA na XL_106 (drag z fronty nebo dvojklik na timeline)
2. Otevřít BlockEdit
3. Kliknout na preset "XL 106 LED"
4. Ověřit: DATA datum, materiál datum, pantone datum, expedice deadline se vyplní podle offsetů presetu
5. Ověřit: žádný confirm dialog se nezobrazí
6. Uložit

Očekávané: identické chování jako před změnou.

- [ ] **Step 3: Scénář 2 (plánovačův case) — paste + change preset**

1. Vytvořit blok na XL_106 s presetem "XL 106 LED" (ručně nebo přes preset). DATA datum nech vyplněné.
2. Zkopírovat blok (Ctrl+C) a vložit (Ctrl+V) na XL_105
3. Otevřít kopii do BlockEdit — ověřit že DATA datum je zděděné po paste
4. Kliknout na preset "XL 105"
5. **Klíčové ověření:**
   - DATA datum se NEZMĚNÍ (zachová se zděděná hodnota)
   - Materiál, pantone, expedice, status IDs se taky NEZMĚNÍ
   - jobPresetLabel se změní na "XL 105"
   - Žádný confirm dialog
6. Uložit
7. Otevřít blok znovu, zkontrolovat audit log:
   - Měl by obsahovat jeden řádek `Preset: XL 106 LED → XL 105`
   - **NESMÍ obsahovat** `DATA datum: 11.05.2026 → 29.04.2026`

Očekávané: plánovačova stížnost je vyřešena.

- [ ] **Step 4: Pokud cokoliv selhává — STOP, hlásit problém**

Pokud manuální test odhalí regres (UI nereaguje, dialog se ukazuje špatně, audit log obsahuje fantom změny), nepokračuj s commitem ani PR. Hlas problém zpět autorovi plánu.

---

## Task 12: Final commit and summary

**Files:**
- N/A

- [ ] **Step 1: Ověřit `git status` je čistý kromě naší změny**

```bash
git status
```

Očekávané: žádné neočekávané modifikace mimo `src/lib/jobPresets.ts` a `src/lib/jobPresets.test.ts` (ty by měly být commitnuté z Tasku 8).

- [ ] **Step 2: Pokud něco zbývá uncommittnuté, commitnout**

Pokud spec byl upravován během psaní plánu nebo dokumentace updatovaná:

```bash
git add docs/superpowers/specs/2026-04-30-preset-preserve-existing-values-design.md docs/superpowers/plans/2026-04-30-preset-preserve-existing-values.md
git commit -m "docs(job-presets): spec a implementační plán pro preserve-existing-values"
```

- [ ] **Step 3: Vypsat shrnutí**

Hlásit Vojtovi:
- Počet testů přidaných (~15)
- Soubory změněné
- Manuální test scénářů 1 a 2 — výsledek
- Build + lint stav
- Případné edge cases zaznamenané během práce
