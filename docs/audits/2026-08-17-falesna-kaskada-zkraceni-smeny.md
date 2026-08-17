# Audit: falešná hláška „Zkrácení směny ovlivní existující bloky"

Datum: 17. 8. 2026 · Podnět: připomínka tiskaře (l.lukes) — při **přidávání** sobotních směn
(kvůli poruchám) dialog pokaždé tvrdil, že jde o *zkrácení* směny.
Stav: **kořenová příčina prokázána, nic neopraveno.**

---

## 1. Závěr

Kontrola kaskády (`findConflictingBlocks`) **nepoznává tiskové hodiny ani odložené bloky**
a **není diferenční** — neporovnává stav před a po. Odpovídá na otázku *„leží po uložení
nějaký blok mimo pracovní dobu?"*, ne *„zkrátil uživatel směnu?"*. Titulek dialogu
„Zkrácení směny…" je v komponentě napevno.

Důsledek: dialog vyskočí u **jakéhokoli** uložení směn týdne, ve kterém leží zakázka
překlenující pauzu (typicky noční, protože noční směna se nejezdí) nebo vědomě odložená
zakázka — **včetně uložení, které nemění vůbec nic**.

Na produkci je 15 takových zakázek (XL 105: 11, XL 106: 4; měřeno 17. 8. 2026).

## 2. Cesta hlášky

1. `MachineWorkHoursWeek.submitSave` (admin mřížka) nebo `PlannerPage` (táhla směn v plánu)
   → `PUT /api/machine-week-shifts`
2. `route.ts:294-302` → `findConflictingBlocks` → při neprázdném výsledku `409 SHIFT_SHRINK_CASCADE`
3. Klient → `ShiftCascadeDialog`; titulek `ShiftCascadeDialog.tsx:72` je konstanta

## 3. Kořenové příčiny

### A. Validátor předchází tiskovým hodinám (hlavní)

`findConflictingBlocks.ts:196` volá `checkScheduleViolationWithTemplates`
(`scheduleValidation.ts:99-125`), který jde blok slot po slotu a **vyžaduje každý
30minutový slot v aktivní směně**.

Od tiskových hodin (etapy 1–6, 6–7/2026) ale zakázka legitimně obsahuje pauzu —
`expandPrintTime` sama vyrábí segmenty `kind: "pause"` (`printTime.ts:82-104`).
Dvousměnný provoz (noční `nightOn = 0`) znamená, že **každá zakázka přetékající přes
22:00 obsahuje pauzu 8 h** a starý validátor ji hlásí jako „mimo provoz".

`checkScheduleViolationWithTemplates` má **jediné produkční volající místo** — právě tohle.
(Opraveno 17. 8. 2026 po multi-agent review: druhý volající je `scripts/seed-test-pripominky-dev.ts:253`,
dev seed skript. Původní tvrzení „jediné volající místo v repu“ vzniklo grepem jen nad `src/`.
Navíc má funkčního dvojníka `blockOverlapsBlockedTimeWithTemplates` (`workingTime.ts:25`) s tímtéž
`hasAnyRowForWeek → isHardcodedBlocked` fallbackem, a rigidní pravidlo „mimo pracovní dobu **nebo
v odstávce**“ je třetí implementací v `overlapResolver.server.ts:151`.)

**Doplněk k příčině A (multi-agent review 17. 8. 2026):** starý validátor navíc **vůbec nezná
`CompanyDay`** — dostává jen `weekShifts`. Kontrola kaskády tedy dnes odstávky ignoruje na obou
větvích, nejen u zakázek.

### B. Kontrola je absolutní, ne diferenční

Nikde v cestě (klient ani server) neexistuje srovnání starých a nových řádků. Přidání směny
nemůže existující porušení odstranit → dialog se vrací při každém uložení téhož týdne.

### C. Chybí filtry, které má `detectCalendarDrift`

`where` je jen `{ machine, span-overlap okno }` (`findConflictingBlocks.ts:129`) — **žádný
filtr na `type`** (přes komentář „ZAKAZKA/DATA/MATERIAL"), **na `scheduleBypassed`,
`printCompletedAt` ani `printMinutes`**. Srovnej `calendarDrift.server.ts:97-108`, kde jsou
všechny čtyři a `scheduleBypassed: false` je dokonce obhájený komentářem.

Proto se hlásí i: vědomě odložená zakázka, už vytištěná zakázka, víkendová **údržba**
(ta je mimo pracovní dobu z definice — a přesně ji tiskař kvůli poruchám staví).

### D. Chybějící atomicita napříč stroji (vedlejší, ale reálný dopad)

`submitSave` posílá PUT **za všechny stroje v `MACHINES`**, i za ty netknuté. Když 409 přijde
od druhého stroje v pořadí, změna prvního **už je zapsaná** — a „Zrušit změnu" ji nevrátí.
Dialog navíc neříká, kterého stroje se týká.

## 4. Chronologie (proč to nikdo nezachytil)

| Datum | Commit | Co se stalo |
| --- | --- | --- |
| 20. 4. 2026 | `d1d90773` | `findConflictingBlocks` vzniká. Validátor je tehdy **správný** — blok musí ležet celý v pracovní době. |
| 6–7/2026 | etapy 1–6 | Tiskové hodiny: blok smí obsahovat pauzu. Validátor v kaskádě se nemigruje. |
| 3. 7. 2026 | `d6b37364` | Okno rozšířeno na span-overlap + sousední týdny. **Dopad se zvětšil** — víceden­ní bloky se do kontroly začaly dostávat. |
| 5. 7. 2026 | `ccb8baaf` | Další úprava téhož souboru, validátor opět nezměněn. |

## 5. Důkazy nad produkčními daty (17. 8. 2026)

Reprodukce nad skutečnými řádky `MachineWeekShifts` a skutečnou geometrií bloků
(`expandPrintTime` = kanonická pravda vs. `detectConflictsPure` = kaskádová kontrola):

| Zakázka | id | Stroj | Geometrie (Prague) | pm | pauza | Kanonicky | Kaskáda |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 18827 | 1479 | XL 106 | 17. 8. 21:00 → 18. 8. 11:30 | 390 | 480 | **konformní** | KONFLIKT 🚨 |
| 18447 | 1323 | XL 106 | 18. 8. 13:30 → 19. 8. 19:00 | 1290 | 480 | **konformní** | KONFLIKT 🚨 |
| 18805 | 1452 | XL 105 | 17. 8. 19:30 → 18. 8. 6:30 *(v době snímku)* | 180 | 480 | **konformní** | KONFLIKT 🚨 |
| 18805 | 1452 | XL 105 | 18. 8. 13:30 → 16:30 *(po přesunu)* | 180 | 0 | konformní | ok |
| 18429 | 1361 | XL 105 | 12. 8. 16:30 → 13. 8. 11:00 | 1110 | 0 | `scheduleBypassed=1` (odložená) | KONFLIKT 🚨 |
| 18429 | 1458 | XL 105 | 12. 8. 14:30 → 16:30 | 120 | 0 | konformní | ok |
| 18447 | 1321 | XL 106 | 13. 8. 6:00 → 11:00 | 300 | 0 | konformní | ok |

Všechny tři snímky ze připomínky jsou tím vysvětleny stroj po stroji, blok po bloku.
Kontrolní vzorky bez pauzy dialog nevyvolají — chová se to přesně podle mechanismu výše.

### Forenzní stopa z `AuditLog` (field = `MachineWeekShifts`)

Kódování: `so:xxx` = sobota neaktivní, `so:M--` = sobota ranní, `(Ae22:30)` = override konce
odpolední, `[FORCE]` = uloženo přes „Uložit i přesto".

| Čas 14. 8. | id | Zápis | Výklad |
| --- | --- | --- | --- |
| 06:40:56 | 6200 | XL_105 t17.8 **[FORCE]** `so:xxx → so:M--` | přidána sobota — jen přes force |
| 06:40:57 | 6201 | XL_106 t17.8 **[FORCE]** před == po | **no-op zápis netknutého stroje** |
| 06:44:21 | 6257 | XL_105 t17.8 [FORCE] `pá(Ae23:00) → pá` | skutečné zkrácení (z planneru, 1 stroj) |
| 07:26:28 | 6310 | XL_105 t10.8 [FORCE] `so:xxx → so:M--` | přidána sobota; 409 od odložené 18429 |
| 07:26:28 | 6311 | XL_106 t10.8 [FORCE] před == po | no-op |
| 12:14:31 | 6757 | XL_106 t10.8 `čt → čt(Ae22:30)` | **prodloužení**, bez force → bez dialogu |
| 14:11:55 | 6846 | XL_105 t17.8 `so:xxx → so:M--` | **sobota uložena BEZ force** (18805 už mimo noc) |
| 14:11:56 | 6847 | XL_105 t17.8 [FORCE] před == po | no-op |
| 14:11:57 | 6848 | XL_106 t17.8 [FORCE] před == po | no-op |

Dvě věci z toho plynou nade vši pochybnost:

1. **Uložení, které nemění vůbec nic** (`6201`, `6311`, `6847`, `6848`), vyvolá hlášku
   o zkrácení směny. Alarm nemá se zkracováním nic společného.
2. **Skutečné zkrácení prošlo tiše** (`6390` 8:05 — odebrání sobotní ranní na XL 105 bez
   force), protože na sobotě žádný blok nestál. Korelace alarmu s realitou je nulová v obou
   směrech.

## 6. Provozní dopad

- Hláška je falešný poplach; „Uložit i přesto" je **bezpečné** — `force=1` přeskočí jen tuto
  pre-kontrolu a TOCTOU re-check, samotné upserty směn jsou bit za bit stejné.
- Skutečná škoda je **habituace**: plánovač i tiskař se naučí dialog odklikávat, takže až
  přijde **pravá** kaskáda (zkrácení, které vystěhuje zakázku z pracovní doby), projde bez
  povšimnutí.
- Každý takový force zápis navíc vyrobí audit řádek a spustí `detectCalendarDrift` +
  notifikaci → šum v inboxu PLANOVAT/ADMIN.
- Kvůli bodu D může být zapsaná změna na prvním stroji, i když uživatel dal „Zrušit změnu".

## 7. Otevřené otázky pro fázi opravy (nerozhodnuto)

1. Má se validace nahradit voláním nad `expandPrintTime` (parita s `detectCalendarDrift`),
   nebo se má `checkScheduleViolationWithTemplates` zrušit úplně?
2. Má být kontrola diferenční (hlásit jen bloky, které se rozejdou **touto** změnou), nebo
   absolutní s pravdivým titulkem?
3. Jak zacházet s odloženými bloky a s údržbou — mlčet (jako `detectCalendarDrift`), nebo
   hlásit odděleně a jinou formulací?
4. Ukládat jen změněné stroje (nebo dávku atomicky), aby „Zrušit změnu" znamenala co říká?
