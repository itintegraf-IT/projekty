# Integraf – Databázová dokumentace

Aktualizováno podle `prisma/schema.prisma` k 4. 4. 2026.

## Základ

- aktivní databáze projektu je MySQL
- zdroj pravdy je `prisma/schema.prisma`
- změny schématu se nasazují přes Prisma migrace v `prisma/migrations/`
- starý soubor `prisma/dev.db` není aktivní datasource aplikace

## Přehled modelů

| Model | Účel | Poznámky |
| --- | --- | --- |
| `Block` | hlavní planner bloky | zakázka, rezervace nebo údržba |
| `Reservation` | rezervační workflow | samostatný business objekt před plánováním |
| `ReservationAttachment` | metadata příloh | obsah souboru je na filesystemu |
| `Notification` | inbox a direct notifikace | bez tvrdé FK vazby na blok |
| `JobPreset` | předvolby builderu | použitelné pro zakázku a rezervaci |
| `CodebookOption` | číselníky | DATA, MATERIAL, BARVY, LAK |
| `CompanyDay` | firemní odstávky | může být globální i strojová |
| `MachineWorkHours` | starší plochá pracovní doba | dnes hlavně bootstrap/backward compatibility |
| `MachineWorkHoursTemplate` | šablona pracovní doby | default i dočasné varianty |
| `MachineWorkHoursTemplateDay` | řádky šablony po dnech | podporuje i half-hour sloty |
| `MachineScheduleException` | výjimka pro konkrétní datum | priorita nad šablonou |
| `User` | účty a role | včetně `assignedMachine` |
| `AuditLog` | historie změn bloků | log bez tvrdé vazby na živý blok |

## Planner a výroba

### `Block`

Nejdůležitější pole:

- identita a timing:
  - `id`
  - `orderNumber`
  - `machine`
  - `startTime`
  - `endTime`
  - `type`
- stav a vizuální metadata:
  - `blockVariant`
  - `description`
  - `locked`
  - `deadlineExpedice`
- výrobní sloupečky:
  - `dataStatusId`, `dataStatusLabel`, `dataRequiredDate`, `dataOk`
  - `materialStatusId`, `materialStatusLabel`, `materialRequiredDate`, `materialOk`
  - `barvyStatusId`, `barvyStatusLabel`
  - `lakStatusId`, `lakStatusLabel`
  - `specifikace`
  - `materialNote`, `materialNoteByUsername`
  - `pantoneRequiredDate`, `pantoneOk`, `materialInStock`
- workflow a vazby:
  - `recurrenceType`
  - `recurrenceParentId`
  - `splitGroupId`
  - `jobPresetId`, `jobPresetLabel`
  - `reservationId`
- tisk:
  - `printCompletedAt`
  - `printCompletedByUserId`
  - `printCompletedByUsername`

Vazby:

- self relation pro opakování
- self relation pro split skupiny
- nullable relation na `Reservation`

Důležitá poznámka:

- číselníkové reference v bloku jsou soft reference
- historická čitelnost stojí na snapshot polích `*Label`

### `CompanyDay`

Slouží pro firemní odstávky nebo speciální dny.

Nejdůležitější pole:

- `startDate`
- `endDate`
- `label`
- `machine`

### `AuditLog`

Audit změn planneru.

Nejdůležitější pole:

- `blockId`
- `orderNumber`
- `userId`
- `username`
- `action`
- `field`
- `oldValue`
- `newValue`
- `createdAt`

## Rezervace

### `Reservation`

Rezervace je samostatný objekt před vznikem bloku v planneru.

Nejdůležitější pole:

- identita:
  - `id`
  - `code`
  - `status`
- obchodní data:
  - `companyName`
  - `erpOfferNumber`
  - `requestedExpeditionDate`
  - `requestedDataDate`
  - `requestText`
- vlastnictví a rozhodnutí:
  - `requestedByUserId`
  - `requestedByUsername`
  - `plannerUserId`
  - `plannerUsername`
  - `plannerDecisionReason`
- příprava a plánování:
  - `planningPayload`
  - `preparedAt`
  - `scheduledBlockId`
  - `scheduledMachine`
  - `scheduledStartTime`
  - `scheduledEndTime`
  - `scheduledAt`

Stavy:

- `SUBMITTED`
- `ACCEPTED`
- `QUEUE_READY`
- `SCHEDULED`
- `REJECTED`

### `ReservationAttachment`

V databázi jsou uložena metadata:

- `reservationId`
- `originalName`
- `storageKey`
- `mimeType`
- `sizeBytes`
- `uploadedByUserId`
- `uploadedByUsername`
- `createdAt`

Obsah souboru se ukládá mimo DB na disk:

```text
data/reservation-attachments/<reservationId>/<storageKey>
```

Zálohování musí zahrnovat databázi i tento adresář.

## Notifikace

### `Notification`

Model slouží pro dva scénáře:

- role-based notifikace pro `DTP` a `MTZ`
- user-targeted notifikace pro `OBCHODNIK`

Nejdůležitější pole:

- `type`
- `message`
- `blockId`
- `blockOrderNumber`
- `targetRole`
- `targetUserId`
- `reservationId`
- `createdByUserId`
- `createdByUsername`
- `isRead`
- `readAt`
- `createdAt`

Typické hodnoty `type`:

- `BLOCK_NOTIFY`
- `RESERVATION_SCHEDULED`
- `RESERVATION_REJECTED`
- `RESERVATION_MANUAL`

## Konfigurace planneru

### `CodebookOption`

Číselníky pro:

- `DATA`
- `MATERIAL`
- `BARVY`
- `LAK`

Důležitá pole:

- `label`
- `sortOrder`
- `isActive`
- `shortCode`
- `isWarning`
- `badgeColor`

### `JobPreset`

Předvolby builderu a editace bloků.

Důležitá pole:

- `name`
- `isSystemPreset`
- `isActive`
- `sortOrder`
- `appliesToZakazka`
- `appliesToRezervace`
- `machineConstraint`
- `blockVariant`
- `specifikace`
- `dataStatusId`
- `dataRequiredDateOffsetDays`
- `materialStatusId`
- `materialRequiredDateOffsetDays`
- `materialInStock`
- `pantoneRequiredDateOffsetDays`
- `barvyStatusId`
- `lakStatusId`
- `deadlineExpediceOffsetDays`

### `MachineWorkHours`

Plochá tabulka pracovní doby po dnech.

Aktuální role:

- bootstrap nových instalací
- zdroj pro založení default template, pokud už existují historická data

### `MachineWorkHoursTemplate`

Šablona pracovní doby pro stroj s intervalem platnosti.

Důležitá pole:

- `machine`
- `label`
- `validFrom`
- `validTo`
- `isDefault`

### `MachineWorkHoursTemplateDay`

Řádky konkrétní šablony.

Důležitá pole:

- `dayOfWeek`
- `startHour`
- `endHour`
- `startSlot`
- `endSlot`
- `isActive`

### `MachineScheduleException`

Výjimka pro konkrétní datum a stroj.

Důležitá pole:

- `machine`
- `date`
- `startHour`
- `endHour`
- `startSlot`
- `endSlot`
- `isActive`
- `label`

## Uživatelé

### `User`

Role v databázi:

- `ADMIN`
- `PLANOVAT`
- `MTZ`
- `DTP`
- `VIEWER`
- `TISKAR`
- `OBCHODNIK`

Pole navíc:

- `assignedMachine` pro roli `TISKAR`

## Migrace a nasazení

Pro novou nebo čistou DB:

```bash
npx prisma generate
npx prisma migrate deploy
npm run prisma:bootstrap
```

Význam skriptů:

- `prisma migrate deploy` aplikuje migrace
- `npm run prisma:bootstrap` bezpečně založí minimální konfigurační data
- `npm run prisma:seed` je dev-only a přepisuje demo data

## Aktuální migrační historie

V repu jsou mimo jiné migrace pro:

- init MySQL
- audit log
- badge color
- strojové odstávky a pracovní dobu
- roli `TISKAR`
- notifikace
- rezervace
- job presety
- půlhodinové sloty pracovní doby

## Provozní poznámky

- filesystem pro přílohy musí být zapisovatelný z běžící aplikace
- bez přenosu `data/reservation-attachments` nejsou přílohy obnovitelné jen z DB
- pokud dokumentace někde tvrdí, že SQLite je aktivní runtime databáze, je to zastaralé
