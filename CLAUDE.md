# CLAUDE.md — Repo Truth

Aktualizováno podle stavu repozitáře k 16. 4. 2026.

Tento soubor slouží jako stručný, praktický snapshot projektu pro AI asistenty. Pokud se aplikace změní, aktualizuj nejdřív tento soubor a až potom navazující dokumentaci.

## Ověřený stav

- `git status --short` je čistý
- `npm run build` prošel
- `npm run lint` vrací warningy, ale 0 chyb
- celá test suite: **24/24 testů zelené** (viz níže)
- aktivní datasource v `prisma/schema.prisma` je `mysql`
- modul `/expedice` je nasazen na produkci (deploy 12. 4. 2026)
- audit remediation dokončen 15.–16. 4. 2026 (Sprinty 1–5)

### Spuštění testů

```bash
node --test --import tsx src/lib/dateUtils.test.ts             # 8 testů
node --test --import tsx src/lib/errors.test.ts                # 5 testů
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts  # 11 testů
```

Pozor: `scheduleValidationServer.test.ts` vyžaduje flag `--experimental-test-module-mocks` (používá `mock.module()` pro mock Prismy). Bez něj selže s `mock.module is not a function`.

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

### Validace harmonogramu — vždy `validateBlockScheduleFromDb`

Kdykoliv API route přijímá `startTime`/`endTime` bloku typu ZAKAZKA, musí volat:

```typescript
import { validateBlockScheduleFromDb } from "@/lib/scheduleValidationServer";

const err = await validateBlockScheduleFromDb(machine, start, end, type, bypassFlag);
if (err) return NextResponse.json(err, { status: 409 });
```

Nikdy neduplikovat tuto logiku — `scheduleValidationServer.ts` je jediný zdroj pravdy pro serverovou validaci harmonogramu. Platí pro POST `/api/blocks`, PUT `/api/blocks/[id]` a POST `/api/blocks/batch`.

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
- `src/lib/scheduleValidationServer.ts` — `validateBlockScheduleFromDb` — serverová validace harmonogramu
- `src/lib/plannerTypes.ts` — `TYPE_LABELS`, `TYPE_BUILDER_CONFIG`, `CodebookOption`, `DURATION_OPTIONS`
- `src/lib/auditFormatters.ts` — `FIELD_LABELS`, `fmtAuditVal`, `formatPragueMaybeToday`

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

