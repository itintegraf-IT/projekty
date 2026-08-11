# Monitor — chipy a specifikace ve frontě zakázek: implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Řádek fronty na Monitoru u stroje ukáže amber pás se specifikací a plnou sadu výrobních a stavových chipů — totéž, co dnes vidí tiskař jen na velké kartě vlevo.

**Architecture:** Rozhodnutí „jaké chipy zakázka má" se vytáhne z JSX do čisté funkce `buildMonitorChips` v `src/lib/monitorChips.ts` (stejný vzor jako `monitorView.ts` — logika v `lib`, render v komponentě) a pokryje testy. Nad ní stojí jediná renderovací komponenta `MonitorChips` používaná velkou kartou i frontou, takže se obě strany obrazovky nemohou rozejít. Fronta si pak přidá amber pás ze sdíleného literálu `SPEC_HIGHLIGHT`.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · node:test + tsx.

## Global Constraints

- Barvy a rozměry **vždy** přes CSS tokeny z `src/app/globals.css`, nikdy hex/rgba literál v komponentě. **Jediná výjimka: `SPEC_HIGHLIGHT`** (`src/lib/blockStyles.ts`, `bg #fbbf24` / `text #221703`) — amber pás si nese vlastní pozadí a musí vypadat stejně ve světlém i tmavém motivu, proto je záměrně literál. Beze změny.
- Mouse handlery začínají `if (e.button !== 0) return;` (jen levé tlačítko).
- Nové standalone komponenty jako **named export**, ne default.
- Žádný zásah do dat: `src/lib/monitorView.ts`, API routes, Prisma schéma ani migrace se v tomhle plánu nemění.
- Sada a pořadí chipů jsou dané specem §3.3 a jsou **shodné** pro velkou kartu i frontu. `size` mění jen rozměry, nikdy obsah.
- Připravenost materiálu je `materialInStock || materialIssued || materialOk` (nález I5) — tohle pravidlo se nesmí při přepisu ztratit.
- Celá test suite se spouští takto (glob nejde do podsložek, každá složka zvlášť):
  ```bash
  node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```

## Odchylka od specu — vědomá, ke schválení

Spec §5.1 popisuje `MonitorChips` jako komponentu, která si sadu chipů spočítá sama uvnitř
JSX (tak, jak to dnes dělá `HeroChips`), a §6 říká, že etapa žádný test nepřidává.

Plán z toho **vyděluje čistou funkci `buildMonitorChips`** (Task 1) a pokrývá ji testy.
Důvod: pravidlo připravenosti materiálu se už jednou rozešlo (nález I5 — Monitor hlásil
„čeká" na to, co bylo v plánu zelené) a spec sám staví sdílení chipů právě na tom, že
tahle pravidla jsou netriviální. Uzavřená v JSX nejsou testovatelná; jako funkce v `lib`
jsou, za cenu jednoho souboru navíc a nulové změny chování.

Zbytek plánu spec dodržuje doslova.

---

## Struktura souborů

| Soubor | Odpovědnost | Akce |
| --- | --- | --- |
| `src/lib/monitorChips.ts` | Čisté rozhodnutí, jaké chipy zakázka má a v jakém tónu | **nový** |
| `src/lib/monitorChips.test.ts` | Testy téhož | **nový** |
| `src/components/monitor/MonitorChips.tsx` | Render chipů ve dvou velikostech | **nový** |
| `src/components/monitor/MonitorView.tsx` | Velká karta — místo vlastní `HeroChips` volá `MonitorChips` | úprava |
| `src/components/monitor/MonitorQueue.tsx` | Řádek fronty — číslo/popis/čas + amber pás + chipy | úprava |

---

## Task 1: Čistá funkce `buildMonitorChips`

Vytáhne rozhodovací logiku dnešní `HeroChips` (`MonitorView.tsx:470–495`) do `lib` beze
změny chování a pokryje ji testy. Komponenty se v tomhle tasku nedotýkáme — velká karta
pořád běží na své vlastní `HeroChips`, takže na obrazovce se nic nemění.

**Files:**
- Create: `src/lib/monitorChips.ts`
- Test: `src/lib/monitorChips.test.ts`

**Interfaces:**
- Consumes: `Block` z `src/app/_components/TimelineGrid.tsx`, `VARIANT_CONFIG` z `src/lib/blockVariants.ts`
- Produces:
  ```ts
  export type MonitorChipTone = "brand" | "ok" | "wait" | "plain" | "danger";
  export type MonitorChip = { label: string; tone: MonitorChipTone };
  export function buildMonitorChips(block: Block): MonitorChip[];
  ```
  Task 2 na tenhle tvar spoléhá.

- [ ] **Step 1: Napsat padající test**

Vytvoř `src/lib/monitorChips.test.ts`. Pomocník `mk` je záměrně stejný vzor jako
v `src/lib/monitorView.test.ts` — přetypování přes `as Block` je tam nutné, protože
`Block` má desítky polí, která tenhle test nezajímají.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildMonitorChips } from "./monitorChips.js";
import type { Block } from "../app/_components/TimelineGrid.js";

function mk(over: Partial<Block> = {}): Block {
  return {
    id: 1,
    machine: "XL_106",
    orderNumber: "25-2418",
    type: "ZAKAZKA",
    startTime: "2026-08-10T06:00:00.000Z",
    endTime: "2026-08-10T09:00:00.000Z",
    printCompletedAt: null,
    blockVariant: "STANDARD",
    locked: false,
    dataStatusLabel: null,
    dataOk: false,
    materialStatusLabel: null,
    materialOk: false,
    materialInStock: false,
    materialIssued: false,
    pantoneRequired: false,
    pantoneRequiredDate: null,
    pantoneOk: false,
    specifikace: null,
    ...over,
  } as Block;
}

test("buildMonitorChips: prázdná zakázka nemá jediný chip", () => {
  assert.deepEqual(buildMonitorChips(mk()), []);
});

test("buildMonitorChips: pořadí je obálka → vnitřky → archy → série → data → materiál → pantone → varianta", () => {
  const chips = buildMonitorChips(mk({
    obalka: true,
    vnitrky: true,
    tiskoveArchy: "3 archy",
    serie: "2. série",
    dataStatusLabel: "Data OK",
    dataOk: true,
    materialStatusLabel: "Skladem",
    materialInStock: true,
    pantoneOk: true,
    blockVariant: "POZASTAVENO",
  }));
  assert.deepEqual(chips.map((c) => c.label), [
    "OBÁLKA", "VNITŘKY", "3 archy", "2. série", "Data OK", "Skladem", "PANTONE", "Pozastaveno",
  ]);
});

test("buildMonitorChips: materiál je připravený i když je jen vydaný (nález I5)", () => {
  const issued = buildMonitorChips(mk({ materialStatusLabel: "Vydáno", materialIssued: true }));
  assert.equal(issued[0].tone, "ok");

  const stock = buildMonitorChips(mk({ materialStatusLabel: "Skladem", materialInStock: true }));
  assert.equal(stock[0].tone, "ok");

  const confirmed = buildMonitorChips(mk({ materialStatusLabel: "Potvrzeno", materialOk: true }));
  assert.equal(confirmed[0].tone, "ok");
});

test("buildMonitorChips: materiál bez jediného příznaku připravenosti čeká", () => {
  const chips = buildMonitorChips(mk({ materialStatusLabel: "Archy objednány" }));
  assert.deepEqual(chips, [{ label: "Archy objednány", tone: "wait" }]);
});

test("buildMonitorChips: data bez potvrzení čekají", () => {
  const chips = buildMonitorChips(mk({ dataStatusLabel: "Data chybí", dataOk: false }));
  assert.deepEqual(chips, [{ label: "Data chybí", tone: "wait" }]);
});

test("buildMonitorChips: Pantone vzniká ze tří nezávislých cest", () => {
  assert.equal(buildMonitorChips(mk({ pantoneRequired: true }))[0].label, "PANTONE");
  assert.equal(buildMonitorChips(mk({ pantoneRequiredDate: "2026-08-12T00:00:00.000Z" }))[0].label, "PANTONE");
  assert.equal(buildMonitorChips(mk({ pantoneOk: true }))[0].tone, "ok");
  assert.equal(buildMonitorChips(mk({ pantoneRequired: true }))[0].tone, "wait");
});

test("buildMonitorChips: STANDARD varianta chip nedělá, POZASTAVENO je červené", () => {
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: "STANDARD" })), []);
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: "POZASTAVENO" })), [
    { label: "Pozastaveno", tone: "danger" },
  ]);
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: "BEZ_SACKU" })), [
    { label: "Bez sáčku", tone: "plain" },
  ]);
});

test("buildMonitorChips: chybějící blockVariant (undefined) chip nedělá", () => {
  assert.deepEqual(buildMonitorChips(mk({ blockVariant: undefined })), []);
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

```bash
node --test --import tsx src/lib/monitorChips.test.ts
```

Očekávání: FAIL — modul `./monitorChips.js` neexistuje (`ERR_MODULE_NOT_FOUND`).

- [ ] **Step 3: Napsat minimální implementaci**

Vytvoř `src/lib/monitorChips.ts`. Obsah je doslovný přepis dnešní `HeroChips`
(`MonitorView.tsx:470–495`) — nic se nepřidává ani neubírá.

```ts
import type { Block } from "@/app/_components/TimelineGrid";
import { VARIANT_CONFIG } from "@/lib/blockVariants";

export type MonitorChipTone = "brand" | "ok" | "wait" | "plain" | "danger";
export type MonitorChip = { label: string; tone: MonitorChipTone };

/**
 * Výrobní a stavové štítky zakázky na Monitoru — jediný zdroj pravdy pro velkou
 * kartu i frontu. Kdyby měla každá strana vlastní kopii, první oprava pravidel
 * (jako nález I5 níže) by se promítla jen na jedno místo a Monitor by o téže
 * zakázce tvrdil dvě různé věci na jedné obrazovce.
 *
 * Čistá funkce v `lib`, ne logika uvnitř JSX: pravidla jsou netriviální a už se
 * jednou rozešla, takže je chceme mít pod testy (stejný vzor jako `monitorView.ts`).
 */
export function buildMonitorChips(block: Block): MonitorChip[] {
  const chips: MonitorChip[] = [];

  if (block.obalka) chips.push({ label: "OBÁLKA", tone: "brand" });
  if (block.vnitrky) chips.push({ label: "VNITŘKY", tone: "brand" });
  if (block.tiskoveArchy) chips.push({ label: block.tiskoveArchy, tone: "plain" });
  if (block.serie) chips.push({ label: block.serie, tone: "plain" });

  if (block.dataStatusLabel) {
    chips.push({ label: block.dataStatusLabel, tone: block.dataOk ? "ok" : "wait" });
  }

  // Připravenost materiálu = na skladě NEBO vydáno NEBO potvrzeno — stejná logika
  // jako BlockCard (jinak Monitor hlásí „čeká" na to, co je v plánu zelené, nález I5).
  if (block.materialStatusLabel) {
    const materialReady = block.materialInStock || block.materialIssued || block.materialOk;
    chips.push({ label: block.materialStatusLabel, tone: materialReady ? "ok" : "wait" });
  }

  // Štítek se zobrazí za stejné podmínky jako v BlockCard (požadováno, má termín,
  // nebo je už odklepnuto) — samotné `pantoneRequired` je jen jedna ze tří cest tam.
  if (block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk) {
    chips.push({ label: "PANTONE", tone: block.pantoneOk ? "ok" : "wait" });
  }

  // Nestandardní varianta zakázky (POZASTAVENO = výrobní stopka) — v plánu je sytě
  // červená, na Monitoru se dřív neukazovala vůbec (nález I5).
  if (block.blockVariant && block.blockVariant !== "STANDARD") {
    chips.push({
      label: VARIANT_CONFIG[block.blockVariant].label,
      tone: block.blockVariant === "POZASTAVENO" ? "danger" : "plain",
    });
  }

  return chips;
}
```

- [ ] **Step 4: Spustit test a ověřit, že prochází**

```bash
node --test --import tsx src/lib/monitorChips.test.ts
```

Očekávání: PASS, 8 testů.

- [ ] **Step 5: Ověřit typy a commitnout**

```bash
npx tsc --noEmit
git add src/lib/monitorChips.ts src/lib/monitorChips.test.ts
git commit -m "refactor(monitor): pravidla chipů do čisté funkce pod testy

Rozhodnutí, jaké štítky zakázka má, žilo uvnitř JSX velké karty a nešlo
otestovat. Pravidlo připravenosti materiálu se přitom už jednou rozešlo
(nález I5). Chování beze změny — komponenty na funkci zatím nesahají.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Komponenta `MonitorChips` a přepojení velké karty

Velká karta začne chipy kreslit sdílenou komponentou. **Na obrazovce se nesmí změnit
vůbec nic** — je to čistý refactor, jehož jediným smyslem je, aby na tutéž komponentu
mohla v Tasku 3 sáhnout i fronta.

**Files:**
- Create: `src/components/monitor/MonitorChips.tsx`
- Modify: `src/components/monitor/MonitorView.tsx` (odstranit `HeroChips`, ř. ~469–526; volání na ř. ~295; import `VARIANT_CONFIG` na ř. 14)

**Interfaces:**
- Consumes: `buildMonitorChips`, `MonitorChip`, `MonitorChipTone` z Tasku 1
- Produces:
  ```tsx
  export function MonitorChips({ block, size }: { block: Block; size: "hero" | "queue" }): React.JSX.Element | null;
  ```
  Task 3 volá `<MonitorChips block={b} size="queue" />`.

- [ ] **Step 1: Vytvořit komponentu**

Vytvoř `src/components/monitor/MonitorChips.tsx`. Hodnoty pro `size: "hero"` jsou
doslova ty dnešní z `HeroChips` (`fontSize: 12`, `padding: "5px 10px"`, `gap: 6`),
takže velká karta zůstane pixel za pixel stejná.

```tsx
"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { buildMonitorChips, type MonitorChipTone } from "@/lib/monitorChips";

/**
 * Výrobní a stavové štítky zakázky na Monitoru. Velká karta i řádek fronty kreslí
 * tutéž sadu ze stejné funkce — `size` mění POUZE rozměry, nikdy obsah ani pořadí.
 */
export function MonitorChips({ block, size }: { block: Block; size: "hero" | "queue" }) {
  const chips = buildMonitorChips(block);
  if (chips.length === 0) return null;

  const hero = size === "hero";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: hero ? 6 : 5 }}>
      {chips.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          style={{
            fontSize: hero ? 12 : 11,
            fontWeight: 600,
            letterSpacing: "0.02em",
            borderRadius: hero ? 6 : 5,
            padding: hero ? "5px 10px" : "3px 7px",
            whiteSpace: "nowrap",
            background: toneBackground(c.tone),
            color: toneColor(c.tone),
          }}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

function toneBackground(tone: MonitorChipTone): string {
  switch (tone) {
    case "ok":     return "color-mix(in oklab, var(--success) 22%, transparent)";
    case "wait":   return "color-mix(in oklab, var(--warning) 22%, transparent)";
    case "brand":  return "var(--brand)";
    case "danger": return "var(--danger)";
    default:       return "var(--surface-3)";
  }
}

function toneColor(tone: MonitorChipTone): string {
  switch (tone) {
    case "ok":     return "var(--success)";
    case "wait":   return "var(--warning)";
    case "brand":  return "var(--brand-contrast)";
    // Bílá je tu záměrný literál, ne token: --danger je sytá červená stejná v obou
    // motivech, takže --text by na ní ve světlém režimu zmizel.
    case "danger": return "white";
    default:       return "var(--text)";
  }
}
```

- [ ] **Step 2: Přepojit velkou kartu**

V `src/components/monitor/MonitorView.tsx`:

1. Přidej import vedle ostatních importů komponent (pod `import { MonitorQueue } …`):
   ```tsx
   import { MonitorChips } from "@/components/monitor/MonitorChips";
   ```
2. Nahraď volání `<HeroChips block={card.block} />` za:
   ```tsx
   <MonitorChips block={card.block} size="hero" />
   ```
3. **Smaž celou funkci `HeroChips`** včetně jejího komentáře `/** Výrobní a stavové štítky velké karty. */`.
4. Smaž import `import { VARIANT_CONFIG } from "@/lib/blockVariants";` — po smazání
   `HeroChips` ho v souboru nic nepoužívá a lint by hlásil nepoužitý import.

- [ ] **Step 3: Ověřit, že nic jiného na `HeroChips` ani `VARIANT_CONFIG` nesahá**

```bash
grep -rn "HeroChips" src/
grep -n "VARIANT_CONFIG" src/components/monitor/MonitorView.tsx
```

Očekávání: obojí bez jediného výskytu.

- [ ] **Step 4: Build, lint a celá test suite**

```bash
npx tsc --noEmit
npm run lint
npm run build
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávání: `tsc` a `build` bez chyb, `lint` 0 chyb (warningy jsou OK), test suite zelená
(846 dosavadních + 8 nových z Tasku 1).

- [ ] **Step 5: Commit**

```bash
git add src/components/monitor/MonitorChips.tsx src/components/monitor/MonitorView.tsx
git commit -m "refactor(monitor): chipy velké karty do sdílené komponenty

MonitorChips kreslí tutéž sadu pro velkou kartu i (v dalším kroku) frontu;
prop size mění jen rozměry, nikdy obsah. Vzhled velké karty beze změny.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Řádek fronty — amber pás a chipy

Jádro etapy. Jednořádkové tlačítko se rozpadne na tři části podle specu §3.1.

**Files:**
- Modify: `src/components/monitor/MonitorQueue.tsx` (funkce `QueueSection`, ř. 35–95)

**Interfaces:**
- Consumes: `MonitorChips` z Tasku 2, `SPEC_HIGHLIGHT` z `src/lib/blockStyles.ts`
- Produces: nic — `MonitorQueue` si drží dnešní props `{ today, tomorrow, heroId, onSelect }`.

- [ ] **Step 1: Doplnit importy**

V `src/components/monitor/MonitorQueue.tsx` pod stávající importy:

```tsx
import { MonitorChips } from "@/components/monitor/MonitorChips";
import { SPEC_HIGHLIGHT } from "@/lib/blockStyles";
```

- [ ] **Step 2: Přepsat tělo `blocks.map(...)` v `QueueSection`**

Nahraď celý dnešní `<button>` (ř. 52–90) tímhle. Tlačítko zůstává tlačítkem — klik dál
vytáhne zakázku na velkou kartu (ruční výběr) — jen se mění na sloupec.

```tsx
        return (
          <button
            key={b.id}
            onClick={(e) => { if (e.button !== 0) return; onSelect(b); }}
            style={{
              display: "flex", flexDirection: "column", alignItems: "stretch", gap: 7,
              padding: "10px 12px",
              borderRadius: 10,
              textAlign: "left",
              font: "inherit",
              cursor: "pointer",
              background: isHero ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--surface)",
              border: `1px solid ${isHero ? "var(--success)" : "var(--border)"}`,
              color: "var(--text)",
              // Ztlumení se vztahuje i na amber pás. Hotová zakázka nemá u stroje
              // křičet — jinak by přebila tu, která se právě tiskne.
              opacity: isDone ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{
                fontFamily: "ui-monospace, monospace",
                fontWeight: 700, fontVariantNumeric: "tabular-nums",
                fontSize: 14, flexShrink: 0,
                color: isDone ? "var(--success)" : "var(--text)",
              }}>
                {isDone ? "✓ " : ""}{b.orderNumber}
              </span>
              <span style={{
                flex: 1, minWidth: 0,
                color: "var(--text-muted)", fontSize: 13,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {b.description ?? ""}
              </span>
              <span style={{
                flexShrink: 0,
                color: "var(--text-muted)", fontSize: 13,
                fontVariantNumeric: "tabular-nums",
              }}>
                {formatPragueTime(new Date(b.startTime))}
              </span>
            </span>

            {b.specifikace && (
              // Amber pás jako na kartě bloku v plánu i na velké kartě Monitoru.
              // Barvy jsou záměrně stejné literály (SPEC_HIGHLIGHT), aby stejná
              // informace vypadala všude stejně; pás si nese vlastní pozadí, takže
              // funguje ve světlém i tmavém motivu.
              <span
                title={b.specifikace}
                style={{
                  background: SPEC_HIGHLIGHT.bg,
                  color: SPEC_HIGHLIGHT.text,
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 13, fontWeight: 700, lineHeight: 1.3,
                  letterSpacing: "0.01em",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {b.specifikace}
              </span>
            )}

            <MonitorChips block={b} size="queue" />
          </button>
        );
```

- [ ] **Step 3: Upravit doc komentář komponenty**

Nahraď dnešní komentář nad `export function MonitorQueue` (ř. 13–17):

```tsx
/**
 * Pravý sloupec Monitoru — zakázky na stroji pro dnešek a zítřek.
 * Každý řádek nese totéž, co velká karta: číslo, popis, čas, amber pás se
 * specifikací a výrobní i stavové chipy. Odklepnuté jsou ztlumené se zeleným
 * háčkem (včetně pásu), zakázka na velké kartě zvýrazněná.
 * Kliknutí ji vytáhne na velkou kartu (tiskař tím přebíjí pořadí od plánovače).
 */
```

- [ ] **Step 4: Build, lint a celá test suite**

```bash
npx tsc --noEmit
npm run lint
npm run build
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávání: bez chyb, test suite zelená.

- [ ] **Step 5: Commit**

```bash
git add src/components/monitor/MonitorQueue.tsx
git commit -m "feat(monitor): fronta ukazuje specifikaci a chipy

Řádek fronty byl jednořádkový a neukazoval nic, podle čeho se tiskař u stroje
rozhoduje — ani specifikaci (kvůli které dostala karta bloku amber pás), ani
stav dat a materiálu. Nově nese totéž co velká karta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Ruční ověření na seedu

Poslední task nic nemění v kódu — je to průchod aplikací podle specu §6.3. Nasazovat bez
něj nemá cenu: testy pokrývají pravidla chipů, ne to, jak řádek vypadá.

**Files:** žádné změny v kódu (kromě případných oprav, které průchod najde).

- [ ] **Step 1: Nasypat testovací data**

```bash
npx tsx prisma/seed-monitor.ts
```

Pozn.: dev-only skript, `--clean` po sobě uklidí. Nikdy nespouštět proti produkci.

- [ ] **Step 2: Spustit dev server a přihlásit se jako `TISKAR`**

```bash
npm run dev
```

Dev server projektu jede na portu **3001** (3000 může držet jiný projekt).
Monitor je domovská obrazovka role `TISKAR` na `/`.

- [ ] **Step 3: Projít kontrolní seznam**

- [ ] řádek fronty ukazuje amber pás se specifikací i chipy
- [ ] `MON-2409` (nebo jiná zakázka bez `specifikace`) nemá žlutý pás **ani prázdné místo po něm**
- [ ] zakázka bez jediného chipu nemá prázdný řádek chipů
- [ ] `MON-2407` má červený chip `Pozastaveno`
- [ ] `MON-2403` má oba stavové chipy v žlutém `wait` tónu (data chybí, archy objednány)
- [ ] `MON-2404` má `OBÁLKA` + `3 archy` + `2. série`
- [ ] `MON-2401` (odklepnutá) je ztlumená **včetně pásu**, u čísla zelený `✓`
- [ ] zakázka na velké kartě má ve frontě zelený okraj
- [ ] klik na řádek ji vytáhne na velkou kartu a **nevyhodí do plánu**
- [ ] chipy na velké kartě vypadají **stejně jako před etapou** (Task 2 byl čistý refactor)
- [ ] dlouhá specifikace se ořízne po druhém řádku, plný text je v tooltipu
- [ ] světlý i tmavý motiv — pás musí být čitelný v obou
- [ ] přihlášení jako `PLANOVAT` — planner beze změny

- [ ] **Step 4: Uklidit testovací data**

```bash
npx tsx prisma/seed-monitor.ts --clean
```

- [ ] **Step 5: Zapsat etapu do historie a commitnout**

Přidej do `docs/vyvoj-historie.md` odstavec k 11. 8. 2026: co se přidalo (chipy
a specifikace ve frontě Monitoru), proč `MonitorChips` vznikla jako sdílená komponenta
nad čistou funkcí, a že `SpecBand` z plánu se záměrně nepoužil (má natvrdo rozměry karty
bloku — sdílenou pravdou je barva `SPEC_HIGHLIGHT`, ne rozměr).

```bash
git add docs/vyvoj-historie.md
git commit -m "docs(historie): chipy a specifikace ve frontě Monitoru

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Ne-cíle (ze specu §7)

- Rozbalování jen prvních N zakázek — až kdyby se fronta v provozu přeplňovala.
- Ubírání chipů — vědomě odloženo na zkušenost z provozu.
- Zásah do `SpecBand` v plánu nebo do karty bloku.
- Jakákoli změna dat, API nebo pravidel fronty (`monitorView.ts`).
