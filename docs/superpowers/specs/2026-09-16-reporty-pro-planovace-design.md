# Reporty pro plánovače a poctivé vytížení — návrh (etapa 2, září 2026)

Datum: 16. 9. 2026 · Zadání: zářijová vlna připomínek plánovače, Vojtův dodatek
(„zprovoznit reporty, aby plánovač viděl vytíženost strojů") · Předchozí etapa:
`2026-09-14-monitor-stitky-a-bublina-design.md`.

## Zadání

Plánovač (Lukáš) dnes reporty nevidí vůbec — modul `/reporty` je natvrdo jen pro
roli ADMIN. Zároveň čísla v něm nejsou důvěryhodná: „vytížení" znamená v každé ze
dvou záložek něco jiného a u strojů s noční nebo víkendovou údržbou hlásí
přeplánování i tam, kde je celá směna volná.

## Rozhodnutí Vojty

Z rozhodovacího artefaktu 14. 9. 2026:

- **R1 = A** — celé reporty zpřístupnit roli PLANOVAT.
- **R2 = A** — obě definice vytížení pojmenovat a opravit počítání u bloků bez
  tiskových hodin.
- **R3 = A** — rozpis tiskařů jako zdroj kapacity až po 31. 10. 2026, mimo tuhle etapu.

Doplněno 16. 9. 2026 v rozhovoru:

- **Retrospektiva i Výhled zůstávají rovnocenné.** Lukáš potřebuje obojí: kam ještě
  smí zaplánovat i jak jsme jeli.
- **Rigidní bloky se ořežou na skutečně obsazené směny.** Noční údržba mimo směnu se
  do vytížení nezapočítá vůbec; údržba uvnitř směny se počítá jako obsazený čas
  stroje. Varianta „údržba snižuje kapacitu" i varianta „nechat čísla a jen je
  popsat" byly zvážené a zamítnuté.
- **Pojmenování:** Retrospektiva „Vytížení výrobou", Výhled „Obsazenost směn".
- **`plannerActivity` zůstává v odpovědi API beze změny** (viz 1.2).

## Stav dnes

### Přístup

Modul drží na roli ADMIN **sedm míst** (průzkum 16. 9. 2026,
`scratchpad/pruzkum-reporty-role.md`):

| # | Místo | Co dělá |
| --- | --- | --- |
| 1 | `src/middleware.ts`, blok `/reporty` (dnes ~ř. 60) | `role !== "ADMIN"` → redirect na `/` |
| 2 | `src/middleware.ts`, blok `/api/report/dashboard` (~ř. 67) | `role !== "ADMIN"` → 403 |
| 3 | `src/app/reporty/page.tsx` | druhá vrstva: `session.role !== "ADMIN"` → redirect |
| 4 | `src/app/api/report/dashboard/route.ts` | `ALLOWED_ROLES = new Set(["ADMIN"])` (starší return-style gate) |
| 5 | `src/app/api/report/attention/route.ts` | `requireRole(["ADMIN"])` — **jediná** ochrana cesty |
| 6 | `src/app/api/report/health/route.ts` | `requireRole(["ADMIN"])` — **jediná** ochrana cesty |
| 7 | `src/app/_components/PlannerPage.tsx` | odkaz „Reporty" v hlavičce jen pro ADMIN |

Middleware cesty `attention` a `health` vůbec nejmenuje, takže stojí čistě na
kontrole uvnitř routy. **Všechna tři API se proto musí měnit společně** — jinak by
plánovači fungovala jen část stránky.

Sdílená konstanta rolí v projektu **neexistuje**; každý modul si pole rolí opisuje
lokálně (Správa, Rezervace, presety). Etapa tenhle zvyk nemění, jen ho následuje.
Autorizaci reportů dnes nehlídá **ani jeden test**.

`/report/daily` (jednostránkový tiskový přehled dne) je jiný modul a plánovač ho
vidí už dnes — etapa se ho netýká.

### Výpočet vytížení

Průzkum 16. 9. 2026 (`scratchpad/pruzkum-reporty-vytizeni.md`) potvrdil dvě definice
i vadu:

- **Retrospektiva** (`handleRetro`, karta „Vytížení"): čitatel jen `ZAKAZKA`, a to
  přes skutečné tiskové segmenty (`usesTiskoveHodiny` → `blockReportSegments`).
  Rezervace se do ní záměrně nepočítají (etapa 9, rozhodnutí #5: držená kapacita
  není odvedená práce) a mají vlastní ukazatel.
- **Výhled** (`handleOutlook`, karta „Kapacita"): čitatel **všechny typy bez
  rozlišení**, a segmenty se staví jen pro `type === "ZAKAZKA"` — ne přes
  `usesTiskoveHodiny`. Údržba, legacy rezervace i **tisková IML rezervace** tedy
  dostanou hrubou kalendářní délku bez ohledu na směny.
- **Stavový pás Kontrolního panelu** (`api/report/attention`) je postavený na týchž
  vstupech jako Výhled a má tutéž vadu. Navíc běží na pevném 30denním horizontu,
  nezávisle na období zvoleném v reportech.
- **„Podíl údržby"** v Retrospektivě trpí toutéž vadou vždy, protože
  `usesTiskoveHodiny` je pro ÚDRŽBU natrvalo `false` (vědomé rozhodnutí 19. 8. 2026).

Jmenovatel je u obou definic tentýž: `computeAvailableHours` = skutečné hodiny směn
z `MachineWeekShifts` minus odstávky `CompanyDay`. Žádný pevný předpoklad o počtu
směn v něm není.

**Modelový příklad vady.** Stroj má jedinou ranní směnu 6–14 (8 h), v noci 22–6 běží
osmihodinová údržba:

| Veličina | Dnes | Realita |
| --- | --- | --- |
| Dostupné hodiny (jmenovatel) | 8 h | 8 h |
| Údržba mimo směnu (čitatel) | 8 h | 0 h — se směnou se nepotká |
| Vytížení | **100 %, „0 h volných"** | 0 % |
| Po přidání 1h zakázky do směny | **113 %, „přeplánováno o 1 h"**, červeně | 12,5 % |

## Řešení

### 1. Přístup pro roli PLANOVAT

**1.1 Sedm míst.** Všude, kde dnes stojí samotné `"ADMIN"`, bude `["ADMIN",
"PLANOVAT"]` — týmž zápisem, jakým je dnes povolená Správa (`/admin`) a Rezervace.
Odkaz „Reporty" v hlavičce planneru se plánovači zobrazí stejně jako „Správa".
Komentáře, které dnes tvrdí „ADMIN-only", se přepíšou; nepravdivý komentář je v
tomhle projektu vada (`docs/POUCENI.md`, P19).

**1.2 `plannerActivity` zůstává.** Odpověď `/api/report/dashboard?mode=retro` nese
pole `plannerActivity` — jmenovitý žebříček zásahů do plánu podle uživatele. UI ho
od etapy R3 nekreslí (rozhodnutí Vojty: jmenovité srovnávání lidí do provozního
reportu nepatří), ale server ho posílá dál. **Vojta 16. 9. 2026 rozhodl nechat to,
jak je**, s vědomím důsledku: plánovači si ho po zpřístupnění reportů zobrazí v
nástrojích prohlížeče. Rozhodnutí z R3 tedy platí pro vzhled stránky, ne pro data.
Etapa s polem nijak nemanipuluje.

**1.3 Dokumentace a strážný test.** Do tabulky „Role a přístup" v `CLAUDE.md`
přibude sloupec Reporty (dnes tam chybí úplně). Vznikne strážný test nad zdrojovým
textem (vzor `monitorChipsWiring.test.ts`, pomocník `@/lib/sourceTextTestUtils`),
který ověří, že **všech šest serverových míst** (1–6) povoluje ADMIN i PLANOVAT.
Důvod: dnes autorizaci reportů nehlídá nic, takže budoucí refaktor může tiše
rozpojit jedno místo a projeví se to až u uživatele.

### 2. Poctivý čitatel

**2.1 Jeden zdroj intervalů.** Stavba „obsazených směn" (intervaly směn sloučené
přes `mergeIntervals` minus odstávky) je dnes uvězněná uvnitř
`computeAvailableHours` a podruhé, pro jiný účel, uvnitř `computeCalendarCascade`.
Vytáhne se do exportované funkce v `src/lib/reportMetrics.ts`:

```
staffedIntervals(machine, rangeStart, rangeEnd, weekShifts, companyDays): Interval[]
```

`computeAvailableHours` z ní bude jen `totalHours(...)`, takže **čitatel i jmenovatel
budou stavět na týchž intervalech** a nemohou se rozejít. Chování
`computeAvailableHours` se nemění — jeho dnešních 14 testů musí projít beze změny.

**2.2 Ořez rigidního bloku.** Nová funkce nad týmiž intervaly:

```
staffedOverlapMinutes(block, staffed: Interval[]): number
```

vrátí průnik `[block.startTime, block.endTime)` s obsazenými směnami (přes existující
`intersectIntervals` v `src/lib/intervals.ts`). Okno reportu řešit nemusí — intervaly
jsou už na okno ořezané.

Použije se **místo `printOverlapMinutes(null, …)`** všude, kde dnes rigidní blok
vstupuje do poměru vůči hodinám směn:

- `handleOutlook` — `plannedHours` (údržba, legacy rezervace, odložené a rozejité bloky),
- `api/report/attention` — táž agregace ve stavovém pásu,
- `handleRetro` — `maintenanceHours` („Podíl údržby") a legacy část `reservedHours`
  („Rezervovaná kapacita").

Bloky, pro které jdou spočítat tiskové segmenty, se počítají dál přes ně — segmenty
už z definice leží uvnitř směn.

**2.3 Tiskové rezervace i ve Výhledu.** `handleOutlook` a `attention` se přepnou z
`b.type === "ZAKAZKA"` na `usesTiskoveHodiny(b)`, jak to už dělá Retrospektiva. IML
zadané jako rezervace s tiskovými minutami se tím konečně počítá tiskovým časem, ne
nafouknutým kalendářním spanem.

**2.4 Čeho se oprava NEDOTKNE.** `printOverlapMinutes` zůstává beze změny — je to
obecný nástroj („hrubý průnik bloku s oknem") a používá se i tam, kde je hrubý span
správně. Dva existující testy, které jeho chování pinují, tím zůstávají v platnosti.
Poměrové funkce se **nezastropují na 100 %**; skutečné přeplánování uvnitř směn musí
být dál vidět (`docs/POUCENI.md`, P22).

### 3. Pojmenování a popisky

| Kde | Dnes | Nově | Popisek pod číslem |
| --- | --- | --- | --- |
| Retrospektiva | „Vytížení XL 105" | **„Vytížení výrobou XL 105"** | jen zakázky, z hodin obsazených směn |
| Výhled | „Kapacita XL 105" | **„Obsazenost směn XL 105"** | zakázky, rezervace i údržba uvnitř směn |

Sekce ve Výhledu se přejmenuje z „Kapacita" na „Obsazenost směn"; dnešní podtitulek
karty („X h volných" / „přeplánováno o X h") zůstává, je to jediný nositel hodin
volna od etapy R3. Barevná pásma se nemění.

## Co tahle etapa neřeší

- **Rozpis tiskařů jako zdroj kapacity** (R3 = A) — až po 31. 10. 2026.
- **Metriky z kapitoly 5 auditu** (`docs/audits/2026-08-16-reporty-pruzkum-metrik.md`)
  — R4b zůstává zastavená, tahle etapa ji neodblokovává.
- **Nové metriky ani nové grafy.** Etapa mění, kdo reporty vidí, a opravuje čitatel.
- **Finanční data** v reportech nejsou a nepřibývají.

## Dopad na čísla

Po nasazení **klesnou** u strojů s noční či víkendovou údržbou a s legacy rezervacemi
mimo směny: karta obsazenosti ve Výhledu, heatmapa, stavový pás Kontrolního panelu a
„Podíl údržby" v Retrospektivě. Falešné „přeplánováno o X h" u prázdné směny zmizí.

Karta „Vytížení výrobou" v Retrospektivě zůstane skoro stejná; změní se jen u
odložených (`scheduleBypassed`) a rozejitých bloků, které dnes padají na hrubý span —
nově se počítá jen jejich část uvnitř směn. Odložená zakázka zaparkovaná přes víkend
tedy přestane vytížení nafukovat.

**Skutečné přeplánování uvnitř směn se ukazuje dál**, včetně hodnot nad 100 %.

## Testovací strategie

| Co | Jak se ověří |
| --- | --- |
| `staffedIntervals` | Unit: shoda s dnešním `computeAvailableHours` (součet intervalů = dosavadní hodiny) na existujících fixturách; sloučení noční a ranní směny; odečtení odstávky uvnitř směny |
| `staffedOverlapMinutes` | Unit: noční údržba celá mimo směnu → 0 min; údržba částečně zasahující do směny → jen překryv; údržba v den, kdy směna běží → celá délka; blok mimo okno → 0; odstávka uvnitř směny → odečtená |
| `computeAvailableHours` beze změny | Dnešních 14 testů musí projít bez úprav |
| `printOverlapMinutes` beze změny | Dva testy, které fallback pinují, musí zůstat zelené beze změny |
| Zapojení opravy do agregací | Strážný test nad zdrojovým textem: `handleOutlook`, `attention` a rigidní větev `handleRetro` volají `staffedOverlapMinutes`, ne `printOverlapMinutes(null, …)`; Výhled i pás se větví na `usesTiskoveHodiny` |
| Autorizace | Strážný test: všech šest serverových míst povoluje ADMIN i PLANOVAT; odkaz v hlavičce planneru se řídí týmž výčtem |
| Modelový příklad ze zadání | Test s 8h noční údržbou a 1h zakázkou v 8h ranní směně → obsazenost 12,5 %, žádné „přeplánováno" |

## Rizika

1. **„Stroje jsou najednou míň vytížené."** Po nasazení klesnou čísla, na která je
   Vojta zvyklý. Je to oprava, ne regrese — ale musí se to říct dopředu Lukášovi i
   tiskařům, jinak to vypadá jako rozbitý report. Největší rozdíl čekám na XL 106,
   kde leží IML rezervace (310 h za 90 dní podle měření ze 17. 8. 2026) — změřené to
   ale není, je to odhad.
2. **Neoseedované týdny.** Kde chybí řádky `MachineWeekShifts`, je kapacita nula a
   vytížení `null` (nemá z čeho počítat). Nová funkce se chová konzistentně —
   rigidní blok v takovém týdnu přispěje nulou. Etapa tenhle stav nemění, jen ho
   nezhoršuje.
3. **Plánovač uvidí kontrolní panel** s technickými nálezy (překryvy, drift, přílohy
   na disku). Je to provozní diagnostika, ne osobní data; R1 = A ji zpřístupňuje
   vědomě.
4. **Žebříček `plannerActivity`** bude pro plánovače čitelný v nástrojích prohlížeče
   (viz 1.2). Vědomé rozhodnutí Vojty z 16. 9. 2026.

## Otevřené otázky

Žádné. Všechna rozhodnutí jsou uzavřená v sekci „Rozhodnutí Vojty".
