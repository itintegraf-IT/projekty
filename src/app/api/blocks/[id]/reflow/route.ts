import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { isAppError, errorStatus } from "@/lib/errors";
import { serializeBlock } from "@/lib/blockSerialization";
import { reflowBlockInTx } from "@/lib/reflow.server";
import { resolveChainPushFromDb } from "@/lib/overlapResolver.server";
import { cascadeConfirmBody } from "@/lib/cascadeResponse";
import { emitSSE } from "@/lib/eventBus";
import { canAccessBlockNotes, stripNotesIfDenied, type NoteRole } from "@/lib/blockNotePermissions";
import { withRevision } from "@/lib/revision.server";
import { autoShiftExplicitlyOff, overlapMessageFor } from "@/lib/autoShiftOff";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
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

  const body = (await request.json().catch(() => null)) as { cascadeConfirmed?: boolean; resolveChain?: boolean } | null;
  // cascadeConfirmed: uživatel velkou kaskádu odklepl v dialogu — nad prahem se bez toho transakce odroluje (409 CASCADE_CONFIRM, vynuceno od 21. 8. 2026).
  const cascadeConfirmed = body?.cascadeConfirmed === true;
  // resolveChain: vypínač autoposunu (Task 6D). „Přepočítat" je akce, kterou si uživatel
  // vyžádal, ale pořád posouvá cizí bloky stejně jako drag — chybějící příznak (starý
  // klient) znamená ZAPNUTO, `resolveChain: false` chain push u tohoto bloku vypne.
  const resolveChain = body?.resolveChain !== false;
  // autoShiftOff se vyzvedává TADY, hned vedle resolveChain, ne až v catch — `body`
  // je tu sice `const` mimo try a dnes se nikde nemutuje, ale vzorec „vyzvedni hned
  // po parsování, nečekej na catch" je obrana proti tomu, aby se sem nepřenesla past,
  // kterou naostro naměřil test 21. 8. 2026 u PUT `/api/blocks/[id]` (tam `body`
  // sdílí referenci s objektem, který se pak `delete`-uje).
  const autoShiftOff = autoShiftExplicitlyOff(body);

  try {
    // Transakci otevírá `withRevision` — přepočítaný blok i bloky odsunuté jeho chain
    // pushem dostanou vlastní revizi pod jedním `groupId`, auditní řádky téže transakce
    // (AUTO_REFLOW + AUTO_SHIFT) dostanou `groupId` automaticky. UVNITŘ těla se nesmí
    // sáhnout na modulový `prisma` ani pro čtení (viz docblock withRevision).
    // Timeout 15 s / maxWait 5 s má `withRevision` jako výchozí, nepředává se — na rozdíl
    // od celostrojového přepočtu je tohle krátká transakce nad jedním blokem.
    const { result: outcome } = await withRevision(
      { action: "REFLOW", label: "Přepočet bloku", user: { id: session.id, username: session.username } },
      (tx) =>
        reflowBlockInTx(tx, id, { id: session.id, username: session.username }, {
          resolveChainPush: resolveChainPushFromDb,
          cascadeConfirmed,
          resolveChain,
        }),
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
      // SSE broadcast nese notes plné — per-connection strip v /api/events je zahodí (D2b).
      emitSSE("block:batch-updated", {
        blocks: [serializedBlock, ...serializedMoves],
        sourceUserId: session.id,
      });
    }

    // Odpověď mutujícímu — poznámky gate dle role (reflow je ADMIN/PLANOVAT-only, oba právo mají).
    const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
    return NextResponse.json({
      changed: outcome.changed,
      block: stripNotesIfDenied(serializedBlock, canSeeNotes),
      moves: serializedMoves.map((b) => stripNotesIfDenied(b, canSeeNotes)),
      before: outcome.before,
    });
  } catch (error: unknown) {
    if (isAppError(error) && error.code === "CASCADE_CONFIRM") {
      return NextResponse.json(cascadeConfirmBody(error), { status: errorStatus(error.code) });
    }
    if (isAppError(error)) {
      const message = error.code === "OVERLAP"
        ? overlapMessageFor(error.message, autoShiftOff)
        : error.message;
      return NextResponse.json({ error: message, code: error.code }, { status: errorStatus(error.code) });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      logger.warn(`[POST /api/blocks/${id}/reflow] transakce vypršela (P2028)`);
      return NextResponse.json(
        { error: "Přepočet trval příliš dlouho — zkuste to znovu, případně po menších částech." },
        { status: 503 },
      );
    }
    logger.error(`[POST /api/blocks/${id}/reflow]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
