import { prisma } from "@/lib/prisma";
import { checkScheduleViolationWithTemplates, serializeTemplates } from "@/lib/scheduleValidation";

/**
 * Načte pracovní šablony, výjimky a firemní dny z DB a zkontroluje,
 * zda blok nespadá do zakázaného časového pásma.
 *
 * Vrátí null pokud je vše v pořádku, nebo { error: string } při porušení.
 * REZERVACE a UDRZBA bloky se nevalidují (jen ZAKAZKA).
 *
 * bypassScheduleValidation přeskakuje jen working hours validaci,
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

  const [rawTemplates, exceptions, companyDays] = await Promise.all([
    prisma.machineWorkHoursTemplate.findMany({
      where: { machine },
      include: { days: true },
    }),
    prisma.machineScheduleException.findMany({
      where: {
        machine,
        date: {
          gte: new Date(startTime.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(endTime.getTime() + 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.companyDay.findMany({
      where: { startDate: { lt: endTime }, endDate: { gt: startTime } },
    }),
  ]);

  if (!bypassScheduleValidation) {
    const templates = serializeTemplates(rawTemplates);
    const violation = checkScheduleViolationWithTemplates(machine, startTime, endTime, templates, exceptions);
    if (violation) return { error: violation };
  }

  // companyDays check se přeskakovat NESMÍ — platí i v bypass módu
  const cdConflict = companyDays.find((cd) => cd.machine === null || cd.machine === machine);
  if (cdConflict) return { error: "Blok zasahuje do plánované odstávky." };

  return null;
}
