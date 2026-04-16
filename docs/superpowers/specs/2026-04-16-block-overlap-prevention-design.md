# Block Overlap Prevention — Design Spec

**Datum:** 2026-04-16
**Problém:** Bloky na timeline se mohou navzájem překrývat na stejném stroji. Stává se to při editaci bloků přes formulář (BlockEdit), zejména při zpětné editaci.
**Požadavek:** Překryvy se nesmí nikdy stát — ani pro bloky v minulosti, ani pro žádný typ bloku.

---

## Root Cause analýza

### 1. Stale `editingBlock` v `buildPayload()`

Když uživatel otevře edit panel (double-click na blok), `editingBlock` je snapshot z toho momentu. Pokud jiná operace (resize sousedního bloku, drag, autoResolveOverlap push) posune editovaný blok, `editingBlock` se neaktualizuje.

`buildPayload()` v `BlockEdit.tsx:401` počítá:
```javascript
endTime = new Date(block.startTime + durationHours * 3600000)
```
kde `block.startTime` je stale. Výsledný `endTime` je špatný.

**Kde v kódu:**
- `PlannerPage.tsx:1323` — `handleBlockUpdate` aktualizuje `blocks` a `selectedBlock`, ale NE `editingBlock`
- `PlannerPage.tsx:609` — `editingBlock` se nastaví jen při double-clicku (řádek 2137)

### 2. Server nemá block-to-block overlap check

`PUT /api/blocks/[id]` (řádky 99-118) volá `validateBlockScheduleFromDb()`, která kontroluje pouze pracovní dobu a company days. Žádný dotaz na existující bloky na stejném stroji ve stejném čase.

Důsledek: jakékoliv selhání klientské overlap resolution = trvalý překryv v DB.

### 3. `handleSaveAll` posílá špatný `endTime` a nevolá overlap resolution

`PlannerPage.tsx:1660-1685` — při uložení série ("Celou sérii") posílá identický payload (včetně jednoho `endTime`) všem blokům. Bloky na jiných dnech dostanou špatný `endTime`. Po uložení nevolá `handleBlockUpdate` ani `autoResolveOverlap`.

---

## Architektura řešení

Tři vrstvy — server-side guard jako tvrdá garance, oprava klientských root causes jako prevence, a fallback handling.

### Vrstva 1: Server-side overlap guard

**Nový helper:**
```typescript
async function checkBlockOverlap(
  machine: string,
  startTime: Date,
  endTime: Date,
  excludeBlockId: number | null,
  tx: PrismaTransactionClient
): Promise<{ id: number; orderNumber: string } | null>
```

Prisma dotaz:
```
Block WHERE machine = machine
  AND id != excludeBlockId
  AND startTime < endTime   (parametr)
  AND endTime > startTime   (parametr)
  LIMIT 1
```

Pokud vrátí blok → `throw new AppError("OVERLAP", "Blok koliduje s blokem #${conflict.orderNumber} na stejném stroji.")`

**Integrace:**

| Endpoint | Kde přidat | Poznámka |
|----------|-----------|----------|
| `PUT /api/blocks/[id]` | Uvnitř existující `$transaction`, před `tx.block.update` (řádek ~201) | Volat jen když se mění `startTime`, `endTime` nebo `machine` |
| `POST /api/blocks` | Před `prisma.block.create` | Vždy volat |
| `POST /api/blocks/batch` | Uvnitř transakce, po každém updatu sekvenčně | Změnit `Promise.all` na `for...of` smyčku |

**HTTP response při overlap:**
```json
{ "error": "Blok koliduje s blokem #17221 na stejném stroji." }
```
Status: **409 Conflict** (již existuje v `errorStatus` mapě jako `OVERLAP` → přidat do mapy)

**Platí pro:**
- Všechny typy bloků (ZAKAZKA, REZERVACE, UDRZBA)
- Bloky v minulosti i budoucnosti
- Všechny role (ADMIN, PLANOVAT)

### Vrstva 2: Oprava klientských root causes

#### 2A. Sync `editingBlock` v `handleBlockUpdate`

**Soubor:** `PlannerPage.tsx`, funkce `handleBlockUpdate` (~řádek 1324)

Přidat za `setSelectedBlock(...)`:
```javascript
setEditingBlock((eb) => eb?.id === updated.id ? updated : eb);
```

Tím se `block` prop v `BlockEdit` aktualizuje a `buildPayload()` použije správný `startTime`. Lokální stav formuláře (`durationHours`, metadata) se nezmění — `useState` initial value se aplikuje jen při mount, a `key={editingBlock.id}` zůstává stejný.

#### 2B. Oprava `handleSaveAll` — per-block endTime

**Soubor:** `PlannerPage.tsx`, funkce `handleSaveAll` (~řádek 1660)

Současný kód posílá identický `payload` všem blokům:
```javascript
ids.map((id) => fetch(`/api/blocks/${id}`, { body: JSON.stringify(payload) }))
```

Nový kód:
1. Extrahovat `durationMs` z payloadu: pokud payload obsahuje `endTime`, spočítat `durationMs` z editovaného bloku (`editingBlock.startTime` → `payload.endTime`)
2. Pro každý blok v `ids` najít jeho aktuální `startTime` z `blocksRef.current`
3. Spočítat per-block `endTime = blockStartTime + durationMs`
4. Poslat individuální payload per blok
5. Po uložení zavolat `handleBlockUpdate(result)` pro každý výsledek — tím se spustí `autoResolveOverlap` pokud se čas změnil

Pokud payload neobsahuje `endTime` (čistě metadata save), posílat identický payload jako dosud.

**Změnit z `Promise.all` na sekvenční `for...of`** — aby `autoResolveOverlap` pro jeden blok doběhl před uložením dalšího.

#### 2C. Batch endpoint — sekvenční zpracování

**Soubor:** `blocks/batch/route.ts`

Změnit `Promise.all` uvnitř transakce na sekvenční `for...of` smyčku. Po každém updatu volat `checkBlockOverlap` pro ověření, že update nezpůsobil kolizi s předchozími updaty v téže transakci ani s existujícími bloky.

### Vrstva 3: Klientský handling 409

**Všechna místa kde se volá `fetch(...PUT/POST...)` pro bloky:**
- `BlockEdit.tsx:doSave` (~řádek 409)
- `TimelineGrid.tsx` move handler (~řádek 2022)
- `TimelineGrid.tsx` resize handler (~řádek 2041)
- `PlannerPage.tsx:handleSaveAll` (~řádek 1662)
- `PlannerPage.tsx:autoResolveOverlap` chain push (~řádek 1279)

Na 409 response zobrazit toast:
```
"Blok koliduje s jiným blokem na stejném stroji. Zkuste akci opakovat."
```

Pro `autoResolveOverlap` chain push: pokud chain push dostane 409, zavolat `revertMovedBlock()` (stávající logika) — blok se vrátí na původní pozici.

### Cleanup: Detekce existujících překryvů

Jednorázový SQL dotaz pro audit:
```sql
SELECT a.id AS blockA, b.id AS blockB, a.machine,
       a.startTime AS aStart, a.endTime AS aEnd,
       b.startTime AS bStart, b.endTime AS bEnd
FROM Block a
JOIN Block b ON a.machine = b.machine
  AND a.id < b.id
  AND a.startTime < b.endTime
  AND a.endTime > b.startTime
ORDER BY a.machine, a.startTime;
```

Výsledek vyhodnotit manuálně — automatická oprava by mohla rozbít plánovací logiku.

---

## Implementační fáze

### Fáze 1 (okamžitě — kritické opravy)

1. **`checkBlockOverlap` helper** — nový soubor `src/lib/overlapCheck.ts`
2. **Server-side overlap check v PUT endpointu** — integrace do `$transaction` + `OVERLAP` v `errorStatus` mapě → 409
3. **Overlap check v batch endpointu** — sekvenční `for...of` + `checkBlockOverlap` po každém updatu
4. **Sync `editingBlock`** — jednořádková změna v `handleBlockUpdate`
5. **Oprava `handleSaveAll`** — per-block endTime + volání `handleBlockUpdate`
6. **`autoResolveOverlap` — batch push** — chain push přes batch endpoint místo individual PUTs; 409 z hlavního PUT spustí resolve místo error toast
7. **Klientský handling 409** — toast ve zbylých save paths (BlockEdit, resize)

### Fáze 2 (následující iterace)

8. **Overlap check v POST endpointu** — pro nové bloky
9. **Cleanup script** — SQL audit existujících překryvů

---

## Dopad na drag & drop flow — DŮLEŽITÉ

Server-side overlap check změní chování drag & drop. Současný flow:
1. PUT přesunutý blok → uloží se (i když překrývá sousední)
2. `autoResolveOverlap` posune sousední bloky (jednotlivé PUTs)

S overlap checkem krok 1 vrátí **409** — blok nelze uložit, protože překrývá sousední.

**Řešení: `autoResolveOverlap` pošle push chain přes batch endpoint**

Změna v `autoResolveOverlap` (cca řádky 1275-1291): místo `Promise.all` s jednotlivými PUTs pro chain posílat **jeden batch request** (POST `/api/blocks/batch`). Batch endpoint validuje finální stav holicky — pokud po aplikaci všech updatů nejsou překryvy, projde.

Nový flow pro drag & drop:
1. PUT přesunutý blok → **409** (overlap detekován)
2. Klient nepovažuje 409 za fatální chybu — místo toast zavolá `autoResolveOverlap`
3. `autoResolveOverlap` sestaví chain a pošle **batch** obsahující přesunutý blok + celý push chain
4. Batch endpoint validuje finální stav → 200 OK
5. Klient aktualizuje stav

Změna je cílená — `autoResolveOverlap` mění jen způsob odesílání (batch místo individual PUTs), vnitřní logika (chain building, locked block handling, snap) zůstává.

Fallback: pokud batch selže (locked blok v cestě, pracovní doba), `revertMovedBlock()` vrátí blok na původní pozici (stávající logika).

**Pro resize v TimelineGrid** platí totéž — resize mění endTime, server může vrátit 409, handler zavolá `autoResolveOverlap` se stejným batch flow.

## Co se NEMĚNÍ

- `autoResolveOverlap` vnitřní logika (chain building, locked blocks, snap) — beze změny
- `validateBlockScheduleFromDb` — kontroluje pracovní dobu (orthogonální concern)
- Batch endpoint API contract (vstup/výstup) — jen interně sekvenční + overlap check

---

## Testovací strategie

### Server-side (unit testy)

Rozšířit `scheduleValidationServer.test.ts` nebo vytvořit nový `overlapCheck.test.ts`:

1. **Základní overlap** — blok A 10:00-12:00, pokus uložit blok B 11:00-13:00 na stejný stroj → 409
2. **Sousední bloky** — blok A 10:00-12:00, blok B 12:00-14:00 → OK (dotýkají se, nepřekrývají)
3. **Různé stroje** — blok A na XL_105 10:00-12:00, blok B na XL_106 10:00-12:00 → OK
4. **Self-exclude** — update bloku A (id=1) s novým endTime, `excludeBlockId=1` → nekontrolovat sám sebe
5. **Všechny typy** — ZAKAZKA, REZERVACE, UDRZBA — všechny musí být kontrolovány
6. **Bloky v minulosti** — stejná validace jako pro budoucnost

### Manuální testy

1. Otevřít edit panel, resizovat sousední blok (aby se editovaný posunul), uložit z edit panelu → endTime musí být správný
2. Série: změnit duration a uložit "Celou sérii" → každý blok musí mít správný endTime odpovídající své pozici
3. Drag & drop přes existující blok → autoResolveOverlap musí posunout, ne vytvořit překryv
