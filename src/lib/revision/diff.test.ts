import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRevisionDiff } from "./diff";

test("žádná věcná změna → null", () => {
  const row = { id: 1, machine: "XL_105", locked: false, updatedAt: new Date("2026-09-01T10:00:00Z") };
  const after = { ...row, updatedAt: new Date("2026-09-01T11:00:00Z") };
  assert.equal(computeRevisionDiff(row, after), null);
});

test("updatedAt sám o sobě rozdíl netvoří", () => {
  const before = { updatedAt: new Date("2026-09-01T10:00:00Z") };
  const after = { updatedAt: new Date("2026-09-01T11:00:00Z") };
  assert.equal(computeRevisionDiff(before, after), null);
});

test("změna tří sloupců → právě tři sloupce v obou půlkách", () => {
  const before = { machine: "XL_105", startTime: new Date("2026-09-03T06:00:00Z"), printMinutes: 480, locked: false, updatedAt: new Date("2026-09-01T10:00:00Z") };
  const after = { machine: "XL_106", startTime: new Date("2026-09-04T06:00:00Z"), printMinutes: 600, locked: false, updatedAt: new Date("2026-09-01T11:00:00Z") };
  const d = computeRevisionDiff(before, after);
  assert.ok(d);
  assert.deepEqual(Object.keys(d.before).sort(), ["machine", "printMinutes", "startTime"]);
  assert.deepEqual(Object.keys(d.after).sort(), ["machine", "printMinutes", "startTime"]);
  assert.equal(d.before.machine, "XL_105");
  assert.equal(d.after.machine, "XL_106");
});

test("Date se porovnává podle času, ne podle reference", () => {
  const before = { startTime: new Date("2026-09-03T06:00:00Z") };
  const after = { startTime: new Date("2026-09-03T06:00:00Z") };
  assert.equal(computeRevisionDiff(before, after), null);
});

test("null → hodnota se počítá jako změna", () => {
  const d = computeRevisionDiff({ deadlineExpedice: null }, { deadlineExpedice: new Date("2026-09-10T00:00:00Z") });
  assert.ok(d);
  assert.equal(d.before.deadlineExpedice, null);
});

test("hodnota → null se počítá jako změna", () => {
  const d = computeRevisionDiff({ materialNote: "čeká" }, { materialNote: null });
  assert.ok(d);
  assert.equal(d.after.materialNote, null);
});

test("pole (tiskoveArchy) se porovnává jako serializovaný řetězec, ne jako množina", () => {
  assert.equal(computeRevisionDiff({ tiskoveArchy: "[\"A\",\"B\"]" }, { tiskoveArchy: "[\"A\",\"B\"]" }), null);
  assert.ok(computeRevisionDiff({ tiskoveArchy: "[\"A\"]" }, { tiskoveArchy: "[\"A\",\"B\"]" }));
});

test("tiskoveArchy: přeuspořádání stejné množiny (\"A\",\"B\" → \"B\",\"A\") se počítá jako změna", () => {
  // Záměrně NE sémantické porovnání množiny: serializeProductionTags (productionTags.ts)
  // pole netřídí a UI (compactTagChip/formatProductionTags) ho vykresluje přesně v tomhle
  // pořadí — pořadí archů je tedy pro plánovače viditelný stav na kartě, ne šum. Kdyby se
  // tahle změna do historie nezapsala, historie by zamlčela to, co uživatel vidí na bloku.
  const d = computeRevisionDiff({ tiskoveArchy: "[\"A\",\"B\"]" }, { tiskoveArchy: "[\"B\",\"A\"]" });
  assert.ok(d);
  assert.equal(d.before.tiskoveArchy, "[\"A\",\"B\"]");
  assert.equal(d.after.tiskoveArchy, "[\"B\",\"A\"]");
});

test("before je null → null (nespadne)", () => {
  assert.equal(computeRevisionDiff(null, { machine: "XL_105" }), null);
});

test("after je undefined → null (nespadne)", () => {
  assert.equal(computeRevisionDiff({ machine: "XL_105" }, undefined), null);
});

test("before i after null/undefined zároveň → null (nespadne)", () => {
  assert.equal(computeRevisionDiff(null, undefined), null);
});
