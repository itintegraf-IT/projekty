import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeHealth } from "./healthSummary";

test("souhrn: samé nuly → čisto", () => {
  const s = summarizeHealth([{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }]);
  assert.deepEqual(s, { total: 0, badChecks: 0, uncomputed: 0 });
});

test("souhrn: sečte nálezy a spočítá kontroly s nálezem", () => {
  const s = summarizeHealth([{ count: 2 }, { count: 0 }, { count: 5 }, { count: 0 }, { count: 0 }]);
  assert.deepEqual(s, { total: 7, badChecks: 2, uncomputed: 0 });
});

test("souhrn: nespočtená kontrola se NEpočítá jako v pořádku", () => {
  const s = summarizeHealth([{ count: null, error: "Unknown column" }, { count: 3 }, { count: 0 }, { count: 0 }, { count: 0 }]);
  assert.equal(s.total, 3);
  assert.equal(s.badChecks, 1);
  assert.equal(s.uncomputed, 1);
});

test("souhrn: spočtená kontrola s dílčí chybou se počítá jako nespočtená", () => {
  const s = summarizeHealth([{ count: 4, error: "Dílčí kontrola nespočtena." }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }]);
  assert.equal(s.total, 4);
  assert.equal(s.badChecks, 1);
  assert.equal(s.uncomputed, 1);
});
