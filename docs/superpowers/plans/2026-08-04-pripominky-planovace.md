# Připomínky plánovače (srpen 2026) — implementační plán

## Kontext

Lukáš (plánovač) poslal devět připomínek k modulu Výrobní plán. Sedm z nich má
jednoznačné zadání a konkrétní místo v kódu; dvě (**bod 5** — odlišení dnů a směn,
**bod 6** — OBÁLKA/VNITŘKY jako jedna volba) jsou formulované nejednoznačně a Lukáš
sám nabídl osobní dovysvětlení. Vojta je z této dávky **vyřadil** — podklad pro
rozhovor s Lukášem je připravený v artifactu, doplní se v samostatné dávce.

Cílem je odstranit každodenní tření plánovače: přehlédnutelná specifikace, chybějící
štítky u rezervací, formulář kopírující délku předchozí zakázky, ruční překlikávání
u rozdělených rezervací, neúplný krok zpět a termínová upozornění počítaná od půlnoci
místo od reálné 14:00.

Průzkum proběhl šesti agenty nad kódem; každé tvrzení níže má oporu v konkrétním
souboru a řádku. Rozhodnutí Vojty: **varianta B** (plná amber plocha) pro specifikaci,
práh výšky **44 px**, u bodu 9 posunout **všechny tři prahy**, u bodu 7 **potvrzovací
dialog**, u bodu 8 rozsah **vložení + drop z fronty + hromadné uložení**.

## Rozsah

| Bod | Zadání | Etapa |
| --- | --- | --- |
| 1 | Zvýraznit specifikaci na bloku | 2 |
| 2 | OBÁLKA/VNITŘKY + archy/série do rezervací | 3 |
| 3 | Výchozí délka tisku 1 h u nových záznamů | 1 |
| 4 | Překlopení rezervace → varianta Bez technologie | 1 |
| 5 | Odlišení dnů a směn | **odloženo — čeká na Lukáše** |
| 6 | OBÁLKA/VNITŘKY jako jedna volba | **odloženo — čeká na Lukáše** |
| 7 | Překlopit všechny bloky téže rezervace | 4 |
| 8 | Krok zpět vrátí i řetězově odsunuté bloky | 5 |
| 9 | Termínová kolize od 14:00, ne od půlnoci | 1 |

## Globální pravidla

- Větev `Vojta`, commit po každé etapě, **zastavit a počkat na OK** (Vojtova zavedená praxe).
- Po každé etapě `npm run build` zelený; na konci celá suite
  `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`.
- Chyby v API přes `AppError`, logování přes `logger`, mutace v `$transaction` s auditem.
- Nové samostatné komponenty jako named export do `src/components/planner/`, ne inline
  do BlockCard/PlannerPage.
- Etapy 4 a 5 mění chování → před commitem multi-agent review (dle
  `feedback_review_diferencovane`). Etapy 1–3 stačí build + testy + vizuální kontrola.
- **Žádná změna DB schématu ani migrace v celé dávce.**

---

## Etapa 1 — Tři izolované opravy (body 3, 4, 9)

Tři nezávislé změny bez vzájemné vazby, každá s vlastním commitem.

### 3 — Výchozí délka 1 hodina

Default `useState(1)` je správný (`src/hooks/useJobBuilder.ts:167`), chybí ale reset.
`resetBuilderForm()` (`useJobBuilder.ts:341–365`) nuluje orderNumber, popis, štítky,
recurrenci i `blockVariant`, ale **`setDurationHours` v něm není** — proto každý další
záznam zdědí délku předchozího. Select délky se v `JobBuilderPanel.tsx:255–262`
vykresluje pro všechny typy, takže vada postihuje zakázky i rezervace.

- Doplnit `setDurationHours(1)` do `resetBuilderForm`.
- Sjednotit fallback v `reservationToQueueItem` (`useJobBuilder.ts:108`) z `2` na `1`
  — uplatní se jen u rezervace bez `durationHours` v `planningPayload`.
- `PlanningForm.tsx:39–41` má default 1 správně a state se při přepnutí rezervace
  remountuje — beze změny.

### 4 — Překlopení rezervace → Bez technologie

Popup „Překlopení na zakázku" (`src/components/BlockEdit.tsx:1296–1353`) posílá
`payload.blockVariant = blockVariant`. Ten je u rezervace vždy `"STANDARD"`, protože
`normalizeBlockVariant` pro ne-ZAKAZKA vrací STANDARD (`src/lib/blockVariants.ts:15`)
— odtud „Klasická".

- Na obou potvrzovacích cestách (`BlockEdit.tsx:1314` Enter, `:1336` tlačítko) poslat
  `"BEZ_TECHNOLOGIE"` místo `blockVariant`. Hodnotu vzít z pojmenované konstanty
  vedle `BLOCK_VARIANTS` v `src/lib/blockVariants.ts`, ne jako literál na dvou místech.
- Server PUT variantu respektuje (`api/blocks/[id]/route.ts:310–316`) — nic tam neměnit.
- Pozn.: týká se **jen překlopení existujícího bloku**. Přepnutí typu v builderu
  (`JobBuilderPanel.tsx:108`) zůstává na STANDARD — zakládá se nová zakázka, ne překlopení.

### 9 — Termínová kolize od 14:00

Logika je na jediném místě: `deadlineState` (`src/components/planner/BlockCard.tsx:62–75`),
privátní funkce bez testů. Porovnává **civilní datumové stringy** (`utcToPragueDateStr`),
takže hranicí je fakticky půlnoc. Všechny čtyři vykreslovací režimy (COMPACT, TINY/MICRO,
FULL DateBadge, FULL kompakt) konzumují výsledek z `BlockCard.tsx:426–436` — změna se
propíše sama.

- **Přesunout `deadlineState` do `src/lib/deadlineState.ts`** jako exportovanou čistou
  funkci a napsat k ní `deadlineState.test.ts` (konvence repa: čistá logika v `lib/`).
  BlockCard ji jen importuje.
- Zavést `DEADLINE_HOUR = 14` a počítat `dueAt = pragueToUTC(dueDateStr, DEADLINE_HOUR, 0)`
  (`src/lib/dateUtils.ts:270–299`, DST-safe; precedens `api/report/daily/route.ts:28`).
- Nové prahy (pořadí vyhodnocení zachovat — `ok` první, pak `earlyStart`):
  - `earlyStart` — `new Date(blockStartTime) < dueAt` (skutečný timestamp, ne den).
    Nově se označí i zakázka startující v den termínu v 8:00; ta po 15:00 už ne.
  - `warning` — `now < dueAt && utcToPragueDateStr(now) === dueDateStr`.
  - `danger` — `now >= dueAt`.
- `now` tiká à 60 s (`TimelineGrid.tsx:647`), překlopení ve 14:00 nastane bez reloadu.
- **Mimo rozsah, ale flagnout Vojtovi:** badge `⚠ PO DEADLINE` (`BlockCard.tsx:401–402`,
  expedice) porovnává rovněž po dnech. Lukáš ho nezmínil — neměníme.

**Ověření:** blok s `dataRequiredDate = dnes` a startem v 8:00 → `⚠`; tentýž blok se
startem v 15:00 → `!` do 14:00, pak `‼`. Testy `deadlineState.test.ts` pokryjí hranu
13:59/14:00/14:01 a přechod letního času.

---

## Etapa 2 — Zvýrazněná specifikace (bod 1)

Dnes je spec poslední řádek 10 px s průhledností 82 % (`BlockCard.tsx:1108–1119`) a
vykreslí se **až od 80 px** (`showSpec`, `BlockCard.tsx:489`). Při maximálním přiblížení
(26 px na půl hodiny, `ZoomSlider.tsx:12`) má hodinová zakázka 52 px — u krátkých
zakázek tedy spec Lukáš nevidí vůbec.

Nová komponenta `src/components/planner/SpecBand.tsx` (named export), tři formy podle
dostupné výšky, aby zvýraznění fungovalo na každé délce zakázky:

| Výška bloku | Podoba |
| --- | --- |
| ≥ 80 px | Plná amber plocha, tmavý text, **2 řádky** (dnešní line-clamp) |
| 44–79 px | Plná amber plocha, **1 řádek** s elipsou (dvouřádkový by vytlačil chipy D/M/E) |
| < 44 px | Amber štítek **S** na začátku řádku chipů; plný text v tooltipu |

- Barvy: `#fbbf24` podklad / `#221703` text — literály konzistentní s
  `src/lib/blockStyles.ts` (vnitřek bloku je barevný gradient v obou motivech, takže
  tokeny `--warning` by tu byly zavádějící). Konstanty držet u ostatních v `blockStyles.ts`.
- `showSpec` práh 80 → 44. **Pozor:** `showSpec` vstupuje do `splitChipFits`
  (`BlockCard.tsx:1140`) — po změně ověřit, že se ✂ chip u split částí nezalomí.
- Dnešní amber proužek u pravé hrany (`BlockCard.tsx:1282–1293`) zůstává jen pod 44 px
  jako doplněk štítku S; nad 44 px se přestane kreslit (spec je vidět přímo).
- Hover tooltip (`BlockCard.tsx:1364–1369`) rozšířit tak, aby plný text ukazoval i tam,
  kde je pás zkrácený elipsou.
- Bez zásahu do `BlockEdit`/`BlockDetail`/reportu — mění se jen karta v plánu.

**Ověření:** na dev serveru blok 2 h / 1 h / 45 min / 30 min s dlouhou specifikací;
světlý i tmavý motiv; blok se split chipem; blok s tiskařskou poznámkou (oranžový horní
pruh `BlockCard.tsx:687–703` nesmí kolidovat).

---

## Etapa 3 — Výrobní štítky u rezervací (bod 2)

Pole `obalka`, `vnitrky`, `tiskoveArchy`, `serie` na `Block` existují, ale rezervační
pipeline je ignoruje na třech místech po sobě:

1. `src/app/rezervace/_components/PlanningForm.tsx` (formulář „Připravit do fronty")
   je v payloadu (`:117–137`) vůbec nemá.
2. `reservationToQueueItem` (`src/hooks/useJobBuilder.ts:95–134`) je **natvrdo nuluje**
   (`:102–105`) — i kdyby v payloadu byly.
3. `JobBuilderPanel.tsx:452` vykresluje `ProductionTagsRow` jen pro `type === "ZAKAZKA"`.

Kroky:

- **PlanningForm** — vložit `<ProductionTagsRow …/>`
  (`src/components/planner/ProductionTagsRow.tsx`, čistě prezentační, řízená propsy)
  a doplnit čtyři pole do `planningPayload`. Číselníky `TISKOVY_ARCH` / `SERIE` fetchovat
  stejným vzorem jako `BlockEdit.tsx:471–472`. Archy/série serializovat přes
  `serializeProductionTags` (`src/lib/productionTags.ts`).
- **`reservationToQueueItem`** — číst čtyři pole z `planningPayload` místo hardcode
  `false`/`[]`; archy/série parsovat přes `parseProductionTags`.
- **Builder** — podmínku vykreslení i resetu rozšířit ze `type === "ZAKAZKA"` na
  `type !== "UDRZBA"` (parita s `BlockEdit.tsx:885`), tj. tři místa:
  `JobBuilderPanel.tsx:452`, reset při přepnutí typu `useJobBuilder.ts:230–238`,
  guard v submit payloadu `useJobBuilder.ts:402–405`. Skrytí u série
  (`bRecurrenceType !== "NONE"`) zůstává.
- `handleQueueDrop` (`PlannerPage.tsx:1619–1622`) už `item.obalka` … do POST body mapuje
  — jen ověřit, že hodnoty dotečou.
- Bez změny API: POST `/api/blocks` pole přijímá (`api/blocks/route.ts:280–283`).

**Ověření:** rezervace → připravit do fronty s OBÁLKA + 2 archy → drop na timeline →
blok nese štítky v plánu i v DTP kartě; editace rezervace ve frontě si štítky pamatuje.

---

## Etapa 4 — Překlopení celé rezervace (bod 7)

**Klíčové zjištění z průzkumu — mění zadání:** bloky téže rezervace nesdílí jeden klíč.

- **Split** kopíruje `orderNumber` i `type`, ale **ne** `reservationId`
  (`api/blocks/[id]/split/route.ts:105, 120, 130`). Zato `type` a `orderNumber` jsou
  v `SPLIT_SHARED_FIELDS` (`api/blocks/[id]/route.ts:68–73`), takže u split částí
  **překlopení už dnes propaguje na celou skupinu**.
- **Ctrl+C/V kopie** nese `orderNumber`, ale `reservationId` se záměrně neposílá nikdy
  (`src/lib/blockPayload.ts:19–20`) → sourozenci sdílí **jen řetězec `orderNumber`**.
- Druhý drop téže rezervace z fronty spadne na 409 (`api/blocks/route.ts:151–156`),
  takže dvojice XL105/XL106 vzniká právě kopií nebo splitem s přesunem.
- `Block.orderNumber` nemá unique ani obyčejný index (`prisma/schema.prisma:42`).

Sourozence tedy hledat jako **sjednocení**: bloky se shodným `orderNumber` **a**
`type === "REZERVACE"`, plus bloky se shodným nenulovým `reservationId`. Filtr na typ
chrání před ručně založenou zakázkou pojmenovanou „R123".

Kroky:

- Čistý helper `findReservationSiblings(block, allBlocks)` v `src/lib/` + unit testy
  (split skupina, kopie na jiném stroji, cizí blok se shodným číslem, osamocený blok).
- V popupu překlopení (`BlockEdit.tsx:1296–1353`) po zadání čísla zakázky, **když
  sourozenci existují**, zobrazit `ConfirmDialog` (`src/components/ConfirmDialog.tsx`)
  ve znění „Rezervace R123 má 3 bloky na 2 strojích. Překlopit všechny?" s volbou
  *Jen tento* / *Všechny*. Bez sourozenců se dialog nezobrazí — chování beze změny.
- Překlopení provést **stávající PUT cestou** `/api/blocks/{id}` pro každý blok (tatáž
  validace, chain push, audit). Nový endpoint nezakládat — write-path surface zůstává
  beze změny, což je v CLAUDE.md explicitní hodnota.
- **Jeden undo krok pro celou akci:** nový builder `buildMultiEditCommand` v
  `src/lib/undo/commands.ts` podle vzoru `buildEditCommand` (`:40–91`) — pole snapshotů
  místo jednoho, `expectedUpdatedAt` u každého. Unit testy vedle stávajících.
- Číslo zakázky se propíše všem sourozencům (dnes to pro split skupinu dělá server sám).

**Flagnout Vojtovi, neopravovat:** smazání překlopeného bloku dnes zamítne navázanou
rezervaci a pošle obchodníkovi „Rezervace R123 byla zamítnuta" — DELETE se řídí jen
`reservationId` bez ohledu na typ (`api/blocks/[id]/route.ts:727–758`). Je to
předexistující past, ne důsledek této změny; po hromadném překlopení bude ale viditelnější.

---

## Etapa 5 — Krok zpět u řetězového posunu (bod 8)

Průzkum vyvrátil původní domněnku: **tažení bloku myší odsunuté bloky do historie ukládá
správně** (`PlannerPage.tsx:1010–1013` počítá `shiftedOld` z `blocksRef` před aplikací
odpovědi, `:1065` a `:1145` je zapisují). Server staré pozice v odpovědi nevrací —
klient si je bere z vlastního stavu.

Skutečné díry, které odpovídají popsanému symptomu:

| Cesta | Chain push | Undo dnes |
| --- | --- | --- |
| Vložení Ctrl+V (`PlannerPage.tsx:1851`) | ano (`resolveChain: true`) | jen vytvořený blok |
| Vložení skupiny (`:1999`) | ano | jen vytvořené bloky |
| Drop z fronty (`:1668`) | ano | jen vytvořený blok |
| Hromadné uložení `handleSaveAll` (`:1412–1420`) | ano | **žádné** |

Kroky:

- `buildCreateCommand` (`src/lib/undo/commands.ts:138–160`) rozšířit o volitelné
  `shiftedBefore: BlockSnapshot[]`: undo = DELETE vytvořeného **a** batch obnova
  odsunutých; redo = re-POST **a** batch návrat odsunutých na nové pozice. Batch volat
  stejně jako existující undo effects — `bypassScheduleValidation: true`,
  `bypassOverlapCheck: true`, **bez** `resolveChain` (`PlannerPage.tsx:194`).
- Na třech create-místech spočítat `shiftedOld` z `blocksRef.current` **před** aplikací
  odpovědi, stejným vzorem jako `:1010–1013`, a předat do builderu.
- `handleSaveAll` — zapsat undo záznam (`buildMultiEditCommand` z etapy 4, případně
  `buildEditCommand` per blok sloučený do jednoho záznamu) včetně odsunutých sousedů.
- Testy do `src/lib/undo/commands.test.ts`: create-undo s odsunutými, prázdné pole,
  stale guard (`StaleUndoError`) když se některý z odsunutých mezitím změnil.

**Mimo rozsah (Vojtovo rozhodnutí):** split a reflow dnes undo nemají vůbec
(`TimelineGrid.tsx:1202`, `PlannerPage.tsx:1517–1559`). Jsou to nejcitlivější serverové
cesty — vlastní etapa, pokud si je Lukáš vyžádá.

**Ověření na dev DB:** blok vložit doprostřed hustého dne tak, aby chain push odsunul
5+ bloků → Ctrl+Z → vložený blok zmizí **a** všech 5 se vrátí; Ctrl+Shift+Z obojí
zopakuje. Totéž pro drop z fronty a skupinové vložení.

---

## Etapa 6 — Verifikace, review, dokumentace

- `npm run build` + `npm run lint` (0 chyb, warningy tolerované).
- Celá suite: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
  — stávající testy zelené + nové (`deadlineState`, `findReservationSiblings`,
  `buildMultiEditCommand`, rozšířený `buildCreateCommand`).
- Multi-agent review nad diffem větve (min. 3 lens: korektnost/regrese, UI/UX konzistence,
  soulad s konvencemi repa) + fix wave. Povinné pro etapy 4 a 5.
- Vizuální regresní kolečko: planner, rezervace, DTP panel, denní report, režim tiskaře;
  světlý i tmavý motiv.
- Doplnit `docs/vyvoj-historie.md` a případné nové konvence do `CLAUDE.md` ve stejném
  commitu, který je vyvolal.
- Spec dávky zapsat do `docs/superpowers/specs/2026-08-04-pripominky-planovace-design.md`.

## Otevřené body pro Lukáše

1. **Bod 5** — ztrácí se v tom, *kde končí den*, nebo *jakou směnu vidí*? Pásy směn
   existují (odpolední +5 %, noční +11 %), dělicí čára dne je 1 px, střídavý tón dnů byl
   loni smazán. Návrhy obou čtení jsou v artifactu.
2. **Bod 6** — které dvě kliknutí přesně šetří? Nejpravděpodobněji jde o rozdělenou
   zakázku, kde by druhá část dostala opačný štítek automaticky. V artifactu je
   proklikávací demo tří variant.
