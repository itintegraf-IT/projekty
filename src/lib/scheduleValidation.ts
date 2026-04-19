import { pragueOf } from "./dateUtils";
import { deriveHoursFromShifts, shiftFromHour, resolveShiftBounds } from "./shifts";
import { type MachineWeekShiftsRow, weekStartStrFromDateStr } from "./machineWeekShifts";
import { slotFromHourBoundary } from "./timeSlots";

export type DayScheduleRow = {
  machine: string;
  dayOfWeek: number;
  startHour: number;    // legacy union (earliest start .. latest end)
  endHour: number;
  startSlot: number;
  endSlot: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  // NEW — multi-interval (v minutách od půlnoci, cross-midnight pro NIGHT povolené)
  intervals: Array<{ shift: "MORNING" | "AFTERNOON" | "NIGHT"; startMin: number; endMin: number }>;
};

/**
 * Vrátí 7 řádků provozu pro týden obsahující `date` (nebo méně, pokud některé chybí).
 * Datum se interpretuje v Europe/Prague timezone; weekStart je pondělí toho týdne.
 *
 * Výstup má stejnou strukturu jako staré MachineWorkHours — callerům stačí filtr podle dayOfWeek.
 */
export function resolveScheduleRows(
  machine: string,
  date: Date,
  weekShifts: MachineWeekShiftsRow[]
): DayScheduleRow[] {
  const { dateStr } = pragueOf(date);
  const weekStart = weekStartStrFromDateStr(dateStr);
  const weekRows = weekShifts.filter((w) => w.machine === machine && w.weekStart === weekStart);
  return weekRows.map((w) => {
    const { startHour, endHour } = deriveHoursFromShifts(w);
    const intervals: DayScheduleRow["intervals"] = [];
    for (const shift of ["MORNING", "AFTERNOON", "NIGHT"] as const) {
      const b = resolveShiftBounds(w, shift);
      if (b) intervals.push({ shift, startMin: b.startMin, endMin: b.endMin });
    }
    return {
      machine,
      dayOfWeek: w.dayOfWeek,
      startHour,
      endHour,
      startSlot: slotFromHourBoundary(startHour),
      endSlot: slotFromHourBoundary(endHour),
      isActive: w.isActive,
      morningOn: w.morningOn,
      afternoonOn: w.afternoonOn,
      nightOn: w.nightOn,
      intervals,
    };
  });
}

/**
 * Serializuje Prisma MachineWeekShifts objekty na MachineWeekShiftsRow[].
 * `weekStart` je @db.Date → Date (UTC midnight) → YYYY-MM-DD.
 */
export function serializeWeekShifts(
  raw: {
    machine: string; weekStart: Date | string; dayOfWeek: number;
    isActive: boolean; morningOn: boolean; afternoonOn: boolean; nightOn: boolean;
    morningStartMin?: number | null; morningEndMin?: number | null;
    afternoonStartMin?: number | null; afternoonEndMin?: number | null;
    nightStartMin?: number | null; nightEndMin?: number | null;
    id?: number;
  }[]
): MachineWeekShiftsRow[] {
  return raw.map((w) => ({
    id: w.id,
    machine: w.machine,
    weekStart: typeof w.weekStart === "string" ? w.weekStart.slice(0, 10) : w.weekStart.toISOString().slice(0, 10),
    dayOfWeek: w.dayOfWeek,
    isActive: w.isActive,
    morningOn: Boolean(w.morningOn),
    afternoonOn: Boolean(w.afternoonOn),
    nightOn: Boolean(w.nightOn),
    morningStartMin: w.morningStartMin ?? null,
    morningEndMin: w.morningEndMin ?? null,
    afternoonStartMin: w.afternoonStartMin ?? null,
    afternoonEndMin: w.afternoonEndMin ?? null,
    nightStartMin: w.nightStartMin ?? null,
    nightEndMin: w.nightEndMin ?? null,
  }));
}

/**
 * Hardcoded pravidla pro bloky mimo provoz — fallback když weekShifts neobsahují
 * řádek pro daný den. Parametry jsou v Europe/Prague timezone.
 */
export function isHardcodedBlocked(machine: string, dayOfWeek: number, slot: number): boolean {
  if (dayOfWeek === 6) return true;                                     // sobota — oba stroje
  if (dayOfWeek === 0) return machine === "XL_105" || slot < slotFromHourBoundary(22);       // neděle — XL_105 celý den, XL_106 do 22:00
  if (dayOfWeek === 5 && slot >= slotFromHourBoundary(22)) return true;                       // pátek noc — oba stroje
  if (machine === "XL_105" && (slot >= slotFromHourBoundary(22) || slot < slotFromHourBoundary(6))) return true;   // všední noc — jen XL_105
  return false;
}

/**
 * Validace bloku vůči provozním hodinám z MachineWeekShifts.
 * Per-slot resolve s cache po dnech — správně zpracovává bloky přes víkend
 * a hranice týdnů.
 *
 * Název ponechán (historický důvod) — přijímá weekShifts místo templates+exceptions.
 */
export function checkScheduleViolationWithTemplates(
  machine: string,
  startTime: Date,
  endTime: Date,
  weekShifts: MachineWeekShiftsRow[]
): string | null {
  const SLOT_MS = 30 * 60 * 1000;
  const scheduleCache = new Map<string, DayScheduleRow[]>();
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) {
      scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, weekShifts));
    }
    const schedule = scheduleCache.get(dateStr)!;
    const row = schedule.find((r) => r.dayOfWeek === dayOfWeek);
    if (!row) {
      // Chybí řádek pro tento den. Pokud weekShifts vůbec nic pro stroj+týden nemají,
      // fallback na hardcoded. Pokud řádky existují ale chybí ten náš → den je mimo provoz.
      if (schedule.length > 0 || isHardcodedBlocked(machine, dayOfWeek, slot)) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    } else {
      const shift = shiftFromHour(hour + minute / 60);
      const shiftOn = shift === "MORNING" ? row.morningOn
                    : shift === "AFTERNOON" ? row.afternoonOn
                    : row.nightOn;
      if (!row.isActive || !shiftOn) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}
