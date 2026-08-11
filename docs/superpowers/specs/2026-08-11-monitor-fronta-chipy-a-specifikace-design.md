# Design: Monitor — chipy a specifikace ve frontě zakázek

**Datum:** 2026-08-11
**Autor:** Vojta + Claude (brainstorm)
**Stav:** Návrh k odsouhlasení
**Souvislosti:** `2026-08-10-monitor-u-stroje-design.md`, `2026-08-10-monitor-rucni-vyber-zakazky-design.md`

---

## 1. Problém

Pravý sloupec Monitoru (`MonitorQueue`) je dnes jednořádkový: číslo zakázky, popis šedě,
čas startu. Tiskař v něm **nevidí nic z toho, podle čeho se u stroje rozhoduje**:

- **specifikaci** (`Block.specifikace`) — formát, barevnost, gramáž, povrchová úprava.
  Přitom právě to je informace, kvůli které dostala 8. 8. 2026 na kartě bloku v plánu
  nepřehlédnutelný amber pás (`SpecBand`) a 10. 8. 2026 i velká karta Monitoru
  (commit `f070c574`). Ve frontě chybí dál.
- **stav dat a materiálu** — tiskař nezjistí, jestli je na následující zakázku papír,
  aniž by na ni klikl a vytáhl si ji na velkou kartu.
- **výrobní štítky** (OBÁLKA / VNITŘKY / archy / série) a **nestandardní variantu**
  (typicky `POZASTAVENO` = výrobní stopka).

Popis se navíc na šířce sloupce u delších názvů ořízne (`whiteSpace: nowrap`), takže
řádek často nenese ani tu jednu informaci, kterou nést má.

Sloupec přitom místo má: je to `1fr` z `gridTemplateColumns: "1.45fr 1fr"`, tedy na
monitoru 1920 px zhruba **760 px šířky** a ~970 px výšky.

## 2. Rozhodnutí (odsouhlasená 11. 8. 2026)

Vybráno z náhledu se čtyřmi variantami (plná kartička / kompakt / postupné zhuštění /
amber pruh po straně).

| Otázka | Rozhodnutí |
| --- | --- |
| Podoba řádku | **Plná kartička** — číslo + popis + čas, pod tím amber pás, pod ním chipy |
| Sada chipů | **Všechny**, jaké má velká karta. Ubírat se dá později, až bude vidět, co ruší |
| Zdroj pravdy chipů | **Jedna sdílená komponenta** pro velkou kartu i frontu |
| Odklepnutá zakázka | Ztlumí se **celá včetně pásu** (dnešní `opacity: 0.5` zůstává) |
| Zásah do dat | **Žádný** — čistě render, beze změny API, schématu i `monitorView.ts` |

### Proč plná kartička a ne úspornější varianta

Fronta na jeden stroj a den má typicky 4–8 zakázek — místo, které by kompaktnější
varianta ušetřila, se nevrátí, a platilo by se za něj srozumitelností (kolečka `D`/`M`/`P`
místo čitelných štítků jsou nová řeč, kterou tiskař v plánu nemá). Plná kartička navíc
drží **jediný vzor napříč aplikací**: co je v plánu žlutý pás, je žlutý pás na velké kartě
i ve frontě.

Kdyby se fronta v provozu přeplňovala, dá se dodatečně rozbalovat jen prvních N zakázek
a zbytek nechat jednořádkový. Nic z tohoto návrhu se tím nezahazuje — proto to teď
nestavíme (YAGNI).

### Proč všechny chipy

Vojtova úvaha: většina zakázek nemá všechna pole vyplněná, takže se řádky reálně nenafouknou
na plnou sadu. Ubírat z toho, co je vidět, je levné rozhodnutí opřené o skutečný provoz;
dohadovat se o tom předem nad prázdnými poli není.

## 3. Chování

### 3.1 Skladba řádku

```
┌─────────────────────────────────────────────────────────┐
│ MON-2404   Katalog jaro 2026 — Alimpex           12:00  │  číslo · popis · čas
│ ▓ B2 · 4/4 · 130 g natíraný lesk · disperzní lak ▓      │  amber pás (≤ 2 řádky)
│ [OBÁLKA] [3 archy] [2. série] [Data OK] [Skladem]       │  chipy
└─────────────────────────────────────────────────────────┘
```

Řádek zůstává `<button>` (klik vytáhne zakázku na velkou kartu, viz ruční výběr z 10. 8.),
jen se mění na `flexDirection: "column"`. Horní řádek si drží dnešní podobu: číslo
monospace tučně, popis `--text-muted` s elipsou, čas vpravo přes `marginLeft: auto`.

### 3.2 Amber pás specifikace

- Barvy **doslova** `SPEC_HIGHLIGHT` z `src/lib/blockStyles.ts` (`bg #fbbf24`, `text #221703`)
  — pevné literály, ne tokeny; pás si nese vlastní pozadí, takže funguje ve světlém
  i tmavém motivu stejně jako v plánu.
- Ořez na **2 řádky** (`WebkitLineClamp: 2`) s `title` atributem na plný text — stejně
  jako na velké kartě.
- Velikost mezi kartou bloku (10 px) a velkou kartou Monitoru (17 px): **13 px**, `fontWeight: 700`.
- **Když `specifikace` chybí, pás se nevykreslí vůbec** — žádné prázdné žluté místo.

### 3.3 Chipy

Sada i pořadí jsou přesně ty, které dnes vykresluje velká karta:

| # | Chip | Podmínka | Tón |
| --- | --- | --- | --- |
| 1 | `OBÁLKA` | `block.obalka` | brand |
| 2 | `VNITŘKY` | `block.vnitrky` | brand |
| 3 | `block.tiskoveArchy` | neprázdné | plain |
| 4 | `block.serie` | neprázdné | plain |
| 5 | `block.dataStatusLabel` | neprázdné | `dataOk` → ok, jinak wait |
| 6 | `block.materialStatusLabel` | neprázdné | `materialInStock \|\| materialIssued \|\| materialOk` → ok, jinak wait |
| 7 | `PANTONE` | `pantoneRequired \|\| pantoneRequiredDate \|\| pantoneOk` | `pantoneOk` → ok, jinak wait |
| 8 | `VARIANT_CONFIG[blockVariant].label` | `blockVariant !== "STANDARD"` | `POZASTAVENO` → danger, jinak plain |

Když nevyjde ani jeden chip, řádek chipů se nevykreslí.

Chipy se zalamují (`flexWrap: "wrap"`), takže „upovídaná" zakázka řádek nafoukne o jednu
linku. To je přijatelné — alternativa (ořez) by tiše zahodila zrovna tu informaci,
kvůli které se chipy přidávají.

### 3.4 Odklepnutá a zvýrazněná zakázka

Beze změny oproti dnešku:

| Stav | Podoba |
| --- | --- |
| odklepnutá (`printCompletedAt != null`) | `opacity: 0.5` na celém řádku, zelený `✓` u čísla |
| zakázka na velké kartě (`heroId`) | zelený okraj + zelenkavé pozadí |

Ztlumení se záměrně vztahuje **i na amber pás**. Hotová zakázka nemá u stroje křičet;
kdyby si pás držel plnou sytost, přebil by tu zakázku, která se právě tiskne.

## 4. Co se nemění

- `src/lib/monitorView.ts` — pravidla fronty (dva dny, řazení), výběr hero zakázky,
  šestnáctihodinové okno. Žádný nový test tam nepřibývá.
- API, Prisma schéma, migrace. Všechna zobrazovaná pole už v `Block` jsou a velká karta
  Monitoru je pro roli `TISKAR` prokazatelně dostává.
- Klikací chování řádku (ruční výběr zakázky), oddíly **Dnes** / **Zítra**, prázdný stav.
- Karta bloku v plánovací timeline a všechny role mimo `TISKAR`.

## 5. Architektura

### 5.1 Nová sdílená komponenta — `src/components/monitor/MonitorChips.tsx`

Dnešní `HeroChips` je funkce zavřená uvnitř `MonitorView.tsx` (ř. ~470). Vytáhne se jako
named export:

```ts
/** Výrobní a stavové štítky zakázky na Monitoru. */
export function MonitorChips({ block, size }: { block: Block; size: "hero" | "queue" }): JSX.Element | null;
```

`size` mění **jen** rozměry (`hero`: 12 px / padding `5px 10px`; `queue`: 11 px /
padding `3px 7px`), nikdy obsah ani pořadí chipů.

Důvod pro sdílení, ne kopii: pravidla „co znamená připraveno" jsou netriviální a už jednou
se rozešla — připravenost materiálu je `materialInStock || materialIssued || materialOk`
(nález I5, jinak Monitor hlásil „čeká" na to, co je v plánu zelené). Druhá kopie znamená,
že se příští oprava promítne na jedno místo a Monitor začne o téže zakázce tvrdit dvě
různé věci na jedné obrazovce.

`MonitorView.tsx` po extrakci volá `<MonitorChips block={card.block} size="hero" />`
a zkrátí se o ~57 řádků.

### 5.2 `src/components/monitor/MonitorQueue.tsx`

Props se **nemění** (`{ today, tomorrow, heroId, onSelect }`). Mění se jen vnitřek
`QueueSection`: dnešní jednořádkový `<button>` se rozpadne na tři části podle §3.1.

Soubor má dnes 95 řádků, po změně ~140 — extrakce dalších komponent není potřeba.

### 5.3 Sdílený vzhled pásu

`SpecBand` z `src/components/planner/SpecBand.tsx` se **nepoužije** — má natvrdo velikosti
karty bloku (10 px, `padding 0 6px 3px`, `zIndex: 2` kvůli gradientu bloku) a parametrizovat
ho do třetí velikosti by z něj udělalo komponentu, kterou nikdo nepřečte. Fronta si pás
vykreslí sama ze sdíleného literálu `SPEC_HIGHLIGHT`, stejně jako to dnes dělá velká karta
Monitoru. Sdílenou pravdou je **barva**, ne rozměr.

## 6. Ověření

1. `npm run build`, `npx tsc --noEmit`, `npm run lint` bez chyb.
2. Celá test suite zelená (846 testů) — beze změny, tahle etapa žádný test nepřidává ani nemění.
3. Ruční průchod jako `TISKAR` na seedu `npx tsx prisma/seed-monitor.ts`:
   - řádek fronty ukazuje amber pás se specifikací i chipy,
   - zakázka **bez** specifikace nemá žlutý pás ani prázdné místo po něm,
   - zakázka bez jediného chipu nemá prázdný řádek chipů,
   - `MON-2407` (pozastavená) má červený chip `POZASTAVENO`,
   - `MON-2403` má oba stavové chipy v `wait` tónu (data chybí, archy objednány),
   - `MON-2404` má `OBÁLKA` + archy + sérii,
   - odklepnutá zakázka je ztlumená **včetně pásu**, zelený `✓` u čísla,
   - zakázka na velké kartě má zelený okraj,
   - klik na řádek ji dál vytáhne na velkou kartu (ruční výběr funguje),
   - chipy na velké kartě vypadají po extrakci **stejně jako předtím**,
   - světlý i tmavý motiv (pás musí být čitelný v obou).
4. Přihlášení jako `PLANOVAT` — planner beze změny.

## 7. Ne-cíle

- Rozbalování jen prvních N zakázek (§2) — až kdyby se fronta v provozu přeplňovala.
- Ubírání chipů — vědomě odloženo na zkušenost z provozu.
- Zásah do `SpecBand` v plánu nebo do karty bloku.
- Jakákoli změna dat, API nebo pravidel fronty.
