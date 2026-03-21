import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// POST /api/blocks/[id]/complete — potvrzení nebo vrácení tisku
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId, username, assignedMachine } = session;

  const canConfirm =
    role === "TISKAR" || role === "ADMIN" || role === "PLANOVAT";
  if (!canConfirm) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const blockId = Number(id);
  if (isNaN(blockId)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  const { completed } = await req.json();
  if (typeof completed !== "boolean") {
    return NextResponse.json({ error: "Chybí pole completed (boolean)" }, { status: 400 });
  }

  // Načíst blok
  const block = await prisma.block.findUnique({ where: { id: blockId } });
  if (!block) return NextResponse.json({ error: "Blok nenalezen" }, { status: 404 });

  // Jen ZAKAZKA může být potvrzena
  if (block.type !== "ZAKAZKA") {
    return NextResponse.json({ error: "Potvrzení tisku je možné pouze u zakázek" }, { status: 400 });
  }

  // TISKAR smí jen na svém stroji
  if (role === "TISKAR" && block.machine !== assignedMachine) {
    return NextResponse.json({ error: "Forbidden — cizí stroj" }, { status: 403 });
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

  return NextResponse.json(updatedBlock);
}
