import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { snapStartToNextRunnableSlot, type CompanyDayInterval } from "@/lib/printTime";

/**
 * Klient-safe helpery modelu tiskových hodin (žádná DB, žádný server import).
 * Mutační cesty klienta jimi připravují payload — end vždy autoritativně počítá server.
 */

/**
 * Délka bloku v minutách pro payload: ZAKAZKA = printMinutes (fallback elapsed), jinak elapsed.
 * Elapsed fallback u ZAKAZKA se zarovnává na 30min grid (min 30) — server vyžaduje pm % 30 === 0
 * a legacy blok s nezarovnaným spanem by jinak spadl na SCHEDULE_VIOLATION při uložení.
 */
export function blockPrintMinutes(b: {
  type: string;
  printMinutes?: number | null;
  startTime: string | Date;
  endTime: string | Date;
}): number {
  const elapsed = Math.round(
    (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000
  );
  if (b.type !== "ZAKAZKA") return elapsed;
  return b.printMinutes ?? Math.max(30, Math.round(elapsed / 30) * 30);
}

/** Převod klientských CompanyDay záznamů na intervaly pro daný stroj (global + machine-specific). */
export function companyDayIntervalsFor(
  machine: string,
  companyDays: { machine?: string | null; startDate: string | Date; endDate: string | Date }[]
): CompanyDayInterval[] {
  return companyDays
    .filter((cd) => !cd.machine || cd.machine === machine)
    .map((cd) => ({ start: new Date(cd.startDate), end: new Date(cd.endDate) }));
}

/**
 * Skupinový snap deltas pro lasso přesun v modelu tiskových hodin: snapují se jen STARTY
 * (délku rozloží server expanzí). Nahrazuje duration-based snapGroupDeltaWithTemplates.
 * Vrací null, když některý start nejde v horizontu umístit — volající mutaci neodešle.
 */
export function snapGroupDeltaStartOnly(
  blocks: { machine: string; originalStart: Date }[],
  proposedDeltaMs: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: Parameters<typeof companyDayIntervalsFor>[1]
): { deltaMs: number; wasSnapped: boolean } | null {
  let delta = proposedDeltaMs;
  let wasSnapped = false;
  const intervalsByMachine = new Map<string, CompanyDayInterval[]>();
  for (const b of blocks) {
    if (!intervalsByMachine.has(b.machine)) {
      intervalsByMachine.set(b.machine, companyDayIntervalsFor(b.machine, companyDays));
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    let maxExtra = 0;
    for (const b of blocks) {
      const newStart = new Date(b.originalStart.getTime() + delta);
      const snapped = snapStartToNextRunnableSlot(
        b.machine, newStart, weekShifts, intervalsByMachine.get(b.machine)!
      );
      if (!snapped) return null;
      const extra = snapped.getTime() - newStart.getTime();
      if (extra > maxExtra) maxExtra = extra;
    }
    if (maxExtra === 0) break;
    delta += maxExtra;
    wasSnapped = true;
  }
  return { deltaMs: delta, wasSnapped };
}
