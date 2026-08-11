# Pantone — parita s materiálem (SKLADEM + VYDÁNO) — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pantone dostane tytéž stavy jako materiál — **SKLADEM** (`pantoneInStock`) a **VYDÁNO** (`pantoneIssued`) — na všech místech, kde je má materiál.

**Architecture:** Dva aditivní boolean sloupce na `Block` (+ jeden nullable na `JobPreset`) s výchozím `false`, takže po nasazení se nezmění chování jediné existující zakázky. Veškerá logika je **větev vedle existujícího materiálového vzoru** — žádná nová komponenta, žádný nový soubor kromě migrace. Nový sloupec `Block` se ale v tomhle repu musí zaregistrovat do **třinácti sdílených seznamů**; devět z nich nehlídá žádný test, proto má každý vlastní task s vlastním ověřením.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Tailwind CSS v4 · Prisma 5 · MySQL · testy `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-08-11-pantone-parita-s-materialem-design.md`

## Global Constraints

- **Odpovědi a všechny uživatelské texty česky.** Popisky: `SKLAD` / `VYDÁNO` na tlačítkách, `Skladem ✓` / `Vydáno ➜` na plaketách a v kalendáři, `SKLAD` / `VYD.` na čipu karty.
- **Názvy sloupců jsou závazné:** `pantoneInStock`, `pantoneIssued` na `Block`; `pantoneInStock` na `JobPreset`. Žádné jiné varianty.
- **NIKDY nespouštět `npx prisma db pull` ani `npx prisma format`** — přejmenují relační pole `Reservation.blocks` / `Reservation.attachments` / `ReservationAttachment.reservation` a rozbijí kód (viz CLAUDE.md, „Prisma — konvence relací"). Zarovnání sloupců ve `schema.prisma` dělej ručně.
- **NIKDY nespouštět `npx prisma migrate dev`** — shadow-replay v tomhle repu padá na historické migraci `20260326204352_add_split_group_id` (P3006). Migrace se píše **ručně** a nasazuje `npx prisma migrate deploy`.
- **NIKDY nespouštět `npm run prisma:seed`** — je destruktivní, maže data.
- Barvy a rozměry **vždy přes CSS tokeny** z `src/app/globals.css`, nikdy hex literál v komponentě. Výjimka: řádky, které kopírují **existující** materiálový vzor, smí převzít jeho literál (`#10b981`, `#3b82f6`, `rgba(16,185,129,0.15)`), aby nová větev vypadala identicky jako sousední; nezavádět literály nové.
- **Chyby v API routes → `AppError`** (`src/lib/errors.ts`), logování → `logger`, nikdy `console.*` v API routes.
- Celá test suite (očekávaný stav před začátkem: **956 zelených**):
  ```bash
  node --experimental-test-module-mocks --test --import tsx \
    src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
  Glob **nejde do podsložek** — každá složka s testy musí být uvedená zvlášť, jinak tiše nepoběží.
- `npm run build` musí projít před každým commitem, který sahá na `.tsx`.
- Commit message psát **výhradně přes heredoc s uvozeným oddělovačem** (`git commit -F - <<'EOF'`) — poučení P8, zpětné apostrofy v `-m` shell vyhodnotí a slovo z hlášky zmizí.
- Pracuje se na větvi `Vojta`.

---

## Struktura souborů

Žádný soubor nevzniká kromě migrace. Přehled odpovědností:

| Soubor | Odpovědnost | Task |
| --- | --- | --- |
| `prisma/migrations/20260811120000_add_pantone_in_stock_issued/migration.sql` | **nový** — tři sloupce | 1 |
| `prisma/schema.prisma` | zdroj pravdy schématu | 1 |
| `src/lib/revision/blockColumns.ts` | seznam Boolean sloupců pro revize | 1 |
| `src/lib/auditFormatters.ts` | české popisky a hodnoty v historii | 1 |
| `src/lib/auditedFields.ts` | co se zapisuje do `AuditLog` | 2 |
| `src/lib/splitSharedFields.ts` | co se propaguje na split sourozence | 2 |
| `src/lib/seriesPropagation.ts` | co se NEpropaguje na sérii | 2 |
| `src/lib/undo/restoreFields.ts` | allowlist sloupců pro undo | 2 |
| `src/lib/blockPayload.ts` | Block → POST payload (copy/paste) | 2 |
| `src/app/_components/PlannerPage.tsx` | `EDIT_TRACKED_FIELDS` pro undo editace | 2 |
| `src/app/_components/TimelineGrid.tsx` | typ `Block` + `InlineDatePicker` | 3, 4 |
| `src/app/api/blocks/route.ts` | POST — zakládání bloku | 3 |
| `src/app/api/blocks/[id]/route.ts` | PUT — MTZ allowlist + side-effekty | 3 |
| `src/app/api/blocks/[id]/split/route.ts` | kopie polí do druhé půlky splitu | 3 |
| `src/components/planner/BlockCard.tsx` | čip ve 4 výškových režimech | 5 |
| `src/components/BlockEdit.tsx` | modal editace | 6 |
| `src/components/BlockDetail.tsx` | read-only detail | 7 |
| `src/lib/monitorChips.ts` | chip PANTONE na Monitoru u stroje | 7 |
| `src/hooks/useJobBuilder.ts` + `src/components/planner/JobBuilderPanel.tsx` | builder — jen SKLADEM | 8 |
| `src/app/rezervace/_components/PlanningForm.tsx` | rezervace — jen SKLADEM | 8 |
| `src/lib/jobPresets.ts` + `src/components/job-presets/JobPresetEditor.tsx` + `src/app/api/job-presets/*` | presety — jen SKLADEM | 9 |

---

## Task 1: Schéma, migrace a revizní registry

Sloupce vzniknou a zaregistrují se do dvou seznamů, které hlídají **strážné testy čtoucí `schema.prisma`**. Ty testy dělají práci „napiš failující test" za nás — po přidání sloupců zčervenají samy.

**Files:**
- Create: `prisma/migrations/20260811120000_add_pantone_in_stock_issued/migration.sql`
- Modify: `prisma/schema.prisma` (model `Block` kolem řádku 132, model `JobPreset` kolem řádku 228)
- Modify: `src/lib/revision/blockColumns.ts:10-14`
- Modify: `src/lib/auditFormatters.ts` (`FIELD_LABELS` kolem řádku 27, `fmtAuditVal` kolem řádku 65)
- Test: `src/lib/auditFormatters.test.ts:32-34` (ruční seznam `knownBooleanSplitFields`)

**Interfaces:**
- Consumes: nic (první task).
- Produces: sloupce `Block.pantoneInStock`, `Block.pantoneIssued` (oba `Boolean @default(false)`, tedy v TS `boolean`, nikdy `null`) a `JobPreset.pantoneInStock` (`Boolean?`, tedy `boolean | null`). Popisky v `FIELD_LABELS`: `"Pantone skladem"`, `"Pantone vydán"`.

- [ ] **Step 1: Přidat sloupce do `prisma/schema.prisma`**

V modelu `Block` hned za `pantoneRequiredDate` (dnes řádek 132). Zarovnání typů drž podle okolních řádků — **neformátovat přes `prisma format`**:

```prisma
  pantoneRequiredDate                         DateTime?
  pantoneInStock                              Boolean      @default(false)
  pantoneIssued                               Boolean      @default(false)
```

V modelu `JobPreset` hned za `pantoneRequiredDateOffsetDays` (dnes řádek 229):

```prisma
  pantoneRequiredDateOffsetDays  Int?
  pantoneInStock                 Boolean?
```

- [ ] **Step 2: Spustit strážné testy a ověřit, že PADNOU**

```bash
node --test --import tsx src/lib/revisionFormat.test.ts src/lib/revision/blockColumns.test.ts
```

Očekávaný výstup: FAIL v testu `každý sloupec Block je buď větou, nebo popiskem, nebo vědomě přeskočený` s hláškou
`Sloupec Block bez rozhodnutí: pantoneInStock, pantoneIssued`.

Tohle je náš failující test — dokazuje, že strážná síť skutečně funguje a že sloupce nezůstanou neregistrované.

- [ ] **Step 3: Napsat migraci**

Vytvoř složku a soubor `prisma/migrations/20260811120000_add_pantone_in_stock_issued/migration.sql`:

```sql
-- AlterTable
ALTER TABLE `Block` ADD COLUMN `pantoneInStock` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Block` ADD COLUMN `pantoneIssued` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `JobPreset` ADD COLUMN `pantoneInStock` BOOLEAN NULL;
```

(Vzor: `prisma/migrations/20260523135302_add_block_material_issued/migration.sql`.)

- [ ] **Step 4: Nasadit migraci na dev DB a vygenerovat klienta**

```bash
npx prisma migrate deploy
npx prisma generate
```

Očekávaný výstup: `1 migration found` … `Applied migration(s)`. **Ne** `migrate dev` — ta v tomhle repu padá.

- [ ] **Step 5: Zaregistrovat do `BLOCK_BOOLEAN_COLUMNS`**

`src/lib/revision/blockColumns.ts` — nahraď pole:

```typescript
export const BLOCK_BOOLEAN_COLUMNS = [
  "locked", "dataOk", "materialOk", "obalka", "vnitrky",
  "materialInStock", "materialIssued", "pantoneRequired", "pantoneOk",
  "pantoneInStock", "pantoneIssued",
  "scheduleBypassed",
] as const;
```

- [ ] **Step 6: Doplnit české popisky do `FIELD_LABELS`**

`src/lib/auditFormatters.ts` — za řádek `pantoneRequired: "Pantone potřeba",`:

```typescript
  pantoneRequired: "Pantone potřeba",
  pantoneInStock: "Pantone skladem",
  pantoneIssued: "Pantone vydán",
```

- [ ] **Step 7: Doplnit formátování hodnoty ve `fmtAuditVal`**

`src/lib/auditFormatters.ts`, dnes řádek 65 — bez tohohle by historie ukázala syrové `true`/`false`:

```typescript
  if (field === "materialInStock" || field === "materialIssued"
   || field === "pantoneInStock" || field === "pantoneIssued") return val === "true" ? "✓ Ano" : "✗ Ne";
```

> **Ruční seznam `knownBooleanSplitFields` v `auditFormatters.test.ts` se v tomhle tasku NEMĚNÍ.**
> Ten test u každé položky ověřuje i členství v `SPLIT_SHARED_FIELDS`, které se doplňuje až
> v Tasku 2. Kdyby se seznam rozšířil už tady, test by padl na chybějícím členství. Rozšiřuje
> se proto až v **Tasku 2, Step 4**, společně se `SPLIT_SHARED_FIELDS`.

- [ ] **Step 8: Spustit strážné testy a ověřit, že PROJDOU**

```bash
node --test --import tsx src/lib/revisionFormat.test.ts src/lib/revision/blockColumns.test.ts src/lib/auditFormatters.test.ts
```

Očekávaný výstup: vše PASS. Sloupec `pantoneInStock`/`pantoneIssued` je nově „popsaný" přes `FIELD_LABELS`, takže test `každý sloupec Block je buď větou, nebo popiskem` je spokojený.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260811120000_add_pantone_in_stock_issued src/lib/revision/blockColumns.ts src/lib/auditFormatters.ts
git commit -F - <<'EOF'
feat(pantone): sloupce pantoneInStock a pantoneIssued + revizní registry

Aditivní migrace se třemi sloupci (Block ×2, JobPreset ×1), výchozí false
= dnešní chování. Zaregistrováno do BLOCK_BOOLEAN_COLUMNS (jinak by revize
ukládala 0/1 místo false/true) a do FIELD_LABELS + fmtAuditVal (jinak by
historie ukazovala syrové true/false).

Migrace psaná ručně — prisma migrate dev v tomhle repu padá na shadow-replay
historické migrace 20260326204352 (P3006).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 2: Sdílené datové seznamy (undo, split, série, copy/paste, audit)

Šest seznamů, které **nehlídá žádný schema-test**. Zapomenutí kteréhokoli z nich znamená tichou ztrátu dat — přesně to se v projektu už dvakrát stalo (copy/paste ztrácel Pantone, split sourozenci se rozešli).

**Files:**
- Modify: `src/lib/auditedFields.ts:15-28`
- Modify: `src/lib/splitSharedFields.ts:32`
- Modify: `src/lib/seriesPropagation.ts:16-31`
- Modify: `src/lib/undo/restoreFields.ts:18-39`
- Modify: `src/lib/blockPayload.ts` (typ kolem řádku 57, seznam kolem řádku 111, mapa kolem řádku 151)
- Modify: `src/app/_components/PlannerPage.tsx:64-70`
- Test: `src/lib/undo/restoreFields.test.ts:85-86` a `:103` (tripwire počtu), `src/lib/auditFormatters.test.ts:32-34`

**Interfaces:**
- Consumes: sloupce `Block.pantoneInStock` / `Block.pantoneIssued` z Tasku 1.
- Produces: obě pole jsou nově v `UNDO_RESTORABLE_FIELDS` (délka **45**, dřív 43), v `SPLIT_SHARED_FIELDS`, v `AUDITED_FIELDS`, v `SERIES_EXCLUDED_FIELDS` a v payloadu `blockToCreatePayload` (klíče `pantoneInStock`, `pantoneIssued`, oba `boolean`, fallback `?? false`).

- [ ] **Step 1: Upravit tripwire počtu v `restoreFields.test.ts` na 45 a ověřit, že test PADNE**

`src/lib/undo/restoreFields.test.ts`, řádek 85-86:

```typescript
test("allowlist má přesně 45 položek (tripwire — nové pole Blocku se přidává vědomě)", () => {
  assert.equal(UNDO_RESTORABLE_FIELDS.length, 45);
```

A na řádku 103 popisek téhož tripwiru:

```typescript
test("field-inventory: blockToRestoreFields vrátí všech 45 povolených polí (tripwire)", () => {
```

Spusť:

```bash
node --test --import tsx src/lib/undo/restoreFields.test.ts
```

Očekávaný výstup: FAIL — `Expected values to be strictly equal: 43 !== 45`. To je náš failující test.

- [ ] **Step 2: Doplnit `UNDO_RESTORABLE_FIELDS`**

`src/lib/undo/restoreFields.ts`, sekce PANTONE (řádek 30-31):

```typescript
  // PANTONE
  "pantoneRequired", "pantoneOk", "pantoneRequiredDate", "pantoneInStock", "pantoneIssued",
```

A v JSDoc nad konstantou uprav větu o počtu, pokud tam číslo je — hlavička dnes mluví o „8 vědomě vynechaných", ta se nemění.

- [ ] **Step 3: Spustit test a ověřit, že PROJDE**

```bash
node --test --import tsx src/lib/undo/restoreFields.test.ts
```

Očekávaný výstup: PASS.

- [ ] **Step 4: Doplnit `SPLIT_SHARED_FIELDS` a ruční seznam v `auditFormatters.test.ts`**

`src/lib/splitSharedFields.ts`, řádek 32:

```typescript
  "pantoneRequiredDate", "pantoneOk", "pantoneRequired", "pantoneInStock", "pantoneIssued",
```

`src/lib/auditFormatters.test.ts`, řádek 32-34 (ruční seznam, schéma ho neodvozuje):

```typescript
  const knownBooleanSplitFields = [
    "dataOk", "materialOk", "materialInStock", "materialIssued", "pantoneOk", "pantoneRequired",
    "pantoneInStock", "pantoneIssued",
  ];
```

- [ ] **Step 5: Doplnit `AUDITED_FIELDS`**

`src/lib/auditedFields.ts`, řádek 18 — bez toho by se přepnutí SKLADEM/VYDÁNO **neobjevilo v historii bloku** (táž díra, kvůli které nešly rekonstruovat havárie plánu 5.–6. 8. 2026):

```typescript
  "pantoneRequiredDate", "pantoneOk", "pantoneRequired", "pantoneInStock", "pantoneIssued",
  "materialInStock", "materialIssued",
```

- [ ] **Step 6: Doplnit `SERIES_EXCLUDED_FIELDS`**

`src/lib/seriesPropagation.ts` — jde o **per-tisk stav**, takže patří mezi VYLOUČENÁ pole (uložení „celé série" je nesmí přepsat), přesně jako `materialInStock`/`materialIssued`:

```typescript
  "materialIssued",
  "materialInStock",
  "pantoneRequired",
  "pantoneInStock",
  "pantoneIssued",
```

A do JSDoc hlavičky doplň k existujícímu odstavci větu:

```
 * pantoneInStock/pantoneIssued: per-tisk stavy pantonu, navíc serverový
 *                                 side-effect vynuluje pantoneRequiredDate.
```

- [ ] **Step 7: Doplnit `blockPayload.ts` na třech místech**

Typ `BlockPayloadSource` (kolem řádku 57):

```typescript
  materialInStock?: boolean | null;
  materialIssued?: boolean | null;
  pantoneInStock?: boolean | null;
  pantoneIssued?: boolean | null;
```

Seznam klíčů (kolem řádku 112):

```typescript
  "materialInStock",
  "materialIssued",
  "pantoneInStock",
  "pantoneIssued",
```

Mapa v `blockToCreatePayload` (kolem řádku 153):

```typescript
    materialInStock: block.materialInStock ?? false,
    materialIssued: block.materialIssued ?? false,
    pantoneInStock: block.pantoneInStock ?? false,
    pantoneIssued: block.pantoneIssued ?? false,
```

- [ ] **Step 8: Napsat test na copy/paste payload**

Do `src/lib/blockPayload.test.ts` přidej:

```typescript
test("blockToCreatePayload nese pantoneInStock i pantoneIssued (copy/paste je nesmí ztratit)", () => {
  const payload = blockToCreatePayload({
    orderNumber: "25-9001",
    machine: "XL_106",
    startTime: "2026-08-11T06:00:00.000Z",
    endTime: "2026-08-11T09:00:00.000Z",
    type: "ZAKAZKA",
    pantoneRequired: true,
    pantoneInStock: true,
    pantoneIssued: false,
  } as never);
  assert.equal(payload.pantoneInStock, true);
  assert.equal(payload.pantoneIssued, false);
});
```

Než ho spustíš, dočasně **zakomentuj** řádek `pantoneInStock: block.pantoneInStock ?? false,` v `blockPayload.ts`, spusť test a ověř, že PADNE (`undefined !== true`). Pak řádek vrať. Bez tohohle ověření hlídá test vzduch (poučení P11).

- [ ] **Step 9: Doplnit `EDIT_TRACKED_FIELDS` v PlannerPage**

`src/app/_components/PlannerPage.tsx`, řádek 67-68:

```typescript
  "materialRequiredDate","materialOk","materialNote","materialInStock","materialIssued","pantoneRequired",
  "pantoneRequiredDate","pantoneOk","pantoneInStock","pantoneIssued","barvyStatusId","barvyStatusLabel","lakStatusId","lakStatusLabel",
```

- [ ] **Step 10: Spustit celou test suite**

```bash
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávaný výstup: vše PASS, celkem **957** testů (956 + jeden nový z Step 8).

- [ ] **Step 11: Commit**

```bash
git add src/lib/auditedFields.ts src/lib/splitSharedFields.ts src/lib/seriesPropagation.ts src/lib/undo/restoreFields.ts src/lib/undo/restoreFields.test.ts src/lib/blockPayload.ts src/lib/blockPayload.test.ts src/lib/auditFormatters.test.ts src/app/_components/PlannerPage.tsx
git commit -F - <<'EOF'
feat(pantone): zaregistrovat nová pole do šesti sdílených seznamů

undo (UNDO_RESTORABLE_FIELDS 43 -> 45), split (SPLIT_SHARED_FIELDS),
audit (AUDITED_FIELDS), série (SERIES_EXCLUDED_FIELDS jako per-tisk stav),
copy/paste (blockPayload) a EDIT_TRACKED_FIELDS pro undo editace.

Žádný z těch seznamů nehlídá schema-test — zapomenutí kteréhokoli znamená
tichou ztrátu dat. Přesně to se v projektu už dvakrát stalo: copy/paste
ztrácel Pantone (audit 7/2026) a split sourozenci se rozešli (go/no-go 5. 8.).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 3: Server — POST, PUT side-effekty, MTZ allowlist, split

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:88-91` (typ `Block`)
- Modify: `src/app/api/blocks/route.ts:297-302` (POST)
- Modify: `src/app/api/blocks/[id]/route.ts:81-93` (MTZ allowlist) a `:411-425` (side-effekty)
- Modify: `src/app/api/blocks/[id]/split/route.ts:148-152`

**Interfaces:**
- Consumes: seznamy z Tasku 2, sloupce z Tasku 1.
- Produces: typ `Block` v `TimelineGrid.tsx` nově obsahuje `pantoneInStock: boolean` a `pantoneIssued: boolean` (nikdy `null`). Ten typ importují `monitorChips.ts`, `BlockCard.tsx` i testy — od tohoto tasku na něj smí sahat každý další.

- [ ] **Step 1: Rozšířit typ `Block`**

`src/app/_components/TimelineGrid.tsx`, sekce PANTONE (řádky 88-91):

```typescript
  // Výrobní sloupečky — PANTONE
  pantoneRequiredDate: string | null;
  pantoneOk: boolean;
  pantoneRequired: boolean;
  pantoneInStock: boolean;
  pantoneIssued: boolean;
```

- [ ] **Step 2: Doplnit POST route**

`src/app/api/blocks/route.ts`, kolem řádku 300:

```typescript
          pantoneRequiredDate: parseNullableCivilDateForDb(body.pantoneRequiredDate),
          pantoneOk: body.pantoneOk ?? false,
          pantoneRequired: body.pantoneRequired ?? false,
          pantoneInStock: body.pantoneInStock ?? false,
          pantoneIssued: body.pantoneIssued ?? false,
          materialInStock: body.materialInStock ?? false,
          materialIssued: body.materialIssued ?? false,
```

- [ ] **Step 3: Rozšířit MTZ allowlist**

`src/app/api/blocks/[id]/route.ts`, řádky 81-93. **Bez tohohle kroku nákup tlačítko uvidí, ale nic neuloží** — role MTZ dostane 403 na nepovolená pole, resp. se tiše zahodí:

```typescript
    } else if (session.role === "MTZ") {
      allowed = {
        materialStatusId: body.materialStatusId,
        materialStatusLabel: body.materialStatusLabel,
        materialRequiredDate: body.materialRequiredDate,
        materialOk: body.materialOk,
        materialNote: body.materialNote,
        pantoneRequiredDate: body.pantoneRequiredDate,
        pantoneOk: body.pantoneOk,
        pantoneRequired: body.pantoneRequired,
        pantoneInStock: body.pantoneInStock,
        pantoneIssued: body.pantoneIssued,
        materialInStock: body.materialInStock,
        materialIssued: body.materialIssued,
      };
```

- [ ] **Step 4: Doplnit serverové side-effekty**

`src/app/api/blocks/[id]/route.ts`, kolem řádků 411-425. Pořadí rozprostření (`...`) je významné — pozdější klíč přepíše dřívější, proto nulovací větve stojí **za** větví, která pole nastavuje:

```typescript
          ...(allowed.pantoneRequiredDate !== undefined && {
            pantoneRequiredDate: parseNullableCivilDateForDb(allowed.pantoneRequiredDate),
          }),
          ...(allowed.pantoneOk !== undefined && { pantoneOk: allowed.pantoneOk as boolean }),
          ...(allowed.pantoneRequired !== undefined && { pantoneRequired: allowed.pantoneRequired as boolean }),
          // PANTONE IN STOCK / ISSUED — zrcadlo materiálu: příznak nuluje termín
          // a zapíná pantoneRequired, jinak by stav zůstal na kartě neviditelný
          // (čip se řídí právě tím příznakem).
          ...(allowed.pantoneInStock !== undefined && { pantoneInStock: allowed.pantoneInStock as boolean }),
          ...(allowed.pantoneInStock === true && { pantoneRequiredDate: null, pantoneRequired: true }),
          ...(allowed.pantoneIssued !== undefined && { pantoneIssued: allowed.pantoneIssued as boolean }),
          ...(allowed.pantoneIssued === true && { pantoneRequiredDate: null, pantoneRequired: true }),
          // „Pantone není potřeba" musí uklidit VŠECHNO, jinak by po vypnutí
          // zůstal viset zapnutý SKLADEM/VYDÁNO bez viditelného čipu.
          ...(allowed.pantoneRequired === false && {
            pantoneRequiredDate: null,
            pantoneOk: false,
            pantoneInStock: false,
            pantoneIssued: false,
          }),
```

**Pozor na pořadí:** větev `pantoneRequired === false` musí stát **až za** větvemi `pantoneInStock === true` / `pantoneIssued === true`. Kdyby stála před nimi, dal by se poslat request `{ pantoneRequired: false, pantoneInStock: true }`, který by skončil ve stavu „skladem, ale není potřeba" — tedy uložený, ale neviditelný.

- [ ] **Step 5: Doplnit kopii do split route**

`src/app/api/blocks/[id]/split/route.ts`, kolem řádku 152:

```typescript
          pantoneRequiredDate: block.pantoneRequiredDate,
          pantoneOk: block.pantoneOk,
          pantoneRequired: block.pantoneRequired,
          pantoneInStock: block.pantoneInStock,
          pantoneIssued: block.pantoneIssued,
```

- [ ] **Step 6: Build a testy**

```bash
npm run build
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávaný výstup: build bez TS chyb, testy PASS. Pokud build hlásí chybějící `pantoneInStock` ve fixturách testů (typ `Block` je nově povinný), doplň do nich `pantoneInStock: false, pantoneIssued: false` — typicky `src/lib/monitorChips.test.ts` funkce `mk()`.

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/api/blocks/route.ts "src/app/api/blocks/[id]/route.ts" "src/app/api/blocks/[id]/split/route.ts" src/lib/monitorChips.test.ts
git commit -F - <<'EOF'
feat(pantone): server — POST, PUT side-effekty, MTZ allowlist, split

Side-effekty zrcadlí materiál: zapnutí SKLADEM/VYDÁNO vynuluje termín
a zapne pantoneRequired (jinak by stav zůstal na kartě neviditelný,
protože viditelnost čipu se řídí právě tím příznakem). Vypnutí POTŘEBA
uklidí všechno včetně obou nových polí.

Pořadí rozprostření je významné: nulovací větev pantoneRequired === false
stojí ZA větvemi pantoneInStock/pantoneIssued === true, jinak by request
{ pantoneRequired: false, pantoneInStock: true } uložil neviditelný stav.

MTZ allowlist je kritický — bez něj by nákup tlačítko vidělo, ale neuložilo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 4: Vyskakovací kalendář — tlačítka Skladem / Vydáno pro pantone

Tohle je díra, na kterou nákup narazil. `InlineDatePicker` tlačítka umí, jen je dostane výhradně materiál.

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:2296-2359` (napojení `InlineDatePicker`)

**Interfaces:**
- Consumes: typ `Block` s novými poli (Task 3), PUT side-effekty (Task 3).
- Produces: nic pro další tasky — je to koncový UI zásah.

- [ ] **Step 1: Zavést mapu polí podle typu čipu**

`src/app/_components/TimelineGrid.tsx`, těsně **před** `<InlineDatePicker` (kolem řádku 2295). Mapa nahrazuje čtyři natvrdo psané podmínky `inlinePicker.field === "material"` a drží obě větve v jednom místě:

```tsx
      {/* Inline datepicker pro double-click na DATA/MAT/PANTONE badge */}
      {inlinePicker && (() => {
        // Které sloupce nese „Skladem"/„Vydáno" pro právě otevřený čip.
        // DATA nemá ani jedno → null → tlačítka se nevykreslí (InlineDatePicker
        // je schová, když nedostane callback).
        const flagFields =
          inlinePicker.field === "material" ? { inStock: "materialInStock", issued: "materialIssued" } as const
          : inlinePicker.field === "pantone" ? { inStock: "pantoneInStock", issued: "pantoneIssued" } as const
          : null;
        const pickedBlock = blocks.find((b) => b.id === inlinePicker.blockId);
        return (
```

- [ ] **Step 2: Přepsat `onPick` tak, aby nulovala příznaky i pro pantone**

Uvnitř `onPick` nahraď dnešní řádek s `JSON.stringify(f === "material" ? … : …)`:

```tsx
          onPick={async (dateStr) => {
            setInlinePicker(null);
            const block = blocks.find((b) => b.id === inlinePicker.blockId);
            if (!block) return;
            const f = inlinePicker.field;
            const field = f === "material" ? "materialRequiredDate" : f === "pantone" ? "pantoneRequiredDate" : "dataRequiredDate";
            // Nastavení termínu vypíná „skladem"/„vydáno" — nemá smysl mít oboje.
            const body: Record<string, unknown> = { [field]: dateStr };
            if (flagFields) { body[flagFields.inStock] = false; body[flagFields.issued] = false; }
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline date pick failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit datum.");
            }
          }}
```

- [ ] **Step 3: Přepsat aktivní stavy a oba callbacky přes mapu**

Nahraď dnešní čtyři bloky (`sklademActive`, `vydanoActive`, `onPickSkladem`, `onPickVydano`):

```tsx
          sklademActive={!!flagFields && !!pickedBlock?.[flagFields.inStock]}
          vydanoActive={!!flagFields && !!pickedBlock?.[flagFields.issued]}
          onPickSkladem={flagFields ? async () => {
            const current = blocks.find((b) => b.id === inlinePicker.blockId);
            const nextValue = !current?.[flagFields.inStock];
            setInlinePicker(null);
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [flagFields.inStock]: nextValue }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline skladem failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit.");
            }
          } : undefined}
          onPickVydano={flagFields ? async () => {
            const current = blocks.find((b) => b.id === inlinePicker.blockId);
            const nextValue = !current?.[flagFields.issued];
            setInlinePicker(null);
            try {
              const res = await fetch(`/api/blocks/${inlinePicker.blockId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ [flagFields.issued]: nextValue }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const updated = await res.json();
              callbacksRef.current.onBlockUpdate(updated, true);
            } catch (err) {
              console.error("Inline vydáno failed", err);
              callbacksRef.current.onError?.("Nepodařilo se uložit.");
            }
          } : undefined}
        />
        );
      })()}
```

Pozor na uzavření: původní `{inlinePicker && ( <InlineDatePicker … /> )}` se mění na IIFE `{inlinePicker && (() => { … return ( <InlineDatePicker … /> ); })()}` — zkontroluj, že závorky sedí.

- [ ] **Step 4: Build**

```bash
npm run build
```

Očekávaný výstup: bez TS chyb. Pokud TS hlásí, že indexování `pickedBlock?.[flagFields.inStock]` vrací `unknown`, obal ho `!!` (už je) — typ `Block` má oba klíče jako `boolean`, takže indexace literálovým union typem projde.

- [ ] **Step 5: Ruční ověření na dev serveru**

```bash
npm run dev   # port 3001, viz paměť „Dev servery na Macu"
```

1. Otevři plán, najdi zakázku s vyplněným pantone termínem.
2. **Dvojklik** na fialový čip `P …` → musí vyjet kalendář **a pod ním dvě tlačítka** „Skladem ✓" a „Vydáno ➜".
3. Klikni „Skladem ✓" → čip se překlopí (v tuhle chvíli ještě ukazuje starý text, přebarvení řeší Task 5) a termín zmizí.
4. Dvojklik znovu → tlačítko musí být ve stavu „Zrušit skladem".
5. Dvojklik na **materiálový** čip → obě tlačítka fungují jako dřív (regresní kontrola).
6. Dvojklik na **DATA** čip → tlačítka **se nevykreslí** (`flagFields === null`).

- [ ] **Step 6: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -F - <<'EOF'
feat(pantone): tlačítka Skladem/Vydáno ve vyskakovacím kalendáři

InlineDatePicker ta tlačítka uměl odjakživa, ale dostával je výhradně
materiál — čtyři natvrdo psané podmínky field === "material". Nahrazeno
jednou mapou flagFields, takže obě větve drží pohromadě a DATA (které
žádné příznaky nemá) dostane null a tlačítka se nevykreslí.

Tohle je místo, na které narazil nákup: dvojklik na pantonový čip otevřel
tentýž kalendář jako u materiálu, jen bez tlačítek.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 5: Karta bloku — čip ve všech čtyřech výškových režimech

`BlockCard.tsx` vykresluje pantonový čip **čtyřikrát, pokaždé jiným kódem**. Místo čtyřnásobného kopírování téhož výrazu se stavová logika **vyzvedne nahoru** do těla komponenty a všechny čtyři režimy z ní jen čtou.

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` — nová hoistovaná logika kolem řádku 443; čtyři místa renderu (~821, ~936, ~1073, ~1125)

**Interfaces:**
- Consumes: typ `Block` s novými poli (Task 3).
- Produces: nic pro další tasky.

- [ ] **Step 1: Vyzvednout stavovou logiku pantonu nahoru**

`src/components/planner/BlockCard.tsx`, hned za řádek 443 (`const pantoneDeadlineState = …`):

```typescript
  const pantoneDeadlineState = deadlineState(block.pantoneRequiredDate, block.pantoneOk, now, block.startTime);
  // pantoneInStock i pantoneIssued potlačují warning logiku pantonu — zrcadlo
  // materialHandled výš. Bez toho by pantone, který máme na skladě, dál svítil
  // červeně „po termínu".
  const pantoneHandled = block.pantoneInStock || block.pantoneIssued;
  const pantoneEffectiveState = pantoneHandled ? "ok" : pantoneDeadlineState;
  // Viditelnost čipu. Server sice při zapnutí SKLADEM/VYDÁNO nastaví i
  // pantoneRequired, ale příznaky sem patří jako pojistka proti neviditelnému
  // stavu zapsanému jinou cestou (import, ruční SQL, budoucí endpoint).
  const pantoneVisible = block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk || pantoneHandled;
  // Stavový klíč do DEADLINE_BG/DEADLINE_BORDER. Pořadí kopíruje materiál:
  // vydáno (modrá) > skladem (zelená) > prázdné > OK > bez termínu > deadline.
  const pantoneStateKey = block.pantoneIssued ? "issued"
    : block.pantoneInStock ? "ok"
    : !pantoneVisible ? "empty"
    : block.pantoneOk ? "ok"
    : !block.pantoneRequiredDate ? "warning"
    : pantoneDeadlineState === "none" ? "neutral" : pantoneDeadlineState;
  /** Text čipu. `icon` je „ ✓" / „ ✕" / „ !" / „ ⚠" podle deadline stavu, viz volající. */
  const pantoneChipText = (icon: string) =>
    block.pantoneIssued ? "VYD."
    : block.pantoneInStock ? "SKLAD"
    : block.pantoneOk ? "OK"
    : block.pantoneRequiredDate ? `${fmtDateShort(block.pantoneRequiredDate)}${icon}`
    : "⚠";
```

- [ ] **Step 2: Přepsat režim MODE_COMPACT (44–47 px)**

Kolem řádku 772 **smaž** lokální `const pStateKey = …` (nahrazuje ho hoistovaný `pantoneStateKey`).
Kolem řádku 786 změň `pIcon` tak, aby četl efektivní stav:

```typescript
        const pIcon = pantoneEffectiveState === "ok" ? " ✓" : pantoneEffectiveState === "danger" ? " ✕" : pantoneEffectiveState === "warning" ? " !" : pantoneEffectiveState === "earlyStart" ? " ⚠" : "";
```

Kolem řádku 821-827 nahraď celý blok čipu:

```tsx
                {pantoneVisible && (
                  <span style={dateChip(pantoneStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate && !pantoneHandled)} title={pantoneEffectiveState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                    onClick={block.pantoneRequiredDate && !pantoneHandled ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    P&nbsp;{pantoneChipText(pIcon)}
                  </span>
                )}
```

- [ ] **Step 3: Přepsat režim MODE_TINY / MODE_MICRO_TEXT (14–43 px)**

Kolem řádku 901 (`pIcon`) a 936-944. Stejný postup: smaž lokální `pStateKey` (ř. 937), `pIcon` čti z `pantoneEffectiveState`, a čip:

```tsx
                {pantoneVisible && (
                  <span style={chipStyle(pantoneStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate && !pantoneHandled)} title={pantoneEffectiveState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                    onClick={block.pantoneRequiredDate && !pantoneHandled ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                    onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                    P&nbsp;{pantoneChipText(pIcon)}
                  </span>
                )}
```

(Původní kód tady používá `chipStyle(...)` místo `dateChip(...)` — funkce se jmenuje jinak, chování je totéž. Zkontroluj skutečný název na místě.)

- [ ] **Step 4: Přepsat režim `showDatesFull` (≥ 60 px, komponenta `DateBadge`)**

Kolem řádku 1073-1081:

```tsx
          {pantoneVisible && (
            <DateBadge
              label="PAN." dateStr={(block.pantoneOk || pantoneHandled) ? null : block.pantoneRequiredDate}
              overrideText={block.pantoneIssued ? "VYDÁNO" : block.pantoneInStock ? "SKLADEM" : block.pantoneOk ? "OK" : !block.pantoneRequiredDate ? "⚠" : undefined}
              ok={pantoneHandled || pantoneDeadlineState === "ok"}
              warn={!pantoneHandled && (pantoneDeadlineState === "warning" || (!block.pantoneRequiredDate && !block.pantoneOk && block.pantoneRequired))}
              danger={!pantoneHandled && pantoneDeadlineState === "danger"}
              earlyStart={!pantoneHandled && pantoneDeadlineState === "earlyStart"}
              accent={FIELD_ACCENT.PANTONE}
              onToggle={pantoneHandled ? () => {} : () => toggleField("pantoneOk", block.pantoneOk)}
              onDoubleClick={canEditMat ? (rect) => onInlineDatePick?.(block.id, "pantone", block.pantoneRequiredDate ?? "", rect) : undefined}
              customBg={block.pantoneIssued ? DEADLINE_BG.issued : undefined}
              customBorder={block.pantoneIssued ? DEADLINE_BORDER.issued : undefined}
            />
          )}
```

Vzor je materiálový `DateBadge` o pár řádků výš (ř. 1056-1066) — `customBg`/`customBorder` pro modrý „vydáno" stav a `onToggle={() => {}}` pro umlčení přepínání, když je stav vyřešený.

- [ ] **Step 5: Přepsat režim `showDatesCompact` (48–59 px)**

Kolem řádku 1090 smaž lokální `pSK`, kolem 1104 `pIcon` čti z `pantoneEffectiveState`, a čip na 1125-1131:

```tsx
            {pantoneVisible && (
              <span style={cs(pantoneStateKey, FIELD_ACCENT.PANTONE, !!block.pantoneRequiredDate && !pantoneHandled)} title={pantoneEffectiveState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                onClick={block.pantoneRequiredDate && !pantoneHandled ? (e) => { e.stopPropagation(); if (canEditMat && onInlineDatePick) { if (compactPanTimerRef.current) clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = setTimeout(() => { compactPanTimerRef.current = null; toggleField("pantoneOk", block.pantoneOk); }, 350); } else { toggleField("pantoneOk", block.pantoneOk); } } : undefined}
                onDoubleClick={canEditMat && onInlineDatePick ? (e) => { e.stopPropagation(); if (compactPanTimerRef.current) { clearTimeout(compactPanTimerRef.current); compactPanTimerRef.current = null; } onInlineDatePick(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}>
                P&nbsp;{pantoneChipText(pIcon)}
              </span>
            )}
```

- [ ] **Step 6: Build a lint**

```bash
npm run build
npm run lint
```

Očekávaný výstup: build bez chyb; lint smí vrátit warningy (0 chyb je OK). Pokud lint hlásí nepoužitou proměnnou `pStateKey`/`pSK`, znamená to, že některý lokální výpočet zůstal — smaž ho.

- [ ] **Step 7: Ruční ověření všech čtyř režimů**

Na dev serveru najdi zakázku s pantone a **postupně odzoomuj** timeline (slider vpravo nahoře), aby karta prošla všemi výškami:

| Výška karty | Co musí být vidět |
| --- | --- |
| ≥ 60 px | `PAN. SKLADEM` zeleně, po přepnutí `PAN. VYDÁNO` modře |
| 48–59 px | `P SKLAD` / `P VYD.` |
| 44–47 px | `P SKLAD` / `P VYD.` |
| 14–43 px | `P SKLAD` / `P VYD.` |

Dále ověř:
- Zakázka **bez pantonu** nemá čip v žádném režimu (regrese).
- Zakázka s **prošlým** pantone termínem svítí červeně; po zapnutí SKLADEM **přestane** (to dělá `pantoneHandled`).
- Materiálový čip vypadá ve všech čtyřech režimech přesně jako dřív.

- [ ] **Step 8: Commit**

```bash
git add src/components/planner/BlockCard.tsx
git commit -F - <<'EOF'
feat(pantone): čip SKLAD/VYD. ve všech čtyřech výškových režimech karty

BlockCard vykresluje pantonový čip čtyřikrát, pokaždé jiným kódem (DateBadge
>= 60 px, pak tři inline varianty pro 48-59, 44-47 a 14-43 px). Stavová logika
se proto vyzvedla nahoru do těla komponenty (pantoneHandled, pantoneVisible,
pantoneStateKey, pantoneChipText) a všechny čtyři režimy z ní jen čtou —
jinak by se čtyři kopie téhož výrazu dřív nebo později rozešly a stav by
mizel podle přiblížení timeline.

pantoneHandled umlčí varování o termínu, zrcadlo materialHandled.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 6: Modal editace bloku

**Files:**
- Modify: `src/components/BlockEdit.tsx` — stav kolem řádku 191-195, `buildPayload` kolem 623-625, reset presetu kolem 548-595, JSX sloupce Pantone kolem 1009-1029

**Interfaces:**
- Consumes: typ `Block` (Task 3), PUT side-effekty (Task 3).
- Produces: nic pro další tasky.

- [ ] **Step 1: Přidat stav**

`src/components/BlockEdit.tsx`, za řádek 195:

```typescript
  const [pantoneRequired, setPantoneRequired] = useState(block.pantoneRequired ?? false);
  const [pantoneInStock, setPantoneInStock]   = useState(block.pantoneInStock ?? false);
  const [pantoneIssued, setPantoneIssued]     = useState(block.pantoneIssued ?? false);
```

- [ ] **Step 2: Doplnit do `buildPayload`**

Kolem řádku 623-625:

```typescript
      pantoneRequired,
      pantoneRequiredDate: (pantoneInStock || pantoneIssued) ? null : (pantoneRequiredDate || null),
      pantoneOk,
      pantoneInStock,
      pantoneIssued,
```

(Vzor: `materialRequiredDate: materialInStock ? null : materialRequiredDate || null` o pár řádků výš.)

- [ ] **Step 3: Doplnit do resetu podle presetu**

Kolem řádků 548-552, 573-577 a 591-595 jsou tři místa, kde se stav přenastavuje z presetu / snapshotu. Do **snapshotu** (ř. 548) přidej `pantoneInStock`, do obou `setNext` bloků (ř. 573, 591) přidej:

```typescript
    setPantoneInStock(next.pantoneInStock);
```

`pantoneIssued` do presetu **nepatří** — preset ho nemá (stejně jako nemá `materialIssued`).

- [ ] **Step 4: Přepsat JSX sloupce Pantone**

Nahraď celý blok `{/* PANTONE */}` (ř. 1009-1029). Struktura přesně kopíruje materiálový sloupec o pár řádků výš: plaketa místo datepickeru, OK se skryje:

```tsx
              {/* PANTONE */}
              <div style={{ opacity: !canEditMat ? 0.45 : 1, pointerEvents: !canEditMat ? "none" : "auto" }}>
                <ColLabel>Pantone</ColLabel>
                {pantoneIssued ? (
                  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.3)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#3b82f6" }}>Vydáno ➜</div>
                ) : pantoneInStock ? (
                  <div style={{ height: 32, display: "flex", alignItems: "center", borderRadius: 8, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", padding: "0 10px", fontSize: 11, fontWeight: 700, color: "#10b981" }}>Skladem ✓</div>
                ) : (
                  <DatePickerField value={pantoneRequiredDate} onChange={(v) => { setPantoneRequiredDate(v); if (v) setPantoneRequired(true); }} placeholder="Datum" />
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 5 }}>
                  <button type="button" onClick={() => {
                    const next = !pantoneRequired;
                    setPantoneRequired(next);
                    if (!next) { setPantoneRequiredDate(""); setPantoneOk(false); setPantoneInStock(false); setPantoneIssued(false); }
                  }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneRequired ? "1px solid rgba(168,85,247,0.5)" : "1px solid var(--border)", background: pantoneRequired ? "rgba(168,85,247,0.15)" : "transparent", color: pantoneRequired ? "#a855f7" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    {pantoneRequired ? "⚠ POTŘEBA" : "POTŘEBA"}
                  </button>
                  {!pantoneInStock && !pantoneIssued && (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: pantoneOk ? "var(--success)" : "var(--text-muted)", cursor: "pointer", letterSpacing: "0.04em" }}>
                      <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: pantoneOk ? "var(--success)" : "transparent", border: pantoneOk ? "1.5px solid var(--success)" : "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 120ms ease-out" }}>
                        {pantoneOk && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <input type="checkbox" checked={pantoneOk} onChange={(e) => setPantoneOk(e.target.checked)} style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
                      OK
                    </label>
                  )}
                  <button type="button" onClick={() => { setPantoneInStock(!pantoneInStock); if (!pantoneInStock) { setPantoneRequiredDate(""); setPantoneOk(false); setPantoneRequired(true); } }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneInStock ? "1px solid rgba(16,185,129,0.5)" : "1px solid var(--border)", background: pantoneInStock ? "rgba(16,185,129,0.15)" : "transparent", color: pantoneInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    SKLAD
                  </button>
                  <button type="button" onClick={() => { setPantoneIssued(!pantoneIssued); if (!pantoneIssued) { setPantoneRequired(true); } }} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 5, border: pantoneIssued ? "1px solid rgba(59,130,246,0.5)" : "1px solid var(--border)", background: pantoneIssued ? "rgba(59,130,246,0.15)" : "transparent", color: pantoneIssued ? "#3b82f6" : "var(--text-muted)", cursor: "pointer", transition: "all 100ms" }}>
                    VYDÁNO
                  </button>
                </div>
              </div>
```

- [ ] **Step 5: Build**

```bash
npm run build
```

- [ ] **Step 6: Ruční ověření**

1. Otevři modal editace zakázky (dvojklik na kartu, nebo tlačítko Upravit).
2. Sloupec **Pantone** musí mít pod datepickerem tři tlačítka: `POTŘEBA` `SKLAD` `VYDÁNO` a mezi nimi `OK` — dokud není zapnuté SKLAD/VYDÁNO.
3. Klikni `SKLAD` → datepicker se změní na zelenou plaketu `Skladem ✓`, checkbox `OK` **zmizí**, `POTŘEBA` se sama zapne.
4. Klikni `VYDÁNO` → modrá plaketa `Vydáno ➜`.
5. Vypni `POTŘEBA` → všechno se vynuluje, vrátí se datepicker.
6. Ulož a znovu otevři → stav sedí.
7. Zkontroluj, že se **řádek tlačítek nezalomil** na dva řádky. Když ano, ohlas to a nepokračuj — je to signál, že sloupec je úzký a chce jiné rozvržení.
8. Sloupec **Materiál** vypadá a chová se přesně jako dřív (regrese).

- [ ] **Step 7: Commit**

```bash
git add src/components/BlockEdit.tsx
git commit -F - <<'EOF'
feat(pantone): SKLAD a VYDÁNO v modalu editace bloku

Sloupec Pantone kopíruje materiálový: při zapnutí příznaku se datepicker
nahradí plaketou (Skladem zeleně / Vydáno modře) a checkbox OK se skryje,
takže v řádku nikdy nestojí víc než tři ovládací prvky — pantone má proti
materiálu navíc přepínač POTŘEBA.

Zapnutí SKLAD/VYDÁNO zapíná i POTŘEBA (jinak by čip na kartě nenaskočil),
vypnutí POTŘEBA naopak uklidí všechno.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 7: Read-only detail a Monitor u stroje

Pravidla čipu počítají **dvě nezávislé kopie** — `BlockCard.tsx` (Task 5) a `buildMonitorChips`. Hlavička `monitorChips.ts` to výslovně přiznává. Obě musí říkat o téže zakázce totéž, proto se mění v jednom kroku.

**Files:**
- Modify: `src/components/BlockDetail.tsx:262` a `:273-280`
- Modify: `src/lib/monitorChips.ts:48-52`
- Test: `src/lib/monitorChips.test.ts`

**Interfaces:**
- Consumes: typ `Block` (Task 3).
- Produces: nic pro další tasky.

- [ ] **Step 1: Napsat failující test na Monitor**

Do `src/lib/monitorChips.test.ts` přidej (fixture `mk()` už má `pantoneInStock: false, pantoneIssued: false` z Tasku 3, Step 6):

```typescript
test("buildMonitorChips: pantone skladem je hotový stav (tón ok), ne čekání", () => {
  const chips = buildMonitorChips(mk({ pantoneRequired: true, pantoneInStock: true }));
  assert.deepEqual(chips, [{ label: "PANTONE", tone: "ok" }]);
});

test("buildMonitorChips: pantone vydaný je hotový stav (tón ok)", () => {
  const chips = buildMonitorChips(mk({ pantoneRequired: true, pantoneIssued: true }));
  assert.deepEqual(chips, [{ label: "PANTONE", tone: "ok" }]);
});

test("buildMonitorChips: pantone jen s termínem pořád čeká", () => {
  const chips = buildMonitorChips(mk({ pantoneRequired: true, pantoneRequiredDate: "2026-08-20T00:00:00.000Z" }));
  assert.deepEqual(chips, [{ label: "PANTONE", tone: "wait" }]);
});

test("buildMonitorChips: pantone skladem se zobrazí i bez pantoneRequired (pojistka proti neviditelnému stavu)", () => {
  const chips = buildMonitorChips(mk({ pantoneInStock: true }));
  assert.deepEqual(chips, [{ label: "PANTONE", tone: "ok" }]);
});
```

- [ ] **Step 2: Spustit test a ověřit, že PADNE**

```bash
node --test --import tsx src/lib/monitorChips.test.ts
```

Očekávaný výstup: FAIL — první dva testy dostanou `tone: "wait"` místo `"ok"`, čtvrtý dostane prázdné pole.

- [ ] **Step 3: Upravit `buildMonitorChips`**

`src/lib/monitorChips.ts`, řádky 48-52:

```typescript
  // Štítek se zobrazí za stejné podmínky jako v BlockCard (požadováno, má termín,
  // je odklepnuto, nebo je skladem/vydáno). Připravenost = odklepnuto NEBO skladem
  // NEBO vydáno — táž logika jako pantoneHandled v BlockCard.tsx; kdyby se rozešly,
  // Monitor a plán by o téže zakázce tvrdily dvě různé věci (nález I5).
  if (block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk || block.pantoneInStock || block.pantoneIssued) {
    const pantoneReady = block.pantoneOk || block.pantoneInStock || block.pantoneIssued;
    chips.push({ label: "PANTONE", tone: pantoneReady ? "ok" : "wait" });
  }
```

- [ ] **Step 4: Spustit test a ověřit, že PROJDE**

```bash
node --test --import tsx src/lib/monitorChips.test.ts
```

Očekávaný výstup: PASS.

- [ ] **Step 5: Doplnit read-only detail**

`src/components/BlockDetail.tsx`. Podmínka celé sekce (ř. 262) — přidej nová pole, aby sekce naskočila i u bloku, který nemá nic jiného:

```tsx
        {(block.dataStatusLabel || block.materialStatusLabel || block.barvyStatusLabel || block.lakStatusLabel || block.specifikace || block.materialInStock || block.materialIssued || block.pantoneInStock || block.pantoneIssued || block.obalka || block.vnitrky || block.tiskoveArchy || block.serie) && (
```

A za materiálový „Sklad" řádek (ř. 273-280) přidej pantonový:

```tsx
              {(block.pantoneInStock || block.pantoneIssued) && (
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] text-slate-500 w-16 flex-shrink-0">Pantone</span>
                  <span className={block.pantoneIssued ? "text-blue-400 font-semibold" : "text-green-400 font-semibold"}>
                    {block.pantoneIssued ? "Vydáno ➜" : "Skladem ✓"}
                  </span>
                </div>
              )}
```

- [ ] **Step 6: Build a celá test suite**

```bash
npm run build
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávaný výstup: build bez chyb, **961** testů PASS (957 + 4 nové).

- [ ] **Step 7: Ruční ověření Monitoru**

```bash
npx tsx prisma/seed-monitor.ts    # dev only; --clean uklidí
```

Otevři Monitor u stroje, najdi zakázku s pantone skladem → chip `PANTONE` musí být **zelený** (tón `ok`), ne čekající. Ve frontě i na velké kartě.

- [ ] **Step 8: Commit**

```bash
git add src/components/BlockDetail.tsx src/lib/monitorChips.ts src/lib/monitorChips.test.ts
git commit -F - <<'EOF'
feat(pantone): SKLADEM/VYDÁNO v detailu bloku a na Monitoru u stroje

Pravidla čipu počítají dvě nezávislé kopie — BlockCard.tsx a buildMonitorChips.
Hlavička monitorChips.ts to přiznává a nález I5 dokládá, že se to jednou už
rozešlo. Obě strany se proto mění v jednom kroku: připravenost pantonu je
odklepnuto NEBO skladem NEBO vydáno, viditelnost zahrnuje oba nové příznaky.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 8: Builder nové zakázky a rezervace — jen SKLADEM

Obě obrazovky dostanou **pouze SKLADEM**, protože materiál na nich VYDÁNO taky nemá (při zakládání zakázky „už vydáno" nedává smysl).

**Files:**
- Modify: `src/hooks/useJobBuilder.ts` — typ kolem 44-46, stav kolem 180-182, snapshot/reset 294-296 a 319-321 a 337-339, `clear` kolem 355-357, dvě payload mapy kolem 398-402 a 438-441
- Modify: `src/components/planner/JobBuilderPanel.tsx` — destrukturalizace kolem 41-43, JSX Pantone kolem 335-353
- Modify: `src/app/rezervace/_components/PlanningForm.tsx` — stav kolem 66-70, payload kolem 155-157, JSX Pantone kolem 293-325

**Interfaces:**
- Consumes: POST route s novými poli (Task 3).
- Produces: nic pro další tasky.

- [ ] **Step 1: `useJobBuilder` — typ a stav**

Do typu `ReservationQueueItem` (kolem ř. 44) přidej `pantoneInStock: boolean;`, do normalizace (kolem ř. 123) `pantoneInStock: Boolean(p.pantoneInStock),`, a k ostatním `bPantone*` stavům (kolem ř. 182):

```typescript
  const [bPantoneInStock, setBPantoneInStock]             = useState(false);
```

- [ ] **Step 2: `useJobBuilder` — snapshot, reset, clear**

- snapshot presetu (kolem ř. 296): přidej `pantoneInStock: bPantoneInStock,`
- oba `setNext` bloky (kolem ř. 321 a 339): přidej `setBPantoneInStock(next.pantoneInStock);`
- `clear` (kolem ř. 357): přidej `setBPantoneInStock(false);`
- obě payload mapy (kolem ř. 402 a 441): přidej

```typescript
        pantoneInStock: bPantoneInStock,
        pantoneIssued: false,
```

(Vzor: `materialIssued: false` na ř. 399 — builder ho posílá natvrdo `false`.)

- Do návratového objektu hooku (kolem ř. 638) přidej `bPantoneInStock, setBPantoneInStock,`.

- [ ] **Step 3: `JobBuilderPanel` — přepínač SKLADEM v hlavičce sloupce Pantone**

Destrukturalizace (kolem ř. 43) → přidej `bPantoneInStock, setBPantoneInStock,`.

JSX sloupce Pantone (kolem ř. 336-338) — přepínač jde do popiskového řádku, přesně jako u materiálu na ř. 313-319:

```tsx
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                            <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Pantone</label>
                            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: bPantoneInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer" }}>
                              <Switch checked={bPantoneInStock} onCheckedChange={(checked) => { setBPantoneInStock(checked); if (checked) { setBPantoneRequiredDate(""); setBPantoneRequired(true); } }} />
                              SKLADEM
                            </label>
                          </div>
                          <div style={{ opacity: bPantoneInStock ? 0.4 : 1, pointerEvents: bPantoneInStock ? "none" : "auto" }}>
                            <DatePickerField value={bPantoneRequiredDate} onChange={(v) => { setBPantoneRequiredDate(v); if (v) setBPantoneRequired(true); }} placeholder="Datum…" />
                          </div>
```

Zbytek sloupce (tlačítko POTŘEBA + checkbox OK) nech beze změny.

- [ ] **Step 4: `PlanningForm` — stav a payload**

Stav (kolem ř. 70):

```typescript
  const [pantoneInStock, setPantoneInStock] = useState<boolean>(Boolean(existing?.pantoneInStock));
```

Payload (kolem ř. 155-157):

```typescript
        pantoneRequiredDate: (pantoneRequired && !pantoneInStock) ? (pantoneRequiredDate || null) : null,
        pantoneOk,
        pantoneRequired,
        pantoneInStock,
        pantoneIssued: false,
```

- [ ] **Step 5: `PlanningForm` — přepínač SKLADEM**

Do sekce Pantone (kolem ř. 293-296) přidej nad `DatePickerField` tentýž toggle, jaký má materiál na ř. 255-274 — jen s pantone stavem a `#a855f7`→ zelená `#10b981` pro zapnuto:

```tsx
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <label style={labelStyle}>Pantone</label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 600,
                color: pantoneInStock ? "#10b981" : "var(--text-muted)", cursor: "pointer",
              }}>
                <span
                  onClick={() => { setPantoneInStock(!pantoneInStock); if (!pantoneInStock) { setPantoneRequiredDate(""); setPantoneRequired(true); } }}
                  style={{
                    position: "relative", width: 31, height: 18, borderRadius: 9,
                    background: pantoneInStock ? "#10b981" : "var(--surface-3)",
                    transition: "background 120ms", flexShrink: 0, display: "inline-block",
                  }}
                >
                  <span style={{
                    position: "absolute", top: 2, left: pantoneInStock ? 15 : 2, width: 14, height: 14,
                    borderRadius: "50%", background: "#fff", transition: "left 120ms",
                  }} />
                </span>
                SKLADEM
              </label>
            </div>
            <div style={{ opacity: pantoneInStock ? 0.4 : 1, pointerEvents: pantoneInStock ? "none" : "auto" }}>
              <DatePickerField value={pantoneInStock ? "" : pantoneRequiredDate} onChange={(v) => { setPantoneRequiredDate(v); if (v) setPantoneRequired(true); }} placeholder="Datum…" asButton />
            </div>
```

Zkontroluj proti skutečné podobě materiálového toggle na ř. 255-274 a přepiš přesně jeho strukturu — výše uvedený kód je z něj odvozený, ale drobnosti (názvy stylových konstant) se mohou lišit.

- [ ] **Step 6: Build**

```bash
npm run build
```

- [ ] **Step 7: Ruční ověření**

**Builder:** otevři panel nové zakázky → sloupec Pantone má vedle popisku přepínač `SKLADEM` → zapni → datepicker zešedne a zamkne se → založ zakázku → na kartě svítí `P SKLAD`.

**Rezervace:** otevři `/rezervace`, nová rezervace → totéž → ulož → překlop na zakázku → stav přežil.

Regrese: materiálový přepínač na obou obrazovkách funguje jako dřív.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useJobBuilder.ts src/components/planner/JobBuilderPanel.tsx src/app/rezervace/_components/PlanningForm.tsx
git commit -F - <<'EOF'
feat(pantone): přepínač SKLADEM v builderu a v rezervacích

Jen SKLADEM, ne VYDÁNO — materiál na těchhle dvou obrazovkách VYDÁNO taky
nemá a při zakládání zakázky „už vydáno" nedává smysl. Builder proto posílá
pantoneIssued natvrdo false, stejně jako to dělá s materialIssued.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Task 9: Presety zakázek — jen SKLADEM

**Files:**
- Modify: `src/lib/jobPresets.ts` — tři typy (kolem 25, 41, 63, 220), `applyPreset` kolem 138-150, `toUpsertInput` kolem 199, `presetFingerprint` kolem 237, `presetSummary` kolem 267
- Modify: `src/app/api/job-presets/route.ts` — typ kolem 30, normalizace 114, guard úplnosti 124, validace 133
- Modify: `src/app/api/job-presets/[id]/route.ts` — typ kolem 32, patch kolem 173, validace kolem 186
- Modify: `src/components/job-presets/JobPresetEditor.tsx` — stav kolem 148, init 169, tři payload mapy 223-226 / 246-252 / 274-277, JSX kolem 464-467
- Test: `src/lib/jobPresets.test.ts`

**Interfaces:**
- Consumes: sloupec `JobPreset.pantoneInStock` (`boolean | null`) z Tasku 1; `JobPresetDraftValues.pantoneInStock` (`boolean`) zavedený tady.
- Produces: nic pro další tasky.

- [ ] **Step 1: Napsat failující test na `applyPreset`**

Do `src/lib/jobPresets.test.ts` přidej (tvar `current`/`preset` opiš z nejbližšího existujícího testu v souboru — fixtury tam už jsou):

```typescript
test("applyPreset: pantoneInStock z presetu se aplikuje a nepřepíše vyplněný termín", () => {
  const next = applyPreset(
    { ...emptyDraft, pantoneRequiredDate: "2026-08-20" },
    { ...emptyPreset, pantoneInStock: true },
  );
  assert.equal(next.pantoneInStock, true);
  assert.equal(next.pantoneRequiredDate, "2026-08-20", "vyplněný termín se nikdy nemaže (Variant A)");
});

test("applyPreset: pantoneInStock v presetu blokuje dopočet termínu z offsetu", () => {
  const next = applyPreset(
    { ...emptyDraft, pantoneRequiredDate: "" },
    { ...emptyPreset, pantoneInStock: true, pantoneRequiredDateOffsetDays: 3 },
  );
  assert.equal(next.pantoneInStock, true);
  assert.equal(next.pantoneRequiredDate, "", "skladem znamená, že se termín nedopočítává");
});
```

Spusť a ověř FAIL:

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

- [ ] **Step 2: Doplnit typy v `jobPresets.ts`**

- `JobPreset` (kolem ř. 25): `pantoneInStock: boolean | null;`
- `JobPresetDraftValues` (kolem ř. 42): `pantoneInStock: boolean;`
- `JobPresetUpsertInput` (kolem ř. 64): `pantoneInStock: boolean | null;`
- typ v `presetSummary`/`presetFingerprint` (kolem ř. 221): `pantoneInStock?: boolean | null;`

- [ ] **Step 3: Doplnit `applyPreset`**

`src/lib/jobPresets.ts`, kolem ř. 138-150. Struktura přesně kopíruje materiálovou dvojici o pár řádků výš:

```typescript
  // pantoneRequired: aplikovat z presetu; vyplněné pantoneRequiredDate
  // se nikdy nemaže (Variant A — preserve user values)
  if (preset.pantoneRequired !== null && current.pantoneRequired !== preset.pantoneRequired) {
    next.pantoneRequired = preset.pantoneRequired;
  }

  // pantoneInStock: aplikovat z presetu
  if (preset.pantoneInStock !== null && current.pantoneInStock !== preset.pantoneInStock) {
    next.pantoneInStock = preset.pantoneInStock;
    // „skladem" znamená, že pantone je potřeba — jinak by stav zůstal neviditelný
    if (preset.pantoneInStock) next.pantoneRequired = true;
  }

  // pantoneRequiredDate fill: jen když prázdné a preset nehlásí pantoneInStock
  if (!next.pantoneInStock && preset.pantoneRequiredDateOffsetDays !== null && current.pantoneRequiredDate === "") {
    const value = resolvePresetDateOffset(preset.pantoneRequiredDateOffsetDays) ?? "";
    next.pantoneRequiredDate = value;
    // Setting a date implies pantone is required (existing behavior)
    if (value) next.pantoneRequired = true;
  }
```

- [ ] **Step 4: Spustit test a ověřit, že PROJDE**

```bash
node --test --import tsx src/lib/jobPresets.test.ts
```

- [ ] **Step 5: Doplnit `toUpsertInput`, `presetFingerprint`, `presetSummary`**

`toUpsertInput` (kolem ř. 199-200):

```typescript
    pantoneRequired: draft.pantoneRequired ? true : null,
    pantoneInStock: draft.pantoneInStock ? true : null,
    pantoneRequiredDateOffsetDays: draft.pantoneInStock ? null : dateStrToOffsetDays(draft.pantoneRequiredDate),
```

`presetFingerprint` (kolem ř. 238) — přidej `preset.pantoneInStock,` do pole hodnot.

`presetSummary` (kolem ř. 267-269):

```typescript
  if (preset.pantoneInStock === true) {
    parts.push("Pantone: skladem");
  } else if (preset.pantoneRequired === true) {
    parts.push("Pantone");
  }
```

- [ ] **Step 6: Doplnit obě API routes**

`src/app/api/job-presets/route.ts`:
- typ (kolem ř. 30): `pantoneInStock?: unknown;`
- normalizace (kolem ř. 115): `pantoneInStock: parseNullableBool(body.pantoneInStock),`
- guard úplnosti (ř. 124) — do dlouhé podmínky přidej `|| normalized.pantoneInStock === undefined`
- validace za ř. 133, vzor je materiálová o dva řádky výš:

```typescript
  if (normalized.pantoneInStock === true && normalized.pantoneRequiredDateOffsetDays !== null) {
    return NextResponse.json({ error: "Preset nemůže mít zároveň „pantone skladem" a offset termínu pantonu." }, { status: 400 });
  }
```

**Pozor (poučení P10):** české uvozovky uvnitř dvojitě uvozeného řetězce se při zápisu normalizují a ukončí literál dřív (`TS1002`). Řetězec proto napiš v **jednoduchých** uvozovkách:

```typescript
    return NextResponse.json({ error: 'Preset nemůže mít zároveň „pantone skladem“ a offset termínu pantonu.' }, { status: 400 });
```

`src/app/api/job-presets/[id]/route.ts`:
- typ (kolem ř. 32): `pantoneInStock?: unknown;`
- seznam povolených klíčů (kolem ř. 154): přidej `"pantoneInStock",`
- patch větev (za ř. 176), vzor je `materialInStock` o pár řádků výš:

```typescript
    if (body.pantoneInStock !== undefined) {
      const parsed = parseNullableBool(body.pantoneInStock);
      if (parsed === undefined) return NextResponse.json({ error: "Neplatná hodnota pro pantoneInStock." }, { status: 400 });
      patch.pantoneInStock = parsed;
    }
```

- validace (za ř. 186):

```typescript
    if (merged.pantoneInStock === true && merged.pantoneRequiredDateOffsetDays !== null) {
      return NextResponse.json({ error: 'Preset nemůže mít zároveň „pantone skladem“ a offset termínu pantonu.' }, { status: 400 });
    }
```

- [ ] **Step 7: Doplnit `JobPresetEditor`**

- stav (kolem ř. 149): `const [pantoneInStock, setPantoneInStock] = useState<boolean | null>(null);`
- init (kolem ř. 170): `setPantoneInStock(initialValue.pantoneInStock ?? null);`
- všechny tři payload mapy (kolem ř. 223-226, 246-252, 274-277): přidej `pantoneInStock,` a uprav offset na `pantoneRequiredDateOffsetDays: pantoneInStock ? null : pantoneRequiredDateOffsetDays,` (vzor: `materialRequiredDateOffsetDays: materialInStock ? null : …`)
- JSX (kolem ř. 464-467), vzor je materiálový `Switch` na ř. 457:

```tsx
                  <label className="flex items-center gap-2">
                    <Switch checked={pantoneInStock === true} onCheckedChange={(checked) => setPantoneInStock(checked ? true : null)} />
                    Pantone skladem
                  </label>
```

- [ ] **Step 8: Build a celá test suite**

```bash
npm run build
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávaný výstup: build bez chyb, **963** testů PASS (961 + 2 nové).

- [ ] **Step 9: Ruční ověření**

1. Otevři Správa → Presety zakázek, edituj preset.
2. Zapni `Pantone skladem` → ulož → souhrn presetu ukazuje `Pantone: skladem`.
3. Zkus zapnout `Pantone skladem` **a zároveň** vyplnit offset termínu pantonu → server musí vrátit 400 s českou hláškou.
4. Aplikuj preset na novou zakázku v builderu → přepínač `SKLADEM` u pantonu naskočí sám.

- [ ] **Step 10: Commit**

```bash
git add src/lib/jobPresets.ts src/lib/jobPresets.test.ts src/app/api/job-presets/route.ts "src/app/api/job-presets/[id]/route.ts" src/components/job-presets/JobPresetEditor.tsx
git commit -F - <<'EOF'
feat(pantone): „pantone skladem" v presetech zakázek

Parita s materialInStock, který presety mají odjakživa. Preset nesmí mít
zároveň „skladem" a offset termínu — validace na obou API routes, stejně
jako u materiálu. Sloupec JobPreset.pantoneInStock přišel už s migrací
v prvním commitu téhle větve.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## Závěrečné ověření (po Tasku 9, před nasazením)

Tohle **není** další task — je to hradlo. Neprovádí se po částech.

- [ ] **Celá test suite zelená**

```bash
npm run build
npm run lint
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávaný stav: build bez chyb, lint 0 chyb (warningy OK), **963** testů PASS.

- [ ] **Proklik na testovací instanci nad kopií produkce**

Devět kroků ze specu, oddíl 6.2. **Každý vede přes jiný z devíti neohlídaných registrů** — proto se žádný nesmí vynechat:

| # | Krok | Co ověřuje |
| --- | --- | --- |
| 1 | Založit zakázku v builderu s pantone SKLADEM | POST route, `useJobBuilder` |
| 2 | Otevřít modal, přepnout na VYDÁNO | PUT route, `BlockEdit`, side-effekty |
| 3 | Dvojklik na čip → jsou tam obě tlačítka? | `InlineDatePicker` |
| 4 | Zkopírovat zakázku (Ctrl+C / Ctrl+V) | `blockPayload.ts` |
| 5 | Rozdělit splitem → mají obě půlky stav? | split route, `SPLIT_SHARED_FIELDS` |
| 6 | Krok zpět → vrátil se stav? | `UNDO_RESTORABLE_FIELDS`, `EDIT_TRACKED_FIELDS` |
| 7 | Monitor u stroje | `monitorChips` vs `BlockCard` |
| 8 | Historie bloku → české věty místo `true`/`false`? | `auditFormatters`, `AUDITED_FIELDS` |
| 9 | **Přihlásit se jako MTZ a zkusit obojí přepnout** | role allowlist |

Krok 9 je kritický: bez něj by se vada „nákup tlačítko vidí, ale nic neuloží" projevila až v ostrém provozu, u toho, kdo si o funkci řekl.

- [ ] **Nasazení**

Podle `docs/DEPLOY_WORKFLOW.md`, **doslova**. Klíčové body pro tuhle větev:

1. **`mysqldump` záloha produkční DB jako první krok** — žádná výjimka.
2. PRE snapshot dat (počet bloků + `sum_secs`) jako otisk.
3. `npx prisma migrate deploy` — tahle větev **má migraci**, na rozdíl od posledních dvou nasazení.
4. `npm run prisma:bootstrap` **není potřeba** — nepřidávají se žádné číselníky.
5. POST snapshot, PRE = POST.
6. Po nasazení **tvrdý refresh prohlížeče** dřív než jakékoli ladění (poučení P13) — jinak se hledá chyba v kódu, který v prohlížeči neběží.
7. Produkce běží na portu **3020**, DB se jmenuje **`igvyroba`** malými písmeny, root přes `sudo mysql` (auth_socket).

---

## Sebekontrola plánu proti specu

| Požadavek specu | Task |
| --- | --- |
| Migrace `Block.pantoneInStock`, `Block.pantoneIssued`, `JobPreset.pantoneInStock` | 1 |
| Priorita zobrazení `VYD.` → `SKLAD` → datum → `OK` → `⚠` | 5 (`pantoneChipText`) |
| Side-effekt: InStock/Issued nuluje termín a zapíná POTŘEBA | 3 |
| Side-effekt: nastavení termínu vypíná oba příznaky | 3 (server), 4 (kalendář) |
| Side-effekt: vypnutí POTŘEBA uklidí všechno | 3, 6 |
| `pantoneHandled` umlčí varování o termínu | 5 |
| Viditelnost čipu rozšířená o oba příznaky | 5, 7 |
| Vyskakovací kalendář — obě tlačítka | 4 |
| Modal editace — SKLAD + VYDÁNO, plaketa, skrytí OK | 6 |
| Karta bloku — 4 výškové režimy | 5 |
| Read-only detail | 7 |
| Monitor u stroje | 7 |
| Builder + rezervace — jen SKLADEM | 8 |
| Presety — jen SKLADEM + validace | 9 |
| MTZ allowlist | 3 |
| 13 sdílených registrů | 1 (2×), 2 (6×), 3 (5×) |
| Dvojí zdroj pravdy čipu spárovaný | 5 + 7 (sousední tasky, `monitorChips` cituje `BlockCard`) |
| Testy z oddílu 6.1 | 2, 7, 9 |
| Proklik z oddílu 6.2 | Závěrečné ověření |
