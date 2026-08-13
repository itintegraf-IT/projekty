import test from "node:test";
import assert from "node:assert/strict";
import { overdueAlarmState, OVERDUE_WINDOW_MS } from "./overdueState";
import { OVERDUE_WINDOW_MS as MONITOR_WINDOW_MS } from "./monitorView";

const NOW = new Date("2026-08-12T12:00:00.000Z");

/** Konec bloku `h` hodin PŘED NOW. */
function endHoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();
}

test("konec v budoucnu → none", () => {
  assert.equal(overdueAlarmState(endHoursAgo(-2), null, NOW), "none");
});

test("konec přesně teď → none (blok v tu milisekundu ještě běží)", () => {
  assert.equal(overdueAlarmState(NOW.toISOString(), null, NOW), "none");
});

test("odklepnutá zakázka → none, i když je konec dávno v minulosti", () => {
  assert.equal(overdueAlarmState(endHoursAgo(100), "2026-08-08T10:00:00.000Z", NOW), "none");
});

test("konec před hodinou, neodklepnuto → alarm", () => {
  assert.equal(overdueAlarmState(endHoursAgo(1), null, NOW), "alarm");
});

test("konec přesně na hranici okna → ještě alarm", () => {
  const end = new Date(NOW.getTime() - OVERDUE_WINDOW_MS).toISOString();
  assert.equal(overdueAlarmState(end, null, NOW), "alarm");
});

test("milisekundu za hranicí okna → stale", () => {
  const end = new Date(NOW.getTime() - OVERDUE_WINDOW_MS - 1).toISOString();
  assert.equal(overdueAlarmState(end, null, NOW), "stale");
});

test("konec před třemi dny → stale", () => {
  assert.equal(overdueAlarmState(endHoursAgo(72), null, NOW), "stale");
});

test("noční směna 22:00–6:00 je v poledne pořád alarm, ne stale", () => {
  // Regrese proti počítání od dne startu: blok začal VČERA, takže „nezačal dnes",
  // ale skončil dnes v 6:00 — tedy před 6 hodinami, uvnitř okna.
  assert.equal(overdueAlarmState("2026-08-12T06:00:00.000Z", null, NOW), "alarm");
});

test("Date na vstupu se chová stejně jako ISO string", () => {
  const end = new Date(NOW.getTime() - 60 * 60 * 1000);
  assert.equal(overdueAlarmState(end, null, NOW), "alarm");
  assert.equal(overdueAlarmState(end.toISOString(), null, NOW), "alarm");
});

test("nečitelné datum → none, nikdy alarm", () => {
  assert.equal(overdueAlarmState("", null, NOW), "none");
  assert.equal(overdueAlarmState("není datum", null, NOW), "none");
});

test("okno je sdílené s Monitorem — jedna konstanta, ne dvě", () => {
  // Monitor u stroje jím po 13. 8. 2026 už neřídí, kdy zakázka mizí z velké
  // karty (`pickHeroBlock` drží zakázku, dokud tiskař nerozhodne) — re-export
  // v `monitorView.ts` je jen záruka proti tomu, aby si tam někdo hodnotu
  // zkopíroval zpátky jako vlastní číslo. Test hlídá, že ta záruka drží.
  assert.equal(MONITOR_WINDOW_MS, OVERDUE_WINDOW_MS);
});

test("okno je 16 hodin", () => {
  // Zbytek souboru je psaný RELATIVNĚ k OVERDUE_WINDOW_MS a test parity výš
  // porovnává re-export téhož bindingu — obojí zůstane zelené i po změně
  // hodnoty. Bez tohohle řádku by se okno dalo tiše přenastavit a posunout
  // červený alarm v plánu, aniž by na to test upozornil.
  assert.equal(OVERDUE_WINDOW_MS, 16 * 60 * 60 * 1000);
});
