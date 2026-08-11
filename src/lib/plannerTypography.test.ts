import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FONT_SCALE,
  PLANNER_FONT_SCALE_KEYS,
  effectiveSlotHeight,
  isPlannerFontScale,
  plannerTypeScale,
} from "./plannerTypography";

// Dnešní hodnoty zapsané napevno v BlockCard.tsx:512-515 — proti nim se měří neregrese.
const TODAY = { full: 48, compact: 44, tiny: 24, micro: 14 };
// Maximální přiblížení: slotHeight 26 px na 30 minut (ZoomSlider max).
const MAX_ZOOM = 26;

test("stupně jsou M, L, XL a výchozí je M", () => {
  assert.deepEqual([...PLANNER_FONT_SCALE_KEYS], ["M", "L", "XL"]);
  assert.equal(DEFAULT_FONT_SCALE, "M");
});

test("isPlannerFontScale propustí jen platné stupně", () => {
  assert.equal(isPlannerFontScale("XL"), true);
  assert.equal(isPlannerFontScale("S"), false);
  assert.equal(isPlannerFontScale(null), false);
  assert.equal(isPlannerFontScale(1.35), false);
});

test("každá velikost písma roste s vyšším stupněm", () => {
  const m = plannerTypeScale("M");
  const l = plannerTypeScale("L");
  const xl = plannerTypeScale("XL");
  for (const key of ["num", "desc", "chip", "spec", "mini", "badge", "rail", "machineHead"] as const) {
    assert.ok(l[key] > m[key], `${key}: L (${l[key]}) musí být větší než M (${m[key]})`);
    assert.ok(xl[key] > l[key], `${key}: XL (${xl[key]}) musí být větší než L (${l[key]})`);
  }
});

test("prahy hustoty jsou seřazené sestupně", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const t = plannerTypeScale(key).thresholds;
    assert.ok(t.full > t.compact, `${key}: full > compact`);
    assert.ok(t.compact > t.tiny, `${key}: compact > tiny`);
    assert.ok(t.tiny > t.micro, `${key}: tiny > micro`);
  }
});

// ── Strážný test: v XL má hodinový blok rezervu 1 px a půlhodinový přesně 0.
// Kdyby se konstanty výšky řádku posunuly, tenhle test spadne dřív, než to
// uvidí plánovač jako oříznutý text. Při pádu se snižují konstanty v modulu,
// NE prahy ad hoc.
test("při maximálním přiblížení si hodinový blok všude nechá plný layout", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const ts = plannerTypeScale(key);
    const hourPx = effectiveSlotHeight(MAX_ZOOM, ts) * 2; // 2 sloty = 60 minut
    assert.ok(
      hourPx >= ts.thresholds.full,
      `${key}: hodinový blok má ${hourPx} px, práh plného layoutu je ${ts.thresholds.full}`
    );
  }
});

test("při maximálním přiblížení zůstane půlhodinový blok aspoň jednořádkový", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const ts = plannerTypeScale(key);
    const halfPx = effectiveSlotHeight(MAX_ZOOM, ts); // 1 slot = 30 minut
    assert.ok(
      halfPx >= ts.thresholds.tiny,
      `${key}: půlhodinový blok má ${halfPx} px, práh jednořádkového je ${ts.thresholds.tiny}`
    );
  }
});

test("stupeň M nezhorší žádnou délku proti dnešku", () => {
  const t = plannerTypeScale("M").thresholds;
  assert.ok(t.full <= TODAY.full, `full ${t.full} <= ${TODAY.full}`);
  assert.ok(t.compact <= TODAY.compact, `compact ${t.compact} <= ${TODAY.compact}`);
  assert.ok(t.tiny <= TODAY.tiny, `tiny ${t.tiny} <= ${TODAY.tiny}`);
  assert.ok(t.micro <= TODAY.micro, `micro ${t.micro} <= ${TODAY.micro}`);
});

test("stupeň M nemění mřížku, vyšší stupně ji zvětší celočíselně", () => {
  assert.equal(effectiveSlotHeight(MAX_ZOOM, plannerTypeScale("M")), 26);
  assert.equal(effectiveSlotHeight(MAX_ZOOM, plannerTypeScale("L")), 27);
  assert.equal(effectiveSlotHeight(MAX_ZOOM, plannerTypeScale("XL")), 29);
  // Vždy celé číslo — na tom stojí matematika drag & dropu.
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    for (const zoom of [3, 7, 11, 18, 26]) {
      const v = effectiveSlotHeight(zoom, plannerTypeScale(key));
      assert.equal(v, Math.trunc(v), `${key} @ ${zoom}: ${v} není celé číslo`);
      assert.ok(v >= 3, `${key} @ ${zoom}: mřížka nesmí spadnout pod 3 px`);
    }
  }
});

test("výšky řádků pro tiskařský rozpočet rostou se stupněm", () => {
  const m = plannerTypeScale("M").rowHeights;
  const xl = plannerTypeScale("XL").rowHeights;
  assert.ok(xl.header > m.header);
  assert.ok(xl.spec1 > m.spec1);
  assert.ok(xl.spec2 > m.spec2);
  // Rozpočet musí být konzervativní: dnešní napevno zapsané hodnoty jsou
  // dolní hranicí, ne cílem (tiskarBlockView.ts: 23 / 20 / 33).
  assert.ok(m.header >= 23, `header ${m.header} >= 23`);
  assert.ok(m.spec1 >= 20, `spec1 ${m.spec1} >= 20`);
  assert.ok(m.spec2 >= 33, `spec2 ${m.spec2} >= 33`);
});
