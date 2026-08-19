import test from "node:test";
import assert from "node:assert/strict";
import { blurEditableFocus, type BlurableElement } from "./focusGuard";

function fakeElement(tagName: string): BlurableElement & { blurred: boolean } {
  const el = { tagName, blurred: false, blur() { el.blurred = true; } };
  return el;
}

test("blurEditableFocus: INPUT se blurne", () => {
  const el = fakeElement("INPUT");
  blurEditableFocus(el);
  assert.equal(el.blurred, true);
});

test("blurEditableFocus: TEXTAREA se blurne", () => {
  const el = fakeElement("TEXTAREA");
  blurEditableFocus(el);
  assert.equal(el.blurred, true);
});

test("blurEditableFocus: SELECT se blurne", () => {
  const el = fakeElement("SELECT");
  blurEditableFocus(el);
  assert.equal(el.blurred, true);
});

test("blurEditableFocus: BUTTON se NEblurne (není editovatelný prvek)", () => {
  const el = fakeElement("BUTTON");
  blurEditableFocus(el);
  assert.equal(el.blurred, false);
});

test("blurEditableFocus: null je no-op, nehází (mousedown mimo focus)", () => {
  assert.doesNotThrow(() => blurEditableFocus(null));
});
