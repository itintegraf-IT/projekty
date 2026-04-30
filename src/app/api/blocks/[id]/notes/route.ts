import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { canCreateBlockNote, MAX_NOTE_LENGTH, type NoteRole } from "@/lib/blockNotePermissions";
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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Není přihlášen." }, { status: 401 });
    }

    const { id } = await params;
    const blockId = Number(id);
    if (isNaN(blockId)) throw new AppError("VALIDATION_ERROR", "Neplatné ID bloku.");

    const body = (await req.json()) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) throw new AppError("VALIDATION_ERROR", "Text poznámky je povinný.");
    if (text.length > MAX_NOTE_LENGTH) {
      throw new AppError("VALIDATION_ERROR", `Poznámka je delší než ${MAX_NOTE_LENGTH} znaků.`);
    }

    const block = await prisma.block.findUnique({ where: { id: blockId } });
    if (!block) throw new AppError("NOT_FOUND", "Blok nenalezen.");

    const actor = {
      id: session.id,
      role: session.role as NoteRole,
      assignedMachine: session.assignedMachine ?? null,
    };
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
    emitSSE("block:note-created", {
      blockId,
      machine: block.machine,
      note: serialized,
      sourceUserId: session.id,
    });
    return NextResponse.json(serialized, { status: 201 });
  } catch (err) {
    if (isAppError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: statusForCode(err.code) });
    }
    logger.error("[POST /api/blocks/[id]/notes]", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
