# Monitor — potvrzení odklepnutí — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Po odklepnutí nechat kartu na hotové zakázce s tlačítky Vrátit / Další, a u zakázky, která ještě nezačala, vyžádat potvrzení na dvě kliknutí.

**Architecture:** Dvě nová pravidla jdou do `src/lib/monitorView.ts` jako čisté funkce s testy. `PrintDoneButton` dostane volitelnou potvrzovací podobu. `MonitorView` přibude dvojice stavů (`stickyId`, `confirmingId`) a footer velké karty se rozvětví na tři podoby: normální tlačítko, potvrzení, a stav „odklepnuto".

**Tech Stack:** Next.js 16 · React · TypeScript · Tailwind CSS v4 (inline style) · testy `node:test` + `tsx`.

**Specifikace:** `docs/superpowers/specs/2026-08-10-monitor-potvrzeni-odklepnuti-design.md`

## Global Constraints

- **Barvy vždy přes CSS tokeny** z `src/app/globals.css`, nikdy hex/rgba literál v komponentě.
- Změny se smí projevit **jen pro roli `TISKAR`** na Monitoru. Karta bloku v plánu a všechny ostatní role musí vypadat a chovat se přesně jako dnes.
- **Mouse handlery** začínají `if (e.button !== 0) return;`.
- **Žádná změna serverové logiky** — `POST /api/blocks/[id]/complete` beze změny. Žádná migrace.
- **Datum výhradně přes pražské helpery** z `src/lib/dateUtils.ts`.
- V `src/lib/` se `Block` importuje jako `import type { Block } from "@/app/_components/TimelineGrid";`. **V testech** relativně s příponou `.js`.
- `npm run build` a `npx tsc --noEmit` musí projít; `npm run lint` bez chyb a bez nových warningů.
- Test suite: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` — před začátkem **810 zelených**.

---

### Task 1: Pravidla držení karty a popisku dne (čistá logika + testy)

**Files:**
- Modify: `src/lib/monitorView.ts`
- Modify: `src/lib/monitorView.test.ts`

**Interfaces:**
- Consumes: `utcToPragueDateStr`, `addDaysToCivilDate`, `formatPragueDateShort` z `src/lib/dateUtils`; typ `Block`.
- Produces:
  - `resolveStickyBlock(blocks: Block[], stickyId: number | null): Block | null`
  - `startDayLabel(startTime: string | Date, now: Date): string | null`

- [ ] **Step 1: Napiš padající testy**

Do `src/lib/monitorView.test.ts` přidej na konec (import na prvním řádku souboru rozšiř o obě nové funkce):

```ts
test("resolveStickyBlock: vrátí odklepnutý blok, který je pořád v datech", () => {
  const b = mk({ id: 5, printCompletedAt: "2026-08-10T13:20:00.000Z" });
  assert.equal(resolveStickyBlock([b], 5)?.id, 5);
});

test("resolveStickyBlock: bez id vrátí null", () => {
  const b = mk({ id: 5, printCompletedAt: "2026-08-10T13:20:00.000Z" });
  assert.equal(resolveStickyBlock([b], null), null);
});

test("resolveStickyBlock: blok, který z dat zmizel, drží kartu neplatně", () => {
  const other = mk({ id: 9, printCompletedAt: "2026-08-10T13:20:00.000Z" });
  assert.equal(resolveStickyBlock([other], 5), null);
});

test("resolveStickyBlock: zrušené odklepnutí kartu pustí", () => {
  const b = mk({ id: 5, printCompletedAt: null });
  assert.equal(resolveStickyBlock([b], 5), null);
});

test("startDayLabel: zakázka začínající dnes nemá popisek dne", () => {
  const now = new Date("2026-08-10T08:00:00.000Z");
  assert.equal(startDayLabel("2026-08-10T12:00:00.000Z", now), null);
});

test("startDayLabel: zítřejší zakázka má „zítra“", () => {
  const now = new Date("2026-08-10T08:00:00.000Z");
  assert.equal(startDayLabel("2026-08-11T04:00:00.000Z", now), "zítra");
});

test("startDayLabel: vzdálenější zakázka má krátké datum", () => {
  const now = new Date("2026-08-10T08:00:00.000Z");
  assert.equal(startDayLabel("2026-08-13T04:00:00.000Z", now), "13. 08.");
});

test("startDayLabel: rozhoduje civilní den, ne počet hodin", () => {
  // Ve 23:30 pražského času je zakázka na 0:30 „zítra“, i když je za hodinu.
  const now = new Date("2026-08-10T21:30:00.000Z");
  assert.equal(startDayLabel("2026-08-10T22:30:00.000Z", now), "zítra");
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: FAIL — `resolveStickyBlock is not a function` / `startDayLabel is not a function`

- [ ] **Step 3: Napiš implementaci**

V `src/lib/monitorView.ts` rozšiř import z `dateUtils`:

```ts
import { utcToPragueDateStr, addDaysToCivilDate, formatPragueDateShort } from "@/lib/dateUtils";
```

A na konec souboru přidej:

```ts
/**
 * Zakázka, kterou Monitor po odklepnutí drží na velké kartě, dokud tiskař
 * nezmáčkne „Další →" nebo „Vrátit".
 *
 * Vrátí ji jen tehdy, když v datech pořád je a pořád je odklepnutá. Tím se
 * jedním pravidlem řeší i to, že odklepnutí mezitím někdo zrušil z jiné
 * stanice (přijde přes SSE) nebo blok úplně zmizel — karta by pak tvrdila
 * „hotovo" o zakázce, která hotová není.
 */
export function resolveStickyBlock(blocks: Block[], stickyId: number | null): Block | null {
  if (stickyId == null) return null;
  const block = blocks.find((b) => b.id === stickyId);
  if (!block) return null;
  if (block.printCompletedAt == null) return null;
  return block;
}

/**
 * Popisek dne pro zakázku, která teprve začne: `null` pro dnešek, `"zítra"`
 * pro následující den, jinak krátké datum (`"13. 08."`).
 *
 * Porovnávají se civilní pražské dny, ne rozdíl v hodinách — zakázka na 0:30
 * je „zítra" i ve 23:30, kdy do ní zbývá hodina.
 */
export function startDayLabel(startTime: string | Date, now: Date): string | null {
  const start = new Date(startTime);
  const startStr = utcToPragueDateStr(start);
  const todayStr = utcToPragueDateStr(now);
  if (startStr === todayStr) return null;
  if (startStr === addDaysToCivilDate(todayStr, 1)) return "zítra";
  return formatPragueDateShort(start);
}
```

- [ ] **Step 4: Spusť testy a ověř, že prochází**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: PASS — 25 testů zelených (17 původních + 8 nových)

- [ ] **Step 5: Ověř celou suite a build**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 818 testů

Run: `npm run build`
Expected: build projde, 0 TypeScript chyb

- [ ] **Step 6: Commit**

```bash
git add src/lib/monitorView.ts src/lib/monitorView.test.ts
git commit -m "feat(monitor): pravidla držení karty po odklepnutí a popisku dne u budoucí zakázky"
```

---

### Task 2: Potvrzovací podoba tlačítka

**Files:**
- Modify: `src/components/planner/PrintDoneButton.tsx`

**Interfaces:**
- Consumes: nic z Tasku 1.
- Produces: `PrintDoneButton` přijme volitelnou prop `confirmLabel?: string`. Když je vyplněná (a tlačítko není `isDone` ani `pending`), vykreslí se **žlutě** s tímto popiskem místo „✓ HOTOVO". Task 3 ji použije pro potvrzení u budoucí zakázky.

- [ ] **Step 1: Přidej prop do typu**

V `src/components/planner/PrintDoneButton.tsx` rozšiř `type Props` o:

```tsx
  /**
   * Potvrzovací podoba — žluté pozadí a tenhle popisek místo „✓ HOTOVO".
   * Používá jen Monitor u zakázky, která ještě nezačala; karta bloku v plánu
   * tuhle prop nepředává, takže se pro plánovače nic nemění.
   */
  confirmLabel?: string;
```

A doplň ji do destrukturalizace parametrů:

```tsx
export function PrintDoneButton({ size, isDone, completedAt, pending, onToggle, confirmLabel }: Props) {
```

- [ ] **Step 2: Rozvětvi vzhled**

Hned za výpočet `isHoverActive` přidej:

```tsx
  // Potvrzovací stav má přednost před hoverem i běžnou zelenou, ale ne nad
  // `isDone`/`pending` — ty popisují, co se s tlačítkem právě děje.
  const isConfirm = !!confirmLabel && !isDone && !pending;
```

V `style` uprav tři vlastnosti (zbytek nech beze změny):

```tsx
        // Potvrzovací popisek je delší než „✓ HOTOVO" — na hero tlačítku by se
        // ve 30 px nevešel, proto strop 20 px.
        fontSize: isDone && size.variant === "bar" ? Math.min(size.fontSize, 13)
          : isConfirm ? Math.min(size.fontSize, 20)
          : size.fontSize,
        background: isDone ? "var(--surface-3)"
          : isConfirm ? "var(--warning)"
          : isHoverActive ? "color-mix(in oklab, var(--success) 82%, white)"
          : "var(--success)",
        // --brand-contrast je projektová tmavá barva pro text na světlém akcentu
        // (--warning i --brand jsou v obou tématech světlé), proto ji sdílíme.
        color: isDone ? "var(--text-muted)"
          : isConfirm ? "var(--brand-contrast)"
          : "var(--success-contrast)",
```

A v obsahu tlačítka vlož potvrzovací popisek před ostatní větve:

```tsx
      {pending ? "·" : isConfirm ? confirmLabel : isWide ? wideLabel : isDone ? "↩" : "✓"}
```

- [ ] **Step 3: Ověř, že se karta bloku v plánu nezměnila**

Run: `grep -n "PrintDoneButton" src/components/planner/BlockCard.tsx`
Expected: obě místa předávají jen `size`/`isDone`/`completedAt`/`pending`/`onToggle` — **žádné `confirmLabel`**, takže `isConfirm` je tam vždy `false`.

- [ ] **Step 4: Ověř build a testy**

Run: `npm run build`
Expected: build projde, 0 TypeScript chyb

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 818 testů

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/PrintDoneButton.tsx
git commit -m "feat(monitor): potvrzovací podoba tlačítka Hotovo"
```

---

### Task 3: Stav „odklepnuto" a potvrzení v MonitorView

**Files:**
- Modify: `src/components/monitor/MonitorView.tsx`

**Interfaces:**
- Consumes: `resolveStickyBlock`, `startDayLabel` z `src/lib/monitorView` (Task 1); prop `confirmLabel` na `PrintDoneButton` (Task 2).
- Produces: nic pro další tasky — poslední task plánu.

- [ ] **Step 1: Rozšiř importy a přidej stavy**

Rozšiř import z `@/lib/monitorView` o `resolveStickyBlock` a `startDayLabel`.

Hned za `const [lockUntil, setLockUntil] = useState(0);` vlož:

```tsx
  // Zakázka držená na kartě po odklepnutí — karta se sama nikdy nepřepne,
  // čeká na „Další →" nebo „Vrátit" (vědomé rozhodnutí, viz spec §2).
  const [stickyId, setStickyId] = useState<number | null>(null);
  // Zakázka, u které první kliknutí jen vyvolalo dotaz „opravdu?" — týká se
  // výhradně zakázek, které ještě nezačaly.
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
```

- [ ] **Step 2: Odvoď, co má karta ukázat**

Nahraď řádek `const hero = now ? pickHeroBlock(blocks, viewMachine, now) : null;` tímto:

```tsx
  const liveHero = now ? pickHeroBlock(blocks, viewMachine, now) : null;
  const sticky = resolveStickyBlock(blocks, stickyId);

  // Rozlišený tvar, ať TypeScript pozná, že `reason` má jen živá karta.
  // Držená (odklepnutá) zakázka má přednost před běžným výběrem.
  const card = sticky
    ? ({ kind: "completed", block: sticky } as const)
    : liveHero
    ? ({ kind: "live", block: liveHero.block, reason: liveHero.reason } as const)
    : null;
```

**Pozor:** dál v souboru se na několika místech používá proměnná `hero` (`hero.block.orderNumber`, `hero.block.description`, …). Všechny výskyty přepiš na `card` — kromě těch, které řeší kroky 4, 5 a 7 níž. Podmínka `{hero && now ? (` se změní na `{card && now ? (`. Po úpravě nesmí v souboru zbýt žádné `hero` (ověříš greppem v kroku 9).

- [ ] **Step 3: Ukliď neplatné stavy**

Za výpočet `card` vlož:

```tsx
  // Držení přestalo platit (odklepnutí zrušil někdo jiný, blok zmizel) —
  // zahodíme id, ať se stav nedrží naprázdno.
  useEffect(() => {
    if (stickyId != null && !sticky) setStickyId(null);
  }, [stickyId, sticky]);

  // Přepnutí stroje ruší jak držení, tak rozdělaný dotaz — karta patří jinam.
  useEffect(() => {
    setStickyId(null);
    setConfirmingId(null);
  }, [viewMachine]);
```

- [ ] **Step 4: Kicker, barva a popisek pro potvrzení**

Nahraď výpočty `kicker` a `kickerColor` a hned za ně přidej popisek startu:

```tsx
  const kicker =
    card?.kind === "completed" ? "✓ ODKLEPNUTO"
    : card?.kind === "live" && card.reason === "running" ? "TEĎ BĚŽÍ"
    : card?.kind === "live" && card.reason === "overdue" ? "PŘETAHUJE"
    : card ? "ZAČÍNÁ" : "";

  const kickerColor =
    card?.kind === "live" && card.reason === "overdue" ? "var(--warning)"
    : card?.kind === "completed" || (card?.kind === "live" && card.reason === "running")
    ? "var(--success)"
    : "var(--text-muted)";

  // Popisek do potvrzovacího tlačítka: „ZÍTRA 6:00" / „13. 08. 6:00" / „V 6:00".
  const startLabelForConfirm = card && now
    ? (() => {
        const day = startDayLabel(card.block.startTime, now);
        const time = formatPragueTime(new Date(card.block.startTime));
        return day ? `${day.toUpperCase()} ${time}` : `V ${time}`;
      })()
    : "";
```

- [ ] **Step 5: Řádek s časem — pro odklepnutou zakázku jiný**

V kartě je dnes `<HeroTiming block={hero.block} reason={hero.reason} now={now} />`. Nahraď ten řádek podmínkou:

```tsx
                {card.kind === "completed" ? (
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--success)" }}>
                    ✓ Hotovo {card.block.printCompletedAt
                      ? formatPragueTime(new Date(card.block.printCompletedAt))
                      : ""}
                  </div>
                ) : (
                  <HeroTiming block={card.block} reason={card.reason} now={now} />
                )}
```

Díky rozlišení podle `kind` dostane `HeroTiming` prop `reason` vždy jen `"running" | "overdue" | "upcoming"` — její typ se nemění.

- [ ] **Step 6: Nahraď footer karty třemi podobami**

Nahraď celý blok `<div style={{ marginTop: "auto" }}> … </div>` (dnes obsahuje `PrintDoneButton` a hlášku o cizím stroji) tímto:

```tsx
                <div style={{ marginTop: "auto" }}>
                  {!onPrintComplete ? (
                    <div style={{
                      height: 96, borderRadius: 12,
                      display: "grid", placeItems: "center",
                      background: "var(--surface-2)", color: "var(--text-muted)",
                      fontSize: 14, textAlign: "center", padding: 12,
                    }}>
                      Odklepnout jde jen na vlastním stroji.
                    </div>
                  ) : card.kind === "completed" ? (
                    // Karta drží zakázku, dokud tiskař nerozhodne. Obě tlačítka jsou
                    // po dobu zámku neaktivní, aby je netrefil druhý klik rychlého
                    // dvojkliku na místě, kde do té chvíle bylo HOTOVO.
                    <div style={{ display: "flex", gap: 12, height: 96 }}>
                      <button
                        onClick={(e) => {
                          if (e.button !== 0) return;
                          const id = card.block.id;
                          setPendingId(id);
                          setStickyId(null);
                          onPrintComplete(id, false)
                            .finally(() => setPendingId((cur) => (cur === id ? null : cur)));
                        }}
                        disabled={pendingId === card.block.id || Date.now() < lockUntil}
                        style={{
                          flex: 1, borderRadius: 12, border: "1px solid var(--border)",
                          background: "var(--surface-3)", color: "var(--text)",
                          font: "inherit", fontSize: 22, fontWeight: 700, cursor: "pointer",
                        }}
                      >
                        Vrátit
                      </button>
                      <button
                        onClick={(e) => {
                          if (e.button !== 0) return;
                          setStickyId(null);
                        }}
                        disabled={Date.now() < lockUntil}
                        style={{
                          flex: 2, borderRadius: 12, border: "none",
                          background: "var(--brand)", color: "var(--brand-contrast)",
                          font: "inherit", fontSize: 26, fontWeight: 750,
                          letterSpacing: "0.04em", cursor: "pointer",
                        }}
                      >
                        Další →
                      </button>
                    </div>
                  ) : (
                    <PrintDoneButton
                      size={{ variant: "hero", height: 96, fontSize: 30 }}
                      isDone={false}
                      completedAt={null}
                      pending={pendingId === card.block.id || Date.now() < lockUntil}
                      confirmLabel={
                        card.reason === "upcoming" && confirmingId === card.block.id
                          ? `ZAČÍNÁ ${startLabelForConfirm} — POTVRDIT`
                          : undefined
                      }
                      onToggle={() => {
                        const id = card.block.id;
                        // Budoucí zakázka na dvě doby: první kliknutí se jen zeptá.
                        if (card.reason === "upcoming" && confirmingId !== id) {
                          setConfirmingId(id);
                          setTimeout(
                            () => setConfirmingId((cur) => (cur === id ? null : cur)),
                            5000
                          );
                          return;
                        }
                        setConfirmingId(null);
                        setPendingId(id);
                        const until = Date.now() + 800;
                        setLockUntil(until);
                        setTimeout(() => setLockUntil((cur) => (cur === until ? 0 : cur)), 800);
                        onPrintComplete(id, true)
                          .then(() => setStickyId(id))
                          .finally(() => setPendingId((cur) => (cur === id ? null : cur)));
                      }}
                    />
                  )}
                </div>
```

- [ ] **Step 7: Doplň den do odpočtu (backlog M9)**

V komponentě `HeroTiming` nahraď větev `if (reason === "upcoming")`:

```tsx
  if (reason === "upcoming") {
    const minutesToStart = Math.ceil((new Date(block.startTime).getTime() - now.getTime()) / 60000);
    const day = startDayLabel(block.startTime, now);
    return (
      <div style={{ fontSize: 17, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        Začíná {day ? `${day} v` : "v"} {formatPragueTime(new Date(block.startTime))}
        <span style={{ color: "var(--text-muted)" }}> · za {formatMinutes(minutesToStart)}</span>
      </div>
    );
  }
```

- [ ] **Step 8: Ověř, že nezůstala stará proměnná**

Run: `grep -n "\bhero\b" src/components/monitor/MonitorView.tsx`
Expected: žádný výskyt (kromě `liveHero`, `HeroChips`, `HeroTiming` a komentářů)

- [ ] **Step 9: Ověř build, typy, testy a lint**

Run: `npm run build`
Expected: build projde

Run: `npx tsc --noEmit`
Expected: 0 chyb

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 818 testů

Run: `npm run lint`
Expected: 0 chyb, žádný nový warning

- [ ] **Step 10: Commit**

```bash
git add src/components/monitor/MonitorView.tsx
git commit -m "feat(monitor): karta po odklepnutí čeká na Další, budoucí zakázka chce potvrzení"
```

---

## Hotovo, když

- [ ] `npm run build` a `npx tsc --noEmit` projdou
- [ ] Celá test suite zelená (818 testů)
- [ ] `grep -n "confirmLabel" src/components/planner/BlockCard.tsx` nevrací nic — karta bloku v plánu potvrzovací podobu nepoužívá
- [ ] Ruční průchod jako `TISKAR`: odklepnutí drží kartu · dvojklik odklepne jen jednu zakázku · Vrátit i Další fungují · budoucí zakázka chce dvě kliknutí · po 5 s se potvrzení vrátí do klidu · zítřejší zakázka má u odpočtu den · přepnutí stroje stav zruší
- [ ] Přihlášení jako `PLANOVAT` — planner beze změny
