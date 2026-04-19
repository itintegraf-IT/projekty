# Pracovní doba — flexibilní handles nad flag-only modelem

**Datum:** 2026-04-19
**Autor:** Vojta (spec), Claude (brainstorm)
**Větev:** `Vojta`
**Status:** Design ready for implementation plan

---

## Kontext a motivace

Ve Sprintu A pracovní doby (commit `7eadc3f5`) a následných sprintech se pracovní doba přepracovala na **flag-only model**: každá kombinace stroj × den × týden má tři flagy (`morningOn`, `afternoonOn`, `nightOn`) a hodiny jsou fixní (`MORNING 6–14`, `AFTERNOON 14–22`, `NIGHT 22–6`).

Commit `f9d1a957 Final po Pracovni době` zároveň odstranil z [TimelineGrid.tsx](../../../src/app/_components/TimelineGrid.tsx) **drag handles**, kterými se dříve upravovaly hrany šrafovaných oblastí (přes `MachineScheduleException`). Nový model handle nepotřebuje — směny jsou buď ON, nebo OFF.

**Problém:** Chybí drobná flexibilita pro ad-hoc výjimky („zítra začínáme v 7 místo 6", „dnes odpolední jede jen do 20", „ranní končí v 13, afternoon od 13"). Tyto úpravy jsou vzácné (cca 1–2× týden), ale reálně potřebné.

**Cíl:** Zachovat flag-only model jako zdroj pravdy, přidat tenkou vrstvu **per-shift hour overrides** a vrátit interaktivní handles do planneru pro rychlou editaci.

---

## Rozhodnuté přístupy

### Datový model: rozšíření MachineWeekShifts

Přidání 6 nullable sloupců k existující tabulce `MachineWeekShifts`:

```prisma
model MachineWeekShifts {
  // ... existující pole (machine, weekStart, dayOfWeek, *On flagy) ...
  morningStartMin   Int?  // null = default 360 (6:00)
  morningEndMin     Int?  // null = default 840 (14:00)
  afternoonStartMin Int?  // null = default 840 (14:00)
  afternoonEndMin   Int?  // null = default 1320 (22:00)
  nightStartMin     Int?  // null = default 1320 (22:00)
  nightEndMin       Int?  // null = default 360 (6:00 following day)
}
```

**Konvence:**
- Minuty od půlnoci, snap na 30 min (matches `DAY_SLOT_COUNT = 48`).
- `null` = použít `SHIFT_HOURS` default z [src/lib/shifts.ts](../../../src/lib/shifts.ts).
- Noční směna překračuje půlnoc → u `NIGHT` je `endMin < startMin` platné a znamená „končí následující kalendářní den".

**Povolené rozsahy (server-side validace):**

| Směna | startMin rozsah | endMin rozsah |
|---|---|---|
| MORNING | 4:00–8:00 (240–480) | 12:00–16:00 (720–960) |
| AFTERNOON | 12:00–16:00 (720–960) | 20:00–24:00 (1200–1440) |
| NIGHT | 20:00–24:00 (1200–1440) | 4:00–8:00 (240–480) |

Pásma překrývají sousední směny o 2 hodiny → povoluje:
- Morning 6–13, afternoon 13–21 (posun společné hranice)
- Morning 6–14, afternoon 14:30–22 (mezera 30 min mezi směnami)
- Morning 6–13:30, afternoon 14–22 (jiná mezera)

**Migrace:** `20260419_add_shift_hour_overrides`. Všechny existující řádky dostanou `NULL` ve všech 6 nových sloupcích → žádný backfill, nulový dopad na existující chování.

### API: rozšíření `/api/machine-week-shifts`

Žádný nový endpoint. Současná routa `src/app/api/machine-week-shifts/route.ts`:

- **`GET`** vrací rows včetně 6 override polí (typ `MachineWeekShiftsRow` rozšířit v [src/lib/machineWeekShifts.ts](../../../src/lib/machineWeekShifts.ts)).
- **`PUT`/`POST`** akceptují override pole v payloadu.

**Server-side validační logika:**

1. Rozsahy z tabulky výše → porušení: `AppError("VALIDATION", "Ranní start musí být 4:00–8:00")` → 400.
2. Snap na 30 min (`% 30 !== 0` → zamítnout).
3. Sanity check per shift:
   - MORNING/AFTERNOON: `startMin < endMin`
   - NIGHT: `startMin > endMin` povolené (přes půlnoc)
4. Cascade check (viz níže).

### Core helper: `resolveShiftBounds`

Jediný zdroj pravdy pro hranice směny, v [src/lib/shifts.ts](../../../src/lib/shifts.ts):

```ts
export function resolveShiftBounds(
  row: MachineWeekShiftsRow,
  shift: ShiftType
): { startMin: number; endMin: number } | null {
  // null = směna je off pro tento den
  // jinak: override pole || default × 60
}
```

### Core logic: interval-based rozvrh

[src/lib/scheduleValidation.ts](../../../src/lib/scheduleValidation.ts):
- Současná `resolveScheduleRows(machine, day, weekShifts)` vrací `{dayOfWeek, startHour, endHour, isActive}`. Rozšířit výstup na **multi-interval**:
  ```ts
  { dayOfWeek, intervals: Array<{ startMin: number; endMin: number; shift: ShiftType }> }
  ```
  Pole intervalů nutné, protože overrides mohou způsobit mezery mezi směnami.
- Ponechat legacy union (`startHour`, `endHour`) pro zpětnou kompatibilitu míst, která ji dnes konzumují (reporty, UI). Postupně migrovat.

[src/lib/scheduleValidationServer.ts](../../../src/lib/scheduleValidationServer.ts):
- `validateBlockScheduleFromDb` přepsat nad interval-based rows. Blok musí celý ležet uvnitř jednoho intervalu. Mezera mezi směnami = blok tam nesmí být = `SCHEDULE_VIOLATION`.

[src/lib/workingTime.ts](../../../src/lib/workingTime.ts):
- `snapToNextValidStartWithTemplates` a `snapGroupDeltaWithTemplates` přepsat nad interval-based rows. Logika „skoč přes víkend/noc" se přirozeně rozšíří na „skoč přes mezeru mezi směnami".

[src/app/_components/TimelineGrid.tsx](../../../src/app/_components/TimelineGrid.tsx):
- Render red hatched overlay: dnes počítá `startHour/endHour` per stroj per den → přepracovat na interval-based (více red pásů, pokud jsou mezery).

[src/lib/reportMetrics.ts](../../../src/lib/reportMetrics.ts):
- Sumy pracovních hodin nahradit `Σ (endMin - startMin)` přes aktivní intervaly.

### UI: Admin editor ([MachineWorkHoursWeek.tsx](../../../src/components/admin/MachineWorkHoursWeek.tsx))

Rozšíření existujícího gridu (7 dní × 2 stroje × 3 checkboxy) o **inline hodinový rozsah** pod každým zaškrtnutým checkboxem:

```
☑ Ranní   6:00–14:00        ← default (šedé, menší font)
☑ Ranní   6:00–13:30  ↺     ← override (amber zvýraznění, ↺ reset)
☐ Ranní                      ← nic
```

**Interakce:**
- Klik na hodinový label → popover s dvěma time inputy (snap 30 min) + „Uložit" / „Zrušit".
- `↺` ikonka vedle override → smaže override (vrátí na default, pošle `null`).
- Client-side validace rozsahů z tabulky v sekci Datový model (server validuje znovu).

**Vizuální konvence:**
- Default časy: `text-slate-400 text-xs`.
- Override časy: `text-amber-400 text-xs font-medium` (signalizuje odchylku od standardu).
- Mezera mezi směnami v UI viditelná jako dashed separator.

### UI: Planner handles ([TimelineGrid.tsx](../../../src/app/_components/TimelineGrid.tsx))

Obnovení drag logiky z pre-Sprint-A éry, mapované na nový model.

**Pozice handles:**
- Na každé **hraně aktivní směny** (uvnitř nezašrafované oblasti dne) vodorovný pruh 28×8 px, `cursor: ns-resize`.
- Start handle: 2 px pod startem směny. End handle: 2 px nad koncem.

**Staggered handles na společné hranici dvou aktivních směn** (např. morning+afternoon oba ON, default 14:00):
- Renderovat **dva handles** s horizontálním offsetem:
  - Morning-end: centered, `left: 20%`.
  - Afternoon-start: centered, `right: 20%`.
- Barevně odlišit (použít `badgeColorVar` per shift pro identity).
- Každý handle tažen nezávisle → vzniká mezera (scénář C).
- Držení `Shift` při drag → oba handles se pohnou spolu (pro sladění hranice bez mezery).

**Drag flow:**
1. `mousedown` → `dragStateRef = { type: "shift-edge-resize", machine, date, shift, edge: "start"|"end", origMin, startClientY, startScrollTop }`.
2. `mousemove` → live preview: šrafované oblasti se přelévají v reálném čase (reuse `dragPreview` patternu).
3. `mouseup` → `onShiftBoundsChange(machine, date, shift, edge, newMin)` → `PUT /api/machine-week-shifts` s novým override polem.
4. Validace: snap 30 min, clamp na povolené rozsahy. Pokud by hranice protnula existující blok → 409 → cascade dialog.

**Reset přes handle:**
- Pravý klik na handle → context menu „Reset na default".
- Smaže override (posílá `null`).

**Noční směna:** handles pro night edges se **v MVP nerenderují v planneru**. Úprava `nightStartMin` / `nightEndMin` jen přes admin inline editor. Důvod: cross-day rendering (night-end v následujícím dni) přidává neúměrnou komplexitu pro edge case. Ponechat jako budoucí rozšíření.

**Role-based visibility:**
- Viditelné jen pro `ADMIN`, `PLANOVAT`.
- Skryté pro `VIEWER`, `TISKAR`, `OBCHODNIK`, `DTP`, `MTZ`.
- Respektuje existující `workingTimeLock` toggle v toolbaru.

### Cascade handling

Pokud zkrácení směny (přes admin editor nebo handle v planneru) protne naplánovaný blok:

- Server v `PUT /api/machine-week-shifts` detekuje konflikty dotazem:
  ```
  Block WHERE machine = ? AND startTime < newEndMin AND endTime > newStartMin
  ```
  (nebo analogicky pro zvětšování/zmenšování edge).
- Response `409` + `{ error: "SHIFT_SHRINK_CASCADE", conflictingBlocks: [{id, jobName, startTime, endTime}] }`.
- Klient → dialog „Tyto bloky spadnou mimo pracovní dobu — smazat / zrušit změnu".
- Reuse cascade dialog komponenty z existující funkčnosti (DisableShiftCascadeDialog z historie — buď reanimovat z commitu `e5cb2d4a`, nebo implementovat analogicky).

### Audit

Každá změna override pole zapsána do `AuditLog` v rámci `$transaction`:

```ts
{
  action: "SHIFT_BOUNDS_UPDATE",
  entity: "MachineWeekShifts",
  entityId: row.id,
  field: "morningEndMin",
  oldValue: "14:00",
  newValue: "13:30",
  userId, username, timestamp,
}
```

---

## Edge cases

| Situace | Chování |
|---|---|
| Override nastaven, ale flag je `off` | `resolveShiftBounds` vrátí `null` (override ignorován). Data v DB ponechána — uživatel může flag vrátit a override se obnoví. |
| Copy-week / copy-day v adminu | Musí kopírovat i 6 override polí, ne jen flagy. |
| Noční směna přes půlnoc | Override `nightEndMin = 360` znamená „končí 6:00 následující den". `resolveShiftBounds` vrací dvojici, konzumenti (validátor, UI) musí pracovat s cross-day intervaly — už existuje v současném kódu pro default noční. |
| Rozpis (ShiftAssignment) | Rozpis přiřazuje tiskaře ke směnám, nezajímají ho hodiny. Bez úprav. |
| Prázdný flag `morningOn = false` při zapisování overrides | Klient nepovolí editaci hodin pro off směnu. Server akceptuje (uložit pro budoucnost), ale nedojde k validaci proti hranicím. |

---

## Testy

**Nové:**
- `src/lib/shifts.test.ts` — unit testy `resolveShiftBounds`: default (all null), override start-only / end-only / both, shift off → null, night cross-midnight.

**Rozšířit:**
- `src/lib/scheduleValidation.test.ts` — multi-interval scénáře:
  - Morning 6–13, afternoon 14–22 → blok 13:15–13:45 = `VIOLATION` (v mezeře).
  - Morning 6–13, afternoon 13–22 → blok 12:45–13:30 = `OK` (hranice sladěna).
  - Morning 6–14, afternoon 14–21 → blok 21:00–21:30 = `VIOLATION` (za koncem).
- `src/lib/scheduleValidationServer.test.ts` — mock Prisma vrací row s overrides, validace projde / zamítne dle edge.

**Manuální smoke:**
- Drag morning end z 14:00 na 13:30 v planneru → reload stránky → ověřit persistenci.
- Drag přes existující blok → cascade dialog se zobrazí, ne silent corruption.
- Admin editor: klik na hodinový label → popover → uložit → planner ukáže update.
- Noční směna: úprava přes admin editor → planner vyrendruje šrafování správně přes půlnoc.

---

## Out of scope (odloženo)

- Handles pro noční směnu v planneru (cross-day rendering).
- Bulk operace „nastav hranice pro celý týden naráz".
- Konfigurovatelné default hodiny per stroj (dnes fixní `SHIFT_HOURS`).
- Historie / versioning overrides (audit log stačí).

---

## Klíčové soubory k úpravě

| Soubor | Typ změny |
|---|---|
| `prisma/schema.prisma` | Přidat 6 sloupců do `MachineWeekShifts` |
| `prisma/migrations/20260419_add_shift_hour_overrides/migration.sql` | Nová migrace |
| `src/lib/shifts.ts` | Helper `resolveShiftBounds` |
| `src/lib/machineWeekShifts.ts` | Rozšíření typu `MachineWeekShiftsRow` |
| `src/lib/scheduleValidation.ts` | Interval-based `resolveScheduleRows` |
| `src/lib/scheduleValidationServer.ts` | Interval-based validace |
| `src/lib/workingTime.ts` | Snap helpers nad intervaly |
| `src/lib/reportMetrics.ts` | Hodinové sumy přes intervaly |
| `src/app/api/machine-week-shifts/route.ts` | Override pole v GET/PUT/POST + cascade |
| `src/components/admin/MachineWorkHoursWeek.tsx` | Inline hodinový editor |
| `src/app/_components/TimelineGrid.tsx` | Shift-edge handles + drag logika |
| `src/lib/shifts.test.ts` | Nový test soubor |
| `src/lib/scheduleValidation.test.ts` | Rozšíření o multi-interval |
| `src/lib/scheduleValidationServer.test.ts` | Mock s overrides |

---

## Odhad implementace

**4–6 sprintů**, detail v navazujícím implementačním plánu:
1. Datový model + migrace + typy.
2. `resolveShiftBounds` + interval-based `resolveScheduleRows` + testy.
3. Validátor server + workingTime snapy + testy.
4. Admin inline editor + cascade dialog.
5. Planner handles (MORNING + AFTERNOON).
6. Cascade polish + audit log + manuální smoke.
