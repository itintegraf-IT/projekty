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
