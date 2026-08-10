/**
 * Prezentační pravidla karty bloku v tiskařském režimu.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy — komponenta
 * PrintDoneButton i BlockCard na ní jen staví a samy nic nepočítají.
 */

/**
 * Podoba tlačítka Hotovo.
 * `bar` a `square` vrací printDoneSize() podle výšky bloku v plánu;
 * `hero` si sestavuje Monitor sám — v kartě bloku se nikdy nepoužije.
 */
export type PrintDoneSize =
  | { variant: "bar";    height: 40 | 32 | 24; fontSize: number }
  | { variant: "square"; height: 26;           fontSize: number }
  | { variant: "hero";   height: number;       fontSize: number };

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

// ── Výškový rozpočet karty v tiskařském režimu ────────────────────────────────
// Karta je flex column s `overflow: hidden`, takže co se nevejde, to se ořízne.
// Tlačítko Hotovo má přednost před SplitChipem — tiskař musí mít vždy čím
// odklepnout tisk. Hodnoty odpovídají skutečným stylům v BlockCard/SplitChip
// (změřeno v prohlížeči 3. 8. 2026); jsou to horní odhady, ne přesná typografie.

/** Řádek 1 karty: paddingTop 5 + řádek 12 px/1.2 + paddingBottom 3. */
const HEADER_ROW_PX = 23;
/** Pás specifikace (SpecBand) na jeden řádek: 13 px textu + 4 padding + 3 pod. */
const SPEC_ROW_1_PX = 20;
/** Pás specifikace přes dva řádky: 26 px textu + 4 padding + 3 pod. */
const SPEC_ROW_2_PX = 33;
/** SplitChip včetně marginTop 6, borderu a paddingu. */
const SPLIT_CHIP_PX = 25;
/** Odsazení kolem pruhu Hotovo: paddingTop 2 + paddingBottom 5. */
const PRINT_BAR_PADDING_PX = 7;

/**
 * Vejde se SplitChip do karty, aniž by vytlačil tlačítko Hotovo pod ořez?
 *
 * Bez této brzdy skončil na hodinovém bloku (52 px) se split partnerem celý
 * zelený pruh Hotovo mimo kartu a tiskař neměl jak potvrdit tisk — regrese
 * zachycená před nasazením 3. 8. 2026.
 */
export function splitChipFits(
  layoutHeight: number,
  printDone: PrintDoneSize | null,
  specRows: 0 | 1 | 2
): boolean {
  const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
  const specReserve = specRows === 2 ? SPEC_ROW_2_PX : specRows === 1 ? SPEC_ROW_1_PX : 0;
  const used = HEADER_ROW_PX + specReserve + barReserve;
  return layoutHeight - used >= SPLIT_CHIP_PX;
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
