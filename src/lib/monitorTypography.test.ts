import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { monitorTypeScale, MONITOR_HERO_BUTTON_HEIGHT, type MonitorTypeScale } from "./monitorTypography.js";
import { PLANNER_FONT_SCALES, PLANNER_FONT_SCALE_KEYS } from "./plannerTypography.js";

/** Číselné klíče škály — porovnávají se napříč stupni. */
function numericEntries(ts: MonitorTypeScale): [string, number][] {
  return Object.entries(ts).filter(([, v]) => typeof v === "number") as [string, number][];
}

test("monitorTypeScale('M') drží dnešní velikosti Monitoru — stupeň M nesmí nic přemalovat", () => {
  const m = monitorTypeScale("M");
  assert.equal(m.heroOrder, 46);
  assert.equal(m.heroDesc, 24);
  assert.equal(m.heroSpec, 17);
  assert.equal(m.queueOrder, 14);
  assert.equal(m.queueDesc, 13);
  assert.equal(m.queueTime, 13);
  assert.equal(m.sectionTitle, 11);
  assert.equal(m.btnDone, 30);
});

test("monitorTypeScale: každý stupeň roste, žádná velikost se s vyšším stupněm nezmenší", () => {
  const m = monitorTypeScale("M");
  const l = monitorTypeScale("L");
  const xl = monitorTypeScale("XL");
  for (const [key, mv] of numericEntries(m)) {
    if (key === "fontFactor") continue;
    const lv = (l as unknown as Record<string, number>)[key];
    const xlv = (xl as unknown as Record<string, number>)[key];
    assert.ok(lv >= mv, `${key}: L (${lv}) je menší než M (${mv})`);
    assert.ok(xlv >= lv, `${key}: XL (${xlv}) je menší než L (${lv})`);
  }
  assert.ok(xl.heroOrder > m.heroOrder, "XL musí být znatelně větší než M");
  assert.ok(xl.queueOrder > m.queueOrder, "fronta musí růst taky — to je jádro prosby tiskařů");
});

test("monitorTypeScale: žádná velikost neklesne pod 10 px (podlaha čitelnosti)", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    for (const [name, v] of numericEntries(monitorTypeScale(key))) {
      if (name === "fontFactor") continue;
      assert.ok(v >= 10, `${key}.${name} = ${v} px je pod podlahou 10 px`);
    }
  }
});

test("monitorTypeScale: fontFactor odpovídá stupňům planneru — Monitor a plán sdílejí jedno nastavení", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    assert.equal(monitorTypeScale(key).fontFactor, PLANNER_FONT_SCALES[key]);
  }
});

test("monitorTypeScale: písmo tlačítka HOTOVO se i v XL vejde do jeho pevné výšky", () => {
  // Tlačítko je jediná cesta, kterou tiskař odklepne tisk, a jeho výška je pevná
  // (dotykový cíl). Kdyby písmo přerostlo, popisek se ořízne — táž třída vady
  // jako havárie rozpočtů karty 3. a 12. 8. 2026.
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const ts = monitorTypeScale(key);
    for (const [name, v] of [
      ["btnDone", ts.btnDone], ["btnNext", ts.btnNext],
      ["btnRevert", ts.btnRevert], ["btnSkip", ts.btnSkip],
    ] as const) {
      assert.ok(
        v * 1.25 <= MONITOR_HERO_BUTTON_HEIGHT * 0.75,
        `${key}.${name} = ${v} px se nevejde do tlačítka ${MONITOR_HERO_BUTTON_HEIGHT} px`
      );
    }
  }
});

const MONITOR_FILES = [
  "src/components/monitor/MonitorView.tsx",
  "src/components/monitor/MonitorQueue.tsx",
  "src/components/monitor/MonitorChips.tsx",
  "src/components/monitor/MonitorHeroTiming.tsx",
];

test("v komponentách Monitoru nezůstal žádný natvrdo zapsaný fontSize", () => {
  // Obdoba pravidla `plannerTypeScale` pro plán a `reportTokens` pro reporty:
  // velikost, která se nedrží škály, s přepínačem M/L/XL neporoste a tiskaři
  // zůstane drobná přesně ta část obrazovky, na kterou se zapomnělo.
  for (const f of MONITOR_FILES) {
    const src = readFileSync(join(process.cwd(), f), "utf8");
    const hits = src.split("\n")
      .map((line, i) => [i + 1, line] as const)
      .filter(([, line]) => /fontSize:\s*\d/.test(line));
    assert.deepEqual(
      hits.map(([n, line]) => `${f}:${n} ${line.trim()}`),
      [],
      "fontSize musí jít z monitorTypeScale, ne z holého čísla"
    );
  }
});
