# Plánovací aplikace — Projektová dokumentace

> **Jak pracovat s tímto souborem:**
> - Tento soubor je živá dokumentace projektu. Neupravuj ho ručně přímo v Cursoru.
> - Změny a doplnění vždy konzultuj s Claude (claude.ai), který zajistí konzistenci celého dokumentu.
> - V Cursoru ho používej pouze ke čtení — odkazuj na něj přes `@DOKUMENTACE.md`.
> - Po každé úpravě přepiš soubor novou verzí od Claude.

---

## Přehled projektu

Webová aplikace pro plánování výroby na strojích XL 105 a XL 106. Umožňuje plánovat zakázky, rezervace a údržbu na časové ose, spravovat termíny a řídit přístupová práva různých oddělení.

**Stack:** Next.js + React + TypeScript + Tailwind + Prisma + MySQL

---

## Databáze MySQL

Projekt používá MySQL (databáze **IGvyroba**). Konfigurace v `.env`:

| Parametr | Hodnota |
|----------|---------|
| Host | localhost:3306 |
| Databáze | IGvyroba |
| Uživatel | root |
| Heslo | mysql |

**Connection string:** `mysql://root:mysql@localhost:3306/IGvyroba?charset=utf8mb4`

### Soubory
- `prisma/schema.prisma` — Prisma schema (provider: mysql)
- `prisma/mysql-schema.sql` — ruční SQL pro vytvoření DB a tabulek (volitelné)
- `prisma/migrations/20260311000000_init_mysql/` — Prisma migrace

### První spuštění
```bash
# 1. Vytvořit databázi (nebo spustit mysql-schema.sql)
# 2. Migrace
npx prisma migrate deploy

# Pokud databáze už obsahuje tabulky (P3005):
npx prisma migrate resolve --applied 20260311000000_init_mysql

# 3. Seed (číselníky + admin)
npm run prisma:seed
```

---

## Stav implementace

| Etapa | Název | Stav |
|-------|-------|------|
| 1 | Skeleton a běh aplikace | ✅ Hotovo |
| 2 | Timeline render (grid + scroll + filtry) | ✅ Hotovo |
| 3 | Drag & drop + resize + rozdělení | ✅ Hotovo |
| 4 | Směny + svátky + background | ✅ Hotovo |
| 5 | Výrobní sloupečky, stavy, overdue indikace | ✅ Hotovo |
| 6 | Opakování | ✅ Hotovo |
| 7 | Hromadné posuny + zámečky | ✅ Hotovo |
| 8 | Uživatelé, role a přihlašování | ✅ Hotovo |
| 9 | Admin dashboard (uživatelé + číselníky) | ✅ Hotovo |
| — | Light/Dark migrace hlavních ploch | ✅ Hotovo |
| 10 | Audit log (kdo co změnil) + Info panel | ✅ Hotovo |
| — | TISKAR role + potvrzení tisku + TiskarMonitor | ✅ Hotovo (2026-03-21) |
| — | Provozní hodiny strojů + výjimky (MachineWorkHours) | ✅ Hotovo (2026-03-21) |
| — | Batch update bloků (hromadný posun lasem) | ✅ Hotovo (2026-03-22) |
| — | Barva badge na položkách číselníku (badgeColor) | ✅ Hotovo (2026-03-21) |
| 11 | UX vylepšení — odstávky, podmíněné formátování, inline datepicker | ⬜ Nezačato |

> Stav měň na: ⬜ Nezačato / 🔄 Rozpracováno / ✅ Hotovo / 🐛 Chyba

### Stav UX light/dark (11. 3. 2026)

- Theme provider: `next-themes`
- Theme switch: iOS-style (`☀️/🌙`) v headeru
- Migrace na tokeny: `PlannerPage`, `TimelineGrid`, `AdminDashboard`, `Login`
- Deadline logika:
  - `OK` = zelená
  - `dnes bez OK` = žlutá
  - `po termínu bez OK` = červená
- Badge/chips DATA/MATERIÁL/EXPEDICE:
  - stejný tyrkysový základní akcent,
  - stavová barva (`OK/žlutá/červená`) má prioritu nad základem
- UX feedback a error handling (Etapa 5 roadmapy):
  - tiché `catch` nahrazené za `console.error` + uživatelský feedback,
  - kritické akce mají loading/disabled stav proti double-submit.

---

## Funkcionalita k doplnění / nápady

> Sem si piš věci, které chceš časem přidat. Když bude seznam delší, přineseme ho do Claude a zapracujeme do dokumentace.

- [ ] ...

---

## Design — Apple standard

Veškeré UI komponenty musí vizuálně odpovídat kvalitě aplikací Apple. Toto je závazné pravidlo pro celý projekt.

| Zásada | Pravidlo |
|--------|----------|
| **Fonty** | `-apple-system, BlinkMacSystemFont` — systémový font, nikdy Google Fonts |
| **Spacing** | Výhradně násobky 4 px (4, 8, 12, 16, 20, 24…) |
| **Bordery** | Max 1 px, ideálně `rgba(255,255,255,0.08–0.15)` |
| **Animace** | `transition` max 150 ms, `ease-out` nebo spring — nikdy lineární |
| **Barvy** | Pozadí `#0a0a0f` / `#111318`, akcenty modrá `#3b82f6`, CTA žlutá `#FFE600` |
| **Nativní prvky** | `<input type="range">`, `<select>`, `<input type="date">` bez restylu jsou zakázány |
| **Vlastní komponenty** | Slider, dropdown, date picker — vlastní implementace; shadcn/ui jen pro jednoduchá primitiva |
| **Interakce** | Hover: jemná změna opacity nebo brightness; žádné těžké stíny na hover |

### Příklady dodržení standardu
- `ZoomSlider` v `PlannerPage.tsx` — custom drag slider, bílý thumb se stínem, ikony lupy
- `<select>` pole — jednotný styl `#181b22` bg, `border-radius: 10`, `height: 32–40`
- `DatePickerField` — vlastní iOS-style kalendářový popup, kulaté buňky, tmavé pozadí `#1c1c1e`

---

## Hlavní layout

- **Split view:** vlevo plánovací timeline, vpravo builder formulář
- **Nahoře:** globální filtr (číslo zakázky + skok na datum)
- **Plán:** až 1 rok dopředu

---

## Timeline

- **Stroje na ose X:** XL 105, XL 106
- **Čas + datum na ose Y**
- **Grid:** 30 minut
- **Scroll:** minimálně 30 dní dopředu, ideálně 1 rok; sticky header
- Drag & drop + resize + snap na 30 min
- Každý blok zobrazuje výrobní sloupečky (DATA, MATERIÁL, BARVY, LAK, SPECIFIKACE) jako barevné badge přímo na kartičce — slouží k rychlému porovnání zakázek a optimalizaci pořadí výroby

---

## Bloky (zakázky / rezervace / údržba)

Každý blok obsahuje:

### Základní pole
- Číslo zakázky
- Stroj (XL 105 nebo XL 106)
- Začátek a konec (start / end)
- Typ: `zakázka` / `rezervace` / `údržba`
- Termín expedice (deadlineExpedice — datum, povinné nebo volitelné)
- Popis (volný text, nepovinný)
- Nastavení opakování
- Zámek (lock/pin)

### Výrobní sloupečky

Pět sloupečků viditelných přímo na bloku v timeline. Slouží k rychlé orientaci a optimalizaci pořadí zakázek — **nenahrazují barvy bloků** (ty řeší stav celé zakázky). Každý sloupec se zobrazuje jako Badge s volitelnou ⚠ ikonkou.

| Sloupec | Typ hodnoty | Doplňkový datum | OK checkbox |
|---------|-------------|-----------------|-------------|
| **DATA** | status z číselníku | ✅ ano (nepovinný) | ✅ ano |
| **MATERIÁL** | status z číselníku | ✅ ano (nepovinný) | ✅ ano |
| **BARVY** | status z číselníku | ❌ ne | ❌ ne |
| **LAK** | status z číselníku | ❌ ne | ❌ ne |
| **SPECIFIKACE** | volný text | ❌ ne | ❌ ne |

#### DB pole bloku pro výrobní sloupečky

```
// DATA
dataStatusId        Int?       FK → CodebookOption (category = DATA)
dataStatusLabel     String?    snapshot labelu v době uložení
dataRequiredDate    DateTime?  doplňkový datum (nepovinný)
dataOk              Boolean    default false

// MATERIÁL
materialStatusId     Int?       FK → CodebookOption (category = MATERIAL)
materialStatusLabel  String?    snapshot
materialRequiredDate DateTime?  doplňkový datum (nepovinný)
materialOk           Boolean    default false

// BARVY
barvyStatusId        Int?       FK → CodebookOption (category = BARVY)
barvyStatusLabel     String?    snapshot

// LAK
lakStatusId          Int?       FK → CodebookOption (category = LAK)
lakStatusLabel       String?    snapshot

// SPECIFIKACE
specifikace          String?    volný text
```

**Proč snapshot label?** Pokud admin přejmenuje položku číselníku, historické zakázky zobrazí label v době uložení, ne aktuální název.

---

## Číselníky (CodebookOption)

### DB model

```prisma
model CodebookOption {
  id         Int     @id @default(autoincrement())
  category   String  // "DATA" | "MATERIAL" | "BARVY" | "LAK"
  label      String
  sortOrder  Int     @default(0)
  isActive   Boolean @default(true)
  shortCode  String? // volitelná zkratka pro zobrazení v badge
  isWarning  Boolean @default(false) // pokud true, badge se zobrazí oranžově
  badgeColor String? // klíč barvy: "blue"|"green"|"orange"|"red"|"purple"|"cyan"|"lime"|"pink"|"black"
}
```

**Pole `badgeColor`:** Dovoluje adminu přiřadit konkrétní barvu každé položce číselníku. Hodnota je klíč z předdefiniované sady (`BADGE_COLOR_KEYS` v `src/lib/badgeColors.ts`). CSS tokeny jsou definovány v `globals.css` jako `var(--badge-<key>)`. Validace přes `parseBadgeColor()` při každém zápisu do API.

Blok nikdy neukládá přímo label — ukládá `optionId` + `snapshotLabel`. Snapshot chrání historii.

### Default hodnoty (seed)

#### DATA
| Label | shortCode | isWarning |
|-------|-----------|-----------|
| CHYBNÁ DATA | — | ✅ true |
| U SCHVÁLENÍ | — | — |
| PŘIPRAVENO | — | — |
| VYSVÍCENO | — | — |
| MÍSTO PRO POZNÁMKU | — | — |

#### MATERIÁL
| Label | shortCode | isWarning |
|-------|-----------|-----------|
| SKLADEM | — | — |
| TISK Z ARCHŮ | — | — |
| TISK Z ROLÍ | — | — |
| 50m | — | — |
| 55m | — | — |
| 55lit | — | — |
| 60m | — | — |
| 60lim | — | — |
| 70m | — | — |
| pantone (očekávané datum dodání) | — | — |
| MÍSTO PRO POZNÁMKU | — | — |

#### BARVY
| Label | shortCode |
|-------|-----------|
| SCH Lumina LED | — |
| IML COLORGRAF | — |
| SCH TRIUMPH K | — |

#### LAK
| Label | shortCode |
|-------|-----------|
| disperse lesk | — |
| disperse mat | — |
| pod UV | — |
| mat pod lamino | — |
| 150 | — |
| 401 | — |
| 215 | — |
| parciální | — |
| UV lak | — |
| vysoce lesklá disperse | — |

---

## Not-ready indikace (deadline stavy)

### Logika

```
if (!requiredDate) => žádný stav
if (ok === true)   => OK (zelená)
if (isSameDay(now, requiredDate) && !ok) => warning (žlutá)
if (startOfDay(now) > startOfDay(requiredDate) && !ok) => danger (červená)
```

Indikace se aplikuje pouze tehdy, pokud `requiredDate` existuje (není null). Pokud datum není vyplněno, žádné varování se nezobrazuje.

### Vizuální provedení

- ⚠/! (dnes) nebo ‼ (po termínu) přímo u badge sloupce na kartičce v timeline
- Příklad: `DATA !` (dnes) | `MAT ‼` (po termínu)
- Sloupec je zvýrazněn podle stavu (žlutá/červená), jinak má tyrkysový základní akcent
- Tooltip při najetí: „Zakázka startuje 19.2., ale materiál dorazí 20.2."
- **Primární indikace musí být u konkrétního sloupce**, ne jen na celém bloku

---

## Builder (pravý panel)

Formulář pro vytvoření nového bloku. Pole:

- Číslo zakázky
- Stroj (výběr XL 105 / XL 106)
- Délka trvání (intervaly po 30 min)
- Typ bloku (zakázka / rezervace / údržba)
- **DATA:** Select ze živého číselníku + volitelný date picker + OK checkbox
- **MATERIÁL:** Select ze živého číselníku + volitelný date picker + OK checkbox + volitelný pantone datum
- **BARVY:** Select ze živého číselníku
- **LAK:** Select ze živého číselníku
- **SPECIFIKACE:** Textarea
- Termín expedice (date picker)
- Po potvrzení se blok okamžitě zobrazí na timeline

---

## shadcn/ui — UX poznámky

V projektu je aktivní shadcn/ui (New York styl). Aktuálně nainstalované: Button, Input, Textarea, Label, Switch, Badge, Separator, Select, Popover, Calendar.

**Pravidlo pro datumové inputy:** `<input type="date">` je **zakázán** — všude se používá vlastní komponenta `DatePickerField` (viz níže).

| Prvek | Řešení |
|-------|--------|
| Všechna dropdown menu | Nativní `<select>` — styl: background `#181b22`, border `#1e2130`, borderRadius 10, height 32–40, chevron SVG přes wrapper |
| Date picker | Vlastní `DatePickerField` komponenta (iOS-style popup, bez react-day-picker) |
| Badge ve sloupečcích | `Badge` (shadcn, variant dle stavu) |
| Warning ikonka | `AlertTriangle` z lucide-react |
| Admin tabulky (uživatelé, číselníky) | Data Table pattern (`Table` + `ColumnDef` s TanStack Table) |
| Edit dialogy (uživatel, položka číselníku) | shadcn `Dialog` |

Nainstalované (etapa 9): Tooltip, Dialog, AlertDialog, Table, Tabs.

---

## Etapa 1 — Skeleton a běh aplikace

- Next.js + React + TypeScript + Tailwind + Prisma + MySQL
- Strom projektu + všechny soubory nutné pro spuštění
- Seed s mock daty
- Jedna stránka s layoutem: vlevo placeholder timeline (bez DnD), vpravo builder formulář
- Builder ukládá blok do DB a na timeline se hned zobrazí
- API: CRUD pro bloky + termíny DATA / Materiál / Expedice
- README se spuštěním

---

## Etapa 2 — Timeline render (grid + scroll + filtry)

- Bloky renderovány ve 2 sloupcích (XL 105, XL 106) na ose Y (čas + datum)
- Grid 30 minut
- Scroll na dny (min. 30 dní dopředu, ideálně 1 rok), sticky header
- Horní filtr: číslo zakázky + skok na datum
- Klik na blok otevře detail (side panel / modal) s termíny a nastavením opakování

---

## Etapa 3 — Drag & drop + resize + rozdělení (split)

- Drag & drop přesuny bloků mezi stroji i v čase
- Resize start/end se snapem na 30 min
- Nástroj „Rozdělení zakázky":
  - U dlouhého bloku lze provést „říznutí" (split) v zvoleném čase → vzniknou 2 bloky se zachováním metadat
  - Split nesmí vytvořit část kratší než 30 min
  - UX: kontextové menu „Rozdělit", nebo klávesa S + klik na čas v bloku, nebo ikonka nůž
- Kolize: zabránit, nebo vizuální konflikt s potvrzením

---

## Etapa 4 — Směny + svátky + background ✅

**XL 106:** 3 směny (6–14, 14–22, 22–6) — 24h provoz, žádný noční overlay

**XL 105:** 2 směny (6–14, 14–22) — noční hodiny (22–6) jsou ztmavené překryvnou vrstvou

**Implementováno:**
- Státní svátky ČR hardcoded (algoritmus Velikonoc + pevné svátky) — červené pozadí v date column i v machine columns
- Firemní odstávky: uloženy v DB (`CompanyDay` model), CRUD přes API, UI správy v `ShutdownManager` panelu — fialové pozadí
- Barvy dnů v date column: dnes=modrá, svátek=červená, firemní den=fialová, víkend=oranžová
- Noční overlay jen pro XL 105 (MACHINES_WITH_NIGHT_OFF set)

---

## Etapa 5 — Výrobní sloupečky, stavy, overdue indikace

### 5a — Barvy bloků (stav zakázky)

**Barvy bloků (viditelné na celém bloku):**
- 🔵 Modrá → zakázka OK
- 🟣 Fialová → rezervace
- 🔴 Červená → údržba / oprava
- ⚫ Šedá → blok, který už měl být hotový (end < now a není údržba)

### 5b — Číselníky v DB

- Vytvořit model `CodebookOption` (viz sekce Číselníky výše)
- Seed default hodnot pro DATA, MATERIÁL, BARVY, LAK
- API: GET `/api/codebook?category=DATA` (živý číselník pro formuláře)
- Položky s `isActive = false` se nezobrazují v dropdownech, ale zůstávají historicky v DB

### 5c — Rozšíření bloku o výrobní sloupečky

- Migrace DB: přidat všechna nová pole na Block model (viz sekce Bloky → DB pole)
- Rozšíření API `PUT /api/blocks/[id]` o nová pole
- Seed zakázek doplnit o ukázkové hodnoty výrobních sloupečků

### 5d — Výrobní sloupečky v timeline

- Každý blok zobrazí badge pro DATA, MATERIÁL, BARVY, LAK (a SPECIFIKACE pokud není prázdná)
- Badge používá shadcn `Badge` komponentu
- Krátký label (shortCode pokud existuje, jinak prvních N znaků)
- Pokud `isWarning = true` u dané položky → badge oranžová/červená
- Tooltip na badge: plný název položky

### 5e — Not-ready indikace

- Logika: `startTime < requiredDate && ok !== true` → zobraz ⚠ u sloupce
- UI: `AlertTriangle` ikonka z lucide-react + shadcn `Tooltip` s vysvětlením
- Indikace jen pokud `requiredDate` existuje

### 5f — Rozšíření Builderu a detailu bloku

- Builder: přidat nativní `<select>` pro DATA, MATERIÁL, BARVY, LAK
- Builder: přidat nativní `<input type="date">` pro doplňkové datumy
- Detail bloku: zobrazit a editovat všechna výrobní pole
- Detail bloku: zobrazit termín expedice

### Termíny v detailu bloku

DATA, MATERIÁL — zadány v detailu zakázky:
- Status (Select ze živého číselníku)
- Doplňkový datum (date picker, nepovinný)
- OK checkbox

Pokud datum existuje a není OK a blok ještě nezačal → červené zvýraznění (overdue/not-ready).

---

## Etapa 6 — Opakování ✅

- Opakování bloku: DAILY / WEEKLY / MONTHLY (field `recurrenceType` na Block)
- `recurrenceParentId` — self-relace, instance odkazuje na rodičovský blok
- Při editaci výběr: upravit jen tuto instanci, nebo celou sérii
- UI v detailu bloku: dropdown pro typ opakování + počet opakování

---

## Etapa 7 — Hromadné posuny + zámečky bloků ✅

**Multi-select:**
- Tažením myši výběrový obdélník (lasso/box select) označí více bloků
- Celou skupinu lze posunout v čase (drag) se snapem na 30 min

**Posun navazujících bloků (push/shift chain):**
- Při vložení nové zakázky nebo prodloužení bloku a vzniku kolize nabídne akci: „Posunout všechny následující navazující zakázky"
- Posun respektuje směny a nepracovní časy (posun na nejbližší pracovní slot)

**Zámeček (lock/pin):**
- Zamknutý blok se nesmí pohnout při hromadném posunu ani při posunu navazujících bloků
- Pokud je zamknutý blok v cestě:
  - Systém zastaví posun a zobrazí hlášku „Nelze posunout přes zamknutý blok"
  - Nebo nabídne alternativu (posun jen do okamžiku před lockem)
- UX: ikona zámku přímo na bloku + přepínač v detailu

---

---

## QoL vylepšení (po etapě 7)

### Konfigurovatelný rozsah timeline
- Header: segmented buttons [30d | 60d | 90d] pro přepínání rozsahu dopředu (výchozí 60 dní)
- State `daysAhead` + `daysBack` v PlannerPage; TimelineGrid přijímá je jako props a počítá `totalDays` dynamicky

### „Přejít na" pro historické bloky
- Při hledání zakázky (filterText) se zobrazí žlutý banner, pokud zakázka leží před viewStart
- Klik rozšíří `daysBack` a scrollne timeline na daný blok

### DatePickerField — vlastní iOS-style kalendář
- Nahrazuje všechny `<input type="date">` v celé aplikaci
- Vlastní React komponenta bez závislosti na react-day-picker nebo shadcn Calendar
- Tmavé popup okno `#1c1c1e`, kulaté buňky 36×36px, česká lokalizace (Po–Ne, Leden–Prosinec)
- Nasazeno: Job Builder, BlockEdit, ShutdownManager, header toolbar

---

## Etapa 8 — Uživatelé, role a přihlašování

### Přihlašování
- Každý uživatel má vlastní přihlašovací jméno a heslo
- Hesla jsou bezpečně uložena v databázi (hashována, nikdy v plaintextu)
- Přihlašovací obrazovka při startu aplikace
- Uživatelé jsou předem nadefinovaní v databázi (seed) — žádná veřejná registrace

### Správa uživatelů
- Admin spravuje uživatelské účty přes Admin dashboard (Etapa 9)
- Uživatelé jsou zakládáni přes seed nebo admin rozhraní
- Plánovač nemá přístup ke správě uživatelů

### Role a oprávnění

| Role | Popis | Co může dělat |
|------|-------|---------------|
| **Admin** | Správce systému | Vše — včetně správy uživatelů, číselníků, jejich zakládání, editace a mazání; má přístup ke všem funkcím aplikace |
| **Plánovač** | Plánování výroby | Vytváření, editace, mazání bloků, správa výrobních sloupečků, drag & drop, split, zámečky, hromadné posuny |
| **MTZ** | Oddělení materiálu | Vidí celou timeline, edituje pouze sloupec **MATERIÁL** (status + datum + OK) |
| **DTP** | Oddělení dat | Vidí celou timeline, edituje pouze sloupec **DATA** (status + datum + OK) |
| **Tiskař (TISKAR)** | Obsluha tiskárny | Přístup pouze na `/tiskar` view (svůj stroj), může potvrdit/zrušit potvrzení tisku zakázky |
| **Viewer** | Jen čtení | Vidí celou timeline, nemůže nic editovat |

**Pole `assignedMachine` na User:** Role TISKAR musí mít přiřazený konkrétní stroj (`XL_105` nebo `XL_106`). Toto pole je součástí JWT session tokenu — TISKAR nemůže potvrdit tisk na cizím stroji.

### Detailní matice práv

| Akce | Admin | Plánovač | MTZ | DTP | Tiskař | Viewer |
|------|-------|----------|-----|-----|--------|--------|
| Vidět timeline (plánovač) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Vidět TiskarMonitor (`/tiskar`) | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Vytvořit / smazat blok | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Přesunout / resize blok | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Rozdělit blok (split) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Hromadné posuny (batch) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editovat sloupec DATA | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Editovat sloupec MATERIÁL | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Editovat sloupec BARVY | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editovat sloupec LAK | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editovat SPECIFIKACE | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Editovat termín Expedice | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Zamknout / odemknout blok | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Potvrdit tisk zakázky | ✅ | ✅ | ❌ | ❌ | ✅ (jen svůj stroj) | ❌ |
| Správa uživatelů | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Správa číselníků | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Správa provozních hodin strojů | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### UX přihlašování
- Vpravo nahoře zobrazeno jméno přihlášeného uživatele a jeho role
- Tlačítko odhlášení
- Prvky UI, které uživatel nemá právo používat, jsou skryté nebo zašedlé (ne jen zamčené)

---

## Etapa 9 — Admin dashboard

Samostatná stránka nebo sekce přístupná pouze roli Admin.

### Správa uživatelů

- Tabulka všech uživatelů (Data Table pattern)
- Akce: vytvoření uživatele, změna role, reset hesla, deaktivace účtu
- Dialog / Drawer pro editaci (shadcn `Dialog` nebo `Drawer`)
- Deaktivovaný uživatel se nemůže přihlásit, ale existuje v DB (zachování historie)

### Správa číselníků

- Záložky / sekce pro každou kategorii: DATA, MATERIÁL, BARVY, LAK
- Tabulka položek s drag & drop řazením (sortOrder)
- Akce na každé položce:
  - Editace labelu
  - Nastavení shortCode
  - Přepnutí isWarning (zvýraznění v UI)
  - Deaktivace (isActive = false) — položka zmizí z dropdownů, ale historizovaná data zůstávají
- Přidání nové položky (formulář + uložení do DB)
- Pořadí se promítne do dropdownů v timeline / builderu

### UX poznámky pro Admin dashboard

- Admin tabulky: shadcn Data Table (TanStack Table + `Table`, `TableHeader`, `TableRow`, `TableCell`)
- Edit dialogy: shadcn `Dialog` s formulářem uvnitř
- Potvrzení mazání/deaktivace: `AlertDialog`
- Záložky kategorií: shadcn `Tabs`

---

## Etapa 10 — Audit log ✅

Selektivní sledování akcí uživatelů — jen smysluplné změny, ne každý drag & drop.

### Co se loguje

| Akce | Kdo může spustit |
|------|-----------------|
| Přidání bloku (CREATE) | ADMIN, PLANOVAT |
| Smazání bloku (DELETE) | ADMIN, PLANOVAT |
| Změna DATA stav / datum / OK | ADMIN, PLANOVAT, DTP |
| Změna MATERIÁL stav / datum / OK | ADMIN, PLANOVAT, MTZ |
| Změna termínu expedice | ADMIN, PLANOVAT |

### Co se NELOGUJE
Drag & drop (single), resize, popis, specifikace, barvy, lak, zámek — příliš časté nebo provozně nezajímavé.

### DB model AuditLog

Nová tabulka s indexy pro rychlé dotazy. Klíčové vlastnosti:
- `blockId` bez cizího klíče — záznam přežije smazání bloku
- `orderNumber` uloženo snapshotem — platné i po smazání bloku
- Indexy: `(blockId, createdAt)` pro historii bloku, `(createdAt)` pro přehledy

### Implementace

- **Atomické transakce:** CREATE/UPDATE/DELETE a zápis auditu vždy v jedné transakci
- **`createMany` v PUT:** místo cyklu create() — jedno volání pro všechna změněná pole
- **Oprávnění `/api/blocks/[id]/audit`:** ADMIN, PLANOVAT, DTP, MTZ (VIEWER nemá přístup)

### Audit akce — kompletní seznam

| Akce (action) | Popis |
|---------------|-------|
| `CREATE` | Nový blok vytvořen |
| `DELETE` | Blok smazán |
| `UPDATE` | Změna pole (field říká které) |
| `PRINT_COMPLETE` | Tiskař potvrdil tisk zakázky |
| `PRINT_UNDO` | Potvrzení tisku bylo zrušeno |
| `PRINT_RESET` | Tisk automaticky zrušen při přesunu bloku (batch nebo single drag) |

### UI

- **Bell ikona v headeru** (ADMIN+PLANOVAT) — záznamy DTP/MTZ za poslední 3 dny, červený badge, proklik na zakázku
- **Sekce Historie změn v BlockDetail** — posledních 10 záznamů pro daný blok
- **Záložka Audit log v Admin dashboardu** — tabulka posledních 50 záznamů

---

## Matice oprávnění k audit endpointům

| Endpoint | ADMIN | PLANOVAT | DTP | MTZ | TISKAR | VIEWER |
|----------|-------|----------|-----|-----|--------|--------|
| `GET /api/audit` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/audit/today` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/blocks/[id]/audit` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## TISKAR role — Potvrzení tisku ✅ (2026-03-21)

### Účel
Tiskař (obsluha stroje XL 105 nebo XL 106) může přímo z `/tiskar` view potvrdit, že zakázka byla vytisknuta. Toto potvrzení je viditelné v plánovači i v auditu.

### DB změny — Block model

```
printCompletedAt         DateTime?   // kdy bylo potvrzeno
printCompletedByUserId   Int?        // kdo potvrdil (ID)
printCompletedByUsername String?     // kdo potvrdil (jméno — snapshot)
```

### DB změny — User model

```
assignedMachine String?  // "XL_105" nebo "XL_106" — povinné pro roli TISKAR
```

### API

**`POST /api/blocks/[id]/complete`**
- Body: `{ completed: boolean }`
- `completed: true` → nastaví `printCompletedAt`, `printCompletedByUserId`, `printCompletedByUsername`
- `completed: false` → vymaže všechna tři pole (undo)
- Jen pro typ bloku `ZAKAZKA` (REZERVACE/UDRZBA nelze potvrdit)
- Role TISKAR: může jen na svém `assignedMachine`
- Role ADMIN, PLANOVAT: bez omezení stroje

### PRINT_RESET — automatický reset
Pokud se blok, který byl označen jako vytisknut, přesune (single PUT nebo batch):
1. `printCompletedAt` se automaticky vymaže
2. Do auditu se zapíše akce `PRINT_RESET` s `oldValue = printCompletedByUsername`

**Důvod:** přesunutý blok fyzicky nestartuje ve stejný čas → potvrzení tisku přestalo platit.

---

## TiskarMonitor — view pro tiskaře ✅ (2026-03-21)

### Stránka `/tiskar`

Server Component (`src/app/tiskar/page.tsx`) — načítá bloky stroje tiskaře ze session (`assignedMachine`) a předává je do `TiskarMonitor`.

### Komponenta `TiskarMonitor.tsx`

Mini timeline zobrazující pouze stroj přihlášeného tiskaře:

- **Rozsah:** 7 dní dopředu od dnes
- **Grid:** stejný slot height 26px jako hlavní plánovač
- **Polling:** automatické obnovení dat každých 30 sekund
- **Vizuál bloků:**
  - Modrý gradient = zakázka nezahájena / vytisknutí nepotvrzeno
  - Zelený gradient = tisk potvrzen (`printCompletedAt != null`)
- **Potvrzení tisku:** kliknutím na blok se otevře detail s tlačítkem „Potvrdit tisk" / „Zrušit potvrzení"
- Rezervace a údržba se zobrazují, ale tlačítko potvrzení nemají

### Technické poznámky
- `SLOT_HEIGHT = 26`, `TIME_COL_W = 72`, `HEADER_H = 52`, `DAYS_AHEAD = 7`
- `POLL_INTERVAL = 30_000` ms (30s)
- Přístup: role TISKAR (a ADMIN/PLANOVAT pro kontrolu)

---

## Provozní hodiny strojů (MachineWorkHours) ✅ (2026-03-21)

### Účel
Definuje, kdy každý stroj smí pracovat (per den týdne). Blok typ ZAKAZKA nesmí být naplánován mimo tyto hodiny — validace probíhá při každém drag&drop i batch update.

### DB model

```prisma
model MachineWorkHours {
  id         Int     @id @default(autoincrement())
  machine    String  // "XL_105" | "XL_106"
  dayOfWeek  Int     // 0=neděle, 1=pondělí, ..., 6=sobota
  startHour  Int     // 0–23
  endHour    Int     // 1–24 (24 = konec dne = půlnoc)
  isActive   Boolean @default(true)

  @@unique([machine, dayOfWeek])
  @@index([machine])
}
```

### API

| Metoda | Endpoint | Role | Popis |
|--------|----------|------|-------|
| GET | `/api/machine-shifts` | všichni přihlášení | Načtení všech řádků |
| PUT | `/api/machine-shifts` | ADMIN, PLANOVAT | Hromadná editace (pole `rows`) |

### Validace `checkScheduleViolation()`

Funkce v `src/app/api/blocks/batch/route.ts` (a analogicky v `/api/blocks/[id]/route.ts`):
- Iteruje po 30minutových slotech přes celý rozsah bloku
- Pro každý slot zjistí hodinu a den týdne v timezone `Europe/Prague` (přes `Intl.DateTimeFormat`)
- Výjimky (`MachineScheduleException`) přebíjí základní MachineWorkHours pro daný den
- Pokud slot padá mimo provoz → vrátí chybovou zprávu `"Blok zasahuje do doby mimo provoz stroje."`
- Validuje se jen pro bloky typu `ZAKAZKA` (REZERVACE/UDRZBA může být kdekoliv)

---

## Výjimky provozních hodin (MachineScheduleException) ✅ (2026-03-21)

### Účel
Umožňuje přepsat provozní hodiny pro konkrétní datum (např. přesčas, výpadek, sváteční provoz). Výjimka přebíjí `MachineWorkHours` pro daný den.

### DB model

```prisma
model MachineScheduleException {
  id        Int      @id @default(autoincrement())
  machine   String   // "XL_105" | "XL_106"
  date      DateTime // uloženo jako UTC midnight: new Date("YYYY-MM-DD" + "T00:00:00.000Z")
  startHour Int      // 0–23
  endHour   Int      // 1–24
  isActive  Boolean  @default(true)
  label     String?  // nepovinný popis (např. "Výpadek elektřiny")
  createdAt DateTime @default(now())

  @@unique([machine, date])
  @@index([date])
}
```

### API

| Metoda | Endpoint | Role | Popis |
|--------|----------|------|-------|
| GET | `/api/machine-exceptions` | všichni přihlášení | Načtení všech výjimek |
| POST | `/api/machine-exceptions` | ADMIN, PLANOVAT | Vytvoření / přepsání výjimky (upsert) |
| DELETE | `/api/machine-exceptions/[id]` | ADMIN, PLANOVAT | Smazání výjimky |

### Kritické pravidlo — ukládání datumu

Klient posílá datum jako `YYYY-MM-DD` string (lokální datum tiskaře/plánovače).
Server MUSÍ uložit jako UTC midnight takto:

```typescript
const datePart = String(date).slice(0, 10); // "YYYY-MM-DD"
const utcMidnight = new Date(datePart + "T00:00:00.000Z");
```

**NIKDY nepoužívat** `getFullYear()`, `getMonth()`, `getDate()` na serveru pro tuto konverzi — na UTC serveru se česká půlnoc rovná předchozímu UTC dni, čímž by se datum posunulo o jeden den zpět.

---

## Batch update bloků ✅ (2026-03-22)

### Účel
Hromadný přesun více bloků najednou (používá se pro lasso výběr v TimelineGrid). Jedna transakce pro N bloků.

### API

**`POST /api/blocks/batch`**
- Pouze role ADMIN, PLANOVAT
- Body: `{ updates: [{ id: number, startTime: string, endTime: string, machine: string }] }`

### Průběh zpracování

1. **Sanity check** — `start < end` pro každý blok před hitem DB (fast-fail)
2. **Fetch existujících bloků** — typ, starý čas, printCompleted stav, orderNumber pro audit
3. **Schedule validace** — jen pro ZAKAZKA bloky:
   - Paralelní `Promise.all([schedule, exceptions])` fetch
   - `checkScheduleViolation()` pro každý ZAKAZKA blok
4. **Transakce** — `prisma.$transaction`:
   - `Promise.all` updatů (startTime, endTime, machine + PRINT_RESET pokud potřeba)
   - `auditLog.createMany()` pro všechny záznamy najednou

### HTTP status kódy

| Kód | Situace |
|-----|---------|
| 200 | OK, všechny bloky aktualizovány |
| 400 | Neplatný JSON nebo prázdné `updates` |
| 400 | Neplatné časy (start ≥ end) |
| 401 | Nepřihlášen |
| 403 | Nedostatečná role |
| 404 | Jeden nebo více bloků nenalezeno (Prisma P2025) |
| 422 | Blok zasahuje mimo provoz stroje |
| 500 | Chyba serveru |

---

## CompanyDay — machine pole ✅ (2026-03-21)

Firemní odstávky lze nyní přiřadit ke konkrétnímu stroji:

```prisma
model CompanyDay {
  id        Int      @id @default(autoincrement())
  startDate DateTime
  endDate   DateTime
  label     String
  machine   String?  // null = obě stroje; "XL_105" nebo "XL_106" = jen daný stroj
  createdAt DateTime @default(now())
}
```

---

## Matice oprávnění k block endpointům

| Endpoint | ADMIN | PLANOVAT | DTP | MTZ | TISKAR | VIEWER |
|----------|-------|----------|-----|-----|--------|--------|
| `GET /api/blocks` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/blocks` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/blocks/[id]` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PUT /api/blocks/[id]` | ✅ (vše) | ✅ (vše) | ✅ (DATA) | ✅ (MAT) | ❌ | ❌ |
| `DELETE /api/blocks/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/blocks/[id]/complete` | ✅ | ✅ | ❌ | ❌ | ✅ (svůj stroj) | ❌ |
| `POST /api/blocks/batch` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/machine-shifts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PUT /api/machine-shifts` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/machine-exceptions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/machine-exceptions` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `DELETE /api/machine-exceptions/[id]` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

---

*Dokument naposledy aktualizován: 2026-03-22 — verze X*
