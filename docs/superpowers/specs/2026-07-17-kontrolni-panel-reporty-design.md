# Kontrolní panel (debug/health dashboard v Reportech) — Design

**Datum:** 2026-07-17
**Autor:** Vojta + Claude
**Stav:** návrh ke schválení

## Cíl

Přidat nahoru do stránky **Reporty** (`/reporty`, už dnes ADMIN-only) pasivní **Kontrolní panel** — jedno místo, kde ADMIN na první pohled vidí, jestli data a plánování sedí tak, jak mají. Panel spočítá sadu kontrol, u každé ukáže zeleno/červeno, a u nálezů dá konkrétní seznam s prokliknutím do plánu (`/?highlight=<blockId>`).

Motivace: overlap guard nově brání *vzniku* překryvů, ale (a) legacy data z doby před pojistkou v DB zůstala a (b) existují další tiché nekonzistence (drift konce bloku po změně kalendáře, osiřelé vazby, přílohy bez souborů), které se dnikde nehlídají. Panel je dohledový nástroj, ne mutační — **jen čte**.

## Rozsah v1 (schváleno)

Pět kontrol ve dvou skupinách:

**Plánovací správnost** (3 karty):
1. **Překryvy bloků** — budoucí překryvy na stejném stroji.
2. **Drift konce bloku** — uložený `endTime` už nesedí na aktuální pracovní kalendář.
3. **Bloky mimo provoz stroje** — ZAKAZKA, jejíž start už neleží na běžícím slotu.

**Integrita dat** (1 sbalená karta):
4. **Integrita dat** — osiřelé vazby a neplatné hodnoty (bundle dílčích SQL kontrol).

**Přílohy** (1 karta):
5. **Přílohy: soubory vs. databáze** — metadata bez souboru na disku a naopak.

### Non-goals (YAGNI — vědomě mimo v1)

- Žádné **aktivní alerty** (badge v hlavičce, periodická/cron kontrola, notifikace). Panel je pasivní — spočítá se při otevření stránky + tlačítko „Překontrolovat teď".
- Žádné **auto-fix akce** — ani „Přepočítat konec" u driftu. Vše read-only; opravu dělá člověk v planneru.
- Žádné **provozní signály** (Pantone po termínu, materiál není skladem) — nejsou to bugy, patří do inboxu plánovače.
- Žádné **migrace ani zápisy** do DB. Panel a jeho endpoint jen čtou.

## Architektura

Čtyři nové/změněné jednotky, každá s jednou odpovědností:

| Jednotka | Soubor | Odpovědnost |
| --- | --- | --- |
| Kontrolní logika | `src/lib/healthChecks.server.ts` (nový) | Funkce jednotlivých kontrol + agregátor `runHealthChecks`. Čisté, testovatelné. |
| Endpoint | `src/app/api/report/health/route.ts` (nový) | `GET`, `requireRole(["ADMIN"])`, zavolá `runHealthChecks`, vrátí JSON. AppError handling. |
| Komponenta | `src/app/reporty/_components/HealthPanel.tsx` (nový, named export) | Klientská komponenta: fetch, summary proužek, 5 karet, rozbalování, jump. |
| Integrace | `src/app/reporty/_components/ReportDashboard.tsx` (změna) | Vloží `<HealthPanel />` nahoru do těla (za info bar), nezávisle na režimu Retro/Výhled. |

Deep-link do plánu = existující `/?highlight=<blockId>` (`src/app/page.tsx:48–53` → `initialFilterText` → `PlannerPage` auto-scroll na první shodu). Nestavíme nový mechanismus.

**Proč vlastní komponenta:** `ReportDashboard.tsx` má ~590 řádků; CLAUDE.md zakazuje psát nové standalone komponenty inline do velkých souborů. `HealthPanel` je samostatný named export, vizuálně navazuje na konvence Reportů (design tokeny, styl `SectionHeader`).

**Proč vlastní endpoint (ne rozšíření `/api/report/dashboard`):** health je globální a nezávislý na režimu/období Reportů (Retro/Výhled + rangeStart/rangeEnd). Samostatný `/api/report/health` bez parametrů je čistší a cachovatelný zvlášť.

## Kontrola po kontrole

Společné: každá kontrola vrací `{ count, items }`; `items` je omezen (např. max 50) na ochranu payloadu, s `count` = skutečný celkový počet.

### 1. Překryvy bloků (budoucí)

- **Porušení:** dva bloky na stejném stroji se časově překrývají a překryv ještě neskončil.
- **Detekce:** SQL self-join (typově agnostický — ZAKAZKA i REZERVACE i UDRZBA):
  ```sql
  SELECT a.id, a.orderNumber, a.type, a.machine, a.startTime, a.endTime,
         b.id, b.orderNumber, b.type, b.startTime, b.endTime
  FROM Block a JOIN Block b
    ON a.machine = b.machine AND a.id < b.id
   AND a.startTime < b.endTime AND b.startTime < a.endTime
  WHERE LEAST(a.endTime, b.endTime) > :now   -- „budoucí" = překryv ještě neskončil
  ORDER BY a.machine, a.startTime;
  ```
- **Rozsah:** budoucí (uživatelský požadavek). „Budoucí" = konec překryvu `LEAST(a.endTime,b.endTime)` je po `now`.
- **Item:** `{ machine, a: {id, orderNumber, type, start, end}, b: {…}, overlapStart, overlapEnd, overlapMinutes }`.

### 2. Drift konce bloku

- **Porušení:** ZAKAZKA má uložený `endTime`, který neodpovídá tomu, co dnes spočítá `expandPrintTime` nad aktuálním kalendářem (někdo změnil směny/odstávky).
- **Detekce:** `detectCalendarDrift(prisma, MACHINES, windowStart=now, windowEnd=now+365d, now)` — **funkce už existuje** (`src/lib/calendarDrift.server.ts:69`). Bere jen bloky, které lze poctivě posoudit: `type=ZAKAZKA`, `scheduleBypassed=false`, `printMinutes>0`, `printCompletedAt=null`, zarovnaný start, `endTime>now`.
- Z výsledku `DriftedBlock[]` do této karty jdou nálezy s `reason ∈ { END_MISMATCH, HORIZON_EXCEEDED }`.
- **Item:** `{ id, orderNumber, machine, startTime, storedEnd: endTime, expectedEnd, reason }`. Pro `HORIZON_EXCEEDED` je `expectedEnd=null` (nešlo dopočítat v horizontu) — v UI „nelze spočítat".

### 3. Bloky mimo provoz stroje

- **Porušení:** ZAKAZKA, jejíž start už neleží na běžícím slotu (mimo aktivní směnu / v odstávce) a **není** to vědomý bypass.
- **Detekce:** stejné volání `detectCalendarDrift` jako #2; do této karty jdou nálezy s `reason = START_NOT_RUNNABLE`.
- **Proč jen ZAKAZKA / ne-bypass:** rezervace a údržba se schválně kladou i mimo běžné směny — flagovat je by byl šum. `detectCalendarDrift` filtr (`scheduleBypassed=false`) navíc zajistí, že vědomé bypassy nekřičí.
- **Item:** `{ id, orderNumber, machine, startTime, reason: "START_NOT_RUNNABLE" }` + lidský důvod „mimo směnu / v odstávce".

> Karty #2 a #3 sdílejí **jedno** volání `detectCalendarDrift`; endpoint výsledek jen roztřídí podle `reason`.

### 4. Integrita dat (sbalená karta s rozpadem)

Bundle levných dílčích kontrol; karta ukáže součet a v rozbalení rozpad po řádcích (každý zvlášť zeleně/červeně). Preferovat Prisma relační filtry (`where: { xId: { not: null }, X: null }`) tam, kde relace existuje; jinak raw `NOT IN (SELECT id …)`.

| Dílčí kontrola | Porušení |
| --- | --- |
| Osiřelý `jobPresetId` | odkaz na smazaný JobPreset (JobPreset nemá cascade → reálné) |
| Osiřelý `splitGroupId` | odkaz na neexistující SplitGroup |
| Osiřelý `reservationId` | odkaz na smazanou Reservation |
| Osiřelý `recurrenceParentId` | self-odkaz na smazaný blok |
| Neplatný `machine` | mimo `MACHINES` (`XL_105`,`XL_106`) |
| Neplatný `type` | mimo `ZAKAZKA/REZERVACE/UDRZBA` |
| Vadné `printMinutes` (ZAKAZKA) | přítomné, ale `<=0` / `%30!=0` / `>2400`. **NULL se nehlásí** (legacy pre-tiskové-hodiny) |
| `endTime <= startTime` | nelogický interval (korupce) |
| Nezarovnaný start (ZAKAZKA) | `MINUTE(startTime) ∉ {0,30}` nebo `SECOND != 0` |
| Split-skupina < 2 bloky | `SplitGroup` s méně než 2 členy (rozpadlá skupina) |
| Nekonzistentní `printCompleted` | `printCompletedAt` XOR `printCompletedByUserId` |

- **Item:** rozpad `breakdown: [{ key, label, count, sampleBlockIds }]`; `count` karty = součet.

### 5. Přílohy: soubory vs. databáze

- **Porušení:** (a) `ReservationAttachment` řádek v DB, ale soubor `data/reservation-attachments/<reservationId>/<storageKey>` na disku chybí; (b) soubor na disku bez odpovídajícího řádku.
- **Detekce:** načíst všechny `ReservationAttachment` (reservationId, storageKey) + projít složku `data/reservation-attachments/` na disku; množinový rozdíl obou směrů.
- **Item:** `{ missingFiles: [{ attachmentId, reservationId, originalName, storageKey }], orphanFiles: [{ reservationId, storageKey }] }`; `count` = `missingFiles.length + orphanFiles.length`.
- **Pozn.:** jediná kontrola, která sahá na FS (ne DB). Levné, pokud příloh nejsou tisíce.

## API kontrakt

`GET /api/report/health` → `200`:

```jsonc
{
  "checkedAt": "2026-07-17T06:41:00.000Z",
  "checks": {
    "overlaps":     { "count": 1, "items": [ /* páry */ ] },
    "drift":        { "count": 2, "items": [ /* END_MISMATCH/HORIZON */ ] },
    "outsideHours": { "count": 1, "items": [ /* START_NOT_RUNNABLE */ ] },
    "integrity":    { "count": 1, "breakdown": [ { "key":"orphanJobPreset","label":"Osiřelý jobPreset","count":1,"sampleBlockIds":[16980] }, /* … */ ] },
    "attachments":  { "count": 0, "missingFiles": [], "orphanFiles": [] }
  }
}
```

- **Auth:** `requireRole(["ADMIN"])` **uvnitř `try`** (hází `UNAUTHORIZED`/`FORBIDDEN` → catch). Nezávisle na page-gatingu (endpoint je přímo volatelný).
- **Chyby:** dle CLAUDE.md — `isAppError` → `errorStatus`; jinak `logger.error` + 500. Logování přes `logger`, ne `console`.
- **Bez parametrů.** `now`/`MACHINES` na serveru; `MACHINES` z `src/lib/machines.ts`.

## Komponenta `HealthPanel`

Chování:
- **Fetch** `/api/report/health` při mountu; `loading` / `error` stavy (styl jako `ReportDashboard`).
- **Summary proužek** nahoře: agregovaný stav (součet všech `count`), zeleně „Vše v pořádku" / červeně „N problémů ve K z 5 kontrol", čas `checkedAt`, tlačítko **↻ Překontrolovat teď** (re-fetch).
- **5 karet** pod ním, v pořadí 1–5. Každá: ikona + titulek + podtitulek + pill (zelený `✓ 0` / červený počet) + chevron.
  - **Červená karta:** default **rozbalená**, ukáže detail (tabulka / rozpad) + odkazy „Otevřít v plánu" = `/?highlight=<blockId>`.
  - **Zelená karta:** default **sbalená** (jen hlavička s `✓ 0`).
  - Klik na hlavičku přepíná rozbalení.
- **Vizuál:** design tokeny z `globals.css` (`--surface`, `--border`, `--brand`, `--success`, `--danger`, `--warning`), typové chipy `zak/rez/udr` přes existující barvy typů. Červená karta má levý `3px` `--danger` proužek. Tabulky v `overflow-x:auto` kontejneru. Vzhled dle schváleného mockupu (artifact „dashboard-5-karet").

## Rozhodnutí / defaulty (schváleno)

| Rozhodnutí | Volba |
| --- | --- |
| Pasivní vs. aktivní | **Pasivní** (fetch on mount + „Překontrolovat teď") |
| Read-only vs. fix | **Read-only** + skok do plánu (i drift bez „přepočítat") |
| Kdo vidí | **Jen ADMIN** (dědí z page-gatingu; endpoint gate zvlášť) |
| Umístění | **Nahoře** v těle Reportů, nad Retro/Výhled |
| Default rozbalení | **Červené rozbalené / zelené sbalené** |
| Rozsah – plánovací karty | nedokončené, budoucí (`endTime>now`), aktivní stroje |
| Rozsah – integrita | **všechna data** (osiřelé vazby jsou nadčasové) |

## Výkon

- Levné (čisté SQL, ms): překryvy, integrita (hrst dotazů), přílohy (FS sken jedné složky).
- **Nejdražší: drift/mimo provoz** — `detectCalendarDrift` iteruje 30min sloty per blok. Omezeno na `type=ZAKAZKA`, ne-bypass, nedokončené, `endTime>now`, do `now+365d`. Reálný počet budoucích bloků je v řádu desítek–stovek → jednorázově akceptovatelné (panel se počítá on-demand, ne na každý request planneru).

## Testy

- `src/lib/healthChecks.server.test.ts` (nový) — `node:test` + `tsx`: overlap self-join (překrývající/nepřekrývající/minulý pár), integrita (osiřelé refs, neplatné hodnoty, nezarovnaný start, malá split-skupina), přílohy (missing/orphan). Mock Prisma + FS podle vzoru ostatních `.server.test.ts`.
- `detectCalendarDrift` má vlastní testy (`calendarDrift.server.test.ts`) — neduplikovat.

## Známá omezení

- **Jump na REZERVACE/UDRZBA bez `orderNumber`:** `/?highlight=<id>` filtruje planner podle `orderNumber` nalezeného bloku; blok s prázdným `orderNumber` (některé rezervace v překryvové kartě) navigaci otevře, ale nemusí přesně napozicovat. Přijatelné pro v1; ZAKAZKA (drift/mimo provoz/integrita) mají `orderNumber` vždy.
- Panel ukazuje stav k času kontroly; není živý (nutno „Překontrolovat teď" po zásahu).
