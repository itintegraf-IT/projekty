import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";
import { isHardcodedBlocked, resolveScheduleRows, type DayScheduleRow } from "@/lib/scheduleValidation";
import { isHourActive } from "@/lib/shifts";

const SLOT_MS = 30 * 60 * 1000;

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  schedule: DayScheduleRow[],
  weekShifts: MachineWeekShiftsRow[]
): boolean {
  const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(date);
  const row = schedule.find((r) => r.machine === machine && r.dayOfWeek === dayOfWeek);
  if (!row) {
    // Pokud pro stroj nejsou žádné řádky v týdnu → hardcoded fallback.
    if (schedule.some((r) => r.machine === machine)) return true;
    return isHardcodedBlocked(machine, dayOfWeek, slot);
  }
  if (!row.isActive) return true;
  const weekStart = weekStartStrFromDateStr(dateStr);
  const ws = weekShifts.find((w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dayOfWeek);
  if (!ws) return true;
  return !isHourActive(hour + minute / 60, ws);
}

type BlockRef = { machine: string; originalStart: Date; originalEnd: Date };

function blockOverlapsBlockedTimeWithTemplates(
  machine: string,
  start: Date,
  end: Date,
  weekShifts: MachineWeekShiftsRow[],
  cache?: Map<string, DayScheduleRow[]>
): boolean {
  const scheduleCache = cache ?? new Map<string, DayScheduleRow[]>();
  let cur = new Date(start.getTime());
  while (cur < end) {
    const { dateStr } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, weekShifts));
    if (isBlockedSlotDynamic(machine, cur, scheduleCache.get(dateStr)!, weekShifts)) return true;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return false;
}

function getBlockedPeriodEndWithTemplates(
  machine: string,
  blockedPoint: Date,
  weekShifts: MachineWeekShiftsRow[],
  cache?: Map<string, DayScheduleRow[]>
): Date {
  const scheduleCache = cache ?? new Map<string, DayScheduleRow[]>();
  let cur = new Date(blockedPoint.getTime());
  while (true) {
    const { dateStr } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, weekShifts));
    if (!isBlockedSlotDynamic(machine, cur, scheduleCache.get(dateStr)!, weekShifts)) break;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return cur;
}

export function snapToNextValidStartWithTemplates(
  machine: string,
  proposedStart: Date,
  durationMs: number,
  weekShifts: MachineWeekShiftsRow[]
): Date {
  let start = new Date(proposedStart.getTime());
  const scheduleCache = new Map<string, DayScheduleRow[]>();
  for (let i = 0; i < 20; i++) {
    const end = new Date(start.getTime() + durationMs);
    if (!blockOverlapsBlockedTimeWithTemplates(machine, start, end, weekShifts, scheduleCache)) return start;
    let blocked = new Date(start.getTime());
    while (blocked < end) {
      const { dateStr } = pragueOf(blocked);
      if (!scheduleCache.has(dateStr)) scheduleCache.set(dateStr, resolveScheduleRows(machine, blocked, weekShifts));
      if (isBlockedSlotDynamic(machine, blocked, scheduleCache.get(dateStr)!, weekShifts)) break;
      blocked = new Date(blocked.getTime() + SLOT_MS);
    }
    if (blocked >= end) break;
    start = getBlockedPeriodEndWithTemplates(machine, blocked, weekShifts, scheduleCache);
  }
  return start;
}

export function snapGroupDeltaWithTemplates(
  blocks: BlockRef[],
  proposedDeltaMs: number,
  weekShifts: MachineWeekShiftsRow[]
): { deltaMs: number; wasSnapped: boolean } {
  let delta = proposedDeltaMs;
  let wasSnapped = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    let maxExtra = 0;
    for (const b of blocks) {
      const newStart = new Date(b.originalStart.getTime() + delta);
      const dur = b.originalEnd.getTime() - b.originalStart.getTime();
      const snapped = snapToNextValidStartWithTemplates(b.machine, newStart, dur, weekShifts);
      const extra = snapped.getTime() - newStart.getTime();
      if (extra > maxExtra) maxExtra = extra;
    }
    if (maxExtra === 0) break;
    delta += maxExtra;
    wasSnapped = true;
  }
  return { deltaMs: delta, wasSnapped };
}
