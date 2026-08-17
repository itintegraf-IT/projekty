/**
 * Vodorovné umístění hover bubliny nad kartou bloku v planneru.
 *
 * ── Pravidlo ────────────────────────────────────────────────────────────────
 * Bublina se zarovná PRAVOU hranou ke sloupci stroje, na kterém hovorovaný blok
 * leží. Plyne z toho obojí naráz:
 *
 *  - nikdy nepřepadne do sloupce SOUSEDNÍHO stroje (bublina napravo od bloku
 *    v XL 105 zakrývala celý sloupec XL 106 — připomínka tiskařů 13. 8. 2026),
 *  - nikdy nezakryje LEVOU hranu vlastní karty, kde sedí chipy D/M/E/P, číslo
 *    zakázky a popis — tedy přesně to, co pre-press a MTZ potřebují vidět
 *    a odklepnout (připomínka plánovače 17. 8. 2026).
 *
 * Oba stroje se tím chovají doslova stejně, jen posunuté o šířku sloupce.
 *
 * ── Proč to nahradilo „vnější stranu mřížky" ────────────────────────────────
 * Do 17. 8. 2026 platilo pravidlo „bublina jde vždy na vnější stranu mřížky"
 * s odůvodněním, že vlevo od levého sloupce je jen časová osa, kde překryv
 * nikoho nestojí informaci. To odůvodnění bylo NEPRAVDIVÉ: vlevo od sloupce
 * XL 105 je `DATE_COL_W` + `TIME_COL_W` = 116 px, zatímco bublina potřebuje
 * `TOOLTIP_W` + `TOOLTIP_MARGIN` = 250 px. Nevešla se tam ani jednou —
 * pojistka proti odchodu z obrazovky ji pokaždé přiskřípla k levému okraji
 * okna a zbylých ~134 px přeteklo přes levou hranu karty, tedy přes chipy.
 * (Poučení: pravidlo „umísti prvek na stranu X" se nesmí zapsat, aniž se
 * ověří, že na straně X je pro ten prvek fyzicky místo — `docs/POUCENI.md`.)
 *
 * ── Co pravidlo NEŘEŠÍ ──────────────────────────────────────────────────────
 * Když je sloupec stroje užší než bublina i s odstupy (zhruba pod 260 px —
 * otevřený editační, notifikační i DTP panel naráz na malé obrazovce), bublina
 * se do sloupce nevejde a přeteče přes jeho levou hranu. Překryv v takovém
 * stavu nastane tak jako tak; funkce drží jen to, že bublina nikdy neopustí
 * obrazovku. Kdyby se to v provozu ukázalo jako problém, řešením je zúžit
 * bublinu podle sloupce, ne měnit stranu.
 */

/** Šířka hover bubliny v px. Jediný zdroj pravdy pro výpočet i pro `style.width`. */
export const TOOLTIP_W = 240;

/** Odstup bubliny od hrany sloupce a od okraje obrazovky v px. */
export const TOOLTIP_MARGIN = 10;

export type HoverTooltipGeometry = {
  /** Pravý okraj sloupce stroje, na kterém blok leží (souřadnice viewportu). */
  columnRight: number;
  /** Šířka okna prohlížeče. */
  viewportWidth: number;
  /** Šířka bubliny; výchozí `TOOLTIP_W`. */
  tooltipWidth?: number;
  /** Odstup od hran; výchozí `TOOLTIP_MARGIN`. */
  margin?: number;
};

/**
 * Vrátí `left` (v souřadnicích viewportu) pro `position: fixed` bublinu.
 *
 * Pořadí pravidel je záměrné a nesmí se prohodit: ukotvení ke sloupci ustoupí
 * pravému okraji obrazovky a oboje ustoupí levému. Bublina, která odejde
 * z obrazovky, nenese informaci žádnou — překryv aspoň nějakou.
 */
export function hoverTooltipLeft({
  columnRight,
  viewportWidth,
  tooltipWidth = TOOLTIP_W,
  margin = TOOLTIP_MARGIN,
}: HoverTooltipGeometry): number {
  // Ukotvení: pravá hrana bubliny = pravá hrana sloupce, mínus odstup.
  const anchored = columnRight - margin - tooltipWidth;
  // Strop: bublina nesmí vyčnívat vpravo z obrazovky. Není to mrtvá větev —
  // sloupec může končit až za okrajem okna (užší okno než mřížka, zoom).
  const maxLeft = viewportWidth - tooltipWidth - margin;
  // Podlaha: ani vlevo. Vyhrává nad stropem, protože v okně užším než bublina
  // by se jinak vrátila záporná hodnota a bublina by začínala mimo obrazovku.
  return Math.max(margin, Math.min(anchored, maxLeft));
}
