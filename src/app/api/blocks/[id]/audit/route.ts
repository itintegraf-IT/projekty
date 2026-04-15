import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["ADMIN", "PLANOVAT", "DTP", "MTZ"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Neplatné ID" }, { status: 400 });
  }

  try {
    const logs = await prisma.auditLog.findMany({
      where: { blockId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    return NextResponse.json(logs);
  } catch (error) {
    logger.error(`[GET /api/blocks/${id}/audit]`, error);
    return NextResponse.json({ error: "Chyba serveru" }, { status: 500 });
  }
}
