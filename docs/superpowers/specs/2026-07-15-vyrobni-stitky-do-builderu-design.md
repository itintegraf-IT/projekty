# Výrobní štítky (OBÁLKA/VNITŘKY + Tiskové archy + Série) do vstupního builderu — Design

**Datum:** 2026-07-15
**Autor:** Vojta + Claude
**Stav:** Schváleno k plánu

## Kontext a problém

Výrobní štítky **OBÁLKA**, **VNITŘKY**, **Tiskové archy** a **Série** (poslední z Lukášova
e-mailu 4. 6. 2026 — „k výrobním sloupečkům přidat") jsou dnes implementované **pouze
v editaci existujícího bloku** (`BlockEdit`, řádek „Výrobní štítky" na
`src/components/BlockEdit.tsx:955-981`, obalený podmínkou `type === "ZAKAZKA"` na řádku 799).

Vstupní **job builder** (formulář zadávání nové zakázky, `JobBuilderPanel` + hook
`useJobBuilder`) tato pole **nikdy neměl** — ani UI, ani v create payloadu
(`handleAddToQueue`, `handleScheduleSeries`). Git to potvrzuje: featura vznikla commitem
`83d0994a feat(form): nový řádek OBÁLKA/VNITŘKY + Tiskové archy/Série **v BlockEdit**`;
dekompozice builderu (`95b3c25c`) na těchto polích nic neubrala. **Nejde tedy o regresi
z úklidu — jde o původní mezeru vůči požadavku.**

Důsledek: nově založená zakázka má štítky prázdné a nastavit je jde až dodatečně otevřením
bloku a editací. Lukáš je chtěl rovnou při zadávání.

## Cíl

Umožnit nastavení OBÁLKA/VNITŘKY/tiskové archy/série **přímo ve vstupním builderu**, aby
založená zakázka rovnou nesla správné štítky (viditelné v plánu i v DTP dashboardu).

## Rozsah

- **Bez** změny DB schématu (pole `obalka`, `vnitrky`, `tiskoveArchy`, `serie` na modelu
  `Block` už existují).
- **Bez** změny API — POST `/api/blocks` write-path tato pole už přijímá a auditovaně
  ukládá (commit `a8f4b4db feat(tags): API write path (POST/PUT) + audit + série exclusion`).
- Čistě **klientská** práce: sdílená komponenta + protažení 4 polí přes builder → frontu → POST.

## Architektura

### 1. Sdílená prezentační komponenta `ProductionTagsRow`

Nový soubor `src/components/planner/ProductionTagsRow.tsx`. Čistě prezentační — **žádný
vlastní fetch ani interní stav**, vše přes propsy.

**Props (interface):**

```ts
export type ProductionTagsRowProps = {
  obalka: boolean;
  onObalkaChange: (v: boolean) => void;
  vnitrky: boolean;
  onVnitrkyChange: (v: boolean) => void;
  tiskoveArchy: string[];
  onTiskoveArchyChange: (v: string[]) => void;
  tiskoveArchyOpts: string[];
  serie: string[];
  onSerieChange: (v: string[]) => void;
  serieOpts: string[];
  disabled?: boolean;
};
```

**Obsah:** přesně dnešní JSX z `BlockEdit.tsx:955-981` — grid `1fr 1fr 1.15fr 1.15fr`,
dva toggle-buttony (OBÁLKA žlutá `#facc15`, VNITŘKY azurová `#22d3ee`) + dva
`MultiSelectDropdown` (Tiskové archy, Série). Barvy, ikony (checkmark SVG), `ColLabel`
popisky a chování zůstávají 1:1.

**Konzumenti:**
- `BlockEdit` — nahradí svůj inline řádek `<ProductionTagsRow …/>` napojený na vlastní
  stav (`obalka`/`setObalka`, …). Chování a vzhled beze změny.
- `JobBuilderPanel` — použije tutéž komponentu napojenou na builder stav z `useJobBuilder`.

`ColLabel` (dnes lokální v `BlockEdit`) se buď přesune vedle komponenty, nebo se do
`ProductionTagsRow` vloží vlastní ekvivalentní label — komponenta nesmí záviset na
interních helperech `BlockEdit`. Rozhodnutí: komponenta si nese vlastní malý label prvek,
aby byla soběstačná.

### 2. Datový tok (plumbing)

Štítky musí protéct: **builder stav → `QueueItem` → POST body**.

- **`useJobBuilder`** — nový stav:
  `bObalka`/`bVnitrky` (`boolean`, default `false`),
  `bTiskoveArchy`/`bSerie` (`string[]`, default `[]`),
  `bTiskoveArchyOpts`/`bSerieOpts` (`string[]`) plněné fetchem číselníků
  `/api/codebook?category=TISKOVY_ARCH` a `?category=SERIE` (stejný vzor jako
  `BlockEdit.tsx:467-471`).
- **`QueueItem`** typ (`useJobBuilder.ts:25`) — přidat pole:
  `obalka: boolean; vnitrky: boolean; tiskoveArchy: string[]; serie: string[];`.
- **`handleAddToQueue`** (`useJobBuilder.ts:329`) — do objektu položky doplní tato čtyři
  pole z builder stavu.
- **`reservationToQueueItem`** (`useJobBuilder.ts:91`) — defaulty `false`/`[]` (rezervace
  štítky nenesou).
- **`handleQueueDrop`** (`PlannerPage.tsx:1430`, sestavení `queueParentBody`) — do POST body
  přidá `obalka: item.obalka`, `vnitrky: item.vnitrky`,
  `tiskoveArchy: serializeProductionTags(item.tiskoveArchy)`,
  `serie: serializeProductionTags(item.serie)` (stejná serializace jako `BlockEdit` save,
  řádky 608-609).
- **`resetBuilderForm`** — vynuluje ty čtyři stavy.

Serializace: builder i BlockEdit drží archy/sérii jako `string[]`; do POST se posílá
serializovaný string přes `serializeProductionTags` (`src/lib/productionTags.ts`). OBÁLKA/
VNITŘKY jsou plain boolean.

### 3. Chování u série

Řádek štítků se v builderu vykreslí **jen pro `type === "ZAKAZKA"` a jen když
`recurrenceType === "NONE"`** (jednorázová zakázka, cesta „Přidat do fronty").

Když uživatel zakládá **sérii** (`recurrenceType !== "NONE"`, cesta „Naplánovat sérii"):
- řádek štítků se **skryje** a na jeho místě je nenápadná poznámka:
  „Štítky (OBÁLKA/VNITŘKY, archy, série) nastavíš u série po založení — editací bloku.";
- `handleScheduleSeries` štítky **neposílá** (série vznikne s prázdnými poli) — dle
  rozhodnutí uživatele.

Guard je dvojitý: skrytí v UI + `handleAddToQueue` doplní štítky jen pro
`recurrenceType === "NONE"` (obrana, i kdyby se stav dostal do série cesty).

## Datová/API neutralita

- Žádná Prisma migrace.
- Žádná změna routes. POST `/api/blocks` už `obalka`/`vnitrky`/`tiskoveArchy`/`serie`
  přijímá, validuje a auditne (série je z auditu vyloučená dle `a8f4b4db`).
- Číselníky `TISKOVY_ARCH` a `SERIE` už existují v bootstrapu (`bootstrap-prod.ts:86-87`)
  i seedu.

## Chybové stavy

- Prázdný / nedostupný číselník → `MultiSelectDropdown` prostě nemá volby (žádný crash);
  toggly fungují nezávisle. Konzistentní s dnešním chováním BlockEditu.
- Fetch číselníku selže → `opts` zůstane `[]`; builder je funkční, štítky archy/série
  nejdou vybrat dokud se fetch nepovede (parita s BlockEditem).

## Testovací strategie

Projekt unit-testuje čisté funkce v `src/lib/*` — UI komponenty a plumbing testuje přes
build/typecheck + manuální ověření + multi-agent review (zavedený vzor featur).

1. **`npm run build` + `npx tsc --noEmit`** zelené — zachytí typové mezery v novém
   `QueueItem` poli i propsech komponenty.
2. **Existující `productionTags.test.ts`** (serializace) zůstává zelený — serializační
   cestu nemodifikujeme, jen znovupoužíváme.
3. **Multi-agent review** (3 lens) po implementaci:
   - datová integrita: protéká `serie`/archy serializace správně builder → fronta → POST;
   - klient/UX: skrytí u série, `resetBuilderForm`, prázdné číselníky, rezervace defaulty;
   - konzistence sdílené komponenty: `BlockEdit` po extrakci beze změny chování.
4. **Důkaz na dev DB**: v builderu založit zakázku s OBÁLKA + 2 archy → blok v plánu
   i v DTP kartě štítky ukáže; série založená bez štítků je má prázdné.

## Soubory (mapa změn)

| Soubor | Změna |
| --- | --- |
| `src/components/planner/ProductionTagsRow.tsx` | **Nový** — sdílená prezentační komponenta |
| `src/components/BlockEdit.tsx` | Inline řádek 955-981 → `<ProductionTagsRow …/>` |
| `src/hooks/useJobBuilder.ts` | Nový stav + fetch číselníků; `QueueItem` typ; `handleAddToQueue`; `reservationToQueueItem`; `resetBuilderForm` |
| `src/components/planner/JobBuilderPanel.tsx` | Vykreslení `<ProductionTagsRow …/>` (ZAKAZKA & recurrenceType NONE) + poznámka u série |
| `src/app/_components/PlannerPage.tsx` | `handleQueueDrop` — 4 pole do `queueParentBody` |

## Mimo rozsah (vědomě)

- Propagace štítků na všechny výskyty série (uživatel zvolil „prázdné, nastavit po založení").
- Editace štítků u ne-ZAKAZKA typů (dnes ani BlockEdit neumožňuje — sekce je ZAKAZKA-only).
- Ostatní otevřené body Lukášova auditu (text poznámky na bloku, DTP fulltext, undo statusů,
  číselník DATA stavů) — samostatné položky backlogu.
