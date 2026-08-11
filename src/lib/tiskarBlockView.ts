/**
 * Prezentační pravidla karty bloku v tiskařském režimu.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy — komponenta
 * PrintDoneButton i BlockCard na ní jen staví a samy nic nepočítají.
 */

import { DEFAULT_FONT_SCALE, plannerTypeScale, type PlannerTypeScale } from "./plannerTypography";

const DEFAULT_TS = plannerTypeScale(DEFAULT_FONT_SCALE);

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
 * Prahy navazují na layout režimy karty: od `ts.thresholds.full` je plný layout
 * a vejde se pruh přes celou šířku, od `ts.thresholds.micro` čtverec s háčkem,
 * pod tím karta nevykresluje obsah vůbec → `null`.
 *
 * Prahy 140 a 96 rostou s mřížkou (`ts.slotFactor`) — porovnávají se s
 * `layoutHeight`, který taky roste s mřížkou, takže je to dimenzionálně
 * správně. Velikost popisku uvnitř bar varianty naopak roste s PÍSMEM
 * (`ts.fontFactor`) — jinak by na XL popisek „Hotovo" vyrostl jen o 12 %
 * místo 35 % jako zbytek textu karty (nález z code review, 8/2026).
 */
export function printDoneSize(layoutHeight: number, ts: PlannerTypeScale = DEFAULT_TS): PrintDoneSize | null {
  const big = Math.round(140 * ts.slotFactor);
  const mid = Math.round(96 * ts.slotFactor);
  if (layoutHeight >= big) return { variant: "bar", height: 40, fontSize: Math.round(16 * ts.fontFactor) };
  if (layoutHeight >= mid) return { variant: "bar", height: 32, fontSize: Math.round(14 * ts.fontFactor) };
  if (layoutHeight >= ts.thresholds.full) return { variant: "bar", height: 24, fontSize: 11.5 };
  if (layoutHeight >= ts.thresholds.micro) return { variant: "square", height: 26, fontSize: 15 };
  return null;
}

// ── Výškový rozpočet karty v tiskařském režimu ────────────────────────────────
// Karta je flex column s `overflow: hidden`, takže co se nevejde, to se ořízne.
// Tlačítko Hotovo má přednost před SplitChipem — tiskař musí mít vždy čím
// odklepnout tisk. Výšky řádků 1 a spec pásu se od 8/2026 berou ze stupně
// písma (`ts.rowHeights`, `plannerTypography.ts`), ne z napevno zapsaných čísel.

/** SplitChip včetně marginTop 6, borderu a paddingu. */
const SPLIT_CHIP_PX = 25;
/** Odsazení kolem pruhu Hotovo: paddingTop 2 + paddingBottom 5. */
const PRINT_BAR_PADDING_PX = 7;

/**
 * Vejde se SplitChip do karty, aniž by vytlačil tlačítko Hotovo pod ořez?
 *
 * Bez této brzdy skončil na hodinovém bloku (52 px) se split partnerem celý
 * zelený pruh Hotovo mimo kartu a tiskař neměl jak potvrdit tisk — regrese
 * zachycená před nasazením 3. 8. 2026. Výšky řádků se od 8/2026 berou ze stupně
 * písma (`ts.rowHeights`), ne z napevno zapsaných čísel — jinak by se ta regrese
 * při zvětšení písma vrátila.
 */
export function splitChipFits(
  layoutHeight: number,
  printDone: PrintDoneSize | null,
  specRows: 0 | 1 | 2,
  ts: PlannerTypeScale = DEFAULT_TS
): boolean {
  const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
  const specReserve = specRows === 2 ? ts.rowHeights.spec2 : specRows === 1 ? ts.rowHeights.spec1 : 0;
  const used = ts.rowHeights.header + specReserve + barReserve;
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
