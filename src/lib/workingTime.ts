import type { MachineWorkHours } from "@/lib/machineWorkHours";
import type { MachineScheduleException } from "@/lib/machineScheduleException";
import { pragueOf } from "@/lib/dateUtils";
import { isHardcodedBlocked } from "@/lib/scheduleValidation";

const SLOT_MS = 30 * 60 * 1000;

// XL_105: blocked Fri 22:00 → Mon 06:00 (full weekend + surrounding nights)
// XL_106: blocked Fri 22:00 → Sun 22:00 (no night restriction on weekdays)
function isBlockedSlot(machine: string, date: Date): boolean {
  const { hour, dayOfWeek } = pragueOf(date); // Prague TZ — správné i mimo Europe/Prague
  return isHardcodedBlocked(machine, dayOfWeek, hour);
}

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  schedule: MachineWorkHours[],
  exceptions?: MachineScheduleException[]
): boolean {
  const { hour, dayOfWeek, dateStr } = pragueOf(date); // Prague TZ
  const exc = exceptions?.find(
    (e) => e.machine === machine && new Date(e.date).toISOString().slice(0, 10) === dateStr
  );
  const row = exc ?? schedule.find((r) => r.machine === machine && r.dayOfWeek === dayOfWeek);
  if (!row) return isHardcodedBlocked(machine, dayOfWeek, hour); // fallback — stejné jako server
  if (!row.isActive) return true;
  return hour < row.startHour || hour >= row.endHour;
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
