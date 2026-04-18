# Edge Auto-Scroll při dragu bloků

## Problém

Při tažení bloků (move, resize, multi-move, queue drag, lasso) směrem k okraji timeline se scroll kontejner nepohybuje. Uživatel musí pustit blok, ručně scrollovat a znovu uchopit.

## Řešení

Implementovat auto-scroll pomocí `requestAnimationFrame` loop v `TimelineGrid.tsx`.

### Mechanika

1. Během aktivního dragu detekovat, zda je kurzor v **edge zóně** (60px od horního/dolního okraje scroll kontejneru)
2. Pokud ano, spustit rAF loop, který scrolluje kontejner progresivní rychlostí (čím blíž k okraji, tím rychleji, max ~600px/s)
3. Během auto-scrollu přepočítávat drag preview pozici (protože se mění `scrollTop` ale `clientY` zůstává)
4. Zastavit auto-scroll při opuštění edge zóny nebo mouseup

### Dotčené drag typy

| Typ | Detekce v kódu |
|-----|----------------|
| Block move | `ds.type === "move"` |
| Block resize | `ds.type === "resize"` |
| Multi-move | `ds.type === "multi-move"` |
| Queue drag | `queueDragItemRef.current` |
| Lasso | `lassoRef.current` |
| Overlay resize | `ds.type === "overlay-resize"` |

### Implementační detaily

- `autoScrollRef = useRef({ active: false, speed: 0, rafId: 0 })`
- `lastMouseRef = useRef({ clientX: 0, clientY: 0 })` — pro přepočet preview při scrollu
- Edge zóna: 60px, progresivní rychlost 100–600px/s
- rAF loop volá existující drag logiku s uloženými mouse koordináty
- Cleanup: `stopAutoScroll()` v `onMouseUp` + v useEffect cleanup

### Rozsah

~40 řádků v `TimelineGrid.tsx`, žádné nové soubory ani závislosti.
