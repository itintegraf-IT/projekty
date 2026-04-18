# Resize Tooltip — Design Spec

**Datum:** 2026-04-17
**Autor:** Vojta + Claude

## Problém

Při resize bloku (tažení pravého dolního rohu) uživatel nevidí, na jaký čas blok prodlužuje. Musí odhadovat podle časových značek vlevo v timeline.

## Řešení

Floating tooltip pod spodní hranou bloku, který zobrazuje koncový čas a celkovou délku tisku v reálném čase.

## Detail

### Obsah tooltiplu

```
→ 14:20  |  2h 20min
```

- **Koncový čas** (`→ 14:20`) — kam sahá spodní hrana bloku, formát `HH:mm`, Prague timezone
- **Oddělovač** (`|`) — vizuální separator, tlumená barva
- **Celková délka** (`2h 20min`) — rozdíl `endTime - startTime`, formát `Xh Ymin`

### Pozice

- Těsně pod spodní hranou bloku (~4px gap)
- Zarovnaný vlevo s blokem (left = block left)
- Pohybuje se nahoru/dolů společně s resize preview (ne s kurzorem)

### Vizuál

- Pozadí: `rgba(0,0,0,0.85)` s `backdrop-filter: blur(12px)`
- Border: `1px solid rgba(100,180,255,0.4)`
- Border-radius: `8px`
- Padding: `5px 10px`
- Box-shadow: `0 4px 16px rgba(0,0,0,0.4)`
- Koncový čas: `font-weight: 700`, `color: #60a5fa` (modrý accent)
- Délka: `color: rgba(255,255,255,0.7)`
- Font: `font-variant-numeric: tabular-nums` (stabilní šířka číslic)
- Font-size: 12px čas, 11px délka

### Životní cyklus

1. Tooltip se **neobjeví** dokud drag nepřekročí `DRAG_THRESHOLD` (stávající logika)
2. Zobrazí se **pouze při resize** (`ds.type === "resize"`), ne při move/multi-move
3. Aktualizuje se v reálném čase při každém `onMouseMove`
4. Hodnoty snapují na 30min sloty (stávající `snapToSlot`)
5. Zmizí při puštění myši (`setDragPreview(null)`)

### Implementace

**Soubor:** `src/app/_components/TimelineGrid.tsx`

**1. Rozšířit `DragPreview` typ:**
```typescript
type DragPreview = {
  blockId: number;
  top: number;
  height: number;
  machine: string;
  resizeEnd?: Date;      // nové — snapped end time (jen při resize)
  resizeStart?: Date;    // nové — original start time (jen při resize, pro výpočet délky)
} | null;
```

**2. V `onMouseMove` handler — větev `ds.type === "resize"` (řádek ~1916):**

Přidat `resizeEnd: snappedEnd` a `resizeStart: ds.originalStart` do `setDragPreview` volání.

**3. Renderovat tooltip — vedle stávající dashed landing zone (řádek ~2912):**

Podmínka: `dragPreview?.resizeEnd != null`

Tooltip je `div` s `position: absolute`, `top: dragPreview.top + dragPreview.height + 4`, stejný `left`/`width` jako landing zone.

**4. Formátovací helper (inline):**
- Čas: `new Date(resizeEnd).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" })`
- Délka: vypočítat z `resizeEnd - resizeStart`, převést na `Xh Ymin`

### Scope

- Jeden soubor: `TimelineGrid.tsx`
- ~30 řádků změn
- Žádné nové soubory, žádné API změny, žádné nové závislosti
- Žádný dopad na existující testy
