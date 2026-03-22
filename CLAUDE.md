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
| 10 | Audit log (kdo co změnil) + tlačítko Info | ✅ Hotovo |
| 11 | UX vylepšení — odstávky, podmíněné formátování, inline datepicker | ⬜ Nezačato |
| — | Varianty zakázky (blockVariant) | ✅ Hotovo (2026-03-22) |

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
- **Roles:** ADMIN a PLANOVAT — plný přístup. DTP — edituje jen DATA sloupec. MTZ — edituje jen MATERIÁL sloupec. VIEWER — read-only (aside skrytý, timeline bez drag/resize). **TISKAR** — read-only plánovač, přístup do `/tiskar`, může potvrdit tisk jen na svém `assignedMachine`.
- **tsconfig moduleResolution:** `"bundler"` (ne `"Node"`) — nutné pro subpath exports (jose).
- **next.config.mjs:** bez `experimental.appDir` (odstraněno jako obsoletní v Next.js 14+).

---

## Klíčové soubory

| Soubor | Účel |
|--------|------|
| `prisma/schema.prisma` | DB schema — Block + CodebookOption + User + AuditLog modely |
| `prisma/mysql-schema.sql` | Ruční SQL pro vytvoření DB IGvyroba a tabulek (volitelné) |
| `src/lib/prisma.ts` | Prisma singleton klient |
| `src/app/page.tsx` | Server Component — načítá bloky + companyDays z DB |
| `src/app/api/company-days/route.ts` | GET + POST firemních dnů |
| `src/app/api/company-days/[id]/route.ts` | DELETE firemního dne |
| `src/app/api/codebook/route.ts` | GET číselníku dle category (etapa 5) |
| `src/app/api/codebook/[id]/route.ts` | PUT + DELETE položky číselníku (ADMIN only) |
| `src/app/api/admin/users/route.ts` | GET (seznam) + POST (nový uživatel) — ADMIN only |
| `src/app/api/admin/users/[id]/route.ts` | PUT (role/heslo) + DELETE — ADMIN only |
| `src/app/api/audit/route.ts` | GET posledních 50 audit záznamů — ADMIN only |
| `src/app/api/audit/today/route.ts` | GET audit záznamů posledních 3 dnů od DTP+MTZ — ADMIN+PLANOVAT |
| `src/app/api/blocks/[id]/audit/route.ts` | GET posledních 10 záznamů pro konkrétní blok — ADMIN+PLANOVAT+DTP+MTZ |
| `src/app/admin/page.tsx` | Admin dashboard stránka (ADMIN only) |
| `src/app/admin/_components/AdminDashboard.tsx` | Client component — iOS admin UI (záložka Audit log) |
| `src/app/_components/PlannerPage.tsx` | Client Component — builder + fronta + detail + ShutdownManager + InfoPanel |
| `src/app/_components/TimelineGrid.tsx` | Vizuální timeline grid (datum 44px + čas 72px + 2 strojové sloupce) |
| `src/app/api/blocks/route.ts` | GET all + POST (POST: ADMIN/PLANOVAT, transakční zápis + audit) |
| `src/app/api/blocks/[id]/route.ts` | GET + PUT (role field filter, transakční audit createMany) + DELETE (ADMIN/PLANOVAT) |
| `src/lib/auth.ts` | createSession / getSession / deleteSession (JWT + cookie) — SessionUser obsahuje `assignedMachine` |
| `src/middleware.ts` | Edge middleware — JWT guard pro všechny routes |
| `src/app/login/page.tsx` | Login stránka (token-based, light/dark) |
| `src/app/api/auth/login/route.ts` | POST — přihlášení, vytvoření session |
| `src/app/api/auth/logout/route.ts` | POST — odhlášení, smazání cookie |
| `src/app/api/blocks/[id]/complete/route.ts` | POST — potvrzení/vrácení tisku (TISKAR jen na svém stroji, ADMIN/PLANOVAT kdekoliv) |
| `src/app/api/blocks/batch/route.ts` | POST — dávkový update startTime/endTime/machine (lasso přesuny), validace schedule, PRINT_RESET, audit |
| `src/app/api/machine-shifts/route.ts` | GET + PUT provozních hodin strojů per-den (MachineWorkHours) |
| `src/app/api/machine-exceptions/route.ts` | GET + POST výjimek pro konkrétní datum+stroj (upsert) |
| `src/app/api/machine-exceptions/[id]/route.ts` | DELETE výjimky |
| `src/app/tiskar/page.tsx` | Tiskar view — Server Component pro roli TISKAR |
| `src/app/tiskar/_components/TiskarMonitor.tsx` | Tiskar monitor — schedule stroje 7 dní, polling 30s, potvrzení tisku |
| `src/lib/badgeColors.ts` | BADGE_COLOR_KEYS, badgeColorVar(), parseBadgeColor() — helper pro `CodebookOption.badgeColor` |
| `src/lib/blockVariants.ts` | BLOCK_VARIANTS, BlockVariant, normalizeBlockVariant — varianty zakázky |
| `src/lib/machineScheduleException.ts` | Typy pro MachineScheduleException |
| `src/lib/machineWorkHours.ts` | Typy pro MachineWorkHours |
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
- `QueueItem` typ: id, orderNumber, type, **blockVariant**, durationHours, description, dataStatusId, materialStatusId, barvyStatusId, lakStatusId, specifikace, deadlineExpedice
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
**blockVariant (String @default("STANDARD") — STANDARD|BEZ_TECHNOLOGIE|BEZ_SACKU|POZASTAVENO, jen pro ZAKAZKA)**,
description, locked, deadlineExpedice,
dataStatusId, dataStatusLabel, dataRequiredDate, dataOk,
materialStatusId, materialStatusLabel, materialRequiredDate, materialOk,
barvyStatusId, barvyStatusLabel,
lakStatusId, lakStatusLabel,
specifikace,
recurrenceType (NONE|DAILY|WEEKLY|MONTHLY), recurrenceParentId (self-relace),
**printCompletedAt (DateTime?), printCompletedByUserId (Int?), printCompletedByUsername (String?)** — potvrzení tisku tiskaři,
createdAt, updatedAt.

Poznámka: Stará pole `deadlineData`, `deadlineMaterial`, `deadlineDataOk`, `deadlineMaterialOk` a `pantoneExpectedDate` jsou odstraněna a nahrazena novým schématem výrobních sloupečků (migrace provedena).

## DB Schema — CodebookOption model

Pole: id, category (DATA|MATERIAL|BARVY|LAK), label, sortOrder, isActive, shortCode (nullable), isWarning, **badgeColor (String? — klíč z BADGE_COLOR_KEYS)**.

## DB Schema — CompanyDay model

Pole: id, startDate, endDate, label, **machine (String? — null = obě stroje, „XL_105"/„XL_106" = jen daný stroj)**, createdAt.

## DB Schema — User model

Pole: id, username (unique), passwordHash, role (ADMIN|PLANOVAT|MTZ|DTP|VIEWER|**TISKAR**), **assignedMachine (String? — pro TISKAR: „XL_105" nebo „XL_106")**, createdAt.

## DB Schema — MachineWorkHours model

Pole: id, machine (XL_105|XL_106), dayOfWeek (0=neděle…6=sobota), startHour (0–23), endHour (1–24), isActive.
Unique constraint: `(machine, dayOfWeek)`. Index: `machine`.
Slouží pro validaci při drag&drop i batch update — blok ZAKAZKA nesmí zasahovat mimo provozní hodiny.

## DB Schema — MachineScheduleException model

Pole: id, machine, date (DateTime — uloženo jako UTC midnight), startHour, endHour, isActive, label (String?), createdAt.
Unique constraint: `(machine, date)`. Index: `date`.
Výjimka přebíjí MachineWorkHours pro daný den. Upsert pattern — jeden záznam per stroj+datum.
Seed default hodnot je součástí etapy 5.

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

## Etapa 10 — Audit log ✅ Hotovo (2026-03-16)

### Co se loguje (selektivní audit)
| Akce | Trigger |
|------|---------|
| Přidání bloku | POST `/api/blocks` |
| Smazání bloku | DELETE `/api/blocks/[id]` |
| Změna DATA stavu / data / OK | PUT — `dataStatusLabel`, `dataRequiredDate`, `dataOk` |
| Změna MATERIÁL stavu / data / OK | PUT — `materialStatusLabel`, `materialRequiredDate`, `materialOk` |
| Změna termínu expedice | PUT — `deadlineExpedice` |

### Co se loguje — rozšíření (2026-03-21)
| Akce | Trigger |
|------|---------|
| Hromadný posun bloků | POST `/api/blocks/batch` — pole `startTime/endTime/machine` |
| Reset potvrzení tisku při přesunu | POST `/api/blocks/batch` — akce `PRINT_RESET` |
| Potvrzení tisku | POST `/api/blocks/[id]/complete` — akce `PRINT_COMPLETE` |
| Vrácení potvrzení tisku | POST `/api/blocks/[id]/complete` — akce `PRINT_UNDO` |

### Co se NELOGUJE
- Drag & drop jednotlivých bloků (startTime/endTime), resize, popis, specifikace, barvy, lak, zámek

### DB model `AuditLog`
```prisma
model AuditLog {
  id          Int      @id @default(autoincrement())
  blockId     Int                          // bez FK — log přežije smazání bloku
  orderNumber String?
  userId      Int
  username    String
  action      String                       // "CREATE" | "DELETE" | "UPDATE"
  field       String?
  oldValue    String?
  newValue    String?
  createdAt   DateTime @default(now())

  @@index([blockId, createdAt])
  @@index([createdAt])
}
```

### Klíčová rozhodnutí implementace
- **Transakce:** POST (CREATE + audit), PUT (findUnique + update + audit), DELETE (audit + delete) — všechny atomické přes `prisma.$transaction()`
- **createMany:** PUT používá jedno `auditLog.createMany()` místo cyklu create() — jeden DB round-trip pro všechna změněná pole
- **Oprávnění `/api/blocks/[id]/audit`:** ADMIN, PLANOVAT, DTP, MTZ — VIEWER nemá přístup (audit je provozní interní info)
- **Info panel:** bell ikona v headeru (ADMIN+PLANOVAT), záznamy posledních 3 dnů od DTP+MTZ, auto-refresh každých 60s + refresh při otevření, badge count při chybě fetchuje zachovává poslední validní stav
- **localStorage klíč:** `auditLastSeen` — čas posledního otevření panelu pro výpočet badge count

### API routes
- `GET /api/audit?limit=50` — ADMIN only, posledních 50 záznamů
- `GET /api/audit/today` — ADMIN+PLANOVAT, záznamy posledních 3 dnů od DTP+MTZ uživatelů
- `GET /api/blocks/[id]/audit` — ADMIN+PLANOVAT+DTP+MTZ, posledních 10 záznamů pro blok

### UI
- **Info panel** (bell ikona v headeru) — záznamy DTP/MTZ za posl. 3 dny, proklik na zakázku
- **BlockDetail** — sekce "Historie změn" s posledními 10 záznamy pro daný blok
- **Admin dashboard** — záložka "Audit log" s tabulkou posledních 50 záznamů

---

## Etapa TISKAR + Batch API ✅ Hotovo (2026-03-21)

### Role TISKAR
- Nová role `TISKAR` — read-only na plánovači, přístup jen na `/tiskar`
- User má `assignedMachine: String?` — přiřazený stroj (`XL_105` nebo `XL_106`)
- `SessionUser` interface obsahuje `assignedMachine` — je součástí JWT tokenu
- Middleware pustí TISKAR na `/tiskar` i `/api/blocks/[id]/complete`

### Potvrzení tisku (printCompleted)
- Block má 3 nová pole: `printCompletedAt`, `printCompletedByUserId`, `printCompletedByUsername`
- API: `POST /api/blocks/[id]/complete` s body `{ completed: boolean }`
  - `completed: true` → nastaví printCompleted* pole
  - `completed: false` → vymaže (undo)
- Role: TISKAR (jen svůj stroj), ADMIN, PLANOVAT
- Jen ZAKAZKA bloky (ne REZERVACE/UDRZBA)
- **PRINT_RESET**: pokud se blok přesune (batch nebo single drag) a byl označen jako vytisknut → automaticky se reset a loguje akce `PRINT_RESET`

### TiskarMonitor
- Stránka `/tiskar` — Server Component načítá bloky daného stroje (7 dní dopředu)
- Komponenta `TiskarMonitor.tsx` — mini timeline (jen jeden stroj, SLOT_HEIGHT=26, HEADER_H=52)
- Polling každých 30s (`setInterval`) — auto-refresh bez F5
- Vizuál: modrý blok = nezahájen, zelený blok = vytisknut (printCompletedAt != null)

### MachineWorkHours — provozní hodiny strojů
- Tabulka per stroj + den týdne (unique constraint)
- API: `GET /api/machine-shifts` (všichni přihlášení), `PUT /api/machine-shifts` (ADMIN/PLANOVAT)
- Validace při drag&drop i batch update — blok ZAKAZKA nesmí zasahovat mimo provozní hodiny
- `checkScheduleViolation()` funkce — slot-by-slot kontrola po 30 min (Europe/Prague timezone přes Intl.DateTimeFormat)

### MachineScheduleException — výjimky hodin
- Výjimka pro konkrétní datum+stroj přebíjí MachineWorkHours
- API: `GET /api/machine-exceptions`, `POST /api/machine-exceptions` (upsert), `DELETE /api/machine-exceptions/[id]`
- Date storage: klient posílá YYYY-MM-DD string → server uloží jako UTC midnight (`new Date(datePart + "T00:00:00.000Z")`)
- **POZOR:** nikdy nepoužívat `getFullYear()/getMonth()/getDate()` na serveru pro datumovou konverzi — na UTC serveru se CZ půlnoc = předchozí UTC den. Vždy slice první 10 znaků ISO stringu.

### Batch update bloků
- API: `POST /api/blocks/batch` s body `{ updates: [{ id, startTime, endTime, machine }] }`
- Role: ADMIN, PLANOVAT only
- Validace: 1) sanity check časů (start < end) před DB, 2) schedule validace jen ZAKAZKA bloků (paralelní fetch schedule+exceptions)
- Transakce: `prisma.$transaction` — `Promise.all` updatů + `auditLog.createMany` v jednom round-tripu
- Používá se pro lasso hromadné přesuny v TimelineGrid

### CompanyDay.machine
- Pole `machine: String?` — `null` = odstávka pro oba stroje, `"XL_105"`/`"XL_106"` = jen pro jeden

### badgeColor na CodebookOption
- Pole `badgeColor: String?` — klíč z `BADGE_COLOR_KEYS` (`blue`, `green`, `orange`, `red`, `purple`, `cyan`, `lime`, `pink`, `black`)
- Helper funkce v `src/lib/badgeColors.ts`:
  - `badgeColorVar(key)` → CSS token `var(--badge-<key>)` nebo null
  - `parseBadgeColor(value)` → validace a normalizace z API payloadu
- CSS tokeny definovány v `globals.css` jako CSS custom properties

---

## Varianty zakázky (blockVariant) ✅ Hotovo (2026-03-22)

### Přehled variant

| Varianta | Label v UI | Barva bloku |
|---|---|---|
| `STANDARD` | Klasická | modrá `#3b82f6` (stávající) |
| `BEZ_TECHNOLOGIE` | Bez technologie | tmavě smaragdová `#059669` |
| `BEZ_SACKU` | Bez sáčku | oranžová `#e36414` |
| `POZASTAVENO` | Pozastaveno | červená `#d00000` |

### Klíčová rozhodnutí
- **Jen pro ZAKAZKA** — REZERVACE a UDRZBA mají vždy `STANDARD`, UI sekci nezobrazuje
- **POZASTAVENO = čistě vizuální** — blok je plně funkční (drag, resize, edit), jen barva se mění
- **Priorita stylů:** `printDone (zelená) > POZASTAVENO (červená) > overdue (šedá) > typ barva`
  - POZASTAVENO přebíjí šedý overdue stav — plánovač okamžitě vidí pozastavení i u bloků po termínu
- **Server invariant:** `normalizeBlockVariant()` zajišťuje STANDARD pokud typ není ZAKAZKA — platí na POST i PUT
- **PUT edge case:** při změně `type` bez `blockVariant` v těle — fallback na `oldBlock.blockVariant` (netiché přepsání na STANDARD)

### Sdílený modul `src/lib/blockVariants.ts`
```typescript
export const BLOCK_VARIANTS = ["STANDARD", "BEZ_TECHNOLOGIE", "BEZ_SACKU", "POZASTAVENO"] as const;
export type BlockVariant = typeof BLOCK_VARIANTS[number];
export function normalizeBlockVariant(variant, type): BlockVariant { ... }
```
Importován z API routes (server) i client komponent — `PlannerPage.tsx` není zdrojem sdílených konstant.

### Propagace varianty
Všechny create cesty propagují `blockVariant`:
- Drop z fronty, paste (single i group), undo/restore, split bloku (POST druhé poloviny)

### Audit
Změna `blockVariant` je logována v `AuditLog` (pole `"blockVariant"`, oldValue/newValue).

### Klíčové soubory
- `src/lib/blockVariants.ts` — BLOCK_VARIANTS, BlockVariant, normalizeBlockVariant
- `prisma/migrations/20260322161950_add_block_variant/` — migrace pro nové pole
- `src/app/_components/TimelineGrid.tsx` — BLOCK_STYLES (3 nové záznamy + helper `getBlockStyleKey`)
- `src/app/_components/PlannerPage.tsx` — VARIANT_CONFIG, selektor v builderu i BlockEdit
- `src/app/api/blocks/route.ts` — POST normalizuje variantu
- `src/app/api/blocks/[id]/route.ts` — PUT normalizuje + audit

---

## Etapa 11 — UX vylepšení (plán, nezačato)

### 1. Odstávky plánované hodinově (ne na celé dny)
- Aktuálně: `ShutdownManager` ukládá `startDate` a `endDate` jako celé dny
- Cíl: umožnit zadání konkrétního času (např. odstávka 6:00–14:00)
- Změny:
  - `CompanyDay` model: přidat `startTime` a `endTime` (čas v rámci dne), nebo přejít na `DateTime` s časem
  - `ShutdownManager` UI: místo DatePickerField přidat kombinaci datum + výběr hodiny
  - `TimelineGrid`: tint pásy odstávek zobrazovat jen v daném časovém rozmezí (ne celý den)

### 2. Podmíněné formátování — materiál/data až po startu zakázky
- Cíl: upozornit plánovače pokud blok začíná dříve, než je očekáván materiál nebo data
- Logika: `block.startTime > materialRequiredDate && !materialOk` → oranžový/červený rámeček nebo ikona na bloku
- Příklad: zakázka na dnešek 8:00, materiál očekáván zítra → blok vizuálně označen jako "materiál dorazí až po startu"
- Implementace v `BlockCard` — nová vrstva varování nad stávající `deadlineState` logikou

### 3. Inline datepicker pro MTZ — změna data materiálu přímo z timeline
- Cíl: MTZ může změnit `materialRequiredDate` přímo z bloku bez otevření plného BlockEdit
- Interakce: **dvojklik** na ikonku/badge MATERIÁL v BlockCard
- Otevře se `DatePickerField` popup přímo u bloku (absolutně pozicovaný)
- Po výběru data: PUT request na `/api/blocks/[id]` s novým `materialRequiredDate`
- Role: jen MTZ, DTP (a ADMIN/PLANOVAT) mohou tuto akci provést — stejná pravidla jako existující `canEditMat`
- Analogicky lze přidat stejnou funkci pro DATA (dvojklik na DATA badge → DTP může změnit `dataRequiredDate`)

### 4. Klávesové zkratky pro multiselekt — Ctrl+C / Ctrl+X / Ctrl+V
- Aktuálně: lasso select funguje, ale klávesové zkratky nejsou implementovány
- Cíl: po výběru více bloků lasem umožnit kopírování, vyjmutí a vložení
- Ctrl+C — uloží vybrané bloky do clipboard state (relativní pozice vůči nejstaršímu bloku)
- Ctrl+X — totéž + smaže původní bloky (nebo je označí jako "vyjmuté" — ghostuje)
- Ctrl+V — vloží bloky na aktuální pozici kurzoru na timeline (zachová relativní rozstupy)
- Implementace: `useEffect` na `keydown` v `PlannerPage`, clipboard uložen do `useRef` (ne localStorage)
- Role: jen ADMIN a PLANOVAT (canEdit)

### 5. Náhrada emoji za SVG ikony
- Aktuálně: theme switch používá emoji ☀️/🌙 — na Windows vypadají jinak než na macOS
- Cíl: nahradit emoji za jednoduché SVG ikony (slunce/měsíc) které vypadají všude stejně
- Týká se: theme switch v headeru, případně další emoji v UI
- Styl: tenká linka, monochromatická, velikost 16–18px

### 6. Lasso popup — lepší viditelnost
- Aktuálně: popup "Aktivní lasso výběr" dole je málo viditelný
- Cíl: zvýraznit — větší kontrast, výraznější pozice nebo animace při zobrazení
- Zvážit: přesunout do headeru jako aktivní stav místo spodního floatingu

### 7. Tlačítko "Plánování" v admin dashboardu — lepší viditelnost
- Aktuálně: tlačítko vlevo nahoře pro návrat z /admin do plánovače není dostatečně výrazné
- Cíl: zvýraznit — větší, jiná barva nebo přidat šipku zpět ←

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
