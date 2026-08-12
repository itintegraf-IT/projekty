import test from "node:test";
import assert from "node:assert/strict";
import { printDoneSize, isBlockRunningNow, splitChipFits, splitChipFitsInHeaderRow, PRINT_BAR_PADDING_PX } from "./tiskarBlockView.js";
import { plannerTypeScale } from "./plannerTypography";

test("printDoneSize: vysoký blok (≥140 px) = pruh 40 px", () => {
  assert.deepEqual(printDoneSize(168), { variant: "bar", height: 40, fontSize: 16 });
  assert.deepEqual(printDoneSize(140), { variant: "bar", height: 40, fontSize: 16 });
});

test("printDoneSize: 96–139 px = pruh 32 px", () => {
  assert.deepEqual(printDoneSize(139), { variant: "bar", height: 32, fontSize: 14 });
  assert.deepEqual(printDoneSize(96),  { variant: "bar", height: 32, fontSize: 14 });
});

test("printDoneSize: 55–95 px (M) = pruh, výška dopočítaná stropem 24 px", () => {
  // HOTFIX 8/2026: práh pruhu je zpátky ts.thresholds.full (46 na M) — přesně
  // na hranici MODE_FULL, ne nad ní (viz test „v plném layoutu..." níž, jádro
  // opravy). Výška nejnižšího stupně pruhu se dopočítává z dostupného místa
  // (min(24, layoutHeight - rowHeights.header - PRINT_BAR_PADDING_PX)) — na M
  // dosáhne stropu 24 px až od 55 (46-24-7=15 … 55-24-7=24).
  assert.deepEqual(printDoneSize(95), { variant: "bar", height: 24, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(55), { variant: "bar", height: 24, fontSize: 11.5 });
});

test("printDoneSize: 46–54 px (M) = pruh s dopočítanou nižší výškou (dřív mezera bez tlačítka)", () => {
  // Přesně pásmo, které předchozí oprava (Math.max(full, header+26)) omylem
  // vyřadila z bar varianty a nechala spadnout na square — jenže square se
  // v MODE_FULL vůbec nekreslí (BlockCard.tsx:1115 kreslí bar jen pro
  // MODE_FULL, square jen pro COMPACT/TINY). Výsledkem byla karta bez
  // JAKÉHOKOLIV tlačítka Hotovo — přesně havárie z 3. 8. 2026, ve druhém kole.
  assert.deepEqual(printDoneSize(46), { variant: "bar", height: 15, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(50), { variant: "bar", height: 19, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(54), { variant: "bar", height: 23, fontSize: 11.5 });
});

test("printDoneSize: 14–45 px (M) = čtverec 26 px", () => {
  // Horní mez je teď přesně ts.thresholds.full - 1 (45) — čtverec platí jen
  // v layoutech, které square skutečně kreslí (COMPACT/TINY/MICRO_TEXT).
  assert.deepEqual(printDoneSize(45), { variant: "square", height: 26, fontSize: 15 });
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

test("práh pruhu Hotovo je PŘESNĚ ts.thresholds.full — HOTFIX 8/2026", () => {
  // PŘED touto opravou tenhle test tvrdil, že práh pruhu je
  // Math.max(ts.thresholds.full, ts.rowHeights.header + 26) — tj. AŽ NAD prahem
  // plného layoutu na M a L. To přesně zabetonovávalo opravovanou vadu: v pásmu
  // mezi ts.thresholds.full a tímhle vyšším prahem je karta už v MODE_FULL
  // (BlockCard.tsx), ale printDoneSize vracela `square` — a MODE_FULL variantu
  // `square` vůbec nekreslí (BlockCard.tsx:1115 kreslí bar jen pro MODE_FULL,
  // square jen pro COMPACT/TINY/MICRO_TEXT). Výsledek: karta bez JAKÉHOKOLIV
  // tlačítka Hotovo — regrese z 3. 8. 2026, v horší podobě, protože nešlo o
  // úzké pásmo výjimky, ale o běžná zoom nastavení (hodinová zakázka na M).
  //
  // Oprava místo zvyšování prahu zmenšuje pruh (viz printDoneSize) — práh se
  // tak může vrátit přesně na ts.thresholds.full, čímž se pásmo bez tlačítka
  // zavře úplně, ne jen zúží.
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    assert.equal(printDoneSize(ts.thresholds.full - 1, ts)?.variant, "square", `${key}: pod prahem čtverec`);
    assert.equal(printDoneSize(ts.thresholds.full, ts)?.variant, "bar", `${key}: přesně na prahu už pruh`);
  }
});

test("pruh se vždy vejde pod první řádek karty — hlídá vazbu napřímo pro M/L/XL", () => {
  // Přímý strážce geometrie z NÁLEZU 1, přepočítaný na dopočítanou (ne napevno
  // 24px) výšku pruhu: kdykoliv printDoneSize vrátí variantu bar, musí platit
  // height + rowHeights.header + PRINT_BAR_PADDING_PX <= layoutHeight — jinak
  // by pruh přerostl kartu a spodní okraj by se ořízl (stejná třída chyby jako
  // 3. 8. 2026, jen jinde v rozsahu výšek).
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    for (let h = ts.thresholds.micro; h <= 200; h++) {
      const size = printDoneSize(h, ts);
      if (size?.variant === "bar") {
        assert.ok(
          size.height + ts.rowHeights.header + PRINT_BAR_PADDING_PX <= h,
          `${key} @ ${h}px: pruh výšky ${size.height} se nevejde pod první řádek (${ts.rowHeights.header} + odsazení ${PRINT_BAR_PADDING_PX})`
        );
      }
    }
  }
});

test("STRÁŽNÝ TEST — v plném layoutu se NIKDY nesmí vrátit square ani null (incident 3. 8. 2026)", () => {
  // Tohle je jádro celé opravy. BlockCard.tsx přepíná do MODE_FULL přesně na
  // layoutHeight >= ts.thresholds.full a v MODE_FULL kreslí tlačítko Hotovo
  // JEN pro variantu `bar` (BlockCard.tsx:1115) — varianta `square` se používá
  // výhradně mimo plný layout (MODE_COMPACT/MODE_TINY, BlockCard.tsx:862 a :984).
  //
  // Pokud tenhle test spadne, znamená to, že v plném layoutu existuje výška
  // karty, na které tiskař nemá na bloku ŽÁDNÉ tlačítko k potvrzení tisku —
  // přesně havárie z 3. 8. 2026 (a její regrese při opravě z 8/2026, která
  // omylem zvedla práh pruhu nad ts.thresholds.full). Než cokoliv v
  // printDoneSize/BlockCard měnit, ověřit, že tenhle test dál prochází.
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    for (let h = 0; h <= 200; h++) {
      if (h >= ts.thresholds.full) {
        const size = printDoneSize(h, ts);
        assert.notEqual(size, null, `${key} @ ${h}px: MODE_FULL bez tlačítka Hotovo (null)`);
        assert.notEqual(size?.variant, "square", `${key} @ ${h}px: MODE_FULL vrátil square — v plném layoutu se square nekreslí`);
      }
    }
  }
});

test("splitChipFits: na L/XL roste chip s písmem — hranice M (25 px) na L/XL už nestačí", () => {
  // Task 6: SPLIT_CHIP_PX byl napevno 25 px pro všechny stupně, i po Task 5,
  // kdy SplitChip dostal `fontSize={typeScale.splitChip}` a na L/XL vyrostl.
  // Rozpočet tak byl podhodnocený — propouštěl chip, který se ve skutečnosti
  // nevešel. Na hranici, kde M chip ještě vejde (80 px, viz test výš), musí
  // L/XL potřebovat víc místa.
  const l = plannerTypeScale("L");
  const xl = plannerTypeScale("XL");
  assert.equal(splitChipFits(80, printDoneSize(80, l), 0, l), false, "L @ 80 px (M hranice) se ještě nevejde");
  assert.equal(splitChipFits(80, printDoneSize(80, xl), 0, xl), false, "XL @ 80 px (M hranice) se ještě nevejde");
});

test("splitChipFitsInHeaderRow: M @ 46 px (přesná hranice MODE_FULL) — na pilulku v řádku 1 není místo", () => {
  // Nejtěsnější případ: pruh Hotovo má na M @ 46 px jen dopočítanou výšku 15 px
  // (viz printDoneSize) a řádek 1 nemá žádnou rezervu navíc — přednost má
  // tlačítko Hotovo, textová značka „✂1/2" zůstává.
  const m = plannerTypeScale("M");
  assert.equal(splitChipFitsInHeaderRow(46, printDoneSize(46, m), 0, m), false);
});

test("splitChipFitsInHeaderRow: M @ 60 a 79 px — pilulka v řádku 1 se vejde (regresní pásmo z review)", () => {
  // Přesně pásmo, kde review označilo pilulku za ztracenou: MODE_FULL, ale
  // spodní umístění (`splitChipFits`) ji odmítne. Řádek 1 je záložní umístění.
  const m = plannerTypeScale("M");
  assert.equal(splitChipFits(60, printDoneSize(60, m), 0, m), false, "spodní umístění se na 60 px nevejde");
  assert.equal(splitChipFitsInHeaderRow(60, printDoneSize(60, m), 0, m), true, "řádek 1 pilulku pojme");
  assert.equal(splitChipFits(79, printDoneSize(79, m), 0, m), false, "spodní umístění se na 79 px nevejde");
  assert.equal(splitChipFitsInHeaderRow(79, printDoneSize(79, m), 0, m), true, "řádek 1 pilulku pojme");
});

test("splitChipFitsInHeaderRow: XL @ 60 px — ani řádek 1 nemá místo, tlačítko Hotovo má přednost", () => {
  // Na XL je řádek 1 i pruh Hotovo o kus vyšší než na M — na 60 px (těsně nad
  // XL thresholds.full) nezbyde místo ani na záložní umístění v řádku 1.
  // Ověřuje, že funkce v tomhle případě NEobětuje tlačítko Hotovo pro pilulku.
  const xl = plannerTypeScale("XL");
  assert.equal(splitChipFits(60, printDoneSize(60, xl), 0, xl), false);
  assert.equal(splitChipFitsInHeaderRow(60, printDoneSize(60, xl), 0, xl), false);
});

test("splitChipFitsInHeaderRow: nikdy nepovolí přerůst přes hranici karty (fuzz M/L/XL)", () => {
  // Přímý strážce geometrie, obdoba testu pro `printDoneSize` výš: kdykoliv
  // funkce vrátí true, musí platit, že řádek 1 s pilulkou + rezerva
  // specifikace + rezerva pruhu Hotovo se do layoutHeight reálně vejdou.
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    for (let h = ts.thresholds.full; h <= 200; h++) {
      for (const specRows of [0, 1, 2] as const) {
        const printDone = printDoneSize(h, ts);
        const fits = splitChipFitsInHeaderRow(h, printDone, specRows, ts);
        if (fits) {
          const chipContentHeight = 2 + 6 + ts.splitChip * 1.1;
          const headerRowWithChip = Math.max(ts.rowHeights.header, 8 + chipContentHeight);
          const specReserve = specRows === 2 ? ts.rowHeights.spec2 : specRows === 1 ? ts.rowHeights.spec1 : 0;
          const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
          assert.ok(
            headerRowWithChip + specReserve + barReserve <= h,
            `${key} @ ${h}px specRows=${specRows}: fits=true, ale obsah přerůstá kartu`
          );
        }
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
