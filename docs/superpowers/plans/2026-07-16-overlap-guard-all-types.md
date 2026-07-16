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

- [ ] **Step 1: Rozšiř test helper `Row`/`row()` o `type` (JINAK rozbiješ stávající testy)**

Skutečný helper v `src/lib/overlapResolver.server.test.ts:8-28` je `Row` typ + `row(id, startH, endH, opts?)` (positional) a `mkTx(rows, companyDays)`. **Nemá pole `type`.** Až Step 4 změní mapping na `... || r.type !== "ZAKAZKA"`, řádky bez `type` (`undefined !== "ZAKAZKA"` → `true`) by se staly `locked:true` a rozbily by existující testy. Nejdřív přidej `type` s defaultem ZAKAZKA:
- do `Row` typu přidej `type: string;`
- do `row()` helperu přidej `type: opts.type ?? "ZAKAZKA",` (aby stávající volání dál reprezentovala ZAKAZKA).

- [ ] **Step 2: Napiš failing test (reálným helperem `mkTx`/`row`)**

Test ověří, že REZERVACE blok v cestě anchoru způsobí `OVERLAP` (ne posun rezervace):

```ts
test("resolveChainPushFromDb: anchor kolidující s REZERVACE blokem → OVERLAP (rezervace se neposouvá)", async () => {
  // row(id, startH, endH, opts) — pozor: positional signatura z tohoto souboru
  const tx = mkTx([row(20, 8, 10, { orderNumber: "REZ-1", type: "REZERVACE" })], []);
  const anchor = { id: 1, startTime: new Date("2026-08-01T08:30:00Z"), endTime: new Date("2026-08-01T09:30:00Z") };
  await assert.rejects(
    () => resolveChainPushFromDb(tx, "XL_105", anchor),
    (e: unknown) => isAppError(e) && e.code === "OVERLAP" && /rezervac|údržb/i.test(e.message)
  );
});
```

(Přizpůsob přesnou `row()` signaturu tomu, co je v souboru — čísla hodin vs. Date. Nevymýšlej `makeTxMock` — ten neexistuje.)

- [ ] **Step 3: Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/overlapResolver.server.test.ts`
Expected: FAIL (dnes se REZERVACE do `others` vůbec nenačte kvůli `type: "ZAKAZKA"` filtru, takže anchor „projde" a žádný OVERLAP se nehodí).

- [ ] **Step 4: Implementuj — rozšiř fetch a označ ne-ZAKAZKA jako zeď**

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

- [ ] **Step 5: Spusť test — musí projít**

Run: `node --test --import tsx src/lib/overlapResolver.server.test.ts`
Expected: PASS (všechny testy v souboru, vč. původních — díky `type` defaultu ZAKAZKA se nerozbily).

- [ ] **Step 6: Pure test do `overlapResolver.test.ts` (spec ř. 154 jmenuje tento soubor)**

`computeChainPush` se neměnil (R4 je celý v call-siteu), ale spec žádá coverage i tady. Přidej test, který dokáže, že pure funkce zvládá ne-ZAKAZKA jako zeď přes `locked` (tvar, který jí volající po R4 předá):

```ts
test("computeChainPush: locked obstacle (simulace ne-ZAKAZKA zdi) v cestě anchoru → LOCKED_CONFLICT", () => {
  const wall = { id: 20, startTime: new Date("2026-08-01T08:00:00Z"), endTime: new Date("2026-08-01T10:00:00Z"), locked: true, printMinutes: null, scheduleBypassed: false };
  const anchor = { id: 1, startTime: new Date("2026-08-01T08:30:00Z"), endTime: new Date("2026-08-01T09:30:00Z") };
  const res = computeChainPush("XL_105", anchor, [wall], [], []);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "LOCKED_CONFLICT");
});
```

Run: `node --test --import tsx src/lib/overlapResolver.test.ts` → PASS (vč. původních).

- [ ] **Step 7: Commit**

```bash
git add src/lib/overlapResolver.server.ts src/lib/overlapResolver.server.test.ts src/lib/overlapResolver.test.ts
git commit -m "feat(overlap): chain-push bere REZERVACE/UDRZBA jako pevnou překážku (R4) + testy"
```

---

## Task 2: R3 — reflow volá finální pojistku (opravuje i dnešní bug)

**Files:**
- Modify: `src/lib/reflow.server.ts` (import + volání po chain-pushi v `reflowBlockInTx`, ~ř. 141)
- Test: `src/lib/reflow.server.test.ts`

**Interfaces:**
- Consumes: `assertNoOverlapForBlocks(machine, blockIds, tx)` z `@/lib/overlapCheck`.
- Produces: `reflowBlockInTx` po chain-pushi ověří výsledek netem → překryv = throw + rollback. `reflowMachineInTx` to dědí (loopuje přes `reflowBlockInTx`).

- [ ] **Step 1: Rozšiř `mkTx` helper o `$queryRaw` + `block.findMany` (JINAK rozbiješ stávající testy)**

Skutečný `mkTx` v `src/lib/reflow.server.test.ts:50-68` staví `tx` **bez** `$queryRaw` a `tx.block` má jen `findUnique`/`update`. Jakmile Step 3 vloží `assertNoOverlapForBlocks` (volá `tx.block.findMany` na `overlapCheck.ts:84` a `tx.$queryRaw` na `:92`), spadnou i **stávající** happy-path testy („1)" ř. 76, „3)" ř. 193, obě jdou přes `changed:true`) na `TypeError`. Nejdřív do `mkTx` přidej:
- `tx.block.findMany: mock.fn(async () => [<blok(y) dotčené reflow>])` (vrací aspoň cílový blok se `startTime`/`endTime`/`id`/`orderNumber`),
- `tx.$queryRaw: mock.fn(async () => [])` (default happy-path = žádný konflikt; přepínatelný per-test).

- [ ] **Step 2: Napiš failing test (reálný `mkTx`, s důkazem že prošla write cesta)**

```ts
test("reflowBlockInTx: výsledek s překryvem → OVERLAP (finální net)", async () => {
  const tx = mkTx(driftedBlockFixture, /* kalendář jako v ostatních testech */);
  tx.$queryRaw = mock.fn(async () => [{ id: 99, orderNumber: "X" }]); // konfliktní řádek
  const deps = { resolveChainPush: mock.fn(async () => []), preloadedCalendar: /* jako jinde */ };
  await assert.rejects(
    () => reflowBlockInTx(tx, 1, actorFixture, deps),
    (e: unknown) => isAppError(e) && e.code === "OVERLAP"
  );
  // DŮKAZ, že se prošla reálná cesta write → chain push → net (ne crash dřív):
  assert.equal((tx.block.update as ReturnType<typeof mock.fn>).mock.calls.length, 1);
});
```

Pozn.: použij reálné názvy fixtur ze souboru (`mkTx(block, ...)` positional); `makeReflowTxMock` NEEXISTUJE. Assertce na `update` je klíčová — bez ní by test „prošel" i kdyby spadl dřív na chybějícím mocku a nedokazoval by záruku R3.

- [ ] **Step 3 (číslování): Spusť test — musí selhat**

Run: `node --test --import tsx src/lib/reflow.server.test.ts`
Expected: FAIL na `assert.rejects` („expected OVERLAP, none thrown") — dnes `reflowBlockInTx` net nevolá; `update` proběhne, ale žádný throw.

- [ ] **Step 4: Implementuj**

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

- [ ] **Step 5: Spusť testy — musí projít**

Run: `node --test --import tsx src/lib/reflow.server.test.ts`
Expected: PASS (vč. původních — po rozšíření `mkTx` v Step 1 `$queryRaw` vrací `[]`, takže happy-path testy prochází; `reflow.server.test.ts` pinuje i okno detekce driftu, nesmí se rozbít).

- [ ] **Step 6: Commit**

```bash
git add src/lib/reflow.server.ts src/lib/reflow.server.test.ts
git commit -m "fix(reflow): finální pojistka assertNoOverlapForBlocks po chain-pushi (R3, opravuje i dnešní ZAKAZKA bug)"
```

---

## Task 3: POST — finální net na všechny typy + REZERVACE self-shift

**Files:**
- Modify: `src/app/api/blocks/route.ts` (net gate ~349-353; REZERVACE self-shift větev uvnitř transakce)

**Interfaces:**
- Consumes: `assertNoOverlapForBlocks`, `findNextFreeSlotFromDb` (obojí už importováno v route.ts).
- Produces: POST uloží REZERVACE/UDRZBA jen když nekolidují (net běží vždy). **REZERVACE se navíc při kolizi auto-posune SEBE** (spec-tabulka), UDRZBA dostane tvrdé odmítnutí z netu.

**KRITICKÉ (nález red-teamu A):** jediná reálná cesta vzniku REZERVACE bloku je queue-drop
(`PlannerPage.tsx:1509-1516`), který posílá `resolveChain:true` **nepodmíněně** — proto
existující pre-check/self-shift větev (`route.ts:164`, `if (!bypassOverlapCheck && !resolveChain)`)
pro REZERVACI **nikdy neběží**. Bez samostatné self-shift větve by REZERVACE dostala tvrdé
odmítnutí (chování UDRZBA), ne posun. Proto níže přidáváme vlastní větev nezávislou na flagu.

- [ ] **Step 1: Přidej REZERVACE self-shift větev (nezávislou na `resolveChain`/`autoShiftIfBusy`)**

Uvnitř transakce, **PŘED `tx.block.create`** (za overlap pre-check blokem ~ř. 203, před `splitGroupId` guardem ~ř. 208), vlož:

```ts
      // REZERVACE: auto-posun SEBE na nejbližší volný slot — nezávisle na resolveChain/
      // autoShiftIfBusy (queue-drop je posílá tak, že existující pre-check větev neběží).
      // Duration-based (ne-ZAKAZKA nemá printMinutes); slot je jen kandidát, finální
      // assertNoOverlapForBlocks (níže) drží souběh.
      if (finalType === "REZERVACE" && !bypassOverlapCheck) {
        const conflict = await tx.block.findFirst({
          where: { machine: body.machine, startTime: { lt: endTime }, endTime: { gt: startTime } },
          select: { id: true },
        });
        if (conflict) {
          const slot = await findNextFreeSlotFromDb(body.machine, startTime, durationMs);
          if (!slot.found) {
            throw new AppError("OVERLAP", "Slot je obsazený a v horizontu není volno — vyber jiné místo.");
          }
          startTime = slot.startTime;
          endTime = slot.endTime;
          wasShifted = true;
          logger.info("[POST /api/blocks] REZERVACE self-shift", { machine: body.machine, newStart: startTime.toISOString() });
        }
      }
```

Ověř přesný tvar `findNextFreeSlotFromDb` návratu (`{ found, startTime, endTime }`) proti `scheduleSlotFinder.ts` a jeho signaturu (běží mimo `tx` — H1: kandidát, ne záruka).

- [ ] **Step 2: Rozšiř net gate na všechny typy**

Dnes (ř. ~349-352):

```ts
      // Finální pojistka — běží VŽDY pro ZAKAZKA (i bez resolveChain / s bypassOverlapCheck):
      if (finalType === "ZAKAZKA") {
        await assertNoOverlapForBlocks(body.machine, [newBlock.id, ...shiftedMoves.map((m) => m.id)], tx);
      }
```

Změň na (net pro všechny typy; `shiftedMoves` je prázdné pro ne-ZAKAZKA, chain-push ř. 328 zůstává `resolveChain && finalType === "ZAKAZKA"`):

```ts
      // Finální pojistka — běží VŽDY a pro VŠECHNY typy (i bez resolveChain / s bypassOverlapCheck):
      // žádný blok (zakázka/rezervace/údržba) nesmí skončit překrytý. Jediná záruka souběhu.
      await assertNoOverlapForBlocks(body.machine, [newBlock.id, ...shiftedMoves.map((m) => m.id)], tx);
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: 0 chyb.
Run: `npm run build`
Expected: projde.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/blocks/route.ts
git commit -m "feat(overlap): POST net na všechny typy + REZERVACE self-shift (R5/POST)"
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
      // Net běží při změně pozice/času/stroje NEBO změně typu jakýmkoliv směrem (spec R1):
      // ZAKAZKA↔ne-ZAKAZKA na legacy-kolidujícím místě jinak net přeskočí.
      const positionOrTypeChanged = timingChanged || typeChangesToZakazka || typeChangingAwayFromZakazka;
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

Pozn.: `positionOrTypeChanged` používá stávající proměnné (`timingChanged`, `typeChangesToZakazka`, `typeChangingAwayFromZakazka` — ověř, že všechny tři jsou deklarované PŘED tímto gate; `typeChangingAwayFromZakazka` je cca ř. 343-346, tedy nad ř. 521 — v scope. Kdyby ne, deklaraci posuň výš nebo derivuj inline z `allowed.type`/`oldBlock.type`). Net běží při změně pozice/času/stroje nebo typu jakýmkoliv směrem. Ne-ZAKAZKA update bez změny času net nespouští (nemůže vytvořit nový překryv).

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

**Rozhodnutí k REZERVACE self-shift v batchi (spec R5 „platí pro POST i batch"):** v batch/lasso
cestě se REZERVACE **NEauto-posouvá** — kolize = tvrdé odmítnutí z netu (jako UDRZBA). Důvod:
lasso je explicitní hromadný přesun; rozházet jednotlivé rezervace na různá volná místa by bylo
překvapivé. Self-shift dává smysl jen na cestě VZNIKU rezervace (single POST queue-drop, Task 3).
Toto je **vědomý known-gap**, ne opomenutí — implementer ho nesmí tiše „dodělat" ani ignorovat.

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

- [ ] **Step 1: Přidej pojmenovaný type-agnostic test do `overlapCheck.test.ts`**

`src/lib/overlapCheck.test.ts` **existuje** a `assertNoOverlapForBlocks` je už dnes type-agnostický (testy L63-131 jsou čistě ID-based, `$queryRaw` mock infra tam je) — žádné zjišťování stavu není potřeba. Přidej JEDEN explicitní pojmenovaný case s fixture blokem, jehož „soused" je jiného typu (mock `$queryRaw` vrátí konfliktní řádek), který zafixuje invariant „net chytí překryv bez ohledu na typ" proti budoucí regresi. (Funkce typ nezná — test to jen pojmenuje a zamkne.)

- [ ] **Step 2: Plná kontrola**

Run: `npx tsc --noEmit` → 0 chyb.
Run: `npm run build` → projde.
Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts` → vše zelené.

- [ ] **Step 3: Dev-DB důkaz (reprodukce oprav)**

Na dev DB v UI ověř:
1. PUT UDRZBA na obsazený slot (i s bypass) → 409, ne commit (R1).
2. PUT ZAKAZKA→UDRZBA beze změny pozice na legacy-kolidujícím místě → OVERLAP (R1, `typeChangingAwayFromZakazka`).
3. Lasso batch 2× UDRZBA na sebe → OVERLAP (R2).
4. Reflow bloku, jehož výsledek by kolidoval → rollback (R3).
5. ZAKAZKA drag, jehož chain-push by narazil na rezervaci → čistá hláška „koliduje s rezervací" (R4).
6. **REZERVACE z fronty (queue-drop) na obsazený slot → auto-posune SE na volno** (ne odmítnutí) — přímý důkaz R5 self-shift na hlavní produkční cestě.
7. REZERVACE v lasso batchi na obsazený slot → OVERLAP odmítnutí (vědomý known-gap, batch self-shift není).

- [ ] **Step 4: Dokumentace**

Do `docs/vyvoj-historie.md` (sekce changelog) přidej řádek o featuře (datum, 5 cest, spec/plán odkazy). Do `CLAUDE.md` u zmínky o overlap ochraně uveď, že platí pro všechny typy.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/vyvoj-historie.md src/lib/overlapCheck.test.ts
git commit -m "docs+test: overlap guard na všechny typy — dokumentace + type-agnostic test (R-final)"
```

---

## Self-Review (proti specu)

**Spec coverage:** R1→Task 4 ✓ · R2→Task 5 ✓ · R3→Task 2 ✓ · R4→Task 1 ✓ · R5(POST net + REZERVACE self-shift)→Task 3 **vlastní self-shift větev** (NE „existující pre-check větev" — ta pro reálnou queue-drop cestu neběží kvůli `resolveChain:true`; batch self-shift = vědomý known-gap, Task 5) ✓ · R6→Task 6 ✓ · H1(slot-finder=kandidát)→Global Constraints + Task 3 pozn. ✓ · H2(net-vstup vlastní ID)→Task 1/2 testy + Task 7 ✓.

**Pořadí:** R4 (Task 1) první — než net začne běžet pro všechny typy, chain-push musí ne-ZAKAZKA vidět jako zeď (jinak ZAKAZKA drag skončí rollbackem místo čisté hlášky). Zbytek nezávislý.

**Type consistency:** `assertNoOverlapForBlocks(machine, number[], tx)` shodně napříč Tasky 2–6. `resolveChainPushFromDb` signatura beze změny (Task 1 mění jen vnitřek). `BlockInterval.locked` nese nově i „ne-ZAKAZKA" sémantiku (Task 1) — `computeChainPush` beze změny.

**H2 — poctivě:** skutečnou FOR-UPDATE serializaci dvou SOUBĚŽNÝCH transakcí `mock.fn` testy NEsimulují (single-threaded, canned response). H2 „concurrency test" tedy NEodškrtávám jako splněné — je to **známá limitace test-infry**; skutečná záruka souběhu (trailing `assertNoOverlapForBlocks` FOR UPDATE) je pre-existující a plánem nedotčená. Doporučení pro budoucí práci: integrační test proti reálné dev DB se 2 paralelními spojeními.

**Vědomý known-gap:** route handlery nemají unit test harness → R1/R2/R6 gate změny kryté typecheck/build + lib testy (Task 1,2) + dev-DB (Task 7) + finální adversariální review. Není to vynechání testu — je to absence route test infra (konzistentní s předchozími featurami projektu). Should-fix F (extrakce gate-logiky do čistých funkcí + jejich unit testy) je zaznamenaný jako možné zpevnění, ale neblokuje záruku.
