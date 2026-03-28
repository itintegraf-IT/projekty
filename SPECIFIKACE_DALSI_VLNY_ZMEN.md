# Plánovací aplikace — Specifikace další vlny změn

> **Jak pracovat s tímto souborem:**
> - Tento soubor je závazná implementační specifikace pro další vlnu změn v planneru.
> - Při práci v Claude Code ho používej jako primární zdroj pravdy přes `@SPECIFIKACE_DALSI_VLNY_ZMEN.md`.
> - Doplňkové zdroje jsou `@CLAUDE.md`, `@PLAN.md`, `@DOKUMENTACE.md` a aktuální stav repa.
> - Pokud je mezi dokumenty rozpor, pro tuto vlnu má přednost tento soubor.
> - Soubor `Prompt` v rootu repozitáře je historický scaffold prompt a není zdrojem pravdy pro tuto implementaci.
> - Po dokončení implementace je potřeba promítnout finální stav do `CLAUDE.md`, `PLAN.md` a případně do relevantních částí `DOKUMENTACE.md`.

---

## Přehled změn

Tato vlna navazuje na současnou planner aplikaci postavenou nad Next.js, React, TypeScript, Prisma a MySQL. Zaměřuje se na přesnější plánování opakovaných zakázek, rozšíření sdíleného chování split skupin, upravený model pracovní doby, nové výrobní sloupečky a změnu pravidel kolem potvrzení tisku.

| ID | Oblast | Změna | Stav |
|----|--------|-------|------|
| 1 | Opakování a série | Preview všech výskytů + ruční editace termínů jednotlivých opakování | ⬜ Nezačato |
| 2 | Splitované zakázky | Propagace `type` a `blockVariant` mezi všemi částmi splitu | ⬜ Nezačato |
| 3 | Role a oprávnění | `PLANOVAT` dostane omezený přístup do `/admin` | ⬜ Nezačato |
| 4 | Pracovní doba strojů | Periodické šablony s platností `od-do` | ✅ Hotovo |
| 5 | Výrobní sloupečky | Nový sloupec `Pantone` s datem a `OK` | 🔄 Rozpracováno (DB hotovo, UI chybí) |
| 6 | Výrobní sloupečky | `Materiál = SKLADEM` jako dedikovaný režim místo data | 🔄 Rozpracováno (DB hotovo, UI chybí) |
| 7 | Potvrzení tisku | Zrušení automatického `PRINT_RESET` při přesunu bloku | ✅ Hotovo |
| 8 | Context menu zakázky | Submenu `Stav zakázky` v pravém kliknutí na blok | ⬜ Nezačato |

> Stav měň na: ⬜ Nezačato / 🔄 Rozpracováno / ✅ Hotovo / 🐛 Chyba

---

## Opakování a série

### Účel

Současné opakování funguje jako jednoduché `recurrenceType + recurrenceCount`, kde se child bloky pouze automaticky dopočítají podle intervalu. Nově musí planner před uložením série vidět konkrétní termíny všech výskytů a mít možnost ručně upravit datum a čas každého z nich.

### Nový flow pro opakované zakázky

- Tato změna se týká pouze zakázek se zapnutým opakováním (`recurrenceType !== "NONE"`).
- Jednorázové bloky (`recurrenceType === "NONE"`) zůstávají v dnešním flow přes builder frontu a drag & drop na timeline.
- Pro opakované zakázky se builder chová odlišně:
  - nově obsahuje výběr stroje,
  - nově obsahuje datum a čas prvního startu,
  - po zadání intervalu a počtu vytvoří preview všech výskytů,
  - hlavní CTA už není `Přidat do fronty`, ale přímé `Naplánovat sérii`.
- Preview musí zobrazit každý výskyt jako samostatný řádek nebo kartu se dvěma editovatelnými poli:
  - datum startu,
  - čas startu.
- Délka tisku a stroj jsou v této vlně sdílené pro celou sérii a neupravují se per-výskyt.

### Pravidla preview

- Preview se generuje z prvního startu podle zvoleného intervalu:
  - `DAILY` = po 1 dni,
  - `WEEKLY` = po 7 dnech,
  - `MONTHLY` = po 1 měsíci.
- Počet výskytů zůstává v builderu číselná hodnota stejně jako dnes.
- Planner může po automatickém vygenerování ručně přepsat datum a čas libovolného výskytu bez dopadu na ostatní řádky.
- Preview musí být dostupné ještě před prvním uložením do databáze.

### Editace existující série

- Při otevření kteréhokoli bloku ze série se musí načíst celá série:
  - root blok = `block.id` nebo `block.recurrenceParentId`,
  - children = všechny bloky s daným `recurrenceParentId`.
- Editor série má zobrazit stejné preview jako builder, ale pro již existující výskyty.
- V této vlně se u existující série upravují pouze termíny existujících instancí.
- Přidávání nových výskytů nebo zkracování série změnou počtu není součástí této vlny.

### Uložení série

- Datový model série zůstává zachován:
  - root a child bloky zůstávají běžnými záznamy modelu `Block`,
  - vazba dál používá `recurrenceParentId`,
  - `recurrenceType` zůstává součástí bloku.
- Nesmí se zavádět nová samostatná tabulka pro occurrence nebo recurrence preview.
- Přímé vytvoření série v builderu může nadále používat stávající `POST /api/blocks` opakovaně:
  - root blok se vytvoří jako první,
  - children se vytvoří po jednom s `recurrenceParentId = root.id`.
- Editace celé série může použít stávající `PUT /api/blocks/[id]` po jednotlivých blocích; v této vlně není potřeba zavádět nový specializovaný endpoint pro sérii.

---

## Splitované zakázky

### Účel

Splitované bloky už dnes sdílí vybraná metadata, ale nesdílí typ bloku ani stav zakázky. Nově musí být split skupina v těchto oblastech konzistentní napříč všemi částmi.

### Sdílené pole split skupiny

Stávající logika `SPLIT_SHARED_FIELDS` se musí rozšířit o:

- `type`
- `blockVariant`
- `pantoneRequiredDate`
- `pantoneOk`
- `materialInStock`

Aktualizovaný sdílený seznam má obsahovat:

```ts
[
  "orderNumber",
  "type",
  "blockVariant",
  "description",
  "specifikace",
  "deadlineExpedice",
  "dataStatusId",
  "dataStatusLabel",
  "dataRequiredDate",
  "dataOk",
  "materialStatusId",
  "materialStatusLabel",
  "materialRequiredDate",
  "materialOk",
  "materialInStock",
  "pantoneRequiredDate",
  "pantoneOk",
  "barvyStatusId",
  "barvyStatusLabel",
  "lakStatusId",
  "lakStatusLabel",
]
```

### Sdílené chování

- Změna `type` na jedné části splitu se musí propsat do všech částí stejné split skupiny.
- Změna `blockVariant` na jedné části splitu se musí propsat do všech částí stejné split skupiny.
- Pokud se `type` změní z `ZAKAZKA` na `REZERVACE` nebo `UDRZBA`, musí se `blockVariant` u celé split skupiny normalizovat na `STANDARD`.
- Pokud se `type` vrátí zpět na `ZAKAZKA`, lze následně znovu zvolit variantu zakázky.

### Pole, která zůstávají per-blok

- `materialNote` zůstává záměrně nesdílené.
- `materialNoteByUsername` zůstává záměrně nesdílené.
- Časy (`startTime`, `endTime`) zůstávají samostatné pro každou část splitu.
- `printCompletedAt`, `printCompletedByUserId`, `printCompletedByUsername` zůstávají samostatné per blok.

---

## Role a oprávnění

### Účel

Role `PLANOVAT` nově dostane omezený vstup do administrace, ale pouze pro oblasti, které přímo souvisí s plánováním výroby.

### `/admin` přístup

- `PLANOVAT` musí mít přístup na stránku `/admin`.
- `ADMIN` dál vidí celý admin dashboard.
- `PLANOVAT` v admin dashboardu uvidí pouze:
  - `Číselníky`,
  - `Pracovní doba`.
- `PLANOVAT` nesmí vidět:
  - `Uživatelé`,
  - `Audit log`.

### UI pravidla

- Pokud je přihlášen `PLANOVAT`, odkaz `Správa` v headeru planneru musí být viditelný stejně jako pro `ADMIN`.
- `AdminDashboard` musí filtrovat záložky podle role ještě před renderem.
- Výchozí aktivní tab pro `PLANOVAT` musí být `Číselníky`.
- Nesmí existovat skrytá cesta, jak si `PLANOVAT` v UI přepne na tab `Uživatelé` nebo `Audit log`.

### Server-side pravidla

- `src/app/admin/page.tsx` nesmí dál blokovat `/admin` jen na `ADMIN`.
- Přístupové guardy API musí zůstat konzistentní s UI:
  - `/api/admin/users*` zůstává `ADMIN only`,
  - `/api/audit` zůstává `ADMIN only`,
  - `/api/codebook` write operace budou `ADMIN + PLANOVAT`,
  - `/api/machine-shifts*` write operace zůstávají `ADMIN + PLANOVAT`.

### Zachované role výrobních sloupečků

- `DTP` stále edituje pouze `DATA`.
- `MTZ` stále edituje `MATERIÁL` a nově také `Pantone`.
- `VIEWER` zůstává read-only.
- `TISKAR` zůstává mimo `/admin`.

---

## Pracovní doba strojů

### Účel

Současný model `MachineWorkHours` umí jen jednu týdenní šablonu na stroj. Nově je potřeba definovat časově omezené období platnosti, aby šlo nastavit jinou pracovní dobu například od `1.7.` do `12.8.` bez ručního klikání jednotlivých dní jako exceptions.

### Nový model

Místo jedné ploché tabulky s řádky `machine + dayOfWeek` se zavede parent-child model:

```prisma
model MachineWorkHoursTemplate {
  id         Int      @id @default(autoincrement())
  machine    String
  label      String?
  validFrom  DateTime
  validTo    DateTime?
  isDefault  Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @default(now()) @updatedAt
  days       MachineWorkHoursTemplateDay[]

  @@index([machine, validFrom])
}

model MachineWorkHoursTemplateDay {
  id          Int      @id @default(autoincrement())
  templateId  Int
  dayOfWeek   Int
  startHour   Int
  endHour     Int
  isActive    Boolean  @default(true)
  template    MachineWorkHoursTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, dayOfWeek])
}
```

### Význam šablon

- Každý stroj musí mít právě jednu defaultní šablonu:
  - `isDefault = true`
  - `validFrom = 1970-01-01`
  - `validTo = null`
- Volitelné dočasné šablony:
  - `isDefault = false`
  - mají `validFrom` a `validTo`
  - platí pouze v zadaném období
- Každá šablona obsahuje 7 child řádků, jeden pro každý den v týdnu.

### Pravidlo precedence

Pro konkrétní datum se provozní hodiny určují v tomto pořadí:

1. `MachineScheduleException` pro konkrétní den
2. aktivní dočasná šablona (`validFrom <= day <= validTo`)
3. defaultní šablona stroje

### Omezení dočasných šablon

- Dvě dočasné šablony stejného stroje se nesmí překrývat.
- Defaultní šablona se nesmí smazat.
- Dočasná šablona se při založení v UI předvyplní z aktuálně platné šablony, aby planner neupravoval sedm řádků od nuly.

### Ukládání data platnosti

`validFrom` a `validTo` se musí ukládat stejně jako ostatní kalendářní dny v aplikaci:
- klient posílá datum jako `YYYY-MM-DD`,
- server ukládá UTC midnight daného pražského dne,
- nesmí se používat `getFullYear() / getMonth() / getDate()` na serveru pro konverzi.

### Dopad na planner

- Serverová validace rozvrhu musí používat aktivní resolved šablonu, ne starou plochou tabulku.
- Klientský snap (`snapToNextValidStart`, `snapGroupDelta`) musí pracovat nad resolved šablonou pro dané datum.
- `MachineScheduleException` zůstává zachovaný model i endpoint.

---

## Výrobní sloupečky — Pantone a Materiál

### Pantone

`Pantone` je nový samostatný výrobní sloupec. Není to položka číselníku `MATERIAL` a nesmí se implementovat jako pouhé znovuobnovení starého `pantoneExpectedDate`.

### Chování sloupce Pantone

- `Pantone` obsahuje:
  - očekávané datum,
  - `OK` checkbox.
- Pokud je vyplněné datum a `OK = false`, zobrazuje se datum.
- Pokud je `OK = true`, zobrazuje se místo data čistě `OK`.
- V této vlně `Pantone` nemá vlastní warning logiku typu `today/overdue`.
- `Pantone` musí být viditelný a editovatelný:
  - v builderu,
  - v detailu bloku,
  - na timeline,
  - ve split propagaci,
  - v auditu.

### Oprávnění pro Pantone

Sloupec `Pantone` mohou editovat:

- `ADMIN`
- `PLANOVAT`
- `MTZ`

### Materiál = SKLADEM

Režim `SKLADEM` se nově neřeší výběrem položky z číselníku, ale dedikovaným boolean polem `materialInStock`.

### Chování `materialInStock`

- Pokud je `materialInStock = true`:
  - `materialRequiredDate` se vyčistí na `null`,
  - v UI se místo data zobrazuje `SKLADEM`,
  - date-based warning logika pro materiál se neuplatňuje.
- Pokud se `materialInStock` zruší:
  - datum se automaticky neobnovuje,
  - planner musí datum znovu zadat ručně.

### Vztah k `materialOk`

- `materialInStock` nenahrazuje `materialOk`.
- `materialInStock` automaticky nenastavuje `materialOk = true`.
- `materialOk` zůstává samostatný checkbox s dosavadním významem.

### UI pravidla

- V detailu bloku i v builderu musí být přepínač `SKLADEM` vizuálně svázán s date pickerem materiálu.
- Pokud je otevřen kalendář materiálu, pod kalendářem musí být dostupná jasná volba `SKLADEM`.
- Timeline chip pro materiál musí umět zobrazit:
  - datum,
  - `SKLADEM`,
  - `OK` logiku materiálu podle stávajícího chování.

### Legacy poznámka

- Pokud v databázi nebo seedu existuje codebook položka `SKLADEM` nebo `pantone (očekávané datum dodání)`, nesmí být považována za source of truth této nové logiky.
- Source of truth pro tuto vlnu jsou nová pole na modelu `Block`.

---

## Potvrzení tisku (Hotovo)

### Účel

Současná aplikace automaticky maže potvrzení tisku při přesunu nebo resize bloku (`PRINT_RESET`). To už není požadované chování.

### Nové pravidlo

- Pokud je blok označen jako hotový (`printCompletedAt != null`), přesun v čase nebo mezi stroji ho nesmí automaticky vracet.
- To platí pro:
  - single move,
  - resize,
  - batch move,
  - paste,
  - auto-push navazujících bloků.
- `Hotovo` zůstává aktivní, dokud ho někdo ručně nevrátí přes `POST /api/blocks/[id]/complete` s `completed: false`.

### Co se ruší

- Automatické nulování `printCompletedAt`, `printCompletedByUserId`, `printCompletedByUsername` při časové nebo strojové změně.
- Audit akce `PRINT_RESET` pro move flow.

### Zachovaná omezení

- Potvrdit tisk lze stále jen pro blok typu `ZAKAZKA`.
- Pokud se blok změní z `ZAKAZKA` na `REZERVACE` nebo `UDRZBA`, potvrzení tisku se při této změně vyčistí jako konzistenční cleanup.
- Zelené vizuální zvýraznění hotového bloku zůstává navázané na `printCompletedAt != null`.

---

## Context menu zakázky

### Účel

Pravé kliknutí na blok má nabídnout rychlou změnu stavu zakázky bez nutnosti otevírat celý detail.

### Implementační pravidla

- Musí se použít existující wrapper nad shadcn/Radix context menu:
  - `ContextMenuSub`
  - `ContextMenuSubTrigger`
  - `ContextMenuSubContent`
- Nezavádět vlastní ad-hoc submenu mimo aktuální komponentový wrapper.

### Nové submenu

Na začátek context menu zakázky se přidá položka:

- `Stav zakázky`

Pod ní se otevře submenu s položkami:

- `Klasická`
- `Bez technologie`
- `Bez sáčku`
- `Pozastaveno`

### Dostupnost submenu

- Submenu se zobrazuje pouze pro blok typu `ZAKAZKA`.
- Submenu se zobrazuje pouze tehdy, pokud má uživatel právo blok editovat.
- Pokud je blok zamčený, submenu se nezobrazuje jako editovatelná akce.

### Chování

- Výběr položky v submenu musí okamžitě změnit `blockVariant`.
- Pokud je blok součástí split skupiny, změna se musí propsat do všech částí splitu.
- Pokud se po změně typu blok přestane chovat jako `ZAKAZKA`, submenu `Stav zakázky` se má v dalším otevření přestat zobrazovat.

---

## DB změny

### Block

Model `Block` se rozšíří minimálně o tato pole:

```prisma
pantoneRequiredDate DateTime?
pantoneOk           Boolean   @default(false)
materialInStock     Boolean   @default(false)
```

### Poznámky k poli `Block`

- `pantoneRequiredDate` je samostatný datumový sloupec, není to codebook label.
- `pantoneOk` přepíná zobrazení hodnoty na `OK`.
- `materialInStock` je dedikovaný boolean pro režim `SKLADEM`.

### Split shared fields

Do split propagace se přidá:

- `type`
- `blockVariant`
- `pantoneRequiredDate`
- `pantoneOk`
- `materialInStock`

### Pracovní doba

Plochý model `MachineWorkHours` se nahrazuje parent-child modelem:

- `MachineWorkHoursTemplate`
- `MachineWorkHoursTemplateDay`

Migrace musí:

1. vytvořit defaultní template pro každý stroj z existujících řádků,
2. přenést všech 7 dnů do child tabulky,
3. zachovat `MachineScheduleException` beze změny,
4. odstranit závislost aplikace na starém plochém modelu.

### Recurrence model

- Nevzniká nová tabulka pro sérii nebo occurrence.
- Série dál používá stávající `Block` + `recurrenceParentId`.

---

## API změny

### `/api/machine-shifts`

#### GET

- Přístup: všichni přihlášení.
- Vrací seznam šablon včetně child dnů, seřazený podle stroje a `validFrom`.
- Response shape:

```ts
[
  {
    id: number,
    machine: string,
    label: string | null,
    validFrom: string,
    validTo: string | null,
    isDefault: boolean,
    days: [
      { id: number, dayOfWeek: number, startHour: number, endHour: number, isActive: boolean }
    ]
  }
]
```

#### POST

- Přístup: `ADMIN`, `PLANOVAT`
- Slouží k vytvoření nové dočasné šablony.
- Body:

```ts
{
  machine: string,
  label?: string | null,
  validFrom: string, // YYYY-MM-DD
  validTo: string,   // YYYY-MM-DD
  days: [
    { dayOfWeek: number, startHour: number, endHour: number, isActive: boolean }
  ]
}
```

- Server musí odmítnout překryv s jinou dočasnou šablonou stejného stroje.

### `/api/machine-shifts/[id]`

#### PUT

- Přístup: `ADMIN`, `PLANOVAT`
- Upravuje metadata šablony a všech 7 child dnů.
- Defaultní template smí měnit své child dny, ale nesmí se jí vypnout `isDefault` ani nastavit `validTo`.

#### DELETE

- Přístup: `ADMIN`, `PLANOVAT`
- Smazat lze jen dočasnou šablonu.
- Defaultní template nelze mazat.

### `/api/blocks`

#### POST

- Přidat podporu polí:
  - `pantoneRequiredDate`
  - `pantoneOk`
  - `materialInStock`
- Pro opakovanou sérii se builder v této vlně může opřít o opakované volání `POST /api/blocks` bez nového specializovaného series endpointu.

### `/api/blocks/[id]`

#### PUT

- Přidat podporu polí:
  - `pantoneRequiredDate`
  - `pantoneOk`
  - `materialInStock`
- Rozšířit split propagaci o nová sdílená pole včetně `type` a `blockVariant`.
- Přestat nulovat print completion při změně `startTime`, `endTime` nebo `machine`.
- Pokud se `type` změní pryč od `ZAKAZKA`, vyčistit print completion a normalizovat `blockVariant`.

### `/api/blocks/batch`

- Přestat používat automatický `PRINT_RESET`.
- Zachovat validaci provozní doby, ale nad novým resolved modelem šablon + exceptions.

### `/api/codebook`

- `GET` zůstává beze změny.
- `POST`, `PUT`, `DELETE` nově povoleno pro:
  - `ADMIN`
  - `PLANOVAT`

### Audit

Audit musí nově logovat změny polí:

- `pantoneRequiredDate`
- `pantoneOk`
- `materialInStock`

Audit už nemá vytvářet automatickou akci `PRINT_RESET` při move flow.

---

## Matice oprávnění

### UI akce

| Akce | ADMIN | PLANOVAT | DTP | MTZ | TISKAR | VIEWER |
|------|-------|----------|-----|-----|--------|--------|
| Vidět planner | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Vidět `/admin` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Uživatelé` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Číselníky` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Pracovní doba` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Audit log` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Editovat DATA | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Editovat MATERIÁL | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Editovat Pantone | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Přepnout `Materiál = SKLADEM` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Měnit stav zakázky přes context menu | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Označit / vrátit `Hotovo` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |

### API endpointy

| Endpoint | ADMIN | PLANOVAT | DTP | MTZ | TISKAR | VIEWER |
|----------|-------|----------|-----|-----|--------|--------|
| `GET /api/machine-shifts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/machine-shifts` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `PUT /api/machine-shifts/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `DELETE /api/machine-shifts/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/codebook` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/codebook` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `PUT /api/codebook/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `DELETE /api/codebook/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/admin/users*` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/audit` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Testovací scénáře

### Acceptance scénáře

1. **Měsíční série s preview**
   - V builderu založit měsíční sérii o 12 výskytech.
   - Upravit ručně alespoň 3 konkrétní termíny v preview.
   - Po uložení ověřit, že v DB i na timeline vzniklo 12 bloků se správnými časy.

2. **Editace existující série**
   - Otevřít jednu instanci existující série.
   - Načíst všechny výskyty série v editoru.
   - Upravit termíny dvou instancí.
   - Ověřit, že se změnily pouze existující instance a nepřibyl ani neubyla žádná.

3. **Split propagace typu a stavu**
   - Rozdělit blok na dvě části.
   - Na jedné části změnit `type` nebo `blockVariant`.
   - Ověřit, že se změna propsala do celé split skupiny.
   - Ověřit, že `materialNote` na druhé části zůstala beze změny.

4. **Omezený admin pro `PLANOVAT`**
   - Přihlásit se jako `PLANOVAT`.
   - Otevřít `/admin`.
   - Ověřit, že jsou vidět jen `Číselníky` a `Pracovní doba`.
   - Ověřit, že endpointy pro uživatele a audit vrací zákaz přístupu.

5. **Dočasná šablona pracovní doby**
   - Vytvořit šablonu pro období `1.7.–12.8.`.
   - Ověřit, že planner i serverová validace používají jinou pracovní dobu jen v tomto období.
   - Ověřit, že mimo období se vrací defaultní šablona.
   - Ověřit, že jednodenní exception přebije obě šablony.

6. **Pantone datum + OK**
   - Vyplnit Pantone datum.
   - Ověřit zobrazení data v builderu, detailu a timeline.
   - Přepnout `OK`.
   - Ověřit, že zobrazení se přepne na `OK`.

7. **Materiál = SKLADEM**
   - Vyplnit datum materiálu.
   - Zapnout `SKLADEM`.
   - Ověřit, že datum zmizí, uloží se `null` a na timeline se zobrazuje `SKLADEM`.
   - Ověřit, že warning logika pro materiál se přestane uplatňovat.

8. **Zachování Hotovo po přesunu**
   - Označit zakázku jako hotovou.
   - Pohnout s ní přes drag & drop, resize a batch move.
   - Ověřit, že `printCompletedAt` zůstalo vyplněné a blok zůstal vizuálně hotový.

9. **Context submenu**
   - Pravým klikem otevřít menu na zakázce.
   - Ověřit přítomnost submenu `Stav zakázky`.
   - Přepnout stav na `Bez technologie`.
   - Ověřit okamžitou změnu vzhledu a správnou split propagaci.

---

## Kritická pravidla implementace

- **Timezone:** vše zůstává v `Europe/Prague`.
- **Date pickery:** nepoužívat `<input type="date">`; zachovat a rozšířit stávající `DatePickerField`.
- **Context menu:** reuse existující `src/components/ui/context-menu.tsx` wrapper; nepsat nové submenu od nuly.
- **Prompt hygiene:** ignorovat historický soubor `Prompt`; pracovat nad reálným současným repem.
- **Subagenty:** před implementací použít paralelní průzkum UI, API/schema a helperů.
- **MCP nástroje:** před novým UI patternem ověřit dostupné komponentové možnosti přes projektové MCP servery, zejména shadcn.
- **Split skupiny:** změny sdílených polí musí být konzistentní serverově i lokálně v client state.
- **Pracovní doba:** klientský snap i serverová validace musí používat stejnou resolved logiku.
- **Dokumentace po implementaci:** finální stav promítnout minimálně do `CLAUDE.md` a `PLAN.md`; `DOKUMENTACE.md` aktualizovat v těch sekcích, které se touto vlnou skutečně mění.

