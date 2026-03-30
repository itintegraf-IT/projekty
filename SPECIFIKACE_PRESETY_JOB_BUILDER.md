# Plánovací aplikace — Specifikace další vlny změn: Presety v Job Builderu

> **Jak pracovat s tímto souborem:**
> - Tento soubor je závazná implementační specifikace pro samostatnou vlnu změn zaměřenou na presety v Job Builderu.
> - Před implementací si přečti minimálně `@CLAUDE.md`, `@PLAN.md`, `@DOKUMENTACE.md`, `@prisma/schema.prisma`, `@src/app/_components/PlannerPage.tsx`, `@src/app/admin/_components/AdminDashboard.tsx`, `@src/app/api/blocks/route.ts`, `@src/app/api/blocks/[id]/route.ts`, `@src/app/api/codebook/route.ts` a `@src/app/api/codebook/[id]/route.ts`.
> - Pokud jsou dostupné MCP servery, použij je; pokud nic relevantního nevystaví, pokračuj lokální analýzou repa.
> - Použij paralelní subagenty:
>   - 1 pro UI builderu a detailu bloku,
>   - 1 pro admin/presety,
>   - 1 pro Prisma/API/shared helpery.
> - Pokud narazíš na rozpor s jinou dokumentací, pro tuto vlnu má přednost tento soubor.
> - Pokud si nebudeš jistý v bodech označených jako otevřené nebo nejisté rozhodnutí, zastav se a zeptej se místo improvizace.
> - Historický soubor `@Prompt` není zdroj pravdy pro tuto implementaci.

---

## Přehled

Tato vlna zavádí do Job Builderu a editace bloků systém presetů. Preset je znovupoužitelná sada přednastavených hodnot pro výrobní sloupečky a vybraná metadata zakázky/rezervace.

Primární cíle:

- zrychlit zakládání typických zakázek a rezervací,
- sjednotit opakovaně používané kombinace DATA / MATERIÁL / BARVY / LAK / SPECIFIKACE / termíny,
- dát plánovači a adminovi možnost tyto kombinace spravovat bez zásahu do kódu,
- zachovat stávající logiku builderu, fronty, splitů, sérií a auditu bez zbytečného refaktoru mimo scope.

Tato vlna se týká současného planneru v `PlannerPage`. Neřeší ještě samostatné centrum rezervací z jiné vlny, ale presety musí být navrženy tak, aby je šlo později znovu použít i tam.

---

## Hlavní produktová rozhodnutí

### 1. Preset není role ani číselník

- Preset **nepatří do rolí**.
- Preset **nepatří jako další kategorie do `CodebookOption`**.
- Preset je samostatná doménová entita, protože kombinuje více polí napříč několika číselníky a obsahuje i relativní pravidla pro datumy.

### 2. Presety patří do sekce `Správa`

- V admin dashboardu vznikne nová samostatná záložka `Presety`.
- Záložka `Presety` bude dostupná pro role:
  - `ADMIN`
  - `PLANOVAT`
- `Presety` nebudou schované uvnitř `Číselníků`, protože by to míchalo dva odlišné koncepty:
  - číselník = jednotlivé hodnoty,
  - preset = složený template přes více polí.

### 3. Preset je snapshot source, ne live binding

- Při použití presetu se do bloku zkopírují konkrétní hodnoty.
- Blok si zároveň uloží informaci, **jaký preset byl použit**.
- Pozdější editace presetu **nesmí zpětně přepisovat existující bloky**.
- Stejně jako u číselníků je cílem ochránit historická a provozní data.

### 4. Preset je primárně určený pro `ZAKAZKA` a `REZERVACE`

- Preset je viditelný a použitelný pro:
  - `ZAKAZKA`
  - `REZERVACE`
- Pro `UDRZBA` preset nedává smysl a v této vlně se nepoužívá.

### 5. Preset je v této vlně aditivní, ne destruktivní

- Preset vyplňuje jen pole, která má definovaná.
- Pole, která preset neřeší, zůstávají beze změny.
- Přepnutí na jiný preset tedy **nečistí automaticky** všechna předchozí pole, která nový preset nedefinuje.
- To je záměrné zjednodušení první verze, aby se implementace nerozbila o složitou logiku diff/clear stavů.

### 6. Tři systémové presety musí existovat od začátku

V systému musí být přítomny tři základní presety:

- `XL 105`
- `XL 106 LED`
- `XL 106 IML`

Tyto tři presety jsou systémové:

- jsou připnuté v builderu jako rychlá volba,
- nelze je smazat,
- jejich název zůstává fixní,
- jejich obsah lze upravovat,
- mají být seednuté idempotentně a bezpečně bez přepsání již upravených dat.

Poznámka:

- uživatel zatím nezná definitivní obsah presetů,
- proto mají být seednuté minimálně s názvem, pořadím, aktivním stavem a strojovým omezením,
- samotné obsahové hodnoty si následně doplní `PLANOVAT` nebo `ADMIN` v UI.

---

## Seed a základní presety

Systém po nasazení této vlny musí obsahovat:

| Preset | Typ | Strojové omezení | Pořadí | Stav |
|---|---|---|---:|---|
| `XL 105` | systémový | `XL_105` | 0 | aktivní |
| `XL 106 LED` | systémový | `XL_106` | 1 | aktivní |
| `XL 106 IML` | systémový | `XL_106` | 2 | aktivní |

Pravidla seedu:

- seed musí být idempotentní,
- seed nesmí přepisovat již existující preset se stejným systémovým klíčem,
- seed nesmí mazat ani resetovat uživatelské presety,
- seed nesmí vyžadovat ruční spuštění destruktivního seeding skriptu nad produkcí.

Doporučené provedení:

- nová Prisma migrace vytvoří tabulku,
- do migration SQL nebo bezpečné bootstrap logiky doplní tři systémové presety stylem `insert if missing`.

---

## Scope této vlny

### In scope

- nový model presetů,
- nové CRUD API pro presety,
- nový admin UI pro presety,
- rychlý výběr presetu v Job Builderu,
- možnost vytvořit/otevřít preset i z builderu,
- použití presetu v `BlockEdit`,
- uložení reference na použitý preset do bloku,
- viditelnost presetu v detailu bloku,
- lehká viditelnost presetu v timeline,
- audit změny presetu na bloku,
- split/série/fronta/copy-paste flow musí nové pole bezpečně přenášet.

### Out of scope

- redesign samostatného centra rezervací,
- live synchronizace bloků po editaci presetu,
- automatické čištění polí, která nový preset nedefinuje,
- přidání další obecné rule-engine abstrakce přes JSON payloady,
- změny pro `TISKAR` monitor nebo tiskový report nad rámec nutné technické kompatibility,
- nové role nebo změna oprávnění mimo `Presety`.

---

## Terminologie

Aby se nepletly pojmy:

- `type` = `ZAKAZKA` / `REZERVACE` / `UDRZBA`
- `blockVariant` = dnešní „Stav zakázky“ (`STANDARD`, `BEZ_TECHNOLOGIE`, `BEZ_SACKU`, `POZASTAVENO`)
- `preset` = předvolba pro vybraná pole builderu

Preset **nesmí** v této vlně měnit `type` mezi zakázkou, rezervací a údržbou. Typ vybírá uživatel samostatně.

Preset **smí** předvyplnit `blockVariant`, ale jen pokud je výsledný `type = ZAKAZKA`.

---

## UX specifikace

### Builder

### Umístění v builderu

Preset musí být v Job Builderu umístěný:

- **pod sekcí `Typ záznamu`**
- **nad sekcí `Stav zakázky`**

Tj. přesně mezi dnešním výběrem typu a dnešním `blockVariant`.

### Viditelnost

- Pokud je `type = ZAKAZKA`, preset je viditelný.
- Pokud je `type = REZERVACE`, preset je viditelný.
- Pokud je `type = UDRZBA`, preset je skrytý a při ukládání se do bloku nesmí propsat žádná preset reference.

### Doporučený iOS-like pattern

Builder nemá použít obyčejný dlouhý dropdown jako jediný vstup. Použij tento pattern:

- nahoře kompaktní řádek `Preset` s aktuálním výběrem nebo stavem `Bez presetu`,
- pod ním tři připnuté quick actions pro systémové presety,
- sekundární akce:
  - `Více presetů…`
  - `Nový preset z aktuálních hodnot…`
  - `Upravit vybraný preset…`

Pro builder je zásadní rychlost. Tři základní presety mají být použitelné na jeden tap/klik bez otevírání další administrace.

### Chování při výběru presetu

- Kliknutí na preset v builderu **okamžitě** předvyplní odpovídající pole formuláře.
- Po aplikaci presetu může uživatel všechna pole dále ručně upravovat.
- Změny po aplikaci presetu jsou povolené a nemají preset automaticky odpojovat.
- U builderu se má zobrazit jemná helper věta:
  - `Preset předvyplní vybraná pole. Následné ruční úpravy jsou povolené.`

### Ochrana proti nechtěnému přepsání

Pokud už builder obsahuje ručně zadané hodnoty a výběr jiného presetu by přepsal některá řízená pole:

- zobraz potvrzovací sheet/dialog,
- text ve stylu:
  - `Použití presetu přepíše 6 polí. Pokračovat?`
- potvrzení musí být nutné jen tehdy, když opravdu dochází k přepisu neprázdných nebo odlišných hodnot,
- při prázdném builderu se preset aplikuje bez potvrzení.

### Zrušení presetu

- Pokud je preset vybraný, musí být dostupná akce `Zrušit preset`.
- `Zrušit preset` pouze odpojí preset jako metadata.
- `Zrušit preset` **nesmí automaticky mazat** už předvyplněné hodnoty z formuláře.

### Vztah k `Stav zakázky`

- Pokud preset obsahuje `blockVariant`, aplikuje se pouze pro `ZAKAZKA`.
- Pro `REZERVACE` se `blockVariant` ignoruje a UI nesmí dělat nic „chytrého navíc“.
- Preset je umístěn před `Stav zakázky`, protože nejdřív vybereš základní template a teprve potom případně doladíš konkrétní stav zakázky.

### Vztah k sériím

Pro flow s opakováním (`recurrenceType !== "NONE"`):

- preset se aplikuje do builder draftu stejně jako u jednorázové zakázky,
- při vytváření preview série se použijí aktuální hodnoty builderu,
- uložená série nese stejný `jobPresetId` + `jobPresetLabel` na všech vytvořených blocích,
- následná editace instance série využívá stávající dialog `jen tato instance / celá série`.

### Vztah k frontě

- Queue item musí nést preset metadata, stejně jako dnes nese výrobní sloupečky.
- Při dropu z fronty do timeline se preset metadata uloží do nově vytvořeného bloku.

### Strojové omezení presetů

Preset může mít `machineConstraint`:

- `null` = bez omezení
- `XL_105`
- `XL_106`

Pravidla:

- pro systémové presety je `machineConstraint` povinné podle názvu,
- pokud je preset omezený na konkrétní stroj:
  - v sériovém flow se stroj v builderu automaticky nastaví na správnou hodnotu,
  - v queue drop flow se drop na jiný stroj zablokuje s toastem,
  - při editaci existujícího bloku musí server i klient bránit uložení nekonzistentního stroje, pokud preset existuje a je dohledatelný.

Poznámka:

- je to silný předpoklad podle názvů presetů,
- pokud má být ve skutečnosti vazba na stroj jen „doporučená“, je nutné se před implementací doptat.

---

## BlockEdit a detail bloku

### BlockEdit

V `BlockEdit` musí být preset na stejném logickém místě jako v builderu:

- pod `Typ záznamu`,
- nad `Stav zakázky`.

Pravidla:

- pro `ZAKAZKA` a `REZERVACE` je preset editovatelný,
- pro `UDRZBA` se preset reference při save normalizuje na `null`,
- změna presetu je normální součást `buildPayload()` a `handleSave()`.

### BlockDetail

Pokud blok preset má:

- zobraz v detailu samostatný řádek `Preset`,
- použij malý neutrální chip / badge se snapshot názvem presetu.

### Timeline

Preset má být viditelný i bez otevření detailu, ale nesmí rozbít čitelnost karet.

Požadované chování:

- pokud blok preset má a karta má dostatek výšky, zobraz kompaktní preset chip,
- pokud je karta malá, stačí preset dostat do tooltip/title a detailu,
- preset nesmí vytlačit stávající prioritní informace:
  - číslo zakázky,
  - popis,
  - deadline badge,
  - výrobní sloupečky.

Doporučení:

- preset chip umístit na první nebo druhý textový řádek jen u vyšších karet,
- použít tlumenou neutrální barvu, ne soutěž s typovou barvou bloku.

### Vyhledávání

Vyhledávání v planneru se má rozšířit tak, aby hledalo i podle `jobPresetLabel`.

---

## Správa presetů v adminu

### Nová záložka

V `AdminDashboard` přidej novou top-level záložku:

- `Presety`

Viditelnost záložek:

- `ADMIN`: `Uživatelé`, `Číselníky`, `Presety`, `Audit log`, `Pracovní doba`
- `PLANOVAT`: `Číselníky`, `Presety`, `Pracovní doba`

Výchozí tab:

- pro `PLANOVAT` nově `Presety`,
- pro `ADMIN` zůstává `Uživatelé`.

### Seznam presetů

Presety v adminu nemají být jen textový seznam názvů. Každý řádek/karta má ukázat:

- název presetu,
- badge `Systémový` nebo `Vlastní`,
- aktivní / neaktivní stav,
- pro které typy platí (`Zakázka`, `Rezervace`),
- strojové omezení,
- stručný summary řádek typu:
  - `DATA + MATERIÁL + BARVY + LAK + Specifikace`
  - nebo `Bez nakonfigurovaných polí`

### Akce nad presetem

Povinné akce:

- vytvořit nový preset,
- upravit preset,
- aktivovat / deaktivovat preset,
- změnit pořadí presetů,
- smazat vlastní preset,
- otevřít systémový preset k editaci obsahu.

Pravidla:

- systémové presety nelze smazat,
- systémové presety nelze přejmenovat,
- vlastní preset lze smazat až po potvrzení,
- neaktivní preset se nezobrazuje v quick pickerech builderu, ale zůstává v adminu.

### Formulář presetu

Editor presetu má být jedna sdílená komponenta použitelná:

- v admin záložce `Presety`,
- z builderu přes `Nový preset…`,
- z builderu přes `Upravit vybraný preset…`.

Formulář rozděl do sekcí:

1. `Základ`
2. `Použití`
3. `Výrobní sloupečky`
4. `Termíny`
5. `Náhled`

#### Sekce `Základ`

- název (jen u vlastních presetů),
- aktivní / neaktivní,
- informativní badge `Systémový preset` u systémových.

#### Sekce `Použití`

- checkbox/toggle `Použít pro zakázku`
- checkbox/toggle `Použít pro rezervaci`
- volitelné `Strojové omezení`
- volitelný `Stav zakázky` (`blockVariant`) s poznámkou, že platí jen pro `ZAKAZKA`

#### Sekce `Výrobní sloupečky`

Konfigurovatelná pole v této vlně:

- `DATA` status
- `DATA` datum offset
- `MATERIÁL` status
- `MATERIÁL` datum offset
- `MATERIÁL skladem`
- `PANTONE` datum offset
- `BARVY` status
- `LAK` status
- `SPECIFIKACE`

#### Sekce `Termíny`

- `Expedice` datum offset

#### Sekce `Náhled`

Na konci formuláře ukaž srozumitelný slovní souhrn, co preset udělá. Např.:

- `Zakázka + rezervace`
- `Pouze XL 106`
- `Materiál: SKLADEM`
- `Data: dnes + 2 dny`
- `Barvy: SCH Lumina LED`

To pomůže rychlé kontrole bez čtení celého formuláře.

### Validace presetu

Preset nejde uložit, pokud:

- nemá název a nejde o systémový preset,
- není povolen ani pro `ZAKAZKA`, ani pro `REZERVACE`,
- nemá žádné nakonfigurované pole a zároveň nemá ani strojové omezení,
- obsahuje `blockVariant`, ale zároveň není povolen pro `ZAKAZKA`,
- obsahuje `materialInStock = true` a zároveň materiálový date offset, který by dával protichůdný význam.

### Datumové offsety v preset editoru

V této vlně nepoužívej fixní datum uložené v preset editoru. Preset má umět jen relativní pravidla:

- `nevyplňovat`
- `dnes`
- `dnes + N dní`

UI doporučení:

- použij toggle/segment `Nevyplňovat / Vyplnit`,
- pokud je pole aktivní, ukaž stepper nebo číselný offset v dnech,
- hodnota `0` znamená `dnes`.

Všechna relative date pravidla se vyhodnocují v timezone `Europe/Prague`.

---

## Co preset v této vlně umí předvyplnit

Preset může předvyplnit tyto hodnoty:

| Oblast | Pole | Poznámka |
|---|---|---|
| Blok | `blockVariant` | jen pro `ZAKAZKA` |
| Blok | `specifikace` | text |
| DATA | `dataStatusId` | hodnota z číselníku |
| DATA | `dataRequiredDate` | relativní offset proti dnešku |
| MATERIÁL | `materialStatusId` | hodnota z číselníku |
| MATERIÁL | `materialRequiredDate` | relativní offset proti dnešku |
| MATERIÁL | `materialInStock` | `true/false`, pokud `true`, datum materiálu se nevyplňuje |
| PANTONE | `pantoneRequiredDate` | relativní offset proti dnešku |
| BARVY | `barvyStatusId` | hodnota z číselníku |
| LAK | `lakStatusId` | hodnota z číselníku |
| Termín | `deadlineExpedice` | relativní offset proti dnešku |

Preset v této vlně **nesmí** předvyplňovat:

- `orderNumber`
- `description`
- `durationHours`
- `type`
- `recurrenceType`
- `recurrenceCount`
- `locked`
- `dataOk`
- `materialOk`
- `pantoneOk`
- `materialNote`
- tiskové potvrzení

Důvod:

- tato pole jsou buď operační stav, nebo konkrétní data zakázky, ne template.

---

## Datový model

### Nový model `JobPreset`

Preferovaný směr je explicitní schema, ne obecný JSON blob.

Důvody:

- současný projekt pracuje hlavně s explicitními poli,
- je to čitelnější pro API i Prisma migrace,
- u první verze to snižuje riziko nevalidních payloadů.

Navržený model:

```prisma
model JobPreset {
  id                           Int      @id @default(autoincrement())
  name                         String
  isSystemPreset               Boolean  @default(false)
  isActive                     Boolean  @default(true)
  sortOrder                    Int      @default(0)
  appliesToZakazka             Boolean  @default(true)
  appliesToRezervace           Boolean  @default(true)
  machineConstraint            String?
  blockVariant                 String?
  specifikace                  String?  @db.Text
  dataStatusId                 Int?
  dataRequiredDateOffsetDays   Int?
  materialStatusId             Int?
  materialRequiredDateOffsetDays Int?
  materialInStock              Boolean?
  pantoneRequiredDateOffsetDays Int?
  barvyStatusId                Int?
  lakStatusId                  Int?
  deadlineExpediceOffsetDays   Int?
  createdAt                    DateTime @default(now())
  updatedAt                    DateTime @default(now()) @updatedAt

  @@index([isActive, sortOrder])
}
```

Poznámky:

- `null` u pole znamená `preset toto pole neřídí`,
- offset `0` znamená `dnes`,
- `machineConstraint` používá stejné hodnoty jako bloky: `XL_105`, `XL_106`,
- v této vlně není potřeba zakládat další child tabulky.

### Rozšíření modelu `Block`

Do `Block` přidej:

```prisma
jobPresetId    Int?
jobPresetLabel String?
```

Pravidla:

- `jobPresetId` je logická reference, ne tvrdý FK,
- `jobPresetLabel` je snapshot názvu v době použití presetu,
- pokud se preset později přejmenuje nebo smaže, historický blok zůstane čitelný.

Doporučení:

- přidej index na `jobPresetId` jen pokud se bude hodit pro budoucí reporty,
- jinak není nutný.

### Důsledky pro split a série

`jobPresetId` a `jobPresetLabel` se mají chovat jako sdílené metadata:

- přidej je do `SPLIT_SHARED_FIELDS`,
- při změně presetu na jedné části splitu se mají propsat do celé split skupiny,
- série používá dnešní dialog `jen instance / celá série`.

---

## API

### Nové endpoints pro presety

Navrhni samostatnou API vrstvu:

- `GET /api/job-presets`
- `POST /api/job-presets`
- `GET /api/job-presets/[id]`
- `PUT /api/job-presets/[id]`
- `DELETE /api/job-presets/[id]`

### Role

- `GET`: všichni přihlášení uživatelé
- write operace: `ADMIN`, `PLANOVAT`

Poznámka:

- read může být širší kvůli budoucímu reuse v rezervačním centru,
- write zůstává jen pro role, které dnes pracují s builderem a správou.

### `GET /api/job-presets`

Podporované query parametry:

- `includeInactive=true`
- `type=ZAKAZKA|REZERVACE`
- `quick=true` pro rychlý seznam aktivních presetů do builderu

Pravidla:

- `quick=true` vrací aktivní presety seřazené podle `sortOrder`,
- systémové presety mají být na začátku.

### `POST / PUT`

Server musí validovat:

- název,
- povolené typy,
- systémovost,
- strojové omezení,
- konzistenci `blockVariant`,
- konzistenci `materialInStock`,
- že odkazované číselníkové položky existují a patří do správné kategorie.

### `DELETE`

- lze smazat pouze vlastní preset,
- systémový preset musí vracet `409` nebo `400` s jasnou hláškou,
- mazání potvrzovat v UI.

### Změny stávajícího block API

`POST /api/blocks` i `PUT /api/blocks/[id]` musí přijímat a vracet:

- `jobPresetId`
- `jobPresetLabel`

### Server-side pravidla

- pokud `type === "UDRZBA"`, normalizuj preset pole na `null`,
- pokud `jobPresetId` odkazuje na existující preset a preset má `machineConstraint`, validuj kompatibilitu stroje,
- pokud preset existuje a není povolen pro výsledný `type`, vrať validační chybu,
- pokud preset už neexistuje, ale blok nese snapshot label z minulosti, uložení nesmí selhat jen kvůli tomu.

---

## Integrace do existujících flow

### PlannerPage

Nutné dopady:

- doplnit builder state o preset metadata,
- doplnit `QueueItem`,
- doplnit `handleAddToQueue`,
- doplnit `handleScheduleSeries`,
- doplnit `handleQueueDrop`,
- doplnit `handlePaste` a `handleGroupPaste`,
- doplnit `handleBlockUpdate`,
- rozšířit search o `jobPresetLabel`.

### BlockEdit

- doplnit preset state,
- doplnit save payload,
- doplnit reset/normalizaci pro `UDRZBA`,
- rozšířit split shared fields.

### TimelineGrid

- doplnit typ `Block`,
- doplnit podmíněné zobrazení preset chipu,
- nezhoršit čitelnost stávajících badge řádků.

### page.tsx a serializace

- doplnit nová pole do initial serialization,
- pohlídat, aby se neztratila při mapování `Block -> serialized`.

### Report / Tiskař

- typy rozšířit tak, aby nové DB pole nezpůsobilo drift nebo typový rozpad,
- vizuální změny v těchto view nejsou povinné v této vlně.

### Audit

Do auditovaných polí přidej:

- `jobPresetLabel`

Cíl:

- při použití nebo změně presetu musí být v auditu jasně vidět, že se preset změnil.

---

## Vztah k číselníkům

Preset používá živé číselníky jako zdroj hodnot.

Pravidla:

- preset ukládá ID položky číselníku,
- při aplikaci presetu do bloku se snapshot label bere z aktuální číselníkové hodnoty,
- server musí při ukládání presetu ověřit kategorii:
  - `dataStatusId` jen `DATA`
  - `materialStatusId` jen `MATERIAL`
  - `barvyStatusId` jen `BARVY`
  - `lakStatusId` jen `LAK`

Mazání číselníku:

- pokud aktivní preset používá konkrétní `CodebookOption`, pokus o smazání má být blokovaný srozumitelnou chybou,
- UI ve správě číselníků má ukázat, že položka je používána presetem/presety.

Tohle je záměrná odchylka od bloků:

- bloky jsou historie a mají snapshot label,
- presety jsou živá konfigurace a nesmí tiše odkazovat na neplatná data.

---

## Sdílené helpery a technická doporučení

Nevytvářej preset logiku rozkopírovanou ve třech komponentách. Přidej shared helpery:

- `applyPresetToDraft(...)`
- `summarizePreset(...)`
- `resolvePresetDateOffset(...)`
- případně `validatePresetCompatibility(...)`

Požadavky:

- datumové offsety počítej v `Europe/Prague`,
- nepoužívej nativní `<input type="date">`,
- reuse existující `DatePickerField`,
- zachovej iOS/Apple styl aplikace.

---

## Akceptační scénáře

Implementace je hotová teprve tehdy, když fungují tyto scénáře:

1. V builderu zvolím `ZAKAZKA` a vidím sekci presetů mezi `Typ záznamu` a `Stav zakázky`.
2. V builderu zvolím `REZERVACE` a sekce presetů je viditelná.
3. V builderu zvolím `UDRZBA` a preset se neschová jen vizuálně, ale neuloží se do bloku.
4. Klik na `XL 105` okamžitě předvyplní nakonfigurovaná pole.
5. Přepnutí na jiný preset nad již vyplněným builderem zobrazí potvrzení přepisu.
6. `Zrušit preset` nevymaže už předvyplněná pole.
7. Přidání do fronty zachová preset metadata.
8. Drop z fronty vytvoří blok se `jobPresetId` + `jobPresetLabel`.
9. Série vytvořená přes `Naplánovat sérii` uloží preset na všechny instance.
10. Editace existující zakázky dovolí preset změnit a uložit.
11. Preset se zobrazí v detailu bloku.
12. Preset je dohledatelný přes vyhledávání v planneru.
13. Splitovaná zakázka po změně presetu drží preset konzistentně na všech částech.
14. Audit log ukáže změnu presetu.
15. `PLANOVAT` vidí v `/admin` záložku `Presety` a může ji editovat.
16. `ADMIN` vidí `Presety` vedle ostatních tabů.
17. Systémové presety nelze smazat.
18. Vlastní preset lze vytvořit, editovat, deaktivovat a smazat.
19. Při pokusu smazat číselníkovou položku používanou aktivním presetem vrátí API jasnou chybu.
20. Drop bloku s presetem `XL 106 LED` na `XL_105` je zablokovaný, pokud zůstane potvrzené tvrdé strojové omezení.

---

## Otevřené body a body k potvrzení

Claude Code se má před implementací doptat, pokud nebude potvrzen některý z bodů níže:

1. **Tvrdé vs. měkké strojové omezení**
   - Tato specifikace předpokládá tvrdé omezení podle názvu presetů.
   - Pokud má být vazba na stroj jen doporučená, musí se scope upravit.

2. **Rozsah datumových pravidel**
   - Tato vlna počítá jen s `dnes + N dní`.
   - Pokud mají být datumy vztahované k termínu tisku, expedici nebo jiné referenci, je to nová pod-vlna a je potřeba doptání.

3. **Výchozí obsah tří systémových presetů**
   - Aktuálně není definovaný.
   - Implementace má seednout bezpečný skeleton a umožnit plánovači obsah doplnit v UI.

4. **Vizibilita presetu v timeline**
   - Cílem je jemný chip bez ztráty čitelnosti.
   - Pokud by při implementaci vznikl konflikt s prostorem v kartě, prioritou je detail bloku a builder, ne agresivní nacpání dalšího řádku.

---

## Pokyny pro Claude Code

Při implementaci:

- nejdřív si projdi aktuální builder, block edit, admin dashboard a block API,
- použij subagenty paralelně,
- drž se explicitního schema-first přístupu,
- nerozbíjej stávající queue, split, recurrence a audit flow,
- nerefaktoruj polovinu planneru jen kvůli presetům,
- ptej se při nejistotě, hlavně u strojového omezení a datumových pravidel.

Na konci implementace:

- aktualizuj `CLAUDE.md`,
- aktualizuj `PLAN.md`,
- podle potřeby doplň relevantní části `DOKUMENTACE.md`,
- napiš, co bylo implementováno, co bylo otestováno a jaké zůstaly otevřené body.
