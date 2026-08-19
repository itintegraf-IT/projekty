import assert from "node:assert/strict";
import test from "node:test";
import {
  hoverTooltipLeft,
  hoverTooltipTop,
  TOOLTIP_MARGIN,
  TOOLTIP_VERTICAL_GAP,
  TOOLTIP_W,
} from "./plannerHoverTooltip";

// Skutečná geometrie planneru na 1920px obrazovce se zavřenými panely:
// [datum 44][čas 72][XL 105][čas 72][XL 106]. Sloupce strojů si dělí zbytek,
// tedy (1920 - 44 - 72 - 72) / 2 = 866 px každý.
const VW = 1920;
const XL105_RIGHT = 44 + 72 + 866;   // 982
const XL106_RIGHT = XL105_RIGHT + 72 + 866; // 1920

test("bublina se zarovná pravou hranou ke sloupci vlastního stroje", () => {
  assert.equal(
    hoverTooltipLeft({ columnRight: XL105_RIGHT, viewportWidth: VW }),
    XL105_RIGHT - TOOLTIP_MARGIN - TOOLTIP_W,
  );
});

test("oba stroje se chovají identicky — rozdíl je přesně posun sloupce", () => {
  const left105 = hoverTooltipLeft({ columnRight: XL105_RIGHT, viewportWidth: VW });
  const left106 = hoverTooltipLeft({ columnRight: XL106_RIGHT, viewportWidth: VW });
  assert.equal(left106 - left105, XL106_RIGHT - XL105_RIGHT);
});

test("bublina u XL 105 nezasáhne do sloupce XL 106", () => {
  const left = hoverTooltipLeft({ columnRight: XL105_RIGHT, viewportWidth: VW });
  // Pravá hrana bubliny musí zůstat vlevo od konce vlastního sloupce; mezi
  // sloupci navíc leží 72px časová osa, takže rezerva je ještě větší.
  assert.ok(left + TOOLTIP_W <= XL105_RIGHT, `${left + TOOLTIP_W} > ${XL105_RIGHT}`);
});

test("bublina nezakryje levou hranu karty, dokud je sloupec dost široký", () => {
  // Levá hrana sloupce XL 105 = 116 px. Chipy D/M/E/P začínají hned za ní.
  const columnLeft = 44 + 72;
  const left = hoverTooltipLeft({ columnRight: XL105_RIGHT, viewportWidth: VW });
  assert.ok(left > columnLeft, `bublina začíná na ${left}, sloupec na ${columnLeft}`);
});

test("regrese 17. 8. 2026: bublina se u levého sloupce už nelepí k levému okraji okna", () => {
  // Staré pravidlo dávalo `Math.max(margin, rect.left - margin - TOOLTIP_W)`,
  // tedy 10 — a přeteklo přes chipy. Nová hodnota s ním nesmí splynout.
  const left = hoverTooltipLeft({ columnRight: XL105_RIGHT, viewportWidth: VW });
  assert.notEqual(left, TOOLTIP_MARGIN);
});

test("bublina nikdy nevyčnívá vpravo z obrazovky", () => {
  // Sloupec končící až za okrajem okna (užší okno než mřížka).
  const left = hoverTooltipLeft({ columnRight: 2400, viewportWidth: VW });
  assert.equal(left, VW - TOOLTIP_W - TOOLTIP_MARGIN);
});

test("bublina nikdy nezačíná vlevo od okraje obrazovky", () => {
  // Degenerovaný stav: velmi úzký sloupec u levého okraje. Překryv nastane,
  // ale bublina musí zůstat vidět celá.
  assert.equal(hoverTooltipLeft({ columnRight: 150, viewportWidth: VW }), TOOLTIP_MARGIN);
  // Okno užší než sama bublina — podlaha vyhrává nad stropem.
  assert.equal(hoverTooltipLeft({ columnRight: 200, viewportWidth: 200 }), TOOLTIP_MARGIN);
});

test("úzký sloupec: bublina přeteče přes levou hranu sloupce, ne mimo obrazovku", () => {
  // Otevřené panely na malé obrazovce → sloupec 180 px (pod 260 px prahem).
  const columnLeft = 400;
  const columnRight = columnLeft + 180;
  const left = hoverTooltipLeft({ columnRight, viewportWidth: 1280 });
  assert.ok(left < columnLeft, "v úzkém sloupci se překryvu vyhnout nelze");
  assert.ok(left >= TOOLTIP_MARGIN);
  assert.equal(left + TOOLTIP_W, columnRight - TOOLTIP_MARGIN);
});

// ── hoverTooltipTop — svislé umístění (rozhodnutí V5, 19. 8. 2026) ─────────
// Bublina má obsahově proměnnou výšku (popis, specifikace, termíny, tiskařské
// poznámky), takže testy pracují s výškou jako s parametrem, ne s konkrétním
// obsahem — přesně jako hoverTooltipLeft pracuje se šířkou sloupce.
const VH = 1080;

test("bublina se umístí pod kartu, když se tam vejde", () => {
  const top = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH });
  assert.equal(top, 260 + TOOLTIP_VERTICAL_GAP);
});

test("hraniční případ: bublina se PŘESNĚ vejde dole u okraje okna → zůstává pod kartou", () => {
  // below + tooltipHeight musí přesně dosednout na (viewportHeight - margin).
  const tooltipHeight = 100;
  const cardBottom = VH - TOOLTIP_VERTICAL_GAP - tooltipHeight - TOOLTIP_VERTICAL_GAP; // 968
  const top = hoverTooltipTop({ cardTop: cardBottom - 60, cardBottom, tooltipHeight, viewportHeight: VH });
  assert.equal(top, cardBottom + TOOLTIP_VERTICAL_GAP, "rovnost vyhrává below větev, ne flip");
});

test("bublina se nevejde dole u spodního okraje okna → flipne nad kartu", () => {
  const top = hoverTooltipTop({ cardTop: 900, cardBottom: 960, tooltipHeight: 150, viewportHeight: VH });
  assert.equal(top, 900 - TOOLTIP_VERTICAL_GAP - 150);
});

test("po flipu bublina dosedne přesně na horní hranu karty mínus mezera (žádný extra posun)", () => {
  const cardTop = 900;
  const tooltipHeight = 150;
  const top = hoverTooltipTop({ cardTop, cardBottom: 960, tooltipHeight, viewportHeight: VH });
  assert.equal(top + tooltipHeight + TOOLTIP_VERTICAL_GAP, cardTop);
});

test("obří karta přes celé okno: nevejde se ani nahoru → clamp k hornímu okraji okna", () => {
  const top = hoverTooltipTop({ cardTop: -50, cardBottom: 1200, tooltipHeight: 150, viewportHeight: VH });
  assert.equal(top, TOOLTIP_VERTICAL_GAP, "poslední záchrana: horní okraj okna, ne záporná souřadnice");
});

test("bublina vyšší než celé okno: last-resort clamp pořád vrátí platnou souřadnici", () => {
  const top = hoverTooltipTop({ cardTop: 0, cardBottom: VH, tooltipHeight: VH + 500, viewportHeight: VH });
  assert.equal(top, TOOLTIP_VERTICAL_GAP);
});

test("vlastní margin parametr se respektuje místo výchozí TOOLTIP_VERTICAL_GAP", () => {
  const top = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH, margin: 20 });
  assert.equal(top, 260 + 20);
});

test("výchozí margin je TOOLTIP_VERTICAL_GAP, ne vodorovné TOOLTIP_MARGIN (jiná konvence, notepopover vzor)", () => {
  assert.notEqual(TOOLTIP_VERTICAL_GAP, TOOLTIP_MARGIN);
  const withDefault = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH });
  const withExplicit = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH, margin: TOOLTIP_VERTICAL_GAP });
  assert.equal(withDefault, withExplicit);
});
