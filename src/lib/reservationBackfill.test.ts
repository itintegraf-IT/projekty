import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { classifyReservationRow } from "./reservationBackfill";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";

const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];
const row = (over: Partial<Parameters<typeof classifyReservationRow>[0]>) => ({
  id: 1, machine: "XL_106", startTime: pragueToUTC("2026-08-21", 10),
  endTime: pragueToUTC("2026-08-21", 12), printMinutes: null, ...over,
});

test("backfill: printMinutes už vyplněné → SKIP_HAS_PM (idempotence)", () => {
  assert.deepEqual(classifyReservationRow(row({ printMinutes: 120 }), SHIFTS, []), { kind: "SKIP_HAS_PM" });
});

test("backfill: nezarovnaný start → SKIP_UNALIGNED (zůstává legacy-rigidní)", () => {
  const r = row({ startTime: new Date(pragueToUTC("2026-08-21", 10).getTime() + 10 * 60000) });
  assert.deepEqual(classifyReservationRow(r, SHIFTS, []), { kind: "SKIP_UNALIGNED" });
});

test("backfill: nezarovnaný end → SKIP_UNALIGNED (computePrintMinutes vyžaduje OBĚ hranice)", () => {
  const r = row({ endTime: new Date(pragueToUTC("2026-08-21", 12).getTime() + 10 * 60000) });
  assert.deepEqual(classifyReservationRow(r, SHIFTS, []), { kind: "SKIP_UNALIGNED" });
});

test("backfill: rezervace celá v pracovní době → CONFORMS s pm = elapsed", () => {
  assert.deepEqual(classifyReservationRow(row({}), SHIFTS, []), { kind: "CONFORMS", printMinutes: 120 });
});

test("backfill: rezervace přesahující do odstávky → MISMATCH (scheduleBypassed=true)", () => {
  // Pá 20:00 – So 02:00; páteční provoz končí 22:00 → pm = 120, expanze z Pá 20:00
  // skončí Pá 22:00 ≠ uložený end So 02:00.
  const r = row({ startTime: pragueToUTC("2026-08-21", 20), endTime: pragueToUTC("2026-08-22", 2) });
  const c = classifyReservationRow(r, SHIFTS, []);
  assert.equal(c.kind, "MISMATCH");
  if (c.kind !== "MISMATCH") return;
  assert.equal(c.printMinutes, 120);
  assert.deepEqual(c.expandedEnd, pragueToUTC("2026-08-21", 22));
});

test("backfill: rezervace celá mimo provoz → SKIP_NO_MINUTES (inverze dá 0)", () => {
  const r = row({ startTime: pragueToUTC("2026-08-22", 10), endTime: pragueToUTC("2026-08-22", 12) });
  assert.deepEqual(classifyReservationRow(r, SHIFTS, []), { kind: "SKIP_NO_MINUTES" });
});

test("backfill: apply-idempotence — po simulovaném zápisu je druhý průchod SKIP_HAS_PM a writes prázdné", () => {
  // Mirror výběru `writes` ve skriptu: jen CONFORMS/MISMATCH se zapisují.
  const selectWrites = (rs: Parameters<typeof classifyReservationRow>[0][]) =>
    rs
      .map((r) => classifyReservationRow(r, SHIFTS, []))
      .filter((c) => c.kind === "CONFORMS" || c.kind === "MISMATCH");

  // První průchod: čerstvý řádek (printMinutes null) → CONFORMS, jde do writes.
  const fresh = row({});
  const first = classifyReservationRow(fresh, SHIFTS, []);
  assert.equal(first.kind, "CONFORMS");
  assert.deepEqual(selectWrites([fresh]), [{ kind: "CONFORMS", printMinutes: 120 }]);

  // Simulace stavu PO --apply: řádek má printMinutes vyplněné (přesně to, co
  // skript zapsal). Druhý běh nad týmž řádkem musí být idempotentní —
  // SKIP_HAS_PM, ne opětovné CONFORMS, a writes prázdné (nic se nepřepisuje).
  const afterApply = { ...fresh, printMinutes: (first as { printMinutes: number }).printMinutes };
  assert.deepEqual(classifyReservationRow(afterApply, SHIFTS, []), { kind: "SKIP_HAS_PM" });
  assert.deepEqual(selectWrites([afterApply]), []);
});
