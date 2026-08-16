import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseColor, contrastRatio, mixOklab, simulateCvd, oklabDistance, type Rgb,
} from "./contrast";
import { reportTypeScale, reportGlyph, reportRadius, pipelineToneFor, heatToneFor } from "./reportTokens";

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * Vytáhne hodnotu tokenu ze SKUTEČNÉHO globals.css. Test nesmí mít vlastní
 * kopii hodnot — jinak hlídá sám sebe a token se může v CSS tiše rozejít.
 *
 * Světlá větev = vše před `.dark {`, tmavá = blok `.dark { … }`.
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

  it("v /reporty nezůstal žádný hex ani rgba literál", () => {
    const files = [
      "src/app/reporty/_components/ReportDashboard.tsx",
      "src/app/reporty/_components/HealthPanel.tsx",
      "src/app/reporty/_components/IntegrityRow.tsx",
      "src/app/reporty/_components/KpiCard.tsx",
      "src/app/reporty/_components/PlanningSection.tsx",
      "src/app/reporty/_components/CheckExplainer.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const hits = [...src.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)]
        .filter((m) => !src.slice(Math.max(0, m.index! - 60), m.index!).includes("//"));
      assert.equal(hits.length, 0, `${f} obsahuje literál: ${hits.map((h) => h[0]).join(", ")}`);
    }
  });

  it("--brand se nikde v repu nepoužívá jako barva písma", () => {
    // Hlídá i planner a Monitor, ne jen /reporty — vada je táž.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          const src = readFileSync(join(process.cwd(), p), "utf8");
          // `[^,;\n]*` uprostřed pokrývá i ternár, kde mezi dvojtečkou a hodnotou
          // stojí podmínka. Pozor: vzorec se schválně nedá vypsat v komentáři —
          // procházejí se i testy, takže by tenhle soubor hlásil sám sebe.
          if (/color:\s*[^,;\n]*["'`]var\(--brand\)["'`]/.test(src)) offenders.push(p);
        }
      }
    };
    ["src/app", "src/components", "src/lib"].forEach(walk);
    assert.deepEqual([...new Set(offenders)], [], "--brand jako color: patří na --brand-text");
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

  it("poloměry jsou vzestupné a pilulka je poslední", () => {
    const r = Object.values(reportRadius);
    assert.deepEqual(r, [...r].sort((a, b) => a - b));
    assert.equal(reportRadius.pill, 999);
  });
});

describe("mapování stavů na tokeny", () => {
  it("každý z 8 stavů rezervace dostane tón", () => {
    for (const s of ["SUBMITTED", "ACCEPTED", "QUEUE_READY", "COUNTER_PROPOSED",
                     "SCHEDULED", "CONFIRMED", "REJECTED", "WITHDRAWN"]) {
      assert.match(pipelineToneFor(s), /^var\(--[\w-]+\)$/, `stav ${s}`);
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
    // Po simulaci deuteranopie je over/warn na ΔOKLab 0,022 — pro deuteranopa
    // je to táž barva. Přeplánování je přitom jediný stav, který znamená
    // „zasáhni hned", takže rámeček není zdobení, ale nosič informace.
    assert.equal(heatToneFor(120).overbooked, true);
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
});
