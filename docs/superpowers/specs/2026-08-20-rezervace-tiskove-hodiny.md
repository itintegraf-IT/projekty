# Spec: Etapa 9 — Rezervace dostanou plné tiskové hodiny

**Datum:** 20. 8. 2026 · **Stav:** NÁVRH k rannímu schválení (Vojta) · **Navazuje na:**
`docs/audits/2026-08-19-audit-pripominky-planovace-druha-vlna.md` (bod 5, 9 rozhodovacích
míst) a `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` (Etapa 9).

**Rozhodnutí Vojty (závazné, 19. 8.):** rezervace se mají lámat přes noc „jako u zakázky,
se vším všudy" — mechanika tiskových hodin se překlopí i na typ `REZERVACE`. `UDRZBA`
zůstává rigidní beze změny.

Tenhle dokument NEROZHODUJE otevřené designové otázky tiše — jsou vyjmenované v sekci
„K rozhodnutí" s doporučením a dopady. Kód dole cituje soubor:řádek podle stavu branch
`Vojta` k 19.–20. 8. 2026 (viz `git log` HEAD v době psaní; než se etapa začne
implementovat, čísla řádků ověřit znovu — mezitím mohly vzniknout jiné commity).

---

## 1. Cíl a ne-cíle

**Cíl:** `REZERVACE` získá STEJNÝ geometrický engine jako `ZAKAZKA`:
- server validuje a počítá `endTime` přes `validateAndComputeEnd` (dnes early-return),
- chain push ji re-expanduje přes pauzy (dnes rigidní interval s 7denním stropem),
- klientské snapy používají start-only snap + expanzi (dnes duration-based snap),
- kreslí se jí pauza „⏸ PAUZA — mimo provoz" uvnitř bloku (dnes ne),
- drift kalendáře (`detectCalendarDrift`/`blockCalendarDrift`) ji posuzuje (dnes ne),
- „Přepočítat" (reflow) ji umí opravit (dnes `NOT_ZAKAZKA`).

`UDRZBA` v ničem z výše uvedeného nemění chování — zůstává rigidní, se stropem
`MAX_RIGID_PUSH_MS` = 7 dní a bez pauz.

**Ne-cíle (výslovně mimo rozsah, aby se nezúžilo tiše naopak — ale ani nerozšířilo tiše):**
- Byznysové/workflow chování `REZERVACE` nesouvisející s geometrií se NEMĚNÍ: potvrzení
  tisku (`printCompletedAt`), DATA/MATERIÁL/PANTONE panely, expedice, job presety
  (`appliesToZakazka`/`appliesToRezervace` už dnes rozlišují typ nezávisle), DTP přehled,
  Monitor (rezervace tam dnes nejsou a etapa 9 to nemění — Monitor řeší jen ZAKAZKA/UDRZBA
  frontu), `blockVariant`/POZASTAVENO.
- Split rezervace na dvě části (přes pauzu) — dnešní `splitCompute.ts` ji odmítá; spec ho
  NEMĚNÍ (viz „K rozhodnutí" #7 — vědomě otevřeno, ne tiše zahrnuto ani vyloučeno navždy).
- Zahrnutí rezervací do reportů vytížení (`blockReportSegments`) — sdílí guard s kreslením
  pauz, takže se technicky „přihodí" broadeningem jednoho helperu; jde ale o SAMOSTATNÉ
  byznysové rozhodnutí, ne vedlejší efekt (viz „K rozhodnutí" #5).

---

## 2. Prerekvizita: synchronizace `Reservation.scheduled*`

**Dluh** (`~/.claude/…/memory/rezervace_chain_push_dluh.md`, 3. 8. 2026): chain push posune
blok typu `REZERVACE`, ale neaktualizuje zrcadlená pole
`Reservation.scheduledStartTime/scheduledEndTime/scheduledMachine` ani neposílá notifikaci
obchodníkovi. Vojta ho tehdy vědomě odložil, protože `reservationId` byl na produkci vždy
`null` — vada byla latentní.

**Proč je to TVRDÁ prerekvizita, ne nice-to-have:** dokud byla `REZERVACE` rigidní, chain
push ji posouval jen zřídka (jen když jí něco vadilo v cestě). Jakmile dostane tiskové
hodiny, začne se posouvat RUTINNĚ — každá editace směn, každá sousední zakázka, každé
„Přepočítat" nad strojem ji může re-expandovat. Bez synchronizace by obchodník v `/rezervace`
viděl zastaralý termín prakticky po každé změně kalendáře, ne jen výjimečně.

### Navržený mechanismus

**Jedno místo, volané na konci každé transakce, ne uvnitř `resolveChainPushFromDb`.**
Důvod: `resolveChainPushFromDb` aktualizuje jen SOUSEDY (`others`), ne kotvu (anchor) —
ta se zapisuje přímo v POST/PUT/batch/split/undo. Sync musí pokrýt OBĚ množiny najednou,
takže je čistší udělat ho jako poslední krok transakce nad úplnou množinou dotčených id
(kotva + `shiftedMoves`/`moves`), ne rozpojovat do dvou různých míst.

Návrh: nový soubor `src/lib/reservationSync.server.ts`:

```typescript
export async function syncReservationScheduleForBlocks(
  tx: PrismaTransactionClient,
  blockIds: number[],
): Promise<void> {
  if (blockIds.length === 0) return;
  const rows = await tx.block.findMany({
    where: { id: { in: blockIds }, reservationId: { not: null } },
    select: { id: true, reservationId: true, machine: true, startTime: true, endTime: true },
  });
  for (const r of rows) {
    await tx.reservation.update({
      where: { id: r.reservationId! },
      data: {
        scheduledMachine: r.machine,
        scheduledStartTime: r.startTime,
        scheduledEndTime: r.endTime,
      },
    });
  }
}
```

**Volat na konci těla `withRevision` (uvnitř transakce, PŘED `return`) na všech cestách,
kde se `Block` s `reservationId` může posunout:**

| Cesta | Množina id k předání | Dnešní stav |
|---|---|---|
| `POST /api/blocks` (`src/app/api/blocks/route.ts`) | `[newBlock.id, ...shiftedMoves.map(m=>m.id)]` | `Reservation.scheduled*` se nastavuje jen při VZNIKU (ř. 371–381); chain push sousedy nesynchronizuje vůbec |
| `PUT /api/blocks/[id]` (`src/app/api/blocks/[id]/route.ts`) | `[updated.id, ...shiftedMoves.map(m=>m.id)]` | nic |
| `POST /api/blocks/batch` | `[...updated.map(u=>u.id)]` (batch nevolá chain push mimo `resolveChain`, ale i lasso přesun sám o sobě mění `startTime/endTime`) | nic |
| `POST /api/blocks/[id]/split` | `[head.id, tail.id, ...shiftedMoves.map(m=>m.id)]` | irelevantní, pokud split zůstane ZAKAZKA-only (viz „K rozhodnutí" #7); pokud ne, doplnit |
| `reflow.server.ts` (`reflowBlockInTx`/`reflowMachineInTx`) | `[blockId, ...moves.map(m=>m.id)]` | nic — a s plánovanou etapou 8 (item 8) se REZERVACE bude reflowovat rutinně |
| `POST /api/blocks/undo` (`undoApply.server.ts`) | id všech restorovaných bloků s `reservationId != null` | undo vrací startTime/endTime doslova ze snapshotu, `Reservation.scheduled*` se nedotkne |

Šest volacích míst — analogické k `withRevision`'s devítibodovému seznamu v CLAUDE.md
(„Zapojeno je všech 9 cest"). Doporučuji stejný vzor: přidat strážný test
(`reservationSyncWiring.test.ts` po vzoru `revisionWiring.test.ts`), který vyjmenuje
těchto 6 volání a hlídá, že žádná nová mutační cesta bloku s `reservationId` nevznikne bez
volání syncu.

**Notifikace `RESERVATION_RESCHEDULED`:** memory dluhu navrhuje notifikaci obchodníkovi
vzorem `route.ts:385–394` (`RESERVATION_SCHEDULED`). Otevřená otázka na KAŽDÝ posun vs. jen
nad prahem — viz „K rozhodnutí" #6. Implementačně: `syncReservationScheduleForBlocks` může
vracet seznam skutečně změněných rezervací (porovnat starý/nový `scheduledStartTime` před
update), aby volající mohl notifikaci poslat JEN při reálné změně, ne no-opu.

**Aktor pro notifikaci:** funkce dnes nezná `session` (memory dluhu to zmiňuje) —
`syncReservationScheduleForBlocks` musí přijmout `actor: { id: number; username: string }`
parametrem stejně jako `resolveChainPushFromDb`/`reflowBlockInTx`.

---

## 3. Datový model a backfill migrace

**Žádný nový sloupec.** `Block.printMinutes`/`Block.scheduleBypassed` už existují a dnes se
pro ne-ZAKAZKA aktivně nulují (`POST route.ts:286–287`, `PUT route.ts:210–222`). Změna je
v tom, KDY se nulují — jen pro `UDRZBA`, ne pro `REZERVACE`.

### Backfill existujících `REZERVACE` bloků

**Metoda (podle plánu, ověřeno 19. 8.):** `printMinutes = computePrintMinutes(machine,
startTime, endTime, currentWeekShifts, currentCompanyDays)` — INVERZE dnešní expanze, ne
prostý elapsed span. Tohle je záměrně tak, aby backfillovaná hodnota reprodukovala PŘESNĚ
dnešní uložený `endTime` při zpětné expanzi (`printMinutes` → `expandPrintTime` → stejný
`end`) — blok tedy po backfillu okamžitě KONFORMUJE, žádná hromadná drift vlna hned po
migraci.

**Proč to funguje jen podmíněně — dva reálné limity:**
1. `computePrintMinutes` počítá nad SOUČASNÝM kalendářem (`weekShifts`/`companyDays`
   platné DNES), ne nad kalendářem platným v době, kdy byla rezervace založena. Pokud se
   směny mezitím změnily, backfillovaná hodnota nereprodukuje historický `end` přesně —
   blok po flipu vyjde buď hned `END_MISMATCH`, nebo (pravděpodobněji) se `scheduleBypassed`
   nastaví implicitně na true při první dotyku, protože neshoda je reálná.
2. `computePrintMinutes` VYŽADUJE zarovnaný start i end na 30minutovou hranici (jinak
   `throw`, `src/lib/printTime.ts:124–129`). `REZERVACE` nikdy neprošla
   `validateAndComputeEnd`, takže není zaručeno, že historické starty jsou zarovnané.
   Migrace musí nejdřív spočítat, kolik existujících `REZERVACE` bloků na produkci
   nezarovnaný start má, a rozhodnout se pro ně zvlášť (ruční oprava / vynechání z backfillu
   s `printMinutes = null` a ponecháním legacy fallbacku).

**Postup (skript, ne raw SQL — výpočet je kalendářně závislá TS logika):**
1. Načíst všechny `Block` s `type = "REZERVACE"`.
2. Rozdělit na zarovnané (`startTime % SLOT_MS === 0`) a nezarovnané — nezarovnané vypsat
   do reportu, backfill přeskočit (zůstanou `printMinutes = null`, fungují jako dnes, dokud
   se ručně neopraví).
3. Pro zarovnané: `pm = computePrintMinutes(...)`; DRY RUN — spočítat `expandPrintTime(pm)`
   a porovnat výsledný `end` s uloženým `endTime`. Vypsat diff report: kolik bloků vyjde
   přesně shodně (`scheduleBypassed = false`), kolik s neshodou (`scheduleBypassed = true`,
   analogicky `effectivelyBypassed`).
4. Vojta review dry-run reportu PŘED ostrým zápisem (parita s pravidlem „Zálohu první" —
   `mysqldump` před jakýmkoli zásahem do produkční `Block`).
5. Ostrý zápis: `UPDATE Block SET printMinutes = ?, scheduleBypassed = ? WHERE id = ?` pro
   zarovnané řádky.

Umístění skriptu: `scripts/backfill-reservation-print-minutes.ts`, vzor `scripts/
prune-revisions.ts` (jednorázový, spouští se ručně, ne cron).

---

## 4. Změny po vrstvách

### 4.1 Server validace — `src/lib/scheduleValidationServer.ts`

- `validateAndComputeEnd` (ř. 100): `if (blockType !== "ZAKAZKA") return {...}` → invertovat
  na `if (blockType === "UDRZBA") return {...}`. Zbytek funkce (INVALID_INPUT/PLACEMENT
  hlášky, bypass větev, `effectivelyBypassed` výpočet) je typově agnostický, funguje beze
  změny pro `REZERVACE`.
- Docblock (ř. 70–90) přepsat: „ZAKAZKA/REZERVACE bez bypass…", „UDRZBA: bez validace…".
- `shouldRecomputeSchedule` (ř. 51–64) je už typově agnostická (porovnává `old.type` proti
  requestu) — beze změny.

### 4.2 `POST /api/blocks` — `src/app/api/blocks/route.ts`

- Ř. 97–102 (`rawPrintMinutes` derivace): fallback `blockType === "ZAKAZKA" ? Math.round(elapsed) : null`
  rozšířit na `["ZAKAZKA","REZERVACE"].includes(blockType)`.
- Ř. 286–287 (`printMinutes`/`scheduleBypassed` v `tx.block.create`): stejné rozšíření.
- Ř. 229–252 (self-shift `REZERVACE` bez `resolveChain`): dnešní duration-based
  `findNextFreeSlotFromDb` větev vznikla, když `REZERVACE` neměla tiskové hodiny. Po flipu
  je nekonzistentní s tím, jak se `ZAKAZKA` v analogické situaci chová (ta žádnou vlastní
  self-shift větev nemá — spoléhá na `autoShiftIfBusy`/`resolveChain`). Doporučuji tuhle
  větev ODSTRANIT a nechat `REZERVACE` bez `resolveChain` projít stejnou cestou jako
  `ZAKAZKA` (bez sebeposunu — kolize vrátí 409 z `checkBlockOverlap`, konzistentně). Viz
  „K rozhodnutí" #9 — je to implementační detail s jasným doporučením, ale mění pozorovatelné
  chování (dnes se `REZERVACE` bez explicitního `resolveChain` tiše sama odsune, nově by to
  přestala dělat), proto je vyjmenované zvlášť.

### 4.3 `PUT /api/blocks/[id]` — `src/app/api/blocks/[id]/route.ts`

- Ř. 210 (`if (checkType !== "ZAKAZKA")` — čistí `printMinutes`/nastavuje `computedBypassed=false`):
  změnit na `if (checkType === "UDRZBA")`. Zbytek větve (ř. 223–267: move/resize detekce,
  `pm` derivace, `validateAndComputeEnd` volání) běží pro `checkType === "ZAKAZKA" ||
  checkType === "REZERVACE"` beze změny — je to `ZAKAZKA`-specifické jen názvem proměnných,
  ne logikou.
- Ř. 249 (`oldBlock.printMinutes != null && oldBlock.type === "ZAKAZKA"` — move-branch pm
  ze záznamu): rozšířit na `["ZAKAZKA","REZERVACE"].includes(oldBlock.type)`.
- Přechod typu `ZAKAZKA ↔ REZERVACE` (oba nově „tiskové") NESMÍ spustit clear-printMinutes
  větev — jen přechod NA/Z `UDRZBA` ji spouští. `shouldRecomputeSchedule` už na `type`
  změnu reaguje (ř. 55), takže přepočet proběhne správně, jen výsledná hodnota nesmí být
  `null` pro `ZAKAZKA→REZERVACE` přechod.

### 4.4 `POST /api/blocks/batch` — `src/app/api/blocks/batch/route.ts`

- Ř. 107 (`zakazkaUpdates` filtr `existing?.type === "ZAKAZKA"`): rozšířit na
  `["ZAKAZKA","REZERVACE"].includes(existing?.type)`. Bez týhle změny by lasso přesun
  rezervace dál posílal syrový `u.endTime` z klienta beze serverové re-expanze — přesně ten
  vzor bugu, který etapa 4 (P26/P27) řeší pro jiná pole.
- Klientská strana (multi-move v `TimelineGrid.tsx`, viz 4.5) musí rezervaci zahrnout do
  „ZAKAZKA-like" snap větve, jinak pošle nesprávný `endTime` payload.

### 4.5 `POST /api/blocks/[id]/split` — `src/app/api/blocks/[id]/split/route.ts`

Beze změny, POKUD split zůstane ZAKAZKA-only (doporučení, „K rozhodnutí" #7). Guardy
`block.type === "ZAKAZKA"` na ř. 119, 138–140, 192 (`chainPushGeometry`/`printMinutes`
kopírování head/tail, chain push jen pro ZAKAZKA) zůstávají — `REZERVACE` se dál nedá
rozdělit. Pokud Vojta rozhodne jinak, tahle sekce se musí dopsat symetricky s 4.3.

### 4.6 Chain push geometrie — `src/lib/overlapResolver.server.ts` + `overlapResolver.ts`

- `chainPushGeometry` (`overlapResolver.server.ts:51–65`): `if (r.type !== "ZAKAZKA")
  return { rigid: true, ... }` → `if (r.type === "UDRZBA") return { rigid: true, ... }`.
  `REZERVACE` propadne do stejné větve jako `ZAKAZKA` (`printMinutes` z `r.printMinutes`,
  re-expanze).
- `nonConforming` smyčka (`overlapResolver.server.ts:176–181`, „rigidní blok mimo kalendář
  je zeď"): `if (r.type === "ZAKAZKA") continue` → `if (r.type !== "UDRZBA") continue`.
  `REZERVACE` přestává být kandidát na „zeď" (stejně jako `ZAKAZKA` dnes nikdy není).
- `computeChainPush`/`computeChainPushAttempt` (`overlapResolver.ts`): `others[].rigid` flag
  se teď u `REZERVACE` nastaví na `false` (z `chainPushGeometry`), takže projde `placeAfter`
  (ZAKAZKA větev s `expandPrintTime` + `MIN_PRINT_SEGMENT_MINUTES` pravidlem), NE
  `placeRigidAfter`. Důsledek: `MAX_RIGID_PUSH_MS` (7 dní) na `REZERVACE` PŘESTANE platit —
  zdědí bezhorizontové chování `ZAKAZKA` (komentář „Zakázka horizont nemá, u ní je to
  skutečné selhání", `overlapResolver.ts:161`). Tohle je PŘÍMO rozhodovací místo #4
  auditu — viz „K rozhodnutí" #1, NEROZHODOVÁNO tiše.
- Minimální segment (`MIN_PRINT_SEGMENT_MINUTES = 60`) začne platit i pro `REZERVACE` —
  dřív se rigidní blok nikdy nedělil na kusy, nově může (viz „Rizika").

### 4.7 Klientské snapy — VÍC míst, než odhad plánu (~6)

Vlastní ověření (`grep` nad `TimelineGrid.tsx`/`PlannerPage.tsx` k 19. 8. 2026) našlo
následujících **10 míst**, ne 6 — plánový odhad počítal jen s commitovacími cestami, ne
s preview/ghost vykreslením v `mousemove`. Kompletní seznam (P5/P17 poučení — vyjmenovat
VŠECHNY konzumenty, ne jen některé):

| # | Soubor:řádek | Funkce | Dnešní gate |
|---|---|---|---|
| 1 | `PlannerPage.tsx:2278–2290` | `handleQueueDrop` (commit) | `isZakazka = item.type === "ZAKAZKA"` |
| 2 | `PlannerPage.tsx:2363,2408` | payload `printMinutes` v témže handleru | totéž |
| 3 | `PlannerPage.tsx:2487–2525` | `handlePasteWithTarget` (commit) | `isZakazka = src.type === "ZAKAZKA"` |
| 4 | `PlannerPage.tsx:2591–2598` | `handleGroupPasteWithTarget` (commit) | `allZakazka = group.every(...)` |
| 5 | `PlannerPage.tsx:3406–3415` | délka zdroje pro clipboard preview | `b.type === "ZAKAZKA" ? blockPrintMinutes(b)*60000 : elapsed` |
| 6 | `TimelineGrid.tsx:845–856` | queue-drop preview (ghost výška, `mousemove`) | `workingTimeLockRef.current && qdItem.type === "ZAKAZKA"` |
| 7 | `TimelineGrid.tsx:918–940` | drag-move + resize preview (ghost, `mousemove`) | `sourceBlock?.type === "ZAKAZKA"` (2×, move i resize) |
| 8 | `TimelineGrid.tsx:1083–1112` | drag-move commit (`mouseup`, PUT) | `isZakazka = sourceBlock?.type === "ZAKAZKA"` |
| 9 | `TimelineGrid.tsx:1159` | multi-move (lasso) commit | `zakazkaOnly = blocksOnNewMachine.every(...)` |
| 10 | `TimelineGrid.tsx:2100–2120` | paste target marker (vykreslení) | `pasteSourceIsZakazka` |

U všech 10 se gate rozšiřuje na `type === "ZAKAZKA" || type === "REZERVACE"` (doporučuji
extrahovat sdílenou čistou funkci `usesTiskoveHodiny(type: string): boolean` do
`printTimeClient.ts`, aby se 10 inline porovnání nerozešlo — přesně vzor, kterému P17/P6
říká „projet celý obor hodnot" a „sdílený helper se neuvolňuje bez seznamu volajících").

**Výslovně NEDOTÝKAT:** `PlannerPage.tsx:3578–3583` (komentář „NEODSTRAŇOVAT ani
nezjednodušovat zpátky na plošné `!== ZAKAZKA`") — to je viditelnost budoucích `ZAKAZKA`
bloků v `isTiskar` režimu, nesouvisí s geometrií rezervace, mimo rozsah etapy 9.

**Kolize s Etapou 3 (skupinový přesun):** `snapGroupDeltaStartOnly`/
`snapGroupDeltaWithTemplates` (`printTimeClient.ts:71–101`, konzument místo #9 výš) jsou
SOUČASNĚ předmětem přepisu v Etapě 3 plánu (`per-blok snap se zachováním pořadí`). Etapa 9
musí buď počkat, až Etapa 3 dozraje a re-testovat nad hotovým kódem, nebo koordinovat
implementaci v jedné PR — jinak riziko, že se obě etapy přepíšou navzájem.

**`blockEditDuration.ts`** (`durationPayload`, ř. 41–53): `if (type === "ZAKAZKA")` větev
(hodiny picker → `printMinutes`) rozšířit na `REZERVACE` — jinak by `BlockEdit` u rezervace
dál posílal jen `endTime`, ne `printMinutes`, a server (po flipu) by u `REZERVACE` bez
`printMinutes` v payloadu spadl na starou hodnotu ze záznamu (funguje), ale nový editační
tok (uživatel mění délku picker) by ji neposunul.

### 4.8 Kreslení pauz + reporty — `src/lib/printTimeClient.ts`

- `blockPrintMinutes` (ř. 24–35): `if (b.type !== "ZAKAZKA") return elapsed;` →
  `if (b.type === "UDRZBA") return elapsed;`.
- `tryExpandForBlock` (ř. 121–138): `if (b.type !== "ZAKAZKA") return null;` →
  `if (b.type === "UDRZBA") return null;`. **Tohle je sdílený guard** (dokumentovaný
  v docblocku a chráněný poučením P6) pro ČTYŘI volající:
  - `getBlockSegments` — kreslení pauzy uvnitř bloku → REZERVACE dostane vizuální „⏸
    PAUZA" stejně jako zakázka. ŽÁDOUCÍ, součást cíle.
  - `blockCalendarDrift` — klientský drift štítek → REZERVACE se začne posuzovat na kartě.
    ŽÁDOUCÍ (item 7 plánu).
  - `printMidpoint` — bod splitu; má VLASTNÍ nezávislý gate na ř. 288
    (`b.type === "ZAKAZKA" ? b.printMinutes : null`), broadening `tryExpandForBlock` ho
    NEOVLIVNÍ (split zůstává ZAKAZKA-only, viz 4.5) — potvrzeno, žádná náhodná regrese.
  - `blockReportSegments` — segmenty pro report vytížení. Broadening `tryExpandForBlock`
    by REZERVACI ZAHRNUL do vytížení strojů AUTOMATICKY, jako vedlejší efekt sdíleného
    guardu, ne jako vědomé rozhodnutí. **Tohle je přesně past z poučení P6/P17.** Doporučuji
    NEPROPOJOVAT: `blockReportSegments` volající (`report/attention/route.ts:103`,
    `report/dashboard/route.ts:206,434`, `ReportView.tsx:335`) mají dnes vlastní
    `b.type === "ZAKAZKA" ? blockReportSegments(...) : null` gate PŘED voláním — tenhle
    vnější gate zůstává NEZMĚNĚNÝ (na `"ZAKAZKA"`), dokud „K rozhodnutí" #5 nerozhodne
    jinak. `tryExpandForBlock` se broaduje, ale report volající si REZERVACI odfiltrují
    sami, dřív než se guard vůbec zavolá.

### 4.9 Drift — `src/lib/calendarDrift.server.ts` + parita

- `detectCalendarDrift` where filtr (ř. 110): `type: "ZAKAZKA"` → `type: { in: ["ZAKAZKA",
  "REZERVACE"] }`. Typ `PrismaClientLike.block.findMany` (ř. 15, `type: string`) nevyžaduje
  změnu signatury.
- `classifyCascade`/`cascadeCheck.ts` pracuje čistě nad `DriftedBlock[]` (bez `type` pole)
  — jakmile `detectCalendarDrift` vrací i `REZERVACE`, kaskádová kontrola editace směn ji
  automaticky pokryje BEZE ZMĚNY vlastního kódu.
- **CLAUDE.md update povinný** (plán to sám žádá): odstavec „kontrola kaskády NEPLATÍ pro
  všechny typy… REZERVACE a ÚDRŽBA se tiše přeskakují" už po téhle etapě neplatí pro
  REZERVACE — jen pro ÚDRŽBU. Přepsat při implementaci, ne nechat zastaralý komentář
  (poučení P19).
- **Parita test** (`calendarDrift.server.test.ts`, tabulkový test server vs. klient) musí
  dostat fixtury s `type: "REZERVACE"` na obou stranách — dnes testuje jen `ZAKAZKA`
  hraniční případy (odstávky, zarovnání startu).
- `notifyCalendarDrift` — beze změny kódu; zpráva „N bloků nesedí na kalendář" bude nově
  zahrnovat i rezervace, `orderNumber` u nich = `reservation.code` (nastaveno při vzniku,
  `POST route.ts:166`), takže text zůstává čitelný beze zvláštního rozlišení.

### 4.10 Reflow — `src/lib/reflow.server.ts`

- `reflowBlockInTx` ř. 110: `if (block.type !== "ZAKAZKA") return { ok:false,
  code:"NOT_ZAKAZKA", ... }` → `if (block.type === "UDRZBA") return {...}`. Error `code`
  string `NOT_ZAKAZKA` doporučuji NEPŘEJMENOVÁVAT (minimalizace churn na klientské straně,
  která na tenhle kód mapuje hlášku) — sémanticky by teď znamenal „nelze přepočítat, blok
  nemá tiskové hodiny", ale řetězec zůstává stejný.
- `reflowMachineInTx` volá `detectCalendarDrift` (už broadovaný v 4.9) — hromadné
  „Přepočítat" nad strojem začne REZERVACE zahrnovat automaticky. Riziko první vlny po
  nasazení — viz „Rizika".

### 4.11 Undo

- `sanitizeUndoOps`/`applyUndoOps`/`UNDO_RESTORABLE_FIELDS` (`src/lib/undo/restoreFields.ts`)
  jsou typově agnostické — `machine`/`startTime`/`endTime`/`printMinutes`/`scheduleBypassed`
  jsou v allowlistu bez ohledu na `type`. **Mechanismus obnovy funguje pro REZERVACE beze
  změny.**
- Chybí ale volání `syncReservationScheduleForBlocks` (sekce 2) po undo zápisu — bez něj by
  Ctrl+Z vrátil `Block.startTime/endTime`, ale `Reservation.scheduled*` by zůstalo na
  hodnotě PŘED undem (nekonzistence stejné třídy jako dluh samotný).
- Klientská historie (`PlannerPage.tsx:1678–1680`, `canUndoCreated`): týká se jen CREATE
  undo (paste/queue-drop) a je párovaná s DELETE undo guardem — obojí vědomě vylučuje
  bloky s `reservationId != null`, protože vznik/zánik má vedlejší účinek na
  `Reservation.status` (přechod QUEUE_READY↔SCHEDULED/REJECTED). Tohle se etapou 9 NEMĚNÍ
  — nesouvisí s geometrií, souvisí se stavovým strojem rezervace. MOVE/reflow undo (na
  rozdíl od CREATE/DELETE) žádný takový guard nemá a mechanicky už dnes funguje i pro
  rezervace — zůstává tak, viz „K rozhodnutí" #4.

---

## 5. Vznik třetí kategorie: REZERVACE plná / UDRZBA rigidní

Kompletní inventura všech míst s dnešní dichotomií `type === "ZAKAZKA"` /
`type !== "ZAKAZKA"` (`grep` nad `src/` k 19. 8. 2026, po testovacích souborech
odfiltrováno). Rozděleno na (A) geometrie tiskových hodin — MĚNÍ SE, REZERVACE se
přidává k ZAKAZKA, a (B) byznys/workflow nesouvisející s geometrií — NEMĚNÍ SE, REZERVACE
zůstává vyloučená stejně jako dnes.

### (A) Geometrie — REZERVACE se PŘIDÁVÁ k ZAKAZKA

| Soubor:řádek | Co dělá | Po etapě 9 |
|---|---|---|
| `scheduleValidationServer.ts:100` | `validateAndComputeEnd` early-return | REZERVACE validována jako ZAKAZKA |
| `overlapResolver.server.ts:57` | `chainPushGeometry` rigid/tiskové | REZERVACE = tiskové (rigid jen UDRZBA) |
| `overlapResolver.server.ts:177` | `nonConforming` „zeď" smyčka | REZERVACE přestává být kandidát na zeď |
| `printTimeClient.ts:33` | `blockPrintMinutes` elapsed fallback | REZERVACE bere `printMinutes` |
| `printTimeClient.ts:127` | `tryExpandForBlock` sdílený guard | REZERVACE expandovatelná (segmenty, drift) |
| `calendarDrift.server.ts:110` | `detectCalendarDrift` where filtr | REZERVACE v driftu, notifikacích |
| `reflow.server.ts:110` | `reflowBlockInTx` NOT_ZAKAZKA guard | REZERVACE přepočitatelná |
| `blockPayload.ts:165` | `printMinutes` do payloadu | REZERVACE posílá printMinutes |
| `blockEditDuration.ts:53` | `durationPayload` picker→pm | REZERVACE posílá printMinutes z pickeru |
| `blocks/route.ts:97–102,286–287` | POST pm derivace + zápis | REZERVACE dostává skutečné pm, ne null |
| `blocks/[id]/route.ts:210,249` | PUT recompute větev | REZERVACE prochází tiskovou větví |
| `blocks/batch/route.ts:107` | `zakazkaUpdates` filtr | REZERVACE dostává server-authoritative end |
| 10 klientských snap míst (sekce 4.7) | isZakazka gate | REZERVACE start-only snap + expanze |

### (B) Byznys/workflow — REZERVACE ZŮSTÁVÁ vyloučená (jako UDRZBA), beze změny

| Soubor:řádek | Proč se NEMĚNÍ |
|---|---|
| `blocks/[id]/complete/route.ts:39` | potvrzení tisku existuje jen pro ZAKAZKA — REZERVACE se netiskne |
| `blocks/[id]/expedition/route.ts:170,187` | expedice je zakázkový koncept |
| `blocks/[id]/route.ts:318` (`mustClearExpeditionState`) | totéž — expedice zůstává ZAKAZKA-only |
| `blocks/[id]/route.ts:356` (preset applicability) | presety mají VLASTNÍ dvojici flagů (`appliesToZakazka`/`appliesToRezervace`), geometrie se jich netýká |
| `job-presets/route.ts:160` | totéž |
| `jobPresets.ts:100,199,202,219` | totéž |
| `jobPresetServer.ts:47` | totéž |
| `blockVariants.ts:23` | `blockVariant` (POZASTAVENO…) je ZAKAZKA-specifický koncept |
| `splitCompute.ts:37` + `split/route.ts:119,138,192` | split zůstává ZAKAZKA-only (viz „K rozhodnutí" #7) |
| `printMidpoint` (`printTimeClient.ts:288`) | vlastní gate, závislý na splitu — viz výše |
| `dtpOverview.ts:44,78` | DTP přehled je ZAKAZKA-specifický |
| `BlockDetail.tsx:45`, `DtpPanel.tsx:75` | zobrazení elapsed vs. pm — kosmetická parita s 4.8, ne funkční blokátor; drobná UI oprava mimo hlavní rozsah |
| `BlockCard.tsx` (7 míst: 344–394, 1277–1771) | tiskařské UI (tlačítko Hotovo, poznámky, notifikace o zpoždění) — ZAKAZKA-specifický workflow |
| `BlockEdit.tsx:941,1028`, `JobBuilderPanel.tsx:100–203`, `useJobBuilder.ts:70,396,442,463` | DATA/MATERIÁL/PANTONE panely a jejich viditelnost — ZAKAZKA-specifické; `useJobBuilder.ts:463` (`printMinutes` do payloadu) patří DO skupiny (A), viz pozn. níže |
| `monitorView.ts:17,152,153,250` | Monitor rezervace nezobrazuje vůbec (byznysové rozhodnutí, ne geometrie) — beze změny |
| `tiskarBlockView.ts:255` | tiskařský specifikační pás — ZAKAZKA-only UI |
| `report/*` route `type === "ZAKAZKA"` vnější gate před `blockReportSegments` | viz 4.8 — vědomě ponecháno, dokud „K rozhodnutí" #5 nerozhodne |
| `PlannerPage.tsx:3578–3583` | viditelnost v `isTiskar` režimu, výslovně mimo rozsah (komentář v kódu to zakazuje měnit) |

**Pozn. k `useJobBuilder.ts:463`:** `...(type === "ZAKAZKA" ? { printMinutes: ... } : {})`
patří LOGICKY do skupiny (A) — builder musí u REZERVACE nově taky poslat `printMinutes`.
Uvedeno v tabulce (B) jen proto, že sousedí s ostatními JobBuilder gaty; při implementaci
patří do stejné dávky jako 4.7/4.8, ne do „netýká se".

---

## 6. K rozhodnutí

Devět otevřených otázek. U každé doporučení a dopad — Vojta rozhoduje ráno, spec sám
NEROZHODUJE.

**1. Strop chain pushe pro REZERVACE.** Ponechat `MAX_RIGID_PUSH_MS` = 7 dní jako
speciální REZERVACE-only strop (i když geometricky běží ZAKAZKA větví), nebo REZERVACE
zdědí bezhorizontové chování ZAKAZKA (sdílí otevřený dluh P31 — žádný strop, jen kaskádové
potvrzení z etapy 6 jako brzda)?
*Dopad:* strop = bezpečnější pro rezervace (méně důležité obchodně než zakázka, ale citlivé
na komunikaci se zákazníkem — teleport o měsíc je hůř vysvětlitelný obchodníkovi než
plánovači). Bez stropu = konzistence „se vším všudy", ale dědí neopravenou třídu chyby P31.
*Doporučení:* ponechat efektivní strop specificky pro REZERVACE (implementačně: `chainPushGeometry`
vrátí `rigid: false` ale s vlastním `maxPushMs` polem, ne jen boolean) — dokud P31 není
vyřešen pro ZAKAZKA, nekopírovat neopravenou vlastnost na druhý typ.

**2. `scheduleBypassed` pro REZERVACE — ano/ne?**
*Dopad:* bez toho nejde vědomě odložit rezervaci mimo kalendář (funkce, kterou ZAKAZKA má).
*Doporučení:* ano — konzistentní se „vším všudy", implementačně už pokryto sekcí 4 (early-return
guardy jsou společné pro validaci i bypass).

**3. Komu jde drift notifikace u REZERVACE?**
*Dopad:* dnešní kanál (PLANOVAT+ADMIN) řeší plánovací poruchu, ne obchodní komunikaci se
zákazníkem.
*Doporučení:* ponechat stejný kanál jako ZAKAZKA (drift = plánovačova věc); `scheduled*`-sync
notifikaci obchodníkovi (bod 6 níž) řešit jako SAMOSTATNÝ kanál, ne totéž.

**4. Rezervace v klientské undo historii — MOVE/reflow.**
Dnes CREATE/DELETE undo rezervaci vylučuje (business-side-effect důvod), MOVE/reflow ne.
*Doporučení:* ponechat MOVE/reflow beze změny (zahrnuté) — nemá to stejný side-effect problém
jako CREATE/DELETE, jen musí platit prerekvizita ze sekce 2 i při undu.

**5. Reporty vytížení — počítat REZERVACE do `blockReportSegments`?** ★ nejdůležitější,
přímý dopad na reportované % vytížení strojů vedení.
*Dopad ANO:* rezervace (často jen držená kapacita, ne odvedená práce) by se míchala do
metriky „kolik jsme reálně vytiskli" — riziko třídy P22 (čitatel/jmenovatel nad různou
množinou, pokud se nerozliší důsledně všude).
*Dopad NE:* konzistentní s dnešní definicí vytížení, ale reporty pak nezachytí, že stroj má
část kapacity dlouhodobě rezervovanou.
*Doporučení:* NE zpočátku — držet report scope na ZAKAZKA (sekce 4.8 to už navrhuje jako
default). Pokud Vojta chce vidět rezervovanou kapacitu v reportu, patří to jako VLASTNÍ,
odlišený ukazatel („rezervovaná kapacita" vedle „vytížení"), ne tiché sečtení do jednoho čísla.

**6. Notifikace o posunu rezervace (`RESERVATION_RESCHEDULED`) — na každý posun, nebo nad
prahem?**
*Doporučení:* na každou SKUTEČNOU změnu `scheduled*` (ne no-op), ale dedupovat v rámci jedné
transakce na jednu notifikaci na rezervaci (ne jednu na každý chain-push krok).

**7. Split rezervace — v rozsahu etapy 9?**
*Doporučení:* zůstává mimo rozsah (nedělitelná jako dnes). Plánový seznam 9 bodů split
vůbec nezmiňuje — rozšíření by bylo tiché přidání rozsahu (P20 poučení), ne požadované
chování. Otevřít jako samostatnou budoucí etapu, pokud se ukáže potřeba.

**8. Kdo schvaluje dry-run backfillu?**
*Doporučení:* Vojta osobně review reportu (počet konformních / neshodných / nezarovnaných
řádků) před ostrým zápisem — parita s pravidlem „Zálohu první".

**9. Self-shift větev v POST pro REZERVACE bez `resolveChain` (sekce 4.2).**
*Doporučení:* odstranit, sladit s cestou ZAKAZKA (bez `resolveChain` kolize vrátí 409, ne
tichý sebeposun). Mění pozorovatelné chování u jedné konkrétní cesty (queue-drop bez
zapnutého chain pushe) — proto vyjmenováno zvlášť, ne jen v sekci 4.

---

## 7. Rizika a zpětná kompatibilita

- **Sekvenční závislost na Etapě 6 (dokončení autoposunové vlny).** Jakmile REZERVACE
  dostane bezhorizontovou/tiskovou chain push geometrii, hrozí PŘESNĚ třída havárie P31
  (posun o pauzu → kaskáda desítek bloků) — tentokrát přes rezervace. Etapa 9 SMÍ jít do
  produkce až PO zapnutí `CASCADE_CONFIRM_ENFORCED` (etapa 6), jinak první backfill+flip
  proběhne bez jakékoli pojistky. Plán to už řadí takhle (V3: 0→6→1→7→3→8/9), spec to
  potvrzuje jako TVRDOU podmínku, ne jen doporučené pořadí.
- **Kolize s Etapou 3** (skupinový přesun) nad `snapGroupDeltaStartOnly`/
  `snapGroupDeltaWithTemplates` a multi-move v `TimelineGrid.tsx` — viz 4.7. Koordinovat
  implementaci, ne stavět nezávisle a doufat v bezešvý merge.
- **Backfill retroaktivně mění efektivní délku existujících nekonformních rezervací.**
  Rezervace, která dnes leží z větší části mimo pracovní dobu, dostane po inverzi nízké
  `printMinutes` — při PRVNÍM dalším dotyku (drag, chain push, „Přepočítat") se může výrazně
  přeskupit (kratší, nebo naopak roztažená přes víc pauz, než uživatel čekal). Zvážit jednu
  řízenou reflow vlnu hned po nasazení (transparentně, s reportem „těchto N rezervací se
  posunulo o X"), místo aby se to promítalo nekontrolovaně přes týdny.
- **`MIN_PRINT_SEGMENT_MINUTES` (60 min) nově platí i pro REZERVACE** — chain push může
  rezervaci rozdělit na kus pod minimem a celý ji přeskočit za pauzu (chování, které dnes
  rigidní rezervace nikdy nezažila). Nový pozorovatelný jev, ne bug — ale je potřeba ho
  zdokumentovat/komunikovat.
- **Produkční dopad je dnes pravděpodobně malý** (memory dluhu: `reservationId` byl na
  produkci vždy `null`, modul se nepoužívá) — ALE `type = "REZERVACE"` bloky BEZ vazby na
  `Reservation` (plánovač je zakládá přímo přes builder) na produkci existovat MOHOU. Před
  backfillem ověřit `SELECT COUNT(*) FROM Block WHERE type='REZERVACE'` na produkci — pokud
  je vyšší než očekáváno, riziko roste úměrně.
- **Regresní povrch je velký** — ~25 míst v 8+ souborech (sekce 4+5). Doporučeno: strážný
  test, který PROJEDE celý obor hodnot `type` (`ZAKAZKA`/`REZERVACE`/`UDRZBA`) přes
  `blockPrintMinutes`/`tryExpandForBlock`/`chainPushGeometry`, ne jen dvouhodnotovou
  dichotomii — poučení P17.

---

## 8. Hrubý odhad etap implementace

**Fázování je závazné pořadí, ne návrh k výběru** — každá fáze je prerekvizitou další.

1. **Prerekvizita (sekce 2):** `syncReservationScheduleForBlocks` + zapojení na 6 cest +
   strážný test. Odhad **S/M** (~1 den).
2. **Jádro — geometrie (sekce 3, 4.1–4.7):** server guardy, backfill skript + dry-run +
   Vojtovo review + ostrý zápis, chain push geometrie, 10 klientských snap míst. Odhad
   **L** (3–4 dny). Nesmí startovat, dokud Etapa 6 (`CASCADE_CONFIRM_ENFORCED`) neběží na
   produkci/testu.
3. **Drift/reflow/reporty (sekce 4.8–4.10):** broadening `detectCalendarDrift`, parita
   testů, reflow guard, CLAUDE.md update, rozhodnutí #5 (reporty) musí padnout PŘED touhle
   fází, protože mění testovací očekávání. Odhad **M** (1–2 dny).
4. **Undo/polish (sekce 4.11) + proklik:** ověřit MOVE/reflow undo e2e se sync helperem,
   vizuální QA (pauza uvnitř bloku, drift štítek), proklik na testovací instanci s Lukášem.
   Odhad **S** (~1 den).

**Celkem: L (velká etapa), 6–8 pracovních dní** — odpovídá odhadu v plánu úprav.
