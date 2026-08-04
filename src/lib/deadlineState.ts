// ─── deadlineState ─────────────────────────────────────────────────────────────
// Termínový stav chipů DATA / MATERIÁL / PANTONE na kartě bloku — jediný zdroj
// pravdy. Do 8/2026 to byla privátní funkce v BlockCard.tsx bez testů; přesunuta
// sem kvůli změně prahu na 14:00 (připomínka plánovače) a pokrytí testy.
//
// Klíčová změna oproti původní verzi: porovnávaly se civilní datumové stringy,
// takže hranicí byla fakticky půlnoc. Nově je termín konkrétní okamžik —
// 14:00 pražského času daného dne (DEADLINE_HOUR).

import { normalizeCivilDateInput, pragueToUTC, utcToPragueDateStr } from "./dateUtils";

/**
 * Hodina pražského času, kdy se termín dodání považuje za splatný. Plánovač
 * počítá s tím, že data/materiál/pantone dorazí odpoledne — proto ne půlnoc.
 */
export const DEADLINE_HOUR = 14;

export type DeadlineState = "none" | "ok" | "warning" | "danger" | "earlyStart";

/**
 * @param requiredDate  termín dodání (civilní datum nebo ISO timestamp)
 * @param ok            termín je odbavený (dataOk / materialOk / pantoneOk)
 * @param now           aktuální čas (v TimelineGrid tiká à 60 s)
 * @param blockStartTime začátek tisku bloku — kvůli detekci „tiskne se dřív, než to dorazí"
 *
 * Pořadí vyhodnocení je záměrné: `ok` přebíjí vše, `earlyStart` přebíjí
 * warning/danger (kolize s výrobou je naléhavější než uplynulý termín).
 */
export function deadlineState(
  requiredDate: string | null | undefined,
  ok: boolean,
  now: Date,
  blockStartTime?: string | Date,
): DeadlineState {
  const dueDateStr = normalizeCivilDateInput(requiredDate);
  if (!dueDateStr) return "none";
  if (ok) return "ok";

  // Termín jako skutečný okamžik, ne jako celý den.
  const dueAt = pragueToUTC(dueDateStr, DEADLINE_HOUR, 0);

  // Blok začne tisknout dřív, než materiál/data dorazí.
  if (blockStartTime) {
    const start = new Date(blockStartTime);
    if (!isNaN(start.getTime()) && start.getTime() < dueAt.getTime()) return "earlyStart";
  }

  if (now.getTime() >= dueAt.getTime()) return "danger";
  if (utcToPragueDateStr(now) === dueDateStr) return "warning";
  return "none";
}
