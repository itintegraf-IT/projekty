/**
 * Škály a mapování stavů pro stránku `/reporty`.
 *
 * Obdoba `plannerTypography.ts` pro planner a `uiStyles.ts` pro admin: jeden
 * zdroj pravdy, aby se velikosti nerozjely. Před touhle etapou měl report
 * 12 velikostí písma (od 8 px) a 12 poloměrů.
 *
 * Barvy tu NEJSOU jako hodnoty, jen jako odkazy `var(--…)`. Hodnoty patří do
 * `globals.css`, kde je měří `reportTokens.test.ts`.
 */

/**
 * Stupně písma. Podlaha 10 px — pod ní byly popisky os a čísla v dlaždicích,
 * které se z běžné vzdálenosti nedaly přečíst.
 */
export const reportTypeScale = {
  xs: 10,       // popisky os, legendy, čísla v dlaždicích heatmapy
  sm: 11,       // popisky KPI karet, drobný meta text
  base: 12,     // běžný text, hlavičky sekcí
  md: 13,       // odkazy, položky seznamů, buňky tabulek
  lg: 14,       // název karty kontroly
  hero: 22,     // souhrnné číslo Kontrolního panelu
  display: 26,  // hodnota KPI karty
} as const;

/**
 * Velikost piktogramu v kolečku. NENÍ to stupeň písma — je to rozměr vázaný na
 * průměr kolečka (32 px → 16, 42 px → 20). Kdo mění průměr, mění i tohle.
 */
export const reportGlyph = { sm: 16, lg: 20 } as const;

/** Poloměry. Krok `md` je schválně shodný s `uiStyles.ts`, ať tlačítka sedí. */
export const reportRadius = {
  // 3, ne 4: krok se používá i na čtverečcích legendy 9×9 a 10×10 px, kde je
  // poloměr 4 px skoro polovina strany a ze čtverečku se stane kolečko
  // s useknutými boky. Na dlaždici heatmapy (28 px) je rozdíl neznatelný.
  xs: 3,     // čtverečky legendy, dlaždice heatmapy
  sm: 6,     // chipy, malá tlačítka
  md: 8,     // tlačítka, vstupy
  lg: 10,    // karty
  pill: 999, // odznaky
} as const;

/**
 * Barva tečky u stavu rezervace.
 *
 * Osm stavů se mapuje na stavovou čtveřici PODLE VÝZNAMU, ne na osm vlastních
 * barev. Tečka pak nese skupinu stavu (čeká / běží / vyřízeno / zamítnuto);
 * identitu stavu drží popisek vedle ní, který tam už je.
 */
export function pipelineToneFor(status: string): string {
  switch (status) {
    case "SUBMITTED":
    case "COUNTER_PROPOSED":
      return "var(--status-warn)";   // čeká na zásah člověka
    case "ACCEPTED":
    case "QUEUE_READY":
      return "var(--status-idle)";   // rozpracované, nikdo nečeká
    case "SCHEDULED":
    case "CONFIRMED":
      return "var(--status-ok)";     // úspěšně vyřízené
    case "REJECTED":
      return "var(--status-bad)";   // zamítnuté
    case "WITHDRAWN":
    default:
      return "var(--text-muted)";    // stažené — a záchyt pro devátý stav
  }
}

export type HeatTone = {
  /** Výplň dlaždice. */
  fill: string;
  /** Barva čísla v dlaždici. */
  text: string;
  /** Má dlaždice dostat druhý, nebarevný signál (rámeček)? */
  overbooked: boolean;
};

/**
 * Barva dlaždice heatmapy podle vytížení v procentech.
 *
 * `null` = stroj v ten den nejede. To NENÍ nula: nula znamená „stroj jede a
 * nic na něm není", což je informace o plánu, ne o kalendáři.
 *
 * Pod 50 % je modrošedá, ne červená. Nevytížený den není havárie stejného řádu
 * jako přeplánovaný a dřív je stránka varovala stejně naléhavě — červená měla
 * v legendě dva různé významy.
 *
 * `overbooked` nese rámeček, protože po simulaci deuteranopie je dvojice
 * over/warn na ΔOKLab 0,022 — pro deuteranopa jsou to tytéž barvy. Přeplánování
 * je jediný stav, který znamená „zasáhni hned", takže barva na něj sama nestačí.
 */
export function heatToneFor(pct: number | null): HeatTone {
  if (pct == null) return { fill: "var(--surface-3)", text: "var(--text-muted)", overbooked: false };
  if (pct > 100) return { fill: "var(--status-bad)", text: "var(--status-on)", overbooked: true };
  if (pct === 0) return { fill: "var(--surface-2)", text: "var(--text-muted)", overbooked: false };
  if (pct >= 80) return { fill: "var(--status-ok)", text: "var(--status-on)", overbooked: false };
  if (pct >= 50) return { fill: "var(--status-warn)", text: "var(--status-on)", overbooked: false };
  return { fill: "var(--status-idle)", text: "var(--status-on)", overbooked: false };
}
