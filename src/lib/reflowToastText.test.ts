import { test } from "node:test";
import assert from "node:assert/strict";
import { reflowMachineToast, reflowBlockToast } from "./reflowToastText";

test("stroj: bez přeskočených a bez odsunutých je věta holá", () => {
  assert.equal(
    reflowMachineToast({ reflowedCount: 4, skippedCount: 0, movedCount: 0 }),
    "Přepočteno 4 bloků",
  );
});

test("stroj: odsunuté se přidají za přeskočené", () => {
  assert.equal(
    reflowMachineToast({ reflowedCount: 4, skippedCount: 2, movedCount: 31 }),
    "Přepočteno 4 bloků, přeskočeno 2 (zamčené/nevejde se), odsunuto 31 navazujících bloků",
  );
});

test("stroj: nulové odsunutí se NEuvádí (žádné odsunuto 0)", () => {
  const s = reflowMachineToast({ reflowedCount: 1, skippedCount: 0, movedCount: 0 });
  assert.ok(!s.includes("odsunuto"), s);
});

test("blok: beze změny mlčí o odsunutí", () => {
  assert.equal(
    reflowBlockToast({ changed: false, timesMoved: false, movedCount: 0 }),
    "Blok už na kalendář sedí.",
  );
});

test("blok: posun s odsunutými", () => {
  assert.equal(
    reflowBlockToast({ changed: true, timesMoved: true, movedCount: 20 }),
    "Blok přepočítán podle aktuálního kalendáře, odsunuto 20 navazujících bloků.",
  );
});

test("blok: posun bez odsunutých končí tečkou a o odsunutí mlčí", () => {
  assert.equal(
    reflowBlockToast({ changed: true, timesMoved: true, movedCount: 0 }),
    "Blok přepočítán podle aktuálního kalendáře.",
  );
});

test("blok: pouhé zrušení značky nikdy nehlásí odsunutí", () => {
  // Když se plán nepohnul, chain push neproběhl — movedCount 0 je jediná možná hodnota,
  // ale i kdyby přišla nesmyslná, věta o odsunutí se u téhle větve nesmí objevit.
  const s = reflowBlockToast({ changed: true, timesMoved: false, movedCount: 7 });
  assert.equal(s, 'Značka „odložené mimo pracovní dobu" zrušena — plán se nepohnul.');
});
