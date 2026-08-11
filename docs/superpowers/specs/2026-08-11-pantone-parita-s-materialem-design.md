# Design: Pantone — parita s materiálem (SKLADEM + VYDÁNO)

**Datum:** 2026-08-11
**Autor:** Vojta + Claude (brainstorm)
**Stav:** Návrh k odsouhlasení
**Zadavatel:** nákup (Pantone)

---

## 1. Problém

Čip Pantone s termínem dodání se v provozu osvědčil — nákup podle něj vidí, na kdy je
barva objednaná. Chybí mu ale stavy, které materiál má: **SKLADEM** a **VYDÁNO**.

Obě sady polí jsou v podstatě stavový automat nad jedním termínem, jenže materiál má
o dva stavy víc:

| | Materiál | Pantone |
| --- | --- | --- |
| Je to vůbec potřeba? | *(vždy — čip svítí pořád)* | `pantoneRequired` — tlačítko **POTŘEBA** |
| Termín dodání | `materialRequiredDate` | `pantoneRequiredDate` |
| Odklepnuto | `materialOk` — ✓ **OK** | `pantoneOk` — ✓ **OK** |
| Máme skladem | `materialInStock` — **SKLADEM** | **chybí** |
| Vydáno do výroby | `materialIssued` — **VYDÁNO** | **chybí** |

### Proč to nejde odbýt stávajícím `pantoneOk`

Sémantika se liší a rozdíl je provozně podstatný:

- `...Ok` = *termín byl splněn* — dorazilo to, co bylo objednané na dané datum.
- `...InStock` = *žádný termín neřešíme, máme to na skladě*. Server u materiálu při
  zapnutí **vynuluje datum** (`src/app/api/blocks/[id]/route.ts`, větev
  `allowed.materialInStock === true`).
- `...Issued` = *vydáno ze skladu na stroj*. Taky nuluje datum.

Bez toho rozlišení nejde odlišit „objednali jsme a dorazilo v termínu" od „nemuseli jsme
objednávat vůbec" — a nákup potřebuje právě to druhé.

### Kde to nejvíc chybí

Nejostřejší díra je **vyskakovací kalendář po dvojkliku na čip**
(`InlineDatePicker` v `src/app/_components/TimelineGrid.tsx`). U materiálu vyjede
kalendář **a pod ním dvě tlačítka „Skladem ✓" / „Vydáno ➜"**. Dvojklik na pantonový čip
otevře tentýž komponent, ale bez nich — propsy `sklademActive`/`vydanoActive`
i callbacky `onPickSkladem`/`onPickVydano` mají natvrdo podmínku `field === "material"`.

## 2. Rozhodnutí (odsouhlasená 11. 8. 2026)

| Otázka | Rozhodnutí |
| --- | --- |
| Rozsah | **Plná parita** — `pantoneInStock` i `pantoneIssued`, nové sloupce v DB |
| Kam dát VYDÁNO | **Přesně tam, kde je materiálové** — builder, rezervace a presety ho nemají ani u materiálu, takže je nedostane ani pantone |
| Vazba na POTŘEBA | **SKLADEM i VYDÁNO zapnou `pantoneRequired = true`** |
| Presety zakázek | **Ano** — `JobPreset` dostane `pantoneInStock` (parita s `materialInStock`) |
| Zásah do dat | **Žádný** — migrace je aditivní, výchozí `false` = dnešní chování |

### Proč SKLADEM zapíná POTŘEBA

Pantonový čip se na kartě zobrazuje jen při
`pantoneRequired || pantoneRequiredDate || pantoneOk`. Kdyby šlo zapnout SKLADEM
samostatně, vznikl by stav, který je uložený, ale **na kartě neviditelný**. Zapnutí
`pantoneRequired` je zároveň sémanticky správně: kdo řekne „pantone máme skladem",
tím říká, že pantone je pro tu zakázku potřeba.

### Proč plná parita a ne jen SKLADEM

Dodatečné doplnění VYDÁNA by znamenalo druhou migraci a **druhé kolo týchž ~20 souborů**,
protože nový boolean sloupec na `Block` se v tomhle repu registruje do deseti sdílených
seznamů (viz oddíl 5). Cena za druhý sloupec teď je jeden řádek v migraci a jeden řádek
v každém seznamu; cena za odklad je celý zásah znovu.

## 3. Datový model

Ručně psaná migrace podle vzoru `20260523135302_add_block_material_issued`:

```sql
-- Block
ALTER TABLE `Block` ADD COLUMN `pantoneInStock` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `Block` ADD COLUMN `pantoneIssued`  BOOLEAN NOT NULL DEFAULT false;

-- JobPreset — NULL znamená „preset se k tomu nevyjadřuje" (stejně jako materialInStock)
ALTER TABLE `JobPreset` ADD COLUMN `pantoneInStock` BOOLEAN NULL;
```

**Psát ručně, nasazovat `npx prisma migrate deploy`.** `prisma migrate dev` je v tomhle
repu rozbité — shadow-replay padá na historické migraci `20260326204352` (P3006).

Migrace je aditivní s neutrálním defaultem: po nasazení se nezmění chování ani vzhled
jediné existující zakázky. Žádný backfill, žádný přepočet.

**Ověřeno k názvům:** ani `pantoneInStock`, ani `pantoneIssued` netvoří prefixovou dvojici
s čímkoli v `UNDO_RESTORABLE_FIELDS`, takže nezhoršují známý ořez `AuditLog.field`
na 180 bajtů (popsaný v hlavičce `src/lib/auditCoverage.ts`).

## 4. Chování

### 4.1 Priorita zobrazení na čipu

```
VYD.  →  SKLAD  →  datum  →  OK  →  ⚠
```

Stejné pořadí, jaké má dnes materiál. Barvy podle existujících tokenů:
`SKLAD` = zelený stav `ok`, `VYD.` = modrý stav `issued` (klíč `issued` v `DEADLINE_BG`
už existuje).

### 4.2 Serverové side-effekty

V `PUT /api/blocks/[id]`, hned vedle materiálových větví:

| Vstup | Server dopočítá |
| --- | --- |
| `pantoneInStock = true` | `pantoneRequiredDate = null`, `pantoneRequired = true` |
| `pantoneIssued = true` | `pantoneRequiredDate = null`, `pantoneRequired = true` |
| nastavení `pantoneRequiredDate` | `pantoneInStock = false`, `pantoneIssued = false` |
| `pantoneRequired = false` | vynuluje datum, `pantoneOk` **i oba nové příznaky** |

Poslední řádek rozšiřuje existující větev `allowed.pantoneRequired === false`. Třetí
řádek zrcadlí to, co pro materiál dělá klient v `InlineDatePicker`
(`{ materialRequiredDate: dateStr, materialInStock: false, materialIssued: false }`).

### 4.3 Umlčení varování o termínu

```ts
const pantoneHandled = block.pantoneInStock || block.pantoneIssued;
const pantoneDeadlineState = pantoneHandled
  ? "ok"
  : deadlineState(block.pantoneRequiredDate, block.pantoneOk, now, block.startTime);
```

Přesné zrcadlo `materialHandled` v `src/components/planner/BlockCard.tsx`. Bez toho by
pantone, který máme na skladě, dál svítil červeně „po termínu".

### 4.4 Viditelnost čipu

Podmínka se rozšíří na:

```ts
block.pantoneRequired || block.pantoneRequiredDate || block.pantoneOk
  || block.pantoneInStock || block.pantoneIssued
```

I když rozhodnutí „SKLADEM zapíná POTŘEBA" dělá tenhle dodatek za normálních okolností
zbytečným, patří tam jako **pojistka proti neviditelnému stavu** — data zapsaná jinou
cestou (import, ruční SQL, budoucí endpoint) by jinak zmizela z karty beze stopy.

## 5. Rozsah zásahu

### 5.1 UI — kde přibude ovládání

| Místo | Soubor | Co přibude |
| --- | --- | --- |
| Vyskakovací kalendář (dvojklik na čip) | `TimelineGrid.tsx` | „Skladem ✓" + „Vydáno ➜" — dnes jen pro materiál |
| Modal editace bloku | `BlockEdit.tsx` | SKLAD + VYDÁNO; při zapnutí se datepicker nahradí plaketou a OK se skryje |
| Karta bloku | `planner/BlockCard.tsx` | čip ve **všech 4 výškových režimech** — viz 5.5 |
| Read-only detail | `BlockDetail.tsx` | řádek „Skladem ✓ / Vydáno ➜" |
| Monitor u stroje | `lib/monitorChips.ts` | chip PANTONE dostane tón `ok` i při skladem/vydáno |
| Builder nové zakázky | `planner/JobBuilderPanel.tsx`, `hooks/useJobBuilder.ts` | **jen SKLADEM** |
| Rezervace | `rezervace/_components/PlanningForm.tsx` | **jen SKLADEM** |
| Presety zakázek | `job-presets/JobPresetEditor.tsx`, `lib/jobPresets.ts`, obě `api/job-presets/*` | **jen SKLADEM** + validace „nesmí zároveň skladem a offset data" |

**Jediná odchylka od doslovné kopie materiálu:** pantone má navíc tlačítko POTŘEBA, takže
by v úzkém sloupci modalu (1/4 šířky gridu) stály čtyři prvky vedle sebe. Řeší se tím, že
se **OK skryje, jakmile je zapnuté SKLAD nebo VYDÁNO** — pak jsou v řádku vždy nejvýš tři,
stejně jako u materiálu. (Materiál tuhle větev už má: `!materialInStock && !materialIssued`.)

### 5.2 Registrace do sdílených seznamů

Nový boolean sloupec na `Block` není jen sloupec. Tohle je úplný seznam registrů —
sloupec **A** říká, jestli zapomenutí odhalí test:

| Registr | Hlídá test? | Následek zapomenutí |
| --- | --- | --- |
| `lib/revision/blockColumns.ts` | **ano** (čte schéma) | test padne |
| `lib/revisionFormat.ts` / `FIELD_LABELS` | **ano** (čte schéma) | test padne — „Sloupec Block bez rozhodnutí" |
| `lib/auditedFields.ts` | ne | změna se **neobjeví v historii** (táž díra jako havárie plánu 5.–6. 8. 2026) |
| `lib/auditFormatters.ts` (`FIELD_LABELS` + větev `fmtAuditVal`) | ne — seznam `knownBooleanSplitFields` v testu je **ruční** | historie ukáže syrové `true`/`false` |
| `lib/undo/restoreFields.ts` | ne | **undo pole tiše ztratí** |
| `lib/splitSharedFields.ts` | ne | split skupina se rozejde |
| `lib/seriesPropagation.ts` | ne | uložení „celé série" přepíše per-instanci stav |
| `lib/blockPayload.ts` | ne | **copy/paste ztratí hodnotu** |
| `EDIT_TRACKED_FIELDS` v `PlannerPage.tsx` | ne | undo editace pole nezachytí |
| `api/blocks/[id]/split/route.ts` | ne | druhá půlka splitu vznikne bez hodnoty |
| `api/blocks/route.ts` (POST) | ne | zakázka se založí s výchozí hodnotou |
| **MTZ allowlist** v `api/blocks/[id]/route.ts` PUT | ne | **nákup tlačítko uvidí, ale nic neuloží** |
| `Block` typ v `TimelineGrid.tsx` | kompilace | TS chyba |

`seriesPropagation` patří do **vylučovacího** seznamu (`SERIES_EXCLUDED_FIELDS`) — jde
o per-tisk stav, stejně jako `materialInStock`/`materialIssued`.

Devět z třinácti registrů **nehlídá nic**. Právě tahle třída zapomenutí už v projektu
dvakrát způsobila tichou ztrátu dat (nález #2 auditu 7/2026 — copy/paste ztrácel Pantone;
Critical nález go/no-go 5. 8. 2026 — split sourozenci se rozešli). V plánu proto musí být
každý z nich **samostatný krok s vlastním ověřením**, ne položka v hromadném commitu.

### 5.3 Dvojí zdroj pravdy pro čip

Pravidla čipu počítají **dvě nezávislé kopie**: inline v `BlockCard.tsx` a čistá funkce
`buildMonitorChips` v `lib/monitorChips.ts`. Hlavička `monitorChips.ts` to výslovně
přiznává — *„kdo mění pravidlo tady, musí ho ručně promítnout i do `BlockCard.tsx`"*.

Změna jen na jedné straně znamená, že **Monitor u stroje a plán tvrdí o téže zakázce dvě
různé věci**. Přesně to je poučení P16 z `docs/POUCENI.md`. Obě strany se v tomto zásahu
mění a plán je musí spárovat v jednom kroku.

### 5.4 Čtyři výškové režimy karty

`BlockCard.tsx` vykresluje pantonový čip **čtyřikrát, pokaždé jiným kódem** — každý
režim má vlastní stylovací funkci i vlastní podmínku viditelnosti. Všechny čtyři se musí
změnit, jinak stav zmizí při určitém přiblížení timeline:

| Režim | Práh výšky | Podoba | Kde v souboru |
| --- | --- | --- | --- |
| `showDatesFull` | MODE_FULL, ≥ 60 px | komponenta `DateBadge` | řádek ~1073 |
| `showDatesCompact` | MODE_FULL, 48–59 px | inline `<span>` přes `cs()` | řádek ~1125 |
| `MODE_COMPACT` | 44–47 px | inline `<span>` přes `dateChip()` | řádek ~821 |
| `MODE_TINY` / `MODE_MICRO_TEXT` | 14–43 px | inline `<span>` přes `chipStyle()` | řádek ~936 |

Řádky jsou orientační — plán je musí dohledat podle `pantoneRequired ||` , ne podle čísla.

### 5.5 Souhrn

Zhruba **20 zdrojových souborů + 1 migrace + ~8 testových**. Žádná nová komponenta —
všechno je větev vedle existujícího materiálového vzoru.

## 6. Ověření

### 6.1 Jednotkové testy

Rozšířit existující: `monitorChips`, `blockPayload`, `jobPresets`, `splitSharedFields`,
`undo/restoreFields`, `auditFormatters`, `seriesPropagation`, `splitHelpers`.

Fixtury stavět z tvarů, které produkční kód opravdu zapisuje (poučení P16). U testu, který
má hlídat konkrétní řádek, ověřit z druhé strany — **bez toho řádku musí padnout**
(poučení P11).

### 6.2 Proklik na testovací instanci nad kopií produkce

Podle poučení z 9. 8. 2026 (7 vad, které testy ani review nechytily). Scénář je postavený
tak, aby **každý krok vedl přes jiný z neohlídaných seznamů**:

1. Založit zakázku v builderu s pantone SKLADEM → *POST route, useJobBuilder*
2. Otevřít modal, přepnout na VYDÁNO → *PUT route, BlockEdit, side-effekty*
3. Dvojklik na čip → ověřit, že v kalendáři jsou obě tlačítka → *InlineDatePicker*
4. Zkopírovat zakázku (Ctrl+C / Ctrl+V) → *`blockPayload.ts`*
5. Rozdělit ji splitem → ověřit, že obě půlky mají stav → *split route, `splitSharedFields`*
6. Krok zpět → ověřit, že se stav vrátil → *`undo/restoreFields`, `EDIT_TRACKED_FIELDS`*
7. Zkontrolovat Monitor u stroje → *`monitorChips` vs `BlockCard`*
8. Otevřít historii bloku → ověřit české věty místo `true`/`false` → *`auditFormatters`*
9. Přihlásit se jako **MTZ** a zkusit obojí přepnout → *role allowlist*

Krok 9 je kritický: bez něj by se vada „nákup tlačítko vidí, ale nic neuloží" projevila
až v ostrém provozu, u toho, kdo si o funkci řekl.

### 6.3 Před nasazením

`npm run build` lokálně (chytí TS chyby dřív než server) + celá test suite. Na produkci
**vždy nejdřív `mysqldump` záloha**, pak `migrate deploy`, pak `prisma:bootstrap` není
potřeba (nepřidávají se číselníky). Otisk dat PRE/POST podle `docs/DEPLOY_WORKFLOW.md`.

## 7. Riziko

**Nízké.** Žádná nová komponenta, žádná změna chování existujících polí, migrace aditivní
s neutrálním defaultem. Jediné reálné riziko je **zapomenutý registr** ze seznamu 5.2 —
proto je ověření postavené tak, aby každý z nich měl vlastní krok prokliku.

## 8. Co se vědomě nedělá (YAGNI)

- **Vlastní číselník pantonů** (jaká barva, kolik kg) — zadání je o tlačítku, ne o skladové
  evidenci barev. Kdyby to nákup později chtěl, je to samostatná etapa nad vlastní tabulkou.
- **Notifikace při změně stavu pantonu** — materiál je nemá, pantone je mít nebude.
- **VYDÁNO v builderu / rezervacích / presetech** — nedává smysl při zakládání zakázky
  a materiál to tam taky nemá.
