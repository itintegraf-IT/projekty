# PLAN.md — Aktivní vlna úprav planneru

## Summary
- Tahle vlna je bugfix-first: nejvyšší priorita jsou odstávky, časová navigace, splitované zakázky a provozní drobnosti, které blokují používání planneru.
- Položky `backlog` zůstanou v samostatné sekci bez implementační specifikace.
- Položky `hotovo` budou v dokumentu jen jako uzavřené nebo k rychlému ověření.
- **Timezone pravidlo celé appky:** vše se zobrazuje a ukládá v **Europe/Prague**. Viz sekce Technické specifikace.

---

## Instrukce pro implementaci — workflow agenta

### Subagenty (povinné)
Před každou etapou spustit **paralelní Explore agenty** pro průzkum dotčených souborů:
- 1 agent na dotčené komponenty (PlannerPage, TimelineGrid)
- 1 agent na API routes a Prisma schema
- 1 agent na existující utility a helper funkce (hledat co lze reusovat)

Po dokončení kódu spustit **review agenta** (`/simplify` skill) pro kontrolu kvality.

### MCP nástroje
- **`mcp__shadcn`** — před přidáním jakékoliv UI komponenty zkontrolovat `list_items_in_registries` a `search_items_in_registries`, zda existuje vhodná shadcn komponenta
- **`mcp__context7`** — při nejasnostech s Next.js, Prisma nebo Tailwind API použít `query-docs` pro aktuální dokumentaci
- **`mcp__ruflo__browser_*`** — po implementaci spustit `browser_open` + `browser_screenshot` pro vizuální ověření výsledku v prohlížeči

### Skills
- **`/simplify`** — spustit po každé dokončené etapě pro review kódu (reuse, kvalita, efektivita)
- **Plan Mode (`EnterPlanMode`)** — povinně před každou větší implementací, která mění DB schema nebo přidává nové API routes

---

## Etapa 1 — Odstávky a provozní čas `PRIORITA`

### Z2 — Timezone bug (root cause)
**Soubor:** `src/app/_components/PlannerPage.tsx`, řádky ~1322–1323

Stávající kód:
```typescript
const startISO = `${startDate}T${String(startHour).padStart(2, "0")}:00:00`;
```
ISO string bez timezone suffixu. Node.js ho parsuje jako UTC, prohlížeč jako lokální čas → overlay se zobrazí o 1–2 hodiny posunutý (záleží na DST).

**Fix:** Vytvořit sdílený helper `pragueToUTC` (viz sekce Technické specifikace níže) a nahradit template string.

**Doplňující body:**
- Při načtení pro editaci ShutdownManageru musí proběhnout inverzní konverze UTC → Praha čas
- Overlay v TimelineGrid musí zobrazovat čas formátovaný přes `Europe/Prague` (ne `getHours()`)
- Veškerý roundtrip odstávky používá jednu konverzi — žádné míchání `new Date()` bez timezone

### Z10 — Název odstávky jako chip v overlaye
**Soubor:** `src/app/_components/TimelineGrid.tsx`, řádky ~2002–2015 (render global overlay), ~2130–2143 (per-machine)

- Přidat label chip uvnitř overlaye (ne těžký blok textu)
- Zkrácený na jeden řádek (text-overflow ellipsis), plný název v hover/tooltip
- Čitelný v light i dark mode

### D12 — Bug drag horní hrany červeného overlaye
**Soubor:** `src/app/_components/TimelineGrid.tsx`, řádky ~2204–2219

Stávající kód (pravděpodobně swapped):
```typescript
// Horní handle:
dragStateRef.current = { ..., edge: "end", ... }   // ← bug: mělo by být "start"
// Dolní handle:
dragStateRef.current = { ..., edge: "start", ... }  // ← bug: mělo by být "end"
```
Při finalizaci dragu: `edge === "start"` mění `startHour`, `edge === "end"` mění `endHour`.
Horní handle (označen jako "end") proto mění endHour místo startHour → rozbije celý rozsah.

**Fix:** Prohodit hodnoty `edge` u obou handlerů.

### Z9 — Editace odstávky
Považovat za hotové **pouze pokud** po opravě Z2 zůstane editace stabilní (vrátí stejné datum i čas, který uživatel zadal).

---

## Etapa 2 — Elegantní navigace v čase a historii

### Z1 + Z8 — Hybridní navigace (společný návrh)
- Zachovat kompaktní výchozí planner
- Přidat rychlé skoky po měsících (tlačítka ← → v headeru)
- Průběžně rozšiřovat historii i budoucnost bez tvrdého stropu 90 dní
- Jasný tok „našel jsem starý blok, ukaž mi jeho okolí"

### D6 — Hledání podle textu/specifikace
Stávající implementace **již** prohledává `orderNumber`, `description`, `specifikace`:
```typescript
// PlannerPage.tsx, řádky ~1879–1898
[b.orderNumber, b.description, b.specifikace].some(f => f?.toLowerCase().includes(q));
```
Stav: **existuje, ale UX je nedostatečné.** Doplnit:
- Počet nalezených výsledků (např. „3 výsledky")
- Navigace šipkami mezi výsledky (existuje `searchMatchIndex`, chybí vizuální feedback)

### K12 — Uložit preferované zobrazení planneru
- `localStorage` klíč `ig-planner-zoom` → `slotHeight` (zoom timeline)
- `localStorage` klíč `ig-planner-aside-width` → šířka Job Builderu
- Načíst při mount, uložit při změně přes `useEffect`
- Žádný serverový profil ani DB — preference jsou lokální v prohlížeči

---

## Etapa 3 — Chování bloků a metadata

### Z4 — Badge stavů dat po označení OK
- Po označení DATA/MATERIÁL jako OK → zobrazit stav v rámci stejného vizuálního pole kde se jinak ukazuje datum
- Po odškrtnutí OK → zobrazení se vrátí zpět na datumový režim bez ztráty dat

### Z6 — Splitované zakázky (vyžaduje DB migraci)
**Stávající stav:** Split vytvoří nezávislý blok se stejným `orderNumber` — žádná vazba neexistuje. `recurrenceParentId` je POUZE pro opakování, ne pro split.

**DB změna (Workflow B — migrace):**
```prisma
// Přidat do Block modelu v prisma/schema.prisma:
splitGroupId   Int?
splitSiblings  Block[]  @relation("SplitGroup")
splitRoot      Block?   @relation("SplitGroup", fields: [splitGroupId], references: [id], onDelete: SetNull)

@@index([splitGroupId])
```

**Logika při splitu:**
1. Existující blok dostane `splitGroupId = vlastní id` (self-link jako root)
2. Nový blok (druhá část) dostane `splitGroupId = id původního bloku`
3. **Soubory:** `src/app/_components/TimelineGrid.tsx` řádky ~1803–1813 (handleSplitBlockAt), `src/app/api/blocks/route.ts` (POST), `src/app/api/blocks/[id]/route.ts` (PUT)

**Sdílená metadata (propagace do celé skupiny při editaci):**
- Číslo zakázky, popis, výrobní stavy (DATA/MAT/BARVY/LAK), specifikace, poznámky
- `PUT /api/blocks/[id]` — pokud blok má `splitGroupId`, aktualizovat všechny bloky se stejným `splitGroupId`

**Nesdílená data (zůstávají per-blok):**
- Čas (startTime/endTime), stroj, lock, stav hotovo (printCompleted)

### K3 — Viditelný indikátor split skupiny
- V BlockDetail zobrazit „část X ze skupiny splitu" (nebo jen ikonu)
- Musí být jasné, kdy uživatel mění jen jednu část a kdy celou skupinu

### K7 — Krátké zakázky do 1 hodiny
`BlockCard` zobrazuje text od `>= 40px` výšky. Při malém zoomu (slotHeight 3–5px) je 1h blok = 6–10px → pod prahem.
**Fix:** Tooltip s plným obsahem při hover — nezávislý na výšce bloku.

### K8 + K9 — Specifikace viditelná přímo v bloku
- Blok může mít vyplněnou `specifikace` (zadávána v job builderu) — ale tato informace NENÍ vidět přímo v BlockCard
- Přidat vizuální indikátor specifikace přímo v bloku (ikona nebo barevný pruh)
- Čitelný v dark i light mode

### U4 — Enter pro uložení v postranním editoru
- Enter ukládá formulářové změny
- Nesmí rozbít víceřádková textová pole (textarea), kde je Enter součást psaní

### K1 — Potvrzení destruktivních akcí
- Smazání bloku, smazání odstávky a podobné nevratné akce mají mít confirm dialog
- Střídmě — jen kde hrozí reálná ztráta dat; ne u každé změny

### U1 — Klik do prázdna zavře detail bloku

---

## Etapa 4 — Notifikace pro MTZ a DTP

### D14 — In-app upozornění z context menu

**Co existuje:**
- Context menu na blocích ✓ (`src/components/ui/context-menu.tsx` + `TimelineGrid.tsx` řádky ~1320–1387)
- Bell ikona + badge + InfoPanel pro ADMIN/PLANOVAT ✓ (audit DTP/MTZ aktivity)

**Co je potřeba vytvořit:**

**DB model (Workflow B — migrace):**
```prisma
model Notification {
  id                  Int      @id @default(autoincrement())
  blockId             Int
  blockOrderNumber    String?
  targetRole          String   // "MTZ" | "DTP"
  createdByUserId     Int
  createdByUsername   String
  isRead              Boolean  @default(false)
  readAt              DateTime?
  createdAt           DateTime @default(now())

  @@index([targetRole, isRead, createdAt])
  @@index([blockId])
}
```
Poznámka: bez FK na Block (stejný pattern jako AuditLog — log přežije smazání bloku).

**API routes (nové soubory):**
- `POST /api/notifications` — vytvoření upozornění (ADMIN/PLANOVAT only)
- `GET /api/notifications` — inbox pro přihlášeného uživatele (filtr dle role)
- `PATCH /api/notifications/[id]/read` — označení jako přečtené

**Role-based viditelnost (ROZHODNUTO):**

| Role | Stávající bell | Nová bell (notifikace) |
|------|---------------|------------------------|
| ADMIN, PLANOVAT | Audit DTP/MTZ aktivity | Odeslané notifikace (history) |
| DTP | Nevidí | Vlastní inbox (targeted) |
| MTZ | Nevidí | Vlastní inbox (targeted) |
| VIEWER, TISKAR | Nevidí | Nevidí |

- DTP a MTZ dostanou **vlastní bell ikonu** v headeru — oddělená od audit bell ADMIN/PLANOVAT
- Vizuál: stejný iOS-style bell, odlišená barvou nebo ikonou

**ContextMenu akce (přidat do `TimelineGrid.tsx` ~řádek 1385):**
- `Upozornit MTZ` — jen ADMIN/PLANOVAT, jen ZAKAZKA typ
- `Upozornit DTP` — jen ADMIN/PLANOVAT, jen ZAKAZKA typ

**Polling:** sloučit s existujícím `fetchTodayAudit` intervalem (60s) — jeden `setInterval` pro oba fetch.

---

## Etapa 5 — Analýza bez okamžitého fixu

### Z5 — Technická analýza: proč nejde plánovat na volná místa

Výstup = dokumentace, ne fix.

**Co analyzovat:**
- Klientská snap logika v TimelineGrid vs serverová validace v `checkScheduleViolation()` (`src/lib/machineWorkHours.ts`)
- `POST /api/blocks`, `PUT /api/blocks/[id]`, `POST /api/blocks/batch` — kde a jak se volá validace
- Výjimky provozních hodin (MachineScheduleException) — zda přebíjí správně
- Fallback logika proti DB směnám (MachineWorkHours)
- Zdokumentovat, zda do problému vstupuje flexibilní mód

**Výstup:** přesná sada reprodukčních scénářů + pravděpodobné příčiny + doporučení pro samostatnou etapu fixu.

---

## Technické specifikace

### Timezone — Europe/Prague everywhere

**Helpers (nový sdílený soubor nebo přidat do existujícího lib):**
```typescript
// Konverze Praha čas → UTC Date objekt
function getPragueUTCOffset(date: Date): number {
  const utcMs = Date.parse(new Date(date).toLocaleString('en-US', { timeZone: 'UTC' }));
  const czMs  = Date.parse(new Date(date).toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  return (utcMs - czMs) / 60000; // v minutách (kladné = Praha za UTC)
}

function pragueToUTC(dateStr: string, hour: number, minute = 0): Date {
  const approx = new Date(`${dateStr}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`);
  return new Date(approx.getTime() - getPragueUTCOffset(approx) * 60000);
}

// Konverze UTC Date → Praha hodiny (pro editační formuláře)
function utcToPragueHour(date: Date): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false })
      .format(date)
  );
}
```

**Existující pattern (z `checkScheduleViolation`) — použít stejně pro display:**
```typescript
new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', hour: '2-digit', hour12: false }).format(date)
```

### DB změny — přehled (Workflow B)

| Etapa | Migrace | Popis |
|-------|---------|-------|
| 3 | `add_split_group_id` | `splitGroupId Int?` + self-relation + index na Block |
| 4 | `add_notifications` | Nový model `Notification` |

---

## Klíčové soubory

| Soubor | Dotčené etapy |
|--------|---------------|
| `src/app/_components/PlannerPage.tsx` | 1 (ShutdownManager), 2 (localStorage), 3 (BlockEdit propagace) |
| `src/app/_components/TimelineGrid.tsx` | 1 (D12 fix, overlay chip), 3 (split, tooltip, K8/K9), 4 (context menu) |
| `prisma/schema.prisma` | 3 (splitGroupId), 4 (Notification model) |
| `src/app/api/blocks/route.ts` | 3 (POST split → splitGroupId) |
| `src/app/api/blocks/[id]/route.ts` | 3 (PUT → propagace do split skupiny) |
| `src/app/api/notifications/route.ts` | 4 (NOVÝ — GET + POST) |
| `src/app/api/notifications/[id]/read/route.ts` | 4 (NOVÝ — PATCH) |

---

## Public API / DB změny (souhrn)

- **Block model:** přidat `splitGroupId Int?` + self-relation (Etapa 3)
- **Notification model:** nový, bez FK na Block (Etapa 4)
- **API notifikace:** `POST`, `GET`, `PATCH /read` (Etapa 4)
- **K12:** žádný serverový profil — localStorage only

---

## Test Plan

- [ ] Odstávka zadaná na 8:00 se uloží a zobrazí jako 8:00 Praha — testovat v CET (UTC+1) i CEST (UTC+2)
- [ ] Editace existující odstávky vrátí přesně stejný čas, který byl zadán
- [ ] Drag dolní hrany overlaye mění jen endHour, drag horní hrany mění jen startHour
- [ ] Pojmenovaná odstávka zobrazuje chip s labelem v overlay, čitelný v light i dark mode
- [ ] Hledání podle čísla zakázky, popisu i specifikace funguje + zobrazí počet výsledků
- [ ] Zoom a šířka builderu se po reloadu stránky načtou z localStorage
- [ ] Split → úprava popisu v části A → propsáno do části B; čas, stroj a stav hotovo části B se NEZMĚNIL
- [ ] Blok pod 1h zobrazí tooltip s plným obsahem při hover
- [ ] Specifikace (z job builderu) je indikována přímo v bloku, čitelná v obou tématech
- [ ] PLANOVAT odešle notifikaci pro DTP z context menu na bloku
- [ ] DTP se přihlásí → vidí vlastní bell s badge a inbox s notifikací
- [ ] Po označení notifikace jako přečtené badge zmizí
- [ ] ADMIN/PLANOVAT bell stále zobrazuje audit DTP/MTZ aktivity (nezměněno)

---

## Backlog mimo tuto vlnu
- `Z3`, `Z7`, `D1` až `D5`, `D7` až `D11`, `D15`, `K6`, `K10`, `K11`, `U2`, `U3`, `U5`
- `K13` explicitně nedělat
- `K2`, `K4`, `K5`, `D13`, `Z9` vést jako hotovo nebo k rychlému ověření, ne jako nové zadání

---

## Assumptions
- Timezone: appka je vždy v Europe/Prague — zobrazení i uložení ignoruje timezone prohlížeče
- Hybridní navigace je schválený směr pro `Z1` a `Z8`
- Split sdílí jen metadata, ne plánovací pozici a ne stav dokončení
- Notifikace pro `D14` budou v první verzi in-app inbox s badge — žádný email/SMS/push
- DTP a MTZ mají vlastní bell oddělenou od bell ADMIN/PLANOVAT
- Destruktivní potvrzení střídmě — jen kde hrozí reálná ztráta dat
- UI vzory pro `Z10`, `D14` a `K1` drží iOS styl: jasná hierarchie, stručné texty, krátké menu, alert jen pro destruktivní akce
