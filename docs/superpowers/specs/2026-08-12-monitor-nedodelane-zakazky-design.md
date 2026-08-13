# Monitor u stroje — nedodělané zakázky z minulých dnů

Datum: 12. 8. 2026 · Stav: REALIZOVÁNO 13. 8. 2026 (plán `docs/superpowers/plans/2026-08-13-monitor-nedodelane-zakazky.md`)
Vyvolala: připomínka plánovače (8/2026)

> „Když v pátek večer nestihnout vytisknout zakázku, o víkendu se tisknout nebude
> a v pondělí a úterý bude svátek, uvidí tiskaři, jakou zakázkou mají ve středu
> začít? (budou se zobrazovat ve frontě i několik dní staré nevytištěné zakázky?).
> Současná podoba na mě působí tak, že se nevytištěné zakázky přetahovat nebudou,
> ale třeba se mýlím."

**Nemýlí se.** A je to horší, než tuší.

---

## 1. Zjištěný stav — čtyři nezávislé brány

Nedodělaná páteční zakázka se tiskaři ve středu **nezobrazí nikde**.

| # | Kde | Proč propadne |
| --- | --- | --- |
| 1 | Velká karta | `pickHeroBlock` bere `overdue` jen do `OVERDUE_WINDOW_MS` (16 h od konce). Pátek 22:00 → středa 6:00 je ~104 h. Spadne na `pickNextBlock`. |
| 2 | Fronta | `monitorQueue` filtruje podle **civilního pražského dne `startTime`**, jen dnešek a zítřek. |
| 3 | „Celý plán →" | `effectiveDaysBack = isTiskar ? 1 : daysBack` — tiskař vidí 1 den zpět. `TimelineGrid` navíc bloky bez překryvu s rozsahem vůbec nevykresluje. |
| 4 | „🔍 Najít" | Zakázku **najde**, ale klik je slepá ulička: `jumpToBlockFromMonitor` přepne do plánu, blok tam není vykreslený (bod 3), `handleJumpToOutOfRange` zvedne `daysBack`, který je u tiskaře ignorovaný, plán odscrolluje na začátek rozsahu a `setSelectedBlock` neotevře nic, protože `BlockDetail` je za `{canEdit && …}`. |

Zvláštní případ brány 1: když na stroji na dnešek **nic naplánováno není**, `pickHeroBlock`
vrátí `null` a Monitor hlásí „Na tomhle stroji nic naplánováno." — tedy aktivně tvrdí,
že není co dělat, zatímco nedodělek leží pár dní zpátky. Ve scénáři z připomínky
(středa po dvou svátcích) je to pravděpodobný stav.

**O nedodělané zakázce se nedozví ani nikdo jiný.** Není na to notifikace, není
v provozním reportu, `calendarDrift` ji nechytí (v pátek 22:00 kalendáři vyhovovala —
problém je, že je v minulosti, ne že sedí špatně).

## 2. Rozhodnutí majitele (Vojta, 12. 8. 2026)

| Otázka | Rozhodnutí |
| --- | --- |
| Kdo nedodělek řeší | **Jen tiskař.** Stačí mu ji ukázat, aby ji mohl odklepnout. |
| Přeplánovat blok | **Ne.** Nic se nikam neposouvá („minimum automatiky bez vědomí plánovače"). |
| Notifikace plánovači | **Ne.** |
| Kam na Monitoru | **Vlastní sekce ve frontě**, velká karta beze změny. |
| Jak daleko zpět | **14 dní.** |
| Zkreslení reportu (§9) | **Známé omezení, report se nešahá.** |

## 3. Pravidlo — co je nedodělaná zakázka

`monitorQueue` (`src/lib/monitorView.ts`) začne vracet třetí klíč `overdue`.
Blok do něj patří, když platí **všechno**:

- `type === "ZAKAZKA"` a `machine` odpovídá zobrazenému stroji,
- `printCompletedAt == null`,
- `blockVariant !== "POZASTAVENO"` (viz §3.3),
- `endTime` je **před dnešní pražskou půlnocí**,
- `endTime` není starší než `UNFINISHED_LOOKBACK_DAYS = 14` dní.

Řazení vzestupně podle `startTime` — celá fronta se čte chronologicky shora dolů
(NEDODĚLÁNO → Dnes → Zítra).

### 3.1 Proč `endTime`, ne `startTime`

Je to past, na které už jednou stálo 16hodinové okno (`docs/vyvoj-historie.md`,
10. 8. 2026). Noční směna 22:00–6:00 začala včera, ale končí dnes. Podle `startTime`
by spadla do NEDODĚLÁNO ve chvíli, kdy právě běží na velké kartě. Podle `endTime`
nespadne. `pickHeroBlock` i `overdueAlarmState` počítají od konce — nová sekce se
s nimi nesmí rozejít.

### 3.2 Proč se hranice počítá z civilních dnů

`todayPragueDateStr()` → `addDaysToCivilDate(-14)` → `pragueToUTC(…, 0, 0)`.
Nikdy ne odečtením 14 × 24 h — to by okno posunulo o hodinu při přechodu na
letní/zimní čas. Konvence z `CLAUDE.md` („Datum na serveru").

### 3.3 POZASTAVENO se vylučuje

Plán pozastavenou zakázku z „po termínu" **vědomě vylučuje** — `BlockCard` pro
`blockVariant === "POZASTAVENO"` `overdueAlarmState` vůbec nevolá. Je to výrobní
stopka, ne zpoždění. Kdyby ji Monitor ukázal jako nedodělanou, obě obrazovky by
o téže zakázce tvrdily opak.

> Původní návrh ji chtěl ukázat s červeným chipem „Pozastaveno". Průzkum
> (12. 8. 2026) tuhle nesrovnalost našel a rozhodnutí se obrátilo.

### 3.4 Překryv s velkou kartou je v pořádku

Zakázka, která skončila včera ve 23:00, je dnes v 6:00 pořád uvnitř 16h okna →
je zároveň na velké kartě jako „PŘETAHUJE" i v sekci NEDODĚLÁNO. `MonitorQueue`
to už umí: řádek shodný s `heroId` dostane zelený rámeček. Žádná speciální větev.

### 3.5 Proč se NEPOUŽIJE `overdueAlarmState(...) === "stale"`

Nabízí se to — `stale` je přesně „neodklepnuté a starší než 16 h" a byl by to
sdílený zdroj pravdy s plánem. **Zamítnuto:** odpovídá na jinou otázku (16 h =
„je to ještě akutní"), a vznikla by dvouhodinová slepá skvrna. Zakázka, které je
14 h a zároveň na stroji něco běží, není na kartě (running vyhrává) a nebyla by
ani v sekci (ještě není `stale`).

Civilní den má vlastní slepou skvrnu taky — jen jinde a užší. 16h okno hero
karty pro neodklepnutou zakázku vyprší dnes ve 22:00 (den po startu), ale
`endTime < todayMidnightMs` do sekce NEDODĚLÁNO pustí až po půlnoci — mezi
22:00 a půlnocí není zakázka nikde vidět. Je to vědomě přijaté: dvě hodiny, ne
dva dny jako u zamítnuté `stale` varianty, a řešit by ji šlo jen tak, že by se
`endTime < todayMidnightMs` nahradilo něčím, co počítá od konce bloku, tedy
přesně tou logikou, kterou `stale` má a kterou tenhle spec zamítá o odstavec výš.

`OVERDUE_WINDOW_MS` se **nemění ani neparametrizuje** — od 12. 8. 2026 tímtéž
oknem hasne i červený alarm na kartě v plánu (`src/lib/overdueState.ts`), takže
jakýkoli zásah by rozsvítil alarm na desítkách zakázek v celém plánu.

## 4. Změny v kódu — sekce NEDODĚLÁNO

| Soubor | Změna |
| --- | --- |
| `src/lib/monitorView.ts` | `monitorQueue` → `{ overdue, today, tomorrow }`; nová konstanta `UNFINISHED_LOOKBACK_DAYS = 14` |
| `src/components/monitor/MonitorQueue.tsx` | prop `overdue`; `QueueSection` dostane volitelné `tone` a `showDate` |
| `src/components/monitor/MonitorView.tsx` | předat `overdue`; rozšířit fallback na `{ overdue: [], today: [], tomorrow: [] }` |

**Žádná změna API, DB ani migrace.** Ověřeno: `GET /api/blocks` i SSR v `app/page.tsx`
vracejí celou tabulku bez `where` a bez `take`; SSE reconnect ani poll data
neprořezávají. Klient má všechny bloky včetně let starých.

### 4.1 Povinné — early return v `MonitorQueue`

```ts
if (today.length === 0 && tomorrow.length === 0) return <>Na tomhle stroji není dnes ani zítra nic naplánováno.</>
```

Bez rozšíření o `overdue` by tahle hláška přebila celou novou sekci **přesně
v tom stavu, kdy je sekce nejpotřebnější** — stroj bez plánu na dnešek a nedodělek
pár dní zpátky. Podmínku i vrácený JSX rozšířit.

### 4.2 Povinné — prázdná velká karta nesmí lhát

Když `card == null` a `queue.overdue.length > 0`, hláška v levém sloupci se změní
z „Na tomhle stroji nic naplánováno." na **„Na dnešek nic naplánováno. Vpravo
čekají nedodělané zakázky."** Bez toho karta tvrdí, že není co dělat, zatímco
vpravo visí práce.

### 4.3 Doporučené — `useMemo`

`MonitorView` tiká à 15 s a nemá jediný `useMemo`; každý tik přepočítá
`pickHeroBlock` + `monitorQueue` a překreslí celou frontu včetně `buildMonitorChips`
per řádek. Nová sekce render zvětší. Zabalit `monitorQueue` do `useMemo` s deps
`[blocks, viewMachine, dayKey]`, kde `dayKey` je **civilní pražský den**, ne `now`
— jinak memo nikdy netrefí.

## 5. Změny v kódu — „Najít" ústí na Monitor

Dnešní `onSelect` volá `jumpToBlockFromMonitor` → slepá ulička (§1, brána 4).
Nové chování:

```
klik na výsledek, který je ZAKAZKA
  → zůstaň (nebo se vrať) na Monitoru
  → přepni viewMachine na stroj bloku
  → dej blok na velkou kartu
```

Rezervace a údržba jdou dál do plánu — tiskař je neodklepává a `resolveSelectedBlock`
je na kartu záměrně nepustí.

**Bez omezení na 14 dní.** Ruční výběr žádné okno nezná (`resolveSelectedBlock`
nemá časovou mez, `reasonForBlock` záměrně nezná 16h okno — je to zapsaný záměr
z 10. 8. 2026). Přes „Najít" jde odklepnout i zakázka půl roku stará.

### 5.1 Napojení — jednorázová prop, ne zvednutý stav

`selectedId` zůstává uvnitř `MonitorView`; **nezvedá se** do `PlannerPage`. Visí
na něm čtyři efekty a dvě tlačítka a Monitor má zdokumentovanou historii regresí
právě v tomhle stavovém uzlu (sticky vs. optimistický zápis, 10. 8. 2026).
Místo toho prop `focusBlockId: number | null` + `onFocusHandled: () => void`,
kterou `MonitorView` v efektu spotřebuje.

### 5.2 Dvě povinné podmínky napojení

1. **Nový efekt musí být deklarovaný AŽ ZA** efektem, který na změnu `viewMachine`
   maže `selectedId`. React spouští efekty v pořadí deklarace a ten úklidový efekt
   běží **i při mountu** — dřívější deklarace by výběr smazala.
2. **`setViewMachine` a `setFocusBlockId` musí padnout v témže handleru**, aby je
   React zbatchoval. Pořadí deklarace samo nestačí: druhý úklidový efekt
   (`if (selectedId != null && !selected) setSelectedId(null)`) smaže výběr bloku,
   který `resolveSelectedBlock` odmítl pro neshodu stroje.

### 5.3 Vedlejší úklid

Komentář nad `jumpToBlockFromMonitor` tvrdí, že je sdílená s `MonitorQueue` —
**to je nepravda**, `MonitorQueue.onSelect` volá `setSelectedId`. Komentář opravit.
`nearestOutOfRange` v `PlannerPage` je mrtvá proměnná; smazat.

## 6. Vizuál

**Nadpis sekce „NEDODĚLÁNO"** v `var(--warning)` místo `var(--text-muted)` —
jediný barevný rozdíl proti Dnes/Zítra. Zůstává to táž fronta, jen jiná kategorie.

**Řádek fronty** místo samotného `22:00` ukáže `pá 9. 8. 22:00` přes existující
`formatPragueDateTimeWithWeekday` (`src/lib/dateUtils.ts`). Den v týdnu tam patří —
tiskař myslí ve směnách, ne v datech. Formátovač je v repu, nový se nepíše.

**Velká karta musí dostat datum.** `HeroTiming` dnes pro `reason === "overdue"`
kreslí jen `22:00 ▬▬ 06:00` a „Přetahuje o 84 h 0 min" — **nikde není, ze kterého
dne zakázka je**. Tiskař, který si vytáhne starou zakázku, tak nemá jak poznat,
že nekliká na dnešní. Datum doplnit u `reason === "overdue"` tehdy, když
`startDayLabel(block.startTime, now)` vrátí **ne-`null`** hodnotu — tedy u všeho
kromě zakázky, která začala dnes.

Zbytek řádku beze změny: číslo, popis, amber pás specifikace, `MonitorChips`.
Ztlumení odklepnutých se v sekci z definice nikdy neuplatní.

Vše přes tokeny z `globals.css`, žádný hex literál — jinak se rozbije light mode.

## 7. Interakce — nula nového kódu

Klik na řádek už dnes volá `onSelect` → `setSelectedId` → `resolveSelectedBlock`
ji vytáhne na velkou kartu, `reasonForBlock` označí „PŘETAHUJE", tiskař dá HOTOVO.
Dvoukrokové potvrzení je vázané jen na `reason === "upcoming"`, takže přetahující
zakázka jde odklepnout jedním klikem — správně. Po odklepnutí ze sekce zmizí.

Server nic neblokuje: `POST /api/blocks/[id]/complete` kontroluje **jen** roli
(`ADMIN`/`PLANOVAT`/`TISKAR`), platnost `blockId`, `typeof completed === "boolean"`,
existenci bloku, `type === "ZAKAZKA"` a u tiskaře shodu `machine` se
`session.assignedMachine`. Žádné datumové okno, žádná kontrola zámku ani
`scheduleBypassed`.

## 8. Testy

Do `src/lib/monitorView.test.ts` (nové testy, **stávající se nepřepisují** —
testy „zakázka po 16hodinovém okně už na kartě není" a „včerejší neodklepnutá
zakázka se jako overdue nebere" pinují hero automatiku, která se nemění):

- nedodělaná před 4 dny **je** v sekci
- nedodělaná před 15 dny **není**
- odklepnutá z minula **není**
- **běžící noční směna z včerejška (22:00 → dnes 6:00) NENÍ v sekci** — regrese `endTime` vs `startTime`
- POZASTAVENO z minula **není**
- rezervace a údržba **nejsou**
- cizí stroj **není**
- řazení vzestupně podle `startTime`
- celý scénář z připomínky: pá 22:00 nedodělaná + dnes je středa po svátcích → je v `overdue`, karta ukazuje středeční zakázku jako `upcoming`

K napojení „Najít":

- klik na výsledek z jiného stroje přepne stroj a blok se objeví na kartě
- odklepnutá zakázka z minula jde přes „Najít" vytáhnout a Vrátit
- rezervace jde dál do plánu

Fixtury ověřit mutací (poučení P11) — test, který projde i po rozbití vstupu, nic nehlídá.

## 9. Známá omezení

**`printCompletedAt` je čas KLIKNUTÍ, ne čas tisku.** `complete` route píše
bezpodmínečně `new Date()`. Zakázka z minulého týdne odklepnutá ve středu tak
dostane razítko středy. Konzumenti, kteří to nečekají:

- `computeThroughput` (`reportMetrics.ts`) počítá kusy podle `printCompletedAt`
  v období → průtok se vykáže ve špatném týdnu,
- `computeAvgLeadTimeDays` počítá `printCompletedAt − createdAt` → průběžná doba
  se nafoukne,
- `getSplitChipState` ukáže „hotovo 9:42" u zakázky, jejíž partner tiskl minulý pátek.

Featura tohle zkreslení **zvětší**, protože dodatečná odklepnutí zpřístupňuje.
**Rozhodnutí Vojty 12. 8. 2026: brát jako známé omezení, do reportů se nesahá.**
Případná oprava (měřit průtok podle `endTime` bloku) je vlastní etapa.

**Odklepnutí není neutrální akce.** Vytištěný blok se stává zdí pro chain push,
nejde přepočítat (`reflow` kód `PRINTED`), nejde rozdělit, mizí z detekce driftu
a jeho smazání vyžaduje `force`. U zakázky ležící v minulosti je to neškodné.
Ale kdyby plánovač nestihnutou zakázku mezitím přesunul do budoucna a tiskař ji
pak přes „Najít" odklepl, zamkl by jí budoucí pozici v plánu.

**Osiřelá půlka rozdělené zakázky.** `printCompletedAt` je per-blok (není
v `SPLIT_SHARED_FIELDS`), což je pro featuru dobře. Ale nedodělaná půlka na druhém
stroji se v sekci na „mém" Monitoru neobjeví a odklepnout ji nejde — server to
zakazuje shodou `machine` se `session.assignedMachine`. Sekce je striktně per-stroj;
partner zůstává vidět přes existující chip na velké kartě.

**Sekci nic neuklidí.** Zakázka z ní zmizí jen odklepnutím, smazáním bloku, nebo
vypadnutím ze 14denního okna. `Block` řádky se v projektu nikdy nemažou ani
nearchivují (jediný retenční skript `prune-revisions.ts` maže výhradně
`BlockRevision`) — 14denní strop je proto jediná pojistka proti nekonečnému seznamu.

**Zakázky starší než 14 dní** jsou dosažitelné pouze přes „Najít" (§5). To je
záměr, ne opomenutí.

**`scheduleBypassed` Monitor nezná vůbec.** Odložená zakázka v minulosti se
v sekci objeví bez odlišení. Řešit se to nemusí (příznak je spočítaná pravda
serveru, ne stav, který by tiskaře zajímal), ale je to vědomá mezera.

## 10. Závislosti a rizika

**Kolize s paralelní session.** K 12. 8. 2026 má pracovní strom rozpracované
`monitorView.ts`, `PlannerPage.tsx`, `OrderSearchSheet.tsx` a nové netrackované
`overdueState.ts`, `orderSearch.ts`, `dtpOverview.ts`. **Implementace začne až po
commitu té práce** (rozhodnutí Vojty). Před prvním editem znovu načíst skutečný
stav souborů — čísla řádků v tomhle specu jsou orientační, závazné jsou názvy symbolů.

**Kolizní kurz s auditem PERF-001**, který doporučuje omezit `GET /api/blocks` na
`endTime > now − 30 d`. To by 14denní sekci nechalo funkční, ale **zabilo by
„Najít" pro starší zakázky** (§5). Kdo bude PERF-001 realizovat, musí tenhle spec
znát.

**Vedlejší efekt na health-check.** `healthChecks.server.ts` jede přes celou
historii bez `where` a kontroly `badPrintMinutes`/`unalignedStart` mají v podmínce
`printCompletedAt == null`. Až tiskaři staré zakázky doodklepou, panel „Integrita"
se částečně sám spraví. Není to problém, jen se tím nemá nikdo nechat zmást.

**Plánovač po téhle featuře pořád nebude mít souhrnný pohled** na nedodělané
zakázky. Bylo to vědomé rozhodnutí (§2). Přirozený doplněk by byl chip vedle
driftového počítadla nad strojem („N čeká na odklepnutí") — kdyby se dělal, musí
brát definici z §3, jinak se počítadlo rozejde se sekcí.

## 11. Co se záměrně nedělá

- **Nic se nepřeplánovává.** Blok zůstává v pátek.
- **Žádná notifikace** plánovači ani nikomu jinému.
- **Velká karta a `pickHeroBlock` beze změny**, 16h okno zůstává — brání tomu, aby
  zapomenutá zakázka blokovala kartu každé ráno.
- **`effectiveDaysBack` pro tiskaře se nemění** — tiskař nemá vidět víc plánu.
  Řeší se to tím, že „Najít" ústí na Monitor (§5), ne rozšířením rozsahu timeline.
- **Do reportů se nesahá** (§9).
