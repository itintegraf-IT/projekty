import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeAvailableHours,
  computeUtilization,
  groupCompletedToOrders,
  computeThroughputFromOrders,
  computeAvgLeadTimeDaysFromOrders,
  computeMaintenanceRatio,
  computePlanStability,
  resolvePlanCoverage,
  computeCalendarCascade,
} from "./reportMetrics";
import { printOverlapMinutes } from "./printTimeClient";
import { addDaysToCivilDate } from "./dateUtils";
import type { MachineWeekShiftsRow } from "./machineWeekShifts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 2026-04-13 is Monday; weekStart for that week = 2026-04-13
const WEEK_START = "2026-04-13";

type ShiftFlags = { morningOn?: boolean; afternoonOn?: boolean; nightOn?: boolean; isActive?: boolean };

function makeRow(machine: string, dayOfWeek: number, flags: ShiftFlags = {}): MachineWeekShiftsRow {
  return {
    machine,
    weekStart: WEEK_START,
    dayOfWeek,
    isActive: flags.isActive ?? true,
    morningOn: flags.morningOn ?? false,
    afternoonOn: flags.afternoonOn ?? false,
    nightOn: flags.nightOn ?? false,
    morningStartMin: null,
    morningEndMin: null,
    afternoonStartMin: null,
    afternoonEndMin: null,
    nightStartMin: null,
    nightEndMin: null,
  };
}

/** Celý týden (Ne–So) stejných řádků pro zadaný `weekStart`. `patch` přepíše cokoliv dál. */
function makeWeekRows(
  machine: string,
  weekStart: string,
  flags: ShiftFlags,
  patch: Partial<MachineWeekShiftsRow> = {},
): MachineWeekShiftsRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ ...makeRow(machine, dow, flags), weekStart, ...patch }));
}

/** Mon-Fri 6-22 (16h/day), weekend off — default XL_105 weekShifts. */
function make16hShifts(machine = "XL_105"): MachineWeekShiftsRow[] {
  return [
    makeRow(machine, 0, { isActive: false }),                    // Sun
    makeRow(machine, 1, { morningOn: true, afternoonOn: true }), // Mon
    makeRow(machine, 2, { morningOn: true, afternoonOn: true }), // Tue
    makeRow(machine, 3, { morningOn: true, afternoonOn: true }), // Wed
    makeRow(machine, 4, { morningOn: true, afternoonOn: true }), // Thu
    makeRow(machine, 5, { morningOn: true, afternoonOn: true }), // Fri
    makeRow(machine, 6, { isActive: false }),                    // Sat
  ];
}

// ---------------------------------------------------------------------------
// computeAvailableHours
// ---------------------------------------------------------------------------
describe("computeAvailableHours", () => {
  it("Mon-Fri 16h shifts over a full work week → 80h", () => {
    // 2026-04-13 Mon .. 2026-04-17 Fri
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", make16hShifts(), []);
    assert.equal(result, 80);
  });

  it("weekend only → 0h", () => {
    // 2026-04-18 Sat, 2026-04-19 Sun
    const result = computeAvailableHours("XL_105", "2026-04-18", "2026-04-19", make16hShifts(), []);
    assert.equal(result, 0);
  });

  it("single day with morning-only shift → 8h (6-14)", () => {
    const shifts = make16hShifts();
    // Mon: only morning instead of morning+afternoon
    const monIdx = shifts.findIndex((r) => r.dayOfWeek === 1);
    shifts[monIdx] = makeRow("XL_105", 1, { morningOn: true });
    // Mon 8h + Tue-Fri 16h*4 = 72
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", shifts, []);
    assert.equal(result, 72);
  });

  it("day isActive=false → 0h for that day", () => {
    const shifts = make16hShifts();
    const tueIdx = shifts.findIndex((r) => r.dayOfWeek === 2);
    shifts[tueIdx] = makeRow("XL_105", 2, { isActive: false, morningOn: true, afternoonOn: true });
    // Tue disabled, Mon + Wed-Fri = 4 * 16 = 64
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", shifts, []);
    assert.equal(result, 64);
  });

  it("single day", () => {
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", make16hShifts(), []);
    assert.equal(result, 16);
  });

  it("ignores rows for other machines", () => {
    const shifts = [
      ...make16hShifts("XL_106"),
      makeRow("XL_105", 1, { morningOn: true, afternoonOn: true }),
    ];
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", shifts, []);
    assert.equal(result, 16);
  });

  it("respects morningEnd override (13:00) — 7h + 8h = 15h/day", () => {
    // Sprint G1: override-aware computation via resolveShiftBounds.
    // Monday with morning shortened to end at 13:00 instead of 14:00.
    const shifts = make16hShifts();
    const monIdx = shifts.findIndex((r) => r.dayOfWeek === 1);
    shifts[monIdx] = {
      ...makeRow("XL_105", 1, { morningOn: true, afternoonOn: true }),
      morningEndMin: 780, // 13:00
    };
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", shifts, []);
    assert.equal(result, 15);
  });

  it("respects morningStart override (7:00) — 7h + 8h = 15h/day", () => {
    // Sprint G1: override-aware computation via resolveShiftBounds.
    // Monday with morning starting at 7:00 instead of 6:00.
    const shifts = make16hShifts();
    const monIdx = shifts.findIndex((r) => r.dayOfWeek === 1);
    shifts[monIdx] = {
      ...makeRow("XL_105", 1, { morningOn: true, afternoonOn: true }),
      morningStartMin: 420, // 7:00
    };
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", shifts, []);
    assert.equal(result, 15);
  });

  // --- Forward semantic NIGHT wrap ---
  it("Ne NIGHT ✓, jen Ne v rozsahu → 2h (jen 22-24 část)", () => {
    const weekShifts: MachineWeekShiftsRow[] = [
      { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: true,
        morningOn: false, afternoonOn: false, nightOn: true,
        morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
        nightStartMin: null, nightEndMin: null },
    ];
    const hours = computeAvailableHours("XL_106", "2026-04-19", "2026-04-19", weekShifts, []);
    assert.equal(hours, 2, "Ne NIGHT přispívá jen 2h (22-24) na dni Ne; tail patří Po");
  });

  it("Ne NIGHT ✓ + Po vše ✗, jen Po v rozsahu → 6h (tail z neděle)", () => {
    const weekShifts: MachineWeekShiftsRow[] = [
      { id: undefined, machine: "XL_106", weekStart: "2026-04-13", dayOfWeek: 0, isActive: true,
        morningOn: false, afternoonOn: false, nightOn: true,
        morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
        nightStartMin: null, nightEndMin: null },
      { id: undefined, machine: "XL_106", weekStart: "2026-04-20", dayOfWeek: 1, isActive: false,
        morningOn: false, afternoonOn: false, nightOn: false,
        morningStartMin: null, morningEndMin: null, afternoonStartMin: null, afternoonEndMin: null,
        nightStartMin: null, nightEndMin: null },
    ];
    const hours = computeAvailableHours("XL_106", "2026-04-20", "2026-04-20", weekShifts, []);
    assert.equal(hours, 6, "Po dostane tail z Ne NIGHT (6h)");
  });

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

  it("překryv noční (do 08:00) s ranní (od 06:00) se NEZAPOČÍTÁ dvakrát — týden 24/7 = 168 h", () => {
    // `PUT /api/machine-week-shifts` validuje každou směnu izolovaně, takže noční
    // 22:00–08:00 (600 min = horní povolená mez) vedle výchozí ranní od 06:00 projde.
    // Bez slučování směn vycházelo 182 h místo 168 h (+2 h/den, tedy +8,3 % kapacity)
    // — a nafouknutý jmenovatel schová přeplánování.
    const rows = [
      // ocas noční z neděle 12. 4. (jiný týden!) pokrývá pondělní 00:00–08:00
      ...makeWeekRows("XL_105", "2026-04-06", { morningOn: true, afternoonOn: true, nightOn: true }, { nightEndMin: 480 }),
      ...makeWeekRows("XL_105", "2026-04-13", { morningOn: true, afternoonOn: true, nightOn: true }, { nightEndMin: 480 }),
    ];
    const hours = computeAvailableHours("XL_105", "2026-04-13", "2026-04-19", rows, []);
    assert.equal(hours, 168, "stroj běžící nepřetržitě má za týden 168 h, ne víc");
  });

  it("parita: součet po dnech = celý rozsah (i v týdnech s přechodem času)", () => {
    // Souhrnná karta a denní graf jedou přes touž funkci s jiným oknem. Kdyby se
    // rozešly, karta by tvrdila něco jiného než sloupce pod ní — a u směn přes
    // půlnoc je to přesně to místo, kde se dá minuta ztratit nebo zdvojit.
    const cases: Array<{ label: string; rows: MachineWeekShiftsRow[]; from: string; to: string }> = [
      { label: "pracovní týden 16 h", rows: make16hShifts(), from: "2026-04-13", to: "2026-04-17" },
      {
        label: "nepřetržitý provoz s překryvem směn",
        rows: [
          ...makeWeekRows("XL_105", "2026-04-06", { morningOn: true, afternoonOn: true, nightOn: true }, { nightEndMin: 480 }),
          ...makeWeekRows("XL_105", "2026-04-13", { morningOn: true, afternoonOn: true, nightOn: true }, { nightEndMin: 480 }),
        ],
        from: "2026-04-13",
        to: "2026-04-19",
      },
      {
        label: "jarní přechod času (2026-03-29)",
        rows: makeWeekRows("XL_105", "2026-03-23", { morningOn: true, afternoonOn: true, nightOn: true }),
        from: "2026-03-23",
        to: "2026-03-29",
      },
      {
        label: "podzimní přechod času (2026-10-25)",
        rows: makeWeekRows("XL_105", "2026-10-19", { morningOn: true, afternoonOn: true, nightOn: true }),
        from: "2026-10-19",
        to: "2026-10-25",
      },
    ];

    for (const c of cases) {
      const whole = computeAvailableHours("XL_105", c.from, c.to, c.rows, []);
      let daily = 0;
      let cur = c.from;
      while (cur <= c.to) {
        daily += computeAvailableHours("XL_105", cur, cur, c.rows, []);
        cur = addDaysToCivilDate(cur, 1);
      }
      assert.ok(Math.abs(whole - daily) < 1e-9, `${c.label}: celek ${whole} h ≠ součet dnů ${daily} h`);
    }
  });

  it("noční přes přechod času má 7 h na jaře a 9 h na podzim (skutečné hodiny, ne minuty ciferníku)", () => {
    // Hodiny se počítají z absolutních UTC okamžiků. Kdyby se někdo vrátil k odečítání
    // minut na ciferníku, obě čísla by vyšla 8 a nikdo by si toho nevšiml — dnes je
    // hlídá jen tenhle test.
    // jediná směna v týdnu: noční ze soboty (dow 6), aby v rozsahu nebylo nic jiného
    const onlySaturdayNight = (weekStart: string) =>
      makeWeekRows("XL_105", weekStart, {}).map((r) => (r.dayOfWeek === 6 ? { ...r, nightOn: true } : r));

    // So 28. 3. 22:00 CET → Ne 29. 3. 06:00 CEST; v noci se hodina přeskočí
    assert.equal(computeAvailableHours("XL_105", "2026-03-28", "2026-03-29", onlySaturdayNight("2026-03-23"), []), 7);

    // So 24. 10. 22:00 CEST → Ne 25. 10. 06:00 CET; hodina se opakuje
    assert.equal(computeAvailableHours("XL_105", "2026-10-24", "2026-10-25", onlySaturdayNight("2026-10-19"), []), 9);
  });
});

// ---------------------------------------------------------------------------
// computeUtilization
// ---------------------------------------------------------------------------
describe("computeUtilization", () => {
  it("50% utilization", () => {
    assert.equal(computeUtilization(40, 80), 50);
  });

  it("100% utilization", () => {
    assert.equal(computeUtilization(80, 80), 100);
  });

  it("nulová kapacita → null, ne 0 (jinak „stroj nejede“ vypadá jako „nic se nedělá“)", () => {
    assert.equal(computeUtilization(0, 0), null);
    assert.equal(computeUtilization(50, 0), null);
  });

  it("nezastropuje se nad 100 % — číslo má být poctivé", () => {
    assert.equal(computeUtilization(30, 8), 375);
  });

  it("rounds to nearest integer", () => {
    assert.equal(computeUtilization(1, 3), 33);
  });
});

// ---------------------------------------------------------------------------
// groupCompletedToOrders / průtok / lead time
// ---------------------------------------------------------------------------
// Okno „všechno", kde se testuje jen seskupení, ne příslušnost k období.
const ANY_FROM = new Date("2000-01-01T00:00:00Z");
const ANY_TO = new Date("2100-01-01T00:00:00Z");

describe("groupCompletedToOrders", () => {
  const D = (iso: string) => new Date(iso);

  it("rozdělená zakázka na dvou blocích → jedna zakázka", () => {
    const orders = groupCompletedToOrders([
      { id: 1, splitGroupId: 7, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-10T12:00:00Z") },
      { id: 2, splitGroupId: 7, createdAt: D("2026-08-05T08:00:00Z"), printCompletedAt: D("2026-08-11T09:00:00Z") },
    ], ANY_FROM, ANY_TO);
    assert.equal(orders.length, 1);
    // nejstarší založení a nejpozdější dokončení celé skupiny
    assert.equal(orders[0].createdAt.toISOString(), "2026-08-01T08:00:00.000Z");
    assert.equal(orders[0].completedAt.toISOString(), "2026-08-11T09:00:00.000Z");
  });

  it("nerozdělené bloky jsou samostatné zakázky", () => {
    const orders = groupCompletedToOrders([
      { id: 1, splitGroupId: null, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
      { id: 2, splitGroupId: null, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
    ], ANY_FROM, ANY_TO);
    assert.equal(orders.length, 2);
  });

  it("Block.id a SplitGroup.id se nesmí splést — stejné číslo, jiný prostor", () => {
    // blok #7 bez skupiny a skupina 7 jsou dvě různé zakázky
    const orders = groupCompletedToOrders([
      { id: 7, splitGroupId: null, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
      { id: 9, splitGroupId: 7, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-02T08:00:00Z") },
    ], ANY_FROM, ANY_TO);
    assert.equal(orders.length, 2);
  });

  // --- příslušnost k období ---

  // Táž skupina rozdělená přes hranici měsíce: kus A doběhl 31. 7., kus B 3. 8.
  const acrossBorder = [
    { id: 1, splitGroupId: 7, createdAt: D("2026-07-20T08:00:00Z"), printCompletedAt: D("2026-07-31T10:00:00Z") },
    { id: 2, splitGroupId: 7, createdAt: D("2026-07-30T08:00:00Z"), printCompletedAt: D("2026-08-03T09:00:00Z") },
  ];
  const JUL = [D("2026-06-30T22:00:00Z"), D("2026-07-31T22:00:00Z")] as const; // pražský červenec
  const AUG = [D("2026-07-31T22:00:00Z"), D("2026-08-31T22:00:00Z")] as const; // pražský srpen

  it("zakázka přes hranici období se počítá JEN v období posledního kusu", () => {
    // Dřív se objevila v obou (klíč `g7` je stabilní napříč obdobími), takže součet
    // měsíců nedal rok — a v červenci navíc s uměle krátkým lead time.
    assert.equal(groupCompletedToOrders(acrossBorder, JUL[0], JUL[1]).length, 0);

    const aug = groupCompletedToOrders(acrossBorder, AUG[0], AUG[1]);
    assert.equal(aug.length, 1);
    assert.equal(aug[0].completedAt.toISOString(), "2026-08-03T09:00:00.000Z");
    // lead time se měří od NEJSTARŠÍHO založení skupiny, ne od okamžiku rozdělení
    assert.equal(aug[0].createdAt.toISOString(), "2026-07-20T08:00:00.000Z");
  });

  it("nedokončený sourozenec → zakázka se nezapočítá do žádného období", () => {
    const rows = [
      { id: 1, splitGroupId: 7, createdAt: D("2026-08-01T08:00:00Z"), printCompletedAt: D("2026-08-10T12:00:00Z") },
      { id: 2, splitGroupId: 7, createdAt: D("2026-08-02T08:00:00Z"), printCompletedAt: null },
    ];
    assert.equal(groupCompletedToOrders(rows, AUG[0], AUG[1]).length, 0);
    assert.equal(groupCompletedToOrders(rows, ANY_FROM, ANY_TO).length, 0);
  });

  it("hranice okna: konec období je VÝLUČNÝ, začátek včetně", () => {
    const at = (iso: string) => [{ id: 1, splitGroupId: null, createdAt: D("2026-08-01T00:00:00Z"), printCompletedAt: D(iso) }];
    assert.equal(groupCompletedToOrders(at("2026-07-31T22:00:00Z"), AUG[0], AUG[1]).length, 1, "půlnoc 1. 8. Praha patří srpnu");
    assert.equal(groupCompletedToOrders(at("2026-08-31T22:00:00Z"), AUG[0], AUG[1]).length, 0, "půlnoc 1. 9. Praha už srpnu nepatří");
  });

  it("strážný: route dohledává CELÉ split-skupiny, ne jen kusy dokončené v období", () => {
    // Čistá funkce může rozhodnout správně jen tehdy, když vidí všechny sourozence —
    // čím ji route nakrmí, ohlídá jen tenhle test.
    const src = readFileSync(join(process.cwd(), "src/app/api/report/dashboard/route.ts"), "utf8");
    assert.ok(
      /splitGroupId:\s*\{\s*in:/.test(src),
      "chybí druhý dotaz na sourozence — zakázka přes hranici by se počítala v obou obdobích",
    );
  });
});

describe("computeThroughputFromOrders", () => {
  it("počítá zakázky, ne bloky", () => {
    const orders = groupCompletedToOrders([
      { id: 1, splitGroupId: 7, createdAt: new Date("2026-08-01T08:00:00Z"), printCompletedAt: new Date("2026-08-02T08:00:00Z") },
      { id: 2, splitGroupId: 7, createdAt: new Date("2026-08-01T08:00:00Z"), printCompletedAt: new Date("2026-08-02T08:00:00Z") },
      { id: 3, splitGroupId: null, createdAt: new Date("2026-08-01T08:00:00Z"), printCompletedAt: new Date("2026-08-02T08:00:00Z") },
    ], ANY_FROM, ANY_TO);
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

// ---------------------------------------------------------------------------
// computeMaintenanceRatio
// ---------------------------------------------------------------------------
describe("computeMaintenanceRatio", () => {
  it("25% maintenance", () => {
    assert.equal(computeMaintenanceRatio(20, 80), 25);
  });

  it("nulová kapacita → null", () => {
    assert.equal(computeMaintenanceRatio(5, 0), null);
    assert.equal(computeMaintenanceRatio(10, 0), null);
  });
});

// ---------------------------------------------------------------------------
// computePlanStability
// ---------------------------------------------------------------------------
describe("computePlanStability", () => {
  const inRange = (...ids: number[]) => new Set(ids);

  it("vložení s chain pushem = JEDEN zásah, pět posunutých bloků", () => {
    // Vojta vloží spěchající zakázku a aplikace odsune pět navazujících.
    // Všechno je to jedna serverová transakce, tedy jedno rozhodnutí uživatele.
    const moves = [11, 12, 13, 14, 15].map((blockId) => ({ groupId: "g1", blockId }));
    const r = computePlanStability(moves, inRange(11, 12, 13, 14, 15, 16, 17, 18, 19, 20));
    assert.equal(r.interventionCount, 1);
    assert.equal(r.movedBlockCount, 5);
    assert.equal(r.stabilityPercent, 50); // (10 − 5) / 10
  });

  it("dvě nezávislá přetažení = dva zásahy, dva bloky", () => {
    const moves = [
      { groupId: "g1", blockId: 11 },
      { groupId: "g2", blockId: 12 },
    ];
    const r = computePlanStability(moves, inRange(11, 12, 13, 14));
    assert.equal(r.interventionCount, 2);
    assert.equal(r.movedBlockCount, 2);
    assert.equal(r.stabilityPercent, 50);
  });

  it("týž blok pohnutý dvakrát = dva zásahy, ale jeden posunutý blok", () => {
    // Poměr „posunutých na zásah" musí umět klesnout pod 1 — jinak by vypadalo,
    // že každý zásah rozhýbe aspoň jednu NOVOU zakázku, což není pravda.
    const moves = [
      { groupId: "g1", blockId: 11 },
      { groupId: "g2", blockId: 11 },
    ];
    const r = computePlanStability(moves, inRange(11, 12, 13, 14));
    assert.equal(r.interventionCount, 2);
    assert.equal(r.movedBlockCount, 1);
    assert.equal(r.stabilityPercent, 75);
  });

  it("blok mimo období se nezapočítá ANI do zásahů, ani do posunutých", () => {
    // Kořen vady č. 3 staré metriky: čitatel počítal bloky editované v období,
    // jmenovatel bloky NAPLÁNOVANÉ v období. Kdo v srpnu plánuje září, vyrobí
    // srpnové záznamy o zářijových blocích — a podíl vyšel i záporný.
    const moves = [
      { groupId: "g1", blockId: 11 },   // v období
      { groupId: "g2", blockId: 999 },  // mimo období — jiný měsíc
    ];
    const r = computePlanStability(moves, inRange(11, 12));
    assert.equal(r.interventionCount, 1, "zásah nad cizím blokem nepatří do tohoto období");
    assert.equal(r.movedBlockCount, 1);
    assert.equal(r.stabilityPercent, 50);
  });

  it("žádné pohyby → 100 % stabilita", () => {
    const r = computePlanStability([], inRange(1, 2, 3, 4, 5));
    assert.equal(r.interventionCount, 0);
    assert.equal(r.movedBlockCount, 0);
    assert.equal(r.stabilityPercent, 100);
  });

  it("prázdná množina bloků → 100 %, žádné dělení nulou", () => {
    const r = computePlanStability([{ groupId: "g1", blockId: 11 }], new Set<number>());
    assert.equal(r.movedBlockCount, 0);
    assert.equal(r.stabilityPercent, 100);
    assert.ok(Number.isFinite(r.stabilityPercent));
  });

  it("stabilita nikdy neklesne pod nulu, i když se pohnuly všechny bloky", () => {
    const moves = [
      { groupId: "g1", blockId: 11 },
      { groupId: "g2", blockId: 12 },
      { groupId: "g3", blockId: 11 },
    ];
    const r = computePlanStability(moves, inRange(11, 12));
    assert.equal(r.movedBlockCount, 2);
    assert.equal(r.stabilityPercent, 0);
  });
});

// ---------------------------------------------------------------------------
// resolvePlanCoverage
// ---------------------------------------------------------------------------
describe("resolvePlanCoverage", () => {
  const NOW = new Date("2026-08-10T09:30:00.000Z");
  const RETENTION = 90;

  it("nahrávání začalo PŘED obdobím → pokryto, i když v období nepřišla ani jedna změna", () => {
    // Vstupem je ZAČÁTEK NAHRÁVÁNÍ, ne datum první změny — a v tom byl 10. 8. 2026
    // nález z ručního testu. Původní verze sem posílala `MIN(createdAt)` z revizí,
    // takže klidný úsek před první změnou vypadal jako chybějící data a karta
    // ukazovala „—", i když se bloky prokazatelně přesouvaly. Že se ta záměna
    // nevrátí, hlídá strážný test nad zdrojákem route níž — tady se testovat
    // NEDÁ, protože funkce revize vůbec nevidí.
    const r = resolvePlanCoverage(
      new Date("2026-08-09T18:41:00.000Z"),   // migrace doběhla včera večer
      new Date("2026-08-09T22:00:00.000Z"),   // období = dnešek (půlnoc Praha)
      NOW, RETENTION,
    );
    assert.equal(r.covered, true);
    assert.equal(r.coverageFrom?.toISOString(), "2026-08-09T18:41:00.000Z");
  });

  it("období začíná PŘED spuštěním nahrávání → nepokryto", () => {
    const r = resolvePlanCoverage(
      new Date("2026-08-09T18:41:00.000Z"),
      new Date("2026-07-01T00:00:00.000Z"),   // červenec — skříňka tehdy neexistovala
      NOW, RETENTION,
    );
    assert.equal(r.covered, false);
  });

  it("retence uřízne období starší než 90 dní, i když nahrávání běželo", () => {
    const r = resolvePlanCoverage(
      new Date("2026-01-01T00:00:00.000Z"),   // nahrává se od ledna…
      new Date("2026-02-01T00:00:00.000Z"),   // …ale únor je za hranicí retence
      NOW, RETENTION,
    );
    assert.equal(r.covered, false, "úklid ta data smazal, takže se o nich nesmí tvrdit nic");
    assert.equal(r.coverageFrom?.toISOString(), "2026-05-12T09:30:00.000Z", "hranice = now − 90 dní");
  });

  it("neznámý začátek nahrávání → nepokryto a bez data", () => {
    const r = resolvePlanCoverage(null, new Date("2026-08-09T22:00:00.000Z"), NOW, RETENTION);
    assert.equal(r.covered, false);
    assert.equal(r.coverageFrom, null);
  });

  it("hranice period == coverageFrom je POKRYTÁ (ne o vteřinu vedle)", () => {
    const at = new Date("2026-08-09T18:41:00.000Z");
    assert.equal(resolvePlanCoverage(at, at, NOW, RETENTION).covered, true);
  });

  it("strážný: route bere začátek nahrávání z migrace, NE z nejstarší revize", () => {
    // Tenhle test hlídá to, co čistá funkce ohlídat nemůže — čím ji route krmí.
    // Záměna „první revize" za „začátek nahrávání" prošla testy i buildem
    // a zabila kartu na produkčně vypadajících datech (10. 8. 2026).
    const src = readFileSync(
      join(process.cwd(), "src/app/api/report/dashboard/route.ts"),
      "utf8",
    );
    assert.ok(
      src.includes("REVISION_MIGRATION_NAME"),
      "pokrytí se musí odvozovat od migrace, která BlockRevision založila",
    );
    assert.ok(
      !/blockRevision\.findFirst/.test(src),
      "nejstarší revize NENÍ začátek nahrávání — klidné období by se tvářilo jako chybějící data",
    );
  });
});

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

// ---------------------------------------------------------------------------
// computeCalendarCascade
// ---------------------------------------------------------------------------
describe("computeCalendarCascade", () => {
  /**
   * Stroj jede Po–Pá ranní 6–14, víkend vypnutý.
   *
   * `MachineWeekShiftsRow` je řádek NA DEN (`dayOfWeek` + `isActive`), ne jeden
   * řádek na týden — proto sedm řádků, ne jedna sada `monMorningOn`-flagů.
   */
  const weekdayMornings = (weekStart: string): MachineWeekShiftsRow[] => [
    { ...makeRow("XL_105", 0, { isActive: false }), weekStart }, // Ne
    ...[1, 2, 3, 4, 5].map((dow) => ({ ...makeRow("XL_105", dow, { morningOn: true }), weekStart })),
    { ...makeRow("XL_105", 6, { isActive: false }), weekStart }, // So
  ];

  it("čtyři kroky klesají a rozpad nevyužitého dá dohromady zbytek", () => {
    // Po 17. 8. – Ne 23. 8. 2026 = 7 dní = 168 h kalendáře.
    // Pracovní dny 5 × 8 h ranní = 40 h obsazeno.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: weekdayMornings("2026-08-17"), companyDays: [],
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
      weekShifts: weekdayMornings("2026-08-17"), companyDays: [],
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
      weekShifts: weekdayMornings("2026-08-17"),
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
      weekShifts: weekdayMornings("2026-08-17"),
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
      weekShifts: weekdayMornings("2026-08-17"),
      companyDays: [{ startDate: "2026-08-17T04:00:00.000Z", endDate: "2026-08-17T08:00:00.000Z" }],
      plannedHours: 0, confirmedHours: 0,
    });
    assert.equal(c.calendarHours, 24);
    assert.ok(c.staffedHours > 0 && c.staffedHours < 8, `půl směny zbýt musí, je ${c.staffedHours}`);
  });

  it("podíl potvrzených je z NAPLÁNOVANÝCH, ne z kalendáře", () => {
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: weekdayMornings("2026-08-17"), companyDays: [],
      plannedHours: 40, confirmedHours: 10,
    });
    assert.equal(c.confirmedShareOfPlanned, 25);
  });

  it("bez naplánovaných hodin je podíl null, ne nula", () => {
    // Nula by se četla jako „tiskaři nic nepotvrdili", což je něco jiného než
    // „nebylo co potvrzovat". Týž rozdíl jako u computeUtilization.
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: weekdayMornings("2026-08-17"), companyDays: [],
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

  it("obsazené hodiny sedí na `computeAvailableHours` i u noční přes půlnoc a částečné odstávky", () => {
    // Nejtvrdší scénář rozpadu: noční směna zasahuje ocasem do dalšího dne
    // (a ocasem NEDĚLE do pondělního rána, tedy zvenčí do okna), k tomu
    // půldenní odstávka. Když se rekonstrukce intervalů rozejde s tím, co
    // počítá `computeAvailableHours`, přestane platit kalendář − obsazeno
    // = nevyužito, a rozpad začne lhát, aniž by si toho kterýkoliv jiný test všiml.
    const weekStart = "2026-08-17";
    const shifts: MachineWeekShiftsRow[] = [
      // Neděle 16. 8. patří do PŘEDCHOZÍHO týdne — noční ocas do pondělí musí přijít odtud.
      { ...makeRow("XL_105", 0, { nightOn: true }), weekStart: "2026-08-10" },
      ...[1, 2, 3, 4, 5].map((dow) => ({
        ...makeRow("XL_105", dow, { morningOn: true, nightOn: true }),
        weekStart,
      })),
      { ...makeRow("XL_105", 6, { isActive: false }), weekStart },
      { ...makeRow("XL_105", 0, { isActive: false }), weekStart },
    ];
    const companyDays = [
      { startDate: "2026-08-19T04:00:00.000Z", endDate: "2026-08-19T10:00:00.000Z" },
      { startDate: "2026-08-21T20:00:00.000Z", endDate: "2026-08-22T02:00:00.000Z" },
    ];
    const c = computeCalendarCascade({
      machine: "XL_105", rangeStart: "2026-08-17", rangeEnd: "2026-08-23",
      weekShifts: shifts, companyDays, plannedHours: 10, confirmedHours: 5,
    });

    assert.equal(
      c.staffedHours,
      computeAvailableHours("XL_105", "2026-08-17", "2026-08-23", shifts, companyDays),
      "kaskáda nesmí mít vlastní kapacitu — musí to být totéž číslo jako v kartě Vytížení",
    );
    assert.equal(
      c.calendarHours - c.staffedHours,
      c.unused.total,
      "nevyužitý kalendář = kalendář − obsazeno",
    );
    assert.equal(
      c.unused.weekend + c.unused.shutdown + c.unused.unstaffedShift,
      c.unused.total,
      "rozpad se musí sejít i s noční přes půlnoc a odstávkou přes víkendovou hranici",
    );
    assert.ok(c.unused.shutdown > 0, "středeční odstávka musí být vidět");
    assert.ok(c.unused.weekend > 0);
  });
});
