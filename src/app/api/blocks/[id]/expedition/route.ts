import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { serializeBlock } from "@/lib/blockSerialization";
import { getExpeditionDayKey, getNextExpeditionSortOrder } from "@/lib/expedition";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

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
      const updatedBlock = await prisma.$transaction(async (tx) => {
        const currentBlock = await tx.block.findUnique({
          where: { id },
          select: { id: true, expeditionPublishedAt: true, splitGroupId: true },
        });
        if (!currentBlock) throw new Error("NOT_FOUND");
        if (currentBlock.expeditionPublishedAt == null) throw new Error("NOT_PUBLISHED");

        const targetIds =
          currentBlock.splitGroupId != null
            ? (await tx.block.findMany({
                where: {
                  OR: [
                    { splitGroupId: currentBlock.splitGroupId },
                    { id: currentBlock.splitGroupId },
                  ],
                },
                select: { id: true },
              })).map((b) => b.id)
            : [currentBlock.id];

        await tx.block.updateMany({
          where: { id: { in: targetIds } },
          data: { expeditionSortOrder: newSortOrder },
        });

        const updated = await tx.block.findUnique({ where: { id } });
        if (!updated) throw new Error("NOT_FOUND");
        return updated;
      });

      return NextResponse.json(serializeBlock(updatedBlock));
    } catch (error: unknown) {
      if (error instanceof Error) {
        if (error.message === "NOT_FOUND") {
          return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });
        }
        if (error.message === "NOT_PUBLISHED") {
          return NextResponse.json({ error: "Blok není zaplánován v expedici" }, { status: 400 });
        }
      }
      console.error(`[POST /api/blocks/${id}/expedition reorder]`, error);
      return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
    }
  }

  try {
    const updatedBlock = await prisma.$transaction(async (tx) => {
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
        ? await tx.block.findMany({
            where: {
              OR: [
                { splitGroupId: currentBlock.splitGroupId },
                { id: currentBlock.splitGroupId },
              ],
            },
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
          const existing = await tx.block.findUnique({ where: { id } });
          if (!existing) throw new Error("NOT_FOUND");
          return existing;
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
          const existing = await tx.block.findUnique({ where: { id } });
          if (!existing) throw new Error("NOT_FOUND");
          return existing;
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

      const updated = await tx.block.findUnique({ where: { id } });
      if (!updated) {
        throw new Error("NOT_FOUND");
      }

      return updated;
    });

    return NextResponse.json(serializeBlock(updatedBlock));
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

    console.error(`[POST /api/blocks/${id}/expedition]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
