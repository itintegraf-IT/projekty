import test from "node:test";
import assert from "node:assert/strict";
import { TISKAR_DAYS_BACK, TISKAR_DAYS_AHEAD, viewDaysBack, viewDaysAhead } from "./tiskarViewRange.js";

test("tiskař vidí v plánu aspoň 5 dní do historie (prosba tiskařů 17. 8. 2026)", () => {
  assert.ok(TISKAR_DAYS_BACK >= 5, `TISKAR_DAYS_BACK je ${TISKAR_DAYS_BACK}, má být aspoň 5`);
});

test("viewDaysBack: tiskaři vnutí jeho rozsah bez ohledu na uloženou preferenci", () => {
  assert.equal(viewDaysBack(true, 1), TISKAR_DAYS_BACK);
  assert.equal(viewDaysBack(true, 30), TISKAR_DAYS_BACK);
});

test("viewDaysBack: ostatní role dostanou svůj vlastní rozsah", () => {
  assert.equal(viewDaysBack(false, 1), 1);
  assert.equal(viewDaysBack(false, 30), 30);
});

test("viewDaysAhead: tiskaři vnutí jeho rozsah bez ohledu na uloženou preferenci", () => {
  assert.equal(viewDaysAhead(true, 2), TISKAR_DAYS_AHEAD);
  assert.equal(viewDaysAhead(true, 60), TISKAR_DAYS_AHEAD);
});

test("viewDaysAhead: ostatní role dostanou svůj vlastní rozsah", () => {
  assert.equal(viewDaysAhead(false, 14), 14);
});

test("dopředný rozsah tiskaře se rozšířením historie nezměnil (zůstává 5)", () => {
  assert.equal(TISKAR_DAYS_AHEAD, 5);
});
