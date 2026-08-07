# Serverové revize bloků — etapa B atomického undo

> Navazuje na `2026-08-04-atomicke-undo-design.md` (etapa A, hotová a ověřená
> 7. 8. 2026). Etapa A tam byla popsaná jako mezikrok: endpoint provede celý krok
> historie v jedné transakci, ale snapshot pořád posílá klient. Tenhle spec ten
> snapshot přesouvá na server.
>
> **Revize 2 (7. 8. 2026)** — přepracováno po adversariální multi-agent recenzi
> (6 optik + skeptici, 38 nálezů, 30 přežilo vyvracení, po sloučení 14 věcných vad).
> Recenze vyvrátila nosný mechanismus revize 1 („region" = stroj + časové okno);
> co se změnilo a proč, je v § 12.

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

`AUDITED_FIELDS` (`src/lib/auditedFields.ts:15–28`) **neobsahuje `startTime`,
`endTime`, `machine` ani `printMinutes`**. Auditní řádky pro běžnou editaci se
staví výhradně z něj (`src/app/api/blocks/[id]/route.ts:443–454`), takže:

> **Jednoblokové přetažení bloku na jiný stroj a jiný den nezapíše do historie
> vůbec nic.**

Slovo *jednoblokové* je podstatné a v revizi 1 chybělo. Poziční změny se do
`AuditLog` zapisují na pěti dalších místech mimo ten filtr: chain push v PUT
(`[id]/route.ts:550–563`, `AUTO_SHIFT`), v batchi (`batch/route.ts:209`), v POST
(`blocks/route.ts:322, 377`), ve splitu (`split/route.ts:174–186`) a reflow
(`reflow.server.ts:151–177`, `AUTO_SHIFT` + `AUTO_REFLOW`), plus lasso přesun
(`src/lib/batchAuditRows.ts:39–51`). Díra je tedy užší, než revize 1 tvrdila —
ale je to zároveň ta nejčastější operace plánovače a **je to přesně ten případ,
který znemožnil hladkou rekonstrukci havárií plánu z 5. a 6. 8. 2026**
(paměť `incident_2026_08_05_auto_shift`).

Revize drží celý řádek před změnou i po ní, takže černá skříňka vzniká jako
vedlejší produkt, ne jako další projekt.

## 2. Rozhodnutí zadavatele

Rozhodl Vojta 7. 8. 2026:

| Otázka | Rozhodnutí |
| --- | --- |
| Rozsah | výměna motoru **+ undo pro rozdělení a přeplánování** (dnes undo nemají vůbec) |
| Retence | **90 dní**, revize slouží zároveň jako černá skříňka pro rekonstrukci havárií |
| Přístup k datům | **v panelu historie bloku** — ne pouze v databázi |
| Zápis revize | pomocník obalí transakci a rozdíl si spočítá sám |
| Členění | dvě etapy **B1** a **B2** s vlastním nasazením |

### Co zůstává mimo rozsah

- **Historie nepřežije reload.** Zásobník kroků zpět dál žije v paměti prohlížeče
  (`useUndoManager.ts`, `MAX_HISTORY = 30`). Revize by to technicky umožnily, ale
  otevírá to otázku „čí historii vidím a smím vracet" — vlastní rozhodnutí, vlastní etapa.
- **Undo pro drop rezervace z fronty** — vyžaduje rozhodnout, co s `Reservation`
  stavem a notifikací obchodníkovi (backlog, nezměněno od etapy A).
- **Samostatná stránka rekonstrukce** („co se dělo se strojem XL105 dne 5. 8.").
  Vojta zvažoval, odložil. Data pro ni ale po B1 existují (§ 4 to zajišťuje
  denormalizací `machine`).
- **Poznámky k bloku** (`BlockNote`) — jiná tabulka, revize se jich netýkají.
- **Změny, které vyvolá referenční integrita databáze.** `Block.recurrenceParentId`
  má `ON DELETE SET NULL` (`prisma/migrations/20260311000000_init_mysql/migration.sql:71`),
  takže smazání kořene opakované série vynuluje odkaz u potomků **přímo v MySQL**.
  Prisma o tom neví, pomocník to nemůže zachytit a undo to nevrátí. Je to jediná
  známá díra v úplnosti a je vědomá.
- **Jakákoliv změna chování chain pushe.**

## 3. Členění na B1 a B2

| | **B1 — Černá skříňka** | **B2 — Undo přepnuté na revize** |
| --- | --- | --- |
| Obsah | migrace + model, zapisovací pomocník, zapojení do všech mutačních cest, úklid po 90 dnech, vykreslení v historii bloku | endpoint bere `groupIds` místo `ops`, klientské buildery se zjednoduší, undo pro rozdělení a přeplánování |
| Riziko | nulové pro undo — přidává se jen zápis navíc | mění se běžící mechanismus |
| Přínos pro plánovače | historie bloku konečně ukáže jednoblokové přesuny a natažení | Ctrl+Z u rozdělení a u tlačítka Přeplánovat |
| Nasaditelné samostatně | ano | ano (staví nad B1) |

**Proč ten řez:** B2 startuje nad tabulkou, která už je několik týdnů plná ostrých
produkčních dat. Přepnutí undo se pak dá postavit proti reálným revizím, ne proti
fixturám. To je přímé poučení z etapy A, kde jedna oprava prošla testem jen proto,
že fixtura měla tvar, jaký produkce nikdy nevyrobí (`pos({...} as never)`).
Když se B2 zdrží nebo odloží, B1 stojí a funguje sám o sobě.

### Položky B1, které nejsou zřejmé z popisu

- **Přepsat `POST /api/blocks/[id]/complete` z polní na interaktivní transakci.**
  Dnes používá `prisma.$transaction([...])` s polem operací (`complete/route.ts:47`),
  která interaktivní `tx` klient neposkytuje — pomocníka na ni nejde napojit.
  Cíl: `{ timeout: 15000, maxWait: 5000 }` jako ostatní cesty.
- **Rozšířit `AuditLogEntry` a render v `BlockDetail.tsx`** o zdroj `revision`
  (§ 7 mění tvar odpovědi `GET /api/blocks/[id]/audit`).
- **Nová funkce `formatPragueDateTimeWithWeekday`** v `dateUtils.ts` (§ 7).
- **Sloupec `AuditLog.groupId`** — korelace auditu a revize (§ 7).

### Položky B2, které nejsou zřejmé z popisu

- **Sběr `groupId` z vícepožadavkových dávek na klientovi** — čtyři místa
  v `PlannerPage.tsx` a jedno v `BlockEdit.tsx` (§ 6, tabulka).
- **Obsluha `P2028`/`P2034`** (timeout/zablokování transakce) v PUT, batch, split
  a undo. Dnes ji mají jen obě reflow routes.

## 4. Datový model

```prisma
model BlockRevision {
  id        Int      @id @default(autoincrement())
  /** Jedna serverová transakce = jeden groupId napříč všemi dotčenými bloky. */
  groupId   String   @db.VarChar(32)
  /** Vyplněno, když tuhle revizi vyrobilo undo/redo jiné revize. Viz § 6. */
  undoOfGroupId String? @db.VarChar(32)
  /** ZÁMĚRNĚ BEZ cizího klíče — revize musí přežít smazání bloku (undo mazání). */
  blockId   Int
  /** Denormalizováno, aby řádek dával smysl i po smazání bloku. Viz níž. */
  machine     String  @db.VarChar(191)
  orderNumber String? @db.VarChar(191)
  action    String   @db.VarChar(32)
  /** Popis kroku pro toast i historii, např. „Přesun bloku". */
  label     String   @db.VarChar(191)
  userId    Int
  username  String   @db.VarChar(191)
  /** Stav před změnou. Chybí (`DbNull`) = blok tímto krokem vznikl. */
  before    Json?
  /** Stav po změně. Chybí (`DbNull`) = blok byl tímto krokem smazán. */
  after     Json?
  /** Degradační příznak: „before" se nepodařilo zachytit úplně. Viz § 5. */
  partial   Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([groupId])
  @@index([blockId, createdAt])
  @@index([machine, createdAt])
  @@index([createdAt])
}
```

Tvar záměrně kopíruje `AuditLog` (denormalizovaný `userId` + `username`, indexy
`[blockId, createdAt]` a `[createdAt]`) — stejný přístup, stejné dotazy, stejný
úklid. Hlavičková tabulka není potřeba: `groupId` seskupuje, `label` a autor se
opakují na každém řádku a při pár set řádcích denně to nic nestojí.

### Proč `machine` a `orderNumber` denormalizovaně

`AuditLog` má `orderNumber` (`prisma/schema.prisma:20`) přesně proto, aby řádek
dával smysl i po smazání bloku. U revize je to naléhavější: u běžného přesunu
v rámci stroje se `machine` nezmění, takže **v rozdílovém `before`/`after` vůbec
není**. Bez denormalizace by dotaz „co se dělo se strojem XL105 dne 5. 8." vyžadoval
join na `Block` — a u smazaných bloků, kde je revize nejcennější, by nevrátil nic.
Cena je ~30 B na řádek, tedy uvnitř odhadu níž.

### Bez cizího klíče — a je to dvojnásob správně

1. **Věcně:** undo mazání musí umět blok vzkřísit. FK s `onDelete: Cascade` by
   revizi smazal spolu s blokem; FK bez kaskády by naopak smazání bloku zablokoval.
2. **Technicky:** produkční `Block.id` je `INT UNSIGNED` (paměť
   `project_db_unsigned_fk_gotcha`), takže FK na něj z `INT` sloupce stejně selže
   na `errno 150`.

### Co přesně je v `before` / `after`

| Akce | `before` | `after` |
| --- | --- | --- |
| vznik bloku | chybí | **celý řádek** |
| smazání bloku | **celý řádek** | chybí |
| změna bloku | **jen sloupce, které se liší** | **jen sloupce, které se liší** |

Ukládat u změny celý 56sloupcový řádek by tabulku nafouklo zhruba desetkrát bez
jakéhokoliv užitku. Rozdíl počítá **server** z řádků, které sám přečetl, takže se
tím nevrací klientské vyjmenovávání polí zadními vrátky.

**Invariant:** `updatedAt` je v rozdílu vždy. Prisma ho mění při každém zápisu
(`@updatedAt`), takže tam padne přirozeně; závisí na něm kontrola souběhu (§ 6).

**Zápis prázdného stavu:** Prisma 5 nedovolí do `Json?` sloupce zapsat holé `null`
(`Type 'null' is not assignable to type 'NullableJsonNullValueInput | InputJsonValue'`,
ověřeno kompilací proti `strict: true`). Prázdný stav se zapisuje **vynecháním
klíče** nebo `Prisma.DbNull` — nikdy `null`. V repu pro to zatím není precedens,
takže to patří do code review nové migrace.

### Generátor `groupId`

Repo **nemá** `cuid` ani `@paralleldrive/cuid2` mezi závislostmi a `@default(cuid())`
by stejně nešlo použít — `createMany` by vyrobilo jiné id pro každý řádek, kdežto
`groupId` musí být pro celou dávku společný. Použije se
`randomBytes(16).toString("base64url")` (22 znaků, žádná nová závislost, existující
precedens `prisma/bootstrap-prod.ts:140`). `crypto.randomUUID()` má 36 znaků a do
sloupce by se nevešel.

### Odhad velikosti

Běžná změna se dotkne 3–5 sloupců, s chain pushem tři bloky → řádově 700 B na
akci včetně denormalizovaných sloupců. Při 300 akcích denně to je 210 kB/den, tedy
**pod 25 MB za 90 dní**. Vznik a smazání ukládají celý řádek (1,3 kB), ale je jich
zlomek. I s velkou rezervou zůstává tabulka v desítkách MB.

## 5. Zápis revize — jádro návrhu

### Uvažované varianty

**(a) Každá cesta si revizi zapíše sama.** Deset volání, deset příležitostí
zapomenout. Je to dnešní vada přesunutá o patro níž — zamítnuto.

**(b) Prisma zachytí každý zápis globálně** (middleware / `$extends` nad klientem).
Rozbije nejdůležitější vlastnost etapy A: *jedna akce uživatele = jeden krok zpět*.
Odsunutí pěti sousedů chain pushem je pět zápisů a **jedno** stisknutí Ctrl+Z.
Navíc rozšíření nezná `label` ani autora záměru — zamítnuto.

**(c) Region (stroj + časové okno) se načte před mutací a po ní se porovná.**
Návrh revize 1 tohoto specu. **Recenze ho vyvrátila třemi nezávislými důkazy**
(§ 12) — zamítnuto.

**(d) Pomocník podstrčí tělu obalený transakční klient. — ZVOLENO**

### Proč zrovna tohle

Klíčové zjištění, které variantu určilo: **v celém repu není jediný zápis do
`Block` mimo Prismu.** `grep '\$executeRaw'` přes `src/` i `scripts/` vrací nulu.
Každá změna bloku tedy prochází `tx.block.{create,update,updateMany,delete,deleteMany}`.

Když tělu podstrčíme klienta, jehož tyhle metody si před zápisem zachytí „před"
stav, **volající nemá jak zapomenout** — ne proto, že by si dal pozor, ale proto,
že jinudy zapsat nejde.

### Kontrakt

```typescript
// src/lib/revision.server.ts
export async function withRevision<T>(
  tx: PrismaTransactionClient,
  meta: {
    action: RevisionAction;
    label: string;                       // "Přesun bloku"
    user: { id: number; username: string };
    groupId?: string;                    // pro dávky přes N requestů (§ 6)
    undoOfGroupId?: string;              // vyplňuje undo endpoint (§ 6)
  },
  body: (rtx: RevisionTx) => Promise<T>,
): Promise<{ result: T; groupId: string }>;

/**
 * Obalený zápisový klient. Podmnožina `tx.block` — čtení, ostatní modely
 * a `$queryRaw` volající dál používá přímo na `tx`.
 */
export type RevisionTx = {
  block: {
    create(args): Promise<Block>;
    update(args): Promise<Block>;
    updateMany(args): Promise<{ count: number }>;
    delete(args): Promise<Block>;
    deleteMany(args): Promise<{ count: number }>;
  };
};

/** Jedna hodnota na mutační cestu — sjednoceno s dnešními `AuditLog.action`. */
export type RevisionAction =
  | "CREATE" | "UPDATE" | "DELETE" | "BATCH"
  | "SPLIT" | "REFLOW" | "UNDO"
  | "PRINT_COMPLETE" | "EXPEDITION";
```

Uvnitř mutace se mění **jediná věc**: `tx.block.update(...)` → `rtx.block.update(...)`.
Veškerá logika, validace, chain push i audit zůstávají beze změny.

### Průběh

1. **Zachycení „před" — líné a přesné.** Při každém volání `rtx.block.*` si
   pomocník nejdřív zjistí dotčená id a načte jejich **celé řádky**:
   - `update`/`delete` — id je v `where`;
   - `updateMany`/`deleteMany` — pomocník sám spustí `findMany({ where, select: { id: true } })`
     nad **týmž `where`**, takže dostane přesně tu množinu, kterou zápis zasáhne
     (tohle je místo, kde padá C1 — split sourozenci na jiném stroji projdou stejně
     jako všichni ostatní, protože se řídí `where`, ne geometrií);
   - `create` — nic k zachycení, id se označí jako **nově vzniklé**.

   Čtení běží `SELECT … FOR UPDATE` **jen nad těmi id**, nikdy nad rozsahem.
   Řádek, který už je zachycený z dřívějšího volání, se podruhé nenačítá.

2. **Zápis** — pomocník předá volání beze změny na `tx`.

3. **Po skončení těla** — pomocník načte aktuální řádky všech dotčených id
   a **porovná** je se zachycenými. Řádky beze změny zahodí. Ze zbytku poskládá
   řádky `BlockRevision` se společným `groupId`.

4. **Uložení** — jedno `createMany` v téže transakci jako mutace i audit. Když
   transakce spadne, nezůstane ani revize. Zároveň se `groupId` zapíše do
   `AuditLog.groupId` u řádků vzniklých v této transakci (§ 7).

### Proč to ruší celou třídu vad

Volající **nikde nevyjmenovává pole ani bloky**. Zachycení řídí `where` samotného
zápisu, takže množina „co se zachytí" a množina „co se zapíše" jsou z definice
totožné. Nejde je rozpojit zapomenutím.

### Zámky

Zamyká se **výhradně to, do čeho se zapisuje**, po jednotlivých id. To je stejná
množina, jakou transakce zamkne tak jako tak samotným zápisem — pomocník zámek jen
o pár mikrosekund předsune, aby se „před" obraz a zápis kryly. Žádné rozsahové
zamykání, žádné rozšíření oproti dnešku.

> **Poznámka k pravidlu z `CLAUDE.md`** („`SELECT … FOR UPDATE` musí být PRVNÍ
> dotaz v transakci"). To pravidlo míří na TOCTOU u optimistic locku: přečti verzi
> → zkontroluj → zapiš. Tady se žádná verze nekontroluje; jde o pořízení „před"
> obrazu bezprostředně před zápisem pod zámkem, který si transakce vzápětí drží.
> Jsou to různé případy a pomocník to první pravidlo neruší ani neobchází — cesty,
> které optimistic lock používají (undo), si své zamykající čtení dělají dál jako první.

### Pojistka proti neúplnosti

Obalený klient uzavírá zápisovou cestu, ale ne cestu kolem Prismy. Pojistka proto
zůstává, jen se opírá o něco jiného než v revizi 1:

- **Statická:** revize obsahuje **jen** `rtx`, ne `tx`. Použití `tx.block.update`
  uvnitř těla je proto viditelné už v code review; ESLint pravidlo na to je
  volitelné rozšíření, ne podmínka.
- **Běhová:** po kroku 3 pomocník ověří, že každé dotčené id má buď zachycený
  „před" obraz, nebo je označené jako nově vzniklé. Když ne — **vývoj a testy**
  `throw new Error(...)` (pomocník žije v `src/lib/`, ne v API route, takže
  povinnost „chyby v API routes → vždy `AppError`" tam nepůsobí; `AppErrorCode`
  navíc hodnotu `"INTERNAL"` nemá); **produkce** `logger.error` s `groupId` a id
  plus zápis revize s `before: DbNull` a `partial: true`.

  Řádky s `partial: true` **se ve fázi 3 nezahazují**, i když vyjde prázdný rozdíl —
  jinak by degradační větev tiše nezapsala nic (byla by to vada, protože „aktuální
  řádek" je stav *po* mutaci, tedy identický s `after`).
- **Známá a vědomá výjimka:** kaskáda `ON DELETE SET NULL` nad `recurrenceParentId`
  (§ 2). Prisma o ní neví, obalený klient ji nevidí, běhová pojistka ji nezachytí.

## 6. Jak revize pohání undo (etapa B2)

### Kontrakt endpointu

```typescript
// Dnes (etapa A):
POST /api/blocks/undo { label, direction, ops: UndoOp[] }
// Po B2:
POST /api/blocks/undo { groupIds: string[], direction: "undo" | "redo" }
```

**Množné číslo je nutné.** Několik uživatelských akcí posílá N samostatných
požadavků, tedy N transakcí, tedy N `groupId` — a Ctrl+Z je musí vrátit všechny
najednou:

| Akce | Kód | Kolik requestů |
| --- | --- | --- |
| „Uložit vše / Celou sérii" | `PlannerPage.tsx:1759, 1768–1772` | N × PUT v cyklu |
| Překlopení rezervace | `PlannerPage.tsx:1300–1321` | kotva + sourozenci |
| Lasso mazání | `PlannerPage.tsx:1637–1652` | N × DELETE paralelně |
| Skupinový paste | `PlannerPage.tsx:~2370–2381` | N × POST |
| Série z BlockEditu | `BlockEdit.tsx:355–374` | N × PUT |

Server `ops` posbírá ze **všech** `groupIds` a aplikuje je v **jedné** transakci,
v obráceném pořadí vzniku. Klientská `HistoryEntry` je `{ label, groupIds: string[] }`.

Alternativu „sloučit těch pět míst do jednoho dávkového endpointu" **zamítáme** —
je to větší zásah do zápisových cest než celá etapa B2 a `CLAUDE.md` drží počet
zápisových cest jako vědomou hodnotu.

### Sestavení operací

| Směr | `before` | `after` | Operace |
| --- | --- | --- | --- |
| undo | chybí | řádek | `remove` (blok vznikl → zrušit) |
| undo | řádek | cokoliv | `upsert` hodnotami z `before` |
| redo | cokoliv | chybí | `remove` |
| redo | cokoliv | řádek | `upsert` hodnotami z `after` |

Uložený stav se **před** sestavením `ops` prožene funkcí `blockToRestoreFields`
(`src/lib/undo/restoreFields.ts:53`), která nepovolené klíče **tiše zahodí**.
Bez toho by 100 % undo mazání skončilo chybou 400: `before` u smazání je celý
řádek, tedy obsahuje všech osm sloupců, které `UNDO_RESTORABLE_FIELDS` vědomě
vynechává (`id`, `createdAt`, `updatedAt`, `reservationId`, `recurrenceParentId`,
trojice `printCompleted*`), a `sanitizeUndoOps` na nepovolený klíč **hází**, nefiltruje
(`undoApply.server.ts:85`).

`updatedAt` se z uloženého stavu vytáhne **zvlášť** jako `expectedUpdatedAt` —
nikdy jako položka `fields`.

Když po filtru nezbude ani jedno pole, operace se **vynechá** — `tx.block.update({data:{}})`
by jinak jen posunul `updatedAt` a rozbil verze ostatním klientům.

**Jádro `applyUndoOps` se nemění.** Optimistic lock, zamykající čtení jako první
dotaz, idempotentní `remove`, vzkříšení s původním `id`, auditní řádek i finální
overlap pojistka zůstávají přesně jak jsou — mění se výhradně **zdroj** `ops`.

### Kontrola souběhu — a proč naivní řešení nefunguje

Revize 1 tvrdila, že `expectedUpdatedAt` se vezme z `after.updatedAt` a „politika
se nemění". **To je nepravda a redo by po B2 selhalo pokaždé.** Důvod: `updatedAt`
je mimo `UNDO_RESTORABLE_FIELDS` (`restoreFields.ts:9–11`), takže undo zapíše
zcela novou hodnotu, kterou neměnná revize nezná. Druhý průchod pak narazí na
`AppError("CONFLICT")` (`undoApply.server.ts:164–167`) a `useUndoManager`
CONFLICT vyhodnotí jako stale → krok zmizí z obou zásobníků
(`useUndoManager.ts:9–11, 51–53`). Dnes to drží pohromadě `refresh()`
v `commands.ts:31–35`, který § 6 ruší.

**Řešení: undo si zapíše vlastní revizi a redo je undo té revize.**

```
Akce A          → revize G   (before = B0, after = B1)     živý řádek = B1
Ctrl+Z nad G    → zapíše B0, vznikne revize G'
                  (undoOfGroupId = G, before = B1, after = B0)   živý řádek = B0
Ctrl+Shift+Z    → najde G' podle undoOfGroupId = G
                  a provede „undo G'", tedy zapíše B1
                  expectedUpdatedAt = G'.after.updatedAt ✔ sedí na živý řádek
```

Redo tedy není zvláštní režim, je to **undo revize, která undo vyrobilo**.
Verze vždycky pochází z posledního skutečného zápisu, takže sedí. Funguje i pro
mazání (`after` chybí → undo vzkřísí → `G'.after` je celý řádek → redo smaže znovu)
a klient si nemusí pamatovat žádné verze.

Sloupec `undoOfGroupId` (§ 4) je tím pádem nosný, ne kosmetický.

### Zápis a restaurování jsou dvě různé množiny

Revize zaznamenává **všechno**, co se v řádku změnilo. Co smí undo zapsat zpátky,
dál hlídá `UNDO_RESTORABLE_FIELDS`. Potvrzení tisku (`printCompletedAt`,
`printCompletedByUserId`, `printCompletedByUsername`) se do revize **zapíše** —
pro černou skříňku je to cenná informace — ale `blockToRestoreFields` ho z `ops`
odstraní. Potvrzení tisku má vlastní endpoint a vlastní pravidla.

### Strop 200 operací

`sanitizeUndoOps` odmítá dávky nad 200 operací (`undoApply.server.ts:51–52`).
Přeplánování celého stroje pracuje s oknem 365 dní (`reflow.server.ts:24`) a
prochází **všechny** driftnuté bloky bez `take` (`reflow.server.ts:262–272`) plus
jejich chain-push sousedy — dvě stě bloků tedy překročit může. Bez zásahu by
slíbené „undo pro Přeplánování" u velkých dávek vracelo 400.

Řešení vychází z toho, co `sanitizeUndoOps` o sobě sama říká: je to *„jediná brána
mezi **tělem requestu** a transakcí"* (`undoApply.server.ts:46–49`). Serverem
sestavené `ops` z vlastních revizí tělem requestu nejsou.

- **Allowlist polí platí dál i pro serverovou cestu** — `CLAUDE.md` to vyžaduje
  a `blockToRestoreFields` ho zajistí.
- **Strop 200 se vztahuje jen na `ops` z těla requestu.** Serverová cesta dostane
  vlastní, vyšší strop **1000** jako pojistku proti runaway dávce.
- **Timeout undo transakce se zvedá z 15 s na 30 s** (`undo/route.ts:42`), na
  paritu s reflow. Důvod: `assertNoOverlapForBlocks` dělá **jeden `FOR UPDATE`
  dotaz na blok** (`overlapCheck.ts:88–100`), takže 500 bloků = 500 dotazů.
- **Ověřit měřením** (§ 11) na hustém plánu nad 200 driftnutých bloků. Když se
  do 30 s nevejde, platí ústup: undo přeplánování omezit a v UI to říct
  srozumitelně, ne chybou 400.

### Klientská strana

`HistoryEntry` se scvrkne na `{ label, groupIds }`. Buildery `buildMoveCommand`,
`buildEditCommand`, `buildMultiEditCommand`, `buildMoveOrResizeCommand`,
`buildCreateCommand`, `buildDeleteCommand` (`src/lib/undo/commands.ts`, 306 řádků)
**zanikají**. S nimi mizí `EDIT_TRACKED_FIELDS`, `trackedHere` i
`BlockSnapshot`/`EditSnapshot`.

Mizí i modul `src/lib/undo/splitSiblingFields.ts` (336 řádků + 648 řádků testů),
který existuje výhradně proto, aby klient adresně dopočítal split sourozence.
**Ruší se ale až po zeleném testu** „editace sdíleného pole na hlavě splitu, jejíž
sourozenec leží na druhém stroji, vytvoří revizi i pro sourozence" (§ 10) — právě
tenhle případ vyvrátil návrh revize 1 a nesmí se smazat pojistka dřív, než je
prokázané, že ji něco nahradilo.

Revize s vyplněným `undoOfGroupId` se **na klientský zásobník nezaznamenává** —
`createUndoCore.record()` maže redo zásobník při každém zápisu
(`useUndoManager.ts:29`), takže plošné zaznamenávání by po prvním Ctrl+Z zabilo
Ctrl+Shift+Z.

### Undo pro rozdělení a přeplánování

Vypadne z toho zadarmo, protože obojí je pro revizi jen „N změněných řádků":

- **Rozdělení** — revize drží `before` kořene (celý řádek) a nové části s chybějícím
  `before`. Undo tedy kořen vrátí a části smaže.
- **Přeplánování** — revize drží původní pozice všech přeskládaných bloků. Undo
  je vrátí všechny naráz, v jedné transakci (s výhradou stropu výš).

### Kdo smí co vrátit

Role gate zůstává `requireRole(["ADMIN", "PLANOVAT"])` (`undo/route.ts:20`).
Endpoint **nekontroluje autorství ani stáří `groupId`** — kterýkoli z těch dvou
rolí může poslat `groupId` staré až 90 dní od kohokoli jiného; jedinou zábranou
je optimistic lock. **Je to vědomé rozhodnutí**, ne přehlédnutí: undo je nástroj
plánovače nad společným plánem, ne osobní historie. Dnešní faktické omezení
(zásobník v paměti, `MAX_HISTORY = 30`, ztrácí se reloadem) po B2 zeslábne, ale
politika se tím nemění — jen se poprvé vyslovuje nahlas.

## 7. Vykreslení v historii bloku (etapa B1)

### Problém, který revize 1 podcenila

Panel historie (`BlockDetail.tsx`, endpoint `GET /api/blocks/[id]/audit`) čte
`AuditLog`. Revize 1 navrhovala vyloučit z revizí sloupce, které pokrývá
`AUDITED_FIELDS`. **Nefunguje to:** `AUDITED_FIELDS` je seznam *názvů sloupců*,
kdežto kolidující zápisy jsou *per akce* — `AUTO_SHIFT`, `AUTO_REFLOW`, `CREATE`,
`DELETE` i lasso poziční řádky vznikají zcela mimo ten filtr (§ 1). Vyloučení po
sloupcích by je nezachytilo a historie by se zdvojila právě u přesunů, kvůli kterým
revize vznikají.

### Řešení: korelace přes `groupId`

Pomocník v kroku 4 (§ 5) zapíše `groupId` i do `AuditLog` řádků vzniklých v téže
transakci. Do `AuditLog` proto přibývá `groupId String? @db.VarChar(32)`
(nullable — historické řádky ho nemají) s indexem `@@index([groupId])`.

Panel pak sloučí obě tabulky a **potlačí revizní řádek, pro který ve stejné
`groupId` existuje auditní řádek téhož `blockId`**. Pravidlo je exaktní, ne
heuristické, a nevyžaduje udržovat žádný seznam.

Vedlejší přínos pro černou skříňku je značný: „co uživatel udělal" (`AuditLog`)
a „co se skutečně změnilo" (`BlockRevision`) jde poprvé spojit jedním dotazem.

### Čtení a limit

`GET /api/blocks/[id]/audit` má dnes natvrdo `take: 10` bez cursoru
(`audit/route.ts:22–26`). Po sloučení se `take: 10` použije **na každé straně**,
výsledek se seřadí a ořízne na 10 — u merge-sortu top-K je to matematicky správné.

Tvar odpovědi se mění: místo syrového `AuditLog[]` vrací diskriminovanou unii
s polem `source: "audit" | "revision"`. Typ `AuditLogEntry` (`InfoPanel.tsx`)
a render v `BlockDetail.tsx:582–600` se rozšíří o revizní větev.

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

Sázka rizika je tu nízká: chybějící popisek znamená **chybějící řádek v historii**,
ne rozbité undo. Proto je tenhle seznam přijatelný tam, kde seznam sledovaných
polí přijatelný nebyl.

**Formát data vyžaduje novou funkci.** Citovaný `formatPragueDateTime`
(`dateUtils.ts:217–219`) vypisuje „08.08.2026 14:00", ne „pá 8. 8. 14:00" —
jediné `weekday: "short"` v souboru běží pod locale `"en"` a slouží k výpočtu
`dayOfWeek`. Přibude tedy exportovaná `formatPragueDateTimeWithWeekday` postavená
na `Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric",
month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_TIME_ZONE })`.
Nikdy `getFullYear`/`getMonth`/`getDate`.

## 8. Úklid po 90 dnech

Skript `scripts/prune-revisions.ts`, pouštěný denním cronem vedle stávající zálohy
(`docs/OPS_ZALOHY.md`). Maže po dávkách, ne jedním příkazem:

```sql
DELETE FROM BlockRevision WHERE createdAt < ? ORDER BY id LIMIT 1000
```

ve smyčce, dokud se něco maže. Jednorázový `deleteMany` nad desetitisíci řádky by
držel dlouhý zámek a mohl by zablokovat plánovače uprostřed práce.

Retenci drží konstanta `REVISION_RETENTION_DAYS = 90` na jednom místě. Skript
loguje počet smazaných řádků a výslednou velikost tabulky.

## 9. Rizika

| Riziko | Závažnost | Ošetření |
| --- | --- | --- |
| **Zapomenuté `rtx`** — tělo použije `tx.block.update` a zápis se nezachytí | vysoká | revize `withRevision` tělu `tx` vůbec nepředá (jen `rtx`); běhová pojistka (§ 5) to při neúplnosti zachytí; volitelně ESLint pravidlo |
| Kaskáda `ON DELETE SET NULL` nad `recurrenceParentId` | střední | **vědomě neřešeno**, uvedeno v § 2 mimo rozsah |
| Strop 200 operací / délka undo transakce u velkých reflow dávek | střední | oddělený strop pro serverovou cestu, timeout 30 s, **povinné měření** nad 200 driftnutých bloků (§ 11) |
| Zdvojené řádky v historii bloku | střední | exaktní korelace přes `groupId` (§ 7), ne vyloučení po sloupcích |
| `P2028`/`P2034` (timeout, zablokování transakce) neošetřený mimo reflow | střední | doplnit obsluhu v PUT/batch/split/undo — dnes ji má jen reflow (`reflow/route.ts:96–102`) |
| Růst tabulky | střední | rozdílové ukládání, retence 90 dní, skript loguje velikost |
| `migrate dev` je v tomhle repu rozbité (shadow-replay padá na historické migraci `20260326204352`, P3006) | střední | migraci **napsat ručně** + `migrate deploy`; potvrzený postup z 20. 7. 2026 (`LoginLog`) |
| B2 rozsáhle mění `PlannerPage.tsx`, který nehlídá žádný test | vysoká | logiku držet v čistých funkcích v `src/lib/`; **mutační test u každé opravy**; u B2 povinná multi-agent review před commitem |
| Holé `null` do `Json?` sloupce se nezkompiluje | nízká | `Prisma.DbNull` nebo vynechání klíče (§ 4) |

## 10. Testy

**Čisté funkce** (`node:test` + `tsx`, dnešní vzor):

- `revisionDiff.test.ts` — rozdíl dvou řádků: beze změny → prázdno; změna tří
  sloupců → tři sloupce; chybějící `before`; chybějící `after`; `updatedAt` vždy přítomen.
- `revisionFormat.test.ts` — každý řádek z tabulky v § 7 + sloupec bez popisku se
  přeskočí + přechod letního času.
- `revisionOps.test.ts` (B2) — sestavení `ops` z revize pro oba směry; `remove`
  u chybějícího `before`; `blockToRestoreFields` odstraní `printCompleted*`
  a `updatedAt`; operace, ze které po filtru nezbude pole, se vynechá.
- `revisionRedo.test.ts` (B2) — řetěz `G → G' → redo`: `expectedUpdatedAt` sedí
  na živý řádek ve všech čtyřech kombinacích (změna, vznik, smazání, smíšená dávka).

**Serverové s transakcí** (vzor `undoApply.server.test.ts`):

- revize vznikne v téže transakci jako mutace; rollback mutace nezanechá revizi;
- chain push zachytí i odsunuté sousedy;
- **split sourozenec na DRUHÉM stroji dostane revizi** (případ, který vyvrátil
  revizi 1 — bez zeleného testu se `splitSiblingFields.ts` nesmí smazat);
- `updateMany` nad celou split skupinou zachytí všechny členy;
- neúplné zachycení → `throw` ve vývojovém režimu, `partial: true` v produkčním;
- rozdělení: `before` kořene + chybějící `before` u nových částí;
- undo rozdělení vrátí kořen a smaže části (B2);
- undo přeplánování nad 200 bloky proběhne (B2).

**Ruční ověření na dev databázi** (fixtura `scripts/seed-test-pripominky-dev.ts`,
vlastní 2.–4. 9. 2026): přetáhnout blok na jiný stroj → historie ukáže řádek
s oběma stroji a časy, **a jen jednou**; natáhnout blok → „Prodlouženo"; rozdělit
→ Ctrl+Z (B2); Přeplánovat → Ctrl+Z (B2); Ctrl+Z a hned Ctrl+Shift+Z → obojí projde.
Světlý i tmavý motiv.

## 11. Ověření před nasazením

1. `npm run build` zelený, `npm run lint` 0 chyb.
2. Celá suita zelená:
   `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
3. **Měření souběhu** — dva prohlížeče, dva různí uživatelé, tentýž stroj: jeden
   spustí „Přepočítat celý stroj" (transakce 30 s), druhý ve stejnou chvíli
   přetahuje blok na témže stroji a zakládá nový. Sledovat prodlevy a `Lock wait
   timeout` (`innodb_lock_wait_timeout` = 50 s). Kontrolní otázka: chová se to
   stejně jako dnes? Pomocník nemá zámky rozšířit.
4. **Měření velké undo dávky** — přeplánování nad 200 driftnutých bloků, pak Ctrl+Z.
   Vejde se do 30 s?
5. Migrace ručně napsaná, ověřená na dev databázi, teprve pak `migrate deploy`.
   Pozor na dva `ALTER TABLE` — `BlockRevision` (nová) a `AuditLog.groupId`
   (přidání nullable sloupce, na MySQL 8 algoritmem `INSTANT`).
6. **Před zásahem na produkci `mysqldump` záloha** — bez výjimky.
7. Po týdnu provozu B1: zkontrolovat skutečnou velikost `BlockRevision` proti
   odhadu z § 4 a případně upravit retenci dřív, než se pustí B2.

## 12. Co změnila recenze

Revize 1 tohoto specu prošla adversariální multi-agent recenzí (6 nezávislých
optik, ke každé skeptik pověřený nálezy vyvrátit). Z 38 nálezů 30 vyvracení
přežilo; po sloučení 14 věcných vad, z toho 4 kritické.

**Vyvrácen byl nosný mechanismus.** Revize 1 stavěla na „regionu" — stroji
a časovém okně, které se před mutací načtou a po ní porovnají. Padlo to na třech
nezávislých důkazech:

1. **Split sourozenci region opouštějí.** `updateMany` je hledá výhradně podle
   `splitGroupId`, bez filtru na stroj i čas (`[id]/route.ts:509–512`) a sourozenec
   může ležet na druhém stroji. Vestavěná pojistka se opírala o seznam předávaný
   `assertNoOverlapForBlocks`, kde sourozenci nikdy nejsou (`:566`) — a u čistě
   obchodní editace se ta pojistka nevolá vůbec (`:538–540`). Bylo by to
   znovuotevření kritického nálezu go/no-go auditu z 5. 8. 2026.
2. **Region není před tělem transakce znám.** U PUT vzniká `computedEnd` až
   uvnitř transakce z `validateAndComputeEnd(tx, …)` (`:231, 235`); u celostrojového
   reflow běží `detectCalendarDrift` rovněž uvnitř a dolní kotva sahá až rok zpět
   (`reflow.server.ts:239–249`).
3. **„Nadsadit region je zdarma" neplatilo.** Pod `FOR UPDATE` stojí zámek každý
   naskenovaný řádek, a predikát okna `endTime > from` rozsah v indexu
   `[machine, startTime, endTime]` zdola neomezuje — sken tedy zamyká i řádky
   hluboko pod nominální dolní mezí. Recenze to ověřila `EXPLAIN`em i živým testem
   dvou souběžných transakcí (`Lock wait timeout` po 3 s).

**Nahrazeno obaleným transakčním klientem** (§ 5, varianta d). Rozhodující
zjištění, které tuhle variantu umožnilo: v celém repu není jediný zápis do `Block`
mimo Prismu (`$executeRaw` = 0 výskytů). Nový mechanismus ruší všechny tři důvody
najednou — zachycení se řídí `where` samotného zápisu, takže žádnou geometrii
neodhaduje, nic nemusí vědět předem a zamyká jen to, do čeho se stejně zapisuje.

**Další vady, které recenze našla a spec je teď řeší:** redo by po B2 selhalo
deterministicky (§ 6, „Kontrola souběhu"); jedna uživatelská akce znamená až N
požadavků, takže `groupId` musí být množné (§ 6); `ops` sestavené z revize by
u každého undo mazání skončily chybou 400 (§ 6, `blockToRestoreFields`); strop
200 operací by zabil undo přeplánování (§ 6); vyloučení po sloupcích by historii
zdvojilo (§ 7, korelace přes `groupId`); `partial: true` neměl v modelu sloupec
a degradační větev by nezapsala nic (§ 4, § 5); `BlockRevision` bez `machine`
by neunesl slíbenou rekonstrukci (§ 4); `complete` route má transakci v poli
a pomocníka na ni nejde napojit (§ 3); `AppError("INTERNAL")` neexistuje (§ 5);
holé `null` do `Json?` se nezkompiluje (§ 4); pro `cuid` není v repu generátor
(§ 4); citovaný formátovač data vypisuje jiný tvar, než spec sliboval (§ 7);
`take: 10` v historii by po sloučení dvou zdrojů dával nesmysl (§ 7).
