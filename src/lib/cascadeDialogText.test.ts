import { test } from "node:test";
import assert from "node:assert";
import { cascadeDialogTitle, CASCADE_REASON_LABELS, longerBlocksSentence } from "./cascadeDialogText";

test("titulek říká pravdu a nese label stroje", () => {
  assert.strictEqual(cascadeDialogTitle("XL_106", 3), "Změna směn na XL 106 vystěhuje z pracovní doby bloky (3)");
  assert.strictEqual(cascadeDialogTitle("XL_105", 1), "Změna směn na XL 105 vystěhuje z pracovní doby bloky (1)");
});

test("titulek nikdy nenese surové id stroje ani slovo o zkrácení", () => {
  const t = cascadeDialogTitle("XL_106", 2);
  assert.ok(!t.includes("XL_106"));
  assert.ok(!t.toLowerCase().includes("zkrácen"), "přidání směny taky může vystěhovat blok");
});

test("mapa důvodů je vyčerpávající a bez prázdných textů", () => {
  assert.deepStrictEqual(Object.keys(CASCADE_REASON_LABELS).sort(),
    ["END_MISMATCH", "HORIZON_EXCEEDED", "START_NOT_RUNNABLE"]);
  for (const v of Object.values(CASCADE_REASON_LABELS)) assert.ok(v.length > 0);
});

test("věta o prodloužení je jen když je co říct", () => {
  assert.strictEqual(longerBlocksSentence(0), null);
  const s = longerBlocksSentence(2);
  assert.ok(s && s.includes("2"));
  assert.ok(s.includes("odsune"), "musí říct, co se stane při příští úpravě");
});

test("věta o prodloužení mluví obecně o blocích, ne o zakázkách (F3 — newlyLonger může nést i rezervaci)", () => {
  const s = longerBlocksSentence(2);
  assert.ok(s && s.includes("bloků"));
  assert.ok(s && !s.includes("zakáz"), "od etapy 9 nese newlyLonger i rezervace, ne jen zakázky");
});
