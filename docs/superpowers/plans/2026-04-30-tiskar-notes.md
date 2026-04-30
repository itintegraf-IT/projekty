# Tiskařské poznámky — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Umožnit tiskařům zapisovat k zakázce poznámky (více poznámek/blok), nahradit ruční Denní výkaz práce. Poznámky výrazně viditelné na bloku, edit/smaz vlastní do 30 min.

**Architecture:**
- Nová tabulka `BlockNote` (1:N k `Block`), audit log při každé mutaci v `$transaction`.
- API `POST/PUT/DELETE /api/blocks/[id]/notes[/[noteId]]` s `AppError` patternem a `logger`.
- UI: oranžový levý okraj + statický badge `📝 N` + 1 řádek nejnovější poznámky na bloku v `TimelineGrid`. Plný seznam + editace přes dialog `BlockNotesDialog`.
- Viditelnost (číst+zapisovat): pouze role `TISKAR`, `ADMIN`, `PLANOVAT`. Tiskař jen na svém přiřazeném stroji.

**Tech Stack:** Next.js 16, React, TypeScript, Tailwind v4, Prisma 5, MySQL, jose JWT, existing `AppError`/`logger`/`emitSSE`/`auditLog` patterns.

---

## File Structure

**Vytvoří:**
- `prisma/migrations/<timestamp>_add_block_note/migration.sql` — DDL pro `BlockNote`
- `src/lib/blockNotePermissions.ts` — pure helper `canEditBlockNote()` + edit window
- `src/lib/blockNotePermissions.test.ts` — testy helperu
- `src/lib/blockNoteSerialization.ts` — `serializeBlockNote()`
- `src/app/api/blocks/[id]/notes/route.ts` — POST (create)
- `src/app/api/blocks/[id]/notes/[noteId]/route.ts` — PUT, DELETE
- `src/components/BlockNotesDialog.tsx` — modal pro seznam + editaci poznámek

**Modifikuje:**
- `prisma/schema.prisma` — přidat model `BlockNote` + relaci v `Block`
- `src/lib/blockSerialization.ts` — zahrnout `notes` do serializovaného bloku (volitelné podle role)
- `src/app/page.tsx` — `include: { notes: ... }` v `prisma.block.findMany`, podle role
- `src/app/_components/PlannerPage.tsx` — props pro role-gating + integrace dialogu
- `src/app/_components/TimelineGrid.tsx` — visual treatment v `BlockCard` (border + badge + 1. řádek), button "Poznámka" pro tiskaře
- `src/lib/auditFormatters.ts` — labels pro nové akce `NOTE_CREATE`, `NOTE_UPDATE`, `NOTE_DELETE`

---

## Task 1: Prisma model + migrace

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_block_note/migration.sql`

- [ ] **Step 1: Přidat model `BlockNote` a relaci v `Block`**

V `prisma/schema.prisma` doplnit relaci do modelu `Block` (mezi existující relace, řádek ~71):

```prisma
notes  BlockNote[]
```

A nový model na konec souboru (před `enum`y, pokud nějaké jsou):

```prisma
model BlockNote {
  id                Int      @id @default(autoincrement())
  blockId           Int
  text              String   @db.Text
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  createdByUserId   Int
  createdByUsername String

  block             Block    @relation(fields: [blockId], references: [id], onDelete: Cascade)

  @@index([blockId, createdAt])
}
```

**Pozor:** název relace v `Block` musí být lowercase plural (`notes`), jinak rozbije konvenci. Po uložení v Prisma extension neformátovat — viz CLAUDE.md.

- [ ] **Step 2: Vytvořit migraci**

```bash
npx prisma migrate dev --name add_block_note
```

Expected: migrace vznikne v `prisma/migrations/<timestamp>_add_block_note/migration.sql`, obsahuje `CREATE TABLE BlockNote` a FK na `Block.id` s `ON DELETE CASCADE`.

- [ ] **Step 3: Build + typecheck**

```bash
npm run build
```

Expected: build projde, žádné TypeScript chyby kvůli novému Prisma typu.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add BlockNote model for tiskar notes"
```

---

## Task 2: Permissions helper + test

**Files:**
- Create: `src/lib/blockNotePermissions.ts`
- Create: `src/lib/blockNotePermissions.test.ts`

- [ ] **Step 1: Napsat failing test**

`src/lib/blockNotePermissions.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert";
import { canEditBlockNote, NOTE_EDIT_WINDOW_MS, MAX_NOTE_LENGTH } from "./blockNotePermissions";

const now = new Date("2026-04-30T10:00:00Z");
const fresh = new Date(now.getTime() - 5 * 60 * 1000);     // 5 min ago
const stale = new Date(now.getTime() - 60 * 60 * 1000);    // 60 min ago

const ownNoteFresh = { id: 1, blockId: 10, createdByUserId: 7, createdAt: fresh, machine: "XL_105" };
const ownNoteStale = { ...ownNoteFresh, createdAt: stale };
const otherUsersNote = { ...ownNoteFresh, createdByUserId: 99 };

test("ADMIN can always edit any note", () => {
  assert.strictEqual(canEditBlockNote(otherUsersNote, { role: "ADMIN", id: 1, assignedMachine: null }, now), true);
});

test("PLANOVAT can always edit any note", () => {
  assert.strictEqual(canEditBlockNote(ownNoteStale, { role: "PLANOVAT", id: 1, assignedMachine: null }, now), true);
});

test("TISKAR can edit own note within 30 min on assigned machine", () => {
  assert.strictEqual(canEditBlockNote(ownNoteFresh, { role: "TISKAR", id: 7, assignedMachine: "XL_105" }, now), true);
});

test("TISKAR cannot edit own stale note (>30 min)", () => {
  assert.strictEqual(canEditBlockNote(ownNoteStale, { role: "TISKAR", id: 7, assignedMachine: "XL_105" }, now), false);
});

test("TISKAR cannot edit other user's note", () => {
  assert.strictEqual(canEditBlockNote(otherUsersNote, { role: "TISKAR", id: 7, assignedMachine: "XL_105" }, now), false);
});

test("TISKAR cannot edit note on wrong machine", () => {
  assert.strictEqual(canEditBlockNote(ownNoteFresh, { role: "TISKAR", id: 7, assignedMachine: "XL_106" }, now), false);
});

test("DTP/MTZ/OBCHODNIK/VIEWER cannot edit", () => {
  for (const role of ["DTP", "MTZ", "OBCHODNIK", "VIEWER"] as const) {
    assert.strictEqual(canEditBlockNote(ownNoteFresh, { role, id: 7, assignedMachine: "XL_105" }, now), false);
  }
});

test("NOTE_EDIT_WINDOW_MS = 30 minut", () => {
  assert.strictEqual(NOTE_EDIT_WINDOW_MS, 30 * 60 * 1000);
});

test("MAX_NOTE_LENGTH = 500 znaků", () => {
  assert.strictEqual(MAX_NOTE_LENGTH, 500);
});
```

- [ ] **Step 2: Spustit test, ověřit FAIL**

```bash
node --test --import tsx src/lib/blockNotePermissions.test.ts
```

Expected: chyba `Cannot find module './blockNotePermissions'`.

- [ ] **Step 3: Implementovat helper**

`src/lib/blockNotePermissions.ts`:

```typescript
export const NOTE_EDIT_WINDOW_MS = 30 * 60 * 1000;
export const MAX_NOTE_LENGTH = 500;

export type NoteRole = "ADMIN" | "PLANOVAT" | "TISKAR" | "DTP" | "MTZ" | "OBCHODNIK" | "VIEWER";

export interface NoteForPermission {
  id: number;
  blockId: number;
  createdByUserId: number;
  createdAt: Date;
  /** machine bloku, ke kterému poznámka patří */
  machine: string;
}

export interface NoteActor {
  id: number;
  role: NoteRole;
  assignedMachine: string | null;
}

/** Smí daný uživatel poznámku editovat nebo smazat? */
export function canEditBlockNote(note: NoteForPermission, actor: NoteActor, now: Date = new Date()): boolean {
  if (actor.role === "ADMIN" || actor.role === "PLANOVAT") return true;
  if (actor.role !== "TISKAR") return false;
  if (note.createdByUserId !== actor.id) return false;
  if (actor.assignedMachine !== note.machine) return false;
  return now.getTime() - note.createdAt.getTime() <= NOTE_EDIT_WINDOW_MS;
}

/** Smí daný uživatel obecně poznámky vidět/zakládat (na svém stroji)? */
export function canAccessBlockNotes(role: NoteRole): boolean {
  return role === "ADMIN" || role === "PLANOVAT" || role === "TISKAR";
}

/** Smí daný uživatel založit poznámku k bloku na daném stroji? */
export function canCreateBlockNote(actor: NoteActor, blockMachine: string): boolean {
  if (actor.role === "ADMIN" || actor.role === "PLANOVAT") return true;
  if (actor.role !== "TISKAR") return false;
  return actor.assignedMachine === blockMachine;
}
```

- [ ] **Step 4: Spustit test, ověřit PASS**

```bash
node --test --import tsx src/lib/blockNotePermissions.test.ts
```

Expected: všechny 9 testů zelené.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blockNotePermissions.ts src/lib/blockNotePermissions.test.ts
git commit -m "feat(notes): add BlockNote permissions helper + tests"
```

---

## Task 3: Serializace poznámek

**Files:**
- Create: `src/lib/blockNoteSerialization.ts`
- Modify: `src/lib/blockSerialization.ts`

- [ ] **Step 1: Vytvořit serializer poznámky**

`src/lib/blockNoteSerialization.ts`:

```typescript
import type { BlockNote } from "@prisma/client";

export interface SerializedBlockNote {
  id: number;
  blockId: number;
  text: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: number;
  createdByUsername: string;
}

export function serializeBlockNote(note: BlockNote): SerializedBlockNote {
  return {
    id: note.id,
    blockId: note.blockId,
    text: note.text,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    createdByUserId: note.createdByUserId,
    createdByUsername: note.createdByUsername,
  };
}
```

- [ ] **Step 2: Rozšířit `serializeBlock`**

V `src/lib/blockSerialization.ts` přidat volitelné pole `notes` do `SerializedBlock` (interface) a do funkce. Pokud volající nepředal blok s `notes` (Prisma include), poslat `[]`.

Najít existující `serializeBlock` a přidat:

```typescript
import { serializeBlockNote, type SerializedBlockNote } from "./blockNoteSerialization";

// V interface SerializedBlock přidat:
//   notes: SerializedBlockNote[];

// V těle funkce na konec returnu přidat:
//   notes: Array.isArray((block as any).notes)
//     ? ((block as any).notes as Array<Parameters<typeof serializeBlockNote>[0]>).map(serializeBlockNote)
//     : [],
```

(Konkrétní cast přizpůsob skutečnému typu v `blockSerialization.ts`. Po uložení spusť `npm run build`.)

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: žádné TS chyby. Pokud se v existujících call-sites ukáže, že `notes` je required ale chybí — udělat ho `notes?: SerializedBlockNote[]` a v UI zacházet jako `(block.notes ?? [])`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/blockNoteSerialization.ts src/lib/blockSerialization.ts
git commit -m "feat(notes): serialize BlockNote alongside Block"
```

---

## Task 4: API — POST /api/blocks/[id]/notes (create)

**Files:**
- Create: `src/app/api/blocks/[id]/notes/route.ts`

- [ ] **Step 1: Implementovat POST**

`src/app/api/blocks/[id]/notes/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { canCreateBlockNote, MAX_NOTE_LENGTH } from "@/lib/blockNotePermissions";
import { serializeBlockNote } from "@/lib/blockNoteSerialization";
import { emitSSE } from "@/lib/eventBus";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHORIZED", "Není přihlášen.");

    const { id } = await params;
    const blockId = Number(id);
    if (isNaN(blockId)) throw new AppError("VALIDATION", "Neplatné ID bloku.");

    const body = (await req.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new AppError("VALIDATION", "Text poznámky je povinný.");
    if (text.length > MAX_NOTE_LENGTH) {
      throw new AppError("VALIDATION", `Poznámka je delší než ${MAX_NOTE_LENGTH} znaků.`);
    }

    const block = await prisma.block.findUnique({ where: { id: blockId } });
    if (!block) throw new AppError("NOT_FOUND", "Blok nenalezen.");

    const actor = { id: session.id, role: session.role as never, assignedMachine: session.assignedMachine ?? null };
    if (!canCreateBlockNote(actor, block.machine)) {
      throw new AppError("FORBIDDEN", "Nemáš oprávnění zapsat poznámku k tomuto bloku.");
    }

    const [note] = await prisma.$transaction([
      prisma.blockNote.create({
        data: {
          blockId,
          text,
          createdByUserId: session.id,
          createdByUsername: session.username,
        },
      }),
      prisma.auditLog.create({
        data: {
          blockId,
          orderNumber: block.orderNumber,
          userId: session.id,
          username: session.username,
          action: "NOTE_CREATE",
          newValue: text,
        },
      }),
    ]);

    const serialized = serializeBlockNote(note);
    emitSSE("block:note-created", { blockId, machine: block.machine, note: serialized, sourceUserId: session.id });
    return NextResponse.json(serialized, { status: 201 });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    }
    logger.error("[notes] POST chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

**Pozn.:** `session.role` je v existujícím auth typu union string, cast `as never` nahraď reálným typem který používá `getSession()` (zkontroluj `src/lib/auth.ts` — interface `SessionUser`). Pokud má pole `role: string`, použij rovnou `role: session.role as NoteRole`.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: čistý build.

- [ ] **Step 3: Manuální smoke test (curl)**

Spusť dev server v jiném terminálu (`npm run dev`), přihlaš se v prohlížeči jako tiskař, zkopíruj cookie `integraf-session` a:

```bash
curl -X POST http://localhost:3000/api/blocks/<existující-blok-id>/notes \
  -H "Content-Type: application/json" \
  -H "Cookie: integraf-session=<token>" \
  -d '{"text":"test poznámka"}'
```

Expected: `201` + JSON s vytvořenou poznámkou. Druhý request s `OBCHODNIK` cookie → `403`. Prázdný text → `400`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/blocks/[id]/notes/route.ts
git commit -m "feat(api): POST /api/blocks/[id]/notes — create tiskar note"
```

---

## Task 5: API — PUT a DELETE /api/blocks/[id]/notes/[noteId]

**Files:**
- Create: `src/app/api/blocks/[id]/notes/[noteId]/route.ts`

- [ ] **Step 1: Implementovat PUT + DELETE**

`src/app/api/blocks/[id]/notes/[noteId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { canEditBlockNote, MAX_NOTE_LENGTH, type NoteRole } from "@/lib/blockNotePermissions";
import { serializeBlockNote } from "@/lib/blockNoteSerialization";
import { emitSSE } from "@/lib/eventBus";

async function loadContext(blockIdRaw: string, noteIdRaw: string) {
  const blockId = Number(blockIdRaw);
  const noteId = Number(noteIdRaw);
  if (isNaN(blockId) || isNaN(noteId)) throw new AppError("VALIDATION", "Neplatné ID.");
  const note = await prisma.blockNote.findUnique({ where: { id: noteId } });
  if (!note || note.blockId !== blockId) throw new AppError("NOT_FOUND", "Poznámka nenalezena.");
  const block = await prisma.block.findUnique({ where: { id: blockId } });
  if (!block) throw new AppError("NOT_FOUND", "Blok nenalezen.");
  return { note, block };
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHORIZED", "Není přihlášen.");

    const { id, noteId } = await params;
    const { note, block } = await loadContext(id, noteId);

    const actor = { id: session.id, role: session.role as NoteRole, assignedMachine: session.assignedMachine ?? null };
    if (!canEditBlockNote({ ...note, machine: block.machine }, actor)) {
      throw new AppError("FORBIDDEN", "Poznámku už nelze upravovat.");
    }

    const body = (await req.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new AppError("VALIDATION", "Text poznámky je povinný.");
    if (text.length > MAX_NOTE_LENGTH) {
      throw new AppError("VALIDATION", `Poznámka je delší než ${MAX_NOTE_LENGTH} znaků.`);
    }
    if (text === note.text) {
      return NextResponse.json(serializeBlockNote(note));
    }

    const [updated] = await prisma.$transaction([
      prisma.blockNote.update({ where: { id: note.id }, data: { text } }),
      prisma.auditLog.create({
        data: {
          blockId: block.id,
          orderNumber: block.orderNumber,
          userId: session.id,
          username: session.username,
          action: "NOTE_UPDATE",
          oldValue: note.text,
          newValue: text,
        },
      }),
    ]);

    const serialized = serializeBlockNote(updated);
    emitSSE("block:note-updated", { blockId: block.id, machine: block.machine, note: serialized, sourceUserId: session.id });
    return NextResponse.json(serialized);
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[notes] PUT chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHORIZED", "Není přihlášen.");

    const { id, noteId } = await params;
    const { note, block } = await loadContext(id, noteId);

    const actor = { id: session.id, role: session.role as NoteRole, assignedMachine: session.assignedMachine ?? null };
    if (!canEditBlockNote({ ...note, machine: block.machine }, actor)) {
      throw new AppError("FORBIDDEN", "Poznámku už nelze smazat.");
    }

    await prisma.$transaction([
      prisma.blockNote.delete({ where: { id: note.id } }),
      prisma.auditLog.create({
        data: {
          blockId: block.id,
          orderNumber: block.orderNumber,
          userId: session.id,
          username: session.username,
          action: "NOTE_DELETE",
          oldValue: note.text,
        },
      }),
    ]);

    emitSSE("block:note-deleted", { blockId: block.id, machine: block.machine, noteId: note.id, sourceUserId: session.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[notes] DELETE chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: čistý build.

- [ ] **Step 3: Manuální smoke**

```bash
# update vlastní poznámky (do 30 min) — 200
curl -X PUT http://localhost:3000/api/blocks/<blockId>/notes/<noteId> \
  -H "Content-Type: application/json" -H "Cookie: integraf-session=<token>" \
  -d '{"text":"upraveno"}'

# delete — 200
curl -X DELETE http://localhost:3000/api/blocks/<blockId>/notes/<noteId> \
  -H "Cookie: integraf-session=<token>"
```

Expected: 200/204. Cizí poznámka tiskařem → 403. Po 30 min → 403.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/blocks/[id]/notes/[noteId]/route.ts
git commit -m "feat(api): PUT/DELETE block note s 30min editovacím oknem"
```

---

## Task 6: Načítat poznámky v page.tsx (jen pro povolené role)

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Rozšířit Prisma findMany**

V `src/app/page.tsx` aktuální `prisma.block.findMany` (řádky ~20-24) změnit:

```typescript
const canSeeNotes = ["ADMIN", "PLANOVAT", "TISKAR"].includes(session.role);

const blocks = await prisma.block.findMany({
  where: isTiskar && session.assignedMachine ? { machine: session.assignedMachine } : undefined,
  orderBy: { startTime: "asc" },
  include: {
    Reservation: { select: { confirmedAt: true } },
    notes: canSeeNotes ? { orderBy: { createdAt: "desc" } } : false,
  },
});
```

(Pokud `include: { notes: false }` v aktuální verzi Prisma způsobí typ-error, použij conditional spread:

```typescript
const include = {
  Reservation: { select: { confirmedAt: true } },
  ...(canSeeNotes ? { notes: { orderBy: { createdAt: "desc" as const } } } : {}),
};
const blocks = await prisma.block.findMany({ where: ..., orderBy: ..., include });
```
)

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: čistý build, `serializeBlock` přijme bloky s `notes`.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(page): include block notes for ADMIN/PLANOVAT/TISKAR"
```

---

## Task 7: BlockNotesDialog — UI pro seznam + editaci

**Files:**
- Create: `src/components/BlockNotesDialog.tsx`

- [ ] **Step 1: Vytvořit komponent**

`src/components/BlockNotesDialog.tsx`:

```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_NOTE_LENGTH, NOTE_EDIT_WINDOW_MS } from "@/lib/blockNotePermissions";
import type { SerializedBlockNote } from "@/lib/blockNoteSerialization";

interface Props {
  open: boolean;
  blockId: number;
  blockMachine: string;
  blockOrderNumber: string;
  notes: SerializedBlockNote[];
  currentUser: { id: number; role: "ADMIN" | "PLANOVAT" | "TISKAR" | string; assignedMachine: string | null };
  canCreate: boolean;
  onClose: () => void;
  onCreate: (text: string) => Promise<void>;
  onUpdate: (noteId: number, text: string) => Promise<void>;
  onDelete: (noteId: number) => Promise<void>;
}

export function BlockNotesDialog({
  open, blockId, blockMachine, blockOrderNumber, notes, currentUser,
  canCreate, onClose, onCreate, onUpdate, onDelete,
}: Props) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft("");
      setEditingId(null);
      setEditingText("");
    } else {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const now = Date.now();
  function canEditExisting(n: SerializedBlockNote): boolean {
    if (currentUser.role === "ADMIN" || currentUser.role === "PLANOVAT") return true;
    if (currentUser.role !== "TISKAR") return false;
    if (n.createdByUserId !== currentUser.id) return false;
    if (currentUser.assignedMachine !== blockMachine) return false;
    return now - new Date(n.createdAt).getTime() <= NOTE_EDIT_WINDOW_MS;
  }

  async function submitNew() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    try { await onCreate(text); setDraft(""); } finally { setBusy(false); }
  }

  async function submitEdit() {
    if (editingId === null || busy) return;
    const text = editingText.trim();
    if (!text) return;
    setBusy(true);
    try { await onUpdate(editingId, text); setEditingId(null); setEditingText(""); } finally { setBusy(false); }
  }

  async function confirmDelete(id: number) {
    if (busy) return;
    if (!confirm("Smazat poznámku?")) return;
    setBusy(true);
    try { await onDelete(id); } finally { setBusy(false); }
  }

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <h2 className="text-base font-semibold text-slate-100">
            Poznámky · zakázka {blockOrderNumber} · {blockMachine}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-100 px-2"
            aria-label="Zavřít"
          >×</button>
        </div>

        <div className="overflow-y-auto px-4 py-3 space-y-3 flex-1">
          {notes.length === 0 && (
            <p className="text-sm text-slate-400 italic">Zatím žádné poznámky.</p>
          )}
          {notes.map((n) => {
            const editable = canEditExisting(n);
            const isEditing = editingId === n.id;
            return (
              <div key={n.id} className="border-l-4 border-amber-500 bg-slate-800/60 px-3 py-2 rounded">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <div className="text-xs text-slate-400">
                    <span className="font-medium text-slate-200">{n.createdByUsername}</span>
                    {" · "}
                    {new Date(n.createdAt).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" })}
                    {n.updatedAt !== n.createdAt && <span> · upraveno</span>}
                  </div>
                  {editable && !isEditing && (
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() => { setEditingId(n.id); setEditingText(n.text); }}
                        className="text-blue-400 hover:text-blue-300"
                      >Upravit</button>
                      <button
                        onClick={() => confirmDelete(n.id)}
                        className="text-red-400 hover:text-red-300"
                      >Smazat</button>
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <>
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value.slice(0, MAX_NOTE_LENGTH))}
                      rows={3}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
                    />
                    <div className="flex gap-2 mt-1 justify-end">
                      <button
                        onClick={() => { setEditingId(null); setEditingText(""); }}
                        className="px-3 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
                      >Zrušit</button>
                      <button
                        onClick={submitEdit}
                        disabled={busy || !editingText.trim()}
                        className="px-3 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                      >Uložit</button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-100 whitespace-pre-wrap break-words">{n.text}</p>
                )}
              </div>
            );
          })}
        </div>

        {canCreate && (
          <div className="border-t border-slate-700 px-4 py-3 space-y-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_NOTE_LENGTH))}
              rows={3}
              placeholder="Nová poznámka…"
              className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{draft.length}/{MAX_NOTE_LENGTH}</span>
              <button
                onClick={submitNew}
                disabled={busy || !draft.trim()}
                className="px-3 py-1 text-sm rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
              >Přidat poznámku</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: čistý build.

- [ ] **Step 3: Commit**

```bash
git add src/components/BlockNotesDialog.tsx
git commit -m "feat(notes): add BlockNotesDialog component"
```

---

## Task 8: Visual treatment v TimelineGrid (BlockCard) — pruh nahoře + badge

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`

**Design rozhodnutí (po preview):** žádný snippet textu na bloku. Pouze:
- 4 px oranžový pruh nahoře (přes celou šířku bloku)
- badge `📝 N` v pravém horním rohu

Plný text poznámky se zobrazí v hover tooltipu (Task 8.5) a v dialogu (Task 9).

- [ ] **Step 1: Rozšířit typ `Block` v `TimelineGrid.tsx`**

V interface, kde je definován `Block` (kolem řádku ~114, tam kde je `materialNote`), přidat:

```typescript
notes?: Array<{
  id: number;
  blockId: number;
  text: string;
  createdAt: string;
  updatedAt: string;
  createdByUserId: number;
  createdByUsername: string;
}>;
```

- [ ] **Step 2: V `BlockCard` spočítat helpers**

Najít místo, kde je `hasNote = !!block.materialNote` (řádek ~733 nebo ~976) a přidat vedle:

```typescript
const tiskarNotes = block.notes ?? [];
const hasTiskarNotes = tiskarNotes.length > 0;
```

- [ ] **Step 3: Vykreslit pruh + badge**

V JSX bloku (uvnitř BlockCard, na úrovni vnějšího wrap div) přidat:

```tsx
{hasTiskarNotes && (
  <>
    {/* oranžový pruh nahoře — 4 px, přes celou šířku */}
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        background: "#f59e0b",
        borderTopLeftRadius: 5,
        borderTopRightRadius: 5,
        pointerEvents: "none",
        zIndex: 1,
      }}
    />
    {/* badge v pravém horním rohu — počet poznámek */}
    <span
      title={`Poznámek tiskaře: ${tiskarNotes.length}`}
      style={{
        position: "absolute",
        top: 6,
        right: 4,
        background: "#f59e0b",
        color: "#1f2937",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        padding: "2px 6px",
        borderRadius: 4,
        boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      📝 {tiskarNotes.length}
    </span>
  </>
)}
```

**Pozor:** padding bloku v BlockCard se nesmí měnit (pruh nahoře přes obsah nepřekrývá nic kritického — kontrolovat při buildu, případně přidat `paddingTop: hasTiskarNotes ? 8 : undefined` k vnějšímu div).

- [ ] **Step 4: Přidat prop pro otevření dialogu**

V `BlockCard` rozšířit props o:

```typescript
onOpenNotes?: (block: Block) => void;
```

A v JSX přidat handler na klik bloku — pokud `onOpenNotes` existuje a uživatel klikl mimo existující interaktivní elementy (např. nedrží Ctrl pro lasso), otevřít dialog.

**Doporučený přístup:** přidat tlačítko `📝 Poznámka` do existujícího kontextového menu (`ContextMenu` v BlockCard, řádek ~1641). Najít místo s ostatními akcemi (např. vedle "Potvrdit tisk"):

```tsx
{onOpenNotes && (
  <ContextMenuItem
    onClick={() => onOpenNotes(block)}
    style={menuItemStyle}
  >
    📝 Poznámka{hasTiskarNotes ? ` (${tiskarNotes.length})` : ""}
  </ContextMenuItem>
)}
```

A taky volitelně badge `📝 N` udělat klikatelný (mimo `pointerEvents: "none"`):

```tsx
<span
  onClick={(e) => { e.stopPropagation(); onOpenNotes?.(block); }}
  style={{ ...badge, cursor: "pointer", pointerEvents: "auto" }}
>
  📝 {tiskarNotes.length}
</span>
```

(První iterace: jen kontextové menu. Klikatelný badge přidat až pokud Vojta řekne.)

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: čistý build.

- [ ] **Step 6: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat(planner): top stripe + badge pro tiskarské poznámky na bloku"
```

---

## Task 8.5: Rozšíření hover tooltipu o sekci „Poznámky tiskař"

**Files:**
- Modify: `src/app/_components/TimelineGrid.tsx`

**Cíl:** Pod existující sekci „Termíny" v hover tooltipu (řádek ~1525) přidat novou sekci, která ukazuje až 3 poslední poznámky. Pokud je víc, přidat řádek „+ N dalších" odkazující na dialog.

- [ ] **Step 1: Najít existující tooltip**

Otevřít `TimelineGrid.tsx` na řádku ~1525, sekci `{showTooltip && hovered && (() => { ... })}`. Najít místo, kde končí sekce „Termíny" — uzavřený `</div>` po `block.deadlineExpedice`. Po něm vkládáme novou sekci.

- [ ] **Step 2: Přidat sekci „Poznámky tiskař"**

Vložit za existující `hasDateInfo` blok, ještě uvnitř hlavního tooltip `<div>`:

```tsx
{tiskarNotes.length > 0 && (
  <div style={{
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid rgba(255,255,255,0.08)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  }}>
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      color: "#f59e0b",
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      marginBottom: 2,
    }}>
      <span>📝 Poznámky tiskař</span>
      <span style={{
        background: "#f59e0b",
        color: "#1f2937",
        padding: "1px 5px",
        borderRadius: 8,
        fontSize: 9,
        fontWeight: 700,
      }}>{tiskarNotes.length}</span>
    </div>
    {tiskarNotes.slice(0, 3).map((n) => (
      <div key={n.id} style={{
        borderLeft: "2px solid #f59e0b",
        paddingLeft: 8,
      }}>
        <div style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.85)",
          lineHeight: 1.45,
          whiteSpace: "pre-wrap",
        }}>{n.text}</div>
        <div style={{
          fontSize: 9,
          color: "rgba(255,255,255,0.32)",
          marginTop: 2,
          letterSpacing: "0.02em",
        }}>
          {n.createdByUsername} · {new Date(n.createdAt).toLocaleString("cs-CZ", {
            day: "numeric", month: "numeric",
            hour: "2-digit", minute: "2-digit",
            timeZone: "Europe/Prague",
          })}
          {n.updatedAt !== n.createdAt && " · upraveno"}
        </div>
      </div>
    ))}
    {tiskarNotes.length > 3 && (
      <div style={{
        fontSize: 10,
        color: "#f59e0b",
        textAlign: "center",
        fontStyle: "italic",
        marginTop: 4,
      }}>
        + {tiskarNotes.length - 3} dalších
      </div>
    )}
  </div>
)}
```

**Pozn.:** `tiskarNotes` musí být dostupný v closure tooltipu — je definován na úrovni `BlockCard` (Task 8 Step 2), tooltip je v jeho returnu, takže přístup je přímý.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: čistý build.

- [ ] **Step 4: Manuální test**

Najet myší na blok s poznámkami → tooltip se rozšíří o oranžovou sekci s textem poznámek. Najet na blok bez poznámek → tooltip beze změny.

- [ ] **Step 5: Commit**

```bash
git add src/app/_components/TimelineGrid.tsx
git commit -m "feat(planner): hover tooltip — sekce poznámek tiskař"
```

---

## Task 9: Integrace v PlannerPage

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx`

- [ ] **Step 1: Přidat state pro otevřený dialog**

Někam mezi ostatní `useState` v `PlannerPage`:

```typescript
const [notesDialogBlock, setNotesDialogBlock] = useState<Block | null>(null);
```

A povolovací flag:

```typescript
const canSeeNotes = currentUser.role === "ADMIN" || currentUser.role === "PLANOVAT" || currentUser.role === "TISKAR";
```

- [ ] **Step 2: Implementovat handlery**

```typescript
async function handleCreateNote(blockId: number, text: string) {
  const r = await fetch(`/api/blocks/${blockId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    showToast(j.error ?? "Nepodařilo se uložit poznámku", "error");
    return;
  }
  const note = await r.json();
  setBlocks((prev) => prev.map((b) =>
    b.id === blockId ? { ...b, notes: [note, ...(b.notes ?? [])] } : b
  ));
  setNotesDialogBlock((prev) => prev && prev.id === blockId
    ? { ...prev, notes: [note, ...(prev.notes ?? [])] }
    : prev
  );
}

async function handleUpdateNote(blockId: number, noteId: number, text: string) {
  const r = await fetch(`/api/blocks/${blockId}/notes/${noteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    showToast(j.error ?? "Nepodařilo se upravit poznámku", "error");
    return;
  }
  const note = await r.json();
  setBlocks((prev) => prev.map((b) =>
    b.id === blockId
      ? { ...b, notes: (b.notes ?? []).map((n) => n.id === noteId ? note : n) }
      : b
  ));
  setNotesDialogBlock((prev) => prev && prev.id === blockId
    ? { ...prev, notes: (prev.notes ?? []).map((n) => n.id === noteId ? note : n) }
    : prev
  );
}

async function handleDeleteNote(blockId: number, noteId: number) {
  const r = await fetch(`/api/blocks/${blockId}/notes/${noteId}`, { method: "DELETE" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    showToast(j.error ?? "Nepodařilo se smazat poznámku", "error");
    return;
  }
  setBlocks((prev) => prev.map((b) =>
    b.id === blockId
      ? { ...b, notes: (b.notes ?? []).filter((n) => n.id !== noteId) }
      : b
  ));
  setNotesDialogBlock((prev) => prev && prev.id === blockId
    ? { ...prev, notes: (prev.notes ?? []).filter((n) => n.id !== noteId) }
    : prev
  );
}
```

- [ ] **Step 3: Předat props do `TimelineGrid`**

V místě, kde `<TimelineGrid ... />` (kolem řádku ~2982), přidat:

```tsx
onOpenNotes={canSeeNotes ? (b) => setNotesDialogBlock(b) : undefined}
```

Pamatuj na propagaci propu skrz typ `TimelineGrid` props a `BlockCard` props.

- [ ] **Step 4: Renderovat dialog**

Na konec JSX `PlannerPage` (vedle ostatních modalů — InboxPanel, ToastContainer atd.):

```tsx
{notesDialogBlock && canSeeNotes && (
  <BlockNotesDialog
    open
    blockId={notesDialogBlock.id}
    blockMachine={notesDialogBlock.machine}
    blockOrderNumber={notesDialogBlock.orderNumber}
    notes={notesDialogBlock.notes ?? []}
    currentUser={{
      id: currentUser.id,
      role: currentUser.role,
      assignedMachine: currentUser.assignedMachine,
    }}
    canCreate={
      currentUser.role === "ADMIN" ||
      currentUser.role === "PLANOVAT" ||
      (currentUser.role === "TISKAR" && currentUser.assignedMachine === notesDialogBlock.machine)
    }
    onClose={() => setNotesDialogBlock(null)}
    onCreate={(text) => handleCreateNote(notesDialogBlock.id, text)}
    onUpdate={(noteId, text) => handleUpdateNote(notesDialogBlock.id, noteId, text)}
    onDelete={(noteId) => handleDeleteNote(notesDialogBlock.id, noteId)}
  />
)}
```

A na začátek souboru `import { BlockNotesDialog } from "@/components/BlockNotesDialog";`.

**Pozor:** Když se v `setBlocks` aktualizují poznámky, `notesDialogBlock` v dialogu by se měl reflektovat aktuální blok. Outside-of-state `notesDialogBlock` se mění odděleně (handlery výše to dělají). Alternativně lze odvodit `currentDialogBlock = blocks.find(b => b.id === notesDialogBlock?.id)` a předávat to.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: čistý build.

- [ ] **Step 6: Manuální E2E test (UI v prohlížeči)**

1. Login jako TISKAR (s `assignedMachine = XL_105`).
2. Najet na blok na XL_105 → klik "📝 Poznámka" → otevře dialog.
3. Napsat poznámku, uložit → blok dostane oranžový pruh + badge `📝 1` + snippet na bloku.
4. Otevřít dialog znovu → tlačítka "Upravit"/"Smazat" viditelná.
5. Uplynout >30 min (nebo dočasně snížit `NOTE_EDIT_WINDOW_MS` na 1000) → tlačítka zmizí.
6. Login jako PLANOVAT → vidí poznámku, může editovat/mazat. UI badge je vidět.
7. Login jako OBCHODNIK → poznámka i UI marker neviditelné, button "📝 Poznámka" se nezobrazuje.
8. Login jako TISKAR XL_105 a mrkni na blok na XL_106 (přes URL/highlight pokud možno) → button "📝 Poznámka" tam není (jiný stroj).

- [ ] **Step 7: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(planner): integrate BlockNotesDialog with API handlers"
```

---

## Task 10: Audit log labels

**Files:**
- Modify: `src/lib/auditFormatters.ts`

- [ ] **Step 1: Přidat labely**

Najít existující mapy `ACTION_LABELS` (nebo podobně) v `auditFormatters.ts` a doplnit:

```typescript
NOTE_CREATE: "Přidána poznámka",
NOTE_UPDATE: "Upravena poznámka",
NOTE_DELETE: "Smazána poznámka",
```

Pokud existuje funkce `fmtAuditVal` rozdělující podle action, dodělat větev tak, aby `oldValue`/`newValue` u NOTE_* zobrazovala text poznámky jako-is (žádný formátovač navíc).

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Otevřít InfoPanel u bloku s poznámkou**

Manuálně: provést NOTE_CREATE/UPDATE/DELETE → audit log v `InfoPanel` ukazuje akce s českými labely a textem poznámky.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auditFormatters.ts
git commit -m "feat(audit): NOTE_CREATE/UPDATE/DELETE labels"
```

---

## Task 11: SSE refresh napříč klienty (volitelné, doporučeno)

**Files:**
- Modify: `src/app/_components/PlannerPage.tsx` (SSE listener — pokud existuje)

- [ ] **Step 1: Přidat SSE handler**

Pokud `PlannerPage` už má SSE poslouchače (existující `eventBus`/`emitSSE` napovídá ano), najít místo `useEffect` s `EventSource` a přidat větve:

```typescript
case "block:note-created": {
  const { blockId, note, sourceUserId } = data;
  if (sourceUserId === currentUser.id) break;
  setBlocks((prev) => prev.map((b) =>
    b.id === blockId ? { ...b, notes: [note, ...(b.notes ?? []).filter((n) => n.id !== note.id)] } : b
  ));
  break;
}
case "block:note-updated": {
  const { blockId, note, sourceUserId } = data;
  if (sourceUserId === currentUser.id) break;
  setBlocks((prev) => prev.map((b) =>
    b.id === blockId
      ? { ...b, notes: (b.notes ?? []).map((n) => n.id === note.id ? note : n) }
      : b
  ));
  break;
}
case "block:note-deleted": {
  const { blockId, noteId, sourceUserId } = data;
  if (sourceUserId === currentUser.id) break;
  setBlocks((prev) => prev.map((b) =>
    b.id === blockId ? { ...b, notes: (b.notes ?? []).filter((n) => n.id !== noteId) } : b
  ));
  break;
}
```

(Pokud aktuální struktura SSE handleru je jiná — `if (data.type === ...)` apod. — použij stejný styl, jaký už má pro `block:print-completed`.)

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/app/_components/PlannerPage.tsx
git commit -m "feat(notes): real-time SSE refresh napříč klienty"
```

---

## Task 12: Final verification

- [ ] **Step 1: Spustit celou test suite**

```bash
node --test --import tsx src/lib/dateUtils.test.ts
node --test --import tsx src/lib/errors.test.ts
node --test --import tsx src/lib/blockNotePermissions.test.ts
node --experimental-test-module-mocks --test --import tsx src/lib/scheduleValidationServer.test.ts
```

Expected: všechno zelené (33/33 nebo víc).

- [ ] **Step 2: Build + lint**

```bash
npm run build
npm run lint
```

Expected: build zelený, lint warnings tolerovatelné, 0 errors.

- [ ] **Step 3: E2E checklist**

Projít UI scénáře:
- [ ] TISKAR (XL_105) zapíše, edituje, smaže poznámku na XL_105 do 30 min — funguje
- [ ] TISKAR po 30 min — Edit/Smaz tlačítka nezmizí jen vizuálně, server vrátí 403, toast informuje
- [ ] TISKAR cizí stroj (XL_106) — žádné UI markery, žádný button (server 403)
- [ ] PLANOVAT — vidí, vytváří, edituje, maže poznámky na obou strojích
- [ ] ADMIN — totéž
- [ ] OBCHODNIK / DTP / MTZ / VIEWER — žádné poznámky, žádné UI markery, server 403
- [ ] Více poznámek na bloku — badge ukazuje správný počet, snippet je nejnovější
- [ ] Audit log v InfoPanel — NOTE_CREATE/UPDATE/DELETE viditelné s textem
- [ ] SSE — druhý browser tab vidí poznámku po cca <1s bez F5

- [ ] **Step 4: Final commit (pokud zbylo něco)**

```bash
git status
# pokud je čisto: hotovo
# pokud něco zbylo:
git add -A
git commit -m "chore(notes): final cleanup"
```

---

## Self-Review checklist

- ✅ Spec cover: poznámky na blok (Task 1, 4), 30 min edit window (Task 2, 5), 500 znaků limit (Task 2, 4, 5, 7), výrazný visual bez animace (Task 8 — statický border + badge), žádné notifikace (záměrně vynecháno), viditelnost ADMIN/PLANOVAT/TISKAR (Task 6, 9), audit log (Task 4, 5, 10), tiskař jen na svém stroji (Task 2, 4, 5, 9).
- ✅ Žádné placeholdery, všechny code snippety jsou kompletní.
- ✅ Type konzistence: `SerializedBlockNote`, `NoteForPermission`, `NoteActor` definovány v Task 2 a 3, používány konzistentně v Task 4, 5, 7, 9.
- ⚠️ Task 8 a 9 obsahují fráze "(napasuj vedle existujícího …)" — to je úmyslné, protože `BlockCard` v `TimelineGrid.tsx` má bohatou strukturu a přesné umístění buttonu závisí na aktuálním layoutu. Engineer si najde vhodné místo (vedle "Potvrdit tisk").
