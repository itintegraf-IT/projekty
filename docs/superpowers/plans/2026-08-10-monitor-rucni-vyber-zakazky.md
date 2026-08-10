# Monitor — ruční výběr zakázky — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umožnit tiskaři vytáhnout si na velkou kartu kteroukoli zakázku z fronty, aby mohl přeskočit tu, na kterou nemá materiál.

**Architecture:** Tři nová pravidla jdou do `src/lib/monitorView.ts` jako čisté funkce s testy (`monitorQueue` nahrazuje `todayQueue`). `MonitorQueue` dostane dva oddíly. `MonitorView` přibude stav `selectedId`, který přebíjí automatický výběr, a `PlannerPage` přijde o prop `onSelectBlock` — výběr si Monitor řeší sám.

**Tech Stack:** Next.js 16 · React · TypeScript · Tailwind CSS v4 (inline style) · testy `node:test` + `tsx`.

**Specifikace:** `docs/superpowers/specs/2026-08-10-monitor-rucni-vyber-zakazky-design.md`

## Global Constraints

- **Barvy vždy přes CSS tokeny** z `src/app/globals.css`, nikdy hex/rgba literál.
- Změny se smí projevit **jen na Monitoru pro roli `TISKAR`**. Karta bloku v plánu a všechny ostatní role beze změny.
- **Mouse handlery** začínají `if (e.button !== 0) return;`.
- **Žádná změna serverové logiky, žádná migrace, žádné nové pole v databázi.**
- **Datum výhradně přes pražské helpery** z `src/lib/dateUtils.ts`.
- V `src/lib/` se `Block` importuje přes alias `@/`, **v testech** relativně s příponou `.js`.
- `npm run build` i `npx tsc --noEmit` musí projít; `npm run lint` bez chyb a bez nových warningů.
- Test suite: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` — před začátkem **819 zelených**.

---

### Task 1: Pravidla fronty, výběru a stavu (čistá logika + testy)

**Files:**
- Modify: `src/lib/monitorView.ts`
- Modify: `src/lib/monitorView.test.ts`

**Interfaces:**
- Consumes: `utcToPragueDateStr`, `addDaysToCivilDate` z `src/lib/dateUtils`; typ `Block`; existující `HeroReason`.
- Produces:
  - `monitorQueue(blocks, machine, now): { today: Block[]; tomorrow: Block[] }` — **nahrazuje** `todayQueue`, která zanikne
  - `resolveSelectedBlock(blocks, selectedId, machine): Block | null`
  - `reasonForBlock(block, now): HeroReason`

- [ ] **Step 1: Uprav a doplň testy**

V `src/lib/monitorView.test.ts` rozšiř import na prvním řádku: místo `todayQueue` importuj `monitorQueue`, `resolveSelectedBlock` a `reasonForBlock`.

Nahraď oba stávající testy `todayQueue` (hledej `test("todayQueue:`) tímto:

```ts
test("monitorQueue: jen daný stroj, dnešek i zítřek, seřazeno podle startu", () => {
  const a = mk({ id: 1, startTime: "2026-08-10T10:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  const b = mk({ id: 2, startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T09:00:00.000Z" });
  const other = mk({ id: 3, machine: "XL_105" });
  const tmr = mk({ id: 4, startTime: "2026-08-11T06:00:00.000Z", endTime: "2026-08-11T09:00:00.000Z" });
  const later = mk({ id: 5, startTime: "2026-08-13T06:00:00.000Z", endTime: "2026-08-13T09:00:00.000Z" });
  const q = monitorQueue([a, b, other, tmr, later], "XL_106", new Date("2026-08-10T08:00:00.000Z"));
  assert.deepEqual(q.today.map((x) => x.id), [2, 1]);
  assert.deepEqual(q.tomorrow.map((x) => x.id), [4]);
});

test("monitorQueue: odklepnuté zakázky ve frontě zůstávají (zobrazí se ztlumené)", () => {
  const done = mk({ id: 5, printCompletedAt: "2026-08-10T08:00:00.000Z" });
  const q = monitorQueue([done], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(q.today.length, 1);
});

test("monitorQueue: rezervace a údržba do fronty nepatří", () => {
  const rez = mk({ id: 6, type: "REZERVACE" });
  const udr = mk({ id: 7, type: "UDRZBA" });
  const q = monitorQueue([rez, udr], "XL_106", new Date("2026-08-10T10:00:00.000Z"));
  assert.equal(q.today.length, 0);
  assert.equal(q.tomorrow.length, 0);
});
```

A na konec souboru přidej:

```ts
test("resolveSelectedBlock: vrátí zakázku na daném stroji", () => {
  const b = mk({ id: 5 });
  assert.equal(resolveSelectedBlock([b], 5, "XL_106")?.id, 5);
});

test("resolveSelectedBlock: bez id vrátí null", () => {
  assert.equal(resolveSelectedBlock([mk({ id: 5 })], null, "XL_106"), null);
});

test("resolveSelectedBlock: zakázka, která z dat zmizela", () => {
  assert.equal(resolveSelectedBlock([mk({ id: 9 })], 5, "XL_106"), null);
});

test("resolveSelectedBlock: zakázka přesunutá na jiný stroj výběr pustí", () => {
  const b = mk({ id: 5, machine: "XL_105" });
  assert.equal(resolveSelectedBlock([b], 5, "XL_106"), null);
});

test("resolveSelectedBlock: rezervaci ani údržbu vybrat nejde", () => {
  const rez = mk({ id: 5, type: "REZERVACE" });
  assert.equal(resolveSelectedBlock([rez], 5, "XL_106"), null);
});

test("resolveSelectedBlock: odklepnutou zakázku vybrat jde (kvůli vrácení)", () => {
  const b = mk({ id: 5, printCompletedAt: "2026-08-10T08:00:00.000Z" });
  assert.equal(resolveSelectedBlock([b], 5, "XL_106")?.id, 5);
});

test("reasonForBlock: uvnitř svého času = running", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T08:00:00.000Z")), "running");
});

test("reasonForBlock: přesný konec už není running", () => {
  const b = mk({ startTime: "2026-08-10T06:00:00.000Z", endTime: "2026-08-10T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T12:00:00.000Z")), "overdue");
});

test("reasonForBlock: dávno skončená zakázka je overdue bez ohledu na 16h okno", () => {
  const b = mk({ startTime: "2026-08-01T06:00:00.000Z", endTime: "2026-08-01T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T08:00:00.000Z")), "overdue");
});

test("reasonForBlock: budoucí zakázka je upcoming", () => {
  const b = mk({ startTime: "2026-08-12T06:00:00.000Z", endTime: "2026-08-12T12:00:00.000Z" });
  assert.equal(reasonForBlock(b, new Date("2026-08-10T08:00:00.000Z")), "upcoming");
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: FAIL — `monitorQueue is not a function` (a další nové funkce)

- [ ] **Step 3: Napiš implementaci**

V `src/lib/monitorView.ts` rozšiř import z `dateUtils` o `addDaysToCivilDate` (pokud tam ještě není) a **nahraď celou funkci `todayQueue`** tímto:

```ts
/**
 * Fronta Monitoru — zakázky na daném stroji pro dnešek a zítřek, obojí seřazené
 * podle začátku. Odklepnuté zůstávají, fronta je ukazuje ztlumené, aby byl vidět
 * postup směny. Rezervace a údržba do fronty nepatří — tiskař odklepává zakázky.
 *
 * Dva dny záměrně: tiskař, který přeskočí zakázku kvůli chybějícímu materiálu,
 * často sáhne po něčem z dalšího dne. Na vzdálenější zakázky je tlačítko Najít.
 */
export function monitorQueue(
  blocks: Block[],
  machine: string,
  now: Date
): { today: Block[]; tomorrow: Block[] } {
  const todayStr = utcToPragueDateStr(now);
  const tomorrowStr = addDaysToCivilDate(todayStr, 1);
  const onMachine = blocks.filter((b) => b.type === "ZAKAZKA" && b.machine === machine);
  const forDay = (dayStr: string) =>
    onMachine
      .filter((b) => utcToPragueDateStr(new Date(b.startTime)) === dayStr)
      .sort(byStartAsc);
  return { today: forDay(todayStr), tomorrow: forDay(tomorrowStr) };
}

/**
 * Zakázka, kterou si tiskař ručně vytáhl na velkou kartu, nebo null, když výběr
 * přestal platit (zakázka zmizela z dat nebo ji plánovač přesunul na jiný stroj).
 *
 * Odklepnutou zakázku vybrat **jde** — je to jediná cesta, jak z Monitoru vzít
 * zpět starší odklepnutí.
 */
export function resolveSelectedBlock(
  blocks: Block[],
  selectedId: number | null,
  machine: string
): Block | null {
  if (selectedId == null) return null;
  const block = blocks.find((b) => b.id === selectedId);
  if (!block) return null;
  if (block.machine !== machine) return null;
  if (block.type !== "ZAKAZKA") return null;
  return block;
}

/**
 * Stav zakázky podle jejího času — bez ohledu na to, jak se na kartu dostala.
 *
 * Záměrně **bez** šestnáctihodinového okna: to je pravidlo pro automatický výběr
 * (`pickHeroBlock`), ne pro zobrazení. Když si tiskař ručně vytáhne týden starou
 * neodklepnutou zakázku, „PŘETAHUJE" je pořád pravdivý popis.
 */
export function reasonForBlock(block: Block, now: Date): HeroReason {
  const t = now.getTime();
  const start = new Date(block.startTime).getTime();
  const end = new Date(block.endTime).getTime();
  if (t >= start && t < end) return "running";
  if (end <= t) return "overdue";
  return "upcoming";
}
```

- [ ] **Step 4: Spusť testy a ověř, že prochází**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: PASS

- [ ] **Step 5: Ověř celou suite**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 830 testů (819 − 2 nahrazené + 13 nových)

`npm run build` v tomhle kroku **selže** na `MonitorView.tsx`, protože `todayQueue` už neexistuje — to je v pořádku, opraví to Task 3. Build tedy zatím nespouštěj.

- [ ] **Step 6: Commit**

```bash
git add src/lib/monitorView.ts src/lib/monitorView.test.ts
git commit -m "feat(monitor): pravidla fronty na dva dny, ručního výběru a stavu zakázky"
```

---

### Task 2: Fronta ve dvou oddílech

**Files:**
- Modify: `src/components/monitor/MonitorQueue.tsx`

**Interfaces:**
- Consumes: nic z Tasku 1 (dostane hotová pole propsy).
- Produces: `MonitorQueue` s props `{ today: Block[]; tomorrow: Block[]; heroId: number | null; onSelect: (block: Block) => void }`.

- [ ] **Step 1: Přepiš komponentu**

Nahraď celý obsah `src/components/monitor/MonitorQueue.tsx`:

```tsx
"use client";

import type { Block } from "@/app/_components/TimelineGrid";
import { formatPragueTime } from "@/lib/dateUtils";

type Props = {
  today: Block[];
  tomorrow: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
};

/**
 * Pravý sloupec Monitoru — zakázky na stroji pro dnešek a zítřek.
 * Odklepnuté jsou ztlumené se zeleným háčkem, zakázka na velké kartě zvýrazněná.
 * Kliknutí ji vytáhne na velkou kartu (tiskař tím přebíjí pořadí od plánovače).
 */
export function MonitorQueue({ today, tomorrow, heroId, onSelect }: Props) {
  if (today.length === 0 && tomorrow.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "12px 4px" }}>
        Na tomhle stroji není dnes ani zítra nic naplánováno.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
      <QueueSection title="Dnes" blocks={today} heroId={heroId} onSelect={onSelect} />
      <QueueSection title="Zítra" blocks={tomorrow} heroId={heroId} onSelect={onSelect} />
    </div>
  );
}

function QueueSection({
  title, blocks, heroId, onSelect,
}: { title: string; blocks: Block[]; heroId: number | null; onSelect: (block: Block) => void }) {
  if (blocks.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
      <div style={{
        fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase",
        color: "var(--text-muted)", fontWeight: 700,
      }}>
        {title}
      </div>
      {blocks.map((b) => {
        const isDone = b.printCompletedAt != null;
        const isHero = b.id === heroId;
        return (
          <button
            key={b.id}
            onClick={(e) => { if (e.button !== 0) return; onSelect(b); }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "11px 12px",
              borderRadius: 10,
              textAlign: "left",
              font: "inherit",
              cursor: "pointer",
              background: isHero ? "color-mix(in oklab, var(--success) 12%, var(--surface))" : "var(--surface)",
              border: `1px solid ${isHero ? "var(--success)" : "var(--border)"}`,
              color: "var(--text)",
              opacity: isDone ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontFamily: "ui-monospace, monospace",
              fontWeight: 700, fontVariantNumeric: "tabular-nums",
              fontSize: 14, flexShrink: 0,
              color: isDone ? "var(--success)" : "var(--text)",
            }}>
              {isDone ? "✓ " : ""}{b.orderNumber}
            </span>
            <span style={{
              color: "var(--text-muted)", fontSize: 13,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {b.description ?? ""}
            </span>
            <span style={{
              marginLeft: "auto", flexShrink: 0,
              color: "var(--text-muted)", fontSize: 13,
              fontVariantNumeric: "tabular-nums",
            }}>
              {formatPragueTime(new Date(b.startTime))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Ověř typy**

Run: `npx tsc --noEmit`
Expected: chyby **jen** v `MonitorView.tsx` (ještě předává staré props a volá `todayQueue`) — to opraví Task 3. Žádná chyba nesmí být v `MonitorQueue.tsx` samotné.

- [ ] **Step 3: Commit**

```bash
git add src/components/monitor/MonitorQueue.tsx
git commit -m "feat(monitor): fronta ve dvou oddílech — dnes a zítra"
```

---

### Task 3: Ruční výběr v MonitorView

**Files:**
- Modify: `src/components/monitor/MonitorView.tsx`
- Modify: `src/app/_components/PlannerPage.tsx`

**Interfaces:**
- Consumes: `monitorQueue`, `resolveSelectedBlock`, `reasonForBlock` (Task 1); `MonitorQueue` s novými props (Task 2).
- Produces: nic pro další tasky — poslední task plánu.

- [ ] **Step 1: Uprav importy a přidej stav**

V `src/components/monitor/MonitorView.tsx` uprav import z `@/lib/monitorView` — `todayQueue` nahraď trojicí `monitorQueue`, `resolveSelectedBlock`, `reasonForBlock`:

```tsx
import { pickHeroBlock, monitorQueue, runProgress, resolveStickyBlock, startDayLabel, resolveSelectedBlock, reasonForBlock } from "@/lib/monitorView";
```

Za `const [confirmingRevertId, setConfirmingRevertId] = useState<number | null>(null);` vlož:

```tsx
  // Zakázka, kterou si tiskař ručně vytáhl z fronty. Přebíjí automatický výběr:
  // plán je optimální pořadí, ale u stroje se legitimně odchýlí (typicky když
  // na následující zakázku není materiál).
  const [selectedId, setSelectedId] = useState<number | null>(null);
```

- [ ] **Step 2: Doplň odvození karty o ruční výběr**

Nahraď blok od `const liveHero = …` po `: null;` (tedy výpočty `liveHero`, `sticky` a `card`) tímto:

```tsx
  const liveHero = now ? pickHeroBlock(blocks, viewMachine, now) : null;
  const sticky = resolveStickyBlock(blocks, stickyId, viewMachine);
  const selected = resolveSelectedBlock(blocks, selectedId, viewMachine);

  // Priorita: rozdělaná akce (odklepnuto, čeká na Další) → ruční výběr → automatika.
  // Rozlišený tvar, ať TypeScript pozná, že `reason` má jen živá karta.
  const card = !now
    ? null
    : sticky
    ? ({ kind: "completed", block: sticky } as const)
    : selected
    ? selected.printCompletedAt != null
      ? ({ kind: "completed", block: selected } as const)
      : ({ kind: "live", block: selected, reason: reasonForBlock(selected, now) } as const)
    : liveHero
    ? ({ kind: "live", block: liveHero.block, reason: liveHero.reason } as const)
    : null;

  // Označíme jen skutečné přebití — když si tiskař vybral právě to, co navrhuje
  // automatika, není co hlásit.
  const manualOverride = !!selected && !sticky && selected.id !== liveHero?.block.id;
```

- [ ] **Step 3: Ukliď neplatný výběr**

Za úklidový efekt `[stickyId, sticky]` vlož:

```tsx
  // Výběr přestal platit (zakázka zmizela z dat nebo se přesunula na jiný stroj).
  useEffect(() => {
    if (selectedId != null && !selected) setSelectedId(null);
  }, [selectedId, selected]);
```

A do efektu na `[viewMachine]` přidej k ostatním nulováním:

```tsx
    setSelectedId(null);
```

- [ ] **Step 4: Uprav frontu**

Nahraď řádek `const queue = now ? todayQueue(blocks, viewMachine, now) : [];`:

```tsx
  const queue = now ? monitorQueue(blocks, viewMachine, now) : { today: [], tomorrow: [] };
```

A úplně dole nahraď vykreslení fronty:

```tsx
          <MonitorQueue
            today={queue.today}
            tomorrow={queue.tomorrow}
            heroId={card?.block.id ?? null}
            onSelect={(block) => setSelectedId(block.id)}
          />
```

- [ ] **Step 5: Přidej řádek „vybráno ručně"**

Najdi element s `{kicker}` (stavový štítek nad kartou) a **hned za něj** vlož:

```tsx
              {manualOverride && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
                  fontSize: 13, color: "var(--text-muted)",
                }}>
                  <span>vybráno ručně</span>
                  <button
                    onClick={(e) => { if (e.button !== 0) return; setSelectedId(null); }}
                    style={{
                      font: "inherit", fontSize: 13,
                      padding: "3px 10px", borderRadius: 7,
                      background: "var(--surface-2)", border: "1px solid var(--border)",
                      color: "var(--text)", cursor: "pointer",
                    }}
                  >
                    zpět na doporučené
                  </button>
                </div>
              )}
```

- [ ] **Step 6: „Další →" ruší i výběr**

V handleru tlačítka `Další →` doplň za `setStickyId(null);`:

```tsx
                          setSelectedId(null);
```

- [ ] **Step 7: Zruš prop `onSelectBlock`**

V `MonitorView.tsx` odstraň `onSelectBlock` z `type Props` i z destrukturalizace parametrů — výběr si komponenta řeší sama.

V `src/app/_components/PlannerPage.tsx` odstraň řádek, kterým se prop předává:

```tsx
          onSelectBlock={jumpToBlockFromMonitor}
```

`jumpToBlockFromMonitor` **nemaž** — pořád ji používá `OrderSearchSheet`.

- [ ] **Step 8: Ověř build, typy, testy a lint**

Run: `npm run build`
Expected: projde

Run: `npx tsc --noEmit`
Expected: 0 chyb

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`
Expected: PASS — 830 testů

Run: `npm run lint`
Expected: 0 chyb, žádný nový warning

Run: `grep -rn "todayQueue" src/`
Expected: žádný výskyt

- [ ] **Step 9: Commit**

```bash
git add src/components/monitor/MonitorView.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(monitor): tiskař si může vytáhnout kteroukoli zakázku z fronty"
```

---

## Hotovo, když

- [ ] `npm run build` a `npx tsc --noEmit` projdou, `npm run lint` bez nových warningů
- [ ] Celá test suite zelená (830 testů)
- [ ] `grep -rn "todayQueue" src/` nevrací nic
- [ ] Ruční průchod jako `TISKAR`: klik ve frontě vytáhne zakázku na kartu a **nevyhodí do plánu** · objeví se „vybráno ručně" + „zpět na doporučené" · HOTOVO odklepne vybranou · ručně vybraná zítřejší chce dvě kliknutí · klik na odklepnutou ukáže `✓ ODKLEPNUTO` a jde ji vrátit · fronta má oddíly Dnes a Zítra · přepnutí stroje výběr zruší · **Najít** dál skáče do plánu
- [ ] Přihlášení jako `PLANOVAT` — planner beze změny
