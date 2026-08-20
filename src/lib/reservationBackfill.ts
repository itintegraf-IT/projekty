import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { computePrintMinutes, expandPrintTime, SLOT_MS, type CompanyDayInterval } from "@/lib/printTime";

export type BackfillRowInput = {
  id: number;
  machine: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
};

export type BackfillClassification =
  | { kind: "SKIP_HAS_PM" }        // už vyplněno — nedotýkat se (idempotence)
  | { kind: "SKIP_UNALIGNED" }     // start/end mimo 30min mřížku — zůstává legacy-rigidní (spec §3 krok 2)
  | { kind: "SKIP_NO_MINUTES" }    // inverze dala 0 minut (blok celý mimo provoz) — zůstává legacy-rigidní
  | { kind: "CONFORMS"; printMinutes: number }                              // → scheduleBypassed = false
  | { kind: "MISMATCH"; printMinutes: number; expandedEnd: Date | null };   // → scheduleBypassed = true

/**
 * Klasifikace jednoho REZERVACE bloku pro backfill tiskových hodin (etapa 9, fáze 1).
 *
 * Metoda dle specu §3: pm = computePrintMinutes(...) — INVERZE dnešní expanze,
 * ne prostý elapsed. CONFORMS = zpětná expanze reprodukuje PŘESNĚ uložený end,
 * blok po flipu okamžitě konformuje (žádná drift vlna hned po backfillu).
 * MISMATCH = neshoda je reálná (kalendář se od založení změnil / blok leží
 * částečně mimo provoz) → scheduleBypassed = true, analogicky effectivelyBypassed.
 *
 * Čistá funkce — kalendář dodává volající (skript přes loadMachineCalendarRange).
 */
export function classifyReservationRow(
  row: BackfillRowInput,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayInterval[],
): BackfillClassification {
  if (row.printMinutes != null) return { kind: "SKIP_HAS_PM" };
  if (row.startTime.getTime() % SLOT_MS !== 0 || row.endTime.getTime() % SLOT_MS !== 0) {
    return { kind: "SKIP_UNALIGNED" };
  }
  const pm = computePrintMinutes(row.machine, row.startTime, row.endTime, weekShifts, companyDays);
  if (pm <= 0) return { kind: "SKIP_NO_MINUTES" };
  const exp = expandPrintTime(row.machine, row.startTime, pm, weekShifts, companyDays, false);
  if (exp.ok && exp.end.getTime() === row.endTime.getTime()) {
    return { kind: "CONFORMS", printMinutes: pm };
  }
  return { kind: "MISMATCH", printMinutes: pm, expandedEnd: exp.ok ? exp.end : null };
}
