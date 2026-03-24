import type { MachineWorkHours } from "@/lib/machineWorkHours";
import type { MachineScheduleException } from "@/lib/machineScheduleException";

const WORK_START_H = 6;
const WORK_END_H = 22;
const SLOT_MS = 30 * 60 * 1000;

function isNightXL105(date: Date): boolean {
  const h = date.getHours();
  return h >= WORK_END_H || h < WORK_START_H;
}

// XL_105: blocked Fri 22:00 → Mon 06:00 (full weekend + surrounding nights)
// XL_106: blocked Fri 22:00 → Sun 22:00 (no night restriction on weekdays)
function isBlockedSlot(machine: string, date: Date): boolean {
  const dow = date.getDay();
  const h   = date.getHours();
  if (dow === 6) return true;                                              // Saturday — both machines
  if (dow === 0) return machine === "XL_105" || h < WORK_END_H;           // Sunday — XL_105 all day, XL_106 until 22:00
  if (dow === 5 && h >= WORK_END_H) return true;                          // Friday night — both machines
  if (machine === "XL_105" && isNightXL105(date)) return true;            // Weekday nights — XL_105 only
  return false;
}

function isSameDayLocal(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  schedule: MachineWorkHours[],
  exceptions?: MachineScheduleException[]
): boolean {
  const exc = exceptions?.find(
    (e) => e.machine === machine && isSameDayLocal(new Date(e.date), date)
  );
  const row = exc ?? schedule.find((r) => r.machine === machine && r.dayOfWeek === date.getDay());
  if (!row) return isBlockedSlot(machine, date); // fallback na hardcoded
  if (!row.isActive) return true;
  const h = date.getHours();
  return h < row.startHour || h >= row.endHour;
}

function blockOverlapsBlockedTime(
  machine: string,
  start: Date,
  end: Date,
  schedule?: MachineWorkHours[],
  exceptions?: MachineScheduleException[]
): boolean {
  let cur = new Date(start.getTime());
  while (cur < end) {
    const blocked = schedule
      ? isBlockedSlotDynamic(machine, cur, schedule, exceptions)
      : isBlockedSlot(machine, cur);
    if (blocked) return true;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return false;
}

function getBlockedPeriodEnd(
  machine: string,
  blockedPoint: Date,
  schedule?: MachineWorkHours[],
  exceptions?: MachineScheduleException[]
): Date {
  let cur = new Date(blockedPoint.getTime());
  while (schedule
    ? isBlockedSlotDynamic(machine, cur, schedule, exceptions)
    : isBlockedSlot(machine, cur)) {
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return cur;
}

function snapToNextValidStart(
  machine: string,
  proposedStart: Date,
  durationMs: number,
  schedule?: MachineWorkHours[],
  exceptions?: MachineScheduleException[]
): Date {
  let start = new Date(proposedStart.getTime());
  for (let i = 0; i < 20; i++) {
    const end = new Date(start.getTime() + durationMs);
    if (!blockOverlapsBlockedTime(machine, start, end, schedule, exceptions)) return start;
    let blocked = new Date(start.getTime());
    while (blocked < end && !(schedule
      ? isBlockedSlotDynamic(machine, blocked, schedule, exceptions)
      : isBlockedSlot(machine, blocked))) {
      blocked = new Date(blocked.getTime() + SLOT_MS);
    }
    if (blocked >= end) break;
    start = getBlockedPeriodEnd(machine, blocked, schedule, exceptions);
  }
  return start;
}

type BlockRef = { machine: string; originalStart: Date; originalEnd: Date };

export function snapGroupDelta(
  blocks: BlockRef[],
  proposedDeltaMs: number,
  schedule?: MachineWorkHours[],
  exceptions?: MachineScheduleException[]
): { deltaMs: number; wasSnapped: boolean } {
  let delta = proposedDeltaMs;
  let wasSnapped = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    let maxExtra = 0;
    for (const b of blocks) {
      const newStart = new Date(b.originalStart.getTime() + delta);
      const dur = b.originalEnd.getTime() - b.originalStart.getTime();
      const snapped = snapToNextValidStart(b.machine, newStart, dur, schedule, exceptions);
      const extra = snapped.getTime() - newStart.getTime();
      if (extra > maxExtra) maxExtra = extra;
    }
    if (maxExtra === 0) break;
    delta += maxExtra;
    wasSnapped = true;
  }
  return { deltaMs: delta, wasSnapped };
}

export { snapToNextValidStart };
