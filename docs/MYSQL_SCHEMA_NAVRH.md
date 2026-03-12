# Návrh MySQL schématu — Integraf Výrobní plán

Tento dokument popisuje návrh databázových tabulek pro produkční MySQL. Zahrnuje stávající modely, AuditLog (Etapa 10) a připravenost na budoucí rozšíření.

**Aktuální stav (2026-03):** Projekt používá MySQL, databáze `IGvyroba`, localhost, root / heslo `mysql`. Tabulky se vytvářejí přes `prisma migrate deploy` nebo ručně přes `prisma/mysql-schema.sql`.

---

## Obecné zásady

| Zásada | Hodnota |
|--------|---------|
| **Engine** | InnoDB (transakce, FK, row-level locking) |
| **Charset** | utf8mb4 (plná podpora emoji a Unicode) |
| **Collation** | utf8mb4_unicode_ci |
| **ID sloupce** | INT UNSIGNED (rozsah 0–4 mld.) |
| **Timestamps** | DATETIME(3) pro milisekundy (MySQL 5.6.4+) nebo DATETIME |

---

## 1. Block (zakázky / rezervace / údržba)

Hlavní tabulka plánovacích bloků.

| Sloupec | Typ | Null | Default | Popis |
|---------|-----|------|---------|------|
| id | INT UNSIGNED | NO | AUTO_INCREMENT | PK |
| orderNumber | VARCHAR(64) | NO | — | Číslo zakázky |
| machine | VARCHAR(16) | NO | — | XL_105 \| XL_106 |
| startTime | DATETIME | NO | — | Začátek |
| endTime | DATETIME | NO | — | Konec |
| type | VARCHAR(32) | NO | 'ZAKAZKA' | ZAKAZKA \| REZERVACE \| UDRZBA |
| description | TEXT | YES | NULL | Popis |
| locked | TINYINT(1) | NO | 0 | Zámek |
| deadlineExpedice | DATETIME | YES | NULL | Termín expedice |
| dataStatusId | INT UNSIGNED | YES | NULL | FK → CodebookOption |
| dataStatusLabel | VARCHAR(255) | YES | NULL | Snapshot labelu |
| dataRequiredDate | DATETIME | YES | NULL | |
| dataOk | TINYINT(1) | NO | 0 | |
| materialStatusId | INT UNSIGNED | YES | NULL | |
| materialStatusLabel | VARCHAR(255) | YES | NULL | |
| materialRequiredDate | DATETIME | YES | NULL | |
| materialOk | TINYINT(1) | NO | 0 | |
| barvyStatusId | INT UNSIGNED | YES | NULL | |
| barvyStatusLabel | VARCHAR(255) | YES | NULL | |
| lakStatusId | INT UNSIGNED | YES | NULL | |
| lakStatusLabel | VARCHAR(255) | YES | NULL | |
| specifikace | TEXT | YES | NULL | |
| recurrenceType | VARCHAR(32) | NO | 'NONE' | NONE \| DAILY \| WEEKLY \| MONTHLY |
| recurrenceParentId | INT UNSIGNED | YES | NULL | Self-reference |
| createdAt | DATETIME | NO | CURRENT_TIMESTAMP | |
| updatedAt | DATETIME | NO | ON UPDATE CURRENT_TIMESTAMP | |

**Indexy:**
- `PRIMARY KEY (id)`
- `INDEX idx_block_machine_start (machine, startTime)` — hlavní dotazy na timeline
- `INDEX idx_block_order (orderNumber)` — vyhledávání zakázky
- `INDEX idx_block_recurrence (recurrenceParentId)` — opakované bloky
- `FOREIGN KEY (recurrenceParentId) REFERENCES Block(id) ON DELETE SET NULL`
- `FOREIGN KEY (dataStatusId) REFERENCES CodebookOption(id) ON DELETE SET NULL` (volitelné)
- `FOREIGN KEY (materialStatusId) REFERENCES CodebookOption(id) ON DELETE SET NULL` (volitelné)
- `FOREIGN KEY (barvyStatusId) REFERENCES CodebookOption(id) ON DELETE SET NULL` (volitelné)
- `FOREIGN KEY (lakStatusId) REFERENCES CodebookOption(id) ON DELETE SET NULL` (volitelné)

> **Poznámka:** FK na CodebookOption lze vynechat — blok ukládá snapshot label, takže smazání položky číselníku neohrozí integritu. FK zjednoduší JOINy, ale omezí mazání číselníku.

---

## 2. CodebookOption (číselníky)

| Sloupec | Typ | Null | Default | Popis |
|---------|-----|------|---------|------|
| id | INT UNSIGNED | NO | AUTO_INCREMENT | PK |
| category | VARCHAR(32) | NO | — | DATA \| MATERIAL \| BARVY \| LAK |
| label | VARCHAR(255) | NO | — | Název položky |
| sortOrder | INT | NO | 0 | Pořadí v dropdownu |
| isActive | TINYINT(1) | NO | 1 | Zobrazit v UI |
| shortCode | VARCHAR(32) | YES | NULL | Zkratka pro badge |
| isWarning | TINYINT(1) | NO | 0 | Oranžové zvýraznění |

**Indexy:**
- `PRIMARY KEY (id)`
- `INDEX idx_codebook_category (category, sortOrder)` — načítání číselníku pro formulář

---

## 3. CompanyDay (firemní dny / odstávky)

| Sloupec | Typ | Null | Default | Popis |
|---------|-----|------|---------|------|
| id | INT UNSIGNED | NO | AUTO_INCREMENT | PK |
| startDate | DATE | NO | — | Začátek |
| endDate | DATE | NO | — | Konec |
| label | VARCHAR(255) | NO | — | Popis |
| createdAt | DATETIME | NO | CURRENT_TIMESTAMP | |

**Indexy:**
- `PRIMARY KEY (id)`
- `INDEX idx_companyday_dates (startDate, endDate)` — kontrola překryvu, vykreslení kalendáře

---

## 4. User (uživatelé)

| Sloupec | Typ | Null | Default | Popis |
|---------|-----|------|---------|------|
| id | INT UNSIGNED | NO | AUTO_INCREMENT | PK |
| username | VARCHAR(64) | NO | — | UNIQUE |
| passwordHash | VARCHAR(255) | NO | — | bcrypt hash |
| role | VARCHAR(32) | NO | 'VIEWER' | ADMIN \| PLANOVAT \| MTZ \| DTP \| VIEWER |
| createdAt | DATETIME | NO | CURRENT_TIMESTAMP | |

**Indexy:**
- `PRIMARY KEY (id)`
- `UNIQUE KEY uk_user_username (username)`

**Budoucí rozšíření (volitelné):**
- `isActive TINYINT(1) DEFAULT 1` — deaktivovaný uživatel se nemůže přihlásit
- `lastLoginAt DATETIME NULL` — poslední přihlášení

---

## 5. AuditLog (Etapa 10 — audit změn)

Loguje vybrané akce: vytvoření/smazání bloku, změny DATA/MATERIÁL stavů, expedice.

| Sloupec | Typ | Null | Default | Popis |
|---------|-----|------|---------|------|
| id | BIGINT UNSIGNED | NO | AUTO_INCREMENT | PK |
| blockId | INT UNSIGNED | NO | — | ID bloku (bez FK — blok může být smazán) |
| orderNumber | VARCHAR(64) | NO | — | Snapshot čísla zakázky (pro zobrazení po smazání) |
| userId | INT UNSIGNED | NO | — | Kdo změnil |
| username | VARCHAR(64) | NO | — | Snapshot jména |
| action | VARCHAR(16) | NO | — | CREATE \| DELETE \| UPDATE |
| field | VARCHAR(64) | YES | NULL | Název pole (dataStatusLabel, dataOk, deadlineExpedice…) |
| oldValue | VARCHAR(512) | YES | NULL | Předchozí hodnota (serializovaná) |
| newValue | VARCHAR(512) | YES | NULL | Nová hodnota |
| createdAt | DATETIME | NO | CURRENT_TIMESTAMP | |

**Indexy:**
- `PRIMARY KEY (id)`
- `INDEX idx_audit_block (blockId)` — historie pro konkrétní blok
- `INDEX idx_audit_created (createdAt DESC)` — poslední záznamy v admin dashboardu
- `INDEX idx_audit_user (userId, createdAt)` — akce uživatele
- `INDEX idx_audit_order (orderNumber)` — vyhledání podle zakázky

> **BIGINT pro id:** Audit log roste neomezeně; BIGINT zaručí dostatek kapacity i při vysokém provozu.

---

## 6. Budoucí rozšíření (připravenost)

### 6.1 Session / přihlášení (volitelné)

Pro sledování aktivních session nebo historie přihlášení:

```sql
-- Session (pro „odhlásit všude“ nebo invalidaci tokenů)
CREATE TABLE Session (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  userId INT UNSIGNED NOT NULL,
  tokenHash VARCHAR(64) NOT NULL,
  expiresAt DATETIME NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_token (tokenHash),
  INDEX idx_session_user (userId),
  FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
);
```

### 6.2 Export / tisk (volitelné)

Pro logování exportů nebo tiskových úloh:

```sql
CREATE TABLE ExportLog (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  userId INT UNSIGNED NOT NULL,
  type VARCHAR(32) NOT NULL,  -- 'CSV', 'PDF', 'PRINT'
  params JSON,                 -- filtry, rozsah
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_export_created (createdAt DESC),
  FOREIGN KEY (userId) REFERENCES User(id)
);
```

### 6.3 Nové výrobní sloupečky

Při přidání nového sloupečku (např. KVALITA):
- Rozšířit `Block` o `kvalitaStatusId`, `kvalitaStatusLabel`
- Přidat kategorii do `CodebookOption` (category = 'KVALITA')
- Přidat sledovaná pole do AuditLog logiky

### 6.4 Soft delete bloků (volitelné)

Místo fyzického mazání archivace:

```sql
-- Přidat do Block:
deletedAt DATETIME NULL,
deletedBy INT UNSIGNED NULL
```

---

## 7. Prisma schema pro MySQL

Upravené `schema.prisma` pro přechod na MySQL:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Block {
  id          Int       @id @default(autoincrement())
  orderNumber String    @db.VarChar(64)
  machine     String    @db.VarChar(16)
  startTime   DateTime
  endTime     DateTime
  type        String    @default("ZAKAZKA") @db.VarChar(32)
  description String?   @db.Text
  locked      Boolean   @default(false)
  deadlineExpedice DateTime?

  dataStatusId     Int?
  dataStatusLabel  String?  @db.VarChar(255)
  dataRequiredDate DateTime?
  dataOk           Boolean   @default(false)

  materialStatusId     Int?
  materialStatusLabel  String?  @db.VarChar(255)
  materialRequiredDate DateTime?
  materialOk           Boolean   @default(false)

  barvyStatusId    Int?
  barvyStatusLabel String?  @db.VarChar(255)
  lakStatusId      Int?
  lakStatusLabel   String?  @db.VarChar(255)
  specifikace      String?  @db.Text

  recurrenceType     String  @default("NONE") @db.VarChar(32)
  recurrenceParentId  Int?
  recurrenceParent   Block?  @relation("RecurrenceChildren", fields: [recurrenceParentId], references: [id], onDelete: SetNull)
  recurrenceChildren Block[] @relation("RecurrenceChildren")

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([machine, startTime])
  @@index([orderNumber])
  @@index([recurrenceParentId])
}

model CodebookOption {
  id        Int     @id @default(autoincrement())
  category  String  @db.VarChar(32)
  label     String  @db.VarChar(255)
  sortOrder Int     @default(0)
  isActive  Boolean @default(true)
  shortCode String? @db.VarChar(32)
  isWarning Boolean @default(false)

  @@index([category, sortOrder])
}

model CompanyDay {
  id        Int      @id @default(autoincrement())
  startDate DateTime @db.Date
  endDate   DateTime @db.Date
  label     String   @db.VarChar(255)
  createdAt DateTime @default(now())

  @@index([startDate, endDate])
}

model User {
  id           Int      @id @default(autoincrement())
  username     String   @unique @db.VarChar(64)
  passwordHash String   @db.VarChar(255)
  role         String   @default("VIEWER") @db.VarChar(32)
  createdAt    DateTime @default(now())
}

model AuditLog {
  id         BigInt   @id @default(autoincrement())
  blockId    Int
  orderNumber String  @db.VarChar(64)
  userId     Int
  username   String   @db.VarChar(64)
  action     String   @db.VarChar(16)
  field      String?  @db.VarChar(64)
  oldValue   String?  @db.VarChar(512)
  newValue   String?  @db.VarChar(512)
  createdAt  DateTime @default(now())

  @@index([blockId])
  @@index([createdAt(sort: Desc)])
  @@index([userId, createdAt])
  @@index([orderNumber])
}
```

> **Poznámka:** Prisma 5 s MySQL automaticky vytvoří InnoDB tabulky. Charset `utf8mb4` lze nastavit v connection string: `?charset=utf8mb4` nebo v `DATABASE_URL`.

---

## 8. Pořadí migrace

1. **Před přechodem:** Záloha SQLite DB (pokud máte data).
2. **Nové schema:** Upravit `schema.prisma` (provider = mysql, přidat AuditLog).
3. **Prázdná MySQL:** `DATABASE_URL="mysql://root:mysql@localhost:3306/IGvyroba" npx prisma migrate dev --name init_mysql`
4. **Bootstrap:** `npm run prisma:bootstrap` — vytvoří číselník + admin účet.
5. **Migrace dat (pokud máte):** Vlastní skript pro export z SQLite a import do MySQL.

---

## 9. Shrnutí

| Tabulka | Účel | Rozšířitelnost |
|---------|------|----------------|
| Block | Zakázky, rezervace, údržba | Nové sloupečky = nové sloupce |
| CodebookOption | Číselníky | Nová kategorie = nové řádky |
| CompanyDay | Firemní dny | — |
| User | Uživatelé | isActive, lastLoginAt |
| AuditLog | Audit změn | Připraveno pro Etapu 10 |

Indexy jsou navrženy pro typické dotazy: timeline (machine + startTime), vyhledávání zakázky, audit podle bloku a data.
