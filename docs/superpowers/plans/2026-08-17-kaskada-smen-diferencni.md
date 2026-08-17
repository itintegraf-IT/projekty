# Pravdivá kontrola kaskády směn — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dialog „Zkrácení směny ovlivní existující bloky" má přestat lhát, tiskař u stroje má přestat číst čas, o kterém aplikace ví, že nesedí, a příští kaskáda má být desetiminutová operace místo psaní skriptu pod tlakem.

**Architecture:** Cílový stav směn se **neSimuluje, ale měří**. `detectCalendarDrift` — už dnes správný, plně filtrovaný detektor — se zavolá uvnitř existující transakce ještě před upserty a pak po nich; čistá funkce `classifyCascade` porovná obě množiny a při novém „blok nemá kde být" se transakce odrolluje a vrátí 409 s výčtem. Žádná druhá implementace pravidla „sedí blok na kalendář" nevzniká.

**Tech Stack:** TypeScript · Next.js 16 App Router · Prisma 5 / MySQL · `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-08-17-kaskada-smen-diferencni-design.md` (v3)
**Audit:** `docs/audits/2026-08-17-falesna-kaskada-zkraceni-smeny.md` · incidentní commity `1cb95cc0`, `4590c612`

## Global Constraints

- Česky: odpovědi, komentáře i commit messages. Odborné termíny anglicky.
- **Chyby v API routes → `AppError`** + `errorStatus` (`src/lib/errors.ts`); **logování → `logger`**, nikdy `console.*`.
- **Barvy jen přes CSS tokeny**; **žádný nový barevný token** v této vlně.
- **Nezavádět nový pojem do UI** — jev se jmenuje „nesedí na kalendář".
- Stroj v UI vždy `machineLabel` / `MACHINE_LABELS` (`src/lib/machines.ts`).
- **Velikosti na Monitoru výhradně přes `monitorTypeScale`** (`src/lib/monitorTypography.ts`) — hlídá strážný test regulárem nad `src/components/monitor/*.tsx`. Tlačítko HOTOVO má pevnou výšku a nesmí ho nic vytlačit.
- **Žádná migrace DB.** Žádný feature flag. **Nesahat** na `shouldRecomputeSchedule`, `validateAndComputeEnd`, `resolveChainPushFromDb` — v havárii 16:31 se zachovaly správně a strop kaskády je samostatná etapa.
- `tsconfig.json` má `include: ["**/*.ts"]` → `npm run build` typuje i testy.
- Celá suite (po každém tasku):
  ```bash
  node --experimental-test-module-mocks --test --import tsx src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
- Nové testy patří **přímo do `src/lib/`** — glob nejde do podsložek.
- Časy v testech vždy `pragueToUTC("2026-08-17", 21)`, nikdy ruční `new Date("…Z")`.
- **V commitech netvrdit, že se tím uzavírá třída chyby z 16:31** — dokud není strop kaskády, je otevřená.
- Commit po každém tasku, větev `Vojta`, **nepushovat** bez pokynu.

---

| Task | Obsah |
| --- | --- |
| 1 | `cascadeCheck.ts` — `classifyCascade` + přesun `computeConflictWindow`; `description` do driftového selectu |
| 2 | Route: měření před/po v transakci, rollback, 409; zánik `findConflictingBlocks.ts` |
| 3 | Dialog: pravdivé texty, důvod, věta o prodloužení, `btnDanger`, Escape/fokus |
| 4 | Force jen za stroj z dialogu |
| 5 | Monitor u stroje: značka u rozejitého času |
| 6 | `revert-revision-group.ts` + dokumentace |

---

### Task 1: `classifyCascade` a `description` v driftu

**Files:**
- Create: `src/lib/cascadeCheck.ts`
- Create: `src/lib/cascadeCheck.test.ts`
- Modify: `src/lib/calendarDrift.server.ts` (přidat `description` do `select`, typu i `DriftedBlock`)
- Modify: `src/lib/calendarDrift.server.test.ts` (fake row + jedna aserce)

**Interfaces:**
- Consumes: `DriftedBlock` z `src/lib/calendarDrift.server.ts`
- Produces:
  ```typescript
  export function computeConflictWindow(weekStartStr: string): { from: Date; to: Date };  // přesunuto beze změny
  export type CascadeDiff = { newlyHomeless: DriftedBlock[]; newlyLonger: DriftedBlock[] };
  export function classifyCascade(before: DriftedBlock[], after: DriftedBlock[]): CascadeDiff;
  ```

- [ ] **Step 1: Napsat padající testy**

`src/lib/cascadeCheck.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert";
import { classifyCascade, computeConflictWindow } from "./cascadeCheck";
import { pragueToUTC } from "./dateUtils";
import type { DriftedBlock } from "./calendarDrift.server";

function drift(over: Partial<DriftedBlock> & Pick<DriftedBlock, "id" | "reason">): DriftedBlock {
  return {
    orderNumber: `Z${over.id}`, description: null, machine: "XL_105",
    startTime: pragueToUTC("2026-08-18", 8), endTime: pragueToUTC("2026-08-18", 12),
    expectedEnd: null,
    ...over,
  } as DriftedBlock;
}
/** END_MISMATCH, kde spočítaný konec je POZDĚJI než uložený = zkrácení směny = detonátor. */
const longer = (id: number) => drift({ id, reason: "END_MISMATCH", expectedEnd: pragueToUTC("2026-08-18", 20) });
/** END_MISMATCH, kde je spočítaný konec DŘÍV = přidání směny = neškodné. */
const shorter = (id: number) => drift({ id, reason: "END_MISMATCH", expectedEnd: pragueToUTC("2026-08-18", 10) });
const homeless = (id: number) => drift({ id, reason: "START_NOT_RUNNABLE" });

test("cc-1) prázdné vstupy → prázdný diff", () => {
  assert.deepStrictEqual(classifyCascade([], []), { newlyHomeless: [], newlyLonger: [] });
});

test("cc-2) blok ztratil místo TOUTO změnou → newlyHomeless", () => {
  const d = classifyCascade([], [homeless(1)]);
  assert.deepStrictEqual(d.newlyHomeless.map((b) => b.id), [1]);
  assert.deepStrictEqual(d.newlyLonger, []);
});

test("cc-3) blok byl bez místa už PŘED změnou → mlčení", () => {
  const d = classifyCascade([homeless(1)], [homeless(1)]);
  assert.deepStrictEqual(d.newlyHomeless, []);
});

test("cc-4) SALÁM: rozejitý konec PŘED → bez místa PO → hlásí se", () => {
  // Bez tohoto se zakázka vystěhuje dvěma uloženími a druhé je bez varování.
  const d = classifyCascade([longer(1)], [homeless(1)]);
  assert.deepStrictEqual(d.newlyHomeless.map((b) => b.id), [1]);
});

test("cc-5) nově prodloužený konec (zkrácení směny) → newlyLonger, NEBLOKUJE", () => {
  const d = classifyCascade([], [longer(1)]);
  assert.deepStrictEqual(d.newlyHomeless, []);
  assert.deepStrictEqual(d.newlyLonger.map((b) => b.id), [1]);
});

test("cc-6) nově zkrácený konec (PŘIDÁNÍ směny) → oba prázdné", () => {
  // Monotonie expanze: přidání směny může spočítaný konec jen zkrátit. Tohle je
  // Lukešův případ ze stížnosti a je to dobrá zpráva — nesmí vyvolat nic.
  const d = classifyCascade([], [shorter(1)]);
  assert.deepStrictEqual(d, { newlyHomeless: [], newlyLonger: [] });
});

test("cc-7) prodloužený konec už PŘED změnou → mlčení", () => {
  assert.deepStrictEqual(classifyCascade([longer(1)], [longer(1)]).newlyLonger, []);
});

test("cc-8) computeConflictWindow: okno je [pondělí, +7d +6h) v UTC", () => {
  const { from, to } = computeConflictWindow("2026-08-17");
  assert.strictEqual(from.toISOString(), "2026-08-17T00:00:00.000Z");
  assert.strictEqual(to.toISOString(), "2026-08-24T06:00:00.000Z");
});
```

- [ ] **Step 2: Spustit a ověřit, že padá**

Run: `node --test --import tsx src/lib/cascadeCheck.test.ts`
Expected: FAIL — `Cannot find module './cascadeCheck'`

- [ ] **Step 3: Vytvořit modul**

`src/lib/cascadeCheck.ts` — `computeConflictWindow` **přenést beze změny** z
`src/lib/findConflictingBlocks.ts` (včetně celého docstringu o +6h přesahu a span-overlapu):
```typescript
import { civilDateToUTCMidnight } from "@/lib/dateUtils";
import type { DriftedBlock } from "@/lib/calendarDrift.server";

// … computeConflictWindow přenesená beze změny včetně docstringu …

export type CascadeDiff = {
  /** Blok ztratil místo v pracovní době TOUTO změnou → BLOKUJE uložení. */
  newlyHomeless: DriftedBlock[];
  /** Spočítaný konec se TOUTO změnou prodloužil → NEBLOKUJE, jen se pojmenuje. */
  newlyLonger: DriftedBlock[];
};

/** „Nemá kde být" = expanze selhala. `END_MISMATCH` znamená, že místo má, jen jiný konec. */
const isHomeless = (d: DriftedBlock): boolean => d.reason !== "END_MISMATCH";

/**
 * Prodloužil se spočítaný konec? Jen tenhle směr je rizikový.
 *
 * Expanze tiskových hodin je MONOTÓNNÍ ve směnách: přidání směny = víc runnable slotů =
 * spočítaný konec DŘÍV (neškodné, chain push jde jen dopředu a kratší blok nemá koho
 * odsunout), zkrácení směny = konec POZDĚJI (latentní detonátor — příští dotek bloku ho
 * nafoukne a odsune navazující zakázky).
 */
const isLonger = (d: DriftedBlock): boolean =>
  d.reason === "END_MISMATCH" && d.expectedEnd !== null && d.expectedEnd.getTime() > d.endTime.getTime();

/**
 * DIFERENČNÍ porovnání skutečného stavu před a po zápisu směn.
 *
 * Vstupem jsou dva výstupy `detectCalendarDrift` z TÉŽE transakce — před upserty a po nich.
 * Cílový stav se tedy NEsimuluje, jen měří; kdyby někdo `before` omylem načetl až po
 * upsertech, vyjde `before == after` a kontrola MLČÍ — degradace do bezpečného směru.
 *
 * „Newly" = je v `after` a NEBYL v téže kategorii v `before`. Proto se salámová cesta
 * (rozejitý konec → vystěhování druhým uložením) ohlásí zdarma.
 */
export function classifyCascade(before: DriftedBlock[], after: DriftedBlock[]): CascadeDiff {
  const wasHomeless = new Set(before.filter(isHomeless).map((b) => b.id));
  const wasLonger = new Set(before.filter(isLonger).map((b) => b.id));
  return {
    newlyHomeless: after.filter((a) => isHomeless(a) && !wasHomeless.has(a.id)),
    newlyLonger: after.filter((a) => isLonger(a) && !wasLonger.has(a.id)),
  };
}
```

- [ ] **Step 4: Doplnit `description` do driftového detektoru**

V `src/lib/calendarDrift.server.ts`: přidat `description: true` do `select` (`:107`), `description: string | null` do návratového typu ve `PrismaClientLike` (`:29-31`) i do `DriftedBlock` (`:54-62`), a propsat ji do obou `drifted.push(...)`. Aditivní změna — dialog potřebuje popis zakázky.

V `src/lib/calendarDrift.server.test.ts` doplnit `description` do fake řádku a jednu asercí ověřit, že se propíše do výstupu.

- [ ] **Step 5: Spustit a ověřit**

Run: `node --test --import tsx src/lib/cascadeCheck.test.ts src/lib/calendarDrift.server.test.ts`
Expected: PASS (8 + 13+)

- [ ] **Step 6: Commit**

```bash
git add src/lib/cascadeCheck.ts src/lib/cascadeCheck.test.ts src/lib/calendarDrift.server.ts src/lib/calendarDrift.server.test.ts
git commit -m "feat(kaskada): classifyCascade nad skutecnym stavem + popis zakazky v driftu"
```

---

### Task 2: Route — měřit před a po, při konfliktu odrolovat

**Files:**
- Modify: `src/app/api/machine-week-shifts/route.ts`
- Delete: `src/lib/findConflictingBlocks.ts`, `src/lib/findConflictingBlocks.test.ts`

**Interfaces:**
- Consumes: `classifyCascade`, `computeConflictWindow` z `src/lib/cascadeCheck.ts` (Task 1)
- Produces: `409 { error: "SHIFT_SHRINK_CASCADE", machine, conflictingBlocks, longerBlocks }`

- [ ] **Step 1: Přepojit importy a odstranit staré volání**

V `route.ts` zrušit import `findConflictingBlocks`/`assertNoConflictingBlocks`/`computeConflictWindow`
z `@/lib/findConflictingBlocks` a importovat `classifyCascade`, `computeConflictWindow` z
`@/lib/cascadeCheck`. Smazat celý pre-transakční blok `if (!force) { const conflicts = await findConflictingBlocks(...) }`
(`:293-302`) a in-transaction `assertNoConflictingBlocks` (`:348-350`).

- [ ] **Step 2: Změřit před a po uvnitř transakce**

```typescript
    const now = new Date();
    const { from: windowFrom, to: windowTo } = computeConflictWindow(parsedWeek);
    // Uzávěr přežije rollback — 409 se z něj složí až v catch bloku.
    let cascade: CascadeDiff | null = null;

    const updated = await prisma.$transaction(async (tx) => {
      // Stav PŘED zápisem. MUSÍ se číst před upserty; po nich by `before == after`
      // a kontrola by MLČELA (degradace do bezpečného směru, ne do falešného poplachu).
      const driftBefore = await detectCalendarDrift(tx, [machine], windowFrom, windowTo, now);

      for (const d of normalized) { /* … 7× upsert beze změny … */ }

      // tx vidí vlastní upserty → tohle je SKUTEČNÝ cílový stav, ne simulace.
      const driftAfter = await detectCalendarDrift(tx, [machine], windowFrom, windowTo, now);
      cascade = classifyCascade(driftBefore, driftAfter);

      if (!force && cascade.newlyHomeless.length > 0) {
        // Rollback: směny se nezapíšou. Výčet si odnese `cascade` v uzávěru.
        throw new AppError("CONFLICT", "SHIFT_SHRINK_CASCADE");
      }

      await tx.auditLog.create({ /* … beze změny … */ });
      await notifyCalendarDrift(tx, driftAfter, session, `Změna směn ${machineLabel(machine)} (týden ${parsedWeek})`);
      return await tx.machineWeekShifts.findMany({ where: { machine, weekStart: weekStartDate }, orderBy: { dayOfWeek: "asc" } });
    });
```
Poznámka: `notifyCalendarDrift` dostane `driftAfter` (dřív `drifted`) a label stroje přes
`machineLabel` místo `machine.replace("_", " ")`.

- [ ] **Step 3: Složit 409 v catch bloku**

```typescript
  } catch (err) {
    if (isAppError(err) && err.code === "CONFLICT" && err.message === "SHIFT_SHRINK_CASCADE") {
      return NextResponse.json({
        error: "SHIFT_SHRINK_CASCADE",
        machine,
        conflictingBlocks: (cascade?.newlyHomeless ?? []).map(serializeCascadeBlock),
        longerBlocks: (cascade?.newlyLonger ?? []).map(serializeCascadeBlock),
      }, { status: 409 });
    }
    // … zbytek beze změny; větev SHIFT_SHRINK_CASCADE_RACE ZANIKÁ spolu s re-checkem …
  }
```
kde `serializeCascadeBlock` je lokální funkce vracející
`{ id, orderNumber, description, startTime: iso, endTime: iso, reason, expectedEnd: iso | null }`.
Pozor: `machine` a `cascade` musí být deklarované **před** `try`, aby na ně catch viděl.

- [ ] **Step 4: Smazat mrtvý modul**

```bash
git rm src/lib/findConflictingBlocks.ts src/lib/findConflictingBlocks.test.ts
```
`computeConflictWindow` je přesunutá v Tasku 1; ověř, že modul nemá jiného importéra:
```bash
grep -rn "findConflictingBlocks" src/ scripts/
```
Expected: žádný výskyt.

- [ ] **Step 5: Ověřit build a suite**

Run: `npm run build`, celá suite
Expected: zelené. Počet testů klesne o 11 (zaniklý soubor) a stoupne o 8 (Task 1).

- [ ] **Step 6: Commit**

```bash
git add -A src/app/api/machine-week-shifts/route.ts src/lib/
git commit -m "feat(kaskada): kontrola meri skutecny stav v transakci a pri konfliktu odroluje"
```

---

### Task 3: Dialog — pravdivé texty a důvod

**Files:**
- Create: `src/lib/cascadeDialogText.ts`
- Create: `src/lib/cascadeDialogText.test.ts`
- Modify: `src/components/admin/ShiftCascadeDialog.tsx`

**Interfaces:**
- Consumes: `machineLabel`; `DriftedBlock["reason"]`
- Produces: `cascadeDialogTitle(machine, count)`, `CASCADE_REASON_LABELS`, `longerBlocksSentence(count)`

- [ ] **Step 1: Napsat padající testy**

`src/lib/cascadeDialogText.test.ts`:
```typescript
import { test } from "node:test";
import assert from "node:assert";
import { cascadeDialogTitle, CASCADE_REASON_LABELS, longerBlocksSentence } from "./cascadeDialogText";

test("titulek říká pravdu a nese label stroje", () => {
  assert.strictEqual(cascadeDialogTitle("XL_106", 3), "Změna směn na XL 106 vystěhuje z pracovní doby bloky (3)");
  assert.strictEqual(cascadeDialogTitle("XL_105", 1), "Změna směn na XL 105 vystěhuje z pracovní doby bloky (1)");
});

test("titulek nikdy nenese surové id stroje ani slovo o zkrácení", () => {
  const t = cascadeDialogTitle("XL_106", 2);
  assert.ok(!t.includes("XL_106"));
  assert.ok(!t.toLowerCase().includes("zkrácen"), "přidání směny taky může vystěhovat blok");
});

test("mapa důvodů je vyčerpávající a bez prázdných textů", () => {
  assert.deepStrictEqual(Object.keys(CASCADE_REASON_LABELS).sort(),
    ["END_MISMATCH", "HORIZON_EXCEEDED", "START_NOT_RUNNABLE"]);
  for (const v of Object.values(CASCADE_REASON_LABELS)) assert.ok(v.length > 0);
});

test("věta o prodloužení je jen když je co říct", () => {
  assert.strictEqual(longerBlocksSentence(0), null);
  const s = longerBlocksSentence(2);
  assert.ok(s && s.includes("2"));
  assert.ok(s.includes("odsune"), "musí říct, co se stane při příští úpravě");
});
```

- [ ] **Step 2: Spustit a ověřit, že padá**

Run: `node --test --import tsx src/lib/cascadeDialogText.test.ts`
Expected: FAIL — modul neexistuje

- [ ] **Step 3: Implementovat**

`src/lib/cascadeDialogText.ts`:
```typescript
import { machineLabel } from "@/lib/machines";
import type { DriftedBlock } from "@/lib/calendarDrift.server";

/**
 * Texty kaskádového dialogu. Čistá funkce, ať se dají testovat — titulek byl od
 * 20. 4. 2026 napevno a rok tvrdil „Zkrácení směny…" i u přidání směny.
 *
 * Počet je v závorce záměrně: vyhýbá se skloňování bez zavádění dalšího helperu
 * (v repu jsou dnes dva a rozcházejí se na nule — sjednocení je samostatný úklid).
 * Terminologie: jev se v aplikaci jmenuje „nesedí na kalendář", žádný nový pojem.
 */
export const CASCADE_REASON_LABELS: Record<DriftedBlock["reason"], string> = {
  START_NOT_RUNNABLE: "Začátek padne mimo provoz stroje",
  HORIZON_EXCEEDED: "Podle nového rozvrhu nejde dopočítat konec",
  END_MISMATCH: "Konec nesedí na kalendář",
};

export function cascadeDialogTitle(machine: string, count: number): string {
  return `Změna směn na ${machineLabel(machine)} vystěhuje z pracovní doby bloky (${count})`;
}

/**
 * Neblokující věta o blocích, kterým se konec PRODLOUŽIL. Jediná věta v celé
 * etapě, která má vztah k riziku kaskády: takový blok je latentní detonátor,
 * protože jeho příští úprava ho nafoukne a odsune navazující zakázky.
 */
export function longerBlocksSentence(count: number): string | null {
  if (count === 0) return null;
  return `Žádný další blok se nevystěhuje. U ${count} zakázek se ale tímto zkrácením prodlouží ` +
    `spočítaný konec — jejich příští úprava odsune navazující zakázky.`;
}
```

- [ ] **Step 4: Spustit a ověřit**

Run: `node --test --import tsx src/lib/cascadeDialogText.test.ts`
Expected: PASS (4/4)

- [ ] **Step 5: Přestavět dialog**

V `src/components/admin/ShiftCascadeDialog.tsx`:
1. Props: `machine: string`, `conflictingBlocks` (nese `reason`, `description`), `longerCount: number`.
2. Titulek z `cascadeDialogTitle`, pod tabulkou `longerBlocksSentence(longerCount)` v tlumeném textu.
3. Tělo přepsat: bloky dnes v pracovní době leží a po uložení ležet přestanou; buď zrušit a
   nejdřív přeplánovat, nebo uložit přesto — zůstanou v plánu se značkou „nesedí na kalendář".
   **Slovo „DB" odstranit.**
4. Tabulka: **Zakázka · Popis · Od–Do · Proč nesedí** (`CASCADE_REASON_LABELS`), `tableLayout: "fixed"`,
   ellipsis + `title` na Popisu, Od–Do v jednom sloupci bez sekund.
5. Potvrzovací tlačítko přes `btnDanger` z `src/lib/uiStyles.ts` místo `--danger` + `color: "white"`
   (4,08 : 1 light / 3,43 : 1 dark, pod AA; `--danger-contrast` neexistuje a nový token do této vlny nepatří).
6. `FONT_STACK` importovat z `uiStyles.ts` (dnes lokální duplikát).
7. Escape → `onCancel` (vzor `ConfirmDialog.tsx:43-50`), `autoFocus` na **„Zrušit změnu"**.

- [ ] **Step 6: Ověřit build**

Run: `npm run build`
Expected: spadne na chybějících propech u obou konzumentů — to je Task 4. Commit až s ním.

---

### Task 4: Force jen za stroj z dialogu

**Files:**
- Modify: `src/components/admin/MachineWorkHoursWeek.tsx`
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 1: Admin mřížka**

`submitSave(force: boolean, onlyMachine?: string)` — iterovat `onlyMachine ? [onlyMachine] : MACHINES`.
Návrat 409 rozšířit na `{ ok: false, cascade, longerCount, machine }`, uložit `machine` i
`longerCount` do stavu vedle `cascadeBlocks`. `confirmCascade` → `runSave(true, cascadeMachine)`.

**Proč:** dnes `runSave(true)` pošle `?force=1` ve smyčce **za všechny stroje**, takže potvrzení
kaskády na XL 105 přeskočí kontrolu XL 106 a jeho konflikty se uloží, aniž je kdo viděl. Je to
jediná díra, kterou dnes projde pravá kaskáda.

Po force uložení dotčeného stroje pokračovat zbylými stroji **bez** force (dialog se objeví
podruhé, ale pravdivě a se svým názvem stroje). Při otevření dialogu zavolat `void load()`, aby
`original` nezůstal zastaralý.

- [ ] **Step 2: Planner**

`PlannerPage.tsx` (~3436): předat `machine={plannerCascade.pendingPayload.machine}` a
`longerCount` z odpovědi (uložit ho do `plannerCascade` vedle `conflicts`).

- [ ] **Step 3: Ověřit build, suite a prokliknout**

Run: `npm run build`, celá suite, pak dev server (`localhost:3001`) a čtyři scénáře:
1. Přidat sobotní směnu k víkendové zakázce → **žádný dialog**
2. Vypnout směnu pod zakázkou → dialog, pravdivý titulek se strojem, sloupec „Proč nesedí"
3. Uložit bez změny → **žádný dialog**
4. Zkrátit směnu tak, aby se konec prodloužil → **žádný dialog**, ale věta o prodloužení
   (ověřit v Network tabu, že 409 nepřišla)

- [ ] **Step 4: Commit Tasků 3 + 4**

```bash
git add src/lib/cascadeDialogText.ts src/lib/cascadeDialogText.test.ts src/components/admin/ShiftCascadeDialog.tsx src/components/admin/MachineWorkHoursWeek.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(kaskada): pravdivy dialog s duvodem + force jen za stroj z dialogu"
```

---

### Task 5: Monitor u stroje — značka u rozejitého času

Dnes `MonitorQueue.tsx:209` a `MonitorHeroTiming.tsx:62` tisknou `block.endTime` **natvrdo**;
`MonitorView` navíc `weekShifts` ani `companyDays` v props **vůbec nedostává**, takže drift
spočítat nemůže. Tiskař není v `INBOX_ROLES`, takže o rozejitém konci nemá jak vědět — a je to
jediný člověk, který podle toho času rozhoduje, co pustí do stroje, a jediný, kdo to nemůže spravit.

**Files:**
- Modify: `src/components/monitor/MonitorView.tsx`, `MonitorQueue.tsx`, `MonitorHeroTiming.tsx`
- Modify: `src/app/_components/PlannerPage.tsx` (předat kalendář do `MonitorView`, ~2825)
- Create: `src/lib/monitorDriftMark.ts` + `src/lib/monitorDriftMark.test.ts`

**Interfaces:**
- Consumes: `blockCalendarDrift` (`printTimeClient.ts:244`), `isParkedDrift` (`calendarDriftUi.ts`), `monitorTypeScale`
- Produces: `shouldMarkDrift(block, weekShifts, companyDays, now): boolean`

- [ ] **Step 1: Napsat padající testy**

`src/lib/monitorDriftMark.test.ts` — tři případy: konformní blok → `false`; rozejitý konec →
`true`; **vědomě odložený blok (`scheduleBypassed`) → `false`** (odložení není porucha, kterou má
tiskař vidět; rozsah musí vyjít z klientského detektoru přes `isParkedDrift`). Fixtury
`mkDay`/`W1` z `weekShiftsTestFixtures`, časy `pragueToUTC`.

- [ ] **Step 2: Implementovat helper**

```typescript
/**
 * Má se u tohoto bloku na Monitoru označit čas jako nespolehlivý?
 *
 * Rozsah VYCHÁZÍ z klientského detektoru (`blockCalendarDrift`) — jediného, který umí
 * posoudit jeden blok. Vědomě odložené bloky (`isParkedDrift`) se VYLUČUJÍ: odložení je
 * rozhodnutí plánovače, ne porucha, a tiskaři by svítilo natrvalo.
 */
export function shouldMarkDrift(block, weekShifts, companyDays, now): boolean {
  const drift = blockCalendarDrift(block, weekShifts, companyDays, now);
  return drift !== null && !isParkedDrift(drift);
}
```

- [ ] **Step 3: Protáhnout kalendář a vykreslit značku**

`PlannerPage.tsx:2825` → `MonitorView` dostane `machineWeekShifts` a `companyDays`; `MonitorView`
je předá `MonitorQueue` i `MonitorHeroTiming`. Tam u bloku, kde `shouldMarkDrift` vrátí `true`,
čas **ztlumit** (`--text-muted`) a doplnit `⚠ čas se přepočítává`.

**Velikosti výhradně z `monitorTypeScale`** — hlídá strážný test regulárem nad
`src/components/monitor/*.tsx`; holý `fontSize` ho shodí. Značka nesmí vytlačit tlačítko HOTOVO
(pevná výška `MONITOR_HERO_BUTTON_HEIGHT`, obsah v samostatném `flex: 1; minHeight: 0` kontejneru).

- [ ] **Step 4: Ověřit**

Run: celá suite (včetně strážného testu typografie Monitoru), `npm run build`, proklik Monitoru
na dev serveru ve stupních písma **M / L / XL** — ve všech třech musí zůstat vidět HOTOVO.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitorDriftMark.ts src/lib/monitorDriftMark.test.ts src/components/monitor/ src/app/_components/PlannerPage.tsx
git commit -m "feat(monitor): oznacit cas, o kterem aplikace vi, ze nesedi na kalendar"
```

---

### Task 6: Zobecnit záchranný skript + dokumentace

**Files:**
- Create: `scripts/revert-revision-group.ts` (z `scripts/revert-cascade-20260817.ts`)
- Modify: `docs/OPS_ZALOHY.md`, `CLAUDE.md`, `docs/POUCENI.md`, `docs/vyvoj-historie.md`

- [ ] **Step 1: Zobecnit skript**

Přečti `scripts/revert-cascade-20260817.ts` celý. Veškerá mechanika je hotová a ostře prověřená
(cíle z `BlockRevision.before`, guard „blok musí stát tam, kam ho havárie posunula", simulace
cílového stavu se **všemi** kolizemi, `withRevision`, `assertNoOverlapForBlocks`). Vyhodit
zadrátované `GROUP_ID` a `EXTRA` do argumentů:
```
npx tsx scripts/revert-revision-group.ts --group <groupId> [--also <id>:endTime=…,printMinutes=…] [--apply]
```
Bez `--apply` **jen dry-run**. Původní skript ponechat jako historický záznam incidentu.

- [ ] **Step 2: `docs/OPS_ZALOHY.md`**

Odstavec „Vrácení kaskády z černé skříňky": jak najít `groupId` v `BlockRevision`, dry-run,
`--apply`, a že se to má pouštět **až po `mysqldump` záloze**.

- [ ] **Step 3: `CLAUDE.md`**

Kontrola kaskády **měří skutečný stav** v transakci (ne simulaci) a `before` se proto čte **před**
upserty. `machine-week-shifts` nemutuje `Block` — proto force nic neposouvá, jen zapíše směny.

- [ ] **Step 4: `docs/POUCENI.md` — tři řádky**

1. Absolutní kontrola vydávaná za diferenční („Zkrácení směny") — alarm, který nekoreluje
   s realitou, vychová obsluhu k odklikávání.
2. Než postavíš druhou implementaci pravidla, ověř, jestli první neběží o šedesát řádků níž na
   téže cestě. Cílový stav se často nemusí simulovat — stačí ho změřit a transakci odrolovat.
3. Veličina počítaná přes kalendář se u hranice směny nemění spojitě — posun o jeden slot umí
   konec bloku posunout o délku pauzy. Kde takový skok vstupuje do automatiky (chain push), musí
   být strop a potvrzení odvozené od DŮSLEDKU, ne od velikosti gesta.

- [ ] **Step 5: `docs/vyvoj-historie.md`**

Etapa, zánik `findConflictingBlocks`, nové kameny, značka na Monitoru. **Netvrdit, že se tím
uzavírá třída chyby z 16:31** — dokud není strop kaskády (backlog §6 bod 1), je otevřená.

- [ ] **Step 6: Commit**

```bash
git add scripts/revert-revision-group.ts docs/ CLAUDE.md
git commit -m "feat(ops): zobecneny revert revizni skupiny + dokumentace vlny"
```

---

## Self-review

**Pokrytí specu:** §3.1 → Task 2 · §3.2 → Task 1 · §3.3 → Task 3 · §3.4 → Task 4 · §3.5 → Task 5 ·
§3.6 → Task 6 · §5 testy → Tasky 1, 3, 5 · §7 dokumentace → Task 6.

**Odchylky, které plán upřesňuje:**
1. `computeConflictWindow` se **přesouvá** do `cascadeCheck.ts` (Task 1) místo aby zbyla osiřelá
   ve `findConflictingBlocks.ts` — jinak by soubor toho jména obsahoval jedinou funkci, která
   žádné konflikty nehledá.
2. `CASCADE_REASON_LABELS` má **tři** klíče včetně `END_MISMATCH`, protože mapa je `Record` nad
   `DriftedBlock["reason"]`. V blokující tabulce se `END_MISMATCH` neobjeví (ty bloky jsou
   `newlyLonger`, a ty neblokují), ale vyčerpávající mapa brání tomu, aby nová hodnota prošla bez textu.
3. Věta o prodloužení potřebuje z routy `longerBlocks` → 409 payload má **dvě** pole.

**Placeholder scan:** kód je u Tasků 1–3 doslovný; u Tasků 4–6 jde o úpravy existujících souborů
popsané adresně (soubor, řádek, co změnit a proč).

**Konzistence typů:** `DriftedBlock` (rozšířený o `description` v Tasku 1) používají Tasky 1, 2, 3 ·
`CascadeDiff` z Tasku 1 konzumuje Task 2 · `cascadeDialogTitle`/`CASCADE_REASON_LABELS`/
`longerBlocksSentence` z Tasku 3 konzumuje dialog v Tasku 3 a props z Tasku 4 ·
`shouldMarkDrift` z Tasku 5 nemá jiného konzumenta.

**Riziko nekompilujícího mezistavu:** jen mezi Tasky 3 a 4 (nové povinné propy dialogu) — proto
se commitují společně (Task 4, Step 4).
