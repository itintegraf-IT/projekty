# Průzkum: co sledovat v reportech plánovacího nástroje

**Datum:** 16. 8. 2026
**Proč vznikl:** před etapou R3 (přeskládání `/reporty`) ověřit, že aplikace reportuje to podstatné — a hlavně zjistit, co jí chybí.
**Rozsah:** čtyři nezávislé rešerše — oborová (APS/MES + polygrafie), produktová (7 MIS + Prinect + Pace), finanční (controlling, sazba strojhodiny, návratnost) a analýza vlastního datového modelu.

> **K čemu tenhle dokument slouží:** je to podklad pro etapu **R4 „metriky výsledku"**. R3 se jím neřídí — ta zůstává přeskládáním. Jediná věc, kterou průzkum přidal do R3, je prokliknutí z dlaždic na seznam zakázek.

---

## 1. Opravy chybných předpokladů

Zadání rešerší obsahovalo tvrzení, která se ukázala jako nesprávná. Uvádím je, protože bez oponentury by celé větve průzkumu vypadly.

| Tvrzení v zadání | Skutečnost |
| --- | --- |
| „Termín slíbený zákazníkovi není k dispozici" | **`Block.deadlineExpedice` existuje**, presety ho odvozují přes `deadlineExpediceOffsetDays` a stojí na něm modul Expedice. Není to zákaznický slib (ten přijde s Pace), ale jako proxy pro OTD je použitelný **dnes**. Opravili to dva rešeršisté nezávisle. |
| „Tharstern" jako samostatný nástroj | Patří pod **ePS**, doména přesměrovává. „Tharstern Cloud" nahradilo ePS Nubium. |
| „Hiflex" jako živý produkt | **Mrtvý od 2013.** Koupilo ho HP (ne EFI), podpora skončila 31. 12. 2017, doména neexistuje. |
| „Esko Automation Engine" jako reportingový nástroj | **Není.** Manuál v25.03 nemá kapitolu Reports/Analytics; „Report" tam znamená PDF pro schvalování. Reálný provozní reporting je jen XML export Task History. |

---

## 2. Shoda napříč rešeršemi

Váhu má jen to, na čem se shodly nezávislé zdroje.

| Metrika | Oborová | Produktová | Finanční / data |
| --- | --- | --- | --- |
| **Kalkulace vs. skutečnost** | „norma `printMinutes` nikdy nebyla ověřena" | PrintVis *Orders with Deviation Report* (parametr Min. Deviation %) · Label Traxx *compare actual to estimate* · Tharstern *job cost analysis* · Prinect KPI rodina `Diff Real vs Planned Time (%)` | „vytížení měří plán, ne výrobu" |
| **Dodržení termínu** | OTD + posouvání termínu | Prinect *Shipped On Time Confirmed %* · Pace *Late Job List* · CERM *OTIF* + *Deepdive OTIF* · Optimus *Jobs produced on time and in full* | OTD proti `deadlineExpedice` |
| **Kaskáda kapacity** | „kalendář → směny → plán → odklepnuto" | Prinect *Clocking Measures* (`Real Utilization Rate % = Total Duration / Capacity`) | TEEP · CAM-I · bvdm `B° × N°` |

**Trojitá shoda na kalkulaci vs. skutečnosti je nejsilnější výsledek průzkumu.** Aplikace staví každé číslo na `printMinutes` — odhadu plánovače zaokrouhleném na 30 minut — a nikdy ho neporovnala s realitou. Je-li optimistický o 15 %, je celý report o 15 % vedle.

**Dodržení termínu má úplně každý zkoumaný nástroj a aplikace nemá ani řádek** (`grep deadlineExpedice` přes `src/app/api/report/` a `src/app/reporty/` → 0 výskytů).

---

## 3. Co aplikace umí líp než konkurence

Nezdvořilost, ale zjištění: tohle se u sedmi zkoumaných nástrojů nenašlo.

- **Churn plánu** — stabilita (% bloků beze změny), počet zásahů plánovače, „kolik bloků rozhýbe jeden zásah". Prinect měří odchylku *provedení* od plánu; **stabilitu samotného plánu neměří nikdo**. Přímá odpověď na havárie z 5. a 6. 8. 2026.
- **Úplná historie změn s before/after po sloupcích** (`BlockRevision`). Umožňuje rekonstruovat, jak plán vypadal minulé pondělí — základ pro „Schedule Comparison" typu Preactor.
- **Trychtýř rezervací v 8 stavech** včetně `requestedExpeditionDate` vs. `counterProposedExpeditionDate`, tedy měřitelnost toho, jak často se termín obchodníka dá dodržet.
- **Kontrolní panel integrity dat.** Sebediagnostika plánovacích dat, kterou žádný MIS jako report nenabízí.

**Systémový rozdíl:** Prinect Smart BI je denní dávka do Azure, tedy retrospektiva. Tahle aplikace je živá a dívá se dopředu. Jiná role, ne horší.

---

## 4. Zajímavá díra u Heidelbergu

Prinect Smart BI má **KPI rodinu „plán vs. skutečnost"** se vzorci (`Diff Start/End Time vs Planned (h)`, `Diff Real vs Planned Setup Time (%)`, `Diff Production vs Planned Volume (%)`), ale **mezi jeho 16 reporty není ani jeden o dodržování plánu**. Data má a report nad nimi nepostavil.

Dokumentace je veřejná na `onlinehelp.prinect-lounge.com` a **příklad zařízení je doslova „XL 106 8P"** — je psaná na naše stroje.

---

## 5. Spočitatelné z dnešních dat

Pořadí podle síly doložení. U každé položky rozhodnutí, které umožní — metrika, u které to nejde formulovat, do reportu nepatří.

### 5.1 Dodržení termínu expedice (OTD)

```
zakázka (klíč splitGroupId ?? Block.id) je včas ⟺
  MAX(printCompletedAt přes skupinu) ≤ pragueToUTC(deadlineExpedice, 14:00)
OTD % = včas / zakázky s vyplněným termínem
```

Pole: `Block.deadlineExpedice`, `Block.printCompletedAt`, `Block.splitGroupId`.
Logika porovnání už existuje — `isPastExpeditionDeadline` (`src/lib/deadlineState.ts`) včetně konvence, že termín je 14:00, ne půlnoc. Slučování split-skupin řeší `groupCompletedToOrders` (`reportMetrics.ts`) beze změny.

**Rozhodnutí:** jestli plán plní svůj účel — a před podpisem IML smluv s termíny, kolik jich firma dnes reálně drží.

### 5.2 Posouvání termínu — POVINNÁ dvojice k 5.1

```
% zakázek, kterým se deadlineExpedice aspoň jednou posunul + medián posunu ve dnech
```

Zdroj: `AuditLog` s `field = 'deadlineExpedice'` (pole je v `AUDITED_FIELDS`).
**`AuditLog` se nikdy nemaže** — `scripts/prune-revisions.ts` má v hlavičce výslovně, že sahá jen na `BlockRevision`. Historie je tedy bez omezení, na rozdíl od revizí (90 dní).

**Proč povinná dvojice:** OTD samotné je triviálně zmanipulovatelné posunutím termínu. Doložený případ — Walmart musel OTIF kvůli tomu rozdělit na dvě metriky a v únoru 2024 snížit prahy z 98 % na 90/95 %.

### 5.3 Kalibrace normy `printMinutes`

Skutečný začátek tisku se nikam neukládá, takže trvání nelze změřit přímo. Jde ale odvodit z kadence:

```
skutečný takt(i) = printCompletedAt(i) − printCompletedAt(i−1)   [týž stroj, táž směna]
porovnat se součtem printMinutes daného bloku, agregovat medián za měsíc
```

Ten rozdíl obsahuje tisk **i přestavbu** další zakázky — což je zároveň první odhad přestavbového času, který dnes neexistuje.

**Omezení do popisku:** filtrovat jen dvojice uvnitř jedné směny; vyloučit bloky odklepnuté zpětně v dávce. Je to odhad, ne měření.

**Rozhodnutí:** o kolik je norma soustavně optimistická — tedy jestli se má `printMinutes` zvednout, nebo jestli se v mezerách skrývá přestavba, kterou plán nemodeluje.

### 5.4 Kaskáda kapacity

```
kalendář (dny × 24 h)
  → obsazeno   = computeAvailableHours()          [MachineWeekShifts, CompanyDay]
  → naplánováno = Σ printOverlapMinutes
  → odklepnuto  = totéž jen přes bloky s printCompletedAt ≠ null
```

Dnes report ukazuje jen poměr třetího ku druhému. Nikdy neřekne, **jakou část kalendáře vůbec obsazujeme lidmi**.

Německý bvdm to učí jako `1 750 h × B° 84 % × N° 86 % = 1 264 fakturovatelných hodin`, tedy 72 % kalendáře. Diagnostický příklad odtud: starý stroj měl **vyšší** obsazenost (91,9 % vs. 87,4 %), ale **nižší** produktivitu (72,1 % vs. 83,0 %) — kdo měří jen vytíženost, tenhle rozdíl neuvidí.

**Rozhodnutí:** odděluje „chybí nám stroj" od „chybí nám směna". Přímo k rozhodnutí o investici 140 M Kč a zároveň druhá strana mince u redukce 10 % lidí.

### 5.5 Připravenost zakázky k nájezdu

```
% zakázek kompletně připravených v okamžiku plánovaného startTime
+ rozpad, který vstup chyběl nejčastěji (data / materiál / pantone)
```

`dataOk`, `materialOk`, `pantoneOk`, `materialInStock`, `materialIssued` **jsou v `AUDITED_FIELDS`**, takže z `AuditLog` jde rekonstruovat, *kdy* se blok stal připraveným. Slíbené termíny přípravy nesou `dataRequiredDate`, `materialRequiredDate`, `pantoneRequiredDate`.

**Rozhodnutí:** odděluje ztrátu způsobenou strojem od ztráty způsobené DTP a MTZ. Report dnes neumí říct, kdo plán rozbíjí.

**Tuhle metriku by nedodal ani koupený APS** — ta data v něm nejsou.

### 5.6 Podíl IML na kapacitě XL 106

```
IML_h / computeAvailableHours("XL_106")   kde IML_h přes bloky s jobPresetLabel = "XL 106 IML"
```

`SYSTEM_JOB_PRESET_NAMES = ["XL 105", "XL 106 LED", "XL 106 IML"]` (`src/lib/jobPresets.ts`). Label se denormalizuje na blok, přežije split i undo. **Report tohle pole nečte ani jednou.**

**Rozhodnutí:** jakým tempem IML roste — jestli je nový stroj tažený poptávkou, nebo kapacitním stropem.

> **POZOR — vzorec výše je ŠPATNĚ a měřením 17. 8. 2026 se to potvrdilo.**
> `jobPresetLabel = 'XL 106 IML'` najde na produkci **13 bloků**. IML v plánu
> ale reálně zabírá **53 bloků a 310 hodin** na XL 106 za posledních 90 dní —
> je totiž zadaný jako **bloky typu `REZERVACE`** s `orderNumber` `IML`
> (46 bloků / 280 h) a `IML - TRANS` (7 / 30 h), ne jako zakázky s presetem.
> Pro srovnání: všechny skutečné `ZAKAZKA` na XL 106 za totéž období mají
> dohromady 250 h — **rezervovaná kapacita na IML je tedy větší než veškerá
> potvrzená výroba na tom stroji.**
>
> Metrika proto musí počítat **obojí** a hlavně je **odlišit**: rezervovanou
> kapacitu (záměr) od potvrzené výroby (skutečnost). Kdyby počítala jen preset,
> ukázala by zlomek reality a vypadala by přitom věrohodně — což je horší než
> kdyby chyběla. Volba klíče (`orderNumber` vs. preset) je navíc křehká, protože
> `orderNumber` je volný text (viz 8.3); před implementací ověřit, jestli se IML
> nedá poznat spolehlivěji.

### 5.7 Přeplánovanost dokončené zakázky

```
zásahy = COUNT(DISTINCT groupId) kde kind='UPDATE' ∧ positional=1 ∧ action ∉ {UNDO,REDO}
```

Dotaz v tomhle tvaru už v repu běží (`src/app/api/report/dashboard/route.ts`, `JSON_CONTAINS_PATH(after,'one','$.startTime','$.endTime','$.machine')`).

**Omezení:** retence 90 dní; nahrávání teprve od 7. 8. 2026; uvnitř jedné transakce nerozlišíš blok, který plánovač chytil, od bloků, které to odsunulo (`viaMany` je u chain pushe i reflow `false`). Metrika tedy poctivě zní „zakázka byla rozhozena v N transakcích", ne „plánovač ji přesunul N×".

**Levná pojistka proti retenci:** noční agregát do souhrnné tabulky, než mazač revize smete.

### 5.8 Drobnosti a UI

- **Prokliknutí z dlaždice na seznam zakázek** — nulová nová data, největší skok v použitelnosti. **Zařazeno do R3.**
- Srovnání s předchozím obdobím a čára průměru v grafech (Prinect to má u každé dlaždice; my nemáme nikde).
- Žebříčky TOP-N: nejvíc posouvané zakázky, nejdéle odkládané, blokované materiálem nebo Pantone.
- Rework přes `AuditLog` action `PRINT_UNDO`; nedodělané zakázky (Monitor tu množinu už umí přes `UNFINISHED_LOOKBACK_DAYS`).

---

## 6. Co počkat na ERP a co na stroje

**Na Pace / Abra Gen** — celá peněžní vrstva. `Block` nenese cenu, náklad, množství, gramáž, papír ani zákazníka. Bez toho nejde spočítat příspěvek na úhradu na strojhodinu, dosaženou sazbu ani ziskovost zakázky.

> **Nestavět nic z toho vlastními silami** — vznikly by dvě pravdy a ta naše by prohrála.

**Ale jedna věc na ERP čekat NESMÍ, protože ho podmiňuje: spojovací klíč.** `Block.orderNumber` je volný text bez unikátního indexu, kontrolovaný jen na neprázdnost — a vlastní identita zakázky v aplikaci není `orderNumber`, ale `splitGroupId ?? Block.id`. Než se Pace napojí, musí `orderNumber` dostat validovaný formát. Jinak se peněžní vrstva nebude mít nač napojit a přijde se na to po go-live 1. 11. 2026.

**Na data ze strojů (Prinect, ne Pace)** — OEE, Speed/Quality/Time Index, makeready time, mytí, zmetkovitost. XL 105 i XL 106 to umí posílat (XJDF/XJMF, CIP4) a Heidelberg to už umí spočítat. **Je to rozhodnutí o nákupu a integraci, ne o vývoji.**

---

## 7. Co nedělat vůbec

- **OEE z plánovaných dat.** Bez počítadel stroje vymyšlené číslo v manažerském reportu. Ani neaproximovat.
- **What-if scénáře a APS optimalizaci.** Třída PrintFlow 4D; navíc naráží na pravidlo „minimum automatiky bez vědomí plánovače".
- **Žebříčky výkonu operátorů.** Prinect je má (WORST 10 waste by operator), ale bez zmetkovitosti bychom řadili lidi podle toho, kdo zmáčkl „Hotovo". Konzistentní s rozhodnutím zrušit žebříček plánovačů.
- **Druhá BI vrstva.** Až bude Pace, plánovač má zůstat operativním nástrojem s dopředným pohledem.
- **Makespan, OTIF „in full", TEEP/MTBF/MTTR** — buď z nich neplyne rozhodnutí, nebo vyžadují evidenci, kterou aplikace nemá mít.

---

## 8. Blokující krok před R4 — ZMĚŘENO 17. 8. 2026 na produkci

Blokující krok proběhl nad ostrou DB `igvyroba`. **R4b je odblokovaná.**

### 8.1 Vyplněnost polí

Měřeno nad zakázkami, jejichž `startTime` **už proběhl** — horní mez je nutná,
bez ní se do vzorku připočte plán rok dopředu a `printCompletedAt` vyjde
falešně mizerně (první pokus dal 16,8 % místo 44,4 %).

| Okno | Zakázek | Termín | Odklepnuto | Měřitelných pro OTD |
| --- | --- | --- | --- | --- |
| posledních 90 dní | 117 | 59,8 % | 44,4 % | 27 |
| posledních 30 dní | 71 | 60,6 % | **69,0 %** | 26 |

Nad celým vzorkem (i s budoucím plánem, 310 zakázek): `jobPresetId` **92,3 %**,
`jobPresetLabel = 'XL 106 IML'` u **13 bloků**.

**Co z toho plyne:**
- **Preset je prakticky vždy vyplněný (92 %)** → metrika 5.6 (podíl IML) je plně proveditelná, bez procesní změny.
- **Termín drží stabilně kolem 60 %** → OTD má poctivého jmenovatele, ale v popisku musí být přiznáno, že se počítá ze tří pětin zakázek.
- **Odklepávání prudce roste: 44 % → 69 %** mezi 90- a 30denním oknem. Z 27 párů (termín + odklepnutí) za čtvrt roku jich **26 vzniklo za posledních 30 dní** — praxe se rozjela teprve nedávno, patrně s Monitorem u stroje. Dnešní vzorek pro OTD je tedy tenký, ale roste zhruba o 26 zakázek měsíčně.

### 8.2 Kaskáda kapacity (5.4) — první reálná čísla

12 týdnů, 84 dnů na stroj, **žádná mezera v rozvrzích**. Dopředu je naplánováno
322 dnů (až 28. 6. 2027), takže heatmapa Výhledu má z čeho čerpat.

| Stroj | Aktivních dnů | Ráno | Odpoledne | Noc | Hrubý odhad obsazenosti kalendáře |
| --- | --- | --- | --- | --- | --- |
| XL 105 | 61 z 84 | 61 | 60 | **0** | ≈ 968 h z 2 016 → **48 %** |
| XL 106 | 61 z 84 | 60 | 60 | **9** | ≈ 1 032 h z 2 016 → **51 %** |

Neaktivních 23 dnů z 84 odpovídá víkendům. **Noční směna se na XL 105 za dvanáct
týdnů nejela ani jednou.** Odhad hodin počítá s nominálními 8 h na směnu a
nezapočítává odstávky ani override `*StartMin`/`*EndMin` — přesné číslo dává
sekce Využití kalendáře. Směr je ale natolik výrazný, že odpovídá na otázku,
kvůli které kaskáda vznikla: **rezerva je dnes ve směně, ne ve stroji.**

### 8.3 `orderNumber` před napojením Abry (kap. 6)

506 zakázek, **337 různých čísel**, 42 % obsahuje i jiné znaky než číslice,
délka 2–15. Rozpad počtu bloků na jedno číslo:

| Bloků na číslo | 1 | 2 | 3 | 4 | 5 | 6 | **22** | **81** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kolik čísel | 281 | 46 | 5 | 1 | 1 | 1 | **1** | **1** |

Jeden až tři bloky na číslo je legitimní (split, OBÁLKA/VNITŘKY). Dvě krajní
hodnoty jsou ale něco jiného, než to na první pohled vypadá:

| `orderNumber` | Bloků | Rozsah |
| --- | --- | --- |
| `HARM` | 81 | 3. 6. 2026 – 25. 3. 2027 |
| `ALBI` | 22 | 11. 9. 2026 – 5. 2. 2027 |
| `18648` | 6 | 13. 5. 2026 – 2. 9. 2026 |

**Nejsou to zástupné hodnoty ani balast — jsou to jména zákazníků.** Plánovač
si pod ně rezervuje kapacitu tři čtvrtě roku dopředu, tedy na práci, u které
konkrétní číslo zakázky ještě neexistuje. Je to legitimní provozní postup,
který plán musí umět.

**Co to znamená pro napojení Abry (kap. 6): naivní oprava by rozbila reálný
workflow.** Kdyby `orderNumber` dostal jen validovaný číselný formát, dopředná
rezervace kapacity by přestala jít zadat. Řešení proto musí odlišit dva různé
stavy — potvrzenou zakázku s číslem a rezervovanou kapacitu pro zákazníka —
buď samostatným polem zákazníka s nepovinným číslem, nebo příznakem
„předběžná". **Rozhodnout se musí dřív, než se Pace napojí.**

Reportů se to naštěstí netýká: identita zakázky je v aplikaci
`splitGroupId ?? Block.id`, ne `orderNumber` (viz 5.1). Kdyby ale někdo
postavil metriku klíčovanou na `orderNumber`, slil by 81 nesouvisejících
zakázek do jedné.

---

## 9. Otázka do implementace Pace

**Pace nemá veřejnou dokumentaci** — oficiální WebHelp mirror je odstavený, archiv bez obsahu reportů. Navíc dashboardy pro Pace (Late Job List, Cost Center Dashboard) prodává **třetí strana**, což napovídá, co Pace ve standardu nedává.

Do zadání pro IT-PRO patří: **„Pošlete seznam standardních dashboardů a reportů Pace."** Veřejně to nezjistíte a při implementaci je to legitimní požadavek.

---

## 10. Zdroje

**Polygrafie:** [Prinect Smart BI — katalog KPI](https://onlinehelp.prinect-lounge.com/Prinect_Smart_BI/en/Prinect/Production_Data/Production_Data-2.htm) · [Prinect — seznam 16 reportů](https://onlinehelp.prinect-lounge.com/Prinect_Smart_BI/en/Prinect/userInterface/userInterface-4.htm) · [Heidelberg OEE benchmark](https://www.heidelberg.com/global/en/products/offset_printing/topics_1/oee/oee.jsp) — **průmyslový průměr ~20 %, XL 106 Push-to-Stop ~27 %, špička 50 %+; NE 85 %** · [PrintVis Analysis Pages](https://learn.printvis.com/Legacy/Reports/AnalysisPages/) · [PrintVis Deviation Report](https://learn.printvis.com/Legacy/Reports/DeviationReport/) · [PrintVis Cost Center Monitor](https://learn.printvis.com/Legacy/JobCosting/CostCenterMonitor/) · [CERM Smart BI](https://www.cerm.net/smart-bi) · [Optimus Intelligence](https://www.optimusmis.com/solutions/intelligence/) · [EFI PrintFlow 4D](https://go.efi.com/rs/559-INV-406/images/eps_br_printflow_en.pdf)

**Controlling:** [bvdm — kapacitní řetězec (PDF)](https://mediencommunity.de/system/files/wbts/rechnungswesen/download/pdf/MC2BRW06.pdf) · [bvdm — Auftragszeiten (PDF)](https://mediencommunity.de/system/files/12.06_Auftragszeiten.PDF) · [CAFINews — spirála smrti s čísly](https://news.cafin.cz/clanek/hodinove-sazby-otestuji-vasi-duveryhodnost) · [Nekvapil — jaký čas pro hodinovou sazbu](http://www.financni-manazer.cz/2014/07/jaky-cas-pouzit-pro-hodinovou-sazbu.html) · [Brierley/Cowton/Drury — úrovně kapacity (PDF)](https://cmaaustralia.edu.au/wp-content/uploads/2021/10/JAMAR8-Reasons_for_Adopting-Different-Final.pdf) · [IAS 2.12–2.13](https://www.readyratios.com/reference/ifrs/ias_2_inventories.html) · [TDABC](https://costandprofitability.com/methods/time-driven-activity-based-costing/) · [ACCA — throughput accounting (PDF)](https://www.accaglobal.com/content/dam/acca/global/pdf/sa_nov11_throughput2.pdf)

**Plánování:** [Robinson/Sahin/Gao — metriky nestability (PDF)](https://www.bauer.uh.edu/doctoral/scm/docs/sahin-1.pdf) · [Symestic — schedule adherence a „OEE trap"](https://www.symestic.com/en-us/what-is/schedule-adherence) · [TEEP](https://www.oee.com/teep/) · [JPMTR — OEE ve web-offsetu (PDF)](https://jpmtr.org/jpmtr_11\(2022\)4_web_2220.pdf)

**Nezjištěno:** katalog dashboardů Pace (bez veřejné dokumentace) · Prinect Scheduler (403) · aktuální sazby bvdm (placené) · 8 z 20 reportů CERM · konkrétní reporty Tharsternu (za loginem).
