# Spec: Tiskové hodiny — bloky přes odstávku, limit 40 h, oprava teleportu z fronty

Datum: 2. 7. 2026
Stav: návrh schválený Vojtou (brainstorming + 4× multi-agent dopadová analýza), čeká na implementační plán
Větev: Vojta

---

## 1. Problém (feedback plánovače)

1. **Max délka tisku 24 h je málo** — existují zakázky přes 100 h (plánují se jako víc paketů, jeden paket ≤ 40 h).
2. **Bug „teleport z fronty":** R4735 Gardena Paket B (27 h, zadáno 24 h kvůli limitu) puštěná z fronty se zařadila **o 2 týdny později**, než kam byla puštěna, na místo s existujícími i zamčenými bloky, a skončila **po deadline expedice**.

### Root cause (ověřeno v kódu)

Celý model dnes předpokládá, že se blok ZAKAZKA **celý vejde do souvislé pracovní doby**:

- `snapToNextValidStartWithTemplates` (`src/lib/workingTime.ts:52`) hledá start, od kterého se celá délka vejde do souvislého pracovního okna. U bloku delšího než nejdelší souvislé okno (24 h přes víkendovou odstávku) skáče dopředu až 20 iterací → „teleport" o týdny. Po 20 iteracích navíc **tiše vrátí nevalidní start** (latentní bug).
- Snap ignoruje obsazenost stroje i deadline expedice. Server pak s `resolveChain:true` odsune navazující bloky; zamčené přeskočí a přeskládá okolí (`src/lib/overlapResolver.ts`).
- „Zámek pracovní doby" na klientu nechrání před kolizí s bloky — paradoxně právě on spustil teleport.

Oba problémy jsou jeden: limit 24 h je jen symptom modelu „blok = souvislé okno".

---

## 2. Nový model: tiskové hodiny

**Délka bloku ZAKAZKA = tiskové hodiny** (kolik hodin stroj fyzicky tiskne). Blok smí přesahovat nepracovní dobu (neaktivní směny z `MachineWeekShifts` + odstávky `CompanyDay`) a „pauznout se" — kalendářní rozsah (`endTime − startTime`) ≥ tiskové hodiny.

### Schválená rozhodnutí (Vojta)

| Téma | Rozhodnutí |
| --- | --- |
| Vzhled | **„Viditelná pauza"** — segmenty (tiskne → pauza → dotiskne) spojené jako 1 zakázka; pauza propouští šrafování odstávky |
| Hranice segmentů | **Automatická** (= okraj odstávky, dané kalendářem). Žádná ručně tažená hranice. Poměr před/po řídí posun celého bloku; resize mění celkové tiskové hodiny |
| Kolize při dropu | Nezamčené navazující → chain push (jako dnes). **Zamčený blok → drop se odmítne s hláškou**, žádné tiché přeskládání |
| Minimální segment pauzy (doplněno 2. 7. po testu etapy 3) | **Automatika (chain push, auto-shift) smí blok rozdělit pauzou jen když každý tiskový kus ≥ 1 h** (`MIN_PRINT_SEGMENT_MINUTES = 60`; bloky < 2 h se nedělí nikdy — posunou se celé za odstávku). Nouzová pojistka: když žádná pozice v horizontu minimum nesplní, pauza se povolí i s menším kusem. **Ruční drop pravidlu nepodléhá** — explicitní umístění plánovačem se respektuje |
| Zadání délky | Rozšířený dropdown `DURATION_OPTIONS`, **max 40 h** (80 položek × 30 min). Serverová validace `0 < printMinutes ≤ 2400` |
| Zakázky > 40 h | Plánují se jako víc paketů — mimo scope |
| Deadline | Když vypočítaný konec spadne za `deadlineExpedice` → vizuální varování na bloku |
| Údržba v pauze zakázky | **Zakázáno (v1)** — pauza bloku = obsazený stroj. Údržba je flexibilní, naplánuje se jinam. Výjimka případně později jako cílený app-level check |
| Vypnutý zámek pracovní doby | **Bez pauz** — `end = start + printMinutes` souvisle (mimořádná směna). Persistuje se `scheduleBypassed`, aby pozdější přepočty blok „neopravily" vložením pauz |
| Změna kalendáře po naplánování | **Detekce + štítek + notifikace + ruční „Přepočítat"**. Žádné automatické přeskládání |

---

## 3. Architektura

### 3.1 Datový model (migrace)

```prisma
model Block {
  // ... stávající pole
  printMinutes     Int?     // tiskové minuty; NULL pro ne-ZAKAZKA
  scheduleBypassed Boolean  @default(false) // blok položen vědomě mimo kalendář
}
```

- **Backfill:** `UPDATE Block SET printMinutes = TIMESTAMPDIFF(MINUTE, startTime, endTime) WHERE type='ZAKAZKA'` — bezeztrátové (dnešní invariant: end−start = tiskový čas; platí i pro bypass bloky ve smyslu záměru plánovače).
- Bez FK → UNSIGNED gotcha (errno 150) se netýká.
- Limit 40 h se **nevynucuje retroaktivně** — jen na nové zápisy.
- Změna typu ZAKAZKA↔UDRZBA musí `printMinutes` nastavit/vyčistit.
- REZERVACE a UDRZBA: `printMinutes = NULL`, délka zůstává end−start, nepauzují se (dnes nejsou validované vůbec — beze změny).

### 3.2 Jádro: `expandPrintTime` — jediný zdroj pravdy

Nová pure funkce v `src/lib` (sdílená klient + server, testovatelná bez DB):

```
expandPrintTime(machine, start, printMinutes, weekShifts, companyDays, bypass)
  → { end, segments: {start, end, kind: 'print'|'pause'}[] }
```

- Jednotný predikát nepracovního času: `isMachineRunnableAt(t) = směna aktivní && žádná CompanyDay` — **sjednocuje weekShifts a companyDays** (dnes snap companyDays ignoruje a validace je řeší zvlášť tvrdě).
- `bypass = true` → žádné pauzy, `end = start + printMinutes`.
- 30min UTC kroky + `pragueOf` (DST-safe; printMinutes = reálné minuty běhu, ne civilní hodiny). Fall-back noc má 9 h kapacity, spring-forward 7 h — správně, otestovat explicitně.
- **Tvrdý strop horizontu** (max span 21 dní / max iterací) → explicitní chyba „v horizontu není dost pracovní doby". Nikdy `while(true)` (oprava existujícího bugu `workingTime.ts:45`).
- Inverze pro resize: `computePrintMinutes(machine, start, end, ...)`; end uvnitř pauzy se normalizuje na konec posledního tiskového segmentu (jinak je inverze nejednoznačná).

**Invarianty:**
- první i poslední minuta bloku je vždy pracovní (start i end leží v tiskovém segmentu),
- `endTime = expandPrintTime(...).end` — endTime je materializovaná cache vynucovaná serverem při každém zápisu,
- u splitu: součet printMinutes dětí == rodič.

### 3.3 API kontrakt: konec počítá výhradně server

POST/PUT `/api/blocks`, `/api/blocks/batch` přijímají `startTime` + `printMinutes` (příp. endTime jen pro konzistenční validaci); `endTime` počítá server přes `expandPrintTime`. Důvody: rekurentní děti dopadají každý týden na jiný kalendář; klient/server drift; batch lasso přesuny. `serializeBlock` přibalí `printMinutes` + `scheduleBypassed` (SSE payloady je tím dostanou automaticky).

### 3.4 Validace (přepis `validateBlockScheduleFromDb`)

Nová definice SCHEDULE_VIOLATION pro ZAKAZKA (bez bypass):
1. start leží na aktivním slotu,
2. end je konec posledního tiskového slotu,
3. `end == expandPrintTime(start, printMinutes).end` (zároveň detekuje stale end po změně kalendáře).

Opravy: načítat weekShifts pro **všechny** týdny spanu (dnes jen 2 — vzor v `scheduleSlotFinder.ts:82`); companyDay smí protínat jen pauzové segmenty (dnes vždy tvrdé odmítnutí). Testy `scheduleValidationServer.test.ts` se přepíšou (fixují starou sémantiku).

### 3.5 Snap: start-only

`snapToNextValidStartWithTemplates(machine, start, durationMs, ...)` → nahradit `snapStartToNextActiveSlot(machine, start, ...)` (bez durationMs). Tím mizí teleport: blok se položí na nejbližší aktivní slot a rozloží se dopředu. `snapGroupDeltaWithTemplates` se redukuje na snap startů; end per blok počítá expanze.

### 3.6 Chain push (re-expanze)

`computeChainPush`: `BlockInterval` ponese `printMinutes` + `scheduleBypassed`; odsunutý blok se umísťuje přes `expandPrintTime` na každé kandidátní pozici (ne `ns + dur`), kurzor `pEnd` roste podle re-expandovaného endu. Posuny jsou monotónně dopředné → konverguje. `resolveChainPushFromDb`: post-check nahradit verifikací `end == expandPrintTime(...)`; okno dimenzovat z re-expandovaných endů; weekShifts načítat vždy. Kolize se zamčeným blokem, kterou nelze vyřešit → transakce se odmítne s hláškou „koliduje se zamčeným blokem X — vyber jiné místo". Kandidátní pozice, jejíž expanze poruší minimální segment (viz rozhodnutí výše), se přeskočí na konec první pauzy; bez vyhovující pozice fallback bez pravidla (pauza z nouze). Důsledek: za blokem posunutým celým za odstávku může v plánu zůstat mezera — chain push zachovává pořadí, nezaplňuje díry.

### 3.7 Overlap

`checkBlockOverlap` + `assertNoOverlapForBlocks` (FOR UPDATE) **beze změny** — jednotka exkluzivity je celý kalendářní rozsah včetně pauz. Údržba v pauze = konflikt (schválené v1 pravidlo). Gap-lock ochrana proti souběhu dvou plánovačů zůstává.

### 3.8 Auto-shift / `findNextFreeSlot`

Snap start-only + expanze; kolizní test na expandovaném spanu. `MAX_AUTO_SHIFT_MS` (7 dní) vztahovat na **posun startu**, ne endu (40h blok na jednosměnném stroji má span > 7 dní — nesmí to být falešný MAX_SHIFT_EXCEEDED). Fetch okno dimenzovat na worst-case span (ne `+durationMs`). Kandidát porušující minimální segment se přeskočí na konec první pauzy (stejné pravidlo + fallback jako u chain pushe); limit 7 dní se i pak měří na posun startu.

### 3.9 Změna kalendáře po naplánování

Po PUT `/api/machine-week-shifts` a mutacích `/api/company-days` (POST/PUT/DELETE — dnes bez jakékoli kontroly!):
- revalidace dotčeného okna: bloky s `end != expandPrintTime(...)` dostanou flag „konec nesedí na kalendář" (vizuální štítek) + notifikace pro PLANOVAT/ADMIN,
- tlačítko „Přepočítat" (per blok / per stroj) spustí re-expanzi + chain push v transakci,
- **žádný automatický přesun**.
- Oprava existujícího bugu: `findConflictingBlocks` filtruje `startTime` jen v editovaném týdnu → bloky přesahující z minulého týdne unikají. Rozšířit na překryv spanu s týdnem.
- Auto-seed týdne (`ensureWeekSeeded`) → revalidace i po něm.
- Audit: přepočty logovat jako samostatnou akci (`AUTO_REFLOW`), aby neznečistily `computePlanStability` (metrika stability plánu je nesmí počítat jako přeplánování).

### 3.10 Reporty

- `computeBlockHours` + dashboard outlook: pro ZAKAZKA sčítat `printMinutes` (jinak vytížení > 100 %).
- Denní report + `dailyUtilization`/`dailyCapacity`: průnik **tiskových segmentů** se dnem/směnou (opraví i dnešní dvojité započtení bloku přes půlnoc; pauznutý blok se nesmí objevit ve směně, kdy stojí).
- `blockOverlapsShift` v denním reportu → testovat proti segmentům.

### 3.11 UI (klient)

- **Vykreslení:** jeden div přes celý span + průhledné „pauza" overlay pruhy uvnitř (šrafování odstávky prosvítá). Zachová hit-testing, selection, context menu, drag, resize handle. Layout mode (FULL/COMPACT/TINY) podle výšky **prvního segmentu**. Util `getBlockSegments(block, weekShifts, companyDays)` memoizovaný.
- **Pauza vs. ruční split:** vizuálně výrazně odlišit (pauza = šrafovaný „můstek" uvnitř bloku; split = samostatné bloky s chipy 1/2).
- **Drag:** preview se živě natahuje/smršťuje podle expanze na aktuální pozici (jinak lže). Drop → PUT se startem, end počítá server.
- **Resize:** spodní handle táhne kalendářní konec; tooltip ukazuje „6 h tisku (9 h celkem)"; end puštěný v pauze se snapne na hranu segmentu; minimum = 30 min tiskového času.
- **8 mutačních cest s `end = start + délka` k přepsání:** drag (`TimelineGrid:2389`), resize (`:2407`), multi-move (`:2436`), paste (`PlannerPage:2385`), group paste (`:2473`), queue drop (`:2315`), série (`:2050`), BlockEdit save (`BlockEdit:585` + série-resolver `:350`).
- **BlockEdit:** délka = `printMinutes` (dnes end−start → select by se rozbil na hodnotě mimo options). **BlockDetail/DtpPanel/tooltip:** „Tisk: X h · Celkem: Y h (vč. pauzy)".
- **Queue drag preview + paste marker:** stejná start-only snap logika jako drop, jinak marker ≠ realita.
- **Split:** dělit podle `printMinutes/2` (mid = polovina odpracovaných minut), ne kalendářního midpointu; splitAt v pauze zakázat.
- **Deadline varování:** štítek na bloku, když `end > deadlineExpedice`.
- **Série:** každý výskyt = stejné `printMinutes`, vlastní expanze per výskyt (server). Výskyt bez místa → posun + notifikace (žádný tichý skip; dnes se dítě tiše nevytvoří — opravit).

### 3.12 Provoz / deploy

- Deploy fingerprint `sum_secs` = Σ(end−start) se backfillem **nemění** (backfill nemění časy), ale budoucí „Přepočítat" akce ho změní legitimně → zdokumentovat v DEPLOY_WORKFLOW.md, aby POST kontrola nevyvolala falešný poplach.
- `scripts/fix-existing-overlaps.ts` označit jako pre-change only (zachovává kalendářní délku).
- Povinný PRE mysqldump před migrací (viz feedback_prod_backup_first).

---

## 4. Existující bugy opravované v rámci práce

1. `workingTime.ts:45` — `while(true)` bez stropu (týden se všemi směnami OFF zamrzne request).
2. Snap tiše vrací nevalidní start po 20 iteracích (mechanismus Gardeny; 40h dropdown by ho zesílil).
3. Validace načítá jen 2 týdny spanu.
4. `findConflictingBlocks` nevidí bloky přesahující z minulého týdne.
5. Dashboard `dailyUtilization` počítá blok přes půlnoc do obou dnů celý.
6. Rekurentní dítě, které se nevytvoří, tiše zmizí bez toastu.
7. CompanyDay mutace bez kontroly proti existujícím blokům a bez SSE.

## 5. Hlavní rizika (z adversarial analýzy)

- **Chain push přes odstávku** — kaskádový přepočet endů; bez re-expanze model tiše koroduje data. Mitigace: re-expanze per pozice + integrační testy kaskády přes víkend + finální FOR UPDATE pojistka zůstává.
- **Změna kalendáře** — bez detekce endy tiše přestanou sedět. Mitigace: revalidace + flag + notifikace (3.9).
- **Bypass blok při pozdějším editu** — bez `scheduleBypassed` by se „samoopravil" vložením pauz → kaskáda. Mitigace: persistovaný flag + štítek „mimo kalendář" v UI.
- **Hraniční konvence** — všude half-open `[start, end)`; unit testy přesně na hranách (end == začátek odstávky apod.).
- **Souběh plánovač × změna kalendáře** — expanze nad stale kalendářem; chytí revalidace (pragmatické v1).

## 6. Etapy implementace (každá končí checkpointem, čeká na OK)

1. **Migrace + backfill** — `printMinutes`, `scheduleBypassed`; PRE záloha; ověření otisku.
2. **Jádro** — `expandPrintTime` + `computePrintMinutes` + `isMachineRunnableAt` + testy (víkend, odstávka, DST ×2, hranice, strop horizontu, bypass).
3. **Server** — validace (3.4), POST/PUT/batch (3.3), snap start-only (3.5), chain push (3.6), auto-shift (3.8), limit 40 h. Přepis dotčených testů.
4. **Klient — mutační cesty** — 8 cest z 3.11, queue drop, BlockEdit, dropdown 40 h.
5. **Klient — vykreslení** — segmenty, pauza overlay, drag/resize preview, tooltipy, deadline štítek, odlišení od splitu.
6. **Kalendářní revalidace** — 3.9 (flag, notifikace, Přepočítat, opravy findConflictingBlocks + companyDays).
7. **Reporty** — 3.10 + přepis testů reportMetrics.
8. **Finální review** — multi-agent code review (preferovaný workflow), plný test run, build, manuální scénář Gardena 27 h.

Pozn.: pořadí je závazné v jednom bodě — **dropdown 40 h nesmí jít ven před jádrem a snapem** (jinak se latentní snap-bug stane každodenním).

## 7. Mimo scope

- Údržba v pauze zakázky (výjimka v overlap checku) — případná v2.
- Ručně tažená hranice segmentů — zamítnuto (hranice = kalendář).
- Zakázky > 40 h jako jeden blok — řeší se pakety.
- Automatický re-flow při změně kalendáře — zamítnuto ve prospěch ručního přepočtu.
