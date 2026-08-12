# Průzkum kódu před dotažením čitelnosti timeline

Datum: 12. 8. 2026 · Čtyři nezávislí agenti, jen čtení · Podklad pro
`docs/superpowers/specs/2026-08-12-citelnost-timeline-dotazeni-design.md`

Vznikl proto, že předchozí spec i plán byly psané z cizích shrnutí místo z kódu a obsahovaly čtrnáct věcných chyb. Tenhle dokument drží naměřená čísla, aby se k nim šlo vrátit.

## 1. Pevné velikosti písma

| Místo | Hodnota | Kde se kreslí | Geometrie |
| --- | --- | --- | --- |
| `BlockCard.tsx:154` `ProductionChips` | 8 px | všechny hustoty | padding 2/6, lineHeight 1 → box 12 px |
| `BlockCard.tsx:161` `maxWidth` | 132 px | jen zkrácená varianta (kompaktní, jednořádkový) | — |
| `BlockCard.tsx:746` badge `📝 N` | 10 px | **bezpodmínečně, nezávisle na hustotě** | padding 2/6 → box 14 px, top 7 px |
| `BlockCard.tsx:1197` popisek pauzy | 10 px | jen segment ≥ 40 px | padding 1/8 → box ~14 px |
| `SplitChip.tsx:35` | 10 px | kompaktní + plný | padding 3/8, border 2, lineHeight 1,1 → box 19 px |
| `TimelineGrid.tsx:1271` pruh driftu | 10 px | hlavička stroje | lineHeight 1,4, padding 2 → box 16 px |
| `TimelineGrid.tsx:1282` tlačítko Přepočítat | 10 px | hlavička stroje | lineHeight 1,4, padding 4 → box 18 px |
| `tiskarBlockView.ts` varianta `square` | 26 × 26 px, písmo 15 | kompaktní, jednořádkový | **pevný box nezávislý na písmu** |
| `PrintDoneButton.tsx:74` | `min(fontSize, 13)` | plný | vědomá ochrana proti přetečení |

**Mimo kartu, škálovat se nemá:** hover tooltip (`:1296-1484`), popover poznámky MTZ (`:196-227` a `:1211-1276`), kontextové menu (`:580`, `TimelineGrid.tsx:621`). Vše portálované do `document.body` s vlastní pevnou šířkou.

## 2. Stropy v jednořádkovém layoutu

Sedm stropů, všechny ve větvi `MODE_TINY || MODE_MICRO_TEXT`. Konstanty: `MICRO_CHIP_CAP_FACTOR` 0,65 (prvky s rámečkem, box = `fontSize + 4`), `MICRO_TEXT_CAP_FACTOR` 0,7 (čistý text).

**Chybí strop u:**

| Prvek | XL, karta 14 px | Číslo zakázky tamtéž |
| --- | --- | --- |
| `Lock` / `Hourglass` (ř. 951) | 12 px | 9,8 px |
| `↻` (ř. 977) a `✂` (ř. 980) | 10,6 px | 9,8 px |

U ikon problém začíná už na `L` (10 px proti 9,8).

**Strop je na `M` nefunkční u:** `SpecChip` (ř. 913) a `MiniChip` (ř. 973-975) — kritická výška 13,85 px je pod minimem větve (14 px). Na `L` a `XL` funguje.

**Opravený předpoklad:** `Clock` a zelená fajfka se v jednořádkovém layoutu **nekreslí** — jsou jen v kompaktním (ř. 831-832). `NUM_ICON_RATIO_CLOCK` má v souboru jediné použití.

`NUM_ICON_RATIO_MINOR` = `9 / 13,5` = 0,6667 · `NUM_ICON_RATIO_CLOCK` = `11 / 13,5` = 0,8148. Na `M` reprodukují přesně původních 9 a 11 px.

## 3. Hlavička stroje a časová osa

**Výška hlavičky.** Určuje ji vždy název stroje (řádkování 1,5 z Tailwind preflightu): `M` 18 px, `XL` 24,3 px. Pruh driftu má 16 px, tlačítko 18 px — **ani jeden hlavičku nikdy nezvýší**. Skutečná výška včetně odsazení 16 px a spodní hranice: `M` **35 px**, `XL` **41,3 px**. Konstanta `HEADER_HEIGHT = 33` je tedy vedle už na `M`.

**Konstanta možná nemá být vůbec.** Hlavička (`TimelineGrid.tsx:1250-1296`) **není potomkem scrollovacího kontejneru** — je jeho sourozenec (`{header}` na ř. 1572, `scrollRef` až na ř. 1574). Sticky štítek dne s `top: 33` (ř. 1611) si tedy rezervuje 33 px pod hlavičkou, ačkoliv s nulou by se zarovnal přesně pod ni. Nutno ověřit v prohlížeči.

`HEADER_HEIGHT` nemá jiné použití v celém `src/`. `ResizeObserver` se v projektu nepoužívá nikde.

**Ředění popisků osy.** `labelStep` (ř. 1406) řídí **nejen text popisků, ale i vodorovné čáry mřížky** (hodinové ř. 1952, půlhodinové ř. 1957).

Dosažitelné výšky slotu (rodič posílá už vynásobenou hodnotu): `M` 3-26 souvisle · `L` přeskakuje 10 · `XL` přeskakuje 5, 14 a 23.

Nejtěsnější případy:

| Stupeň | Výška slotu | Rozteč | Písmo | Rezerva |
| --- | --- | --- | --- | --- |
| M | 14 | 14 px | 9 | 5 px |
| L | 7 a 14 | 14 px | 10,35 | 3,65 px |
| XL | 7 (zoom 6) | 14 px | 12,15 | **1,85 px** |
| XL | 15 (zoom 13) | 15 px | 12,15 | **2,85 px** |

**Táž třída vady jinde:** prahy `height >= 18` (ř. 1654, 1899 — popisek firemního dne) a `h >= 14` (ř. 1682, 1704, 1784, 1806 — časy v zamčeném bloku a rezervaci). Obsah má napevno 9 px, takže nekonzistence nevzniká, ale prahy byly odhadnuté pro nescalovanou mřížku.

## 4. Šířky

**Sloupec stroje.** `DATE_COL_W` 44 px (jeden, sdílený), `TIME_COL_W` 72 px (**na každý stroj**), `ResizeHandle` 8 px (jen `canEdit`), panel 200-600 px (výchozí 320, jen `canEdit`).

Dvousloupcový pohled: `colWidth = (W − 196 − asideWidth) / 2`, karta je o 6 px užší.

| Šířka okna | panel 200 | panel 320 (výchozí) | panel 600 |
| --- | --- | --- | --- |
| 1366 | 479 | 419 | 279 |
| 1600 | 596 | 536 | 396 |
| 1920 | 756 | 696 | 556 |
| 2560 | 1076 | 1016 | 876 |

Tiskař vidí **jeden sloupec bez panelu**: `colWidth = W − 116`, tedy 1250 px při 1366. Role DTP/MTZ vidí dva sloupce bez panelu.

**Chip Pantone.** Řádek má `flexWrap: nowrap` + `overflow: hidden`, chipy `flexShrink: 0` — nezalamuje se ani nesmršťuje, ořízne se. Celý se vejde od karty **331 px při `M`** a **428 px při `XL`** (odhad šířky textu `znaky × fontSize × 0,55`, chyba ±15 %).

Prakticky: při `XL` se ořízne na 1366px obrazovkách i s výchozím panelem (chybí ~9 px); od 1600 px je to v pořádku, od 1920 px s rezervou.

**Nejdelší štítky z produkčního číselníku** (ověřeno v DB): materiál `MÍSTO PRO POZNÁMKU` (18 znaků), barvy `SCH Lumina LED` (14), lak `vysoce lesklá disperse` (22).

**Pravý shluk se nezalomí.** Má `flexShrink: 0`, takže ho flexbox nikdy nezmenší; místo toho ustoupí popis a v krajním případě se elipsou zkrátí **i číslo zakázky**. Teprve pak ořízne kartino `overflow: hidden` konec shluku. Předexistující chování.

## 5. Pilulka rozdělené zakázky

Kreslí se jen tiskaři — `splitPartner` je `null` pro všechny ostatní role (`TimelineGrid.tsx:2062`).

- **Kompaktní layout** (ř. 863): klikatelná pilulka **bezpodmínečně od 32 px**.
- **Plný layout** (ř. 1129): jen když projde `splitChipFits`.
- **Jednořádkový**: pilulka vůbec, jen textové `✂n/m`.

Po zavedení stupňů se karta překlápí do plného layoutu od 46 px, ale rozpočet pilulku propustí **až od 80 px**. V pásmu **46-79 px** tak tiskaři zbyde jen neklikatelná značka — bez jména partnerského stroje, bez stavu, bez času a bez kliku, který přepne na partnera.

## 6. Kritická regrese, nalezená tímto průzkumem

Oprava nálezu I1 zvedla práh pruhu „Hotovo" na `max(thresholds.full, rowHeights.header + 26)` = 50 px při `M`. Karta se ale do plného layoutu překlápí už při 46 px a plný layout vykresluje tlačítko **výhradně ve variantě `bar`** (`BlockCard.tsx:1115`); čtvercová je jen v kompaktním a jednořádkovém (`:862`, `:984`).

→ V pásmu **46-49 px neměl tiskař žádné tlačítko.** Zasažené kombinace: 1 h při zoomu 23 a 24, 1,5 h při 16, 2 h při 12, 3 h při 8, 4 h při 6.

Opraveno commitem `2c01e8e`: práh zpět na `thresholds.full`, výška pruhu se dopočítává z dostupného místa. Nejmenší pruh `M` 15 px · `L` 17 px · `XL` 21 px.

**Proč to nenašlo review:** posuzovalo diff opravy, kde bylo všechno správně. Vada vznikla ze součinnosti dvou modulů — jeden posunul práh, druhý vykresluje jen jednu variantu. Diff ani jednoho z nich tu vazbu neukáže.
