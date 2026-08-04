// ─── blockStyles.ts ────────────────────────────────────────────────────────────
// Vizuální identita bloků planneru — jediný zdroj pravdy (audit #14).
//
// Do 7/2026 žily BLOCK_STYLES + getBlockStyleKey v TimelineGrid.tsx a blockShades.ts
// si getBlockStyleKey zrcadlil vlastní kopií (shadeBucket). Přesunem do lib zrcadlo
// mizí; TimelineGrid i blockShades importují odsud. Hodnoty přesunuty 1:1 — žádná
// vizuální změna.

export type BlockStyle = {
  gradient: string;
  border: string;
  accentBar: string;
  leftBg: string;
  textPrimary: string;
  textSub: string;
  glow: string;
};

export const BLOCK_STYLES: Record<string, BlockStyle> = {
  ZAKAZKA: {
    gradient:    "linear-gradient(160deg, rgba(59,130,246,0.95) 0%, rgba(37,99,235,0.88) 100%)",
    border:      "rgba(59,130,246,0.65)",
    accentBar:   "#3b82f6",
    leftBg:      "rgba(59,130,246,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(59,130,246,0.35)",
  },
  REZERVACE: {
    gradient:    "linear-gradient(160deg, rgba(102,0,153,0.95) 0%, rgba(77,0,115,0.88) 100%)",
    border:      "rgba(102,0,153,0.65)",
    accentBar:   "#660099",
    leftBg:      "rgba(102,0,153,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(102,0,153,0.35)",
  },
  UDRZBA: {
    gradient:    "linear-gradient(160deg, rgba(34,197,94,0.95) 0%, rgba(22,163,74,0.88) 100%)",
    border:      "rgba(34,197,94,0.65)",
    accentBar:   "#22c55e",
    leftBg:      "rgba(34,197,94,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#ffffff",
    glow:        "rgba(34,197,94,0.32)",
  },
  ZAKAZKA_BEZ_TECHNOLOGIE: {
    gradient:    "linear-gradient(160deg, rgba(6,95,70,0.95) 0%, rgba(4,71,54,0.88) 100%)",
    border:      "rgba(6,95,70,0.65)",
    accentBar:   "#059669",
    leftBg:      "rgba(6,95,70,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(6,95,70,0.32)",
  },
  ZAKAZKA_BEZ_SACKU: {
    gradient:    "linear-gradient(160deg, rgba(227,100,20,0.95) 0%, rgba(190,80,10,0.88) 100%)",
    border:      "rgba(227,100,20,0.65)",
    accentBar:   "#e36414",
    leftBg:      "rgba(227,100,20,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(227,100,20,0.32)",
  },
  ZAKAZKA_POZASTAVENO: {
    gradient:    "linear-gradient(160deg, rgba(208,0,0,0.95) 0%, rgba(176,0,0,0.88) 100%)",
    border:      "rgba(208,0,0,0.65)",
    accentBar:   "#d00000",
    leftBg:      "rgba(208,0,0,0.14)",
    textPrimary: "#ffffff",
    textSub:     "#e5e7eb",
    glow:        "rgba(208,0,0,0.32)",
  },
};

export const BLOCK_OVERDUE: BlockStyle = {
  gradient:    "linear-gradient(160deg, rgba(251,146,60,0.22) 0%, rgba(234,88,12,0.14) 100%)",
  border:      "rgba(251,146,60,0.55)",
  accentBar:   "#f97316",
  leftBg:      "rgba(251,146,60,0.10)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "rgba(251,146,60,0.25)",
};

export const BLOCK_PRINT_DONE: BlockStyle = {
  gradient:    "linear-gradient(160deg, rgba(59,130,246,0.13) 0%, rgba(59,130,246,0.07) 100%)",
  border:      "rgba(59,130,246,0.28)",
  accentBar:   "rgba(59,130,246,0.55)",
  leftBg:      "rgba(59,130,246,0.07)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "rgba(59,130,246,0.10)",
};

/**
 * Barevný klíč bloku: ZAKAZKA s ne-STANDARD variantou má vlastní styl
 * (ZAKAZKA_BEZ_TECHNOLOGIE, …), jinak rozhoduje typ. Param `variant` je záměrně
 * široký string — používá ho i blockShades (ShadeBlockInput.blockVariant).
 */
export function getBlockStyleKey(type: string, variant?: string | null): string {
  if (type === "ZAKAZKA" && variant && variant !== "STANDARD") {
    return `ZAKAZKA_${variant}`;
  }
  return type;
}

/**
 * Zvýraznění specifikace na kartě bloku (SpecBand/SpecChip). Amber je v plánu
 * už zavedená barva „něco si přečti" — tiskařské poznámky i zámkové pásy —
 * takže zvýrazněná specifikace nezavádí do plánu novou barvu.
 */
export const SPEC_HIGHLIGHT = { bg: "#fbbf24", text: "#221703" } as const;

/** Průhledný odstín barvy — sdílený helper pro chipy/overlaye. */
export function tint(color: string, percent: number): string {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}
