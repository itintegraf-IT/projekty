# CLAUDE.md — Integraf Výrobní plán

Tento soubor čte Claude Code automaticky. Udržuj ho aktuální po každé etapě.

---

## O projektu

Interní webová aplikace pro plánování výroby na strojích XL 105 a XL 106.
Umožňuje plánovat zakázky, rezervace a údržbu na časové ose.

**Stack:** Next.js + React + TypeScript + Tailwind CSS v4 + Prisma 5 + SQLite (dev) → MySQL (produkce)

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
| 8 | Uživatelé, role a přihlašování | ⬜ Nezačato |
| 9 | Admin dashboard (uživatelé + číselníky) | ⬜ Nezačato |

---

## Spuštění projektu

```bash
npm run dev        # dev server → http://localhost:3000
npx prisma studio  # prohlížeč databáze → http://localhost:5555
```

Po čistém klonu nebo smazání databáze:
```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run prisma:seed
```

---

## Důležitá rozhodnutí

- **Databáze:** MySQL (IT specialista zná MySQL). Dev = SQLite (zero-config).
- **Prisma verze:** `^5` — záměrně ne `latest` (v7 má breaking changes s novým config systémem)
- **Enumy:** uloženy jako string (SQLite kompatibilita), při přechodu na MySQL Prisma vytvoří ENUM sloupce automaticky
- **Tailwind:** verze 4, používá `@import "tailwindcss"` (ne `@tailwind base`)
- **Číselníky:** hodnoty pro DATA, MATERIÁL, BARVY, LAK jsou uloženy v DB (model `CodebookOption`), ne hardcoded. Spravuje je Admin přes dashboard.
- **Snapshot labelu:** blok ukládá `optionId` + `snapshotLabel` — při přejmenování položky číselníku historická data zůstanou konzistentní.

---

## Klíčové soubory

| Soubor | Účel |
|--------|------|
| `prisma/schema.prisma` | DB schema — Block + CodebookOption + User modely |
| `src/lib/prisma.ts` | Prisma singleton klient |
| `src/app/page.tsx` | Server Component — načítá bloky + companyDays z DB |
| `src/app/api/company-days/route.ts` | GET + POST firemních dnů |
| `src/app/api/company-days/[id]/route.ts` | DELETE firemního dne |
| `src/app/api/codebook/route.ts` | GET číselníku dle category (etapa 5) |
| `src/app/api/codebook/[id]/route.ts` | PUT + DELETE položky číselníku (etapa 9) |
| `src/app/_components/PlannerPage.tsx` | Client Component — builder + fronta + detail + ShutdownManager |
| `src/app/_components/TimelineGrid.tsx` | Vizuální timeline grid (datum 44px + čas 72px + 2 strojové sloupce) |
| `src/app/api/blocks/route.ts` | GET all + POST |
| `src/app/api/blocks/[id]/route.ts` | GET + PUT + DELETE |
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
- **DateBadge:** zelená = ok, amber = `now > requiredDate && !ok`, šedá = datum ještě nenastalo
- **fmtDate():** helper pro parse DB timestamps (ISO i date string) — nikdy nepoužívat `new Date(s + "T00:00:00")`
- **Warn logika:** `now > requiredDate && !ok` — NE `blockStart < requiredDate`

### PlannerPage.tsx
- Builder: typ + číslo zakázky + délka + popis + výrobní sloupečky + termín expedice → "Přidat do fronty"
- Fronta: kartičky s `draggable`, přetažením na timeline vznikne blok (stroj = cílový sloupec, čas = pozice puštění)
- `QueueItem` typ: id, orderNumber, type, durationHours, description, dataStatusId, materialStatusId, barvyStatusId, lakStatusId, specifikace, deadlineExpedice
- Aside panel je resizable (8px handle), zIndex: 10; timeline container zIndex: 0; sticky header zIndex: 30
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

## Komunikace

- Vždy komunikuj česky
- Uživatel nerozumí databázím — vysvětlovat jednoduše
- Před větší implementací vždy použij EnterPlanMode
