import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { canEditBlockNote, MAX_NOTE_LENGTH, type NoteRole } from "@/lib/blockNotePermissions";
import { serializeBlockNote } from "@/lib/blockNoteSerialization";
import { emitSSE } from "@/lib/eventBus";

function statusForCode(code: string): number {
  switch (code) {
    case "NOT_FOUND": return 404;
    case "FORBIDDEN": return 403;
    case "VALIDATION_ERROR": return 400;
    default: return 500;
  }
}

async function loadNoteAndBlock(blockIdRaw: string, noteIdRaw: string) {
  const blockId = Number(blockIdRaw);
  const noteId = Number(noteIdRaw);
  if (isNaN(blockId) || isNaN(noteId)) throw new AppError("VALIDATION_ERROR", "Neplatné ID.");
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
    if (!session) {
      return NextResponse.json({ error: "Není přihlášen." }, { status: 401 });
    }

    const { id, noteId } = await params;
    const { note, block } = await loadNoteAndBlock(id, noteId);

    const actor = {
      id: session.id,
      role: session.role as NoteRole,
      assignedMachine: session.assignedMachine ?? null,
    };
    if (!canEditBlockNote({ ...note, machine: block.machine }, actor)) {
      throw new AppError("FORBIDDEN", "Poznámku už nelze upravovat.");
    }

    const body = (await req.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new AppError("VALIDATION_ERROR", "Text poznámky je povinný.");
    if (text.length > MAX_NOTE_LENGTH) {
      throw new AppError("VALIDATION_ERROR", `Poznámka je delší než ${MAX_NOTE_LENGTH} znaků.`);
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
    emitSSE("block:note-updated", {
      blockId: block.id,
      machine: block.machine,
      note: serialized,
      sourceUserId: session.id,
    });
    return NextResponse.json(serialized);
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: statusForCode(err.code) });
    }
    logger.error("[PUT /api/blocks/[id]/notes/[noteId]]", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Není přihlášen." }, { status: 401 });
    }

    const { id, noteId } = await params;
    const { note, block } = await loadNoteAndBlock(id, noteId);

    const actor = {
      id: session.id,
      role: session.role as NoteRole,
      assignedMachine: session.assignedMachine ?? null,
    };
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

    emitSSE("block:note-deleted", {
      blockId: block.id,
      machine: block.machine,
      noteId: note.id,
      sourceUserId: session.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: statusForCode(err.code) });
    }
    logger.error("[DELETE /api/blocks/[id]/notes/[noteId]]", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
