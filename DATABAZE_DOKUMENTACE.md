# Integraf — Databázová dokumentace pro MySQL přechod

Tento dokument je určen pro IT specialistu, který nastavuje MySQL databázi pro provozní prostředí aplikace.

---

## 1. Přehled systému

Aplikace **Integraf Výrobní plán** je webová aplikace pro plánování výroby na strojích XL 105 a XL 106.

**Technologie:**
- Backend: Next.js (Node.js) + Prisma ORM verze 5
- Vývojová databáze: SQLite (soubor `prisma/dev.db`)
- **Produkční databáze: MySQL** (cíl tohoto dokumentu)

Přístup k databázi probíhá **výhradně přes Prisma ORM** — aplikace nikdy neposílá ruční SQL dotazy. Prisma se postará o překlad, takže z pohledu aplikace je MySQL a SQLite zaměnitelné.

---

## 2. Databázové tabulky

### 2.1 Tabulka `Block` — výrobní bloky

Hlavní tabulka. Každý řádek je jeden blok na časové ose (zakázka, rezervace, nebo údržba).

| Sloupec | Typ | Povinný | Výchozí | Popis |
|---|---|---|---|---|
| `id` | INT AUTO_INCREMENT | ✅ | — | Primární klíč |
| `orderNumber` | VARCHAR(255) | ✅ | — | Číslo zakázky (text, např. „17001") |
| `machine` | VARCHAR(20) | ✅ | — | Stroj: `XL_105` nebo `XL_106` |
| `startTime` | DATETIME | ✅ | — | Začátek bloku na časové ose |
| `endTime` | DATETIME | ✅ | — | Konec bloku na časové ose |
| `type` | VARCHAR(20) | ✅ | `ZAKAZKA` | Typ: `ZAKAZKA`, `REZERVACE`, `UDRZBA` |
| `description` | TEXT | ❌ | NULL | Popis zakázky / poznámka |
| `locked` | TINYINT(1) | ✅ | `0` | Zámek bloku — zamčený blok nejde přetáhnout |
| `deadlineExpedice` | DATETIME | ❌ | NULL | Termín expedice (datum odeslání zákazníkovi) |
| `dataStatusId` | INT | ❌ | NULL | ID stavu DATA z číselníku `CodebookOption` |
| `dataStatusLabel` | VARCHAR(255) | ❌ | NULL | Snapshot textu stavu DATA (pro historii) |
| `dataRequiredDate` | DATETIME | ❌ | NULL | Datum, do kdy musí být DATA připravena |
| `dataOk` | TINYINT(1) | ✅ | `0` | Příznak: DATA jsou schválena/ok |
| `materialStatusId` | INT | ❌ | NULL | ID stavu MATERIÁL z číselníku `CodebookOption` |
| `materialStatusLabel` | VARCHAR(255) | ❌ | NULL | Snapshot textu stavu MATERIÁL |
| `materialRequiredDate` | DATETIME | ❌ | NULL | Datum, do kdy musí být materiál |
| `materialOk` | TINYINT(1) | ✅ | `0` | Příznak: MATERIÁL je připraven |
| `barvyStatusId` | INT | ❌ | NULL | ID výběru barev z číselníku |
| `barvyStatusLabel` | VARCHAR(255) | ❌ | NULL | Snapshot textu barev |
| `lakStatusId` | INT | ❌ | NULL | ID výběru laku z číselníku |
| `lakStatusLabel` | VARCHAR(255) | ❌ | NULL | Snapshot textu laku |
| `specifikace` | TEXT | ❌ | NULL | Volný text — výrobní specifikace |
| `recurrenceType` | VARCHAR(20) | ✅ | `NONE` | Opakování: `NONE`, `DAILY`, `WEEKLY`, `MONTHLY` |
| `recurrenceParentId` | INT | ❌ | NULL | FK na nadřazený blok (self-reference pro opakování) |
| `createdAt` | DATETIME | ✅ | `NOW()` | Kdy byl blok vytvořen |
| `updatedAt` | DATETIME | ✅ | auto | Automaticky aktualizováno při změně |

**Cizí klíče:**
- `recurrenceParentId` → `Block.id` (ON DELETE SET NULL)
  - Pokud se smaže rodičovský blok opakování, děti zůstanou, ale jejich `recurrenceParentId` se nastaví na NULL

**Poznámky:**
- `dataStatusId` a `materialStatusId` jsou **pouze informační reference** — nejsou to cizí klíče na `CodebookOption`. Důvod: pokud se položka číselníku smaže, historická data bloků musí zůstat v pořádku. Proto se ukládá i `dataStatusLabel` (snapshot textu v době uložení).
- Pole `startTime` a `endTime` jsou vždy v UTC — aplikace konvertuje na lokální čas v prohlížeči.

---

### 2.2 Tabulka `CodebookOption` — číselníky

Číselník pro výběrové seznamy ve formuláři. Spravuje ho administrátor přes webový dashboard.

| Sloupec | Typ | Povinný | Výchozí | Popis |
|---|---|---|---|---|
| `id` | INT AUTO_INCREMENT | ✅ | — | Primární klíč |
| `category` | VARCHAR(20) | ✅ | — | Kategorie: `DATA`, `MATERIAL`, `BARVY`, `LAK` |
| `label` | VARCHAR(255) | ✅ | — | Zobrazovaný text položky |
| `sortOrder` | INT | ✅ | `0` | Pořadí v seznamu |
| `isActive` | TINYINT(1) | ✅ | `1` | Aktivní = zobrazuje se ve formuláři |
| `shortCode` | VARCHAR(50) | ❌ | NULL | Volitelná zkratka (zatím nevyužito) |
| `isWarning` | TINYINT(1) | ✅ | `0` | Zvýraznit jako varování (červeně) |

**Výchozí hodnoty (vloží je bootstrap skript):**

Kategorie `DATA`:
- CHYBNÁ DATA *(isWarning = true)*
- U SCHVÁLENÍ
- PŘIPRAVENO
- VYSVÍCENO
- MÍSTO PRO POZNÁMKU

Kategorie `MATERIAL`:
- SKLADEM, TISK Z ARCHŮ, TISK Z ROLÍ, 50m, 55m, 55lit, 60m, 60lim, 70m, MÍSTO PRO POZNÁMKU

Kategorie `BARVY`:
- SCH Lumina LED, IML COLORGRAF, SCH TRIUMPH K

Kategorie `LAK`:
- disperse lesk, disperse mat, pod UV, mat pod lamino, 150, 401, 215, parciální, UV lak, vysoce lesklá disperse

---

### 2.3 Tabulka `CompanyDay` — firemní odstávky

Záznamy o firemních volnech (Vánoce, inventura, atd.). Zadávají se přes webové rozhraní.

| Sloupec | Typ | Povinný | Výchozí | Popis |
|---|---|---|---|---|
| `id` | INT AUTO_INCREMENT | ✅ | — | Primární klíč |
| `startDate` | DATETIME | ✅ | — | Začátek odstávky |
| `endDate` | DATETIME | ✅ | — | Konec odstávky |
| `label` | VARCHAR(255) | ✅ | — | Název (např. „Vánoce 2026") |
| `createdAt` | DATETIME | ✅ | `NOW()` | Kdy byl záznam vytvořen |

---

### 2.4 Tabulka `User` — uživatelé

Uživatelské účty pro přihlašování do aplikace.

| Sloupec | Typ | Povinný | Výchozí | Popis |
|---|---|---|---|---|
| `id` | INT AUTO_INCREMENT | ✅ | — | Primární klíč |
| `username` | VARCHAR(255) UNIQUE | ✅ | — | Přihlašovací jméno (musí být unikátní) |
| `passwordHash` | VARCHAR(255) | ✅ | — | Bcrypt hash hesla (nikdy plain text!) |
| `role` | VARCHAR(20) | ✅ | `VIEWER` | Role: `ADMIN`, `PLANOVAT`, `MTZ`, `DTP`, `VIEWER` |
| `createdAt` | DATETIME | ✅ | `NOW()` | Kdy byl účet vytvořen |

**Role a jejich oprávnění:**

| Role | Co může dělat |
|---|---|
| `ADMIN` | Vše — správa uživatelů, číselníků, všechny bloky |
| `PLANOVAT` | Přidávat, upravovat, mazat bloky — veškerá práce s plánem |
| `DTP` | Edituje pouze sloupec DATA (dataStatusId, dataStatusLabel, dataRequiredDate, dataOk) |
| `MTZ` | Edituje pouze sloupec MATERIÁL (materialStatusId, materialStatusLabel, materialRequiredDate, materialOk) |
| `VIEWER` | Pouze čtení — žádné úpravy |

**Hesla:** Ukládají se jako bcrypt hash s cost faktorem 10. Aplikace používá knihovnu `bcryptjs`. Plain text heslo se v databázi nikdy neobjevuje.

---

## 3. ER Diagram (vztahy mezi tabulkami)

```
Block ──────────────────────────────────────────────────────────┐
│ id (PK)                                                        │
│ recurrenceParentId (FK → Block.id, ON DELETE SET NULL) ────────┘
│ dataStatusId       (SOFT ref → CodebookOption.id, BEZ FK)
│ materialStatusId   (SOFT ref → CodebookOption.id, BEZ FK)
│ barvyStatusId      (SOFT ref → CodebookOption.id, BEZ FK)
│ lakStatusId        (SOFT ref → CodebookOption.id, BEZ FK)

CodebookOption
│ id (PK)
│ category: DATA | MATERIAL | BARVY | LAK

CompanyDay
│ id (PK)
│ (žádné cizí klíče)

User
│ id (PK)
│ username UNIQUE
```

**Důležité:** Číselníkové reference (dataStatusId, materialStatusId, atd.) nejsou databázové cizí klíče — jsou to jen logické reference. Pokud se položka číselníku smaže, bloky na ni odkazující zůstanou v pořádku (mají snapshot labelu v `dataStatusLabel`).

---

## 4. Požadavky na MySQL server

- MySQL verze: **8.0 nebo novější** (doporučeno 8.0+)
- Znaková sada: **utf8mb4** (pro české znaky s háčky a čárkami)
- Collation: **utf8mb4_unicode_ci**
- Uživatel musí mít práva: `CREATE`, `ALTER`, `DROP`, `INDEX`, `INSERT`, `UPDATE`, `DELETE`, `SELECT` na cílové databázi

**Vytvoření databáze a uživatele** (příklad — uprav jméno a heslo):

```sql
CREATE DATABASE integraf CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'integraf_user'@'localhost' IDENTIFIED BY 'SilneHeslo123!';

GRANT ALL PRIVILEGES ON integraf.* TO 'integraf_user'@'localhost';

FLUSH PRIVILEGES;
```

---

## 5. Postup přechodu SQLite → MySQL

### Krok 1: Úprava Prisma schématu

Otevřít soubor `prisma/schema.prisma` a změnit `provider`:

```prisma
datasource db {
  provider = "mysql"    // ← bylo "sqlite"
  url      = env("DATABASE_URL")
}
```

### Krok 2: Vytvoření MySQL migrací

Stávající SQLite migrace (ve složce `prisma/migrations/`) jsou nekompatibilní s MySQL. Je potřeba vygenerovat nové.

**Provést na vývojovém stroji** (ne na produkčním serveru) s připojením na prázdnou MySQL:

```bash
# Nastavit dočasnou proměnnou prostředí na vývojovém stroji
export DATABASE_URL="mysql://integraf_user:SilneHeslo123!@localhost:3306/integraf_dev"

# Vygenerovat MySQL migrace (smaže stará SQLite migrace a vytvoří nová)
npx prisma migrate dev --name init_mysql
```

Tento příkaz vytvoří složku `prisma/migrations/DATUM_init_mysql/migration.sql` s MySQL SQL souborem.

> Pozor: Příkaz `prisma migrate dev` vyžaduje interaktivní terminál. Pokud ho spouštíš přes SSH, musí být připojen k TTY.

### Krok 3: Přenesení kódu na produkční server

Přenést celý projekt na server (git pull, scp, nebo jiným způsobem). Projekt musí obsahovat:
- složku `prisma/migrations/` s novými MySQL migracemi
- soubor `prisma/schema.prisma` s `provider = "mysql"`

### Krok 4: Nastavení proměnných prostředí na serveru

Vytvořit soubor `.env` v kořeni projektu (nebo nastavit systémové proměnné prostředí):

```env
DATABASE_URL="mysql://integraf_user:SilneHeslo123!@localhost:3306/integraf"
JWT_SECRET="min32znakovynahodnytextprosezeni"
NODE_ENV="production"
```

**Generování silného JWT_SECRET:**
```bash
openssl rand -base64 32
```

> DŮLEŽITÉ: `JWT_SECRET` musí být aspoň 32 náhodných znaků. Pokud se změní, všichni přihlášení uživatelé budou odhlášeni.

### Krok 5: První spuštění na produkci

```bash
# 1. Nainstalovat Node.js závislosti
npm install

# 2. Vygenerovat Prisma klient pro MySQL
npx prisma generate

# 3. Aplikovat migrace — vytvoří tabulky v MySQL (data nesmaže)
npx prisma migrate deploy

# 4. Inicializovat číselník a admin účet (pouze pokud jsou tabulky prázdné)
npm run prisma:bootstrap

# 5. Sestavit aplikaci pro produkci
npm run build

# 6. Spustit server
npm run start
```

### Krok 6: První přihlášení

Bootstrap vytvoří administrátorský účet:
- **Uživatelské jméno:** `admin`
- **Heslo:** `ChangeMe123!`

**Okamžitě po prvním přihlášení změň heslo** přes Admin dashboard → sekce Uživatelé.

---

## 6. Každý další update aplikace (deployment)

```bash
# Stáhnout novou verzi kódu
git pull

# Nainstalovat případné nové závislosti
npm install

# Vygenerovat Prisma klient (pokud se změnilo schema)
npx prisma generate

# Aplikovat případné nové migrace (bezpečné — data nesmaže)
npx prisma migrate deploy

# Sestavit a spustit
npm run build
npm run start
```

> ⚠️ NIKDY po prvním spuštění nespouštět `npm run prisma:seed` — seed maže veškerá data v tabulkách `Block` a `CodebookOption`!

---

## 7. Přehled API endpointů (backend)

Aplikace poskytuje REST API pro komunikaci mezi frontendem a databází. Všechny endpointy (kromě `/api/auth/*` a `/login`) vyžadují platnou session (JWT cookie).

### Autentizace

| Metoda | Endpoint | Popis | Kdo může |
|---|---|---|---|
| POST | `/api/auth/login` | Přihlášení — vrátí JWT cookie | Všichni (bez auth) |
| POST | `/api/auth/logout` | Odhlášení — smaže cookie | Přihlášení uživatelé |

### Bloky (výrobní plán)

| Metoda | Endpoint | Popis | Kdo může |
|---|---|---|---|
| GET | `/api/blocks` | Načte všechny bloky | Přihlášení uživatelé |
| POST | `/api/blocks` | Vytvoří nový blok | ADMIN, PLANOVAT |
| GET | `/api/blocks/[id]` | Detail jednoho bloku | Přihlášení uživatelé |
| PUT | `/api/blocks/[id]` | Upraví blok (role filter) | ADMIN, PLANOVAT, DTP, MTZ |
| DELETE | `/api/blocks/[id]` | Smaže blok | ADMIN, PLANOVAT |

Poznámka k PUT: DTP může upravit pouze DATA pole, MTZ pouze MATERIÁL pole. VIEWER nemůže nic upravit.

### Číselníky

| Metoda | Endpoint | Popis | Kdo může |
|---|---|---|---|
| GET | `/api/codebook?category=DATA` | Načte položky číselníku | Přihlášení uživatelé |
| PUT | `/api/codebook/[id]` | Upraví položku číselníku | ADMIN |
| DELETE | `/api/codebook/[id]` | Smaže položku číselníku | ADMIN |

### Firemní odstávky

| Metoda | Endpoint | Popis | Kdo může |
|---|---|---|---|
| GET | `/api/company-days` | Načte všechny odstávky | Přihlášení uživatelé |
| POST | `/api/company-days` | Přidá novou odstávku | Přihlášení uživatelé |
| DELETE | `/api/company-days/[id]` | Smaže odstávku | Přihlášení uživatelé |

### Admin — uživatelé

| Metoda | Endpoint | Popis | Kdo může |
|---|---|---|---|
| GET | `/api/admin/users` | Seznam uživatelů | ADMIN |
| POST | `/api/admin/users` | Vytvoří nového uživatele | ADMIN |
| PUT | `/api/admin/users/[id]` | Změní roli nebo heslo | ADMIN |
| DELETE | `/api/admin/users/[id]` | Smaže uživatele | ADMIN |

---

## 8. Autentizace a bezpečnost

**Systém přihlašování:**
- Hesla jsou hashována pomocí **bcrypt** (cost faktor 10) — nikdy plain text v databázi
- Po přihlášení se vytvoří **JWT token** podepsaný `JWT_SECRET` — platnost 7 dní
- Token se uloží do **HTTP-only cookie** `integraf-session` — JavaScript na stránce k němu nemá přístup
- Každý API request ověří platnost cookie v middleware (`src/middleware.ts`)

**Co se děje při přihlášení:**
1. Uživatel odešle jméno + heslo na `POST /api/auth/login`
2. Server najde uživatele v DB, porovná bcrypt hash
3. Pokud OK, vytvoří JWT s `{ id, username, role }` a nastaví cookie
4. Middleware kontroluje cookie na každé stránce kromě `/login` a `/api/auth/*`

**Bezpečnostní doporučení pro produkci:**
- Nastavit HTTPS (cookie má `Secure: true` pokud `NODE_ENV=production`)
- Použít silný `JWT_SECRET` (min. 32 znaků, náhodný)
- Pravidelně měnit hesla, zejména admin účtu

---

## 9. Skripty a příkazy — přehled

| Příkaz | Co dělá | Bezpečné v produkci? |
|---|---|---|
| `npm run dev` | Spustí vývojový server | ❌ (jen development) |
| `npm run build` | Sestaví produkční verzi | ✅ |
| `npm run start` | Spustí produkční server | ✅ |
| `npx prisma generate` | Vygeneruje Prisma klient | ✅ |
| `npx prisma migrate deploy` | Aplikuje pending migrace | ✅ |
| `npm run prisma:bootstrap` | Inicializuje číselník + admin (jen pokud prázdné) | ✅ |
| `npm run prisma:seed` | **MAŽE data a vkládá testovací bloky** | ❌❌❌ |
| `npx prisma studio` | Prohlížeč databáze (localhost:5555) | ❌ (jen development) |
| `npx prisma migrate dev` | Vytváří nové migrace | ❌ (jen development) |

---

## 10. Troubleshooting — časté problémy

### „P1001: Can't reach database server"
- Zkontroluj, že MySQL server běží: `systemctl status mysql`
- Zkontroluj `DATABASE_URL` v `.env` — správný host, port, jméno, heslo a název databáze

### „P3009: migrate found failed migrations"
- Migrace selhala napůl — spusť v MySQL konzoli:
  ```sql
  DELETE FROM integraf._prisma_migrations WHERE finished_at IS NULL;
  ```
  Pak znovu `npx prisma migrate deploy`

### „P2002: Unique constraint failed on username"
- Uživatelské jméno už existuje. Bootstrap skript to ošetřuje — pokud se to stane ručně, zkontroluj duplicity v tabulce `User`.

### Aplikace hlásí „Unauthorized" po restartu serveru
- Pokud se `JWT_SECRET` změnil, všechny stávající session jsou neplatné. Uživatelé se musí znovu přihlásit. Zkontroluj, že `.env` obsahuje správný `JWT_SECRET`.

### České znaky se zobrazují špatně (otazníky nebo čtverce)
- Databáze nebo tabulka nemá správnou charset. Zkontroluj:
  ```sql
  SHOW CREATE DATABASE integraf;
  SHOW CREATE TABLE Block;
  ```
  Musí být `CHARACTER SET utf8mb4`. Pokud ne, proveď:
  ```sql
  ALTER DATABASE integraf CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  ```

---

## 11. Struktura projektu (relevantní soubory pro backend)

```
prisma/
├── schema.prisma          ← Definice DB schématu (ZDROJOVÁ PRAVDA)
├── seed.ts                ← Vývojový seed — NIKDY nespouštět na produkci!
├── bootstrap-prod.ts      ← Bezpečná inicializace pro produkci
└── migrations/
    └── DATUM_init_mysql/
        └── migration.sql  ← SQL pro vytvoření tabulek v MySQL

src/
├── lib/
│   ├── prisma.ts          ← Prisma singleton (sdílená instance)
│   └── auth.ts            ← JWT session (createSession/getSession/deleteSession)
├── middleware.ts           ← Edge middleware — JWT guard pro všechny routes
└── app/
    └── api/
        ├── auth/
        │   ├── login/route.ts
        │   └── logout/route.ts
        ├── blocks/
        │   ├── route.ts            ← GET all, POST
        │   └── [id]/route.ts       ← GET, PUT (role filter), DELETE
        ├── codebook/
        │   ├── route.ts            ← GET ?category=
        │   └── [id]/route.ts       ← PUT, DELETE (ADMIN only)
        ├── company-days/
        │   ├── route.ts            ← GET, POST
        │   └── [id]/route.ts       ← DELETE
        └── admin/
            └── users/
                ├── route.ts        ← GET, POST (ADMIN only)
                └── [id]/route.ts   ← PUT, DELETE (ADMIN only)

.env                               ← DATABASE_URL + JWT_SECRET (NESDÍLET VEŘEJNĚ!)
```

---

## 12. Kontaktní poznámky

- Databázi spravuje výhradně Prisma ORM — **neupravuj strukturu tabulek ručně v MySQL**, vždy přes migrace
- Pokud je potřeba přidat nový sloupec nebo tabulku, kontaktuj vývojáře — upraví `schema.prisma` a vygeneruje migraci
- Zálohy databáze: standard MySQL dump (`mysqldump integraf > backup.sql`) — doporučeno pravidelně
