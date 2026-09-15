/**
 * Umístění hover bubliny nad kartou bloku v planneru („okno s podrobnostmi").
 *
 * ── Pravidlo (od 14. 9. 2026) ───────────────────────────────────────────────
 * Bublina se staví nad SOUSEDNÍ stroj (vpravo, když existuje, jinak vlevo),
 * pravou hranou k jeho sloupci a ve výšce hovorované karty
 * (`hoverTooltipPlacement`). Stroj zakázky tak zůstane celý vidět — prosba
 * plánovače ze září 2026 „posunout okno s podrobnostmi mimo tiskový stroj, na
 * kterém daná zakázka je zaplánována". Zarovnání k PRAVÉ hraně souseda nechá
 * odkrytý jeho levý kraj se štítky D/M/E/P a čísly zakázek.
 *
 * Záchranný režim = pravidlo z 20. 8. 2026 (vlastní sloupec, pod kartou
 * s flipem; `hoverTooltipLeft` + `hoverTooltipTop`): když soused není (tiskař
 * vidí jeden stroj), když chybí hák sloupce, nebo když by bublina po sevření
 * do okna zasáhla do vlastního stroje (úzké okno s více panely).
 *
 * ── Historie — proč už pátá podoba ─────────────────────────────────────────
 *  1. do 13. 8. 2026: vpravo od karty → u XL 105 zakryla sloupec XL 106.
 *  2. 13. 8.: vnější strana mřížky → vlevo od XL 105 je jen 116 px na
 *     bublinu 250 px, přetékala přes chipy vlastní karty (P28).
 *  3. 17. 8.: pravou hranou k vlastnímu sloupci → ležela na pravé části
 *     vlastní karty.
 *  4. 20. 8. (V5): pod kartu s flipem → zakrývala ~3,5 h navazujícího plánu
 *     téhož stroje.
 *  5. 14. 9. (O1 = A): nad sousední stroj. Vědomý kompromis: dočasně zakryje
 *     pravý kraj karet druhého stroje.
 * Poučení P28 platí dál: umístění „na stranu X" se nesmí zapsat, aniž se
 * spočítá, že na straně X je místo — proto záchranný režim a tabulkové testy.
 */

/** Šířka hover bubliny v px. Jediný zdroj pravdy pro výpočet i pro `style.width`. */
export const TOOLTIP_W = 240;

/** Odstup bubliny od hrany sloupce a od okraje obrazovky v px. */
export const TOOLTIP_MARGIN = 10;

export type HoverTooltipGeometry = {
  /** Pravý okraj sloupce, ke kterému se bublina ukotví (souřadnice viewportu) — vlastní sloupec v záchranném režimu, sousední sloupec v režimu nad sousedem (`hoverTooltipPlacement`). */
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
 *
 * ── Svislá osa ──────────────────────────────────────────────────────────────
 * Svislou polohu tahle funkce neřeší. V záchranném režimu ji počítá samostatná
 * `hoverTooltipTop()` níž v tomto souboru (pod kartu s flipem), v hlavním
 * režimu přímo `hoverTooltipPlacement` (ve výšce karty). Důvod je u obou
 * stejný: testovatelná čistá funkce mimo JSX.
 *
 * Od 14. 9. 2026 ji volá jen `hoverTooltipPlacement`, a to v OBOU režimech:
 * v hlavním (`neighbour`) s pravou hranou sousedního sloupce, v záchranném
 * (`own`) s pravou hranou vlastního sloupce (když hák chybí, s pravou hranou
 * karty + 3 px). Ukotvení i sevření do okna jsou v obou režimech stejné.
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

/**
 * Svislá mezera bubliny od hrany karty (dole i po flipu nahoře) v px.
 * Menší než vodorovné `TOOLTIP_MARGIN` (10) záměrně — kopíruje odstup
 * zavedený u note popoveru (`noteRect.bottom + 6`, `BlockCard.tsx`), ne
 * vodorovnou konvenci této funkce.
 */
export const TOOLTIP_VERTICAL_GAP = 6;

export type HoverTooltipVerticalGeometry = {
  /** Horní hrana hovorované karty (souřadnice viewportu). */
  cardTop: number;
  /** Dolní hrana hovorované karty (souřadnice viewportu). */
  cardBottom: number;
  /** Skutečná (naměřená) výška bubliny v px — obsah je proměnný délkou. */
  tooltipHeight: number;
  /** Výška okna prohlížeče. */
  viewportHeight: number;
  /** Odstup od karty i od okraje obrazovky; výchozí `TOOLTIP_VERTICAL_GAP`. */
  margin?: number;
};

/**
 * Vrátí `top` (v souřadnicích viewportu) pro `position: fixed` bublinu.
 *
 * Tři úrovně v tomto pořadí (rozhodnutí V5, audit druhé vlny 19. 8. 2026,
 * bod 4 — „bublina nezasahuje do bloku"):
 *  1. POD kartou — výchozí, drží prostorovou vazbu na hovorovaný blok.
 *  2. Když se dole nevejde k okraji okna, FLIP nad kartu — vzor už v repu
 *     u note popoveru (`BlockCard.tsx`, `noteRect.bottom + 6`).
 *  3. Když se nevejde ani nahoru (karta vyšší než okno), CLAMP k hornímu
 *     okraji okna — poslední záchrana, nahrazuje dřívější provizorní
 *     `Math.max(8, Math.min(rect.top, vh - 220))`, jen teď se skutečnou
 *     naměřenou výškou místo pevně odhadnutých 220 px.
 *
 * Od 14. 9. 2026 `hoverTooltipTop` řeší jen záchranný režim (`own`) volaný
 * z `hoverTooltipPlacement` — hlavní pravidlo umísťuje bublinu nad sousední
 * stroj.
 *
 * Pořadí je záměrné a nesmí se prohodit, ze stejného důvodu jako u
 * `hoverTooltipLeft`: bublina, která odejde z obrazovky, nenese informaci
 * žádnou — překryv aspoň nějakou.
 */
export function hoverTooltipTop({
  cardTop,
  cardBottom,
  tooltipHeight,
  viewportHeight,
  margin = TOOLTIP_VERTICAL_GAP,
}: HoverTooltipVerticalGeometry): number {
  const below = cardBottom + margin;
  if (below + tooltipHeight <= viewportHeight - margin) {
    return below;
  }
  const above = cardTop - margin - tooltipHeight;
  if (above >= margin) {
    return above;
  }
  // Poslední záchrana: ani nad kartou není místo (obří karta přes celé okno,
  // nebo bublina vyšší než okno). Stejná podlaha/strop logika jako u
  // `hoverTooltipLeft` výš, jen ve svislé ose — podlaha (horní okraj okna)
  // vyhrává, aby se nevrátila souřadnice mimo obrazovku.
  const maxTop = viewportHeight - tooltipHeight - margin;
  return Math.max(margin, Math.min(above, maxTop));
}

/**
 * Prodleva, než bublina vyskočí (ms). Pre-press a MTZ jezdí myší po sloupci
 * a bublina bez prodlevy blikala nad každou kartou (volba O2, 14. 9. 2026).
 * Stejnou hodnotu má náhled poznámky MTZ (`HoverCard` v `BlockCard.tsx`) —
 * obě se napojují sem, ať se nerozejdou.
 */
export const TOOLTIP_OPEN_DELAY_MS = 400;

/** Vodorovný rozsah sloupce stroje (souřadnice viewportu). */
export type ColumnBox = { left: number; right: number };

export type HoverTooltipPlacementInput = {
  /** Sloupce strojů v pořadí zleva doprava (pořadí v DOM), včetně vlastního. */
  columns: ColumnBox[];
  /** Index sloupce, na kterém karta leží; −1, když hák v DOM chybí. */
  ownIndex: number;
  /** Hovorovaná karta (souřadnice viewportu). */
  cardRect: { top: number; bottom: number; right: number };
  /** Skutečná (naměřená) výška bubliny v px. */
  tooltipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Výchozí `TOOLTIP_W`. */
  tooltipWidth?: number;
  /** Vodorovný odstup; výchozí `TOOLTIP_MARGIN`. */
  margin?: number;
  /** Svislý odstup od okraje okna; výchozí `TOOLTIP_VERTICAL_GAP`. */
  verticalMargin?: number;
};

export type HoverTooltipPlacement = {
  left: number;
  top: number;
  /** `neighbour` = nad sousedním strojem; `own` = záchranný režim (pod kartou ve vlastním sloupci). */
  mode: "neighbour" | "own";
};

/**
 * Vrátí polohu `position: fixed` bubliny (pravidlo v hlavičce souboru).
 *
 * Pořadí je záměrné a nesmí se prohodit: bublina musí být CELÁ v okně
 * (`hoverTooltipLeft` sevře polohu do okna), a teprve pak se hlídá zákaz
 * vlastního sloupce — když by ho sevřená bublina protnula, platí záchranný
 * režim. Bublina mimo obrazovku nenese informaci žádnou.
 */
export function hoverTooltipPlacement({
  columns,
  ownIndex,
  cardRect,
  tooltipHeight,
  viewportWidth,
  viewportHeight,
  tooltipWidth = TOOLTIP_W,
  margin = TOOLTIP_MARGIN,
  verticalMargin = TOOLTIP_VERTICAL_GAP,
}: HoverTooltipPlacementInput): HoverTooltipPlacement {
  const own = ownIndex >= 0 ? columns[ownIndex] : undefined;

  // Záchranný režim = pravidlo z 20. 8. 2026. Když hák chybí, pravá hrana karty
  // + 3 px je věrná náhrada pravé hrany sloupce (karta ho vyplňuje s okrajem
  // 3 px: `left: 3` + `calc(100% - 6px)` v `BlockCard.tsx`).
  const ownColumnFallback = (): HoverTooltipPlacement => ({
    mode: "own",
    left: hoverTooltipLeft({
      columnRight: own ? own.right : cardRect.right + 3,
      viewportWidth,
      tooltipWidth,
      margin,
    }),
    top: hoverTooltipTop({
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      tooltipHeight,
      viewportHeight,
      margin: verticalMargin,
    }),
  });

  if (!own) return ownColumnFallback();
  const neighbour = columns[ownIndex + 1] ?? columns[ownIndex - 1];
  if (!neighbour) return ownColumnFallback();

  // Pravá hrana bubliny k pravé hraně souseda — stejné ukotvení i sevření do
  // okna jako u vlastního sloupce, jen k jinému sloupci.
  const left = hoverTooltipLeft({ columnRight: neighbour.right, viewportWidth, tooltipWidth, margin });
  if (left < own.right && left + tooltipWidth > own.left) return ownColumnFallback();

  // Svisle ve výšce karty, sevřeno do okna. Podlaha vyhrává nad stropem, stejně
  // jako u `hoverTooltipTop` — záporná souřadnice by bublinu schovala.
  const maxTop = viewportHeight - tooltipHeight - verticalMargin;
  const top = Math.max(verticalMargin, Math.min(cardRect.top, maxTop));
  return { mode: "neighbour", left, top };
}
