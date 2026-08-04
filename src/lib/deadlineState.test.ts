import assert from "node:assert/strict";
import test from "node:test";
import { DEADLINE_HOUR, deadlineState } from "./deadlineState";

// Pomocník: pražský čas → UTC Date (bez závislosti na pragueToUTC, aby test
// neověřoval sám sebe). Léto = UTC+2, zima = UTC+1.
const summer = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 6, day, hour - 2, minute)); // červenec 2026, CEST
const winter = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 0, day, hour - 1, minute)); // leden 2026, CET

test("DEADLINE_HOUR je 14 (termín dodání = 14:00 pražského času)", () => {
  assert.equal(DEADLINE_HOUR, 14);
});

test("bez termínu vrací none, potvrzený termín vrací ok", () => {
  assert.equal(deadlineState(null, false, summer(20, 10)), "none");
  assert.equal(deadlineState("", false, summer(20, 10)), "none");
  // ok má přednost před vším ostatním, i když je termín dávno po
  assert.equal(deadlineState("2026-07-15", true, summer(20, 10)), "ok");
});

test("den termínu: do 14:00 warning, od 14:00 danger", () => {
  const due = "2026-07-20";
  // start tisku až po termínu, aby nezasáhl earlyStart
  const startAfter = summer(21, 6).toISOString();

  assert.equal(deadlineState(due, false, summer(20, 13, 59), startAfter), "warning");
  assert.equal(deadlineState(due, false, summer(20, 14, 0), startAfter), "danger");
  assert.equal(deadlineState(due, false, summer(20, 14, 1), startAfter), "danger");
});

test("před dnem termínu nic nehlásí, další den je danger", () => {
  const due = "2026-07-20";
  const startAfter = summer(21, 6).toISOString();

  assert.equal(deadlineState(due, false, summer(19, 23, 59), startAfter), "none");
  assert.equal(deadlineState(due, false, summer(21, 8), startAfter), "danger");
});

test("earlyStart: tisk začne dřív, než v 14:00 dorazí data", () => {
  const due = "2026-07-20";
  const now = summer(18, 9); // termín teprve přijde

  // start v den termínu v 8:00 — dřív než 14:00 → kolize (dřív se neoznačilo)
  assert.equal(deadlineState(due, false, now, summer(20, 8).toISOString()), "earlyStart");
  // start v den termínu ve 13:59 — pořád před dodáním
  assert.equal(deadlineState(due, false, now, summer(20, 13, 59).toISOString()), "earlyStart");
  // start přesně ve 14:00 — data už jsou, kolize není
  assert.equal(deadlineState(due, false, now, summer(20, 14, 0).toISOString()), "none");
  // start následující den — v pohodě
  assert.equal(deadlineState(due, false, now, summer(21, 6).toISOString()), "none");
  // start den před termínem — kolize
  assert.equal(deadlineState(due, false, now, summer(19, 22).toISOString()), "earlyStart");
});

test("earlyStart má přednost před warning i danger", () => {
  const due = "2026-07-20";
  const earlyStart = summer(20, 8).toISOString();

  // je den termínu odpoledne (samo o sobě danger), ale tisk začal už v 8:00
  assert.equal(deadlineState(due, false, summer(20, 15), earlyStart), "earlyStart");
});

test("funguje i v zimním čase (CET) — hranice zůstává 14:00 v Praze", () => {
  const due = "2026-01-20";
  const startAfter = winter(21, 6).toISOString();

  assert.equal(deadlineState(due, false, winter(20, 13, 59), startAfter), "warning");
  assert.equal(deadlineState(due, false, winter(20, 14, 0), startAfter), "danger");
  // start v den termínu v 8:00 (zimní čas) je pořád před 14:00 → kolize
  assert.equal(deadlineState(due, false, winter(19, 9), winter(20, 8).toISOString()), "earlyStart");
});

test("nevalidní start tisku se ignoruje místo pádu", () => {
  const due = "2026-07-20";
  assert.equal(deadlineState(due, false, summer(20, 13), "nesmysl"), "warning");
  assert.equal(deadlineState(due, false, summer(20, 13), undefined), "warning");
});

test("akceptuje ISO timestamp i civilní datum na vstupu termínu", () => {
  const startAfter = summer(21, 6).toISOString();
  assert.equal(deadlineState("2026-07-20T00:00:00.000Z", false, summer(20, 15), startAfter), "danger");
  assert.equal(deadlineState("2026-07-20", false, summer(20, 15), startAfter), "danger");
});
