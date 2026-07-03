import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAppError } from "@/lib/errors";
import { serializeBlock } from "@/lib/blockSerialization";
import { reflowBlockInTx } from "@/lib/reflow.server";
import { emitSSE } from "@/lib/eventBus";

type RouteContext = { params: Promise<{ id: string }> };

/** Mapping AppError kódů z chain push (resolveChainPushFromDb) — vzor `[id]/route.ts` PUT. */
function errorStatus(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "FORBIDDEN") return 403;
  if (code === "PRESET_INVALID") return 400;
  if (code === "SCHEDULE_VIOLATION") return 422;
  if (code === "CONFLICT") return 409;
  if (code === "OVERLAP") return 409;
  return 500;
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const outcome = await prisma.$transaction(
      (tx) => reflowBlockInTx(tx, id, { id: session.id, username: session.username }),
      { timeout: 15000, maxWait: 5000 }
    );

    if (!outcome.ok) {
      const status = outcome.code === "NOT_FOUND" ? 404 : 422;
      return NextResponse.json({ error: outcome.message, code: outcome.code }, { status });
    }

    // Refetch bloku + moves — include Reservation/notes (parita serializace se `[id]/route.ts` PUT).
    const block = await prisma.block.findUnique({
      where: { id },
      include: {
        Reservation: { select: { confirmedAt: true } },
        notes: { orderBy: { createdAt: "desc" as const } },
      },
    });
    if (!block) {
      // Blok zmizel mezi commitem transakce a refetchem (souběžný DELETE) — jde jen o refetch
      // pro response, přepočet už proběhl a je uložen; klient dostane chybu, ne rollback.
      return NextResponse.json({ error: "Blok nenalezen po přepočtu" }, { status: 404 });
    }
    const serializedBlock = serializeBlock(block);

    let serializedMoves: ReturnType<typeof serializeBlock>[] = [];
    if (outcome.moves.length > 0) {
      const movedBlocks = await prisma.block.findMany({
        where: { id: { in: outcome.moves.map((m) => m.id) } },
        include: {
          Reservation: { select: { confirmedAt: true } },
          notes: { orderBy: { createdAt: "desc" as const } },
        },
      });
      serializedMoves = movedBlocks.map(serializeBlock);
    }

    if (outcome.changed) {
      emitSSE("block:batch-updated", {
        blocks: [serializedBlock, ...serializedMoves],
        sourceUserId: session.id,
      });
    }

    return NextResponse.json({ changed: outcome.changed, block: serializedBlock, moves: serializedMoves });
  } catch (error: unknown) {
    if (isAppError(error)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: errorStatus(error.code) });
    }
    logger.error(`[POST /api/blocks/${id}/reflow]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
