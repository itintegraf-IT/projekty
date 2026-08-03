import test from "node:test";
import assert from "node:assert/strict";
import { printDoneSize, isBlockRunningNow } from "./tiskarBlockView.js";

test("printDoneSize: vysoký blok (≥140 px) = pruh 40 px", () => {
  assert.deepEqual(printDoneSize(168), { variant: "bar", height: 40, fontSize: 16 });
  assert.deepEqual(printDoneSize(140), { variant: "bar", height: 40, fontSize: 16 });
});

test("printDoneSize: 96–139 px = pruh 32 px", () => {
  assert.deepEqual(printDoneSize(139), { variant: "bar", height: 32, fontSize: 14 });
  assert.deepEqual(printDoneSize(96),  { variant: "bar", height: 32, fontSize: 14 });
});

test("printDoneSize: 48–95 px = pruh 24 px (spodní hranice MODE_FULL)", () => {
  assert.deepEqual(printDoneSize(95), { variant: "bar", height: 24, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(48), { variant: "bar", height: 24, fontSize: 11.5 });
});

test("printDoneSize: 14–47 px = čtverec 26 px", () => {
  assert.deepEqual(printDoneSize(47), { variant: "square", height: 26, fontSize: 15 });
  assert.deepEqual(printDoneSize(14), { variant: "square", height: 26, fontSize: 15 });
});

test("printDoneSize: pod 14 px se tlačítko nekreslí", () => {
  assert.equal(printDoneSize(13), null);
  assert.equal(printDoneSize(0), null);
});

test("isBlockRunningNow: čas uvnitř bloku = běží", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");
  assert.equal(isBlockRunningNow("2026-08-03T08:00:00.000Z", "2026-08-03T12:00:00.000Z", now, false), true);
});

test("isBlockRunningNow: přesný start = běží, přesný konec už ne", () => {
  const start = new Date("2026-08-03T08:00:00.000Z");
  const end   = new Date("2026-08-03T12:00:00.000Z");
  assert.equal(isBlockRunningNow(start, end, start, false), true);
  assert.equal(isBlockRunningNow(start, end, end, false), false);
});

test("isBlockRunningNow: před startem a po konci = neběží", () => {
  const s = "2026-08-03T08:00:00.000Z";
  const e = "2026-08-03T12:00:00.000Z";
  assert.equal(isBlockRunningNow(s, e, new Date("2026-08-03T07:59:00.000Z"), false), false);
  assert.equal(isBlockRunningNow(s, e, new Date("2026-08-03T12:01:00.000Z"), false), false);
});

test("isBlockRunningNow: odklepnutý blok neběží, i když je uvnitř svého času", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");
  assert.equal(isBlockRunningNow("2026-08-03T08:00:00.000Z", "2026-08-03T12:00:00.000Z", now, true), false);
});
