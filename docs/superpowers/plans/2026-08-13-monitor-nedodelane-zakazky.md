# Nedodělané zakázky na Monitoru tiskaře — implementační plán

> **Pro agentní workery:** POVINNÝ SUB-SKILL: použij `superpowers:subagent-driven-development` (doporučeno) nebo `superpowers:executing-plans` a jeď úkol po úkolu. Kroky mají checkbox (`- [ ]`) pro odškrtávání.

**Cíl:** Tiskař u stroje uvidí a odklepne zakázky, které se nestihly vytisknout v minulých dnech — dnes se mu nezobrazí nikde.

**Architektura:** Čistě klientská změna. Do fronty Monitoru přibude třetí sekce „NEDODĚLÁNO" (neodklepnuté zakázky z posledních 14 dnů), a tiskařské vyhledávání „Najít" nově ústí na velkou kartu Monitoru místo do plánu, kde je dnes slepá ulička. Pravidlo výběru je čistá funkce v `src/lib/monitorView.ts` pokrytá testy; komponenty na ní jen staví.

**Tech stack:** Next.js 16 (App Router) · React · TypeScript · node:test + tsx.

**Podkladový spec:** `docs/superpowers/specs/2026-08-12-monitor-nedodelane-zakazky-design.md`

## Globální omezení

- **Žádná změna API, DB ani migrace.** `GET /api/blocks` vrací celou tabulku bez filtru, klient má všechny bloky. `POST /api/blocks/[id]/complete` nemá žádné časové okno — ověřeno.
- **Nic se nepřeplánovává** a **neposílá se žádná notifikace** (rozhodnutí majitele 12. 8. 2026). Blok zůstává tam, kde je.
- **`pickHeroBlock` ani `OVERDUE_WINDOW_MS` se NEMĚNÍ.** Konstanta bydlí v `src/lib/overdueState.ts` a týmž oknem se řídí červený alarm na kartě v plánu — zásah by rozsvítil alarm na desítkách zakázek.
- **Datum vždy přes helpery z `src/lib/dateUtils.ts`** (`utcToPragueDateStr`, `addDaysToCivilDate`, `pragueToUTC`). NIKDY neodečítat `14 * 24 * 3600 * 1000` — rozbilo by se to na přechodu letního času.
- **Barvy výhradně přes CSS tokeny** z `src/app/globals.css` (`--warning`, `--text-muted`, `--surface`, `--border`, `--success`). Žádný hex ani rgba literál v komponentě — rozbíjí light mode.
- **Test suite se pouští celá** (glob nejde do podsložek, proto se každá vyjmenuje):
  ```bash
  node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
  Výchozí stav před začátkem práce: **1039 testů, 0 selhání.**
- **Před pushem `npm run build`** — chytí TS chyby dřív než server. Pozor: build sdílí `.next` s běžícím dev serverem a shodí ho.
- **Stávající testy `monitorView.test.ts` se NEPŘEPISUJÍ.** Testy „zakázka po 16hodinovém okně už na kartě není" a „včerejší neodklepnutá zakázka se jako overdue nebere" pinují hero automatiku, která se nemění.

## Struktura souborů

| Soubor | Odpovědnost | Úkol |
| --- | --- | --- |
| `src/lib/monitorView.ts` | Pravidlo výběru — `monitorQueue` vrátí navíc `overdue`, nová konstanta `UNFINISHED_LOOKBACK_DAYS` | 1 |
| `src/lib/monitorView.test.ts` | Testy pravidla | 1 |
| `src/components/monitor/MonitorQueue.tsx` | Vykreslení sekce + oprava early returnu | 2 |
| `src/components/monitor/MonitorView.tsx` | Propojení fronty, hláška prázdné karty, datum na kartě, příjem `focusBlockId` | 3, 4, 5 |
| `src/app/_components/PlannerPage.tsx` | „Najít" ústí na Monitor místo do plánu | 5 |

---

### Task 1: Pravidlo — které zakázky jsou „nedodělané"

**Soubory:**
- Upravit: `src/lib/monitorView.ts` (funkce `monitorQueue`)
- Test: `src/lib/monitorView.test.ts`

**Rozhraní:**
- Konzumuje: `utcToPragueDateStr`, `addDaysToCivilDate` (už importované), nově `pragueToUTC` z `@/lib/dateUtils`
- Produkuje:
  - `export const UNFINISHED_LOOKBACK_DAYS = 14`
  - `monitorQueue(blocks, machine, now)` nově vrací `{ overdue: Block[]; today: Block[]; tomorrow: Block[] }` (dřív jen `today` a `tomorrow`)

- [ ] **Krok 1: Napiš failující testy**

Přidej na konec `src/lib/monitorView.test.ts`. Soubor už má pomocníka
`function mk(over: Partial<Block> = {}): Block` s výchozími hodnotami
(`machine: "XL_106"`, `type: "ZAKAZKA"`, `blockVariant: "STANDARD"`,
`printCompletedAt: null`) — použij ho, nezaváděj nový.

**Pozor:** tenhle soubor importuje s příponou `.js` (`from "./monitorView.js"`).
Drž se toho, ať se dávka nerozejde. Do existujícího importu přidej
`UNFINISHED_LOOKBACK_DAYS`:

```typescript
import { pickHeroBlock, pickNextBlock, monitorQueue, resolveSelectedBlock, reasonForBlock, runProgress, resolveStickyBlock, startDayLabel, UNFINISHED_LOOKBACK_DAYS } from "./monitorView.js";
```

```typescript
// ── monitorQueue: sekce NEDODĚLÁNO ──────────────────────────────────────────

test("monitorQueue.overdue: neodklepnutá zakázka z předchozího dne je v sekci", () => {
  // NOW = 2026-08-12 08:00 pražského času. Blok skončil 10. 8. ve 22:00.
  const now = new Date("2026-08-12T06:00:00.000Z");
  const b = mk({
    id: 1, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T20:00:00.000Z",
    printCompletedAt: null,
  });
  const q = monitorQueue([b], "XL_105", now);
  assert.deepEqual(q.overdue.map((x) => x.id), [1]);
});

test("monitorQueue.overdue: zakázka starší než 14 dnů v sekci NENÍ", () => {
  const now = new Date("2026-08-12T06:00:00.000Z");
  const b = mk({
    id: 1, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-07-20T06:00:00.000Z", endTime: "2026-07-20T14:00:00.000Z",
    printCompletedAt: null,
  });
  assert.deepEqual(monitorQueue([b], "XL_105", now).overdue, []);
});

test("monitorQueue.overdue: odklepnutá zakázka z minula v sekci NENÍ", () => {
  const now = new Date("2026-08-12T06:00:00.000Z");
  const b = mk({
    id: 1, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T20:00:00.000Z",
    printCompletedAt: "2026-08-10T20:05:00.000Z",
  });
  assert.deepEqual(monitorQueue([b], "XL_105", now).overdue, []);
});

test("monitorQueue.overdue: PRÁVĚ BĚŽÍCÍ noční směna z včerejška v sekci NENÍ", () => {
  // Regrese endTime vs startTime. Start 11. 8. 22:00, konec 12. 8. 6:00 —
  // začala včera, ale končí DNES, takže do „z minulých dnů" nepatří. Podle
  // startTime by spadla dovnitř, i když je zrovna na velké kartě.
  const now = new Date("2026-08-12T06:00:00.000Z"); // 8:00 pražského času
  const b = mk({
    id: 1, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-08-11T20:00:00.000Z", endTime: "2026-08-12T04:00:00.000Z",
    printCompletedAt: null,
  });
  assert.deepEqual(monitorQueue([b], "XL_105", now).overdue, []);
});

test("monitorQueue.overdue: POZASTAVENÁ zakázka v sekci NENÍ", () => {
  // Plán ji z „po termínu" vědomě vylučuje (BlockCard nevolá overdueAlarmState).
  // Je to výrobní stopka, ne zpoždění — kdyby ji Monitor ukázal, obě obrazovky
  // by o téže zakázce tvrdily opak.
  const now = new Date("2026-08-12T06:00:00.000Z");
  const b = mk({
    id: 1, machine: "XL_105", type: "ZAKAZKA", blockVariant: "POZASTAVENO",
    startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T20:00:00.000Z",
    printCompletedAt: null,
  });
  assert.deepEqual(monitorQueue([b], "XL_105", now).overdue, []);
});

test("monitorQueue.overdue: rezervace ani údržba do sekce nepatří", () => {
  const now = new Date("2026-08-12T06:00:00.000Z");
  const rez = mk({
    id: 1, machine: "XL_105", type: "REZERVACE",
    startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T20:00:00.000Z",
    printCompletedAt: null,
  });
  const udrzba = mk({
    id: 2, machine: "XL_105", type: "UDRZBA",
    startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T20:00:00.000Z",
    printCompletedAt: null,
  });
  assert.deepEqual(monitorQueue([rez, udrzba], "XL_105", now).overdue, []);
});

test("monitorQueue.overdue: cizí stroj do sekce nepatří", () => {
  const now = new Date("2026-08-12T06:00:00.000Z");
  const b = mk({
    id: 1, machine: "XL_106", type: "ZAKAZKA",
    startTime: "2026-08-10T12:00:00.000Z", endTime: "2026-08-10T20:00:00.000Z",
    printCompletedAt: null,
  });
  assert.deepEqual(monitorQueue([b], "XL_105", now).overdue, []);
});

test("monitorQueue.overdue: řadí vzestupně podle začátku (nejstarší nahoře)", () => {
  const now = new Date("2026-08-12T06:00:00.000Z");
  const novejsi = mk({
    id: 1, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-08-11T06:00:00.000Z", endTime: "2026-08-11T14:00:00.000Z",
    printCompletedAt: null,
  });
  const starsi = mk({
    id: 2, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-08-05T06:00:00.000Z", endTime: "2026-08-05T14:00:00.000Z",
    printCompletedAt: null,
  });
  const q = monitorQueue([novejsi, starsi], "XL_105", now);
  assert.deepEqual(q.overdue.map((x) => x.id), [2, 1]);
});

test("monitorQueue: scénář z připomínky plánovače — pátek nedotištěno, dnes je středa po svátcích", () => {
  // Pá 7. 8. 2026 zakázka 14:00–22:00 se nestihla. So+Ne volno, Po+Út svátek.
  // Tiskař přijde ve středu 12. 8. v 6:00 (04:00 UTC).
  const now = new Date("2026-08-12T04:00:00.000Z");
  const patecni = mk({
    id: 1, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-08-07T12:00:00.000Z", endTime: "2026-08-07T20:00:00.000Z",
    printCompletedAt: null,
  });
  const stredecni = mk({
    id: 2, machine: "XL_105", type: "ZAKAZKA",
    startTime: "2026-08-12T04:00:00.000Z", endTime: "2026-08-12T12:00:00.000Z",
    printCompletedAt: null,
  });

  const q = monitorQueue([patecni, stredecni], "XL_105", now);
  // Páteční je v NEDODĚLÁNO, ne ve frontě dneška.
  assert.deepEqual(q.overdue.map((x) => x.id), [1]);
  assert.deepEqual(q.today.map((x) => x.id), [2]);
  // A hero automatika se nemění — ukáže středeční jako „upcoming"/"running",
  // páteční na kartu nesáhne (je mimo 16h okno).
  assert.equal(pickHeroBlock([patecni, stredecni], "XL_105", now)?.block.id, 2);
});

test("UNFINISHED_LOOKBACK_DAYS je 14", () => {
  // Zbytek testů je psaný vůči konkrétním datům, takže by změnu konstanty
  // chytily — ale jen nepřímo a s matoucí hláškou. Tohle je explicitní zámek.
  assert.equal(UNFINISHED_LOOKBACK_DAYS, 14);
});
```

- [ ] **Krok 2: Spusť testy a ověř, že selžou**

```bash
node --test --import tsx src/lib/monitorView.test.ts
```

Očekávej: FAIL — `UNFINISHED_LOOKBACK_DAYS` není exportovaná a `q.overdue` je `undefined`.

- [ ] **Krok 3: Implementuj**

V `src/lib/monitorView.ts` rozšiř import z `@/lib/dateUtils` o `pragueToUTC`:

```typescript
import { utcToPragueDateStr, addDaysToCivilDate, formatPragueDateShort, pragueToUTC } from "@/lib/dateUtils";
```

Nad `monitorQueue` přidej konstantu:

```typescript
/**
 * Jak daleko zpět sahá sekce „NEDODĚLÁNO" ve frontě Monitoru.
 *
 * Pokryje každou reálnou kombinaci víkend + svátky + celozávodní odstávka.
 * Strop tu MUSÍ být: sekci nic neuklidí (zakázka z ní zmizí jen odklepnutím
 * nebo smazáním bloku) a `Block` řádky se v projektu nikdy nemažou, takže
 * bez něj by seznam rostl donekonečna, až by Monitor přestal být čitelný.
 *
 * ZÁMĚRNĚ to NENÍ `OVERDUE_WINDOW_MS`: to odpovídá na jinou otázku („je
 * zpoždění ještě akutní?", 16 h) a použití by udělalo dvouhodinovou slepou
 * skvrnu — zakázka stará 14 h by při běžícím jiném bloku nebyla ani na velké
 * kartě, ani tady.
 */
export const UNFINISHED_LOOKBACK_DAYS = 14;
```

Uprav `monitorQueue` (doplň docblock o sekci a rozšiř návratový typ):

```typescript
export function monitorQueue(
  blocks: Block[],
  machine: string,
  now: Date
): { overdue: Block[]; today: Block[]; tomorrow: Block[] } {
  const todayStr = utcToPragueDateStr(now);
  const tomorrowStr = addDaysToCivilDate(todayStr, 1);
  const onMachine = blocks.filter((b) => b.type === "ZAKAZKA" && b.machine === machine);
  const forDay = (dayStr: string) =>
    onMachine
      .filter((b) => utcToPragueDateStr(new Date(b.startTime)) === dayStr)
      .sort(byStartAsc);

  // Hranice z CIVILNÍCH pražských dnů, ne odečtením 14×24 h — jinak by se okno
  // posunulo o hodinu na přechodu letního času.
  const todayMidnightMs = pragueToUTC(todayStr, 0, 0).getTime();
  const floorMs = pragueToUTC(addDaysToCivilDate(todayStr, -UNFINISHED_LOOKBACK_DAYS), 0, 0).getTime();

  // Rozhoduje endTime, ne startTime: noční směna 22:00–6:00 začala včera, ale
  // končí dnes — podle startu by spadla sem, i když právě běží na velké kartě.
  // Táž volba, na které stojí 16h okno hero karty (gotcha z 10. 8. 2026).
  const overdue = onMachine
    .filter((b) => {
      if (b.printCompletedAt != null) return false;
      // Pozastavená zakázka je výrobní stopka, ne zpoždění — plán ji z „po
      // termínu" taky vylučuje (BlockCard na ni nevolá overdueAlarmState).
      if (b.blockVariant === "POZASTAVENO") return false;
      const end = new Date(b.endTime).getTime();
      return end < todayMidnightMs && end >= floorMs;
    })
    .sort(byStartAsc);

  return { overdue, today: forDay(todayStr), tomorrow: forDay(tomorrowStr) };
}
```

- [ ] **Krok 4: Spusť testy a ověř, že projdou**

```bash
node --test --import tsx src/lib/monitorView.test.ts
```

Očekávej: PASS, všechny testy včetně původních.

- [ ] **Krok 5: Spusť celou suite**

```bash
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávej: **1049 testů, 0 selhání** (1039 + 10 nových). `MonitorView.tsx` teď nesedí typově — to je v pořádku, opraví to Task 3; `npx tsc --noEmit` proto zatím poběží s chybou.

- [ ] **Krok 6: Commit**

```bash
git add src/lib/monitorView.ts src/lib/monitorView.test.ts
git commit -m "feat(monitor): monitorQueue vrací sekci nedodělaných zakázek (14 dní)"
```

---

### Task 2: Vykreslení sekce ve frontě

**Soubory:**
- Upravit: `src/components/monitor/MonitorQueue.tsx`

**Rozhraní:**
- Konzumuje: `monitorQueue(...).overdue` z Tasku 1
- Produkuje: `MonitorQueue` přijímá novou povinnou prop `overdue: Block[]`

Komponenty v tomhle repu testy nemají — ověřuje se `npx tsc --noEmit`, `npm run build` a proklikem.

- [ ] **Krok 1: Rozšiř props a early return**

V `src/components/monitor/MonitorQueue.tsx` uprav typ `Props` a hlavičku:

```typescript
type Props = {
  overdue: Block[];
  today: Block[];
  tomorrow: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
};

export function MonitorQueue({ overdue, today, tomorrow, heroId, onSelect }: Props) {
  if (overdue.length === 0 && today.length === 0 && tomorrow.length === 0) {
    return (
      <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "12px 4px" }}>
        Na tomhle stroji není dnes ani zítra nic naplánováno.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", minHeight: 0 }}>
      {/* NEDODĚLÁNO jde NAHORU: fronta se pak čte chronologicky shora dolů. */}
      <QueueSection title="Nedoděláno" blocks={overdue} heroId={heroId} onSelect={onSelect} tone="warning" showDate />
      <QueueSection title="Dnes" blocks={today} heroId={heroId} onSelect={onSelect} />
      <QueueSection title="Zítra" blocks={tomorrow} heroId={heroId} onSelect={onSelect} />
    </div>
  );
}
```

> **Proč `overdue` v early returnu:** bez něj by hláška „není dnes ani zítra nic naplánováno" přebila celou novou sekci přesně v tom stavu, kdy je nejpotřebnější — stroj bez plánu na dnešek a nedodělek pár dní zpátky (středa po svátcích ze zadání).

- [ ] **Krok 2: Rozšiř `QueueSection` o `tone` a `showDate`**

Uprav podpis a nadpis sekce:

```typescript
function QueueSection({
  title, blocks, heroId, onSelect, tone = "muted", showDate = false,
}: {
  title: string;
  blocks: Block[];
  heroId: number | null;
  onSelect: (block: Block) => void;
  /** `warning` odliší nedodělané od běžné fronty — jediný barevný rozdíl. */
  tone?: "muted" | "warning";
  /** Řádek ukáže i den, ne jen čas. Povinné u zakázek z minulých dnů. */
  showDate?: boolean;
}) {
  if (blocks.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
      <div style={{
        fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase",
        color: tone === "warning" ? "var(--warning)" : "var(--text-muted)", fontWeight: 700,
      }}>
        {title}
      </div>
```

- [ ] **Krok 3: Ukaž na řádku den, ne jen čas**

V těle `blocks.map(...)` nahraď výpis času. Původní řádek:

```tsx
              <span style={{
                flexShrink: 0,
                color: "var(--text-muted)", fontSize: 13,
                fontVariantNumeric: "tabular-nums",
              }}>
                {formatPragueTime(new Date(b.startTime))}
              </span>
```

Nahraď za:

```tsx
              {/* U nedodělaných musí být vidět DEN, jinak řádek vypadá jako dnešní
                  zakázka. Den v týdnu tam patří — tiskař myslí ve směnách, ne
                  v datech. `formatPragueDateTimeWithWeekday` dá „pá 9. 8. 22:00". */}
              <span style={{
                flexShrink: 0,
                color: "var(--text-muted)", fontSize: 13,
                fontVariantNumeric: "tabular-nums",
              }}>
                {showDate
                  ? formatPragueDateTimeWithWeekday(new Date(b.startTime))
                  : formatPragueTime(new Date(b.startTime))}
              </span>
```

Uprav import na začátku souboru:

```typescript
import { formatPragueTime, formatPragueDateTimeWithWeekday } from "@/lib/dateUtils";
```

- [ ] **Krok 4: Ověř typovou kontrolu**

```bash
npx tsc --noEmit
```

Očekávej: chybu v `MonitorView.tsx` (nepředává `overdue`). To je správně — spraví to Task 3. Žádná jiná chyba být nesmí.

- [ ] **Krok 5: Commit**

```bash
git add src/components/monitor/MonitorQueue.tsx
git commit -m "feat(monitor): sekce NEDODĚLÁNO ve frontě, s dnem v týdnu na řádku"
```

---

### Task 3: Propojení Monitoru + prázdná karta nesmí lhát

**Soubory:**
- Upravit: `src/components/monitor/MonitorView.tsx`

**Rozhraní:**
- Konzumuje: `monitorQueue` (Task 1), `MonitorQueue` prop `overdue` (Task 2)
- Produkuje: nic nového navenek

- [ ] **Krok 1: Oprav fallback fronty**

Najdi řádek:

```typescript
  const queue = now ? monitorQueue(blocks, viewMachine, now) : { today: [], tomorrow: [] };
```

Nahraď:

```typescript
  const queue = now ? monitorQueue(blocks, viewMachine, now) : { overdue: [], today: [], tomorrow: [] };
```

- [ ] **Krok 2: Předej `overdue` do fronty**

Najdi `<MonitorQueue` a doplň prop:

```tsx
          <MonitorQueue
            overdue={queue.overdue}
            today={queue.today}
            tomorrow={queue.tomorrow}
            heroId={card?.block.id ?? null}
            onSelect={(block) => setSelectedId(block.id)}
          />
```

- [ ] **Krok 3: Oprav hlášku prázdné karty**

Když na stroji na dnešek nic není, `pickHeroBlock` vrátí `null` a karta dnes hlásí „Na tomhle stroji nic naplánováno." — i když dole visí nedodělek. Ve scénáři ze zadání (středa po dvou svátcích) je to pravděpodobný stav.

Najdi blok s tou hláškou (větev `) : (` za `{card && now ? (`) a nahraď její obsah:

```tsx
              {/* Dokud neběží čas (server render a první snímek v prohlížeči), nevíme,
                  co má být na kartě — hlásit „nic naplánováno" by v tu chvíli lhalo. */}
              {!now
                ? ""
                : queue.overdue.length > 0
                ? "Na dnešek nic naplánováno. Vpravo čekají nedodělané zakázky."
                : "Na tomhle stroji nic naplánováno."}
```

- [ ] **Krok 4: Ověř typovou kontrolu a build**

```bash
npx tsc --noEmit && npm run build
```

Očekávej: obojí čisté. (Build shodí běžící dev server — je to očekávané.)

- [ ] **Krok 5: Ověř proklikem**

```bash
npx tsx prisma/seed-monitor.ts   # testovací data pro Monitor (dev only)
npm run dev
```

Přihlas se jako `tiskar/tiskar` a na `/` ověř: sekce „NEDODĚLÁNO" je nahoře ve frontě, žlutý nadpis, na řádku je den v týdnu a datum. Když na stroji nejsou dnešní zakázky, levá karta ukazuje na sekci místo „nic naplánováno".

> Když seed nevyrobí nedodělanou zakázku v minulosti, vyrob si ji ručně: v plánu jako ADMIN přetáhni zakázku na včerejšek a neodklepávej ji.

- [ ] **Krok 6: Commit**

```bash
git add src/components/monitor/MonitorView.tsx
git commit -m "feat(monitor): fronta ukazuje nedodělané, prázdná karta na ně odkáže"
```

---

### Task 4: Datum na velké kartě u přetahující zakázky

**Soubory:**
- Upravit: `src/components/monitor/MonitorView.tsx` (funkce `HeroTiming` na konci souboru)

**Rozhraní:**
- Konzumuje: `startDayLabel` z `@/lib/monitorView` (už importované v souboru)
- Produkuje: nic nového navenek

**Proč:** `HeroTiming` dnes pro `reason === "overdue"` kreslí jen `22:00 ▬▬ 06:00` a „Přetahuje o 84 h". **Nikde není, ze kterého dne zakázka je.** Tiskař, který si vytáhne starou zakázku ze sekce nebo z hledání, tak nemá jak poznat, že nekliká na dnešní — a odklepne špatnou.

- [ ] **Krok 1: Doplň datum do běhové větve `HeroTiming`**

Ve funkci `HeroTiming` najdi `return` na konci (větev pro `running`/`overdue`) a nahraď ho:

```tsx
  // Datum se ukáže jen tehdy, když zakázka nezačala dnes (`startDayLabel`
  // vrací pro dnešek `null`). U běžné směny tedy nepřibude nic; u zakázky
  // vytažené ze sekce NEDODĚLÁNO nebo z hledání je to jediné místo, kde se
  // tiskař dozví, že kouká na jiný den.
  const dayLabel = startDayLabel(block.startTime, now);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {dayLabel && (
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--warning)" }}>
          {dayLabel}
        </div>
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        fontSize: 16, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums",
      }}>
        <span>{formatPragueTime(new Date(block.startTime))}</span>
        <span style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--surface-3)", overflow: "hidden" }}>
          <span style={{
            display: "block", height: "100%", width: `${percent}%`,
            background: reason === "overdue" ? "var(--warning)" : "var(--success)",
          }} />
        </span>
        <span>{formatPragueTime(new Date(block.endTime))}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
        {remainingMinutes >= 0
          ? `Zbývá ${formatMinutes(remainingMinutes)}`
          : `Přetahuje o ${formatMinutes(-remainingMinutes)}`}
      </div>
    </div>
  );
```

- [ ] **Krok 2: Ověř**

```bash
npx tsc --noEmit && npm run build
```

Očekávej: čisté. Pak v běžící aplikaci klikni na řádek v sekci NEDODĚLÁNO — na velké kartě musí nad časovou osou přibýt žlutý popisek dne (např. „7. 08."), kicker je „PŘETAHUJE" a tlačítko HOTOVO jde zmáčknout.

- [ ] **Krok 3: Commit**

```bash
git add src/components/monitor/MonitorView.tsx
git commit -m "fix(monitor): velká karta u přetahující zakázky ukáže den"
```

---

### Task 5: „Najít" ústí na Monitor, ne do plánu

**Soubory:**
- Upravit: `src/components/monitor/MonitorView.tsx`
- Upravit: `src/app/_components/PlannerPage.tsx`

**Rozhraní:**
- Produkuje: `MonitorView` přijímá dvě nové volitelné props:
  - `focusBlockId?: number | null`
  - `onFocusHandled?: () => void`

**Proč:** dnes je klik na výsledek hledání u tiskaře **slepá ulička**. `jumpToBlockFromMonitor` přepne do plánu, jenže tiskař má `effectiveDaysBack` napevno 1, `TimelineGrid` blok mimo rozsah vůbec nevykreslí a `BlockDetail` je za `{canEdit && …}`. Klikne — a nestane se nic.

Ruční výběr **žádné 14denní okno nezná** (`resolveSelectedBlock` nemá časovou mez, `reasonForBlock` záměrně nezná 16h okno), takže přes „Najít" jde odklepnout i zakázka půl roku stará.

- [ ] **Krok 1: Přidej props do `MonitorView`**

Do typu `Props` doplň:

```typescript
  /** Zakázka, kterou má Monitor vytáhnout na velkou kartu (klik ve vyhledávání). */
  focusBlockId?: number | null;
  /** Zavolá se, jakmile Monitor požadavek spotřebuje — jednorázový příkaz. */
  onFocusHandled?: () => void;
```

A do destrukturalizace parametrů:

```typescript
export function MonitorView({
  blocks, viewMachine, ownMachine,
  onPrintComplete, onOpenPlan, onOpenSearch, onMachineChange, onLogout,
  focusBlockId, onFocusHandled,
}: Props) {
```

- [ ] **Krok 2: Přidej efekt — POZOR NA POŘADÍ**

Efekt musí být deklarovaný **až za** efektem `useEffect(..., [viewMachine])`, který maže `selectedId`. Najdi ten efekt (končí `}, [viewMachine]);`) a **hned za něj** vlož:

```typescript
  // Jednorázový příkaz zvenčí: „dej tuhle zakázku na velkou kartu".
  //
  // MUSÍ být deklarovaný ZA efektem `[viewMachine]` výš. React spouští efekty
  // v pořadí deklarace a ten úklidový efekt běží I PŘI MOUNTU — dřív deklarovaný
  // focus by si tedy sám přepsal výběr na null, kdykoli hledání zároveň přepnulo
  // stroj (a při návratu z plánu na Monitor vždycky).
  //
  // Druhá podmínka je na straně volajícího: `setViewMachine` a `setFocusBlockId`
  // musí padnout v TÉMŽE handleru, aby je React zbatchoval. Jinak by tenhle
  // render proběhl ještě se starým strojem, `resolveSelectedBlock` by blok odmítl
  // pro neshodu stroje a úklidový efekt `[selectedId, selected]` by výběr smazal.
  useEffect(() => {
    if (focusBlockId == null) return;
    setSelectedId(focusBlockId);
    setStickyId(null);
    setConfirmingId(null);
    setConfirmingRevertId(null);
    onFocusHandled?.();
  }, [focusBlockId, onFocusHandled]);
```

- [ ] **Krok 3: Přidej stav a předej props v `PlannerPage`**

Vedle ostatních tiskařských stavů (u `const [tiskarView, setTiskarView] = useState<"monitor" | "plan">("monitor");`) přidej:

```typescript
  // Jednorázový příkaz pro Monitor — „vytáhni tuhle zakázku na velkou kartu".
  // Monitor si ho po zpracování sám vynuluje přes onFocusHandled.
  const [monitorFocusId, setMonitorFocusId] = useState<number | null>(null);
```

U `<MonitorView` doplň:

```tsx
          focusBlockId={monitorFocusId}
          onFocusHandled={() => setMonitorFocusId(null)}
```

- [ ] **Krok 4: Přesměruj výsledek hledání**

Najdi `<OrderSearchSheet` a nahraď handler `onSelect`:

```tsx
        <OrderSearchSheet
          open={searchSheetOpen}
          allBlocks={blocks}
          onSelect={(block) => {
            setSearchSheetOpen(false);
            // ZAKÁZKA míří na velkou kartu Monitoru. Skok do plánu je pro tiskaře
            // slepá ulička: rozsah má napevno 1 den zpět, TimelineGrid blok mimo
            // rozsah nevykreslí a BlockDetail je za `canEdit`. Rezervace a údržba
            // jdou do plánu dál — `resolveSelectedBlock` je na kartu nepustí
            // a tiskař je stejně neodklepává.
            if (block.type !== "ZAKAZKA") {
              jumpToBlockFromMonitor(block);
              return;
            }
            // Obojí v jednom handleru, ať to React zbatchuje — jinak Monitor
            // renderuje ještě se starým strojem a výběr se zahodí.
            if (block.machine !== viewMachine) setViewMachine(block.machine);
            setTiskarView("monitor");
            setMonitorFocusId(block.id);
          }}
          onClose={() => setSearchSheetOpen(false)}
        />
```

- [ ] **Krok 5: Oprav zastaralý komentář nad `jumpToBlockFromMonitor`**

Komentář nad tou funkcí dnes tvrdí, že je sdílená i pro klik na řádek v Monitoru
(`MonitorQueue`) — **to je nepravda**, `MonitorQueue.onSelect` volá `setSelectedId`.
Po tomhle tasku navíc přestává být hlavní cestou i pro vyhledávání. Nahraď ho:

```typescript
  // Skok do PLÁNU na konkrétní blok: přepne pohled, případně stroj, vybere blok
  // a doscrolluje na něj (přes odložený mechanismus handleJumpToOutOfRange výše).
  //
  // Po 13. 8. 2026 už tudy NEJDE hlavní cesta z vyhledávání — zakázka míří na
  // velkou kartu Monitoru (viz onSelect u OrderSearchSheet). Zůstávají: rezervace
  // a údržba z vyhledávání, skok na split partnera a procházení výsledků
  // hlavičkového hledání v plánu.
```

- [ ] **Krok 6: Ověř typovou kontrolu, build a celou suite**

```bash
npx tsc --noEmit && npm run build && \
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávej: tsc a build čisté, **1049 testů, 0 selhání**.

- [ ] **Krok 7: Ověř proklikem — tohle je nejrizikovější task**

V běžící aplikaci jako `tiskar/tiskar` na `/` projdi VŠECHNY čtyři případy:

1. **Zakázka na vlastním stroji** — „🔍 Najít", napiš číslo, klikni. Musí zůstat na Monitoru, zakázka je na velké kartě s kickerem „PŘETAHUJE", tlačítko HOTOVO funguje.
2. **Zakázka na CIZÍM stroji** — Monitor se přepne na ten stroj, zakázka je na kartě, místo tlačítek je hláška „Odklepnout jde jen na vlastním stroji."
3. **Už odklepnutá zakázka** — na kartě je „✓ ODKLEPNUTO" a tlačítka Vrátit / Další →.
4. **Rezervace nebo údržba** — pořád skočí do plánu (staré chování).


Pak ověř, že se výběr **drží**: po kliknutí ve vyhledávání ručně přepni stroj přepínačem — výběr se má zahodit a karta se vrátit na automatiku. To je správné chování, ne vada.

- [ ] **Krok 8: Commit**

```bash
git add src/components/monitor/MonitorView.tsx src/app/_components/PlannerPage.tsx
git commit -m "fix(monitor): Najít ústí na velkou kartu místo do slepé uličky v plánu"
```

---

### Task 6: Dokumentace

**Soubory:**
- Upravit: `CLAUDE.md` (sekce „Klíčové soubory (index)" → **Planner**)
- Upravit: `docs/vyvoj-historie.md`
- Upravit: `docs/superpowers/specs/2026-08-12-monitor-nedodelane-zakazky-design.md` (stav)

CLAUDE.md v hlavičce žádá: „Změny konvencí commituj ve stejném PR, co je vyvolal."

- [ ] **Krok 1: Doplň oddíl do `docs/vyvoj-historie.md`**

Vlož nový oddíl nad `## Dva stupně zpoždění + hledání v DTP přehledu (12.–13. 8. 2026)`:

```markdown
## Nedodělané zakázky na Monitoru tiskaře (13. 8. 2026)

Připomínka plánovače: „Když v pátek večer nestihnout vytisknout zakázku, o víkendu
se tisknout nebude a v pondělí a úterý bude svátek, uvidí tiskaři, jakou zakázkou
mají ve středu začít?" Neuvidí — čtyři nezávislé brány: 16h okno hero karty,
fronta jen dnes+zítra podle dne startu, plán s rozsahem 1 den zpět, a „Najít",
které zakázku najde, ale klik nevede nikam.

**Řešení:** sekce „NEDODĚLÁNO" ve frontě (`monitorQueue().overdue`, 14 dní zpět)
jako hlavní cesta + „Najít" ústící na velkou kartu Monitoru jako neomezená
záložní cesta. Nic se nepřeplánovává, žádná notifikace (rozhodnutí majitele).

### Klíčová rozhodnutí

- **Rozhoduje `endTime`, ne `startTime`.** Noční směna 22:00–6:00 začala včera,
  ale končí dnes — podle startu by spadla do NEDODĚLÁNO, i když právě běží na
  velké kartě. Táž volba, na které stojí 16h okno.
- **14denní strop je pojistka, ne pohodlí.** Sekci nic neuklidí a `Block` řádky
  se v projektu nikdy nemažou (jediný retenční skript maže `BlockRevision`).
- **NEPOUŽÍVÁ se `overdueAlarmState(...) === "stale"`**, ačkoli se to nabízí:
  odpovídá na jinou otázku (16 h = „je to akutní") a udělalo by dvouhodinovou
  slepou skvrnu — zakázka stará 14 h by při běžícím jiném bloku nebyla ani na
  kartě, ani v sekci.
- **POZASTAVENO se vylučuje** — plán ji z „po termínu" taky vylučuje. Je to
  výrobní stopka, ne zpoždění; jinak by obě obrazovky tvrdily opak.
- **Ruční výběr žádné okno nezná**, takže přes „Najít" jde odklepnout i zakázka
  půl roku stará. Server nebrání — `complete` route nemá časovou kontrolu.

### Gotchy

- **Efekt pro `focusBlockId` musí být deklarovaný ZA efektem `[viewMachine]`**,
  který maže `selectedId`. React spouští efekty v pořadí deklarace a ten úklid
  běží i při mountu.
- **`setViewMachine` a `setFocusBlockId` musí padnout v témže handleru**, aby je
  React zbatchoval — jinak `resolveSelectedBlock` blok odmítne pro neshodu stroje.
- **Early return v `MonitorQueue` musel zahrnout `overdue`** — jinak by hláška
  „není dnes ani zítra nic naplánováno" přebila sekci právě ve stavu, kdy je
  nejpotřebnější.

### Známá omezení

- **`printCompletedAt` je čas KLIKNUTÍ, ne tisku.** Zakázka z minulého týdne
  odklepnutá ve středu dostane razítko středy, takže `computeThroughput`
  a `computeAvgLeadTimeDays` (`reportMetrics.ts`) vykážou průtok ve špatném
  období. Featura to zkreslení zvětšuje. **Rozhodnutí Vojty: známé omezení,
  do reportů se nesahá.**
- **Odklepnutí není neutrální akce** — vytištěný blok se stává zdí pro chain
  push, nejde přepočítat ani rozdělit a mizí z detekce driftu.
- **Zakázky starší než 14 dní** jsou dosažitelné pouze přes „Najít".
- **Osiřelá půlka rozdělené zakázky** na druhém stroji se v sekci neobjeví —
  server odklepnutí na cizím stroji zakazuje. Sekce je striktně per-stroj.
```

- [ ] **Krok 2: Doplň `CLAUDE.md`**

V sekci „Klíčové soubory (index)" → **Planner** za `src/components/planner/ProductionTagsRow.tsx` doplň:

```
· `src/lib/monitorView.ts` (pravidla Monitoru u stroje — `pickHeroBlock`, `monitorQueue` včetně sekce nedodělaných, `UNFINISHED_LOOKBACK_DAYS`)
```

- [ ] **Krok 3: Označ spec jako realizovaný**

V `docs/superpowers/specs/2026-08-12-monitor-nedodelane-zakazky-design.md` uprav hlavičku:

```markdown
Datum: 12. 8. 2026 · Stav: REALIZOVÁNO 13. 8. 2026 (plán `docs/superpowers/plans/2026-08-13-monitor-nedodelane-zakazky.md`)
```

- [ ] **Krok 4: Commit**

```bash
git add CLAUDE.md docs/vyvoj-historie.md docs/superpowers/specs/2026-08-12-monitor-nedodelane-zakazky-design.md
git commit -m "docs: nedodělané zakázky na Monitoru — rozhodnutí, gotchy a známá omezení"
```

---

## Co plán ze specu vědomě NEDĚLÁ

**`useMemo` kolem `monitorQueue`** (spec §4.3, uvedeno jako „doporučené").
Vynecháno záměrně. `monitorQueue` je pár průchodů polem — nad ~1000 bloky řádově
tisíce operací jednou za 15 sekund, tedy neměřitelné. Skutečný náklad tiku je
překreslení řádků fronty, a ten by `useMemo` nad výsledkem **neodstranil**:
`MonitorQueue` ani její řádky nejsou memoizované, takže se překreslí tak jako tak.
Přínos by byl nulový a cena reálná — memo by potřebovalo `dayKey` (civilní pražský
den, ne `now`, jinak by nikdy netrefilo), což je další místo, kde se dá splést
datumová logika.

**Kdyby se Monitor začal sekat**, správné pořadí kroků je: nejdřív změřit, pak
memoizovat `MonitorQueue`/řádky přes `React.memo`, a teprve nakonec `useMemo` nad
výpočtem. Rozhodnutí zapsat sem, ne to udělat naslepo.

**Tři testy napojení „Najít" ze spec §8** — „klik na výsledek z jiného stroje
přepne stroj a blok se objeví na kartě", „odklepnutá zakázka z minula jde přes
„Najít" vytáhnout a Vrátit", „rezervace jde dál do plánu". Vynechány záměrně,
ne přehlédnutím: pokrývají `MonitorView`/`PlannerPage`, tedy React komponenty
s efekty a stavem, a repo na render-testy komponent nemá harness — jediný test
v `src/app/_components/` je `useUndoManager.test.ts`, a ten testuje čistý hook,
ne vykreslenou komponentu. Napsat je by znamenalo napřed postavit testovací
infrastrukturu (React Testing Library nebo obdobu), což je mimo rozsah týhle
opravné vlny.

Krytí místo toho leží na ručním prokliku. **Ten proklik proběhl** (Playwright,
účet `tiskar`, stroj `XL_105`, review 13. 8. 2026) přes všechny čtyři scénáře
z Kroku 7 Tasku 5 výš — tři z nich jsou přesně tyhle testy ze spec §8 (cizí
stroj, odklepnutá zakázka z minula + Vrátit, rezervace do plánu), čtvrtý
(zakázka na vlastním stroji) plán žádal navíc. Všechny čtyři prošly.

## Před nasazením

1. **Celá suite + build:**
   ```bash
   node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
   npm run build && npm run lint
   ```
   Očekávej 1049 testů / 0 selhání, build čistý, lint 0 chyb.

2. **Multi-agent review před commitem** — změna mění chování dvou obrazovek, ne kosmetiku (viz `feedback_review_diferencovane`).

3. **Zeptej se Vojty: rovnou na produkci, nebo nejdřív na testovací instanci pro Lukáše?** (port 3021, DB `igvyroba_test`, PM2 `planovani-TEST`). Tahle otázka se klade před KAŽDÝM nasazením.

4. **Deploy diktovat doslova podle `docs/DEPLOY_WORKFLOW.md`.** Bez migrací — featura je čistě klientská. Povinný PRE/POST otisk dat (počet bloků + `sum_secs`).
