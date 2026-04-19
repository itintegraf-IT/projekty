import { prisma } from "@/lib/prisma";
import { checkScheduleViolationWithTemplates, serializeWeekShifts } from "@/lib/scheduleValidation";
import { pragueOf } from "@/lib/dateUtils";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";

/**
 * Načte MachineWeekShifts pro týdny dotčené blokem + firemní dny a ověří,
 * zda blok nespadá do zakázaného časového pásma.
 *
 * Vrátí null pokud je vše v pořádku, nebo { error: string } při porušení.
 * REZERVACE a UDRZBA bloky se nevalidují (jen ZAKAZKA).
 *
 * bypassScheduleValidation přeskakuje working hours validaci,
 * NE firemní odstávky (companyDays) — ty platí vždy.
 */
export async function validateBlockScheduleFromDb(
  machine: string,
  startTime: Date,
  endTime: Date,
  blockType: string,
  bypassScheduleValidation: boolean
): Promise<{ error: string } | null> {
  if (blockType !== "ZAKAZKA") return null;

  // Blok se může dotýkat až 2 týdnů — stačí dotaz na množinu weekStart.
  const startWeek = weekStartStrFromDateStr(pragueOf(startTime).dateStr);
  const endWeek = weekStartStrFromDateStr(pragueOf(endTime).dateStr);
  const weekStartDates = Array.from(new Set([startWeek, endWeek])).map((s) => new Date(`${s}T00:00:00.000Z`));

  const [rawWeekShifts, companyDays] = await Promise.all([
    prisma.machineWeekShifts.findMany({
      where: { machine, weekStart: { in: weekStartDates } },
    }),
    prisma.companyDay.findMany({
      where: { startDate: { lt: endTime }, endDate: { gt: startTime } },
    }),
  ]);

  if (!bypassScheduleValidation) {
    const weekShifts = serializeWeekShifts(rawWeekShifts);
    const violation = checkScheduleViolationWithTemplates(machine, startTime, endTime, weekShifts);
    if (violation) return { error: violation };
  }

  const cdConflict = companyDays.find((cd) => cd.machine === null || cd.machine === machine);
  if (cdConflict) return { error: "Blok zasahuje do plánované odstávky." };

  return null;
}
