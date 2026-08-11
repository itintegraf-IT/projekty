# Čitelnost timeline — velikost písma v blocích (cesta C)

Datum: 11. 8. 2026 · Stav: schváleno k implementaci · Autor rozhodnutí: Vojta

## Problém

Plánovači hlásí, že písmo v blocích je malé a nevýrazné, zvlášť na menších
monitorech. Plán se navíc promítá na velkou tabuli, kde je nečitelný úplně.

Zoom slider nepomáhá, protože mění **jen `slotHeight`** (px na 30 minut, rozsah
3–26, výchozí 26 → hodina 52 px). Bloky se tím natáhnou svisle, ale písmo je
v `BlockCard.tsx` zapsané absolutně v pixelech a nehne se. Uživatelsky to
vypadá jako „roztahuje, ale nepřibližuje".

Naivní zvětšení písma nefunguje: blok se překlápí mezi hustotami podle své
výšky v px (`MODE_FULL` ≥ 48, `MODE_COMPACT` ≥ 44, `MODE_TINY` ≥ 24,
`MODE_MICRO_TEXT` ≥ 14, `BlockCard.tsx:512-515`). Když poroste jen písmo a prahy
zůstanou, obsah se ořízne.

## Rozhodnutí

Stavíme **cestu C — přeskládat**. Písmo roste, mřížka roste jen zčásti, a rozdíl
se doplatí přeskládáním layoutu do vodorovného prostoru, který dnes leží ladem.
**Z karty nezmizí žádná informace.**

Zvažované a zamítnuté alternativy:

| Cesta | Proč ne |
| --- | --- |
| A — lupa (písmo i mřížka stejným koeficientem) | Funguje a nic neztrácí, ale bere nejvíc rozhledu: v XL by se do stejného okna vešlo o ~26 % hodin míň. |
| B — jen písmo, mřížka fixní | Hodinové zakázce by zmizel řádek datumů D/M/E. Přímý rozpor se zadáním. |
| D — přeskládat a navíc vyhodit ↻ a mini-chipy do detailu | Pár procent písma navíc za skutečnou ztrátu informace na kartě. Zbytečné, když C stačí. |

## Odkud se bere místo

Dva zdroje, ani jeden není mazání informace:

1. **Datumový badge je dnes dvouřádkový** — popisek `DATA` na 8 px nad datem
   na 11 px, celkem ~22 px výšky (`DateBadge`, `BlockCard.tsx:150-158`). Přitom
   `MODE_COMPACT` o pár řádků níž zobrazuje tutéž informaci jednořádkově jako
   `D 12.8 ✓` (`BlockCard.tsx:832`) a vejde se do ~16 px. Písmeno `D`/`M`/`E`/`P`
   plus barevný proužek vlevo nesou stejný význam jako to slovo.
2. **Vodorovné místo.** Stroje jsou dva sloupce `flex: 1`, vpravo je
   `aside` (výchozí 320 px, uživatelsky roztažitelný 200–600). Na 1920px
   obrazovce vychází na sloupec ~777 px, na 1366px notebooku ~500 px. Obsah
   bloku dnes zabírá kolem 400 px, zbytek šířky se nevyužívá.

## Rozsah

**V rozsahu:**

- `BlockCard.tsx` — všechny hustoty (FULL / COMPACT / TINY / MICRO), všechny
  typy bloků (ZAKAZKA, REZERVACE, UDRZBA) i tiskařský režim.
- `TimelineGrid.tsx` — hodinové popisky na časové ose, hlavička stroje.
- Nový přepínač v hlavičce planneru + perzistence nastavení.

**Mimo rozsah** (písmo se nemění): postranní panely (fronta, DTP, inbox, audit),
malý kalendář, dialogy, admin, reporty, Monitor u stroje, expedice.

## Architektura

### Nový modul `src/lib/plannerTypography.ts` — jediný zdroj pravdy

Veškeré velikosti písma a odvozené prahy hustoty žijí v jednom modulu. Žádná
komponenta si nepočítá vlastní čísla.

```ts
export const PLANNER_FONT_SCALES = { M: 1.0, L: 1.15, XL: 1.35 } as const;
export type PlannerFontScale = keyof typeof PLANNER_FONT_SCALES;
export const DEFAULT_FONT_SCALE: PlannerFontScale = "M";

export type PlannerTypeScale = {
  /** Velikosti písma v px. */
  num: number; desc: number; chip: number; spec: number;
  mini: number; badge: number; rail: number; machineHead: number;
  /** Násobitel slotHeight — mřížka roste pomaleji než písmo. */
  slotFactor: number;
  /** Prahy hustoty odvozené z výšky řádků, ne zapsané ručně. */
  thresholds: { full: number; compact: number; tiny: number; micro: number };
  /** Práh pro dvouřádkovou specifikaci (dnes 80 px). */
  specTwoLine: number;
  /** Krytí popisu — v novém layoutu plný kontrast. */
  descOpacity: number;
};

export function plannerTypeScale(key: PlannerFontScale): PlannerTypeScale;
```

Hodnoty (`s` = koeficient stupně):

| Prvek | Dnes | Vzorec | M | L | XL |
| --- | --- | --- | --- | --- | --- |
| Číslo zakázky | 12 px / 700 | `12s + 1,5` / **800** | 13,5 | 15,3 | 17,7 |
| Popis | 10 px | `10s + 1` | 11 | 12,5 | 14,5 |
| Datum v chipu | 10–11 px | `10s + 0,5` | 10,5 | 12 | 14 |
| Specifikace | 10 px | `10s + 0,5` | 10,5 | 12 | 14 |
| Mini-chip (barvy, lak) | 8 px | `8s + 1` | 9 | 10,2 | 11,8 |
| Badge (deadline, kalendář) | 9 px | `9s` | 9 | 10,4 | 12,2 |
| Popisek hodiny na ose | 9 px | `9s` | 9 | 10,4 | 12,2 |
| Hlavička stroje | 12 px (`text-xs`) | `12s` | 12 | 13,8 | 16,2 |
| `slotFactor` | — | `1 + (s−1)·0,35` | 1,000 | 1,053 | 1,123 |
| Krytí popisu | 0,75 | — | **1,0** | 1,0 | 1,0 |

Prahy hustoty se **počítají z písma**, ne zapisují ručně — to je celé jádro
opravy:

```
full     = round(num · 1,25 + chip · 1,6 + 12)
compact  = full − 5
tiny     = round(24 · s · 0,9)
micro    = 14                       // neroste — jde jen o to, aby se vešlo číslo
specTwoLine = round(80 · s)
```

Konstanty `1,25` (výška řádku čísla) a `1,6` (výška jednořádkového chipu
i s rámečkem) jsou odhad výšky řádku z velikosti písma. **Musí se ověřit měřením
v prohlížeči** — viz Rizika.

### Zapojení `slotFactor` — pozor, tady je past

Mřížka roste přes násobitel `slotHeight`, ne novou geometrií:

```ts
const effectiveSlotHeight = Math.round(slotHeight * typeScale.slotFactor);
```

`Math.round` je povinný. `slotHeight` je celé číslo a veškerá matematika
drag & drop na něm stojí (`dateToY` / `yToDate`, `TimelineGrid.tsx:307-318`,
plus přepočty delty v drag handlerech). Neceločíselná hodnota by zavedla novou
třídu zaokrouhlovacích chyb do přetahování bloků. Zaokrouhlením dostaneme
prostě jinou celočíselnou hodnotu `slotHeight` a chování zůstává přesně to,
které je dnes odzkoušené.

**`slotHeight` zůstává surová hodnota jen pro slider a pro uložení
preference `zoom`. Všude, kde se z něj počítá geometrie, se používá
`effectiveSlotHeight`.** V `PlannerPage.tsx` to je: předání do `TimelineGrid`,
kotva zoomu (ř. 279, 289), skoky na blok a na datum (ř. 763, 849, 882, 901, 943,
981, 999, 2230). Uvnitř `TimelineGrid` se nemění nic — dostane už přepočtenou
hodnotu ve stávajícím propu `slotHeight`.

### Přepínač v hlavičce

Skupina `M · L · XL` hned za `ZoomSlider` (`PlannerPage.tsx:2874`), postavená
jako přesná kopie vzoru `30d · 60d · 90d` (`PlannerPage.tsx:2875-2913`): pilulka
`borderRadius: 999`, pozadí `--surface-2`, aktivní tlačítko `--brand`
s `--brand-contrast` textem, výška 24 px, písmo 11 px, `role="group"` +
`aria-label` + `aria-pressed`.

Umístění vedle zoomu je záměr: zoom říká *kolik toho vidím*, tenhle *jak je to
velké*.

Stupeň `S` (zmenšení pod dnešek) **se nedělá** — nikdo nechce menší písmo, než
je dnes, a tři tlačítka ušetří v už tak plné hlavičce ~38 px.

**Pozor na výklad stupně `M`: není to „dnešní stav".** Mřížka na `M` skutečně
zůstává na dnešní výšce (`slotFactor` = 1,0), ale písmo je i tak o něco větší
(číslo 13,5 px místo 12) a popis má plný kontrast. Přeskládání layoutu tu výšku
ušetří samo, takže se zvětšení dostane zadarmo, bez jediného pixelu scrollu
navíc. `M` je tedy „dnešní rozhled, čitelnější karta" — ne nulová změna.

Jako nová standalone komponenta `src/components/planner/FontScaleSwitch.tsx`
(named export) — do `PlannerPage.tsx` se nic inline nepřidává, soubor je
u limitu `max-lines`.

### Perzistence — na zařízení, ne na uživatele

Nastavení se ukládá **výhradně do `localStorage`** pod klíčem
`ig-planner-font-scale`. Na server se neposílá nic.

Vzorem je přepínač motivu (`ThemeToggle.tsx`, přes `next-themes`), který je
také jen lokální — **ne** šířka bočního panelu ani dnešní zoom, které přes
`savePreference` putují do tabulky `UserPreference` a následují uživatele mezi
počítači.

Důvod je věcný: velikost písma je vlastnost **obrazovky, na kterou se člověk
dívá**, ne toho člověka. Týž plánovač chce na 27" monitoru u stolu něco jiného
než na 13" notebooku a něco úplně jiného na tabuli. Kdyby se stupeň vázal na
uživatele, nastavení XL na projekčním počítači před poradou by mu přeplo
i notebook — a musel by to přepínat tam a zpět pořád dokola. Takhle se počítač
u tabule nastaví jednou na XL a zůstane tak bez ohledu na to, kdo se na něm
přihlásí; totéž platí pro kioskové terminály u strojů.

Cenou je, že kdo pracuje na dvou počítačích, nastaví si to dvakrát. U nastavení
vázaného na velikost obrazovky je to správné chování, ne nedostatek.

**Důsledky pro rozsah práce:**

- **`/api/me/preferences` se nedotýkáme.** Route má allowlist klíčů a přijímá
  výhradně číselné hodnoty (`route.ts:50-56`), takže uložit `"XL"` by skončilo
  chybou 400 nadvakrát. Tím, že na server nic neposíláme, celá tahle
  komplikace mizí — žádný nový allowlist, žádná změna sdílené route.
- **Žádná migrace ani změna schématu.**
- Neznámá nebo poškozená hodnota v `localStorage` → `DEFAULT_FONT_SCALE`.

Načtení kopíruje vzor dnešního zoomu (`PlannerPage.tsx:242-246`): stav se
inicializuje na `DEFAULT_FONT_SCALE` a `localStorage` se čte až v `useEffect`.
Znamená to krátké přeblesknutí výchozí velikosti při načtení stránky — **stejné
chování, jaké má dnes zoom**, takže nezavádíme novou třídu problému. Čtení
v lazy inicializátoru `useState` se záměrně nepoužívá: server by vyrenderoval
jinou velikost než klient a vznikla by chyba hydratace.

### Cesta props

`PlannerPage` drží stav `fontScale`, přes `useMemo` z něj udělá `PlannerTypeScale`
a pošle ho jako **nepovinný** prop `typeScale` do `TimelineGrid` → `BlockCard`.

`BlockCard` má druhého konzumenta — `DtpPanel.tsx:228`. Ten prop nepředá
a `BlockCard` musí degradovat na `plannerTypeScale("M")`, aby se DTP panel
nezměnil. Prop je proto nepovinný s výchozí hodnotou.

## Cílový layout bloku

### FULL (výška ≥ `thresholds.full`)

```
┌────────────────────────────────────────────────────────┐
│ 25-1902  IML Alimpex — jogurt 150 g      [UV LAK] ↻ ✂  │  ← řádek 1
│ D 13.8 !   M 14.8 ✕   E 22.8   P OK                    │  ← řádek 2
│ 4/4 + disperzní lak · 135 g KL · 12 000 archů          │  ← pás specifikace
└────────────────────────────────────────────────────────┘
```

Změny proti dnešku:

- **Řádek 1**: mini-chipy (materiál, barvy, lak), `↻` a `✂` se přesouvají
  z vlastní skupiny **doprava na řádek s číslem** (`margin-left: auto`).
  Nic se nemaže. Popis dostává `flex: 1` a ořezává se elipsou.
- **Řádek 2**: dvouřádkový `DateBadge` nahrazuje **jednořádkový chip** —
  týž tvar, jaký dnes používá `MODE_COMPACT`. FULL a COMPACT tím sdílejí
  jeden vzhled chipu.
- **Pás specifikace** beze změny (řídí se `showSpec = MODE_FULL`,
  dvouřádkový od `specTwoLine`).
- Popis má **plné krytí** místo 0,75.

Zaniká rozdvojení `showDatesFull` (≥ 60 px, plný badge) a `showDatesCompact`
(48–59 px, chip) — obojí je nově týž chip a řídí se jedním prahem
`thresholds.full`. **Funkce `DateBadge` se tím stává mrtvým kódem; ověřit, že
nemá jiného volajícího, a smazat ji.**

### COMPACT / TINY / MICRO

Struktura beze změny, mění se jen velikosti podle `PlannerTypeScale` a krytí
textu (0,75 → 0,9 v jednořádkových režimech; plná bílá by na TINY vedle sebe
postavila číslo a popis se stejným důrazem).

### Zbytek kontrastu

Doplňkové značky `↻` (0,4) a `✂` (0,55) zůstávají utlumené — jsou to vědomě
podřadné informace a na kartě jde o hierarchii, ne o to, aby všechno křičelo.
Zvětší se jim jen písmo.

## Chování na jednotlivých délkách

Mřížka je půlhodinová (`SLOT_MS`) a `DURATION_OPTIONS` (`plannerTypes.ts:49-54`)
nabízí výhradně násobky 30 minut od 0:30 do 40:00 — kratší blok nevznikne.

Při výchozím zoomu (`slotHeight` 26) a stupni XL má hodina 58 px, práh plného
layoutu 57 px:

| Délka | Výška | Návrh | Dnes |
| --- | --- | --- | --- |
| 4 h | 234 px | plný + specifikace | totéž |
| 3 h | 175 px | plný + specifikace | totéž |
| 2,5 h | 146 px | plný + specifikace | totéž |
| 2 h | 117 px | plný + specifikace | totéž |
| 1,5 h | 88 px | plný + specifikace | totéž |
| 1 h | 58 px | plný s datumy | totéž |
| 30 min | 29 px | jednořádkový | totéž |

**Žádná délka se nepropadne do nižší hustoty, než má dnes.** To je přejímací
kritérium celé etapy.

## Rizika

### 1. Prahy jsou na hraně (hlavní riziko)

Nejtěsnější místa po dopočtu všech tří stupňů:

| Stupeň | `slotHeight` | Hodina | Práh plného | Rezerva 1 h | 30 min vs. práh TINY |
| --- | --- | --- | --- | --- | --- |
| M | 26 | 52 px | 46 | +6 px | 26 vs 22 → +4 px |
| L | 27 | 54 px | 50 | +4 px | 27 vs 25 → +2 px |
| XL | 29 | 58 px | 57 | **+1 px** | 29 vs 29 → **rovnost** |

Půlhodinový blok v XL prochází **přesně na hraně** (podmínka je `>=`) a hodinový
s jediným pixelem rezervy. Vzorce `num · 1,25` a `chip · 1,6` jsou přitom
**odhad výšky řádku**, ne změřená hodnota — skutečná výška závisí na
`line-height`, `padding` a metrikách `-apple-system`.

Ošetření: strážný test (níž) povyšuje „mělo by projít" na build-time záruku.
Když neprojde, sníží se konstanty, ne prahy ad hoc.

### 2. Zaokrouhlení `slotHeight`

Ošetřeno `Math.round`, viz výše. Při implementaci ověřit, že se `slotHeight`
nikde neobchází a nepoužívá se surová hodnota tam, kde má být efektivní.

### 3. Tiskařský režim má vlastní prahy

`showSpec` je pro `isTiskar` vázán na 80 px, ne na `MODE_FULL`
(`BlockCard.tsx:526`) — pás specifikace by jinak na nízké kartě vytlačil
tlačítko Hotovo pod ořez (regrese z 3. 8. 2026). Tenhle práh se musí škálovat
také (`80 · s`) a nesmí se sloučit s běžnou větví.

### 4. Blok s pauzou uprostřed

Hustota se řídí `layoutHeight` (výška prvního tiskového segmentu), ne celkovou
výškou bloku. Prahy se aplikují na `layoutHeight` beze změny této logiky.

### 5. Úzký sloupec

Na 1366px notebooku má sloupec ~500 px a v XL se popis vedle čtyř chipů ořízne
elipsou. **Rozhodnuto: ponechat oříznutý, chipy se na druhý řádek zalamovat
nebudou.** Chování je stejné jako dnes, jen se projeví dřív.

## Testy

Nový `src/lib/plannerTypography.test.ts` (spadá pod stávající glob
`src/lib/*.test.ts`, není třeba měnit příkaz v `CLAUDE.md`):

1. **Monotonie** — každá velikost písma je pro vyšší stupeň ostře větší.
2. **Konzistence prahů** — `full > compact > tiny > micro` pro každý stupeň.
3. **Strážný test hustot** (klíčový): pro každý stupeň a pro `slotHeight` 26
   platí, že hodinový blok je FULL a půlhodinový aspoň TINY. Tohle chrání
   riziko č. 1.
4. **Neregrese** — pro stupeň `M` se žádná délka bloku nepropadne níž než
   při dnešních napevno zapsaných prazích 48/44/24/14.

Nad rámec unit testů: proklikat na testovací instanci nad kopií produkce.
Model v návrhovém náhledu není důkaz o skutečném renderu.

## Otevřené body

- Výchozí stupeň pro firmu zůstává `M` — tedy dnešní rozhled po plánu, ale už
  s čitelnější kartou. Zvednutí na `L` plošně je samostatné rozhodnutí, až bude
  featura chvíli v provozu.
- Hlavička stroje a popisky časové osy jsou v rozsahu, ale jsou to nejmenší
  kus práce — pokud by se etapa krátila, jdou odložit bez dopadu na zbytek.
