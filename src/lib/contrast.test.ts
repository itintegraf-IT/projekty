import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  oklchToSrgb, parseColor, relativeLuminance, contrastRatio,
  mixOklab, simulateCvd, oklabDistance, type Rgb,
} from "./contrast";

/** Zaokrouhlení na hex, ať se dá kontrolovat proti prohlížeči. */
function toHex(c: Rgb): string {
  return "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

describe("contrast — převody", () => {
  it("oklch → sRGB sedí na hodnoty, které vrací prohlížeč", () => {
    // Referenční body odečtené z tokenů projektu.
    assert.equal(toHex(oklchToSrgb(0.9, 0.19, 102)), "#f8e100");   // --brand
    assert.equal(toHex(oklchToSrgb(0.97, 0.006, 247.9)), "#f2f6f9"); // --surface light
    assert.equal(toHex(oklchToSrgb(0.205, 0, 0)), "#171717");        // --surface dark
  });

  it("oklch mimo sRGB gamut se ořízne do rozsahu 0–1", () => {
    const c = oklchToSrgb(0.6, 0.4, 140); // přesycená zelená
    assert.ok(c.every((v) => v >= 0 && v <= 1), "složky musí být v 0–1");
  });

  it("parseColor rozumí oklch i hexu, jinak vrací null", () => {
    assert.equal(toHex(parseColor("oklch(0.9 0.19 102)")!), "#f8e100");
    assert.equal(toHex(parseColor("#f8e100")!), "#f8e100");
    assert.equal(toHex(parseColor("#fff")!), "#ffffff");
    assert.equal(parseColor("var(--brand)"), null);
    assert.equal(parseColor("color-mix(in oklab, red 20%, transparent)"), null);
  });
});

describe("contrast — poměr", () => {
  it("bílá vs. černá je 21:1", () => {
    assert.ok(Math.abs(contrastRatio([1, 1, 1], [0, 0, 0]) - 21) < 0.01);
  });

  it("stejná barva je 1:1 a poměr nezávisí na pořadí", () => {
    const a = oklchToSrgb(0.5, 0.2, 25);
    const b = oklchToSrgb(0.97, 0.006, 247.9);
    assert.ok(Math.abs(contrastRatio(a, a) - 1) < 1e-9);
    assert.ok(Math.abs(contrastRatio(a, b) - contrastRatio(b, a)) < 1e-9);
  });

  it("--brand jako text ve světlém režimu je pod 1,5:1 — důvod, proč existuje --brand-text", () => {
    const brand = oklchToSrgb(0.9, 0.19, 102);
    const surface = oklchToSrgb(0.97, 0.006, 247.9);
    assert.ok(contrastRatio(brand, surface) < 1.5);
  });

  it("relativeLuminance roste s jasem", () => {
    assert.ok(relativeLuminance([1, 1, 1]) > relativeLuminance([0.5, 0.5, 0.5]));
    assert.ok(relativeLuminance([0.5, 0.5, 0.5]) > relativeLuminance([0, 0, 0]));
  });
});

describe("contrast — míchání a barvoslepost", () => {
  it("mixOklab v krajních poměrech vrací čisté vstupy", () => {
    const a: Rgb = [1, 0, 0], b: Rgb = [0, 0, 1];
    assert.equal(toHex(mixOklab(a, b, 1)), toHex(a));
    assert.equal(toHex(mixOklab(a, b, 0)), toHex(b));
  });

  it("22% tón stavové barvy leží mezi barvou a podkladem", () => {
    const status = oklchToSrgb(0.5, 0.2, 25);
    const surface = oklchToSrgb(0.97, 0.006, 247.9);
    const pill = mixOklab(status, surface, 0.22);
    const l = relativeLuminance(pill);
    assert.ok(l > relativeLuminance(status) && l < relativeLuminance(surface));
  });

  /*
   * Tyhle tři invarianty jsou jediné, co odhalí záměnu LMS matice za jinou.
   * Simulace se špatným párem matic a koeficientů vypadá jako simulace — vrací
   * barvy, ne chybu — a rozdíly mezi tokeny z ní vycházejí řádově stejné, takže
   * projde i porovnání „červená/zelená splývá víc než modrá/jantarová" níž.
   * Prozradí ji až to, že posune achromatickou osu. Nesmazat.
   */
  it("achromatická osa se simulací nesmí hnout", () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      for (const kind of ["deuteranopia", "protanopia"] as const) {
        const out = simulateCvd([v, v, v], kind);
        for (const ch of out) {
          assert.ok(
            Math.abs(ch - v) < 0.01,
            `šedá ${v} se při ${kind} změnila na ${toHex(out)}`,
          );
        }
      }
    }
  });

  it("modrá a žlutá leží na ose, kterou dichromat vidí — nesmí se změnit", () => {
    for (const [name, rgb] of [["modrá", [0, 0, 1]], ["žlutá", [1, 1, 0]]] as const) {
      for (const kind of ["deuteranopia", "protanopia"] as const) {
        const d = oklabDistance(rgb as Rgb, simulateCvd(rgb as Rgb, kind));
        assert.ok(d < 0.02, `${name} se při ${kind} posunula o ΔOKLab ${d.toFixed(3)}`);
      }
    }
  });

  it("červená a zelená naopak splynou k žlutozelené", () => {
    // Doplněk předchozího testu: samotná neměnnost by šla splnit i identitou.
    const red = simulateCvd([1, 0, 0], "deuteranopia");
    const green = simulateCvd([0, 1, 0], "deuteranopia");
    assert.ok(oklabDistance([1, 0, 0], red) > 0.15, "červená se změnit MUSÍ");
    assert.ok(oklabDistance([0, 1, 0], green) > 0.15, "zelená se změnit MUSÍ");
    assert.ok(red[2] < 0.3 && green[2] < 0.3, "obě míří do žlutozelené, ne do modré");
    // Jádro věci: nejen že se obě pohnou, ale pohnou se K SOBĚ.
    const before = oklabDistance([1, 0, 0], [0, 1, 0]);
    const after = oklabDistance(red, green);
    assert.ok(after < before / 2, `sblížení: ${before.toFixed(3)} → ${after.toFixed(3)}`);
  });

  it("deuteranopie sblíží červenou se zelenou, ale ne modrou se žlutou", () => {
    const red = oklchToSrgb(0.5, 0.2, 25);
    const green = oklchToSrgb(0.5, 0.14, 150);
    const blue = oklchToSrgb(0.45, 0.17, 262);
    const amber = oklchToSrgb(0.62, 0.15, 60);
    const rgSim = oklabDistance(simulateCvd(red, "deuteranopia"), simulateCvd(green, "deuteranopia"));
    const baSim = oklabDistance(simulateCvd(blue, "deuteranopia"), simulateCvd(amber, "deuteranopia"));
    assert.ok(rgSim < baSim, "modrá/jantarová musí přežít deuteranopii lépe než červená/zelená");
  });

  it("oklabDistance je 0 pro shodnou barvu a symetrická", () => {
    const a = oklchToSrgb(0.5, 0.2, 25), b = oklchToSrgb(0.7, 0.1, 150);
    assert.ok(oklabDistance(a, a) < 1e-9);
    assert.ok(Math.abs(oklabDistance(a, b) - oklabDistance(b, a)) < 1e-9);
  });
});
