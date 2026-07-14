# CLAUDE.md — Repo Truth

Aktualizováno podle stavu repozitáře k 13. 7. 2026.

Tento soubor slouží jako stručný, praktický snapshot projektu pro AI asistenty. Pokud se aplikace změní, aktualizuj nejdřív tento soubor a až potom navazující dokumentaci.

## Ověřený stav

- `git status --short` je čistý
- `npm run build` prošel
- `npm run lint` vrací warningy, ale 0 chyb
- celá test suite: **392/392 testů zelené** (viz níže)
- aktivní datasource v `prisma/schema.prisma` je `mysql`
- modul `/expedice` je nasazen na produkci (deploy 12. 4. 2026)
- audit remediation dokončen 15.–16. 4. 2026 (Sprinty 1–5)
- copy/paste UX fix dokončen 27. 5. 2026 (5 Tasků, plán `docs/superpowers/plans/2026-05-27-copy-paste-ux-fix.md`)
- clipboard text-copy fix (HTTP secure-context) 27. 5. 2026 (helper `src/lib/clipboardCopy.ts`)
- tiskové hodiny — etapa 4 (klientské mutační cesty + 40h dropdown) dokončena 2. 7. 2026 — viz sekci „Klientské mutační cesty" níže
- tiskové hodiny — etapa 5 (vykreslení pauz + poctivé náhledy + deadline štítek + rezervace 40 h) dokončena 2. 7. 2026 — viz sekci „Vykreslení pauz a poctivé náhledy" níže
- tiskové hodiny — etapa 6 (kalendářní revalidace: drift detekce, notifikace, reflow endpointy, sticky-bypass split fix) dokončena 3. 7. 2026 — viz sekci „Kalendářní revalidace" níže
- tiskové hodiny — etapa 7 (reporty přes tiskové hodiny: retro/outlook dashboard + denní report počítají vytížení z tiskového času, ne z kalendářní délky bloku) dokončena 4. 7. 2026 — viz sekci „Reporty přes tiskové hodiny" níže
- tiskové hodiny — etapa 8 FINÁLE (multi-agent review celé featury 5 lens + fix wave + Gardena 27h důkaz na dev DB) dokončena 5. 7. 2026 — viz sekci „Finále featury" níže; deploy checklist: `docs/superpowers/plans/2026-07-05-tiskove-hodiny-deploy-checklist.md`
- 4 body z auditu plánovače (pásy směn, MICRO text, Σ split, cut=přesun) dokončeny 9. 7. 2026 — viz sekci „4 body z auditu plánovače" níže; spec `docs/superpowers/specs/2026-07-09-planovac-4-body-design.md`, plán `docs/superpowers/plans/2026-07-09-planovac-4-body.md`
- audit kvality kódu a designu — etapa **Audit Top 5** (plán `docs/superpowers/plans/2026-07-11-etapa-audit-top5.md`): fáze A (light-mode hotfixy, focus-visible), B (úklid mrtvého kódu vč. smazání `/tiskar`), C (jeden zdroj pravdy — blockPayload/errorStatus/requireRole/blockStyles) hotové; fáze D část 1 (sdílené UI kameny: `zLayers` kanonická z-index škála + `ConfirmDialog`) hotová 13. 7. 2026 — multi-agent review 3 lens, 0 critical/important. Zbývá D část 2 (NativeSelect, PrimaryCta, ModuleHeader, uiStyles) + fáze E (dekompozice)
- split-skupiny — **root-cause fix (varianta B2)**, v kódu na větvi Vojta 13. 7. 2026 (deploy na produkci = Fáze 7, čeká): `Block.splitGroupId` re-pointnut ze self-FK na `Block.id` na novou tabulku `SplitGroup`. Smazání kteréhokoli člena (vč. rootu) už skupinu NErozpustí (FK `ON DELETE SET NULL` míří na `SplitGroup.id`, ne na sourozence) → Ctrl+Z undo obnoví 3/3. Nahradilo dřívější symptom-fix `restoreSplitGroupId` (smazán). Split vzniká atomicky přes `POST /api/blocks/[id]/split`. Fáze 1–6 hotové (E2E na dev 6/6 vč. „smaž root → undo = 3/3", migrace SQL review 0 kritických). Plán `docs/superpowers/plans/2026-07-13-split-group-b2.md` — viz sekci „Split-skupiny (tabulka SplitGroup, B2)" níže

### Spuštění testů

```bash
node --test --import tsx src/lib/auditQuery.test.ts               # 17 testů
node --test --import tsx src/lib/authz.test.ts                     # 4 testy
node --test --import tsx src/lib/blockNotePermissions.test.ts      # 12 testů
node --test --import tsx src/lib/blockPayload.test.ts              # 13 testů
node --test --import tsx src/lib/blockShades.test.ts               # 9 testů
node --test --import tsx src/lib/calendarDrift.server.test.ts      # 8 testů
node --test --import tsx src/lib/clipboardCopy.test.ts             # 6 testů
node --test --import tsx src/lib/dateUtils.test.ts                 # 8 testů
node --test --import tsx src/lib/errors.test.ts                    # 7 testů
node --test --import tsx src/lib/findConflictingBlocks.test.ts     # 11 testů
node --test --import tsx src/lib/jobPresets.test.ts                # 17 testů
node --test --import tsx src/lib/notifications.test.ts             # 6 testů
node --test --import tsx src/lib/overlapCheck.test.ts              # 13 testů
node --test --import tsx src/lib/overlapResolver.server.test.ts    # 7 testů
node --test --import tsx src/lib/overlapResolver.test.ts           # 13 testů
node --test --import tsx src/lib/pasteTarget.test.ts               # 6 testů
node --test --import tsx src/lib/printTime.server.test.ts          # 7 testů
node --test --import tsx src/lib/printTime.test.ts                 # 22 testů
node --test --import tsx src/lib/printTimeClient.test.ts           # 37 testů
node --test --import tsx src/lib/productionTags.test.ts            # 14 testů
node --test --import tsx src/lib/reflow.server.test.ts             # 24 testů
node --test --import tsx src/lib/reportMetrics.test.ts             # 31 testů
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleSlotFinder.server.test.ts  # 8 testů
node --test --import tsx src/lib/scheduleSlotFinder.test.ts        # 13 testů
node --test --import tsx src/lib/scheduleValidation.test.ts        # 19 testů
node --test --import tsx src/lib/scheduleValidationServer.test.ts  # 12 testů
node --test --import tsx src/lib/seriesPropagation.test.ts         # 6 testů
node --test --import tsx src/lib/shiftRoster.test.ts               # 5 testů
node --test --import tsx src/lib/shifts.test.ts                    # 18 testů
node --test --import tsx src/lib/splitCompute.test.ts             # 9 testů
node --test --import tsx src/lib/splitHelpers.test.ts              # 7 testů
node --test --import tsx src/lib/zLayers.test.ts                   # 3 testy
```

Celkem **392 testů** ve 32 souborech (jeden běh: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts`).

`scheduleSlotFinder.server.test.ts` používá `mock.module` (node:test) — na aktuálním Node je to za experimentální flag branou, bez `--experimental-test-module-mocks` selže s `TypeError: mock.module is not a function`. Ostatní soubory tuto flag nepotřebují (i ty, co importují `mock` pro `mock.fn`, jako `overlapResolver.server.test.ts` — to je stabilní API).

## Co aplikace dnes umí

### 1. Planner

- hlavní planner běží na `/`
- timeline pro stroje `XL_105` a `XL_106`
- drag & drop z fronty, resize, split zakázek, batch přesuny, copy/paste
- provozní hodiny per-týden přes `MachineWeekShifts` (flag-only model)
- odstávky přes `CompanyDay`
- audit změn bloků
- potvrzení tisku

### 2. Rezervace

- samostatný modul na `/rezervace`
- role `OBCHODNIK` může zakládat a sledovat vlastní rezervace
- role `ADMIN` a `PLANOVAT` rezervace přijímají, připravují do fronty, zamítají a plánují
- stavový tok:
  - `SUBMITTED`
  - `ACCEPTED`
  - `QUEUE_READY`
  - `SCHEDULED`
  - `REJECTED`
- rezervace mají přílohy ukládané na filesystem

### 3. Admin

- `/admin` má taby:
  - uživatelé
  - číselníky
  - presety
  - audit
  - pracovní doba
- `PLANOVAT` má omezený admin pohled: číselníky, presety, pracovní doba

### 4. Notifikace

- role-based notifikace pro `DTP` a `MTZ`
- user-targeted notifikace pro `OBCHODNIK`
- `ADMIN` a `PLANOVAT` vidí historii notifikací a auditní aktivitu

### 5. Reporty

- denní report na `/report/daily?date=YYYY-MM-DD`
- tiskové rozložení A4 landscape
- API `GET /api/report/daily`

## Role a přístup

| Role | Planner | Rezervace | Admin | Notifikace |
| --- | --- | --- | --- | --- |
| `ADMIN` | plný edit | ano | plný | audit + historie |
| `PLANOVAT` | plný edit | ano | omezený admin | audit + historie |
| `DTP` | edit DATA | ne | ne | vlastní inbox |
| `MTZ` | edit MATERIÁL | ne | ne | vlastní inbox |
| `OBCHODNIK` | read-only | vlastní rezervace | ne | vlastní inbox |
| `TISKAR` | read-only + tisk | ne | ne | ne |
| `VIEWER` | read-only | ne | ne | ne |

Poznámka k `TISKAR`:

- tiskařský režim běží na `/` (hlavní planner s `isTiskar` větvemi + `TiskarMachineToggle` + potvrzení tisku)
- samostatný modul `/tiskar` (TiskarMonitor) byl zrušen 12. 7. 2026 jako nedosažitelný mrtvý kód (audit fáze B) — login i middleware vedou tiskaře na `/`

## MySQL a data

- projekt už nepoužívá SQLite jako aktivní datasource
- aktivní zdroj pravdy je `prisma/schema.prisma`
- migrace jsou v `prisma/migrations/`
- metadata příloh jsou v tabulce `ReservationAttachment`
- obsah příloh leží na disku v `data/reservation-attachments/<reservationId>/<storageKey>`

Důležité modely:

- `Block`
- `Reservation`
- `ReservationAttachment`
- `Notification`
- `JobPreset`
- `CodebookOption`
- `CompanyDay`
- `MachineWorkHours`
- `MachineWeekShifts`
- `User`
- `AuditLog`
- `SplitGroup`

Repo-truth k pracovní době:

- runtime planneru pracuje s `MachineWeekShifts` (per-týden grid, flag-only model: morningOn/afternoonOn/nightOn + isActive derivované)
- fixní časy směn: MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6 (viz `src/lib/shifts.ts`)
- původní modely `MachineWorkHoursTemplate`, `MachineWorkHoursTemplateDay` a `MachineScheduleException` byly zrušeny ve Sprintu E (2026-04-19) — data migrována přes `scripts/migrate-to-week-shifts.ts`
- tabulka `MachineWorkHours` v projektu zůstává kvůli bootstrapu a kompatibilitě starších dat

### Split-skupiny — tabulka SplitGroup (B2, 13. 7. 2026; deploy čeká na Fázi 7)

Root-cause oprava undo bugu u split zakázek. **Dřív:** `Block.splitGroupId` byl self-FK na `Block.id` (root skupiny měl `splitGroupId === vlastní id`, `ON DELETE SET NULL`). Smazání rootu nullovalo `splitGroupId` u sourozenců → skupina se rozpustila a Ctrl+Z undo obnovil jen 2/3. **Teď (B2):** samostatná tabulka `SplitGroup(id, createdAt)`; `Block.splitGroupId` je FK na `SplitGroup.id`. Smazání *člena* (i rootu) se `SplitGroup` řádku nedotkne → ostatní členové drží FK a undo obnoví 3/3.

- **Migrace** `prisma/migrations/20260713120000_split_group_table`: `CREATE TABLE SplitGroup` (`id INTEGER UNSIGNED`) → backfill `INSERT DISTINCT splitGroupId` (⇒ `SplitGroup.id` = staré root PK, žádný `Block` řádek se nemění) → DROP starý self-FK → `ALTER Block MODIFY splitGroupId INTEGER UNSIGNED` (no-op na produkci, kde už unsigned je; na dev konvertuje signed→unsigned) → ADD FK na `SplitGroup(id) ON DELETE SET NULL`. Psaná ručně (shadow-DB na tomto projektu neprojde starou UNSIGNED migraci).
- **Vznik splitu**: atomický `POST /api/blocks/[id]/split` (`requireRole ADMIN/PLANOVAT`) — v jedné transakci: optimistický zámek, guardy (printCompleted, splitAt uvnitř / pauza), `computeSplitPrintMinutes` (`src/lib/splitCompute.ts`), create/reuse `SplitGroup`, head přes `validateAndComputeEnd`, tail create, audit, chain push, overlap re-check, SSE. Klient (`TimelineGrid.handleSplitBlockAt`) volá jeden endpoint místo dřívější 3-request orchestrace.
- **Konzumenti skupiny** dotazují členství VÝHRADNĚ přes `splitGroupId` (`where: { splitGroupId: X }`), NIKDY `id === splitGroupId` — `Block.id` a `SplitGroup.id` jsou nezávislé id-prostory (numerická shoda nic neznamená). `orderIdentity` v `blockShades.ts` proto namespacuje `g${splitGroupId}`/`b${id}` (jinak by skupina zdědila odstín souseda).
- **Undo** posílá `splitGroupId` přes `blockToCreatePayload` opts; POST `/api/blocks` guard ověří existenci `SplitGroup` řádku (`VALIDATION_ERROR` → 400 místo FK 500). Symptom-fix `restoreSplitGroupId` je **smazán**.
- **Propagace shared fields (PUT)**: editace sdíleného pole se přes `updateMany` propaguje na sourozence skupiny; PUT je pak refetchne, broadcastuje (`block:batch-updated`) a vrátí v odpovědi jako `siblings` — jinak klient drží stale `updatedAt` sourozenců a další split sourozence spadne na falešný 409 (#9/#12). Undo cesta (`buildEditCommand`) sourozence aplikuje symetricky (`effects.addToState`). Sourozenci už v `shifted` (chain push) se z `siblings` filtrují. **Známé omezení**: stejný „updateMany bez oznámení" má i `expedition` route (reorder/publish/unpublish) — dosud neřešeno (self-heal přes polling).
- **Deploy gotchy (Fáze 7)**: MySQL DDL je auto-commit (3 statementy nejsou atomické) → app-stop + orphan pre-check před migrací; `MODIFY … UNSIGNED` je na prod MariaDB 10.11 no-op; osiřelé `SplitGroup` řádky (po smazání posledního člena) jsou neškodné (2 sloupce, žádný FK crash) a naopak posilují undo — produkce je nikdy nemaže.
- **Hlavní soubory**: `prisma/schema.prisma` (model `SplitGroup`, relace `BlockSplitGroup`), `src/app/api/blocks/[id]/split/route.ts`, `src/lib/splitCompute.ts` (+ testy), `src/lib/blockShades.ts` (`orderIdentity`), `src/lib/blockPayload.ts` (`blockToCreatePayload` opts).

## Bezpečné a nebezpečné příkazy

Bezpečné pro prázdnou nebo novou DB:

```bash
npx prisma migrate deploy
npm run prisma:bootstrap
```

Destruktivní dev-only:

```bash
npm run prisma:seed
```

`prisma:seed` maže vývojová data a znovu je naplní. Nepoužívat na produkci.

## Prisma — konvence relací (KRITICKÉ)

Prisma při `prisma db pull` nebo `prisma format` přejmenuje relační pole podle názvu modelu (velká písmena). Tím rozbije celý kód. **Nikdy nespouštět `prisma db pull` ani `prisma format` bez kontroly.**

Kanonické názvy relací v tomto projektu (kód je na nich závislý):

| Model | Pole | Typ |
| --- | --- | --- |
| `Reservation` | `blocks` | `Block[]` |
| `Reservation` | `attachments` | `ReservationAttachment[]` |
| `ReservationAttachment` | `reservation` | `Reservation` |

Pokud Prisma VS Code extension po uložení přepíše tato pole na `Block`, `ReservationAttachment`, `Reservation` — je to chyba formátovače. Vrátit zpět na výše uvedené názvy.

Po každé změně schématu spustit `npm run build` lokálně před pushem — build zachytí TypeScript chyby dřív než server.

## Coding standards — best practices z auditu (16. 4. 2026)

Tato sekce definuje vzory, které MUSÍ dodržovat každý nový kód. Vznikly jako výsledek bezpečnostního a code quality auditu.

### Chybové stavy v API routes — vždy `AppError`

```typescript
import { AppError, isAppError } from "@/lib/errors";

// ✅ správně
throw new AppError("NOT_FOUND", "Blok nenalezen");
throw new AppError("SCHEDULE_VIOLATION", "Blok zasahuje mimo pracovní hodiny.");
throw new AppError("FORBIDDEN", "Nemáš oprávnění.");

// ❌ špatně — string prefix pattern, nelze typově zachytit
throw new Error("NOT_FOUND");
throw new Error("PRESET:Chyba");
```

V catch bloku API route (`errorStatus` je od fáze C etapy Audit Top 5 skutečná sdílená funkce v `src/lib/errors.ts` — kanonická mapa kód→HTTP status, žádné lokální kopie):
```typescript
} catch (err) {
  if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
  logger.error("[route] neočekávaná chyba", err);
  return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
}
```

### Auth v API routes — nové routes přes `requireRole`

```typescript
import { requireRole } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]); // hází AppError → catch výše
    ...
```

`requireRole` hází `UNAUTHORIZED` (401) pro nepřihlášeného a `FORBIDDEN` (403) pro špatnou roli — volat UVNITŘ try bloku. Čisté jádro `assertRole` žije v `src/lib/authz.ts` (testovatelné bez DB). Stávající return-style gaty (reflow, machine-week-shifts…) se převádí průběžně, ne big-bang.

### Logování na serveru — vždy `logger`, nikdy `console`

```typescript
import { logger } from "@/lib/logger";

logger.info("[login] přihlášení úspěšné", { username });
logger.warn("[login] neplatné heslo", { username });
logger.error("[blocks] chyba při uložení", err);
```

`console.log/warn/error` v API routes jsou zakázány — logger v produkci píše strukturovaný JSON, v dévě barevný text.

### Validace harmonogramu — vždy `validateAndComputeEnd`

Kdykoliv API route přijímá `startTime` bloku typu ZAKAZKA, musí volat `validateAndComputeEnd` a uložit **end vrácený funkcí** — nikdy end z klienta. Funkce nejen validuje, ale i počítá autoritativní end přes „tiskové hodiny" (expanze přes weekShifts + companyDays, odstávky se překlenou pauzou):

```typescript
import { validateAndComputeEnd } from "@/lib/scheduleValidationServer";

const sched = await validateAndComputeEnd(
  db, machine, startTime, printMinutes, fallbackEnd, blockType, bypassFlag
);
if (!sched.ok) return NextResponse.json({ error: sched.error }, { status: 422 });
const end = sched.end; // autoritativní, nikdy nepřebírat end z requestu
const scheduleBypassed = sched.effectivelyBypassed; // uložit TOTO, nikdy echo bypass flagu
```

Návratová hodnota při `ok: true` obsahuje i `effectivelyBypassed` — SPOČÍTANOU pravdu o konformitě umístění s kalendářem (bypass request na místě, které kalendáři sedí, vrací `false`). Do `Block.scheduleBypassed` se ukládá výhradně tato hodnota, nikdy surový `bypassScheduleValidation` z requestu. Při `ok: false` je k dispozici `kind`: `"INVALID_INPUT"` (vadné printMinutes / nezarovnaný start — auto-shift NESMÍ maskovat, vždy 422) vs. `"PLACEMENT"` (mimo provoz / odstávka / horizont — auto-shift povolen).

Nikdy neduplikovat tuto logiku — `scheduleValidationServer.ts` je jediný zdroj pravdy pro serverovou validaci harmonogramu i výpočet end. Platí pro POST `/api/blocks`, PUT `/api/blocks/[id]` a POST `/api/blocks/batch`. Stará `validateBlockScheduleFromDb` (validace bez výpočtu end) byla zrušena.

Chain push (`resolveChainPushFromDb`) a auto-shift (`findNextFreePrintSlotFromDb`) od etapy 3
umísťují bloky přes start-only snap (`snapStartToNextRunnableSlot`) + `expandPrintTime` podle
per-blok `printMinutes` a `scheduleBypassed` — odsunutý blok smí pauznout přes odstávku a jeho
end vždy sedí na kalendář. Kolize se zamčeným/vytištěným blokem = odmítnutí transakce s hláškou
(žádné tiché přeskládání). Limit auto-shiftu (7 dní) platí pro posun STARTU, ne endu.
Automatika dělí blok pauzou jen když každý tiskový kus ≥ 1 h (`MIN_PRINT_SEGMENT_MINUTES`,
helper `violatesMinPrintSegment`); jinak blok posune celý za odstávku (fallback z nouze
pauzu povolí, když se blok nevejde nikam). Ruční umístění pravidlu nepodléhá.
Stará duration-based `findNextFreeSlot`/`findNextFreeSlotFromDb` zůstává jen pro klientské
preview a ne-ZAKAZKA bloky.

#### Klientské mutační cesty (etapa 4, 2. 7. 2026)

Všechny klientské mutační cesty, které mění `startTime`/`machine` bloku typu ZAKAZKA, posílají
na server `printMinutes` (nikdy naivní `endTime` jako zdroj pravdy) a snapují **jen start** přes
`snapStartToNextRunnableSlot` (`src/lib/printTime.ts`) — nikdy starý duration-based
`snapToNextValidStartWithTemplates`. End vždy dopočítá server (`validateAndComputeEnd`).
Týká se: drag jednoho bloku, multi-move (lasso), Ctrl+V paste, group paste, queue drop (blok z
fronty do gridu) a série (opakující se bloky). Editace přes `BlockEdit` posílá `printMinutes`
stejně. Ne-ZAKAZKA bloky (UDRZBA, …) tímto beze změny — zůstávají na duration-based snapu.

Klientské helpery pro tyto cesty žijí v `src/lib/printTimeClient.ts` (klient-safe, žádný DB
import):
- `blockPrintMinutes(block)` — `printMinutes` pro ZAKAZKA (fallback elapsed zarovnaný na 30min
  grid, min 30), elapsed pro ostatní typy.
- `companyDayIntervalsFor(machine, companyDays)` — převod klientských `CompanyDay` záznamů na
  intervaly pro daný stroj (global + machine-specific).
- `snapGroupDeltaStartOnly(blocks, deltaMs, weekShifts, companyDays)` — skupinový start-only snap
  pro lasso přesun; vrací `null`, když některý start nejde v horizontu umístit (mutace se
  neodešle).

Resize zůstává **klientsky beze změny** — server je autoritativní pro end už od etapy 2
(inverze `computePrintMinutes`), klient jen odesílá nový čas a server dopočítá zbytek.

`DURATION_OPTIONS` (`src/lib/plannerTypes.ts`) má strop **40 h** (80× 30min krok = 2400 min),
což odpovídá `MAX_PRINT_MINUTES` v `src/lib/printTime.ts` — dropdown proto nikdy nenabídne
hodnotu, kterou by server odmítl.

Mezistavy etapy 4 (drag preview a paste marker kreslily duration-based snap a u bloků
pauznutých přes odstávku lhaly o výsledné pozici/délce) jsou od etapy 5 **VYŘEŠENÉ** —
viz následující sekci.

#### Vykreslení pauz a poctivé náhledy (etapa 5, 2. 7. 2026)

Blok ZAKAZKA, který přes tiskové hodiny pauzne (odstávka / mimo provoz uvnitř intervalu),
se kreslí jako JEDEN div přes celý interval start–end; pauzy uvnitř jsou overlay (ztmavený
„můstek" s přerušovanými vodorovnými okraji a štítkem „⏸ PAUZA — mimo provoz" od 40 px
výšky). Levý accent bar bloku zůstává průběžný — pauza se tak vizuálně odliší od splitu
(split = samostatné bloky s ✂ chipy).

- `getBlockSegments(block, weekShifts, companyDays)` (`src/lib/printTimeClient.ts`) vrací
  `PrintSegment[]` jen když overlay dává smysl: ZAKAZKA, ne bypass, platné `printMinutes`,
  zarovnaný start, expanze uspěje A sedí na uložený `endTime`, a obsahuje aspoň jednu pauzu.
  Jinak `null` → blok se kreslí slitě beze změny (99 % plánu). `TimelineGrid` segmenty
  předpočítává v `useMemo` mapě (`blockSegmentsMap`, O(1) lookup per blok; memo je záměrně
  před early-returnem komponenty — rules-of-hooks).
- Layout mode karty (`MODE_FULL`/`MODE_COMPACT`/`MODE_TINY` + prahy pro datové řádky,
  specifikaci a popis) se u segmentovaného bloku řídí výškou PRVNÍHO print segmentu
  (`contentHeight`), ne celkovou výškou divu — obsah karty nepropadne do vizuální pauzy.
- **Poctivé náhledy** (jen ZAKAZKA + zapnutý zámek pracovní doby, ne bypass blok; při
  selhání expanze fallback na starou naivní geometrii — preview nikdy neblokuje drag):
  - drag ghost: výška z expanze `printMinutes` na kandidátním startu (ne původní výška),
  - resize: live snap endu na hranu tiskového segmentu (`computePrintMinutes` →
    re-expanze; alignment guard vynechá legacy bloky s nezarovnaným startem) + tooltip
    „X h tisku (Y h celkem)" (`dragPreview.resizePrintMinutes`),
  - queue drop preview: start-only snap + výška z expanze místo `durationHours × slot`,
  - paste marker: viz sekce Copy/Paste flow níže.

  Expanze v mousemove smyčce jde přes module-scope cache (`expandPrintTimeCached`, klíč
  `machine|start|pm`), čištěnou při každém mousedown / startu queue dragu.
- **Deadline štítek**: ZAKAZKA, jejíž `endTime` je civilně (Praha) PO datu
  `deadlineExpedice`, dostane červený badge „⚠ PO DEADLINE" (v TINY módu jen „⚠",
  pod TINY nic) v pravém horním rohu; 📝 badge tiskařských poznámek se v tom případě
  odsune níž. Nezávislé na `isOverdue` (ten srovnává konec bloku s `now`).
- **Délky „tisk vs. celkem"**: hover tooltip bloku („Tisk: X h · Celkem: Y h"),
  `BlockDetail` (řádek Délka — „X hod tisku (Y hod celkem)") i `DtpPanel`
  („Tisk X hod · celkem Y hod") zobrazují u ZAKAZKA s `printMinutes ≠ elapsed` obě
  hodnoty; jinak prostou délku. Zdroj: `blockPrintMinutes` z `printTimeClient.ts`.
- **Split**: default bod = `printMidpoint` (polovina TISKOVÝCH minut, ne kalendářní
  střed osy); když degeneruje mimo vnitřek bloku (malé pm po zaokrouhlení na slot),
  fallback na kalendářní střed. Split uvnitř pauzy je zakázán guardem
  (`isMachineRunnableAt`) s toastem „Nelze rozdělit uvnitř pauzy" — jinak by hlava
  commitla PUT a tail POST spadl na 422 až po ní (rozbitý mezistav). Bypass blok dál
  dělí elapsed-based.
- **Rezervace**: `PlanningForm` (`/rezervace`) používá sdílené `DURATION_OPTIONS`
  z `src/lib/plannerTypes.ts` (strop 40 h) místo dřívější vlastní 24h kopie.
- **AUTO_SHIFT audit** (POST `/api/blocks`, PUT `[id]`, batch): `field:
  "startTime/endTime"`, old/new hodnoty jsou span `"<startISO>–<endISO>"` (en-dash) —
  end se při odsunu re-expanduje, takže patří do auditu. `fmtAuditVal`
  (`src/lib/auditFormatters.ts`) má en-dash-aware větev se striktním ISO guardem
  (formátuje jen `"<ISO>–<ISO>"` páry — český free-text s pomlčkou propadá na raw;
  batch UPDATE řádky s machine prefixem se dál renderují surově jako dřív). Pozn.:
  self-shift AUTO_SHIFT řádek v PUT
  (`[id]/route.ts`) zůstává single-ISO (jiná datová cesta) — formatter zvládá oba
  tvary. POST shifted-refetch nově includuje `notes` (parita SSE payloadu s ostatními
  cestami). TODO komentáře k elapsed fallbacku v POST/batch přeformulovány na trvalý
  stav — fallback kryje legacy bloky (pm=null) a přímé API klienty, NELZE ho odstranit.

Zbývající vědomé mezistavy (etapa 7 / nízká priorita, viz i sekci níže):

1. **Smíšené lasso** (ZAKAZKA + ne-ZAKAZKA dohromady) dál používá duration-based skupinový
   snap — vzácný případ.
2. **Série preview** v builderu dál duration-based (kolizní vizuál) — samotné mutace série
   jsou správně (start-only + printMinutes).

#### Kalendářní revalidace (etapa 6, 3. 7. 2026)

Mezistav „drift kalendáře" z etapy 5 (blok, jehož uložený `endTime` po dodatečné změně
pracovní doby / odstávky nesedí na živou expanzi) je od etapy 6 detekován a nabízí opravu —
**bez jakékoli nové DB kolony**: drift se nikdy neukládá, jen počítá za běhu.

- **Detekce**: `blockCalendarDrift` (klient, `printTimeClient.ts`) počítá drift živě pro
  vykreslení; `detectCalendarDrift` (server, `src/lib/calendarDrift.server.ts`) běží jen
  jako vedlejší efekt mutace kalendáře (ne na každý request). Obě strany volají tutéž
  `expandPrintTime` — žádná duplicitní logika. Podmínky shodné na obou stranách: ZAKAZKA,
  ne bypass, `printMinutes > 0`, zarovnaný start, ne `printCompleted`, `endTime > now`.
- **Notifikace**: `notifyCalendarDrift` (`calendarDrift.server.ts`) zapisuje `Notification`
  (`CALENDAR_DRIFT`, targetRole `PLANOVAT`/`ADMIN`) po zápisu, který mohl posunout kalendář —
  `machine-week-shifts` PUT (force i ne-force), `ensureWeekSeeded` (jen po reálném seedu),
  `company-days` POST/PUT/DELETE (+ SSE `schedule:changed`). Nezávislý mechanismus od
  `AuditLog` — detekce samotná nic neupravuje (čisté READ přes `block.findMany` + expanze).
- **Reflow endpointy**: `reflowBlockInTx`/`reflowMachineInTx` (`src/lib/reflow.server.ts`) +
  `POST /api/blocks/[id]/reflow` (jeden blok) a `POST /api/blocks/reflow` (celý stroj,
  okno 365 dní) re-expandují blok a spustí chain push v transakci; zamčené/vytištěné bloky
  se přeskočí, kolize s chain pushem = `AppError` a rollback celé transakce (žádný částečný
  zápis). Audit řádek má action `AUTO_REFLOW` (field `"startTime/endTime"`, en-dash span,
  `fmtAuditVal` ho renderuje stejně jako `AUTO_SHIFT`) — záměrně JINÁ akce než `UPDATE`, aby
  dashboard stability (filtruje `action=UPDATE`) reflow nezapočítával jako nestabilitu.
- **`findConflictingBlocks`** (validace při editaci `machine-week-shifts`, TOCTOU re-check;
  `company-days` mění kalendář bez blokace — jen drift notifikace dle spec 3.9) má nově
  okno `[W, W+7d+6h)` (`computeConflictWindow`/`conflictWindowWhere`/
  `neighborWeekStarts`) a bere v potaz i DB řádky **sousedních týdnů** — stejný „noční směna
  přes půlnoc" vzor, který opravil fix 5c u `loadMachineCalendar`, platil i zde (editace
  týdne W mohla neviditelně rozbít bloky začínající Po 0:00–6:00 týdne W+1).
- **Sticky-bypass split fix**: split bloku typu ZAKAZKA se `scheduleBypassed=true` posílal
  na head `PUT` jen `endTime` (bez `printMinutes`/bypass flagu) → server ho zpětně
  přepočítal PODLE KALENDÁŘE a hlava ztratila tiskový čas, tail `POST` pak spadl na 422 už
  po commitu hlavy (rozbitý mezistav). Oprava: head PUT bypass zdroje posílá i
  `printMinutes` + `bypassScheduleValidation: true` (elapsed-based dělení); ne-bypass split
  beze změny (server dál nezávisle invertuje `printMinutes` z `endTime`).
- Hlavní soubory: `src/lib/calendarDrift.server.ts`, `src/lib/reflow.server.ts`,
  `src/lib/findConflictingBlocks.ts`, `src/lib/printTimeClient.ts` (`blockCalendarDrift`),
  `src/app/api/blocks/[id]/reflow/route.ts`, `src/app/api/blocks/reflow/route.ts`.
- UI: oranžový badge „⚠ KALENDÁŘ" na bloku (stack pořadí deadline > drift > poznámky),
  banner stroje „⚠ N nesedí na kalendář" s tlačítkem Přepočítat (jen `ADMIN`/`PLANOVAT`),
  `BlockDetail` drift sekce s vlastním Přepočítat, `AUTO_REFLOW` render větev v
  `InfoPanel`/`BlockDetail`.
- Žádná migrace DB, žádný nový sloupec — drift je odvozená hodnota, nikdy persistovaná.

#### Reporty přes tiskové hodiny (etapa 7, 4. 7. 2026)

Retro/outlook dashboard (`/api/report/dashboard`) a denní report (`/api/report/daily` +
`ReportView`) do etapy 7 počítaly vytížení/přítomnost bloku ve směně z kalendářní délky
`endTime - startTime`. To u ZAKAZKA bloku pauznutého přes odstávku nadhodnocovalo vytížení
(pauza se počítala jako produkce) a v denním reportu ukazovalo blok i ve směně, kdy stroj
kvůli pauze reálně stál. Etapa 7 přepíná oba reporty na tiskový čas (`printMinutes` a jeho
průnik se směnou/dnem), se stejným fallback-na-span principem jako etapa 5/6 (ne-ZAKAZKA,
bypass, legacy `printMinutes=null`, drift → počítat konzervativně z celého uloženého spanu).
Vědomý důsledek fallbacku: u DRIFTNUTÉHO bloku se v téže dashboard response rozcházejí
totals (pm) a denní řady (span fallback) — designově inherentní (pm bez segmentů nejde
rozdělit do dnů), tranzientní (drift je stav k opravě přes Přepočítat), konzistentní
s plannerem (kreslí slitý span + oranžový badge).

- **`blockReportSegments(block, weekShifts, companyDays)`** (`src/lib/printTimeClient.ts`) —
  sourozenec `getBlockSegments`: sdílí guard+expanzi (`tryExpandForBlock`), ale na rozdíl od
  něj vrací segmenty i pro souvislý blok BEZ pauzy (reporty potřebují průnik tiskového času
  s oknem vždy, ne jen kvůli overlay) a nevyžaduje přítomnost pauzy. `null` = nelze spolehlivě
  expandovat (guard selhal, expanze selhala, nebo drift — expanze nesedí na uložený `endTime`).
- **`printOverlapMinutes(segments, block, winStart, winEnd)`** (`printTimeClient.ts`) — čistá
  intervalová matematika, okno nemusí být zarovnané na sloty. Se segmenty (ne-null) sčítá
  průnik jen `kind: "print"` segmentů s oknem; bez segmentů (`null`) konzervativně počítá
  průnik celého spanu start–end (fallback pro ne-ZAKAZKA/bypass/legacy/drift bloky).
- **Dashboard retro** (`handleRetro`): `computeBlockHours` (celkové hodiny per stroj/typ) i
  denní `dailyUtilization` řada přešly z elapsed na `printMinutes`
  (`blockDurationHours` v `reportMetrics.ts` — ZAKAZKA `pm/60`, jinak elapsed; fallback elapsed
  když `pm` chybí/neplatné). Denní řada navíc sčítá `printOverlapMinutes` přes segmentovou mapu
  (`segMap`, jedna expanze per blok, ne per den — denní smyčka by ji jinak opakovala až 30×).
  `companyDays` se do `handleRetro` nově fetčí (dřív se selectovaly a zahazovaly).
- **Dashboard outlook** (`handleOutlook`): stejný vzor — `plannedHours`/`dailyCapacity` přes
  `blockDurationHours`/`printOverlapMinutes` + `segMap`; `companyDays` nově fetčováno (dřív
  vůbec, protože outlook segmenty předtím neexistovaly). Response tvary (JSON shape) obou
  handlerů beze změny — mění se jen zdroj čísel uvnitř, ne kontrakt.
- **Okno `weekShifts` fetche** v obou handlerech posunuto z `−7d` na `−28d` před `rangeStart`:
  blok protínající rozsah může začínat až `MAX_SPAN_DAYS` (21 d, `printTime.ts`) před ním a
  expanze navíc potřebuje týden PŘED startem bloku (noční prev-tail, stejný vzor jako fix 5c
  u `loadMachineCalendar`). Legacy bloky mimo pokryté okno bezpečně degradují na fallback span.
- **Denní report** (`GET /api/report/daily`): response se mění z pole bloků na
  `{ blocks, weekShifts, companyDays }` (**breaking change** kontraktu; jediný konzument je
  `ReportView`, upraven současně) — kalendář se fetčuje v okně `±28d` kolem výrobního dne
  (stejné zdůvodnění jako u dashboardu). `ReportView.blockPrintsInShift` nahrazuje starý
  `blockOverlapsShift` (span-overlap) — nová verze volá `printOverlapMinutes` a blok se ve
  směně ukáže, jen když se v ní skutečně tiskne (`> 0` min průniku); fallback span pro
  ne-ZAKAZKA/bypass/legacy/drift zůstává zachován přes `segments === null`.
- **Triage položky** (drobné nálezy z review etapy 6, doklizené v rámci etapy 7):
  - `src/lib/machines.ts` — `MACHINES = ["XL_105", "XL_106"] as const` + `MachineId` typ,
    jediný zdroj pravdy pro seznam strojů; nahradilo 5 lokálních kopií `VALID_MACHINES`/
    `MACHINES` v serverových souborech (`company-days` GET/PUT, `machine-week-shifts`,
    `blocks/reflow`, `report/dashboard`).
  - `company-days` POST/PUT nově validují `endDate > startDate` → 400 „Konec odstávky musí
    být po jejím začátku." (dřív šlo uložit odstávku s koncem před začátkem beze protestu).
  - Obě reflow routes (`[id]/reflow`, `reflow`) mapují Prisma `P2028` (transakce vypršela)
    na 503 „Přepočet trval příliš dlouho — zkuste to znovu, případně po menších částech."
    místo generické 500.
  - `ReflowDeps.preloadedCalendar` (`reflow.server.ts`) — `reflowMachineInTx` načte kalendář
    stroje JEDNOU pro celé okno (`now−1d` až `now + (365+7+21) dní`) a předá ho každému
    dílčímu `reflowBlockInTx` voláním místo aby si každý driftnutý blok tahal vlastní
    kalendář zvlášť (výkon: 1 fetch místo N). Test `reflow.server.test.ts` pinuje přesné
    hranice okna detekce driftu (`[now, now + MACHINE_REFLOW_WINDOW_DAYS d)`, konstanta 365)
    proti tiché budoucí změně.
  - TOCTOU DRY: `assertNoConflictingBlocks`/`fetchConflictingBlocks` (obě nové,
    `findConflictingBlocks.ts`) sdílí jádro (fetch + `detectConflictsPure`) mezi pre-transakční
    `findConflictingBlocks` (info toast před force save) a in-transaction re-check v
    `machine-week-shifts` PUT — dřív měl PUT vlastní duplicitní inline re-check, který mohl
    nezávisle rozjet tvar `where`/validačních řádků oproti `findConflictingBlocks`.
  - `BlockDetail` drift sekce má `DRIFT_TITLES` mapu podle `CalendarDriftInfo["reason"]`
    (`END_MISMATCH`/`START_NOT_RUNNABLE`/`HORIZON_EXCEEDED`) místo jednoho fixního nadpisu
    pro všechny tři případy, které `blockCalendarDrift`/`detectCalendarDrift` mohou vrátit.
- Hlavní soubory: `src/lib/reportMetrics.ts` (`blockDurationHours`), `src/lib/printTimeClient.ts`
  (`blockReportSegments`, `printOverlapMinutes`), `src/lib/machines.ts`,
  `src/app/api/report/dashboard/route.ts`, `src/app/api/report/daily/route.ts`,
  `src/app/report/daily/ReportView.tsx`.

Vědomě odloženo (rozhodnutí, ne opomenutí — mimo scope etapy 7):

- **Stale klientský pm** (systémové riziko drag/resize/paste s neaktuálním `printMinutes` v
  klientském stavu) — vyžaduje vlastní návrh, zaznamenáno v ledgeru etapy 6.
- **Rate limit reflow endpointů** — konzistentní s ostatními mutacemi bloků (žádná z nich
  rate limit nemá).
- **Banner driftu vs. viditelné okno** — kosmetika, self-heal přes existující polling.
- **M-A seed atribuce** — detail nálezu se nedochoval v ledgeru; prověřit při finále featury
  (etapa 8).
- **Fixní směnové sekce denního reportu** (`SHIFTS_105` bez noční, `SHIFTS_106` s noční vždy)
  — pre-existující vzhled reportu, spec 3.10 ho nemění; segmentový filtr jen zajišťuje, že
  v prázdné/stojící směně blok nebude.
- **Retro/outlook TOTALS neklipují k rozsahu** (blok přesahující hranici rozsahu se počítá
  celý, ne jen jeho část uvnitř) — pre-existující sémantika, etapa 7 mění jen zdroj délky
  (`printMinutes` místo elapsed), ne klipovací chování; denní řady (`dailyUtilization`/
  `dailyCapacity`) klip řeší už teď přes `printOverlapMinutes`.

#### Finále featury (etapa 8, 5. 7. 2026)

Multi-agent review celé featury (5 nezávislých lens: datová integrita, transakce/souběh,
klient, security, spec compliance) — 0 Critical; všechny Important nálezy opraveny ve fix
wave a nezávisle verifikovány. Gardena 27h scénář dokázán sondou na dev DB (stará cesta
teleport až +5,3 dne, nová drží start a pauzne; Σ tisku přesně 27,0 h).

- **Série z fronty bez tichého skipu** (spec 3.11): children smyčka v `handleQueueDrop`
  posílá `autoShiftIfBusy: true`, sbírá selhání a hlásí souhrnný toast — zrcadlí
  `handleScheduleSeries` (ta byla opravená už 30. 4.).
- **Split s kompenzací**: tail POST nese `resolveChain: true`; při selhání tailu po commitu
  hlavy se hlava kompenzačně vrací (LIFO: endTime/printMinutes/splitGroupId) s error
  toastem — žádná tichá ztráta tiskového času. Serverový atomický split endpoint = vědomý
  v2 backlog.
- **Security fixy**: PUT `[id]` čte `printMinutes` z role-filtrovaného `allowed` (ne ze
  syrového body — DTP/MTZ nemůže vyvolat přepočet endu); tiskařské poznámky (`notes`) se
  gate-ují přes `canAccessBlockNotes` i v PUT/POST/batch/reflow refetchech a SSE broadcast
  je per-connection stripuje neoprávněným rolím (bez mutace sdíleného payloadu); GET
  machine-week-shifts seed větev má rate limit (120/min); hromadný reflow má per-stroj
  in-flight guard (409 při souběhu); daily report TISKAR bez `assignedMachine` → 403.
- **Drobné**: `handleSSEReconnect` merguje s `editingBlockIdsRef` guardem (fresh je
  autoritativní — smazané mizí); denní report sloupec Délka ukazuje „tisk (celkem)";
  legacy pm fallback v chain pushi zarovnán na 30 min; `ensureWeekSeeded` seed+detekce+
  notifikace v jedné tx; auto-seed notifikace atribuovaná „systém (auto-seed)";
  `block:batch-updated` SSE filtr pro TISKAR čte `payload.blocks`.
- **Známé limity (vědomé)**: rate-limitery a in-flight guard jsou module-scope =
  per-instance (OK pro single-instance produkci); TOCTOU re-check week-shifts nebere
  FOR UPDATE na blocích (extrémní souběh admin editace × insert bloku — chytí drift
  detekce/Přepočítat); driftMap `now` je snapshot per render.
- Deploy: `docs/superpowers/plans/2026-07-05-tiskove-hodiny-deploy-checklist.md`
  (vč. `connection_limit` v produkční `DATABASE_URL`).

#### 4 body z auditu plánovače (9. 7. 2026)

Čtyři schválené body z auditu e-mailu plánovače (spec `docs/superpowers/specs/2026-07-09-planovac-4-body-design.md`). Čistě klientské změny, žádná změna DB ani API routes; multi-agent review (3 lens) + fix wave, 0 Critical.

- **Pásy směn na pozadí** (per stroj podle skutečného provozu): dayshade smyčka
  (uvnitř `visibleMachines.map`) volá `resolveDayIntervals(machine, d.dateStr,
  machineWeekShifts)` a kreslí pás jen tam, kde daný stroj v daném čase reálně
  tiskne — odpolední `tl-afternoon` (tmavší), noční `tl-night` (nejtmavší); ranní je
  v CSS transparentní (= base), proto se nekreslí. XL_105 bez noční směny nemá noční
  pás; noc navazuje přes půlnoc přes `prev-tail` interval, takže na hranici dne ani
  víkendu nevzniká „schod". Odstávku překryje červený overlay navrch. `tl-day-alt`
  (střídání dnů) kryje jen provozní část 6–22 — přes noc by dělal půlnoční schod.
- **MODE_MICRO_TEXT**: nový výškový mód bloku 14–23 px pro odzoomovaný nadhled.
  Sdílí render s MODE_TINY (`(MODE_TINY || MODE_MICRO_TEXT)`) — jednořádkový layout
  `[D chip][M chip][E chip] · číslo · popis`, chipy dodání dat/materiálu/expedice mají
  přednost, popis se uřízne elipsou. Půlhodinový blok v nadhledu (zoom <24, kde height
  bloku klesne pod práh MODE_TINY 24 px) tak neztratí D/M/E chipy. (Původní verze bodu
  15 ukazovala v tomto pásmu jen popis bez chipů — opraveno 10. 7. 2026.)
- **Σ čas split skupiny**: `splitGroupTotalPrintMinutes` + `formatPrintHoursShort`
  (`printTimeClient.ts`, testy) — chip `✂2/5 · 27h` na bloku, tooltip řádek
  „Skupina: Σ 27 h (5 částí)", BlockEdit hlavička „· celkem 27h tisku" a BlockDetail
  řádek Skupina. Tiskové minuty (`blockPrintMinutes`), fallback elapsed u legacy.
  **Resize split části**: resize tooltip má navíc segment `✂ skupina Σ Xh` — živě
  přepočítaný celek skupiny = ostatní části (beze změny) + tato část v nové délce
  (honest `resizePrintMinutes`, fallback délka tažení u bypass/bez zámku). Uživatel
  při tažení vidí, o kolik se mění CELÁ zakázka, ne jen ta jedna část.
- **Cut = přesun (bod 17, oprava ztráty split skupiny)**: Ctrl+X → Ctrl+V už NEmaže
  a NEvytváří blok — single cut jde přes PUT `/api/blocks/[id]` (stejná cesta jako
  drag, `handleBlockUpdate(updated, true)` → move-undo), skupinový cut přes
  `handleMultiBlockUpdate` (batch, undo „Hromadný přesun"). Zachová se `splitGroupId`,
  historie auditu, vazba na rezervaci i tiskařské poznámky. Guardy: zamčený/vytištěný
  blok nelze vyjmout (Ctrl+X) ani přesunout (TOCTOU re-check při Ctrl+V přes čerstvý
  `blocksRef`); single cut čte `printMinutes` z čerstvého bloku (ne clipboard
  snapshotu); in-flight guard `cutMoveInFlightRef` proti double-paste; selhání batche
  ponechá clipboard pro retry (`handleMultiBlockUpdate` vrací boolean). Ctrl+C kopie
  beze změny — kopie záměrně NEdědí split skupinu.

### Audit log — každá mutace v transakci

Každá operace, která mění data viditelná uživateli, musí zapsat do `AuditLog` v rámci `$transaction`:

```typescript
await prisma.$transaction([
  prisma.block.update({ ... }),
  prisma.auditLog.create({ data: { action: "UPDATE", field: "startTime", ... } }),
]);
```

Bez transakce hrozí nekonzistentní stav (data změněna, audit nezapsán nebo naopak).

### Nové UI komponenty — do `src/components/`, ne inline

Každá standalone UI komponenta patří do `src/components/` jako named export:

```typescript
// src/components/MojeKomponenta.tsx
export function MojeKomponenta({ ... }: Props) { ... }
```

Do `PlannerPage.tsx` ani jiných velkých souborů nepsat nové komponenty inline — soubor byl záměrně dekomponován.

### Mouse eventy na blocích — vždy kontrolovat `e.button`

Drag, resize a jiné mouse-down handlery musí začínat:

```typescript
if (e.button !== 0) return; // jen levé tlačítko spouští drag
```

Bez tohoto checku pravý klik (button 2) spouští drag a interferuje s context menu.

### ENV variables — žádné fallbacky pro bezpečnostní hodnoty

```typescript
// ✅ správně — selže rychle a hlasitě
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("[auth] JWT_SECRET is not set");

// ❌ špatně — tiché selhání v produkci
const secret = process.env.JWT_SECRET ?? "dev-secret";
```

Bezpečnostní ENV proměnné (`JWT_SECRET`) nesmí mít fallback. Ostatní (feature flags, timeouty) fallback mít mohou.

---

## Aktuální technické poznámky

- Next.js 16 při buildu hlásí deprekační warning na `src/middleware.ts`; budoucí rename na `proxy` je otevřený cleanup
- ESLint warningy jsou hlavně:
  - použití `<img>`
  - jeden `react-hooks/exhaustive-deps`
  - anchor místo `next/link`
  - anonymní default exporty v config souborech

## Klíčové soubory

### Entry pointy

- `src/app/page.tsx`
- `src/app/rezervace/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/report/daily/page.tsx`

### Sdílené utility a typy

- `src/lib/errors.ts` — `AppError`, `isAppError`, `AppErrorCode`, `errorStatus` (kanonická mapa kód→HTTP status, audit #80) — použít v každé API route
- `src/lib/authz.ts` — `assertRole` (čisté jádro role-checku) + `requireRole` wrapper v `src/lib/auth.ts` — auth gate pro nové API routes (audit #81)
- `src/lib/blockPayload.ts` — `blockToCreatePayload`/`EXPECTED_PAYLOAD_KEYS` — jediný zdroj pravdy pro Block→POST payload (undo/paste/group paste; audit #2 — dřív 4 divergentní kopie, undo/paste ztrácely pantone/SKLADEM); tripwire test hlídá úplnost polí
- `src/lib/blockStyles.ts` — `BLOCK_STYLES`/`BLOCK_OVERDUE`/`BLOCK_PRINT_DONE`/`getBlockStyleKey`/`tint` — vizuální identita bloků (audit #14; sdílí TimelineGrid i blockShades, zrcadlo `shadeBucket` zrušeno)
- `src/lib/logger.ts` — `logger.info/warn/error` — použít místo console v API routes
- `src/lib/scheduleValidationServer.ts` — `validateAndComputeEnd` — validuje ZAKAZKA blok a vrací autoritativní end + `effectivelyBypassed` (spočítaná pravda pro `scheduleBypassed`, nikdy echo request flagu; jediný zdroj pravdy pro endTime; nahrazuje zrušenou `validateBlockScheduleFromDb`)
- `src/lib/printTime.ts` — `expandPrintTime`/`computePrintMinutes`/`isMachineRunnableAt` — jádro „tiskových hodin" (čisté funkce, žádná DB)
- `src/lib/printTime.server.ts` — `loadMachineCalendar`/`expandPrintTimeFromDb` — DB fetch (weekShifts + companyDays) a napojení na `printTime.ts`
- `src/lib/printTimeClient.ts` — `blockPrintMinutes`/`companyDayIntervalsFor`/`snapGroupDeltaStartOnly`/`getBlockSegments`/`printMidpoint`/`blockCalendarDrift`/`blockReportSegments`/`printOverlapMinutes` — klient-safe helpery (žádná DB) pro mutační cesty, vykreslení a reporting ZAKAZKA bloků; start-only snap přes `snapStartToNextRunnableSlot`, end vždy dopočítá server; `getBlockSegments` vrací print/pause segmenty pro overlay pauz (null = kreslit slitě), `printMidpoint` = bod poloviny tiskových minut (default split), `blockCalendarDrift` = živá detekce driftu pro badge (parita se serverovou `detectCalendarDrift`), `blockReportSegments` = segmenty i pro souvislý blok bez pauzy (reporty, etapa 7), `printOverlapMinutes` = tiskové minuty bloku uvnitř libovolného okna (den/směna)
- `src/lib/reportMetrics.ts` — `blockDurationHours`/`computeBlockHours`/`computeUtilization`/`computeAvailableHours`/`computePlanStability`/... — čisté metriky pro `/api/report/dashboard`; `blockDurationHours` (etapa 7) je ZAKAZKA `printMinutes/60` s fallbackem na elapsed, jinak elapsed
- `src/lib/machines.ts` — `MACHINES` + `MachineId` + `MACHINE_LABELS`/`machineLabel` — jediný zdroj pravdy pro seznam i zobrazované labely strojů (etapa 7 + audit #25/#46/#77)
- `src/lib/timeSlots.ts` — `SLOT_MINUTES`/`SLOT_MS`/`DAY_SLOT_COUNT`/`slotFromHourBoundary` — konstanty 30min gridu; `SLOT_MS` je definovaný JEN tady (audit #90), `printTime.ts` ho re-exportuje
- `src/lib/zLayers.ts` — `Z_TIMELINE`/`Z_LAYOUT`/`Z_OVERLAY` — kanonická z-index škála (audit #21/#95, fáze D): pojmenované vrstvy místo magických čísel ve třech rovinách (uvnitř timeline gridu / řadové panely / body-level překryvy přes portál/fixed); `Z_OVERLAY` je striktně rostoucí (na pořadí záleží — popover nad panelem, dialog nad vším), monotonii hlídá `zLayers.test.ts`. Karta-interní mikro-vrstvy (2–4) zůstávají lokální literály
- `src/lib/calendarDrift.server.ts` — `detectCalendarDrift`/`notifyCalendarDrift` — serverová detekce driftnutých bloků (čisté READ, nic neupravuje) + zápis `Notification` typu `CALENDAR_DRIFT` po mutaci kalendáře
- `src/lib/reflow.server.ts` — `reflowBlockInTx`/`reflowMachineInTx` — přepočet (re-expanze + chain push) jednoho bloku nebo celého stroje v transakci, audit action `AUTO_REFLOW`; `ReflowDeps.preloadedCalendar` (etapa 7) — 1 kalendář pro celý hromadný reflow místo N per-blok fetchů
- `src/lib/findConflictingBlocks.ts` — `findConflictingBlocks` (pre-transakční) / `assertNoConflictingBlocks` (in-tx TOCTOU re-check) — sdílí jádro `fetchConflictingBlocks` (etapa 7 DRY), okno `[W, W+7d+6h)` přes `computeConflictWindow`/`neighborWeekStarts`
- `src/lib/plannerTypes.ts` — `TYPE_LABELS`, `TYPE_BUILDER_CONFIG`, `CodebookOption`, `DURATION_OPTIONS`
- `src/lib/auditFormatters.ts` — `FIELD_LABELS`, `fmtAuditVal` (umí i en-dash span `"ISO–ISO"` z AUTO_SHIFT/batch auditních řádků), `formatPragueMaybeToday`
- `src/lib/weekShiftsTestFixtures.ts` — test-only fixtury pracovní doby (`mkDay`, `xl106Week`, ...), sdílené mezi `*.test.ts` soubory validace harmonogramu
- `src/lib/notifications.ts` — `countUnread`/`countNewSince`/`totalBadge` — čisté funkce pro badge počty (notifikační refaktor mimo etapu, commit `dtp` 3. 7. 2026)

### Planner — komponenty

- `src/app/_components/PlannerPage.tsx` — hlavní orchestrátor (~3525 řádků po dekomposici)
- `src/app/_components/TimelineGrid.tsx` — vizuální grid s drag & drop
- `src/components/ZoomSlider.tsx` — custom zoom slider
- `src/components/InfoPanel.tsx` — audit log panel + typ `AuditLogEntry`; nově exportuje i `AuditList` (samotný seznam bez wrapperu — sdílí se s `NotificationsPanel`)
- `src/components/InboxPanel.tsx` — notifikační inbox + typ `NotificationItem`; nově exportuje i `InboxList` (samotný seznam bez wrapperu — sdílí se s `NotificationsPanel`)
- `src/hooks/useNotifications.ts` — hook sdružující fetch/state pro notifikace i audit (role-gated přes `INBOX_ROLES`/`AUDIT_ROLES`, 60s polling), počítá badge přes `src/lib/notifications.ts`
- `src/components/NotificationBell.tsx` — jeden sloučený zvonek v headeru (nahradil dřívější dvě oddělené ikony inboxu a auditu)
- `src/components/NotificationsPanel.tsx` — panel otevíraný zvonkem, taby „Upozornění" (`InboxList`) / „Aktivita" (`AuditList`)
- `src/components/BlockDetail.tsx` — read-only detail bloku s historií; od etapy 6 i drift sekce (`DRIFT_TITLES` + tlačítko Přepočítat)
- `src/components/BlockEdit.tsx` — editační formulář bloku
- `src/components/ToastContainer.tsx` — toast notifikace
- `src/components/ConfirmDialog.tsx` — sdílený potvrzovací modál (audit #3/#34/#48/#64, fáze D): tokeny, z-index z `Z_OVERLAY.modal`, zavření přes Esc i klik mimo, autofocus na potvrzení, `children` pro doménový obsah (např. důvod zamítnutí rezervace u smazání bloku); nahradil 2 ručně kopírované delete dialogy v PlannerPage

### Planner — logika

- `src/lib/workingTime.ts`
- `src/lib/scheduleValidation.ts`
- `src/lib/pasteTarget.ts` — `computePasteTargetFromBlock` / `computePasteTargetFromGroup`, výchozí pozice paste targetu
- `src/lib/clipboardCopy.ts` — `copyTextToClipboard(text)` — defenzivní helper pro kopii do systémové schránky; nejdřív zkusí `navigator.clipboard.writeText`, při chybě (HTTP / non-secure context) spadne na legacy `document.execCommand('copy')`. Vrací `Promise<boolean>` (true = úspěch). **Použít všude místo přímého volání `navigator.clipboard.*`** — produkční server běží přes HTTP a přímé volání crashne UI.

### Copy/Paste flow (aktualizováno 2. 7. 2026 — etapa 4 tiskových hodin)

- Ctrl+C / Ctrl+X / right-click → Kopírovat **automaticky nastavují pasteTarget** na pozici za zdrojovým blokem (helper `src/lib/pasteTarget.ts`). Ctrl+V tak funguje hned, bez nutnosti klikat do prázdného gridu.
- Skutečné vložení (`handlePasteWithTarget`/`handleGroupPasteWithTarget` v `PlannerPage.tsx`): pro ZAKAZKA blok se start snapuje **jen podle `snapStartToNextRunnableSlot`** (start-only, tiskové hodiny) a payload nese `printMinutes` (`blockPrintMinutes`) — end dopočítá server. Ne-ZAKAZKA bloky beze změny používají duration-based `snapToNextValidStartWithTemplates`.
- Vizuální marker pasteTargetu se kreslí v `TimelineGrid` jako přerušovaná modrá čára „⎘ Sem (Ctrl+V)" ve sloupci cílového stroje. Od etapy 5 je marker poctivý: pro ZAKAZKA zdroj (single i celá skupina — prop `pasteSourceIsZakazka`) snapuje start přes `snapStartToNextRunnableSlot` (tiskové hodiny), tedy stejnou cestou jako skutečný paste; pro ne-ZAKAZKA/smíšenou skupinu zůstává duration-based snap přes `pasteSlotDurationMs` (pro ZAKAZKA zdroje počítaný z `blockPrintMinutes`, ne elapsed).
- Pravý klik na prázdný grid nabízí „⎘ Vložit zde" — kompletně mouse-only workflow.
- Esc čistí: multi-select, copiedBlock, isCut, pasteTarget, clipboardGroupRef.
- SSE `block:deleted` vyčistí copiedBlock/clipboardGroupRef/selectedBlockIds pokud obsahují smazaný blok (prevence „fantom paste" se starou referencí).
- Ctrl+C/X bez výběru → info-toast „Žádný blok není vybrán" místo silent no-op.
- Keydown handler je bindovaný **jednou** na mount (`useEffect([])`); hodnotu `selectedBlock` čte přes `selectedBlockRef.current`. Tím odpadlo re-binding při SSE updatech a 5min pollingu.
- `handlePaste` a `handleGroupPaste` jsou guard wrappery; business logika je v `handlePasteWithTarget(target)` / `handleGroupPasteWithTarget(target)` — target přijímají explicitně, sdílí se mezi Ctrl+V a right-click paste.

### Rezervace

- `src/app/rezervace/_components/RezervacePage.tsx`
- `src/app/api/reservations/route.ts`
- `src/app/api/reservations/[id]/route.ts`
- `src/app/api/reservations/[id]/attachments/route.ts`
- `src/app/api/reservations/[id]/attachments/[attachmentId]/route.ts`

### Admin a konfigurace

- `src/app/admin/_components/AdminDashboard.tsx`
- `src/components/job-presets/JobPresetEditor.tsx`
- `src/app/api/job-presets/route.ts`
- `src/app/api/machine-week-shifts/route.ts`
- `src/components/admin/MachineWorkHoursWeek.tsx`
- `src/components/admin/ShiftRoster.tsx`

### Auth

- `src/lib/auth.ts`
- `src/middleware.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`

## Dokumenty v repu

- `README.md` – rychlý start
- `DOKUMENTACE.md` – lidská projektová dokumentace
- `DATABAZE_DOKUMENTACE.md` – DB model a provoz

## Produkční DB — známé odchylky od migrací

Produkční databáze `igvyroba` měla historicky některé sloupce vytvořené ručně před zavedením Prisma migrací. Tyto odchylky byly opraveny 12. 4. 2026:

| Tabulka | Sloupec | Bylo | Správně |
| --- | --- | --- | --- |
| `AuditLog` | `action` | `varchar(16)` | `varchar(191)` |
| `Block` | `doprava` | chyběl | `varchar(191) NULL` |
| `Block` | `expediceNote` | chyběl | `varchar(191) NULL` |

Pokud deploy hlásí `P2022` (sloupec neexistuje) nebo `P2000` (hodnota příliš dlouhá) — první krok je ověřit skutečný typ sloupce v DB:

```bash
mysql -u root -pmysql igvyroba -e "SHOW COLUMNS FROM <Tabulka>;"
```

