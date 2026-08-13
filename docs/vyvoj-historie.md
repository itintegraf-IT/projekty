# Vývoj a featury — reference & historie

> Vytaženo z CLAUDE.md 14. 7. 2026 při zeštíhlení (aby se always-loaded soubor nedostal přes 40 KB práh). Detailní plány: `docs/superpowers/plans/`. Blow-by-blow: git historie. Živá pravidla zůstala v `CLAUDE.md`.

## Nedodělané zakázky na Monitoru tiskaře (13. 8. 2026)

Připomínka plánovače: „Když v pátek večer nestihnout vytisknout zakázku, o víkendu
se tisknout nebude a v pondělí a úterý bude svátek, uvidí tiskaři, jakou zakázkou
mají ve středu začít?" Neuvidí — čtyři nezávislé brány: 16h okno hero karty,
fronta jen dnes+zítra podle dne startu, plán s rozsahem 1 den zpět, a „Najít",
které zakázku najde, ale klik nevede nikam.

**Řešení:** sekce „NEDODĚLÁNO" ve frontě (`monitorQueue().overdue`, 14 dní zpět)
jako hlavní cesta + „Najít" ústící na velkou kartu Monitoru jako neomezená
záložní cesta. Nic se nepřeplánovává, žádná notifikace (rozhodnutí majitele).

### Klíčová rozhodnutí

- **Rozhoduje `endTime`, ne `startTime`.** Noční směna 22:00–6:00 začala včera,
  ale končí dnes — podle startu by spadla do NEDODĚLÁNO, i když právě běží na
  velké kartě. Táž volba, na které stojí 16h okno.
- **14denní strop je pojistka, ne pohodlí.** Sekci nic neuklidí a `Block` řádky
  se v projektu nikdy nemažou (jediný retenční skript maže `BlockRevision`).
- **NEPOUŽÍVÁ se `overdueAlarmState(...) === "stale"`**, ačkoli se to nabízí:
  odpovídá na jinou otázku (16 h = „je to akutní") a udělalo by dvouhodinovou
  slepou skvrnu — zakázka stará 14 h by při běžícím jiném bloku nebyla ani na
  kartě, ani v sekci.
- **Zvolený civilní den má vlastní dvouhodinovou skvrnu taky**, jen jinde a
  užší: neodklepnutá zakázka vypadne z 16h okna hero karty v 22:00, ale do
  NEDODĚLÁNO (`endTime < todayMidnightMs`) spadne až po půlnoci. Mezi 22:00
  a půlnocí není vidět nikde. Vědomě přijaté — spraveno by to bylo jen tím,
  že by se hranice počítala od konce bloku místo od civilní půlnoci, tedy
  přesně tou logikou, kvůli které se zamítla `stale` varianta výš.
- **POZASTAVENO se vylučuje** — plán ji z „po termínu" taky vylučuje. Je to
  výrobní stopka, ne zpoždění; jinak by obě obrazovky tvrdily opak.
- **Ruční výběr žádné okno nezná**, takže přes „Najít" jde odklepnout i zakázka
  půl roku stará. Server nebrání — `complete` route nemá časovou kontrolu.

### Gotchy

- **Efekt pro `focusBlockId` musí být deklarovaný ZA efektem `[viewMachine]`**,
  který maže `selectedId`. React spouští efekty v pořadí deklarace a ten úklid
  běží i při mountu.
- **`setViewMachine` a `setFocusBlockId` musí padnout v témže handleru**, aby je
  React zbatchoval — jinak `resolveSelectedBlock` blok odmítne pro neshodu stroje.
- **Early return v `MonitorQueue` musel zahrnout `overdue`** — jinak by hláška
  „není dnes ani zítra nic naplánováno" přebila sekci právě ve stavu, kdy je
  nejpotřebnější.

### Známá omezení

- **`printCompletedAt` je čas KLIKNUTÍ, ne tisku.** Zakázka z minulého týdne
  odklepnutá ve středu dostane razítko středy, takže `computeThroughput`
  a `computeAvgLeadTimeDays` (`reportMetrics.ts`) vykážou průtok ve špatném
  období. Featura to zkreslení zvětšuje. **Rozhodnutí Vojty: známé omezení,
  do reportů se nesahá.**
- **Odklepnutí není neutrální akce** — vytištěný blok se stává zdí pro chain
  push, nejde přepočítat ani rozdělit a mizí z detekce driftu.
- **Zakázky starší než 14 dní** jsou dosažitelné pouze přes „Najít".
- **Osiřelá půlka rozdělené zakázky** na druhém stroji se v sekci neobjeví —
  server odklepnutí na cizím stroji zakazuje. Sekce je striktně per-stroj.

## Dva stupně zpoždění + hledání v DTP přehledu (12.–13. 8. 2026)

Připomínka plánovače: zpožděná neodklepnutá zakázka a hotová zakázka vypadaly
v plánu stejně — obě vybledlé (`BLOCK_OVERDUE` krytí 0,22/0,14 vs.
`BLOCK_PRINT_DONE` 0,13/0,07). Obě tedy říkaly „tuhle už neřeš", přestože
znamenají pravý opak.

**Řešení:** `src/lib/overdueState.ts` — `overdueAlarmState()` vrací `none` /
`alarm` (do 16 h po konci) / `stale` (nad 16 h). Akutní zpoždění má plnou
červenou výplň, zbytkové zůstává tlumené, ale s červeným levým pruhem.

### Klíčová rozhodnutí

- **`OVERDUE_WINDOW_MS` se přestěhovala z `monitorView.ts` do `overdueState.ts`.**
  Týmž oknem se teď řídí červený alarm v plánu i to, jak dlouho zakázka zůstává
  na velké kartě Monitoru u stroje. `monitorView.ts` konstantu **re-exportuje** —
  produkčně ji odtud nikdo nebere, drží se jako záruka, že si ji tam někdo
  nezkopíruje zpátky a čísla se nerozejdou.
- **Výplň alarmu je ZÁMĚRNĚ shodná s pozastavenou zakázkou** (rozhodnutí majitele
  12. 8. 2026, poté co se první verze „modrá karta + červený rám" ukázala jako
  nevýrazná). Pozastavená zakázka je stav plánu do budoucna, v minulosti prakticky
  nestojí. `BLOCK_OVERDUE_ALARM` je proto spread pojmenované konstanty — kdyby se
  ty dva stavy měly rozejít, je to jedna vědomá editace.
- **Alarm se kreslí jako INSET stín karty, ne jako překryvný `<div>`.** První
  verze používala overlay se `zIndex: 4`, tedy nad veškerým obsahem — a na kartě
  vysoké 20 px ukrojila 3 px z čtvercového tlačítka „Hotovo" a spolkla
  celošířkový pruh tiskařských poznámek na `top: 0`. Rozpočty
  v `tiskarBlockView.ts` hlídají ořez TOKEM, o překryvu by se nikdy nedozvěděly
  (nález review 13. 8. 2026). Inset stín leží nad pozadím, ale POD potomky.
- **Hodinky u čísla zakázky se kreslí ve FULL i COMPACT.** Původně jen v COMPACT,
  tedy v pásmu širokém 5 px výšky karty — u běžné hodinové zakázky tak plánovač
  viděl červenou kartu bez vysvětlení a od pozastavené ji nerozeznal.

### Hledání — jeden predikát, jedno pole

`src/lib/orderSearch.ts` (`blockMatchesQuery`) sjednotil podmínku shody, kterou si
opisovala **čtyři** místa: hlavičkové hledání v planneru, `outOfRangeBlocks`,
tiskařský `OrderSearchSheet` a ztlumení neshodujících se bloků v `TimelineGrid`.
Bez toho by přidání pátého prohledávaného pole rozešlo hledání (blok najde) od
plánu (blok zůstane ztlumený).

`src/components/SearchField.tsx` pak sjednotil i **vzhled** pole (input + křížek +
Esc). DTP panel dostal vlastní hledání jako syrový `<input>` s inline styly,
zatímco hlavička planneru používala sdílený `<Input>` — dvě pole, která dělají
totéž, se lišila výškou i fokusovým prstencem. Co je vlastní jednomu místu
(Enter = skok na další výsledek a počítadlo N/M v planneru, filtrační chipy v DTP)
zůstalo u volajícího.

### DTP přehled

`src/lib/dtpOverview.ts` — bez dotazu panel ukazuje běžnou frontu (30 dnů dopředu
+ vše s nehotovými daty), s dotazem okno **vědomě zahazuje** a hledá napříč vším,
jinak by DTP starší zakázku nenašel vůbec. Nalezené zakázky mimo běžnou frontu
jdou pod ni a nesou štítek „mimo přehled".

Pozor: dotaz a filtrační chip se **ANDují**. Prázdný stav to proto rozlišuje —
u zapnutého chipu hlásí „v tomto filtru není", ne „nenalezena" (jinak by tvrdil,
že zakázka neexistuje, i když existuje a má jen jiný status).

### Známá omezení

- `computeShadeParity` (střídání odstínů) počítá paritu per kbelík
  `getBlockStyleKey(type, blockVariant)` a **o alarmu neví**. Dvě sousedící
  zpožděné zakázky z různých kbelíků (STANDARD + BEZ_SACKU) tedy můžou dostat
  touž paritu a splynout v jednu červenou plochu; rozlišuje je až rám alarmu.
- `overdueAlarmState` je záměrně jen o čase. Že se stav týká výhradně `ZAKAZKA`
  a že pozastavená zakázka se za zpožděnou nepovažuje, si hlídá volající
  (`BlockCard`) — a `BlockCard` nemá žádný test, takže smazání toho guardu
  projde buildem i celou suitou.
- `now` v DTP panelu se přepočítá jen se změnou `blocks`/`query`/`activeFilter`,
  takže štítky „dnes"/„zítra" přes noc samy nezestárnou.

## Čitelnost timeline — velikost písma v blocích (12. 8. 2026)

Plánovači hlásili, že písmo v kartách bloků na timeline je na promítací tabuli
nečitelné. Zoom slider přitom problém neřešil — měnil jen `slotHeight` (výšku
mřížky), text v kartě rostl s ním jen nepřímo a málo. Do 8/2026 bylo písmo
v `BlockCard.tsx` zapsané natvrdo v pixelech (48 výskytů `fontSize`) a prahy
hustoty karty (`MODE_FULL`/`COMPACT`/`TINY`/`MICRO`) natvrdo jako čísla
48/44/24/14 — zvětšit jedno bez druhého by content karty prostě oříznulo.

**Z pohledu uživatele.** V hlavičce planneru přibyl přepínač `M · L · XL`, hned
za zoom sliderem — stavebně kopie sousední skupiny `30d · 60d · 90d`
(`FontScaleSwitch`). Nastavení se ukládá do `localStorage`
(`ig-planner-font-scale`), ne na server — je to vlastnost OBRAZOVKY, ne
uživatele: počítač u promítací tabule se nastaví jednou na XL a zůstane tak bez
ohledu na to, kdo se zrovna přihlásí. Vzorem je přepínač motivu (`next-themes`),
ne šířka bočního panelu, která se pamatuje per uživatel.

**Odkud se vzalo místo.** Karta dřív nesla dvouřádkový `DateBadge` (popisek
„DATA" nad datem). Zrušen a nahrazen jednořádkovým `BlockDateChip` — týž tvar,
jaký už dřív používal kompaktní režim karty. Uvolněný řádek šel do většího písma.
`DateBadge` jako komponenta zanikla úplně (commit `e37e896a`).

**Jediný zdroj pravdy: `src/lib/plannerTypography.ts`.** Čistá funkce
`plannerTypeScale(key)` vrací velikosti písma pro každý prvek karty i prahy
hustoty — ty se POČÍTAJÍ z písma, nezapisují se ručně. Strážný test
`plannerTypography.test.ts` hlídá, že hodinová zakázka zůstane v plném layoutu
a půlhodinová aspoň jednořádková ve všech třech stupních.

**Gotchy pro budoucí údržbu:**

- **Dva různé koeficienty, snadno zaměnitelné.** `fontFactor` (M 1 · L 1,15 ·
  XL 1,35) je pro velikosti PÍSMA. `slotFactor` (M 1 · L 1,053 · XL 1,123) je pro
  VÝŠKY mřížky — roste pomaleji, aby zvětšené písmo nenafouklo timeline do
  nesmyslné výšky. Záměna byla reálný nález z code review: `fontSize` počítaný
  přes `slotFactor` by na XL rostl jen o 12 % místo 35 %.
- **Jednořádkový layout (`MODE_TINY`/`MODE_MICRO_TEXT`) písmo stropuje** —
  `Math.min(typeScale.X, layoutHeight * F)` — protože práh `micro` je pevných
  14 px pro všechny stupně, ale samotné písmo se stupněm dál roste.
- **`src/lib/tiskarBlockView.ts` drží druhou nezávislou kopii** výškového
  rozpočtu karty (rozhoduje o tlačítku „Hotovo" a značce rozdělené zakázky).
  Musela se parametrizovat týmž stupněm, jinak by se vrátila regrese z
  3. 8. 2026, kdy tiskaři propadlo tlačítko Hotovo pod ořez.
- **Pás specifikace se nově vykreslí jen, když se vejde celý** — jinak padá na
  značku „S" s tooltipem, místo aby se dřív ořezával na proužek.

Spec: `docs/superpowers/specs/2026-08-11-citelnost-timeline-velikost-pisma-design.md`
Plán: `docs/superpowers/plans/2026-08-11-citelnost-timeline-velikost-pisma.md`

### Dotažení — prvky, které se stupněm nerostly, a ztracené tlačítko „Hotovo" (12. 8. 2026)

13 kódových commitů + 1 dokumentační navazujících na přepínač výš. Testy 977 → 995, nic nenasazeno.

**Co se doškálovalo a proč.** Drobné štítky karty (`ProductionChips`, badge
tiskařských poznámek, popisek pauzy, `SplitChip`) i pruh driftu a tlačítko
„Přepočítat" v hlavičce stroje měly `fontSize` napevno v pixelech — rostly
o 0 %, zatímco číslo zakázky vedle nich o 35 % (stupeň XL). Přidána pole
`production`/`noteBadge`/`splitChip`/`pauseLabel`/`driftBadge` do
`plannerTypeScale` (`da41f2a4`) a navázána (`65b8673b`, `b4e9dfe4`); ikony
a značky v jednořádkovém layoutu dostaly strop spolu s číslem, aby ho
nepřerostly (`40d442a6`).

**Tiskaři se vrátila pilulka rozdělené zakázky.** Po zvětšení `SplitChip`
s písmem se v pásmu 46–79 px (M) nevešla na svoje dosavadní spodní místo —
po zavedení stupňů karta v tomhle pásmu spadla do plného layoutu, ale
výškový rozpočet pilulku propustil až od 80 px. Zbyla jen neklikatelná
textová značka „✂1/2". Nebyla to kosmetika: pilulka nese klik, kterým
tiskař přeskočí na navazující blok téže zakázky na druhém stroji. Oprava
(`f4a66de2` + `d12dd5c0`) přidala záložní umístění v Řádku 1
(`splitChipFitsInHeaderRow`) a nahradila napevno zapsaný `SPLIT_CHIP_PX`
(dřív 25 px pro všechny stupně) výpočtem ze skutečného box modelu
`SplitChip.tsx`.

**Čtvercové tlačítko „Hotovo" — vada nebyla teoretická.** Původní měření
došlo k závěru, že tiskař na problematické pásmo (nejnižší karty) nedosáhne,
protože nemá zoom slider. Nezávislé ověření našlo dvě cesty, kterými se tam
přesto dostal: `localStorage` zařízení i serverová preference účtu (`/api/me/preferences`)
se pro každou roli četly stejně a při každém mountu se zpětně zapisovaly —
tiskař tak mohl zdědit malý zoom od jiné role na tomtéž zařízení a neměl ho
čím vrátit (žádný slider). Druhá cesta: výška obsahu karty u bloku přes
odstávku obcházela podlahu 20 px a mohla vyjít na nulu. Obojí opraveno
(`9d62360b` + `3855931f`, dále `d571b35b` + `d994de46`), viz rozhodnutí
majitele 1–3 níž.

**Popis ustupuje pásu specifikace, ne naopak.** `specBandFits` (task 5b) jen
doufala, že Řádek 1 zůstane jednořádkový, kdykoli se u tiskaře kreslí pás
specifikace — sázka platila jen NÁHODOU, protože `descLineClamp` mohl vyjít
`>= 2` prakticky v celém pásmu, kde se pás kreslí, a Řádek 1 v DOM pak přerostl
odhad o ~12 px i s rizikem, že pruh Hotovo přeteče. Rozhodnutí majitele (bod 4
níž): ustupuje popis (zůstává v tooltipu a na Monitoru u stroje), ne pás.
`tiskarDescClampsToOneLine` vynutila jednořádkový popis u tiskaře s `ZAKAZKA`
a pásem specifikace (`ae6e3d6c`); review Tasku 5d ale zjistilo, že samotná
booleovská politika mutaci „smaž volání v `BlockCard.tsx`" nechytila — zbyl by
platný, tiše regresní kód. Druhé kolo vytáhlo CELÝ vzorec `descLineClampFor`
(žádná záložní větev vedle volání) a zúžilo ho na `ZAKAZKA`, protože pruh
Hotovo se pro REZERVACE/UDRZBA vůbec nekreslí (`64eff14d`).

**Sticky hlavička — ověřeno v prohlížeči, ne dopočtem.** Konstanta
`HEADER_HEIGHT = 33` v `TimelineGrid.tsx` byla **smazána** (`efef0876`).
Hlavička stroje není potomkem scrollovacího kontejneru, ale jeho sourozenec
— `top: 0` zarovná štítek dne přesně pod ni, bez odsazení. Stejný commit
doladil i ředění popisků časové osy (`labelStep`) podle stupně jejich písma
(`typeScale.rail` + 5 px rezerva na M), protože se s větším písmem na L/XL
popisky natěsnaly víc, než je čitelné — ověřeno v prohlížeči přes Playwright,
že se rastr hodinových/půlhodinových čar po změně nerozpadl.

**Rozhodnutí majitele (12. 8. 2026):**

1. Čtvercové tlačítko „Hotovo" se zmenšuje podle výšky karty, ale **nikdy
   pod 20 px** (`MIN_CARD_CONTENT_HEIGHT_PX`). Na velmi nízké kartě je
   přijatelnější mírný přesah než netrefitelný cíl — tlačítko se u stroje
   mačká prstem.
2. Prázdná karta u bloku přes odstávku se **opravuje** (podlaha 20 px
   i pro `contentHeight`), ne odkládá.
3. Zoom tiskaře je **vynucen na výchozí hodnotu**. Role, která zoom nemá
   jak měnit, ho nemá proč ani dědit.
4. Když se popis nevejde na jeden řádek, **ustoupí popis, ne pás
   specifikace**. Tiskař potřebuje specifikaci a tlačítko víc než dlouhý
   popis; popis zůstává v tooltipu a na Monitoru u stroje.

**Známá omezení (vědomě přijatá, neopravují se):**

> Ořez chipu Pantone. Při stupni XL se na obrazovkách do 1366 px ořízne
> čtvrtý datumový chip; od 1600 px se vejde. Řádek chipů se záměrně
> nezalamuje. Řešení odloženo (rozhodl Vojta 12. 8. 2026).

> Rozpočty chránící tlačítko „Hotovo" jsou bezvýhradné jen v ose VÝŠKY.
> Pravý shluk chipů v Řádku 1 má `flexWrap: "wrap"` a v žádném rozpočtu
> není: jedno zalomení stojí +15,0 / +16,2 / +17,8 px (M/L/XL) proti
> rezervě 1,50 / 1,44 / 1,36 px. U tiskaře je sloupec stroje široký kolem
> 1250 px, takže je to dnes prakticky nedosažitelné — ale je to táž třída
> havárie, jen řízená šířkou místo výšky.

> Tiskař bez pásu specifikace, stupeň M, výška karty 64,5–65,5 px: spodní
> hrana pruhu „Hotovo" překročí obsahový box o 0,1–1,1 px. Ořeže se
> odsazení pruhu, ne tlačítko. Neopravuje se.

## Fronta Monitoru — specifikace a chipy (11. 8. 2026)

Řádek fronty byl jednořádkový — číslo zakázky, šedý popis, čas startu — a neukazoval
tiskaři nic z toho, čím se na stroji reálně seřizuje. Velká karta vlevo přitom svoje
chipy (OBÁLKA/VNITŘKY, tiskové archy, série, data, materiál, PANTONE, varianta) i
amber pás specifikace už měla. Tři změny to sjednotily.

### Klíčová rozhodnutí

- **Pravidla chipů mají teď jedno místo PRO MONITOR** (velká karta i fronta).
  `buildMonitorChips` (`src/lib/monitorChips.ts`) je čistá funkce vytažená doslova
  z privátní `HeroChips`, která dřív žila přímo v `MonitorView.tsx`. Pokryto testy
  v `monitorChips.test.ts`. Důvod, proč je to funkce v `lib`, a ne logika v JSX:
  pravidlo materiálové připravenosti (`materialInStock || materialIssued ||
  materialOk`) už jednou selhalo — nález I5, kdy Monitor hlásil „čeká" na materiál,
  který plán ukazoval zeleně. Pravidla s touhle historií patří pod testy, ne do
  markupu. **Není to jediné místo v celé aplikaci** — `BlockCard.tsx` v plánu si
  stejná pravidla (materiál, PANTONE) počítá inline, vlastní kopií, a tahle funkce
  ji nenahrazuje. Obě strany dnes souhlasí jen shodou; kdo mění pravidlo tady, musí
  ho ručně promítnout i do `BlockCard.tsx`.
- **Jeden renderer pro obě strany obrazovky.** `MonitorChips.tsx`
  (`{ block, size: "hero" | "queue" }`) používá velká karta i řádek fronty, takže se
  nemůžou rozejít. `size` mění **jen rozměry** (hero: 12px / padding 5px 10px; queue:
  11px / padding 3px 7px), nikdy sadu chipů, pořadí ani tóny.
- **Root je `<span>`, ne `<div>`.** Řádek fronty je `<button>`, který podle HTML
  specifikace povoluje jen phrasing content — `<div>` root by byl neplatné HTML.
  `MonitorChips` proto má kořenový `<span style={{ display: "flex" }}>`. Zachyceno
  až v review, ne v plánu.
- **`MonitorQueue.tsx`: řádek se stal flex column.** Nahoře původní řádek (číslo,
  popis, čas), pod ním amber pás specifikace, pod tím chipy. Řádek zůstal `<button>`
  (klik přetáhne zakázku na velkou kartu — vědomé přebití pořadí plánovače tiskařem)
  a jeho props se nezměnily. Dvě drobné úpravy stejného řádku byly záměrné, ne
  vedlejší efekt: padding `11px 12px` → `10px 12px` (o chlup víc místa pro tři
  vodorovně natěsnané řádky obsahu) a zarovnání horního řádku `center` → `baseline`
  (číslo zakázky, popis a čas mají různou velikost písma; `baseline` je zarovná
  vizuálně přirozeněji než `center`).

### `SpecBand` z plánu se záměrně nepoužil znovu

`src/components/planner/SpecBand.tsx` má natvrdo zadrátované rozměry karty v plánu
(10px font, `zIndex: 2` kvůli gradientu bloku) — natáhnout ho na třetí velikost by
z něj udělalo komponentu, kterou nikdo nepřečte. Fronta si kreslí vlastní pás ze
sdíleného literálu `SPEC_HIGHLIGHT` (`src/lib/blockStyles.ts`), stejně jako to už
dělala velká karta Monitoru. **Sdílená pravda je barva, ne rozměry.**

### Další rozhodnutí

- **Sada chipů: úplně všechny**, záměrně — stejná sada a pořadí jako na velké kartě
  (OBÁLKA → VNITŘKY → tiskové archy → série → data → materiál → PANTONE → varianta).
  Většina zakázek nemá vyplněná všechna pole, takže řádky v praxi na plnou sadu
  nenabobtnají. Zúžení sady je levné rozhodnutí na později z reálného provozu —
  hádat se o něm dopředu nad prázdnými poli není.
- **Dokončená zakázka ztlumí i amber pás** — stávající `opacity: 0.5` pokrývá celý
  řádek. Hotová zakázka nemá na stroj křičet stejně nahlas jako ta, co se právě tiskne.
- **Zakázka bez `specifikace` nevykreslí pás ani prázdnou mezeru navíc** — řádek je
  flex column s `gap: 7`, takže falsy větev nevykreslí vůbec nic.
- **Čtyři layoutové varianty byly porovnány předem** (plná karta / kompakt s pásem
  na horním řádku / rozbalené jen nejbližší N / amber lišta po straně). Vyhrála „plná
  karta" — fronta stroje má denně jen 4–8 zakázek, takže úspora místa u hustší
  varianty nevyváží ztrátu čitelnosti — a drží se tím jeden vizuální vzor napříč
  aplikací: amber pás v plánu, na velké kartě i ve frontě znamená totéž.

### Ověření

Celá test suite zelená (954 testů, z toho 8 nových), `tsc --noEmit`/`lint`/`build`
čisté. Proklikáno na datech `prisma/seed-monitor.ts` jako role `TISKAR` v dark
i light módu: pás a chipy se vykreslí, zakázka bez specifikace nemá pás ani mezeru,
`Pozastaveno` je červený chip, chybějící data i objednané archy čtou v amber tónu
„čeká", dokončená zakázka je ztlumená i s pásem, zakázka na velké kartě má ve frontě
zelený obrys a chipy velké karty jsou po extrakci beze změny.

### Klíčové soubory

`src/lib/monitorChips.ts` (+ testy) · `src/components/monitor/MonitorChips.tsx` ·
`src/components/monitor/MonitorQueue.tsx`.

## Monitor u stroje — domovská obrazovka tiskaře (10. 8. 2026)

Tiskař u stroje viděl **stejnou plánovací timeline jako plánovač** a musel v ní svou
zakázku hledat na ose přes šest dní. Monitor to nahrazuje: vlevo velká karta zakázky,
kterou má právě na starosti, vpravo fronta. Plán zůstal dostupný tlačítkem
**„Celý plán →"**, zpět šipkou **„← Monitor"**.

Tři etapy, tři specifikace v `docs/superpowers/specs/`:
`2026-08-10-monitor-u-stroje-design.md` (obrazovka) ·
`…-monitor-potvrzeni-odklepnuti-design.md` (držení karty + potvrzování) ·
`…-monitor-rucni-vyber-zakazky-design.md` (ruční výběr).

### Klíčová rozhodnutí

- **Není to třetí záložka.** Kioskový launcher u stroje už jednu úroveň přepínání má
  (Sběr dat ↔ Plánování), takže Monitor je **domovská obrazovka** a plán je odbočka,
  ne rovnocenná záložka. Launcher se kvůli Monitoru neměnil vůbec — jeho záložka
  Plánování vkládá `/`, a to pro roli `TISKAR` vykreslí Monitor.
- **Nic se nezapisuje do databáze.** Když tiskař zakázku přeskočí, zůstane
  neodklepnutá a po uplynutí času ji `BlockCard` vyhodnotí jako `isOverdue` a vykreslí
  oranžově — plánovač ji v plánu uvidí sám od sebe. Žádné pole „začátek tisku“,
  žádná migrace.
- **Karta se nikdy nepřepne sama.** Po odklepnutí drží hotovou zakázku s tlačítky
  **Vrátit** / **Další →**, dokud tiskař nerozhodne (vědomá volba předvídatelnosti).
- **Potvrzení na dvě kliknutí** u zakázky, která ještě nezačala, a u tlačítka Vrátit.
  U běžící a přetahující se nepotvrzuje — je to očekávaný úkon.

### Pravidla (čistá logika v `src/lib/monitorView.ts`, pokryto testy)

| Funkce | Co dělá |
| --- | --- |
| `pickHeroBlock` | automatický výběr: `running` → `overdue` → `upcoming` |
| `resolveSelectedBlock` | ručně vybraná zakázka; pustí ji, když zmizí nebo se přesune na jiný stroj |
| `resolveStickyBlock` | zakázka držená po odklepnutí; pustí ji, když přestane být odklepnutá |
| `reasonForBlock` | stav podle času, **bez** 16h okna — to je pravidlo výběru, ne zobrazení |
| `monitorQueue` | fronta na **dnešek + zítřek**, jen `ZAKAZKA`, odklepnuté zůstávají |
| `startDayLabel` | `null` / `"zítra"` / `"13. 08."` — porovnává civilní pražské dny |

**Priorita karty:** ruční výběr → držená (odklepnutá) → automatika. Klik ve frontě je
vědomá akce a přebije i držení; vrátit odklepnutí jde pak přes klik na hotovou zakázku
ve frontě.

**`OVERDUE_WINDOW_MS` = 16 h se počítá od KONCE zakázky, ne podle dne startu.** Původní
návrh vázal `overdue` na pražský den startu a tím shodil noční směnu: zakázka 22:00–6:00
by v 8:00 ráno z Monitoru zmizela, protože „nezačala dnes“.

### Gotchy, které stály čas

- **`now` netiká, když je timeline odmontovaná.** Tikající `now` je uvnitř
  `TimelineGrid` — a tu Monitor nahrazuje. Bez vlastního intervalu byl Monitor
  zamrzlý snímek; v noci, kdy plánovač nic nemění a nechodí SSE, by ve 2:40 pořád
  hlásil „TEĎ BĚŽÍ“ a odpočet z 23:10. `MonitorView` má proto vlastní tik po 15 s.
- **`now` musí startovat jako `null`.** `useState(() => new Date())` se vyhodnotí i při
  serverovém renderu a serverový čas se nikdy netrefí do klientského na milisekundu →
  hydration error na šířce pruhu postupu. Stejný vzor jako `TimelineGrid`.
- **Držení se musí nastavit synchronně, ne v `.then()`.** `handlePrintComplete`
  aktualizuje bloky optimisticky ještě před odpovědí serveru, takže by se karta
  v mezidobí přepnula na cizí zakázku — a při odpovědi delší než 800 ms by šla
  odklepnout.
- **Zámek proti dvojkliku patří na všechna tři tlačítka.** HOTOVO, Vrátit i Další →
  se objevují na tomtéž místě obrazovky; bez zámku dvojklik na Další odklepl
  následující zakázku.
- **Pozastavená zakázka musí být na kartě poznat** (červený štítek z `VARIANT_CONFIG`) —
  jinak vypadá jako běžná a tiskař ji vytiskne.
- **Specifikace má i na Monitoru amber pás** (`SPEC_HIGHLIGHT`, stejné literály jako
  `SpecBand` v plánu) — jako šedý text ji tiskař přehlédne.

### Klíčové soubory

`src/lib/monitorView.ts` (+ testy) · `src/components/monitor/MonitorView.tsx` ·
`src/components/monitor/MonitorQueue.tsx` · `src/components/planner/PrintDoneButton.tsx`
(varianty `bar`/`square`/`hero` + potvrzovací podoba) · `src/app/_components/PlannerPage.tsx`
(stav `tiskarView`, větev pro `isTiskar`). Nový token `--success-contrast` v `globals.css`.

**Testovací data:** `npx tsx prisma/seed-monitor.ts` (dev only) — časy relativní k okamžiku
spuštění, protože Monitor ukazuje jen dnešek a zítřek. Skript dodržuje pravidla aplikace
(30minutová hranice startu, délka násobek 30 min, štítky z `CodebookOption`) a před zápisem
si je ověří; bez toho nejdou vygenerované bloky v plánu uložit.

### Známá omezení (vědomě přijatá)

- Držení karty ani ruční výběr **nemají expiraci** — přežijí i předání směny.
- „zpět na doporučené“ po sledu *odklepnu A → vyberu B* vrátí na A (držení), ne na
  doporučenou zakázku.
- Zakázky dál než zítřek se hledají tlačítkem **Najít**, které skáče do plánu.
- V plánu jde nezačatá zakázka pořád odklepnout jedním kliknutím bez potvrzení.

## Tlačítko Hotovo u stroje — tiskařský režim (3. 8. 2026)

Terminál u tiskového stroje se ovládá myší z odstupu, ale tlačítko „Hotovo" bylo
navržené pro plánovače u stolu: text 11 px, cíl ~26 × 62 px v rohu karty, pozadí
`rgba(34,197,94,0.3)` se zeleným textem (zelená na zelené, na dálku vybledlá) —
a barvy natvrdo, tedy rozbitý světlý režim.

**Co se změnilo** (spec `2026-08-03-tlacitko-hotovo-tiskar-design.md`, plán
`2026-08-03-tlacitko-hotovo-tiskar.md`):

- Rozhodovací pravidla jsou v `src/lib/tiskarBlockView.ts` (čistá logika, 9 testů):
  `printDoneSize(layoutHeight)` a `isBlockRunningNow(start, end, now, isDone)`.
- Vzhled je v jediné komponentě `src/components/planner/PrintDoneButton.tsx`,
  která nahradila **tři téměř shodné kopie** tlačítka v `BlockCard.tsx`
  (MODE_FULL / MODE_COMPACT / MODE_TINY+MICRO).
- Velikost podle výšky bloku: ≥ 140 px → pruh 40 px, 96–139 → 32 px, 48–95 → 24 px
  (vždy přes celou šířku karty), 14–47 px → čtverec 26 px, pod 14 px nic.
  Prahy navazují na existující layout režimy karty.
- Plná `var(--success)` s novým tokenem **`--success-contrast`** (obě témata).
- Blok, jehož tisk právě běží, má zelený prstenec a zesílený levý pruh (3 → 5 px).
  Vyhodnocuje se z propu `now`, který `BlockCard` už dostával — žádný nový časovač.

**Vědomá rozhodnutí:** bez potvrzovacího mezikroku (akce je vratná, ovládá se myší);
bez samostatné obrazovky „Monitor" a přepínače Monitor ↔ Plán, protože kioskový
launcher už jednu úroveň přepínání má (Sběr dat ↔ Plánování) a druhá by byla
nepřehledná. Ztlumení hotových bloků se nedělalo — `BLOCK_PRINT_DONE` ho už řeší.

**Gotchy odchycené závěrečným review:** pruh Hotovo se musí renderovat **až za**
SplitChipem, jinak ho u split zakázky vytlačí mimo kartu (`overflow: hidden`);
resize handle se tiskaři nevykresluje vůbec (`!block.locked && !isTiskar`), protože
mu jinak ukusoval pravý dolní roh tlačítka a stejně nemá právo měnit délku bloku.

**Známá kosmetika (backlog):** prstenec běžícího bloku má dole jen tři strany —
navazující blok na témže stroji má stejný z-index a přemaluje spodní 2 px.

## Chain push pro všechny typy bloků (31. 7. 2026)

Do 31. 7. 2026 platilo: zakázku šlo přetáhnout na obsazené místo (server odsunul
navazující bloky — chain push), ale rezervace a údržba to odmítly chybou „blok
koliduje". Ověřeno spuštěním kódu z doby před auditem, že šlo o **záměrné původní
chování** (spec `2026-07-16-overlap-guard-all-types-design.md`, pravidla R4/R5),
ne o regresi. Rozhodnutím majitele se sjednotilo: **všechny typy se chovají stejně**.

**Proč to nešlo udělat prostým odblokováním:** chain push posouvá bloky přes
tiskové hodiny — délku bere z `printMinutes`, zaokrouhluje na 30 minut a blok
roztahuje přes pauzy směn. U rezervací by to změnilo jejich délku (45 min → 30 min)
a přes víkend by je natáhlo. Proto vznikla **třetí geometrie posunu — rigidní blok**:
přesná délka, žádné roztažení, start přes `snapToNextValidStartWithTemplates`
(týž helper, jaký používá ruční přetažení na klientovi), horizont 7 dní.

**Co zůstává zdí** (multi-agent review odhalil, že bez toho by se plán rozsypal):
zamčený blok · potvrzený tisk · rigidní blok, který na své současné pozici
nevyhovuje kalendáři (víkendová údržba, servis uvnitř celozávodní odstávky —
posun by je vystěhoval do výroby) · sourozenci z téže dávky v batchi.

**Klíčové soubory:** `src/lib/overlapResolver.ts` (`placeRigidAfter`, `rigid` flag,
`MAX_RIGID_PUSH_MS`) · `src/lib/overlapResolver.server.ts` (`chainPushGeometry` jako
jediný zdroj pravdy pro push i jeho pojistku, `frozenIds`) · gate odblokován v POST,
PUT a batch; self-shift rezervace se s `resolveChain` už neuplatní.

**Známé omezení (backlog):** `Reservation.scheduledStartTime/EndTime` se při chain
pushi neaktualizují a obchodník nedostane notifikaci · Ctrl+Z po vytvoření bloku
nevrací odsunuté bloky (starší díra, s odsouváním rezervací větší dopad) · série
rezervací z fronty nově odsouvá výrobu místo aby uhýbala.


## Co aplikace umí

### 1. Planner

- hlavní planner běží na `/`
- timeline pro stroje `XL_105` a `XL_106`
- drag & drop z fronty, resize, split zakázek, batch přesuny, copy/paste
- provozní hodiny per-týden přes `MachineWeekShifts` (flag-only model)
- odstávky přes `CompanyDay`
- audit změn bloků
- potvrzení tisku

### 2. Rezervace

- samostatný modul na `/rezervace`
- role `OBCHODNIK` může zakládat a sledovat vlastní rezervace
- role `ADMIN` a `PLANOVAT` rezervace přijímají, připravují do fronty, zamítají a plánují
- stavový tok:
  - `SUBMITTED`
  - `ACCEPTED`
  - `QUEUE_READY`
  - `SCHEDULED`
  - `REJECTED`
- rezervace mají přílohy ukládané na filesystem

### 3. Admin

- `/admin` má taby:
  - uživatelé
  - číselníky
  - presety
  - audit
  - pracovní doba
- `PLANOVAT` má omezený admin pohled: číselníky, presety, pracovní doba

### 4. Notifikace

- role-based notifikace pro `DTP` a `MTZ`
- user-targeted notifikace pro `OBCHODNIK`
- `ADMIN` a `PLANOVAT` vidí historii notifikací a auditní aktivitu

### 5. Reporty

- denní report na `/report/daily?date=YYYY-MM-DD`
- tiskové rozložení A4 landscape
- API `GET /api/report/daily`


## Historie etap (changelog)

- modul `/expedice` je nasazen na produkci (deploy 12. 4. 2026)
- audit remediation dokončen 15.–16. 4. 2026 (Sprinty 1–5)
- copy/paste UX fix dokončen 27. 5. 2026 (5 Tasků, plán `docs/superpowers/plans/2026-05-27-copy-paste-ux-fix.md`)
- clipboard text-copy fix (HTTP secure-context) 27. 5. 2026 (helper `src/lib/clipboardCopy.ts`)
- tiskové hodiny — etapa 4 (klientské mutační cesty + 40h dropdown) dokončena 2. 7. 2026 — viz sekci „Klientské mutační cesty" níže
- tiskové hodiny — etapa 5 (vykreslení pauz + poctivé náhledy + deadline štítek + rezervace 40 h) dokončena 2. 7. 2026 — viz sekci „Vykreslení pauz a poctivé náhledy" níže
- tiskové hodiny — etapa 6 (kalendářní revalidace: drift detekce, notifikace, reflow endpointy, sticky-bypass split fix) dokončena 3. 7. 2026 — viz sekci „Kalendářní revalidace" níže
- tiskové hodiny — etapa 7 (reporty přes tiskové hodiny: retro/outlook dashboard + denní report počítají vytížení z tiskového času, ne z kalendářní délky bloku) dokončena 4. 7. 2026 — viz sekci „Reporty přes tiskové hodiny" níže
- tiskové hodiny — etapa 8 FINÁLE (multi-agent review celé featury 5 lens + fix wave + Gardena 27h důkaz na dev DB) dokončena 5. 7. 2026 — viz sekci „Finále featury" níže; deploy checklist: `docs/superpowers/plans/2026-07-05-tiskove-hodiny-deploy-checklist.md`
- 4 body z auditu plánovače (pásy směn, MICRO text, Σ split, cut=přesun) dokončeny 9. 7. 2026 — viz sekci „4 body z auditu plánovače" níže; spec `docs/superpowers/specs/2026-07-09-planovac-4-body-design.md`, plán `docs/superpowers/plans/2026-07-09-planovac-4-body.md`
- výrobní štítky do vstupního builderu (OBÁLKA/VNITŘKY + Tiskové archy + Série) dokončeny 15. 7. 2026 — dřív šly nastavit jen v editaci bloku (BlockEdit, ZAKAZKA-only); nově i při zadávání. Sdílená komponenta `src/components/planner/ProductionTagsRow.tsx` (BlockEdit i JobBuilderPanel), štítky protékají builder stav → `QueueItem` → POST (serializace přes `serializeProductionTags` v `handleQueueDrop`); u série se řádek skryje a štítky zůstávají prázdné (nastaví se editací). Žádná změna DB/API. Subagent-driven (6 tasků, review-clean), 392 testů zelené. Spec `docs/superpowers/specs/2026-07-15-vyrobni-stitky-do-builderu-design.md`, plán `docs/superpowers/plans/2026-07-15-vyrobni-stitky-do-builderu.md`
- overlap guard rozšířen na VŠECHNY typy bloků (dřív jen ZAKAZKA) dokončeno 16. 7. 2026 — `assertNoOverlapForBlocks`/`checkBlockOverlap` (`src/lib/overlapCheck.ts`) byly odjakživa type-agnostické, gating byl roztroušený v call-siteech napříč 5 zápisovými cestami: POST `/api/blocks`, PUT `/api/blocks/[id]`, POST `/api/blocks/batch`, POST `/api/blocks/[id]/split`, `reflowBlockInTx`/`reflowMachineInTx` (`src/lib/reflow.server.ts`). Chain-push nově bere REZERVACE/UDRZBA jako pevnou překážku stejně jako ZAKAZKA; POST má vlastní REZERVACE self-shift větev (queue-drop na obsazený slot se auto-posune, ne odmítne); reflow endpointy nově volají finální pojistku vůbec poprvé (byl to reálný bug — i ZAKAZKA-only záruka šla přes reflow prolomit, opraveno mimochodem). Batch (lasso) self-shift zůstává vědomý known-gap. Test `src/lib/overlapCheck.test.ts` fixuje invariant „net chytí překryv bez ohledu na typ". Spec `docs/superpowers/specs/2026-07-16-overlap-guard-all-types-design.md`, plán `docs/superpowers/plans/2026-07-16-overlap-guard-all-types.md`
- audit kvality kódu a designu — etapa **Audit Top 5** (plán `docs/superpowers/plans/2026-07-11-etapa-audit-top5.md`): fáze A (light-mode hotfixy, focus-visible), B (úklid mrtvého kódu vč. smazání `/tiskar`), C (jeden zdroj pravdy — blockPayload/errorStatus/requireRole/blockStyles) hotové; fáze D část 1 (sdílené UI kameny: `zLayers` kanonická z-index škála + `ConfirmDialog`) hotová 13. 7. 2026 — multi-agent review 3 lens, 0 critical/important. Fáze D část 2 (NativeSelect, PrimaryCta, ModuleHeader, uiStyles) hotová 14. 7. 2026 — viz sekci „Design tokens a vizuální konvence"; build+392 testů+lint 0 chyb. Fáze E1+E2 (hlavní kusy) hotové 14. 7. 2026 — dekompozice dvou největších souborů, každá extrakce ověřena adversariálním multi-lens review (0 nálezů): **PlannerPage 4170 → 2647 ř.** (E1: ShutdownManager/MachinePicker/ResizeHandle → `src/components/planner/`; Job Builder → `useJobBuilder` + `JobBuilderPanel`); **TimelineGrid 3942 → 2355 ř.** (E2: BlockCard + privátní helpery → `src/components/planner/BlockCard.tsx`); **AdminDashboard 1420 → 142 ř.** (E2: Users/Codebook/Presets sekce → vlastní soubory + `adminShared.ts`); BlockEdit #30 (SectionLabel/ColLabel/StatusSelect → module scope). Vědomě odloženo (cut-candidates dle plánu / ultracode analýzy): E1(iii) SSE/useBlockSync (HIGH risk / kosmetická výhoda), E2 DateChipRow (#15 tooltip), E2 useTimelineDrag (drag = core interakce)
- split-skupiny — **root-cause fix (varianta B2)**, v kódu na větvi Vojta 13. 7. 2026 (deploy na produkci = Fáze 7, čeká): `Block.splitGroupId` re-pointnut ze self-FK na `Block.id` na novou tabulku `SplitGroup`. Smazání kteréhokoli člena (vč. rootu) už skupinu NErozpustí (FK `ON DELETE SET NULL` míří na `SplitGroup.id`, ne na sourozence) → Ctrl+Z undo obnoví 3/3. Nahradilo dřívější symptom-fix `restoreSplitGroupId` (smazán). Split vzniká atomicky přes `POST /api/blocks/[id]/split`. Fáze 1–6 hotové (E2E na dev 6/6 vč. „smaž root → undo = 3/3", migrace SQL review 0 kritických). Plán `docs/superpowers/plans/2026-07-13-split-group-b2.md` — viz sekci „Split-skupiny (tabulka SplitGroup, B2)" níže

## Split-skupiny — tabulka SplitGroup (B2)

Root-cause oprava undo bugu u split zakázek. **Dřív:** `Block.splitGroupId` byl self-FK na `Block.id` (root skupiny měl `splitGroupId === vlastní id`, `ON DELETE SET NULL`). Smazání rootu nullovalo `splitGroupId` u sourozenců → skupina se rozpustila a Ctrl+Z undo obnovil jen 2/3. **Teď (B2):** samostatná tabulka `SplitGroup(id, createdAt)`; `Block.splitGroupId` je FK na `SplitGroup.id`. Smazání *člena* (i rootu) se `SplitGroup` řádku nedotkne → ostatní členové drží FK a undo obnoví 3/3.

- **Migrace** `prisma/migrations/20260713120000_split_group_table`: `CREATE TABLE SplitGroup` (`id INTEGER UNSIGNED`) → backfill `INSERT DISTINCT splitGroupId` (⇒ `SplitGroup.id` = staré root PK, žádný `Block` řádek se nemění) → DROP starý self-FK → `ALTER Block MODIFY splitGroupId INTEGER UNSIGNED` (no-op na produkci, kde už unsigned je; na dev konvertuje signed→unsigned) → ADD FK na `SplitGroup(id) ON DELETE SET NULL`. Psaná ručně (shadow-DB na tomto projektu neprojde starou UNSIGNED migraci).
- **Vznik splitu**: atomický `POST /api/blocks/[id]/split` (`requireRole ADMIN/PLANOVAT`) — v jedné transakci: optimistický zámek, guardy (printCompleted, splitAt uvnitř / pauza), `computeSplitPrintMinutes` (`src/lib/splitCompute.ts`), create/reuse `SplitGroup`, head přes `validateAndComputeEnd`, tail create, audit, chain push, overlap re-check, SSE. Klient (`TimelineGrid.handleSplitBlockAt`) volá jeden endpoint místo dřívější 3-request orchestrace.
- **Konzumenti skupiny** dotazují členství VÝHRADNĚ přes `splitGroupId` (`where: { splitGroupId: X }`), NIKDY `id === splitGroupId` — `Block.id` a `SplitGroup.id` jsou nezávislé id-prostory (numerická shoda nic neznamená). `orderIdentity` v `blockShades.ts` proto namespacuje `g${splitGroupId}`/`b${id}` (jinak by skupina zdědila odstín souseda).
- **Undo** posílá `splitGroupId` přes `blockToCreatePayload` opts; POST `/api/blocks` guard ověří existenci `SplitGroup` řádku (`VALIDATION_ERROR` → 400 místo FK 500). Symptom-fix `restoreSplitGroupId` je **smazán**.
- **Propagace shared fields (PUT)**: editace sdíleného pole se přes `updateMany` propaguje na sourozence skupiny; PUT je pak refetchne, broadcastuje (`block:batch-updated`) a vrátí v odpovědi jako `siblings` — jinak klient drží stale `updatedAt` sourozenců a další split sourozence spadne na falešný 409 (#9/#12). Undo cesta (`buildEditCommand`) sourozence aplikuje symetricky (`effects.addToState`). Sourozenci už v `shifted` (chain push) se z `siblings` filtrují. Stejný vzor řeší i **`expedition` route** (reorder/publish/unpublish) přes `expeditionSiblingResponse` — refetch primárního bloku + sourozenců (s notes), broadcast `block:batch-updated`, vrátit `siblings` v odpovědi; planner klient (`handleExpeditionPublish/Unpublish`) je aplikuje přes `applyServerBlocks`, BlockDetail přes `handleBlockUpdate`.
- **Deploy gotchy (Fáze 7)**: MySQL DDL je auto-commit (3 statementy nejsou atomické) → app-stop + orphan pre-check před migrací; `MODIFY … UNSIGNED` je na prod MariaDB 10.11 no-op; osiřelé `SplitGroup` řádky (po smazání posledního člena) jsou neškodné (2 sloupce, žádný FK crash) a naopak posilují undo — produkce je nikdy nemaže.
- **Hlavní soubory**: `prisma/schema.prisma` (model `SplitGroup`, relace `BlockSplitGroup`), `src/app/api/blocks/[id]/split/route.ts`, `src/lib/splitCompute.ts` (+ testy), `src/lib/blockShades.ts` (`orderIdentity`), `src/lib/blockPayload.ts` (`blockToCreatePayload` opts).

## Tiskové hodiny — implementační detail (etapy 4–8) + 4 body auditu plánovače

Chain push (`resolveChainPushFromDb`) a auto-shift (`findNextFreePrintSlotFromDb`) od etapy 3
umísťují bloky přes start-only snap (`snapStartToNextRunnableSlot`) + `expandPrintTime` podle
per-blok `printMinutes` a `scheduleBypassed` — odsunutý blok smí pauznout přes odstávku a jeho
end vždy sedí na kalendář. Kolize se zamčeným/vytištěným blokem = odmítnutí transakce s hláškou
(žádné tiché přeskládání). Limit auto-shiftu (7 dní) platí pro posun STARTU, ne endu.
Automatika dělí blok pauzou jen když každý tiskový kus ≥ 1 h (`MIN_PRINT_SEGMENT_MINUTES`,
helper `violatesMinPrintSegment`); jinak blok posune celý za odstávku (fallback z nouze
pauzu povolí, když se blok nevejde nikam). Ruční umístění pravidlu nepodléhá.
Stará duration-based `findNextFreeSlot`/`findNextFreeSlotFromDb` zůstává jen pro klientské
preview a ne-ZAKAZKA bloky.

#### Klientské mutační cesty (etapa 4, 2. 7. 2026)

Všechny klientské mutační cesty, které mění `startTime`/`machine` bloku typu ZAKAZKA, posílají
na server `printMinutes` (nikdy naivní `endTime` jako zdroj pravdy) a snapují **jen start** přes
`snapStartToNextRunnableSlot` (`src/lib/printTime.ts`) — nikdy starý duration-based
`snapToNextValidStartWithTemplates`. End vždy dopočítá server (`validateAndComputeEnd`).
Týká se: drag jednoho bloku, multi-move (lasso), Ctrl+V paste, group paste, queue drop (blok z
fronty do gridu) a série (opakující se bloky). Editace přes `BlockEdit` posílá `printMinutes`
stejně. Ne-ZAKAZKA bloky (UDRZBA, …) tímto beze změny — zůstávají na duration-based snapu.

Klientské helpery pro tyto cesty žijí v `src/lib/printTimeClient.ts` (klient-safe, žádný DB
import):
- `blockPrintMinutes(block)` — `printMinutes` pro ZAKAZKA (fallback elapsed zarovnaný na 30min
  grid, min 30), elapsed pro ostatní typy.
- `companyDayIntervalsFor(machine, companyDays)` — převod klientských `CompanyDay` záznamů na
  intervaly pro daný stroj (global + machine-specific).
- `snapGroupDeltaStartOnly(blocks, deltaMs, weekShifts, companyDays)` — skupinový start-only snap
  pro lasso přesun; vrací `null`, když některý start nejde v horizontu umístit (mutace se
  neodešle).

Resize zůstává **klientsky beze změny** — server je autoritativní pro end už od etapy 2
(inverze `computePrintMinutes`), klient jen odesílá nový čas a server dopočítá zbytek.

`DURATION_OPTIONS` (`src/lib/plannerTypes.ts`) má strop **40 h** (80× 30min krok = 2400 min),
což odpovídá `MAX_PRINT_MINUTES` v `src/lib/printTime.ts` — dropdown proto nikdy nenabídne
hodnotu, kterou by server odmítl.

Mezistavy etapy 4 (drag preview a paste marker kreslily duration-based snap a u bloků
pauznutých přes odstávku lhaly o výsledné pozici/délce) jsou od etapy 5 **VYŘEŠENÉ** —
viz následující sekci.

#### Vykreslení pauz a poctivé náhledy (etapa 5, 2. 7. 2026)

Blok ZAKAZKA, který přes tiskové hodiny pauzne (odstávka / mimo provoz uvnitř intervalu),
se kreslí jako JEDEN div přes celý interval start–end; pauzy uvnitř jsou overlay (ztmavený
„můstek" s přerušovanými vodorovnými okraji a štítkem „⏸ PAUZA — mimo provoz" od 40 px
výšky). Levý accent bar bloku zůstává průběžný — pauza se tak vizuálně odliší od splitu
(split = samostatné bloky s ✂ chipy).

- `getBlockSegments(block, weekShifts, companyDays)` (`src/lib/printTimeClient.ts`) vrací
  `PrintSegment[]` jen když overlay dává smysl: ZAKAZKA, ne bypass, platné `printMinutes`,
  zarovnaný start, expanze uspěje A sedí na uložený `endTime`, a obsahuje aspoň jednu pauzu.
  Jinak `null` → blok se kreslí slitě beze změny (99 % plánu). `TimelineGrid` segmenty
  předpočítává v `useMemo` mapě (`blockSegmentsMap`, O(1) lookup per blok; memo je záměrně
  před early-returnem komponenty — rules-of-hooks).
- Layout mode karty (`MODE_FULL`/`MODE_COMPACT`/`MODE_TINY` + prahy pro datové řádky,
  specifikaci a popis) se u segmentovaného bloku řídí výškou PRVNÍHO print segmentu
  (`contentHeight`), ne celkovou výškou divu — obsah karty nepropadne do vizuální pauzy.
- **Poctivé náhledy** (jen ZAKAZKA + zapnutý zámek pracovní doby, ne bypass blok; při
  selhání expanze fallback na starou naivní geometrii — preview nikdy neblokuje drag):
  - drag ghost: výška z expanze `printMinutes` na kandidátním startu (ne původní výška),
  - resize: live snap endu na hranu tiskového segmentu (`computePrintMinutes` →
    re-expanze; alignment guard vynechá legacy bloky s nezarovnaným startem) + tooltip
    „X h tisku (Y h celkem)" (`dragPreview.resizePrintMinutes`),
  - queue drop preview: start-only snap + výška z expanze místo `durationHours × slot`,
  - paste marker: viz sekce Copy/Paste flow níže.

  Expanze v mousemove smyčce jde přes module-scope cache (`expandPrintTimeCached`, klíč
  `machine|start|pm`), čištěnou při každém mousedown / startu queue dragu.
- **Deadline štítek**: ZAKAZKA, jejíž `endTime` je civilně (Praha) PO datu
  `deadlineExpedice`, dostane červený badge „⚠ PO DEADLINE" (v TINY módu jen „⚠",
  pod TINY nic) v pravém horním rohu; 📝 badge tiskařských poznámek se v tom případě
  odsune níž. Nezávislé na `isOverdue` (ten srovnává konec bloku s `now`).
- **Délky „tisk vs. celkem"**: hover tooltip bloku („Tisk: X h · Celkem: Y h"),
  `BlockDetail` (řádek Délka — „X hod tisku (Y hod celkem)") i `DtpPanel`
  („Tisk X hod · celkem Y hod") zobrazují u ZAKAZKA s `printMinutes ≠ elapsed` obě
  hodnoty; jinak prostou délku. Zdroj: `blockPrintMinutes` z `printTimeClient.ts`.
- **Split**: default bod = `printMidpoint` (polovina TISKOVÝCH minut, ne kalendářní
  střed osy); když degeneruje mimo vnitřek bloku (malé pm po zaokrouhlení na slot),
  fallback na kalendářní střed. Split uvnitř pauzy je zakázán guardem
  (`isMachineRunnableAt`) s toastem „Nelze rozdělit uvnitř pauzy" — jinak by hlava
  commitla PUT a tail POST spadl na 422 až po ní (rozbitý mezistav). Bypass blok dál
  dělí elapsed-based.
- **Rezervace**: `PlanningForm` (`/rezervace`) používá sdílené `DURATION_OPTIONS`
  z `src/lib/plannerTypes.ts` (strop 40 h) místo dřívější vlastní 24h kopie.
- **AUTO_SHIFT audit** (POST `/api/blocks`, PUT `[id]`, batch): `field:
  "startTime/endTime"`, old/new hodnoty jsou span `"<startISO>–<endISO>"` (en-dash) —
  end se při odsunu re-expanduje, takže patří do auditu. `fmtAuditVal`
  (`src/lib/auditFormatters.ts`) má en-dash-aware větev se striktním ISO guardem
  (formátuje jen `"<ISO>–<ISO>"` páry — český free-text s pomlčkou propadá na raw;
  batch UPDATE řádky s machine prefixem se dál renderují surově jako dřív). Pozn.:
  self-shift AUTO_SHIFT řádek v PUT
  (`[id]/route.ts`) zůstává single-ISO (jiná datová cesta) — formatter zvládá oba
  tvary. POST shifted-refetch nově includuje `notes` (parita SSE payloadu s ostatními
  cestami). TODO komentáře k elapsed fallbacku v POST/batch přeformulovány na trvalý
  stav — fallback kryje legacy bloky (pm=null) a přímé API klienty, NELZE ho odstranit.

Zbývající vědomé mezistavy (etapa 7 / nízká priorita, viz i sekci níže):

1. **Smíšené lasso** (ZAKAZKA + ne-ZAKAZKA dohromady) dál používá duration-based skupinový
   snap — vzácný případ.
2. **Série preview** v builderu dál duration-based (kolizní vizuál) — samotné mutace série
   jsou správně (start-only + printMinutes).

#### Kalendářní revalidace (etapa 6, 3. 7. 2026)

Mezistav „drift kalendáře" z etapy 5 (blok, jehož uložený `endTime` po dodatečné změně
pracovní doby / odstávky nesedí na živou expanzi) je od etapy 6 detekován a nabízí opravu —
**bez jakékoli nové DB kolony**: drift se nikdy neukládá, jen počítá za běhu.

- **Detekce**: `blockCalendarDrift` (klient, `printTimeClient.ts`) počítá drift živě pro
  vykreslení; `detectCalendarDrift` (server, `src/lib/calendarDrift.server.ts`) běží jen
  jako vedlejší efekt mutace kalendáře (ne na každý request). Obě strany volají tutéž
  `expandPrintTime` — žádná duplicitní logika. Podmínky shodné na obou stranách: ZAKAZKA,
  ne bypass, `printMinutes > 0`, zarovnaný start, ne `printCompleted`, `endTime > now`.
- **Notifikace**: `notifyCalendarDrift` (`calendarDrift.server.ts`) zapisuje `Notification`
  (`CALENDAR_DRIFT`, targetRole `PLANOVAT`/`ADMIN`) po zápisu, který mohl posunout kalendář —
  `machine-week-shifts` PUT (force i ne-force), `ensureWeekSeeded` (jen po reálném seedu),
  `company-days` POST/PUT/DELETE (+ SSE `schedule:changed`). Nezávislý mechanismus od
  `AuditLog` — detekce samotná nic neupravuje (čisté READ přes `block.findMany` + expanze).
- **Reflow endpointy**: `reflowBlockInTx`/`reflowMachineInTx` (`src/lib/reflow.server.ts`) +
  `POST /api/blocks/[id]/reflow` (jeden blok) a `POST /api/blocks/reflow` (celý stroj,
  okno 365 dní) re-expandují blok a spustí chain push v transakci; zamčené/vytištěné bloky
  se přeskočí, kolize s chain pushem = `AppError` a rollback celé transakce (žádný částečný
  zápis). Audit řádek má action `AUTO_REFLOW` (field `"startTime/endTime"`, en-dash span,
  `fmtAuditVal` ho renderuje stejně jako `AUTO_SHIFT`) — záměrně JINÁ akce než `UPDATE`, aby
  dashboard stability (filtruje `action=UPDATE`) reflow nezapočítával jako nestabilitu.
- **`findConflictingBlocks`** (validace při editaci `machine-week-shifts`, TOCTOU re-check;
  `company-days` mění kalendář bez blokace — jen drift notifikace dle spec 3.9) má nově
  okno `[W, W+7d+6h)` (`computeConflictWindow`/`conflictWindowWhere`/
  `neighborWeekStarts`) a bere v potaz i DB řádky **sousedních týdnů** — stejný „noční směna
  přes půlnoc" vzor, který opravil fix 5c u `loadMachineCalendar`, platil i zde (editace
  týdne W mohla neviditelně rozbít bloky začínající Po 0:00–6:00 týdne W+1).
- **Sticky-bypass split fix**: split bloku typu ZAKAZKA se `scheduleBypassed=true` posílal
  na head `PUT` jen `endTime` (bez `printMinutes`/bypass flagu) → server ho zpětně
  přepočítal PODLE KALENDÁŘE a hlava ztratila tiskový čas, tail `POST` pak spadl na 422 už
  po commitu hlavy (rozbitý mezistav). Oprava: head PUT bypass zdroje posílá i
  `printMinutes` + `bypassScheduleValidation: true` (elapsed-based dělení); ne-bypass split
  beze změny (server dál nezávisle invertuje `printMinutes` z `endTime`).
- Hlavní soubory: `src/lib/calendarDrift.server.ts`, `src/lib/reflow.server.ts`,
  `src/lib/findConflictingBlocks.ts`, `src/lib/printTimeClient.ts` (`blockCalendarDrift`),
  `src/app/api/blocks/[id]/reflow/route.ts`, `src/app/api/blocks/reflow/route.ts`.
- UI: oranžový badge „⚠ KALENDÁŘ" na bloku (stack pořadí deadline > drift > poznámky),
  banner stroje „⚠ N nesedí na kalendář" s tlačítkem Přepočítat (jen `ADMIN`/`PLANOVAT`),
  `BlockDetail` drift sekce s vlastním Přepočítat, `AUTO_REFLOW` render větev v
  `InfoPanel`/`BlockDetail`.
- Žádná migrace DB, žádný nový sloupec — drift je odvozená hodnota, nikdy persistovaná.

#### Reporty přes tiskové hodiny (etapa 7, 4. 7. 2026)

Retro/outlook dashboard (`/api/report/dashboard`) a denní report (`/api/report/daily` +
`ReportView`) do etapy 7 počítaly vytížení/přítomnost bloku ve směně z kalendářní délky
`endTime - startTime`. To u ZAKAZKA bloku pauznutého přes odstávku nadhodnocovalo vytížení
(pauza se počítala jako produkce) a v denním reportu ukazovalo blok i ve směně, kdy stroj
kvůli pauze reálně stál. Etapa 7 přepíná oba reporty na tiskový čas (`printMinutes` a jeho
průnik se směnou/dnem), se stejným fallback-na-span principem jako etapa 5/6 (ne-ZAKAZKA,
bypass, legacy `printMinutes=null`, drift → počítat konzervativně z celého uloženého spanu).
Vědomý důsledek fallbacku: u DRIFTNUTÉHO bloku se v téže dashboard response rozcházejí
totals (pm) a denní řady (span fallback) — designově inherentní (pm bez segmentů nejde
rozdělit do dnů), tranzientní (drift je stav k opravě přes Přepočítat), konzistentní
s plannerem (kreslí slitý span + oranžový badge).

- **`blockReportSegments(block, weekShifts, companyDays)`** (`src/lib/printTimeClient.ts`) —
  sourozenec `getBlockSegments`: sdílí guard+expanzi (`tryExpandForBlock`), ale na rozdíl od
  něj vrací segmenty i pro souvislý blok BEZ pauzy (reporty potřebují průnik tiskového času
  s oknem vždy, ne jen kvůli overlay) a nevyžaduje přítomnost pauzy. `null` = nelze spolehlivě
  expandovat (guard selhal, expanze selhala, nebo drift — expanze nesedí na uložený `endTime`).
- **`printOverlapMinutes(segments, block, winStart, winEnd)`** (`printTimeClient.ts`) — čistá
  intervalová matematika, okno nemusí být zarovnané na sloty. Se segmenty (ne-null) sčítá
  průnik jen `kind: "print"` segmentů s oknem; bez segmentů (`null`) konzervativně počítá
  průnik celého spanu start–end (fallback pro ne-ZAKAZKA/bypass/legacy/drift bloky).
- **Dashboard retro** (`handleRetro`): `computeBlockHours` (celkové hodiny per stroj/typ) i
  denní `dailyUtilization` řada přešly z elapsed na `printMinutes`
  (`blockDurationHours` v `reportMetrics.ts` — ZAKAZKA `pm/60`, jinak elapsed; fallback elapsed
  když `pm` chybí/neplatné). Denní řada navíc sčítá `printOverlapMinutes` přes segmentovou mapu
  (`segMap`, jedna expanze per blok, ne per den — denní smyčka by ji jinak opakovala až 30×).
  `companyDays` se do `handleRetro` nově fetčí (dřív se selectovaly a zahazovaly).
- **Dashboard outlook** (`handleOutlook`): stejný vzor — `plannedHours`/`dailyCapacity` přes
  `blockDurationHours`/`printOverlapMinutes` + `segMap`; `companyDays` nově fetčováno (dřív
  vůbec, protože outlook segmenty předtím neexistovaly). Response tvary (JSON shape) obou
  handlerů beze změny — mění se jen zdroj čísel uvnitř, ne kontrakt.
- **Okno `weekShifts` fetche** v obou handlerech posunuto z `−7d` na `−28d` před `rangeStart`:
  blok protínající rozsah může začínat až `MAX_SPAN_DAYS` (21 d, `printTime.ts`) před ním a
  expanze navíc potřebuje týden PŘED startem bloku (noční prev-tail, stejný vzor jako fix 5c
  u `loadMachineCalendar`). Legacy bloky mimo pokryté okno bezpečně degradují na fallback span.
- **Denní report** (`GET /api/report/daily`): response se mění z pole bloků na
  `{ blocks, weekShifts, companyDays }` (**breaking change** kontraktu; jediný konzument je
  `ReportView`, upraven současně) — kalendář se fetčuje v okně `±28d` kolem výrobního dne
  (stejné zdůvodnění jako u dashboardu). `ReportView.blockPrintsInShift` nahrazuje starý
  `blockOverlapsShift` (span-overlap) — nová verze volá `printOverlapMinutes` a blok se ve
  směně ukáže, jen když se v ní skutečně tiskne (`> 0` min průniku); fallback span pro
  ne-ZAKAZKA/bypass/legacy/drift zůstává zachován přes `segments === null`.
- **Triage položky** (drobné nálezy z review etapy 6, doklizené v rámci etapy 7):
  - `src/lib/machines.ts` — `MACHINES = ["XL_105", "XL_106"] as const` + `MachineId` typ,
    jediný zdroj pravdy pro seznam strojů; nahradilo 5 lokálních kopií `VALID_MACHINES`/
    `MACHINES` v serverových souborech (`company-days` GET/PUT, `machine-week-shifts`,
    `blocks/reflow`, `report/dashboard`).
  - `company-days` POST/PUT nově validují `endDate > startDate` → 400 „Konec odstávky musí
    být po jejím začátku." (dřív šlo uložit odstávku s koncem před začátkem beze protestu).
  - Obě reflow routes (`[id]/reflow`, `reflow`) mapují Prisma `P2028` (transakce vypršela)
    na 503 „Přepočet trval příliš dlouho — zkuste to znovu, případně po menších částech."
    místo generické 500.
  - `ReflowDeps.preloadedCalendar` (`reflow.server.ts`) — `reflowMachineInTx` načte kalendář
    stroje JEDNOU pro celé okno (`now−1d` až `now + (365+7+21) dní`) a předá ho každému
    dílčímu `reflowBlockInTx` voláním místo aby si každý driftnutý blok tahal vlastní
    kalendář zvlášť (výkon: 1 fetch místo N). Test `reflow.server.test.ts` pinuje přesné
    hranice okna detekce driftu (`[now, now + MACHINE_REFLOW_WINDOW_DAYS d)`, konstanta 365)
    proti tiché budoucí změně.
  - TOCTOU DRY: `assertNoConflictingBlocks`/`fetchConflictingBlocks` (obě nové,
    `findConflictingBlocks.ts`) sdílí jádro (fetch + `detectConflictsPure`) mezi pre-transakční
    `findConflictingBlocks` (info toast před force save) a in-transaction re-check v
    `machine-week-shifts` PUT — dřív měl PUT vlastní duplicitní inline re-check, který mohl
    nezávisle rozjet tvar `where`/validačních řádků oproti `findConflictingBlocks`.
  - `BlockDetail` drift sekce má `DRIFT_TITLES` mapu podle `CalendarDriftInfo["reason"]`
    (`END_MISMATCH`/`START_NOT_RUNNABLE`/`HORIZON_EXCEEDED`) místo jednoho fixního nadpisu
    pro všechny tři případy, které `blockCalendarDrift`/`detectCalendarDrift` mohou vrátit.
- Hlavní soubory: `src/lib/reportMetrics.ts` (`blockDurationHours`), `src/lib/printTimeClient.ts`
  (`blockReportSegments`, `printOverlapMinutes`), `src/lib/machines.ts`,
  `src/app/api/report/dashboard/route.ts`, `src/app/api/report/daily/route.ts`,
  `src/app/report/daily/ReportView.tsx`.

Vědomě odloženo (rozhodnutí, ne opomenutí — mimo scope etapy 7):

- **Stale klientský pm** (systémové riziko drag/resize/paste s neaktuálním `printMinutes` v
  klientském stavu) — vyžaduje vlastní návrh, zaznamenáno v ledgeru etapy 6.
- **Rate limit reflow endpointů** — konzistentní s ostatními mutacemi bloků (žádná z nich
  rate limit nemá).
- **Banner driftu vs. viditelné okno** — kosmetika, self-heal přes existující polling.
- **M-A seed atribuce** — detail nálezu se nedochoval v ledgeru; prověřit při finále featury
  (etapa 8).
- **Fixní směnové sekce denního reportu** (`SHIFTS_105` bez noční, `SHIFTS_106` s noční vždy)
  — pre-existující vzhled reportu, spec 3.10 ho nemění; segmentový filtr jen zajišťuje, že
  v prázdné/stojící směně blok nebude.
- **Retro/outlook TOTALS neklipují k rozsahu** (blok přesahující hranici rozsahu se počítá
  celý, ne jen jeho část uvnitř) — pre-existující sémantika, etapa 7 mění jen zdroj délky
  (`printMinutes` místo elapsed), ne klipovací chování; denní řady (`dailyUtilization`/
  `dailyCapacity`) klip řeší už teď přes `printOverlapMinutes`.

#### Finále featury (etapa 8, 5. 7. 2026)

Multi-agent review celé featury (5 nezávislých lens: datová integrita, transakce/souběh,
klient, security, spec compliance) — 0 Critical; všechny Important nálezy opraveny ve fix
wave a nezávisle verifikovány. Gardena 27h scénář dokázán sondou na dev DB (stará cesta
teleport až +5,3 dne, nová drží start a pauzne; Σ tisku přesně 27,0 h).

- **Série z fronty bez tichého skipu** (spec 3.11): children smyčka v `handleQueueDrop`
  posílá `autoShiftIfBusy: true`, sbírá selhání a hlásí souhrnný toast — zrcadlí
  `handleScheduleSeries` (ta byla opravená už 30. 4.).
- **Split s kompenzací**: tail POST nese `resolveChain: true`; při selhání tailu po commitu
  hlavy se hlava kompenzačně vrací (LIFO: endTime/printMinutes/splitGroupId) s error
  toastem — žádná tichá ztráta tiskového času. Serverový atomický split endpoint = vědomý
  v2 backlog.
- **Security fixy**: PUT `[id]` čte `printMinutes` z role-filtrovaného `allowed` (ne ze
  syrového body — DTP/MTZ nemůže vyvolat přepočet endu); tiskařské poznámky (`notes`) se
  gate-ují přes `canAccessBlockNotes` i v PUT/POST/batch/reflow refetchech a SSE broadcast
  je per-connection stripuje neoprávněným rolím (bez mutace sdíleného payloadu); GET
  machine-week-shifts seed větev má rate limit (120/min); hromadný reflow má per-stroj
  in-flight guard (409 při souběhu); daily report TISKAR bez `assignedMachine` → 403.
- **Drobné**: `handleSSEReconnect` merguje s `editingBlockIdsRef` guardem (fresh je
  autoritativní — smazané mizí); denní report sloupec Délka ukazuje „tisk (celkem)";
  legacy pm fallback v chain pushi zarovnán na 30 min; `ensureWeekSeeded` seed+detekce+
  notifikace v jedné tx; auto-seed notifikace atribuovaná „systém (auto-seed)";
  `block:batch-updated` SSE filtr pro TISKAR čte `payload.blocks`.
- **Známé limity (vědomé)**: rate-limitery a in-flight guard jsou module-scope =
  per-instance (OK pro single-instance produkci); TOCTOU re-check week-shifts nebere
  FOR UPDATE na blocích (extrémní souběh admin editace × insert bloku — chytí drift
  detekce/Přepočítat); driftMap `now` je snapshot per render.
- Deploy: `docs/superpowers/plans/2026-07-05-tiskove-hodiny-deploy-checklist.md`
  (vč. `connection_limit` v produkční `DATABASE_URL`).

#### 4 body z auditu plánovače (9. 7. 2026)

Čtyři schválené body z auditu e-mailu plánovače (spec `docs/superpowers/specs/2026-07-09-planovac-4-body-design.md`). Čistě klientské změny, žádná změna DB ani API routes; multi-agent review (3 lens) + fix wave, 0 Critical.

- **Pásy směn na pozadí** (per stroj podle skutečného provozu): dayshade smyčka
  (uvnitř `visibleMachines.map`) volá `resolveDayIntervals(machine, d.dateStr,
  machineWeekShifts)` a kreslí pás jen tam, kde daný stroj v daném čase reálně
  tiskne — odpolední `tl-afternoon` (tmavší), noční `tl-night` (nejtmavší); ranní je
  v CSS transparentní (= base), proto se nekreslí. XL_105 bez noční směny nemá noční
  pás; noc navazuje přes půlnoc přes `prev-tail` interval, takže na hranici dne ani
  víkendu nevzniká „schod". Odstávku překryje červený overlay navrch. `tl-day-alt`
  (střídání dnů) kryje jen provozní část 6–22 — přes noc by dělal půlnoční schod.
- **MODE_MICRO_TEXT**: nový výškový mód bloku 14–23 px pro odzoomovaný nadhled.
  Sdílí render s MODE_TINY (`(MODE_TINY || MODE_MICRO_TEXT)`) — jednořádkový layout
  `[D chip][M chip][E chip] · číslo · popis`, chipy dodání dat/materiálu/expedice mají
  přednost, popis se uřízne elipsou. Půlhodinový blok v nadhledu (zoom <24, kde height
  bloku klesne pod práh MODE_TINY 24 px) tak neztratí D/M/E chipy. (Původní verze bodu
  15 ukazovala v tomto pásmu jen popis bez chipů — opraveno 10. 7. 2026.)
- **Σ čas split skupiny**: `splitGroupTotalPrintMinutes` + `formatPrintHoursShort`
  (`printTimeClient.ts`, testy) — chip `✂2/5 · 27h` na bloku, tooltip řádek
  „Skupina: Σ 27 h (5 částí)", BlockEdit hlavička „· celkem 27h tisku" a BlockDetail
  řádek Skupina. Tiskové minuty (`blockPrintMinutes`), fallback elapsed u legacy.
  **Resize split části**: resize tooltip má navíc segment `✂ skupina Σ Xh` — živě
  přepočítaný celek skupiny = ostatní části (beze změny) + tato část v nové délce
  (honest `resizePrintMinutes`, fallback délka tažení u bypass/bez zámku). Uživatel
  při tažení vidí, o kolik se mění CELÁ zakázka, ne jen ta jedna část.
- **Cut = přesun (bod 17, oprava ztráty split skupiny)**: Ctrl+X → Ctrl+V už NEmaže
  a NEvytváří blok — single cut jde přes PUT `/api/blocks/[id]` (stejná cesta jako
  drag, `handleBlockUpdate(updated, true)` → move-undo), skupinový cut přes
  `handleMultiBlockUpdate` (batch, undo „Hromadný přesun"). Zachová se `splitGroupId`,
  historie auditu, vazba na rezervaci i tiskařské poznámky. Guardy: zamčený/vytištěný
  blok nelze vyjmout (Ctrl+X) ani přesunout (TOCTOU re-check při Ctrl+V přes čerstvý
  `blocksRef`); single cut čte `printMinutes` z čerstvého bloku (ne clipboard
  snapshotu); in-flight guard `cutMoveInFlightRef` proti double-paste; selhání batche
  ponechá clipboard pro retry (`handleMultiBlockUpdate` vrací boolean). Ctrl+C kopie
  beze změny — kopie záměrně NEdědí split skupinu.


## Připomínky plánovače (4. 8. 2026)

Sedm bodů z druhé série připomínek Lukáše Lukeše. Spec:
`docs/superpowers/specs/2026-08-04-pripominky-planovace-design.md`, plán
`docs/superpowers/plans/2026-08-04-pripominky-planovace.md`. Bod „odlišení dnů
a směn" odložen — čeká na osobní dovysvětlení od Lukáše.

- **Výchozí délka tisku 1 h** (`useJobBuilder.ts`): `resetBuilderForm` nenulovala
  `durationHours`, takže každý nový záznam zdědil délku předchozího. Konstanta
  `DEFAULT_DURATION_HOURS` (`plannerTypes.ts`); sjednocen i fallback
  v `reservationToQueueItem` (2 h → 1 h).
- **Překlopení rezervace → varianta Bez technologie**: popup posílal
  `blockVariant` ze stavu, který je u rezervace vždy STANDARD
  (`normalizeBlockVariant`). Nově `RESERVATION_FLIP_VARIANT` v `blockVariants.ts`;
  obě potvrzovací cesty popupu sjednoceny do `confirmFlipToZakazka`.
- **Termínová kolize od 14:00** (`src/lib/deadlineState.ts` — nový, přesun
  z `BlockCard`): logika porovnávala civilní datumové stringy, takže hranicí byla
  půlnoc. Termín je nově okamžik `pragueToUTC(due, DEADLINE_HOUR = 14, 0)`
  (DST-safe). Posunuly se všechny tři prahy: `earlyStart` podle skutečného
  timestampu startu tisku (nově se označí i zakázka startující v den termínu
  ráno), `warning` do 14:00 dne termínu, `danger` od 14:00. Stejný okamžik
  používá i `isPastExpeditionDeadline` pro badge „PO DEADLINE".
- **Zvýrazněná specifikace** (`src/components/planner/SpecBand.tsx` — nový):
  amber pás s tmavým textem místo textu v barvě popisu, práh snížen z 80 px na
  celý MODE_FULL. Tři podoby podle výšky: ≥ 80 px dva řádky, 48–79 px jeden
  řádek s elipsou, 14–47 px značka „S" v řádku chipů, pod 14 px dosavadní svislý
  proužek. V tiskařském režimu práh zůstává na 80 px — pás se kreslí před
  tlačítkem Hotovo a na nízké kartě by ho vytlačil pod ořez (regrese 3. 8. 2026).
  `splitChipFits` proto dostal místo `hasSpecRow: boolean` parametr
  `specRows: 0 | 1 | 2` (pás má jiný výškový rozpočet než dosavadní text).
- **Výrobní štítky u rezervací**: pipeline je zahazovala na třech místech —
  `PlanningForm` je neměl, `reservationToQueueItem` je natvrdo nuloval a builder
  je kreslil jen pro ZAKAZKA. Podmínky rozšířeny na `type !== "UDRZBA"` (parita
  s `BlockEdit`); v `planningPayload` se archy/série ukládají stejným tvarem jako
  na `Block` (JSON string).
- **Překlopení celé rezervace** (`src/lib/reservationSiblings.ts` — nový):
  bloky téže rezervace **nesdílí `reservationId`** — kopie ho záměrně neposílá
  (`blockPayload.ts`), split tail nekopíruje (`split/route.ts`) a druhý drop téže
  rezervace server odmítne 409. Jediné pojítko je `orderNumber` s vynuceným kódem
  rezervace, proto `findReservationSiblings` matchuje `orderNumber` NEBO
  `reservationId`, vždy s filtrem `type === "REZERVACE"` (Job Builder formát čísla
  nevaliduje). Potvrzuje se `ConfirmDialog`em; anchor dostane plný payload
  z formuláře, sourozenci jen `orderNumber`/`type`/`blockVariant` — jinak by se
  jim přepsal vlastní popis, termíny a štítky. Sourozenec už překlopený serverovou
  propagací (`SPLIT_SHARED_FIELDS`) se přeskočí.
- **Undo řetězově odsunutých bloků** (stav k 4. 8. 2026 — architektura popsaná
  tady byla den poté nahrazená atomickým endpointem, viz sekce „Atomické undo —
  etapa A" níž pro AKTUÁLNÍ stav): tažení myší je ukládalo správně
  (`handleBlockUpdate` počítá `shiftedOld` z `blocksRef`); díry byly ve vkládání,
  dropu z fronty a hromadném uložení. `snapshotShiftedFromResponse` musí běžet
  PŘED `handleBlockCreate`, protože staré pozice existují jen v `blocksRef` —
  server je v odpovědi nevrací. `handleSaveAll` zapisuje historii vůbec poprvé,
  se snapshotem všech bloků před smyčkou (PUT jednoho může propagovat na
  sourozence). Nový builder `buildMultiEditCommand` dělá z N bloků jeden krok
  historie.
- **Výlučnost OBÁLKA/VNITŘKY** (`toggleProductionVariant` v `productionTags.ts`):
  klik na druhou variantu první rovnou vypne, klik na jedinou aktivní ji vypne.
  Historický stav s oběma zaškrtnutými se klikem vyčistí na kliknutou variantu.
  DB zůstává na dvou nezávislých booleanech — výlučnost hlídá jen UI, logika žije
  v `ProductionTagsRow` pro všechny tři konzumenty.
- **Split a reflow undo nadále nemají** (`TimelineGrid.tsx`, `PlannerPage`
  reflow handlery) — vědomě mimo rozsah, nejcitlivější serverové cesty.

## Atomické undo — etapa A (4.–5. 8. 2026)

Podklad: výzkum `docs/audits/2026-08-04-undo-atomicita-vyzkum.md` (multi-agent,
4 agenti), spec `docs/superpowers/specs/2026-08-04-atomicke-undo-design.md`,
plán `docs/superpowers/plans/2026-08-04-atomicke-undo-etapa-a.md`.

**Spouštěč:** undo se do 4. 8. 2026 provádělo jako sekvence nezávislých HTTP
volání (PUT, PUT, pak batch) bez transakce mezi nimi. Cokoliv selhalo
uprostřed, zůstalo půl vrácené — a druhý Ctrl+Z nepomohl, protože buildery si
při dílčím úspěchu přepsaly `updatedAt` z odpovědi, guard ale porovnával živý
stav proti **protistraně** snapshotu, kterou dílčí úspěch neosvěžil. Konkrétní
incident: odsunutý blok mimo 30minutovou mřížku (chain push vždy zarovnává,
undo ho chtělo vrátit mimo mřížku — serverová validace to odmítla, undo
zůstalo napůl provedené natrvalo).

**Řešení:** nový endpoint `POST /api/blocks/undo` (`src/app/api/blocks/undo/route.ts`,
tenká slupka; jádro `src/lib/undoApply.server.ts` — `sanitizeUndoOps` +
`applyUndoOps`) provede **celý krok historie v JEDNÉ Prisma transakci**. Klient
posílá `ops: (upsert | remove)[]`; endpoint zapisuje hodnoty **doslova**, bez
`validateAndComputeEnd`/`expandPrintTime` (undo vrací stav, který v DB
prokazatelně existoval — měřit ho dnešní mřížkovou validací je kategorická
chyba, přesně to způsobovalo incident výše). Co běží vždy: optimistic lock
všech cílů najednou PŘED prvním zápisem (`SELECT ... FOR UPDATE` jako první
dotaz transakce — MySQL REPEATABLE READ jinak založí read-view na
konzistentním čtení, které zámek nedrží), zákaz smazat vytištěný blok,
`assertNoOverlapForBlocks` na konci. Klientské buildery (`src/lib/undo/commands.ts`)
se překlopily ze sekvence `putBlock`/`postBlock`/`deleteBlock`/`batchUpdate` na
jediné volání `UndoEffects.applyUndo`.

**Pořadí operací uvnitř transakce PŘESTALO být problém** (oprava zastarale
popsaného pravidla výše u „Undo řetězově odsunutých bloků" — to platilo pro
starou sekvenční architekturu). Rané overlap kontroly se nespouštějí vůbec —
mezistavy uvnitř transakce nikdo nevidí, provedou se všechny zápisy (nejdřív
`remove`, pak `upsert` — čistě proto, aby chybové hlášky dávaly smysl, ne kvůli
korektnosti) a teprve na konci proběhne jediná `assertNoOverlapForBlocks`.
Stejně tak `buildMultiEditCommand`/`buildDeleteCommand` nově posílají
`expectedUpdatedAt` na KAŽDÉM cíli (dřív se to u multi-edit vědomě vynechávalo,
protože sekvenční PUTy si navzájem bumpovaly verze přes serverovou propagaci) —
endpoint čte stav jednou a zapisuje až po kontrole všech zámků, takže si cíle
nemůžou nic shodit.

**Vedlejší efekt zápisu doslova:** `SPLIT_SHARED_FIELDS` (`src/lib/splitSharedFields.ts`)
se přes starý `PUT /api/blocks/[id]` propagovaly na split sourozence
automaticky (`updateMany`) — undo je tak dostávalo zpátky zadarmo. Nový
endpoint nepropaguje nic, takže sourozenec se musí do `ops` dostat ADRESNĚ,
jinak split skupina se sdílenými poli tiše rozejde. To je celý obsah `undo/`
modulů níž.

### Go/no-go audit a oprava (5. 8. 2026)

Závěrečná revize před sloučením větve našla Critical: tři nezávislé cesty,
kde se split sourozenec do `ops` nedostal, a menší nálezy. Oprava:

- **`src/lib/undo/splitSiblingFields.ts`** — tři čisté, testované funkce:
  `buildSplitEditTargets` (primár + běžní sourozenci, objektový parametr —
  dřív poziční, ale druhý call site zvýšil riziko tiché záměny páru `before`/
  `after`, která by beze stopy obrátila směr undo), `buildSplitEditTargetsWithShifted`
  (navíc pohltí sourozence odsunuté chain pushem, které PUT route vyloučila ze
  `siblings`, aby neposlala dvojitou SSE událost — takový soused se jinak do
  `buildSplitEditTargets` vůbec nedostal a `handleBlockUpdate` mu poslalo jen
  pozici, nikdy sdílená pole), `buildPassiveSiblingTargets` (sourozenci
  propagovaní serverem, o které si klient explicitně neřekl — typicky
  „Překlopení rezervace" s volbou „jen tento blok").
- **`handleSaveAll`** (dialog „Celou sérii" v `BlockEdit.tsx`) sourozence
  z odpovědi PUTu vůbec nečetl. Split TAIL navíc nikdy nefiguruje v `ids`
  série (`getSeriesIds()` klíčuje na `recurrenceParentId`, který split route
  ocasu záměrně nekopíruje — ocas není samostatná série) — sourozenec se musí
  zapsat adresně ze `siblings` v odpovědi, ne přes rozšíření `ids`.
- **`handleFlipReservation`** při volbě „jen tento blok" (`siblingIds = []`)
  ignoroval sourozence, které server přesto propagoval (`updateMany` běží nad
  celou `splitGroupId` bez ohledu na to, co si klient vyžádal). Diff proti
  `SPLIT_SHARED_FIELDS` proběhne AŽ PO dokončení všech PUTů dávky, proti stavu
  zachycenému před první mutací.
- **AuditLog u polních editací** (`applyUndoOps`) psal span `start–end` pro
  KAŽDÝ upsert, i když se pozice vůbec neobnovovala (typicky undo editace
  `materialStatusId`) — `oldValue` vyšlo rovno `newValue` a `BlockDetail`/
  `InfoPanel` to vykreslily jako „vráceno zpět: 2.9. 06:00 → 2.9. 06:00",
  falešný přesun, který se nekonal. Teď: `field: "fields"` + seřazený seznam
  obnovených klíčů v `newValue`, UI ho vykreslí jako text, ne jako šipku.
- Drobnosti: `logger.warn` doplněn i pro obnovu do firemní odstávky (dřív jen
  mřížkové varování); finální overlap pojistka prochází stroje seřazené podle
  jména (prevence deadlocku dvou souběžných dávek); test `DATE_FIELDS`
  přepsaný, aby doopravdy cross-referencoval `prisma/schema.prisma`, ne ručně
  přepsanou kopii sebe sama.

**Známé omezení — VYŘEŠENO (6. 8. 2026):** `handleSaveAll` (dialog „Uložit
vše"/„Celá série" v `BlockEdit.tsx`, obsluha v `PlannerPage.tsx`) do 6. 8. 2026
nečetlo `updated.shifted` z odpovědi PUTu vůbec — chain push během ukládání
série nechával odsunuté navazující bloky mimo undo krok. Ctrl+Z pak vracel
uložené bloky na jejich předchozí hodnoty, ale odsunuté sousedy nechal na
NOVÉ (posunuté) pozici — data se nepoškodila (undo tady bloky jen
zkracuje/upravuje, nikdy neprodlužuje mimo kalendář), ale v plánu zůstávala
viditelná díra, kterou musel plánovač srovnat ručně.

Oprava: **`src/lib/undo/shiftedBatch.ts`** — dvě čisté testované funkce.
`accumulateShifted` řeší dedup, když týž soused dostane víc PUTů jedné dávky
(typicky druhá editovaná zakázka série odsune chain pushem tu samou první,
kterou už odsunul PUT předchozí zakázky) — PRVNÍ „před" je předdávková
pozice, POSLEDNÍ „po" konečná; stejný vzor, jaký uvnitř `putFlip`
(`handleFlipReservation`) dělá inline pro `flipShiftBefore`/`flipShiftAfter`,
teď vytažený a znovupoužitelný. `excludeShiftedTargeted` vyřadí z odsunutých
id, která jsou ZÁROVEŇ mezi cíli TÉŽE dávky (`saveBefore`) — nejošklivější
past oprav: dvě instance jedné série na STEJNÉM stroji za sebou — PUT první
odsune chain pushem druhou, ale druhá je TAKÉ členem ukládané série a dostane
vlastní PUT o pár iterací dál (je tedy zároveň vlastní cíl i odsunutý
soused). Bez filtru by šla do dávky DVAKRÁT a `sanitizeUndoOps`
(`src/lib/undoApply.server.ts`) by celý krok odmítla (400 „je v dávce
vícekrát") — Ctrl+Z by pak selhal úplně, ne jen pro odsunutého souseda.
`handleSaveAll` snapshotuje odsunuté PŘED `handleBlockUpdate` (stejně jako
`putFlip`), akumuluje přes celou smyčku a filtr aplikuje až v
`recordSaveAllUndo` (volá se i z catch větve — co se stihlo uložit, musí jít
vrátit i s odsunutými sousedy).

**Poslední zbytek — VYŘEŠENO (7. 8. 2026):** oprava výš vracela POZICI
odsunutého souseda, ale ne jeho SDÍLENÁ POLE, pokud byl zároveň split
sourozencem editovaného bloku. Konkrétní scénář: instance opakované série je
zároveň rozdělená (split) — HEAD nese `recurrenceParentId`, TAIL ho split
nekopíruje (`split/route.ts`), takže TAIL se do `ids` „Celou sérii" nikdy
nedostane. Editace HEADu měnící sdílené pole a zároveň ho chain pushem
protahující do prostoru TAILu způsobila, že server TAIL vyloučil i ze
`siblings` (stejná pojistka proti dvojité SSE jako u `handleBlockUpdate`,
viz „Vyloučit sourozence, kteří už jsou v shifted" v `[id]/route.ts`) —
`buildSplitEditTargets` ho tak neviděl v žádném z obou zdrojů. Ctrl+Z vrátil
TAILu pozici (díky opravě výš), ale sdílené pole zůstalo na nové hodnotě —
split skupina se tiše rozešla.

Oprava: `handleSaveAll` přepnut z `buildSplitEditTargets` na
`buildSplitEditTargetsWithShifted` (stejný nástroj, jaký `handleBlockUpdate`
používá už od go/no-go auditu 5. 8.), doplněný o novou čistou funkci
`pickShiftedSplitSiblings` (`splitSiblingFields.ts`) — najde split sourozence
mezi odsunutými podle shody `splitGroupId` a spáruje je s jejich stavem PŘED
dávkou. Snapshot „před" (`prevById`) se rozšířil na VŠECHNY bloky, ne jen
`ids` (TAIL v `ids` není), a čte se výhradně z něj, nikdy z
`blocksRef.current` uvnitř smyčky — ten se v `handleSaveAll` přiřazuje přímo
v render těle komponenty, takže je mezi dvěma `await fetch` jedné dávky
nedeterministický (na tuhle past se v téhle větvi naletělo dvakrát). 11 nových
testů v `splitSiblingFields.test.ts` (687 → 698), včetně integračního
scénáře skládajícího přesně tenhle případ ze skutečných čistých funkcí.

## Copy/Paste flow

### Copy/Paste flow (aktualizováno 2. 7. 2026 — etapa 4 tiskových hodin)

- Ctrl+C / Ctrl+X / right-click → Kopírovat **automaticky nastavují pasteTarget** na pozici za zdrojovým blokem (helper `src/lib/pasteTarget.ts`). Ctrl+V tak funguje hned, bez nutnosti klikat do prázdného gridu.
- Skutečné vložení (`handlePasteWithTarget`/`handleGroupPasteWithTarget` v `PlannerPage.tsx`): pro ZAKAZKA blok se start snapuje **jen podle `snapStartToNextRunnableSlot`** (start-only, tiskové hodiny) a payload nese `printMinutes` (`blockPrintMinutes`) — end dopočítá server. Ne-ZAKAZKA bloky beze změny používají duration-based `snapToNextValidStartWithTemplates`.
- Vizuální marker pasteTargetu se kreslí v `TimelineGrid` jako přerušovaná modrá čára „⎘ Sem (Ctrl+V)" ve sloupci cílového stroje. Od etapy 5 je marker poctivý: pro ZAKAZKA zdroj (single i celá skupina — prop `pasteSourceIsZakazka`) snapuje start přes `snapStartToNextRunnableSlot` (tiskové hodiny), tedy stejnou cestou jako skutečný paste; pro ne-ZAKAZKA/smíšenou skupinu zůstává duration-based snap přes `pasteSlotDurationMs` (pro ZAKAZKA zdroje počítaný z `blockPrintMinutes`, ne elapsed).
- Pravý klik na prázdný grid nabízí „⎘ Vložit zde" — kompletně mouse-only workflow.
- Esc čistí: multi-select, copiedBlock, isCut, pasteTarget, clipboardGroupRef.
- SSE `block:deleted` vyčistí copiedBlock/clipboardGroupRef/selectedBlockIds pokud obsahují smazaný blok (prevence „fantom paste" se starou referencí).
- Ctrl+C/X bez výběru → info-toast „Žádný blok není vybrán" místo silent no-op.
- Keydown handler je bindovaný **jednou** na mount (`useEffect([])`); hodnotu `selectedBlock` čte přes `selectedBlockRef.current`. Tím odpadlo re-binding při SSE updatech a 5min pollingu.
- `handlePaste` a `handleGroupPaste` jsou guard wrappery; business logika je v `handlePasteWithTarget(target)` / `handleGroupPasteWithTarget(target)` — target přijímají explicitně, sdílí se mezi Ctrl+V a right-click paste.

## Aktuální technické poznámky


- Next.js 16 při buildu hlásí deprekační warning na `src/middleware.ts`; budoucí rename na `proxy` je otevřený cleanup
- ESLint warningy jsou hlavně:
  - použití `<img>`
  - jeden `react-hooks/exhaustive-deps`
  - anchor místo `next/link`
  - anonymní default exporty v config souborech

## Klíčové soubory — detailní popisy

### Sdílené utility a typy

- `src/lib/errors.ts` — `AppError`, `isAppError`, `AppErrorCode`, `errorStatus` (kanonická mapa kód→HTTP status, audit #80) — použít v každé API route
- `src/lib/authz.ts` — `assertRole` (čisté jádro role-checku) + `requireRole` wrapper v `src/lib/auth.ts` — auth gate pro nové API routes (audit #81)
- `src/lib/blockPayload.ts` — `blockToCreatePayload`/`EXPECTED_PAYLOAD_KEYS` — jediný zdroj pravdy pro Block→POST payload (undo/paste/group paste; audit #2 — dřív 4 divergentní kopie, undo/paste ztrácely pantone/SKLADEM); tripwire test hlídá úplnost polí
- `src/lib/blockStyles.ts` — `BLOCK_STYLES`/`BLOCK_OVERDUE`/`BLOCK_PRINT_DONE`/`getBlockStyleKey`/`tint` — vizuální identita bloků (audit #14; sdílí TimelineGrid i blockShades, zrcadlo `shadeBucket` zrušeno)
- `src/lib/logger.ts` — `logger.info/warn/error` — použít místo console v API routes
- `src/lib/scheduleValidationServer.ts` — `validateAndComputeEnd` — validuje ZAKAZKA blok a vrací autoritativní end + `effectivelyBypassed` (spočítaná pravda pro `scheduleBypassed`, nikdy echo request flagu; jediný zdroj pravdy pro endTime; nahrazuje zrušenou `validateBlockScheduleFromDb`)
- `src/lib/printTime.ts` — `expandPrintTime`/`computePrintMinutes`/`isMachineRunnableAt` — jádro „tiskových hodin" (čisté funkce, žádná DB)
- `src/lib/printTime.server.ts` — `loadMachineCalendar`/`expandPrintTimeFromDb` — DB fetch (weekShifts + companyDays) a napojení na `printTime.ts`
- `src/lib/printTimeClient.ts` — `blockPrintMinutes`/`companyDayIntervalsFor`/`snapGroupDeltaStartOnly`/`getBlockSegments`/`printMidpoint`/`blockCalendarDrift`/`blockReportSegments`/`printOverlapMinutes` — klient-safe helpery (žádná DB) pro mutační cesty, vykreslení a reporting ZAKAZKA bloků; start-only snap přes `snapStartToNextRunnableSlot`, end vždy dopočítá server; `getBlockSegments` vrací print/pause segmenty pro overlay pauz (null = kreslit slitě), `printMidpoint` = bod poloviny tiskových minut (default split), `blockCalendarDrift` = živá detekce driftu pro badge (parita se serverovou `detectCalendarDrift`), `blockReportSegments` = segmenty i pro souvislý blok bez pauzy (reporty, etapa 7), `printOverlapMinutes` = tiskové minuty bloku uvnitř libovolného okna (den/směna)
- `src/lib/reportMetrics.ts` — `blockDurationHours`/`computeBlockHours`/`computeUtilization`/`computeAvailableHours`/`computePlanStability`/... — čisté metriky pro `/api/report/dashboard`; `blockDurationHours` (etapa 7) je ZAKAZKA `printMinutes/60` s fallbackem na elapsed, jinak elapsed
- `src/lib/machines.ts` — `MACHINES` + `MachineId` + `MACHINE_LABELS`/`machineLabel` — jediný zdroj pravdy pro seznam i zobrazované labely strojů (etapa 7 + audit #25/#46/#77)
- `src/lib/timeSlots.ts` — `SLOT_MINUTES`/`SLOT_MS`/`DAY_SLOT_COUNT`/`slotFromHourBoundary` — konstanty 30min gridu; `SLOT_MS` je definovaný JEN tady (audit #90), `printTime.ts` ho re-exportuje
- `src/lib/zLayers.ts` — `Z_TIMELINE`/`Z_LAYOUT`/`Z_OVERLAY` — kanonická z-index škála (audit #21/#95, fáze D): pojmenované vrstvy místo magických čísel ve třech rovinách (uvnitř timeline gridu / řadové panely / body-level překryvy přes portál/fixed); `Z_OVERLAY` je striktně rostoucí (na pořadí záleží — popover nad panelem, dialog nad vším), monotonii hlídá `zLayers.test.ts`. Karta-interní mikro-vrstvy (2–4) zůstávají lokální literály
- `src/lib/calendarDrift.server.ts` — `detectCalendarDrift`/`notifyCalendarDrift` — serverová detekce driftnutých bloků (čisté READ, nic neupravuje) + zápis `Notification` typu `CALENDAR_DRIFT` po mutaci kalendáře
- `src/lib/reflow.server.ts` — `reflowBlockInTx`/`reflowMachineInTx` — přepočet (re-expanze + chain push) jednoho bloku nebo celého stroje v transakci, audit action `AUTO_REFLOW`; `ReflowDeps.preloadedCalendar` (etapa 7) — 1 kalendář pro celý hromadný reflow místo N per-blok fetchů
- `src/lib/findConflictingBlocks.ts` — `findConflictingBlocks` (pre-transakční) / `assertNoConflictingBlocks` (in-tx TOCTOU re-check) — sdílí jádro `fetchConflictingBlocks` (etapa 7 DRY), okno `[W, W+7d+6h)` přes `computeConflictWindow`/`neighborWeekStarts`
- `src/lib/plannerTypes.ts` — `TYPE_LABELS`, `TYPE_BUILDER_CONFIG`, `CodebookOption`, `DURATION_OPTIONS`
- `src/lib/auditFormatters.ts` — `FIELD_LABELS`, `fmtAuditVal` (umí i en-dash span `"ISO–ISO"` z AUTO_SHIFT/batch auditních řádků), `formatPragueMaybeToday`
- `src/lib/weekShiftsTestFixtures.ts` — test-only fixtury pracovní doby (`mkDay`, `xl106Week`, ...), sdílené mezi `*.test.ts` soubory validace harmonogramu
- `src/lib/notifications.ts` — `countUnread`/`countNewSince`/`totalBadge` — čisté funkce pro badge počty (notifikační refaktor mimo etapu, commit `dtp` 3. 7. 2026)

### Planner — komponenty

- `src/app/_components/PlannerPage.tsx` — hlavní orchestrátor (~3109 řádků; ~2647 po dekompozici fáze E1, narostl přírůstky dalších etap vč. atomického undo)
- `src/hooks/useJobBuilder.ts` — hook vlastnící veškerý stav + logiku Job Builderu (tvorba zakázek/série/fronta): form/series/queue state, opts+presety, badgeColorMap, compatibleBuilderPresets, preset efekty, handleAddToQueue, generateSeriesPreview, handleScheduleSeries (přes `onBlockCreated` callback). Extrakce E1(ii) 14. 7. 2026 (−1201 ř. z PlannerPage; ověřeno 5-lens adversariální review, 0 nálezů)
- `src/components/planner/JobBuilderPanel.tsx` — JSX Job Builderu; bere `{ jb: UseJobBuilderReturn, isDark }`, destrukturuje `jb` nahoře
- `src/components/planner/ShutdownManager.tsx` — `ShutdownManager` + `machineBadgeStyle` (+ interní `MachinePicker`); extrakce E1(i)
- `src/components/planner/ResizeHandle.tsx` — `ResizeHandle`; extrakce E1(i)
- `src/app/_components/TimelineGrid.tsx` — vizuální grid s drag & drop (~2355 ř. po extrakci BlockCard, fáze E2)
- `src/components/planner/BlockCard.tsx` — render jednoho bloku na timeline (stavy/chipy/drag/resize/split/badge/deadline/drift) + privátní helpery (DateBadge/MiniChip/ProductionChips/MaterialNoteAffordance/deadlineState/chipTextColor/fmtDate/fmtDateShort); module-scope, prop-based, žádná závislost na TimelineGrid scope (Block typ type-only import). Extrakce E2 14. 7. 2026 (−1587 ř. z TimelineGridu; ověřeno 5-lens adversariální review vč. verbatim diffu, 0 nálezů)
- `src/components/ZoomSlider.tsx` — custom zoom slider
- `src/components/InfoPanel.tsx` — audit log panel + typ `AuditLogEntry`; nově exportuje i `AuditList` (samotný seznam bez wrapperu — sdílí se s `NotificationsPanel`)
- `src/components/InboxPanel.tsx` — notifikační inbox + typ `NotificationItem`; nově exportuje i `InboxList` (samotný seznam bez wrapperu — sdílí se s `NotificationsPanel`)
- `src/hooks/useNotifications.ts` — hook sdružující fetch/state pro notifikace i audit (role-gated přes `INBOX_ROLES`/`AUDIT_ROLES`, 60s polling), počítá badge přes `src/lib/notifications.ts`
- `src/components/NotificationBell.tsx` — jeden sloučený zvonek v headeru (nahradil dřívější dvě oddělené ikony inboxu a auditu)
- `src/components/NotificationsPanel.tsx` — panel otevíraný zvonkem, taby „Upozornění" (`InboxList`) / „Aktivita" (`AuditList`)
- `src/components/BlockDetail.tsx` — read-only detail bloku s historií; od etapy 6 i drift sekce (`DRIFT_TITLES` + tlačítko Přepočítat)
- `src/components/BlockEdit.tsx` — editační formulář bloku
- `src/components/ToastContainer.tsx` — toast notifikace
- `src/components/ConfirmDialog.tsx` — sdílený potvrzovací modál (audit #3/#34/#48/#64, fáze D): tokeny, z-index z `Z_OVERLAY.modal`, zavření přes Esc i klik mimo, autofocus na potvrzení, `children` pro doménový obsah (např. důvod zamítnutí rezervace u smazání bloku); nahradil 2 ručně kopírované delete dialogy v PlannerPage
- `src/components/NativeSelect.tsx` — jednotný stylovaný `<select>` (audit #4/#32/#93, fáze D2): div + appearance:none + chevron + tokeny; kanon výška 32/radius 10, odchylka přes prop (`height`/`fontSize`/`paddingLeft`/`chevronSize`/`mutedWhenEmpty`/`hover`); nasazeno v BlockEdit, PlannerPage builderu, PlanningForm, JobPresetEditor. Bare-native selecty (ShutdownManager, ShiftHoursPopover) a stavový chip na bloku (DtpPanel/DtpDataPopover) vědomě NEpřevedeny (jiný vzor)
- `src/components/PrimaryCta.tsx` — hlavní značkové tlačítko (audit #10/#65, fáze D2): `--brand`/`--brand-contrast`, `press`/`loading`/`disabled` přes tokeny; nahradilo natvrdo `#FFE600` v builder CTA (série/fronta) + login
- `src/components/ModuleHeader.tsx` — sdílená lišta modulů Expedice + Reporty (audit #60/#102, fáze D2): back-link → oddělovač → název → spacer → `children` toolbar. RezervacePage zůstává na svém user-menu vzoru
- `src/lib/uiStyles.ts` — `FONT_STACK`/`inputStyle`/`btnPrimary`/`btnSecondary`/`btnDanger`/`btnAddAccent` (audit #43, fáze D2): jediný zdroj admin tlačítek/inputů; nasazeno v AdminDashboard, PrinterCodebook, MachineWorkHoursWeek, ShiftRoster (padding sjednocen 14→16px)

### Planner — logika

- `src/lib/workingTime.ts`
- `src/lib/scheduleValidation.ts`
- `src/lib/pasteTarget.ts` — `computePasteTargetFromBlock` / `computePasteTargetFromGroup`, výchozí pozice paste targetu
- `src/lib/clipboardCopy.ts` — `copyTextToClipboard(text)` — defenzivní helper pro kopii do systémové schránky; nejdřív zkusí `navigator.clipboard.writeText`, při chybě (HTTP / non-secure context) spadne na legacy `document.execCommand('copy')`. Vrací `Promise<boolean>` (true = úspěch). **Použít všude místo přímého volání `navigator.clipboard.*`** — produkční server běží přes HTTP a přímé volání crashne UI.

### Copy/Paste flow (aktualizováno 2. 7. 2026 — etapa 4 tiskových hodin)

- Ctrl+C / Ctrl+X / right-click → Kopírovat **automaticky nastavují pasteTarget** na pozici za zdrojovým blokem (helper `src/lib/pasteTarget.ts`). Ctrl+V tak funguje hned, bez nutnosti klikat do prázdného gridu.
- Skutečné vložení (`handlePasteWithTarget`/`handleGroupPasteWithTarget` v `PlannerPage.tsx`): pro ZAKAZKA blok se start snapuje **jen podle `snapStartToNextRunnableSlot`** (start-only, tiskové hodiny) a payload nese `printMinutes` (`blockPrintMinutes`) — end dopočítá server. Ne-ZAKAZKA bloky beze změny používají duration-based `snapToNextValidStartWithTemplates`.
- Vizuální marker pasteTargetu se kreslí v `TimelineGrid` jako přerušovaná modrá čára „⎘ Sem (Ctrl+V)" ve sloupci cílového stroje. Od etapy 5 je marker poctivý: pro ZAKAZKA zdroj (single i celá skupina — prop `pasteSourceIsZakazka`) snapuje start přes `snapStartToNextRunnableSlot` (tiskové hodiny), tedy stejnou cestou jako skutečný paste; pro ne-ZAKAZKA/smíšenou skupinu zůstává duration-based snap přes `pasteSlotDurationMs` (pro ZAKAZKA zdroje počítaný z `blockPrintMinutes`, ne elapsed).
- Pravý klik na prázdný grid nabízí „⎘ Vložit zde" — kompletně mouse-only workflow.
- Esc čistí: multi-select, copiedBlock, isCut, pasteTarget, clipboardGroupRef.
- SSE `block:deleted` vyčistí copiedBlock/clipboardGroupRef/selectedBlockIds pokud obsahují smazaný blok (prevence „fantom paste" se starou referencí).
- Ctrl+C/X bez výběru → info-toast „Žádný blok není vybrán" místo silent no-op.
- Keydown handler je bindovaný **jednou** na mount (`useEffect([])`); hodnotu `selectedBlock` čte přes `selectedBlockRef.current`. Tím odpadlo re-binding při SSE updatech a 5min pollingu.
- `handlePaste` a `handleGroupPaste` jsou guard wrappery; business logika je v `handlePasteWithTarget(target)` / `handleGroupPasteWithTarget(target)` — target přijímají explicitně, sdílí se mezi Ctrl+V a right-click paste.

### Rezervace

- `src/app/rezervace/_components/RezervacePage.tsx`
- `src/app/api/reservations/route.ts`
- `src/app/api/reservations/[id]/route.ts`
- `src/app/api/reservations/[id]/attachments/route.ts`
- `src/app/api/reservations/[id]/attachments/[attachmentId]/route.ts`

### Admin a konfigurace

- `src/app/admin/_components/AdminDashboard.tsx` — shell (~142 ř. po dekompozici E2): taby + render sekcí
- `src/app/admin/_components/UsersSection.tsx` — tab Uživatelé (UsersSection + UserRow + RoleSelect); extrakce E2
- `src/app/admin/_components/CodebookSection.tsx` — tab Číselníky (CodebookSection + CodebookRow + ColorPicker + WarningToggle); extrakce E2
- `src/app/admin/_components/PresetSection.tsx` — tab Presety; extrakce E2
- `src/app/admin/_components/adminShared.ts` — sdílené admin consty (SECTION_BG/SEPARATOR/TEXT_PRIMARY/TEXT_SECONDARY/BORDER_SUBTLE) použité shellem i sekcemi
- `src/components/job-presets/JobPresetEditor.tsx`
- `src/app/api/job-presets/route.ts`
- `src/app/api/machine-week-shifts/route.ts`
- `src/components/admin/MachineWorkHoursWeek.tsx`
- `src/components/admin/ShiftRoster.tsx`

### Auth

- `src/lib/auth.ts`
- `src/middleware.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`


## Etapa B1 — serverové revize bloků („černá skříňka"), 7.–8. 8. 2026

**Proč vznikla.** `AUDITED_FIELDS` neobsahuje `startTime`, `endTime`, `machine`
ani `printMinutes`, takže **jednoblokové přetažení nezapsalo do historie vůbec
nic**. To znemožnilo hladkou rekonstrukci havárií plánu z 5. a 6. 8. 2026.
Druhý motiv: atomické undo (etapa A) zapisuje doslova ze snapshotu, který
skládal klient — a třikrát nezávisle se stalo, že v něm chybělo pole, které
server dopočítává.

**Co se postavilo.** Tabulka `BlockRevision` + pomocník `withRevision`
(`src/lib/revision.server.ts`), který otevírá transakci sám a tělu předá klient
s podstrčenými delegáty `block` a `auditLog`. Zachycení „před" stavu se řídí
`where` samotného zápisu, takže volající nikde nevyjmenovává pole ani bloky —
na revizi tedy nejde zapomenout. Zapojeno všech 9 mutačních cest. Panel historie
bloku nově slučuje `AuditLog` a `BlockRevision` do jedné osy s potlačením
po sloupcích.

**Co etapa NEŘEŠÍ.** Undo nad revizemi (to je etapa B2, vlastní spec, až tabulka
pár týdnů poběží na produkci). Historie dál nepřežije reload prohlížeče.

**Poučení, která stojí za zapamatování:**

- **Pomocník uzavírá delegáty a vnořené relace strukturálně, ale globální klient
  `prisma` v uzávěru těla uzavřít neumí.** Tvrzení „jinudy zapsat nejde" bylo
  v první verzi nepravdivé a muselo se přeformulovat — od něj se odvozuje,
  jak pečlivě se revidují nové routy.
- **Skutečný běh chytí, co unit test nechytí.** `$queryRaw` se propouštěl
  nesvázaný a shazoval `assertNoOverlapForBlocks` — povinnou pojistku VŠECH
  zápisových cest. Testy to nechytily, protože ten kód nevolaly.
- **Povinný parametr > tichý výchozí.** Když `scheduleSlotFinder` dostal klienta
  povinně, překladač hned odhalil volání ve skriptu mimo hlavní strom, o kterém
  plán nevěděl. S tichým výchozím by prošlo beze slova a psalo mimo skříňku.
- **Kaskády referenční integrity jsou slepé místo.** `ON DELETE SET NULL` nad
  `recurrenceParentId` rozpadl sérii bez jediné revize. Řeší se tím, že se
  kaskáda **výslovně provede přes `rtx` před smazáním** (v DELETE i v undu).
- **Nejcennější vady vznikají ze setkání dvou nevinných kusů.** Mapa pokrytí
  zahazovala revizi u potvrzení tisku s odůvodněním „pokrývá ji auditní řádek",
  ale panel ten auditní řádek neuměl vykreslit — potvrzení tisku by z osy
  zmizelo úplně. Ani jedna část sama o sobě chyba nebyla.
- **Ověřovat proti datům, ne proti návrhu.** Řetězec `startTime/endTime/machine`
  v historii píšou DVA psavci a každý jinak: undo hodnoty stroje neobsahuje,
  legacy dávkový zápis ano. Plošná oprava by byla chybná.

**Validace, která rozhodla.** Multi-agent review poskládala ze samotné tabulky
`BlockRevision` zpátky současný stav databáze — třikrát nezávisle, sloupec po
sloupci, 145 revizí, **0 neshod**. Plus diferenciální běh 85 kroků proti stavu
před zapojením: 0 rozdílů ve stavových kódech, odpovědích i obsahu tabulek.

Spec: `docs/superpowers/specs/2026-08-07-undo-serverove-revize-design.md`
Plán: `docs/superpowers/plans/2026-08-07-etapa-b1-serverove-revize.md`

---

## Etapa „zámek jako režim aplikace" — konec neviditelné značky (9. 8. 2026)

**Proč vznikla.** Zámek pracovní doby v hlavičce plánovače je přechodný stav
JEDNÉ ZÁLOŽKY prohlížeče, který ale zapisuje TRVALÝ příznak `scheduleBypassed`
na jednotlivé bloky. Vojta čekal opak — režim aplikace. Příznak byl přitom
lepivý i neviditelný naráz: vzniká odemčením zámku (i u jiného uživatele),
přežije zamčení, autoposun se ho jen drží a nikdy ho nepřepočítá, lasso ho
udrží přes `bypass = požadavek || stávající`, undo ho vrátí doslova ze
snapshotu — a `calendarDrift` bypassované bloky **výslovně vyřazoval z kontroly**.
Tři vrstvy neviditelnosti nad příznakem, který mění geometrii zakázky.

**Reálná škoda, ze které etapa vzešla.** Zakázka 18447 na XL 106 měla příznak
z havárie 5. 8. Autoposun ji proto místo roztažení přes noční pauzu **scvrknul
z 22 h na 14 h**, přestala dosahovat k navazujícímu PŘEMYTÍ a v plánu vznikla
tichá 3,5hodinová díra v pracovní době. Na produkci byla taková nekonzistence
jediná ze 70 bypassovaných zakázek; 69 z nich je z doby před červencem.

**Co se postavilo.** Odložená zakázka přestala být neviditelná: dostane na kartě
vlastní štítek **⏸ ODLOŽENO** a v detailu tlačítko, kterým se vrátí do kalendáře.
Dva nové důvody popisují STAV, ne poruchu — `PARKED` („leží mimo kalendář, protože
ji tam plánovač dal"; `expectedEnd` říká, kam by po přepočtu sáhla) a `STALE_BYPASS`
(„nese značku, ale kalendáři odpovídá" — případ 18447, stačí zrušit značku).

| Kde | Co se změnilo |
| --- | --- |
| `printTimeClient.ts` | `blockCalendarDrift` posuzuje i odložené zakázky (opt-in `includeBypassed`) a rozlišuje `PARKED`/`STALE_BYPASS` |
| `reflow.server.ts` | přepočet odloženou zakázku přijme a značku ZRUŠÍ; nová větev „nic se nepohnulo" |
| `revisionFormat.ts` | `scheduleBypassed` přestal být přeskočený sloupec, má vlastní českou větu |
| `TimelineGrid.tsx` | náhled při tažení a resize se odloženým zakázkám přestal vyhýbat; pruh nad strojem je nepočítá |
| `BlockCard.tsx`, `BlockDetail.tsx` | vlastní štítek a nápověda podle důvodu |
| `calendarDrift.server.ts` | beze změny klasifikace — jen pojistka proti výjimce z expanze (viz níž) |

**Klíčové rozhodnutí: odložení není porucha.** Etapa původně odstranila serverový
filtr `scheduleBypassed: false`, aby odložené zakázky „konečně někdo kontroloval".
Multi-agent review ukázala, proč je to špatně: příznak není přání uživatele, ale
**spočítaná pravda** (`effectivelyBypassed = !conforms`) — odložená zakázka je tedy
z definice nekonformní. Bez filtru by každé vědomé odložení trvale svítilo jako
„nesedí na kalendář": notifikace z každé úpravy směn, nikdy nenulový provozní report
a hromadné „Přepočítat" nad strojem by ji jedním kliknutím vystěhovalo do pracovní
doby i s autoposunem navazujících bloků — **nevratně, protože reflow nemá undo**.

Filtr se proto vrátil a rozsah obou detektorů se **záměrně liší**: server pohání
souhrnné kanály, klient kreslí kartu jedné zakázky. Vědomé odložení patří na tu
kartu a nikam jinam. Rozhodl Vojta 9. 8. 2026 po předložení nálezu.

**Tvrdý požadavek, který tvaroval celý návrh.** *„Až tento build dáme na
produkci, nechci nic měnit ani přepočítávat. Nesmí se nic hnout samo."* Proto:
žádná migrace, žádný startovací ani cron skript, který by měnil data. Jediná
cesta, kterou příznak z bloku mizí, je **klik na Přepočítat u konkrétní zakázky**.
Po nasazení se u 18447 objeví štítek a nic víc; plán zůstane bit po bitu stejný.

**Rozhodnutí, která stojí za zapamatování:**

- **Dvojí detekce driftu je fakt, se kterým se musí počítat.** Pruh nad strojem
  počítá server, štítek na kartě klient. Spec původně mířil jen na server —
  půlka funkce by tiše chyběla. Chyceno kontrolou před psaním plánu (poučení P5).
- **Sdílený guard se neuvolňuje, dává se mu opt-in.** `tryExpandForBlock` sdílí
  detektor driftu s kreslením pauz. Uvolnění podmínky by odloženým zakázkám
  kreslilo dovnitř pás „⏸ PAUZA — mimo provoz", přestože tisknou slitě. Řešením
  je parametr s přísným výchozím stavem, ne změna podmínky (poučení P6).
- **„Je co zapsat" ≠ „něco se pohnulo".** Zbytková značka je přesně ten případ,
  kdy se nic nepohne a přesto je co uložit. Zkratka `changed = posun` by
  tlačítku dovolila hlásit úspěch a příznak by v DB zůstal.
- **Hlášení musí rozlišit dva různé výsledky.** Skutečný posun a pouhé zrušení
  značky mají oba `changed: true`; „Blok přepočítán" by u nepohnutého bloku lhalo.
- **Souhrnné počítadlo musí sedět s tím, co tlačítko udělá.** Pruh „N nesedí na
  kalendář" nad strojem pohání hromadnou akci — cokoliv, co do něj započítám a
  akce se toho nedotkne (nebo naopak), je slib, který aplikace nesplní.
- **Detekce běžící uvnitř cizí transakce nesmí házet.** `expandPrintTime` na
  nezarovnaném startu nebo nekladných minutách hodí výjimku; v `detectCalendarDrift`
  by shodila celou úpravu směn chybou 500. Dnes je obojí vyloučené dřív (SQL filtr
  a pre-filtr zarovnání), takže doplněný `try/catch` je **obrana do budoucna, ne
  oprava dosažitelné chyby** — a testem není pokrytý, protože se k němu vstup
  nedostane. Klient tu pojistku měl odjakživa.

**Známá omezení, která etapa nezavírá:**

- **Odložená zakázka s nezarovnaným startem zůstává neviditelná.** Klient ji vyřadí
  guardem zarovnání (žádný štítek), server ji nevidí taky a „Přepočítat" by na ní
  vrátilo `UNALIGNED`. Nese tedy značku, kterou nikdo neuvidí a nejde zrušit z UI.
  Takové bloky vznikají undem (zapisuje doslova ze snapshotu, bez mřížkové validace).
- **`HORIZON_EXCEEDED` nemá test na žádné straně** (starší dluh, ne z této etapy).
  Projeví se u odložené zakázky jako štítek bez údaje o konci po přepočtu.
- **Rozhodnutí `moved`/`clearsFlag` v `reflowBlockInTx` stojí na nezamykajícím
  čtení** (`findUnique`), zatímco zámek bere až `withRevision` při zápisu. Souběžná
  změna téhož bloku mezi tím může nechat zapsat jen zrušení značky. Je to starší
  vlastnost té cesty, kterou etapa zúžila na adresné tlačítko; pravidlo
  „`SELECT … FOR UPDATE` musí být první dotaz v transakci" (CLAUDE.md) tu splněné není.

Spec: `docs/superpowers/specs/2026-08-09-zamek-jako-rezim-design.md`
Plán: `docs/superpowers/plans/2026-08-09-zamek-jako-rezim.md`

---

## Stabilita plánu — přepojení metriky na `BlockRevision` (10. 8. 2026)

**Proč vznikla.** Karta „Stabilita plánu" na reportu pro vedení ukazovala 100 %
a „0 přeplánování". Křížová tabulka `AuditLog GROUP BY action, field` nad dev DB
ukázala, že metrika nedokáže napočítat **vůbec nic**, a to ze tří nezávislých
důvodů naráz (podrobně `docs/POUCENI.md`, P14):

1. `MOVE_FIELDS` porovnávala PŘESNOU shodu `startTime`/`endTime`/`machine`, kdežto
   dávkový přesun píše `startTime/endTime` (`buildBatchAuditRows`) a starší formát
   `startTime/endTime/machine` (198 řádků v dev DB).
2. Dotaz filtroval `action: "UPDATE"`, takže `AUTO_SHIFT` (chain push), `AUTO_REFLOW`
   i `UNDO` odpadly dřív, než se na ně sčítání podívalo. Jediné, co mohlo projít,
   byl holý `machine` z dnešního dávkového přesunu.
3. Přetažení jednoho bloku myší **nemá v `AuditLog` řádek vůbec** — poziční sloupce
   nejsou v `AUDITED_FIELDS`. Nejběžnější způsob přesunu byl neviditelný z principu,
   takže oprava bodů 1–2 by metriku neuzdravila.

Navíc čitatel (bloky editované v období) a jmenovatel (bloky naplánované v období)
počítaly různé množiny, takže podíl mohl vyjít i záporný.

**Zdrojem je nově `BlockRevision`** — černá skříňka etapy B1 pokrývá všech 9
zápisových cest včetně jednoblokového dragu. `kind = "UPDATE"` plus přítomnost
`startTime`/`endTime`/`machine` v rozdílu = poziční změna. `action ∈ {UNDO, REDO}`
se vylučuje: krok zpět vrací blok tam, kde byl, takže by tentýž blok počítal dvakrát,
aniž by se plán změnil.

**Dvě čísla místo jednoho** (rozhodnutí Vojty 10. 8. 2026):

| Karta | Definice | Vložení spěchající zakázky, které odsune 5 navazujících |
| --- | --- | --- |
| Zásahy do plánu | distinct `groupId` | **1** — jedna transakce = jedno rozhodnutí |
| Posunuté bloky | distinct `blockId` | **5** |
| Stabilita plánu | `(bloky v období − posunuté) / bloky v období` | |

Podtitulek druhé karty nese jejich **poměr** („⌀ 5,0 na zásah") — to je vlastní
informační hodnota té dvojice: říká, jak drahé je přijmout spěchající zakázku.
Že se `groupId` dá takhle číst, garantuje schéma: *„Jedna serverová transakce =
jeden groupId napříč všemi dotčenými bloky."*

**Obě čísla se počítají nad TOUŽE množinou bloků** (průnik s bloky v období) —
bez toho by poměr neznamenal nic a stabilita mohla klesnout pod nulu.

**Pokrytí se přiznává.** Revize existují od 9. 8. 2026 a drží se 90 dní. Když
zvolené období není celé pokryté, všechny tři karty ukážou `—` a pod nimi se
vypíše, odkdy data jsou. Poziční změny se dřív nikam nezapisovaly, takže žádné
číslo za starší období není k dispozici — a vymyslet ho by bylo horší než mlčet.

**Aktivita plánovačů jede ze stejného dotazu.** Dřív = počet auditních řádků
`UPDATE` na uživatele, tedy jeden za KAŽDÉ změněné pole: jedno uložení z BlockEditu
s pěti změnami dělalo „5 akcí", přetažení bloku nula. Nově distinct `groupId` na
uživatele přes všechny revize = počet uložení.

**Implementační poznámky.**
- `JSON_CONTAINS_PATH` se počítá v SQL (`$queryRaw`), aby se netahal celý sloupec
  `after`. **Dev a produkce mají pod tím sloupcem jiný typ:** dev je MySQL 8.0.45
  (`json`), produkce **MariaDB 10.11.14** (`longtext` — MariaDB nativní typ JSON nemá,
  Prisma tam vyrobí text s kontrolou `json_valid()`). Funkce běží nad obojím; ověřeno
  10. 8. 2026 přímo nad ostrou tabulkou, ne odvozeno z čísla verze.
  Fallback při změně motoru: vytáhnout `after` a testovat klíče v JS.
- Funkce vrací **`BigInt`** (`1n`, ne `1`), takže se čte přes `Number(r.positional)` —
  striktní `=== 1` by tiše platilo nikdy.
- `after` je u `kind = "DELETE"` NULL → funkce vrátí NULL → `Number(null)` je 0.
  Chová se správně bez zvláštní větve.
- Sekce PLÁNOVÁNÍ se vydělila do `src/app/reporty/_components/PlanningSection.tsx`
  a `KpiCard.tsx` (soubor `ReportDashboard.tsx` byl přes limit `max-lines` už předtím;
  po extrakci má 559 řádků místo původních 631).
- Zmizel test „regrese FIX 6b", který vylučoval tvar `startTime/endTime` jako
  automatické odsunutí. Záměr byl správný, ale provedený na špatné ose — ten tvar
  píše i vědomý dávkový přesun, takže test hlídal přesně tu vadu, která metriku
  zabila. V novém zdroji složené názvy polí neexistují.

**Ověření nad ostrou databází (10. 8. 2026), 164 revizí od 9. 8. 20:41.** Tabulka
níž je zároveň důkaz, že filtry sedí — každý řádek je jiná větev rozhodování:

| `kind` / `action` / `positional` | řádků | co to je | metrika |
| --- | --- | --- | --- |
| `UPDATE` / `BATCH` / 1 | 69 | lasso a dávkové přesuny | počítá |
| `UPDATE` / `UPDATE` / 1 | 38 | **přetažení a resize JEDNOHO bloku** | počítá |
| `UPDATE` / `UNDO` / 1 | 32 | krok zpět | vylučuje |
| `UPDATE` / `UPDATE` / 0 | 21 | obchodní editace (Pantone, statusy) | vylučuje |
| `DELETE` / `DELETE` / NULL | 2 | smazání bloku | vylučuje |
| `CREATE` / `CREATE` / 1 | 1 | vznik bloku | vylučuje (`kind ≠ UPDATE`) |
| `UPDATE` / `REFLOW` / 0 | 1 | „Přepočítat" u 18447 | nepočítá — časy se nezměnily |

Těch **38 řádků `UPDATE`/`UPDATE`** je jádro celé opravy: jsou to jednoblokové
přesuny, které v `AuditLog` nezanechaly stopu žádnou. Za necelý den provozu 38 kusů,
z toho stará metrika neviděla ani jeden. Celkem **107 skutečných přesunů** tam, kde
karta hlásila nulu.

Dva řádky potvrzují správnost filtrů zvlášť pěkně. `REFLOW` s `positional = 0` je
kliknutí na „Přepočítat" u zakázky 18447, kde se přepnul jen `scheduleBypassed`
a časy zůstaly — přesun to tedy není a metrika ho nezapočítá. A 32 undo řádků je
skoro čtvrtina všeho; bez jejich vyloučení by číslo bylo nafouklé o třetinu.

Klíčové soubory: `src/lib/reportMetrics.ts` (`computePlanStability`, `PlanMoveInput`) ·
`src/app/api/report/dashboard/route.ts` (`handleRetro`) ·
`src/app/reporty/_components/PlanningSection.tsx` · `KpiCard.tsx`
