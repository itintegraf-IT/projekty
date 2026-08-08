import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { serializeBlock } from "@/lib/blockSerialization";
import { getExpeditionDayKey, getNextExpeditionSortOrder } from "@/lib/expedition";
import { prisma } from "@/lib/prisma";
import { emitSSE } from "@/lib/eventBus";
import { canAccessBlockNotes, stripNotesIfDenied, type NoteRole } from "@/lib/blockNotePermissions";
import { withRevision } from "@/lib/revision.server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Odpověď expedičního POST + oznámení split sourozenců (parita s #9/PUT). Expediční akce
 * (publish/unpublish/reorder) mění pole u CELÉ split skupiny přes updateMany → sourozencům
 * se posune updatedAt. Bez oznámení by planner-klient držel stale updatedAt a další split
 * sourozence spadl na falešný 409. Refetch primárního bloku i sourozenců (s notes),
 * broadcast block:batch-updated ostatním, vrátit sourozence v odpovědi (`siblings`)
 * originátorovi; notes gate dle role (parita s ostatními mutačními cestami).
 * `siblingGroupId == null` (ne-split blok nebo idempotentní no-op) → jen refetch primárního.
 */
async function expeditionSiblingResponse(
  primaryId: number,
  siblingGroupId: number | null,
  session: { id: number; role: string },
): Promise<NextResponse> {
  const canSeeNotes = canAccessBlockNotes(session.role as NoteRole);
  const primary = await prisma.block.findUnique({
    where: { id: primaryId },
    include: { Reservation: { select: { confirmedAt: true } }, notes: { orderBy: { createdAt: "desc" as const } } },
  });
  if (!primary) return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });

  let serializedSiblings: ReturnType<typeof serializeBlock>[] = [];
  if (siblingGroupId != null) {
    const siblings = await prisma.block.findMany({
      where: { splitGroupId: siblingGroupId, id: { not: primaryId } },
      include: { Reservation: { select: { confirmedAt: true } }, notes: { orderBy: { createdAt: "desc" as const } } },
    });
    serializedSiblings = siblings.map(serializeBlock);
    if (serializedSiblings.length > 0) {
      emitSSE("block:batch-updated", { blocks: serializedSiblings, sourceUserId: session.id });
    }
  }
  return NextResponse.json({
    ...stripNotesIfDenied(serializeBlock(primary), canSeeNotes),
    siblings: serializedSiblings.map((b) => stripNotesIfDenied(b, canSeeNotes)),
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== "publish" && action !== "unpublish" && action !== "reorder") {
    return NextResponse.json({ error: "Neplatná akce" }, { status: 400 });
  }

  // ── Reorder: přímá aktualizace expeditionSortOrder publishnutého bloku ────────
  if (action === "reorder") {
    const newSortOrder = typeof body?.expeditionSortOrder === "number"
      ? body.expeditionSortOrder
      : undefined;
    if (newSortOrder === undefined || !Number.isFinite(newSortOrder)) {
      return NextResponse.json({ error: "Chybí platný expeditionSortOrder" }, { status: 400 });
    }

    try {
      // Transakci otevírá `withRevision` — `updateMany` níž mění expediční pořadí
      // CELÉ split skupiny, takže revizi dostane každý její člen (zachycení se řídí
      // `where` toho updateMany). Uvnitř těla se nesmí sáhnout na modulový `prisma`
      // ani pro čtení: běželo by mimo transakci a revizi by obešlo.
      const { result: siblingGroupId } = await withRevision(
        {
          action: "EXPEDITION",
          label: "Změna pořadí v expedici",
          user: { id: session.id, username: session.username },
        },
        async (tx) => {
        const currentBlock = await tx.block.findUnique({
          where: { id },
          select: { id: true, expeditionPublishedAt: true, splitGroupId: true },
        });
        if (!currentBlock) throw new Error("NOT_FOUND");
        if (currentBlock.expeditionPublishedAt == null) throw new Error("NOT_PUBLISHED");

        const targetIds =
          currentBlock.splitGroupId != null
            ? // B2: všichni členové (i bývalý root) nesou splitGroupId = SplitGroup.id,
              // takže prostý filtr chytí celou skupinu. Žádné OR přes id — Block.id
              // a SplitGroup.id jsou nezávislé id-prostory (numerická shoda by lhala).
              (await tx.block.findMany({
                where: { splitGroupId: currentBlock.splitGroupId },
                select: { id: true },
              })).map((b) => b.id)
            : [currentBlock.id];

        await tx.block.updateMany({
          where: { id: { in: targetIds } },
          data: { expeditionSortOrder: newSortOrder },
        });

        return currentBlock.splitGroupId;
        // Tělo výše si drží PŮVODNÍ odsazení — přeformátovat ho kvůli jednomu
        // zanoření navíc by zbytečně nafouklo diff i recenzi (týž postup jako u PUT).
        },
      );

      emitSSE("block:expedition-changed", { sourceUserId: session.id });
      return await expeditionSiblingResponse(id, siblingGroupId, session);
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === "NOT_FOUND") {
          return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
        }
        if (error.message === "NOT_PUBLISHED") {
          return NextResponse.json({ error: "Blok není zaplánován v expedici" }, { status: 400 });
        }
      }
      logger.error(`[POST /api/blocks/${id}/expedition reorder]`, error);
      return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
    }
  }

  try {
    // Táž konstrukce jako u reorderu výš: `withRevision` podstrčí klient s obalenými
    // delegáty `block` a `auditLog`, takže zařazení i vyřazení zanechá revizi u KAŽDÉHO
    // člena split skupiny (updateMany níž jede přes id celé skupiny) a auditní řádky
    // téže transakce dostanou shodné `groupId`. Modulový `prisma` je v těle zakázaný.
    const { result: siblingGroupId } = await withRevision(
      {
        action: "EXPEDITION",
        label: action === "publish" ? "Zařazení do expedice" : "Vyřazení z expedice",
        user: { id: session.id, username: session.username },
      },
      async (tx) => {
      const currentBlock = await tx.block.findUnique({
        where: { id },
        select: {
          id: true,
          orderNumber: true,
          type: true,
          deadlineExpedice: true,
          splitGroupId: true,
          expeditionPublishedAt: true,
          expeditionSortOrder: true,
        },
      });

      if (!currentBlock) {
        throw new Error("NOT_FOUND");
      }
      if (currentBlock.type !== "ZAKAZKA") {
        throw new Error("INVALID_TYPE");
      }

      const targetBlocks = currentBlock.splitGroupId != null
        ? // B2: členové skupiny nesou splitGroupId = SplitGroup.id (viz reorder výše).
          await tx.block.findMany({
            where: { splitGroupId: currentBlock.splitGroupId },
            select: {
              id: true,
              orderNumber: true,
              type: true,
              deadlineExpedice: true,
            },
          })
        : [currentBlock];

      if (targetBlocks.some((block) => block.type !== "ZAKAZKA")) {
        throw new Error("INVALID_SPLIT_TYPE");
      }

      if (action === "publish") {
        if (currentBlock.deadlineExpedice == null) {
          throw new Error("MISSING_DEADLINE");
        }

        const dayKey = getExpeditionDayKey(currentBlock.deadlineExpedice);
        const inconsistentSplitDeadline = targetBlocks.some(
          (block) =>
            block.deadlineExpedice == null ||
            getExpeditionDayKey(block.deadlineExpedice) !== dayKey
        );
        if (inconsistentSplitDeadline) {
          throw new Error("SPLIT_DEADLINE_MISMATCH");
        }

        if (currentBlock.expeditionPublishedAt != null && currentBlock.expeditionSortOrder != null) {
          return null; // idempotentní no-op — už publikováno, žádný updateMany na sourozencích
        }

        const expeditionPublishedAt = new Date();
        const expeditionSortOrder = await getNextExpeditionSortOrder(tx, currentBlock.deadlineExpedice);

        await tx.block.updateMany({
          where: { id: { in: targetBlocks.map((block) => block.id) } },
          data: {
            expeditionPublishedAt,
            expeditionSortOrder,
          },
        });

        await tx.auditLog.createMany({
          data: targetBlocks.map((block) => ({
            blockId: block.id,
            orderNumber: block.orderNumber,
            userId: session.id,
            username: session.username,
            action: "EXPEDITION_PUBLISH",
          })),
        });
      } else {
        if (currentBlock.expeditionPublishedAt == null && currentBlock.expeditionSortOrder == null) {
          return null; // idempotentní no-op — už odebráno, žádný updateMany na sourozencích
        }

        await tx.block.updateMany({
          where: { id: { in: targetBlocks.map((block) => block.id) } },
          data: {
            expeditionPublishedAt: null,
            expeditionSortOrder: null,
          },
        });

        await tx.auditLog.createMany({
          data: targetBlocks.map((block) => ({
            blockId: block.id,
            orderNumber: block.orderNumber,
            userId: session.id,
            username: session.username,
            action: "EXPEDITION_UNPUBLISH",
          })),
        });
      }

      return currentBlock.splitGroupId;
      // Tělo výše si drží PŮVODNÍ odsazení — viz komentář u reorderu.
      },
    );

    emitSSE("block:expedition-changed", { sourceUserId: session.id });
    return await expeditionSiblingResponse(id, siblingGroupId, session);
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (error.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
      }
      if (error.message === "INVALID_TYPE" || error.message === "INVALID_SPLIT_TYPE") {
        return NextResponse.json({ error: "Do expedice lze zařadit pouze tiskovou zakázku" }, { status: 400 });
      }
      if (error.message === "MISSING_DEADLINE") {
        return NextResponse.json({ error: "Nejdřív vyplň termín expedice" }, { status: 400 });
      }
      if (error.message === "SPLIT_DEADLINE_MISMATCH") {
        return NextResponse.json(
          { error: "Split skupina nemá sjednocený termín expedice. Ulož termín znovu a akci opakuj." },
          { status: 409 }
        );
      }
    }

    logger.error(`[POST /api/blocks/${id}/expedition]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
