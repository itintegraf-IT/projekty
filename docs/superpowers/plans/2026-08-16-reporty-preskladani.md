# Reporty R3 — Přeskládání stránky · implementační plán

> **Pro agentní pracovníky:** POVINNÁ SUB-SKILL: `superpowers:subagent-driven-development`. Kroky mají `- [ ]` pro sledování.

**Cíl:** `/reporty` poprvé odpoví na otázku „musím dnes něco řešit?" — a přestane tiše zamlčovat data.

**Architektura:** Nový stavový pás nad záložkami, živený vlastním endpointem nezávislým na zvoleném období. Věty skládá čistý modul sdílený serverem i klientem. Karty se přeskupují k tomu, čeho se týkají; duplicity mizí; heatmapa pokryje celé období.

**Tech stack:** Next.js 16 App Router · TypeScript · React · Prisma · `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-08-16-reporty-preskladani-design.md`
**Podklad k R4:** `docs/audits/2026-08-16-reporty-pruzkum-metrik.md`

---

## Globální omezení

Platí pro **každý** task:

- **NESPOUŠTĚT `npm run build` ani dev server.** Vojta má běžící instance na portech 3000 a 3111, které sdílejí `.next`. Ověřuj přes `npx tsc --noEmit` a testy.
- **Commitovat jen vyjmenované soubory** (`git add <cesta>`), **nikdy `git add -A`.** Nad větví běží paralelní sessions.
- Commit message ukonči řádkem `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Žádná hodnota se nesmí změnit.** R3 mění rozvržení a přidává navigaci. Když se po nasazení liší číslo, je to chyba téhle etapy.
- **Barvy výhradně přes tokeny**, velikosti přes `reportTypeScale` / `reportRadius` / (nově) `reportSpace`. Hlídá `src/lib/reportTokens.test.ts`.
- **Nikdy nevygenerovat odkaz, který nikam nevede.** `/` umí JEDINÝ parametr `?highlight=<blockId>` (`src/app/page.tsx:13`, `:49`) — a ani ten není skok, id se překládá na `orderNumber` a předává jako textový filtr. `machine` ani `date` neexistují a v téhle etapě se nedoplňují.
- Celá sada testů:
  ```bash
  node --experimental-test-module-mocks --test --import tsx \
    src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
- Výchozí stav: 1198 testů zelených, `tsc --noEmit` čistý, pracovní strom čistý.

---

## Odchylka od specu, kterou plán zavádí vědomě

Spec říká „věty skládá server". **Kontrolní panel se ale ze serveru brát nesmí:** `useHealthData` ho už stahuje na klientovi při vstupu do Reportů a jeho kontroly mimo jiné **skenují disk** kvůli přílohám. Kdyby je nový endpoint spustil znovu, běžely by při každém otevření stránky dvakrát.

Proto:

- **`GET /api/report/attention`** vrací jen to, co umí spočítat levně a co klient nemá — přeplánované stroje a čekající rezervace.
- **Položky z Kontrolního panelu** skládá klient z dat, která už má.
- **Obojí prochází týmž čistým modulem** `src/lib/attentionItems.ts`, takže věty a prahy mají jediný zdroj pravdy. Rozdíl je jen v tom, odkud přitečou vstupy.

---

## Struktura souborů

| Soubor | Odpovědnost |
| --- | --- |
| `src/lib/attentionItems.ts` | **nový** — prahy jako konstanty, skládání položek a věty klidného stavu. Čistý, bez Prismy. |
| `src/lib/attentionItems.test.ts` | **nový** — prahy, hranice, prázdný stav, pokrytí zdrojů |
| `src/app/api/report/attention/route.ts` | **nový** — tenká route: dotazy + `buildServerAttentionInput` |
| `src/components/report/AttentionBand.tsx` | **nový** — vykreslení pásu |
| `src/app/reporty/_components/useAttentionData.ts` | **nový** — fetch + sloučení s health daty |
| `src/app/reporty/_components/RetroView.tsx` | **nový** — vytaženo z `ReportDashboard` |
| `src/app/reporty/_components/OutlookView.tsx` | **nový** — vytaženo z `ReportDashboard` |
| `src/app/reporty/_components/reportShared.ts` | **nový** — `cz`, `SectionHeader`, `BarChart`, sdílené typy |
| `src/app/api/report/dashboard/route.ts` | `pendingReservations.items` |
| `src/app/reporty/_components/ReportDashboard.tsx` | shell: záložky, období, pás |
| `src/app/reporty/_components/PlanningSection.tsx` | zrušení žebříčku |
| `src/lib/reportTokens.ts` | `reportSpace` |

---

## Task 1: Čistý modul `attentionItems.ts`

**Soubory:**
- Vytvořit: `src/lib/attentionItems.ts`
- Test: `src/lib/attentionItems.test.ts`

**Rozhraní:**
- Poskytuje (na tomhle staví Tasky 2 a 3):
  - `ATTENTION_THRESHOLDS: { reservationWaitingDays: 3; overbookedHorizonDays: 30 }`
  - `type AttentionItem = { key, severity: "bad"|"warn", title, detail, when, href, linkLabel }`
  - `type AttentionInput = { overbooked: OverbookedMachine[]; waiting: WaitingReservation[]; health: HealthInput }`
  - `buildAttentionItems(input: AttentionInput): AttentionItem[]`
  - `attentionCalmSentence(input: AttentionInput): string`

- [ ] **Krok 1: Napsat padající test**

Vytvoř `src/lib/attentionItems.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENTION_THRESHOLDS,
  buildAttentionItems,
  attentionCalmSentence,
  type AttentionInput,
} from "./attentionItems";

/** Klidný vstup — nic nevyžaduje pozornost. Jednotlivé testy si ho upraví. */
const calm: AttentionInput = {
  overbooked: [],
  waiting: [],
  health: { loaded: true, total: 0, uncomputed: 0 },
};

describe("attentionItems — prahy", () => {
  it("rezervace pod prahem se nehlásí, nad prahem ano", () => {
    const under = buildAttentionItems({
      ...calm,
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: ATTENTION_THRESHOLDS.reservationWaitingDays }],
    });
    assert.equal(under.length, 0, "přesně na prahu se ještě nehlásí");

    const over = buildAttentionItems({
      ...calm,
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: ATTENTION_THRESHOLDS.reservationWaitingDays + 1 }],
    });
    assert.equal(over.length, 1);
    assert.equal(over[0].severity, "warn");
  });

  it("čekající rezervace se slučují do JEDNÉ položky, ne do seznamu", () => {
    // Pás má být krátký. Tři řádky o rezervacích by ho zaplavily.
    const items = buildAttentionItems({
      ...calm,
      waiting: [
        { id: 1, orderNumber: "25-1043", waitingDays: 5 },
        { id: 2, orderNumber: "25-1051", waitingDays: 4 },
      ],
    });
    assert.equal(items.length, 1);
    assert.match(items[0].title, /2 rezervace/);
    assert.match(items[0].when, /5/, "ukazuje nejdelší čekání, ne průměr");
  });

  it("přeplánovaný stroj je závažnější než čekající rezervace a jde první", () => {
    const items = buildAttentionItems({
      ...calm,
      overbooked: [{ machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 }],
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: 5 }],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].severity, "bad");
    assert.equal(items[1].severity, "warn");
  });

  it("každý stroj má vlastní položku", () => {
    const items = buildAttentionItems({
      ...calm,
      overbooked: [
        { machine: "XL_105", overbookedHours: 3, overbookedDays: 1 },
        { machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 },
      ],
    });
    assert.equal(items.length, 2);
    assert.notEqual(items[0].key, items[1].key, "klíče musí být různé");
  });
});

describe("attentionItems — Kontrolní panel", () => {
  it("nálezy hlásí jako bad, nespočtené kontroly jako warn", () => {
    const bad = buildAttentionItems({ ...calm, health: { loaded: true, total: 3, uncomputed: 0 } });
    assert.equal(bad.length, 1);
    assert.equal(bad[0].severity, "bad");

    const warn = buildAttentionItems({ ...calm, health: { loaded: true, total: 0, uncomputed: 1 } });
    assert.equal(warn.length, 1);
    assert.equal(warn[0].severity, "warn");
  });

  it("nenačtený Kontrolní panel nevyrábí položku ANI klidné tvrzení", () => {
    // Kdyby nenačtený panel propadl na „bez nálezu", pás by tvrdil, že je
    // uklizeno, aniž by to kdokoliv ověřil. Táž vada, jakou řešil třetí stav
    // odznaku v etapě Kontrolního panelu.
    const input = { ...calm, health: { loaded: false, total: 0, uncomputed: 0 } };
    assert.equal(buildAttentionItems(input).length, 0);
    assert.doesNotMatch(attentionCalmSentence(input), /kontrol/i);
  });

  it("nálezy i nespočtené naráz dají dvě položky", () => {
    const items = buildAttentionItems({ ...calm, health: { loaded: true, total: 2, uncomputed: 1 } });
    assert.equal(items.length, 2);
  });
});

describe("attentionItems — odkazy", () => {
  it("každá položka vede někam, kde se to dá řešit", () => {
    const items = buildAttentionItems({
      overbooked: [{ machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 }],
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: 5 }],
      health: { loaded: true, total: 3, uncomputed: 1 },
    });
    assert.equal(items.length, 4);
    for (const it of items) {
      assert.ok(it.href && it.href.length > 0, `${it.key} nemá odkaz`);
      assert.ok(it.linkLabel && it.linkLabel.length > 0, `${it.key} nemá popisek odkazu`);
    }
  });

  it("odkazy míří jen na cesty, které v aplikaci existují", () => {
    const items = buildAttentionItems({
      overbooked: [{ machine: "XL_106", overbookedHours: 1, overbookedDays: 1 }],
      waiting: [{ id: 1, orderNumber: "25-1043", waitingDays: 9 }],
      health: { loaded: true, total: 1, uncomputed: 0 },
    });
    // `/` umí jen ?highlight=<id>; machine ani date neexistují.
    for (const it of items) {
      assert.doesNotMatch(it.href!, /[?&](machine|date)=/, `${it.key} používá neexistující parametr`);
    }
  });
});

describe("attentionItems — klidný stav", () => {
  it("vyjmenuje, co bylo ověřeno", () => {
    const s = attentionCalmSentence(calm);
    assert.match(s, /stroj/i);
    assert.match(s, /rezervac/i);
    assert.match(s, /kontrol/i);
  });

  it("věta nikdy netvrdí víc, než co se ověřilo", () => {
    const s = attentionCalmSentence({ ...calm, health: { loaded: false, total: 0, uncomputed: 0 } });
    assert.doesNotMatch(s, /kontrol/i);
    assert.match(s, /stroj/i, "co ověřeno bylo, se uvést má");
  });
});

describe("attentionItems — čísla v češtině", () => {
  it("hodiny mají desetinnou čárku, ne tečku", () => {
    const items = buildAttentionItems({
      ...calm,
      overbooked: [{ machine: "XL_106", overbookedHours: 26.4, overbookedDays: 6 }],
    });
    assert.match(items[0].title, /26,4/);
    assert.doesNotMatch(items[0].title, /26\.4/);
  });
});
```

- [ ] **Krok 2: Spustit test, ověřit že padá**

```bash
node --test --import tsx src/lib/attentionItems.test.ts
```
Čekej: FAIL — `Cannot find module './attentionItems'`.

- [ ] **Krok 3: Napsat modul**

Vytvoř `src/lib/attentionItems.ts`:

```typescript
import { machineLabel } from "@/lib/machines";

/**
 * Stavový pás nad záložkami Reportů — co vyžaduje pozornost.
 *
 * Modul je ČISTÝ a sdílený: serverová část (`/api/report/attention`) mu podá
 * přeplánované stroje a čekající rezervace, klient přidá stav Kontrolního
 * panelu, který má už stažený. Kdyby si každá strana skládala věty sama,
 * rozešly by se — přesně jako legenda heatmapy s mřížkou před etapou R2.
 *
 * Kontrolní panel se ZÁMĚRNĚ nepočítá na serveru: `useHealthData` ho stahuje
 * při vstupu do Reportů a jeho kontroly skenují disk kvůli přílohám. Druhý
 * běh na každé načtení stránky by byl zbytečně drahý.
 */

export const ATTENTION_THRESHOLDS = {
  /** Rezervace se hlásí, až když čeká DÉLE než tolik dní (ostrá nerovnost). */
  reservationWaitingDays: 3,
  /**
   * Horizont, ve kterém se hlídá přeplánování. PEVNÝ, nezávislý na zvoleném
   * období — jinak by pás hlásil něco jiného podle toho, co má člověk zrovna
   * vybrané, a „vyžaduje pozornost" by přestalo znamenat cokoliv.
   */
  overbookedHorizonDays: 30,
} as const;

export type AttentionSeverity = "bad" | "warn";

export type AttentionItem = {
  /** Stabilní klíč pro React i pro testy. */
  key: string;
  severity: AttentionSeverity;
  /** Tučná část věty. */
  title: string;
  /** Zbytek věty. */
  detail: string;
  /** Pravý sloupec — rozsah nebo doba čekání. */
  when: string;
  href: string;
  linkLabel: string;
};

export type OverbookedMachine = {
  machine: string;
  overbookedHours: number;
  /** Kolik dní horizontu je nad kapacitou. Nemusí jít o souvislý úsek. */
  overbookedDays: number;
};

export type WaitingReservation = { id: number; orderNumber: string; waitingDays: number };

/**
 * `loaded: false` znamená „nevíme", ne „je čisto". Rozdíl je podstatný: bez
 * něj by pás při selhání fetche tvrdil, že je uklizeno.
 */
export type HealthInput = { loaded: boolean; total: number; uncomputed: number };

export type AttentionInput = {
  overbooked: OverbookedMachine[];
  waiting: WaitingReservation[];
  health: HealthInput;
};

/** Desetinná čárka. Jedno místo, ať se zápis nerozejde se zbytkem reportu. */
const cz = (n: number) => String(n).replace(".", ",");

const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : n < 5 ? few : many;

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];

  // Pořadí je pořadím naléhavosti: přeplánovaný stroj se řeší dnes, rezervace
  // tento týden. Uvnitř skupiny řadíme podle velikosti problému.
  for (const m of [...input.overbooked].sort((a, b) => b.overbookedHours - a.overbookedHours)) {
    items.push({
      key: `overbooked:${m.machine}`,
      severity: "bad",
      title: `${machineLabel(m.machine)} přeplánován o ${cz(m.overbookedHours)} h`,
      detail: "plán nad kapacitou stroje",
      when: `${m.overbookedDays} ${plural(m.overbookedDays, "den", "dny", "dní")} z ${ATTENTION_THRESHOLDS.overbookedHorizonDays}`,
      href: "/reporty",
      linkLabel: "Výhled →",
    });
  }

  if (input.health.loaded && input.health.total > 0) {
    items.push({
      key: "health:findings",
      severity: "bad",
      title: `${input.health.total} ${plural(input.health.total, "nález", "nálezy", "nálezů")} v datech`,
      detail: "Kontrolní panel našel nesrovnalosti",
      when: "",
      href: "/reporty",
      linkLabel: "Kontrolní panel →",
    });
  }

  // Rezervace se slučují do JEDNÉ položky — pás má být krátký a čitelný na
  // jeden pohled. Seznam s čísly zakázek je v sekci RIZIKA ve Výhledu.
  const late = input.waiting.filter((r) => r.waitingDays > ATTENTION_THRESHOLDS.reservationWaitingDays);
  if (late.length > 0) {
    const longest = Math.max(...late.map((r) => r.waitingDays));
    items.push({
      key: "reservations:waiting",
      severity: "warn",
      title: `${late.length} ${plural(late.length, "rezervace čeká", "rezervace čekají", "rezervací čeká")} na zpracování`,
      detail: `déle než ${ATTENTION_THRESHOLDS.reservationWaitingDays} dny`,
      when: `nejdéle ${longest} ${plural(longest, "den", "dny", "dní")}`,
      href: "/rezervace",
      linkLabel: "Rezervace →",
    });
  }

  if (input.health.loaded && input.health.uncomputed > 0) {
    items.push({
      key: "health:uncomputed",
      severity: "warn",
      title: `${input.health.uncomputed} ${plural(input.health.uncomputed, "kontrola se nespočetla", "kontroly se nespočetly", "kontrol se nespočetlo")}`,
      detail: "výsledek není úplný",
      when: "",
      href: "/reporty",
      linkLabel: "Kontrolní panel →",
    });
  }

  return items;
}

/**
 * Věta pro klidný stav. Vyjmenovává, co bylo ověřeno — a NIKDY netvrdí víc.
 * Když se Kontrolní panel nenačetl, o kontrolách mlčí.
 */
export function attentionCalmSentence(input: AttentionInput): string {
  const checked = ["oba stroje v kapacitě", `žádná rezervace nečeká déle než ${ATTENTION_THRESHOLDS.reservationWaitingDays} dny`];
  if (input.health.loaded) checked.push("kontroly bez nálezu");
  return `${checked.join(" · ")}.`;
}
```

- [ ] **Krok 4: Spustit test**

```bash
node --test --import tsx src/lib/attentionItems.test.ts
npx tsc --noEmit
```
Čekej: PASS, `tsc` čistý.

- [ ] **Krok 5: Commit**

```bash
git add src/lib/attentionItems.ts src/lib/attentionItems.test.ts
git commit -m "feat(reporty): čistý modul stavového pásu — prahy a skládání vět"
```

---

## Task 2: Endpoint `/api/report/attention`

**Soubory:**
- Vytvořit: `src/app/api/report/attention/route.ts`

**Rozhraní:**
- Konzumuje: `ATTENTION_THRESHOLDS`, typy `OverbookedMachine` / `WaitingReservation` (Task 1)
- Poskytuje (Task 3): `GET /api/report/attention` → `{ checkedAt: string; overbooked: OverbookedMachine[]; waiting: WaitingReservation[] }`

- [ ] **Krok 1: Napsat route**

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { MACHINES } from "@/lib/machines";
import { todayPragueDateStr, addDaysToCivilDate, pragueToUTC } from "@/lib/dateUtils";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { computeAvailableHours, computeUtilization } from "@/lib/reportMetrics";
import { blockReportSegments, printOverlapMinutes } from "@/lib/printTimeClient";
import { ATTENTION_THRESHOLDS, type OverbookedMachine, type WaitingReservation } from "@/lib/attentionItems";

/**
 * Zdroj stavového pásu — „co vyžaduje pozornost".
 *
 * ZÁMĚRNĚ nezávislé na období zvoleném v Reportech: přeplánovaný stroj příští
 * týden je problém i při pohledu na loňský leden. Horizont je pevný
 * (`ATTENTION_THRESHOLDS.overbookedHorizonDays`).
 *
 * Kontrolní panel tenhle endpoint NEPOČÍTÁ — klient ho má z `useHealthData`
 * a jeho kontroly skenují disk. Viz `src/lib/attentionItems.ts`.
 */
export async function GET() {
  try {
    // Reporty jsou ADMIN-only, shodně s /api/report/dashboard.
    await requireRole(["ADMIN"]);

    const today = todayPragueDateStr();
    const horizonEnd = addDaysToCivilDate(today, ATTENTION_THRESHOLDS.overbookedHorizonDays);
    const startUtc = pragueToUTC(today, 0, 0);
    const endUtc = pragueToUTC(horizonEnd, 0, 0);

    const [blocks, weekShiftRows, companyDays, submitted] = await Promise.all([
      prisma.block.findMany({
        where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
      }),
      prisma.machineWeekShifts.findMany(),
      prisma.companyDay.findMany(),
      prisma.reservation.findMany({
        where: { status: "SUBMITTED" },
        select: { id: true, orderNumber: true, createdAt: true },
      }),
    ]);

    const weekShifts = serializeWeekShifts(weekShiftRows);
    const segMap = blockReportSegments(blocks, weekShifts, companyDays);

    const overbooked: OverbookedMachine[] = [];
    for (const machine of MACHINES) {
      const available = computeAvailableHours(machine, today, horizonEnd, weekShifts, companyDays);
      const planned = blocks
        .filter((b) => b.machine === machine)
        .reduce((s, b) => s + printOverlapMinutes(segMap.get(b) ?? null, b, startUtc, endUtc), 0) / 60;

      const overHours = planned - available;
      if (available <= 0 || overHours <= 0) continue;

      // Kolik jednotlivých dní horizontu je nad kapacitou. NEMUSÍ jít o souvislý
      // úsek — proto se hlásí počet dní, ne rozsah „od–do", který by souvislost
      // sliboval.
      let overDays = 0;
      let cur = today;
      while (cur < horizonEnd) {
        const dayStart = pragueToUTC(cur, 0, 0);
        const dayEnd = pragueToUTC(addDaysToCivilDate(cur, 1), 0, 0);
        const dayAvail = computeAvailableHours(machine, cur, cur, weekShifts, companyDays);
        const dayPlanned = blocks
          .filter((b) => b.machine === machine)
          .reduce((s, b) => s + printOverlapMinutes(segMap.get(b) ?? null, b, dayStart, dayEnd), 0) / 60;
        const pct = computeUtilization(dayPlanned, dayAvail);
        if (pct != null && pct > 100) overDays++;
        cur = addDaysToCivilDate(cur, 1);
      }

      overbooked.push({
        machine,
        overbookedHours: Math.round(overHours * 10) / 10,
        overbookedDays: overDays,
      });
    }

    const nowMs = Date.now();
    const waiting: WaitingReservation[] = submitted.map((r) => ({
      id: r.id,
      orderNumber: r.orderNumber ?? `#${r.id}`,
      waitingDays: Math.floor((nowMs - r.createdAt.getTime()) / 86_400_000),
    }));

    return NextResponse.json({ checkedAt: new Date().toISOString(), overbooked, waiting });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[report/attention] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

> **Poznámka pro implementátora:** sousední `/api/report/dashboard/route.ts` používá starší vzor `getSession()` + ruční kontrola role. **Nekopíruj ho** — CLAUDE.md předepisuje pro NOVÉ routy `requireRole` uvnitř `try`. Starou routu v téhle etapě nepřepisuj, není to její téma.

- [ ] **Krok 2: Ověřit tvar proti schématu**

Než spustíš `tsc`, ověř tři věci, které plán píše zpaměti:

```bash
grep -n 'model Reservation' -A 25 prisma/schema.prisma | grep -n 'orderNumber\|createdAt\|status'
grep -n 'export function serializeWeekShifts\|export function blockReportSegments' src/lib/scheduleValidation.ts src/lib/printTimeClient.ts
grep -n 'export async function requireRole' src/lib/auth.ts
```
Pokud se signatura liší (jiné jméno pole, jiný počet parametrů), **uprav kód podle skutečnosti**, ne plán podle kódu.

- [ ] **Krok 3: Ověřit**

```bash
npx tsc --noEmit
```
Čekej: čistý.

- [ ] **Krok 4: Commit**

```bash
git add src/app/api/report/attention/route.ts
git commit -m "feat(reporty): endpoint stavového pásu, nezávislý na zvoleném období"
```

---

## Task 3: Pás a jeho zapojení

**Soubory:**
- Vytvořit: `src/app/reporty/_components/useAttentionData.ts`
- Vytvořit: `src/components/report/AttentionBand.tsx`
- Upravit: `src/app/reporty/_components/ReportDashboard.tsx`

**Rozhraní:**
- Konzumuje: `buildAttentionItems`, `attentionCalmSentence` (Task 1), `/api/report/attention` (Task 2), `useHealthData`
- Poskytuje: nic dalším taskům

- [ ] **Krok 1: Hook**

`src/app/reporty/_components/useAttentionData.ts`:

```typescript
"use client";

import { useState, useEffect } from "react";
import {
  buildAttentionItems, attentionCalmSentence,
  type AttentionItem, type OverbookedMachine, type WaitingReservation,
} from "@/lib/attentionItems";

type ServerPart = { checkedAt: string; overbooked: OverbookedMachine[]; waiting: WaitingReservation[] };

/**
 * Sloučí serverovou část pásu se stavem Kontrolního panelu, který si klient
 * stahuje sám. Skládání vět dělá `attentionItems.ts`, tenhle hook jen sbírá
 * vstupy.
 */
export function useAttentionData(health: { loaded: boolean; total: number; uncomputed: number }) {
  const [server, setServer] = useState<ServerPart | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/report/attention");
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ServerPart;
        if (!cancelled) setServer(json);
      } catch {
        // Selhání pásu NESMÍ shodit stránku ani ji zablokovat. Report je
        // použitelný i bez něj — stejná defenzivnost, jakou má Kontrolní
        // panel u dílčích kontrol.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (failed || server == null) {
    return { ready: false, items: [] as AttentionItem[], calm: "", checkedAt: null as string | null };
  }

  const input = { overbooked: server.overbooked, waiting: server.waiting, health };
  return {
    ready: true,
    items: buildAttentionItems(input),
    calm: attentionCalmSentence(input),
    checkedAt: server.checkedAt,
  };
}
```

- [ ] **Krok 2: Komponenta**

`src/components/report/AttentionBand.tsx` — named export, tokeny, škály. Struktura podle vizuálního návrhu:

```tsx
"use client";

import React from "react";
import type { AttentionItem } from "@/lib/attentionItems";
import { reportTypeScale, reportRadius } from "@/lib/reportTokens";

const toneOf = (s: AttentionItem["severity"]) =>
  s === "bad" ? "var(--status-bad)" : "var(--status-warn)";

/**
 * Stavový pás nad záložkami Reportů. Vypisuje jen to, co vyžaduje pozornost.
 *
 * Klidný stav NENÍ prázdno — je to věta, která vyjmenuje, co bylo ověřeno.
 * Prázdný pás by se četl jako „nenačteno".
 */
export function AttentionBand({ items, calm, checkedAt }: {
  items: AttentionItem[];
  calm: string;
  checkedAt: string | null;
}) {
  const alert = items.length > 0;
  const edge = alert
    ? "color-mix(in oklab, var(--status-bad) 40%, var(--border))"
    : "color-mix(in oklab, var(--status-ok) 40%, var(--border))";

  return (
    <div style={{
      background: "var(--surface)", border: `1px solid ${edge}`,
      borderRadius: reportRadius.lg, overflow: "hidden", marginBottom: 12,
    }}>
      {alert ? (
        <>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
            padding: "11px 14px 9px", borderBottom: "1px solid var(--border)",
          }}>
            <span style={{ fontSize: reportTypeScale.md, fontWeight: 700 }}>Vyžaduje pozornost</span>
            <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
              stav k {checkedAt ? new Date(checkedAt).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              {" · nezávisle na zvoleném období"}
            </span>
          </div>
          {items.map((it, i) => (
            <div key={it.key} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 14px",
              fontSize: reportTypeScale.md,
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: toneOf(it.severity) }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontWeight: 650 }}>{it.title}</b>
                {it.detail ? ` — ${it.detail}` : ""}
              </span>
              {it.when && (
                <span style={{ fontSize: reportTypeScale.sm, color: "var(--text-muted)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {it.when}
                </span>
              )}
              <a href={it.href} style={{
                fontSize: reportTypeScale.md, fontWeight: 600, color: "var(--brand-text)",
                textDecoration: "none", whiteSpace: "nowrap",
              }}>{it.linkLabel}</a>
            </div>
          ))}
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 14px", fontSize: reportTypeScale.md }}>
          <span style={{
            width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
            background: "var(--status-ok)", color: "var(--status-on)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: reportTypeScale.base, fontWeight: 800,
          }}>✓</span>
          <span><b style={{ fontWeight: 650 }}>Nic nevyžaduje pozornost.</b> {calm}</span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Krok 3: Zapojit do `ReportDashboard`**

V `ReportDashboard`, kde už je `const health = useHealthData();`, přidej:

```typescript
const attention = useAttentionData({ loaded: health.data != null, total: health.total, uncomputed: health.uncomputed });
```

A pás vykresli **nad záložkami**, na obou datových režimech (ne v režimu `health` — tam by ukazoval na sebe):

```tsx
{mode !== "health" && attention.ready && (
  <AttentionBand items={attention.items} calm={attention.calm} checkedAt={attention.checkedAt} />
)}
```

- [ ] **Krok 4: Ověřit**

```bash
npx tsc --noEmit
node --test --import tsx src/lib/attentionItems.test.ts src/lib/reportTokens.test.ts
```
Čekej: obojí zelené. Strážný test musí projít i s novou komponentou — `src/components/report/` do jeho záběru na literály nespadá, ale `--brand` jako `color:` hlídá v celém `src/`.

- [ ] **Krok 5: Commit**

```bash
git add src/app/reporty/_components/useAttentionData.ts src/components/report/AttentionBand.tsx src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(reporty): stavový pás nad záložkami"
```

---

## Task 4: Extrakce `RetroView` a `OutlookView`

**Čistý přesun bez změny chování.** Dělá se PŘED přeskládáním, aby další tasky pracovaly v malých souborech.

**Soubory:**
- Vytvořit: `src/app/reporty/_components/reportShared.ts`
- Vytvořit: `src/app/reporty/_components/RetroView.tsx`
- Vytvořit: `src/app/reporty/_components/OutlookView.tsx`
- Upravit: `src/app/reporty/_components/ReportDashboard.tsx`

**Rozhraní:**
- Poskytuje (Tasky 5–7): `RetroView`, `OutlookView` jako named exporty; `reportShared.ts` nese `cz`, `SectionHeader`, `BarChart`, `machineLabel` re-export a typy `RetroData` / `OutlookData` / `RetroMachineData` / `OutlookMachineData`.

- [ ] **Krok 1: Přesunout**

Do `reportShared.ts` vytáhni: `cz`, `DOW_LABELS`, `SectionHeader`, `BarChart` a všechny čtyři datové typy. Do `RetroView.tsx` funkci `RetroView` + `utilizationColor`. Do `OutlookView.tsx` funkci `OutlookView` + `freeHoursValue`, `capacitySubtitle`, `capacityColor`.

**Přesouvej i komentáře.** Nesou odůvodnění (proč `capacityColor` jede podle `overbookedHours`, proč `freeHoursValue` vrací zápornou hodnotu, proč má legenda šest položek) — bez nich se ta rozhodnutí za měsíc zopakují špatně.

- [ ] **Krok 2: Ověřit, že se NIC nezměnilo**

```bash
npx tsc --noEmit
git diff --stat
```
`git diff --stat` musí ukázat, že z `ReportDashboard.tsx` ubylo zhruba tolik řádků, kolik přibylo v nových souborech. **Když v diffu vidíš změnu logiky, vrať ji** — tenhle task je přesun.

```bash
npx eslint src/app/reporty/_components/
```
Čekej: `max-lines` warning na `ReportDashboard.tsx` **zmizel**.

- [ ] **Krok 3: Commit**

```bash
git add src/app/reporty/_components/reportShared.ts src/app/reporty/_components/RetroView.tsx src/app/reporty/_components/OutlookView.tsx src/app/reporty/_components/ReportDashboard.tsx
git commit -m "refactor(reporty): RetroView a OutlookView do vlastních souborů"
```

---

## Task 5: Přeskládání Retrospektivy

**Soubory:**
- Upravit: `src/app/reporty/_components/RetroView.tsx`
- Upravit: `src/app/reporty/_components/PlanningSection.tsx`

- [ ] **Krok 1: Nové pořadí sekcí**

Zruš dnešní čtyřkartovou řadu nahoře. Nové pořadí:

```
SectionHeader "VÝROBA"
  karty: Vytížení XL 105 · Vytížení XL 106 · Údržba
  panel: Denní vytížení (graf)
SectionHeader "PRŮCHOD ZAKÁZEK"
  karty: Průtok zakázek · Průměrná lead time
SectionHeader "PLÁNOVÁNÍ"
  <PlanningSection …/>
SectionHeader "OBCHOD"
  panel: Pipeline rezervací (beze změny)
```

- [ ] **Krok 2: Hodiny do podtitulku, karty „Produkce" pryč**

Karta Vytížení dostane podtitulek se **stejnými hodnotami**, jaké dnes nesou zrušené karty:

```tsx
<KpiCard
  label="Vytížení XL 105"
  value={xl105?.utilization == null ? "—" : `${xl105.utilization}%`}
  subtitle={`${cz(xl105?.productionHours ?? 0)} z ${cz(xl105?.availableHours ?? 0)} h dostupných`}
  color={utilizationColor(xl105?.utilization ?? null)}
/>
```

Karty „Produkce XL 105" a „Produkce XL 106" **smaž**. Karta „Údržba ratio" zůstává v dnešní podobě (souhrn + per stroj).

- [ ] **Krok 3: Zrušit žebříček v `PlanningSection`**

Smaž celý druhý panel („Aktivita plánovačů" včetně `maxActivity` a pruhů). Zůstávají čtyři karty **včetně „Přihlášení za období"** — Vojta ji z rušení vyňal.

Prop `plannerActivity` a typ `PlannerActivityEntry` se tím osiří. **Odstraň je z propů komponenty**, ale **API nech vracet, co vrací** — měnit odpověď serveru není téma R3 a odstranění by rozbilo cache prohlížeče krátce po deployi. Do komentáře napiš proč.

Grid `1fr 1fr` se změní na jednosloupcový.

- [ ] **Krok 4: Ověřit**

```bash
npx tsc --noEmit
grep -rn 'plannerActivity' src/app/reporty/
```
`tsc` čistý; grep smí najít výskyty jen v `ReportDashboard` (předává data z API) — ne v `PlanningSection`.

- [ ] **Krok 5: Commit**

```bash
git add src/app/reporty/_components/RetroView.tsx src/app/reporty/_components/PlanningSection.tsx
git commit -m "feat(reporty): Retrospektiva seskupená podle otázek, bez jmenovitého žebříčku"
```

---

## Task 6: Rezervace s čísly zakázek (API)

**Soubory:**
- Upravit: `src/app/api/report/dashboard/route.ts`

**Rozhraní:**
- Poskytuje (Task 7): `pendingReservations.items: Array<{ id: number; orderNumber: string; description: string; waitingDays: number; status: string }>` + `shownOf: number`

- [ ] **Krok 1: Rozšířit dotaz a odpověď**

Dnešní blok `// Pending reservations` počítá jen `submitted` a `queueReady` jako počty. Doplň seznam:

```typescript
// Seznam pro sekci RIZIKA — počty samy o sobě nejdou odbavit, chybí u nich,
// KTERÁ zakázka čeká. Strop 5 je přiznaný v UI („Zobrazeny 3 z 7").
const PENDING_LIST_LIMIT = 5;
const pendingAll = [...submitted, ...queueReady]
  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const pendingItems = pendingAll.slice(0, PENDING_LIST_LIMIT).map((r) => ({
  id: r.id,
  orderNumber: r.orderNumber ?? `#${r.id}`,
  description: r.description ?? "",
  waitingDays: Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000),
  status: r.status,
}));
```

A do `pendingReservations` v odpovědi přidej `items: pendingItems` a `totalCount: pendingAll.length`.

- [ ] **Krok 2: Ověřit, že `Reservation` ta pole má**

```bash
grep -n 'model Reservation' -A 30 prisma/schema.prisma
```
Ověř `orderNumber`, `description`, `createdAt`, `status`. **Když se pole jmenuje jinak, uprav kód podle schématu** — a když `description` neexistuje, vynech ho z tvaru i z UI v Tasku 7 a napiš to do závěrečné zprávy.

Zároveň ověř, že `select` v dotazech na `submitted`/`queueReady` ta pole vůbec načítá; pokud je dotaz zúžený `select`em, rozšiř ho.

- [ ] **Krok 3: Ověřit**

```bash
npx tsc --noEmit
```

- [ ] **Krok 4: Commit**

```bash
git add src/app/api/report/dashboard/route.ts
git commit -m "feat(reporty): čekající rezervace nesou čísla zakázek, ne jen počty"
```

---

## Task 7: Přeskládání Výhledu

**Soubory:**
- Upravit: `src/app/reporty/_components/OutlookView.tsx`

- [ ] **Krok 1: Zrušit karty „Volné hod."**

Smaž obě. Podtitulek karty Kapacita už dnes nese `capacitySubtitle` (`X h volných` / `přeplánováno o Y h`) — ten zůstává a nese informaci dál. Funkce `freeHoursValue` se tím osiří, **smaž ji i s komentářem**, který říká, že ji R3 ruší.

- [ ] **Krok 2: Heatmapa na celé období**

```typescript
const days = data.dailyCapacity.slice(0, 14);
```
→
```typescript
// Celé zvolené období. Ořez na 14 dní tu byl bez jakékoliv zmínky, takže
// při měsíčním pohledu zmizelo 17 dní a nikdo se to nedozvěděl.
const days = data.dailyCapacity;
// Pod tuhle šířku se dvouciferné číslo do dlaždice nevejde. Práh se počítá
// z POČTU dní, ne z měření DOM — server i klient musí vykreslit totéž.
const showNumbers = days.length <= 20;
```

V dlaždici podmiň obsah `showNumbers`; `title` nechej vždycky. Hlavičku dní zkrať při `!showNumbers` na samotné číslo dne (bez zkratky dne v týdnu).

Mřížku obal kontejnerem, který se posouvá sám:

```tsx
<div style={{ overflowX: "auto" }}>
  <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${days.length}, minmax(11px, 1fr))`, gap: 2, minWidth: 520 }}>
```

- [ ] **Krok 3: Údržby s přiznaným stropem**

```tsx
{data.upcomingMaintenance.length > 5 && (
  <div style={{ marginTop: 6, fontSize: reportTypeScale.sm, color: "var(--text-muted)" }}>
    Zobrazeno 5 z {data.upcomingMaintenance.length} nejbližších údržeb.
  </div>
)}
```

- [ ] **Krok 4: Rezervace jako seznam**

Nahraď dvě KPI karty seznamem z `data.pendingReservations.items`. Řádek: číslo zakázky (tučně) · popis (tlumeně, `flex: 1`) · „čeká N dní" (tabular-nums). Pod seznamem `{newCount} nové · {queueCount} ve frontě k plánování` a přiznaný strop, když `totalCount > items.length`.

Řádek **není** odkaz na `/?highlight=` — to je id BLOKU, ne rezervace. Celý panel dostane odkaz `/rezervace` v hlavičce.

Prázdný stav: `Žádné čekající rezervace.`

- [ ] **Krok 5: Ověřit**

```bash
npx tsc --noEmit
grep -n 'slice(0, 14)\|freeHoursValue' src/app/reporty/_components/
node --test --import tsx src/lib/reportTokens.test.ts
```
Čekej: `tsc` čistý, grep nic, strážný test zelený.

- [ ] **Krok 6: Commit**

```bash
git add src/app/reporty/_components/OutlookView.tsx
git commit -m "feat(reporty): Výhled bez duplicit, heatmapa na celé období, rizika s čísly zakázek"
```

---

## Task 8: Odsazovací škála a závěrečná kontrola

**Soubory:**
- Upravit: `src/lib/reportTokens.ts`, `src/lib/reportTokens.test.ts`
- Upravit: všechny komponenty v `src/app/reporty/_components/` a `src/components/report/`

- [ ] **Krok 1: Škála**

Do `reportTokens.ts`:

```typescript
/**
 * Odsazení. Odloženo z R2, protože sjednocovat padding před přeskládáním by
 * znamenalo sáhnout na každý řádek dvakrát. Před R3 bylo v /reporty
 * 19 různých hodnot.
 */
export const reportSpace = {
  xs: 4,   // těsné vnitřky chipů
  sm: 8,   // řádky seznamu
  md: 12,  // vnitřek panelu
  lg: 16,  // vnitřek karty
  xl: 24,  // mezera mezi sekcemi
} as const;
```

Do `reportTokens.test.ts` přidej do suity „škály":

```typescript
it("odsazení je vzestupné a bez duplicit", () => {
  const s = Object.values(reportSpace);
  assert.deepEqual(s, [...s].sort((a, b) => a - b));
  assert.equal(new Set(s).size, s.length);
});
```

A do suity „pojistky" rozšiř existující detektor holých čísel o `padding` — stejným způsobem, jakým dnes hlídá `fontSize` a `borderRadius`.

- [ ] **Krok 2: Převést padding**

Projdi `src/app/reporty/_components/*.tsx` a `src/components/report/*.tsx`. Každý `padding: <číslo>` a `padding: "<čísla>"` nahraď kombinací kroků škály. **Zaokrouhluj na nejbližší krok** — hodnoty jako `"13px 15px"` jdou na `` `${reportSpace.md}px ${reportSpace.lg}px` ``.

Vizuální posun o 1–3 px je čekaný a je to smysl etapy.

- [ ] **Krok 3: Závěrečná kontrola celé etapy**

```bash
# 1. žádný literál barvy v /reporty
grep -rn '#[0-9a-fA-F]\{3,8\}\b\|rgba\?(' src/app/reporty/ src/components/report/

# 2. žádná holá velikost ani odsazení
grep -rn 'fontSize: [0-9]\|borderRadius: [0-9]\|padding: [0-9]' src/app/reporty/ src/components/report/

# 3. žádný tichý ořez
grep -rn 'slice(0, 14)' src/app/reporty/

# 4. žádný odkaz na neexistující parametr
grep -rn 'machine=\|[?&]date=' src/app/reporty/ src/components/report/ src/lib/attentionItems.ts

# 5. velikost souborů
npx eslint src/app/reporty/_components/ src/components/report/

# 6. typy a testy
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Čekej: grepy 1–4 **nic**; eslint bez `max-lines`; `tsc` čistý; **všechny testy zelené** (1198 + nové z Tasku 1 a Kroku 1).

- [ ] **Krok 4: Commit**

```bash
git add src/lib/reportTokens.ts src/lib/reportTokens.test.ts src/app/reporty/_components/ src/components/report/
git commit -m "refactor(reporty): odsazovací škála místo devatenácti hodnot"
```

---

## Kontrola na závěr (dělá orchestrátor, ne subagent)

1. **Multi-agent review** celého diffu proti specu — etapa přidává serverovou cestu a mění, co je na stránce vidět.
2. **Doplnit `docs/vyvoj-historie.md`** o sekci etapy R3.
3. **Ověřit ručně**, že pás nezmizí ani neshodí stránku, když `/api/report/attention` vrátí 500 (dá se vyvolat dočasným `throw` v routě — po ověření vrátit).
4. **Připomenout Vojtovi**, že R4 má blokující krok: změřit vyplněnost `deadlineExpedice` a `jobPresetId` na produkci (dotaz je v `docs/audits/2026-08-16-reporty-pruzkum-metrik.md`, kap. 8).
