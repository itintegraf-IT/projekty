import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { blockCalendarDrift, type CompanyDayClientRow } from "@/lib/printTimeClient";
import { isParkedDrift } from "@/lib/calendarDriftUi";

/**
 * Má se u tohoto bloku na Monitoru označit čas jako nespolehlivý?
 *
 * Monitor dřív tiskl uložený `endTime` natvrdo, i když aplikace sama uměla
 * poznat, že blok nesedí na kalendář (drift počítal jen planner a admin
 * report — tiskař na to nemá dosah, notifikace mu nechodí, `TISKAR` není
 * v `INBOX_ROLES`). Přitom je to jediný člověk, který podle toho času
 * rozhoduje, co pustí do stroje.
 *
 * Rozsah VYCHÁZÍ z klientského detektoru (`blockCalendarDrift`) — jediného,
 * který umí posoudit jeden konkrétní blok bez čekání na server. Vědomě
 * odložené bloky (`isParkedDrift`, tedy `PARKED`/`STALE_BYPASS`) se
 * VYLUČUJÍ: odložení je rozhodnutí plánovače, ne porucha, a tiskaři by
 * značka svítila natrvalo u každé zakázky, kterou plánovač vědomě posunul
 * mimo kalendář (viz `blockCalendarDrift` docblock a `docs/POUCENI.md`).
 */
export function shouldMarkDrift(
  block: Parameters<typeof blockCalendarDrift>[0],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[],
  now: Date
): boolean {
  const drift = blockCalendarDrift(block, weekShifts, companyDays, now);
  return drift !== null && !isParkedDrift(drift.reason);
}

/**
 * Text značky na Monitoru — jediné místo, které ho drží (viz `MonitorDriftNote`).
 *
 * Terminologie: jev se v aplikaci jmenuje „nesedí na kalendář" (`cascadeDialogText.ts`,
 * `TimelineGrid.tsx`, `BlockDetail.tsx`), žádný nový pojem. Výrok je o STAVU zakázky jako
 * celku, ne o konkrétním zobrazeném čase — důležité na Monitoru, protože `blockCalendarDrift`
 * má tři poruchové důvody a ne všechny se týkají konce: `END_MISMATCH`/`HORIZON_EXCEEDED` ano,
 * ale `START_NOT_RUNNABLE` se týká startu. Formulace vázaná na konkrétní čas by u posledního
 * důvodu lhala o čísle, které tiskař zrovna vidí (fronta ukazuje jen start).
 */
export const MONITOR_DRIFT_NOTE_TEXT = "⚠ nesedí na kalendář";
