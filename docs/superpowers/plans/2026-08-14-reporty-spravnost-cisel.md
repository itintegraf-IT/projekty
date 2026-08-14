# Reporty — správnost čísel (R1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stránka `/reporty` přestane ukazovat nesprávná čísla — průtok neztratí hotovou práci, souhrny se ořežou na zvolené období, odstávky se odečtou z kapacity a přeplánování přestane být schované.

**Architecture:** Veškerá logika zůstává v čistých funkcích v `src/lib/reportMetrics.ts` (testovatelných bez databáze); `src/app/api/report/dashboard/route.ts` je jen zapojení. UI se dotýkáme jen tam, kde se mění **význam** čísla — žádné přeskládání, žádné barvy nad rámec větve „nad 100 %".

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Prisma 5 · MySQL · `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-14-reporty-spravnost-cisel-design.md`

## Global Constraints

- Odpovědi, popisky a komentáře v kódu **česky**; identifikátory anglicky.
- **Datum a čas na serveru vždy přes pražské helpery** z `src/lib/dateUtils.ts` (`pragueToUTC`, `addDaysToCivilDate`) — nikdy `new Date(str + "T00:00:00Z")` ani `getFullYear/Month/Date`. Je to pravidlo z CLAUDE.md a zároveň jedna z oprav v tomhle plánu.
- Barvy **výhradně přes CSS tokeny** z `src/app/globals.css`, nikdy hex/rgba literál. Výjimka: hex literály, které v `ReportDashboard.tsx` **už jsou**, se v R1 neopravují (řeší R2) — jen se nesmí přidat nové.
- Logování přes `logger` (`src/lib/logger.ts`), nikdy `console.*`.
- Panel a endpoint **jen čtou** — žádná mutace, žádná migrace.
- **NEspouštět `npm run build` ani dev server.** Na Macu běží uživatelovy instance na portech 3000 a 3111 a sdílejí složku `.next`. Typová kontrola **výhradně** `npx tsc --noEmit`.
- **Commitovat jen vyjmenované soubory** (`git add <cesta>`), nikdy `git add -A` — v pracovním stromu bývají rozdělané změny z paralelní session (`src/app/_components/PlannerPage.tsx`, `src/lib/keyboardShortcuts*.ts`, `docs/POUCENI.md`). Těch se nedotýkat.

**Testy — příkazy:**

```bash
# jeden soubor (rychlá smyčka)
node --test --import tsx src/lib/reportMetrics.test.ts

# celá suite (před posledním commitem)
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts

# typová kontrola
npx tsc --noEmit
```

**Styl testů v tomhle souboru:** `describe(...)` / `it(...)` z `node:test`, `assert` z `node:assert/strict`. Pomocník `makeRow(machine, dayOfWeek, flags)` staví řádek `MachineWeekShiftsRow`; konstanta `WEEK_START = "2026-04-13"` (pondělí).

## File Structure

| Soubor | Odpovědnost | Stav |
| --- | --- | --- |
| `src/lib/reportMetrics.ts` | čisté funkce metrik | upravit |
| `src/lib/reportMetrics.test.ts` | jejich testy | upravit |
| `src/lib/reservationStatus.ts` | slovník stavů rezervací — jediný zdroj pravdy | **nový** |
| `src/lib/reservationStatus.test.ts` | strážné testy slovníku | **nový** |
| `src/app/api/report/dashboard/route.ts` | zapojení, dotazy, tvar odpovědi | upravit |
| `src/app/reporty/_components/ReportDashboard.tsx` | jen texty a čísla, kde se mění význam | upravit |
| `src/app/reporty/_components/PlanningSection.tsx` | česká čárka, `tabular-nums` | upravit |

---

### Task 1: Průtok a lead time nad odklepnutými zakázkami

Řeší **F1** (3 ze 43 zakázek mizí, 7 %) a zároveň **F6** (posun UTC/Praha).

**Files:**
- Modify: `src/lib/reportMetrics.ts` (ruší `computeThroughput` a `computeAvgLeadTimeDays`, přidává tři nové funkce)
- Modify: `src/app/api/report/dashboard/route.ts:11-12` (importy), `:203-204` (volání)
- Modify: `src/app/reporty/_components/ReportDashboard.tsx:26` (typ), `:219` (render)
- Test: `src/lib/reportMetrics.test.ts`

**Interfaces:**
- Consumes: nic (první task)
- Produces:
  ```ts
  export type CompletedBlock = { id: number; splitGroupId: number | null; createdAt: Date; printCompletedAt: Date };
  export type CompletedOrder = { key: string; createdAt: Date; completedAt: Date };
  export function groupCompletedToOrders(blocks: CompletedBlock[]): CompletedOrder[];
  export function computeThroughputFromOrders(orders: CompletedOrder[]): number;
  export function computeAvgLeadTimeDaysFromOrders(orders: CompletedOrder[]): number | null;
  ```

**Kontext:** Obě staré funkce běží nad polem `blocks`, které route načetla jako bloky **protínající období**. Zakázka odklepnutá v srpnu, ale naplánovaná na září, do pole nepřijde a v září se nezapočítá taky — **nezapočítá se nikde**. Na produkci to v srpnu 2026 dělá 3 ze 43. Rozdělená zakázka se navíc dnes počítá tolikrát, na kolik dílů je rozdělená; podle rozhodnutí Vojty má být **jedna**.

- [ ] **Step 1: Napsat failující testy**

Do `src/lib/reportMetrics.test.ts` přidat import nových funkcí a novou sekci:

```ts
describe("groupCompletedToOrders", () => {
  const D = (iso: string) => new Date(iso);

  it("rozdělená zakázka na dvou blocích → jedna zakázka", () => {
    const orders = groupCompletedToOrders([
      { id: 1, splitGroupId: 7, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-10T12:00:00Z") },
      { id: 2, splitGroupId: 7, createdAt: D("2026-08-05T08:00:00Z"), printCompletedAt: D("2026-08-11T09:00:00Z") },
    ]);
    assert.equal(orders.length, 1);
    // nejstarší založení a nejpozdější dokončení celé skupiny
    assert.equal(orders[0].createdAt.toISOString(), "2026-08-01T08:00:00.000Z");
    assert.equal(orders[0].completedAt.toISOString(), "2026-08-11T09:00:00.000Z");
  });

  it("nerozdělené bloky jsou samostatné zakázky", () => {
    const orders = groupCompletedToOrders([
      { id: 1, splitGroupId: null, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
      { id: 2, splitGroupId: null, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
    ]);
    assert.equal(orders.length, 2);
  });

  it("Block.id a SplitGroup.id se nesmí splést — stejné číslo, jiný prostor", () => {
    // blok #7 bez skupiny a skupina 7 jsou dvě různé zakázky
    const orders = groupCompletedToOrders([
      { id: 7, splitGroupId: null, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
      { id: 9, splitGroupId: 7, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
    ]);
    assert.equal(orders.length, 2);
  });
});

describe("computeThroughputFromOrders", () => {
  it("počítá zakázky, ne bloky", () => {
    const orders = groupCompletedToOrders([
      { id: 1, splitGroupId: 7, createdAt: new Date("2026-08-01T08:00:00Z"), printCompletedAt: new Date("2026-08-02T08:00:00Z") },
      { id: 2, splitGroupId: 7, createdAt: new Date("2026-08-01T08:00:00Z"), printCompletedAt: new Date("2026-08-02T08:00:00Z") },
      { id: 3, splitGroupId: null, createdAt: new Date("2026-08-01T08:00:00Z"), printCompletedAt: new Date("2026-08-02T08:00:00Z") },
    ]);
    assert.equal(computeThroughputFromOrders(orders), 2);
  });

  it("prázdné → 0", () => {
    assert.equal(computeThroughputFromOrders([]), 0);
  });
});

describe("computeAvgLeadTimeDaysFromOrders", () => {
  it("průměr s jedním desetinným místem", () => {
    const orders = [
      { key: "a", createdAt: new Date("2026-08-01T00:00:00Z"), completedAt: new Date("2026-08-01T12:00:00Z") }, // 0,5 d
      { key: "b", createdAt: new Date("2026-08-01T00:00:00Z"), completedAt: new Date("2026-08-03T00:00:00Z") }, // 2,0 d
    ];
    assert.equal(computeAvgLeadTimeDaysFromOrders(orders), 1.3); // (0,5+2)/2 = 1,25 → 1,3
  });

  it("půlden se neztratí zaokrouhlením na celé dny", () => {
    const orders = [{ key: "a", createdAt: new Date("2026-08-01T00:00:00Z"), completedAt: new Date("2026-08-01T12:00:00Z") }];
    assert.equal(computeAvgLeadTimeDaysFromOrders(orders), 0.5);
  });

  it("prázdné → null, ne 0 (nula znamená „hned“, ne „nevím“)", () => {
    assert.equal(computeAvgLeadTimeDaysFromOrders([]), null);
  });
});
```

Do importu z `./reportMetrics` přidat `groupCompletedToOrders`, `computeThroughputFromOrders`, `computeAvgLeadTimeDaysFromOrders` a **odstranit** `computeThroughput` a `computeAvgLeadTimeDays`. Zároveň **smazat** celé bloky `describe("computeThroughput", …)` a `describe("computeAvgLeadTimeDays", …)`.

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — `does not provide an export named 'groupCompletedToOrders'`

- [ ] **Step 3: Implementovat nové funkce**

V `src/lib/reportMetrics.ts` **smazat** `computeThroughput` (sekce 3) a `computeAvgLeadTimeDays` (sekce 4) a na jejich místo dát:

```ts
// ---------------------------------------------------------------------------
// 3. Průtok a lead time — nad DOKONČENÝMI zakázkami
// ---------------------------------------------------------------------------

/** Blok s potvrzeným tiskem. Načítá se dotazem na `printCompletedAt`, ne podle polohy v plánu. */
export type CompletedBlock = {
  id: number;
  splitGroupId: number | null;
  createdAt: Date;
  printCompletedAt: Date;
};

/** Jedna zakázka: rozdělené kusy jsou sloučené do jednoho záznamu. */
export type CompletedOrder = { key: string; createdAt: Date; completedAt: Date };

/**
 * Bloky → zakázky. Rozdělená zakázka je JEDNA zakázka (rozhodnutí Vojty 14. 8. 2026),
 * proto se kusy slučují přes `splitGroupId`.
 *
 * Klíč nese prefix `g`/`b`, protože `Block.id` a `SplitGroup.id` jsou NEZÁVISLÉ
 * id-prostory — numerická shoda by dvě různé zakázky sloučila v jednu (táž konvence
 * jako v `blockShades.ts`).
 *
 * Skupina si bere NEJSTARŠÍ založení a NEJPOZDĚJŠÍ dokončení: to je poctivá doba
 * od zadání po dotištění posledního kusu. Kus vzniklý splitem má `createdAt`
 * v okamžiku rozdělení, takže sám o sobě by dal uměle krátký lead time.
 */
export function groupCompletedToOrders(blocks: CompletedBlock[]): CompletedOrder[] {
  const byKey = new Map<string, CompletedOrder>();
  for (const b of blocks) {
    const key = b.splitGroupId != null ? `g${b.splitGroupId}` : `b${b.id}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { key, createdAt: b.createdAt, completedAt: b.printCompletedAt });
      continue;
    }
    if (b.createdAt.getTime() < cur.createdAt.getTime()) cur.createdAt = b.createdAt;
    if (b.printCompletedAt.getTime() > cur.completedAt.getTime()) cur.completedAt = b.printCompletedAt;
  }
  return [...byKey.values()];
}

/** Počet dokončených zakázek v období. */
export function computeThroughputFromOrders(orders: CompletedOrder[]): number {
  return orders.length;
}

/**
 * Průměrná doba od založení po dokončení, v dnech na jedno desetinné místo.
 *
 * `null` (ne 0) při prázdné množině: v tiskárně se hodně zakázek odbaví do 24 h,
 * takže „0 dní“ je legitimní hodnota a nesmí znamenat zároveň „nevím“.
 */
export function computeAvgLeadTimeDaysFromOrders(orders: CompletedOrder[]): number | null {
  if (orders.length === 0) return null;
  const totalMs = orders.reduce((sum, o) => sum + (o.completedAt.getTime() - o.createdAt.getTime()), 0);
  const days = totalMs / orders.length / 86_400_000;
  return Math.round(days * 10) / 10;
}
```

- [ ] **Step 4: Spustit testy**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS

- [ ] **Step 5: Zapojit v routě**

V `src/app/api/report/dashboard/route.ts` v importu z `@/lib/reportMetrics` nahradit `computeThroughput,` a `computeAvgLeadTimeDays,` za:

```ts
  groupCompletedToOrders,
  computeThroughputFromOrders,
  computeAvgLeadTimeDaysFromOrders,
```

a nahradit řádky `:203-204`:

```ts
  // Průtok a lead time se počítají nad DOKONČENÝMI zakázkami, ne nad bloky, které
  // období protínají. Zakázka odklepnutá v období, ale naplánovaná mimo něj, se dřív
  // nezapočítala nikde (na produkci 3 ze 43 v srpnu 2026). Hranice `startUtc`/`endUtc`
  // jsou pražské — tím mizí i starý posun 2 h proti zbytku routy.
  const completedRows = await prisma.block.findMany({
    where: { type: "ZAKAZKA", printCompletedAt: { gte: startUtc, lt: endUtc } },
    select: { id: true, splitGroupId: true, createdAt: true, printCompletedAt: true },
  });
  const completedOrders = groupCompletedToOrders(
    completedRows.flatMap((r) =>
      r.printCompletedAt == null ? [] : [{ id: r.id, splitGroupId: r.splitGroupId, createdAt: r.createdAt, printCompletedAt: r.printCompletedAt }],
    ),
  );
  const throughput = computeThroughputFromOrders(completedOrders);
  const avgLeadTimeDays = computeAvgLeadTimeDaysFromOrders(completedOrders);
```

- [ ] **Step 6: Srovnat klienta**

V `src/app/reporty/_components/ReportDashboard.tsx` změnit řádek 26 na:

```ts
  avgLeadTimeDays: number | null;
```

a řádek 219 na:

```tsx
        <KpiCard label="Průměrná lead time" value={data.avgLeadTimeDays == null ? "—" : `${String(data.avgLeadTimeDays).replace(".", ",")} d`} subtitle="od založení po dokončení" />
```

- [ ] **Step 7: Ověřit a commitnout**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts` → PASS
Run: `npx tsc --noEmit` → bez chyb

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts src/app/api/report/dashboard/route.ts src/app/reporty/_components/ReportDashboard.tsx
git commit -m "fix(reporty): průtok počítá dokončené zakázky, ne bloky v období

Zakázka odklepnutá v období, ale naplánovaná mimo něj, se dřív
nezapočítala v žádném období — na produkci 3 ze 43 v srpnu 2026.
Rozdělená zakázka se nově počítá jednou. Lead time má desetinné místo
a prázdná množina vrací null místo nuly. Pražské hranice ruší i starý
posun 2 h proti zbytku routy."
```

---

### Task 2: Odstávky se odečtou z dostupné kapacity

Řeší **F2** — 153,9 h v prosinci, 40 h v září/říjnu/listopadu.

**Files:**
- Modify: `src/lib/reportMetrics.ts` (`computeAvailableHours` — přepis)
- Modify: `src/app/api/report/dashboard/route.ts:173, 192, 337, 357` (čtyři volání)
- Test: `src/lib/reportMetrics.test.ts`

**Interfaces:**
- Consumes: nic z Tasku 1
- Produces:
  ```ts
  export type CompanyDayRow = { machine?: string | null; startDate: string | Date; endDate: string | Date };
  export function computeAvailableHours(
    machine: string, rangeStart: string, rangeEnd: string,
    weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayRow[],
  ): number;
  ```

**Kontext:** Jmenovatel dnes odstávku ignoruje, čitatel ji respektuje (expanze tisku v odstávce vrátí `START_NOT_RUNNABLE`). Týden celozávodní dovolené se proto vykáže jako „0 % ze 152 dostupných hodin" místo „0 z 0". Dopad je koncentrovaný do měsíců, které zajímají nejvíc.

**Pozor na `CompanyDay.machine`:** je nullable a **`null` znamená OBA stroje**. Filtr proto nesmí být prostá rovnost. Pravidlo je už jednou napsané v `companyDayIntervalsFor` (`src/lib/printTimeClient.ts:57-64`) — **použij ji**, ať nevznikne druhá kopie.

- [ ] **Step 1: Napsat failující testy**

Do `describe("computeAvailableHours", …)` v `src/lib/reportMetrics.test.ts` přidat (existující `it` bloky v něm nech být, jen jim doplň pátý argument `[]` — viz Step 3):

```ts
  it("celozávodní odstávka (machine = null) se odečte OBĚMA strojům", () => {
    const rows = [makeRow("XL_105", 1, { morningOn: true, afternoonOn: true })]; // po 6-22 = 16 h
    const shutdown = [{ machine: null, startDate: "2026-04-13T04:00:00.000Z", endDate: "2026-04-13T12:00:00.000Z" }];
    // 2026-04-13 je pondělí; 04:00-12:00 UTC = 06:00-14:00 Praha = celá ranní směna
    assert.equal(computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", rows, []), 16);
    assert.equal(computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", rows, shutdown), 8);
  });

  it("odstávka jednoho stroje se druhého netýká", () => {
    const rows = [makeRow("XL_106", 1, { morningOn: true, afternoonOn: true })];
    const shutdown = [{ machine: "XL_105", startDate: "2026-04-13T04:00:00.000Z", endDate: "2026-04-13T12:00:00.000Z" }];
    assert.equal(computeAvailableHours("XL_106", "2026-04-13", "2026-04-13", rows, shutdown), 16);
  });

  it("odstávka mimo směny neudělá záporné hodiny", () => {
    const rows = [makeRow("XL_105", 1, { morningOn: true })]; // po 6-14 = 8 h
    const shutdown = [{ machine: null, startDate: "2026-04-12T00:00:00.000Z", endDate: "2026-04-12T22:00:00.000Z" }]; // neděle
    assert.equal(computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", rows, shutdown), 8);
  });

  it("dvě překrývající se odstávky se neodečtou dvakrát", () => {
    const rows = [makeRow("XL_105", 1, { morningOn: true, afternoonOn: true })]; // 16 h
    const shutdown = [
      { machine: null, startDate: "2026-04-13T04:00:00.000Z", endDate: "2026-04-13T12:00:00.000Z" },
      { machine: null, startDate: "2026-04-13T06:00:00.000Z", endDate: "2026-04-13T10:00:00.000Z" },
    ];
    assert.equal(computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", rows, shutdown), 8);
  });
```

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — nové testy dostávají 16 místo 8 (odstávka se neodečítá)

- [ ] **Step 3: Přepsat `computeAvailableHours`**

V `src/lib/reportMetrics.ts` doplnit importy:

```ts
import { addDaysToCivilDate, pragueToUTC } from "./dateUtils";
import { companyDayIntervalsFor } from "./printTimeClient";
```

(řádek `import { addDaysToCivilDate } from "./dateUtils";` nahradit tím prvním)

a nahradit celou funkci `computeAvailableHours` (sekce 1):

```ts
export type CompanyDayRow = { machine?: string | null; startDate: string | Date; endDate: string | Date };

type Interval = { start: number; end: number };

/** Absolutní UTC intervaly směn jednoho dne. Noční se dělí na dnešek a ocas po půlnoci. */
function shiftIntervalsForDay(row: MachineWeekShiftsRow, dateStr: string): Interval[] {
  const at = (dayStr: string, min: number) =>
    pragueToUTC(dayStr, Math.floor(min / 60), min % 60).getTime();
  const nextDay = addDaysToCivilDate(dateStr, 1);
  const out: Interval[] = [];
  for (const shift of ["MORNING", "AFTERNOON", "NIGHT"] as const) {
    const b = resolveShiftBounds(row, shift);
    if (!b) continue;
    if (b.endMin > b.startMin) {
      out.push({ start: at(dateStr, b.startMin), end: at(dateStr, b.endMin) });
    } else {
      // Noční přes půlnoc patří ke dni SVÉHO STARTU (týž model jako `isDateTimeActive`).
      const midnight = pragueToUTC(nextDay, 0, 0).getTime();
      out.push({ start: at(dateStr, b.startMin), end: midnight });
      out.push({ start: midnight, end: at(nextDay, b.endMin) });
    }
  }
  return out;
}

/** Sloučí překrývající se intervaly, aby se odstávka neodečetla dvakrát. */
function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else out.push({ ...iv });
  }
  return out;
}

/**
 * Dostupné pracovní hodiny stroje v rozsahu civil date (inclusive), **po odečtení odstávek**.
 *
 * Bez odečtení tvrdil report o týdnu celozávodní dovolené „0 % ze 152 dostupných hodin“
 * místo poctivého „0 z 0“ — čitatel odstávku respektuje (expanze tisku v ní vrátí
 * START_NOT_RUNNABLE), jmenovatel ji dřív ignoroval. Na produkci 153,9 h v prosinci 2026.
 *
 * Směny se staví i pro den PŘED rozsahem: noční směna patří ke dni svého startu a do
 * okna zasahuje ocasem po půlnoci. Ořez oknem pak zajistí, že se počítají jen hodiny
 * uvnitř zvoleného období.
 */
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayRow[],
): number {
  const winStart = pragueToUTC(rangeStart, 0, 0).getTime();
  const winEnd = pragueToUTC(addDaysToCivilDate(rangeEnd, 1), 0, 0).getTime();
  if (winEnd <= winStart) return 0;

  const shifts: Interval[] = [];
  let cur = addDaysToCivilDate(rangeStart, -1);
  while (cur <= rangeEnd) {
    const weekStart = weekStartStrFromDateStr(cur);
    const dayOfWeek = new Date(cur + "T12:00:00Z").getUTCDay();
    const row = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek,
    );
    if (row && row.isActive) shifts.push(...shiftIntervalsForDay(row, cur));
    cur = addDaysToCivilDate(cur, 1);
  }

  const shutdowns = mergeIntervals(
    companyDayIntervalsFor(machine, companyDays).map((i) => ({
      start: i.start.getTime(),
      end: i.end.getTime(),
    })),
  );

  let ms = 0;
  for (const iv of shifts) {
    const s = Math.max(iv.start, winStart);
    const e = Math.min(iv.end, winEnd);
    if (e <= s) continue;
    let free = e - s;
    for (const sd of shutdowns) {
      free -= Math.max(0, Math.min(e, sd.end) - Math.max(s, sd.start));
    }
    ms += Math.max(0, free);
  }
  return ms / 3_600_000;
}
```

Do existujících `it` bloků v `describe("computeAvailableHours", …)` doplnit pátý argument `[]` (prázdné odstávky), aby dál procházely beze změny očekávaných hodnot.

- [ ] **Step 4: Spustit testy**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS — včetně původních testů (80 h za pracovní týden, 6 h noční ocas z neděle)

- [ ] **Step 5: Předat odstávky ve všech čtyřech voláních**

V `src/app/api/report/dashboard/route.ts` doplnit `companyDays` jako pátý argument na řádcích `173`, `192`, `337` a `357`. Proměnná `companyDays` je v obou handlerech už načtená.

- [ ] **Step 6: Ověřit a commitnout**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts` → PASS
Run: `npx tsc --noEmit` → bez chyb

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts src/app/api/report/dashboard/route.ts
git commit -m "fix(reporty): odstávky se odečtou z dostupné kapacity

Jmenovatel odstávku ignoroval, čitatel ji respektuje — týden
celozávodní dovolené se vykázal jako 0 % ze 152 dostupných hodin
místo 0 z 0. Na produkci 153,9 h v prosinci 2026.

Filtr strojů jde přes companyDayIntervalsFor, kde je pravidlo
\"machine = null znamená oba stroje\" napsané jednou."
```

---

### Task 3: Souhrn se ořezává na období

Řeší **F3** (26 h ze 399 h v srpnu) a tím i **F4** (souhrn ≠ graf).

**Files:**
- Modify: `src/lib/reportMetrics.ts` (ruší `computeBlockHours` a `blockDurationHours`)
- Modify: `src/app/api/report/dashboard/route.ts:174-175` (retro), `:339-341` (outlook), importy
- Test: `src/lib/reportMetrics.test.ts`

**Interfaces:**
- Consumes: `computeAvailableHours(…, companyDays)` z Tasku 2
- Produces: nic nového; **mizí** `computeBlockHours` a `blockDurationHours`

**Kontext:** Route načte bloky, které rozsah jen protínají, a sečte jejich **celou** délku, kdežto jmenovatel je ořezaný. Chyba je oboustranná a vždy nahoru; tytéž bloky se započtou znovu i v dalším období, takže součet dvanácti měsíců nedá rok. Denní graf přitom ořez **už umí** (`printOverlapMinutes`) — souhrn se na něj jen napojí a obě čísla přestanou být dvě definice.

`blockDurationHours` má jediného volajícího mimo `computeBlockHours` — právě řádek `:341`, který se tímhle taskem nahrazuje. Po opravě by zůstalo mrtvé, proto se ruší taky (ověřeno grepem).

- [ ] **Step 1: Napsat strážný test parity**

Do `src/lib/reportMetrics.test.ts` přidat na konec:

```ts
describe("parita souhrnu a denního grafu", () => {
  it("součet denních ořezů se rovná ořezu celého okna", () => {
    // Blok 12. 8. 20:00 → 14. 8. 04:00 UTC (bez segmentů = ořez celého spanu),
    // okno 12.–13. 8., tedy blok přesahuje zprava.
    const b = { startTime: new Date("2026-08-12T20:00:00Z"), endTime: new Date("2026-08-14T04:00:00Z") };
    const winStart = new Date("2026-08-12T00:00:00Z");
    const winEnd = new Date("2026-08-14T00:00:00Z");

    const whole = printOverlapMinutes(null, b, winStart, winEnd);

    let daily = 0;
    for (const [ds, de] of [
      ["2026-08-12T00:00:00Z", "2026-08-13T00:00:00Z"],
      ["2026-08-13T00:00:00Z", "2026-08-14T00:00:00Z"],
    ]) {
      daily += printOverlapMinutes(null, b, new Date(ds), new Date(de));
    }
    // den 12.: 20:00-24:00 = 240 min; den 13.: celý = 1440 min
    assert.equal(whole, 1680);
    assert.equal(daily, 1680);
    assert.notEqual(whole, (b.endTime.getTime() - b.startTime.getTime()) / 60000); // celý blok = 1920 min
  });
});
```

Do importů testu přidat `import { printOverlapMinutes } from "./printTimeClient";` a **odstranit** `computeBlockHours` z importu z `./reportMetrics`; smazat celý blok `describe("computeBlockHours", …)`, pokud existuje.

- [ ] **Step 2: Spustit testy a ověřit, že projdou nebo selžou na importu**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL na importu `computeBlockHours`, dokud se v Step 3 neodstraní ze zdroje. Samotný test parity projde — dokazuje, že `printOverlapMinutes` ořez umí, a je pojistkou proti budoucí regresi.

- [ ] **Step 3: Odstranit obě funkce ze zdroje**

V `src/lib/reportMetrics.ts` smazat celou sekci 7 (`blockDurationHours` i `computeBlockHours`).

- [ ] **Step 4: Napojit ořez v retro režimu**

V `src/app/api/report/dashboard/route.ts` z importu odstranit `computeBlockHours,` a `blockDurationHours,`.

Ve funkci `handleRetro` nahradit řádky `:174-175`:

```ts
    // Souhrn se ořezává STEJNĚ jako denní graf. Dřív se sčítala celá délka bloků, které
    // období jen protínají, kdežto dostupné hodiny ořezané byly — na produkci 26 h ze
    // 399 h v srpnu 2026, a tytéž hodiny se započetly znovu i v září. Tímhle zároveň
    // mizí rozpor mezi kartou a grafem pod ní: obě čísla jedou přes týž `segMap`.
    const clippedHours = (b: (typeof blockInputs)[number]) =>
      printOverlapMinutes(segMap.get(b) ?? null, b, startUtc, endUtc) / 60;
    const sumClipped = (type: string) =>
      Math.round(blockInputs.filter((b) => b.machine === machine && b.type === type).reduce((s, b) => s + clippedHours(b), 0) * 100) / 100;

    const productionHours = sumClipped("ZAKAZKA");
    const maintenanceHours = sumClipped("UDRZBA");
```

- [ ] **Step 5: Napojit ořez ve výhledu**

Ve funkci `handleOutlook` nahradit řádky `:339-341`:

```ts
    // Týž ořez jako v retro režimu i jako v denním grafu níž — viz komentář v `handleRetro`.
    const plannedHours = blockInputs
      .filter((b) => b.machine === machine)
      .reduce((sum, b) => sum + printOverlapMinutes(segMap.get(b) ?? null, b, startUtc, endUtc) / 60, 0);
```

- [ ] **Step 6: Ověřit paritu proti dev databázi**

Porovnej souhrn s denním součtem nad skutečnými daty — po opravě se musí rovnat:

```bash
npx tsx -e '
import { PrismaClient } from "@prisma/client";
import { serializeWeekShifts } from "./src/lib/scheduleValidation";
import { blockReportSegments, printOverlapMinutes } from "./src/lib/printTimeClient";
import { pragueToUTC, addDaysToCivilDate } from "./src/lib/dateUtils";
const p = new PrismaClient();
(async () => {
  const rangeStart = "2026-08-01", rangeEnd = "2026-08-31";
  const startUtc = pragueToUTC(rangeStart, 0, 0), endUtc = pragueToUTC(addDaysToCivilDate(rangeEnd, 1), 0, 0);
  const blocks = await p.block.findMany({ where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } } });
  const ws = serializeWeekShifts(await p.machineWeekShifts.findMany());
  const cd = await p.companyDay.findMany();
  for (const m of ["XL_105","XL_106"]) {
    const mine = blocks.filter(b => b.machine === m && b.type === "ZAKAZKA");
    const seg = new Map(mine.map(b => [b, blockReportSegments(b as never, ws, cd as never)]));
    const whole = mine.reduce((s,b) => s + printOverlapMinutes(seg.get(b) ?? null, b as never, startUtc, endUtc)/60, 0);
    let daily = 0;
    for (let d = rangeStart; d <= rangeEnd; d = addDaysToCivilDate(d,1)) {
      const ds = pragueToUTC(d,0,0), de = pragueToUTC(addDaysToCivilDate(d,1),0,0);
      daily += mine.reduce((s,b) => s + printOverlapMinutes(seg.get(b) ?? null, b as never, ds, de)/60, 0);
    }
    console.log(m, "souhrn", whole.toFixed(2), "| denní součet", daily.toFixed(2), whole.toFixed(2) === daily.toFixed(2) ? "✓ SEDÍ" : "✗ ROZCHÁZÍ SE");
  }
  await p.$disconnect();
})();'
```
Expected: obě řádky „✓ SEDÍ"

- [ ] **Step 7: Ověřit a commitnout**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts` → PASS
Run: `npx tsc --noEmit` → bez chyb

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts src/app/api/report/dashboard/route.ts
git commit -m "fix(reporty): souhrn se ořezává na období stejně jako denní graf

Sčítala se celá délka bloků, které období jen protínají, kdežto
dostupné hodiny ořezané byly — na produkci 26 h ze 399 h v srpnu 2026
a týchž 26 h se započetlo znovu i v září (až 12 %). Součet dvanácti
měsíčních reportů proto nedal rok.

Obě čísla teď jedou přes týž segMap, takže mizí i rozpor mezi kartou
a grafem pod ní. computeBlockHours a blockDurationHours se ruší —
po téhle změně nemají volajícího."
```

---

### Task 4: Nulová kapacita vrací „nevím", ne nulu

Řeší první polovinu **F7**.

**Files:**
- Modify: `src/lib/reportMetrics.ts` (`computeUtilization`)
- Modify: `src/app/api/report/dashboard/route.ts:176, 196, 343, 361`
- Modify: `src/app/reporty/_components/ReportDashboard.tsx` (typy + render KPI, graf, heatmapa)
- Test: `src/lib/reportMetrics.test.ts`

**Interfaces:**
- Consumes: Tasky 1–3
- Produces: `export function computeUtilization(productionHours: number, availableHours: number): number | null;`

**Kontext:** Dnes se při `availableHours <= 0` vrací `0`, takže „8 h zakázky ve dni bez směny" a „nic naplánováno" vypadají identicky. Od dubna 2027, kam nesahají šablony směn, by report tvrdil „nula naplánováno, nula volno" místo „nejsou nastavené směny".

**Pozor na dosah:** `computeUtilization` se volá i v denních smyčkách obou režimů (čtyři místa), takže se `null` propíše do `dailyUtilization` i `dailyCapacity` a odtud do grafu a heatmapy. **Je to záměr** — den, kdy stroj nejede, se konečně odliší od dne bez práce. V R1 stačí, aby ho UI nevykreslilo jako nulu; šrafu a legendu řeší R3.

- [ ] **Step 1: Upravit testy**

V `describe("computeUtilization", …)` nahradit test `it("0 available → 0%", …)`:

```ts
  it("nulová kapacita → null, ne 0 (jinak „stroj nejede“ vypadá jako „nic se nedělá“)", () => {
    assert.equal(computeUtilization(0, 0), null);
    assert.equal(computeUtilization(50, 0), null);
  });

  it("nezastropuje se nad 100 % — číslo má být poctivé", () => {
    assert.equal(computeUtilization(30, 8), 375);
  });
```

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — `computeUtilization(0, 0)` vrací `0`, očekává se `null`

- [ ] **Step 3: Upravit funkci**

V `src/lib/reportMetrics.ts`:

```ts
/**
 * Procento využití. `null` při nulové kapacitě — víkend, odstávka nebo chybějící
 * šablony směn NEJSOU „nula procent“, ale „není z čeho počítat“. Bez toho rozlišení
 * vypadá den, kdy stroj nejede, stejně jako den, na který nikdo nic nenaplánoval.
 *
 * Nad 100 % se ZÁMĚRNĚ nezastropuje — přeplánování musí být vidět. Odlišit ho barevně
 * je úkol UI, ne téhle funkce.
 */
export function computeUtilization(productionHours: number, availableHours: number): number | null {
  if (availableHours <= 0) return null;
  return Math.round((productionHours / availableHours) * 100);
}
```

- [ ] **Step 4: Spustit testy**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS

- [ ] **Step 5: Srovnat typy v routě**

V `src/app/api/report/dashboard/route.ts` rozšířit typy obou map `machines` a obou denních polí o `| null`:

```ts
  const machines: Record<string, { utilization: number | null; productionHours: number; maintenanceHours: number; availableHours: number }> = {};
```
```ts
  const dailyUtilization: Array<{ date: string; XL_105: number | null; XL_106: number | null }> = [];
```
```ts
  const machines: Record<string, { plannedCapacity: number | null; freeHours: number; availableHours: number }> = {};
```
```ts
  const dailyCapacity: Array<{ date: string; XL_105: number | null; XL_106: number | null }> = [];
```

a stejně tak typ `entry` uvnitř obou denních smyček.

- [ ] **Step 6: Srovnat klienta**

V `src/app/reporty/_components/ReportDashboard.tsx`:

Typy nahoře (řádky ~22-45) rozšířit o `| null` u `utilization`, `plannedCapacity` a u obou denních polí.

Karty vytížení (řádky ~208-218) a kapacity (~305-316) — hodnota `null` se vypíše jako „—" a nedostane barvu:

```tsx
          value={xl105?.utilization == null ? "—" : `${xl105.utilization}%`}
          color={xl105?.utilization == null ? undefined : xl105.utilization > 100 ? "#f85149" : xl105.utilization >= 80 ? "#3fb950" : "#f0883e"}
```

(Stejný tvar pro XL 106 a pro obě karty kapacity, kde je pole `plannedCapacity`.
Hex literály tu už jsou — R1 je nepřidává, jen doplňuje větev nad 100 %; převod na tokeny řeší R2.)

V `BarChart` přeskočit `null` hodnoty — v `maxVal` i při vykreslení:

```tsx
  const maxVal = Math.max(...data.flatMap((d) => barKeys.map((k) => (d[k] as number | null) ?? 0)), 1);
```
```tsx
              {barKeys.map((k, ki) => {
                const v = d[k] as number | null;
                // Den bez směn se NEkreslí jako nulový sloupec — „stroj nejede“ není „nic se nedělá“.
                if (v == null) return <div key={k} style={{ flex: 1 }} title={`${d.date ?? ""}: stroj nejede`} />;
                return (
                  <div key={k} style={{
                    flex: 1, background: colors[ki], borderRadius: "2px 2px 0 0",
                    height: `${Math.max(2, v / maxVal * 100)}%`, minHeight: 2,
                  }} title={`${d.date ?? ""}: ${v}%`} />
                );
              })}
```

V heatmapě upravit `heatColor` a vykreslení dlaždice:

```tsx
  function heatColor(pct: number | null): string {
    if (pct == null) return "var(--surface-3)";   // stroj nejede
    if (pct > 100) return "#f85149";              // přeplánováno
    if (pct === 0) return "var(--surface-2)";
    if (pct >= 80) return "#3fb950";
    if (pct >= 50) return "#f0883e";
    return "#f85149";
  }
```
```tsx
                const val = (d[m] as number | null) ?? null;
                return (
                  <div key={d.date} style={{
                    height: 24, borderRadius: 3, background: heatColor(val),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, color: val != null && val > 0 ? "#fff" : "var(--text-muted)", fontWeight: 600,
                  }} title={`${d.date}: ${val == null ? "stroj nejede" : val + " %"}`}>
                    {val == null ? "" : val > 0 ? `${val}` : ""}
                  </div>
                );
```

- [ ] **Step 7: Ověřit a commitnout**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts` → PASS
Run: `npx tsc --noEmit` → bez chyb

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts src/app/api/report/dashboard/route.ts src/app/reporty/_components/ReportDashboard.tsx
git commit -m "fix(reporty): nulová kapacita vrací null, ne nulu

Víkend, odstávka a chybějící šablony směn nejsou \"nula procent\", ale
\"není z čeho počítat\". Bez toho rozlišení vypadal den, kdy stroj
nejede, stejně jako den bez práce — a od dubna 2027, kam nesahají
šablony, by report tvrdil nulu místo přiznání.

Utilizace se nezastropuje; nad 100 % dostává v UI vlastní barvu,
takže přeplánování už nesvítí zeleně."
```

---

### Task 5: Přeplánování místo useknuté nuly

Řeší druhou polovinu **F7**.

**Files:**
- Modify: `src/app/api/report/dashboard/route.ts:342` (výpočet `freeHours`)
- Modify: `src/app/reporty/_components/ReportDashboard.tsx` (typ + render karet kapacity)

**Interfaces:**
- Consumes: `computeUtilization` z Tasku 4, ořezané `plannedHours` z Tasku 3
- Produces: v odpovědi `machines[m]` přibývá `overbookedHours: number` (kladné číslo, o kolik hodin je nad kapacitou; 0 když se vejde)

**Kontext:** `Math.max(0, available - planned)` spolu s tím, že `plannedCapacity` strop nemá, vyrábí protimluv na jedné kartě: „286 %" a „0 h volných". Přeplánování je přitom to nejdůležitější, co má Výhled říct.

- [ ] **Step 1: Upravit výpočet v routě**

V `handleOutlook` nahradit řádek `:342`:

```ts
    // `freeHours` se ZÁMĚRNĚ neusekává na nule — „0 h volných“ a „přeplánováno o 26 h“
    // jsou dvě různé zprávy a plánovač potřebuje tu druhou. Kladné `overbookedHours`
    // je ta část, o kterou je stroj nad kapacitou.
    const remaining = Math.round((availableHours - plannedHours) * 100) / 100;
    const freeHours = Math.max(0, remaining);
    const overbookedHours = Math.max(0, -remaining);
```

a doplnit `overbookedHours` do objektu `machines[machine]`.

- [ ] **Step 2: Srovnat typ na klientovi**

V `src/app/reporty/_components/ReportDashboard.tsx` doplnit do typu výhledových strojů `overbookedHours: number;`.

- [ ] **Step 3: Zobrazit přeplánování místo nuly**

Nahradit podtitulek obou karet kapacity:

```tsx
          subtitle={(xl105?.overbookedHours ?? 0) > 0
            ? `přeplánováno o ${String(xl105!.overbookedHours).replace(".", ",")} h`
            : `${String(xl105?.freeHours ?? 0).replace(".", ",")} h volných`}
```

(Stejně pro XL 106.)

- [ ] **Step 4: Ověřit ručním výpočtem**

Run:
```bash
npx tsx -e '
const availableHours = 24, plannedHours = 40;
const remaining = Math.round((availableHours - plannedHours) * 100) / 100;
console.log("volné:", Math.max(0, remaining), "| přeplánováno:", Math.max(0, -remaining));
'
```
Expected: `volné: 0 | přeplánováno: 16`

- [ ] **Step 5: Ověřit a commitnout**

Run: `npx tsc --noEmit` → bez chyb

```bash
git add src/app/api/report/dashboard/route.ts src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(reporty): přeplánování v hodinách místo useknuté nuly

\"0 h volných\" a \"přeplánováno o 26 h\" jsou dvě různé zprávy;
plánovač potřebuje tu druhou. Dohromady s Task 3 a 4 tím přestává být
přeplánování schované třemi vrstvami naráz."
```

---

### Task 6: Rezervace — všech osm stavů, oddělený stav a období, poctivá konverze

Řeší **F5**.

**Files:**
- Create: `src/lib/reservationStatus.ts`
- Create: `src/lib/reservationStatus.test.ts`
- Modify: `src/app/api/report/dashboard/route.ts:134-142` (dotaz), `:249-256` (výpočet), tvar odpovědi
- Modify: `src/app/reporty/_components/ReportDashboard.tsx:30` (typ), `:187-196` (klíče a popisky), `:257-281` (render)

**Interfaces:**
- Consumes: nic z předchozích tasků
- Produces:
  ```ts
  export const RESERVATION_STATUSES: readonly string[];
  export const OPEN_STATUSES: readonly string[];
  export const CLOSED_STATUSES: readonly string[];
  export const SUCCESS_STATUSES: readonly string[];
  export function computeConversionPercent(closed: Record<string, number>): number | null;
  ```
  Tvar `pipeline` v odpovědi: `{ open: Record<string, number>; closed: Record<string, number>; conversionPercent: number | null }`

**Kontext:** Trychtýř zná 5 stavů, aplikace jich používá 8 (`src/app/api/reservations/route.ts:30-36`). Mimo zůstávají `CONFIRMED`, `COUNTER_PROPOSED` a `WITHDRAWN`. `CONFIRMED` je přitom **koncový úspěch**, takže vypadne z čitatele, kdežto zamítnutá rezervace ve jmenovateli zůstane napořád — **konverze klesá tím rychleji, čím lépe proces funguje.** Dotaz navíc míchá stock a flow: otevřené stavy bez ohledu na období, uzavřené jen z období (doloženo — v srpnovém reportu se objevily rezervace z března).

Rozhodnutí Vojty: **konverze = úspěšně vyřízené ze všech uzavřených.**

- [ ] **Step 1: Napsat failující testy**

Vytvořit `src/lib/reservationStatus.test.ts`:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVATION_STATUSES, OPEN_STATUSES, CLOSED_STATUSES, SUCCESS_STATUSES,
  computeConversionPercent,
} from "./reservationStatus";

describe("slovník stavů rezervací", () => {
  it("otevřené a uzavřené dohromady pokrývají VŠECHNY stavy a nepřekrývají se", () => {
    const union = [...OPEN_STATUSES, ...CLOSED_STATUSES].sort();
    assert.deepEqual(union, [...RESERVATION_STATUSES].sort());
    assert.equal(new Set(union).size, union.length, "stav je ve dvou skupinách naráz");
  });

  it("úspěšné stavy jsou podmnožinou uzavřených", () => {
    for (const s of SUCCESS_STATUSES) assert.ok(CLOSED_STATUSES.includes(s), `${s} není mezi uzavřenými`);
  });

  it("CONFIRMED se počítá jako úspěch — jinak konverze klesá, čím lépe proces běží", () => {
    assert.ok(SUCCESS_STATUSES.includes("CONFIRMED"));
  });
});

describe("computeConversionPercent", () => {
  it("úspěšně vyřízené ze všech uzavřených", () => {
    assert.equal(computeConversionPercent({ SCHEDULED: 7, CONFIRMED: 6, REJECTED: 3, WITHDRAWN: 0 }), 81);
  });

  it("prázdný jmenovatel → null, ne 0 % (0 % vypadá jako katastrofa)", () => {
    assert.equal(computeConversionPercent({ SCHEDULED: 0, CONFIRMED: 0, REJECTED: 0, WITHDRAWN: 0 }), null);
  });

  it("neznámý stav v datech neshodí výpočet", () => {
    assert.equal(computeConversionPercent({ SCHEDULED: 1, NEZNAMY: 5 }), 100);
  });
});
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `node --test --import tsx src/lib/reservationStatus.test.ts`
Expected: FAIL — modul `./reservationStatus` neexistuje

- [ ] **Step 3: Vytvořit slovník**

Vytvořit `src/lib/reservationStatus.ts`:

```ts
/**
 * Slovník stavů rezervace — JEDINÝ zdroj pravdy.
 *
 * Vznikl proto, že report znal jen 5 z 8 stavů: mimo trychtýř zůstávaly `CONFIRMED`,
 * `COUNTER_PROPOSED` a `WITHDRAWN`. `CONFIRMED` je přitom koncový ÚSPĚCH, takže vypadl
 * z čitatele konverze, kdežto zamítnutá rezervace ve jmenovateli zůstala napořád —
 * konverze tím klesala rychleji, čím lépe proces fungoval.
 *
 * Nový stav → doplnit sem, jinak shodí strážný test. Bez toho se dnešní vada
 * přidáním devátého stavu tiše zopakuje.
 */
export const RESERVATION_STATUSES = [
  "SUBMITTED", "ACCEPTED", "QUEUE_READY", "COUNTER_PROPOSED",
  "SCHEDULED", "CONFIRMED", "REJECTED", "WITHDRAWN",
] as const;

/** Rezervace, které se ještě řeší — stav k dnešku, nezávislý na období. */
export const OPEN_STATUSES = ["SUBMITTED", "ACCEPTED", "QUEUE_READY", "COUNTER_PROPOSED"] as const;

/** Rezervace, které už dopadly nějak — počítají se za období. */
export const CLOSED_STATUSES = ["SCHEDULED", "CONFIRMED", "REJECTED", "WITHDRAWN"] as const;

/** Uzavřené, které skončily prací. */
export const SUCCESS_STATUSES = ["SCHEDULED", "CONFIRMED"] as const;

/**
 * Úspěšně vyřízené ze všech uzavřených (rozhodnutí Vojty 14. 8. 2026).
 * `null` při prázdném jmenovateli — „0 %“ u prázdné fronty vypadá jako katastrofa
 * místo „není co měřit“.
 */
export function computeConversionPercent(closed: Record<string, number>): number | null {
  const total = CLOSED_STATUSES.reduce((s, k) => s + (closed[k] ?? 0), 0);
  if (total <= 0) return null;
  const success = SUCCESS_STATUSES.reduce((s, k) => s + (closed[k] ?? 0), 0);
  return Math.round((success / total) * 100);
}
```

- [ ] **Step 4: Spustit test**

Run: `node --test --import tsx src/lib/reservationStatus.test.ts`
Expected: PASS

- [ ] **Step 5: Přepojit routu**

V `src/app/api/report/dashboard/route.ts` doplnit import:

```ts
import { OPEN_STATUSES, CLOSED_STATUSES, computeConversionPercent } from "@/lib/reservationStatus";
```

Nahradit dotaz na rezervace (`:134-142`) dvěma jasně oddělenými dotazy:

```ts
    // Dvě RŮZNÉ populace, dřív slepené jedním OR: otevřené = stav k dnešku bez ohledu
    // na období, uzavřené = ty, které v období skončily. Slepené to způsobovalo, že se
    // v srpnovém reportu objevily rezervace z března.
    prisma.reservation.findMany({
      where: { status: { in: [...OPEN_STATUSES] } },
      select: { status: true },
    }),
    prisma.reservation.findMany({
      where: { status: { in: [...CLOSED_STATUSES] }, createdAt: { gte: startUtc, lt: endUtc } },
      select: { status: true },
    }),
```

(V `Promise.all` tím přibude jeden prvek — destrukturalizaci `const [blocks, revisions, migrationRows, rawWeekShifts, reservations, companyDays]` uprav na `…, openReservations, closedReservations, companyDays]` a pořadí v poli srovnej.)

Nahradit výpočet (`:249-256`):

```ts
  const countByStatus = (rows: { status: string }[], allowed: readonly string[]) => {
    const out: Record<string, number> = {};
    for (const s of allowed) out[s] = 0;
    for (const r of rows) if (r.status in out) out[r.status]++;
    return out;
  };
  const openCounts = countByStatus(openReservations, OPEN_STATUSES);
  const closedCounts = countByStatus(closedReservations, CLOSED_STATUSES);
  const conversionPercent = computeConversionPercent(closedCounts);
```

a v odpovědi nahradit `pipeline: { ...statusCounts, conversionPercent }`:

```ts
    pipeline: { open: openCounts, closed: closedCounts, conversionPercent },
```

- [ ] **Step 6: Srovnat klienta**

V `src/app/reporty/_components/ReportDashboard.tsx` nahradit typ na řádku 30:

```ts
  pipeline: { open: Record<string, number>; closed: Record<string, number>; conversionPercent: number | null };
```

Nahradit klíče a popisky (`:187-196`):

```tsx
  const pipelineOpen = ["SUBMITTED", "ACCEPTED", "QUEUE_READY", "COUNTER_PROPOSED"] as const;
  const pipelineClosed = ["SCHEDULED", "CONFIRMED", "REJECTED", "WITHDRAWN"] as const;
  const pipelineColors: Record<string, string> = {
    SUBMITTED: "#f0883e", ACCEPTED: "#3b82f6", QUEUE_READY: "#a371f7", COUNTER_PROPOSED: "#d29922",
    SCHEDULED: "#3fb950", CONFIRMED: "#2ea043", REJECTED: "#f85149", WITHDRAWN: "#8b949e",
  };
  const pipelineLabels: Record<string, string> = {
    SUBMITTED: "Nové", ACCEPTED: "Přijaté", QUEUE_READY: "Ve frontě", COUNTER_PROPOSED: "Protinávrh",
    SCHEDULED: "Naplánované", CONFIRMED: "Potvrzené", REJECTED: "Zamítnuté", WITHDRAWN: "Stažené",
  };
  const openTotal = pipelineOpen.reduce((s, k) => s + (data.pipeline.open[k] ?? 0), 0);
  const closedTotal = pipelineClosed.reduce((s, k) => s + (data.pipeline.closed[k] ?? 0), 0);
```

V bloku OBCHOD (`:257-281`) rozdělit na dvě legendy s jasnými nadpisy a opravit popisek konverze:

```tsx
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
          Otevřené rezervace — stav k dnešku, nezávisle na období
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
          {pipelineOpen.map((k) => (
            <span key={k} style={{ fontSize: 11, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineColors[k], display: "inline-block" }} />
              {pipelineLabels[k]}: {data.pipeline.open[k] ?? 0}
            </span>
          ))}
          {openTotal === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>žádné</span>}
        </div>

        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>Uzavřené v období</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
          {pipelineClosed.map((k) => (
            <span key={k} style={{ fontSize: 11, color: "var(--text)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineColors[k], display: "inline-block" }} />
              {pipelineLabels[k]}: {data.pipeline.closed[k] ?? 0}
            </span>
          ))}
          {closedTotal === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>žádné</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Konverze: <strong style={{ color: "var(--text)" }}>
            {data.pipeline.conversionPercent == null ? "—" : `${data.pipeline.conversionPercent} %`}
          </strong> (úspěšně vyřízené z uzavřených)
        </div>
```

Starý stacked bar (`:260-270`) odstranit — s dvěma populacemi jeden pruh nedává smysl a jeho tvar řeší R3.

- [ ] **Step 7: Ověřit a commitnout**

Run: `node --test --import tsx src/lib/reservationStatus.test.ts` → PASS
Run: `npx tsc --noEmit` → bez chyb

```bash
git add src/lib/reservationStatus.ts src/lib/reservationStatus.test.ts src/app/api/report/dashboard/route.ts src/app/reporty/_components/ReportDashboard.tsx
git commit -m "fix(reporty): rezervace — všech 8 stavů, oddělený stav a období, poctivá konverze

Trychtýř znal 5 z 8 stavů; CONFIRMED je koncový úspěch, takže vypadl
z čitatele, kdežto zamítnutá rezervace ve jmenovateli zůstala
napořád — konverze klesala tím rychleji, čím lépe proces fungoval.

Dotaz navíc míchal stock a flow (v srpnovém reportu se objevily
rezervace z března). Nově dva dotazy a dvě pojmenované skupiny.
Popisek konverze se srovnal s výpočtem; prázdný jmenovatel dává
\"—\" místo \"0 %\"."
```

---

### Task 7: Drobnosti — proběhlé údržby, ratio per stroj, česká čárka

Řeší **F8**.

**Files:**
- Modify: `src/app/api/report/dashboard/route.ts` (filtr údržeb, `maintenanceRatio` per stroj)
- Modify: `src/app/reporty/_components/ReportDashboard.tsx` (čárka, `tabular-nums`, popisek fronty)
- Modify: `src/app/reporty/_components/PlanningSection.tsx` (`tabular-nums`)
- Modify: `src/app/reporty/_components/KpiCard.tsx` (`tabular-nums`)

**Interfaces:**
- Consumes: vše z Tasků 1–6
- Produces: `machines[m].maintenanceRatio: number | null` v retro odpovědi

- [ ] **Step 1: Filtr proběhlých údržeb**

V `handleOutlook` nahradit `upcomingMaintenance` (`:368-376`):

```ts
  // Období může začínat v minulosti, a protože se řadí vzestupně a bere prvních pět,
  // obsadily „plánované“ údržby ty, které už proběhly (měsíční pohled ke 14. 8. vypisoval
  // dvě údržby z 5. 8.). Filtr na `endTime > now` to řeší u zdroje.
  const nowMs = Date.now();
  const upcomingMaintenance = blocks
    .filter((b) => b.type === "UDRZBA" && b.endTime.getTime() > nowMs)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .map((b) => ({
      machine: b.machine,
      description: b.description ?? "",
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
    }));
```

- [ ] **Step 2: Ratio údržby i per stroj**

V `handleRetro` uvnitř smyčky přes stroje doplnit do `machines[machine]`:

```ts
      maintenanceRatio: computeMaintenanceRatio(maintenanceHours, availableHours),
```

a v `computeMaintenanceRatio` (`src/lib/reportMetrics.ts`) srovnat chování s `computeUtilization`:

```ts
/** Procento údržby z dostupných hodin. `null` při nulové kapacitě — viz `computeUtilization`. */
export function computeMaintenanceRatio(maintenanceHours: number, availableHours: number): number | null {
  if (availableHours <= 0) return null;
  return Math.round((maintenanceHours / availableHours) * 100);
}
```

Celkové `maintenanceRatio` v odpovědi zůstává (souhrn přes oba stroje), jen dostane typ `number | null`. V `ReportDashboard.tsx` u karty „Údržba ratio" vypsat `—` při `null`.

Do `describe("computeMaintenanceRatio", …)` v testech přidat:

```ts
  it("nulová kapacita → null", () => {
    assert.equal(computeMaintenanceRatio(5, 0), null);
  });
```

- [ ] **Step 3: Česká desetinná čárka a tabular-nums**

V `src/app/reporty/_components/KpiCard.tsx` doplnit do stylu hodnoty:

```tsx
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? "var(--text)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
```

V `ReportDashboard.tsx` u všech karet, kde se vypisují hodiny (`productionHours`, `availableHours`, `freeHours`), obalit hodnotu:

```tsx
value={`${String(xl105?.productionHours ?? 0).replace(".", ",")} h`}
```

V `PlanningSection.tsx` doplnit `fontVariantNumeric: "tabular-nums"` tam, kde se vypisují čísla mimo `KpiCard`.

- [ ] **Step 4: Popisek fronty rezervací**

V `ReportDashboard.tsx` u bloku „Nejstarší čekající" nahradit:

```tsx
            Nejstarší čekající: <strong style={{ color: data.pendingReservations.oldestWaitingDays > 3 ? "#f85149" : "var(--text)" }}>
              {data.pendingReservations.newCount === 0 ? "—" : `${data.pendingReservations.oldestWaitingDays} dní`}
            </strong>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>stav k dnešku, nezávisle na období</div>
```

Prázdná fronta tak přestane hlásit „0 dní", což vypadá jako právě přijatá rezervace.

- [ ] **Step 5: Spustit celou suite a typovou kontrolu**

Run:
```bash
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Expected: PASS, žádný selhaný test

Run: `npx tsc --noEmit` → bez chyb
Run: `npx eslint src/lib/reportMetrics.ts src/lib/reservationStatus.ts src/app/api/report/dashboard/route.ts src/app/reporty/_components/ReportDashboard.tsx` → 0 chyb

**Nespouštět `npm run build` ani dev server** — viz Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts src/app/api/report/dashboard/route.ts src/app/reporty/_components/ReportDashboard.tsx src/app/reporty/_components/PlanningSection.tsx src/app/reporty/_components/KpiCard.tsx
git commit -m "fix(reporty): proběhlé údržby, ratio per stroj, česká čárka

\"Plánované údržby\" vypisovaly údržby, které už proběhly (měsíční
pohled ke 14. 8. ukazoval dvě z 5. 8.). Ratio údržby přibylo i per
stroj, aby se odstávka jednoho neředila kapacitou druhého. Hodiny se
píšou s českou čárkou a tabular-nums, takže při přepnutí období
neposkakují. Prázdná fronta hlásí \"—\" místo \"0 dní\"."
```

---

## Po dokončení všech tasků

- [ ] **Ověřit dopad na dev datech**

Porovnat čísla před a po. Očekávané směry (ne přesné hodnoty):
- **průtok** může klesnout (rozdělené zakázky se přestanou počítat vícekrát) a zároveň stoupnout (přibudou dřív ztracené) — na dev by měl vyjít **3** místo dnešních 2,
- **produkční hodiny** klesnou v obdobích, kde bloky přesahují hranici,
- **dostupné hodiny** klesnou v obdobích s odstávkou.

- [ ] **Aktualizovat dokumentaci**

Do `docs/vyvoj-historie.md` sekci k 14. 8. 2026: co se opravilo, se změřenými čísly z produkce (3 ze 43, 26 h ze 399 h, 153,9 h).

Do `docs/POUCENI.md` řádek: **„Čitatel a jmenovatel se musí počítat nad touž množinou."** Čtyři nezávislé vady Reportů měly týž tvar — bloky se načetly celé, ale kapacita se ořezala; odstávku respektoval čitatel, ne jmenovatel; průtok počítal nad jinou množinou než období. Chyba jde vždy nahoru a nejde poznat z jednoho čísla. (Pozor: soubor bývá rozdělaný paralelní session — přidat až po jejím commitu.)

- [ ] **Nasazení**

Podle rozhodnutí Vojty jde R1 na produkci **společně s etapou Kontrolní panel**. Sled:
1. **Nejdřív migrace `20260811120000_add_pantone_in_stock_issued`** — bez ní se kontrola rozešlé split-skupiny ukáže jako „nespočteno".
2. `mysqldump` záloha.
3. Aplikace podle `docs/DEPLOY_WORKFLOW.md` doslova, včetně PRE/POST otisku dat.
4. Po nasazení ověřit v Reportech, že čísla dávají smysl, a v Kontrolním panelu 8 legacy nálezů rozešlých split-skupin.

**Upozornit Vojtu předem:** některá čísla po nasazení klesnou (utilizace o nadhodnocení, průtok o vícenásobně počítané rozdělené zakázky). Není to regrese, ale narovnání.
