# Overlap guard na všechny typy bloků — Implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Žádný blok jakéhokoliv typu (ZAKAZKA/REZERVACE/UDRZBA) nejde uložit tak, aby se časově překrýval s jiným blokem na stejném stroji — na žádné z 5 zápisových cest, bez ohledu na klientské flagy.

**Architecture:** `assertNoOverlapForBlocks` a `checkBlockOverlap` už dnes typ nefiltrují — gating je v call-siteech. Práce = (a) na každé z 5 cest (POST/PUT/batch/split/reflow) zajistit, že finální net `assertNoOverlapForBlocks` běží pro VŠECHNY typy a dostane vlastní ID bloku + ID posunutých; (b) chain-push (ZAKAZKA-only) naučit vnímat ne-ZAKAZKA bloky jako pevnou překážku, aby ZAKAZKA anchor neskončil na rezervaci/údržbě.

**Tech Stack:** Next.js 16 route handlers, Prisma 5 (MySQL, `$transaction` + `$queryRaw ... FOR UPDATE`), node:test + tsx, `@/lib/errors` AppError.

## Global Constraints

- **Tvrdá záruka, žádná zadní vrátka:** net je nepřekročitelný, žádný „force overlap" flag.
- **Chování při kolizi dle typu:** ZAKAZKA = beze změny (auto-shift z fronty, chain-push). REZERVACE = auto-posune SEBE na nejbližší volný slot (duration-based `findNextFreeSlotFromDb`), neposouvá cizí. UDRZBA = tvrdé odmítnutí `AppError("OVERLAP", "Slot je obsazený, vyber jiné místo.")`, neposouvá nic.
- **5 zápisových cest (úplný výčet):** POST `/api/blocks`, PUT `/api/blocks/[id]`, POST `/api/blocks/batch`, POST `/api/blocks/[id]/split`, `reflowBlockInTx`/`reflowMachineInTx` (`src/lib/reflow.server.ts`). Reservation routes ani `complete` bloky netvoří/neposouvají.
- **Jediná záruka souběhu je trailing `assertNoOverlapForBlocks`** (FOR UPDATE); `findNextFreeSlotFromDb`/`findNextFreePrintSlotFromDb` běží mimo tx = jen kandidát.
- **Chyby přes `AppError`/`isAppError`**, logování přes `logger`, mutace + audit v `$transaction` (coding standards projektu).
- **Bez DB migrace, bez změny schématu.** Práce jen na větvi Vojta, commit po každém tasku.
- **Test realita:** projekt testuje čisté/serverové funkce v `src/lib/*.test.ts` (node:test, mock tx přes `overlapResolver.server.test.ts` vzor). Route handlery nemají unit test harness — jejich gate změny se ověřují `npx tsc --noEmit` + `npm run build` + dev-DB důkaz + finální adversariální review.

---

## File Structure

| Soubor | Změna |
| --- | --- |
| `src/lib/overlapResolver.server.ts` | R4 — `others` fetch všechny typy; ne-ZAKAZKA → `locked:true`; typová hláška |
| `src/lib/overlapResolver.server.test.ts` | R4 — testy: ne-ZAKAZKA jako pevná zeď, anchor na rezervaci → OVERLAP |
| `src/lib/reflow.server.ts` | R3 — `assertNoOverlapForBlocks` po chain-pushi v `reflowBlockInTx` |
| `src/lib/reflow.server.test.ts` | R3 — test: reflow končící překryvem → throw/rollback |
| `src/app/api/blocks/route.ts` | POST — net (`:351`) na všechny typy |
| `src/app/api/blocks/[id]/route.ts` | R1 — gate (`:521`) net na všechny typy, chain-push zůstává ZAKAZKA |
| `src/app/api/blocks/batch/route.ts` | R2 — `checkByMachine` + intra-check ze všech `updates` |
| `src/app/api/blocks/[id]/split/route.ts` | R6 — net (`:167`) na všechny typy |
| `CLAUDE.md`, `docs/vyvoj-historie.md` | Task 7 — dokumentace |

---

## Task 1: R4 — chain-push vidí ne-ZAKAZKA jako pevnou překážku

**Files:**
- Modify: `src/lib/overlapResolver.server.ts:56-105` (others fetch + mapping + error message)
- Test: `src/lib/overlapResolver.server.test.ts`

**Interfaces:**
- Consumes: `computeChainPush` (beze změny — už umí `locked` bloky jako zeď), `AppError`.
- Produces: `resolveChainPushFromDb` po změně bere v potaz bloky VŠECH typů; ne-ZAKAZKA jsou `locked` (neposouvají se, anchor/chain na ně narazí → `AppError("OVERLAP")` s hláškou dle typu).

**Proč první:** až net začne běžet pro všechny typy (Task 3–6), ZAKAZKA chain-push nesmí odsunout souseda NA rezervaci/údržbu (dnes je „nevidí"). Tohle je základ, na kterém stojí správné chování ostatních cest.

- [ ] **Step 1: Napiš failing test**

Přidej do `src/lib/overlapResolver.server.test.ts` (drž vzor existujících testů — `mock.fn` transakce vracející řádky). Test ověří, že REZERVACE blok v cestě anchoru způsobí `OVERLAP` (ne posun rezervace):

```ts
test("resolveChainPushFromDb: anchor kolidující s REZERVACE blokem → OVERLAP (rezervace se neposouvá)", async () => {
  const rez = { id: 20, orderNumber: "REZ-1", startTime: new Date("2026-08-01T08:00:00Z"), endTime: new Date("2026-08-01T10:00:00Z"), locked: false, printCompletedAt: null, printMinutes: null, scheduleBypassed: false, type: "REZERVACE" };
  const tx = makeTxMock({ blocks: [rez], weekShifts: [], companyDays: [] }); // helper jako v ostatních testech
  const anchor = { id: 1, startTime: new Date("2026-08-01T08:30:00Z"), endTime: new Date("2026-08-01T09:30:00Z") };
  await assert.rejects(
    () => resolveChainPushFromDb(tx, "XL_105", anchor),
    (e: unknown) => isAppError(e) && e.code === "OVERLAP" && /rezervac|údržb/i.test(e.message)
  );
});
```

Pozn.: pokud v souboru není `makeTxMock`/ekvivalent, replikuj tvar `tx.block.findMany`/`machineWeekShifts.findMany`/`companyDay.findMany` mocků z nejbližšího existujícího testu ve stejném souboru — nekopíruj cizí signatury.

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/overlapResolver.server.test.ts`
Expected: FAIL (dnes se REZERVACE do `others` vůbec nenačte kvůli `type: "ZAKAZKA"` filtru, takže anchor „projde" a žádný OVERLAP se nehodí).

- [ ] **Step 3: Implementuj — rozšiř fetch a označ ne-ZAKAZKA jako zeď**

V `src/lib/overlapResolver.server.ts` v `tx.block.findMany` (řádky 57-76) **odstraň** `type: "ZAKAZKA",` z `where` a **přidej** `type: true,` do `select`. Pak v mapování `others` (řádky 96-105) změň `locked`:

```ts
  const others: BlockInterval[] = rows.map((r) => ({
    id: r.id,
    startTime: r.startTime,
    endTime: r.endTime,
    // Vytištěné bloky se chovají jako zamčené. Ne-ZAKAZKA (REZERVACE/UDRZBA) jsou pro
    // ZAKAZKA chain-push PEVNÁ PŘEKÁŽKA — nikdy se neposouvají (jen ZAKAZKA se odsouvá).
    locked: r.locked || r.printCompletedAt != null || r.type !== "ZAKAZKA",
    printMinutes: r.printMinutes,
    scheduleBypassed: r.scheduleBypassed,
  }));
```

A v LOCKED_CONFLICT větvi (řádky 110-117) rozliš hlášku podle typu viníka (přidej `type: true` je už v selectu, rowById ho nese):

```ts
    if (result.reason === "LOCKED_CONFLICT") {
      const l = rowById.get(result.lockedId);
      const kind = l && l.type !== "ZAKAZKA"
        ? (l.type === "REZERVACE" ? "rezervací" : "údržbou")
        : `zamčeným blokem #${l?.orderNumber ?? result.lockedId}`;
      throw new AppError(
        "OVERLAP",
        `Nelze uvolnit místo — koliduje s ${kind}. Vyber jiné místo.`
      );
    }
```

(Přidej `type: true` do `select` u `tx.block.findMany` — bez něj `l.type` neexistuje.)

- [ ] **Step 4: Spusť test — musí projít**

Run: `node --test --import tsx src/lib/overlapResolver.server.test.ts`
Expected: PASS (všechny testy v souboru, vč. původních).

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlapResolver.server.ts src/lib/overlapResolver.server.test.ts
git commit -m "feat(overlap): chain-push bere REZERVACE/UDRZBA jako pevnou překážku (R4)"
```

---

## Task 2: R3 — reflow volá finální pojistku (opravuje i dnešní bug)

**Files:**
- Modify: `src/lib/reflow.server.ts` (import + volání po chain-pushi v `reflowBlockInTx`, ~ř. 141)
- Test: `src/lib/reflow.server.test.ts`

**Interfaces:**
- Consumes: `assertNoOverlapForBlocks(machine, blockIds, tx)` z `@/lib/overlapCheck`.
- Produces: `reflowBlockInTx` po chain-pushi ověří výsledek netem → překryv = throw + rollback. `reflowMachineInTx` to dědí (loopuje přes `reflowBlockInTx`).

- [ ] **Step 1: Napiš failing test**

V `src/lib/reflow.server.test.ts` přidej test, který ověří, že když by reflow (re-expanze + chain push) skončil překryvem, `reflowBlockInTx` hodí `OVERLAP`. Injektuj `deps.resolveChainPush` mock, který vrátí `[]` (žádný posun) na scénáři, kde re-expandovaný blok koliduje s existujícím — a `tx` mock, jehož `$queryRaw` (uvnitř `assertNoOverlapForBlocks`) vrátí konfliktní řádek:

```ts
test("reflowBlockInTx: výsledek s překryvem → OVERLAP (finální net)", async () => {
  const tx = makeReflowTxMock({ /* blok #1 re-expanduje na 08:00–10:00, existující #2 08:30–09:00 */ });
  const deps = { resolveChainPush: async () => [], preloadedCalendar: /* … */ };
  await assert.rejects(
    () => reflowBlockInTx(tx, 1, actorFixture, deps),
    (e: unknown) => isAppError(e) && e.code === "OVERLAP"
  );
});
```

Pozn.: replikuj tvar tx/deps mocků z existujících testů v `reflow.server.test.ts` (soubor už mockuje kalendář i `resolveChainPush`) — jen dodej, aby `tx.$queryRaw` vrátil 1 konfliktní řádek pro cílový blok.

- [ ] **Step 2: Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/reflow.server.test.ts`
Expected: FAIL („expected OVERLAP, none thrown") — dnes `reflowBlockInTx` net nevolá.

- [ ] **Step 3: Implementuj**

V `src/lib/reflow.server.ts` přidej import (vedle stávajícího `resolveChainPushFromDb` importu):

```ts
import { assertNoOverlapForBlocks } from "@/lib/overlapCheck";
```

V `reflowBlockInTx` hned ZA řádkem, kde se volá chain push (`const moves = await deps.resolveChainPush(...)`, ~ř. 141), přidej finální pojistku:

```ts
  // Finální tvrdá pojistka — reflow (re-expanze + chain push) nesmí skončit překryvem.
  // Parita s POST/PUT/batch/split; jediná záruka souběhu v této transakci.
  await assertNoOverlapForBlocks(block.machine, [blockId, ...moves.map((m) => m.id)], tx);
```

(Ověř přesný název proměnné bloku/stroje v okolí — v souboru je `block.machine`; pokud se liší, použij lokální název.)

- [ ] **Step 4: Spusť testy — musí projít**

Run: `node --test --import tsx src/lib/reflow.server.test.ts`
Expected: PASS (vč. původních — `reflow.server.test.ts` pinuje okno detekce driftu, nesmí se rozbít).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reflow.server.ts src/lib/reflow.server.test.ts
git commit -m "fix(reflow): finální pojistka assertNoOverlapForBlocks po chain-pushi (R3, opravuje i dnešní ZAKAZKA bug)"
```

---

## Task 3: POST — finální net na všechny typy

**Files:**
- Modify: `src/app/api/blocks/route.ts:349-353` (net gate)

**Interfaces:**
- Consumes: `assertNoOverlapForBlocks` (už importováno). REZERVACE auto-shift-self využívá existující pre-check větev (`findNextFreeSlotFromDb`, ř. 175) — beze změny.
- Produces: POST uloží REZERVACE/UDRZBA jen když nekolidují (net běží vždy).

- [ ] **Step 1: Rozšiř net gate**

V `src/app/api/blocks/route.ts` je dnes (ř. ~349-352):

```ts
      // Finální pojistka — běží VŽDY pro ZAKAZKA (i bez resolveChain / s bypassOverlapCheck):
      if (finalType === "ZAKAZKA") {
        await assertNoOverlapForBlocks(body.machine, [newBlock.id, ...shiftedMoves.map((m) => m.id)], tx);
      }
```

Změň na (net pro všechny typy; `shiftedMoves` je prázdné pro ne-ZAKAZKA, protože chain-push na ř. 328 zůstává `resolveChain && finalType === "ZAKAZKA"`):

```ts
      // Finální pojistka — běží VŽDY a pro VŠECHNY typy (i bez resolveChain / s bypassOverlapCheck):
      // žádný blok (zakázka/rezervace/údržba) nesmí skončit překrytý. Jediná záruka souběhu.
      await assertNoOverlapForBlocks(body.machine, [newBlock.id, ...shiftedMoves.map((m) => m.id)], tx);
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.
Run: `npm run build`
Expected: projde.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/blocks/route.ts
git commit -m "feat(overlap): POST net běží pro všechny typy bloků (R5/POST)"
```

---

## Task 4: R1 — PUT gate rozšířit na všechny typy

**Files:**
- Modify: `src/app/api/blocks/[id]/route.ts:518-545` (gate okolo chain-push + net)

**Interfaces:**
- Consumes: `resolveChainPushFromDb` (ZAKAZKA-only), `assertNoOverlapForBlocks` (všechny typy). Proměnné `resultingType`, `timingChanged`, `typeChangesToZakazka` už v scope existují.
- Produces: PUT ověří překryv pro REZERVACE/UDRZBA při každé změně pozice/délky/stroje.

- [ ] **Step 1: Odděl chain-push (ZAKAZKA) od netu (všechny typy)**

Dnes (`src/app/api/blocks/[id]/route.ts:521-545`) je vše pod `if (resultingType === "ZAKAZKA" && (timingChanged || typeChangesToZakazka))`. Změň strukturu tak, aby **chain-push zůstal ZAKAZKA-only**, ale **net běžel pro všechny typy při změně času/stroje**:

```ts
      // ── Chain push (jen ZAKAZKA) + tvrdá pojistka (všechny typy) ──
      let shiftedMoves: AppliedMove[] = [];
      const positionOrTypeChanged = timingChanged || typeChangesToZakazka;
      if (positionOrTypeChanged) {
        if (resultingType === "ZAKAZKA" && resolveChain) {
          shiftedMoves = await resolveChainPushFromDb(
            tx,
            updated.machine,
            { id: updated.id, startTime: updated.startTime, endTime: updated.endTime }
          );
          if (shiftedMoves.length > 0) {
            await tx.auditLog.createMany({
              data: shiftedMoves.map((m) => ({
                blockId: m.id,
                orderNumber: m.orderNumber,
                userId: session.id,
                username: session.username,
                action: "AUTO_SHIFT",
                field: "startTime/endTime",
                oldValue: `${m.oldStartTime.toISOString()}–${m.oldEndTime.toISOString()}`,
                newValue: `${m.startTime.toISOString()}–${m.endTime.toISOString()}`,
              })),
            });
          }
        }
        // Finální pojistka — VŠECHNY typy (i bez resolveChain, i s bypassOverlapCheck).
        await assertNoOverlapForBlocks(updated.machine, [updated.id, ...shiftedMoves.map((m) => m.id)], tx);
      }
```

Pozn.: `positionOrTypeChanged` používá stávající proměnné; net běží kdykoliv se změnila pozice/čas/stroj (`timingChanged`) nebo typ na ZAKAZKA. Ne-ZAKAZKA update bez změny času net nespouští (nemůže vytvořit nový překryv).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.
Run: `npm run build`
Expected: projde.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/blocks/[id]/route.ts"
git commit -m "feat(overlap): PUT net na všechny typy, chain-push zůstává ZAKAZKA (R1)"
```

---

## Task 5: R2 — batch net-vstup + intra-check ze všech updates

**Files:**
- Modify: `src/app/api/blocks/batch/route.ts` (intra-check ~119-134 přesun/rozšíření; checkByMachine ~169-174)

**Interfaces:**
- Consumes: `findIntraBatchOverlap(spans)`, `assertNoOverlapForBlocks`, `checkByMachine`.
- Produces: každý přesunutý blok (i REZERVACE/UDRZBA) je v `checkByMachine` a v intra-batch pre-checku.

- [ ] **Step 1: Intra-batch pre-check přes VŠECHNY updates**

Dnes `findIntraBatchOverlap` (ř. 119-133) běží uvnitř `if (zakazkaUpdates.length > 0)` a jen nad `zakazkaUpdates`. Přesuň ho VEN z toho bloku (aby běžel vždy) a krmí ho **všemi** `updates` s per-blok endem (`computedEnds` pro ZAKAZKA, klientův `endTime` pro ostatní):

```ts
      // Intra-group pre-check přes VŠECHNY přesunuté bloky (i REZERVACE/UDRZBA):
      // dva ne-ZAKAZKA bloky v jednom lasso by jinak mohly přistát na sebe.
      const intraPair = findIntraBatchOverlap(
        updates.map((u) => ({
          id: u.id,
          orderNumber: existingBlocks.find((b) => b.id === u.id)?.orderNumber ?? null,
          machine: u.machine,
          start: new Date(u.startTime),
          end: computedEnds.get(u.id)?.end ?? new Date(u.endTime),
        }))
      );
      if (intraPair) {
        throw new AppError(
          "OVERLAP",
          `Bloky #${intraPair[0].orderNumber ?? intraPair[0].id} a #${intraPair[1].orderNumber ?? intraPair[1].id} se překrývají mezi sebou — přesuň je jednotlivě nebo zvol jiné místo.`
        );
      }
```

Odstraň starý `findIntraBatchOverlap` blok uvnitř `if (zakazkaUpdates.length > 0)` (ř. 116-133), aby se kontrola neduplikovala. (`computedEnds` je naplněné jen pro ZAKAZKA — pro ostatní `?? new Date(u.endTime)` dá klientův duration-based end, což je pro ne-ZAKAZKA autoritativní.)

- [ ] **Step 2: checkByMachine ze všech updates**

Změň (ř. 169-174) iteraci ze `zakazkaUpdates` na `updates`:

```ts
      // Bloky ke kontrole překryvu, per stroj — VŠECHNY přesunuté (i REZERVACE/UDRZBA) + posunuté chain-pushem.
      const checkByMachine = new Map<string, number[]>();
      for (const u of updates) {
        const arr = checkByMachine.get(u.machine) ?? [];
        arr.push(u.id);
        checkByMachine.set(u.machine, arr);
      }
```

Chain-push blok (ř. 179-212) zůstává `if (resolveChain && zakazkaUpdates.length > 0)` — jen ZAKAZKA se chain-pushuje; posunuté ID se do `checkByMachine` přidávají jako dnes. Finální net smyčka (ř. 216-218) beze změny — teď dostane i ne-ZAKAZKA ID.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.
Run: `npm run build`
Expected: projde.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/blocks/batch/route.ts
git commit -m "feat(overlap): batch net-vstup + intra-check ze všech typů (R2)"
```

---

## Task 6: R6 — split net na všechny typy

**Files:**
- Modify: `src/app/api/blocks/[id]/split/route.ts:167-189` (net gate)

**Interfaces:**
- Consumes: `assertNoOverlapForBlocks`. Chain-push ve splitu zůstává ZAKAZKA-only.
- Produces: split ne-ZAKAZKA bloku (head+tail) ověří net.

- [ ] **Step 1: Rozšiř net na ne-ZAKAZKA**

Dnes (`src/app/api/blocks/[id]/split/route.ts:167-189`) je chain-push **i** `assertNoOverlapForBlocks` pod `if (block.type === "ZAKAZKA")`. Odděl: chain-push zůstane ZAKAZKA-only, net běží pro všechny typy:

```ts
      let shiftedMoves: AppliedMove[] = [];
      if (block.type === "ZAKAZKA") {
        // chain push (existující obsah bloku, ř. ~168-186) — beze změny
        …
      }
      // Finální tvrdá pojistka — VŠECHNY typy: head, tail ani posunutí nesmí skončit překryté.
      await assertNoOverlapForBlocks(block.machine, [headUpdated.id, tailCreated.id, ...shiftedMoves.map((m) => m.id)], tx);
```

Přesně: **vyjmi** volání `assertNoOverlapForBlocks` (ř. 188) z bloku `if (block.type === "ZAKAZKA")` a dej ho ZA něj (nepodmíněně). Deklaraci `let shiftedMoves` posuň před `if`, aby byla dostupná i pro net u ne-ZAKAZKA (kde zůstane `[]`).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.
Run: `npm run build`
Expected: projde.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/blocks/[id]/split/route.ts"
git commit -m "feat(overlap): split net na všechny typy (R6)"
```

---

## Task 7: Integrační ověření + concurrency test sweep + dokumentace

**Files:**
- Modify: `CLAUDE.md`, `docs/vyvoj-historie.md`
- Test: `src/lib/overlapCheck.test.ts` (doplnit type-agnostic case, pokud chybí)

- [ ] **Step 1: Doplň unit test type-agnosticismu netu**

Pokud `src/lib/overlapCheck.test.ts` neexistuje nebo nekryje ne-ZAKAZKA, přidej test, že `assertNoOverlapForBlocks` chytí překryv bez ohledu na typ (funkce typ nezná — test to zafixuje proti budoucí regresi). Pokud test infra pro `$queryRaw` v souboru není, dokumentuj to jako known-gap a spolehni na `overlapResolver.server.test.ts` + dev-DB.

- [ ] **Step 2: Plná kontrola**

Run: `npx tsc --noEmit` → 0 chyb.
Run: `npm run build` → projde.
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` → vše zelené.

- [ ] **Step 3: Dev-DB důkaz (reprodukce oprav)**

Na dev DB v UI ověř, že server ODMÍTNE:
1. PUT UDRZBA na obsazený slot (i s bypass) → 409, ne commit (R1).
2. Lasso batch 2× UDRZBA na sebe → OVERLAP (R2).
3. Reflow bloku, jehož výsledek by kolidoval → rollback (R3).
4. ZAKAZKA drag, jehož chain-push by narazil na rezervaci → čistá hláška „koliduje s rezervací" (R4).

- [ ] **Step 4: Dokumentace**

Do `docs/vyvoj-historie.md` (sekce changelog) přidej řádek o featuře (datum, 5 cest, spec/plán odkazy). Do `CLAUDE.md` u zmínky o overlap ochraně uveď, že platí pro všechny typy.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/vyvoj-historie.md src/lib/overlapCheck.test.ts
git commit -m "docs+test: overlap guard na všechny typy — dokumentace + type-agnostic test (R-final)"
```

---

## Self-Review (proti specu)

**Spec coverage:** R1→Task 4 ✓ · R2→Task 5 ✓ · R3→Task 2 ✓ · R4→Task 1 ✓ · R5(POST net + REZERVACE self-shift)→Task 3 (net) + existující pre-check větev findNextFreeSlot ✓ · R6→Task 6 ✓ · H1(slot-finder=kandidát)→Global Constraints + Task 3 pozn. ✓ · H2(net-vstup vlastní ID, concurrency test)→Task 1/2 testy + Task 7 sweep ✓.

**Pořadí:** R4 (Task 1) první — než net začne běžet pro všechny typy, chain-push musí ne-ZAKAZKA vidět jako zeď (jinak ZAKAZKA drag skončí rollbackem místo čisté hlášky). Zbytek nezávislý.

**Type consistency:** `assertNoOverlapForBlocks(machine, number[], tx)` shodně napříč Tasky 2–6. `resolveChainPushFromDb` signatura beze změny (Task 1 mění jen vnitřek). `BlockInterval.locked` nese nově i „ne-ZAKAZKA" sémantiku (Task 1) — `computeChainPush` beze změny.

**Vědomý known-gap:** route handlery nemají unit test harness → R1/R2/R3(net)/R6 gate změny kryté typecheck/build + lib concurrency testy (Task 1,2) + dev-DB (Task 7) + finální adversariální review. Není to vynechání testu — je to absence route test infra (konzistentní s předchozími featurami projektu).
