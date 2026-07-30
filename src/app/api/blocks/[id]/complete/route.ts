import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { serializeBlock } from "@/lib/blockSerialization";
import { emitSSE } from "@/lib/eventBus";

// POST /api/blocks/[id]/complete — potvrzení nebo vrácení tisku.
// Kioskově kritická route (tiskaři na terminálech, flaky síť) — chyby musí
// projít standardním catch blokem a skončit v logu, ne jako tichá 500.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireRole(["ADMIN", "PLANOVAT", "TISKAR"]);
    const { role, id: userId, username, assignedMachine } = session;

    const { id } = await params;
    const blockId = Number(id);
    if (!Number.isInteger(blockId) || blockId <= 0) {
      throw new AppError("VALIDATION_ERROR", "Neplatné ID");
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const completed = body.completed;
    if (typeof completed !== "boolean") {
      throw new AppError("VALIDATION_ERROR", "Chybí pole completed (boolean)");
    }

    // Načíst blok
    const block = await prisma.block.findUnique({ where: { id: blockId } });
    if (!block) throw new AppError("NOT_FOUND", "Blok nenalezen");

    // Jen ZAKAZKA může být potvrzena
    if (block.type !== "ZAKAZKA") {
      throw new AppError("VALIDATION_ERROR", "Potvrzení tisku je možné pouze u zakázek");
    }

    // TISKAR smí jen na svém stroji
    if (role === "TISKAR" && block.machine !== assignedMachine) {
      throw new AppError("FORBIDDEN", "Forbidden — cizí stroj");
    }

    const auditAction = completed ? "PRINT_COMPLETE" : "PRINT_UNDO";

    const [updatedBlock] = await prisma.$transaction([
      prisma.block.update({
        where: { id: blockId },
        data: completed
          ? {
              printCompletedAt: new Date(),
              printCompletedByUserId: userId,
              printCompletedByUsername: username,
            }
          : {
              printCompletedAt: null,
              printCompletedByUserId: null,
              printCompletedByUsername: null,
            },
      }),
      prisma.auditLog.create({
        data: {
          blockId,
          orderNumber: block.orderNumber,
          userId,
          username,
          action: auditAction,
        },
      }),
    ]);

    // Refetch s Reservation include pro reservationConfirmedAt
    const blockWithRes = await prisma.block.findUnique({
      where: { id: blockId },
      include: { Reservation: { select: { confirmedAt: true } } },
    }) ?? updatedBlock;

    emitSSE("block:print-completed", { block: serializeBlock(blockWithRes), machine: updatedBlock.machine, sourceUserId: session.id });
    return NextResponse.json(serializeBlock(blockWithRes));
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    logger.error("[POST /api/blocks/[id]/complete] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
