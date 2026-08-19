# Hover bublina pod kartu — implementační plán (etapa 8 vlny z vlákna s plánovačem)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hover bublina nad kartou bloku se dnes kreslí na `top = rect.top` — leží tedy vždy PŘES hovorovanou kartu (vědomý trade-off ze 17. 8., proti kterému teď míří stížnost Lukáše). Etapa mění SVISLÉ umístění na „pod kartu, s flipem nahoru u spodního okraje okna, s clampem do okna jako poslední záchranou" (rozhodnutí V5). Vodorovné umístění (`hoverTooltipLeft`, zarovnání ke sloupci stroje) se NEMĚNÍ.

**Architecture:** Nová čistá funkce `hoverTooltipTop()` v `src/lib/plannerHoverTooltip.ts`, sesterská k existující `hoverTooltipLeft()` — stejný soubor, stejný styl (TDD, tabulkové testy, JSDoc vysvětlující POŘADÍ pravidel). V `BlockCard.tsx` dostane bublina vlastní `ref` a `useLayoutEffect`, který ji po vykreslení do DOM (ale PŘED prvním malováním obrazovky) změří a teprve pak dopočítá finální `top` — bublina má obsahově proměnnou výšku (popis, specifikace, termíny, až 3+ tiskařské poznámky), takže pevný odhad by se stejnou třídou chyby rozešel jako rozpočty v `tiskarBlockView.ts` (CLAUDE.md). `useLayoutEffect` commituje synchronně před malováním, takže uživatel neuvidí provizorní pozici prvního snímku — vzor už je v repu (`PlannerPage.tsx:368`, zoom scroll anchor).

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · node:test + tsx. Čistě klientská geometrická změna — žádný dotčený API endpoint, žádná DB/schema změna, žádná nová serverová cesta.

**Spec:** `docs/audits/2026-08-19-audit-pripominky-planovace-druha-vlna.md` (sekce „Bod 4 — hover bublina", rozhodnutí V5) + `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` (Etapa 8) + rozhodnutá geometrie zadaná Vojtou 19. 8.: vertikálně pod kartu (`top = rect.bottom + 6`), flip nad kartu u spodního okraje (`top = rect.top - výška - 6`), clamp do okna jako poslední záchrana (obří karta přes celé okno).

## Global Constraints

- **Rozsah dotčených souborů je uzavřený a malý:** `src/lib/plannerHoverTooltip.ts`, `src/lib/plannerHoverTooltip.test.ts`, `src/components/planner/BlockCard.tsx`. Žádný jiný soubor `hoverTooltipLeft`/`plannerHoverTooltip` nekonzumuje (ověřeno grepem 19. 8.) — `TimelineGrid.tsx` má jen komentářový odkaz k háku `data-machine-col`, žádný import.
- **Repo má k 19. 8. necommitnuté změny z BĚŽÍCÍ autoposunové vlny** (`PlannerPage.tsx`, `BlockEdit.tsx`, `src/app/api/blocks/batch/route.ts`, `src/lib/overlapResolver.server.ts`, `src/lib/overlapResolver.server.test.ts`, `src/lib/reflow.server.ts`, `src/lib/cascadeLimit.server.test.ts`) — žádný z nich tato etapa needituje. Při commitu přesto přidávat soubory JMENOVITĚ (`git add src/lib/plannerHoverTooltip.ts ...`), nikdy `git add -A`, ať se cizí rozpracovaná práce nesveze do commitu této etapy.
- **Čísla řádků v tomto plánu jsou orientační** (psaná nad stavem repa 19. 8. 2026, branch `Vojta`) — vždy hledej podle citovaného kódu, ne podle čísla; sousední autoposunová vlna může řádky v `PlannerPage.tsx`/`BlockCard.tsx` mezitím posunout.
- **`pointerEvents: "none"` na bublině se NESMÍ ztratit** — bublina je čistě informativní, klik musí propadnout na kartu/mřížku pod ní.
- **`showTooltip` guard beze změny** (`block.type !== "UDRZBA" && !badgeHovered`) — údržba bublinu nemá, tahle etapa se guardu nedotýká.
- **`TOOLTIP_W` (240) a existující vodorovný clamp (`hoverTooltipLeft`) beze změny** — mění se výhradně svislá osa.
- Coding standards z CLAUDE.md, které se týkají téhle etapy: žádné hex/rgba literály nepřidávat (bublina dnes žádné nové barvy nezavádí, jen přepočet pozice), z-index přes `Z_OVERLAY.floating` beze změny.

---

### Task 1: `hoverTooltipTop()` — čistá funkce + tabulkové testy (TDD)

**Files:**
- Modify: `src/lib/plannerHoverTooltip.ts`
- Modify: `src/lib/plannerHoverTooltip.test.ts`

**Interfaces:**
- Produces: `TOOLTIP_VERTICAL_GAP` (konstanta, px), `HoverTooltipVerticalGeometry` (typ), `hoverTooltipTop()` (čistá funkce) — vše exportované z `plannerHoverTooltip.ts`, bez závislosti na DOM/React (stejně jako `hoverTooltipLeft`).

- [ ] **Step 1: Failing testy.** Na konec `src/lib/plannerHoverTooltip.test.ts` (za existující import) uprav import a přidej blok testů:
```typescript
import {
  hoverTooltipLeft,
  hoverTooltipTop,
  TOOLTIP_MARGIN,
  TOOLTIP_VERTICAL_GAP,
  TOOLTIP_W,
} from "./plannerHoverTooltip";
```
(nahraď dosavadní import na řádku 3, `hoverTooltipLeft` a zbylé konstanty zůstávají použité ve stávajících testech beze změny).

Za poslední dosavadní test (`"úzký sloupec: bublina přeteče přes levou hranu sloupce, ne mimo obrazovku"`) přidej:
```typescript
// ── hoverTooltipTop — svislé umístění (rozhodnutí V5, 19. 8. 2026) ─────────
// Bublina má obsahově proměnnou výšku (popis, specifikace, termíny, tiskařské
// poznámky), takže testy pracují s výškou jako s parametrem, ne s konkrétním
// obsahem — přesně jako hoverTooltipLeft pracuje se šířkou sloupce.
const VH = 1080;

test("bublina se umístí pod kartu, když se tam vejde", () => {
  const top = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH });
  assert.equal(top, 260 + TOOLTIP_VERTICAL_GAP);
});

test("hraniční případ: bublina se PŘESNĚ vejde dole u okraje okna → zůstává pod kartou", () => {
  // below + tooltipHeight musí přesně dosednout na (viewportHeight - margin).
  const tooltipHeight = 100;
  const cardBottom = VH - TOOLTIP_VERTICAL_GAP - tooltipHeight - TOOLTIP_VERTICAL_GAP; // 968
  const top = hoverTooltipTop({ cardTop: cardBottom - 60, cardBottom, tooltipHeight, viewportHeight: VH });
  assert.equal(top, cardBottom + TOOLTIP_VERTICAL_GAP, "rovnost vyhrává below větev, ne flip");
});

test("bublina se nevejde dole u spodního okraje okna → flipne nad kartu", () => {
  const top = hoverTooltipTop({ cardTop: 900, cardBottom: 960, tooltipHeight: 150, viewportHeight: VH });
  assert.equal(top, 900 - TOOLTIP_VERTICAL_GAP - 150);
});

test("po flipu bublina dosedne přesně na horní hranu karty mínus mezera (žádný extra posun)", () => {
  const cardTop = 900;
  const tooltipHeight = 150;
  const top = hoverTooltipTop({ cardTop, cardBottom: 960, tooltipHeight, viewportHeight: VH });
  assert.equal(top + tooltipHeight + TOOLTIP_VERTICAL_GAP, cardTop);
});

test("obří karta přes celé okno: nevejde se ani nahoru → clamp k hornímu okraji okna", () => {
  const top = hoverTooltipTop({ cardTop: -50, cardBottom: 1200, tooltipHeight: 150, viewportHeight: VH });
  assert.equal(top, TOOLTIP_VERTICAL_GAP, "poslední záchrana: horní okraj okna, ne záporná souřadnice");
});

test("bublina vyšší než celé okno: last-resort clamp pořád vrátí platnou souřadnici", () => {
  const top = hoverTooltipTop({ cardTop: 0, cardBottom: VH, tooltipHeight: VH + 500, viewportHeight: VH });
  assert.equal(top, TOOLTIP_VERTICAL_GAP);
});

test("vlastní margin parametr se respektuje místo výchozí TOOLTIP_VERTICAL_GAP", () => {
  const top = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH, margin: 20 });
  assert.equal(top, 260 + 20);
});

test("výchozí margin je TOOLTIP_VERTICAL_GAP, ne vodorovné TOOLTIP_MARGIN (jiná konvence, notepopover vzor)", () => {
  assert.notEqual(TOOLTIP_VERTICAL_GAP, TOOLTIP_MARGIN);
  const withDefault = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH });
  const withExplicit = hoverTooltipTop({ cardTop: 200, cardBottom: 260, tooltipHeight: 150, viewportHeight: VH, margin: TOOLTIP_VERTICAL_GAP });
  assert.equal(withDefault, withExplicit);
});
```
Run: `node --test --import tsx src/lib/plannerHoverTooltip.test.ts`
Expected: FAIL — `hoverTooltipTop`/`TOOLTIP_VERTICAL_GAP` v `plannerHoverTooltip.ts` zatím neexistují (chyba importu/kompilace, ne jen selhané assercí).

- [ ] **Step 2: Implementace.** Na konec `src/lib/plannerHoverTooltip.ts` (za `hoverTooltipLeft`) přidej:
```typescript
/**
 * Svislá mezera bubliny od hrany karty (dole i po flipu nahoře) v px.
 * Menší než vodorovné `TOOLTIP_MARGIN` (10) záměrně — kopíruje odstup
 * zavedený u note popoveru (`noteRect.bottom + 6`, `BlockCard.tsx`), ne
 * vodorovnou konvenci této funkce.
 */
export const TOOLTIP_VERTICAL_GAP = 6;

export type HoverTooltipVerticalGeometry = {
  /** Horní hrana hovorované karty (souřadnice viewportu). */
  cardTop: number;
  /** Dolní hrana hovorované karty (souřadnice viewportu). */
  cardBottom: number;
  /** Skutečná (naměřená) výška bubliny v px — obsah je proměnný délkou. */
  tooltipHeight: number;
  /** Výška okna prohlížeče. */
  viewportHeight: number;
  /** Odstup od karty i od okraje obrazovky; výchozí `TOOLTIP_VERTICAL_GAP`. */
  margin?: number;
};

/**
 * Vrátí `top` (v souřadnicích viewportu) pro `position: fixed` bublinu.
 *
 * Tři úrovně v tomto pořadí (rozhodnutí V5, audit druhé vlny 19. 8. 2026,
 * bod 4 — „bublina nezasahuje do bloku"):
 *  1. POD kartou — výchozí, drží prostorovou vazbu na hovorovaný blok.
 *  2. Když se dole nevejde k okraji okna, FLIP nad kartu — vzor už v repu
 *     u note popoveru (`BlockCard.tsx`, `noteRect.bottom + 6`).
 *  3. Když se nevejde ani nahoru (karta vyšší než okno), CLAMP k hornímu
 *     okraji okna — poslední záchrana, nahrazuje dřívější provizorní
 *     `Math.max(8, Math.min(rect.top, vh - 220))`, jen teď se skutečnou
 *     naměřenou výškou místo pevně odhadnutých 220 px.
 *
 * Pořadí je záměrné a nesmí se prohodit, ze stejného důvodu jako u
 * `hoverTooltipLeft`: bublina, která odejde z obrazovky, nenese informaci
 * žádnou — překryv aspoň nějakou.
 */
export function hoverTooltipTop({
  cardTop,
  cardBottom,
  tooltipHeight,
  viewportHeight,
  margin = TOOLTIP_VERTICAL_GAP,
}: HoverTooltipVerticalGeometry): number {
  const below = cardBottom + margin;
  if (below + tooltipHeight <= viewportHeight - margin) {
    return below;
  }
  const above = cardTop - margin - tooltipHeight;
  if (above >= margin) {
    return above;
  }
  // Poslední záchrana: ani nad kartou není místo (obří karta přes celé okno,
  // nebo bublina vyšší než okno). Stejná podlaha/strop logika jako u
  // `hoverTooltipLeft` výš, jen ve svislé ose — podlaha (horní okraj okna)
  // vyhrává, aby se nevrátila souřadnice mimo obrazovku.
  const maxTop = viewportHeight - tooltipHeight - margin;
  return Math.max(margin, Math.min(above, maxTop));
}
```
Do úvodního dokumentačního bloku souboru (řádky 1–34, popisující vodorovné pravidlo) přidej na konec jednu poznámkovou větu, ať budoucí čtenář ví, že svislá osa žije ve stejném souboru pod jiným jménem:
```
 *
 * ── Svislá osa ──────────────────────────────────────────────────────────────
 * Svislé umístění řeší samostatná funkce `hoverTooltipTop()` níž v tomto
 * souboru — jiná osa, jiné pravidlo (pod kartu s flipem), ale stejný důvod
 * mít to jako testovatelnou čistou funkci mimo JSX.
 */
```
- [ ] **Step 3:** Run: `node --test --import tsx src/lib/plannerHoverTooltip.test.ts`
Expected: PASS, všechny testy (staré i nové) zelené.
- [ ] **Step 4: Commit** — `feat(planner): hoverTooltipTop cista funkce pro svisle umisteni bubliny`

### Task 2: Zapojení v `BlockCard.tsx` — měření skutečné výšky + nový výpočet `top`

**Files:**
- Modify: `src/components/planner/BlockCard.tsx`

**Interfaces:**
- Consumes: `hoverTooltipTop`, `TOOLTIP_VERTICAL_GAP`-nezávislý default (Task 1).
- Produces: bublina s `top` dopočítaným z naměřené výšky; `pointerEvents: none` a `showTooltip` guard beze změny.

**Proč měření refem, ne pevný odhad:** obsah bubliny je délkově proměnný (popis, specifikace, součet split skupiny, sekce termínů, až 3+ tiskařské poznámky s vlastním datem a autorem) — pevný budget by se stejnou třídou chyby rozešel jako rozpočty v `tiskarBlockView.ts`, jen tady by šlo o skrytí/přesah bubliny, ne tlačítka HOTOVO. `useLayoutEffect` doběhne PO commitu do DOM, ale PŘED malováním obrazovky prohlížečem — dvojí render (provizorní výška 0, pak naměřená) je tedy pro uživatele neviditelný. Vzor `useLayoutEffect` pro pozicování po změřeném rozměru je už v repu (`PlannerPage.tsx:368`, kotva scrollu při zoomu).

- [ ] **Step 1:** Import na řádku 3 rozšiř o `useLayoutEffect`:
```typescript
import { useLayoutEffect, useRef, useState } from "react";
```
Import na řádku 10 rozšiř o `hoverTooltipTop`:
```typescript
import { hoverTooltipLeft, hoverTooltipTop, TOOLTIP_W } from "@/lib/plannerHoverTooltip";
```
- [ ] **Step 2:** Vedle `blockCardRef` (u ostatních `useRef`/`useState` deklarací, dnes kolem `const blockCardRef = useRef<HTMLDivElement>(null);`) přidej ref a stav pro naměřenou výšku bubliny plus samotný layout effect:
```typescript
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
- [ ] **Step 3:** V IIFE hover bubliny nahraď dnešní výpočet `top`:
```typescript
        const top = Math.max(8, Math.min(rect.top, vh - 220));
```
za:
```typescript
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
```
- [ ] **Step 4:** Na `<div>` bubliny (ten s `position: "fixed"`, `pointerEvents: "none"`, obsahující číslo zakázky/popis/termíny) přidej `ref={tooltipRef}` — `pointerEvents: "none"` a všechny ostatní styly zůstávají beze změny:
```typescript
        return createPortal(
          <div ref={tooltipRef} style={{
            position: "fixed",
            left,
            top,
            width: TOOLTIP_W,
            zIndex: Z_OVERLAY.floating,
            ...
```
- [ ] **Step 5:** Uprav komentář nad IIFE (dnešní blok začínající `{/* ── Hover bublina — portálovaná mimo stacking context. ...`) — doplň větu o svislém umístění, ať sedí se skutečností:
```
      {/* ── Hover bublina — portálovaná mimo stacking context. Ukazuje se nad KAŽDOU
             kartou kromě údržby (`showTooltip` výš), ne jen nad nízkými. Vodorovně
             se zarovnává ke sloupci stroje (`hoverTooltipLeft`); svisle sedí POD
             kartou s flipem nahoru u spodního okraje okna (`hoverTooltipTop`,
             rozhodnutí V5, 19. 8. 2026) — nezakrývá už ani hovorovanou kartu. ── */}
```
- [ ] **Step 6:** `npm run build`
Expected: 0 TS chyb.
- [ ] **Step 7: Ruční ověření na dev (port 3001).** Na kartě uprostřed obrazovky bublina sedí POD kartou. Na kartě blízko dolního okraje okna (poslední řádky viditelné mřížky, případně scrollnout dolů) bublina flipne NAD kartu. Na kartě s dlouhým popisem/specifikací/více tiskařskými poznámkami (jiná výška bubliny) se pozice přizpůsobí bez viditelného poskočení při najetí myší. Bublina nikdy nezakrývá vlastní hovorovanou kartu (na rozdíl od dnešního stavu).
- [ ] **Step 8: Commit** — `feat(planner): hover bublina pod kartou s flipem nahoru (rozhodnuti V5)`

### Task 3: Celá suite, build, dokumenty

- [ ] **Step 1:** Celá test suite (glob nejde do podsložek — každá složka zvlášť, viz CLAUDE.md):
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: vše zelené (`plannerHoverTooltip.test.ts` přibyl o 8 testů proti výchozímu stavu; `BlockCard.tsx` nemá vlastní testovací soubor — komponentu ověřuje Step 7 Tasku 2 a proklik v koordinátorském kroku níž, ne automatizovaný test).
- [ ] **Step 2:** `npm run build` → 0 chyb; `npm run lint` → 0 chyb.
- [ ] **Step 3:** Dokumenty:
  - V `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` označ nadpis etapy 8 jako HOTOVO (vzor: nadpis etapy 1, `· **HOTOVO <datum>**` vložené za název etapy, před `· odhad:`, s datem skutečného dokončení).
  - Do `docs/vyvoj-historie.md` přidej novou sekci hned ZA `## Hover bublina se zarovnává ke sloupci stroje (17. 8. 2026)` (řádek ~2095) — tahle etapa je jejím přímým pokračováním, patří vedle sebe. Drž se stejné struktury jako ta sekce: nadpis s datem, „Připomínka" (citace z auditu druhé vlny, bod 4 — „bublina zasahuje do bloku"), „Nové pravidlo" (pod kartu / flip / clamp), „Kód" (`hoverTooltipTop` v `plannerHoverTooltip.ts`, ref+`useLayoutEffect` v `BlockCard.tsx`, PROČ měření místo pevného odhadu), „Ověření" (výsledek `npm run build`, počet zelených testů, výsledek ručního prokliku z koordinátorského kroku níž).
- [ ] **Step 4: Commit** — `docs(planner): etapa 8 hotova` a ohlásit Vojtovi (tempo: zastavit, čekat na OK).
- [ ] **Step 5 (koordinátor, po OK od Vojty — NE implementátor v rámci TDD kroků výš):** nasadit na test 3021 a ruční proklik (Playwright nebo přímo v prohlížeči) — ověřit chování z Task 2 Step 7 v běžící appce, ne jen lokálně; teprve pak dát Lukášovi k vyzkoušení na testu (audit druhé vlny to výslovně slibuje: „dáme Vám to vyzkoušet na testovací stránce").

---

## Self-review

**Pokrytí zadání:**
- Vodorovně beze změny (`hoverTooltipLeft` netknutý, žádný test na něj nesahá) — splněno.
- Svisle: pod kartu (`rect.bottom + 6`) → Task 1 below-větev + Task 1 test 1. Flip nahoru u spodního okraje (`rect.top - výška - 6`) → Task 1 above-větev + testy 3–4. Clamp do okna jako poslední záchrana u obří karty → Task 1 poslední-záchrana větev + testy 5–6. Všechny tři úrovně mají vlastní test, včetně jednoho hraničního (test 2, přesná rovnost).
- Výška bubliny — rozhodnuto pro měření refem + `useLayoutEffect` (ne pevný odhad): zdůvodněno v Task 2 (obsahová proměnlivost — popis/specifikace/termíny/poznámky), s explicitním vysvětlením, proč dvojí render nezpůsobí viditelný flicker (layout effect commituje před malováním), a s odkazem na existující vzor v repu (`PlannerPage.tsx:368`).
- `pointerEvents: none` zachováno beze změny — explicitně zmíněno v Global Constraints i v Task 2 Step 4.
- `showTooltip` guard (ne pro UDRZBA) zachován beze změny — zmíněno v Global Constraints, nikde se needituje.
- `TOOLTIP_W` (240) a existující vodorovný clamp beze změny.
- TDD dodrženo v Task 1: testy napřed (Step 1, explicitně FAIL na chybějící export), pak implementace (Step 2), pak PASS (Step 3).
- Task 2 = zapojení v BlockCard (měření výšky, výpočet top) + build — přesně podle zadání.
- Task 3 = suite + docs, vzor Task 7 materiálového plánu (suite → build/lint → dokumenty → commit) + samostatný koordinátorský krok pro ruční proklik a předání Lukášovi, oddělený od implementačních TDD kroků.

**Žádné placeholdery:** veškerý uvedený kód (funkce, testy, JSX diffy) je kompletní a proveditelný přesně tak, jak je napsaný — žádné `// TODO` ani vynechané větve. Dokumentační kroky (Task 3 Step 3) záměrně necitují přesný text budoucí prózy (datum dokončení, výsledky prokliku) ani commit hash, protože ty vzniknou až při provedení — stejný styl jako Task 7 Step 3 v `2026-08-19-material-castecne-vydano.md`, který taky neopisuje výsledný text, jen popisuje akci a vzor, podle kterého se má postupovat.

**Typová konzistence:** `HoverTooltipVerticalGeometry` kopíruje strukturu `HoverTooltipGeometry` (název, styl JSDoc komentářů u polí, volitelný `margin` s výchozí hodnotou přes destructuring). `hoverTooltipTop` má stejný podpis vzoru jako `hoverTooltipLeft` (objekt → number, žádná DOM závislost, testovatelná bez jsdom). V `BlockCard.tsx` `tooltipHeight` je `number` (ne `number | null`) — zjednodušuje `hoverTooltipTop` (nemusí řešit `null`), a 0 je platná neutrální hodnota pro „bublina ještě není v DOM" i pro „bublina zavřená".

**Nejasnosti / rizika, na která má implementátor dávat pozor:**
1. `useLayoutEffect` bez pole závislostí běží po KAŽDÉM renderu `BlockCard` (ne jen při hoveru) — u karet s vysokou frekvencí re-renderů (drag, resize) jde o `getBoundingClientRect()` navíc při každém commitu. Měření samo je levné (jeden reflow dotaz) a `setState` bail-outuje na nezměněné hodnotě, takže riziko je nízké, ale pokud by profiling ukázal problém, řešením je podmínit efekt na `hovered` (`if (!hovered) return;`) — záměrně to tak Task 2 nedělá, aby jedna větev pokryla i reset výšky na 0 při zavření bubliny bez zvláštního kódu navíc; zmínit v code review.
2. Task 3 Step 3 dává instrukci, KAM a JAK doplnit dokumentaci (vzor, umístění), ne přesný text — implementátor/koordinátor musí sám zformulovat prózu podle skutečného výsledku prokliku, stejně jako se to dělalo u předchozích etap.
3. Žádný automatizovaný test na `BlockCard.tsx` samotný neexistuje (v repu není `src/components/**/*.test.tsx` konvence) — jediná pojistka integrace je `npm run build` (typová) + ruční proklik. To je stejné omezení, jaké mělo i Task 4/5 materiálového plánu (BlockEdit/BlockCard tam taky měly jen „Ruční ověření na dev", ne test).
