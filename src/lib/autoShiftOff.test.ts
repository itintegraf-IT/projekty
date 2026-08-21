import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOSHIFT_OFF_OVERLAP_MESSAGE, autoShiftExplicitlyOff, overlapMessageFor } from "./autoShiftOff";

test("výslovné vypnutí se pozná; chybějící příznak vypnutí NENÍ", () => {
  assert.equal(autoShiftExplicitlyOff({ resolveChain: false }), true);
  assert.equal(autoShiftExplicitlyOff({ resolveChain: true }), false);
  assert.equal(autoShiftExplicitlyOff({}), false, "chybějící příznak není vypnutí");
  assert.equal(autoShiftExplicitlyOff(null), false);
  assert.equal(autoShiftExplicitlyOff({ resolveChain: "false" }), false, "řetězec není false");
});

test("hláška se mění jen při vypnutém autoposunu — vypnuto: věta DOSLOVA + původní detail v závorce", () => {
  const original = "Blok koliduje s blokem #18673 na stroji XL 105.";
  // Zapnuto (autoShiftOff: false) → hláška se vůbec nedotkne, projde beze změny.
  assert.equal(overlapMessageFor(original, false), original);
  // Vypnuto → Vojtova věta zůstává DOSLOVA (review 21. 8. 2026, ne parafráze) a číslo
  // kolidujícího bloku i stroj se PŘIPOJÍ v závorce, ne zahodí — bez nich plánovač neví,
  // kde ručně uvolnit místo.
  const withOff = overlapMessageFor(original, true);
  assert.ok(withOff.startsWith(AUTOSHIFT_OFF_OVERLAP_MESSAGE),
    "hláška musí ZAČÍNAT přesně větou AUTOSHIFT_OFF_OVERLAP_MESSAGE, ne ji parafrázovat");
  assert.equal(withOff, `${AUTOSHIFT_OFF_OVERLAP_MESSAGE} (${original})`);
});
