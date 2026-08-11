import test from "node:test";
import assert from "node:assert/strict";
import { printDoneSize, isBlockRunningNow, splitChipFits } from "./tiskarBlockView.js";
import { plannerTypeScale } from "./plannerTypography";

test("printDoneSize: vysoký blok (≥140 px) = pruh 40 px", () => {
  assert.deepEqual(printDoneSize(168), { variant: "bar", height: 40, fontSize: 16 });
  assert.deepEqual(printDoneSize(140), { variant: "bar", height: 40, fontSize: 16 });
});

test("printDoneSize: 96–139 px = pruh 32 px", () => {
  assert.deepEqual(printDoneSize(139), { variant: "bar", height: 32, fontSize: 14 });
  assert.deepEqual(printDoneSize(96),  { variant: "bar", height: 32, fontSize: 14 });
});

test("printDoneSize: 50–95 px = pruh 24 px (práh pruhu, ne MODE_FULL)", () => {
  // Spodní mez posunuta z 48 na 50: práh pruhu už není ts.thresholds.full (46),
  // ale rowHeights.header + 26 px rezervy, kterou pruh reálně potřebuje
  // (nález review 8/2026 — na 46–49 px se pruh do karty nevešel celý).
  assert.deepEqual(printDoneSize(95), { variant: "bar", height: 24, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(50), { variant: "bar", height: 24, fontSize: 11.5 });
});

test("printDoneSize: 14–49 px = čtverec 26 px", () => {
  // Horní mez posunuta z 45 na 49: čtverec teď platí až do těsně pod prahem
  // pruhu (50, viz test výš) — na M už to není ts.thresholds.full (46), protože
  // pruh na 46–49 px reálně nemá kam se vejít (oprava nálezu review 8/2026).
  assert.deepEqual(printDoneSize(49), { variant: "square", height: 26, fontSize: 15 });
  assert.deepEqual(printDoneSize(14), { variant: "square", height: 26, fontSize: 15 });
});

test("printDoneSize: pod 14 px se tlačítko nekreslí", () => {
  assert.equal(printDoneSize(13), null);
  assert.equal(printDoneSize(0), null);
});

test("splitChipFits: hodinový blok (52 px) s pruhem Hotovo chip neunese", () => {
  // Přesně případ, kdy tlačítko Hotovo propadlo pod ořez karty (regrese 3. 8. 2026).
  assert.equal(splitChipFits(52, printDoneSize(52), 0), false);
});

test("splitChipFits: dvouhodinový blok (104 px) chip i tlačítko unese", () => {
  assert.equal(splitChipFits(104, printDoneSize(104), 0), true);
});

test("splitChipFits: hranice pásma s pruhem 24 px", () => {
  // Hranice posunuta z 79/78 na 80/79: řádek 1 teď čte ts.rowHeights.header,
  // které je pro M 24 px (ne napevno zapsaných 23) — Task 1 odhad zpřísnil
  // o 1 px, takže SplitChip potřebuje o 1 px vyšší kartu, aby se vešel.
  // rozpočet: řádek 1 (24) + pruh (24+7) + chip (25) = 80
  assert.equal(splitChipFits(80, printDoneSize(80), 0), true);
  assert.equal(splitChipFits(79, printDoneSize(79), 0), false);
});

test("splitChipFits: pás specifikace ubere místo chipu podle počtu řádků", () => {
  // rozpočet 95 px: řádek 1 (24) + pruh (24+7) + chip (25) = 80, zbývá 15
  assert.equal(splitChipFits(95, printDoneSize(95), 0), true);
  assert.equal(splitChipFits(95, printDoneSize(95), 1), false); // +21 → nevejde se
  assert.equal(splitChipFits(95, printDoneSize(95), 2), false); // +34 → tím spíš
  // jednořádkový pás se vejde na vyšší kartě, dvouřádkový už ne
  // rozpočet 110 px: řádek 1 (24) + pruh (32+7) + chip (25) = 88, zbývá 22
  assert.equal(splitChipFits(110, printDoneSize(110), 1), true);  // +21 → 108 ≤ 110
  assert.equal(splitChipFits(110, printDoneSize(110), 2), false); // +34 → 121 > 110
});

test("splitChipFits: bez pruhu Hotovo (mimo tiskaře) stačí i nízká karta", () => {
  // Hranice posunuta z 48 na 49 se stejným 1px zpřísněním ts.rowHeights.header
  // jako v testu výše (bez pruhu Hotovo je barReserve 0, takže tady se ten
  // 1 px posun projeví přímo).
  assert.equal(splitChipFits(49, null, 0), true);
});

test("isBlockRunningNow: čas uvnitř bloku = běží", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");
  assert.equal(isBlockRunningNow("2026-08-03T08:00:00.000Z", "2026-08-03T12:00:00.000Z", now, false), true);
});

test("isBlockRunningNow: přesný start = běží, přesný konec už ne", () => {
  const start = new Date("2026-08-03T08:00:00.000Z");
  const end   = new Date("2026-08-03T12:00:00.000Z");
  assert.equal(isBlockRunningNow(start, end, start, false), true);
  assert.equal(isBlockRunningNow(start, end, end, false), false);
});

test("isBlockRunningNow: před startem a po konci = neběží", () => {
  const s = "2026-08-03T08:00:00.000Z";
  const e = "2026-08-03T12:00:00.000Z";
  assert.equal(isBlockRunningNow(s, e, new Date("2026-08-03T07:59:00.000Z"), false), false);
  assert.equal(isBlockRunningNow(s, e, new Date("2026-08-03T12:01:00.000Z"), false), false);
});

test("isBlockRunningNow: odklepnutý blok neběží, i když je uvnitř svého času", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");
  assert.equal(isBlockRunningNow("2026-08-03T08:00:00.000Z", "2026-08-03T12:00:00.000Z", now, true), false);
});

test("printDoneSize: nikdy nevrátí variantu hero (ta patří jen Monitoru)", () => {
  for (const h of [200, 140, 139, 96, 95, 48, 47, 14, 13, 0]) {
    const size = printDoneSize(h);
    assert.notEqual(size?.variant, "hero");
  }
});

test("bez stupně se rozpočet chová jako dnes (stupeň M)", () => {
  assert.deepEqual(printDoneSize(50), printDoneSize(50, plannerTypeScale("M")));
  assert.deepEqual(printDoneSize(20), printDoneSize(20, plannerTypeScale("M")));
});

test("práh pruhu Hotovo garantuje, že se pruh do karty vejde (oprava nálezu review 8/2026)", () => {
  // Hranice se posunula z ts.thresholds.full: na M/L se do prahu plného layoutu
  // pruh nevešel celý (potřebuje nad sebou první řádek karty i svoje vlastní
  // odsazení, dohromady rowHeights.header + 26 px) a spodní okraj se ořízl —
  // menší sourozenec regrese tlačítka Hotovo z 3. 8. 2026. Hodnoty dopočítané
  // z plannerTypography.ts (M 50 / L 52 / XL 57, viz final-fix-report.md).
  const expectedBarThreshold = { M: 50, L: 52, XL: 57 } as const;
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    const barThreshold = expectedBarThreshold[key];
    assert.equal(printDoneSize(barThreshold - 1, ts)?.variant, "square", `${key}: pod prahem čtverec`);
    assert.equal(printDoneSize(barThreshold, ts)?.variant, "bar", `${key}: na prahu pruh`);
    assert.ok(
      barThreshold >= ts.rowHeights.header + 26,
      `${key}: práh ${barThreshold} musí zaručit prostor pro pruh (potřeba ${ts.rowHeights.header + 26})`
    );
  }
});

test("pruh 24 px se vždy vejde pod první řádek karty — hlídá vazbu napřímo pro M/L/XL", () => {
  // Přímý strážce geometrie z NÁLEZU 1: kdykoliv printDoneSize vrátí variantu
  // bar o výšce 24, layoutHeight musí mít rezervu na první řádek karty
  // (rowHeights.header) i na odsazení a výšku pruhu (2 px paddingTop + 24 px
  // výška = 26 px). Právě absence takového testu pustila vadu, kdy byl práh
  // pruhu svázaný jen s thresholds.full a pruh se na M/L do karty nevešel.
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    for (let h = ts.thresholds.micro; h <= 200; h++) {
      const size = printDoneSize(h, ts);
      if (size?.variant === "bar" && size.height === 24) {
        assert.ok(
          h >= ts.rowHeights.header + 26,
          `${key} @ ${h}px: pruh 24 se nevejde pod první řádek (potřeba ${ts.rowHeights.header + 26})`
        );
      }
    }
  }
});

test("ve větším písmu je SplitChip odmítnut dřív", () => {
  const m = plannerTypeScale("M");
  const xl = plannerTypeScale("XL");
  // 109 px je výška, kde je rozdíl mezi stupni skutečně vidět: při M se chip
  // ještě vejde (fitsM = true), ale XL má vyšší ts.rowHeights (spec1 i header),
  // takže při stejné výšce karty už chipu nezbyde místo (fitsXL = false).
  // Ověřeno spuštěním (ne odhadem) — viz task-5-report.md, oddíl Fix round 1.
  const h = 109;
  const fitsM = splitChipFits(h, printDoneSize(h, m), 1, m);
  const fitsXL = splitChipFits(h, printDoneSize(h, xl), 1, xl);
  assert.equal(fitsM, true, "při M se chip vejde");
  assert.equal(fitsXL, false, "při XL se stejná karta chipu nevejde");
});
