/**
 * Vrátí pondělí daného týdne (UTC). Vstup: libovolný den, Výstup: pondělí 00:00:00 UTC.
 */
export function weekStartFromDate(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = neděle, 1 = pondělí, ...
  const diff = dow === 0 ? -6 : 1 - dow; // neděle → -6, pondělí → 0, úterý → -1, ...
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * Vrátí 7 po sobě jdoucích dnů od `start` (pondělí).
 */
export function weekDatesFromStart(start: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d);
  }
  return out;
}

/**
 * ISO 8601 číslo týdne (1-53).
 */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
