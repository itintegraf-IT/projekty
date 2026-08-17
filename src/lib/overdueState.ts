// ─── overdueState.ts ───────────────────────────────────────────────────────────
// Je zpožděná neodklepnutá zakázka důvod ke křiku?
//
// Rozhodnutí majitele (17. 8. 2026): „Nechci to rozlišovat. Nebude se stávat tak
// často, že to zapomenou odkliknout. Proto to chci mít vždy rudé." Do té doby plán
// rozlišoval dva stupně — čerstvý (alarm, sytá červená) a zbytkový (stale, tlumená
// oranžová s červeným pruhem) — protože tlumený vzhled zpoždění splýval s tlumeným
// vzhledem hotové zakázky a obě říkaly totéž, „tuhle už neřeš", přestože znamenají
// pravý opak (připomínka plánovače, 12. 8. 2026). Dvoustupňovost i s ní spojené
// šestnáctihodinové okno se ruší celé: zpožděná zakázka je od teď VŽDY červená,
// tak, jak se dřív kreslil jen `alarm`, bez ohledu na to, jak dlouho to trvá.
//
// Funkce je ZÁMĚRNĚ jen o čase. Že se stav týká výhradně ZAKAZKA a že se
// pozastavená zakázka za zpožděnou nepovažuje, si hlídá volající (BlockCard) —
// tady by z toho byla závislost na typu bloku kvůli dvěma porovnáním.

/**
 * Je neodklepnutá zakázka po termínu?
 *
 * Počítá se od KONCE, ne podle dne startu — noční směna 22:00–6:00 by jinak
 * ráno vypadla, protože „nezačala dnes".
 *
 * `true`, právě když: nikdo neodklepl (`printCompletedAt == null`), `endTime`
 * je čitelné datum a `now` je ostře za ním (blok, který právě v tuhle
 * milisekundu končí, ještě běží). Nečitelné datum vrací `false` — neznámý
 * čas není důvod křičet.
 */
export function isOverdueUnacknowledged(
  endTime: string | Date,
  printCompletedAt: string | Date | null,
  now: Date,
): boolean {
  if (printCompletedAt != null) return false;

  const end = endTime instanceof Date ? endTime.getTime() : new Date(endTime).getTime();
  if (!Number.isFinite(end)) return false;

  // Ostrá nerovnost: blok, který právě v tuhle milisekundu končí, ještě běží.
  return now.getTime() > end;
}
