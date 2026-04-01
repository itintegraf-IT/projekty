import type { MachineWorkHours, MachineWorkHoursTemplate } from "@/lib/machineWorkHours";
import type { MachineScheduleException } from "@/lib/machineScheduleException";
import { pragueOf } from "@/lib/dateUtils";
import { isHardcodedBlocked, resolveScheduleRows } from "@/lib/scheduleValidation";
import { getSlotRange } from "@/lib/timeSlots";

const SLOT_MS = 30 * 60 * 1000;

function isBlockedSlotDynamic(
  machine: string,
  date: Date,
  schedule: MachineWorkHours[],
  exceptions?: MachineScheduleException[]
): boolean {
  const { slot, dayOfWeek, dateStr } = pragueOf(date); // Prague TZ
  // Exception přebíjí template — stejná precedence jako server
  const excRow = exceptions?.find(
    (e) => e.machine === machine && new Date(e.date).toISOString().slice(0, 10) === dateStr
  );
  if (excRow) {
    if (!excRow.isActive) return true;
    const excRange = getSlotRange(excRow);
    return slot < excRange.startSlot || slot >= excRange.endSlot;
  }
  const row = schedule.find((r) => r.machine === machine && r.dayOfWeek === dayOfWeek);
  if (!row) {
    // Zrcadlení serverové logiky: template existuje ale chybí řádek pro tento den → blokováno.
    if (schedule.some((r) => r.machine === machine)) return true;
    return isHardcodedBlocked(machine, dayOfWeek, slot);
  }
  if (!row.isActive) return true;
  const rowRange = getSlotRange(row);
  return slot < rowRange.startSlot || slot >= rowRange.endSlot;
}

type BlockRef = { machine: string; originalStart: Date; originalEnd: Date };

// ─── Template-aware snap funkce ────────────────────────────────────────────
// Tyto funkce resolvují schedule per-slot datum, takže správně respektují
// dočasné šablony na hranicích platnosti (např. šablona platná jen pro červenec).

function blockOverlapsBlockedTimeWithTemplates(
  machine: string,
  start: Date,
  end: Date,
  templates: MachineWorkHoursTemplate[],
  exceptions?: MachineScheduleException[],
  cache?: Map<string, ReturnType<typeof resolveScheduleRows>>
): boolean {
  const scheduleCache = cache ?? new Map<string, ReturnType<typeof resolveScheduleRows>>();
  let cur = new Date(start.getTime());
  while (cur < end) {
    const { dateStr } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, templates));
    if (isBlockedSlotDynamic(machine, cur, scheduleCache.get(dateStr)!, exceptions)) return true;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return false;
}

function getBlockedPeriodEndWithTemplates(
  machine: string,
  blockedPoint: Date,
  templates: MachineWorkHoursTemplate[],
  exceptions?: MachineScheduleException[],
  cache?: Map<string, ReturnType<typeof resolveScheduleRows>>
): Date {
  const scheduleCache = cache ?? new Map<string, ReturnType<typeof resolveScheduleRows>>();
  let cur = new Date(blockedPoint.getTime());
  while (true) {
    const { dateStr } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, templates));
    if (!isBlockedSlotDynamic(machine, cur, scheduleCache.get(dateStr)!, exceptions)) break;
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return cur;
}

export function snapToNextValidStartWithTemplates(
  machine: string,
  proposedStart: Date,
  durationMs: number,
  templates: MachineWorkHoursTemplate[],
  exceptions?: MachineScheduleException[]
): Date {
  let start = new Date(proposedStart.getTime());
  // Sdílená cache přes všechny iterace — eliminuje opakované resolveScheduleRows pro stejný den
  const scheduleCache = new Map<string, ReturnType<typeof resolveScheduleRows>>();
  for (let i = 0; i < 20; i++) {
    const end = new Date(start.getTime() + durationMs);
    if (!blockOverlapsBlockedTimeWithTemplates(machine, start, end, templates, exceptions, scheduleCache)) return start;
    let blocked = new Date(start.getTime());
    while (blocked < end) {
      const { dateStr } = pragueOf(blocked);
      if (!scheduleCache.has(dateStr)) scheduleCache.set(dateStr, resolveScheduleRows(machine, blocked, templates));
      if (isBlockedSlotDynamic(machine, blocked, scheduleCache.get(dateStr)!, exceptions)) break;
      blocked = new Date(blocked.getTime() + SLOT_MS);
    }
    if (blocked >= end) break;
    start = getBlockedPeriodEndWithTemplates(machine, blocked, templates, exceptions, scheduleCache);
  }
  return start;
}

export function snapGroupDeltaWithTemplates(
  blocks: BlockRef[],
  proposedDeltaMs: number,
  templates: MachineWorkHoursTemplate[],
  exceptions?: MachineScheduleException[]
): { deltaMs: number; wasSnapped: boolean } {
  let delta = proposedDeltaMs;
  let wasSnapped = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    let maxExtra = 0;
    for (const b of blocks) {
      const newStart = new Date(b.originalStart.getTime() + delta);
      const dur = b.originalEnd.getTime() - b.originalStart.getTime();
      const snapped = snapToNextValidStartWithTemplates(b.machine, newStart, dur, templates, exceptions);
      const extra = snapped.getTime() - newStart.getTime();
      if (extra > maxExtra) maxExtra = extra;
    }
    if (maxExtra === 0) break;
    delta += maxExtra;
    wasSnapped = true;
  }
  return { deltaMs: delta, wasSnapped };
}
