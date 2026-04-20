/**
 * Per-týdenní definice provozu stroje.
 * Nahrazuje MachineWorkHoursTemplate + MachineWorkHoursTemplateDay + MachineScheduleException.
 *
 * `weekStart` je YYYY-MM-DD pondělí příslušného týdne (Europe/Prague civil date,
 * reprezentované jako UTC půlnoc v DB sloupci `DATE`).
 */
export type MachineWeekShiftsRow = {
  id?: number;
  machine: string;
  weekStart: string; // YYYY-MM-DD (pondělí)
  dayOfWeek: number; // 0 = neděle, 1 = pondělí, ..., 6 = sobota
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
};

/**
 * Payload pro jeden den v PUT /api/machine-week-shifts (body.days[]).
 * Pevný tvar — validátor v route.ts očekává tyto klíče.
 */
export type ShiftDayPayload = {
  dayOfWeek: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  morningStartMin: number | null;
  morningEndMin: number | null;
  afternoonStartMin: number | null;
  afternoonEndMin: number | null;
  nightStartMin: number | null;
  nightEndMin: number | null;
};

/**
 * Vrátí YYYY-MM-DD pondělí týdne, do kterého spadá civil date.
 * Operuje čistě stringově (bez TZ) — vhodné pro lookup v poli weekShifts.
 */
export function weekStartStrFromDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  dt.setUTCDate(dt.getUTCDate() + diff);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
