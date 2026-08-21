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

/**
 * Naostro naměřená vada 21. 8. 2026: `PUT /api/blocks/[id]` maže `resolveChain` z
 * `allowed`, což je pro ADMIN/PLANOVAT TOTOŽNÁ reference jako `body` (`delete
 * (allowed as …).resolveChain`, kvůli tomu, aby se příznak nedostal do
 * `prisma.block.update`). Volání `autoShiftExplicitlyOff(body)` AŽ v catch proto
 * vždycky vidělo "zapnuto" a hláška o vypnutém autoposunu se u PUT nikdy neukázala
 * — i když request `resolveChain: false` poslal. Oprava: příznak se vyzvedne do
 * proměnné HNED po parsování těla, PŘED jakoukoliv mutací (viz `PUT /api/blocks/[id]`,
 * `POST /api/blocks`, `POST /api/blocks/batch`, split a obě reflow cesty — všech
 * šest teď čte `autoShiftOff` z hoistnuté proměnné, nikdy z `body` až v catch).
 */
test("příznak vyzvednutý před delete přežije zmutování těla", () => {
  const body: Record<string, unknown> = { resolveChain: false };
  const autoShiftOff = body.resolveChain === false;   // vzor z routes
  delete body.resolveChain;                            // co dělá PUT s `allowed`
  assert.equal(autoShiftOff, true);
  assert.equal(autoShiftExplicitlyOff(body), false, "čtení AŽ POTOM je vada — tohle je ta past");
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
