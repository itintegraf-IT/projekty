import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });

  try {
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return NextResponse.json({ error: "Nenalezeno" }, { status: 404 });

    // ADMIN může vše; DTP/MTZ jen svoji roli; OBCHODNIK jen notifikace cílené na jeho userId
    const isOwner = session.role === "ADMIN"
      || notif.targetRole === session.role
      || notif.targetUserId === session.id;
    if (!isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[PATCH /api/notifications/[id]/read]", error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
