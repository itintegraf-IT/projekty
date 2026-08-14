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
} from "./reportMetrics";
import { printOverlapMinutes } from "./printTimeClient";
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

// ---------------------------------------------------------------------------
// computeMaintenanceRatio
// ---------------------------------------------------------------------------
describe("computeMaintenanceRatio", () => {
  it("25% maintenance", () => {
    assert.equal(computeMaintenanceRatio(20, 80), 25);
  });

  it("0 available → 0", () => {
    assert.equal(computeMaintenanceRatio(10, 0), 0);
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
