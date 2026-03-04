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

## Stav implementace

| Etapa | Název | Stav |
|-------|-------|------|
| 1 | Skeleton a běh aplikace | ✅ Hotovo |
| 2 | Timeline render (grid + scroll + filtry) | ✅ Hotovo |
| 3 | Drag & drop + resize + rozdělení | ✅ Hotovo |
| 4 | Směny + svátky + background | ✅ Hotovo |
| 5 | Výrobní sloupečky, stavy, overdue indikace | ⬜ Nezačato |
| 6 | Opakování | ⬜ Nezačato |
| 7 | Hromadné posuny + zámečky | ⬜ Nezačato |
| 8 | Uživatelé, role a přihlašování | ⬜ Nezačato |
| 9 | Admin dashboard (uživatelé + číselníky) | ⬜ Nezačato |

> Stav měň na: ⬜ Nezačato / 🔄 Rozpracováno / ✅ Hotovo / 🐛 Chyba

---

## Funkcionalita k doplnění / nápady

> Sem si piš věci, které chceš časem přidat. Když bude seznam delší, přineseme ho do Claude a zapracujeme do dokumentace.

- [ ] ...

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

#### Pantone — řešení doplňkového datumu
Sloupec MATERIÁL obsahuje volitelnou položku `pantone` v číselníku. Pro sledování očekávaného data dodání pantonu existuje **samostatné pole** `pantoneExpectedDate` (nullable DateTime) přímo na bloku. Toto pole je viditelné a editovatelné v detailu bloku, pokud má blok v MATERIÁL zvolenou hodnotu obsahující „pantone". Uloženo jako samostatné DB pole — není součástí číselníku.

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
pantoneExpectedDate  DateTime?  samostatné pole pro pantone dodání

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
  id        Int     @id @default(autoincrement())
  category  String  // "DATA" | "MATERIAL" | "BARVY" | "LAK"
  label     String
  sortOrder Int     @default(0)
  isActive  Boolean @default(true)
  shortCode String? // volitelná zkratka pro zobrazení v badge
  isWarning Boolean @default(false) // pokud true, badge se zobrazí oranžově
}
```

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

## Not-ready indikace

### Logika

```
pokud (startTime bloku < requiredDate) A (ok !== true)
→ zobraz ⚠ u konkrétního sloupce
```

Indikace se aplikuje pouze tehdy, pokud `requiredDate` existuje (není null). Pokud datum není vyplněno, žádné varování se nezobrazuje.

### Vizuální provedení

- ⚠ nebo vykřičník přímo u badge sloupce na kartičce v timeline
- Příklad: `DATA ⚠` | `MAT ⚠`
- Sloupec může být vizuálně zvýrazněn (oranžový rámeček)
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

V projektu je aktivní shadcn/ui (New York styl). Aktuálně nainstalované: Button, Input, Textarea, Label, Switch, Badge, Separator.

**Důležité:** Shadcn `Select`, `Popover` a `Calendar` jsou v projektu **záměrně nahrazeny nativními HTML prvky** — Radix portály konfliktuji s CSS proměnnými v dark modu (průhledná pozadí). Toto rozhodnutí platí pro celý projekt, nevracet se k shadcn komponentám pro tyto prvky.

| Prvek | Řešení |
|-------|--------|
| Všechna dropdown menu | Nativní `<select>` — styl: background `#181b22`, border `#1e2130`, borderRadius 10, height 40, chevron SVG přes wrapper |
| Date picker (doplňkový datum, pantone datum) | Nativní `<input type="date" style={{ colorScheme: "dark" }}>` |
| Badge ve sloupečcích | `Badge` (shadcn, variant dle stavu) |
| Warning ikonka | `Icon` (AlertTriangle z lucide-react) + `Tooltip` |
| Tooltip detail | shadcn `Tooltip` |
| Admin tabulky (uživatelé, číselníky) | Data Table pattern (`Table` + `ColumnDef` s TanStack Table) |
| Edit dialogy (uživatel, položka číselníku) | shadcn `Dialog` |

Pro etapu 9 bude třeba doinstalovat: Tooltip, Dialog, AlertDialog, Table, Tabs.

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

## Etapa 6 — Opakování

- Opakování operace: každý den / každý týden / každý měsíc
- Nastavitelné v detailu zakázky jedním zaškrtnutím (checkbox/radio)
- Série: vytvoření instancí dopředu (6–12 měsíců) nebo generování „on the fly"
- Při editaci výběr: upravit jen tuto instanci, nebo celou sérii

---

## Etapa 7 — Hromadné posuny + zámečky bloků

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
| **MTZ** | Oddělení materiálu | Vidí celou timeline, edituje pouze sloupec **MATERIÁL** (status + datum + OK + pantone datum) |
| **DTP** | Oddělení dat | Vidí celou timeline, edituje pouze sloupec **DATA** (status + datum + OK) |
| **Viewer** | Jen čtení | Vidí celou timeline, nemůže nic editovat |

### Detailní matice práv

| Akce | Admin | Plánovač | MTZ | DTP | Viewer |
|------|-------|----------|-----|-----|--------|
| Vidět timeline | ✅ | ✅ | ✅ | ✅ | ✅ |
| Vytvořit / smazat blok | ✅ | ✅ | ❌ | ❌ | ❌ |
| Přesunout / resize blok | ✅ | ✅ | ❌ | ❌ | ❌ |
| Rozdělit blok (split) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Editovat sloupec DATA | ✅ | ✅ | ❌ | ✅ | ❌ |
| Editovat sloupec MATERIÁL | ✅ | ✅ | ✅ | ❌ | ❌ |
| Editovat sloupec BARVY | ✅ | ✅ | ❌ | ❌ | ❌ |
| Editovat sloupec LAK | ✅ | ✅ | ❌ | ❌ | ❌ |
| Editovat SPECIFIKACE | ✅ | ✅ | ❌ | ❌ | ❌ |
| Editovat termín Expedice | ✅ | ✅ | ❌ | ❌ | ❌ |
| Zamknout / odemknout blok | ✅ | ✅ | ❌ | ❌ | ❌ |
| Hromadné posuny | ✅ | ✅ | ❌ | ❌ | ❌ |
| Správa uživatelů | ✅ | ❌ | ❌ | ❌ | ❌ |
| Správa číselníků | ✅ | ❌ | ❌ | ❌ | ❌ |

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

*Dokument naposledy aktualizován: 2026-03 — verze VII*
