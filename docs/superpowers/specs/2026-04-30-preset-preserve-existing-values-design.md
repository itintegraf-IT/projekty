# Aplikace presetu zachovává vyplněné hodnoty

**Datum:** 2026-04-30
**Autor:** Vojta Ťokan + Claude (brainstorming)
**Stav:** Schváleno k implementaci

## Kontext a problém

Plánovač popsal, že při změně presetu u zkopírovaného bloku se mu samo přepisuje pole "DATA datum". Konkrétní reprodukce z auditu:

```
29. 04. 14:22  l.lukes · Preset: XL 106 LED → XL 105
29. 04. 14:22  l.lukes · Stav zakázky: BEZ_SACKU → BEZ_TECHNOLOGIE
29. 04. 14:22  l.lukes · DATA datum: 11. 05. 2026 → 29. 04. 2026
29. 04. 14:22  l.lukes · Přidána
```

Klíčová věta z požadavku:
> "potřebuji, aby se tam neměnilo nic samo od sebe"

### Technický kořen

Funkce `applyJobPresetToDraft` v `src/lib/jobPresets.ts:125-129` při kliku na preset bezpodmínečně přepíše `dataRequiredDate` (a další offsetová pole) na `dnes + preset.dataRequiredDateOffsetDays`. Stejná logika se aplikuje na `materialRequiredDate`, `pantoneRequiredDate`, `deadlineExpedice` a další offsetová pole.

Workflow plánovače:
1. Vytvoří blok s presetem A → DATA = dnes + offsetA
2. Zkopíruje (`Ctrl+C`/`Ctrl+V`) → kopie zdědí DATA i jobPresetId
3. Otevře kopii, klikne na preset B (chce "změnit stroj")
4. DATA se přepíše na dnes + offsetB → překvapení

### Zvažované alternativy

- **Multipart preset "BROŽURA"** (návrh plánovače) — zamítnuto: velká nástavba (datový model, sync polí, decoupling), týdny práce, neřeší vlastní stížnost ("nic se nesmí měnit samo")
- **Confirmation dialog s checkboxy přepisovaných polí** — odloženo jako Varianta B; pokud Varianta A nebude stačit, lze nadstavit
- **Varianta A — zvolená:** preset přepíše hodnotu jen pokud je současně prázdná

## Pravidlo chování

**Klik na preset přepíše hodnotu pouze tehdy, je-li současné pole prázdné. Hodnoty, které blok již má (vyplněné ručně, zděděné po paste, nastavené předchozím presetem), zůstanou nedotčené.**

### Kategorizace polí

| Pole | Chování |
|---|---|
| `jobPresetId` | Vždy přepsat |
| `jobPresetLabel` | Vždy přepsat |
| `dataRequiredDate` | Jen když prázdné |
| `materialRequiredDate` | Jen když prázdné |
| `pantoneRequiredDate` | Jen když prázdné |
| `deadlineExpedice` | Jen když prázdné |
| `dataStatusId` | Jen když prázdné |
| `materialStatusId` | Jen když prázdné |
| `barvyStatusId` | Jen když prázdné |
| `lakStatusId` | Jen když prázdné |
| `specifikace` | Jen když prázdné (existující chování již prakticky odpovídá) |
| `blockVariant` | Jen když je "STANDARD" (existující chování) |
| `materialInStock` | Aplikovat z presetu, ale **nesmazat** vyplněné `materialRequiredDate` (viz Coupled fields) |
| `pantoneRequired` | Aplikovat z presetu, ale **nesmazat** vyplněné `pantoneRequiredDate` (viz Coupled fields) |

**Zdůvodnění "vždy" u identity presetu:** label a `jobPresetId` musí odpovídat skutečně aplikovanému presetu, jinak by blok "lhal".

**Zdůvodnění "jen když prázdné" u defaultů:** plánovač chce předvídatelnost; vyplněné hodnoty představují uvědomělé rozhodnutí (ruční zadání nebo zdědění z paste), které preset nemá právo přepsat bez explicitního zásahu uživatele.

**Pole `machine` není v rozsahu:** klik na preset v současném UI nemění stroj bloku. `JobPresetDraftValues` `machine` neobsahuje. Tato specifikace tedy `machine` neřeší.

### Coupled fields (boolean ↔ datum)

Současná logika `applyJobPresetToDraft` má dvě kouplované dvojice:

1. `materialInStock = true` → vymaže `materialRequiredDate` (skladem = bez deadlinu)
2. `pantoneRequired = false` → vymaže `pantoneRequiredDate` (bez pantone = bez deadlinu)

**Za nového pravidla:**
- Boolean flag se aplikuje (jeho default je `false`, takže ho považujeme za "empty" pro účely overwrite)
- **Sekundární smazání datumu se NEPROVEDE, pokud má uživatel datum vyplněno.** Plánovač by jinak ztratil ručně zadanou hodnotu.
- Důsledek: může vzniknout "nekonzistentní" stav (např. `materialInStock=true` + `materialRequiredDate=15.05`). Při ukládání bloku tento stav respektujeme — blok si datum ponechá. Toto je vědomá volba pro předvídatelnost.

### Definice "prázdné"

- DateString pole: `""`, `null`, `undefined`
- Codebook ID pole: `null`, `undefined`, `0` (pokud kódbook nemá záznam s id 0)
- Stringové pole: `""`, `null`, `undefined`

Implementace musí použít konzistentní `isEmpty(value)` helper, ne ad-hoc kontroly per pole.

## Scénáře (kontrakt chování)

### Scénář 1 — Nový blok (happy path)
1. Drag z fronty → všechna pole prázdná
2. Klik na preset XL 106 LED
3. Vyplní se: stroj, label, DATA, materiál, pantone, expedice, codebook hodnoty
4. **Výsledek:** identický s dnešním chováním

### Scénář 2 — Plánovačův scénář (paste + přepnutí presetu)
1. Blok na XL_106, preset "XL 106 LED", DATA = 11.05
2. `Ctrl+C` + `Ctrl+V` na XL_105 → kopie nese DATA = 11.05 a starý preset
3. Otevře BlockEdit, klikne na preset "XL 105"
4. **Výsledek:**
   - Změní se: `machine` → XL_105, `jobPresetId` → XL 105, `jobPresetLabel` → "XL 105"
   - Nezmění se: `dataRequiredDate`, `materialRequiredDate`, `pantoneRequiredDate`, `deadlineExpedice`, codebook hodnoty
   - Audit log: jeden řádek `Preset: XL 106 LED → XL 105`

### Scénář 3 — Ručně vyplněná hodnota
1. Nový blok, ručně napíše DATA = 15.05
2. Klikne na preset XL 106 LED (jeho default by byl 11.05)
3. **Výsledek:** DATA zůstane 15.05, ostatní prázdná pole se vyplní z presetu

### Scénář 4 — Přepnutí presetu po prvním vyplnění
1. Nový blok, klik na preset A → DATA = dnes + offsetA
2. Hned klik na preset B
3. **Výsledek:** DATA zůstane (dnes + offsetA), stroj a label se změní na B
4. **Trade-off:** pokud user chce přepsat defaulty z B, musí ručně smazat datum a kliknout znovu

### Scénář 5 — Reset (znovu načíst defaulty z presetu)
1. Otevře blok se zděděnými deadliny
2. Smaže ručně DATA, materiál, pantone, expedice
3. Klikne na preset
4. **Výsledek:** všechna prázdná pole se vyplní z presetu

### Scénář 6 — Job builder (zakládání nového bloku z fronty)
- Stejné chování jako Scénář 1: typicky první akce = výběr presetu, všechna pole prázdná, vše se vyplní

## UI dopady

### BlockEdit
- Méně zásahů při kliku na preset → existující potvrzovací dialog (`overwrittenFields` v `BlockEdit.tsx:344-366`) ukazuje kratší seznam (typicky jen stroj + label, případně nic)
- **Otevřená otázka pro implementační plán:** zda dialog v některých případech úplně přeskočit (když není co přepisovat) — to vyřešíme v plánu, ne v této specifikaci

### Audit log
- Méně řádků při změně presetu → typicky jen `Preset: X → Y`, žádný šum z přepočtu deadlinů

### Planner timeline / rezervace / batch
- Žádná změna chování

## Rozsah změny

### V rozsahu
- Úprava `applyJobPresetToDraft` v `src/lib/jobPresets.ts` — všechna pole kromě `jobPresetId`/`jobPresetLabel` přepisovat jen když je současná hodnota prázdná
- Coupled clearing materialRequiredDate/pantoneRequiredDate provádět jen když je datum prázdné
- Aktualizace `overwrittenFields` logiky tak, aby reflektovala nové chování (pole se nepřepisuje → není v seznamu "přepsaných")
- Ověření obou call-sitů (`BlockEdit.tsx applyPreset`, `PlannerPage.tsx applyPresetToBuilder`)
- Testy pro nové chování (unit testy `src/lib/jobPresets.test.ts`)

### Mimo rozsah
- BROŽURA / multipart preset
- Confirmation dialog s per-field checkboxy (Varianta B)
- Tlačítko "Reset defaulty z presetu" / Shift+klik = force apply
- Refactor preset UI nebo Job builderu nad rámec nutného

## Rizika a mitigace

| Riziko | Pravděpodobnost | Dopad | Mitigace |
|---|---|---|---|
| Někde v kódu se očekává force-overwrite chování | Nízká | Střední | Při psaní plánu zmapovat všechny call-sity `applyJobPresetToDraft`, ověřit chování |
| User si stěžuje na "preset nepřepsal datum" | Nízká | Nízký | Plánovač sám požádal o tohle chování; pokud zazní, přidat Variantu B |
| Změna sémantiky překvapí jiného uživatele | Střední | Nízký | Krátká poznámka v changelogu / informování plánovače |
| Test suite chybí pro `applyJobPresetToDraft` | Střední | Nízký | Přidat unit testy v plánu |

## Definition of Done

- `applyJobPresetToDraft` přepisuje datumy a codebook hodnoty pouze když jsou prázdné
- `machine`, `jobPresetId`, `jobPresetLabel` se přepisují vždy
- Existující `overwrittenFields` dialog ukazuje pouze pole, která se opravdu přepisují
- Unit testy pokrývají všech 6 scénářů z této specifikace
- `npm run build` zelený
- `npm run lint` 0 errors
- Manuální test ve dvou scénářích (1 a 2) v lokální instanci
- Audit log neobsahuje "fantom" změny u polí, která se nepřepsala
