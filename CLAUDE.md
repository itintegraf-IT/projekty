# CLAUDE.md — Integraf Výrobní plán

Tento soubor čte Claude Code automaticky. Udržuj ho aktuální po každé etapě.

---

## O projektu

Interní webová aplikace pro plánování výroby na strojích XL 105 a XL 106.
Umožňuje plánovat zakázky, rezervace a údržbu na časové ose.

**Stack:** Next.js + React + TypeScript + Tailwind CSS v4 + Prisma 5 + MySQL

---

## Stav etap

| Etapa | Název | Stav |
|-------|-------|------|
| 1 | Skeleton, databáze, API, builder formulář | ✅ Hotovo |
| 2 | Timeline render (grid + scroll + filtry) | ✅ Hotovo |
| 3 | Drag & drop + resize + rozdělení | ✅ Hotovo |
| 4 | Směny + svátky + background | ✅ Hotovo |
| 5 | Výrobní sloupečky, stavy, overdue indikace | ✅ Hotovo |
| 6 | Opakování | ✅ Hotovo |
| 7 | Hromadné posuny + zámečky | ✅ Hotovo |
| 8 | Uživatelé, role a přihlašování | ✅ Hotovo |
| 9 | Admin dashboard (uživatelé + číselníky) | ✅ Hotovo |
| 10 | Audit log (kdo co změnil) | ⬜ Nezačato |

### UI/UX light-dark migrace (11. 3. 2026)

- ✅ `next-themes` + theme tokeny + helper transitions
- ✅ Header theme switch (iOS-style, emoji `☀️/🌙`)
- ✅ Migrace hlavních ploch (`PlannerPage`, `TimelineGrid`, `AdminDashboard`, `Login`) na tokeny
- ✅ Kontrastní segmented control `30/60/90`
- ✅ Opravené kontrasty v `BlockDetail` a v CTA `Uložit změny`
- ✅ Deadline stavy:
  - `OK` = zelená
  - `dnes bez OK` = žlutá
  - `po termínu bez OK` = červená
- ✅ Sjednocené akcenty DATA/MATERIÁL/EXPEDICE (tyrkysový základ, stav přebíjí barvu)
- ✅ UX feedback + error handling (Etapa 5 roadmapy):
  - odstraněny tiché `catch {}` v klíčových akcích,
  - přidány `console.error(...)` + uživatelské toasty/chybové hlášky,
  - doplněny loading/disabled stavy u kritických potvrzovacích tlačítek.

---

## Architektura prostředí

### Tři prostředí

| Prostředí | Kde běží | Databáze | Kdo spravuje |
|-----------|----------|----------|--------------|
| **Produkce** | Firemní server (vzdálený) | MySQL — ostrá data | Michal |
| **Vojta local** | MacBook (AMPPS) | MySQL testovací | Vojta |
| **Michal local** | Michalův počítač | MySQL testovací | Michal |

**Klíčové pravidlo:** Git přenáší **jen kód**, nikdy databázi. Každé prostředí má vlastní `.env` (není v gitu).

---

## Workflow pro úpravy

### A) Změna frontendu (vizuální úpravy, UI, bez změny DB)

1. Uprav soubory lokálně
2. Otestuj: `npm run dev`
3. Pushni: `git push origin Vojta`
4. Řekni Michalovi — on na serveru spustí:
   ```bash
   git pull
   npm run build
   npm run start
   ```
5. ✅ Hotovo — **databáze se nedotýká**

### B) Změna databázového schématu (nový sloupec, nová tabulka)

1. Uprav `prisma/schema.prisma` lokálně
2. Vytvoř migraci: `npx prisma migrate dev --name popis_zmeny`
3. Otestuj lokálně
4. Pushni: `git push origin Vojta`
5. Řekni Michalovi — on na serveru spustí:
   ```bash
   git pull
   npx prisma generate
   npx prisma migrate deploy   ← bezpečné, jen přidá sloupce, data nesmaže
   npm run build
   npm run start
   ```

### ⚠️ Co Michal NESMÍ spustit na produkci
- ❌ `npm run prisma:seed` — **smaže všechna ostrá data**
- ❌ `npm run prisma:bootstrap` — jen pro první nasazení (prázdná DB)
- ❌ `npx prisma migrate dev` — jen pro vývoj

---

## Spuštění projektu

**Předpoklad:** AMPPS spuštěný s MySQL, databáze `IGvyroba` existuje.

```bash
npm run dev        # dev server → http://localhost:3000
npx prisma studio  # prohlížeč databáze → http://localhost:5555
```

Po čistém klonu (první nastavení vývojového prostředí):
```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:bootstrap   # vytvoří číselník + admin účet (jen pokud prázdné)
```

`.env` soubor (není v gitu — každý si vytvoří vlastní):
```env
DATABASE_URL="mysql://root:mysql@localhost:3306/IGvyroba?charset=utf8mb4"
JWT_SECRET="integraf-dev-secret-please-change-in-production"
```

### Chyba P3005 — databáze není prázdná
Pokud jste tabulky vytvořili ručně (např. `mysql-schema.sql`) a `prisma migrate deploy` hlásí *"The database schema is not empty"*:
```bash
npx prisma migrate resolve --applied 20260311000000_init_mysql
```
Tím označíte migraci jako již aplikovanou (baseline).

---

## Provedené změny — přechod na MySQL (2026-03)

- **Provider:** SQLite → MySQL (`prisma/schema.prisma`)
- **Databáze:** `IGvyroba`, localhost, root / heslo `mysql`
- **Konfigurace:** `.env` a `.env.example` s `DATABASE_URL`
- **Migrace:** SQLite migrace odstraněny, nová `20260311000000_init_mysql` pro MySQL
- **SQL schema:** `prisma/mysql-schema.sql` — ruční vytvoření DB a tabulek (volitelné)
- **Dokumentace:** `docs/MYSQL_SCHEMA_NAVRH.md` — návrh tabulek včetně AuditLog

---

## Důležitá rozhodnutí

- **Databáze:** MySQL — databáze `IGvyroba`, localhost, root, heslo `mysql`.
- **Prisma verze:** `^5` — záměrně ne `latest` (v7 má breaking changes s novým config systémem)
- **Enumy:** uloženy jako string (SQLite kompatibilita), při přechodu na MySQL Prisma vytvoří ENUM sloupce automaticky
- **Tailwind:** verze 4, používá `@import "tailwindcss"` (ne `@tailwind base`)
- **Číselníky:** hodnoty pro DATA, MATERIÁL, BARVY, LAK jsou uloženy v DB (model `CodebookOption`), ne hardcoded. Spravuje je Admin přes dashboard.
- **Snapshot labelu:** blok ukládá `optionId` + `snapshotLabel` — při přejmenování položky číselníku historická data zůstanou konzistentní.
- **Auth:** bcryptjs (hesla), jose (JWT), HTTP-only cookie `integraf-session` (7 dní). Middleware v `src/middleware.ts` chrání všechny routes kromě `/login` a `/api/auth`. Import jose přes subpath (`jose/jwt/verify`, `jose/jwt/sign`) — nutné pro Turbopack Edge runtime.
- **Roles:** ADMIN a PLANOVAT — plný přístup. DTP — edituje jen DATA sloupec. MTZ — edituje jen MATERIÁL sloupec. VIEWER — read-only (aside skrytý, timeline bez drag/resize).
- **tsconfig moduleResolution:** `"bundler"` (ne `"Node"`) — nutné pro subpath exports (jose).
- **next.config.mjs:** bez `experimental.appDir` (odstraněno jako obsoletní v Next.js 14+).

---

## Klíčové soubory

| Soubor | Účel |
|--------|------|
| `prisma/schema.prisma` | DB schema — Block + CodebookOption + User modely |
| `prisma/mysql-schema.sql` | Ruční SQL pro vytvoření DB IGvyroba a tabulek (volitelné) |
| `docs/MYSQL_SCHEMA_NAVRH.md` | Návrh MySQL tabulek včetně AuditLog (Etapa 10) |
| `src/lib/prisma.ts` | Prisma singleton klient |
| `src/app/page.tsx` | Server Component — načítá bloky + companyDays z DB |
| `src/app/api/company-days/route.ts` | GET + POST firemních dnů |
| `src/app/api/company-days/[id]/route.ts` | DELETE firemního dne |
| `src/app/api/codebook/route.ts` | GET číselníku dle category (etapa 5) |
| `src/app/api/codebook/[id]/route.ts` | PUT + DELETE položky číselníku (ADMIN only) |
| `src/app/api/admin/users/route.ts` | GET (seznam) + POST (nový uživatel) — ADMIN only |
| `src/app/api/admin/users/[id]/route.ts` | PUT (role/heslo) + DELETE — ADMIN only |
| `src/app/admin/page.tsx` | Admin dashboard stránka (ADMIN only) |
| `src/app/admin/_components/AdminDashboard.tsx` | Client component — iOS admin UI |
| `src/app/_components/PlannerPage.tsx` | Client Component — builder + fronta + detail + ShutdownManager |
| `src/app/_components/TimelineGrid.tsx` | Vizuální timeline grid (datum 44px + čas 72px + 2 strojové sloupce) |
| `src/app/api/blocks/route.ts` | GET all + POST (POST: ADMIN/PLANOVAT) |
| `src/app/api/blocks/[id]/route.ts` | GET + PUT (role field filter) + DELETE (ADMIN/PLANOVAT) |
| `src/lib/auth.ts` | createSession / getSession / deleteSession (JWT + cookie) |
| `src/middleware.ts` | Edge middleware — JWT guard pro všechny routes |
| `src/app/login/page.tsx` | Login stránka (token-based, light/dark) |
| `src/app/api/auth/login/route.ts` | POST — přihlášení, vytvoření session |
| `src/app/api/auth/logout/route.ts` | POST — odhlášení, smazání cookie |
| `DOKUMENTACE.md` | Plná projektová dokumentace (neupravuj ručně) |

---

## Architektura UI (po etapě 2+3 refaktoru)

### TimelineGrid.tsx
- `SLOT_HEIGHT = 26px` výchozí, ale dynamický — předává se jako prop `slotHeight` z PlannerPage
- **Konfigurovatelný rozsah:** props `daysAhead?: number` (default 30) a `daysBack?: number` (default 3). Uvnitř komponenty se počítá `effectiveDaysBack`/`effectiveDaysAhead`/`totalDays` dynamicky.
- Zoom slider v headeru mění `slotHeight` (3–26 px), zoom kotví na střed viewportu (`zoomAnchorMs` ref)
- Adaptivní časové štítky: krok štítků se mění dle `slotHeight` (každých 30 min / 1 hod / 2 hod / 4 hod)
- `DATE_COL_W = 44px` sticky left:0 — datum, barva dne (dnes=modrá, víkend=oranžová)
- `TIME_COL_W = 72px` — každých 30 min, celé hodiny výraznější
- **Sticky day label:** label dne (Po/5/Bře) je obalený v `position: sticky, top: HEADER_HEIGHT` uvnitř absolutně pozicované buňky — zůstává viditelný celý den při vertikálním scrollu
- Drag existujícího bloku: mouse events, snap na grid **during** drag, landing zone = přerušovaný barevný obdélník, původní blok ghostuje na místě
- Drop z fronty: HTML5 DnD (`draggable`, `onDragStart`, `onDragOver`, `onDrop`), modrý přerušovaný obdélník jako preview
- **BlockCard layout** (výškové prahy):
  - `>= 40px`: číslo + popis (řádek 1)
  - `>= 62px`: klikatelné DateBadge (DATA / MAT. / EXP.) — klik toggles `dataOk`/`materialOk` přes PUT API
  - `>= 80px`: specifikace (celý text, max 2 řádky)
  - `>= 100px`: StatusNote labely ze selectů (dataStatusLabel, materialStatusLabel, barvy, lak)
- **DateBadge:** zelená = `ok`, žlutá = termín je dnes a není `ok`, červená = termín je po datu a není `ok`, neutrální = datum ještě nenastalo
- **fmtDate():** helper pro parse DB timestamps (ISO i date string) — nikdy nepoužívat `new Date(s + "T00:00:00")`
- **Warn/danger logika:** `deadlineState(requiredDate, ok, now)`:
  - `warning`: `isSameDay(due, now) && !ok`
  - `danger`: `startOfDay(now) > startOfDay(due) && !ok`

### PlannerPage.tsx
- Builder: typ + číslo zakázky + délka + popis + výrobní sloupečky + termín expedice → "Přidat do fronty"
- Fronta: kartičky s `draggable`, přetažením na timeline vznikne blok (stroj = cílový sloupec, čas = pozice puštění)
- `QueueItem` typ: id, orderNumber, type, durationHours, description, dataStatusId, materialStatusId, barvyStatusId, lakStatusId, specifikace, deadlineExpedice
- Aside panel je resizable (8px handle), zIndex: 10; timeline container zIndex: 0; sticky header zIndex: 30
- **Role-based UI (etapa 8):** `canEdit = ["ADMIN","PLANOVAT"].includes(role)`, `canEditData = canEdit || DTP`, `canEditMat = canEdit || MTZ`. Aside + resize handle skryté pokud `!canEdit`. BlockEdit sekce obaleny `opacity/pointerEvents` wrappery. TimelineGrid dostává `canEdit` prop.
- Header vpravo: jméno uživatele + role badge + Odhlásit tlačítko
- **Konfigurovatelný rozsah:** state `daysAhead` (default 60) a `daysBack` (default 3). V headeru segmented buttons [30d|60d|90d] pro přepínání dopředu.
- **„Přejít na" pro historické bloky:** pokud hledaná zakázka (filterText) leží před viewStart, zobrazí se žlutý banner s tlačítkem. Klik rozšíří `daysBack` a scrollne na blok. Logika: `pendingScrollMs` ref + `useLayoutEffect([daysBack])`.
- **DatePickerField** — viz sekce níže

### DatePickerField (vlastní komponenta)
- Plně vlastní custom komponenta v `PlannerPage.tsx` — **bez react-day-picker ani shadcn Calendar**
- iOS-style popup: tmavé pozadí `#1c1c1e`, kulaté buňky 36×36px, CSS grid s pevnými rozměry
- Dnes = modrý rámeček + tučné číslo; vybraný den = plné modré kolečko
- Měsíc/rok v hlavičce, šipky pro navigaci
- **Použití všude místo `<input type="date">`** — Job Builder (DATA datum, MATERIÁL datum, Expedice), BlockEdit (DATA, MATERIÁL, Expedice), ShutdownManager (Od/Do), header toolbar (skok na datum)
- Konstanty `MONTH_NAMES_CS`, `DAY_NAMES_CS`, `navBtnStyle` definovány mimo komponentu na module level

### shadcn/ui
- Styl: New York
- Nainstalované: Button, Input, Textarea, Label, Switch, Badge, Separator, **Select, Popover, Calendar** (Calendar se nepoužívá — nahrazena vlastní DatePickerField)
- **Select:** `<SelectContent>` musí vždy dostat `className="bg-slate-900 border-slate-700"` — jinak Radix portál nezdědí dark mode a zobrazí bílé pozadí
- **Popover:** stále používán jako obal DatePickerField (`PopoverContent` s `border-0` a inline `background: "#1c1c1e"`)
- Pro etapu 9 doinstalovat: Tooltip, Dialog, AlertDialog, Table, Tabs

---

## DB Schema — Block model

Pole: id, orderNumber, machine (XL_105|XL_106), startTime, endTime, type (ZAKAZKA|REZERVACE|UDRZBA),
description, locked, deadlineExpedice,
dataStatusId, dataStatusLabel, dataRequiredDate, dataOk,
materialStatusId, materialStatusLabel, materialRequiredDate, materialOk,
barvyStatusId, barvyStatusLabel,
lakStatusId, lakStatusLabel,
specifikace,
recurrenceType (NONE|DAILY|WEEKLY|MONTHLY), recurrenceParentId (self-relace),
createdAt, updatedAt.

Poznámka: Stará pole `deadlineData`, `deadlineMaterial`, `deadlineDataOk`, `deadlineMaterialOk` a `pantoneExpectedDate` jsou odstraněna a nahrazena novým schématem výrobních sloupečků (migrace provedena).

## DB Schema — CodebookOption model

Pole: id, category (DATA|MATERIAL|BARVY|LAK), label, sortOrder, isActive, shortCode (nullable), isWarning.
Seed default hodnot je součástí etapy 5.

## DB Schema — User model

Pole: id, username (unique), passwordHash, role (ADMIN|PLANOVAT|MTZ|DTP|VIEWER), createdAt

---

## Pravidlo: přidávání nových výrobních sloupečků

Při každém přidání nového výrobního sloupečku do bloku je nutné vždy vyřešit všechny tyto body:

1. **DB číselník** — vytvořit nebo rozšířit `CodebookOption` (category + default hodnoty)
2. **Seed hodnot** — doplnit `prisma/seed.ts` o nové default položky
3. **Role oprávnění** — rozhodnout, která role smí sloupec editovat (matice v DOKUMENTACE.md)
4. **UI v timeline** — zobrazit badge na bloku, not-ready indikaci (⚠ pokud platí logika)
5. **UI v builderu** — přidat shadcn `<Select>` (SelectContent s `className="bg-slate-900 border-slate-700"`) + `<DatePickerField>` do formuláře
6. **Not-ready logiku** — pokud sloupec má `requiredDate`, implementovat varování `now > requiredDate && !ok`
7. **Aktualizovat DOKUMENTACE.md** — přidat do tabulky výrobních sloupečků, matice práv, etapy

---

## Design — Apple standard

Veškeré nové UI komponenty a úpravy existujících musí dodržovat tyto zásady:

- **Systémové fonty:** `-apple-system, BlinkMacSystemFont, "SF Pro Text"` — nikdy Google Fonts
- **Tenké tahy:** bordery max 1px, ideálně 0.5px nebo `rgba` s nízkou opacitou
- **Spacing v násobcích 4 px:** 4, 8, 12, 16, 20, 24…
- **Žádné nativní prvky bez restylu:** `<input type="range">`, `<select>`, `<input type="date">` musí mít vlastní vizuál
- **Interaktivní prvky:** jemný hover (opacity nebo brightness), žádné těžké box-shadow na hover
- **Animace:** `transition` max 150 ms, ease-out nebo spring — nikdy lineární
- **Barvy:** tmavé pozadí `#0a0a0f` / `#111318`, akcenty bílá nebo `#3b82f6` (blue-500), žlutá `#FFE600` pro CTA
- **Vlastní komponenty místo shadcn:** pro složitější prvky (slider, dropdown, date picker) preferuj custom implementaci která přesně sedí do designu
- **shadcn/ui:** jen pro jednoduché primitiva (Button, Input, Badge) kde se vizuál hodí

---

## Etapa 10 — Audit log (plán, nezačato)

### Cíl
Sledovat, kdo a co změnil — ale jen smysluplné akce, ne každý drag & drop.

### Co se loguje (selektivní audit)
| Akce | Trigger |
|------|---------|
| Přidání bloku | POST `/api/blocks` |
| Smazání bloku | DELETE `/api/blocks/[id]` |
| Změna DATA stavu / data | PUT — pole `dataStatusId`, `dataStatusLabel`, `dataRequiredDate` |
| Toggle dataOk | PUT — pole `dataOk` |
| Změna MATERIÁL stavu / data | PUT — pole `materialStatusId`, `materialStatusLabel`, `materialRequiredDate` |
| Toggle materialOk | PUT — pole `materialOk` |
| Změna termínu expedice | PUT — pole `deadlineExpedice` |

### Co se NELOGUJE
- Drag & drop (startTime/endTime) — příliš časté, nezajímavé pro audit
- Resize bloků
- Změna popisu, specifikace, barvy, laku
- Zamčení/odemčení bloku

### DB schema — nový model `AuditLog`
```prisma
model AuditLog {
  id        Int      @id @default(autoincrement())
  blockId   Int
  userId    Int
  username  String
  action    String   // "CREATE" | "DELETE" | "UPDATE"
  field     String?  // název pole (např. "dataStatusLabel", "dataOk", "deadlineExpedice")
  oldValue  String?  // předchozí hodnota (serializovaná jako string)
  newValue  String?  // nová hodnota
  createdAt DateTime @default(now())
}
```

Pozn.: `blockId` bez FK (blok může být smazán, ale log chceme zachovat).

### Implementace v API routes
V každé chráněné PUT/POST/DELETE route:
1. Zjistit `session` (getSession)
2. Pro PUT: porovnat starý stav (Prisma `findUnique` před update) s novým — logovat jen změněná sledovaná pole
3. Pro POST: logovat `action: "CREATE"` s `blockId` nového bloku
4. Pro DELETE: logovat `action: "DELETE"` před smazáním (aby bylo `blockId` ještě platné)
5. `prisma.auditLog.create({ data: { blockId, userId, username, action, field, oldValue, newValue } })`

### UI
- **Admin dashboard (etapa 9):** tabulka posledních N záznamů — datum, uživatel, zakázka, akce, stará/nová hodnota
- **BlockEdit:** mini-sekce "Historie změn" dole — posledních 10 logů pro daný blok (GET `/api/blocks/[id]/audit`)
- Nová API route: GET `/api/audit?limit=50` (admin) + GET `/api/blocks/[id]/audit`

### Pořadí implementace
Etapa 10 musí přijít **po Etapě 9** — v admin dashboardu budou reální uživatelé (ne jen seed), takže audit log dává smysl až tehdy.

### Nové soubory pro etapu 10
- `src/app/api/audit/route.ts` — GET posledních N záznamů (jen ADMIN)
- `src/app/api/blocks/[id]/audit/route.ts` — GET logu pro konkrétní blok

---

---

## Přechod na produkci — MySQL

### Co NIKDY nedělat na produkci
- ❌ `npm run prisma:seed` — **smaže všechna data** (bloky + číselníky). Chráněno kontrolou `NODE_ENV=production`.
- ❌ `npx prisma db push --accept-data-loss` — může dropnout sloupce/tabulky.
- ❌ `npx prisma migrate dev` — jen pro vývoj, může přetvářet tabulky.

### Co je bezpečné na produkci
- ✅ `npx prisma migrate deploy` — aplikuje jen pending migrace, data nesmaže.
- ✅ `npm run prisma:bootstrap` — bezpečná inicializace: vytvoří číselník a admin účet **pouze pokud neexistují**.
- ✅ `npm run build && npm run start` — standardní spuštění.

### Krok za krokem: přechod SQLite → MySQL

**1. Upravit `prisma/schema.prisma`:**
```prisma
datasource db {
  provider = "mysql"   // bylo "sqlite"
  url      = env("DATABASE_URL")
}
```

**2. Vygenerovat MySQL migrace** (na vývojovém počítači s prázdnou MySQL):
```bash
DATABASE_URL="mysql://root:mysql@localhost:3306/IGvyroba"
npx prisma migrate dev --name init_mysql
```
Starší SQLite migrace (`prisma/migrations/20260303...`) pro MySQL nefungují — nové je nahradí.

**3. Env proměnné na produkčním serveru:**
```env
DATABASE_URL="mysql://root:mysql@localhost:3306/IGvyroba"
JWT_SECRET="<min. 32 náhodných znaků — vygeneruj: openssl rand -base64 32>"
NODE_ENV="production"
```

**4. První nasazení na server:**
```bash
npm install
npx prisma generate          # vygeneruje Prisma klient
npx prisma migrate deploy    # vytvoří tabulky v MySQL
npm run prisma:bootstrap     # vytvoří číselník + admin účet (jen pokud prázdné)
npm run build
npm run start
```

**5. Každé další nasazení (update aplikace):**
```bash
npm install
npx prisma generate
npx prisma migrate deploy    # aplikuje nové migrace (pokud jsou)
npm run build
npm run start
# ⚠️ NESPOUŠTĚT seed ani bootstrap — data už existují
```

### Bootstrap vs Seed — rozdíl

| | `prisma:seed` | `prisma:bootstrap` |
|---|---|---|
| Maže bloky | ✅ ANO | ❌ NE |
| Maže číselník | ✅ ANO | ❌ NE |
| Vytváří číselník | vždy (přepíše) | pouze pokud prázdný |
| Vytváří admin | upsert | pouze pokud žádný neexistuje |
| Bezpečné v produkci | ❌ NE | ✅ ANO |
| Určeno pro | vývoj (reset) | první spuštění v produkci |

### První přihlášení v produkci
Bootstrap vytvoří `admin` s heslem `ChangeMe123!`.
**Okamžitě změň heslo** přes Admin dashboard → Uživatelé → Heslo.

---

## Komunikace

- Vždy komunikuj česky
- Uživatel nerozumí databázím — vysvětlovat jednoduše
- Před větší implementací vždy použij EnterPlanMode
