# Spec: OBÁLKA / VNITŘKY + Tiskové archy + Série

Datum: 2026-06-09
Autor: Vojta + Claude (brainstorming)
Stav: schváleno k implementaci
Vizuální náhledy: `docs/superpowers/mockups/scene-timeline.html`, `docs/superpowers/mockups/scene-form-dtp.html`

## Motivace

Planovač potřebuje udělat pořádek v plánování obálek a knižních bloků — a zakázek, kde se z jednoho tiskového listu tiskne něco na obou strojích (obálka na XL 105, vnitřky na XL 106). Dnes to z plánu nepozná. Řešení musí být **additivní** — nesmí rozkopat zaběhnuté zadávání zakázek.

## Cíle

1. Dvě zaškrtávací dlaždice ve Výrobních sloupečcích: **OBÁLKA**, **VNITŘKY** (jeden klik = označeno).
2. Označení se zobrazí jako **barevný štítek** v plánu (timeline blok) i v DTP dashboardu.
3. Multi-select **Tiskové archy** — odškrtnutí, kterých archů se záznam týká.
4. Multi-select **Série** — pro velké náklady (nad ~50 000 ta), kdy se série netiskne po sobě.
5. Rozsah Tiskových archů a Sérií je **spravovatelný v adminu** (číselníky).

## Non-cíle (mimo rozsah)

- Tiskové archy a Série se **nezobrazují jako štítky v plánu ani v DTP** — jen jako interní metadata ve formuláři a v read-only detailu bloku.
- Žádná změna plánovací/validační logiky, překryvů, pracovní doby, auth ani deploy postupu.
- Žádný redesign formuláře — jen **jeden nový řádek** ve Výrobních sloupečcích.
- Štítky v denním reportu / expedici — neřešíme teď (možné později).
- Filtrování plánu/DTP podle nových polí — neřešíme teď.

## Datový model

Čtyři nová pole přímo na modelu `Block` (additivní, bez vztahové tabulky — produkční `Block.id` je `INT UNSIGNED`, FK migrace by spadla na errno 150):

| Pole | Typ Prisma | Default | Význam |
|---|---|---|---|
| `obalka` | `Boolean` | `false` | štítek OBÁLKA |
| `vnitrky` | `Boolean` | `false` | štítek VNITŘKY |
| `tiskoveArchy` | `String?` | `null` | vybrané archy, uloženo jako JSON pole labelů |
| `serie` | `String?` | `null` | vybrané série, uloženo jako JSON pole labelů |

### Formát uložení multi-selectů

`tiskoveArchy` a `serie` se ukládají jako **JSON pole vybraných labelů**, např. `["1. TA","5. TA","6. TA"]` a `["1. série","3. série"]`.

Důvod volby labelů (ne ID číselníku): pole jsou **display-only metadata**. Uložením labelu je hodnota self-contained (zobrazení bez nutnosti načítat číselník) a je to **snapshot** — když admin později položku přejmenuje, historické bloky si drží to, co bylo vybráno. Matchování ve formuláři probíhá podle labelu (labely jsou v rámci kategorie unikátní).

Parsování/serializace + zobrazení (join `", "`) izoluju do helperu `src/lib/productionTags.ts` (+ unit testy na round-trip a defenzivní parse nevalidního JSON).

## Správa v adminu

Dvě nové kategorie číselníku (model `CodebookOption`, beze změny schématu):

- `TISKOVY_ARCH` (label záložky „TISKOVÝ ARCH")
- `SERIE` (label záložky „SÉRIE")

Admin tab Číselníky je generický nad polem `CATEGORIES` v `AdminDashboard.tsx` — přidání dvou kategorií do `CATEGORIES`/`CATEGORY_LABELS`/`PILL_KEYS` zpřístupní celý existující CRUD (přidat, řadit, deaktivovat, obarvit) bez nového UI.

Předvyplnění 1.–20. (TA i série) idempotentně přes bootstrap (`npm run prisma:bootstrap`), aby Vojta nezačínal z prázdna. Seed musí být idempotentní (kontrola existence před insertem).

## UI

### Formulář bloku — `src/components/BlockEdit.tsx`

Nový řádek **uvnitř** sekce „Výrobní sloupečky", pod stávajícími mřížkami (skrytý pro `type === "UDRZBA"`, jako zbytek sekce):

```
[ OBÁLKA (dlaždice) ] [ VNITŘKY (dlaždice) ] [ Tiskové archy ▾ ] [ Série ▾ ]
```

- OBÁLKA/VNITŘKY = přepínací dlaždice ve stylu stávajících SKLAD/VYDÁNO tlačítek (toggle s checkboxem).
- Tiskové archy/Série = nová komponenta `src/components/MultiSelectDropdown.tsx` (popover s checkbox seznamem, čte options z číselníku, click-outside zavře, iOS-like vzhled, trigger ukazuje souhrn vybraných).
- Editace celého řádku gated za `canEdit` (ADMIN/PLANOVAT) — DTP/MTZ nevidí editaci (stejný pattern `opacity/pointerEvents` jako jinde).

### Štítky v plánu — `src/app/_components/TimelineGrid.tsx`

Štítky OBÁLKA/VNITŘKY ve všech třech velikostních režimech bloku:

- `MODE_FULL` (≥60 px): absolutně **vpravo dole** v bloku.
- `MODE_COMPACT` (48–59 px): v pravém clusteru vedle status chipů.
- `MODE_TINY` (<48 px): zkrácené **OB. / VN.** v pravém clusteru.

Barvy (pevné, ne z číselníku — jsou to booleany):
- OBÁLKA = žlutá/amber (`#facc15`, ladí s 1.png), tmavý text.
- VNITŘKY = tyrkysová (`#22d3ee`, `--badge-cyan`), tmavý text.

V režimu Tiskař zobrazit stejně (read-only), nenarušit stávající tiskové poznámky.

### DTP dashboard — `src/components/DtpPanel.tsx`

Štítky OBÁLKA/VNITŘKY do chip řádku v `BlockCard` (vedle DATA chipu).

### Read-only detail — `src/components/BlockDetail.tsx`

Nové řádky (jen když mají hodnotu):
- „Typ tisku" → mini štítky OBÁLKA/VNITŘKY
- „Tiskové archy" → výpis (join `", "`)
- „Série" → výpis

## Touch-points (protáhnout 4 pole, jinak tichá ztráta dat)

1. **Typ `Block`** ([TimelineGrid.tsx](src/app/_components/TimelineGrid.tsx) export) — přidat 4 pole jako **optional**, aby nespadla kompilace v ~10 souborech.
2. **Serializace** — `api/blocks/route.ts` (GET seznam + POST create), `api/blocks/[id]/route.ts` (GET/PUT), `api/blocks/batch/route.ts`. Vrací nová pole → projdou do UI i SSE.
3. **Copy/Paste** — `PlannerPage.tsx:2384` přidat do payloadu.
4. **Duplikace** — `PlannerPage.tsx:~1657`.
5. **Batch přesun / undo** — `PlannerPage.tsx:~1769`.
6. **Audit log** — `auditFormatters.ts` `FIELD_LABELS` + diff v PUT route (změny se zapíšou do historie).
7. **Role filtr v PUT** — editace nových polí jen pro ADMIN/PLANOVAT (ne DTP/MTZ/OBCHODNIK/TISKAR/VIEWER).

## Chování série a splitu

- **Opakovaná série (↻):** nová pole jsou per-výskyt → přidat do `SERIES_EXCLUDED_FIELDS` ([seriesPropagation.ts](src/lib/seriesPropagation.ts)). Úprava jednoho výskytu nepřepíše sourozence.
- **Split:** nová pole **NEjsou** ve `SPLIT_SHARED_FIELDS` (PlannerPage i `api/blocks/[id]/route.ts`). Každá část splitu si drží vlastní obálka/vnitřky/TA/série. (Rozhodnutí Vojta 2026-06-09: série/archy se mezi částmi splitu typicky liší.)

## Bezpečnost a kvalita (dle audit best-practices)

- API chyby přes `AppError`/`isAppError`, logování přes `logger` (ne `console`).
- Každá mutace nových polí v `$transaction` s auditním zápisem.
- ENV/secret beze změny.
- Nová UI komponenta `MultiSelectDropdown` jako samostatný named export v `src/components/`.
- Migrace: prosté `NULL`/`default` sloupce, žádný FK. Deploy klasicky `migrate deploy` + povinná PRE/POST `mysqldump` záloha.

## Testy

- `src/lib/productionTags.test.ts` — serialize/parse round-trip, prázdný/nevalidní vstup, join pro zobrazení.
- Po implementaci `npm run build` + `npm run lint` + celá test suite zelená (stávajících 37 + nové).

## Otevřené drobnosti (lze doladit při implementaci)

- Přesný odstín VNITŘKY (tyrkysová) — Vojta může změnit.
- Zkratky pro MODE_TINY (OB./VN.) — finální podoba dle místa.
