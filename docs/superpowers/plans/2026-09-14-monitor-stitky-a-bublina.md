# Štítky BARVY a LAK na Monitoru + bublina nad druhým strojem — implementační plán

> **Pro agentické pracovníky:** POVINNÝ SUB-SKILL: superpowers:subagent-driven-development (doporučeno) nebo superpowers:executing-plans. Plán se plní task po tasku, kroky mají zaškrtávací syntaxi (`- [ ]`).

**Cíl:** Monitor u stroje ukáže štítky BARVY a LAK všude, i v sekci NEDODĚLÁNO. Hover bublina v plánu se přesune nad druhý stroj a otevře se až po 400 ms.

**Architektura:** Pravidla zůstávají v čistých funkcích v `src/lib/` (`buildMonitorChips`, `monitorChipsRowStyle`, `hoverTooltipPlacement`), pokrytých unit testy. Komponenty z nich jen čtou. Zapojení komponent hlídají strážné testy nad zdrojákem (vzor `autoShiftWiring.test.ts`). Bublina se nejdřív beze změny chování vytáhne z `BlockCard.tsx` do vlastní komponenty. Teprve pak se jí mění poloha a přidává prodleva.

**Tech stack:** Next.js 16 (App Router), React 18.3, TypeScript 5.9, testy `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-14-monitor-stitky-a-bublina-design.md` (commit `7140e3a8`). Plán se o spec opírá; implementující čte obojí.

## Globální omezení

- Větev `Vojta`. Každý task končí jedním commitem. Zprávu commitu piš VÝHRADNĚ přes heredoc `git commit -F - <<'EOF'` (POUCENI P8) a zakonči ji řádkem `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Nové testy MUSÍ ležet přímo v `src/lib/`. Glob test suite nejde do podsložek (CLAUDE.md).
- Jeden testový soubor: `node --test --import tsx src/lib/<soubor>.test.ts`.
- Celá suite: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`.
- **Výchozí stav suite (14. 9. 2026): 1461 testů, 1416 zelených, 45 červených.** Všech 45 selhání je v `src/lib/revision.server.test.ts`. Příčina je prostředí, ne kód: na portu 3306 běží Homebrew MySQL a odmítá přihlášení z `.env`. Po každém tasku musí zůstat právě těchto 45 selhání. Počet zelených vzroste o nové testy tasku.
- Typová kontrola: `npx tsc --noEmit -p .` (výchozí stav: exit 0, žádný výstup). **`npm run build` NESPOUŠTĚJ v taskech 1–5.** Zapisuje do `.next`, kterou sdílí Vojtův server na portu 3111. Build patří až do tasku 6.
- Lint: `npm run lint`. Warningy jsou OK, chyby ne.
- Monitor: v `src/components/monitor/*.tsx` nesmí být holý `fontSize`, velikosti jdou jen přes `ts.*` (strážný test `monitorTypography.test.ts`).
- `src/components/monitor/MonitorView.tsx` (646 řádků při limitu 500) se v této etapě NEMĚNÍ (spec odd. 1.3).
- Barvy v nových řádcích komponent jen přes tokeny. Kód přesouvaný v tasku 4 si ponechává své stávající literály doslova: je to přesun, ne nový kód.
- České uvozovky „…“ v řetězcových literálech kódu piš do jednoduše uvozeného řetězce (POUCENI P10). V komentářích a JSX komentářích nevadí.
- Nová komponenta = named export v `src/components/planner/`, soubor pod 500 řádků.
- Každý strážný test, který hlídá konkrétní řádek, se ověří z druhé strany (POUCENI P11): hlídaný řádek dočasně rozbij → test MUSÍ spadnout → vrať řádek → test projde.
- Hodnoty ze specu doslova: šířka bubliny 240 px (`TOOLTIP_W`), vodorovný okraj 10 px (`TOOLTIP_MARGIN`), svislý okraj 6 px (`TOOLTIP_VERTICAL_GAP`), prodleva 400 ms (`TOOLTIP_OPEN_DELAY_MS`).

## Mapa souborů

| Soubor | Odpovědnost | Task |
| --- | --- | --- |
| `src/lib/monitorChips.ts` | pravidla štítků Monitoru + styl jejich obalu | 1, 2 |
| `src/lib/monitorChips.test.ts` | unit testy obou | 1, 2 |
| `src/lib/monitorChipsWiring.test.ts` (nový) | strážný test zapojení štítků ve frontě a obalu | 2 |
| `src/components/monitor/MonitorChips.tsx` | vykreslení štítků (velká karta, fronta) | 2 |
| `src/components/monitor/MonitorQueue.tsx` | fronta DNES/ZÍTRA/NEDODĚLÁNO | 2 |
| `prisma/seed-monitor.ts` | testovací data Monitoru (dev) | 2 |
| `src/lib/plannerHoverTooltip.ts` | geometrie bubliny + prodleva | 3 |
| `src/lib/plannerHoverTooltip.test.ts` | tabulkové testy geometrie | 3 |
| `src/components/planner/BlockHoverTooltip.tsx` (nový) | bublina: měření výšky, poloha, obsah, portál | 4, 5 |
| `src/components/planner/BlockCard.tsx` | karta bloku: kdy bublina smí vyskočit (časovač) | 4, 5 |
| `src/lib/plannerHoverWiring.test.ts` (nový) | strážný test zapojení bubliny | 5 |
| `src/app/_components/TimelineGrid.tsx` | jen komentář u háku `data-machine-col` | 5 |
| `CLAUDE.md`, `docs/vyvoj-historie.md` | dokumentace | 2, 5 |

Pořadí: 1 → 2 (Monitor) a 3 → 4 → 5 (bublina) jsou dvě nezávislé větve. Task 5 potřebuje 3 i 4. Task 6 (ověření v běžící appce) je poslední.

---

### Task 1: BARVY a LAK v `buildMonitorChips`

**Soubory:**
- Upravit: `src/lib/monitorChips.ts` (hlavička ř. 8–21, vložení za blok PANTONE ř. 60–66)
- Test: `src/lib/monitorChips.test.ts`

**Rozhraní:**
- Vstup: nic z předchozích tasků.
- Výstup: `buildMonitorChips(block: Block): MonitorChip[]` vrací navíc `{ label: <barvyStatusLabel po trim()>, tone: "plain" }` a `{ label: <lakStatusLabel po trim()>, tone: "plain" }`. Jsou v tomto pořadí za štítkem PANTONE a před štítkem nestandardní varianty.

- [ ] **Krok 1: Uprav test pořadí a přidej nové testy (zatím padají)**

V `src/lib/monitorChips.test.ts` nahraď celý test začínající `test("buildMonitorChips: pořadí je obálka → vnitřky → archy → série → data → materiál → pantone → varianta"` tímto:

```ts
test("buildMonitorChips: pořadí je obálka → vnitřky → archy → série → data → materiál → pantone → barvy → lak → varianta", () => {
  const chips = buildMonitorChips(mk({
    obalka: true,
    vnitrky: true,
    tiskoveArchy: serializeProductionTags(["3. TA"]),
    serie: serializeProductionTags(["2. série"]),
    dataStatusLabel: "Data OK",
    dataOk: true,
    materialStatusLabel: "Skladem",
    materialInStock: true,
    pantoneOk: true,
    barvyStatusLabel: "SCH Lumina LED",
    lakStatusLabel: "UV lak",
    blockVariant: "POZASTAVENO",
  }));
  assert.deepEqual(chips, [
    { label: "OBÁLKA", tone: "brand" },
    { label: "VNITŘKY", tone: "brand" },
    { label: "3 TA", tone: "plain" },
    { label: "2 série", tone: "plain" },
    { label: "Data OK", tone: "ok" },
    { label: "Skladem", tone: "ok" },
    { label: "MAT. SKLADEM ✓", tone: "ok" },
    { label: "PANTONE", tone: "ok" },
    { label: "SCH Lumina LED", tone: "plain" },
    { label: "UV lak", tone: "plain" },
    { label: "Pozastaveno", tone: "danger" },
  ]);
});
```

Na konec souboru přidej:

```ts
test("buildMonitorChips: barvy a lak mají vlastní neutrální štítek (prosba plánovače 14. 9. 2026)", () => {
  assert.deepEqual(buildMonitorChips(mk({ barvyStatusLabel: "SCH Lumina LED" })), [
    { label: "SCH Lumina LED", tone: "plain" },
  ]);
  assert.deepEqual(buildMonitorChips(mk({ lakStatusLabel: "disperse lesk" })), [
    { label: "disperse lesk", tone: "plain" },
  ]);
});

test("buildMonitorChips: prázdné, jen mezerové nebo chybějící barvy/lak štítek nedělají", () => {
  assert.deepEqual(buildMonitorChips(mk({ barvyStatusLabel: "", lakStatusLabel: "   " })), []);
  assert.deepEqual(buildMonitorChips(mk({ barvyStatusLabel: null, lakStatusLabel: null })), []);
  assert.deepEqual(buildMonitorChips(mk()), []);
});

test("buildMonitorChips: text barev a laku se jen ořízne o okrajové mezery, jinak zůstává z číselníku", () => {
  assert.deepEqual(
    buildMonitorChips(mk({ barvyStatusLabel: "  IML COLORGRAF ", lakStatusLabel: "vysoce lesklá disperse" })),
    [
      { label: "IML COLORGRAF", tone: "plain" },
      { label: "vysoce lesklá disperse", tone: "plain" },
    ],
  );
});
```

- [ ] **Krok 2: Spusť testy a ověř, že padají**

Spusť: `node --test --import tsx src/lib/monitorChips.test.ts`
Očekáváno: FAIL. Test pořadí a tři nové testy selžou, protože štítky barvy/lak chybí.

- [ ] **Krok 3: Implementuj**

V `src/lib/monitorChips.ts` vlož mezi konec bloku PANTONE (řádek s `chips.push({ label: pantoneLabel, tone: pantoneReady ? "ok" : "wait" });` a jeho uzavírací `}`) a komentář `// Nestandardní varianta zakázky …` tento kód:

```ts
  // Barvy a lak (14. 9. 2026, prosba plánovače „všechny štítky"). Štítky jsou
  // v aplikaci šestice DATA · MATERIÁL · BARVY · LAK · ARCHY · SÉRIE a Monitoru
  // chyběly právě tyhle dva. Tón je ZÁMĚRNĚ `plain`: barvy a lak nemají stav
  // hotovo/čeká, a zelená s jantarovou nesou na Monitoru právě tenhle význam.
  // Karta v plánu je kreslí barvou z číselníku (`MiniChip` + `badgeColorMap`) —
  // vědomá odchylka, ne rozejití pravidel (viz hlavička).
  const barvyLabel = block.barvyStatusLabel?.trim();
  if (barvyLabel) chips.push({ label: barvyLabel, tone: "plain" });
  const lakLabel = block.lakStatusLabel?.trim();
  if (lakLabel) chips.push({ label: lakLabel, tone: "plain" });

```

V hlavičce funkce najdi odstavec začínající slovy „Pozor:" a nahraď jeho poslední řádek — ten, který končí textem `(viz nález I5, kde se to jednou rozešlo).` — těmito řádky (první z nich je ten původní, beze změny):

```ts
 * ručně promítnout i do `BlockCard.tsx` (viz nález I5, kde se to jednou rozešlo).
 * Výjimka je vědomá: barvy a lak kreslí karta v plánu barvou z číselníku,
 * Monitor neutrálně (tón `plain`) — zelená a jantarová tu znamenají
 * „připraveno" a „čeká", a takový stav barvy ani lak nemají (14. 9. 2026).
```

- [ ] **Krok 4: Spusť testy a ověř, že projdou**

Spusť: `node --test --import tsx src/lib/monitorChips.test.ts`
Očekáváno: PASS, všechny testy souboru zelené.

Spusť: `npx tsc --noEmit -p .`
Očekáváno: exit 0, žádný výstup.

- [ ] **Krok 5: Commit**

```bash
git add src/lib/monitorChips.ts src/lib/monitorChips.test.ts
git commit -F - <<'EOF'
feat(monitor): štítky BARVY a LAK na Monitoru

Monitor ukazoval z šestice štítků DATA/MATERIÁL/BARVY/LAK/ARCHY/SÉRIE všechny
kromě barev a laku, přestože je tiskař vidí na kartě v plánu (prosba plánovače,
září 2026, volba M1 = A). Nové štítky jsou za PANTONE, před variantou, s tónem
plain — barvy a lak nemají stav hotovo/čeká.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Štítky v sekci NEDODĚLÁNO + pojistka velké karty

**Soubory:**
- Upravit: `src/lib/monitorChips.ts` (nový export `monitorChipsRowStyle`)
- Upravit: `src/lib/monitorChips.test.ts`
- Vytvořit: `src/lib/monitorChipsWiring.test.ts`
- Upravit: `src/components/monitor/MonitorChips.tsx` (ř. 4 import, ř. 18 styl obalu)
- Upravit: `src/components/monitor/MonitorQueue.tsx` (ř. 28–35 doc, ř. 82–86 doc `compact`, ř. 116 gap, ř. 185 štítky)
- Upravit: `prisma/seed-monitor.ts` (nová zakázka `MON-2410`)
- Upravit: `docs/vyvoj-historie.md` (nový oddíl na konec)

**Rozhraní:**
- Vstup: `buildMonitorChips` z tasku 1.
- Výstup: `monitorChipsRowStyle(size: "hero" | "queue"): CSSProperties` z `src/lib/monitorChips.ts`.

- [ ] **Krok 1: Napiš padající testy**

V `src/lib/monitorChips.test.ts` změň import na:

```ts
import { buildMonitorChips, monitorChipsRowStyle } from "./monitorChips.js";
```

a na konec souboru přidej:

```ts
test("monitorChipsRowStyle: na velké kartě smí štítky ustoupit jako první (pojistka časové osy)", () => {
  const s = monitorChipsRowStyle("hero");
  assert.equal(s.minHeight, 0);
  assert.equal(s.overflow, "hidden");
  assert.equal(s.flexWrap, "wrap");
  assert.equal(s.gap, 6);
});

test("monitorChipsRowStyle: ve frontě štítky rostou do výšky a nic se neořezává", () => {
  const s = monitorChipsRowStyle("queue");
  assert.equal(s.minHeight, undefined);
  assert.equal(s.overflow, undefined);
  assert.equal(s.flexWrap, "wrap");
  assert.equal(s.gap, 5);
});
```

Vytvoř `src/lib/monitorChipsWiring.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test zapojení štítků Monitoru (etapa 1 září, 14. 9. 2026).
 *
 * Sekce NEDODĚLÁNO byla od 13. 8. 2026 záměrně bez štítků (zúžený řádek).
 * 14. 9. 2026 Vojta rozhodl opak (volba M2 = B: štítky všude). Starý stav ale
 * dál popisuje řada dokumentů a pamětí, takže hrozí, že ho někdo v dobré víře
 * „vrátí". Tenhle test to zachytí.
 *
 * Pojistka velké karty (`monitorChipsRowStyle`, spec odd. 1.3) platí jen
 * tehdy, když ji komponenta opravdu použije — čistá funkce sama nestačí (P15).
 */
const queue = stripComments(readFileSync("src/components/monitor/MonitorQueue.tsx", "utf8"));
const chips = stripComments(readFileSync("src/components/monitor/MonitorChips.tsx", "utf8"));

test("sekce NEDODĚLÁNO kreslí štítky stejně jako DNES/ZÍTRA (volba M2 = B)", () => {
  assert.match(queue, /<MonitorChips\s+block=\{b\}\s+size="queue"/);
  assert.doesNotMatch(queue, /!compact\s*&&\s*<MonitorChips/);
});

test("obal štítků bere styl z monitorChipsRowStyle (pojistka velké karty)", () => {
  assert.match(chips, /style=\{monitorChipsRowStyle\(size\)\}/);
});
```

- [ ] **Krok 2: Ověř, že padají**

Spusť: `node --test --import tsx src/lib/monitorChips.test.ts src/lib/monitorChipsWiring.test.ts`
Očekáváno: FAIL. `monitorChipsRowStyle` není exportovaná, `MonitorQueue.tsx` má `!compact && <MonitorChips` a `MonitorChips.tsx` nepoužívá `monitorChipsRowStyle`.

- [ ] **Krok 3: Implementuj čistou funkci**

Na začátek `src/lib/monitorChips.ts` (za řádek `import { compactTagChip } from "@/lib/productionTags";`) přidej:

```ts
import type { CSSProperties } from "react";
```

Na konec souboru přidej:

```ts
/**
 * Styl obalu štítků na Monitoru.
 *
 * Velká karta: obal smí zmenšit výšku pod svůj obsah (`minHeight: 0`
 * + `overflow: hidden`), a to jako JEDINÝ prvek obsahu karty. Obsah karty
 * ořezává zespodu, takže když na stupni XL a nízké obrazovce dojde místo,
 * ustoupí spodek štítků a časová osa tisku i řádek druhého stroje zůstanou
 * vidět (spec 2026-09-14, odd. 1.3). Ostatní prvky karty mají automatickou
 * minimální výšku podle obsahu, takže se zmenšit nemůžou. Tytéž štítky jsou
 * ve většině případů vidět i ve zvýrazněném řádku fronty.
 *
 * Fronta: obal roste do výšky a nic neořezává — fronta sama scrolluje.
 */
export function monitorChipsRowStyle(size: "hero" | "queue"): CSSProperties {
  if (size === "hero") {
    return { display: "flex", flexWrap: "wrap", gap: 6, minHeight: 0, overflow: "hidden" };
  }
  return { display: "flex", flexWrap: "wrap", gap: 5 };
}
```

- [ ] **Krok 4: Zapoj ji v `MonitorChips.tsx`**

Řádek 4 změň na:

```tsx
import { buildMonitorChips, monitorChipsRowStyle, type MonitorChipTone } from "@/lib/monitorChips";
```

Řádek `<span style={{ display: "flex", flexWrap: "wrap", gap: hero ? 6 : 5 }}>` nahraď:

```tsx
    <span style={monitorChipsRowStyle(size)}>
```

Konstanta `hero` zůstává, dál ji používají styly jednotlivých štítků.

- [ ] **Krok 5: Štítky v zúženém řádku (`MonitorQueue.tsx`)**

a) Doc komentář komponenty (ř. 28–35) nahraď:

```tsx
/**
 * Pravý sloupec Monitoru — zakázky na stroji: nedodělané z minulých dnů
 * (sekce NEDODĚLÁNO, zúženým řádkem, všechny bez stropu), dnešek a zítřek.
 * Dnes/Zítra nesou totéž, co velká karta: číslo, popis, čas, amber pás se
 * specifikací a výrobní i stavové štítky. NEDODĚLÁNO má štítky taky (od
 * 14. 9. 2026), jen bez pásu specifikace. Odklepnuté jsou ztlumené se zeleným
 * háčkem (včetně pásu), zakázka na velké kartě zvýrazněná. Kliknutí ji
 * vytáhne na velkou kartu (tiskař tím přebíjí pořadí od plánovače).
 */
```

b) JSDoc parametru `compact` (ř. 82–86) nahraď:

```tsx
  /** Zúžený řádek: číslo, popis, čas a štítky — bez pásu specifikace.
   *  Štítky dostal 14. 9. 2026 (volba M2 = B: tiskaři mají vidět všechny
   *  štítky i u nedodělaných zakázek). Sekce NEDODĚLÁNO umí mít i deset
   *  položek (ostrá data 12. 8. 2026: XL 106 jich měla devět) a se štítky
   *  se prodlouží — fronta ale scrolluje (`overflowY: auto` výš), takže DNES
   *  zůstává dosažitelná. Pás specifikace a detail vyjedou kliknutím na
   *  velké kartě. */
```

c) Řádek `display: "flex", flexDirection: "column", alignItems: "stretch", gap: compact ? 0 : 7,` změň na:

```tsx
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: compact ? 5 : 7,
```

d) Řádek `{!compact && <MonitorChips block={b} size="queue" ts={ts} />}` nahraď:

```tsx
            {/* Štítky kreslí i zúžený řádek NEDODĚLÁNO (14. 9. 2026, volba M2 = B) —
                hlídá to `src/lib/monitorChipsWiring.test.ts`. */}
            <MonitorChips block={b} size="queue" ts={ts} />
```

- [ ] **Krok 6: Ověř, že testy projdou, a strážný test z druhé strany (P11)**

Spusť: `node --test --import tsx src/lib/monitorChips.test.ts src/lib/monitorChipsWiring.test.ts src/lib/monitorTypography.test.ts`
Očekáváno: PASS, všechno zelené. Typografický strážný test hlídá, že nikde nevznikl holý `fontSize`.

Mutační kontrola: v `MonitorQueue.tsx` dočasně vrať `{!compact && <MonitorChips block={b} size="queue" ts={ts} />}` a spusť `node --test --import tsx src/lib/monitorChipsWiring.test.ts`. Očekáváno: FAIL. Pak změnu vrať a test znovu zelený. Totéž pro `MonitorChips.tsx`: dočasně vrať inline `style={{ … }}` → FAIL → vrátit.

- [ ] **Krok 7: Testovací data pro sekci NEDODĚLÁNO**

V `prisma/seed-monitor.ts` vlož přímo před komentář `// ── PŘETAHUJE: čas vypršel, nikdo neodklepl ──`:

```ts
  // ── NEDODĚLÁNO: včerejší neodklepnutá zakázka. Sekce NEDODĚLÁNO kreslí
  //    od 14. 9. 2026 i štítky — barvy a lak z číselníku jako všude jinde (P16) ──
  add(morningIn(-1), 120, {
    ...ready, orderNumber: "MON-2410", machine: MAIN,
    description: "Etiketa IML víčko — Alimpex 500 g",
    specifikace: "IML · 4/0 · PP 60 µm",
    barvyStatusId: barvy.id, barvyStatusLabel: barvy.label,
    lakStatusId: lak.id, lakStatusLabel: lak.label,
  });

```

Prefix `MON-` znamená, že zakázku uklidí `npx tsx prisma/seed-monitor.ts --clean`. Seed se v tomto tasku NESPOUŠTÍ, protože dev DB je nedostupná (viz globální omezení). Ověří ho task 6.

- [ ] **Krok 8: Záznam do historie vývoje**

Na konec `docs/vyvoj-historie.md` přidej:

```markdown

## Štítky BARVY a LAK na Monitoru, i v sekci NEDODĚLÁNO (14. 9. 2026)

**Připomínka plánovače (září 2026, bod 1):** „Zobrazit tiskařům v Monitoru
všechny štítky." Štítky jsou v aplikaci šestice DATA · MATERIÁL · BARVY · LAK ·
ARCHY · SÉRIE; `buildMonitorChips` z ní neměl barvy a lak, přestože je karta
v plánu kreslí a tiskař je v plánu vidí.

**Rozhodnutí Vojty (rozhodovací artefakt 14. 9. 2026):** M1 = A (doplnit jen
barvy a lak, bez termínů a poznámek), M2 = B (štítky i v sekci NEDODĚLÁNO —
obrácení záměru ze 13. 8. 2026, kdy se zúžený řádek zavedl bez štítků).

**Kód.**
- `src/lib/monitorChips.ts` — barvy a lak za PANTONE, před variantou, tón
  `plain`: na Monitoru zelená znamená „připraveno" a jantarová „čeká", a takový
  stav barvy ani lak nemají. Karta v plánu je barví podle číselníku — vědomá
  odchylka, zapsaná v hlavičce funkce.
- `monitorChipsRowStyle()` — pojistka velké karty. Obal štítků smí jako jediný
  prvek obsahu zmenšit výšku pod obsah, takže na XL a nízké obrazovce ustoupí
  štítky, ne časová osa tisku (spec odd. 1.3). `MonitorView.tsx` se neměnil.
- `MonitorQueue.tsx` — zúžený řádek NEDODĚLÁNO kreslí `MonitorChips`, pás
  specifikace v něm dál není. Zapojení hlídá `src/lib/monitorChipsWiring.test.ts`.
- `prisma/seed-monitor.ts` — `MON-2410`, včerejší neodklepnutá zakázka s barvami
  a lakem, na které jde sekci NEDODĚLÁNO ověřit.
```

- [ ] **Krok 9: Kontrola a commit**

Spusť: `npx tsc --noEmit -p .` → exit 0. `npm run lint` → 0 chyb.

```bash
git add src/lib/monitorChips.ts src/lib/monitorChips.test.ts src/lib/monitorChipsWiring.test.ts src/components/monitor/MonitorChips.tsx src/components/monitor/MonitorQueue.tsx prisma/seed-monitor.ts docs/vyvoj-historie.md
git commit -F - <<'EOF'
feat(monitor): štítky i v sekci NEDODĚLÁNO + pojistka velké karty

Zúžený řádek NEDODĚLÁNO kreslí štítky jako DNES/ZÍTRA (volba M2 = B, obrácení
záměru ze 13. 8.), pás specifikace dál ne. Na velké kartě smí obal štítků
ustoupit jako první, takže na XL a nízké obrazovce zůstane vidět časová osa
(spec odd. 1.3). Zapojení hlídá monitorChipsWiring.test.ts; seed-monitor má
včerejší nedodělanou zakázku MON-2410 s barvami a lakem.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: `hoverTooltipPlacement` a `TOOLTIP_OPEN_DELAY_MS`

**Soubory:**
- Upravit: `src/lib/plannerHoverTooltip.ts` (hlavička ř. 1–34, nové exporty na konec)
- Test: `src/lib/plannerHoverTooltip.test.ts`

**Rozhraní:**
- Vstup: stávající `hoverTooltipLeft`, `hoverTooltipTop`, `TOOLTIP_W`, `TOOLTIP_MARGIN`, `TOOLTIP_VERTICAL_GAP` (beze změny).
- Výstup (používá task 5):
  - `export const TOOLTIP_OPEN_DELAY_MS = 400;`
  - `export type ColumnBox = { left: number; right: number };`
  - `export type HoverTooltipPlacementInput = { columns: ColumnBox[]; ownIndex: number; cardRect: { top: number; bottom: number; right: number }; tooltipHeight: number; viewportWidth: number; viewportHeight: number; tooltipWidth?: number; margin?: number; verticalMargin?: number }`
  - `export type HoverTooltipPlacement = { left: number; top: number; mode: "neighbour" | "own" }`
  - `export function hoverTooltipPlacement(input: HoverTooltipPlacementInput): HoverTooltipPlacement`

- [ ] **Krok 1: Napiš padající testy**

V `src/lib/plannerHoverTooltip.test.ts` rozšiř import na:

```ts
import {
  hoverTooltipLeft,
  hoverTooltipPlacement,
  hoverTooltipTop,
  TOOLTIP_MARGIN,
  TOOLTIP_OPEN_DELAY_MS,
  TOOLTIP_VERTICAL_GAP,
  TOOLTIP_W,
  type ColumnBox,
} from "./plannerHoverTooltip";
```

Na konec souboru přidej:

```ts
// ── hoverTooltipPlacement — bublina nad sousedním strojem (14. 9. 2026) ─────
// Mřížka začíná na x = 0: [datum 44][čas 72][XL 105][čas 72][XL 106], vpravo
// panely. Sloupec stroje = (šířka mřížky − 188) / 2 — vzorec z průzkumu
// 14. 9. 2026, sedí na měření Playwrightem ze 17. 8. (1600 px: 116–617 a 689–1190).
function twoMachineGrid(gridWidth: number): ColumnBox[] {
  const c = (gridWidth - 188) / 2;
  const xl105 = { left: 116, right: 116 + c };
  const xl106 = { left: xl105.right + 72, right: xl105.right + 72 + c };
  return [xl105, xl106];
}

const LAYOUTS = [
  { name: "plánovač 1920 px, boční panel 320", vw: 1920, grid: 1920 - 8 - 320 },
  { name: "plánovač 1920 px, panel + notifikace", vw: 1920, grid: 1920 - 8 - 320 - 320 },
  { name: "plánovač 1366 px, boční panel 320", vw: 1366, grid: 1366 - 8 - 320 },
  { name: "plánovač 1366 px, panel + notifikace", vw: 1366, grid: 1366 - 8 - 320 - 320 },
  { name: "pre-press 1920 px, DTP přehled 260", vw: 1920, grid: 1920 - 260 },
  { name: "pre-press 1366 px, DTP přehled 260", vw: 1366, grid: 1366 - 260 },
  { name: "MTZ / čtenář 1920 px, bez panelu", vw: 1920, grid: 1920 },
  { name: "MTZ / čtenář 1366 px, bez panelu", vw: 1366, grid: 1366 },
];

for (const l of LAYOUTS) {
  for (const ownIndex of [0, 1]) {
    const machine = ownIndex === 0 ? "XL 105" : "XL 106";
    test(`${l.name}: bublina u zakázky ${machine} leží nad druhým strojem`, () => {
      const columns = twoMachineGrid(l.grid);
      const own = columns[ownIndex];
      const neighbour = columns[1 - ownIndex];
      const p = hoverTooltipPlacement({
        columns, ownIndex,
        cardRect: { top: 300, bottom: 380, right: own.right - 3 },
        tooltipHeight: 180, viewportWidth: l.vw, viewportHeight: 1080,
      });
      assert.equal(p.mode, "neighbour");
      assert.equal(p.left + TOOLTIP_W, neighbour.right - TOOLTIP_MARGIN, "pravá hrana k pravé hraně souseda");
      assert.ok(p.left >= neighbour.left, "levý kraj souseda (štítky D/M/E/P) zůstává odkrytý");
      assert.ok(p.left >= own.right || p.left + TOOLTIP_W <= own.left, "nezasáhne do vlastního stroje");
      assert.ok(p.left >= TOOLTIP_MARGIN && p.left + TOOLTIP_W <= l.vw - TOOLTIP_MARGIN, "celá v okně");
    });
  }
}

const GRID_1920 = twoMachineGrid(1920 - 8 - 320);

test("nad sousedem začíná bublina ve výšce horní hrany karty", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: 300, bottom: 380, right: 815 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, 300);
});

test("karta u spodního okraje: bublina se zvedne, aby byla celá v okně", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: 1000, bottom: 1060, right: 815 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, 1080 - 180 - TOOLTIP_VERTICAL_GAP);
});

test("karta odrolovaná nad horní okraj: bublina u horního okraje okna", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: -40, bottom: 120, right: 815 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, TOOLTIP_VERTICAL_GAP);
});

test("bublina vyšší než okno: horní okraj vyhrává, žádná záporná souřadnice", () => {
  const p = hoverTooltipPlacement({
    columns: GRID_1920, ownIndex: 0, cardRect: { top: 300, bottom: 380, right: 815 },
    tooltipHeight: 1300, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.top, TOOLTIP_VERTICAL_GAP);
});

test("tiskař — jediný sloupec: záchranný režim, bublina pod kartou ve vlastním sloupci", () => {
  const p = hoverTooltipPlacement({
    columns: [{ left: 116, right: 1920 }], ownIndex: 0,
    cardRect: { top: 300, bottom: 380, right: 1917 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.mode, "own");
  assert.equal(p.left, hoverTooltipLeft({ columnRight: 1920, viewportWidth: 1920 }));
  assert.equal(p.top, hoverTooltipTop({ cardTop: 300, cardBottom: 380, tooltipHeight: 180, viewportHeight: 1080 }));
});

test("hák sloupce chybí: záchranný režim od pravé hrany karty + 3 px", () => {
  const p = hoverTooltipPlacement({
    columns: [], ownIndex: -1, cardRect: { top: 300, bottom: 380, right: 800 },
    tooltipHeight: 180, viewportWidth: 1920, viewportHeight: 1080,
  });
  assert.equal(p.mode, "own");
  assert.equal(p.left, hoverTooltipLeft({ columnRight: 803, viewportWidth: 1920 }));
});

test("úzké okno (1366 px, panel 600 + notifikace): u XL 105 by bublina zasáhla do vlastního stroje → záchranný režim", () => {
  const columns = twoMachineGrid(1366 - 600 - 320 - 8); // sloupce po 125 px
  const p = hoverTooltipPlacement({
    columns, ownIndex: 0, cardRect: { top: 300, bottom: 380, right: columns[0].right - 3 },
    tooltipHeight: 180, viewportWidth: 1366, viewportHeight: 768,
  });
  assert.equal(p.mode, "own");
});

test("totéž úzké okno: u XL 106 se bublina vejde nad XL 105 bez zásahu do vlastního stroje", () => {
  const columns = twoMachineGrid(1366 - 600 - 320 - 8);
  const p = hoverTooltipPlacement({
    columns, ownIndex: 1, cardRect: { top: 300, bottom: 380, right: columns[1].right - 3 },
    tooltipHeight: 180, viewportWidth: 1366, viewportHeight: 768,
  });
  assert.equal(p.mode, "neighbour");
  assert.ok(p.left + TOOLTIP_W <= columns[1].left, "pravá hrana bubliny leží před vlastním sloupcem");
});

test("tři stroje: prostřední sloupec bere souseda vpravo", () => {
  const columns = [{ left: 0, right: 400 }, { left: 470, right: 870 }, { left: 940, right: 1340 }];
  const p = hoverTooltipPlacement({
    columns, ownIndex: 1, cardRect: { top: 300, bottom: 380, right: 867 },
    tooltipHeight: 180, viewportWidth: 1400, viewportHeight: 1080,
  });
  assert.equal(p.mode, "neighbour");
  assert.equal(p.left, 1340 - TOOLTIP_MARGIN - TOOLTIP_W);
});

test("prodleva bubliny je 400 ms (volba O2, 14. 9. 2026)", () => {
  assert.equal(TOOLTIP_OPEN_DELAY_MS, 400);
});
```

- [ ] **Krok 2: Ověř, že padají**

Spusť: `node --test --import tsx src/lib/plannerHoverTooltip.test.ts`
Očekáváno: FAIL, `hoverTooltipPlacement` a `TOOLTIP_OPEN_DELAY_MS` neexistují.

- [ ] **Krok 3: Implementuj**

Hlavičku souboru (celý úvodní blokový komentář, ř. 1–34 až po ` */` před `/** Šířka hover bubliny v px. …`) nahraď:

```ts
/**
 * Umístění hover bubliny nad kartou bloku v planneru („okno s podrobnostmi").
 *
 * ── Pravidlo (od 14. 9. 2026) ───────────────────────────────────────────────
 * Bublina se staví nad SOUSEDNÍ stroj (vpravo, když existuje, jinak vlevo),
 * pravou hranou k jeho sloupci a ve výšce hovorované karty
 * (`hoverTooltipPlacement`). Stroj zakázky tak zůstane celý vidět — prosba
 * plánovače ze září 2026 „posunout okno s podrobnostmi mimo tiskový stroj, na
 * kterém daná zakázka je zaplánována". Zarovnání k PRAVÉ hraně souseda nechá
 * odkrytý jeho levý kraj se štítky D/M/E/P a čísly zakázek.
 *
 * Záchranný režim = pravidlo z 20. 8. 2026 (vlastní sloupec, pod kartou
 * s flipem; `hoverTooltipLeft` + `hoverTooltipTop`): když soused není (tiskař
 * vidí jeden stroj), když chybí hák sloupce, nebo když by bublina po sevření
 * do okna zasáhla do vlastního stroje (úzké okno s více panely).
 *
 * ── Historie — proč už pátá podoba ─────────────────────────────────────────
 *  1. do 13. 8. 2026: vpravo od karty → u XL 105 zakryla sloupec XL 106.
 *  2. 13. 8.: vnější strana mřížky → vlevo od XL 105 je jen 116 px na
 *     bublinu 250 px, přetékala přes chipy vlastní karty (P28).
 *  3. 17. 8.: pravou hranou k vlastnímu sloupci → ležela na pravé části
 *     vlastní karty.
 *  4. 20. 8. (V5): pod kartu s flipem → zakrývala ~3,5 h navazujícího plánu
 *     téhož stroje.
 *  5. 14. 9. (O1 = A): nad sousední stroj. Vědomý kompromis: dočasně zakryje
 *     pravý kraj karet druhého stroje.
 * Poučení P28 platí dál: umístění „na stranu X" se nesmí zapsat, aniž se
 * spočítá, že na straně X je místo — proto záchranný režim a tabulkové testy.
 */
```

Na konec souboru přidej:

```ts
/**
 * Prodleva, než bublina vyskočí (ms). Pre-press a MTZ jezdí myší po sloupci
 * a bublina bez prodlevy blikala nad každou kartou (volba O2, 14. 9. 2026).
 * Stejnou hodnotu má náhled poznámky MTZ (`HoverCard` v `BlockCard.tsx`) —
 * obě se napojují sem, ať se nerozejdou.
 */
export const TOOLTIP_OPEN_DELAY_MS = 400;

/** Vodorovný rozsah sloupce stroje (souřadnice viewportu). */
export type ColumnBox = { left: number; right: number };

export type HoverTooltipPlacementInput = {
  /** Sloupce strojů v pořadí zleva doprava (pořadí v DOM), včetně vlastního. */
  columns: ColumnBox[];
  /** Index sloupce, na kterém karta leží; −1, když hák v DOM chybí. */
  ownIndex: number;
  /** Hovorovaná karta (souřadnice viewportu). */
  cardRect: { top: number; bottom: number; right: number };
  /** Skutečná (naměřená) výška bubliny v px. */
  tooltipHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Výchozí `TOOLTIP_W`. */
  tooltipWidth?: number;
  /** Vodorovný odstup; výchozí `TOOLTIP_MARGIN`. */
  margin?: number;
  /** Svislý odstup od okraje okna; výchozí `TOOLTIP_VERTICAL_GAP`. */
  verticalMargin?: number;
};

export type HoverTooltipPlacement = {
  left: number;
  top: number;
  /** `neighbour` = nad sousedním strojem; `own` = záchranný režim (pod kartou ve vlastním sloupci). */
  mode: "neighbour" | "own";
};

/**
 * Vrátí polohu `position: fixed` bubliny (pravidlo v hlavičce souboru).
 *
 * Pořadí je záměrné a nesmí se prohodit: bublina musí být CELÁ v okně
 * (`hoverTooltipLeft` sevře polohu do okna), a teprve pak se hlídá zákaz
 * vlastního sloupce — když by ho sevřená bublina protnula, platí záchranný
 * režim. Bublina mimo obrazovku nenese informaci žádnou.
 */
export function hoverTooltipPlacement({
  columns,
  ownIndex,
  cardRect,
  tooltipHeight,
  viewportWidth,
  viewportHeight,
  tooltipWidth = TOOLTIP_W,
  margin = TOOLTIP_MARGIN,
  verticalMargin = TOOLTIP_VERTICAL_GAP,
}: HoverTooltipPlacementInput): HoverTooltipPlacement {
  const own = ownIndex >= 0 ? columns[ownIndex] : undefined;

  // Záchranný režim = pravidlo z 20. 8. 2026. Když hák chybí, pravá hrana karty
  // + 3 px je věrná náhrada pravé hrany sloupce (karta ho vyplňuje s okrajem
  // 3 px: `left: 3` + `calc(100% - 6px)` v `BlockCard.tsx`).
  const ownColumnFallback = (): HoverTooltipPlacement => ({
    mode: "own",
    left: hoverTooltipLeft({
      columnRight: own ? own.right : cardRect.right + 3,
      viewportWidth,
      tooltipWidth,
      margin,
    }),
    top: hoverTooltipTop({
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      tooltipHeight,
      viewportHeight,
      margin: verticalMargin,
    }),
  });

  if (!own) return ownColumnFallback();
  const neighbour = columns[ownIndex + 1] ?? columns[ownIndex - 1];
  if (!neighbour) return ownColumnFallback();

  // Pravá hrana bubliny k pravé hraně souseda — stejné ukotvení i sevření do
  // okna jako u vlastního sloupce, jen k jinému sloupci.
  const left = hoverTooltipLeft({ columnRight: neighbour.right, viewportWidth, tooltipWidth, margin });
  if (left < own.right && left + tooltipWidth > own.left) return ownColumnFallback();

  // Svisle ve výšce karty, sevřeno do okna. Podlaha vyhrává nad stropem, stejně
  // jako u `hoverTooltipTop` — záporná souřadnice by bublinu schovala.
  const maxTop = viewportHeight - tooltipHeight - verticalMargin;
  const top = Math.max(verticalMargin, Math.min(cardRect.top, maxTop));
  return { mode: "neighbour", left, top };
}
```

- [ ] **Krok 4: Ověř, že projdou, a mutační kontrola (P11)**

Spusť: `node --test --import tsx src/lib/plannerHoverTooltip.test.ts`
Očekáváno: PASS. Přibylo 26 testů (16 rozložení + 4 svislé + 5 záchranných a tři stroje + 1 prodleva) a všechny původní testy zůstávají zelené.

Mutační kontrola: dočasně smaž řádek `if (left < own.right && left + tooltipWidth > own.left) return ownColumnFallback();` a spusť testy. Očekáváno: FAIL testu „úzké okno … XL 105 …". Pak řádek vrať a testy jsou znovu zelené.

Spusť: `npx tsc --noEmit -p .` → exit 0.

- [ ] **Krok 5: Commit**

```bash
git add src/lib/plannerHoverTooltip.ts src/lib/plannerHoverTooltip.test.ts
git commit -F - <<'EOF'
feat(bublina): hoverTooltipPlacement — poloha nad sousedním strojem

Čistá funkce: soused vpravo, jinak vlevo; pravá hrana bubliny k pravé hraně
souseda; svisle ve výšce karty sevřeno do okna. Záchranný režim = pravidlo
z 20. 8. (tiskař s jedním sloupcem, chybějící hák, úzké okno). Konstanta
TOOLTIP_OPEN_DELAY_MS = 400 (volba O2). Tabulkové testy přes rozložení
plánovače, pre-pressu a MTZ na 1920 i 1366 px. Zatím nezapojeno.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Vytáhnout bublinu do `BlockHoverTooltip` (BEZE ZMĚNY CHOVÁNÍ)

> **Proč tenhle task existuje:** spec extrakci nezmiňuje. Vyžaduje ji pravidlo v CLAUDE.md „než přidáš do souboru u limitu, nejdřív navrhni extrakci". `BlockCard.tsx` má 1856 řádků při limitu 500 a bublina je uzavřený celek s vlastním stavem. Task 5 do ní přidává další vlastní stav (hledání souseda) a do `BlockCard` časovač. **Vojta extrakci schvaluje spolu s tímto plánem.** Když ji zamítne, task 4 odpadá a task 5 změní polohu přímo v `BlockCard.tsx` na místě dnešního výpočtu (ř. 1498–1510).

**Soubory:**
- Vytvořit: `src/components/planner/BlockHoverTooltip.tsx`
- Upravit: `src/components/planner/BlockCard.tsx`

**Rozhraní:**
- Výstup (používá task 5): `export function BlockHoverTooltip(props: { block: Block; anchorRef: RefObject<HTMLDivElement>; open: boolean; splitTotal?: number; splitTotalMinutes?: number }): JSX.Element | null`

- [ ] **Krok 1: Vytvoř `src/components/planner/BlockHoverTooltip.tsx`**

Obsah přesně takto. Výpočty i JSX jsou doslovná kopie `BlockCard.tsx` ř. 1485–1686, jen `blockCardRef` → `anchorRef`:

```tsx
"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { type Block } from "@/app/_components/TimelineGrid";
import { blockPrintMinutes } from "@/lib/printTimeClient";
import { usesTiskoveHodiny } from "@/lib/printTime";
import { Z_OVERLAY } from "@/lib/zLayers";
import { civilDateToUTCMidnight, normalizeCivilDateInput } from "@/lib/dateUtils";
import { hoverTooltipLeft, hoverTooltipTop, TOOLTIP_W } from "@/lib/plannerHoverTooltip";

/**
 * Hover bublina nad kartou bloku v planneru („okno s podrobnostmi").
 *
 * Vytažená z `BlockCard.tsx` 14. 9. 2026 BEZE ZMĚNY CHOVÁNÍ — soubor měl
 * 1856 řádků při limitu 500 (pravidlo „extract before add", CLAUDE.md)
 * a bublina je uzavřený celek s vlastním stavem (naměřená výška, poloha).
 *
 * KDY se bublina ukáže, rozhoduje volající přes `open`; tady se řeší jen poloha
 * a obsah. Portálovaná do `body`, mimo stacking context mřížky. Pravidla polohy
 * žijí v `src/lib/plannerHoverTooltip.ts`.
 */
export function BlockHoverTooltip({
  block, anchorRef, open, splitTotal, splitTotalMinutes,
}: {
  block: Block;
  /** Karta bloku — z ní se čte poloha a sloupec stroje. */
  anchorRef: RefObject<HTMLDivElement>;
  /** Má se bublina ukázat (rozhoduje `BlockCard`). */
  open: boolean;
  /** Počet částí split skupiny a jejich Σ tiskový čas (řádek „Skupina: Σ …"). */
  splitTotal?: number;
  splitTotalMinutes?: number;
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  // Naměří skutečnou výšku hover bubliny PO jejím vykreslení do DOM, ale PŘED
  // prvním malováním obrazovky (proto useLayoutEffect, ne useEffect) — díky
  // tomu uživatel nikdy neuvidí bublinu na provizorní pozici z prvního snímku.
  // Bez deps pole běží po každém commitu (zavřená bublina → tooltipRef.current
  // je null → měřená výška 0 → stav se sám vrátí na 0). `setState` s hodnotou
  // shodnou s předchozí Reactu bail-outuje, takže to nezpůsobí smyčku.
  useLayoutEffect(() => {
    const measured = tooltipRef.current?.getBoundingClientRect().height ?? 0;
    setTooltipHeight((prev) => (prev === measured ? prev : measured));
  });

  if (!open) return null;
  const rect = anchorRef.current?.getBoundingClientRect();
  if (!rect || typeof document === "undefined") return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Bublina se zarovná pravou hranou ke sloupci VLASTNÍHO stroje: nepřepadne
  // do sousedního sloupce a zároveň nezakryje levou hranu karty s chipy
  // D/M/E/P. Pravidlo, jeho odůvodnění i to, co neřeší, viz
  // `src/lib/plannerHoverTooltip.ts` — tady zůstává jen odečet geometrie.
  //
  // Když hák `[data-machine-col]` nenajdeme (mřížka se nestihla vykreslit),
  // spadneme na pravou hranu samotné karty. Ta sloupec vyplňuje na 3 px
  // přesně (`left: 3` + `calc(100% - 6px)` v `BlockCard.tsx`), takže je to
  // věrná náhrada — a obrazovka u stroje kvůli bublině spadnout nesmí.
  const colEl = anchorRef.current?.closest("[data-machine-col]");
  const columnRight = colEl?.getBoundingClientRect().right ?? rect.right + 3;
  const left = hoverTooltipLeft({ columnRight, viewportWidth: vw });
  // Svislé umístění: pod kartou, s flipem nahoru u spodního okraje okna
  // a clampem do okna jako poslední záchranou. Pravidlo, jeho pořadí
  // i odůvodnění viz `src/lib/plannerHoverTooltip.ts` — tady zůstává
  // jen odečet geometrie, stejně jako u vodorovného `left` výš.
  const top = hoverTooltipTop({
    cardTop: rect.top,
    cardBottom: rect.bottom,
    tooltipHeight,
    viewportHeight: vh,
  });
  // Format time
  const startD = new Date(block.startTime);
  const endD   = new Date(block.endTime);
  const fmtTime = (d: Date) => d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
  const fmtDay  = (d: Date) => d.toLocaleDateString("cs-CZ", { day: "numeric", month: "short", timeZone: "Europe/Prague" });
  const sameDay = fmtDay(startD) === fmtDay(endD);
  const timeLabel = sameDay
    ? `${fmtDay(startD)}, ${fmtTime(startD)}–${fmtTime(endD)}`
    : `${fmtDay(startD)} ${fmtTime(startD)} – ${fmtDay(endD)} ${fmtTime(endD)}`;
  const machineLabel = block.machine === "XL_105" ? "XL 105" : "XL 106";
  const hasDateInfo = block.dataRequiredDate || block.materialRequiredDate || block.deadlineExpedice;
  // Řádek délky: ZAKAZKA s tiskovými minutami odlišnými od uplynulého času bloku
  // (pauza přes odstávku/mimo provoz uvnitř bloku) zobrazí tisk i celek zvlášť.
  const fmtHoursTip = (mins: number) => {
    const h = mins / 60;
    return h % 1 === 0 ? `${h} h` : `${h.toFixed(1)} h`;
  };
  const elapsedMinsTip = Math.round((endD.getTime() - startD.getTime()) / 60000);
  // usesTiskoveHodiny, ne holé `type === "ZAKAZKA"` (F5, finální review etapy 9) —
  // tisková rezervace má printMinutes taky a bublina má ukázat „Tisk: X · Celkem: Y",
  // ne jen uplynulý čas.
  const pmTip = usesTiskoveHodiny(block) ? blockPrintMinutes(block) : null;
  const durationLabel = (pmTip != null && pmTip !== elapsedMinsTip)
    ? `Tisk: ${fmtHoursTip(pmTip)} · Celkem: ${fmtHoursTip(elapsedMinsTip)}`
    : `Délka: ${fmtHoursTip(elapsedMinsTip)}`;
  const tiskarNotes = block.notes ?? [];
  return createPortal(
    <div ref={tooltipRef} style={{
      position: "fixed",
      left,
      top,
      width: TOOLTIP_W,
      zIndex: Z_OVERLAY.floating,
      background: "rgba(28,28,30,0.88)",
      backdropFilter: "blur(24px)",
      WebkitBackdropFilter: "blur(24px)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 14,
      padding: "12px 14px",
      pointerEvents: "none",
      boxShadow: "0 16px 48px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.25)",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      {/* Číslo zakázky + stroj */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: block.description || block.specifikace ? 3 : 6 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: "rgba(255,255,255,0.95)", letterSpacing: "-0.01em" }}>
          {block.orderNumber}
        </span>
        <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0, marginLeft: 8 }}>
          {machineLabel}
        </span>
      </div>
      {/* Popis */}
      {block.description && (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.4, marginBottom: block.specifikace ? 3 : 6 }}>
          {block.description}
        </div>
      )}
      {/* Specifikace */}
      {block.specifikace && (
        <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.42)", fontStyle: "italic", lineHeight: 1.35, marginBottom: 6 }}>
          {block.specifikace}
        </div>
      )}
      {/* Čas */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
        {timeLabel}
      </div>
      {/* Délka — tisk vs. celkový čas na ose, když se liší (blok obsahuje pauzu) */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
        {durationLabel}
      </div>
      {/* Σ tiskový čas celé split skupiny (bod 18 auditu) */}
      {(splitTotal ?? 0) > 1 && (splitTotalMinutes ?? 0) > 0 && (
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", lineHeight: 1.4 }}>
          {`Skupina: Σ ${fmtHoursTip(splitTotalMinutes!)} (${splitTotal} částí)`}
        </div>
      )}
      {/* Termíny */}
      {hasDateInfo && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 4 }}>
          {block.dataRequiredDate && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>DATA</span>
              <span style={{ color: block.dataOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                {fmtDate(block.dataRequiredDate)}{block.dataOk ? " ✓" : ""}
              </span>
            </div>
          )}
          {block.materialRequiredDate && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>MATERIÁL</span>
              <span style={{ color: block.materialOk ? "#30d158" : "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                {fmtDate(block.materialRequiredDate)}{block.materialOk ? " ✓" : ""}
              </span>
            </div>
          )}
          {block.deadlineExpedice && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "rgba(255,255,255,0.35)", letterSpacing: "0.03em" }}>EXPEDICE</span>
              <span style={{ color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                {fmtDate(block.deadlineExpedice)}
              </span>
            </div>
          )}
        </div>
      )}
      {/* Tiskařské poznámky — sekce v hoveru */}
      {tiskarNotes.length > 0 && (
        <div style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            color: "#f59e0b",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 2,
          }}>
            <span>📝 Poznámky tiskař</span>
            <span style={{
              background: "#f59e0b",
              color: "#1f2937",
              padding: "1px 5px",
              borderRadius: 8,
              fontSize: 9,
              fontWeight: 700,
            }}>{tiskarNotes.length}</span>
          </div>
          {tiskarNotes.slice(0, 3).map((n) => (
            <div key={n.id} style={{ borderLeft: "2px solid #f59e0b", paddingLeft: 8 }}>
              <div style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.85)",
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
              }}>{n.text}</div>
              <div style={{
                fontSize: 9,
                color: "rgba(255,255,255,0.32)",
                marginTop: 2,
                letterSpacing: "0.02em",
              }}>
                {n.createdByUsername} · {new Date(n.createdAt).toLocaleString("cs-CZ", {
                  day: "numeric", month: "numeric",
                  hour: "2-digit", minute: "2-digit",
                  timeZone: "Europe/Prague",
                })}
                {n.updatedAt !== n.createdAt && " · upraveno"}
              </div>
            </div>
          ))}
          {tiskarNotes.length > 3 && (
            <div style={{
              fontSize: 10,
              color: "#f59e0b",
              textAlign: "center",
              fontStyle: "italic",
              marginTop: 4,
            }}>
              + {tiskarNotes.length - 3} dalších
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}

// ─── Pomocná funkce — bezpečný parse data z DB (ISO timestamp i date string) ──
// Přesunuto z `BlockCard.tsx` (14. 9. 2026) — bublina byla jejím jediným uživatelem.
function fmtDate(s: string | null | undefined): string {
  const normalized = normalizeCivilDateInput(s);
  if (!normalized) return "–";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(civilDateToUTCMidnight(normalized));
}
```

Než soubor uložíš, porovnej JSX v něm řádek po řádku s `BlockCard.tsx` ř. 1537–1684. Rozdíl smí být jen v odsazení. Pokud se kopie od originálu liší v jediném stylu nebo textu, platí originál.

- [ ] **Krok 2: Uprav `BlockCard.tsx`**

a) Řádek 3 `import { useLayoutEffect, useRef, useState } from "react";` → `import { useRef, useState } from "react";`

b) Řádek 5 `import { blockPrintMinutes, formatPrintHoursShort, type CalendarDriftInfo } from "@/lib/printTimeClient";` → `import { formatPrintHoursShort, type CalendarDriftInfo } from "@/lib/printTimeClient";`

c) Smaž řádek 6 `import { usesTiskoveHodiny } from "@/lib/printTime";`. Jeho jediné použití je v bublině (ověřeno grepem 14. 9.).

d) Smaž řádek 11 `import { hoverTooltipLeft, hoverTooltipTop, TOOLTIP_W } from "@/lib/plannerHoverTooltip";`.

e) Za řádek `import { PrintDoneButton } from "@/components/planner/PrintDoneButton";` přidej:

```tsx
import { BlockHoverTooltip } from "@/components/planner/BlockHoverTooltip";
```

f) Smaž funkci `fmtDate` (od `function fmtDate(s: string | null | undefined): string {` po její uzavírací `}` a následující prázdný řádek). Nad ní stojící komentář `// ─── Pomocná funkce — bezpečný parse data z DB …` NECH: dál popisuje `fmtDateShort`, která zůstává.

g) Smaž blok od `  const tooltipRef = useRef<HTMLDivElement>(null);` po konec `useLayoutEffect(() => { … });` včetně komentáře mezi nimi. Jde o celý úsek:

```tsx
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(0);

  // Naměří skutečnou výšku hover bubliny PO jejím vykreslení do DOM, ale PŘED
  // prvním malováním obrazovky (proto useLayoutEffect, ne useEffect) — díky
  // tomu uživatel nikdy neuvidí bublinu na provizorní pozici z prvního snímku.
  // Bez deps pole běží po každém commitu (zavřená bublina → tooltipRef.current
  // je null → měřená výška 0 → stav se sám vrátí na 0). `setState` s hodnotou
  // shodnou s předchozí Reactu bail-outuje, takže to nezpůsobí smyčku.
  useLayoutEffect(() => {
    const measured = tooltipRef.current?.getBoundingClientRect().height ?? 0;
    setTooltipHeight((prev) => (prev === measured ? prev : measured));
  });
```

h) Nahraď celý úsek od řádku `      {/* ── Hover bublina — portálovaná mimo stacking context. Ukazuje se nad KAŽDOU` až po řádek `      })()}`. Je to konec IIFE, hned před `    </div>` a `  );` a prázdným řádkem, za kterým následuje `  if (!showMenu) return blockDiv;`. Nahraď ho tímto:

```tsx
      {/* ── Hover bublina — vlastní komponenta (`BlockHoverTooltip.tsx`), portálovaná
             mimo stacking context. Ukazuje se nad KAŽDOU kartou kromě údržby
             (`showTooltip` výš). KDY se ukáže, rozhoduje tahle karta; polohu
             a obsah řeší komponenta. ── */}
      <BlockHoverTooltip
        block={block}
        anchorRef={blockCardRef}
        open={showTooltip && hovered}
        splitTotal={splitTotal}
        splitTotalMinutes={splitTotalMinutes}
      />
```

- [ ] **Krok 3: Kontroly**

Spusť: `grep -n "createPortal(" src/components/planner/BlockCard.tsx`
Očekáváno: jediný výskyt, editor poznámky MTZ (`noteOpen && noteRect && …`).

Spusť: `grep -n -E "tooltipHeight|tooltipRef|hoverTooltipLeft|hoverTooltipTop|fmtDate\(" src/components/planner/BlockCard.tsx`
Očekáváno: žádný výskyt. `fmtDateShort(` do hledání nespadá, protože vzor je `fmtDate\(`.

Spusť: `npx tsc --noEmit -p .` → exit 0.
Spusť: `npm run lint` → 0 chyb. Nesmí přibýt warning „unused" pro `BlockCard.tsx`.
Spusť celou suite → 45 selhání jako ve výchozím stavu, žádné nové.

- [ ] **Krok 4: Commit**

```bash
git add src/components/planner/BlockHoverTooltip.tsx src/components/planner/BlockCard.tsx
git commit -F - <<'EOF'
refactor(bublina): hover bublina do vlastní komponenty BlockHoverTooltip

Beze změny chování. BlockCard.tsx měl 1856 řádků při limitu 500 a bublina je
uzavřený celek s vlastním stavem (naměřená výška, poloha) — pravidlo „extract
before add" z CLAUDE.md, před změnou polohy a prodlevou (etapa 1 září).
fmtDate se stěhuje s ní, bublina byla jejím jediným uživatelem.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Bublina nad druhým strojem + prodleva 400 ms

**Soubory:**
- Upravit: `src/components/planner/BlockHoverTooltip.tsx` (import + výpočet polohy)
- Upravit: `src/components/planner/BlockCard.tsx` (import, stav časovače, `onMouseEnter`/`onMouseLeave`, prop `open`, `HoverCard openDelay`)
- Vytvořit: `src/lib/plannerHoverWiring.test.ts`
- Upravit: `src/app/_components/TimelineGrid.tsx` (jen komentář u `data-machine-col`, ř. 1985–1994)
- Upravit: `CLAUDE.md` (řádek o `plannerHoverTooltip.ts` v odd. „Klíčové soubory")
- Upravit: `docs/vyvoj-historie.md` (nový oddíl na konec)

**Rozhraní:**
- Vstup: `hoverTooltipPlacement`, `ColumnBox`, `TOOLTIP_OPEN_DELAY_MS` (task 3). `BlockHoverTooltip` s propem `open` (task 4).
- Výstup: nic dalšího.

- [ ] **Krok 1: Napiš padající strážný test**

Vytvoř `src/lib/plannerHoverWiring.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripComments } from "@/lib/sourceTextTestUtils";

/**
 * Strážný test zapojení hover bubliny (etapa 1 září, 14. 9. 2026).
 *
 * Pravidlo polohy žije v čisté funkci `hoverTooltipPlacement` a má tabulkové
 * testy. Nic ale nezaručuje, že ho komponenta opravdu volá, že hledá souseda
 * mezi sourozenci s hákem `data-machine-col` a že se bublina otevírá až po
 * prodlevě. Logika se tu rozpadá mezi funkci a napojení — přesně případ,
 * na který P15 předepisuje strážný test nad zdrojákem volajícího.
 */
const card = stripComments(readFileSync("src/components/planner/BlockCard.tsx", "utf8"));
const tip = stripComments(readFileSync("src/components/planner/BlockHoverTooltip.tsx", "utf8"));

test("bublina počítá polohu výhradně přes hoverTooltipPlacement", () => {
  assert.match(tip, /hoverTooltipPlacement\(/);
  assert.doesNotMatch(tip, /hoverTooltipLeft\(|hoverTooltipTop\(/);
});

test("bublina hledá sousední sloupec mezi sourozenci s hákem data-machine-col", () => {
  assert.match(tip, /closest\(\s*"\[data-machine-col\]"\s*\)/);
  assert.match(tip, /hasAttribute\(\s*"data-machine-col"\s*\)/);
});

test("bublina se otevírá až po TOOLTIP_OPEN_DELAY_MS a jen s otevřeným stavem", () => {
  assert.match(card, /setTimeout\([\s\S]{0,200}?TOOLTIP_OPEN_DELAY_MS\s*\)/);
  assert.match(card, /open=\{\s*showTooltip\s*&&\s*hovered\s*&&\s*tooltipOpen\s*\}/);
});

test("náhled poznámky MTZ sdílí prodlevu s bublinou (žádné natvrdo zapsané číslo)", () => {
  assert.match(card, /openDelay=\{TOOLTIP_OPEN_DELAY_MS\}/);
  assert.doesNotMatch(card, /openDelay=\{\s*\d+\s*\}/);
});
```

Spusť: `node --test --import tsx src/lib/plannerHoverWiring.test.ts`
Očekáváno: FAIL ve všech čtyřech testech.

- [ ] **Krok 2: Poloha v `BlockHoverTooltip.tsx`**

Import `import { hoverTooltipLeft, hoverTooltipTop, TOOLTIP_W } from "@/lib/plannerHoverTooltip";` změň na:

```tsx
import { hoverTooltipPlacement, TOOLTIP_W, type ColumnBox } from "@/lib/plannerHoverTooltip";
```

Úsek od komentáře `  // Bublina se zarovná pravou hranou ke sloupci VLASTNÍHO stroje: nepřepadne` po konec volání `const top = hoverTooltipTop({ … });` nahraď:

```tsx
  // Poloha: nad SOUSEDNÍM strojem, pravou hranou k jeho sloupci, ve výšce karty;
  // záchranný režim (tiskař s jedním sloupcem, chybějící hák, úzké okno) =
  // dřívější pravidlo pod kartou. Pravidlo, pořadí záchran i historie viz
  // `src/lib/plannerHoverTooltip.ts` — tady zůstává jen odečet geometrie.
  //
  // Sloupce strojů jsou v mřížce sourozenci s hákem `data-machine-col`
  // (`TimelineGrid.tsx`), pořadí v DOM = pořadí zleva doprava.
  const colEl = anchorRef.current?.closest("[data-machine-col]") ?? null;
  const siblings = colEl?.parentElement
    ? Array.from(colEl.parentElement.children).filter((el) => el.hasAttribute("data-machine-col"))
    : [];
  const columns: ColumnBox[] = siblings.map((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
  const { left, top } = hoverTooltipPlacement({
    columns,
    ownIndex: colEl ? siblings.indexOf(colEl) : -1,
    cardRect: { top: rect.top, bottom: rect.bottom, right: rect.right },
    tooltipHeight,
    viewportWidth: vw,
    viewportHeight: vh,
  });
```

- [ ] **Krok 3: Prodleva v `BlockCard.tsx`**

a) `import { useRef, useState } from "react";` → `import { useEffect, useRef, useState } from "react";`

b) Za řádek `import { BlockHoverTooltip } from "@/components/planner/BlockHoverTooltip";` přidej:

```tsx
import { TOOLTIP_OPEN_DELAY_MS } from "@/lib/plannerHoverTooltip";
```

c) Za řádek `  const blockCardRef = useRef<HTMLDivElement>(null);` přidej:

```tsx
  // Hover bublina se otevírá až po TOOLTIP_OPEN_DELAY_MS nepřetržitého najetí
  // (volba O2, 14. 9. 2026) — pre-press a MTZ jezdí myší po sloupci a bez
  // prodlevy jim bublina blikala nad každou kartou. `hovered` výš dál OKAMŽITĚ
  // řídí stín a vrstvu karty; prodleva se týká jen bubliny.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Karta se může odmontovat dřív, než časovač doběhne (přetažení na jiný stroj,
  // smazání, přepnutí dne) — úklid, ať se nevolá setState na odmontované kartě.
  useEffect(() => () => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
  }, []);
```

d) Řádky

```tsx
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
```

nahraď:

```tsx
      onMouseEnter={() => {
        setHovered(true);
        if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = setTimeout(() => {
          tooltipTimerRef.current = null;
          setTooltipOpen(true);
        }, TOOLTIP_OPEN_DELAY_MS);
      }}
      onMouseLeave={() => {
        setHovered(false);
        if (tooltipTimerRef.current) {
          clearTimeout(tooltipTimerRef.current);
          tooltipTimerRef.current = null;
        }
        setTooltipOpen(false);
      }}
```

e) V `<BlockHoverTooltip … />` změň `open={showTooltip && hovered}` na:

```tsx
        open={showTooltip && hovered && tooltipOpen}
```

f) V `MaterialNoteAffordance` změň `<HoverCard openDelay={400} closeDelay={100}>` na:

```tsx
    <HoverCard openDelay={TOOLTIP_OPEN_DELAY_MS} closeDelay={100}>
```

- [ ] **Krok 4: Komentář u háku v `TimelineGrid.tsx`**

Víceřádkový komentář přímo nad `<ContextMenu>` sloupce stroje nahraď. Začíná slovy „Sloupec stroje. Atribut" a končí textem `ten smí obalovat právě jeden prvek. */}`. Nahraď ho tímto:

```tsx
              {/* Sloupec stroje. Atribut `data-machine-col` je stabilní hák pro hover
                  bublinu (`BlockHoverTooltip.tsx`): od 14. 9. 2026 bublina hledá mezi
                  SOUROZENCI s tímto atributem sousední stroj a staví se nad něj
                  („mimo stroj zakázky"); vlastní sloupec slouží jen záchrannému
                  režimu. Sloupce proto musí zůstat sourozenci v jednom rodiči
                  a pořadí v DOM musí odpovídat pořadí zleva doprava — žádný obal
                  kolem jednotlivého sloupce. Pravidlo žije v
                  `src/lib/plannerHoverTooltip.ts`.
                  POZOR: komentář patří SEM, ne dovnitř `ContextMenuTrigger asChild` —
                  ten smí obalovat právě jeden prvek. */}
```

- [ ] **Krok 5: Ověř strážný test a mutaci (P11)**

Spusť: `node --test --import tsx src/lib/plannerHoverWiring.test.ts src/lib/plannerHoverTooltip.test.ts`
Očekáváno: PASS.

Mutační kontrola:
1. V `BlockCard.tsx` dočasně vrať `open={showTooltip && hovered}` → FAIL třetího testu → vrátit.
2. Dočasně napiš `openDelay={400}` → FAIL čtvrtého testu → vrátit.

- [ ] **Krok 6: Dokumentace**

a) V `CLAUDE.md` (odd. „Klíčové soubory", řádek **Planner:**) nahraď text

```
(`hoverTooltipLeft` — hover bublina na kartě bloku se zarovnává PRAVOU hranou ke sloupci vlastního stroje přes hák `data-machine-col`; tím nepřepadne do sousedního stroje ani nezakryje levou hranu karty s chipy D/M/E/P. Nikdy neumísťovat bublinu „na stranu" bez ověření, že se tam vejde — vlevo od XL 105 je 116 px na prvek široký 250 px, viz `docs/POUCENI.md` P28)
```

textem

```
(`hoverTooltipPlacement` — hover bublina na kartě bloku (`src/components/planner/BlockHoverTooltip.tsx`) se od 14. 9. 2026 staví nad SOUSEDNÍ stroj, pravou hranou k jeho sloupci a ve výšce karty; souseda hledá mezi sourozenci s hákem `data-machine-col`. Záchranný režim (tiskař s jedním sloupcem, úzké okno, chybějící hák) = dřívější pravidlo pod kartou ve vlastním sloupci. Otevírá se po `TOOLTIP_OPEN_DELAY_MS` (400 ms, stejná konstanta drží náhled poznámky MTZ). Nikdy neumísťovat bublinu „na stranu" bez ověření, že se tam vejde — vlevo od XL 105 je 116 px na prvek široký 250 px, viz `docs/POUCENI.md` P28)
```

Pozor na znaky: za „na stranu je v souboru ASCII uvozovka `"`. Použij nástroj Edit s přesnou shodou a nic nepřepisuj ručně.

b) Na konec `docs/vyvoj-historie.md` přidej:

```markdown

## Hover bublina nad sousedním strojem, s prodlevou 400 ms (14. 9. 2026)

**Připomínka plánovače (září 2026, bod 2):** „Posunout okno s podrobnostmi mimo
tiskový stroj, na kterém daná zakázka je zaplánována." Od 20. 8. seděla bublina
pod kartou ve sloupci téhož stroje a zakrývala ~3,5 h navazujícího plánu;
vyskakovala bez prodlevy, takže pre-pressu a MTZ při projíždění sloupcem blikala
nad každou kartou.

**Rozhodnutí Vojty (rozhodovací artefakt 14. 9. 2026):** O1 = A (nad druhý stroj,
pravou hranou k jeho sloupci), O2 = A (prodleva 400 ms). Pevné místo („dok")
zůstalo zamítnuté jako 19. 8.

**Nové pravidlo.** `hoverTooltipPlacement()` v `src/lib/plannerHoverTooltip.ts`:
soused vpravo, jinak vlevo; pravá hrana bubliny = pravá hrana souseda − 10 px;
svisle ve výšce karty, sevřeno do okna. Záchranný režim = pravidlo z 20. 8.
(tiskař s jedním sloupcem, chybějící hák, úzké okno, kde by bublina zasáhla do
vlastního stroje). Tabulkové testy pokrývají rozložení plánovače, pre-pressu
a MTZ na 1920 i 1366 px.

**Kód.**
- `src/components/planner/BlockHoverTooltip.tsx` — bublina vytažená z
  `BlockCard.tsx` (pravidlo „extract before add", soubor měl 1856 řádků); sama si
  drží naměřenou výšku, hledá sousední sloupec a počítá polohu.
- `BlockCard.tsx` — stav `tooltipOpen` s časovačem `TOOLTIP_OPEN_DELAY_MS`;
  `hovered` dál okamžitě řídí stín a vrstvu karty. Náhled poznámky MTZ sdílí
  tutéž konstantu. Zapojení hlídá `src/lib/plannerHoverWiring.test.ts`.

**Vědomý kompromis:** bublina dočasně zakryje pravý kraj karet druhého stroje.
```

- [ ] **Krok 7: Kontroly a commit**

Spusť: `npx tsc --noEmit -p .` → exit 0. `npm run lint` → 0 chyb. Celá suite → 45 výchozích selhání, žádné nové.

```bash
git add src/components/planner/BlockHoverTooltip.tsx src/components/planner/BlockCard.tsx src/lib/plannerHoverWiring.test.ts src/app/_components/TimelineGrid.tsx CLAUDE.md docs/vyvoj-historie.md
git commit -F - <<'EOF'
feat(bublina): okno s podrobnostmi nad druhým strojem, prodleva 400 ms

Prosba plánovače (září 2026, bod 2): bublina už nezakrývá stroj zakázky.
Staví se nad sousední sloupec, pravou hranou k němu a ve výšce karty; tiskař
s jedním sloupcem a úzká okna zůstávají u pravidla z 20. 8. Otevírá se až po
400 ms nepřetržitého najetí (volba O2), zvýraznění karty zůstává okamžité;
náhled poznámky MTZ sdílí tutéž konstantu. Zapojení hlídá
plannerHoverWiring.test.ts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: Ověření v běžící appce (koordinátor, ne subagent)

Tenhle task dělá koordinátor sám. Potřebuje funkční dev databázi a běžící server.

> **Oprava po závěrečné revizi (15. 9. 2026):** na velké kartě je v seedu MON-2403 (přetahující zakázka má přednost před běžící), ne MON-2404. Skript proto před měřením nejhoršího případu **ručně vybere MON-2404** klikem v sekci DNES (přibude i řádek „vybráno ručně" — realistický nejhorší případ) a navíc změří **pozastavenou MON-2407** doplněnou o barvy, lak, obálku, archy, sérii a pantone (vybranou ze ZÍTRA): štítek „Pozastaveno" musí být na XL při 1366×768 vidět. Aktuální verzi skriptu drží koordinátor ve scratchpadu session.

- [ ] **Krok 1: Předpoklad — dev databáze**

Dnes (14. 9.) na 3306 běží Homebrew MySQL (`/opt/homebrew/opt/mysql`) a `.env` míří na databázi v AMPPS. **Nic nezastavuj ani nespouštěj bez Vojtova souhlasu** (globální CLAUDE.md: žádné ukončování procesů bez zeptání). Po jeho zásahu ověř:

```bash
cd /Users/vojtatokan/Desktop/IG/projekty && node --experimental-test-module-mocks --test --import tsx src/lib/revision.server.test.ts 2>&1 | grep -E "^ℹ (pass|fail)"
```

Očekáváno: `ℹ fail 0`. Celá suite pak vyjde bez selhání.

- [ ] **Krok 2: Server a data**

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN        # když nic neběží, spusť vlastní dev server na pozadí:
cd /Users/vojtatokan/Desktop/IG/projekty && npx next dev -p 3001
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health   # čekej na 200
npx tsx prisma/seed-monitor.ts --clean && npx tsx prisma/seed-monitor.ts
```

Nejhorší případ velké karty (jen dev DB, řádky `MON-` uklidí `--clean`):

```bash
npx tsx -e 'const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient(); (async () => { await p.block.updateMany({ where: { orderNumber: "MON-2404", machine: "XL_105" }, data: { description: "Katalog jaro 2026 — Alimpex, kompletní sada pro prodejny včetně vkladů a obálky s výsekem", specifikace: "B2 · 4/4 · 130 g natíraný lesk · disperzní lak · pantone 2× · výsek okénka · lepení hřbetu · balení po 250 ks" } }); await p.$disconnect(); })();'
```

- [ ] **Krok 3: Playwright ve scratchpadu**

```bash
cd <scratchpad> && npm init -y >/dev/null && npm i playwright && npx playwright install chromium
```

Skript `verify-etapa1.mjs`:

```js
import { chromium } from "playwright";
const BASE = "http://localhost:3001";
const OUT = process.argv[2] ?? ".";

async function login(page, user) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(4000); // hydratace — bez ní klik na „Přihlásit" nic neodešle
  await page.fill("#username", user);
  await page.fill("#password", user);
  await page.click('button[type="submit"]');
}

const findBubble = (page) => page.evaluate(() => {
  const el = [...document.body.children].find((e) => {
    const cs = getComputedStyle(e);
    return cs.position === "fixed" && cs.pointerEvents === "none" && Math.round(e.getBoundingClientRect().width) === 240;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
});

const browser = await chromium.launch();

// ── Monitor (tiskař): M a XL na 1366×768 i 1920×1080 ──
for (const vp of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, "tiskar");
  await page.waitForSelector("text=Fronta na");
  for (const scale of ["M", "XL"]) {
    await page.locator('[aria-label="Velikost písma v plánu"] button', { hasText: new RegExp(`^${scale}$`) }).click();
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const timing = [...document.querySelectorAll("div")].find((d) => d.children.length === 0 && /^(Zbývá|Přetahuje o|Začíná)/.test(d.textContent?.trim() ?? ""));
      if (!timing) return { timing: false };
      let box = timing.parentElement;
      while (box && getComputedStyle(box).overflow !== "hidden") box = box.parentElement;
      const t = timing.getBoundingClientRect(), b = box.getBoundingClientRect();
      const nedodelano = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("MON-2410"));
      return {
        timingBottom: Math.round(t.bottom), boxBottom: Math.round(b.bottom), timingVisible: t.bottom <= b.bottom + 0.5,
        nedodelanoMaStitky: !!nedodelano && nedodelano.textContent.includes("SCH Lumina LED") && nedodelano.textContent.includes("disperse lesk"),
      };
    });
    console.log("MONITOR", vp.width, scale, JSON.stringify(m));
    await page.screenshot({ path: `${OUT}/monitor-${vp.width}-${scale}.png` });
  }
  await ctx.close();
}

// ── Plán (plánovač): bublina nad druhým strojem + prodleva ──
for (const vp of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, "planovac");
  await page.waitForSelector("[data-machine-col]");
  const cols = await page.$$("[data-machine-col]");
  const colBoxes = await Promise.all(cols.map((c) => c.boundingBox()));
  for (const own of [0, 1]) {
    const cards = await cols[own].$$("[data-planner-block-card]");
    let card = null;
    for (const c of cards) { const b = await c.boundingBox(); if (b && b.height >= 60 && b.y > 120 && b.y + b.height < vp.height - 20) { card = { el: c, b }; break; } }
    if (!card) { console.log("PLAN", vp.width, own, "žádná vhodná karta v zorném poli"); continue; }
    await page.mouse.move(card.b.x + card.b.width / 2, card.b.y + card.b.height * 0.75);
    await page.waitForTimeout(150);
    const early = await findBubble(page);
    await page.waitForTimeout(450);
    const bubble = await findBubble(page);
    const nb = colBoxes[1 - own], ob = colBoxes[own];
    console.log("PLAN", vp.width, own === 0 ? "XL105" : "XL106", JSON.stringify({
      bezProdlevy: early === null,
      bublina: bubble,
      nadSousedem: !!bubble && bubble.left >= nb.x - 0.5 && bubble.right <= nb.x + nb.width + 0.5,
      mimoVlastni: !!bubble && (bubble.left >= ob.x + ob.width || bubble.right <= ob.x),
    }));
    await page.screenshot({ path: `${OUT}/plan-${vp.width}-${own === 0 ? "xl105" : "xl106"}.png` });
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
  }
  await ctx.close();
}
await browser.close();
```

Spusť: `node verify-etapa1.mjs <scratchpad>`

Očekáváno:
- MONITOR `timingVisible: true` ve všech čtyřech kombinacích.
- `nedodelanoMaStitky: true`.
- PLAN `bezProdlevy: true`, `nadSousedem: true`, `mimoVlastni: true` pro obě zakázky na obou šířkách.

Když některý řádek neodpovídá, jde o nález: zapsat, opravit v příslušném tasku a ověřit znovu.

Pozor na rate limit přihlášení (10 pokusů za 15 min). Když login selže bez chybové hlášky, restartuj VLASTNÍ dev server na 3001, nikdy Vojtův na 3111 (paměť `screenshot_bezici_appky`).

- [ ] **Krok 4: Build, lint, suite**

```bash
lsof -nP -iTCP:3111 -sTCP:LISTEN   # když běží Vojtův server, upozorni ho: build přepíše .next
npm run build && npm run lint
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Očekáváno: build bez chyb, lint 0 chyb, suite 0 selhání (s funkční DB).

- [ ] **Krok 5: Výsledek Vojtovi**

Screenshoty `monitor-*.png` a `plan-*.png` s naměřenými čísly pošli Vojtovi k vizuální kontrole. Pak pokračuj nasazením.

---

## Nasazení (po Vojtově OK k výsledku tasku 6)

Podle volby P2 = A a `docs/DEPLOY_WORKFLOW.md`:
1. Push větve `Vojta`, deploy na testovací instanci (port 3021, DB `igvyroba_test`). Bez migrace.
2. Proklik na testu:
   - **plánovač a pre-press:** bublina u zakázky XL 105 i XL 106, s otevřeným panelem i bez něj; při rychlém projetí myší sloupcem nevyskakuje.
   - **tiskař:** barvy a lak na velké kartě, ve frontě i v NEDODĚLÁNO; stupeň XL nepřekryje časovou osu.
3. Po potvrzení produkce: `mysqldump` záloha, otisk dat PRE/POST (i bez migrace), deploy, tvrdý refresh (POUCENI P13).

## Review během implementace (subagent-driven)

Každý task prochází dvoustupňovou review skillu (shoda se specem, kvalita kódu). Kam se zaměřit:
- **Task 1–2:** pořadí a tóny štítků. `MonitorView.tsx` se nesmí změnit. Mutační kontroly strážných testů musí být provedené, ne jen popsané.
- **Task 3:** geometrie proti tabulce ve specu. Test „úzké okno XL 105" musí padnout bez hlídacího řádku.
- **Task 4:** doslovnost přesunu. Porovnat JSX s originálem (`git show HEAD~:src/components/planner/BlockCard.tsx`), žádný rozdíl kromě odsazení a `anchorRef`.
- **Task 5:** projít, **za jakých podmínek se bublina vykreslí** (`showTooltip && hovered && tooltipOpen`, údržba, řádek datumových chipů), ne jen diff (POUCENI P17). Dál ověřit úklid časovače na odjetí myši a na odmontování.
