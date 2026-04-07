# Integraf – Projektová dokumentace

Aktualizováno podle repozitáře k 4. 4. 2026.

## Přehled

Integraf je interní webová aplikace pro plánování výroby na strojích `XL_105` a `XL_106`. Kromě samotného plánovače dnes obsahuje i rezervační workflow, admin správu, systém job presetů, notifikace mezi rolemi a denní tiskový report.

## Funkční oblasti

### Planner

Hlavní planner na `/` obsahuje:

- timeline grid po 30 minutách
- drag & drop z fronty
- resize bloků
- split zakázek a práci se split skupinami
- batch přesuny více bloků
- lock bloků
- deadline a výrobní sloupečky (`DATA`, `MATERIÁL`, `BARVY`, `LAK`, `SPECIFIKACE`)
- auditní historii změn
- notifikace a provozní kontext

Podporované typy bloků:

- `ZAKAZKA`
- `REZERVACE`
- `UDRZBA`

### Provozní čas a odstávky

Planner respektuje:

- výchozí a dočasné šablony pracovní doby strojů
- půlhodinové sloty
- výjimky pro konkrétní datum
- firemní odstávky

Používané modely:

- `MachineWorkHoursTemplate`
- `MachineWorkHoursTemplateDay`
- `MachineScheduleException`
- `CompanyDay`

### Rezervace

Modul `/rezervace` je určen pro role `ADMIN`, `PLANOVAT`, `OBCHODNIK`.

Obsahuje:

- zakládání rezervací
- seznam aktivních a archivních rezervací
- detail rezervace
- plánovací payload pro připravené rezervace
- přílohy k rezervacím
- přímé notifikace pro obchodníka

Stavy rezervace:

| Stav | Význam |
| --- | --- |
| `SUBMITTED` | nově založená žádost |
| `ACCEPTED` | převzatá plánovačem |
| `QUEUE_READY` | připravená do fronty planneru |
| `SCHEDULED` | naplánovaná do konkrétního bloku |
| `REJECTED` | zamítnutá |

### Admin dashboard

Admin dashboard na `/admin` obsahuje:

- správu uživatelů
- správu číselníků
- správu job presetů
- audit log
- správu pracovní doby a šablon

`PLANOVAT` má omezený admin přístup pouze na:

- číselníky
- presety
- pracovní dobu

### Notifikace

V aplikaci existují dva typy notifikačního provozu:

- role-based notifikace pro `DTP` a `MTZ`
- přímé notifikace pro konkrétního `OBCHODNIK`

Planner a rezervace sdílejí model `Notification`.

### Denní report

Stránka `/report/daily?date=YYYY-MM-DD` generuje tiskový denní přehled výroby.

Vlastnosti:

- A4 landscape
- rozdělení po strojích
- automatické vyvolání tisku po načtení
- serverové API `GET /api/report/daily`

## Role a přístup

| Role | Co typicky dělá |
| --- | --- |
| `ADMIN` | plná správa aplikace |
| `PLANOVAT` | plánuje výrobu, řeší rezervace, spravuje presety a pracovní dobu |
| `DTP` | doplňuje data k zakázkám |
| `MTZ` | doplňuje materiálové informace |
| `OBCHODNIK` | zakládá a sleduje vlastní rezervace |
| `TISKAR` | potvrzuje tisk na přiřazeném stroji |
| `VIEWER` | pouze čte |

Praktický stav tiskařského režimu:

- role `TISKAR` dnes používá read-only pohled planneru na `/`
- v repu je i `src/app/tiskar/page.tsx`, ale současný middleware tuto route nepoužívá jako hlavní vstupní bod

## Hlavní stránky

| Route | Účel |
| --- | --- |
| `/` | hlavní planner |
| `/login` | přihlášení |
| `/rezervace` | rezervační centrum |
| `/admin` | správa systému |
| `/report/daily` | tiskový denní report |
| `/tiskar` | vedlejší tiskařská stránka přítomná v kódu |

## API přehled

### Planner

- `GET/POST /api/blocks`
- `GET/PUT/DELETE /api/blocks/[id]`
- `POST /api/blocks/batch`
- `GET /api/blocks/[id]/audit`
- `POST /api/blocks/[id]/complete`

### Konfigurace planneru

- `GET/POST /api/company-days`
- `DELETE /api/company-days/[id]`
- `GET/PUT/POST /api/machine-shifts`
- `PUT/DELETE /api/machine-shifts/[id]`
- `GET/POST /api/machine-exceptions`
- `DELETE /api/machine-exceptions/[id]`
- `GET /api/codebook`
- `PUT/DELETE /api/codebook/[id]`
- `GET/POST /api/job-presets`
- `GET/PUT/DELETE /api/job-presets/[id]`

### Auth a uživatelé

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET/POST /api/admin/users`
- `PUT/DELETE /api/admin/users/[id]`

### Audit a notifikace

- `GET /api/audit`
- `GET /api/audit/today`
- `GET/POST /api/notifications`
- `PATCH /api/notifications/[id]/read`

### Rezervace

- `GET/POST /api/reservations`
- `GET/PATCH /api/reservations/[id]`
- `GET/POST /api/reservations/[id]/attachments`
- `GET/DELETE /api/reservations/[id]/attachments/[attachmentId]`

### Report

- `GET /api/report/daily`

## Datový model

### Hlavní entity

- `Block` – plánované bloky v timeline
- `Reservation` – obchodní žádosti před plánováním
- `JobPreset` – znovupoužitelné předvolby builderu
- `Notification` – inbox a přímé notifikace
- `AuditLog` – historie změn bloků
- `CodebookOption` – číselníky
- `User` – uživatelé a role

### Důležité vazby a poznámky

- `Block.reservationId` propojuje naplánovaný blok s rezervací
- `ReservationAttachment` ukládá metadata příloh; soubory samotné jsou na disku
- reference na číselníkové položky jsou záměrně soft reference, historická data se opírají o snapshot labely
- split bloky používají self-reference přes `splitGroupId`

## Prostředí a spuštění

Projekt očekává:

- `.env` s `DATABASE_URL` a `JWT_SECRET`
- MySQL databázi
- Prisma migrace aplikované přes `prisma migrate deploy`

Doporučený lokální setup:

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:bootstrap
npm run dev
```

Rozdíl mezi bootstrapem a seedem:

- `npm run prisma:bootstrap` je bezpečný pro prázdnou databázi
- `npm run prisma:seed` je destruktivní dev script a přepisuje vývojová data

## Uložené soubory

Přílohy rezervací se ukládají do:

```text
data/reservation-attachments/<reservationId>/<storageKey>
```

Pro provoz to znamená:

- adresář musí být zapisovatelný
- databázová záloha sama o sobě nestačí
- při migraci serveru je potřeba přenést i filesystem s přílohami

## Ověřený technický stav

K 4. 4. 2026 bylo ověřeno:

- build je zelený
- lint je bez chyb, ale s několika warningy
- existující testy pro datumové utility procházejí

## Známé technické dluhy

- `src/middleware.ts` je funkční, ale Next.js 16 doporučuje přejmenování na `proxy`
- v projektu jsou dvě cesty pro tiskařský režim a je potřeba rozhodnout, která má být dlouhodobě zdroj pravdy
- automatické testy dnes pokrývají hlavně timezone a civil-date helpery

## Navazující dokumenty

- `README.md` – rychlý start
- `CLAUDE.md` – stručný repo-truth pro asistenty
- `DATABAZE_DOKUMENTACE.md` – detail k MySQL a tabulkám
- `HINTY.md` – backlog zlepšení
- `PLAN.md` – aktuální plánovací snapshot

Historické návrhové dokumenty:

- `SPECIFIKACE_DALSI_VLNY_ZMEN.md`
- `SPECIFIKACE_PRESETY_JOB_BUILDER.md`
