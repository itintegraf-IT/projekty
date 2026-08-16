# Reporty R2 — Tokeny a čitelnost · implementační plán

> **Pro agentní pracovníky:** POVINNÁ SUB-SKILL: `superpowers:subagent-driven-development`. Kroky mají `- [ ]` pro sledování.

**Cíl:** Stránka `/reporty` přestane obcházet designové tokeny; každá barva projde WCAG AA v obou režimech a hlídá to strážný test, který kontrast opravdu počítá.

**Architektura:** Nové tokeny v `globals.css` (světlá i tmavá větev). Čistý měřicí modul `src/lib/contrast.ts` (OKLCH → sRGB, relativní jas, kontrast, simulace barvosleposti). Škály písem a poloměrů v `src/lib/reportTokens.ts`. Strážný test čte **skutečný** `globals.css`, ne kopii hodnot.

**Tech stack:** TypeScript · React · CSS custom properties · `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-08-16-reporty-tokeny-citelnost-design.md`

---

## Globální omezení

Platí pro **každý** task:

- **NESPOUŠTĚT `npm run build` ani dev server.** Vojta má běžící instance na portech 3000 a 3111, které sdílejí `.next`. Ověřuj přes `npx tsc --noEmit` a testy.
- **Commitovat jen vyjmenované soubory** (`git add <cesta>`), **nikdy `git add -A`.** Nad větví běží paralelní sessions.
- **Žádná hodnota se nesmí změnit.** Tahle etapa mění jen barvu, velikost písma a poloměr. Když se změní číslo na stránce, je to chyba.
- **Žádné rozvržení.** Nepřesouvat, nepřidávat ani nerušit sekce — to je R3. Jediná povolená rozměrová změna je výška dlaždice heatmapy (24 → 28 px).
- Barvy **výhradně přes tokeny.** Jediný povolený literál v celém záběru je hodnota `--status-on` v `globals.css`.
- Celá sada testů se pouští takto (glob nejde do podsložek, proto se každá složka uvádí zvlášť):
  ```bash
  node --experimental-test-module-mocks --test --import tsx \
    src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
- Výchozí stav: 1129 testů zelených, `tsc --noEmit` čistý, pracovní strom čistý.

---

## Struktura souborů

| Soubor | Odpovědnost |
| --- | --- |
| `src/lib/contrast.ts` | **nový** — čisté měření barev. Bez importů z aplikace. |
| `src/lib/reportTokens.ts` | **nový** — `reportTypeScale`, `reportGlyph`, `reportRadius`, `pipelineToneFor`, `heatToneFor`. |
| `src/lib/reportTokens.test.ts` | **nový** — strážný test nad `globals.css` + škálami. |
| `src/app/globals.css` | 11 nových tokenů ve světlé i tmavé větvi. |
| `src/app/reporty/_components/ReportDashboard.tsx` | 19 literálů → tokeny; škála. |
| `src/app/reporty/_components/HealthPanel.tsx` | `--brand` → `--brand-text`, chipy typu, škála. |
| `src/app/reporty/_components/IntegrityRow.tsx` | odkaz → `--brand-text`, škála. |
| `src/app/reporty/_components/KpiCard.tsx` | škála. |
| `src/components/BlockEdit.tsx` | 1 řádek. |
| `src/components/monitor/MonitorChips.tsx` | 1 řádek. |

---

## Task 1: Měřicí modul `contrast.ts`

Čistá matematika, žádná vazba na aplikaci. Základ pro strážný test v Tasku 3.

**Soubory:**
- Vytvořit: `src/lib/contrast.ts`
- Test: `src/lib/contrast.test.ts`

**Rozhraní:**
- Poskytuje (na tomhle staví Task 3):
  - `type Rgb = [number, number, number]` — složky 0–1
  - `oklchToSrgb(l: number, c: number, h: number): Rgb`
  - `parseColor(value: string): Rgb | null` — přijme `oklch(L C H)`, `#rgb`, `#rrggbb`; jinak `null`
  - `relativeLuminance(rgb: Rgb): number`
  - `contrastRatio(a: Rgb, b: Rgb): number`
  - `mixOklab(a: Rgb, b: Rgb, ratio: number): Rgb` — `ratio` je podíl `a` (0–1); odpovídá `color-mix(in oklab, A <ratio>%, B)`
  - `simulateCvd(rgb: Rgb, kind: "deuteranopia" | "protanopia"): Rgb`
  - `oklabDistance(a: Rgb, b: Rgb): number`

- [ ] **Krok 1: Napsat padající test**

Vytvoř `src/lib/contrast.test.ts`:

```typescript
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
```

- [ ] **Krok 2: Spustit test, ověřit že padá**

```bash
node --test --import tsx src/lib/contrast.test.ts
```
Čekej: FAIL — `Cannot find module './contrast'`.

- [ ] **Krok 3: Napsat modul**

Vytvoř `src/lib/contrast.ts`:

```typescript
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
```

- [ ] **Krok 4: Spustit test, ověřit že prochází**

```bash
node --test --import tsx src/lib/contrast.test.ts
npx tsc --noEmit
```
Čekej: PASS, `tsc` bez chyby.

- [ ] **Krok 5: Commit**

```bash
git add src/lib/contrast.ts src/lib/contrast.test.ts
git commit -m "feat(lib): měřicí modul kontrastu a simulace barvosleposti"
```

---

## Task 2: Tokeny v `globals.css`

**Soubory:**
- Upravit: `src/app/globals.css` — světlá větev končí před `.dark {` (kolem ř. 195), tmavá začíná na `.dark {` (ř. 197)

**Rozhraní:**
- Konzumuje: nic
- Poskytuje: 11 CSS custom properties v obou větvích, které měří Task 3 a používají Tasky 4–7.

- [ ] **Krok 1: Přidat tokeny do SVĚTLÉ větve**

Ve světlé větvi, hned za řádek `--brand-contrast: oklch(0.2 0.015 248.39);`, vlož:

```css
  /* ── Stavové barvy reportu ──────────────────────────────────────────────
     Jedna rodina slouží textu i výplni. Ve světlém režimu je barva tmavá,
     takže funguje jako písmo na světlé kartě I jako podklad pod bílým číslem;
     v tmavém režimu je světlá a platí to zrcadlově. `--status-on` je barva
     čísla na syté výplni a překlápí se spolu s režimem.
     Hodnoty jsou naměřené, ne odhadnuté — hlídá je `reportTokens.test.ts`.
     Předchůdci (#f85149 / #3fb950 / #f0883e) dávali bílému číslu na dlaždici
     2,53–3,68:1, tedy pod AA, a to v OBOU režimech, protože byly napevno. */
  --status-bad: oklch(0.50 0.20 25);    /* nad 100 % — přeplánováno */
  --status-ok:   oklch(0.48 0.13 152);   /* 80–100 % */
  --status-warn: oklch(0.50 0.14 70);    /* 50–79 % */
  --status-idle: oklch(0.50 0.05 250);   /* pod 50 % — nevytíženo, NE havárie */
  --status-on:   #ffffff;                /* číslo na syté výplni */

  /* Série grafu. Modrá vs. jantarová je kanonická dvojice bezpečná pro
     barvoslepost — selhává červená vs. zelená, ne tahle. Předchůdci
     (#3b82f6 / #f0883e) měly jasový poměr 1,45:1, tedy v šedi splývaly. */
  --series-a: oklch(0.45 0.17 262);
  --series-b: oklch(0.62 0.15 60);

  /* Typ bloku. Odstíny podle plánovače (`blockStyles.ts`), aby týž typ nebyl
     na dvou obrazovkách jiné barvy — Kontrolní panel měl údržbu ČERVENOU,
     zatímco v plánu je zelená, a červená jinde v aplikaci znamená problém. */
  --type-zakazka:   oklch(0.46 0.15 262);
  --type-rezervace: oklch(0.46 0.17 310);
  --type-udrzba:    oklch(0.43 0.14 150);

  /* --brand je sytá žlutá (#f8e100). Na světlém podkladu dává jako PÍSMO
     1,22:1 — text prakticky neviditelný. Jako podklad s --brand-contrast je
     v pořádku a tak se má dál používat. Pro písmo je tady --brand-text.
     Stejný případ jako --warning/--warning-text o pár řádků výš. */
  --brand-text: oklch(0.48 0.14 102);
```

- [ ] **Krok 2: Přidat tokeny do TMAVÉ větve**

V `.dark { … }`, za řádek `--brand-contrast: …` (pokud tam není, tak za `--warning: oklch(0.82 0.16 90);` a jeho komentář), vlož:

```css
  /* Zrcadlo světlé rodiny — světlé barvy na tmavém podkladu, číslo na výplni
     je tmavé. Významy a názvy jsou shodné, mění se jen světlost. */
  --status-bad: oklch(0.70 0.19 25);
  --status-ok:   oklch(0.76 0.17 152);
  --status-warn: oklch(0.80 0.15 75);
  --status-idle: oklch(0.70 0.04 250);
  --status-on:   oklch(0.145 0 0);

  --series-a: oklch(0.62 0.16 262);
  --series-b: oklch(0.82 0.14 65);

  --type-zakazka:   oklch(0.74 0.15 262);
  --type-rezervace: oklch(0.74 0.17 310);
  --type-udrzba:    oklch(0.74 0.15 150);

  /* V tmavém režimu je --brand na tmavém podkladu 13,44:1 — vlastní tón netřeba. */
  --brand-text: var(--brand);
```

- [ ] **Krok 3: Ověřit, že se nic nerozbilo**

```bash
npx tsc --noEmit
grep -c 'status-bad\|status-ok\|status-warn\|status-idle\|status-on\|series-a\|series-b\|type-zakazka\|type-rezervace\|type-udrzba\|brand-text' src/app/globals.css
```
Čekej: `tsc` bez chyby; `grep -c` vrátí **22** (11 tokenů × 2 větve) — pokud vyjde míň, chybí token v jedné z větví.

- [ ] **Krok 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(tokens): stavové, sériové a typové barvy s doloženým kontrastem"
```

---

## Task 3: Škály + strážný test

Tohle je trvalá hodnota etapy. Test **čte skutečný `globals.css`** — nesmí obsahovat kopii hodnot, jinak by hlídal sám sebe.

**Soubory:**
- Vytvořit: `src/lib/reportTokens.ts`
- Vytvořit: `src/lib/reportTokens.test.ts`

**Rozhraní:**
- Konzumuje: `src/lib/contrast.ts` (Task 1), `src/app/globals.css` (Task 2)
- Poskytuje (na tomhle staví Tasky 4–6):
  - `reportTypeScale: { xs: 10; sm: 11; base: 12; md: 13; lg: 14; hero: 22; display: 26 }`
  - `reportGlyph: { sm: 16; lg: 20 }`
  - `reportRadius: { xs: 3; sm: 6; md: 8; lg: 10; pill: 999 }`
  - `pipelineToneFor(status: string): string` — vrací `var(--…)`
  - `heatToneFor(pct: number | null): { fill: string; text: string; overbooked: boolean }`

- [ ] **Krok 1: Napsat padající test**

Vytvoř `src/lib/reportTokens.test.ts`:

```typescript
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
```

- [ ] **Krok 2: Spustit test, ověřit že padá**

```bash
node --test --import tsx src/lib/reportTokens.test.ts
```
Čekej: FAIL — `Cannot find module './reportTokens'`.

- [ ] **Krok 3: Napsat modul**

Vytvoř `src/lib/reportTokens.ts`:

```typescript
/**
 * Škály a mapování stavů pro stránku `/reporty`.
 *
 * Obdoba `plannerTypography.ts` pro planner a `uiStyles.ts` pro admin: jeden
 * zdroj pravdy, aby se velikosti nerozjely. Před touhle etapou měl report
 * 12 velikostí písma (od 8 px) a 12 poloměrů.
 *
 * Barvy tu NEJSOU jako hodnoty, jen jako odkazy `var(--…)`. Hodnoty patří do
 * `globals.css`, kde je měří `reportTokens.test.ts`.
 */

/**
 * Stupně písma. Podlaha 10 px — pod ní byly popisky os a čísla v dlaždicích,
 * které se z běžné vzdálenosti nedaly přečíst.
 */
export const reportTypeScale = {
  xs: 10,       // popisky os, legendy, čísla v dlaždicích heatmapy
  sm: 11,       // popisky KPI karet, drobný meta text
  base: 12,     // běžný text, hlavičky sekcí
  md: 13,       // odkazy, položky seznamů, buňky tabulek
  lg: 14,       // název karty kontroly
  hero: 22,     // souhrnné číslo Kontrolního panelu
  display: 26,  // hodnota KPI karty
} as const;

/**
 * Velikost piktogramu v kolečku. NENÍ to stupeň písma — je to rozměr vázaný na
 * průměr kolečka (32 px → 16, 42 px → 20). Kdo mění průměr, mění i tohle.
 */
export const reportGlyph = { sm: 16, lg: 20 } as const;

/** Poloměry. Krok `md` je schválně shodný s `uiStyles.ts`, ať tlačítka sedí. */
export const reportRadius = {
  xs: 3,     // čtverečky legendy, dlaždice heatmapy (4 px dělá z 9px čtverečku kolečko)
  sm: 6,     // chipy, malá tlačítka
  md: 8,     // tlačítka, vstupy
  lg: 10,    // karty
  pill: 999, // odznaky
} as const;

/**
 * Barva tečky u stavu rezervace.
 *
 * Osm stavů se mapuje na stavovou čtveřici PODLE VÝZNAMU, ne na osm vlastních
 * barev. Tečka pak nese skupinu stavu (čeká / běží / vyřízeno / zamítnuto);
 * identitu stavu drží popisek vedle ní, který tam už je.
 */
export function pipelineToneFor(status: string): string {
  switch (status) {
    case "SUBMITTED":
    case "COUNTER_PROPOSED":
      return "var(--status-warn)";   // čeká na zásah člověka
    case "ACCEPTED":
    case "QUEUE_READY":
      return "var(--status-idle)";   // rozpracované, nikdo nečeká
    case "SCHEDULED":
    case "CONFIRMED":
      return "var(--status-ok)";     // úspěšně vyřízené
    case "REJECTED":
      return "var(--status-bad)";   // zamítnuté
    case "WITHDRAWN":
    default:
      return "var(--text-muted)";    // stažené — a záchyt pro devátý stav
  }
}

export type HeatTone = {
  /** Výplň dlaždice. */
  fill: string;
  /** Barva čísla v dlaždici. */
  text: string;
  /** Má dlaždice dostat druhý, nebarevný signál (rámeček)? */
  overbooked: boolean;
};

/**
 * Barva dlaždice heatmapy podle vytížení v procentech.
 *
 * `null` = stroj v ten den nejede. To NENÍ nula: nula znamená „stroj jede a
 * nic na něm není", což je informace o plánu, ne o kalendáři.
 *
 * Pod 50 % je modrošedá, ne červená. Nevytížený den není havárie stejného řádu
 * jako přeplánovaný a dřív je stránka varovala stejně naléhavě — červená měla
 * v legendě dva různé významy.
 *
 * `overbooked` nese rámeček, protože po simulaci deuteranopie je dvojice
 * over/warn na ΔOKLab 0,022 — pro deuteranopa jsou to tytéž barvy. Přeplánování
 * je jediný stav, který znamená „zasáhni hned", takže barva na něj sama nestačí.
 */
export function heatToneFor(pct: number | null): HeatTone {
  if (pct == null) return { fill: "var(--surface-3)", text: "var(--text-muted)", overbooked: false };
  if (pct > 100) return { fill: "var(--status-bad)", text: "var(--status-on)", overbooked: true };
  if (pct === 0) return { fill: "var(--surface-2)", text: "var(--text-muted)", overbooked: false };
  if (pct >= 80) return { fill: "var(--status-ok)", text: "var(--status-on)", overbooked: false };
  if (pct >= 50) return { fill: "var(--status-warn)", text: "var(--status-on)", overbooked: false };
  return { fill: "var(--status-idle)", text: "var(--status-on)", overbooked: false };
}
```

- [ ] **Krok 4: Spustit test**

```bash
node --test --import tsx src/lib/reportTokens.test.ts
```

Čekej: **testy tokenů, škál a mapování PROJDOU**; dva testy v „pojistky proti tichému rozejití" (literály v /reporty, `--brand` jako text) **zatím PADAJÍ** — opraví je Tasky 4–7. To je v pořádku a čekané.

Kdyby padlo cokoliv v sekcích „text splňuje AA", „číslo na syté výplni", „pilulka" nebo „série grafu", **NEUPRAVUJ prahy v testu** — znamená to, že se do `globals.css` dostala jiná hodnota, než spec předepisuje. Oprav CSS.

- [ ] **Krok 5: Commit**

```bash
git add src/lib/reportTokens.ts src/lib/reportTokens.test.ts
git commit -m "feat(reporty): škály písem a poloměrů + strážný test kontrastu tokenů"
```

---

## Task 4: `ReportDashboard` — barvy

**Soubory:**
- Upravit: `src/app/reporty/_components/ReportDashboard.tsx`

**Rozhraní:**
- Konzumuje: `heatToneFor`, `pipelineToneFor` z `@/lib/reportTokens` (Task 3)
- Poskytuje: nic dalším taskům

- [ ] **Krok 1: Doplnit import**

Za řádek `import { PlanningSection, … } from "./PlanningSection";` přidej:

```typescript
import { heatToneFor, pipelineToneFor } from "@/lib/reportTokens";
```

- [ ] **Krok 2: `HealthBadge` — bílá na `--danger` a zelené ✓**

```typescript
  if (total > 0) return <span style={{ ...base, background: "var(--danger)", color: "#fff" }}>{total}</span>;
```
→
```typescript
  if (total > 0) return <span style={{ ...base, background: "var(--danger)", color: "var(--status-on)" }}>{total}</span>;
```

Poslední řádek funkce má `--success` jako **text** na pilulce (2,78 : 1 ve světlém režimu):
```typescript
  return <span style={{ ...base, background: "color-mix(in oklab, var(--success) 22%, transparent)", color: "var(--success)" }}>✓</span>;
```
→
```typescript
  return <span style={{ ...base, background: "color-mix(in oklab, var(--success) 22%, transparent)", color: "var(--status-ok)" }}>✓</span>;
```
Podklad zůstává na `--success` — tam je token v pořádku.

- [ ] **Krok 3: `SectionHeader` — `--brand` jako text**

```typescript
      fontSize: 12, color: "var(--brand)", fontWeight: 600,
```
→
```typescript
      fontSize: 12, color: "var(--brand-text)", fontWeight: 600,
```

- [ ] **Krok 4: `BarChart` — legenda přestane být barevná**

Barevný text o 9 px je nejhůř čitelný prvek grafu. Barvu nese čtvereček, text jde do tlumené.

```typescript
      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
        {barKeys.map((k, i) => (
          <span key={k} style={{ fontSize: 9, color: colors[i] }}>&#9632; {machineLabel(k)}</span>
        ))}
      </div>
```
→
```typescript
      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
        {barKeys.map((k, i) => (
          <span key={k} style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: colors[i], display: "inline-block", flexShrink: 0 }} />
            {machineLabel(k)}
          </span>
        ))}
      </div>
```

- [ ] **Krok 5: `RetroView` — barvy pipeline a sérií**

Smaž celý blok `const pipelineColors = { … }` (8 řádků s hexy). Popisky `pipelineLabels` NECH.

Dvě místa, kde se `pipelineColors` používá (otevřené i uzavřené rezervace), přepiš:

```typescript
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineColors[k], display: "inline-block" }} />
```
→
```typescript
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: pipelineToneFor(k), display: "inline-block" }} />
```

(Pozor: druhý výskyt má o dva mezery jiné odsazení — použij `replace_all` nebo oprav oba.)

Série grafu:
```typescript
            colors={["#3b82f6", "#f0883e"]}
```
→
```typescript
            colors={["var(--series-a)", "var(--series-b)"]}
```

- [ ] **Krok 6: `RetroView` — barvy KPI vytížení**

Obě karty (XL 105 i XL 106) mají týž výraz. Nahraď na obou:

```typescript
          color={xl105?.utilization == null ? undefined : xl105.utilization > 100 ? "#f85149" : xl105.utilization >= 80 ? "#3fb950" : "#f0883e"}
```
→
```typescript
          color={xl105?.utilization == null ? undefined : heatToneFor(xl105.utilization).fill}
```

a analogicky pro `xl106`.

> Pozor na rozdíl: `heatToneFor` má navíc větev `pct === 0` → `--surface-2`. Na KPI kartě by nula znamenala neviditelnou hodnotu. **Ošetři to** tak, že se pro nulu vezme `--status-idle`:
> ```typescript
> const utilizationColor = (pct: number | null): string | undefined =>
>   pct == null ? undefined : pct === 0 ? "var(--status-idle)" : heatToneFor(pct).fill;
> ```
> Funkci dej nad `RetroView` a na obou kartách volej `utilizationColor(xl105?.utilization ?? null)`.

- [ ] **Krok 7: `capacityColor` v `OutlookView`**

```typescript
  if (m.overbookedHours > 0) return "#f85149";
  return m.plannedCapacity >= 80 ? "#3fb950" : "#f0883e";
```
→
```typescript
  if (m.overbookedHours > 0) return "var(--status-bad)";
  return m.plannedCapacity >= 80 ? "var(--status-ok)" : "var(--status-warn)";
```

Komentář nad funkcí (o tom, že se barva řídí `overbookedHours`, ne zaokrouhleným procentem) **nech beze změny** — platí dál.

- [ ] **Krok 8: Heatmapa**

Smaž celou lokální funkci `heatColor` (uvnitř `OutlookView`) — nahradil ji `heatToneFor`.

Dlaždici přepiš:
```typescript
                return (
                  <div key={d.date} style={{
                    height: 24, borderRadius: 3, background: heatColor(val),
                    // Přeplánování a nevytížení sdílejí červenou. Rámeček je odliší tvarem,
                    // aniž by se do R1 tahala nová barva — legenda níž popisuje obojí.
                    boxShadow: val != null && val > 100 ? "inset 0 0 0 2px var(--text)" : undefined,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 8, color: val != null && val > 0 ? "#fff" : "var(--text-muted)", fontWeight: 600,
                  }} title={`${d.date}: ${val == null ? "stroj nejede" : val > 100 ? val + " % — přeplánováno" : val + " %"}`}>
                    {val == null ? "" : val > 0 ? `${val}` : ""}
                  </div>
                );
```
→
```typescript
                const tone = heatToneFor(val);
                return (
                  <div key={d.date} style={{
                    height: 28, borderRadius: 4, background: tone.fill,
                    // Přeplánování si drží rámeček i po rozdělení barev: po simulaci
                    // deuteranopie je dvojice over/warn na ΔOKLab 0,022, tedy pro
                    // deuteranopa táž barva. Je to jediný stav, který volá po zásahu.
                    boxShadow: tone.overbooked ? "inset 0 0 0 2px var(--text)" : undefined,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, color: tone.text, fontWeight: 600,
                  }} title={`${d.date}: ${val == null ? "stroj nejede" : val > 100 ? val + " % — přeplánováno" : val + " %"}`}>
                    {val == null ? "" : val > 0 ? `${val}` : ""}
                  </div>
                );
```

Hlavičku dní (`fontSize: 8`) zvedni na `fontSize: 10`.

- [ ] **Krok 9: Legenda heatmapy**

```typescript
          {[
            { c: "#f85149", label: "nad 100 % — přeplánováno", ring: true },
            { c: "#3fb950", label: "80–100 %", ring: false },
            { c: "#f0883e", label: "50–79 %", ring: false },
            { c: "#f85149", label: "pod 50 %", ring: false },
            { c: "var(--surface-3)", label: "stroj nejede", ring: false },
          ].map((it) => (
            <span key={it.label} style={{ fontSize: 9, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
```
→
```typescript
          {[
            { c: "var(--status-bad)", label: "nad 100 % — přeplánováno", ring: true },
            { c: "var(--status-ok)", label: "80–100 %", ring: false },
            { c: "var(--status-warn)", label: "50–79 %", ring: false },
            { c: "var(--status-idle)", label: "pod 50 %", ring: false },
            { c: "var(--surface-2)", label: "0 %", ring: false },
            { c: "var(--surface-3)", label: "stroj nejede", ring: false },
          ].map((it) => (
            <span key={it.label} style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 3, color: "var(--text-muted)" }}>
```

Komentář nad legendou uprav — už nemluví o pěti stavech, ale o šesti, a červená už nemá dva významy:

```typescript
        {/* Legenda MUSÍ vyjmenovat všech šest stavů, které `heatToneFor` umí.
            Do R1 jich uměla pět a dva z nich sdílely červenou — přeplánovaný den
            se pak četl jako nejhorší nevytížení. */}
```

- [ ] **Krok 10: Nejstarší čekající rezervace**

```typescript
            Nejstarší čekající: <strong style={{ color: data.pendingReservations.oldestWaitingDays > 3 ? "#f85149" : "var(--text)" }}>
```
→
```typescript
            Nejstarší čekající: <strong style={{ color: data.pendingReservations.oldestWaitingDays > 3 ? "var(--status-bad)" : "var(--text)" }}>
```

- [ ] **Krok 11: Chybová hláška**

```typescript
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "var(--danger)",
```
→
```typescript
                  background: "color-mix(in oklab, var(--danger) 8%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--danger) 25%, transparent)",
                  color: "var(--status-bad)",
```
Podklad a okraj jdou na `--danger` (tam je v pořádku), **text** na `--status-bad` — `--danger` jako písmo je ve světlém režimu 3,42 : 1.

- [ ] **Krok 12: Ověřit**

```bash
npx tsc --noEmit
grep -n '#[0-9a-fA-F]\{3,8\}\b\|rgba\?(' src/app/reporty/_components/ReportDashboard.tsx
node --test --import tsx src/lib/reportTokens.test.ts
```
Čekej: `tsc` čistý; **grep nic nenajde**; z testu zbývá padat už jen `--brand jako color:` (HealthPanel/IntegrityRow, Task 5) a literál v ostatních souborech, pokud tam ještě je.

- [ ] **Krok 13: Commit**

```bash
git add src/app/reporty/_components/ReportDashboard.tsx
git commit -m "fix(reporty): barvy dashboardu přes tokeny, heatmapa čitelná a bez dvojznačné červené"
```

---

## Task 5: `HealthPanel` + `IntegrityRow` — `--brand-text` a chipy

**Soubory:**
- Upravit: `src/app/reporty/_components/HealthPanel.tsx`
- Upravit: `src/app/reporty/_components/IntegrityRow.tsx`

**Rozhraní:**
- Konzumuje: tokeny z Tasku 2
- Poskytuje: nic dalším taskům

- [ ] **Krok 1: `HealthPanel` — chipy typu bloku**

```typescript
const TYPE_CHIP: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#c0392b" };
```
→
```typescript
/**
 * Odstíny podle plánovače (`blockStyles.ts`), ne vlastní sada: údržba tu dřív
 * byla ČERVENÁ, zatímco v plánu je zelená — týž typ bloku měl dvě barvy podle
 * toho, na kterou obrazovku se člověk díval, a červená jinde v aplikaci
 * znamená problém. Bílý text na sytém podkladu navíc dával v tmavém režimu
 * 3,15–3,43:1, tedy pod AA; pilulka s 22% tónem to řeší v obou režimech.
 */
const TYPE_TONE: Record<string, string> = {
  ZAKAZKA: "var(--type-zakazka)",
  REZERVACE: "var(--type-rezervace)",
  UDRZBA: "var(--type-udrzba)",
};
```

A `Chip`:
```typescript
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 5, color: "#fff", background: TYPE_CHIP[type] ?? "var(--surface-3)" }}>
```
→
```typescript
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 6,
      color: TYPE_TONE[type] ?? "var(--text-muted)",
      background: TYPE_TONE[type]
        ? `color-mix(in oklab, ${TYPE_TONE[type]} 22%, transparent)`
        : "var(--surface-3)",
    }}>
```

- [ ] **Krok 2: `HealthPanel` — tři výskyty `--brand` jako text**

```typescript
  return <a href={jumpHref(id)} style={{ color: "var(--brand)", …
```
→ `color: "var(--brand-text)"`

```typescript
  const sectionLabel: React.CSSProperties = { fontSize: 12, color: "var(--brand)", …
```
→ `color: "var(--brand-text)"`

```typescript
<button onClick={onRefresh} style={{ marginLeft: 8, background: "none", border: "none", color: "var(--brand)", …
```
→ `color: "var(--brand-text)"`

**Tlačítko `refreshBtn` NEMĚNIT** — má `background: "var(--brand)"` s `color: "var(--brand-contrast)"`, což je správné použití. Token `--brand` jako **podklad** zůstává.

- [ ] **Krok 3: `HealthPanel` — `--danger`/`--success` jako TEXT na stavové tokeny**

Ve světlém režimu dávají `--danger` 3,42 : 1 a `--success` 2,78 : 1, tedy pod AA. Jako **podklad** zůstávají — mění se **jen** tam, kde jsou `color:`.

| Ř. | Bylo | Bude |
| --- | --- | --- |
| ~64 | `pillColor = … bad ? "var(--danger)" : "var(--success)"` | `… bad ? "var(--status-bad)" : "var(--status-ok)"` |
| ~156 | error box `color: "var(--danger)"` | `color: "var(--status-bad)"` |
| ~170 | souhrn `color: total > 0 ? "var(--danger)" … : "var(--success)"` | `"var(--status-bad)"` … `"var(--status-ok)"` |
| ~253 | `<strong style={{ color: … ? "var(--danger)" : "var(--text-muted)" }}>` | `"var(--status-bad)"` |
| ~257 | totéž pro `orphanFiles` | `"var(--status-bad)"` |

**NEMĚNIT** (tam jsou správně jako podklad či okraj): `edge` (ř. 59–63), `pillBg` (65–69), rámeček souhrnu (164), podklad ikony (168), `background`/`border` chybové hlášky (156).

- [ ] **Krok 4: `HealthPanel` na škálu**

Přidej import:
```typescript
import { reportTypeScale, reportGlyph, reportRadius } from "@/lib/reportTokens";
```

Přepiš **každý** `fontSize:` a `borderRadius:` podle tabulky:

| `fontSize` bylo | Bude |
| --- | --- |
| `10` | `reportTypeScale.xs` |
| `11`, `11.5` | `reportTypeScale.sm` |
| `12`, `12.5` | `reportTypeScale.base` |
| `13` | `reportTypeScale.md` |
| `14` | `reportTypeScale.lg` |
| `16` | `reportGlyph.sm` (piktogram v kolečku 32 px) |
| `20` | `reportGlyph.lg` (piktogram v kolečku 42 px) |
| `22` | `reportTypeScale.hero` |

| `borderRadius` bylo | Bude |
| --- | --- |
| `5`, `6` | `reportRadius.sm` |
| `8` | `reportRadius.md` |
| `9`, `11`, `12` | `reportRadius.lg` |
| `999` | `reportRadius.pill` |

**Nechat:** `borderRadius: "50%"` a `borderLeft: \`3px solid ${edge}\``.

- [ ] **Krok 5: `IntegrityRow` — odkaz, stavová barva a škála**

```typescript
                        <a href={`/?highlight=${item.id}`} style={{ color: "var(--brand)", …
```
→ `color: "var(--brand-text)"`

```typescript
            color: uncomputed ? "var(--warning-text)" : bad ? "var(--danger)" : "var(--text-muted)",
```
→ `… bad ? "var(--status-bad)" : "var(--text-muted)",`

`dotColor` (ř. 47–51) **NEMĚNIT** — tečka je výplň, ne text.

Pak import a táž tabulka škály jako v Kroku 4 (soubor má `fontSize` 10, 11, 11.5, 12, 13 a `borderRadius` 9, `"50%"`).

- [ ] **Krok 6: Ověřit**

```bash
npx tsc --noEmit
grep -n '#[0-9a-fA-F]\{3,8\}\b\|rgba\?(\|fontSize: [0-9]\|borderRadius: [0-9]' \
  src/app/reporty/_components/HealthPanel.tsx src/app/reporty/_components/IntegrityRow.tsx
node --test --import tsx src/lib/reportTokens.test.ts
```
Čekej: `tsc` čistý; **grep nic** (`"50%"` je v uvozovkách, netrefí se); **celý `reportTokens.test.ts` je teď zelený**.

- [ ] **Krok 7: Commit**

```bash
git add src/app/reporty/_components/HealthPanel.tsx src/app/reporty/_components/IntegrityRow.tsx
git commit -m "fix(reporty): viditelné odkazy Kontrolního panelu a chipy typu sjednocené s plánem"
```

---

## Task 6: `KpiCard` a dva řádky mimo `/reporty`

**Soubory:**
- Upravit: `src/app/reporty/_components/KpiCard.tsx`
- Upravit: `src/components/BlockEdit.tsx:1125`
- Upravit: `src/components/monitor/MonitorChips.tsx`

**Rozhraní:**
- Konzumuje: `reportTypeScale`, `reportRadius` z Tasku 3
- Poskytuje: nic dalším taskům

- [ ] **Krok 1: `KpiCard` na škálu**

Přidej import a přepiš velikosti na kroky škály. Hodnoty se **nemění** (11 / 26 / 10 → `sm` / `display` / `xs`), jde o to, aby se příště nedaly rozjet:

```typescript
import { reportTypeScale, reportRadius } from "@/lib/reportTokens";
```

```typescript
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
```
→ `borderRadius: reportRadius.lg,`

```typescript
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
```
→ `fontSize: reportTypeScale.sm`

```typescript
      <div style={{ fontSize: 26, fontWeight: 700, …
```
→ `fontSize: reportTypeScale.display`

```typescript
      {subtitle && <div style={{ fontSize: 10, …
```
→ `fontSize: reportTypeScale.xs`

- [ ] **Krok 2: `BlockEdit` — štítek „Zamčený blok"**

```typescript
            <Label style={{ fontSize: 11, color: locked ? "var(--brand)" : "var(--text-muted)", cursor: "pointer" }}>
```
→
```typescript
            <Label style={{ fontSize: 11, color: locked ? "var(--brand-text)" : "var(--text-muted)", cursor: "pointer" }}>
```

- [ ] **Krok 3: `MonitorChips` — chip „wait"**

```typescript
    case "wait":   return "var(--warning)";
```
→
```typescript
    // --warning je na světlém podkladu 1,86:1 — jako PÍSMO neviditelné. Chip
    // stojí na color-mix(warning 22 %), kde --warning-text dává 4,93:1.
    case "wait":   return "var(--warning-text)";
```

Ve funkci `toneBackground` **nic neměnit** — tam je `--warning` správně jako podklad.

- [ ] **Krok 4: Ověřit**

```bash
npx tsc --noEmit
node --test --import tsx src/lib/reportTokens.test.ts
```
Čekej: obojí zelené.

- [ ] **Krok 5: Commit**

```bash
git add src/app/reporty/_components/KpiCard.tsx src/components/BlockEdit.tsx src/components/monitor/MonitorChips.tsx
git commit -m "fix(ui): KPI karta na škálu, čitelný zámek bloku a chip čekání v Monitoru"
```

---

## Task 7: `ReportDashboard` na škálu + závěrečná kontrola

Poslední task. Zbylé velikosti v dashboardu se navážou na škálu a proběhne kontrola celé etapy.

**Soubory:**
- Upravit: `src/app/reporty/_components/ReportDashboard.tsx`

**Rozhraní:**
- Konzumuje: `reportTypeScale`, `reportRadius` (Task 3)

- [ ] **Krok 1: Rozšířit import**

```typescript
import { heatToneFor, pipelineToneFor } from "@/lib/reportTokens";
```
→
```typescript
import { heatToneFor, pipelineToneFor, reportTypeScale, reportRadius } from "@/lib/reportTokens";
```

- [ ] **Krok 2: Nahradit číselné velikosti kroky škály**

Projdi soubor a přepiš **každý** `fontSize: <číslo>` na krok škály podle tabulky:

| Bylo | Bude |
| --- | --- |
| `8`, `9`, `10` | `reportTypeScale.xs` |
| `11` | `reportTypeScale.sm` |
| `12` | `reportTypeScale.base` |
| `13` | `reportTypeScale.md` |
| `26` | `reportTypeScale.display` |

A **každý** `borderRadius: <číslo>`:

| Bylo | Bude |
| --- | --- |
| `2`, `3`, `4` | `reportRadius.xs` |
| `5`, `6` | `reportRadius.sm` |
| `8` | `reportRadius.md` |
| `9`, `10`, `11`, `12` | `reportRadius.lg` |
| `999` | `reportRadius.pill` |

**Nechat beze změny:** `borderRadius: "50%"` (kulaté tečky), `borderRadius: "2px 2px 0 0"` (sloupce grafu — složená hodnota, ne krok škály) a `"1px solid …"` v `border`.

- [ ] **Krok 3: Ověřit, že v souboru nezbyla holá čísla**

```bash
grep -n 'fontSize: [0-9]\|borderRadius: [0-9]' src/app/reporty/_components/ReportDashboard.tsx
```
Čekej: **nic**. (`borderRadius: "50%"` a `"2px 2px 0 0"` jsou v uvozovkách, takže se netrefí.)

- [ ] **Krok 4: Závěrečná kontrola celé etapy**

```bash
# 1. Žádný literál barvy v /reporty
grep -rn '#[0-9a-fA-F]\{3,8\}\b\|rgba\?(' src/app/reporty/

# 2. --brand se nikde nepoužívá jako barva písma
grep -rn 'color: *"var(--brand)"' src/

# 3. Typová kontrola
npx tsc --noEmit

# 4. Celá sada testů
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Čekej: první dva grepy **nic**; `tsc` čistý; **1129 + nové testy zelené, 0 padajících**.

- [ ] **Krok 5: Commit**

```bash
git add src/app/reporty/_components/ReportDashboard.tsx
git commit -m "refactor(reporty): velikosti dashboardu odvozené ze škály"
```

---

## Kontrola na závěr (dělá orchestrátor, ne subagent)

Po Tasku 7:

1. **Multi-agent review** celého diffu proti specu — etapa mění vzhled produkční stránky a sahá i na Monitor u stroje.
2. **Doplnit do `CLAUDE.md`**, sekce „Design tokens a vizuální konvence": že `--brand` a `--warning` jsou tokeny pro **podklad**, pro písmo že existují `--brand-text` a `--warning-text`, a že to hlídá `reportTokens.test.ts`.
3. **Doplnit `docs/vyvoj-historie.md`** o sekci etapy R2 s naměřenými hodnotami.
4. **Zvážit řádek do `docs/POUCENI.md`**: token bez změřeného kontrastu je nepodložený odhad; obzvlášť sytá barva může být dobrá jako podklad a nepoužitelná jako písmo — a v jednom režimu projít, ve druhém ne.
