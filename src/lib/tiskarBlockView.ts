/**
 * Prezentační pravidla karty bloku v tiskařském režimu.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy — komponenta
 * PrintDoneButton i BlockCard na ní jen staví a samy nic nepočítají.
 */

/** Podoba tlačítka Hotovo podle výšky bloku. */
export type PrintDoneSize =
  | { variant: "bar";    height: 40 | 32 | 24; fontSize: number }
  | { variant: "square"; height: 26;           fontSize: number };

/**
 * Rozměr tlačítka Hotovo pro danou výšku bloku (`layoutHeight` z BlockCard).
 * Prahy navazují na layout režimy karty: od 48 px je MODE_FULL a vejde se pruh
 * přes celou šířku, 14–47 px jsou COMPACT/TINY/MICRO (čtverec s háčkem),
 * pod 14 px karta nevykresluje obsah vůbec → `null`.
 */
export function printDoneSize(layoutHeight: number): PrintDoneSize | null {
  if (layoutHeight >= 140) return { variant: "bar", height: 40, fontSize: 16 };
  if (layoutHeight >= 96)  return { variant: "bar", height: 32, fontSize: 14 };
  if (layoutHeight >= 48)  return { variant: "bar", height: 24, fontSize: 11.5 };
  if (layoutHeight >= 14)  return { variant: "square", height: 26, fontSize: 15 };
  return null;
}

/**
 * Běží tisk bloku právě teď? Rozhoduje o zeleném zvýraznění karty u tiskaře.
 * Konec je vyloučený (t < end), aby na hranici dvou navazujících bloků
 * svítil vždy jen jeden. Odklepnutý blok neběží, i když je uvnitř svého času.
 */
export function isBlockRunningNow(
  startTime: string | Date,
  endTime: string | Date,
  now: Date,
  isPrintDone: boolean
): boolean {
  if (isPrintDone) return false;
  const t = now.getTime();
  return t >= new Date(startTime).getTime() && t < new Date(endTime).getTime();
}
