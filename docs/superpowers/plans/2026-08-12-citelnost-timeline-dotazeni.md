# Čitelnost timeline — dotažení drobných nálezů — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dotáhnout drobné nálezy, které zůstaly po etapě velikosti písma — dokončit škálování zbylého textu na kartě, srovnat sticky hlavičku a hustotu časové osy, a ošetřit tři hraniční případy.

**Architecture:** Navazuje na `src/lib/plannerTypography.ts` jako jediný zdroj pravdy. Žádný nový mechanismus nevzniká; jde o dotažení míst, která se při hlavní etapě přeskočila, a o narovnání dvou hodnot, které se s ní rozešly.

**Tech Stack:** Next.js 16 · React · TypeScript · Tailwind v4 · testy `node:test` + `tsx`.

## Kontext

Předchozí etapa (`docs/superpowers/plans/2026-08-11-citelnost-timeline-velikost-pisma.md`, 21 commitů na větvi `Vojta`) zavedla přepínač velikosti písma `M · L · XL`. Její závěrečné review vyprodukovalo 15 drobných nálezů vyhodnocených jako nepřekážející nasazení. Čtyři z nich už jsou vyřešené:

| Nález | Stav |
| --- | --- |
| M6 tři konvence u `SpecChip` | vyřešeno — v plném layoutu prostá velikost, v jednořádkovém strop; rozdíl je účelný |
| M10 přepnutí stupně posune scroll | opraveno (`captureScrollAnchor`, commit `6c61c69`) |
| M11 zastaralý komentář „24" | opraveno |
| M13 test driftu klíčů stupňů | opraveno |

Tenhle plán řeší zbývajících jedenáct.

## Global Constraints

- **Velikosti písma výhradně přes `src/lib/plannerTypography.ts`.** Žádné nové napevno zapsané číslo. `fontFactor` je pro písmo, `slotFactor` pro výšky a prahy porovnávané s výškou bloku — nezaměňovat.
- **Barvy uvnitř karty bloku zůstávají pevné literály** (`rgba(...)`, `color-mix(...)`), ne CSS tokeny — vnitřek bloku je gradient stejný ve světlém i tmavém motivu. Mimo kartu (osa, hlavička) platí běžné pravidlo: vždy tokeny.
- **Žádná délka bloku se nesmí propadnout do nižší hustoty, než má dnes.** Hlídá strážný test `plannerTypography.test.ts`.
- **`npm run build` NESPOUŠTĚT během práce** — majiteli běží dev servery sdílející složku `.next` a build je shodí. Typová kontrola přes `npx tsc --noEmit`.
- Testy nových čistých modulů do `src/lib/*.test.ts`. Výchozí stav sady je **976 testů**.
- Nové komponenty jako named export do vlastního souboru — `BlockCard.tsx` i `TimelineGrid.tsx` jsou nad limitem `max-lines`.

## Struktura souborů

| Soubor | Co se v něm mění | Task |
| --- | --- | --- |
| `src/lib/plannerTypography.ts` | případná nová pole velikostí (`production`, `noteBadge`, `splitChip`) | 1 |
| `src/components/planner/BlockCard.tsx` | `ProductionChips`, badge poznámek, popisek pauzy, stropy ikon | 1, 2 |
| `src/components/SplitChip.tsx` | velikost písma propem | 1 |
| `src/components/planner/PrintDoneButton.tsx` / `src/lib/tiskarBlockView.ts` | velikosti písma nižších variant tlačítka | 1 |
| `src/app/_components/TimelineGrid.tsx` | `HEADER_HEIGHT`, `labelStep` | 3 |

---

### Task 1: Dotáhnout škálování zbylého textu na kartě

Po hlavní etapě zůstalo na kartě několik prvků s napevno zapsanou velikostí. Při stupni `XL` jde číslo zakázky na 17,7 px, takže osmipixelový chip `OBÁLKA` vedle něj vypadá zakrsle. Nálezy M1, M2, M3, M4, M5.

**Files:**
- Modify: `src/lib/plannerTypography.ts` — přidat pole
- Modify: `src/components/planner/BlockCard.tsx:154` (`ProductionChips`), `:746` (badge tiskařských poznámek), popisek „⏸ PAUZA — mimo provoz"
- Modify: `src/components/SplitChip.tsx`
- Modify: `src/lib/tiskarBlockView.ts` (velikosti písma variant `bar 24` a `square`)
- Test: `src/lib/plannerTypography.test.ts`

**Interfaces:**
- Consumes: `PlannerTypeScale`, `plannerTypeScale` — existující.
- Produces: nová pole `PlannerTypeScale`: `production: number`, `noteBadge: number`, `splitChip: number`, `pauseLabel: number`.

- [ ] **Krok 1: Napsat padající test**

Do `src/lib/plannerTypography.test.ts` přidej k existujícímu testu monotonie nová pole. V testu „každá velikost písma roste s vyšším stupněm" rozšiř seznam klíčů:

```ts
  for (const key of [
    "num", "desc", "chip", "spec", "mini", "badge", "rail", "machineHead",
    "production", "noteBadge", "splitChip", "pauseLabel",
  ] as const) {
```

A přidej nový test, který hlídá, že se poměr k číslu zakázky nerozejde — právě jeho rozpad byl obsahem nálezu M1:

```ts
test("drobné štítky drží poměr k číslu zakázky napříč stupni", () => {
  // Na M odpovídají dnešním napevno zapsaným velikostem; poměr se pak už nemění,
  // aby při XL nevypadaly zakrsle vedle 17,7px čísla zakázky.
  const m = plannerTypeScale("M");
  assert.equal(Math.round(m.production), 8);
  assert.equal(Math.round(m.noteBadge), 10);
  assert.equal(Math.round(m.splitChip), 10);
  assert.equal(Math.round(m.pauseLabel), 10);

  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const ts = plannerTypeScale(key);
    for (const f of ["production", "noteBadge", "splitChip", "pauseLabel"] as const) {
      const pomerM = m[f] / m.num;
      const pomer = ts[f] / ts.num;
      assert.ok(
        Math.abs(pomer - pomerM) < 0.02,
        `${key}/${f}: poměr k číslu ${pomer.toFixed(3)} se rozešel s M (${pomerM.toFixed(3)})`
      );
    }
  }
});
```

- [ ] **Krok 2: Spustit a ověřit pád**

```bash
node --test --import tsx src/lib/plannerTypography.test.ts
```

Očekávání: FAIL — pole `production` a spol. neexistují.

- [ ] **Krok 3: Doplnit pole do modulu**

V `src/lib/plannerTypography.ts` přidej do typu `PlannerTypeScale` a do návratové hodnoty `plannerTypeScale`:

```ts
  /** Produkční chip OBÁLKA / VNITŘKY / tiskové archy. */
  production: number;
  /** Badge počtu tiskařských poznámek (📝 n) v rohu karty. */
  noteBadge: number;
  /** Pilulka rozdělené zakázky (SplitChip). */
  splitChip: number;
  /** Popisek „⏸ PAUZA — mimo provoz" uvnitř bloku přes odstávku. */
  pauseLabel: number;
```

a do těla funkce:

```ts
    production: 8 * s,
    noteBadge: 10 * s,
    splitChip: 10 * s,
    pauseLabel: 10 * s,
```

Násobí se `s` (tedy `fontFactor`), ne `slotFactor` — jsou to velikosti písma.

- [ ] **Krok 4: Spustit test**

```bash
node --test --import tsx src/lib/plannerTypography.test.ts
```

Očekávání: PASS.

- [ ] **Krok 5: Nasadit v komponentách**

`BlockCard.tsx` — funkce `ProductionChips` (ř. 154) dostane `fontSize` propem a volající předá `typeScale.production`; badge tiskařských poznámek (ř. 746) → `typeScale.noteBadge`; popisek pauzy → `typeScale.pauseLabel`.

`src/components/SplitChip.tsx` — přidej prop `fontSize: number`, uvnitř nahraď napevno zapsanou hodnotu, volající v `BlockCard.tsx` předá `typeScale.splitChip`.

`src/lib/tiskarBlockView.ts` — varianty `bar 24` (dnes `fontSize: 11.5`) a `square` (dnes `15`) přepiš na `Math.round(11.5 * ts.fontFactor * 10) / 10` resp. `Math.round(15 * ts.fontFactor)`. Uprav i JSDoc na ř. 29-32, který dnes tvrdí, že velikost popisku roste s písmem — po téhle změně to bude platit pro všechny čtyři varianty, dnes jen pro dvě.

**POZOR na `ProductionChips`:** má parametr `abbreviated` a u dlouhého chipu `maxWidth: 132` s elipsou. Ta šířka je v pixelech a s rostoucím písmem přestane stačit — odvoď ji taky z písma (např. `fontSize * 16`) a napiš do reportu, jak ti vyšla pro M a XL.

- [ ] **Krok 6: Ověřit**

```bash
npx tsc --noEmit
npx eslint src/components/planner/BlockCard.tsx src/components/SplitChip.tsx
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Očekávání: bez chyb, bez nových eslint nálezů, 977 testů (976 + 1 nový).

- [ ] **Krok 7: Commit**

```bash
git add -A
git commit -m "feat(planner): drobné štítky na kartě sledují stupeň písma"
```

---

### Task 2: Stropovat ikony v jednořádkovém layoutu

Nález M7. V jednořádkovém layoutu má číslo zakázky strop `Math.min(typeScale.num * 0.92, layoutHeight * 0.7)`, ale ikony `Lock` a `Hourglass` vedle něj se počítají z `typeScale.num` bez stropu. Při `XL` a kartě 14 px vyjde číslo 9,8 px a zámek 12 px — **ikona je větší než číslo, které doprovází**.

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` — jednořádkový layout (větev `MODE_TINY || MODE_MICRO_TEXT`)

**Interfaces:**
- Consumes: `MICRO_CHIP_CAP_FACTOR`, `NUM_ICON_RATIO_MINOR` — existující konstanty v `BlockCard.tsx`.
- Produces: nic.

- [ ] **Krok 1: Najít místa**

```bash
grep -n "NUM_ICON_RATIO_MINOR" src/components/planner/BlockCard.tsx
```

Zajímají tě jen výskyty uvnitř jednořádkového layoutu (větev kolem `MODE_TINY || MODE_MICRO_TEXT`), ne v plném a kompaktním — tam je karta dost vysoká a strop by byl mrtvý kód.

- [ ] **Krok 2: Zavést stropovanou velikost čísla jako proměnnou**

V té větvi se dnes výraz `Math.min(typeScale.num * 0.92, layoutHeight * 0.7)` počítá přímo v `style`. Vytáhni ho nad `return` do proměnné, například:

```tsx
        // Číslo i ikony vedle něj musí vycházet ze STEJNÉ velikosti, jinak je
        // v nejnižším režimu ikona větší než číslo, které doprovází (XL @ 14 px:
        // číslo 9,8 px, zámek 12 px).
        const tinyNum = Math.min(typeScale.num * 0.92, layoutHeight * 0.7);
```

a použij ji jak pro `fontSize` čísla, tak jako základ pro `size` ikon: `Math.round(tinyNum * NUM_ICON_RATIO_MINOR)`.

- [ ] **Krok 3: Ověřit dopočtem**

Do reportu napiš tabulku pro stupně M a XL a výšky karty 14, 20 a 29 px: velikost čísla, velikost ikony, a poměr ikona/číslo. Poměr musí být ve všech případech stejný jako v plném layoutu (`NUM_ICON_RATIO_MINOR`) a ikona nikdy větší než číslo.

- [ ] **Krok 4: Ověřit a commitnout**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add -A
git commit -m "fix(planner): ikony u čísla zakázky se v jednořádkovém layoutu stropují spolu s ním"
```

---

### Task 3: Srovnat sticky hlavičku a hustotu časové osy

Dva nálezy, oba v `TimelineGrid.tsx`, oba vznikly tím, že se pevná konstanta rozešla s obsahem, který se stupněm roste.

**M8** — `HEADER_HEIGHT = 33` (`TimelineGrid.tsx:48`) pohání `top` sticky datumového štítku (`:1611`). Task 7 hlavní etapy odebral z hlavičky stroje třídu `text-xs`, čímž zmizel i její `line-height: 1rem`. Skutečná výška hlavičky je teď ~30,4 px při `M` a ~35,4 px při `XL`, takže se štítek při `XL` zasune ~2,4 px pod hlavičku.

**M9** — `labelStep` (`TimelineGrid.tsx:1406`) ředí popisky hodin podle výšky slotu, ale nebere v potaz velikost jejich písma. Při zoomu 13 a stupni `XL` vyjde výška slotu 15 px, takže se popisky kreslí každou půlhodinu písmem 12,15 px v rozteči 15 px. Nepřekrývá se, ale je to hustší než na `M` — přesně opačný efekt, než jaký uživatel od zvětšení čeká.

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:48`, `:1406`, `:1611`

**Interfaces:**
- Consumes: `typeScale.machineHead`, `typeScale.rail` — existující.
- Produces: nic.

- [ ] **Krok 1: Odvodit výšku hlavičky z písma**

`HEADER_HEIGHT` je modulová konstanta, ale nově musí záviset na stupni. Nahraď ji funkcí nebo výrazem uvnitř komponenty, kde je `typeScale` k dispozici:

```tsx
  // Výška sticky hlavičky stroje = padding 8+8 + řádek textu. Musí růst se
  // stupněm písma, jinak se sticky datumový štítek zasune pod hlavičku
  // (při XL o ~2,4 px).
  const headerHeight = Math.round(16 + typeScale.machineHead * 1.2);
```

Dopočet pro kontrolu: `M` → 16 + 14,4 = 30,4 → 30; `XL` → 16 + 19,44 = 35,4 → 35. Použij `headerHeight` na ř. 1611 místo `HEADER_HEIGHT`. Starou konstantu smaž, pokud ji nikdo jiný nepoužívá — ověř grepem.

- [ ] **Krok 2: Navázat ředění popisků na velikost jejich písma**

Nahraď ř. 1406:

```tsx
  // Popisky se ředí tak, aby mezi nimi zbylo aspoň 5 px volného místa. Práh
  // musí vycházet z velikosti PÍSMA popisku, ne z holé výšky slotu — jinak se
  // při vyšším stupni osa zahustí právě ve chvíli, kdy uživatel chtěl větší
  // a přehlednější popisky.
  const minLabelPitch = typeScale.rail + 5;
  const labelStep = slotHeight >= minLabelPitch ? 1
    : slotHeight * 2 >= minLabelPitch ? 2
    : slotHeight * 4 >= minLabelPitch ? 4
    : 8;
```

Dopočet pro kontrolu: `M` (`rail` 9) → práh 14, tedy shodné s dnešním chováním; `XL` (`rail` 12,15) → práh 17,15, takže při výšce slotu 15 se popisky ředí po dvou místo po jedné.

- [ ] **Krok 3: Ověřit dopočtem**

Do reportu napiš tabulku: pro stupně `M`, `L`, `XL` a pro výšky slotu 3, 5, 8, 13, 15, 20, 29 uveď `labelStep`, výslednou rozteč a rezervu proti velikosti písma. Rezerva nesmí být nikde záporná a pro `M` musí vyjít stejné hodnoty jako dnes.

- [ ] **Krok 4: Ověřit a commitnout**

```bash
npx tsc --noEmit
npx eslint src/app/_components/TimelineGrid.tsx
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add -A
git commit -m "fix(planner): sticky hlavička a ředění popisků osy sledují stupeň písma"
```

---

### Task 4: Tři hraniční případy

Nálezy M12, M14, M15. Všechny tři jsou úzké případy, u kterých je potřeba nejdřív ověřit, jestli vůbec nastávají, a teprve pak zasahovat.

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` (podle zjištění)
- Modify: `src/lib/tiskarBlockView.ts` (jen pokud M12 vyjde jako reálný)

**Interfaces:**
- Consumes: `splitChipFits`, `typeScale` — existující.
- Produces: nic.

- [ ] **Krok 1: M12 — ztráta pilulky rozdělené zakázky v pásmu 46–47 px**

Při stupni `M` byl blok o výšce 46–47 px dřív v kompaktním režimu, který kreslil klikatelnou pilulku rozdělené zakázky (partner, stav, proklik). Nově je v plném layoutu, kde `splitChipFits(46, bar24, 0)` vrací `false`, takže pilulka zmizí a zůstane jen textové `✂1/2`.

Nejdřív **ověř, jestli ten stav nastane**: při jakém zoomu má blok 46–47 px a existuje taková kombinace u reálné délky zakázky? Napiš to do reportu. Půlhodinová zakázka má při `M` výšku `slotHeight`, hodinová `2 × slotHeight` — hledej celočíselné `slotHeight` v rozsahu 3–26, které dá 46 nebo 47.

Pokud stav nenastane (žádná kombinace nevyjde), zapiš to do reportu a **dál nic neměň** — nález je teoretický.

Pokud nastane, oprav to tak, že se pilulka vykreslí i v plném layoutu, když se vejde. Neměň `splitChipFits` — ta chrání tlačítko „Hotovo" a její rozpočet je správný. Místo toho v `BlockCard.tsx` ověř, jestli se v plném layoutu pilulka vůbec pokouší vykreslit, a případně uprav podmínku tak, aby v pásmu, kde se vejde, byla.

- [ ] **Krok 2: M14 — oříznutí čtvrtého chipu na úzkém sloupci**

Řádek datumů má `flexWrap: nowrap` a `overflow: hidden`, takže při `XL` a úzkém sloupci se čtvrtý chip (Pantone) ořízne. Bylo vědomě rozhodnuto, že se chipy zalamovat nebudou.

Ověř, při jaké šířce sloupce k tomu dochází: sečti šířky čtyř chipů při `XL` (odhad `fontSize × 0,55 × počet znaků + padding + rámeček`) a porovnej se šířkou sloupce na obrazovkách 1366, 1680 a 1920 px (sloupec = `(šířka − šířka panelu fronty − 46) / 2`; panel má výchozích 320 px, ale je roztažitelný 200–600).

Do reportu napiš, od jaké šířky sloupce se chip ořízne. **Neopravuj to** — jen zjisti a nahlas. Pokud vyjde, že se ořezává už na běžném notebooku, navrhni v reportu možnosti (zkrátit text chipu, snížit velikost chipů při úzkém sloupci, povolit zalomení) a nech rozhodnutí na majiteli.

- [ ] **Krok 3: M15 — riziko zalomení pravého shluku**

Pravý shluk v řádku 1 plného layoutu má `flexWrap: "wrap"`. Když se zalomí na dva řádky, řádek 1 povyroste zhruba o výšku jednoho mini-chipu a na kartě u prahu plného layoutu se ořízne řádek datumů.

Ověř: kolik mini-chipů se tam může sejít (materiál, barvy, lak = tři) plus značka opakování a značka rozdělení, jaké jsou reálné délky štítků z číselníku (`CodebookOption`), a jestli součet jejich šířek může při `XL` a úzkém sloupci přesáhnout dostupnou šířku.

Pokud ano, nejjednodušší pojistka je `flexWrap: "nowrap"` plus `overflow: hidden` na tom shluku — chipy se pak ořežou vodorovně místo aby rozbily výšku řádku. Zvaž to a rozhodnutí i s odůvodněním napiš do reportu; implementuj jen tehdy, když ověříš, že situace reálně nastává.

- [ ] **Krok 4: Ověřit a commitnout**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Commituj jen tehdy, když z kroků 1–3 vzešla nějaká změna kódu. Pokud všechny tři nálezy vyjdou jako teoretické, commitni jen doplnění zjištění do `docs/vyvoj-historie.md` u sekce z 12. 8. 2026 se zprávou `docs: hraniční případy karty bloku ověřeny jako teoretické`.

---

## Co se v tomto plánu záměrně NEŘEŠÍ

- **Rok v datu na kartě.** Plný layout ukazoval `13.08.26`, nově `13.8.` — na přelomu roku je to nejednoznačné. Plné datum je v tooltipu. Je to vědomé rozhodnutí ze specu hlavní etapy, ne nedopatření; změna by chtěla vlastní rozvahu.
- **Tlačítko „Hotovo" v tiskařském režimu při L/XL.** Ověřené dopočtem a strážným testem, ale ne okem — v dev databázi nemá tiskař ve svém okně žádnou zakázku. Patří to do proklikání před nasazením, ne do kódové úlohy.
