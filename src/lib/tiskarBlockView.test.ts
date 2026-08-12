import test from "node:test";
import assert from "node:assert/strict";
import { printDoneSize, isBlockRunningNow, splitChipFits, splitChipFitsInHeaderRow, specBandFits, tiskarDescClampsToOneLine, descLineClampFor, PRINT_BAR_PADDING_PX, MIN_CARD_CONTENT_HEIGHT_PX } from "./tiskarBlockView.js";
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
  // fontSize task 9 (12. 8. 2026): min(11.5×fontFactor, height×0.8) — na M
  // (fontFactor 1) je 11.5, height×0.8=19.2 ho na 24px pruhu nestropuje. Beze
  // změny proti stavu před etapou (M se nesmí hnout).
  assert.deepEqual(printDoneSize(95), { variant: "bar", height: 24, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(55), { variant: "bar", height: 24, fontSize: 11.5 });
});

test("printDoneSize: 46–54 px (M) = pruh s dopočítanou nižší výškou (dřív mezera bez tlačítka)", () => {
  // Přesně pásmo, které předchozí oprava (Math.max(full, header+26)) omylem
  // vyřadila z bar varianty a nechala spadnout na square — jenže square se
  // v MODE_FULL vůbec nekreslí (BlockCard.tsx:1115 kreslí bar jen pro
  // MODE_FULL, square jen pro COMPACT/TINY). Výsledkem byla karta bez
  // JAKÉHOKOLIV tlačítka Hotovo — přesně havárie z 3. 8. 2026, ve druhém kole.
  // fontSize task 9 (12. 8. 2026): min(11.5×fontFactor, height×0.8) — na M
  // (fontFactor 1) je to vždy přesně 11.5, strop (height×0.8, 12–18.4 v tomhle
  // pásmu) nikdy nesváže. Beze změny proti stavu před etapou — regrese review
  // 12. 8. 2026 (Math.round + height-6 by tu na 46 px vrátilo 9, ne 11.5) byla
  // opravena dřív, než se dostala do produkce.
  assert.deepEqual(printDoneSize(46), { variant: "bar", height: 15, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(50), { variant: "bar", height: 19, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(54), { variant: "bar", height: 23, fontSize: 11.5 });
});

test("printDoneSize: 14–45 px (M) = čtverec, dopočítaný z výšky karty se stropem 26 a dolní mezí 20 px", () => {
  // Horní mez je teď přesně ts.thresholds.full - 1 (45) — čtverec platí jen
  // v layoutech, které square skutečně kreslí (COMPACT/TINY/MICRO_TEXT).
  //
  // UPRAVENO task 5b (12. 8. 2026), rozhodnutí majitele: čtverec byl dřív
  // napevno 26 px bez ohledu na výšku karty — na spodním konci pásma (14 px)
  // byl o 12 px vyšší než karta a `overflow: hidden` ho ořízl. Teď se
  // dopočítává (`Math.max(20, Math.min(26, layoutHeight - 2))`), takže na 45 px
  // vychází beze změny 26 (dost místa), ale na 14 px klesne na dolní mez 20 px
  // (schválený mírný přesah, ne regrese).
  assert.deepEqual(printDoneSize(45), { variant: "square", height: 26, fontSize: 15 });
  assert.deepEqual(printDoneSize(14), { variant: "square", height: 20, fontSize: 15 * 20 / 26 });
});

test("printDoneSize: pod 14 px se tlačítko nekreslí", () => {
  // Obrana do hloubky, ne dosažitelný stav (task 9, 12. 8. 2026): `printDoneSize`
  // je čistá funkce a `thresholds.micro` (14) je pořád její vlastní veřejná
  // hranice, ale JEDINÝ konzument `BlockCard.tsx` podlahuje `layoutHeight` na
  // `MIN_CARD_CONTENT_HEIGHT_PX` (20 px) ještě PŘED voláním — z komponenty tedy
  // volání s `layoutHeight < 14` dnes nepřijde. Test zůstává, protože kontrakt
  // funkce (`layoutHeight < thresholds.micro` → `null`) platí bez ohledu na
  // to, kdo ji volá dnes.
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

test("splitChipFits: na L/XL roste chip s písmem — DISKRIMINAČNÍ test proti staré napevno zapsané konstantě", () => {
  // Task 6 review (nález 1): 80 px na L/XL vychází `false` i se STAROU napevno
  // zapsanou konstantou SPLIT_CHIP_PX=25 (na L zbývá 23 px, na XL 20 px — pod
  // oběma prahy) — ten test tedy neprokazoval, že oprava vůbec něco dělá.
  // L @ 82 px a XL @ 85 px jsou vybrané schválně JAKO PROTIPŘÍKLAD: se starou
  // konstantou 25 px vychází `splitChipFits` `true` (zbývá přesně 25 px), s
  // novou, ze stupně písma dopočítanou konstantou (L 26,65 px, XL 28,85 px)
  // vychází `false` — spadnou proti starému kódu, projdou proti novému.
  const l = plannerTypeScale("L");
  const xl = plannerTypeScale("XL");
  assert.equal(splitChipFits(82, printDoneSize(82, l), 0, l), false, "L @ 82 px: se starou konstantou 25 by vyšlo true (zbývá přesně 25 px)");
  assert.equal(splitChipFits(85, printDoneSize(85, xl), 0, xl), false, "XL @ 85 px: se starou konstantou 25 by vyšlo true (zbývá přesně 25 px)");
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

test("splitChipFitsInHeaderRow: nikdy nepovolí přerůst přes hranici karty — nezávislý geometrický model (BlockCard.tsx / SpecBand.tsx / SplitChip.tsx)", () => {
  // Review nález 2: předchozí verze tohohle testu přepočítávala TÝŽ výraz,
  // jaký `splitChipFitsInHeaderRow` počítá uvnitř (`Math.max(ts.rowHeights.header,
  // 8 + 2 + 6 + splitChip×1,1) + specReserve + barReserve <= h`) — to je
  // tautologie, spadnout nemůže, ať je funkce rozbitá jakkoliv.
  //
  // Tady je místo toho geometrie poskládaná NEZÁVISLE, přímo z komponent,
  // které Řádek 1 doopravdy vykreslují — ne z `tiskarBlockView.ts`:
  //   - `ts.num × 1,2` — číslo zakázky (`BlockCard.tsx`, řádek s číslem:
  //     `fontSize: typeScale.num, lineHeight: 1.2`)
  //   - `ts.desc × 1,3` — jednořádkový popis (`BlockCard.tsx`: `fontSize:
  //     typeScale.desc, lineHeight: 1.3`) — jen jako další kandidát do `max`,
  //     ne dopočet víceřádkového `descLineClamp` (ten je mimo kontrakt téhle
  //     funkce, viz její docstring)
  //   - box pilulky BEZ marginTopu — `SplitChip.tsx`: rámeček 1+1 (`border:
  //     "1px solid …"`), padding `"3px 8px 3px 6px"` (3+3 svisle), `fontSize`,
  //     `lineHeight: 1.1`. Vestavěný `marginTop: 6` tady záměrně NENÍ — v
  //     `BlockCard.tsx` ho na tomhle místě ruší wrapper `marginTop: -6`.
  //   - pás specifikace — skutečný box `SpecBand.tsx`: vnější `padding: "0 6px
  //     3px"` (0+3 svisle) + vnitřní `padding: "2px 6px"` (2+2 svisle) +
  //     `fontSize × 1,3 × počet řádků` (`lineHeight: 1.3`, `WebkitLineClamp`).
  //   - pruh Hotovo — `printDone.height` + odsazení z `BlockCard.tsx`
  //     (`padding: "2px 7px 5px"` kolem `<PrintDoneButton>`, tj. top 2 +
  //     bottom 5 = 7). Číselně stejné jako `PRINT_BAR_PADDING_PX`, ale
  //     odvozené přímo z JSX, ne importované ze SUT.
  //
  // Tolerance 0,5 px kryje zaokrouhlení `ts.rowHeights.spec2` uvnitř funkce
  // (34,3 → 34 na M) proti tomuhle nezávislému, nezaokrouhlenému modelu — ne
  // chybu geometrie. `ts.rowHeights.header` uvnitř `Math.max` je tu mrtvá
  // větev (`headerRowWithChip`), protože pilulka je vždycky vyšší než Řádek 1
  // bez ní — zaokrouhlení skutečného zdroje odchylky je právě u `spec2`.
  const ROUNDING_TOLERANCE_PX = 0.5;
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    for (let h = ts.thresholds.full; h <= 200; h += 0.5) {
      for (const specRows of [0, 1, 2] as const) {
        const printDone = printDoneSize(h, ts);
        const fits = splitChipFitsInHeaderRow(h, printDone, specRows, ts);
        if (!fits) continue;

        const numHeight = ts.num * 1.2;
        const descHeight = ts.desc * 1.3;
        const pillBoxHeight = 2 + 6 + ts.splitChip * 1.1;
        const row1 = 8 + Math.max(numHeight, descHeight, pillBoxHeight);

        const specBoxHeight = specRows === 0 ? 0 : (0 + 3) + (2 + 2) + ts.spec * 1.3 * (specRows === 2 ? 2 : 1);

        const barReserve = printDone?.variant === "bar" ? printDone.height + 7 : 0;

        assert.ok(
          row1 + specBoxHeight + barReserve <= h + ROUNDING_TOLERANCE_PX,
          `${key} @ ${h}px specRows=${specRows}: fits=true, ale nezávislý model (řádek1 ${row1.toFixed(2)} + spec ${specBoxHeight.toFixed(2)} + pruh ${barReserve}) přerůstá kartu (${h}px)`
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

// ── specBandFits (task 5b, část B) ───────────────────────────────────────────
// U tiskaře `hasSpecBand` (BlockCard.tsx) donedávna kontrolu vejití záměrně
// obcházela — pás specifikace se ukázal vždycky, když bylo `showSpec` true,
// bez ohledu na to, jestli po Řádku 1 a pásu zbylo místo na tlačítko Hotovo.
// U ZAKÁZKY s vyplněnou specifikací proto uměl být pruh „Hotovo" oříznutý.

test("specBandFits: M @ 80 px (spodní hranice showSpec) — pás nezůstane celý, tlačítko by se ořízlo", () => {
  const m = plannerTypeScale("M");
  // rozpočet: řádek 1 (24) + pás 2řádkový (34) + pruh (24+7) = 89 > 80
  assert.equal(specBandFits(80, printDoneSize(80, m), 2, m), false);
});

test("specBandFits: M @ 89 px — přesně na hranici, pás i pruh se vejdou", () => {
  const m = plannerTypeScale("M");
  assert.equal(specBandFits(89, printDoneSize(89, m), 2, m), true);
  assert.equal(specBandFits(88, printDoneSize(88, m), 2, m), false);
});

test("specBandFits: bez tlačítka Hotovo (mimo tiskaře) stačí i nižší karta", () => {
  const m = plannerTypeScale("M");
  // stejný rozpočet bez barReserve: řádek 1 (24) + pás (34) = 58
  assert.equal(specBandFits(58, null, 2, m), true);
  assert.equal(specBandFits(57, null, 2, m), false);
});

test("specBandFits: sweep 0–220 px po 0,5 px — nezávislý geometrický model ze SpecBand.tsx/BlockCard.tsx, M/L/XL, specRows 1 i 2", () => {
  // Stejný vzor jako fuzz test `splitChipFitsInHeaderRow` výš: geometrie
  // poskládaná NEZÁVISLE přímo z komponent, ne přes `ts.rowHeights`:
  //   - Řádek 1 (`BlockCard.tsx`, paddingTop 5 + paddingBottom 3 = 8) +
  //     jednořádkové číslo/popis (`ts.num × 1,2` / `ts.desc × 1,3`) — jen
  //     jednořádkový popis, viz výhrada v docstringu `specBandFits`.
  //   - Pás specifikace (`SpecBand.tsx`): vnější `padding: "0 6px 3px"` (0+3
  //     svisle) + vnitřní `padding: "2px 6px"` (2+2 svisle) + `ts.spec × 1,3 ×
  //     počet řádků`. Review 12. 8. 2026: číslo ze zadání (task-5b-brief.md,
  //     část B) vzniklo z modelu, který `padding-bottom: 3px` vynechal — proto
  //     vycházelo užší, chybné pásmo, než jaké `specBandFits` doopravdy chrání.
  //   - Pruh Hotovo: `printDone.height` + `BlockCard.tsx` padding "2px 7px 5px"
  //     (top 2 + bottom 5 = 7, číselně `PRINT_BAR_PADDING_PX`).
  //
  // Tolerance kryje zbytkovou, drobnou optimističnost `ts.rowHeights.header`/
  // `.spec2` proti tomuhle nezaokrouhlenému modelu (review 12. 8. 2026: celkem
  // 0,50 / 0,56 / 0,64 px na M/L/XL) — NE chybu geometrie.
  const TOLERANCE_PX = 0.7;
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    for (let h = 0; h <= 220; h += 0.5) {
      for (const specRows of [1, 2] as const) {
        const printDone = printDoneSize(h, ts);
        const fits = specBandFits(h, printDone, specRows, ts);
        if (!fits) continue;

        const row1 = 8 + Math.max(ts.num * 1.2, ts.desc * 1.3);
        const specBox = (0 + 3) + (2 + 2) + ts.spec * 1.3 * specRows;
        const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;

        assert.ok(
          row1 + specBox + barReserve <= h + TOLERANCE_PX,
          `${key} @ ${h}px specRows=${specRows}: fits=true, ale nezávislý model (řádek1 ${row1.toFixed(2)} + pás ${specBox.toFixed(2)} + pruh ${barReserve}) přerůstá kartu (${h}px)`
        );
      }
    }
  }
});

// ── tiskarDescClampsToOneLine / descLineClampFor (task 5d) ──────────────────
// Rozhodnutí majitele 12. 8. 2026: u tiskaře s pásem specifikace NA ZAKÁZCE
// (pruh Hotovo se kreslí jen pro ni) ustupuje POPIS (na 1 řádek), ne pás.
// Tím se jednořádkový předpoklad, na kterém `specBandFits` počítá Řádek 1,
// mění z NADĚJE na VYNUCENÝ kontrakt.

test("tiskarDescClampsToOneLine: omezuje jen ZAKÁZKU u tiskaře S vykresleným pásem specifikace", () => {
  assert.equal(tiskarDescClampsToOneLine(true, true, "ZAKAZKA"), true, "tiskař + pás + ZAKAZKA → omezit na 1 řádek");
  assert.equal(tiskarDescClampsToOneLine(true, false, "ZAKAZKA"), false, "tiskař bez pásu → normální počet řádků, nic se neomezuje");
  assert.equal(tiskarDescClampsToOneLine(false, true, "ZAKAZKA"), false, "plánovač (ne-tiskař) s pásem → nedotčeno, `specFitsBand` má vlastní, VĚDOMĚ neopravenou mezeru");
  assert.equal(tiskarDescClampsToOneLine(undefined, true, "ZAKAZKA"), false, "isTiskar undefined (BlockCard bez role) → nedotčeno, stejně jako false");
  // Review 12. 8. 2026, nález 4: pruh Hotovo se kreslí jen pro ZAKAZKA — u
  // REZERVACE/UDRZBA není co chránit, omezení popisu by tam bylo bez důvodu.
  assert.equal(tiskarDescClampsToOneLine(true, true, "REZERVACE"), false, "REZERVACE s pásem → NEomezuje se, tlačítko Hotovo se pro ni nekreslí");
  assert.equal(tiskarDescClampsToOneLine(true, true, "UDRZBA"), false, "UDRZBA s pásem → NEomezuje se, tlačítko Hotovo se pro ni nekreslí");
});

test("descLineClampFor: mimo tiskaře/pás se chová jako starý inline vzorec z BlockCard.tsx", () => {
  const m = plannerTypeScale("M");
  // Pod thresholds.full × 1,4 (M 64,4 px) vždy 1 řádek.
  assert.equal(descLineClampFor(64, m, { isTiskar: false, hasSpecBand: false, blockType: "ZAKAZKA" }), 1);
  // Nad tím roste starým vzorcem — 107 px na M dává podle historie testu 3 (task 6 report).
  assert.equal(descLineClampFor(107, m, { isTiskar: false, hasSpecBand: false, blockType: "ZAKAZKA" }), 3);
  // Tiskař BEZ pásu (hasSpecBand false) se chová stejně jako plánovač — omezení
  // se váže na `hasSpecBand`, ne na roli samotnou.
  assert.equal(descLineClampFor(107, m, { isTiskar: true, hasSpecBand: false, blockType: "ZAKAZKA" }), 3);
});

test("descLineClampFor: tiskař + pás + ZAKAZKA vynucuje 1 i tam, kde by starý vzorec dal víc", () => {
  const m = plannerTypeScale("M");
  // 107 px dává BEZ vynucení 3 řádky (test výš) — S vynucením (hasSpecBand true,
  // ZAKAZKA) musí zůstat 1, bez ohledu na to, kolik by se řádků jinak vešlo.
  assert.equal(descLineClampFor(107, m, { isTiskar: true, hasSpecBand: true, blockType: "ZAKAZKA" }), 1);
  // Review nález 4: REZERVACE/UDRZBA se specifikací NEJSOU omezené — pruh
  // Hotovo se pro ně nekreslí, takže není co chránit.
  assert.equal(descLineClampFor(107, m, { isTiskar: true, hasSpecBand: true, blockType: "REZERVACE" }), 3, "REZERVACE: descLineClampFor se chová jako bez pásu");
  assert.equal(descLineClampFor(107, m, { isTiskar: true, hasSpecBand: true, blockType: "UDRZBA" }), 3, "UDRZBA: descLineClampFor se chová jako bez pásu");
});

test("STRÁŽNÝ TEST 5d — mezera „specBandFits předpokládá jednořádkový popis“ je u tiskaře uzavřená ve VŠECH kombinacích, ne jen posunutá (sweep 0–220 px po 0,5 px, M/L/XL, specRows 1 i 2)", () => {
  // Dokládá, že oprava mezeru DOOPRAVDY zavírá, ne že ji jen posouvá — a dělá
  // to přes SKUTEČNĚ exportovanou `descLineClampFor` (ne přes ruční kopii
  // vzorce v testu, viz review 12. 8. 2026, nález 1: dřívější extrakce jen
  // booleovského rozhodnutí nechytila smazání volání v `BlockCard.tsx`):
  // 1) `oldClamp` = `descLineClampFor` s `hasSpecBand: false` — stejná
  //    hodnota, jakou by (mimo pás) vrátil PŮVODNÍ inline vzorec z
  //    `BlockCard.tsx` (před task 5d), protože vynucovací větev se bez pásu
  //    nikdy nespustí. Ukazuje, že v pásmu, kde `specBandFits` vrátí `true`,
  //    by BEZ opravy vyšlo >= 2 řádky — přesně zdokumentovaná mezera z
  //    docstringu `specBandFits` (task 5b).
  // 2) `actualClamp` = `descLineClampFor` s `hasSpecBand` z reálného
  //    `specBandFits` — musí vyjít `1`.
  // 3) s `actualClamp` přepočítá nezávislý geometrický model (stejný jako
  //    `specBandFits: sweep…` výš) a ověří, že se pruh Hotovo doopravdy vejde
  //    — beze zbytku, ne jen "líp než dřív".
  //
  // Pokud by tenhle test spadl, znamená to buď že `descLineClampFor` přestala
  // pásmo pokrývat, nebo že i s vynuceným 1 řádkem přetéká — obojí by
  // znamenalo, že mezera z reportu 5b zůstala otevřená (nebo se jen posunula).
  const TOLERANCE_PX = 0.7; // stejná tolerance a stejný důvod jako `specBandFits: sweep…` výš

  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    let sawOldMultilineInSpecBandZone = false;

    for (let h = ts.thresholds.full; h <= 220; h += 0.5) {
      const printDone = printDoneSize(h, ts);
      for (const specRows of [1, 2] as const) {
        const hasSpecBandNow = specBandFits(h, printDone, specRows, ts);
        if (!hasSpecBandNow) continue;

        const oldClamp = descLineClampFor(h, ts, { isTiskar: true, hasSpecBand: false, blockType: "ZAKAZKA" });
        if (oldClamp >= 2) sawOldMultilineInSpecBandZone = true;

        // 2) oprava pásmo doopravdy pokrývá
        const actualClamp = descLineClampFor(h, ts, { isTiskar: true, hasSpecBand: hasSpecBandNow, blockType: "ZAKAZKA" });
        assert.equal(
          actualClamp, 1,
          `${key} @ ${h}px specRows=${specRows}: hasSpecBand=true, ale descLineClampFor nevynucuje 1 řádek (vrátila ${actualClamp})`
        );

        // 3) s vynuceným řádkem se tlačítko doopravdy vejde
        const row1 = 8 + Math.max(ts.num * 1.2, ts.desc * 1.3 * actualClamp);
        const specBox = (0 + 3) + (2 + 2) + ts.spec * 1.3 * specRows;
        const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
        assert.ok(
          row1 + specBox + barReserve <= h + TOLERANCE_PX,
          `${key} @ ${h}px specRows=${specRows}: i po opravě (actualClamp=${actualClamp}) nezávislý model (řádek1 ${row1.toFixed(2)} + pás ${specBox.toFixed(2)} + pruh ${barReserve}) přerůstá kartu (${h}px)`
        );
      }
    }

    // Sanitní kontrola testu samotného: pásmo, které oprava řeší, musí být
    // neprázdné — jinak by test 2)/3) výš procházel naprázdno a nic neověřil.
    assert.ok(
      sawOldMultilineInSpecBandZone,
      `${key}: sweep nenašel ŽÁDNOU výšku, kde by starý vzorec vracel >= 2 řádky uvnitř pásma s pásem specifikace — test by byl bezzubý`
    );
  }
});

// ── STRÁŽNÝ TEST — task 5b, část C ───────────────────────────────────────────
test("STRÁŽNÝ TEST 5b — tlačítko Hotovo se vždy vejde do karty (kromě schválené dolní meze 20 px u čtverce); v MODE_FULL nikdy square ani null (incident 3. 8. 2026)", () => {
  // Pro všechny tři stupně písma a výšky 0–200 px po 0,5 px ověřuje dvě věci:
  //
  // 1) printDoneSize buď vrátí null, nebo vrácený rozměr se do karty vejde —
  //    s JEDINOU vědomou výjimkou: dolní mez čtverce 20 px (rozhodnutí
  //    majitele, task 5b, 12. 8. 2026). Na velmi nízké kartě je přijatelnější
  //    mírný přesah než netrefitelný cíl — tlačítko se u stroje mačká prstem.
  //    Tohle NENÍ opomenutí, je to schválená výjimka, proto pojmenovaná
  //    konstantou a zdůvodněná v podmínce, ne mlčky povolená.
  //
  // 2) V pásmu, kde je karta v MODE_FULL (layoutHeight >= ts.thresholds.full),
  //    se nikdy nevrátí `square` ani `null` — jinak nemá tiskař na kartě VŮBEC
  //    žádné tlačítko k potvrzení tisku. Přesně tahle havárie nastala
  //    3. 8. 2026 (a znovu, v horší podobě, při opravě z 8/2026).
  const APPROVED_SQUARE_FLOOR_PX = 20;
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    for (let h = 0; h <= 200; h += 0.5) {
      const size = printDoneSize(h, ts);

      if (size?.variant === "bar") {
        assert.ok(
          size.height + ts.rowHeights.header + PRINT_BAR_PADDING_PX <= h,
          `${key} @ ${h}px: pruh (${size.height}) se nevejde pod první řádek`
        );
        // Koeficient písma pruhu 40 px MUSÍ jít přes `ts.fontFactor` — review
        // 12. 8. 2026 vsadil devět mutací do produkčního kódu a záměna
        // `fontFactor`/`slotFactor` (jmenovaná třída chyby projektu, viz
        // `plannerTypography.ts`) prošla beze změny přes celou dřívější sadu,
        // protože žádná aserce mimo M (kde je `fontFactor` roven jedné) na
        // `fontSize` nesahala.
        if (size.height === 40) {
          assert.equal(size.fontSize, Math.round(16 * ts.fontFactor), `${key} @ ${h}px: fontSize pruhu 40 px`);
        }
      } else if (size?.variant === "square") {
        const fits = size.height <= h - 2;
        assert.ok(
          fits || size.height === APPROVED_SQUARE_FLOOR_PX,
          `${key} @ ${h}px: čtverec (${size.height}) se nevejde a není na schválené dolní mezi ${APPROVED_SQUARE_FLOOR_PX}px`
        );
        // Dolní mez je POVINNÁ, ne jen povolená — bez týhle aserce by zrušení
        // `Math.max(20, …)` v implementaci propadlo beze stopy (na 14 px by
        // čtverec spadl na 12 px, přesně netrefitelný cíl, který majitel
        // odmítl) a `fits` výš by ho i tak propustila (12 ≤ 12).
        assert.ok(
          size.height >= APPROVED_SQUARE_FLOOR_PX,
          `${key} @ ${h}px: čtverec (${size.height}) je POD schválenou dolní mezí ${APPROVED_SQUARE_FLOOR_PX}px`
        );
        // Koeficient písma čtverce MUSÍ růst s `size.height`, NE s `ts.fontFactor`
        // navíc — review 12. 8. 2026: mutace `fontSize: 15 * side / 26 *
        // ts.fontFactor` (záměna/duplicitní koeficient) prošla beze změny přes
        // celou dřívější sadu, protože žádná aserce na `fontSize` mimo dva body
        // na M (kde je `ts.fontFactor` roven jedné) nesahala.
        assert.equal(size.fontSize, 15 * size.height / 26, `${key} @ ${h}px: fontSize čtverce`);
      }

      if (h >= ts.thresholds.full) {
        assert.notEqual(size, null, `${key} @ ${h}px: MODE_FULL bez tlačítka Hotovo (null)`);
        assert.notEqual(size?.variant, "square", `${key} @ ${h}px: MODE_FULL vrátil square — v plném layoutu se square nekreslí`);
      }
    }
  }
});

// ── STRÁŽNÝ TEST — task 5c review ────────────────────────────────────────────
test("STRÁŽNÝ TEST 5c — printDoneSize na hranici MIN_CARD_CONTENT_HEIGHT_PX nikdy nepřeroste svůj vlastní box, pro všechny tři stupně písma", () => {
  // `MIN_CARD_CONTENT_HEIGHT_PX` je od task 5c (12. 8. 2026, review) JEDINÝ export
  // sdílený mezi dolní mezí čtverce tady (`printDoneSize`) a podlahou `layoutHeight`
  // v `BlockCard.tsx` (`clampedHeight`/`clampedContentHeight`) — dřív dva nezávislé
  // literály `20`, které se kryly jen náhodou. Tenhle test ověřuje PŘESNĚ tu vazbu:
  // když BlockCard podlahuje kartu/segment na `MIN_CARD_CONTENT_HEIGHT_PX`, tlačítko,
  // které `printDoneSize` pro tuhle výšku vrátí, se do ní musí vejít (`<=`), ne jen
  // "skoro". Kdyby někdo zítra zvedl dolní mez čtverce (např. `Math.max(24, …)` kvůli
  // stížnosti na dotykový cíl) bez úpravy na straně BlockCard, propadne se to tady —
  // přesně třída havárie z 3. 8. 2026 (karta bez viditelného tlačítka Hotovo).
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    const size = printDoneSize(MIN_CARD_CONTENT_HEIGHT_PX, ts);
    assert.notEqual(size, null, `${key}: MIN_CARD_CONTENT_HEIGHT_PX (${MIN_CARD_CONTENT_HEIGHT_PX}px) nesmí vrátit null — jinak by karta na schválené dolní mezi neměla vůbec žádné tlačítko`);
    assert.ok(
      size!.height <= MIN_CARD_CONTENT_HEIGHT_PX,
      `${key}: printDoneSize(${MIN_CARD_CONTENT_HEIGHT_PX}).height = ${size!.height} přerůstá vlastní podlahu ${MIN_CARD_CONTENT_HEIGHT_PX}px`
    );
  }
});

// ── STRÁŽNÝ TEST — task 9 (12. 8. 2026, závěrečná kontrola) ─────────────────
test("STRÁŽNÝ TEST 9 — fontSize dopočítaného nejnižšího stupně pruhu roste s písmem, na M se NIKDY nehne od 11.5, a nikdy nepřeroste vlastní pruh", () => {
  // Pásmo `layoutHeight ∈ [ts.thresholds.full; round(96×ts.slotFactor))` vracelo
  // do task 9 `fontSize: 11.5` NAPEVNO, zatímco sousední větve (32/40 px) rostou
  // přes `Math.round(N × ts.fontFactor)` — docstring funkce výš přitom bez
  // výhrady tvrdí, že popisek uvnitř bar varianty roste s písmem (nález review
  // 8/2026). PRVNÍ oprava (task 9) tuhle nesrovnalost odstranila stejným vzorem
  // jako sousední větve (`Math.round(11.5×fontFactor)` + strop `height-6`), ale
  // review 12. 8. 2026 doložilo dopočtem, že to na M SKUTEČNĚ mění chování proti
  // produkci (46px karta: 11.5 → 9) — celá etapa přitom stojí na tom, že se M
  // nehne. Finální vzorec (`11.5×fontFactor`, BEZ zaokrouhlení, strop
  // `height×0.8` místo `height-6`) je na M matematicky identita (viz assert
  // níž) — na L/XL/výš pořád roste s písmem, strop je jen obrana do hloubky
  // (nikde v dosažitelném oboru nesváže, ověřeno dopočtem, task-9-report.md).
  //
  // Sweep hlídá TŘI regrese, ke kterým by se dalo tiše vrátit:
  //   1) návrat k `Math.round`/pevné hodnotě (fontSize by na M přestal být
  //      přesně 11.5 — přesně tahle regrese prošla review 12. 8. 2026),
  //   2) zrušení/zpřísnění stropu `height×0.8` (popisek by na dopočítané výšce
  //      pruhu mohl přerůst svůj vlastní box, nebo by strop na M/L/XL svázal
  //      a fontSize by se nečekaně zmenšil),
  //   3) obecná ztráta růstu s `ts.fontFactor` na L/XL.
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    const mid = Math.round(96 * ts.slotFactor);
    let sawBand = false;
    for (let h = ts.thresholds.full; h < mid; h += 0.5) {
      const size = printDoneSize(h, ts);
      assert.equal(size?.variant, "bar", `${key} @ ${h}px: očekávaná varianta "bar" v pásmu dopočítaného pruhu`);
      if (size?.variant !== "bar") continue;
      sawBand = true;

      const expected = Math.min(11.5 * ts.fontFactor, size.height * 0.8);
      assert.equal(size.fontSize, expected, `${key} @ ${h}px: fontSize dopočítaného pruhu neodpovídá min(11.5×fontFactor, height×0.8)`);

      assert.ok(
        size.fontSize <= size.height * 0.8,
        `${key} @ ${h}px: popisek (${size.fontSize}) nemá rezervu do vlastního pruhu (${size.height})`
      );

      if (key === "M") {
        // MUTAČNÍ POJISTKA (review 12. 8. 2026): na M musí zůstat PŘESNĚ 11.5
        // napříč CELÝM pásmem, beze změny proti produkci před etapou.
        assert.equal(size.fontSize, 11.5, `M @ ${h}px: fontSize dopočítaného pruhu se odchýlil od 11.5 — regrese proti dnešní produkci`);
      }
    }
    // Sanitní kontrola testu samotného: pásmo nesmí být prázdné, jinak sweep
    // výš neověřil nic (stejný vzor jako sanitní kontroly u jiných testů výš).
    assert.ok(sawBand, `${key}: sweep nenašel žádnou výšku v pásmu dopočítaného pruhu — test by byl bezzubý`);
  }
});
