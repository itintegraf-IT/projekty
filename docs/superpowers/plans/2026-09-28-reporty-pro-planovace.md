# Reporty pro plánovače a poctivé vytížení — implementační plán (etapa 2, září 2026)

> **Pro agentní pracovníky:** POVINNÁ SUB-SKILL: použij superpowers:subagent-driven-development (doporučeno) nebo superpowers:executing-plans a implementuj plán úkol po úkolu. Kroky používají checkbox (`- [ ]`) syntaxi pro sledování.

**Cíl:** Zpřístupnit modul `/reporty` roli PLANOVAT a opravit čitatel vytížení tak, aby se rigidní blok (údržba, legacy rezervace, odložená nebo rozejitá zakázka) počítal jen tou částí, která leží uvnitř skutečně obsazených směn.

**Architektura:** Jediný zdroj „kde ty hodiny leží" — nová exportovaná funkce `staffedIntervals` v `src/lib/reportMetrics.ts`. `computeAvailableHours` (jmenovatel) z ní dělá součet, nová `staffedOverlapMinutes` (čitatel rigidního bloku) na ní počítá průnik, a `occupiedMinutes` je jediné místo, které rozhoduje mezi tiskovými segmenty a ořezem na směny. Tři konzumenti (`handleRetro`, `handleOutlook`, `api/report/attention`) se přepojí na `occupiedMinutes` a strážný test nad zdrojovým textem hlídá, že se žádný z nich nevrátí k hrubému spanu. Přístup se rozšiřuje na šesti serverových místech plus odkaz v hlavičce, také s strážným testem.

**Tech Stack:** Next.js 16 (App Router) · TypeScript · Prisma 5 · MySQL/MariaDB · testy `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-09-16-reporty-pro-planovace-design.md`

## Global Constraints

- Role se všude zapisují výčtem `["ADMIN", "PLANOVAT"]` — týmž zápisem, jakým je dnes povolená Správa (`/admin`) a Rezervace. Sdílená konstanta rolí se NEZAVÁDÍ, etapa následuje dnešní zvyk (spec odd. 1.1).
- **Všech šest serverových míst se mění společně.** Middleware nejmenuje `/api/report/attention` ani `/api/report/health`, ty stojí čistě na `requireRole` uvnitř routy — částečná změna znamená, že plánovači funguje jen část stránky (spec „Stav dnes / Přístup").
- `printOverlapMinutes` (`src/lib/printTimeClient.ts`) se **NEMĚNÍ**, ani jeho testy. Je to obecný nástroj „hrubý průnik bloku s oknem" a jinde je správně (spec odd. 2.4).
- `computeAvailableHours` **nemění chování** — jeho dnešních 17 `it()` testů v `src/lib/reportMetrics.test.ts` musí projít BEZ jediné úpravy.
- Poměrové funkce se **nezastropují na 100 %**. Skutečné přeplánování uvnitř směn musí být dál vidět (`docs/POUCENI.md`, P22).
- `plannerActivity` v odpovědi `/api/report/dashboard?mode=retro` se **NEDOTÝKÁ** — Vojta 16. 9. 2026 rozhodl nechat ho, jak je (spec odd. 1.2).
- Komentář, který po změně přestane být pravdivý, je v tomhle projektu **vada** (`docs/POUCENI.md`, P19). Každý komentář tvrdící „ADMIN-only" nebo „jen ZAKAZKA má segmenty" se přepisuje ve stejném commitu.
- Barvy a rozměry v `/reporty` výhradně přes tokeny (`src/lib/reportTokens.ts`, `globals.css`), nikdy hex literál (CLAUDE.md, sekce Design tokens).
- Nové metriky, nové grafy ani finanční data etapa nepřidává (spec „Co tahle etapa neřeší").
- Celá suite se spouští příkazem z CLAUDE.md:
  ```bash
  node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
  Jeden soubor: `node --test --import tsx src/lib/reportMetrics.test.ts`
- `npm run build` musí projít lokálně před pushem (chytí TS chyby dřív než server).

## Review Focus

Pět vstupů, které spec předpokládá, ale sám nevyjmenovává — každý má test v úkolu, který vlastní jeho kód:

1. **Blok, který se směny jen DOTÝKÁ** (končí přesně v 06:00, směna začíná v 06:00) → 0 minut, ne jedna. Intervaly jsou pololetevřené `[start, end)`; kdo to zapomene, nafoukne každou noční údržbu o minutu. → Task 2, test „dotyk hranice směny není překryv".
2. **Součet po dnech se musí rovnat součtu za období.** Karta nese celé období, heatmapa pod ní den po dni — a jejich rozpor byl v tomhle projektu už jednou opravovaný (komentář v `handleRetro` o 26 h z 399 h). → Task 2, test „součet po dnech se rovná součtu za celé období"; Task 3 a 4 to navíc zajišťují konstrukcí (`intersectIntervals` nad jedním celoobdobovým polem) a Task 4 to hlídá strážným testem.
3. **Stroj bez naseedovaných řádků `MachineWeekShifts`** (`staffed` je prázdné pole) → rigidní blok přispěje nulou, ne celým spanem, a vytížení zůstane `null`. Řádky se seedují líně, takže neotevřený týden je běžný stav, ne exotika (spec, riziko 2). → Task 2, test „stroj bez naseedovaných směn → 0, ne celý span".
4. **Den přechodu na zimní čas** (25hodinový den). `pragueMinuteToUtcMs` a intervalová algebra ho zvládají, ale nikdo to na čitateli neověřil. → Task 2, test „den přechodu na zimní čas".
5. **Rezervace s tiskovými minutami, jejíž expanze SELŽE** (`blockReportSegments` vrátí `null` kvůli driftu konce nebo chybějícím týdnům) → musí spadnout na ořez směnami, ne na hrubý span. Přepnutí na `usesTiskoveHodiny` samo nestačí, protože `segMap` může být `null` i u bloku, který tiskové hodiny používá. → Task 3, test „rezervace s tiskovými minutami, jejíž expanze selže".

---

## Struktura souborů

| Soubor | Odpovědnost | Úkol |
| --- | --- | --- |
| `src/lib/reportMetrics.ts` | +`staffedIntervals` (export), +`staffedOverlapMinutes`, +`occupiedMinutes`; `computeAvailableHours` přepsán na součet intervalů; privátní `staffedIntervals` přejmenován na `staffedBreakdown` a přesunut nad `computeAvailableHours` | 1, 2 |
| `src/lib/reportMetrics.test.ts` | testy nových funkcí; existující testy BEZE ZMĚNY | 1, 2 |
| `src/app/api/report/dashboard/route.ts` | `handleOutlook` a `handleRetro` na `occupiedMinutes`; `segMap` Výhledu na `usesTiskoveHodiny`; `ALLOWED_ROLES` | 3, 4, 5 |
| `src/app/api/report/attention/route.ts` | stavový pás: `occupiedMinutes` + `usesTiskoveHodiny`; `requireRole` | 3, 5 |
| `src/lib/reportNumeratorWiring.test.ts` | NOVÝ strážný test: tři agregace nesmí sáhnout na hrubý span | 4 |
| `src/app/api/report/health/route.ts` | `requireRole` | 5 |
| `src/middleware.ts` | bloky `/reporty` a `/api/report/dashboard` | 5 |
| `src/app/reporty/page.tsx` | druhá vrstva gate | 5 |
| `src/app/_components/PlannerPage.tsx` | odkaz „Reporty" v hlavičce | 5 |
| `src/lib/reportAccessWiring.test.ts` | NOVÝ strážný test: šest serverových míst + odkaz | 5 |
| `CLAUDE.md` | sloupec Reporty v tabulce „Role a přístup" | 5 |
| `src/app/reporty/_components/KpiCard.tsx` | nová volitelná prop `note` (třetí řádek karty) | 6 |
| `src/app/reporty/_components/RetroView.tsx` | „Vytížení výrobou" + popisek | 6 |
| `src/app/reporty/_components/OutlookView.tsx` | „Obsazenost směn" + popisek + nadpis sekce | 6 |
| `src/app/reporty/_components/CalendarUseSection.tsx` | pravdivý komentář o názvech karet | 6 |
| `docs/vyvoj-historie.md` | datovaný záznam etapy | 6 |

## Rozhodnutí, která spec nechal otevřené (rozhodnuto při psaní plánu)

1. **Jméno `staffedIntervals` je už obsazené.** V `reportMetrics.ts` existuje **privátní** funkce téhož jména s jinou signaturou (bere `shutdowns` a `window` jako intervaly a vrací `{ staffed, rawShifts, noRoster }`) — používá ji `computeCalendarCascade`. Spec o ní věděla („podruhé, pro jiný účel, uvnitř `computeCalendarCascade`"), ale nepojmenovala kolizi. **Řešení:** privátní funkce se přejmenuje na `staffedBreakdown` (vrací rozpad, ne jen intervaly) a nová exportovaná `staffedIntervals` se signaturou ze specu ji obalí. Tím vede k intervalům jediná cesta.
2. **`occupiedMinutes` jako čtvrtá funkce.** Spec popisuje pravidlo „segmenty → přes ně, jinak ořez na směny" a chce ho na třech místech. Tři kopie čtyřřádkové podmínky jsou přesně ten tvar, který se rozejde (viz `docs/POUCENI.md` a komentáře o dvou cestách k témuž číslu). Pravidlo dostane jedno jméno v `reportMetrics.ts`; routy jen volají.
3. **„Popisek pod číslem" ze specu odd. 3 je TŘETÍ řádek karty, ne náhrada podtitulku.** Spec zároveň chce nový popisek a výslovně zachovává dnešní podtitulek („X h volných" u Výhledu je od R3 jediný nositel hodin volna). `KpiCard` proto dostane volitelnou prop `note`, která se kreslí pod podtitulek.
4. **Modelový příklad ze specu vyjde na kartě jako 13 %, ne 12,5 %.** Přesný poměr je 12,5 %, ale `computeUtilization` vrací celé procento (`Math.round`) a to se nemění (P22 mluví o nezastropování, ne o desetinách). Test pinuje obojí: `staffedOverlapMinutes` údržby = 0, volné hodiny = 7 z 8, karta = 13 %.
5. **Podtitulek heatmapy Výhledu „Heatmapa vytížení" → „Heatmapa obsazenosti".** Spec přejmenovává sekci i kartu; kdyby mřížka pod nimi dál říkala „vytížení", nesla by na jedné záložce jméno té druhé definice. Spec o tom mlčí, tohle je nejmenší krok, který zabraňuje rozporu.

---

### Task 1: `staffedIntervals` jako jediný zdroj obsazených směn

**Files:**
- Modify: `src/lib/reportMetrics.ts` (sekce 1 a 1b, dnes ř. 18–193)
- Test: `src/lib/reportMetrics.test.ts` (nový `describe` za blok `computeAvailableHours`, dnes ř. 74–274)

**Interfaces:**
- Consumes: `Interval`, `mergeIntervals`, `intersectIntervals`, `subtractIntervals`, `totalHours` z `./intervals`; `companyDayIntervalsFor` z `./printTimeClient`; `MachineWeekShiftsRow`, `weekStartStrFromDateStr` z `./machineWeekShifts` — všechno už soubor importuje.
- Produces:
  - `staffedIntervals(machine: string, rangeStart: string, rangeEnd: string, weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayRow[]): Interval[]` — seřazené, nepřekrývající se UTC intervaly obsazených směn, ořezané oknem `[rangeStart, rangeEnd]` (inclusive) a po odečtení odstávek.
  - `computeAvailableHours(...)` — nezměněná signatura i chování, nově jen `totalHours(staffedIntervals(...))`.

- [ ] **Krok 1: Napiš padající test**

Vlož do `src/lib/reportMetrics.test.ts` **za** uzavírací `});` bloku `describe("computeAvailableHours", …)` (dnes ř. 274) tenhle nový blok. Helpery `makeRow`, `make16hShifts` a `WEEK_START` už v souboru existují (ř. 27–68), nové se nezavádějí:

```ts
// ---------------------------------------------------------------------------
// staffedIntervals — jediný zdroj „kde ty hodiny leží"
// ---------------------------------------------------------------------------
describe("staffedIntervals", () => {
  it("součet intervalů je TOTOŽNÝ s computeAvailableHours", () => {
    const shifts = make16hShifts();
    const iv = staffedIntervals("XL_105", "2026-04-13", "2026-04-17", shifts, []);
    assert.equal(totalHours(iv), computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", shifts, []));
    assert.equal(totalHours(iv), 80);
  });

  it("vrací seřazené a nepřekrývající se intervaly i u překrývajících směn", () => {
    // Noční 22:00–08:00 (override konce na 480 min) vedle výchozí ranní 06:00–14:00:
    // `PUT /api/machine-week-shifts` validuje každou směnu izolovaně, takže tenhle
    // rozvrh v DB skutečně vznikne. Naivní součet směn dá 28 h, sloučený 26 h.
    const rows = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      ...makeRow("XL_105", dow, { morningOn: true, nightOn: true }),
      nightEndMin: 480,
    }));
    const iv = staffedIntervals("XL_105", "2026-04-13", "2026-04-14", rows, []);
    for (let i = 1; i < iv.length; i++) {
      assert.ok(iv[i].start >= iv[i - 1].end, "intervaly se nesmí překrývat ani jít zpět");
    }
    assert.equal(totalHours(iv), 26);
    assert.equal(totalHours(iv), computeAvailableHours("XL_105", "2026-04-13", "2026-04-14", rows, []));
  });

  it("odstávka uvnitř směny interval rozdělí, ne zkrátí zprava", () => {
    // Po 6–22 (16 h), zavřeno 04:00–06:00 UTC = 06:00–08:00 Praha, tedy začátek ranní.
    const rows = [makeRow("XL_105", 1, { morningOn: true, afternoonOn: true })];
    const shutdown = [{ machine: null, startDate: "2026-04-13T04:00:00.000Z", endDate: "2026-04-13T06:00:00.000Z" }];
    const iv = staffedIntervals("XL_105", "2026-04-13", "2026-04-13", rows, shutdown);
    assert.equal(totalHours(iv), 14);
    assert.equal(iv.length, 1, "odstávka na kraji směnu jen zkrátí");
    assert.equal(iv[0].start, new Date("2026-04-13T06:00:00.000Z").getTime());
  });

  it("odstávka uprostřed směny udělá DVA intervaly", () => {
    const rows = [makeRow("XL_105", 1, { morningOn: true, afternoonOn: true })]; // 6–22 Praha
    const shutdown = [{ machine: null, startDate: "2026-04-13T08:00:00.000Z", endDate: "2026-04-13T10:00:00.000Z" }];
    const iv = staffedIntervals("XL_105", "2026-04-13", "2026-04-13", rows, shutdown);
    assert.equal(iv.length, 2);
    assert.equal(totalHours(iv), 14);
  });

  it("stroj bez řádků MachineWeekShifts → prázdné pole, ne výjimka", () => {
    assert.deepEqual(staffedIntervals("XL_105", "2026-04-13", "2026-04-17", [], []), []);
  });

  it("obrácený rozsah → prázdné pole", () => {
    assert.deepEqual(staffedIntervals("XL_105", "2026-04-17", "2026-04-13", make16hShifts(), []), []);
  });
});
```

Do importního bloku téhož souboru (dnes ř. 5–19) přidej `staffedIntervals` do seznamu z `"./reportMetrics"` a nový řádek `import { totalHours } from "./intervals";`.

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — `staffedIntervals` není exportovaná (TS/ESM chyba o chybějícím exportu). Žádný jiný test v souboru padat nesmí.

- [ ] **Krok 3: Přesuň privátní helper a přejmenuj ho na `staffedBreakdown`**

V `src/lib/reportMetrics.ts` **vyjmi** celou privátní funkci `staffedIntervals` včetně jejího JSDoc (dnes ř. 141–193, JSDoc začíná „Absolutní UTC intervaly OBSAZENÝCH směn v okně…") a vlož ji **nad** `computeAvailableHours`, tedy hned za `shiftIntervalsForDay` (dnes končí ř. 57). Tělo se nemění ani o řádek, mění se jen jméno a JSDoc:

```ts
/**
 * Obsazené směny v okně `window` jako UTC intervaly — a k tomu rozpad, který
 * potřebuje kaskáda kalendáře: směny PŘED odečtením odstávek (`rawShifts`) a dny
 * bez řádku v `MachineWeekShifts` (`noRoster`).
 *
 * Jediné místo v repu, které rozvrh na intervaly převádí. Veřejná `staffedIntervals`
 * si sem chodí pro čistý seznam (a `computeAvailableHours` skrz ni pro jeho součet),
 * `computeCalendarCascade` pro celý rozpad. Dokud si jmenovatel a čitatel stavěli
 * intervaly každý po svém, hlásil report „přeplánováno o 1 h" na stroji s prázdnou
 * směnou (spec etapy 2 září 2026, odd. 2.1).
 *
 * Začíná se DEN PŘED rozsahem: noční směna patří ke dni svého startu a do okna
 * zasahuje ocasem po půlnoci. Ořez oknem pak drží jen hodiny uvnitř období.
 */
function staffedBreakdown(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
  shutdowns: Interval[],
  window: Interval[],
): { staffed: Interval[]; rawShifts: Interval[]; noRoster: Interval[] } {
```

Zbytek těla (od `const rawShifts: Interval[] = [];` po `}` funkce) zkopíruj **doslova** z dnešní verze, včetně obou dlouhých komentářů o `noRoster` a o dni před rozsahem.

V `computeCalendarCascade` (dnes ř. 234, řádek `const { staffed, rawShifts, noRoster } = staffedIntervals(...)`) přepiš jediné volání:

```ts
  const { staffed, rawShifts, noRoster } = staffedBreakdown(machine, rangeStart, rangeEnd, weekShifts, shutdowns, period);
```

- [ ] **Krok 4: Přidej exportovanou `staffedIntervals` a přepiš `computeAvailableHours`**

Nahraď celou dnešní funkci `computeAvailableHours` včetně jejího JSDoc (dnes ř. 59–118) tímto:

```ts
/**
 * Obsazené směny stroje v rozsahu civil date (inclusive) jako UTC intervaly,
 * po odečtení odstávek. Intervaly jsou seřazené a nepřekrývající se.
 *
 * **Jediný zdroj pravdy pro obě strany poměru vytížení.** Jmenovatel z nich dělá
 * součet (`computeAvailableHours`), čitatel rigidního bloku na nich počítá průnik
 * (`staffedOverlapMinutes`). Dřív si každá strana stavěla vlastní představu o tom,
 * kdy stroj jede, a proto stroj s osmihodinovou noční údržbou mimo jedinou ranní
 * směnu hlásil 100 % vytížení a „0 h volných" (spec etapy 2 září 2026, odd. 2.1).
 *
 * Okno je už v intervalech zahrnuté — volající ho neřeší.
 */
export function staffedIntervals(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayRow[],
): Interval[] {
  const winStart = pragueMinuteToUtcMs(rangeStart, 0);
  const winEnd = pragueMinuteToUtcMs(addDaysToCivilDate(rangeEnd, 1), 0);
  if (winEnd <= winStart) return [];

  const shutdowns = mergeIntervals(
    companyDayIntervalsFor(machine, companyDays).map((i) => ({
      start: i.start.getTime(),
      end: i.end.getTime(),
    })),
  );

  return staffedBreakdown(machine, rangeStart, rangeEnd, weekShifts, shutdowns, [
    { start: winStart, end: winEnd },
  ]).staffed;
}

/**
 * Dostupné pracovní hodiny stroje v rozsahu civil date (inclusive), **po odečtení odstávek**.
 *
 * Bez odečtení tvrdil report o týdnu celozávodní dovolené „0 % ze 152 dostupných hodin"
 * místo poctivého „0 z 0" — čitatel odstávku respektuje (expanze tisku v ní vrátí
 * START_NOT_RUNNABLE), jmenovatel ji dřív ignoroval. Na produkci 153,9 h v prosinci 2026.
 *
 * Je to VÝHRADNĚ součet `staffedIntervals`; slučování překrývajících se směn, ořez oknem
 * i ocas noční směny ze dne před rozsahem řeší ta funkce. Vlastní cesta k témuž číslu tady
 * byla do etapy 2 září 2026 a právě ta umožnila, aby se čitatel s jmenovatelem rozešel.
 */
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayRow[],
): number {
  return totalHours(staffedIntervals(machine, rangeStart, rangeEnd, weekShifts, companyDays));
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS — nové testy zelené a **všech 17 existujících `it()` v `describe("computeAvailableHours")` prošlo bez jediné úpravy**, stejně jako `describe("computeCalendarCascade")` včetně testu parity `staffedHours`.

Pokud některý z existujících testů spadne, oprava patří do nové funkce, NIKDY do testu — ten pinuje chování, které se nesmí změnit.

- [ ] **Krok 6: Ověř zbytek suite a build**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: stejný počet selhání jako před úkolem (výchozí stav je 0, pokud běží AMPPS MySQL na portu 3306; bez DB padá `revision.server.test.ts`).

Run: `npm run build`
Expected: úspěch, bez nových TS chyb.

- [ ] **Krok 7: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "$(cat <<'EOF'
refactor(reporty): staffedIntervals jako jediný zdroj obsazených směn

computeAvailableHours je nově jen totalHours(staffedIntervals). Privátní
helper téhož jména se přejmenoval na staffedBreakdown (vrací rozpad pro
kaskádu kalendáře) a přesunul nad prvního konzumenta. Chování jmenovatele
se nemění — 17 existujících testů prošlo beze změny.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `staffedOverlapMinutes` a `occupiedMinutes` — poctivý čitatel

**Files:**
- Modify: `src/lib/reportMetrics.ts` (nová sekce za `staffedIntervals`)
- Test: `src/lib/reportMetrics.test.ts` (nový `describe` za blok `staffedIntervals` z Tasku 1)

**Interfaces:**
- Consumes: `staffedIntervals` z Tasku 1; `Interval`, `intersectIntervals` z `./intervals`; NOVĚ `printOverlapMinutes` a `type PrintSegment` z `./printTimeClient` (soubor už z tohoto modulu importuje `companyDayIntervalsFor`, takže nevzniká cyklus).
- Produces:
  - `staffedOverlapMinutes(b: { startTime: string | Date; endTime: string | Date }, staffed: Interval[]): number` — minuty průniku `[startTime, endTime)` s obsazenými směnami.
  - `occupiedMinutes(segments: PrintSegment[] | null, b: { startTime: string | Date; endTime: string | Date }, winStart: Date, winEnd: Date, staffed: Interval[]): number` — jediné rozhodnutí „segmenty, nebo ořez na směny". Používají ji Task 3 (`handleOutlook`, `attention`) a Task 4 (`handleRetro`).

- [ ] **Krok 1: Napiš padající test**

Vlož do `src/lib/reportMetrics.test.ts` za blok `describe("staffedIntervals", …)` z Tasku 1:

```ts
// ---------------------------------------------------------------------------
// staffedOverlapMinutes + occupiedMinutes — čitatel rigidního bloku
// ---------------------------------------------------------------------------
describe("staffedOverlapMinutes", () => {
  /** Po 13. 4. 2026, jediná ranní směna 6–14 Praha = 04:00–12:00 UTC (8 h). */
  const MORNING_ONLY = [makeRow("XL_105", 1, { morningOn: true })];
  const staffedMonday = () => staffedIntervals("XL_105", "2026-04-13", "2026-04-13", MORNING_ONLY, []);

  it("noční údržba celá mimo směnu → 0 minut (modelový příklad ze zadání)", () => {
    // 22:00–06:00 Praha = 20:00 UTC → 04:00 UTC druhý den. S ranní 04:00–12:00 UTC
    // se nepotká: ocas končí přesně tam, kde směna začíná, a intervaly jsou [start, end).
    const udrzba = { startTime: "2026-04-13T20:00:00.000Z", endTime: "2026-04-14T04:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(udrzba, staffedMonday()), 0);
  });

  it("dotyk hranice směny není překryv", () => {
    const pred = { startTime: "2026-04-13T02:00:00.000Z", endTime: "2026-04-13T04:00:00.000Z" };
    const za = { startTime: "2026-04-13T12:00:00.000Z", endTime: "2026-04-13T14:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(pred, staffedMonday()), 0);
    assert.equal(staffedOverlapMinutes(za, staffedMonday()), 0);
  });

  it("údržba zasahující do směny se počítá jen překryvem", () => {
    // 04:00–08:00 Praha = 02:00–06:00 UTC; uvnitř směny leží 04:00–06:00 UTC = 120 min.
    const udrzba = { startTime: "2026-04-13T02:00:00.000Z", endTime: "2026-04-13T06:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(udrzba, staffedMonday()), 120);
  });

  it("údržba celá uvnitř směny se počítá celá", () => {
    const udrzba = { startTime: "2026-04-13T05:00:00.000Z", endTime: "2026-04-13T07:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(udrzba, staffedMonday()), 120);
  });

  it("blok mimo okno → 0", () => {
    const udrzba = { startTime: "2026-04-20T05:00:00.000Z", endTime: "2026-04-20T07:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(udrzba, staffedMonday()), 0);
  });

  it("odstávka uvnitř směny se od čitatele odečte", () => {
    // Zavřeno 04:00–06:00 UTC → obsazeno zbývá 06:00–12:00 UTC.
    const shutdown = [{ machine: null, startDate: "2026-04-13T04:00:00.000Z", endDate: "2026-04-13T06:00:00.000Z" }];
    const staffed = staffedIntervals("XL_105", "2026-04-13", "2026-04-13", MORNING_ONLY, shutdown);
    const udrzba = { startTime: "2026-04-13T05:00:00.000Z", endTime: "2026-04-13T07:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(udrzba, staffed), 60);
  });

  it("stroj bez naseedovaných směn → 0, ne celý span", () => {
    // Řádky `MachineWeekShifts` vznikají líně, takže neotevřený týden je běžný stav.
    const udrzba = { startTime: "2026-04-13T05:00:00.000Z", endTime: "2026-04-13T07:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(udrzba, []), 0);
  });

  it("degenerovaný blok (konec = start) → 0", () => {
    const nic = { startTime: "2026-04-13T05:00:00.000Z", endTime: "2026-04-13T05:00:00.000Z" };
    assert.equal(staffedOverlapMinutes(nic, staffedMonday()), 0);
  });

  it("součet po dnech se rovná součtu za celé období (karta vs. heatmapa)", () => {
    const rows = [makeRow("XL_105", 1, { morningOn: true }), makeRow("XL_105", 2, { morningOn: true })];
    const whole = staffedIntervals("XL_105", "2026-04-13", "2026-04-14", rows, []);
    const udrzba = { startTime: "2026-04-13T10:00:00.000Z", endTime: "2026-04-14T06:00:00.000Z" };

    let daily = 0;
    for (const d of ["2026-04-13", "2026-04-14"]) {
      daily += staffedOverlapMinutes(udrzba, staffedIntervals("XL_105", d, d, rows, []));
    }
    assert.equal(staffedOverlapMinutes(udrzba, whole), 240, "10:00–12:00 UTC 13. 4. + 04:00–06:00 UTC 14. 4.");
    assert.equal(daily, 240);
  });

  it("den přechodu na zimní čas: blok přes celé okno = všechny obsazené hodiny", () => {
    // 25. 10. 2026 je poslední říjnová neděle. Směny jsou v MÍSTNÍM čase, takže
    // 6–14 zůstává osmihodinová; invariant „blok přes celé okno zabere celou
    // obsazenou dobu" ale musí platit i přes posun.
    const rows = ["2026-10-19", "2026-10-26"].flatMap((weekStart) =>
      makeWeekRows("XL_105", weekStart, { morningOn: true }),
    );
    const staffed = staffedIntervals("XL_105", "2026-10-24", "2026-10-26", rows, []);
    const celyRozsah = { startTime: "2026-10-20T00:00:00.000Z", endTime: "2026-11-01T00:00:00.000Z" };
    assert.equal(totalHours(staffed), 24, "tři dny × ranní 6–14");
    assert.equal(staffedOverlapMinutes(celyRozsah, staffed), 24 * 60);
  });
});

describe("occupiedMinutes", () => {
  const MORNING_ONLY = [makeRow("XL_105", 1, { morningOn: true })];
  const staffedMonday = () => staffedIntervals("XL_105", "2026-04-13", "2026-04-13", MORNING_ONLY, []);
  const WIN_START = new Date("2026-04-12T22:00:00.000Z"); // 13. 4. 00:00 Praha
  const WIN_END = new Date("2026-04-13T22:00:00.000Z");   // 14. 4. 00:00 Praha

  it("se segmenty počítá tiskový čas, směny ignoruje", () => {
    // Segmenty leží z definice uvnitř směn, takže druhý ořez by byl zbytečný —
    // a u bloku, který segmenty MÁ, by ho zkreslil.
    const b = { startTime: "2026-04-13T05:00:00.000Z", endTime: "2026-04-13T08:00:00.000Z" };
    const segs = [
      { kind: "print" as const, start: new Date("2026-04-13T05:00:00.000Z"), end: new Date("2026-04-13T06:00:00.000Z") },
      { kind: "pause" as const, start: new Date("2026-04-13T06:00:00.000Z"), end: new Date("2026-04-13T07:00:00.000Z") },
      { kind: "print" as const, start: new Date("2026-04-13T07:00:00.000Z"), end: new Date("2026-04-13T08:00:00.000Z") },
    ];
    assert.equal(occupiedMinutes(segs, b, WIN_START, WIN_END, staffedMonday()), 120, "pauza se nepočítá");
  });

  it("bez segmentů ořezává na obsazené směny, ne na okno", () => {
    const udrzba = { startTime: "2026-04-13T20:00:00.000Z", endTime: "2026-04-14T04:00:00.000Z" };
    // Okno bere 20:00–22:00 UTC = 2 h, směny nulu. Tohle je celá oprava etapy.
    assert.equal(printOverlapMinutes(null, udrzba, WIN_START, WIN_END), 120);
    assert.equal(occupiedMinutes(null, udrzba, WIN_START, WIN_END, staffedMonday()), 0);
  });
});
```

Do importního bloku téhož souboru přidej `staffedOverlapMinutes` a `occupiedMinutes` do seznamu z `"./reportMetrics"` a `makeWeekRows` už v souboru existuje (dnes ř. 48–56) — nepřidávej ho znovu. `printOverlapMinutes` se z `"./printTimeClient"` importuje už dnes (ř. 17).

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — `staffedOverlapMinutes` ani `occupiedMinutes` neexistují.

- [ ] **Krok 3: Napiš minimální implementaci**

Vlož do `src/lib/reportMetrics.ts` hned za `computeAvailableHours` (tedy před oddělovač sekce `// 1b. computeCalendarCascade`, dnes ř. 120):

```ts
/**
 * Minuty, kterými rigidní blok skutečně zabere stroj: průnik `[startTime, endTime)`
 * s obsazenými směnami.
 *
 * Okno reportu se tu neřeší — `staffedIntervals` ho má už zahrnuté. Kdo sem pošle
 * intervaly za jiné období než to, na které se ptá, dostane odpověď na tu jinou
 * otázku.
 *
 * Existuje proto, že `printOverlapMinutes(null, …)` ořezává jen OKNEM. Osmihodinová
 * noční údržba mimo jedinou ranní směnu se tak celá naúčtovala do čitatele, zatímco
 * jmenovatel ji neznal — a stroj s prázdnou směnou hlásil „100 %, 0 h volných", po
 * přidání jediné hodiny „113 %, přeplánováno o 1 h" (spec etapy 2 září 2026).
 */
export function staffedOverlapMinutes(
  b: { startTime: string | Date; endTime: string | Date },
  staffed: Interval[],
): number {
  const start = new Date(b.startTime).getTime();
  const end = new Date(b.endTime).getTime();
  if (!(end > start)) return 0;
  let ms = 0;
  for (const iv of intersectIntervals([{ start, end }], staffed)) ms += iv.end - iv.start;
  return ms / 60_000;
}

/**
 * JEDINÉ místo, které rozhoduje, jak se blok do vytížení počítá.
 *
 * - Segmenty (`blockReportSegments` je uměl spočítat) → tiskový čas uvnitř okna.
 *   Segmenty z definice leží uvnitř směn, takže druhý ořez by nic nepřidal.
 * - Bez segmentů (údržba, legacy rezervace bez `printMinutes`, odložený nebo
 *   rozejitý blok, selhaná expanze) → průnik s obsazenými směnami.
 *
 * `winStart`/`winEnd` platí jen pro první větev; druhá má okno v `staffed`.
 * Pravidlo má jedno jméno schválně: tři konzumenti (`handleRetro`, `handleOutlook`,
 * `api/report/attention`) ho dřív měli každý vlastní a právě tak se rozešli.
 */
export function occupiedMinutes(
  segments: PrintSegment[] | null,
  b: { startTime: string | Date; endTime: string | Date },
  winStart: Date,
  winEnd: Date,
  staffed: Interval[],
): number {
  return segments
    ? printOverlapMinutes(segments, b, winStart, winEnd)
    : staffedOverlapMinutes(b, staffed);
}
```

V hlavičce souboru rozšiř import z `./printTimeClient` (dnes ř. 14, `import { companyDayIntervalsFor } from "./printTimeClient";`) na:

```ts
import { companyDayIntervalsFor, printOverlapMinutes, type PrintSegment } from "./printTimeClient";
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS, všechno zelené.

- [ ] **Krok 5: Ověř, že `printOverlapMinutes` zůstal nedotčený**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: PASS bez jediné úpravy souboru — hlavně pět testů `printOverlapMinutes` (dnes ř. 398–438), z nichž „segments=null → elapsed průnik" pinuje právě to chování, které nová funkce NEMÁ nahradit.

Run: `npm run build`
Expected: úspěch.

- [ ] **Krok 6: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "$(cat <<'EOF'
feat(reporty): staffedOverlapMinutes + occupiedMinutes — ořez rigidního bloku na směny

Rigidní blok (údržba, legacy rezervace, odložená nebo rozejitá zakázka) se
nově počítá jen tou částí, která leží uvnitř obsazených směn.
occupiedMinutes je jediné místo, které rozhoduje mezi tiskovými segmenty
a ořezem na směny. printOverlapMinutes zůstává beze změny.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Výhled a stavový pás — `usesTiskoveHodiny` + ořez na směny

**Files:**
- Modify: `src/app/api/report/dashboard/route.ts`, funkce `handleOutlook` (dnes ř. 406–544)
- Modify: tamtéž importy (dnes ř. 7–24)
- Modify: `src/app/api/report/attention/route.ts` (dnes ř. 97–153)
- Test: `src/lib/reportMetrics.test.ts` (nový `describe` s modelovým příkladem a rezervací bez segmentů)

**Interfaces:**
- Consumes: `staffedIntervals`, `occupiedMinutes`, `staffedOverlapMinutes`, `computeAvailableHours`, `computeUtilization` z `@/lib/reportMetrics`; `intersectIntervals` a `type Interval` z `@/lib/intervals`; `usesTiskoveHodiny` z `@/lib/printTime` (dashboard route ho už importuje na ř. 23, attention route ho přidává).
- Produces: nic pro další úkoly. Task 4 vytvoří strážný test, který obě tyto routy kontroluje, a proto se **nesmí** předběhnout — Task 4 běží po tomhle.

- [ ] **Krok 1: Napiš padající test modelového příkladu**

Vlož do `src/lib/reportMetrics.test.ts` za blok `describe("occupiedMinutes", …)` z Tasku 2:

```ts
// ---------------------------------------------------------------------------
// Modelový příklad ze zadání etapy 2 (září 2026)
// ---------------------------------------------------------------------------
describe("modelový příklad: noční údržba nesmí nafouknout obsazenost", () => {
  // Stroj jede jedinou ranní směnu 6–14 v pondělí 13. 4. (8 h), v úterý nemá
  // v `MachineWeekShifts` řádek. V noci z pondělí na úterý běží osmihodinová
  // údržba 22–6, do směny nezasahuje. Uvnitř směny leží jedna hodina zakázky.
  // Období je 13.–14. 4., takže celá údržba leží UVNITŘ okna reportu — právě
  // v tom je vada: okno ji nezkrátí a jmenovatel o ní nic neví.
  const rows = [makeRow("XL_105", 1, { morningOn: true })];
  const WIN_START = new Date("2026-04-12T22:00:00.000Z"); // 13. 4. 00:00 Praha
  const WIN_END = new Date("2026-04-14T22:00:00.000Z");   // 15. 4. 00:00 Praha
  const udrzba = { startTime: "2026-04-13T20:00:00.000Z", endTime: "2026-04-14T04:00:00.000Z" };
  const zakazka = { startTime: "2026-04-13T05:00:00.000Z", endTime: "2026-04-13T06:00:00.000Z" };

  it("dnešní hrubý span dává 113 % a falešné přeplánování (pinuje opravovanou vadu)", () => {
    const availableHours = computeAvailableHours("XL_105", "2026-04-13", "2026-04-14", rows, []);
    const plannedHours =
      (printOverlapMinutes(null, udrzba, WIN_START, WIN_END) +
        printOverlapMinutes(null, zakazka, WIN_START, WIN_END)) / 60;
    assert.equal(availableHours, 8, "jen pondělní ranní směna");
    assert.equal(plannedHours, 9, "8 h údržby mimo směnu + 1 h zakázky ve směně");
    assert.equal(computeUtilization(plannedHours, availableHours), 113);
    assert.equal(Math.max(0, -(availableHours - plannedHours)), 1, "„přeplánováno o 1 h“");
  });

  it("po opravě: údržba 0 h, obsazenost 13 % a 7 h volných", () => {
    const staffed = staffedIntervals("XL_105", "2026-04-13", "2026-04-14", rows, []);
    const availableHours = totalHours(staffed);
    const plannedHours =
      (occupiedMinutes(null, udrzba, WIN_START, WIN_END, staffed) +
        occupiedMinutes(null, zakazka, WIN_START, WIN_END, staffed)) / 60;

    assert.equal(staffedOverlapMinutes(udrzba, staffed), 0, "noční údržba mimo směnu se nepočítá");
    assert.equal(availableHours, 8);
    assert.equal(plannedHours, 1);

    const remaining = availableHours - plannedHours;
    assert.equal(Math.max(0, remaining), 7, "7 h volných");
    assert.equal(Math.max(0, -remaining), 0, "žádné přeplánování");
    // Přesný poměr je 12,5 %; karta ukazuje celé procento, `computeUtilization`
    // zaokrouhluje (`Math.round`) a to se v téhle etapě nemění.
    assert.equal(computeUtilization(plannedHours, availableHours), 13);
  });

  it("rezervace s tiskovými minutami, jejíž expanze selže, se taky ořeže na směny", () => {
    // `usesTiskoveHodiny` je u ní true, ale `blockReportSegments` může vrátit null
    // (drift konce, chybějící týdny směn). Pak MUSÍ spadnout na ořez směnami, ne
    // na hrubý span — jinak oprava mine právě tu populaci, kvůli které vznikla.
    const staffed = staffedIntervals("XL_105", "2026-04-13", "2026-04-14", rows, []);
    const iml = { startTime: "2026-04-13T20:00:00.000Z", endTime: "2026-04-14T04:00:00.000Z" };
    assert.equal(printOverlapMinutes(null, iml, WIN_START, WIN_END), 480, "hrubý span");
    assert.equal(occupiedMinutes(null, iml, WIN_START, WIN_END, staffed), 0, "ořez na směny");
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že prochází HNED**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS.

**Tenhle blok červenou fázi záměrně nemá** a není to obcházení TDD: počítá výhradně nad funkcemi hotovými z Tasků 1 a 2 a jeho úkol je **zafixovat modelový příklad ze zadání** — obě čísla, vadné i opravené, vedle sebe, aby je příští refaktor nemohl tiše prohodit. Kdyby měl padat, znamenalo by to, že Task 1 nebo 2 jsou špatně.

Pokud některý literál nevyjde (`113`, `9`, `13`, `7`), NEupravuj ho naslepo: vypiš `staffed` a obě dílčí minutové hodnoty, ověř je ručně proti oknu 13. 4. 00:00 – 15. 4. 00:00 Praha a rozhodni, jestli je chyba v plánu, nebo v implementaci. Rozhodnutí zapiš do ledgeru.

- [ ] **Krok 3: Přepiš `handleOutlook`**

V `src/app/api/report/dashboard/route.ts` uprav importy (dnes ř. 7–24): do seznamu z `"@/lib/reportMetrics"` přidej `staffedIntervals` a `occupiedMinutes`, a přidej nový řádek

```ts
import { intersectIntervals, type Interval } from "@/lib/intervals";
```

V `handleOutlook` nahraď stavbu `segMap` (dnes ř. 444–448, končí `}`) tímto:

```ts
  // Segmenty 1× per blok — denní smyčka by expanzi opakovala až 30×.
  // `usesTiskoveHodiny`, ne `type === "ZAKAZKA"`: IML zadané jako REZERVACE
  // s tiskovými minutami se do etapy 2 (září 2026) počítalo nafouknutým
  // kalendářním spanem místo tiskového času. Retrospektiva to dělala správně
  // už od etapy 9; Výhled a stavový pás se tím teprve srovnávají.
  const segMap = new Map<(typeof blockInputs)[number], PrintSegment[] | null>();
  for (const b of blockInputs) {
    segMap.set(b, usesTiskoveHodiny(b) ? blockReportSegments(b, weekShifts, companyDays) : null);
  }

  // Obsazené směny 1× per stroj. Denní smyčka si z nich bere průnik se dnem —
  // druhý průchod rozvrhem by u 400denního rozsahu jen zdvojil práci a hlavně
  // by se mohl s celoobdobovým výpočtem rozejít (karta vs. heatmapa pod ní).
  const staffedByMachine = new Map<string, Interval[]>();
  for (const machine of MACHINES) {
    staffedByMachine.set(machine, staffedIntervals(machine, rangeStart, rangeEnd, weekShifts, companyDays));
  }
```

Nahraď per-machine smyčku (dnes ř. 453–467, od `for (const machine of MACHINES) {` po uzavírací `}` té smyčky) tímto:

```ts
  for (const machine of MACHINES) {
    const staffed = staffedByMachine.get(machine) ?? [];
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, weekShifts, companyDays);
    // Blok s tiskovými segmenty jde přes ně (týž ořez jako v retro režimu i v denním
    // grafu níž); rigidní blok se ořezává na OBSAZENÉ SMĚNY, ne na okno reportu.
    // Dokud se ořezával jen oknem, nafoukla osmihodinová noční údržba čitatel proti
    // jmenovateli, který ji nezná — stroj s prázdnou ranní směnou hlásil „0 h volných"
    // a po přidání jedné hodiny „přeplánováno o 1 h" (spec etapy 2, odd. 2.2).
    const plannedHours = blockInputs
      .filter((b) => b.machine === machine)
      .reduce((sum, b) => sum + occupiedMinutes(segMap.get(b) ?? null, b, startUtc, endUtc, staffed) / 60, 0);
    // `freeHours` se ZÁMĚRNĚ neusekává na nule — „0 h volných“ a „přeplánováno o 26 h“
    // jsou dvě různé zprávy a plánovač potřebuje tu druhou. Kladné `overbookedHours`
    // je ta část, o kterou je stroj nad kapacitou.
    const remaining = availableHours - plannedHours;
    const freeHours = round1(Math.max(0, remaining));
    const overbookedHours = round1(Math.max(0, -remaining));
    const plannedCapacity = computeUtilization(plannedHours, availableHours);
    machines[machine] = { plannedCapacity, freeHours, overbookedHours, availableHours: round1(availableHours) };
  }
```

Nahraď vnitřní smyčku `dailyCapacity` (dnes ř. 478–484, blok `for (const machine of MACHINES) { … }` uvnitř `while`) tímto:

```ts
    for (const machine of MACHINES) {
      const avail = computeAvailableHours(machine, cur, cur, weekShifts, companyDays);
      // Den se odvozuje PRŮNIKEM z celoobdobových intervalů, ne novým průchodem
      // rozvrhem: tím je součet po dnech rovný součtu za období konstrukcí, takže
      // heatmapa nemůže tvrdit něco jiného než karta nad ní.
      const dayStaffed = intersectIntervals(staffedByMachine.get(machine) ?? [], [
        { start: dayStart.getTime(), end: dayEnd.getTime() },
      ]);
      const planned = dayBlocks
        .filter((b) => b.machine === machine)
        .reduce((sum, b) => sum + occupiedMinutes(segMap.get(b) ?? null, b, dayStart, dayEnd, dayStaffed), 0) / 60;
      entry[machine] = computeUtilization(planned, avail);
    }
```

- [ ] **Krok 4: Přepiš `api/report/attention`**

V `src/app/api/report/attention/route.ts` uprav importy (dnes ř. 9–10) na:

```ts
import { computeAvailableHours, staffedIntervals, occupiedMinutes } from "@/lib/reportMetrics";
import { blockReportSegments, type PrintSegment } from "@/lib/printTimeClient";
import { usesTiskoveHodiny } from "@/lib/printTime";
import { intersectIntervals, type Interval } from "@/lib/intervals";
```

(`printOverlapMinutes` se z importu VYPOUŠTÍ — route ho po změně nevolá.)

V JSDoc hlavičky souboru přepiš odstavec o vstupech (dnes ř. 29–31) na:

```
 * Vstupy jsou ZÁMĚRNĚ tytéž jako v `handleOutlook` (`/api/report/dashboard`):
 * tiskové minuty bloků se segmenty ořezané oknem a rigidní bloky ořezané na
 * OBSAZENÉ SMĚNY, obojí přes `occupiedMinutes`. Segmenty se staví pro každý
 * blok, který používá tiskové hodiny (`usesTiskoveHodiny`), tedy i pro IML
 * rezervaci s tiskovými minutami — ne jen pro ZAKAZKA.
```

Nahraď stavbu `segMap` (dnes ř. 99–104) tímto:

```ts
    // Segmenty 1× per blok — denní smyčka níž by expanzi opakovala až 30×.
    // `usesTiskoveHodiny` pokrývá i REZERVACI s tiskovými minutami (IML); blok
    // bez tiskových hodin jde na ořez obsazenými směnami, ne na hrubý span.
    const segMap = new Map<(typeof blocks)[number], PrintSegment[] | null>();
    for (const b of blocks) {
      segMap.set(b, usesTiskoveHodiny(b) ? blockReportSegments(b, weekShifts, companyDays) : null);
    }
```

Nahraď hlavičku per-machine smyčky (dnes ř. 108–111) tímto:

```ts
    for (const machine of MACHINES) {
      const machineBlocks = blocks.filter((b) => b.machine === machine);
      // Obsazené směny za celý horizont 1×; den se z nich odvozuje průnikem,
      // takže se denní verdikt nemůže rozejít s celkovým součtem.
      const staffed = staffedIntervals(machine, today, horizonLastDay, weekShifts, companyDays);
      const plannedMinutes = (winStart: Date, winEnd: Date, winStaffed: Interval[]) =>
        machineBlocks.reduce(
          (s, b) => s + occupiedMinutes(segMap.get(b) ?? null, b, winStart, winEnd, winStaffed),
          0,
        );
```

A ve denní smyčce nahraď dnešní ř. 141–144:

```ts
        const dayStart = pragueToUTC(cur, 0, 0);
        const dayEnd = pragueToUTC(addDaysToCivilDate(cur, 1), 0, 0);
        const dayStaffed = intersectIntervals(staffed, [
          { start: dayStart.getTime(), end: dayEnd.getTime() },
        ]);
        const dayAvail = computeAvailableHours(machine, cur, cur, weekShifts, companyDays);
        const dayPlanned = plannedMinutes(dayStart, dayEnd, dayStaffed) / 60;
```

- [ ] **Krok 5: Spusť testy a build**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS.

Run: `npm run build`
Expected: úspěch. Kdyby `tsc` hlásil nepoužitý import `printOverlapMinutes` v attention route, odstraň ho — do routy už nepatří.

Run: `npm run lint`
Expected: 0 chyb (warningy jsou OK).

- [ ] **Krok 6: Commit**

```bash
git add src/app/api/report/dashboard/route.ts src/app/api/report/attention/route.ts src/lib/reportMetrics.test.ts
git commit -m "$(cat <<'EOF'
fix(reporty): Výhled a stavový pás počítají tiskové hodiny a ořezávají na směny

handleOutlook i /api/report/attention staví segmenty přes usesTiskoveHodiny
(IML jako rezervace se konečně počítá tiskovým časem) a rigidní blok posílají
přes occupiedMinutes, tedy s ořezem na obsazené směny. Falešné
„přeplánováno o X h" u prázdné směny tím mizí. Den se odvozuje průnikem
celoobdobových intervalů, takže heatmapa nemůže tvrdit něco jiného než karta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Retrospektiva — údržba, legacy rezervace a odložené bloky + strážný test zapojení

**Files:**
- Modify: `src/app/api/report/dashboard/route.ts`, funkce `handleRetro` (dnes ř. 140–398)
- Create: `src/lib/reportNumeratorWiring.test.ts`

**Interfaces:**
- Consumes: `staffedIntervals`, `occupiedMinutes` z `@/lib/reportMetrics` (import už přidal Task 3); `intersectIntervals`, `type Interval` z `@/lib/intervals` (dtto); `stripComments` z `@/lib/sourceTextTestUtils`.
- Produces: nic pro další úkoly.

- [ ] **Krok 1: Napiš padající strážný test**

Vytvoř `src/lib/reportNumeratorWiring.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test čitatele vytížení (etapa 2 září 2026, spec odd. 2).
 *
 * Tři agregace nad týmiž vstupy — `handleRetro`, `handleOutlook` a stavový pás
 * Kontrolního panelu — se do etapy 2 rozcházely: každá si rozhodovala sama, jak
 * se blok bez tiskových segmentů počítá, a Výhled navíc bral segmenty jen pro
 * ZAKAZKA. Výsledkem bylo „100 %, 0 h volných" na stroji s prázdnou směnou.
 *
 * Test hlídá ZAPOJENÍ, ne existenci funkce: čistá `occupiedMinutes` sama nic
 * neopraví, když ji route nezavolá (P15). Komentáře se odstraňují, aby dočasně
 * zakomentované volání testem neprošlo.
 */
const dashboard = stripComments(readFileSync("src/app/api/report/dashboard/route.ts", "utf8"));
const attention = stripComments(readFileSync("src/app/api/report/attention/route.ts", "utf8"));

test("rigidní blok se v obou režimech i ve stavovém pásu počítá přes occupiedMinutes", () => {
  for (const [name, src] of [["dashboard", dashboard], ["attention", attention]] as const) {
    assert.match(src, /occupiedMinutes\(/, `${name}: agregace musí jít přes occupiedMinutes`);
    assert.doesNotMatch(
      src,
      /printOverlapMinutes\(/,
      `${name}: hrubý span patří dovnitř occupiedMinutes, ne do routy`,
    );
  }
});

test("Výhled i stavový pás staví segmenty podle usesTiskoveHodiny, ne podle typu bloku", () => {
  for (const [name, src] of [["dashboard", dashboard], ["attention", attention]] as const) {
    assert.doesNotMatch(
      src,
      /type === "ZAKAZKA"\s*\?\s*blockReportSegments/,
      `${name}: IML rezervace s tiskovými minutami by dostala kalendářní span`,
    );
  }
  // Dashboard staví segMap dvakrát — jednou v retro režimu, jednou ve Výhledu.
  assert.equal(
    (dashboard.match(/usesTiskoveHodiny\(b\)\s*\?\s*blockReportSegments/g) ?? []).length,
    2,
    "oba režimy dashboardu musí větvit na usesTiskoveHodiny",
  );
  assert.match(attention, /usesTiskoveHodiny\(b\)\s*\?\s*blockReportSegments/);
});

test("den se odvozuje PRŮNIKEM celoobdobových intervalů, ne novým průchodem rozvrhem", () => {
  // Jinak se může heatmapa rozejít s kartou nad ní — tatáž třída vady, jakou už
  // jednou opravoval komentář o 26 h ze 399 h v `handleRetro`.
  assert.equal(
    (dashboard.match(/intersectIntervals\(/g) ?? []).length,
    2,
    "retro i výhled si denní intervaly berou průnikem",
  );
  assert.match(attention, /intersectIntervals\(/);
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/reportNumeratorWiring.test.ts`
Expected: FAIL — `handleRetro` v dashboard route dál volá `printOverlapMinutes` (na dvou místech) a `intersectIntervals` je v dashboardu zatím jen jednou.

- [ ] **Krok 3: Přepiš `handleRetro`**

V `src/app/api/report/dashboard/route.ts` vlož za stavbu `segMap` v `handleRetro` (dnes ř. 205–212, končí `}`) nový blok:

```ts
  // Obsazené směny 1× per stroj — viz týž komentář v `handleOutlook`.
  const staffedByMachine = new Map<string, Interval[]>();
  for (const machine of MACHINES) {
    staffedByMachine.set(machine, staffedIntervals(machine, rangeStart, rangeEnd, weekShifts, companyDays));
  }
```

Nahraď v per-machine smyčce (začíná ř. 222) řádky 223–231 — tedy `const availableHours = …`, komentář „Souhrn se ořezává STEJNĚ jako denní graf.", `clippedHours` a `sumClipped` — tímto (`availableHours` zůstává, jen se k němu přidává `staffed`):

```ts
    const staffed = staffedByMachine.get(machine) ?? [];
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, weekShifts, companyDays);
    // Souhrn se ořezává STEJNĚ jako denní graf. Dřív se sčítala celá délka bloků, které
    // období jen protínají, kdežto dostupné hodiny ořezané byly — na produkci 26 h ze
    // 399 h v srpnu 2026, a tytéž hodiny se započetly znovu i v září. Tímhle zároveň
    // mizí rozpor mezi kartou a grafem pod ní: obě čísla jedou přes týž `segMap`.
    //
    // Od etapy 2 (září 2026) se blok BEZ segmentů ořezává na OBSAZENÉ SMĚNY, ne jen
    // oknem: týká se to údržby (`usesTiskoveHodiny` je u ní natrvalo false), legacy
    // rezervací bez `printMinutes` a odložených či rozejitých zakázek, u kterých
    // expanze vrátí null. Zakázka zaparkovaná přes víkend tím přestává nafukovat
    // vytížení a „Podíl údržby" přestává účtovat noční servis mimo směnu.
    const clippedHours = (b: (typeof blockInputs)[number]) =>
      occupiedMinutes(segMap.get(b) ?? null, b, startUtc, endUtc, staffed) / 60;
    const sumClipped = (type: string) =>
      blockInputs.filter((b) => b.machine === machine && b.type === type).reduce((s, b) => s + clippedHours(b), 0);
```

Nahraď vnitřní smyčku `dailyUtilization` (dnes ř. 282–288, blok `for (const machine of MACHINES) { … }` uvnitř `while`) tímto:

```ts
    for (const machine of MACHINES) {
      const avail = computeAvailableHours(machine, cur, cur, weekShifts, companyDays);
      // Den průnikem z celoobdobových intervalů — viz týž komentář v `handleOutlook`.
      const dayStaffed = intersectIntervals(staffedByMachine.get(machine) ?? [], [
        { start: dayStart.getTime(), end: dayEnd.getTime() },
      ]);
      const prodMin = dayBlocks
        .filter((b) => b.machine === machine && b.type === "ZAKAZKA")
        .reduce((sum, b) => sum + occupiedMinutes(segMap.get(b) ?? null, b, dayStart, dayEnd, dayStaffed), 0);
      entry[machine] = computeUtilization(prodMin / 60, avail);
    }
```

Nakonec uprav komentář nad `segMap.set` v `handleRetro` — nahraď celý blok stavby `segMap` (dnes ř. 205–212), aby dál nemluvil o „konzervativním fallbacku celého spanu":

```ts
  // Segmenty 1× per blok — denní smyčka by expanzi opakovala až 30×.
  const segMap = new Map<(typeof blockInputs)[number], PrintSegment[] | null>();
  for (const b of blockInputs) {
    // ZAKAZKA (vytížení) + REZERVACE s pm (ukazatel rezervované kapacity, etapa 9
    // rozhodnutí #5). Sumy níž filtrují per typ, takže vytížení se tím NEMĚNÍ.
    // Legacy rezervace (pm null) a údržba dostanou null → `occupiedMinutes` je
    // ořeže na obsazené směny (etapa 2 září 2026), ne na hrubý span.
    segMap.set(b, usesTiskoveHodiny(b) ? blockReportSegments(b, weekShifts, companyDays) : null);
  }
```

- [ ] **Krok 4: Odstraň nepoužitý import `printOverlapMinutes`**

Tímto krokem zmizelo poslední volání `printOverlapMinutes` v `src/app/api/report/dashboard/route.ts` — hrubý span tam teď počítá jen `occupiedMinutes` uvnitř `reportMetrics.ts`. Zúž proto import (dnes ř. 22):

```ts
import { blockReportSegments, type PrintSegment } from "@/lib/printTimeClient";
```

Ověř, že v souboru opravdu žádné volání nezbylo:

```bash
grep -n "printOverlapMinutes" src/app/api/report/dashboard/route.ts
```
Expected: žádný výstup.

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `node --test --import tsx src/lib/reportNumeratorWiring.test.ts`
Expected: PASS, všechny tři testy zelené.

Pokud `assert.equal(… /intersectIntervals\(/g …, 2)` padne, znamená to, že v dashboardu je volání víc nebo míň — přepočítej skutečná místa (retro denní smyčka + výhled denní smyčka = 2) a uprav buď kód, nebo očekávané číslo, podle toho, co je pravda. Číslo v testu musí odpovídat kódu, ne naopak.

- [ ] **Krok 6: Ověř celou suite a build**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: stejný počet selhání jako na začátku etapy (0 s běžící AMPPS MySQL).

Run: `npm run build`
Expected: úspěch, bez varování o nepoužitém importu.

- [ ] **Krok 7: Commit**

```bash
git add src/app/api/report/dashboard/route.ts src/lib/reportNumeratorWiring.test.ts
git commit -m "$(cat <<'EOF'
fix(reporty): Retrospektiva ořezává údržbu, legacy rezervace i odložené bloky na směny

handleRetro posílá všechny typy přes occupiedMinutes, takže „Podíl údržby"
přestává účtovat noční servis mimo směnu a odložená zakázka zaparkovaná
přes víkend přestává nafukovat vytížení. Nový strážný test
reportNumeratorWiring hlídá zapojení ve všech třech agregacích — do etapy 2
autorizaci ani čitatel reportů nehlídal žádný test.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Přístup pro roli PLANOVAT — šest serverových míst, odkaz a strážný test

**Files:**
- Modify: `src/middleware.ts` (dnes ř. 60–72)
- Modify: `src/app/reporty/page.tsx:8`
- Modify: `src/app/api/report/dashboard/route.ts:26`
- Modify: `src/app/api/report/attention/route.ts` (dnes ř. 47–48)
- Modify: `src/app/api/report/health/route.ts:10`
- Modify: `src/app/_components/PlannerPage.tsx:3432`
- Modify: `CLAUDE.md` (tabulka „Role a přístup", ř. 21–29)
- Create: `src/lib/reportAccessWiring.test.ts`

**Interfaces:**
- Consumes: `stripComments` z `@/lib/sourceTextTestUtils`.
- Produces: nic pro další úkoly.

- [ ] **Krok 1: Napiš padající strážný test**

Vytvoř `src/lib/reportAccessWiring.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test přístupu do reportů (etapa 2 září 2026, volba R1 = A).
 *
 * Modul `/reporty` drží na rolích SEDM míst a autorizaci reportů do téhle etapy
 * nehlídal ani jeden test. Middleware navíc `/api/report/attention` ani
 * `/api/report/health` vůbec nejmenuje — obě stojí čistě na `requireRole` uvnitř
 * routy. Rozpojené jedno místo se tedy neprojeví chybou, ale tím, že plánovači
 * funguje jen část stránky: karty se načtou a stavový pás mlčí.
 *
 * Sdílená konstanta rolí v projektu neexistuje (každý modul si pole opisuje) a
 * tahle etapa ten zvyk nemění — proto ten výčet hlídá test, ne typový systém.
 */
const middleware = stripComments(readFileSync("src/middleware.ts", "utf8"));
const page = stripComments(readFileSync("src/app/reporty/page.tsx", "utf8"));
const dashboard = stripComments(readFileSync("src/app/api/report/dashboard/route.ts", "utf8"));
const attention = stripComments(readFileSync("src/app/api/report/attention/route.ts", "utf8"));
const health = stripComments(readFileSync("src/app/api/report/health/route.ts", "utf8"));
const planner = stripComments(readFileSync("src/app/_components/PlannerPage.tsx", "utf8"));

const ROLES = String.raw`\["ADMIN",\s*"PLANOVAT"\]`;

test("middleware pouští do /reporty i /api/report/dashboard ADMIN i PLANOVAT", () => {
  assert.match(middleware, new RegExp(String.raw`startsWith\("/reporty"\)[\s\S]{0,200}?${ROLES}`));
  assert.match(middleware, new RegExp(String.raw`startsWith\("/api/report/dashboard"\)[\s\S]{0,200}?${ROLES}`));
  assert.doesNotMatch(middleware, /startsWith\("\/reporty"\)[\s\S]{0,200}?role !== "ADMIN"/);
  assert.doesNotMatch(middleware, /startsWith\("\/api\/report\/dashboard"\)[\s\S]{0,200}?role !== "ADMIN"/);
});

test("stránka /reporty má druhou vrstvu se stejným výčtem", () => {
  assert.match(page, new RegExp(String.raw`${ROLES}\.includes\(session\.role\)`));
  assert.doesNotMatch(page, /session\.role !== "ADMIN"/);
});

test("všechny tři reportové API pouštějí ADMIN i PLANOVAT", () => {
  assert.match(dashboard, new RegExp(String.raw`ALLOWED_ROLES = new Set\(${ROLES}\)`));
  assert.match(attention, new RegExp(String.raw`requireRole\(${ROLES}\)`));
  assert.match(health, new RegExp(String.raw`requireRole\(${ROLES}\)`));
});

test("odkaz Reporty v hlavičce planneru se řídí týmž výčtem", () => {
  assert.match(planner, new RegExp(String.raw`${ROLES}\.includes\(currentUser\.role\)[\s\S]{0,200}?href="/reporty"`));
  assert.doesNotMatch(planner, /currentUser\.role === "ADMIN"[\s\S]{0,200}?href="\/reporty"/);
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/reportAccessWiring.test.ts`
Expected: FAIL ve všech čtyřech testech — všude dnes stojí samotné `"ADMIN"`.

- [ ] **Krok 3: Přepiš middleware**

Nahraď v `src/middleware.ts` oba bloky (dnes ř. 60–72):

```ts
    // /reporty — ADMIN i PLANOVAT (etapa 2 září 2026, volba R1 = A: plánovač
    // musí vidět vytíženost strojů). Výčet je shodný s /admin o pár řádků výš.
    if (pathname.startsWith("/reporty") && !pathname.startsWith("/api/")) {
      if (!role || !["ADMIN", "PLANOVAT"].includes(role)) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }

    // /api/report/dashboard — ADMIN i PLANOVAT.
    //
    // POZOR: middleware NEJMENUJE `/api/report/attention` ani `/api/report/health`
    // — obě stojí čistě na `requireRole` uvnitř routy. Při změně rolí se musí měnit
    // VŠECHNA tři API společně, jinak plánovači funguje jen část stránky (karty se
    // načtou, stavový pás mlčí). Hlídá `src/lib/reportAccessWiring.test.ts`.
    if (pathname.startsWith("/api/report/dashboard")) {
      if (!role || !["ADMIN", "PLANOVAT"].includes(role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
```

- [ ] **Krok 4: Přepiš zbylých pět míst**

`src/app/reporty/page.tsx` — nahraď ř. 8:

```ts
  // Druhá vrstva vedle middleware, stejně jako u /admin (audit D-1).
  // ADMIN i PLANOVAT — etapa 2 září 2026, volba R1 = A.
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) redirect("/");
```

`src/app/api/report/dashboard/route.ts` — nahraď ř. 26:

```ts
/** Reporty vidí ADMIN i PLANOVAT (etapa 2 září 2026, volba R1 = A). */
const ALLOWED_ROLES = new Set(["ADMIN", "PLANOVAT"]);
```

`src/app/api/report/attention/route.ts` — nahraď ř. 47–48:

```ts
    // Reporty vidí ADMIN i PLANOVAT, shodně s /api/report/dashboard
    // a /api/report/health. Middleware tuhle cestu nejmenuje, takže je to
    // JEDINÁ ochrana — viz komentář u bloku dashboardu v `src/middleware.ts`.
    await requireRole(["ADMIN", "PLANOVAT"]);
```

`src/app/api/report/health/route.ts` — nahraď ř. 10:

```ts
    // Reporty vidí ADMIN i PLANOVAT, shodně s dashboardem a stavovým pásem.
    // Middleware tuhle cestu nejmenuje — je to JEDINÁ ochrana.
    await requireRole(["ADMIN", "PLANOVAT"]);
```

`src/app/_components/PlannerPage.tsx` — nahraď ř. 3432:

```ts
          {["ADMIN", "PLANOVAT"].includes(currentUser.role) && (
```

- [ ] **Krok 5: Doplň sloupec Reporty do CLAUDE.md**

Nahraď v `CLAUDE.md` tabulku „Role a přístup" (ř. 21–29):

```markdown
| Role | Planner | Rezervace | Admin | Reporty | Notifikace |
| --- | --- | --- | --- | --- | --- |
| `ADMIN` | plný edit | ano | plný | ano | audit + historie |
| `PLANOVAT` | plný edit | ano | omezený admin (číselníky/presety/prac. doba) | ano | audit + historie |
| `DTP` | edit DATA | ne | ne | ne | vlastní inbox |
| `MTZ` | edit MATERIÁL | ne | ne | ne | vlastní inbox |
| `OBCHODNIK` | read-only | vlastní rezervace | ne | ne | vlastní inbox |
| `TISKAR` | read-only + tisk (režim `isTiskar` na `/`) | ne | ne | ne | ne |
| `VIEWER` | read-only | ne | ne | ne | ne |
```

A pod tabulku, za dnešní řádek o modulu `/tiskar`, přidej:

```markdown
**Reporty (`/reporty`) drží na rolích SEDM míst** a tři reportová API se musí měnit
společně: middleware jmenuje jen `/reporty` a `/api/report/dashboard`, kdežto
`/api/report/attention` a `/api/report/health` stojí čistě na `requireRole` uvnitř
routy. Rozpojené jedno místo se neprojeví chybou, ale tím, že roli funguje jen část
stránky. Hlídá `src/lib/reportAccessWiring.test.ts`. Sloupec „Reporty" znamená celý
modul včetně Kontrolního panelu — `/report/daily` (tiskový přehled dne) je jiný modul
a vidí ho každá přihlášená role.
```

- [ ] **Krok 6: Spusť testy a build**

Run: `node --test --import tsx src/lib/reportAccessWiring.test.ts`
Expected: PASS, všechny čtyři testy zelené.

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: stejný počet selhání jako na začátku etapy.

Run: `npm run build`
Expected: úspěch.

- [ ] **Krok 7: Commit**

```bash
git add src/middleware.ts src/app/reporty/page.tsx src/app/api/report/dashboard/route.ts src/app/api/report/attention/route.ts src/app/api/report/health/route.ts src/app/_components/PlannerPage.tsx CLAUDE.md src/lib/reportAccessWiring.test.ts
git commit -m "$(cat <<'EOF'
feat(reporty): modul otevřený roli PLANOVAT na všech šesti serverových místech

Volba R1 = A. Middleware (2×), stránka, tři API routy a odkaz v hlavičce
planneru nově pouští ADMIN i PLANOVAT — týmž výčtem, jakým je dnes povolená
Správa. Nový strážný test reportAccessWiring hlídá všech šest míst i odkaz;
autorizaci reportů do téhle etapy nehlídal ani jeden test. CLAUDE.md dostal
chybějící sloupec Reporty.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Pojmenování obou definic vytížení

**Files:**
- Modify: `src/app/reporty/_components/KpiCard.tsx`
- Modify: `src/app/reporty/_components/RetroView.tsx` (JSDoc ř. 12–23, karty ř. 63–74)
- Modify: `src/app/reporty/_components/OutlookView.tsx` (JSDoc ř. 10–17 a 25–29, karty ř. 98–109, nadpis sekce a podtitulek heatmapy ř. 112–115)
- Modify: `src/app/reporty/_components/CalendarUseSection.tsx` (JSDoc ř. 215–227)
- Modify: `docs/vyvoj-historie.md` (konec souboru)

**Interfaces:**
- Consumes: `KpiCard` z `./KpiCard` (obě View ho už importují).
- Produces: `KpiCard` má novou volitelnou prop `note?: string` — třetí řádek karty pod podtitulkem.

- [ ] **Krok 1: Rozšiř `KpiCard` o `note`**

Nahraď v `src/app/reporty/_components/KpiCard.tsx` tělo komponenty (ř. 13–35):

```tsx
export function KpiCard({
  label,
  value,
  subtitle,
  note,
  color,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  /**
   * Věta, která říká, CO se do čísla počítá. Vznikla v etapě 2 (září 2026):
   * „Vytížení výrobou" a „Obsazenost směn" jsou dvě různé definice a bez popisku
   * je z názvu nepozná nikdo, kdo u jejich pojmenování nebyl. Nesmí nahradit
   * `subtitle` — ten u Výhledu nese hodiny volna a je jejich jediným nositelem
   * od etapy R3.
   */
  note?: string;
  color?: string;
}) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg,
      padding: `${reportSpace.md}px ${reportSpace.lg}px`, flex: "1 1 0",
    }}>
      <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      {/* `tabular-nums`: číslice mají stejnou šířku, takže hodnota při přepnutí období neposkakuje. */}
      <div style={{ fontSize: reportTypeScale.display, fontWeight: 700, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {subtitle && <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{subtitle}</div>}
      {/* Popisek je věta, ne číslo — `tabular-nums` by mu jen rozházel mezery. */}
      {note && <div style={{ fontSize: reportTypeScale.xs, color: "var(--text-muted)", marginTop: 2 }}>{note}</div>}
    </div>
  );
}
```

- [ ] **Krok 2: Přejmenuj karty Retrospektivy**

Nahraď v `src/app/reporty/_components/RetroView.tsx` obě karty vytížení (ř. 63–74, od `<KpiCard` po `/>` druhé karty):

```tsx
        <KpiCard
          label="Vytížení výrobou XL 105"
          value={xl105?.utilization == null ? "—" : `${xl105.utilization}%`}
          subtitle={`${cz(xl105?.productionHours ?? 0)} z ${cz(xl105?.availableHours ?? 0)} h dostupných`}
          note="jen zakázky, z hodin obsazených směn"
          color={utilizationColor(xl105?.utilization ?? null)}
        />
        <KpiCard
          label="Vytížení výrobou XL 106"
          value={xl106?.utilization == null ? "—" : `${xl106.utilization}%`}
          subtitle={`${cz(xl106?.productionHours ?? 0)} z ${cz(xl106?.availableHours ?? 0)} h dostupných`}
          note="jen zakázky, z hodin obsazených směn"
          color={utilizationColor(xl106?.utilization ?? null)}
        />
```

A nahraď JSDoc `utilizationColor` (ř. 12–23), protože dnes mluví o kartě „Kapacita", která se přejmenovala:

```tsx
/**
 * Barva hodnoty na kartě „Vytížení výrobou" — TŘI pásma, shodně s `capacityColor`
 * v záložce Výhled. Etapa R2 měla měnit barvy, ne meze.
 *
 * Navázat kartu na `heatToneFor` je svůdné a je to chyba: heatmapa má pásem
 * pět, protože rozlišuje „stroj nejede" od nuly a nevytížení od varování.
 * Karta by tím dostala dvě nová pásma, která na ní nikdy nebyla — stroj na
 * 42 % by z oranžové („pozor") přeskočil na modrošedou („nic se neděje") a
 * hlavně: karta „Obsazenost směn" v sousední záložce by týž stroj na týchž
 * 42 % barvila dál oranžově. Dvě karty dvou různých veličin, dvě barevné
 * stupnice podle záložky. Přesně ten rozpor, který etapa odstraňovala
 * u chipů typu bloku.
 *
 * Od etapy 2 (září 2026) nesou obě karty i popisek, CO se do nich počítá:
 * tady jen zakázky, ve Výhledu všechny typy uvnitř směn.
 */
```

- [ ] **Krok 3: Přejmenuj kartu, sekci a heatmapu Výhledu**

Nahraď v `src/app/reporty/_components/OutlookView.tsx` JSDoc `capacitySubtitle` (ř. 10–17, komentář nad `function capacitySubtitle`):

```tsx
/**
 * Podtitulek karty „Obsazenost směn" musí přiznat totéž co hodnota nad ním. Dokud se
 * řídil jen `freeHours ?? 0`, hlásila karta u stroje bez směn „—" a hned pod tím
 * „0 h volných“ — což se čte jako „stroj je plný". Táž ztráta rozdílu mezi „nevím"
 * a „nula", jakou etapa opravovala u procent, jen přenesená do hodin.
 *
 * Od R3 je tenhle podtitulek JEDINÝM nositelem hodin volna: samostatné karty
 * „Volné hod." byly duplicitou téhož čísla vedle téhož stroje. Věta o tom, CO se
 * do čísla počítá, proto jde do `note`, ne sem (etapa 2 září 2026).
 */
```

Nahraď JSDoc `capacityColor` (ř. 25–29) tak, aby jmenoval novou kartu:

```tsx
/**
 * Barva se řídí TÝMŽ signálem jako podtitulek (`overbookedHours`), ne zaokrouhleným
 * procentem. Jinak by při 100,4 % vyšel `Math.round` na 100, karta by svítila zeleně
 * a pod ní stálo „přeplánováno o 0,1 h". Meze jsou shodné s kartou „Vytížení výrobou"
 * v Retrospektivě (`utilizationColor`) — jsou to dvě různé veličiny, ale stejná
 * stupnice, aby týž stroj nesvítil na dvou záložkách jinak.
 */
```

Nahraď blok od `<KpiCard` po podtitulek heatmapy, tedy ř. 98–115 (dvě karty · `</div>` · komentář `{/* KAPACITA */}` · `SectionHeader` · otevírací `<div>` sekce · řádek „Heatmapa vytížení"):

```tsx
        <KpiCard
          label="Obsazenost směn XL 105"
          value={xl105?.plannedCapacity == null ? "—" : `${xl105.plannedCapacity}%`}
          subtitle={capacitySubtitle(xl105)}
          note="zakázky, rezervace i údržba uvnitř směn"
          color={capacityColor(xl105)}
        />
        <KpiCard
          label="Obsazenost směn XL 106"
          value={xl106?.plannedCapacity == null ? "—" : `${xl106.plannedCapacity}%`}
          subtitle={capacitySubtitle(xl106)}
          note="zakázky, rezervace i údržba uvnitř směn"
          color={capacityColor(xl106)}
        />
      </div>

      {/* OBSAZENOST SMĚN */}
      <SectionHeader label="OBSAZENOST SMĚN" />
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: reportRadius.lg, padding: reportSpace.md }}>
        {/* „Obsazenosti", ne „vytížení": vytížení je jméno té DRUHÉ definice
            (Retrospektiva, jen zakázky). Jedna mřížka se dvěma jmény na dvou
            záložkách je přesně ten zmatek, který etapa 2 odstraňovala. */}
        <div style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", marginBottom: 8 }}>Heatmapa obsazenosti</div>
```

- [ ] **Krok 4: Sjednoť komentář `CalendarUseSection`**

Nahraď v `src/app/reporty/_components/CalendarUseSection.tsx` JSDoc komponenty (ř. 215–227, komentář nad `export function CalendarUseSection`):

```tsx
/**
 * Sekce VYUŽITÍ KALENDÁŘE retrospektivy.
 *
 * Nesmí se jmenovat „OBSAZENOST SMĚN" — tak se od etapy 2 (září 2026) jmenuje
 * sekce ve **Výhledu** a znamená něco jiného (volné hodiny dopředu). Dvě
 * stejnojmenné sekce na dvou záložkách jsou přesně ten zmatek, který odstraňovala
 * etapa R3 a po ní pojmenování z etapy 2.
 *
 * Odpovídá na otázku, kterou karta „Vytížení výrobou" položit neumí: vytížení je
 * poměr naplánovaných hodin k OBSAZENÝM směnám, takže o kalendáři neříká nic. Stroj
 * na jednu směnu může mít vytížení 95 % a přitom stát tři čtvrtiny roku.
 *
 * Vlastní nadpis (`SectionHeader`) si drží volající — sekce vykresluje jen obsah.
 */
```

- [ ] **Krok 5: Ověř, že nikde nezůstal starý název**

Run:
```bash
grep -rn 'label="Vytížení XL\|label="Kapacita XL\|Heatmapa vytížení\|SectionHeader label="KAPACITA"' src/
```
Expected: žádný výstup.

Run: `npm run build`
Expected: úspěch.

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: stejný počet selhání jako na začátku etapy.

- [ ] **Krok 6: Zapiš etapu do `docs/vyvoj-historie.md`**

Přidej na konec souboru:

```markdown

## Reporty pro plánovače a poctivé vytížení (etapa 2 září 2026, 28. 9. 2026)

**Zadání.** Plánovač reporty nevidí (modul je jen pro ADMIN) a čísla v nich nejsou
důvěryhodná: „vytížení" znamená v každé záložce něco jiného a u strojů s noční či
víkendovou údržbou hlásí přeplánování i tam, kde je celá směna volná. Spec:
`docs/superpowers/specs/2026-09-16-reporty-pro-planovace-design.md`.

**Přístup.** `/reporty` a všechna tři reportová API pouští ADMIN i PLANOVAT (volba
R1 = A). Je to sedm míst: middleware 2×, stránka, `api/report/dashboard`,
`api/report/attention`, `api/report/health` a odkaz v hlavičce planneru. Middleware
`attention` ani `health` nejmenuje, takže obě stojí čistě na `requireRole` uvnitř
routy a musí se měnit společně — rozpojené jedno místo neshodí nic, jen roli funguje
část stránky. Hlídá `src/lib/reportAccessWiring.test.ts`; do téhle etapy autorizaci
reportů nehlídal žádný test. `plannerActivity` v odpovědi zůstává beze změny
(rozhodnutí Vojty 16. 9. 2026): plánovači si ho zobrazí v nástrojích prohlížeče,
rozhodnutí z R3 platilo pro vzhled stránky, ne pro data.

**Poctivý čitatel.** Obsazené směny mají jeden zdroj — `staffedIntervals`
(`src/lib/reportMetrics.ts`). `computeAvailableHours` je nově jen jeho součet
(`totalHours`), takže jmenovatel a čitatel stojí na týchž intervalech a nemohou se
rozejít. Rigidní blok se počítá `staffedOverlapMinutes`, tedy průnikem s obsazenými
směnami; rozhodnutí „segmenty, nebo ořez na směny" má jedno jméno `occupiedMinutes`
a používají ho všechny tři agregace. Výhled i stavový pás se zároveň přepnuly
z `b.type === "ZAKAZKA"` na `usesTiskoveHodiny`, takže IML zadané jako rezervace
s tiskovými minutami se konečně počítá tiskovým časem. Zapojení hlídá
`src/lib/reportNumeratorWiring.test.ts`. `printOverlapMinutes` zůstalo nedotčené —
je to obecný nástroj a jinde je hrubý span správně.

**Dopad na čísla.** Klesla obsazenost ve Výhledu, heatmapa, stavový pás a „Podíl
údržby" u strojů s noční či víkendovou údržbou a s legacy rezervacemi mimo směny;
falešné „přeplánováno o X h" u prázdné směny zmizelo. Vytížení výrobou se změnilo
jen u odložených (`scheduleBypassed`) a rozejitých bloků — zakázka zaparkovaná přes
víkend přestala vytížení nafukovat. Modelový příklad: stroj s jedinou ranní směnou
6–14 a osmihodinovou noční údržbou hlásil „100 %, 0 h volných" a po přidání jedné
hodiny „113 %, přeplánováno o 1 h"; nově 13 % a 7 h volných. Poměry se dál
nezastropují — skutečné přeplánování uvnitř směn musí být vidět (P22).

**Pojmenování.** Retrospektiva má kartu „Vytížení výrobou", Výhled „Obsazenost
směn" (sekce i heatmapa stejně), obě s popiskem, co se do nich počítá. `KpiCard`
kvůli tomu dostala volitelnou prop `note` — podtitulek se nesměl obětovat, u Výhledu
je od R3 jediným nositelem hodin volna.

**Vědomý kompromis:** rozpis tiskařů jako zdroj kapacity (R3 = A) je až po
31. 10. 2026, takže „obsazené směny" znamená dál rozvrh `MachineWeekShifts`, ne
skutečně přítomné lidi.
```

- [ ] **Krok 7: Commit**

```bash
git add src/app/reporty/_components/KpiCard.tsx src/app/reporty/_components/RetroView.tsx src/app/reporty/_components/OutlookView.tsx src/app/reporty/_components/CalendarUseSection.tsx docs/vyvoj-historie.md
git commit -m "$(cat <<'EOF'
feat(reporty): Vytížení výrobou vs. Obsazenost směn — dvě definice, dvě jména

Retrospektiva má kartu „Vytížení výrobou" (jen zakázky), Výhled „Obsazenost
směn" (zakázky, rezervace i údržba uvnitř směn) — sekce i heatmapa stejně.
KpiCard dostala volitelnou prop note; podtitulek zůstává, u Výhledu je od R3
jediným nositelem hodin volna. Komentáře, které jmenovaly staré názvy, jsou
přepsané (P19). docs/vyvoj-historie.md má záznam etapy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Po dokončení všech úkolů

1. **Celá suite a build naposledy:**
   ```bash
   node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
   npm run build
   npm run lint
   ```
2. **Proklik na dev serveru (port 3001) za roli PLANOVAT i ADMIN**: odkaz „Reporty" v hlavičce, obě záložky, Kontrolní panel (stavový pás musí odpovídat, ne mlčet), heatmapa proti kartě nad ní. Metoda viz paměť `screenshot_bezici_appky`.
3. **Neasazovat samo.** Etapa jde na test 3021 **až se všemi ostatními etapami naráz** (rozhodnutí Vojty 16. 9. 2026), produkce potom taky naráz, přes větev `michal`, s `mysqldump` zálohou a PRE/POST otiskem `sum_secs`.
4. **Říct Lukášovi a tiskařům dopředu, že čísla klesnou.** Je to oprava, ne regrese — ale bez slova to vypadá jako rozbitý report (spec, riziko 1).
5. **Superpowers:finishing-a-development-branch** až po Vojtově prokliku, ne dřív.
