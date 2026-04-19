# Rozpis směn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rozšířit pracovní dobu o koncept směn (ranní/odpolední/noční) a zavést nový modul Rozpis směn pro evidenci obsazení tiskařů — nahradí dosavadní Excel.

**Architecture:** Dvě vrstvy: (1) rozšíření `MachineWorkHoursTemplateDay` o 3 booleany `morningOn/afternoonOn/nightOn` + update validátoru; (2) nové entity `Printer` a `ShiftAssignment` + nová stránka v Adminu. Časy směn jsou firemní konstanty v kódu (R 06–14, O 14–22, N 22–06).

**Tech Stack:** Next.js 16, Prisma 5, MySQL, React + Tailwind v4. Testy: `node --test --import tsx`.

**Spec:** [docs/superpowers/specs/2026-04-19-rozpis-smen-design.md](../specs/2026-04-19-rozpis-smen-design.md)

---

## File Structure

**Nové soubory:**
- `prisma/migrations/20260419XXXXXX_shifts_and_printers/migration.sql` — DB schema + backfill
- `src/lib/shifts.ts` — konstanty (časy, typy směn) + helpers (`slotToShift`, `shiftTimeRange`, `shiftsForDay`)
- `src/lib/shifts.test.ts` — unit testy
- `src/lib/shiftRoster.ts` — helpers pro rozpis (`weekStartFromDate`, `weekDatesFromStart`, `groupAssignments`)
- `src/lib/shiftRoster.test.ts` — unit testy
- `src/app/api/printers/route.ts` — GET, POST
- `src/app/api/printers/[id]/route.ts` — PUT, DELETE
- `src/app/api/shift-assignments/route.ts` — GET, POST
- `src/app/api/shift-assignments/[id]/route.ts` — DELETE
- `src/app/api/shift-assignments/copy-week/route.ts` — POST
- `src/app/api/shift-assignments/publish/route.ts` — POST
- `src/components/admin/PrinterCodebook.tsx` — číselník tiskařů (tab v Adminu)
- `src/components/admin/ShiftRoster.tsx` — hlavní stránka rozpisu
- `src/components/admin/ShiftRosterCell.tsx` — jedna buňka gridu s popoverem
- `src/components/admin/ShiftRosterHeader.tsx` — navigace týdnů + Kopírovat/Publikovat
- `src/components/admin/DisableShiftCascadeDialog.tsx` — potvrzovací dialog při vypnutí obsazené směny

**Měněné soubory:**
- `prisma/schema.prisma` — `MachineWorkHoursTemplateDay` + `Printer` + `ShiftAssignment`
- `src/lib/machineWorkHours.ts` — rozšíření typu `MachineWorkHoursTemplateDay`
- `src/lib/scheduleValidation.ts` — `checkScheduleViolationWithTemplates` používá směnné flagy
- `src/lib/scheduleValidation.test.ts` — nové testy (pokud soubor neexistuje, vytvořit)
- `src/lib/scheduleValidationServer.test.ts` — rozšíření testů
- `src/app/api/machine-shifts/route.ts` — GET/PUT používají nové flagy, PUT detekuje cascade
- `src/app/admin/_components/AdminDashboard.tsx` — přidat taby "Tiskaři" a "Rozpis směn", upravit editor pracovní doby (checkboxy)

---

## Sprint 1 — Data model a shift constants

**Cíl sprintu:** Schéma DB umí směny a tiskaře. Sdílené konstanty a helpers pro směny jsou připravené a otestované. Po sprintu lze spustit `npm run build` a `npx prisma migrate dev` bez chyb; existující funkce fungují dál.

### Task 1.1: Prisma schema — rozšíření MachineWorkHoursTemplateDay + nové modely

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Upravit `MachineWorkHoursTemplateDay` (přidat 3 booleany)**

Otevři [prisma/schema.prisma](prisma/schema.prisma) a najdi model `MachineWorkHoursTemplateDay`. Přidej pole `morningOn`, `afternoonOn`, `nightOn`:

```prisma
model MachineWorkHoursTemplateDay {
  id                       Int                      @id @default(autoincrement())
  templateId               Int
  dayOfWeek                Int
  startHour                Int
  endHour                  Int
  isActive                 Boolean                  @default(true)
  startSlot                Int?
  endSlot                  Int?
  morningOn                Boolean                  @default(true)
  afternoonOn              Boolean                  @default(true)
  nightOn                  Boolean                  @default(false)
  template                 MachineWorkHoursTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, dayOfWeek])
}
```

**Důležité:** Ponech pole `startHour`, `endHour`, `startSlot`, `endSlot`, `isActive` (používají je starší části kódu dokud nedojde migrace ve Sprintu 4). Validátor je po Sprintu 4 přestane číst, ale data zůstávají.

- [ ] **Step 2: Přidat model `Printer`**

Přidej na konec souboru (před `enum ExpeditionManualItem_kind`):

```prisma
model Printer {
  id          Int               @id @default(autoincrement())
  name        String
  isActive    Boolean           @default(true)
  sortOrder   Int               @default(0)
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt
  assignments ShiftAssignment[]

  @@index([isActive, sortOrder])
}
```

- [ ] **Step 3: Přidat model `ShiftAssignment`**

```prisma
model ShiftAssignment {
  id          Int       @id @default(autoincrement())
  machine     String
  date        DateTime
  shift       String
  printerId   Int
  note        String?
  sortOrder   Int       @default(0)
  publishedAt DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  printer     Printer   @relation(fields: [printerId], references: [id])

  @@unique([machine, date, shift, printerId])
  @@index([date, machine])
  @@index([publishedAt])
}
```

- [ ] **Step 4: Spustit `npm run build` pro ověření, že TS typy nestouhou**

```bash
npm run build
```

Expected: build projde bez chyb. Prisma klienta generuje při buildu jen pokud se schema změnilo — pokud build hlásí "Prisma client out of date", spusť `npx prisma generate`.

- [ ] **Step 5: Commit schema změn**

```bash
git add prisma/schema.prisma
git commit -m "feat(shifts): rozšíření Prisma schema o směny a tiskaře"
```

---

### Task 1.2: Migrace + data backfill

**Files:**
- Create: `prisma/migrations/20260419XXXXXX_shifts_and_printers/migration.sql`

- [ ] **Step 1: Vygenerovat migraci**

```bash
npx prisma migrate dev --name shifts_and_printers --create-only
```

Flag `--create-only` vytvoří SQL, ale nespustí. Otevři vygenerovaný soubor v `prisma/migrations/<timestamp>_shifts_and_printers/migration.sql`.

- [ ] **Step 2: Přidat backfill SQL na konec migrace**

Za generované `ALTER TABLE MachineWorkHoursTemplateDay ADD COLUMN ...` přidej:

```sql
-- Backfill: odvoď směny z existujících startHour/endHour
-- RANNÍ = 06:00–14:00  → active pokud interval pokrývá (startHour ≤ 6 AND endHour ≥ 14)
-- ODPOL. = 14:00–22:00 → active pokud (startHour ≤ 14 AND endHour ≥ 22)
-- NOČNÍ = 22:00–06:00  → active pokud (startHour ≤ 22 AND endHour ≥ 24) OR (startHour = 0 AND endHour ≥ 6)
UPDATE `MachineWorkHoursTemplateDay`
SET
  `morningOn`   = (`startHour` <= 6  AND `endHour` >= 14),
  `afternoonOn` = (`startHour` <= 14 AND `endHour` >= 22),
  `nightOn`     = ((`startHour` <= 22 AND `endHour` >= 24)
                   OR (`startHour` = 0 AND `endHour` >= 6));
```

- [ ] **Step 3: Ověřit výsledný SQL**

```bash
cat prisma/migrations/*shifts_and_printers*/migration.sql
```

Expected: soubor obsahuje jak `ALTER TABLE` pro nová pole, tak `CREATE TABLE Printer`, `CREATE TABLE ShiftAssignment`, tak backfill UPDATE.

- [ ] **Step 4: Aplikovat migraci do dev DB**

```bash
npx prisma migrate dev
```

Expected: migrace projde, Prisma klient se přegeneruje.

- [ ] **Step 5: Ověřit backfill — spuštěním SQL proti dev DB**

```bash
mysql -u root -pmysql IGvyroba -e "SELECT machine, dayOfWeek, startHour, endHour, morningOn, afternoonOn, nightOn FROM MachineWorkHoursTemplateDay d JOIN MachineWorkHoursTemplate t ON d.templateId = t.id ORDER BY t.machine, d.dayOfWeek;"
```

Expected: každý řádek má vyplněné 3 booleany, které logicky odpovídají `startHour`/`endHour` (např. `00–22` → ranní✓ odpol.✓ noční✗).

- [ ] **Step 6: Commit migrace**

```bash
git add prisma/migrations/*shifts_and_printers*
git commit -m "feat(shifts): migrace + data backfill pro směny"
```

---

### Task 1.3: `src/lib/shifts.ts` — konstanty a helpers

**Files:**
- Create: `src/lib/shifts.ts`
- Create: `src/lib/shifts.test.ts`

- [ ] **Step 1: Napsat failing testy**

Vytvoř `src/lib/shifts.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHIFTS,
  SHIFT_HOURS,
  shiftFromHour,
  isSlotInShift,
  activeShiftsForDay,
  type ShiftType,
  type ShiftFlags,
} from "./shifts";

test("SHIFTS konstanty obsahují 3 směny", () => {
  assert.deepEqual(SHIFTS, ["MORNING", "AFTERNOON", "NIGHT"]);
});

test("SHIFT_HOURS — ranní je 06-14", () => {
  assert.deepEqual(SHIFT_HOURS.MORNING, { start: 6, end: 14 });
});

test("SHIFT_HOURS — odpolední je 14-22", () => {
  assert.deepEqual(SHIFT_HOURS.AFTERNOON, { start: 14, end: 22 });
});

test("SHIFT_HOURS — noční je 22-06 (přes půlnoc)", () => {
  assert.deepEqual(SHIFT_HOURS.NIGHT, { start: 22, end: 6 });
});

test("shiftFromHour — 7:00 patří do ranní", () => {
  assert.equal(shiftFromHour(7), "MORNING");
});

test("shiftFromHour — 13:59 patří do ranní (end exclusive)", () => {
  assert.equal(shiftFromHour(13.9), "MORNING");
});

test("shiftFromHour — 14:00 patří do odpolední", () => {
  assert.equal(shiftFromHour(14), "AFTERNOON");
});

test("shiftFromHour — 22:00 patří do noční", () => {
  assert.equal(shiftFromHour(22), "NIGHT");
});

test("shiftFromHour — 3:00 patří do noční (přes půlnoc)", () => {
  assert.equal(shiftFromHour(3), "NIGHT");
});

test("shiftFromHour — 5:59 patří do noční", () => {
  assert.equal(shiftFromHour(5.9), "NIGHT");
});

test("isSlotInShift — slot 12 (06:00) patří do ranní (true)", () => {
  assert.equal(isSlotInShift(12, "MORNING"), true);
});

test("isSlotInShift — slot 0 (00:00) patří do noční (true)", () => {
  assert.equal(isSlotInShift(0, "NIGHT"), true);
});

test("activeShiftsForDay — všechny zapnuté → vrátí všechny 3", () => {
  const flags: ShiftFlags = { morningOn: true, afternoonOn: true, nightOn: true };
  assert.deepEqual(activeShiftsForDay(flags), ["MORNING", "AFTERNOON", "NIGHT"]);
});

test("activeShiftsForDay — jen ranní a noční", () => {
  const flags: ShiftFlags = { morningOn: true, afternoonOn: false, nightOn: true };
  assert.deepEqual(activeShiftsForDay(flags), ["MORNING", "NIGHT"]);
});

test("activeShiftsForDay — všechny vypnuté → prázdné pole", () => {
  const flags: ShiftFlags = { morningOn: false, afternoonOn: false, nightOn: false };
  assert.deepEqual(activeShiftsForDay(flags), []);
});
```

- [ ] **Step 2: Spustit testy — ověřit FAIL**

```bash
node --test --import tsx src/lib/shifts.test.ts
```

Expected: FAIL — `Cannot find module './shifts'`.

- [ ] **Step 3: Implementovat `src/lib/shifts.ts`**

```typescript
export type ShiftType = "MORNING" | "AFTERNOON" | "NIGHT";

export const SHIFTS: readonly ShiftType[] = ["MORNING", "AFTERNOON", "NIGHT"] as const;

export const SHIFT_HOURS: Record<ShiftType, { start: number; end: number }> = {
  MORNING: { start: 6, end: 14 },
  AFTERNOON: { start: 14, end: 22 },
  NIGHT: { start: 22, end: 6 }, // přes půlnoc
};

export const SHIFT_LABELS: Record<ShiftType, string> = {
  MORNING: "Ranní",
  AFTERNOON: "Odpolední",
  NIGHT: "Noční",
};

export type ShiftFlags = {
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
};

/**
 * Vrátí typ směny pro danou hodinu (0-24).
 * Noční pokrývá 22-06 včetně půlnoci.
 */
export function shiftFromHour(hour: number): ShiftType {
  if (hour >= 6 && hour < 14) return "MORNING";
  if (hour >= 14 && hour < 22) return "AFTERNOON";
  return "NIGHT"; // 22-24 a 0-6
}

/**
 * Zda slot (0-47, 30min) patří do dané směny.
 * Slot n odpovídá hodině n/2.
 */
export function isSlotInShift(slot: number, shift: ShiftType): boolean {
  const hour = slot / 2;
  return shiftFromHour(hour) === shift;
}

/**
 * Vrátí seznam zapnutých směn pro den (podle flagů).
 * Pořadí: MORNING → AFTERNOON → NIGHT.
 */
export function activeShiftsForDay(flags: ShiftFlags): ShiftType[] {
  const out: ShiftType[] = [];
  if (flags.morningOn) out.push("MORNING");
  if (flags.afternoonOn) out.push("AFTERNOON");
  if (flags.nightOn) out.push("NIGHT");
  return out;
}
```

- [ ] **Step 4: Spustit testy — ověřit PASS**

```bash
node --test --import tsx src/lib/shifts.test.ts
```

Expected: všech 15 testů zelené.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shifts.ts src/lib/shifts.test.ts
git commit -m "feat(shifts): konstanty a helpers pro typy směn"
```

---

### Task 1.4: Rozšíření typu `MachineWorkHoursTemplateDay`

**Files:**
- Modify: `src/lib/machineWorkHours.ts`

- [ ] **Step 1: Přidat nová pole do typu**

Otevři [src/lib/machineWorkHours.ts](src/lib/machineWorkHours.ts) a uprav `MachineWorkHoursTemplateDay`:

```typescript
export type MachineWorkHoursTemplateDay = {
  id: number;
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  startSlot?: number | null;
  endSlot?: number | null;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
};
```

- [ ] **Step 2: Ověřit build**

```bash
npm run build
```

Expected: build projde. TypeScript možná zahlásí chyby v místech, kde se konstruuje `MachineWorkHoursTemplateDay` bez nových polí — tato místa postupně opravíme v dalších sprintech. Pokud build fail, vyhodnoť, jestli chyba patří do tohoto sprintu (změna typu) nebo následujícího.

Pokud je chyba jen v `resolveScheduleRows` a podobných místech, která nové flagy ještě nevracejí — pro tento sprint přidej je k mapování s hodnotou `false` nebo z dat načti. Pokud má být zachovaná zpětná kompatibilita, použij typ-default `morningOn: false` atp. (viz Sprint 2, kde už to serializujeme z DB).

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineWorkHours.ts
git commit -m "feat(shifts): rozšíření typu MachineWorkHoursTemplateDay"
```

---

## Sprint 2 — Číselník Tiskaři (standalone modul)

**Cíl sprintu:** V Adminu existuje nový tab "Tiskaři" s CRUD operacemi. Žádný jiný modul to neovlivní.

### Task 2.1: API routes `/api/printers` (GET, POST)

**Files:**
- Create: `src/app/api/printers/route.ts`

- [ ] **Step 1: Napsat failing test (manuální curl test po implementaci — ne unit test)**

Pro API routes neděláme unit testy (v projektu nejsou zavedené). Místo toho:
- Po implementaci ověříme přes curl.
- Integrační test by byl přínosný, ale není prioritou — přidej ho, až budeš mít MSW nebo Playwright harness.

Tento step: vynech, pokračuj implementací.

- [ ] **Step 2: Implementovat GET a POST**

```typescript
import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

export async function GET() {
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]);
    const printers = await prisma.printer.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(printers);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    logger.error("[printers.GET] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireRole(["ADMIN"]);
    const body = (await req.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name) throw new AppError("VALIDATION_ERROR", "Jméno tiskaře je povinné.");
    if (name.length > 80) throw new AppError("VALIDATION_ERROR", "Jméno je příliš dlouhé (max 80 znaků).");

    const maxOrder = await prisma.printer.aggregate({ _max: { sortOrder: true } });
    const nextOrder = (maxOrder._max.sortOrder ?? 0) + 10;

    const printer = await prisma.printer.create({
      data: { name, sortOrder: nextOrder },
    });
    logger.info("[printers.POST] vytvořen tiskař", { id: printer.id, name, by: user.username });
    return NextResponse.json(printer, { status: 201 });
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "VALIDATION_ERROR" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error("[printers.POST] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

**Poznámka:** `requireRole` volá session check a vyhodí `AppError("FORBIDDEN", ...)` při neúspěchu. Zkontroluj [src/lib/auth.ts](src/lib/auth.ts) — pokud tato funkce neexistuje, použij `getSession()` a ručně zkontroluj roli (viz vzor v `src/app/api/users/route.ts` nebo podobné route).

- [ ] **Step 3: Manuální curl test**

```bash
# V jiném terminálu: npm run dev
curl -s -X POST http://localhost:3000/api/printers \
  -H "Content-Type: application/json" \
  -H "Cookie: integraf-session=<TOKEN>" \
  -d '{"name":"TEST TISKAR"}'
```

Expected: vrátí JSON s `id`, `name: "TEST TISKAR"`, `isActive: true`.

```bash
curl -s http://localhost:3000/api/printers -H "Cookie: integraf-session=<TOKEN>"
```

Expected: pole s vytvořeným tiskařem.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/printers/route.ts
git commit -m "feat(tiskari): API route /api/printers (GET, POST)"
```

---

### Task 2.2: API route `/api/printers/[id]` (PUT, DELETE)

**Files:**
- Create: `src/app/api/printers/[id]/route.ts`

- [ ] **Step 1: Implementovat PUT a DELETE**

```typescript
import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Params) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  try {
    const user = await requireRole(["ADMIN"]);
    if (!Number.isFinite(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");

    const body = (await req.json()) as { name?: string; isActive?: boolean; sortOrder?: number };
    const data: Record<string, unknown> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) throw new AppError("VALIDATION_ERROR", "Jméno je povinné.");
      data.name = name;
    }
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;
    if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

    if (Object.keys(data).length === 0) throw new AppError("VALIDATION_ERROR", "Žádné změny.");

    const printer = await prisma.printer.update({ where: { id }, data });
    logger.info("[printers.PUT] upraven tiskař", { id, by: user.username });
    return NextResponse.json(printer);
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "VALIDATION_ERROR" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    // Prisma P2025 = record not found
    if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Tiskař nenalezen." }, { status: 404 });
    logger.error("[printers.PUT] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  try {
    const user = await requireRole(["ADMIN"]);
    if (!Number.isFinite(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");

    // Měkké smazání — nastavíme isActive=false místo fyzického DELETE
    // (zachová historické ShiftAssignment záznamy)
    const printer = await prisma.printer.update({
      where: { id },
      data: { isActive: false },
    });
    logger.info("[printers.DELETE] deaktivován tiskař", { id, by: user.username });
    return NextResponse.json(printer);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Tiskař nenalezen." }, { status: 404 });
    logger.error("[printers.DELETE] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manuální curl test**

```bash
curl -s -X PUT http://localhost:3000/api/printers/1 \
  -H "Content-Type: application/json" \
  -H "Cookie: integraf-session=<TOKEN>" \
  -d '{"name":"TEST UPRAVENO"}'
```

Expected: vrátí `{ id: 1, name: "TEST UPRAVENO", ... }`.

```bash
curl -s -X DELETE http://localhost:3000/api/printers/1 \
  -H "Cookie: integraf-session=<TOKEN>"
```

Expected: vrátí `{ id: 1, isActive: false, ... }`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/printers/[id]/route.ts
git commit -m "feat(tiskari): API route /api/printers/[id] (PUT, DELETE)"
```

---

### Task 2.3: UI komponenta `PrinterCodebook`

**Files:**
- Create: `src/components/admin/PrinterCodebook.tsx`
- Modify: `src/app/admin/_components/AdminDashboard.tsx`

- [ ] **Step 1: Vytvořit komponentu**

```typescript
"use client";

import { useEffect, useState } from "react";

export type Printer = {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
};

export function PrinterCodebook() {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/printers");
      if (!res.ok) throw new Error((await res.json()).error ?? "Chyba načtení");
      setPrinters(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neznámá chyba");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const addPrinter = async () => {
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/printers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Chyba");
      return;
    }
    setNewName("");
    await reload();
  };

  const updateName = async (id: number, name: string) => {
    const res = await fetch(`/api/printers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "Chyba");
      return;
    }
    await reload();
  };

  const deactivate = async (id: number) => {
    if (!confirm("Opravdu deaktivovat tiskaře?")) return;
    const res = await fetch(`/api/printers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json()).error ?? "Chyba");
      return;
    }
    await reload();
  };

  if (loading) return <div>Načítám…</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Tiskaři</h2>
      {error && <div style={{ color: "#ef4444", marginBottom: 12 }}>{error}</div>}

      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Jméno tiskaře"
          style={{ flex: 1, padding: 8, background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" }}
        />
        <button
          onClick={() => void addPrinter()}
          style={{ padding: "8px 16px", background: "#15803d", color: "#fff", border: "none", cursor: "pointer" }}
        >
          + Přidat
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#1e293b" }}>
            <th style={{ padding: 8, textAlign: "left", border: "1px solid #334155" }}>Jméno</th>
            <th style={{ padding: 8, width: 120, border: "1px solid #334155" }}>Akce</th>
          </tr>
        </thead>
        <tbody>
          {printers.map((p) => (
            <tr key={p.id}>
              <td style={{ padding: 8, border: "1px solid #334155" }}>
                <input
                  defaultValue={p.name}
                  onBlur={(e) => {
                    if (e.target.value !== p.name) void updateName(p.id, e.target.value);
                  }}
                  style={{ width: "100%", padding: 4, background: "transparent", color: "#e2e8f0", border: "none" }}
                />
              </td>
              <td style={{ padding: 8, textAlign: "center", border: "1px solid #334155" }}>
                <button
                  onClick={() => void deactivate(p.id)}
                  style={{ padding: "4px 8px", background: "#b91c1c", color: "#fff", border: "none", cursor: "pointer" }}
                >
                  Deaktivovat
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Poznámka:** Styling je záměrně jednoduchý (inline styles ve stejném stylu jako existující `AdminDashboard.tsx`). Projekt používá Tailwind v4, ale Admin sekce má smíšený styl — drž se toho co už tam je.

- [ ] **Step 2: Zaregistrovat nový tab v `AdminDashboard.tsx`**

V [src/app/admin/_components/AdminDashboard.tsx](src/app/admin/_components/AdminDashboard.tsx):

Import (nahoru):
```typescript
import { PrinterCodebook } from "@/components/admin/PrinterCodebook";
```

Upravit `visibleTabs` (cca řádek 165) — přidat `"tiskari"`:
```typescript
const visibleTabs = (["users", "codebook", "presets", "audit", "shifts", "tiskari"] as const).filter((tab) => {
  if (isPlanovat) return tab === "codebook" || tab === "presets" || tab === "shifts" || tab === "tiskari";
  return true;
});
```

Upravit typ v `useState` (cca řádek 169):
```typescript
const [activeTab, setActiveTab] = useState<"users" | "codebook" | "presets" | "audit" | "shifts" | "tiskari">(...);
```

Upravit label v renderování tabu (cca řádek 249):
```typescript
{tab === "users" ? "Uživatelé"
  : tab === "codebook" ? "Číselníky"
  : tab === "presets" ? "Presety"
  : tab === "audit" ? "Audit log"
  : tab === "shifts" ? "Pracovní doba"
  : "Tiskaři"}
```

Přidat render obsahu tabu (za `activeTab === "shifts" ? ... :`):
```typescript
) : activeTab === "tiskari" ? (
  <PrinterCodebook />
) : null}
```

- [ ] **Step 3: Ověřit v prohlížeči**

```bash
npm run dev
```

Otevři `http://localhost:3000/admin` jako ADMIN uživatel. Klikni na tab "Tiskaři" → vidíš prázdnou tabulku + input. Přidej "TEST" → objeví se v seznamu. Edit → persistuje se. Deaktivace → zmizí (protože filtrujeme `isActive=true`).

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/PrinterCodebook.tsx src/app/admin/_components/AdminDashboard.tsx
git commit -m "feat(tiskari): tab v Adminu s CRUD pro tiskaře"
```

---

## Sprint 3 — Pracovní doba: přepnutí UI na checkboxy směn

**Cíl sprintu:** V editoru pracovní doby jsou místo `startHour`/`endHour` checkboxy směn (✅ ranní / ✅ odpolední / ☐ noční). `/api/machine-shifts` vrací i nové flagy. Validátor jede pořád podle `startHour`/`endHour` — jeho změna až ve Sprintu 4.

### Task 3.1: `/api/machine-shifts` GET — vrátit směnné flagy

**Files:**
- Modify: `src/app/api/machine-shifts/route.ts`
- Modify: `src/lib/scheduleValidation.ts` (helper `serializeTemplates`)

- [ ] **Step 1: Rozšířit `serializeTemplates`**

V [src/lib/scheduleValidation.ts](src/lib/scheduleValidation.ts) najdi `serializeTemplates` a rozšiř mapování dnů o nové flagy:

```typescript
days: Array.isArray(t.days)
  ? (t.days as MachineWorkHoursTemplate["days"]).map((d) => {
      const { startSlot, endSlot } = getSlotRange(d);
      return {
        ...d,
        startSlot,
        endSlot,
        startHour: slotToHour(startSlot),
        endHour: slotToHour(endSlot),
        morningOn: Boolean((d as { morningOn?: boolean }).morningOn),
        afternoonOn: Boolean((d as { afternoonOn?: boolean }).afternoonOn),
        nightOn: Boolean((d as { nightOn?: boolean }).nightOn),
      };
    })
  : [],
```

- [ ] **Step 2: Ověřit, že GET endpoint vrací nová pole**

```bash
# Spusť dev server
curl -s http://localhost:3000/api/machine-shifts -H "Cookie: integraf-session=<TOKEN>" | head -100
```

Expected: u každého dne se objevuje `morningOn`, `afternoonOn`, `nightOn`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/scheduleValidation.ts
git commit -m "feat(shifts): /api/machine-shifts vrací směnné flagy"
```

---

### Task 3.2: `/api/machine-shifts` PUT — přijímá směnné flagy

**Files:**
- Modify: `src/app/api/machine-shifts/route.ts`

- [ ] **Step 1: Přečti stávající PUT a najdi, kde se zapisují `startHour/endHour/isActive` dne**

Otevři `src/app/api/machine-shifts/route.ts`. Najdi, kde PUT vytváří/updatuje `MachineWorkHoursTemplateDay` (typicky v `$transaction`). Najdi, jaký formát těla přijímá (interface + validation).

- [ ] **Step 2: Rozšířit PUT o zápis směnných flagů**

V místě, kde se zapisuje `MachineWorkHoursTemplateDay.create()` nebo `.update()`, přidej:

```typescript
data: {
  templateId: template.id,
  dayOfWeek: day.dayOfWeek,
  startHour: day.startHour,
  endHour: day.endHour,
  isActive: day.isActive,
  morningOn: Boolean(day.morningOn),
  afternoonOn: Boolean(day.afternoonOn),
  nightOn: Boolean(day.nightOn),
},
```

**Důležité:** Pokud PUT přijímá `startHour/endHour` a nová pole, zatím nech obě. Fallback pro případ, že UI pošle jen staré hodnoty (nebo naopak): pokud chybí nové flagy, odvoď je z `startHour`/`endHour` stejnou logikou jako backfill migrace. Pokud chybí staré, odvoď je z `activeShiftsForDay()`:

```typescript
import { shiftFromHour, activeShiftsForDay } from "@/lib/shifts";

function normalizeDayInput(day: {
  dayOfWeek: number;
  startHour?: number;
  endHour?: number;
  isActive?: boolean;
  morningOn?: boolean;
  afternoonOn?: boolean;
  nightOn?: boolean;
}): {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  isActive: boolean;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
} {
  // 1. Prefer explicit shift flags
  if (typeof day.morningOn === "boolean" && typeof day.afternoonOn === "boolean" && typeof day.nightOn === "boolean") {
    const actives = activeShiftsForDay({ morningOn: day.morningOn, afternoonOn: day.afternoonOn, nightOn: day.nightOn });
    // Derive startHour/endHour — pro zpětnou kompatibilitu: pokud noční+jiné, bereme min start a max end
    // Jednoduchá heuristika: pokud je jen ranní → 6-14, odpolední → 14-22, noční → 22-30 (kde 30 = 6:00 následujícího dne zobrazujeme jako 24)
    const startHour = actives.length > 0 ? (actives.includes("NIGHT") && !actives.includes("MORNING") ? 22 : actives.includes("MORNING") ? 6 : 14) : 0;
    const endHour = actives.length > 0 ? (actives.includes("AFTERNOON") ? 22 : actives.includes("MORNING") ? 14 : 24) : 0;
    return {
      dayOfWeek: day.dayOfWeek,
      startHour,
      endHour,
      isActive: day.isActive ?? actives.length > 0,
      morningOn: day.morningOn,
      afternoonOn: day.afternoonOn,
      nightOn: day.nightOn,
    };
  }
  // 2. Fallback — ze starých startHour/endHour odvoď flagy
  const startHour = day.startHour ?? 0;
  const endHour = day.endHour ?? 0;
  return {
    dayOfWeek: day.dayOfWeek,
    startHour,
    endHour,
    isActive: day.isActive ?? startHour < endHour,
    morningOn: startHour <= 6 && endHour >= 14,
    afternoonOn: startHour <= 14 && endHour >= 22,
    nightOn: (startHour <= 22 && endHour >= 24) || (startHour === 0 && endHour >= 6),
  };
}
```

Použij `normalizeDayInput` u každého dne v těle PUT. Tím zajistíš kompatibilitu starého i nového UI během přechodu.

- [ ] **Step 3: Ověřit curl**

```bash
curl -s -X PUT http://localhost:3000/api/machine-shifts \
  -H "Content-Type: application/json" -H "Cookie: integraf-session=<TOKEN>" \
  -d '{"templateId":1,"days":[{"dayOfWeek":1,"morningOn":true,"afternoonOn":false,"nightOn":true}]}'
```

Expected: úspěch, odpovídající DB řádek má `morningOn=1, afternoonOn=0, nightOn=1, startHour` a `endHour` odvozené (6/24 nebo podobně).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/machine-shifts/route.ts
git commit -m "feat(shifts): /api/machine-shifts PUT přijímá směnné flagy"
```

---

### Task 3.3: UI editor pracovní doby — checkboxy směn

**Files:**
- Modify: `src/app/admin/_components/AdminDashboard.tsx` (sekce `activeTab === "shifts"`)

- [ ] **Step 1: Najít současný editor (hledat `activeTab === "shifts"` v souboru)**

Najdi místo, kde se renderuje editor šablon pracovní doby. Hledej "shifts" nebo "Pracovní doba" nebo "startHour". Typicky tam je select/input pro hodiny startu a konce.

- [ ] **Step 2: Nahradit startHour/endHour inputy za 3 checkboxy**

Pro každý řádek dne místo:
```tsx
<input type="number" value={day.startHour} onChange={...} /> - <input type="number" value={day.endHour} onChange={...} />
```

Ukaž 3 checkboxy:
```tsx
<label style={{ marginRight: 12 }}>
  <input
    type="checkbox"
    checked={day.morningOn}
    onChange={(e) => updateDay(day.dayOfWeek, { morningOn: e.target.checked })}
  />
  {" "}🌅 Ranní (06-14)
</label>
<label style={{ marginRight: 12 }}>
  <input
    type="checkbox"
    checked={day.afternoonOn}
    onChange={(e) => updateDay(day.dayOfWeek, { afternoonOn: e.target.checked })}
  />
  {" "}🌇 Odpolední (14-22)
</label>
<label>
  <input
    type="checkbox"
    checked={day.nightOn}
    onChange={(e) => updateDay(day.dayOfWeek, { nightOn: e.target.checked })}
  />
  {" "}🌙 Noční (22-06)
</label>
```

`updateDay` funkce, která posílá PUT s novými flagy. Pokud existující kód pracuje s `startHour/endHour`, tato místa už nebudou potřeba — odkaž je na `morningOn/afternoonOn/nightOn` a dopočet `startHour/endHour` ponech na serveru (viz `normalizeDayInput`).

- [ ] **Step 3: Ověřit v prohlížeči**

```bash
npm run dev
```

V Adminu → tab Pracovní doba → uvidíš 3 checkboxy místo číselných polí. Zaškrtávání persistuje, DB obsah odpovídá.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/_components/AdminDashboard.tsx
git commit -m "feat(shifts): editor pracovní doby — checkboxy směn"
```

---

## Sprint 4 — Validator rewrite

**Cíl sprintu:** `checkScheduleViolationWithTemplates` validuje proti `morningOn/afternoonOn/nightOn`, ne `startHour/endHour`. Všechny existující testy (`scheduleValidationServer.test.ts`, `dateUtils.test.ts`, `errors.test.ts`) jsou zelené.

### Task 4.1: Rozšířit testy pro novou logiku směn (TDD)

**Files:**
- Modify: `src/lib/scheduleValidationServer.test.ts`

- [ ] **Step 1: Přidat failing test — blok přes vypnutou odpolední**

Do existujícího souboru testů přidej:

```typescript
test("validateBlockScheduleFromDb — blok v zapnuté ranní → OK", async () => {
  // Mockovaná Prisma vrátí šablonu s ranní zapnutou, odpolední a noční vypnutou
  mockTemplates([{
    machine: "XL_106",
    days: [{ dayOfWeek: 1, morningOn: true, afternoonOn: false, nightOn: false, startHour: 6, endHour: 14, isActive: true }],
  }]);
  const result = await validateBlockScheduleFromDb(
    "XL_106",
    new Date("2026-05-11T08:00:00Z"), // po 10:00 Prague
    new Date("2026-05-11T10:00:00Z"),
    "ZAKAZKA",
    false
  );
  assert.equal(result, null);
});

test("validateBlockScheduleFromDb — blok v odpolední, ale odpolední vypnutá → SCHEDULE_VIOLATION", async () => {
  mockTemplates([{
    machine: "XL_106",
    days: [{ dayOfWeek: 1, morningOn: true, afternoonOn: false, nightOn: false, startHour: 6, endHour: 14, isActive: true }],
  }]);
  const result = await validateBlockScheduleFromDb(
    "XL_106",
    new Date("2026-05-11T15:00:00Z"), // po 17:00 Prague
    new Date("2026-05-11T17:00:00Z"),
    "ZAKAZKA",
    false
  );
  assert.ok(result, "Expected SCHEDULE_VIOLATION");
  assert.equal(result!.status, 409);
});

test("validateBlockScheduleFromDb — blok v noční (přes půlnoc) ze zapnuté noční → OK", async () => {
  mockTemplates([{
    machine: "XL_106",
    days: [
      { dayOfWeek: 1, morningOn: false, afternoonOn: false, nightOn: true, startHour: 22, endHour: 24, isActive: true },
      { dayOfWeek: 2, morningOn: false, afternoonOn: false, nightOn: true, startHour: 0, endHour: 6, isActive: true },
    ],
  }]);
  const result = await validateBlockScheduleFromDb(
    "XL_106",
    new Date("2026-05-11T22:00:00Z"), // po 00:00 Prague úterý
    new Date("2026-05-12T03:00:00Z"), // út 05:00 Prague
    "ZAKAZKA",
    false
  );
  assert.equal(result, null);
});
```

**Poznámka:** `mockTemplates` je helper existující v testu (nebo ho vytvoř — viz stávající strukturu `scheduleValidationServer.test.ts`).

- [ ] **Step 2: Spustit testy — ověřit FAIL**

```bash
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: nové 3 testy selžou (protože validátor ještě používá `startHour/endHour`).

- [ ] **Step 3: Commit failing testů**

```bash
git add src/lib/scheduleValidationServer.test.ts
git commit -m "test(shifts): failing testy pro novou validaci podle směn"
```

---

### Task 4.2: Přepsat `checkScheduleViolationWithTemplates` na flagy směn

**Files:**
- Modify: `src/lib/scheduleValidation.ts`

- [ ] **Step 1: Přepsat funkci**

V [src/lib/scheduleValidation.ts](src/lib/scheduleValidation.ts) najdi `checkScheduleViolationWithTemplates` (cca řádek 96) a přepiš:

```typescript
import { shiftFromHour, type ShiftType } from "./shifts";

// ...

export function checkScheduleViolationWithTemplates(
  machine: string,
  startTime: Date,
  endTime: Date,
  templates: MachineWorkHoursTemplate[],
  exceptions: ExceptionSlim[]
): string | null {
  const SLOT_MS = 30 * 60 * 1000;
  const scheduleCache = new Map<string, ReturnType<typeof resolveScheduleRows>>();
  let cur = new Date(startTime);
  while (cur < endTime) {
    const { slot, dayOfWeek, dateStr, hour } = pragueOf(cur);
    if (!scheduleCache.has(dateStr)) {
      scheduleCache.set(dateStr, resolveScheduleRows(machine, cur, templates));
    }
    const schedule = scheduleCache.get(dateStr)!;
    const exc = exceptions.find(
      (e) => (!e.machine || e.machine === machine) && normalizeCivilDateInput(e.date) === dateStr
    );
    // Exception přebíjí template (beze změny)
    if (exc) {
      const excRange = getSlotRange(exc);
      if (!exc.isActive || slot < excRange.startSlot || slot >= excRange.endSlot) {
        return "Blok zasahuje do doby mimo provoz stroje.";
      }
    } else {
      const row = schedule.find((r) => r.dayOfWeek === dayOfWeek);
      if (!row) {
        // Template existuje (nemá řádek pro tento den) → zamítnout
        if (schedule.length > 0 || isHardcodedBlocked(machine, dayOfWeek, slot)) {
          return "Blok zasahuje do doby mimo provoz stroje.";
        }
      } else {
        // Nová logika: zjisti, do které směny slot patří, a zkontroluj flag
        const shift = shiftFromHour(hour);
        const shiftOn = shift === "MORNING" ? row.morningOn
                      : shift === "AFTERNOON" ? row.afternoonOn
                      : row.nightOn;
        if (!row.isActive || !shiftOn) {
          return "Blok zasahuje do doby mimo provoz stroje.";
        }
      }
    }
    cur = new Date(cur.getTime() + SLOT_MS);
  }
  return null;
}
```

**Změna oproti staré verzi:** místo `slot < rowRange.startSlot || slot >= rowRange.endSlot` používáme `shiftFromHour(hour)` + flagů.

**Rozšíření `pragueOf`:** pokud `pragueOf` ještě nevrací `hour`, přidej ho v [src/lib/dateUtils.ts](src/lib/dateUtils.ts):

```typescript
export function pragueOf(date: Date) {
  // ... existující logika ...
  return { dateStr, dayOfWeek, slot, hour: slot / 2 };
}
```

- [ ] **Step 2: Rozšířit `resolveScheduleRows` o nové flagy**

Funkce `resolveScheduleRows` vrací řádky s `startHour/endHour/startSlot/endSlot/isActive`. Přidej `morningOn/afternoonOn/nightOn`:

```typescript
return active.days.map((d) => ({
  machine,
  dayOfWeek: d.dayOfWeek,
  startHour: d.startHour,
  endHour: d.endHour,
  startSlot: getSlotRange(d).startSlot,
  endSlot: getSlotRange(d).endSlot,
  isActive: d.isActive,
  morningOn: d.morningOn,
  afternoonOn: d.afternoonOn,
  nightOn: d.nightOn,
}));
```

- [ ] **Step 3: Spustit testy — ověřit PASS (nové i stávající)**

```bash
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --test --import tsx src/lib/shifts.test.ts
```

Expected: všechny testy zelené. Pokud stávající testy fail, pravděpodobně je to kvůli tomu, že fixture používá jen `startHour/endHour` bez flagů — uprav fixture na nové flagy.

- [ ] **Step 4: Ověřit build**

```bash
npm run build
```

Expected: build projde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scheduleValidation.ts src/lib/dateUtils.ts
git commit -m "feat(shifts): validátor pracuje podle směnných flagů"
```

---

### Task 4.3: Regrese produkčních dat — dry-run script

**Files:**
- Create: `scripts/validate-shifts-parity.ts` (jednorázový script, nepersistuje do commitu — nebo ho commitni do `scripts/`)

- [ ] **Step 1: Napsat script, který porovná starou a novou verzi validátoru na produkčních datech**

```typescript
// scripts/validate-shifts-parity.ts
// Spustit: node --import tsx scripts/validate-shifts-parity.ts
// Porovnává: pro každý existující Block spustí starý i nový validátor a srovnává výsledek.
// Starý = pomocí startHour/endHour, nový = pomocí směnných flagů.

import { prisma } from "../src/lib/prisma";

async function main() {
  const blocks = await prisma.block.findMany({
    where: { type: "ZAKAZKA" },
    orderBy: { startTime: "asc" },
  });

  const templatesRaw = await prisma.machineWorkHoursTemplate.findMany({ include: { days: true } });
  const exceptions = await prisma.machineScheduleException.findMany();

  // Přidej tvé vlastní old-variant a new-variant funkce ze scheduleValidation.ts
  // (zkopíruj staré a nové tělo funkce a porovnej)

  let diffs = 0;
  for (const b of blocks) {
    // const oldResult = oldValidator(...);
    // const newResult = newValidator(...);
    // if (oldResult !== newResult) diffs++; console.log(b.id, oldResult, newResult);
  }
  console.log(`Celkem bloků: ${blocks.length}, odchylky: ${diffs}`);
  await prisma.$disconnect();
}

main();
```

**Poznámka:** script je volitelný, ale doporučený před nasazením na produkci. Pro MVP stačí, že testy procházejí.

- [ ] **Step 2: Volitelně commit script**

```bash
# Pokud je script finální, commitni ho:
git add scripts/validate-shifts-parity.ts
git commit -m "chore(shifts): dry-run script pro validaci migrace"
```

---

## Sprint 5 — Rozpis směn: backend

**Cíl sprintu:** API endpointy pro `ShiftAssignment` (CRUD + copy-week + publish) jsou funkční.

### Task 5.1: `src/lib/shiftRoster.ts` — helpers

**Files:**
- Create: `src/lib/shiftRoster.ts`
- Create: `src/lib/shiftRoster.test.ts`

- [ ] **Step 1: Napsat failing testy**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStartFromDate, weekDatesFromStart, isoWeekNumber } from "./shiftRoster";

test("weekStartFromDate — pondělí zůstává", () => {
  const monday = new Date("2026-05-11T00:00:00Z");
  assert.equal(weekStartFromDate(monday).toISOString().slice(0, 10), "2026-05-11");
});

test("weekStartFromDate — středa → vrátí pondělí stejného týdne", () => {
  const wednesday = new Date("2026-05-13T00:00:00Z");
  assert.equal(weekStartFromDate(wednesday).toISOString().slice(0, 10), "2026-05-11");
});

test("weekStartFromDate — neděle → vrátí pondělí minulého týdne", () => {
  const sunday = new Date("2026-05-17T00:00:00Z");
  assert.equal(weekStartFromDate(sunday).toISOString().slice(0, 10), "2026-05-11");
});

test("weekDatesFromStart — vrací 7 dnů od pondělí", () => {
  const monday = new Date("2026-05-11T00:00:00Z");
  const dates = weekDatesFromStart(monday);
  assert.equal(dates.length, 7);
  assert.equal(dates[0].toISOString().slice(0, 10), "2026-05-11");
  assert.equal(dates[6].toISOString().slice(0, 10), "2026-05-17");
});

test("isoWeekNumber — 11. 5. 2026 je 20. ISO týden", () => {
  assert.equal(isoWeekNumber(new Date("2026-05-11T00:00:00Z")), 20);
});
```

- [ ] **Step 2: Spustit testy — FAIL**

```bash
node --test --import tsx src/lib/shiftRoster.test.ts
```

Expected: FAIL — modul neexistuje.

- [ ] **Step 3: Implementovat `src/lib/shiftRoster.ts`**

```typescript
/**
 * Vrátí pondělí daného týdne (UTC). Vstup: libovolný den, Výstup: pondělí 00:00:00 UTC.
 */
export function weekStartFromDate(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = neděle, 1 = pondělí, ...
  const diff = dow === 0 ? -6 : 1 - dow; // neděle → -6, pondělí → 0, úterý → -1, ...
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * Vrátí 7 po sobě jdoucích dnů od `start` (pondělí).
 */
export function weekDatesFromStart(start: Date): Date[] {
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d);
  }
  return out;
}

/**
 * ISO 8601 číslo týdne (1-53).
 */
export function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
```

- [ ] **Step 4: Spustit testy — PASS**

```bash
node --test --import tsx src/lib/shiftRoster.test.ts
```

Expected: všech 5 testů zelené.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shiftRoster.ts src/lib/shiftRoster.test.ts
git commit -m "feat(rozpis): helpers pro týden (weekStart, weekDates, isoWeek)"
```

---

### Task 5.2: API route `/api/shift-assignments` (GET, POST)

**Files:**
- Create: `src/app/api/shift-assignments/route.ts`

- [ ] **Step 1: Implementovat GET a POST**

```typescript
import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { SHIFTS, type ShiftType } from "@/lib/shifts";
import { weekStartFromDate } from "@/lib/shiftRoster";

export async function GET(req: Request) {
  try {
    await requireRole(["ADMIN", "PLANOVAT"]);
    const url = new URL(req.url);
    const weekStartStr = url.searchParams.get("weekStart");
    const machine = url.searchParams.get("machine");

    if (!weekStartStr) throw new AppError("VALIDATION_ERROR", "weekStart je povinný.");
    const weekStart = weekStartFromDate(new Date(weekStartStr + "T00:00:00.000Z"));
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

    const where: {
      date: { gte: Date; lt: Date };
      machine?: string;
    } = {
      date: { gte: weekStart, lt: weekEnd },
    };
    if (machine) where.machine = machine;

    const assignments = await prisma.shiftAssignment.findMany({
      where,
      include: { printer: true },
      orderBy: [{ date: "asc" }, { shift: "asc" }, { sortOrder: "asc" }],
    });

    return NextResponse.json(assignments);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    logger.error("[shift-assignments.GET] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]);
    const body = (await req.json()) as {
      machine?: string;
      date?: string;
      shift?: string;
      printerId?: number;
      note?: string | null;
      sortOrder?: number;
    };

    if (!body.machine || !body.date || !body.shift || !body.printerId) {
      throw new AppError("VALIDATION_ERROR", "machine, date, shift, printerId jsou povinné.");
    }
    if (!SHIFTS.includes(body.shift as ShiftType)) {
      throw new AppError("VALIDATION_ERROR", "Neplatný shift (MORNING/AFTERNOON/NIGHT).");
    }
    const date = new Date(body.date + "T00:00:00.000Z");
    if (Number.isNaN(date.getTime())) throw new AppError("VALIDATION_ERROR", "Neplatné datum.");

    const assignment = await prisma.shiftAssignment.upsert({
      where: {
        machine_date_shift_printerId: {
          machine: body.machine,
          date,
          shift: body.shift,
          printerId: body.printerId,
        },
      },
      create: {
        machine: body.machine,
        date,
        shift: body.shift,
        printerId: body.printerId,
        note: body.note ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
      update: {
        note: body.note ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
      include: { printer: true },
    });

    logger.info("[shift-assignments.POST] upsert", { id: assignment.id, by: user.username });
    return NextResponse.json(assignment);
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "VALIDATION_ERROR" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error("[shift-assignments.POST] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manuální curl test**

```bash
curl -s -X POST http://localhost:3000/api/shift-assignments \
  -H "Content-Type: application/json" -H "Cookie: integraf-session=<TOKEN>" \
  -d '{"machine":"XL_106","date":"2026-05-11","shift":"MORNING","printerId":1}'
```

Expected: vrátí JSON s `id`, `machine`, `date`, `shift: "MORNING"`, `printer: { ... }`.

```bash
curl -s "http://localhost:3000/api/shift-assignments?weekStart=2026-05-11&machine=XL_106" \
  -H "Cookie: integraf-session=<TOKEN>"
```

Expected: pole obsahuje vytvořený záznam.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/shift-assignments/route.ts
git commit -m "feat(rozpis): API /api/shift-assignments (GET, POST)"
```

---

### Task 5.3: API route `/api/shift-assignments/[id]` (DELETE)

**Files:**
- Create: `src/app/api/shift-assignments/[id]/route.ts`

- [ ] **Step 1: Implementovat DELETE**

```typescript
import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]);
    if (!Number.isFinite(id)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");

    await prisma.shiftAssignment.delete({ where: { id } });
    logger.info("[shift-assignments.DELETE]", { id, by: user.username });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    if ((err as { code?: string })?.code === "P2025") return NextResponse.json({ error: "Přiřazení nenalezeno." }, { status: 404 });
    logger.error("[shift-assignments.DELETE] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shift-assignments/[id]/route.ts
git commit -m "feat(rozpis): API /api/shift-assignments/[id] (DELETE)"
```

---

### Task 5.4: API route `/api/shift-assignments/copy-week` (POST)

**Files:**
- Create: `src/app/api/shift-assignments/copy-week/route.ts`

- [ ] **Step 1: Implementovat POST**

```typescript
import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { weekStartFromDate } from "@/lib/shiftRoster";

export async function POST(req: Request) {
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]);
    const body = (await req.json()) as {
      fromWeekStart?: string;
      toWeekStart?: string;
      overwrite?: boolean;
    };

    if (!body.fromWeekStart || !body.toWeekStart) {
      throw new AppError("VALIDATION_ERROR", "fromWeekStart a toWeekStart jsou povinné.");
    }

    const from = weekStartFromDate(new Date(body.fromWeekStart + "T00:00:00.000Z"));
    const to = weekStartFromDate(new Date(body.toWeekStart + "T00:00:00.000Z"));
    const fromEnd = new Date(from);
    fromEnd.setUTCDate(fromEnd.getUTCDate() + 7);
    const toEnd = new Date(to);
    toEnd.setUTCDate(toEnd.getUTCDate() + 7);
    const dayDiffMs = to.getTime() - from.getTime();

    const source = await prisma.shiftAssignment.findMany({
      where: { date: { gte: from, lt: fromEnd } },
    });

    const existingInTarget = await prisma.shiftAssignment.findMany({
      where: { date: { gte: to, lt: toEnd } },
      select: { id: true },
    });

    if (existingInTarget.length > 0 && !body.overwrite) {
      return NextResponse.json(
        {
          error: "Cílový týden obsahuje existující přiřazení.",
          existingCount: existingInTarget.length,
          needsOverwrite: true,
        },
        { status: 409 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      if (body.overwrite && existingInTarget.length > 0) {
        await tx.shiftAssignment.deleteMany({
          where: { date: { gte: to, lt: toEnd } },
        });
      }
      const created = await tx.shiftAssignment.createMany({
        data: source.map((a) => ({
          machine: a.machine,
          date: new Date(a.date.getTime() + dayDiffMs),
          shift: a.shift,
          printerId: a.printerId,
          note: a.note,
          sortOrder: a.sortOrder,
          publishedAt: null, // nový týden není publikovaný
        })),
        skipDuplicates: true,
      });
      return created.count;
    });

    logger.info("[shift-assignments.copy-week]", {
      from: body.fromWeekStart,
      to: body.toWeekStart,
      copied: result,
      by: user.username,
    });
    return NextResponse.json({ copied: result });
  } catch (err) {
    if (isAppError(err)) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "VALIDATION_ERROR" ? 400 : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    logger.error("[shift-assignments.copy-week] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Manuální curl test**

```bash
curl -s -X POST http://localhost:3000/api/shift-assignments/copy-week \
  -H "Content-Type: application/json" -H "Cookie: integraf-session=<TOKEN>" \
  -d '{"fromWeekStart":"2026-05-11","toWeekStart":"2026-05-18"}'
```

Expected: `{ copied: N }` kde N je počet záznamů z týdne 11. 5.

Pokud cílový týden už má data a `overwrite: false`:
Expected: HTTP 409 s `{ error: "...", existingCount: M, needsOverwrite: true }`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/shift-assignments/copy-week/route.ts
git commit -m "feat(rozpis): API /api/shift-assignments/copy-week"
```

---

### Task 5.5: API route `/api/shift-assignments/publish` (POST)

**Files:**
- Create: `src/app/api/shift-assignments/publish/route.ts`

- [ ] **Step 1: Implementovat**

```typescript
import { NextResponse } from "next/server";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { weekStartFromDate } from "@/lib/shiftRoster";

export async function POST(req: Request) {
  try {
    const user = await requireRole(["ADMIN", "PLANOVAT"]);
    const body = (await req.json()) as { weekStart?: string };
    if (!body.weekStart) throw new AppError("VALIDATION_ERROR", "weekStart je povinný.");

    const start = weekStartFromDate(new Date(body.weekStart + "T00:00:00.000Z"));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);

    const result = await prisma.shiftAssignment.updateMany({
      where: { date: { gte: start, lt: end }, publishedAt: null },
      data: { publishedAt: new Date() },
    });

    logger.info("[shift-assignments.publish]", { weekStart: body.weekStart, updated: result.count, by: user.username });
    return NextResponse.json({ published: result.count });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
    logger.error("[shift-assignments.publish] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/shift-assignments/publish/route.ts
git commit -m "feat(rozpis): API /api/shift-assignments/publish"
```

---

## Sprint 6 — Rozpis směn: frontend

**Cíl sprintu:** Plánovač vidí novou stránku "Rozpis směn" v Adminu s gridem, dokáže kliknutím přiřadit tiskaře, kopírovat z minulého týdne, publikovat. UX odpovídá mockupu.

### Task 6.1: Nový tab "Rozpis směn" + základní layout

**Files:**
- Create: `src/components/admin/ShiftRoster.tsx`
- Modify: `src/app/admin/_components/AdminDashboard.tsx`

- [ ] **Step 1: Vytvořit základní komponentu s načtením dat**

```typescript
// src/components/admin/ShiftRoster.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { SHIFTS, SHIFT_LABELS, type ShiftType, type ShiftFlags } from "@/lib/shifts";
import { weekStartFromDate, weekDatesFromStart, isoWeekNumber } from "@/lib/shiftRoster";
import type { Printer } from "./PrinterCodebook";

type ShiftAssignment = {
  id: number;
  machine: string;
  date: string;
  shift: ShiftType;
  printerId: number;
  printer: Printer;
  note: string | null;
  sortOrder: number;
  publishedAt: string | null;
};

type DayScheduleRow = {
  dayOfWeek: number;
  morningOn: boolean;
  afternoonOn: boolean;
  nightOn: boolean;
  isActive: boolean;
};

const MACHINES = ["XL_105", "XL_106"] as const;
const MACHINE_LABELS: Record<string, string> = { XL_105: "XL 105", XL_106: "XL 106" };

export function ShiftRoster() {
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartFromDate(new Date()));
  const [assignments, setAssignments] = useState<ShiftAssignment[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [scheduleRows, setScheduleRows] = useState<Record<string, DayScheduleRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const weekDates = useMemo(() => weekDatesFromStart(weekStart), [weekStart]);
  const weekStartStr = weekStart.toISOString().slice(0, 10);
  const kt = useMemo(() => isoWeekNumber(weekStart), [weekStart]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [assignRes, printerRes, scheduleRes] = await Promise.all([
        fetch(`/api/shift-assignments?weekStart=${weekStartStr}`),
        fetch("/api/printers"),
        fetch("/api/machine-shifts"),
      ]);
      if (!assignRes.ok) throw new Error("Chyba načtení přiřazení");
      if (!printerRes.ok) throw new Error("Chyba načtení tiskařů");
      if (!scheduleRes.ok) throw new Error("Chyba načtení pracovní doby");

      setAssignments(await assignRes.json());
      setPrinters(await printerRes.json());

      // Pracovní doba: { templates: [{ machine, days: [...] }, ...] } nebo podobná struktura
      const scheduleData = await scheduleRes.json();
      const byMachine: Record<string, DayScheduleRow[]> = {};
      for (const t of scheduleData.templates ?? scheduleData) {
        if (!t.isDefault) continue; // pro MVP jen výchozí šablonu; validFrom/validTo řeší validátor
        byMachine[t.machine] = t.days;
      }
      setScheduleRows(byMachine);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [weekStartStr]);

  const shiftEnabled = (machine: string, date: Date, shift: ShiftType): boolean => {
    const dayOfWeek = date.getUTCDay();
    const row = scheduleRows[machine]?.find((r) => r.dayOfWeek === dayOfWeek);
    if (!row || !row.isActive) return false;
    return shift === "MORNING" ? row.morningOn : shift === "AFTERNOON" ? row.afternoonOn : row.nightOn;
  };

  const cellAssignments = (machine: string, date: Date, shift: ShiftType): ShiftAssignment[] => {
    const dateStr = date.toISOString().slice(0, 10);
    return assignments.filter(
      (a) => a.machine === machine && a.shift === shift && a.date.slice(0, 10) === dateStr
    );
  };

  const navigateWeek = (delta: number) => {
    const next = new Date(weekStart);
    next.setUTCDate(next.getUTCDate() + delta * 7);
    setWeekStart(weekStartFromDate(next));
  };

  if (loading) return <div style={{ padding: 16 }}>Načítám…</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Rozpis směn</h2>
      {error && <div style={{ color: "#ef4444", marginBottom: 12 }}>{error}</div>}

      {/* Header — week nav + akce */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigateWeek(-1)} style={{ padding: "6px 12px" }}>← Předchozí</button>
          <div style={{ fontWeight: 600, fontSize: 16 }}>
            {kt}. KT · {weekDates[0].toISOString().slice(0, 10)} – {weekDates[6].toISOString().slice(0, 10)}
          </div>
          <button onClick={() => navigateWeek(1)} style={{ padding: "6px 12px" }}>Další →</button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* Tlačítka: Zkopírovat z minulého týdne, Publikovat — v Task 6.4 */}
        </div>
      </div>

      {/* Grid */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#1e293b" }}>
            <th style={{ padding: 8, textAlign: "left", border: "1px solid #334155", width: 120 }}>Stroj / Směna</th>
            {weekDates.map((d) => {
              const dow = d.getUTCDay();
              const isWeekend = dow === 0 || dow === 6;
              return (
                <th key={d.toISOString()} style={{ padding: 8, border: "1px solid #334155", background: isWeekend ? "#0f172a" : undefined }}>
                  {["Ne", "Po", "Út", "St", "Čt", "Pá", "So"][dow]} {d.getUTCDate()}.{d.getUTCMonth() + 1}.
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {MACHINES.map((machine) => (
            <Fragment key={machine}>
              <tr>
                <td colSpan={8} style={{ padding: 10, background: "#0c2340", color: "#60a5fa", fontWeight: 600, border: "1px solid #334155" }}>
                  🖨️ {MACHINE_LABELS[machine]}
                </td>
              </tr>
              {SHIFTS.map((shift) => (
                <tr key={`${machine}-${shift}`}>
                  <td style={{ padding: 8, border: "1px solid #334155", background: "#1e293b" }}>
                    <strong>{SHIFT_LABELS[shift]}</strong>
                  </td>
                  {weekDates.map((d) => {
                    const enabled = shiftEnabled(machine, d, shift);
                    const items = cellAssignments(machine, d, shift);
                    return (
                      <ShiftRosterCell
                        key={d.toISOString()}
                        machine={machine}
                        date={d}
                        shift={shift}
                        enabled={enabled}
                        assignments={items}
                        printers={printers}
                        onChange={load}
                      />
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Poznámka:** `Fragment` je z React (`import { Fragment } from "react"`). `ShiftRosterCell` implementujeme v Task 6.2.

- [ ] **Step 2: Zaregistrovat tab v `AdminDashboard`**

Upravit stejně jako v Task 2.2, ale s novým tabem `"rozpis"`:

```typescript
// visibleTabs
const visibleTabs = (["users", "codebook", "presets", "audit", "shifts", "tiskari", "rozpis"] as const).filter((tab) => {
  if (isPlanovat) return tab !== "users" && tab !== "audit";
  return true;
});

// labels
{tab === "users" ? "Uživatelé"
  : tab === "codebook" ? "Číselníky"
  : tab === "presets" ? "Presety"
  : tab === "audit" ? "Audit log"
  : tab === "shifts" ? "Pracovní doba"
  : tab === "tiskari" ? "Tiskaři"
  : "Rozpis směn"}

// content
) : activeTab === "rozpis" ? (
  <ShiftRoster />
) : null}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/ShiftRoster.tsx src/app/admin/_components/AdminDashboard.tsx
git commit -m "feat(rozpis): nový tab v Adminu + základní grid"
```

---

### Task 6.2: Komponenta `ShiftRosterCell` — buňka s popoverem

**Files:**
- Create: `src/components/admin/ShiftRosterCell.tsx`

- [ ] **Step 1: Implementovat buňku**

```typescript
"use client";

import { useState } from "react";
import type { ShiftType } from "@/lib/shifts";
import type { Printer } from "./PrinterCodebook";

type ShiftAssignment = {
  id: number;
  machine: string;
  date: string;
  shift: ShiftType;
  printerId: number;
  printer: Printer;
  note: string | null;
  sortOrder: number;
};

type Props = {
  machine: string;
  date: Date;
  shift: ShiftType;
  enabled: boolean;
  assignments: ShiftAssignment[];
  printers: Printer[];
  onChange: () => void;
};

const DISABLED_STYLE: React.CSSProperties = {
  background: "repeating-linear-gradient(45deg,#1e293b,#1e293b 5px,#0f172a 5px,#0f172a 10px)",
  cursor: "not-allowed",
};

const EMPTY_WARNING_STYLE: React.CSSProperties = {
  background: "#451a03",
  borderLeft: "3px solid #f59e0b",
};

export function ShiftRosterCell({ machine, date, shift, enabled, assignments, printers, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const dateStr = date.toISOString().slice(0, 10);
  const isEmpty = enabled && assignments.length === 0;

  const assign = async (printerId: number, note?: string) => {
    const res = await fetch("/api/shift-assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machine, date: dateStr, shift, printerId, note: note ?? null }),
    });
    if (!res.ok) {
      alert((await res.json()).error ?? "Chyba");
      return;
    }
    onChange();
  };

  const remove = async (id: number) => {
    const res = await fetch(`/api/shift-assignments/${id}`, { method: "DELETE" });
    if (!res.ok) {
      alert((await res.json()).error ?? "Chyba");
      return;
    }
    onChange();
  };

  if (!enabled) {
    return <td style={{ ...DISABLED_STYLE, border: "1px solid #334155" }} title="Směna je vypnutá v pracovní době" />;
  }

  return (
    <td
      style={{
        padding: 8,
        border: "1px solid #334155",
        background: isEmpty ? "#451a03" : "#052e16",
        borderLeft: isEmpty ? "3px solid #f59e0b" : "1px solid #334155",
        cursor: "pointer",
        verticalAlign: "top",
        minHeight: 48,
      }}
      onClick={() => setOpen(true)}
      title={isEmpty ? "⚠ Chybí obsazení" : undefined}
    >
      {isEmpty ? (
        <div style={{ color: "#fbbf24", fontStyle: "italic" }}>⚠ prázdné</div>
      ) : (
        assignments.map((a) => (
          <div key={a.id} style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "#bef264" }}>{a.printer.name}</span>
            {a.note && <span style={{ color: "#fbbf24", fontSize: 11 }}>({a.note})</span>}
            <button
              onClick={(e) => {
                e.stopPropagation();
                void remove(a.id);
              }}
              style={{ marginLeft: "auto", padding: "2px 6px", background: "transparent", color: "#ef4444", border: "none", cursor: "pointer" }}
              title="Odebrat"
            >
              ×
            </button>
          </div>
        ))
      )}

      {open && (
        <div style={{ position: "absolute", background: "#0f172a", border: "1px solid #475569", padding: 8, zIndex: 100, marginTop: 4 }}>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Přidat tiskaře:</div>
          {printers.filter((p) => !assignments.some((a) => a.printerId === p.id)).map((p) => (
            <button
              key={p.id}
              onClick={(e) => {
                e.stopPropagation();
                void assign(p.id);
                setOpen(false);
              }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 8px", background: "transparent", color: "#e2e8f0", border: "none", cursor: "pointer" }}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            style={{ marginTop: 4, padding: "4px 8px", background: "#475569", color: "#fff", border: "none", cursor: "pointer", width: "100%" }}
          >
            Zavřít
          </button>
        </div>
      )}
    </td>
  );
}
```

**Poznámka:** popover je trochu primitivní (otevře se pod buňkou). Pokud projekt používá Radix `Popover` (viz imports v `AdminDashboard.tsx`), zváž použití — bude to konzistentnější.

- [ ] **Step 2: Importovat `ShiftRosterCell` v `ShiftRoster.tsx`**

```typescript
import { ShiftRosterCell } from "./ShiftRosterCell";
```

- [ ] **Step 3: Ověřit v prohlížeči**

```bash
npm run dev
```

Admin → Rozpis směn → grid se zobrazí, klik na buňku otevře popover, výběr tiskaře se uloží. Šedé buňky (vypnuté směny) neotevírají popover.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/ShiftRosterCell.tsx src/components/admin/ShiftRoster.tsx
git commit -m "feat(rozpis): ShiftRosterCell s popoverem pro přiřazení"
```

---

### Task 6.3: Tlačítka "Zkopírovat z minulého týdne" a "Publikovat"

**Files:**
- Modify: `src/components/admin/ShiftRoster.tsx`

- [ ] **Step 1: Doplnit handlery v `ShiftRoster`**

Najdi v `ShiftRoster.tsx` část `{/* Tlačítka: Zkopírovat z minulého týdne, Publikovat — v Task 6.4 */}` a nahraď:

```typescript
{(() => {
  const prev = new Date(weekStart);
  prev.setUTCDate(prev.getUTCDate() - 7);
  const prevStr = prev.toISOString().slice(0, 10);
  const prevKt = isoWeekNumber(prev);

  const copyFromPrev = async () => {
    let res = await fetch("/api/shift-assignments/copy-week", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromWeekStart: prevStr, toWeekStart: weekStartStr }),
    });
    if (res.status === 409) {
      const body = await res.json();
      if (!confirm(`Cílový týden už má ${body.existingCount} přiřazení. Přepsat?`)) return;
      res = await fetch("/api/shift-assignments/copy-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromWeekStart: prevStr, toWeekStart: weekStartStr, overwrite: true }),
      });
    }
    if (!res.ok) {
      alert((await res.json()).error ?? "Chyba");
      return;
    }
    await load();
  };

  const publish = async () => {
    const res = await fetch("/api/shift-assignments/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart: weekStartStr }),
    });
    if (!res.ok) {
      alert((await res.json()).error ?? "Chyba");
      return;
    }
    const data = await res.json();
    alert(`Publikováno ${data.published} přiřazení.`);
    await load();
  };

  return (
    <>
      <button
        onClick={() => void copyFromPrev()}
        style={{ padding: "6px 12px", background: "#475569", color: "#fff", border: "none", cursor: "pointer" }}
      >
        📋 Zkopírovat z {prevKt}. KT
      </button>
      <button
        onClick={() => void publish()}
        style={{ padding: "6px 12px", background: "#15803d", color: "#fff", border: "none", cursor: "pointer" }}
      >
        ✓ Publikovat
      </button>
    </>
  );
})()}
```

- [ ] **Step 2: Ověřit**

Copy: v týdnu 19. KT přidej pár přiřazení. Přejdi na 20. KT → klik "Zkopírovat z 19. KT" → přiřazení se zkopírují. Pokud 20. KT už má data, ptá se na přepis.

Publish: klik → alert "Publikováno N přiřazení".

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/ShiftRoster.tsx
git commit -m "feat(rozpis): tlačítka Zkopírovat a Publikovat"
```

---

## Sprint 7 — Cascade dialog + polish

**Cíl sprintu:** Vypnutí směny v Pracovní době, na které už jsou přiřazení, vede k explicitnímu potvrzovacímu dialogu. Warning o prázdných směnách se zobrazí v summary panelu.

### Task 7.1: Backend — cascade detection v `/api/machine-shifts` PUT

**Files:**
- Modify: `src/app/api/machine-shifts/route.ts`

- [ ] **Step 1: Přidat detekci dotčených přiřazení před uložením**

V PUT handleru, PŘED transakcí, spočítej budoucí dotčená přiřazení:

```typescript
import { SHIFTS, type ShiftType } from "@/lib/shifts";

// ... uvnitř PUT handleru po normalizaci dayInputs ...

// Detekce cascade: které směny se vypínají, které měly dříve přiřazení
const oldTemplate = await prisma.machineWorkHoursTemplate.findUnique({
  where: { id: body.templateId },
  include: { days: true },
});
if (!oldTemplate) throw new AppError("NOT_FOUND", "Šablona nenalezena.");

const shiftsBeingDisabled: Array<{ dayOfWeek: number; shift: ShiftType }> = [];
for (const newDay of dayInputs /* array po normalizeDayInput */) {
  const oldDay = oldTemplate.days.find((d) => d.dayOfWeek === newDay.dayOfWeek);
  if (!oldDay) continue;
  const checks: Array<[ShiftType, boolean, boolean]> = [
    ["MORNING", oldDay.morningOn, newDay.morningOn],
    ["AFTERNOON", oldDay.afternoonOn, newDay.afternoonOn],
    ["NIGHT", oldDay.nightOn, newDay.nightOn],
  ];
  for (const [shift, oldOn, newOn] of checks) {
    if (oldOn && !newOn) shiftsBeingDisabled.push({ dayOfWeek: newDay.dayOfWeek, shift });
  }
}

if (shiftsBeingDisabled.length > 0) {
  // Najdi budoucí ShiftAssignment pro tento stroj, v těchto kombinacích dayOfWeek+shift, od today
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const futureAssignments = await prisma.shiftAssignment.findMany({
    where: {
      machine: oldTemplate.machine,
      date: { gte: today },
      OR: shiftsBeingDisabled.map((s) => ({ shift: s.shift })),
    },
    include: { printer: true },
  });

  // Přefiltrovat lokálně podle dayOfWeek (Prisma neumí dayOfWeek filter přes SQL bez DATE_FORMAT)
  const affected = futureAssignments.filter((a) => {
    const dow = new Date(a.date).getUTCDay();
    return shiftsBeingDisabled.some((s) => s.dayOfWeek === dow && s.shift === a.shift);
  });

  if (affected.length > 0 && !body.force) {
    return NextResponse.json(
      {
        error: "Vypínané směny mají přiřazená obsazení.",
        needsConfirmation: true,
        affectedCount: affected.length,
        affected: affected.slice(0, 20).map((a) => ({
          id: a.id,
          date: a.date.toISOString().slice(0, 10),
          shift: a.shift,
          printerName: a.printer.name,
        })),
      },
      { status: 409 }
    );
  }

  if (affected.length > 0 && body.force) {
    // Transakce: smaž obsazení + ulož šablonu + audit
    await prisma.$transaction([
      prisma.shiftAssignment.deleteMany({
        where: { id: { in: affected.map((a) => a.id) } },
      }),
      // ... update šablony (stávající kód) ...
      prisma.auditLog.create({
        data: {
          blockId: 0, // rozšíříme — nebo přidáme pole `subjectType` v AuditLog. Pro MVP: 0 znamená "ne-blok"
          userId: user.id,
          username: user.username,
          action: "CASCADE_DELETE_SHIFT_ASSIGNMENTS",
          field: "ShiftAssignment",
          oldValue: JSON.stringify(affected.map((a) => ({ id: a.id, date: a.date, shift: a.shift, printer: a.printer.name }))),
          newValue: null,
        },
      }),
    ]);
  }
}

// Pokračuje běžný kód PUT (update šablony).
```

**Poznámka:** `AuditLog.blockId` je aktuálně not-null integer — pro "ne-blok" audit musíme buď (a) mít technickou hodnotu jako 0, (b) rozšířit `AuditLog` o volitelnou polymorfní referenci. Pro MVP použij `blockId: 0` + poznámku v `action`.

Alternativně pokud chceme čistější řešení: přidej v této iteraci migraci, která udělá `AuditLog.blockId` nullable. Ale to je scope creep — zvaž odložit.

- [ ] **Step 2: Manuální test**

1. Do 20. KT přidej přiřazení na Po odpolední XL_106.
2. Otevři editor pracovní doby pro XL_106 a vypni odpolední na Po. Klikni uložit.
3. Expected: odpověď 409 s `needsConfirmation: true, affectedCount: 1, affected: [...]`.
4. Pošli stejný request znovu s `force: true`.
5. Expected: 200, přiřazení smazáno, v `AuditLog` je záznam.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/machine-shifts/route.ts
git commit -m "feat(shifts): cascade detection v /api/machine-shifts PUT"
```

---

### Task 7.2: UI dialog pro cascade potvrzení

**Files:**
- Create: `src/components/admin/DisableShiftCascadeDialog.tsx`
- Modify: editor pracovní doby v `AdminDashboard.tsx`

- [ ] **Step 1: Vytvořit dialog komponentu**

```typescript
"use client";

import { SHIFT_LABELS, type ShiftType } from "@/lib/shifts";

type Affected = {
  id: number;
  date: string;
  shift: ShiftType;
  printerName: string;
};

type Props = {
  affectedCount: number;
  affected: Affected[];
  onConfirm: () => void;
  onCancel: () => void;
};

export function DisableShiftCascadeDialog({ affectedCount, affected, onConfirm, onCancel }: Props) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center"
    }}>
      <div style={{ background: "#0f172a", padding: 24, maxWidth: 600, border: "1px solid #475569" }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: "#fbbf24" }}>
          ⚠ Zrušíš {affectedCount} přiřazení
        </h3>
        <p style={{ color: "#cbd5e1", marginBottom: 12 }}>
          Vypnutím této směny se smažou následující obsazení tiskařů pro budoucí dny:
        </p>
        <ul style={{ maxHeight: 200, overflowY: "auto", marginBottom: 16, color: "#e2e8f0" }}>
          {affected.map((a) => (
            <li key={a.id}>
              {a.date} — {SHIFT_LABELS[a.shift]}: <strong>{a.printerName}</strong>
            </li>
          ))}
          {affectedCount > affected.length && (
            <li style={{ color: "#94a3b8" }}>…a dalších {affectedCount - affected.length}</li>
          )}
        </ul>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "8px 16px", background: "#475569", color: "#fff", border: "none", cursor: "pointer" }}>
            Zrušit
          </button>
          <button onClick={onConfirm} style={{ padding: "8px 16px", background: "#b91c1c", color: "#fff", border: "none", cursor: "pointer" }}>
            Ano, smazat a uložit
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Napojit dialog na save handler pracovní doby**

V editoru pracovní doby (v `AdminDashboard.tsx` nebo extrahované komponentě) uprav handler `savePracovniDoba`:

```typescript
const [cascadeData, setCascadeData] = useState<{
  affectedCount: number;
  affected: Affected[];
  pendingPayload: any;
} | null>(null);

const save = async (payload: any, force = false) => {
  const res = await fetch("/api/machine-shifts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, force }),
  });
  if (res.status === 409) {
    const body = await res.json();
    if (body.needsConfirmation) {
      setCascadeData({ affectedCount: body.affectedCount, affected: body.affected, pendingPayload: payload });
      return;
    }
  }
  if (!res.ok) {
    alert((await res.json()).error ?? "Chyba");
    return;
  }
  // OK — reload
};

// v JSX:
{cascadeData && (
  <DisableShiftCascadeDialog
    affectedCount={cascadeData.affectedCount}
    affected={cascadeData.affected}
    onConfirm={() => {
      const pl = cascadeData.pendingPayload;
      setCascadeData(null);
      void save(pl, true);
    }}
    onCancel={() => setCascadeData(null)}
  />
)}
```

- [ ] **Step 3: Ověřit v prohlížeči**

Scénář ze Task 7.1: vytvoř přiřazení → vypni směnu → uvidíš dialog → klik Potvrdit → uloží se, přiřazení smazána.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/DisableShiftCascadeDialog.tsx src/app/admin/_components/AdminDashboard.tsx
git commit -m "feat(shifts): cascade dialog pro vypnutí obsazené směny"
```

---

### Task 7.3: Warning o prázdných směnách v Rozpisu směn

**Files:**
- Modify: `src/components/admin/ShiftRoster.tsx`

- [ ] **Step 1: Přidat summary panel nad gridem**

V `ShiftRoster.tsx` za hlavičkou (week nav + akce) a před tabulkou přidej:

```typescript
const emptyShifts = useMemo(() => {
  const empties: Array<{ machine: string; date: Date; shift: ShiftType }> = [];
  for (const machine of MACHINES) {
    for (const d of weekDates) {
      for (const shift of SHIFTS) {
        if (!shiftEnabled(machine, d, shift)) continue;
        if (cellAssignments(machine, d, shift).length === 0) empties.push({ machine, date: d, shift });
      }
    }
  }
  return empties;
}, [scheduleRows, assignments, weekDates]);

// ...v JSX před tabulkou:

{emptyShifts.length > 0 && (
  <div style={{
    marginBottom: 16, padding: 12, background: "#451a03", borderLeft: "4px solid #f59e0b", color: "#fbbf24"
  }}>
    <strong>⚠ {emptyShifts.length} prázdných směn v tomto týdnu:</strong>
    <ul style={{ marginTop: 8, marginBottom: 0 }}>
      {emptyShifts.slice(0, 5).map((e) => (
        <li key={`${e.machine}-${e.date.toISOString()}-${e.shift}`}>
          {MACHINE_LABELS[e.machine]} — {["Ne","Po","Út","St","Čt","Pá","So"][e.date.getUTCDay()]} {e.date.getUTCDate()}.{e.date.getUTCMonth() + 1}. {SHIFT_LABELS[e.shift]}
        </li>
      ))}
      {emptyShifts.length > 5 && <li>...a dalších {emptyShifts.length - 5}</li>}
    </ul>
  </div>
)}
```

- [ ] **Step 2: Ověřit**

Ponech v nějaké buňce prázdno → summary se zobrazí s počtem a konkrétními dny.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/ShiftRoster.tsx
git commit -m "feat(rozpis): summary panel s prázdnými směnami"
```

---

### Task 7.4: End-to-end manuální test checklist

**Files:**
- Žádné změny kódu — jen ověření funkčnosti.

- [ ] **Step 1: Projít kompletní scénář v aplikaci**

```
☐ /admin → tab Tiskaři → přidat "TESTA", "TESTB", "TESTC"
☐ /admin → tab Pracovní doba → XL_106 → Po: ranní✓ odpol.✗ noční✓
☐ /admin → tab Rozpis směn → 20. KT (nebo aktuální týden)
  ☐ Buňka Po XL_106 odpolední je šedá (vypnutá) — nelze kliknout
  ☐ Buňka Po XL_106 ranní je žlutá (prázdná) — lze kliknout
  ☐ Klik → popover se seznamem TESTA/TESTB/TESTC → vybrat TESTA
  ☐ Po přiřazení žlutý rámeček zmizí, buňka je zelená s "TESTA"
☐ Klik "📋 Zkopírovat z 19. KT"
  ☐ Pokud 19. KT je prázdný: copied = 0
  ☐ Pokud má data: zkopíruje se (nebo ptá se na přepis)
☐ /admin → tab Pracovní doba → vypni Po ranní na XL_106
  ☐ Dialog "Zrušíš 1 přiřazení (TESTA)"
  ☐ Klik Potvrdit → uloží se, přiřazení smazáno
  ☐ Zpět na Rozpis směn: Po ranní XL_106 je teď šedá
☐ /admin → tab Pracovní doba → zapni Po ranní zpět
☐ Rozpis směn → Klik "✓ Publikovat" → alert "Publikováno N přiřazení"
```

- [ ] **Step 2: Test suite**

```bash
node --test --import tsx src/lib/shifts.test.ts
node --test --import tsx src/lib/shiftRoster.test.ts
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: všech ~35+ testů zelené.

- [ ] **Step 3: Build a lint**

```bash
npm run build
npm run lint
```

Expected: build projde, lint hlásí jen existující warningy (žádné nové).

- [ ] **Step 4: Smazat testovací data z DB**

```bash
mysql -u root -pmysql IGvyroba -e "
DELETE FROM ShiftAssignment;
UPDATE Printer SET isActive = 1 WHERE name LIKE 'TEST%';
DELETE FROM Printer WHERE name LIKE 'TEST%';
"
```

- [ ] **Step 5: Commit (pokud byly provedeny úpravy dokumentace)**

```bash
# Pokud jsi během testování dopsal do docs/:
# git add docs/
# git commit -m "docs: poznámky z e2e testování rozpisu směn"

# Jinak: žádný commit, feature je hotový
echo "Rozpis směn feature — implementace kompletní."
```

---

## Shrnutí

**7 sprintů, cca 23 tasků, každý s TDD / manual-test + commitem.**

Po dokončení:
- Plánovač nastaví **pracovní dobu** zaškrtnutím směn (ne číselnými vstupy).
- **Nový tab Tiskaři** v Adminu — číselník operátorů.
- **Nový tab Rozpis směn** — týdenní grid s kopírováním a publikací.
- **Validátor zakázek** používá směnné flagy místo startHour/endHour.
- **Excel `TISKAŘI - aktuální rozpis směn.xls`** je nahraditelný aplikací.

Rizika a záložní plány jsou popsané v [specu](../specs/2026-04-19-rozpis-smen-design.md#rizika-a-mitigace).
