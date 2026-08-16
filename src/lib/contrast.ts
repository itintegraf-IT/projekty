/**
 * Měření barev — čistá matematika bez vazby na aplikaci.
 *
 * Existuje kvůli strážnému testu tokenů (`reportTokens.test.ts`). V repu dřív
 * žádný test kontrast nepočítal, a proto mohl `--brand` přežít na 1,22:1 jako
 * barva písma, `--warning` se musel odhalit ručně a do heatmapy se dostala
 * čtveřice barev, na kterých bílé číslo nikdy nefungovalo.
 *
 * Runtime kód tenhle modul nepoužívá — barvy řeší tokeny v `globals.css`.
 */

/** Složky sRGB v rozsahu 0–1 (ne 0–255). */
export type Rgb = [number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Lineární sRGB → sRGB s gamma korekcí. */
const encodeGamma = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;

/** sRGB → lineární sRGB. */
const decodeGamma = (v: number) =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

function oklabToSrgb(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    clamp01(encodeGamma(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(encodeGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(encodeGamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
  ];
}

function srgbToOklab(rgb: Rgb): [number, number, number] {
  const [r, g, b] = rgb.map(decodeGamma) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** OKLCH → sRGB. Barvy mimo gamut se ořežou do 0–1, jako to dělá prohlížeč. */
export function oklchToSrgb(l: number, c: number, h: number): Rgb {
  const rad = (h * Math.PI) / 180;
  return oklabToSrgb(l, c * Math.cos(rad), c * Math.sin(rad));
}

/**
 * Rozparsuje zápis barvy z CSS. Umí `oklch(L C H)` a hex.
 *
 * `var(...)` a `color-mix(...)` vrací `null` ZÁMĚRNĚ — nejsou to hodnoty, ale
 * odkazy. Volající je musí rozřešit sám, jinak by test tiše přeskočil token,
 * který měl změřit.
 */
export function parseColor(value: string): Rgb | null {
  const v = value.trim();

  const oklch = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/i.exec(v);
  if (oklch) {
    const rawL = oklch[1];
    const l = rawL.endsWith("%") ? parseFloat(rawL) / 100 : parseFloat(rawL);
    return oklchToSrgb(l, parseFloat(oklch[2]), parseFloat(oklch[3]));
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
  }

  return null;
}

/** Relativní jas dle WCAG 2.1. */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(decodeGamma) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastní poměr dle WCAG 2.1 — 1 až 21, nezávislý na pořadí. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Odpovídá `color-mix(in oklab, a <ratio*100>%, b)`. */
export function mixOklab(a: Rgb, b: Rgb, ratio: number): Rgb {
  const la = srgbToOklab(a);
  const lb = srgbToOklab(b);
  return oklabToSrgb(
    la[0] * ratio + lb[0] * (1 - ratio),
    la[1] * ratio + lb[1] * (1 - ratio),
    la[2] * ratio + lb[2] * (1 - ratio),
  );
}

// Viénotova projekce v prostoru LMS (Hunt-Pointer-Estevez).
const RGB_TO_LMS = [
  [0.31399, 0.63951, 0.04649],
  [0.15537, 0.75789, 0.08670],
  [0.01775, 0.10945, 0.87259],
];
const LMS_TO_RGB = [
  [5.47221, -4.64190, 0.16963],
  [-1.12520, 2.29317, -0.16780],
  [0.02980, -0.19318, 1.16364],
];
const apply = (m: number[][], v: number[]) =>
  m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/** Jak barvu vidí člověk s deuteranopií nebo protanopií (Viénot 1999). */
export function simulateCvd(rgb: Rgb, kind: "deuteranopia" | "protanopia"): Rgb {
  const lms = apply(RGB_TO_LMS, rgb.map(decodeGamma));
  const projected =
    kind === "deuteranopia"
      ? [lms[0], 0.494207 * lms[0] + 1.24827 * lms[2], lms[2]]
      : [2.02344 * lms[1] - 2.52581 * lms[2], lms[1], lms[2]];
  return apply(LMS_TO_RGB, projected).map((v) => clamp01(encodeGamma(v))) as Rgb;
}

/**
 * Vnímaná vzdálenost dvou barev v OKLab.
 *
 * Doplňuje kontrastní poměr: dvě barvy se stejným jasem mají poměr 1:1, ale
 * můžou být dokonale rozlišitelné (modrá vs. oranžová). Kontrast říká „vidím
 * text?", tohle říká „poznám dvě série grafu od sebe?".
 */
export function oklabDistance(a: Rgb, b: Rgb): number {
  const x = srgbToOklab(a);
  const y = srgbToOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
