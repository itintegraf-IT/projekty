import test from "node:test";
import assert from "node:assert/strict";
import { isOverdueUnacknowledged } from "./overdueState";

const NOW = new Date("2026-08-12T12:00:00.000Z");

/** Konec bloku `h` hodin PŘED NOW. */
function endHoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

test("konec v budoucnu → false", () => {
  assert.equal(isOverdueUnacknowledged(endHoursAgo(-2), null, NOW), false);
});

test("konec přesně teď → false (blok v tu milisekundu ještě běží)", () => {
  assert.equal(isOverdueUnacknowledged(NOW.toISOString(), null, NOW), false);
});

test("odklepnutá zakázka → false, i když je konec dávno v minulosti", () => {
  assert.equal(isOverdueUnacknowledged(endHoursAgo(100), "2026-08-08T10:00:00.000Z", NOW), false);
});

test("konec před hodinou, neodklepnuto → true", () => {
  assert.equal(isOverdueUnacknowledged(endHoursAgo(1), null, NOW), true);
});

test("konec před 72 h, neodklepnuto → true (zrušení dvoustupňovosti — dřív by to bylo `stale`, ne alarm)", () => {
  assert.equal(isOverdueUnacknowledged(endHoursAgo(72), null, NOW), true);
});

test("noční směna 22:00–6:00 je v poledne pořád overdue", () => {
  // Regrese proti počítání od dne startu: blok začal VČERA, takže „nezačal dnes",
  // ale skončil dnes v 6:00 — tedy před 6 hodinami.
  assert.equal(isOverdueUnacknowledged("2026-08-12T06:00:00.000Z", null, NOW), true);
});

test("Date na vstupu se chová stejně jako ISO string", () => {
  const end = new Date(NOW.getTime() - 60 * 60 * 1000);
  assert.equal(isOverdueUnacknowledged(end, null, NOW), true);
  assert.equal(isOverdueUnacknowledged(end.toISOString(), null, NOW), true);
});

test("nečitelné datum → false, nikdy true", () => {
  assert.equal(isOverdueUnacknowledged("", null, NOW), false);
  assert.equal(isOverdueUnacknowledged("není datum", null, NOW), false);
});
