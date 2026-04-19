# Rozpis směn — pracovní doba v režimu směnného provozu + obsazení tiskařů

**Datum:** 2026-04-19
**Status:** Schválený design
**Motivace:** Feedback plánovače výroby — současný model pracovní doby (jeden souvislý interval na den) nedokáže popsat směnný provoz. Některé varianty (např. celotýdenně vypnutá odpolední směna) nejdou vyjádřit. Plánovač zároveň vede mimo aplikaci Excel `TISKAŘI - aktuální rozpis směn.xls`, který chceme integrovat.

## Účel

Dva provázané cíle v jednom projektu:

1. **Rozšířit model pracovní doby** tak, aby uměl vypnout/zapnout jednotlivé směny (ranní, odpolední, noční), ne jen jeden souvislý interval.
2. **Zavést evidenci obsazení směn tiskaři** — týdenní rozpis, kdo je na jakém stroji v jaké směně. Nahrazuje stávající Excel.

## Současný stav

- `MachineWorkHoursTemplate` + `MachineWorkHoursTemplateDay` — šablona s `validFrom/validTo`, jeden `startHour/endHour` na den.
- `MachineScheduleException` — ad-hoc úpravy konkrétního dne (šrafování na timeline).
- Validace bloku proti pracovní době: [`src/lib/scheduleValidation.ts`](src/lib/scheduleValidation.ts) → `checkScheduleViolationWithTemplates()`.
- Tiskaři nejsou v systému jako entity — jen jména v `printCompletedByUsername` po potvrzení tisku.
- Rozpis směn se vede v Excelu mimo aplikaci (5 měsíců dopředu, měsíční rotace).

## Cílový stav (architektura)

Dvě vrstvy, oddělené, ale provázané:

### Vrstva 1 — Pracovní doba (rozšíření dnešního modelu)

Šablona `MachineWorkHoursTemplate` **zůstává konceptem šablony** s platností od–do. Rozdíl: `MachineWorkHoursTemplateDay` nedrží jeden interval, ale **tři booleany** pro zapnuté směny.

- Časy směn jsou **firemní konstanty** (v kódu):
  - `RANNÍ` = 06:00 – 14:00
  - `ODPOLEDNÍ` = 14:00 – 22:00
  - `NOČNÍ` = 22:00 – 06:00 (přechází přes půlnoc)
- Pokud se časy v budoucnu změní (kolektivní smlouva), je to refaktor jedné konstanty.
- Ad-hoc úpravy konkrétního dne dál řeší `MachineScheduleException` (beze změny).

### Vrstva 2 — Rozpis směn (nová)

Samostatný modul pro týdenní obsazení tiskařů. Čerpá z Vrstvy 1 (zobrazuje jen zapnuté směny), ale plánování zakázek **neovlivňuje přímo** (jen varováním).

- Nová entita `Shift` reprezentuje konkrétní směnu v konkrétním dni na konkrétním stroji.
- Každé `Shift` má seznam přiřazených tiskařů (`ShiftAssignment`).
- Tiskaři jsou entity v novém číselníku `Printer`.

## Datový model (DB změny)

### 1. `MachineWorkHoursTemplateDay` — rozšíření

```prisma
model MachineWorkHoursTemplateDay {
  id          Int    @id @default(autoincrement())
  templateId  Int
  dayOfWeek   Int
  // DEPRECATED (migrace ponechá, ale nepoužívá v nové logice):
  startHour   Int
  endHour     Int
  startSlot   Int?
  endSlot     Int?
  isActive    Boolean @default(true)
  // NOVÁ pole:
  morningOn   Boolean @default(true)
  afternoonOn Boolean @default(true)
  nightOn     Boolean @default(false)
  template    MachineWorkHoursTemplate @relation(...)
  @@unique([templateId, dayOfWeek])
}
```

Pole `startHour/endHour/startSlot/endSlot` **zůstávají v DB**, ale nová logika je nečte. V migračním kroku se z nich odvodí výchozí hodnoty pro `morningOn/afternoonOn/nightOn` (viz Migrace níže). Postupně je lze odstranit ve druhé iteraci.

### 2. `Printer` — nový číselník tiskařů

```prisma
model Printer {
  id        Int      @id @default(autoincrement())
  name      String   // "BYDŽOVSKÝ", "FLORIAN CHRÁSKA", "BERKA ml.", ...
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Záměrně jednoduché — jen jméno a flag aktivní. Žádná vazba na `User` (tiskaři v systému nemají login).

### 3. `ShiftAssignment` — nová tabulka obsazení

```prisma
model ShiftAssignment {
  id        Int      @id @default(autoincrement())
  machine   String   // "XL_105" / "XL_106"
  date      DateTime // datum dne v Europe/Prague (00:00 UTC+offset → normalizujeme)
  shift     String   // "MORNING" / "AFTERNOON" / "NIGHT"
  printerId Int
  note      String?  // volný text — "od 8:00", "(6-12)", "VÝMĚNA - PERFECT JACKETY"
  sortOrder Int      @default(0) // pořadí v buňce (tiskař bývá první, pomocník druhý)
  createdAt DateTime @default(now())

  printer   Printer  @relation(fields: [printerId], references: [id])

  @@unique([machine, date, shift, printerId])  // jeden tiskař nemůže být 2× na téže směně
  @@index([date, machine])
}
```

**Proč ne "tiskař + pomocník" jako dvě pole?** Protože Excel ukazuje i případy s 3+ lidmi na směně (`BYDŽOVSKÝ + ŠIMEK + BERKA ml.`). Model "N záznamů na směnu" je univerzální.

**Proč `machine + date + shift` místo FK na `Shift`?** Protože `Shift` jako entita neexistuje (neukládáme metadata o jednotlivých směnách — existují implicitně z kombinace den × stroj × typ směny). Ušetří tabulku a joiny.

## Interakce mezi vrstvami

**Pravidlo provázanosti:** Rozpis směn nabízí k vyplnění **jen ty směny, které jsou zapnuté v pracovní době** pro daný den a stroj.

```
                ┌──────────────────────────────┐
                │ Pracovní doba (Vrstva 1)     │
                │ XL_106, Po: ranní✅ odpol.❌ │
                │                 noční✅     │
                └──────────────┬───────────────┘
                               │ zdroj pravdy
                               ▼
                ┌──────────────────────────────┐
                │ Rozpis směn (Vrstva 2)       │
                │ UI: nabízí jen ranní a noční │
                │     pro XL_106 Po            │
                └──────────────────────────────┘
```

### Edge case: vypnutí směny s existujícím obsazením

Pokud plánovač upraví pracovní dobu a tím vypne směnu, na které už jsou `ShiftAssignment` pro budoucí data:

1. Server na PUT `/api/machine-shifts/templates/:id` **spočítá budoucí dotčená přiřazení** (`ShiftAssignment.date >= today AND shift = <vypínaná směna>`) a vrátí je v chybovém response.
2. UI plánovače zobrazí dialog: *"Zrušíš tím X přiřazených obsazení (seznam). Pokračovat?"*
3. Pokud plánovač potvrdí, PUT se zopakuje s flagem `force=true` — server v jedné transakci updatuje šablonu **a smaže dotčené `ShiftAssignment`**.
4. Smazaná obsazení se zapíšou do `AuditLog` (pro dohledatelnost, kdo co zrušil).

## Validátor zakázek

`checkScheduleViolationWithTemplates()` se upraví tak, aby místo porovnání proti `startHour/endHour` vyhodnocoval:

```
pro každý 30min slot bloku:
  dayOfWeek = ...
  shift = který ze tří intervalů (morning/afternoon/night) slot patří
  if (řádek.morningOn == false && shift == MORNING) → blok zasahuje mimo provoz
  // analogicky pro afternoon a night
```

`MachineScheduleException` má prioritu nad šablonou (beze změny).

**Noční směna přes půlnoc:** slot 22:00–06:00 patří logicky ke dni, kdy směna *začíná*. V kódu: pokud je `slot < 06:00`, vyhodnocuj se jako součást noční předchozího kalendářního dne.

## UX / stránky

### A) Admin → Pracovní doba (existující — upravujeme)

Dnešní UI editoru šablony **nahradíme checkboxy směn**:

```
┌─ XL 106 ────────────────────────────────────────────┐
│ DEN         RANNÍ     ODPOLEDNÍ    NOČNÍ           │
│                                                     │
│ Pondělí     ☑ 06-14   ☑ 14-22      ☐ 22-06         │
│ Úterý       ☑ 06-14   ☑ 14-22      ☑ 22-06         │
│ Středa      ☑ 06-14   ☑ 14-22      ☑ 22-06         │
│ Čtvrtek     ☑ 06-14   ☑ 14-22      ☑ 22-06         │
│ Pátek       ☑ 06-14   ☑ 14-22      ☐ 22-06         │
│ Sobota      ☐ 06-14   ☐ 14-22      ☐ 22-06         │
│ Neděle      ☐ 06-14   ☐ 14-22      ☑ 22-06         │
└─────────────────────────────────────────────────────┘
```

Časy u checkboxů jsou jen vizuální (fixní konstanty, needitovatelné).

### B) Admin → Tiskaři (nový tab)

Jednoduchá tabulka — řazená drag & drop (`sortOrder`) + toggle aktivity. Tlačítko `+ Přidat tiskaře`.

| # | Jméno | Aktivní | Akce |
|---|---|---|---|
| 1 | BYDŽOVSKÝ | ✅ | Upravit / Smazat |
| 2 | HAVRYLIUK | ✅ | Upravit / Smazat |
| ... | ... | ... | ... |

Zařazené jako další záložka v `AdminDashboard.tsx` (vedle Uživatelé / Číselníky / Presety / Audit / Pracovní doba).

### C) Admin → Rozpis směn (nová stránka)

**Navigace:** nová záložka v Admin panelu, route `/admin?tab=smeny` (nebo vlastní `/admin/smeny`).

**Layout (viz mockup):**
- **Horní lišta:** šipky pro navigaci týdnů, zobrazení `20. KT · 11. – 17. 5. 2026`, tlačítka `📋 Zkopírovat z 19. KT` a `✓ Publikovat`.
- **Grid:** 2 stroje × 3 směny × 7 dnů. Každá buňka = 1 směna daného dne/stroje.
  - Obsazené buňky: seznam jmen (primárně první řádek = tiskař, druhý = pomocník), pod jmény volitelná poznámka `(od 8:00)`.
  - Prázdné buňky (směna zapnutá, ale nikdo není přiřazen): žlutý rámeček + ikona ⚠.
  - Šrafované buňky: směna vypnutá v pracovní době (neklikatelné).

**Interakce kliknutím na buňku:**
- Otevře se popover se seznamem tiskařů z číselníku (multiselect).
- Pole `Poznámka` pro volný text (výjimky typu `od 8:00`).
- Uložit / zrušit.

**Kopie z minulého týdne:**
- Tlačítko `📋 Zkopírovat z <předchozí týden>`.
- Pokud aktuální týden už obsazení má, server varuje a ptá se na přepsání vs. sloučení.
- Implementace: POST `/api/shift-assignments/copy-week` s payloadem `{ fromWeekStart, toWeekStart, machine? }`.

**Publikovat:**
- Uzamkne obsazení pro tiskaře (odemykatelné s právy ADMIN).
- Odemyká viditelnost v UI tiskařů (pokud/až přidáme).
- MVP: `publishedAt` v `ShiftAssignment` (per záznam), tlačítko nastaví `publishedAt = now()` pro všechny záznamy daného týdne.

### D) Vizuální varování v builderu směn

Na místě 1 (editor Rozpisu směn):
- **Žlutý rámeček + ikona ⚠** u každé prázdné buňky zapnuté směny.
- Žádný blokátor — publikovat jde i s prázdnými buňkami.

Na místě 3 (přehled týdne před publikací):
- Summary pruh nad gridem: `⚠ 2 prázdné směny v tomto týdnu (Po odpol. XL 105, St noční XL 106)`.
- Klikem se buňka scrolluje a zvýrazní.

## API routes

| Route | Metoda | Účel |
|---|---|---|
| `/api/printers` | GET | Seznam tiskařů z číselníku |
| `/api/printers` | POST | Přidat tiskaře |
| `/api/printers/[id]` | PUT | Upravit tiskaře |
| `/api/printers/[id]` | DELETE | Smazat (měkce přes `isActive=false`) |
| `/api/machine-shifts` | GET | Existující — GET šablon (rozšíří se o `morningOn/afternoonOn/nightOn`) |
| `/api/machine-shifts` | PUT | Existující — **přidat flow pro vypínání směn s existujícím obsazením** (vrátí dotčená přiřazení, flag `force=true` pro potvrzení) |
| `/api/shift-assignments` | GET | Query params `weekStart=YYYY-MM-DD&machine=XL_106` — vrátí obsazení pro týden |
| `/api/shift-assignments` | POST | Vytvořit/upravit obsazení buňky (upsert podle `machine+date+shift+printerId`) |
| `/api/shift-assignments/[id]` | DELETE | Smazat jedno přiřazení |
| `/api/shift-assignments/copy-week` | POST | Zkopírovat obsazení z jednoho týdne do druhého |
| `/api/shift-assignments/publish` | POST | Označit týden jako publikovaný |

Všechny routes:
- Používají `AppError` + `isAppError` pro chyby (viz [project_best_practices.md]).
- Logují přes `logger` (žádný `console`).
- Mutace v `$transaction` s zápisem do `AuditLog`.
- Přístup: role `ADMIN` a `PLANOVAT`.

## Migrace ze současného modelu

**Migrace dat** (v `prisma migrate` nebo samostatném skriptu):

```sql
-- Pro každý MachineWorkHoursTemplateDay odvoď směny z startHour/endHour:
UPDATE MachineWorkHoursTemplateDay
SET morningOn   = (startHour <= 6  AND endHour >= 14),
    afternoonOn = (startHour <= 14 AND endHour >= 22),
    nightOn     = (startHour <= 22 AND endHour >= 24) OR (startHour = 0 AND endHour >= 6);
```

Tím se dnešní provoz `Po 00:00-22:00` převede na `morningOn=true, afternoonOn=true, nightOn=true` (pokud bude sedět), případně naopak `Po 06:00-14:00` → jen `morningOn=true`.

**Po migraci plánovač projde šablony a případně doladí** (čeká se trivialita — stávající provoz je většinou 3 směny = vše zapnuto).

**Excel migrace:**
- Nemigrujeme automaticky. Plánovač vyplní **první týden ručně** v novém UI, další týdny už budou kopie.
- Excel po ověření funkčnosti archivujeme (ponecháme ve složce projektu jako historii).

## Out of scope (explicitně pro tuto iteraci)

- **Tiskaři jako Uživatelé systému** — tiskaři v `TISKAR` roli se nepárují na `Printer` entity. Pokud se v budoucnu bude chtít "tiskař vidí jen svou směnu", přidá se sloupec `Printer.userId` jako FK na `User`.
- **Vazba na bloky (varianta C)** — žádné propagování "kdo co tiskl" do `Block`. Plánovač to řeší přes senzory na strojích + externí systémy.
- **Automatická rotace vzorů** — pojmenované šablony týdne (Vzor A, Vzor B) se nedělají. Kopie z minulého týdne + ruční úpravy stačí.
- **Reporting obsazení** — žádná nová sekce v `/reporty`. Data jsou dostupná přes API pro případné budoucí rozšíření.
- **TISKAR UI úprava** — stránka `/tiskar` neuvidí rozpis směn v této iteraci.
- **Stroj CD 74-5 LX** — do aplikace nepřidáváme (je to starý stroj).

## Testy

Povinné testy (v souladu s existujícím stylem — `node --test --import tsx`):

- `scheduleValidationServer.test.ts` — rozšířit o testy pro novou logiku (blok přes vypnutou odpolední, blok v noční přes půlnoc).
- `src/lib/shiftRoster.test.ts` — nový soubor: kopie týdne, detekce prázdných buněk, copy-week semantika (přepis vs. sloučení).
- Integrační test: vypnutí směny v pracovní době → vrací seznam dotčených přiřazení → `force=true` je smaže + zapíše audit.

## Best practices (povinné)

Dodržet [project_best_practices.md]:
- `AppError` v API routes (nikdy `throw new Error("...")`).
- `logger.info/warn/error` (nikdy `console`).
- `$transaction` pro mutace + `AuditLog` zápis.
- Validátor harmonogramu je **jediný** zdroj pravdy — neduplicate logiku.
- Žádné fallbacky ENV pro bezpečnostní hodnoty.
- Nové UI komponenty do `src/components/` (ne inline v `PlannerPage` ani v `AdminDashboard`).
- Mouse eventy na buňkách gridu: kontrolovat `e.button !== 0` pokud by se přidal drag.

## Rizika a mitigace

| Riziko | Mitigace |
|---|---|
| Migrace šablon spočítá špatně (např. `Po 00:00-14:00` → `nightOn=true` i když dnes není) | Před migrací vygenerovat diff report (starý vs. nový výpočet) a nechat plánovače zkontrolovat. Commit až po schválení. |
| Validátor regrese — plán se při dnes fungujících datech začne hlásit jako chybný | Unit testy pokryjí klíčové scénáře. Před nasazením projdeme produkční data scriptem, který porovná starý a nový verdikt na každém bloku. |
| Plánovač zapomene publikovat týden, tiskaři neuvidí rozpis | V MVP publikace neovlivňuje nic funkčního (TISKAR UI se nemění). Slouží jen jako vizuální marker "tenhle týden je hotový". |
| Excel rotace (cca 2-týdenní) se bude špatně kopírovat jedním tlačítkem | Dlouhodobě možnost přidat "pojmenované vzory" (viz Out of scope). V MVP řešíme kopií z předchozího týdne + ručními úpravami. |
