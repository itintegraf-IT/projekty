# CLAUDE.md — Repo Truth

Aktualizováno podle stavu repozitáře k 3. 7. 2026.

Tento soubor slouží jako stručný, praktický snapshot projektu pro AI asistenty. Pokud se aplikace změní, aktualizuj nejdřív tento soubor a až potom navazující dokumentaci.

## Ověřený stav

- `git status --short` je čistý
- `npm run build` prošel
- `npm run lint` vrací warningy, ale 0 chyb
- celá test suite: **212/212 testů zelené** (viz níže)
- aktivní datasource v `prisma/schema.prisma` je `mysql`
- modul `/expedice` je nasazen na produkci (deploy 12. 4. 2026)
- audit remediation dokončen 15.–16. 4. 2026 (Sprinty 1–5)
- copy/paste UX fix dokončen 27. 5. 2026 (5 Tasků, plán `docs/superpowers/plans/2026-05-27-copy-paste-ux-fix.md`)
- clipboard text-copy fix (HTTP secure-context) 27. 5. 2026 (helper `src/lib/clipboardCopy.ts`)
- tiskové hodiny — etapa 4 (klientské mutační cesty + 40h dropdown) dokončena 2. 7. 2026 — viz sekci „Klientské mutační cesty" níže
- tiskové hodiny — etapa 5 (vykreslení pauz + poctivé náhledy + deadline štítek + rezervace 40 h) dokončena 2. 7. 2026 — viz sekci „Vykreslení pauz a poctivé náhledy" níže
- tiskové hodiny — etapa 6 (kalendářní revalidace: drift detekce, notifikace, reflow endpointy, sticky-bypass split fix) dokončena 3. 7. 2026 — viz sekci „Kalendářní revalidace" níže

### Spuštění testů

```bash
node --test --import tsx src/lib/dateUtils.test.ts             # 8 testů
node --test --import tsx src/lib/errors.test.ts                # 5 testů
node --test --import tsx src/lib/pasteTarget.test.ts           # 6 testů
node --test --import tsx src/lib/clipboardCopy.test.ts         # 6 testů
node --test --import tsx src/lib/printTime.test.ts             # 22 testů
node --test --import tsx src/lib/printTime.server.test.ts      # 7 testů
node --test --import tsx src/lib/scheduleValidationServer.test.ts  # 12 testů
node --test --import tsx src/lib/overlapCheck.test.ts          # 13 testů
node --test --import tsx src/lib/overlapResolver.test.ts       # 13 testů
node --test --import tsx src/lib/overlapResolver.server.test.ts    # 7 testů
node --test --import tsx src/lib/scheduleSlotFinder.test.ts    # 13 testů
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleSlotFinder.server.test.ts  # 8 testů
node --test --import tsx src/lib/printTimeClient.test.ts      # 22 testů
node --test --import tsx src/lib/calendarDrift.server.test.ts      # 8 testů
node --test --import tsx src/lib/findConflictingBlocks.test.ts     # 11 testů
node --test --import tsx src/lib/reflow.server.test.ts             # 20 testů
node --test --import tsx src/lib/reportMetrics.test.ts             # 31 testů
```

Celkem **212 testů** v 17 souborech.

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

- v kódu existuje stránka `src/app/tiskar/page.tsx`
- aktuální middleware ale vede tiskaře primárně přes `/`
- pokud někdo řeší tiskařský režim, nejdřív zkontroluj `src/middleware.ts` a `src/app/page.tsx`

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

Repo-truth k pracovní době:

- runtime planneru pracuje s `MachineWeekShifts` (per-týden grid, flag-only model: morningOn/afternoonOn/nightOn + isActive derivované)
- fixní časy směn: MORNING 6–14, AFTERNOON 14–22, NIGHT 22–6 (viz `src/lib/shifts.ts`)
- původní modely `MachineWorkHoursTemplate`, `MachineWorkHoursTemplateDay` a `MachineScheduleException` byly zrušeny ve Sprintu E (2026-04-19) — data migrována přes `scripts/migrate-to-week-shifts.ts`
- tabulka `MachineWorkHours` v projektu zůstává kvůli bootstrapu a kompatibilitě starších dat

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

V catch bloku API route:
```typescript
} catch (err) {
  if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
  logger.error("[route] neočekávaná chyba", err);
  return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
}
```

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
- **`findConflictingBlocks`** (validace při editaci `machine-week-shifts`/`company-days`,
  TOCTOU re-check) má nově okno `[W, W+7d+6h)` (`computeConflictWindow`/`conflictWindowWhere`/
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

- `src/lib/errors.ts` — `AppError`, `isAppError`, `AppErrorCode` — použít v každé API route
- `src/lib/logger.ts` — `logger.info/warn/error` — použít místo console v API routes
- `src/lib/scheduleValidationServer.ts` — `validateAndComputeEnd` — validuje ZAKAZKA blok a vrací autoritativní end + `effectivelyBypassed` (spočítaná pravda pro `scheduleBypassed`, nikdy echo request flagu; jediný zdroj pravdy pro endTime; nahrazuje zrušenou `validateBlockScheduleFromDb`)
- `src/lib/printTime.ts` — `expandPrintTime`/`computePrintMinutes`/`isMachineRunnableAt` — jádro „tiskových hodin" (čisté funkce, žádná DB)
- `src/lib/printTime.server.ts` — `loadMachineCalendar`/`expandPrintTimeFromDb` — DB fetch (weekShifts + companyDays) a napojení na `printTime.ts`
- `src/lib/printTimeClient.ts` — `blockPrintMinutes`/`companyDayIntervalsFor`/`snapGroupDeltaStartOnly`/`getBlockSegments`/`printMidpoint`/`blockCalendarDrift` — klient-safe helpery (žádná DB) pro mutační cesty a vykreslení ZAKAZKA bloků; start-only snap přes `snapStartToNextRunnableSlot`, end vždy dopočítá server; `getBlockSegments` vrací print/pause segmenty pro overlay pauz (null = kreslit slitě), `printMidpoint` = bod poloviny tiskových minut (default split), `blockCalendarDrift` = živá detekce driftu pro badge (parita se serverovou `detectCalendarDrift`)
- `src/lib/calendarDrift.server.ts` — `detectCalendarDrift`/`notifyCalendarDrift` — serverová detekce driftnutých bloků (čisté READ, nic neupravuje) + zápis `Notification` typu `CALENDAR_DRIFT` po mutaci kalendáře
- `src/lib/reflow.server.ts` — `reflowBlockInTx`/`reflowMachineInTx` — přepočet (re-expanze + chain push) jednoho bloku nebo celého stroje v transakci, audit action `AUTO_REFLOW`
- `src/lib/plannerTypes.ts` — `TYPE_LABELS`, `TYPE_BUILDER_CONFIG`, `CodebookOption`, `DURATION_OPTIONS`
- `src/lib/auditFormatters.ts` — `FIELD_LABELS`, `fmtAuditVal` (umí i en-dash span `"ISO–ISO"` z AUTO_SHIFT/batch auditních řádků), `formatPragueMaybeToday`
- `src/lib/weekShiftsTestFixtures.ts` — test-only fixtury pracovní doby (`mkDay`, `xl106Week`, ...), sdílené mezi `*.test.ts` soubory validace harmonogramu

### Planner — komponenty

- `src/app/_components/PlannerPage.tsx` — hlavní orchestrátor (~3525 řádků po dekomposici)
- `src/app/_components/TimelineGrid.tsx` — vizuální grid s drag & drop
- `src/components/ZoomSlider.tsx` — custom zoom slider
- `src/components/InfoPanel.tsx` — audit log panel + typ `AuditLogEntry`
- `src/components/InboxPanel.tsx` — notifikační inbox + typ `NotificationItem`
- `src/components/BlockDetail.tsx` — read-only detail bloku s historií
- `src/components/BlockEdit.tsx` — editační formulář bloku
- `src/components/ToastContainer.tsx` — toast notifikace

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

