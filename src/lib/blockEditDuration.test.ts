import test from "node:test";
import assert from "node:assert/strict";
import { durationPayload } from "./blockEditDuration.js";

test("nedotčeno + typ beze změny → {} (délka se neposílá)", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: false,
    touched: false,
    durationHours: 4,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, {});
});

test("dotčeno + ZAKAZKA → printMinutes zaokrouhlené na celé minuty", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: false,
    touched: true,
    durationHours: 2.5,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { printMinutes: 150 });
});

test("dotčeno + REZERVACE → endTime dopočítaný ze startTime + durationHours", () => {
  const result = durationPayload({
    type: "REZERVACE",
    typeChanged: false,
    touched: true,
    durationHours: 3,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { endTime: "2026-08-17T09:00:00.000Z" });
});

test("nedotčeno, ale typeChanged → délka se posílá i tak (flip rezervace na zakázku)", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: true,
    touched: false,
    durationHours: 6,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { printMinutes: 360 });
});

test("nedotčeno + typeChanged + UDRZBA → endTime, ne printMinutes", () => {
  const result = durationPayload({
    type: "UDRZBA",
    typeChanged: true,
    touched: false,
    durationHours: 1,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, { endTime: "2026-08-17T07:00:00.000Z" });
});

// Regresní test incidentu 14. 8. 2026 (zakázka 18827): split snížil printMinutes
// na serveru, panel zůstal otevřený se stavovou hodnotou 6 h z okamžiku mountu.
// Uživatel se selectu délky nedotkl — payload nesmí obsahovat printMinutes: 360.
test("regrese 18827: nedotčený select + ZAKAZKA + durationHours=6 → {} (ne printMinutes: 360)", () => {
  const result = durationPayload({
    type: "ZAKAZKA",
    typeChanged: false,
    touched: false,
    durationHours: 6,
    startTime: "2026-08-17T06:00:00.000Z",
  });
  assert.deepEqual(result, {});
  assert.equal("printMinutes" in result, false);
});

test("startTime jako Date instance funguje stejně jako ISO string", () => {
  const result = durationPayload({
    type: "REZERVACE",
    typeChanged: false,
    touched: true,
    durationHours: 1.5,
    startTime: new Date("2026-08-17T06:00:00.000Z"),
  });
  assert.deepEqual(result, { endTime: "2026-08-17T07:30:00.000Z" });
});
