# Skupinový přesun zakázek přes noc — per-blok snap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nahradit sdílenou skupinovou deltu (`snapGroupDeltaStartOnly`) lasso přesunu individuálním per-blok snapem se zachováním pořadí (`snapGroupPerBlock`), aby tažení skupiny zpět přes hranici směny přestalo být tichý no-op a tažení dopředu přestalo teleportovat celou skupinu o den.

**Architecture:** Nová čistá funkce `snapGroupPerBlock` (`src/lib/printTimeClient.ts`) zpracuje vybrané bloky seřazené podle původního startu v JEDNOM průchodu (žádná iterační smyčka): první blok se snapne na nejbližší běžící slot od `start + delta`, každý další na `max(vlastní snapnutý start, tiskový konec předchůdce)` — s per-blok dispatchem podle typu (ZAKAZKA = start-only snap + `expandPrintTime`, REZERVACE/UDRZBA = rigidní `snapToNextValidStartWithTemplates`) a bez re-snapu odložených (`scheduleBypassed`) členů. `TimelineGrid.tsx` větev `multi-move` v `onMouseUp` volá tuto funkci místo staré společné delty; `POST /api/blocks/batch` (a s ním celý kaskádový/undo mechanismus) se NEMĚNÍ — batch už dnes per-blok `startTime` přijímá a `endTime` si pro ZAKAZKA sám přepočítá z `printMinutes` (`batch/route.ts:110-129`).

**Tech Stack:** Next.js 16 · TypeScript · node:test + tsx (žádné DOM testy — `TimelineGrid.tsx` drag logika se v repu netestuje jednotkově, jen extrahovaná čistá logika v `printTimeClient.ts`/`workingTime.ts`; wiring se ověřuje manuálně na dev).

**Spec:** `docs/audits/2026-08-18-audit-vlakna-planovace-lukas.md` (E-mail 12. 8., bod 1, ř. 79–85) + `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` (Etapa 3, ř. 70–91, kroky 3a/3b/3c + rizika — tento plán implementuje 3a a 3b včetně všech vyjmenovaných rizik; krok 3c NENÍ součástí, viz Global Constraints).

## Global Constraints

- **Krok 3c (náhled všech vybraných bloků na snapnutých pozicích v mousemove) je VĚDOMĚ ODLOŽEN.** Preview za tažení zůstává dnešní chování — jen kotva (`ds.anchorBlockId`) se kreslí s hrubou deltou, ostatní bloky vizuálně "jedou s ní" beze snapu, dokud uživatel nepustí myš. Teprve `onMouseUp` počítá per-blok snap a posílá přesné pozice na server. Důsledek: mezi puštěním myši a příchodem odpovědi serveru může na zlomek vteřiny viset karta na "hrubé" pozici, než ji přepíše `onBlockUpdate`/`onMultiBlockUpdate` skutečnými hodnotami — to je dnešní chování, tento plán ho nemění. Dotažení do drobné samostatné etapy později (viz zadání).
- **Server (`POST /api/blocks/batch`) se v tomto plánu NEMĚNÍ.** Batch route dnes: (1) pro ZAKAZKA ignoruje klientův `endTime` a počítá ho sám z `printMinutes` přes `validateAndComputeEnd` (`batch/route.ts:110-129`), (2) `bypassScheduleValidation || existing.scheduleBypassed` je sticky OR — odložený blok server sám neroze-expanduje, i kdyby klient poslal "špatný" start, (3) při `resolveChain: true` volá `resolveChainPushFromDb` s **kaskádovým potvrzením** (`cascadeConfirmed`, `assertCascadeConfirmed(measureCascade(...), { path: "batch-total", ... })`) a vrací `CASCADE_CONFIRM` chybu, kterou `fetchWithCascadeConfirm` v `PlannerPage.tsx`/`TimelineGrid.tsx` zachytává a promění v potvrzovací dialog. Tento plán mění JEN to, jaké `startTime`/`endTime` klient do `updates` pole POŠLE — cesta k serveru (`handleMultiBlockUpdate` → `fetchWithCascadeConfirm` → `askCascade`) i undo (`buildMoveCommand`) zůstávají beze změny.
- **`snapGroupDeltaStartOnly` (`printTimeClient.ts`) a `snapGroupDeltaWithTemplates` (`workingTime.ts`) mají jediného konzumenta — `TimelineGrid.tsx`** (ověřeno greppem `grep -rln "snapGroupDeltaStartOnly\|snapGroupDeltaWithTemplates" src`). Po Tasku C se smažou i s vlastními testy v `printTimeClient.test.ts` (workingTime.ts nemá vlastní test soubor).
- **`expandPrintTime` (`src/lib/printTime.ts`) je JEDINÝ sdílený zdroj expanze** — klient (`printTimeClient.ts`) i server (`printTime.server.ts` → `expandPrintTimeFromDb`) ho volají stejný. Matematika expanze se proto strukturálně nemůže rozejít; jediné reziduální riziko je zastaralost klientova `machineWeekShiftsRef`/`companyDaysRef` vůči DB v okamžiku requestu — to je STÁVAJÍCÍ riziko všech klientských snapů (jednotlivý přesun ho má taky) a tento plán ho neřeší nově.
- Test suite (glob nejde do podsložek — každá složka zvlášť, viz `CLAUDE.md`):
  `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
- `npm run build` a `npm run lint` musí být čisté (0 chyb) před dokončením poslední etapy.

---

### Task A (krok 3a): UX záplata hlášek v multi-move větvi (samostatně commitovatelná)

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx` (větev `multi-move` v `onMouseUp`, dnes ř. ~1153–1178)

**Interfaces:**
- Consumes: stávající `snapGroupDeltaStartOnly` (`printTimeClient.ts`), `snapGroupDeltaWithTemplates` (`workingTime.ts`) — beze změny signatur, jen jak se čte jejich výsledek.
- Produces: rozlišení tří stavů namísto jednoho `onError`, beze změny `updates` tvaru poslaného do `onMultiBlockUpdate`.

Tahle úprava cílí na DNEŠNÍ kód (ještě před Taskem B/C) — je to nezávislá, okamžitě nasaditelná oprava zavádějícího červeného toastu. Task C ji později PŘEPÍŠE (nahradí novou, jednodušší dvoubranchovou logikou, protože scénář "delta ≈ 0 navzdory nenulovému návrhu" po Tasku B strukturálně nemůže nastat) — to je očekávaný vývoj v rámci téhož plánu, ne konflikt.

- [ ] **Step 1: Najdi přesnou dnešní podobu větve a over ji, než edituješ**

Run: `grep -n 'ds.type === "multi-move"' -A 40 src/app/_components/TimelineGrid.tsx | sed -n '1,45p'`

Over, že vidíš přesně tento tvar (pokud se řádky posunuly, hledej podle citovaného kódu, ne podle čísla):

```typescript
      } else if (ds.type === "multi-move") {
        let deltaMs = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
        // Určit cílový stroj PŘED snapem — snap musí validovat podle správného stroje
        const newMachine = clientXToMachine(e.clientX);
        if (workingTimeLockRef.current) {
          const blocksOnNewMachine = ds.blocks.map((b) => ({ ...b, machine: newMachine }));
          const zakazkaOnly = blocksOnNewMachine.every((b) => b.type === "ZAKAZKA");
          if (zakazkaOnly) {
            const r = snapGroupDeltaStartOnly(
              blocksOnNewMachine.map((b) => ({ machine: b.machine, originalStart: b.originalStart })),
              deltaMs,
              machineWeekShiftsRef.current ?? [],
              companyDaysRef.current ?? []
            );
            if (!r) {
              callbacksRef.current.onError?.("V okolí není žádný pracovní slot — bloky nelze umístit.");
              return;
            }
            deltaMs = r.deltaMs;
            if (r.wasSnapped) callbacksRef.current.onError?.("Bloky přeskočeny přes víkend/noc");
          } else {
            // smíšený výběr: starý duration-based snap (ne-ZAKAZKA server nevaliduje)
            const { deltaMs: snapped, wasSnapped } = snapGroupDeltaWithTemplates(blocksOnNewMachine, deltaMs, machineWeekShiftsRef.current ?? []);
            deltaMs = snapped;
            if (wasSnapped) callbacksRef.current.onError?.("Bloky přeskočeny přes víkend/noc");
          }
        }
        const updates    = ds.blocks.map(b => ({
          id:        b.id,
          machine:   newMachine,
          startTime: new Date(b.originalStart.getTime() + deltaMs),
          endTime:   new Date(b.originalEnd.getTime()   + deltaMs),
        }));
        callbacksRef.current.onMultiBlockUpdate?.(updates);
      }
```

- [ ] **Step 2: Nahraď za verzi s rozlišenými hláškami**

```typescript
      } else if (ds.type === "multi-move") {
        const proposedDeltaMs = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
        let deltaMs = proposedDeltaMs;
        // Určit cílový stroj PŘED snapem — snap musí validovat podle správného stroje
        const newMachine = clientXToMachine(e.clientX);
        if (workingTimeLockRef.current) {
          const blocksOnNewMachine = ds.blocks.map((b) => ({ ...b, machine: newMachine }));
          const zakazkaOnly = blocksOnNewMachine.every((b) => b.type === "ZAKAZKA");
          if (zakazkaOnly) {
            const r = snapGroupDeltaStartOnly(
              blocksOnNewMachine.map((b) => ({ machine: b.machine, originalStart: b.originalStart })),
              deltaMs,
              machineWeekShiftsRef.current ?? [],
              companyDaysRef.current ?? []
            );
            if (!r) {
              callbacksRef.current.onError?.("V okolí není žádný pracovní slot — bloky nelze umístit.");
              return;
            }
            deltaMs = r.deltaMs;
          } else {
            // smíšený výběr: starý duration-based snap (ne-ZAKAZKA server nevaliduje)
            const { deltaMs: snapped } = snapGroupDeltaWithTemplates(blocksOnNewMachine, deltaMs, machineWeekShiftsRef.current ?? []);
            deltaMs = snapped;
          }
          // UX (etapa 3a, audit 12. 8. bod 1): rozlišit no-op / velký posun / normální snap.
          // Beze změny delty (deltaMs === proposedDeltaMs) → nic nehlásit, běžný přesun.
          // Rohatka umí korigovat jen DOPŘEDU — tažení skupiny ZPĚT přes hranici směny
          // ji sežere skoro na nulu i přes nenulový návrh (tichý no-op, hlavní nahlášený
          // symptom „nefunguje") → adresná hláška místo mlčení a beze změny na obrazovce.
          // Jinak jde o normální korekci mimo pracovní dobu → onInfo (NE onError — nejde
          // o chybu, blok se přesunul, jen jinam, než uživatel pustil myš).
          if (deltaMs !== proposedDeltaMs) {
            if (Math.abs(deltaMs) < SLOT_MS && proposedDeltaMs !== 0) {
              callbacksRef.current.onError?.("Skupinu nelze posunout zpět přes hranici směny — přesuňte bloky jednotlivě.");
            } else {
              callbacksRef.current.onInfo?.("Bloky posunuty mimo pracovní dobu — automaticky umístěny do nejbližšího dostupného slotu.");
            }
          }
        }
        const updates    = ds.blocks.map(b => ({
          id:        b.id,
          machine:   newMachine,
          startTime: new Date(b.originalStart.getTime() + deltaMs),
          endTime:   new Date(b.originalEnd.getTime()   + deltaMs),
        }));
        callbacksRef.current.onMultiBlockUpdate?.(updates);
      }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: 0 TS chyb.

- [ ] **Step 4: Ruční ověření na dev (port 3001)**

Vytvoř lasem výběr 2–3 zakázek na stroji s víkendovou odstávkou (fixtura `xl106Week`: Pá 22:00 – Ne 22:00 mimo provoz). Zkus:
1. Malý posun v rámci pracovní doby → žádný toast, bloky se přesunou přesně tam, kam je uživatel pustil.
2. Tažení dopředu tak, aby delta spadla do odstávky → modrý/info toast "Bloky posunuty mimo pracovní dobu…", bloky se posunou na nejbližší běžící slot (dnešní teleport-o-den bug tu ještě BUDE — opravuje ho až Task B/C).
3. Tažení zpět přes hranici směny tak, aby dnešní rohatka sežrala deltu na ~0 → červený toast "Skupinu nelze posunout zpět přes hranici směny — přesuňte bloky jednotlivě." namísto tichého no-opu.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "$(cat <<'EOF'
fix(cascade): rozlisit hlasky no-op/snap/chyba pri skupinovem presunu

Rohatka snapGroupDeltaStartOnly umi korigovat jen dopredu - tazeni skupiny
zpet pres hranici smeny ji sezere na deltu ~0 (tichy no-op, hlavni nahlaseny
symptom "nefunguje"). Misto mlceni ted dostane uzivatel adresnou hlasku;
normalni korekce mimo pracovni dobu jde pres onInfo misto zavadejiciho
cerveneho onError.

Docasna zaplata na soucasnem kodu - krok 3b/3c (per-blok snap) nahradi
tuhle vetev novou logikou, viz plan 2026-08-20-skupinovy-presun-pres-noc.md.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B (krok 3b, jádro): `snapGroupPerBlock` — per-blok snap se zachováním pořadí

**Files:**
- Modify: `src/lib/printTimeClient.ts`
- Modify: `src/lib/printTimeClient.test.ts`

**Interfaces:**
- Consumes: `snapStartToNextRunnableSlot`, `expandPrintTime`, `SLOT_MS`, `CompanyDayInterval` (z `printTime.ts`, už importované); `snapToNextValidStartWithTemplates` (z `workingTime.ts` — NOVÝ import do `printTimeClient.ts`); `blockPrintMinutes`, `companyDayIntervalsFor` (stejný soubor).
- Produces:
  ```typescript
  export type GroupSnapBlock = {
    id: number;
    machine: string;
    type: string;
    originalStart: Date;
    originalEnd: Date;
    printMinutes?: number | null;
    scheduleBypassed?: boolean | null;
  };
  export type GroupSnapResult = { id: number; start: Date; end: Date };
  export function snapGroupPerBlock(
    blocks: GroupSnapBlock[],
    proposedDeltaMs: number,
    weekShifts: MachineWeekShiftsRow[],
    companyDays: CompanyDayClientRow[]
  ): { results: GroupSnapResult[]; wasSnapped: boolean } | null
  ```
  `results` NENÍ nutně ve stejném pořadí jako vstup (interně se řadí dle `originalStart`) — volající musí párovat podle `id`. `null` = některý blok nejde v horizontu umístit (analogie dnešního „V okolí není žádný pracovní slot"). `wasSnapped` = alespoň jeden blok skončil jinde, než by ho položila holá `proposedDeltaMs` (pro UX hlášku v Tasku C).

**Algoritmus (přesně podle specu etapy 3b):**
1. Seřadit bloky podle `originalStart` vzestupně.
2. Pro KAŽDÝ blok v tomto pořadí (jeden průchod, ŽÁDNÁ vnější iterační smyčka — na rozdíl od staré 5pokusové konvergence, která u scénáře D nekonvergovala):
   - **`scheduleBypassed === true`** → posunout DOSLOVNĚ o `proposedDeltaMs` (žádný snap, žádné navázání na předchůdce) — sticky-OR chování se řídí serverem (`batch/route.ts:120-123`), klient nesmí odloženého člena znovu vtáhnout do kalendáře.
   - **jinak, `type === "ZAKAZKA"`**: vlastní start = `snapStartToNextRunnableSlot(machine, originalStart + delta, weekShifts, companyDayIntervalsFor(machine, companyDays))`. Pokud `null` → celá funkce vrací `null`.
   - **jinak (REZERVACE/UDRZBA)**: vlastní start = `snapToNextValidStartWithTemplates(machine, originalStart + delta, originalEnd - originalStart, weekShifts)` (rigidní, přesná délka — nikdy expanze).
   - Pokud existuje `prevEnd` (konec PŘEDCHOZÍHO zpracovaného bloku v pořadí, ať šlo o ZAKAZKA nebo rigidní) A `prevEnd > vlastní start`: přepočítat start jako TENTÝŽ per-typový snap, ale volaný z `prevEnd` místo z `originalStart + delta` (zajišťuje, že se výsledný start znovu ověří jako běžící — `prevEnd` může padnout přesně na hranici pauzy, kde už blok stát nesmí).
   - Spočítat `end`: ZAKAZKA → `expandPrintTime(machine, start, printMinutes, weekShifts, companyDayIntervalsFor(...), false)`; pokud `!ok` → celá funkce vrací `null`. REZERVACE/UDRZBA/bypass → `start + (originalEnd - originalStart)` (rigidní/doslovná délka).
   - Uložit `{ id, start, end }`, nastavit `prevEnd = end`.
3. `wasSnapped` = true, pokud se u ALESPOŇ JEDNOHO ne-bypass bloku finální `start` liší od `originalStart + proposedDeltaMs`.

- [ ] **Step 1: Failing testy — scénáře A–D z frameworku etapy 3**

Přidej do `src/lib/printTimeClient.test.ts` dvě úpravy importů (fixtury `W1`, `W2`, `pragueToUTC` už jsou v souboru importované, `xl106Week` taky):
1. Do existujícího importu z `./printTimeClient` (dnes ř. 4–15) dopln `snapGroupPerBlock`.
2. Existující řádek `import { xl106Week, W1, W2 } from "./weekShiftsTestFixtures";` (dnes ř. 16) rozšiř o `mkDay` (potřeba pro scénář D níž):

```typescript
import { mkDay, xl106Week, W1, W2 } from "./weekShiftsTestFixtures";
```

```typescript
test("snapGroupPerBlock — scénář A: tažení dopředu přes noc nechá přední bloky na místě, jen ocas přeteče", () => {
  // Blok 1 Pá 20:00-21:00 (60 min), blok 2 Pá 21:00-21:30 (30 min) — těsně před
  // koncem páteční směny (ta končí 22:00). Delta +1h: první blok skončí přesně
  // na hranici (21:00-22:00, žádný přesah). Druhý by naivně začal přesně
  // v odstávce (Pá 22:00) a musí SÁM přeskočit na Ne 22:00 — bez teleportu
  // prvního bloku, který zůstává na místě (jeho naivní pozice je sama o sobě
  // platná, není co snapovat).
  const blocks = [
    { id: 1, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-21", 20), originalEnd: pragueToUTC("2026-08-21", 21), printMinutes: 60 },
    { id: 2, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-21", 21), originalEnd: pragueToUTC("2026-08-21", 21, 30), printMinutes: 30 },
  ];
  const r = snapGroupPerBlock(blocks, 3600000, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(r);
  const b1 = r!.results.find((x) => x.id === 1)!;
  const b2 = r!.results.find((x) => x.id === 2)!;
  assert.deepEqual(b1.start, pragueToUTC("2026-08-21", 21), "první blok zůstává v pracovní době, žádný teleport");
  assert.deepEqual(b1.end, pragueToUTC("2026-08-21", 22));
  assert.deepEqual(b2.start, pragueToUTC("2026-08-23", 22), "druhý blok sám přeskočí odstávku na Ne 22:00");
  assert.deepEqual(b2.end, pragueToUTC("2026-08-23", 22, 30));
  assert.equal(r!.wasSnapped, true);
});

test("snapGroupPerBlock — scénář B: tažení zpět přes hranici směny stáhne k nejbližšímu platnému slotu (žádný no-op)", () => {
  // Blok Po 08:00-10:00, delta -34h by ho poslala do soboty (odstávka celý den).
  const blocks = [
    { id: 1, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-24", 8), originalEnd: pragueToUTC("2026-08-24", 10), printMinutes: 120 },
  ];
  const r = snapGroupPerBlock(blocks, -34 * 3600000, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(r);
  const b1 = r!.results[0]!;
  // Naivní cíl by byl So 22.8. 22:00 (odstávka) → musí se posunout dopředu na Ne 22:00.
  assert.deepEqual(b1.start, pragueToUTC("2026-08-23", 22));
  assert.notDeepEqual(b1.start, blocks[0]!.originalStart, "žádný tichý no-op — pozice se skutečně změnila");
  assert.equal(r!.wasSnapped, true);
});

test("snapGroupPerBlock — scénář C: žádný falešný intra-batch překryv po expanzi přes pauzu", () => {
  // Dva bloky původně s malou mezerou (Pá 20:00-21:30 a Pá 21:30-23:00 by kolidoval s
  // odstávkou); delta 0 — ověřuje, že sekvenční expanze druhého bloku od konce prvního
  // (přes pauzu) nevyrobí start dřív, než končí předchůdce.
  const blocks = [
    { id: 1, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-21", 20), originalEnd: pragueToUTC("2026-08-21", 21, 30), printMinutes: 90 },
    { id: 2, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-23", 22), originalEnd: pragueToUTC("2026-08-24", 0), printMinutes: 120 },
  ];
  const r = snapGroupPerBlock(blocks, 0, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(r);
  const b1 = r!.results.find((x) => x.id === 1)!;
  const b2 = r!.results.find((x) => x.id === 2)!;
  assert.ok(b2.start.getTime() >= b1.end.getTime(), "druhý blok nezačíná dřív, než končí první");
  assert.equal(r!.wasSnapped, false, "beze změny delty se nic nesnapuje");
});

test("snapGroupPerBlock — scénář D: jeden průchod, žádná iterace — vrací null místo nekonvergující smyčky", () => {
  // Odstávka pokrývající CELÝ horizont MAX_SPAN_DAYS (21 dní) od navrhovaného startu —
  // čtyři po sobě jdoucí týdny (chybějící týden by tiše spadl na hardcoded fallback
  // rozvrh, který NENÍ vždy blokovaný — viz isBlockedSlotDynamic). Funkce musí selhat
  // rychle a čitelně (null), ne padat do nekonečné/nekonvergentní smyčky.
  const offWeeks = [W1, W2, "2026-08-31", "2026-09-07"].flatMap((ws) =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => mkDay(ws, d, { active: false }))
  );
  const blocks = [
    { id: 1, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-17", 8), originalEnd: pragueToUTC("2026-08-17", 10), printMinutes: 120 },
  ];
  const r = snapGroupPerBlock(blocks, 3600000, offWeeks, []);
  assert.equal(r, null);
});

test("snapGroupPerBlock — scheduleBypassed člen se posune doslovně, neúčastní se snapu ani řetězu", () => {
  const blocks = [
    { id: 1, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-22", 10), originalEnd: pragueToUTC("2026-08-22", 12), printMinutes: 120, scheduleBypassed: true },
  ];
  const r = snapGroupPerBlock(blocks, 3600000, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(r);
  // So 10:00 + 1h = So 11:00 — leží v odstávce, ALE bypass blok se nesnapuje.
  assert.deepEqual(r!.results[0]!.start, pragueToUTC("2026-08-22", 11));
  assert.deepEqual(r!.results[0]!.end, pragueToUTC("2026-08-22", 13));
});

test("snapGroupPerBlock — smíšený výběr: REZERVACE se snapuje rigidně (přesná délka), ne přes expanzi", () => {
  const blocks = [
    { id: 1, machine: "XL_106", type: "ZAKAZKA", originalStart: pragueToUTC("2026-08-21", 18), originalEnd: pragueToUTC("2026-08-21", 20), printMinutes: 120 },
    { id: 2, machine: "XL_106", type: "REZERVACE", originalStart: pragueToUTC("2026-08-21", 20), originalEnd: pragueToUTC("2026-08-21", 21) },
  ];
  const r = snapGroupPerBlock(blocks, 3600000, [...xl106Week(W1), ...xl106Week(W2)], []);
  assert.ok(r);
  const b2 = r!.results.find((x) => x.id === 2)!;
  // Rigidní délka 1h se zachovává přesně, žádné rozpuštění přes pauzu.
  assert.equal(b2.end.getTime() - b2.start.getTime(), 3600000);
});
```

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: FAIL — `snapGroupPerBlock is not a function`.

- [ ] **Step 2: Implementace v `src/lib/printTimeClient.ts`**

Rozšiř import z `workingTime.ts` (nový soubor v importech — dnes tam `workingTime.ts` importovaný NENÍ):

```typescript
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";
```

Za funkci `snapGroupDeltaStartOnly` (zůstává beze změny, dokud ji Task C nesmaže) přidej:

```typescript
export type GroupSnapBlock = {
  id: number;
  machine: string;
  type: string;
  originalStart: Date;
  originalEnd: Date;
  printMinutes?: number | null;
  scheduleBypassed?: boolean | null;
};

export type GroupSnapResult = { id: number; start: Date; end: Date };

/**
 * Per-blok snap skupinového (lasso) přesunu se zachováním pořadí — nahrazuje
 * sdílenou deltu (`snapGroupDeltaStartOnly`), která byla "rohatka" umějící
 * korigovat jen dopředu (audit 12. 8. bod 1, plán etapy 3).
 *
 * Bloky se zpracují SEŘAZENÉ dle originalStart, v JEDNOM průchodu (žádná
 * vnější iterace jako stará 5pokusová konvergence — ta u nekonvergujícího
 * vstupu vracela nediagnostické 422). První blok se snapne z `start + delta`;
 * každý další nesmí začít dřív, než tiskově končí předchůdce (`prevEnd`) —
 * proto se v tom případě znovu snapne, tentokrát OD `prevEnd`.
 *
 * Per-blok dispatch podle typu: ZAKAZKA = start-only snap + expandPrintTime
 * (délka se rozloží přes kalendář); REZERVACE/UDRZBA = rigidní snap se
 * ZACHOVANOU přesnou délkou (žádná expanze). `scheduleBypassed` členy se
 * posouvají DOSLOVNĚ o `proposedDeltaMs` — nesmí se re-expandovat (server
 * má na bypass sticky-OR, viz batch/route.ts) ani navazovat na řetěz.
 *
 * Vrací `null`, když některý (ne-bypass) blok nejde v horizontu umístit —
 * volající mutaci neodešle (analogie dnešního "V okolí není žádný pracovní
 * slot"). `wasSnapped` signalizuje UI, že se něco reálně přeplánovalo.
 */
export function snapGroupPerBlock(
  blocks: GroupSnapBlock[],
  proposedDeltaMs: number,
  weekShifts: MachineWeekShiftsRow[],
  companyDays: Parameters<typeof companyDayIntervalsFor>[1]
): { results: GroupSnapResult[]; wasSnapped: boolean } | null {
  const sorted = [...blocks].sort((a, b) => a.originalStart.getTime() - b.originalStart.getTime());
  const intervalsByMachine = new Map<string, ReturnType<typeof companyDayIntervalsFor>>();
  const intervalsFor = (m: string) => {
    if (!intervalsByMachine.has(m)) intervalsByMachine.set(m, companyDayIntervalsFor(m, companyDays));
    return intervalsByMachine.get(m)!;
  };

  const results: GroupSnapResult[] = [];
  let wasSnapped = false;
  let prevEnd: Date | null = null;

  for (const b of sorted) {
    const naiveStart = new Date(b.originalStart.getTime() + proposedDeltaMs);
    const durationMs = b.originalEnd.getTime() - b.originalStart.getTime();

    if (b.scheduleBypassed) {
      const start = naiveStart;
      const end = new Date(start.getTime() + durationMs);
      results.push({ id: b.id, start, end });
      prevEnd = end;
      continue;
    }

    const isZakazka = b.type === "ZAKAZKA";
    const snapOwn = (from: Date): Date | null =>
      isZakazka
        ? snapStartToNextRunnableSlot(b.machine, from, weekShifts, intervalsFor(b.machine))
        : snapToNextValidStartWithTemplates(b.machine, from, durationMs, weekShifts);

    let start = snapOwn(naiveStart);
    if (!start) return null;
    if (start.getTime() !== naiveStart.getTime()) wasSnapped = true;

    if (prevEnd && prevEnd.getTime() > start.getTime()) {
      const bumped = snapOwn(prevEnd);
      if (!bumped) return null;
      if (bumped.getTime() !== start.getTime()) wasSnapped = true;
      start = bumped;
    }

    let end: Date;
    if (isZakazka) {
      const pm = blockPrintMinutes({ type: b.type, printMinutes: b.printMinutes, startTime: b.originalStart, endTime: b.originalEnd });
      const exp = expandPrintTime(b.machine, start, pm, weekShifts, intervalsFor(b.machine), false);
      if (!exp.ok) return null;
      end = exp.end;
    } else {
      end = new Date(start.getTime() + durationMs);
    }

    results.push({ id: b.id, start, end });
    prevEnd = end;
  }

  return { results, wasSnapped };
}
```

- [ ] **Step 3: Testy PASS**

Run: `node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: všech 6 nových testů PASS + žádný existující test nespadl.

- [ ] **Step 4: Commit**

```bash
git add src/lib/printTimeClient.ts src/lib/printTimeClient.test.ts
git commit -m "$(cat <<'EOF'
feat(cascade): snapGroupPerBlock - skupinovy presun po jednom bloku

Nahrazuje snapGroupDeltaStartOnly (sdilena delta = "rohatka", umi
korigovat jen dopredu). Novy algoritmus radi bloky dle puvodniho startu
a snapuje kazdy zvlast v JEDNOM pruchodu; kazdy dalsi nesmi zacit driv,
nez tiskove konci predchudce. Per-blok dispatch dle typu (ZAKAZKA =
expanze, REZERVACE/UDRZBA = rigidni delka), scheduleBypassed clenove
se posouvaji doslovne beze snapu.

Server (POST /api/blocks/batch) se nemeni - uz dnes prijima per-blok
startTime a end si pro ZAKAZKA pocita sam. Zapojeni do TimelineGrid
je samostatny task (3c v planu).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task C: Zapojení do `TimelineGrid.tsx` multi-move + úklid osiřelého kódu

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`
- Modify: `src/lib/printTimeClient.ts` (smazat `snapGroupDeltaStartOnly`)
- Modify: `src/lib/printTimeClient.test.ts` (smazat jeho testy)
- Modify: `src/lib/workingTime.ts` (smazat `snapGroupDeltaWithTemplates`)

**Interfaces:**
- Consumes: `snapGroupPerBlock` z Tasku B.
- Produces: `DragInternalState` varianta `multi-move` nese navíc `printMinutes`/`scheduleBypassed` na každém bloku; `onMouseUp` větev `multi-move` posílá do `onMultiBlockUpdate` per-blok pozice ze `snapGroupPerBlock` místo společné delty. Tvar `updates` posílaný do `onMultiBlockUpdate` (`{ id, machine, startTime, endTime }[]`) se NEMĚNÍ — `handleMultiBlockUpdate` v `PlannerPage.tsx` (batch POST, kaskádové potvrzení, undo `buildMoveCommand`) zůstává BEZE ZMĚNY.

- [ ] **Step 1: Rozšiř `DragInternalState` o `printMinutes`/`scheduleBypassed`**

Najdi definici (dnes ř. ~172–201):

```typescript
type DragInternalState =
  | {
      type: "move" | "resize";
      ...
    }
  | {
      type: "multi-move";
      blocks: Array<{ id: number; machine: string; type: string; originalStart: Date; originalEnd: Date }>;
      startClientY: number;
      startClientX: number;
      startScrollTop: number;
      anchorBlockId: number;
    }
  | {
      type: "shift-edge-resize";
      ...
    };
```

Uprav `multi-move` variantu:

```typescript
  | {
      type: "multi-move";
      blocks: Array<{ id: number; machine: string; type: string; originalStart: Date; originalEnd: Date; printMinutes: number | null; scheduleBypassed: boolean }>;
      startClientY: number;
      startClientX: number;
      startScrollTop: number;
      anchorBlockId: number;
    }
```

- [ ] **Step 2: Dopň zdroj dat v `handleBlockMouseDown`**

Najdi (dnes ř. ~1220–1227):

```typescript
    if (isMulti) {
      const selBlocks = blocksRef.current.filter(b => ids.has(b.id) && !b.locked);
      dragStateRef.current = {
        type: "multi-move",
        blocks: selBlocks.map(b => ({ id: b.id, machine: b.machine, type: b.type, originalStart: new Date(b.startTime), originalEnd: new Date(b.endTime) })),
        startClientY: e.clientY, startClientX: e.clientX, startScrollTop: sst,
        anchorBlockId: block.id,
      };
```

Nahraď mapování bloků:

```typescript
        blocks: selBlocks.map(b => ({ id: b.id, machine: b.machine, type: b.type, originalStart: new Date(b.startTime), originalEnd: new Date(b.endTime), printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false })),
```

- [ ] **Step 3: Nahraď import**

Najdi (dnes ř. 6):

```typescript
import { blockCalendarDrift, blockPrintMinutes, companyDayIntervalsFor, getBlockSegments, printMidpoint, snapGroupDeltaStartOnly, splitGroupTotalPrintMinutes, type CalendarDriftInfo, type PrintSegment } from "@/lib/printTimeClient";
```

Nahraď `snapGroupDeltaStartOnly` za `snapGroupPerBlock`:

```typescript
import { blockCalendarDrift, blockPrintMinutes, companyDayIntervalsFor, getBlockSegments, printMidpoint, snapGroupPerBlock, splitGroupTotalPrintMinutes, type CalendarDriftInfo, type PrintSegment } from "@/lib/printTimeClient";
```

Najdi (dnes ř. 4) a odeber `snapGroupDeltaWithTemplates` z importu (ponech `snapToNextValidStartWithTemplates` — ten dál používá větev jednoduchého `move`):

```typescript
import { snapGroupDeltaWithTemplates, snapToNextValidStartWithTemplates } from "@/lib/workingTime";
```

```typescript
import { snapToNextValidStartWithTemplates } from "@/lib/workingTime";
```

- [ ] **Step 4: Přepiš `onMouseUp` větev `multi-move`**

Nahraď CELOU větev (výsledek Tasku A, dnes ř. ~1153–1178) za:

```typescript
      } else if (ds.type === "multi-move") {
        const deltaMs    = Math.round((deltaY / sh) * 30 * 60 * 1000 / SLOT_MS) * SLOT_MS;
        // Určit cílový stroj PŘED snapem — snap musí validovat podle správného stroje
        const newMachine = clientXToMachine(e.clientX);
        const blocksOnNewMachine = ds.blocks.map((b) => ({ ...b, machine: newMachine }));

        let finalPositions: { id: number; start: Date; end: Date }[];
        if (workingTimeLockRef.current) {
          const r = snapGroupPerBlock(
            blocksOnNewMachine,
            deltaMs,
            machineWeekShiftsRef.current ?? [],
            companyDaysRef.current ?? []
          );
          if (!r) {
            callbacksRef.current.onError?.("V okolí není žádný pracovní slot — bloky nelze umístit.");
            return;
          }
          finalPositions = r.results;
          // wasSnapped: skupina se skutečně přeplánovala mimo hrubou (holou) deltu —
          // ať dopředu (víkend/noc) nebo zpět (rohatka po per-blok snapu už nemůže
          // sežrat na tichou nulu, takže se sem dostane jen skutečná korekce).
          if (r.wasSnapped) {
            callbacksRef.current.onInfo?.("Bloky posunuty mimo pracovní dobu — automaticky umístěny do nejbližšího dostupného slotu, pořadí zůstalo zachováno.");
          }
        } else {
          finalPositions = blocksOnNewMachine.map((b) => ({
            id: b.id,
            start: new Date(b.originalStart.getTime() + deltaMs),
            end: new Date(b.originalEnd.getTime() + deltaMs),
          }));
        }

        // Skutečný no-op (žádný blok nezměnil pozici ani stroj) — nezakládat prázdnou
        // dávku (žádný batch POST, žádný prázdný undo krok).
        const changed = finalPositions.some((p) => {
          const src = ds.blocks.find((b) => b.id === p.id)!;
          return p.start.getTime() !== src.originalStart.getTime() || newMachine !== src.machine;
        });
        if (!changed) return;

        const updates = finalPositions.map((p) => ({
          id:        p.id,
          machine:   newMachine,
          startTime: p.start,
          endTime:   p.end,
        }));
        callbacksRef.current.onMultiBlockUpdate?.(updates);
      }
```

- [ ] **Step 5: Smaž osiřelý `snapGroupDeltaStartOnly` z `printTimeClient.ts`**

Ověř, že po Step 3 už nemá volajícího:

Run: `grep -rn "snapGroupDeltaStartOnly" src`
Expected: jen definice ve `printTimeClient.ts` a testy v `printTimeClient.test.ts` (žádný volající v `TimelineGrid.tsx`).

Smaž celou funkci `snapGroupDeltaStartOnly` (dnes ř. ~66–101, včetně JSDoc komentáře nad ní) z `src/lib/printTimeClient.ts`.

- [ ] **Step 6: Smaž jeho testy z `printTimeClient.test.ts`**

Smaž `snapGroupDeltaStartOnly` z importu (ř. 7) a oba testy pojmenované `"snapGroupDeltaStartOnly: ..."` (dnes ř. 52–69).

- [ ] **Step 7: Smaž osiřelý `snapGroupDeltaWithTemplates` z `workingTime.ts`**

Ověř:

Run: `grep -rn "snapGroupDeltaWithTemplates" src`
Expected: jen definice ve `workingTime.ts` (žádný volající, žádný test — soubor `workingTime.test.ts` v repu neexistuje).

Smaž celou funkci `snapGroupDeltaWithTemplates` (dnes ř. ~73–94 v `workingTime.ts`) i typ `BlockRef`, POKUD ho po smazání nepoužívá nic jiného v souboru:

Run: `grep -n "BlockRef" src/lib/workingTime.ts`
Expected (po smazání funkce): pokud `BlockRef` už nikde jinde v souboru není použit, smaž i definici typu (dnes ř. 22: `type BlockRef = { machine: string; originalStart: Date; originalEnd: Date };`).

- [ ] **Step 8: Build + testy**

Run: `npm run build`
Expected: 0 TS chyb.

Run: `node --test --import tsx src/lib/printTimeClient.test.ts src/lib/workingTime.test.ts 2>/dev/null; node --test --import tsx src/lib/printTimeClient.test.ts`
Expected: `workingTime.test.ts` neexistuje (očekávaná chyba modulu, ignoruj), `printTimeClient.test.ts` celý zelený.

- [ ] **Step 9: Ruční ověření na dev (port 3001) — akceptační scénáře A–D z auditu**

1. **Scénář A (dopředu přes noc):** lasem vyber 2+ bloky za sebou u konce páteční směny, táhni dopředu tak, aby poslední blok spadl do víkendové odstávky. Očekávání: přední blok(y) zůstanou blízko původní pozice (jen mírně posunuté o holou deltu), jen "ocas" (poslední blok) přeteče přes pauzu na Ne 22:00 — ŽÁDNÝ teleport celé skupiny o den.
2. **Scénář B (couvání):** vyber blok(y) v pracovní době, táhni zpět přes hranici směny/víkendu. Očekávání: bloky se REÁLNĚ posunou na nejbližší platné sloty vpřed od cíle tažení (ne zpátky na původní pozici, ne tichý no-op).
3. **Scénář C (žádné falešné 409):** vyber dva bloky s malou mezerou u hranice pauzy, táhni tak, aby se druhý musel po expanzi prvního přes pauzu posunout — očekávej, že batch projde bez chyby "Bloky se překrývají" (dřívější falešný 409 z nesouladu klient/server expanze).
4. **Ctrl+Z:** po kterémkoli z výše proveď Ctrl+Z — celá skupina (i případné navazující bloky odsunuté chain pushem) se vrátí na PŮVODNÍ pozice jedním krokem.
5. **Kaskádový dialog:** vyber ≥6 bloků (nad `CASCADE_CONFIRM_MAX_BLOCKS`) tak, aby chain push odsunul víc než práh navazujících bloků → potvrzovací dialog "Velký autoposun" se musí objevit STEJNĚ jako dřív (tento task cestu k `fetchWithCascadeConfirm`/`askCascade` nemění, jen vstupní `startTime`/`endTime` do `updates`).

- [ ] **Step 10: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx src/lib/printTimeClient.ts src/lib/printTimeClient.test.ts src/lib/workingTime.ts
git commit -m "$(cat <<'EOF'
feat(cascade): zapojit snapGroupPerBlock do lasso presunu, uklidit rohatku

TimelineGrid multi-move vetev v onMouseUp ted pocita per-blok pozice
pres snapGroupPerBlock misto sdilene delty. Pridana pojistka pro
skutecny no-op (zadny blok nezmenil pozici ani stroj) - nezaklada
prazdnou dávku/undo krok. Smazany osireny snapGroupDeltaStartOnly
(printTimeClient.ts) a snapGroupDeltaWithTemplates (workingTime.ts) -
jediny konzument (TimelineGrid) uz na ne nevola.

Server (POST /api/blocks/batch), kaskadove potvrzeni
(fetchWithCascadeConfirm/askCascade) a undo (buildMoveCommand) beze
zmeny - meni se jen to, jake startTime/endTime klient posila.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task D: Parita klient/server, celá suite, dokumenty

**Files:**
- Modify: `src/lib/calendarDrift.server.test.ts`
- Modify: `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md`
- Modify: `docs/vyvoj-historie.md`

**Interfaces:**
- Consumes: `snapGroupPerBlock` z Tasku B (přes jeho výsledné pozice).
- Produces: rozšířený parity test dokazující, že bloky umístěné novým skupinovým snapem NEVYVOLAJÍ falešný drift ani na serveru (`detectCalendarDrift`), ani na klientovi (`blockCalendarDrift`) — obě strany sdílejí `expandPrintTime`, takže matematika se strukturálně nemůže rozejít; tenhle test dokazuje, že se nerozejde ani KLASIFIKACE výsledných pozic.

**Kontext:** `expandPrintTime` (`printTime.ts`) je jediný sdílený zdroj expanze pro klienta (`printTimeClient.ts`) i server (`printTime.server.ts` → `expandPrintTimeFromDb`) — vyhledáno a ověřeno v Tasku B (Global Constraints). Přímá "parita expanze" by tedy testovala samu sebe. Existující tabulkový test `calendarDrift.server.test.ts:292` ("parita klient ↔ server: u NEODLOŽENÝCH bloků musí obě strany klasifikovat stejně") už tohle pokrývá obecně — Task D ho ROZŠIŘUJE o dva řádky specifické pro skupinový přesun: blok umístěný na start, který vzešel ze `snapGroupPerBlock` scénáře A (dopředu přes noc) a scénáře B (couvání), musí obě strany klasifikovat jako `expected: null` (žádný drift) — to je důkaz, že výstup nové funkce je z pohledu OBOU klasifikátorů kalendářně konzistentní, ne jen matematicky stejný.

- [ ] **Step 1: Rozšiř parity tabulku**

V `src/lib/calendarDrift.server.test.ts` najdi pole `cases` uvnitř testu `"parita klient ↔ server: u NEODLOŽENÝCH bloků musí obě strany klasifikovat stejně"` (dnes ř. ~303–353) a přidej dva řádky PŘED uzavírací `];`:

```typescript
    {
      // Pozice vzešlá ze snapGroupPerBlock (viz printTimeClient.test.ts, scénář A,
      // druhý blok) — po přeskoku víkendové odstávky na Ne 22:00. Obě strany musí
      // umístění uznat jako kalendářně čisté (žádný drift).
      name: "skupinový přesun: blok po přeskoku víkendové odstávky na Ne 22:00",
      row: mkBlock({ id: 40, startTime: pragueToUTC("2026-08-23", 22), endTime: pragueToUTC("2026-08-24", 0), printMinutes: 120 }),
      expected: null,
    },
    {
      // Pozice vzešlá ze snapGroupPerBlock (scénář A, první blok) — zůstal
      // v pracovní době, konec přesně na hranici páteční směny (22:00), žádný
      // přesah do pauzy. Ověřuje, že přesná shoda s hranicí se NEVYHODNOTÍ
      // jako drift na žádné straně.
      name: "skupinový přesun: blok skončí přesně na hranici směny (Pá 22:00), bez driftu",
      row: mkBlock({ id: 41, startTime: pragueToUTC("2026-08-21", 21), endTime: pragueToUTC("2026-08-21", 22), printMinutes: 60 }),
      expected: null,
    },
```

(Pozn.: `id` 40/41 — ověř před vložením, že se nekryjí s existujícími `id` v témže poli přes `grep -n "id: 4" src/lib/calendarDrift.server.test.ts`; pokud ano, použij další volná čísla.)

- [ ] **Step 2: Testy PASS**

Run: `node --test --import tsx src/lib/calendarDrift.server.test.ts`
Expected: PASS včetně obou nových řádků parity tabulky.

- [ ] **Step 3: Celá test suite**

Run: `node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts`
Expected: vše zelené.

- [ ] **Step 4: Build + lint**

Run: `npm run build && npm run lint`
Expected: 0 chyb (build), 0 chyb (lint, warningy OK).

- [ ] **Step 5: Označ etapu 3 hotovou v plánu úprav**

V `docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md` uprav nadpis sekce Etapa 3 (dnes ř. 70):

```markdown
## Etapa 3 — Skupinový přesun zakázek přes noc · odhad: M (1–2 dny)
```

na:

```markdown
## Etapa 3 — Skupinový přesun zakázek přes noc · **HOTOVO (implementace `2026-08-20-skupinovy-presun-pres-noc.md`, kroky 3a/3b)**
```

Za odstavec "Akceptace" (dnes ř. 91) přidej řádek:

```markdown
**Poznámka k rozsahu:** krok 3c (náhled všech vybraných bloků na snapnutých pozicích v `onMouseMove`, dnes se kreslí jen kotva s hrubou deltou) zůstává VĚDOMĚ ODLOŽEN — samostatná drobná etapa později.
```

- [ ] **Step 6: Zápis do `docs/vyvoj-historie.md`**

Připoj na konec souboru:

```markdown

## Skupinový přesun zakázek přes noc — per-blok snap (20. 8. 2026)

Kořen (audit vlákna s plánovačem, e-mail 12. 8. bod 1): lasso přesun
posouval celou skupinu o JEDNU sdílenou deltu; snap `snapGroupDeltaStartOnly`
byl "rohatka" — korigoval jen dopředu. Důsledky: tažení zpět přes hranici
směny = tichý no-op (hlavní nahlášený symptom "nefunguje"); tažení dopředu
= teleport celé skupiny o den; falešné 409 z nesouladu klient/server
expanze; nediagnostické 422 z nekonvergující 5pokusové smyčky.

**Oprava ve dvou krocích:**
- **3a (samostatný commit):** UX záplata na DOBOVÉM kódu — rozlišení
  no-op/snap/chyba hlášek (`onInfo` místo zavádějícího `onError`).
- **3b (jádro):** nová čistá funkce `snapGroupPerBlock`
  (`src/lib/printTimeClient.ts`) — bloky seřazené dle původního startu,
  zpracované v JEDNOM průchodu; každý další blok nesmí začít dřív, než
  tiskově končí předchůdce. Per-blok dispatch dle typu (ZAKAZKA = expanze
  přes `expandPrintTime`, REZERVACE/UDRZBA = rigidní přesná délka),
  `scheduleBypassed` členové se posouvají doslovně beze snapu (server má
  na bypass sticky-OR). Nahradila osiřelé `snapGroupDeltaStartOnly`
  (`printTimeClient.ts`) a `snapGroupDeltaWithTemplates` (`workingTime.ts`).

**Server beze změny:** `POST /api/blocks/batch` už dřív přijímal per-blok
`startTime` a pro ZAKAZKA si `endTime` počítal sám z `printMinutes`
(`validateAndComputeEnd`) — kaskádové potvrzení (`fetchWithCascadeConfirm`/
`askCascade`, `assertCascadeConfirmed` na `path: "batch-total"`) a undo
(`buildMoveCommand`) se nezměnily, mění se jen vstupní pozice, které klient
do dávky posílá.

**Vědomě odložené:** krok 3c (náhled všech vybraných bloků na snapnutých
pozicích v `onMouseMove` — dnes jede jen kotva s hrubou deltou) — drobná
samostatná etapa později.

**Ověření.** Tabulkové testy scénářů A–D (dopředu přes noc / couvání / žádný
falešný intra-batch překryv / jeden průchod bez iterace) v
`printTimeClient.test.ts`; rozšířená parity tabulka klient↔server v
`calendarDrift.server.test.ts` dokazuje, že výsledné pozice obě strany
klasifikují shodně jako bezdriftové. Celá suite zelená, `npm run build`
i `npm run lint` bez chyb.
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendarDrift.server.test.ts docs/superpowers/plans/2026-08-18-plan-uprav-z-vlakna-planovace.md docs/vyvoj-historie.md
git commit -m "$(cat <<'EOF'
docs(cascade): etapa 3 (skupinovy presun pres noc) hotova

Rozsirena parity tabulka klient/server o pozice vzesle ze
snapGroupPerBlock (scenar A/B) - obe strany je klasifikuji shodne jako
bezdriftove. Etapa 3 oznacena hotova v planu uprav z vlakna planovace,
zaznam do vyvoj-historie.md. Krok 3c (nahled vsech vybranych bloku pri
tazeni) zustava vedome odlozeny jako samostatna drobna etapa.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- Krok 3a (UX záplata) → Task A, samostatně commitovatelný, na DNEŠNÍM kódu. ✓
- Krok 3b (per-blok snap se zachováním pořadí, per-typový dispatch, bypass beze snapu, server beze změny) → Task B (funkce + TDD) + Task C (zapojení). ✓
- Krok 3c (náhled) → explicitně VYNECHÁN a zdůvodněn v Global Constraints i v dokumentačním Tasku D. ✓
- Riziko "parita klient/server expanze" → Task D (rozšíření existující parity tabulky) + strukturální vysvětlení v Global Constraints (sdílený `expandPrintTime`). ✓
- Riziko "nepřeskládat pořadí split sourozenců (frozenIds)" → NEDOTČENO tímto plánem: `snapGroupPerBlock` mění jen KLIENTSKÝ výpočet `startTime`/`endTime` posílaných do `updates`; server-side `frozenIds`/`resolveChainPushFromDb` (batch route, `movedIds` jako zmrazené překážky) se nemění vůbec — potvrzeno čtením `batch/route.ts:190-219` v rešerši. Explicitně zmíněno v Global Constraints ("Server... se v tomto plánu NEMĚNÍ").
- Riziko "undo beze změny tvaru updates" → Task C Step 4 zachovává přesně `{ id, machine, startTime, endTime }[]`, `handleMultiBlockUpdate`/`buildMoveCommand` v `PlannerPage.tsx` se NEDOTÝKÁ. ✓
- Riziko "no-op dávka nezakládá prázdný undo záznam" → Task C Step 4 přidává explicitní `changed` guard PŘED voláním `onMultiBlockUpdate` (dnešní kód tuhle pojistku nemá — potvrzeno čtením). ✓
- Riziko "smazat osiřelé funkce po ověření greppem" → Task C Step 5+7, s explicitními `grep` kontrolními kroky PŘED smazáním. ✓
- Akceptační kritéria (1)-(4) z frameworku → Task C Step 9 jako manuální QA scénáře 1-4 (plus scénář 5 navíc pro kaskádový dialog, aby se ověřilo, že tenhle task cestu k potvrzení kaskády nerozbil — explicitní požadavek zadání).

**2. Placeholder scan:** Žádné TBD/TODO, žádné "similar to Task N" bez kódu, žádné neurčité "add validation" — všechny kroky mají konkrétní diff/kód. Zkontrolováno.

**3. Type consistency:** `GroupSnapBlock`/`GroupSnapResult` z Tasku B se používají v Tasku C beze změny názvů polí (`id`, `machine`, `type`, `originalStart`, `originalEnd`, `printMinutes`, `scheduleBypassed` na vstupu; `id`, `start`, `end` na výstupu). `DragInternalState` multi-move varianta v Tasku C nese přesně ta pole, která `snapGroupPerBlock` (Task B) očekává na vstupu (`GroupSnapBlock` má `printMinutes?`/`scheduleBypassed?` jako volitelné — `DragInternalState` je posílá vždy definované, což je podmnožina kompatibilní se signaturou). `onMultiBlockUpdate` prop typ (`{ id: number; startTime: Date; endTime: Date; machine: string }[]`, definovaný v `TimelineGrid.tsx:271`) se nemění a Task C ho respektuje beze změny signatury.

**Nalezené a opravené nejasnosti během self-review:** žádné dodatečné mezery — funkční pokrytí frameworku (kroky 3a/3b + všechna vyjmenovaná rizika) je 1:1 na Tasky A–D.
