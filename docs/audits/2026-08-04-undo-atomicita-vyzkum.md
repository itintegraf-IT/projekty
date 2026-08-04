# Výzkum: atomicita undo a chybové stavy (4. 8. 2026)

Multi-agent výzkum (4 agenti) spuštěný po selhání undo při testování hromadného
překlopení rezervace. Tenhle dokument je **podklad pro spec atomického undo
endpointu** — rozhodnutí Vojty ze 4. 8. 2026 udělat ho jako samostatnou etapu.

Vše níže je ověřené v kódu s odkazy na řádky. Kde jde o odvození, je to označené.

---

## 1. Spouštěč — co se stalo při testování

Plánovač překlopil rezervaci rozdělenou na dva stroje na zakázku. Překlopení
proběhlo správně (oba bloky, všechna tři pole, audit sedí), ale:

1. Server při překlopení **odsunul cizí blok** (`AUTO_SHIFT` v auditu).
2. Následné Ctrl+Z vrátilo typ a číslo obou bloků, ale **návrat odsunutého bloku
   spadl na HTTP 422** „Začátek bloku musí ležet na 30minutové hranici".
3. Undo tak zůstalo provedené napůl a další Ctrl+Z hlásil „Vrácení zpět selhalo".

Audit (`AuditLog` 1355–1367) a browser log to potvrzují jednoznačně.

### Root cause — dvě nezávislé věci

**(a) Nevalidní testovací data.** Seed skript `scripts/seed-test-pripominky-dev.ts`
vkládá bloky přímo přes Prisma, čímž obchází serverový overlap guard i validaci.
Vyrobil starty mimo 30minutovou mřížku, překryv dvou bloků na XL 105
a `printMinutes = 45` (nelegální stav). **Přesun byl správná reakce aplikace na
špatná data, ne chyba překlopení.**

**(b) Chain push zarovnává, undo chce vrátit mimo mřížku.** Chain push si nové
pozice vždycky snapuje (`Math.ceil(... / SLOT_MS) * SLOT_MS`,
`overlapResolver.ts:196, 240, 248`). Když odsune off-grid blok, posune ho **na**
mřížku. Undo ho chce vrátit **mimo** ni — a to serverová validace odmítne.
Selže to pokaždé, není to shoda okolností.

---

## 2. Proč grid kontrolu nelze obejít

`src/lib/scheduleValidationServer.ts:57-59` leží **před** větví `if (bypass)`,
takže ji `bypassScheduleValidation` neobejde. Zvažovali jsme uvolnění. Nelze:

**Obejití dá 500 místo 422.** `expandPrintTime` má **vlastní tvrdý throw** na
off-grid start (`src/lib/printTime.ts:63-65`), a to i pro `bypass = true`.
Bypass větev ho volá na řádku 70 jako konformitní sondu pro `effectivelyBypassed`,
non-bypass větev přes `expandPrintTimeFromDb` na řádku 75. Grid kontrola ve
`validateAndComputeEnd` je předsazená brána, která z pádu udělá čistou 422 —
dokládá to i titulek testu `scheduleValidationServer.test.ts:74`
(„nezarovnaný start → chyba (**ne crash**, kind INVALID_INPUT)").

**Bypass flag NENÍ undo-privátní kanál.** Tohle je rozhodující argument. Posílá ho:

| Cesta | Kdy | Kde |
| --- | --- | --- |
| drag bloku | při vypnutém zámku pracovní doby | `TimelineGrid.tsx:1018` |
| resize | dtto | `TimelineGrid.tsx:1046` |
| Ctrl+X/V přesun | dtto | `PlannerPage.tsx:2013` |
| vložení / skupinové vložení | dtto | `PlannerPage.tsx:77, 2047` |
| drop z fronty (parent i children) | dtto | `PlannerPage.tsx:1853, 1903` |
| série z BlockEdit | **vždy** | `BlockEdit.tsx:406` |
| undo edit / multi-edit | vždy | `undo/commands.ts:64, 140` |
| batch — **lepivé OR** | `bypass \|\| existing.scheduleBypassed` → i bez flagu | `batch/route.ts:108` |
| PUT — lepivý fallback | `oldBlock.scheduleBypassed` když se nemění pozice | `blocks/[id]/route.ts:246` |

Navíc **na bypass flagy neexistuje žádná role-kontrola** — jen route-level gate
ADMIN/PLANOVAT. Serverová mřížka je poslední obrana proti rozbitému nebo přímému
API klientovi; klient si starty zarovnává sám.

Uvolnění gridu pro bypass větev by tedy neuvolnilo „pro undo", ale pro každý drag
s vypnutým zámkem a pro každý curl s planovačskou session.

### Off-grid bloky jsou uznávaná legacy třída

Kód s nimi počítá na pěti místech: `calendarDrift.server.ts:90-91` („legacy blok
předcházející modelu tiskových hodin"), health check `unalignedStart`
(`healthChecks.server.ts:146-147`), `reflow.server.ts:91-93` (guard `UNALIGNED`),
`splitCompute.ts:48-51` (`NOT_ALIGNED`), `TimelineGrid.tsx:855` (resize snap).
Mřížka vznikla s tiskovými hodinami 2.–5. 7. 2026; migrace
`20260702093854_add_print_minutes_and_bypass` udělala **jen backfill printMinutes,
starty nikdy nezarovnala**.

**Pozor:** `validateAndComputeEnd` se pro REZERVACE a UDRZBA vůbec nespustí
(`scheduleValidationServer.ts:42`). Server je nikdy nesnapuje, snap je čistě
klientský a tažení po témže stroji kvantuje jen deltu — **off-grid rezervaci nebo
údržbu jde vyrobit dneska**, ne jen zdědit z minulosti.

### SQL na ověření populace v produkci (DB `igvyroba`, `sudo mysql`)

```sql
SELECT type,
       CASE WHEN endTime <= UTC_TIMESTAMP(3) THEN 'minulost' ELSE 'budoucnost' END AS obdobi,
       COUNT(*) AS pocet
FROM igvyroba.Block
WHERE MINUTE(startTime) NOT IN (0,30) OR SECOND(startTime) <> 0 OR MICROSECOND(startTime) <> 0
GROUP BY type, obdobi;
```

---

## 3. Jádro problému — undo nemá atomicitu napříč HTTP voláními

Undo se provádí v krocích (PUT, PUT, pak batch) a **mezi nimi neexistuje
transakce**. Cokoliv selže uprostřed, zůstane půl vrácené.

### Pořadí kroků změnit nejde

Prověřeno oběma směry:

- `buildCreateCommand.undo` — DELETE **před** návratem sousedů. Obráceně by
  sousedi najeli do místa, které pořád okupuje vytvořený blok, a **finální
  pojistka batche** (`overlapCheck.ts:78-109`, „běží VŽDY i při
  `bypassOverlapCheck`") celý batch shodí.
- `buildMultiEditCommand.undo` — PUTy **před** `restoreShifted`. Obráceně totéž.

Současné pořadí je jediné funkční. **Cenou je okno částečného selhání mezi
požadavky, které žádná serverová transakce nepřeklenuje.**

### Proč druhý Ctrl+Z nepomůže

Buildery si při dílčím úspěchu přepisují `updatedAt` z odpovědi
(`commands.ts:66, 142, 26, 217`); `Block.updatedAt` je `@updatedAt`
(`schema.prisma:70`), takže každý PUT ho bumpne. Guard ale porovnává živý stav
proti **protistraně** snapshotu, kterou dílčí úspěch neosvěžil.

Druhý pokus proto vidí verze rozhozené **vlastním půl-provedeným undo**,
vyhodnotí `StaleUndoError` a záznam **tiše zahodí**. Toast přitom řekne „blok byl
mezitím změněn jiným uživatelem" — lež, změnili jsme ho my.

Další stisky popují starší záznamy, jejichž guardy odkazují na tytéž bloky →
kaskáda `StaleUndoError`, každý stisk zahodí jeden záznam.

### Řízení chyb v jádře (`useUndoManager.ts:21-32`)

| Situace | Osud záznamu | Toast |
| --- | --- | --- |
| úspěch | přesun na `redoStack` | „Vráceno zpět" |
| `StaleUndoError` | **tiše zahozen** | „Nelze vrátit: blok byl mezitím změněn" |
| jiná chyba | **vrácen na `undoStack`** | „Vrácení zpět selhalo." |

**Serverová hláška končí jen v `console.error`** (ř. 30). Undo je jediná
vícekroková operace v aplikaci, která hlásí binárně a bez příčiny — flip
i „Uložit vše" už dnes hlásí „Překlopeno X z Y, pak nastala chyba: …".

---

## 4. Předexistující vady (nezávislé na dávce z 8/2026)

### 4.1 `buildDeleteCommand.undo` — nekonečná smyčka

`commands.ts:271-279`. **Nemá žádný guard** → nikdy nevznikne `StaleUndoError` →
každá chyba znamená re-push. A payload z `blockToCreatePayload` **záměrně nenese
request flagy**, přičemž call-site žádné nedoplňuje — na rozdíl od `putBlock`
i `batchUpdate`, které bypass posílají právě proto, že „undo vrací blok do stavu,
který už jednou existoval" (`commands.ts:60-64`).

Důsledek: **undo smazání bloku umístěného s vypnutým zámkem selže vždycky**
(`START_NOT_RUNNABLE` → 422) a uživatel se zacyklí. Žádný souběh není potřeba.
Další trvalé příčiny: obsazený slot (409), zaniklá split skupina (422), smazaný
preset (400).

### 4.2 `deleteBlock` není idempotentní

404 hodí výjimku místo úspěchu (`PlannerPage.tsx:184-189`). Když mazání selže
uprostřed série, `removeFromState` neproběhne (je až za smyčkou,
`commands.ts:247`), klient si drží fantomy (vlastní SSE událost nedostane —
`events/route.ts:57`) a další pokus se točí na mazání neexistujícího bloku.

### 4.3 Duplikáty při retry undo mazání

`buildDeleteCommand.undo` retry POSTne blok znovu. U ZAKÁZKY to zarazí overlap
s vlastní první kopií. **U REZERVACE bez `reservationId`** provede POST route
self-shift na nejbližší volný slot (`blocks/route.ts:223-238`) → každý další
Ctrl+Z vyrobí další kopii o kus dál.

### 4.4 Testy jádra undo se nespouštějí

`src/app/_components/useUndoManager.test.ts` **není v testovacím globu** ani po
opravě z 4. 8., která přidala jen `src/lib/undo/*.test.ts`. Soubor leží
v `_components`.

---

## 5. Vada v dávce z 8/2026 — `restoreShifted` není bit-perfektní

Batch pro ZAKÁZKU **ignoruje klientský `endTime`** a pod bypassem počítá
`end = start + printMinutes` (`batch/route.ts:95-114`,
`scheduleValidationServer.ts:61-72`). Soused, jehož původní span překlenoval pauzu
směny, se undo-obnovou **zkomprimuje** a dostane `scheduleBypassed = true`,
přestože byl předtím konformní. Neprojeví se uvnitř jedné směny, u nočních
a víkendových přechodů ano.

---

## 6. Mapa částečných selhání podle builderu

| Builder | Kde selže | Co zůstane | Retry |
| --- | --- | --- | --- |
| `buildMoveCommand` | jeden atomický batch | nic (tx) | smysluplný, u trvalé příčiny marný |
| `buildEditCommand` | PUT ok, batch sousedů fail | primár vrácen, sousedi ne | Stale → zahozeno |
| `buildMultiEditCommand` | PUT #k, nebo restoreShifted | část cílů vrácena | Stale → zahozeno |
| `buildCreateCommand.undo` | DELETE #k, nebo restoreShifted | bloky smazané, sousedi ne | Stale / smyčka 404 |
| `buildCreateCommand.redo` | POST #k po restoreShifted | fantomové bloky v DB | Stale → zahozeno |
| `buildDeleteCommand.undo` | POST #k | část obnovena, klient nevidí | **nekonečná smyčka / duplikáty** |

### Validace v `/api/blocks/batch` a jejich krytí bypassem

| Validace | Kryta? |
| --- | --- |
| optimistic lock `expectedUpdatedAt` | ne → 409 |
| INVALID_INPUT (mřížka, %30, 40 h) | **ne — běží i s bypassem** |
| CompanyDay (odstávka) | **ne — explicitně** |
| pracovní doba / horizont | ano |
| `findIntraBatchOverlap` | ne → 409 |
| early `checkBlockOverlap` | ano (`bypassOverlapCheck`) |
| **finální `assertNoOverlapForBlocks`** | **ne — „běží VŽDY"** |

Batch je jedna transakce, takže `restoreShifted` je aspoň atomický sám o sobě.

---

## 7. Rozhodnutí (Vojta, 4. 8. 2026)

**Udělat atomický undo endpoint jako samostatnou etapu** se spec, plánem a review.

Doporučoval jsem opak — tři levné opravy (hláška do toastu, DELETE 404 = úspěch,
bypass parita u undo mazání) a endpoint do backlogu. Argumenty proti okamžitému
endpointu, které Vojta zvážil a přesto rozhodl jinak:

- je to **nová zápisová cesta**, nejrizikovější třída změny v tomhle projektu
  (v 7/2026 se ukázalo, že reflow roky nevolal overlap pojistku),
- **neopraví původní incident** — blok mimo mřížku se nevrátí ani atomicky,
  jen selže čistě,
- nejlevnější opravy mají nejlepší poměr užitku k riziku.

### Co endpoint musí splnit

- Heterogenní operace (`put` / `move` / `create` / `delete`) v **jedné Prisma
  transakci**, s finální `assertNoOverlapForBlocks` na konci.
- Audit v téže transakci (konvence CLAUDE.md).
- `requireRole` uvnitř try, chyby přes `AppError`, logování přes `logger`.
- Neúspěch nesmí změnit nic → re-push v manageru se stane korektním
  a guardy ostatních záznamů se nerozbijí.
- Nesmí obcházet grid kontrolu (viz sekce 2).

### Co endpoint sám o sobě NEŘEŠÍ a je potřeba doplnit

- **Hláška s příčinou v toastu** (`useUndoManager.ts:30, 42`) — dnes končí
  v `console.error`. Jeden řádek, největší jednotlivá diagnostická výhra.
- **Test glob** — doplnit `src/app/_components/*.test.ts`.
- **`restoreShifted` komprese spanu** (sekce 5) — rozhodnout, jestli endpoint
  bude respektovat uložený `endTime`, nebo se to přijme jako známé omezení.

---

## 8. Seed skript — invarianty, které porušoval

`scripts/seed-test-pripominky-dev.ts` (přímý zápis přes Prisma obchází validaci):

1. starty mimo 30min mřížku — 6 bloků,
2. `printMinutes = 45` u `TEST-P8-45M` — **časovaná bomba**: první drag vezme
   uloženou hodnotu → 422 → s blokem nejde vůbec hýbat,
3. překryv `KRATKASPEC` 16:45–18:45 × rezervace 18:00–20:00 na XL 105,
4. `Reservation.status = "SCHEDULED"` bez `scheduledBlockId/Machine/StartTime/
   EndTime/At` → detail v /rezervace mlčí (`ReservationDetail.tsx:167`),
5. `dataRequiredDate` z UTC data místo pražského (`todayPragueDateStr`),
6. řetěz `RETEZ-1..4` těsně před rezervací → test chain pushe rozhodí fixture
   pro překlopení,
7. `--clean` nechává viset `AuditLog`, `Notification`, osiřelé `SplitGroup`;
   po překlopení se `orderNumber` přepíše a blok úklidu podle prefixu uteče.

**Pozor na interferenci:** `scripts/seed-test-tiskove-hodiny.ts:66-68` maže
`orderNumber startsWith "TEST-"` — smaže i `TEST-P8-*`.

### Vzor k převzetí

`scripts/seed-test-tiskove-hodiny.ts` je jediný „zlatý" seed: pro každý blok
`pragueToUTC` → `loadMachineCalendar` → `snapStartToNextRunnableSlot` →
`expandPrintTimeFromDb` a **ukládá vrácený `end`**, plus explicitní overlap
pre-check a allowlist guard na localhost (ne denylist na produkční IP).

### Preflight funkce volatelné ze skriptu (obyčejný Prisma klient stačí)

`validateAndComputeEnd` · `expandPrintTimeFromDb` · `checkBlockOverlap` ·
`assertNoOverlapForBlocks` · `findIntraBatchOverlap` (čistá) ·
`checkScheduleViolationWithTemplates` + `serializeWeekShifts` (pro REZERVACE,
které `validateAndComputeEnd` nevaliduje) · `resolveDayIntervals` ·
`pragueToUTC` · `todayPragueDateStr`.

### Provozní doba středa 2. 9. 2026 (weekStart 2026-08-31)

`dayOfWeek` je **0 = neděle** (JS konvence, `machineWeekShifts.ts:12`), středa = 3.
XL 105: ranní + odpolední, **okno 06:00–22:00**. XL 106: ranní + odpolední +
noční, **okno 24 h**.

### Navržený rozpis (Praha, mřížka ✓, bez překryvů, s mezerami na chain push)

**XL 105:** 30M 06:00–06:30 · 1H 06:30–07:30 · 1H30 07:30–09:00 ·
2H 09:00–11:00 · 4H 11:00–15:00 · BEZSPEC 15:00–16:00 ·
KRATKASPEC 16:00–18:00 · *mezera 18:00–20:00* · REZ 20:00–22:00 (obálka,
`reservationId`)

**XL 106:** TERMIN-EARLY 06:00–08:00 · TERMIN-DNES 08:00–10:00 ·
TERMIN-PO 10:00–12:00 · OBOJI 12:00–14:00 · RETEZ-1..4 14:00/15:00/16:00/17:00 ·
*mezera 18:00–20:00* · REZ 20:00–22:00 (vnitřky, bez `reservationId`)

45min zakázku zrušit — TINY pásmo pokrývá už 0:30 a 45 min je nelegální stav.

---

## 9. Stav dev DB k 4. 8. 2026

Špinavý po nedokončeném undo: `TEST-P8-KRATKASPEC` zůstal odsunutý na
18:00–20:00 UTC, oba REZ bloky zpátky jako REZERVACE. Přegenerovat spolu
s opravou skriptu.
