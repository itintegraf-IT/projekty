# Reporting Dashboard — CEO pohled

**Datum:** 2026-04-18
**Status:** Schválený design

## Účel

Manažerský reporting dashboard pro CEO a plánovače. Poskytuje přehled o vytížení strojů, efektivitě plánování, pipeline rezervací a aktivitě plánovačů. Dva režimy: retrospektiva (jak jsme si vedli) a výhled (co nás čeká).

## Navigace a přístup

- Vlastní stránka na route `/reporty`
- Tlačítko v hlavním headeru vedle Správa / Rezervace / Expedice
- Přístup: pouze role `ADMIN` a `PLANOVAT`
- Middleware musí ošetřit přesměrování nepřihlášených a neautorizovaných uživatelů

## Layout

Jedna scrollovatelná stránka (varianta "KPI karty + grafy pod sebou"):

1. **Horní lišta** — přepínače:
   - Časový rozsah: Dnes / Tento týden / Tento měsíc / Custom (date range picker)
   - Režim: Retrospektiva / Výhled
2. **KPI karty** — 4 karty v řadě (mění se podle režimu)
3. **Sekce VÝROBA** — grafy a metriky strojů
4. **Sekce PLÁNOVÁNÍ** — stabilita plánu, aktivita plánovačů
5. **Sekce OBCHOD** — pipeline rezervací

## Režim: Retrospektiva — „Jak jsme si vedli"

Zobrazuje historická data za zvolené období.

### KPI karty (horní řada)

| Karta | Zdroj dat | Výpočet |
|-------|-----------|---------|
| Vytížení XL 105 | `Block` (machine=XL_105, type=ZAKAZKA) | Součet trvání zakázkových bloků / dostupné pracovní hodiny × 100. Dostupné hodiny z `MachineWorkHoursTemplate` + `MachineScheduleException`. Trend: porovnání s předchozím stejně dlouhým obdobím. |
| Vytížení XL 106 | `Block` (machine=XL_106, type=ZAKAZKA) | Stejný výpočet jako XL 105. |
| Průtok zakázek | `Block` (type=ZAKAZKA, printCompletedAt v období) | Počet bloků s `printCompletedAt` v daném období (= dokončené zakázky). |
| Ø Lead time | `Block` (type=ZAKAZKA, printCompletedAt v období) | Průměr rozdílu `printCompletedAt - createdAt` v dnech. Jen bloky, které mají obě hodnoty. |

### Sekce VÝROBA

**Graf: Vytížení strojů (denně)**
- Sloupcový graf, osa X = dny v období, osa Y = % vytížení
- Dvě barvy: XL 105 (modrá) a XL 106 (oranžová)
- Zdroj: stejný výpočet jako KPI karta, ale po jednotlivých dnech

**Metriky pod grafem (3 karty):**

| Metrika | Výpočet |
|---------|---------|
| Průtok (zakázek) | Počet bloků s `printCompletedAt` v období |
| Ø Lead time | Průměr `printCompletedAt - createdAt` |
| Údržba (% z celku) | Součet trvání bloků type=UDRZBA / celkové dostupné hodiny × 100 |

### Sekce PLÁNOVÁNÍ

**Metriky (2 karty):**

| Metrika | Výpočet |
|---------|---------|
| Přeplánování | Počet `AuditLog` záznamů s action=UPDATE a field=startTime nebo field=machine v období. Každý takový záznam = 1 přesun bloku. |
| Stabilita plánu | (Celkem bloků v období − bloky s ≥1 přesunem) / celkem bloků × 100. Blok "se přesunul" = existuje AuditLog s jeho blockId, action=UPDATE, field IN (startTime, endTime, machine). |

**Aktivita plánovačů:**
- Seznam uživatelů s rolí ADMIN nebo PLANOVAT
- Pro každého: počet `AuditLog` záznamů v období (kde `username` = daný uživatel)
- Vizuálně: progress bar + číslo
- Typy akcí k počítání: CREATE, UPDATE, DELETE, SPLIT, BATCH_MOVE (všechny akce v audit logu)

### Sekce OBCHOD

**Pipeline rezervací:**
- Horizontální stacked bar podle stavu rezervací
- Zdroj: `Reservation` — count group by `status` pro období (`createdAt` v období nebo aktivní v období)
- Stavy: SUBMITTED (nové), ACCEPTED (přijaté), QUEUE_READY (ve frontě), SCHEDULED (naplánované), REJECTED (zamítnuté)
- Konverzní poměr: počet SCHEDULED / (SCHEDULED + REJECTED) × 100

## Režim: Výhled — „Co nás čeká"

Zobrazuje naplánovaná data od dnešního dne dopředu.

### KPI karty (horní řada)

| Karta | Zdroj dat | Výpočet |
|-------|-----------|---------|
| Naplánovaná kapacita XL 105 | `Block` (machine=XL_105, startTime > now) | Součet trvání naplánovaných bloků / dostupné hodiny v období × 100 |
| Naplánovaná kapacita XL 106 | `Block` (machine=XL_106, startTime > now) | Stejný výpočet |
| Volné hodiny XL 105 | Templates + Blocks | Dostupné hodiny − naplánované hodiny |
| Volné hodiny XL 106 | Templates + Blocks | Stejný výpočet |

### Sekce KAPACITA

**Heatmapa obsazenosti:**
- Grid: řádky = stroje (XL 105, XL 106), sloupce = dny v období
- Buňky barevně: zelená (80%+), oranžová (50–79%), červená (pod 50%), šedá (mimo provoz / víkend)
- Při hoveru tooltip s přesným %

### Sekce VOLNÁ KAPACITA

- 2 karty: volné hodiny XL 105 a XL 106 v období
- Výpočet: dostupné pracovní hodiny (z templates/exceptions) − součet trvání naplánovaných bloků

### Sekce RIZIKA

**Plánované údržby:**
- Seznam bloků type=UDRZBA kde startTime > now, seřazené chronologicky
- Zobrazit: stroj, popis, datum, trvání

**Čekající rezervace:**
- Počet rezervací ve stavu SUBMITTED (nové — čekají na reakci plánovače)
- Počet rezervací ve stavu QUEUE_READY (ve frontě — čekají na slot)
- U nových: jak dlouho čeká nejstarší (now − min(createdAt))

## Časové rozsahy

| Rozsah | Retrospektiva | Výhled |
|--------|---------------|--------|
| Dnes | Dnešní den 00:00–teď | Dnes teď–23:59 |
| Tento týden | Pondělí 00:00–teď | Teď–neděle 23:59 |
| Tento měsíc | 1. den měsíce 00:00–teď | Teď–poslední den měsíce 23:59 |
| Custom | Vybraný rozsah od–do | Vybraný rozsah od–do |

Všechny časy v Prague timezone. Použít existující `pragueToUTC` a `utcToPragueDateStr` z `src/lib/dateUtils.ts`.

## Technická architektura

### API endpoint

`GET /api/report/dashboard`

Query parametry:
- `mode`: `retro` | `outlook`
- `rangeStart`: ISO date string (YYYY-MM-DD)
- `rangeEnd`: ISO date string (YYYY-MM-DD)

Response: JSON objekt se všemi metrikami najednou (jeden fetch na celý dashboard).

```typescript
// Retrospektiva response
{
  machines: {
    XL_105: { utilization: number, prevUtilization: number, productionHours: number, maintenanceHours: number, availableHours: number },
    XL_106: { ... }
  },
  dailyUtilization: Array<{ date: string, XL_105: number, XL_106: number }>,
  throughput: { count: number, prevCount: number },
  avgLeadTimeDays: number,
  maintenanceRatio: number,
  planning: {
    rescheduleCount: number,
    stabilityPercent: number
  },
  plannerActivity: Array<{ username: string, actionCount: number }>,
  pipeline: {
    SUBMITTED: number,
    ACCEPTED: number,
    QUEUE_READY: number,
    SCHEDULED: number,
    REJECTED: number,
    conversionPercent: number
  }
}

// Výhled response
{
  machines: {
    XL_105: { plannedCapacity: number, freeHours: number, availableHours: number },
    XL_106: { ... }
  },
  dailyCapacity: Array<{ date: string, XL_105: number, XL_106: number }>,
  upcomingMaintenance: Array<{ machine: string, description: string, startTime: string, endTime: string }>,
  pendingReservations: {
    newCount: number,
    queueCount: number,
    oldestWaitingDays: number
  }
}
```

### Frontend

- Route: `src/app/reporty/page.tsx` (server component — auth check + redirect)
- Hlavní komponenta: `src/app/reporty/_components/ReportDashboard.tsx` (client component)
- Jeden `fetch` na `/api/report/dashboard` při mount a při změně režimu/rozsahu
- Grafy: HTML/CSS (inline sloupcové grafy jako v mockupu, bez externí knihovny)
- Dark mode: použít existující CSS proměnné (`var(--bg)`, `var(--surface)`, atd.)

### Navigační tlačítko

Přidat tlačítko "Reporty" do headeru v `src/app/_components/PlannerPage.tsx` vedle existujících tlačítek Správa/Rezervace/Expedice. Zobrazit jen pro role ADMIN a PLANOVAT.

## Výpočet dostupných pracovních hodin

Klíčový výpočet pro vytížení. Postup:

1. Pro každý den v období najít platnou šablonu (`MachineWorkHoursTemplate`) podle `validFrom/validTo`
2. Z šablony vzít `MachineWorkHoursTemplateDay` pro daný den v týdnu (`dayOfWeek`)
3. Zkontrolovat `MachineScheduleException` — pokud existuje, přepíše šablonu
4. Zkontrolovat `CompanyDay` — pokud den spadá do firemní odstávky, hodiny = 0
5. Výsledek: součet hodin za všechny dny v období

Využít existující logiku z `src/lib/workingTime.ts` a `src/lib/scheduleValidation.ts` kde je to možné.

## Mimo scope

- Export do PDF/Excel (může přijít později)
- Realtime aktualizace (stránka se načte jednorázově, refresh manuálně)
- Grafy s externí knihovnou (recharts, chart.js) — použijeme CSS grafy
- Drilldown do jednotlivých zakázek (dashboard je přehledový)
- Notifikace na základě reportovaných metrik
