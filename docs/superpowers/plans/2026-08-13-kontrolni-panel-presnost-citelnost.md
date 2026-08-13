# Kontrolní panel — přesnost a čitelnost — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kontrolní panel v `/reporty` přestane hlásit legitimní provoz jako problém, začne u každého nálezu ukazovat plný seznam a vysvětlení, a jedna selhaná kontrola už neshodí zbylých sedm.

**Architecture:** Veškerá kontrolní logika zůstává v čistých funkcích v `src/lib/healthChecks.server.ts` (testovatelných bez databáze); tenká routa `src/app/api/report/health/route.ts` se nemění. Payload integritních kontrol se rozšiřuje z holých ID na typované položky s konkrétní vadnou hodnotou. UI se rozpadá na `HealthPanel` (skládačka) + dvě nové komponenty.

**Tech Stack:** Next.js 16 (App Router) · React · TypeScript · Prisma 5 · MySQL · `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-13-kontrolni-panel-presnost-citelnost-design.md`

## Global Constraints

- Odpovědi, popisky a komentáře v kódu jsou **česky**; technické identifikátory anglicky.
- Barvy a rozměry **výhradně přes CSS tokeny** z `src/app/globals.css` (`--surface`, `--border`, `--text-muted`, `--danger`, `--success`, `--warning`, `--brand`) — nikdy hex ani rgba literál (rozbíjí light mode).
- Logování **výhradně přes `logger`** (`src/lib/logger.ts`), nikdy `console.*`.
- Nové standalone komponenty jako named/default export do vlastního souboru — **nepsat inline** do `HealthPanel.tsx`.
- Panel zůstává **read-only**. Žádná mutační cesta, žádné mazání dat, žádná migrace.
- Seznam porovnávaných polí v kontrole rozešlé skupiny pochází **výhradně ze `SPLIT_SHARED_FIELDS`** (`src/lib/splitSharedFields.ts`) — žádná ručně psaná kopie.
- České popisky polí a formátování hodnot přes existující `FIELD_LABELS` a `fmtAuditVal` (`src/lib/auditFormatters.ts`) — **nepsat druhý formátovač**.
- Časy v textech přes `formatPragueTime` / `formatPragueDateTime` (`src/lib/dateUtils.ts`).

**NEspouštět `npm run build` ani nový dev server.** Na Macu běží Vojtovy instance na portech
3000 a 3111 a sdílejí složku `.next` — build i další dev server by je rozhodily. Typovou
správnost ověřuj **výhradně** přes `npx tsc --noEmit`. Vizuální kontrola proběhne až na
závěr na Vojtově běžící instanci, ne zakládáním další.

**Commitovat jen vyjmenované soubory** (`git add <cesta>`), nikdy `git add -A` ani `git add .`
— v pracovním stromu jsou rozdělané změny z paralelní session (`PlannerPage.tsx`,
`src/lib/keyboardShortcuts.ts`, `docs/POUCENI.md`). Těch se **nedotýkat**.

**Testy — příkazy:**

```bash
# jeden soubor (rychlá smyčka během práce)
node --test --import tsx src/lib/healthChecks.server.test.ts

# celá suite (před commitem posledního tasku)
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts

# typová kontrola
npx tsc --noEmit
```

## File Structure

| Soubor | Odpovědnost | Stav |
| --- | --- | --- |
| `src/lib/healthChecks.server.ts` | všechny kontroly jako čisté funkce + agregátor `runHealthChecks` | upravit |
| `src/lib/healthChecks.server.test.ts` | testy čistých funkcí | upravit |
| `src/lib/healthSummary.ts` | čistý výpočet souhrnu (kolik problémů / kolik kontrol s nálezem / kolik nespočtených) | **nový** |
| `src/lib/healthSummary.test.ts` | testy souhrnu | **nový** |
| `src/lib/healthCheckCopy.ts` | texty „co to znamená / co s tím" — jediný zdroj pravdy | **nový** |
| `src/app/reporty/_components/CheckExplainer.tsx` | vykreslení dvojice vět nad tabulkou | **nový** |
| `src/app/reporty/_components/IntegrityRow.tsx` | jeden integritní řádek: stav, rozbalení, vysvětlivka, tabulka nálezů | **nový** |
| `src/app/reporty/_components/HealthPanel.tsx` | skládačka: souhrn + 5 karet, třetí stav „nespočteno" | upravit |
| `src/app/reporty/_components/useHealthData.ts` | typy payloadu + napojení na `healthSummary` | upravit |

`src/app/api/report/health/route.ts` se **nemění**.

---

### Task 1: Zrušit čtyři kontroly, které lžou nebo nemohou vystřelit

**Files:**
- Modify: `src/lib/healthChecks.server.ts:16-30` (typ `BlockRow`), `:53` (`IntegrityIssue`), `:112-171` (`IntegrityRefs` + `computeIntegrityIssues`), `:223-249` (`BLOCK_SELECT` + načítání)
- Test: `src/lib/healthChecks.server.test.ts:7-14, 61-68, 86-94, 140-145`

**Interfaces:**
- Consumes: nic (první task)
- Produces: `IntegrityRefs = { jobPresetIds: Set<number> }`; `BlockRow` bez polí `splitGroupId` / `reservationId` / `recurrenceParentId`; `computeIntegrityIssues(blocks: BlockRow[], refs: IntegrityRefs): IntegrityIssue[]` vracející 7 kontrol.

**Kontext:** Tři kontroly osiřelých vazeb nemohou vystřelit — brání tomu cizí klíče `Block_splitGroupId_fkey`, `Block_reservationId_fkey`, `Block_recurrenceParentId_fkey` (ověřeno nad ostrou DB). Čtvrtá, `undersizedSplitGroup`, hlásí legitimní akci plánovače (rozdělení zakázky + smazání jedné půlky) — na produkci 10 nálezů, žádný z nich vada.

- [ ] **Step 1: Upravit testy tak, aby zrušené kontroly už neočekávaly**

V `src/lib/healthChecks.server.test.ts` **smazat celé dva testy**: `"integrity: osiřelý splitGroup / reservation / recurrenceParent"` (řádky 86–94) a `"integrity: split-skupina < 2 bloky (1 člen i prázdná skupina)"` (řádky 140–145).

Dále nahradit pomocník `blk` (řádky 7–14):

```typescript
function blk(o: Partial<BlockRow> & Pick<BlockRow, "id" | "startTime" | "endTime">): BlockRow {
  return {
    orderNumber: `Z-${o.id}`, machine: "XL_105", type: "ZAKAZKA",
    printMinutes: 120, printCompletedAt: null, printCompletedByUserId: null,
    jobPresetId: null,
    ...o,
  };
}
```

a pomocník `refs` (řádky 61–68):

```typescript
function refs(o: Partial<IntegrityRefs> = {}): IntegrityRefs {
  return { jobPresetIds: o.jobPresetIds ?? new Set<number>() };
}
```

V testu `"integrity: osiřelý jobPreset se hlásí, platný ne"` odstranit z volání `refs({...})` argument `blockIds` — zůstane `refs({ jobPresetIds: new Set([5]) })`. Totéž ve zbylých čtyřech integritních testech: `refs({ blockIds: ... })` → `refs()`.

Nakonec přidat nový test, který zrušení hlídá:

```typescript
test("integrity: zrušené kontroly už v rozpadu nejsou", () => {
  const b = blk({ id: 1, startTime: OK_START, endTime: OK_END });
  const keys = computeIntegrityIssues([b], refs()).map((i) => i.key);
  for (const gone of ["orphanSplitGroup", "orphanReservation", "orphanRecurrenceParent", "undersizedSplitGroup"]) {
    assert.equal(keys.includes(gone), false, `kontrola ${gone} měla být zrušena`);
  }
  assert.equal(keys.length, 7);
});
```

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL — nový test hlásí, že `keys.length` je 11 a zrušené klíče jsou stále přítomné; typová chyba u `blk`/`refs` se projeví až v kroku 5.

- [ ] **Step 3: Zúžit `BlockRow` a `BLOCK_SELECT`**

V `src/lib/healthChecks.server.ts` nahradit typ `BlockRow` (řádky 16–30):

```typescript
export type BlockRow = {
  id: number;
  orderNumber: string;
  machine: string;
  type: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
  printCompletedAt: Date | null;
  printCompletedByUserId: number | null;
  jobPresetId: number | null;
};
```

a `BLOCK_SELECT` (řádky 223–227):

```typescript
const BLOCK_SELECT = {
  id: true, orderNumber: true, machine: true, type: true, startTime: true, endTime: true,
  printMinutes: true, printCompletedAt: true, printCompletedByUserId: true, jobPresetId: true,
} as const;
```

- [ ] **Step 4: Odstranit čtyři kontroly a zúžit `IntegrityRefs`**

Nahradit blok od `export type IntegrityRefs` po konec `computeIntegrityIssues` (řádky 112–171):

```typescript
export type IntegrityRefs = {
  jobPresetIds: Set<number>;
};

/**
 * Neplatné hodnoty a osiřelý preset. Čistá funkce nad načtenými bloky.
 *
 * Osiřelou split-skupinu / rezervaci / rodiče opakování zde ZÁMĚRNĚ nehlídáme —
 * všechny tři sloupce mají cizí klíč (`Block_splitGroupId_fkey`,
 * `Block_reservationId_fkey`, `Block_recurrenceParentId_fkey`), takže takový stav
 * MySQL nedovolí vzniknout. Co garantuje databáze, nemá smysl kontrolovat aplikací.
 * `jobPresetId` cizí klíč NEMÁ, proto zůstává.
 *
 * Podměrečná split-skupina se nehlásí taky záměrně: vzniká legitimní akcí plánovače
 * (rozdělení zakázky a smazání jedné půlky), nic nerozbíjí — všichni konzumenti
 * `splitGroupId` se ptají na počet sourozenců, ne na existenci skupiny — a z aplikace
 * se s ní nedá nic udělat. Ověřeno nad ostrou DB 13. 8. 2026, viz spec.
 * Skutečné riziko split-skupin hlídá `computeSplitDivergence`.
 */
export function computeIntegrityIssues(blocks: BlockRow[], refs: IntegrityRefs): IntegrityIssue[] {
  const machines = MACHINES as readonly string[];
  const issues: IntegrityIssue[] = [];
  const add = (key: string, label: string, hits: BlockRow[]) => {
    issues.push({ key, label, count: hits.length, sampleBlockIds: hits.slice(0, MAX_ITEMS).map((b) => b.id) });
  };

  add("orphanJobPreset", "Osiřelý jobPreset (blok odkazuje na smazaný preset)",
    blocks.filter((b) => b.jobPresetId != null && !refs.jobPresetIds.has(b.jobPresetId)));
  add("invalidMachine", "Neplatný stroj",
    blocks.filter((b) => !machines.includes(b.machine)));
  add("invalidType", "Neplatný typ bloku",
    blocks.filter((b) => !VALID_TYPES.includes(b.type)));
  add("negativeInterval", "Konec ≤ začátek (nelogický interval)",
    blocks.filter((b) => b.endTime.getTime() <= b.startTime.getTime()));
  add("badPrintMinutes", "Vadné printMinutes (ZAKÁZKA)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.printMinutes != null &&
      (b.printMinutes <= 0 || b.printMinutes > MAX_PRINT_MINUTES || b.printMinutes % 30 !== 0)));
  add("unalignedStart", "Nezarovnaný start (mimo 30min mřížku)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.startTime.getTime() % SLOT_MS !== 0));
  add("inconsistentPrintCompleted", "Nekonzistentní dokončení tisku (jen jeden ze dvou údajů)",
    blocks.filter((b) => (b.printCompletedAt == null) !== (b.printCompletedByUserId == null)));

  return issues;
}
```

- [ ] **Step 5: Odstranit nepotřebné dotazy v `runHealthChecks`**

V `runHealthChecks` nahradit načtení a sestavení `refs` (řádky 235–249):

```typescript
  const [allBlocks, jobPresets, attachmentRows] = await Promise.all([
    db.block.findMany({ select: BLOCK_SELECT }),
    db.jobPreset.findMany({ select: { id: true } }),
    db.reservationAttachment.findMany({ select: { id: true, reservationId: true, originalName: true, storageKey: true } }),
  ]);

  const blocks = allBlocks as BlockRow[];
  const refs: IntegrityRefs = { jobPresetIds: new Set(jobPresets.map((p) => p.id)) };
```

- [ ] **Step 6: Spustit testy a typovou kontrolu**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS (všechny testy zelené)

Run: `npx tsc --noEmit`
Expected: bez chyb

- [ ] **Step 7: Commit**

```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts
git commit -m "fix(health): zrušeny 4 kontroly, které lžou nebo nemohou vystřelit

Tři kontroly osiřelých vazeb garantuje cizí klíč (ověřeno nad ostrou
DB), čtvrtá hlásila legitimní akci plánovače jako problém. Rozpad
integrity se zkracuje z 11 na 7 řádků; IntegrityRefs zůstává jen
jobPresetIds a BLOCK_SELECT tři nepotřebné sloupce už nečte."
```

---

### Task 2: Bohatší payload — `IntegrityItem` místo holých ID

**Files:**
- Modify: `src/lib/healthChecks.server.ts` (typ `IntegrityIssue`, `computeIntegrityIssues`, importy)
- Modify: `src/app/reporty/_components/useHealthData.ts:9` (typ)
- Modify: `src/app/reporty/_components/HealthPanel.tsx:185` (jediné použití `sampleBlockIds`)
- Test: `src/lib/healthChecks.server.test.ts`

**Interfaces:**
- Consumes: `computeIntegrityIssues(blocks, refs)` z Tasku 1
- Produces:
  ```typescript
  export type IntegrityItem = {
    id: number; orderNumber: string; machine: string; type: string; startTime: Date; detail: string;
  };
  export type IntegrityIssue = { key: string; label: string; count: number; items: IntegrityItem[] };
  ```
  `machine` je **hotový zobrazovací text** (`machineLabel` už aplikován), aby UI nemuselo nic dopočítávat a aby u rozešlé skupiny (Task 3) mohlo stát „XL 105 + XL 106".

**Kontext:** Server dnes posílá až 50 `sampleBlockIds`, `HealthPanel.tsx:185` použije `[0]` a zbytek zahodí. Ostatní čtyři karty mají plné tabulky; integrita ne.

- [ ] **Step 1: Napsat failující testy na `detail`**

Do `src/lib/healthChecks.server.test.ts` přidat (a v existujících integritních testech nahradit `it.sampleBlockIds` za `it.items.map((x) => x.id)`):

```typescript
test("integrity: item nese číslo zakázky, stroj jako popisek a konkrétní vadnou hodnotu", () => {
  const odd = blk({ id: 1, orderNumber: "18447", machine: "XL_105", startTime: OK_START, endTime: OK_END, printMinutes: 45 });
  const it = issue(computeIntegrityIssues([odd], refs()), "badPrintMinutes");
  assert.equal(it.count, 1);
  assert.equal(it.items[0].id, 1);
  assert.equal(it.items[0].orderNumber, "18447");
  assert.equal(it.items[0].machine, "XL 105");
  assert.equal(it.items[0].detail, "45 min");
});

test("integrity: detail nezarovnaného startu ukazuje pražský čas", () => {
  const zak = blk({ id: 1, startTime: D("2026-08-03T06:17:00Z"), endTime: OK_END });
  const it = issue(computeIntegrityIssues([zak], refs()), "unalignedStart");
  assert.equal(it.items[0].detail, "start 08:17");
});

test("integrity: detail nelogického intervalu ukazuje obě strany", () => {
  const bad = blk({ id: 1, startTime: D("2026-08-03T08:00:00Z"), endTime: D("2026-08-03T06:00:00Z") });
  const it = issue(computeIntegrityIssues([bad], refs()), "negativeInterval");
  assert.equal(it.items[0].detail, "konec 08:00 ≤ začátek 10:00");
});

test("integrity: detail osiřelého presetu jmenuje chybějící id", () => {
  const orphan = blk({ id: 1, startTime: OK_START, endTime: OK_END, jobPresetId: 99 });
  const it = issue(computeIntegrityIssues([orphan], refs()), "orphanJobPreset");
  assert.equal(it.items[0].detail, "preset #99 neexistuje");
});

test("integrity: detail nekonzistentního dokončení rozlišuje obě strany XOR", () => {
  const onlyAt = blk({ id: 1, startTime: OK_START, endTime: OK_END, printCompletedAt: D("2026-08-04T00:00:00Z") });
  const onlyUser = blk({ id: 2, startTime: OK_START, endTime: OK_END, printCompletedByUserId: 7 });
  const it = issue(computeIntegrityIssues([onlyAt, onlyUser], refs()), "inconsistentPrintCompleted");
  assert.equal(it.items[0].detail, "čas dokončení bez uživatele");
  assert.equal(it.items[1].detail, "uživatel bez času dokončení");
});

test("integrity: items respektují strop, count nese skutečný počet", () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    blk({ id: i + 1, startTime: OK_START, endTime: OK_END, printMinutes: 45 }));
  const it = issue(computeIntegrityIssues(many, refs()), "badPrintMinutes");
  assert.equal(it.count, 60);
  assert.equal(it.items.length, 50);
});
```

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL — `it.items` je `undefined`

- [ ] **Step 3: Změnit typ a `add` na položky s detailem**

V `src/lib/healthChecks.server.ts` doplnit importy nahoru k ostatním:

```typescript
import { MACHINES, machineLabel } from "@/lib/machines";
import { formatPragueTime } from "@/lib/dateUtils";
```

(řádek `import { MACHINES } from "@/lib/machines";` nahradit tím prvním)

Nahradit typ `IntegrityIssue` (řádek 53):

```typescript
export type IntegrityItem = {
  id: number;
  orderNumber: string;
  /** Hotový zobrazovací text stroje — UI nic nedopočítává. */
  machine: string;
  type: string;
  startTime: Date;
  /** Konkrétní vadná hodnota, česky. Bez ní je nález nedohledatelný. */
  detail: string;
};
export type IntegrityIssue = { key: string; label: string; count: number; items: IntegrityItem[] };
```

Nad `computeIntegrityIssues` přidat převodník a v těle nahradit `add`:

```typescript
function toItem(b: BlockRow, detail: string): IntegrityItem {
  return {
    id: b.id, orderNumber: b.orderNumber, machine: machineLabel(b.machine),
    type: b.type, startTime: b.startTime, detail,
  };
}
```

```typescript
  const add = (key: string, label: string, hits: BlockRow[], detail: (b: BlockRow) => string) => {
    issues.push({
      key, label, count: hits.length,
      items: hits.slice(0, MAX_ITEMS).map((b) => toItem(b, detail(b))),
    });
  };
```

- [ ] **Step 4: Doplnit `detail` ke všem sedmi voláním `add`**

```typescript
  add("orphanJobPreset", "Osiřelý jobPreset (blok odkazuje na smazaný preset)",
    blocks.filter((b) => b.jobPresetId != null && !refs.jobPresetIds.has(b.jobPresetId)),
    (b) => `preset #${b.jobPresetId} neexistuje`);
  add("invalidMachine", "Neplatný stroj",
    blocks.filter((b) => !machines.includes(b.machine)),
    (b) => `stroj „${b.machine}"`);
  add("invalidType", "Neplatný typ bloku",
    blocks.filter((b) => !VALID_TYPES.includes(b.type)),
    (b) => `typ „${b.type}"`);
  add("negativeInterval", "Konec ≤ začátek (nelogický interval)",
    blocks.filter((b) => b.endTime.getTime() <= b.startTime.getTime()),
    (b) => `konec ${formatPragueTime(b.endTime)} ≤ začátek ${formatPragueTime(b.startTime)}`);
  add("badPrintMinutes", "Vadné printMinutes (ZAKÁZKA)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.printMinutes != null &&
      (b.printMinutes <= 0 || b.printMinutes > MAX_PRINT_MINUTES || b.printMinutes % 30 !== 0)),
    (b) => `${b.printMinutes} min`);
  add("unalignedStart", "Nezarovnaný start (mimo 30min mřížku)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.startTime.getTime() % SLOT_MS !== 0),
    (b) => `start ${formatPragueTime(b.startTime)}`);
  add("inconsistentPrintCompleted", "Nekonzistentní dokončení tisku (jen jeden ze dvou údajů)",
    blocks.filter((b) => (b.printCompletedAt == null) !== (b.printCompletedByUserId == null)),
    (b) => (b.printCompletedAt != null ? "čas dokončení bez uživatele" : "uživatel bez času dokončení"));
```

- [ ] **Step 5: Srovnat klienta, aby projekt přeložil**

V `src/app/reporty/_components/useHealthData.ts` nahradit řádek 9:

```typescript
export type IntegrityItem = { id: number; orderNumber: string; machine: string; type: string; startTime: string; detail: string };
export type IntegrityIssue = { key: string; label: string; count: number; items: IntegrityItem[] };
```

V `src/app/reporty/_components/HealthPanel.tsx` nahradit na řádku 185 výraz `it.sampleBlockIds[0] != null && <a href={jumpHref(it.sampleBlockIds[0])}` za:

```tsx
                      {it.count > 0 && it.items[0] != null && <a href={jumpHref(it.items[0].id)} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>Otevřít první →</a>}
```

(Plný seznam přijde v Tasku 6; teď jde jen o to, aby projekt přeložil a nic se cestou nerozbilo.)

- [ ] **Step 6: Spustit testy a typovou kontrolu**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: bez chyb

- [ ] **Step 7: Commit**

```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts src/app/reporty/_components/useHealthData.ts src/app/reporty/_components/HealthPanel.tsx
git commit -m "feat(health): integritní nález nese číslo zakázky, stroj a vadnou hodnotu

sampleBlockIds nahrazeno typovaným IntegrityItem s polem detail
(\"45 min\", \"start 08:17\", \"preset #99 neexistuje\"). Bez konkrétní
hodnoty byl nález nedohledatelný. UI zatím dál ukazuje jen první
položku — plný seznam přijde s IntegrityRow."
```

---

### Task 3: Nová kontrola — rozešlá split-skupina

**Files:**
- Modify: `src/lib/healthChecks.server.ts` (nová čistá funkce + napojení v `runHealthChecks`)
- Test: `src/lib/healthChecks.server.test.ts`

**Interfaces:**
- Consumes: `IntegrityItem`, `IntegrityIssue`, `MAX_ITEMS`, `toItem` z Tasku 2
- Produces:
  ```typescript
  export type SplitSharedRow = Record<string, unknown> & {
    id: number; machine: string; orderNumber: string; type: string; startTime: Date; splitGroupId: number;
  };
  export function computeSplitDivergence(rows: SplitSharedRow[]): IntegrityIssue;
  ```
  Klíč nálezu: `"splitFieldsDiverged"`. Jednotka = **skupina**, ne blok.

**Kontext:** Členové split-skupiny mají sdílet 31 polí ze `SPLIT_SHARED_FIELDS`. Když se některé rozejde, dvě části téže zakázky se navenek tváří jako různá práce. CLAUDE.md tuhle třídu vad vede jako Critical nález go/no-go auditu z 5. 8. 2026, ale nehlídá ji nic. Ověřeno nad ostrou DB: 8 nálezů, všechny legacy z doby před atomickým `/split` (13. 7. 2026), všechny opravitelné otevřením a uložením kterékoli části.

- [ ] **Step 1: Napsat failující testy**

Do `src/lib/healthChecks.server.test.ts` doplnit import a novou sekci:

```typescript
import { computeSplitDivergence, type SplitSharedRow } from "./healthChecks.server";
import { SPLIT_SHARED_FIELDS } from "./splitSharedFields";
import { FIELD_LABELS } from "./auditFormatters";
```

```typescript
// ── Rozešlá split-skupina ───────────────────────────────────────────────────
function srow(o: Partial<SplitSharedRow> & Pick<SplitSharedRow, "id" | "splitGroupId">): SplitSharedRow {
  // Všechna sdílená pole nejdřív na null, pak přebijeme těmi, na kterých testu záleží.
  // Pořadí je podstatné: `orderNumber` a `type` jsou SOUČÁSTÍ SPLIT_SHARED_FIELDS,
  // takže musí přijít až za rozbalením základu, jinak by zůstaly null.
  const base: Record<string, unknown> = {};
  for (const f of SPLIT_SHARED_FIELDS) base[f] = null;
  return {
    ...base,
    machine: "XL_105",
    orderNumber: "18447",
    type: "ZAKAZKA",
    startTime: OK_START,
    ...o,
  } as SplitSharedRow;
}

test("divergence: shodná skupina → žádný nález", () => {
  const rows = [srow({ id: 1, splitGroupId: 7 }), srow({ id: 2, splitGroupId: 7 })];
  assert.equal(computeSplitDivergence(rows).count, 0);
});

test("divergence: jednočlenná skupina se přeskakuje", () => {
  const rows = [srow({ id: 1, splitGroupId: 7, materialInStock: true })];
  assert.equal(computeSplitDivergence(rows).count, 0);
});

test("divergence: null proti hodnotě je rozdíl (sentinel funguje)", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, jobPresetLabel: "XL 106 LED" }),
    srow({ id: 2, splitGroupId: 7, jobPresetLabel: null }),
  ];
  const res = computeSplitDivergence(rows);
  assert.equal(res.count, 1);
  assert.match(res.items[0].detail, /Preset/);
  assert.match(res.items[0].detail, /1 = XL 106 LED/);
  assert.match(res.items[0].detail, /2 = —/);
});

test("divergence: dvě Date instance se stejným časem NEJSOU rozdíl", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, deadlineExpedice: new Date("2026-09-01T00:00:00Z") }),
    srow({ id: 2, splitGroupId: 7, deadlineExpedice: new Date("2026-09-01T00:00:00Z") }),
  ];
  assert.equal(computeSplitDivergence(rows).count, 0);
});

test("divergence: item nese skupinu, oba stroje a odkaz na první blok", () => {
  const rows = [
    srow({ id: 11, splitGroupId: 7, machine: "XL_105", materialInStock: true }),
    srow({ id: 12, splitGroupId: 7, machine: "XL_106", materialInStock: false }),
  ];
  const res = computeSplitDivergence(rows);
  assert.equal(res.count, 1);
  assert.equal(res.items[0].id, 11);
  assert.equal(res.items[0].orderNumber, "18447");
  assert.equal(res.items[0].machine, "XL 105 + XL 106");
});

test("divergence: víc rozešlých polí se v detailu spojí", () => {
  const rows = [
    srow({ id: 1, splitGroupId: 7, materialInStock: true, pantoneOk: true }),
    srow({ id: 2, splitGroupId: 7, materialInStock: false, pantoneOk: false }),
  ];
  const detail = computeSplitDivergence(rows).items[0].detail;
  assert.match(detail, /Materiál skladem/);
  assert.match(detail, /Pantone OK/);
  assert.equal(detail.includes(" · "), true);
});

test("divergence: strážný test — hlídá se KAŽDÉ pole ze SPLIT_SHARED_FIELDS", () => {
  for (const field of SPLIT_SHARED_FIELDS) {
    const a = srow({ id: 1, splitGroupId: 7 });
    const b = srow({ id: 2, splitGroupId: 7 });
    (a as Record<string, unknown>)[field] = "A";
    (b as Record<string, unknown>)[field] = "B";
    assert.equal(computeSplitDivergence([a, b]).count, 1, `pole ${field} se nehlídá`);
  }
});

test("divergence: strážný test — každé sdílené pole má český popisek", () => {
  for (const field of SPLIT_SHARED_FIELDS) {
    assert.ok(field in FIELD_LABELS, `pole ${field} nemá popisek ve FIELD_LABELS`);
  }
});
```

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL — `computeSplitDivergence is not a function`

- [ ] **Step 3: Implementovat čistou funkci**

Do `src/lib/healthChecks.server.ts` doplnit importy:

```typescript
import { SPLIT_SHARED_FIELDS } from "@/lib/splitSharedFields";
import { FIELD_LABELS, fmtAuditVal } from "@/lib/auditFormatters";
import type { Prisma } from "@prisma/client";
```

a za `computeIntegrityIssues` přidat:

```typescript
// ── Rozešlá split-skupina ────────────────────────────────────────────────────
export type SplitSharedRow = Record<string, unknown> & {
  id: number;
  machine: string;
  orderNumber: string;
  type: string;
  startTime: Date;
  splitGroupId: number;
};

/** Sentinel pro chybějící hodnotu — odlišuje NULL od prázdného řetězce. */
const NULL_SENTINEL = "\u0000null";

/** Kanonický tvar hodnoty pro porovnání napříč členy skupiny. */
function normalizeShared(v: unknown): string {
  if (v === null || v === undefined) return NULL_SENTINEL;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Tvar, kterému rozumí `fmtAuditVal` (bere `string | null`). */
function toAuditString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Členové jedné split-skupiny mají sdílet všech 31 polí ze `SPLIT_SHARED_FIELDS`.
 * Když se některé rozejde, dvě části téže zakázky se navenek tváří jako různá práce
 * (jedna půlka „materiál skladem", druhá ne). CLAUDE.md tuhle třídu vad vede jako
 * Critical nález go/no-go auditu 5. 8. 2026 — dosud ji nehlídalo nic.
 *
 * Seznam polí se ZÁMĚRNĚ bere ze `SPLIT_SHARED_FIELDS`, ne z ručně psané kopie:
 * nové sdílené pole se tak začne hlídat samo. Hlídá to i strážný test.
 *
 * Jednotka nálezu je SKUPINA, ne blok — opravuje se skupina jako celek.
 * Čistá funkce.
 */
export function computeSplitDivergence(rows: SplitSharedRow[]): IntegrityIssue {
  const byGroup = new Map<number, SplitSharedRow[]>();
  for (const r of rows) {
    const arr = byGroup.get(r.splitGroupId) ?? [];
    arr.push(r);
    byGroup.set(r.splitGroupId, arr);
  }

  const items: IntegrityItem[] = [];
  let count = 0;
  const groupIds = [...byGroup.keys()].sort((a, b) => a - b);

  for (const gid of groupIds) {
    const members = byGroup.get(gid)!;
    if (members.length < 2) continue; // není co porovnávat

    const divergedFields = SPLIT_SHARED_FIELDS.filter((field) => {
      const distinct = new Set(members.map((m) => normalizeShared(m[field])));
      return distinct.size > 1;
    });
    if (divergedFields.length === 0) continue;

    count++;
    if (items.length >= MAX_ITEMS) continue;

    const sorted = [...members].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const detail = divergedFields
      .map((field) => {
        const label = FIELD_LABELS[field] ?? field;
        const values = sorted
          .map((m) => `${m.id} = ${fmtAuditVal(toAuditString(m[field]), field)}`)
          .join(", ");
        return `${label}: ${values}`;
      })
      .join(" · ");

    const machines = [...new Set(sorted.map((m) => machineLabel(m.machine)))].join(" + ");
    const head = sorted[0]!;
    items.push({
      id: head.id,
      orderNumber: head.orderNumber,
      machine: machines,
      type: head.type,
      startTime: head.startTime,
      detail,
    });
  }

  return { key: "splitFieldsDiverged", label: "Rozešlá split-skupina (části mají různé údaje)", count, items };
}
```

- [ ] **Step 4: Spustit testy a ověřit, že projdou**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS

- [ ] **Step 5: Napojit kontrolu do `runHealthChecks`**

V `runHealthChecks` přidat načtení split řádků a připojení nálezu k rozpadu. Nad `runHealthChecks` doplnit:

```typescript
/**
 * Select pro kontrolu rozešlé skupiny. Skládá se ZE `SPLIT_SHARED_FIELDS`, ne z ručně
 * psaného seznamu — nové sdílené pole se tak začne číst samo. Kdyby produkční schéma
 * některý sloupec nemělo, Prisma spadne hlasitě (P2022), ne tiše.
 */
const SPLIT_SELECT = Object.fromEntries(
  [...SPLIT_SHARED_FIELDS, "id", "machine", "startTime", "splitGroupId"].map((f) => [f, true]),
) as Prisma.BlockSelect;
```

V těle `runHealthChecks` za načtení `allBlocks` doplnit:

```typescript
  const splitRows = (await db.block.findMany({
    where: { splitGroupId: { not: null } },
    select: SPLIT_SELECT,
  })) as unknown as SplitSharedRow[];
```

a řádek `const integrity = computeIntegrityIssues(blocks, refs);` nahradit:

```typescript
  const integrity = [...computeIntegrityIssues(blocks, refs), computeSplitDivergence(splitRows)];
```

- [ ] **Step 6: Ověřit typy a proti dev databázi**

Run: `npx tsc --noEmit`
Expected: bez chyb

Run:
```bash
npx tsx -e '
import { PrismaClient } from "@prisma/client";
import { runHealthChecks } from "./src/lib/healthChecks.server";
const p = new PrismaClient();
(async () => {
  const r = await runHealthChecks(p as never, new Date());
  for (const i of r.checks.integrity.breakdown) console.log(String(i.count).padStart(4), i.key);
  await p.$disconnect();
})();'
```
Expected: 8 řádků, mezi nimi `splitFieldsDiverged`; zrušené klíče chybí.

- [ ] **Step 7: Commit**

```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts
git commit -m "feat(health): kontrola rozešlé split-skupiny

Porovná 31 polí ze SPLIT_SHARED_FIELDS napříč členy každé skupiny a
nahlásí, kde se rozešla — včetně toho, které pole a jaké hodnoty mají
jednotliví členové. Třída vad, kterou CLAUDE.md vede jako Critical
nález go/no-go auditu 5. 8. 2026, ale dosud ji nehlídalo nic.

Seznam polí se bere ze SPLIT_SHARED_FIELDS, ne z kopie; strážný test
projde obor hodnot a shodí se, když nové sdílené pole zůstane
nepokryté. České popisky přes FIELD_LABELS/fmtAuditVal."
```

---

### Task 4: Selhání jedné kontroly neshodí zbylých sedm

**Files:**
- Modify: `src/lib/healthChecks.server.ts` (`HealthResult`, `runHealthChecks`, import `logger`)
- Modify: `src/app/reporty/_components/useHealthData.ts` (typy)
- Test: `src/lib/healthChecks.server.test.ts`

**Interfaces:**
- Consumes: vše z Tasků 1–3
- Produces:
  ```typescript
  export type HealthResult = {
    checkedAt: string;
    checks: {
      overlaps: { count: number | null; items: OverlapPair[]; error?: string };
      drift: { count: number | null; items: DriftItem[]; error?: string };
      outsideHours: { count: number | null; items: DriftItem[]; error?: string };
      integrity: { count: number | null; breakdown: IntegrityIssue[]; error?: string };
      attachments: { count: number | null; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[]; error?: string };
    };
  };
  ```
  `IntegrityIssue.count` je nově `number | null` a přibývá `error?: string`.
  Pomocník: `attempt<T>(label: string, fn: () => Promise<T>): Promise<{ value: T | null; error?: string }>`

**Kontext:** Dnes stačí jedna výjimka a endpoint vrátí 500 — panel ukáže „Chyba kontroly" a sedm zdravých kontrol je taky pryč. U nástroje, který má odhalovat tiché vady, je to nejhorší možné chování. Reálný spouštěč existuje: produkce nemá sloupce `pantoneInStock` / `pantoneIssued`, dokud tam nepojede migrace `20260811120000`.

- [ ] **Step 1: Napsat failující test**

```typescript
test("attempt: selhání jedné kontroly nezhatí ostatní", async () => {
  const ok = await attempt("dobrá", async () => 42);
  assert.equal(ok.value, 42);
  assert.equal(ok.error, undefined);

  const bad = await attempt("špatná", async () => { throw new Error("Unknown column 'pantoneInStock'"); });
  assert.equal(bad.value, null);
  assert.equal(bad.error, "Unknown column 'pantoneInStock'");
});

test("attempt: výjimka bez Error dostane náhradní text", async () => {
  const bad = await attempt("divná", async () => { throw "boom"; });
  assert.equal(bad.value, null);
  assert.equal(bad.error, "neznámá chyba");
});
```

Do importu z `./healthChecks.server` přidat `attempt`.

- [ ] **Step 2: Spustit testy a ověřit, že selžou**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL — `attempt is not a function`

- [ ] **Step 3: Implementovat pomocník**

Do `src/lib/healthChecks.server.ts` doplnit import `import { logger } from "@/lib/logger";` a přidat:

```typescript
/**
 * Spustí jednu kontrolu izolovaně. Při výjimce vrátí `null` a text chyby, takže
 * ostatní kontroly doběhnou a zobrazí se. Bez tohohle by jedna rozbitá kontrola
 * (typicky sloupec, který produkce ještě nemá) shodila celý panel na 500 —
 * u nástroje, který má odhalovat tiché vady, je to nejhorší možné chování.
 */
export async function attempt<T>(label: string, fn: () => Promise<T>): Promise<{ value: T | null; error?: string }> {
  try {
    return { value: await fn() };
  } catch (err) {
    logger.error(`[health] kontrola ${label} selhala`, err);
    return { value: null, error: err instanceof Error ? err.message : "neznámá chyba" };
  }
}
```

- [ ] **Step 4: Rozšířit typy o `null` a `error`**

Nahradit `HealthResult` (řádky 58–67) tvarem z bloku **Interfaces** výše a v typu `IntegrityIssue` změnit `count: number` na `count: number | null` a doplnit `error?: string`.

- [ ] **Step 5: Přepsat `runHealthChecks` na izolované kontroly**

```typescript
export async function runHealthChecks(db: typeof prisma, now: Date): Promise<HealthResult> {
  const [allBlocks, jobPresets, attachmentRows] = await Promise.all([
    db.block.findMany({ select: BLOCK_SELECT }),
    db.jobPreset.findMany({ select: { id: true } }),
    db.reservationAttachment.findMany({ select: { id: true, reservationId: true, originalName: true, storageKey: true } }),
  ]);

  const blocks = allBlocks as BlockRow[];
  const refs: IntegrityRefs = { jobPresetIds: new Set(jobPresets.map((p) => p.id)) };

  const driftR = await attempt("drift", async () => bucketDrift(await detectCalendarDrift(
    db, [...MACHINES], now, new Date(now.getTime() + DRIFT_HORIZON_DAYS * DAY_MS), now,
  )));
  const overlapsR = await attempt("overlaps", async () => computeOverlapPairs(blocks, now));
  const baseR = await attempt("integrity", async () => computeIntegrityIssues(blocks, refs));
  const divergedR = await attempt("splitFieldsDiverged", async () => computeSplitDivergence(
    (await db.block.findMany({ where: { splitGroupId: { not: null } }, select: SPLIT_SELECT })) as unknown as SplitSharedRow[],
  ));
  const attachR = await attempt("attachments", async () =>
    diffAttachmentFiles(attachmentRows, await scanAttachmentDir(ATTACHMENTS_DIR)));

  // Rozpad integrity: základní kontroly + řádek rozešlé skupiny. Když selže jen
  // ten druhý, zbytek rozpadu se pořád ukáže — jen s vlastní značkou „nespočteno".
  const breakdown: IntegrityIssue[] = [
    ...(baseR.value ?? []),
    divergedR.value ?? {
      key: "splitFieldsDiverged", label: "Rozešlá split-skupina (části mají různé údaje)",
      count: null, items: [], error: divergedR.error,
    },
  ];
  // Karta nese `error`, i když se sama spočetla — jinak by dílčí selhání zmizelo.
  const integrityError = baseR.error ?? (divergedR.error != null ? "Dílčí kontrola nespočtena." : undefined);
  const integrityCount = baseR.value == null
    ? null
    : breakdown.reduce((s, i) => s + (i.count ?? 0), 0);

  return {
    checkedAt: now.toISOString(),
    checks: {
      overlaps: { count: overlapsR.value?.length ?? null, items: (overlapsR.value ?? []).slice(0, MAX_ITEMS), error: overlapsR.error },
      drift: { count: driftR.value?.drift.length ?? null, items: (driftR.value?.drift ?? []).slice(0, MAX_ITEMS), error: driftR.error },
      outsideHours: { count: driftR.value?.outsideHours.length ?? null, items: (driftR.value?.outsideHours ?? []).slice(0, MAX_ITEMS), error: driftR.error },
      integrity: { count: integrityCount, breakdown, error: integrityError },
      attachments: {
        count: attachR.value == null ? null : attachR.value.missingFiles.length + attachR.value.orphanFiles.length,
        missingFiles: attachR.value?.missingFiles ?? [],
        orphanFiles: attachR.value?.orphanFiles ?? [],
        error: attachR.error,
      },
    },
  };
}
```

- [ ] **Step 6: Srovnat typy na klientovi**

V `src/app/reporty/_components/useHealthData.ts` nahradit typ `HealthData` a `IntegrityIssue`:

```typescript
export type IntegrityIssue = { key: string; label: string; count: number | null; items: IntegrityItem[]; error?: string };
export type HealthData = {
  checkedAt: string;
  checks: {
    overlaps: { count: number | null; items: OverlapPair[]; error?: string };
    drift: { count: number | null; items: DriftItem[]; error?: string };
    outsideHours: { count: number | null; items: DriftItem[]; error?: string };
    integrity: { count: number | null; breakdown: IntegrityIssue[]; error?: string };
    attachments: { count: number | null; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[]; error?: string };
  };
};
```

V `countFindings` dočasně ošetřit `null` (nahradí ho Task 7):

```typescript
function countFindings(data: HealthData): { total: number; badChecks: number } {
  const counts = [
    data.checks.overlaps.count, data.checks.drift.count, data.checks.outsideHours.count,
    data.checks.integrity.count, data.checks.attachments.count,
  ].map((c) => c ?? 0);
  return { total: counts.reduce((a, c) => a + c, 0), badChecks: counts.filter((c) => c > 0).length };
}
```

V `HealthPanel.tsx` u komponenty `Card` nahradit `const bad = count > 0;` za `const bad = (count ?? 0) > 0;`, upravit typ prop `count: number | null` a v pilulce `{bad ? count : "✓ 0"}`. Karty s `null` se plně dořeší v Tasku 7.

- [ ] **Step 7: Spustit testy a typovou kontrolu**

Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: bez chyb

- [ ] **Step 8: Commit**

```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts src/app/reporty/_components/useHealthData.ts src/app/reporty/_components/HealthPanel.tsx
git commit -m "feat(health): selhání jedné kontroly neshodí zbylých sedm

Každá kontrola běží izolovaně přes attempt(); selhaná dostane
count: null + error, ostatní doběhnou. Reálný spouštěč: produkce nemá
sloupce pantoneInStock/pantoneIssued, dokud tam nepojede migrace
20260811120000 — dřív by to shodilo celý panel na 500."
```

---

### Task 5: Texty „co to znamená / co s tím" + `CheckExplainer`

**Files:**
- Create: `src/lib/healthCheckCopy.ts`
- Create: `src/app/reporty/_components/CheckExplainer.tsx`
- Test: `src/lib/healthCheckCopy.test.ts`

**Interfaces:**
- Consumes: klíče kontrol z Tasků 1–3 (`overlaps`, `drift`, `outsideHours`, `integrity`, `attachments`, `orphanJobPreset`, `invalidMachine`, `invalidType`, `negativeInterval`, `badPrintMinutes`, `unalignedStart`, `inconsistentPrintCompleted`, `splitFieldsDiverged`)
- Produces:
  ```typescript
  export type CheckCopy = { znamena: string; coStim: string };
  export const HEALTH_COPY: Record<string, CheckCopy>;
  export function copyFor(key: string): CheckCopy | null;
  export default function CheckExplainer({ copyKey }: { copyKey: string }): JSX.Element | null;
  ```

**Kontext:** Vojta na produkci viděl `Split-skupina s méně než 2 bloky: 9` a nevěděl, co to znamená ani co s tím. Stejný problém má u Driftu i Příloh — proto vysvětlivky dostávají **všechny** kontroly, ne jen integrita.

- [ ] **Step 1: Napsat failující strážný test**

Vytvořit `src/lib/healthCheckCopy.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEALTH_COPY, copyFor } from "./healthCheckCopy";

const REQUIRED = [
  "overlaps", "drift", "outsideHours", "integrity", "attachments",
  "orphanJobPreset", "invalidMachine", "invalidType", "negativeInterval",
  "badPrintMinutes", "unalignedStart", "inconsistentPrintCompleted", "splitFieldsDiverged",
];

test("copy: každá kontrola má obě věty", () => {
  for (const key of REQUIRED) {
    const c = HEALTH_COPY[key];
    assert.ok(c, `chybí text pro ${key}`);
    assert.ok(c.znamena.length > 20, `${key}: „co to znamená" je příliš krátké`);
    assert.ok(c.coStim.length > 20, `${key}: „co s tím" je příliš krátké`);
  }
});

test("copy: žádný text navíc pro zrušené kontroly", () => {
  for (const gone of ["undersizedSplitGroup", "orphanSplitGroup", "orphanReservation", "orphanRecurrenceParent"]) {
    assert.equal(gone in HEALTH_COPY, false, `text pro zrušenou kontrolu ${gone}`);
  }
});

test("copyFor: neznámý klíč vrací null, ne výjimku", () => {
  assert.equal(copyFor("neexistuje"), null);
});
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `node --test --import tsx src/lib/healthCheckCopy.test.ts`
Expected: FAIL — modul `./healthCheckCopy` neexistuje

- [ ] **Step 3: Vytvořit modul s texty**

Vytvořit `src/lib/healthCheckCopy.ts`:

```typescript
/**
 * Texty „co to znamená / co s tím" pro Kontrolní panel — JEDINÝ zdroj pravdy,
 * sdílený kartami i integritními řádky. Dvě věty na kontrolu: první říká, co
 * porušení znamená provozně, druhá co s ním má člověk udělat.
 *
 * Nový klíč kontroly → nový záznam tady, jinak shodí strážný test.
 */
export type CheckCopy = { znamena: string; coStim: string };

export const HEALTH_COPY: Record<string, CheckCopy> = {
  // ── Karty ──
  overlaps: {
    znamena: "Dva bloky stojí na stejném stroji ve stejný čas. Stroj obojí naráz neutiskne, takže jeden z nich se reálně nestihne.",
    coStim: "Otevři je v plánu a jeden přetáhni jinam. Pojistka proti překryvům běží na serveru, tyhle nálezy jsou obvykle starší data nebo ruční zásah do databáze.",
  },
  drift: {
    znamena: "Někdo změnil směny nebo odstávky a uložený konec zakázky už tomu neodpovídá. Karta v plánu je jinak dlouhá, než jak se doopravdy potiskne.",
    coStim: "V plánu klikni nad strojem na „Přepočítat" — bloky se posunou na platné sloty, zamčené se přeskočí. Vědomě odložené zakázky se sem záměrně nepočítají.",
  },
  outsideHours: {
    znamena: "Zakázka začíná v čase, kdy stroj nejede — mimo směnu nebo v odstávce. Není to vědomé odložení, takže plán slibuje tisk, který nezačne.",
    coStim: "Přetáhni zakázku na běžící slot, nebo uprav pracovní dobu stroje ve Správě, pokud se má tisknout právě tehdy.",
  },
  integrity: {
    znamena: "Hodnoty v databázi, které nedávají smysl — neplatný stroj, konec před začátkem, odkaz na smazaný preset. Vznikají importem, starými daty nebo ručním zásahem.",
    coStim: "Rozbal jednotlivé řádky níž; u každého je konkrétní vadná hodnota a odkaz do plánu.",
  },
  attachments: {
    znamena: "Databáze a disk si neodpovídají: buď je v databázi příloha, jejíž soubor chybí, nebo na disku leží soubor, o kterém databáze neví.",
    coStim: "Chybějící soubor znamená ztracenou přílohu — obnov ji ze zálohy podle docs/OPS_ZALOHY.md. Osamocený soubor na disku je neškodný zbytek po smazané rezervaci.",
  },

  // ── Integritní řádky ──
  orphanJobPreset: {
    znamena: "Blok odkazuje na preset, který už neexistuje. Preset jako jediná z vazeb nemá v databázi cizí klíč, takže se to stát může.",
    coStim: "Otevři blok a vyber platný preset, nebo ho nech prázdný. Uložením se odkaz srovná.",
  },
  invalidMachine: {
    znamena: "Blok je přiřazený stroji, který v aplikaci neexistuje. V plánu se pak nevykreslí nikde a je fakticky neviditelný.",
    coStim: "Blok je nutné opravit v databázi — z aplikace se na neexistující stroj nedá dostat. Připrav zálohu a domluv zásah s IT.",
  },
  invalidType: {
    znamena: "Blok má typ mimo ZAKÁZKA / REZERVACE / ÚDRŽBA. Kód pro takový typ nemá pravidla, takže se chová nepředvídatelně.",
    coStim: "Stejně jako u neplatného stroje: oprava patří do databáze, ne do aplikace. Připrav zálohu a domluv zásah s IT.",
  },
  negativeInterval: {
    znamena: "Blok končí dřív, než začíná. Je to poškozený záznam — v plánu má zápornou výšku a do výpočtů vnáší nesmysly.",
    coStim: "Otevři blok a nastav konec znovu. Pokud nejde otevřít, patří oprava do databáze.",
  },
  badPrintMinutes: {
    znamena: "Tiskový čas není násobek 30 minut, je nulový, nebo přesahuje limit 40 hodin. Blok se pak nevejde do mřížky, na které plán stojí.",
    coStim: "Otevři zakázku a nastav délku tisku znovu — formulář nabízí jen platné hodnoty.",
  },
  unalignedStart: {
    znamena: "Zakázka začíná mimo půlhodinovou mřížku, tedy třeba v 8:17. Karta pak v plánu sedí posunutá proti ostatním a špatně se s ní pracuje.",
    coStim: "Přetáhni zakázku v plánu o kousek — pustí se na nejbližší platný slot sama.",
  },
  inconsistentPrintCompleted: {
    znamena: "U dokončeného tisku chybí jeden ze dvou údajů: buď je čas bez uživatele, nebo uživatel bez času. Nejde pak dohledat, kdo tisk odklepl.",
    coStim: "V plánu tisk vrať a znovu odklepni — zapíší se oba údaje najednou.",
  },
  splitFieldsDiverged: {
    znamena: "Části rozdělené zakázky mají mít shodné údaje (číslo zakázky, popis, deadline, stavy dat, materiálu a Pantone). Tady se rozešly, takže každá část tvrdí něco jiného.",
    coStim: "Otevři kteroukoli část a ulož ji — server správnou hodnotu rozešle na zbytek skupiny sám.",
  },
};

/** Bezpečné čtení: neznámý klíč vrátí `null`, ne výjimku. */
export function copyFor(key: string): CheckCopy | null {
  return HEALTH_COPY[key] ?? null;
}
```

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `node --test --import tsx src/lib/healthCheckCopy.test.ts`
Expected: PASS

- [ ] **Step 5: Vytvořit komponentu `CheckExplainer`**

Vytvořit `src/app/reporty/_components/CheckExplainer.tsx`:

```tsx
"use client";

import React from "react";
import { copyFor } from "@/lib/healthCheckCopy";

/**
 * Dvojice vět nad tabulkou nálezů: co porušení znamená a co s ním udělat.
 * Neznámý klíč nevykreslí nic — panel nikdy nespadne kvůli chybějícímu textu.
 */
export default function CheckExplainer({ copyKey }: { copyKey: string }) {
  const copy = copyFor(copyKey);
  if (!copy) return null;
  return (
    <div
      style={{
        background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 9,
        padding: "10px 13px", marginTop: 8, fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)",
        display: "flex", flexDirection: "column", gap: 6,
      }}
    >
      <div><strong style={{ color: "var(--text)" }}>Co to znamená:</strong> {copy.znamena}</div>
      <div><strong style={{ color: "var(--text)" }}>Co s tím:</strong> {copy.coStim}</div>
    </div>
  );
}
```

- [ ] **Step 6: Ověřit typovou kontrolou**

Run: `npx tsc --noEmit`
Expected: bez chyb

- [ ] **Step 7: Commit**

```bash
git add src/lib/healthCheckCopy.ts src/lib/healthCheckCopy.test.ts src/app/reporty/_components/CheckExplainer.tsx
git commit -m "feat(health): texty \"co to znamená / co s tím\" pro všech 13 kontrol

Jediný zdroj pravdy v healthCheckCopy.ts, sdílený kartami i
integritními řádky. Strážný test hlídá, že každá kontrola má obě věty
a že pro zrušené kontroly text nezůstal."
```

---

### Task 6: `IntegrityRow` — rozbalovací řádky s plným seznamem

**Files:**
- Create: `src/app/reporty/_components/IntegrityRow.tsx`
- Modify: `src/app/reporty/_components/HealthPanel.tsx:178-191` (karta Integrita)

**Interfaces:**
- Consumes: `IntegrityIssue` a `IntegrityItem` z `useHealthData` (Task 4), `CheckExplainer` (Task 5)
- Produces: `export default function IntegrityRow({ issue }: { issue: IntegrityIssue }): JSX.Element`

**Kontext:** Karta Integrita jako jediná z pěti nemá tabulku — ukáže počet a odkaz na první nález. Tabulka je pro všech 8 kontrol stejná, aby se nebylo co učit znovu.

- [ ] **Step 1: Vytvořit komponentu**

Vytvořit `src/app/reporty/_components/IntegrityRow.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import type { IntegrityIssue } from "./useHealthData";
import CheckExplainer from "./CheckExplainer";

const TH: React.CSSProperties = {
  textAlign: "left", fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase",
  color: "var(--text-muted)", fontWeight: 600, padding: "8px 11px",
  background: "var(--surface-2)", borderBottom: "1px solid var(--border)",
};
const TD: React.CSSProperties = {
  padding: "9px 11px", borderBottom: "1px solid var(--border)", verticalAlign: "middle", fontSize: 13,
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", {
    timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Jeden řádek rozpadu Integrity. Řádek s nálezem je klikací a rozbalí se do
 * vysvětlivky a tabulky VŠECH nálezů — dřív se z padesáti posílaných položek
 * zobrazila jedna. Nulový a nespočtený řádek se nerozbalují (není co ukázat).
 */
export default function IntegrityRow({ issue }: { issue: IntegrityIssue }) {
  const [open, setOpen] = useState(false);
  const uncomputed = issue.count === null;
  const bad = (issue.count ?? 0) > 0;
  const expandable = bad && issue.items.length > 0;

  const dotColor = uncomputed
    ? "var(--warning)"
    : bad
      ? "var(--danger)"
      : "color-mix(in oklab, var(--success) 70%, transparent)";

  return (
    <div style={{ background: "var(--surface)" }}>
      <div
        onClick={() => expandable && setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 9, padding: "9px 13px", fontSize: 13,
          cursor: expandable ? "pointer" : "default", userSelect: "none",
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: dotColor }} />
        <span>{issue.label}</span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            fontVariantNumeric: "tabular-nums", fontWeight: 700,
            color: uncomputed ? "var(--warning)" : bad ? "var(--danger)" : "var(--text-muted)",
          }}>
            {uncomputed ? "nespočteno" : issue.count}
          </span>
          {expandable && (
            <span style={{ color: "var(--text-muted)", fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
          )}
        </span>
      </div>

      {uncomputed && issue.error && (
        <div style={{ padding: "0 13px 10px 29px", fontSize: 12, color: "var(--warning)" }}>
          Kontrola se nespočetla: {issue.error}
        </div>
      )}

      {open && expandable && (
        <div style={{ padding: "0 13px 13px" }}>
          <CheckExplainer copyKey={issue.key} />
          <div style={{ overflowX: "auto", marginTop: 8, border: "1px solid var(--border)", borderRadius: 9 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={TH}>Zakázka</th>
                  <th style={TH}>Stroj</th>
                  <th style={TH}>Detail</th>
                  <th style={TH}></th>
                </tr>
              </thead>
              <tbody>
                {issue.items.map((item) => (
                  <tr key={item.id}>
                    <td style={TD}>
                      <span style={{ fontWeight: 600 }}>{item.orderNumber || `#${item.id}`}</span>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{fmtDateTime(item.startTime)}</div>
                    </td>
                    <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{item.machine}</td>
                    <td style={{ ...TD, color: "var(--text-muted)" }}>{item.detail}</td>
                    <td style={TD}>
                      <a href={`/?highlight=${item.id}`} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                        Otevřít v plánu →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issue.count !== null && issue.count > issue.items.length && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
              Zobrazeno {issue.items.length} z {issue.count} nálezů.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Napojit do karty Integrita**

V `src/app/reporty/_components/HealthPanel.tsx` doplnit import:

```tsx
import IntegrityRow from "./IntegrityRow";
```

a nahradit vnitřek karty Integrita (řádky 179–190 — `<div style={{ display: "flex", flexDirection: "column", gap: 1, …}}>` až po jeho `</div>`):

```tsx
              <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8, border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
                {data.checks.integrity.breakdown.map((it) => (
                  <IntegrityRow key={it.key} issue={it} />
                ))}
              </div>
```

- [ ] **Step 3: Ověřit typovou kontrolou**

Run: `npx tsc --noEmit`
Expected: bez chyb

**Nespouštět `npm run build` ani dev server** — viz Global Constraints. Vizuální kontrola je až na konci plánu.

- [ ] **Step 4: Commit**

```bash
git add src/app/reporty/_components/IntegrityRow.tsx src/app/reporty/_components/HealthPanel.tsx
git commit -m "feat(health): integritní řádky se rozbalují do plného seznamu

Dřív se z padesáti posílaných položek zobrazila jedna a nešlo poznat,
co nález obsahuje. Nově vysvětlivka + tabulka všech nálezů se stejnými
sloupci pro všech 8 kontrol, a přiznaný strop (\"zobrazeno 50 z 200\")."
```

---

### Task 7: `HealthPanel` — třetí stav karty a poctivý souhrn

**Files:**
- Create: `src/lib/healthSummary.ts`
- Create: `src/lib/healthSummary.test.ts`
- Modify: `src/app/reporty/_components/useHealthData.ts` (napojení na `healthSummary`)
- Modify: `src/app/reporty/_components/HealthPanel.tsx` (komponenta `Card`, souhrnný proužek, vysvětlivky u 5 karet)

**Interfaces:**
- Consumes: `HealthData` z Tasku 4, `CheckExplainer` z Tasku 5
- Produces:
  ```typescript
  export type HealthSummary = { total: number; badChecks: number; uncomputed: number };
  export function summarizeHealth(counts: { count: number | null; error?: string }[]): HealthSummary;
  ```
  `useHealthData` nově vrací i `uncomputed: number`.

**Kontext:** Souhrn dnes sčítá pět čísel a mlčí o tom, že se některá kontrola nespočetla. Nula u selhané kontroly pak vypadá jako „v pořádku" — přesně to tiché selhání, které má panel odhalovat.

- [ ] **Step 1: Napsat failující test souhrnu**

Vytvořit `src/lib/healthSummary.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeHealth } from "./healthSummary";

test("souhrn: samé nuly → čisto", () => {
  const s = summarizeHealth([{ count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }]);
  assert.deepEqual(s, { total: 0, badChecks: 0, uncomputed: 0 });
});

test("souhrn: sečte nálezy a spočítá kontroly s nálezem", () => {
  const s = summarizeHealth([{ count: 2 }, { count: 0 }, { count: 5 }, { count: 0 }, { count: 0 }]);
  assert.deepEqual(s, { total: 7, badChecks: 2, uncomputed: 0 });
});

test("souhrn: nespočtená kontrola se NEpočítá jako v pořádku", () => {
  const s = summarizeHealth([{ count: null, error: "Unknown column" }, { count: 3 }, { count: 0 }, { count: 0 }, { count: 0 }]);
  assert.equal(s.total, 3);
  assert.equal(s.badChecks, 1);
  assert.equal(s.uncomputed, 1);
});

test("souhrn: spočtená kontrola s dílčí chybou se počítá jako nespočtená", () => {
  const s = summarizeHealth([{ count: 4, error: "Dílčí kontrola nespočtena." }, { count: 0 }, { count: 0 }, { count: 0 }, { count: 0 }]);
  assert.equal(s.total, 4);
  assert.equal(s.badChecks, 1);
  assert.equal(s.uncomputed, 1);
});
```

- [ ] **Step 2: Spustit test a ověřit, že selže**

Run: `node --test --import tsx src/lib/healthSummary.test.ts`
Expected: FAIL — modul `./healthSummary` neexistuje

- [ ] **Step 3: Implementovat souhrn**

Vytvořit `src/lib/healthSummary.ts`:

```typescript
/**
 * Souhrn Kontrolního panelu. Čistá funkce bez Reactu, aby šla testovat.
 *
 * Kontrola se počítá jako NESPOČTENÁ, když nemá výsledek (`count === null`)
 * NEBO když nese `error` i přes spočtené číslo (dílčí selhání uvnitř rozpadu).
 * Bez druhé podmínky by dílčí selhání zmizelo a nula by vypadala jako „v pořádku" —
 * přesně to tiché selhání, které má panel odhalovat.
 */
export type HealthSummary = { total: number; badChecks: number; uncomputed: number };

export function summarizeHealth(checks: { count: number | null; error?: string }[]): HealthSummary {
  let total = 0;
  let badChecks = 0;
  let uncomputed = 0;
  for (const c of checks) {
    if (c.count === null || c.error != null) uncomputed++;
    if (c.count != null) {
      total += c.count;
      if (c.count > 0) badChecks++;
    }
  }
  return { total, badChecks, uncomputed };
}
```

- [ ] **Step 4: Spustit test a ověřit, že projde**

Run: `node --test --import tsx src/lib/healthSummary.test.ts`
Expected: PASS

- [ ] **Step 5: Napojit souhrn do `useHealthData`**

V `src/app/reporty/_components/useHealthData.ts` nahradit `countFindings` importem a rozšířit rozhraní:

```typescript
import { summarizeHealth } from "@/lib/healthSummary";
```

```typescript
export interface UseHealthData {
  data: HealthData | null;
  loading: boolean;
  error: string | null;
  /** Celkový počet nálezů napříč spočtenými kontrolami. */
  total: number;
  /** Kolik z 5 kontrol má alespoň jeden nález. */
  badChecks: number;
  /** Kolik z 5 kontrol se nepodařilo spočítat. */
  uncomputed: number;
  refetch: () => void;
}
```

Funkci `countFindings` smazat a na jejím místě (i v `return`) použít:

```typescript
  const { total, badChecks, uncomputed } = data
    ? summarizeHealth([
        data.checks.overlaps, data.checks.drift, data.checks.outsideHours,
        data.checks.integrity, data.checks.attachments,
      ])
    : { total: 0, badChecks: 0, uncomputed: 0 };

  return { data, loading, error, total, badChecks, uncomputed, refetch };
```

- [ ] **Step 6: Přidat kartám třetí stav a vysvětlivku**

V `src/app/reporty/_components/HealthPanel.tsx`:

Doplnit import `import CheckExplainer from "./CheckExplainer";`

Nahradit komponentu `Card` (řádky 40–69):

```tsx
function Card({ title, subtitle, icon, count, error, copyKey, children, defaultOpen }: {
  title: string; subtitle: string; icon: string; count: number | null; error?: string;
  copyKey: string; children?: React.ReactNode; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const uncomputed = count === null;
  const bad = (count ?? 0) > 0;
  const edge = uncomputed
    ? "var(--warning)"
    : bad
      ? "var(--danger)"
      : "color-mix(in oklab, var(--success) 55%, var(--border))";
  const pillColor = uncomputed ? "var(--warning)" : bad ? "var(--danger)" : "var(--success)";
  const pillBg = uncomputed
    ? "color-mix(in oklab, var(--warning) 20%, transparent)"
    : bad
      ? "color-mix(in oklab, var(--danger) 20%, transparent)"
      : "color-mix(in oklab, var(--success) 18%, transparent)";
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderLeft: `3px solid ${edge}`, borderRadius: 11, overflow: "hidden",
    }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 15px", cursor: "pointer", userSelect: "none" }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, background: "var(--surface-2)" }}>{icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, padding: "4px 11px", borderRadius: 999, fontVariantNumeric: "tabular-nums",
            color: pillColor, background: pillBg,
          }}>{uncomputed ? "nespočteno" : bad ? count : "✓ 0"}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 15px 15px" }}>
          {error && (
            <div style={{ fontSize: 12, color: "var(--warning)", marginBottom: 8 }}>
              Kontrola se nespočetla: {error}
            </div>
          )}
          <CheckExplainer copyKey={copyKey} />
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Doplnit `copyKey`, `error` a `null`-bezpečné `defaultOpen` u pěti karet**

U každé z pěti karet doplnit prop `copyKey` a `error` a upravit `defaultOpen`:

```tsx
<Card icon="🔀" title="Překryvy bloků" subtitle="Dva bloky na stejném stroji ve stejný čas — jen budoucí." copyKey="overlaps" count={data.checks.overlaps.count} error={data.checks.overlaps.error} defaultOpen={(data.checks.overlaps.count ?? 1) > 0}>
<Card icon="🕒" title="Drift konce bloku" subtitle="Uložený konec nesedí na aktuální pracovní kalendář." copyKey="drift" count={data.checks.drift.count} error={data.checks.drift.error} defaultOpen={(data.checks.drift.count ?? 1) > 0}>
<Card icon="🚫" title="Bloky mimo provoz stroje" subtitle="Zakázka začíná, když stroj nejede a není to vědomý bypass." copyKey="outsideHours" count={data.checks.outsideHours.count} error={data.checks.outsideHours.error} defaultOpen={(data.checks.outsideHours.count ?? 1) > 0}>
<Card icon="🧩" title="Integrita dat" subtitle="Osiřelý preset, neplatné hodnoty a rozešlé split-skupiny." copyKey="integrity" count={data.checks.integrity.count} error={data.checks.integrity.error} defaultOpen={(data.checks.integrity.count ?? 1) > 0}>
<Card icon="📎" title="Přílohy: soubory vs. databáze" subtitle="Metadata v DB bez souboru na disku (nebo naopak)." copyKey="attachments" count={data.checks.attachments.count} error={data.checks.attachments.error} defaultOpen={(data.checks.attachments.count ?? 1) > 0}>
```

(`?? 1` znamená: nespočtená kontrola se otevře, aby byl důvod vidět.)

- [ ] **Step 8: Doplnit souhrnný proužek o nespočtené kontroly**

Nejdřív v `HealthPanel.tsx` rozšířit rozhraní props (řádky 7–17) o nové pole a přidat ho do destrukturalizace v hlavičce komponenty:

```tsx
interface HealthPanelProps {
  data: HealthData | null;
  loading: boolean;
  error: string | null;
  /** Celkový počet nálezů (z useHealthData). */
  total: number;
  /** Kolik z 5 kontrol má nález (z useHealthData). */
  badChecks: number;
  /** Kolik z 5 kontrol se nepodařilo spočítat (z useHealthData). */
  uncomputed: number;
  /** Znovu spustí kontroly — aktualizuje panel i odznak v záhlaví. */
  onRefresh: () => void;
}
```

```tsx
export default function HealthPanel({ data, loading, error, total, badChecks, uncomputed, onRefresh }: HealthPanelProps) {
```

V `src/app/reporty/_components/ReportDashboard.tsx` (kolem řádku 552) předat novou prop do `<HealthPanel …>`:

```tsx
            uncomputed={health.uncomputed}
```

Pak nahradit řádek se stavem (řádky 111–116):

```tsx
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: total > 0 ? "var(--danger)" : uncomputed > 0 ? "var(--warning)" : "var(--success)" }}>
                  {total > 0 ? `${total} ${total === 1 ? "problém" : total < 5 ? "problémy" : "problémů"}` : uncomputed > 0 ? "Bez nálezu (neúplně)" : "Vše v pořádku"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                  {total > 0 ? `v ${badChecks} z 5 kontrol · ` : "5 kontrol · "}
                  {uncomputed > 0 ? `${uncomputed} ${uncomputed === 1 ? "kontrola nespočtena" : uncomputed < 5 ? "kontroly nespočteny" : "kontrol nespočteno"} · ` : ""}
                  kontrola {fmtDateTime(data.checkedAt)}
                </div>
```

Barvu rámečku proužku (řádek 107) upravit tak, aby nespočtená kontrola nesvítila zeleně:

```tsx
border: `1px solid ${total > 0 ? "color-mix(in oklab, var(--danger) 45%, var(--border))" : uncomputed > 0 ? "color-mix(in oklab, var(--warning) 45%, var(--border))" : "color-mix(in oklab, var(--success) 40%, var(--border))"}`,
```

- [ ] **Step 9: Spustit celou test suite a typovou kontrolu**

Run:
```bash
node --experimental-test-module-mocks --test --import tsx \
  src/lib/*.test.ts src/lib/undo/*.test.ts src/lib/revision/*.test.ts src/app/_components/*.test.ts
```
Expected: PASS, žádný selhaný test

Run: `npx tsc --noEmit`
Expected: bez chyb

**Nespouštět `npm run build` ani dev server** — viz Global Constraints.

- [ ] **Step 10: Commit**

```bash
git add src/lib/healthSummary.ts src/lib/healthSummary.test.ts src/app/reporty/_components/useHealthData.ts src/app/reporty/_components/HealthPanel.tsx src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(health): třetí stav karty a souhrn, který nezamlčuje nespočtené kontroly

Karty umí \"nespočteno\" (žlutě) vedle zelené a červené; souhrn to
přizná místo toho, aby nula u selhané kontroly vypadala jako
\"v pořádku\". Všech 5 karet dostalo vysvětlivku. Výpočet souhrnu
vytažen do čisté funkce summarizeHealth s testy."
```

---

## Po dokončení všech tasků

- [ ] **Aktualizovat dokumentaci**

Do `docs/vyvoj-historie.md` přidat sekci k datu 13. 8. 2026 se shrnutím: které kontroly zmizely a proč (cizí klíče + falešný poplach), nová kontrola rozešlé split-skupiny, rozbalovací integritní řádky, třetí stav „nespočteno".

Do `docs/POUCENI.md` přidat řádek: **„Kontrola, na kterou uživatel nemůže reagovat, není kontrola."** — `undersizedSplitGroup` hlásil 10× legitimní akci plánovače; červený odznak, který svítí kvůli normálnímu provozu, se naučíš ignorovat, a s ním i skutečné nálezy. Před přidáním kontroly ověřit nad ostrými daty, co reálně hlásí, a co s tím uživatel může udělat.

- [ ] **Nasazení — podmínky**

1. **Nejdřív nasadit migraci `20260811120000_add_pantone_in_stock_issued`** (Pantone parita). Bez ní produkce nemá sloupce `Block.pantoneInStock` a `Block.pantoneIssued` a kontrola rozešlé skupiny se zobrazí jako „nespočteno". Poslední aplikovaná migrace na produkci je `20260808120000_block_revision_via_many`.
2. Před zásahem `mysqldump` záloha (standardní pravidlo projektu).
3. Zeptat se Vojty, jestli rovnou na produkci, nebo nejdřív na testovací instanci (port 3021, `igvyroba_test`, PM2 `planovani-TEST`) pro Lukáše.
4. Postup podle `docs/DEPLOY_WORKFLOW.md` doslova, včetně PRE/POST otisku dat.
5. **Očekávaný stav po nasazení:** panel ukáže 8 nálezů v řádku „Rozešlá split-skupina" (rozešlý `jobPresetId` + `jobPresetLabel`, legacy z doby před 13. 7. 2026). Opraví se otevřením a uložením kterékoli části zakázky; po opravě zůstane 0.
