# Tiskové hodiny — Plán 4: Klient — mutační cesty + dropdown 40 h

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. ŽÁDNÉ commity — commituje Vojta.

**Goal:** Všech 8 klientských mutačních cest přejde na model tiskových hodin (posílají `printMinutes`, start snapují start-only), dropdown délky se rozšíří na 40 h. Tím zmizí poslední mechanismus „teleportu" (klientský duration-based snap) a 10h blok jde položit na 8h směnu.

**Architecture:** Klient přestává počítat `end = start + délka` a přestává vyžadovat souvislé okno. Pro ZAKAZKA posílá `startTime` + `printMinutes` (+ naivní `endTime` jen jako fallback, server ho ignoruje); start snapuje pure funkcí `snapStartToNextRunnableSlot` (import z `@/lib/printTime` — pure, klient-safe; weekShifts i companyDays má klient ve state). Ne-ZAKAZKA typy zůstávají na starém chování (end−start, server je nevaliduje). Vykreslení pauz, poctivé drag preview a tooltips = etapa 5.

**Spec:** sekce 3.11 (mutační cesty), 3.5 (klientská část). Mapování aktuálního kódu: Explore report 2. 7. (čísla řádků po commitu 573f0a19).

## Global Constraints

- **ZAKAZKA mutace posílá `printMinutes` explicitně.** Server je autoritativní pro `endTime` — klientův naivní end je jen fallback/sanity (batch API vyžaduje start<end).
- **Ne-ZAKAZKA (UDRZBA/REZERVACE): beze změny chování** — server pro ně používá klientův end (fallbackEnd); dál posílají `endTime` a používají starý snap.
- **Start-only snap:** `snapStartToNextRunnableSlot(machine, start, weekShifts, companyDayIntervals)`; když vrátí `null` (žádný slot do 21 dní), mutace se NEODEŠLE a uživatel dostane error toast — žádný tichý fallback na nevalidní pozici.
- **Vypnutý zámek pracovní doby:** beze změny — žádný snap, `bypassScheduleValidation: true`.
- **Resize se v této etapě NEMĚNÍ** — server od etapy 2 počítá printMinutes inverzí z endu; klientský handler je korektní. (Snap endu na hranu segmentu + tooltip = etapa 5.)
- **Dropdown 40 h smí ven jen v této etapě** (spec: nikdy před opravou snapu — snap se opravuje zde).
- Coding standards repa (AppError se klienta netýká; komponenty do `src/components/`; `e.button` checky nechat být).
- Verifikace každého tasku: `npx tsc --noEmit` 0 chyb + dotčené testy + `npm run build`.
- Žádné commity. Serverové soubory (`src/app/api/**`, `src/lib/*server*`) se v této etapě NEMĚNÍ.

## Vědomé mezistavy po Plánu 4 (→ etapa 5)

1. **Drag/paste preview lže u bloků přes odstávku** — ghost/marker kreslí souvislý obdélník `start + délka`; skutečný span po dropu bývá delší (server expanduje). Poctivé živé preview = etapa 5.
2. **Blok přes pauzu se kreslí jako slitý** (bez vizuální pauzy) = etapa 5.
3. **Resize end puštěný uvnitř pauzy** vrátí 422 (pm=0) nebo delší pm než uživatel čekal — snap na hranu segmentu = etapa 5.
4. **Group paste přes odstávku:** offsety členů jsou z původních spanů; re-expanze může členy natáhnout → následné POSTy s `resolveChain` odsunou dříve vložené členy. Skupina zůstane bez překryvů (server), ale rozestupy se mohou změnit. Dokumentováno, plný fix není v plánu (vzácný případ).
5. **Série preview** (kolizní kontrola v náhledu) používá starý duration-based `findNextFreeSlot` — jen vizuální; server umísťuje print-finderem.

## File Structure

| Soubor | Akce | Zodpovědnost |
| --- | --- | --- |
| `src/lib/printTimeClient.ts` | Create | klient-safe helpery: `blockPrintMinutes`, `companyDayIntervalsFor`, `snapGroupDeltaStartOnly` |
| `src/lib/printTimeClient.test.ts` | Create | testy helperů |
| `src/lib/plannerTypes.ts` | Modify | `DURATION_OPTIONS` 48 → 80 položek (40 h) |
| `src/app/_components/TimelineGrid.tsx` | Modify | typ Block + drag/move + multi-move na start-only |
| `src/app/_components/PlannerPage.tsx` | Modify | paste, group paste, queue drop, série |
| `src/components/BlockEdit.tsx` | Modify | délka = printMinutes; save posílá printMinutes |
| `CLAUDE.md` | Modify | dokumentace + počty testů |

---

### Task 1: Klient-safe helpery + dropdown 40 h

**Files:** Create `src/lib/printTimeClient.ts`, `src/lib/printTimeClient.test.ts`; Modify `src/lib/plannerTypes.ts`.

**Interfaces — Produces (Tasky 2–5 na tom staví):**
- `blockPrintMinutes(b: { type: string; printMinutes?: number | null; startTime: string | Date; endTime: string | Date }): number` — pro ZAKAZKA `printMinutes ?? elapsed`, pro ostatní elapsed (end−start v minutách).
- `companyDayIntervalsFor(machine: string, companyDays: { machine?: string | null; startDate: string | Date; endDate: string | Date }[]): CompanyDayInterval[]` — filtr (bez stroje nebo shodný stroj) + převod na `{start: Date, end: Date}`.
- `snapGroupDeltaStartOnly(blocks: { machine: string; originalStart: Date }[], proposedDeltaMs: number, weekShifts: MachineWeekShiftsRow[], companyDays: Parameters<typeof companyDayIntervalsFor>[1]): { deltaMs: number; wasSnapped: boolean } | null` — analgie `snapGroupDeltaWithTemplates`, ale snapuje jen STARTY přes `snapStartToNextRunnableSlot`; `null` = některý start nejde umístit (volající zobrazí chybu a mutaci neodešle).

- [ ] **Step 1: Failing testy** — `src/lib/printTimeClient.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { pragueToUTC } from "./dateUtils";
import { blockPrintMinutes, companyDayIntervalsFor, snapGroupDeltaStartOnly } from "./printTimeClient";
import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";

const SHIFTS = [...xl106Week(W1), ...xl106Week(W2)];

test("blockPrintMinutes: ZAKAZKA s printMinutes → printMinutes", () => {
  assert.equal(
    blockPrintMinutes({ type: "ZAKAZKA", printMinutes: 240, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-20T08:00:00.000Z" }),
    240
  );
});

test("blockPrintMinutes: ZAKAZKA bez printMinutes → elapsed fallback", () => {
  assert.equal(
    blockPrintMinutes({ type: "ZAKAZKA", printMinutes: null, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T12:00:00.000Z" }),
    240
  );
});

test("blockPrintMinutes: UDRZBA ignoruje printMinutes → elapsed", () => {
  assert.equal(
    blockPrintMinutes({ type: "UDRZBA", printMinutes: 999, startTime: "2026-08-18T08:00:00.000Z", endTime: "2026-08-18T10:00:00.000Z" }),
    120
  );
});

test("companyDayIntervalsFor: filtruje stroj a převádí na Date intervaly", () => {
  const cds = [
    { machine: null, startDate: "2026-08-18T00:00:00.000Z", endDate: "2026-08-19T00:00:00.000Z" },
    { machine: "XL_105", startDate: "2026-08-20T00:00:00.000Z", endDate: "2026-08-21T00:00:00.000Z" },
    { machine: "XL_106", startDate: "2026-08-22T00:00:00.000Z", endDate: "2026-08-23T00:00:00.000Z" },
  ];
  const out = companyDayIntervalsFor("XL_106", cds);
  assert.equal(out.length, 2); // global + XL_106
  assert.deepEqual(out[0], { start: new Date("2026-08-18T00:00:00.000Z"), end: new Date("2026-08-19T00:00:00.000Z") });
});

test("snapGroupDeltaStartOnly: delta do pracovní doby se nemění", () => {
  const blocks = [{ machine: "XL_106", originalStart: pragueToUTC("2026-08-18", 8) }];
  const r = snapGroupDeltaStartOnly(blocks, 2 * 3600000, SHIFTS, []);
  assert.ok(r);
  assert.equal(r!.deltaMs, 2 * 3600000);
  assert.equal(r!.wasSnapped, false);
});

test("snapGroupDeltaStartOnly: start v odstávce → delta se zvedne na první runnable slot (start-only, délka nehraje roli)", () => {
  // Út 20:00 + delta 4 h = St 00:00? ne — Út má plný provoz; použij posun do soboty:
  // Pá 10:00 + delta 26 h = So 12:00 (odstávka) → snap na Ne 22:00 → delta se zvedne
  const blocks = [{ machine: "XL_106", originalStart: pragueToUTC("2026-08-21", 10) }];
  const r = snapGroupDeltaStartOnly(blocks, 26 * 3600000, SHIFTS, []);
  assert.ok(r);
  const snappedStart = new Date(pragueToUTC("2026-08-21", 10).getTime() + r!.deltaMs);
  assert.deepEqual(snappedStart, pragueToUTC("2026-08-23", 22));
  assert.equal(r!.wasSnapped, true);
});
```

- [ ] **Step 2: Run → FAIL** (`node --test --import tsx src/lib/printTimeClient.test.ts`)

- [ ] **Step 3: Implementace** — `src/lib/printTimeClient.ts`:

```typescript
import type { MachineWeekShiftsRow } from "@/lib/machineWeekShifts";
import { snapStartToNextRunnableSlot, type CompanyDayInterval } from "@/lib/printTime";

/**
 * Klient-safe helpery modelu tiskových hodin (žádná DB, žádný server import).
 * Mutační cesty klienta jimi připravují payload — end vždy autoritativně počítá server.
 */

/** Délka bloku v minutách pro payload: ZAKAZKA = printMinutes (fallback elapsed), jinak elapsed. */
export function blockPrintMinutes(b: {
  type: string;
  printMinutes?: number | null;
  startTime: string | Date;
  endTime: string | Date;
}): number {
  const elapsed = Math.round(
    (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000
  );
  if (b.type !== "ZAKAZKA") return elapsed;
  return b.printMinutes ?? elapsed;
}

/** Převod klientských CompanyDay záznamů na intervaly pro daný stroj (global + machine-specific). */
export function companyDayIntervalsFor(
  machine: string,
  companyDays: { machine?: string | null; startDate: string | Date; endDate: string | Date }[]
): CompanyDayInterval[] {
  return companyDays
    .filter((cd) => !cd.machine || cd.machine === machine)
    .map((cd) => ({ start: new Date(cd.startDate), end: new Date(cd.endDate) }));
}

/**
 * Skupinový snap deltas pro lasso přesun v modelu tiskových hodin: snapují se jen STARTY
 * (délku rozloží server expanzí). Nahrazuje duration-based snapGroupDeltaWithTemplates.
 * Vrací null, když některý start nejde v horizontu umístit — volající mutaci neodešle.
 */
export function snapGroupDeltaStartOnly(
  blocks: { machine: string; originalStart: Date }[],
  proposedDeltaMs: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: { machine?: string | null; startDate: string | Date; endDate: string | Date }[]
): { deltaMs: number; wasSnapped: boolean } | null {
  let delta = proposedDeltaMs;
  let wasSnapped = false;
  const intervalsByMachine = new Map<string, CompanyDayInterval[]>();
  for (const b of blocks) {
    if (!intervalsByMachine.has(b.machine)) {
      intervalsByMachine.set(b.machine, companyDayIntervalsFor(b.machine, companyDays));
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    let maxExtra = 0;
    for (const b of blocks) {
      const newStart = new Date(b.originalStart.getTime() + delta);
      const snapped = snapStartToNextRunnableSlot(
        b.machine, newStart, weekShifts, intervalsByMachine.get(b.machine)!
      );
      if (!snapped) return null;
      const extra = snapped.getTime() - newStart.getTime();
      if (extra > maxExtra) maxExtra = extra;
    }
    if (maxExtra === 0) break;
    delta += maxExtra;
    wasSnapped = true;
  }
  return { deltaMs: delta, wasSnapped };
}
```

- [ ] **Step 4: Dropdown 40 h** — `src/lib/plannerTypes.ts`, v definici `DURATION_OPTIONS` změnit `{ length: 48 }` na `{ length: 80 }` (80 × 30 min = 40 h). Nic jiného v souboru neměnit.

- [ ] **Step 5: Ověř** — testy 6/6 pass, `npx tsc --noEmit` 0 chyb.

---

### Task 2: TimelineGrid — drag/move + multi-move start-only

**Files:** Modify `src/app/_components/TimelineGrid.tsx`.

**Interfaces — Consumes:** helpery z Tasku 1; `snapStartToNextRunnableSlot` z printTime. **Produces:** PUT payload pro move BEZ `endTime`, s `printMinutes` (ZAKAZKA); batch updates se snapem startů.

- [ ] **Step 1: Typ Block** (řádek ~75) — doplnit pole:

```typescript
  printMinutes?: number | null;
  scheduleBypassed?: boolean;
```

(server je od etapy 2 v serializaci posílá; klientský typ je jen nedeklaroval).

- [ ] **Step 2: companyDaysRef** — vedle existujícího `machineWeekShiftsRef` (stejný pattern sync přes useEffect/přiřazení) zavést `companyDaysRef` s aktuální hodnotou prop `companyDays` (typ `CompanyDay[] | undefined`), aby byl dostupný v mouse handlerech vázaných na mount.

- [ ] **Step 3: Drag/move branch** (onMouseUp, ~ř. 2410–2435). Nahradit výpočet + request:

```typescript
// PŘED (princip): newStart = lock ? snapToNextValidStartWithTemplates(m, req, duration, ws) : raw;
//                 newEnd = newStart + duration; PUT { startTime, endTime, machine, bypass, resolveChain }

// PO:
const isZakazka = block.type === "ZAKAZKA";
let newStart = requestedStart;
if (workingTimeLockRef.current) {
  if (isZakazka) {
    const snapped = snapStartToNextRunnableSlot(
      newMachine,
      requestedStart,
      machineWeekShiftsRef.current ?? [],
      companyDayIntervalsFor(newMachine, companyDaysRef.current ?? [])
    );
    if (!snapped) {
      onError?.("V okolí není žádný pracovní slot — blok nelze umístit.");
      /* revert vizuálního stavu stejně jako u jiných selhání a return */
    }
    newStart = snapped;
  } else {
    newStart = snapToNextValidStartWithTemplates(newMachine, requestedStart, duration, machineWeekShiftsRef.current ?? []);
  }
}
const body: Record<string, unknown> = {
  startTime: newStart.toISOString(),
  machine: newMachine,
  bypassScheduleValidation: !workingTimeLockRef.current,
  resolveChain: true,
};
if (isZakazka) {
  body.printMinutes = blockPrintMinutes(block);   // end počítá server
} else {
  body.endTime = new Date(newStart.getTime() + duration).toISOString(); // ne-ZAKAZKA: server používá klientův end
}
```

Chybový kanál: použít stejný mechanismus, jakým handler dnes hlásí chyby (toast callback / onError prop — implementer najde v okolním kódu; pokud handler žádný nemá, použít tichý revert + `console.warn` NENÍ přípustný — najít existující toast cestu v PlannerPage přes callback prop). Optimistický lokální update endu: ponechat span (start+duration) do příchodu SSE/response — server vrátí skutečný end v odpovědi; pokud handler dnes aplikuje response data, zachovat.

- [ ] **Step 4: Multi-move branch** (~ř. 2455–2472):

```typescript
// PŘED: snapGroupDeltaWithTemplates(blocksOnNewMachine, deltaMs, ws)
// PO (jen když lock ON):
const zakazkaOnly = blocksOnNewMachine.every((b) => b.type === "ZAKAZKA");
if (zakazkaOnly) {
  const r = snapGroupDeltaStartOnly(
    blocksOnNewMachine.map((b) => ({ machine: b.machine, originalStart: b.originalStart })),
    deltaMs,
    machineWeekShiftsRef.current ?? [],
    (companyDaysRef.current ?? [])
  );
  if (!r) { /* error toast + revert, žádný request */ }
  deltaMs = r.deltaMs; wasSnapped = r.wasSnapped;
} else {
  // smíšený výběr: starý duration-based snap (ne-ZAKAZKA server nevaliduje)
  ({ deltaMs, wasSnapped } = snapGroupDeltaWithTemplates(blocksOnNewMachine, deltaMs, machineWeekShiftsRef.current ?? []));
}
```

`updates` pro `onMultiBlockUpdate` beze změny (id, machine, startTime, endTime = originál + delta) — batch API vyžaduje endTime jen jako sanity, ZAKAZKA end si přepočítá server (etapa 2). Pozn.: multi-move `blocksOnNewMachine` musí nést i `type` — pokud nemá, rozšířit lokální mapování.

- [ ] **Step 5: Ověř** — `npx tsc --noEmit` 0 chyb; `npm run build` OK. Resize branch NEZMĚNĚN (git diff to potvrdí).

---

### Task 3: PlannerPage — paste + group paste

**Files:** Modify `src/app/_components/PlannerPage.tsx` (handlePasteWithTarget ~2377, handleGroupPasteWithTarget ~2453).

- [ ] **Step 1: handlePasteWithTarget** — pro ZAKAZKA zdroj:

```typescript
const isZakazka = src.type === "ZAKAZKA";
const pm = blockPrintMinutes(src);
let newStart = rawStart;
if (workingTimeLockRef.current) {
  if (isZakazka) {
    const snapped = snapStartToNextRunnableSlot(
      target.machine, rawStart, machineWeekShifts, companyDayIntervalsFor(target.machine, companyDays)
    );
    if (!snapped) { showToast("V okolí není žádný pracovní slot — nelze vložit.", "error"); return; }
    newStart = snapped;
  } else {
    newStart = snapToNextValidStartWithTemplates(target.machine, rawStart, durationMs, machineWeekShifts);
  }
}
// body: startTime = newStart, endTime = naivní newStart+durationMs (fallback, server pro ZAKAZKA ignoruje)
// + printMinutes: pm jen pro ZAKAZKA
```

Do POST body přidat `...(isZakazka ? { printMinutes: pm } : {})`. Toast helper: použít existující toast mechanismus PlannerPage (showToast/addToast — implementer najde; existuje ToastContainer).

- [ ] **Step 2: handleGroupPasteWithTarget** — anchor snap: pro čistě ZAKAZKA skupinu `snapStartToNextRunnableSlot` s délkou nezávislým snapem (start-only); smíšená skupina → starý snap s anchorDuration. Per-blok body: `...(src.type === "ZAKAZKA" ? { printMinutes: blockPrintMinutes(src) } : {})`; offsety a naivní endy beze změny (mezistav #4).

- [ ] **Step 3: Ověř** — tsc 0, build OK.

---

### Task 4: PlannerPage — queue drop + série (oprava Gardeny)

**Files:** Modify `src/app/_components/PlannerPage.tsx` (handleQueueDrop ~2261, handleScheduleSeries ~2013).

- [ ] **Step 1: handleQueueDrop** — TOTO je cesta Gardeny:

```typescript
const pm = Math.round(item.durationHours * 60);
let startTime = rawStartTime;
if (workingTimeLockRef.current) {
  const snapped = snapStartToNextRunnableSlot(
    machine, rawStartTime, machineWeekShifts, companyDayIntervalsFor(machine, companyDays)
  );
  if (!snapped) { showToast("V okolí není žádný pracovní slot — nelze naplánovat.", "error"); return; }
  startTime = snapped;
}
// endTime = naivní startTime + durationMs (fallback); do body přidat printMinutes: pm
```

Queue drop vytváří vždy ZAKAZKA/REZERVACE — pro REZERVACE (reservation item) ponechat starý snap + bez printMinutes (server REZERVACE nevaliduje). Recurrence děti (řádky ~2340): do každého body také `printMinutes: pm` (stejná délka, jiný start).

- [ ] **Step 2: handleScheduleSeries** — do `baseBody` přidat `printMinutes: Math.round(durationHours * 60)` (jen když `type === "ZAKAZKA"`; série UDRZBA bez pm). Starty výskytů beze změny (server auto-shift = print finder od etapy 3). Preview (`generateSeriesPreview`) NEMĚNIT (mezistav #5).

- [ ] **Step 3: Ověř** — tsc 0, build OK.

---

### Task 5: BlockEdit — délka v tiskových hodinách

**Files:** Modify `src/components/BlockEdit.tsx`.

- [ ] **Step 1: currentDurationHours** (~ř. 116): pro ZAKAZKA odvozovat z `blockPrintMinutes(block)/60` (import helperu); jinak end−start. Tím select po etapě 3 nespadne na hodnotě mimo options u pauznutého bloku (elapsed 26 h ≠ option; printMinutes 10 h = option).

- [ ] **Step 2: buildPayload/doSave** (~ř. 553–613): pro ZAKAZKA nahradit `endTime: ...` polem `printMinutes: Math.round(durationHours * 60)` (server přepočítá end z uloženého startu — PUT větev explicitního pm z etapy 2). Pro ne-ZAKAZKA ponechat `endTime`. `resolveChain: true` zůstává.

- [ ] **Step 3: Série resolver** (`handleSaveSeriesOccurrences` ~ř. 311–411): do PUT body výskytů přidat `printMinutes: blockPrintMinutes(occurrenceBlock)`; `bypassScheduleValidation: true` PONECHAT (výskyty jsou deadline-driven, vědomě přesné datum; server od etapy 2 ukládá spočítanou konformitu, takže výskyt na konformním místě se bypass flagem neotráví).

- [ ] **Step 4: Ověř** — tsc 0, build OK; `node --test --import tsx src/lib/printTimeClient.test.ts` stále zelené.

---

### Task 6: Docs + finální verifikace etapy

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1:** Spustit celou suite (13 souborů vč. printTimeClient.test.ts), zapsat reálné počty do CLAUDE.md (test list + „Ověřený stav"; očekávaný总 122 = 116 + 6, ověř reálně).
- [ ] **Step 2:** CLAUDE.md — do sekce validace/klient doplnit: klientské mutační cesty posílají `printMinutes` (ZAKAZKA), start-only snap `snapStartToNextRunnableSlot` + `printTimeClient.ts` helpery; `DURATION_OPTIONS` max 40 h; resize klientsky nezměněn (server inverze); mezistavy preview → etapa 5. Přidat `src/lib/printTimeClient.ts` do Klíčových souborů.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint && npm run build` — 0 chyb / 0 errors / OK.

## Self-review (při psaní plánu)

- Spec 3.11 mutační cesty: drag (T2), resize (vědomě beze změny — server autoritativní od etapy 2, UX etapa 5), multi-move (T2), paste + group paste (T3), queue drop + série (T4), BlockEdit + série-resolver (T5), dropdown 40 h (T1). Queue drag preview/paste marker + vykreslení = etapa 5 (mezistavy 1–3).
- Typová konzistence: `blockPrintMinutes`/`companyDayIntervalsFor`/`snapGroupDeltaStartOnly` (T1) ↔ použití v T2–T5; klientský typ Block rozšířen v T2 (TimelineGrid je jeho domov).
- Čísla řádků jsou z Explore reportu po commitu 573f0a19 — implementeři hledají podle názvů funkcí, čísla jen orientační.
