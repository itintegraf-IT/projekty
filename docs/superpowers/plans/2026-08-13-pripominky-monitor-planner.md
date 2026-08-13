# Připomínky Monitor + plánovač — implementační plán

> **Pro agentní pracovníky:** POVINNÁ SUB-SKILL: použij superpowers:subagent-driven-development
> nebo superpowers:executing-plans. Kroky mají checkbox (`- [ ]`) syntax.

**Cíl:** Zpřístupnit tiskaři všechny nedodělané zakázky, zabránit tomu, aby mu
karta sama odskočila na další zakázku, přesunout hover bublinu mimo sousední
stroj a konečně zapojit rušení hledání klikem do plánu.

**Architektura:** Čtyři nezávislé úpravy. Logika výběru zakázky na kartu je
čistá funkce v `src/lib/monitorView.ts` (pokrytá unit testy); React vrstva
(`MonitorView`, `MonitorQueue`, `BlockCard`, `PlannerPage`, `TimelineGrid`) na ní
jen staví.

**Spec:** `docs/superpowers/specs/2026-08-13-monitor-a-planner-pripominky-design.md`

**Tech stack:** Next.js 16 · React · TypeScript · Tailwind v4 · node:test + tsx

## Global Constraints

- Barvy a rozměry **výhradně přes CSS tokeny** z `globals.css` (`--warning`,
  `--text-muted`, `--surface`, `--success`, `--border`, `--brand`,
  `--brand-contrast`). Žádný hex ani rgba literál v komponentě — rozbíjí light mode.
- Z-index výhradně přes `src/lib/zLayers.ts`.
- **`OVERDUE_WINDOW_MS` se nesmí změnit** — sdílí ho červený alarm v plánu
  (`overdueState.ts`). Hero karta dostane vlastní pravidlo.
- Mouse handlery začínají `if (e.button !== 0) return;`.
- Datum vždy přes helpery z `src/lib/dateUtils.ts` (`utcToPragueDateStr`,
  `addDaysToCivilDate`, `pragueToUTC`). **Nikdy** aritmetika 24×3600×1000 —
  rozbije se na přechodu letního času.
- Testy: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
- Před commitem `npm run build` (chytí TS chyby dřív než server).
- Komentář smí tvrdit jen to, co kód dělá. Tento plán opravuje dva komentáře,
  které lhaly — nepřidávat další.

---

### Task 1: Fronta ukáže všechny nedodělané, zúženým řádkem

**Files:**
- Modify: `src/components/monitor/MonitorQueue.tsx`

**Interfaces:**
- Consumes: `Block` z `@/app/_components/TimelineGrid`, `formatPragueDateTimeWithWeekday`
- Produces: `MonitorQueue` beze změny props (`overdue`/`today`/`tomorrow`/`heroId`/`onSelect`)

Zúžený řádek platí **jen** pro sekci NEDODĚLÁNO. Dnes/Zítra zůstávají beze změny.

- [ ] **Krok 1: Zrušit strop**

Smaž konstantu `OVERDUE_VISIBLE_COUNT` i s jejím komentářem, výpočet
`visibleOverdue`/`hiddenOverdueCount`, prop `hiddenCount` v `QueueSection`
i blok, který vykresluje řádek „…a dalších X starších“.

`MonitorQueue` pak předá `blocks={overdue}` přímo. Podmínku
`if (blocks.length === 0 && hiddenCount === 0) return null;` zjednoduš na
`if (blocks.length === 0) return null;`.

- [ ] **Krok 2: Přidat prop `compact` do `QueueSection`**

```typescript
  /** Zúžený řádek: jen číslo, popis a čas. Bez pásu specifikace a bez chipů.
   *  Sekce NEDODĚLÁNO umí mít i deset položek (ostrá data 12. 8. 2026: XL 106
   *  jich má devět) a v plném tvaru by zatlačila nadpis „DNES" pod okraj
   *  obrazovky. Detaily tiskař dostane kliknutím — vyjede velká karta. */
  compact?: boolean;
```

Do signatury `QueueSection` přidej `compact = false`. Volání v `MonitorQueue`:

```tsx
      <QueueSection
        title="Nedoděláno"
        blocks={overdue}
        heroId={heroId}
        onSelect={onSelect}
        tone="warning"
        showDate
        compact
      />
```

- [ ] **Krok 3: Zúžit řádek**

V `blocks.map` uprav tlačítko tak, aby při `compact`:
- `padding` bylo `"7px 12px"` místo `"10px 12px"`
- `gap` bylo `0` místo `7`
- **nevykreslil se** amber pás specifikace ani `<MonitorChips>`

Podmínky pásu i chipů obal `!compact &&`. Zbytek (číslo, popis, čas, ztlumení
odklepnutých, zvýraznění hero, `flexShrink: 0`) zůstává.

Písmo v compact řádku zmenši o stupeň, ať je rozdíl proti dnešní frontě čitelný
na první pohled: číslo `13` (místo 14), popis `12` (místo 13), čas `12` (místo 13).

- [ ] **Krok 4: Ověřit build a testy**

Run: `npm run build`
Expected: projde bez chyb.

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: všechny testy zelené (`MonitorQueue` unit testy nemá — je to React
vrstva; `monitorView.test.ts` se tímto úkolem nemění).

- [ ] **Krok 5: Commit**

```bash
git add src/components/monitor/MonitorQueue.tsx
git commit -m "fix(monitor): sekce NEDODĚLÁNO ukáže všechny zakázky zúženým řádkem"
```

---

### Task 2: Přetahující zakázka přebije nově začínající

**Files:**
- Modify: `src/lib/monitorView.ts`
- Modify: `src/lib/monitorView.test.ts`
- Modify: `src/components/monitor/MonitorView.tsx`

**Interfaces:**
- Produces: `pickHeroBlock(blocks, machine, now, skippedIds?: ReadonlySet<number>): HeroPick`
  — čtvrtý parametr je volitelný, aby stávající testy a případní další volající
  nespadli. Jediný produkční volající je `MonitorView`.
- Produces: `unfinishedFloorMs(now: Date): number` — spodní hranice okna
  nedodělaných, sdílená `pickHeroBlock` i `monitorQueue`.

- [ ] **Krok 1: Napsat padající testy**

Do `src/lib/monitorView.test.ts` přidej (drž se stylu okolních testů — jak
staví `Block`, tak stav ponech):

```typescript
test("pickHeroBlock: přetahující neodklepnutá přebije nově začínající", () => {
  const now = new Date("2026-08-13T12:30:00.000Z");
  const blocks = [
    mkBlock({ id: 1, startTime: "2026-08-13T04:00:00.000Z", endTime: "2026-08-13T12:00:00.000Z" }),
    mkBlock({ id: 2, startTime: "2026-08-13T12:00:00.000Z", endTime: "2026-08-13T20:00:00.000Z" }),
  ];
  const pick = pickHeroBlock(blocks, "XL_105", now);
  assert.equal(pick?.block.id, 1);
  assert.equal(pick?.reason, "overdue");
});

test("pickHeroBlock: z několika přetahujících vyhraje ta, co skončila nejpozději", () => {
  const now = new Date("2026-08-13T12:30:00.000Z");
  const blocks = [
    mkBlock({ id: 1, startTime: "2026-08-12T04:00:00.000Z", endTime: "2026-08-12T12:00:00.000Z" }),
    mkBlock({ id: 2, startTime: "2026-08-13T04:00:00.000Z", endTime: "2026-08-13T12:00:00.000Z" }),
  ];
  assert.equal(pickHeroBlock(blocks, "XL_105", now)?.block.id, 2);
});

test("pickHeroBlock: přetahující drží kartu i po 16 h (žádné OVERDUE_WINDOW_MS)", () => {
  // Konec + 20 h. Do 13. 8. 2026 by tuhle zakázku výběr zahodil a karta by
  // odskočila na běžící blok — právě to je opravovaná vada.
  const now = new Date("2026-08-14T08:00:00.000Z");
  const blocks = [
    mkBlock({ id: 1, startTime: "2026-08-13T04:00:00.000Z", endTime: "2026-08-13T12:00:00.000Z" }),
    mkBlock({ id: 2, startTime: "2026-08-14T04:00:00.000Z", endTime: "2026-08-14T20:00:00.000Z" }),
  ];
  assert.equal(pickHeroBlock(blocks, "XL_105", now)?.block.id, 1);
});

test("pickHeroBlock: přeskočená zakázka se na kartu nevrátí", () => {
  const now = new Date("2026-08-13T12:30:00.000Z");
  const blocks = [
    mkBlock({ id: 1, startTime: "2026-08-13T04:00:00.000Z", endTime: "2026-08-13T12:00:00.000Z" }),
    mkBlock({ id: 2, startTime: "2026-08-13T12:00:00.000Z", endTime: "2026-08-13T20:00:00.000Z" }),
  ];
  const pick = pickHeroBlock(blocks, "XL_105", now, new Set([1]));
  assert.equal(pick?.block.id, 2);
  assert.equal(pick?.reason, "running");
});

test("pickHeroBlock: zakázka starší než okno nedodělaných se na kartu nevrátí", () => {
  const now = new Date("2026-08-13T12:30:00.000Z");
  const blocks = [
    mkBlock({ id: 1, startTime: "2026-07-20T04:00:00.000Z", endTime: "2026-07-20T12:00:00.000Z" }),
  ];
  assert.equal(pickHeroBlock(blocks, "XL_105", now), null);
});

test("pickHeroBlock: hranice okna nedodělaných je přesná na milisekundu", () => {
  // Podlaha = pražská půlnoc dne (dnes − 14). Blok končící přesně na ní projde,
  // blok o milisekundu dřív ne. Bez tohohle testu projde i posun podlahy o dny.
  const now = new Date("2026-08-13T12:30:00.000Z");
  const floor = unfinishedFloorMs(now);
  const onFloor = mkBlock({
    id: 1,
    startTime: new Date(floor - 3_600_000).toISOString(),
    endTime: new Date(floor).toISOString(),
  });
  const belowFloor = mkBlock({
    id: 2,
    startTime: new Date(floor - 3_600_001).toISOString(),
    endTime: new Date(floor - 1).toISOString(),
  });
  assert.equal(pickHeroBlock([onFloor], "XL_105", now)?.block.id, 1);
  assert.equal(pickHeroBlock([belowFloor], "XL_105", now), null);
});
```

Pokud v souboru pomocník `mkBlock` neexistuje, použij tentýž způsob stavby
bloku, jaký používají stávající testy v souboru — **nezaváděj druhý styl**.

- [ ] **Krok 2: Spustit testy, ověřit že padají**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: FAIL — nové testy padají (`unfinishedFloorMs` neexistuje, priorita je
opačná, čtvrtý parametr se ignoruje).

- [ ] **Krok 3: Vytáhnout podlahu okna do sdílené funkce**

V `src/lib/monitorView.ts`, hned pod `UNFINISHED_LOOKBACK_DAYS`:

```typescript
/**
 * Spodní hranice okna nedodělaných zakázek — pražská půlnoc dne
 * `dnes − UNFINISHED_LOOKBACK_DAYS`.
 *
 * Sdílí ji fronta (`monitorQueue`) i velká karta (`pickHeroBlock`), aby se
 * nemohly rozejít: zakázka, kterou karta drží, musí být dohledatelná i ve
 * frontě, a naopak. Počítá se z CIVILNÍCH pražských dnů, ne odečtením
 * 14×24 h — jinak by se okno posunulo o hodinu na přechodu letního času.
 */
export function unfinishedFloorMs(now: Date): number {
  const todayStr = utcToPragueDateStr(now);
  return pragueToUTC(addDaysToCivilDate(todayStr, -UNFINISHED_LOOKBACK_DAYS), 0, 0).getTime();
}
```

V `monitorQueue` nahraď stávající výpočet `floorMs` voláním `unfinishedFloorMs(now)`.
Konstanta `UNFINISHED_LOOKBACK_DAYS` musí být deklarovaná **nad** funkcí.

- [ ] **Krok 4: Prohodit prioritu v `pickHeroBlock`**

Nahraď tělo funkce (včetně doc komentáře) tímto:

```typescript
/**
 * Zakázka na velkou kartu Monitoru, s důvodem výběru. Priorita:
 *  1. `overdue`  — zakázce vypršel čas, nikdo ji neodklepl a tiskař ji
 *                  nepřeskočil. Z několika vyhrává ta, která skončila
 *                  NEJPOZDĚJI — to je ta, kterou má tiskař rozdělanou.
 *  2. `running`  — je uvnitř svého času,
 *  3. `upcoming` — jinak nejbližší budoucí.
 *
 * `overdue` je záměrně PŘED `running` (13. 8. 2026). Do té doby přebíjel běh
 * podle plánu, takže v okamžiku, kdy začal následující blok, karta odskočila —
 * i když tiskař pořád tiskl tu předchozí, a zmizelo mu i tlačítko HOTOVO.
 *
 * Šestnáctihodinové okno tu ZÁMĚRNĚ NENÍ: karta drží zakázku, dokud tiskař
 * nedá HOTOVO nebo „Přeskočit →". `OVERDUE_WINDOW_MS` zůstává vyhrazené
 * červenému alarmu v plánu — kdo ho sem vrátí, obnoví opravenou vadu.
 * Jediná mez je `unfinishedFloorMs`, sdílená s frontou: bez ní by na kartě
 * navěky seděl blok, který v datech leží od loňska.
 *
 * `skippedIds` jsou zakázky, které tiskař u tohoto stroje vědomě odsunul.
 * Zůstávají ve frontě v sekci NEDODĚLÁNO, jen nesmí zpátky na kartu.
 */
export function pickHeroBlock(
  blocks: Block[],
  machine: string,
  now: Date,
  skippedIds?: ReadonlySet<number>
): HeroPick {
  const t = now.getTime();
  const floorMs = unfinishedFloorMs(now);
  const open = blocks.filter((b) => isOpenOrder(b, machine));

  const overdue = open
    .filter((b) => {
      if (skippedIds?.has(b.id)) return false;
      const end = new Date(b.endTime).getTime();
      return end <= t && end >= floorMs;
    })
    .sort((a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime());
  if (overdue.length > 0) return { block: overdue[0], reason: "overdue" };

  const running = open
    .filter((b) => new Date(b.startTime).getTime() <= t && t < new Date(b.endTime).getTime())
    .sort(byStartAsc);
  if (running.length > 0) return { block: running[0], reason: "running" };

  const next = pickNextBlock(blocks, machine, now);
  return next ? { block: next, reason: "upcoming" } : null;
}
```

**Uklidit po `OVERDUE_WINDOW_MS`.** Po této změně už ji `pickHeroBlock` nepoužívá:

- **Lokální `import { OVERDUE_WINDOW_MS } from "./overdueState";`** (ř. 29) smaž —
  jinak spadne lint na nepoužitý import.
- **Re-export `export { OVERDUE_WINDOW_MS } from "./overdueState";`** (ř. 28)
  **ponech** — je to pojistka proti tomu, aby si někdo konstantu zkopíroval zpět.
- **Doc komentář nad ním (ř. 15–27) přepiš.** Dnes tvrdí „jak dlouho po svém konci
  smí neodklepnutá zakázka zůstat na velké kartě“ — po této změně to není pravda
  a byla by to přesně ta lež v komentáři, kterou Task 4 jinde opravuje. Nový text:

```typescript
/**
 * Okno, po které v plánu svítí červený alarm zpoždění (`overdueState.ts`).
 *
 * Velká karta Monitoru jím řídit PŘESTALA (13. 8. 2026) — drží zakázku, dokud
 * tiskař nedá HOTOVO nebo „Přeskočit →" (viz `pickHeroBlock`). Konstanta tu
 * zůstává re-exportovaná jako ZÁRUKA, ne z pohodlí: kdyby si ji sem někdo
 * zkopíroval zpátky jako vlastní číslo, plán by červenal jinak dlouho, než by
 * se choval Monitor.
 */
```

- [ ] **Krok 5: Spustit testy**

Run: `node --test --import tsx src/lib/monitorView.test.ts`
Expected: PASS, včetně všech dosavadních testů souboru.

Pokud padne některý **starý** test, který ověřoval, že running přebíjí overdue,
nebo že po 16 h zakázka z karty zmizí — je to test opravované vady. Uprav ho na
nové chování a do jeho těla dopiš jednořádkový komentář proč. **Netestuj kolem
toho** a nesmaž ho bez náhrady.

- [ ] **Krok 6: Přeskočení v `MonitorView` (stav + localStorage)**

V `src/components/monitor/MonitorView.tsx` přidej stav vedle ostatních:

```typescript
  // Zakázky, které tiskař u tohoto stroje vědomě odsunul z karty. Bez omezení
  // by přetahující zakázka držela kartu donekonečna a jediná cesta dál by byla
  // odklepnout ji — tedy zalhat do evidence (`printCompletedAt` je podklad pro
  // reporty). Ve frontě zůstávají v sekci NEDODĚLÁNO.
  //
  // localStorage, ne server: je to vlastnost TÉHLE obrazovky u stroje, ne
  // uživatele. Kiosek se restartuje a bez uložení by po každém restartu
  // naskočila táž zakázka znovu.
  const [skippedIds, setSkippedIds] = useState<ReadonlySet<number>>(new Set());
```

Klíč a načtení (klíč je per stroj — přeskočení na XL 105 se netýká XL 106):

```typescript
  const skipKey = `monitor-skipped:${viewMachine}`;

  // Čte se až po připojení v prohlížeči: komponenta se renderuje i na serveru,
  // kde localStorage není, a rozdílný první snímek by vyvolal hydration error.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(skipKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      setSkippedIds(new Set(Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : []));
    } catch {
      // Poškozený nebo nedostupný localStorage nesmí shodit obrazovku u stroje.
      setSkippedIds(new Set());
    }
  }, [skipKey]);
```

Funkce pro přeskočení:

```typescript
  function skipBlock(id: number) {
    setSkippedIds((cur) => {
      const next = new Set(cur);
      next.add(id);
      try {
        window.localStorage.setItem(skipKey, JSON.stringify([...next]));
      } catch {
        // Zápis smí selhat (plná kvóta, privátní režim) — přeskočení pak
        // platí jen do restartu. Lepší než spadnout.
      }
      return next;
    });
    setSelectedId(null);
  }
```

**Pozor na pořadí efektů.** Efekt `[skipKey]` musí být deklarovaný **za**
úklidovým efektem `[viewMachine]` (ten běží i při mountu a resetuje stavy)
a **před** efektem `focusBlockId`. Stejná past, jakou už komentář u
`focusBlockId` popisuje.

- [ ] **Krok 7: Předat `skippedIds` do výběru**

```typescript
  const liveHero = now ? pickHeroBlock(blocks, viewMachine, now, skippedIds) : null;
```

- [ ] **Krok 8: Tlačítko „Přeskočit →“**

Poslední větev ternárního výrazu (dnes rovnou `<PrintDoneButton … />`, ~ř. 429)
nahraď blokem níž. Element `PrintDoneButton` se **NESMÍ napsat dvakrát** — dvě
kopie se časem rozejdou v props. Vytáhni ho do proměnné a použij ji v obou
větvích:

```tsx
                  ) : (() => {
                    const doneButton = (
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
                          // Musí být synchronně, ne v .then(): PlannerPage označí
                          // zakázku za odklepnutou optimisticky ještě před odpovědí
                          // serveru, takže by karta do té doby ukazovala cizí zakázku.
                          setStickyId(id);
                          const until = Date.now() + 800;
                          setLockUntil(until);
                          setTimeout(() => setLockUntil((cur) => (cur === until ? 0 : cur)), 800);
                          onPrintComplete(id, true)
                            .finally(() => setPendingId((cur) => (cur === id ? null : cur)));
                        }}
                      />
                    );

                    // „Přeskočit →" jen u přetahující zakázky. U běžící ani budoucí
                    // nedává smysl — ta se odsouvat nepotřebuje, karta na ní nedrží.
                    if (card.reason !== "overdue") return doneButton;

                    return (
                      <div style={{ display: "flex", gap: 12, height: 96 }}>
                        {/* `display: flex` + `width: 100%` uvnitř: PrintDoneButton má
                            pevnou výšku 96, ale šířku si sám nenastavuje — bez tohohle
                            by se ve flexu smrsknul na obsah. */}
                        <div style={{ flex: 2, minWidth: 0, display: "flex" }}>
                          {doneButton}
                        </div>
                        <button
                          onClick={(e) => { if (e.button !== 0) return; skipBlock(card.block.id); }}
                          style={{
                            flex: 1, borderRadius: 12,
                            border: "1px solid var(--border)",
                            background: "var(--surface-3)", color: "var(--text)",
                            font: "inherit", fontSize: 18, fontWeight: 700, cursor: "pointer",
                          }}
                        >
                          Přeskočit →
                        </button>
                      </div>
                    );
                  })()}
```

Pokud si `PrintDoneButton` šířku neroztáhne ani tak, přidej mu `width: "100%"`
uvnitř jeho vlastní komponenty **jen tehdy**, když to nerozbije ostatní použití
(`grep -rn "PrintDoneButton" src/`) — jinak řeš obalujícím `<div>`.

- [ ] **Krok 9: Build + celá testovací sada**

Run: `npm run build`
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: build bez chyb, testy zelené.

- [ ] **Krok 10: Commit**

```bash
git add src/lib/monitorView.ts src/lib/monitorView.test.ts src/components/monitor/MonitorView.tsx
git commit -m "fix(monitor): přetahující zakázka drží kartu, dokud tiskař nerozhodne"
```

---

### Task 3: Hover bublina na vnější stranu mřížky

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` (výpočet pozice, ~ř. 1471–1485)

- [ ] **Krok 1: Změnit pravidlo výběru strany**

Nahraď blok od `const spaceRight = …` po `const left = …`:

```typescript
        // Bublina jde VŽDY na vnější stranu mřížky, ne „vpravo, když se vejde".
        // Sloupce strojů leží vedle sebe, takže bublina napravo od bloku v XL 105
        // spolehlivě zakryje celý sloupec XL 106 i se sousedními zakázkami
        // (připomínka tiskařů 13. 8. 2026). Rozhoduje vodorovný střed bloku vůči
        // středu okna, ne počet sloupců — pravidlo platí i kdyby strojů přibylo.
        //
        // Vlevo od levého sloupce je časová osa, kde je jen čas: překryv tam
        // nikoho nestojí informaci.
        const blockCenterX = rect.left + rect.width / 2;
        const placeLeft = blockCenterX < vw / 2;
        const rawLeft = placeLeft ? rect.left - margin - tooltipW : rect.right + margin;
        // Ořez na okraje okna. Když se bublina na vnější stranu nevejde celá,
        // překryje kus VLASTNÍHO sloupce — pořád lepší než zakrýt cizí stroj.
        const left = Math.max(margin, Math.min(rawLeft, vw - tooltipW - margin));
```

Proměnná `showRight` se nikde jinde nepoužívá — smaž ji.

- [ ] **Krok 2: Ověřit build a lint**

Run: `npm run build`
Expected: projde. Pokud lint hlásí nepoužitou proměnnou, odstranil jsi
`showRight` neúplně.

- [ ] **Krok 3: Commit**

```bash
git add src/components/planner/BlockCard.tsx
git commit -m "fix(planner): hover bublina jde na vnější stranu, nezakryje druhý stroj"
```

---

### Task 4: Hledání ruší klik do plánu a Esc

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` (pojistka proti lasu)
- Modify: `src/app/_components/PlannerPage.tsx` (zapojení `clearSearch`, oprava komentářů)

- [ ] **Krok 1: Pojistka proti dotažení lasa**

V `TimelineGrid.tsx` přidej ref vedle `lassoRef` (~ř. 605):

```typescript
  // Čas, kdy doběhlo lasové tažení. Po `mouseup` pošle prohlížeč na sloupec ještě
  // `click` — bez téhle pojistky by tažení přes bloky spustilo `onGridClickEmpty`
  // a smazalo plánovači napsaný dotaz. Ref, ne state: čte se v témže ticku.
  const lassoEndedAtRef = useRef(0);
```

V obsluze `mouseup` (blok `if (lassoRef.current) {` ~ř. 955) nastav razítko
**jen když tažení opravdu proběhlo** — prosté kliknutí do prázdna laso
neaktivuje a hledání rušit má:

```typescript
        if (lassoRef.current.active) lassoEndedAtRef.current = Date.now();
```

Vlož to těsně před `lassoRef.current = null;` (~ř. 981).

V obsluze `onClick` sloupce (~ř. 1855) přeskoč `onGridClickEmpty`, pokud laso
právě doběhlo:

```typescript
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-block]")) return;
                  // 150 ms stačí na `click`, který přijde hned po `mouseup`,
                  // a je pod prahem, kdy by uživatel stihl kliknout znovu.
                  if (Date.now() - lassoEndedAtRef.current > 150) onGridClickEmpty?.();
                  const el = scrollRef.current;
                  …
```

Ostatní chování `onClick` (výpočet `snappedTime`, `onGridClick`) se nemění.

- [ ] **Krok 2: Zapojit `clearSearch` na klik do prázdna**

V `PlannerPage.tsx` (~ř. 3159) nahraď lživý komentář i handler:

```tsx
            // Klik do prázdné plochy plánu ruší hledání — plánovač se jinak musí
            // po každém dotazu trefit do malého křížku, aby se vrátil pohled na
            // všechny zakázky (připomínka 13. 8. 2026). Klik NA blok hledání
            // neruší: procházení shod (`goToMatch`) samo bloky vybírá a rušení by
            // znemožnilo proklikat další shodu. Dotažení lasa je odchycené
            // v TimelineGridu (`lassoEndedAtRef`).
            onGridClickEmpty={() => { setSelectedBlock(null); setEditingBlock(null); clearSearch(); }}
```

`clearSearch` už `setSelectedBlock(null)` volá — duplicitu ponech, ať je handler
čitelný sám o sobě a nezáleží na pořadí.

- [ ] **Krok 3: Zapojit `clearSearch` na Esc**

V obsluze kláves (~ř. 2615) přidej do větve `Escape`:

```typescript
      if (e.key === "Escape") {
        setSelectedBlockIds(new Set());
        // Vyčistit i clipboard + paste target + hledání — Esc = "zruš vše"
        setCopiedBlock(null);
        setIsCut(false);
        setPasteTarget(null);
        clipboardGroupRef.current = [];
        isGroupCutRef.current = false;
        clearSearch();
        return;
      }
```

Obsluha se na začátku vrací pro `INPUT`/`TEXTAREA`/`SELECT`, takže Esc
z rozepsaného vyhledávacího pole sem nedojde — pole si ho řeší samo.

- [ ] **Krok 4: Opravit lživý komentář u `clearSearch`**

Komentář nad funkcí (~ř. 1033) po zapojení konečně platí; ověř, že jmenuje
skutečná místa:

```typescript
  // Zrušení hledání — jediné místo pravdy. Volá se z křížku v poli, z Esc
  // a z kliknutí do prázdné plochy plánu.
```

- [ ] **Krok 5: Build + testy**

Run: `npm run build`
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: build bez chyb, testy zelené.

- [ ] **Krok 6: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "fix(planner): hledání ruší klik do plánu i Esc (dřív jen křížek)"
```

---

### Task 5: Vizuální proklik a dokumentace

**Files:**
- Modify: `docs/vyvoj-historie.md`
- Modify: `CLAUDE.md` (jen pokud se změnil počet testů nebo přibyl sdílený pojem)

- [ ] **Krok 1: Proklik běžící aplikace**

Podle receptu v paměti `screenshot_bezici_appky.md` (Playwright ve scratchpadu,
dev login `tiskar`/`tiskar`). **Nespouštěj nový dev server, pokud už na portu
běží** — port zjisti, neukončuj cizí proces.

Scénáře, které musí projít:

| # | Scénář | Očekávání |
| --- | --- | --- |
| 1 | Monitor, stroj s nedodělanými | Sekce NEDODĚLÁNO ukáže **všechny**, zúženým řádkem, „DNES“ je vidět bez rolování |
| 2 | Karta s přetahující zakázkou | Vedle HOTOVO je „Přeskočit →“; po stisku zmizí z karty a zůstane ve frontě |
| 3 | Reload po přeskočení | Přeskočená zakázka se na kartu nevrátí |
| 4 | Plán, hover nad blokem v levém sloupci | Bublina je **vlevo**, sloupec vpravo je celý vidět |
| 5 | Plán, hover nad blokem v pravém sloupci | Bublina je **vpravo** |
| 6 | Plán, hledání + klik do prázdna | Dotaz zmizí, ztlumení se zruší |
| 7 | Plán, hledání + Esc | Totéž |
| 8 | Plán, hledání + tažení lasa přes bloky | Dotaz **zůstane** |
| 9 | Plán, hledání + klik na blok | Dotaz **zůstane** |

Screenshoty ulož do scratchpadu. **Do dokumentace piš jen scénáře, které jsi
opravdu proklikal** — ne ty, které jsi zamýšlel.

- [ ] **Krok 2: Zápis do historie**

Do `docs/vyvoj-historie.md` přidej sekci k 13. 8. 2026: čtyři připomínky, co se
změnilo, a **dvě poučení**:

1. Strop „ukaž 3, zbytek si najdi“ předpokládal, že uživatel ví, co hledá.
   Tiskař to vědět nemůže — zakázku, kterou nikdy neviděl, nevyhledá.
2. Komentář, který popisuje zamýšlené chování místo skutečného, je horší než
   žádný: `clearSearch` u sebe měl seznam tří volajících, ale volal ho jeden.
   Featura se tvářila hotová celý měsíc.

Druhé poučení patří i do `docs/POUCENI.md` jako řádek.

- [ ] **Krok 3: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs: připomínky tiskařů a plánovače z 13. 8. 2026"
```
