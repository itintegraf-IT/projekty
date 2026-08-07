# Serverové revize bloků — etapa B atomického undo

> Navazuje na `2026-08-04-atomicke-undo-design.md` (etapa A, hotová a ověřená
> 7. 8. 2026). Etapa A tam byla popsaná jako mezikrok: endpoint provede celý krok
> historie v jedné transakci, ale snapshot pořád posílá klient. Tenhle spec ten
> snapshot přesouvá na server.

## 1. Problém

Endpoint `POST /api/blocks/undo` **zapisuje doslova a nic nederivuje**. To je
záměr — undo vrací stav, který v databázi prokazatelně existoval, takže měřit ho
dnešní mřížkovou validací je kategorická chyba (viz výjimka v `CLAUDE.md`).

Důsledek té vlastnosti ale je, že **každé pole, které server jinak dopočítá, musí
být ve snapshotu**. Snapshot skládá klient. A klient si musí pamatovat, co všechno
server dopočítává.

Během etapy A se tahle vada projevila **třikrát nezávisle**:

| # | Kde | Co chybělo | Jak se to projevilo |
| --- | --- | --- | --- |
| 1 | změna délky tažením | `printMinutes` | blok se po Ctrl+Z vrátil na starou délku, ale s novým počtem tiskových minut |
| 2 | přesun bloku | `scheduleBypassed` | příznak zůstal nesedět s geometrií, kterou undo vrátilo |
| 3 | „Uložit vše → Celou sérii" | `printMinutes` + `scheduleBypassed` | undo proběhlo správně, ale vzniklý rozpor `span ≠ printMinutes` spustil výkřičník „přeplánovat" a reflow blok zase natáhl — navenek to vypadalo, že undo nefunguje vůbec |

Kořen je strukturální: **tři cesty si vedou tři vlastní seznamy sledovaných polí**
(`EDIT_TRACKED_FIELDS`, lokální `trackedHere` v `handleSaveAll`, poziční
snapshoty v `commands.ts`). Dokud je udržuje klient ručně, čtvrtý výskyt je
otázka času, ne pravděpodobnosti.

Zhoršující okolnost: **`PlannerPage.tsx` nehlídá žádný test.** Repo nemá
RTL/jsdom/vitest, takže zapojení v něm neověřuje nic. Mutační testování to během
etapy A opakovaně prokázalo — šlo odebrat celou opravu a 600+ testů zůstalo
zelených. Čtyřikrát se stalo, že oprava vypadala hotová, protože testy pokrývaly
čistou funkci a ne její volání.

### Druhý problém, který se řeší týmž tahem

`AUDITED_FIELDS` (`src/lib/auditedFields.ts`) **neobsahuje `startTime`, `endTime`,
`machine` ani `printMinutes`**. Auditní řádky pro běžnou editaci se staví výhradně
z něj (`src/app/api/blocks/[id]/route.ts:443–454`), takže:

> **Přetažení bloku na jiný stroj a jiný den nezapíše do historie vůbec nic.**

Přesně tohle znemožnilo hladkou rekonstrukci obou havárií plánu z 5. a 6. 8. 2026
(`docs/audits/`, paměť `incident_2026_08_05_auto_shift`). Rekonstruovat šlo jen to,
co `AUTO_SHIFT` řádky náhodou zachytily u odsunutých sousedů — ruční posun a
natažení jednoho bloku dohledat nešlo.

Revize drží celý řádek před změnou i po ní, takže černá skříňka vzniká jako
vedlejší produkt, ne jako další projekt.

## 2. Rozhodnutí zadavatele

Rozhodl Vojta 7. 8. 2026:

| Otázka | Rozhodnutí |
| --- | --- |
| Rozsah | výměna motoru **+ undo pro rozdělení a přeplánování** (dnes undo nemají vůbec) |
| Retence | **90 dní**, revize slouží zároveň jako černá skříňka pro rekonstrukci havárií |
| Přístup k datům | **v panelu historie bloku** — ne pouze v databázi |
| Zápis revize | pomocník obalí transakci a rozdíl si spočítá sám (varianta *(c)* níž) |
| Členění | dvě etapy **B1** a **B2** s vlastním nasazením |

### Co zůstává mimo rozsah

- **Historie nepřežije reload.** Zásobník kroků zpět dál žije v paměti prohlížeče
  (`useUndoManager.ts`, `MAX_HISTORY = 30`). Revize by to technicky umožnily, ale
  otevírá to otázku „čí historii vidím a smím vracet" — vlastní rozhodnutí, vlastní etapa.
- **Undo pro drop rezervace z fronty** — vyžaduje rozhodnout, co s `Reservation`
  stavem a notifikací obchodníkovi (backlog, nezměněno od etapy A).
- **Samostatná stránka rekonstrukce** („co se dělo se strojem XL105 dne 5. 8.").
  Vojta zvažoval, odložil. Data pro ni ale po B1 existují.
- **Poznámky k bloku** (`BlockNote`) — jiná tabulka, revize se jich netýkají.
- **Jakákoliv změna chování chain pushe.**

## 3. Členění na B1 a B2

| | **B1 — Černá skříňka** | **B2 — Undo přepnuté na revize** |
| --- | --- | --- |
| Obsah | migrace + model, zapisovací pomocník, zapojení do všech mutačních cest, úklid po 90 dnech, vykreslení v historii bloku | endpoint bere `groupId` místo `ops`, klientské buildery se zjednoduší, undo pro rozdělení a přeplánování |
| Riziko | nulové pro undo — přidává se jen zápis navíc | mění se běžící mechanismus |
| Přínos pro plánovače | historie bloku konečně ukáže přesuny a natažení | Ctrl+Z u rozdělení a u tlačítka Přeplánovat |
| Nasaditelné samostatně | ano | ano (staví nad B1) |

**Proč ten řez:** B2 startuje nad tabulkou, která už je několik týdnů plná ostrých
produkčních dat. Přepnutí undo se pak dá postavit proti reálným revizím, ne proti
fixturám. To je přímé poučení z etapy A, kde jedna oprava prošla testem jen proto,
že fixtura měla tvar, jaký produkce nikdy nevyrobí (`pos({...} as never)`).
Když se B2 zdrží nebo odloží, B1 stojí a funguje sám o sobě.

## 4. Datový model

```prisma
model BlockRevision {
  id        Int      @id @default(autoincrement())
  /** Jedna akce uživatele = jeden groupId napříč všemi dotčenými bloky. cuid z app kódu. */
  groupId   String   @db.VarChar(30)
  /** ZÁMĚRNĚ BEZ cizího klíče — revize musí přežít smazání bloku (undo mazání). */
  blockId   Int
  action    String   @db.VarChar(32)
  /** Popis kroku pro toast i historii, např. „Přesun bloku". */
  label     String   @db.VarChar(191)
  userId    Int
  username  String   @db.VarChar(191)
  /** Stav před změnou. `null` = blok tímto krokem vznikl. */
  before    Json?
  /** Stav po změně. `null` = blok byl tímto krokem smazán. */
  after     Json?
  createdAt DateTime @default(now())

  @@index([groupId])
  @@index([blockId, createdAt])
  @@index([createdAt])
}
```

Tvar záměrně kopíruje `AuditLog` (denormalizovaný `userId` + `username`, index
`[blockId, createdAt]` a `[createdAt]`) — stejný přístup, stejné dotazy, stejný
úklid. Hlavičková tabulka navíc není potřeba: `groupId` seskupuje, `label`
a autor se opakují na každém řádku a při pár set řádcích denně to nic nestojí.

### Bez cizího klíče — a je to dvojnásob správně

1. **Věcně:** undo mazání musí umět blok vzkřísit. FK s `onDelete: Cascade` by
   revizi smazal spolu s blokem; FK bez kaskády by naopak smazání bloku zablokoval.
2. **Technicky:** produkční `Block.id` je `INT UNSIGNED` (paměť
   `project_db_unsigned_fk_gotcha`), takže FK na něj z `INT` sloupce stejně selže
   na `errno 150`.

### Co přesně je v `before` / `after`

| Akce | `before` | `after` |
| --- | --- | --- |
| vznik bloku | `null` | **celý řádek** |
| smazání bloku | **celý řádek** | `null` |
| změna bloku | **jen sloupce, které se liší** | **jen sloupce, které se liší** |

Ukládat u změny celý 56sloupcový řádek by tabulku nafouklo zhruba desetkrát bez
jakéhokoliv užitku — nezměněné sloupce undo nepotřebuje zapisovat a v historii
by jen šuměly. Rozdíl počítá **server** z řádků, které sám přečetl, takže se tím
nevrací klientské vyjmenovávání polí zadními vrátky.

**Invariant:** `updatedAt` je v rozdílu vždy. Prisma ho mění při každém zápisu
(`@updatedAt`), takže tam padne přirozeně; závisí na něm kontrola souběhu (§ 6).

### Odhad velikosti

Běžná změna se dotkne 3–5 sloupců, s chain pushem tři bloky → řádově 600 B na
akci. Při 300 akcích denně to je 180 kB/den, tedy **pod 20 MB za 90 dní**.
Vznik a smazání ukládají celý řádek (1,3 kB), ale je jich zlomek. I s velkou
rezervou zůstává tabulka v desítkách MB — hodnota, kterou jsem uváděl při
rozhodování o retenci, tedy platí.

## 5. Zápis revize — jádro návrhu

### Uvažované varianty

**(a) Každá cesta si revizi zapíše sama.** Osm volání, osm příležitostí zapomenout.
Je to doslova dnešní vada přesunutá o patro níž — zamítnuto.

**(b) Prisma zachytí každý zápis globálně** (middleware / `$extends`). Žádné
volání, ale rozbije nejdůležitější vlastnost etapy A: *jedna akce uživatele =
jeden krok zpět*. Odsunutí pěti sousedů chain pushem je pět zápisů a **jedno**
stisknutí Ctrl+Z. Navíc extension nezná `label` ani autora záměru — zamítnuto.

**(c) Pomocník obalí transakci a rozdíl si spočítá sám. — ZVOLENO**

### Kontrakt

```typescript
// src/lib/revision.server.ts
export async function withRevision<T>(
  tx: PrismaTransactionClient,
  meta: {
    region: RevisionRegion;      // koho se to MŮŽE týkat
    action: RevisionAction;
    label: string;               // "Přesun bloku"
    user: { id: number; username: string };
  },
  body: (ctx: RevisionCtx) => Promise<T>,
): Promise<{ result: T; groupId: string }>;

/** Region = množina bloků, jejichž řádky se před mutací načtou. */
export type RevisionRegion =
  | { kind: "ids"; ids: number[] }
  | { kind: "window"; machine: string; from: Date; to: Date }
  | { kind: "union"; parts: RevisionRegion[] };

export type RevisionCtx = {
  /** Ohlásí id, které vzniklo až během mutace (typicky nová část splitu nebo nový blok). */
  born(id: number): void;
  /**
   * Ohlásí VŠECHNA dotčená id — týž seznam, jaký cesta na konci předává
   * `assertNoOverlapForBlocks`. Slouží výhradně jako křížová kontrola úplnosti
   * regionu (§ „Pojistka" níž), na obsah revize nemá vliv.
   */
  touched(ids: number[]): void;
};

/** Jedna hodnota na mutační cestu — sjednoceno s dnešními `AuditLog.action`. */
export type RevisionAction =
  | "CREATE" | "UPDATE" | "DELETE" | "BATCH"
  | "SPLIT" | "REFLOW" | "UNDO"
  | "PRINT_COMPLETE" | "EXPEDITION";
```

`born` a `touched` se nepřekrývají a obojí je potřeba: id v `touched` **bez**
zachyceného `before` je buď legitimně nově vzniklý blok (ohlášený přes `born`),
nebo díra v regionu. Bez `born` by pomocník ty dva případy nerozlišil.

Uvnitř mutace se **nemění nic**. Tělo `body` je dnešní kód beze změny.

### Průběh

1. **Před mutací** — pomocník načte **celé řádky** regionu pomocí
   `SELECT … FOR UPDATE`. Je to **první dotaz v transakci**, čímž zároveň plní
   pravidlo z `CLAUDE.md` (pod MySQL REPEATABLE READ založí obyčejný `findMany`
   jen consistent-read snapshot bez zámků; teprve zamykající čtení jako první
   dotaz zajistí, že se zámek i vidění dat kryjí).
2. **Mutace** — běží dnešní kód. Nově vzniklá id ohlásí přes `ctx.born(id)`.
3. **Po mutaci** — pomocník znovu načte sjednocení `region ∪ born` a **porovná
   řádek po řádku**. Řádky beze změny zahodí. Ze zbytku poskládá řádky
   `BlockRevision` se společným `groupId`.
4. **Zápis** — jedno `createMany` v téže transakci jako mutace i audit. Když
   transakce spadne, nezůstane ani revize.

### Proč to ruší celou třídu vad

Volající **nikde nevyjmenovává pole**. Nemůže tedy žádné vynechat — a v tom byl
celý problém. Jediné, co může zkazit, je příliš úzký region.

Region je ale *stroj a časové okno*, ne seznam sloupců, a **každá cesta ho už
dnes zná**: `resolveChainPushFromDb` si přesně takové okno čte, aby vůbec věděla,
co odsouvá (`overlapResolver.server.ts:90–111` — den před anchorem až 90 dní za
jeho koncem). Region se z něj odvodí, ne vymyslí.

A nadsadit region je zdarma: nezměněné řádky ve fázi 3 vypadnou.

### Pojistka proti příliš úzkému regionu

Úzký region je jediný způsob, jak tenhle návrh selže — a selhal by tiše. Proto
má vestavěnou kontrolu:

Finální overlap pojistka `assertNoOverlapForBlocks` dostává **seznam všech
dotčených id** a volá se na konci každé mutační cesty (povinnost z `CLAUDE.md`).
Cesta týž seznam ohlásí přes `ctx.touched(ids)` a `withRevision` ho porovná
s regionem. Když v něm je id **bez zachyceného `before` a neohlášené přes
`born`**:

- **vývoj a testy** → `throw` (`AppError("INTERNAL")`), aby to spadlo hned;
- **produkce** → `logger.error` s `groupId` a id, revize se dopočítá z aktuálního
  řádku a označí `partial: true`.

Tichý průchod tedy neexistuje ani v jednom prostředí.

## 6. Jak revize pohání undo (etapa B2)

### Kontrakt endpointu

```typescript
// Dnes (etapa A):
POST /api/blocks/undo { label, direction, ops: UndoOp[] }
// Po B2:
POST /api/blocks/undo { groupId: string, direction: "undo" | "redo" }
```

Server si `ops` **poskládá sám** z řádků `BlockRevision` daného `groupId`:

| Směr | `before` | `after` | Operace |
| --- | --- | --- | --- |
| undo | `null` | řádek | `remove` (blok vznikl → zrušit) |
| undo | řádek | cokoliv | `upsert` hodnotami z `before` |
| redo | cokoliv | `null` | `remove` |
| redo | cokoliv | řádek | `upsert` hodnotami z `after` |

**Jádro `applyUndoOps` se nemění.** Optimistic lock, zamykající čtení jako první
dotaz, idempotentní `remove`, vzkříšení s původním `id`, auditní řádek i finální
overlap pojistka zůstávají přesně jak jsou — mění se výhradně **zdroj** `ops`.
To je celá pointa členění z etapy A a je to teď k vyzvednutí.

### Kontrola souběhu

`expectedUpdatedAt` bere server z `after.updatedAt` — tedy ze stavu, který akce
po sobě zanechala. Když se živý řádek liší, sáhl na blok mezitím někdo jiný a
undo se odmítne (`CONFLICT`). Politika se nemění; mění se jen to, že hodnotu
**dodává server ze svého zápisu**, ne klient ze své paměti.

Tím padá i dnešní tichá díra: chybějící `expectedUpdatedAt` v požadavku se dnes
bez hlášky přeskočí. Po B2 nemá jak chybět.

### Zápis a restaurování jsou dvě různé množiny

Revize zaznamenává **všechno**, co se v řádku změnilo. Co smí undo zapsat zpátky,
dál hlídá `UNDO_RESTORABLE_FIELDS` (`src/lib/undo/restoreFields.ts`).

Konkrétně: potvrzení tisku (`printCompletedAt`, `printCompletedByUserId`,
`printCompletedByUsername`) se do revize **zapíše** — pro černou skříňku je to
cenná informace — ale undo na něj sáhnout nesmí a allowlist ho dál odmítá.
Potvrzení tisku má vlastní endpoint a vlastní pravidla.

### Klientská strana

`HistoryEntry` se scvrkne na `{ label, groupId }`. Buildery `buildMoveCommand`,
`buildEditCommand`, `buildMultiEditCommand`, `buildMoveOrResizeCommand`,
`buildCreateCommand`, `buildDeleteCommand` (`src/lib/undo/commands.ts`, 306 řádků)
**zanikají** — nemají co skládat. S nimi mizí i `EDIT_TRACKED_FIELDS`, `trackedHere`
a `BlockSnapshot`/`EditSnapshot`.

Mizí i celý modul `src/lib/undo/splitSiblingFields.ts` (336 řádků + 648 řádků
testů), který existuje výhradně proto, aby klient adresně dopočítal split
sourozence, které server změnil `updateMany`em. Revize je zachytí samy — jsou to
prostě další změněné řádky v regionu.

Tohle je největší jednotlivý přínos B2: **ubývá kód, ve kterém ta vada žila.**

### Undo pro rozdělení a přeplánování

Vypadne z toho zadarmo, protože obojí je pro revizi jen „N změněných řádků":

- **Rozdělení** — revize drží `before` kořene (celý řádek) a nové části jako
  `before: null`. Undo tedy kořen vrátí a části smaže. Přesně to, co má udělat.
- **Přeplánování** — revize drží původní pozice všech přeskládaných bloků. Undo
  je vrátí všechny naráz, v jedné transakci.

Klient jen po úspěšné odpovědi zaznamená `{ label, groupId }` do zásobníku. Žádná
nová serverová logika.

## 7. Vykreslení v historii bloku (etapa B1)

### Zdroj a rozdělení rolí

Panel historie (`BlockDetail.tsx`, endpoint `GET /api/blocks/[id]/audit`) dnes
čte `AuditLog`. Nově zobrazí **sloučenou časovou osu** `AuditLog` + `BlockRevision`,
seřazenou podle `createdAt`.

Aby řádky nebyly dvakrát, platí dělba: **z revize se vykreslují jen sloupce, které
`AUDITED_FIELDS` nepokrývá.** Vylučovací množina se tedy nevymýšlí — odvozuje se
z existujícího jediného zdroje pravdy (`src/lib/auditedFields.ts`).

### Formátování

Čistá funkce `formatRevisionLines(before, after): string[]` v
`src/lib/revisionFormat.ts` + vlastní testy. Sloupec bez popisku se **tiše
přeskočí** (interní příznaky jako `splitGroupId` v historii nemají co dělat).

| Co se změnilo | Řádek v historii |
| --- | --- |
| `machine` + čas | „Přesunuto z XL105 pá 8. 8. 14:00 na XL106 po 11. 8. 6:00" |
| jen čas | „Přesunuto na po 11. 8. 6:00" |
| `endTime` dopředu (+`printMinutes`) | „Prodlouženo do pá 8. 8. 18:00 (z 16:00)" |
| `endTime` dozadu | „Zkráceno do pá 8. 8. 15:00 (z 16:00)" |
| `locked` | „Zamčeno" / „Odemčeno" |
| `before: null` | „Blok vytvořen" |
| `after: null` | „Blok smazán" |

Sázka rizika je tu nízká: chybějící popisek znamená **chybějící řádek v historii**,
ne rozbité undo. Proto je tenhle seznam přijatelný tam, kde seznam sledovaných
polí přijatelný nebyl.

Datum a čas přes stávající pražské helpery (`formatPragueDateTime`,
`src/lib/dateUtils.ts`) — nikdy přes `getFullYear`/`getMonth`/`getDate`.

## 8. Úklid po 90 dnech

Skript `scripts/prune-revisions.ts`, pouštěný denním cronem vedle stávající zálohy
(`docs/OPS_ZALOHY.md`).

Maže po dávkách, ne jedním příkazem:

```sql
DELETE FROM BlockRevision WHERE createdAt < ? ORDER BY id LIMIT 1000
```

ve smyčce, dokud se něco maže. Jednorázový `deleteMany` nad desetitisíci řádky by
držel dlouhý zámek a mohl by zablokovat plánovače uprostřed práce.

Retenci drží konstanta `REVISION_RETENTION_DAYS = 90` na jednom místě. Skript
loguje počet smazaných řádků a výslednou velikost tabulky, aby růst nebyl
překvapením — stejný přístup jako u ostatních provozních skriptů.

## 9. Rizika

| Riziko | Závažnost | Ošetření |
| --- | --- | --- |
| **Zamykající čtení regionu rozšíří zámky** oproti dnešku — běžná PUT cesta dnes na začátku transakce nezamyká nic a spoléhá na gap zámky finální overlap pojistky | **vysoká** | region zúžit na to, co cesta opravdu může změnit; **povinné měření souběhu dvou plánovačů nad týmž strojem** před nasazením; dokumentovaný ústup — nezamykající čtení + spoléhat na dnešní optimistic lock, když se kontence projeví |
| Příliš úzký region → chybějící `before` | vysoká | vestavěná pojistka proti seznamu id z `assertNoOverlapForBlocks` (§ 5) — `throw` ve vývoji, `logger.error` + `partial: true` na produkci |
| Růst tabulky | střední | rozdílové ukládání, retence 90 dní, skript loguje velikost |
| `migrate dev` je v tomhle repu rozbité (shadow-replay padá na historické migraci `20260326204352`, P3006) | střední | migraci **napsat ručně** + `migrate deploy`; potvrzený postup z 20. 7. 2026 (`LoginLog`) |
| B2 rozsáhle mění `PlannerPage.tsx`, který nehlídá žádný test | vysoká | logiku držet v čistých funkcích v `src/lib/`; **mutační test u každé opravy** (odebrat kód, ověřit, že padne správný test); u B2 povinná multi-agent review před commitem |
| Zdvojené řádky v historii bloku | nízká | vylučovací množina odvozená z `AUDITED_FIELDS`, ne psaná ručně |

## 10. Testy

**Čisté funkce** (`node:test` + `tsx`, dnešní vzor):

- `revisionDiff.test.ts` — rozdíl dvou řádků: beze změny → prázdno; změna
  tří sloupců → tři sloupce; `before: null`; `after: null`; `updatedAt` vždy přítomen.
- `revisionFormat.test.ts` — každý řádek z tabulky v § 7 + sloupec bez popisku
  se přeskočí + přechod letního času.
- `revisionOps.test.ts` (B2) — sestavení `ops` z revize pro oba směry, včetně
  `remove` u `before: null` a zdroje `expectedUpdatedAt`.

**Serverové s transakcí** (vzor `undoApply.server.test.ts`):

- revize vznikne v téže transakci jako mutace; rollback mutace nezanechá revizi;
- chain push zachytí i odsunuté sousedy, které nebyly v původním `ids`;
- úzký region → `throw` ve vývojovém režimu;
- rozdělení: `before` kořene + `before: null` u nových částí;
- undo rozdělení vrátí kořen a smaže části (B2).

**Ruční ověření na dev databázi** (fixtura `scripts/seed-test-pripominky-dev.ts`,
vlastní 2.–4. 9. 2026): přetáhnout blok na jiný stroj → historie bloku ukáže
řádek s oběma stroji a časy; natáhnout blok → „Prodlouženo"; rozdělit → Ctrl+Z
(B2); Přeplánovat → Ctrl+Z (B2). Světlý i tmavý motiv.

## 11. Ověření před nasazením

1. `npm run build` zelený, `npm run lint` 0 chyb.
2. Celá suita zelená:
   `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
3. **Měření souběhu** — dva prohlížeče, dva různí uživatelé, tentýž stroj, přesuny
   proti sobě. Sledovat prodlevy a `Lock wait timeout`. Bez tohohle kroku se
   nenasazuje (riziko č. 1).
4. Migrace ručně napsaná, ověřená na dev databázi, teprve pak `migrate deploy`.
5. **Před zásahem na produkci `mysqldump` záloha** — bez výjimky.
6. Po týdnu provozu B1: zkontrolovat skutečnou velikost `BlockRevision` proti
   odhadu z § 4 a případně upravit retenci dřív, než se pustí B2.
