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

## Etapa 1 — Odstávky a provozní čas ✅ HOTOVO (2026-03-27)

### Z2 — Timezone bug ✅ HOTOVO
Vytvořen `src/lib/dateUtils.ts` se sdílenými helpery `pragueToUTC`, `utcToPragueHour`, `utcToPragueDateStr` (cached Intl.DateTimeFormat, two-pass DST korekce).
ShutdownManager nyní používá `pragueToUTC` při ukládání a `utcToPragueHour`/`utcToPragueDateStr` při načtení pro editaci. `fmtDatetime` v PlannerPage a `fmtDate` v TimelineGrid zobrazují čas přes `timeZone: "Europe/Prague"`.

### Z10 — Název odstávky jako chip v overlaye ✅ HOTOVO
Label chip přidán do obou render sekcí (global overlay + per-machine overlay). Text zkrácen text-overflow ellipsis, čitelný v light i dark mode.

### D12 — Bug drag horní hrany červeného overlaye ✅ HOTOVO
Horní handle renderován jen pro `overlayType === "end-block"` s `edge: "end"`, dolní jen pro `overlayType === "start-block"` s `edge: "start"`. `otherBoundaryHour` se hledá z partnerského overlaye téhož dne — preview i finalizace jsou konzistentní.

### Z9 — Editace odstávky ✅ HOTOVO
Po opravě Z2 editace vrací přesně zadaný čas — Prague roundtrip ověřen.

---

## Etapa 2 — Elegantní navigace v čase a historii ✅ HOTOVO

### Z1 + Z8 — Hybridní navigace ✅ HOTOVO
Segmented buttons [30d|60d|90d] + tlačítko "+ 30d" v headeru. `daysAhead`/`daysBack` state, průběžné rozšiřování bez stropu. „Přejít na" banner pro historické bloky + `handleJumpToOutOfRange`.

### D6 — Hledání podle textu/specifikace ✅ HOTOVO
`searchMatches`, `searchMatchIndex`, navigace šipkami ← →, počet výsledků zobrazen (`X/N`).

### K12 — Uložit preferované zobrazení planneru ✅ HOTOVO
`localStorage` klíče `ig-planner-zoom` a `ig-planner-aside-width` — načítání při mount, ukládání při změně.

---

## Etapa 3 — Chování bloků a metadata ✅ HOTOVO (2026-03-27)

### Z4 — Badge stavů dat po označení OK
- Po označení DATA/MATERIÁL jako OK → zobrazit stav v rámci stejného vizuálního pole kde se jinak ukazuje datum
- Po odškrtnutí OK → zobrazení se vrátí zpět na datumový režim bez ztráty dat

### Z6 — Splitované zakázky ✅ HOTOVO
Migrace `20260326204352_add_split_group_id`: přidáno pole `splitGroupId Int?`, self-relace `splitSiblings/splitRoot (onDelete: SetNull)`, index.
- Root blok dostane `splitGroupId = vlastní id`; nový (druhá část) dostane `splitGroupId = id rootu`
- `PUT /api/blocks/[id]`: `SPLIT_SHARED_FIELDS` propagovány přes `updateMany` do všech sourozenců
- `POST /api/blocks/route.ts`: přijímá a ukládá `splitGroupId`
- Frontend `handleBlockUpdate` v PlannerPage: lokální propagace do siblings (bez reloadu)
- `materialNote` záměrně NESDÍLENO — per-blok pole

### K3 — Viditelný indikátor split skupiny ✅ HOTOVO
Chip `✂X/Y` renderován přímo v `BlockCard` na timeline gridu (MODE_FULL i MODE_TINY).
`splitGroupMap` precomputed jako `Map<groupId, Block[]>` (O(n)) před column render loop — O(1) lookup per blok.

### K7 — Krátké zakázky / tooltip ✅ HOTOVO
`showTooltip = block.type !== "UDRZBA" && !badgeHovered` — tooltip se zobrazuje pro VŠECHNY non-UDRZBA bloky bez výškového prahu.
`badgeHovered` state potlačí tooltip při hover nad DateBadge/MAT sekcí → nedochází ke konfliktu s MTZ HoverCard.

### K8 + K9 — Specifikace indikátor ✅ HOTOVO
Svislý proužek 3px, barva `rgba(251,191,36,0.8)` (amber), `borderRadius: 2` — výrazný na všech barevných variantách bloků.

### U4 — Enter pro uložení v postranním editoru ✅ HOTOVO
`autoFocus` na destructive Button v obou delete dialozích (`keyDeletePending` + `multiDeletePending`) — Enter potvrdí smazání bez JS handleru.

### K1 — Potvrzení destruktivních akcí ✅ HOTOVO
- Single delete: `keyDeletePending` state + dialog před smazáním, Enter potvrdí
- Multi-delete (lasso): `multiDeletePending` state + dialog; po potvrzení `handleDeleteAll`
- Multi-delete undo: standalone bloky (ne série, ne split) se re-POST po Ctrl+Z; HTTP responses validovány `r.ok`; `deletedComplex` počítáno z `deletedIds` (ne původní selekcí)

### U1 — Klik do prázdna zavře detail bloku ✅ HOTOVO

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

## Etapa 5 — Analýza snap logiky a schedule validace ✅ Hotovo (2026-03-27)

### Z5 — Technická analýza: proč nejde plánovat na volná místa

Výstup = dokumentace, ne fix.

---

### Kde žije validace — repo-truth

**`src/lib/machineWorkHours.ts`** — obsahuje **jen TypeScript typ**, žádnou validační logiku.

Skutečná validace je na dvou místech:
- **Serverová:** kopie `checkScheduleViolation()` ve třech route souborech:
  - `src/app/api/blocks/route.ts` (řádek 150)
  - `src/app/api/blocks/[id]/route.ts` (řádek 315)
  - `src/app/api/blocks/batch/route.ts` (řádek 199)
- **Klientská:** `src/lib/workingTime.ts` — funkce `isBlockedSlotDynamic()`, `snapToNextValidStart()`, `snapGroupDelta()`

---

### Flexibilní mód (workingTimeLock)

V headeru existuje explicitní toggle tlačítko (`PlannerPage.tsx`, funkce `setWorkingTimeLock`, UI kolem řádku 3233):
- **Lock = true (výchozí):** "Víkendy/noc blokovány" — klient při drag/drop volá `snapToNextValidStart()` a přeskakuje blokované sloty
- **Lock = false:** "Flexibilní mód" — klient snap přeskočí, blok se umístí kam ukazuje kurzor

**Kritická asymetrie:** Flexibilní mód vypíná jen klientský snap. **Serverová validace pro ZAKAZKA bloky běží vždy.** Uživatel může v lock=false umístit ZAKAZKU mimo provoz → server vrátí 422 → toast "Blok se nepodařilo přesunout". To je záměr návrhu, ale pro uživatele neočekávané.

---

### Klientská snap logika

**`snapToSlot(date)`** (TimelineGrid.tsx) — čistě grafické zaokrouhlení na 30minutový slot bez kontextu pracovní doby.

**Single block drag** (TimelineGrid.tsx:1835):
```
if (workingTimeLockRef.current) → snapToNextValidStart(newMachine, newStart, duration, machineWorkHoursRef.current, machineExceptionsRef.current)
```

**Multi-block drag** (TimelineGrid.tsx:1875):
```
if (workingTimeLockRef.current) → snapGroupDelta(blocksOnNewMachine, deltaMs, machineWorkHoursRef.current, machineExceptionsRef.current)
```

**Queue drop** (`handleQueueDrop`, PlannerPage.tsx), **paste** (`handlePaste`, PlannerPage.tsx) — obě cesty volají `snapToNextValidStart()` pokud je lock zapnutý.

**Group paste nemá snap** (`handleGroupPaste`, PlannerPage.tsx): umísťuje bloky relativně k anchor bodu bez volání `snapToNextValidStart()` ani bez přístupu ke schedule datům. Problém není stale schedule, ale **absence snapu jako takového** — bloky se vloží přesně kam kurzor míří, bez ohledu na lock.

**Stale data — single move, multi-move, queue drop, single paste:** `machineWorkHoursRef.current` a `machineExceptionsRef.current` jsou reference na data načtená při page load. Pokud admin v jiné relaci změní směny nebo přidá exception, klient to nezjistí. Snap proběhne podle starých pravidel, server validuje podle nových → 422. Group paste stale data nepostihují (snap tam vůbec neběží).

---

### Klientský snap pro REZERVACE a UDRZBA — mismatch se serverem

`workingTime.ts` snap logika se v klientu aplikuje na **všechny typy bloků** pokud je lock zapnutý. Server validuje **jen ZAKAZKA**.

Praktický dopad: Uživatel chce umístit REZERVACI na konkrétní volné místo mimo pracovní dobu (např. přes víkend). S lock=true klient snappne REZERVACI na nejbližší pracovní čas, přestože by server umístění povolil. Uživatel to vnímá jako „nejde to dát na volné místo" — ale jde o záměrně restriktivní klientský snap, ne o serverové odmítnutí.

---

### Serverová validace — dva fallback problémy

**Fallback 1 — prázdný schedule a exceptions** (route.ts:164):
```typescript
if (schedule.length === 0 && exceptions.length === 0) return null;
```
Pokud stroj nemá žádné záznamy v `MachineWorkHours` → validace neproběhne, vše prochází.

**Fallback 2 — chybějící řádek pro konkrétní dayOfWeek (závažnější):**
```typescript
const row = exc ?? schedule.find((r) => r.dayOfWeek === dayOfWeek); // route.ts:170
if (row && (!row.isActive || ...)) { return violation; }           // route.ts:171
```
Pokud schedule existuje (→ fallback 1 se nespustí), ale pro daný `dayOfWeek` chybí řádek → `row` je `undefined` → podmínka `if (row && ...)` je **false** → slot projde bez validace.

Na serveru: chybějící dayOfWeek = povolený čas.
Na klientu (`workingTime.ts:41`): chybějící dayOfWeek = fallback na hardcoded `isBlockedSlot()` (fixní pravidla XL_105/XL_106).

**Toto je nejvýznamnější client/server mismatch:** Klient blokuje slot podle hardcoded logiky, server ho povolí.

---

### Volání validace v API routes

| Route | Validace probíhá | Podmínka |
|---|---|---|
| `POST /api/blocks` (route.ts:60) | ✅ | jen `type === "ZAKAZKA"` |
| `PUT /api/blocks/[id]` ([id]/route.ts:80–99) | ✅ | při timing change NEBO změně typu na ZAKAZKA; výsledný effectiveType musí být "ZAKAZKA" |
| `POST /api/blocks/batch` (batch/route.ts:57) | ✅ | jen bloky kde `existing.type === "ZAKAZKA"` |
| Typ REZERVACE / UDRZBA | ❌ | záměrně nevalidováno |

---

### autoResolveOverlap() — krok 1 vs krok 2

**Krok 2 — forward push chain** (PlannerPage.tsx:2298): Pokud je lock zapnutý, volá `snapGroupDelta()`. Pracovní dobu respektuje.

**Krok 1 — backward overlap correction** (PlannerPage.tsx:2208): Posune blok na `preceding.endTime` přímo bez snap logiky. Spoléhá na to, že server PUT vrátí 422 pokud nové místo leží mimo provoz. V takovém případě overlap resolution selže a vrátí `"failed"`.

Tedy: autoResolveOverlap nerespektuje snap jen v kroku 1 backward correction. Krok 2 chain push je v pořádku.

---

### Timezone — reálná divergence

`pragueOf()` na serveru používá `Intl.DateTimeFormat` s `formatToParts()` — leading zeros jsou zajištěny automaticky, nejde o bug.

**Skutečná divergence je jinde:** Klientský `isSameDayLocal()` (workingTime.ts:25) porovnává exception datum v **lokální timezone prohlížeče**:
```typescript
a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
```
Server používá Prague-specifický dateStr z `pragueOf()`. Pokud je browser mimo Europe/Prague nebo kolem půlnoci, exception přiřazená ke konkrétnímu pražskému dni se může matchovat na jiný den než na serveru.

---

### Reprodukční scénáře

**Scénář A — chybějící dayOfWeek (client/server mismatch):**
1. V MachineWorkHours existuje záznam jen pro pondělí–pátek. Sobota chybí.
2. Uživatel se pokusí umístit ZAKAZKU na sobotu. Klient: lock=true → `isBlockedSlotDynamic()` nenajde row pro sobotu → fallback `isBlockedSlot()` → sobota je blokovaná → snap přeskočí na pondělí ráno.
3. Server: chybějící row → slot projde → validace pass → blok se vytvoří na sobotu.
4. Výsledek: blok na pondělí místo soboty, přestože server by sobotu povolil.

**Scénář B — stale schedule ve všech cestách:**
Admin přidá exception dnes ráno. Uživatel má otevřený plánovač od včera. Všechny snap operace (single move, drop z fronty, paste) používají zastaralou referenci. Server vrátí 422. Uživatel musí refreshnout stránku.

**Scénář C — REZERVACE s lock=true:**
Uživatel chce REZERVACI na víkend (server to povolí). S lock=true klient snappne na pondělí. Jediná cesta: přepnout na flexibilní mód a znovu umístit.

**Scénář D — group paste bez snapu:**
Uživatel zkopíruje skupinu bloků a vloží ji přes víkend. `handleGroupPaste` nevolá `snapToNextValidStart()`. Bloky se vytvořit pokusí na neplatné časy → server vrátí 422 → toast "Blok se nepodařilo vytvořit".

---

### Doporučení pro samostatnou etapu fixu

1. **Centralizovat `checkScheduleViolation()`** do sdíleného `src/lib/validateBlockSchedule.ts` — importovat ve všech 3 routes.
2. **Sjednotit fallback pro chybějící dayOfWeek:** Server by měl při chybějícím row dělat totéž co klient — fallback na hardcoded `isBlockedSlot()`, ne tiché povolení.
3. **Group paste musí snapovat** — `handleGroupPaste` volat `snapToNextValidStart()` na anchor bloku, ostatní bloky posunout relativně.
4. **Refresh schedule po změně** — přidat revalidaci `machineWorkHours` a `machineExceptions` po každém uložení (nebo po návratu focus na okno). Stale data postihují všechny operace.
5. **Opravit timezone divergenci v `isSameDayLocal()`** — použít Prague-specifické porovnání místo lokální timezone klienta.

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

- [x] Odstávka zadaná na 8:00 se uloží a zobrazí jako 8:00 Praha — testovat v CET (UTC+1) i CEST (UTC+2)
- [x] Editace existující odstávky vrátí přesně stejný čas, který byl zadán
- [x] Drag dolní hrany overlaye mění jen endHour, drag horní hrany mění jen startHour
- [x] Pojmenovaná odstávka zobrazuje chip s labelem v overlay, čitelný v light i dark mode
- [ ] Hledání podle čísla zakázky, popisu i specifikace funguje + zobrazí počet výsledků
- [ ] Zoom a šířka builderu se po reloadu stránky načtou z localStorage
- [x] Split → úprava popisu v části A → propsáno do části B; čas, stroj a stav hotovo části B se NEZMĚNIL
- [x] Blok pod 1h zobrazí tooltip s plným obsahem při hover
- [x] Specifikace (z job builderu) je indikována přímo v bloku, čitelná v obou tématech
- [x] Delete confirm dialog: Enter klávesa potvrdí smazání (single i multi)
- [x] Lasso vyber standalone bloky → Delete → potvrdit → Ctrl+Z → bloky se obnoví
- [x] Hover na block s MTZ poznámkou: tooltip se nezobrazí nad badge sekcí, MTZ HoverCard viditelný
- [x] Split chip ✂X/Y viditelný na obou blocích skupiny přímo v timeline gridu
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
