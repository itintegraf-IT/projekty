# Plán: Pracovní doba = týdenní grid (sjednocení s Rozpisem směn)

## Context

Dnes je pracovní doba strojů řízena duálním modelem:
- **`MachineWorkHoursTemplate` + `MachineWorkHoursTemplateDay`** — šablony (1 default + N dočasných s `validFrom/validTo`) definují, které směny daný den běží
- **`MachineScheduleException`** — výjimky na konkrétní datum, které přebíjí šablonu
- **Precedence:** exception → dočasná šablona → výchozí šablona

Tento model je pro běžné plánování zbytečně složitý: pokud se v příštím týdnu ruší noční směna, uživatel musí buď založit dočasnou šablonu s validFrom/validTo, nebo zavést výjimku na každý den. UI je dvě oddělené obrazovky (editor šablon, editor výjimek) a s nově přidaným **Rozpisem směn** (per-týden grid, feat `944a4ab2`) vzniká nekonzistence: Rozpis ukazuje obsazení tiskařů per-týden, ale pracovní doba se zadává jinde a jinak.

**Cíl:** Sjednotit UX. Pracovní doba se bude zadávat stejným způsobem jako rozpis směn — per-týden grid, navigace mezi týdny, pro každý týden se zatrhne, které směny které stroje běží. Šablony + výjimky zaniknou, místo nich nová tabulka `MachineWeekShifts` keyed na `(machine, weekStart, dayOfWeek)`.

**Uživatelská rozhodnutí (AskUserQuestion):**
1. Nový týden bez záznamu = auto-kopie z předchozího týdne
2. Historie = migrovat (napočítat `MachineWeekShifts` na -52 … +52 týdnů)
3. Model = jen shift flags + fixní časy per směna (morning 6-14, afternoon 14-22, night 22-6)
4. `CompanyDay` = ponechat beze změny (tvrdá blokace, globální, s labelem)

---

## Architektura

### Datový model (`prisma/schema.prisma`)

**Nový model:**
```prisma
model MachineWeekShifts {
  id          Int      @id @default(autoincrement())
  machine     String   @db.VarChar(20)
  weekStart   DateTime @db.Date        // pondělí 00:00 UTC
  dayOfWeek   Int      // 0 = neděle, 1 = pondělí, ..., 6 = sobota (stejné jako dnes)
  isActive    Boolean  @default(true)  // den v provozu
  morningOn   Boolean  @default(false)
  afternoonOn Boolean  @default(false)
  nightOn     Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([machine, weekStart, dayOfWeek])
  @@index([machine, weekStart])
  @@index([weekStart])
}
```

**Konstanty směn (nový soubor `src/lib/shiftTimes.ts`):**
```ts
export const SHIFT_TIMES: Record<ShiftType, { startHour: number; endHour: number }> = {
  MORNING:   { startHour: 6,  endHour: 14 },
  AFTERNOON: { startHour: 14, endHour: 22 },
  NIGHT:     { startHour: 22, endHour: 30 }, // 22 → 6 druhý den (přeteče přes půlnoc)
};
```

**Odstraněné modely (až po migraci + ověření):**
- `MachineWorkHoursTemplate`
- `MachineWorkHoursTemplateDay`
- `MachineScheduleException`
- (`MachineWorkHours` zůstává pro bootstrap, viz CLAUDE.md — ponechat)

**`CompanyDay` beze změny.**

---

## Migrace dat

**Migrační skript `scripts/migrate-to-week-shifts.ts`:**

1. Pro každý stroj (XL_105, XL_106):
2. Pro každý týden v rozsahu **[dnes − 52 týdnů, dnes + 52 týdnů]** (iteruj po pondělcích):
   - Pro každý den 0–6:
     - Najdi platnou šablonu (stejná logika jako dnešní `resolveScheduleRows()` v [src/lib/scheduleValidation.ts:13-43](src/lib/scheduleValidation.ts#L13-L43))
     - Načti `MachineScheduleException` pro `(machine, date)` — pokud existuje, přepsat flags
     - Zapiš řádek `MachineWeekShifts { machine, weekStart, dayOfWeek, isActive, morningOn, afternoonOn, nightOn }`
3. Idempotence: `upsert` podle `@@unique([machine, weekStart, dayOfWeek])`
4. Logování počtu vytvořených/aktualizovaných řádků přes `logger.info`

Skript lze spustit vícekrát bez škody (upsert). Po go-live se spouští znovu nebude.

---

## API endpointy

### Nové: `src/app/api/machine-week-shifts/route.ts`

**GET `?weekStart=YYYY-MM-DD`**
- Vrátí všechny řádky pro zadaný `weekStart` (obě stroje × 7 dní = max 14 záznamů)
- Pokud pro danou kombinaci `(machine, weekStart)` neexistuje žádný záznam → auto-seed z předchozího týdne (upsert, response pak obsahuje nově vytvořené záznamy)
- Auto-seed logika:
  - Načíst předchozí týden (`weekStart − 7`) pro stejný stroj
  - Pokud předchozí týden má záznamy → zkopírovat flags do cílového týdne
  - Pokud ani předchozí týden nemá → vytvořit 7 prázdných řádků (`isActive: false`, všechny flags false)

**PUT**
- Payload: `{ machine: string, weekStart: string, days: Array<{ dayOfWeek, isActive, morningOn, afternoonOn, nightOn }> }`
- Validace: role ADMIN/PLANOVAT, `days.length === 7`, dayOfWeek 0–6 unique
- Upsert všech 7 řádků v `$transaction` + `AuditLog` pro auditní stopu
- Po úspěchu: emit SSE `schedule:changed` (stejný kanál jako dnes, viz [src/lib/sse.ts](src/lib/sse.ts))

### Odstraněné (po ověření + deploy):
- `src/app/api/machine-shifts/route.ts` (GET/PUT/POST) — smazat
- `src/app/api/machine-shifts/[id]/route.ts` (PUT/DELETE) — smazat
- `src/app/api/machine-exceptions/route.ts` (GET/POST) — smazat
- `src/app/api/machine-exceptions/[id]/route.ts` (DELETE) — smazat

### Změněné:
- `src/components/admin/ShiftRoster.tsx` — fetch `/api/machine-week-shifts?weekStart=...` místo `/api/machine-shifts`, přímý reuse response (už je shape kompatibilní)

---

## Admin UI

### Nová komponenta `src/components/admin/MachineWorkHoursWeek.tsx`

**Layout identický s [ShiftRoster.tsx](src/components/admin/ShiftRoster.tsx):**
- Header: `PRACOVNÍ DOBA`, navigace týdnů (`← Předchozí` / `KT. N · datum` / `Další →`), tlačítko `Zkopírovat z N. KT`
- Tabulka 8 sloupců (název / 7 dnů)
- Machine header row: `XL 105` s `color-mix(var(--brand) 10%)` pozadím
- 3 řádky pro směny: Ranní / Odpolední / Noční
- Buňky: **checkbox** místo popoveru (jen zatrhni/odtrhni, zda směna běží)
- Stav `dirty` — tlačítko `Uložit změny` vpravo nahoře, změny se persistují batch-em přes PUT

**CSS proměnné (stejné jako ShiftRoster), žádné emotikony, žádné hex barvy.**

**Role:** ADMIN + PLANOVAT (shoda s dnešním MachineShifts editorem).

### Změna v [AdminDashboard.tsx](src/app/admin/_components/AdminDashboard.tsx)

- Import `MachineWorkHoursWeek` místo `MachineShiftsEditor`
- `activeTab === "shifts"` → `<MachineWorkHoursWeek />`
- Pro tab `"shifts"` rozšířit `maxWidth` na 1280 (stejně jako `"rozpis"`)

**Odstranit/nechat zaniknout:** dnešní komponentu `MachineShiftsEditor` + editor výjimek (pokud je v samostatné komponentě) lze smazat až po `prisma migrate` krokem 3 (drop tabulek).

---

## Runtime planneru

Klíčový princip: **API planneru se nezměnilo**. Zůstává funkce `resolveScheduleRows(machine, date, ...)` vracející `DayScheduleRow[]` stejné jako dnes. Mění se jen zdroj dat.

### `src/lib/scheduleValidationServer.ts`
- `validateBlockScheduleFromDb()` — místo fetchování templates + exceptions + companyDays načte:
  - `MachineWeekShifts` pro všechny týdny, kterých se blok dotýká (obvykle 1, u přetékajících 2)
  - `CompanyDay` (beze změny)
- Volá `checkScheduleViolationWithTemplates()` se synteticky zkonstruovanými `DayScheduleRow[]` z `MachineWeekShifts`

### `src/lib/scheduleValidation.ts`
- `resolveScheduleRows()` — refactor: z nové signatury `(machine, date, weekShifts: MachineWeekShifts[])` vrátí řádky
  - Najdi `weekStart` pro `date` (pondělí 00:00 UTC)
  - Najdi 7 řádků pro `(machine, weekStart)` → namapuj na `DayScheduleRow[]`
  - Pokud řádek chybí → fallback `isActive: false`
- `checkScheduleViolationWithTemplates()` — beze změny logiky, jen vstupní typ

### `src/lib/workingTime.ts`
- `snapToNextValidStartWithTemplates()` + `snapGroupDeltaWithTemplates()` — beze změny kódu, jen mění se název typu vstupu na `MachineWeekShifts[]`

### `src/app/page.tsx` (SSR fetch)
- Místo `fetchTemplates` + `fetchExceptions` → fetch `MachineWeekShifts` pro rozsah viditelných týdnů (default ±4 týdny od dnešního)
- Předává `initialMachineWeekShifts` do `PlannerPage`

### `src/app/_components/PlannerPage.tsx`
- `machineWorkHoursRef`, `machineExceptionsRef` → **nahradit** `machineWeekShiftsRef`
- SSE listener `schedule:changed` → refetch `MachineWeekShifts` pro aktuálně viditelné týdny
- Volání snap funkcí na řádcích 1260, 1320, 1336, 2106, 2150, 2331 — propsat nový ref

### `src/app/_components/TimelineGrid.tsx`
- Řádek ~26: `resolveScheduleRows()` dostane `weekShifts` místo templates/exceptions

### `src/lib/reportMetrics.ts`
- `computeAvailableHours()` — refactor: sumuj podle `MachineWeekShifts` + fixních `SHIFT_TIMES`

---

## Dotčené soubory (souhrn)

| Kategorie | Soubor | Akce |
|-----------|--------|------|
| Schema | [prisma/schema.prisma](prisma/schema.prisma) | + `MachineWeekShifts`; odstranit templates + exceptions (fáze 6) |
| Migrace | `prisma/migrations/YYYYMMDD_add_machine_week_shifts/migration.sql` | Nový model |
| Migrace | `prisma/migrations/YYYYMMDD_drop_machine_templates/migration.sql` | Drop starých tabulek (fáze 6) |
| Skript | `scripts/migrate-to-week-shifts.ts` | Backfill dat |
| Knihovna | `src/lib/shiftTimes.ts` | **Nový** — `SHIFT_TIMES` konstanty |
| API | `src/app/api/machine-week-shifts/route.ts` | **Nový** — GET s auto-seed, PUT |
| API | `src/app/api/machine-shifts/route.ts` + `[id]` | Smazat (fáze 6) |
| API | `src/app/api/machine-exceptions/route.ts` + `[id]` | Smazat (fáze 6) |
| Admin UI | `src/components/admin/MachineWorkHoursWeek.tsx` | **Nový** — týdenní grid |
| Admin UI | [src/app/admin/_components/AdminDashboard.tsx](src/app/admin/_components/AdminDashboard.tsx) | Swap komponenty + maxWidth |
| Admin UI | `src/components/admin/MachineShiftsEditor.tsx` (nebo ekvivalent) | Smazat (fáze 6) |
| Rozpis | [src/components/admin/ShiftRoster.tsx](src/components/admin/ShiftRoster.tsx) | Změna fetch URL + typ response |
| Validace | [src/lib/scheduleValidation.ts](src/lib/scheduleValidation.ts) | Refactor `resolveScheduleRows()` |
| Validace | [src/lib/scheduleValidationServer.ts](src/lib/scheduleValidationServer.ts) | Refactor fetch + volání |
| Validace | [src/lib/workingTime.ts](src/lib/workingTime.ts) | Typ vstupu |
| Metriky | [src/lib/reportMetrics.ts](src/lib/reportMetrics.ts) | Refactor `computeAvailableHours()` |
| Planner | [src/app/_components/PlannerPage.tsx](src/app/_components/PlannerPage.tsx) | Refs, SSE listener |
| Planner | [src/app/page.tsx](src/app/page.tsx) | SSR fetch |
| Planner | [src/app/_components/TimelineGrid.tsx](src/app/_components/TimelineGrid.tsx) | Vstup do `resolveScheduleRows()` |
| Testy | [src/lib/scheduleValidationServer.test.ts](src/lib/scheduleValidationServer.test.ts) | Přepsat mock na `MachineWeekShifts` |

---

## Fázování (Sprinty)

**Sprint A — Datový model + migrace (backend základ)**
1. Prisma model `MachineWeekShifts` + migrace `prisma migrate dev`
2. `src/lib/shiftTimes.ts` s `SHIFT_TIMES` konstantami
3. Migrační skript `scripts/migrate-to-week-shifts.ts`
4. Spuštění skriptu v dev → ověřit počet řádků (2 stroje × 105 týdnů × 7 dní = ~1470)
5. **Test:** SQL query — shoda s dnešními šablonami pro kontrolní vzorek (např. příští pondělí)

**Sprint B — Runtime planneru (validace + snap)**
1. Refactor `resolveScheduleRows()` v `scheduleValidation.ts`
2. Refactor `validateBlockScheduleFromDb()` v `scheduleValidationServer.ts`
3. Refactor `computeAvailableHours()` v `reportMetrics.ts`
4. Update testu `scheduleValidationServer.test.ts` (mock `MachineWeekShifts`)
5. SSR fetch v `page.tsx` + props v `PlannerPage.tsx` + `TimelineGrid.tsx`
6. **Test:** 24/24 test suite zelené; manuální — drag bloku mimo pracovní dobu musí vracet `SCHEDULE_VIOLATION`

**Sprint C — API pro nový model**
1. `src/app/api/machine-week-shifts/route.ts` s GET (auto-seed) + PUT (transaction + AuditLog + SSE)
2. **Test:** curl/Postman — GET prázdný týden → seeduje z předchozího; PUT → ověřit DB + SSE event

**Sprint D — Admin UI**
1. `src/components/admin/MachineWorkHoursWeek.tsx` — layout 1:1 jako ShiftRoster, checkboxy místo popoveru
2. Swap v `AdminDashboard.tsx` (tab `shifts` → `MachineWorkHoursWeek`)
3. ShiftRoster přepnout na `/api/machine-week-shifts`
4. **Test:** browser — navigace týdnů, zatržení směny, uložení, ověřit reflekci v Rozpisu směn i planneru

**Sprint E — Cleanup**
1. Drop migrace: `MachineWorkHoursTemplate`, `MachineWorkHoursTemplateDay`, `MachineScheduleException`
2. Smazat staré API routes (`machine-shifts/*`, `machine-exceptions/*`)
3. Smazat staré komponenty (`MachineShiftsEditor`, exception editor)
4. Cleanup importů + CLAUDE.md update
5. **Test:** `npm run build`, full test suite, manuální smoke test

---

## Verifikace (end-to-end)

### Automatické
```bash
node --test --import tsx src/lib/dateUtils.test.ts             # 8 testů
node --test --import tsx src/lib/errors.test.ts                # 5 testů
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts  # 11 testů (přepsané)
npm run build                                                    # musí projít
npm run lint                                                     # 0 errorů
```

### Manuální scénáře
1. **Admin otevře Pracovní dobu → nový týden** → má se auto-seedovat z předchozího
2. **Admin odškrtne noční směnu Čt v XL_105 → uloží** → Rozpis směn pro Čt noční v XL_105 musí ukázat šrafování (vypnuto); planner nesmí povolit blok v tomto slotu
3. **Admin zatrhne pro prázdný historický týden ranní směnu** → musí uložit přes PUT, audit log zapíše změnu
4. **Planner** — existující bloky před migrací musí zůstat validní (migrace backfilluje historii)
5. **CompanyDay Velikonoce** — planner stále blokuje (beze změny)
6. **SSE real-time** — admin uloží změnu → planner (druhé okno) automaticky obnoví buffer bez reloadu

### Rollback
- Drop tabulky `MachineWeekShifts` nepůjde, dokud není smazaný starý kód
- Během sprintů A–D jsou staré tabulky netčené → kdykoliv lze vrátit k původnímu modelu
- Sprint E = point-of-no-return. Před ním git tag `v-before-week-shifts` + DB dump.

---

## Otevřené body / rizika

- **Timezone:** `weekStart` v DB je `DateTime @db.Date` (pondělí 00:00 UTC). `weekStartFromDate()` v [src/lib/shiftRoster.ts](src/lib/shiftRoster.ts) musí vracet UTC pondělí. Ověřit v Sprint A krok 3.
- **Velikost fetch:** planner si dnes drží šablony v paměti. S `MachineWeekShifts` za ±4 týdny = 2 × 8 × 7 = 112 řádků — zanedbatelné. Pro větší rozsahy paginovat.
- **AuditLog shape:** `AuditLog.blockId` je NOT NULL. Pro audit pracovní doby použít `blockId: 0` (sentinel) nebo přidat nullable `weekShiftsId` — v Sprintu C rozhodnout podle konsistence s dnešním auditem šablon.
- **Noční směna přes půlnoc:** `SHIFT_TIMES.NIGHT = { startHour: 22, endHour: 30 }` — ověřit, že dnešní slot-based validace (0–48 půlhodin) umí přeteklý rozsah. V [src/lib/scheduleValidation.ts](src/lib/scheduleValidation.ts) by měla už být logika, jinak přidat.
