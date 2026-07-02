import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";
import { pragueOf } from "@/lib/dateUtils";
import { prisma } from "@/lib/prisma";
import { serializeWeekShifts } from "@/lib/scheduleValidation";
import {
  expandPrintTime,
  snapStartToNextRunnableSlot,
  violatesMinPrintSegment,
  MIN_PRINT_SEGMENT_MINUTES,
  MAX_SPAN_DAYS,
  type CompanyDayInterval,
} from "@/lib/printTime";

/** Maximální posun při auto-shiftu — 7 kalendářních dní v ms. */
export const MAX_AUTO_SHIFT_MS = 7 * 24 * 60 * 60 * 1000;

/** Bezpečnostní strop iterací — ochrana před nekonečnou smyčkou při střídání snap+kolize. */
const MAX_ITERATIONS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Obsazený interval (existující blok nebo firemní odstávka). */
export type BlockedInterval = { start: Date; end: Date };

export type SlotSearchResult =
  | { found: true; startTime: Date; endTime: Date; wasShifted: boolean }
  | { found: false; reason: "MAX_SHIFT_EXCEEDED" };

// TODO(Plán 4): duration-based finder zůstává pro klientské preview a ne-ZAKAZKA bloky.
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

export type PrintSlotSearchResult =
  | { found: true; startTime: Date; endTime: Date; wasShifted: boolean }
  | { found: false; reason: "MAX_SHIFT_EXCEEDED" | "NO_CAPACITY" };

/**
 * Auto-shift pro ZAKAZKA v modelu tiskových hodin: start-only snap + expanze.
 *  1) start se snapne na nejbližší runnable slot (weekShifts + companyDays),
 *  2) end vyjde z expandPrintTime — blok smí pauznout přes odstávku,
 *  3) kolizní test na CELÉM expandovaném spanu proti `blockedIntervals` (JEN bloky —
 *     odstávky nejsou blocker, jsou součást kalendáře),
 *  4) `maxShiftMs` limituje POSUN STARTU, nikdy end (40h blok má span > 7 dní).
 *
 * Pure funkce — žádné DB volání.
 */
export function findNextFreePrintSlot(
  machine: string,
  proposedStart: Date,
  printMinutes: number,
  blockedIntervals: BlockedInterval[],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
  maxShiftMs: number = MAX_AUTO_SHIFT_MS,
  minSegmentMinutes: number = MIN_PRINT_SEGMENT_MINUTES
): PrintSlotSearchResult {
  const limit = proposedStart.getTime() + maxShiftMs;
  let candidate = proposedStart;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const snapped = snapStartToNextRunnableSlot(machine, candidate, weekShifts, companyDays, limit);
    if (!snapped) {
      // Nouzová pojistka: pravidlo minimálního segmentu nikdy nesmí způsobit selhání
      // tam, kde by umístění bez něj uspělo — zkus znovu bez pravidla (jen jednou).
      return minSegmentMinutes > 0
        ? findNextFreePrintSlot(machine, proposedStart, printMinutes, blockedIntervals, weekShifts, companyDays, maxShiftMs, 0)
        : { found: false, reason: "MAX_SHIFT_EXCEEDED" };
    }
    const exp = expandPrintTime(machine, snapped, printMinutes, weekShifts, companyDays, false);
    if (!exp.ok) return { found: false, reason: "NO_CAPACITY" };

    if (violatesMinPrintSegment(exp.segments, minSegmentMinutes)) {
      const firstPause = exp.segments.find((s) => s.kind === "pause")!;
      candidate = firstPause.end;
      continue;
    }

    const conflict = blockedIntervals.find(
      (b) => b.start.getTime() < exp.end.getTime() && b.end.getTime() > snapped.getTime()
    );
    if (!conflict) {
      return {
        found: true,
        startTime: snapped,
        endTime: exp.end,
        wasShifted: snapped.getTime() !== proposedStart.getTime(),
      };
    }
    candidate = conflict.end;
  }
  // Vyčerpání MAX_ITERATIONS — nouzová pojistka: zkus znovu bez pravidla (jen jednou).
  return minSegmentMinutes > 0
    ? findNextFreePrintSlot(machine, proposedStart, printMinutes, blockedIntervals, weekShifts, companyDays, maxShiftMs, 0)
    : { found: false, reason: "MAX_SHIFT_EXCEEDED" };
}

/**
 * DB wrapper kolem findNextFreePrintSlot. Okno = maxShift (posun startu)
 * + MAX_SPAN_DAYS (worst-case span expanze) — NE +durationMs.
 * CompanyDays jdou do kalendáře (pauzy), NE mezi blocked intervaly.
 */
export async function findNextFreePrintSlotFromDb(
  machine: string,
  proposedStart: Date,
  printMinutes: number,
  excludeBlockId: number | null = null,
  maxShiftMs: number = MAX_AUTO_SHIFT_MS
): Promise<PrintSlotSearchResult> {
  const windowEnd = new Date(proposedStart.getTime() + maxShiftMs + MAX_SPAN_DAYS * DAY_MS);

  const weekStarts = new Set<string>();
  for (let t = proposedStart.getTime(); t <= windowEnd.getTime(); t += DAY_MS) {
    weekStarts.add(weekStartStrFromDateStr(pragueOf(new Date(t)).dateStr));
  }
  // DST fall-back ošetření: 24h UTC krok může přeskočit civilní datum.
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

  return findNextFreePrintSlot(
    machine,
    proposedStart,
    printMinutes,
    blocks.map((b) => ({ start: b.startTime, end: b.endTime })),
    serializeWeekShifts(rawWeekShifts),
    companyDays.map((c) => ({ start: c.startDate, end: c.endDate })),
    maxShiftMs
  );
}
