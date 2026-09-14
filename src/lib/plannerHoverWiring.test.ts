import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test zapojení hover bubliny (etapa 1 září, 14. 9. 2026).
 *
 * Pravidlo polohy žije v čisté funkci `hoverTooltipPlacement` a má tabulkové
 * testy. Nic ale nezaručuje, že ho komponenta opravdu volá, že hledá souseda
 * mezi sourozenci s hákem `data-machine-col` a že se bublina otevírá až po
 * prodlevě. Logika se tu rozpadá mezi funkci a napojení — přesně případ,
 * na který P15 předepisuje strážný test nad zdrojákem volajícího.
 */
const card = stripComments(readFileSync("src/components/planner/BlockCard.tsx", "utf8"));
const tip = stripComments(readFileSync("src/components/planner/BlockHoverTooltip.tsx", "utf8"));

test("bublina počítá polohu výhradně přes hoverTooltipPlacement", () => {
  assert.match(tip, /hoverTooltipPlacement\(/);
  assert.doesNotMatch(tip, /hoverTooltipLeft\(|hoverTooltipTop\(/);
});

test("bublina hledá sousední sloupec mezi sourozenci s hákem data-machine-col", () => {
  assert.match(tip, /closest\(\s*"\[data-machine-col\]"\s*\)/);
  assert.match(tip, /hasAttribute\(\s*"data-machine-col"\s*\)/);
});

test("bublina se otevírá až po TOOLTIP_OPEN_DELAY_MS a jen s otevřeným stavem", () => {
  assert.match(card, /setTimeout\([\s\S]{0,200}?TOOLTIP_OPEN_DELAY_MS\s*\)/);
  assert.match(card, /open=\{\s*showTooltip\s*&&\s*hovered\s*&&\s*tooltipOpen\s*\}/);
});

test("náhled poznámky MTZ sdílí prodlevu s bublinou (žádné natvrdo zapsané číslo)", () => {
  assert.match(card, /openDelay=\{TOOLTIP_OPEN_DELAY_MS\}/);
  assert.doesNotMatch(card, /openDelay=\{\s*\d+\s*\}/);
});
