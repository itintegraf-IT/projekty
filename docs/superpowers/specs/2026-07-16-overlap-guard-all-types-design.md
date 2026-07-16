# Overlap guard na všechny typy bloků — Design

**Datum:** 2026-07-16
**Autor:** Vojta + Claude
**Stav:** Schváleno k plánu (v2, po red-team workflow)

## Kontext a problém

Server-side ochrana proti překryvům bloků (finální transakční pojistka `assertNoOverlapForBlocks`
+ chain push, nasazená 9. 6. 2026) platí dnes **jen pro `type === "ZAKAZKA"`**. REZERVACE a
UDRZBA bloky nemají žádnou serverovou kontrolu překryvu — dají se položit na kterýkoliv obsazený
slot. Diagnostika produkce (2026-07-15) potvrdila reálné překryvy: legacy z března (před 9. 6.)
+ ÚDRŽBA/REZERVACE položené přes zakázky.

**Klíčové zjištění red-team workflow (2026-07-16):** `assertNoOverlapForBlocks`
(`src/lib/overlapCheck.ts:78-108`) i `checkBlockOverlap` (`overlapCheck.ts:19-41`) **už dnes
typ nefiltrují** — gating je výhradně v **call-siteech**, roztroušený přes **5 zápisových cest**.
„Rozšířit net na všechny typy" tedy NEznamená sáhnout do `overlapCheck.ts`, ale přepsat
call-site podmínky a naplnit vstupní ID seznamy.

**Existující bug (mimo původní záměr, opravíme při té příležitosti):** reflow endpointy
(`reflow.server.ts`) mění `startTime/endTime` + chain-push, ale `assertNoOverlapForBlocks`
**nevolají vůbec** — takže i dnešní ZAKAZKA-only záruka je přes reflow prolomitelná.

## Cíl

**Tvrdá záruka:** žádný blok jakéhokoliv typu nejde uložit tak, aby se časově překrýval s jiným
blokem na stejném stroji — na žádné z 5 zápisových cest, bez ohledu na klientské flagy.

## Rozsah

**5 zápisových cest, které vytváří/posouvají Block** (úplný výčet, ověřeno red-teamem):
1. POST `/api/blocks` — `src/app/api/blocks/route.ts`
2. PUT `/api/blocks/[id]` — `src/app/api/blocks/[id]/route.ts`
3. POST `/api/blocks/batch` — `src/app/api/blocks/batch/route.ts`
4. POST `/api/blocks/[id]/split` — `src/app/api/blocks/[id]/split/route.ts`
5. `reflowBlockInTx` / `reflowMachineInTx` — `src/lib/reflow.server.ts` (volané z
   `/api/blocks/[id]/reflow` a `/api/blocks/reflow`)

**Mimo rozsah (potvrzeno — netvoří ani neposouvá bloky):**
- Reservation routes (`src/app/api/reservations/[id]/route.ts`, `route.ts`) — plánování
  rezervace vzniká výhradně přes POST `/api/blocks` (`reservationId` v body); reservation route
  jen čte blok a emituje SSE.
- `/api/blocks/[id]/complete` (potvrzení tisku) — nemění časy.
- Žádná Prisma migrace, žádná změna DB schématu.

## Chování při kolizi — dle typu

| Typ | Při kolizi | Chain push (posouvá sousedy)? |
| --- | --- | --- |
| **ZAKAZKA** | *beze změny* — auto-posun z fronty (`autoShiftIfBusy`), chain-push (`resolveChain`) | ano |
| **REZERVACE** | **auto-posune SEBE** na nejbližší volný slot (duration-based); neposouvá cizí bloky | ne |
| **UDRZBA** | **tvrdé odmítnutí** + hláška „Slot je obsazený, vyber jiné místo."; neposouvá nic | ne |

Finální net platí pro všechny typy → i kdyby REZERVACE auto-posun selhal, transakce spadne (nikdy
tichý překryv).

## Architektura — must-fix požadavky (R1–R6)

### R1 — PUT: rozšířit gating podmínku finálního netu
`src/app/api/blocks/[id]/route.ts:521` dnes `if (resultingType === "ZAKAZKA" && (timingChanged ||
typeChangesToZakazka)) { … chain push … assertNoOverlapForBlocks … }` obaluje **oboje**. Pro
REZERVACE/UDRZBA se net nikdy nezavolá (reprodukovatelné: `bypassOverlapCheck=true` + UDRZBA
dnes commitne překryv bez jakékoliv kontroly).

**Řešení:** oddělit chain push (zůstane ZAKAZKA-only) od finálního netu. Net musí běžet **vždy,
když se změnila pozice / délka / stroj**, bez ohledu na typ — podmínka cca
`if (timingChanged || typeChangesToZakazka || typeChangingAwayFromZakazka)`, a uvnitř větvit
chování dle `resultingType` (ZAKAZKA chain-push, REZERVACE self-shift, UDRZBA reject). Net-vstup
(`blockIds`) vždy obsahuje vlastní ID + ID posunutých.

### R2 — Batch: net-vstup + intra-batch pre-check ze VŠECH updates
`src/app/api/blocks/batch/route.ts` staví `checkByMachine` (vstup finálního netu, ř. 169-174) a
`findIntraBatchOverlap` (ř. 119-127) výhradně ze `zakazkaUpdates` (`existing?.type === "ZAKAZKA"`,
ř. 90-93). REZERVACE/UDRZBA v téže dávce projdou beze změny endTime i bez netu (reprodukovatelné
běžným lasso flow — `handleMultiBlockUpdate` posílá `resolveChain:true`).

**Řešení:**
- `checkByMachine` plnit z **`updates`** (každý přesunutý blok libovolného typu) + chain-push posuny.
- `findIntraBatchOverlap` krmit spany **všech** bloků. Pro ne-ZAKAZKA se end nepočítá přes
  `validateAndComputeEnd` (ta vrací pro ne-ZAKAZKA `ok:true` bez výpočtu) — do intra-batch
  kontroly dodat jejich `effectiveEnd` (dnes `computed?.end ?? new Date(u.endTime)`, ř. 144).

### R3 — Reflow: přidat finální net (opravuje i dnešní bug)
`src/lib/reflow.server.ts` — `reflowBlockInTx` po `resolveChainPush` (ř. ~141) net nevolá.
`resolveChainPushFromDb` ekvivalentní záruku neposkytuje (jeho drift-pojistka kontroluje jen end
posunutých bloků proti expanzi, ne raw overlap query).

**Řešení:** po chain pushi v `reflowBlockInTx` přidat
`assertNoOverlapForBlocks(machine, [blockId, ...moves.map(m => m.id)], tx)`. Jedna oprava kryje
i `reflowMachineInTx` (loopuje přes `reflowBlockInTx`). `reflow.server.ts` je in-scope soubor.

### R4 — Chain push musí vnímat ne-ZAKAZKA jako pevnou překážku
`src/lib/overlapResolver.server.ts:63` — `others` fetch má natvrdo `type: "ZAKAZKA"`. Po
rozšíření netu ZAKAZKA anchor narazí na REZERVACE/UDRZBA souseda, kterého chain push „nevidí",
a operace spadne na finální net (rollback) místo slíbeného chování.

**Řešení (varianta a, schválená):** rozšířit `others` fetch na **všechny typy**; v
`computeChainPush` (`overlapResolver.ts`) ne-ZAKAZKA bloky brát jako **pevnou překážku** —
chain-push posouvá jen ZAKAZKA sousedy, a pokud by posun musel „prostrčit" přes ne-ZAKAZKA blok
(nelze ho posunout), vyhodit specifickou `AppError` s hláškou „Nelze uvolnit místo — koliduje
s rezervací/údržbou. Vyber jiné místo." (analogicky dnešní hlášce u kolize se zamčeným blokem,
`overlapResolver.server.ts:112-116`). Data-integrita drží i bez R4 (rollback přes net), ale bez
R4 je chování dle typu nesplněné a UX degraduje na generickou 409.

### R5 — REZERVACE self-shift: nová větev, ne jen odstranění guardu
`src/app/api/blocks/route.ts:105-107` — pro ne-ZAKAZKA je `rawPrintMinutes == null` a auto-shift
větev vrací rovnou 422 (dnes dead-code). REZERVACE dnes žádnou `autoShiftIfBusy` cestu nemá.

**Řešení:** definovat REZERVACE „auto-posun sebe" přes duration-based `findNextFreeSlotFromDb`
(`scheduleSlotFinder.ts:107-115`, `blockedIntervals` je typ-agnostické — dotahuje všechny bloky
stroje). Napojit tak, aby se net **vždy** volal s ID této REZERVACE + ID posunutých na její účet
(stejná nepodmíněná invarianta jako dnes ZAKAZKA na `route.ts:352`). Platí pro POST i batch.
Když `findNextFreeSlotFromDb` nenajde volný slot v horizontu → čistá hláška (ne 422 z print-minutes
větve). UDRZBA `autoShiftIfBusy` cestu nemá — kolize = tvrdé odmítnutí.

### R6 — Split: net i pro ne-ZAKAZKA
`src/app/api/blocks/[id]/split/route.ts:167-189` — chain push + `assertNoOverlapForBlocks` jsou
pod `if (block.type === "ZAKAZKA")`. Split ne-ZAKAZKA bloku (pokud UI umožní) by net obešel.

**Řešení:** finální net (head + tail) volat i pro ne-ZAKAZKA typy (chain push může zůstat
ZAKAZKA-only). Pozn.: `updateMany` propagace shared fields (split, PUT ř. 508) **nesmí** nikdy
nést časová pole — komentář `[id]/route.ts:53-55` to hlídá, spec to zachovává.

## Zpevnění (net drží i bez nich, ale explicitně pojmenovat)

### H1 — slot-finder běží mimo transakci (netrustovaný kandidát)
`findNextFreeSlotFromDb` / `findNextFreePrintSlotFromDb` (`scheduleSlotFinder.ts`) čtou přes
module-scope `prisma` singleton, ne přes `tx`. Jejich výstup je jen **kandidátní slot** —
skutečnou serializaci souběhu zajišťuje až trailing `assertNoOverlapForBlocks` (FOR UPDATE,
`overlapCheck.ts:92-100`). Komentář `route.ts:171` („Race condition… ověříme znovu") dává falešnou
jistotu. Design explicitně stanoví: **jediná záruka souběhu je trailing `assertNoOverlapForBlocks`**;
slot-finder je kandidát. R5 znovupoužívá slot-finder pro REZERVACE — dědí totéž, nezavádět nový
non-tx read jako „záruku".

### H2 — acceptance: net-vstup vždy obsahuje vlastní ID (napříč typy, concurrency-tested)
Na **každé** z 5 cest jde do `blockIds` vlastní ID editovaného/vytvořeného bloku + ID všech
posunutých na jeho účet, se stejnou nepodmíněnou invariantou napříč typy — ne jen „odstranit
ZAKAZKA-only if". Guard existuje na 5 nezávislých místech; každé se ověří **concurrency testem**,
ne jen typovým lintem.

## Chybové stavy

- Kolize UDRZBA (i REZERVACE po vyčerpání horizontu auto-shiftu) → `AppError("OVERLAP", "Slot je
  obsazený, vyber jiné místo.")`, HTTP 409.
- Chain-push ZAKAZKA narazí na ne-ZAKAZKA zeď (R4) → `AppError` „Nelze uvolnit místo — koliduje
  s rezervací/údržbou. Vyber jiné místo.", HTTP 409.
- Finální net zachytí překryv (poslední pojistka) → `AppError("OVERLAP", …)`, rollback celé
  transakce, žádný částečný zápis.
- Všechny přes `AppError`/`isAppError` dle coding standards projektu.

## Testovací strategie

- **Čisté funkce:** rozšířit `overlapCheck.test.ts` a `overlapResolver.test.ts` /
  `overlapResolver.server.test.ts` o ne-ZAKAZKA typy: REZERVACE/UDRZBA jako pevná překážka, mix
  typů, self-shift kandidát.
- **Per-cesta concurrency test:** pro každou z 5 cest test, který ověří, že net dostane vlastní ID
  bloku a odmítne uložení překryvu (i s `bypassOverlapCheck=true` / `resolveChain=true` flagy).
  Vzor: `overlapResolver.server.test.ts` (mock.fn transakce).
- **Reprodukce oprav (regresní):** (1) PUT UDRZBA s `bypassOverlapCheck=true` na obsazený slot →
  409, ne commit (R1/R11). (2) Batch lasso 2× UDRZBA na sebe → odmítnuto (R2). (3) Reflow bloku,
  jehož chain-push by vytvořil překryv → rollback (R3).
- **Build + typecheck** zelené; celá suite zelená.
- **Multi-agent adversariální review** po implementaci (ultracode) — lens korektnost pod souběhem
  / TOCTOU, pokrytí všech 5 cest, chování dle typu, testy + „overlap prober" agent.
- **Dev DB důkaz:** pokusit se v UI vytvořit každý zakázaný překryv (UDRZBA na zakázku, 2 rezervace
  na sebe, reflow) → server odmítne.

## Vědomě mimo rozsah

- Úklid existujících (legacy březnových) překryvů — nelze auto-posunout (plno) a jde o minulost;
  necháváme (rozhodnuto 2026-07-15).
- „Force overlap" / bypass zadní vrátka — záměrně žádná (tvrdá záruka).
- Změna sémantiky odstávek (pauza přes odstávku řeší tiskové hodiny, ne overlap).
