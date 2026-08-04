# Atomické undo — návrh (4. 8. 2026)

Spec etapy, kterou vyvolalo selhání undo při testování hromadného překlopení
rezervace. Podklad: `docs/audits/2026-08-04-undo-atomicita-vyzkum.md` (výzkum
kódu, 4 agenti) + rešerše, jak undo řeší zavedené systémy.

**Rozhodnutí Vojty 4. 8. 2026: etapově A → B.** Tenhle dokument specifikuje
**etapu A** a načrtává **etapu B** jen natolik, aby A nebylo potřeba přepisovat.

---

## 1. Problém

Undo se dnes provádí jako **sekvence nezávislých HTTP volání** (PUT, PUT, pak
batch) bez transakce mezi nimi. Cokoliv selže uprostřed, zůstane půl vrácené —
a druhý Ctrl+Z už nepomůže, protože buildery si při dílčím úspěchu přepsaly
`updatedAt` a guard porovnává živý stav proti protistraně snapshotu. Uživatel
dostane hlášku „blok byl mezitím změněn jiným uživatelem", což je lež: změnili
jsme ho my vlastním půl-provedeným undo.

Tři konkrétní důsledky, které plánovač vidí:

1. **Undo skončí napůl** a další pokus tiše zahodí záznam z historie.
2. **Odsunutý blok se nevrátí**, pokud jeho původní pozice neleží na 30minutové
   mřížce — chain push totiž při odsunu vždy zarovnává, takže off-grid blok se
   vrátit *nemůže*. Není to shoda okolností, selže to pokaždé.
3. **Soused, jehož span překlenoval pauzu směny, se undo-obnovou zkomprimuje**
   (batch pod bypassem počítá `end = start + printMinutes` a klientský `endTime`
   ignoruje). Uvnitř jedné směny se to neprojeví, u nočních a víkendových
   přechodů ano.

Chyba serveru navíc končí v `console.error`, ne v toastu — plánovač se nikdy
nedozví proč.

## 2. Co říká rešerše

Modely undo, které se v praxi používají:

| Model | Kdo tak jede | Vhodnost sem |
| --- | --- | --- |
| Memento (kopie celého stavu) | jednouživatelské editory | ne — v multi-user smaže cizí změny |
| Command s inverzí, snapshot u klienta | Figma, Liveblocks, Google Slides | **dnešní stav** |
| Serverová revize + atomický revert | django-reversion, Rails paper_trail, temporální tabulky | **cíl (etapa B)** |
| OT / CRDT | Google Docs | ne — masivní overkill |

Tři věci přebíráme přímo z django-reversion, protože řeší přesně tuhle třídu
úlohy (CRUD nad relační databází):

- **Revert zapisuje uložené hodnoty doslova, bez business validace.**
- **Revert běží v jedné transakci** (`transaction.atomic()`).
- **Smazaný záznam se obnovuje s původním primárním klíčem.**

A jedna věc, kterou naopak vědomě nepoužíváme: **sagy / kompenzační transakce**.
Ty jsou pro distribuované systémy, kde skutečná transakce není k dispozici.
Tady je všechno v jedné MySQL databázi, takže `$transaction` je striktně lepší.

Politiku konfliktu necháváme, jak je: když blok mezitím změnil někdo jiný,
undo **neudělá nic** a záznam se zahodí. Figma, Liveblocks i Google Slides to
dělají stejně. Vadná je jen hláška, ne pravidlo.

## 3. Rozsah

### Etapa A — v tomhle specu

Nový endpoint `POST /api/blocks/undo`, který provede **celý krok historie
v jedné transakci**. Snapshot pořád posílá klient. Bez migrace, bez zásahu do
existujících zápisových cest.

### Etapa B — jen načrtnuto (samostatný spec)

Tabulka `BlockRevision` (JSON snapshot dotčených bloků + `revisionId`, zapisovaná
v téže transakci jako každá mutace). Endpoint pak dostane jen `revisionId`
a snapshot si načte ze serveru. Tím se doslovná obnova stane **prokazatelně**
bezpečnou (server vrací stav, který si sám zapsal) a undo přežije reload.

Jádro endpointu, audit, overlap pojistka i testy se z A do B recyklují — mění se
jen zdroj snapshotu.

### Mimo rozsah obou etap

- undo pro **split** a **reflow** (dnes nemají undo vůbec),
- undo pro **drop rezervace z fronty** (vyžaduje rozhodnout, co s `Reservation`
  stavem a notifikací obchodníkovi — backlog),
- jakákoliv změna chování chain pushe.

## 4. Kontrakt endpointu

```
POST /api/blocks/undo        role: ADMIN | PLANOVAT   (requireRole uvnitř try)
```

```typescript
type UndoRequest = {
  label: string;                   // "Přesun bloku" — do auditu i toastu
  direction: "undo" | "redo";      // jen pro audit a hlášky
  ops: UndoOp[];                   // neprázdné
};

type UndoOp =
  | { kind: "upsert"; id: number; expectedUpdatedAt?: string; fields: Record<string, unknown> }
  | { kind: "remove"; id: number; expectedUpdatedAt?: string };
```

`upsert` znamená **„blok s tímhle id má existovat s těmito hodnotami"** — když
řádek existuje, přepíše se; když neexistuje (undo mazání), vytvoří se
**s původním id**. Jeden druh operace pokrývá přesun, editaci, obnovu odsunutých
sousedů i vzkříšení smazaného bloku.

`fields` prochází serverovým allowlistem `UNDO_RESTORABLE_FIELDS`. Povolené:
pozice (`startTime`, `endTime`, `machine`, `printMinutes`, `scheduleBypassed`),
identita (`type`, `orderNumber`, `blockVariant`, `locked`, `splitGroupId`)
a business pole z `EXPECTED_PAYLOAD_KEYS`. **Nepovolené a odmítnuté s 400:**
`id`, `createdAt`, `updatedAt`, `reservationId`, `recurrenceParentId`
a celá trojice `printCompleted*` — potvrzení tisku má vlastní endpoint a undo
plánovače do něj nesmí sahat.

> **`fields` NENÍ `blockToCreatePayload`.** Ten je tvarovaný pro POST route
> a spoléhá na její odvozeniny — vynechává `dataOk` (server si ho dopočítá
> z `dataStatusId`) a natvrdo posílá `recurrenceType: "NONE"`. Undo žádné
> odvozeniny spouštět nesmí, takže allowlist obsahuje i `dataOk` a snapshot
> nese hodnoty tak, jak byly ve sloupcích. `buildDeleteCommand` se proto
> z `blockToCreatePayload` překlápí na přímý snapshot polí.

### Odpověď

```typescript
{
  updated: SerializedBlock[];   // stav VŠECH upsertovaných bloků po zápisu
  removed: number[];            // id smazaných
}
```

Klient z toho udělá jeden `addToState` + jeden `removeFromState` a osvěží si
`updatedAt` pro další krok historie.

## 5. Validační postoj — jádro návrhu

**Endpoint nespouští `validateAndComputeEnd` ani žádnou kontrolu z rodiny
harmonogramu. Zapisuje `startTime`, `endTime`, `printMinutes`
a `scheduleBypassed` doslova ze snapshotu.**

Zdůvodnění: undo vrací stav, který v databázi prokazatelně existoval. Měřit ho
dnešními pravidly je kategorická chyba — přesně to dnes rozbíjí návrat off-grid
bloků. Endpoint navíc **vůbec nevolá `expandPrintTime`**, takže nepotřebuje ani
mřížkovou kontrolu; ta je jen předsazená brána, která z tvrdého throwu uvnitř
`expandPrintTime` dělá čistou 422 (`scheduleValidationServer.ts:57-59`).

Zároveň to opravuje kompresi spanu přes noční pauzu (bod 3 v sekci 1), protože
`endTime` se bere ze snapshotu, ne dopočítává.

**Co běží vždy, bez výjimky:**

- **`assertNoOverlapForBlocks`** na konci transakce, nad každým dotčeným strojem.
  Tohle je invariant, který chrání plán, a nesmí mít žádnou únikovou cestu.
  Stroje se berou z **cílového** stavu upsertů (funkce filtruje `machine = ?`,
  takže přesun na jiný stroj musí kontrolovat ten nový); stroje, ze kterých se
  jen odcházelo, kontrolu nepotřebují, protože uvolněné místo překryv nevyrobí.
- **Optimistic lock** všech `expectedUpdatedAt` (viz 6).
- **Zákaz smazat blok s potvrzeným tiskem** — pravidlo, které dnes žije
  v klientovi (`PlannerPage.tsx:177-183` dělá kvůli němu zvláštní GET). Přesun
  do transakce zavírá TOCTOU mezeru.

**Co se jen loguje, neblokuje:** obnova startu mimo 30minutovou mřížku a obnova
do firemní odstávky dostanou `logger.warn` s id bloku. Produkce tak má
viditelnost, aniž by undo přestalo fungovat.

> **Vědomé riziko etapy A:** endpoint věří snapshotu od klienta, takže session
> s rolí ADMIN/PLANOVAT přes něj teoreticky umí umístit zakázku mimo mřížku.
> Táž session dnes umí přes běžné cesty vyrobit off-grid **rezervaci i údržbu**
> (`validateAndComputeEnd` se pro ně vůbec nespouští), takže přírůstek expozice
> je omezený na typ ZAKAZKA. Etapa B riziko odstraní úplně.

## 6. Souběh a pořadí

**Všechny `expectedUpdatedAt` se ověří najednou, uvnitř transakce, PŘED prvním
zápisem.** Neshoda → `AppError("CONFLICT")` → 409 → rollback → **nezměnilo se
nic**. Klient to mapuje na `StaleUndoError`.

Tím zmizí i důvod, proč `buildMultiEditCommand` dnes `expectedUpdatedAt`
záměrně neposílá: sekvenční PUTy si navzájem bumpovaly verze. Endpoint čte stav
jednou a zapisuje až po kontrole, takže **zámek může nést každý cíl**.

**Pořadí operací uvnitř transakce přestává být problém.** Dnes na něm záviselo
všechno (undo mazalo před návratem sousedů, redo naopak), protože každý krok
narazil na finální pojistku batche. Nově se **rané overlap kontroly nespouštějí
vůbec** — provedou se všechny zápisy a teprve na konci proběhne jediná
`assertNoOverlapForBlocks`. Mezistavy uvnitř transakce nikdo nevidí.

Uvnitř transakce se přesto drží pořadí `remove` → `upsert` (uvolnit místo dřív,
než se plní), aby chybové hlášky dávaly smysl.

## 7. Idempotence

Retry po ztracené odpovědi nesmí operaci zdvojit. Místo Stripe-style
idempotency klíče s vlastní tabulkou stačí **udělat každou operaci idempotentní
z podstaty**:

| Operace | Opakované provedení |
| --- | --- |
| `upsert` na existující řádek | zapíše tytéž hodnoty → no-op |
| `upsert` na chybějící řádek | vytvoří s původním id |
| `remove` chybějícího řádku | **úspěch, no-op** (dnes 404 → výjimka → zacyklení) |

Poslední řádek zároveň opravuje vadu 4.2 z výzkumu. Idempotency klíč si
poznamenáváme jako alternativu, kdyby někdy vznikla potřeba deduplikace napříč
requesty; pro tuhle třídu operací je zbytečný.

**Obnova s původním id** je bezpečná: MySQL `AUTO_INCREMENT` se explicitním
vložením nižší hodnoty nesnižuje, takže budoucí kolize nehrozí. `Block.id` je
na produkci `INT UNSIGNED` — explicitní insert s tím nemá problém, protože
`BlockRevision` v etapě B záměrně **nebude mít FK na Block** (stejně jako dnes
`AuditLog.blockId`), aby snapshot přežil smazání bloku.

## 8. Audit a SSE

**Audit** — jeden `AuditLog` řádek na dotčený blok, v téže transakci,
`action: "UNDO"` / `"REDO"`, `oldValue`/`newValue` ve tvaru
`"<ISO>–<ISO>"` (týž formát jako `AUTO_SHIFT`, takže `fmtAuditVal` ho vykreslí
bez úprav). Do popisků akcí v historii se doplní český překlad.

**SSE** — mapuje se na existující události, aby klientské handlery zůstaly
beze změny:

| Co se stalo | Událost |
| --- | --- |
| upsert existujícího bloku | `block:batch-updated` |
| upsert chybějícího (vzkříšení) | `block:created` |
| remove | `block:deleted` |

## 9. Klientská strana

**`src/lib/undo/types.ts`** — `UndoEffects` dostane jedinou novou metodu
`applyUndo(req: UndoRequest): Promise<UndoResponse>`. Staré `putBlock`,
`postBlock`, `deleteBlock`, `batchUpdate` z rozhraní undo **mizí** (v
PlannerPage zůstávají pro ostatní použití).

**`src/lib/undo/commands.ts`** — všech šest builderů se překlápí z „posloupnosti
efektů" na „sestav `ops` a zavolej `applyUndo` jednou". Konkrétně:

| Builder | Dnes | Nově |
| --- | --- | --- |
| `buildMoveCommand` | 1× batch | `ops` = upserty pozic |
| `buildEditCommand` | PUT + batch | upsert primáru + upserty sousedů |
| `buildMultiEditCommand` | N× PUT + batch | N upsertů + upserty sousedů |
| `buildMoveOrResizeCommand` | dispatcher | beze změny (deleguje) |
| `buildCreateCommand` | N× DELETE + batch / batch + N× POST | `remove` + upserty / upserty + `upsert` |
| `buildDeleteCommand` | N× POST / N× DELETE | upserty (původní id!) / `remove` |

Odpadá helper `restoreShifted`, odpadá přeskakovací větev pro server-propagované
cíle, odpadá remap id po re-POSTu (id se zachovává). **`commands.ts` se tím
zkracuje, ne prodlužuje.**

Guard nad živým stavem (`getLiveBlock`) zůstává jako **rychlá klientská
předběžka**; autoritativní je serverový optimistic lock.

**`useUndoManager.ts`** — v catch větvi se místo generické hlášky použije
`err.message` ze serveru:

```
„Vrácení zpět selhalo: Blok koliduje s blokem #12345 na stroji XL 105."
```

Server posílá 409 s kódem `CONFLICT` pro stale zámek → klient z toho udělá
`StaleUndoError` a záznam zahodí (dnešní politika); ostatní chyby se vrací na
zásobník, což je nově **korektní**, protože nic nezůstalo půl provedené.

## 10. Vady, které tím padnou bez další práce

Z výzkumu, sekce 4 a 5:

- **4.1 nekonečná smyčka `buildDeleteCommand.undo`** — obnova jde přes upsert
  bez re-validace, takže netrvale neselhává; a při neúspěchu se nezmění nic.
- **4.2 `deleteBlock` není idempotentní** — `remove` chybějícího = úspěch.
- **4.3 duplikáty při retry undo mazání** — obnova s původním id nemůže
  vyrobit druhou kopii; self-shift POST route se vůbec nespustí.
- **5 komprese spanu** — `endTime` se bere ze snapshotu.
- **Lživá hláška „změnil jiný uživatel"** — zmizí, protože rozhozené verze už
  nevznikají vlastním půl-provedeným undo.

Zbývá dořešit odděleně (jeden řádek, ale mimo endpoint):

- **4.4 testy jádra undo se nespouštějí** — `src/app/_components/useUndoManager.test.ts`
  není v globu. Doplnit `src/app/_components/*.test.ts` do příkazu v `CLAUDE.md`.

## 11. Struktura kódu a testy

Podle vzoru `reflow.server.ts` — logika v `src/lib/`, route jako tenká slupka:

- **`src/lib/undoApply.server.ts`** — `applyUndoOps(tx, ops, session, label, direction)`.
  Sem patří allowlist polí, kontrola zámků, upsert/remove, audit a finální
  overlap pojistka.
- **`src/lib/undoApply.server.test.ts`** — testy proti mockovanému `tx`.
- **`src/app/api/blocks/undo/route.ts`** — `requireRole` uvnitř try, parsování
  těla, `$transaction`, SSE, `errorStatus` v catch.

Minimální sada testů:

| Test | Ověřuje |
| --- | --- |
| upsert vrátí off-grid pozici | opravený incident ze 4. 8. |
| upsert zachová `endTime` přes pauzu směny | opravená komprese spanu |
| stale `expectedUpdatedAt` → CONFLICT a **žádný zápis** | atomicitu |
| chyba uprostřed dávky → **žádný zápis** | atomicitu |
| `remove` neexistujícího = úspěch | idempotenci |
| upsert chybějícího vytvoří blok **s původním id** | vzkříšení |
| výsledný překryv → OVERLAP i při jinak platných opech | že pojistka nemá únik |
| pole mimo allowlist → 400 | že endpoint není univerzální zápis |
| `printCompletedAt` → `remove` odmítnut | zachované business pravidlo |

Plus celá stávající suite (557 testů) zelená a `useUndoManager.test.ts` nově
skutečně spuštěný.

## 12. Rizika

| Riziko | Mitigace |
| --- | --- |
| **Nová zápisová cesta** — nejrizikovější třída změny v tomhle projektu (v 7/2026 se ukázalo, že reflow roky nevolal overlap pojistku) | `assertNoOverlapForBlocks` je v specu jako nevynechatelná; test na to cílí přímo; multi-agent review před commitem |
| Endpoint věří klientskému snapshotu | allowlist polí, role gate, warn logy; etapa B riziko ruší |
| Přepis všech šesti builderů naráz | buildery mají dnes testy v `src/lib/undo/commands.test.ts`; ty musí projít beze změny sémantiky |
| Regrese v chování, které plánovač zná | ruční průchod fixture dne 2. 9. 2026 (`scripts/seed-test-pripominky-dev.ts`) |

## 13. Ověření

1. `npm run build` + `npm run lint` (0 chyb).
2. Celá suite včetně nového globu (`undoApply.server.test.ts` spadá pod
   `src/lib/*.test.ts`, přidává se jen složka `_components`):
   `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
3. Ruční scénáře na fixture dni:
   - vlož blok mezi `RETEZ-1..4` → Ctrl+Z vrátí vložený blok **i** všechny odsunuté,
   - překlop rezervaci `TEST-P8-REZ` na obou strojích → Ctrl+Z vrátí typ, číslo
     i případný odsun,
   - smaž blok → Ctrl+Z ho vrátí **se stejným id a s historií**,
   - vyvolej konflikt (druhé okno) → hláška řekne proč a **nic se nezmění**.
4. Multi-agent review (korektnost/regrese · konvence repa · souběh a transakce).

## 14. Otevřené k rozhodnutí při implementaci

- **Business pravidla u `upsert`.** Zákaz mazání bloku s potvrzeným tiskem je
  jasný. Zda smí undo *přesunout* blok s potvrzeným tiskem, dnes rozhoduje PUT
  route — endpoint má její pravidla zrcadlit, ne vymýšlet nová. Ověřit v kódu,
  ne odhadnout.
- **Retence pro etapu B** (30 dní v denním ops skriptu) — až v jejím specu.
