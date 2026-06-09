import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProductionTags, serializeProductionTags, formatProductionTags } from "./productionTags";

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
