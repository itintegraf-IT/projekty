# Serverové revize bloků — etapa B1 (černá skříňka)

> Navazuje na `2026-08-04-atomicke-undo-design.md` (etapa A, hotová a ověřená
> 7. 8. 2026). Etapa A byla popsaná jako mezikrok: endpoint provede celý krok
> historie v jedné transakci, ale snapshot pořád posílá klient.
>
> **Revize 3 (7. 8. 2026).** Dvě kola adversariální multi-agent recenze.
> První kolo vyvrátilo nosný mechanismus revize 1 („region"), druhé kolo ověřilo
> náhradu jako správnou a našlo 27 vad v tom, co jsem kolem ní napsal. Čtrnáct
> z nich bylo v sekci popisující etapu B2 — **ta je z tohohle specu vyříznutá**
> a dostane vlastní spec, až tabulka pojede. Co se měnilo a proč, je v § 11.

## 1. Problém

Endpoint `POST /api/blocks/undo` **zapisuje doslova a nic nederivuje**. To je
záměr — undo vrací stav, který v databázi prokazatelně existoval, takže měřit ho
dnešní mřížkovou validací je kategorická chyba (viz výjimka v `CLAUDE.md`).

Důsledek té vlastnosti je, že **každé pole, které server jinak dopočítá, musí být
ve snapshotu**. Snapshot skládá klient. A klient si musí pamatovat, co všechno
server dopočítává.

Během etapy A se ta vada projevila **třikrát nezávisle**:

| # | Kde | Co chybělo | Jak se to projevilo |
| --- | --- | --- | --- |
| 1 | změna délky tažením | `printMinutes` | blok se po Ctrl+Z vrátil na starou délku, ale s novým počtem tiskových minut |
| 2 | přesun bloku | `scheduleBypassed` | příznak zůstal nesedět s geometrií, kterou undo vrátilo |
| 3 | „Uložit vše → Celou sérii" | `printMinutes` + `scheduleBypassed` | undo proběhlo správně, ale rozpor `span ≠ printMinutes` spustil výkřičník „přeplánovat" a reflow blok zase natáhl — navenek to vypadalo, že undo nefunguje |

Kořen je strukturální: **tři cesty si vedou tři vlastní seznamy sledovaných polí**.
Dokud je udržuje klient ručně, čtvrtý výskyt je otázka času.

Zhoršující okolnost: **`PlannerPage.tsx` nehlídá žádný test.** Repo nemá
RTL/jsdom/vitest. Mutační testování to během etapy A opakovaně prokázalo — šlo
odebrat celou opravu a 600+ testů zůstalo zelených.

### Druhý problém, který se řeší týmž tahem

`AUDITED_FIELDS` (`src/lib/auditedFields.ts:15–28`) **neobsahuje `startTime`,
`endTime`, `machine`, `printMinutes`, `locked`, `description` ani `specifikace`**.
Auditní řádky běžné editace se staví výhradně z něj
(`src/app/api/blocks/[id]/route.ts:443–454`), takže:

> **Jednoblokové přetažení bloku na jiný stroj a jiný den nezapíše do historie
> vůbec nic.**

Slovo *jednoblokové* je podstatné. Poziční změny se do `AuditLog` zapisují na
šesti dalších místech mimo ten filtr: chain push v PUT (`[id]/route.ts:551`),
v batchi (`batch/route.ts:203`), v POST (`blocks/route.ts:322, 377`), ve splitu
(`split/route.ts:174`), reflow (`reflow.server.ts:152, 166`) a lasso přesun
(`src/lib/batchAuditRows.ts:39–51`). Díra je tedy užší, než tvrdily starší verze
tohohle specu — ale týká se nejčastější operace plánovače a **znemožnila hladkou
rekonstrukci havárií plánu z 5. a 6. 8. 2026** (paměť `incident_2026_08_05_auto_shift`).

Revize drží celý řádek před změnou i po ní, takže černá skříňka vzniká jako
vedlejší produkt.

## 2. Rozhodnutí zadavatele

Rozhodl Vojta 7. 8. 2026:

| Otázka | Rozhodnutí |
| --- | --- |
| Rozsah | výměna motoru + undo pro rozdělení a přeplánování (obojí je **B2**) |
| Retence | **90 dní**, revize slouží zároveň jako černá skříňka |
| Přístup k datům | **v panelu historie bloku** |
| Zápis revize | pomocník obalí transakci a rozdíl si spočítá sám |
| Členění | **B1** (tenhle spec) a **B2** (vlastní spec, až tabulka pojede) |

### Co zůstává mimo rozsah

- **Celá mechanika undo/redo nad revizemi** — etapa B2, vlastní spec. Sem patří
  tvar požadavku endpointu, řetězení kroků, slučování dávek přes víc transakcí,
  chování při promazané revizi. Druhé kolo recenze v té oblasti našlo 14 vad
  a všechny mají společnou příčinu: navrhovat mechaniku undo nad tabulkou, která
  ještě neexistuje a jejíž skutečná data nikdo neviděl.
- **Historie nepřežije reload.** Zásobník kroků zpět dál žije v paměti prohlížeče.
- **Undo pro drop rezervace z fronty** — backlog, nezměněno od etapy A.
- **Samostatná stránka rekonstrukce.** Data pro ni ale po B1 existují (§ 3
  to zajišťuje denormalizací `machine`).
- **Poznámky k bloku** (`BlockNote`) — jiná tabulka.
- **Změny, které nejdou přes runtime Prismu.** Dvě známé a vědomé:
  1. `Block.recurrenceParentId` má `ON DELETE SET NULL`
     (`prisma/migrations/20260311000000_init_mysql/migration.sql:71`), takže smazání
     kořene série vynuluje odkaz u potomků přímo v MySQL;
  2. DML uvnitř migrací (precedens: `20260702093854_add_print_minutes_and_bypass/migration.sql:6`
     dělá `UPDATE Block SET printMinutes = …`).

  Ani jedno pomocník nezachytí. Černá skříňka o těchhle zásazích nikdy nebude vědět.

## 3. Rozsah B1

1. Migrace + model `BlockRevision`; sloupec `AuditLog.groupId` + složený index.
2. Pomocník `withRevision` (§ 4) — **otevírá transakci sám**.
3. Zapojení do všech mutačních cest, které mění `Block`.
4. **Přepis `POST /api/blocks/[id]/complete`** z polní na interaktivní transakci —
   dnes `prisma.$transaction([...])` s polem operací (`complete/route.ts:47`),
   na kterou pomocníka napojit nejde.
5. Normalizátor raw řádku (§ 4, „Zachycení") + jeho testy.
6. Panel historie: nový typ `BlockHistoryEntry`, mapa pokrytí sloupců, render (§ 6).
7. Nová funkce `formatPragueDateTimeWithWeekday` v `dateUtils.ts` (§ 6).
8. Úklid po 90 dnech (§ 7).

**Co se NEmění:** typ `AuditLogEntry`. Existují jeho **dvě nezávislé definice** —
`src/components/InfoPanel.tsx:5–16` (konzumuje `/api/audit/today` přes
`useNotifications.ts` a `NotificationsPanel.tsx`) a
`src/components/admin/AuditLogPanel.tsx:31` (konzumuje `/api/audit`). Ani jedna
s revizemi nesouvisí a sáhnutí na ně by tiše vyprázdnilo panel notifikací.

## 4. Zápis revize — jádro návrhu

### Uvažované varianty

**(a) Každá cesta si revizi zapíše sama.** Deset volání, deset příležitostí
zapomenout — dnešní vada přesunutá o patro níž. Zamítnuto.

**(b) Prisma zachytí každý zápis globálně.** Rozbije vlastnost *jedna akce
uživatele = jeden krok zpět*: odsunutí pěti sousedů je pět zápisů a jedno Ctrl+Z.
Zamítnuto.

**(c) Region (stroj + časové okno).** Návrh revize 1. Vyvrácen (§ 11). Zamítnuto.

**(d) Pomocník otevře transakci a předá tělu jediný klient s nahrazenými
delegáty. — ZVOLENO**

### Proč to jde

Dvě zjištění z recenze, obě ověřená proti kódu:

1. **V repu není zápis do `Block` mimo Prismu.** `$executeRaw`/`$executeRawUnsafe`
   = 0 výskytů; všech 7 výskytů `$queryRaw` jsou `SELECT`y.
2. **Nejsou ani vnořené zápisy** přes jiný model. Jediný výskyt `blocks: {`
   v mutačním kontextu je čtení (`reservations/[id]/route.ts:36`, `include`).

Typová stránka je ověřená kompilací sondy proti generovanému klientovi
(Prisma 5.22, `strict: true`): obal jde napsat **bez `any` a bez ztráty typové
kontroly** —
`update<T extends Prisma.BlockUpdateArgs>(args: Prisma.SelectSubset<T, Prisma.BlockUpdateArgs>): Promise<Prisma.BlockGetPayload<T>>`
prošel na všech reálných voláních v repu.

### Kontrakt

```typescript
// src/lib/revision.server.ts
export async function withRevision<T>(
  meta: {
    action: RevisionAction;
    label: string;                    // "Přesun bloku"
    user: { id: number; username: string };
    txOptions?: { timeout?: number; maxWait?: number };
  },
  body: (rtx: RevisionClient) => Promise<T>,
): Promise<{ result: T; groupId: string }>;

/**
 * PLNÝ transakční klient s nahrazenými delegáty `block` a `auditLog`.
 * Strukturálně zaměnitelný za `PrismaTransactionClient`, takže se dá bez úprav
 * předat do `resolveChainPushFromDb`, `reflowBlockInTx`, `reflowMachineInTx`,
 * `assertNoOverlapForBlocks`, `loadMachineCalendarRange` i `applyUndoOps`.
 */
export type RevisionClient = PrismaTransactionClient;

export type RevisionAction =
  | "CREATE" | "UPDATE" | "DELETE" | "BATCH"
  | "SPLIT" | "REFLOW" | "UNDO"
  | "PRINT_COMPLETE" | "EXPEDITION";
```

**Pomocník otevírá transakci sám.** To je proti revizi 2 zásadní změna a řeší
tři věci najednou:

- **`AuditLog.groupId` má kdo naplnit.** `groupId` vzniká *před* spuštěním těla
  a nahrazený `auditLog` delegát ho vstřikuje do každého zapsaného řádku. V revizi 2
  to nešlo — pomocník obaloval jen `block`, kdežto všechny auditní zápisy jdou
  přes `tx.auditLog` (13 míst v repu), takže korelace z § 6 stála na mechanismu,
  který v návrhu neexistoval.
- **Signatury sdílených funkcí se nemění.** Kdyby pomocník předával druhý klient
  vedle `tx`, musely by `resolveChainPushFromDb`, `reflowBlockInTx`,
  `reflowMachineInTx` a `applyUndoOps` přijímat dva klienty — a s nimi by se
  přepisovaly jejich transakční mocky (`reflow.server.test.ts:48–74`,
  `undoApply.server.test.ts:147`, `overlapCheck.test.ts:77–145`).
- **„Jinudy zapsat nejde" je strukturální, ne deklarované.** Syrový `tx` se do
  uzávěru těla vůbec nedostane. V revizi 2 byl `tx` prvním parametrem
  `withRevision`, takže v uzávěru lexikálně zůstával a `tx.block.update(...)` by se
  bez chyby přeložil.

Uvnitř mutace se **nemění nic** — tělo je dnešní kód, jen dostane `rtx` místo `tx`.

### Zachycení „před" obrazu

Při každém volání `rtx.block.*` pomocník zjistí dotčená id a načte jejich celé
řádky. Množina se řídí `where` samotného zápisu:

- `update`/`delete` — id je ve `where`;
- `updateMany`/`deleteMany` — pomocník spustí `findMany({ where, select: { id: true } })`
  nad **týmž `where`**. Tohle je místo, kde padá nález o split sourozencích:
  `updateMany({ where: { splitGroupId, id: { not: id } } })` (`[id]/route.ts:509`)
  zachytí sourozence **bez ohledu na stroj i čas**, protože se řídí `where`, ne geometrií;
- `create`/`createMany` — nic k zachycení, řádek dostane `kind: "CREATE"`.

Řádek už jednou zachycený se podruhé nenačítá.

**Čtení je jedno raw `SELECT <sloupce> … FOR UPDATE` s explicitní normalizací.**
Ne dvojice „zamykající raw SELECT + typovaný `findMany`", jakou dnes používá
`undoApply.server.ts:141–155`. Důvod je věcný, ne výkonový: pod MySQL REPEATABLE
READ vidí nezamykající `findMany` data z **read view** transakce, které se
zakládá při prvním konzistentním čtení. Zachycení uprostřed transakce (v PUT je
první dotaz `findUnique` na `:153`, první zápis až `:340`) by tedy zamklo aktuální
verzi, ale přečetlo starou.

Následek by nebyl teoretický: při 30sekundovém přepočtu stroje, do kterého jiný
plánovač commitne editaci, by revize dostala `before` bez cizí změny a `after`
s ní — tedy **připsala by cizí změnu přepočtu**. Po B2 by ji Ctrl+Z tiše přepsal.

Cenou je ruční normalizace, kterou repo už zná: raw `SELECT` vrací MySQL
`BOOLEAN` sloupce jako 0/1 (`Block` jich má deset: `locked`, `dataOk`, `materialOk`,
`obalka`, `vnitrky`, `materialInStock`, `materialIssued`, `pantoneRequired`,
`pantoneOk`, `scheduleBypassed`) a `DATETIME` jako řetězce. Normalizátor je čistá
funkce s vlastním testem (§ 9).

### Výpočet rozdílu

Po skončení těla pomocník načte aktuální řádky dotčených id a porovná je se
zachycenými.

**Rozdíl se počítá BEZ `updatedAt`.** Prisma ho mění při každém zápisu
(`@updatedAt`), takže kdyby byl součástí rozdílu, „řádky beze změny zahodíme"
by nikdy nenastalo. Split propagace přitom běží při **každém** uložení
z BlockEditu, i když jsou hodnoty sourozenců totožné (`[id]/route.ts:492`) —
každý sourozenec by tak dostal revizi s jediným změněným sloupcem `updatedAt`,
který se v historii „tiše přeskočí", tedy prázdný řádek v panelu při každém uložení.

Auditní vrstva tenhle šum vědomě filtruje už dnes (`splitPropagateAudit.ts:81`,
`if (oldValue === newValue) continue;`). Revizní vrstva musí taky.

`updatedAt` se ukládá zvlášť do sloupce `rowVersion` — B2 z něj bude brát verzi
pro kontrolu souběhu.

**Prázdný rozdíl → žádná revize.** Jediná výjimka jsou řádky `partial: true`.

### Zápis

Jedno `createMany` v téže transakci jako mutace i audit. Když transakce spadne,
nezůstane ani revize.

### Pojistka proti neúplnosti

Revize 2 tu měla **tautologickou kontrolu**: ověřovala, že každé dotčené id má
zachycený „před" obraz — jenže množinu dotčených id sestavuje pomocník sám ze
svých volání, takže porovnávala množinu se sebou a nemohla selhat. § 9 ji přitom
uváděla jako ošetření vysokého rizika.

Skutečné pojistky jsou dvě, obě opřené o nezávislý zdroj:

- **`count` u hromadných zápisů.** `updateMany`/`deleteMany` vrací počet
  zasažených řádků; když nesedí s velikostí zachycené množiny, mezi snapshotem
  a zápisem se objevil fantom. Vývoj `throw`, produkce `logger.error` + `partial: true`.
- **Strukturální uzavření zápisové cesty** — syrový `tx` v uzávěru těla není
  (viz kontrakt výš). Tohle je hlavní obrana; běhová kontrola je doplněk.

Zbytkové riziko: **nová mutační cesta, která `withRevision` nepoužije vůbec.**
To pomocník zachytit nemůže — hlídá to code review a `CLAUDE.md`.

Řádky `partial: true` jsou **výhradně pro forenziku**. B2 z nich nesmí sestavit
žádnou operaci undo; patří to do jeho specu jako vstupní podmínka.

## 5. Datový model

```prisma
model BlockRevision {
  id        Int      @id @default(autoincrement())
  /** Jedna serverová transakce = jeden groupId napříč všemi dotčenými bloky. */
  groupId   String   @db.VarChar(32)
  /** ZÁMĚRNĚ BEZ cizího klíče — revize musí přežít smazání bloku. */
  blockId   Int
  /** Denormalizováno, aby řádek dával smysl i po smazání bloku. */
  machine     String  @db.VarChar(191)
  orderNumber String? @db.VarChar(191)
  /** Operace uživatele (UPDATE, SPLIT, REFLOW, …). */
  action    String   @db.VarChar(32)
  /** Typ změny TOHOTO řádku. NIKDY se neodvozuje z přítomnosti before/after. */
  kind      String   @db.VarChar(8)   // "CREATE" | "UPDATE" | "DELETE"
  label     String   @db.VarChar(191)
  userId    Int
  username  String   @db.VarChar(191)
  /** Stav před změnou. U kind=CREATE chybí. Bez `updatedAt`. */
  before    Json?
  /** Stav po změně. U kind=DELETE chybí. Bez `updatedAt`. */
  after     Json?
  /** Hodnota `Block.updatedAt` po zápisu — verze pro kontrolu souběhu v B2. */
  rowVersion DateTime?
  /** Forenzní příznak: zachycení „před" nebylo úplné. NIKDY nesmí vyrobit undo operaci. */
  partial   Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([groupId])
  @@index([blockId, createdAt])
  @@index([machine, createdAt])
  @@index([createdAt])
}
```

### Proč `kind` a ne odvození z `before`/`after`

Revize 2 rozeznávala vznik bloku podle chybějícího `before`. Jenže degradační
větev zapisuje `partial: true` **taky** s chybějícím `before` — obojí je tedy
k nerozeznání. B2 by z takového řádku sestavil operaci `remove` a **smazal
existující, dávno naplánovaný blok**. Záchranná brzda by se změnila v nástroj
ztráty dat.

`kind` je explicitní a tenhle omyl vylučuje konstrukčně.

### Bez cizího klíče — dvojnásob správně

1. **Věcně:** undo mazání musí umět blok vzkřísit. FK s kaskádou by revizi smazal
   spolu s blokem; FK bez kaskády by smazání bloku zablokoval.
2. **Technicky:** produkční `Block.id` je `INT UNSIGNED` (paměť
   `project_db_unsigned_fk_gotcha`), takže FK z `INT` sloupce selže na `errno 150`.

### Co je v `before` / `after`

| `kind` | `before` | `after` |
| --- | --- | --- |
| `CREATE` | chybí | **celý řádek** |
| `DELETE` | **celý řádek** | chybí |
| `UPDATE` | **jen sloupce, které se liší** | **jen sloupce, které se liší** |

Prisma 5 nedovolí do `Json?` zapsat holé `null`
(`Type 'null' is not assignable to type 'NullableJsonNullValueInput | InputJsonValue'`,
ověřeno kompilací). Prázdný stav se zapisuje **vynecháním klíče** nebo
`Prisma.DbNull`. V repu pro to není precedens — patří do review migrace.

### Generátor `groupId`

Repo nemá `cuid` ani `@paralleldrive/cuid2` a `@default(cuid())` by stejně nešlo:
`createMany` by vyrobilo jiné id pro každý řádek, kdežto `groupId` musí být pro
dávku společný. Použije se `randomBytes(16).toString("base64url")` (22 znaků,
precedens `prisma/bootstrap-prod.ts:140`). `crypto.randomUUID()` má 36 znaků
a do sloupce se nevejde.

### `AuditLog`

```prisma
groupId String? @db.VarChar(32)   // nullable — historické řádky ho nemají
@@index([groupId, blockId])       // složený, viz § 6
```

### Odhad velikosti

Běžná změna se dotkne 3–5 sloupců, s chain pushem tři bloky → řádově 700 B na
akci včetně denormalizovaných sloupců. Při 300 akcích denně 210 kB/den, tedy
**pod 25 MB za 90 dní**. Vznik a smazání ukládají celý řádek (1,3 kB), ale je
jich zlomek.

## 6. Historie bloku

### Korelace a její granularita

Pomocník zapíše `groupId` do `AuditLog` řádků téže transakce (nahrazený delegát,
§ 4). Panel pak sloučí obě tabulky.

**Potlačuje se po SLOUPCÍCH, ne po řádcích.** Revize 2 měla pravidlo „potlač
revizní řádek, pro který ve stejné `groupId` existuje auditní řádek téhož
`blockId`" a označovala ho za exaktní. Není:

`BlockEdit.buildPayload()` (`BlockEdit.tsx:603–641`) posílá v **jednom** PUT
zároveň `deadlineExpedice`, `locked`, `description`, `specifikace`, všechny
DATA/MATERIÁL/PANTONE chipy **i `printMinutes`** — délka i zámek jsou v témž
formuláři. Server z `printMinutes` dopočítá nový `endTime` (`[id]/route.ts:346–348`).
Vznikne tedy auditní řádek pro `deadlineExpedice` **a** revizní řádek pro
`endTime`/`printMinutes` se stejným `groupId` i `blockId`.

Potlačení po řádcích by revizi zahodilo celou → plánovač by v historii viděl jen
změnu termínu a o prodloužení bloku o čtyři hodiny **ani řádku**. Doslova ten
problém z § 1, jen posunutý na kombinovanou editaci, která je v BlockEditu běžná.

Správné pravidlo: **z revizního rozdílu odečíst klíče, které v téže `groupId`
a `blockId` pokrývá auditní řádek.** Zbude-li prázdno, revizní řádek zahodit.

### Mapa pokrytí

`AuditLog.field` nese buď název sloupce, nebo složenou hodnotu. Mapa
„akce/field → pokryté sloupce" žije **vedle `AUDITED_FIELDS`** jako jediný zdroj
pravdy a má vlastní test:

| `AuditLog` | Pokrývá sloupce |
| --- | --- |
| `field` = název sloupce (`UPDATE`, `SPLIT_PROPAGATE`) | ten sloupec |
| `field` = `"startTime/endTime"` (`AUTO_SHIFT`, lasso) | `startTime`, `endTime` |
| `field` = `"machine"` (lasso) | `machine` |
| `field` = `"startTime/endTime/machine"` | všechny tři |
| `action` = `CREATE` / `DELETE` | celý řádek |
| `action` = `EXPEDITION_*` | `expeditionPublishedAt`, `expeditionSortOrder` |
| `action` = `PRINT_*` | trojice `printCompleted*` |
| `action` = `AUTO_REFLOW` | `startTime`, `endTime`, `printMinutes` |

### Predikát se vyhodnocuje v databázi

`GET /api/blocks/[id]/audit` má dnes natvrdo `take: 10` bez cursoru
(`audit/route.ts:22–26`). Merge top-K s `take: 10` na každé straně je **správný
pro pořadí** — potlačená revize má v téže `groupId` auditní řádek s prakticky
totožným `createdAt`.

Ale **predikát potlačení se z načtené desítky vyhodnotit nedá.** Jedno uložení
z BlockEditu běžně vyrobí přes deset auditních řádků jedním `createMany`
(`AUDITED_FIELDS` má 24 položek), takže starší skupina se do okna nevejde
a její revize by se zobrazila, přestože potlačena být má — výsledek by závisel
na tom, kolik řádků má nejnovější editace.

Řešení: k načteným revizím jeden dotaz
`SELECT groupId, field, action FROM AuditLog WHERE blockId = ? AND groupId IN (…)`.
Proto složený index `[groupId, blockId]`, ne jednosloupcový.

### Typ a render

Sloučená osa dostane **samostatný typ `BlockHistoryEntry`** (`src/lib/blockHistory.ts`),
používaný výhradně pro `/api/blocks/[id]/audit`. `AuditLogEntry` se nemění (§ 3).

Čistá funkce `formatRevisionLines(before, after): string[]` v
`src/lib/revisionFormat.ts` + testy. Sloupec bez popisku se tiše přeskočí.

| Co se změnilo | Řádek v historii |
| --- | --- |
| `machine` + čas | „Přesunuto z XL105 pá 8. 8. 14:00 na XL106 po 11. 8. 6:00" |
| jen čas | „Přesunuto na po 11. 8. 6:00" |
| `endTime` dopředu (+`printMinutes`) | „Prodlouženo do pá 8. 8. 18:00 (z 16:00)" |
| `endTime` dozadu | „Zkráceno do pá 8. 8. 15:00 (z 16:00)" |
| `locked` | „Zamčeno" / „Odemčeno" |

**Formát data vyžaduje novou funkci.** `formatPragueDateTime` (`dateUtils.ts:217–219`)
vypisuje „08.08.2026 14:00", ne „pá 8. 8. 14:00" — jediné `weekday: "short"`
v souboru běží pod locale `"en"` a slouží k výpočtu `dayOfWeek`. Přibude
`formatPragueDateTimeWithWeekday` nad
`Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric",
hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_TIME_ZONE })`.

### Role

Endpoint historie zůstává na dnešním role gate. Revize neodhalují nic, co dnes
`AuditLog` neukazuje — jde o tytéž sloupce téhož bloku. Ověřit při implementaci,
že filtr rolí na endpointu platí beze změny i pro revizní větev.

## 7. Úklid po 90 dnech

Skript `scripts/prune-revisions.ts` pouštěný denním cronem vedle stávající zálohy
(`docs/OPS_ZALOHY.md`). Maže po dávkách:

```sql
DELETE FROM BlockRevision WHERE createdAt < ? ORDER BY id LIMIT 1000
```

ve smyčce. Jednorázový `deleteMany` nad desetitisíci řádky by držel dlouhý zámek.

**Maže se po celých `groupId`**, ne po jednotlivých řádcích — půlka dávky
v tabulce je horší než žádná. Retenci drží konstanta `REVISION_RETENTION_DAYS = 90`.
Skript loguje počet smazaných řádků a velikost tabulky.

## 8. Rizika

| Riziko | Závažnost | Ošetření |
| --- | --- | --- |
| **Nová mutační cesta nepoužije `withRevision` vůbec** | vysoká | code review + pravidlo v `CLAUDE.md`; pomocník to zachytit **nemůže** a netvrdí to |
| Vnořený zápis do `Block` přes jiný model — dnes v repu není, ale nic nebrání ho přidat | střední | pravidlo v `CLAUDE.md`; obal nad `block` by ho neviděl |
| Kaskáda `ON DELETE SET NULL` a DML v migracích | střední | **vědomě neřešeno**, § 2 |
| Zdvojené / chybějící řádky v historii | střední | potlačení po sloupcích + mapa pokrytí s vlastním testem (§ 6) |
| Zpomalení zápisových cest zachycením | střední | jedno raw zamykající čtení na dávku id; **změřit** (§ 10) |
| `CREATE INDEX` nad produkčním `AuditLog` není okamžitý | střední | předměřit velikost tabulky, rozhodnout o zastavení aplikace (§ 10) |
| `migrate dev` je v repu rozbité (shadow-replay, P3006) | střední | migraci **napsat ručně** + `migrate deploy` |
| Holé `null` do `Json?` se nezkompiluje | nízká | `Prisma.DbNull` nebo vynechání klíče (§ 5) |

## 9. Testy

**Čisté funkce** (`node:test` + `tsx`):

- `revisionDiff.test.ts` — rozdíl bez `updatedAt`; **`updateMany` se stejnými
  hodnotami nevyrobí žádnou revizi**; změna tří sloupců → tři sloupce;
  `kind` se nikdy neodvozuje z přítomnosti `before`.
- `revisionRowNormalize.test.ts` — raw řádek → typovaný: všech deset `BOOLEAN`
  sloupců z 0/1 na `true`/`false`, `DATETIME` na `Date`, `NULL` zůstane `null`.
- `revisionFormat.test.ts` — každý řádek z tabulky v § 6 + sloupec bez popisku
  se přeskočí + přechod letního času.
- `auditCoverage.test.ts` — mapa pokrytí: každá hodnota `AuditLog.field`
  i `action` z repa mapuje na správné sloupce; **kombinovaná editace (audited
  pole + změna délky v jednom requestu) nechá revizní řádek zobrazený**.

**Serverové s transakcí** (vzor `undoApply.server.test.ts`):

- revize vznikne v téže transakci jako mutace; rollback nezanechá revizi;
- `AuditLog.groupId` se naplní u všech řádků transakce;
- chain push zachytí i odsunuté sousedy;
- **split sourozenec na DRUHÉM stroji dostane revizi** — případ, který vyvrátil
  návrh revize 1;
- `updateMany` nad celou split skupinou zachytí všechny členy;
- nesouhlas `count` u `updateMany` → `throw` ve vývoji, `partial: true` v produkci;
- rozdělení: `kind: "UPDATE"` u kořene, `kind: "CREATE"` u nových částí.

**Ruční ověření na dev databázi** (fixtura `scripts/seed-test-pripominky-dev.ts`,
2.–4. 9. 2026): přetáhnout blok na jiný stroj → historie ukáže řádek s oběma
stroji a časy, **a jen jednou**; v BlockEditu změnit zároveň délku a termín
expedice → historie ukáže **obojí**; uložit popis u hlavy rozdělené zakázky →
u sourozenců **nepřibude prázdný řádek**. Světlý i tmavý motiv.

## 10. Ověření před nasazením

1. `npm run build` zelený, `npm run lint` 0 chyb.
2. Celá suita zelená:
   `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/app/_components/*.test.ts`
3. **Měření souběhu** — dva prohlížeče, dva uživatelé, tentýž stroj: jeden spustí
   „Přepočítat celý stroj", druhý přetahuje blok a zakládá nový. Kontrolní otázka:
   chová se to jako dnes? Pomocník nemá zámky rozšířit — zamyká jen to, do čeho
   se stejně zapisuje.
4. **Měření počtu dotazů** na celostrojovém přepočtu před a po. Očekávaný nárůst
   je jednotky procent (jedno raw čtení na dávku id, jedno `createMany` na konci);
   kdyby vyšel řádově víc, zachycení se nedávkuje správně.
5. **Migrace — tři operace, ne dvě.** `CREATE TABLE BlockRevision` (rychlé);
   `ALTER TABLE AuditLog ADD COLUMN groupId VARCHAR(32) NULL` (na MySQL 8.0
   `INSTANT`); `CREATE INDEX … ON AuditLog(groupId, blockId)` (**`INPLACE`, čas
   úměrný velikosti tabulky, na začátku i konci bere exkluzivní metadata lock**).

   Před migrací povinně změřit na produkci:
   ```sql
   SELECT COUNT(*) FROM AuditLog;
   SELECT DATA_LENGTH, INDEX_LENGTH, ROW_FORMAT FROM information_schema.TABLES
     WHERE TABLE_NAME = 'AuditLog';
   ```
   `ROW_FORMAT` musí být `DYNAMIC`; na starším `COMPACT` z doby ručních zásahů
   (paměť o `action varchar(16)`) se `INSTANT ADD COLUMN` tiše přepne na `INPLACE`
   s rebuildem celé tabulky. Podle výsledku rozhodnout, jestli index vytvořit
   při zastavené aplikaci.
6. **Před zásahem na produkci `mysqldump` záloha** — bez výjimky.
7. Po týdnu provozu: porovnat skutečnou velikost `BlockRevision` s odhadem z § 5
   a teprve pak psát spec etapy B2.

## 11. Co změnily obě recenze

### První kolo — padl „region"

Revize 1 stavěla na regionu: stroji a časovém okně, které se před mutací načtou
a po ní porovnají. Vyvráceno třemi nezávislými důkazy:

1. **Split sourozenci region opouštějí.** `updateMany` je hledá výhradně podle
   `splitGroupId`, bez filtru na stroj i čas (`[id]/route.ts:509–512`).
   Vestavěná pojistka se opírala o seznam předávaný `assertNoOverlapForBlocks`,
   kde sourozenci nikdy nejsou (`:566`) — a u čistě obchodní editace se ta
   pojistka nevolá vůbec (`:538–540`).
2. **Region není před tělem transakce znám.** `computedEnd` vzniká uvnitř
   z `validateAndComputeEnd(tx, …)` (`:231, 235`); `detectCalendarDrift` běží
   rovněž uvnitř a dolní kotva sahá až rok zpět (`reflow.server.ts:239–249`).
3. **„Nadsadit region je zdarma" neplatilo.** Pod `FOR UPDATE` stojí zámek každý
   naskenovaný řádek, a predikát `endTime > from` rozsah v indexu
   `[machine, startTime, endTime]` zdola neomezuje. Ověřeno `EXPLAIN`em i živým
   testem dvou souběžných transakcí (`Lock wait timeout` po 3 s).

### Druhé kolo — jádro obstálo, obal ne

Nový mechanismus prošel: **žádný zápis mimo Prismu, žádné vnořené zápisy, typový
obal jde napsat bez `any`** (ověřeno zkompilovanou sondou). Recenze ale našla
27 vad v tom, co jsem kolem něj napsal:

- **`AuditLog.groupId` nemělo jak vzniknout** — pomocník obaloval jen `block`,
  auditní zápisy jdou přes `tx.auditLog` (13 míst). → pomocník otevírá transakci
  sám a nahrazuje oba delegáty (§ 4).
- **`rtx` nešlo protáhnout sdílenými funkcemi** bez změny jejich signatur
  a přepisu mocků. → týž zásah to řeší.
- **„Volající nemá jak zapomenout" neplatilo** — `tx` zůstával v uzávěru. → týž zásah.
- **Běhová pojistka byla tautologická.** → nahrazena kontrolou `count` a přiznáním,
  že zbytkové riziko hlídá code review (§ 4, § 8).
- **Potlačení v historii bylo na špatné granularitě** — po řádcích místo po
  sloupcích, takže kombinovaná editace v BlockEditu by pozici zahodila (§ 6).
- **Predikát potlačení nešel vyhodnotit z okna `take: 10`** (§ 6).
- **`updatedAt` v rozdílu** znamenal, že se nikdy nic nezahodí → prázdné řádky
  historie u každého split sourozence (§ 4).
- **`partial: true` bylo k nerozeznání od „blok vznikl"** → undo by smazalo
  existující blok. → explicitní sloupec `kind` (§ 5).
- **Změna `AuditLogEntry`** by rozbila panel notifikací přes druhý, neuvedený
  endpoint. → samostatný typ `BlockHistoryEntry` (§ 3, § 6).
- **Zachycení nebylo current-read** → přepočet by si připsal cizí změnu (§ 4).
- **`CREATE INDEX` nad produkčním `AuditLog`** není okamžitý (§ 10).

### Co se z tohohle specu vyříznulo

Čtrnáct z 27 nálezů druhého kola bylo v sekci o etapě B2 — řetězení undo/redo,
slučování dávek přes víc transakcí, chování při promazané revizi. Všechny mají
společnou příčinu: **navrhoval jsem mechaniku undo nad tabulkou, která ještě
neexistuje a jejíž skutečná data nikdo neviděl.**

B2 dostane vlastní spec, až `BlockRevision` pár týdnů poběží na produkci. Tehdy
půjde stavět proti reálným revizím, ne proti domněnkám — přesně kvůli tomu bylo
členění na B1/B2 od začátku zvolené.

---

## 12. Známé meze po dokončení B1 (doplněno 8. 8. 2026)

Zapsáno po dvou multi-agent recenzích, aby na ně spec etapy B2 a případná
stránka rekonstrukce nespadly implicitně.

**Co skříňka nezachytí.** Zápis přes globální klient `prisma` uvnitř těla
`withRevision` (strukturálně neuzavíratelné, hlídá code review a pravidlo
v `CLAUDE.md`) · DML uvnitř migrací · kaskády referenční integrity, které se
výslovně neprovedou přes `rtx` (dnes ošetřen jediný existující případ,
`ON DELETE SET NULL` nad `recurrenceParentId`).

**Marker neúplného zachycení není v ose vidět.** Degradovaný záznam
(`partial: true`) se zapisuje s `blockId: 0`, takže ho dotaz na historii
konkrétního bloku nenajde. Dotaz pro rekonstrukci ho musí hledat adresně.

**Jedno gesto uživatele může vyrobit VÍC `groupId`.** „Uložit vše → Celou
sérii", překlopení rezervace, lasso mazání i skupinové vložení posílají
N samostatných požadavků, tedy N transakcí. Předpoklad „1 groupId = 1 akce"
NEPLATÍ a etapa B2 s tím musí počítat (spec B2 to má jako vstupní podmínku).

**Osa stroje potřebuje UNION.** Přesun mezi stroji zapíše do
`BlockRevision.machine` ZDROJOVÝ stroj; cílový je v `after.machine`. Dotaz
„co se dělo se strojem X" proto musí spojit páteřní `WHERE machine = ?`
s `JSON_EXTRACT(after, '$.machine') = ?`.

**Kdo blok skutečně chytil.** Chain push se pozná z auditních řádků
`AUTO_SHIFT` ve stejné `groupId`; propagace do rozdělené zakázky ze sloupce
`viaMany`. U expedičních cest má `viaMany` i primární blok (routa staví
seznam z celé skupiny), takže skupina samých `true` znamená „nikdo nebyl
jmenován adresně" — ne že by se to odněkud propagovalo.

**Vzkříšený blok nedostane revizní řádek v panelu.** Undo mazání vyrobí
revizi `kind: "CREATE"` s plným snapshotem, ale mapa pokrytí ji označí jako
pokrytou auditním řádkem `restore`. Data v tabulce jsou, jen se v ose
nevykreslují dvakrát.

**Strop celostrojového přepočtu.** Doba roste nadlineárně (300 → 600 bloků
= 2× práce, ale ~3,5× čas). 600 bloků trvá 7,6–8,2 s, tedy 27 % z 30s limitu;
extrapolace ho vyčerpá kolem 1 100–1 300 bloků na stroj v 365denním okně.
Naměřeno stejně před i po zavedení revizí — není to jejich režie.
