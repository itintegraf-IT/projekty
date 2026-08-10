import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeAvailableHours,
  computeUtilization,
  computeThroughput,
  computeAvgLeadTimeDays,
  computeMaintenanceRatio,
  computePlanStability,
  resolvePlanCoverage,
  computeBlockHours,
} from "./reportMetrics";
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
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", make16hShifts());
    assert.equal(result, 80);
  });

  it("weekend only → 0h", () => {
    // 2026-04-18 Sat, 2026-04-19 Sun
    const result = computeAvailableHours("XL_105", "2026-04-18", "2026-04-19", make16hShifts());
    assert.equal(result, 0);
  });

  it("single day with morning-only shift → 8h (6-14)", () => {
    const shifts = make16hShifts();
    // Mon: only morning instead of morning+afternoon
    const monIdx = shifts.findIndex((r) => r.dayOfWeek === 1);
    shifts[monIdx] = makeRow("XL_105", 1, { morningOn: true });
    // Mon 8h + Tue-Fri 16h*4 = 72
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", shifts);
    assert.equal(result, 72);
  });

  it("day isActive=false → 0h for that day", () => {
    const shifts = make16hShifts();
    const tueIdx = shifts.findIndex((r) => r.dayOfWeek === 2);
    shifts[tueIdx] = makeRow("XL_105", 2, { isActive: false, morningOn: true, afternoonOn: true });
    // Tue disabled, Mon + Wed-Fri = 4 * 16 = 64
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", shifts);
    assert.equal(result, 64);
  });

  it("single day", () => {
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", make16hShifts());
    assert.equal(result, 16);
  });

  it("ignores rows for other machines", () => {
    const shifts = [
      ...make16hShifts("XL_106"),
      makeRow("XL_105", 1, { morningOn: true, afternoonOn: true }),
    ];
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", shifts);
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
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", shifts);
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
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", shifts);
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
    const hours = computeAvailableHours("XL_106", "2026-04-19", "2026-04-19", weekShifts);
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
    const hours = computeAvailableHours("XL_106", "2026-04-20", "2026-04-20", weekShifts);
    assert.equal(hours, 6, "Po dostane tail z Ne NIGHT (6h)");
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

  it("0 available → 0%", () => {
    assert.equal(computeUtilization(10, 0), 0);
  });

  it("rounds to nearest integer", () => {
    assert.equal(computeUtilization(1, 3), 33);
  });
});

// ---------------------------------------------------------------------------
// computeThroughput
// ---------------------------------------------------------------------------
describe("computeThroughput", () => {
  const blocks = [
    { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-14T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-13T06:00:00Z"), endTime: new Date("2026-04-13T10:00:00Z"), machine: "XL_105", printMinutes: null },
    { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-15T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-14T06:00:00Z"), endTime: new Date("2026-04-14T10:00:00Z"), machine: "XL_105", printMinutes: null },
    { type: "ZAKAZKA", printCompletedAt: null, createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-14T06:00:00Z"), endTime: new Date("2026-04-14T10:00:00Z"), machine: "XL_105", printMinutes: null },
    { type: "ODSTÁVKA", printCompletedAt: new Date("2026-04-14T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-14T06:00:00Z"), endTime: new Date("2026-04-14T10:00:00Z"), machine: "XL_105", printMinutes: null },
    { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-20T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-19T06:00:00Z"), endTime: new Date("2026-04-19T10:00:00Z"), machine: "XL_105", printMinutes: null },
  ];

  it("counts only ZAKAZKA with printCompletedAt in range", () => {
    assert.equal(computeThroughput(blocks, "2026-04-13", "2026-04-17"), 2);
  });

  it("empty array → 0", () => {
    assert.equal(computeThroughput([], "2026-04-13", "2026-04-17"), 0);
  });
});

// ---------------------------------------------------------------------------
// computeAvgLeadTimeDays
// ---------------------------------------------------------------------------
describe("computeAvgLeadTimeDays", () => {
  it("average lead time calculation", () => {
    const blocks = [
      { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-14T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-13T06:00:00Z"), endTime: new Date("2026-04-13T10:00:00Z"), machine: "XL_105", printMinutes: null },
      { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-16T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-15T06:00:00Z"), endTime: new Date("2026-04-15T10:00:00Z"), machine: "XL_105", printMinutes: null },
    ];
    // Block 1: 4 days, Block 2: 6 days → avg 5
    const result = computeAvgLeadTimeDays(blocks, "2026-04-13", "2026-04-17");
    assert.equal(result, 5);
  });

  it("empty input → 0", () => {
    assert.equal(computeAvgLeadTimeDays([], "2026-04-13", "2026-04-17"), 0);
  });

  it("no completed blocks in range → 0", () => {
    const blocks = [
      { type: "ZAKAZKA", printCompletedAt: null, createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-13T06:00:00Z"), endTime: new Date("2026-04-13T10:00:00Z"), machine: "XL_105", printMinutes: null },
    ];
    assert.equal(computeAvgLeadTimeDays(blocks, "2026-04-13", "2026-04-17"), 0);
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

// ---------------------------------------------------------------------------
// computeBlockHours
// ---------------------------------------------------------------------------
describe("computeBlockHours", () => {
  const mk = (over: Partial<Parameters<typeof computeBlockHours>[0][number]>) => ({
    type: "ZAKAZKA", machine: "XL_106",
    startTime: new Date("2026-08-21T18:00:00.000Z"),
    endTime: new Date("2026-08-23T22:00:00.000Z"), // elapsed 52 h
    printMinutes: 240 as number | null,
    printCompletedAt: null, createdAt: new Date("2026-08-01T00:00:00.000Z"),
    ...over,
  });

  it("ZAKAZKA s printMinutes → tiskové hodiny, ne elapsed (pauznutý blok)", () => {
    assert.equal(computeBlockHours([mk({})], "XL_106", "ZAKAZKA"), 4);
  });
  it("ZAKAZKA s printMinutes=null (legacy) → elapsed fallback", () => {
    assert.equal(
      computeBlockHours([mk({ printMinutes: null, endTime: new Date("2026-08-21T22:00:00.000Z") })], "XL_106", "ZAKAZKA"),
      4,
    );
  });
  it("UDRZBA ignoruje printMinutes → elapsed", () => {
    assert.equal(
      computeBlockHours([mk({ type: "UDRZBA", printMinutes: 999, endTime: new Date("2026-08-21T20:00:00.000Z") })], "XL_106", "UDRZBA"),
      2,
    );
  });
  it("filtruje stroj a typ", () => {
    assert.equal(computeBlockHours([mk({ machine: "XL_105" })], "XL_106", "ZAKAZKA"), 0);
    assert.equal(computeBlockHours([mk({})], "XL_106", "UDRZBA"), 0);
  });
  it("prázdný vstup → 0", () => {
    assert.equal(computeBlockHours([], "XL_106", "ZAKAZKA"), 0);
  });
});
