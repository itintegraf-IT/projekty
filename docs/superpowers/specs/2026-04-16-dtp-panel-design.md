# DTP Panel — Design Spec

Datum: 2026-04-16  
Autor: Vojta Ťokan  
Status: schváleno

---

## Kontext

MTZ a DTP dnes přistávají na hlavním planneru (`/`), kde je komplexní timeline s drag & drop. Pro jejich práci je to zbytečně těžký nástroj — potřebují přehled zakázek seřazený podle stavu dat, ne vizuální timeline. Tento spec řeší DTP; MTZ bude řešen separátně.

---

## Co stavíme

Resizable side panel v pravé části planneru, viditelný pouze pro roli `DTP` (a `ADMIN`/`PLANOVAT` pro testování). Panel zobrazuje seznam ZAKAZKA bloků filtrovaných podle hodnot číselníku DATA, s možností přeskočit na blok v timeline.

---

## Architektura

### Umístění v layoutu

Panel žije uvnitř `PlannerPage.tsx` jako pravý sibling `TimelineGrid`. Stejný vzor jako stávající JobBuilder panel — drag handle na levém okraji panelu, drag mění šířku.

```
┌─────────────────────────────┬──────────────┐
│                             │  DTP panel   │
│       TimelineGrid          │  (resizable) │
│                             │              │
└─────────────────────────────┴──────────────┘
                               ↑ drag handle
```

**Rozměry:**
- Výchozí šířka: 260px
- Minimální šířka: 180px
- Maximální šířka: 420px
- Šířka persistuje v `localStorage` (klíč `dtpPanelWidth`)

### Viditelnost

Panel se zobrazí pouze pokud:
- `currentUser.role === "DTP"` — panel je výchozí otevřený
- `currentUser.role === "ADMIN" || "PLANOVAT"` — panel lze otevřít tlačítkem v headeru (pro testování a přehled)

Pro ostatní role panel neexistuje.

---

## Data

### Zdroj dat

Panel **nevytváří nový API endpoint**. Používá data z `blocks` state v `PlannerPage` — ta jsou již načtena při mount. Tím se vyhýbáme duplikaci fetch logiky.

### Relevantní bloky (co se zobrazí)

Blok je relevantní pro DTP panel pokud splňuje **oba** podmínky:

1. `block.type === "ZAKAZKA"` (ostatní typy — ODSTÁVKA, PŘÍPRAVA apod. — se nezobrazují)
2. Alespoň jedna z:
   - `startTime` je do 30 dní od dnešního data
   - `dataOk === false` (čeká na akci DTP, bez ohledu na horizont)

### Filter chips — dataStatus

Chips se načtou z `/api/codebook?category=DATA` při otevření panelu (stejný endpoint co používá `BlockEdit`). Render pořadí:

1. **Vše** — statický, zobrazí všechny relevantní bloky
2. Hodnoty z číselníku seřazené podle `sortOrder` (nebo abecedně)
3. **bez statusu** — statický, zobrazí bloky kde `dataStatusId === null`

Aktivní chip: modrý fill. Neaktivní: outlined.

Při každé změně `blocks` state (po uložení BlockEdit) se seznam v panelu přepočítá — žádný samostatný polling.

### Řazení

Výchozí: `startTime` vzestupně (nejbližší tisk nahoře). Neměnné, bez možnosti přepínat.

---

## Komponenta DtpPanel

Nová komponenta `src/components/DtpPanel.tsx` — **nevkládat logiku inline do PlannerPage**.

### Props

```typescript
interface DtpPanelProps {
  blocks: Block[];                    // ze state PlannerPage
  codebookDataOpts: CodebookOption[]; // načteno z /api/codebook?category=DATA
  onScrollToBlock: (blockId: number) => void; // callback → PlannerPage scrolluje timeline
  onBlockClick: (block: Block) => void;       // callback → PlannerPage otevře BlockEdit
  width: number;
  onWidthChange: (w: number) => void;
}
```

### Interní state

- `activeFilter: number | "all" | "none"` — `number` = `dataStatusId`, `"none"` = bez statusu
- `dragStartX`, `dragStartWidth` — pro resize logiku

---

## Kartička zakázky

Každá kartička zobrazuje:

| Pole | Zdroj |
|------|-------|
| Číslo zakázky | `block.orderNumber` |
| Stroj | `block.machine` (formát: `XL 105` / `XL 106`) |
| Délka bloku | odvozeno z `startTime`/`endTime` v hodinách |
| Datum tisku | `block.startTime` formátovaný jako `"zítra 8:00"` / `"čt 18.4."` / `"dnes!"` |
| dataStatus chip | `block.dataStatusLabel` nebo `"bez statusu"` |

**Vizuální stav:**
- Standardní kartička: tmavé pozadí, border `#1e3a5f`, hover `#3b82f6`
- Blok kde `startTime ≤ dnes+1` AND `dataOk === false`: datum tisku zvýrazněn oranžově

### Klik na kartičku

1. Zavolá `onScrollToBlock(block.id)` — `PlannerPage` přescrolluje timeline na daný blok a krátce ho vizuálně zvýrazní (stejný highlight mechanismus co existuje pro kopírování/vkládání)
2. Zavolá `onBlockClick(block)` — `PlannerPage` otevře `BlockEdit` panel pro daný blok

---

## Resize logika

Stejný vzor jako JobBuilder panel:

- Drag handle: `4px` wide div na levém okraji panelu, cursor `col-resize`
- `mousedown` na handle → start drag, `mousemove` na `document` → přepočet šířky, `mouseup` → ukončení + uložení do `localStorage`
- Šířka je clampovaná na `[180, 420]`

---

## Co se nemění

- `TimelineGrid` — žádné změny
- API routes — žádné nové endpointy
- Prisma schema — žádné změny
- `BlockEdit` — žádné změny (jen nový caller)
- Stávající InboxPanel pro DTP zůstává beze změny

---

## Co není součástí tohoto sprintu

- MTZ panel — separátní spec
- Mobilní layout
- Persist aktivního filtru (filter se resetuje na "Vše" při refreshi)
- Inline editace statusu přímo v kartičce (vše jde přes BlockEdit)
