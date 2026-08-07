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

test("pole (tiskoveArchy) se porovnává podle obsahu", () => {
  assert.equal(computeRevisionDiff({ tiskoveArchy: "[\"A\",\"B\"]" }, { tiskoveArchy: "[\"A\",\"B\"]" }), null);
  assert.ok(computeRevisionDiff({ tiskoveArchy: "[\"A\"]" }, { tiskoveArchy: "[\"A\",\"B\"]" }));
});
