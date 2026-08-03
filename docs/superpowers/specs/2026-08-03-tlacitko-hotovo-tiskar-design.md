# Design: Tlačítko Hotovo u stroje (tiskařský režim)

**Datum:** 2026-08-03
**Autor:** Vojta + Claude (brainstorm)
**Stav:** Návrh k odsouhlasení
**Souvislosti:** `docs/KIOSK_TERMINAL.md`, artefakt s vizuálem (měřítko 1 : 1)

---

## 1. Kontext a problém

Tiskaři odklepávají hotový tisk na terminálu u stroje (Raspberry Pi, prohlížeč ve
fullscreenu, ovládání **myší**). Terminál stojí u stroje, obsluha se na něj dívá
z odstupu a často jen letmo. Dnešní tlačítko **Hotovo** je ale navržené pro
plánovače u stolu:

| Režim karty | Výška bloku | Co tam dnes je | Kde |
| --- | --- | --- | --- |
| `MODE_FULL` | ≥ 48 px | tlačítko „Hotovo", text 11 px, výplň 3 × 10 px, zarovnané vpravo dole | `BlockCard.tsx:1107–1126` |
| `MODE_COMPACT` | 44–47 px | čtvereček ✓ 22 × 22 px | `BlockCard.tsx:804–810` |
| `MODE_TINY` / `MODE_MICRO_TEXT` | 14–43 px | čtvereček ✓ 22 × 22 px | `BlockCard.tsx:933–939` |
| — | < 14 px | nic | — |

Tři konkrétní vady:

1. **Malý cíl.** V `MODE_FULL` má tlačítko zhruba `26 × 62 px` — na dlouhém bloku,
   kde je místa dost, zabírá zlomek dostupné šířky.
2. **Slabý kontrast.** Pozadí je `rgba(34,197,94,0.3)` se zeleným textem `#22c55e`
   — zelená na zelené s nízkým krytím, na dálku vybledlá.
3. **Barvy natvrdo.** Literály `rgba(…)` / `#22c55e` jsou proti konvenci projektu
   (CLAUDE.md → „barvy vždy přes CSS tokeny") a rozbíjejí světlý režim.

**Poznámka k rozsahu:** dřívější domněnka, že tlačítko pod 48 px mizí, byla
mylná — degraduje na čtvereček. Nepřidáváme tedy chybějící ovládání, jen
zvětšujeme a přebarvujeme tři existující varianty.

## 2. Cíle a ne-cíle

### Cíle
1. Výrazně zvětšit plochu na kliknutí ve všech režimech karty.
2. Zvýšit kontrast na úroveň čitelnou z odstupu (plná zelená, tmavý text).
3. Převést barvy na tokeny, aby fungoval světlý i tmavý režim.
4. Vizuálně odlišit blok, který **právě běží**, a bloky **už odklepnuté**.

### Ne-cíle (rozhodnuto 3. 8. 2026)
- **Samostatná obrazovka „Monitor"** a přepínač Monitor ↔ Plán. Zamítnuto:
  kioskový launcher už jednu úroveň přepínání má (Sběr dat ↔ Plánování), druhá
  uvnitř by byla nepřehledná.
- **Potvrzovací mezikrok.** Zamítnuto: akce je vratná a ovládá se myší, kde
  omylem netrefíš tak snadno jako prstem.
- Jakákoli změna pro role mimo `TISKAR`. Plánovači vidí totéž co dnes.
- Změna serverové logiky. `POST /api/blocks/[id]/complete` zůstává beze změny.

## 3. Část 1 — velikost a barva tlačítka

### 3.1 Rozměry

Velikost se řídí `layoutHeight`, tedy hodnotou, kterou karta pro volbu layoutu
už počítá (`BlockCard.tsx:399`). Prahy uvnitř `MODE_FULL` jsou nové, hranice
mezi režimy zůstávají beze změny.

| Výška bloku | Podoba | Výška prvku | Text |
| --- | --- | --- | --- |
| ≥ 140 px | pruh přes celou šířku karty | 40 px | 16 px / 750 |
| 96–139 px | pruh přes celou šířku karty | 32 px | 14 px / 750 |
| 48–95 px | pruh přes celou šířku karty | 24 px | 11,5 px / 750 |
| 14–47 px | čtverec vpravo v řádku | 26 × 26 px | 15 px (jen ✓) |
| < 14 px | nevykresluje se | — | — |

Na typickém tříapůlhodinovém bloku roste plocha z `26 × 62 px` na
`40 × 198 px`, tedy zhruba pětinásobek.

Pod 14 px karta nevykresluje obsah vůbec. Tam zůstává cesta přes kliknutí do
bloku → detail; **to je existující chování, nic se nepřidává.**

### 3.2 Barvy

| Stav | Pozadí | Text |
| --- | --- | --- |
| Nedokončeno | `var(--success)` (plná) | `var(--success-contrast)` |
| Pod myší | `--success` zesvětlená přes `color-mix` + prstenec | `var(--success-contrast)` |
| Probíhá zápis | totéž, `opacity: 0.5`, kurzor `not-allowed` | — |
| Odklepnuto | `var(--surface-3)` | `var(--text-muted)` |

**Nový token `--success-contrast`** v `src/app/globals.css` (obě témata) — tmavý
odstín čitelný na plné zelené. Bez něj by tlačítko potřebovalo literál, což je
přesně to, co odstraňujeme. Zapadá k existující dvojici `--brand` /
`--brand-contrast`.

### 3.3 Stav po odklepnutí

Tlačítko **zůstává přepínačem** — po odklepnutí zneutrální (`--surface-3`),
zmenší se na 22 px a ukáže `✓ Hotovo 14:32` (čas přes pražský helper
z `dateUtils.ts`). Kliknutím se hotovo vrátí, `title` to říká.

Záměrně se **nemění chování**, jen vzhled: vracení zůstává na stejném místě jako
dnes. Souvisí s rozhodnutím nepotvrzovat — snadné vrácení je to, co obhajuje
absenci potvrzení.

### 3.4 Sdílená komponenta

Tři místa v `BlockCard.tsx` dnes obsahují tři téměř shodné kopie tlačítka
(včetně `onClick`, `printPending` a stylů). Vzniká jedna komponenta:

`src/components/planner/PrintDoneButton.tsx` — named export, props:

```ts
type Props = {
  variant: "bar" | "square";   // pruh (FULL) / čtverec (COMPACT, TINY, MICRO)
  height: 40 | 32 | 24 | 26;   // rozměr dle tabulky 3.1
  isDone: boolean;
  completedAt: string | null;  // pro popisek "✓ Hotovo 14:32"
  pending: boolean;
  onToggle: () => void;
};
```

Komponenta řeší **jen vzhled a klik**. Rozhodnutí o velikosti (`layoutHeight` →
`height`) zůstává v `BlockCard`, aby komponenta nemusela znát režimy karty.
Odpovídá konvenci CLAUDE.md: nové standalone komponenty jako named export do
`src/components/`, ne inline do velkých souborů.

## 4. Část 2 — zvýraznění stavu bloku

Platí **jen pro `isTiskar`**. Pro ostatní role se nevykresluje.

### 4.1 Právě běžící blok

`isRunningNow = now !== null && start <= now < end && !isPrintDone`

Hodnota `now` už v `TimelineGrid` existuje (`TimelineGrid.tsx:556`, `647–648`,
obnova po 60 s). Použije se stejný zdroj — **žádný nový časovač**. Podmínka se
vyhodnotí v `TimelineGrid` u mapování bloků a do `BlockCard` jde jako boolean
prop `isRunningNow`.

Vzhled: rám `var(--success)`, jemný vnější stín, štítek `TEĎ` v pravém horním
rohu (mono, 8 px, pozadí `--success`, text `--success-contrast`).

`now` je při prvním renderu `null` (kvůli SSR) → `isRunningNow` je `false`,
zvýraznění naskočí po hydrataci. Přijatelné: terminál běží nepřetržitě.

### 4.2 Odklepnutý blok

`opacity: 0.52` a levý pruh karty v barvě `--success`. Jen vizuální ztlumení —
blok zůstává plně funkční a klikací.

## 5. Dotčené soubory

| Soubor | Změna |
| --- | --- |
| `src/components/planner/PrintDoneButton.tsx` | **nový** — sdílené tlačítko |
| `src/components/planner/BlockCard.tsx` | tři místa nahrazena komponentou; volba velikosti; zvýraznění dle 4.1/4.2 |
| `src/app/_components/TimelineGrid.tsx` | výpočet `isRunningNow` z existujícího `now`, předání do `BlockCard` |
| `src/app/globals.css` | nový token `--success-contrast` pro obě témata |

Bez zásahu: API, Prisma schéma, migrace, `PlannerPage`, role mimo `TISKAR`.

## 6. Ověření

1. `npm run build` — TypeScript projde.
2. `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` — 397 testů zelených (regrese; nová logika je čistě vizuální, testy nepřibývají).
3. Ruční průchod jako `TISKAR` na `/`:
   - bloky ~3,5 h / ~2 h / ~1 h → tlačítko 40 / 32 / 24 px přes celou šířku
   - blok pod 48 px → čtverec 26 px
   - odklepnutí → neutrální pruh s časem; opětovné kliknutí vrátí
   - běžící blok má zelený rám a štítek `TEĎ`
4. Přepnutí do světlého režimu — tlačítko čitelné v obou tématech.
5. Přihlášení jako `PLANOVAT` — planner beze změny.

## 7. Rizika

- **Vyšší tlačítko ubere místo obsahu karty.** U bloků 48–95 px zbude na popis
  a štítky o 24 px méně. Proto je v tomto pásmu tlačítko nejnižší; při ověření
  zkontrolovat, že se popis neuřízne dřív než dnes.
- **`--success-contrast` je nový globální token.** Musí se doplnit do obou
  témat, jinak jedno z nich spadne na neplatnou hodnotu.
- Zvýraznění běžícího bloku se překreslí jednou za minutu společně s existující
  linkou aktuálního času — žádný nový render cyklus.

## 8. Rozsah práce

Odhad **půl dne** včetně ověření. Část 1 a část 2 jdou nasadit odděleně,
část 2 je nezávislá a lze ji kdykoli vypustit.
