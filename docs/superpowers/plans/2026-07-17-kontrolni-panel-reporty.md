# Kontrolní panel (debug/health dashboard v Reportech) — Implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development k provedení plánu task-po-tasku. Kroky používají checkbox (`- [ ]`) syntax.

**Goal:** Přidat nahoru do ADMIN stránky Reporty pasivní Kontrolní panel s 5 kontrolami (překryvy, drift konce, mimo provoz, integrita dat, přílohy) — u nálezů konkrétní seznam s prokliknutím do plánu.

**Architecture:** Čistá kontrolní logika v `src/lib/healthChecks.server.ts` (testovatelné pure funkce + tenké Prisma loadery + agregátor). Nový `GET /api/report/health` endpoint (ADMIN, bez parametrů). Klientská komponenta `HealthPanel` vložená nahoru do `ReportDashboard`. Drift + mimo provoz z jednoho volání existující `detectCalendarDrift` (tříděno dle `reason`). Deep-link do plánu = existující `/?highlight=<blockId>`. **Jen čte, žádné migrace ani zápisy.**

**Tech Stack:** Next.js 16 App Router · React · TypeScript · Prisma 5 · MySQL · node:test + tsx.

## Global Constraints

- **Chyby v API route → `AppError`**; catch dle CLAUDE.md: `isAppError` → `errorStatus`, jinak `logger.error` + 500. Nikdy `console.*`.
- **Auth v nové routě → `requireRole(["ADMIN"])` UVNITŘ try** (`src/lib/auth.ts`).
- **Žádné migrace, žádné zápisy do DB.** Panel i endpoint pouze čtou.
- **Barvy/rozměry přes CSS tokeny** z `globals.css` (`--surface`, `--border`, `--text`, `--text-muted`, `--brand`, `--brand-contrast`, `--success`, `--danger`, `--warning`) — nikdy hex pro theme barvy (rozbíjí light mode). Výjimka: barvy typových chipů (ZAKAZKA/REZERVACE/UDRZBA) — sémantické, dle precedentu `ReportDashboard` (který inlinuje hex pro grafy).
- **Nová komponenta jako named export do vlastního souboru** — NEpsat inline do `ReportDashboard.tsx` (~590 ř.).
- **Tailwind v4:** dynamické třídy nejdou → inline `style`.
- **Datum na serveru:** `new Date()` = aktuální instant je OK; parsování date-only řetězců přes helpery z `dateUtils` (v tomto plánu nepotřeba).
- **Testy:** pure funkce plně; agregátor `runHealthChecks` je tenké wiring (typován na `typeof prisma`) → ověřen buildem + endpoint smoke, ne unit mockem.
- Spouštění testů: `node --test --import tsx src/lib/healthChecks.server.test.ts`. Build: `npm run build`.

---

## File Structure

| Soubor | Akce | Odpovědnost |
| --- | --- | --- |
| `src/lib/healthChecks.server.ts` | Create | Typy, pure funkce (`computeOverlapPairs`, `computeIntegrityIssues`, `diffAttachmentFiles`, `bucketDrift`), loadery (`scanAttachmentDir`), agregátor `runHealthChecks`. |
| `src/lib/healthChecks.server.test.ts` | Create | Unit testy pure funkcí. |
| `src/app/api/report/health/route.ts` | Create | `GET`, ADMIN, volá `runHealthChecks`, vrací JSON. |
| `src/app/reporty/_components/HealthPanel.tsx` | Create | Klientská komponenta: fetch, summary proužek, 5 karet, rozbalování, jump. |
| `src/app/reporty/_components/ReportDashboard.tsx` | Modify | Vloží `<HealthPanel />` nahoru do těla. |

---

## Task 1: Modul + typy + překryvy (`computeOverlapPairs`)

**Files:**
- Create: `src/lib/healthChecks.server.ts`
- Test: `src/lib/healthChecks.server.test.ts`

**Interfaces:**
- Produces: `BlockRow`, `BlockRef`, `OverlapPair`, `DriftItem`, `IntegrityIssue`, `AttachmentFileRow`, `DiskEntry`, `AttachmentIssues`, `HealthResult` typy; `computeOverlapPairs(blocks: BlockRow[], now: Date): OverlapPair[]`.

- [ ] **Step 1: Napiš selhávající test** — `src/lib/healthChecks.server.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOverlapPairs, type BlockRow } from "./healthChecks.server";

const D = (iso: string) => new Date(iso);
function blk(o: Partial<BlockRow> & Pick<BlockRow, "id" | "startTime" | "endTime">): BlockRow {
  return {
    orderNumber: `Z-${o.id}`, machine: "XL_105", type: "ZAKAZKA",
    printMinutes: 120, printCompletedAt: null,
    splitGroupId: null, reservationId: null, jobPresetId: null, recurrenceParentId: null,
    ...o,
  };
}
const NOW = D("2026-07-17T00:00:00.000Z");

test("computeOverlapPairs: dva budoucí překrývající se bloky → 1 pár", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T11:00:00Z") });
  const pairs = computeOverlapPairs([a, b], NOW);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a.id, 1);
  assert.equal(pairs[0].b.id, 2);
  assert.equal(pairs[0].overlapMinutes, 60);
});

test("computeOverlapPairs: dotýkající se bloky (end===start) → 0 párů", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T10:00:00Z"), endTime: D("2026-08-01T12:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: překryv celý v minulosti → 0 (jen budoucí)", () => {
  const a = blk({ id: 1, startTime: D("2026-06-01T08:00:00Z"), endTime: D("2026-06-01T10:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-06-01T09:00:00Z"), endTime: D("2026-06-01T11:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: různé stroje ve stejný čas → 0", () => {
  const a = blk({ id: 1, machine: "XL_105", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, machine: "XL_106", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  assert.equal(computeOverlapPairs([a, b], NOW).length, 0);
});

test("computeOverlapPairs: typově agnostické (REZERVACE × UDRZBA) → 1 pár", () => {
  const a = blk({ id: 1, type: "REZERVACE", startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const b = blk({ id: 2, type: "UDRZBA", startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T10:00:00Z") });
  const pairs = computeOverlapPairs([a, b], NOW);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].overlapMinutes, 60);
});

test("computeOverlapPairs: tři vzájemně se překrývající → 3 páry", () => {
  const a = blk({ id: 1, startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T11:00:00Z") });
  const b = blk({ id: 2, startTime: D("2026-08-01T09:00:00Z"), endTime: D("2026-08-01T12:00:00Z") });
  const c = blk({ id: 3, startTime: D("2026-08-01T10:00:00Z"), endTime: D("2026-08-01T13:00:00Z") });
  assert.equal(computeOverlapPairs([a, b, c], NOW).length, 3);
});
```

- [ ] **Step 2: Spusť test — musí selhat** (modul neexistuje):
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL (Cannot find module './healthChecks.server').

- [ ] **Step 3: Vytvoř modul se scaffoldingem + `computeOverlapPairs`** — `src/lib/healthChecks.server.ts`:

```typescript
import { detectCalendarDrift, type DriftedBlock } from "@/lib/calendarDrift.server";
import { SLOT_MS } from "@/lib/printTime";
import { MACHINES } from "@/lib/machines";
import { prisma } from "@/lib/prisma";
import { readdir } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const DRIFT_HORIZON_DAYS = 365;
const MAX_ITEMS = 50; // strop položek per kontrola v payloadu
const VALID_TYPES = ["ZAKAZKA", "REZERVACE", "UDRZBA"];
const MAX_PRINT_MINUTES = 2400; // 40 h (viz scheduleValidationServer)
const ATTACHMENTS_DIR = path.join(process.cwd(), "data", "reservation-attachments");

// ── Typy ──────────────────────────────────────────────────────────────────
export type BlockRow = {
  id: number;
  orderNumber: string;
  machine: string;
  type: string;
  startTime: Date;
  endTime: Date;
  printMinutes: number | null;
  printCompletedAt: Date | null;
  splitGroupId: number | null;
  reservationId: number | null;
  jobPresetId: number | null;
  recurrenceParentId: number | null;
};

export type BlockRef = { id: number; orderNumber: string; type: string; startTime: Date; endTime: Date };

export type OverlapPair = {
  machine: string;
  a: BlockRef;
  b: BlockRef;
  overlapStart: Date;
  overlapEnd: Date;
  overlapMinutes: number;
};

export type DriftItem = {
  id: number;
  orderNumber: string;
  machine: string;
  startTime: Date;
  storedEnd: Date;
  expectedEnd: Date | null;
  reason: DriftedBlock["reason"];
};

export type IntegrityIssue = { key: string; label: string; count: number; sampleBlockIds: number[] };
export type AttachmentFileRow = { id: number; reservationId: number; originalName: string; storageKey: string };
export type DiskEntry = { reservationId: number; storageKey: string };
export type AttachmentIssues = { missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[] };

export type HealthResult = {
  checkedAt: string;
  checks: {
    overlaps: { count: number; items: OverlapPair[] };
    drift: { count: number; items: DriftItem[] };
    outsideHours: { count: number; items: DriftItem[] };
    integrity: { count: number; breakdown: IntegrityIssue[] };
    attachments: { count: number; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[] };
  };
};

// ── Překryvy ──────────────────────────────────────────────────────────────
function toRef(b: BlockRow): BlockRef {
  return { id: b.id, orderNumber: b.orderNumber, type: b.type, startTime: b.startTime, endTime: b.endTime };
}

/**
 * Všechny BUDOUCÍ překrývající se páry bloků na stejném stroji (typově agnostické).
 * „Budoucí" = konec překryvu min(aEnd,bEnd) je po `now`. Čistá funkce.
 */
export function computeOverlapPairs(blocks: BlockRow[], now: Date): OverlapPair[] {
  const byMachine = new Map<string, BlockRow[]>();
  for (const b of blocks) {
    const arr = byMachine.get(b.machine) ?? [];
    arr.push(b);
    byMachine.set(b.machine, arr);
  }
  const nowMs = now.getTime();
  const pairs: OverlapPair[] = [];
  for (const arr of byMachine.values()) {
    const sorted = [...arr].sort((x, y) => x.startTime.getTime() - y.startTime.getTime());
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]!;
        if (b.startTime.getTime() >= a.endTime.getTime()) break; // seřazeno dle startu → dál už nic a nepřekryje
        const overlapStart = new Date(Math.max(a.startTime.getTime(), b.startTime.getTime()));
        const overlapEnd = new Date(Math.min(a.endTime.getTime(), b.endTime.getTime()));
        if (overlapEnd.getTime() <= nowMs) continue; // jen budoucí
        pairs.push({
          machine: a.machine,
          a: toRef(a),
          b: toRef(b),
          overlapStart,
          overlapEnd,
          overlapMinutes: Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 60000),
        });
      }
    }
  }
  return pairs.sort((p, q) => p.overlapStart.getTime() - q.overlapStart.getTime());
}
```

- [ ] **Step 4: Spusť test — musí projít**:
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS (6 testů).

- [ ] **Step 5: Commit**:
```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts
git commit -m "feat(health): modul + computeOverlapPairs (budoucí překryvy, typově agnostické)"
```

---

## Task 2: Integrita dat (`computeIntegrityIssues`)

**Files:**
- Modify: `src/lib/healthChecks.server.ts`
- Test: `src/lib/healthChecks.server.test.ts`

**Interfaces:**
- Consumes: `BlockRow` (Task 1).
- Produces: `IntegrityRefs` typ; `computeIntegrityIssues(blocks: BlockRow[], refs: IntegrityRefs): IntegrityIssue[]`.

- [ ] **Step 1: Napiš selhávající testy** — přidej do `healthChecks.server.test.ts`:

```typescript
import { computeIntegrityIssues, type IntegrityRefs } from "./healthChecks.server";

function refs(o: Partial<IntegrityRefs> = {}): IntegrityRefs {
  return {
    splitGroupIds: o.splitGroupIds ?? new Set<number>(),
    reservationIds: o.reservationIds ?? new Set<number>(),
    jobPresetIds: o.jobPresetIds ?? new Set<number>(),
    blockIds: o.blockIds ?? new Set<number>(),
  };
}
function issue(res: ReturnType<typeof computeIntegrityIssues>, key: string) {
  const it = res.find((i) => i.key === key);
  assert.ok(it, `chybí kontrola ${key}`);
  return it!;
}
const OK_START = D("2026-08-03T08:00:00Z"); // zarovnaný na 30min
const OK_END = D("2026-08-03T10:00:00Z");

test("integrity: osiřelý jobPreset se hlásí, platný ne", () => {
  const orphan = blk({ id: 1, startTime: OK_START, endTime: OK_END, jobPresetId: 99 });
  const ok = blk({ id: 2, startTime: OK_START, endTime: OK_END, jobPresetId: 5 });
  const res = computeIntegrityIssues([orphan, ok], refs({ jobPresetIds: new Set([5]), blockIds: new Set([1, 2]) }));
  const it = issue(res, "orphanJobPreset");
  assert.deepEqual(it.sampleBlockIds, [1]);
  assert.equal(it.count, 1);
});

test("integrity: osiřelý splitGroup / reservation / recurrenceParent", () => {
  const b1 = blk({ id: 1, startTime: OK_START, endTime: OK_END, splitGroupId: 7 });
  const b2 = blk({ id: 2, startTime: OK_START, endTime: OK_END, reservationId: 8 });
  const b3 = blk({ id: 3, startTime: OK_START, endTime: OK_END, recurrenceParentId: 900 });
  const res = computeIntegrityIssues([b1, b2, b3], refs({ blockIds: new Set([1, 2, 3]) }));
  assert.equal(issue(res, "orphanSplitGroup").count, 1);
  assert.equal(issue(res, "orphanReservation").count, 1);
  assert.equal(issue(res, "orphanRecurrenceParent").count, 1);
});

test("integrity: neplatný stroj a typ", () => {
  const bad = blk({ id: 1, machine: "XX_999", type: "PRUSER", startTime: OK_START, endTime: OK_END });
  const res = computeIntegrityIssues([bad], refs({ blockIds: new Set([1]) }));
  assert.equal(issue(res, "invalidMachine").count, 1);
  assert.equal(issue(res, "invalidType").count, 1);
});

test("integrity: konec <= začátek", () => {
  const bad = blk({ id: 1, startTime: D("2026-08-03T10:00:00Z"), endTime: D("2026-08-03T08:00:00Z") });
  const res = computeIntegrityIssues([bad], refs({ blockIds: new Set([1]) }));
  assert.equal(issue(res, "negativeInterval").count, 1);
});

test("integrity: vadné printMinutes (odd/too big/<=0); NULL a completed se nehlásí", () => {
  const odd = blk({ id: 1, startTime: OK_START, endTime: OK_END, printMinutes: 45 });
  const big = blk({ id: 2, startTime: OK_START, endTime: OK_END, printMinutes: 3000 });
  const nul = blk({ id: 3, startTime: OK_START, endTime: OK_END, printMinutes: null });
  const done = blk({ id: 4, startTime: OK_START, endTime: OK_END, printMinutes: 45, printCompletedAt: D("2026-08-04T00:00:00Z") });
  const res = computeIntegrityIssues([odd, big, nul, done], refs({ blockIds: new Set([1, 2, 3, 4]) }));
  const it = issue(res, "badPrintMinutes");
  assert.equal(it.count, 2);
  assert.deepEqual(it.sampleBlockIds, [1, 2]);
});

test("integrity: nezarovnaný start jen ZAKAZKA nedokončená; REZERVACE ne", () => {
  const zak = blk({ id: 1, type: "ZAKAZKA", startTime: D("2026-08-03T08:15:00Z"), endTime: OK_END });
  const rez = blk({ id: 2, type: "REZERVACE", startTime: D("2026-08-03T08:15:00Z"), endTime: OK_END });
  const res = computeIntegrityIssues([zak, rez], refs({ blockIds: new Set([1, 2]) }));
  const it = issue(res, "unalignedStart");
  assert.equal(it.count, 1);
  assert.deepEqual(it.sampleBlockIds, [1]);
});

test("integrity: split-skupina < 2 bloky (1 člen i prázdná skupina)", () => {
  const lone = blk({ id: 1, startTime: OK_START, endTime: OK_END, splitGroupId: 10 });
  // skupina 10 má 1 člena; skupina 20 je v setu, ale nemá žádný blok
  const res = computeIntegrityIssues([lone], refs({ splitGroupIds: new Set([10, 20]), blockIds: new Set([1]) }));
  assert.equal(issue(res, "undersizedSplitGroup").count, 2);
});
```

- [ ] **Step 2: Spusť — selže** (computeIntegrityIssues neexistuje):
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Přidej `computeIntegrityIssues`** do `healthChecks.server.ts` (za `computeOverlapPairs`):

```typescript
// ── Integrita dat ───────────────────────────────────────────────────────────
export type IntegrityRefs = {
  splitGroupIds: Set<number>;
  reservationIds: Set<number>;
  jobPresetIds: Set<number>;
  blockIds: Set<number>;
};

/** Osiřelé vazby + neplatné hodnoty. Čistá funkce nad načtenými bloky a množinami ID. */
export function computeIntegrityIssues(blocks: BlockRow[], refs: IntegrityRefs): IntegrityIssue[] {
  const machines = MACHINES as readonly string[];
  const issues: IntegrityIssue[] = [];
  const add = (key: string, label: string, hits: BlockRow[]) => {
    issues.push({ key, label, count: hits.length, sampleBlockIds: hits.slice(0, MAX_ITEMS).map((b) => b.id) });
  };

  add("orphanJobPreset", "Osiřelý jobPreset (blok odkazuje na smazaný preset)",
    blocks.filter((b) => b.jobPresetId != null && !refs.jobPresetIds.has(b.jobPresetId)));
  add("orphanSplitGroup", "Osiřelá split-skupina",
    blocks.filter((b) => b.splitGroupId != null && !refs.splitGroupIds.has(b.splitGroupId)));
  add("orphanReservation", "Osiřelá rezervace",
    blocks.filter((b) => b.reservationId != null && !refs.reservationIds.has(b.reservationId)));
  add("orphanRecurrenceParent", "Osiřelý rodič opakování",
    blocks.filter((b) => b.recurrenceParentId != null && !refs.blockIds.has(b.recurrenceParentId)));
  add("invalidMachine", "Neplatný stroj",
    blocks.filter((b) => !machines.includes(b.machine)));
  add("invalidType", "Neplatný typ bloku",
    blocks.filter((b) => !VALID_TYPES.includes(b.type)));
  add("negativeInterval", "Konec ≤ začátek (nelogický interval)",
    blocks.filter((b) => b.endTime.getTime() <= b.startTime.getTime()));
  add("badPrintMinutes", "Vadné printMinutes (ZAKAZKA)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.printMinutes != null &&
      (b.printMinutes <= 0 || b.printMinutes > MAX_PRINT_MINUTES || b.printMinutes % 30 !== 0)));
  add("unalignedStart", "Nezarovnaný start (mimo 30min mřížku)",
    blocks.filter((b) =>
      b.type === "ZAKAZKA" && b.printCompletedAt == null && b.startTime.getTime() % SLOT_MS !== 0));

  // split-skupina < 2 bloky (i prázdné skupiny přítomné v refs.splitGroupIds)
  const membersByGroup = new Map<number, number[]>();
  for (const b of blocks) {
    if (b.splitGroupId == null) continue;
    const arr = membersByGroup.get(b.splitGroupId) ?? [];
    arr.push(b.id);
    membersByGroup.set(b.splitGroupId, arr);
  }
  const undersizedSamples: number[] = [];
  let undersizedCount = 0;
  for (const gid of refs.splitGroupIds) {
    const members = membersByGroup.get(gid) ?? [];
    if (members.length < 2) {
      undersizedCount++;
      if (undersizedSamples.length < MAX_ITEMS && members[0] != null) undersizedSamples.push(members[0]);
    }
  }
  issues.push({ key: "undersizedSplitGroup", label: "Split-skupina s méně než 2 bloky", count: undersizedCount, sampleBlockIds: undersizedSamples });

  return issues;
}
```

- [ ] **Step 4: Spusť — projde**:
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**:
```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts
git commit -m "feat(health): computeIntegrityIssues (osiřelé vazby + neplatné hodnoty)"
```

---

## Task 3: Přílohy (`diffAttachmentFiles` + `scanAttachmentDir`)

**Files:**
- Modify: `src/lib/healthChecks.server.ts`
- Test: `src/lib/healthChecks.server.test.ts`

**Interfaces:**
- Consumes: `AttachmentFileRow`, `DiskEntry`, `AttachmentIssues` (Task 1).
- Produces: `diffAttachmentFiles(dbRows, diskEntries): AttachmentIssues`; `scanAttachmentDir(dir): Promise<DiskEntry[]>`.

- [ ] **Step 1: Napiš selhávající testy** — přidej:

```typescript
import { diffAttachmentFiles, type AttachmentFileRow, type DiskEntry } from "./healthChecks.server";

test("diffAttachmentFiles: DB řádek bez souboru → missing", () => {
  const db: AttachmentFileRow[] = [{ id: 1, reservationId: 5, originalName: "a.pdf", storageKey: "k1" }];
  const disk: DiskEntry[] = [];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 1);
  assert.equal(r.orphanFiles.length, 0);
});

test("diffAttachmentFiles: soubor bez DB řádku → orphan", () => {
  const db: AttachmentFileRow[] = [];
  const disk: DiskEntry[] = [{ reservationId: 5, storageKey: "k1" }];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 0);
  assert.equal(r.orphanFiles.length, 1);
});

test("diffAttachmentFiles: shoda → žádný nález", () => {
  const db: AttachmentFileRow[] = [{ id: 1, reservationId: 5, originalName: "a.pdf", storageKey: "k1" }];
  const disk: DiskEntry[] = [{ reservationId: 5, storageKey: "k1" }];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 0);
  assert.equal(r.orphanFiles.length, 0);
});

test("diffAttachmentFiles: stejný storageKey pod jinou rezervací není shoda", () => {
  const db: AttachmentFileRow[] = [{ id: 1, reservationId: 5, originalName: "a.pdf", storageKey: "k1" }];
  const disk: DiskEntry[] = [{ reservationId: 6, storageKey: "k1" }];
  const r = diffAttachmentFiles(db, disk);
  assert.equal(r.missingFiles.length, 1);
  assert.equal(r.orphanFiles.length, 1);
});
```

- [ ] **Step 2: Spusť — selže**:
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Přidej funkce** do `healthChecks.server.ts`:

```typescript
// ── Přílohy: disk vs. DB ─────────────────────────────────────────────────────
/** Množinový rozdíl DB metadat a souborů na disku (klíč = "reservationId/storageKey"). Čistá funkce. */
export function diffAttachmentFiles(dbRows: AttachmentFileRow[], diskEntries: DiskEntry[]): AttachmentIssues {
  const key = (o: { reservationId: number; storageKey: string }) => `${o.reservationId}/${o.storageKey}`;
  const diskSet = new Set(diskEntries.map(key));
  const dbSet = new Set(dbRows.map(key));
  return {
    missingFiles: dbRows.filter((r) => !diskSet.has(key(r))).slice(0, MAX_ITEMS),
    orphanFiles: diskEntries.filter((e) => !dbSet.has(key(e))).slice(0, MAX_ITEMS),
  };
}

/** Naskenuje `data/reservation-attachments/<reservationId>/<storageKey>`. Chybějící složka = prázdno. */
export async function scanAttachmentDir(dir: string): Promise<DiskEntry[]> {
  let subdirs: string[];
  try {
    subdirs = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return []; // složka neexistuje (žádné přílohy)
  }
  const entries: DiskEntry[] = [];
  for (const sub of subdirs) {
    const reservationId = Number(sub);
    if (!Number.isInteger(reservationId)) continue;
    try {
      const files = (await readdir(path.join(dir, sub), { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name);
      for (const storageKey of files) entries.push({ reservationId, storageKey });
    } catch {
      continue;
    }
  }
  return entries;
}
```

- [ ] **Step 4: Spusť — projde**:
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**:
```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts
git commit -m "feat(health): diffAttachmentFiles + scanAttachmentDir (přílohy disk vs DB)"
```

---

## Task 4: Drift bucket + agregátor (`bucketDrift`, `runHealthChecks`)

**Files:**
- Modify: `src/lib/healthChecks.server.ts`
- Test: `src/lib/healthChecks.server.test.ts`

**Interfaces:**
- Consumes: `DriftedBlock` (z `calendarDrift.server`), `computeOverlapPairs`, `computeIntegrityIssues`, `diffAttachmentFiles`, `scanAttachmentDir`.
- Produces: `bucketDrift(drifted): { drift: DriftItem[]; outsideHours: DriftItem[] }`; `runHealthChecks(db: typeof prisma, now: Date): Promise<HealthResult>`.

- [ ] **Step 1: Napiš selhávající test pro `bucketDrift`** (agregátor `runHealthChecks` je wiring na `typeof prisma` → netestujeme mockem, ověří build + endpoint):

```typescript
import { bucketDrift } from "./healthChecks.server";
import type { DriftedBlock } from "./calendarDrift.server";

test("bucketDrift: END_MISMATCH+HORIZON → drift; START_NOT_RUNNABLE → outsideHours", () => {
  const mk = (id: number, reason: DriftedBlock["reason"]): DriftedBlock => ({
    id, orderNumber: `Z-${id}`, machine: "XL_105",
    startTime: D("2026-08-01T08:00:00Z"), endTime: D("2026-08-01T10:00:00Z"),
    expectedEnd: reason === "END_MISMATCH" ? D("2026-08-01T11:00:00Z") : null, reason,
  });
  const { drift, outsideHours } = bucketDrift([mk(1, "END_MISMATCH"), mk(2, "START_NOT_RUNNABLE"), mk(3, "HORIZON_EXCEEDED")]);
  assert.deepEqual(drift.map((d) => d.id), [1, 3]);
  assert.deepEqual(outsideHours.map((d) => d.id), [2]);
  assert.equal(drift[0].storedEnd.getTime(), D("2026-08-01T10:00:00Z").getTime());
  assert.equal(drift[0].expectedEnd?.getTime(), D("2026-08-01T11:00:00Z").getTime());
});
```

- [ ] **Step 2: Spusť — selže**:
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: FAIL.

- [ ] **Step 3: Přidej `bucketDrift` + `runHealthChecks`** do `healthChecks.server.ts`:

```typescript
// ── Drift bucket + agregátor ─────────────────────────────────────────────────
/** END_MISMATCH/HORIZON_EXCEEDED → drift; START_NOT_RUNNABLE → mimo provoz. Čistá funkce. */
export function bucketDrift(drifted: DriftedBlock[]): { drift: DriftItem[]; outsideHours: DriftItem[] } {
  const drift: DriftItem[] = [];
  const outsideHours: DriftItem[] = [];
  for (const d of drifted) {
    const item: DriftItem = {
      id: d.id, orderNumber: d.orderNumber, machine: d.machine,
      startTime: d.startTime, storedEnd: d.endTime, expectedEnd: d.expectedEnd, reason: d.reason,
    };
    if (d.reason === "START_NOT_RUNNABLE") outsideHours.push(item);
    else drift.push(item);
  }
  return { drift, outsideHours };
}

const BLOCK_SELECT = {
  id: true, orderNumber: true, machine: true, type: true, startTime: true, endTime: true,
  printMinutes: true, printCompletedAt: true, splitGroupId: true, reservationId: true,
  jobPresetId: true, recurrenceParentId: true,
} as const;

/**
 * Spočítá všech 5 kontrol. Čte celou tabulku Block (pár sloupců) 1× a sdílí ji mezi
 * překryvy a integritu; drift/mimo provoz z detectCalendarDrift; přílohy FS sken.
 * Jen čte. Typováno na `typeof prisma` (thin wiring) — logika je v pure funkcích výše.
 */
export async function runHealthChecks(db: typeof prisma, now: Date): Promise<HealthResult> {
  const [allBlocks, splitGroups, reservations, jobPresets, attachmentRows] = await Promise.all([
    db.block.findMany({ select: BLOCK_SELECT }),
    db.splitGroup.findMany({ select: { id: true } }),
    db.reservation.findMany({ select: { id: true } }),
    db.jobPreset.findMany({ select: { id: true } }),
    db.reservationAttachment.findMany({ select: { id: true, reservationId: true, originalName: true, storageKey: true } }),
  ]);

  const blocks = allBlocks as BlockRow[];
  const refs: IntegrityRefs = {
    splitGroupIds: new Set(splitGroups.map((g) => g.id)),
    reservationIds: new Set(reservations.map((r) => r.id)),
    jobPresetIds: new Set(jobPresets.map((p) => p.id)),
    blockIds: new Set(blocks.map((b) => b.id)),
  };

  const drifted = await detectCalendarDrift(
    db, [...MACHINES], now, new Date(now.getTime() + DRIFT_HORIZON_DAYS * DAY_MS), now,
  );
  const { drift, outsideHours } = bucketDrift(drifted);
  const overlaps = computeOverlapPairs(blocks, now);
  const integrity = computeIntegrityIssues(blocks, refs);
  const attach = diffAttachmentFiles(attachmentRows, await scanAttachmentDir(ATTACHMENTS_DIR));
  const integrityCount = integrity.reduce((s, i) => s + i.count, 0);

  return {
    checkedAt: now.toISOString(),
    checks: {
      overlaps: { count: overlaps.length, items: overlaps.slice(0, MAX_ITEMS) },
      drift: { count: drift.length, items: drift.slice(0, MAX_ITEMS) },
      outsideHours: { count: outsideHours.length, items: outsideHours.slice(0, MAX_ITEMS) },
      integrity: { count: integrityCount, breakdown: integrity },
      attachments: {
        count: attach.missingFiles.length + attach.orphanFiles.length,
        missingFiles: attach.missingFiles,
        orphanFiles: attach.orphanFiles,
      },
    },
  };
}
```

- [ ] **Step 4: Spusť testy + build** (build ověří, že `runHealthChecks` typuje proti `typeof prisma` a `detectCalendarDrift`):
Run: `node --test --import tsx src/lib/healthChecks.server.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: build OK (0 TS chyb).

- [ ] **Step 5: Commit**:
```bash
git add src/lib/healthChecks.server.ts src/lib/healthChecks.server.test.ts
git commit -m "feat(health): bucketDrift + runHealthChecks agregátor (5 kontrol, jen čte)"
```

---

## Task 5: API endpoint `GET /api/report/health`

**Files:**
- Create: `src/app/api/report/health/route.ts`

**Interfaces:**
- Consumes: `runHealthChecks` (Task 4), `requireRole`, `isAppError`/`errorStatus`, `logger`, `prisma`.

- [ ] **Step 1: Vytvoř route** — `src/app/api/report/health/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runHealthChecks } from "@/lib/healthChecks.server";

export async function GET() {
  try {
    await requireRole(["ADMIN"]);
    const result = await runHealthChecks(prisma, new Date());
    return NextResponse.json(result);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[GET /api/report/health] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**:
Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Manuální smoke** (dev server běží, přihlášen jako ADMIN):
Run: `curl -s -b <session-cookie> http://localhost:3000/api/report/health | head -c 400`
Expected: JSON s klíči `checkedAt` a `checks.overlaps/drift/outsideHours/integrity/attachments`. Bez ADMIN cookie → 401/403.
(Pokud dev server neběží / cookie nedostupná, ověření proběhne přes UI v Tasku 7 — zaznamenej to.)

- [ ] **Step 4: Commit**:
```bash
git add src/app/api/report/health/route.ts
git commit -m "feat(health): GET /api/report/health (ADMIN, requireRole, AppError)"
```

---

## Task 6: Komponenta `HealthPanel`

**Files:**
- Create: `src/app/reporty/_components/HealthPanel.tsx`

**Interfaces:**
- Consumes: `/api/report/health` JSON (tvar `HealthResult`, Date pole jako ISO stringy).
- Produces: default export `HealthPanel` (React komponenta, bez props).

**Chování:** fetch on mount + tlačítko „Překontrolovat teď"; summary proužek; 5 karet; červené default rozbalené, zelené sbalené; jump `/?highlight=<blockId>`. Vzhled dle schváleného mockupu (design tokeny, typové chipy, levý `--danger` proužek u červené karty, tabulky v `overflow-x:auto`).

- [ ] **Step 1: Vytvoř komponentu** — `src/app/reporty/_components/HealthPanel.tsx`:

```tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import { machineLabel } from "@/lib/machines";

// ── Tvary z /api/report/health (Date pole přicházejí jako ISO stringy) ──
type BlockRef = { id: number; orderNumber: string; type: string; startTime: string; endTime: string };
type OverlapPair = { machine: string; a: BlockRef; b: BlockRef; overlapStart: string; overlapEnd: string; overlapMinutes: number };
type DriftItem = { id: number; orderNumber: string; machine: string; startTime: string; storedEnd: string; expectedEnd: string | null; reason: string };
type IntegrityIssue = { key: string; label: string; count: number; sampleBlockIds: number[] };
type AttachmentFileRow = { id: number; reservationId: number; originalName: string; storageKey: string };
type DiskEntry = { reservationId: number; storageKey: string };
type HealthData = {
  checkedAt: string;
  checks: {
    overlaps: { count: number; items: OverlapPair[] };
    drift: { count: number; items: DriftItem[] };
    outsideHours: { count: number; items: DriftItem[] };
    integrity: { count: number; breakdown: IntegrityIssue[] };
    attachments: { count: number; missingFiles: AttachmentFileRow[]; orphanFiles: DiskEntry[] };
  };
};

const TYPE_CHIP: Record<string, string> = { ZAKAZKA: "#1a6bcc", REZERVACE: "#7c3aed", UDRZBA: "#c0392b" };
const TYPE_LABEL: Record<string, string> = { ZAKAZKA: "ZAKÁZKA", REZERVACE: "REZERVACE", UDRZBA: "ÚDRŽBA" };

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}
function jumpHref(blockId: number): string {
  return `/?highlight=${blockId}`;
}

function Chip({ type }: { type: string }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 5, color: "#fff", background: TYPE_CHIP[type] ?? "var(--surface-3)" }}>
      {TYPE_LABEL[type] ?? type}
    </span>
  );
}
function Jump({ id }: { id: number }) {
  return <a href={jumpHref(id)} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>Otevřít v plánu →</a>;
}

function Card({ title, subtitle, icon, count, children, defaultOpen }: {
  title: string; subtitle: string; icon: string; count: number; children?: React.ReactNode; defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bad = count > 0;
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderLeft: `3px solid ${bad ? "var(--danger)" : "color-mix(in oklab, var(--success) 55%, var(--border))"}`,
      borderRadius: 11, overflow: "hidden",
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
            color: bad ? "var(--danger)" : "var(--success)",
            background: bad ? "color-mix(in oklab, var(--danger) 20%, transparent)" : "color-mix(in oklab, var(--success) 18%, transparent)",
          }}>{bad ? count : "✓ 0"}</span>
          <span style={{ color: "var(--text-muted)", fontSize: 12, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▸</span>
        </div>
      </div>
      {open && children && <div style={{ borderTop: "1px solid var(--border)", padding: "10px 15px 15px" }}>{children}</div>}
    </div>
  );
}

const TH: React.CSSProperties = { textAlign: "left", fontSize: 10, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, padding: "9px 12px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)" };
const TD: React.CSSProperties = { padding: "10px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle", fontSize: 13 };
function TableWrap({ children }: { children: React.ReactNode }) {
  return <div style={{ overflowX: "auto", marginTop: 8, border: "1px solid var(--border)", borderRadius: 9 }}><table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>{children}</table></div>;
}
function BlockCell({ r }: { r: BlockRef }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Chip type={r.type} />
      <span style={{ fontWeight: 600 }}>{r.orderNumber || `#${r.id}`}</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(r.startTime)}–{fmtDateTime(r.endTime)}</span>
    </div>
  );
}

export default function HealthPanel() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/report/health");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neznámá chyba");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const total = data ? data.checks.overlaps.count + data.checks.drift.count + data.checks.outsideHours.count + data.checks.integrity.count + data.checks.attachments.count : 0;
  const badChecks = data ? [data.checks.overlaps.count, data.checks.drift.count, data.checks.outsideHours.count, data.checks.integrity.count, data.checks.attachments.count].filter((c) => c > 0).length : 0;

  const sectionLabel: React.CSSProperties = { fontSize: 12, color: "var(--brand)", fontWeight: 600, borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 12 };
  const refreshBtn = (
    <button onClick={fetchData} disabled={loading} style={{ background: "var(--brand)", color: "var(--brand-contrast)", border: "1px solid var(--brand)", borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1, whiteSpace: "nowrap" }}>
      ↻ {loading ? "Kontroluji…" : "Překontrolovat teď"}
    </button>
  );

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={sectionLabel}>Kontrolní panel</div>

      {error && (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "color-mix(in oklab, var(--danger) 10%, transparent)", border: "1px solid color-mix(in oklab, var(--danger) 30%, transparent)", color: "var(--danger)", fontSize: 13 }}>
          Chyba kontroly: {error} <button onClick={fetchData} style={{ marginLeft: 8, background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontWeight: 600 }}>Zkusit znovu</button>
        </div>
      )}

      {!error && data && (
        <>
          {/* Souhrnný proužek */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", background: "var(--surface)", border: `1px solid ${total > 0 ? "color-mix(in oklab, var(--danger) 45%, var(--border))" : "color-mix(in oklab, var(--success) 40%, var(--border))"}`, borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 250 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, background: total > 0 ? "color-mix(in oklab, var(--danger) 22%, transparent)" : "color-mix(in oklab, var(--success) 20%, transparent)" }}>{total > 0 ? "⚠️" : "✓"}</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", color: total > 0 ? "var(--danger)" : "var(--success)" }}>
                  {total > 0 ? `${total} ${total === 1 ? "problém" : total < 5 ? "problémy" : "problémů"}` : "Vše v pořádku"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                  {total > 0 ? `v ${badChecks} z 5 kontrol · ` : "5 kontrol bez nálezu · "}kontrola {fmtDateTime(data.checkedAt)}
                </div>
              </div>
            </div>
            {refreshBtn}
          </div>

          {/* Karty */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* 1. Překryvy */}
            <Card icon="🔀" title="Překryvy bloků" subtitle="Dva bloky na stejném stroji ve stejný čas — jen budoucí." count={data.checks.overlaps.count} defaultOpen={data.checks.overlaps.count > 0}>
              <TableWrap>
                <thead><tr><th style={TH}>Stroj</th><th style={TH}>Blok A</th><th style={TH}>Blok B</th><th style={TH}>Překryv</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.overlaps.items.map((p, i) => (
                    <tr key={i}>
                      <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{machineLabel(p.machine)}</td>
                      <td style={TD}><BlockCell r={p.a} /></td>
                      <td style={TD}><BlockCell r={p.b} /></td>
                      <td style={{ ...TD, color: "var(--warning)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{p.overlapMinutes} m</td>
                      <td style={TD}><Jump id={p.a.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>

            {/* 2. Drift */}
            <Card icon="🕒" title="Drift konce bloku" subtitle="Uložený konec nesedí na aktuální pracovní kalendář." count={data.checks.drift.count} defaultOpen={data.checks.drift.count > 0}>
              <TableWrap>
                <thead><tr><th style={TH}>Zakázka</th><th style={TH}>Stroj</th><th style={TH}>Uložený konec</th><th style={TH}>Přepočítaný</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.drift.items.map((d) => (
                    <tr key={d.id}>
                      <td style={TD}><span style={{ fontWeight: 600 }}>{d.orderNumber || `#${d.id}`}</span><div style={{ fontSize: 11, color: "var(--text-muted)" }}>start {fmtDateTime(d.startTime)}</div></td>
                      <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{machineLabel(d.machine)}</td>
                      <td style={{ ...TD, color: "var(--text-muted)", textDecoration: "line-through", fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(d.storedEnd)}</td>
                      <td style={{ ...TD, color: "var(--warning)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{d.expectedEnd ? fmtDateTime(d.expectedEnd) : "nelze spočítat"}</td>
                      <td style={TD}><Jump id={d.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>

            {/* 3. Mimo provoz */}
            <Card icon="🚫" title="Bloky mimo provoz stroje" subtitle="Zakázka začíná, když stroj nejede a není to vědomý bypass." count={data.checks.outsideHours.count} defaultOpen={data.checks.outsideHours.count > 0}>
              <TableWrap>
                <thead><tr><th style={TH}>Zakázka</th><th style={TH}>Stroj</th><th style={TH}>Začátek</th><th style={TH}></th></tr></thead>
                <tbody>
                  {data.checks.outsideHours.items.map((d) => (
                    <tr key={d.id}>
                      <td style={{ ...TD, fontWeight: 600 }}>{d.orderNumber || `#${d.id}`}</td>
                      <td style={{ ...TD, fontWeight: 700, fontSize: 12 }}>{machineLabel(d.machine)}</td>
                      <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{fmtDateTime(d.startTime)}</td>
                      <td style={TD}><Jump id={d.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </Card>

            {/* 4. Integrita dat */}
            <Card icon="🧩" title="Integrita dat" subtitle="Osiřelé vazby a neplatné hodnoty." count={data.checks.integrity.count} defaultOpen={data.checks.integrity.count > 0}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, marginTop: 8, border: "1px solid var(--border)", borderRadius: 9, overflow: "hidden" }}>
                {data.checks.integrity.breakdown.map((it) => (
                  <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--surface)", padding: "9px 13px", fontSize: 13 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: it.count > 0 ? "var(--danger)" : "color-mix(in oklab, var(--success) 70%, transparent)" }} />
                    <span>{it.label}</span>
                    <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
                      {it.count > 0 && it.sampleBlockIds[0] != null && <a href={jumpHref(it.sampleBlockIds[0])} style={{ color: "var(--brand)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>Otevřít první →</a>}
                      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: it.count > 0 ? "var(--danger)" : "var(--text-muted)" }}>{it.count}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* 5. Přílohy */}
            <Card icon="📎" title="Přílohy: soubory vs. databáze" subtitle="Metadata v DB bez souboru na disku (nebo naopak)." count={data.checks.attachments.count} defaultOpen={data.checks.attachments.count > 0}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, fontSize: 13 }}>
                <div>Metadata v DB bez souboru na disku: <strong style={{ color: data.checks.attachments.missingFiles.length > 0 ? "var(--danger)" : "var(--text-muted)" }}>{data.checks.attachments.missingFiles.length}</strong></div>
                {data.checks.attachments.missingFiles.map((m) => (
                  <div key={m.id} style={{ fontSize: 12, color: "var(--text-muted)" }}>· rezervace {m.reservationId} · {m.originalName} <code style={{ color: "var(--text-muted)" }}>({m.storageKey})</code></div>
                ))}
                <div style={{ marginTop: 4 }}>Soubor na disku bez metadat: <strong style={{ color: data.checks.attachments.orphanFiles.length > 0 ? "var(--danger)" : "var(--text-muted)" }}>{data.checks.attachments.orphanFiles.length}</strong></div>
                {data.checks.attachments.orphanFiles.map((o, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-muted)" }}>· rezervace {o.reservationId} · <code>{o.storageKey}</code></div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {loading && !data && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Spouštím kontroly…</div>}
    </div>
  );
}
```

- [ ] **Step 2: Build + lint**:
Run: `npm run build`
Expected: build OK.
Run: `npm run lint`
Expected: 0 chyb (warningy OK).

- [ ] **Step 3: Commit**:
```bash
git add src/app/reporty/_components/HealthPanel.tsx
git commit -m "feat(health): HealthPanel komponenta (5 karet, summary, jump do plánu)"
```

---

## Task 7: Integrace do `ReportDashboard`

**Files:**
- Modify: `src/app/reporty/_components/ReportDashboard.tsx`

**Interfaces:**
- Consumes: `HealthPanel` (Task 6).

- [ ] **Step 1: Přidej import** — do `ReportDashboard.tsx` k ostatním importům (za `import { ModuleHeader } ...`):

```tsx
import HealthPanel from "./HealthPanel";
```

- [ ] **Step 2: Vlož panel nahoru do těla** — v `ReportDashboard.tsx` uvnitř `<div style={{ padding: 24 }}>` (tělo, ~ř. 549) HNED za otevírací `<div>` a PŘED „Info bar":

```tsx
      {/* Body */}
      <div style={{ padding: 24 }}>
        <HealthPanel />

        {/* Info bar */}
```

(Panel je nezávislý na `mode`/`timeRange` — vždy nahoře, nad Retro/Výhled.)

- [ ] **Step 3: Build + lint**:
Run: `npm run build`
Expected: build OK.
Run: `npm run lint`
Expected: 0 chyb.

- [ ] **Step 4: Manuální ověření v UI** (dev server, přihlášen jako ADMIN, `/reporty`):
- Nahoře je „Kontrolní panel" se souhrnným proužkem + 5 karet.
- Červené karty rozbalené, zelené sbalené; klik přepíná.
- „Otevřít v plánu →" navede na `/?highlight=<id>` a zvýrazní blok.
- „↻ Překontrolovat teď" přenačte data.
Zaznamenej výsledek (i kdyby vše bylo zeleně — potvrdí prázdný stav).

- [ ] **Step 5: Commit**:
```bash
git add src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(health): vložení Kontrolního panelu nahoru do Reportů"
```

---

## Self-Review (autor plánu)

- **Spec coverage:** 5 kontrol ze specu → Task 1 (překryvy), Task 4 (drift+mimo provoz via bucketDrift/detectCalendarDrift), Task 2 (integrita), Task 3 (přílohy). Endpoint → Task 5. Panel → Task 6. Umístění nahoře + ADMIN + jump → Task 7 + endpoint `requireRole`. ✓
- **Placeholdery:** žádné — každý krok má konkrétní kód/příkaz. ✓
- **Type consistency:** `BlockRow`/`OverlapPair`/`DriftItem`/`IntegrityIssue`/`AttachmentFileRow`/`DiskEntry`/`HealthResult` definované v Tasku 1, konzumované beze změny názvů v 2–4; `runHealthChecks(db: typeof prisma, now)` konzumováno v Tasku 5; client typy v Tasku 6 zrcadlí server tvar s Date→string. ✓
- **Rozhodnutí ze specu:** pasivní (fetch on mount + tlačítko), read-only (jump, žádný fix), červené rozbalené/zelené sbalené (`defaultOpen={count>0}`), integrita nad všemi daty / drift budoucí (`now`→`now+365d`). ✓
- **Pozn. k ověření implementátorem:** (a) `machineLabel` a `MACHINES` existují v `src/lib/machines.ts`; (b) barvy typových chipů — pokud existuje kanonický zdroj (`blockStyles`/`plannerTypes`), použij ho místo lokální `TYPE_CHIP`; (c) cesta příloh `process.cwd()/data/reservation-attachments` — ověř proti existující upload routě a případně sdílej konstantu.
