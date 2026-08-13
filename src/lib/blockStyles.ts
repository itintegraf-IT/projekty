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

/**
 * Pozastavená zakázka — pojmenovaná konstanta, ne jen položka v `BLOCK_STYLES`,
 * protože z ní vychází i `BLOCK_OVERDUE_ALARM`. Přes index `BLOCK_STYLES["…"]`ovat
 * by to nešlo bezpečně: mapa je `Record<string, BlockStyle>`, takže překlep nebo
 * přejmenování klíče TypeScript nezachytí a alarm by se tiše vykreslil bez pozadí,
 * rámu i barvy textu.
 */
const ZAKAZKA_POZASTAVENO: BlockStyle = {
  gradient:    "linear-gradient(160deg, rgba(208,0,0,0.95) 0%, rgba(176,0,0,0.88) 100%)",
  border:      "rgba(208,0,0,0.65)",
  accentBar:   "#d00000",
  leftBg:      "rgba(208,0,0,0.14)",
  textPrimary: "#ffffff",
  textSub:     "#e5e7eb",
  glow:        "rgba(208,0,0,0.32)",
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
  ZAKAZKA_POZASTAVENO: ZAKAZKA_POZASTAVENO,
};

/**
 * ZBYTKOVÝ stav zpožděné zakázky — konec je v minulosti déle než OVERDUE_WINDOW_MS
 * a nikdo neodklepl (`overdueAlarmState` → `stale`). Zůstává tlumený: po 16 hodinách
 * už to není akutní věc směny, ale nepořádek v odklepávání.
 *
 * `accentBar` je od 12. 8. 2026 ČERVENÝ a kreslí se v plném krytí. Dřív to byla
 * ztlumená oranžová (opacity 0,4 v BlockCard) a karta pak byla k nerozeznání od
 * hotové — obě vybledlé, obě říkaly „tuhle už neřeš". Levý pruh je jediné místo,
 * kde tenhle stav ještě drží barvu; nezeslabovat.
 */
export const BLOCK_OVERDUE: BlockStyle = {
  gradient:    "linear-gradient(160deg, rgba(251,146,60,0.22) 0%, rgba(234,88,12,0.14) 100%)",
  border:      "rgba(251,146,60,0.55)",
  accentBar:   "#ef4444",
  leftBg:      "rgba(251,146,60,0.10)",
  textPrimary: "var(--text)",
  textSub:     "var(--text-muted)",
  glow:        "rgba(251,146,60,0.25)",
};

/**
 * AKUTNÍ stav zpožděné zakázky (`overdueAlarmState` → `alarm`): konec je v minulosti
 * nejvýš OVERDUE_WINDOW_MS a tiskař neodklepl.
 *
 * Výplň je ZÁMĚRNĚ shodná s pozastavenou zakázkou — rozhodnutí majitele 12. 8. 2026
 * poté, co se první verze (modrá karta + červený rám) ukázala jako nevýrazná.
 * Zdůvodnění: pozastavená zakázka je stav plánu do budoucna, do tisku se nedostane,
 * takže v minulosti prakticky nestojí a záměna nehrozí. Formálně ale nastat MŮŽE
 * (zakázku pozastavíš a blok zůstane na svém starém čase), proto ten spread — kdyby
 * se ty dva stavy měly někdy rozejít, je to jedna vědomá editace tady, ne tichý drift.
 *
 * Alarm je pak o stupeň hlasitější než pozastavená: k téže výplni přidává světlejší
 * červený rám, bílou vlasovou linku zevnitř a širší levý pruh.
 */
export const BLOCK_OVERDUE_ALARM: BlockStyle = { ...ZAKAZKA_POZASTAVENO };

/**
 * Dekorace alarmu nad rámec výplně. `ringInner` je bílá vlasová linka ZEVNITŘ rámu —
 * odděluje červeň rámu od červeně výplně, jinak by rám na kartě zanikl.
 * `icon` je bílá, ne červená: hodinky u čísla zakázky sedí na červené výplni.
 */
export const OVERDUE_ALARM = {
  ring:       "#ff3b30",
  ringWidth:  2,
  ringInner:  "rgba(255,255,255,0.55)",
  bar:        "#ff3b30",
  barWidth:   6,
  icon:       "#ffffff",
} as const;

/**
 * Barva hodinek u ZBYTKOVÉHO zpoždění. Alarm má vlastní (`OVERDUE_ALARM.icon`,
 * bílá na červené výplni); tady jde o oranžovou na tlumené kartě. Bydlí tu proto,
 * že barvy bloků patří do palety, ne do komponenty — `BlockCard` ji měla jako
 * holý hex přímo ve výrazu vedle `OVERDUE_ALARM.icon`.
 */
export const OVERDUE_STALE_ICON = "#f59e0b";

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
