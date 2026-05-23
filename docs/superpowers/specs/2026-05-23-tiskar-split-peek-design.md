# Tiskař — náhled na druhý stroj u rozdělených zakázek

**Datum:** 2026-05-23
**Autor:** Vojta Ťokan (CFO) + Claude
**Stav:** Schválený design, čeká na review před writing-plans

---

## Problém

Tiskař vidí v plánovači pouze svůj `assignedMachine`. Pokud je zakázka rozdělená mezi oba stroje (`splitGroupId != null`), tiskař nemá jak zjistit:

1. Zda se druhá část už tiskla nebo už je hotová.
2. Kde má hledat podklady (DTP), protože ty bývají u toho stroje, který tiskne první.

Sekundárně tiskař nemá vyhledávání — pokud chce dohledat libovolnou zakázku (nejen split), musí se ptát kolegy nebo prohlížet timeline ručně.

## Cíl

Dát tiskaři dvě nové schopnosti, beze změny defaultního pohledu:

1. **Pasivní indikátor** — chip přímo na splitnuté zakázce, ukazující kde běží druhá část a její stav.
2. **Peek druhého stroje** — read-only paralelní timeline na vyžádání.
3. **Modal vyhledávání** — diskrétní tlačítko v hlavičce pro ad-hoc dohledávání zakázek.

Vše v iOS designovém stylu (glass, rounded, segmented control, bottom sheet) konzistentně se zbytkem aplikace.

## Out of scope

- Sledování zahájení tisku (`printStartedAt`) — žádný nový datový field. Stavy chipu: jen **čeká** / **hotovo** podle `printCompletedAt`.
- Edit operace v peek pohledu — peek je striktně read-only.
- Tiskaři viditelnost reservací nebo admin panel — beze změny.
- Notifikace o změnách stavu druhé části — out of scope.
- Podpora 3+ partnerů ve splitu (Integraf má dnes jen 2 stroje).

---

## Rozhodnutí z brainstormingu

| # | Otázka | Volba |
|---|--------|-------|
| 1 | Směr řešení | C — chip na splitnutém bloku + peek druhého stroje |
| 2 | Zařízení | iPad landscape + desktop |
| 3 | Default view | Jen vlastní stroj; peek na vyžádání |
| 4 | Obsah chipu | Status + čas |
| 5 | Vyhledávání | Modal tlačítko „Najít zakázku" |
| 6 | Peek styl | Split-screen 70/30, synchronizovaný scroll |
| 7 | Detekce stavu | 2 stavy (čeká / hotovo) z `printCompletedAt` |

---

## Funkční chování

### Default stav
- Tiskař otevře `/` → vidí jen svůj `assignedMachine` (zachováno).
- Header zůstává minimalistický, přibudou jen 2 prvky: segmented control `XL_105 | XL_106` a tlačítko „Najít" (lupa).

### Chip na bloku
- Pokud je zakázka tiskaře rozdělená a má sourozenecký blok na druhém stroji, na bloku se vykreslí pill chip:
  - `→ XL_106 · čeká 14:30` — oranžová tečka, čas = `startTime` druhé části.
  - `→ XL_106 · hotovo 14:30` — zelená tečka, čas = `printCompletedAt`.
- Chip je pasivní, ale klikatelný.
- Pokud má blok výšku < 32 px, chip se nezobrazuje (info je v `BlockDetail` místo toho).

### Tap na chip → otevření peek
- Layout se přepne na **split 70/30**: vlastní stroj 70 %, peek druhého stroje 30 %.
- Peek je `position: relative` panel uvnitř hlavního flexu, ne overlay.
- Scroll obou timeline synchronizovaný **one-way z hlavního pohledu**: hlavní timeline má scroll container, peek dostává `scrollTop` přes prop a aplikuje ho v `useEffect`. Peek nemá vlastní samostatný scroll (žádné `overflow-y: auto` na jeho rootu) — pouze odráží hlavní pohled. Tím se vyhneme race conditions s two-way sync.
- Druhá split-část v peeku se vizuálně zvýrazní: `box-shadow: 0 0 0 2px var(--accent)` + 2 s pulzující animace, `opacity: 1` (bez ztlumení ostatních).
- Ostatní bloky v peeku: `opacity: 0.55`, `filter: saturate(0.6)`.

### Ad-hoc náhled
- Segmented control v hlavičce (`XL_105 | XL_106`) viditelný jen pro `TISKAR`.
- Toggle vždy zobrazí všechny stroje z konstanty `MACHINES` (nezávisí na tom, zda má tiskař na druhém stroji partnera).
- Tap na druhý stroj → otevře peek bez pulzujícího highlightu (jiná query, čistě prohlížecí).
- Tap zpět na vlastní stroj → peek se zavře.

### Zavření peeku
- Tap na X v header peeku.
- Druhý tap na chip.
- Tap na vlastní stroj v segmented controlu.

### Modal vyhledávání
- Tlačítko lupy v hlavičce → iOS bottom sheet (portál do body, slide-up).
- Input autofocus, placeholder „Číslo zakázky…".
- Výsledky pod inputem — každý ukazuje `orderNumber`, badge stroje, datum/čas, status.
- Klik na výsledek → sheet se zavře, scrollne na blok. Pokud je na druhém stroji, automaticky otevře peek a podsvítí.
- Žádný výsledek → text „Zakázka 25-XXXX nebyla nalezena".
- Zavření: Esc, klik na backdrop, X tlačítko.

---

## UI komponenty

Všechny komponenty jako **named export** v `src/components/` (audit standard, žádné inline komponenty v PlannerPage).

### SplitChip (`src/components/SplitChip.tsx`)
**Props:**
```typescript
type Props = {
  partnerMachine: string;        // "XL_106"
  state: "waiting" | "done";
  time: Date;                    // startTime nebo printCompletedAt
  onClick: () => void;
};
```

**Visuální specifikace:**
- Pill: `border-radius: 999px`, `padding: 3px 8px 3px 6px`, `font-size: 10px`, `font-weight: 600`.
- Pozadí: `rgba(255,255,255,0.65)` + `backdrop-filter: blur(8px)`.
- Border: `1px solid rgba(0,0,0,0.08)`.
- Tečka 6 px:
  - `waiting` → `var(--warning)` (#ff9500) + halo `box-shadow: 0 0 0 3px rgba(255,149,0,0.18)`.
  - `done` → `var(--success)` (#34c759) + halo zelený.
- Šipka `→` před textem, název stroje **bold**, separátor `·`, status label + čas v `HH:MM`.
- Pozice na bloku: vpravo dole, `margin-top: 6px`.

### MachinePeekPanel (`src/components/MachinePeekPanel.tsx`)
**Props:**
```typescript
type Props = {
  machine: string;               // "XL_106"
  blocks: Block[];               // už zúžené na druhý stroj
  highlightBlockId: number | null;
  viewStart: Date;
  slotHeight: number;
  scrollTop: number;             // synchronizovaný z hlavního scrollu
  companyDays: CompanyDay[];
  weekShifts: MachineWeekShiftsRow[];
  onClose: () => void;
};
```

**Vizuální:**
- Šířka 30 %, `border-left: 1px dashed rgba(0,0,0,0.12)`.
- Pozadí: `linear-gradient(180deg, rgba(245,245,250,0.6), rgba(245,245,250,0.2))`.
- Header peeku: malý štítek `READ-ONLY` (8 px, uppercase, letter-spacing 0.4 px), X tlačítko vpravo.
- Bloky: `opacity: 0.55`, `filter: saturate(0.6)`, žádné event handlery.
- Highlight blok: `opacity: 1`, accent box-shadow + pulzace 2 s.
- Scroll sync: vnitřní `useEffect` aplikuje `scrollTop` na peek scroll container.

### TiskarMachineToggle (`src/components/TiskarMachineToggle.tsx`)
**Props:**
```typescript
type Props = {
  machines: string[];            // ["XL_105", "XL_106"]
  activeMachine: string;         // tiskařovo nebo peek
  ownMachine: string;            // vždy zvýrazněno jako "vlastní"
  onChange: (machine: string) => void;
};
```

**Vizuální iOS segmented:**
- Container: `display: inline-flex`, `background: rgba(118,118,128,0.12)`, `border-radius: 9px`, `padding: 2px`, `gap: 2px`.
- Tlačítka: `padding: 4px 14px`, `font-size: 12px`, `font-weight: 500`.
- Active: `background: white`, `box-shadow: 0 2px 6px rgba(0,0,0,0.08)`, `font-weight: 600`.
- Transition: `all 150ms ease`.

### OrderSearchSheet (`src/components/OrderSearchSheet.tsx`)
**Props:**
```typescript
type Props = {
  open: boolean;
  allBlocks: Block[];
  onSelect: (block: Block) => void;
  onClose: () => void;
};
```

**Vizuální:**
- Portál do body, fixed full-screen.
- Backdrop `rgba(0,0,0,0.4)` + `backdrop-filter: blur(2px)`.
- Sheet container: `position: fixed; bottom: 0`, `border-radius: 16px 16px 0 0`, slide-up 250 ms ease-out.
- Drag handle 36×4 nahoře.
- Šířka: 480 px desktop, full mobile/tablet portrait, max-height 60vh.
- Input: 16 px font, `padding: 14px`, autofocus.
- Výsledky: vertikální seznam karet, max 20 položek, sortováno podle `startTime`.

---

## Data model

**Žádné změny v Prisma schématu.**

Použijí se existující pole:

| Pole | Použití |
|---|---|
| `Block.splitGroupId` | Identifikace splitu |
| `Block.machine` | Stroj, určení partnera |
| `Block.printCompletedAt` | Stav „hotovo" vs „čeká" |
| `Block.startTime` | Čas v chipu pro stav „čeká" |

### Detekce split partnera

Čistá utility v `src/lib/splitHelpers.ts`:

```typescript
import type { Block } from "@/lib/plannerTypes";

export function findSplitPartner(
  block: Block,
  allBlocks: Block[],
  myMachine: string
): Block | null {
  if (block.splitGroupId == null) return null;
  if (block.machine !== myMachine) return null;
  const candidates = allBlocks.filter(
    b => b.id !== block.id
      && b.splitGroupId === block.splitGroupId
      && b.machine !== myMachine
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return candidates[0];
}

export function getSplitChipState(partner: Block): {
  state: "waiting" | "done";
  time: Date;
} {
  if (partner.printCompletedAt) {
    return { state: "done", time: new Date(partner.printCompletedAt) };
  }
  return { state: "waiting", time: new Date(partner.startTime) };
}
```

### API

`GET /api/blocks` už dnes vrací všechny bloky všech rolí — žádná změna. Tiskař získá data druhého stroje bez nového endpointu.

---

## Edge cases

| Případ | Chování |
|---|---|
| Split, obě části na stejném stroji | Chip se nezobrazí — `findSplitPartner` vrátí null. |
| Partner mimo viditelný rozsah (`startTime < viewStart`) | Chip zobrazí; po tapu peek rozšíří `daysBack` (stejný pattern jako `handleJumpToOutOfRange`) a scrollne. |
| Více partnerů na druhém stroji | `findSplitPartner` vrátí prvního podle `startTime`. V peeku se podsvítí jen on. |
| Recurring (`recurrenceType != NONE`) + split | Pravidla nezávislá; chip se řídí jen `splitGroupId`. |
| Smazaný partner | `findSplitPartner` vrátí null → chip zmizí. |
| Tiskař bez `assignedMachine` | Defensive: skrýt chip, toggle, search button — fallback na současné chování. |
| Search bez výsledku | Sheet ukáže text „Zakázka nebyla nalezena". |
| Search výsledek mimo `viewStart`/`viewEnd` | Stejný expand-range pattern jako `handleJumpToOutOfRange`. |
| Search výsledek na druhém stroji | Otevře peek + scrollne + highlightne. |
| Blok < 32 px výšky | Chip skryt — info je dostupné přes `BlockDetail`. |

---

## Soubory k zásahu

### Nové

| Soubor | Účel |
|---|---|
| `src/components/SplitChip.tsx` | Pill chip render |
| `src/components/MachinePeekPanel.tsx` | Read-only timeline |
| `src/components/TiskarMachineToggle.tsx` | iOS segmented control |
| `src/components/OrderSearchSheet.tsx` | Modal search |
| `src/lib/splitHelpers.ts` | `findSplitPartner`, `getSplitChipState` |
| `src/lib/splitHelpers.test.ts` | Unit testy |

### Upravené

| Soubor | Změna |
|---|---|
| `src/app/_components/PlannerPage.tsx` | Stav `peekMachine: string \| null`, `searchSheetOpen: boolean`. Layout split 70/30 pokud `peekMachine`. Wire toggle + chip handlery. |
| `src/app/_components/TimelineGrid.tsx` | Nová props `splitPartnersByBlockId?: Map<number, Block>`, `onChipClick?: (partnerId: number) => void`. Render `<SplitChip>` při existenci partnera. |
| `src/components/BlockDetail.tsx` | Pokud má blok partnera, sekce „Druhá část" (informačně, pro všechny role). |

### Nemění se
- API routes (žádné nové endpointy)
- Prisma schema, migrace
- `middleware.ts`
- `assignedMachine` filtrace v `TimelineGrid` (zůstává — peek je separátní panel)

---

## Implementační pořadí

1. `splitHelpers.ts` + testy.
2. `SplitChip` komponenta (visual standalone).
3. `MachinePeekPanel` (read-only timeline panel).
4. `TiskarMachineToggle` + zapojení do header.
5. `OrderSearchSheet` + tlačítko „Najít".
6. Wire-up v `PlannerPage` (peek stav, scroll sync, handlery).
7. Drobné úpravy `BlockDetail`.
8. Manuální test scénářů + screenshot pro PR.

---

## Coding standards

Z auditu (POVINNÉ pro nový kód):
- Žádný `console.*` — pokud něco logujeme na backendu, `logger`. (Tato práce je frontend-only, takže nedotčeno.)
- API routes nemění chování → `AppError` nedotčen.
- Žádné `prisma format` / `prisma db pull`.
- Mouse handlery (pokud přidám): `if (e.button !== 0) return`.
- Named exports v `src/components/`, žádné inline komponenty.

---

## Testovací strategie

### Unit testy
```bash
node --test --import tsx src/lib/splitHelpers.test.ts
```
Cíl: minimálně 7 testů pokrývající všechny větve `findSplitPartner` a `getSplitChipState`.

### Regrese
```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```
Cíl: 24/24 zelené beze změn.

### Build + lint
```bash
npm run build
npm run lint
```

### Manuální QA matrix

| # | Scénář | Očekávané |
|---|---|---|
| 1 | Tiskař XL_105, split 1/2 XL_105 + 2/2 XL_106, druhá nehotová | Chip „→ XL_106 · čeká HH:MM" oranžový |
| 2 | Stejné, ale 2/2 má `printCompletedAt` | Chip „→ XL_106 · hotovo HH:MM" zelený |
| 3 | Tap na chip | Split 70/30, peek XL_106, pulzující rámeček na 2/2 |
| 4 | Tap X v peek header | Layout zpět na full XL_105 |
| 5 | Tap „XL_106" v segmented | Peek bez pulzu |
| 6 | Tap lupa → zadat existující číslo | Sheet ukáže výsledek, klik scrollne |
| 7 | Tap lupa → zadat neexistující | „Zakázka nebyla nalezena" |
| 8 | Split obě části na XL_105 | Chip se nezobrazí |
| 9 | Non-tiskar role | Žádný chip, toggle, search button (zachováno) |
| 10 | iPad landscape 1024×768 | Vše čitelné, žádný overflow |

Cíl: **31/31 testů** (24 stávajících + 7 nových), 0 build errors, 10/10 manuálních scénářů ok.
