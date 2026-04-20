import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { weekStartStrFromDateStr } from "@/lib/machineWeekShifts";
import { pragueOf } from "@/lib/dateUtils";
import { isHardcodedBlocked } from "@/lib/scheduleValidation";
import { isDateTimeActive } from "@/lib/shifts";

const SLOT_MS = 30 * 60 * 1000;

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  weekShifts: MachineWeekShiftsRow[]
): boolean {
  const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(date);
  const weekStart = weekStartStrFromDateStr(dateStr);
  const hasAnyRowForWeek = weekShifts.some(
    (w) => w.machine === machine && w.weekStart === weekStart,
  );
  if (!hasAnyRowForWeek) return isHardcodedBlocked(machine, dayOfWeek, slot);
  return !isDateTimeActive(machine, dateStr, hour * 60 + minute, weekShifts);
}

type BlockRef = { machine: string; originalStart: Date; originalEnd: Date };

function blockOverlapsBlockedTimeWithTemplates(
  machine: string,
  start: Date,
  end: Date,
  weekShifts: MachineWeekShiftsRow[]
): boolean {
  let cur = new Date(start.getTime());
  while (cur < end) {
    if (isBlockedSlotDynamic(machine, cur, weekShifts)) return true;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return false;
}

function getBlockedPeriodEndWithTemplates(
  machine: string,
  blockedPoint: Date,
  weekShifts: MachineWeekShiftsRow[]
): Date {
  let cur = new Date(blockedPoint.getTime());
  while (true) {
    if (!isBlockedSlotDynamic(machine, cur, weekShifts)) break;
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
  for (let i = 0; i < 20; i++) {
    const end = new Date(start.getTime() + durationMs);
    if (!blockOverlapsBlockedTimeWithTemplates(machine, start, end, weekShifts)) return start;
    let blocked = new Date(start.getTime());
    while (blocked < end) {
      if (isBlockedSlotDynamic(machine, blocked, weekShifts)) break;
      blocked = new Date(blocked.getTime() + SLOT_MS);
    }
    if (blocked >= end) break;
    start = getBlockedPeriodEndWithTemplates(machine, blocked, weekShifts);
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
