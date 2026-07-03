import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import { pragueOf } from "@/lib/dateUtils";
import {
  expandPrintTime,
  MAX_SPAN_DAYS,
  type CompanyDayInterval,
  type ExpandResult,
} from "@/lib/printTime";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Strukturální podmnožina Prisma klienta — funguje s prisma i tx. */
export type PrismaClientLike = {
  machineWeekShifts: {
    findMany: (args: {
      where: { machine: string; weekStart: { in: Date[] } };
    }) => Promise<Parameters<typeof serializeWeekShifts>[0]>;
  };
  companyDay: {
    findMany: (args: {
      where: {
        startDate: { lt: Date };
        endDate: { gt: Date };
        OR: ({ machine: null } | { machine: string })[];
      };
      select: { startDate: true; endDate: true };
    }) => Promise<{ startDate: Date; endDate: Date }[]>;
  };
};

export type MachineCalendar = {
  weekShifts: MachineWeekShiftsRow[];
  companyDays: CompanyDayInterval[];
};

/**
 * Načte kalendář stroje pro okno [start, start + MAX_SPAN_DAYS]:
 * weekShifts pro VŠECHNY dotčené týdny (precondition expandPrintTime — týden
 * mimo fetch by tiše spadl na hardcoded fallback) + companyDays v okně.
 */
export async function loadMachineCalendar(
  db: PrismaClientLike,
  machine: string,
  start: Date
): Promise<MachineCalendar> {
  const windowEnd = new Date(start.getTime() + MAX_SPAN_DAYS * DAY_MS);
  const weekStarts = new Set<string>();
  // Kotva o den DŘÍV: noční směna přetéká přes půlnoc — slot Po 0:00–6:00 řídí NEDĚLNÍ
  // řádek předchozího týdne. Bez něj by start na hranici týdnů falešně padal na
  // START_NOT_RUNNABLE (nález z testování 3. 7.). Vzor: resolveChainPushFromDb (anchor−1d).
  for (let t = start.getTime() - DAY_MS; t <= windowEnd.getTime(); t += DAY_MS) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  // DST fall-back ošetření: 24h UTC krok může přeskočit civilní datum (vzor scheduleSlotFinder.ts:86)
  weekStarts.add(weekStartStrFromDateStr(pragueOf(windowEnd).dateStr));

  const [rawWeekShifts, cdRows] = await Promise.all([
    db.machineWeekShifts.findMany({
      where: {
        machine,
        weekStart: { in: Array.from(weekStarts).map((s) => new Date(`${s}T00:00:00.000Z`)) },
      },
    }),
    db.companyDay.findMany({
      where: {
        startDate: { lt: windowEnd },
        endDate: { gt: start },
        OR: [{ machine: null }, { machine }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  return {
    weekShifts: serializeWeekShifts(rawWeekShifts),
    companyDays: cdRows.map((c) => ({ start: c.startDate, end: c.endDate })),
  };
}

/** Expand nad DB kalendářem — jediná serverová cesta k výpočtu endu bloku. */
export async function expandPrintTimeFromDb(
  db: PrismaClientLike,
  machine: string,
  start: Date,
  printMinutes: number,
  bypass: boolean
): Promise<ExpandResult> {
  if (bypass) {
    // Bez pauz — kalendář není potřeba (expandPrintTime s bypass=true ho nečte).
    return expandPrintTime(machine, start, printMinutes, [], [], true);
  }
  const cal = await loadMachineCalendar(db, machine, start);
  return expandPrintTime(machine, start, printMinutes, cal.weekShifts, cal.companyDays, false);
}
