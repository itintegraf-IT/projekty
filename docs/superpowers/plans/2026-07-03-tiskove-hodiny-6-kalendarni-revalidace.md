# Tiskové hodiny — Etapa 6: Kalendářní revalidace — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Po změně kalendáře (směny/odstávky) systém detekuje bloky, jejichž konec už nesedí na kalendář, označí je štítkem, notifikuje PLANOVAT/ADMIN a nabídne explicitní „Přepočítat" (per blok / per stroj) — žádný automatický přesun.

**Architecture:** Drift se NEUKLÁDÁ do DB — klient ho počítá živě z kompletních dat (weekShifts + companyDays má vždy celé), server ho počítá jednorázově při mutaci kalendáře (pro notifikaci) a při reflow. Jediný zdroj pravdy výpočtu zůstává `expandPrintTime`. Reflow = re-expanze + chain push v transakci, auditovaná jako `AUTO_REFLOW` (dashboard filtruje `action: "UPDATE"`, metrika stability tedy zůstane čistá by-construction).

**Tech Stack:** Next.js App Router API routes, Prisma 5 + MySQL, node:test + tsx.

## Global Constraints

- Server NIKDY neuloží ZAKAZKA blok s end ≠ `expandPrintTime(...)`.end (invariant featury; bypass bloky end = start + printMinutes).
- Změna kalendáře NIKDY automaticky nepřesouvá bloky — přesun jen na explicitní akci „Přepočítat" (spec 3.9: „žádný automatický přesun").
- Chybové stavy v API: `AppError` z `@/lib/errors`; logování `logger` z `@/lib/logger` (nikdy console).
- Každá mutace viditelných dat zapisuje `AuditLog` ve STEJNÉ `$transaction`.
- Audit akce přepočtu je `AUTO_REFLOW` s `field: "startTime/endTime"` a old/new ve tvaru `"<startISO>–<endISO>"` (en-dash; `fmtAuditVal` tento tvar už formátuje).
- Notifikace pro role: 2 záznamy `Notification` (`targetRole: "PLANOVAT"` a `"ADMIN"`), `type: "CALENDAR_DRIFT"`.
- Drift detekce posuzuje JEN: `type === "ZAKAZKA"`, `scheduleBypassed === false`, `printMinutes > 0`, start zarovnaný na 30min slot, `printCompletedAt === null`, `endTime > now` (vytištěné a minulé bloky nikdy).
- Reflow nesmí přesunout zamčený (`locked`) ani vytištěný (`printCompletedAt != null`) blok; kolize chain pushe se zamčeným = odmítnutí celé transakce s hláškou (žádné tiché přeskládání).
- Reflownutý blok sám nepodléhá `MIN_PRINT_SEGMENT_MINUTES` (je to explicitní akce plánovače = „ruční"); chain push odsouvaných následníků si svá stávající pravidla drží.
- Mouse-down handlery kontrolují `e.button !== 0`.
- Žádné commity — commituje výhradně Vojta. Verifikace každého tasku zahrnuje `npx tsc --noEmit`.
- Baseline test suite: 132/132 (13 souborů dle CLAUDE.md) — po každém tasku musí být zelená včetně nových testů. `scheduleSlotFinder.server.test.ts` vyžaduje `--experimental-test-module-mocks`.
- Fixní směny: MORNING 6–14, AFTERNOON 14–22, NIGHT 22–06 (Praha); NIGHT dne X pokrývá X 22:00 → X+1 06:00 (forward semantic). Změna týdne W proto ovlivňuje interval `[W, W+7d+6h)` — všechna „dotčená okna" v této etapě používají +6 h přesah.

---

### Task 1: `loadMachineCalendarRange` + serverová detekce driftu (`detectCalendarDrift`)

**Files:**
- Modify: `src/lib/printTime.server.ts` (zobecnění fetch okna)
- Create: `src/lib/calendarDrift.server.ts`
- Test: rozšířit `src/lib/printTime.server.test.ts` (+1 test), Create: `src/lib/calendarDrift.server.test.ts`

**Interfaces:**
- Consumes: `expandPrintTime`, `SLOT_MS` (`@/lib/printTime`), `serializeWeekShifts`, `weekStartStrFromDateStr`, `pragueOf` — vše existující.
- Produces:
  - `loadMachineCalendarRange(db, machine, from: Date, to: Date): Promise<MachineCalendar>` v `printTime.server.ts` — fetch weekShifts pro všechny týdny `[from−1d, to]` (krok 1 den + DST pojistka na `to`, PŘESNĚ stejný vzor jako dnešní smyčka v `loadMachineCalendar`) a companyDays overlap `[from, to)`. Stávající `loadMachineCalendar(db, machine, start)` se přepíše na jednořádkovou delegaci: `return loadMachineCalendarRange(db, machine, start, new Date(start.getTime() + MAX_SPAN_DAYS * DAY_MS))`. Chování `loadMachineCalendar` se NESMÍ změnit (pin testy existují).
  - `detectCalendarDrift(db, machines: string[], windowStart: Date, windowEnd: Date, now: Date): Promise<DriftedBlock[]>` v `calendarDrift.server.ts`:
    ```typescript
    export type DriftedBlock = {
      id: number;
      orderNumber: string;
      machine: string;
      startTime: Date;
      endTime: Date;
      expectedEnd: Date | null; // null = expanze selhala
      reason: "END_MISMATCH" | "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED";
    };
    ```
    `db` je strukturální typ (vzor `PrismaClientLike`) s `block.findMany`, `machineWeekShifts.findMany`, `companyDay.findMany` — funguje s `prisma` i `tx`.

**Chování `detectCalendarDrift`:**
1. Fetch bloků: `machine IN machines`, `type: "ZAKAZKA"`, `scheduleBypassed: false`, `printMinutes: { gt: 0 }`, `printCompletedAt: null`, span overlap okna a aktuálnost: `startTime < windowEnd`, `endTime > max(windowStart, now)`.
2. Bloky s nezarovnaným startem (`startTime % SLOT_MS !== 0`) přeskočit (legacy — nelze posoudit).
3. Když žádné bloky → `[]` (bez fetchů kalendáře).
4. Kalendář per stroj JEDNÍM fetch: `loadMachineCalendarRange(db, m, minStartTime(bloky stroje), windowEnd + MAX_SPAN_DAYS dní)` — expanze bloku startujícího těsně před `windowEnd` smí doběhnout až 21 dní za něj.
5. Per blok: `expandPrintTime(machine, startTime, printMinutes, weekShifts, companyDays, false)`:
   - `ok: false` → drifted s `reason` = expanzní reason, `expectedEnd: null`;
   - `ok: true` a `end.getTime() !== endTime.getTime()` → `reason: "END_MISMATCH"`, `expectedEnd: end`;
   - jinak blok sedí → nevrací se.
6. Výsledek seřadit dle `startTime` vzestupně.

**Steps:**

- [ ] **Step 1: Failing testy.** Do `printTime.server.test.ts` přidat pin test `loadMachineCalendarRange`: pro `from = pragueToUTC("2026-08-21", 10)`, `to = pragueToUTC("2026-08-28", 10)` dotaz obsahuje týdny `["2026-08-17", "2026-08-24"]` a companyDay filtr `endDate.gt = from`, `startDate.lt = to` (fake DB vzor `fakeDb` v souboru). Nový `calendarDrift.server.test.ts` (fake DB s filtrujícím `machineWeekShifts.findMany` — vzor z `printTime.server.test.ts` ř. 56–80, fixtury `xl106Week`/`mkDay` z `weekShiftsTestFixtures`):
  1. blok sedící na kalendář → `[]`;
  2. pondělí bez rána v novém rozvrhu, blok Po 6:00–10:00 pm=240 → `START_NOT_RUNNABLE`;
  3. blok s endem spočítaným bez odstávky + companyDay uvnitř → `END_MISMATCH` s `expectedEnd` posunutým o délku odstávky;
  4. vytištěný blok (`printCompletedAt` set) na rozbitém místě → `[]` (where filtr — fake DB nechť filtruje i `printCompletedAt`/`scheduleBypassed`/`type`, ať test pinuje where);
  5. bypass blok → `[]`;
  6. blok s `endTime < now` → `[]`.
- [ ] **Step 2: Ověřit FAIL** — `node --test --import tsx src/lib/calendarDrift.server.test.ts` (module not found / assert fail).
- [ ] **Step 3: Implementace** dle Chování výše. V `printTime.server.ts` zachovat komentář „Kotva o den DŘÍV…" u range smyčky.
- [ ] **Step 4: Zelené testy** — `printTime.server.test.ts` (7), `calendarDrift.server.test.ts` (≥6) + `npx tsc --noEmit`.
- [ ] **Step 5: Report** (bez commitu — snapshot diff řeší kontrolér).

---

### Task 2: Oprava `findConflictingBlocks` — přesahující bloky + week-boundary okno

**Files:**
- Modify: `src/lib/findConflictingBlocks.ts`
- Modify: `src/app/api/machine-week-shifts/route.ts` (TOCTOU re-check v transakci, ř. ~321–349 — stejná oprava)
- Create: `src/lib/findConflictingBlocks.test.ts`

**Interfaces:**
- Produces: `findConflictingBlocks(machine, weekStartStr, newRows)` — signatura beze změny; `detectConflictsPure(machine, weekStartStr, newRows, blocks, neighborRows)` — NOVÝ 5. parametr `neighborRows: MachineWeekShiftsRow[]` (skutečné řádky sousedních týdnů z DB; default `[]` pro zpětnou kompatibilitu volání).

**Dnešní bug (spec 3.9):** filtr `startTime: { gte: weekStart, lt: weekEnd }` — blok začínající v minulém týdnu a přesahující do editovaného uniká; blok Po 0:00–6:00 týdne NÁSLEDUJÍCÍHO (řízený nedělní nocí editovaného týdne) uniká také. A validace běží jen nad synth řádky editovaného týdne — sloty bloku ležící v sousedních týdnech padají na hardcoded fallback místo skutečného rozvrhu.

**Oprava:**
1. Okno dotčených bloků = span overlap s `[weekStart, weekStart + 7d + 6h)`: `where: { machine, startTime: { lt: weekEndPlus6h }, endTime: { gt: weekStartDate } }`.
2. Validační řádky = skutečné DB řádky týdnů `weekStart − 7d` a `weekStart + 7d` (fetch `machineWeekShifts.findMany({ where: { machine, weekStart: { in: [prev, next] } } })` + `serializeWeekShifts`) + synth řádky editovaného týdne. `detectConflictsPure` dostane `neighborRows` parametrem.
3. Stejné okno + stejné řádky v TOCTOU re-checku uvnitř PUT transakce (route ř. ~322–327: rozšířit `where` i `synthRows` o neighbor fetch přes `tx`).

**Steps:**

- [ ] **Step 1: Failing testy** `findConflictingBlocks.test.ts` nad `detectConflictsPure` (bez DB):
  1. blok celý v editovaném týdnu, rozvrh ho vypne → konflikt (regrese-pin stávajícího chování);
  2. blok Pá 20:00 minulého týdne → Po 2:00 editovaného (start MIMO okno starého filtru), editovaný týden pondělí OFF → konflikt (na starém kódu by test spadl — blok by unikl);
  3. blok Po 0:30–5:30 týdne NÁSLEDUJÍCÍHO po editovaném; editovaný týden neděle nightOn=false; `neighborRows` obsahují následující týden s pondělkem bez rána → konflikt (nedělní noc zmizela);
  4. tentýž blok, editovaný týden neděle nightOn=true → BEZ konfliktu (prev-tail drží);
  5. blok přesahující z minulého týdne, jehož sloty v minulém týdnu jsou dle `neighborRows` aktivní → BEZ konfliktu (dřív by hardcoded fallback mohl lhát — pin správných dat).
- [ ] **Step 2: Ověřit FAIL** (`node --test --import tsx src/lib/findConflictingBlocks.test.ts` — testy 2/3 spadnou na starém kódu).
- [ ] **Step 3: Implementace** ve `findConflictingBlocks.ts` + zrcadlová úprava TOCTOU re-checku v route (fetch neighbor řádků přes `tx`, okno `lt: weekEndPlus6h` / `gt: weekStartDate`).
- [ ] **Step 4: Zelené testy** + `npx tsc --noEmit` + celá dosavadní suita.
- [ ] **Step 5: Report.**

---

### Task 3: Napojení detekce na mutace kalendáře (week-shifts PUT, ensureWeekSeeded, company-days) + notifikace

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts`
- Modify: `src/app/api/company-days/route.ts`
- Modify: `src/app/api/company-days/[id]/route.ts`

**Interfaces:**
- Consumes: `detectCalendarDrift` (Task 1). Notifikační vzor: `src/app/api/blocks/route.ts:305–314`.
- Produces: helper `notifyCalendarDrift(tx, drifted: DriftedBlock[], session, contextLabel: string)` (může žít v `calendarDrift.server.ts`) — když `drifted.length > 0`, vytvoří 2 `Notification` záznamy:
  ```typescript
  { type: "CALENDAR_DRIFT", targetRole: "PLANOVAT" /* a "ADMIN" */,
    message: `${contextLabel}: ${drifted.length} ${skloňování 1 blok/2–4 bloky/5+ bloků} nesedí na kalendář (${orderNumbers.slice(0,3).join(", ")}${více ? "…" : ""})`,
    createdByUserId: session.id, createdByUsername: session.username }
  ```

**Napojení (vždy UVNITŘ stávající/nové `$transaction`, PO zápisu kalendáře — tx vidí vlastní zápisy):**
1. **machine-week-shifts PUT** (za upserty, před `auditLog.create` nebo za něj — na pořadí nezáleží, v téže tx): `detectCalendarDrift(tx, [machine], weekStartDate, weekStartDate + 7d + 6h, now)` → `notifyCalendarDrift(tx, drifted, session, \`Změna směn ${machine.replace("_", " ")} (týden ${parsedWeek})\`)`. Response beze změny (pole rows — klienti na tvar spoléhají). Force i ne-force cesta shodně (force typicky = vědomé zmenšení → notifikace je žádoucí).
2. **ensureWeekSeeded** (machine-week-shifts GET): funkce nově přijme `session: SessionUser`; po `createMany` (jen když `seeds.length > 0`): `$transaction` NENÍ (createMany je jediný zápis) → detekce + notifikace rovnou přes `prisma`: `detectCalendarDrift(prisma, missingMachines, weekStartDate, weekStartDate + 7d + 6h, now)` → `notifyCalendarDrift(prisma, …, \`Auto-seed týdne ${weekStartStr}\`)`. (Seed kopíruje předchozí týden → drift vznikne, jen když se rozvrh reálně liší od fallbacku, na kterém bloky dosud stály.)
3. **company-days POST**: obalit do `prisma.$transaction`: create → `detectCalendarDrift(tx, machine ? [machine] : ["XL_105","XL_106"], parsedStart, parsedEnd, now)` → notifikace s labelem `\`Odstávka „${label}"\``. Po commitu `emitSSE("schedule:changed", { sourceUserId: session.id })` (dnes route SSE neemituje — přidat import z `@/lib/eventBus`; klient si přes existující listener refetchne).
4. **company-days [id] PUT**: okno = union starého a nového intervalu (`min(oldStart,newStart)`, `max(oldEnd,newEnd)`) — zrušení/zkrácení odstávky mění kalendář stejně jako přidání. Stroje: union `oldMachine`/`newMachine` (null → oba). V tx: load starého záznamu → update → detect → notify. + SSE.
5. **company-days [id] DELETE**: okno = starý interval; v tx: load → delete → detect → notify. + SSE.

**Steps:**

- [ ] **Step 1:** Implementace bodů 1–5 (testy detekce jsou v Task 1; tady jde o wiring — testovatelné buildem + tsc; route testy projekt nemá).
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run build` + celá suita.
- [ ] **Step 3:** Ruční smoke popis do reportu: PUT směn s vypnutým pondělkem nad seedlými bloky → Notification řádky v DB (SQL výpis), company-day POST přes blok → totéž.
- [ ] **Step 4: Report.**

---

### Task 4: Reflow per blok — `reflowBlockInTx` + `POST /api/blocks/[id]/reflow`

**Files:**
- Create: `src/lib/reflow.server.ts`
- Create: `src/app/api/blocks/[id]/reflow/route.ts`
- Test: `src/lib/reflow.server.test.ts`

**Interfaces:**
- Consumes: `loadMachineCalendarRange` (T1), `expandPrintTime`, `snapStartToNextRunnableSlot`, `isMachineRunnableAt` (`@/lib/printTime`), `resolveChainPushFromDb` (`@/lib/overlapResolver.server`), `serializeBlock` vzor z `[id]/route.ts`.
- Produces:
  ```typescript
  export const REFLOW_MAX_START_SHIFT_DAYS = 7; // parita s auto-shiftem

  export type ReflowOutcome =
    | { ok: true; changed: boolean; startTime: Date; endTime: Date; moves: AppliedMove[] }
    | { ok: false; code: "NOT_FOUND" | "NOT_ZAKAZKA" | "BYPASS" | "LOCKED" | "PRINTED" | "NO_PM" | "UNALIGNED" | "NO_SLOT" | "HORIZON"; message: string };

  export async function reflowBlockInTx(
    tx: TxLike, blockId: number, actor: { id: number; username: string }
  ): Promise<ReflowOutcome>
  ```

**Chování `reflowBlockInTx`:**
1. Load blok (`tx.block.findUnique`); guardy → `ok: false` s kódem a českou hláškou: neexistuje / není ZAKAZKA / `scheduleBypassed` („Blok s vypnutým zámkem se nepřepočítává") / `locked` („Zamčený blok nelze přepočítat — nejdřív ho odemkni") / `printCompletedAt` / `printMinutes` null či ≤0 / nezarovnaný start.
2. Kalendář: `loadMachineCalendarRange(tx, machine, startTime, startTime + REFLOW_MAX_START_SHIFT_DAYS + MAX_SPAN_DAYS dní)`.
3. Nový start: `isMachineRunnableAt(machine, startTime, …)` → start zůstává; jinak `snapStartToNextRunnableSlot(machine, startTime, …, limit = startTime + 7d)` → `null` → `NO_SLOT` („Do 7 dnů není volný provozní slot").
4. `expandPrintTime(machine, newStart, pm, …, false)` → `ok: false` (jen HORIZON možný — start je runnable) → `HORIZON`.
5. `changed = newStart ≠ startTime || newEnd ≠ endTime`; když `!changed` → `{ ok: true, changed: false, moves: [] }` BEZ zápisů (idempotence).
6. Zápisy: `tx.block.update({ startTime: newStart, endTime: newEnd })` → `resolveChainPushFromDb(tx, machine, { id, startTime: newStart, endTime: newEnd })` (kolize se zamčeným → AppError bublá ven = celá tx spadne, route mapuje 422) → `tx.auditLog.create({ blockId, action: "AUTO_REFLOW", field: "startTime/endTime", oldValue: \`${oldStart.toISOString()}–${oldEnd.toISOString()}\`, newValue: \`${newStart.toISOString()}–${newEnd.toISOString()}\`, userId: actor.id, username: actor.username })`.

**Route `POST /api/blocks/[id]/reflow`:** auth `ADMIN`/`PLANOVAT` (403 jinak, 401 bez session), `prisma.$transaction(tx => reflowBlockInTx(tx, id, session))`; `ok: false` → 422 `{ error: message }` (`NOT_FOUND` → 404); `ok: true` → refetch bloku + moves bloků včetně `notes`/`Reservation` (serializační parita se `[id]/route.ts` PUT — includes zkopírovat odtud), `emitSSE("block:batch-updated", { blocks: [blok, ...moves], sourceUserId: session.id })`, response `{ changed, block, moves }`. Catch: `isAppError` → status dle kódu (`SCHEDULE_VIOLATION`/`OVERLAP` → 422/409 — převzít mapping z `[id]/route.ts`), jinak logger + 500.

**Steps:**

- [ ] **Step 1: Failing testy** `reflow.server.test.ts` — fake `tx` objekt (vzor `overlapResolver.server.test.ts`: obyčejný objekt s `mock.fn` metodami, BEZ `mock.module` — reflow dostává tx parametrem, netřeba experimental flag):
  1. drifted blok (end nesedí, start runnable) → `changed: true`, update voláno s re-expandovaným endem, audit AUTO_REFLOW se span old/new;
  2. blok sedí → `changed: false`, žádný `block.update`/`auditLog.create`;
  3. start mimo provoz → snap na další runnable slot + expanze; update start i end;
  4. zamčený blok → `{ ok: false, code: "LOCKED" }`, žádné zápisy;
  5. vytištěný → `PRINTED`;
  6. snap nenajde slot do 7 dnů (off kalendář) → `NO_SLOT`, žádné zápisy.
  Fake tx vrací pro `resolveChainPushFromDb` závislosti — jednodušší: `reflow.server.ts` přijme volitelný parametr `deps = { resolveChainPush: resolveChainPushFromDb }` pro test injection (vzor DI bez mock.module), default produkční.
- [ ] **Step 2: FAIL** (`node --test --import tsx src/lib/reflow.server.test.ts`).
- [ ] **Step 3: Implementace** lib + route.
- [ ] **Step 4: Zelené** (≥6) + tsc + build + suita.
- [ ] **Step 5: Report.**

---

### Task 5: Reflow per stroj — `POST /api/blocks/reflow`

**Files:**
- Create: `src/app/api/blocks/reflow/route.ts`
- Modify: `src/lib/reflow.server.ts` (přidat `reflowMachineInTx`)
- Test: rozšířit `src/lib/reflow.server.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type MachineReflowResult = {
    reflowed: Array<{ id: number; orderNumber: string }>;
    skipped: Array<{ id: number; orderNumber: string; reason: string }>; // LOCKED/PRINTED/NO_PM/UNALIGNED/NO_SLOT/HORIZON
  };
  export async function reflowMachineInTx(tx, machine: string, actor, now: Date): Promise<MachineReflowResult>
  ```

**Chování:** `detectCalendarDrift(tx, [machine], now, now + 365d, now)` → chronologicky (`startTime` asc) per blok `reflowBlockInTx`; `ok: false` s kódem `LOCKED`/`PRINTED`/`NO_PM`/`UNALIGNED` → skip (guard selhal PŘED jakýmkoli zápisem — bezpečné pokračovat); `NO_SLOT`/`HORIZON` → skip stejně (taky před zápisem); `changed: false` → nezařazovat nikam (mezitím ho srovnal chain push předchozího reflow). AppError z chain pushe (kolize se zamčeným) NECHYTAT — bublá ven, celá transakce se odvolá, route vrátí 422 s hláškou resolveru („Přepočet zastaven: …"). Statická route `/api/blocks/reflow` má v Next.js prioritu před dynamickou `[id]` — kolize jmen není.

**Route:** auth ADMIN/PLANOVAT; body `{ machine: "XL_105" | "XL_106" }` (validace proti seznamu — vzor `machine-week-shifts/route.ts:22`); `$transaction(tx => reflowMachineInTx(tx, machine, session, new Date()))` s `{ timeout: 30000 }` (hromadná operace); po commitu refetch všech dotčených id (reflowed + jejich chain-push moves — `reflowMachineInTx` vrací i seznam všech změněných id) a `emitSSE("block:batch-updated", { blocks, sourceUserId })`; response `{ reflowed, skipped, movedCount }`.

**Steps:**

- [ ] **Step 1: Failing testy** (fake tx + DI): 1. dva drifted bloky → oba reflowed chronologicky; 2. drifted + zamčený drifted → 1 reflowed, 1 skipped LOCKED; 3. žádný drift → prázdné výsledky, žádné zápisy; 4. druhý blok po reflow prvního už sedí (`changed: false`) → není v reflowed ani skipped.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementace** lib + route.
- [ ] **Step 4: Zelené** (≥4 nové) + tsc + build + suita.
- [ ] **Step 5: Report.**

---

### Task 6: Klientská detekce driftu — `blockCalendarDrift` v `printTimeClient.ts`

**Files:**
- Modify: `src/lib/printTimeClient.ts`
- Test: rozšířit `src/lib/printTimeClient.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type CalendarDriftInfo = {
    reason: "END_MISMATCH" | "START_NOT_RUNNABLE" | "HORIZON_EXCEEDED";
    expectedEnd: Date | null;
  };
  export function blockCalendarDrift(
    block: { type: string; scheduleBypassed?: boolean | null; printMinutes?: number | null;
             startTime: Date; endTime: Date; printCompletedAt?: string | Date | null },
    weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayInterval[],
    machine: string, now: Date
  ): CalendarDriftInfo | null
  ```
  (Tvar block parametru sladit s tím, co reálně používá `getBlockSegments` v témž souboru — machine může být uvnitř block objektu, implementer zvolí konzistentní variantu.)

**Chování:** `null` (= bez štítku) pro: ne-ZAKAZKA, bypass, `printMinutes` null/≤0, nezarovnaný start, `printCompletedAt` nastaven, `endTime <= now`. Jinak `expandPrintTime`: fail → drift s expanzním reason; ok a end ≠ `endTime` → `END_MISMATCH` s `expectedEnd`; ok a sedí → `null`. Guardy sdílet s `getBlockSegments`, kde to jde bez změny jeho chování (getBlockSegments dál vrací `null` při driftu — segmenty by lhaly; kreslení beze změny).

**Steps:**

- [ ] **Step 1: Failing testy** v `printTimeClient.test.ts` (fixtury už v souboru): sedící blok → null; end mismatch → END_MISMATCH + expectedEnd; start mimo provoz → START_NOT_RUNNABLE; bypass → null; vytištěný → null; blok v minulosti → null; nezarovnaný start → null.
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implementace.**
- [ ] **Step 4: Zelené** (13 + ≥7) + tsc.
- [ ] **Step 5: Report.**

---

### Task 7: UI — štítek na kartě, banner stroje s „Přepočítat vše", BlockDetail „Přepočítat"

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`
- Modify: `src/app/_components/PlannerPage.tsx`
- Modify: `src/components/BlockDetail.tsx`

**Interfaces:**
- Consumes: `blockCalendarDrift` (T6), `POST /api/blocks/[id]/reflow` (T4), `POST /api/blocks/reflow` (T5), toast API (`ToastContainer` vzor v PlannerPage), deadline badge vzor (TimelineGrid, etapa 5 — hledej „PO DEADLINE").

**Chování:**
1. **TimelineGrid — drift mapa:** `useMemo` mapa `id → CalendarDriftInfo` přes viditelné bloky (vzor `blockSegmentsMap`; memo PŘED early-returnem komponenty — rules-of-hooks; `now` pro výpočet vzít jednou per render, ne per blok).
2. **Štítek na kartě:** oranžový badge `⚠ KALENDÁŘ` (TINY mód jen `⚠`, pod TINY nic — parita s deadline badge). Stack pravého horního rohu: deadline (červený) nahoře, drift (oranžový) pod ním, 📝 ještě níž — použít existující offset mechaniku deadline badge (etapa 5), jen rozšířit o třetí patro. Barva: oranžová z existující palety (hledej amber/orange token v repu; jinak `#f59e0b`). Viditelný VŠEM rolím (i TISKAR/VIEWER — informace, ne akce).
3. **Banner stroje:** v hlavičce sloupce stroje (vedle názvu XL 105/106) chip `⚠ N nesedí na kalendář` + tlačítko `Přepočítat` — JEN když `N > 0` a `canEdit` (ADMIN/PLANOVAT); klik → `confirm()` s textem `Přepočítat N bloků na ${machine}? Bloky se posunou na nejbližší platné sloty (zamčené se přeskočí).` → POST `/api/blocks/reflow` → toast úspěch `Přepočteno X bloků${skipped ? \`, přeskočeno Y (zamčené/nevejde se)\` : ""}` / toast error z response. Data dorovná SSE `block:batch-updated` (listener existuje).
4. **BlockDetail:** když drift (spočítat v PlannerPage a předat prop, NEBO spočítat v BlockDetail — zvolit dle toho, kdo má weekShifts/companyDays po ruce; PlannerPage je má ve state): výstražný řádek `⚠ Konec nesedí na aktuální kalendář` + u END_MISMATCH dovětek `(správně do ${formát Praha expectedEnd)})` + tlačítko `Přepočítat` jen pro ADMIN/PLANOVAT → POST `[id]/reflow` → toast + zavřít/refresh detail přes SSE. 422 → toast error hlášky ze serveru.
5. Mouse handlery nových tlačítek: obyčejný onClick (žádný drag) — `e.stopPropagation()` proti otevření detailu bloku pod bannerem netřeba (banner je mimo karty), ale u tlačítka v BlockDetail nic speciálního.

**Steps:**

- [ ] **Step 1: Implementace** (UI task — bez unit testů; verifikace build + tsc + manuální scénář).
- [ ] **Step 2:** `npx tsc --noEmit` + `npm run build`.
- [ ] **Step 3: Manuální smoke** (dev server + seed data): vypnout pondělní ráno v admin směnách → bloky dostanou ⚠ štítek, banner ukáže počet; „Přepočítat" v BlockDetail srovná jeden blok; banner „Přepočítat" srovná zbytek; štítky zmizí bez reloadu (SSE). Zapsat do reportu s pozorováními.
- [ ] **Step 4: Report.**

---

### Task 8: Split bypass bloku — sticky-bypass parity (přenos IMPORTANT-2 z etapy 5)

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` (handleSplitBlockAt) a/nebo `src/app/_components/PlannerPage.tsx` (kde žijí PUT/POST split payloady — implementer dohledá přesné místo přes grep `handleSplitBlockAt` / split PUT+POST dvojici)

**Bug (pre-existing, nalezen v review etapy 5):** split bloku se `scheduleBypassed: true` posílá head PUT a tail POST BEZ `bypassScheduleValidation: true`. Server head PUT přepočítá end kalendářní inverzí (`computePrintMinutes` na bypass bloku vrací míň minut — ztráta tiskového času) a tail POST může spadnout na 422 AŽ PO commitu hlavy → rozbitý mezistav.

**Fix:** když zdrojový blok má `scheduleBypassed === true`: head PUT payload i tail POST payload dostanou `bypassScheduleValidation: true` a `printMinutes` = elapsed příslušné části (dělení zůstává elapsed-based, jak je od etapy 5). Server si `effectivelyBypassed` spočítá sám — pokud část náhodou sedí na kalendář, uloží se `false` (správně, sticky jen jako REQUEST).

**Steps:**

- [ ] **Step 1: Implementace** (najít payloady, přidat podmíněný flag + pm).
- [ ] **Step 2:** tsc + build.
- [ ] **Step 3: Manuální ověření:** seed bypass blok přes odstávku (seed skript `scripts/seed-test-tiskove-hodiny.ts` má bypass case, jinak ručně vypnout zámek při dropu), split uprostřed → OBĚ části existují, součet délek = původní elapsed, obě `scheduleBypassed` dle pozice, žádná 422. Zapsat do reportu.
- [ ] **Step 4: Report.**

---

### Task 9: Dokumentace + úklid

**Files:**
- Modify: `CLAUDE.md` (sekce „Ověřený stav" — nový řádek etapy 6; nová podsekce „Kalendářní revalidace (etapa 6)" se stručným popisem: detekce bez DB sloupce, notifikace CALENDAR_DRIFT, reflow endpointy, AUTO_REFLOW audit, findConflictingBlocks okno +6h/neighbor rows, sticky-bypass split fix; aktualizovat počty testů v sekci „Spuštění testů" + přidat nové test soubory)
- Modify: `DOKUMENTACE.md` — JEN pokud tam existuje sekce o pracovní době/odstávkách, doplnit odstavec o štítku a Přepočítat (jinak nechat na etapu 7).

**Steps:**

- [ ] **Step 1:** Aktualizace docs dle skutečně implementovaného stavu (číst reporty tasků, ne domněnky).
- [ ] **Step 2:** Finální běh CELÉ suity (všechny soubory vč. nových) + tsc + build; počty zapsat do CLAUDE.md.
- [ ] **Step 3: Report.**

---

## Poznámky pro kontrolér (mimo tasky)

- Po Task 9: finální whole-branch review (nejsilnější model) přes review-package diff working tree vs commit `4318d602` (stage 5) — žádné commity, snapshot diff.
- Vědomě MIMO scope etapy 6 (zůstává v ledgeru): smíšené lasso duration snap, série preview, 3× duration helper DRY, vizuální QA TISKAR×pauza, fallback quirk `isHardcodedBlocked` (týden bez řádků posuzuje Po 0–6 jen per-day), REZERVACE lock+40h starý snap. Reporty = etapa 7 (spec 3.10).
- 8 legacy drift bloků v dev DB (březen/duben) je PO této etapě vidět jen v BlockDetail, pokud jim end propadne přes `endTime > now` filtr — bloky jsou minulé, štítek nedostanou (záměr).
