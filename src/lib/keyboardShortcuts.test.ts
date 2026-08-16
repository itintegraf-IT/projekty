import test from "node:test";
import assert from "node:assert/strict";
import { shortcutLetter, isShortcut } from "./keyboardShortcuts.js";

// Regrese k incidentu z 13. 8. 2026 — plánovači vypnul Caps Lock všechny zkratky
// a nespravil to reload ani restart prohlížeče. Testy popisují, co `KeyboardEvent`
// reálně nese v jednotlivých situacích; hodnoty `key`/`code` odpovídají Chrome.

test("shortcutLetter: běžný stav — malé písmeno projde", () => {
  assert.equal(shortcutLetter({ key: "c", code: "KeyC" }), "c");
  assert.equal(shortcutLetter({ key: "x", code: "KeyX" }), "x");
  assert.equal(shortcutLetter({ key: "v", code: "KeyV" }), "v");
  assert.equal(shortcutLetter({ key: "z", code: "KeyZ" }), "z");
  assert.equal(shortcutLetter({ key: "y", code: "KeyY" }), "y");
});

test("shortcutLetter: ZAPNUTÝ CAPS LOCK — `key` je velké písmeno, zkratka musí přesto projít", () => {
  // Tohle je přesně ten incident: Ctrl+C s Caps Lockem posílá key "C", ne "c".
  assert.equal(shortcutLetter({ key: "C", code: "KeyC" }), "c");
  assert.equal(shortcutLetter({ key: "X", code: "KeyX" }), "x");
  assert.equal(shortcutLetter({ key: "V", code: "KeyV" }), "v");
  assert.equal(shortcutLetter({ key: "Z", code: "KeyZ" }), "z");
  assert.equal(shortcutLetter({ key: "Y", code: "KeyY" }), "y");
});

test("shortcutLetter: nelatinkové rozložení — `key` je cizí znak, rozhodne fyzická klávesa", () => {
  // Přepnutí na cyrilici (Alt+Shift) je druhá cesta k témuž tichému selhání.
  assert.equal(shortcutLetter({ key: "с", code: "KeyC" }), "c");
  assert.equal(shortcutLetter({ key: "ч", code: "KeyX" }), "x");
  assert.equal(shortcutLetter({ key: "я", code: "KeyZ" }), "z");
});

test("shortcutLetter: Caps Lock i cizí rozložení naráz", () => {
  assert.equal(shortcutLetter({ key: "С", code: "KeyC" }), "c");
});

test("shortcutLetter: bez `code` (starší WebView) rozhodne napsaný znak, i velký", () => {
  assert.equal(shortcutLetter({ key: "c" }), "c");
  assert.equal(shortcutLetter({ key: "C" }), "c");
  assert.equal(shortcutLetter({ key: "Z" }), "z");
});

test("shortcutLetter: bez `code` a s cizím znakem nejde rozhodnout — null", () => {
  // Poctivé přiznání meze: bez fyzické klávesy není z čeho zkratku odvodit.
  assert.equal(shortcutLetter({ key: "с" }), null);
});

test("shortcutLetter: klávesy mimo sadu zkratek vrací null", () => {
  assert.equal(shortcutLetter({ key: "a", code: "KeyA" }), null);
  assert.equal(shortcutLetter({ key: "Delete", code: "Delete" }), null);
  assert.equal(shortcutLetter({ key: "Escape", code: "Escape" }), null);
  assert.equal(shortcutLetter({ key: "Enter", code: "Enter" }), null);
  assert.equal(shortcutLetter({ key: " ", code: "Space" }), null);
});

test("shortcutLetter: číselná řada nesmí propadnout na písmeno", () => {
  // `Digit3` ani `key: "3"` nemá se zkratkami nic společného.
  assert.equal(shortcutLetter({ key: "3", code: "Digit3" }), null);
});

test("shortcutLetter: numpad Y/Z neexistuje, ale KeyY/KeyZ ano — hlídá překlep v mapě", () => {
  assert.equal(shortcutLetter({ key: "Y", code: "KeyY" }), "y");
  assert.notEqual(shortcutLetter({ key: "Y", code: "KeyY" }), "z");
});

test("isShortcut: čte se stejně jako dřívější porovnání, ale odolá Caps Locku", () => {
  assert.equal(isShortcut({ key: "C", code: "KeyC" }, "c"), true);
  assert.equal(isShortcut({ key: "C", code: "KeyC" }, "x"), false);
  assert.equal(isShortcut({ key: "Delete", code: "Delete" }, "c"), false);
});
