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

Tato vlna navazuje na současnou planner aplikaci postavenou nad Next.js, React, TypeScript, Prisma a MySQL. Zaměřuje se na přesnější plánování opakovaných zakázek, rozšíření sdíleného chování split skupin, upravený model pracovní doby, nové výrobní sloupečky, změnu pravidel kolem potvrzení tisku a nový workflow rezervací mezi obchodem a plánovačem.

| ID | Oblast | Změna | Stav |
|----|--------|-------|------|
| 1 | Opakování a série | Preview všech výskytů + ruční editace termínů jednotlivých opakování | ✅ Hotovo |
| 2 | Splitované zakázky | Propagace `type` a `blockVariant` mezi všemi částmi splitu | ✅ Hotovo |
| 3 | Role a oprávnění | `PLANOVAT` dostane omezený přístup do `/admin` | ✅ Hotovo |
| 4 | Pracovní doba strojů | Periodické šablony s platností `od-do` | ✅ Hotovo |
| 5 | Výrobní sloupečky | Nový sloupec `Pantone` s datem a `OK` | ✅ Hotovo |
| 6 | Výrobní sloupečky | `Materiál = SKLADEM` jako dedikovaný režim místo data | ✅ Hotovo |
| 7 | Potvrzení tisku | Zrušení automatického `PRINT_RESET` při přesunu bloku | ✅ Hotovo |
| 8 | Context menu zakázky | Submenu `Stav zakázky` v pravém kliknutí na blok | ✅ Hotovo |
| 9 | Role a oprávnění | Nová role `OBCHODNIK` s viewer-like plannerem a přístupem do rezervací | ⬜ Nezačato |
| 10 | Rezervace | Samostatné centrum rezervací pro obchod a plánovače | ⬜ Nezačato |
| 11 | Notifikace | Přímé notifikace mezi plánovačem a konkrétním obchodníkem | ⬜ Nezačato |
| 12 | Přílohy | Volitelné přílohy k rezervaci | ⬜ Nezačato |

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

## Rezervace a role obchodník

### Účel

Současný proces rezervací běží mimo planner v jiném softwaru. Nově se má přesunout přímo do této aplikace tak, aby:

- obchodník založil žádost o rezervaci,
- plánovač ji přijal nebo zamítl,
- přijatá rezervace se doplnila o plánovací metadata,
- následně se propsala do fronty planneru,
- po skutečném vložení na timeline vznikl blok typu `REZERVACE`,
- obchodník dostal zpětnou informaci do vlastního zvonečku.

Rezervace je v této vlně samostatný business objekt předcházející bloku v planneru. Není to jen dočasný lokální queue item.

### Role `OBCHODNIK`

- Zavést novou roli `OBCHODNIK`.
- Na planneru má mít stejný read-only přístup jako dnešní `VIEWER`.
- `OBCHODNIK`:
  - vidí hlavní planner timeline,
  - nevidí Job Builder aside,
  - nemůže drag & drop, resize, split, editaci detailu, mazání ani potvrzení tisku,
  - nemá přístup do `/admin`,
  - v headeru navíc vidí CTA `Rezervace`,
  - má přístup na novou stránku `/rezervace`,
  - v modulu rezervací vidí pouze své vlastní rezervace a své vlastní přímé notifikace.
- `PLANOVAT` a `ADMIN` mají do modulu rezervací přístup také.
- `DTP`, `MTZ`, `TISKAR` a `VIEWER` do modulu rezervací přístup nemají.

### Informační architektura modulu

- Modul rezervací má být samostatná stránka `/rezervace`, ne další přetížený panel v pravém aside planneru.
- V headeru planneru i na stránce `/rezervace` má být jasně viditelné tlačítko nebo záložka `Rezervace`.
- CTA `Rezervace` má mít badge pro:
  - `PLANOVAT`, `ADMIN`: počet `SUBMITTED` rezervací.
- Pro `OBCHODNIK` se nepoužívá samostatný badge na CTA `Rezervace` jako notifikační zdroj pravdy.
- Nepřečtené přímé notifikace obchodníka se zobrazují ve zvonečku.
- UI má držet současný vizuální jazyk aplikace:
  - horní toolbar,
  - iOS-like segmented přepínače,
  - jednoduché karty/listy,
  - jeden jasný primární CTA směr,
  - minimum vrstev modálních dialogů.
- Pro `OBCHODNIK` zobrazit 3 hlavní dashboardy:
  - `Nová žádost`
  - `Moje aktivní`
  - `Archiv`
- Pro `PLANOVAT` a `ADMIN` zobrazit 3 hlavní dashboardy:
  - `Nové žádosti`
  - `K naplánování`
  - `Archiv`

### Kód rezervace

- Každá rezervace po prvním úspěšném odeslání dostane jedinečný kód ve formátu:
  - `R4609`
- Formát znamená:
  - prefix `R`,
  - bez mezer,
  - bez lomítek,
  - bez nulování na fixní délku.
- Kód rezervace je hlavní uživatelské identifikační číslo rezervace napříč celým systémem.
- Kód je:
  - immutable,
  - unique,
  - zobrazený v seznamu, detailu, archivní historii, notifikacích i na výsledném bloku.
- Doporučené pravidlo implementace:
  - kód vzniká serverově z vytvořeného DB `id` rezervace,
  - tj. po vytvoření záznamu s `id = 4609` se uloží `code = "R4609"`.

### Stavový model rezervace

Použij tento explicitní stavový model:

- `SUBMITTED`
  - obchodník odeslal žádost,
  - čeká na první rozhodnutí plánovače,
  - pro plánovače patří do dashboardu `Nové žádosti`.
- `ACCEPTED`
  - plánovač potvrdil, že rezervaci chce dále připravit,
  - ještě není ve frontě timeline,
  - patří do dashboardu `K naplánování`.
- `QUEUE_READY`
  - plánovač doplnil plánovací data a rezervace je připravena do planner fronty,
  - ještě neexistuje reálný blok na timeline,
  - patří do dashboardu `K naplánování`.
- `SCHEDULED`
  - z rezervace byl skutečně vytvořen blok na timeline,
  - patří do archivu.
- `REJECTED`
  - plánovač rezervaci odmítl,
  - má povinný důvod odmítnutí,
  - patří do archivu.

Archiv je v této vlně odvozený pohled nad finálními stavy `SCHEDULED` a `REJECTED`, nikoli samostatný status.

### Obchodník — vytvoření žádosti

Obchodník při založení rezervace vyplňuje tato pole:

- `companyName`
  - povinné,
  - název firmy / klienta.
- `erpOfferNumber`
  - povinné,
  - číslo nabídky z ERP systému.
- `requestedExpeditionDate`
  - povinné,
  - požadovaný termín expedice do.
- `requestedDataDate`
  - povinné,
  - požadovaný termín dodání dat do.
- `requestText`
  - nepovinné,
  - volný text / zadání / obchodní poznámka.
- `attachments`
  - nepovinné,
  - přílohy k rezervaci.

Pravidla:

- Odeslání rezervace je explicitní akce `Požádat o rezervaci`.
- Teprve při této akci vznikne DB záznam a kód rezervace.
- V této vlně není potřeba ukládat rozpracovaný draft rezervace průběžně na server.
- Pokud je `requestedDataDate > requestedExpeditionDate`, UI má zobrazit varování, ale nemusí to být hard stop.
- Po úspěšném odeslání:
  - zobrazit success stav s kódem rezervace,
  - přesunout uživatele do detailu nebo seznamu `Moje aktivní`.

### Plánovač — zpracování žádosti

Plánovač v dashboardu `Nové žádosti` vidí pro každou rezervaci minimálně:

- kód rezervace,
- firmu,
- ERP číslo nabídky,
- termín expedice,
- termín dodání dat,
- jméno obchodníka,
- datum vytvoření,
- stav příloh.

Na rezervaci musí mít dvě hlavní akce:

- `Přijmout`
- `Nelze zařadit`

Pravidla zamítnutí:

- Zamítnutí musí vždy vyžadovat textový důvod.
- Důvod se uloží do rezervace a zároveň se pošle obchodníkovi do notifikace.
- Po zamítnutí se stav nastaví na `REJECTED`.

Pravidla přijetí:

- Přijetí nastaví stav `ACCEPTED`.
- Po přijetí se otevře rezervační plánovací formulář.
- Rezervace se tím ještě nesmí sama vložit na timeline.

### Rezervační plánovací formulář

Po akci `Přijmout` se musí otevřít formulář nebo sheet navazující na logiku současného Job Builderu, ale se zjednodušeným a přesně řízeným chováním.

Formulář má mít:

- read-only část:
  - kód rezervace,
  - firma,
  - ERP číslo nabídky,
  - požadovaný termín expedice,
  - požadovaný termín dodání dat,
  - původní text obchodníka,
  - seznam příloh.
- editovatelnou plánovací část:
  - `description`
  - `durationHours`
  - `deadlineExpedice`
  - `dataStatusId`
  - `dataStatusLabel`
  - `dataRequiredDate`
  - `materialStatusId`
  - `materialStatusLabel`
  - `materialRequiredDate`
  - `materialInStock`
  - `pantoneRequiredDate`
  - `pantoneOk`
  - `barvyStatusId`
  - `barvyStatusLabel`
  - `lakStatusId`
  - `lakStatusLabel`
  - `specifikace`

Další pravidla:

- `description` se při otevření formuláře předvyplní z `companyName`.
- `type` je pro rezervaci vždy natvrdo `REZERVACE`.
- `orderNumber` je pro výsledný blok vždy natvrdo kód rezervace.
- Opakování (`recurrenceType`) se v této vlně pro rezervace neřeší.
- Split chování se v této vlně pro rezervace neřeší.
- Formulář v této vlně neřeší konkrétní stroj ani konkrétní čas startu.
- Výsledkem formuláře není přímé vytvoření bloku, ale persistentní příprava do planner fronty.

### Připravení rezervace do planner fronty

Po potvrzení plánovacího formuláře:

- se plánovací payload uloží serverově do rezervace,
- stav přejde na `QUEUE_READY`,
- planner musí po návratu na hlavní stránku `/` vidět připravenou rezervaci ve frontě builderu.

Kritické pravidlo:

- rezervace připravená do fronty nesmí existovat jen v lokálním `useState` queue planneru,
- musí přežít reload stránky, odhlášení i otevření v jiné relaci plánovače.

Praktický důsledek:

- data připravené rezervace musí být persistována v DB,
- planner home page při načtení musí vedle bloků načíst i rezervace ve stavu `QUEUE_READY`,
- klient z nich musí vytvořit queue karty obdobné dnešní frontě.

Queue karta rezervace musí být vizuálně odlišena:

- badge `Rezervace`,
- kód rezervace jako hlavní identifikátor,
- firma jako sekundární text,
- případně ERP číslo nabídky jako doplňkový údaj.

### Vložení rezervace na timeline

Když plánovač přetáhne queue kartu rezervace na timeline:

- výsledkem musí být vytvoření bloku typu `REZERVACE`,
- `orderNumber` bloku musí být kód rezervace,
- blok musí nést vazbu na source rezervaci,
- po úspěšném vytvoření se rezervace musí přepnout do stavu `SCHEDULED`,
- do rezervace se musí uložit:
  - `scheduledBlockId`,
  - `scheduledMachine`,
  - `scheduledStartTime`,
  - `scheduledEndTime`,
  - `scheduledAt`.

Další pravidla:

- pokud drop selže nebo `POST /api/blocks` skončí chybou, rezervace musí zůstat `QUEUE_READY`,
- pokud vytvoření bloku uspěje, queue karta rezervace musí zmizet z fronty,
- blok vzniklý z rezervace musí v detailu umět zobrazit odkaz zpět na rezervaci.

### Archiv a dohledatelnost

Archiv rezervací musí být přístupný:

- obchodníkovi pro jeho vlastní rezervace,
- plánovači a adminovi pro všechny rezervace.

Archivní záznam musí být dohledatelný podle:

- kódu rezervace,
- firmy,
- ERP čísla nabídky,
- obchodníka.

Archivní detail musí minimálně zobrazit:

- všechny původní vstupní údaje žádosti,
- přílohy,
- konečný stav,
- kdo rozhodl,
- kdy rozhodl,
- důvod zamítnutí nebo výsledné naplánování,
- odkaz na související blok, pokud je stav `SCHEDULED`.

Pravidlo pro tuto vlnu:

- zamítnutá rezervace se v této vlně znovu neotevírá a neupravuje,
- pokud bude potřeba požadavek podat znovu, založí se nová rezervace.

### Notifikace rezervací

Rezervační flow musí používat přímé notifikace na konkrétního uživatele, ne jen notifikace cílené na roli.

Obchodník musí dostat notifikaci minimálně v těchto situacích:

- plánovač rezervaci zamítne,
- rezervace je skutečně zařazena do plánu,
- plánovač ručně použije akci `Upozornit obchod`.

Obsah notifikace při zařazení do plánu má obsahovat minimálně:

- kód rezervace,
- stroj,
- datum,
- čas.

Další pravidla:

- `OBCHODNIK` musí mít v headeru zvoneček analogický dnešnímu inbox panelu pro `DTP` a `MTZ`,
- notifikace musí po kliknutí otevřít detail rezervace nebo příslušný blok,
- stávající DTP/MTZ notifikace musí zůstat funkční,
- plánovač má mít badge nových rezervací na CTA `Rezervace`.

### Přílohy

Rezervace v této vlně mají podporovat nepovinné přílohy.

Podporované chování:

- nahrání příloh při založení rezervace,
- zobrazení seznamu příloh v detailu rezervace,
- stažení přílohy,
- smazání přílohy před finálním uzavřením rezervace.

Doporučené limity první verze:

- max 5 příloh na jednu rezervaci,
- max 10 MB na soubor,
- povolené typy:
  - PDF
  - DOC
  - DOCX
  - XLS
  - XLSX
  - PNG
  - JPG
  - JPEG

Pravidla ukládání:

- binární data příloh se nemají ukládat do DB jako blob,
- do DB se ukládají metadata,
- samotné soubory se ukládají na filesystem mimo git-tracked část repa,
- doporučený storage root je `data/reservation-attachments/`,
- tento storage root musí být v `.gitignore`,
- storage path musí být deterministická a odvozená od rezervace.

### Mimo scope této vlny

- editace již odeslané rezervace obchodníkem,
- reopen nebo resubmit zamítnuté rezervace,
- automatická synchronizace do ERP,
- e-mailové nebo SMS notifikace,
- opakované rezervace,
- splitování rezervací do více bloků.

---

## DB změny

### User

Model `User` se rozšíří v rovině povolených rolí o:

- `OBCHODNIK`

### Block

Model `Block` se rozšíří minimálně o tato pole:

```prisma
reservationId       Int?
pantoneRequiredDate DateTime?
pantoneOk           Boolean   @default(false)
materialInStock     Boolean   @default(false)
```

### Poznámky k poli `Block`

- `reservationId` je nullable vazba na source rezervaci.
- Blok vzniklý z rezervace musí mít:
  - `type = REZERVACE`
  - `orderNumber = reservation.code`
- `pantoneRequiredDate` je samostatný datumový sloupec, není to codebook label.
- `pantoneOk` přepíná zobrazení hodnoty na `OK`.
- `materialInStock` je dedikovaný boolean pro režim `SKLADEM`.

### Reservation

Zavést nový model `Reservation`:

```prisma
model Reservation {
  id                      Int      @id @default(autoincrement())
  code                    String   @unique
  status                  String
  companyName             String
  erpOfferNumber          String
  requestedExpeditionDate DateTime
  requestedDataDate       DateTime
  requestText             String?  @db.Text
  requestedByUserId       Int
  requestedByUsername     String
  plannerUserId           Int?
  plannerUsername         String?
  plannerDecisionReason   String?  @db.Text
  planningPayload         Json?
  preparedAt              DateTime?
  scheduledBlockId        Int?
  scheduledMachine        String?
  scheduledStartTime      DateTime?
  scheduledEndTime        DateTime?
  scheduledAt             DateTime?
  createdAt               DateTime @default(now())
  updatedAt               DateTime @default(now()) @updatedAt
  attachments             ReservationAttachment[]
  blocks                  Block[]

  @@index([status, createdAt])
  @@index([requestedByUserId, status, createdAt])
  @@index([erpOfferNumber])
}
```

Poznámky:

- `code` se generuje serverově po vytvoření záznamu ve formátu `R{id}`.
- `planningPayload` je persistentní snapshot dat potřebných pro queue kartu a následné vytvoření bloku.
- `planningPayload` v této vlně nesmí obsahovat konkrétní `machine`, `startTime` ani `endTime`.

### ReservationAttachment

Zavést nový model `ReservationAttachment`:

```prisma
model ReservationAttachment {
  id                 Int      @id @default(autoincrement())
  reservationId      Int
  originalName       String
  storageKey         String   @unique
  mimeType           String
  sizeBytes          Int
  uploadedByUserId   Int
  uploadedByUsername String
  createdAt          DateTime @default(now())
  reservation        Reservation @relation(fields: [reservationId], references: [id], onDelete: Cascade)

  @@index([reservationId, createdAt])
}
```

### Notification

Stávající model `Notification` je potřeba rozšířit tak, aby kromě notifikací cílených na roli uměl i přímé notifikace konkrétnímu uživateli.

Minimální cílový shape:

```prisma
model Notification {
  id                Int      @id @default(autoincrement())
  type              String
  message           String
  targetRole        String?
  targetUserId      Int?
  reservationId     Int?
  blockId           Int?
  blockOrderNumber  String?
  createdByUserId   Int
  createdByUsername String
  isRead            Boolean  @default(false)
  readAt            DateTime?
  createdAt         DateTime @default(now())

  @@index([targetRole, isRead, createdAt])
  @@index([targetUserId, isRead, createdAt])
  @@index([reservationId, createdAt])
  @@index([blockId, createdAt])
}
```

Pravidla:

- roli cílené DTP/MTZ notifikace musí dál fungovat,
- obchodnické notifikace musí používat `targetUserId`,
- `blockId` už nesmí být povinné, protože notifikace může vzniknout ještě před vytvořením bloku.

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
  - `reservationId`
  - `pantoneRequiredDate`
  - `pantoneOk`
  - `materialInStock`
- Pro opakovanou sérii se builder v této vlně může opřít o opakované volání `POST /api/blocks` bez nového specializovaného series endpointu.
- Pokud request obsahuje `reservationId`, server musí:
  - načíst rezervaci,
  - ověřit stav `QUEUE_READY`,
  - vynutit `type = REZERVACE`,
  - vynutit `orderNumber = reservation.code`,
  - vynutit `recurrenceType = NONE`,
  - uložit vazbu `reservationId` do vytvořeného bloku,
  - po úspěšném vytvoření bloku přepnout rezervaci do stavu `SCHEDULED`,
  - uložit plánovací metadata (`scheduledBlockId`, `scheduledMachine`, `scheduledStartTime`, `scheduledEndTime`, `scheduledAt`),
  - vytvořit přímou notifikaci pro obchodníka.

### `/api/blocks/[id]`

#### PUT

- Přidat podporu polí:
  - `reservationId`
  - `pantoneRequiredDate`
  - `pantoneOk`
  - `materialInStock`
- Rozšířit split propagaci o nová sdílená pole včetně `type` a `blockVariant`.
- Přestat nulovat print completion při změně `startTime`, `endTime` nebo `machine`.
- Pokud se `type` změní pryč od `ZAKAZKA`, vyčistit print completion a normalizovat `blockVariant`.
- Pokud blok už má `reservationId`, nesmí běžná editace tuto vazbu svévolně odpojit.

### `/api/blocks/batch`

- Přestat používat automatický `PRINT_RESET`.
- Zachovat validaci provozní doby, ale nad novým resolved modelem šablon + exceptions.

### `/api/reservations`

#### GET

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
  - `OBCHODNIK`
- Query params:

```ts
{
  bucket: "new" | "active" | "archive",
  q?: string
}
```

- Význam bucketů:
  - pro `PLANOVAT`, `ADMIN`:
    - `new` = `SUBMITTED`
    - `active` = `ACCEPTED`, `QUEUE_READY`
    - `archive` = `SCHEDULED`, `REJECTED`
  - pro `OBCHODNIK`:
    - `active` = moje `SUBMITTED`, `ACCEPTED`, `QUEUE_READY`
    - `archive` = moje `SCHEDULED`, `REJECTED`
- `OBCHODNIK` smí dostat jen své vlastní rezervace.
- Vyhledávání `q` musí filtrovat minimálně přes:
  - `code`
  - `companyName`
  - `erpOfferNumber`
  - `requestedByUsername`

#### POST

- Přístup:
  - `ADMIN`
  - `OBCHODNIK`
- Body:

```ts
{
  companyName: string,
  erpOfferNumber: string,
  requestedExpeditionDate: string, // YYYY-MM-DD
  requestedDataDate: string,       // YYYY-MM-DD
  requestText?: string | null
}
```

- Server v rámci vytvoření:
  - založí rezervaci se stavem `SUBMITTED`,
  - doplní `requestedByUserId` a `requestedByUsername` ze session,
  - vygeneruje `code` ve formátu `R{id}`.

### `/api/reservations/[id]`

#### GET

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
  - `OBCHODNIK` pouze pokud je creator rezervace
- Response musí vracet:
  - detail rezervace,
  - seznam příloh,
  - summary navázaného bloku, pokud existuje.

### `/api/reservations/[id]/accept`

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
- Body:

```ts
{}
```

- Povolený zdrojový stav:
  - `SUBMITTED`
- Výsledek:
  - nastaví `status = ACCEPTED`,
  - uloží `plannerUserId` a `plannerUsername`.

### `/api/reservations/[id]/reject`

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
- Body:

```ts
{
  reason: string
}
```

- Povolené zdrojové stavy:
  - `SUBMITTED`
  - `ACCEPTED`
  - `QUEUE_READY`
- Výsledek:
  - nastaví `status = REJECTED`,
  - uloží `plannerUserId`, `plannerUsername`, `plannerDecisionReason`,
  - pokud byla rezervace `QUEUE_READY`, zruší její pending queue stav,
  - vytvoří přímou notifikaci pro obchodníka.

### `/api/reservations/[id]/prepare`

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
- Povolený zdrojový stav:
  - `ACCEPTED`
- Body:

```ts
{
  description?: string | null,
  durationHours: number,
  deadlineExpedice: string | null,
  dataStatusId: number | null,
  dataStatusLabel: string | null,
  dataRequiredDate: string | null,
  materialStatusId: number | null,
  materialStatusLabel: string | null,
  materialRequiredDate: string | null,
  materialInStock: boolean,
  pantoneRequiredDate: string | null,
  pantoneOk: boolean,
  barvyStatusId: number | null,
  barvyStatusLabel: string | null,
  lakStatusId: number | null,
  lakStatusLabel: string | null,
  specifikace: string | null
}
```

- Server musí:
  - validovat povinné položky jako délku tisku,
  - vynutit výsledný `type = REZERVACE`,
  - neumožnit recurrence pole,
  - uložit payload do `planningPayload`,
  - nastavit `status = QUEUE_READY`,
  - vyplnit `preparedAt`.

### `/api/reservations/[id]/attachments`

#### POST

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
  - `OBCHODNIK` pouze pokud je creator rezervace
- Povolené zdrojové stavy:
  - `SUBMITTED`
  - `ACCEPTED`
- Request:
  - `multipart/form-data`
  - jeden soubor na request
- Server musí validovat typ souboru a velikost.

### `/api/reservations/[id]/attachments/[attachmentId]`

#### GET

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
  - `OBCHODNIK` pouze pokud je creator rezervace
- Vrací stream nebo download response souboru.

#### DELETE

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
  - `OBCHODNIK` pouze pokud je creator rezervace
- Povolené zdrojové stavy:
  - `SUBMITTED`
  - `ACCEPTED`

### `/api/reservations/[id]/notify-requester`

- Přístup:
  - `ADMIN`
  - `PLANOVAT`
- Slouží pro manuální akci `Upozornit obchod`.
- Body:

```ts
{
  message?: string | null
}
```

- Pokud `message` není poslána, server vytvoří defaultní text z rezervace a případně navázaného bloku.

### `/api/codebook`

- `GET` zůstává beze změny.
- `POST`, `PUT`, `DELETE` nově povoleno pro:
  - `ADMIN`
  - `PLANOVAT`

### Audit

Audit musí nově logovat změny polí:

- `reservationId`
- `pantoneRequiredDate`
- `pantoneOk`
- `materialInStock`

Audit už nemá vytvářet automatickou akci `PRINT_RESET` při move flow.

Rezervace mají mít vlastní auditovatelnou historii změn minimálně v těchto momentech:

- vytvoření rezervace,
- přijetí rezervace,
- zamítnutí rezervace,
- příprava do queue,
- skutečné naplánování na timeline.

---

## Matice oprávnění

### UI akce

| Akce | ADMIN | PLANOVAT | DTP | MTZ | TISKAR | VIEWER | OBCHODNIK |
|------|-------|----------|-----|-----|--------|--------|-----------|
| Vidět planner | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Vidět `/admin` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Uživatelé` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Číselníky` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Pracovní doba` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vidět tab `Audit log` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vidět `/rezervace` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Vidět vlastní rezervace | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Vidět všechny rezervace | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vytvořit žádost o rezervaci | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Přijmout / zamítnout rezervaci | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Připravit rezervaci do fronty | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Vidět přílohy rezervace | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Nahrávat / mazat přílohy rezervace | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Editovat DATA | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editovat MATERIÁL | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Editovat Pantone | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Přepnout `Materiál = SKLADEM` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Měnit stav zakázky přes context menu | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Označit / vrátit `Hotovo` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Upozornit obchod z bloku rezervace | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### API endpointy

| Endpoint | ADMIN | PLANOVAT | DTP | MTZ | TISKAR | VIEWER | OBCHODNIK |
|----------|-------|----------|-----|-----|--------|--------|-----------|
| `GET /api/machine-shifts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/machine-shifts` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `PUT /api/machine-shifts/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `DELETE /api/machine-shifts/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/codebook` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/codebook` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `PUT /api/codebook/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `DELETE /api/codebook/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/admin/users*` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/audit` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/reservations` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `POST /api/reservations` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `GET /api/reservations/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `POST /api/reservations/[id]/accept` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/reservations/[id]/reject` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/reservations/[id]/prepare` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/reservations/[id]/attachments` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `GET /api/reservations/[id]/attachments/[attachmentId]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `DELETE /api/reservations/[id]/attachments/[attachmentId]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `POST /api/reservations/[id]/notify-requester` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/notifications` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `PATCH /api/notifications/[id]/read` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |

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

10. **Obchodník založí rezervaci**
   - Přihlásit se jako `OBCHODNIK`.
   - Otevřít `/rezervace` a založit novou žádost s firmou, ERP číslem, termínem expedice, termínem dat a textem.
   - Ověřit, že po odeslání vznikl kód ve formátu `R4609`.
   - Ověřit, že rezervace spadla do `Moje aktivní` se stavem `SUBMITTED`.

11. **Plánovač zamítne rezervaci**
   - Přihlásit se jako `PLANOVAT`.
   - Otevřít dashboard `Nové žádosti`.
   - Zamítnout rezervaci s textovým důvodem.
   - Ověřit stav `REJECTED`, přesun do archivu a přímou notifikaci obchodníkovi.

12. **Plánovač připraví rezervaci do fronty**
   - Přihlásit se jako `PLANOVAT`.
   - Přijmout rezervaci.
   - Vyplnit rezervační plánovací formulář.
   - Potvrdit přípravu do fronty.
   - Ověřit stav `QUEUE_READY`.
   - Obnovit stránku `/` a ověřit, že queue karta rezervace nezmizela.

13. **Vložení rezervace na timeline**
   - Přetáhnout queue kartu rezervace na timeline.
   - Ověřit vznik bloku:
     - `type = REZERVACE`
     - `orderNumber = code rezervace`
   - Ověřit, že rezervace přešla do `SCHEDULED`.
   - Ověřit uložení `scheduledBlockId`, stroje a času.

14. **Obchodník dostane informaci o naplánování**
   - Po úspěšném dropu rezervace na timeline přihlásit obchodníka.
   - Ověřit notifikaci ve zvonečku.
   - Ověřit, že notifikace obsahuje kód rezervace, datum, čas a stroj.

15. **Archiv rezervací**
   - Otevřít archiv jako `PLANOVAT`.
   - Dohledat rezervaci podle kódu, firmy i ERP čísla nabídky.
   - Ověřit zobrazení důvodu zamítnutí nebo odkazu na výsledný blok.

16. **Přílohy rezervace**
   - Přiložit k rezervaci PDF a obrázek.
   - Ověřit zobrazení příloh v detailu pro obchodníka i plánovače.
   - Ověřit download.
   - Ověřit, že po smazání metadata i soubor zmizí korektně.

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
- **Rezervační queue:** rezervace připravená do fronty musí být serverově persistentní; nesmí zůstat jen v klientském `useState`.
- **Invarianta rezervace:** blok vzniklý z rezervace musí mít vždy `type = REZERVACE` a `orderNumber = reservation.code`.
- **Notifikace obchodníka:** přímé notifikace musí být cílené na konkrétního uživatele, ne přes `targetRole`.
- **Přílohy:** soubory rezervací nesmí skončit v git-tracked části repa ani v DB blob poli.
- **OBCHODNIK role:** musí mít stejnou read-only bezpečnost jako `VIEWER`; nesmí existovat skrytá write cesta přes UI ani API.
- **Dokumentace po implementaci:** finální stav promítnout minimálně do `CLAUDE.md` a `PLAN.md`; `DOKUMENTACE.md` aktualizovat v těch sekcích, které se touto vlnou skutečně mění.
