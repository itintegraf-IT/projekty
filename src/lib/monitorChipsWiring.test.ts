import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test zapojení štítků Monitoru (etapa 1 září, 14. 9. 2026).
 *
 * Sekce NEDODĚLÁNO byla od 13. 8. 2026 záměrně bez štítků (zúžený řádek).
 * 14. 9. 2026 Vojta rozhodl opak (volba M2 = B: štítky všude). Starý stav ale
 * dál popisuje řada dokumentů a pamětí, takže hrozí, že ho někdo v dobré víře
 * „vrátí". Tenhle test to zachytí.
 *
 * Pojistka velké karty (`monitorChipsRowStyle`, spec odd. 1.3) platí jen
 * tehdy, když ji komponenta opravdu použije — čistá funkce sama nestačí (P15).
 */
const queue = stripComments(readFileSync("src/components/monitor/MonitorQueue.tsx", "utf8"));
const chips = stripComments(readFileSync("src/components/monitor/MonitorChips.tsx", "utf8"));

test("sekce NEDODĚLÁNO kreslí štítky stejně jako DNES/ZÍTRA (volba M2 = B)", () => {
  assert.match(queue, /<MonitorChips\s+block=\{b\}\s+size="queue"/);
  assert.doesNotMatch(queue, /!compact\s*&&\s*<MonitorChips/);
});

test("obal štítků bere styl z monitorChipsRowStyle (pojistka velké karty)", () => {
  assert.match(chips, /style=\{monitorChipsRowStyle\(size\)\}/);
});
