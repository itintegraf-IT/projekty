# Štítky BARVY a LAK na Monitoru + bublina nad druhým strojem (14. 9. 2026) — návrh řešení

Etapa 1 zářijové vlny připomínek plánovače výroby. Pokrývá body 1 a 2 jeho zprávy:

> „Zobrazit tiskařům v Monitoru všechny štítky.“
> „Posunout okno s podrobnostmi mimo tiskový stroj, na kterém daná zakázka je zaplánována.“

Zadavatel: Vojta Ťokan. Varianty vybral 14. 9. 2026 v rozhodovacím artefaktu
(„Zářijové připomínky plánovače“, `https://claude.ai/code/artifact/a89302af-6975-40c1-95a3-1ea4ba74c82d`),
kde je i průzkum současného stavu. Výchozí stav kódu: větev `Vojta`, `7c7ee65b` (= produkce).

Body 3 a 4 (historie změn) a dodatek o reportech jsou etapy 2 a 3 s vlastními specy.

---

## Rozhodnutí, na kterých spec stojí

| ID | Otázka | Volba |
| --- | --- | --- |
| M1 | Které štítky na Monitor doplnit | **A — BARVY a LAK** |
| M2 | Kde je ukázat | **B — všude, včetně sekce NEDODĚLÁNO** |
| O1 | Kam bublinu posunout | **A — nad druhý stroj, k jeho pravé hraně** |
| O2 | Prodleva před zobrazením | **A — 400 ms** |
| P1 | Pořadí etap | A — tahle etapa první |
| P2 | Nasazení | A — nejdřív testovací instance, pak produkce |

---

## 1. BARVY a LAK na Monitoru, všude včetně NEDODĚLÁNO

### Problém

Monitor bere štítky z jediné funkce `buildMonitorChips` (`src/lib/monitorChips.ts`),
kterou kreslí velká karta i řádky DNES/ZÍTRA. Ukazuje OBÁLKA/VNITŘKY, tiskové
archy, sérii, stav DATA, druh materiálu, vydání materiálu, PANTONE a nestandardní
variantu. **Nemá stavy BARVY a LAK** (`barvyStatusLabel`, `lakStatusLabel`).
Karta v plánu je přitom kreslí hned vedle druhu materiálu (`MiniChip`,
`BlockCard.tsx`) a tiskař je v plánu vidí. Štítky jsou v aplikaci šestice
DATA · MATERIÁL · BARVY · LAK · ARCHY · SÉRIE (`prisma/seed-monitor.ts`) a na
Monitoru z ní chybí přesně tyhle dva.

Sekce NEDODĚLÁNO dnes štítky nemá vůbec. Zúžený řádek je záměr ze 13. 8. 2026,
protože nedodělaných bývá až devět.

### Řešení

**1.1 Dva nové štítky v `buildMonitorChips`**

- `barvyStatusLabel` → štítek s textem hodnoty po `trim()`; `null`, prázdný
  a jen mezerový text štítek nedělá. Totéž `lakStatusLabel`.
- Text se nemění ani nezkracuje, stejně jako u DATA a druhu materiálu.
  Hodnoty jsou z číselníku („SCH Lumina LED“, „IML COLORGRAF“, „disperse lesk“,
  „UV lak“, „parciální“…).
- **Pořadí:** … → PANTONE → **BARVY → LAK** → varianta. Barvy a lak patří
  k barevné části zakázky vedle pantone. Varianta zůstává poslední jako dnes.
- **Tón `plain`** (neutrální šedá). Barvy a lak nemají stav hotovo/čeká.
  Na Monitoru zelená znamená „připraveno / odklepnuto“ a jantarová „čeká“.
  Barva z číselníku (tak je kreslí karta v plánu přes `badgeColorMap`) by
  tyto významy přepsala. Jde o vědomou odchylku od karty v plánu a zapíše se
  do hlavičky `monitorChips.ts`, vedle stávající poznámky o paritě s `BlockCard.tsx`.

**1.2 Sekce NEDODĚLÁNO dostane štítky (M2 = B)**

- Zúžený řádek (`compact` v `MonitorQueue.tsx`) vykreslí `MonitorChips size="queue"`
  pod řádkem s číslem, popisem a časem. Dostane celou sadu, ne jen barvy a lak;
  tak to ukazovala i maketa, ze které se vybíralo.
- Pás specifikace v zúženém řádku zůstává vynechaný. Nebyl předmětem volby.
- **Důsledek:** sekce se prodlouží a při devíti nedodělaných se DNES posune níž.
  Fronta má vlastní posuvník (`overflowY: auto`), takže DNES zůstává
  dosažitelná posunutím.
- Komentář u `compact`, který dnes zdůvodňuje „bez chipů“, se přepíše na nový
  stav (P19: komentář nesmí popisovat stav, který už neplatí).

**1.3 Pojistka velké karty: při nedostatku místa ustoupí štítky, ne časová osa**

Obsah velké karty jde shora dolů: číslo → popis → pás specifikace → štítky →
časová osa → řádek druhého stroje. Kontejner obsahu ořezává zespodu
(`overflow: hidden`, od 17. 8. 2026 oddělený od tlačítek). Když štítky přibudou
o řádek, na stupni XL a nízké obrazovce by pod ořez odjel nejdřív řádek druhého
stroje a pak časová osa. Hrubý odhad pro 1366×768, stupeň XL a plně vyplněnou
zakázku vychází právě na hraně.

- Kontejner štítků na **velké kartě** (`MonitorChips size="hero"`) dostane
  `minHeight: 0; overflow: hidden`. Jako jediný prvek obsahu tak smí zmenšit
  výšku pod svůj obsah, a při nedostatku místa proto ustoupí jako první.
  Časová osa a řádek druhého stroje si drží výšku obsahu.
- V krajním případě se ořízne spodek štítků. Tytéž štítky jsou ve většině
  případů vidět i ve zvýrazněném řádku fronty vpravo. Výjimkou je zakázka
  vytažená na kartu hledáním z jiného dne.
- Změna je celá v `MonitorChips.tsx`. `MonitorView.tsx` (646 řádků při
  limitu 500) se nemění.
- Fronta (`size="queue"`) se nemění, řádky rostou do výšky a fronta scrolluje.

### Co se nemění

Data a API: Monitor dostává `barvyStatusLabel`/`lakStatusLabel` v objektech
bloků už dnes a karta v plánu je kreslí z téhož objektu. Beze změny zůstávají
velikosti písma štítků (`chipHero`/`chipQueue`), barvy tónů, karta v plánu,
řádek údržby a hledací panel tiskaře.

---

## 2. Hover bublina nad druhým strojem, s prodlevou 400 ms

### Problém

„Okno s podrobnostmi“ je hover bublina nad kartou zakázky (`BlockCard.tsx`,
geometrie v `src/lib/plannerHoverTooltip.ts`). Plánovač ji 17. 8. sám nazval
„okno s detaily“. Od 20. 8. 2026 sedí pod kartou ve sloupci téhož stroje
(rozhodnutí V5) a zakryje zhruba 3,5 hodiny navazujícího plánu (bublina ~180 px,
26 px na 30 minut). Vyskočí okamžitě, takže při projíždění sloupcem myší bliká
nad každou kartou. Nejvíc na ni narážejí pre-press a MTZ při odklepávání štítků.

Toto je čtvrtá změna umístění (13. 8. vnější strana mřížky → 17. 8. zarovnání
k vlastnímu sloupci → 20. 8. pod kartu). Mimo vlastní sloupec se 240px bublina
vejde jen nad druhý stroj nebo nad boční panel. Časová osa (72 px) a levý pás
(116 px) jsou úzké (P28).

### Řešení

**2.1 Nové pravidlo umístění** — nová čistá funkce `hoverTooltipPlacement`
v `plannerHoverTooltip.ts`. Vrací `{ left, top, mode }`, kde `mode` je
`"neighbour"` (nad druhým strojem) nebo `"own"` (záchranný režim níž):

- **Cílový sloupec** je sousední sloupec stroje: vpravo, pokud existuje, jinak
  vlevo. U dvou strojů jde XL 105 → XL 106 a XL 106 → XL 105; pravidlo platí
  i pro víc strojů.
- **Vodorovně:** pravá hrana bubliny = pravá hrana cílového sloupce −
  `TOOLTIP_MARGIN` (10 px). Levý kraj cílového sloupce se štítky D/M/E/P
  a čísly zakázek zůstane odkrytý, kdykoliv má sloupec aspoň 260 px.
- **Svisle:** horní hrana bubliny = horní hrana karty, sevřená do okna
  (`[okraj, výška okna − výška bubliny − okraj]`). Bublina už na kartě neleží,
  takže není důvod ji dávat pod kartu. Ve výšce karty drží vazbu na ni.
- **Záchranný režim:** v těchto případech se použije **dnešní chování**
  (vlastní sloupec, pod kartou s přehozením nahoru; `hoverTooltipLeft`
  + `hoverTooltipTop` beze změny):
  1. sousední sloupec neexistuje (tiskař v plánu vidí jen svůj stroj),
  2. hák sloupce v DOM chybí (mřížka se nestihla vykreslit),
  3. bublina by po sevření do okna zasáhla do sloupce vlastního stroje
     (úzké okno s více panely).

  Pořadí je záměrné: bublina musí být celá v okně, a teprve pak se hlídá
  zákaz vlastního sloupce.
- **Hledání sousedního sloupce:** sloupce strojů jsou v DOM sourozenci
  s atributem `data-machine-col` (`TimelineGrid.tsx`). `BlockCard` najde vlastní
  sloupec přes `closest("[data-machine-col]")` jako dnes a sourozence v jeho
  rodiči. Nový hák není potřeba.

Geometrie podle vzorce z průzkumu (měřením se ověří, viz Testování):

| Situace | Sloupce | Zakázka XL 105 → bublina | Zakázka XL 106 → bublina |
| --- | --- | --- | --- |
| Plánovač 1920 px, panel 320 | XL 105 116–818 · XL 106 890–1592 | 1342–1582 (v XL 106) | 568–808 (v XL 105) |
| Plánovač 1366 px, panel + notifikace | sloupce po 265 px | vejde se | vejde se |
| 1366 px, panel 600 px + notifikace | sloupce po 125 px | záchrana: dnešní chování | vejde se přes časovou osu, vlastní sloupec nezasáhne |

**2.2 Prodleva 400 ms**

- Nová konstanta `TOOLTIP_OPEN_DELAY_MS = 400` v `plannerHoverTooltip.ts`.
  Je to stejná hodnota, jakou má náhled poznámky MTZ (`HoverCard openDelay={400}`
  v `BlockCard.tsx`). Ten se na konstantu napojí, aby se hodnoty nerozešly.
- V `BlockCard` vznikne vedle stavu `hovered` samostatný stav „bublina otevřená“.
  Nastaví ho časovač po 400 ms nepřetržitého najetí. Odjetí myši a odmontování
  karty časovač zruší a bublinu zavřou.
- `hovered` dál **okamžitě** řídí stín a vrstvu karty (`Z_TIMELINE.blockHover`).
  Prodleva se týká jen bubliny, ne zvýraznění karty.

**2.3 Koho se to týká:** všech rolí, které v plánu vidí oba stroje (ADMIN,
PLANOVAT, DTP, MTZ, OBCHODNIK, VIEWER). Tiskař v plánu vidí jeden sloupec,
takže zůstane v záchranném režimu; změní se mu jen prodleva.

**2.4 Známý kompromis** (vědomá volba O1 = A): bublina dočasně zakryje pravý
kraj karet druhého stroje. Na zakrývání druhého stroje si 13. 8. někdo stěžoval.
Tehdy ale bublina ležela hned u karty, přímo přes štítky druhého stroje vlevo.

**2.5 Dokumentace:**
- hlavička `plannerHoverTooltip.ts`: nové pravidlo a pátá položka historie iterací;
- komentáře v `BlockCard.tsx` u výpočtu pozice a u háku `data-machine-col`
  v `TimelineGrid.tsx`;
- řádek o `plannerHoverTooltip.ts` v `CLAUDE.md`. Dnes je zastaralý, popisuje
  stav ze 17. 8.;
- záznam v `docs/vyvoj-historie.md`.

### Co se nemění

Obsah a vzhled bubliny, šířka 240 px, `pointerEvents: none`, portálování mimo
stacking context, z-vrstva `Z_OVERLAY.floating`, podmínka `showTooltip` (ne nad
údržbou, ne nad řádkem datumových chipů). Náhled poznámky MTZ se jen napojí
na sdílenou konstantu prodlevy.

---

## Testování

| Oblast | Jak |
| --- | --- |
| `buildMonitorChips` | Unit testy: jen barvy, jen lak, obojí, `null`/prázdné/mezery → žádný štítek, tón `plain`, pořadí v plném testu (… PANTONE → BARVY → LAK → varianta). |
| Písmo Monitoru | Strážný test `monitorTypography.test.ts` musí zůstat zelený, tedy žádné holé `fontSize` v `src/components/monitor/*.tsx`. |
| Geometrie bubliny | Tabulkové testy přes scénáře z průzkumu: 1920/1366 px × panel / panel + notifikace / DTP panel / bez panelu × zakázka XL 105 / XL 106. Tvrzení: bublina celá v okně; neprotne sloupec vlastního stroje; při dost širokém cíli pravou hranou přesně na `cíl.right − 10`; záchranný režim pro chybějící soused, úzké rozložení a chybějící hák; svislé sevření do okna nahoře i dole. Každý test, který hlídá konkrétní řádek, se ověří z druhé strany: bez hlídaného řádku musí padnout (P11). |
| Prodleva | Konstanta a její sdílení s náhledem poznámky MTZ; chování časovače prokliknutím (projekt nemá komponentní harness). |
| Monitor vizuálně | Screenshot běžící appky (dev, `prisma/seed-monitor.ts`): stupně M a XL při 1366×768 a 1920×1080. Nejhorší případ z 1.3 (dvouřádkový popis, dvouřádková specifikace, všechny štítky, rozdělená zakázka) změřit přes `getBoundingClientRect`: spodek časové osy ≤ spodek kontejneru obsahu. |
| Bublina vizuálně | Playwright nad běžící appkou: zakázka na XL 105 i XL 106, s bočním panelem i bez; změřit polohu bubliny proti sloupcům, ne jen vyfotit. |
| Celek | Celá test suite, `npm run build`, `npm run lint`. |

Seed musí barvy a lak zapisovat tak jako aplikace (P16). `seed-monitor.ts` je
dnes bere z číselníku přes `opt("BARVY", …)` a `opt("LAK", …)`, což odpovídá.
Před focením se ověří, že i některá nedodělaná zakázka v seedu nese štítky.

---

## Nasazení a review

- Bez migrace a bez zásahu do dat.
- Podle P2: nejdřív testovací instance (port 3021). Proklikají ji plánovač
  a pre-press (bublina) a tiskař (Monitor). Pak produkce podle
  `docs/DEPLOY_WORKFLOW.md`, tedy `mysqldump` a otisk dat PRE/POST i bez migrace.
- Review podle diferencovaného modelu: štítky na Monitoru jsou nízké riziko
  (build + testy + proklik). Bublina mění chování UI, takže před commitem ji
  projde jedna nezávislá review geometrie a zapojení.

---

## Předpoklady (oprav, pokud nesedí)

- Barvy a lak se ukážou doslova podle číselníku. Nejdelší hodnota výchozího
  číselníku, „vysoce lesklá disperse“ (22 znaků), se na štítek vejde.
- Obrazovky u strojů mají rozlišení mezi 1366×768 a 1920×1080. Neověřeno,
  proto se ověřují obě krajní velikosti.
- Pre-press a MTZ pracují v plánu s oběma stroji, ne v tiskařském pohledu.

---

## Co tento spec ZÁMĚRNĚ neřeší

- **Termín expedice, poznámku MTZ a poznámky tiskaře na Monitoru.** M1 = A,
  varianty B a C nebyly zvolené.
- **Barvy z číselníku na Monitoru.** Viz 1.1, tón zůstává neutrální.
- **Pás specifikace v sekci NEDODĚLÁNO.** Nebyl předmětem volby.
- **Bublinu u tiskaře v plánu.** Jeden sloupec, dnešní chování plus prodleva.
- **Štítky v hledacím panelu tiskaře** (`OrderSearchSheet`). Připomínka ho nezmiňuje.
- **Historii změn a reporty.** Etapy 2 a 3, vlastní specy.
