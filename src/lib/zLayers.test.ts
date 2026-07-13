import { test } from "node:test";
import assert from "node:assert/strict";
import { Z_TIMELINE, Z_LAYOUT, Z_OVERLAY } from "./zLayers";

// Pořadí klíčů v každé skupině MUSÍ odpovídat rostoucímu z-indexu — deklarace je
// zároveň dokumentace vrstvení. Test chytí, když někdo přidá konstantu mimo pořadí
// nebo omylem sníží hodnotu vyšší vrstvy.

test("Z_OVERLAY: body-level překryvy jsou STRIKTNĚ rostoucí (na pořadí záleží pro korektnost)", () => {
  const e = Object.entries(Z_OVERLAY);
  for (let i = 1; i < e.length; i++) {
    assert.ok(
      e[i][1] > e[i - 1][1],
      `${e[i][0]} (${e[i][1]}) musí být > ${e[i - 1][0]} (${e[i - 1][1]})`,
    );
  }
});

test("Z_TIMELINE: lokální škála uvnitř gridu je neklesající (kolize 30/30 mezi jinými kontexty OK)", () => {
  const e = Object.entries(Z_TIMELINE);
  for (let i = 1; i < e.length; i++) {
    assert.ok(
      e[i][1] >= e[i - 1][1],
      `${e[i][0]} (${e[i][1]}) musí být ≥ ${e[i - 1][0]} (${e[i - 1][1]})`,
    );
  }
});

test("Z_LAYOUT: panely leží nad timeline a pod nejnižším overlay", () => {
  assert.ok(Z_LAYOUT.sidePanel > 0);
  assert.ok(Z_LAYOUT.panelDivider > Z_LAYOUT.sidePanel);
  const lowestOverlay = Math.min(...Object.values(Z_OVERLAY));
  assert.ok(
    lowestOverlay > Z_LAYOUT.panelDivider,
    `nejnižší overlay (${lowestOverlay}) musí být nad nejvyšším panelem (${Z_LAYOUT.panelDivider})`,
  );
});
