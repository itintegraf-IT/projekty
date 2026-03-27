import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { blockId, blockOrderNumber } = body;
  if (!blockId || typeof blockId !== "number") {
    return NextResponse.json({ error: "Neplatné blockId" }, { status: 400 });
  }

  try {
    await prisma.notification.createMany({
      data: [
        { blockId, blockOrderNumber: blockOrderNumber ?? null, targetRole: "MTZ", createdByUserId: session.id, createdByUsername: session.username },
        { blockId, blockOrderNumber: blockOrderNumber ?? null, targetRole: "DTP", createdByUserId: session.id, createdByUsername: session.username },
      ],
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/notifications]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (["MTZ", "DTP"].includes(session.role)) {
      const notifications = await prisma.notification.findMany({
        where: { targetRole: session.role },
        orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
        take: 50,
      });
      return NextResponse.json(notifications);
    }
    if (["ADMIN", "PLANOVAT"].includes(session.role)) {
      const notifications = await prisma.notification.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return NextResponse.json(notifications);
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch (error) {
    console.error("[GET /api/notifications]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
