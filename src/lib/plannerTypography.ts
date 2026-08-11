/**
 * Velikost písma v plánu — jediný zdroj pravdy (etapa čitelnost timeline, 8/2026).
 *
 * Do 8/2026 bylo písmo v `BlockCard.tsx` zapsané absolutně v pixelech (48 výskytů
 * `fontSize`, 8–13 px) a prahy hustoty napevno jako 48/44/24/14. Zoom slider měnil
 * jen `slotHeight`, takže bloky rostly, ale text ne — plán byl na tabuli nečitelný.
 *
 * Klíčové pravidlo: **prahy hustoty se POČÍTAJÍ z písma, nezapisují se ručně.**
 * Kdyby písmo rostlo a prahy zůstaly, obsah karty by se oříznul.
 *
 * Čistá logika bez Reactu, aby šla pokrýt unit testy.
 */

/** Koeficienty stupňů. Zmenšení pod dnešek (`S`) se záměrně nedělá. */
export const PLANNER_FONT_SCALES = { M: 1, L: 1.15, XL: 1.35 } as const;

export type PlannerFontScale = keyof typeof PLANNER_FONT_SCALES;

/** Pořadí pro vykreslení přepínače — od nejmenšího. */
export const PLANNER_FONT_SCALE_KEYS = ["M", "L", "XL"] as const;

export const DEFAULT_FONT_SCALE: PlannerFontScale = "M";

/** Klíč v localStorage. Nastavení je vázané na ZAŘÍZENÍ, ne na uživatele. */
export const FONT_SCALE_STORAGE_KEY = "ig-planner-font-scale";

export type PlannerTypeScale = {
  key: PlannerFontScale;
  /** Číslo zakázky. */
  num: number;
  /** Popis zakázky. */
  desc: number;
  /** Datumový chip D/M/E/P. */
  chip: number;
  /** Pás specifikace. */
  spec: number;
  /** Značka „S" místo pásu na nízké kartě. */
  specChip: number;
  /** Mini-chip barev/laku/materiálu. */
  mini: number;
  /** Štítek deadline / kalendář v rohu karty. */
  badge: number;
  /** Popisek hodiny na časové ose. */
  rail: number;
  /** Hlavička sloupce stroje. */
  machineHead: number;
  /** Krytí popisu. V novém layoutu plný kontrast, v jednořádkových režimech utlumený. */
  descOpacity: number;
  descOpacityTiny: number;
  /** Násobitel `slotHeight` — mřížka roste pomaleji než písmo. */
  slotFactor: number;
  /** Prahy hustoty karty, odvozené z výšek řádků. */
  thresholds: { full: number; compact: number; tiny: number; micro: number };
  /** Od jaké výšky je pás specifikace dvouřádkový (dnes 80 px). */
  specTwoLine: number;
  /** Od jaké výšky vidí pás specifikace tiskař (dnes 80 px — má přednost tlačítko Hotovo). */
  tiskarSpecMin: number;
  /** Výšky řádků pro výškový rozpočet tiskařské karty (`tiskarBlockView.ts`). */
  rowHeights: { header: number; spec1: number; spec2: number };
};

/**
 * Odhad výšky řádku s číslem zakázky z velikosti jeho písma.
 * Hodnota 1,25 je `line-height` 1,2 plus rezerva na dotažnice.
 * POZOR: je to odhad, ne změřená hodnota. Když spadne strážný test
 * v `plannerTypography.test.ts`, snižuje se TOHLE, ne prahy.
 */
const NUM_ROW_FACTOR = 1.25;
/** Výška jednořádkového datumového chipu i s rámečkem a paddingem. */
const CHIP_ROW_FACTOR = 1.6;
/** Svislé odsazení plného layoutu (paddingTop + gap + paddingBottom). */
const FULL_PADDING_PX = 12;

export function plannerTypeScale(key: PlannerFontScale): PlannerTypeScale {
  const s = PLANNER_FONT_SCALES[key];

  const num  = 12 * s + 1.5;
  const desc = 10 * s + 1;
  const chip = 10 * s + 0.5;
  const spec = 10 * s + 0.5;

  const full = Math.round(num * NUM_ROW_FACTOR + chip * CHIP_ROW_FACTOR + FULL_PADDING_PX);

  return {
    key,
    num, desc, chip, spec,
    specChip: 9 * s,
    mini: 8 * s + 1,
    badge: 9 * s,
    rail: 9 * s,
    machineHead: 12 * s,
    descOpacity: 1,
    descOpacityTiny: 0.9,
    slotFactor: 1 + (s - 1) * 0.35,
    thresholds: {
      full,
      compact: full - 5,
      // Jednořádkový režim potřebuje jen řádek textu, roste proto pomaleji.
      tiny: Math.round(24 * s * 0.9),
      // Nejnižší režim ukazuje pouhé číslo — nezvětšuje se, jinak by karta
      // pod ním neukázala vůbec nic.
      micro: 14,
    },
    specTwoLine: Math.round(80 * s),
    tiskarSpecMin: Math.round(80 * s),
    rowHeights: {
      header: Math.round(num * 1.2 + 8),
      spec1:  Math.round(spec * 1.3 + 7),
      spec2:  Math.round(spec * 2.6 + 7),
    },
  };
}

export function isPlannerFontScale(v: unknown): v is PlannerFontScale {
  return typeof v === "string" && v in PLANNER_FONT_SCALES;
}

/**
 * Výška slotu (30 min) po zohlednění stupně písma.
 *
 * `Math.round` je POVINNÝ: `slotHeight` je celé číslo a stojí na něm veškerá
 * matematika drag & dropu (`dateToY` / `yToDate` a přepočty delty). Neceločíselná
 * hodnota by zavedla novou třídu zaokrouhlovacích chyb do přetahování bloků.
 */
export function effectiveSlotHeight(slotHeight: number, ts: PlannerTypeScale): number {
  return Math.max(3, Math.round(slotHeight * ts.slotFactor));
}
