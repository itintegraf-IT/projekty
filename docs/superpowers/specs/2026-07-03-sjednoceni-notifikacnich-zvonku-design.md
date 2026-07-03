# Sjednocení notifikačních zvonků — design

Datum: 2026-07-03
Autor: Vojta + Claude
Stav: návrh ke schválení

## Problém

Role ADMIN a PLANOVAT vidí v headeru pláneru **dva vizuálně identické zvonečky**
vedle sebe ([PlannerPage.tsx:3149-3213](../../../src/app/_components/PlannerPage.tsx)):

1. **Zvonek 1 — „Aktivita" (InfoPanel)** — audit log úprav od DTP/MTZ/TISKAR za
   poslední 3 dny; vyjíždí v **pravém** `aside` (sdílí ho s detailem bloku a
   správou odstávek); data z `GET /api/audit/today`; badge = `auditNewCount`.
2. **Zvonek 2 — „Upozornění" (InboxPanel)** — notifikace cílené na roli
   uživatele; pro ADMIN/PLANOVAT jsou to zejména upozornění na drift kalendáře
   (`CALENDAR_DRIFT`, etapa 6) s tlačítkem „Přepočítat"; vyjíždí v **levém**
   panelu; data z `GET /api/notifications`; badge = `notifNewCount`.

Oba zvonky mají **stejnou ikonu a žádný textový popisek** — působí jako
zdvojená chyba a je matoucí, který otevřít. Přitom oba nesou smysluplný obsah
(druhý zvonek NENÍ prázdný — chodí do něj drift notifikace pro ADMIN).

## Cíl

Sloučit oba zvonky do **jednoho** vstupního bodu s dvěma záložkami
(**Upozornění** | **Aktivita**), a přitom **odlehčit** už tak dlouhou
`PlannerPage.tsx` (~3525 řádků) — notifikační logika a UI se z ní vytáhne do
samostatných, testovatelných jednotek.

Rozsah je **čistě frontend**: žádná změna API, DB, ani logiky vytváření/čtení
notifikací. Mění se pouze prezentace a to, kde v kódu žije.

## Rozhodnutí (odsouhlasená)

| Téma | Volba |
| --- | --- |
| Umístění sloučeného panelu | **Vlevo** (kde je dnes InboxPanel); nekoliduje s detailem bloku vpravo |
| Výchozí tab po otevření | **Upozornění** (akceschopné — drift kalendáře) |
| Badge na zvonku | **Jedno číslo = součet** `notifNewCount + auditNewCount`; uvnitř panelu malý počet u každého tabu |
| Role jen s Upozorněními (DTP, MTZ, OBCHODNIK) | **Bez tabů** — prostý panel Upozornění; jejich zážitek se nemění |
| Tab komponenta | **Vlastní lehký přepínač** (2 tlačítka + `useState`), ne shadcn Tabs — žádná nová závislost, sedí ke stávajícím ručně stylovaným panelům |
| Úroveň dekompozice | **Úroveň 3** — panel, zvonek i logika ven z PlannerPage |

## Architektura

Tři nové jednotky + drobný refaktor dvou stávajících komponent.

### 1. `src/hooks/useNotifications.ts` (nový hook)

Vlastní veškerý notifikační **stav a datové operace**, které dnes leží
roztroušené v `PlannerPage.tsx`:

- Stav: `notifications: NotificationItem[]`, `auditLogs: AuditLogEntry[]`,
  `notifNewCount`, `auditNewCount`, `activeTab: "inbox" | "activity"`.
- Akce: `fetchNotifications()`, `fetchAudit()`, `markRead(id)`,
  `openInfo()` (otevře na Aktivitu + označí audit za viděný),
  `setActiveTab(tab)`.
- Odvozené: `totalBadge = notifNewCount + auditNewCount`.

**Aktualizace dat — beze změny chování:** notifikace ani audit **nejsou**
řízené SSE. Dnes se aktualizují jen (a) při otevření panelu a (b) 60s
pollingem (`setInterval`, viz PlannerPage:886-891). Hook tuto logiku převezme
1:1 — vlastní `useEffect` s iniciálním fetchem + 60s intervalem. **Žádný SSE
handler se nepřidává** (sdílené `useSSE` v PlannerPage zůstává netknuté a
notifikací se netýká). To zjednodušuje hook i integraci.

Badge počítání zůstává identické: `auditNewCount` = počet audit záznamů
novějších než `localStorage["auditLastSeen"]`; `notifNewCount` = počet
`!isRead` notifikací. Otevření Aktivity nastaví `auditLastSeen` a vynuluje
`auditNewCount` (dnešní `handleOpenInfoPanel`).

Rozhraní hooku je návrhový bod pro implementační plán — cílem je, aby
PlannerPage držel jen `const notif = useNotifications(currentUser.role)` a
předával části komponentám. Stav otevření panelu (`isOpen`/tab) může zůstat
v hooku nebo v PlannerPage — plán zvolí; podstatné je, že fetch/počítadla/
markRead jsou v hooku.

### 2. `src/components/NotificationBell.tsx` (nová komponenta)

Tlačítko zvonku v headeru + badge. Nahrazuje dvě dnešní inline tlačítka.

- Props: `count: number`, `onClick: () => void`, `title?: string`.
- Vykreslí SVG zvonek (28×28, stejný jako dnes) + červený badge, když
  `count > 0`.

### 3. `src/components/NotificationsPanel.tsx` (nová komponenta)

Levý vyjížděcí panel — **chrome** (obal): hlavička, přepínač tabů, tlačítko
„Zpět" — a uvnitř vykreslí obsah aktivního tabu.

- Props: `role`, `notifications`, `auditLogs`, `activeTab`, `onTabChange`,
  `onClose`, `onMarkRead`, `onJumpToBlock`, počty pro badge u tabů.
- Pro **ADMIN/PLANOVAT**: nahoře přepínač **Upozornění** | **Aktivita**
  (2 stylovaná tlačítka; aktivní zvýrazněné; u každého malý počet
  nepřečtených/nových). Pod ním obsah aktivního tabu.
- Pro **DTP/MTZ/OBCHODNIK**: bez přepínače, rovnou obsah Upozornění.

### 4. Refaktor `InboxPanel.tsx` a `InfoPanel.tsx`

Dnes každý renderuje vlastní chrome (hlavička + „Zpět") **i** seznam. Chrome se
přesouvá do `NotificationsPanel`. Proto z každého vytáhneme **jen tělo seznamu**
jako čistou obsahovou komponentu:

- `InboxList` — seznam notifikací (props: `notifications`, `onMarkRead`,
  `onJumpToBlock`). Beze změny logiky, jen bez vnějšího rámu.
- `AuditList` — seznam auditních záznamů (props: `logs`, `onJumpToBlock`,
  `onClose`). Beze změny logiky (včetně všech větví akcí: UPDATE, CREATE,
  DELETE, PRINT_*, EXPEDITION_*, AUTO_SHIFT, AUTO_REFLOW).

Implementační plán ověří, zda `InboxPanel`/`InfoPanel` mají i jiné konzumenty
než PlannerPage. Pokud ne, staré wrappery se zruší (žádný mrtvý kód); pokud
ano, zůstanou jako tenké obaly nad novými `*List` komponentami.

## Datový tok

```
useNotifications (stav + fetch + markRead)
      │  data + akce
      ▼
PlannerPage  ──► NotificationBell  (count = totalBadge, onClick = notif.open)
      │
      └────────► NotificationsPanel (activeTab, onTabChange, onClose, onMarkRead,
                     onJumpToBlock, notifications, auditLogs, počty)
                        ├─ tab „Upozornění" → InboxList
                        └─ tab „Aktivita"   → AuditList

useNotifications: iniciální fetch + 60s polling (žádné SSE, beze změny chování)
```

`onJumpToBlock` (scroll na blok v timeline) zůstává v PlannerPage a předává se
dolů jako callback — panel/hook ho jen volají.

## Co se NEmění

- API endpointy `/api/notifications`, `/api/audit/today` — beze změny.
- Logika vytváření notifikací (`CALENDAR_DRIFT`, BLOCK_NOTIFY, rezervační) —
  beze změny.
- Role-based viditelnost obsahu — stejná pravidla, jen sjednocená pod jeden
  zvonek.
- Chování „Přepočítat" u driftu, „✓ Přečteno", odkazy na blok/rezervaci.
- Vzhled jednotlivých položek seznamu (přesune se, nepřepisuje).

## Dopad na soubory

| Soubor | Změna |
| --- | --- |
| `src/hooks/useNotifications.ts` | **nový** — stav, fetch, markRead, badge, SSE reakce |
| `src/components/NotificationBell.tsx` | **nový** — tlačítko zvonku + badge |
| `src/components/NotificationsPanel.tsx` | **nový** — panel s taby (chrome) |
| `src/components/InboxPanel.tsx` | refaktor → `InboxList` (tělo bez chrome) |
| `src/components/InfoPanel.tsx` | refaktor → `AuditList` (tělo bez chrome) |
| `src/app/_components/PlannerPage.tsx` | **odlehčení** — smazat 2 inline zvonky + panel-wiring + notif. stav/fetch; nahradit hookem a komponentami |

## Testování

- `NotificationBell` — badge se skryje při `count = 0`, zobrazí při `> 0`.
- `NotificationsPanel` — pro ADMIN/PLANOVAT jsou 2 taby a přepínají se; pro
  DTP/MTZ/OBCHODNIK žádné taby; výchozí tab = Upozornění.
- Čisté helpery (`src/lib/notifications.ts`) — `countUnread`, `totalBadge`,
  `countNewSince` (audit vs. lastSeen) mají `node --test` pokrytí (konvence
  projektu: 16 test souborů, žádná React test knihovna).
- `useNotifications`, `NotificationBell`, `NotificationsPanel` — bez render
  testů (projekt nemá React testing library a nepřidáváme závislost); ověření
  přes `npm run build`, `npx eslint` a ruční kontrolu v UI.
- Regrese: `npm run build` čistý, `npx eslint` bez nových warningů, ověřit v UI
  že ADMIN vidí jeden zvonek se dvěma taby a DTP jeden bez tabů.

## Mimo rozsah (YAGNI)

- Žádné nové typy notifikací ani cílení na role.
- Žádné „označit vše přečtené", filtrování, stránkování — jen sjednocení.
- Žádná migrace na shadcn Tabs (lehký vlastní přepínač stačí).
- Žádný zásah do SSE architektury (jedno spojení zůstává).
