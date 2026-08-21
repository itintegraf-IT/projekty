# Autoposun viditelný a vratný — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autoposun (chain push) přestane být tichý a nevratný — řekne, kolik bloků odsunul, dá se vzít zpět přes Ctrl+Z, nad prahem se na velkou kaskádu zeptá, a v historii bloku jde vrátit i po refreshi.

**Architecture:** Server už dopad zná (`AppliedMove`), jen ho zahazuje. Etapa A+C ho začne posílat a klient z něj složí krok historie přes **existující** `buildMoveCommand`. Etapa B přidá kontrolu do `resolveChainPushFromDb` — na jediné místo, kudy prochází všech pět zápisových cest — a vrátí 409 s čísly (týž vzor jako `SHIFT_SHRINK_CASCADE` z minulé vlny). Etapa D vytáhne jádro ze `scripts/revert-revision-group.ts` do sdíleného modulu a postaví nad ním endpoint a tlačítko.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Prisma 5 · MySQL/MariaDB · testy `node:test` + `tsx`

**Spec:** `docs/superpowers/specs/2026-08-18-autoposun-viditelny-a-vratny-design.md`
**Audit (důkazy a měření):** `docs/audits/2026-08-18-audit-prepocitat-autoposun.md`

---

## Global Constraints

Platí pro KAŽDÝ task, i když to u něj není zopakováno.

- **Žádná migrace DB.** Ani jedna etapa nemění `prisma/schema.prisma`.
- **Chyby v API routes → `AppError`** (`src/lib/errors.ts`), status z `errorStatus(err.code)`. Nikdy string-prefix `Error`, nikdy lokální kopie mapy status kódů.
- **Logování → `logger`** (`src/lib/logger.ts`). `console.*` v API routes je zakázané. (V `PlannerPage.tsx` `console.error` v catch větvích JE dnešní zvyk a zůstává.)
- **Každá mutace bloku uvnitř `withRevision`** (`src/lib/revision.server.ts`). Uvnitř těla je `prisma.*` zakázané i pro čtení — klient se bere z předaného `tx`.
- **Barvy výhradně přes CSS tokeny** z `src/app/globals.css` (`--text`, `--text-muted`, `--surface`, `--border`, `--danger`, `--warning-text`, …). Žádný hex ani rgba literál v nové komponentě.
- **Texty česky.** Skloňování počtu se v tomhle repu NEŘEŠÍ — dnešní hláška zní `Posunuto 1 navazujících bloků` a nová musí být stejná, aby se texty nerozešly. **Nezavádět pluralizační helper** (spec §3.1).
- **Celá test suite** (musí být zelená před každým commitem):
  ```bash
  node --experimental-test-module-mocks --test --import tsx \
    src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
  ```
- **Build lokálně před pushem:** `npm run build` (chytí TS chyby dřív než server). Pozor: běžící dev instance sdílejí `.next` — buildovat, až když neběží.
- **Nové standalone komponenty** jako named export do `src/components/`, ne inline do `PlannerPage.tsx`/`TimelineGrid.tsx`.
- **Nová hodnota `AuditLog.action`/`field`** musí přibýt do `src/lib/auditCoverage.ts`. Tenhle plán žádnou novou nezavádí — kdyby ji task potřeboval, je to signál, že se odchyluje od zadání.

### Oprava proti specu (zjištěno při psaní plánu)

Spec §3.3 tvrdí, že `errorStatus` je „`Record` nad unionem, takže bez toho neprojde build". **Není to pravda** — `src/lib/errors.ts:42` je `switch` s `default: return 500`. Nový kód `CASCADE_CONFIRM` bez vlastní `case` větve tedy build projde a **tiše vrátí 500 místo 409**. Task B1 to proto musí ohlídat testem, ne kompilátorem.

---

## File Structure

| Soubor | Odpovědnost | Etapa |
| --- | --- | --- |
| `src/lib/reflowToastText.ts` **(nový)** | Čisté skládání hlášek po přepočtu. Vzor: `cascadeDialogText.ts` z minulé vlny. | A |
| `src/lib/reflowToastText.test.ts` **(nový)** | Testy hlášek. | A |
| `src/lib/overlapResolver.server.ts` | `AppliedMove` doplní zbytek pozičního snapshotu (`oldUpdatedAt`, `oldPrintMinutes`, `oldScheduleBypassed`). V etapě B sem přijde kontrola stropu. | C, B |
| `src/lib/reflowBefore.server.ts` **(nový)** | `ReflowBeforeSnapshot` + převod `AppliedMove` → snapshot + slučování (první výskyt vyhrává). | C |
| `src/lib/reflowBefore.server.test.ts` **(nový)** | Testy převodu a slučování. | C |
| `src/lib/reflow.server.ts` | `ReflowOutcome` a `MachineReflowResult` nesou `before`. V etapě B protahují `cascadeConfirmed`. | C, B |
| `src/app/api/blocks/reflow/route.ts` | Vrací `before` a `movedCount`; v B čte `cascadeConfirmed` a vrací 409. | C, B |
| `src/app/api/blocks/[id]/reflow/route.ts` | Totéž pro jeden blok. | C, B |
| `src/lib/undo/limits.ts` **(nový)** | `UNDO_MAX_OPS = 200` — jediný zdroj pravdy sdílený klientem i `undoApply.server.ts`. | C |
| `src/lib/undo/commands.ts` | `buildReflowCommand` — sourozenec `buildMoveCommand` bez klientského liveness guardu. | C |
| `src/app/_components/PlannerPage.tsx` | Zapojení: hlášky, `recordUndo`, potvrzovací dialog, vrácení optimistického stavu. | A, C, B |
| `src/lib/cascadeLimit.ts` **(nový)** | Práh, měření dopadu, věta do dialogu. | B |
| `src/lib/cascadeLimit.test.ts` **(nový)** | Testy prahu a měření. | B |
| `src/lib/errors.ts` | Nový kód `CASCADE_CONFIRM` → 409. | B |
| `src/lib/cascadeConfirmClient.ts` **(nový)** | Odeslání mutace + dotaz při 409 + zopakování s příznakem. | B |
| `src/lib/cascadeResponse.ts` **(nový)** | Jednotné tělo 409 odpovědi pro šest routes. | B |
| `src/components/ConfirmDialog.tsx` | Potvrzení velké kaskády — **beze změny**, jen nové použití. Nový dialogový komponent nevzniká. | B |
| `src/lib/revertRevisionGroup.server.ts` **(nový)** | Jádro vrácení revizní skupiny — sdílené skriptem i endpointem. | D |
| `src/lib/revertRevisionGroup.server.test.ts` **(nový)** | Testy jádra. | D |
| `scripts/revert-revision-group.ts` | Zůstává, ale jádro importuje místo vlastní kopie. | D |
| `src/app/api/blocks/revert-group/route.ts` **(nový)** | `POST` — dry-run i zápis. | D |
| `src/components/BlockDetail.tsx` | Tlačítko „Vrátit tuto změnu" u řádku historie. | D |

---

## Pořadí a nasazení

| Etapa | Tasky | Nasazení |
| --- | --- | --- |
| **A + C** | A1, C1, C2, C3 | 1. nasazení — nemění chování, jen přestane mlčet |
| **B** | B1, B2, B3, B4 | 2. nasazení; B4 (`CASCADE_CONFIRM_ENFORCED = true`) až po týdnu měření |
| **D** | D1, D2, D3 | 3. nasazení / samostatný PR |

**Po každé etapě se zastav a počkej na OK** — je to Vojtovo výslovné pravidlo pro tenhle repozitář.

---

# ETAPA A — říct číslo

## Task A1: Hlášky po přepočtu nesou počet odsunutých bloků

Server obě čísla už posílá (`movedCount` u stroje, `moves` u bloku), klient je zahazuje. Text se skládá v novém čistém modulu, aby šel otestovat — `PlannerPage.tsx` má 3109 řádků a žádný testovací harness.

**Files:**
- Create: `src/lib/reflowToastText.ts`
- Create: `src/lib/reflowToastText.test.ts`
- Modify: `src/app/_components/PlannerPage.tsx` (funkce `handleReflowMachine` ~ř. 2086, `handleReflowBlock` ~ř. 2111)

**Interfaces:**
- Consumes: nic (první task).
- Produces:
  ```ts
  export function reflowMachineToast(i: { reflowedCount: number; skippedCount: number; movedCount: number }): string
  export function reflowBlockToast(i: { changed: boolean; timesMoved: boolean; movedCount: number }): string
  ```

- [ ] **Step 1: Napiš padající test**

Vytvoř `src/lib/reflowToastText.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reflowMachineToast, reflowBlockToast } from "./reflowToastText";

test("stroj: bez přeskočených a bez odsunutých je věta holá", () => {
  assert.equal(
    reflowMachineToast({ reflowedCount: 4, skippedCount: 0, movedCount: 0 }),
    "Přepočteno 4 bloků",
  );
});

test("stroj: odsunuté se přidají za přeskočené", () => {
  assert.equal(
    reflowMachineToast({ reflowedCount: 4, skippedCount: 2, movedCount: 31 }),
    "Přepočteno 4 bloků, přeskočeno 2 (zamčené/nevejde se), odsunuto 31 navazujících bloků",
  );
});

test("stroj: nulové odsunutí se NEuvádí (žádné „odsunuto 0“)", () => {
  const s = reflowMachineToast({ reflowedCount: 1, skippedCount: 0, movedCount: 0 });
  assert.ok(!s.includes("odsunuto"), s);
});

test("blok: beze změny mlčí o odsunutí", () => {
  assert.equal(
    reflowBlockToast({ changed: false, timesMoved: false, movedCount: 0 }),
    "Blok už na kalendář sedí.",
  );
});

test("blok: posun s odsunutými", () => {
  assert.equal(
    reflowBlockToast({ changed: true, timesMoved: true, movedCount: 20 }),
    "Blok přepočítán podle aktuálního kalendáře, odsunuto 20 navazujících bloků.",
  );
});

test("blok: posun bez odsunutých končí tečkou a o odsunutí mlčí", () => {
  assert.equal(
    reflowBlockToast({ changed: true, timesMoved: true, movedCount: 0 }),
    "Blok přepočítán podle aktuálního kalendáře.",
  );
});

test("blok: pouhé zrušení značky nikdy nehlásí odsunutí", () => {
  // Když se plán nepohnul, chain push neproběhl — movedCount 0 je jediná možná hodnota,
  // ale i kdyby přišla nesmyslná, věta o odsunutí se u téhle větve nesmí objevit.
  const s = reflowBlockToast({ changed: true, timesMoved: false, movedCount: 7 });
  assert.equal(s, "Značka „odložené mimo pracovní dobu“ zrušena — plán se nepohnul.");
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

```bash
node --test --import tsx src/lib/reflowToastText.test.ts
```
Očekávané: FAIL — `Cannot find module './reflowToastText'`.

- [ ] **Step 3: Napiš minimální implementaci**

Vytvoř `src/lib/reflowToastText.ts`:

```ts
/**
 * Hlášky po přepočtu („Přepočítat" na stroji i na jednom bloku).
 *
 * Vlastní modul má jediný důvod: `PlannerPage.tsx` je přes 3000 řádků a nemá
 * testovací harness, takže věta složená přímo v handleru se otestovat nedá.
 * Vzor je `cascadeDialogText.ts` z kaskádové vlny 17. 8. 2026.
 *
 * SKLOŇOVÁNÍ SE NEŘEŠÍ. Dnešní hláška u přesunu zní „Posunuto 1 navazujících
 * bloků" (`PlannerPage.tsx`, tři místa) a tahle ji musí kopírovat doslova —
 * jinak by táž věc měla v aplikaci dvě různé podoby. Pluralizační helper se
 * pro tuhle vlnu vědomě NEZAVÁDÍ (spec §3.1).
 */

/** Odsunutí se do věty přidá jen tehdy, když k němu došlo — „odsunuto 0" nikdy. */
function shiftedClause(movedCount: number): string {
  return movedCount > 0 ? `, odsunuto ${movedCount} navazujících bloků` : "";
}

export function reflowMachineToast(i: {
  reflowedCount: number;
  skippedCount: number;
  movedCount: number;
}): string {
  const skipped = i.skippedCount > 0 ? `, přeskočeno ${i.skippedCount} (zamčené/nevejde se)` : "";
  return `Přepočteno ${i.reflowedCount} bloků${skipped}${shiftedClause(i.movedCount)}`;
}

export function reflowBlockToast(i: {
  changed: boolean;
  timesMoved: boolean;
  movedCount: number;
}): string {
  if (!i.changed) return "Blok už na kalendář sedí.";
  // Zrušení zbytkové značky bez posunu — plán se nehnul, takže ani chain push
  // neproběhl a věta o odsunutí sem nepatří ani omylem.
  if (!i.timesMoved) return "Značka „odložené mimo pracovní dobu“ zrušena — plán se nepohnul.";
  return `Blok přepočítán podle aktuálního kalendáře${shiftedClause(i.movedCount)}.`;
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

```bash
node --test --import tsx src/lib/reflowToastText.test.ts
```
Očekávané: PASS (7 testů).

- [ ] **Step 5: Zapoj do `PlannerPage.tsx`**

Do importů (k ostatním `@/lib/...` importům na začátku souboru) přidej:

```ts
import { reflowMachineToast, reflowBlockToast } from "@/lib/reflowToastText";
```

V `handleReflowMachine` nahraď blok od `const reflowedCount` po uzavírací `);` volání `showToast` tímto:

```ts
      const reflowedCount = Array.isArray(data.reflowed) ? data.reflowed.length : 0;
      const skippedCount = Array.isArray(data.skipped) ? data.skipped.length : 0;
      showToast(
        reflowMachineToast({
          reflowedCount,
          skippedCount,
          movedCount: typeof data.movedCount === "number" ? data.movedCount : 0,
        }),
        "success",
      );
```

V `handleReflowBlock` nahraď celé volání `showToast(...)` (od `showToast(` po `);`) tímto:

```ts
      showToast(
        reflowBlockToast({
          changed: data.changed === true,
          timesMoved,
          movedCount: Array.isArray(data.moves) ? data.moves.length : 0,
        }),
        "success",
      );
```

Pozor: `const before = ...` a `const timesMoved = ...` nad tím zůstávají beze změny — porovnání musí proběhnout PŘED `applyServerBlocks`, jinak už je stav přepsaný.

- [ ] **Step 6: Ověř typy a celou suite**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Očekávané: `tsc` bez výstupu, suite zelená.

- [ ] **Step 7: Commit**

```bash
git add src/lib/reflowToastText.ts src/lib/reflowToastText.test.ts src/app/_components/PlannerPage.tsx
git commit -m "feat(reflow): hlaska po prepoctu rekne, kolik bloku autoposun odsunul"
```

---

# ETAPA C — přepočet do historie (Ctrl+Z)

## Task C1: `AppliedMove` a reflow nesou poziční snapshot PŘED posunem

Ctrl+Z potřebuje původní hodnoty. `AppliedMove` už má `oldStartTime`/`oldEndTime`, ale `BlockSnapshot` (`src/lib/undo/types.ts`) vyžaduje POVINNĚ i `machine`, `updatedAt`, `printMinutes` a `scheduleBypassed`.

**Proč ze serveru a ne z `blocksRef.current`:** klient má načtený jen zobrazený rozsah dní, kdežto chain push posouvá bloky až o týdny dál (havárie 17. 8. odsunula bloky do září). `applyServerBlocks` navíc bloky, které v klientském stavu nejsou, **nepřidává** (`PlannerPage.tsx:578` mapuje jen přes existující). Snapshot ze serveru je tedy jediný, který pokryje i to, co uživatel nevidí.

**Files:**
- Modify: `src/lib/overlapResolver.server.ts` (typ `AppliedMove` ~ř. 14, `select` ~ř. 111, sestavení `applied` ~ř. 240)
- Create: `src/lib/reflowBefore.server.ts`
- Create: `src/lib/reflowBefore.server.test.ts`
- Modify: `src/lib/reflow.server.ts` (`ReflowOutcome` ř. 25, `reflowBlockInTx`, `MachineReflowResult` ř. 199, `reflowMachineInTx`)
- Modify: `src/app/api/blocks/reflow/route.ts`, `src/app/api/blocks/[id]/reflow/route.ts`
- Test: `src/lib/reflowBefore.server.test.ts`, existující `src/lib/overlapResolver.server.test.ts`

**Interfaces:**
- Consumes: nic z předchozích tasků.
- Produces:
  ```ts
  // src/lib/overlapResolver.server.ts
  export type AppliedMove = ChainMove & {
    orderNumber: string | null;
    oldStartTime: Date;
    oldEndTime: Date;
    oldUpdatedAt: Date;
    oldPrintMinutes: number | null;
    oldScheduleBypassed: boolean;
  };

  // src/lib/reflowBefore.server.ts
  export type ReflowBeforeSnapshot = {
    id: number; startTime: string; endTime: string; machine: string;
    updatedAt: string; printMinutes: number | null; scheduleBypassed: boolean;
  };
  export function moveToBefore(machine: string, m: AppliedMove): ReflowBeforeSnapshot
  export function mergeBefore(acc: Map<number, ReflowBeforeSnapshot>, snaps: readonly ReflowBeforeSnapshot[]): void

  // src/lib/reflow.server.ts — ok větev ReflowOutcome a MachineReflowResult
  //   … & { before: ReflowBeforeSnapshot[] }
  ```
  Tvar `ReflowBeforeSnapshot` je ZÁMĚRNĚ shodný s klientským `BlockSnapshot` (`src/lib/undo/types.ts`) — klient ho pošle do `buildReflowCommand` beze změny.

- [ ] **Step 1: Napiš padající test na převod a slučování**

Vytvoř `src/lib/reflowBefore.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { moveToBefore, mergeBefore, type ReflowBeforeSnapshot } from "./reflowBefore.server";
import type { AppliedMove } from "./overlapResolver.server";

function mv(id: number, oldStartIso: string, over: Partial<AppliedMove> = {}): AppliedMove {
  return {
    id,
    startTime: new Date("2026-08-20T10:00:00.000Z"),
    endTime: new Date("2026-08-20T12:00:00.000Z"),
    orderNumber: "18827",
    oldStartTime: new Date(oldStartIso),
    oldEndTime: new Date("2026-08-18T12:00:00.000Z"),
    oldUpdatedAt: new Date("2026-08-18T09:00:00.000Z"),
    oldPrintMinutes: 120,
    oldScheduleBypassed: false,
    ...over,
  } as AppliedMove;
}

test("moveToBefore vyrobí kompletní poziční snapshot z původních hodnot", () => {
  const s = moveToBefore("XL_105", mv(7, "2026-08-18T10:00:00.000Z"));
  assert.deepEqual(s, {
    id: 7,
    startTime: "2026-08-18T10:00:00.000Z",
    endTime: "2026-08-18T12:00:00.000Z",
    machine: "XL_105",
    updatedAt: "2026-08-18T09:00:00.000Z",
    printMinutes: 120,
    scheduleBypassed: false,
  });
});

test("mergeBefore drží PRVNÍ výskyt — hromadný přepočet smí blok posunout víckrát", () => {
  const acc = new Map<number, ReflowBeforeSnapshot>();
  mergeBefore(acc, [moveToBefore("XL_105", mv(7, "2026-08-18T10:00:00.000Z"))]);
  mergeBefore(acc, [moveToBefore("XL_105", mv(7, "2026-08-19T06:00:00.000Z"))]);
  assert.equal(acc.size, 1);
  assert.equal(acc.get(7)!.startTime, "2026-08-18T10:00:00.000Z");
});

test("mergeBefore přidá nové id vedle stávajících", () => {
  const acc = new Map<number, ReflowBeforeSnapshot>();
  mergeBefore(acc, [moveToBefore("XL_105", mv(7, "2026-08-18T10:00:00.000Z"))]);
  mergeBefore(acc, [moveToBefore("XL_105", mv(9, "2026-08-18T14:00:00.000Z"))]);
  assert.deepEqual([...acc.keys()].sort(), [7, 9]);
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

```bash
node --test --import tsx src/lib/reflowBefore.server.test.ts
```
Očekávané: FAIL — `Cannot find module './reflowBefore.server'`.

- [ ] **Step 3: Doplň `AppliedMove` o zbytek snapshotu**

V `src/lib/overlapResolver.server.ts` nahraď typ `AppliedMove`:

```ts
/**
 * Provedený posun bloku — `ChainMove` + původní časy a číslo zakázky (pro audit).
 *
 * `old*` pole nesou KOMPLETNÍ poziční snapshot před posunem, ne jen časy: krok
 * historie (Ctrl+Z) potřebuje `BlockSnapshot`, který má `machine`, `updatedAt`,
 * `printMinutes` i `scheduleBypassed` POVINNÉ. Stroj se sem nedává, protože chain
 * push je z definice per-stroj — doplní ho `moveToBefore` z parametru.
 */
export type AppliedMove = ChainMove & {
  orderNumber: string | null;
  oldStartTime: Date;
  oldEndTime: Date;
  oldUpdatedAt: Date;
  oldPrintMinutes: number | null;
  oldScheduleBypassed: boolean;
};
```

V `tx.block.findMany` `select` (~ř. 111) přidej `updatedAt: true` (ostatní pole už tam jsou).

V sestavení `applied` (~ř. 247) nahraď push:

```ts
    applied.push({
      ...m,
      orderNumber: r.orderNumber,
      oldStartTime: r.startTime,
      oldEndTime: r.endTime,
      oldUpdatedAt: r.updatedAt,
      oldPrintMinutes: r.printMinutes,
      oldScheduleBypassed: r.scheduleBypassed,
    });
```

- [ ] **Step 4: Napiš `reflowBefore.server.ts`**

```ts
import type { AppliedMove } from "@/lib/overlapResolver.server";

/**
 * Poziční snapshot bloku PŘED autoposunem, serializovaný pro odpověď klientovi.
 *
 * Tvar je ZÁMĚRNĚ totožný s klientským `BlockSnapshot` (`src/lib/undo/types.ts`),
 * takže ho klient pošle do `buildReflowCommand` beze změny. Kdyby se ty dva tvary
 * rozešly, krok historie by tiše zapsal neúplnou obnovu — `printMinutes` a
 * `scheduleBypassed` jsou v `BlockSnapshot` povinné právě proto, že endpoint undo
 * nic nederivuje.
 *
 * Proč snapshot vzniká na SERVERU a ne na klientovi z `blocksRef.current`:
 * klient má načtený jen zobrazený rozsah dní a `applyServerBlocks` bloky mimo něj
 * do stavu nepřidává. Chain push přitom posouvá i bloky o týdny dál (havárie
 * 17. 8. 2026 odsunula zakázky až do září). Bez serverového snapshotu by se
 * takový blok do kroku historie vůbec nedostal.
 */
export type ReflowBeforeSnapshot = {
  id: number;
  startTime: string;
  endTime: string;
  machine: string;
  updatedAt: string;
  printMinutes: number | null;
  scheduleBypassed: boolean;
};

export function moveToBefore(machine: string, m: AppliedMove): ReflowBeforeSnapshot {
  return {
    id: m.id,
    startTime: m.oldStartTime.toISOString(),
    endTime: m.oldEndTime.toISOString(),
    machine,
    updatedAt: m.oldUpdatedAt.toISOString(),
    printMinutes: m.oldPrintMinutes,
    scheduleBypassed: m.oldScheduleBypassed,
  };
}

/**
 * Sloučení snapshotů z několika posunů do jedné dávky. PRVNÍ výskyt vyhrává.
 *
 * Hromadný přepočet stroje jde driftnutými bloky chronologicky, takže TÝŽ blok
 * může být nejdřív odsunut chain pushem dřívějšího bloku a teprve pak sám
 * přepočítán (nebo naopak). Krok historie musí vrátit stav ze ZAČÁTKU celé
 * operace, ne mezistav uvnitř transakce — proto se pozdější snapshot zahazuje.
 */
export function mergeBefore(
  acc: Map<number, ReflowBeforeSnapshot>,
  snaps: readonly ReflowBeforeSnapshot[],
): void {
  for (const s of snaps) if (!acc.has(s.id)) acc.set(s.id, s);
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

```bash
node --test --import tsx src/lib/reflowBefore.server.test.ts
```
Očekávané: PASS (3 testy).

- [ ] **Step 6: Protáhni `before` reflow jádrem**

V `src/lib/reflow.server.ts` přidej import:

```ts
import { moveToBefore, mergeBefore, type ReflowBeforeSnapshot } from "@/lib/reflowBefore.server";
```

Nahraď `ReflowOutcome` (ř. 25):

```ts
export type ReflowOutcome =
  | {
      ok: true;
      changed: boolean;
      startTime: Date;
      endTime: Date;
      moves: AppliedMove[];
      /**
       * Poziční stav VŠECH dotčených bloků před přepočtem — přepočítaný blok sám
       * i každý, který odsunul jeho chain push. Prázdné, když se nic nezměnilo.
       */
      before: ReflowBeforeSnapshot[];
    }
  | {
      ok: false;
      code: "NOT_FOUND" | "NOT_ZAKAZKA" | "LOCKED" | "PRINTED" | "NO_PM" | "UNALIGNED" | "NO_SLOT" | "HORIZON";
      message: string;
    };
```

V `reflowBlockInTx` doplň hned za `const pm = block.printMinutes;` (~ř. 99):

```ts
  // Snapshot samotného přepočítávaného bloku — bere se PŘED update, protože
  // `scheduleBypassed` se u něj může zrušit a Ctrl+Z ho musí vrátit i s příznakem.
  const selfBefore: ReflowBeforeSnapshot = {
    id: blockId,
    startTime: oldStart.toISOString(),
    endTime: oldEnd.toISOString(),
    machine: block.machine,
    updatedAt: block.updatedAt.toISOString(),
    printMinutes: block.printMinutes,
    scheduleBypassed: block.scheduleBypassed,
  };
```

Uprav tři návratové body (jinak `tsc` spadne na chybějícím `before`):

```ts
  // 1) nic k dělání (~ř. 139)
  if (!moved && !clearsFlag) {
    return { ok: true, changed: false, startTime: oldStart, endTime: oldEnd, moves: [], before: [] };
  }
  // 2) zrušená značka bez posunu (~ř. 154)
  if (!moved) {
    return { ok: true, changed: true, startTime: oldStart, endTime: oldEnd, moves: [], before: [selfBefore] };
  }
  // 3) posun + chain push (~ř. 196)
  return {
    ok: true, changed: true, startTime: newStart, endTime: newEnd, moves,
    before: [selfBefore, ...moves.map((m) => moveToBefore(block.machine, m))],
  };
```

V `MachineReflowResult` (ř. 199) přidej pole:

```ts
  /**
   * Poziční stav VŠECH dotčených bloků na ZAČÁTKU přepočtu stroje. Slučuje se
   * přes `mergeBefore` (první výskyt vyhrává) — jeden blok může být během běhu
   * dotčen víckrát a krok historie musí vrátit výchozí stav, ne mezistav.
   */
  before: ReflowBeforeSnapshot[];
```

V `reflowMachineInTx` uprav akumulaci a návrat:

```ts
  const reflowed: MachineReflowResult["reflowed"] = [];
  const skipped: MachineReflowResult["skipped"] = [];
  const movedIdSet = new Set<number>();
  const beforeById = new Map<number, ReflowBeforeSnapshot>();

  for (const block of drifted) {
    const outcome = await deps.reflowBlock(tx, block.id, actor, { resolveChainPush: resolveChainPushFromDb, preloadedCalendar });
    if (!outcome.ok) {
      skipped.push({ id: block.id, orderNumber: block.orderNumber, reason: outcome.code });
      continue;
    }
    if (!outcome.changed) continue;
    reflowed.push({ id: block.id, orderNumber: block.orderNumber });
    for (const move of outcome.moves) movedIdSet.add(move.id);
    mergeBefore(beforeById, outcome.before);
  }

  return { reflowed, skipped, movedIds: [...movedIdSet], before: [...beforeById.values()] };
```

- [ ] **Step 7: Vrať `before` z obou rout**

V `src/app/api/blocks/reflow/route.ts` uprav OBĚ návratové větve (early return při `allIds.length === 0` i finální):

```ts
    if (allIds.length === 0) {
      return NextResponse.json({ reflowed: result.reflowed, skipped: result.skipped, movedCount: 0, blocks: [], before: [] });
    }
```
a ve finální odpovědi přidej za `movedCount`:
```ts
      before: result.before,
```

V `src/app/api/blocks/[id]/reflow/route.ts` přidej do finální `NextResponse.json` za `moves`:
```ts
      before: outcome.before,
```

- [ ] **Step 8: Sroni existující testy resolveru**

`src/lib/overlapResolver.server.test.ts` staví fake `tx` s řádky bloků. Doplň do každého fake řádku `updatedAt: new Date("2026-08-18T09:00:00.000Z")` — bez něj bude `oldUpdatedAt` `undefined` a `.toISOString()` spadne. Najdi je:

```bash
grep -n "printCompletedAt\|scheduleBypassed" src/lib/overlapResolver.server.test.ts | head -20
```

- [ ] **Step 9: Ověř typy a celou suite**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Očekávané: `tsc` bez výstupu, suite zelená.

- [ ] **Step 10: Commit**

```bash
git add src/lib/overlapResolver.server.ts src/lib/overlapResolver.server.test.ts \
  src/lib/reflowBefore.server.ts src/lib/reflowBefore.server.test.ts \
  src/lib/reflow.server.ts src/app/api/blocks/reflow/route.ts src/app/api/blocks/\[id\]/reflow/route.ts
git commit -m "feat(reflow): odpoved nese pozicni stav pred prepoctem (podklad pro Ctrl+Z)"
```

---

## Task C2: `buildReflowCommand` — krok historie bez klientského liveness guardu

`buildMoveCommand` volá `guard()`, který pro každý snapshot žádá `effects.getLiveBlock(id)` a při chybějícím bloku hodí `StaleUndoError`. Blok odsunutý mimo načtený rozsah dní v klientském stavu NENÍ, takže by Ctrl+Z u přepočtu padal vždycky. Serverový `applyUndo` přitom kontroluje `expectedUpdatedAt` VŠECH cílů atomicky před prvním zápisem (viz docblock `buildEditCommand`) — klientský guard je jen rychlá zkratka a pro tuhle cestu se vypíná.

**Files:**
- Create: `src/lib/undo/limits.ts`
- Modify: `src/lib/undo/commands.ts` (funkce `guard` ř. 16, `buildMoveCommand` ř. 57)
- Modify: `src/lib/undoApply.server.ts` (literál `200` na ř. 71)
- Test: `src/lib/undo/commands.test.ts`

**Interfaces:**
- Consumes: `ReflowBeforeSnapshot` z Tasku C1 (strukturálně = `BlockSnapshot`).
- Produces:
  ```ts
  // src/lib/undo/limits.ts
  export const UNDO_MAX_OPS = 200;
  // src/lib/undo/commands.ts
  export function buildReflowCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry
  ```

- [ ] **Step 1: Napiš padající testy**

Do `src/lib/undo/commands.test.ts` přidej na konec:

```ts
import { buildReflowCommand } from "./commands";
import { UNDO_MAX_OPS } from "./limits";

test("buildReflowCommand vrátí blok, který v klientském stavu VŮBEC NENÍ", async () => {
  // Blok 42 leží mimo načtený rozsah dní — getLiveBlock ho nezná. buildMoveCommand
  // by tady hodil StaleUndoError; reflow verze se spolehne na serverový zámek.
  const live = new Map<number, Block>();
  const { effects, calls } = makeEffects(live);
  const before = [{ id: 42, startTime: "2026-08-18T10:00:00.000Z", endTime: "2026-08-18T12:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: 120, scheduleBypassed: false }];
  const after = [{ id: 42, startTime: "2026-08-20T10:00:00.000Z", endTime: "2026-08-20T12:00:00.000Z", machine: "XL_105", updatedAt: "v2", printMinutes: 120, scheduleBypassed: false }];

  const entry = buildReflowCommand("Přepočet bloku", before, after);
  await entry.undo(effects);

  assert.equal(calls.undo.length, 1);
  assert.equal(calls.undo[0]!.ops.length, 1);
  const op = calls.undo[0]!.ops[0]!;
  assert.equal(op.kind, "upsert");
  assert.equal(op.id, 42);
  // Zámek se posílá i bez klientského guardu — kontrolu dělá server.
  assert.equal(op.expectedUpdatedAt, "v2");
});

test("buildMoveCommand na chybějícím bloku PADÁ dál (regrese — guard se nesmí uvolnit plošně)", async () => {
  const live = new Map<number, Block>();
  const { effects } = makeEffects(live);
  const snap = { id: 42, startTime: "2026-08-18T10:00:00.000Z", endTime: "2026-08-18T12:00:00.000Z", machine: "XL_105", updatedAt: "v1", printMinutes: 120, scheduleBypassed: false };
  const entry = buildMoveCommand("Přesun", [snap], [{ ...snap, updatedAt: "v2" }]);
  await assert.rejects(() => entry.undo(effects), StaleUndoError);
});

test("UNDO_MAX_OPS je 200 — shodně s tím, co endpoint přijme", () => {
  assert.equal(UNDO_MAX_OPS, 200);
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

```bash
node --test --import tsx src/lib/undo/commands.test.ts
```
Očekávané: FAIL — `buildReflowCommand is not a function` a `Cannot find module './limits'`.

- [ ] **Step 3: Vytvoř `src/lib/undo/limits.ts`**

```ts
/**
 * Strop operací v JEDNÉ undo/redo dávce.
 *
 * Jediný zdroj pravdy pro obě strany: `sanitizeUndoOps` (`undoApply.server.ts`)
 * nad ním vrací 400, a klient podle něj pozná, že krok historie nemá smysl vůbec
 * zaznamenávat — jinak by Ctrl+Z po velkém přepočtu stroje spadl na
 * „Seznam operací je příliš dlouhý" místo aby uživateli rovnou řekl, že tuhle
 * dávku vrací historie bloku (`docs/superpowers/specs/2026-08-18-…`, etapa D).
 */
export const UNDO_MAX_OPS = 200;
```

- [ ] **Step 4: Uprav `undoApply.server.ts`, ať konstantu používá**

Nahraď na ř. 71 literál:

```ts
  if (raw.length > UNDO_MAX_OPS) bad(`Seznam operací je příliš dlouhý (max ${UNDO_MAX_OPS}).`);
```
a přidej import `import { UNDO_MAX_OPS } from "./undo/limits";` (cestu srovnej podle ostatních importů v souboru).

- [ ] **Step 5: Přidej `buildReflowCommand`**

V `src/lib/undo/commands.ts` uprav `guard` a `buildMoveCommand` a přidej nový builder:

```ts
/**
 * Rychlá klientská zkratka proti souběhu. `requireLive: false` ji vypne pro
 * bloky, které v klientském stavu být NEMUSÍ (viz `buildReflowCommand`) —
 * bezpečnost tím netrpí, protože `applyUndo` na serveru kontroluje
 * `expectedUpdatedAt` VŠECH cílů atomicky před prvním zápisem.
 */
function guard(effects: UndoEffects, expected: BlockSnapshot[], requireLive = true): void {
  for (const s of expected) {
    const live = effects.getLiveBlock(s.id);
    if (!live) {
      if (requireLive) throw new StaleUndoError();
      continue;
    }
    if (live.updatedAt !== s.updatedAt) throw new StaleUndoError();
  }
}

function moveCommand(
  label: string,
  before: BlockSnapshot[],
  after: BlockSnapshot[],
  requireLive: boolean,
): HistoryEntry {
  const apply = async (effects: UndoEffects, target: BlockSnapshot[], expected: BlockSnapshot[], direction: "undo" | "redo") => {
    guard(effects, expected, requireLive);
    const expMap = new Map(expected.map((e) => [e.id, e.updatedAt]));
    const res = await effects.applyUndo({
      label, direction,
      ops: target.map((t) => posOp(t, expMap.get(t.id))),
    });
    refresh(target, res.updated);
    effects.addToState(res.updated);
    return affected(res);
  };
  return {
    label,
    undo: (effects) => apply(effects, before, after, "undo"),
    redo: (effects) => apply(effects, after, before, "redo"),
  };
}

export function buildMoveCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry {
  return moveCommand(label, before, after, true);
}

/**
 * Krok historie po přepočtu („Přepočítat" na bloku i na stroji).
 *
 * Od `buildMoveCommand` se liší JEDINOU věcí: netrvá na tom, aby dotčený blok
 * byl v klientském stavu. Chain push posouvá i bloky mimo načtený rozsah dní
 * (havárie 17. 8. 2026 odsunula zakázky až do září) a `applyServerBlocks` je do
 * stavu nepřidává — s původním guardem by Ctrl+Z u přepočtu selhal vždycky.
 * Zámek `expectedUpdatedAt` se posílá dál a kontroluje ho server.
 */
export function buildReflowCommand(label: string, before: BlockSnapshot[], after: BlockSnapshot[]): HistoryEntry {
  return moveCommand(label, before, after, false);
}
```

Původní tělo `buildMoveCommand` (ř. 57–74) se tímhle nahradí — nezůstane po něm duplicitní kopie.

- [ ] **Step 6: Spusť testy a ověř, že prochází**

```bash
node --test --import tsx src/lib/undo/commands.test.ts src/lib/undoApply.test.ts
```
Očekávané: PASS včetně tří nových testů. (Když `src/lib/undoApply.test.ts` neexistuje, spusť jen první soubor.)

- [ ] **Step 7: Ověř typy a celou suite**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/undo/limits.ts src/lib/undo/commands.ts src/lib/undo/commands.test.ts src/lib/undoApply.server.ts
git commit -m "feat(undo): buildReflowCommand - krok historie i pro bloky mimo nacteny rozsah"
```

---

## Task C3: Přepočet zapisuje krok do historie

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (`handleReflowMachine`, `handleReflowBlock`)

**Interfaces:**
- Consumes: `before` z odpovědi (Task C1), `buildReflowCommand` a `UNDO_MAX_OPS` (Task C2), `reflowMachineToast`/`reflowBlockToast` (Task A1).
- Produces: nic pro další tasky.

- [ ] **Step 1: Doplň importy**

```ts
import { buildMoveCommand, buildMultiEditCommand, buildCreateCommand, buildDeleteCommand, buildMoveOrResizeCommand, buildReflowCommand } from "@/lib/undo/commands";
import { UNDO_MAX_OPS } from "@/lib/undo/limits";
```
(První řádek je úprava stávajícího importu na ř. 24, ne nový.)

- [ ] **Step 2: Přidej sdílený pomocník nad `handleReflowMachine`**

```ts
  /**
   * Krok historie po přepočtu. `before` přišlo ze serveru (nese i bloky, které
   * klient nemá načtené), `after` se poskládá ze serializovaných bloků v odpovědi.
   *
   * Když dávka přeroste `UNDO_MAX_OPS`, krok se ZÁMĚRNĚ nezaznamená a uživateli
   * se to řekne — endpoint undo by ji stejně odmítl 400 a mlčky zaznamenaný krok
   * by v historii jen svítil jako past. Takovou dávku vrací „Vrátit tuto změnu"
   * v historii bloku (etapa D).
   */
  function recordReflowUndo(
    label: string,
    before: BlockSnapshot[] | undefined,
    resultBlocks: Block[],
  ): void {
    if (!Array.isArray(before) || before.length === 0) return;
    if (before.length > UNDO_MAX_OPS) {
      showToast(
        `Přepočet zasáhl ${before.length} bloků — na Ctrl+Z je to moc. Vrátit ho jde v historii bloku.`,
        "info",
      );
      return;
    }
    const byId = new Map(resultBlocks.filter((b) => b && typeof b.id === "number").map((b) => [b.id, b]));
    const after: BlockSnapshot[] = [];
    const kept: BlockSnapshot[] = [];
    for (const s of before) {
      const b = byId.get(s.id);
      // Blok, který server v odpovědi nevrátil, nemá „po" stav — vynechává se
      // z OBOU stran, jinak by redo zapisoval do prázdna.
      if (!b) continue;
      kept.push(s);
      after.push({
        id: b.id, startTime: b.startTime as string, endTime: b.endTime as string,
        machine: b.machine, updatedAt: b.updatedAt,
        printMinutes: b.printMinutes ?? null, scheduleBypassed: b.scheduleBypassed ?? false,
      });
    }
    if (kept.length === 0) return;
    recordUndo(buildReflowCommand(label, kept, after));
  }
```

Import typu `BlockSnapshot` doplň k ostatním undo importům:
```ts
import type { BlockSnapshot } from "@/lib/undo/types";
```
(Pokud už je importovaný — `snapshotShiftedFromResponse` ho používá — nepřidávej ho podruhé.)

- [ ] **Step 3: Zapoj v `handleReflowMachine`**

Za `if (Array.isArray(data.blocks) && data.blocks.length) applyServerBlocks(data.blocks);` přidej:

```ts
      recordReflowUndo("Přepočet stroje", data.before, Array.isArray(data.blocks) ? data.blocks : []);
```

- [ ] **Step 4: Zapoj v `handleReflowBlock`**

Za `applyServerBlocks([data.block, ...(data.moves ?? [])]);` přidej:

```ts
      recordReflowUndo("Přepočet bloku", data.before, [data.block, ...(data.moves ?? [])]);
```

- [ ] **Step 5: Ověř typy, lint a suite**

```bash
npx tsc --noEmit
npx eslint src/app/_components/PlannerPage.tsx
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Očekávané: `tsc` bez výstupu, eslint bez chyb (warningy jsou OK), suite zelená.

- [ ] **Step 6: Ruční proklik (dev, port 3001)**

- [ ] Přepočítej JEDEN blok s driftem → toast řekne počet odsunutých → **Ctrl+Z** vrátí blok i odsunuté
- [ ] **Ctrl+Z hned po přepočtu NESMÍ vrátit předchozí, cizí akci** (to je ta dnešní vada)
- [ ] **Ctrl+Y / redo** posun zopakuje
- [ ] Přepočítej celý stroj → toast s počtem → Ctrl+Z
- [ ] Přepočet bloku, který jen ruší značku „odložené" (nic se nepohne) → Ctrl+Z vrátí příznak

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(reflow): prepocet se zapisuje do historie - Ctrl+Z ho vrati"
```

---

**⛔ KONEC 1. NASAZENÍ (etapa A + C). Zastav se a počkej na OK.**
Nasazuje se podle `docs/DEPLOY_WORKFLOW.md`; dávka nemá migraci, rollback = `git reset --hard` + build.

---

# ETAPA B — strop a potvrzení

## Dvě opravy proti specu (zjištěno při psaní plánu)

1. **`errorStatus` NENÍ `Record`** — je to `switch` s `default: return 500` (`src/lib/errors.ts:42`). Chybějící `case` tedy build projde a tiše vrátí 500. Hlídá to test v Tasku B1.
2. **Riziko „drag zůstane s optimistickým stavem po 409" je menší, než spec předpokládal.** Obě dragové cesty v `TimelineGrid.tsx` (`ds.type === "move"` ~ř. 1082 a `"resize"` ~ř. 1102) při `!res.ok` jen zavolají `onError` a **vrátí se bez zápisu do stavu** — blok se překreslí z `blocks`, tedy na původní pozici. Nový dialog tím pádem nezavádí novou třídu vady. Test z Tasku B3 přesto zůstává jako pojistka: kdyby někdo optimistiku později přidal, spadne.
3. **Nový komponent `CascadeConfirmDialog.tsx` NEVZNIKÁ.** Sdílený `src/components/ConfirmDialog.tsx` má přesně, co je potřeba (Escape, klik mimo, `danger`, `autoFocusConfirm={false}` pro fokus na „Zrušit"). Tabulka File Structure výš je v tomhle bodě opravená tímhle odstavcem.

---

## Task B1: Modul prahu a měření dopadu

**Files:**
- Create: `src/lib/cascadeLimit.ts` (čistý, testovatelný — konstanty, měření, věta)
- Create: `src/lib/cascadeLimit.server.ts` (vynucení — hází `AppError` nebo loguje)
- Create: `src/lib/cascadeLimit.test.ts`
- Modify: `src/lib/errors.ts` (nový kód + `case` v `errorStatus`)

**Interfaces:**
- Consumes: `MAX_RIGID_PUSH_MS` z `src/lib/overlapResolver.ts` (existující export, 7 dní).
- Produces:
  ```ts
  // src/lib/cascadeLimit.ts
  export const CASCADE_CONFIRM_MAX_BLOCKS = 5;
  export const CASCADE_CONFIRM_ENFORCED = false;
  export type CascadeImpact = {
    movedCount: number;
    maxShiftMs: number;
    farthestEnd: Date | null;
    exceeded: boolean;
  };
  export function measureCascade(
    moves: ReadonlyArray<{ startTime: Date; endTime: Date; oldStartTime: Date }>,
  ): CascadeImpact
  export function cascadeConfirmMessage(i: CascadeImpact): string

  // src/lib/cascadeLimit.server.ts
  export function assertCascadeConfirmed(
    impact: CascadeImpact,
    opts: { confirmed: boolean; path: string },
  ): void
  ```

- [ ] **Step 1: Napiš padající testy**

Vytvoř `src/lib/cascadeLimit.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  measureCascade, cascadeConfirmMessage,
  CASCADE_CONFIRM_MAX_BLOCKS, CASCADE_CONFIRM_ENFORCED,
} from "./cascadeLimit";
import { MAX_RIGID_PUSH_MS } from "./overlapResolver";
import { errorStatus } from "./errors";
import { formatPragueDateShort } from "./dateUtils";

const D = (iso: string) => new Date(iso);

function move(oldStart: string, newStart: string, newEnd: string) {
  return { oldStartTime: D(oldStart), startTime: D(newStart), endTime: D(newEnd) };
}

test("prázdná dávka nic nepřekračuje", () => {
  const i = measureCascade([]);
  assert.deepEqual(i, { movedCount: 0, maxShiftMs: 0, farthestEnd: null, exceeded: false });
});

test("pět bloků o hodinu je pod prahem", () => {
  const moves = Array.from({ length: 5 }, (_, k) =>
    move(`2026-08-18T0${k}:00:00.000Z`, `2026-08-18T0${k + 1}:00:00.000Z`, `2026-08-18T0${k + 2}:00:00.000Z`),
  );
  const i = measureCascade(moves);
  assert.equal(i.movedCount, 5);
  assert.equal(i.exceeded, false);
});

test("šestý blok práh překročí", () => {
  const moves = Array.from({ length: 6 }, (_, k) =>
    move(`2026-08-18T0${k}:00:00.000Z`, `2026-08-18T0${k + 1}:00:00.000Z`, `2026-08-18T0${k + 2}:00:00.000Z`),
  );
  assert.equal(measureCascade(moves).exceeded, true);
});

test("JEDINÝ blok odsunutý dál než 7 dní práh překročí taky", () => {
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-30T08:00:00.000Z", "2026-08-30T10:00:00.000Z"),
  ]);
  assert.equal(i.movedCount, 1);
  assert.ok(i.maxShiftMs > MAX_RIGID_PUSH_MS);
  assert.equal(i.exceeded, true);
});

test("měří NEJVĚTŠÍ posun jednoho bloku, ne rozpětí dávky", () => {
  // Dlouhá, ale drobná kaskáda: 3 bloky, každý o hodinu, poslední daleko v čase.
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-18T09:00:00.000Z", "2026-08-18T11:00:00.000Z"),
    move("2026-08-25T08:00:00.000Z", "2026-08-25T09:00:00.000Z", "2026-08-25T11:00:00.000Z"),
    move("2026-09-01T08:00:00.000Z", "2026-09-01T09:00:00.000Z", "2026-09-01T11:00:00.000Z"),
  ]);
  assert.equal(i.maxShiftMs, 60 * 60 * 1000);
  assert.equal(i.exceeded, false);
});

test("farthestEnd je nejzazší NOVÝ konec v dávce", () => {
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-18T09:00:00.000Z", "2026-08-19T11:00:00.000Z"),
    move("2026-08-18T12:00:00.000Z", "2026-08-18T13:00:00.000Z", "2026-08-21T06:00:00.000Z"),
  ]);
  assert.equal(i.farthestEnd?.toISOString(), "2026-08-21T06:00:00.000Z");
});

test("věta nese počet i nejzazší datum", () => {
  const i = measureCascade([
    move("2026-08-18T08:00:00.000Z", "2026-08-20T09:00:00.000Z", "2026-08-21T06:00:00.000Z"),
  ]);
  const msg = cascadeConfirmMessage(i);
  assert.ok(msg.includes("1 navazujících bloků"), msg);
  assert.ok(msg.includes(formatPragueDateShort(new Date("2026-08-21T06:00:00.000Z"))), msg);
});

test("CASCADE_CONFIRM má HTTP 409 — errorStatus je switch s default 500, tohle to hlídá", () => {
  assert.equal(errorStatus("CASCADE_CONFIRM"), 409);
});

test("vlna se nasazuje v režimu MĚŘENÍ — vynucení se zapíná až samostatným commitem", () => {
  assert.equal(CASCADE_CONFIRM_ENFORCED, false);
  assert.equal(CASCADE_CONFIRM_MAX_BLOCKS, 5);
});
```

- [ ] **Step 2: Spusť testy a ověř, že padají**

```bash
node --test --import tsx src/lib/cascadeLimit.test.ts
```
Očekávané: FAIL — `Cannot find module './cascadeLimit'`.

- [ ] **Step 3: Přidej kód chyby do `errors.ts`**

Do unionu `AppErrorCode` (za `MEASUREMENT_FAILED`):

```ts
  /**
   * Chain push by odsunul víc bloků nebo dál, než je práh (`cascadeLimit.ts`).
   * Transakce se odroluje a klient dostane 409 s čísly; po potvrzení pošle
   * požadavek znovu s `cascadeConfirmed: true`. Týž vzor jako
   * `SHIFT_SHRINK_CASCADE` u editace směn (17. 8. 2026).
   */
  | "CASCADE_CONFIRM";
```

Do `errorStatus` k ostatním 409:

```ts
    case "CONFLICT":
    case "OVERLAP":
    case "AUTO_SHIFT_FAILED":
    case "CASCADE_CONFIRM":
      return 409;
```

**Pozor:** `errorStatus` je `switch` s `default: return 500`. Kdyby ta `case` větev chyběla, build projde a klient dostane 500 — dialog by se nikdy neukázal. Přesně to hlídá test ze Step 1.

- [ ] **Step 4: Napiš `src/lib/cascadeLimit.ts`**

```ts
import { MAX_RIGID_PUSH_MS } from "@/lib/overlapResolver";
import { formatPragueDateShort } from "@/lib/dateUtils";

/**
 * Práh, nad kterým se aplikace na kaskádu autoposunu zeptá.
 *
 * Vzniklo po havárii 17. 8. 2026 16:31: posun konce bloku o délku noční pauzy
 * odsunul 88 navazujících zakázek, některé o týdny — a nic tomu nebránilo,
 * protože ZAKAZKA horizont posunu nemá (`overlapResolver.ts`, komentář
 * „Zakázka horizont nemá"). Rigidní blok má strop `MAX_RIGID_PUSH_MS` = 7 dní.
 */
export const CASCADE_CONFIRM_MAX_BLOCKS = 5;

/**
 * Vypnuto = režim MĚŘENÍ: překročení prahu se jen zaloguje a transakce projde.
 * Po týdnu provozu se z logu pozná, jak často by se aplikace ptala, a teprve
 * pak se konstanta přepne SAMOSTATNÝM commitem (etapa B4). NENÍ to feature flag
 * za běhu — je to jeden commit tam a druhý zpět.
 */
export const CASCADE_CONFIRM_ENFORCED = false;

export type CascadeImpact = {
  /** Kolik bloků by se posunulo. */
  movedCount: number;
  /**
   * NEJVĚTŠÍ posun JEDNOHO bloku, ne rozpětí celé dávky. Dlouhá, ale drobná
   * kaskáda (deset bloků po půlhodině napříč měsícem) by jinak vyšla stejně
   * jako jediný blok odsunutý o měsíc — a to je právě ten nebezpečný případ.
   */
  maxShiftMs: number;
  /** Nejzazší NOVÝ konec v dávce — do věty „nejdál do 21. 08.". */
  farthestEnd: Date | null;
  exceeded: boolean;
};

export function measureCascade(
  moves: ReadonlyArray<{ startTime: Date; endTime: Date; oldStartTime: Date }>,
): CascadeImpact {
  let maxShiftMs = 0;
  let farthestEnd: Date | null = null;
  for (const m of moves) {
    const shift = m.startTime.getTime() - m.oldStartTime.getTime();
    if (shift > maxShiftMs) maxShiftMs = shift;
    if (farthestEnd === null || m.endTime.getTime() > farthestEnd.getTime()) farthestEnd = m.endTime;
  }
  const movedCount = moves.length;
  return {
    movedCount,
    maxShiftMs,
    farthestEnd,
    exceeded: movedCount > CASCADE_CONFIRM_MAX_BLOCKS || maxShiftMs > MAX_RIGID_PUSH_MS,
  };
}

/**
 * Věta do potvrzovacího dialogu. Skloňování se neřeší — parita s dnešní hláškou
 * „Posunuto N navazujících bloků" (`PlannerPage.tsx`).
 */
export function cascadeConfirmMessage(i: CascadeImpact): string {
  const kam = i.farthestEnd ? `, nejdál do ${formatPragueDateShort(i.farthestEnd)}` : "";
  return `Tato změna odsune ${i.movedCount} navazujících bloků${kam}. Potvrdit?`;
}
```

- [ ] **Step 5: Napiš `src/lib/cascadeLimit.server.ts`**

```ts
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { cascadeConfirmMessage, CASCADE_CONFIRM_ENFORCED, type CascadeImpact } from "@/lib/cascadeLimit";

/**
 * Jediné místo, které práh VYNUCUJE. Volá se PŘED zápisem posunů — výjimka
 * odroluje celou transakci, takže se nezapíše nic.
 *
 * V režimu měření (`CASCADE_CONFIRM_ENFORCED === false`) se překročení jen
 * zaloguje. Log je jediný podklad pro rozhodnutí, jestli je práh 5 správně —
 * proto nese počet, vzdálenost i cestu, ze které posun přišel.
 */
export function assertCascadeConfirmed(
  impact: CascadeImpact,
  opts: { confirmed: boolean; path: string },
): void {
  if (!impact.exceeded || opts.confirmed) return;

  const detail = {
    path: opts.path,
    movedCount: impact.movedCount,
    maxShiftHours: Math.round(impact.maxShiftMs / 3_600_000),
    farthestEnd: impact.farthestEnd?.toISOString() ?? null,
    enforced: CASCADE_CONFIRM_ENFORCED,
  };

  if (!CASCADE_CONFIRM_ENFORCED) {
    logger.info("[cascade] práh překročen (režim měření, transakce pokračuje)", detail);
    return;
  }

  logger.warn("[cascade] práh překročen — transakce se odroluje", detail);
  throw new AppError("CASCADE_CONFIRM", cascadeConfirmMessage(impact), {
    movedCount: impact.movedCount,
    maxShiftMs: impact.maxShiftMs,
    farthestEnd: impact.farthestEnd?.toISOString() ?? null,
  });
}
```

- [ ] **Step 6: Spusť testy a ověř, že prochází**

```bash
node --test --import tsx src/lib/cascadeLimit.test.ts
```
Očekávané: PASS (9 testů).

- [ ] **Step 7: Ověř typy a celou suite, pak commit**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add src/lib/cascadeLimit.ts src/lib/cascadeLimit.server.ts src/lib/cascadeLimit.test.ts src/lib/errors.ts
git commit -m "feat(cascade): prah autoposunu - mereni dopadu a kod CASCADE_CONFIRM"
```

---

## Task B2: Vynucení prahu na všech zápisových cestách

Kontrola sedí uvnitř `resolveChainPushFromDb`, kudy prochází **všech pět** cest. Batch navíc kontroluje SOUČET přes všechny kotvy — deset kotev po třech posunutých blocích je třicet posunutých bloků, i když žádné jednotlivé volání práh nepřekročí.

**Files:**
- Modify: `src/lib/overlapResolver.server.ts` (signatura + kontrola před zápisem)
- Modify: `src/lib/reflow.server.ts` (protažení `cascadeConfirmed`)
- Modify: `src/app/api/blocks/route.ts`, `src/app/api/blocks/[id]/route.ts`, `src/app/api/blocks/batch/route.ts`, `src/app/api/blocks/[id]/split/route.ts`, `src/app/api/blocks/reflow/route.ts`, `src/app/api/blocks/[id]/reflow/route.ts`
- Create: `src/lib/cascadeResponse.ts` (jednotná 409 odpověď — ať se šest catch bloků nerozejde)
- Test: `src/lib/overlapResolver.server.test.ts`

**Interfaces:**
- Consumes: `measureCascade`, `assertCascadeConfirmed` (Task B1); `AppliedMove` (Task C1).
- Produces:
  ```ts
  // src/lib/overlapResolver.server.ts — nový 6. parametr
  resolveChainPushFromDb(tx, machine, anchor, excludeIds?, frozenIds?,
    opts?: { cascadeConfirmed?: boolean; path?: string })

  // src/lib/cascadeResponse.ts
  export function cascadeConfirmBody(err: AppError): {
    error: string; code: "CASCADE_CONFIRM";
    cascade: { movedCount: number; maxShiftMs: number; farthestEnd: string | null };
  }
  ```

- [ ] **Step 1: Napiš padající test do `overlapResolver.server.test.ts`**

```ts
import { measureCascade } from "./cascadeLimit";

test("chain push nad prahem se v režimu MĚŘENÍ nezastaví", async () => {
  // CASCADE_CONFIRM_ENFORCED je false, takže i velká kaskáda projde — a to je
  // záměr prvního týdne provozu. Test tím drží, že se vlna nasadí neškodná.
  const tx = makeTx([
    ...Array.from({ length: 8 }, (_, k) => row(10 + k, H(12 + k), H(13 + k))),
  ]);
  const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) });
  assert.ok(moves.length > 5);
});

test("measureCascade nad výsledkem chain pushe vidí skutečný dopad", async () => {
  const tx = makeTx([row(10, H(12), H(13)), row(11, H(13), H(14))]);
  const moves = await resolveChainPushFromDb(tx, "XL_105", { id: 1, startTime: H(10), endTime: H(13) });
  const impact = measureCascade(moves);
  assert.equal(impact.movedCount, moves.length);
  assert.ok(impact.maxShiftMs > 0);
});
```

Pomocníky `makeTx`/`row`/`H` má soubor už dnes — použij ty existující, nezaváděj nové (podívej se na `src/lib/overlapResolver.server.test.ts:1-45`).

- [ ] **Step 2: Spusť a ověř, že padá**

```bash
node --test --import tsx src/lib/overlapResolver.server.test.ts
```
Očekávané: FAIL na chybějícím `./cascadeLimit` importu v testu (modul existuje z B1, ale test ho zatím neimportoval) nebo na tvaru — spusť a přečti si skutečnou hlášku.

- [ ] **Step 3: Doplň kontrolu do `resolveChainPushFromDb`**

Import nahoře:
```ts
import { measureCascade } from "@/lib/cascadeLimit";
import { assertCascadeConfirmed } from "@/lib/cascadeLimit.server";
```

Signatura — přidej **šestý** parametr (dosavadních pět zůstává beze změny, aby se nemusela přepisovat existující volání):
```ts
  frozenIds: ReadonlySet<number> = new Set(),
  /**
   * `cascadeConfirmed` — uživatel velkou kaskádu odklepl v dialogu; kontrola se
   * přeskočí. `path` jde jen do logu, aby se z týdne měření dalo poznat, KTERÁ
   * cesta se ptá nejčastěji.
   */
  opts: { cascadeConfirmed?: boolean; path?: string } = {},
): Promise<AppliedMove[]> {
```

Kontrolu vlož hned za `if (result.moves.length === 0) return [];` (~ř. 197), tedy PŘED nezávislou pojistkou i před zápisy:

```ts
  // Strop kaskády — měří se na SPOČÍTANÝCH posunech, ještě než se cokoliv zapíše.
  // Výjimka odroluje celou transakci, takže se do DB nedostane ani jeden update.
  assertCascadeConfirmed(
    measureCascade(
      result.moves.map((m) => ({
        startTime: m.startTime,
        endTime: m.endTime,
        oldStartTime: rowById.get(m.id)!.startTime,
      })),
    ),
    { confirmed: opts.cascadeConfirmed === true, path: opts.path ?? "chain-push" },
  );
```

- [ ] **Step 4: Protáhni příznak reflow jádrem**

V `src/lib/reflow.server.ts`:
- `ReflowDeps` doplň o `cascadeConfirmed?: boolean;` (s komentářem, že se předává dál do chain pushe).
- Volání v `reflowBlockInTx` (~ř. 159):
  ```ts
  const moves = await deps.resolveChainPush(
    tx, block.machine, { id: blockId, startTime: newStart, endTime: newEnd },
    new Set<number>(), new Set<number>(),
    { cascadeConfirmed: deps.cascadeConfirmed === true, path: "reflow-block" },
  );
  ```
- `reflowMachineInTx` doplň parametr `cascadeConfirmed: boolean` (za `now`) a předej ho do `deps.reflowBlock(..., { resolveChainPush: resolveChainPushFromDb, preloadedCalendar, cascadeConfirmed })`. Zároveň za smyčkou zkontroluj SOUČET:
  ```ts
  // Součet přes celý běh: každý blok si chain push kontroluje sám, ale hromadný
  // přepočet jich spustí desítky — a uživatele zajímá dopad CELÉHO tlačítka.
  assertCascadeConfirmed(measureCascade(allMoves), {
    confirmed: cascadeConfirmed, path: "reflow-machine",
  });
  ```
  kde `allMoves` je pole, do kterého se ve smyčce pushuje `...outcome.moves`. Kontrola musí být PŘED `return`, uvnitř téže transakce — jinak by se posun zapsal.

- [ ] **Step 5: Napiš `src/lib/cascadeResponse.ts`**

```ts
import type { AppError } from "@/lib/errors";

/**
 * Jednotné tělo 409 odpovědi při překročení prahu kaskády.
 *
 * Vlastní modul má stejný důvod jako `errorStatus`: šest routes by jinak mělo
 * šest mírně odlišných kopií a klient by musel počítat s každou z nich.
 * `err.details` plní `assertCascadeConfirmed` (`cascadeLimit.server.ts`).
 */
export function cascadeConfirmBody(err: AppError): {
  error: string;
  code: "CASCADE_CONFIRM";
  cascade: { movedCount: number; maxShiftMs: number; farthestEnd: string | null };
} {
  const d = (err.details ?? {}) as Partial<{ movedCount: number; maxShiftMs: number; farthestEnd: string | null }>;
  return {
    error: err.message,
    code: "CASCADE_CONFIRM",
    cascade: {
      movedCount: typeof d.movedCount === "number" ? d.movedCount : 0,
      maxShiftMs: typeof d.maxShiftMs === "number" ? d.maxShiftMs : 0,
      farthestEnd: typeof d.farthestEnd === "string" ? d.farthestEnd : null,
    },
  };
}
```

- [ ] **Step 6: Zapoj do šesti routes**

V KAŽDÉ z nich (`blocks/route.ts`, `blocks/[id]/route.ts`, `blocks/batch/route.ts`, `blocks/[id]/split/route.ts`, `blocks/reflow/route.ts`, `blocks/[id]/reflow/route.ts`):

**(a)** Přečti příznak z těla, hned vedle stávajícího `resolveChain`:
```ts
const cascadeConfirmed = body?.cascadeConfirmed === true;
```
U `blocks/[id]/reflow/route.ts` dnes tělo vůbec nečte — doplň:
```ts
  const body = (await _request.json().catch(() => null)) as { cascadeConfirmed?: boolean } | null;
  const cascadeConfirmed = body?.cascadeConfirmed === true;
```
a parametr přejmenuj z `_request` na `request`.

**(b)** Předej do chain pushe:
- `blocks/route.ts` (~ř. 397): 6. argument `{ cascadeConfirmed, path: "POST /api/blocks" }`, 4. a 5. nech `new Set<number>()`.
- `blocks/[id]/route.ts` (~ř. 602): totéž s `path: "PUT /api/blocks/[id]"`.
- `blocks/[id]/split/route.ts` (~ř. 178): totéž s `path: "split"`.
- `blocks/batch/route.ts` (~ř. 198): u volání ve smyčce předej `{ cascadeConfirmed, path: "batch" }` jako 6. argument (5. zůstává `movedIds`). **Navíc** za smyčkou, PŘED zápisem auditu:
  ```ts
  // Součet přes celou dávku — jednotlivé kotvy můžou být každá pod prahem,
  // ale uživatel provedl JEDNO gesto a zajímá ho jeho celkový dopad.
  assertCascadeConfirmed(measureCascade(shiftedMoves), { confirmed: cascadeConfirmed, path: "batch-total" });
  ```
- `blocks/reflow/route.ts`: předej `cascadeConfirmed` do `reflowMachineInTx(tx, machine, actor, new Date(), cascadeConfirmed)`.
- `blocks/[id]/reflow/route.ts`: předej do `reflowBlockInTx(tx, id, actor, { resolveChainPush: resolveChainPushFromDb, cascadeConfirmed })` — import `resolveChainPushFromDb` doplň.

**(c)** V catch bloku KAŽDÉ routy přidej větev PŘED obecnou `isAppError` větev:
```ts
    if (isAppError(error) && error.code === "CASCADE_CONFIRM") {
      return NextResponse.json(cascadeConfirmBody(error), { status: errorStatus(error.code) });
    }
```
U `blocks/reflow/route.ts` pozor: jeho `isAppError` větev balí hlášku do `Přepočet zastaven: ${...}` — nová větev musí být NAD ní, jinak by klient dostal zabalený text a dialog by četl nesmysl.

- [ ] **Step 7: Ověř typy a celou suite**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Očekávané: zelená. Pokud `revisionWiring.test.ts` spadne, je to signál, že se změnila signatura sledované cesty — oprav volání, ne test.

- [ ] **Step 8: Commit**

```bash
git add src/lib/overlapResolver.server.ts src/lib/overlapResolver.server.test.ts src/lib/reflow.server.ts \
  src/lib/cascadeResponse.ts src/app/api/blocks/route.ts src/app/api/blocks/\[id\]/route.ts \
  src/app/api/blocks/batch/route.ts src/app/api/blocks/\[id\]/split/route.ts \
  src/app/api/blocks/reflow/route.ts src/app/api/blocks/\[id\]/reflow/route.ts
git commit -m "feat(cascade): prah autoposunu na vsech peti zapisovych cestach (rezim mereni)"
```

---

## Task B3: Klient se na velkou kaskádu zeptá a požadavek zopakuje

**Files:**
- Create: `src/lib/cascadeConfirmClient.ts`
- Create: `src/lib/cascadeConfirmClient.test.ts`
- Modify: `src/app/_components/PlannerPage.tsx` (stav dialogu + `ConfirmDialog` + zapojení do volání)
- Modify: `src/app/_components/TimelineGrid.tsx` (drag a resize přes helper)

**Interfaces:**
- Consumes: tvar 409 z `cascadeConfirmBody` (Task B2).
- Produces:
  ```ts
  export type CascadePayload = { movedCount: number; maxShiftMs: number; farthestEnd: string | null };
  export type CascadeAsk = (p: CascadePayload) => Promise<boolean>;
  export async function fetchWithCascadeConfirm(
    url: string,
    method: "POST" | "PUT",
    body: Record<string, unknown>,
    ask: CascadeAsk,
  ): Promise<Response>
  ```

- [ ] **Step 1: Napiš padající test**

Vytvoř `src/lib/cascadeConfirmClient.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchWithCascadeConfirm } from "./cascadeConfirmClient";

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as unknown as Response;
  };
  return { fn, calls };
}

test("bez kaskády se posílá jeden požadavek", async () => {
  const { fn, calls } = fakeFetch([{ status: 200, body: { id: 1 } }]);
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", { startTime: "x" }, async () => true, fn);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal((calls[0]!.body as Record<string, unknown>).cascadeConfirmed, undefined);
});

test("409 CASCADE_CONFIRM + potvrzení pošle požadavek znovu s příznakem", async () => {
  const { fn, calls } = fakeFetch([
    { status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 20, maxShiftMs: 1, farthestEnd: null } } },
    { status: 200, body: { id: 1 } },
  ]);
  let asked: unknown = null;
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", { startTime: "x" }, async (p) => { asked = p; return true; }, fn);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal((calls[1]!.body as Record<string, unknown>).cascadeConfirmed, true);
  assert.deepEqual(asked, { movedCount: 20, maxShiftMs: 1, farthestEnd: null });
});

test("odmítnutí vrátí PŮVODNÍ 409 — volající si chybu ošetří sám", async () => {
  const { fn, calls } = fakeFetch([
    { status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 20, maxShiftMs: 1, farthestEnd: null } } },
  ]);
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => false, fn);
  assert.equal(res.status, 409);
  assert.equal(calls.length, 1);
});

test("jiná 409 (OVERLAP) se NEptá a propustí se rovnou", async () => {
  const { fn, calls } = fakeFetch([{ status: 409, body: { code: "OVERLAP", error: "…" } }]);
  let askedTimes = 0;
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => { askedTimes++; return true; }, fn);
  assert.equal(res.status, 409);
  assert.equal(askedTimes, 0);
  assert.equal(calls.length, 1);
});

test("po potvrzení se NEptá podruhé, i kdyby server 409 zopakoval", async () => {
  const body = { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 9, maxShiftMs: 1, farthestEnd: null } };
  const { fn, calls } = fakeFetch([{ status: 409, body }, { status: 409, body }]);
  let askedTimes = 0;
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => { askedTimes++; return true; }, fn);
  assert.equal(askedTimes, 1);
  assert.equal(calls.length, 2);
  assert.equal(res.status, 409);
});
```

- [ ] **Step 2: Spusť a ověř, že padá**

```bash
node --test --import tsx src/lib/cascadeConfirmClient.test.ts
```
Očekávané: FAIL — `Cannot find module './cascadeConfirmClient'`.

- [ ] **Step 3: Napiš implementaci**

```ts
export type CascadePayload = {
  movedCount: number;
  maxShiftMs: number;
  farthestEnd: string | null;
};

export type CascadeAsk = (p: CascadePayload) => Promise<boolean>;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Odešle mutaci a při 409 `CASCADE_CONFIRM` se zeptá uživatele; po potvrzení
 * požadavek ZOPAKUJE s `cascadeConfirmed: true`.
 *
 * Pokus je nejvýš JEDEN opakovaný — kdyby server 409 vrátil znovu (jiný práh,
 * souběžná změna), vrátí se ta odpověď volajícímu a dialog se už neotevře.
 * Nekonečné odklepávání by bylo horší než chyba.
 *
 * Při odmítnutí se vrací PŮVODNÍ odpověď 409, aby si volající pustil svou
 * dosavadní chybovou větev (dnes: toast a žádná změna stavu — obě dragové
 * cesty v `TimelineGrid.tsx` při `!res.ok` do stavu nezapisují).
 *
 * `fetchImpl` existuje jen kvůli testům; v aplikaci se nepředává.
 */
export async function fetchWithCascadeConfirm(
  url: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
  ask: CascadeAsk,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const send = (b: Record<string, unknown>) =>
    fetchImpl(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });

  const res = await send(body);
  if (res.status !== 409) return res;

  const data = (await res.clone().json().catch(() => ({}))) as {
    code?: string;
    cascade?: CascadePayload;
  };
  if (data.code !== "CASCADE_CONFIRM" || !data.cascade) return res;

  const confirmed = await ask(data.cascade);
  if (!confirmed) return res;

  return send({ ...body, cascadeConfirmed: true });
}
```

**Pozn.:** `res.clone()` je nutné — bez něj se tělo přečte a volající by na už vyčerpaném streamu dostal prázdno.

- [ ] **Step 4: Spusť test a ověř, že prochází**

```bash
node --test --import tsx src/lib/cascadeConfirmClient.test.ts
```
Očekávané: PASS (5 testů). Fake `Response` v testu `clone()` nemá — doplň ho do fake objektu jako `clone: () => ({ json: async () => r.body })`.

- [ ] **Step 5: Postav dialog v `PlannerPage.tsx`**

Nový komponent NEVZNIKÁ — použije se sdílený `ConfirmDialog`. Přidej stav a promise-resolver:

```ts
  const [cascadeAsk, setCascadeAsk] = useState<{ payload: CascadePayload; resolve: (ok: boolean) => void } | null>(null);

  /**
   * Otevře potvrzení velké kaskády a počká na odpověď. Fokus je na „Zrušit"
   * (`autoFocusConfirm={false}`) — stejné rozhodnutí jako u dialogu zkrácení
   * směn: potvrzovací tlačítko u destruktivní akce nesmí být pod Enterem.
   */
  const askCascade = useCallback(
    (payload: CascadePayload) => new Promise<boolean>((resolve) => setCascadeAsk({ payload, resolve })),
    [],
  );
```

A do JSX (k ostatním dialogům na konci komponenty):

```tsx
      <ConfirmDialog
        open={cascadeAsk !== null}
        title="Velký autoposun"
        message={cascadeAsk ? cascadeConfirmMessage({
          movedCount: cascadeAsk.payload.movedCount,
          maxShiftMs: cascadeAsk.payload.maxShiftMs,
          farthestEnd: cascadeAsk.payload.farthestEnd ? new Date(cascadeAsk.payload.farthestEnd) : null,
          exceeded: true,
        }) : ""}
        confirmLabel="Posunout i přesto"
        cancelLabel="Zrušit"
        danger
        autoFocusConfirm={false}
        onConfirm={() => { cascadeAsk?.resolve(true); setCascadeAsk(null); }}
        onCancel={() => { cascadeAsk?.resolve(false); setCascadeAsk(null); }}
      />
```

Importy: `ConfirmDialog` z `@/components/ConfirmDialog`, `cascadeConfirmMessage` z `@/lib/cascadeLimit`, `fetchWithCascadeConfirm` a typ `CascadePayload` z `@/lib/cascadeConfirmClient`.

- [ ] **Step 6: Převeď volání na helper**

Osm míst posílá `resolveChain: true`. Převeď je na `fetchWithCascadeConfirm(url, method, body, askCascade)`:

| Soubor | Řádek (dnes) | Co to je |
| --- | --- | --- |
| `PlannerPage.tsx` | ~1350 | jednoblokový PUT |
| `PlannerPage.tsx` | ~1503 | batch (lasso) |
| `PlannerPage.tsx` | ~1917 | uložení z BlockEdit |
| `PlannerPage.tsx` | ~2236 | umístění z fronty |
| `PlannerPage.tsx` | ~2286 | vložení bloku (paste) |
| `PlannerPage.tsx` | ~2396 | vložení skupiny |
| `TimelineGrid.tsx` | ~1082 | drag |
| `TimelineGrid.tsx` | ~1102 | resize |

`TimelineGrid.tsx` dostane callback stejnou cestou jako dnešní `onError`/`onInfo`: do `callbacksRef` přibude `onCascadeConfirm: CascadeAsk` a `PlannerPage` do něj předá `askCascade`. **Nepřidávej fallback typu `?? (async () => true)`** — tiché potvrzení bez zeptání je přesně ta vada, kterou celá vlna řeší; když callback chybí, ať `tsc` spadne.

Reflow handlery (`handleReflowMachine`, `handleReflowBlock`) převeď taky — `/api/blocks/[id]/reflow` volej s tělem `{}`.

- [ ] **Step 7: Ověř typy, lint, suite**

```bash
npx tsc --noEmit
npx eslint src/app/_components/PlannerPage.tsx src/app/_components/TimelineGrid.tsx
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

- [ ] **Step 8: Ruční proklik (dev)**

V režimu měření dialog **nevyskočí** (server 409 nevrací). Otestuj ho tak, že si dočasně přepneš `CASCADE_CONFIRM_ENFORCED` na `true`, proklikáš, a **vrátíš zpět na `false`** ještě před commitem:

- [ ] Přesun, který odsune 6+ bloků → dialog s počtem i datem
- [ ] „Zrušit" → blok **zůstane na původním místě**, v DB se nic nezměnilo
- [ ] „Posunout i přesto" → posun proběhne a **Ctrl+Z ho vrátí** (etapa C)
- [ ] **Escape** dialog zavře stejně jako „Zrušit"
- [ ] Fokus po otevření je na „Zrušit", ne na červeném tlačítku
- [ ] Přepočet stroje nad prahem → dialog jednou, ne pro každý blok zvlášť
- [ ] `git diff src/lib/cascadeLimit.ts` je **prázdný** (příznak vrácen na `false`)

- [ ] **Step 9: Commit**

```bash
git add src/lib/cascadeConfirmClient.ts src/lib/cascadeConfirmClient.test.ts \
  src/app/_components/PlannerPage.tsx src/app/_components/TimelineGrid.tsx
git commit -m "feat(cascade): potvrzeni velkeho autoposunu a zopakovani pozadavku"
```

---

**⛔ KONEC 2. NASAZENÍ (etapa B, režim měření). Zastav se a počkej na OK.**
Po nasazení nech běžet **týden** a pak vytáhni z logu, jak často by se aplikace ptala:
```bash
grep -c "\[cascade\] práh překročen" ~/.pm2/logs/planovani-out.log
grep "\[cascade\] práh překročen" ~/.pm2/logs/planovani-out.log | tail -30
```

---

## Task B4: Přepnutí do vynucení (až po týdnu měření)

**Files:**
- Modify: `src/lib/cascadeLimit.ts` (jediná konstanta)
- Modify: `src/lib/cascadeLimit.test.ts` (obrácené tvrzení)

- [ ] **Step 1: Vyhodnoť log**

Vezmi počet překročení za týden a rozděl ho podle `path`. Když se aplikace ptala víc než ~5× denně, **práh je nízko** — zvyš `CASCADE_CONFIRM_MAX_BLOCKS` a přepnutí odlož; jinak by se dialog odklikával naslepo a přestal by cokoliv znamenat.

**Práh počítej jen z `path` hodnot, které odpovídají JEDNOMU gestu uživatele:**
`POST /api/blocks` · `PUT /api/blocks/[id]` · `split` · `batch-total` · `reflow-machine` · `reflow-block`

**Oprava proti dřívější verzi tohoto kroku (pre-deploy review, 19. 8. 2026): `reflow-block` patří DO počítané množiny, nevynechává se.** Právě „Přepočítat" na jednom bloku je cesta s **největším doloženým dopadem ve specu** (§1: přepočet jednoho bloku odsunul 20 navazujících) — vynechat ji by znamenalo neměřit přesně ten případ, který vlnu vyvolal. Po opravě `skipCascadeCheck` (review nálezu #2, `reflowMachineInTx` posílá `skipCascadeCheck: true`) se `reflow-block` v hromadném přepočtu stroje už NELOGUJE vůbec — v logu se tak objevuje výhradně u SKUTEČNÉHO jednoblokového gesta (jednoblokový endpoint `/api/blocks/[id]/reflow` `skipCascadeCheck` neposílá), takže ho lze bezpečně počítat spolu s ostatními.

Vynechává se jen `batch`: per-kotva mezikrok uvnitř jedné dávky (`skipCascadeCheck: true`, kontrolu za celé gesto dělá až `batch-total`) — dnes je to navíc MRTVÁ hodnota (posílá se vždy se `skipCascadeCheck: true`, takže `assertCascadeConfirmed` se pro `path: "batch"` nikdy nevykoná a do logu se nedostane); počítat ho zvlášť by dávku i tak vynásobil počtem kotev.

**Dvě vědomá zúžení, ať si je nikdo nevyloží špatně:**
- Souhrn `reflow-machine` počítá **jen chain-pushnuté následníky**, ne bloky, které přepočet posunul SÁM. Hromadný přepočet, který 40 vlastních bloků odsune o dny a nikoho nepostrčí, ohlásí `movedCount: 0`. Ten druhý počet (kolik vlastních bloků se posunulo) pokrývá pre-existující `window.confirm` v `TimelineGrid.tsx` — B4 z `reflow-machine` logu nevyčte celý obraz hromadného přepočtu, jen jeho kaskádový chvost.
- `assertCascadeConfirmed` s `confirmed: true` (uživatel kaskádu už potvrdil přes dialog) **nezaloguje nic** — loguje se jen větev překročení BEZ potvrzení. Z dnešního logu tedy nejde poznat, kolik potvrzených kaskád proběhlo, jen kolik by se JICH PTALO poprvé. Pokud by B4 potřebovalo i tohle číslo (např. pro odhad, jak často by vynucení skutečně zablokovalo transakci na DRUHÉM pokusu), musí si o tu metriku říct zvlášť — dnešní log ji nenese.

- [ ] **Step 1b: Hotovo PŘED zapnutím vynucení (recenze 19. 8. 2026 — ať to nezapadne)**

Tohle nejsou volitelná vylepšení — bez nich vynucení buď potichu neplatí pro nejrizikovější gesta, nebo zhorší UX natolik, že si o odchod žádá:

1. **Strážný test na párování `skipCascadeCheck` ↔ souhrn.** Dnes nic nehlídá, že každé místo, které volá `resolveChainPushFromDb`/`reflowBlockInTx` se `skipCascadeCheck: true`, má PÁROVÉ souhrnné `assertCascadeConfirmed` volání nad celým gestem. Kdyby při refaktoru souhrnné volání (`batch-total` nebo `reflow-machine`) vypadlo, dvě nejrizikovější gesta (hromadný přesun, hromadný přepočet stroje) by tiše ztratila práh úplně — žádná per-volání kontrola by je nezachytila, protože ta je schválně vypnutá.
2. **Once-per-gesture wrapper na `putFlip`** (`PlannerPage.tsx` cca ř. 1372), **`handleSaveAll`** (cca ř. 1938) **a smyčku výskytů série z fronty** (cca ř. 2339). Dnes se každé z nich ptá PER ITERACI — série o 12 výskytech, z nichž víc než jeden překročí práh, vyrobí až 12 po sobě jdoucích dialogů. Vzor už existuje (`askCascadeOnceForGroup`, `PlannerPage.tsx` ř. 2592, použitý pro group paste) — tři zbylá volající místa ho jen nepoužívají.
3. **Odmítnutou kaskádu neposílat do toastu jako chybu.** Dnes po kliknutí „Zrušit" v kaskádovém dialogu `fetchWithCascadeConfirm` vrátí PŮVODNÍ 409 odpověď volajícímu, který ji zpracuje svou běžnou chybovou větví — tou je dnes červený toast s hláškou serveru („Tato změna odsune N navazujících bloků. Potvrdit?"). Uživatel dostane chybu, která se ho ptá na otázku, na kterou už jednou odpověděl Zrušit.
4. **Fokus v kaskádovém dialogu.** `autoFocusConfirm={false}` (`ConfirmDialog.tsx` ř. 88, `autoFocus={autoFocusConfirm}` jen na potvrzovacím tlačítku) fokus na „Zrušit" NEPŘESOUVÁ — žádný prvek v dialogu nemá explicitní `autoFocus`, takže dialog nemá klávesovou cestu vůbec (Enter nedělá nic, dokud uživatel neklikne myší nebo netabuje ručně). Komentář u `askCascade` (`PlannerPage.tsx` cca ř. 1276–1279, „Fokus je na „Zrušit" (`autoFocusConfirm={false}`)…") dnes tvrdí opak skutečnosti. Před zapnutím vynucení buď fokus na „Zrušit" doplnit (`ConfirmDialog.tsx` — `autoFocus` na cancel tlačítku, když `autoFocusConfirm` je `false`), nebo aspoň opravit komentář, ať neuvádí do omylu příště čtoucího. V režimu MĚŘENÍ je to kosmetická nepřesnost (dialog se dnes ani neukazuje — `CASCADE_CONFIRM_ENFORCED` je `false`); po zapnutí vynucení je to skutečná UX díra u destruktivní akce.

- [ ] **Step 2: Přepni konstantu**

```ts
export const CASCADE_CONFIRM_ENFORCED = true;
```

- [ ] **Step 3: Obrať test**

V `src/lib/cascadeLimit.test.ts` nahraď test „vlna se nasazuje v režimu MĚŘENÍ":

```ts
test("práh je VYNUCOVANÝ — od <datum přepnutí>", () => {
  assert.equal(CASCADE_CONFIRM_ENFORCED, true);
  assert.equal(CASCADE_CONFIRM_MAX_BLOCKS, 5);
});
```
A v `overlapResolver.server.test.ts` obrať test „chain push nad prahem se v režimu MĚŘENÍ nezastaví" na `assert.rejects(..., /CASCADE_CONFIRM|odsune/)`.

- [ ] **Step 4: Suite a commit**

```bash
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add src/lib/cascadeLimit.ts src/lib/cascadeLimit.test.ts src/lib/overlapResolver.server.test.ts
git commit -m "feat(cascade): zapnuti vynuceni prahu po tydnu mereni"
```

---

---

# ETAPA 6 — dokončení autoposunové vlny (rozhodnutí V4)

Vojta 19. 8.: **obojí** — dotáhnout potvrzovací dialog A postavit vypínač autoposunu. Obě pojistky
se doplňují: vypínač je tvrdý (chain push se vůbec nespustí), dialog je měkký (spustí se, ale zeptá se).

**`CASCADE_CONFIRM_ENFORCED` se v téhle etapě NEZAPÍNÁ.** Zapnutí je samostatný commit až po
rozhodnutí o prahu — Lukáš navrhuje 3–4, dnešní default je 5. Postup zapnutí je popsaný v Tasku B4
(Step 2–4) a tahle etapa plní jeho Step 1b, tedy podmínky, které musí být hotové PŘED zapnutím.

**Kontext z jiných etap, se kterým je nutné počítat:**
- Etapa 9 rozšířila `detectCalendarDrift` o REZERVACE s `printMinutes` a kaskádové texty jsou
  přeformulované obecně („bloky", ne „zakázky", commit `e2426b4c`). Měření i potvrzení teď potkají
  i rezervace — testy to musí odrážet.
- `usesTiskoveHodiny` (`src/lib/blockGeometry.ts` nebo kde žije) je jediný zdroj pravdy o tom,
  které typy jedou na tiskových hodinách. Nový kód se ho drží, neduplikuje podmínku na typ.

---

## Task 6A: Dialog se ptá JEDNOU za gesto (tři zbylá volající místa)

Vzor `askCascadeOnceForGroup` už v `PlannerPage.tsx` existuje (group paste) a `askCascadeOnceForSeries`
v `BlockEdit.tsx` (termíny série). Tři místa ho nepoužívají a ptají se per iterace.

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` — `putFlip` (překlopení rezervace, smyčka přes
  sourozence), `handleSaveAll` (smyčka přes id), smyčka výskytů série z fronty
- Modify: `src/lib/cascadeConfirmClient.test.ts`

**Interfaces:**
- Consumes: `fetchWithCascadeConfirm`, `CascadeAsk` (`src/lib/cascadeConfirmClient.ts`), `askCascade`
- Produces: nic nového ven — jen lokální closury u volajících

- [ ] **Step 1: Vytáhni „zeptej se jednou" do sdílené funkce**

Tři kopie téže closury (group paste, série v BlockEditu, a nově tři další) jsou už čtyři až šest —
to je moment, kdy se to má vytáhnout. Do `src/lib/cascadeConfirmClient.ts` přidej:

```ts
/**
 * Obalí dotaz tak, aby se za JEDNO uživatelské gesto zeptal nejvýš JEDNOU.
 *
 * Gesto, které vyrobí N requestů (překlopení rezervace přes sourozence, hromadné
 * uložení, série výskytů, vložení skupiny), by se jinak zeptalo až N×. Plánovač by
 * odklikával tentýž dialog dokola a přestal by ho číst — přesně to riziko, kvůli
 * kterému spec §7 chtěl týden měření před vynucením.
 *
 * Vrací NOVOU funkci se soukromou pamětí; každé gesto si musí vyrobit vlastní.
 */
export function askOncePerGesture(ask: CascadeAsk): CascadeAsk {
  let confirmed = false;
  return async (p) => {
    if (confirmed) return true;
    const ok = await ask(p);
    if (ok) confirmed = true;
    return ok;
  };
}
```

- [ ] **Step 2: Napiš padající test**

Do `src/lib/cascadeConfirmClient.test.ts`:

```ts
test("askOncePerGesture: druhý a další požadavek se už neptá", async () => {
  let asked = 0;
  const once = askOncePerGesture(async () => { asked++; return true; });
  assert.equal(await once({ movedCount: 6, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(await once({ movedCount: 9, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(await once({ movedCount: 3, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(asked, 1, "za jedno gesto se ptáme nejvýš jednou");
});

test("askOncePerGesture: po ZAMÍTNUTÍ se ptá znovu (paměť si drží jen souhlas)", async () => {
  // Zamítnutí není rozhodnutí o celém gestu — uživatel odmítl JEDEN posun. Kdyby si
  // wrapper pamatoval i „ne", tiše by zamítl i zbytek dávky bez zeptání.
  let asked = 0;
  const once = askOncePerGesture(async () => { asked++; return asked > 1; });
  assert.equal(await once({ movedCount: 6, maxShiftMs: 1, farthestEnd: null }), false);
  assert.equal(await once({ movedCount: 6, maxShiftMs: 1, farthestEnd: null }), true);
  assert.equal(asked, 2);
});

test("askOncePerGesture: každé gesto má vlastní paměť", async () => {
  let asked = 0;
  const ask: CascadeAsk = async () => { asked++; return true; };
  await askOncePerGesture(ask)({ movedCount: 6, maxShiftMs: 1, farthestEnd: null });
  await askOncePerGesture(ask)({ movedCount: 6, maxShiftMs: 1, farthestEnd: null });
  assert.equal(asked, 2, "druhé gesto se musí zeptat znovu");
});
```

- [ ] **Step 3: Ověř, že padá, pak implementuj a ověř, že prochází**

```bash
node --test --import tsx src/lib/cascadeConfirmClient.test.ts
```

- [ ] **Step 4: Zapoj na třech místech a sjednoť dvě stávající**

V `PlannerPage.tsx` u `putFlip`, `handleSaveAll` a smyčky výskytů série z fronty vyrob NAD smyčkou
`const askOnce = askOncePerGesture(askCascade);` a předej `askOnce` do všech volání uvnitř té smyčky.

**Zároveň nahraď obě ruční kopie** — `askCascadeOnceForGroup` v `PlannerPage.tsx` a
`askCascadeOnceForSeries` v `BlockEdit.tsx` — voláním `askOncePerGesture`. Šest kopií téhož pravidla
je přesně ta třída vady, kterou tenhle repozitář opakovaně řešil.

- [ ] **Step 5: Kontroly a commit**

```bash
npx tsc --noEmit && npx eslint src/app/_components/PlannerPage.tsx src/components/BlockEdit.tsx
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git commit -m "feat(cascade): dialog se pta jednou za gesto - sdilene askOncePerGesture"
```

---

## Task 6B: Fokus na „Zrušit" a odmítnutá kaskáda není chyba

**Files:**
- Modify: `src/components/ConfirmDialog.tsx`
- Modify: `src/app/_components/PlannerPage.tsx` (komentář u `askCascade`, zpracování zamítnutí)
- Modify: `src/lib/cascadeConfirmClient.ts` (rozlišit zamítnutí od chyby)
- Modify: `src/lib/cascadeConfirmClient.test.ts`

- [ ] **Step 1: Fokus**

`ConfirmDialog.tsx` má dnes `autoFocus={autoFocusConfirm}` jen na potvrzovacím tlačítku, takže při
`autoFocusConfirm={false}` **nemá dialog klávesovou cestu vůbec** — Enter nedělá nic. Dej
`autoFocus={!autoFocusConfirm}` na tlačítko „Zrušit". U destruktivní akce má být pod Enterem
bezpečná volba, ne ta nebezpečná.

Zároveň oprav komentář u `askCascade` v `PlannerPage.tsx`, který dnes tvrdí, že fokus na „Zrušit"
je — teprve teď to bude pravda.

- [ ] **Step 2: Zamítnutí není chyba**

Dnes `fetchWithCascadeConfirm` po kliknutí „Zrušit" vrátí PŮVODNÍ 409 a volající ji zpracuje svou
chybovou větví → červený toast s otázkou „…Potvrdit?", na kterou uživatel právě odpověděl Zrušit.

Rozšiř návratovou hodnotu tak, aby zamítnutí šlo poznat, aniž by se rozbila stávající volající
místa (dnes všechna čtou `Response`):

```ts
/**
 * Uživatel kaskádu ZAMÍTL — na odpovědi visí tenhle příznak, aby ji volající
 * nezpracoval jako chybu. Zamítnutí není selhání: nic se nestalo, protože to tak
 * uživatel chtěl. Červený toast s otázkou, na kterou právě odpověděl „Zrušit",
 * je matoucí a vypadá jako pád.
 */
export const CASCADE_DECLINED = Symbol.for("ig.cascadeDeclined");
export function isCascadeDeclined(res: Response): boolean {
  return (res as Response & { [CASCADE_DECLINED]?: boolean })[CASCADE_DECLINED] === true;
}
```
`fetchWithCascadeConfirm` při zamítnutí příznak na vracenou `Response` nastaví.

Na volajících místech, která dnes ukazují chybu z `data.error`, přidej před ni:
```ts
if (isCascadeDeclined(res)) return;   // uživatel kaskádu zamítl — nic se nestalo, mlčíme
```

**Tohle se musí projít u VŠECH volajících `fetchWithCascadeConfirm`.** Najdeš je
`grep -rn "fetchWithCascadeConfirm" src/`. Mělo by jich být 15 (12 s příznakem + 3 bez).

- [ ] **Step 3: Testy**

```ts
test("zamítnutí označí odpověď příznakem, ať ji volající nehlásí jako chybu", async () => {
  const { fn } = fakeFetch([{ status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 9, maxShiftMs: 1, farthestEnd: null } } }]);
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => false, fn);
  assert.equal(res.status, 409);
  assert.equal(isCascadeDeclined(res), true);
});

test("obyčejná chyba příznak zamítnutí NEMÁ", async () => {
  const { fn } = fakeFetch([{ status: 409, body: { code: "OVERLAP", error: "koliduje" } }]);
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => true, fn);
  assert.equal(isCascadeDeclined(res), false);
});

test("úspěch po potvrzení příznak zamítnutí NEMÁ", async () => {
  const { fn } = fakeFetch([
    { status: 409, body: { code: "CASCADE_CONFIRM", error: "…", cascade: { movedCount: 9, maxShiftMs: 1, farthestEnd: null } } },
    { status: 200, body: { id: 1 } },
  ]);
  const res = await fetchWithCascadeConfirm("/api/blocks/1", "PUT", {}, async () => true, fn);
  assert.equal(res.status, 200);
  assert.equal(isCascadeDeclined(res), false);
});
```

- [ ] **Step 4: Kontroly a commit**

```bash
npx tsc --noEmit && node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git commit -m "feat(cascade): fokus na Zrusit a zamitnuta kaskada neni chyba"
```

---

## Task 6C: Strážný test párování `skipCascadeCheck` ↔ souhrnné volání

Dnes nic nehlídá, že každé místo, které vypne per-volání kontrolu, má párové souhrnné
`assertCascadeConfirmed` nad celým gestem. Kdyby souhrn při refaktoru vypadl, dvě nejrizikovější
gesta (hromadný přesun lasem, hromadný přepočet stroje) by práh ztratila **úplně a tiše** — per-volání
kontrola je tam schválně vypnutá.

**Files:**
- Create: `src/lib/cascadeWiring.test.ts`

Vzor je `src/lib/revisionWiring.test.ts`, který prochází zdrojáky regulárem.

- [ ] **Step 1: Napiš strážný test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Párování `skipCascadeCheck` ↔ souhrnné `assertCascadeConfirmed`.
 *
 * `skipCascadeCheck: true` vypíná kontrolu prahu UVNITŘ `resolveChainPushFromDb`, protože
 * u gesta s několika chain-push voláními by první volání vyhodilo výjimku s číslem jen
 * ze sebe — uživatel by odklepl menší dopad, než jaký se provede. Autoritativní je souhrn
 * za celé gesto. Kdyby ten souhrn vypadl, práh by u toho gesta neplatil VŮBEC a nic by
 * nespadlo: per-volání kontrola je vypnutá, takže by mlčel i běžný provoz.
 */
const SOUBORY = [
  { path: "src/app/api/blocks/batch/route.ts", souhrn: 'path: "batch-total"' },
  { path: "src/lib/reflow.server.ts", souhrn: 'path: "reflow-machine"' },
];

for (const s of SOUBORY) {
  test(`${s.path}: skipCascadeCheck má párové souhrnné assertCascadeConfirmed`, () => {
    const src = readFileSync(s.path, "utf8");
    assert.ok(src.includes("skipCascadeCheck: true"),
      `${s.path} už neposílá skipCascadeCheck — jestli to je záměr, uprav i tenhle test`);
    assert.ok(src.includes("assertCascadeConfirmed"),
      `${s.path} vypíná per-volání kontrolu, ale nevolá souhrnné assertCascadeConfirmed — práh tam NEPLATÍ`);
    assert.ok(src.includes(s.souhrn),
      `${s.path} nevolá souhrn s ${s.souhrn} — bez něj nejde v logu poznat, že gesto práh překročilo`);
  });
}

test("žádný DALŠÍ soubor neposílá skipCascadeCheck bez souhrnu", () => {
  // Nový volající se skipCascadeCheck musí do seznamu výš přibýt VĚDOMĚ, i s párovým souhrnem.
  const kandidati = [
    "src/app/api/blocks/route.ts",
    "src/app/api/blocks/[id]/route.ts",
    "src/app/api/blocks/[id]/split/route.ts",
    "src/app/api/blocks/[id]/reflow/route.ts",
    "src/app/api/blocks/reflow/route.ts",
  ];
  for (const p of kandidati) {
    const src = readFileSync(p, "utf8");
    assert.ok(!src.includes("skipCascadeCheck"),
      `${p} nově posílá skipCascadeCheck — přidej ho do SOUBORY i s párovým souhrnem, jinak tam práh tiše neplatí`);
  }
});
```

- [ ] **Step 2: Ověř, že test skutečně hlídá**

Dočasně zakomentuj souhrnné `assertCascadeConfirmed` v `reflow.server.ts`, spusť test, ověř že
**spadne**, a vrať zpět. Bez tohohle ověření je strážný test jen dekorace. V reportu to popiš.

- [ ] **Step 3: Kontroly a commit**

```bash
node --test --import tsx src/lib/cascadeWiring.test.ts
git commit -m "feat(cascade): strazny test parovani skipCascadeCheck se souhrnem"
```

---

## Task 6D: Vypínač autoposunu

Tvrdá pojistka vedle měkkého dialogu. Vypnuto ⇒ chain push se vůbec nespustí a kolize skončí 409
s hláškou, která říká proč.

**Files:**
- Create: `src/lib/autoShiftOff.ts` (hláška — jediný zdroj pravdy)
- Modify: `src/app/_components/PlannerPage.tsx` (přepínač v hlavičce, preference, `resolveChain`
  na všech klientských cestách)
- Modify: `src/app/_components/TimelineGrid.tsx` (drag, resize, split — příznak dolů)
- Modify: `src/components/BlockEdit.tsx` (uložení, série)
- Modify: `src/app/api/blocks/[id]/split/route.ts` (respektovat `resolveChain`)
- Modify: šest routes (hláška při vypnutém autoposunu)
- Create: `src/lib/autoShiftWiring.test.ts` (strážný test na všech 6 cest)

**Interfaces:**
```ts
// src/lib/autoShiftOff.ts
export const AUTOSHIFT_OFF_OVERLAP_MESSAGE =
  "Posun koliduje s navazující zakázkou — autoposun je vypnutý, uvolni místo ručně.";
/** Request výslovně vypnul autoposun (`resolveChain: false`), ne jen neposlal příznak. */
export function autoShiftExplicitlyOff(body: unknown): boolean;
/** Hláška pro OVERLAP: při vypnutém autoposunu vysvětlí PROČ se to neposunulo samo. */
export function overlapMessageFor(originalMessage: string, autoShiftOff: boolean): string;
```

**Čtyři věci, na kterých to stojí:**

1. **Preference, ne localStorage.** Lukáš má vypínač mít na každém počítači — `savePreference`
   (`PlannerPage.tsx`), klíč `"autoshift"`, hodnota `"on"`/`"off"`. Načítá se ve stejném `useEffect`,
   který už čte `zoom`/`aside-width`. `localStorage` je jen optimistická cache, jak to `savePreference`
   dělá u ostatních klíčů. Viz paměť „nastavení: zařízení vs. uživatel".
2. **Výchozí stav je ZAPNUTO.** Kdo si vypínač nikdy nenastavil, má chování jako dnes.
3. **Split je jiný než ostatní.** Dnes pouští chain push **bezpodmínečně** (`split/route.ts:199`,
   `if (block.type === "ZAKAZKA")`), request `resolveChain` vůbec nečte. Nově ho číst musí — ale
   **chybějící příznak znamená ZAPNUTO** (`body.resolveChain !== false`), ne vypnuto. Jinak by starý
   klient po nasazení tiše přišel o chain push u splitu. U ostatních pěti cest zůstává dnešní
   `=== true`, protože ty klient vždycky posílá výslovně.
4. **Vypínač se týká JEN chain pushe.** Snap vlastního taženého bloku do pracovní doby zůstává —
   to je zámek pracovní doby, jiná funkce a jiný přepínač. Nepleť je.

- [ ] **Step 1: Napiš padající testy**

Vytvoř `src/lib/autoShiftOff.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOSHIFT_OFF_OVERLAP_MESSAGE, autoShiftExplicitlyOff, overlapMessageFor } from "./autoShiftOff";

test("výslovné vypnutí se pozná; chybějící příznak vypnutí NENÍ", () => {
  assert.equal(autoShiftExplicitlyOff({ resolveChain: false }), true);
  assert.equal(autoShiftExplicitlyOff({ resolveChain: true }), false);
  assert.equal(autoShiftExplicitlyOff({}), false, "chybějící příznak není vypnutí");
  assert.equal(autoShiftExplicitlyOff(null), false);
  assert.equal(autoShiftExplicitlyOff({ resolveChain: "false" }), false, "řetězec není false");
});

test("hláška se mění jen při vypnutém autoposunu", () => {
  assert.equal(overlapMessageFor("Blok koliduje s blokem #18673 na stroji XL 105.", true),
    AUTOSHIFT_OFF_OVERLAP_MESSAGE);
  assert.equal(overlapMessageFor("Blok koliduje s blokem #18673 na stroji XL 105.", false),
    "Blok koliduje s blokem #18673 na stroji XL 105.");
});
```

A strážný test `src/lib/autoShiftWiring.test.ts`, který ověří, že **všech šest** serverových cest
příznak čte:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Vypínač autoposunu musí platit na VŠECH šesti cestách, které sahají na
 * `resolveChainPushFromDb`. Kdyby ho jedna ignorovala, plánovač si autoposun vypne,
 * a ta jedna cesta mu bloky posune dál — a on se to dozví až z plánu.
 *
 * Split je zvlášť: chain push tam byl do etapy 6 BEZPODMÍNEČNÝ (žádný `resolveChain`
 * v těle requestu), takže se u něj kontroluje tvar `!== false` (chybějící příznak =
 * zapnuto, kvůli zpětné snášenlivosti se starým klientem).
 */
const CESTY = [
  { path: "src/app/api/blocks/route.ts", vzor: /resolveChain\s*===\s*true/ },
  { path: "src/app/api/blocks/[id]/route.ts", vzor: /resolveChain\s*===\s*true/ },
  { path: "src/app/api/blocks/batch/route.ts", vzor: /resolveChain\s*===\s*true/ },
  { path: "src/app/api/blocks/[id]/split/route.ts", vzor: /resolveChain\s*!==\s*false/ },
  { path: "src/app/api/blocks/[id]/reflow/route.ts", vzor: /resolveChain\s*!==\s*false/ },
  { path: "src/app/api/blocks/reflow/route.ts", vzor: /resolveChain\s*!==\s*false/ },
];

for (const c of CESTY) {
  test(`${c.path} respektuje vypínač autoposunu`, () => {
    assert.match(readFileSync(c.path, "utf8"), c.vzor,
      `${c.path} nečte resolveChain očekávaným způsobem — vypínač tam neplatí`);
  });
}
```

**Pozn. k oběma reflow cestám:** přepočet je akce, kterou si uživatel VYŽÁDAL kliknutím na
„Přepočítat" — otázka je, jestli má vypnutý autoposun bránit i jí. **Rozhodnutí: ano, má.**
Vypínač říká „neposouvej mi cizí bloky", a přepočet je posouvá stejně jako drag. Kdo si autoposun
vypnul a klikne na Přepočítat, dostane přepočet vlastního bloku a kolizi ohlášenou, ne tichý posun
sousedů. Reflow cesty proto čtou `!== false` (výchozí zapnuto, jako split).

- [ ] **Step 2: Server — všech šest cest**

- `src/lib/autoShiftOff.ts` podle rozhraní výš.
- **Split**: `const resolveChain = body?.resolveChain !== false;` a chain push obal
  `if (block.type === "ZAKAZKA" && resolveChain)`. Do komentáře napiš, proč je default `true`
  (zpětná snášenlivost se starým klientem) — jinak to příští čtenář „sjednotí" na `=== true`
  a starý klient přijde o chain push.
- **Obě reflow cesty**: přečti `resolveChain !== false` z těla a předej do
  `ReflowDeps`/`ReflowMachineDeps` jako `resolveChain?: boolean`; `reflowBlockInTx` chain push
  přeskočí, když je `false`. Pozor: `reflowBlockInTx` musí i tak vrátit `moves: []` a korektní
  `before`, ať krok historie sedí.
- **Všech šest**: v catch větvi nahraď hlášku `overlapMessageFor(error.message, autoShiftOff)`
  pro `error.code === "OVERLAP"`.

- [ ] **Step 3: Klient — přepínač a příznak**

- `PlannerPage.tsx`: `const [autoShift, setAutoShift] = useState(true);` + `autoShiftRef`.
  Načtení v `useEffect` s ostatními preferencemi (`prefs["autoshift"] !== "off"`), zápis přes
  `savePreference("autoshift", autoShift ? "on" : "off")`.
- Přepínač v hlavičce **vedle zámku pracovní doby**, stejný vizuální jazyk (ikona + title, barvy
  přes tokeny, **žádný hex literál**). Title: zapnuto → „Autoposun zapnutý — navazující bloky se
  odsunou samy; klik pro vypnutí"; vypnuto → „Autoposun vypnutý — kolize se odmítne, místo uvolníš
  ručně; klik pro zapnutí".
- Všechna volání, která dnes posílají `resolveChain: true`, posílají `resolveChain: autoShiftRef.current`.
  Najdeš je `grep -rn "resolveChain: true" src/` — pozor, u paste je příznak ve sdíleném staviteli
  `buildPasteBody` a u splitu v těle vůbec není. **Spolehlivé kritérium je „volání míří na jednu ze
  šesti serverových cest", ne „obsahuje literál"** — na tomhle už tahle vlna pětkrát naletěla.
- `TimelineGrid.tsx` a `BlockEdit.tsx` příznak dostanou propem (povinným, bez defaultu — když ho
  někdo zapomene předat, ať spadne `tsc`).
- Split volání v `TimelineGrid` nově posílá `resolveChain` v těle.

- [ ] **Step 4: Kontroly a commit**

```bash
npx tsc --noEmit && npx eslint src/app/_components/PlannerPage.tsx src/app/_components/TimelineGrid.tsx src/components/BlockEdit.tsx
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git commit -m "feat(autoposun): vypinac autoposunu per uzivatel - vsech sest zapisovych cest"
```

- [ ] **Step 5: Ruční proklik (patří uživateli, neprovádět za něj)**

- [ ] Vypnout autoposun → přetáhnout blok na obsazené místo → 409 s hláškou o vypnutém autoposunu
- [ ] Vypnout autoposun → přetáhnout na VOLNÉ místo → projde, nic se neodsune
- [ ] Vypnout autoposun → rozdělit zakázku, za kterou navazuje jiná → kolize se odmítne, neposune
- [ ] Vypnout autoposun → „Přepočítat" na bloku → přepočte vlastní blok, sousedy neposune
- [ ] Přepnout na jiném počítači → stav se drží (preference, ne localStorage)
- [ ] Zapnout zpátky → chování jako dnes
- [ ] Zámek pracovní doby funguje nezávisle na vypínači (jsou to dvě různé věci)

---

# ETAPA S — undo rozdělení zakázky (PŘED PRODUKCÍ)

Objeveno 19. 8. 2026 při prokliku testovací instance. **Rozdělení zakázky nezapisuje krok do
klientské historie**, takže Ctrl+Z po splitu sáhne po PŘEDCHOZÍ, cizí akci — doslova bod 3 ze
specu §1, který tahle vlna opravila u přepočtu a u splitu ho nechala být.

Není to regrese téhle vlny; ten stav v aplikaci byl už předtím. Ale u splitu je závažnější než
u přepočtu, protože **chain push tam běží BEZPODMÍNEČNĚ u každé zakázky** (`split/route.ts:180`,
žádný opt-in `resolveChain`), takže rozdělení může odsunout desítky navazujících bloků — a dnes
to nejde vzít zpět ani Ctrl+Z, ani tlačítkem v historii (etapa D neexistuje), jen ručním skriptem
přes SSH.

**Proč před produkcí:** vlna se nasazuje s tvrzením „autoposun je od teď vratný". S nezapsaným
splitem to tvrzení neplatí a plánovač na to přijde v nejhorší chvíli — až bude chtít vzít zpět
kaskádu, kterou split způsobil.

**Co serverová historie umí už dnes:** split běží uvnitř `withRevision`, takže hlava, ocas i
odsunutí sousedé dostanou revizi pod jedním `groupId` a jsou vidět v panelu „Historie změn".
Chybí jen cesta, jak to vrátit z UI.

## Task S1: Split zapisuje krok do historie

**Files:**
- Modify: `src/app/api/blocks/[id]/split/route.ts` (odpověď o `before`)
- Modify: `src/lib/undo/commands.ts` (`buildSplitCommand`)
- Modify: `src/lib/undo/commands.test.ts`
- Modify: `src/app/_components/TimelineGrid.tsx` (`handleSplitBlockAt` — předá data nahoru)
- Modify: `src/app/_components/PlannerPage.tsx` (složí a zapíše krok)

**Interfaces:**
- Consumes: `moveToBefore` / `ReflowBeforeSnapshot` (`reflowBefore.server.ts`, etapa C1),
  `AppliedMove` s `old*` poli, `posOp`/`guard`/`refresh` v `commands.ts`.
- Produces:
  ```ts
  // odpověď split routy — NOVÉ pole vedle head/tail/shifted
  before: {
    head: { id: number; endTime: string; splitGroupId: number | null;
            printMinutes: number | null; scheduleBypassed: boolean; updatedAt: string };
    shifted: ReflowBeforeSnapshot[];
  }

  // src/lib/undo/commands.ts
  export function buildSplitCommand(
    label: string,
    head: { id: number; beforeFields: Record<string, unknown>; afterFields: Record<string, unknown>;
            beforeUpdatedAt: string; afterUpdatedAt: string },
    tail: CreatedRef,
    shiftedBefore: BlockSnapshot[],
    shiftedAfter: BlockSnapshot[],
  ): HistoryEntry
  ```

**Co krok dělá:**
- **undo:** `remove` ocas · `upsert` hlavu s `beforeFields` · vrátit pozice odsunutých
- **redo:** `upsert` ocas (vzkříšení se stejným `id` i `createdAt`, vzor `buildCreateCommand`) ·
  `upsert` hlavu s `afterFields` · znovu odsunout

**Čtyři věci, na kterých to stojí:**

1. **Hlavě se mění JEN `endTime`, `splitGroupId`, a u ZAKAZKA `printMinutes` + `scheduleBypassed`**
   (`split/route.ts:104-111`). `startTime` ani `machine` split nemění — do `beforeFields` je
   nedávej, ať krok nezapisuje víc, než co se změnilo.
2. **`splitGroupId` se NEVRACÍ na `null` natvrdo.** Když se dělí už rozdělená zakázka, hlava
   svůj `splitGroupId` už měla a split ho jen převzal (`block.splitGroupId ?? create()`,
   ř. 98). Snapshot proto musí nést PŮVODNÍ hodnotu, ať už je to `null` nebo číslo.
3. **Osiřelý řádek `SplitGroup` po undu je v pořádku a nemaže se.** Členství se dotazuje
   výhradně přes `where: { splitGroupId: X }` (`CLAUDE.md`), takže skupina bez členů nikomu
   nevadí. Mazání by naopak muselo řešit souběh s druhým sourozencem.
4. **`before.shifted` se skládá z `shiftedMoves`, ne z klientského stavu.** `AppliedMove` nese
   od etapy C1 kompletní `old*` snapshot, takže stačí `shiftedMoves.map(m => moveToBefore(block.machine, m))`.
   Klientský stav nestačí ze stejného důvodu jako u přepočtu — chain push posouvá i bloky mimo
   načtený rozsah dní.

**Kde se krok zapisuje:** `recordUndo` žije v `PlannerPage`, split se provádí v `TimelineGrid`.
Přidej do `callbacksRef` callback `onSplitDone(data)` — `TimelineGrid` mu předá odpověď serveru
i původní blok, `PlannerPage` z toho složí `buildSplitCommand` a zapíše ho. **Undo se NESKLÁDÁ
v `TimelineGrid`** — jinak by se logika zapisování historie rozpadla do dvou souborů.

- [ ] **Step 1: Napiš padající testy do `src/lib/undo/commands.test.ts`**

```ts
test("buildSplitCommand: undo smaže ocas, vrátí pole hlavy i pozice odsunutých", async () => {
  const live = new Map([
    [1, blk(1, { endTime: "2026-08-20T10:00:00.000Z", updatedAt: "h2" })],
    [2, blk(2, { updatedAt: "t1" })],
    [3, blk(3, { startTime: "2026-08-20T14:00:00.000Z", updatedAt: "s2" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const entry = buildSplitCommand(
    "Rozdělení bloku",
    { id: 1,
      beforeFields: { endTime: "2026-08-20T14:00:00.000Z", splitGroupId: null, printMinutes: 360, scheduleBypassed: false },
      afterFields:  { endTime: "2026-08-20T10:00:00.000Z", splitGroupId: 9, printMinutes: 240, scheduleBypassed: false },
      beforeUpdatedAt: "h1", afterUpdatedAt: "h2" },
    { id: 2, updatedAt: "t1", fields: { orderNumber: "X" }, createdAt: "2026-08-19T00:00:00.000Z" },
    [{ id: 3, startTime: "2026-08-20T12:00:00.000Z", endTime: "2026-08-20T13:00:00.000Z", machine: "XL_105", updatedAt: "s1", printMinutes: 60, scheduleBypassed: false }],
    [{ id: 3, startTime: "2026-08-20T14:00:00.000Z", endTime: "2026-08-20T15:00:00.000Z", machine: "XL_105", updatedAt: "s2", printMinutes: 60, scheduleBypassed: false }],
  );
  await entry.undo(effects);
  const ops = calls.undo[0].ops;
  assert.equal(ops.filter((o) => o.kind === "remove").length, 1, "ocas se maže");
  assert.equal(ops.find((o) => o.kind === "remove").id, 2);
  const headOp = ops.find((o) => o.kind === "upsert" && o.id === 1);
  assert.equal(headOp.fields.endTime, "2026-08-20T14:00:00.000Z", "hlavě se vrací PŮVODNÍ konec");
  assert.equal(headOp.fields.splitGroupId, null);
  assert.equal(headOp.fields.printMinutes, 360);
  assert.ok(!("startTime" in headOp.fields), "startTime split nemění → krok ho nesmí zapisovat");
  const shiftOp = ops.find((o) => o.kind === "upsert" && o.id === 3);
  assert.equal(shiftOp.fields.startTime, "2026-08-20T12:00:00.000Z");
});

test("buildSplitCommand: redo ocas vzkřísí a hlavu zase zkrátí", async () => {
  const live = new Map([
    [1, blk(1, { endTime: "2026-08-20T14:00:00.000Z", updatedAt: "h1" })],
    [3, blk(3, { startTime: "2026-08-20T12:00:00.000Z", updatedAt: "s1" })],
  ]);
  const { effects, calls } = makeEffects(live);
  const entry = buildSplitCommand("Rozdělení bloku",
    { id: 1, beforeFields: { endTime: "2026-08-20T14:00:00.000Z", splitGroupId: null, printMinutes: 360, scheduleBypassed: false },
      afterFields: { endTime: "2026-08-20T10:00:00.000Z", splitGroupId: 9, printMinutes: 240, scheduleBypassed: false },
      beforeUpdatedAt: "h1", afterUpdatedAt: "h2" },
    { id: 2, updatedAt: "t1", fields: { orderNumber: "X" }, createdAt: "2026-08-19T00:00:00.000Z" },
    [{ id: 3, startTime: "2026-08-20T12:00:00.000Z", endTime: "2026-08-20T13:00:00.000Z", machine: "XL_105", updatedAt: "s1", printMinutes: 60, scheduleBypassed: false }],
    [{ id: 3, startTime: "2026-08-20T14:00:00.000Z", endTime: "2026-08-20T15:00:00.000Z", machine: "XL_105", updatedAt: "s2", printMinutes: 60, scheduleBypassed: false }],
  );
  await entry.redo(effects);
  const ops = calls.undo[0].ops;
  assert.equal(calls.undo[0].direction, "redo");
  const tailOp = ops.find((o) => o.id === 2);
  assert.equal(tailOp.kind, "upsert", "ocas se vzkřísí, ne maže");
  assert.equal(tailOp.createdAt, "2026-08-19T00:00:00.000Z", "vzkříšení nese původní createdAt");
  assert.equal(ops.find((o) => o.id === 1).fields.endTime, "2026-08-20T10:00:00.000Z");
});

test("buildSplitCommand: PŮVODNÍ splitGroupId se vrací, ne natvrdo null", async () => {
  // Dělení už rozdělené zakázky — hlava svou skupinu měla a split ji jen převzal.
  const live = new Map([[1, blk(1, { updatedAt: "h2" })], [2, blk(2, { updatedAt: "t1" })]]);
  const { effects, calls } = makeEffects(live);
  await buildSplitCommand("Rozdělení bloku",
    { id: 1, beforeFields: { endTime: "2026-08-20T14:00:00.000Z", splitGroupId: 5, printMinutes: 360, scheduleBypassed: false },
      afterFields: { endTime: "2026-08-20T10:00:00.000Z", splitGroupId: 5, printMinutes: 240, scheduleBypassed: false },
      beforeUpdatedAt: "h1", afterUpdatedAt: "h2" },
    { id: 2, updatedAt: "t1", fields: {}, createdAt: "2026-08-19T00:00:00.000Z" }, [], [],
  ).undo(effects);
  assert.equal(calls.undo[0].ops.find((o) => o.id === 1).fields.splitGroupId, 5);
});
```

- [ ] **Step 2: Spusť a ověř, že padají**

```bash
node --test --import tsx src/lib/undo/commands.test.ts
```
Očekávané: FAIL — `buildSplitCommand is not a function`.

- [ ] **Step 3: Přidej `buildSplitCommand` do `src/lib/undo/commands.ts`**

Vzor je `buildCreateCommand` (ř. 274) — tvar operací i práce s `refresh`/`addToState`/`removeFromState`
se od něj liší jen tím, že přibývá editace hlavy:

```ts
/**
 * Krok historie po rozdělení zakázky.
 *
 * Split dělá TŘI věci naráz: zkrátí hlavu, vytvoří ocas a chain pushem odsune navazující
 * bloky. Žádný ze stávajících builderů takový tvar nemá — `buildCreateCommand` umí
 * create + odsunuté, `buildEditCommand` edit + odsunuté, tohle potřebuje obojí.
 *
 * Do 19. 8. 2026 split krok NEZAPISOVAL vůbec, takže Ctrl+Z po něm sáhl po PŘEDCHOZÍ,
 * cizí akci — táž vada, jakou tahle vlna opravila u přepočtu (spec §1, bod 3).
 */
export function buildSplitCommand(
  label: string,
  head: { id: number; beforeFields: Record<string, unknown>; afterFields: Record<string, unknown>;
          beforeUpdatedAt: string; afterUpdatedAt: string },
  tail: CreatedRef,
  shiftedBefore: BlockSnapshot[] = [],
  shiftedAfter: BlockSnapshot[] = [],
): HistoryEntry {
  return {
    label,
    undo: async (effects) => {
      const liveTail = effects.getLiveBlock(tail.id);
      if (!liveTail || liveTail.updatedAt !== tail.updatedAt) throw new StaleUndoError();
      guard(effects, shiftedAfter);
      const expMap = new Map(shiftedAfter.map((e) => [e.id, e.updatedAt]));
      const res = await effects.applyUndo({
        label, direction: "undo",
        ops: [
          { kind: "remove", id: tail.id, expectedUpdatedAt: tail.updatedAt },
          { kind: "upsert", id: head.id, expectedUpdatedAt: head.afterUpdatedAt, fields: head.beforeFields },
          ...shiftedBefore.map((t) => posOp(t, expMap.get(t.id))),
        ],
      });
      refresh(shiftedBefore, res.updated);
      effects.removeFromState(res.removed);
      effects.addToState(res.updated);
      return affected(res);
    },
    redo: async (effects) => {
      guard(effects, shiftedBefore);
      const expMap = new Map(shiftedBefore.map((e) => [e.id, e.updatedAt]));
      const res = await effects.applyUndo({
        label, direction: "redo",
        ops: [
          { kind: "upsert", id: tail.id, fields: tail.fields, createdAt: tail.createdAt },
          { kind: "upsert", id: head.id, expectedUpdatedAt: head.beforeUpdatedAt, fields: head.afterFields },
          ...shiftedAfter.map((t) => posOp(t, expMap.get(t.id))),
        ],
      });
      refresh(shiftedAfter, res.updated);
      effects.addToState(res.updated);
      return affected(res);
    },
  };
}
```

- [ ] **Step 4: Spusť testy a ověř, že prochází**

```bash
node --test --import tsx src/lib/undo/commands.test.ts
```

- [ ] **Step 5: Server — split vrací `before`**

V `src/app/api/blocks/[id]/split/route.ts`:
- import `moveToBefore` z `@/lib/reflowBefore.server`
- PŘED krokem 6 (update hlavy) si ulož původní hodnoty z už načteného `block`:
  ```ts
  // Snapshot hlavy PŘED zkrácením — Ctrl+Z ho potřebuje, aby split šel vzít zpět.
  // Jen pole, která split SKUTEČNĚ mění; `startTime`/`machine` zůstávají.
  const headBefore = {
    id: block.id,
    endTime: block.endTime.toISOString(),
    splitGroupId: block.splitGroupId,          // POZOR: u už rozdělené zakázky NENÍ null
    printMinutes: block.printMinutes,
    scheduleBypassed: block.scheduleBypassed,
    updatedAt: block.updatedAt.toISOString(),
  };
  ```
- do `NextResponse.json` přidej:
  ```ts
  before: { head: headBefore, shifted: shiftedMoves.map((m) => moveToBefore(block.machine, m)) },
  ```

- [ ] **Step 6: Klient — `TimelineGrid` předá data nahoru, `PlannerPage` zapíše krok**

`TimelineGrid.tsx`, `handleSplitBlockAt`: za `onBlockCreate(tail)` přidej
```ts
callbacksRef.current.onSplitDone?.({ head, tail, shifted: shifted ?? [], before, headLive });
```
kde `before` je z odpovědi a `headLive` je blok, jak vypadal PŘED splitem (parametr `block`).
Typ callbacku dej do stejného rozhraní jako `onBlockUpdate`/`onError`.

`PlannerPage.tsx`: implementuj `onSplitDone` tak, že složí `buildSplitCommand` a zavolá
`recordUndo`. `afterFields` poskládej z vrácené `head` (endTime, splitGroupId, printMinutes,
scheduleBypassed), `shiftedBefore` z `before.shifted`, `shiftedAfter` ze serializovaných
`shifted` bloků v odpovědi.

- [ ] **Step 7: Kontroly**

```bash
npx tsc --noEmit
npx eslint src/app/_components/PlannerPage.tsx src/app/_components/TimelineGrid.tsx
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/blocks/\[id\]/split/route.ts src/lib/undo/commands.ts src/lib/undo/commands.test.ts \
  src/app/_components/TimelineGrid.tsx src/app/_components/PlannerPage.tsx
git commit -m "feat(split): rozdeleni zakazky se zapisuje do historie - Ctrl+Z ho vrati"
```

- [ ] **Step 9: Ruční proklik (patří uživateli, neprovádět za něj)**

- [ ] Rozdělit zakázku, která odsune navazující → Ctrl+Z vrátí hlavu, smaže ocas i vrátí odsunuté
- [ ] Ctrl+Z hned po splitu **nesmí vrátit cizí akci**
- [ ] Redo split zopakuje
- [ ] Rozdělit **už rozdělenou** zakázku → Ctrl+Z vrátí původní `splitGroupId`, ne `null`

---

# ETAPA D — „vrátit revizní skupinu" jako funkce aplikace

Dnes to umí jen `scripts/revert-revision-group.ts` (674 řádků, pouští se ručně přes SSH). Etapa z něj vytáhne pravidla do sdíleného modulu a postaví nad nimi endpoint a tlačítko. **Skript zůstává** — je to nástroj pro situaci, kdy aplikace neběží, a po refaktoru jede na tomtéž jádře, takže se ta dvě chování nemůžou rozejít.

Proč to nestačí řešit Ctrl+Z: zásobník je v paměti, mizí refreshem, má 30 kroků a 200 operací, a je vázaný na `expectedUpdatedAt` z prohlížeče. Havárie 17. 8. šla vrátit jen skriptem právě proto, že sedmi z 88 bloků se mezitím dotkli jiní lidé.

## Task D1: Extrakce jádra do sdíleného modulu

**Files:**
- Create: `src/lib/revertRevisionGroup.server.ts`
- Create: `src/lib/revertRevisionGroup.server.test.ts`
- Modify: `scripts/revert-revision-group.ts` (zůstane parsování argumentů a výpis; pravidla se importují)

**Interfaces:**
- Consumes: `withRevision`, `assertNoOverlapForBlocks`, `PrismaTransactionClient` — vše existující.
- Produces:
  ```ts
  export type RevertField = "startTime" | "endTime" | "printMinutes";
  export type RevertTarget = {
    blockId: number;
    orderNumber: string | null;
    machine: string;
    fields: RevertField[];
    to: Partial<Record<RevertField, Date | number>>;
    expect: Partial<Record<RevertField, Date | number>>;
    viaAlsoRevision: boolean;
  };
  export type RevertPlan = {
    targets: RevertTarget[];
    missing: number[];
    drifted: string[];
    causedCollisions: string[];
    preexistingCollisions: string[];
    blocked: boolean;
  };
  export async function planRevertGroup(
    client: PrismaClientLike,
    opts: { groupId: string; alsoRevisionIds?: number[]; allowPreexistingOverlaps?: boolean },
  ): Promise<RevertPlan>
  export async function applyRevertGroup(
    opts: {
      groupId: string; alsoRevisionIds?: number[]; allowPreexistingOverlaps?: boolean;
      actor: { id: number; username: string };
    },
  ): Promise<{ updatedIds: number[] }>
  ```
  `blocked === true` znamená, že se zapisovat NESMÍ — sečteno z `missing`, `drifted` a `causedCollisions` (a z `preexistingCollisions`, když `allowPreexistingOverlaps` není zapnuté).

- [ ] **Step 1: Napiš padající testy**

Vytvoř `src/lib/revertRevisionGroup.server.test.ts`. Fake klient vrací revize a bloky; testy pokrývají čtyři pravidla, na kterých celý nástroj stojí:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planRevertGroup } from "./revertRevisionGroup.server";

const ISO = (s: string) => new Date(s).toISOString();

function fakeClient(opts: {
  revisions: Array<Record<string, unknown>>;
  blocks: Array<Record<string, unknown>>;
}) {
  return {
    blockRevision: {
      findMany: async () => opts.revisions,
      findFirst: async () => opts.revisions[opts.revisions.length - 1] ?? null,
      findUnique: async () => null,
    },
    block: {
      findMany: async () => opts.blocks,
    },
  } as never;
}

const rev = (blockId: number, machine: string, before: unknown, after: unknown, kind = "UPDATE") =>
  ({ id: blockId * 10, blockId, orderNumber: `O${blockId}`, machine, kind, before, after });

const blk = (id: number, machine: string, start: string, end: string) =>
  ({ id, orderNumber: `O${id}`, machine, startTime: new Date(start), endTime: new Date(end), printMinutes: 120 });

test("čistě poziční skupina se přeloží na cíle", async () => {
  const c = fakeClient({
    revisions: [rev(1, "XL_105",
      { startTime: ISO("2026-08-18T08:00:00Z"), endTime: ISO("2026-08-18T10:00:00Z") },
      { startTime: ISO("2026-08-20T08:00:00Z"), endTime: ISO("2026-08-20T10:00:00Z") })],
    blocks: [blk(1, "XL_105", "2026-08-20T08:00:00Z", "2026-08-20T10:00:00Z")],
  });
  const plan = await planRevertGroup(c, { groupId: "g1" });
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.blocked, false);
  assert.equal((plan.targets[0]!.to.startTime as Date).toISOString(), ISO("2026-08-18T08:00:00Z"));
});

test("skupina měnící i `machine` se ODMÍTNE celá", async () => {
  const c = fakeClient({
    revisions: [rev(1, "XL_105",
      { startTime: ISO("2026-08-18T08:00:00Z"), machine: "XL_105" },
      { startTime: ISO("2026-08-20T08:00:00Z"), machine: "XL_106" })],
    blocks: [blk(1, "XL_106", "2026-08-20T08:00:00Z", "2026-08-20T10:00:00Z")],
  });
  await assert.rejects(() => planRevertGroup(c, { groupId: "g1" }), /není čistě poziční|machine/i);
});

test("blok, který mezitím někdo posunul jinam, dávku ZABLOKUJE", async () => {
  const c = fakeClient({
    revisions: [rev(1, "XL_105",
      { startTime: ISO("2026-08-18T08:00:00Z"), endTime: ISO("2026-08-18T10:00:00Z") },
      { startTime: ISO("2026-08-20T08:00:00Z"), endTime: ISO("2026-08-20T10:00:00Z") })],
    blocks: [blk(1, "XL_105", "2026-08-25T08:00:00Z", "2026-08-25T10:00:00Z")],
  });
  const plan = await planRevertGroup(c, { groupId: "g1" });
  assert.equal(plan.drifted.length, 1);
  assert.equal(plan.blocked, true);
});

test("blok přesunutý na JINÝ STROJ dávku zablokuje taky", async () => {
  const c = fakeClient({
    revisions: [rev(1, "XL_105",
      { startTime: ISO("2026-08-18T08:00:00Z"), endTime: ISO("2026-08-18T10:00:00Z") },
      { startTime: ISO("2026-08-20T08:00:00Z"), endTime: ISO("2026-08-20T10:00:00Z") })],
    blocks: [blk(1, "XL_106", "2026-08-20T08:00:00Z", "2026-08-20T10:00:00Z")],
  });
  const plan = await planRevertGroup(c, { groupId: "g1" });
  assert.equal(plan.blocked, true);
  assert.match(plan.drifted.join(" "), /stroj/i);
});

test("prázdná skupina se odmítne", async () => {
  const c = fakeClient({ revisions: [], blocks: [] });
  await assert.rejects(() => planRevertGroup(c, { groupId: "neexistuje" }), /skupina/i);
});
```

- [ ] **Step 2: Spusť a ověř, že padá**

```bash
node --test --import tsx src/lib/revertRevisionGroup.server.test.ts
```
Očekávané: FAIL — `Cannot find module './revertRevisionGroup.server'`.

- [ ] **Step 3: Přesuň jádro do modulu**

Do `src/lib/revertRevisionGroup.server.ts` přesuň **beze změny logiky** z `scripts/revert-revision-group.ts`:
`POSITIONAL`, `ALSO_FIELDS`, `FieldValues`, `positionalFieldsOf`, `fieldsOf`, `GroupTarget`/`AlsoTarget` (sjednoť do `RevertTarget` s příznakem `viaAlsoRevision`), `buildAlsoTarget`, `DbRow`, `checkTarget`, `checkGuard`, `fetchRows`, `fetchRowsLocked`, sestavení cílů, a simulaci kolizí z `main()`.

Rozhraní ven jsou právě dvě funkce z bloku **Interfaces** výš:
- `planRevertGroup` — **NIC nezapisuje**, transakci vůbec neotevírá. Vrací plán včetně nálezů.
- `applyRevertGroup` — otevře `withRevision`, jako **PRVNÍ dotaz** zavolá `fetchRowsLocked` (`SELECT … FOR UPDATE`), zopakuje `checkGuard` uvnitř transakce, zapíše, a na konci zavolá `assertNoOverlapForBlocks`.

Zachovej doslova docblock o tom, proč musí být zamykající čtení první dotaz — je to pravidlo z `CLAUDE.md` a nesmí se ztratit stěhováním.

Formátování pro člověka (`span`, `fmt`, `fmtVal`, `incidentRevertFieldRow`, `printHelp`, `parseArgs`, všechna `console.log`) **zůstává ve skriptu** — modul nesmí nic tisknout.

- [ ] **Step 4: Přepiš skript na import**

`scripts/revert-revision-group.ts` si ponechá hlavičkový komentář, `parseArgs`, výpisy a `process.exitCode`, ale pravidla volá:

```ts
import { planRevertGroup, applyRevertGroup } from "@/lib/revertRevisionGroup.server";
```
`main()` se scvrkne na: parsuj argumenty → `planRevertGroup` → vypiš návrh a nálezy → když `plan.blocked`, `process.exitCode = 1` a konec → bez `--apply` konec → s `--apply` zavolej `applyRevertGroup` a vypiš výsledek.

Aktor pro `withRevision` u skriptu: `{ id: 0, username: "script:revert-revision-group" }` — v revizi musí být poznat, že zápis přišel z ruční ops akce, ne od uživatele.

- [ ] **Step 5: Spusť testy a ověř, že prochází**

```bash
node --test --import tsx src/lib/revertRevisionGroup.server.test.ts
npx tsx scripts/revert-revision-group.ts --group NEEXISTUJICI
```
Očekávané: testy PASS (5); skript vypíše srozumitelnou chybu a skončí s kódem 1 (`echo $?` → 1).

- [ ] **Step 6: Ověř typy a celou suite, pak commit**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add src/lib/revertRevisionGroup.server.ts src/lib/revertRevisionGroup.server.test.ts scripts/revert-revision-group.ts
git commit -m "refactor(revert): jadro vraceni revizni skupiny do sdileneho modulu"
```

---

## Task D2: Endpoint `POST /api/blocks/revert-group`

**Files:**
- Create: `src/app/api/blocks/revert-group/route.ts`

**Interfaces:**
- Consumes: `planRevertGroup`, `applyRevertGroup` (Task D1).
- Produces: HTTP kontrakt
  ```
  POST /api/blocks/revert-group
  body: { groupId: string, apply?: boolean }
  200 (dry-run):  { plan: { targets, missing, drifted, causedCollisions, preexistingCollisions, blocked } }
  200 (apply):    { updatedIds: number[], blocks: Block[] }
  409:            { error }   — plán je blokovaný (blok se mezitím pohnul / kolize)
  400 | 401 | 403 | 404 | 500 podle errorStatus
  ```

- [ ] **Step 1: Napiš routu**

```ts
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { serializeBlock } from "@/lib/blockSerialization";
import { emitSSE } from "@/lib/eventBus";
import { planRevertGroup, applyRevertGroup } from "@/lib/revertRevisionGroup.server";

/**
 * Vrácení revizní skupiny z aplikace — totéž, co `scripts/revert-revision-group.ts`,
 * jen bez SSH. Sdílí s ním JÁDRO (`revertRevisionGroup.server.ts`), takže se pravidla
 * nemůžou rozejít: čistě poziční skupiny, guard „blok stojí tam, kam ho zapsala
 * revize" (včetně stroje), zamykající čtení jako první dotaz transakce,
 * `assertNoOverlapForBlocks` na konci.
 *
 * Na rozdíl od Ctrl+Z funguje po refreshi, pro jiného člověka a i tehdy, když se
 * dotčených bloků mezitím někdo dotkl — nestojí na optimistickém zámku z prohlížeče,
 * ale na revizi.
 *
 * `apply: false` (výchozí) je DRY-RUN: nic nezapisuje, transakci vůbec neotevírá.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireRole(["ADMIN", "PLANOVAT"]);

    const body = (await request.json().catch(() => null)) as { groupId?: string; apply?: boolean } | null;
    const groupId = typeof body?.groupId === "string" ? body.groupId.trim() : "";
    if (!groupId) throw new AppError("VALIDATION_ERROR", "Chybí groupId.");

    const plan = await planRevertGroup(prisma, { groupId });

    if (body?.apply !== true) {
      return NextResponse.json({ plan });
    }
    if (plan.blocked) {
      throw new AppError(
        "CONFLICT",
        "Vrácení nelze provést — některý blok mezitím někdo změnil nebo by vrácení způsobilo kolizi. Otevři detail a zkontroluj plán.",
      );
    }

    const { updatedIds } = await applyRevertGroup({
      groupId,
      actor: { id: session.id, username: session.username },
    });

    const blocks = await prisma.block.findMany({
      where: { id: { in: updatedIds } },
      include: {
        Reservation: { select: { confirmedAt: true } },
        notes: { orderBy: { createdAt: "desc" as const } },
      },
    });
    const serialized = blocks.map(serializeBlock);
    emitSSE("block:batch-updated", { blocks: serialized, sourceUserId: session.id });

    logger.warn("[POST /api/blocks/revert-group] revizní skupina vrácena", {
      groupId, count: updatedIds.length, username: session.username,
    });
    return NextResponse.json({ updatedIds, blocks: serialized });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[POST /api/blocks/revert-group] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

**Pozor na dvě věci:**
- `requireRole` musí být UVNITŘ `try` (hází `UNAUTHORIZED`/`FORBIDDEN`, které chytne catch výš) — je to pravidlo z `CLAUDE.md`.
- Route se **NEobaluje** do `withRevision` — dělá to `applyRevertGroup` uvnitř, a `withRevision` nejde vnořit (hlídá `AsyncLocalStorage`).

- [ ] **Step 2: Ověř, že middleware routu chrání**

```bash
grep -n "api/auth\|api/health\|vyroba-terminal" src/middleware.ts
```
Očekávané: v seznamu veřejných cest **nová routa NENÍ** — jediné záměrně veřejné cesty jsou `/api/auth/*`, `/api/health` a `/vyroba-terminal.html`.

- [ ] **Step 3: Ověř proti běžícímu devu (port 3001)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/blocks/revert-group \
  -H "Content-Type: application/json" -d '{"groupId":"neexistuje"}'
```
Očekávané: `401` bez cookie. S přihlašovací cookie a neexistující skupinou: `404` nebo `400` podle toho, jakou chybu `planRevertGroup` hodí — hlavně **ne 500**.

- [ ] **Step 4: Typy, suite, commit**

```bash
npx tsc --noEmit
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
git add src/app/api/blocks/revert-group/route.ts
git commit -m "feat(revert): endpoint pro vraceni revizni skupiny (dry-run + zapis)"
```

---

## Task D3: Tlačítko „Vrátit tuto změnu" v historii bloku

**Files:**
- Create: `src/components/RevertGroupButton.tsx`
- Modify: `src/components/BlockDetail.tsx` (řádky historie ~ř. 599–680)

**Interfaces:**
- Consumes: endpoint z Tasku D2; `BlockHistoryEntry.groupId` (existující pole).
- Produces: `export function RevertGroupButton({ groupId, canRevert, onReverted }: { groupId: string; canRevert: boolean; onReverted: () => void })`

- [ ] **Step 1: Napiš komponentu**

```tsx
"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Plan = {
  targets: Array<{ blockId: number; orderNumber: string | null; machine: string }>;
  missing: number[];
  drifted: string[];
  causedCollisions: string[];
  preexistingCollisions: string[];
  blocked: boolean;
};

/**
 * „Vrátit tuto změnu" u řádku historie, který vznikl autoposunem.
 *
 * Vždy DVA kroky: nejdřív dry-run (co přesně se vrátí a co tomu brání), teprve
 * po potvrzení zápis. Jednokrokové vrácení by z tlačítka udělalo druhou cestu,
 * kterou se plán hne bez vědomí plánovače — a to je právě to, co celá vlna řeší.
 */
export function RevertGroupButton({
  groupId,
  canRevert,
  onReverted,
}: {
  groupId: string;
  canRevert: boolean;
  onReverted: () => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRevert) return null;

  async function loadPlan() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/blocks/revert-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Plán vrácení se nepodařilo načíst.");
        return;
      }
      setPlan(data.plan as Plan);
    } finally {
      setBusy(false);
    }
  }

  async function doApply() {
    setBusy(true);
    try {
      const res = await fetch("/api/blocks/revert-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, apply: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Vrácení se nepodařilo provést.");
        return;
      }
      setPlan(null);
      onReverted();
    } finally {
      setBusy(false);
    }
  }

  const blocked = plan?.blocked === true;
  const problems = plan
    ? [...plan.drifted, ...plan.causedCollisions, ...plan.preexistingCollisions]
    : [];

  return (
    <>
      <button
        type="button"
        onClick={loadPlan}
        disabled={busy}
        style={{
          fontSize: 9, padding: "1px 6px", borderRadius: 4, cursor: busy ? "default" : "pointer",
          background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)",
        }}
      >
        Vrátit tuto změnu
      </button>
      {error && <span style={{ fontSize: 9, color: "var(--danger)" }}> · {error}</span>}
      <ConfirmDialog
        open={plan !== null}
        title={blocked ? "Vrátit nelze" : "Vrátit tuto změnu?"}
        message={
          blocked
            ? "Od té změny se s bloky pracovalo dál — vrácení by přepsalo cizí práci."
            : `Vrátí se ${plan?.targets.length ?? 0} bloků na pozice, které měly před touhle změnou.`
        }
        confirmLabel={blocked ? "Rozumím" : "Vrátit"}
        cancelLabel="Zavřít"
        danger={!blocked}
        autoFocusConfirm={false}
        width={420}
        onConfirm={() => (blocked ? setPlan(null) : void doApply())}
        onCancel={() => setPlan(null)}
      >
        {problems.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 16, fontSize: 10, color: "var(--text-muted)" }}>
            {problems.slice(0, 8).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </>
  );
}
```

- [ ] **Step 2: Zapoj do `BlockDetail.tsx`**

Import:
```ts
import { RevertGroupButton } from "@/components/RevertGroupButton";
```

V auditní větvi renderu, uvnitř bloku pro `AUTO_SHIFT` a `AUTO_REFLOW` (~ř. 665), přidej za stávající `<span>`:

```tsx
                  {(log.action === "AUTO_SHIFT" || log.action === "AUTO_REFLOW") && log.groupId && (
                    <> <RevertGroupButton
                      groupId={log.groupId}
                      canRevert={canEdit}
                      onReverted={() => { setBlockHistory([]); onRefresh?.(); }}
                    /></>
                  )}
```

`canEdit` a `onRefresh` vezmi z props, které `BlockDetail` už má — **nepřidávej nové props, dokud neověříš, že chybí**:
```bash
grep -n "canEdit\|onRefresh\|type BlockDetailProps" -A 3 src/components/BlockDetail.tsx | head -30
```
Když `onRefresh` neexistuje, použij existující cestu, kterou komponenta dnes obnovuje data po jiné mutaci — a v komentáři napiš kterou.

**Historické řádky `groupId` nemají** (sloupec je nullable, viz `blockHistory.ts`) — u nich se tlačítko prostě nevykreslí a to je správně: skupinu bez `groupId` nejde adresovat.

- [ ] **Step 3: Ověř typy, lint**

```bash
npx tsc --noEmit
npx eslint src/components/RevertGroupButton.tsx src/components/BlockDetail.tsx
```

- [ ] **Step 4: Ruční proklik (dev)**

- [ ] Přesuň blok tak, aby odsunul navazující → otevři detail odsunutého bloku → v historii je `AUTO_SHIFT` s tlačítkem
- [ ] Klik → dialog vypíše počet bloků k vrácení
- [ ] „Vrátit" → bloky se vrátí, timeline se překreslí
- [ ] Posuň jeden z dotčených bloků ručně jinam, pak zkus vrátit skupinu → dialog **odmítne** a vypíše důvod
- [ ] Tlačítko **není vidět** pro roli bez práva editace (VIEWER / OBCHODNIK)
- [ ] Řádek historie bez `groupId` (starý záznam) tlačítko nemá

- [ ] **Step 5: Commit**

```bash
git add src/components/RevertGroupButton.tsx src/components/BlockDetail.tsx
git commit -m "feat(revert): tlacitko Vratit tuto zmenu v historii bloku"
```

---

**⛔ KONEC 3. NASAZENÍ (etapa D). Zastav se a počkej na OK.**

---

# Dokumentace (poslední commit vlny)

- [ ] **Step 1: `CLAUDE.md`**

V sekci **Chain push** je dnes odstavec „**ZAKÁZKA na chain pushi horizont NEMÁ**", který popisuje otevřený dluh. Po etapě B už to není pravda — přepiš ho tak, aby říkal, že strop existuje (`CASCADE_CONFIRM_MAX_BLOCKS`, `MAX_RIGID_PUSH_MS` jako vzdálenost) a že se vynucuje v `resolveChainPushFromDb` na všech pěti cestách. Doplň `src/lib/cascadeLimit.ts` do indexu klíčových souborů vedle `cascadeCheck.ts`.

- [ ] **Step 2: `docs/POUCENI.md`**

Přidej řádek: autoposun se počítal a zapisoval bez toho, aby kdokoliv znal jeho rozsah; hláška mlčela a Ctrl+Z sáhl po CIZÍ akci, protože reflow se do historie vůbec nezapisoval. Pravidlo: **cesta, která hýbe víc bloky než těmi, na které uživatel klikl, musí (a) říct kolik, (b) být vratná, (c) mít strop.**

- [ ] **Step 3: `docs/vyvoj-historie.md`**

Odstavec o vlně: co se změnilo v odpovědích reflow rout, proč `buildReflowCommand` existuje vedle `buildMoveCommand`, a že `revert-revision-group` má od téhle vlny sdílené jádro se skriptem.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/POUCENI.md docs/vyvoj-historie.md
git commit -m "docs: autoposun viditelny a vratny - konvence a pouceni"
```

---

# Self-review plánu

**Pokrytí specu:**

| Spec | Task |
| --- | --- |
| §3.1 etapa A — číslo v hlášce, prázdné `moves` bez „odsunuto 0", skloňování jako dnes | A1 |
| §3.2 etapa C — `before` v odpovědi, `buildMoveCommand`, label | C1, C2, C3 |
| §3.2 vědomé omezení (30 kroků, refresh, optimistický zámek) | C3 Step 2 — strop `UNDO_MAX_OPS` s hláškou, která odkáže na etapu D |
| §3.3 etapa B — kontrola v `resolveChainPushFromDb`, práh 5 / `MAX_RIGID_PUSH_MS`, `maxShiftMs` jako max jednoho bloku | B1, B2 |
| §3.3 pět volajících míst | B2 Step 6 (+ dvě reflow cesty = celkem šest routes) |
| §3.3 `CASCADE_CONFIRM` v `AppErrorCode` i `errorStatus` | B1 Step 3 (+ test, protože `errorStatus` je switch, ne Record) |
| §3.3 režim měření, přepnutí samostatným commitem | B1 (`CASCADE_CONFIRM_ENFORCED`), B4 |
| §3.3 riziko optimistického dragu | B3 — ověřeno, že dnešní cesty do stavu při `!ok` nezapisují; proklik to hlídá |
| §3.4 etapa D — endpoint, sdílené jádro, dry-run, tlačítko v historii | D1, D2, D3 |
| §4 co se nemění (geometrie, `MAX_RIGID_PUSH_MS` u rigidních, kaskáda směn, skript zůstává, žádná migrace) | drženo v Global Constraints a D1 Step 4 |
| §6 testy všech čtyř etap | testové kroky A1, C1–C3, B1–B3, D1 |
| §7 rizika | týden měření (B4 Step 1), test dragu (B3), sdílené jádro (D1), strop Ctrl+Z (C3) |

**Odchylky od specu — všechny doložené výš u příslušné etapy:**
1. `errorStatus` je `switch`, ne `Record` → hlídá test, ne kompilátor.
2. Optimistický drag riziko nepředstavuje (ověřeno v `TimelineGrid.tsx`) → test zůstává jako pojistka.
3. `CascadeConfirmDialog.tsx` nevzniká — stačí sdílený `ConfirmDialog`.
4. Navíc proti specu: **strop `UNDO_MAX_OPS`** (velký přepočet stroje by Ctrl+Z stejně odmítl 400) a **agregace prahu přes celou batch dávku** (deset kotev po třech blocích je třicet posunutých bloků).
