# Reporting Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přidat manažerský reporting dashboard na `/reporty` s retrospektivou a výhledem — vytížení strojů, průtok zakázek, aktivita plánovačů, pipeline rezervací.

**Architecture:** Nová stránka `/reporty` s server component auth gatekeepingem + client component `ReportDashboard.tsx`. Jeden API endpoint `GET /api/report/dashboard` počítá všechny metriky na serveru. Serverová utility `src/lib/reportMetrics.ts` obsahuje čistou výpočetní logiku (testovatelná bez DB). Middleware ošetří přístup jen pro ADMIN/PLANOVAT.

**Tech Stack:** Next.js 16, React, TypeScript, Prisma 5, CSS inline styly (dark mode přes CSS proměnné), Prague timezone helpers z `src/lib/dateUtils.ts`.

---

### Task 1: Middleware — přidat /reporty route guard

**Files:**
- Modify: `src/middleware.ts:30-46`

- [ ] **Step 1: Přidat role guard pro /reporty**

V `src/middleware.ts`, po bloku pro TISKAR a před blokem pro OBCHODNIK, přidat:

```typescript
// /reporty — jen ADMIN, PLANOVAT
if (pathname.startsWith("/reporty") && !pathname.startsWith("/api/")) {
  const allowed = ["ADMIN", "PLANOVAT"];
  if (!role || !allowed.includes(role)) {
    return NextResponse.redirect(new URL("/", req.url));
  }
}
```

Vložit za řádek 45 (konec bloku `if (role === "OBCHODNIK"...)`), před blok `/rezervace`.

- [ ] **Step 2: Přidat API guard pro /api/report/dashboard**

Za nový blok `/reporty` přidat:

```typescript
// /api/report/dashboard — jen ADMIN, PLANOVAT
if (pathname.startsWith("/api/report/dashboard")) {
  const allowed = ["ADMIN", "PLANOVAT"];
  if (!role || !allowed.includes(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}
```

- [ ] **Step 3: Ověřit build**

Run: `npm run build`
Expected: Build projde bez chyb.

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(reporty): middleware guard pro /reporty a /api/report/dashboard"
```

---

### Task 2: Serverová utilita — výpočet dostupných pracovních hodin

**Files:**
- Create: `src/lib/reportMetrics.ts`
- Create: `src/lib/reportMetrics.test.ts`

- [ ] **Step 1: Napsat test pro `computeAvailableHours`**

Soubor `src/lib/reportMetrics.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAvailableHours } from "./reportMetrics";
import type { MachineWorkHoursTemplate } from "./machineWorkHours";

describe("computeAvailableHours", () => {
  const template: MachineWorkHoursTemplate = {
    id: 1,
    machine: "XL_105",
    label: null,
    validFrom: "2026-01-01",
    validTo: null,
    isDefault: true,
    days: [
      { id: 1, dayOfWeek: 1, startHour: 6, endHour: 22, isActive: true, startSlot: 12, endSlot: 44 },  // Po 16h
      { id: 2, dayOfWeek: 2, startHour: 6, endHour: 22, isActive: true, startSlot: 12, endSlot: 44 },  // Út 16h
      { id: 3, dayOfWeek: 3, startHour: 6, endHour: 22, isActive: true, startSlot: 12, endSlot: 44 },  // St 16h
      { id: 4, dayOfWeek: 4, startHour: 6, endHour: 22, isActive: true, startSlot: 12, endSlot: 44 },  // Čt 16h
      { id: 5, dayOfWeek: 5, startHour: 6, endHour: 22, isActive: true, startSlot: 12, endSlot: 44 },  // Pá 16h
      { id: 6, dayOfWeek: 6, startHour: 0, endHour: 0, isActive: false, startSlot: 0, endSlot: 0 },    // So off
      { id: 7, dayOfWeek: 0, startHour: 0, endHour: 0, isActive: false, startSlot: 0, endSlot: 0 },    // Ne off
    ],
  };

  it("spočítá 80h pro pracovní týden Po-Pá (5 × 16h)", () => {
    // 2026-04-13 = pondělí, 2026-04-17 = pátek
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-17", [template], []);
    assert.equal(result, 80);
  });

  it("vrátí 0 pro víkend", () => {
    // 2026-04-18 = sobota, 2026-04-19 = neděle
    const result = computeAvailableHours("XL_105", "2026-04-18", "2026-04-19", [template], []);
    assert.equal(result, 0);
  });

  it("respektuje exception (zkrácený den)", () => {
    const exception = { machine: "XL_105", date: "2026-04-14", startHour: 6, endHour: 14, isActive: true, startSlot: 12, endSlot: 28 };
    // Po normálně 16h, Út s exception 8h → celkem 24h
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-14", [template], [exception]);
    assert.equal(result, 24);
  });

  it("respektuje exception isActive=false (celý den off)", () => {
    const exception = { machine: "XL_105", date: "2026-04-13", startHour: 0, endHour: 0, isActive: false, startSlot: 0, endSlot: 0 };
    const result = computeAvailableHours("XL_105", "2026-04-13", "2026-04-13", [template], [exception]);
    assert.equal(result, 0);
  });
});
```

- [ ] **Step 2: Spustit test — musí selhat**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — `Cannot find module './reportMetrics'`

- [ ] **Step 3: Implementovat `computeAvailableHours`**

Soubor `src/lib/reportMetrics.ts`:

```typescript
import { resolveScheduleRows } from "./scheduleValidation";
import { pragueToUTC, addDaysToCivilDate } from "./dateUtils";
import type { MachineWorkHoursTemplate } from "./machineWorkHours";

type ExceptionInput = {
  machine: string;
  date: string;
  startHour: number;
  endHour: number;
  isActive: boolean;
  startSlot: number;
  endSlot: number;
};

/**
 * Spočítá dostupné pracovní hodiny pro stroj v rozsahu [rangeStart, rangeEnd] (inkluzivní).
 * rangeStart a rangeEnd jsou YYYY-MM-DD civil date stringy.
 */
export function computeAvailableHours(
  machine: string,
  rangeStart: string,
  rangeEnd: string,
  templates: MachineWorkHoursTemplate[],
  exceptions: ExceptionInput[],
): number {
  let totalHours = 0;
  let cur = rangeStart;

  while (cur <= rangeEnd) {
    const dateAsUtc = pragueToUTC(cur, 12, 0); // poledne — bezpečné pro dayOfWeek
    const excRow = exceptions.find((e) => e.machine === machine && e.date === cur);

    if (excRow) {
      if (excRow.isActive) {
        totalHours += excRow.endHour - excRow.startHour;
      }
      // isActive=false → 0 hodin
    } else {
      const rows = resolveScheduleRows(machine, dateAsUtc, templates);
      const dayOfWeek = dateAsUtc.getUTCDay();
      // pragueToUTC(cur, 12, 0) → noon UTC ≈ 14:00 Prague, getUTCDay stále vrátí správný den
      // Ale pragueOf je přesnější — použijeme dayOfWeek z resolveScheduleRows výstupu
      const dayRow = rows.find((r) => r.dayOfWeek === new Date(pragueToUTC(cur, 12, 0)).getUTCDay());
      if (dayRow && dayRow.isActive) {
        totalHours += dayRow.endHour - dayRow.startHour;
      }
    }

    cur = addDaysToCivilDate(cur, 1);
  }

  return totalHours;
}
```

- [ ] **Step 4: Spustit test — musí projít**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS — 4/4 zelené

- [ ] **Step 5: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "feat(reporty): computeAvailableHours utilita + testy"
```

---

### Task 3: Serverová utilita — výpočet metrik retrospektivy

**Files:**
- Modify: `src/lib/reportMetrics.ts`
- Modify: `src/lib/reportMetrics.test.ts`

- [ ] **Step 1: Napsat test pro `computeUtilization`**

Přidat do `src/lib/reportMetrics.test.ts`:

```typescript
import { computeUtilization, computeThroughput, computeAvgLeadTimeDays, computeMaintenanceRatio, computePlanStability } from "./reportMetrics";

describe("computeUtilization", () => {
  it("vrátí procento vytížení", () => {
    // 40h výroba z 80h dostupných = 50%
    const result = computeUtilization(40, 80);
    assert.equal(result, 50);
  });

  it("vrátí 0 když není dostupný čas", () => {
    const result = computeUtilization(10, 0);
    assert.equal(result, 0);
  });
});

describe("computeThroughput", () => {
  it("počítá bloky s printCompletedAt v rozsahu", () => {
    const blocks = [
      { printCompletedAt: "2026-04-14T10:00:00Z", createdAt: "2026-04-12T08:00:00Z", type: "ZAKAZKA" },
      { printCompletedAt: "2026-04-15T10:00:00Z", createdAt: "2026-04-13T08:00:00Z", type: "ZAKAZKA" },
      { printCompletedAt: null, createdAt: "2026-04-10T08:00:00Z", type: "ZAKAZKA" },
      { printCompletedAt: "2026-04-20T10:00:00Z", createdAt: "2026-04-18T08:00:00Z", type: "ZAKAZKA" },  // mimo rozsah
    ];
    const result = computeThroughput(blocks, "2026-04-13", "2026-04-17");
    assert.equal(result, 2);
  });
});

describe("computeAvgLeadTimeDays", () => {
  it("průměr lead time v dnech", () => {
    const blocks = [
      { printCompletedAt: "2026-04-14T10:00:00Z", createdAt: "2026-04-12T10:00:00Z" },  // 2 dny
      { printCompletedAt: "2026-04-16T10:00:00Z", createdAt: "2026-04-12T10:00:00Z" },  // 4 dny
    ];
    const result = computeAvgLeadTimeDays(blocks, "2026-04-13", "2026-04-17");
    assert.equal(result, 3);
  });

  it("vrátí 0 pro prázdný vstup", () => {
    const result = computeAvgLeadTimeDays([], "2026-04-13", "2026-04-17");
    assert.equal(result, 0);
  });
});

describe("computeMaintenanceRatio", () => {
  it("poměr údržby ku dostupným hodinám", () => {
    // 8h údržba z 80h = 10%
    const result = computeMaintenanceRatio(8, 80);
    assert.equal(result, 10);
  });
});

describe("computePlanStability", () => {
  it("počítá stabilitu z audit logů", () => {
    // 10 bloků celkem, 3 měly přesun = 70% stabilita, 3 přeplánování
    const auditLogs = [
      { blockId: 1, field: "startTime" },
      { blockId: 1, field: "startTime" },  // stejný blok, ale 2 přesuny
      { blockId: 2, field: "machine" },
      { blockId: 3, field: "startTime" },
    ];
    const result = computePlanStability(auditLogs, 10);
    assert.deepEqual(result, { rescheduleCount: 4, movedBlockCount: 3, stabilityPercent: 70 });
  });
});
```

- [ ] **Step 2: Spustit test — musí selhat**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL — funkce neexistují

- [ ] **Step 3: Implementovat metriky**

Přidat do `src/lib/reportMetrics.ts`:

```typescript
/**
 * Vytížení v procentech. productionHours = součet trvání ZAKAZKA bloků.
 */
export function computeUtilization(productionHours: number, availableHours: number): number {
  if (availableHours <= 0) return 0;
  return Math.round((productionHours / availableHours) * 100);
}

/**
 * Počet dokončených zakázek (printCompletedAt v rozsahu).
 */
export function computeThroughput(
  blocks: Array<{ printCompletedAt: string | null; type: string }>,
  rangeStart: string,
  rangeEnd: string,
): number {
  const start = rangeStart + "T00:00:00Z";
  const end = rangeEnd + "T23:59:59Z";
  return blocks.filter(
    (b) => b.type === "ZAKAZKA" && b.printCompletedAt && b.printCompletedAt >= start && b.printCompletedAt <= end
  ).length;
}

/**
 * Průměrný lead time v dnech (printCompletedAt - createdAt).
 */
export function computeAvgLeadTimeDays(
  blocks: Array<{ printCompletedAt: string | null; createdAt: string }>,
  rangeStart: string,
  rangeEnd: string,
): number {
  const start = rangeStart + "T00:00:00Z";
  const end = rangeEnd + "T23:59:59Z";
  const completed = blocks.filter(
    (b) => b.printCompletedAt && b.printCompletedAt >= start && b.printCompletedAt <= end
  );
  if (completed.length === 0) return 0;
  const totalDays = completed.reduce((sum, b) => {
    const diff = new Date(b.printCompletedAt!).getTime() - new Date(b.createdAt).getTime();
    return sum + diff / (1000 * 60 * 60 * 24);
  }, 0);
  return Math.round((totalDays / completed.length) * 10) / 10;
}

/**
 * Poměr údržby v procentech.
 */
export function computeMaintenanceRatio(maintenanceHours: number, availableHours: number): number {
  if (availableHours <= 0) return 0;
  return Math.round((maintenanceHours / availableHours) * 100);
}

/**
 * Stabilita plánu z audit logů.
 * Přesun = AuditLog s field IN (startTime, endTime, machine) a action=UPDATE.
 */
export function computePlanStability(
  auditLogs: Array<{ blockId: number; field: string | null }>,
  totalBlockCount: number,
): { rescheduleCount: number; movedBlockCount: number; stabilityPercent: number } {
  const moves = auditLogs.filter(
    (a) => a.field === "startTime" || a.field === "endTime" || a.field === "machine"
  );
  const rescheduleCount = moves.length;
  const movedBlockIds = new Set(moves.map((a) => a.blockId));
  const movedBlockCount = movedBlockIds.size;
  const stabilityPercent = totalBlockCount === 0 ? 100 : Math.round(((totalBlockCount - movedBlockCount) / totalBlockCount) * 100);
  return { rescheduleCount, movedBlockCount, stabilityPercent };
}
```

- [ ] **Step 4: Spustit test — musí projít**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS — všechny testy zelené

- [ ] **Step 5: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "feat(reporty): metriky retrospektivy — utilization, throughput, leadTime, stability"
```

---

### Task 4: Serverová utilita — výpočet hodin bloků

**Files:**
- Modify: `src/lib/reportMetrics.ts`
- Modify: `src/lib/reportMetrics.test.ts`

- [ ] **Step 1: Napsat test pro `computeBlockHours`**

Přidat do `src/lib/reportMetrics.test.ts`:

```typescript
import { computeBlockHours } from "./reportMetrics";

describe("computeBlockHours", () => {
  it("sečte hodiny zakázkových bloků", () => {
    const blocks = [
      { startTime: "2026-04-14T06:00:00Z", endTime: "2026-04-14T14:00:00Z", type: "ZAKAZKA", machine: "XL_105" },
      { startTime: "2026-04-14T14:00:00Z", endTime: "2026-04-14T18:00:00Z", type: "ZAKAZKA", machine: "XL_105" },
      { startTime: "2026-04-14T06:00:00Z", endTime: "2026-04-14T10:00:00Z", type: "UDRZBA", machine: "XL_105" },
    ];
    assert.equal(computeBlockHours(blocks, "XL_105", "ZAKAZKA"), 12);
  });

  it("filtruje podle stroje", () => {
    const blocks = [
      { startTime: "2026-04-14T06:00:00Z", endTime: "2026-04-14T14:00:00Z", type: "ZAKAZKA", machine: "XL_105" },
      { startTime: "2026-04-14T06:00:00Z", endTime: "2026-04-14T14:00:00Z", type: "ZAKAZKA", machine: "XL_106" },
    ];
    assert.equal(computeBlockHours(blocks, "XL_105", "ZAKAZKA"), 8);
  });
});
```

- [ ] **Step 2: Spustit test — musí selhat**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementovat `computeBlockHours`**

Přidat do `src/lib/reportMetrics.ts`:

```typescript
/**
 * Součet hodin bloků daného typu na daném stroji.
 */
export function computeBlockHours(
  blocks: Array<{ startTime: string; endTime: string; type: string; machine: string }>,
  machine: string,
  type: string,
): number {
  return blocks
    .filter((b) => b.machine === machine && b.type === type)
    .reduce((sum, b) => {
      const ms = new Date(b.endTime).getTime() - new Date(b.startTime).getTime();
      return sum + ms / (1000 * 60 * 60);
    }, 0);
}
```

- [ ] **Step 4: Spustit test — musí projít**

Run: `node --test --import tsx src/lib/reportMetrics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/reportMetrics.ts src/lib/reportMetrics.test.ts
git commit -m "feat(reporty): computeBlockHours utilita + testy"
```

---

### Task 5: API endpoint — GET /api/report/dashboard (retrospektiva)

**Files:**
- Create: `src/app/api/report/dashboard/route.ts`

- [ ] **Step 1: Vytvořit API route pro retrospektivu**

Soubor `src/app/api/report/dashboard/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { isCivilDateString, addDaysToCivilDate, pragueToUTC } from "@/lib/dateUtils";
import { resolveScheduleRows, serializeTemplates } from "@/lib/scheduleValidation";
import {
  computeAvailableHours,
  computeBlockHours,
  computeUtilization,
  computeThroughput,
  computeAvgLeadTimeDays,
  computeMaintenanceRatio,
  computePlanStability,
} from "@/lib/reportMetrics";

const MACHINES = ["XL_105", "XL_106"] as const;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode"); // "retro" | "outlook"
  const rangeStart = searchParams.get("rangeStart");
  const rangeEnd = searchParams.get("rangeEnd");

  if (!mode || !["retro", "outlook"].includes(mode)) {
    return NextResponse.json({ error: "Chybí parametr mode (retro|outlook)" }, { status: 400 });
  }
  if (!rangeStart || !rangeEnd || !isCivilDateString(rangeStart) || !isCivilDateString(rangeEnd)) {
    return NextResponse.json({ error: "Chybí parametry rangeStart a rangeEnd (YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    const startUtc = pragueToUTC(rangeStart, 0, 0);
    const endUtc = pragueToUTC(addDaysToCivilDate(rangeEnd, 1), 0, 0); // konec dne = půlnoc dalšího dne

    if (mode === "retro") {
      return await handleRetro(rangeStart, rangeEnd, startUtc, endUtc);
    } else {
      return await handleOutlook(rangeStart, rangeEnd, startUtc, endUtc);
    }
  } catch (error) {
    logger.error("[GET /api/report/dashboard]", error);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

async function handleRetro(rangeStart: string, rangeEnd: string, startUtc: Date, endUtc: Date) {
  // Paralelní fetch dat
  const [blocks, auditLogs, templates, exceptions, reservations, companyDays] = await Promise.all([
    prisma.block.findMany({
      where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
      select: {
        id: true, machine: true, type: true,
        startTime: true, endTime: true,
        createdAt: true, printCompletedAt: true,
      },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: startUtc, lt: endUtc }, action: "UPDATE" },
      select: { blockId: true, field: true, username: true },
    }),
    prisma.machineWorkHoursTemplate.findMany({
      include: { days: true },
    }),
    prisma.machineScheduleException.findMany({
      where: { date: { gte: startUtc, lt: endUtc } },
    }),
    prisma.reservation.findMany({
      where: {
        OR: [
          { createdAt: { gte: startUtc, lt: endUtc } },
          { status: { in: ["SUBMITTED", "ACCEPTED", "QUEUE_READY"] } },
        ],
      },
      select: { status: true },
    }),
    prisma.companyDay.findMany({
      where: { startDate: { lt: endUtc }, endDate: { gte: startUtc } },
    }),
  ]);

  const serializedTemplates = serializeTemplates(templates);
  const serializedExceptions = exceptions.map((e) => ({
    machine: e.machine,
    date: e.date.toISOString().slice(0, 10),
    startHour: e.startHour,
    endHour: e.endHour,
    isActive: e.isActive,
    startSlot: e.startSlot ?? e.startHour * 2,
    endSlot: e.endSlot ?? e.endHour * 2,
  }));

  const serializedBlocks = blocks.map((b) => ({
    id: b.id,
    machine: b.machine,
    type: b.type,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    createdAt: b.createdAt.toISOString(),
    printCompletedAt: b.printCompletedAt?.toISOString() ?? null,
  }));

  // Výpočet per stroj
  const machineData: Record<string, { utilization: number; productionHours: number; maintenanceHours: number; availableHours: number }> = {};
  for (const machine of MACHINES) {
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, serializedTemplates, serializedExceptions);
    const productionHours = computeBlockHours(serializedBlocks, machine, "ZAKAZKA");
    const maintenanceHours = computeBlockHours(serializedBlocks, machine, "UDRZBA");
    machineData[machine] = {
      utilization: computeUtilization(productionHours, availableHours),
      productionHours: Math.round(productionHours * 10) / 10,
      maintenanceHours: Math.round(maintenanceHours * 10) / 10,
      availableHours,
    };
  }

  // Denní vytížení
  const dailyUtilization: Array<{ date: string; XL_105: number; XL_106: number }> = [];
  let cur = rangeStart;
  while (cur <= rangeEnd) {
    const dayStart = pragueToUTC(cur, 0, 0);
    const dayEnd = pragueToUTC(addDaysToCivilDate(cur, 1), 0, 0);
    const dayBlocks = serializedBlocks.filter(
      (b) => new Date(b.startTime) < dayEnd && new Date(b.endTime) > dayStart
    );
    const entry: { date: string; XL_105: number; XL_106: number } = { date: cur, XL_105: 0, XL_106: 0 };
    for (const machine of MACHINES) {
      const avail = computeAvailableHours(machine, cur, cur, serializedTemplates, serializedExceptions);
      const prod = computeBlockHours(dayBlocks, machine, "ZAKAZKA");
      entry[machine] = computeUtilization(prod, avail);
    }
    dailyUtilization.push(entry);
    cur = addDaysToCivilDate(cur, 1);
  }

  // Celkové metriky
  const totalAvailable = Object.values(machineData).reduce((s, m) => s + m.availableHours, 0);
  const totalMaintenance = Object.values(machineData).reduce((s, m) => s + m.maintenanceHours, 0);
  const throughput = computeThroughput(serializedBlocks, rangeStart, rangeEnd);
  const avgLeadTimeDays = computeAvgLeadTimeDays(serializedBlocks, rangeStart, rangeEnd);
  const maintenanceRatio = computeMaintenanceRatio(totalMaintenance, totalAvailable);

  // Stabilita plánu
  const planStability = computePlanStability(
    auditLogs.map((a) => ({ blockId: a.blockId, field: a.field })),
    serializedBlocks.filter((b) => b.type === "ZAKAZKA").length
  );

  // Aktivita plánovačů
  const plannerActions = new Map<string, number>();
  for (const log of auditLogs) {
    plannerActions.set(log.username, (plannerActions.get(log.username) ?? 0) + 1);
  }
  const plannerActivity = Array.from(plannerActions.entries())
    .map(([username, actionCount]) => ({ username, actionCount }))
    .sort((a, b) => b.actionCount - a.actionCount);

  // Pipeline rezervací
  const pipeline: Record<string, number> = { SUBMITTED: 0, ACCEPTED: 0, QUEUE_READY: 0, SCHEDULED: 0, REJECTED: 0 };
  for (const r of reservations) {
    if (r.status in pipeline) pipeline[r.status]++;
  }
  const totalDecided = pipeline.SCHEDULED + pipeline.REJECTED;
  const conversionPercent = totalDecided === 0 ? 0 : Math.round((pipeline.SCHEDULED / totalDecided) * 100);

  return NextResponse.json({
    machines: machineData,
    dailyUtilization,
    throughput,
    avgLeadTimeDays,
    maintenanceRatio,
    planning: {
      rescheduleCount: planStability.rescheduleCount,
      stabilityPercent: planStability.stabilityPercent,
    },
    plannerActivity,
    pipeline: { ...pipeline, conversionPercent },
  });
}

async function handleOutlook(rangeStart: string, rangeEnd: string, startUtc: Date, endUtc: Date) {
  const [blocks, templates, exceptions, reservations] = await Promise.all([
    prisma.block.findMany({
      where: { startTime: { lt: endUtc }, endTime: { gt: startUtc } },
      select: { id: true, machine: true, type: true, startTime: true, endTime: true, description: true },
    }),
    prisma.machineWorkHoursTemplate.findMany({ include: { days: true } }),
    prisma.machineScheduleException.findMany({
      where: { date: { gte: startUtc, lt: endUtc } },
    }),
    prisma.reservation.findMany({
      where: { status: { in: ["SUBMITTED", "QUEUE_READY"] } },
      select: { status: true, createdAt: true },
    }),
  ]);

  const serializedTemplates = serializeTemplates(templates);
  const serializedExceptions = exceptions.map((e) => ({
    machine: e.machine,
    date: e.date.toISOString().slice(0, 10),
    startHour: e.startHour,
    endHour: e.endHour,
    isActive: e.isActive,
    startSlot: e.startSlot ?? e.startHour * 2,
    endSlot: e.endSlot ?? e.endHour * 2,
  }));

  const serializedBlocks = blocks.map((b) => ({
    id: b.id,
    machine: b.machine,
    type: b.type,
    startTime: b.startTime.toISOString(),
    endTime: b.endTime.toISOString(),
    description: b.description,
  }));

  // Kapacita per stroj
  const machineData: Record<string, { plannedCapacity: number; freeHours: number; availableHours: number }> = {};
  for (const machine of MACHINES) {
    const availableHours = computeAvailableHours(machine, rangeStart, rangeEnd, serializedTemplates, serializedExceptions);
    const plannedHours = computeBlockHours(serializedBlocks.map((b) => ({ ...b, createdAt: "", printCompletedAt: null })), machine, "ZAKAZKA")
      + computeBlockHours(serializedBlocks.map((b) => ({ ...b, createdAt: "", printCompletedAt: null })), machine, "REZERVACE")
      + computeBlockHours(serializedBlocks.map((b) => ({ ...b, createdAt: "", printCompletedAt: null })), machine, "UDRZBA");
    machineData[machine] = {
      plannedCapacity: computeUtilization(plannedHours, availableHours),
      freeHours: Math.round(Math.max(0, availableHours - plannedHours) * 10) / 10,
      availableHours,
    };
  }

  // Denní kapacita (heatmapa)
  const dailyCapacity: Array<{ date: string; XL_105: number; XL_106: number }> = [];
  let cur = rangeStart;
  while (cur <= rangeEnd) {
    const dayStart = pragueToUTC(cur, 0, 0);
    const dayEnd = pragueToUTC(addDaysToCivilDate(cur, 1), 0, 0);
    const dayBlocks = serializedBlocks.filter(
      (b) => new Date(b.startTime) < dayEnd && new Date(b.endTime) > dayStart
    );
    const entry: { date: string; XL_105: number; XL_106: number } = { date: cur, XL_105: 0, XL_106: 0 };
    for (const machine of MACHINES) {
      const avail = computeAvailableHours(machine, cur, cur, serializedTemplates, serializedExceptions);
      const planned = dayBlocks
        .filter((b) => b.machine === machine)
        .reduce((sum, b) => {
          const ms = new Date(b.endTime).getTime() - new Date(b.startTime).getTime();
          return sum + ms / (1000 * 60 * 60);
        }, 0);
      entry[machine] = computeUtilization(planned, avail);
    }
    dailyCapacity.push(entry);
    cur = addDaysToCivilDate(cur, 1);
  }

  // Plánované údržby
  const upcomingMaintenance = serializedBlocks
    .filter((b) => b.type === "UDRZBA")
    .map((b) => ({
      machine: b.machine,
      description: b.description ?? "Údržba",
      startTime: b.startTime,
      endTime: b.endTime,
    }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Čekající rezervace
  const newReservations = reservations.filter((r) => r.status === "SUBMITTED");
  const queueReservations = reservations.filter((r) => r.status === "QUEUE_READY");
  const now = new Date();
  const oldestWaitingDays = newReservations.length === 0 ? 0 :
    Math.round(
      (now.getTime() - Math.min(...newReservations.map((r) => r.createdAt.getTime()))) / (1000 * 60 * 60 * 24) * 10
    ) / 10;

  return NextResponse.json({
    machines: machineData,
    dailyCapacity,
    upcomingMaintenance,
    pendingReservations: {
      newCount: newReservations.length,
      queueCount: queueReservations.length,
      oldestWaitingDays,
    },
  });
}
```

- [ ] **Step 2: Ověřit build**

Run: `npm run build`
Expected: Build projde.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/report/dashboard/route.ts
git commit -m "feat(reporty): API endpoint GET /api/report/dashboard (retro + outlook)"
```

---

### Task 6: Stránka /reporty — server component + prázdný client shell

**Files:**
- Create: `src/app/reporty/page.tsx`
- Create: `src/app/reporty/_components/ReportDashboard.tsx`

- [ ] **Step 1: Vytvořit server component page**

Soubor `src/app/reporty/page.tsx`:

```typescript
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import ReportDashboard from "./_components/ReportDashboard";

export default async function ReportyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) redirect("/");

  return <ReportDashboard />;
}
```

- [ ] **Step 2: Vytvořit prázdný client component shell**

Soubor `src/app/reporty/_components/ReportDashboard.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { addDaysToCivilDate, todayPragueDateStr } from "@/lib/dateUtils";

type Mode = "retro" | "outlook";
type TimeRange = "today" | "week" | "month" | "custom";

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay(); // 0=Ne
  const diff = day === 0 ? 6 : day - 1; // pondělí = začátek týdne
  return addDaysToCivilDate(dateStr, -diff);
}

function getMonthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

function getMonthEnd(dateStr: string): string {
  const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

function computeRange(timeRange: TimeRange, today: string, customStart?: string, customEnd?: string): { start: string; end: string } {
  switch (timeRange) {
    case "today": return { start: today, end: today };
    case "week": return { start: getWeekStart(today), end: addDaysToCivilDate(getWeekStart(today), 6) };
    case "month": return { start: getMonthStart(today), end: getMonthEnd(today) };
    case "custom": return { start: customStart ?? today, end: customEnd ?? today };
  }
}

const TEXT_PRIMARY = "var(--text)";
const TEXT_SECONDARY = "var(--text-muted)";

export default function ReportDashboard() {
  const today = todayPragueDateStr();
  const [mode, setMode] = useState<Mode>("retro");
  const [timeRange, setTimeRange] = useState<TimeRange>("month");
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { start, end } = computeRange(timeRange, today, customStart, customEnd);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/report/dashboard?mode=${mode}&rangeStart=${start}&rangeEnd=${end}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [mode, start, end]);

  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      background: "var(--bg)", color: TEXT_PRIMARY,
      minHeight: "100vh", padding: "20px 24px",
    }}>
      {/* Hlavička */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Reporty</h1>
        <a href="/" style={{ fontSize: 12, color: TEXT_SECONDARY, textDecoration: "none" }}>← Zpět na planner</a>
      </div>

      {/* Přepínače */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {/* Režim */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["retro", "outlook"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: "5px 14px", borderRadius: 6, fontSize: 12, fontWeight: mode === m ? 600 : 400,
              background: mode === m ? "var(--brand)" : "var(--surface-2)",
              color: mode === m ? "var(--brand-contrast)" : TEXT_SECONDARY,
              border: mode === m ? "none" : "1px solid var(--border)", cursor: "pointer",
            }}>
              {m === "retro" ? "Retrospektiva" : "Výhled"}
            </button>
          ))}
        </div>
        {/* Časový rozsah */}
        <div style={{ display: "flex", gap: 4 }}>
          {([["today", "Dnes"], ["week", "Týden"], ["month", "Měsíc"], ["custom", "Custom"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTimeRange(key as TimeRange)} style={{
              padding: "5px 12px", borderRadius: 6, fontSize: 12, fontWeight: timeRange === key ? 600 : 400,
              background: timeRange === key ? "var(--brand)" : "var(--surface-2)",
              color: timeRange === key ? "var(--brand-contrast)" : TEXT_SECONDARY,
              border: timeRange === key ? "none" : "1px solid var(--border)", cursor: "pointer",
            }}>
              {label}
            </button>
          ))}
        </div>
        {/* Custom date inputs */}
        {timeRange === "custom" && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: TEXT_PRIMARY, fontSize: 12 }} />
            <span style={{ color: TEXT_SECONDARY, fontSize: 12 }}>–</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: TEXT_PRIMARY, fontSize: 12 }} />
          </div>
        )}
      </div>

      {/* Rozsah info */}
      <div style={{ fontSize: 11, color: TEXT_SECONDARY, marginBottom: 16 }}>
        {start} → {end}
      </div>

      {/* Obsah */}
      {loading && <div style={{ color: TEXT_SECONDARY, padding: 40 }}>Načítám data…</div>}
      {error && <div style={{ color: "var(--danger)", padding: 40 }}>Chyba: {error}</div>}
      {!loading && !error && data && (
        <div style={{ color: TEXT_SECONDARY, padding: 40 }}>
          Data načtena. UI se doplní v dalších taskách.
          <pre style={{ fontSize: 10, marginTop: 12, maxHeight: 300, overflow: "auto" }}>
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Ověřit build**

Run: `npm run build`
Expected: Build projde.

- [ ] **Step 4: Commit**

```bash
git add src/app/reporty/page.tsx src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(reporty): stránka /reporty se shell komponentou a data fetchem"
```

---

### Task 7: Navigační tlačítko v PlannerPage headeru

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx:2686-2699`

- [ ] **Step 1: Přidat tlačítko Reporty**

V `src/app/_components/PlannerPage.tsx`, za odkaz `Správa</a>` (řádek 2686) a před blok `{["ADMIN", "PLANOVAT", "OBCHODNIK"]...` (řádek 2688), vložit:

```typescript
          <a
            href="/reporty"
            style={{
              height: 28, padding: "0 10px", borderRadius: 8,
              display: "flex", alignItems: "center",
              background: "var(--surface-2)", border: "1px solid var(--border)",
              color: "#10b981", fontSize: 12, cursor: "pointer",
              textDecoration: "none", whiteSpace: "nowrap", transition: "all 120ms ease-out",
            }}
          >Reporty</a>
```

Poznámka: tlačítko je uvnitř bloku `{["ADMIN", "PLANOVAT"].includes(currentUser.role) && (...)}`, takže se zobrazí jen pro správné role. Vložit ho za `Správa</a>` ale **před uzavírací `)}` toho bloku** — tedy přidat do stejného fragmentu. Pokud to nejde (protože je tam jen jeden element), obalit oba do `<>...</>`:

Najít existující blok:
```typescript
{["ADMIN", "PLANOVAT"].includes(currentUser.role) && (
  <a href="/admin" ...>Správa</a>
)}
```

Změnit na:
```typescript
{["ADMIN", "PLANOVAT"].includes(currentUser.role) && (
  <>
    <a href="/admin" ...>Správa</a>
    <a
      href="/reporty"
      style={{
        height: 28, padding: "0 10px", borderRadius: 8,
        display: "flex", alignItems: "center",
        background: "var(--surface-2)", border: "1px solid var(--border)",
        color: "#10b981", fontSize: 12, cursor: "pointer",
        textDecoration: "none", whiteSpace: "nowrap", transition: "all 120ms ease-out",
      }}
    >Reporty</a>
  </>
)}
```

- [ ] **Step 2: Ověřit build**

Run: `npm run build`
Expected: Build projde.

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(reporty): navigační tlačítko Reporty v headeru planneru"
```

---

### Task 8: ReportDashboard — KPI karty

**Files:**
- Modify: `src/app/reporty/_components/ReportDashboard.tsx`

- [ ] **Step 1: Přidat typy pro API response**

Na začátek `ReportDashboard.tsx` (za importy) přidat:

```typescript
interface RetroMachineData {
  utilization: number;
  productionHours: number;
  maintenanceHours: number;
  availableHours: number;
}

interface RetroData {
  machines: Record<string, RetroMachineData>;
  dailyUtilization: Array<{ date: string; XL_105: number; XL_106: number }>;
  throughput: number;
  avgLeadTimeDays: number;
  maintenanceRatio: number;
  planning: { rescheduleCount: number; stabilityPercent: number };
  plannerActivity: Array<{ username: string; actionCount: number }>;
  pipeline: { SUBMITTED: number; ACCEPTED: number; QUEUE_READY: number; SCHEDULED: number; REJECTED: number; conversionPercent: number };
}

interface OutlookMachineData {
  plannedCapacity: number;
  freeHours: number;
  availableHours: number;
}

interface OutlookData {
  machines: Record<string, OutlookMachineData>;
  dailyCapacity: Array<{ date: string; XL_105: number; XL_106: number }>;
  upcomingMaintenance: Array<{ machine: string; description: string; startTime: string; endTime: string }>;
  pendingReservations: { newCount: number; queueCount: number; oldestWaitingDays: number };
}
```

- [ ] **Step 2: Vytvořit KpiCard komponentu**

Přidat do `ReportDashboard.tsx` (před `export default`):

```typescript
function KpiCard({ label, value, subtitle, color }: { label: string; value: string | number; subtitle?: string; color?: string }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
      padding: "14px 16px", flex: "1 1 0",
    }}>
      <div style={{ fontSize: 11, color: TEXT_SECONDARY, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: color ?? TEXT_PRIMARY }}>{value}</div>
      {subtitle && <div style={{ fontSize: 10, color: TEXT_SECONDARY, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Nahradit placeholder obsah KPI kartami**

Nahradit `{!loading && !error && data && (...)}` blok:

```typescript
{!loading && !error && data && mode === "retro" && (() => {
  const d = data as RetroData;
  return (
    <>
      {/* KPI karty */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <KpiCard label="Vytížení XL 105" value={`${d.machines.XL_105?.utilization ?? 0}%`}
          color={d.machines.XL_105?.utilization >= 80 ? "#3fb950" : "#f0883e"} />
        <KpiCard label="Vytížení XL 106" value={`${d.machines.XL_106?.utilization ?? 0}%`}
          color={d.machines.XL_106?.utilization >= 80 ? "#3fb950" : "#f0883e"} />
        <KpiCard label="Průtok zakázek" value={d.throughput} subtitle="dokončených" />
        <KpiCard label="Ø Lead time" value={`${d.avgLeadTimeDays}d`} subtitle="plan → tisk" />
      </div>
    </>
  );
})()}

{!loading && !error && data && mode === "outlook" && (() => {
  const d = data as OutlookData;
  return (
    <>
      {/* KPI karty */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <KpiCard label="Kapacita XL 105" value={`${d.machines.XL_105?.plannedCapacity ?? 0}%`}
          color={d.machines.XL_105?.plannedCapacity >= 80 ? "#3fb950" : "#f0883e"} />
        <KpiCard label="Kapacita XL 106" value={`${d.machines.XL_106?.plannedCapacity ?? 0}%`}
          color={d.machines.XL_106?.plannedCapacity >= 80 ? "#3fb950" : "#f0883e"} />
        <KpiCard label="Volné hod. XL 105" value={`${d.machines.XL_105?.freeHours ?? 0}h`} />
        <KpiCard label="Volné hod. XL 106" value={`${d.machines.XL_106?.freeHours ?? 0}h`} />
      </div>
    </>
  );
})()}
```

- [ ] **Step 4: Ověřit build**

Run: `npm run build`
Expected: Build projde.

- [ ] **Step 5: Commit**

```bash
git add src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(reporty): KPI karty pro retrospektivu i výhled"
```

---

### Task 9: ReportDashboard — sekce VÝROBA (graf + metriky)

**Files:**
- Modify: `src/app/reporty/_components/ReportDashboard.tsx`

- [ ] **Step 1: Vytvořit BarChart komponentu**

Přidat do `ReportDashboard.tsx`:

```typescript
function BarChart({ data, barKeys, colors, labels }: {
  data: Array<Record<string, number | string>>;
  barKeys: string[];
  colors: string[];
  labels?: string[];
}) {
  const maxVal = Math.max(...data.flatMap((d) => barKeys.map((k) => (d[k] as number) ?? 0)), 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", gap: 1, flex: 1 }}>
            {barKeys.map((k, ki) => (
              <div key={k} style={{
                flex: 1, background: colors[ki],
                borderRadius: "2px 2px 0 0",
                height: `${Math.max(2, ((d[k] as number) ?? 0) / maxVal * 100)}%`,
                minHeight: 2,
              }} title={`${d.date ?? ""}: ${d[k]}%`} />
            ))}
          </div>
        ))}
      </div>
      {labels && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          {labels.map((l, i) => <span key={i} style={{ fontSize: 8, color: TEXT_SECONDARY }}>{l}</span>)}
        </div>
      )}
      <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
        {barKeys.map((k, i) => (
          <span key={k} style={{ fontSize: 9, color: colors[i] }}>■ {k.replace("_", " ")}</span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Přidat SectionHeader komponentu**

```typescript
function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 12, color: "var(--brand)", fontWeight: 600,
      borderBottom: "1px solid var(--border)", paddingBottom: 4, marginBottom: 12, marginTop: 24,
    }}>
      {label}
    </div>
  );
}
```

- [ ] **Step 3: Přidat sekci VÝROBA do retrospektivy**

Za KPI karty retrospektivy (za `</div>` po KPI kartách), přidat:

```typescript
{/* Sekce VÝROBA */}
<SectionHeader label="VÝROBA" />
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
    <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, marginBottom: 8 }}>Vytížení strojů (denně)</div>
    <BarChart
      data={d.dailyUtilization}
      barKeys={["XL_105", "XL_106"]}
      colors={["#3b82f6", "#f0883e"]}
      labels={d.dailyUtilization.filter((_, i, arr) => i === 0 || i === arr.length - 1).map((v) => v.date.slice(5))}
    />
  </div>
  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <div style={{ fontSize: 10, color: TEXT_SECONDARY }}>Údržba vs výroba</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{d.maintenanceRatio}%</div>
      <div style={{ fontSize: 9, color: TEXT_SECONDARY }}>z celkového dostupného času</div>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, textAlign: "center" }}>
        <div style={{ fontSize: 9, color: TEXT_SECONDARY }}>Výroba XL 105</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{d.machines.XL_105?.productionHours ?? 0}h</div>
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 10, textAlign: "center" }}>
        <div style={{ fontSize: 9, color: TEXT_SECONDARY }}>Výroba XL 106</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{d.machines.XL_106?.productionHours ?? 0}h</div>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Ověřit build**

Run: `npm run build`
Expected: Build projde.

- [ ] **Step 5: Commit**

```bash
git add src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(reporty): sekce VÝROBA — graf vytížení + metriky"
```

---

### Task 10: ReportDashboard — sekce PLÁNOVÁNÍ + OBCHOD (retrospektiva)

**Files:**
- Modify: `src/app/reporty/_components/ReportDashboard.tsx`

- [ ] **Step 1: Přidat sekci PLÁNOVÁNÍ**

Za sekci VÝROBA přidat:

```typescript
{/* Sekce PLÁNOVÁNÍ */}
<SectionHeader label="PLÁNOVÁNÍ" />
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: TEXT_SECONDARY }}>Přeplánování</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#f0883e", marginTop: 4 }}>{d.planning.rescheduleCount}×</div>
      <div style={{ fontSize: 9, color: TEXT_SECONDARY }}>bloky přesunuty</div>
    </div>
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, textAlign: "center" }}>
      <div style={{ fontSize: 10, color: TEXT_SECONDARY }}>Stabilita plánu</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: d.planning.stabilityPercent >= 70 ? "#3fb950" : "#f0883e", marginTop: 4 }}>{d.planning.stabilityPercent}%</div>
      <div style={{ fontSize: 9, color: TEXT_SECONDARY }}>bloků beze změny</div>
    </div>
  </div>
  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
    <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, marginBottom: 8 }}>Aktivita plánovačů</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {d.plannerActivity.map((p) => {
        const maxActions = d.plannerActivity[0]?.actionCount ?? 1;
        return (
          <div key={p.username} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12 }}>{p.username}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 80, height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(p.actionCount / maxActions) * 100}%`, height: "100%", background: "var(--brand)", borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: 10, color: TEXT_SECONDARY, width: 36, textAlign: "right" }}>{p.actionCount}</span>
            </div>
          </div>
        );
      })}
      {d.plannerActivity.length === 0 && <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontStyle: "italic" }}>Žádná aktivita</div>}
    </div>
  </div>
</div>
```

- [ ] **Step 2: Přidat sekci OBCHOD**

```typescript
{/* Sekce OBCHOD */}
<SectionHeader label="OBCHOD" />
<div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
  <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, marginBottom: 8 }}>Pipeline rezervací</div>
  {/* Stacked bar */}
  {(() => {
    const total = d.pipeline.SUBMITTED + d.pipeline.ACCEPTED + d.pipeline.QUEUE_READY + d.pipeline.SCHEDULED + d.pipeline.REJECTED;
    if (total === 0) return <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontStyle: "italic" }}>Žádné rezervace</div>;
    const segments = [
      { key: "SUBMITTED", label: "Nové", color: "#f0883e", count: d.pipeline.SUBMITTED },
      { key: "ACCEPTED", label: "Přijaté", color: "#3b82f6", count: d.pipeline.ACCEPTED },
      { key: "QUEUE_READY", label: "Ve frontě", color: "#a371f7", count: d.pipeline.QUEUE_READY },
      { key: "SCHEDULED", label: "Naplánované", color: "#3fb950", count: d.pipeline.SCHEDULED },
      { key: "REJECTED", label: "Zamítnuté", color: "#f85149", count: d.pipeline.REJECTED },
    ];
    return (
      <>
        <div style={{ display: "flex", gap: 2, height: 14, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
          {segments.filter((s) => s.count > 0).map((s) => (
            <div key={s.key} style={{ width: `${(s.count / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.count}`} />
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11 }}>
          {segments.map((s) => (
            <span key={s.key}><span style={{ color: s.color }}>●</span> {s.label} <strong>{s.count}</strong></span>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "var(--brand)", marginTop: 6 }}>Konverze: {d.pipeline.conversionPercent}%</div>
      </>
    );
  })()}
</div>
```

- [ ] **Step 3: Ověřit build**

Run: `npm run build`
Expected: Build projde.

- [ ] **Step 4: Commit**

```bash
git add src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(reporty): sekce PLÁNOVÁNÍ + OBCHOD s pipeline vizualizací"
```

---

### Task 11: ReportDashboard — výhled (heatmapa + rizika)

**Files:**
- Modify: `src/app/reporty/_components/ReportDashboard.tsx`

- [ ] **Step 1: Přidat heatmapu a rizika do výhledového režimu**

Za KPI karty výhledu přidat:

```typescript
{/* Sekce KAPACITA */}
<SectionHeader label="KAPACITA" />
<div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, marginBottom: 16 }}>
  <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, marginBottom: 8 }}>Obsazenost po dnech</div>
  <div style={{ display: "grid", gridTemplateColumns: `60px repeat(${Math.min(d.dailyCapacity.length, 14)}, 1fr)`, gap: 3, fontSize: 9 }}>
    {/* Hlavička — dny */}
    <div />
    {d.dailyCapacity.slice(0, 14).map((day) => {
      const dow = ["Ne","Po","Út","St","Čt","Pá","So"][new Date(day.date + "T12:00:00Z").getUTCDay()];
      return <div key={day.date} style={{ textAlign: "center", color: TEXT_SECONDARY, fontSize: 8 }}>{dow}<br/>{day.date.slice(8)}</div>;
    })}
    {/* XL 105 */}
    <div style={{ color: TEXT_SECONDARY, display: "flex", alignItems: "center" }}>XL 105</div>
    {d.dailyCapacity.slice(0, 14).map((day) => (
      <div key={`105-${day.date}`} style={{
        height: 24, borderRadius: 4,
        background: day.XL_105 === 0 ? "var(--surface-2)" : day.XL_105 >= 80 ? "#3fb950" : day.XL_105 >= 50 ? "#f0883e" : "#f85149",
        opacity: day.XL_105 === 0 ? 1 : 0.7 + (day.XL_105 / 100) * 0.3,
      }} title={`${day.date}: ${day.XL_105}%`} />
    ))}
    {/* XL 106 */}
    <div style={{ color: TEXT_SECONDARY, display: "flex", alignItems: "center" }}>XL 106</div>
    {d.dailyCapacity.slice(0, 14).map((day) => (
      <div key={`106-${day.date}`} style={{
        height: 24, borderRadius: 4,
        background: day.XL_106 === 0 ? "var(--surface-2)" : day.XL_106 >= 80 ? "#3fb950" : day.XL_106 >= 50 ? "#f0883e" : "#f85149",
        opacity: day.XL_106 === 0 ? 1 : 0.7 + (day.XL_106 / 100) * 0.3,
      }} title={`${day.date}: ${day.XL_106}%`} />
    ))}
  </div>
  <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 8, color: TEXT_SECONDARY }}>
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, background: "#3fb950", borderRadius: 2, display: "inline-block" }} /> 80%+</span>
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, background: "#f0883e", borderRadius: 2, display: "inline-block" }} /> 50–79%</span>
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, background: "#f85149", borderRadius: 2, display: "inline-block" }} /> pod 50%</span>
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 10, height: 10, background: "var(--surface-2)", borderRadius: 2, display: "inline-block" }} /> volno</span>
  </div>
</div>

{/* Sekce RIZIKA */}
<SectionHeader label="RIZIKA" />
<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
    <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, marginBottom: 8 }}>Plánované údržby</div>
    {d.upcomingMaintenance.length === 0 ? (
      <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontStyle: "italic" }}>Žádné naplánované údržby</div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {d.upcomingMaintenance.slice(0, 5).map((m, i) => {
          const startD = new Date(m.startTime);
          const endD = new Date(m.endTime);
          const hours = Math.round((endD.getTime() - startD.getTime()) / 3600000 * 10) / 10;
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span>{m.machine.replace("_", " ")} — {m.description}</span>
                <span style={{ color: "#f0883e", fontWeight: 600 }}>{m.startTime.slice(0, 10)}</span>
              </div>
              <div style={{ fontSize: 9, color: TEXT_SECONDARY }}>{hours}h prostoj</div>
            </div>
          );
        })}
      </div>
    )}
  </div>
  <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
    <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontWeight: 600, marginBottom: 8 }}>Čekající na zpracování</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: "#f0883e" }}>{d.pendingReservations.newCount} nových rezervací</span>
        {d.pendingReservations.oldestWaitingDays > 0 && (
          <span style={{ fontSize: 10, color: TEXT_SECONDARY }}>nejstarší: {d.pendingReservations.oldestWaitingDays}d</span>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span style={{ color: "#a371f7" }}>{d.pendingReservations.queueCount} ve frontě</span>
        <span style={{ fontSize: 10, color: TEXT_SECONDARY }}>čekají na slot</span>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Ověřit build**

Run: `npm run build`
Expected: Build projde.

- [ ] **Step 3: Commit**

```bash
git add src/app/reporty/_components/ReportDashboard.tsx
git commit -m "feat(reporty): výhled — heatmapa kapacity + sekce rizika"
```

---

### Task 12: Spustit dev server a vizuálně otestovat

**Files:** žádné nové soubory

- [ ] **Step 1: Spustit dev server**

Run: `npm run dev`

- [ ] **Step 2: Otestovat v prohlížeči**

Otevřít `http://localhost:3000/reporty` jako ADMIN uživatel.

Zkontrolovat:
1. KPI karty se zobrazují s reálnými čísly
2. Přepínání Retrospektiva / Výhled funguje
3. Přepínání časových rozsahů (Dnes, Týden, Měsíc, Custom) funguje
4. Custom date picker se zobrazí jen při výběru "Custom"
5. Graf vytížení vykresluje sloupcový chart
6. Pipeline zobrazuje stacked bar
7. Aktivita plánovačů zobrazuje progress bary
8. Heatmapa ve výhledu zobrazuje barevnou mřížku
9. Dark mode funguje (přepnout theme)

- [ ] **Step 3: Otestovat jako nepřihlášený / jiná role**

1. Odhlásit se → `/reporty` přesměruje na `/login`
2. Přihlásit se jako OBCHODNIK → `/reporty` přesměruje na `/`
3. Přihlásit se jako ADMIN → `/reporty` zobrazí dashboard

- [ ] **Step 4: Spustit existující testy + nové testy**

```bash
node --test --import tsx src/lib/reportMetrics.test.ts
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: Všechny testy zelené.

- [ ] **Step 5: Spustit build**

Run: `npm run build`
Expected: Build projde bez chyb.

- [ ] **Step 6: Finální commit**

```bash
git add -A
git commit -m "feat(reporty): reporting dashboard — finální vizuální test OK"
```
