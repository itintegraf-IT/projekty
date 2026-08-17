import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { shouldMarkDrift } from "./monitorDriftMark";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";

const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const NOW = pragueToUTC("2026-08-01", 0); // dávno před fixturami níže → "endTime > now" splněno všude

test("shouldMarkDrift: blok sedící na kalendář → false", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106", printMinutes: 240,
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
  };
  assert.equal(shouldMarkDrift(b, SHIFTS, [], NOW), false);
});

test("shouldMarkDrift: uložený konec nesedí na přepočet → true", () => {
  // Táž fixtura jako blockCalendarDrift END_MISMATCH test v printTimeClient.test.ts:
  // uložený end (25.8. 0:00) neodpovídá přepočtu (24.8. 13:00).
  const b = {
    type: "ZAKAZKA", machine: "XL_106", printMinutes: 240,
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0),
  };
  assert.equal(shouldMarkDrift(b, SHIFTS, [], NOW), true);
});

test("shouldMarkDrift: vědomě odložený blok (scheduleBypassed) → false", () => {
  // Stejná geometrie jako END_MISMATCH výš, ale se `scheduleBypassed` — plánovač
  // ho tam vědomě dal. blockCalendarDrift vrátí PARKED/STALE_BYPASS, ne poruchový
  // důvod, a shouldMarkDrift ho musí vyloučit přes isParkedDrift — odložení
  // není porucha, kterou má tiskař vidět.
  const b = {
    type: "ZAKAZKA", machine: "XL_106", printMinutes: 240, scheduleBypassed: true,
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0),
  };
  assert.equal(shouldMarkDrift(b, SHIFTS, [], NOW), false);
});
