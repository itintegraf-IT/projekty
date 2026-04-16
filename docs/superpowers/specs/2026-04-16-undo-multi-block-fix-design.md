# Design: Oprava funkce zpět při hromadném přesunu zakázek

Datum: 2026-04-16  
Autor: Vojta Ťokan + Claude  
Stav: Schváleno uživatelem

---

## Kontext a problém

Funkce zpět (Ctrl+Z) nefunguje spolehlivě při práci s větším množstvím zakázek najednou. Příznaky:

- Po Ctrl+Z se přesunuté bloky vrátí, ale navazující bloky (auto-pushnuté) zůstanou na špatných místech
- Chování je nedeterministické — někdy funguje, jindy ne (závisí na timing React render cyklu)
- Výjimečně selže celé undo s toastem "Vrácení zpět selhalo"

---

## Analýza příčin

### Bug 1 (hlavní) — stale `blocksRef` race condition

**Soubor:** `src/app/_components/PlannerPage.tsx`, funkce `handleMultiBlockUpdate`, řádky ~1288–1316

`blocksRef` je inicializován jako:
```typescript
const blocksRef = useRef<Block[]>([]);
blocksRef.current = blocks;  // aktualizuje se každý render
```

Po batch přesunu se volá `setBlocks(...)` — React state update je asynchronní, `blocksRef.current` se neaktualizuje okamžitě. Smyčka `autoResolveOverlap` pak čte staré pozice přesunutých bloků, detekuje překryvy které neexistují (phantom overlaps) a zbytečně pushuje sousední bloky.

Výsledek: po Ctrl+Z jsou přesunuté bloky na správném místě, ale phantom-pushnuté bloky zůstávají posunuté.

### Bug 2 (sekundární) — schedule validace blokuje undo velkých batchů

**Soubor:** `src/app/api/blocks/batch/route.ts`, řádky 64–72  
**Soubor:** `src/app/_components/PlannerPage.tsx`, undo/redo funkce ~řádky 1296–1304

Undo batch přesunu volá `/api/blocks/batch` s `bypassScheduleValidation: bypassAtTime` (hodnota z doby přesunu). Batch API validuje working hours pro každý ZAKAZKA blok paralelně. Pokud byť jeden blok selže (edge case: šablona pracovní doby změněna po přesunu, nebo hraniční čas), celý undo selže s HTTP 422.

S větším počtem bloků roste pravděpodobnost aspoň jednoho selhání.

### Known limitation (neopravujeme)

Cascade auto-pushe z `autoResolveOverlap` nejsou zaznamenány v undo stacku. Po Ctrl+Z se vrátí pouze přímo přesunuté bloky — cascade efekty jsou ztráta. Toto je dokumentovaná known limitation, jejíž oprava by vyžadovala rekurzivní sledování všech cascade API callů.

---

## Navržené řešení

Minimální zásah — 2 změny pouze v `handleMultiBlockUpdate`, žádné API změny.

### Změna 1 — synchronní update `blocksRef` před smyčkou autoResolveOverlap

**Místo:** `handleMultiBlockUpdate`, po přijetí `results` z batch API

```typescript
// PŘED:
const results: Block[] = await batchRes.json();
setBlocks((prev) => prev.map((b) => results.find((r) => r.id === b.id) ?? b));

// PO:
const results: Block[] = await batchRes.json();
const newBlocks = blocksRef.current.map((b) => results.find((r) => r.id === b.id) ?? b);
blocksRef.current = newBlocks;  // synchronní update — smyčka níže vidí nové pozice
setBlocks(newBlocks);
```

`blocksRef.current` se ručně přepíše před smyčkou, aby `autoResolveOverlap` viděl aktuální pozice všech přesunutých bloků. `setBlocks(newBlocks)` pak provede standardní React state update pro re-render.

### Změna 2 — bypass validace v undo a redo funkcích

**Místo:** undo a redo funkce uvnitř `undoStack.current.push(...)` v `handleMultiBlockUpdate`

```typescript
// Undo:
body: JSON.stringify({ updates: prevSnaps, bypassScheduleValidation: true })

// Redo:
body: JSON.stringify({ updates: nextSnaps, bypassScheduleValidation: true })
```

Undo/redo obnovuje pozice, které server jednou přijal jako validní. Working hours validace je proto zbytečná a může způsobit falešné selhání (pokud se šablona pracovní doby mezitím změnila).

---

## Architektura a dopad

- **Změněný soubor:** pouze `src/app/_components/PlannerPage.tsx`
- **Žádné API změny**, žádné nové soubory, žádné změny DB schématu
- **Výkonnostní dopad:** nulový — `.map()` přes pole bloků je O(n), identické s předchozím `setBlocks(prev => ...)` voláním
- **Regresní riziko:** nízké — změna je lokalizována v jedné async funkci, logika overlap detection ani undo stack se nemění

---

## Testovací plán (manuální)

1. Lasso výběr 5+ zakázek vedle sebe na stejném stroji
2. Přesunout skupinu dopředu
3. Ctrl+Z — ověřit, že všechny přesunuté bloky se vrátily na původní pozice
4. Ověřit, že sousední bloky (mimo výběr) nejsou phantom-posunuté
5. Redo (Ctrl+Shift+Z) — ověřit, že se přesun znovu provede
6. Test s bypass režimem (lock OFF): přesunout bloky mimo pracovní hodiny, Ctrl+Z, ověřit návrat

---

## Mimo rozsah

- Oprava cascade undo (known limitation)
- Oprava undo pro single-block přesun (identická validace existuje v `handleBlockUpdate`, ale nepůsobí problémy v praxi)
- Žádné UI změny
