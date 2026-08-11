# Čitelnost timeline — velikost písma v blocích (cesta C) — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat do planneru přepínač velikosti písma `M · L · XL`, který zvětší text v blocích a na časové ose, aniž by z karty zmizela jediná informace.

**Architecture:** Všechny velikosti písma a z nich odvozené prahy hustoty žijí v novém čistém modulu `src/lib/plannerTypography.ts`. Místo pro větší písmo se získává náhradou dvouřádkového `DateBadge` jednořádkovým chipem, který v kódu už existuje ve dvou kopiích — ty se nejdřív sloučí do jedné sdílené komponenty. Mřížka roste jen zčásti, přes zaokrouhlený násobitel `slotHeight`.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Tailwind v4 · testy `node:test` + `tsx`.

## Global Constraints

- **Perzistence jen do `localStorage`**, klíč `ig-planner-font-scale`. Na `/api/me/preferences` se NESAHÁ — má allowlist klíčů a přijímá jen číselné hodnoty.
- **Stupně jsou `M` = 1,0 · `L` = 1,15 · `XL` = 1,35.** Žádný stupeň `S`.
- **`slotHeight * slotFactor` VŽDY přes `Math.round`.** Na celočíselném `slotHeight` stojí matematika drag & dropu.
- **Žádná délka bloku se nesmí propadnout do nižší hustoty, než má dnes.** Přejímací kritérium celé etapy, hlídá ho strážný test v Tasku 1.
- Mřížka je půlhodinová, `DURATION_OPTIONS` dává jen násobky 30 minut — kratší blok neexistuje.
- **Barvy uvnitř bloku zůstávají pevné literály**, ne CSS tokeny. Vnitřek bloku je barevný gradient stejný ve světlém i tmavém motivu; tokeny vázané na motiv by tam rozbily kontrast (viz doc komentář v `SpecBand.tsx`). Mimo blok (osa, hlavička, přepínač) platí běžné pravidlo — vždy tokeny, nikdy hex.
- **Nové komponenty jako named export do vlastního souboru**, ne inline do `PlannerPage.tsx` / `TimelineGrid.tsx` — oba jsou u limitu `max-lines`.
- Testy nových čistých modulů do `src/lib/*.test.ts` (spadá pod stávající glob, příkaz v `CLAUDE.md` se nemění).
- Po každém tasku `npm run build` — chytí TS chyby dřív než server.

## Struktura souborů

| Soubor | Odpovědnost | Task |
| --- | --- | --- |
| `src/lib/plannerTypography.ts` | **Nový.** Jediný zdroj pravdy pro velikosti písma, prahy hustoty, výšky řádků a násobitel mřížky. Čistá logika, žádný React. | 1 |
| `src/lib/plannerTypography.test.ts` | **Nový.** Monotonie, konzistence prahů, strážný test hustot, neregrese vůči dnešku. | 1 |
| `src/components/planner/FontScaleSwitch.tsx` | **Nový.** Pilulkový přepínač `M · L · XL` do hlavičky. | 2 |
| `src/app/_components/PlannerPage.tsx` | Stav `fontScale`, načtení/uložení, `typeScale`, `gridSlotHeight`. | 2 |
| `src/components/planner/BlockDateChip.tsx` | **Nový.** Jeden jednořádkový datumový chip. Nahrazuje dvě inline kopie stylu a později i `DateBadge`. | 3 |
| `src/components/planner/BlockCard.tsx` | Nasazení chipu, smazání `DateBadge`, zapojení `typeScale`. | 3, 4, 6 |
| `src/lib/tiskarBlockView.ts` | Výškový rozpočet z `typeScale` místo napevno zapsaných 23/20/33 px. | 5 |
| `src/app/_components/TimelineGrid.tsx` | Průchod `typeScale` do `BlockCard`, popisky časové osy, hlavička stroje. | 2, 7 |

---

### Task 1: Modul velikostí a prahů

**Files:**
- Create: `src/lib/plannerTypography.ts`
- Test: `src/lib/plannerTypography.test.ts`

**Interfaces:**
- Consumes: nic (čistý modul bez závislostí).
- Produces: `PLANNER_FONT_SCALES`, `PLANNER_FONT_SCALE_KEYS`, `DEFAULT_FONT_SCALE`, typ `PlannerFontScale`, typ `PlannerTypeScale`, funkce `plannerTypeScale(key): PlannerTypeScale`, `isPlannerFontScale(v: unknown): v is PlannerFontScale`, `effectiveSlotHeight(slotHeight: number, ts: PlannerTypeScale): number`.

- [ ] **Krok 1: Napsat padající test**

Vytvoř `src/lib/plannerTypography.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FONT_SCALE,
  PLANNER_FONT_SCALE_KEYS,
  effectiveSlotHeight,
  isPlannerFontScale,
  plannerTypeScale,
} from "./plannerTypography";

// Dnešní hodnoty zapsané napevno v BlockCard.tsx:512-515 — proti nim se měří neregrese.
const TODAY = { full: 48, compact: 44, tiny: 24, micro: 14 };
// Maximální přiblížení: slotHeight 26 px na 30 minut (ZoomSlider max).
const MAX_ZOOM = 26;

test("stupně jsou M, L, XL a výchozí je M", () => {
  assert.deepEqual([...PLANNER_FONT_SCALE_KEYS], ["M", "L", "XL"]);
  assert.equal(DEFAULT_FONT_SCALE, "M");
});

test("isPlannerFontScale propustí jen platné stupně", () => {
  assert.equal(isPlannerFontScale("XL"), true);
  assert.equal(isPlannerFontScale("S"), false);
  assert.equal(isPlannerFontScale(null), false);
  assert.equal(isPlannerFontScale(1.35), false);
});

test("každá velikost písma roste s vyšším stupněm", () => {
  const m = plannerTypeScale("M");
  const l = plannerTypeScale("L");
  const xl = plannerTypeScale("XL");
  for (const key of ["num", "desc", "chip", "spec", "mini", "badge", "rail", "machineHead"] as const) {
    assert.ok(l[key] > m[key], `${key}: L (${l[key]}) musí být větší než M (${m[key]})`);
    assert.ok(xl[key] > l[key], `${key}: XL (${xl[key]}) musí být větší než L (${l[key]})`);
  }
});

test("prahy hustoty jsou seřazené sestupně", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const t = plannerTypeScale(key).thresholds;
    assert.ok(t.full > t.compact, `${key}: full > compact`);
    assert.ok(t.compact > t.tiny, `${key}: compact > tiny`);
    assert.ok(t.tiny > t.micro, `${key}: tiny > micro`);
  }
});

// ── Strážný test: v XL má hodinový blok rezervu 1 px a půlhodinový přesně 0.
// Kdyby se konstanty výšky řádku posunuly, tenhle test spadne dřív, než to
// uvidí plánovač jako oříznutý text. Při pádu se snižují konstanty v modulu,
// NE prahy ad hoc.
test("při maximálním přiblížení si hodinový blok všude nechá plný layout", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const ts = plannerTypeScale(key);
    const hourPx = effectiveSlotHeight(MAX_ZOOM, ts) * 2; // 2 sloty = 60 minut
    assert.ok(
      hourPx >= ts.thresholds.full,
      `${key}: hodinový blok má ${hourPx} px, práh plného layoutu je ${ts.thresholds.full}`
    );
  }
});

test("při maximálním přiblížení zůstane půlhodinový blok aspoň jednořádkový", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const ts = plannerTypeScale(key);
    const halfPx = effectiveSlotHeight(MAX_ZOOM, ts); // 1 slot = 30 minut
    assert.ok(
      halfPx >= ts.thresholds.tiny,
      `${key}: půlhodinový blok má ${halfPx} px, práh jednořádkového je ${ts.thresholds.tiny}`
    );
  }
});

test("stupeň M nezhorší žádnou délku proti dnešku", () => {
  const t = plannerTypeScale("M").thresholds;
  assert.ok(t.full <= TODAY.full, `full ${t.full} <= ${TODAY.full}`);
  assert.ok(t.compact <= TODAY.compact, `compact ${t.compact} <= ${TODAY.compact}`);
  assert.ok(t.tiny <= TODAY.tiny, `tiny ${t.tiny} <= ${TODAY.tiny}`);
  assert.ok(t.micro <= TODAY.micro, `micro ${t.micro} <= ${TODAY.micro}`);
});

test("stupeň M nemění mřížku, vyšší stupně ji zvětší celočíselně", () => {
  assert.equal(effectiveSlotHeight(MAX_ZOOM, plannerTypeScale("M")), 26);
  assert.equal(effectiveSlotHeight(MAX_ZOOM, plannerTypeScale("L")), 27);
  assert.equal(effectiveSlotHeight(MAX_ZOOM, plannerTypeScale("XL")), 29);
  // Vždy celé číslo — na tom stojí matematika drag & dropu.
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    for (const zoom of [3, 7, 11, 18, 26]) {
      const v = effectiveSlotHeight(zoom, plannerTypeScale(key));
      assert.equal(v, Math.trunc(v), `${key} @ ${zoom}: ${v} není celé číslo`);
      assert.ok(v >= 3, `${key} @ ${zoom}: mřížka nesmí spadnout pod 3 px`);
    }
  }
});

test("výšky řádků pro tiskařský rozpočet rostou se stupněm", () => {
  const m = plannerTypeScale("M").rowHeights;
  const xl = plannerTypeScale("XL").rowHeights;
  assert.ok(xl.header > m.header);
  assert.ok(xl.spec1 > m.spec1);
  assert.ok(xl.spec2 > m.spec2);
  // Rozpočet musí být konzervativní: dnešní napevno zapsané hodnoty jsou
  // dolní hranicí, ne cílem (tiskarBlockView.ts: 23 / 20 / 33).
  assert.ok(m.header >= 23, `header ${m.header} >= 23`);
  assert.ok(m.spec1 >= 20, `spec1 ${m.spec1} >= 20`);
  assert.ok(m.spec2 >= 33, `spec2 ${m.spec2} >= 33`);
});
```

- [ ] **Krok 2: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/plannerTypography.test.ts
```

Očekávání: FAIL — `Cannot find module './plannerTypography'`.

- [ ] **Krok 3: Napsat modul**

Vytvoř `src/lib/plannerTypography.ts`:

```ts
/**
 * Velikost písma v plánu — jediný zdroj pravdy (etapa čitelnost timeline, 8/2026).
 *
 * Do 8/2026 bylo písmo v `BlockCard.tsx` zapsané absolutně v pixelech (48 výskytů
 * `fontSize`, 8–13 px) a prahy hustoty napevno jako 48/44/24/14. Zoom slider měnil
 * jen `slotHeight`, takže bloky rostly, ale text ne — plán byl na tabuli nečitelný.
 *
 * Klíčové pravidlo: **prahy hustoty se POČÍTAJÍ z písma, nezapisují se ručně.**
 * Kdyby písmo rostlo a prahy zůstaly, obsah karty by se oříznul.
 *
 * Čistá logika bez Reactu, aby šla pokrýt unit testy.
 */

/** Koeficienty stupňů. Zmenšení pod dnešek (`S`) se záměrně nedělá. */
export const PLANNER_FONT_SCALES = { M: 1, L: 1.15, XL: 1.35 } as const;

export type PlannerFontScale = keyof typeof PLANNER_FONT_SCALES;

/** Pořadí pro vykreslení přepínače — od nejmenšího. */
export const PLANNER_FONT_SCALE_KEYS = ["M", "L", "XL"] as const;

export const DEFAULT_FONT_SCALE: PlannerFontScale = "M";

/** Klíč v localStorage. Nastavení je vázané na ZAŘÍZENÍ, ne na uživatele. */
export const FONT_SCALE_STORAGE_KEY = "ig-planner-font-scale";

export type PlannerTypeScale = {
  key: PlannerFontScale;
  /** Číslo zakázky. */
  num: number;
  /** Popis zakázky. */
  desc: number;
  /** Datumový chip D/M/E/P. */
  chip: number;
  /** Pás specifikace. */
  spec: number;
  /** Značka „S" místo pásu na nízké kartě. */
  specChip: number;
  /** Mini-chip barev/laku/materiálu. */
  mini: number;
  /** Štítek deadline / kalendář v rohu karty. */
  badge: number;
  /** Popisek hodiny na časové ose. */
  rail: number;
  /** Hlavička sloupce stroje. */
  machineHead: number;
  /** Krytí popisu. V novém layoutu plný kontrast, v jednořádkových režimech utlumený. */
  descOpacity: number;
  descOpacityTiny: number;
  /** Násobitel `slotHeight` — mřížka roste pomaleji než písmo. */
  slotFactor: number;
  /** Prahy hustoty karty, odvozené z výšek řádků. */
  thresholds: { full: number; compact: number; tiny: number; micro: number };
  /** Od jaké výšky je pás specifikace dvouřádkový (dnes 80 px). */
  specTwoLine: number;
  /** Od jaké výšky vidí pás specifikace tiskař (dnes 80 px — má přednost tlačítko Hotovo). */
  tiskarSpecMin: number;
  /** Výšky řádků pro výškový rozpočet tiskařské karty (`tiskarBlockView.ts`). */
  rowHeights: { header: number; spec1: number; spec2: number };
};

/**
 * Odhad výšky řádku s číslem zakázky z velikosti jeho písma.
 * Hodnota 1,25 je `line-height` 1,2 plus rezerva na dotažnice.
 * POZOR: je to odhad, ne změřená hodnota. Když spadne strážný test
 * v `plannerTypography.test.ts`, snižuje se TOHLE, ne prahy.
 */
const NUM_ROW_FACTOR = 1.25;
/** Výška jednořádkového datumového chipu i s rámečkem a paddingem. */
const CHIP_ROW_FACTOR = 1.6;
/** Svislé odsazení plného layoutu (paddingTop + gap + paddingBottom). */
const FULL_PADDING_PX = 12;

export function plannerTypeScale(key: PlannerFontScale): PlannerTypeScale {
  const s = PLANNER_FONT_SCALES[key];

  const num  = 12 * s + 1.5;
  const desc = 10 * s + 1;
  const chip = 10 * s + 0.5;
  const spec = 10 * s + 0.5;

  const full = Math.round(num * NUM_ROW_FACTOR + chip * CHIP_ROW_FACTOR + FULL_PADDING_PX);

  return {
    key,
    num, desc, chip, spec,
    specChip: 9 * s,
    mini: 8 * s + 1,
    badge: 9 * s,
    rail: 9 * s,
    machineHead: 12 * s,
    descOpacity: 1,
    descOpacityTiny: 0.9,
    slotFactor: 1 + (s - 1) * 0.35,
    thresholds: {
      full,
      compact: full - 5,
      // Jednořádkový režim potřebuje jen řádek textu, roste proto pomaleji.
      tiny: Math.round(24 * s * 0.9),
      // Nejnižší režim ukazuje pouhé číslo — nezvětšuje se, jinak by karta
      // pod ním neukázala vůbec nic.
      micro: 14,
    },
    specTwoLine: Math.round(80 * s),
    tiskarSpecMin: Math.round(80 * s),
    rowHeights: {
      header: Math.round(num * 1.2 + 8),
      spec1:  Math.round(spec * 1.3 + 7),
      spec2:  Math.round(spec * 2.6 + 7),
    },
  };
}

export function isPlannerFontScale(v: unknown): v is PlannerFontScale {
  return typeof v === "string" && v in PLANNER_FONT_SCALES;
}

/**
 * Výška slotu (30 min) po zohlednění stupně písma.
 *
 * `Math.round` je POVINNÝ: `slotHeight` je celé číslo a stojí na něm veškerá
 * matematika drag & dropu (`dateToY` / `yToDate` a přepočty delty). Neceločíselná
 * hodnota by zavedla novou třídu zaokrouhlovacích chyb do přetahování bloků.
 */
export function effectiveSlotHeight(slotHeight: number, ts: PlannerTypeScale): number {
  return Math.max(3, Math.round(slotHeight * ts.slotFactor));
}
```

- [ ] **Krok 4: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/plannerTypography.test.ts
```

Očekávání: PASS, 9 testů.

- [ ] **Krok 5: Ověřit build a commitnout**

```bash
npm run build
git add src/lib/plannerTypography.ts src/lib/plannerTypography.test.ts
git commit -m "feat(planner): modul velikostí písma a odvozených prahů hustoty"
```

---

### Task 2: Přepínač v hlavičce a růst mřížky

Po tomto tasku přepínač funguje a mřížka se roztahuje. Písmo v blocích se ještě nemění — to přijde v Tasku 6.

**Files:**
- Create: `src/components/planner/FontScaleSwitch.tsx`
- Modify: `src/app/_components/PlannerPage.tsx`

**Interfaces:**
- Consumes: `PLANNER_FONT_SCALE_KEYS`, `DEFAULT_FONT_SCALE`, `FONT_SCALE_STORAGE_KEY`, `PlannerFontScale`, `isPlannerFontScale`, `plannerTypeScale`, `effectiveSlotHeight` z Tasku 1.
- Produces: `FontScaleSwitch({ value, onChange })`; v `PlannerPage` proměnné `typeScale: PlannerTypeScale` a `gridSlotHeight: number`.

- [ ] **Krok 1: Vytvořit komponentu přepínače**

Vytvoř `src/components/planner/FontScaleSwitch.tsx`. Styly jsou přesnou kopií skupiny `30d · 60d · 90d` z `PlannerPage.tsx:2875-2913` — žádná nová vizuální slovní zásoba:

```tsx
"use client";

import { PLANNER_FONT_SCALE_KEYS, type PlannerFontScale } from "@/lib/plannerTypography";

const LABELS: Record<PlannerFontScale, string> = {
  M: "Střední písmo — dnešní rozhled po plánu",
  L: "Velké písmo",
  XL: "Největší písmo — pro projekci na tabuli",
};

/**
 * Přepínač velikosti písma v plánu. Sedí v hlavičce hned za ZoomSlider:
 * zoom říká, kolik toho vidím, tenhle jak je to velké.
 *
 * Nastavení je vázané na ZAŘÍZENÍ (localStorage), ne na uživatele — velikost
 * písma je vlastnost obrazovky. Počítač u tabule se nastaví jednou na XL
 * a zůstane tak bez ohledu na to, kdo se přihlásí.
 */
export function FontScaleSwitch({
  value,
  onChange,
}: {
  value: PlannerFontScale;
  onChange: (next: PlannerFontScale) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Velikost písma v plánu"
      style={{
        display: "flex",
        gap: 2,
        padding: 2,
        borderRadius: 999,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--text) 8%, transparent)",
      }}
    >
      {PLANNER_FONT_SCALE_KEYS.map((key) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            title={LABELS[key]}
            onClick={() => onChange(key)}
            style={{
              minWidth: 32,
              height: 24,
              padding: "0 8px",
              fontSize: 11,
              fontWeight: active ? 700 : 600,
              borderRadius: 999,
              background: active ? "var(--brand)" : "transparent",
              border: active
                ? "1px solid color-mix(in oklab, var(--brand) 75%, var(--text))"
                : "1px solid transparent",
              color: active ? "var(--brand-contrast)" : "var(--text-muted)",
              cursor: "pointer",
              lineHeight: 1,
              transition: "all 140ms ease-out",
              boxShadow: active ? "0 2px 8px color-mix(in oklab, var(--text) 20%, transparent)" : "none",
            }}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Krok 2: Přidat stav a načtení v PlannerPage**

V `src/app/_components/PlannerPage.tsx` doplň import:

```tsx
import { FontScaleSwitch } from "@/components/planner/FontScaleSwitch";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALE_STORAGE_KEY,
  effectiveSlotHeight,
  isPlannerFontScale,
  plannerTypeScale,
  type PlannerFontScale,
} from "@/lib/plannerTypography";
```

Hned pod stav zoomu (`PlannerPage.tsx:242`) přidej:

```tsx
  // Velikost písma — vázaná na ZAŘÍZENÍ, ne na uživatele (viz FontScaleSwitch).
  // Stav se inicializuje na výchozí a localStorage se čte až v useEffect níž:
  // čtení v lazy inicializátoru useState by znamenalo, že server vyrenderuje
  // jinou velikost než klient, a vznikla by chyba hydratace. Krátké přeblesknutí
  // výchozí velikosti při načtení je stejné chování, jaké má dnes zoom.
  const [fontScale, setFontScale] = useState<PlannerFontScale>(DEFAULT_FONT_SCALE);
  useEffect(() => {
    const stored = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    if (isPlannerFontScale(stored)) setFontScale(stored);
  }, []);
  function handleFontScaleChange(next: PlannerFontScale) {
    setFontScale(next);
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, next);
  }
  const typeScale = useMemo(() => plannerTypeScale(fontScale), [fontScale]);
  // Mřížka roste jen zčásti. VŠECHNA geometrie používá tuhle hodnotu; surový
  // `slotHeight` zůstává jen pro slider a pro uloženou preferenci `zoom`.
  const gridSlotHeight = useMemo(() => effectiveSlotHeight(slotHeight, typeScale), [slotHeight, typeScale]);
```

Pokud `useMemo` není mezi importy z `react`, doplň ho.

- [ ] **Krok 3: Přepnout geometrii na `gridSlotHeight`**

Nahraď `slotHeight` za `gridSlotHeight` na **všech místech, kde se z něj počítá pozice nebo čas** — surový `slotHeight` smí zůstat jen v `<ZoomSlider value={slotHeight} …>` a v `savePreference("zoom", …)`.

Místa (čísla řádků odpovídají stavu před úpravou):

```
279   const anchorDate = new Date(viewStart.getTime() + (centerY / gridSlotHeight) * 30 * 60000);
289   const newY = dateToY(new Date(anchorMs), viewStart, gridSlotHeight);
763   const y = dateToY(blockTime, viewStart, gridSlotHeight);
849   const y = dateToY(new Date(target), newViewStart, gridSlotHeight);
882   const y = dateToY(new Date(block.startTime), viewStart, gridSlotHeight);
901   const y = dateToY(new Date(partner.startTime), viewStart, gridSlotHeight);
943   const y = dateToY(blockTime, viewStart, gridSlotHeight);
981   const y = dateToY(new Date(), viewStart, gridSlotHeight);
999   const y = dateToY(d, viewStart, gridSlotHeight);
2230  const y = dateToY(startTime, viewStart, gridSlotHeight);
3086  slotHeight={gridSlotHeight}
```

Uprav i závislosti efektů, které na výšce slotu stojí:

```tsx
  }, [gridSlotHeight]); // eslint-disable-line react-hooks/exhaustive-deps   // ř. 292, kotva zoomu
```

```tsx
  }, [blocks, viewStart, gridSlotHeight]); // eslint-disable-line react-hooks/exhaustive-deps   // ř. 904
```

Bez toho by se při změně stupně písma nepřepočítala kotva a plán by uskočil.

- [ ] **Krok 4: Vložit přepínač do hlavičky**

V `PlannerPage.tsx` hned za `<ZoomSlider …/>` (ř. 2874):

```tsx
          <ZoomSlider value={slotHeight} onChange={handleZoomChange} />
          <FontScaleSwitch value={fontScale} onChange={handleFontScaleChange} />
```

- [ ] **Krok 5: Ověřit ručně v prohlížeči**

```bash
npm run dev
```

Otevři `http://localhost:3000`, přihlas se a ověř:
1. Přepínač je v hlavičce mezi zoomem a skupinou `30d/60d/90d`, aktivní je `M`.
2. Klik na `XL` → mřížka se svisle roztáhne, bloky jsou vyšší, **písmo zatím stejné** (to je v tomto tasku správně).
3. Přetáhni blok o hodinu dolů a zkontroluj v detailu, že má čas přesně o hodinu později — matematika drag & dropu musí sedět i po změně mřížky.
4. Obnov stránku (F5) → `XL` zůstane vybrané.
5. Otevři plán v anonymním okně → je zpátky `M` (nastavení je na zařízení, ne na uživateli).

- [ ] **Krok 6: Ověřit build, testy a commitnout**

```bash
npm run build
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add src/components/planner/FontScaleSwitch.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(planner): přepínač velikosti písma M/L/XL + růst mřížky"
```

---

### Task 3: Sdílený datumový chip

V `BlockCard.tsx` jsou dnes **tři** implementace datumového řádku: dvouřádkový `DateBadge` (ř. 92-164, použit ve `showDatesFull`), inline styl `dateChip` v `MODE_COMPACT` (ř. 796-806, `fontSize: 10`) a inline styl `cs` ve `showDatesCompact` (ř. 1116-1126, `fontSize: 9`). Tenhle task sloučí ty dvě jednořádkové do jedné komponenty.

Vizuální dopad: chipy ve `showDatesCompact` vyrostou z 9 na 10 px a sjednotí se poloměr rohu (3 → 4 px). Jinak nic.

**Files:**
- Create: `src/components/planner/BlockDateChip.tsx`
- Modify: `src/components/planner/BlockCard.tsx:796-806` (odstranit `dateChip`), `:1116-1126` (odstranit `cs`), volání v obou blocích

**Interfaces:**
- Consumes: nic z předchozích tasků.
- Produces: `BlockDateChip({ text, state, accent, fontSize, title, customBg, customBorder, customTextColor, onClick, onDoubleClick })`, typ `DateChipState = "ok" | "danger" | "warning" | "earlyStart" | "issued" | "empty" | "neutral"`, konstanty `DEADLINE_BG` / `DEADLINE_BORDER` přesunuté sem.

- [ ] **Krok 1: Vytvořit komponentu**

Vytvoř `src/components/planner/BlockDateChip.tsx`. Konstanty `DEADLINE_BG` a `DEADLINE_BORDER` se sem přesunou z `BlockCard.tsx:72-89` beze změny hodnot:

```tsx
"use client";

import type React from "react";

export type DateChipState =
  | "ok" | "danger" | "warning" | "earlyStart" | "issued" | "empty" | "neutral";

/** Deadline barvy. Přesunuto z BlockCard — sdílí je všechny režimy karty. */
export const DEADLINE_BG: Record<DateChipState, string> = {
  ok:         "color-mix(in oklab, var(--success) 85%, black 15%)",
  danger:     "color-mix(in oklab, var(--danger) 85%, black 15%)",
  warning:    "color-mix(in oklab, var(--warning) 75%, black 25%)",
  earlyStart: "color-mix(in oklab, #f97316 85%, black 15%)",
  issued:     "color-mix(in oklab, #3b82f6 85%, black 15%)",
  empty:      "rgba(0,0,0,0.45)",
  neutral:    "rgba(255,255,255,0.18)",
};

export const DEADLINE_BORDER: Record<DateChipState, string> = {
  ok:         "color-mix(in oklab, var(--success) 70%, black 30%)",
  danger:     "color-mix(in oklab, var(--danger) 70%, black 30%)",
  warning:    "color-mix(in oklab, var(--warning) 60%, black 40%)",
  earlyStart: "color-mix(in oklab, #f97316 70%, black 30%)",
  issued:     "color-mix(in oklab, #3b82f6 70%, black 30%)",
  empty:      "rgba(255,255,255,0.55)",
  neutral:    "rgba(255,255,255,0.30)",
};

/**
 * Jednořádkový datumový chip na kartě bloku — „D 12.8 ✓".
 *
 * Nahradil dvouřádkový DateBadge (popisek „DATA" 8 px nad datem 11 px, ~22 px
 * výšky). Písmeno v textu a barevný proužek vlevo nesou stejnou informaci jako
 * to slovo, ale vejdou se do ~16 px — z uspořené výšky se platí větší písmo.
 *
 * Rozměry se odvozují od `fontSize`, aby chip rostl se stupněm písma jako celek.
 */
export function BlockDateChip({
  text, state, accent, fontSize,
  title, customBg, customBorder, customTextColor,
  onClick, onDoubleClick,
}: {
  text: string;
  state: DateChipState;
  /** Barva svislého proužku vlevo — identita pole (DATA / MAT / EXP / PANTONE). */
  accent: string;
  fontSize: number;
  title?: string;
  customBg?: string;
  customBorder?: string;
  customTextColor?: string;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
}) {
  const bg     = customBg ?? DEADLINE_BG[state];
  const border = customBorder ?? DEADLINE_BORDER[state];
  const color  = customTextColor ?? (state === "empty" ? "#fff" : "rgba(255,255,255,0.92)");
  return (
    <span
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        fontSize,
        fontWeight: 600,
        color,
        background: bg,
        borderTop: `1px solid ${border}`,
        borderRight: `1px solid ${border}`,
        borderBottom: `1px solid ${border}`,
        borderLeft: `2px solid ${accent}`,
        borderRadius: 4,
        padding: `${Math.round(fontSize * 0.26)}px ${Math.round(fontSize * 0.55)}px`,
        whiteSpace: "nowrap",
        flexShrink: 0,
        lineHeight: 1,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {text}
    </span>
  );
}
```

- [ ] **Krok 2: Nasadit v `MODE_COMPACT`**

V `BlockCard.tsx` smaž lokální `dateChip` (ř. 796-806) a nahraď čtyři `<span style={dateChip(...)}>` za `<BlockDateChip …>`.

Čtyři chipy se liší jen těmito hodnotami — zbytek (`fontSize={10}`, struktura) je u všech stejný:

| Chip | `accent` | `state` | `text` | Klik | Dvojklik | Obal |
| --- | --- | --- | --- | --- | --- | --- |
| DATA | `FIELD_ACCENT.DATA` | `dStateKey` | `D {datum}{dIcon}` nebo `dataDisplayLabel` | toggle `dataOk` (odložený o 350 ms, když je dvojklik aktivní) | kalendář nebo DTP popover | — |
| MATERIÁL | `FIELD_ACCENT.MATERIAL` | `mStateKey` | `M VYD.` / `M SKLAD` / `M {datum}{mIcon}` | toggle `materialOk` | kalendář, jen když `canEditMat` | `<MaterialNoteAffordance indicatorSize={4} indicatorTop={1} indicatorRight={1}>` |
| EXPEDICE | `FIELD_ACCENT.EXPEDICE` | `eStateKey` | `E {datum}` | žádný | žádný | — |
| PANTONE | `FIELD_ACCENT.PANTONE` | `pantoneStateKey` | `P {pantoneChipText(pIcon)}` | toggle `pantoneOk` | kalendář, jen když `canEditMat` | jen když `pantoneVisible` |

Handlery a podmínky se přenášejí **doslova** z dnešních `onClick` / `onDoubleClick` na těch `<span>`ech — včetně `e.stopPropagation()` a timerů `compactDataTimerRef` / `compactMatTimerRef` / `compactPanTimerRef`. Nic se nezjednodušuje; tenhle task je čistá extrakce.

Plný příklad pro chip DATA:

```tsx
              <BlockDateChip
                text={block.dataStatusId ? dataDisplayLabel : `D ${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
                state={dStateKey as DateChipState}
                accent={FIELD_ACCENT.DATA}
                fontSize={10}
                title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
                customBg={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
                customBorder={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
                customTextColor={block.dataStatusId && dataAccent !== s.accentBar ? (dataText ?? "#fff") : undefined}
                onClick={dataCanToggle ? (e) => { e.stopPropagation(); if (dataCanOpenCalendar || dataCanOpenDtpPopover) { if (compactDataTimerRef.current) clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = setTimeout(() => { compactDataTimerRef.current = null; toggleField("dataOk", block.dataOk); }, 350); } else { toggleField("dataOk", block.dataOk); } } : undefined}
                onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                  e.stopPropagation();
                  if (compactDataTimerRef.current) { clearTimeout(compactDataTimerRef.current); compactDataTimerRef.current = null; }
                  if (dataCanOpenCalendar) {
                    onInlineDatePick!(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect());
                  } else if (dataCanOpenDtpPopover) {
                    onDataChipDoubleClick!(block.id, e.currentTarget.getBoundingClientRect());
                  }
                } : undefined}
              />
```

Materiálový chip zůstává obalený v `<MaterialNoteAffordance>` — komponenta se nemění, jen její dítě.

- [ ] **Krok 3: Nasadit ve `showDatesCompact`**

Smaž lokální `cs` (ř. 1116-1126) a převeď čtyři `<span style={cs(...)}>` stejným způsobem, s `fontSize={10}` (sjednocení z dosavadních 9).

- [ ] **Krok 4: Uklidit importy**

Z `BlockCard.tsx` smaž `DEADLINE_BG` a `DEADLINE_BORDER` (ř. 72-89) a naimportuj je z nového souboru — `DateBadge` je pořád používá, takže musí zůstat dostupné:

```tsx
import { BlockDateChip, DEADLINE_BG, DEADLINE_BORDER, type DateChipState } from "@/components/planner/BlockDateChip";
```

- [ ] **Krok 5: Ověřit build a klikání**

```bash
npm run build
```

V prohlížeči na bloku dlouhém 1–1,5 h ověř, že klik na chip `D` přepne stav a dvojklik otevře kalendář — chování se nesmí změnit.

- [ ] **Krok 6: Commitnout**

```bash
git add src/components/planner/BlockDateChip.tsx src/components/planner/BlockCard.tsx
git commit -m "refactor(planner): jednořádkový datumový chip jako sdílená komponenta"
```

---

### Task 4: Zrušit dvouřádkový badge

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` — smazat `DateBadge` (ř. 92-164), sloučit `showDatesFull` / `showDatesCompact` (ř. 517-519), přepsat blok `showDates` (ř. 1053-1109), smazat blok `showDatesCompact` (ř. 1111-1159)

**Interfaces:**
- Consumes: `BlockDateChip`, `DateChipState` z Tasku 3.
- Produces: proměnná `showDates` (jediná), fungující i pro plný layout.

- [ ] **Krok 1: Sloučit prahy**

Nahraď `BlockCard.tsx:517-519`:

```tsx
  const showDatesFull    = !isTiskar && MODE_FULL && layoutHeight >= 60 && block.type !== "UDRZBA";
  const showDatesCompact = !isTiskar && MODE_FULL && layoutHeight < 60  && block.type !== "UDRZBA";
  const showDates        = showDatesFull;
```

za:

```tsx
  // Jeden jednořádkový chip pro celý plný layout. Do 8/2026 tu byly DVĚ podoby —
  // dvouřádkový DateBadge od 60 px a kompaktní chip pod ním. Sloučeno: chip nese
  // stejnou informaci, vejde se do menší výšky a zbylé místo platí větší písmo.
  const showDates = !isTiskar && MODE_FULL && block.type !== "UDRZBA";
```

- [ ] **Krok 2: Přepsat řádek datumů v plném layoutu**

Nahraď celý blok `{showDates && block.type !== "UDRZBA" && ( … )}` (ř. 1053-1109) čtyřmi `BlockDateChip`. Texty přebírají zkrácený formát, který dosud používal jen kompaktní režim — datum bez roku plus stavová ikona:

```tsx
      {/* ── Řádek 2: Datumové chipy (MODE_FULL) — vždy všechny, jednořádkové ── */}
      {showDates && (() => {
        const dSK: DateChipState = block.dataStatusId ? "ok" : !block.dataRequiredDate ? "empty" : dataDeadlineState === "none" ? "neutral" : dataDeadlineState;
        const mSK: DateChipState = block.materialIssued ? "issued" : block.materialInStock ? "ok" : (!block.materialRequiredDate ? "empty" : materialDeadlineState === "none" ? "neutral" : materialDeadlineState);
        const eSK: DateChipState = !block.deadlineExpedice ? "empty" : "neutral";
        const dIcon = dataDeadlineState === "ok" ? " ✓" : dataDeadlineState === "danger" ? " ✕" : dataDeadlineState === "warning" ? " !" : dataDeadlineState === "earlyStart" ? " ⚠" : "";
        const mIcon = materialDeadlineState === "ok" ? " ✓" : materialDeadlineState === "danger" ? " ✕" : materialDeadlineState === "warning" ? " !" : materialDeadlineState === "earlyStart" ? " ⚠" : "";
        const pIcon = pantoneEffectiveState === "ok" ? " ✓" : pantoneEffectiveState === "danger" ? " ✕" : pantoneEffectiveState === "warning" ? " !" : pantoneEffectiveState === "earlyStart" ? " ⚠" : "";
        return (
          <div
            style={{ padding: "2px 7px 3px", display: "flex", gap: 5, flexWrap: "nowrap", flexShrink: 0, alignItems: "center", overflow: "hidden" }}
            onMouseEnter={() => setBadgeHovered(true)}
            onMouseLeave={() => setBadgeHovered(false)}
          >
            <BlockDateChip
              text={block.dataStatusId ? dataDisplayLabel : `D ${block.dataRequiredDate ? `${fmtDateShort(block.dataRequiredDate)}${dIcon}` : "—"}`}
              state={dSK}
              accent={FIELD_ACCENT.DATA}
              fontSize={10}
              title={dataDeadlineState === "earlyStart" ? "Start zakázky před dodáním dat" : undefined}
              customBg={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
              customBorder={block.dataStatusId && dataAccent !== s.accentBar ? dataAccent : undefined}
              customTextColor={block.dataStatusId && dataAccent !== s.accentBar ? (dataText ?? "#fff") : undefined}
              onDoubleClick={(dataCanOpenCalendar || dataCanOpenDtpPopover) ? (e) => {
                e.stopPropagation();
                if (dataCanOpenCalendar) { onInlineDatePick?.(block.id, "data", block.dataRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); }
                else if (dataCanOpenDtpPopover) { onDataChipDoubleClick?.(block.id, e.currentTarget.getBoundingClientRect()); }
              } : undefined}
            />
            <MaterialNoteAffordance block={block}>
              <BlockDateChip
                text={`M ${block.materialIssued ? "VYD." : block.materialInStock ? "SKLAD" : block.materialRequiredDate ? `${fmtDateShort(block.materialRequiredDate)}${mIcon}` : "—"}`}
                state={mSK}
                accent={FIELD_ACCENT.MATERIAL}
                fontSize={10}
                title={materialDeadlineState === "earlyStart" ? "Start zakázky před dodáním materiálu" : undefined}
                onClick={materialHandled ? undefined : () => toggleField("materialOk", block.materialOk)}
                onDoubleClick={canEditMat ? (e) => { e.stopPropagation(); onInlineDatePick?.(block.id, "material", block.materialRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}
              />
            </MaterialNoteAffordance>
            <BlockDateChip
              text={`E ${block.deadlineExpedice ? fmtDateShort(block.deadlineExpedice) : "—"}`}
              state={eSK}
              accent={FIELD_ACCENT.EXPEDICE}
              fontSize={10}
            />
            {pantoneVisible && (
              <BlockDateChip
                text={`P ${pantoneChipText(pIcon)}`}
                state={pantoneStateKey as DateChipState}
                accent={FIELD_ACCENT.PANTONE}
                fontSize={10}
                title={pantoneEffectiveState === "earlyStart" ? "Start zakázky před dodáním pantonu" : undefined}
                customBg={block.pantoneIssued ? DEADLINE_BG.issued : undefined}
                customBorder={block.pantoneIssued ? DEADLINE_BORDER.issued : undefined}
                onClick={pantoneHandled ? undefined : () => toggleField("pantoneOk", block.pantoneOk)}
                onDoubleClick={canEditMat ? (e) => { e.stopPropagation(); onInlineDatePick?.(block.id, "pantone", block.pantoneRequiredDate ?? "", e.currentTarget.getBoundingClientRect()); } : undefined}
              />
            )}
          </div>
        );
      })()}
```

- [ ] **Krok 3: Smazat mrtvý kód**

1. Smaž celý blok `{showDatesCompact && (() => { … })()}` (ř. 1111-1159) — jeho úloha přešla na sloučený `showDates`.
2. Smaž funkci `DateBadge` (ř. 92-164).
3. Ověř, že `DateBadge` opravdu nikdo jiný nevolá:

```bash
grep -rn "DateBadge" src/
```

Očekávání: **žádný výstup.** Pokud něco vypíše, volání se nejdřív převede, teprve pak se maže.

- [ ] **Krok 4: Ověřit build a proklikat**

```bash
npm run build
grep -c "fontSize" src/components/planner/BlockCard.tsx
```

Druhý příkaz musí vrátit méně než 48 (výchozí stav) — dvouřádkový badge měl tři vlastní `fontSize`.

V prohlížeči na zakázce dlouhé 2 h ověř: řádek datumů je jednořádkový, obsahuje D/M/E (a P, pokud je pantone), klik i dvojklik fungují, pás specifikace se pořád kreslí.

- [ ] **Krok 5: Commitnout**

```bash
git add src/components/planner/BlockCard.tsx
git commit -m "refactor(planner): plný layout používá jednořádkový datumový chip, DateBadge zrušen"
```

---

### Task 5: Tiskařský výškový rozpočet ze stupně písma

`tiskarBlockView.ts` obsahuje **druhou, nezávislou kopii** výškového rozpočtu karty: `printDoneSize` má práh 48 px s komentářem „od 48 px je MODE_FULL" a `splitChipFits` počítá s `HEADER_ROW_PX = 23`, odvozeným z napevno zapsaného písma 12 px. Kdyby písmo vyrostlo a tenhle modul zůstal, vrátila by se regrese z 3. 8. 2026 — tiskaři by tlačítko Hotovo propadlo pod ořez karty.

Tento task modul parametrizuje. Při výchozím stupni `M` se chování nemění.

**Files:**
- Modify: `src/lib/tiskarBlockView.ts`
- Test: `src/lib/tiskarBlockView.test.ts` (existuje, 15 testů)

**Interfaces:**
- Consumes: `PlannerTypeScale`, `plannerTypeScale`, `DEFAULT_FONT_SCALE` z Tasku 1.
- Produces: `printDoneSize(layoutHeight, ts?)`, `splitChipFits(layoutHeight, printDone, specRows, ts?)` — oba s nepovinným posledním parametrem, výchozí `plannerTypeScale(DEFAULT_FONT_SCALE)`.

- [ ] **Krok 1: Napsat padající testy**

Nejdřív doplň import **mezi ostatní importy nahoře souboru** (ne k testům dole — v ESM musí být importy na začátku modulu):

```ts
import { plannerTypeScale } from "./plannerTypography";
```

Pak přidej na konec `src/lib/tiskarBlockView.test.ts`:

```ts
test("bez stupně se rozpočet chová jako dnes (stupeň M)", () => {
  assert.deepEqual(printDoneSize(50), printDoneSize(50, plannerTypeScale("M")));
  assert.deepEqual(printDoneSize(20), printDoneSize(20, plannerTypeScale("M")));
});

test("práh pruhu Hotovo sleduje práh plného layoutu daného stupně", () => {
  // Karta o výšce těsně pod prahem plného layoutu nesmí dostat pruh přes
  // celou šířku — nevejde se a vytlačil by obsah pod ořez.
  for (const key of ["M", "L", "XL"] as const) {
    const ts = plannerTypeScale(key);
    const justBelow = ts.thresholds.full - 1;
    assert.equal(printDoneSize(justBelow, ts)?.variant, "square", `${key}: pod prahem čtverec`);
    assert.equal(printDoneSize(ts.thresholds.full, ts)?.variant, "bar", `${key}: na prahu pruh`);
  }
});

test("ve větším písmu je SplitChip odmítnut dřív", () => {
  const m = plannerTypeScale("M");
  const xl = plannerTypeScale("XL");
  // Výška, kde se při M chip ještě vejde vedle pruhu Hotovo a jednoho řádku spec.
  const h = 120;
  const fitsM = splitChipFits(h, printDoneSize(h, m), 1, m);
  const fitsXL = splitChipFits(h, printDoneSize(h, xl), 1, xl);
  assert.equal(fitsM, true, "při M se chip vejde");
  assert.ok(!fitsXL || fitsM, "větší písmo nesmí být štědřejší než menší");
});
```

- [ ] **Krok 2: Spustit a ověřit pád**

```bash
node --test --import tsx src/lib/tiskarBlockView.test.ts
```

Očekávání: FAIL — `printDoneSize` bere jen jeden argument.

- [ ] **Krok 3: Parametrizovat modul**

V `src/lib/tiskarBlockView.ts` přidej import a přepiš obě funkce. Napevno zapsané konstanty `HEADER_ROW_PX` / `SPEC_ROW_1_PX` / `SPEC_ROW_2_PX` **smaž** — nahrazuje je `ts.rowHeights`:

```ts
import { DEFAULT_FONT_SCALE, plannerTypeScale, type PlannerTypeScale } from "./plannerTypography";

const DEFAULT_TS = plannerTypeScale(DEFAULT_FONT_SCALE);

/**
 * Rozměr tlačítka Hotovo pro danou výšku bloku (`layoutHeight` z BlockCard).
 * Prahy navazují na layout režimy karty: od `ts.thresholds.full` je plný layout
 * a vejde se pruh přes celou šířku, od `ts.thresholds.micro` čtverec s háčkem,
 * pod tím karta nevykresluje obsah vůbec → `null`.
 *
 * Prahy 140 a 96 (vyšší varianty pruhu) rostou se stupněm písma, aby velké
 * tlačítko nikdy nedostala karta, které na něj nezbývá výška.
 */
export function printDoneSize(layoutHeight: number, ts: PlannerTypeScale = DEFAULT_TS): PrintDoneSize | null {
  const big = Math.round(140 * ts.slotFactor);
  const mid = Math.round(96 * ts.slotFactor);
  if (layoutHeight >= big) return { variant: "bar", height: 40, fontSize: Math.round(16 * ts.slotFactor) };
  if (layoutHeight >= mid) return { variant: "bar", height: 32, fontSize: Math.round(14 * ts.slotFactor) };
  if (layoutHeight >= ts.thresholds.full) return { variant: "bar", height: 24, fontSize: 11.5 };
  if (layoutHeight >= ts.thresholds.micro) return { variant: "square", height: 26, fontSize: 15 };
  return null;
}

/**
 * Vejde se SplitChip do karty, aniž by vytlačil tlačítko Hotovo pod ořez?
 *
 * Bez této brzdy skončil na hodinovém bloku (52 px) se split partnerem celý
 * zelený pruh Hotovo mimo kartu a tiskař neměl jak potvrdit tisk — regrese
 * zachycená před nasazením 3. 8. 2026. Výšky řádků se od 8/2026 berou ze stupně
 * písma (`ts.rowHeights`), ne z napevno zapsaných čísel — jinak by se ta regrese
 * při zvětšení písma vrátila.
 */
export function splitChipFits(
  layoutHeight: number,
  printDone: PrintDoneSize | null,
  specRows: 0 | 1 | 2,
  ts: PlannerTypeScale = DEFAULT_TS
): boolean {
  const barReserve = printDone?.variant === "bar" ? printDone.height + PRINT_BAR_PADDING_PX : 0;
  const specReserve = specRows === 2 ? ts.rowHeights.spec2 : specRows === 1 ? ts.rowHeights.spec1 : 0;
  const used = ts.rowHeights.header + specReserve + barReserve;
  return layoutHeight - used >= SPLIT_CHIP_PX;
}
```

- [ ] **Krok 4: Spustit testy**

```bash
node --test --import tsx src/lib/tiskarBlockView.test.ts
```

Očekávání: PASS, 18 testů. Pokud spadne některý z původních 15, znamená to, že se `M` nechová jako dnešek — oprav vzorce v `rowHeights`, ne testy.

- [ ] **Krok 5: Ověřit build a commitnout**

```bash
npm run build
git add src/lib/tiskarBlockView.ts src/lib/tiskarBlockView.test.ts
git commit -m "refactor(tiskar): výškový rozpočet karty se odvozuje ze stupně písma"
```

---

### Task 6: Zapojit stupeň písma do karty bloku

Tady se to celé spojí. Písmo i prahy se musí změnit **naráz** — kdyby vyrostlo jen písmo, obsah karty by se oříznul (to je přesně selhání zamítnuté cesty B).

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` — nový prop `typeScale`, průchod do `BlockCard` (ř. 2075-2133)
- Modify: `src/app/_components/PlannerPage.tsx` — předat `typeScale` do `TimelineGrid` (ř. 3086 okolí)
- Modify: `src/components/planner/BlockCard.tsx` — prop `typeScale`, prahy, velikosti písma, kontrast

**Interfaces:**
- Consumes: `PlannerTypeScale`, `plannerTypeScale`, `DEFAULT_FONT_SCALE` z Tasku 1; `typeScale` z `PlannerPage` (Task 2); `printDoneSize` / `splitChipFits` s novým parametrem (Task 5).
- Produces: nic pro další tasky.

- [ ] **Krok 1: Protáhnout prop skrz TimelineGrid**

V `TimelineGrid.tsx` přidej do props interface (vedle `slotHeight?: number`, ř. 210):

```tsx
  /** Stupeň písma. Nepovinný — bez něj se karta chová jako při výchozím M. */
  typeScale?: PlannerTypeScale;
```

a do destrukturalizace (ř. 514 okolí) `typeScale = plannerTypeScale(DEFAULT_FONT_SCALE),`. Pak předej do `BlockCard` (ř. 2075):

```tsx
                      typeScale={typeScale}
```

V `PlannerPage.tsx` k `slotHeight={gridSlotHeight}` přidej `typeScale={typeScale}`.

- [ ] **Krok 2: Přijmout prop v BlockCard a nastavit prahy**

V `BlockCard.tsx` přidej do props (za `shadeParity?: 0 | 1;`):

```tsx
  /** Stupeň písma. Nepovinný kvůli DtpPanel, který kartu vykresluje bez planneru. */
  typeScale?: PlannerTypeScale;
```

a do destrukturalizace `typeScale = plannerTypeScale(DEFAULT_FONT_SCALE),`.

Nahraď prahy (ř. 512-515):

```tsx
  const MODE_FULL    = layoutHeight >= typeScale.thresholds.full;
  const MODE_COMPACT = !MODE_FULL && layoutHeight >= typeScale.thresholds.compact && block.type !== "UDRZBA";
  const MODE_TINY    = !MODE_FULL && !MODE_COMPACT && layoutHeight >= typeScale.thresholds.tiny;
  const MODE_MICRO_TEXT = !MODE_FULL && !MODE_COMPACT && !MODE_TINY && layoutHeight >= typeScale.thresholds.micro;
```

a prahy specifikace (ř. 526-527):

```tsx
  const showSpec     = isTiskar ? layoutHeight >= typeScale.tiskarSpecMin : MODE_FULL;
  const specTwoLine  = layoutHeight >= typeScale.specTwoLine;
```

Uprav i výpočet počtu řádků popisu (ř. 539) — dnes dělí napevro 13 px na řádek:

```tsx
  const descLineClamp = layoutHeight < typeScale.thresholds.full * 1.4
    ? 1
    : Math.max(2, Math.floor((layoutHeight - typeScale.thresholds.full - 7) / Math.round(typeScale.desc * 1.3)));
```

Předej stupeň do tiskařského rozpočtu (ř. 416):

```tsx
  const printDone = printDoneSize(layoutHeight, typeScale);
```

a najdi volání `splitChipFits(...)` (`grep -n "splitChipFits" src/components/planner/BlockCard.tsx`) a přidej `typeScale` jako čtvrtý argument.

- [ ] **Krok 3: Nahradit velikosti písma**

Nahraď napevno zapsané `fontSize` hodnotami ze `typeScale`. Mapování:

| Dnes | Nově | Kde |
| --- | --- | --- |
| `fontSize: 12` u čísla, `fontWeight: 700` | `fontSize: typeScale.num, fontWeight: 800` | plný layout, ř. 1017 |
| `fontSize: 10` u popisu, `opacity: 0.75` | `fontSize: typeScale.desc, opacity: typeScale.descOpacity` | ř. 1026 |
| `fontSize: 11` / `10` u čísla | `fontSize: typeScale.num * 0.92` | COMPACT ř. 853, TINY ř. 968 |
| `fontSize: 9` u popisu, `opacity: 0.75` | `fontSize: typeScale.desc * 0.9, opacity: typeScale.descOpacityTiny` | ř. 860, 973 |
| `fontSize={10}` u `BlockDateChip` | `fontSize={typeScale.chip}` | všechna volání z Tasků 3 a 4 |
| `fontSize: 9` u štítků deadline a kalendáře | `fontSize: typeScale.badge` | ř. 681, 726 |

`MiniChip` a `SpecBand` / `SpecChip` dostanou velikost propem:

```tsx
function MiniChip({ label, accent, textColor, fontSize }: { label: string; accent: string; textColor?: string; fontSize: number }) {
```

— uvnitř `fontSize` místo `9`; ve volajících `fontSize={typeScale.mini}`. Stejně `SpecBand`/`SpecChip` v `src/components/planner/SpecBand.tsx` dostanou `fontSize: number` a volající předá `typeScale.spec` resp. `typeScale.specChip`.

Značky `↻` a `✂` zůstávají utlumené (`opacity` 0,4 a 0,55) — jsou to vědomě podřadné informace, mění se jim jen velikost na `typeScale.mini * 0.9`.

- [ ] **Krok 4: Ověřit build**

```bash
npm run build
```

- [ ] **Krok 5: Proklikat všechny stupně a délky**

```bash
npm run dev
```

Pro každý stupeň `M`, `L`, `XL` při maximálním přiblížení projdi zakázky délek 30 min, 1 h, 1,5 h, 2 h a 4 h a ověř:

1. Písmo je znatelně větší než v předchozím stupni.
2. **Hodinová zakázka má pořád řádek datumů D/M/E** — to je nejtěsnější místo celé etapy.
3. **Půlhodinová zakázka je pořád jednořádková**, ne jen pruh.
4. Text nikde nepřetéká přes okraj karty a pás specifikace se nekreslí přes tlačítko.
5. Přepni se na účet s rolí `TISKAR` a zkontroluj, že tlačítko Hotovo je vidět celé na hodinovém bloku i ve stupni XL.

Pokud bod 2 nebo 3 selže, **neupravuj prahy v komponentě** — sniž konstanty `NUM_ROW_FACTOR` / `CHIP_ROW_FACTOR` v `plannerTypography.ts` a nech rozhodnout strážný test z Tasku 1.

- [ ] **Krok 6: Spustit celou sadu a commitnout**

```bash
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add src/components/planner/BlockCard.tsx src/components/planner/SpecBand.tsx src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(planner): velikost písma v kartě bloku se řídí zvoleným stupněm"
```

---

### Task 7: Časová osa a hlavička stroje

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:1721`, `:1759` (popisky hodin), `:1257` (hlavička stroje)

**Interfaces:**
- Consumes: `typeScale` z Tasku 6 (prop už v komponentě je).
- Produces: nic.

- [ ] **Krok 1: Zvětšit popisky hodin**

Na ř. 1721 a 1759 je dvakrát tentýž `<span>` s `fontSize: 9`. Nahraď v obou:

```tsx
                <span style={{ fontSize: typeScale.rail, lineHeight: 1, color: m.isFullHour ? "var(--text-muted)" : "color-mix(in oklab, var(--border) 85%, transparent)", fontWeight: m.isFullHour ? 500 : 400 }}>
```

- [ ] **Krok 2: Zvětšit hlavičku stroje**

Na ř. 1257 má hlavička velikost z Tailwind třídy `text-xs`. Odeber `text-xs` z `className` a dej velikost inline (Tailwind v4 nepodporuje dynamické třídy):

```tsx
        <div key={machine} style={{ flex: 1, padding: "8px 12px", color: "var(--text)", display: "flex", alignItems: "center", gap: 8, fontSize: typeScale.machineHead }} className="font-bold">
```

- [ ] **Krok 3: Ověřit build a vzhled**

```bash
npm run build
```

V prohlížeči přepni na `XL` a zkontroluj, že popisky hodin nejsou přes sebe. Při odzoomu (slider vlevo) se popisky ředí přes `labelStep` (ř. 1399), který se řídí `slotHeight` — ověř, že při stupni XL a nejmenším zoomu jsou pořád čitelné a nepřekrývají se.

- [ ] **Krok 4: Commitnout**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat(planner): časová osa a hlavička stroje sledují stupeň písma"
```

---

### Task 8: Ověření na reálných datech a dokumentace

**Files:**
- Modify: `CLAUDE.md` (sekce Design tokens a vizuální konvence)
- Modify: `docs/vyvoj-historie.md`

- [ ] **Krok 1: Postavit testovací instanci nad kopií produkce**

Podle `docs/DEPLOY_WORKFLOW.md` si stáhni kopii produkční DB a pusť nad ní lokální instanci. Model v návrhovém náhledu není důkaz o skutečném renderu — proklikání nad reálnými daty našlo 9. 8. 2026 sedm vad, které testy ani review nechytily.

- [ ] **Krok 2: Projít kontrolní seznam**

Pro každý stupeň `M` / `L` / `XL`:

1. Zakázka s dlouhým popisem — popis se ořezává elipsou, nikdy nepřetéká.
2. Zakázka se všemi čtyřmi chipy včetně Pantonu na úzkém okně (zúži prohlížeč na ~1366 px) — chipy se nezalamují, popis ustoupí.
3. Split skupina — `✂ 1/3` je vidět a tlačítko Hotovo u tiskaře taky.
4. Blok přes odstávku (s pauzou uvnitř) — obsah zůstává v tiskové části, nepropadá do šrafované pauzy.
5. Zamčený blok a nepotvrzená rezervace — levý pruh 22 px nepřekrývá text.
6. Blok se štítkem `⚠ PO DEADLINE` i `⏸ ODLOŽENO` naráz — štítky se nepřekrývají.
7. Světlý i tmavý motiv.

- [ ] **Krok 3: Doplnit konvenci do CLAUDE.md**

Do sekce „Design tokens a vizuální konvence" přidej odrážku:

```markdown
- **Velikost písma v plánu** vždy přes `src/lib/plannerTypography.ts`, nikdy napevno zapsaný `fontSize` v kartě bloku ani na časové ose. Prahy hustoty (`MODE_FULL`/`COMPACT`/`TINY`/`MICRO`) se z písma POČÍTAJÍ — kdo přidá nový prvek do karty, musí zkontrolovat, že se vejde i v `XL` (strážný test `plannerTypography.test.ts`). Výškový rozpočet tiskařské karty (`tiskarBlockView.ts`) je na týchž hodnotách závislý a nesmí se rozejít.
```

- [ ] **Krok 4: Doplnit historii**

Do `docs/vyvoj-historie.md` přidej sekci s datem, odkazem na spec a shrnutím: co se změnilo, že `DateBadge` zanikl a proč je nastavení vázané na zařízení.

- [ ] **Krok 5: Commitnout**

```bash
git add CLAUDE.md docs/vyvoj-historie.md
git commit -m "docs: konvence velikosti písma v plánu + historie etapy"
```

---

## Poznámky k odchylkám od specu

Během psaní plánu vyšly najevo dvě věci, které spec popisuje nepřesně:

1. **Mini-chipy už jsou vpravo vedle čísla.** Spec tvrdí, že se v plném layoutu „přesouvají doprava na řádek s číslem" — jsou tam ale od začátku (`BlockCard.tsx:1036-1049`). Veškerý zisk výšky pochází z náhrady dvouřádkového badge jednořádkovým chipem. Na spočítané hodnoty to nemá vliv (počítaly se výšky řádků, ne pozice chipů), na rozsah práce ano — je menší.
2. **Výškový rozpočet existuje podruhé v `tiskarBlockView.ts`** a spec ho nezmiňuje. Dostal vlastní Task 5, protože jeho opomenutí by vrátilo regresi z 3. 8. 2026.
