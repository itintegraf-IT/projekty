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

test("hláška se mění jen při vypnutém autoposunu", () => {
  assert.equal(overlapMessageFor("Blok koliduje s blokem #18673 na stroji XL 105.", true),
    AUTOSHIFT_OFF_OVERLAP_MESSAGE);
  assert.equal(overlapMessageFor("Blok koliduje s blokem #18673 na stroji XL 105.", false),
    "Blok koliduje s blokem #18673 na stroji XL 105.");
});
