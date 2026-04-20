import { pragueOf } from "./dateUtils";
import { resolveShiftBounds, isDateTimeActive } from "./shifts";
import { type MachineWeekShiftsRow, weekStartStrFromDateStr } from "./machineWeekShifts";
import { slotFromHourBoundary } from "./timeSlots";

export type DayScheduleRow = {
  machine: string;
  dayOfWeek: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
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
    const intervals: DayScheduleRow["intervals"] = [];
    for (const shift of ["MORNING", "AFTERNOON", "NIGHT"] as const) {
      const b = resolveShiftBounds(w, shift);
      if (b) intervals.push({ shift, startMin: b.startMin, endMin: b.endMin });
    }
    return {
      machine,
      dayOfWeek: w.dayOfWeek,
      isActive: w.isActive,
      morningOn: Boolean(w.morningOn),
      afternoonOn: Boolean(w.afternoonOn),
      nightOn: Boolean(w.nightOn),
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
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { slot, dayOfWeek, dateStr, hour, minute } = pragueOf(cur);
    const hourMin = hour * 60 + minute;
    const weekStart = weekStartStrFromDateStr(dateStr);

    // Pokud pro stroj+týden nejsou VŮBEC žádné řádky → hardcoded fallback.
    const hasAnyRowForWeek = weekShifts.some(
      (w) => w.machine === machine && w.weekStart === weekStart,
    );
    if (!hasAnyRowForWeek) {
      if (isHardcodedBlocked(machine, dayOfWeek, slot)) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    } else if (!isDateTimeActive(machine, dateStr, hourMin, weekShifts)) {
      return "Blok zasahuje do doby mimo provoz stroje.";
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}

/**
 * Forward-semantic intervaly pro daný den.
 * Vrací intervaly, které se REÁLNĚ zobrazí v sloupci dne X:
 *  - MORNING/AFTERNOON z X (bez wrap)
 *  - NIGHT(X) jen [startMin, 1440)
 *  - NIGHT(X-1) tail [0, prevEnd) — pokud X-1 měl NIGHT ✓
 *
 * Všechny intervaly jsou non-wrapping s endMin ≤ 1440.
 */
export function resolveDayIntervals(
  machine: string,
  dateStr: string,
  weekShifts: MachineWeekShiftsRow[],
): Array<{ shift: "MORNING" | "AFTERNOON" | "NIGHT"; startMin: number; endMin: number; source: "current" | "prev-tail" }> {
  const out: Array<{ shift: "MORNING" | "AFTERNOON" | "NIGHT"; startMin: number; endMin: number; source: "current" | "prev-tail" }> = [];
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  const weekStart = weekStartStrFromDateStr(dateStr);
  const row = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dow,
  );
  if (row && row.isActive) {
    for (const shift of ["MORNING", "AFTERNOON"] as const) {
      const b = resolveShiftBounds(row, shift);
      if (b) out.push({ shift, startMin: b.startMin, endMin: b.endMin, source: "current" });
    }
    const night = resolveShiftBounds(row, "NIGHT");
    if (night && night.endMin < night.startMin) {
      out.push({ shift: "NIGHT", startMin: night.startMin, endMin: 1440, source: "current" });
    }
  }
  const prevDate = (() => {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const prevDow = new Date(prevDate + "T12:00:00Z").getUTCDay();
  const prevWeekStart = weekStartStrFromDateStr(prevDate);
  const prev = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === prevWeekStart && w.dayOfWeek === prevDow,
  );
  if (prev && prev.isActive && prev.nightOn) {
    const b = resolveShiftBounds(prev, "NIGHT");
    if (b && b.endMin < b.startMin && b.endMin > 0) {
      out.push({ shift: "NIGHT", startMin: 0, endMin: b.endMin, source: "prev-tail" });
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}
