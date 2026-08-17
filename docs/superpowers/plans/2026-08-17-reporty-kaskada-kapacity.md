# Reporty R4a — Kaskáda kapacity · implementační plán

> **Pro agentní pracovníky:** POVINNÁ SUB-SKILL: `superpowers:subagent-driven-development`. Kroky mají `- [ ]` pro sledování.

**Cíl:** Report poprvé odpoví na otázku „chybí nám stroj, nebo chybí nám směna?"

**Architektura:** Čistá funkce nad intervalovou algebrou v `reportMetrics.ts`; route jen dodá vstupy a UI vykreslí. Žádné existující číslo se nemění — kaskáda používá funkce, které report už volá.

**Tech stack:** TypeScript · React · Prisma · `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-08-17-reporty-kaskada-kapacity-design.md`
**Podklad:** `docs/audits/2026-08-16-reporty-pruzkum-metrik.md`, kap. 5.4

---

## Globální omezení

Platí pro **každý** task:

- **NESPOUŠTĚT `npm run build` ani dev server.** Vojta má běžící instance na portech 3000 a 3111, které sdílejí `.next`. Ověřuj přes `npx tsc --noEmit`, `npx eslint` a testy.
- **Commitovat jen vyjmenované soubory** (`git add <cesta>`), **nikdy `git add -A`.**
- Commit message ukonči `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Žádné existující číslo se nesmí změnit.** Kaskáda přidává sekci; karta „Vytížení" a všechno ostatní zůstává beze změny.
- **Barvy jen přes tokeny, velikosti přes `reportTypeScale` / `reportRadius` / `reportSpace`.** Hlídá `src/lib/reportTokens.test.ts` — a jeho detektor od R3 chytá i hodnoty v uvozovkách.
- Celá sada testů:
  ```bash
  node --experimental-test-module-mocks --test --import tsx \
    src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
- Výchozí stav: **1222 testů zelených**, `tsc --noEmit` čistý, pracovní strom čistý.

---

## Klíčové rozhodnutí, které plán zavádí

**Rozpad nevyužitého kalendáře se počítá INTERVALOVOU ALGEBROU, ne po dnech.**
`CompanyDay.startDate` / `endDate` jsou `DateTime`, takže odstávka může být částečná
(ověřeno v `prisma/schema.prisma:175-182`). Denní granularita by u půldenní odstávky
lhala.

**Každá nevyužitá hodina se přiřadí právě jedné příčině**, v pořadí od nejméně
získatelné po nejvíc:

1. **víkend** — sobota a neděle; vrátit se dá jen zavedením víkendového provozu
2. **odstávka** — zbytek hodin uvnitř `CompanyDay`; datované, plánované zavření
3. **neobsazená směna** — **zbytek**, tedy pracovní dny, kdy směna neběží

Pořadí je podstatné, protože hodina může mít víc příčin naráz (sobotní odstávka je
obojí). Třetí kbelík je **reziduum** a právě proto je to to číslo, které jde zvednout
bez otevírání víkendů a bez rušení odstávek.

---

## Struktura souborů

| Soubor | Odpovědnost |
| --- | --- |
| `src/lib/intervals.ts` | **nový** — `mergeIntervals`, `intersectIntervals`, `subtractIntervals`, `totalHours` |
| `src/lib/intervals.test.ts` | **nový** |
| `src/lib/reportMetrics.ts` | `computeCalendarCascade` + přechod na sdílené `intervals.ts` |
| `src/lib/reportMetrics.test.ts` | testy kaskády |
| `src/app/api/report/dashboard/route.ts` | `cascade` do retro odpovědi |
| `src/app/reporty/_components/reportShared.tsx` | typ `CalendarCascade` v `RetroData` |
| `src/app/reporty/_components/CalendarUseSection.tsx` | **nový** — vykreslení |
| `src/app/reporty/_components/RetroView.tsx` | zapojení sekce |

---

## Task 1: Intervalová algebra

`reportMetrics.ts` má dnes **privátní** `mergeIntervals` (ř. 55). Kaskáda potřebuje
navíc průnik a rozdíl. Vytáhne se do vlastního modulu, ať to jde otestovat samostatně
a ať se logika nekopíruje.

**Soubory:**
- Vytvořit: `src/lib/intervals.ts`
- Test: `src/lib/intervals.test.ts`
- Upravit: `src/lib/reportMetrics.ts` (import místo lokální kopie)

**Rozhraní:**
- Poskytuje (Task 2):
  - `type Interval = { start: number; end: number }` — UTC ms, polootevřený `[start, end)`
  - `mergeIntervals(list: Interval[]): Interval[]` — seřazené, sloučené, bez prázdných
  - `intersectIntervals(a: Interval[], b: Interval[]): Interval[]`
  - `subtractIntervals(from: Interval[], minus: Interval[]): Interval[]`
  - `totalHours(list: Interval[]): number`

- [ ] **Krok 1: Napsat padající test**

Vytvoř `src/lib/intervals.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeIntervals, intersectIntervals, subtractIntervals, totalHours, type Interval,
} from "./intervals";

/** Čitelný zápis — hodiny místo milisekund. */
const iv = (startH: number, endH: number): Interval => ({ start: startH * 3_600_000, end: endH * 3_600_000 });
const hours = (list: Interval[]) => list.map((i) => [i.start / 3_600_000, i.end / 3_600_000]);

describe("intervals — merge", () => {
  it("slučuje překryvy i dotyky a řadí", () => {
    assert.deepEqual(hours(mergeIntervals([iv(5, 8), iv(1, 3), iv(2, 6)])), [[1, 8]]);
    assert.deepEqual(hours(mergeIntervals([iv(0, 2), iv(2, 4)])), [[0, 4]], "dotyk se slučuje");
    assert.deepEqual(hours(mergeIntervals([iv(0, 2), iv(3, 4)])), [[0, 2], [3, 4]], "mezera zůstane");
  });

  it("zahazuje prázdné a obrácené", () => {
    assert.deepEqual(hours(mergeIntervals([iv(3, 3), iv(5, 4)])), []);
  });

  it("prázdný vstup dá prázdný výstup", () => {
    assert.deepEqual(mergeIntervals([]), []);
  });
});

describe("intervals — průnik", () => {
  it("vrací jen společnou část", () => {
    assert.deepEqual(hours(intersectIntervals([iv(0, 10)], [iv(3, 5), iv(7, 12)])), [[3, 5], [7, 10]]);
  });

  it("bez překryvu je prázdný", () => {
    assert.deepEqual(intersectIntervals([iv(0, 2)], [iv(5, 8)]), []);
  });

  it("dotyk NENÍ průnik — intervaly jsou polootevřené", () => {
    assert.deepEqual(intersectIntervals([iv(0, 3)], [iv(3, 6)]), []);
  });

  it("je komutativní", () => {
    const a = [iv(0, 5), iv(8, 12)], b = [iv(3, 9)];
    assert.deepEqual(hours(intersectIntervals(a, b)), hours(intersectIntervals(b, a)));
  });
});

describe("intervals — rozdíl", () => {
  it("vyřízne prostředek", () => {
    assert.deepEqual(hours(subtractIntervals([iv(0, 10)], [iv(3, 6)])), [[0, 3], [6, 10]]);
  });

  it("odečtení celku nezanechá nic", () => {
    assert.deepEqual(subtractIntervals([iv(2, 5)], [iv(0, 9)]), []);
  });

  it("odečtení mimo rozsah nemění nic", () => {
    assert.deepEqual(hours(subtractIntervals([iv(0, 3)], [iv(5, 9)])), [[0, 3]]);
  });

  it("odečítaný seznam se nemusí překrývat ani řadit", () => {
    assert.deepEqual(hours(subtractIntervals([iv(0, 10)], [iv(6, 8), iv(1, 2), iv(7, 9)])), [[0, 1], [2, 6], [9, 10]]);
  });
});

describe("intervals — součet", () => {
  it("sčítá délky v hodinách", () => {
    assert.equal(totalHours([iv(0, 2), iv(5, 8)]), 5);
  });

  it("NEodečítá překryvy — vstup se musí sloučit předem", () => {
    // Záměrná past: `totalHours` je hloupý součet. Volající, který si zapomene
    // vstup projet `mergeIntervals`, dostane dvojnásobek — a přesně tahle vada
    // v R1 nafoukla dostupné hodiny nepřetržitého stroje ze 168 na 182 týdně.
    assert.equal(totalHours([iv(0, 5), iv(3, 8)]), 10);
    assert.equal(totalHours(mergeIntervals([iv(0, 5), iv(3, 8)])), 8);
  });

  it("prázdný seznam dá nulu", () => {
    assert.equal(totalHours([]), 0);
  });
});
```

- [ ] **Krok 2: Spustit test, ověřit že padá**

```bash
node --test --import tsx src/lib/intervals.test.ts
```
Čekej: FAIL — `Cannot find module './intervals'`.

- [ ] **Krok 3: Napsat modul**

```typescript
/**
 * Intervalová algebra nad UTC milisekundami.
 *
 * Intervaly jsou POLOOTEVŘENÉ `[start, end)`: konec jednoho a začátek druhého se
 * dotýkají, ale nepřekrývají. Bez toho by se sousední směny počítaly s jednou
 * milisekundou navíc a hlavně by `intersectIntervals` hlásila průnik tam, kde
 * žádný není.
 *
 * `mergeIntervals` sem přišel z `reportMetrics.ts`, kde byl privátní. Kaskáda
 * kapacity potřebuje navíc průnik a rozdíl, a kopírovat tuhle logiku podruhé je
 * cesta k tomu, aby se obě verze rozešly.
 */
export type Interval = { start: number; end: number };

/** Seřadí, sloučí překryvy i dotyky, zahodí prázdné a obrácené. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const clean = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of clean) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push({ ...cur });
  }
  return out;
}

/** Společná část dvou seznamů. Vstupy se slučují, takže nemusí být seřazené. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const start = Math.max(A[i].start, B[j].start);
    const end = Math.min(A[i].end, B[j].end);
    if (end > start) out.push({ start, end });
    if (A[i].end < B[j].end) i++;
    else j++;
  }
  return out;
}

/** `from` bez částí, které pokrývá `minus`. */
export function subtractIntervals(from: Interval[], minus: Interval[]): Interval[] {
  const cuts = mergeIntervals(minus);
  const out: Interval[] = [];
  for (const base of mergeIntervals(from)) {
    let cursor = base.start;
    for (const cut of cuts) {
      if (cut.end <= cursor) continue;
      if (cut.start >= base.end) break;
      if (cut.start > cursor) out.push({ start: cursor, end: Math.min(cut.start, base.end) });
      cursor = Math.max(cursor, cut.end);
      if (cursor >= base.end) break;
    }
    if (cursor < base.end) out.push({ start: cursor, end: base.end });
  }
  return out;
}

/**
 * Součet délek v hodinách. HLOUPÝ — překryvy neodečítá.
 *
 * Vstup se musí předem projet `mergeIntervals`. Přesně tenhle krok se v R1
 * zapomněl u směn a nepřetržitý stroj měl 182 dostupných hodin týdně místo 168.
 */
export function totalHours(list: Interval[]): number {
  return list.reduce((sum, i) => sum + (i.end - i.start), 0) / 3_600_000;
}
```

- [ ] **Krok 4: Přepojit `reportMetrics.ts` na sdílený modul**

Smaž lokální `mergeIntervals` (ř. 55) a `type Interval` (ř. 17), importuj z `./intervals`.
**Nic jiného v tom souboru neměň.**

- [ ] **Krok 5: Ověřit**

```bash
node --test --import tsx src/lib/intervals.test.ts src/lib/reportMetrics.test.ts
npx tsc --noEmit
```
Čekej: obojí zelené. **`reportMetrics.test.ts` musí projít beze změny** — je to důkaz, že přepojení nic nezměnilo.

- [ ] **Krok 6: Commit**

```bash
git add src/lib/intervals.ts src/lib/intervals.test.ts src/lib/reportMetrics.ts
git commit -m "refactor(lib): intervalová algebra do sdíleného modulu"
```

---

## Task 2: `computeCalendarCascade`

**Soubory:**
- Upravit: `src/lib/reportMetrics.ts`
- Test: `src/lib/reportMetrics.test.ts`

**Rozhraní:**
- Konzumuje: `intervals.ts` (Task 1), `companyDayIntervalsFor`, `shiftIntervalsForDay`
- Poskytuje (Task 3):

```typescript
export type CalendarCascade = {
  calendarHours: number;
  staffedHours: number;
  plannedHours: number;
  confirmedHours: number;
  /** Podíl potvrzených na naplánovaných. `null` když se nic neplánovalo. */
  confirmedShareOfPlanned: number | null;
  unused: { total: number; weekend: number; shutdown: number; unstaffedShift: number };
};

export function computeCalendarCascade(args: {
  machine: string;
  rangeStart: string;
  rangeEnd: string;
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayRow[];
  plannedHours: number;
  confirmedHours: number;
}): CalendarCascade;
```

> **`plannedHours` a `confirmedHours` se PŘEDÁVAJÍ, nepočítají.** Route je už má
> spočítané přes `segMap` a `printOverlapMinutes`; kdyby si je kaskáda počítala sama,
> vznikly by dvě cesty k témuž číslu a rozešly by se. Táž zásada, jakou drží
> `heatToneFor` sdílený mřížkou i legendou.

- [ ] **Krok 1: Napsat padající test**

Do `src/lib/reportMetrics.test.ts` přidej:

```typescript
describe("computeCalendarCascade", () => {
  /** Stroj jede Po–Pá ranní 6–14, víkend vypnutý. */
  const weekdayMornings = (weekStart: string) => ({
    machine: "XL_105", weekStart,
    monMorningOn: true, monAfternoonOn: false, monNightOn: false,
    tueMorningOn: true, tueAfternoonOn: false, tueNightOn: false,
    wedMorningOn: true, wedAfternoonOn: false, wedNightOn: false,
    thuMorningOn: true, thuAfternoonOn: false, thuNightOn: false,
    friMorningOn: true, friAfternoonOn: false, friNightOn: false,
    satMorningOn: false, satAfternoonOn: false, satNightOn: false,
    sunMorningOn: false, sunAfternoonOn: false, sunNightOn: false,
  });

  it("čtyři kroky klesají a rozpad nevyužitého dá dohromady zbytek", () => {
    // Po 17. 8. – Ne 23. 8. 2026 = 7 dní = 168 h kalendáře.
    // Pracovní dny 5 × 8 h ranní = 40 h obsazeno.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: [weekdayMornings("2026-08-17")], companyDays: [],
      plannedHours: 32, confirmedHours: 24,
    });
    assert.equal(c.calendarHours, 168);
    assert.equal(c.staffedHours, 40);
    assert.equal(c.plannedHours, 32);
    assert.equal(c.confirmedHours, 24);
    assert.equal(c.unused.total, 128);
    // Rozpad MUSÍ sedět na součet — jinak se hodiny někde ztrácejí.
    assert.equal(
      c.unused.weekend + c.unused.shutdown + c.unused.unstaffedShift,
      c.unused.total,
    );
  });

  it("víkend a neobsazené směny se rozliší", () => {
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: [weekdayMornings("2026-08-17")], companyDays: [],
      plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.unused.weekend, 48, "So + Ne = 2 × 24 h");
    assert.equal(c.unused.shutdown, 0);
    assert.equal(c.unused.unstaffedShift, 80, "5 pracovních dní × 16 neobsazených hodin");
  });

  it("odstávka v pracovní den se počítá jako odstávka, ne jako neobsazená směna", () => {
    // Středa 19. 8. celá zavřená → z 8 h ranní směny se stane odstávka.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: [weekdayMornings("2026-08-17")],
      companyDays: [{ startDate: "2026-08-19T00:00:00.000Z", endDate: "2026-08-20T00:00:00.000Z" }],
      plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.staffedHours, 32, "středeční směna vypadla");
    assert.ok(c.unused.shutdown > 0, "odstávka musí být vidět");
    assert.equal(c.unused.weekend + c.unused.shutdown + c.unused.unstaffedShift, c.unused.total);
  });

  it("VÍKENDOVÁ odstávka se počítá jako víkend, ne jako odstávka", () => {
    // Pořadí příčin je od nejméně získatelné: sobota, kdy stroj stejně nejede,
    // se zavřením závodu neztratí nic. Kdyby vyhrála odstávka, číslo
    // „kolik nás stály odstávky" by se nafouklo o hodiny, které nikdy nešly využít.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: [weekdayMornings("2026-08-17")],
      companyDays: [{ startDate: "2026-08-22T00:00:00.000Z", endDate: "2026-08-23T00:00:00.000Z" }],
      plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.unused.shutdown, 0, "sobotní odstávka nic nestojí");
    assert.equal(c.unused.weekend, 48);
  });

  it("částečná odstávka se počítá po hodinách, ne po celých dnech", () => {
    // CompanyDay je DateTime, ne datum — půldenní zavření musí projít.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-17",
      weekShifts: [weekdayMornings("2026-08-17")],
      companyDays: [{ startDate: "2026-08-17T04:00:00.000Z", endDate: "2026-08-17T08:00:00.000Z" }],
      plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.calendarHours, 24);
    assert.ok(c.staffedHours > 0 && c.staffedHours < 8, `půl směny zbýt musí, je ${c.staffedHours}`);
  });

  it("podíl potvrzených je z NAPLÁNOVANÝCH, ne z kalendáře", () => {
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: [weekdayMornings("2026-08-17")], companyDays: [],
      plannedHours: 40, confirmedHours: 10,
    });
    assert.equal(c.confirmedShareOfPlanned, 25);
  });

  it("bez naplánovaných hodin je podíl null, ne nula", () => {
    // Nula by se četla jako „tiskaři nic nepotvrdili", což je něco jiného než
    // „nebylo co potvrzovat". Týž rozdíl jako u computeUtilization.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: [weekdayMornings("2026-08-17")], companyDays: [],
      plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.confirmedShareOfPlanned, null);
  });

  it("stroj bez jediného řádku směn má nula obsazených a všechno v neobsazených", () => {
    // Nastane u týdne, který nikdo neotevřel v administraci (lazy seeding).
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: [], companyDays: [], plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.staffedHours, 0);
    assert.equal(c.unused.total, 168);
    assert.equal(c.unused.weekend + c.unused.shutdown + c.unused.unstaffedShift, 168);
  });

  it("přechod na letní čas nezmizí ani nepřebývá", () => {
    // 25. 10. 2026 je návrat na zimní čas — ten den má 25 hodin.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-10-25", rangeEnd: "2026-10-25",
      weekShifts: [], companyDays: [], plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.calendarHours, 25, "kalendář musí být skutečný uplynulý čas, ne 24");
  });
});
```

- [ ] **Krok 2: Spustit, ověřit že padá**

```bash
node --test --import tsx src/lib/reportMetrics.test.ts
```
Čekej: FAIL — `computeCalendarCascade is not a function`.

- [ ] **Krok 3: Implementovat**

Do `reportMetrics.ts`, vedle `computeAvailableHours`:

```typescript
export type CalendarCascade = {
  calendarHours: number;
  staffedHours: number;
  plannedHours: number;
  confirmedHours: number;
  confirmedShareOfPlanned: number | null;
  unused: { total: number; weekend: number; shutdown: number; unstaffedShift: number };
};

/**
 * Kaskáda kalendář → obsazeno směnami → naplánováno → potvrzeno tiskařem.
 *
 * Odpovídá na otázku, kterou dnešní „vytížení" položit neumí: **jakou část
 * kalendáře vůbec obsazujeme lidmi.** Vytížení je poměr třetího kroku ke
 * druhému, takže o prvním nic neříká — stroj na jednu směnu může mít vytížení
 * 95 % a přitom stát tři čtvrtiny roku.
 *
 * `plannedHours` a `confirmedHours` se PŘEDÁVAJÍ, nepočítají. Route je má
 * spočítané přes `segMap` a `printOverlapMinutes`; druhá cesta k témuž číslu
 * by se dřív nebo později rozešla.
 */
export function computeCalendarCascade(args: {
  machine: string;
  rangeStart: string;
  rangeEnd: string;
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayRow[];
  plannedHours: number;
  confirmedHours: number;
}): CalendarCascade {
  const { machine, rangeStart, rangeEnd, weekShifts, companyDays } = args;

  // Kalendář jako SKUTEČNÝ uplynulý čas, ne dny × 24 — jinak by den přechodu
  // na zimní čas (25 h) vyšel o hodinu kratší a součet rozpadu by nesouhlasil.
  const periodStart = pragueMinuteToUtcMs(rangeStart, 0);
  const periodEnd = pragueMinuteToUtcMs(addDaysToCivilDate(rangeEnd, 1), 0);
  const period: Interval[] = [{ start: periodStart, end: periodEnd }];
  const calendarHours = totalHours(period);

  const staffedHours = computeAvailableHours(machine, rangeStart, rangeEnd, weekShifts, companyDays);

  // Nevyužitý kalendář = období minus obsazené směny. Obsazené intervaly se
  // skládají znovu (ne přes `computeAvailableHours`, která vrací jen součet),
  // protože rozpad potřebuje vědět KDE ty hodiny leží, ne kolik jich je.
  const rawShifts: Interval[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDaysToCivilDate(d, 1)) {
    const row = weekShifts.find((w) => w.machine === machine && w.weekStart === weekStartStrFromDateStr(d));
    if (row) rawShifts.push(...shiftIntervalsForDay(row, d));
  }
  const shutdowns = mergeIntervals(
    companyDayIntervalsFor(machine, companyDays).map((i) => ({
      start: i.start.getTime(), end: i.end.getTime(),
    })),
  );
  const staffed = subtractIntervals(intersectIntervals(mergeIntervals(rawShifts), period), shutdowns);
  const unusedIntervals = subtractIntervals(period, staffed);

  // Víkendy jako intervaly — soboty a neděle podle PRAŽSKÉHO data.
  const weekends: Interval[] = [];
  for (let d = rangeStart; d <= rangeEnd; d = addDaysToCivilDate(d, 1)) {
    const dow = new Date(`${d}T12:00:00.000Z`).getUTCDay();
    if (dow === 0 || dow === 6) {
      weekends.push({ start: pragueMinuteToUtcMs(d, 0), end: pragueMinuteToUtcMs(addDaysToCivilDate(d, 1), 0) });
    }
  }

  /*
   * Každá nevyužitá hodina patří PRÁVĚ JEDNÉ příčině, v pořadí od nejméně
   * získatelné po nejvíc. Sobotní odstávka je obojí naráz — a musí se počítat
   * jako víkend, protože zavřením závodu v sobotu, kdy stroj stejně nejede,
   * se neztratí nic. Kdyby vyhrála odstávka, číslo „kolik nás stály odstávky"
   * by se nafouklo o hodiny, které nikdy nešly využít.
   *
   * Třetí kbelík je REZIDUUM. Právě proto je to to číslo, které jde zvednout
   * bez otevírání víkendů a bez rušení odstávek.
   */
  const weekendPart = intersectIntervals(unusedIntervals, weekends);
  const afterWeekend = subtractIntervals(unusedIntervals, weekends);
  const shutdownPart = intersectIntervals(afterWeekend, shutdowns);
  const unstaffedPart = subtractIntervals(afterWeekend, shutdowns);

  return {
    calendarHours,
    staffedHours,
    plannedHours: args.plannedHours,
    confirmedHours: args.confirmedHours,
    confirmedShareOfPlanned:
      args.plannedHours > 0 ? Math.round((args.confirmedHours / args.plannedHours) * 100) : null,
    unused: {
      total: totalHours(unusedIntervals),
      weekend: totalHours(weekendPart),
      shutdown: totalHours(shutdownPart),
      unstaffedShift: totalHours(unstaffedPart),
    },
  };
}
```

> **Ověř před psaním:** `pragueMinuteToUtcMs`, `shiftIntervalsForDay` a
> `weekStartStrFromDateStr` jsou v `reportMetrics.ts` privátní nebo importované —
> zkontroluj skutečné názvy a signatury. Když se liší, **uprav kód podle skutečnosti.**

- [ ] **Krok 4: Ověřit**

```bash
node --test --import tsx src/lib/reportMetrics.test.ts src/lib/intervals.test.ts
npx tsc --noEmit
```

**Když padne test „rozpad dá dohromady zbytek", NEUPRAVUJ očekávání** — znamená to,
že se hodiny někde ztrácejí nebo počítají dvakrát, a to je přesně vada, kterou má
ten test chytat.

- [ ] **Krok 5: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "feat(reporty): kaskáda kalendáře — kolik z něj vůbec obsazujeme"
```

---

## Task 3: Zapojení do API

**Soubory:**
- Upravit: `src/app/api/report/dashboard/route.ts`
- Upravit: `src/app/reporty/_components/reportShared.tsx`

- [ ] **Krok 1: Spočítat potvrzené hodiny a kaskádu**

V retro režimu, vedle existujícího `productionHours`, přidej:

```typescript
// Potvrzené hodiny = TÝŽ výpočet jako produkční, jen přes bloky, u kterých
// tiskař klepl HOTOVO. Nesmí to být jiná cesta k témuž číslu — sdílí `clippedHours`.
const confirmedHours = blockInputs
  .filter((b) => b.machine === machine && b.type === "ZAKAZKA" && b.printCompletedAt != null)
  .reduce((s, b) => s + clippedHours(b), 0);

const cascade = computeCalendarCascade({
  machine, rangeStart, rangeEnd, weekShifts, companyDays,
  plannedHours: productionHours,
  confirmedHours,
});
```

Do `machines[machine]` přidej `cascade`. **Nic existujícího neměň.**

- [ ] **Krok 2: Ověřit, že `printCompletedAt` je v `select`**

```bash
grep -n 'printCompletedAt' src/app/api/report/dashboard/route.ts
```
Když v `select` pro `blockInputs` chybí, **doplň ho** — jinak bude `undefined`
a `tsc` to nechytí, protože Prisma typuje podle `select`. Táž past, na kterou
narazil Task 6 v R3.

- [ ] **Krok 3: Typ na klientovi**

Do `RetroMachineData` v `reportShared.tsx` přidej `cascade: CalendarCascade`
(typ re-exportuj z `@/lib/reportMetrics`).

- [ ] **Krok 4: Ověřit**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts
```

- [ ] **Krok 5: Commit**

```bash
git add src/app/api/report/dashboard/route.ts src/app/reporty/_components/reportShared.tsx
git commit -m "feat(reporty): kaskáda kalendáře v odpovědi retro režimu"
```

---

## Task 4: Sekce VYUŽITÍ KALENDÁŘE

**Soubory:**
- Vytvořit: `src/app/reporty/_components/CalendarUseSection.tsx`
- Upravit: `src/app/reporty/_components/RetroView.tsx`

- [ ] **Krok 1: Komponenta**

Named export, tokeny, škály. Na stroj čtyři vodorovné pásy s podílem kalendáře
a pod nimi řádek rozpadu. Podle vizuálu ve specu §4:

- **kalendář** — plná šířka, `--surface-3`
- **obsazeno směnami** — `--series-a`
- **naplánováno** — `--status-warn`
- **potvrzeno tiskařem** — `--status-ok`, vpravo `· {confirmedShareOfPlanned} % naplánovaných`
  (nebo `— nebylo co potvrzovat`, když je `null`)
- řádek rozpadu: `nevyužitý kalendář {total} h = víkendy {weekend} h · odstávky {shutdown} h · neobsazené směny {unstaffedShift} h`

**Hodiny přes `cz()`** (desetinná čárka), **procenta zaokrouhlená na celá**.

- [ ] **Krok 2: Krátké období**

Sekce se nekreslí pro období kratší než 7 dní — místo ní věta:

```
Využití kalendáře se počítá od období delšího než týden.
```

Důvod: u „Dnes" je kalendář 24 h a kaskáda nedává smysl. Bez téhle věty by sekce
při přepnutí na „Dnes" beze slova zmizela, což se čte jako chyba.

- [ ] **Krok 3: Zapojit do `RetroView`**

Pod sekci VÝROBA, vlastní `SectionHeader` s popiskem **`VYUŽITÍ KALENDÁŘE`**.
**Ne „KAPACITA"** — tak se jmenuje sekce ve Výhledu a znamená něco jiného.

- [ ] **Krok 4: Závěrečná kontrola**

```bash
grep -rn '#[0-9a-fA-F]\{3,8\}\b\|rgba\?(' src/app/reporty/ src/components/report/
grep -rn 'fontSize: [0-9]\|borderRadius: [0-9]\|padding: [0-9]' src/app/reporty/ src/components/report/
npx eslint src/app/reporty/ src/components/report/
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Čekej: grepy nic, eslint bez `max-lines`, `tsc` čistý, **všechny testy zelené**
(1222 + nové z Tasků 1 a 2).

- [ ] **Krok 5: Commit**

```bash
git add src/app/reporty/_components/CalendarUseSection.tsx src/app/reporty/_components/RetroView.tsx
git commit -m "feat(reporty): sekce Využití kalendáře"
```

---

## Kontrola na závěr (dělá orchestrátor)

1. **Multi-agent review** — zvlášť na to, jestli rozpad nevyužitého kalendáře sedí
   na součet ve všech kombinacích (víkendová odstávka, částečná odstávka, přechod
   času, chybějící řádek směn).
2. **Doplnit `docs/vyvoj-historie.md`** o sekci R4a.
3. **Před nasazením ověřit pokrytí `MachineWeekShifts` na produkci** — týden bez
   řádku vypadá jako nulová kapacita a v kaskádě by se ukázal jako „neobsazené
   směny", přestože jde jen o nevyplněný rozvrh. Dotaz je ve specu §6.
