/**
 * Utility funkce pro reportovací dashboard.
 * Čisté funkce bez DB závislostí — snadno testovatelné.
 */

import { addDaysToCivilDate } from "./dateUtils";
import { SHIFTS, resolveShiftBounds } from "./shifts";
import { type MachineWeekShiftsRow, weekStartStrFromDateStr } from "./machineWeekShifts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BlockInput = {
  type: string;
  machine: string;
  startTime: Date;
  endTime: Date;
  printCompletedAt: Date | null;
  createdAt: Date;
};

type AuditLogInput = {
  blockId: number;
  field: string | null;
};

// ---------------------------------------------------------------------------
// 1. computeAvailableHours
// ---------------------------------------------------------------------------

/**
 * Spočítá dostupné pracovní hodiny stroje v rozsahu civil date (inclusive).
 * Zdroj: MachineWeekShifts (flags + fixní časy směn 6/14/22).
 */
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  weekShifts: MachineWeekShiftsRow[],
): number {
  let total = 0;
  let cur = rangeStart;

  while (cur <= rangeEnd) {
    const weekStart = weekStartStrFromDateStr(cur);
    const dayOfWeek = new Date(cur + "T12:00:00Z").getUTCDay();
    const row = weekShifts.find(
      (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek
    );
    if (row && row.isActive) {
      let dayMinutes = 0;
      for (const shift of SHIFTS) {
        const b = resolveShiftBounds(row, shift);
        if (!b) continue;
        const span = b.endMin < b.startMin
          ? (1440 - b.startMin) + b.endMin   // cross midnight NIGHT
          : b.endMin - b.startMin;
        dayMinutes += span;
      }
      total += dayMinutes / 60;
    }
    cur = addDaysToCivilDate(cur, 1);
  }

  return total;
}

// ---------------------------------------------------------------------------
// 2. computeUtilization
// ---------------------------------------------------------------------------

/** Procento využití: Math.round((production / available) * 100). Vrací 0 pokud available <= 0. */
export function computeUtilization(productionHours: number, availableHours: number): number {
  if (availableHours <= 0) return 0;
  return Math.round((productionHours / availableHours) * 100);
}

// ---------------------------------------------------------------------------
// 3. computeThroughput
// ---------------------------------------------------------------------------

/** Počet bloků type=ZAKAZKA s printCompletedAt v daném rozsahu (inclusive civil dates). */
export function computeThroughput(blocks: BlockInput[], rangeStart: string, rangeEnd: string): number {
  const start = new Date(rangeStart + "T00:00:00Z");
  const end = new Date(rangeEnd + "T23:59:59.999Z");

  return blocks.filter(
    (b) =>
      b.type === "ZAKAZKA" &&
      b.printCompletedAt !== null &&
      b.printCompletedAt >= start &&
      b.printCompletedAt <= end,
  ).length;
}

// ---------------------------------------------------------------------------
// 4. computeAvgLeadTimeDays
// ---------------------------------------------------------------------------

/** Průměrný lead time v dnech pro dokončené ZAKAZKA bloky v rozsahu. Vrací 0 pokud žádné. */
export function computeAvgLeadTimeDays(blocks: BlockInput[], rangeStart: string, rangeEnd: string): number {
  const start = new Date(rangeStart + "T00:00:00Z");
  const end = new Date(rangeEnd + "T23:59:59.999Z");

  const completed = blocks.filter(
    (b) =>
      b.type === "ZAKAZKA" &&
      b.printCompletedAt !== null &&
      b.printCompletedAt >= start &&
      b.printCompletedAt <= end,
  );

  if (completed.length === 0) return 0;

  const totalDays = completed.reduce((sum, b) => {
    const diffMs = b.printCompletedAt!.getTime() - b.createdAt.getTime();
    return sum + diffMs / (1000 * 60 * 60 * 24);
  }, 0);

  return Math.round(totalDays / completed.length);
}

// ---------------------------------------------------------------------------
// 5. computeMaintenanceRatio
// ---------------------------------------------------------------------------

/** Procento údržby z dostupných hodin. Vrací 0 pokud available <= 0. */
export function computeMaintenanceRatio(maintenanceHours: number, availableHours: number): number {
  if (availableHours <= 0) return 0;
  return Math.round((maintenanceHours / availableHours) * 100);
}

// ---------------------------------------------------------------------------
// 6. computePlanStability
// ---------------------------------------------------------------------------

const MOVE_FIELDS = new Set(["startTime", "endTime", "machine"]);

/** Stabilita plánu — kolik bloků nebylo přeplánováno. */
export function computePlanStability(
  auditLogs: AuditLogInput[],
  totalBlockCount: number,
): { rescheduleCount: number; movedBlockCount: number; stabilityPercent: number } {
  const moves = auditLogs.filter((l) => l.field !== null && MOVE_FIELDS.has(l.field));
  const rescheduleCount = moves.length;
  const movedBlockIds = new Set(moves.map((l) => l.blockId));
  const movedBlockCount = movedBlockIds.size;

  const stabilityPercent =
    totalBlockCount <= 0
      ? 100
      : Math.round(((totalBlockCount - movedBlockCount) / totalBlockCount) * 100);

  return { rescheduleCount, movedBlockCount, stabilityPercent };
}

// ---------------------------------------------------------------------------
// 7. computeBlockHours
// ---------------------------------------------------------------------------

/** Součet hodin bloků pro daný stroj a typ. */
export function computeBlockHours(blocks: BlockInput[], machine: string, type: string): number {
  return blocks
    .filter((b) => b.machine === machine && b.type === type)
    .reduce((sum, b) => {
      const diffMs = b.endTime.getTime() - b.startTime.getTime();
      return sum + diffMs / (1000 * 60 * 60);
    }, 0);
}
