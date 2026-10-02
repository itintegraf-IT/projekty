import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test čitatele vytížení (etapa 2 září 2026, spec odd. 2).
 *
 * Tři agregace nad týmiž vstupy — `handleRetro`, `handleOutlook` a stavový pás
 * Kontrolního panelu — se do etapy 2 rozcházely: každá si rozhodovala sama, jak
 * se blok bez tiskových segmentů počítá, a Výhled navíc bral segmenty jen pro
 * ZAKAZKA. Výsledkem bylo „100 %, 0 h volných" na stroji s prázdnou směnou.
 *
 * Test hlídá ZAPOJENÍ, ne existenci funkce: čistá `occupiedMinutes` sama nic
 * neopraví, když ji route nezavolá (P15). Komentáře se odstraňují, aby dočasně
 * zakomentované volání testem neprošlo.
 */
const dashboard = stripComments(readFileSync("src/app/api/report/dashboard/route.ts", "utf8"));
const attention = stripComments(readFileSync("src/app/api/report/attention/route.ts", "utf8"));

test("rigidní blok se v obou režimech i ve stavovém pásu počítá přes occupiedMinutes", () => {
  for (const [name, src] of [["dashboard", dashboard], ["attention", attention]] as const) {
    assert.match(src, /occupiedMinutes\(/, `${name}: agregace musí jít přes occupiedMinutes`);
    assert.doesNotMatch(
      src,
      /printOverlapMinutes\(/,
      `${name}: hrubý span patří dovnitř occupiedMinutes, ne do routy`,
    );
  }
});

test("Výhled i stavový pás staví segmenty podle usesTiskoveHodiny, ne podle typu bloku", () => {
  for (const [name, src] of [["dashboard", dashboard], ["attention", attention]] as const) {
    assert.doesNotMatch(
      src,
      /type === "ZAKAZKA"\s*\?\s*blockReportSegments/,
      `${name}: IML rezervace s tiskovými minutami by dostala kalendářní span`,
    );
  }
  // Dashboard staví segMap dvakrát — jednou v retro režimu, jednou ve Výhledu.
  assert.equal(
    (dashboard.match(/usesTiskoveHodiny\(b\)\s*\?\s*blockReportSegments/g) ?? []).length,
    2,
    "oba režimy dashboardu musí větvit na usesTiskoveHodiny",
  );
  assert.match(attention, /usesTiskoveHodiny\(b\)\s*\?\s*blockReportSegments/);
});

test("den se odvozuje PRŮNIKEM celoobdobových intervalů, ne novým průchodem rozvrhem", () => {
  // Jinak se může heatmapa rozejít s kartou nad ní — tatáž třída vady, jakou už
  // jednou opravoval komentář o 26 h ze 399 h v `handleRetro`.
  assert.equal(
    (dashboard.match(/intersectIntervals\(/g) ?? []).length,
    2,
    "retro i výhled si denní intervaly berou průnikem",
  );
  assert.match(attention, /intersectIntervals\(/);
});
