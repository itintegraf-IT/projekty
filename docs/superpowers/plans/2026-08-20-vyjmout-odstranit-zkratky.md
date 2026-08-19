# Vyjmout/Odstranit v menu + fokusová past + QWERTZ — implementační plán (etapa 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tři nezávislé opravy jedné prosby Lukáše („zkratky často nefungují", „chci Vyjmout a Odstranit v menu"), zdokumentované v audit druhé vlny §2:
1. Skutečná QWERTZ regrese v `shortcutLetter` — na české/německé klávesnici Ctrl+Z provede REDO místo UNDO (a naopak).
2. Skutečný kořen „zkratky nefungují": `handleBlockMouseDown` potlačuje `preventDefault()`, čímž zablokuje odebrání fokusu z hledacího pole při kliku na blok — klávesový guard v `PlannerPage.tsx` pak zahodí VŠECHNY zkratky.
3. Položky „✂ Vyjmout" a „🗑 Odstranit" v kontextovém menu bloku — akce už existují (Ctrl+X, Delete), chybí jen myší dostupný vstup, který funguje bez ohledu na fokus.

**Architecture:** Tři na sobě nezávislé, malé zásahy do existujícího kódu — žádná nová vrstva ani datový model.
- Task 1 je čistě uvnitř `src/lib/keyboardShortcuts.ts` (přerovnání rozhodovací logiky pro pár Z/Y, C/X/V beze změny).
- Task 2 zavádí jeden nový čistý helper `src/lib/focusGuard.ts` a volá ho ze dvou mousedown handlerů v `TimelineGrid.tsx`.
- Task 3 protahuje `onBlockCopy` vzor (BlockCard ← TimelineGrid ← PlannerPage) o dva nové callbacky `onBlockCut`/`onBlockDelete`, extrahuje tělo Ctrl+X jednoblokové větve do sdílené funkce `cutSingleBlock`, a sjednocuje potvrzovací dialog smazání na jeden zdroj pravdy (`pendingDeleteBlock`), aby fungoval z klávesnice i z menu bez duplikace JSX.

**Tech Stack:** Next.js 16 · React · TypeScript · node:test + tsx (bez jsdom — `focusGuard.ts` je proto navržený jako čistá funkce s injektovaným elementem, ne s přímým čtením `document.activeElement`).

**Spec:** `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` (etapa 7) + `docs/audits/2026-08-19-audit-pripominky-planovace-druha-vlna.md` (sekce „Bod 2 — Vyjmout/Odstranit + proč zkratky nefungují", jediný zdroj file:line důkazů).

## Global Constraints

- Čísla řádků v tomto plánu jsou aktuální k HEAD `Vojta` v okamžiku psaní plánu (19. 8. 2026) — přesto vždy hledej podle citovaného kódu, ne slepě podle čísla (soubory se mezi tasky mění).
- Žádný nový `console.*` — pravidlo z CLAUDE.md míří na API routy; všechny tři tasky jsou čistě klientský kód. `console.error` uvnitř existujících catch bloků v `PlannerPage.tsx` (např. `handleDeleteBlock`) zůstává beze změny — je to zavedená klientská konvence, ne API routa, a tento plán ho nerozšiřuje ani neodstraňuje.
- Mouse handlery `if (e.button !== 0) return;` — `handleBlockMouseDown` ho už má (Task 2 ho jen doplňuje o blur, nemění). Nové položky menu v Tasku 3 jsou Radix `ContextMenuItem onClick`, ne raw mousedown — button-guard se jich netýká. `handleResizeMouseDown` guard nemá už dnes (mimo rozsah této etapy, audit ho nezmiňuje — nerozšiřovat zásah bokem).
- Commit po každém tasku (viz konec každého tasku — `git commit` heredoc s `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`).
- `npm run build` po každém tasku s UI změnou — Task 2 a Task 3 (mění `TimelineGrid.tsx`/`BlockCard.tsx`/`PlannerPage.tsx`). Task 1 je čistá knihovna beze změny komponent — stačí testy, build spustit až na konci Tasku 3 (Task 4) společně s celou suitou.
- Baseline testů před touto etapou (ověřeno spuštěním 19. 8. 2026): **1361 testů, 0 fail** (`node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`). Task 1 přidá 1 test, Task 2 přidá 5 testů (nový soubor) → očekávaný stav po Tasku 2: **1367 testů**. Task 3 nemění automatizované testy (čistě UI wiring — ověřuje se ručně na dev, vzorem Tasku 5 z `2026-08-19-material-castecne-vydano.md`).

---

### Task 1: QWERTZ regrese — `shortcutLetter` preferuje `e.key` pro pár Z/Y

**Files:**
- Modify: `src/lib/keyboardShortcuts.ts`
- Modify: `src/lib/keyboardShortcuts.test.ts`

**Interfaces:**
- Consumes: nic nové — funkce `shortcutLetter(e: KeyLike): ShortcutLetter | null` má stejný podpis jako dnes.
- Produces: opravené chování pro pár `"z"`/`"y"`; C/X/V beze změny (pozičně shodné mezi QWERTY a QWERTZ, audit §2 to výslovně potvrzuje).

**Kořen (audit §2, ověřeno přímým čtením `keyboardShortcuts.ts:45-51`):** `KeyboardEvent.code` je layout-independent — vztahuje se vždy k pozici klávesy na americkém referenčním rozložení (QWERTY), ne k tomu, co klávesnice fyzicky vytiskla. Na české/německé QWERTZ klávesnici jsou klávesy Z a Y fyzicky prohozené oproti QWERTY — uživatel, který stiskne klávesu popsanou „Z" (a napíše „z"), dostane `code: "KeyY"`. Dnešní `shortcutLetter` zkouší `e.code` JAKO PRVNÍ (`CODE_TO_LETTER["KeyY"] === "y"`), takže Ctrl+Z na QWERTZ vykoná **REDO místo UNDO** (a symetricky Ctrl+Y provede UNDO místo REDO).

**Rozhodovací tabulka (nové pořadí — zapsat i jako komentář ve zdrojáku):**

| Krok | Podmínka | Výsledek |
|---|---|---|
| 1 | `e.key.toLowerCase()` ∈ {`"z"`, `"y"`} | vrátí přímo tohle písmeno (typed) |
| 2 | jinak: `e.code` má záznam v `CODE_TO_LETTER` | vrátí `CODE_TO_LETTER[e.code]` |
| 3 | jinak: `e.key.toLowerCase()` ∈ `SHORTCUT_LETTERS` | vrátí `e.key.toLowerCase()` |
| 4 | jinak | `null` |

Krok 1 je nová výjimka JEN pro Z/Y. Kroky 2–4 jsou beze změny dnešní logika (`e.code` first, `e.key` fallback) — platí pro C/X/V i pro Z/Y v případě, že `e.key` nenese přímo „z"/„y" (např. cyrilice).

**Tabulka vstup → výstup (dokládá krok, který rozhodl, včetně regresních případů):**

| Vstup (`key` / `code`) | Rozhodl krok | Výstup | Poznámka |
|---|---|---|---|
| `z` / `KeyZ` | 1 | `z` | běžný stav, QWERTY i QWERTZ shodné |
| `Z` / `KeyZ` | 1 | `z` | Caps Lock |
| `z` / `KeyY` | 1 | **`z`** | **QWERTZ: Ctrl+Z = undo (oprava regrese)** — dřív vracelo `y` |
| `Z` / `KeyY` | 1 | **`z`** | **QWERTZ + Caps Lock** — dřív vracelo `y` |
| `y` / `KeyY` | 1 | `y` | běžný stav |
| `y` / `KeyZ` | 1 | **`y`** | **QWERTZ: Ctrl+Y = redo (oprava regrese)** — dřív vracelo `z` |
| `Y` / `KeyZ` | 1 | **`y`** | **QWERTZ + Caps Lock** — dřív vracelo `z` |
| `я` / `KeyZ` | 2 (fallback) | `z` | cyrilice — `key` není z/y, `code` ukazuje fyzickou polohu |
| `я` (bez `code`) | — (krok 3 selže) | `null` | bez fyzické klávesy nejde nic odvodit (beze změny) |
| `c` / `KeyC` | 2 | `c` | C/X/V beze změny — pozičně shodné |
| `C` / `KeyC` | 2 | `c` | Caps Lock, C/X/V |
| `c` (bez `code`) | 3 | `c` | fallback bez code (beze změny) |

- [ ] **Step 1: Failing test** — do `keyboardShortcuts.test.ts` přidej (za test „shortcutLetter: Caps Lock i cizí rozložení naráz"):
```typescript
test("shortcutLetter: QWERTZ regrese (audit 19. 8. 2026) — na české/německé klávesnici je typed 'z' fyzicky na KeyY", () => {
  // Fyzická poloha, kterou uživatel na QWERTZ vnímá jako klávesu "Z", hlásí
  // `code: "KeyY"` (code je layout-independent vůči US referenčnímu rozložení).
  // `key` ale správně nese napsaný znak — u tohohle páru musí rozhodovat on,
  // jinak Ctrl+Z na QWERTZ provede REDO místo UNDO (a Ctrl+Y naopak UNDO
  // místo REDO).
  assert.equal(shortcutLetter({ key: "z", code: "KeyY" }), "z"); // Ctrl+Z = undo
  assert.equal(shortcutLetter({ key: "Z", code: "KeyY" }), "z"); // + Caps Lock
  assert.equal(shortcutLetter({ key: "y", code: "KeyZ" }), "y"); // Ctrl+Y = redo
  assert.equal(shortcutLetter({ key: "Y", code: "KeyZ" }), "y"); // + Caps Lock
});
```
Run: `node --test --import tsx src/lib/keyboardShortcuts.test.ts`
Expected: FAIL na všech čtyřech nových assercí — `shortcutLetter({ key: "z", code: "KeyY" })` dnes vrací `"y"`, ne `"z"` (a symetricky obráceně).

- [ ] **Step 2: Implementace** — nahraď tělo `shortcutLetter` v `keyboardShortcuts.ts`:
```typescript
export function shortcutLetter(e: KeyLike): ShortcutLetter | null {
  // VÝJIMKA pro pár Z/Y (od 19. 8. 2026, oprava QWERTZ regrese): `e.code` je
  // pro tenhle jediný pár zavádějící, protože fyzické klávesy Z a Y jsou na
  // české a německé QWERTZ klávesnici PROHOZENÉ oproti americkému
  // referenčnímu rozložení, ke kterému se `KeyboardEvent.code` vždy vztahuje
  // (je to POZICE, ne napsaný znak). Uživatel, který na QWERTZ napíše "z",
  // má `code: "KeyY"` — kód-first logika (viz níž) by to vyhodnotila jako
  // "y" a Ctrl+Z by omylem provedl REDO místo UNDO (a symetricky Ctrl+Y by
  // dělal UNDO). Pro Z/Y proto rozhoduje `e.key` JAKO PRVNÍ — `toLowerCase()`
  // pořád řeší Caps Lock stejně jako v kódu níž; `e.code` zůstává záložní
  // cestou pro případ, že `e.key` nenese latinské z/y vůbec (cyrilice a jiná
  // nelatinková rozložení — tam ukazuje jen na fyzickou polohu klávesy).
  // Pár C/X/V touhle výjimkou NEPROCHÁZÍ — jejich fyzická poloha je mezi
  // QWERTY a QWERTZ shodná, takže pořadí code→key jim nevadí (viz komentář
  // k CODE_TO_LETTER výš a audit `2026-08-19-audit-pripominky-planovace-druha-vlna.md` §2).
  const typed = e.key.toLowerCase();
  if (typed === "z" || typed === "y") return typed;

  const fromCode = e.code ? CODE_TO_LETTER[e.code] : undefined;
  if (fromCode) return fromCode;

  return (SHORTCUT_LETTERS as readonly string[]).includes(typed) ? (typed as ShortcutLetter) : null;
}
```
- [ ] **Step 3: Test znovu — musí PROJÍT** (vč. VŠECH stávajících testů v souboru, beze změny):
Run: `node --test --import tsx src/lib/keyboardShortcuts.test.ts`
Expected: všechny testy PASS — nová i všech 12 stávajících (ověřeno ručně proti nové logice: `c/x/v` a Caps Lock/cyrilice případy prochází stejnou větví jako dřív, protože `typed` u nich nikdy není `"z"`/`"y"`).
- [ ] **Step 4: Aktualizuj úvodní docstring souboru** (řádky 1–19) — za odstavec „Řešení bere klávesu ze DVOU zdrojů…" dopiš odstavec vysvětlující výjimku Z/Y (stejný text jako inline komentář ve Step 2, ať čtenář najde vysvětlení na obou místech, kde ho hledá).
- [ ] **Step 5: Ověření:**
Run: `npm run build`
Expected: 0 TS chyb (funkce nemění podpis, žádný konzument nepotřebuje úpravu).
- [ ] **Step 6: Commit:**
```bash
git add src/lib/keyboardShortcuts.ts src/lib/keyboardShortcuts.test.ts
git commit -m "$(cat <<'EOF'
fix(shortcuts): QWERTZ Ctrl+Z/Ctrl+Y regrese — e.key rozhoduje pred e.code pro par Z/Y

Na ceske/nemecke QWERTZ klavesnici jsou Z a Y fyzicky prohozene oproti
QWERTY, na ktere se vztahuje layout-independent e.code. Kod-first
logika proto Ctrl+Z vyhodnotila jako Ctrl+Y (redo misto undo) a naopak.
Pro par Z/Y ted rozhoduje napsany znak (e.key, Caps Lock-safe pres
toLowerCase); C/X/V zustavaji bez zmeny, jsou pozicne shodne.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fokusová past — blur editovatelného prvku při mousedownu na blok

**Files:**
- Create: `src/lib/focusGuard.ts`
- Create: `src/lib/focusGuard.test.ts`
- Modify: `src/app/_components/TimelineGrid.tsx`

**Interfaces:**
- Produces: `blurEditableFocus(activeElement: BlurableElement | null): void` — čistá funkce, blurne element jen když je `tagName` INPUT/TEXTAREA/SELECT.
- Consumes (v `TimelineGrid.tsx`): `document.activeElement`, přetypovaný na `HTMLElement | null` v místě volání (typová hranice mezi DOM a čistou funkcí je záměrně v komponentě, ne v helperu — helper zůstává testovatelný bez `document`).

**Kořen (audit §2, ověřeno):** `handleBlockMouseDown` (`TimelineGrid.tsx:1207-1233`) volá `e.preventDefault()` na řádku 1210, aby mousedown nezpůsobil textovou selekci při tažení bloku. Vedlejší efekt: `preventDefault()` na `mousedown` potlačí i VÝCHOZÍ přesun fokusu prohlížeče na kliknutý element. Typický plánovačův postup „najdi zakázku v hledání → klikni na ni → Ctrl+X" tak nechá fokus stále v hledacím `<input>`. Klávesový handler v `PlannerPage.tsx:2767-2768` (`if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;`) pak zahodí VŠECHNY zkratky — beze změny UI, bez chybové hlášky, myš dál funguje normálně. Test na jsdom není v projektu k dispozici (`node:test` bez DOM) — helper je proto navržený jako čistá funkce s injektovaným fake objektem, ne s přímým čtením `document.activeElement` uvnitř.

- [ ] **Step 1: Failing test** — nový soubor `src/lib/focusGuard.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { blurEditableFocus, type BlurableElement } from "./focusGuard.js";

function fakeElement(tagName: string): BlurableElement & { blurred: boolean } {
  const el = { tagName, blurred: false, blur() { el.blurred = true; } };
  return el;
}

test("blurEditableFocus: INPUT se blurne", () => {
  const el = fakeElement("INPUT");
  blurEditableFocus(el);
  assert.equal(el.blurred, true);
});

test("blurEditableFocus: TEXTAREA se blurne", () => {
  const el = fakeElement("TEXTAREA");
  blurEditableFocus(el);
  assert.equal(el.blurred, true);
});

test("blurEditableFocus: SELECT se blurne", () => {
  const el = fakeElement("SELECT");
  blurEditableFocus(el);
  assert.equal(el.blurred, true);
});

test("blurEditableFocus: BUTTON se NEblurne (není editovatelný prvek)", () => {
  const el = fakeElement("BUTTON");
  blurEditableFocus(el);
  assert.equal(el.blurred, false);
});

test("blurEditableFocus: null je no-op, nehází (mousedown mimo focus)", () => {
  assert.doesNotThrow(() => blurEditableFocus(null));
});
```
Run: `node --test --import tsx src/lib/focusGuard.test.ts`
Expected: FAIL — modul `./focusGuard.js` zatím neexistuje.

- [ ] **Step 2: Implementace** — nový soubor `src/lib/focusGuard.ts`:
```typescript
/**
 * Fokusová past (audit druhé vlny 19. 8. 2026, bod 2): `handleBlockMouseDown`
 * volá `e.preventDefault()`, aby klik na blok nezpůsobil textovou selekci při
 * tažení — jenže `preventDefault()` na `mousedown` zároveň potlačí VÝCHOZÍ
 * přesun fokusu prohlížeče na kliknutý element. Zůstane-li fokus v hledacím
 * poli (INPUT), klik na blok ho odtud nevytáhne — a klávesový guard v
 * `PlannerPage.tsx` (`tag === "INPUT" | "TEXTAREA" | "SELECT"`) pak zahodí
 * VŠECHNY zkratky (Ctrl+X, Delete, …), aniž by o tom uživatel dostal
 * jakoukoli zpětnou vazbu — myš dál funguje, aplikace vypadá zdravě.
 *
 * Řešení: při mousedownu na blok/resize handle explicitně blurnout aktivní
 * editovatelný element. Čistá funkce — bere element jako parametr, ne
 * `document.activeElement` přímo, ať jde testovat fake objektem bez jsdom
 * (v projektu není k dispozici).
 */

/** Jen ta část elementu, kterou blur potřebuje — kvůli testovatelnosti bez DOM. */
export type BlurableElement = { tagName: string; blur: () => void };

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Blurne `activeElement`, pokud je to INPUT/TEXTAREA/SELECT. No-op pro
 * cokoliv jiné (tlačítko, div, `null`) — mousedown na blok nesmí rušit fokus,
 * který uživatel nemá v editovatelném poli.
 */
export function blurEditableFocus(activeElement: BlurableElement | null): void {
  if (!activeElement) return;
  if (EDITABLE_TAGS.has(activeElement.tagName)) activeElement.blur();
}
```
- [ ] **Step 3: Test znovu — musí PROJÍT.**
Run: `node --test --import tsx src/lib/focusGuard.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 4: Zapojit do `TimelineGrid.tsx`** — import (vedle ostatních `@/lib/*` importů, např. za řádek `import { blockMatchesQuery } from "@/lib/orderSearch";`):
```typescript
import { blurEditableFocus } from "@/lib/focusGuard";
```
V `handleBlockMouseDown` (dnes ř. 1207-1233) hned za `e.preventDefault();`:
```typescript
  function handleBlockMouseDown(block: Block, e: React.MouseEvent) {
    if (block.locked) return;
    if (e.button !== 0) return;
    e.preventDefault();
    blurEditableFocus(document.activeElement as (HTMLElement | null));
    const vs = viewStartRef.current;
    // ... beze změny
```
V `handleResizeMouseDown` (dnes ř. 1235-1247) hned za `e.preventDefault();`:
```typescript
  function handleResizeMouseDown(block: Block, e: React.MouseEvent) {
    if (block.locked) return;
    e.preventDefault();
    blurEditableFocus(document.activeElement as (HTMLElement | null));
    const vs = viewStartRef.current;
    // ... beze změny
```
(Resize handle má stejnou past — tažení hranice bloku má stejný `preventDefault()` vedlejší efekt, audit ho výslovně jmenuje vedle `handleBlockMouseDown`.)

- [ ] **Step 5: Ověření:**
Run: `npm run build`
Expected: 0 TS chyb.
- [ ] **Step 6: Ruční ověření na dev** (port 3001): klikni do hledacího pole a napiš dotaz (fokus zůstane v inputu); klikni na nalezený blok na časové ose; okamžitě stiskni Ctrl+X — blok se má vyjmout (toast „Blok vyříznut…") BEZ nutnosti kliknout jinam předtím. Zopakuj s tažením za spodní hranu bloku (resize) místo kliku.
- [ ] **Step 7: Commit:**
```bash
git add src/lib/focusGuard.ts src/lib/focusGuard.test.ts src/app/_components/TimelineGrid.tsx
git commit -m "$(cat <<'EOF'
fix(planner): blur hledaciho pole pri mousedownu na blok — fokusova past

Skutecny koren "zkratky nefunguji" (audit 19. 8. 2026): preventDefault()
na mousedown potlaci i vychozi presun fokusu prohlizece, takze klik na
blok po hledani nevytahne kurzor z inputu a klavesovy guard v
PlannerPage pak zahodi vsechny zkratky beze zpetne vazby. Novy cisty
helper blurEditableFocus (testovatelny bez jsdom) blurne aktivni
INPUT/TEXTAREA/SELECT pri mousedownu na blok i pri resize.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Menu položky „✂ Vyjmout" a „🗑 Odstranit"

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` (nové props + JSX menu položek)
- Modify: `src/app/_components/TimelineGrid.tsx` (protažení props + JSX wiring)
- Modify: `src/app/_components/PlannerPage.tsx` (`cutSingleBlock` extrakce, sjednocení delete stavu, wiring)

**Interfaces:**
- Produces: `onBlockCut?: () => void` a `onBlockDelete?: () => void` na `BlockCard` (vzor `onBlockCopy`); `onBlockCut?: (block: Block) => void` a `onBlockDelete?: (block: Block) => void` na `TimelineGrid`; `cutSingleBlock(block: Block): void` v `PlannerPage.tsx`; `pendingDeleteBlock: Block | null` (odvozená hodnota z `keyDeletePending`/`selectedBlock` a nového `menuDeleteBlock`).
- Consumes: existující `handleDeleteBlock`, `deleteSingleBlockWithUndo`, `computePasteTargetFromBlock`, `showToast`.

**Guardy (audit §2, doslovně):** obě nové položky jsou uvnitř `canEdit && !block.locked` (stejná sekce, kde dnes žije „⎘ Kopírovat"/„✂ Rozdělit blok" — `showMenu` už tuhle podmínku garantuje na úrovni celého menu, ř. 684). „✂ Vyjmout" navíc zobrazí disabled variantu, když `block.printCompletedAt` (parita s Ctrl+X guardem v `PlannerPage.tsx:2854`, který vytištěný/zamčený blok odmítá stejnou hláškou). „🗑 Odstranit" žádný další guard nemá — zamčené/vytištěné bloky jde smazat i dnes přes klávesu Delete (server vrátí `requiresForce`, `forceDeleteConfirm` dialog to řeší); menu položka je ale schválně jen pro odemčené bloky (`!block.locked`), locked delete zůstává jen na klávesnici — je to vědomé zúžení rozsahu menu, ne regrese (force-flow existuje dál, jen bez nové vstupní cesty přes menu).

**Sjednocení delete dialogu (klíčové rozhodnutí):** Dnešní `ConfirmDialog` pro smazání klávesnicí (`PlannerPage.tsx:2889-2920`) čte blok výhradně ze `selectedBlock` — pokud menu položka nastaví jiný blok (ten, na který uživatel klikl pravým tlačítkem, který nemusí být `selectedBlock`), dialog by ukázal špatná data nebo se vůbec neotevřel. Řešení: nový stav `menuDeleteBlock: Block | null` + odvozená hodnota `pendingDeleteBlock = keyDeletePending ? selectedBlock : menuDeleteBlock`, kterou dialog čte MÍSTO `selectedBlock`. Pro klávesnicový spouštěč (`keyDeletePending`) se chování nemění ani o bit — `pendingDeleteBlock` je v tom případě přesně `selectedBlock`, stejně jako dnes. Žádná duplikace JSX — jediný `ConfirmDialog` obsluhuje oba spouštěče.

- [ ] **Step 1: `BlockCard.tsx` — nové props.** V destrukturaci (dnes ř. 254):
```typescript
  onBlockCopy, onBlockCut, onBlockDelete, onBlockSplit, getSplitAt, isTiskar, onPrintComplete, onNotify, onBlockVariantChange,
```
V typovém bloku (dnes ř. 311, hned za `onBlockCopy?: () => void;`):
```typescript
  onBlockCopy?: () => void;
  onBlockCut?: () => void;
  onBlockDelete?: () => void;
```

- [ ] **Step 2: `BlockCard.tsx` — položka „✂ Vyjmout".** Dnešní blok (ř. 1696-1711):
```tsx
        {canEdit && !block.locked && (
          <>
            <ContextMenuItem
              onClick={() => onBlockCopy?.()}
              style={menuItemStyle}
            >
              ⎘ Kopírovat
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => { if (splitAtRef.current) onBlockSplit?.(splitAtRef.current); }}
              style={menuItemStyle}
            >
              ✂ Rozdělit blok
            </ContextMenuItem>
          </>
        )}
```
nahraď za (nová položka mezi Kopírovat a Rozdělit blok — pořadí odpovídá etapovému plánu „za Kopírovat"):
```tsx
        {canEdit && !block.locked && (
          <>
            <ContextMenuItem
              onClick={() => onBlockCopy?.()}
              style={menuItemStyle}
            >
              ⎘ Kopírovat
            </ContextMenuItem>
            {block.printCompletedAt ? (
              <ContextMenuItem disabled style={{ ...menuItemStyle, color: "rgba(255,255,255,0.3)" }}>
                ✂ Vyjmout (vytištěno)
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                onClick={() => onBlockCut?.()}
                style={menuItemStyle}
              >
                ✂ Vyjmout
              </ContextMenuItem>
            )}
            <ContextMenuItem
              onClick={() => { if (splitAtRef.current) onBlockSplit?.(splitAtRef.current); }}
              style={menuItemStyle}
            >
              ✂ Rozdělit blok
            </ContextMenuItem>
          </>
        )}
```
(Disabled styl `rgba(255,255,255,0.3)` kopíruje existující vzor „🚚 Nejdřív vyplň termín expedice", ř. 1775.)

- [ ] **Step 3: `BlockCard.tsx` — položka „🗑 Odstranit" na konec menu.** Za dnešní expedice sekci (končí ř. 1794, těsně před `</ContextMenuContent>` na ř. 1795) přidej:
```tsx
        {canEdit && !block.locked && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onClick={() => onBlockDelete?.()}
              style={{ ...menuItemStyle, color: "rgba(239,68,68,0.9)" }}
            >
              🗑 Odstranit
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
```
(Barva `rgba(239,68,68,0.9)` kopíruje existující destruktivní vzor „🚚 Odebrat z Expedice", ř. 1781 — položka je oddělená vlastním separátorem, poslední v menu.)

- [ ] **Step 4: `TimelineGrid.tsx` — protažení props.** V typovém bloku (dnes ř. 268, hned za `onBlockCopy?: (block: Block) => void;`):
```typescript
  onBlockCopy?: (block: Block) => void;
  onBlockCut?: (block: Block) => void;
  onBlockDelete?: (block: Block) => void;
```
V destrukturaci (dnes ř. 586, hned za `onBlockCopy,`):
```typescript
  onBlockCopy,
  onBlockCut,
  onBlockDelete,
```
V JSX wiring na `<BlockCard>` (dnes ř. 2252, hned za `onBlockCopy={() => onBlockCopy?.(block)}`):
```typescript
                      onBlockCopy={() => onBlockCopy?.(block)}
                      onBlockCut={() => onBlockCut?.(block)}
                      onBlockDelete={() => onBlockDelete?.(block)}
```

- [ ] **Step 5: `PlannerPage.tsx` — extrahovat `cutSingleBlock`.** Vlož novou funkci hned před klávesový `useEffect` (dnes mezi koncem `handlePasteHere` na ř. 2763 a `useEffect` na ř. 2765):
```typescript
  // Sdílené tělo Ctrl+X jednoblokové větve — volá ho klávesový handler NÍŽE
  // i položka menu "✂ Vyjmout" (BlockCard → TimelineGrid → sem). Cut = přesun
  // existujícího bloku (PUT) — zamčený/vytištěný blok se přesunout nesmí,
  // stejně jako u dragu. Guard tady, ať UI selže srozumitelně dřív než server.
  function cutSingleBlock(block: Block) {
    if (block.locked || block.printCompletedAt) {
      showToast(block.locked ? "Zamčený blok nelze vyjmout." : "Vytištěný blok nelze vyjmout.", "info");
      return;
    }
    setCopiedBlock(block);
    setIsCut(true);
    clipboardGroupRef.current = [];
    isGroupCutRef.current = false;
    setPasteTarget(computePasteTargetFromBlock(block));
    showToast("Blok vyříznut. Ctrl+V ho přesune těsně za originál.", "info");
  }
```
V klávesovém handleru nahraď dnešní tělo jednoblokové Ctrl+X větve (ř. 2849-2865):
```typescript
      if (isShortcut(e, "x") && selectedBlockRef.current) {
        e.preventDefault();
        const sel = selectedBlockRef.current;
        // Cut = přesun existujícího bloku (PUT) — zamčený/vytištěný blok se přesunout nesmí,
        // stejně jako u dragu. Guard tady, ať UI selže srozumitelně dřív než server.
        if (sel.locked || sel.printCompletedAt) {
          showToast(sel.locked ? "Zamčený blok nelze vyjmout." : "Vytištěný blok nelze vyjmout.", "info");
          return;
        }
        setCopiedBlock(sel);
        setIsCut(true);
        clipboardGroupRef.current = [];
        isGroupCutRef.current = false;
        setPasteTarget(computePasteTargetFromBlock(sel));
        showToast("Blok vyříznut. Ctrl+V ho přesune těsně za originál.", "info");
        return;
      }
```
za:
```typescript
      if (isShortcut(e, "x") && selectedBlockRef.current) {
        e.preventDefault();
        cutSingleBlock(selectedBlockRef.current);
        return;
      }
```

- [ ] **Step 6: `PlannerPage.tsx` — nový stav `menuDeleteBlock` + odvozený `pendingDeleteBlock`.** Vedle `keyDeletePending` (dnes ř. 180):
```typescript
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [keyDeletePending, setKeyDeletePending] = useState(false);
  // Blok vybraný přes menu "🗑 Odstranit" — na rozdíl od keyDeletePending
  // NENÍ vázaný na selectedBlock (uživatel může pravým tlačítkem kliknout na
  // jiný blok, než má aktuálně otevřený v detailu). Obě cesty sytí jediný
  // ConfirmDialog níž přes `pendingDeleteBlock`.
  const [menuDeleteBlock, setMenuDeleteBlock] = useState<Block | null>(null);
  const [deleteRejectionReason, setDeleteRejectionReason] = useState("");
```
Těsně před `return (` hlavního JSX (dnes ř. 2881, hned za koncem klávesového `useEffect`) přidej odvozenou hodnotu:
```typescript
  // Jediný zdroj pravdy pro delete-confirm dialog níž — klávesnicová cesta
  // (Delete/Backspace na selectedBlock) i menu cesta (🗑 Odstranit na
  // libovolném bloku) sytí týž stav, aniž by se JSX dialogu duplikovalo.
  const pendingDeleteBlock = keyDeletePending ? selectedBlock : menuDeleteBlock;
```

- [ ] **Step 7: `PlannerPage.tsx` — přepnout `ConfirmDialog` na `pendingDeleteBlock`.** Dnešní blok (ř. 2889-2920) nahraď (jen `selectedBlock` → `pendingDeleteBlock`, `open` zjednodušené — `keyDeletePending && !!selectedBlock` se sloučilo do samotné definice `pendingDeleteBlock`, a `onConfirm`/`onCancel` teď musí zavřít OBĚ cesty):
```tsx
      {/* ── Confirm smazání (klávesnice i menu "🗑 Odstranit") ── */}
      <ConfirmDialog
        open={!!pendingDeleteBlock}
        title="Smazat blok?"
        message={pendingDeleteBlock ? `${pendingDeleteBlock.orderNumber}${pendingDeleteBlock.description ? ` — ${pendingDeleteBlock.description}` : ""}` : ""}
        confirmLabel="Smazat"
        danger
        width={pendingDeleteBlock?.reservationId ? 340 : 300}
        autoFocusConfirm={!pendingDeleteBlock?.reservationId}
        onConfirm={() => {
          if (!pendingDeleteBlock) return;
          setKeyDeletePending(false);
          setMenuDeleteBlock(null);
          handleDeleteBlock(pendingDeleteBlock.id, deleteRejectionReason || undefined);
          setDeleteRejectionReason("");
        }}
        onCancel={() => { setKeyDeletePending(false); setMenuDeleteBlock(null); setDeleteRejectionReason(""); }}
      >
        {pendingDeleteBlock?.reservationId && (
          <div style={{ background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#c084fc", marginBottom: 8 }}>Propojená rezervace bude zamítnuta</p>
            <input
              type="text"
              placeholder="Důvod zamítnutí (nepovinné)"
              value={deleteRejectionReason}
              onChange={(e) => setDeleteRejectionReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pendingDeleteBlock) {
                  setKeyDeletePending(false);
                  setMenuDeleteBlock(null);
                  handleDeleteBlock(pendingDeleteBlock.id, deleteRejectionReason || undefined);
                  setDeleteRejectionReason("");
                }
              }}
              autoFocus
              style={{ width: "100%", padding: "8px 12px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.08)", color: "var(--text)", outline: "none" }}
            />
          </div>
        )}
      </ConfirmDialog>
```
(`forceDeleteConfirm`/`multiForceDelete`/`multiDeletePending` dialogy níž — ř. 2921-2962 v dnešním souboru — beze změny, force-flow je nezávislý na téhle unifikaci.)

- [ ] **Step 8: `PlannerPage.tsx` — wiring na `TimelineGrid`.** Vedle `onBlockCopy` (dnes ř. 3353-3360):
```tsx
            onBlockCopy={(block) => {
              setCopiedBlock(block);
              setIsCut(false);
              clipboardGroupRef.current = [];
              isGroupCutRef.current = false;
              setPasteTarget(computePasteTargetFromBlock(block));
              showToast("Blok zkopírován. Ctrl+V vloží za originál, nebo klikni jinam.", "info");
            }}
            onBlockCut={(block) => cutSingleBlock(block)}
            onBlockDelete={(block) => setMenuDeleteBlock(block)}
```

- [ ] **Step 9: Ověření:**
Run: `npm run build`
Expected: 0 TS chyb (nové props jsou všude volitelné — `?.()`/`?:` — žádné volající místo nesmí spadnout na chybějící prop).

- [ ] **Step 10: Ruční ověření na dev** (port 3001, role PLANOVAT/ADMIN):
  1. Pravý klik na odemčený, nevytištěný blok → menu obsahuje „✂ Vyjmout" mezi „⎘ Kopírovat" a „✂ Rozdělit blok"; klik na něj → toast „Blok vyříznut…" (stejný jako po Ctrl+X); Ctrl+V ho vloží za originál.
  2. Pravý klik na blok s potvrzeným tiskem → „✂ Vyjmout (vytištěno)" je viditelně disabled (šedý text, neklikací).
  3. Pravý klik na zamčený blok → menu položky Vyjmout/Odstranit se vůbec nezobrazí (celá sekce je uvnitř `!block.locked`).
  4. **Klíčový regresní test sjednocení dialogu:** klikni na blok A (otevře se detail, `selectedBlock = A`), pak KLIKNI JINAM (zruší výběr, `selectedBlock = null`), pak pravým tlačítkem na JINÝ blok B a zvol „🗑 Odstranit" → dialog musí ukázat číslo zakázky bloku **B**, ne A ani prázdné pole. Potvrď → blok B zmizí z plánu; Ctrl+Z ho vrátí (undo přes `deleteSingleBlockWithUndo`, beze změny).
  5. Zopakuj bod 4 na bloku s propojenou rezervací → musí se objevit fialový box „Propojená rezervace bude zamítnuta" s polem na důvod, přesně jako u klávesnicového Delete.
  6. Klávesnicová cesta beze změny: vyber blok, stiskni Delete → stejný dialog jako dřív, potvrď/zruš funguje.

- [ ] **Step 11: Commit:**
```bash
git add src/components/planner/BlockCard.tsx src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "$(cat <<'EOF'
feat(planner): polozky Vyjmout a Odstranit v kontextovem menu bloku

Obe akce uz existovaly jen na klavesnici (Ctrl+X, Delete) — bod 2
audit druhe vlny 19. 8. 2026. Cut telo extrahovano do cutSingleBlock,
sdilene klavesovym handlerem i novou polozkou menu. Delete-confirm
dialog sjednocen na pendingDeleteBlock (keyDeletePending ? selectedBlock
: menuDeleteBlock), aby fungoval z obou spoustecu bez duplikace JSX —
menu muze mirit na jiny blok, nez je prave otevreny v detailu.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Celá suite, build, dokumenty

- [ ] **Step 1:** Celá test suite (glob nejde do podsložek — každá složka zvlášť, viz CLAUDE.md):
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: vše zelené — baseline byl 1361, po Tasku 1 (+1) a Tasku 2 (+5) očekávaný stav **1367 testů, 0 fail**.
- [ ] **Step 2:** `npm run build` → 0 chyb; `npm run lint` → 0 chyb.
- [ ] **Step 3:** Dokumenty: v `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` označ etapu 7 jako hotovou; řádek do `docs/vyvoj-historie.md` (QWERTZ fix + fokusová past + menu Vyjmout/Odstranit).
- [ ] **Step 4:** Commit — `docs(shortcuts): etapa 7 hotova` a ohlásit Vojtovi (tempo: zastavit, čekat na OK — nasazení na test/produkci řeší samostatný deploy krok, viz etapa 0 v rámcovém plánu).
```bash
git add docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md docs/vyvoj-historie.md
git commit -m "$(cat <<'EOF'
docs(shortcuts): etapa 7 hotova — QWERTZ, fokusova past, menu Vyjmout/Odstranit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Reference — proč TŘI nezávislé tasky v jedné etapě

Audit (§2, e-mailový dodatek): Lukášovi se zdálo, že „zkratky často nefungují" — skutečnost jsou DVĚ nesouvisející příčiny (fokusová past + QWERTZ regrese) plus chybějící myší alternativa (menu). Žádná z oprav není závislá na druhé — pořadí Task 1 → 2 → 3 je jen podle velikosti zásahu (nejmenší/nejizolovanější první), ne kvůli závislosti. Kdyby čas dovolil jen část etapy, jde zastavit po kterémkoli tasku a zbytek dodělat později beze změny zbylého plánu.
