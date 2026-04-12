# CLAUDE.md — Repo Truth

Aktualizováno podle stavu repozitáře k 12. 4. 2026.

Tento soubor slouží jako stručný, praktický snapshot projektu pro AI asistenty. Pokud se aplikace změní, aktualizuj nejdřív tento soubor a až potom navazující dokumentaci.

## Ověřený stav

- `git status --short` je čistý
- `npm run build` prošel
- `npm run lint` vrací warningy, ale 0 chyb
- `node --test --import tsx src/lib/dateUtils.test.ts` prošel 6/6 testů
- aktivní datasource v `prisma/schema.prisma` je `mysql`
- modul `/expedice` je nasazen na produkci (deploy 12. 4. 2026)

## Co aplikace dnes umí

### 1. Planner

- hlavní planner běží na `/`
- timeline pro stroje `XL_105` a `XL_106`
- drag & drop z fronty, resize, split zakázek, batch přesuny, copy/paste
- provozní hodiny přes šablony a výjimky
- odstávky přes `CompanyDay` a `MachineScheduleException`
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
- `MachineWorkHoursTemplate`
- `MachineWorkHoursTemplateDay`
- `MachineScheduleException`
- `User`
- `AuditLog`

Repo-truth k pracovní době:

- runtime planneru pracuje hlavně s `MachineWorkHoursTemplate`, `MachineWorkHoursTemplateDay` a `MachineScheduleException`
- starší tabulka `MachineWorkHours` v projektu zůstává kvůli bootstrapu a kompatibilitě starších dat

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
| `MachineWorkHoursTemplate` | `days` | `MachineWorkHoursTemplateDay[]` |
| `MachineWorkHoursTemplateDay` | `template` | `MachineWorkHoursTemplate` |
| `Reservation` | `blocks` | `Block[]` |
| `Reservation` | `attachments` | `ReservationAttachment[]` |
| `ReservationAttachment` | `reservation` | `Reservation` |

Pokud Prisma VS Code extension po uložení přepíše tato pole na `Block`, `ReservationAttachment`, `Reservation`, `MachineWorkHoursTemplateDay` — je to chyba formátovače. Vrátit zpět na výše uvedené názvy.

Po každé změně schématu spustit `npm run build` lokálně před pushem — build zachytí TypeScript chyby dřív než server.

## Aktuální technické poznámky

- Next.js 16 při buildu hlásí deprekační warning na `src/middleware.ts`; budoucí rename na `proxy` je otevřený cleanup
- ESLint warningy jsou hlavně:
  - použití `<img>`
  - jeden `react-hooks/exhaustive-deps`
  - anchor místo `next/link`
  - anonymní default exporty v config souborech
- testy dnes pokrývají hlavně timezone a civil-date utility; rezervace, notifikace a presety zatím nemají automatický test suite

## Klíčové soubory

### Entry pointy

- `src/app/page.tsx`
- `src/app/rezervace/page.tsx`
- `src/app/admin/page.tsx`
- `src/app/report/daily/page.tsx`

### Planner

- `src/app/_components/PlannerPage.tsx`
- `src/app/_components/TimelineGrid.tsx`
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
- `src/app/api/machine-shifts/route.ts`
- `src/app/api/machine-exceptions/route.ts`

### Auth

- `src/lib/auth.ts`
- `src/middleware.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`

## Dokumenty v repu

- `README.md` – rychlý start
- `DOKUMENTACE.md` – lidská projektová dokumentace
- `DATABAZE_DOKUMENTACE.md` – DB model a provoz
- `HINTY.md` – backlog zlepšení
- `PLAN.md` – aktuální plánovací snapshot

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

## Co už nepsat do dokumentace

Nepiš už, že:

- SQLite je aktivní dev datasource
- roadmapa je v `AGENT.md`
- audit log nebo notifikace jsou teprve plánované
- rezervace a role `OBCHODNIK` jsou budoucí vlna
