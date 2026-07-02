import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductionTags, serializeProductionTags, formatProductionTags, compactTagChip, formatProductionTypeChip } from "./productionTags";

test("parseProductionTags: validní JSON pole vrátí pole stringů", () => {
  assert.deepEqual(parseProductionTags('["1. TA","5. TA"]'), ["1. TA", "5. TA"]);
});

test("parseProductionTags: null/prázdný vstup vrátí []", () => {
  assert.deepEqual(parseProductionTags(null), []);
  assert.deepEqual(parseProductionTags(undefined), []);
  assert.deepEqual(parseProductionTags(""), []);
});

test("parseProductionTags: nevalidní JSON vrátí [] (defenzivní)", () => {
  assert.deepEqual(parseProductionTags("{ rozbity"), []);
  assert.deepEqual(parseProductionTags('"jen string"'), []);
  assert.deepEqual(parseProductionTags("42"), []);
});

test("parseProductionTags: odfiltruje ne-string prvky", () => {
  assert.deepEqual(parseProductionTags('["1. TA",5,null,"3. TA"]'), ["1. TA", "3. TA"]);
});

test("serializeProductionTags: pole → JSON string", () => {
  assert.equal(serializeProductionTags(["1. TA", "5. TA"]), '["1. TA","5. TA"]');
});

test("serializeProductionTags: prázdné pole → null", () => {
  assert.equal(serializeProductionTags([]), null);
  assert.equal(serializeProductionTags(["", "   "]), null);
});

test("serialize→parse round-trip", () => {
  const input = ["1. série", "3. série"];
  assert.deepEqual(parseProductionTags(serializeProductionTags(input)), input);
});

test("formatProductionTags: join čárkou", () => {
  assert.equal(formatProductionTags('["1. TA","5. TA","6. TA"]'), "1. TA, 5. TA, 6. TA");
  assert.equal(formatProductionTags(null), "");
});

test("compactTagChip: sloučí čísla a jednotku uvede jednou", () => {
  assert.equal(compactTagChip('["1. TA","5. TA","6. TA"]'), "1, 5, 6 TA");
  assert.equal(compactTagChip('["1. série"]'), "1 série");
  assert.equal(compactTagChip('["2. série","4. série"]'), "2, 4 série");
});

test("compactTagChip: prázdný vstup → prázdný string", () => {
  assert.equal(compactTagChip(null), "");
  assert.equal(compactTagChip("[]"), "");
});

test("compactTagChip: přejmenované labely (bez tvaru N. …) → prostý výpis", () => {
  assert.equal(compactTagChip('["Arch A","Arch B"]'), "Arch A, Arch B");
});

test("compactTagChip: různé jednotky → prostý výpis (fallback)", () => {
  assert.equal(compactTagChip('["1. TA","2. série"]'), "1. TA, 2. série");
});

test("formatProductionTypeChip: archy + série spojené", () => {
  assert.equal(formatProductionTypeChip('["1. TA","5. TA"]', '["3. série"]'), "1, 5 TA · 3 série");
});

test("formatProductionTypeChip: jen archy / jen série / nic", () => {
  assert.equal(formatProductionTypeChip('["1. TA"]', null), "1 TA");
  assert.equal(formatProductionTypeChip(null, '["3. série"]'), "3 série");
  assert.equal(formatProductionTypeChip(null, null), "");
});
