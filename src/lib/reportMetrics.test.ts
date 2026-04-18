import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeAvailableHours,
  computeUtilization,
  computeThroughput,
  computeAvgLeadTimeDays,
  computeMaintenanceRatio,
  computePlanStability,
  computeBlockHours,
} from "./reportMetrics";
import type { MachineWorkHoursTemplate } from "./machineWorkHours";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mon-Fri 6-22 (16h/day) default template for XL_105 */
function make16hTemplate(): MachineWorkHoursTemplate {
  return {
    id: 1,
    machine: "XL_105",
    label: null,
    validFrom: "2020-01-01",
    validTo: null,
    isDefault: true,
    days: Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      dayOfWeek: i,
      startHour: 6,
      endHour: 22,
      startSlot: null,
      endSlot: null,
      isActive: i >= 1 && i <= 5, // Mon-Fri active
    })),
  };
}

type ExceptionInput = {
  machine: string;
  date: string;
  startHour: number;
  endHour: number;
  isActive: boolean;
  startSlot: number;
  endSlot: number;
};

// ---------------------------------------------------------------------------
// computeAvailableHours
// ---------------------------------------------------------------------------
describe("computeAvailableHours", () => {
  it("Mon-Fri 16h template over a full work week → 80h", () => {
    // 2026-04-13 is Monday, 2026-04-17 is Friday
    const result = computeAvailableHours(
      "XL_105",
      "2026-04-13",
      "2026-04-17",
      [make16hTemplate()],
      [],
    );
    assert.equal(result, 80);
  });

  it("weekend only → 0h", () => {
    // 2026-04-18 is Saturday, 2026-04-19 is Sunday
    const result = computeAvailableHours(
      "XL_105",
      "2026-04-18",
      "2026-04-19",
      [make16hTemplate()],
      [],
    );
    assert.equal(result, 0);
  });

  it("exception shortens a day from 16h to 8h", () => {
    const exceptions: ExceptionInput[] = [
      { machine: "XL_105", date: "2026-04-13", startHour: 6, endHour: 14, isActive: true, startSlot: 12, endSlot: 28 },
    ];
    // Mon shortened to 8h, Tue-Fri normal = 4 * 16 = 64, total 72
    const result = computeAvailableHours(
      "XL_105",
      "2026-04-13",
      "2026-04-17",
      [make16hTemplate()],
      exceptions,
    );
    assert.equal(result, 72);
  });

  it("exception isActive=false → 0h for that day", () => {
    const exceptions: ExceptionInput[] = [
      { machine: "XL_105", date: "2026-04-14", startHour: 0, endHour: 0, isActive: false, startSlot: 0, endSlot: 0 },
    ];
    // Tue disabled = 0h, Mon + Wed-Fri = 4 * 16 = 64
    const result = computeAvailableHours(
      "XL_105",
      "2026-04-13",
      "2026-04-17",
      [make16hTemplate()],
      exceptions,
    );
    assert.equal(result, 64);
  });

  it("single day", () => {
    const result = computeAvailableHours(
      "XL_105",
      "2026-04-13",
      "2026-04-13",
      [make16hTemplate()],
      [],
    );
    assert.equal(result, 16);
  });

  it("ignores exceptions for other machines", () => {
    const exceptions: ExceptionInput[] = [
      { machine: "XL_106", date: "2026-04-13", startHour: 0, endHour: 0, isActive: false, startSlot: 0, endSlot: 0 },
    ];
    const result = computeAvailableHours(
      "XL_105",
      "2026-04-13",
      "2026-04-13",
      [make16hTemplate()],
      exceptions,
    );
    assert.equal(result, 16);
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
    { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-14T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-13T06:00:00Z"), endTime: new Date("2026-04-13T10:00:00Z"), machine: "XL_105" },
    { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-15T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-14T06:00:00Z"), endTime: new Date("2026-04-14T10:00:00Z"), machine: "XL_105" },
    { type: "ZAKAZKA", printCompletedAt: null, createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-14T06:00:00Z"), endTime: new Date("2026-04-14T10:00:00Z"), machine: "XL_105" },
    { type: "ODSTÁVKA", printCompletedAt: new Date("2026-04-14T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-14T06:00:00Z"), endTime: new Date("2026-04-14T10:00:00Z"), machine: "XL_105" },
    { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-20T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-19T06:00:00Z"), endTime: new Date("2026-04-19T10:00:00Z"), machine: "XL_105" },
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
      { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-14T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-13T06:00:00Z"), endTime: new Date("2026-04-13T10:00:00Z"), machine: "XL_105" },
      { type: "ZAKAZKA", printCompletedAt: new Date("2026-04-16T10:00:00Z"), createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-15T06:00:00Z"), endTime: new Date("2026-04-15T10:00:00Z"), machine: "XL_105" },
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
      { type: "ZAKAZKA", printCompletedAt: null, createdAt: new Date("2026-04-10T10:00:00Z"), startTime: new Date("2026-04-13T06:00:00Z"), endTime: new Date("2026-04-13T10:00:00Z"), machine: "XL_105" },
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
  it("counts moves and calculates stability", () => {
    const auditLogs = [
      { blockId: 1, field: "startTime" },
      { blockId: 1, field: "endTime" },
      { blockId: 2, field: "machine" },
      { blockId: 3, field: "color" }, // not a move
      { blockId: 4, field: null },    // not a move
    ];
    const result = computePlanStability(auditLogs, 10);
    assert.equal(result.rescheduleCount, 3);
    assert.equal(result.movedBlockCount, 2); // blocks 1 and 2
    assert.equal(result.stabilityPercent, 80); // (10 - 2) / 10 * 100
  });

  it("no moves → 100% stability", () => {
    const result = computePlanStability([], 5);
    assert.equal(result.rescheduleCount, 0);
    assert.equal(result.movedBlockCount, 0);
    assert.equal(result.stabilityPercent, 100);
  });

  it("all blocks moved → 0% stability", () => {
    const auditLogs = [
      { blockId: 1, field: "startTime" },
      { blockId: 2, field: "endTime" },
      { blockId: 3, field: "machine" },
    ];
    const result = computePlanStability(auditLogs, 3);
    assert.equal(result.movedBlockCount, 3);
    assert.equal(result.stabilityPercent, 0);
  });

  it("totalBlockCount = 0 → 100% stability", () => {
    const result = computePlanStability([], 0);
    assert.equal(result.stabilityPercent, 100);
  });
});

// ---------------------------------------------------------------------------
// computeBlockHours
// ---------------------------------------------------------------------------
describe("computeBlockHours", () => {
  const blocks = [
    { type: "ZAKAZKA", machine: "XL_105", startTime: new Date("2026-04-13T06:00:00Z"), endTime: new Date("2026-04-13T10:00:00Z"), printCompletedAt: null, createdAt: new Date() },
    { type: "ZAKAZKA", machine: "XL_105", startTime: new Date("2026-04-14T06:00:00Z"), endTime: new Date("2026-04-14T14:00:00Z"), printCompletedAt: null, createdAt: new Date() },
    { type: "ODSTÁVKA", machine: "XL_105", startTime: new Date("2026-04-15T06:00:00Z"), endTime: new Date("2026-04-15T10:00:00Z"), printCompletedAt: null, createdAt: new Date() },
    { type: "ZAKAZKA", machine: "XL_106", startTime: new Date("2026-04-15T06:00:00Z"), endTime: new Date("2026-04-15T10:00:00Z"), printCompletedAt: null, createdAt: new Date() },
  ];

  it("sums hours for matching machine and type", () => {
    // Block 1: 4h, Block 2: 8h = 12h total for XL_105 ZAKAZKA
    assert.equal(computeBlockHours(blocks, "XL_105", "ZAKAZKA"), 12);
  });

  it("filters by type", () => {
    assert.equal(computeBlockHours(blocks, "XL_105", "ODSTÁVKA"), 4);
  });

  it("filters by machine", () => {
    assert.equal(computeBlockHours(blocks, "XL_106", "ZAKAZKA"), 4);
  });

  it("no matching blocks → 0", () => {
    assert.equal(computeBlockHours(blocks, "XL_106", "ODSTÁVKA"), 0);
  });

  it("empty array → 0", () => {
    assert.equal(computeBlockHours([], "XL_105", "ZAKAZKA"), 0);
  });
});
