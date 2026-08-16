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
 * Odsazení. Odloženo z R2, protože sjednocovat padding před přeskládáním by
 * znamenalo sáhnout na každý řádek dvakrát. Před R3 bylo v /reporty
 * 19 různých hodnot.
 *
 * Hodnoty se na kroky převádějí ZAOKROUHLENÍM NA NEJBLIŽŠÍ, shoda uprostřed
 * (6, 10, 14) padá na nižší krok — u těsných vnitřků chipů a odznaků je
 * zvětšení vidět víc než zmenšení. Co na krok nesedí ani přibližně, se skládá
 * ze dvou kroků (odsazení 29 px pod ikonou → `xl + xs`).
 */
export const reportSpace = {
  xs: 4,   // těsné vnitřky chipů
  sm: 8,   // řádky seznamu
  md: 12,  // vnitřek panelu
  lg: 16,  // vnitřek karty
  xl: 24,  // mezera mezi sekcemi
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
  /**
   * Čárkovaný obrys pro „stroj nejede".
   *
   * `--surface-3` (nejede) a `--surface-2` (nula) mají vzájemný kontrast
   * 1,13 : 1 a obě dlaždice se kreslí prázdné, takže je pouhým okem nešlo
   * rozeznat — přitom legenda je vypisuje jako dva stavy a celý smysl toho
   * rozdílu je, že „stroj nejede" NENÍ nula. Obrys ten rozdíl nese tvarem,
   * ne odstínem. Vrací ho `heatToneFor`, aby si ho mřížka a legenda nemohly
   * vyložit každá jinak.
   */
  dashed: boolean;
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
 * **Barva NENÍ nositelem hodnoty — číslo v dlaždici ano.** Škála červená ·
 * jantarová · zelená je pro dichromata z principu nerozlišitelná; přeměřeno
 * správnou simulací (Viénot–Brettel) jsou nejtěsnější dvojice ve světlém režimu
 * `bad`/`warn` ΔOKLab 0,004, `bad`/`ok` 0,059 a `ok`/`warn` 0,059, tedy hluboko
 * pod prahem 0,12, který si etapa uložila u sérií grafu. Nejde to spravit
 * volbou odstínů — jde to spravit jedině opuštěním semaforové škály, což by
 * ale zahodilo okamžitě čitelné „zelená = dobře". Proto se každá barevná
 * dlaždice vykresluje s číslem: informaci nese ono, barva jen urychluje hledání
 * (WCAG 1.4.1 tím je splněné, barva není jediný prostředek).
 *
 * `overbooked` přesto dostává rámeček navíc: přeplánování je jediný stav, který
 * znamená „zasáhni hned", a u toho se nespoléháme ani na to, že si člověk čísla
 * přečte. Rámeček kreslí `--status-on`, ne `--text` — na vlastní výplni dá
 * 6,67 : 1 místo 2,71 : 1, tedy nad prahem 3 : 1 pro netextový obsah.
 *
 * Dřívější znění tohohle komentáře uvádělo pro `bad`/`warn` hodnotu 0,022 a
 * `ok`/`warn` označovalo za bezpečné. Obojí bylo spočítané rozbitou simulací
 * (nesourodý pár LMS matic, opraveno 16. 8. 2026) — viz `contrast.ts`.
 */
export function heatToneFor(pct: number | null): HeatTone {
  const plain = { text: "var(--text-muted)", overbooked: false, dashed: false };
  const filled = { text: "var(--status-on)", overbooked: false, dashed: false };
  // `pct == null` chytá i `undefined`; NaN propadne až na poslední řádek, kde
  // dostane `--status-idle` — dlaždice se pak vykreslí barevně, ale bez čísla
  // (render píše hodnotu jen pro `pct > 0`). Ve zdroji dat NaN vzniknout nemůže,
  // API vrací číslo nebo `null`; kdyby začalo, projeví se to prázdnou modrošedou
  // dlaždicí, ne pádem.
  if (pct == null) return { ...plain, fill: "var(--surface-3)", dashed: true };
  if (pct > 100) return { ...filled, fill: "var(--status-bad)", overbooked: true };
  if (pct === 0) return { ...plain, fill: "var(--surface-2)" };
  if (pct >= 80) return { ...filled, fill: "var(--status-ok)" };
  if (pct >= 50) return { ...filled, fill: "var(--status-warn)" };
  return { ...filled, fill: "var(--status-idle)" };
}
