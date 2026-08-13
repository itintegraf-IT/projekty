// ─── overdueState.ts ───────────────────────────────────────────────────────────
// Jak akutní je neodklepnutá zakázka, které už vypršel čas.
//
// Do 8/2026 znal plán jen dvouhodnotové „po termínu ano/ne" a kreslil ho tlumeně
// (BLOCK_OVERDUE, krytí 0,22/0,14). Hotová zakázka se ale kreslí stejně tlumeně
// (BLOCK_PRINT_DONE, 0,13/0,07), takže obě splývaly a říkaly totéž — „tuhle už
// neřeš" — přestože znamenají pravý opak (připomínka plánovače, 12. 8. 2026).
// Odsud se proto rozlišují dva stavy: čerstvý (alarm, kreslí se sytě) a zbytkový
// (stale, zůstává tlumený).
//
// Funkce je ZÁMĚRNĚ jen o čase. Že se stav týká výhradně ZAKAZKA a že se
// pozastavená zakázka za zpožděnou nepovažuje, si hlídá volající (BlockCard) —
// tady by z toho byla závislost na typu bloku kvůli dvěma porovnáním.

export type OverdueState = "none" | "alarm" | "stale";

/**
 * Jak dlouho po svém konci je neodklepnutá zakázka ještě AKUTNÍ.
 *
 * Počítá se od KONCE, ne podle dne startu — noční směna 22:00–6:00 by jinak
 * ráno vypadla, protože „nezačala dnes".
 *
 * Řídí červený alarm zpoždění na kartě bloku v PLÁNU. Velká karta Monitoru
 * u stroje jím řídit PŘESTALA (13. 8. 2026, `pickHeroBlock` v `monitorView.ts`
 * teď drží zakázku, dokud tiskař nerozhodne) — `monitorView.ts` konstantu
 * pořád re-exportuje, ale jen jako záruku proti tomu, aby si ji odtud někdo
 * zkopíroval zpátky jako vlastní číslo.
 */
export const OVERDUE_WINDOW_MS = 16 * 60 * 60 * 1000;

/**
 * `none`  — buď odklepnuto, nebo konec ještě nenastal,
 * `alarm` — konec je v minulosti nejvýš OVERDUE_WINDOW_MS a nikdo neodklepl,
 * `stale` — totéž, ale déle než OVERDUE_WINDOW_MS.
 *
 * Nečitelné datum (prázdný string, rozbitý ISO) vrací `none` — neznámý čas není
 * důvod křičet.
 */
export function overdueAlarmState(
  endTime: string | Date,
  printCompletedAt: string | Date | null,
  now: Date,
): OverdueState {
  if (printCompletedAt != null) return "none";

  const end = endTime instanceof Date ? endTime.getTime() : new Date(endTime).getTime();
  if (!Number.isFinite(end)) return "none";

  const elapsed = now.getTime() - end;
  // Ostrá nerovnost: blok, který právě v tuhle milisekundu končí, ještě běží.
  if (elapsed <= 0) return "none";

  return elapsed <= OVERDUE_WINDOW_MS ? "alarm" : "stale";
}
