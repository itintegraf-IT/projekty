import assert from "node:assert/strict";
import test from "node:test";
import {
  hoverTooltipLeft,
  hoverTooltipPlacement,
  hoverTooltipTop,
  TOOLTIP_MARGIN,
  TOOLTIP_OPEN_DELAY_MS,
  TOOLTIP_VERTICAL_GAP,
  TOOLTIP_W,
  type ColumnBox,
} from "./plannerHoverTooltip";

// Skutečná geometrie planneru na 1920px obrazovce se zavřenými panely:
// [datum 44][čas 72][XL 105][čas 72][XL 106]. Sloupce strojů si dělí zbytek,
// tedy (1920 - 44 - 72 - 72) / 2 = 866 px každý.
const VW = 1920;
const XL105_RIGHT = 44 + 72 + 866;   // 982
const XL106_RIGHT = XL105_RIGHT + 72 + 866; // 1920

// ── hoverTooltipLeft / hoverTooltipTop — od 14. 9. 2026 záchranný režim („own") v hoverTooltipPlacement; hlavní pravidlo (nad sousedním strojem) testuje oddíl hoverTooltipPlacement níž ──

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

// ── hoverTooltipPlacement — bublina nad sousedním strojem (14. 9. 2026) ─────
// Mřížka začíná na x = 0: [datum 44][čas 72][XL 105][čas 72][XL 106], vpravo
// panely. Sloupec stroje = (šířka mřížky − 188) / 2 — vzorec z průzkumu
// 14. 9. 2026, sedí na měření Playwrightem ze 17. 8. (1600 px: 116–617 a 689–1190).
function twoMachineGrid(gridWidth: number): ColumnBox[] {
  const c = (gridWidth - 188) / 2;
  const xl105 = { left: 116, right: 116 + c };
  const xl106 = { left: xl105.right + 72, right: xl105.right + 72 + c };
  return [xl105, xl106];
}

const LAYOUTS = [
  { name: "plánovač 1920 px, boční panel 320", vw: 1920, grid: 1920 - 8 - 320 },
  { name: "plánovač 1920 px, panel + notifikace", vw: 1920, grid: 1920 - 8 - 320 - 320 },
  { name: "plánovač 1366 px, boční panel 320", vw: 1366, grid: 1366 - 8 - 320 },
  { name: "plánovač 1366 px, panel + notifikace", vw: 1366, grid: 1366 - 8 - 320 - 320 },
  { name: "pre-press 1920 px, DTP přehled 260", vw: 1920, grid: 1920 - 260 },
  { name: "pre-press 1366 px, DTP přehled 260", vw: 1366, grid: 1366 - 260 },
  { name: "MTZ / čtenář 1920 px, bez panelu", vw: 1920, grid: 1920 },
  { name: "MTZ / čtenář 1366 px, bez panelu", vw: 1366, grid: 1366 },
];

for (const l of LAYOUTS) {
  for (const ownIndex of [0, 1]) {
    const machine = ownIndex === 0 ? "XL 105" : "XL 106";
    test(`${l.name}: bublina u zakázky ${machine} leží nad druhým strojem`, () => {
      const columns = twoMachineGrid(l.grid);
      const own = columns[ownIndex];
      const neighbour = columns[1 - ownIndex];
      const p = hoverTooltipPlacement({
        columns, ownIndex,
        cardRect: { top: 300, bottom: 380, right: own.right - 3 },
        tooltipHeight: 180, viewportWidth: l.vw, viewportHeight: 1080,
      });
      assert.equal(p.mode, "neighbour");
      assert.equal(p.left + TOOLTIP_W, neighbour.right - TOOLTIP_MARGIN, "pravá hrana k pravé hraně souseda");
      assert.ok(p.left >= neighbour.left, "levý kraj souseda (štítky D/M/E/P) zůstává odkrytý");
      assert.ok(p.left >= own.right || p.left + TOOLTIP_W <= own.left, "nezasáhne do vlastního stroje");
      assert.ok(p.left >= TOOLTIP_MARGIN && p.left + TOOLTIP_W <= l.vw - TOOLTIP_MARGIN, "celá v okně");
    });
  }
}

const GRID_1920 = twoMachineGrid(1920 - 8 - 320);

test("nad sousedem začíná bublina ve výšce horní hrany karty", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: 300, bottom: 380, right: 815 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, 300);
});

test("karta u spodního okraje: bublina se zvedne, aby byla celá v okně", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: 1000, bottom: 1060, right: 815 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, 1080 - 180 - TOOLTIP_VERTICAL_GAP);
});

test("karta odrolovaná nad horní okraj: bublina u horního okraje okna", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: -40, bottom: 120, right: 815 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, TOOLTIP_VERTICAL_GAP);
});

test("bublina vyšší než okno: horní okraj vyhrává, žádná záporná souřadnice", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: 300, bottom: 380, right: 815 },
    tooltipHeight: 1300, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, TOOLTIP_VERTICAL_GAP);
});

test("tiskař — jediný sloupec: záchranný režim, bublina pod kartou ve vlastním sloupci", () => {
  const p = hoverTooltipPlacement({
    columns: [{ left: 116, right: 1920 }], ownIndex: 0,
    cardRect: { top: 300, bottom: 380, right: 1917 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.mode, "own");
  assert.equal(p.left, hoverTooltipLeft({ columnRight: 1920, viewportWidth: 1920 }));
  assert.equal(p.top, hoverTooltipTop({ cardTop: 300, cardBottom: 380, tooltipHeight: 180, viewportHeight: 1080 }));
});

test("hák sloupce chybí: záchranný režim od pravé hrany karty + 3 px", () => {
  const p = hoverTooltipPlacement({
    columns: [], ownIndex: -1, cardRect: { top: 300, bottom: 380, right: 800 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.mode, "own");
  assert.equal(p.left, hoverTooltipLeft({ columnRight: 803, viewportWidth: 1920 }));
});

test("ownIndex −1 při neprázdných sloupcích: záchranný režim, žádný pád", () => {
  const columns = twoMachineGrid(1920 - 8 - 320);
  const p = hoverTooltipPlacement({
    columns, ownIndex: -1, cardRect: { top: 300, bottom: 380, right: 800 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.mode, "own");
  assert.equal(p.left, hoverTooltipLeft({ columnRight: 803, viewportWidth: 1920 }));
});

test("úzké okno (1366 px, panel 600 + notifikace): u XL 105 by bublina zasáhla do vlastního stroje → záchranný režim", () => {
  const columns = twoMachineGrid(1366 - 600 - 320 - 8); // sloupce po 125 px
  const p = hoverTooltipPlacement({
    columns, ownIndex: 0, cardRect: { top: 300, bottom: 380, right: columns[0].right - 3 },
    tooltipHeight: 180, viewportWidth: 1366, viewportHeight: 768,
  });
  assert.equal(p.mode, "own");
});

test("totéž úzké okno: u XL 106 se bublina vejde nad XL 105 bez zásahu do vlastního stroje", () => {
  const columns = twoMachineGrid(1366 - 600 - 320 - 8);
  const p = hoverTooltipPlacement({
    columns, ownIndex: 1, cardRect: { top: 300, bottom: 380, right: columns[1].right - 3 },
    tooltipHeight: 180, viewportWidth: 1366, viewportHeight: 768,
  });
  assert.equal(p.mode, "neighbour");
  assert.ok(p.left + TOOLTIP_W <= columns[1].left, "pravá hrana bubliny leží před vlastním sloupcem");
  assert.equal(p.left, TOOLTIP_MARGIN, "sevřeno k levému okraji okna");
});

test("tři stroje: prostřední sloupec bere souseda vpravo", () => {
  const columns = [{ left: 0, right: 400 }, { left: 470, right: 870 }, { left: 940, right: 1340 }];
  const p = hoverTooltipPlacement({
    columns, ownIndex: 1, cardRect: { top: 300, bottom: 380, right: 867 },
    tooltipHeight: 180, viewportWidth: 1400, viewportHeight: 1080,
  });
  assert.equal(p.mode, "neighbour");
  assert.equal(p.left, 1340 - TOOLTIP_MARGIN - TOOLTIP_W);
});

test("prodleva bubliny je 400 ms (volba O2, 14. 9. 2026)", () => {
  assert.equal(TOOLTIP_OPEN_DELAY_MS, 400);
});
