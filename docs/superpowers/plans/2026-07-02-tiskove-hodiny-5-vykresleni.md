# Tiskové hodiny — Plán 5: Vykreslení pauz + poctivé náhledy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. ŽÁDNÉ commity — commituje Vojta.

**Goal:** Blok přes odstávku se vykreslí jako jedna zakázka s viditelnou pauzou; drag/resize/queue/paste náhledy ukazují skutečný span po expanzi; deadline varování; délky se všude popisují jako „X h tisku (Y h celkem)". Bonus: rezervace 40 h (rozhodnutí Vojty 2. 7.), split podle poloviny tiskových minut, serverové drobnosti z ledgeru.

**Architecture:** Nová pure funkce `getBlockSegments` (printTimeClient) spočítá segmenty bloku klientsky z `printMinutes` + kalendáře; při nesouladu s uloženým endem (drift kalendáře) vrací null → blok se kreslí slitě jako dnes (poctivý fallback, drift řeší etapa 6). Vykreslení zůstává 1 div (hit-testing, selection, drag beze změny) + absolutně pozicované „pauza" overlaye uvnitř. Náhledy volají expanzi na kandidátní pozici (memo per slot).

**Spec:** 3.11 (vykreslení, preview, tooltips, split, deadline, série labels). Mapování kódu: Explore report „stage 4" (14cf1393).

## Global Constraints

- **Nikdy neblokovat render:** když `getBlockSegments` vrátí null (chybí pm / bypass / drift / expand fail), blok se kreslí přesně jako dnes. Overlay je progressive enhancement.
- **Hit-testing, selection, drag, context menu beze změny** — pauza overlay má `pointerEvents: "none"`.
- **Pauza ≠ split:** pauza = tmavý „můstek" S PŘERUŠOVANÝMI okraji uvnitř bloku (šrafování odstávky zIndex 2 prosvítá); split zůstává samostatné bloky s ✂ chipy. Žádná záměna stylů.
- **Náhledy počítají expanzi přes stejné pure funkce jako server** (`expandPrintTime`/`computePrintMinutes`/`snapStartToNextRunnableSlot`), s memo per kandidátní slot (výkon při mousemove).
- **Mutační payloady se v této etapě NEMĚNÍ** (výjimka: split default bod a splitAt-guard — Task 5; serverové drobnosti — Task 6).
- Verifikace každého tasku: `npx tsc --noEmit` 0 + dotčené testy + `npm run build`.
- Žádné commity.

## File Structure

| Soubor | Akce | Task |
| --- | --- | --- |
| `src/app/rezervace/_components/PlanningForm.tsx` | 40 h options (sdílené z plannerTypes) | 1 |
| `src/lib/printTimeClient.ts` + test | + `getBlockSegments`, `printMidpoint` | 1 |
| `src/app/_components/TimelineGrid.tsx` | pauza overlay + layout mode dle 1. segmentu | 2 |
| `src/app/_components/TimelineGrid.tsx` | poctivé drag/resize/queue/paste náhledy | 3 |
| `src/app/_components/TimelineGrid.tsx`, `src/components/BlockDetail.tsx`, `src/components/DtpPanel*.tsx` | deadline štítek + „X h tisku (Y h celkem)" | 4 |
| `src/app/_components/TimelineGrid.tsx` | split: default = polovina tisku, guard pauzy | 5 |
| `src/app/api/blocks/*` + `src/lib/overlapResolver.server.ts` | AUTO_SHIFT audit endTime, TODO komentáře, notes refetch | 6 |
| `CLAUDE.md` | docs + počty | 7 |

---

### Task 1: Helpery + rezervace 40 h

**Files:** Modify `src/lib/printTimeClient.ts`, `src/lib/printTimeClient.test.ts`, `src/app/rezervace/_components/PlanningForm.tsx`.

**Interfaces — Produces:**
- `BlockSegment = { start: Date; end: Date; kind: "print" | "pause" }` (re-export `PrintSegment` z printTime pod tímto aliasem, nebo použít přímo `PrintSegment`).
- `getBlockSegments(b: { type: string; machine: string; startTime: string | Date; endTime: string | Date; printMinutes?: number | null; scheduleBypassed?: boolean }, weekShifts: MachineWeekShiftsRow[], companyDays: CompanyDayClientRow[]): PrintSegment[] | null` — null když: typ ≠ ZAKAZKA, pm null/≤0, `scheduleBypassed`, expand !ok, NEBO `expand.end !== block.endTime` (drift kalendáře — segmenty by lhaly). Vrací segmenty jen když obsahují aspoň jednu pauzu (jinak null — overlay není potřeba).
- `printMidpoint(b: tentýž vstup, weekShifts, companyDays): Date | null` — čas, kdy je odpracována polovina tiskových minut (zaokrouhleno na slot): projdi print segmenty a odečítej minuty; null když segmenty nejsou k dispozici (fallback volajícího = kalendářní midpoint jako dnes).
- `CompanyDayClientRow = { machine?: string | null; startDate: string | Date; endDate: string | Date }` (existující shape parametru `companyDayIntervalsFor` — exportovat jako typ).

- [ ] **Step 1: Failing testy** (printTimeClient.test.ts — fixtury `xl106Week`/W1/W2 + `pragueToUTC` už importované):

```typescript
test("getBlockSegments: pauznutý blok vrací print/pause segmenty sedící na end", () => {
  // Pá 10:00 + 27 h (Gardena): print Pá 10–22, pause víkend, print Ne 22 – Po 13
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-24", 13),
    printMinutes: 27 * 60, scheduleBypassed: false,
  };
  const segs = getBlockSegments(b, SHIFTS, []);
  assert.ok(segs);
  assert.deepEqual(segs!.map((s) => s.kind), ["print", "pause", "print"]);
  assert.deepEqual(segs![1]!.start, pragueToUTC("2026-08-21", 22));
  assert.deepEqual(segs![1]!.end, pragueToUTC("2026-08-23", 22));
});

test("getBlockSegments: souvislý blok (bez pauzy) → null (overlay není potřeba)", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    printMinutes: 240, scheduleBypassed: false,
  };
  assert.equal(getBlockSegments(b, SHIFTS, []), null);
});

test("getBlockSegments: drift kalendáře (end nesedí na expand) → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-25", 0), // špatný end
    printMinutes: 27 * 60, scheduleBypassed: false,
  };
  assert.equal(getBlockSegments(b, SHIFTS, []), null);
});

test("getBlockSegments: bypass blok → null", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-22", 12), endTime: pragueToUTC("2026-08-22", 16),
    printMinutes: 240, scheduleBypassed: true,
  };
  assert.equal(getBlockSegments(b, SHIFTS, []), null);
});

test("printMidpoint: Gardena 27 h → polovina (13,5 h) odpracována Ne 23:30", () => {
  // Pá 10–22 = 12 h; zbytek 1,5 h od Ne 22:00 → 23:30
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-21", 10), endTime: pragueToUTC("2026-08-24", 13),
    printMinutes: 27 * 60, scheduleBypassed: false,
  };
  assert.deepEqual(printMidpoint(b, SHIFTS, []), pragueToUTC("2026-08-23", 23, 30));
});

test("printMidpoint: bez segmentů (souvislý blok) → midpoint z printMinutes/2 od startu", () => {
  const b = {
    type: "ZAKAZKA", machine: "XL_106",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    printMinutes: 240, scheduleBypassed: false,
  };
  assert.deepEqual(printMidpoint(b, SHIFTS, []), pragueToUTC("2026-08-18", 10));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implementace** (printTimeClient.ts):

```typescript
import { expandPrintTime, snapStartToNextRunnableSlot, SLOT_MS, type CompanyDayInterval, type PrintSegment } from "@/lib/printTime";

export type CompanyDayClientRow = { machine?: string | null; startDate: string | Date; endDate: string | Date };
export type { PrintSegment };

/**
 * Segmenty bloku pro vykreslení pauz. Vrací null, když overlay nedává smysl:
 * ne-ZAKAZKA, chybějící/neplatné printMinutes, bypass blok (kreslí se slitě záměrně),
 * expanze selže, expanze nesedí na uložený end (drift kalendáře — segmenty by lhaly;
 * detekci driftu řeší etapa 6), nebo expanze nemá žádnou pauzu (overlay netřeba).
 */
export function getBlockSegments(
  b: { type: string; machine: string; startTime: string | Date; endTime: string | Date; printMinutes?: number | null; scheduleBypassed?: boolean },
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[]
): PrintSegment[] | null {
  if (b.type !== "ZAKAZKA" || b.scheduleBypassed) return null;
  const pm = b.printMinutes;
  if (pm == null || !Number.isFinite(pm) || pm <= 0) return null;
  const start = new Date(b.startTime);
  if (start.getTime() % SLOT_MS !== 0) return null;
  let exp: ReturnType<typeof expandPrintTime>;
  try {
    exp = expandPrintTime(b.machine, start, pm, weekShifts, companyDayIntervalsFor(b.machine, companyDays), false);
  } catch {
    return null;
  }
  if (!exp.ok) return null;
  if (exp.end.getTime() !== new Date(b.endTime).getTime()) return null;
  return exp.segments.some((s) => s.kind === "pause") ? exp.segments : null;
}

/**
 * Bod, kde je odpracována polovina tiskových minut (default bod splitu).
 * Fallback bez segmentů: start + printMinutes/2 (souvislý blok). Null jen když pm chybí.
 */
export function printMidpoint(
  b: Parameters<typeof getBlockSegments>[0],
  weekShifts: MachineWeekShiftsRow[],
  companyDays: CompanyDayClientRow[]
): Date | null {
  const pm = b.type === "ZAKAZKA" ? b.printMinutes : null;
  if (pm == null || !Number.isFinite(pm) || pm <= 0) return null;
  const half = Math.round(pm / 2 / 30) * 30; // zarovnat na slot
  const segs = getBlockSegments(b, weekShifts, companyDays);
  if (!segs) return new Date(new Date(b.startTime).getTime() + half * 60000);
  let remaining = half;
  for (const s of segs) {
    if (s.kind !== "print") continue;
    const segMin = Math.round((s.end.getTime() - s.start.getTime()) / 60000);
    if (remaining <= segMin) return new Date(s.start.getTime() + remaining * 60000);
    remaining -= segMin;
  }
  return new Date(new Date(b.endTime).getTime());
}
```

- [ ] **Step 4: PlanningForm 40 h** — smazat lokální `DURATION_OPTIONS` (řádky 18–23) a importovat sdílené `DURATION_OPTIONS` z `@/lib/plannerTypes` (rozhodnutí Vojty: obchodníci smí 40 h). Ověř, že select používá stejný shape `{label, hours}` (používá — je to kopie).

- [ ] **Step 5: Ověř** — testy 13/13 (7+6), tsc 0, build OK.

---

### Task 2: Pauza overlay + layout mode podle prvního segmentu

**Files:** Modify `src/app/_components/TimelineGrid.tsx`.

**Kontrakt:**
1. Per-blok segmenty: memoizovaná mapa `useMemo(() => Map<blockId, PrintSegment[]>, [blocks, machineWeekShifts, companyDays])` — jen bloky, kde `getBlockSegments` vrátí non-null. (TimelineGrid dnes memo nepoužívá — zavést pro tuto mapu; splitGroupMap nechat být.)
2. Uvnitř block divu (za content, `pointerEvents: "none"`) pro každý pause segment overlay:

```tsx
{pauseSegs?.map((seg) => {
  const segTop = dateToY(seg.start, viewStart, slotHeight) - top;
  const segH = dateToY(seg.end, viewStart, slotHeight) - dateToY(seg.start, viewStart, slotHeight);
  return (
    <div key={seg.start.toISOString()} style={{
      position: "absolute", top: segTop, height: segH, left: 0, right: 0,
      background: "rgba(10,15,28,0.55)",
      borderTop: "2px dashed rgba(148,163,184,0.7)",
      borderBottom: "2px dashed rgba(148,163,184,0.7)",
      pointerEvents: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {segH >= 40 && (
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "rgba(203,213,225,0.85)", background: "rgba(2,6,23,0.6)", padding: "1px 8px", borderRadius: 6 }}>
          ⏸ PAUZA — mimo provoz
        </span>
      )}
    </div>
  );
})}
```

Ztmavený pruh + přerušované vodorovné okraje = „můstek"; červené šrafování odstávky (zIndex 2, kreslí se NAD blokem) zůstává viditelné → vizuálně zřetelně jiné než split (samostatné bloky s ✂ chipy). Levý accent bar bloku nechat průběžný (drží identitu jedné zakázky).
3. **Layout mode podle prvního segmentu:** když blok má segmenty, `contentHeight = výška prvního print segmentu` (místo `clampedHeight`) pro volbu MODE_FULL/COMPACT/TINY + showDesc/showDates/descLineClamp (řádky ~978–994). Obsah bloku (texty, chipy) se vejde do prvního segmentu a nepropadne do pauzy. `clampedHeight` pro pozici/výšku divu beze změny.
4. Resize handle a spodní hrana bloku beze změny (poslední segment je vždy print — handle je na tiskové části).

- [ ] Steps: implementace → vizuální sanity (npm run build) → `npx tsc --noEmit` 0. Ověř, že bloky BEZ segmentů (99 % plánu) renderují IDENTICKY (žádná změna DOM krom memo mapy).

---

### Task 3: Poctivé náhledy (drag, resize, queue, paste marker)

**Files:** Modify `src/app/_components/TimelineGrid.tsx` (+ props z `src/app/_components/PlannerPage.tsx` pro paste marker).

**Kontrakt (vše jen pro ZAKAZKA + zapnutý zámek; jinak dnešní chování):**
1. **Move drag ghost** (mousemove, ~ř. 2282–2312): na kandidátním snapped startu spočítat `expandPrintTime(machine, snappedStart, blockPrintMinutes(block), ws, cd)`; ghost `height = dateToY(exp.end) − dateToY(snappedStart)`. **Memo cache** `Map<string, number>` klíč `${machine}|${startMs}` (reset při mousedown) — expanze max 1× per slot. Expand !ok → dnešní naivní výška.
2. **Resize preview** (~ř. 2295 + tooltip ~3506–3537): při tažení spočítat `pm = computePrintMinutes(machine, start, snappedEnd, ws, cd)` a autoritativní hranu `exp = expandPrintTime(machine, start, max(30, pm), …)`; ghost končí na `exp.end` (= snap na hranu segmentu živě); tooltip: **„→ HH:MM · X h tisku (Y h celkem)"** — X z pm, Y z (exp.end − start). Pro bloky bez pm / bypass: dnešní tooltip. Stejná memo cache (klíč per snappedEnd).
3. **Queue preview** (~ř. 2238–2245): top = `dateToY(snapStartToNextRunnableSlot(machine, slotStart, ws, cd))` (fallback raw při null), height z expanze pm = `durationHours*60`. Memo cache jako výše.
4. **Paste marker** (~ř. 3340–3350): PlannerPage předá nový prop `pasteSourceIsZakazka: boolean` (+ stávající `pasteSlotDurationMs` interpretovat jako pm×60000 pro ZAKAZKA zdroj — PlannerPage ho už počítá ze src bloku; ověř a případně uprav na `blockPrintMinutes(src)*60000`). V markeru: ZAKAZKA → `effectiveTime = snapStartToNextRunnableSlot(machine, time, ws, cdIntervals) ?? time`; jinak stará cesta. Tím marker ukazuje přesně místo, kam paste z etapy 4 skutečně vloží.

- [ ] Steps: implementace → tsc 0 → build OK → v reportu ručně natrasovat Gardena drag: ghost přes víkend má výšku ~3 dní, ne 27 h.

---

### Task 4: Deadline štítek + „X h tisku (Y h celkem)" v tooltipu a detailech

**Files:** Modify `src/app/_components/TimelineGrid.tsx`, `src/components/BlockDetail.tsx`, DtpPanel komponenta (najdi soubor s `blockDurationLabel`, ~`src/components/DtpPanel.tsx`).

**Kontrakt:**
1. **Deadline štítek:** pro ZAKAZKA s `deadlineExpedice`: blok je „po deadline", když `endTime > konec civilního dne deadlineExpedice v Praze` (použij existující util na Prague civil date — viz `utcToPragueDateStr`; srovnání dateStr end > deadline dateStr je dostatečné a DST-safe). Štítek: malý badge „⚠ PO DEADLINE" v pravém horním rohu bloku (FULL/COMPACT; v TINY jen ⚠), styl: `background: #b91c1c, color: #fff, fontSize: 9, fontWeight: 800, borderRadius: 4, padding: "1px 5px"`, zIndex nad content, POD paste marker. Nekolidovat s FULL štítkem tiskaře (memory: FULL štítek zvednut nad Hotovo/SplitChip — umísti deadline badge vlevo od něj, nebo o řádek níž; implementer ověří vizuální kolizi v kódu štítků).
2. **Hover tooltip bloku** (~ř. 1713–1880): přidat řádek délky: ZAKAZKA s pm: `Tisk: X h · Celkem: Y h` (Y = end−start; když se rovnají, jen `Délka: X h`); formát hodin jako `durationHuman` (celé/1 des.).
3. **BlockDetail „Délka"** (ř. ~194 + `durationHuman`): ZAKAZKA s pm a pm ≠ elapsed → `„X h tisku (Y h celkem)"`; jinak dnešní text.
4. **DtpPanel `blockDurationLabel`**: stejná logika.

- [ ] Steps: implementace → tsc 0 → build OK.

---

### Task 5: Split podle poloviny tisku + guard splitu v pauze

**Files:** Modify `src/app/_components/TimelineGrid.tsx`.

**Kontrakt:**
1. `calcSplitAt` (~ř. 2581–2589): default místo kalendářního midpointu použít `printMidpoint(block, ws, cdRows) ?? kalendářní mid` (ZAKAZKA; jinak beze změny). Kliknuté místo (rawSplit uvnitř bloku) má dál přednost.
2. `handleSplitBlockAt` (~ř. 2591): PŘED mutacemi guard — pro ZAKAZKA bez bypass: `splitAt` musí být runnable slot (`isMachineRunnableAt(machine, splitAt, ws, cdIntervals)` — import z printTime) A `headPm > 0 && tailPm > 0` (existující guard). Ne-runnable → error „Nelze rozdělit uvnitř pauzy — zvol místo v tiskové části." + return. (Tail POST se startem v pauze by po committed PUT hlavy spadl na START_NOT_RUNNABLE — guard tomu předchází.)

- [ ] Steps: implementace → tsc 0 → build OK.

---

### Task 6: Serverové drobnosti z ledgeru

**Files:** Modify `src/app/api/blocks/route.ts`, `src/app/api/blocks/[id]/route.ts`, `src/app/api/blocks/batch/route.ts`, `src/lib/overlapResolver.server.ts` (typ AppliedMove se nemění — endy už nese).

**Kontrakt:**
1. **AUTO_SHIFT audit i endTime:** ve všech 3 routách rozšířit AUTO_SHIFT auditLog řádky chain pushe: `field: "startTime/endTime"`, `oldValue: `${m.oldStartTime.toISOString()}–${m.oldEndTime.toISOString()}``, `newValue: `${m.startTime.toISOString()}–${m.endTime.toISOString()}`` (re-expanze mění i délku spanu — musí být v auditu vidět; formát `A–B` jako u batch UPDATE řádků).
2. **POST shifted-refetch notes:** v POST route refetch posunutých bloků (~ř. 353) doplnit `notes: { orderBy: { createdAt: "desc" } }` include (parita s PUT/batch — SSE payload nesmí mazat notes v klientské cache).
3. **Stale TODO komentáře:** v POST a batch routách přeformulovat `TODO(Plán 4): odstranit — klient bude posílat printMinutes explicitně` na trvalou pravdu: `Fallback z elapsed zůstává trvale — kryje legacy bloky (pm=null) a přímé API klienty; hlavní klient posílá printMinutes explicitně (etapa 4).`

- [ ] Steps: implementace → `node --test --import tsx src/lib/overlapResolver.server.test.ts` 7/7 (audit formát v testech není pinovaný — ověř) → tsc 0 → build OK.

---

### Task 7: Docs + finální verifikace

**Files:** Modify `CLAUDE.md`.

- [ ] Spustit všech 13 test souborů — reálné počty (očekávané: printTimeClient 13, ostatní beze změny → total 129; ověř).
- [ ] CLAUDE.md: vykreslení pauz (`getBlockSegments`, layout mode dle 1. segmentu, poctivé náhledy, deadline štítek, split podle printMidpoint + guard, „X h tisku (Y h celkem)"), rezervace 40 h, mezistavy z etapy 4 označit za vyřešené (preview/marker), AUTO_SHIFT audit formát. Aktualizovat počty testů + „Ověřený stav".
- [ ] `npx tsc --noEmit && npm run lint && npm run build` — 0/0 err/OK; `npx tsx scripts/detect-legacy-bypass.ts | tail -1` — 175/14/1.

## Vědomé mezistavy po Plánu 5

1. **Drift kalendáře** (end nesedí na expand) → blok se kreslí slitě bez štítku — detekce + „Přepočítat" = etapa 6.
2. **Smíšené lasso** dál duration-based snap (M7) — vzácné, řeší se případně v etapě 6/finále.
3. **Série preview** v builderu dál duration-based (kolizní vizuál) — mutace jsou správně; nízká priorita.

## Self-review (při psaní plánu)

- Spec 3.11 vykreslení: 1 div + overlay ✓ (T2), layout dle 1. segmentu ✓ (T2), odlišení pauza/split ✓ (T2), drag/resize preview + tooltip „X h tisku (Y h celkem)" ✓ (T3+T4), queue preview + paste marker ✓ (T3), split printMinutes/2 + zákaz v pauze ✓ (T5), deadline štítek ✓ (T4), BlockDetail/DtpPanel ✓ (T4).
- Rozhodnutí Vojty: rezervace 40 h ✓ (T1).
- Ledger přenosy: AUTO_SHIFT audit endTime ✓, POST notes refetch ✓, M6 TODO komentáře ✓ (T6); M7/M8 → M8 vyřešeno T1, M7 mezistav.
- Typová konzistence: `getBlockSegments`/`printMidpoint` (T1) ↔ T2/T3/T5; `PrintSegment` z printTime.
- Gardena test čísla (T1): Pá 10 + 27 h → end Po 13:00 (pin z etapy 1); midpoint 13,5 h: Pá 12 h + 1,5 h od Ne 22:00 = Ne 23:30 ✓.
