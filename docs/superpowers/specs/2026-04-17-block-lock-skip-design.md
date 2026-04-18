# Block Lock — Skip & Visual Indicator Design

**Datum:** 2026-04-17
**Autor:** Vojta + Claude
**Status:** Schváleno k implementaci

---

## Problém

Plánovač potřebuje možnost "ukotvit" blok na konkrétní čas — typicky náhled tisku domluvený s klientem. Ukotvený blok:
- nesmí být posunut automatickým push chainem
- musí být vizuálně jasně odlišený na první pohled (na bloku i v TIME sloupci)
- ostatní bloky ho musí při automatických posunech přeskočit, ne se o něj zastavit

## Rozhodnutí z brainstormingu

| Téma | Rozhodnutí |
|------|-----------|
| Vizuál na bloku | Široký amber pruh (~22px) místo 3px accentBar, ikona zámku uvnitř |
| Vizuál v TIME sloupci | Amber overlay přes celou šířku TIME sloupce na pozici bloku (varianta C) |
| Push chain chování | Přeskočit zamknutý blok — bloky se snapnou za jeho endTime |
| Undo/Redo | Celá operace (přesunutý blok + chain) = jeden undo záznam |
| Kdo zamyká | Jen ADMIN a PLANOVAT |
| Co se zamkne | Jen pozice (startTime, endTime, machine) — metadata volně editovatelná |
| Zamykací UI | Switch v BlockEdit (stávající) — beze změny |

---

## 1. Vizuální indikace zamknutého bloku

### 1.1 Na bloku (TimelineGrid — BlockCard)

**Zamknutý blok:**
- Levý accentBar se rozšíří z 3px na ~22px
- Pozadí pruhu: `rgba(251,191,36,0.25)` (amber)
- Ikona zámku (Lucide `Lock`, ~11px) uprostřed pruhu
- Border-right pruhu: `1px solid rgba(251,191,36,0.2)`
- Border celého bloku: `1px solid rgba(251,191,36,0.4)` (jemný amber)
- Volitelný box-shadow: `0 0 0 1px rgba(251,191,36,0.2)`
- Stávající malá ikona zámku vedle orderNumber zůstává beze změny

**Nezamknutý blok:**
- Beze změny — 3px accentBar v barvě typu bloku

**Platí pro všechny 3 renderovací módy:** MODE_FULL, MODE_COMPACT, MODE_TINY.

### 1.2 V TIME sloupci (timeline gutter)

Pro každý zamknutý blok na daném stroji se v příslušném TIME sloupci (72px) vykreslí overlay:

- **Pozice:** absolutní, `top` = `dateToY(block.startTime)`, `height` = výška bloku
- **Pozadí:** `rgba(251,191,36,0.08)`
- **Border:** horní a dolní `1px solid rgba(251,191,36,0.25)`
- **Obsah:** ikona zámku + čas startu bloku (amber barva, font-size 8px, font-weight 700)
- **pointerEvents:** `none` (nesmí blokovat lasso selection v TIME sloupci)

Poznámka: TIME sloupec je sdílený mezi stroji jen na pozici `colIdx === 0` (levý). Pro `colIdx > 0` je meziprůhledný TIME sloupec. Overlay se musí renderovat v obou — filtrovaný podle `block.machine`.

---

## 2. Push chain logika — přeskakování zamknutých bloků

### 2.1 Současné chování (co se mění)

Funkce `autoResolveOverlap` v `PlannerPage.tsx` dnes:
1. Najde `firstFollowing` blok, který koliduje s přesunutým
2. Pokud je `firstFollowing.locked` → **revert celé operace**
3. Buduje chain, pokud narazí na `next.locked` → **revert**
4. Kontroluje `chainPositions` vs locked bloky → pokud kolize → **revert**

### 2.2 Nové chování

Místo revertu se zamknutý blok **přeskočí**:

**Krok 1 — firstFollowing je locked:**
- Neprovádět revert
- Snapnout přesunutý blok za `firstFollowing.endTime` (+ working time snap)
- Pokračovat v hledání dalších kolizí normálně

**Krok 2 — blok v chainu narazí na locked:**
- Locked blok se nepřidá do chainu
- Poslední blok chainu se snapne za `lockedBlock.endTime` (+ working time snap)
- Chain pokračuje dál

**Krok 3 — chainPosition koliduje s locked blokem mimo chain:**
- Pozice kolidujícího bloku se přepočítá: snap za `lockedBlock.endTime`
- Všechny následující bloky v chainu se přepočítají kaskádovitě
- Pokud přepočet vytvoří novou kolizi s dalším locked blokem → opakovat

**Fallback:**
- Pokud po 200 iteracích chain stále není vyřešen → revert a zobrazit chybovou hlášku
- Toto je edge case (např. desítky zamknutých bloků za sebou bez mezer)

### 2.3 Pseudokód nové logiky

```
function autoResolveOverlap(movedBlock, excludeIds, prevBlock):
  // ... krok 1 (backward overlap) beze změny ...

  // krok 2: forward overlap
  curEnd = movedBlock.endTime
  chain = []
  chainPositions = []
  candidates = sameMachine.filter(not in excludeIds).sortByStartTime()

  pEnd = curEnd
  for i in 0..200:
    next = candidates.find(overlaps with pEnd window)
    if !next: break

    if next.locked:
      // PŘESKOČIT — posunout pEnd za konec zamknutého bloku
      // duration zde = duration dalšího kandidáta v řadě (ne locked bloku)
      pEnd = max(pEnd, next.endTime)
      continue  // nehledat kolizi s locked blokem, ale pokračovat

    chain.push(next)
    dur = next.duration
    ns = snapToNextValid(pEnd, dur)
    chainPositions.push({ id: next.id, newStart: ns, newEnd: ns + dur })
    pEnd = ns + dur

  // uložit chain přes batch API
  // rekurzivně vyřešit poslední blok
```

---

## 3. Undo/Redo — kompletní atomická operace

### 3.1 Současný problém

`handleBlockUpdate` ukládá do undoStack jen snapshot přesunutého bloku. Bloky posunuté chainem (`autoResolveOverlap` → batch POST) nemají vlastní undo záznam. Ctrl+Z vrátí jen přesunutý blok, chain bloky zůstanou posunuté.

### 3.2 Řešení

**Před spuštěním `autoResolveOverlap`:**
- Uložit snapshoty všech bloků na daném stroji (nebo alespoň všech, které se potenciálně posunou)

**Po dokončení `autoResolveOverlap`:**
- Porovnat aktuální stav s uloženými snapshoty
- Identifikovat všechny bloky, které změnily pozici (přesunutý + chain bloky)
- Vytvořit **jeden** undo záznam obsahující:
  - `undo`: batch PUT všech změněných bloků na původní pozice
  - `redo`: batch PUT na nové pozice

**Implementační přístup:**
- `autoResolveOverlap` dostane nový parametr `collectMovedBlocks: Map<number, Block>` (akumulátor)
- Každý blok, který chain posune, se přidá do mapy (id → původní snapshot)
- Caller (`handleBlockUpdate`) po dokončení vytvoří undo záznam ze všech nasbíraných snapshostů
- Rekurzivní volání `autoResolveOverlap` sdílí stejný akumulátor

---

## 4. Zamykání — oprávnění a scope

### 4.1 Kdo může zamknout/odemknout

- **ADMIN** — ano
- **PLANOVAT** — ano
- **DTP, MTZ, OBCHODNIK, TISKAR, VIEWER** — ne

### 4.2 Co lock zamyká

**Zamčeno (nelze změnit bez odemknutí):**
- `startTime`
- `endTime`
- `machine`
- Drag & drop (stávající: `if (block.locked) return`)
- Resize (stávající: `if (block.locked) return`)

**Volně editovatelné i na zamknutém bloku:**
- Všechna metadata: `orderNumber`, `description`, `specifikace`, `type`, `blockVariant`
- Deadline datumy: `dataRequiredDate`, `materialRequiredDate`, `deadlineExpedice`, `pantoneRequiredDate`
- Status flagy: `dataOk`, `materialOk`, `materialInStock`, `pantoneOk`
- Status labels: `dataStatusId`, `materialStatusId`, `barvyStatusId`, `lakStatusId`
- Poznámky: `notes`, `expediceNote`, `doprava`
- Print completion: `printCompletedAt`

### 4.3 UI zamykání

- Switch v `BlockEdit.tsx` (stávající) — zobrazit jen pro ADMIN a PLANOVAT
- Pro ostatní role: switch skrytý nebo disabled
- Žádné nové UI prvky pro zamykání (context menu, inline toggle) — stávající switch stačí

---

## 5. Dotčené soubory

| Soubor | Změna |
|--------|-------|
| `src/app/_components/PlannerPage.tsx` | Nová logika skip v `autoResolveOverlap`, undo akumulátor |
| `src/app/_components/TimelineGrid.tsx` | Amber pruh na bloku, amber overlay v TIME sloupci |
| `src/components/BlockEdit.tsx` | Skrýt lock switch pro role bez oprávnění |

**Žádné DB migrace** — pole `locked Boolean @default(false)` na Block modelu už existuje.

**Žádné API změny** — stávající PUT/batch endpointy už přijímají `locked` field.

---

## 6. Edge cases

| Scénář | Chování |
|--------|---------|
| Více zamknutých bloků za sebou | Chain přeskočí všechny, bloky se snapnou za poslední locked.endTime |
| Zamknutý blok na konci pracovní doby | Chain přeskočí locked + snap přes noc/weekend na další pracovní den |
| Lasso selection obsahuje zamknutý blok | Zamknutý blok se nevybere (stávající filtr `!b.locked`) |
| Nový blok (drag z fronty) koliduje s locked | Blok se umístí za locked.endTime místo smazání |
| Split group — jeden díl zamknutý | Zamknutý díl nepřesouvatelný, ostatní díly se chovají normálně |
| Copy/paste na pozici locked bloku | Paste blok se snapne za locked.endTime |
| 200 iterací bez vyřešení | Revert + chybová hláška |
