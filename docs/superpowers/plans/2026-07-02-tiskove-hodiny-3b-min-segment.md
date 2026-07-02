# Tiskové hodiny — Plán 3b: Minimální segment pauzy (1 h)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. ŽÁDNÉ commity — commituje Vojta.

**Goal:** Automatika (chain push, auto-shift) smí blok rozdělit pauzou přes odstávku jen tehdy, když každý tiskový kus ≥ 1 h; jinak posune blok celý za odstávku. Ruční umístění pravidlu nepodléhá.

**Kontext:** Rozhodnutí Vojty 2. 7. po testu etapy 3 (screenshot: 4h blok odsunut chain pushem na 18:30 → kusy 3,5 h + 0,5 h přes noc — nežádoucí fragmentace). Spec aktualizován (tabulka rozhodnutí + 3.6 + 3.8).

## Global Constraints

- `MIN_PRINT_SEGMENT_MINUTES = 60`; pravidlo se aplikuje JEN když expanze obsahuje pauzu (souvislý blok bez pauzy nikdy neporušuje, ani 30min blok).
- Nouzová pojistka: bez vyhovující pozice v horizontu → fallback bez pravidla (pauza z nouze). Umístění NIKDY neselže kvůli pravidlu tam, kde dřív uspělo.
- Ruční cesty (`validateAndComputeEnd`, PUT/POST bez auto-shiftu) se NEMĚNÍ.
- Kandidát porušující pravidlo → přeskok na konec PRVNÍ pauzy expanze (zarovnaný ceil na SLOT_MS).
- Verifikace: `npx tsc --noEmit` 0 chyb + dotčené test soubory + `npm run build`.
- Žádné commity; klientský kód se nemění.

### Task 1: Pravidlo minimálního segmentu v placeAfter + findNextFreePrintSlot

**Files:**
- Modify: `src/lib/printTime.ts` (+ konstanta a helper), `src/lib/printTime.test.ts` (+3 testy)
- Modify: `src/lib/overlapResolver.ts` (placeAfter + fallback v computeChainPush), `src/lib/overlapResolver.test.ts` (+2 testy)
- Modify: `src/lib/scheduleSlotFinder.ts` (findNextFreePrintSlot), `src/lib/scheduleSlotFinder.test.ts` (+2 testy)
- Modify: `CLAUDE.md` (1 věta do validace odstavce + počty testů)

**Interfaces — Produces:**
- `MIN_PRINT_SEGMENT_MINUTES = 60` (printTime.ts)
- `violatesMinPrintSegment(segments: PrintSegment[], minMinutes?: number): boolean` — true jen když segments obsahují pauzu A některý print segment < min.

- [ ] **Step 1: Failing testy — helper** (printTime.test.ts, na konec; do importu přidat `violatesMinPrintSegment, MIN_PRINT_SEGMENT_MINUTES`):

```typescript
// ── violatesMinPrintSegment ──────────────────────────────────────────────────

test("minSegment: expanze bez pauzy neporušuje nikdy (i 30min blok)", () => {
  const start = pragueToUTC("2026-08-18", 10);
  const r = expandPrintTime("XL_106", start, 30, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(violatesMinPrintSegment(r.segments), false);
});

test("minSegment: 0,5h kus u pauzy → porušuje (scénář ze screenshotu)", () => {
  // Pá 21:30 + 4 h: 0,5 h do 22:00, pauza víkend, 3,5 h od Ne 22:00 → head 30 min < 60
  const start = pragueToUTC("2026-08-21", 21, 30);
  const r = expandPrintTime("XL_106", start, 240, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(violatesMinPrintSegment(r.segments), true);
});

test("minSegment: kusy 12h+15h (Gardena) → neporušuje", () => {
  const start = pragueToUTC("2026-08-21", 10);
  const r = expandPrintTime("XL_106", start, 27 * 60, SHIFTS, NO_CD);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(violatesMinPrintSegment(r.segments), false);
});
```

- [ ] **Step 2: Run → FAIL** (`node --test --import tsx src/lib/printTime.test.ts`)

- [ ] **Step 3: Implementace helperu** (printTime.ts, za `computePrintMinutes`):

```typescript
/** Minimální délka jednoho tiskového kusu při rozdělení bloku pauzou (rozhodnutí 2. 7. 2026). */
export const MIN_PRINT_SEGMENT_MINUTES = 60;

/**
 * True, když expanze obsahuje pauzu A některý tiskový segment je kratší než minimum.
 * Souvislá expanze (bez pauzy) neporušuje nikdy — pravidlo krotí jen dělení bloku.
 * Vynucuje se VÝHRADNĚ v automatice (chain push, auto-shift); ruční umístění
 * plánovačem pravidlu nepodléhá (validateAndComputeEnd helper nevolá).
 */
export function violatesMinPrintSegment(
  segments: PrintSegment[],
  minMinutes: number = MIN_PRINT_SEGMENT_MINUTES
): boolean {
  if (!segments.some((s) => s.kind === "pause")) return false;
  return segments.some(
    (s) => s.kind === "print" && s.end.getTime() - s.start.getTime() < minMinutes * 60000
  );
}
```

- [ ] **Step 4: Failing testy — chain push** (overlapResolver.test.ts, do víkendového describe):

```typescript
  it("MIN SEGMENT: odsunutý blok s 0,5h kusem se posune CELÝ za odstávku", () => {
    // Anchor končí Pá 21:30 → 4h blok by měl kusy 0,5+3,5 → pravidlo ho pošle celý na Ne 22:00.
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 10), endTime: new Date(P("2026-08-21", 21).getTime() + 30 * 60000) },
      [{ id: 2, startTime: P("2026-08-21", 12), endTime: P("2026-08-21", 16), locked: false, printMinutes: 240, scheduleBypassed: false }],
      SHIFTS,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.deepEqual(r.moves[0], { id: 2, startTime: P("2026-08-23", 22), endTime: P("2026-08-24", 2) });
    }
  });

  it("MIN SEGMENT nouzová pojistka: když se blok nevejde nikam bez porušení, pauza se povolí", () => {
    // Kalendář jen Pá 6–22 (16 h) v obou týdnech; 17h blok se nikam nevejde bez kusu < ... 
    // Pá1: 16 h + Pá2: 1 h → kusy 16+1 ≥ 1 h?? → zvol 16,5 h: Pá1 16 h + Pá2 0,5 h → každá pozice porušuje
    // → fallback umístí s pauzou (16 h + 0,5 h).
    const sparse = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => [
      mkDay(W1, d, d === 5 ? { m: true, a: true } : { active: false }),
      mkDay(W2, d, d === 5 ? { m: true, a: true } : { active: false }),
    ]);
    const r = computeChainPush(
      "XL_106",
      { id: 1, startTime: P("2026-08-21", 6), endTime: P("2026-08-21", 6) }, // nulový anchor jen jako kurzor... viz pozn.
      [{ id: 2, startTime: P("2026-08-21", 5, 30), endTime: P("2026-08-21", 6), locked: false, printMinutes: 990, scheduleBypassed: false }],
      sparse,
      NO_CD
    );
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.moves.length, 1);
      // start Pá1 06:00, end Pá2 06:30 (16 h Pá1 + 0,5 h Pá2)
      assert.deepEqual(r.moves[0]!.startTime, P("2026-08-21", 6));
      assert.deepEqual(r.moves[0]!.endTime, new Date(P("2026-08-28", 6).getTime() + 30 * 60000));
    }
  });
```

Pozn. k druhému testu: anchor s `startTime == endTime` nekoliduje s ničím half-open — pokud test kvůli tomu nespustí odsun bloku 2 (predikát `b.startTime < pEnd && b.endTime > anchorStart`), uprav fixture tak, aby anchor reálně překrýval blok 2 (např. anchor Pá 05:30–06:00 a blok 2 Pá 05:30–06:00 s pm 990); OČEKÁVANÉ CHOVÁNÍ (fallback umístí 990 min s pauzou a kusem 0,5 h) je závazné. Přesné časy ověř proti expandPrintTime a případně KOREKTNĚ uprav expectation s komentářem — ne implementaci.

- [ ] **Step 5: Implementace v placeAfter** (overlapResolver.ts):

`placeAfter` dostane parametr `minSegmentMinutes: number` (za `bypassed`). V non-bypass větvi po `if (!exp.ok) return null;` vlož:

```typescript
    if (violatesMinPrintSegment(exp.segments, minSegmentMinutes)) {
      // Kus pod minimem → blok se nedělí, přeskoč na konec první pauzy (celý za odstávku).
      const firstPause = exp.segments.find((s) => s.kind === "pause")!;
      cursorMs = Math.ceil(firstPause.end.getTime() / SLOT_MS) * SLOT_MS;
      continue;
    }
```

V `computeChainPush` volání s fallbackem (nahradí stávající `const pos = placeAfter(...)`):

```typescript
    // Nejdřív s pravidlem minimálního segmentu; když nevyjde, z nouze bez něj
    // (blok, který se bez porušení nevejde nikam, se radši pauzne než neumístí).
    const pos =
      placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, MIN_PRINT_SEGMENT_MINUTES) ??
      placeAfter(machine, pEnd, pm, next.scheduleBypassed, locked, weekShifts, companyDays, 0);
```

Import rozšířit o `violatesMinPrintSegment, MIN_PRINT_SEGMENT_MINUTES`. Bypass větev beze změny (bez pauz = pravidlo se netýká; helper s min 0 nic nedělá).

- [ ] **Step 6: Failing testy — slot finder** (scheduleSlotFinder.test.ts, do describe tiskových hodin):

```typescript
  it("MIN SEGMENT: kandidát s 0,5h kusem se přeskočí za pauzu", () => {
    // Pá 21:30 + 4 h → kusy 0,5+3,5 → start se posune na Ne 22:00 (souvislé 22–02).
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 21, 30), 240, [], SHIFTS_106, NO_CD);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-23", 22));
      assert.deepEqual(r.endTime, P("2026-08-24", 2));
      assert.equal(r.wasShifted, true);
    }
  });

  it("MIN SEGMENT: vyhovující dělení (kusy ≥ 1 h) se nechá pauznout", () => {
    // Pá 20:00 + 4 h → kusy 2+2 → zůstává na místě s pauzou.
    const r = findNextFreePrintSlot("XL_106", P("2026-08-21", 20), 240, [], SHIFTS_106, NO_CD);
    assert.equal(r.found, true);
    if (r.found) {
      assert.deepEqual(r.startTime, P("2026-08-21", 20));
      assert.deepEqual(r.endTime, P("2026-08-24", 0));
      assert.equal(r.wasShifted, false);
    }
  });
```

(`pragueToUTC` s minutami: `P("2026-08-21", 21, 30)` — signatura minuty podporuje.)

- [ ] **Step 7: Implementace ve findNextFreePrintSlot** (scheduleSlotFinder.ts):

Signatura dostane parametr `minSegmentMinutes: number = MIN_PRINT_SEGMENT_MINUTES` (POSLEDNÍ, za `maxShiftMs`). Po `if (!exp.ok) ...` vlož:

```typescript
    if (violatesMinPrintSegment(exp.segments, minSegmentMinutes)) {
      const firstPause = exp.segments.find((s) => s.kind === "pause")!;
      candidate = firstPause.end;
      continue;
    }
```

Na konec funkce (místo prostého `return { found: false, ... }` po smyčce) a do větve `if (!snapped)` fallback:

```typescript
// místo: return { found: false, reason: "MAX_SHIFT_EXCEEDED" };
// (obě fail místa — po vyčerpání smyčky i po null snapu):
      if (!snapped) {
        return minSegmentMinutes > 0
          ? findNextFreePrintSlot(machine, proposedStart, printMinutes, blockedIntervals, weekShifts, companyDays, maxShiftMs, 0)
          : { found: false, reason: "MAX_SHIFT_EXCEEDED" };
      }
```

a analogicky po vyčerpání MAX_ITERATIONS. Komentář: fallback z nouze — pravidlo nikdy nesmí způsobit selhání tam, kde by umístění bez něj uspělo. `findNextFreePrintSlotFromDb` beze změny (default parametr). Import rozšířit o helper + konstantu.

- [ ] **Step 8: CLAUDE.md** — do odstavce o chain pushi (sekce validace) doplnit větu:

```markdown
Automatika dělí blok pauzou jen když každý tiskový kus ≥ 1 h (`MIN_PRINT_SEGMENT_MINUTES`,
helper `violatesMinPrintSegment`); jinak blok posune celý za odstávku (fallback z nouze
pauzu povolí, když se blok nevejde nikam). Ruční umístění pravidlu nepodléhá.
```

Aktualizovat počty testů (printTime +3, overlapResolver +2, scheduleSlotFinder +2 → celkem 116) v test listu i „Ověřený stav".

- [ ] **Step 9: Verifikace**

Run: `node --test --import tsx src/lib/printTime.test.ts && node --test --import tsx src/lib/overlapResolver.test.ts && node --test --import tsx src/lib/scheduleSlotFinder.test.ts && node --test --import tsx src/lib/overlapResolver.server.test.ts`
Expected: 22 + 13 + 13 + 7, fail 0.
Run: `npx tsc --noEmit && npm run build`
Expected: 0 chyb, build OK.
