# Pantone Required Flag — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `pantoneRequired` flag to blocks and job presets so MTZ can see which orders need Pantone before a specific delivery date is known.

**Architecture:** New Boolean `pantoneRequired` field on `Block` and `JobPreset` models. The existing `pantoneRequiredDate` and `pantoneOk` fields stay untouched. The UI derives a three-state visual: ⚠ (required, no date), date chip (required + date), OK (done). The flag flows through: DB → API routes → BlockEdit/PlannerPage builder/PlanningForm → TimelineGrid chip display → JobPresetEditor → preset application logic.

**Tech Stack:** Prisma 5 + MySQL, Next.js API routes, React (inline styles, no CSS modules)

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `prisma/schema.prisma` | Add `pantoneRequired` to Block + JobPreset |
| Create | `prisma/migrations/<timestamp>_add_pantone_required/migration.sql` | Via `prisma migrate dev` |
| Modify | `src/lib/blockSerialization.ts` | No change needed — `pantoneRequired` is a Boolean, auto-serialized |
| Modify | `src/lib/auditFormatters.ts` | Add label for `pantoneRequired` field |
| Modify | `src/lib/jobPresets.ts` | Add `pantoneRequired` to types + `applyJobPresetToDraft` + `buildPresetInputFromDraft` + summary |
| Modify | `src/app/api/blocks/route.ts` | POST: persist `pantoneRequired` |
| Modify | `src/app/api/blocks/[id]/route.ts` | PUT: persist `pantoneRequired`, add to SPLIT_SHARED_FIELDS, MTZ allowed fields |
| Modify | `src/app/api/blocks/batch/route.ts` | No change needed — batch only handles position/time, not pantone fields |
| Modify | `src/app/api/job-presets/route.ts` | POST: persist `pantoneRequired` |
| Modify | `src/app/api/job-presets/[id]/route.ts` | PUT: persist `pantoneRequired` |
| Modify | `src/app/_components/TimelineGrid.tsx` | BlockShape type + chip display logic (⚠ state) |
| Modify | `src/components/BlockEdit.tsx` | Add "Pantone potřeba" toggle above date + OK |
| Modify | `src/app/_components/PlannerPage.tsx` | Builder state for `pantoneRequired`, mapping from API, build payload |
| Modify | `src/app/rezervace/_components/PlanningForm.tsx` | Add `pantoneRequired` toggle |
| Modify | `src/components/job-presets/JobPresetEditor.tsx` | Add "Pantone potřeba" switch |

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma:61` (Block model, after `materialInStock`)
- Modify: `prisma/schema.prisma:149` (JobPreset model, after `materialInStock`)

- [ ] **Step 1: Add `pantoneRequired` to Block model**

In `prisma/schema.prisma`, after line 60 (`materialInStock`), add:

```prisma
  pantoneRequired                             Boolean      @default(false)
```

- [ ] **Step 2: Add `pantoneRequired` to JobPreset model**

In `prisma/schema.prisma`, after line 148 (`materialInStock`), add:

```prisma
  pantoneRequired                Boolean?
```

- [ ] **Step 3: Generate migration**

```bash
npx prisma migrate dev --name add_pantone_required
```

Expected: Migration created successfully, Prisma Client regenerated.

- [ ] **Step 4: Verify migration SQL**

Read the generated `migration.sql` file. It should contain:

```sql
ALTER TABLE `Block` ADD COLUMN `pantoneRequired` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `JobPreset` ADD COLUMN `pantoneRequired` BOOLEAN;
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add pantoneRequired field to Block and JobPreset models"
```

---

### Task 2: Audit Formatter Label

**Files:**
- Modify: `src/lib/auditFormatters.ts:17` (after `pantoneOk` label)

- [ ] **Step 1: Add label for `pantoneRequired`**

In `src/lib/auditFormatters.ts`, in the `FIELD_LABELS` object, after the `pantoneOk: "Pantone OK"` entry, add:

```typescript
  pantoneRequired: "Pantone potřeba",
```

- [ ] **Step 2: Update `fmtAuditVal` for the new boolean field**

In `src/lib/auditFormatters.ts`, line 23, extend the boolean check:

Change:
```typescript
  if (field === "dataOk" || field === "materialOk") return val === "true" ? "✓ OK" : "✗ Ne";
```

To:
```typescript
  if (field === "dataOk" || field === "materialOk" || field === "pantoneRequired") return val === "true" ? "✓ OK" : "✗ Ne";
```

Note: for `pantoneRequired`, "✓ OK" means "yes, pantone is needed" and "✗ Ne" means "not needed". The label "Pantone potřeba" provides context.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auditFormatters.ts
git commit -m "feat: add pantoneRequired audit label and formatter"
```

---

### Task 3: Job Preset Types and Logic

**Files:**
- Modify: `src/lib/jobPresets.ts`

- [ ] **Step 1: Add `pantoneRequired` to `JobPreset` type**

In `src/lib/jobPresets.ts`, in the `JobPreset` type (after `materialInStock: boolean | null;`, line 24), add:

```typescript
  pantoneRequired: boolean | null;
```

- [ ] **Step 2: Add `pantoneRequired` to `JobPresetDraftValues` type**

In `src/lib/jobPresets.ts`, in the `JobPresetDraftValues` type (after `materialInStock: boolean;`, line 40), add:

```typescript
  pantoneRequired: boolean;
```

- [ ] **Step 3: Add `pantoneRequired` to `JobPresetUpsertInput` type**

In `src/lib/jobPresets.ts`, in the `JobPresetUpsertInput` type (after `materialInStock: boolean | null;`, line 61), add:

```typescript
  pantoneRequired: boolean | null;
```

- [ ] **Step 4: Add `pantoneRequired` to `PresetConfigShape` type**

In `src/lib/jobPresets.ts`, in the `PresetConfigShape` type (after `materialInStock?: boolean | null;`, line 223), add:

```typescript
  pantoneRequired?: boolean | null;
```

- [ ] **Step 5: Handle `pantoneRequired` in `applyJobPresetToDraft`**

In `src/lib/jobPresets.ts`, after the `materialInStock` block (line 141) and before the `pantoneRequiredDateOffsetDays` block (line 149), add:

```typescript
  if (preset.pantoneRequired !== null) {
    pushOverwrite(overwrittenFields, "pantoneRequired", current.pantoneRequired !== preset.pantoneRequired);
    next.pantoneRequired = preset.pantoneRequired;
    if (!preset.pantoneRequired) {
      // Disabling pantone clears date
      pushOverwrite(overwrittenFields, "pantoneRequiredDate", current.pantoneRequiredDate !== "");
      next.pantoneRequiredDate = "";
    }
  }
```

Also: the existing `pantoneRequiredDateOffsetDays` block (line 149-153) should now also set `pantoneRequired = true` when it applies a date:

Change:
```typescript
  if (preset.pantoneRequiredDateOffsetDays !== null) {
    const value = resolvePresetDateOffset(preset.pantoneRequiredDateOffsetDays) ?? "";
    pushOverwrite(overwrittenFields, "pantoneRequiredDate", current.pantoneRequiredDate !== "" && current.pantoneRequiredDate !== value);
    next.pantoneRequiredDate = value;
  }
```

To:
```typescript
  if (preset.pantoneRequiredDateOffsetDays !== null) {
    const value = resolvePresetDateOffset(preset.pantoneRequiredDateOffsetDays) ?? "";
    pushOverwrite(overwrittenFields, "pantoneRequiredDate", current.pantoneRequiredDate !== "" && current.pantoneRequiredDate !== value);
    next.pantoneRequiredDate = value;
    // Setting a date implies pantone is required
    if (value) next.pantoneRequired = true;
  }
```

- [ ] **Step 6: Handle `pantoneRequired` in `buildPresetInputFromDraft`**

In `src/lib/jobPresets.ts`, in the `buildPresetInputFromDraft` function return object (after `materialInStock`, line 202), add:

```typescript
    pantoneRequired: draft.pantoneRequired ? true : null,
```

- [ ] **Step 7: Add `pantoneRequired` to `presetHasConfiguredValues`**

In `src/lib/jobPresets.ts`, in the array inside `presetHasConfiguredValues` (after `preset.materialInStock`, line 239), add:

```typescript
    preset.pantoneRequired,
```

- [ ] **Step 8: Add `pantoneRequired` to `summarizeJobPreset`**

In `src/lib/jobPresets.ts`, in `summarizeJobPreset`, after the `lakStatusId` block (line 266) and before the `specifikace` block (line 268), add:

```typescript
  if (preset.pantoneRequired === true) {
    parts.push("Pantone");
  }
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/jobPresets.ts
git commit -m "feat: add pantoneRequired to job preset types and application logic"
```

---

### Task 4: API Routes — Blocks

**Files:**
- Modify: `src/app/api/blocks/route.ts:148-149`
- Modify: `src/app/api/blocks/[id]/route.ts:49,85,129,279`

- [ ] **Step 1: POST /api/blocks — persist `pantoneRequired`**

In `src/app/api/blocks/route.ts`, in the `prisma.block.create` data object, after `pantoneOk: body.pantoneOk ?? false,` (line 149), add:

```typescript
          pantoneRequired: body.pantoneRequired ?? false,
```

- [ ] **Step 2: PUT /api/blocks/[id] — add to SPLIT_SHARED_FIELDS**

In `src/app/api/blocks/[id]/route.ts`, line 49, change:

```typescript
  "pantoneRequiredDate", "pantoneOk",
```

To:

```typescript
  "pantoneRequiredDate", "pantoneOk", "pantoneRequired",
```

- [ ] **Step 3: PUT /api/blocks/[id] — add to MTZ allowed fields**

In `src/app/api/blocks/[id]/route.ts`, after `pantoneOk: body.pantoneOk,` (line 85), add:

```typescript
        pantoneRequired: body.pantoneRequired,
```

- [ ] **Step 4: PUT /api/blocks/[id] — add to ADMIN/PLANOVAT field list for audit**

In `src/app/api/blocks/[id]/route.ts`, line 129, change:

```typescript
      "pantoneRequiredDate", "pantoneOk", "materialInStock",
```

To:

```typescript
      "pantoneRequiredDate", "pantoneOk", "pantoneRequired", "materialInStock",
```

- [ ] **Step 5: PUT /api/blocks/[id] — persist `pantoneRequired` in update**

In `src/app/api/blocks/[id]/route.ts`, after the `pantoneOk` persistence line (line 279), add:

```typescript
          ...(allowed.pantoneRequired !== undefined && { pantoneRequired: allowed.pantoneRequired as boolean }),
```

Also: if `pantoneRequired` is being set to `false`, clear `pantoneRequiredDate` and `pantoneOk`:

Add after the new line above:

```typescript
          // Disabling pantoneRequired clears date and OK
          ...(allowed.pantoneRequired === false && {
            pantoneRequiredDate: null,
            pantoneOk: false,
          }),
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds (no TypeScript errors).

- [ ] **Step 7: Commit**

```bash
git add src/app/api/blocks/route.ts src/app/api/blocks/\[id\]/route.ts
git commit -m "feat: persist pantoneRequired in block API routes"
```

---

### Task 5: API Routes — Job Presets

**Files:**
- Modify: `src/app/api/job-presets/route.ts`
- Modify: `src/app/api/job-presets/[id]/route.ts`

- [ ] **Step 1: POST /api/job-presets — add `pantoneRequired` to parsing**

In `src/app/api/job-presets/route.ts`, in the body type (around line 30), add after `materialInStock`:

```typescript
  pantoneRequired?: unknown;
```

In the `normalized` object (around line 114), add after `materialInStock`:

```typescript
    pantoneRequired: parseNullableBool(body.pantoneRequired),
```

In the validation check (line 122), add `normalized.pantoneRequired === undefined` to the condition.

In the spread into Prisma create data, add:

```typescript
      pantoneRequired: normalized.pantoneRequired,
```

- [ ] **Step 2: PUT /api/job-presets/[id] — same changes**

Mirror the exact same changes in `src/app/api/job-presets/[id]/route.ts`:
- Add `pantoneRequired` to body type
- Add to normalized parsing
- Add to validation check
- Add to Prisma update data spread
- Add `"pantoneRequired"` to the audit diff field list (around line 151, after `"pantoneRequiredDateOffsetDays"`)

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/job-presets/route.ts src/app/api/job-presets/\[id\]/route.ts
git commit -m "feat: persist pantoneRequired in job preset API routes"
```

---

### Task 6: TimelineGrid — Block Type + Chip Display

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:100-102` (BlockShape type)
- Modify: `src/app/_components/TimelineGrid.tsx` (chip display logic in all block render modes)

- [ ] **Step 1: Add `pantoneRequired` to BlockShape type**

In `src/app/_components/TimelineGrid.tsx`, after `pantoneOk: boolean;` (line 102), add:

```typescript
  pantoneRequired: boolean;
```

- [ ] **Step 2: Update chip visibility condition — all render modes**

The Pantone chip currently renders only when `(block.pantoneRequiredDate || block.pantoneOk)`. This condition appears in **5 places** in the file. In every occurrence, change:

```typescript
(block.pantoneRequiredDate || block.pantoneOk)
```

To:

```typescript
(block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk)
```

Use search to find all 5 occurrences (lines ~1052, ~1152, ~1290, ~1339, and the pStateKey calculations).

- [ ] **Step 3: Update pStateKey calculations — all render modes**

The `pStateKey` variable is calculated in several places. The current pattern is:

```typescript
const pStateKey = !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
```

Change each occurrence to:

```typescript
const pStateKey = !block.pantoneRequired && !block.pantoneRequiredDate && !block.pantoneOk ? "empty" : block.pantoneOk ? "ok" : !block.pantoneRequiredDate ? "warning" : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
```

The key change: when `pantoneRequired` is true but `pantoneRequiredDate` is null (and `pantoneOk` is false), the state is `"warning"` — showing the ⚠ style.

- [ ] **Step 4: Update chip text — all render modes**

The chip text pattern currently is:

```typescript
P\u00a0{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "—"}
```

Change each occurrence to:

```typescript
P\u00a0{block.pantoneOk ? "OK" : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${pIcon}` : "⚠"}
```

This replaces the "—" dash with "⚠" when pantone is required but no date is set.

- [ ] **Step 5: Update DateBadge render (medium block mode)**

In the DateBadge for Pantone (around line 1291-1297), the `overrideText` should show "⚠" when required but no date:

Change:
```typescript
overrideText={block.pantoneOk ? "OK" : undefined}
```

To:
```typescript
overrideText={block.pantoneOk ? "OK" : !block.pantoneRequiredDate ? "⚠" : undefined}
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds. (TypeScript will catch if any place still expects the old BlockShape without `pantoneRequired`.)

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat: display pantoneRequired ⚠ state in timeline chips"
```

---

### Task 7: BlockEdit — Pantone Toggle

**Files:**
- Modify: `src/components/BlockEdit.tsx`

- [ ] **Step 1: Add state for `pantoneRequired`**

In `src/components/BlockEdit.tsx`, after `const [pantoneOk, setPantoneOk] = useState(block.pantoneOk);` (line 133), add:

```typescript
  const [pantoneRequired, setPantoneRequired] = useState(block.pantoneRequired ?? false);
```

- [ ] **Step 2: Add `pantoneRequired` to `emptyPresetDraft`**

In `src/components/BlockEdit.tsx`, in the `emptyPresetDraft` function return object (after `materialInStock: false,`, line 47), add:

```typescript
    pantoneRequired: false,
```

- [ ] **Step 3: Add `pantoneRequired` to `buildPresetDraft`**

In `src/components/BlockEdit.tsx`, in `buildPresetDraft` return object (after `materialInStock,`, line 325), add:

```typescript
      pantoneRequired,
```

- [ ] **Step 4: Handle `pantoneRequired` in `applyPreset` and `clearPresetSelection`**

In `applyPreset` (after `setMaterialInStock(next.materialInStock);`, line 349), add:

```typescript
    setPantoneRequired(next.pantoneRequired);
```

In `clearPresetSelection` (after `setMaterialInStock(next.materialInStock);`, line 366), add:

```typescript
    setPantoneRequired(next.pantoneRequired);
```

- [ ] **Step 5: Add `pantoneRequired` to `buildPayload`**

In `src/components/BlockEdit.tsx`, in `buildPayload` return object (after `pantoneOk,`, line 395), add:

```typescript
      pantoneRequired,
```

- [ ] **Step 6: Replace the PANTONE UI section**

In `src/components/BlockEdit.tsx`, replace the PANTONE section (lines 756-767):

From:
```tsx
              {/* PANTONE */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Pantone</ColLabel>
                <DatePickerField value={pantoneRequiredDate} onChange={setPantoneRequiredDate} placeholder="Datum" />
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: pantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                  <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: pantoneOk ? "var(--success)" : "transparent", border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                    {pantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <input type="checkbox" checked={pantoneOk} onChange={(e) => setPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                  OK
                </label>
              </div>
```

To:
```tsx
              {/* PANTONE */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Pantone</ColLabel>
                {/* Pantone potřeba toggle */}
                <button type="button" onClick={() => {
                  const next = !pantoneRequired;
                  setPantoneRequired(next);
                  if (!next) { setPantoneRequiredDate(""); setPantoneOk(false); }
                }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneRequired ? "1px solid rgba(168,85,247,0.5)" : "1px solid var(--border)", background: pantoneRequired ? "rgba(168,85,247,0.15)" : "transparent", color: pantoneRequired ? "#a855f7" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms", marginBottom: 4, width: "100%" }}>
                  {pantoneRequired ? "⚠ POTŘEBA" : "POTŘEBA"}
                </button>
                {pantoneRequired && (
                  <>
                    <DatePickerField value={pantoneRequiredDate} onChange={setPantoneRequiredDate} placeholder="Datum" />
                    <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: pantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                      <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: pantoneOk ? "var(--success)" : "transparent", border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                        {pantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <input type="checkbox" checked={pantoneOk} onChange={(e) => setPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                      OK
                    </label>
                  </>
                )}
              </div>
```

The button style is consistent with the existing SKLAD button pattern (same structure, purple color for Pantone).

- [ ] **Step 7: Commit**

```bash
git add src/components/BlockEdit.tsx
git commit -m "feat: add pantoneRequired toggle to BlockEdit form"
```

---

### Task 8: PlannerPage — Builder State

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 1: Add `pantoneRequired` to `PlannerBlock` type**

In `src/app/_components/PlannerPage.tsx`, after `pantoneOk: boolean;` (line 76), add:

```typescript
  pantoneRequired: boolean;
```

- [ ] **Step 2: Add `pantoneRequired` to `emptyPresetDraft` return**

In `src/app/_components/PlannerPage.tsx`, in the `emptyPresetDraft` return (after `materialInStock: false,`, around line 119), add:

```typescript
    pantoneRequired: false,
```

- [ ] **Step 3: Add `pantoneRequired` to block mapping from API**

In `src/app/_components/PlannerPage.tsx`, where API blocks are mapped to `PlannerBlock` (after `pantoneOk: Boolean(p.pantoneOk),`, line 485), add:

```typescript
    pantoneRequired: Boolean(p.pantoneRequired),
```

- [ ] **Step 4: Add builder state variable**

After `const [bPantoneOk, setBPantoneOk] = useState(false);` (line 548), add:

```typescript
  const [bPantoneRequired, setBPantoneRequired] = useState(false);
```

- [ ] **Step 5: Add to SPLIT_SHARED_FIELDS equivalent**

In the field list at line 1330, change:

```typescript
    "pantoneRequiredDate", "pantoneOk",
```

To:

```typescript
    "pantoneRequiredDate", "pantoneOk", "pantoneRequired",
```

- [ ] **Step 6: Wire preset apply/clear in builder**

In the builder preset apply function (after `setBPantoneRequiredDate(next.pantoneRequiredDate);`, line 1780), add:

```typescript
    setBPantoneRequired(next.pantoneRequired);
```

In the builder preset clear function (after `setBPantoneRequiredDate(next.pantoneRequiredDate);`, line 1797), add:

```typescript
    setBPantoneRequired(next.pantoneRequired);
```

In the builder reset function (after `setBPantoneOk(false);`, line 1814), add:

```typescript
    setBPantoneRequired(false);
```

- [ ] **Step 7: Add to buildPresetDraft in builder**

In the builder's `buildPresetDraft` return (after `materialInStock: bMaterialInStock,`, around line 1755), add:

```typescript
      pantoneRequired: bPantoneRequired,
```

- [ ] **Step 8: Add `pantoneRequired` to all POST payloads in builder**

In the builder submit payloads (there are two — one for queue, one for direct placement), after `pantoneOk: bPantoneOk,` (lines ~1849 and ~1881), add in both places:

```typescript
      pantoneRequired: bPantoneRequired,
```

Also in the reservation-to-block mapping (after `pantoneOk: item.pantoneOk,`, line ~2074), add:

```typescript
      pantoneRequired: item.pantoneRequired ?? false,
```

- [ ] **Step 9: Replace Pantone section in builder UI**

Find the builder Pantone section (around lines 3262-3274). Replace:

```tsx
                        {/* Pantone — datepicker + OK */}
                        <div>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Pantone</label>
                          <DatePickerField value={bPantoneRequiredDate} onChange={setBPantoneRequiredDate} placeholder="Datum…" />
                          <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: bPantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                            <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: bPantoneOk ? "var(--success)" : "transparent", border: bPantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                              {bPantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                            <input type="checkbox" checked={bPantoneOk} onChange={(e) => setBPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                            OK
                          </label>
```

With:

```tsx
                        {/* Pantone — potřeba toggle + datepicker + OK */}
                        <div>
                          <label style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 5, display: "block", fontWeight: 500 }}>Pantone</label>
                          <button type="button" onClick={() => {
                            const next = !bPantoneRequired;
                            setBPantoneRequired(next);
                            if (!next) { setBPantoneRequiredDate(""); setBPantoneOk(false); }
                          }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: bPantoneRequired ? "1px solid rgba(168,85,247,0.5)" : "1px solid var(--border)", background: bPantoneRequired ? "rgba(168,85,247,0.15)" : "transparent", color: bPantoneRequired ? "#a855f7" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms", marginBottom: 4, width: "100%" }}>
                            {bPantoneRequired ? "⚠ POTŘEBA" : "POTŘEBA"}
                          </button>
                          {bPantoneRequired && (
                            <>
                              <DatePickerField value={bPantoneRequiredDate} onChange={setBPantoneRequiredDate} placeholder="Datum…" />
                              <label style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5, fontSize: 10, fontWeight: 600, color: bPantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                                <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: bPantoneOk ? "var(--success)" : "transparent", border: bPantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                                  {bPantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </div>
                                <input type="checkbox" checked={bPantoneOk} onChange={(e) => setBPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                                OK
                              </label>
                            </>
                          )}
```

- [ ] **Step 10: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat: add pantoneRequired state and UI to PlannerPage builder"
```

---

### Task 9: PlanningForm (Reservations)

**Files:**
- Modify: `src/app/rezervace/_components/PlanningForm.tsx`

- [ ] **Step 1: Add state for `pantoneRequired`**

After `const [pantoneOk, setPantoneOk] = useState<boolean>(Boolean(existing?.pantoneOk));` (line 105), add:

```typescript
  const [pantoneRequired, setPantoneRequired] = useState<boolean>(Boolean(existing?.pantoneRequired));
```

- [ ] **Step 2: Add to submit payload**

In the submit payload (after `pantoneOk,`, line 167), add:

```typescript
        pantoneRequired,
```

- [ ] **Step 3: Replace Pantone UI section**

Find the Pantone section (around lines 339-362). Replace the content inside the `{/* Pantone */}` div similarly to Task 7 — add a POTŘEBA toggle button, then conditionally show DatePickerField + OK checkbox.

Replace:
```tsx
          {/* Pantone */}
          <div>
            <label style={labelStyle}>Pantone</label>
            <DatePickerField value={pantoneRequiredDate} onChange={setPantoneRequiredDate} placeholder="Datum…" asButton />
            <label style={{
              display: "flex", alignItems: "center", gap: 4, marginTop: 6,
              fontSize: 10, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
              color: pantoneOk ? "var(--success)" : "var(--text-muted)",
            }}>
              <div style={{
                width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                background: pantoneOk ? "var(--success)" : "transparent",
                border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 120ms ease-out",
              }}
                onClick={() => setPantoneOk(!pantoneOk)}
              >
                {pantoneOk && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
```

With:
```tsx
          {/* Pantone */}
          <div>
            <label style={labelStyle}>Pantone</label>
            <button type="button" onClick={() => {
              const next = !pantoneRequired;
              setPantoneRequired(next);
              if (!next) { setPantoneRequiredDate(""); setPantoneOk(false); }
            }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneRequired ? "1px solid rgba(168,85,247,0.5)" : "1px solid var(--border)", background: pantoneRequired ? "rgba(168,85,247,0.15)" : "transparent", color: pantoneRequired ? "#a855f7" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms", marginBottom: 4, width: "100%" }}>
              {pantoneRequired ? "⚠ POTŘEBA" : "POTŘEBA"}
            </button>
            {pantoneRequired && (
              <>
                <DatePickerField value={pantoneRequiredDate} onChange={setPantoneRequiredDate} placeholder="Datum…" asButton />
                <label style={{
                  display: "flex", alignItems: "center", gap: 4, marginTop: 6,
                  fontSize: 10, fontWeight: 600, cursor: "pointer", letterSpacing: "0.04em",
                  color: pantoneOk ? "var(--success)" : "var(--text-muted)",
                }}>
                  <div style={{
                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                    background: pantoneOk ? "var(--success)" : "transparent",
                    border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 120ms ease-out",
                  }}
                    onClick={() => setPantoneOk(!pantoneOk)}
                  >
                    {pantoneOk && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
```

Make sure to close the conditional `</>` and `)}` correctly before the closing `</div>` of the Pantone section.

- [ ] **Step 4: Commit**

```bash
git add src/app/rezervace/_components/PlanningForm.tsx
git commit -m "feat: add pantoneRequired toggle to reservation PlanningForm"
```

---

### Task 10: JobPresetEditor — Pantone Toggle

**Files:**
- Modify: `src/components/job-presets/JobPresetEditor.tsx`

- [ ] **Step 1: Add state for `pantoneRequired`**

After `const [pantoneRequiredDateOffsetDays, setPantoneRequiredDateOffsetDays] = useState<number | null>(null);` (line 166), add:

```typescript
  const [pantoneRequired, setPantoneRequired] = useState<boolean | null>(null);
```

- [ ] **Step 2: Initialize from `initialValue`**

In the `useEffect` for initialization (after `setPantoneRequiredDateOffsetDays(initialValue.pantoneRequiredDateOffsetDays ?? null);`, line 185), add:

```typescript
    setPantoneRequired(initialValue.pantoneRequired ?? null);
```

- [ ] **Step 3: Add to `draftSummary` memo**

In the object passed to `summarizeJobPreset` (after `pantoneRequiredDateOffsetDays,`, line 240), add:

```typescript
    pantoneRequired,
```

Add `pantoneRequired` to the dependency array of the `useMemo` (around line 264).

- [ ] **Step 4: Add to `handleSave` payload**

In the `payload` object (after `pantoneRequiredDateOffsetDays,`, line 288), add:

```typescript
      pantoneRequired,
```

- [ ] **Step 5: Replace Pantone section in editor UI**

In the editor UI (around line 443-444), replace:

```tsx
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <OffsetField value={pantoneRequiredDateOffsetDays} onChange={setPantoneRequiredDateOffsetDays} label="PANTONE datum" />
```

With:

```tsx
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                    <Switch checked={pantoneRequired === true} onCheckedChange={(checked) => setPantoneRequired(checked ? true : null)} />
                    Pantone potřeba
                  </label>
                  <OffsetField value={pantoneRequiredDateOffsetDays} onChange={setPantoneRequiredDateOffsetDays} label="PANTONE datum" />
```

- [ ] **Step 6: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/job-presets/JobPresetEditor.tsx
git commit -m "feat: add pantoneRequired toggle to JobPresetEditor"
```

---

### Task 11: Run Tests + Final Build

- [ ] **Step 1: Run all existing tests**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: All 24 tests pass (no regressions).

- [ ] **Step 2: Run full build**

```bash
npm run build
```

Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: Only pre-existing warnings, no new errors.

- [ ] **Step 4: Start dev server and verify in browser**

```bash
npm run dev
```

Manual checks:
1. Open a ZAKAZKA block in edit mode → see "POTŘEBA" button in Pantone column
2. Click POTŘEBA → turns purple ⚠, date picker + OK checkbox appear
3. Save → chip `P ⚠` visible on timeline in purple/warning style
4. Add date → chip changes to `P 25.4.`
5. Mark OK → chip shows `P OK` in green
6. Uncheck POTŘEBA → date and OK cleared, chip disappears
7. Open Job Builder → create/edit preset → see "Pantone potřeba" switch
8. Apply preset with pantoneRequired=true → POTŘEBA activates automatically
9. Open reservation PlanningForm → same POTŘEBA toggle works

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address any issues found during manual testing"
```
