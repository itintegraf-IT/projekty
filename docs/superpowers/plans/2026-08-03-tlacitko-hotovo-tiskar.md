# Tlačítko Hotovo u stroje — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zvětšit a zkontrastnit tlačítko Hotovo v tiskařském režimu a zeleně zvýraznit blok, jehož tisk právě běží.

**Architecture:** Rozhodovací pravidla (velikost tlačítka, „běží teď") jdou do čisté funkce v `src/lib/`, kterou pokryjí unit testy. Vzhled tlačítka se sjednotí do jedné komponenty `PrintDoneButton`, která nahradí tři téměř shodné kopie v `BlockCard.tsx`. Barvy jdou výhradně přes CSS tokeny; pro text na plné zelené vzniká nový token `--success-contrast`.

**Tech Stack:** Next.js 16 · React · TypeScript · Tailwind CSS v4 (inline style pro dynamické hodnoty) · testy `node:test` + `tsx`.

**Specifikace:** `docs/superpowers/specs/2026-08-03-tlacitko-hotovo-tiskar-design.md`

## Global Constraints

- **Barvy vždy přes CSS tokeny** z `src/app/globals.css`, nikdy hex/rgba literál — jinak se rozbije světlý režim (CLAUDE.md).
- **Nové standalone komponenty** jako named export do `src/components/`, ne inline do velkých souborů (CLAUDE.md).
- **Mouse handlery na blocích** začínají `if (e.button !== 0) return;` (CLAUDE.md).
- Změny se smí projevit **pouze pro roli `TISKAR`** a typ bloku `ZAKAZKA`. Ostatní role a typy vidí přesně to co dnes.
- **Žádná změna serverové logiky** — `POST /api/blocks/[id]/complete` zůstává beze změny. Žádná migrace, žádný zásah do Prisma schématu.
- Build před commitem: `npm run build` musí projít.
- Celá test suite: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`

## Odchylky od specifikace (zjištěné při čtení kódu — potvrzené)

1. **TimelineGrid se nemění.** Spec §5 čekal úpravu, ale `BlockCard` už dostává prop `now: Date` (`BlockCard.tsx:303,327`; předáváno na `TimelineGrid.tsx:2072` jako `now ?? new Date()`). `isRunningNow` se spočítá uvnitř `BlockCard`.
2. **Ztlumení hotových bloků odpadá** — už existuje. Dokončený tisk má vlastní tlumený styl `BLOCK_PRINT_DONE` (`BlockCard.tsx:413–414`). Část 2 se tím zmenšuje na samotné zvýraznění běžícího bloku.
3. **Štítek „TEĎ" se nedělá.** Pravý horní roh karty je už obsazený štítkem po deadline (`BlockCard.tsx:603`) a badgem tiskařských poznámek — třetí prvek by kolidoval. Místo něj: zelený prstenec kolem karty + zesílený levý pruh v barvě `--success`.
4. **Tlačítko po odklepnutí nemění výšku** (spec §3.3 zmiňovala zmenšení na 22 px). Konstantní výška zabrání poskočení obsahu karty při přepnutí.

---

### Task 1: Prezentační pravidla karty tiskaře (čistá logika + testy)

**Files:**
- Create: `src/lib/tiskarBlockView.ts`
- Test: `src/lib/tiskarBlockView.test.ts`

**Interfaces:**
- Consumes: nic (čistá funkce bez závislostí).
- Produces:
  - `type PrintDoneSize = { variant: "bar"; height: 40 | 32 | 24; fontSize: number } | { variant: "square"; height: 26; fontSize: number }`
  - `printDoneSize(layoutHeight: number): PrintDoneSize | null`
  - `isBlockRunningNow(startTime: string | Date, endTime: string | Date, now: Date, isPrintDone: boolean): boolean`

- [ ] **Step 1: Napiš padající test**

Vytvoř `src/lib/tiskarBlockView.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { printDoneSize, isBlockRunningNow } from "./tiskarBlockView.js";

test("printDoneSize: vysoký blok (≥140 px) = pruh 40 px", () => {
  assert.deepEqual(printDoneSize(168), { variant: "bar", height: 40, fontSize: 16 });
  assert.deepEqual(printDoneSize(140), { variant: "bar", height: 40, fontSize: 16 });
});

test("printDoneSize: 96–139 px = pruh 32 px", () => {
  assert.deepEqual(printDoneSize(139), { variant: "bar", height: 32, fontSize: 14 });
  assert.deepEqual(printDoneSize(96),  { variant: "bar", height: 32, fontSize: 14 });
});

test("printDoneSize: 48–95 px = pruh 24 px (spodní hranice MODE_FULL)", () => {
  assert.deepEqual(printDoneSize(95), { variant: "bar", height: 24, fontSize: 11.5 });
  assert.deepEqual(printDoneSize(48), { variant: "bar", height: 24, fontSize: 11.5 });
});

test("printDoneSize: 14–47 px = čtverec 26 px", () => {
  assert.deepEqual(printDoneSize(47), { variant: "square", height: 26, fontSize: 15 });
  assert.deepEqual(printDoneSize(14), { variant: "square", height: 26, fontSize: 15 });
});

test("printDoneSize: pod 14 px se tlačítko nekreslí", () => {
  assert.equal(printDoneSize(13), null);
  assert.equal(printDoneSize(0), null);
});

test("isBlockRunningNow: čas uvnitř bloku = běží", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");
  assert.equal(isBlockRunningNow("2026-08-03T08:00:00.000Z", "2026-08-03T12:00:00.000Z", now, false), true);
});

test("isBlockRunningNow: přesný start = běží, přesný konec už ne", () => {
  const start = new Date("2026-08-03T08:00:00.000Z");
  const end   = new Date("2026-08-03T12:00:00.000Z");
  assert.equal(isBlockRunningNow(start, end, start, false), true);
  assert.equal(isBlockRunningNow(start, end, end, false), false);
});

test("isBlockRunningNow: před startem a po konci = neběží", () => {
  const s = "2026-08-03T08:00:00.000Z";
  const e = "2026-08-03T12:00:00.000Z";
  assert.equal(isBlockRunningNow(s, e, new Date("2026-08-03T07:59:00.000Z"), false), false);
  assert.equal(isBlockRunningNow(s, e, new Date("2026-08-03T12:01:00.000Z"), false), false);
});

test("isBlockRunningNow: odklepnutý blok neběží, i když je uvnitř svého času", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");
  assert.equal(isBlockRunningNow("2026-08-03T08:00:00.000Z", "2026-08-03T12:00:00.000Z", now, true), false);
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `node --test --import tsx src/lib/tiskarBlockView.test.ts`
Expected: FAIL — `Cannot find module './tiskarBlockView.js'`

- [ ] **Step 3: Napiš implementaci**

Vytvoř `src/lib/tiskarBlockView.ts`:

```ts
/**
 * Prezentační pravidla karty bloku v tiskařském režimu.
 *
 * Záměrně čistá logika bez Reactu, aby šla pokrýt unit testy — komponenta
 * PrintDoneButton i BlockCard na ní jen staví a samy nic nepočítají.
 */

/** Podoba tlačítka Hotovo podle výšky bloku. */
export type PrintDoneSize =
  | { variant: "bar";    height: 40 | 32 | 24; fontSize: number }
  | { variant: "square"; height: 26;           fontSize: number };

/**
 * Rozměr tlačítka Hotovo pro danou výšku bloku (`layoutHeight` z BlockCard).
 * Prahy navazují na layout režimy karty: od 48 px je MODE_FULL a vejde se pruh
 * přes celou šířku, 14–47 px jsou COMPACT/TINY/MICRO (čtverec s háčkem),
 * pod 14 px karta nevykresluje obsah vůbec → `null`.
 */
export function printDoneSize(layoutHeight: number): PrintDoneSize | null {
  if (layoutHeight >= 140) return { variant: "bar", height: 40, fontSize: 16 };
  if (layoutHeight >= 96)  return { variant: "bar", height: 32, fontSize: 14 };
  if (layoutHeight >= 48)  return { variant: "bar", height: 24, fontSize: 11.5 };
  if (layoutHeight >= 14)  return { variant: "square", height: 26, fontSize: 15 };
  return null;
}

/**
 * Běží tisk bloku právě teď? Rozhoduje o zeleném zvýraznění karty u tiskaře.
 * Konec je vyloučený (t < end), aby na hranici dvou navazujících bloků
 * svítil vždy jen jeden. Odklepnutý blok neběží, i když je uvnitř svého času.
 */
export function isBlockRunningNow(
  startTime: string | Date,
  endTime: string | Date,
  now: Date,
  isPrintDone: boolean
): boolean {
  if (isPrintDone) return false;
  const t = now.getTime();
  return t >= new Date(startTime).getTime() && t < new Date(endTime).getTime();
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `node --test --import tsx src/lib/tiskarBlockView.test.ts`
Expected: PASS — 8 testů zelených

- [ ] **Step 5: Ověř, že nic jiného nespadlo**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — původní počet testů + 8 nových

- [ ] **Step 6: Commit**

```bash
git add src/lib/tiskarBlockView.ts src/lib/tiskarBlockView.test.ts
git commit -m "feat(tiskar): prezentační pravidla karty — velikost tlačítka Hotovo a detekce běžícího bloku"
```

---

### Task 2: Komponenta PrintDoneButton + token + náhrada tří kopií

**Files:**
- Modify: `src/app/globals.css:165` (světlé téma) a `src/app/globals.css:222` (tmavé téma)
- Create: `src/components/planner/PrintDoneButton.tsx`
- Modify: `src/components/planner/BlockCard.tsx:399` (výpočet), `:804-810`, `:933-939`, `:1107-1126`

**Interfaces:**
- Consumes: `printDoneSize`, `PrintDoneSize` z `src/lib/tiskarBlockView` (Task 1); `formatPragueTime` z `src/lib/dateUtils`.
- Produces: `PrintDoneButton` — named export ze `src/components/planner/PrintDoneButton.tsx`, props `{ size: PrintDoneSize; isDone: boolean; completedAt: string | null; pending: boolean; onToggle: () => void }`.

- [ ] **Step 1: Přidej token `--success-contrast` do obou témat**

V `src/app/globals.css` hned za řádek `--success: oklch(0.62 0.18 152);` (světlé téma, ř. 165) vlož:

```css
  --success-contrast: oklch(0.18 0.04 152);
```

A hned za řádek `--success: oklch(0.72 0.18 152);` (tmavé téma, ř. 222) vlož tentýž řádek:

```css
  --success-contrast: oklch(0.18 0.04 152);
```

Hodnota je v obou tématech stejná — `--success` má v obou dost vysokou světlost (0.62 / 0.72), takže tmavý text funguje na obou. Stejný vzor jako existující `--brand-contrast`.

- [ ] **Step 2: Vytvoř komponentu**

Vytvoř `src/components/planner/PrintDoneButton.tsx`:

```tsx
"use client";

import type { PrintDoneSize } from "@/lib/tiskarBlockView";
import { formatPragueTime } from "@/lib/dateUtils";

type Props = {
  size: PrintDoneSize;
  isDone: boolean;
  /** ISO string z Block.printCompletedAt, nebo null. */
  completedAt: string | null;
  pending: boolean;
  onToggle: () => void;
};

/**
 * Tlačítko „Hotovo" na kartě bloku v tiskařském režimu.
 *
 * Jediný zdroj vzhledu pro všechna tři místa v BlockCard (FULL / COMPACT / TINY).
 * Rozměr přichází zvenčí z printDoneSize() — komponenta nezná layout režimy karty.
 * Barvy jdou výhradně přes tokeny, aby fungoval světlý i tmavý režim.
 */
export function PrintDoneButton({ size, isDone, completedAt, pending, onToggle }: Props) {
  const isBar = size.variant === "bar";

  const barLabel = isDone
    ? completedAt
      ? `✓ Hotovo ${formatPragueTime(new Date(completedAt))}`
      : "✓ Hotovo"
    : "✓ HOTOVO";

  return (
    <button
      onClick={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onToggle();
      }}
      disabled={pending}
      title={isDone ? "Vrátit hotovo" : "Označit jako hotovo"}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        gap: isBar ? 6 : 0,
        width: isBar ? "100%" : size.height,
        height: size.height,
        flexShrink: 0,
        border: "none", borderRadius: 5,
        cursor: pending ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        // Popisek po odklepnutí je delší ("✓ Hotovo 14:32") — strop 13 px,
        // aby se na užším sloupci nepřetekl.
        fontSize: isDone && isBar ? Math.min(size.fontSize, 13) : size.fontSize,
        fontWeight: isDone ? 620 : 750,
        letterSpacing: isDone ? 0 : "0.05em",
        background: isDone ? "var(--surface-3)" : "var(--success)",
        color: isDone ? "var(--text-muted)" : "var(--success-contrast)",
        opacity: pending ? 0.5 : 1,
        transition: "all 0.12s ease-out",
        whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      {pending ? "·" : isBar ? barLabel : isDone ? "↩" : "✓"}
    </button>
  );
}
```

- [ ] **Step 3: Doplň importy a výpočet velikosti v BlockCard**

V `src/components/planner/BlockCard.tsx` přidej k ostatním importům:

```tsx
import { PrintDoneButton } from "@/components/planner/PrintDoneButton";
import { printDoneSize } from "@/lib/tiskarBlockView";
```

Hned za řádek `const layoutHeight  = contentHeight ?? clampedHeight;` (ř. 399) vlož:

```tsx
  // Velikost tlačítka Hotovo (jen tiskařský režim) — pravidla v tiskarBlockView.ts
  const printDone = printDoneSize(layoutHeight);
  const togglePrintDone = () => {
    if (!onPrintComplete) return;
    setPrintPending(true);
    onPrintComplete(block.id, !isPrintDone).finally(() => setPrintPending(false));
  };
```

- [ ] **Step 4: Nahraď kopii v MODE_COMPACT**

V `src/components/planner/BlockCard.tsx` nahraď celý blok na řádcích 804–810 tímto:

```tsx
              {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && printDone?.variant === "square" && (
                <PrintDoneButton
                  size={printDone}
                  isDone={isPrintDone}
                  completedAt={block.printCompletedAt}
                  pending={printPending}
                  onToggle={togglePrintDone}
                />
              )}
```

- [ ] **Step 5: Nahraď kopii v MODE_TINY / MICRO_TEXT**

Nahraď celý blok na řádcích 933–939 přesně tímtéž kódem jako v kroku 4:

```tsx
              {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && printDone?.variant === "square" && (
                <PrintDoneButton
                  size={printDone}
                  isDone={isPrintDone}
                  completedAt={block.printCompletedAt}
                  pending={printPending}
                  onToggle={togglePrintDone}
                />
              )}
```

- [ ] **Step 6: Nahraď kopii v MODE_FULL**

Nahraď celý blok na řádcích 1107–1126 tímto. Pozor: mizí `justifyContent: "flex-end"` — pruh má zabrat celou šířku:

```tsx
      {/* Hotovo tlačítko pro TISKAR (FULL mode) — pruh přes celou šířku karty */}
      {isTiskar && onPrintComplete && block.type === "ZAKAZKA" && MODE_FULL && printDone?.variant === "bar" && (
        <div style={{ padding: "2px 7px 5px", flexShrink: 0 }}>
          <PrintDoneButton
            size={printDone}
            isDone={isPrintDone}
            completedAt={block.printCompletedAt}
            pending={printPending}
            onToggle={togglePrintDone}
          />
        </div>
      )}
```

- [ ] **Step 7: Ověř build a testy**

Run: `npm run build`
Expected: build projde, 0 TypeScript chyb

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — všechny testy zelené

- [ ] **Step 8: Ruční ověření v prohlížeči**

Spusť `npm run dev`, přihlas se účtem s rolí `TISKAR` a na `/` zkontroluj:

- blok ~3,5 h → zelený pruh přes celou šířku, výška 40 px, text `✓ HOTOVO`
- blok ~2 h → pruh 32 px
- blok ~1 h → pruh 24 px
- blok pod 48 px → zelený čtverec 26 × 26 px s háčkem
- **blok 48–95 px**: vyšší tlačítko ubírá místo obsahu — ověř, že se popis a štítky
  neuříznou dřív než dnes (srovnej se stejným blokem pod rolí `PLANOVAT`)
- kliknutí → tlačítko zneutrální na `✓ Hotovo HH:MM`, další kliknutí ho vrátí zpět
- přepnutí do světlého režimu → tlačítko čitelné v obou tématech
- přihlášení rolí `PLANOVAT` → planner vypadá přesně jako dřív

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/components/planner/PrintDoneButton.tsx src/components/planner/BlockCard.tsx
git commit -m "feat(tiskar): větší a kontrastnější tlačítko Hotovo, sjednocené do PrintDoneButton"
```

---

### Task 3: Zvýraznění právě běžícího bloku

**Files:**
- Modify: `src/components/planner/BlockCard.tsx:386` (výpočet), `:568-570` (boxShadow), `:591` (levý pruh)

**Interfaces:**
- Consumes: `isBlockRunningNow` z `src/lib/tiskarBlockView` (Task 1); prop `now: Date`, který `BlockCard` už dostává (`BlockCard.tsx:303,327`).
- Produces: nic pro další tasky — poslední task plánu.

> ⚠️ **Čísla řádků jsou před Taskem 2.** Task 2 vkládá do `BlockCard.tsx` několik
> řádků a mění tři bloky, takže se čísla posunou. Místa hledej podle obsahu:
> `const isPrintDone`, `boxShadow: block.locked`, a `Levý barevný pruh`.

- [ ] **Step 1: Doplň import a výpočet**

V `src/components/planner/BlockCard.tsx` rozšiř existující import z Tasku 2 na:

```tsx
import { printDoneSize, isBlockRunningNow } from "@/lib/tiskarBlockView";
```

Hned za řádek `const isPrintDone   = block.printCompletedAt != null;` (ř. 386) vlož:

```tsx
  // Zelené zvýraznění bloku, jehož tisk právě běží — jen u tiskaře, jen zakázky.
  // `now` tiká z TimelineGrid po 60 s, žádný vlastní časovač tu nevzniká.
  const isRunningNow = isTiskar === true
    && block.type === "ZAKAZKA"
    && isBlockRunningNow(block.startTime, block.endTime, now, isPrintDone);
```

- [ ] **Step 2: Přidej zelený prstenec kolem karty**

Nahraď `boxShadow` na řádcích 568–570 tímto (zamčený blok má přednost, pak běžící):

```tsx
        boxShadow: block.locked
          ? `${shadow}, 0 0 0 1px rgba(251,191,36,0.35)`
          : isRunningNow
          ? `${shadow}, 0 0 0 2px var(--success)`
          : shadow,
```

- [ ] **Step 3: Zesil levý pruh do zelené**

Nahraď řádek 591 (větev `else` u levého barevného pruhu) tímto:

```tsx
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: isRunningNow ? 5 : 3, background: isRunningNow ? "var(--success)" : s.accentBar, opacity: isOverdue ? 0.4 : 1, borderRadius: "7px 0 0 7px", flexShrink: 0 }} />
```

- [ ] **Step 4: Ověř build a testy**

Run: `npm run build`
Expected: build projde, 0 TypeScript chyb

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — všechny testy zelené

- [ ] **Step 5: Ruční ověření v prohlížeči**

Jako `TISKAR` na `/`:

- blok, jehož čas právě běží → zelený prstenec kolem karty a zesílený zelený levý pruh
- ostatní bloky → beze změny
- odklepnutý blok → prstenec zmizí (i když je pořád uvnitř svého času)
- zamčený běžící blok → zůstává jantarový (zámek má přednost)
- jako `PLANOVAT` → žádný blok nemá zelený prstenec

- [ ] **Step 6: Commit**

```bash
git add src/components/planner/BlockCard.tsx
git commit -m "feat(tiskar): zelené zvýraznění bloku, jehož tisk právě běží"
```

---

## Hotovo, když

- [ ] `npm run build` projde
- [ ] Celá test suite zelená (`node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`)
- [ ] Ruční průchod z Tasku 2 kroku 8 a Tasku 3 kroku 5 sedí
- [ ] V `BlockCard.tsx` nezůstal žádný literál `rgba(34,197,94,…)` ani `#22c55e` u tlačítka Hotovo
  (kontrola: `grep -n "22c55e\|34,197,94" src/components/planner/BlockCard.tsx` — zbylé výskyty
  mimo tlačítko Hotovo, např. `✓` na ř. 766, jsou mimo rozsah tohoto plánu a zůstávají)
