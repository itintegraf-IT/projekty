# Kontrolní panel — přesnost a čitelnost (etapa 2) — Design

**Datum:** 2026-08-13
**Autor:** Vojta + Claude
**Stav:** návrh ke schválení
**Navazuje na:** `docs/superpowers/specs/2026-07-17-kontrolni-panel-reporty-design.md` (v1)

## Proč

Vojta otevřel Kontrolní panel na produkčních datech a viděl `Split-skupina s méně než 2 bloky: 9`.
Nešel otevřít seznam, nešlo poznat, co to znamená, a nešlo s tím nic udělat.

Průzkum nad ostrou databází (13. 8. 2026) ukázal, že to není okrajová vada UI, ale **chyba
v samotném zadání kontroly** — a že panel má i druhý problém: mlčí o tom, co nález znamená.

### Co ukázala produkční data

**Kontrola `undersizedSplitGroup` hlásí normální provoz jako problém.**
Z 24 split-skupin je 10 podměrečných: 9 jednočlenných + 1 prázdná. Černá skříňka
(`BlockRevision`) vysvětlila 8 z 10 přímo — ve **všech** případech jde o týž vzorec:
plánovač rozdělil zakázku a pak jednu z půlek smazal. Zbylé dvě skupiny (1232, 1233
z 5. 8.) jsou starší než revizní žurnál.

| Skupina | Zakázka | Co se stalo | Zbylo |
| --- | --- | --- | --- |
| 1230 | 18447 | blok 1322 smazán 12. 8. | 1323 |
| 1231 | 18429 | 1340 smazán → undo vzkřísil → smazán znovu | 1361 |
| 1232 | 18447 | před spuštěním skříňky (5. 8.) | 1321 |
| 1233 | RXXXX | před spuštěním skříňky (5. 8.) | 1378 |
| 1234 | R4949 | smazány **obě** půlky (1384 i 1383) | *prázdná* |
| 1235 | 18719 | ocas 1417 vznikl SPLITem 12:05, smazán 12:27 | 1357 |
| 1236 | 18673 | ocas 1419 vznikl SPLITem, smazána hlava 1341 | 1419 |
| 1237 | ALBI | ocas 1439 vznikl 14:42:37, smazán 14:42:**43** | 664 |
| 1238 | IML | ocas 1459 vznikl 10:33, smazán 12:16 | 634 |
| 1239 | 18822 | ocas 1473 vznikl 07:48, smazán 11:27 | 1470 |

Zbylých 10 integritních kontrol hlásí na ostrých datech samé nuly. Celý červený odznak
Reportů tedy dnes svítí kvůli jediné kontrole, která měří, kolikrát se plánovač rozmyslel.

**Osamocený blok přitom nic nerozbíjí.** Každý konzument `splitGroupId` se ptá na počet
sourozenců, ne na existenci skupiny:

| Místo | Kód | Chování u osamoceného bloku |
| --- | --- | --- |
| Pilulka „1/2" na kartě | `TimelineGrid.tsx:2124` — `siblings.length > 1 ? … : 0` | nezobrazí se |
| Σ tisku skupiny v detailu | `BlockDetail.tsx:241` — `if (siblings.length < 2) return null` | nezobrazí se |
| Panel „Druhá část" | `BlockDetail.tsx:371-378` — `if (!partner) return null` | nezobrazí se |
| Chip partnera u tiskaře | `splitHelpers.ts:25` — `candidates.length === 0 → null` | nezobrazí se |
| Propagace sdílených polí | PUT `updateMany where splitGroupId=G, id≠self` | trefí nula řádků, no-op |
| Odstín karty | `blockShades.ts:33` — `g<groupId>` místo `b<blockId>` | jediný reálný dopad |

Navíc se to samo uzdraví: při dalším rozdělení téhož bloku `split/route.ts:95` existující
skupinu převezme (`block.splitGroupId ?? create`) a skupina je zase dvoučlenná. A plánovač
s tím stejně nemůže nic udělat — PUT `splitGroupId` záměrně zahazuje (`route.ts:120`).

**Tři další kontroly nemohou nikdy vystřelit.** `orphanSplitGroup`, `orphanReservation`
a `orphanRecurrenceParent` hlídají odkaz na neexistující řádek, jenže všechny tři sloupce
mají cizí klíč (ověřeno v `information_schema` nad ostrou DB: `Block_splitGroupId_fkey`,
`Block_reservationId_fkey`, `Block_recurrenceParentId_fkey`). Jsou to natrvalo zelené řádky.
Reálný smysl má jen `orphanJobPreset` — ten cizí klíč nemá.

**Seznam nálezů se do UI nikdy nedostane.** Server u integrity posílá až 50 `sampleBlockIds`,
`HealthPanel.tsx:185` použije `[0]` a zbytek zahodí. Ostatní čtyři karty mají plné tabulky.

### Vedlejší zjištění (mimo rozsah, ale zapsané, ať se neztratí)

- **Rozdělení bloku nemá undo.** `handleSplitBlockAt` (`TimelineGrid.tsx:1229`) ani
  `handleBlockCreate` (`PlannerPage.tsx:1579`) neregistrují undo snapshot. Plánovač splitnutí
  vrací zpět tím, že ocas smaže — u skupiny 1237 to udělal 6 sekund po splitu. Samostatná
  featura, ne oprava panelu.
- **Migrace `20260811120000_add_pantone_in_stock_issued` není na produkci nasazená.**
  Poslední aplikovaná je `20260808120000_block_revision_via_many` (9. 8. 2026). Prod proto
  nemá sloupce `Block.pantoneInStock` a `Block.pantoneIssued`. Viz „Podmínky nasazení".

## Cíl a rozsah

Panel má přestat lhát a začít vysvětlovat. **Zůstává read-only** — žádné opravné akce,
žádné mazání prázdných skupin, žádná změna závažnosti ani odznaku v hlavičce, žádný cron.

### Non-goals (vědomě mimo tuto etapu)

- Auto-fix akce jakéhokoli druhu (mazání sirotčích `SplitGroup` řádků, hromadná oprava presetů).
- Triáž nálezů podle závažnosti a s tím spojená změna odznaku v hlavičce Reportů.
- Undo pro rozdělení bloku.
- Notifikace, cron, periodické spouštění kontrol.

## Rozhodnutí (schválena Vojtou 13. 8. 2026)

| Rozhodnutí | Volba |
| --- | --- |
| Rozsah etapy | Přesnost + čitelnost; panel zůstává read-only |
| `undersizedSplitGroup` | **Zrušit** a nahradit kontrolou rozešlých sdílených polí |
| Tři kontroly garantované cizím klíčem | **Zrušit** |
| Seznam integritních nálezů | Rozbalovací řádky v jedné kartě Integrita |
| Vysvětlivky „co to znamená / co s tím" | U **všech** kontrol, ne jen u integrity |
| Selhání jedné kontroly | Ukázat ji jako **„nespočteno"**; ostatní doběhnou |

## Změna 1 — sada kontrol

Seznam integritních kontrol se zkrátí z 11 na 8.

| | Kontrola | Osud | Důvod |
| --- | --- | --- | --- |
| ✂️ | Osiřelá split-skupina | pryč | garantuje `Block_splitGroupId_fkey` |
| ✂️ | Osiřelá rezervace | pryč | garantuje `Block_reservationId_fkey` |
| ✂️ | Osiřelý rodič opakování | pryč | garantuje `Block_recurrenceParentId_fkey` |
| ✂️ | Split-skupina s méně než 2 bloky | pryč | měří legitimní akci plánovače (viz výše) |
| ✅ | Osiřelý jobPreset | zůstává | jediná bez cizího klíče |
| ✅ | Neplatný stroj · Neplatný typ · Konec ≤ začátek | zůstávají | beze změny logiky |
| ✅ | Vadné printMinutes · Nezarovnaný start · Nekonzistentní dokončení tisku | zůstávají | beze změny logiky |
| 🆕 | **Rozešlá split-skupina** | nová | viz Změna 2 |

## Změna 2 — nová kontrola `splitFieldsDiverged`

**Co hlídá:** členové jedné split-skupiny mají mít shodných 31 polí ze
`SPLIT_SHARED_FIELDS` (`src/lib/splitSharedFields.ts`). Když se některé rozejde, dvě části
téže zakázky se navenek tváří jako různá práce — jedna půlka tvrdí „materiál skladem",
druhá ne. CLAUDE.md tuhle třídu vad popisuje jako Critical nález go/no-go auditu z 5. 8. 2026
(„zapomenutý sourozenec = split skupina se sdílenými poli se tiše rozejde"), ale dnes ji
nehlídá nic.

**Proč to nebude falešný poplach:**
- `expeditionSortOrder` je mezi sdílenými poli, ale expedice ho nastavuje `updateMany`
  celé skupině najednou (`expedition/route.ts:112-115`) — rozejít se nemůže.
- Ověřeno nad ostrou databází: kontrola vrátila 8 nálezů, všechny skutečné (viz níže).

**Implementace:**
- Čistá funkce `computeSplitDivergence(blocks)` v `healthChecks.server.ts`, vedle stávajících.
- Vstup: bloky s `splitGroupId != null`, načtené **samostatným** `findMany` s rozšířeným
  `select` (na produkci ~30 řádků z 972). Hlavní dotaz nad celou tabulkou se nerozšiřuje.
- Porovnání po skupinách: pro každé pole `SPLIT_SHARED_FIELDS` normalizovaná hodnota
  (`Date → toISOString()`, `null/undefined → sentinel`, ostatní beze změny); víc než jedna
  distinct hodnota napříč členy = rozešlé pole.
- Skupiny s jedním členem se přeskakují (není co porovnávat).
- **Seznam polí pochází výhradně ze `SPLIT_SHARED_FIELDS`** — žádná ručně psaná kopie
  v SQL. Nový sdílený sloupec se tak automaticky začne hlídat.

**Jednotka nálezu = skupina, ne blok** (opravuje se skupina jako celek). Počet = počet
rozešlých skupin.

**České popisky a hodnoty se NEPÍŠOU znovu** — `FIELD_LABELS` a `fmtAuditVal`
(`src/lib/auditFormatters.ts`) už pokrývají všechna sdílená pole včetně boolean → `✓ Ano`/`✗ Ne`
a datumů. Nový formátovač by byl druhá kopie, která se rozejde.

### Očekávaný stav po nasazení: 8 nálezů, všechny legacy

Kontrola byla spuštěna nad ostrou databází (13. 8. 2026) a našla 8 skupin z 13 zdravých.
Ve všech se rozešla dvojice `jobPresetId` + `jobPresetLabel`, vždy stejným způsobem:

```
grp 565 · IML   · blok  565 = XL 106 IML  ·  blok  980 = —
grp 587 · IML   · blok  587 = XL 106 IML  ·  bloky 978, 979 = —
grp 968 · 18500 · blok  968 = XL 106 LED  ·  bloky 969, 970 = —
grp 1172 · r4817 · blok 1172 = XL 106 LED ·  blok 1173 = —
grp 1174 · r4818 · blok 1174 = XL 106 LED ·  blok 1175 = —
grp 1180 · 17755 · blok 1180 = XL 106 LED ·  blok 1181 = —
grp 1182 · 18154 · blok 1182 = XL 106 LED ·  blok 1183 = —
grp 1186 · 18014 · blok 1186 = XL 106 LED ·  blok 1187 = —
```

Preset má vždy jen ten člen, jehož `Block.id` se rovná `splitGroupId` — tedy starý kořen
z doby, kdy `splitGroupId` byla self-reference. Migrace B2 skupiny backfillovala s
`id = staré root PK` (`20260713120000_split_group_table/migration.sql`). Atomický `/split`,
který preset na ocas kopíruje, přišel commitem `cf04b207` **13. 7. 2026** — tentýž den.
Starý klientský split ho nepřenášel. Revize k tomu nic nemají, což sedí: skříňka běží na
produkci od 9. 8. 2026.

**Dnešní kód tenhle stav vyrobit neumí.** A dá se opravit z aplikace: `presetExplicitlyChanged`
je pouhá přítomnost pole v payloadu (`blocks/[id]/route.ts:317`) a `BlockEdit` ho posílá vždy
(`BlockEdit.tsx:560`) — stačí kteroukoli část otevřít a uložit, propagace srovná celou skupinu.

Panel tedy po nasazení ukáže **konečný seznam 8 opravitelných úkolů**, ne trvalý šum.

## Změna 3 — bohatší payload

`IntegrityIssue.sampleBlockIds: number[]` končí. Nově:

```ts
export type IntegrityItem = {
  id: number;            // blok, na který vede „Otevřít v plánu"
  orderNumber: string;
  machine: string;       // u rozešlé skupiny „XL_105 + XL_106"
  type: string;
  startTime: Date;
  detail: string;        // konkrétní vadná hodnota
};

export type IntegrityIssue = {
  key: string;
  label: string;
  count: number | null;  // null = nespočteno
  items: IntegrityItem[];
  error?: string;        // důvod, proč se nespočetlo
};
```

`detail` staví čistá funkce per kontrola (testovatelná bez DB):

| Kontrola | `detail` |
| --- | --- |
| `badPrintMinutes` | `45 min` |
| `unalignedStart` | `start 8:17` |
| `negativeInterval` | `konec 6:00 ≤ začátek 8:00` |
| `invalidMachine` / `invalidType` | syrová hodnota |
| `orphanJobPreset` | `preset #17 neexistuje` |
| `inconsistentPrintCompleted` | `dokončeno bez uživatele` / `uživatel bez času` |
| `splitFieldsDiverged` | `Preset: 1172 = XL 106 LED, 1173 = —` |

Každá z 5 karet dostane `error?: string` a `count: number | null` ze stejného důvodu.

## Změna 4 — odolnost proti selhání jedné kontroly

Dnes stačí jedna výjimka a endpoint vrátí 500; panel ukáže „Chyba kontroly" a sedm zdravých
kontrol je taky pryč. To je zvlášť nepříjemné u kontroly, která má odhalovat tiché vady.

Nově se **každá kontrola obalí vlastním try/catch**. Selhaná dostane `count: null` a `error`;
ostatní doběhnou. Souhrn to přizná: `2 problémy ve 2 z 5 kontrol · 1 kontrola nespočtena`.

Nula u selhané kontroly už nikdy nebude vypadat jako „v pořádku" — což je přesně to tiché
selhání, které by jinak panel diskreditovalo.

## Změna 5 — UI

### Vysvětlivky u všech kontrol

Nový modul `src/lib/healthCheckCopy.ts` — mapa `klíč → { znamena: string, coStim: string }`,
jediný zdroj pravdy sdílený kartami i integritními řádky. Text se zobrazí po rozbalení,
nad tabulkou. Vzor:

> **Drift konce bloku** — *Co to znamená:* někdo změnil směny nebo odstávky a uložený konec
> zakázky už tomu neodpovídá; karta v plánu je jinak dlouhá, než jak se doopravdy potiskne.
> *Co s tím:* v plánu klikni nad strojem na „Přepočítat" — bloky se posunou na platné sloty,
> zamčené se přeskočí.

### Rozbalovací integritní řádky

Řádek s nálezem je klikací; rozbalí se do vysvětlivky a tabulky **všech** nálezů. Tabulka je
pro všech 8 kontrol stejná — `Zakázka · Stroj · Detail · Otevřít v plánu` — takže se není
co učit znovu. Nulové řádky zůstávají tenké a zelené, bez rozbalování.

```
🧩 Integrita dat                                  8   ▾
│
│ ● Rozešlá split-skupina                         8   ▾
│   Co to znamená: části rozdělené zakázky mají mít shodné
│   údaje (zakázka, popis, deadline, stavy dat a materiálu).
│   Tady se rozešly — každá část tvrdí něco jiného.
│   Co s tím: otevři kteroukoli část a ulož ji; server
│   správnou hodnotu rozešle na zbytek skupiny.
│   ┌──────────┬─────────┬──────────────────────────┬────────────┐
│   │ IML      │ XL 106  │ Preset: 565 = XL 106 IML,│ Otevřít →  │
│   │          │         │ 980 = —                  │            │
│   └──────────┴─────────┴──────────────────────────┴────────────┘
│ ○ Vadné printMinutes (ZAKÁZKA)                  0
│ ○ Nezarovnaný start                             0
```

### Tři drobnosti

- Strop 50 se přizná: pod tabulkou `zobrazeno 50 z 200`. Dnes mlčí.
- Karta umí třetí stav `nespočteno` (žlutě) vedle zelené a červené.
- Souhrnný proužek stavy sečte: `2 problémy ve 2 z 5 kontrol · 1 kontrola nespočtena`.

### Dekompozice

`HealthPanel.tsx` má dnes 213 řádků; tyhle změny by ho nafoukly přes rozumnou mez a CLAUDE.md
v takovém případě žádá nejdřív navrhnout extrakci. Vzniknou dvě komponenty vedle něj
v `src/app/reporty/_components/`:

| Komponenta | Odpovědnost |
| --- | --- |
| `IntegrityRow.tsx` | jeden integritní řádek: stav, rozbalení, vysvětlivka, tabulka nálezů |
| `CheckExplainer.tsx` | dvojice vět „Co to znamená / Co s tím" nad tabulkou |

`HealthPanel` zůstává skládačkou, jako je dnes.

## Dotčené soubory

| Soubor | Změna |
| --- | --- |
| `src/lib/healthChecks.server.ts` | −4 kontroly, +`computeSplitDivergence`, `IntegrityItem`, per-kontrola try/catch |
| `src/lib/healthCheckCopy.ts` | **nový** — texty vysvětlivek |
| `src/app/reporty/_components/HealthPanel.tsx` | třetí stav karty, strop, souhrn, napojení nových komponent |
| `src/app/reporty/_components/IntegrityRow.tsx` | **nový** |
| `src/app/reporty/_components/CheckExplainer.tsx` | **nový** |
| `src/app/reporty/_components/useHealthData.ts` | typy podle nového payloadu |
| `src/lib/healthChecks.server.test.ts` | rozšíření (viz Testy) |

`src/app/api/report/health/route.ts` se **nemění** — zůstává tenkou routou.

## Testy

Do `src/lib/healthChecks.server.test.ts`:

- `computeSplitDivergence`: shodná skupina → prázdno; rozešlé pole → nález s očekávaným
  `detail`; jednočlenná skupina → přeskočena; `null` vs. hodnota → nález (sentinel funguje);
  `Date` se stejným časem v různých instancích → **žádný** nález (normalizace).
- Strážný test: seznam porovnávaných polí se rovná `SPLIT_SHARED_FIELDS` — přidání sdíleného
  pole bez pokrytí kontrolou musí shodit test, ne projít tiše.
- Strážný test: každé pole ze `SPLIT_SHARED_FIELDS` má záznam ve `FIELD_LABELS`. Dnes to
  platí (ověřeno 13. 8. 2026, 31/31), ale kontrola na tom nově stojí — bez popisku by se
  v `detail` objevil syrový název sloupce.
- Zrušené kontroly už v `breakdown` nejsou; nová tam je.
- `detail` buildery pro `badPrintMinutes`, `unalignedStart`, `negativeInterval`.
- Selhání jedné kontroly: ostatní doběhnou, selhaná má `count: null` + `error`.

Existující testy zrušených kontrol se odstraní.

## Podmínky nasazení

- **Migrace `20260811120000_add_pantone_in_stock_issued` musí být na produkci nasazená dřív
  než tahle etapa.** Nová kontrola čte `pantoneInStock` a `pantoneIssued`, které prod dnes
  nemá (poslední aplikovaná migrace je `20260808120000_block_revision_via_many`). Bez toho
  spadne `P2022`. Kontrola sloupce nevyjmenovává ručně v SQL — bere je z typovaného Prisma
  `select`, takže chyba přijde hlasitě, ne tiše.
- Před zásahem na produkci `mysqldump` záloha (standardní pravidlo projektu).
- Etapa nepřidává žádnou vlastní migraci — je čistě aplikační.
- Zvážit nasazení nejdřív na testovací instanci (port 3021, `igvyroba_test`) pro Lukáše.

## Známá omezení

- Panel zůstává nasnímaný k času kontroly; není živý (nutno „Překontrolovat teď").
- Jednočlenné a prázdné split-skupiny se přestanou zobrazovat úplně. Kdyby je někdo chtěl
  v budoucnu uklidit, je k tomu potřeba mutační cesta, kterou tahle etapa vědomě nestaví.
- `orphanJobPreset` a `splitFieldsDiverged` jsou jediné integritní kontroly bez databázové
  pojistky; ostatní hlídají hodnoty, ne vazby.
