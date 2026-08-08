import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { AppError, isAppError, errorStatus } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { serializeBlock } from "@/lib/blockSerialization";
import { emitSSE } from "@/lib/eventBus";
import { withRevision } from "@/lib/revision.server";

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

    // Transakci otevírá `withRevision`. Původní POLNÍ `$transaction([...])` musela
    // ustoupit interaktivní: do pole operací nejde podstrčit klient s obalenými
    // delegáty, takže by potvrzení tisku zůstalo bez revize. Pole mělo přesně dvě
    // položky (`block.update`, `auditLog.create`) — jsou níž ve stejném pořadí.
    // UVNITŘ těla se nesmí sáhnout na modulový `prisma` ani pro čtení: běželo by
    // mimo transakci, přežilo by její rollback a revizi by obešlo.
    const { result: updatedBlock } = await withRevision(
      {
        // Směr musí být poznat ze samotného `action` — jinak by dotaz
        // `WHERE action='PRINT_COMPLETE'` vrátil i vrácení tisku a panel historie
        // by tvrdil opak toho, co se stalo (recenze 8. 8. 2026, K5).
        action: completed ? "PRINT_COMPLETE" : "PRINT_UNDO",
        label: completed ? "Potvrzení tisku" : "Vrácení tisku",
        user: { id: userId, username },
        // Původní POLNÍ `$transaction([...])` neměla ŽÁDNÝ aplikační deadline —
        // přepis na interaktivní jí dal výchozích 15 s pomocníka a tiskaři u stroje
        // tím začalo padat „Hotovo" v okamžiku, kdy na témž stroji běžel celostrojový
        // přepočet (naměřeno: 1200 bloků 12,5 s, 2000 bloků 25,1 s). 30 s je parita
        // s vlastním stropem přepočtu, tedy s reálným zdrojem toho čekání.
        txOptions: { timeout: 30000 },
      },
      async (tx) => {
        const updated = await tx.block.update({
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
        });
        await tx.auditLog.create({
          data: {
            blockId,
            orderNumber: block.orderNumber,
            userId,
            username,
            action: auditAction,
          },
        });
        return updated;
      },
    );

    // Refetch s Reservation include pro reservationConfirmedAt
    const blockWithRes = await prisma.block.findUnique({
      where: { id: blockId },
      include: { Reservation: { select: { confirmedAt: true } } },
    }) ?? updatedBlock;

    emitSSE("block:print-completed", { block: serializeBlock(blockWithRes), machine: updatedBlock.machine, sourceUserId: session.id });
    return NextResponse.json(serializeBlock(blockWithRes));
  } catch (err) {
    if (isAppError(err)) return NextResponse.json({ error: err.message }, { status: errorStatus(err.code) });
    // Vypršelá / zakousnutá transakce NENÍ chyba serveru, je to souběh: tisk se
    // nepotvrdil jen proto, že blok drží někdo jiný (typicky přepočet stroje).
    // Bez téhle větve dostane tiskař u stroje „Interní chyba serveru." a nemá
    // z čeho poznat, že stačí zmáčknout Hotovo znovu. Vzor: obě reflow routy.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2028" || err.code === "P2034")) {
      logger.warn("[POST /api/blocks/[id]/complete] transakce vypršela nebo se zakousla", { code: err.code });
      return NextResponse.json(
        { error: "Blok právě upravuje někdo jiný — zkuste Hotovo za chvíli znovu." },
        { status: 503 },
      );
    }
    logger.error("[POST /api/blocks/[id]/complete] neočekávaná chyba", err);
    return NextResponse.json({ error: "Interní chyba serveru." }, { status: 500 });
  }
}
