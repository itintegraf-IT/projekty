import test from "node:test";
import assert from "node:assert/strict";
import { blockMatchesQuery, type OrderSearchable } from "./orderSearch";

function mkBlock(over: Partial<OrderSearchable> = {}): OrderSearchable {
  return {
    orderNumber: "25-1234",
    description: "Katalog jaro 2026",
    specifikace: "4/4 CMYK, lesklý lak",
    jobPresetLabel: "Brožura V1",
    ...over,
  };
}

test("blockMatchesQuery: najde shodu v čísle zakázky", () => {
  assert.equal(blockMatchesQuery(mkBlock(), "1234"), true);
});

test("blockMatchesQuery: shoda v čísle zakázky nezáleží na velikosti písmen", () => {
  const b = mkBlock({ orderNumber: "IML-A77" });
  assert.equal(blockMatchesQuery(b, "iml-a77"), true);
});

test("blockMatchesQuery: najde shodu v popisu", () => {
  assert.equal(blockMatchesQuery(mkBlock(), "katalog"), true);
});

test("blockMatchesQuery: DOTAZ velkými písmeny najde malý text", () => {
  // Opačný směr než test výš. Bez tohohle by smazání `.toLowerCase()` u DOTAZU
  // (pole se lowercasuje zvlášť) prošlo celou suitou — a plánovač, který píše
  // velkými, by nenašel nic.
  assert.equal(blockMatchesQuery(mkBlock(), "KATALOG"), true);
  assert.equal(blockMatchesQuery(mkBlock(), "Brožura"), true);
});

test("blockMatchesQuery: najde shodu ve specifikaci", () => {
  assert.equal(blockMatchesQuery(mkBlock(), "lesklý"), true);
});

test("blockMatchesQuery: najde shodu v názvu presetu", () => {
  assert.equal(blockMatchesQuery(mkBlock(), "brožura"), true);
});

test("blockMatchesQuery: dotaz bez shody vrátí false", () => {
  assert.equal(blockMatchesQuery(mkBlock(), "9999"), false);
});

test("blockMatchesQuery: prázdná pole (null) nespadnou a nedají shodu", () => {
  const b = mkBlock({ description: null, specifikace: null, jobPresetLabel: null });
  assert.equal(blockMatchesQuery(b, "katalog"), false);
  assert.equal(blockMatchesQuery(b, "1234"), true);
});

test("blockMatchesQuery: prázdný dotaz nefiltruje — projde všechno", () => {
  assert.equal(blockMatchesQuery(mkBlock(), ""), true);
  assert.equal(blockMatchesQuery(mkBlock(), "   "), true);
});

test("blockMatchesQuery: mezery kolem dotazu se ořežou", () => {
  assert.equal(blockMatchesQuery(mkBlock(), "  1234  "), true);
});
