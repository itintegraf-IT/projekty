import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseColor, contrastRatio, mixOklab, simulateCvd, oklabDistance, type Rgb,
} from "./contrast";
import { reportTypeScale, reportGlyph, reportRadius, reportSpace, pipelineToneFor, heatToneFor } from "./reportTokens";
import { RESERVATION_STATUSES } from "./reservationStatus";

/**
 * Komentáře se ZAHAZUJÍ dřív, než se cokoliv hledá. Bez toho platilo, že
 * dočasně zakomentovaná deklarace („/* --status-bad: #ff0000; *\/") vyhraje
 * jako poslední výskyt a test měří barvu, která na stránce vůbec není — a to
 * oběma směry, umí chybu vyrobit i zamaskovat.
 */
const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Vytáhne hodnotu tokenu ze SKUTEČNÉHO globals.css. Test nesmí mít vlastní
 * kopii hodnot — jinak hlídá sám sebe a token se může v CSS tiše rozejít.
 *
 * Světlá větev = vše před `.dark {`, tmavá = blok `.dark { … }`. Je to hrubé
 * dělení: cokoliv za `.dark {` se počítá jako tmavé, včetně případných bloků
 * `:root:not(.dark)` na konci souboru. Dnes tam žádná deklarace tokenu není a
 * hlídá to test „dělení na větve odpovídá skutečné struktuře souboru" níž.
 */
function tokenValue(name: string, mode: "light" | "dark"): string {
  const darkAt = CSS.indexOf(".dark {");
  assert.ok(darkAt > 0, "globals.css musí obsahovat blok .dark");
  const scope = mode === "light" ? CSS.slice(0, darkAt) : CSS.slice(darkAt);
  const hits = [...scope.matchAll(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, "gm"))];
  assert.ok(hits.length > 0, `token --${name} chybí ve větvi ${mode}`);
  // Poslední výskyt vyhrává, stejně jako v kaskádě.
  return hits[hits.length - 1][1].trim();
}

/** Rozřeší i `var(--x)` alias (jeden krok stačí, hlubší řetěz v CSS není). */
function tokenColor(name: string, mode: "light" | "dark"): Rgb {
  const raw = tokenValue(name, mode);
  const alias = /^var\(--([\w-]+)\)$/.exec(raw);
  const value = alias ? tokenValue(alias[1], mode) : raw;
  const rgb = parseColor(value);
  assert.ok(rgb, `token --${name} (${mode}) má nečitelnou hodnotu: ${value}`);
  return rgb;
}

/** Všechny `.ts`/`.tsx` pod zadanou složkou, rekurzivně. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Kde všude report žije. `src/components/report/` přibylo v R3 se stavovým
 * pásem — a kdyby zůstalo mimo záběr, detektory by o něm mlčely a přitom by
 * dál tvrdily „v /reporty nic není". Složky se PROCHÁZEJÍ (`sourceFiles` jde
 * i do podsložek), soubory se nevypisují.
 */
const REPORT_DIRS = ["src/app/reporty", "src/components/report"];

/** Zahodí komentáře, ať detektory nehlásí text vysvětlivek jako kód. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Vlastnosti, jejichž hodnota patří na některou ze škál `reportTokens` —
 * nebo aspoň na pojmenovanou konstantu, aby číslo mělo význam.
 *
 * Rozsah se v R4a rozšířil z původní trojice `fontSize`/`borderRadius`/`padding`.
 * Bez toho detektor slíbil „v /reporty nezůstala žádná holá velikost ani
 * odsazení" a přitom mlčel k `marginTop: 10`, `gap: 12`, `height: 12` i
 * `width: "148px"` — tedy ke čtyřem z pěti stylových řádků nové sekce.
 *
 * `paddingTop`/`paddingBottom` a spol. ZÁMĚRNĚ chybí dál: mají v repu vlastní
 * roli (dorovnání optického středu) a předstírat, že sedí na škálu odsazení,
 * by bylo horší než mlčet. Naproti tomu `marginTop` je odsazení jako každé jiné.
 */
const DIM_PROP = new RegExp(
  "\\b(?:fontSize|borderRadius|padding"
  + "|margin|marginTop|marginRight|marginBottom|marginLeft"
  + "|gap|rowGap|columnGap"
  + "|width|minWidth|maxWidth|height|minHeight|maxHeight"
  + "|top|left|right|bottom)"
  + "\\s*:\\s*(-?\\d[\\d.]*|\"[^\"\\n]*\"|'[^'\\n]*'|`[^`\\n]*`)",
  "g",
);

/** Jednotky, které NEJSOU pixelovou škálou — relativní a viewportové. */
const RELATIVE_UNIT = /(?:%|vmin|vmax|vh|vw|rem|em|ch|fr)$/;

/**
 * Holé rozměry v jednom kusu zdroje. Vrací celé nalezené zápisy, ať je v hlášce
 * vidět, co přesně se má převést na škálu.
 *
 * Řetězcový zápis se hlídá stejně jako holé číslo: v React inline stylech je
 * `padding: "13px 17px"` úplně běžný a s dřívějším vzorcem (číslice MUSELA stát
 * hned za dvojtečkou) prošel. Nebyla to teorie — dřívější commit přepsal
 * `padding: 0` na `padding: "0"` a jediné, co tím získal, bylo projít vlastním
 * detektorem.
 *
 * Projde (a NESMÍ se hlásit):
 *  - `padding: \`${reportSpace.md}px ${reportSpace.lg}px\`` — interpolace se
 *    zahazují, zbylé `px px` už žádné číslo nenese;
 *  - `padding: "0"`, `padding: 0` a `padding: \`0 ${reportSpace.md}px\`` — nula
 *    není krok škály, je to reset, a nutit pro ni uvozovky byl vždycky nesmysl;
 *  - `borderRadius: "50%"`, `height: "100%"`, `minHeight: "100vh"` — relativní
 *    a viewportové jednotky nejsou kroky PIXELOVÉ škály a `reportSpace` je
 *    vyjádřit neumí.
 */
function bareDimensionHits(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(DIM_PROP)) {
    const raw = m[1];
    if (/^-?\d/.test(raw)) {
      if (!/^-?0(?:\.0+)?$/.test(raw)) out.push(m[0].trim());
      continue;
    }
    const inner = raw.slice(1, -1).replace(/\$\{[^}]*\}/g, "");
    const numbers = inner.match(/\d+(?:\.\d+)?(?:%|vmin|vmax|vh|vw|rem|em|ch|fr)?/g) ?? [];
    if (numbers.some((n) => !RELATIVE_UNIT.test(n) && Number(n) !== 0)) out.push(m[0].trim());
  }
  return out;
}

/**
 * DLUH: holé rozměry, které v /reporty stály UŽ PŘED tím, než se detektor v R4a
 * rozšířil z trojice `fontSize`/`borderRadius`/`padding` na odsazení a geometrii.
 *
 * Není to výjimka ani vypnutý detektor — je to ROHATKA. Test níž porovnává celou
 * mapu na rovnost, takže:
 *  - nový soubor v /reporty musí začít na NULE (v mapě není → nesmí mít nález),
 *  - existujícímu smí počet jedině klesnout, a kdo ho sníží, sníží i číslo tady.
 *
 * Proč se dluh nesplatil rovnou: většina těch hodnot na škále `reportSpace`
 * (4/8/12/16/24) neleží ani přibližně (`gap: 1`, `gap: 13`, `minWidth: 520`,
 * `height: 80`) a část z nich vůbec není odsazení, ale geometrie kresby, pro
 * kterou v `reportTokens` škála neexistuje. Srovnat je znamená přeměřit vzhled
 * celé stránky — vlastní etapa, ne přílepek k sekci Využití kalendáře.
 */
const DIMENSION_DEBT: Record<string, number> = {
  "src/app/reporty/_components/CheckExplainer.tsx": 2,
  "src/app/reporty/_components/HealthPanel.tsx": 27,
  "src/app/reporty/_components/IntegrityRow.tsx": 8,
  "src/app/reporty/_components/KpiCard.tsx": 2,
  "src/app/reporty/_components/OutlookView.tsx": 25,
  "src/app/reporty/_components/PlanningSection.tsx": 2,
  "src/app/reporty/_components/ReportDashboard.tsx": 13,
  "src/app/reporty/_components/RetroView.tsx": 20,
  "src/components/report/AttentionBand.tsx": 8,
};

/**
 * Pojmenované barvy, které se v repu reálně píšou. Seznam je krátký schválně:
 * hlídá se jím jen nitro `color-mix()`, kde barva stojí BEZ uvozovek a ostatní
 * pravidla ji minou.
 */
const NAMED_COLOR = "white|black|red|green|blue|orange|yellow|grey|gray|purple|pink|brown|cyan|magenta|teal|navy|gold|lime|olive|maroon|aqua|fuchsia|violet|indigo";

/**
 * Vrátí argumenty každého `color-mix(` ve zdroji, se správně spárovanými
 * závorkami — `var(--x)` uvnitř nesmí volání předčasně ukončit.
 */
function colorMixArgs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/color-mix\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
    }
    out.push(src.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

/**
 * Barevné literály v jednom kusu zdroje.
 *
 * Do R4a detektor znal jen hex, `rgb()`/`hsl()` a pojmenovanou barvu v uvozovkách.
 * Chyběla mu přitom ta NEJPRAVDĚPODOBNĚJŠÍ vada: `globals.css` je celý zapsaný
 * v `oklch()`, takže nejpřirozenější způsob, jak se minout s tokenem, je zkopírovat
 * si jeho hodnotu — `background: "oklch(0.62 0.16 262)"` prošlo bez hlesnutí.
 *
 * `oklch(`/`oklab(`/`lab(`/`lch(`/`hwb(`/`color(` je vždycky literál: token se
 * odkazuje `var(--…)`. Uvnitř `color-mix()` se navíc hlídá pojmenovaná barva bez
 * uvozovek, protože `color-mix(in oklab, red 20%, transparent)` by jinak prošlo.
 *
 * Legitimní zápis `color-mix(in oklab, var(--brand) 22%, transparent)` projít
 * MUSÍ — `in oklab` není volání funkce a `transparent`/`currentColor` nejsou
 * literální barvy, ale klíčová slova bez vlastní hodnoty.
 */
function colorLiteralHits(src: string): string[] {
  const clean = stripComments(src);
  const out = [
    ...clean.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
    ...clean.matchAll(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/g),
    ...clean.matchAll(new RegExp(`["'\`](?:${NAMED_COLOR})["'\`]`, "g")),
  ].map((h) => h[0]);
  const bareNamed = new RegExp(`(?:^|[^\\w-])(${NAMED_COLOR})(?![\\w-])`);
  for (const args of colorMixArgs(clean)) {
    const hit = bareNamed.exec(args);
    if (hit) out.push(`color-mix(… ${hit[1]} …)`);
  }
  return out;
}

const MODES = ["light", "dark"] as const;
/** Podklady, na kterých text reálně stojí. --surface-3 je jen výplň, ne pozadí textu. */
const TEXT_BACKDROPS = ["surface", "bg", "surface-2"] as const;

describe("tokeny — text splňuje AA na každém podkladu, kde se vyskytuje", () => {
  // --info/--danger/--success tu ZÁMĚRNĚ nejsou: ve světlém režimu AA nesplňují
  // (3,42 / 2,78 / 4,07 : 1 na --surface-2) a opravit je znamená sáhnout na
  // celou aplikaci, ne na report. Fakt je zapsaný níž v „pojistkách".
  const textTokens = [
    "brand-text", "status-bad", "status-ok", "status-warn", "status-idle",
    "type-zakazka", "type-rezervace", "type-udrzba", "warning-text",
  ];
  for (const mode of MODES) {
    for (const name of textTokens) {
      it(`--${name} (${mode}) ≥ 4,5:1`, () => {
        const fg = tokenColor(name, mode);
        for (const bgName of TEXT_BACKDROPS) {
          // --bg je alias na --background, tokenColor si ho rozřeší.
          const bg = tokenColor(bgName === "bg" ? "background" : bgName, mode);
          const ratio = contrastRatio(fg, bg);
          assert.ok(ratio >= 4.5, `--${name} na --${bgName} (${mode}) = ${ratio.toFixed(2)}:1`);
        }
      });
    }
  }
});

describe("tokeny — číslo na syté výplni dlaždice", () => {
  for (const mode of MODES) {
    for (const name of ["status-bad", "status-ok", "status-warn", "status-idle"]) {
      it(`${name} (${mode}): --status-on je čitelný ≥ 4,5:1`, () => {
        const ratio = contrastRatio(tokenColor(name, mode), tokenColor("status-on", mode));
        assert.ok(ratio >= 4.5, `${name}/${mode} = ${ratio.toFixed(2)}:1`);
      });
    }
  }
});

describe("tokeny — pilulka color-mix(token 22 %, transparent)", () => {
  // `transparent` nad kartou se chová jako karta sama.
  for (const mode of MODES) {
    for (const name of ["type-zakazka", "type-rezervace", "type-udrzba"]) {
      it(`--${name} (${mode}) je čitelný na vlastním 22% tónu`, () => {
        const fg = tokenColor(name, mode);
        const pill = mixOklab(fg, tokenColor("surface", mode), 0.22);
        const ratio = contrastRatio(fg, pill);
        assert.ok(ratio >= 4.5, `--${name} (${mode}) na pilulce = ${ratio.toFixed(2)}:1`);
      });
    }
  }
});

describe("tokeny — série grafu", () => {
  for (const mode of MODES) {
    it(`série (${mode}) jsou vidět proti kartě ≥ 3:1 (WCAG 1.4.11)`, () => {
      const card = tokenColor("surface", mode);
      for (const name of ["series-a", "series-b"]) {
        const ratio = contrastRatio(tokenColor(name, mode), card);
        assert.ok(ratio >= 3, `--${name} (${mode}) vůči kartě = ${ratio.toFixed(2)}:1`);
      }
    });

    it(`série (${mode}) jdou od sebe rozlišit i při barvosleposti`, () => {
      const a = tokenColor("series-a", mode);
      const b = tokenColor("series-b", mode);
      for (const kind of ["deuteranopia", "protanopia"] as const) {
        const d = oklabDistance(simulateCvd(a, kind), simulateCvd(b, kind));
        assert.ok(d >= 0.12, `série při ${kind} (${mode}) = ΔOKLab ${d.toFixed(3)}`);
      }
    });
  }
});

describe("tokeny — pojistky proti tichému rozejití", () => {
  it("--brand ZŮSTÁVÁ nevhodný jako text ve světlém režimu", () => {
    // Tvrzení je záměrně obrácené: dokud platí, je v kódu zapsané, PROČ
    // --brand-text existuje. Kdyby někdo --brand ztmavil, spadne to a donutí
    // ho oba tokeny sjednotit vědomě, ne omylem.
    const ratio = contrastRatio(tokenColor("brand", "light"), tokenColor("surface", "light"));
    assert.ok(ratio < 4.5, `--brand ve světlém režimu už je ${ratio.toFixed(2)}:1 — sjednoť ho s --brand-text`);
  });

  it("v /reporty nezůstal žádný barevný literál", () => {
    // Složka se PROCHÁZÍ, neuvádí se seznamem: pevný výčet by sedmou komponentu
    // nikdy nezkontroloval, a přitom by test dál tvrdil „v /reporty nic není".
    // Komentáře se zahazují celé (`stripComments`), ne heuristikou „`//` do 60
    // znaků zpět" — ta v repu plném krátkých českých vysvětlivek nad stylovým
    // řádkem vypínala skoro každý nález, a stačil i `https://` na témž řádku.
    const offenders: string[] = [];
    for (const f of REPORT_DIRS.flatMap(sourceFiles)) {
      const hits = colorLiteralHits(readFileSync(join(process.cwd(), f), "utf8"));
      if (hits.length > 0) offenders.push(`${f}: ${[...new Set(hits)].join(", ")}`);
    }
    assert.deepEqual(offenders, [], "barvy v /reporty patří do tokenů");
  });

  it("detektor barev chytá i oklch a spol., ne jen hex a rgb", () => {
    // Vzorky jsou doslova ty, které dřívějším vzorcem prošly. `oklch(` je
    // z nich nejnebezpečnější: `globals.css` je v oklch celý, takže zkopírovat
    // hodnotu tokenu místo `var(--…)` je ta úplně nejpřirozenější chyba.
    const shouldCatch = [
      `<div style={{ background: "oklch(0.62 0.16 262)" }} />`,
      `<div style={{ background: "oklab(0.6 0.1 0.1)" }} />`,
      `<div style={{ color: "color(display-p3 1 0 0)" }} />`,
      `<div style={{ color: "lch(50% 40 30)" }} />`,
      `<div style={{ color: "hwb(120 10% 20%)" }} />`,
      `<div style={{ background: "color-mix(in oklab, red 20%, transparent)" }} />`,
      `<div style={{ background: "#3b82f6" }} />`,
      `<div style={{ background: "rgba(0,0,0,.4)" }} />`,
    ];
    for (const line of shouldCatch) {
      assert.ok(colorLiteralHits(line).length > 0, `neodhaleno: ${line}`);
    }
  });

  it("detektor barev propouští tokeny i legitimní color-mix", () => {
    // Druhá polovina téhož: detektor, který hlásí i správný zápis, se vypne.
    // `in oklab` NENÍ volání funkce a `transparent`/`currentColor` nejsou
    // literální barvy — je to týž zápis, jaký dnes stojí v HealthPanelu.
    const shouldPass = [
      `<div style={{ background: "color-mix(in oklab, var(--brand) 22%, transparent)" }} />`,
      `<div style={{ border: "1px solid color-mix(in oklab, var(--danger) 45%, var(--border))" }} />`,
      "<div style={{ background: `color-mix(in oklab, ${tone} 22%, transparent)` }} />",
      `<div style={{ background: "var(--surface-3)", color: "currentColor" }} />`,
      // Komentář s ukázkou literálu je text, ne kód.
      `// background: "oklch(0.62 0.16 262)" tady být nesmí`,
    ];
    for (const line of shouldPass) {
      assert.deepEqual(colorLiteralHits(line), [], `falešný poplach: ${line}`);
    }
  });

  it("v /reporty nezůstala v NOVÉM kódu žádná holá velikost ani odsazení", () => {
    // Táž pojistka jako u barev, jen pro rozměry: `fontSize`, `borderRadius`,
    // `padding`, `margin*`, `gap` patří na `reportTypeScale` / `reportRadius` /
    // `reportSpace`; `width`/`height`/`top`/`left`/`right`/`bottom` škálu nemají,
    // ale patří aspoň na pojmenovanou konstantu, ať číslo něco znamená.
    // Bez detektoru se škála udrží přesně do prvního „jen o dva pixely",
    // a report měl před R2/R3 dvanáct velikostí písma a devatenáct odsazení.
    //
    // Soubory, které měly holé rozměry UŽ PŘED rozšířením rozsahu (R4a), jsou
    // v `DIMENSION_DEBT` níž s přesným počtem. Nejde o výjimku, ale o rohatku:
    // nový soubor musí začít na nule a existujícímu smí počet jedině klesnout.
    const offenders: string[] = [];
    for (const f of REPORT_DIRS.flatMap(sourceFiles)) {
      if (f in DIMENSION_DEBT) continue;
      const hits = bareDimensionHits(readFileSync(join(process.cwd(), f), "utf8"));
      if (hits.length > 0) offenders.push(`${f}: ${[...new Set(hits)].join(", ")}`);
    }
    assert.deepEqual(offenders, [], "rozměry v /reporty patří na škály reportTokens");
  });

  it("holých rozměrů ve starém kódu smí jedině ubývat", () => {
    // Rohatka, ne výjimka. `deepEqual` nad celou mapou hlídá OBA směry:
    // přibylý nález spadne stejně jako ubylý, takže kdo dluh splatí, musí
    // číslo v mapě snížit (a kdo soubor vyčistí celý, řádek smazat).
    const actual: Record<string, number> = {};
    for (const f of REPORT_DIRS.flatMap(sourceFiles)) {
      const n = bareDimensionHits(readFileSync(join(process.cwd(), f), "utf8")).length;
      if (n > 0) actual[f] = n;
    }
    assert.deepEqual(actual, DIMENSION_DEBT, "uprav DIMENSION_DEBT — počet holých rozměrů se změnil");
  });

  it("detektor rozměrů se nedá obejít uvozovkou ani backtickem", () => {
    // Bez tohohle testu se detektor obejde znovu za měsíc: hlídá sám sebe jen
    // potud, pokud je zapsané, CO ještě chytit má. Vzorky jsou doslova ty, které
    // dřívějším vzorcem (číslice hned za dvojtečkou) prošly.
    const shouldCatch = [
      `<div style={{ padding: "13px 17px", fontSize: "9px", borderRadius: "4px" }} />`,
      "<div style={{ padding: `13px 17px` }} />",
      `<div style={{ padding: '5px' }} />`,
      // Doslova řádek, kterým se detektor obcházel do R4a: čtyři holé rozměry,
      // z nichž ani jeden nebyl v jeho rozsahu.
      `<div style={{ height: 12, marginTop: 10, gap: 12, width: "148px" }} />`,
      `<div style={{ marginLeft: 8, columnGap: 6, maxWidth: 420 }} />`,
      `<div style={{ position: "absolute", top: 3, right: 7 }} />`,
    ];
    for (const line of shouldCatch) {
      assert.ok(bareDimensionHits(line).length > 0, `neodhaleno: ${line}`);
    }
    // Vzorek nese VÍC vad než jednu — hláška musí vyjmenovat všechny, jinak se
    // opravují po jedné a test spadne pokaždé znovu.
    assert.equal(bareDimensionHits(shouldCatch[0]).length, 3);
    assert.equal(bareDimensionHits(shouldCatch[3]).length, 4);
    assert.equal(bareDimensionHits(shouldCatch[4]).length, 3);
    assert.equal(bareDimensionHits(shouldCatch[5]).length, 2);
  });

  it("detektor rozměrů propouští škálu, nulu i procenta", () => {
    // Druhá polovina téhož: detektor, který hlásí i legitimní zápis, se za
    // týden vypne celý.
    const shouldPass = [
      "<div style={{ padding: `${reportSpace.md}px ${reportSpace.lg}px` }} />",
      "<div style={{ padding: `0 ${reportSpace.md}px ${reportSpace.md}px` }} />",
      `<div style={{ padding: "0" }} />`,
      `<div style={{ borderRadius: "50%" }} />`,
      "<div style={{ fontSize: reportTypeScale.sm, borderRadius: reportRadius.lg }} />",
      // Nula je reset, ne krok škály — a nutit pro ni uvozovky byl vždycky nesmysl.
      `<div style={{ minWidth: 0, top: 0 }} />`,
      // Relativní a viewportové jednotky nejsou kroky PIXELOVÉ škály.
      `<div style={{ height: "100%", minHeight: "100vh", maxWidth: "40rem" }} />`,
      "<div style={{ width: `${pct}%`, gap: reportSpace.sm, marginTop: reportSpace.xl }} />",
      // `borderTop` ani `paddingBottom` nejsou `top`/`padding` — hranice slova drží.
      `<div style={{ borderTop: "1px solid var(--border)", paddingBottom: 4 }} />`,
      // Komentář s ukázkou holého rozměru je text, ne kód.
      `// padding: "13px 17px" tady být nesmí`,
    ];
    for (const line of shouldPass) {
      assert.deepEqual(bareDimensionHits(line), [], `falešný poplach: ${line}`);
    }
  });

  it("--brand se nikde v repu nepoužívá jako barva písma", () => {
    // Hlídá i planner a Monitor, ne jen /reporty — vada je táž.
    // `[^,;\n]*` uprostřed pokrývá i ternár, kde mezi dvojtečkou a hodnotou
    // stojí podmínka. Pozor: vzorec se schválně nedá vypsat v komentáři —
    // procházejí se i testy, takže by tenhle soubor hlásil sám sebe.
    const offenders = ["src/app", "src/components", "src/lib", "src/hooks"]
      .flatMap(sourceFiles)
      .filter((p) => /color:\s*[^,;\n]*["'`]var\(--brand\)["'`]/.test(readFileSync(join(process.cwd(), p), "utf8")));
    assert.deepEqual(offenders, [], "--brand jako color: patří na --brand-text");
  });

  it("--danger, --success a --info jsou ZATÍM pod AA jako text ve světlém režimu", () => {
    // Tvrzení je obrácené schválně, stejně jako u --brand výš. Opravit je
    // znamená sáhnout na planner, Monitor i admin — vlastní etapa, ne přílepek
    // k reportu. Dokud to nikdo neudělá, ať je fakt aspoň v kódu; jakmile to
    // udělá, tenhle test spadne a přinutí ho seznam projít a smazat.
    const surface2 = tokenColor("surface-2", "light");
    for (const name of ["danger", "success", "info"]) {
      const ratio = contrastRatio(tokenColor(name, "light"), surface2);
      assert.ok(
        ratio < 4.5,
        `--${name} už je ${ratio.toFixed(2)}:1 — projdi jeho použití jako text a uprav tenhle seznam`,
      );
    }
  });

  it("v tmavém režimu ta trojice naopak AA splňuje", () => {
    // Doklad, že jde o vadu SVĚTLÉHO režimu, ne o špatně zvolený odstín.
    for (const name of ["danger", "success", "info"]) {
      const ratio = contrastRatio(tokenColor(name, "dark"), tokenColor("surface-2", "dark"));
      assert.ok(ratio >= 4.5, `--${name} (dark) = ${ratio.toFixed(2)}:1`);
    }
  });
});

describe("škály", () => {
  it("písmo má podlahu 10 px a roste", () => {
    const steps = Object.values(reportTypeScale);
    assert.equal(Math.min(...steps), 10);
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b), "kroky musí být vzestupné");
    assert.equal(new Set(steps).size, steps.length, "žádné dva kroky nesmí mít stejnou hodnotu");
  });

  it("piktogramy nejsou stupně písma, ale jsou definované", () => {
    assert.equal(reportGlyph.sm, 16);
    assert.equal(reportGlyph.lg, 20);
  });

  it("odsazení je vzestupné a bez duplicit", () => {
    const s = Object.values(reportSpace);
    assert.deepEqual(s, [...s].sort((a, b) => a - b));
    assert.equal(new Set(s).size, s.length);
  });

  it("poloměry jsou vzestupné a pilulka je poslední", () => {
    const r = Object.values(reportRadius);
    assert.deepEqual(r, [...r].sort((a, b) => a - b));
    assert.equal(reportRadius.pill, 999);
  });
});

describe("mapování stavů na tokeny", () => {
  /*
   * Očekávané mapování se vypisuje CELÉ a porovnává se se slovníkem
   * `reservationStatus.ts`, který slibuje „nový stav → doplnit sem, jinak shodí
   * strážný test". S ručním výčtem uvnitř testu to neplatilo: devátý stav by
   * prošel a v pipeline by se objevila šedá tečka bez významu — přesně ta vada,
   * kvůli které slovník vznikl.
   *
   * Nejde použít zkratku „žádný stav nesmí vrátit --text-muted": WITHDRAWN ji
   * vrací legitimně (stažená rezervace se má ztlumit). Rozdíl mezi „záměrně
   * tlumený" a „propadl záchytem" nejde poznat z návratové hodnoty, jedině
   * z toho, že je stav v tabulce vyjmenovaný.
   */
  const EXPECTED_TONES: Record<string, string> = {
    SUBMITTED: "var(--status-warn)",
    COUNTER_PROPOSED: "var(--status-warn)",
    ACCEPTED: "var(--status-idle)",
    QUEUE_READY: "var(--status-idle)",
    SCHEDULED: "var(--status-ok)",
    CONFIRMED: "var(--status-ok)",
    REJECTED: "var(--status-bad)",
    WITHDRAWN: "var(--text-muted)",
  };

  it("tabulka očekávání pokrývá přesně slovník stavů — ani víc, ani míň", () => {
    assert.deepEqual(
      Object.keys(EXPECTED_TONES).sort(),
      [...RESERVATION_STATUSES].sort(),
      "přibyl nebo zmizel stav rezervace — doplň ho do pipelineToneFor i sem",
    );
  });

  it("mapování drží význam, ne jen tvar", () => {
    // Bez porovnání hodnot by prohození REJECTED ↔ CONFIRMED prošlo.
    for (const [status, tone] of Object.entries(EXPECTED_TONES)) {
      assert.equal(pipelineToneFor(status), tone, `stav ${status}`);
    }
  });

  it("neznámý stav spadne na tlumenou, ne na výjimku", () => {
    assert.equal(pipelineToneFor("SMYSLENY_STAV"), "var(--text-muted)");
  });

  it("heatToneFor rozlišuje všech šest stavů dlaždice", () => {
    assert.equal(heatToneFor(null).fill, "var(--surface-3)");
    assert.equal(heatToneFor(0).fill, "var(--surface-2)");
    assert.equal(heatToneFor(30).fill, "var(--status-idle)");
    assert.equal(heatToneFor(60).fill, "var(--status-warn)");
    assert.equal(heatToneFor(90).fill, "var(--status-ok)");
    assert.equal(heatToneFor(120).fill, "var(--status-bad)");
  });

  it("jen přeplánování nese druhý, nebarevný signál", () => {
    // Semaforová škála je pro dichromata nerozlišitelná (ΔOKLab 0,004–0,059 po
    // Viénot–Brettel simulaci), hodnotu proto nese číslo v dlaždici. Rámeček
    // dostává navíc jediný stav, který volá po okamžitém zásahu — u něj se
    // nespoléháme ani na to, že si člověk to číslo přečte.
    for (const pct of [101, 120, 999]) {
      assert.equal(heatToneFor(pct).overbooked, true, `pct=${pct}`);
    }
    for (const pct of [null, 0, 30, 60, 90, 100]) {
      assert.equal(heatToneFor(pct).overbooked, false, `pct=${pct}`);
    }
  });

  it("hranice pásem sedí na legendu", () => {
    assert.equal(heatToneFor(49).fill, "var(--status-idle)");
    assert.equal(heatToneFor(50).fill, "var(--status-warn)");
    assert.equal(heatToneFor(79).fill, "var(--status-warn)");
    assert.equal(heatToneFor(80).fill, "var(--status-ok)");
    assert.equal(heatToneFor(100).fill, "var(--status-ok)");
    assert.equal(heatToneFor(101).fill, "var(--status-bad)");
  });

  it("dlaždice s barevnou výplní má číslo v --status-on, prázdná v tlumené", () => {
    assert.equal(heatToneFor(60).text, "var(--status-on)");
    assert.equal(heatToneFor(0).text, "var(--text-muted)");
    assert.equal(heatToneFor(null).text, "var(--text-muted)");
  });

  it("čárkovaný obrys má JEN „stroj nejede“", () => {
    // Prázdná nula a prázdné „nejede“ mají odstíny na 1,13 : 1 — pouhým okem
    // je nešlo rozeznat, přestože legenda slibuje dva různé stavy.
    assert.equal(heatToneFor(null).dashed, true);
    for (const pct of [0, 30, 60, 90, 100, 120]) {
      assert.equal(heatToneFor(pct).dashed, false, `pct=${pct}`);
    }
  });

  it("krajní a nesmyslné vstupy nespadnou a chovají se předvídatelně", () => {
    // Záporné vytížení ani NaN z API nepřijdou (vrací číslo nebo null), ale
    // dokud to není zapsané, není to pravda — jen domněnka.
    assert.equal(heatToneFor(-5).fill, "var(--status-idle)");
    assert.equal(heatToneFor(0.5).fill, "var(--status-idle)");
    assert.equal(heatToneFor(100.5).fill, "var(--status-bad)");
    assert.equal(heatToneFor(NaN).fill, "var(--status-idle)");
    assert.equal(heatToneFor(NaN).overbooked, false);
  });
});

describe("předpoklady, na kterých strážný test stojí", () => {
  it("dělení na větve odpovídá skutečné struktuře souboru", () => {
    // `tokenValue` bere za tmavou větev VŠECHNO od `.dark {` do konce souboru.
    // Platí to jen dokud za ním nestojí deklarace tokenu v jiném scope —
    // `:root:not(.dark)`, `@media print` apod. by se změřily jako tmavé, i když
    // patří světlému režimu.
    const darkAt = CSS.indexOf(".dark {");
    const tail = CSS.slice(darkAt);
    const closeAt = tail.indexOf("\n}");
    assert.ok(closeAt > 0, "blok .dark musí být ukončený");
    const after = tail.slice(closeAt);
    const stray = [...after.matchAll(/^\s*--[\w-]+:/gm)];
    assert.deepEqual(
      stray.map((m) => m[0].trim()),
      [],
      "za blokem .dark přibyla deklarace tokenu — dělení na větve už neplatí, uprav tokenValue",
    );
  });

  it("žádný měřený token nemá alfa složku, kterou parseColor neumí", () => {
    // `parseColor` vrací null pro `oklch(L C H / a)` i osmiznakový hex; kdyby
    // takový zápis přistál v měřeném tokenu, spadlo by to na „nečitelná
    // hodnota". Test to říká rovnou a jmenovitě.
    const measured = [
      "brand-text", "status-bad", "status-ok", "status-warn", "status-idle", "status-on",
      "series-a", "series-b", "type-zakazka", "type-rezervace", "type-udrzba",
      "surface", "surface-2", "background", "warning-text", "danger", "success", "info",
    ];
    for (const mode of MODES) {
      for (const name of measured) {
        assert.ok(tokenColor(name, mode), `--${name} (${mode})`);
      }
    }
  });
});
