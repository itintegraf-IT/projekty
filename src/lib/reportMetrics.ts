/**
 * Utility funkce pro reportovací dashboard.
 * Čisté funkce bez DB závislostí — snadno testovatelné.
 */

import { resolveScheduleRows } from "./scheduleValidation";
import { pragueToUTC, addDaysToCivilDate } from "./dateUtils";
import type { MachineWorkHoursTemplate } from "./machineWorkHours";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExceptionInput = {
  machine: string;
  date: string;
  startHour: number;
  endHour: number;
  isActive: boolean;
  startSlot: number;
  endSlot: number;
};

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
 * Precedence: exception → template.
 */
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  templates: MachineWorkHoursTemplate[],
  exceptions: ExceptionInput[],
): number {
  let total = 0;
  let cur = rangeStart;

  while (cur <= rangeEnd) {
    // Check for exception first
    const exc = exceptions.find((e) => e.machine === machine && e.date === cur);

    if (exc) {
      if (exc.isActive) {
        total += exc.endHour - exc.startHour;
      }
      // isActive=false → 0 hours, nothing to add
    } else {
      // Use template via resolveScheduleRows
      const dateAsUtc = pragueToUTC(cur, 12, 0);
      const rows = resolveScheduleRows(machine, dateAsUtc, templates);
      const dayOfWeek = dateAsUtc.getUTCDay();
      // Note: pragueToUTC(cur, 12, 0) may shift the UTC day, use pragueOf instead
      // But resolveScheduleRows uses pragueOf internally, so we just need to find the row for the right dayOfWeek
      // Actually, resolveScheduleRows returns ALL days of the template, we need to pick the right one
      for (const row of rows) {
        if (row.dayOfWeek === new Date(cur + "T12:00:00Z").getUTCDay() && row.isActive) {
          total += row.endHour - row.startHour;
        }
      }
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
