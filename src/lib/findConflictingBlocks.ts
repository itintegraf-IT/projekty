import { prisma } from "@/lib/prisma";
import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import { type MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { checkScheduleViolationWithTemplates } from "@/lib/scheduleValidation";

export type ConflictingBlock = {
  id: number;
  orderNumber: string;
  description: string | null;
  startTime: string;
  endTime: string;
};

export type WeekRowInput = {
  dayOfWeek: number;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
  isActive: boolean;
};

function buildSynthRows(machine: string, weekStartStr: string, newRows: WeekRowInput[]): MachineWeekShiftsRow[] {
  return newRows.map((r) => ({
    machine,
    weekStart: weekStartStr,
    dayOfWeek: r.dayOfWeek,
    isActive: r.isActive,
    morningOn: r.morningOn,
    afternoonOn: r.afternoonOn,
    nightOn: r.nightOn,
    morningStartMin: r.morningStartMin,
    morningEndMin: r.morningEndMin,
    afternoonStartMin: r.afternoonStartMin,
    afternoonEndMin: r.afternoonEndMin,
    nightStartMin: r.nightStartMin,
    nightEndMin: r.nightEndMin,
  }));
}

/**
 * Najde bloky typu ZAKAZKA/DATA/MATERIAL, které po změně pracovní doby
 * spadnou mimo aktivní intervaly.
 */
export async function findConflictingBlocks(
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
): Promise<ConflictingBlock[]> {
  const weekStartDate = civilDateToUTCMidnight(weekStartStr);
  const weekEnd = new Date(weekStartDate);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const blocks = await prisma.block.findMany({
    where: { machine, startTime: { gte: weekStartDate, lt: weekEnd } },
    select: { id: true, orderNumber: true, description: true, startTime: true, endTime: true },
  });

  const synthRows = buildSynthRows(machine, weekStartStr, newRows);

  const conflicts: ConflictingBlock[] = [];
  for (const b of blocks) {
    const violation = checkScheduleViolationWithTemplates(machine, b.startTime, b.endTime, synthRows);
    if (violation) {
      conflicts.push({
        id: b.id,
        orderNumber: b.orderNumber,
        description: b.description,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      });
    }
  }
  return conflicts;
}

/**
 * Pure variant (bez Prisma) — pro unit testy.
 * Dostane bloky jako input místo je načítat z DB.
 */
export function detectConflictsPure(
  machine: string,
  weekStartStr: string,
  newRows: WeekRowInput[],
  blocks: Array<{ id: number; orderNumber: string; description: string | null; startTime: Date; endTime: Date }>,
): ConflictingBlock[] {
  const synthRows = buildSynthRows(machine, weekStartStr, newRows);

  const conflicts: ConflictingBlock[] = [];
  for (const b of blocks) {
    const violation = checkScheduleViolationWithTemplates(machine, b.startTime, b.endTime, synthRows);
    if (violation) {
      conflicts.push({
        id: b.id,
        orderNumber: b.orderNumber,
        description: b.description,
        startTime: b.startTime.toISOString(),
        endTime: b.endTime.toISOString(),
      });
    }
  }
  return conflicts;
}
