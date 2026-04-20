import type { MachineWeekShiftsRow } from "./machineWeekShifts";
import { weekStartStrFromDateStr } from "./machineWeekShifts";

export type ShiftType = "MORNING" | "AFTERNOON" | "NIGHT";

export const SHIFTS: readonly ShiftType[] = ["MORNING", "AFTERNOON", "NIGHT"] as const;

export const SHIFT_HOURS: Record<ShiftType, { start: number; end: number }> = {
  MORNING: { start: 6, end: 14 },
  AFTERNOON: { start: 14, end: 22 },
  NIGHT: { start: 22, end: 6 }, // přes půlnoc
};

export const SHIFT_LABELS: Record<ShiftType, string> = {
  MORNING: "Ranní",
  AFTERNOON: "Odpolední",
  NIGHT: "Noční",
};

export type ShiftFlags = {
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
};

/**
 * Vrátí typ směny pro danou hodinu (0-24).
 * Noční pokrývá 22-06 včetně půlnoci.
 */
export function shiftFromHour(hour: number): ShiftType {
  if (hour >= 6 && hour < 14) return "MORNING";
  if (hour >= 14 && hour < 22) return "AFTERNOON";
  return "NIGHT"; // 22-24 a 0-6
}

/**
 * Zda slot (0-47, 30min) patří do dané směny.
 * Slot n odpovídá hodině n/2.
 */
export function isSlotInShift(slot: number, shift: ShiftType): boolean {
  const hour = slot / 2;
  return shiftFromHour(hour) === shift;
}

/**
 * Vrátí seznam zapnutých směn pro den (podle flagů).
 * Pořadí: MORNING → AFTERNOON → NIGHT.
 */
export function activeShiftsForDay(flags: ShiftFlags): ShiftType[] {
  const out: ShiftType[] = [];
  if (flags.morningOn) out.push("MORNING");
  if (flags.afternoonOn) out.push("AFTERNOON");
  if (flags.nightOn) out.push("NIGHT");
  return out;
}

/** Vrátí efektivní hranice směny (null = směna OFF pro den). */
export function resolveShiftBounds(
  row: MachineWeekShiftsRow,
  shift: ShiftType
): { startMin: number; endMin: number } | null {
  const flagOn = shift === "MORNING" ? row.morningOn
               : shift === "AFTERNOON" ? row.afternoonOn
               : row.nightOn;
  if (!flagOn) return null;
  const def = SHIFT_HOURS[shift];
  const override = shift === "MORNING"
    ? { s: row.morningStartMin, e: row.morningEndMin }
    : shift === "AFTERNOON"
    ? { s: row.afternoonStartMin, e: row.afternoonEndMin }
    : { s: row.nightStartMin, e: row.nightEndMin };
  // Pro NIGHT: def.end = 6 = 360 min (záměrně — cross-midnight rozpoznává volající
  // přes porovnání endMin < startMin).
  return {
    startMin: override.s ?? def.start * 60,
    endMin:   override.e ?? def.end * 60,
  };
}

/**
 * Je daný okamžik aktivní podle forward semantic?
 *
 * Forward semantic: NIGHT flag dne X znamená směnu od X 22:00 do X+1 06:00.
 * Takže pondělí 00–06 je aktivní PRÁVĚ TEHDY, když neděle měla NIGHT ✓.
 * Pondělí 22–24 je aktivní právě tehdy, když PONDĚLÍ má NIGHT ✓.
 *
 * @param machine  stroj
 * @param dateStr  civil date YYYY-MM-DD (Europe/Prague)
 * @param hourMin  minuta od půlnoci dne `dateStr` (0–1439)
 * @param weekShifts  sjednocený seznam řádků přes týdny (client-side cache)
 */
export function isDateTimeActive(
  machine: string,
  dateStr: string,
  hourMin: number,
  weekShifts: MachineWeekShiftsRow[],
): boolean {
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
  const weekStart = weekStartStrFromDateStr(dateStr);
  const row = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === weekStart && w.dayOfWeek === dow,
  );
  if (row && row.isActive) {
    // MORNING + AFTERNOON: neprekračují půlnoc.
    for (const shift of ["MORNING", "AFTERNOON"] as const) {
      const b = resolveShiftBounds(row, shift);
      if (b && hourMin >= b.startMin && hourMin < b.endMin) return true;
    }
    // NIGHT dne X pokrývá jen [startMin, 1440) na dni X.
    const night = resolveShiftBounds(row, "NIGHT");
    if (night && night.endMin < night.startMin && hourMin >= night.startMin) return true;
  }
  // Tail z předchozího dne: NIGHT(X-1) pokrývá [0, prevNightEnd) na dni X.
  const prevDateStr = (() => {
    const d = new Date(dateStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const prevDow = new Date(prevDateStr + "T12:00:00Z").getUTCDay();
  const prevWeekStart = weekStartStrFromDateStr(prevDateStr);
  const prev = weekShifts.find(
    (w) => w.machine === machine && w.weekStart === prevWeekStart && w.dayOfWeek === prevDow,
  );
  if (prev && prev.isActive && prev.nightOn) {
    const b = resolveShiftBounds(prev, "NIGHT");
    if (b && b.endMin < b.startMin && hourMin < b.endMin) return true;
  }
  return false;
}

/** Derive legacy startHour/endHour from shift flags.
 *  Used both on client (grid UI) and server (normalizeDayInput).
 *  Represents the spanning interval from earliest active shift's start to latest active shift's end.
 *  If morning+night both on (non-contiguous), span = 0..24 as a simple cover.
 */
export function deriveHoursFromShifts(flags: ShiftFlags): { startHour: number; endHour: number } {
  const { morningOn, afternoonOn, nightOn } = flags;
  if (!morningOn && !afternoonOn && !nightOn) return { startHour: 0, endHour: 0 };
  if (morningOn && nightOn) return { startHour: 0, endHour: 24 };
  if (nightOn && afternoonOn) return { startHour: 14, endHour: 24 };
  if (nightOn) return { startHour: 22, endHour: 24 };
  if (morningOn && afternoonOn) return { startHour: 6, endHour: 22 };
  if (afternoonOn) return { startHour: 14, endHour: 22 };
  // morningOn only
  return { startHour: 6, endHour: 14 };
}

/**
 * Editační rozsahy pro override polí v minutách od půlnoci.
 * Uživatel může posunout hranici směny v tomto okně — mimo něj validace odmítne.
 */
export const SHIFT_EDIT_RANGES: Record<ShiftType, { start: readonly [number, number]; end: readonly [number, number] }> = {
  MORNING:   { start: [240, 480],  end: [720, 960] },
  AFTERNOON: { start: [720, 960],  end: [1200, 1440] },
  NIGHT:     { start: [1200, 1440], end: [240, 480] },
};

/** "630" → "10:30". Null/undefined → "". */
export function fmtHHMM(m: number | null | undefined): string {
  if (m === null || m === undefined) return "";
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Výchozí minuty pro směnu (start/end). */
export function defaultShiftMin(shift: ShiftType, edge: "start" | "end"): number {
  const def = SHIFT_HOURS[shift];
  return (edge === "start" ? def.start : def.end) * 60;
}
