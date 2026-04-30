import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import { pragueOf } from "@/lib/dateUtils";
import { prisma } from "@/lib/prisma";
import { serializeWeekShifts } from "@/lib/scheduleValidation";

/** Maximální posun při auto-shiftu — 7 kalendářních dní v ms. */
export const MAX_AUTO_SHIFT_MS = 7 * 24 * 60 * 60 * 1000;

/** Bezpečnostní strop iterací — ochrana před nekonečnou smyčkou při střídání snap+kolize. */
const MAX_ITERATIONS = 100;

/** Obsazený interval (existující blok nebo firemní odstávka). */
export type BlockedInterval = { start: Date; end: Date };

export type SlotSearchResult =
  | { found: true; startTime: Date; endTime: Date; wasShifted: boolean }
  | { found: false; reason: "MAX_SHIFT_EXCEEDED" };

/**
 * Najde nejbližší volný slot na stroji, který:
 *  1) splňuje pracovní dobu (přes weekShifts grid)
 *  2) nekoliduje s žádným z `blockedIntervals`
 *  3) je do `maxShiftMs` od `proposedStart`
 *
 * Pure function — žádné DB volání. Klient ji volá s state.blocks,
 * server (přes wrapper findNextFreeSlotFromDb) s DB query.
 */
export function findNextFreeSlot(
  machine: string,
  proposedStart: Date,
  durationMs: number,
  blockedIntervals: BlockedInterval[],
  weekShifts: MachineWeekShiftsRow[],
  maxShiftMs: number = MAX_AUTO_SHIFT_MS
): SlotSearchResult {
  const limit = proposedStart.getTime() + maxShiftMs;
  let candidate = proposedStart;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 1) Snap na pracovní dobu
    const snapped = snapToNextValidStartWithTemplates(machine, candidate, durationMs, weekShifts);
    if (snapped.getTime() > limit) {
      return { found: false, reason: "MAX_SHIFT_EXCEEDED" };
    }
    const snappedEnd = new Date(snapped.getTime() + durationMs);

    // 2) Najdi první kolidující obsazený interval
    const conflict = blockedIntervals.find(
      (b) => b.start.getTime() < snappedEnd.getTime() && b.end.getTime() > snapped.getTime()
    );
    if (!conflict) {
      const wasShifted = snapped.getTime() !== proposedStart.getTime();
      return { found: true, startTime: snapped, endTime: snappedEnd, wasShifted };
    }

    // 3) Posuň kandidát na konec kolize a opakuj (snap může vrátit ještě dál kvůli pracovní době)
    candidate = conflict.end;
  }

  return { found: false, reason: "MAX_SHIFT_EXCEEDED" };
}

/**
 * DB wrapper kolem findNextFreeSlot.
 * Načte weekShifts pro relevantní okno (proposedStart + maxShiftMs + buffer)
 * a všechny existující bloky na stroji v témže okně + firemní odstávky.
 *
 * `excludeBlockId` se použije při PUT (úprava bloku — nesmí kolidovat sám se sebou).
 */
export async function findNextFreeSlotFromDb(
  machine: string,
  proposedStart: Date,
  durationMs: number,
  excludeBlockId: number | null = null,
  maxShiftMs: number = MAX_AUTO_SHIFT_MS
): Promise<SlotSearchResult> {
  const windowEnd = new Date(proposedStart.getTime() + maxShiftMs + durationMs);

  // Týdny, kterých se okno dotýká
  const weekStarts = new Set<string>();
  for (let t = proposedStart.getTime(); t <= windowEnd.getTime(); t += 24 * 60 * 60 * 1000) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  // DST fall-back ošetření: 24h UTC krok může v říjnu přeskočit civilní datum,
  // proto explicitně přidat týden obsahující windowEnd.
  weekStarts.add(weekStartStrFromDateStr(pragueOf(windowEnd).dateStr));
  const weekStartDates = Array.from(weekStarts).map((s) => new Date(`${s}T00:00:00.000Z`));

  const [rawWeekShifts, blocks, companyDays] = await Promise.all([
    prisma.machineWeekShifts.findMany({
      where: { machine, weekStart: { in: weekStartDates } },
    }),
    prisma.block.findMany({
      where: {
        machine,
        ...(excludeBlockId != null ? { id: { not: excludeBlockId } } : {}),
        startTime: { lt: windowEnd },
        endTime: { gt: proposedStart },
      },
      select: { startTime: true, endTime: true },
    }),
    prisma.companyDay.findMany({
      where: {
        startDate: { lt: windowEnd },
        endDate: { gt: proposedStart },
        OR: [{ machine: null }, { machine }],
      },
      select: { startDate: true, endDate: true },
    }),
  ]);

  const blockedIntervals: BlockedInterval[] = [
    ...blocks.map((b) => ({ start: b.startTime, end: b.endTime })),
    ...companyDays.map((c) => ({ start: c.startDate, end: c.endDate })),
  ];

  const weekShifts = serializeWeekShifts(rawWeekShifts);
  return findNextFreeSlot(machine, proposedStart, durationMs, blockedIntervals, weekShifts, maxShiftMs);
}
