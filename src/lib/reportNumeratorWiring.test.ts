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
const metrics = stripComments(readFileSync("src/lib/reportMetrics.ts", "utf8"));

test("rigidní blok se v obou režimech i ve stavovém pásu počítá přes occupiedMinutes", () => {
  for (const [name, src] of [["dashboard", dashboard], ["attention", attention]] as const) {
    // `occupiedMinutesInDay` se počítá taky — je to tenká obálka nad `occupiedMinutes`,
    // která k tomu odvozuje den (viz třetí test níž). Stavový pás jinou cestu nemá.
    assert.match(src, /occupiedMinutes(InDay)?\(/, `${name}: agregace musí jít přes occupiedMinutes`);
    assert.doesNotMatch(
      src,
      /printOverlapMinutes\(/,
      `${name}: ČITATEL vytížení nesmí počítat hrubý span sám — patří dovnitř occupiedMinutes. ` +
        "Zákaz je úmyslně na CELÝ soubor, i když to pravidlo platí jen pro čitatele: " +
        "spec odd. 2.4 výslovně připouští, že JINDE je hrubý span správně (printOverlapMinutes " +
        "je obecný nástroj a /report/daily ho tak používá). Kdyby taková metrika přišla i do " +
        "téhle routy, nepřepisuj ji podle téhle hlášky — zúž tenhle test na oblast čitatele.",
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
  //
  // Od opravné vlny (září 2026) ten průnik NEDĚLÁ route, ale jediný pomocník
  // `occupiedMinutesInDay` v `reportMetrics.ts`. Dřív si ho psaly tři denní smyčky
  // samy a stačilo v jedné z nich poslat celoobdobové intervaly místo denních:
  // rigidní blok přes víc dnů by se naúčtoval celý KAŽDÉMU z nich. Proto se tu
  // hlídá dvojí — že route den neodvozuje (nemá kde to zkazit) a že pomocník ano.
  assert.equal(
    (dashboard.match(/occupiedMinutesInDay\(/g) ?? []).length,
    2,
    "retro i výhled mají denní čitatel přes occupiedMinutesInDay",
  );
  assert.match(attention, /occupiedMinutesInDay\(/, "stavový pás taky");
  for (const [name, src] of [["dashboard", dashboard], ["attention", attention]] as const) {
    assert.doesNotMatch(
      src,
      /intersectIntervals\(/,
      `${name}: denní intervaly si route nestaví sama — patří do occupiedMinutesInDay`,
    );
  }
  // A v pomocníkovi ten průnik skutečně je, nad CELOOBDOBOVÝMI intervaly.
  assert.match(
    metrics,
    /const dayStaffed = intersectIntervals\(staffed, \[\s*\{ start: dayStart\.getTime\(\), end: dayEnd\.getTime\(\) \},?\s*\]\);/,
    "occupiedMinutesInDay musí den odvozovat průnikem (paritu pinuje reportMetrics.test.ts)",
  );
});
