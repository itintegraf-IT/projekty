# Čitelnost timeline — dotažení — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dotáhnout prvky, které po zavedení stupňů písma zůstaly pevné nebo se s nimi rozešly, a vrátit tiskaři pilulku rozdělené zakázky.

**Architecture:** Navazuje na `src/lib/plannerTypography.ts` jako jediný zdroj pravdy. Nový mechanismus nevzniká. Dvě úlohy začínají měřením, ne opravou — u obou průzkum ukázal, že zadání může být postavené na špatném předpokladu.

**Tech Stack:** Next.js 16 · React · TypeScript · Tailwind v4 · testy `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-12-citelnost-timeline-dotazeni-design.md` — obsahuje výsledky průzkumu, ze kterých každé číslo v tomto plánu vychází.

## Global Constraints

- **Velikosti písma výhradně přes `src/lib/plannerTypography.ts`.** Žádné nové napevno zapsané číslo. `fontFactor` je koeficient PÍSMA (M 1 · L 1,15 · XL 1,35), `slotFactor` koeficient MŘÍŽKY (M 1 · L 1,053 · XL 1,123) — nezaměňovat.
- **Prvek, který roste s písmem, musí mít strop odvozený od místa, kde stojí.** Tři z dosavadních vad měly týž tvar: velikost se navázala na stupeň, ale mez zůstala pevná.
- **Barvy uvnitř karty bloku zůstávají pevné literály.** Mimo kartu (osa, hlavička) vždy CSS tokeny, nikdy hex.
- **U každé změny prahu dohledat všechny konzumenty a projít celý obor hodnot.** Poslední vážná regrese vznikla tím, že jeden modul posunul práh a druhý vykresloval jen jednu ze dvou variant — v diffu ani jednoho z nich nebylo nic vidět.
- **`npm run build` NESPOUŠTĚT** — majiteli běží dev servery sdílející `.next`. Typová kontrola `npx tsc --noEmit`.
- Výchozí stav testovací sady je **978 testů**.

---

### Task 1: Nová pole velikostí v modulu

**Files:**
- Modify: `src/lib/plannerTypography.ts`
- Test: `src/lib/plannerTypography.test.ts`

**Interfaces:**
- Produces: nová pole `PlannerTypeScale` — `production: number`, `noteBadge: number`, `splitChip: number`, `pauseLabel: number`, `driftBadge: number`.

- [ ] **Krok 1: Napsat padající test**

V `src/lib/plannerTypography.test.ts` rozšiř seznam klíčů v testu monotonie o `"production", "noteBadge", "splitChip", "pauseLabel", "driftBadge"` a přidej nový test:

```ts
test("nová pole reprodukují na M dnešní napevno zapsané velikosti", () => {
  // Na výchozím stupni se nesmí změnit nic — tahle pole jen nahrazují
  // literály, které v komponentách byly. Hodnoty odpovídají průzkumu:
  // ProductionChips 8, badge poznámek 10, SplitChip 10, popisek pauzy 10,
  // pruh driftu a tlačítko Přepočítat 10.
  const m = plannerTypeScale("M");
  assert.equal(m.production, 8);
  assert.equal(m.noteBadge, 10);
  assert.equal(m.splitChip, 10);
  assert.equal(m.pauseLabel, 10);
  assert.equal(m.driftBadge, 10);
});

test("nová pole rostou koeficientem PÍSMA, ne mřížky", () => {
  for (const key of PLANNER_FONT_SCALE_KEYS) {
    const ts = plannerTypeScale(key);
    assert.equal(ts.production, 8 * ts.fontFactor, `${key}: production`);
    assert.equal(ts.noteBadge, 10 * ts.fontFactor, `${key}: noteBadge`);
    assert.equal(ts.splitChip, 10 * ts.fontFactor, `${key}: splitChip`);
    assert.equal(ts.pauseLabel, 10 * ts.fontFactor, `${key}: pauseLabel`);
    assert.equal(ts.driftBadge, 10 * ts.fontFactor, `${key}: driftBadge`);
  }
});
```

- [ ] **Krok 2: Spustit a ověřit pád**

```bash
node --test --import tsx src/lib/plannerTypography.test.ts
```

Očekávání: FAIL — pole neexistují.

- [ ] **Krok 3: Doplnit pole**

Do typu `PlannerTypeScale` a do návratové hodnoty `plannerTypeScale`:

```ts
  /** Produkční chip OBÁLKA / VNITŘKY / tiskové archy · série. */
  production: number;
  /** Badge počtu tiskařských poznámek „📝 N" v rohu karty. */
  noteBadge: number;
  /** Pilulka rozdělené zakázky (SplitChip). */
  splitChip: number;
  /** Popisek „⏸ PAUZA — mimo provoz" uvnitř bloku přes odstávku. */
  pauseLabel: number;
  /** Pruh „⚠ N nesedí na kalendář" a tlačítko „Přepočítat" v hlavičce stroje. */
  driftBadge: number;
```

a do těla:

```ts
    production: 8 * s,
    noteBadge: 10 * s,
    splitChip: 10 * s,
    pauseLabel: 10 * s,
    driftBadge: 10 * s,
```

- [ ] **Krok 4: Ověřit a commitnout**

```bash
node --test --import tsx src/lib/plannerTypography.test.ts
npx tsc --noEmit
git add -A && git commit -m "feat(planner): pole velikostí pro drobné štítky karty a hlavičky stroje"
```

---

### Task 2: Nasadit škálování na kartě

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` — `ProductionChips` (ř. 154 a 161), badge poznámek (ř. 746), popisek pauzy (ř. 1197)
- Modify: `src/components/SplitChip.tsx` (ř. 35)

**Interfaces:**
- Consumes: `typeScale.production`, `.noteBadge`, `.splitChip`, `.pauseLabel` z Tasku 1; `MICRO_CHIP_CAP_FACTOR` (existující konstanta v `BlockCard.tsx`).

- [ ] **Krok 1: `ProductionChips`**

Komponenta dostane prop `fontSize: number`, uvnitř nahradí `fontSize: 8`. **Zároveň odvoď z písma i `maxWidth`**, které je dnes napevno 132 px a používá se jen ve zkrácené variantě (`clamp`): `maxWidth: fontSize * 16.5` — při písmu 8 to dá 132, tedy dnešní hodnotu beze změny.

Volající jsou tři: ř. 846 (kompaktní), ř. 965 (jednořádkový), ř. 1148 (plný). Všem předej `typeScale.production`.

- [ ] **Krok 2: Badge tiskařských poznámek — se stropem**

Ř. 746, dnes `fontSize: 10`. Průzkum zjistil, že se tenhle badge kreslí **bezpodmínečně ve všech hustotách** (jeho podmínka na ř. 719 není vázaná na žádný `MODE_*`), a že na nejnižší kartě (14 px) má box 14 px posazený 7 px od horní hrany, tedy **přetéká už dnes**. Zvětšení písma by to zhoršilo.

Použij proto strop stejně jako u chipů:

```tsx
fontSize: Math.min(typeScale.noteBadge, layoutHeight * MICRO_CHIP_CAP_FACTOR),
```

Do komentáře napiš, že badge není vázaný na hustotu karty, a proto strop potřebuje.

- [ ] **Krok 3: Popisek pauzy**

Ř. 1197, dnes `fontSize: 10` → `typeScale.pauseLabel`. **Strop nepotřebuje** — kreslí se jen v segmentu vysokém aspoň 40 px (podmínka `seg.height >= 40`). Napiš to do komentáře, ať to příště nikdo „nedoplní".

- [ ] **Krok 4: `SplitChip`**

`src/components/SplitChip.tsx:35` — přidej komponentě prop `fontSize: number` a nahraď jím literál 10. Volající v `BlockCard.tsx` (ř. 863 kompaktní, ř. 1129 plný) předají `typeScale.splitChip`.

- [ ] **Krok 5: Ověřit a commitnout**

```bash
npx tsc --noEmit
npx eslint src/components/planner/BlockCard.tsx src/components/SplitChip.tsx
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add -A && git commit -m "feat(planner): drobné štítky na kartě sledují stupeň písma"
```

Do reportu napiš, jaké velikosti vyjdou pro M a XL u všech čtyř prvků, a u badge poznámek navíc, od jaké výšky karty se strop přestane uplatňovat.

---

### Task 3: Hlavička stroje — pruh driftu a tlačítko

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:1271` (pruh „⚠ N nesedí na kalendář"), `:1282` (tlačítko „Přepočítat")

**Interfaces:**
- Consumes: `typeScale.driftBadge` z Tasku 1.

- [ ] **Krok 1: Nahradit obě velikosti**

Oba prvky mají dnes `fontSize: 10` a sedí přímo vedle názvu stroje, který při `XL` roste na 16,2 px. Nahraď je `typeScale.driftBadge`.

**Barvy nech být.** Jsou to pevné literály `#f59e0b`, `#1f2937` a `#fff` a mají zůstat — musí držet kontrast nezávisle na pozadí hlavičky v obou motivech.

- [ ] **Krok 2: Ověřit dopad na výšku hlavičky**

Průzkum spočítal, že výšku hlavičky dnes vždy určuje název stroje (řádkování 1,5 → 18 px při M, 24,3 při XL), zatímco pruh má 16 px a tlačítko 18 px. Po zvětšení na `driftBadge` bude pruh `10s × 1,4 + 2` a tlačítko `10s × 1,4 + 4`.

Dopočítej pro M, L i XL, jestli některý z nich **přeroste název stroje** — tím by se změnila výška hlavičky a rozešla by se s konstantou, kterou řeší Task 7. Výsledek napiš do reportu jako tabulku. Pokud přeroste, **zastav se a ohlas to** místo abys pokračoval.

- [ ] **Krok 3: Ověřit a commitnout**

```bash
npx tsc --noEmit
npx eslint src/app/_components/TimelineGrid.tsx
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add -A && git commit -m "feat(planner): pruh driftu a tlačítko Přepočítat sledují stupeň písma"
```

---

### Task 4: Stropy v jednořádkovém layoutu

Průzkum opravil dvě věci proti původnímu zadání: `Clock` a zelená fajfka se v jednořádkovém layoutu **vůbec nekreslí** (jsou jen v kompaktním), zato tam **chybí stropy u značek `↻` a `✂`**, o kterých nikdo nevěděl.

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` — větev `MODE_TINY || MODE_MICRO_TEXT` (začíná ř. 884), konkrétně ikony na ř. 951 a značky na ř. 977 a 980

**Interfaces:**
- Consumes: `MICRO_TEXT_CAP_FACTOR`, `NUM_ICON_RATIO_MINOR` — existující konstanty.

- [ ] **Krok 1: Vytáhnout stropovanou velikost čísla do proměnné**

V té větvi se dnes výraz `Math.min(typeScale.num * 0.92, layoutHeight * MICRO_TEXT_CAP_FACTOR)` počítá přímo ve `style` na ř. 950. Vytáhni ho nad `return`:

```tsx
        // Číslo i všechno, co ho doprovází, musí vycházet ze STEJNÉ velikosti.
        // Jinak je v nejnižší hustotě ikona větší než číslo — při XL a kartě
        // 14 px vycházel zámek 12 px proti číslu 9,8 px.
        const tinyNum = Math.min(typeScale.num * 0.92, layoutHeight * MICRO_TEXT_CAP_FACTOR);
```

- [ ] **Krok 2: Navázat ikony a značky na `tinyNum`**

- ř. 951 (`Lock`, `Hourglass`): `size={Math.round(tinyNum * NUM_ICON_RATIO_MINOR)}`
- ř. 977 (`↻`) a ř. 980 (`✂`): `fontSize: tinyNum * 0.9`

Značky dnes používají `typeScale.mini * 0.9` bez stropu, což při XL a kartě 14 px dá 10,6 px proti číslu 9,8 px.

**Ostatních tří výskytů `NUM_ICON_RATIO_MINOR` se nedotýkej** — ř. 830 a 831 jsou kompaktní layout, ř. 1008 plný. Tam je karta dost vysoká a strop by byl mrtvý kód.

- [ ] **Krok 3: Dopočítat kontrolní tabulku**

Do reportu napiš tabulku pro stupně M, L a XL a výšky karty 14, 20 a 29 px: velikost čísla, velikost ikony, velikost značky. **V žádném řádku nesmí být ikona ani značka větší než číslo.**

- [ ] **Krok 4: Ověřit a commitnout**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add -A && git commit -m "fix(planner): ikony a značky v jednořádkovém layoutu se stropují spolu s číslem"
```

---

### Task 5: Čtvercové tlačítko „Hotovo" — nejdřív změřit

Průzkum zjistil, že `printDoneSize` vrací pro variantu `square` pevných `height: 26, fontSize: 15` nezávisle na výšce karty, zatímco karta může mít 14 px. **Než na to sáhneš, musíš zjistit, jestli je to reálná vada.**

**Files:**
- Modify: `src/lib/tiskarBlockView.ts` (pouze pokud měření ukáže, že je zásah namístě)
- Test: `src/lib/tiskarBlockView.test.ts`

**Interfaces:**
- Consumes: `printDoneSize`, `PlannerTypeScale` — existující.

- [ ] **Krok 1: Zjistit, jaké výšky karty tiskař vůbec vidí**

Tohle je jádro úlohy. Zjisti a do reportu napiš:

1. **Má tiskař zoom slider?** Prohlédni tiskařskou hlavičku v `src/app/_components/PlannerPage.tsx` (větev `isTiskar && tiskarView === "plan"`). Průzkum tvrdí, že nemá — ověř to.
2. **Odkud se pro něj bere výška slotu?** Sleduj `slotHeight` v `PlannerPage.tsx` — výchozí hodnota, načtení z `localStorage`, načtení ze serverové preference `zoom`. Může se u tiskaře dostat na jinou hodnotu než výchozí, když nemá slider?
3. **Jaká je tedy nejnižší výška karty, kterou tiskař uvidí?** Nejkratší zakázka je 30 minut, tedy jeden slot. Spočítej to pro všechny tři stupně písma.
4. **Padne ta výška do pásma, kde je čtvercové tlačítko větší než karta?** Tlačítko má 26 px.

**Pokud vyjde, že tiskař na pásmo pod 26 px nedosáhne**, zapiš to do reportu i s odůvodněním a **na kód nesahej** — vada je teoretická. Pak přeskoč na Krok 4.

- [ ] **Krok 2: Přizpůsobit rozměr dostupnému místu**

Jen pokud Krok 1 ukázal, že vada je reálná. Použij tentýž princip, jakým se právě opravil pruh: rozměr se přizpůsobí, tlačítko se nikdy nepřeskočí.

```ts
  const squareSide = Math.min(26, layoutHeight - 2);
```

a velikost písma úměrně (`15 × squareSide / 26`). Typ `PrintDoneSize` má u varianty `square` dnes `height: 26` jako literál — rozšiř na `number`, stejně jako se to udělalo u varianty `bar`.

**Pozor na použitelnost.** Tlačítko je cíl pro klik a u stroje možná pro dotyk. Pokud by adaptivní rozměr klesl pod ~20 px, **zastav se a ohlas to** — malé tlačítko je jiný druh vady než chybějící tlačítko a rozhodnutí o tom nepatří do implementace.

- [ ] **Krok 3: Strážný test**

Přidej test, který pro všechny tři stupně a výšky 0–200 px ověří, že vrácený rozměr tlačítka se vejde do karty: `size.height <= layoutHeight`. Do komentáře napiš odkaz na incident z 3. 8. 2026.

- [ ] **Krok 4: Ověřit a commitnout**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

Commituj jen tehdy, když z Kroku 1 vyšel zásah jako namístě. Jinak commitni jen zjištění do reportu a napiš do odpovědi, že se nic neměnilo.

---

### Task 6: Vrátit tiskaři pilulku rozdělené zakázky

Průzkum ukázal, že tenhle nález je **výrazně větší, než review tvrdilo**. Před etapou kreslil kompaktní layout klikatelnou pilulku bezpodmínečně od 32 px výšky. Po etapě se karta od 46 px překlápí do plného layoutu, kde ji výškový rozpočet propustí až od 80 px. V pásmu **46–79 px** tak tiskaři zbyde jen neklikatelná textová značka `✂1/2`.

Pilulka nese jméno partnerského stroje, stav (čeká / hotovo), čas — a hlavně **klik, kterým tiskař přeskočí na navazující blok na druhém stroji**.

**Files:**
- Modify: `src/components/planner/BlockCard.tsx` — podmínka renderu pilulky v plném layoutu (ř. 1129)

**Interfaces:**
- Consumes: `splitChipFits` — **NEUPRAVOVAT**, chrání tlačítko „Hotovo" a její rozpočet je správný.

- [ ] **Krok 1: Zjistit, kam pilulku umístit**

Prohlédni si strukturu plného layoutu a zjisti, kde v něm dnes pilulka je (ř. 1129) a proč se tam při nižší kartě nevejde. Do reportu napiš, jaké má karta v pásmu 46–79 px řádky a kolik místa v nich zbývá.

Zvaž dvě cesty a v reportu doporuč jednu:
- **(a)** pilulku v tom pásmu vykreslit na místo textové značky `✂` v pravém shluku prvního řádku — je kompaktnější a řádek už existuje;
- **(b)** ponechat ji na dnešním místě, ale povolit ji i pod prahem rozpočtu.

Cesta (b) je nebezpečná — rozpočet chrání tlačítko „Hotovo" a obcházet ho je přesně to, co vedlo k havárii z 3. 8. 2026. Pokud ji doporučíš, musíš doložit, že tlačítko zůstane celé viditelné.

- [ ] **Krok 2: Implementovat doporučenou cestu**

Textová značka `✂1/2` se v tom pásmu nahradí pilulkou, ne zdvojí — nesmí být obojí najednou.

- [ ] **Krok 3: Ověřit dopočtem**

Do reportu napiš tabulku pro stupně M, L a XL a výšky 46, 60, 79, 80 a 104 px: co se vykreslí (pilulka / textová značka / nic), a jestli je v téže kartě pořád vidět celé tlačítko „Hotovo".

- [ ] **Krok 4: Ověřit a commitnout**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add -A && git commit -m "fix(tiskar): pilulka rozdělené zakázky i na nižších kartách"
```

---

### Task 7: Časová osa a sticky hlavička — obojí přes prohlížeč

Obě části téhle úlohy **nelze uzavřít dopočtem**. Vyžadují běžící aplikaci.

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx:48` (`HEADER_HEIGHT`), `:1406` (`labelStep`), `:1611` (použití konstanty)

**Interfaces:**
- Consumes: `typeScale.rail`, `typeScale.machineHead` — existující.

- [ ] **Krok 1: Ověřit, jestli má sticky hlavička mít odstup vůbec**

Průzkum zjistil, že hlavička **není uvnitř scrollovacího kontejneru** — je to jeho sourozenec. Sticky štítek dne s `top: HEADER_HEIGHT` si tedy rezervuje 33 px pod hlavičkou, ačkoliv s nulou by se zarovnal přesně pod ni. Není jasné, jestli je odstup záměr nebo pozůstatek po starší struktuře.

**Ověř to v prohlížeči.** Nastav dočasně `top: 0` a porovnej se současným stavem: kde se štítek dne zastaví při scrollování, překrývá se s hlavičkou, nebo je pod ní mezera? Do reportu vlož obojí pozorování.

Pokud je odstup zbytečný, **konstantu smaž** a použij `top: 0`. To je lepší výsledek než ji opravovat.

- [ ] **Krok 2: Pokud je odstup záměrný, odvodit ho z písma**

Průzkum dopočítal, že výšku hlavičky vždy určuje název stroje s řádkováním 1,5: `M` 18 px, `XL` 24,3 px, plus svislé odsazení 16 px a spodní hranice 1 px. Tedy `machineHead * 1.5 + 17` → `M` 35, `XL` 41,3. Dnešní konstanta 33 je tedy o 2 px vedle už na `M`.

`ResizeObserver` **nepoužívej** — výška je deterministická a v projektu by to byl první výskyt.

- [ ] **Krok 3: Navázat ředění popisků osy na velikost jejich písma**

Dnešní `labelStep = slotHeight >= 14 ? 1 : slotHeight >= 7 ? 2 : slotHeight >= 4 ? 4 : 8` nebere v potaz, že písmo popisků roste. Naměřené hustoty:

| Stupeň | Nejtěsnější případ | Rezerva |
| --- | --- | --- |
| M | výška slotu 14 | 5 px |
| L | výška slotu 14 | 3,65 px |
| XL | výška slotu 7 (zoom 6) | **1,85 px** |
| XL | výška slotu 15 (zoom 13) | **2,85 px** |

Nahraď podmínku tak, aby požadovala aspoň 5 px volného místa mezi popisky:

```tsx
  // Popisky se ředí podle velikosti SVÉHO písma, ne podle holé výšky slotu.
  // Jinak se osa při vyšším stupni zahustí právě tehdy, když uživatel chtěl
  // větší a přehlednější popisky. Práh 5 px je dnešní minimum na stupni M.
  const minLabelPitch = typeScale.rail + 5;
  const labelStep = slotHeight >= minLabelPitch ? 1
    : slotHeight * 2 >= minLabelPitch ? 2
    : slotHeight * 4 >= minLabelPitch ? 4
    : 8;
```

Ověř dopočtem, že pro `M` (`rail` 9 → práh 14) vyjdou přesně dnešní hodnoty. Tabulku pro všechny tři stupně a dosažitelné výšky slotu napiš do reportu.

- [ ] **Krok 4: Ověřit rastr v prohlížeči**

**Tohle nesmíš přeskočit.** Průzkum zjistil, že `labelStep` neřídí jen text popisků, ale i **vodorovné čáry mřížky** (hodinové i půlhodinové). Změna prahu tedy překreslí celý rastr.

Podívej se v prohlížeči na stupeň `XL` při zoomu 6 a 13 před změnou a po ní. Do reportu napiš, jestli rastr po přeředění vypadá dobře, nebo jestli vznikly příliš velké mezery mezi čarami.

- [ ] **Krok 5: Ověřit a commitnout**

```bash
npx tsc --noEmit
npx eslint src/app/_components/TimelineGrid.tsx
node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add -A && git commit -m "fix(planner): sticky hlavička a ředění popisků osy podle stupně písma"
```

---

### Task 8: Dokumentace

**Files:**
- Modify: `docs/vyvoj-historie.md`
- Modify: `CLAUDE.md` (jen pokud z předchozích úloh vzešla nová konvence)

- [ ] **Krok 1: Doplnit historii**

Do `docs/vyvoj-historie.md` přidej k sekci z 12. 8. 2026 dovětek o dotažení. Uveď:
- co se doškálovalo a proč (drobné štítky rostly o 0 %, zatímco číslo zakázky o 35 %),
- že se tiskaři vrátila pilulka rozdělené zakázky,
- výsledek měření u čtvercového tlačítka (opraveno / vyhodnoceno jako teoretické),
- výsledek ověření sticky hlavičky (konstanta smazána / odvozena z písma).

- [ ] **Krok 2: Zapsat známé omezení**

Do téže sekce přidej odstavec:

> **Známé omezení:** při stupni `XL` se na obrazovkách do 1366 px ořízne čtvrtý datumový chip (Pantone); od 1600 px se vejde. Řádek chipů se záměrně nezalamuje. Řešení odloženo (rozhodl Vojta 12. 8. 2026).

- [ ] **Krok 3: Commit**

```bash
git add -A && git commit -m "docs: dotažení čitelnosti timeline + známé omezení šířky"
```

---

## Co tento plán záměrně neřeší

- **Ořez chipu Pantone na úzkých obrazovkách** — odloženo rozhodnutím majitele.
- **Ořez čísla zakázky, když je pravý shluk dlouhý** — předexistující chování flexboxu, se stupni písma souvisí jen okrajově.
- **Prahy `height >= 18` a `h >= 14`** u popisků firemního dne a časů v zamčeném bloku — táž třída vady, ale obsah se stupněm neroste, takže nevzniká nekonzistence. Zůstává jako zapsaný dluh.
- **Rok v datu na kartě** — rozhodnutí předchozího specu.
