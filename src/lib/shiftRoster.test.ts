import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStartFromDate, weekDatesFromStart, isoWeekNumber } from "./shiftRoster";

test("weekStartFromDate — pondělí zůstává", () => {
  const monday = new Date("2026-05-11T00:00:00Z");
  assert.equal(weekStartFromDate(monday).toISOString().slice(0, 10), "2026-05-11");
});

test("weekStartFromDate — středa → vrátí pondělí stejného týdne", () => {
  const wednesday = new Date("2026-05-13T00:00:00Z");
  assert.equal(weekStartFromDate(wednesday).toISOString().slice(0, 10), "2026-05-11");
});

test("weekStartFromDate — neděle → vrátí pondělí minulého týdne", () => {
  const sunday = new Date("2026-05-17T00:00:00Z");
  assert.equal(weekStartFromDate(sunday).toISOString().slice(0, 10), "2026-05-11");
});

test("weekDatesFromStart — vrací 7 dnů od pondělí", () => {
  const monday = new Date("2026-05-11T00:00:00Z");
  const dates = weekDatesFromStart(monday);
  assert.equal(dates.length, 7);
  assert.equal(dates[0].toISOString().slice(0, 10), "2026-05-11");
  assert.equal(dates[6].toISOString().slice(0, 10), "2026-05-17");
});

test("isoWeekNumber — 11. 5. 2026 je 20. ISO týden", () => {
  assert.equal(isoWeekNumber(new Date("2026-05-11T00:00:00Z")), 20);
});
