# Reporty — správnost čísel (etapa R1) — Design

**Datum:** 2026-08-14
**Autor:** Vojta + Claude
**Stav:** návrh ke schválení
**Průzkum:** artifact „Reporty — průzkum a návrh" (14. 8. 2026), tři nezávislé audity

## Proč

Průzkum stránky `/reporty` našel 30 nálezů. Tenhle spec řeší **jen ty, kde stránka
ukazuje nesprávné číslo** — vizuál a přeskládání jsou samostatné etapy R2 a R3.

Pořadí uvnitř specu je podle **změřeného dopadu na produkci**, ne podle toho, jak
vada vypadá v kódu. To pořadí je jiné, než by se čekalo: vada, která v kódu vypadá
nejhůř (neořezané bloky), je na datech až třetí.

### Změřeno nad produkční databází 14. 8. 2026

| Vada | Dopad | Podklad |
| --- | --- | --- |
| Průtok ztrácí zakázky | **3 ze 43** (7 %) | srpen 2026 |
| Bloky se neořezávají na období | **26 h ze 399 h** (6,5 %) v srpnu; týchž 26 h se přičte i k září, kde je to **až 12 %** | 2 bloky přes hranici |
| Odstávky se počítají jako kapacita | **153,9 h** v prosinci, 40 h v září/říjnu/listopadu | 17 záznamů `CompanyDay`, 335,7 h celkem |
| Chybějící stavy rezervací a konverze | dnes **0** | na produkci jen 5 rezervací (3 SCHEDULED, 2 REJECTED) |
| Půlnoc v UTC místo Prahy | dnes **0** | žádné odklepnutí mezi 22:00–24:00 UTC |

Poslední dvě jsou **spící** — vada v kódu je, dopad zatím nulový. Opravují se, protože
jsou levné a protože rezervační modul se teprve rozjede.

## Rozsah

**Jen server** (`src/lib/reportMetrics.ts`, `src/app/api/report/dashboard/route.ts`)
plus **minimální zásahy do UI tam, kde se mění význam čísla** — popisek konverze,
přeplánování místo useknuté nuly, „—" místo nuly u nespočitatelného.

### Non-goals (vědomě mimo R1)

- Přeskládání stránky, stavový řádek, jednotná časová osa, seznam rizik → **R3**
- Barvy, tokeny, `--brand-text`, paleta grafů, škála písem → **R2**
- Zrušení „Přihlášení za období" a „Aktivity plánovačů" → **R3**
- Tichý ořez heatmapy na 14 dní → **R3** (je to čistě UI)
- Nové metriky (rizika, zakázky po termínu, chybějící materiál) → **R3**

## Rozhodnutí (schválena Vojtou 14. 8. 2026)

| Rozhodnutí | Volba |
| --- | --- |
| Rozdělená zakázka v průtoku | **jedna zakázka**, ne jeden kus na blok |
| Význam konverze | **úspěšně vyřízené ze všech uzavřených** |
| Rozsah etapy | server + minimální UI, kde se mění význam čísla |

---

## F1 — Průtok a lead time ztrácejí hotovou práci

**Dopad: 3 ze 43 zakázek v srpnu (7 %).**

**Příčina.** `computeThroughput` i `computeAvgLeadTimeDays` pracují nad polem `blocks`,
které route načetla jako bloky **protínající období**. Zakázka odklepnutá v srpnu, ale
naplánovaná na září, do toho pole nepřijde — a v září se nezapočítá taky, protože tam
už neodpovídá `printCompletedAt`. **Nezapočítá se nikde.**

Pozdní odklepnutí je přitom normální provoz — doloženy odstupy +4,4 h a +11,8 h po konci
bloku (tiskař potvrdí ráno další směnu).

**Řešení.** Samostatný dotaz, nezávislý na poloze bloku v plánu:

```ts
prisma.block.findMany({
  where: { type: "ZAKAZKA", printCompletedAt: { gte: startUtc, lt: endUtc } },
  select: { id: true, splitGroupId: true, createdAt: true, printCompletedAt: true },
})
```

Hranice `startUtc`/`endUtc` už route počítá přes `pragueToUTC` — tím se **současně
opravuje F6** (posun UTC/Praha), protože obě funkce přestanou počítat vlastní půlnoc.

**Rozdělená zakázka = jedna.** Klíč zakázky je `splitGroupId ?? \`b${id}\``
(`Block.id` a `SplitGroup.id` jsou nezávislé id-prostory, proto prefix — táž konvence
jako v `blockShades.ts`). Průtok = počet různých klíčů.

**Lead time per zakázka, ne per blok:** ve skupině se vezme **nejstarší `createdAt`**
a **nejpozdější `printCompletedAt`**. U rozdělené zakázky je to poctivá doba od založení
po dokončení posledního kusu; dnes by každý kus přispěl vlastním, uměle krátkým časem
(díl vzniklý splitem má `createdAt` v okamžiku rozdělení).

**Zaokrouhlení:** dnes `Math.round` na celé dny, takže zakázka odbavená za 12 h i za 34 h
vyjde stejně. Nově **jedno desetinné místo** — v tiskárně se hodně zakázek odbaví do 24 h
a denní granularita je tam slepá.

Nové čisté funkce v `reportMetrics.ts`:

```ts
export type CompletedBlock = {
  id: number; splitGroupId: number | null; createdAt: Date; printCompletedAt: Date;
};
export function groupCompletedToOrders(blocks: CompletedBlock[]):
  Array<{ key: string; createdAt: Date; completedAt: Date }>;
export function computeThroughputFromOrders(orders: ReturnType<typeof groupCompletedToOrders>): number;
export function computeAvgLeadTimeDaysFromOrders(orders: ...): number | null;
```

Staré `computeThroughput` a `computeAvgLeadTimeDays` se **ruší** (jejich testy taky).

---

## F2 — Odstávky se počítají jako dostupná kapacita

**Dopad: 153,9 h v prosinci (celozávodní vánoční odstávka), 40 h v září, říjnu i listopadu.**

**Příčina.** `computeAvailableHours` nedostává `CompanyDay` vůbec — počítá jen ze šablon
směn. Jmenovatel tedy odstávku ignoruje, kdežto **čitatel ji respektuje** (expanze tisku
v odstávce vrátí `START_NOT_RUNNABLE`). Týden celozávodní dovolené se proto vykáže jako
„0 % ze 152 dostupných hodin" místo poctivého „0 z 0".

Dopad není rozprostřený, ale **koncentrovaný do měsíců, které zajímají nejvíc**.

**Řešení.** Nový povinný parametr:

```ts
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayRow[],   // NOVÝ
): number
```

Od součtu minut směn se odečte průnik s odstávkami. Dvě pravidla:

- **`CompanyDay.machine` je nullable a `null` znamená OBA stroje.** Filtr proto musí být
  `cd.machine == null || cd.machine === machine`, ne prostá rovnost — jinak by se
  celozávodní odstávka neodečetla ani jednomu stroji.
- **Odečítá se jen průnik s dobou, kdy stroj podle směn jede.** Odstávka v neděli, kdy
  stroj stejně nejede, nesmí udělat záporné hodiny.

Route už `companyDays` pro rozsah načítá (`handleRetro`, `handleOutlook`) — jen se
předají dál. Volající, kteří odstávky nemají, **neexistují**: `computeAvailableHours`
se volá výhradně z těchhle dvou míst (ověřeno grepem před implementací).

---

## F3 — Bloky se neořezávají na hranici období

**Dopad: 26 h ze 399 h v srpnu (6,5 %); týchž 26 h se přičte i k září, kde je to až 12 %.**

**Příčina.** Route načte bloky, které rozsah jen **protínají**, a `computeBlockHours`
sečte jejich **celou** délku. Dostupné hodiny ve jmenovateli přitom ořezané jsou.

Chyba je oboustranná (přesah zleva i zprava) a jednosměrná v hodnotě — **vždy nahoru**.
Tytéž bloky se pak započtou znovu celé i v následujícím období, takže **součet dvanácti
měsíčních reportů nedá rok**.

**Řešení.** Souhrn počítá **týmž ořezem jako denní graf** — `printOverlapMinutes` nad
oknem celého období:

```ts
const clippedHours = (b) => printOverlapMinutes(segMap.get(b) ?? null, b, startUtc, endUtc) / 60;
```

Platí pro `productionHours` a `maintenanceHours` v `handleRetro` i pro `plannedHours`
v `handleOutlook`.

**Ruší se `computeBlockHours` i `blockDurationHours`.** Ověřeno grepem: `blockDurationHours`
má jediného volajícího mimo `computeBlockHours` — právě řádek `handleOutlook`, který F3
nahrazuje. Po opravě by zůstalo mrtvé.

---

## F4 — Souhrn a graf pod ním tvrdí každý něco jiného

**Řeší se samo opravou F3** — obě čísla přestanou být dvě definice.

Zbývá druhá, nezávislá cesta rozejití: když se uložený konec bloku rozejde s kalendářem,
vrátí `blockReportSegments` `null` a graf spadne na elapsed celého spanu, kdežto souhrn
drží `printMinutes`. Naměřeno **8,5 h rozdílu na jediném bloku**.

Po F3 jedou obě čísla přes `printOverlapMinutes` se stejným `segMap`, takže i tahle cesta
mizí — obě strany degradují stejně.

**Hlídá to strážný test:** pro několik rozsahů musí platit
`součet denních hodnot === souhrn` (do zaokrouhlení).

---

## F5 — Konverze a chybějící stavy rezervací

**Dopad dnes 0** (produkce má 5 rezervací), vada zůstává na spuštění modulu.

**Dvě samostatné vady.**

**(a) Trychtýř zná 5 stavů, aplikace jich používá 8.** Mimo zůstávají `CONFIRMED`,
`COUNTER_PROPOSED` a `WITHDRAWN`. `CONFIRMED` je přitom koncový **úspěch**
(`SCHEDULED → CONFIRMED`), takže vypadne z čitatele, kdežto zamítnutá rezervace ve
jmenovateli zůstane napořád — **konverze klesá tím rychleji, čím lépe proces funguje.**

**(b) Dotaz míchá dvě populace.** `OR: [{createdAt v období}, {status in otevřené}]`
znamená, že otevřené stavy jsou **všechny otevřené kdykoli**, kdežto uzavřené jen ty
založené v období. Doloženo: v srpnovém reportu se objevily rezervace z března a dubna.

**Řešení.** Rozdělit na dvě jasně pojmenované skupiny:

```ts
pipeline: {
  /** Stav k dnešku, NEZÁVISLÝ na období. */
  open: { SUBMITTED, ACCEPTED, QUEUE_READY, COUNTER_PROPOSED },
  /** Uzavřené v období. */
  closed: { SCHEDULED, CONFIRMED, REJECTED, WITHDRAWN },
  conversionPercent: number | null,
}
```

**Konverze = úspěšně vyřízené ze všech uzavřených** (rozhodnutí Vojty):

```
(SCHEDULED + CONFIRMED) / (SCHEDULED + CONFIRMED + REJECTED + WITHDRAWN)
```

Prázdný jmenovatel → **`null`**, v UI „—", ne „0 %". Dnešní „Konverze: 0 %" u prázdné
fronty vypadá jako katastrofa místo „není co měřit".

**Popisek se musí srovnat s výpočtem.** Dnes tvrdí „(přijaté → naplánované)", ačkoli se
stav `ACCEPTED` do vzorce vůbec nedostane. Nově: „úspěšně vyřízené z uzavřených".
Špatné číslo se opraví; **špatně pojmenované číslo si uživatel opraví v hlavě a už mu
nevěří.**

Seznam stavů se bere z **jediného zdroje pravdy** — nová konstanta
`RESERVATION_STATUSES` v `src/lib/reservationStatus.ts`, kterou budou sdílet route
i `api/reservations/route.ts` (dnes má vlastní kopii v `statusFilter`). Strážný test
hlídá, že trychtýř pokrývá všechny stavy — jinak se přidáním devátého stavu tiše zopakuje
dnešní vada.

---

## F6 — Půlnoc v UTC místo pražské

**Dopad dnes 0** (žádné odklepnutí mezi 22:00–24:00 UTC).

`computeThroughput` a `computeAvgLeadTimeDays` si počítají hranice jako
`new Date(rangeStart + "T00:00:00Z")`, zbytek routy přes `pragueToUTC` — **posun 2 h**.
Porušuje pravidlo z CLAUDE.md („Datum na serveru: vždy přes Prague helpery").

**Řeší se opravou F1** — obě funkce zanikají a jejich náhrady dostávají hranice z routy.

---

## F7 — Přeplánování, nulová kapacita a strop utilizace

**Tři vady, které dohromady schovávají nejdůležitější informaci Výhledu.**

| Vrstva | Dnes | Nově |
| --- | --- | --- |
| Nadhodnocený čitatel | 40 h do jednoho dne → kapacita 286 % | řeší F3 |
| Clamp volných hodin | `Math.max(0, …)` → „0 h volných" | `overbookedHours` v odpovědi |
| Barva bez horní meze | `≥ 80 % → zelená`, tedy 286 % svítí zeleně | větev `> 100 %` |

**`freeHours` se přestane useknout.** Odpověď dostane vedle něj `overbookedHours`
(kladné číslo, o kolik hodin je nad kapacitou). UI to zobrazí jako **„přeplánováno
o 26 h"** červeně místo „0 h volných".

**Nulová kapacita ≠ prázdno.** Když `availableHours === 0` (víkend, odstávka, chybějící
šablony směn), vrací se **`null`**, ne `0`. UI ukáže „—" nebo „stroj nejede".
Dnes „8 h zakázky ve dni bez směny" a „nic naplánováno" vypadají identicky — a od dubna
2027, kam nesahají šablony, by report tvrdil „nula naplánováno, nula volno".

`KpiCard` už `string | number` umí, takže „—" je bez úprav komponenty.

**Pozor na dosah téhle změny.** `computeUtilization` se nevolá jen pro souhrn, ale i
v denních smyčkách obou režimů (čtyři volání celkem, ověřeno grepem). Změna návratového
typu na `number | null` se proto propíše do `dailyUtilization` i `dailyCapacity`, a tím
až do grafu a heatmapy. **Je to záměr:** den, kdy stroj nejede, se konečně odliší od dne,
na který nikdo nic nenaplánoval — dnes obojí vrací `0` a kreslí se stejně šedě.
V R1 stačí, aby UI takový den nevykreslilo jako nulu; šrafu a pořádnou legendu řeší R3.

**Utilizace se nezastropuje** (číslo má být poctivé), ale **UI ji musí odlišit**: nad
100 % nesmí být zelená. Minimální zásah v R1: prahová větev u KPI karty a v `heatColor`.
Pořádnou vizualizaci s pásmem nad 100 % řeší R3.

---

## F8 — Drobnosti

- **`upcomingMaintenance` ukazuje údržby, které už proběhly.** Řadí se vzestupně a bere
  se prvních pět, přičemž období může začínat v minulosti — v měsíčním pohledu ke 14. 8.
  se jako „plánované" vypsaly dvě údržby z 5. 8. Filtr `endTime > now` na serveru.
- **`maintenanceRatio` se počítá přes oba stroje dohromady**, takže odstávka jednoho se
  ředí kapacitou druhého. Doplnit i per-machine hodnotu (per-machine `maintenanceHours`
  se už počítá, jen se nevrací).
- **Desetinná čárka.** Hodiny se dnes vypisují jako `137.25 h` vedle karty, která tutéž
  věc píše s čárkou. Sjednotit na české `137,3 h` (jedno desetinné místo — dvě setiny
  hodiny je falešná přesnost) a doplnit `tabular-nums`, aby čísla při přepnutí období
  neposkakovala.
- **Čekající rezervace nerespektují období** a `oldestWaitingDays` se počítá proti
  `Date.now()`. Doloženo: leden 2027 a srpen 2026 vrací identický výsledek. Je to
  legitimní metrika „stav k dnešku" — jen musí být **takhle popsaná**, ne stát bez
  označení vedle metrik za období. Popisek: „stav k dnešku, nezávisle na období".
  Prázdná fronta → „—", ne „0 dní".

---

## Dotčené soubory

| Soubor | Změna |
| --- | --- |
| `src/lib/reportMetrics.ts` | ruší `computeThroughput`, `computeAvgLeadTimeDays`, `computeBlockHours`; přidává `groupCompletedToOrders`, `computeThroughputFromOrders`, `computeAvgLeadTimeDaysFromOrders`; `computeAvailableHours` bere odstávky; `computeUtilization` vrací `number \| null` |
| `src/lib/reservationStatus.ts` | **nový** — `RESERVATION_STATUSES`, rozdělení na otevřené/uzavřené, jediný zdroj pravdy |
| `src/app/api/report/dashboard/route.ts` | ořez souhrnu, dotaz na dokončené zakázky, odstávky do dostupnosti, nový tvar `pipeline`, `overbookedHours`, filtr údržeb |
| `src/lib/reportMetrics.test.ts` | rozšíření (viz Testy) |
| `src/app/reporty/_components/ReportDashboard.tsx` | jen text a čísla: popisek konverze, „přeplánováno o X h", „—" místo 0, větev nad 100 %, česká čárka |
| `src/app/reporty/_components/PlanningSection.tsx` | česká čárka, `tabular-nums` |

`src/app/api/report/health/route.ts` a Kontrolní panel se **nemění**.

## Testy

- **Průtok:** rozdělená zakázka na dvou blocích → **1**; zakázka odklepnutá v období, ale
  naplánovaná mimo něj → **započítá se**; odklepnutí přesně na hranici půlnoci (pražské).
- **Lead time:** skupina bere nejstarší `createdAt` a nejpozdější `printCompletedAt`;
  prázdná množina → **`null`**, ne 0; jedno desetinné místo.
- **Dostupnost:** odstávka `machine = null` se odečte **oběma** strojům; odstávka mimo
  směny neudělá záporné hodiny; odstávka přes půlnoc proti noční směně.
- **Ořez:** blok přesahující rozsah zleva i zprava přispěje jen průnikem; **parita** —
  součet denních hodnot === souhrn pro několik rozsahů.
- **Pipeline:** strážný test, že trychtýř pokrývá **všechny** stavy z
  `RESERVATION_STATUSES`; konverze při prázdném jmenovateli → `null`.
- **Utilizace:** `availableHours === 0` → `null`, ne 0; nad 100 % se nezastropuje.

## Známá omezení

- Dopad F3 na produkci je dnes 26 h v srpnu; **měsíce s vícedenními zakázkami přes
  hranici to mohou mít vyšší**. Oprava je strukturální, takže na velikosti nezáleží.
- F5 a F6 se opravují „naslepo" — na produkci dnes nemají dopad. Testy proto stojí na
  konstruovaných datech, ne na reálném vzorku.
- R1 **nemění rozvržení**, takže stránka bude po nasazení vypadat stejně; změní se
  hodnoty a několik popisků. Vizuální dojem řeší R2 a R3.
